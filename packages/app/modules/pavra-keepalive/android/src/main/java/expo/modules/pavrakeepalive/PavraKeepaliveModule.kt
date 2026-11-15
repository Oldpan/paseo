package expo.modules.pavrakeepalive

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

class PavraKeepaliveModule : Module() {
  private val downloadScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val cancelRequested = AtomicBoolean(false)
  private val downloadActive = AtomicBoolean(false)
  private val activeConnection = AtomicReference<HttpURLConnection?>(null)

  override fun definition() = ModuleDefinition {
    Name("PavraKeepalive")

    Events(EVENT_DOWNLOAD_PROGRESS)

    OnDestroy {
      cancelRequested.set(true)
      try {
        activeConnection.getAndSet(null)?.disconnect()
      } catch (_: Throwable) {
      }
      downloadScope.cancel()
    }

    Function("startKeepalive") { title: String, body: String ->
      val context = appContext.reactContext?.applicationContext ?: return@Function false
      val intent = Intent(context, PavraKeepaliveService::class.java).apply {
        putExtra(PavraKeepaliveService.EXTRA_TITLE, title)
        putExtra(PavraKeepaliveService.EXTRA_BODY, body)
      }
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
        true
      } catch (_: Throwable) {
        false
      }
    }

    Function("stopKeepalive") {
      val context = appContext.reactContext?.applicationContext ?: return@Function false
      val intent = Intent(context, PavraKeepaliveService::class.java)
      try {
        context.stopService(intent)
        true
      } catch (_: Throwable) {
        false
      }
    }

    AsyncFunction("getInstalledApkInfoAsync") {
      val context = requireAppContext()
      val pkgInfo = getInstalledPackageInfo(context)
      val versionCode = getPackageVersionCode(pkgInfo)
      mapOf(
        "versionName" to (pkgInfo.versionName ?: "0.0.0"),
        "versionCode" to versionCode,
        "packageName" to context.packageName,
        "sourceDir" to (pkgInfo.applicationInfo?.sourceDir ?: context.applicationInfo?.sourceDir ?: "")
      )
    }

    AsyncFunction("cleanupApkCacheAsync") {
      val context = requireAppContext()
      val updatesDir = File(context.cacheDir, UPDATES_DIR_NAME)
      if (!updatesDir.exists() || !updatesDir.isDirectory) {
        return@AsyncFunction true
      }
      val installedInfo = try {
        getInstalledPackageInfo(context)
      } catch (_: Throwable) {
        null
      }
      val installedVersionCode = installedInfo?.let { getPackageVersionCode(it) } ?: -1L
      val installedVersionName = installedInfo?.versionName
      val isBusy = downloadActive.get()

      val files = updatesDir.listFiles() ?: emptyArray()
      val nowMs = System.currentTimeMillis()
      for (file in files) {
        if (!file.isFile) continue
        val isStaleFile = nowMs - file.lastModified() > 7L * 24L * 3600_000L
        if (file.name.endsWith(".part")) {
          if (!isBusy && isStaleFile) {
            try {
              file.delete()
            } catch (_: Throwable) {
            }
          }
          continue
        }
        if (file.name.endsWith(".apk")) {
          val archiveInfo = getArchivePackageInfo(context, file.absolutePath)
          val archiveVersionCode = archiveInfo?.let { getPackageVersionCode(it) } ?: -1L
          val shouldDelete = !isBusy && (
            isStaleFile ||
              archiveInfo == null ||
              archiveInfo.packageName != context.packageName ||
              (installedVersionCode > 0L && archiveVersionCode in 1L..installedVersionCode) ||
              (installedVersionName != null && archiveInfo.versionName == installedVersionName)
            )
          if (shouldDelete) {
            try {
              file.delete()
            } catch (_: Throwable) {
            }
          }
        } else if (!isBusy) {
          try {
            file.delete()
          } catch (_: Throwable) {
          }
        }
      }
      true
    }

