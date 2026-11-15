package expo.modules.pavrakeepalive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class PavraKeepaliveService : Service() {
  override fun onCreate() {
    super.onCreate()
    ensureNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    ensureNotificationChannel()
    val title = intent?.getStringExtra(EXTRA_TITLE)?.takeIf { it.isNotBlank() } ?: DEFAULT_TITLE
    val body = intent?.getStringExtra(EXTRA_BODY)?.takeIf { it.isNotBlank() } ?: DEFAULT_BODY
    val notification = buildNotification(title, body)
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
    try {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } catch (_: Throwable) {
    }
    super.onDestroy()
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

  private fun buildNotification(title: String, body: String): Notification {
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
    const val DEFAULT_TITLE = "Pavra · Connected"
    const val DEFAULT_BODY = "Listening for assistant replies, tasks & reminders"
  }
}
