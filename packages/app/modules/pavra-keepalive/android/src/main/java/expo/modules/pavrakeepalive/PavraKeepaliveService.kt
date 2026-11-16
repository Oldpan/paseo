package expo.modules.pavrakeepalive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class PavraKeepaliveService : Service() {
  private var screenOffReceiverRegistered = false

  private val screenOffReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action == Intent.ACTION_SCREEN_OFF) {
        PavraPhoneRuntime.peekInstance()?.onPhysicalScreenTurnedOff()
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    ensureNotificationChannel()
    registerScreenOffWatcher()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP_PHONE_CONTROL) {
      PavraPhoneRuntime.getInstance(applicationContext)
        .floatingOverlayController
        .triggerHardwareEmergencyStop(source = "keepalive_notification")
      return START_STICKY
    }

    ensureNotificationChannel()
    val title = intent?.getStringExtra(EXTRA_TITLE)?.takeIf { it.isNotBlank() } ?: DEFAULT_TITLE
    val body = intent?.getStringExtra(EXTRA_BODY)?.takeIf { it.isNotBlank() } ?: DEFAULT_BODY
    val phoneActive = intent?.getBooleanExtra(EXTRA_PHONE_CONTROL_ACTIVE, false) == true
    val notification = buildNotification(title, body, phoneActive)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(
          NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        )
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (_: Throwable) {
      // Ignore OS restrictions when background start is disallowed on newer Android versions.
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    unregisterScreenOffWatcher()
    try {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } catch (_: Throwable) {
    }
    super.onDestroy()
  }

  private fun registerScreenOffWatcher() {
    if (screenOffReceiverRegistered) return
    try {
      val filter = IntentFilter(Intent.ACTION_SCREEN_OFF)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        registerReceiver(screenOffReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
      } else {
        registerReceiver(screenOffReceiver, filter)
      }
      screenOffReceiverRegistered = true
    } catch (_: Throwable) {
    }
  }

  private fun unregisterScreenOffWatcher() {
    if (!screenOffReceiverRegistered) return
    try {
      unregisterReceiver(screenOffReceiver)
    } catch (_: Throwable) {
    }
    screenOffReceiverRegistered = false
  }

  private fun ensureNotificationChannel() {
    val manager = getSystemService(NotificationManager::class.java) ?: return
    val channel = NotificationChannel(
      CHANNEL_ID,
      CHANNEL_NAME,
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = CHANNEL_DESCRIPTION
      setShowBadge(false)
      enableVibration(false)
      setSound(null, null)
    }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(
    title: String,
    body: String,
    phoneControlActive: Boolean
  ): Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pendingIntent = if (launchIntent != null) {
      PendingIntent.getActivity(
        this,
        0,
        launchIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    } else {
      null
    }
    val iconRes = resources.getIdentifier("notification_icon", "drawable", packageName)
      .takeIf { it != 0 }
      ?: applicationInfo.icon.takeIf { it != 0 }
      ?: android.R.drawable.ic_dialog_info

    val builder = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(iconRes)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_SERVICE)
    if (pendingIntent != null) {
      builder.setContentIntent(pendingIntent)
    }
    if (phoneControlActive) {
      val stopPhoneIntent = Intent(this, PavraKeepaliveService::class.java).apply {
        action = ACTION_STOP_PHONE_CONTROL
        setPackage(packageName)
      }
      val stopPhonePending = PendingIntent.getService(
        this,
        REQUEST_CODE_STOP_PHONE,
        stopPhoneIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      val stopAction = Notification.Action.Builder(
        android.R.drawable.ic_media_pause,
        "急停手机控制",
        stopPhonePending
      ).build()
      builder.addAction(stopAction)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }
    return builder.build()
  }

  companion object {
    const val CHANNEL_ID = "pavra-keepalive"
    const val CHANNEL_NAME = "Pavra Connection Keepalive"
    const val CHANNEL_DESCRIPTION = "Keeps Pavra connected for assistant replies, tasks, and reminders"
    const val NOTIFICATION_ID = 6778
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
    const val EXTRA_PHONE_CONTROL_ACTIVE = "phoneControlActive"
    const val ACTION_STOP_PHONE_CONTROL = "expo.modules.pavrakeepalive.ACTION_STOP_PHONE_CONTROL"
    private const val REQUEST_CODE_STOP_PHONE = 6784
    const val DEFAULT_TITLE = "Pavra · Connected"
    const val DEFAULT_BODY = "Listening for assistant replies, tasks & reminders"
  }
}
