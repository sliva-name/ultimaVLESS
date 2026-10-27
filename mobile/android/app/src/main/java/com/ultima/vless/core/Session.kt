package com.ultima.vless.core

import org.json.JSONArray
import org.json.JSONObject

/** VpnService parameters; mirrors `VpnOptions` in `src/native/UltimaCore.ts`. */
data class VpnOptions(
    val mtu: Int,
    val ipv4Address: String,
    val ipv4Prefix: Int,
    val ipv6Address: String?,
    val ipv6Prefix: Int,
    val dnsServers: List<String>,
    val allowedApps: List<String>,
    val disallowedApps: List<String>,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("mtu", mtu)
        .put("ipv4Address", ipv4Address)
        .put("ipv4Prefix", ipv4Prefix)
        .put("ipv6Address", ipv6Address ?: JSONObject.NULL)
        .put("ipv6Prefix", ipv6Prefix)
        .put("dnsServers", JSONArray(dnsServers))
        .put("allowedApps", JSONArray(allowedApps))
        .put("disallowedApps", JSONArray(disallowedApps))

    companion object {
        fun fromJson(json: JSONObject) = VpnOptions(
            mtu = json.getInt("mtu"),
            ipv4Address = json.getString("ipv4Address"),
            ipv4Prefix = json.getInt("ipv4Prefix"),
            ipv6Address = json.optString("ipv6Address").takeIf {
                it.isNotEmpty() && !json.isNull("ipv6Address")
            },
            ipv6Prefix = json.optInt("ipv6Prefix", 126),
            dnsServers = json.optJSONArray("dnsServers").strings(),
            allowedApps = json.optJSONArray("allowedApps").strings(),
            disallowedApps = json.optJSONArray("disallowedApps").strings(),
        )
    }
}

/** Localized notification strings, supplied by the WebView. */
data class NotificationText(
    val channelName: String,
    val connected: String,
    val proxyOnly: String,
    val disconnect: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("channelName", channelName)
        .put("connected", connected)
        .put("proxyOnly", proxyOnly)
        .put("disconnect", disconnect)

    companion object {
        fun fromJson(json: JSONObject?) = NotificationText(
            channelName = json?.optString("channelName").orEmpty().ifEmpty { "VPN" },
            connected = json?.optString("connected").orEmpty().ifEmpty { "Connected" },
            proxyOnly = json?.optString("proxyOnly").orEmpty().ifEmpty { "Proxy" },
            disconnect = json?.optString("disconnect").orEmpty().ifEmpty { "Disconnect" },
        )
    }
}

/**
 * One core session as the WebView asked for it. The last one is kept on disk
 * so the quick-settings tile and Always-on VPN can bring it back without the
 * WebView.
 */
data class SessionRequest(
    val config: String,
    val mode: String,
    val serverId: String,
    val sessionName: String,
    val vpn: VpnOptions?,
    val text: NotificationText,
) {
    val isTun: Boolean get() = mode == MODE_TUN

    fun toJson(): JSONObject = JSONObject()
        .put("config", config)
        .put("mode", mode)
        .put("serverId", serverId)
        .put("sessionName", sessionName)
        .put("vpn", vpn?.toJson() ?: JSONObject.NULL)
        .put("text", text.toJson())

    companion object {
        const val MODE_TUN = "tun"
        const val MODE_PROXY = "proxy"

        fun fromJson(json: JSONObject): SessionRequest {
            val mode = json.getString("mode")
            require(mode == MODE_TUN || mode == MODE_PROXY) { "Unknown mode: $mode" }
            val vpn = json.optJSONObject("vpn")?.let(VpnOptions::fromJson)
            require(mode != MODE_TUN || vpn != null) { "VPN options are required in tun mode" }
            return SessionRequest(
                config = json.getString("config"),
                mode = mode,
                serverId = json.getString("serverId"),
                sessionName = json.optString("sessionName").ifEmpty { "UltimaVLESS" },
                vpn = vpn,
                text = NotificationText.fromJson(json.optJSONObject("text")),
            )
        }
    }
}

/** Who started a session; only sessions the WebView did not start are announced to it. */
enum class StartOrigin { APP, TILE, ALWAYS_ON }

sealed class CoreEvent {
    abstract fun toJson(): JSONObject

    /** `user`: notification or tile; `revoked`: another VPN took over; `error`: the core died. */
    data class Stopped(val reason: String, val message: String? = null) : CoreEvent() {
        override fun toJson(): JSONObject = JSONObject()
            .put("type", "stopped")
            .put("reason", reason)
            .apply { if (message != null) put("message", message) }
    }

    data class Started(val serverId: String, val mode: String) : CoreEvent() {
        override fun toJson(): JSONObject = JSONObject()
            .put("type", "started")
            .put("serverId", serverId)
            .put("mode", mode)
    }
}

internal fun JSONArray?.strings(): List<String> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { index -> optString(index).takeIf { it.isNotBlank() } }
}
