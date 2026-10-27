package com.ultima.vless.util

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.io.RandomAccessFile

/**
 * App-private files: the WebView's settings document, the session the tile
 * restarts, and the logs (`app.log` written by the WebView, `xray.log`
 * written by the core itself).
 */
object AppFiles {
    private const val MAX_APP_LOG_BYTES = 5L * 1024 * 1024
    private const val MAX_XRAY_LOG_BYTES = 5L * 1024 * 1024
    private const val MAX_READ_BYTES = 1024 * 1024
    private val logLock = Any()

    private fun stateFile(context: Context) = AtomicFile(File(context.filesDir, "app-state.json"))

    private fun lastSessionFile(context: Context) = AtomicFile(File(context.filesDir, "last-session.json"))

    fun readState(context: Context): String? = readAtomic(stateFile(context))

    fun writeState(context: Context, json: String) = writeAtomic(stateFile(context), json)

    fun readLastSession(context: Context): String? = readAtomic(lastSessionFile(context))

    fun writeLastSession(context: Context, json: String) = writeAtomic(lastSessionFile(context), json)

    private fun readAtomic(file: AtomicFile): String? =
        if (file.baseFile.exists()) file.readFully().toString(Charsets.UTF_8) else null

    private fun writeAtomic(file: AtomicFile, text: String) {
        val stream = file.startWrite()
        try {
            stream.write(text.toByteArray(Charsets.UTF_8))
            file.finishWrite(stream)
        } catch (error: Exception) {
            file.failWrite(stream)
            throw error
        }
    }

    /** `app` → logs/app.log, `xray` → xray.log (the path the WebView puts in the config). */
    fun logFile(context: Context, name: String): File = when (name) {
        "xray" -> File(context.filesDir, "xray.log")
        "app" -> File(File(context.filesDir, "logs"), "app.log")
        else -> throw IllegalArgumentException("Unknown log: $name")
    }

    fun appendLog(context: Context, name: String, text: String) = synchronized(logLock) {
        val file = logFile(context, name)
        file.parentFile?.mkdirs()
        if (file.length() > MAX_APP_LOG_BYTES) rotate(file)
        file.appendText(text, Charsets.UTF_8)
    }

    /** Keeps one previous session's app log, as desktop keeps its backups. */
    fun startAppLogSession(context: Context) = synchronized(logLock) {
        val file = logFile(context, "app")
        if (file.exists() && file.length() > 0) rotate(file)
    }

    /** Xray appends to its log forever; start over when it grows too large. */
    fun trimXrayLog(context: Context) = synchronized(logLock) {
        val file = logFile(context, "xray")
        if (file.length() > MAX_XRAY_LOG_BYTES) rotate(file)
    }

    private fun rotate(file: File) {
        val backup = File(file.path + ".1")
        backup.delete()
        file.renameTo(backup)
    }

    fun logSize(context: Context, name: String): Long = logFile(context, name).length()

    data class LogChunk(val text: String, val size: Long, val start: Long)

    fun readLog(context: Context, name: String, offset: Long, maxBytes: Int): LogChunk {
        val file = logFile(context, name)
        if (!file.exists()) return LogChunk("", 0, 0)
        RandomAccessFile(file, "r").use { input ->
            val size = input.length()
            val start = offset.coerceIn(0, size)
            val length = minOf((size - start).toInt(), maxBytes.coerceIn(0, MAX_READ_BYTES))
            val buffer = ByteArray(length)
            input.seek(start)
            input.readFully(buffer)
            return LogChunk(String(buffer, Charsets.UTF_8), size, start)
        }
    }
}
