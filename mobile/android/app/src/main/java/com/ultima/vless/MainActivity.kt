package com.ultima.vless

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import com.ultima.vless.plugin.UltimaCorePlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(UltimaCorePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
