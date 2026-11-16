package expo.modules.pavrakeepalive

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.display.DisplayManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.text.TextUtils
import android.util.TypedValue
import android.view.Display
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.Locale
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.roundToInt

class PavraFloatingOverlayController(
  context: Context,
  private val virtualDisplayController: PavraVirtualDisplayController
) {
  private val appContext: Context = context.applicationContext
  private val mainHandler = Handler(Looper.getMainLooper())
  private val refreshScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private var refreshJob: Job? = null

  private var rootContainer: FrameLayout? = null
  private var capsuleView: LinearLayout? = null
  private var capsuleStatusDot: View? = null
  private var capsuleLabelView: TextView? = null

  private var miniWindowView: LinearLayout? = null
  private var miniHeaderTitleView: TextView? = null
  private var miniViewportLayout: FrameLayout? = null
  private var miniScreenImageView: ImageView? = null
  private var miniTapDotView: View? = null
  private var miniStepCaptionView: TextView? = null
  private var miniPauseBtn: TextView? = null
  private var miniTakeoverBtn: TextView? = null

  private var layoutParams: WindowManager.LayoutParams? = null
  private var isAddedToWindowManager = false

  @Volatile
  private var currentMode: String = MODE_CAPSULE

  @Volatile
  private var assistantName: String = "Assistant"

  @Volatile
  private var appName: String = "Android"

  @Volatile
  private var packageName: String = ""

  @Volatile
  private var stepText: String = "Ready"

  @Volatile
  private var paused: Boolean = false

  @Volatile
  private var takeoverActive: Boolean = false

  @Volatile
  private var overrideTapX: Int? = null

  @Volatile
  private var overrideTapY: Int? = null

  @Volatile
  private var overrideScreenW: Int = PavraVirtualDisplayController.DEFAULT_WIDTH

  @Volatile
  private var overrideScreenH: Int = PavraVirtualDisplayController.DEFAULT_HEIGHT

  private val actionListeners = CopyOnWriteArraySet<(Map<String, Any?>) -> Unit>()

  private val displayStateListener: () -> Unit = {
    mainHandler.post {
      if (isAddedToWindowManager) {
        paused = virtualDisplayController.isPaused()
        takeoverActive = virtualDisplayController.isOnMainScreenTakeover()
        syncViewsOnMain()
      }
    }
  }

  init {
    virtualDisplayController.addStateListener(displayStateListener)
  }

  fun addActionListener(listener: (Map<String, Any?>) -> Unit) {
    actionListeners.add(listener)
  }

  fun removeActionListener(listener: (Map<String, Any?>) -> Unit) {
    actionListeners.remove(listener)
  }

  private fun emitOverlayAction(action: String, extra: Map<String, Any?> = emptyMap()) {
    val payload = LinkedHashMap<String, Any?>().apply {
      put("action", action)
      put("mode", currentMode)
      put("paused", paused)
      put("onMainScreenTakeover", takeoverActive)
      put("packageName", packageName.ifBlank { virtualDisplayController.getActivePackageName() })
      put("timestamp", System.currentTimeMillis())
      putAll(extra)
    }
    for (listener in actionListeners) {
      try {
        listener(payload)
      } catch (_: Throwable) {
      }
    }
  }

  fun canDrawOverlays(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      Settings.canDrawOverlays(appContext)
    } else {
      true
    }
  }

  fun openOverlayPermissionSettings(): Boolean {
    val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${appContext.packageName}")
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    } else {
      Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
        data = Uri.parse("package:${appContext.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
    }
    return try {
      appContext.startActivity(intent)
      true
    } catch (_: Throwable) {
      false
    }
  }

  fun showOrUpdateOverlay(state: Map<String, Any?>): Map<String, Any?> {
    applyStateFields(state)
    val granted = canDrawOverlays()
    if (!granted) {
      return getOverlayStateMap(permissionGranted = false)
    }
    runOnMainSync {
      ensureOverlayAttachedOnMain()
      syncViewsOnMain()
      syncLiveFrameLoopOnMain()
    }
    return getOverlayStateMap(permissionGranted = true)
  }

  fun setOverlayMode(mode: String): Map<String, Any?> {
    val normalized = normalizeMode(mode)
    currentMode = normalized
    if (isAddedToWindowManager) {
      runOnMainSync {
        applyWindowDimensionsForModeOnMain()
        syncViewsOnMain()
        syncLiveFrameLoopOnMain()
      }
    }
    emitOverlayAction("mode_changed", mapOf("mode" to normalized))
    return getOverlayStateMap()
  }

  fun hideOverlay(): Boolean {
    runOnMainSync {
      stopLiveFrameLoopOnMain()
      removeOverlayFromWindowManagerOnMain()
    }
    return true
  }

  fun triggerHardwareEmergencyStop(source: String = "api"): Map<String, Any?> {
    vibrateEmergencyStop()
    virtualDisplayController.triggerEmergencyStop()
    paused = false
    stepText = "急停已触发"
    runOnMainSync {
      stopLiveFrameLoopOnMain()
      removeOverlayFromWindowManagerOnMain()
    }
    emitOverlayAction("emergency_stop", mapOf("source" to source))
    return getOverlayStateMap()
  }

  fun getOverlayStateMap(permissionGranted: Boolean? = null): Map<String, Any?> {
    val granted = permissionGranted ?: canDrawOverlays()
    return mapOf(
      "visible" to isAddedToWindowManager,
      "mode" to currentMode,
      "overlayPermissionGranted" to granted,
      "assistantName" to assistantName,
      "appName" to appName,
      "packageName" to packageName,
      "stepText" to stepText,
      "paused" to paused,
      "onMainScreenTakeover" to takeoverActive,
      "displayId" to virtualDisplayController.getVirtualDisplayId(),
      "lastTapX" to (overrideTapX ?: virtualDisplayController.lastTapX),
      "lastTapY" to (overrideTapY ?: virtualDisplayController.lastTapY)
    )
  }

  private fun applyStateFields(state: Map<String, Any?>) {
    state["mode"]?.toString()?.let { currentMode = normalizeMode(it) }
    state["assistantName"]?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { assistantName = it }
    state["appName"]?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { appName = it }
    state["packageName"]?.toString()?.trim()?.let {
      if (it.isNotEmpty()) packageName = it
    }
    state["stepText"]?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { stepText = it }
    (state["paused"] as? Boolean)?.let {
      paused = it
      virtualDisplayController.setPaused(it)
    }
    (state["onMainScreenTakeover"] as? Boolean)?.let { takeoverActive = it }
    if (state.containsKey("lastTapX")) {
      overrideTapX = parseCoord(state["lastTapX"])
    }
    if (state.containsKey("lastTapY")) {
      overrideTapY = parseCoord(state["lastTapY"])
    }
    parseCoord(state["screenWidth"])?.takeIf { it > 0 }?.let { overrideScreenW = it }
    parseCoord(state["screenHeight"])?.takeIf { it > 0 }?.let { overrideScreenH = it }
  }

  private fun parseCoord(raw: Any?): Int? {
    return when (raw) {
      is Int -> raw
      is Long -> raw.toInt()
      is Double -> if (raw.isFinite()) raw.roundToInt() else null
      is Float -> if (raw.isFinite()) raw.roundToInt() else null
      is Number -> raw.toInt()
      else -> null
    }
  }

  private fun normalizeMode(raw: String?): String {
    return if (raw?.trim()?.lowercase(Locale.ROOT) == MODE_MINI_WINDOW) {
      MODE_MINI_WINDOW
    } else {
      MODE_CAPSULE
    }
  }

  private fun resolveMainScreenWindowManager(): WindowManager {
    val displayManager = appContext.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
    val defaultDisplay = displayManager?.getDisplay(Display.DEFAULT_DISPLAY)
    if (defaultDisplay != null) {
      val displayCtx = appContext.createDisplayContext(defaultDisplay)
      val wm = displayCtx.getSystemService(WindowManager::class.java)
      if (wm != null) return wm
    }
    return appContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  }

  private fun getScreenBoundsPx(wm: WindowManager): Pair<Int, Int> {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val b = wm.currentWindowMetrics.bounds
      Pair(b.width().coerceAtLeast(360), b.height().coerceAtLeast(640))
    } else {
      val dm = appContext.resources.displayMetrics
      Pair(dm.widthPixels.coerceAtLeast(360), dm.heightPixels.coerceAtLeast(640))
    }
  }

  private fun dp(value: Int): Int {
    return TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      value.toFloat(),
      appContext.resources.displayMetrics
    ).roundToInt()
  }

  private fun ensureOverlayAttachedOnMain() {
    if (isAddedToWindowManager && rootContainer != null) {
      applyWindowDimensionsForModeOnMain()
      return
    }

    val wm = resolveMainScreenWindowManager()
    val (screenW, _) = getScreenBoundsPx(wm)

    val root = FrameLayout(appContext)
    val capsule = buildCapsuleViewOnMain()
    val mini = buildMiniWindowViewOnMain()
    root.addView(capsule)
    root.addView(mini)

    val windowType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

    val initialWidth = if (currentMode == MODE_MINI_WINDOW) dp(MINI_WINDOW_WIDTH_DP) else WindowManager.LayoutParams.WRAP_CONTENT
    val initialHeight = if (currentMode == MODE_MINI_WINDOW) dp(MINI_WINDOW_HEIGHT_DP) else WindowManager.LayoutParams.WRAP_CONTENT

    val params = WindowManager.LayoutParams(
      initialWidth,
      initialHeight,
      windowType,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = (screenW - dp(180)).coerceAtLeast(dp(8))
      y = dp(128)
    }

    try {
      wm.addView(root, params)
      rootContainer = root
      layoutParams = params
      isAddedToWindowManager = true
    } catch (_: Throwable) {
      isAddedToWindowManager = false
    }
  }

  private fun applyWindowDimensionsForModeOnMain() {
    val root = rootContainer ?: return
    val params = layoutParams ?: return
    if (!isAddedToWindowManager) return
    val wm = resolveMainScreenWindowManager()
    if (currentMode == MODE_MINI_WINDOW) {
      params.width = dp(MINI_WINDOW_WIDTH_DP)
      params.height = dp(MINI_WINDOW_HEIGHT_DP)
    } else {
      params.width = WindowManager.LayoutParams.WRAP_CONTENT
      params.height = WindowManager.LayoutParams.WRAP_CONTENT
    }
    try {
      wm.updateViewLayout(root, params)
    } catch (_: Throwable) {
    }
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun buildCapsuleViewOnMain(): LinearLayout {
    val container = LinearLayout(appContext).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(12), dp(8), dp(14), dp(8))
      background = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = dp(20).toFloat()
        setColor(Color.parseColor("#E6131619"))
        setStroke(dp(2), Color.parseColor("#F59E0B"))
      }
    }

    val dot = View(appContext).apply {
      layoutParams = LinearLayout.LayoutParams(dp(8), dp(8)).apply {
        marginEnd = dp(8)
      }
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor("#22C55E"))
      }
    }

    val label = TextView(appContext).apply {
      maxWidth = dp(220)
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
      setTextColor(Color.parseColor("#F9FAFB"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
      typeface = Typeface.DEFAULT_BOLD
    }

    container.addView(dot)
    container.addView(label)

    // Gesture: Drag along edges + 1000ms Long-Press Hardware Emergency Stop + Tap to Expand.
    attachDragAndGestureListener(
      target = container,
      snapToEdgeOnRelease = true,
      longPressDurationMs = EMERGENCY_LONG_PRESS_MS,
      onLongPress = {
        triggerHardwareEmergencyStop(source = "capsule_long_press")
      },
      onTap = {
        currentMode = MODE_MINI_WINDOW
        applyWindowDimensionsForModeOnMain()
        syncViewsOnMain()
        syncLiveFrameLoopOnMain()
        emitOverlayAction("mode_changed", mapOf("mode" to MODE_MINI_WINDOW))
      }
    )

    capsuleView = container
    capsuleStatusDot = dot
    capsuleLabelView = label
    return container
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun buildMiniWindowViewOnMain(): LinearLayout {
    val outer = LinearLayout(appContext).apply {
      orientation = LinearLayout.VERTICAL
      layoutParams = FrameLayout.LayoutParams(dp(MINI_WINDOW_WIDTH_DP), dp(MINI_WINDOW_HEIGHT_DP))
      background = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = dp(12).toFloat()
        setColor(Color.parseColor("#F2111317"))
        setStroke(dp(2), Color.parseColor("#E5E7EB"))
      }
      setPadding(dp(4), dp(4), dp(4), dp(4))
    }

    // 1. Header bar (draggable + collapse button)
    val header = LinearLayout(appContext).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(6), dp(4), dp(4), dp(4))
    }

    val headerTitle = TextView(appContext).apply {
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
      setTextColor(Color.parseColor("#F9FAFB"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
      typeface = Typeface.DEFAULT_BOLD
    }

    val collapseBtn = TextView(appContext).apply {
      text = "收起"
      setTextColor(Color.parseColor("#D1D5DB"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
      setPadding(dp(6), dp(2), dp(6), dp(2))
      background = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = dp(6).toFloat()
        setColor(Color.parseColor("#272B33"))
      }
      setOnClickListener {
        currentMode = MODE_CAPSULE
        applyWindowDimensionsForModeOnMain()
        syncViewsOnMain()
        syncLiveFrameLoopOnMain()
        emitOverlayAction("mode_changed", mapOf("mode" to MODE_CAPSULE))
      }
    }

    header.addView(headerTitle)
    header.addView(collapseBtn)

    attachDragAndGestureListener(
      target = header,
      snapToEdgeOnRelease = false,
      longPressDurationMs = null,
      onLongPress = null,
      onTap = null
    )

    // 2. Live VirtualDisplay viewport + red tap dot + step strip
    val viewport = FrameLayout(appContext).apply {
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        0,
        1f
      ).apply {
        topMargin = dp(2)
        bottomMargin = dp(4)
      }
      background = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = dp(8).toFloat()
        setColor(Color.parseColor("#090B0E"))
      }
    }

    val screenImg = ImageView(appContext).apply {
      layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT
      )
      scaleType = ImageView.ScaleType.FIT_CENTER
    }

    val tapDotSizePx = dp(12)
    val tapDot = View(appContext).apply {
      layoutParams = FrameLayout.LayoutParams(tapDotSizePx, tapDotSizePx, Gravity.TOP or Gravity.START)
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor("#EF4444"))
        setStroke(dp(2), Color.WHITE)
      }
      visibility = View.GONE
    }

    val stepCaption = TextView(appContext).apply {
      layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
        Gravity.BOTTOM
      )
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
      setPadding(dp(6), dp(3), dp(6), dp(3))
      setBackgroundColor(Color.parseColor("#B3000000"))
      setTextColor(Color.parseColor("#F3F4F6"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
    }

    viewport.addView(screenImg)
    viewport.addView(tapDot)
    viewport.addView(stepCaption)

    // 3. Bottom control bar: Pause/Resume, Takeover/Return, Stop
    val controls = LinearLayout(appContext).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
    }

    val pauseButton = buildMiniActionButton("暂停", "#1F2937") {
      paused = !paused
      virtualDisplayController.setPaused(paused)
      syncViewsOnMain()
      emitOverlayAction(if (paused) "pause" else "resume")
    }

    val takeoverButton = buildMiniActionButton("接管", "#1D4ED8") {
      val targetPkg = packageName.ifBlank { virtualDisplayController.getActivePackageName().orEmpty() }
      if (!takeoverActive) {
        if (targetPkg.isNotEmpty()) {
          virtualDisplayController.moveAppToMainScreenForTakeover(targetPkg)
        }
        takeoverActive = true
        syncViewsOnMain()
        emitOverlayAction("takeover")
      } else {
        if (targetPkg.isNotEmpty()) {
          virtualDisplayController.returnAppToVirtualDisplay(targetPkg)
        }
        takeoverActive = false
        syncViewsOnMain()
        emitOverlayAction("return_background")
      }
    }

    val stopButton = buildMiniActionButton("停止", "#B91C1C") {
      vibrateEmergencyStop()
      virtualDisplayController.triggerEmergencyStop()
      paused = false
      stopLiveFrameLoopOnMain()
      removeOverlayFromWindowManagerOnMain()
      emitOverlayAction("stop")
    }

    controls.addView(pauseButton)
    controls.addView(takeoverButton)
    controls.addView(stopButton)

    outer.addView(header)
    outer.addView(viewport)
    outer.addView(controls)

    miniWindowView = outer
    miniHeaderTitleView = headerTitle
    miniViewportLayout = viewport
    miniScreenImageView = screenImg
    miniTapDotView = tapDot
    miniStepCaptionView = stepCaption
    miniPauseBtn = pauseButton
    miniTakeoverBtn = takeoverButton
    return outer
  }

  private fun buildMiniActionButton(
    label: String,
    bgColorHex: String,
    onClick: () -> Unit
  ): TextView {
    return TextView(appContext).apply {
      text = label
      gravity = Gravity.CENTER
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
      typeface = Typeface.DEFAULT_BOLD
      setPadding(dp(4), dp(5), dp(4), dp(5))
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
        marginStart = dp(2)
        marginEnd = dp(2)
      }
      background = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = dp(6).toFloat()
        setColor(Color.parseColor(bgColorHex))
      }
      setOnClickListener { onClick() }
    }
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun attachDragAndGestureListener(
    target: View,
    snapToEdgeOnRelease: Boolean,
    longPressDurationMs: Long?,
    onLongPress: (() -> Unit)?,
    onTap: (() -> Unit)?
  ) {
    val touchSlopPx = dp(8)
    var downRawX = 0f
    var downRawY = 0f
    var startWinX = 0
    var startWinY = 0
    var moved = false
    var longPressFired = false

    val longPressRunnable = Runnable {
      if (!moved && onLongPress != null) {
        longPressFired = true
        onLongPress.invoke()
      }
    }

    target.setOnTouchListener { _, event ->
      val params = layoutParams ?: return@setOnTouchListener false
      val root = rootContainer ?: return@setOnTouchListener false
      val wm = resolveMainScreenWindowManager()

      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downRawX = event.rawX
          downRawY = event.rawY
          startWinX = params.x
          startWinY = params.y
          moved = false
          longPressFired = false
          if (longPressDurationMs != null && onLongPress != null) {
            mainHandler.removeCallbacks(longPressRunnable)
            mainHandler.postDelayed(longPressRunnable, longPressDurationMs)
          }
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - downRawX
          val dy = event.rawY - downRawY
          if (!moved && (abs(dx) > touchSlopPx || abs(dy) > touchSlopPx)) {
            moved = true
            mainHandler.removeCallbacks(longPressRunnable)
          }
          if (moved && !longPressFired && isAddedToWindowManager) {
            val (screenW, screenH) = getScreenBoundsPx(wm)
            params.x = (startWinX + dx.roundToInt()).coerceIn(0, (screenW - root.width.coerceAtLeast(dp(64))).coerceAtLeast(0))
            params.y = (startWinY + dy.roundToInt()).coerceIn(dp(24), (screenH - root.height.coerceAtLeast(dp(48))).coerceAtLeast(dp(24)))
            try {
              wm.updateViewLayout(root, params)
            } catch (_: Throwable) {
            }
          }
          true
        }
        MotionEvent.ACTION_UP -> {
          mainHandler.removeCallbacks(longPressRunnable)
          if (!longPressFired) {
            if (!moved) {
              onTap?.invoke()
            } else if (snapToEdgeOnRelease && isAddedToWindowManager) {
              val (screenW, _) = getScreenBoundsPx(wm)
              val viewW = root.width.takeIf { it > 0 } ?: dp(160)
              val centerX = params.x + viewW / 2
              params.x = if (centerX < screenW / 2) dp(6) else (screenW - viewW - dp(6)).coerceAtLeast(0)
              try {
                wm.updateViewLayout(root, params)
              } catch (_: Throwable) {
              }
            }
          }
          true
        }
        MotionEvent.ACTION_CANCEL -> {
          mainHandler.removeCallbacks(longPressRunnable)
          true
        }
        else -> false
      }
    }
  }

  private fun syncViewsOnMain() {
    val isMini = currentMode == MODE_MINI_WINDOW
    capsuleView?.visibility = if (isMini) View.GONE else View.VISIBLE
    miniWindowView?.visibility = if (isMini) View.VISIBLE else View.GONE

    // Capsule UI
    capsuleLabelView?.text = "🤖 $assistantName · $appName · $stepText"
    (capsuleStatusDot?.background as? GradientDrawable)?.setColor(
      if (paused) Color.parseColor("#F59E0B") else Color.parseColor("#22C55E")
    )

    // Mini-window UI
    val displayId = virtualDisplayController.getVirtualDisplayId() ?: 2
    miniHeaderTitleView?.text = "$appName · #$displayId"
    miniStepCaptionView?.text = stepText
    miniPauseBtn?.text = if (paused) "继续" else "暂停"
    miniTakeoverBtn?.text = if (takeoverActive) "回后台" else "接管"

    updateTapDotPositionOnMain()
  }

  private fun updateTapDotPositionOnMain() {
    val dot = miniTapDotView ?: return
    val viewport = miniViewportLayout ?: return
    val tapX = overrideTapX ?: virtualDisplayController.lastTapX
    val tapY = overrideTapY ?: virtualDisplayController.lastTapY
    if (tapX == null || tapY == null) {
      dot.visibility = View.GONE
      return
    }

    val (dispW, dispH) = virtualDisplayController.getDisplayDimensions()
    val srcW = (if (dispW > 0) dispW else overrideScreenW).coerceAtLeast(1)
    val srcH = (if (dispH > 0) dispH else overrideScreenH).coerceAtLeast(1)
    val viewW = viewport.width.takeIf { it > 0 } ?: dp(MINI_WINDOW_WIDTH_DP - 8)
    val viewH = viewport.height.takeIf { it > 0 } ?: dp(MINI_WINDOW_HEIGHT_DP - 76)
    val radius = dp(6)

    dot.translationX = ((tapX.toFloat() / srcW.toFloat()) * viewW.toFloat() - radius)
      .coerceIn(0f, (viewW - radius * 2).coerceAtLeast(0).toFloat())
    dot.translationY = ((tapY.toFloat() / srcH.toFloat()) * viewH.toFloat() - radius)
      .coerceIn(0f, (viewH - radius * 2).coerceAtLeast(0).toFloat())
    dot.visibility = View.VISIBLE
  }

  private fun syncLiveFrameLoopOnMain() {
    if (!isAddedToWindowManager || currentMode != MODE_MINI_WINDOW) {
      stopLiveFrameLoopOnMain()
      return
    }
    if (refreshJob?.isActive == true) return

    refreshJob = refreshScope.launch {
      while (isActive && isAddedToWindowManager && currentMode == MODE_MINI_WINDOW) {
        val preview = try {
          virtualDisplayController.capturePreviewBitmap(maxLongEdge = 400)
        } catch (_: Throwable) {
          null
        }
        if (preview != null) {
          mainHandler.post {
            if (isAddedToWindowManager && currentMode == MODE_MINI_WINDOW) {
              miniScreenImageView?.setImageBitmap(preview)
              updateTapDotPositionOnMain()
            }
          }
        }
        delay(LIVE_PREVIEW_INTERVAL_MS)
      }
    }
  }

  private fun stopLiveFrameLoopOnMain() {
    refreshJob?.cancel()
    refreshJob = null
  }

  private fun removeOverlayFromWindowManagerOnMain() {
    val root = rootContainer
    if (root != null && isAddedToWindowManager) {
      val wm = resolveMainScreenWindowManager()
      try {
        wm.removeViewImmediate(root)
      } catch (_: Throwable) {
        try {
          wm.removeView(root)
        } catch (_: Throwable) {
        }
      }
    }
    isAddedToWindowManager = false
    rootContainer = null
    capsuleView = null
    miniWindowView = null
    layoutParams = null
  }

  private fun vibrateEmergencyStop() {
    try {
      val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val vm = appContext.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
        vm?.defaultVibrator
      } else {
        @Suppress("DEPRECATION")
        appContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
      }
      if (vibrator != null && vibrator.hasVibrator()) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          vibrator.vibrate(VibrationEffect.createOneShot(140L, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
          @Suppress("DEPRECATION")
          vibrator.vibrate(140L)
        }
      }
    } catch (_: Throwable) {
    }
  }

  private fun runOnMainSync(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block()
      return
    }
    val latch = CountDownLatch(1)
    mainHandler.post {
      try {
        block()
      } finally {
        latch.countDown()
      }
    }
    latch.await(2_000L, TimeUnit.MILLISECONDS)
  }

  fun destroy() {
    virtualDisplayController.removeStateListener(displayStateListener)
    hideOverlay()
  }

  companion object {
    const val MODE_CAPSULE = "capsule"
    const val MODE_MINI_WINDOW = "mini_window"
    const val MINI_WINDOW_WIDTH_DP = 160
    const val MINI_WINDOW_HEIGHT_DP = 340
    const val EMERGENCY_LONG_PRESS_MS = 1000L
    private const val LIVE_PREVIEW_INTERVAL_MS = 350L
  }
}
