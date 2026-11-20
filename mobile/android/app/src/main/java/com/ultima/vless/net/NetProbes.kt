package com.ultima.vless.net

import android.net.LocalSocket
import android.net.LocalSocketAddress
import android.util.Base64
import java.io.BufferedInputStream
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

    /**
     * A GET sent, as to an HTTP proxy, to the Xray inbound listening on the
     * Unix socket at [path]; returns the response's status code. The socket
     * lives in the app's private files, so this is the one way in that other
     * apps cannot use (`platform/coreProbe.ts`).
     */
    fun httpViaUnixSocket(path: String, url: String, timeoutMs: Int): Int {
        val target = URL(url)
        if (target.protocol != "http") {
            throw ProbeException("Unsupported URL scheme: ${target.protocol}", "EPROTO")
        }
        val host = if (target.port == -1) target.host else "${target.host}:${target.port}"
        LocalSocket().use { socket ->
            socket.connect(LocalSocketAddress(path, LocalSocketAddress.Namespace.FILESYSTEM))
            socket.soTimeout = timeoutMs
            val request = "GET $target HTTP/1.1\r\nHost: $host\r\n" +
                "User-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n"
            socket.outputStream.write(request.toByteArray(Charsets.ISO_8859_1))
            socket.outputStream.flush()
            val statusLine = socket.inputStream.bufferedReader(Charsets.ISO_8859_1).readLine()
                ?: throw ProbeException("The probe socket closed without an answer", "ECONNRESET")
            return statusLine.split(' ').getOrNull(1)?.toIntOrNull()
                ?: throw ProbeException("Not an HTTP status line: $statusLine", "EPROTO")
        }
    }

    /**
     * Real delay through a probe core's HTTP inbound on 127.0.0.1:[proxyPort]
     * (`RealDelayService.ts` `measureTunnelDelay` on desktop): one CONNECT,
     * then two GETs of the plain-HTTP [url] over that tunnel.
     *
     * The first GET pays for the proxy's own handshake and proves the server
     * passes traffic; the second is the round trip a connected app sees.
     * Returns the second in ms, the first when the target will not keep the
     * connection open or the second fails, and null when the first fails.
     */
    fun tunnelDelay(proxyPort: Int, user: String, pass: String, url: String, timeoutMs: Int): Long? {
        val target = URL(url)
        if (target.protocol != "http") {
            throw ProbeException("Unsupported URL scheme: ${target.protocol}", "EPROTO")
        }
        val authority = "${target.host}:${if (target.port == -1) 80 else target.port}"
        val hostHeader = if (target.port == -1) target.host else authority
        val path = target.file.ifEmpty { "/" }
        val login = Base64.encodeToString("$user:$pass".toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
        val get = "GET $path HTTP/1.1\r\nHost: $hostHeader\r\n" +
            "User-Agent: Mozilla/5.0\r\nAccept: */*\r\n\r\n"
        val deadline = System.nanoTime() + timeoutMs * 1_000_000L

        Socket().use { socket ->
            socket.connect(InetSocketAddress("127.0.0.1", proxyPort), timeoutMs)
            socket.tcpNoDelay = true
            val input = BufferedInputStream(socket.inputStream)
            val output = socket.outputStream

            fun exchange(request: String): Pair<ResponseHead, Long> {
                val left = (deadline - System.nanoTime()) / 1_000_000L
                if (left <= 0) throw SocketTimeoutException("Delay test ran out of time")
                socket.soTimeout = left.toInt()
                val startedAt = System.nanoTime()
                output.write(request.toByteArray(Charsets.ISO_8859_1))
                output.flush()
                val head = parseResponseHead(readHead(input))
                return head to maxOf(1L, (System.nanoTime() - startedAt) / 1_000_000L)
            }

            // Xray answers CONNECT before dialing out; 407 means a wrong login.
            val (tunnel, _) = exchange(
                "CONNECT $authority HTTP/1.1\r\nHost: $authority\r\n" +
                    "Proxy-Authorization: Basic $login\r\n\r\n",
            )
            if (tunnel.status != 200) return null

            val (firstHead, first) = try {
                exchange(get)
            } catch (_: IOException) {
                return null
            }
            if (firstHead.status !in 200..399) return null
            if (!firstHead.reusable) return first

            return try {
                skipFully(input, firstHead.bodyLength)
                val (secondHead, second) = exchange(get)
                if (secondHead.status in 200..399) second else first
            } catch (_: IOException) {
                first
            }
        }
    }

    private class ResponseHead(val status: Int, val bodyLength: Long, val reusable: Boolean)

    private fun parseResponseHead(head: String): ResponseHead {
        val lines = head.split("\r\n")
        val statusLine = lines.firstOrNull() ?: ""
        val status = statusLine.split(' ').getOrNull(1)?.toIntOrNull() ?: 0
        var contentLength: Long? = null
        var reusable = statusLine.startsWith("HTTP/1.1 ", ignoreCase = true)
        for (line in lines.drop(1)) {
            val colon = line.indexOf(':')
            if (colon < 0) continue
            val name = line.substring(0, colon).trim().lowercase()
            val value = line.substring(colon + 1).trim().lowercase()
            when (name) {
                "content-length" -> contentLength = value.toLongOrNull()
                "connection" -> if (value.contains("close")) reusable = false
                "transfer-encoding" -> if (value != "identity") reusable = false
            }
        }
        val bodyless = status == 204 || status == 304 || status < 200
        // Without a length the body runs until the server closes the connection.
        if (!bodyless && contentLength == null) reusable = false
        return ResponseHead(status, if (bodyless) 0 else maxOf(0L, contentLength ?: 0L), reusable)
    }

    /** Reads up to and including the blank line that ends a response head. */
    private fun readHead(input: InputStream): String {
        val out = ByteArrayOutputStream()
        var matched = 0
        while (matched < 4) {
            val byte = input.read()
            if (byte < 0) throw ProbeException("The tunnel closed before a response", "ECONNRESET")
            out.write(byte)
            val expected = if (matched % 2 == 0) '\r'.code else '\n'.code
            matched = when {
                byte == expected -> matched + 1
                byte == '\r'.code -> 1
                else -> 0
            }
            if (out.size() > 16 * 1024) throw ProbeException("Response head too large", "EPROTO")
        }
        return out.toString(Charsets.ISO_8859_1.name()).removeSuffix("\r\n\r\n")
    }

    private fun skipFully(input: InputStream, count: Long) {
        var left = count
        while (left > 0) {
            val skipped = input.skip(left)
            if (skipped > 0) {
                left -= skipped
            } else if (input.read() < 0) {
                throw ProbeException("The tunnel closed inside a response body", "ECONNRESET")
            } else {
                left -= 1
            }
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
