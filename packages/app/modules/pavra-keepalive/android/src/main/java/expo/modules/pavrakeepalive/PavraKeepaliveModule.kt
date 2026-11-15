package expo.modules.pavrakeepalive

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PavraKeepaliveModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PavraKeepalive")

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
  }
}
