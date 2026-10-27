package com.ultima.vless.plugin

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.Uri
import android.net.VpnService
import android.os.Build
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import androidx.core.graphics.drawable.toBitmap
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.ultima.vless.core.CoreRuntime
import com.ultima.vless.core.SessionRequest
import com.ultima.vless.core.StartOrigin
import com.ultima.vless.core.longVersionCodeCompat
import com.ultima.vless.net.NetProbes
import com.ultima.vless.util.AppFiles
import com.ultima.vless.util.Updates
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.Executors

/**
 * The native side of `mobile/src/native/UltimaCore.ts`. Capacitor runs plugin
 * methods one after another on a single thread, so anything that can block
 * (sockets, files, the core) resolves from [io].
 */
@CapacitorPlugin(
    name = "UltimaCore",
    permissions = [
        Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS]),
    ],
)
class UltimaCorePlugin : Plugin() {
    private val io = Executors.newCachedThreadPool()
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private val coreListener: (com.ultima.vless.core.CoreEvent) -> Unit = { event ->
        notifyListeners("coreEvent", JSObject.fromJSONObject(event.toJson()))
    }

    override fun load() {
        CoreRuntime.init(context)
        CoreRuntime.eventListener = coreListener
        io.execute { AppFiles.startAppLogSession(context) }
        watchNetwork()
    }

    override fun handleOnDestroy() {
        if (CoreRuntime.eventListener === coreListener) CoreRuntime.eventListener = null
        networkCallback?.let { callback ->
            runCatching {
                context.getSystemService(ConnectivityManager::class.java)
                    .unregisterNetworkCallback(callback)
            }
        }
        networkCallback = null
        super.handleOnDestroy()
    }

    private fun background(call: PluginCall, block: () -> Unit) {
        io.execute {
            try {
                block()
            } catch (error: Throwable) {
                call.reject(error.message ?: error.javaClass.simpleName, NetProbes.errorCode(error))
            }
        }
    }

    private val prefs get() = context.getSharedPreferences("ultima-core", Context.MODE_PRIVATE)

    @PluginMethod
    fun getAppInfo(call: PluginCall) = background(call) {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        call.resolve(
            JSObject()
                .put("version", info.versionName ?: "0.0.0")
                .put("versionCode", info.longVersionCodeCompat())
                .put("packageName", context.packageName)
                .put("dataDir", context.filesDir.absolutePath)
                .put("coreVersion", CoreRuntime.coreVersion(context))
                .put("abi", Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown")
                .put("sdkInt", Build.VERSION.SDK_INT),
        )
    }

    @PluginMethod
    fun readState(call: PluginCall) = background(call) {
        call.resolve(JSObject().put("json", AppFiles.readState(context) ?: JSObject.NULL))
    }

    @PluginMethod
    fun writeState(call: PluginCall) = background(call) {
        AppFiles.writeState(context, call.getString("json") ?: "{}")
        call.resolve()
    }

    // ---- VPN session --------------------------------------------------------

    @PluginMethod
    fun prepareVpn(call: PluginCall) {
        val consent = VpnService.prepare(context)
        if (consent == null) {
            call.resolve(JSObject().put("granted", true))
        } else {
            startActivityForResult(call, consent, "onPrepareVpnResult")
        }
    }

    @ActivityCallback
    private fun onPrepareVpnResult(call: PluginCall?, result: ActivityResult) {
        call?.resolve(JSObject().put("granted", result.resultCode == Activity.RESULT_OK))
    }

    @PluginMethod
    fun requestNotificationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        requestPermissionForAlias("notifications", call, "onNotificationPermissionResult")
    }

    @PermissionCallback
    private fun onNotificationPermissionResult(call: PluginCall) {
        call.resolve(
            JSObject().put("granted", getPermissionState("notifications") == PermissionState.GRANTED),
        )
    }

    /** VPN consent, then (once) the notification permission, then the core. */
    @PluginMethod
    fun startCore(call: PluginCall) {
        val request = try {
            SessionRequest.fromJson(call.data)
        } catch (error: Exception) {
            call.reject(error.message ?: "Invalid session", "EINVAL")
            return
        }
        if (request.isTun) {
            val consent = VpnService.prepare(context)
            if (consent != null) {
                startActivityForResult(call, consent, "onStartConsentResult")
                return
            }
        }
        askNotificationsThenStart(call)
    }

    @ActivityCallback
    private fun onStartConsentResult(call: PluginCall?, result: ActivityResult) {
        call ?: return
        if (result.resultCode != Activity.RESULT_OK) {
            call.reject("VPN permission was denied", "EPERM")
            return
        }
        askNotificationsThenStart(call)
    }

