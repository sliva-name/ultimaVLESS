package com.ultima.vless

import android.os.Bundle
import androidx.activity.OnBackPressedCallback
import com.getcapacitor.BridgeActivity
import com.ultima.vless.plugin.UltimaCorePlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(UltimaCorePlugin::class.java)
        super.onCreate(savedInstanceState)
        // Screens are WebView history entries (`useMobileNav`), and Capacitor
        // leaves back to the system: walk them back before leaving the app.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val webView = bridge?.webView
                if (webView != null && webView.canGoBack()) {
                    webView.goBack()
                    return
                }
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
                isEnabled = true
            }
        })
    }
}
