package expo.modules.pavrakeepalive

import android.app.ActivityOptions
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Base64
import android.util.Xml
import android.view.Display
import org.xmlpull.v1.XmlPullParser
import java.io.ByteArrayOutputStream
import java.io.StringReader
import java.util.Locale
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.max
import kotlin.math.roundToInt

class PavraVirtualDisplayController(
  context: Context,
  private val privilegeEngine: PavraPhonePrivilegeEngine
) {
  private val appContext: Context = context.applicationContext
  private val mainHandler = Handler(Looper.getMainLooper())
  private val displayLock = Any()
  private val frameLock = Any()

  private var virtualDisplay: VirtualDisplay? = null
  private var imageReader: ImageReader? = null
  private var frameThread: HandlerThread? = null
  private var frameHandler: Handler? = null

  private var currentWidth: Int = DEFAULT_WIDTH
  private var currentHeight: Int = DEFAULT_HEIGHT
  private var currentDpi: Int = DEFAULT_DPI

  private var latestBitmap: Bitmap? = null
  private var latestFrameTimestampMs: Long = 0L

  private val activePackageRef = AtomicReference<String?>(null)
  private val mainScreenTakeoverActive = AtomicBoolean(false)
  private val pausedState = AtomicBoolean(false)
  private val emergencyStoppedState = AtomicBoolean(false)

  @Volatile
  var lastTapX: Int? = null
    private set

  @Volatile
  var lastTapY: Int? = null
    private set

  private val elementBoundsCache = LinkedHashMap<String, Pair<Int, Int>>()
  private val stateListeners = CopyOnWriteArraySet<() -> Unit>()

  fun addStateListener(listener: () -> Unit) {
    stateListeners.add(listener)
  }

  fun removeStateListener(listener: () -> Unit) {
    stateListeners.remove(listener)
  }

  private fun notifyStateListeners() {
    for (listener in stateListeners) {
      try {
        listener()
      } catch (_: Throwable) {
      }
    }
  }

  fun getVirtualDisplayId(): Int? {
    synchronized(displayLock) {
      val id = virtualDisplay?.display?.displayId
      return if (id != null && id > Display.DEFAULT_DISPLAY) id else null
    }
  }

  fun getDisplayDimensions(): Pair<Int, Int> {
    synchronized(displayLock) {
      return Pair(currentWidth, currentHeight)
    }
  }

  fun getActivePackageName(): String? = activePackageRef.get()

  fun isPaused(): Boolean = pausedState.get()

  fun setPaused(paused: Boolean) {
    pausedState.set(paused)
    notifyStateListeners()
  }

  fun isOnMainScreenTakeover(): Boolean = mainScreenTakeoverActive.get()

  fun isEmergencyStopped(): Boolean = emergencyStoppedState.get()

  fun triggerEmergencyStop() {
    emergencyStoppedState.set(true)
    pausedState.set(false)
    notifyStateListeners()
  }

  fun clearEmergencyStop() {
    emergencyStoppedState.set(false)
    notifyStateListeners()
  }

  fun ensureVirtualDisplay(
    width: Int = DEFAULT_WIDTH,
    height: Int = DEFAULT_HEIGHT,
    dpi: Int = DEFAULT_DPI
  ): Int {
    val safeWidth = width.coerceIn(360, 2160)
    val safeHeight = height.coerceIn(640, 4320)
    val safeDpi = dpi.coerceIn(120, 640)

    synchronized(displayLock) {
      val existing = virtualDisplay
      val existingId = existing?.display?.displayId
      if (
        existing != null &&
        existingId != null &&
        existingId > Display.DEFAULT_DISPLAY &&
        currentWidth == safeWidth &&
        currentHeight == safeHeight &&
        currentDpi == safeDpi
      ) {
        emergencyStoppedState.set(false)
        return existingId
      }

      releaseLocked()

      val thread = HandlerThread("PavraVirtualDisplayFrames").apply { start() }
      val handler = Handler(thread.looper)
      val reader = ImageReader.newInstance(safeWidth, safeHeight, PixelFormat.RGBA_8888, 2)

      reader.setOnImageAvailableListener({ ir ->
        val image = try {
          ir.acquireLatestImage()
        } catch (_: Throwable) {
          null
        } ?: return@setOnImageAvailableListener

        try {
          val planes = image.planes
          if (planes.isNotEmpty()) {
            val plane = planes[0]
            val buffer = plane.buffer
            val pixelStride = plane.pixelStride.coerceAtLeast(1)
            val rowStride = plane.rowStride
            val rowPadding = (rowStride - pixelStride * image.width).coerceAtLeast(0)
            val paddedWidth = image.width + rowPadding / pixelStride
            val rawBitmap = Bitmap.createBitmap(
              paddedWidth,
              image.height,
              Bitmap.Config.ARGB_8888
            )
            buffer.rewind()
            rawBitmap.copyPixelsFromBuffer(buffer)
            val cropped = if (paddedWidth > image.width) {
              Bitmap.createBitmap(rawBitmap, 0, 0, image.width, image.height).also { created ->
                if (created !== rawBitmap) {
                  rawBitmap.recycle()
                }
              }
            } else {
              rawBitmap
            }
            synchronized(frameLock) {
              latestBitmap = cropped
              latestFrameTimestampMs = System.currentTimeMillis()
            }
            notifyStateListeners()
          }
        } catch (_: Throwable) {
        } finally {
          try {
            image.close()
          } catch (_: Throwable) {
          }
        }
      }, handler)

      val displayManager = appContext.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
      val flagCandidates = intArrayOf(
        DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY or
          DisplayManager.VIRTUAL_DISPLAY_FLAG_PRESENTATION,
        DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY,
        0
      )

      var created: VirtualDisplay? = null
      for (flags in flagCandidates) {
        try {
          created = displayManager.createVirtualDisplay(
            VIRTUAL_DISPLAY_NAME,
            safeWidth,
            safeHeight,
            safeDpi,
            reader.surface,
            flags
          )
          if (created != null) break
        } catch (_: SecurityException) {
        } catch (_: Throwable) {
        }
      }

      if (created == null) {
        try {
          reader.close()
        } catch (_: Throwable) {
        }
        thread.quitSafely()
        throw IllegalStateException("Failed to create VirtualDisplay ($VIRTUAL_DISPLAY_NAME)")
      }

      frameThread = thread
      frameHandler = handler
      imageReader = reader
      virtualDisplay = created
      currentWidth = safeWidth
      currentHeight = safeHeight
      currentDpi = safeDpi
      emergencyStoppedState.set(false)

      return created.display.displayId
    }
  }

  fun releaseVirtualDisplay(): Boolean {
    synchronized(displayLock) {
      releaseLocked()
    }
    notifyStateListeners()
    return true
  }

  private fun releaseLocked() {
    try {
      virtualDisplay?.release()
    } catch (_: Throwable) {
    }
    virtualDisplay = null

    try {
      imageReader?.setOnImageAvailableListener(null, null)
      imageReader?.close()
    } catch (_: Throwable) {
    }
    imageReader = null

    try {
      frameThread?.quitSafely()
    } catch (_: Throwable) {
    }
    frameThread = null
    frameHandler = null

    synchronized(frameLock) {
      latestBitmap = null
      latestFrameTimestampMs = 0L
    }
  }

  fun capturePreviewBitmap(maxLongEdge: Int = 480): Bitmap? {
    val displayId = getVirtualDisplayId() ?: return null
    val raw = obtainLatestOrShellBitmap(displayId) ?: buildPlaceholderFrameBitmap(displayId)
    return scaleDownBitmap(raw, maxLongEdge.coerceIn(160, 1440))
  }

  fun captureFrameJpegBase64(
    maxLongEdge: Int = 1080,
    quality: Int = 72
  ): Map<String, Any?> {
    val displayId = ensureVirtualDisplay(currentWidth, currentHeight, currentDpi)
    val safeMaxEdge = maxLongEdge.coerceIn(240, 2160)
    val safeQuality = quality.coerceIn(20, 95)

    val secureDetected = detectFlagSecureWindow(displayId)
    val sourceBitmap = if (secureDetected) {
      null
    } else {
      obtainLatestOrShellBitmap(displayId) ?: buildPlaceholderFrameBitmap(displayId)
    }

    if (sourceBitmap == null) {
      return mapOf(
        "ok" to false,
        "displayId" to displayId,
        "base64" to null,
        "screenshotBase64" to null,
        "mimeType" to "image/jpeg",
        "width" to currentWidth,
        "height" to currentHeight,
        "sourceWidth" to currentWidth,
        "sourceHeight" to currentHeight,
        "byteLength" to 0,
        "isSecureFlag" to secureDetected,
        "timestamp" to System.currentTimeMillis()
      )
    }

    val scaled = scaleDownBitmap(sourceBitmap, safeMaxEdge)
    val outWidth = scaled.width
    val outHeight = scaled.height
    val jpegOut = ByteArrayOutputStream()
    scaled.compress(Bitmap.CompressFormat.JPEG, safeQuality, jpegOut)
    if (scaled !== sourceBitmap) {
      scaled.recycle()
    }
    val jpegBytes = jpegOut.toByteArray()
    val encoded = Base64.encodeToString(jpegBytes, Base64.NO_WRAP)

    return mapOf(
      "ok" to true,
      "displayId" to displayId,
      "base64" to encoded,
      "screenshotBase64" to encoded,
      "mimeType" to "image/jpeg",
      "width" to outWidth,
      "height" to outHeight,
      "sourceWidth" to sourceBitmap.width,
      "sourceHeight" to sourceBitmap.height,
      "byteLength" to jpegBytes.size,
      "isSecureFlag" to false,
      "timestamp" to System.currentTimeMillis()
    )
  }

  private fun obtainLatestOrShellBitmap(displayId: Int): Bitmap? {
    val now = System.currentTimeMillis()
    synchronized(frameLock) {
      val cached = latestBitmap
      if (cached != null && now - latestFrameTimestampMs <= 2_500L) {
        return cached
      }
    }

    // Fallback to screencap -d <displayId> -p via privilege channel when ImageReader is idle.
    val shellCapture = privilegeEngine.executeShell(
      command = "screencap -d $displayId -p",
      timeoutMs = 6_000L
    )
    if (shellCapture.stdoutBytes.size > 64) {
      val decoded = try {
        BitmapFactory.decodeByteArray(shellCapture.stdoutBytes, 0, shellCapture.stdoutBytes.size)
      } catch (_: Throwable) {
        null
      }
      if (decoded != null) {
        synchronized(frameLock) {
          latestBitmap = decoded
          latestFrameTimestampMs = System.currentTimeMillis()
        }
        return decoded
      }
    }

    synchronized(frameLock) {
      return latestBitmap
    }
  }

  private fun buildPlaceholderFrameBitmap(displayId: Int): Bitmap {
    val w = 540
    val h = 1200
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    canvas.drawColor(Color.parseColor("#111418"))
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.parseColor("#E5E7EB")
      textSize = 28f
    }
    val pkg = activePackageRef.get() ?: "Idle"
    canvas.drawText("Pavra VirtualDisplay #$displayId", 36f, 96f, paint)
    paint.textSize = 22f
    paint.color = Color.parseColor("#9CA3AF")
    canvas.drawText("App: $pkg", 36f, 142f, paint)
    return bmp
  }

  private fun scaleDownBitmap(source: Bitmap, maxLongEdge: Int): Bitmap {
    val srcLong = max(source.width, source.height)
    if (srcLong <= maxLongEdge || srcLong <= 0) {
      return source
    }
    val ratio = maxLongEdge.toFloat() / srcLong.toFloat()
    val dstW = (source.width * ratio).roundToInt().coerceAtLeast(1)
    val dstH = (source.height * ratio).roundToInt().coerceAtLeast(1)
    return Bitmap.createScaledBitmap(source, dstW, dstH, true)
  }

  fun isBlockedPhonePackage(packageName: String?): Boolean {
    val clean = packageName?.trim()?.lowercase(Locale.ROOT)?.takeIf { it.isNotEmpty() } ?: return false
    if (HARD_BLOCKED_PACKAGES.contains(clean)) return true
    return HARD_BLOCKED_PREFIXES.any { prefix -> clean.startsWith(prefix) }
  }

  fun redactPiiText(rawText: String): String {
    if (rawText.isEmpty()) return rawText
    val idRedacted = REGEX_CN_RESIDENT_ID.replace(rawText, "[REDACTED_ID]")
    return REGEX_BANK_CARD.replace(idRedacted, "[REDACTED_CARD]")
  }

  fun launchAppOnVirtualDisplay(packageName: String, unlocked: Boolean = false): Boolean {
    val cleanPkg = packageName.trim()
    if (cleanPkg.isEmpty()) return false
    if (!unlocked && isBlockedPhonePackage(cleanPkg)) {
      return false
    }
    val displayId = ensureVirtualDisplay(currentWidth, currentHeight, currentDpi)

    var launched = startPackageOnDisplayViaContext(
      packageName = cleanPkg,
      targetDisplayId = displayId,
      reorderOnly = false
    )

    // Privilege fallback (`am start --display <displayId>`) ensures background activity focus on Android 14+.
    val component = resolveLaunchComponent(cleanPkg)
    val shellCmd = if (component != null) {
      "am start --display $displayId -W -n ${escapeShellToken(component.flattenToShortString())}"
    } else {
      "monkey -p ${escapeShellToken(cleanPkg)} -c android.intent.category.LAUNCHER 1"
    }
    val shellRes = privilegeEngine.executeShell(shellCmd, timeoutMs = 8_000L)
    if (shellRes.ok) {
      launched = true
    }

    if (launched) {
      activePackageRef.set(cleanPkg)
      mainScreenTakeoverActive.set(false)
      notifyStateListeners()
    }
    return launched
  }

  fun moveAppToMainScreenForTakeover(packageName: String): Boolean {
    val targetPkg = packageName.trim().takeIf { it.isNotEmpty() }
      ?: activePackageRef.get()
      ?: return false

    var moved = startPackageOnDisplayViaContext(
      packageName = targetPkg,
      targetDisplayId = Display.DEFAULT_DISPLAY,
      reorderOnly = true
    )

    val component = resolveLaunchComponent(targetPkg)
    if (component != null) {
      val cmd = "am start --display ${Display.DEFAULT_DISPLAY} --activity-reorder-to-front -n ${
        escapeShellToken(component.flattenToShortString())
      }"
      if (privilegeEngine.executeShell(cmd, timeoutMs = 6_000L).ok) {
        moved = true
      }
    }

    if (moved) {
      activePackageRef.set(targetPkg)
      mainScreenTakeoverActive.set(true)
      notifyStateListeners()
    }
    return moved
  }

  fun returnAppToVirtualDisplay(packageName: String): Boolean {
    val targetPkg = packageName.trim().takeIf { it.isNotEmpty() }
      ?: activePackageRef.get()
      ?: return false
    val displayId = ensureVirtualDisplay(currentWidth, currentHeight, currentDpi)

    var moved = startPackageOnDisplayViaContext(
      packageName = targetPkg,
      targetDisplayId = displayId,
      reorderOnly = true
    )

    val component = resolveLaunchComponent(targetPkg)
    if (component != null) {
      val cmd = "am start --display $displayId --activity-reorder-to-front -n ${
        escapeShellToken(component.flattenToShortString())
      }"
      if (privilegeEngine.executeShell(cmd, timeoutMs = 6_000L).ok) {
        moved = true
      }
    }

    if (moved) {
      activePackageRef.set(targetPkg)
      mainScreenTakeoverActive.set(false)
      notifyStateListeners()
    }
    return moved
  }

  private fun startPackageOnDisplayViaContext(
    packageName: String,
    targetDisplayId: Int,
    reorderOnly: Boolean
  ): Boolean {
    val launchIntent = appContext.packageManager.getLaunchIntentForPackage(packageName)
      ?: return false
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (reorderOnly) {
      launchIntent.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    } else {
      launchIntent.addFlags(Intent.FLAG_ACTIVITY_MULTIPLE_TASK)
    }
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val options = ActivityOptions.makeBasic().setLaunchDisplayId(targetDisplayId)
        appContext.startActivity(launchIntent, options.toBundle())
      } else {
        appContext.startActivity(launchIntent)
      }
      true
    } catch (_: Throwable) {
      false
    }
  }

  private fun resolveLaunchComponent(packageName: String): ComponentName? {
    return try {
      appContext.packageManager.getLaunchIntentForPackage(packageName)?.component
    } catch (_: Throwable) {
      null
    }
  }

  fun executeDisplayAction(action: Map<String, Any?>): Map<String, Any?> {
    if (emergencyStoppedState.get()) {
      return mapOf(
        "ok" to false,
        "error" to "ERR_EMERGENCY_STOPPED: Phone execution halted by emergency stop"
      )
    }
    if (pausedState.get()) {
      return mapOf(
        "ok" to false,
        "error" to "ERR_PAUSED: Phone execution is currently paused"
      )
    }

    val powerManager = appContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
    if (powerManager != null && !powerManager.isInteractive) {
      triggerEmergencyStop()
      return mapOf(
        "ok" to false,
        "error" to "ERR_SCREEN_OFF: Physical screen turned off; halted phone operation"
      )
    }

    val displayId = ensureVirtualDisplay(currentWidth, currentHeight, currentDpi)
    val type = (action["type"] ?: action["action"] ?: action["kind"])
      ?.toString()
      ?.trim()
      ?.lowercase(Locale.ROOT)
      ?: ""
    val unlocked = action["unlocked"] == true

    if (type != "list_apps" && type != "clipboard") {
      val candidatePkg = action["packageName"]?.toString()?.trim()?.takeIf { it.isNotEmpty() }
        ?: if (type != "launch_app") activePackageRef.get() else null
      if (!unlocked && isBlockedPhonePackage(candidatePkg)) {
        return mapOf(
          "ok" to false,
          "displayId" to displayId,
          "packageName" to candidatePkg,
          "error" to "ERR_SAFETY_BLOCKED_PACKAGE: Package $candidatePkg is hard-locked by native SafetyGate"
        )
      }
    }

    return when (type) {
      "launch_app" -> executeLaunchAppAction(displayId, action, unlocked)
      "list_apps" -> mapOf(
        "ok" to true,
        "action" to "list_apps",
        "displayId" to displayId,
        "apps" to listInstalledApps()
      )
      "tap" -> executeTapAction(displayId, action)
      "type" -> executeTypeAction(displayId, action)
      "scroll" -> executeScrollAction(displayId, action)
      "swipe" -> executeSwipeAction(displayId, action)
      "back" -> executeBackAction(displayId)
      "intent" -> executeIntentAction(displayId, action)
      "clipboard" -> executeClipboardAction(action)
      "observe" -> executeObserveAction(displayId, action, unlocked)
      else -> mapOf(
        "ok" to false,
        "displayId" to displayId,
        "error" to "Unsupported display action type: $type"
      )
    }
  }

  private fun executeLaunchAppAction(
    displayId: Int,
    action: Map<String, Any?>,
    unlocked: Boolean
  ): Map<String, Any?> {
    val pkg = action["packageName"]?.toString()?.trim().orEmpty()
    if (pkg.isEmpty()) {
      return mapOf(
        "ok" to false,
        "displayId" to displayId,
        "error" to "launch_app requires a non-empty packageName"
      )
    }
    if (!unlocked && isBlockedPhonePackage(pkg)) {
      return mapOf(
        "ok" to false,
        "displayId" to displayId,
        "packageName" to pkg,
        "error" to "ERR_SAFETY_BLOCKED_PACKAGE: Package $pkg is hard-locked by native SafetyGate"
      )
    }
    val launched = launchAppOnVirtualDisplay(pkg, unlocked)
    if (!launched) {
      return mapOf(
        "ok" to false,
        "displayId" to displayId,
        "packageName" to pkg,
        "error" to "Failed to launch package $pkg on VirtualDisplay #$displayId"
      )
    }
    val observed = LinkedHashMap(executeObserveAction(displayId, action, unlocked))
    observed["action"] = "launch_app"
    observed["ok"] = observed["ok"] != false
    return observed
  }

  private fun executeTapAction(displayId: Int, action: Map<String, Any?>): Map<String, Any?> {
    val rawRef = (action["elementId"] ?: action["ref"])?.toString()?.trim()
    val normalizedId = rawRef?.removePrefix("@")
    val cachedCoords = if (!normalizedId.isNullOrEmpty()) {
      synchronized(elementBoundsCache) { elementBoundsCache[normalizedId] }
    } else {
      null
    }
    val x = toIntOrNull(action["x"]) ?: cachedCoords?.first
    val y = toIntOrNull(action["y"]) ?: cachedCoords?.second
    if (x == null || y == null) {
      return mapOf(
        "ok" to false,
        "displayId" to displayId,
        "error" to "Tap requires valid (x, y) coordinates or known elementId"
      )
    }

    lastTapX = x
    lastTapY = y
    notifyStateListeners()

    val res = privilegeEngine.executeShell("input -d $displayId tap $x $y", timeoutMs = 6_000L)
    return mapOf(
      "ok" to res.ok,
      "action" to "tap",
      "displayId" to displayId,
      "x" to x,
      "y" to y,
      "lastTapX" to x,
      "lastTapY" to y,
      "stderr" to res.stderr.takeIf { it.isNotBlank() }
    )
  }

  private fun executeTypeAction(displayId: Int, action: Map<String, Any?>): Map<String, Any?> {
    val text = action["text"]?.toString() ?: ""
    val submit = action["submit"] == true
    if (text.isEmpty() && !submit) {
      return mapOf("ok" to true, "action" to "type", "displayId" to displayId)
    }

    val isAsciiOnly = text.all { ch -> ch.code in 0x20..0x7E }
    val typedOk = if (isAsciiOnly && text.isNotEmpty()) {
      val escaped = escapeInputTextAscii(text)
      privilegeEngine.executeShell("input -d $displayId text $escaped", timeoutMs = 8_000L).ok
    } else if (text.isNotEmpty()) {
      setSystemClipboardText(text)
      SystemClock.sleep(60L)
      privilegeEngine.executeShell("input -d $displayId keyevent 279", timeoutMs = 6_000L).ok
    } else {
      true
    }

    if (submit) {
      privilegeEngine.executeShell("input -d $displayId keyevent 66", timeoutMs = 4_000L)
    }

    return mapOf(
      "ok" to typedOk,
      "action" to "type",
      "displayId" to displayId,
      "submitted" to submit
    )
  }

  private fun executeScrollAction(displayId: Int, action: Map<String, Any?>): Map<String, Any?> {
    val direction = action["direction"]?.toString()?.trim()?.lowercase(Locale.ROOT) ?: "down"
    val distance = (toIntOrNull(action["distance"]) ?: (currentHeight * 0.42).roundToInt())
      .coerceIn(80, currentHeight - 100)
    val durationMs = (toIntOrNull(action["durationMs"]) ?: 320).coerceIn(80, 2_500)
    val cx = currentWidth / 2
    val cy = currentHeight / 2
    val half = distance / 2

    // Note: scrolling "down" a feed drags content upward on the touch screen.
    val (x1, y1, x2, y2) = when (direction) {
      "up" -> listOf(cx, (cy - half).coerceAtLeast(80), cx, (cy + half).coerceAtMost(currentHeight - 80))
      "left" -> listOf((cx - half).coerceAtLeast(60), cy, (cx + half).coerceAtMost(currentWidth - 60), cy)
      "right" -> listOf((cx + half).coerceAtMost(currentWidth - 60), cy, (cx - half).coerceAtLeast(60), cy)
      else -> listOf(cx, (cy + half).coerceAtMost(currentHeight - 80), cx, (cy - half).coerceAtLeast(80))
    }

    lastTapX = x2
    lastTapY = y2
    notifyStateListeners()

    val res = privilegeEngine.executeShell(
      "input -d $displayId swipe $x1 $y1 $x2 $y2 $durationMs",
      timeoutMs = (durationMs + 5_000).toLong()
    )
    return mapOf(
      "ok" to res.ok,
      "action" to "scroll",
      "direction" to direction,
      "displayId" to displayId,
      "startX" to x1,
      "startY" to y1,
      "endX" to x2,
      "endY" to y2
    )
  }

  private fun executeSwipeAction(displayId: Int, action: Map<String, Any?>): Map<String, Any?> {
    val startX = toIntOrNull(action["startX"]) ?: (currentWidth / 2)
    val startY = toIntOrNull(action["startY"]) ?: (currentHeight * 2 / 3)
    val endX = toIntOrNull(action["endX"]) ?: (currentWidth / 2)
    val endY = toIntOrNull(action["endY"]) ?: (currentHeight / 3)
    val durationMs = (toIntOrNull(action["durationMs"]) ?: 300).coerceIn(50, 3_000)

    lastTapX = endX
    lastTapY = endY
    notifyStateListeners()

    val res = privilegeEngine.executeShell(
      "input -d $displayId swipe $startX $startY $endX $endY $durationMs",
      timeoutMs = (durationMs + 5_000).toLong()
    )
    return mapOf(
      "ok" to res.ok,
      "action" to "swipe",
      "displayId" to displayId,
      "startX" to startX,
      "startY" to startY,
      "endX" to endX,
      "endY" to endY,
      "durationMs" to durationMs
    )
  }

  private fun executeBackAction(displayId: Int): Map<String, Any?> {
    val res = privilegeEngine.executeShell("input -d $displayId keyevent 4", timeoutMs = 5_000L)
    return mapOf(
      "ok" to res.ok,
      "action" to "back",
      "displayId" to displayId
    )
  }

  private fun executeIntentAction(displayId: Int, action: Map<String, Any?>): Map<String, Any?> {
    val intentAction = action["intentAction"]?.toString()?.trim()?.takeIf { it.isNotEmpty() }
      ?: Intent.ACTION_VIEW
    val dataUri = action["dataUri"]?.toString()?.trim()?.takeIf { it.isNotEmpty() }
      ?: action["uri"]?.toString()?.trim()?.takeIf { it.isNotEmpty() }
    val targetPkg = action["packageName"]?.toString()?.trim()?.takeIf { it.isNotEmpty() }

    val intent = Intent(intentAction).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      if (dataUri != null) {
        data = Uri.parse(dataUri)
      }
      if (targetPkg != null) {
        setPackage(targetPkg)
      }
      val extras = action["extras"] as? Map<*, *>
      extras?.forEach { (k, v) ->
        val key = k?.toString() ?: return@forEach
        when (v) {
          is String -> putExtra(key, v)
          is Boolean -> putExtra(key, v)
          is Int -> putExtra(key, v)
          is Long -> putExtra(key, v)
          is Double -> putExtra(key, v)
        }
      }
    }

    var started = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val opts = ActivityOptions.makeBasic().setLaunchDisplayId(displayId)
        appContext.startActivity(intent, opts.toBundle())
      } else {
        appContext.startActivity(intent)
      }
      true
    } catch (_: Throwable) {
      false
    }

    if (!started) {
      val cmdParts = mutableListOf("am", "start", "--display", displayId.toString(), "-a", escapeShellToken(intentAction))
      if (dataUri != null) {
        cmdParts.add("-d")
        cmdParts.add(escapeShellToken(dataUri))
      }
      if (targetPkg != null) {
        cmdParts.add("-p")
        cmdParts.add(escapeShellToken(targetPkg))
      }
      started = privilegeEngine.executeShell(cmdParts.joinToString(" "), timeoutMs = 6_000L).ok
    }

    if (started && targetPkg != null) {
      activePackageRef.set(targetPkg)
    }

    return mapOf(
      "ok" to started,
      "action" to "intent",
      "displayId" to displayId,
      "intentAction" to intentAction,
      "dataUri" to dataUri,
      "packageName" to targetPkg
    )
  }

  private fun executeClipboardAction(action: Map<String, Any?>): Map<String, Any?> {
    val mode = action["mode"]?.toString()?.trim()?.lowercase(Locale.ROOT)
      ?: if (action.containsKey("text")) "set" else "get"
    return if (mode == "set") {
      val text = action["text"]?.toString() ?: ""
      val ok = setSystemClipboardText(text)
      mapOf("ok" to ok, "action" to "clipboard", "mode" to "set", "length" to text.length)
    } else {
      val text = getSystemClipboardText()
      mapOf("ok" to true, "action" to "clipboard", "mode" to "get", "text" to text)
    }
  }

  private fun executeObserveAction(
    displayId: Int,
    action: Map<String, Any?>,
    unlocked: Boolean = false
  ): Map<String, Any?> {
    val includeScreenshot = action["includeScreenshot"] == true
    val maxLongEdge = toIntOrNull(action["maxLongEdge"]) ?: 1080
    val quality = toIntOrNull(action["quality"]) ?: 72

    val dumpFile = "/data/local/tmp/pavra_uidump_$displayId.xml"
    val dumpRes = privilegeEngine.executeShell(
      "uiautomator dump $dumpFile >/dev/null 2>&1 && cat $dumpFile",
      timeoutMs = 10_000L
    )
    val xmlText = dumpRes.stdout
    val parsed = parseUiAutomatorXml(xmlText)
    val foregroundPkg = parsed.packageName ?: activePackageRef.get() ?: appContext.packageName
    if (!unlocked && isBlockedPhonePackage(foregroundPkg)) {
      return mapOf(
        "ok" to false,
        "action" to "observe",
        "displayId" to displayId,
        "packageName" to foregroundPkg,
        "error" to "ERR_SAFETY_BLOCKED_PACKAGE: Package $foregroundPkg is hard-locked by native SafetyGate"
      )
    }
    val isSecure = detectFlagSecureWindow(displayId)

    val frameMap = if (includeScreenshot && !isSecure) {
      captureFrameJpegBase64(maxLongEdge = maxLongEdge, quality = quality)
    } else {
      null
    }

    return mapOf(
      "ok" to true,
      "action" to "observe",
      "displayId" to displayId,
      "packageName" to foregroundPkg,
      "appName" to resolveAppLabel(foregroundPkg),
      "activityName" to parsed.activityName,
      "isSecureFlag" to isSecure,
      "screenWidth" to currentWidth,
      "screenHeight" to currentHeight,
      "lastTapX" to lastTapX,
      "lastTapY" to lastTapY,
      "capturedAt" to System.currentTimeMillis(),
      "elements" to parsed.elements,
      "screenshotBase64" to frameMap?.get("base64"),
      "mimeType" to if (frameMap?.get("base64") != null) "image/jpeg" else null
    )
  }

  private data class ParsedUiHierarchy(
    val packageName: String?,
    val activityName: String?,
    val elements: List<Map<String, Any?>>
  )

  private fun parseUiAutomatorXml(xml: String): ParsedUiHierarchy {
    val trimmed = xml.trim()
    val xmlStart = trimmed.indexOf("<?xml").takeIf { it >= 0 } ?: trimmed.indexOf("<hierarchy")
    if (xmlStart < 0) {
      return ParsedUiHierarchy(packageName = activePackageRef.get(), activityName = null, elements = emptyList())
    }
    val cleanXml = trimmed.substring(xmlStart)
    val elements = ArrayList<Map<String, Any?>>()
    var detectedPkg: String? = null
    val nextCenters = LinkedHashMap<String, Pair<Int, Int>>()

    try {
      val parser = Xml.newPullParser()
      parser.setInput(StringReader(cleanXml))
      var event = parser.eventType
      var seq = 0
      while (event != XmlPullParser.END_DOCUMENT && elements.size < 250) {
        if (event == XmlPullParser.START_TAG && parser.name == "node") {
          val text = parser.getAttributeValue(null, "text").orEmpty()
          val contentDesc = parser.getAttributeValue(null, "content-desc").orEmpty()
          val resourceId = parser.getAttributeValue(null, "resource-id").orEmpty()
          val className = parser.getAttributeValue(null, "class").orEmpty()
          val pkg = parser.getAttributeValue(null, "package").orEmpty()
          val clickable = parser.getAttributeValue(null, "clickable") == "true"
          val scrollable = parser.getAttributeValue(null, "scrollable") == "true"
          val password = parser.getAttributeValue(null, "password") == "true"
          val focusable = parser.getAttributeValue(null, "focusable") == "true"
          val boundsRaw = parser.getAttributeValue(null, "bounds").orEmpty()

          if (detectedPkg == null && pkg.isNotBlank() && pkg != "com.android.systemui") {
            detectedPkg = pkg
          }

          val isEditable = className.contains("EditText", ignoreCase = true) || password
          val hasSemanticInfo = text.isNotBlank() ||
            contentDesc.isNotBlank() ||
            clickable ||
            scrollable ||
            isEditable

          val boundsMatch = REGEX_BOUNDS.find(boundsRaw)
          if (hasSemanticInfo && boundsMatch != null) {
            val left = boundsMatch.groupValues[1].toIntOrNull() ?: 0
            val top = boundsMatch.groupValues[2].toIntOrNull() ?: 0
            val right = boundsMatch.groupValues[3].toIntOrNull() ?: 0
            val bottom = boundsMatch.groupValues[4].toIntOrNull() ?: 0
            if (right > left && bottom > top) {
              seq += 1
              val id = "e$seq"
              val centerX = (left + right) / 2
              val centerY = (top + bottom) / 2
              nextCenters[id] = Pair(centerX, centerY)
              val safeText = if (password) "••••" else redactPiiText(text)
              val safeDesc = if (password) "••••" else redactPiiText(contentDesc)
              elements.add(
                mapOf(
                  "id" to id,
                  "ref" to "@$id",
                  "index" to seq,
                  "text" to safeText,
                  "contentDesc" to safeDesc,
                  "contentDescription" to safeDesc,
                  "resourceId" to resourceId,
                  "className" to className,
                  "packageName" to pkg,
                  "clickable" to clickable,
                  "scrollable" to scrollable,
                  "editable" to isEditable,
                  "focusable" to focusable,
                  "password" to password,
                  "x" to centerX,
                  "y" to centerY,
                  "bounds" to mapOf(
                    "left" to left,
                    "top" to top,
                    "right" to right,
                    "bottom" to bottom,
                    "centerX" to centerX,
                    "centerY" to centerY
                  )
                )
              )
            }
          }
        }
        event = parser.next()
      }
    } catch (_: Throwable) {
    }

    synchronized(elementBoundsCache) {
      elementBoundsCache.clear()
      elementBoundsCache.putAll(nextCenters)
    }

    return ParsedUiHierarchy(
      packageName = detectedPkg ?: activePackageRef.get(),
      activityName = null,
      elements = elements
    )
  }

  private fun detectFlagSecureWindow(displayId: Int): Boolean {
    val res = privilegeEngine.executeShell(
      "dumpsys window displays | grep -A 12 -E 'Display: mDisplayId=$displayId|displayId=$displayId'",
      timeoutMs = 3_500L
    )
    return res.ok && res.stdout.contains("FLAG_SECURE")
  }

  fun listInstalledApps(): List<Map<String, Any?>> {
    val pm = appContext.packageManager
    val launcherIntent = Intent(Intent.ACTION_MAIN).apply {
      addCategory(Intent.CATEGORY_LAUNCHER)
    }
    val resolved = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        pm.queryIntentActivities(launcherIntent, PackageManager.ResolveInfoFlags.of(0))
      } else {
        @Suppress("DEPRECATION")
        pm.queryIntentActivities(launcherIntent, 0)
      }
    } catch (_: Throwable) {
      emptyList()
    }

    val seen = HashSet<String>()
    val apps = ArrayList<Map<String, Any?>>()
    for (info in resolved) {
      val activityInfo = info.activityInfo ?: continue
      val pkg = activityInfo.packageName ?: continue
      if (!seen.add(pkg)) continue
      val label = try {
        info.loadLabel(pm)?.toString()?.takeIf { it.isNotBlank() } ?: pkg
      } catch (_: Throwable) {
        pkg
      }
      val appFlags = activityInfo.applicationInfo?.flags ?: 0
      val isSystem = (appFlags and ApplicationInfo.FLAG_SYSTEM) != 0
      apps.add(
        mapOf(
          "packageName" to pkg,
          "label" to label,
          "activityName" to activityInfo.name,
          "isSystemApp" to isSystem
        )
      )
    }
    apps.sortBy { (it["label"] as? String)?.lowercase(Locale.ROOT) ?: "" }
    return apps
  }

  fun resolveAppLabel(packageName: String): String {
    val pm = appContext.packageManager
    return try {
      val appInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        pm.getApplicationInfo(packageName, PackageManager.ApplicationInfoFlags.of(0))
      } else {
        @Suppress("DEPRECATION")
        pm.getApplicationInfo(packageName, 0)
      }
      pm.getApplicationLabel(appInfo)?.toString()?.takeIf { it.isNotBlank() } ?: packageName
    } catch (_: Throwable) {
      packageName
    }
  }

  private fun setSystemClipboardText(text: String): Boolean {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      return writeClipboardOnMain(text)
    }
    val latch = CountDownLatch(1)
    var ok = false
    mainHandler.post {
      ok = writeClipboardOnMain(text)
      latch.countDown()
    }
    latch.await(1_500L, TimeUnit.MILLISECONDS)
    return ok
  }

  private fun writeClipboardOnMain(text: String): Boolean {
    return try {
      val cm = appContext.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        ?: return false
      cm.setPrimaryClip(ClipData.newPlainText("pavra", text))
      true
    } catch (_: Throwable) {
      false
    }
  }

  private fun getSystemClipboardText(): String {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      return readClipboardOnMain()
    }
    val latch = CountDownLatch(1)
    var value = ""
    mainHandler.post {
      value = readClipboardOnMain()
      latch.countDown()
    }
    latch.await(1_500L, TimeUnit.MILLISECONDS)
    return value
  }

  private fun readClipboardOnMain(): String {
    return try {
      val cm = appContext.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        ?: return ""
      val item = cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)
      item?.coerceToText(appContext)?.toString() ?: ""
    } catch (_: Throwable) {
      ""
    }
  }

  private fun toIntOrNull(raw: Any?): Int? {
    return when (raw) {
      is Int -> raw
      is Long -> raw.toInt()
      is Double -> if (raw.isFinite()) raw.roundToInt() else null
      is Float -> if (raw.isFinite()) raw.roundToInt() else null
      is Number -> raw.toInt()
      is String -> raw.trim().toDoubleOrNull()?.roundToInt()
      else -> null
    }
  }

  private fun escapeShellToken(raw: String): String {
    return "'" + raw.replace("'", "'\\''") + "'"
  }

  private fun escapeInputTextAscii(text: String): String {
    val spaced = text.replace(" ", "%s")
    return escapeShellToken(spaced)
  }

  companion object {
    const val VIRTUAL_DISPLAY_NAME = "PavraAssistantDisplay"
    const val DEFAULT_WIDTH = 1080
    const val DEFAULT_HEIGHT = 2400
    const val DEFAULT_DPI = 420

    private val HARD_BLOCKED_PACKAGES = setOf(
      "com.icbc",
      "com.chinamworld.main",
      "com.cmbchina.ccd.pluto.cmbactivity",
      "com.abchina.ebank",
      "com.bankcomm.bankcomm",
      "com.boc.bocsoft.phone",
      "com.pingan.paces.ccms",
      "com.eastmoney.android.berlin",
      "com.hexin.plat.android",
      "com.android.permissioncontroller",
      "com.google.android.permissioncontroller",
      "com.oldpan.pavra",
      "sh.paseo",
      "sh.paseo.debug"
    )

    private val HARD_BLOCKED_PREFIXES = listOf(
      "com.icbc.",
      "com.chinamworld.",
      "com.cmbchina.",
      "com.abchina.",
      "com.bankcomm.",
      "com.eastmoney."
    )

    private val REGEX_CN_RESIDENT_ID = Regex(
      "(?<!\\d)\\d{6}(?:19|20)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx](?!\\d)"
    )
    private val REGEX_BANK_CARD = Regex(
      "(?<!\\d)(?:\\d[ -]?){15,18}\\d(?!\\d)"
    )
    private val REGEX_BOUNDS = Regex("\\[(\\d+),(\\d+)]\\[(\\d+),(\\d+)]")
  }
}
