package com.ultima.vless.core

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.service.quicksettings.TileService
import android.util.Log
import androidx.core.content.ContextCompat
import com.ultima.vless.util.AppFiles
import go.Seq
import libv2ray.CoreCallbackHandler
import libv2ray.CoreController
import libv2ray.Libv2ray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/**
 * Owner of the Xray core (libv2ray) and the VPN tunnel. The WebView decides
 * what to run; this object runs it, in the app process, so the session keeps
 * going when the WebView is gone.
 *
 * Starts and stops are serialized on one thread. Stopping keeps the tunnel up
 * for a moment: the desktop session logic switches servers as stop + start,
 * and a tunnel that survives the gap neither leaks traffic past the VPN nor
 * makes Android flash the VPN key.
 */
object CoreRuntime {
    private const val TAG = "UltimaCore"
    private const val TUNNEL_GRACE_MS = 1500L

    private val executor = Executors.newSingleThreadExecutor { Thread(it, "ultima-core") }
    private val mainHandler = Handler(Looper.getMainLooper())
    /** libv2ray passes the TUN fd through a process-wide environment variable. */
    private val coreLock = Any()
    private val trafficLock = Any()

    private lateinit var appContext: Context
    @Volatile private var service: UltimaVpnService? = null
    private var controller: CoreController? = null
    private var tunnel: ParcelFileDescriptor? = null
    private var tunnelOptions: VpnOptions? = null
    @Volatile var session: SessionRequest? = null
        private set
    @Volatile var startedAt: Long? = null
        private set
    private var uplink = 0L
    private var downlink = 0L
    private val pendingStart = AtomicReference<PendingStart?>(null)
    private val probes = ConcurrentHashMap<String, CoreController>()
    @Volatile private var envReady = false
    @Volatile var eventListener: ((CoreEvent) -> Unit)? = null

    private val graceClose = Runnable { executor.execute { closeIfIdle() } }

    private class PendingStart(
        val request: SessionRequest,
        val origin: StartOrigin,
        val callback: (Throwable?) -> Unit,
    )

    private object Callbacks : CoreCallbackHandler {
        override fun startup(): Long = 0
        override fun shutdown(): Long = 0
        override fun onEmitStatus(p0: Long, p1: String?): Long {
            Log.i(TAG, "core: $p1")
            return 0
        }
    }

    fun init(context: Context) {
        if (!::appContext.isInitialized) appContext = context.applicationContext
    }

    val isRunning: Boolean get() = session != null

    /** Nothing runs, waits or is coming up. */
    val isIdle: Boolean get() = session == null && pendingStart.get() == null && !starting
    @Volatile private var starting = false

    fun status(): JSONObject {
        val current = session
        return JSONObject()
            .put("running", current != null)
            .put("mode", current?.mode ?: JSONObject.NULL)
            .put("serverId", current?.serverId ?: JSONObject.NULL)
            .put("sessionName", current?.sessionName ?: JSONObject.NULL)
            .put("startedAt", startedAt ?: JSONObject.NULL)
    }

    /**
     * Runs [request]; [callback] gets null once the core is up, or the error.
     * Starting the session that already runs is a no-op, so a fresh WebView
     * can adopt a session without interrupting it.
     */
    fun start(
        context: Context,
        request: SessionRequest,
        origin: StartOrigin,
        callback: (Throwable?) -> Unit,
    ) {
        init(context)
        pendingStart.getAndSet(PendingStart(request, origin, callback))
            ?.callback?.invoke(IllegalStateException("Superseded by a newer start"))
        mainHandler.removeCallbacks(graceClose)
        val running = service
        if (running != null) {
            executor.execute { runPendingStart(running) }
            return
        }
        val intent = Intent(appContext, UltimaVpnService::class.java)
            .setAction(UltimaVpnService.ACTION_START)
        try {
            ContextCompat.startForegroundService(appContext, intent)
        } catch (error: Exception) {
            pendingStart.getAndSet(null)?.callback?.invoke(error)
        }
    }

    /** The last session, for the tile and Always-on VPN. */
    fun startLastSession(context: Context, origin: StartOrigin): Boolean {
        init(context)
        val stored = AppFiles.readLastSession(appContext) ?: return false
        val request = runCatching { SessionRequest.fromJson(JSONObject(stored)) }
            .getOrElse { error ->
                Log.w(TAG, "Stored session is unreadable", error)
                return false
            }
        start(appContext, request, origin) { error ->
            if (error != null) Log.w(TAG, "Restarting the last session failed", error)
        }
        return true
    }

    /** From [UltimaVpnService.onStartCommand], once it is in the foreground. */
    internal fun onServiceStarted(svc: UltimaVpnService) {
        service = svc
        executor.execute { runPendingStart(svc) }
    }

    private fun runPendingStart(svc: UltimaVpnService) {
        val pending = pendingStart.getAndSet(null) ?: return
        starting = true
        try {
            startSession(svc, pending.request)
            pending.callback(null)
            if (pending.origin != StartOrigin.APP) {
                emit(CoreEvent.Started(pending.request.serverId, pending.request.mode))
            }
        } catch (error: Throwable) {
            Log.w(TAG, "Core start failed", error)
            pending.callback(error)
            if (pending.origin != StartOrigin.APP) {
                emit(CoreEvent.Stopped("error", error.message))
            }
            if (session == null) mainHandler.postDelayed(graceClose, TUNNEL_GRACE_MS)
        } finally {
            starting = false
        }
        refreshTile()
    }

