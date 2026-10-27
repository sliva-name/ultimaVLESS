package com.ultima.vless.util

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Self-update for sideloaded installs: the APK from a GitHub release. */
object Updates {
    private const val TIMEOUT_MS = 30_000
    private const val PROGRESS_INTERVAL_MS = 500L

    private fun updatesDir(context: Context) = File(context.cacheDir, "updates")

    fun download(
        context: Context,
        url: String,
        fileName: String,
        onProgress: (percent: Double, bytesPerSecond: Long) -> Unit,
    ): File {
        require(url.startsWith("https://")) { "Updates are downloaded over HTTPS only" }
        val safeName = fileName.replace(Regex("[^A-Za-z0-9._-]"), "_")
        require(safeName.endsWith(".apk")) { "Not an APK: $fileName" }
        val dir = updatesDir(context)
        dir.deleteRecursively()
        dir.mkdirs()
        val target = File(dir, safeName)
        val partial = File(dir, "$safeName.part")

        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.instanceFollowRedirects = true
            connection.setRequestProperty("User-Agent", "UltimaVLESS-Android")
            if (connection.responseCode != 200) {
                throw IOException("Download failed: HTTP ${connection.responseCode}")
            }
            val total = connection.contentLengthLong
            val startedAt = System.currentTimeMillis()
            var reported = 0L
            var received = 0L
            connection.inputStream.use { input ->
                partial.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        received += read
                        val now = System.currentTimeMillis()
                        if (now - reported >= PROGRESS_INTERVAL_MS) {
                            reported = now
                            val elapsed = ((now - startedAt) / 1000.0).coerceAtLeast(0.001)
                            val percent = if (total > 0) received * 100.0 / total else 0.0
                            onProgress(percent, (received / elapsed).toLong())
                        }
                    }
                }
            }
            if (total > 0 && received != total) throw IOException("Download was cut short")
        } finally {
            connection.disconnect()
        }
        if (!partial.renameTo(target)) throw IOException("Could not save the update")
        onProgress(100.0, 0)
        return target
    }

    /**
     * Hands the APK to the package installer. Android first asks the user to
     * allow installs from this app once; the installer then asks to update.
     */
    fun install(context: Context, path: String) {
        val file = File(path)
        require(file.canonicalPath.startsWith(updatesDir(context).canonicalPath)) {
            "Not a downloaded update: $path"
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !context.packageManager.canRequestPackageInstalls()
        ) {
            context.startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${context.packageName}"),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            throw IllegalStateException("Allow UltimaVLESS to install apps, then tap install again")
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        context.startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}
