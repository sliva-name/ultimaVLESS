package com.ultima.vless.core

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import com.ultima.vless.MainActivity
import com.ultima.vless.util.AppFiles

/**
 * Quick-settings tile: connects to the last server in the last mode, or
 * disconnects. Without VPN consent or a previous session it opens the app.
 */
class QuickTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        val tile = qsTile ?: return
        val session = CoreRuntime.session
        tile.state = if (session != null) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = session?.sessionName
        }
        tile.updateTile()
    }

    override fun onClick() {
        super.onClick()
        if (CoreRuntime.isRunning) {
            CoreRuntime.stopByUser()
            return
        }
        val needsApp = VpnService.prepare(this) != null || AppFiles.readLastSession(this) == null
        if (needsApp || !CoreRuntime.startLastSession(applicationContext, StartOrigin.TILE)) {
            openApp()
        }
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    private fun openApp() {
        val intent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startActivityAndCollapse(
                PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE),
            )
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }
}
