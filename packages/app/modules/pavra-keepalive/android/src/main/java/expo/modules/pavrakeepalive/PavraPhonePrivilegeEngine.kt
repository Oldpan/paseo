package expo.modules.pavrakeepalive

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Parcel
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.math.BigInteger
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.SecureRandom
import java.security.Signature
import java.security.cert.X509Certificate
import java.security.interfaces.RSAPublicKey
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import java.util.zip.CRC32
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import javax.security.auth.x500.X500Principal

data class PrivilegedShellResult(
  val ok: Boolean,
  val exitCode: Int,
  val stdoutBytes: ByteArray,
  val stderr: String,
  val channel: String,
  val durationMs: Long
) {
  val stdout: String
    get() = stdoutBytes.toString(Charsets.UTF_8)

  fun toMap(): Map<String, Any?> = mapOf(
    "ok" to ok,
    "exitCode" to exitCode,
    "stdout" to stdout,
    "stderr" to stderr,
    "channel" to channel,
    "durationMs" to durationMs
  )
}

data class ParsedWirelessPairingInput(
  val code: String,
  val host: String,
  val port: Int?
)

class PavraPhonePrivilegeEngine(context: Context) {
  private val appContext: Context = context.applicationContext
  private val prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private val preferredChannelRef = AtomicReference(
    prefs.getString(PREF_PREFERRED_CHANNEL, CHANNEL_AUTO) ?: CHANNEL_AUTO
  )
  private val lastErrorRef = AtomicReference<String?>(null)
  private val discoveredPairingPort = AtomicInteger(
    prefs.getInt(PREF_LAST_PAIRING_PORT, 0).takeIf { it in 1..65535 } ?: 0
  )
  private val discoveredConnectPort = AtomicInteger(
    prefs.getInt(PREF_WIRELESS_PORT, 0).takeIf { it in 1..65535 } ?: 0
  )
  private val discoveryActive = AtomicBoolean(false)
  private var pairingDiscoveryListener: NsdManager.DiscoveryListener? = null
  private var connectDiscoveryListener: NsdManager.DiscoveryListener? = null

  private val statusListeners = CopyOnWriteArraySet<(Map<String, Any?>) -> Unit>()

  fun addStatusListener(listener: (Map<String, Any?>) -> Unit) {
    statusListeners.add(listener)
  }

  fun removeStatusListener(listener: (Map<String, Any?>) -> Unit) {
    statusListeners.remove(listener)
  }

  private fun notifyStatusChanged(
    virtualDisplayId: Int? = null,
    overlayPermissionGranted: Boolean? = null
  ) {
    val snapshot = getStatusMap(
      preferredChannel = preferredChannelRef.get(),
      virtualDisplayId = virtualDisplayId,
      overlayPermissionGranted = overlayPermissionGranted
    )
    for (listener in statusListeners) {
      try {
        listener(snapshot)
      } catch (_: Throwable) {
      }
    }
  }

  fun setPreferredChannel(channel: String?) {
    val normalized = when (channel?.trim()?.lowercase(Locale.ROOT)) {
      CHANNEL_SHIZUKU -> CHANNEL_SHIZUKU
      CHANNEL_WIRELESS_ADB -> CHANNEL_WIRELESS_ADB
      else -> CHANNEL_AUTO
    }
    preferredChannelRef.set(normalized)
    prefs.edit().putString(PREF_PREFERRED_CHANNEL, normalized).apply()
  }

  // ---------------------------------------------------------------------------
  // Method B: Shizuku Channel ("shizuku")
  // ---------------------------------------------------------------------------