    private fun askNotificationsThenStart(call: PluginCall) {
        val ask = Build.VERSION.SDK_INT >= 33 &&
            getPermissionState("notifications") != PermissionState.GRANTED &&
            !prefs.getBoolean(ASKED_NOTIFICATIONS, false)
        if (ask) {
            prefs.edit().putBoolean(ASKED_NOTIFICATIONS, true).apply()
            requestPermissionForAlias("notifications", call, "onStartNotificationResult")
            return
        }
        runStart(call)
    }

    @PermissionCallback
    private fun onStartNotificationResult(call: PluginCall) = runStart(call)

    private fun runStart(call: PluginCall) {
        val request = SessionRequest.fromJson(call.data)
        CoreRuntime.start(context, request, StartOrigin.APP) { error ->
            if (error == null) {
                call.resolve(JSObject.fromJSONObject(CoreRuntime.status()))
            } else {
                call.reject(error.message ?: "Xray core failed to start", "ECORE")
            }
        }
    }

    @PluginMethod
    fun stopCore(call: PluginCall) {
        CoreRuntime.stop()
        call.resolve()
    }

    @PluginMethod
    fun getCoreStatus(call: PluginCall) {
        call.resolve(JSObject.fromJSONObject(CoreRuntime.status()))
    }

    @PluginMethod
    fun getTraffic(call: PluginCall) = background(call) {
        val (uplink, downlink) = CoreRuntime.traffic()
        call.resolve(JSObject().put("uplink", uplink).put("downlink", downlink))
    }

    @PluginMethod
    fun startProbeCore(call: PluginCall) = background(call) {
        CoreRuntime.startProbe(context, call.getString("id")!!, call.getString("config")!!)
        call.resolve()
    }

    @PluginMethod
    fun stopProbeCore(call: PluginCall) = background(call) {
        CoreRuntime.stopProbe(call.getString("id")!!)
        call.resolve()
    }

    @PluginMethod
    fun allocatePort(call: PluginCall) = background(call) {
        call.resolve(JSObject().put("port", NetProbes.allocatePort()))
    }

    // ---- Network probes -------------------------------------------------------

    @PluginMethod
    fun tcpConnect(call: PluginCall) = background(call) {
        val result = runCatching {
            NetProbes.tcpConnect(
                call.getString("host")!!,
                call.getInt("port")!!,
                call.getInt("timeoutMs") ?: 5000,
            )
        }
        call.resolve(probeResult(result))
    }

    @PluginMethod
    fun tlsHandshake(call: PluginCall) = background(call) {
        val result = runCatching {
            NetProbes.tlsHandshake(
                call.getString("host")!!,
                call.getInt("port")!!,
                call.getString("sni") ?: "",
                call.getInt("timeoutMs") ?: 5000,
            )
        }
        call.resolve(probeResult(result))
    }

    private fun probeResult(result: Result<Unit>): JSObject {
        val response = JSObject().put("ok", result.isSuccess)
        result.exceptionOrNull()?.let { response.put("error", it.message ?: it.javaClass.simpleName) }
        return response
    }

    @PluginMethod
    fun httpRequest(call: PluginCall) = background(call) {
        val headers = mutableMapOf<String, String>()
        call.getObject("headers")?.let { json ->
            json.keys().forEach { key -> headers[key] = json.optString(key) }
        }
        val result = NetProbes.httpRequest(
            url = call.getString("url")!!,
            method = call.getString("method") ?: "GET",
            headers = headers,
            timeoutMs = call.getInt("timeoutMs") ?: 30_000,
            proxyPort = call.getInt("proxyPort"),
            followRedirects = call.getBoolean("followRedirects") ?: true,
            maxBodyBytes = call.getInt("maxBodyBytes") ?: 1_000_000,
        )
        val responseHeaders = JSObject()
        result.headers.forEach { (key, value) -> responseHeaders.put(key, value) }
        call.resolve(
            JSObject()
                .put("status", result.status)
                .put("headers", responseHeaders)
                .put("body", result.body)
                .put("truncated", result.truncated),
        )
    }

    @PluginMethod
    fun dnsLookup(call: PluginCall) = background(call) {
        val addresses = JSArray()
        NetProbes.dnsLookup(call.getString("hostname")!!).forEach { (address, family) ->
            addresses.put(JSObject().put("address", address).put("family", family))
        }
        call.resolve(JSObject().put("addresses", addresses))
    }

    @PluginMethod
    fun getNetworkInterfaces(call: PluginCall) = background(call) {
        call.resolve(JSObject().put("interfaces", interfacesJson()))
    }

