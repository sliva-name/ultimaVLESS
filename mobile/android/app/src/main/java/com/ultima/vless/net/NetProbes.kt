package com.ultima.vless.net

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.NoRouteToHostException
import java.net.Proxy
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLException
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * Sockets behind the WebView's Node shims (`src/node/net.ts`, `tls.ts`,
 * `http.ts`, `dns.ts`). They run in the app process, which its own VPN
 * excludes, so they always take the direct path.
 */
object NetProbes {
    /** Error code in Node's style, for messages the desktop code already maps. */
    class ProbeException(message: String, val code: String) : IOException(message)

    fun errorCode(error: Throwable): String = when (error) {
        is ProbeException -> error.code
        is UnknownHostException -> "ENOTFOUND"
        is SocketTimeoutException -> "ETIMEDOUT"
        is ConnectException -> "ECONNREFUSED"
        is NoRouteToHostException -> "EHOSTUNREACH"
        is SSLException -> "ESSL"
        else -> "ENETWORK"
    }

    fun tcpConnect(host: String, port: Int, timeoutMs: Int) {
        Socket().use { socket -> socket.connect(InetSocketAddress(host, port), timeoutMs) }
    }

    /**
     * Completes a TLS handshake without checking the certificate: the ping
     * only asks whether TLS/REALITY answers on that SNI. No data is sent.
     */
    fun tlsHandshake(host: String, port: Int, sni: String, timeoutMs: Int) {
        val context = SSLContext.getInstance("TLS")
        context.init(null, arrayOf<TrustManager>(AcceptAnyCertificate), SecureRandom())
        Socket().use { raw ->
            raw.connect(InetSocketAddress(host, port), timeoutMs)
            raw.soTimeout = timeoutMs
            val socket = context.socketFactory.createSocket(raw, host, port, true) as SSLSocket
            socket.use {
                val name = sni.trim()
                if (name.isNotEmpty() && !looksLikeIp(name)) {
                    val parameters = it.sslParameters
                    parameters.serverNames = listOf(SNIHostName(name))
                    it.sslParameters = parameters
                }
                it.startHandshake()
            }
        }
    }

    private fun looksLikeIp(value: String): Boolean =
        value.contains(':') || value.all { it.isDigit() || it == '.' }

    private object AcceptAnyCertificate : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }

    data class HttpResult(
        val status: Int,
        val headers: Map<String, String>,
        val body: String,
        val truncated: Boolean,
    )

    /**
     * One HTTP(S) request with the platform's certificate checks. With
     * [proxyPort] it goes through Xray's local HTTP inbound on 127.0.0.1.
     */
    fun httpRequest(
        url: String,
        method: String,
        headers: Map<String, String>,
        timeoutMs: Int,
        proxyPort: Int?,
        followRedirects: Boolean,
        maxBodyBytes: Int,
    ): HttpResult {
        val target = URL(url)
        if (target.protocol != "http" && target.protocol != "https") {
            throw ProbeException("Unsupported URL scheme: ${target.protocol}", "EPROTO")
        }
        val proxy = proxyPort?.let { Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", it)) }
        val connection = (if (proxy != null) target.openConnection(proxy) else target.openConnection())
            as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = timeoutMs
            connection.readTimeout = timeoutMs
            connection.instanceFollowRedirects = followRedirects
            connection.useCaches = false
            headers.forEach { (key, value) -> connection.setRequestProperty(key, value) }
            val status = connection.responseCode
            val responseHeaders = connection.headerFields
                .filterKeys { it != null }
                .mapKeys { it.key.lowercase() }
                .mapValues { it.value.joinToString(", ") }
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val (body, truncated) = if (maxBodyBytes <= 0 || stream == null) {
                "" to false
            } else {
                readLimited(stream, maxBodyBytes)
            }
            return HttpResult(status, responseHeaders, body, truncated)
        } finally {
            connection.disconnect()
        }
    }

    private fun readLimited(stream: InputStream, limit: Int): Pair<String, Boolean> {
        stream.use { input ->
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(16 * 1024)
            while (out.size() < limit) {
                val read = input.read(buffer, 0, minOf(buffer.size, limit - out.size()))
                if (read < 0) return out.toString(Charsets.UTF_8.name()) to false
                out.write(buffer, 0, read)
            }
            val truncated = input.read() >= 0
            return out.toString(Charsets.UTF_8.name()) to truncated
        }
    }

    fun dnsLookup(hostname: String): List<Pair<String, Int>> = try {
        InetAddress.getAllByName(hostname).map { address ->
            val text = address.hostAddress?.substringBefore('%') ?: ""
            text to if (address is Inet4Address) 4 else 6
        }
    } catch (_: UnknownHostException) {
        emptyList()
    }

    data class InterfaceAddress(val address: String, val family: String, val internal: Boolean)

    /**
     * `os.networkInterfaces()` for the WebView: up interfaces and their
     * addresses, leaving out VPN tunnels (this app's own included).
     */
    fun networkInterfaces(): Map<String, List<InterfaceAddress>> {
        val result = linkedMapOf<String, List<InterfaceAddress>>()
        val interfaces = NetworkInterface.getNetworkInterfaces() ?: return result
        for (networkInterface in interfaces) {
            if (!networkInterface.isUp || networkInterface.name.startsWith("tun")) continue
            val addresses = networkInterface.inetAddresses.toList().mapNotNull { address ->
                val text = address.hostAddress?.substringBefore('%') ?: return@mapNotNull null
                InterfaceAddress(
                    address = text,
                    family = if (address is Inet4Address) "IPv4" else "IPv6",
                    internal = address.isLoopbackAddress,
                )
            }
            if (addresses.isNotEmpty()) result[networkInterface.name] = addresses
        }
        return result
    }

    /** A free loopback port for a probe core's HTTP inbound. */
    fun allocatePort(): Int = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { it.localPort }
}