    private fun startSession(svc: UltimaVpnService, request: SessionRequest) {
        val core = controller
        if (session == request && core != null && core.isRunning) {
            svc.showSession(request)
            return
        }
        stopCoreLoop()
        if (request.isTun) {
            val vpn = request.vpn ?: throw IllegalArgumentException("VPN options are missing")
            if (tunnel == null || tunnelOptions != vpn) {
                val fresh = svc.establishTunnel(vpn, request.sessionName)
                    ?: throw IllegalStateException("VPN permission was denied")
                closeTunnel()
                tunnel = fresh
                tunnelOptions = vpn
            }
        } else {
            closeTunnel()
        }
        ensureCoreEnv(svc)
        AppFiles.trimXrayLog(svc)
        val started = core ?: Libv2ray.newCoreController(Callbacks).also { controller = it }
        synchronized(coreLock) {
            started.startLoop(request.config, tunnel?.fd ?: 0)
        }
        synchronized(trafficLock) {
            started.queryAllOutboundTrafficStats()
            uplink = 0
            downlink = 0
        }
        session = request
        startedAt = System.currentTimeMillis()
        AppFiles.writeLastSession(svc, request.toJson().toString())
        svc.showSession(request)
    }

    /** Stop asked for by the WebView: the tunnel closes after the grace period. */
    fun stop() {
        executor.execute {
            stopCoreLoop()
            session = null
            startedAt = null
            mainHandler.removeCallbacks(graceClose)
            mainHandler.postDelayed(graceClose, TUNNEL_GRACE_MS)
            refreshTile()
        }
    }

    /** Notification button or tile. */
    fun stopByUser() = stopNow("user", null)

    internal fun onRevoked() = stopNow("revoked", null)

    private fun stopNow(reason: String, message: String?) {
        executor.execute {
            val wasRunning = session != null
            stopCoreLoop()
            session = null
            startedAt = null
            teardownService()
            if (wasRunning) emit(CoreEvent.Stopped(reason, message))
            refreshTile()
        }
    }

    internal fun onServiceDestroyed(svc: UltimaVpnService) {
        executor.execute {
            if (service !== svc) return@execute
            service = null
            val wasRunning = session != null
            stopCoreLoop()
            session = null
            startedAt = null
            closeTunnel()
            if (wasRunning) emit(CoreEvent.Stopped("error", "VPN service stopped"))
            refreshTile()
        }
    }

    private fun closeIfIdle() {
        if (session == null && pendingStart.get() == null) teardownService()
    }

    private fun teardownService() {
        closeTunnel()
        val svc = service
        service = null
        svc?.shutdown()
    }

    private fun stopCoreLoop() {
        val core = controller ?: return
        if (!core.isRunning) return
        synchronized(trafficLock) {
            runCatching { core.stopLoop() }.onFailure { Log.w(TAG, "stopLoop failed", it) }
        }
    }

    private fun closeTunnel() {
        runCatching { tunnel?.close() }
        tunnel = null
        tunnelOptions = null
    }

    /** Cumulative bytes of the `proxy` outbound; libv2ray hands out deltas. */
    fun traffic(): Pair<Long, Long> = synchronized(trafficLock) {
        val core = controller
        if (session != null && core != null && core.isRunning) {
            for (entry in core.queryAllOutboundTrafficStats().split(';')) {
                val parts = entry.split(',')
                if (parts.size != 3 || parts[0] != "proxy") continue
                val bytes = parts[2].toLongOrNull() ?: continue
                when (parts[1]) {
                    "uplink" -> uplink += bytes
                    "downlink" -> downlink += bytes
                }
            }
        }
        uplink to downlink
    }

    /** Throwaway core for a real-delay probe; listens on its own loopback port. */
    fun startProbe(context: Context, id: String, config: String) {
        init(context)
        ensureCoreEnv(context)
        val core = Libv2ray.newCoreController(Callbacks)
        synchronized(coreLock) { core.startLoop(config, 0) }
        probes[id] = core
    }

    fun stopProbe(id: String) {
        probes.remove(id)?.let { core -> runCatching { core.stopLoop() } }
    }

    fun coreVersion(context: Context): String {
        ensureCoreEnv(context)
        return Libv2ray.checkVersionX()
    }

    /** Geodata goes next to the core once per app version; Xray reads it from there. */
    @Synchronized
    private fun ensureCoreEnv(context: Context) {
        if (envReady) return
        val app = context.applicationContext
        Seq.setContext(app)
        val geoDir = File(app.filesDir, "geo")
        val stamp = File(geoDir, ".version")
        val version = app.packageManager.getPackageInfo(app.packageName, 0).longVersionCodeCompat()
        if (!stamp.exists() || stamp.readText() != version.toString()) {
            geoDir.mkdirs()
            for (name in listOf("geoip.dat", "geosite.dat")) {
                app.assets.open("geo/$name").use { input ->
                    File(geoDir, name).outputStream().use { output -> input.copyTo(output) }
                }
            }
            stamp.writeText(version.toString())
        }
        Libv2ray.initCoreEnv(geoDir.absolutePath, "")
        envReady = true
    }

    private fun emit(event: CoreEvent) {
        Log.i(TAG, "event: ${event.toJson()}")
        eventListener?.invoke(event)
    }

    private fun refreshTile() {
        if (!::appContext.isInitialized) return
        runCatching {
            TileService.requestListeningState(
                appContext,
                ComponentName(appContext, QuickTileService::class.java),
            )
        }
    }
}

@Suppress("DEPRECATION")
internal fun android.content.pm.PackageInfo.longVersionCodeCompat(): Long =
    if (android.os.Build.VERSION.SDK_INT >= 28) longVersionCode else versionCode.toLong()