    private fun interfacesJson(): JSObject {
        val result = JSObject()
        NetProbes.networkInterfaces().forEach { (name, addresses) ->
            val list = JSArray()
            addresses.forEach { entry ->
                list.put(
                    JSObject()
                        .put("address", entry.address)
                        .put("family", entry.family)
                        .put("internal", entry.internal),
                )
            }
            result.put(name, list)
        }
        return result
    }

    /** Feeds `os.networkInterfaces()`, which the health probe reads synchronously. */
    private fun watchNetwork() {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = publish()
            override fun onLost(network: Network) = publish()
            override fun onLinkPropertiesChanged(network: Network, properties: LinkProperties) = publish()

            private fun publish() {
                io.execute {
                    notifyListeners("networkChanged", JSObject().put("interfaces", interfacesJson()))
                }
            }
        }
        runCatching { manager.registerDefaultNetworkCallback(callback) }
            .onSuccess { networkCallback = callback }
    }

    // ---- Files, sharing, apps -------------------------------------------------

    @PluginMethod
    fun appendLog(call: PluginCall) = background(call) {
        AppFiles.appendLog(context, call.getString("name")!!, call.getString("text") ?: "")
        call.resolve()
    }

    @PluginMethod
    fun readLog(call: PluginCall) = background(call) {
        val chunk = AppFiles.readLog(
            context,
            call.getString("name")!!,
            (call.getDouble("offset") ?: 0.0).toLong(),
            call.getInt("maxBytes") ?: 256 * 1024,
        )
        call.resolve(
            JSObject().put("text", chunk.text).put("size", chunk.size).put("start", chunk.start),
        )
    }

    @PluginMethod
    fun logSize(call: PluginCall) = background(call) {
        call.resolve(JSObject().put("size", AppFiles.logSize(context, call.getString("name")!!)))
    }

    @PluginMethod
    fun shareText(call: PluginCall) = background(call) {
        val fileName = (call.getString("fileName") ?: "ultimavless.txt")
            .replace(Regex("[^A-Za-z0-9._-]"), "_")
        val dir = File(context.cacheDir, "share").apply { mkdirs() }
        val file = File(dir, fileName)
        file.writeText(call.getString("text") ?: "", Charsets.UTF_8)
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val send = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, call.getString("title") ?: fileName)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        val chooser = Intent.createChooser(send, call.getString("title"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(chooser)
        call.resolve()
    }

    @PluginMethod
    fun openUrl(call: PluginCall) {
        val url = call.getString("url") ?: ""
        if (!url.startsWith("https://") && !url.startsWith("http://")) {
            call.reject("Only http(s) URLs can be opened", "EINVAL")
            return
        }
        context.startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        call.resolve()
    }

    /** Apps that may use the network, for per-app routing. */
    @PluginMethod
    fun listApps(call: PluginCall) = background(call) {
        val pm = context.packageManager
        @Suppress("DEPRECATION")
        val packages = pm.getInstalledPackages(PackageManager.GET_PERMISSIONS)
        val apps = packages
            .filter { info ->
                info.packageName != context.packageName &&
                    info.requestedPermissions?.contains(Manifest.permission.INTERNET) == true
            }
            .mapNotNull { info ->
                val app = info.applicationInfo ?: return@mapNotNull null
                Triple(info.packageName, app.loadLabel(pm).toString(), app)
            }
            .sortedBy { it.second.lowercase() }
        val list = JSArray()
        for ((packageName, label, app) in apps) {
            list.put(
                JSObject()
                    .put("packageName", packageName)
                    .put("label", label)
                    .put("icon", iconDataUrl(app) ?: JSObject.NULL)
                    .put("system", app.flags and ApplicationInfo.FLAG_SYSTEM != 0),
            )
        }
        call.resolve(JSObject().put("apps", list))
    }

    private fun iconDataUrl(app: ApplicationInfo): String? = runCatching {
        val bitmap = app.loadIcon(context.packageManager).toBitmap(48, 48)
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }.getOrNull()

    // ---- Updates ----------------------------------------------------------------

    @PluginMethod
    fun downloadUpdate(call: PluginCall) = background(call) {
        val file = Updates.download(
            context,
            call.getString("url")!!,
            call.getString("fileName")!!,
        ) { percent, bytesPerSecond ->
            notifyListeners(
                "updateProgress",
                JSObject().put("percent", percent).put("bytesPerSecond", bytesPerSecond),
            )
        }
        call.resolve(JSObject().put("path", file.absolutePath))
    }

    @PluginMethod
    fun installUpdate(call: PluginCall) = background(call) {
        Updates.install(context, call.getString("path")!!)
        call.resolve()
    }

    private companion object {
        const val ASKED_NOTIFICATIONS = "askedNotifications"
    }
}