    AsyncFunction("canRequestPackageInstallsAsync") {
      val context = requireAppContext()
      canRequestPackageInstalls(context)
    }

    AsyncFunction("openUnknownAppSourcesSettingsAsync") {
      val context = requireAppContext()
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(
          Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:${context.packageName}")
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      } else {
        Intent(Settings.ACTION_SECURITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      try {
        context.startActivity(intent)
      } catch (_: Throwable) {
        val fallback = Intent(Settings.ACTION_SECURITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(fallback)
      }
      true
    }

    AsyncFunction("cancelApkDownloadAsync") {
      cancelRequested.set(true)
      try {
        activeConnection.getAndSet(null)?.disconnect()
      } catch (_: Throwable) {
      }
      true
    }

    AsyncFunction("downloadAndVerifyApkAsync") { url: String, expectedSha256: String?, expectedSize: Double? ->
      val context = requireAppContext()
      downloadAndVerifyApk(context, url, expectedSha256, expectedSize)
    }.runOnQueue(downloadScope)

    AsyncFunction("installApkSessionAsync") { filePath: String ->
      val context = requireAppContext()
      installApkSession(context, filePath)
    }.runOnQueue(downloadScope)
  }

  private fun requireAppContext(): Context {
    return appContext.reactContext?.applicationContext
      ?: throw CodedException("ERR_NO_CONTEXT", "ERR_NO_CONTEXT: Application context unavailable", null)
  }

  private fun canRequestPackageInstalls(context: Context): Boolean {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
      context.packageManager.canRequestPackageInstalls()
  }

  private fun getInstalledPackageInfo(context: Context): PackageInfo {
    val pm = context.packageManager
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      pm.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
    } else {
      @Suppress("DEPRECATION")
      pm.getPackageInfo(context.packageName, 0)
    }
  }

  private fun getArchivePackageInfo(context: Context, archivePath: String): PackageInfo? {
    val pm = context.packageManager
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        pm.getPackageArchiveInfo(archivePath, PackageManager.PackageInfoFlags.of(0))
      } else {
        @Suppress("DEPRECATION")
        pm.getPackageArchiveInfo(archivePath, 0)
      }
    } catch (_: Throwable) {
      null
    }
  }

  private fun getPackageVersionCode(pkgInfo: PackageInfo): Long {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      pkgInfo.longVersionCode
    } else {
      @Suppress("DEPRECATION")
      pkgInfo.versionCode.toLong()
    }
  }

  private fun emitDownloadProgress(receivedBytes: Long, totalBytes: Long) {
    val validTotal = if (totalBytes > 0L) totalBytes else null
    val progressRatio = if (validTotal != null) {
      (receivedBytes.toDouble() / validTotal.toDouble()).coerceIn(0.0, 1.0)
    } else {
      null
    }
    try {
      sendEvent(
        EVENT_DOWNLOAD_PROGRESS,
        mapOf(
          "received" to receivedBytes,
          "total" to validTotal,
          "progress" to progressRatio
        )
      )
    } catch (_: Throwable) {
    }
  }

  private fun openConnectionWithRedirects(
    initialUrl: String,
    existingBytes: Long
  ): HttpURLConnection {
    var currentUrl = initialUrl
    var redirects = 0
    while (redirects <= MAX_REDIRECTS) {
      if (cancelRequested.get()) {
        throw CodedException("ERR_DOWNLOAD_CANCELLED", "ERR_DOWNLOAD_CANCELLED", null)
      }
      val connection = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
        instanceFollowRedirects = false
        connectTimeout = CONNECT_TIMEOUT_MS
        readTimeout = READ_TIMEOUT_MS
        requestMethod = "GET"
        setRequestProperty("Accept-Encoding", "identity")
        setRequestProperty("User-Agent", "Pavra-Android-Updater")
        if (existingBytes > 0L) {
          setRequestProperty("Range", "bytes=$existingBytes-")
        }
      }
      activeConnection.set(connection)
      connection.connect()

      val code = connection.responseCode
      if (
        code == HttpURLConnection.HTTP_MOVED_PERM ||
        code == HttpURLConnection.HTTP_MOVED_TEMP ||
        code == HttpURLConnection.HTTP_SEE_OTHER ||
        code == 307 ||
        code == 308
      ) {
        val location = connection.getHeaderField("Location")
        connection.disconnect()
        if (location.isNullOrBlank()) {
          throw CodedException("ERR_DOWNLOAD_REDIRECT", "ERR_DOWNLOAD_REDIRECT: Redirect missing Location header", null)
        }
        currentUrl = URL(URL(currentUrl), location).toString()
        redirects += 1
        continue
      }
      return connection
    }
    throw CodedException("ERR_DOWNLOAD_REDIRECT", "ERR_DOWNLOAD_REDIRECT: Too many redirects", null)
  }

  private fun downloadAndVerifyApk(
    context: Context,
    url: String,
    expectedSha256: String?,
    expectedSize: Double?
  ): Map<String, Any> {
    val trimmedUrl = url.trim()
    if (trimmedUrl.isEmpty()) {
      throw CodedException("ERR_INVALID_URL", "ERR_INVALID_URL: Download URL is empty", null)
    }

    val updatesDir = File(context.cacheDir, UPDATES_DIR_NAME)
    if (!updatesDir.exists() && !updatesDir.mkdirs()) {
      throw CodedException("ERR_CACHE_DIR", "ERR_CACHE_DIR: Failed to create updates directory", null)
    }

    val partFile = File(updatesDir, PART_FILE_NAME)
    val finalFile = File(updatesDir, FINAL_FILE_NAME)
    val expectedSizeBytes = expectedSize?.toLong()?.takeIf { it > 0L }

    cancelRequested.set(false)
    downloadActive.set(true)

    try {
      if (partFile.exists() && expectedSizeBytes != null && partFile.length() > expectedSizeBytes) {
        partFile.delete()
      }

      val existingBytes = if (partFile.exists()) partFile.length() else 0L
      val alreadyCompleteOnDisk =
        existingBytes > 0L && expectedSizeBytes != null && existingBytes == expectedSizeBytes

      if (!alreadyCompleteOnDisk) {
        val connection = openConnectionWithRedirects(trimmedUrl, existingBytes)
        try {
          val responseCode = connection.responseCode
          if (responseCode == 416 && existingBytes > 0L && expectedSizeBytes != null && existingBytes == expectedSizeBytes) {
            // .part file already holds the complete payload
          } else if (responseCode == HttpURLConnection.HTTP_PARTIAL || responseCode == HttpURLConnection.HTTP_OK) {
            val contentType = connection.contentType?.lowercase(Locale.US) ?: ""
            if (contentType.startsWith("text/html")) {
              throw CodedException(
                "ERR_INVALID_CONTENT_TYPE",
                "ERR_INVALID_CONTENT_TYPE: Expected binary APK but received $contentType",
                null
              )
            }
            val isResume = responseCode == HttpURLConnection.HTTP_PARTIAL && existingBytes > 0L
            val initialBytes = if (isResume) existingBytes else 0L
            val contentLength = connection.contentLengthLong
            val totalBytes = when {
              contentLength > 0L -> if (isResume) initialBytes + contentLength else contentLength
              expectedSizeBytes != null -> expectedSizeBytes
              else -> -1L
            }

            var receivedBytes = initialBytes
            var lastEmitMs = 0L
            emitDownloadProgress(receivedBytes, totalBytes)

            connection.inputStream.use { input ->
              FileOutputStream(partFile, isResume).use { output ->
                val buffer = ByteArray(BUFFER_SIZE)
                while (true) {
                  if (cancelRequested.get()) {
                    throw CodedException("ERR_DOWNLOAD_CANCELLED", "ERR_DOWNLOAD_CANCELLED", null)
                  }
                  val read = input.read(buffer)
                  if (read < 0) break
                  if (cancelRequested.get()) {
                    throw CodedException("ERR_DOWNLOAD_CANCELLED", "ERR_DOWNLOAD_CANCELLED", null)
                  }
                  if (read > 0) {
                    output.write(buffer, 0, read)
                    receivedBytes += read
                    val now = SystemClock.elapsedRealtime()
                    if (now - lastEmitMs >= PROGRESS_EMIT_INTERVAL_MS) {
                      lastEmitMs = now
                      emitDownloadProgress(receivedBytes, totalBytes)
                    }
                  }
                }
                output.flush()
                try {
                  output.fd.sync()
                } catch (_: Throwable) {
                }
              }
            }

            if (cancelRequested.get()) {
              throw CodedException("ERR_DOWNLOAD_CANCELLED", "ERR_DOWNLOAD_CANCELLED", null)
            }
            emitDownloadProgress(receivedBytes, if (totalBytes > 0L) totalBytes else receivedBytes)
          } else {
            if (responseCode == 416) {
              partFile.delete()
            }
            throw CodedException(
              "ERR_DOWNLOAD_FAILED",
              "ERR_DOWNLOAD_FAILED: HTTP $responseCode",
              null
            )
          }
        } finally {
          try {
            connection.disconnect()
          } catch (_: Throwable) {
          }
          activeConnection.compareAndSet(connection, null)
        }
      } else {
        emitDownloadProgress(existingBytes, existingBytes)
      }

      if (cancelRequested.get()) {
        throw CodedException("ERR_DOWNLOAD_CANCELLED", "ERR_DOWNLOAD_CANCELLED", null)
      }

      if (!partFile.exists() || partFile.length() <= 0L) {
        partFile.delete()
        throw CodedException("ERR_DOWNLOAD_EMPTY", "ERR_DOWNLOAD_EMPTY: Downloaded APK file is empty", null)
      }

      val actualSha256 = computeSha256Hex(partFile)
      val normalizedExpectedSha256 = expectedSha256?.trim()?.lowercase(Locale.ROOT)?.takeIf { it.isNotEmpty() }
      if (normalizedExpectedSha256 != null && !actualSha256.equals(normalizedExpectedSha256, ignoreCase = true)) {
        partFile.delete()
        throw CodedException(
          "ERR_CHECKSUM_MISMATCH",
          "ERR_CHECKSUM_MISMATCH: expected $normalizedExpectedSha256, got $actualSha256",
          null
        )
      }

      val archiveInfo = getArchivePackageInfo(context, partFile.absolutePath)
      if (archiveInfo == null || archiveInfo.packageName != context.packageName) {
        partFile.delete()
        throw CodedException(
          "ERR_PACKAGE_MISMATCH",
          "ERR_PACKAGE_MISMATCH: expected ${context.packageName}, got ${archiveInfo?.packageName ?: "invalid"}",
          null
        )
      }

      if (finalFile.exists()) {
        finalFile.delete()
      }
      val renamed = partFile.renameTo(finalFile)
      if (!renamed) {
        partFile.copyTo(finalFile, overwrite = true)
        partFile.delete()
      }

      return mapOf(
        "filePath" to finalFile.absolutePath,
        "sha256" to actualSha256,
        "size" to finalFile.length()
      )
    } catch (err: Throwable) {
      if (cancelRequested.get() && err !is CodedException) {
        throw CodedException("ERR_DOWNLOAD_CANCELLED", "ERR_DOWNLOAD_CANCELLED", err)
      }
      throw err
    } finally {
      activeConnection.set(null)
      downloadActive.set(false)
    }
  }

  private fun computeSha256Hex(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buffer = ByteArray(BUFFER_SIZE)
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        if (read > 0) {
          digest.update(buffer, 0, read)
        }
      }
    }
    return digest.digest().joinToString("") { byte -> "%02x".format(Locale.ROOT, byte) }
  }

  private fun installApkSession(context: Context, filePath: String): Boolean {
    val updatesDir = File(context.cacheDir, UPDATES_DIR_NAME).canonicalFile
    val apkFile = File(filePath).canonicalFile
    val inUpdatesDir = apkFile.path.startsWith(updatesDir.path + File.separator)
    if (!inUpdatesDir || !apkFile.exists() || !apkFile.isFile) {
      throw CodedException(
        "ERR_APK_NOT_FOUND",
        "ERR_APK_NOT_FOUND: APK file must exist inside cache/updates",
        null
      )
    }

    if (!canRequestPackageInstalls(context)) {
      throw CodedException(
        "ERR_NEEDS_INSTALL_PERMISSION",
        "ERR_NEEDS_INSTALL_PERMISSION: Unknown app sources permission required",
        null
      )
    }

    val packageInstaller = context.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
      setAppPackageName(context.packageName)
      setSize(apkFile.length())
    }

    val sessionId = packageInstaller.createSession(params)
    val session = packageInstaller.openSession(sessionId)
    var committed = false
    try {
      session.openWrite("base.apk", 0, apkFile.length()).use { out ->
        FileInputStream(apkFile).use { input ->
          val buffer = ByteArray(BUFFER_SIZE)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            if (read > 0) {
              out.write(buffer, 0, read)
            }
          }
        }
        session.fsync(out)
      }

      PavraApkInstallReceiver.currentActivityRef = WeakReference(appContext.currentActivity)

      val commitIntent = Intent(context, PavraApkInstallReceiver::class.java).apply {
        action = PavraApkInstallReceiver.ACTION_INSTALL_COMMIT
        setPackage(context.packageName)
      }
      val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
      } else {
        PendingIntent.FLAG_UPDATE_CURRENT
      }
      val pendingIntent = PendingIntent.getBroadcast(
        context,
        sessionId,
        commitIntent,
        pendingIntentFlags
      )

      session.commit(pendingIntent.intentSender)
      committed = true
      return true
    } finally {
      if (!committed) {
        try {
          session.abandon()
        } catch (_: Throwable) {
        }
      }
      try {
        session.close()
      } catch (_: Throwable) {
      }
    }
  }

  companion object {
    const val EVENT_DOWNLOAD_PROGRESS = "onApkDownloadProgress"
    private const val UPDATES_DIR_NAME = "updates"
    private const val PART_FILE_NAME = "pavra-update.apk.part"
    private const val FINAL_FILE_NAME = "pavra-update.apk"
    private const val CONNECT_TIMEOUT_MS = 8_000
    private const val READ_TIMEOUT_MS = 20_000
    private const val PROGRESS_EMIT_INTERVAL_MS = 150L
    private const val BUFFER_SIZE = 32 * 1024
    private const val MAX_REDIRECTS = 8
  }
}

class PavraApkInstallReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent == null) return
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
    if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
      val confirmIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
      } else {
        @Suppress("DEPRECATION")
        intent.getParcelableExtra(Intent.EXTRA_INTENT) as? Intent
      }
      if (confirmIntent != null) {
        confirmIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val activity = currentActivityRef.get()?.takeIf { !it.isFinishing && !it.isDestroyed }
        try {
          if (activity != null) {
            activity.startActivity(confirmIntent)
          } else {
            context.startActivity(confirmIntent)
          }
        } catch (_: Throwable) {
          try {
            context.startActivity(confirmIntent)
          } catch (_: Throwable) {
          }
        }
      }
    }
  }

  companion object {
    const val ACTION_INSTALL_COMMIT = "expo.modules.pavrakeepalive.ACTION_INSTALL_COMMIT"
    @Volatile
    var currentActivityRef: WeakReference<Activity?> = WeakReference(null)
  }
}