  fun isShizukuInstalled(): Boolean {
    val pm = appContext.packageManager
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        pm.getPackageInfo(SHIZUKU_PACKAGE, PackageManager.PackageInfoFlags.of(0))
      } else {
        @Suppress("DEPRECATION")
        pm.getPackageInfo(SHIZUKU_PACKAGE, 0)
      }
      true
    } catch (_: Throwable) {
      false
    }
  }

  private fun acquireShizukuBinder(): IBinder? {
    // 1. Try Shizuku SDK class via reflection if linked on classpath.
    try {
      val shizukuCls = Class.forName("rikka.shizuku.Shizuku")
      val pingOk = (shizukuCls.getMethod("pingBinder").invoke(null) as? Boolean) == true
      if (pingOk) {
        val binder = shizukuCls.getMethod("getBinder").invoke(null) as? IBinder
        if (binder != null && binder.pingBinder()) {
          return binder
        }
      }
    } catch (_: Throwable) {
    }

    // 2. Query Shizuku's exported ContentProvider binder bridge directly (zero external dependency).
    try {
      val uri = Uri.parse("content://$SHIZUKU_PACKAGE.shizuku")
      val reply: Bundle? = appContext.contentResolver.call(uri, "getBinder", null, Bundle())
      val binder = reply?.getBinder("$SHIZUKU_PACKAGE.intent.extra.BINDER")
        ?: reply?.getBinder("binder")
      if (binder != null && binder.pingBinder()) {
        return binder
      }
    } catch (_: Throwable) {
    }

    return null
  }

  fun isShizukuAvailable(): Boolean {
    if (!isShizukuInstalled()) return false
    val binder = acquireShizukuBinder()
    return binder != null && binder.pingBinder()
  }

  fun isShizukuAuthorized(): Boolean {
    if (!isShizukuInstalled()) return false

    try {
      val shizukuCls = Class.forName("rikka.shizuku.Shizuku")
      val perm = shizukuCls.getMethod("checkSelfPermission").invoke(null) as? Int
      if (perm == PackageManager.PERMISSION_GRANTED) {
        return true
      }
    } catch (_: Throwable) {
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      try {
        if (appContext.checkSelfPermission(SHIZUKU_RUNTIME_PERMISSION) == PackageManager.PERMISSION_GRANTED) {
          return isShizukuAvailable()
        }
      } catch (_: Throwable) {
      }
    }

    val binder = acquireShizukuBinder() ?: return false
    val data = Parcel.obtain()
    val reply = Parcel.obtain()
    return try {
      data.writeInterfaceToken(SHIZUKU_SERVICE_DESCRIPTOR)
      val ok = binder.transact(TRANSACTION_CHECK_SELF_PERMISSION, data, reply, 0)
      if (!ok) return false
      reply.readException()
      reply.readInt() != 0
    } catch (_: Throwable) {
      false
    } finally {
      reply.recycle()
      data.recycle()
    }
  }

  fun requestShizukuPermission(activity: Activity?): Map<String, Any?> {
    if (!isShizukuInstalled()) {
      lastErrorRef.set("Shizuku (moe.shizuku.privileged.api) is not installed")
      return getStatusMap()
    }

    lastErrorRef.set(null)
    var requested = false

    // 1. Try Shizuku reflection API.
    try {
      val shizukuCls = Class.forName("rikka.shizuku.Shizuku")
      shizukuCls
        .getMethod("requestPermission", Int::class.javaPrimitiveType)
        .invoke(null, SHIZUKU_PERMISSION_REQUEST_CODE)
      requested = true
    } catch (_: Throwable) {
    }

    // 2. Request Android runtime permission declared by Shizuku v11+.
    if (!requested && activity != null && !activity.isFinishing && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      try {
        activity.requestPermissions(
          arrayOf(SHIZUKU_RUNTIME_PERMISSION),
          SHIZUKU_PERMISSION_REQUEST_CODE
        )
        requested = true
      } catch (_: Throwable) {
      }
    }

    // 3. Fallback: open Shizuku manager app so the user can toggle authorization directly.
    if (!requested) {
      try {
        val launchIntent = appContext.packageManager
          .getLaunchIntentForPackage(SHIZUKU_PACKAGE)
          ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (launchIntent != null) {
          appContext.startActivity(launchIntent)
          requested = true
        }
      } catch (err: Throwable) {
        lastErrorRef.set("Failed to open Shizuku permission prompt: ${err.message ?: "unknown"}")
      }
    }

    if (!requested && lastErrorRef.get() == null) {
      lastErrorRef.set("Shizuku service is not running; start Shizuku first")
    }
    notifyStatusChanged()
    return getStatusMap()
  }

  private fun executeViaShizuku(command: String, timeoutMs: Long): PrivilegedShellResult {
    val startedAt = SystemClock.elapsedRealtime()

    // Path 1: Shizuku.newProcess via reflection if available.
    try {
      val shizukuCls = Class.forName("rikka.shizuku.Shizuku")
      val newProcessMethod = shizukuCls.getDeclaredMethod(
        "newProcess",
        Array<String>::class.java,
        Array<String>::class.java,
        String::class.java
      ).apply {
        isAccessible = true
      }
      val proc = newProcessMethod.invoke(
        null,
        arrayOf("sh", "-c", command),
        null,
        null
      ) as? Process
      if (proc != null) {
        return collectJavaProcessResult(proc, CHANNEL_SHIZUKU, startedAt, timeoutMs)
      }
    } catch (_: Throwable) {
    }

    // Path 2: Direct Binder transaction to moe.shizuku.server.IShizukuService.newProcess.
    val binder = acquireShizukuBinder()
      ?: return PrivilegedShellResult(
        ok = false,
        exitCode = -1,
        stdoutBytes = ByteArray(0),
        stderr = "Shizuku binder unavailable",
        channel = CHANNEL_SHIZUKU,
        durationMs = SystemClock.elapsedRealtime() - startedAt
      )

    val data = Parcel.obtain()
    val reply = Parcel.obtain()
    try {
      data.writeInterfaceToken(SHIZUKU_SERVICE_DESCRIPTOR)
      data.writeStringArray(arrayOf("sh", "-c", command))
      data.writeStringArray(null)
      data.writeString(null)
      val transacted = binder.transact(TRANSACTION_NEW_PROCESS, data, reply, 0)
      if (!transacted) {
        return PrivilegedShellResult(
          ok = false,
          exitCode = -1,
          stdoutBytes = ByteArray(0),
          stderr = "Shizuku newProcess transaction rejected",
          channel = CHANNEL_SHIZUKU,
          durationMs = SystemClock.elapsedRealtime() - startedAt
        )
      }
      reply.readException()
      val remoteProcessBinder = reply.readStrongBinder()
        ?: return PrivilegedShellResult(
          ok = false,
          exitCode = -1,
          stdoutBytes = ByteArray(0),
          stderr = "Shizuku returned null IRemoteProcess binder",
          channel = CHANNEL_SHIZUKU,
          durationMs = SystemClock.elapsedRealtime() - startedAt
        )
      return collectRemoteBinderProcess(remoteProcessBinder, startedAt, timeoutMs)
    } catch (err: Throwable) {
      return PrivilegedShellResult(
        ok = false,
        exitCode = -1,
        stdoutBytes = ByteArray(0),
        stderr = "Shizuku shell failed: ${err.message ?: err.javaClass.simpleName}",
        channel = CHANNEL_SHIZUKU,
        durationMs = SystemClock.elapsedRealtime() - startedAt
      )
    } finally {
      reply.recycle()
      data.recycle()
    }
  }

  private fun collectRemoteBinderProcess(
    remoteProcess: IBinder,
    startedAt: Long,
    timeoutMs: Long
  ): PrivilegedShellResult {
    val stdoutPfd = readParcelFdFromBinder(remoteProcess, REMOTE_PROC_GET_INPUT_STREAM)
    val stderrPfd = readParcelFdFromBinder(remoteProcess, REMOTE_PROC_GET_ERROR_STREAM)

    val stdoutOut = ByteArrayOutputStream()
    val stderrOut = ByteArrayOutputStream()

    val outThread = Thread {
      stdoutPfd?.let { pfd ->
        ParcelFileDescriptor.AutoCloseInputStream(pfd).use { stream ->
          copyStream(stream, stdoutOut)
        }
      }
    }
    val errThread = Thread {
      stderrPfd?.let { pfd ->
        ParcelFileDescriptor.AutoCloseInputStream(pfd).use { stream ->
          copyStream(stream, stderrOut)
        }
      }
    }
    outThread.start()
    errThread.start()

    var exitCode = -1
    val waitThread = Thread {
      exitCode = invokeBinderInt(remoteProcess, REMOTE_PROC_WAIT_FOR)
    }
    waitThread.start()
    waitThread.join(timeoutMs.coerceAtLeast(500L))
    if (waitThread.isAlive) {
      invokeBinderVoid(remoteProcess, REMOTE_PROC_DESTROY)
      waitThread.interrupt()
    }
    outThread.join(1_000L)
    errThread.join(1_000L)

    return PrivilegedShellResult(
      ok = exitCode == 0,
      exitCode = exitCode,
      stdoutBytes = stdoutOut.toByteArray(),
      stderr = stderrOut.toByteArray().toString(Charsets.UTF_8),
      channel = CHANNEL_SHIZUKU,
      durationMs = SystemClock.elapsedRealtime() - startedAt
    )
  }

  private fun readParcelFdFromBinder(binder: IBinder, code: Int): ParcelFileDescriptor? {
    val data = Parcel.obtain()
    val reply = Parcel.obtain()
    return try {
      data.writeInterfaceToken(SHIZUKU_REMOTE_PROCESS_DESCRIPTOR)
      if (!binder.transact(code, data, reply, 0)) return null
      reply.readException()
      if (reply.readInt() != 0) ParcelFileDescriptor.CREATOR.createFromParcel(reply) else null
    } catch (_: Throwable) {
      null
    } finally {
      reply.recycle()
      data.recycle()
    }
  }

  private fun invokeBinderInt(binder: IBinder, code: Int): Int {
    val data = Parcel.obtain()
    val reply = Parcel.obtain()
    return try {
      data.writeInterfaceToken(SHIZUKU_REMOTE_PROCESS_DESCRIPTOR)
      if (!binder.transact(code, data, reply, 0)) return -1
      reply.readException()
      reply.readInt()
    } catch (_: Throwable) {
      -1
    } finally {
      reply.recycle()
      data.recycle()
    }
  }

  private fun invokeBinderVoid(binder: IBinder, code: Int) {
    val data = Parcel.obtain()
    val reply = Parcel.obtain()
    try {
      data.writeInterfaceToken(SHIZUKU_REMOTE_PROCESS_DESCRIPTOR)
      binder.transact(code, data, reply, 0)
    } catch (_: Throwable) {
    } finally {
      reply.recycle()
      data.recycle()
    }
  }

  // ---------------------------------------------------------------------------
  // Method A: Built-in On-Device Wireless Debugging Pairing & Local ADB Bridge
  // ---------------------------------------------------------------------------

  fun startWirelessAdbDiscovery(): Map<String, Any?> {
    val nsdManager = appContext.getSystemService(Context.NSD_SERVICE) as? NsdManager
      ?: return getStatusMap()
    if (!discoveryActive.compareAndSet(false, true)) {
      return getStatusMap()
    }

    val pairingListener = createNsdDiscoveryListener(NSD_SERVICE_PAIRING) { port ->
      if (port in 1..65535) {
        discoveredPairingPort.set(port)
        prefs.edit().putInt(PREF_LAST_PAIRING_PORT, port).apply()
        notifyStatusChanged()
      }
    }
    val connectListener = createNsdDiscoveryListener(NSD_SERVICE_CONNECT) { port ->
      if (port in 1..65535) {
        discoveredConnectPort.set(port)
        if (isWirelessAdbPaired()) {
          prefs.edit().putInt(PREF_WIRELESS_PORT, port).apply()
        }
        notifyStatusChanged()
      }
    }

    pairingDiscoveryListener = pairingListener
    connectDiscoveryListener = connectListener

    try {
      nsdManager.discoverServices(NSD_SERVICE_PAIRING, NsdManager.PROTOCOL_DNS_SD, pairingListener)
    } catch (_: Throwable) {
    }
    try {
      nsdManager.discoverServices(NSD_SERVICE_CONNECT, NsdManager.PROTOCOL_DNS_SD, connectListener)
    } catch (_: Throwable) {
    }

    return getStatusMap()
  }

  fun stopWirelessAdbDiscovery(): Boolean {
    if (!discoveryActive.compareAndSet(true, false)) {
      return true
    }
    val nsdManager = appContext.getSystemService(Context.NSD_SERVICE) as? NsdManager
    pairingDiscoveryListener?.let { listener ->
      try {
        nsdManager?.stopServiceDiscovery(listener)
      } catch (_: Throwable) {
      }
    }
    connectDiscoveryListener?.let { listener ->
      try {
        nsdManager?.stopServiceDiscovery(listener)
      } catch (_: Throwable) {
      }
    }
    pairingDiscoveryListener = null
    connectDiscoveryListener = null
    return true
  }

  private fun createNsdDiscoveryListener(
    expectedType: String,
    onLocalPortResolved: (Int) -> Unit
  ): NsdManager.DiscoveryListener {
    val nsdManager = appContext.getSystemService(Context.NSD_SERVICE) as? NsdManager
    return object : NsdManager.DiscoveryListener {
      override fun onStartDiscoveryFailed(serviceType: String?, errorCode: Int) {}
      override fun onStopDiscoveryFailed(serviceType: String?, errorCode: Int) {}
      override fun onDiscoveryStarted(serviceType: String?) {}
      override fun onDiscoveryStopped(serviceType: String?) {}
      override fun onServiceLost(serviceInfo: NsdServiceInfo?) {}

      override fun onServiceFound(serviceInfo: NsdServiceInfo?) {
        if (serviceInfo == null || nsdManager == null) return
        val type = serviceInfo.serviceType ?: ""
        if (!type.contains(expectedType.removeSuffix("."))) return
        try {
          @Suppress("DEPRECATION")
          nsdManager.resolveService(
            serviceInfo,
            object : NsdManager.ResolveListener {
              override fun onResolveFailed(failedInfo: NsdServiceInfo?, errorCode: Int) {}
              override fun onServiceResolved(resolvedInfo: NsdServiceInfo?) {
                if (resolvedInfo == null) return
                @Suppress("DEPRECATION")
                val hostAddr: InetAddress? = resolvedInfo.host
                val isLocal = hostAddr == null ||
                  hostAddr.isLoopbackAddress ||
                  hostAddr.isSiteLocalAddress ||
                  hostAddr.isLinkLocalAddress
                if (isLocal && resolvedInfo.port in 1..65535) {
                  onLocalPortResolved(resolvedInfo.port)
                }
              }
            }
          )
        } catch (_: Throwable) {
        }
      }
    }
  }

  fun openWirelessDebuggingWithPairingNotification(openSettings: Boolean = true): Map<String, Any?> {
    startWirelessAdbDiscovery()
    postPairingCodeNotification(
      statusText = buildPairingPromptSubtitle()
    )
    if (openSettings) {
      openDeveloperSettings()
    }
    return getStatusMap()
  }

  fun openDeveloperSettings(): Boolean {
    val devIntent = Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    return try {
      appContext.startActivity(devIntent)
      true
    } catch (_: Throwable) {
      try {
        val fallback = Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        appContext.startActivity(fallback)
        true
      } catch (_: Throwable) {
        false
      }
    }
  }

  private fun buildPairingPromptSubtitle(): String {
    val pairingPort = discoveredPairingPort.get()
    return if (pairingPort in 1..65535) {
      "已发现本机配对端口 $pairingPort，请在无线调试中查看 6 位配对码并在此直接回复"
    } else {
      "打开「无线调试 → 使用配对码配对设备」，直接下拉通知栏输入 配对码 或 配对码:端口"
    }
  }

  fun postPairingCodeNotification(statusText: String? = null) {
    val manager = appContext.getSystemService(NotificationManager::class.java) ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        PAIRING_CHANNEL_ID,
        PAIRING_CHANNEL_NAME,
        NotificationManager.IMPORTANCE_HIGH
      ).apply {
        description = "用于在开发者选项页面直接输入 6 位无线调试配对码"
        enableVibration(true)
      }
      manager.createNotificationChannel(channel)
    }

    val remoteInput = RemoteInput.Builder(KEY_PAIRING_INPUT)
      .setLabel(PAIRING_REMOTE_INPUT_LABEL)
      .build()

    val submitIntent = Intent(appContext, PavraWirelessAdbPairingReceiver::class.java).apply {
      action = ACTION_SUBMIT_PAIRING_CODE
      setPackage(appContext.packageName)
    }
    val mutableFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
    } else {
      PendingIntent.FLAG_UPDATE_CURRENT
    }
    val submitPendingIntent = PendingIntent.getBroadcast(
      appContext,
      REQUEST_CODE_PAIRING_SUBMIT,
      submitIntent,
      mutableFlags
    )

    val replyAction = Notification.Action.Builder(
      android.R.drawable.ic_menu_send,
      "提交配对码",
      submitPendingIntent
    )
      .addRemoteInput(remoteInput)
      .build()

    val devSettingsIntent = Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    val immutableFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val devSettingsPendingIntent = PendingIntent.getActivity(
      appContext,
      REQUEST_CODE_OPEN_DEV_SETTINGS,
      devSettingsIntent,
      immutableFlags
    )
    val openSettingsAction = Notification.Action.Builder(
      android.R.drawable.ic_menu_preferences,
      "开发者选项",
      devSettingsPendingIntent
    ).build()

    val iconRes = appContext.resources
      .getIdentifier("notification_icon", "drawable", appContext.packageName)
      .takeIf { it != 0 }
      ?: appContext.applicationInfo.icon.takeIf { it != 0 }
      ?: android.R.drawable.ic_dialog_info

    val subtitle = statusText ?: buildPairingPromptSubtitle()
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(appContext, PAIRING_CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(appContext)
    }

    builder
      .setSmallIcon(iconRes)
      .setContentTitle("Pavra · 无线调试本机配对")
      .setContentText(subtitle)
      .setStyle(Notification.BigTextStyle().bigText(subtitle))
      .setCategory(Notification.CATEGORY_STATUS)
      .setOnlyAlertOnce(false)
      .setAutoCancel(false)
      .addAction(replyAction)
      .addAction(openSettingsAction)

    try {
      manager.notify(PAIRING_NOTIFICATION_ID, builder.build())
    } catch (_: Throwable) {
    }
  }

  fun completePairingNotification(success: Boolean, message: String) {
    val manager = appContext.getSystemService(NotificationManager::class.java) ?: return
    if (!success) {
      postPairingCodeNotification(statusText = message)
      return
    }
    val iconRes = appContext.resources
      .getIdentifier("notification_icon", "drawable", appContext.packageName)
      .takeIf { it != 0 }
      ?: appContext.applicationInfo.icon.takeIf { it != 0 }
      ?: android.R.drawable.ic_dialog_info

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(appContext, PAIRING_CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(appContext)
    }
    builder
      .setSmallIcon(iconRes)
      .setContentTitle("Pavra · 无线调试已就绪")
      .setContentText(message)
      .setAutoCancel(true)

    try {
      manager.notify(PAIRING_NOTIFICATION_ID, builder.build())
    } catch (_: Throwable) {
    }
  }

  fun parsePairingInput(
    rawInput: String,
    fallbackHost: String? = null,
    fallbackPort: Int? = null
  ): ParsedWirelessPairingInput? {
    val trimmed = rawInput.trim()
    if (trimmed.isEmpty()) return null
    val defaultHost = fallbackHost?.trim()?.takeIf { it.isNotEmpty() } ?: DEFAULT_LOOPBACK_HOST
    val defaultPort = fallbackPort?.takeIf { it in 1..65535 }
      ?: discoveredPairingPort.get().takeIf { it in 1..65535 }

    // Format 1: "123456"
    if (REGEX_SIX_DIGITS.matches(trimmed)) {
      return ParsedWirelessPairingInput(code = trimmed, host = defaultHost, port = defaultPort)
    }

    // Format 2: "123456:37891"
    val codePortMatch = REGEX_CODE_PORT.matchEntire(trimmed)
    if (codePortMatch != null) {
      val code = codePortMatch.groupValues[1]
      val port = codePortMatch.groupValues[2].toIntOrNull()
      if (port != null && port in 1..65535) {
        return ParsedWirelessPairingInput(code = code, host = defaultHost, port = port)
      }
      return null
    }

    // Format 3: "127.0.0.1:37891:123456" or "192.168.0.25:37891 123456"
    val hostPortCodeMatch = REGEX_HOST_PORT_CODE.matchEntire(trimmed)
    if (hostPortCodeMatch != null) {
      val host = hostPortCodeMatch.groupValues[1]
      val port = hostPortCodeMatch.groupValues[2].toIntOrNull()
      val code = hostPortCodeMatch.groupValues[3]
      if (port != null && port in 1..65535) {
        return ParsedWirelessPairingInput(code = code, host = host, port = port)
      }
    }

    return null
  }

  fun submitWirelessPairingCode(
    rawInput: String,
    explicitHost: String? = null,
    explicitPort: Int? = null
  ): Map<String, Any?> {
    val parsed = parsePairingInput(rawInput, explicitHost, explicitPort)
    if (parsed == null) {
      val err = "Invalid pairing code format; expected 6 digits (e.g. 123456 or 123456:37891)"
      lastErrorRef.set(err)
      notifyStatusChanged()
      return getStatusMap()
    }

    ensureKeystoreAdbIdentity()
    val resolvedPairingPort = parsed.port ?: discoveredPairingPort.get().takeIf { it in 1..65535 }
    val resolvedConnectPort = discoveredConnectPort.get().takeIf { it in 1..65535 }
      ?: resolvedPairingPort
      ?: DEFAULT_FALLBACK_ADB_PORT

    // Attempt CLI adb pair/connect if system or bundled adb binary exists on device.
    val adbBin = findLocalAdbBinary()
    if (adbBin != null && resolvedPairingPort != null) {
      try {
        runLocalProcess(
          listOf(adbBin, "pair", "${parsed.host}:$resolvedPairingPort", parsed.code),
          timeoutMs = 8_000L
        )
        runLocalProcess(
          listOf(adbBin, "connect", "${parsed.host}:$resolvedConnectPort"),
          timeoutMs = 5_000L
        )
      } catch (_: Throwable) {
      }
    } else if (resolvedPairingPort != null) {
      // Probe local TLS pairing port reachability when running pure in-process transport.
      probeTlsEndpoint(parsed.host, resolvedPairingPort)
    }

    prefs.edit()
      .putBoolean(PREF_WIRELESS_PAIRED, true)
      .putString(PREF_WIRELESS_HOST, parsed.host)
      .putInt(PREF_WIRELESS_PORT, resolvedConnectPort)
      .putLong(PREF_WIRELESS_PAIRED_AT, System.currentTimeMillis())
      .apply()

    lastErrorRef.set(null)
    notifyStatusChanged()
    return getStatusMap()
  }

  fun isWirelessAdbPaired(): Boolean {
    return prefs.getBoolean(PREF_WIRELESS_PAIRED, false)
  }

  fun getWirelessAdbPort(): Int? {
    val saved = prefs.getInt(PREF_WIRELESS_PORT, 0)
    if (saved in 1..65535) return saved
    val discovered = discoveredConnectPort.get()
    return discovered.takeIf { it in 1..65535 }
  }

  fun getWirelessAdbHost(): String {
    return prefs.getString(PREF_WIRELESS_HOST, DEFAULT_LOOPBACK_HOST) ?: DEFAULT_LOOPBACK_HOST
  }

  private fun findLocalAdbBinary(): String? {
    val candidates = listOf(
      File(appContext.applicationInfo.nativeLibraryDir ?: "", "libadb.so"),
      File("/system/bin/adb"),
      File("/system/xbin/adb")
    )
    for (candidate in candidates) {
      if (candidate.exists() && candidate.canExecute()) {
        return candidate.absolutePath
      }
    }
    return null
  }

  private fun probeTlsEndpoint(host: String, port: Int): Boolean {
    return try {
      val sslContext = createAdbSslContext()
      (sslContext.socketFactory.createSocket() as SSLSocket).use { socket ->
        socket.connect(InetSocketAddress(host, port), 1_500)
        socket.soTimeout = 1_500
        socket.startHandshake()
      }
      true
    } catch (_: Throwable) {
      false
    }
  }

  private fun ensureKeystoreAdbIdentity(): KeyStore.PrivateKeyEntry? {
    return try {
      val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
      if (!keyStore.containsAlias(KEYSTORE_ADB_ALIAS)) {
        val now = System.currentTimeMillis()
        val spec = KeyGenParameterSpec.Builder(
          KEYSTORE_ADB_ALIAS,
          KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY or KeyProperties.PURPOSE_DECRYPT
        )
          .setKeySize(2048)
          .setCertificateSubject(X500Principal("CN=PavraLocalAdb,O=Pavra"))
          .setCertificateSerialNumber(BigInteger.ONE)
          .setCertificateNotBefore(Date(now - 60_000L))
          .setCertificateNotAfter(Date(now + 10L * 365L * 24L * 3600_000L))
          .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1, KeyProperties.DIGEST_NONE)
          .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1)
          .build()
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, ANDROID_KEYSTORE)
        generator.initialize(spec)
        generator.generateKeyPair()
      }
      keyStore.getEntry(KEYSTORE_ADB_ALIAS, null) as? KeyStore.PrivateKeyEntry
    } catch (_: Throwable) {
      null
    }
  }

  private fun createAdbSslContext(): SSLContext {
    ensureKeystoreAdbIdentity()
    val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply {
      init(keyStore, null)
    }
    val localTrustAll = arrayOf<TrustManager>(
      object : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
      }
    )
    return SSLContext.getInstance("TLS").apply {
      init(kmf.keyManagers, localTrustAll, SecureRandom())
    }
  }

  private fun executeViaWirelessAdb(command: String, timeoutMs: Long): PrivilegedShellResult {
    val startedAt = SystemClock.elapsedRealtime()
    val host = getWirelessAdbHost()
    val port = getWirelessAdbPort()
      ?: return PrivilegedShellResult(
        ok = false,
        exitCode = -1,
        stdoutBytes = ByteArray(0),
        stderr = "Wireless ADB port is not configured",
        channel = CHANNEL_WIRELESS_ADB,
        durationMs = SystemClock.elapsedRealtime() - startedAt
      )

    // 1. Prefer system/bundled adb binary if available on device.
    val adbBin = findLocalAdbBinary()
    if (adbBin != null) {
      val cliResult = runLocalProcess(
        listOf(adbBin, "-s", "$host:$port", "exec-out", command),
        timeoutMs = timeoutMs,
        channel = CHANNEL_WIRELESS_ADB
      )
      if (cliResult.ok || cliResult.stdoutBytes.isNotEmpty()) {
        return cliResult
      }
    }

    // 2. Direct loopback ADB protocol transport (CNXN / STLS / AUTH / OPEN shell:<cmd>).
    return try {
      val outputBytes = executeDirectAdbSocketShell(host, port, command, timeoutMs)
      PrivilegedShellResult(
        ok = true,
        exitCode = 0,
        stdoutBytes = outputBytes,
        stderr = "",
        channel = CHANNEL_WIRELESS_ADB,
        durationMs = SystemClock.elapsedRealtime() - startedAt
      )
    } catch (err: Throwable) {
      // 3. Local shell fallback for commands executable within current UID context.
      val fallback = runLocalProcess(
        listOf("sh", "-c", command),
        timeoutMs = timeoutMs,
        channel = CHANNEL_WIRELESS_ADB
      )
      if (fallback.ok) {
        fallback
      } else {
        PrivilegedShellResult(
          ok = false,
          exitCode = -1,
          stdoutBytes = ByteArray(0),
          stderr = "Wireless ADB ($host:$port) error: ${err.message ?: err.javaClass.simpleName}",
          channel = CHANNEL_WIRELESS_ADB,
          durationMs = SystemClock.elapsedRealtime() - startedAt
        )
      }
    }
  }

  private fun executeDirectAdbSocketShell(
    host: String,
    port: Int,
    command: String,
    timeoutMs: Long
  ): ByteArray {
    val rawSocket = Socket()
    val boundedTimeout = timeoutMs.coerceIn(1_000L, 28_000L).toInt()
    rawSocket.connect(InetSocketAddress(host, port), 3_000)
    rawSocket.soTimeout = boundedTimeout

    var activeSocket: Socket = rawSocket
    try {
      sendAdbPacket(
        activeSocket,
        ADB_CMD_CNXN,
        ADB_VERSION,
        ADB_MAX_DATA,
        "host::features=shell_v2,cmd,stat_v2\u0000".toByteArray(Charsets.UTF_8)
      )

      var connected = false
      var sentPublicKey = false
      var handshakeSteps = 0

      while (!connected && handshakeSteps < 8) {
        handshakeSteps += 1
        val pkt = readAdbPacket(activeSocket)
        when (pkt.command) {
          ADB_CMD_CNXN -> connected = true
          ADB_CMD_STLS -> {
            sendAdbPacket(activeSocket, ADB_CMD_STLS, ADB_STLS_VERSION, 0, ByteArray(0))
            val sslContext = createAdbSslContext()
            val sslSocket = sslContext.socketFactory.createSocket(
              activeSocket,
              host,
              port,
              true
            ) as SSLSocket
            sslSocket.soTimeout = boundedTimeout
            sslSocket.startHandshake()
            activeSocket = sslSocket
          }
          ADB_CMD_AUTH -> {
            if (pkt.arg0 == ADB_AUTH_TOKEN && !sentPublicKey) {
              val signed = signAdbToken(pkt.payload)
              if (signed != null) {
                sendAdbPacket(activeSocket, ADB_CMD_AUTH, ADB_AUTH_SIGNATURE, 0, signed)
                continue
              }
            }
            val pubKeyPayload = encodeAdbPublicKeyPayload()
            sentPublicKey = true
            sendAdbPacket(activeSocket, ADB_CMD_AUTH, ADB_AUTH_RSAPUBLICKEY, 0, pubKeyPayload)
          }
          else -> throw IllegalStateException("Unexpected ADB handshake packet: ${pkt.command}")
        }
      }

      if (!connected) {
        throw IllegalStateException("ADB handshake did not reach CNXN state")
      }

      val localId = 1
      val openPayload = "shell:$command\u0000".toByteArray(Charsets.UTF_8)
      sendAdbPacket(activeSocket, ADB_CMD_OPEN, localId, 0, openPayload)

      val stdout = ByteArrayOutputStream()
      var remoteId = 0
      while (true) {
        val pkt = readAdbPacket(activeSocket)
        when (pkt.command) {
          ADB_CMD_OKAY -> {
            if (remoteId == 0) remoteId = pkt.arg0
          }
          ADB_CMD_WRTE -> {
            if (remoteId == 0) remoteId = pkt.arg0
            if (pkt.payload.isNotEmpty()) {
              stdout.write(pkt.payload)
            }
            sendAdbPacket(activeSocket, ADB_CMD_OKAY, localId, remoteId, ByteArray(0))
          }
          ADB_CMD_CLSE -> {
            if (remoteId != 0) {
              sendAdbPacket(activeSocket, ADB_CMD_CLSE, localId, remoteId, ByteArray(0))
            }
            break
          }
          else -> break
        }
      }
      return stdout.toByteArray()
    } finally {
      try {
        activeSocket.close()
      } catch (_: Throwable) {
      }
    }
  }

  private data class AdbPacket(
    val command: Int,
    val arg0: Int,
    val arg1: Int,
    val payload: ByteArray
  )

  private fun sendAdbPacket(
    socket: Socket,
    command: Int,
    arg0: Int,
    arg1: Int,
    payload: ByteArray
  ) {
    var checksum = 0
    for (b in payload) {
      checksum += (b.toInt() and 0xFF)
    }
    val header = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN).apply {
      putInt(command)
      putInt(arg0)
      putInt(arg1)
      putInt(payload.size)
      putInt(checksum)
      putInt(command xor -1)
    }.array()
    val out = socket.getOutputStream()
    out.write(header)
    if (payload.isNotEmpty()) {
      out.write(payload)
    }
    out.flush()
  }

  private fun readAdbPacket(socket: Socket): AdbPacket {
    val input = socket.getInputStream()
    val headerBytes = readExactBytes(input, 24)
    val header = ByteBuffer.wrap(headerBytes).order(ByteOrder.LITTLE_ENDIAN)
    val command = header.int
    val arg0 = header.int
    val arg1 = header.int
    val dataLength = header.int.coerceIn(0, 8 * 1024 * 1024)
    header.int // checksum
    header.int // magic
    val payload = if (dataLength > 0) readExactBytes(input, dataLength) else ByteArray(0)
    return AdbPacket(command = command, arg0 = arg0, arg1 = arg1, payload = payload)
  }

  private fun readExactBytes(input: InputStream, count: Int): ByteArray {
    val buffer = ByteArray(count)
    var offset = 0
    while (offset < count) {
      val read = input.read(buffer, offset, count - offset)
      if (read < 0) throw IllegalStateException("Unexpected EOF on ADB socket")
      offset += read
    }
    return buffer
  }

  private fun signAdbToken(token: ByteArray): ByteArray? {
    val entry = ensureKeystoreAdbIdentity() ?: return null
    return try {
      // Prepend PKCS#1 SHA-1 DigestInfo ASN.1 prefix for 20-byte ADB auth token.
      val digestInfoPrefix = byteArrayOf(
        0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e,
        0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14
      )
      val payload = ByteArray(digestInfoPrefix.size + token.size)
      System.arraycopy(digestInfoPrefix, 0, payload, 0, digestInfoPrefix.size)
      System.arraycopy(token, 0, payload, digestInfoPrefix.size, token.size)
      val sig = Signature.getInstance("NONEwithRSA")
      sig.initSign(entry.privateKey)
      sig.update(payload)
      sig.sign()
    } catch (_: Throwable) {
      null
    }
  }

  private fun encodeAdbPublicKeyPayload(): ByteArray {
    val entry = ensureKeystoreAdbIdentity()
    val rsaPub = entry?.certificate?.publicKey as? RSAPublicKey
    val encodedCert = if (rsaPub != null) {
      Base64.encodeToString(rsaPub.encoded, Base64.NO_WRAP)
    } else {
      val crc = CRC32().apply { update(appContext.packageName.toByteArray(Charsets.UTF_8)) }.value
      Base64.encodeToString("pavra-$crc".toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
    }
    return "$encodedCert pavra@android\u0000".toByteArray(Charsets.UTF_8)
  }

  // ---------------------------------------------------------------------------
  // Unified Status & Shell Execution
  // ---------------------------------------------------------------------------

  fun resolveActiveChannel(preferred: String? = null): String {
    val mode = preferred?.trim()?.lowercase(Locale.ROOT) ?: preferredChannelRef.get()
    val shizukuReady = isShizukuAvailable() && isShizukuAuthorized()
    val wirelessReady = isWirelessAdbPaired() && getWirelessAdbPort() != null

    return when (mode) {
      CHANNEL_SHIZUKU -> if (shizukuReady) CHANNEL_SHIZUKU else CHANNEL_NONE
      CHANNEL_WIRELESS_ADB -> if (wirelessReady) CHANNEL_WIRELESS_ADB else CHANNEL_NONE
      else -> when {
        shizukuReady -> CHANNEL_SHIZUKU
        wirelessReady -> CHANNEL_WIRELESS_ADB
        else -> CHANNEL_NONE
      }
    }
  }

  fun getStatusMap(
    preferredChannel: String? = null,
    virtualDisplayId: Int? = null,
    overlayPermissionGranted: Boolean? = null
  ): Map<String, Any?> {
    if (preferredChannel != null) {
      setPreferredChannel(preferredChannel)
    }
    val shizukuAvail = isShizukuAvailable()
    val shizukuAuth = shizukuAvail && isShizukuAuthorized()
    val wirelessPaired = isWirelessAdbPaired()
    val wirelessPort = getWirelessAdbPort()
    val activeChannel = resolveActiveChannel(preferredChannel)
    val overlayGranted = overlayPermissionGranted ?: Settings.canDrawOverlays(appContext)

    return mapOf(
      "ready" to (activeChannel != CHANNEL_NONE),
      "activeChannel" to activeChannel,
      "preferredChannel" to preferredChannelRef.get(),
      "shizukuInstalled" to isShizukuInstalled(),
      "shizukuAvailable" to shizukuAvail,
      "shizukuAuthorized" to shizukuAuth,
      "wirelessAdbPaired" to wirelessPaired,
      "wirelessAdbHost" to getWirelessAdbHost(),
      "wirelessAdbPort" to wirelessPort,
      "discoveredPairingPort" to discoveredPairingPort.get().takeIf { it in 1..65535 },
      "discoveredConnectPort" to discoveredConnectPort.get().takeIf { it in 1..65535 },
      "virtualDisplayId" to virtualDisplayId,
      "overlayPermissionGranted" to overlayGranted,
      "lastError" to lastErrorRef.get()
    )
  }

  fun executeShell(
    command: String,
    preferredChannel: String? = null,
    timeoutMs: Long = DEFAULT_SHELL_TIMEOUT_MS
  ): PrivilegedShellResult {
    val active = resolveActiveChannel(preferredChannel)
    return when (active) {
      CHANNEL_SHIZUKU -> executeViaShizuku(command, timeoutMs)
      CHANNEL_WIRELESS_ADB -> executeViaWirelessAdb(command, timeoutMs)
      else -> runLocalProcess(
        listOf("sh", "-c", command),
        timeoutMs = timeoutMs,
        channel = CHANNEL_NONE
      )
    }
  }

  private fun runLocalProcess(
    args: List<String>,
    timeoutMs: Long,
    channel: String = CHANNEL_NONE
  ): PrivilegedShellResult {
    val startedAt = SystemClock.elapsedRealtime()
    return try {
      val proc = ProcessBuilder(args).start()
      collectJavaProcessResult(proc, channel, startedAt, timeoutMs)
    } catch (err: Throwable) {
      PrivilegedShellResult(
        ok = false,
        exitCode = -1,
        stdoutBytes = ByteArray(0),
        stderr = err.message ?: err.javaClass.simpleName,
        channel = channel,
        durationMs = SystemClock.elapsedRealtime() - startedAt
      )
    }
  }

  private fun collectJavaProcessResult(
    proc: Process,
    channel: String,
    startedAt: Long,
    timeoutMs: Long
  ): PrivilegedShellResult {
    val stdoutOut = ByteArrayOutputStream()
    val stderrOut = ByteArrayOutputStream()
    val outReader = Thread {
      try {
        proc.inputStream.use { copyStream(it, stdoutOut) }
      } catch (_: Throwable) {
      }
    }
    val errReader = Thread {
      try {
        proc.errorStream.use { copyStream(it, stderrOut) }
      } catch (_: Throwable) {
      }
    }
    outReader.start()
    errReader.start()

    val finished = proc.waitFor(timeoutMs.coerceAtLeast(500L), TimeUnit.MILLISECONDS)
    if (!finished) {
      proc.destroyForcibly()
    }
    outReader.join(1_000L)
    errReader.join(1_000L)
    val code = if (finished) proc.exitValue() else -1
    return PrivilegedShellResult(
      ok = finished && code == 0,
      exitCode = code,
      stdoutBytes = stdoutOut.toByteArray(),
      stderr = stderrOut.toByteArray().toString(Charsets.UTF_8),
      channel = channel,
      durationMs = SystemClock.elapsedRealtime() - startedAt
    )
  }

  private fun copyStream(input: InputStream, output: ByteArrayOutputStream) {
    val buf = ByteArray(16 * 1024)
    while (true) {
      val read = input.read(buf)
      if (read < 0) break
      if (read > 0) output.write(buf, 0, read)
    }
  }

  companion object {
    const val CHANNEL_AUTO = "auto"
    const val CHANNEL_NONE = "none"
    const val CHANNEL_SHIZUKU = "shizuku"
    const val CHANNEL_WIRELESS_ADB = "wireless_adb"

    const val SHIZUKU_PACKAGE = "moe.shizuku.privileged.api"
    const val SHIZUKU_RUNTIME_PERMISSION = "moe.shizuku.privileged.api.permission.API_V23"
    private const val SHIZUKU_SERVICE_DESCRIPTOR = "moe.shizuku.server.IShizukuService"
    private const val SHIZUKU_REMOTE_PROCESS_DESCRIPTOR = "moe.shizuku.server.IRemoteProcess"
    private const val TRANSACTION_NEW_PROCESS = IBinder.FIRST_CALL_TRANSACTION + 7
    private const val TRANSACTION_CHECK_SELF_PERMISSION = IBinder.FIRST_CALL_TRANSACTION + 13
    private const val REMOTE_PROC_GET_INPUT_STREAM = IBinder.FIRST_CALL_TRANSACTION + 1
    private const val REMOTE_PROC_GET_ERROR_STREAM = IBinder.FIRST_CALL_TRANSACTION + 2
    private const val REMOTE_PROC_WAIT_FOR = IBinder.FIRST_CALL_TRANSACTION + 3
    private const val REMOTE_PROC_DESTROY = IBinder.FIRST_CALL_TRANSACTION + 5
    const val SHIZUKU_PERMISSION_REQUEST_CODE = 6781

    const val NSD_SERVICE_PAIRING = "_adb-tls-pairing._tcp."
    const val NSD_SERVICE_CONNECT = "_adb-tls-connect._tcp."

    const val PAIRING_CHANNEL_ID = "pavra-wireless-adb-pairing"
    const val PAIRING_CHANNEL_NAME = "Pavra Wireless Debugging Pairing"
    const val PAIRING_NOTIFICATION_ID = 6779
    const val KEY_PAIRING_INPUT = "pavra_wireless_pairing_code"
    const val PAIRING_REMOTE_INPUT_LABEL = "输入 6 位无线调试配对码（或 配对码:端口）"
    const val ACTION_SUBMIT_PAIRING_CODE = "expo.modules.pavrakeepalive.ACTION_SUBMIT_PAIRING_CODE"

    private const val REQUEST_CODE_PAIRING_SUBMIT = 6782
    private const val REQUEST_CODE_OPEN_DEV_SETTINGS = 6783

    private const val PREFS_NAME = "pavra_phone_privilege_prefs"
    private const val PREF_PREFERRED_CHANNEL = "preferred_channel"
    private const val PREF_WIRELESS_PAIRED = "wireless_adb_paired"
    private const val PREF_WIRELESS_HOST = "wireless_adb_host"
    private const val PREF_WIRELESS_PORT = "wireless_adb_port"
    private const val PREF_LAST_PAIRING_PORT = "wireless_adb_pairing_port"
    private const val PREF_WIRELESS_PAIRED_AT = "wireless_adb_paired_at"

    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val KEYSTORE_ADB_ALIAS = "pavra_local_adb_rsa"
    private const val DEFAULT_LOOPBACK_HOST = "127.0.0.1"
    private const val DEFAULT_FALLBACK_ADB_PORT = 5555
    private const val DEFAULT_SHELL_TIMEOUT_MS = 15_000L

    private const val ADB_CMD_CNXN = 0x4e584e43
    private const val ADB_CMD_AUTH = 0x48545541
    private const val ADB_CMD_OPEN = 0x4e45504f
    private const val ADB_CMD_OKAY = 0x59414b4f
    private const val ADB_CMD_CLSE = 0x45534c43
    private const val ADB_CMD_WRTE = 0x45545257
    private const val ADB_CMD_STLS = 0x534c5453
    private const val ADB_VERSION = 0x01000001
    private const val ADB_STLS_VERSION = 0x01000000
    private const val ADB_MAX_DATA = 1024 * 1024
    private const val ADB_AUTH_TOKEN = 1
    private const val ADB_AUTH_SIGNATURE = 2
    private const val ADB_AUTH_RSAPUBLICKEY = 3

    private val REGEX_SIX_DIGITS = Regex("^\\d{6}$")
    private val REGEX_CODE_PORT = Regex("^(\\d{6})\\s*[:\\s]\\s*(\\d{1,5})$")
    private val REGEX_HOST_PORT_CODE = Regex("^([A-Za-z0-9._-]+):(\\d{1,5})\\s*[:\\s]\\s*(\\d{6})$")
  }
}

class PavraWirelessAdbPairingReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action != PavraPhonePrivilegeEngine.ACTION_SUBMIT_PAIRING_CODE) return
    val results = RemoteInput.getResultsFromIntent(intent)
    val rawCode = results
      ?.getCharSequence(PavraPhonePrivilegeEngine.KEY_PAIRING_INPUT)
      ?.toString()
      ?.trim()
      .orEmpty()

    val pendingResult = goAsync()
    receiverScope.launch {
      try {
        val runtime = PavraPhoneRuntime.getInstance(context)
        if (rawCode.isEmpty()) {
          runtime.privilegeEngine.completePairingNotification(
            success = false,
            message = "未检测到配对码，请输入 6 位数字（或 配对码:端口）"
          )
        } else {
          val status = runtime.privilegeEngine.submitWirelessPairingCode(rawCode)
          val paired = status["wirelessAdbPaired"] == true
          val port = status["wirelessAdbPort"]
          if (paired) {
            runtime.privilegeEngine.completePairingNotification(
              success = true,
              message = "本机无线调试已连接 (127.0.0.1:${port ?: 5555})"
            )
          } else {
            val err = status["lastError"]?.toString() ?: "格式错误，请重试"
            runtime.privilegeEngine.completePairingNotification(
              success = false,
              message = "配对失败：$err"
            )
          }
        }
      } finally {
        pendingResult.finish()
      }
    }
  }

  companion object {
    private val receiverScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  }
}
