package com.ultima.vless.core

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.ultima.vless.MainActivity
import com.ultima.vless.R
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Hosts the session: the foreground notification, the VPN interface, and the
 * process lifetime the core needs. Proxy-only sessions run here too, without
 * a tunnel. Session logic lives in [CoreRuntime].
 */
class UltimaVpnService : VpnService() {
    companion object {
        const val ACTION_START = "com.ultima.vless.START"
        const val ACTION_STOP = "com.ultima.vless.STOP"
        private const val TAG = "UltimaVpnService"
        private const val CHANNEL_ID = "vpn"
        private const val NOTIFICATION_ID = 1
        private const val SPEED_REFRESH_MS = 2000L
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val statsExecutor = Executors.newSingleThreadExecutor()
    private var shownSession: SessionRequest? = null
    private var lastTraffic: Pair<Long, Long>? = null
    private var lastTrafficAt = 0L
    private var foreground = false

    private val speedRefresh = object : Runnable {
        override fun run() {
            val request = shownSession ?: return
            if (statsExecutor.isShutdown) return
            statsExecutor.execute {
                val traffic = CoreRuntime.traffic()
                val now = System.currentTimeMillis()
                val previous = lastTraffic
                val seconds = (now - lastTrafficAt).coerceAtLeast(1) / 1000.0
                val speed = if (previous == null) null else
                    ((traffic.first - previous.first) / seconds).toLong() to
                        ((traffic.second - previous.second) / seconds).toLong()
                lastTraffic = traffic
                lastTrafficAt = now
                mainHandler.post {
                    if (shownSession === request) notify(buildNotification(request, speed))
                }
            }
            mainHandler.postDelayed(this, SPEED_REFRESH_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        CoreRuntime.init(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                CoreRuntime.stopByUser()
                return START_NOT_STICKY
            }
            ACTION_START -> {
                enterForeground(buildPlaceholderNotification())
                CoreRuntime.onServiceStarted(this)
            }
            else -> {
                // Always-on VPN (at boot, or after the user picked this app
                // in the system VPN settings) starts the service without our
                // action: bring the last session back, or quit if there is none.
                enterForeground(buildPlaceholderNotification())
                if (CoreRuntime.isIdle) {
                    Log.i(TAG, "Started by the system; restoring the last session")
                    if (!CoreRuntime.startLastSession(this, StartOrigin.ALWAYS_ON)) {
                        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
                        foreground = false
                        stopSelf()
                    }
                }
            }
        }
        return START_NOT_STICKY
    }

    override fun onRevoke() {
        Log.i(TAG, "VPN revoked")
        CoreRuntime.onRevoked()
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(speedRefresh)
        statsExecutor.shutdownNow()
        CoreRuntime.onServiceDestroyed(this)
        super.onDestroy()
    }

    fun establishTunnel(vpn: VpnOptions, sessionName: String): ParcelFileDescriptor? {
        val builder = Builder()
            .setSession(sessionName)
            .setMtu(vpn.mtu)
            .addAddress(vpn.ipv4Address, vpn.ipv4Prefix)
            .addRoute("0.0.0.0", 0)
            .setConfigureIntent(openAppIntent())
        vpn.ipv6Address?.let { address ->
            builder.addAddress(address, vpn.ipv6Prefix).addRoute("::", 0)
        }
        vpn.dnsServers.forEach { builder.addDnsServer(it) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) builder.setMetered(false)

        // This app's own sockets (Xray's outbounds, probes, subscription
        // fetches) must never enter its own tunnel.
        val allowed = vpn.allowedApps.filter { it != packageName && isInstalled(it) }
        if (allowed.isNotEmpty()) {
            allowed.forEach { builder.addAllowedApplication(it) }
        } else {
            builder.addDisallowedApplication(packageName)
            vpn.disallowedApps
                .filter { it != packageName && isInstalled(it) }
                .forEach { builder.addDisallowedApplication(it) }
        }
        return builder.establish()
    }

    private fun isInstalled(packageName: String): Boolean = try {
        packageManager.getApplicationInfo(packageName, 0)
        true
    } catch (_: PackageManager.NameNotFoundException) {
        false
    }

    /** Called on the core thread once a session runs. */
    fun showSession(request: SessionRequest) {
        mainHandler.post {
            shownSession = request
            lastTraffic = null
            ensureChannel(request.text.channelName)
            enterForeground(buildNotification(request, null))
            mainHandler.removeCallbacks(speedRefresh)
            mainHandler.postDelayed(speedRefresh, SPEED_REFRESH_MS)
        }
    }

    fun shutdown() {
        mainHandler.post {
            shownSession = null
            mainHandler.removeCallbacks(speedRefresh)
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            foreground = false
            stopSelf()
        }
    }

    private fun enterForeground(notification: Notification) {
        if (foreground) {
            notify(notification)
            return
        }
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
        foreground = true
    }

    private fun notify(notification: Notification) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
    }

    private fun ensureChannel(name: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW)
        channel.setShowBadge(false)
        manager.createNotificationChannel(channel)
    }

    private fun buildPlaceholderNotification(): Notification {
        ensureChannel("VPN")
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_vpn)
            .setContentTitle(getString(R.string.app_name))
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openAppIntent())
            .build()
    }

    private fun buildNotification(request: SessionRequest, speed: Pair<Long, Long>?): Notification {
        val summary = if (request.isTun) request.text.connected else request.text.proxyOnly
        val text = if (speed == null) summary else
            "$summary · ↑ ${formatRate(speed.first)} ↓ ${formatRate(speed.second)}"
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, UltimaVpnService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_vpn)
            .setContentTitle(request.sessionName)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openAppIntent())
            .addAction(0, request.text.disconnect, stopIntent)
            .build()
    }

    private fun openAppIntent(): PendingIntent = PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun formatRate(bytesPerSecond: Long): String {
        val value = bytesPerSecond.coerceAtLeast(0).toDouble()
        return when {
            value >= 1024 * 1024 -> String.format(Locale.ROOT, "%.1f MB/s", value / (1024 * 1024))
            value >= 1024 -> String.format(Locale.ROOT, "%.0f KB/s", value / 1024)
            else -> String.format(Locale.ROOT, "%.0f B/s", value)
        }
    }
}
