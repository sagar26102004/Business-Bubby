package expo.modules.callnotification

import android.app.Activity
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat

/**
 * The WhatsApp-style incoming-call screen: the caller's name filling a dark
 * screen with a red Decline and a green Answer under it, shown OVER the lock
 * screen, waking the display.
 *
 * WHY AN ACTIVITY AND NOT JUST A NOTIFICATION
 * A notification — even a CallStyle one — is a strip at the top of whatever the
 * phone was already showing, and on a locked phone it is a row you must find
 * and expand. What people mean by "it should work like WhatsApp" is this: the
 * screen lights up and the call IS the screen. Only an activity can do that.
 *
 * HOW IT GETS ON SCREEN while the app is closed — two routes, in CallNotifications:
 *  1. the "display over other apps" permission, which allows a direct launch, or
 *  2. a full-screen intent, where the system launches this on our behalf.
 * Android deliberately allows no third way; without either, the push still rings
 * as an ordinary notification with Answer and Decline on it, which is the
 * fallback this whole path is built on top of rather than replacing.
 *
 * UI IS BUILT IN CODE ON PURPOSE. A layout XML in a local Expo module means
 * resource merging and a generated R class, and a missing resource here fails at
 * the worst possible moment — mid-call, on someone else's phone, with no way to
 * see why. Views in Kotlin cannot go missing.
 */
class IncomingCallActivity : Activity() {
  companion object {
    const val EXTRA_CALL_ID = "callId"
    const val EXTRA_CALLER_NAME = "callerName"
    const val EXTRA_BUSINESS_NAME = "businessName"
    const val EXTRA_TIMEOUT_MS = "timeoutMs"

    /**
     * Broadcast when a call stops being live — answered on another device,
     * cancelled by the caller, or rung out. Sent by CallNotifications.dismiss,
     * which the app already calls from every one of those places.
     */
    const val ACTION_CALL_ENDED = "expo.modules.callnotification.CALL_ENDED"

    fun intentFor(
      context: Context,
      callId: String,
      callerName: String,
      businessName: String,
      timeoutMs: Int
    ): Intent = Intent(context, IncomingCallActivity::class.java).apply {
      // NEW_TASK because the launcher is a service or the system, neither of
      // which is an activity. CLEAR_TOP + SINGLE_TOP so a re-sent push for the
      // same call updates this screen instead of stacking another one on it.
      addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_CLEAR_TOP or
          Intent.FLAG_ACTIVITY_SINGLE_TOP or
          Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
      )
      putExtra(EXTRA_CALL_ID, callId)
      putExtra(EXTRA_CALLER_NAME, callerName)
      putExtra(EXTRA_BUSINESS_NAME, businessName)
      putExtra(EXTRA_TIMEOUT_MS, timeoutMs)
    }
  }

  private var callId: String = ""
  private val main = Handler(Looper.getMainLooper())
  private var ended: BroadcastReceiver? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    showOverLockScreen()
    bind(intent)
  }

  /** A second push for the same call re-uses this instance (singleTop). */
  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    if (intent != null) {
      setIntent(intent)
      bind(intent)
    }
  }

  private fun bind(source: Intent) {
    callId = source.getStringExtra(EXTRA_CALL_ID).orEmpty()
    val caller = source.getStringExtra(EXTRA_CALLER_NAME)?.takeIf { it.isNotBlank() }
      ?: "Incoming call"
    val business = source.getStringExtra(EXTRA_BUSINESS_NAME).orEmpty()
    setContentView(buildUi(caller, business))

    // A call nobody answers must not leave a screen the phone can't get out of.
    val timeout = source.getIntExtra(EXTRA_TIMEOUT_MS, 30_000).coerceIn(5_000, 120_000)
    main.removeCallbacksAndMessages(null)
    main.postDelayed({ finishAndRemoveTaskCompat() }, timeout.toLong())

    listenForCallEnd()
  }

  /**
   * Wake the screen and draw in front of the lock.
   *
   * The two API levels do the same thing by different means; the manifest also
   * carries showWhenLocked/turnScreenOn so the system knows before we run. The
   * keyguard is deliberately NOT dismissed here — you should be able to see and
   * refuse a call without unlocking, exactly like a real one. Unlocking happens
   * only if you answer.
   */
  private fun showOverLockScreen() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  /** Close by itself the moment the call is no longer ringing. */
  private fun listenForCallEnd() {
    if (ended != null) return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        val which = intent?.getStringExtra(EXTRA_CALL_ID)
        // A blank id means "every call" — used when we can't be specific.
        if (which.isNullOrEmpty() || which == callId) finishAndRemoveTaskCompat()
      }
    }
    ContextCompat.registerReceiver(
      this,
      receiver,
      IntentFilter(ACTION_CALL_ENDED),
      // Nothing outside Localo may close a user's incoming call.
      ContextCompat.RECEIVER_NOT_EXPORTED
    )
    ended = receiver
  }

  private fun answer() {
    CallLog.add(this, "answered $callId from the call screen")
    CallNotifications.cancelAllForCall(this, callId)

    // Answering is the one moment unlocking is justified: the call UI lives
    // inside the app, which cannot be shown behind the keyguard.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      (getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)
        ?.requestDismissKeyguard(this, null)
    }

    // Record the DECISION before opening anything. Whether the app lands on the
    // call screen, the home screen, or somewhere else entirely, JS reads this on
    // startup and joins — so answering no longer depends on a cold-start deep
    // link surviving the router.
    CallNotifications.storePendingAnswer(this, callId)

    val uri = CallNotifications.answerUriFor(this, callId)
    val open = if (uri != null) {
      Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(packageName)
    } else {
      // Better to land on the home screen with the call still live than to have
      // pressed Answer and had nothing happen.
      packageManager.getLaunchIntentForPackage(packageName)
    }
    // WHICH ROUTE this took is the one fact the log was missing, and it is the
    // difference between "the deep link is wrong" and "the template was never
    // stored" — two problems with nothing in common, and one APK build each to
    // tell apart without this line.
    CallLog.add(this, if (uri != null) "answering via deep link $uri" else "answering via the launcher (no deep link stored)")
    open?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    try {
      if (open != null) startActivity(open)
    } catch (t: Throwable) {
      CallLog.add(this, "could not open the app to answer: ${t.javaClass.simpleName}")
    }
    finishAndRemoveTaskCompat()
  }

  private fun decline() {
    CallLog.add(this, "declined $callId from the call screen")
    sendBroadcast(
      Intent(this, CallActionReceiver::class.java).apply {
        action = CallActionReceiver.ACTION_DECLINE
        putExtra(CallActionReceiver.EXTRA_CALL_ID, callId)
      }
    )
    finishAndRemoveTaskCompat()
  }

  private fun finishAndRemoveTaskCompat() {
    main.removeCallbacksAndMessages(null)
    if (!isFinishing) {
      // Remove the task too: this screen has its own empty taskAffinity, and a
      // dead call left behind in Recents is confusing to come back to.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) finishAndRemoveTask()
      else finish()
    }
  }

  override fun onDestroy() {
    main.removeCallbacksAndMessages(null)
    ended?.let { runCatching { unregisterReceiver(it) } }
    ended = null
    super.onDestroy()
  }

  /**
   * Back must not silently dismiss a ringing call — on a locked phone that
   * would look like the call vanished. Ignoring it leaves Answer and Decline as
   * the only ways out, which is what a phone does.
   */
  @Deprecated("Deprecated in Java")
  override fun onBackPressed() {
    // Intentionally empty.
  }

  // ---------------------------------------------------------------- UI

  private fun dp(value: Int): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics)
      .toInt()

  private fun buildUi(caller: String, business: String): View {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.parseColor("#0B0F0E"))
      gravity = Gravity.CENTER_HORIZONTAL
      setPadding(dp(24), dp(72), dp(24), dp(56))
    }

    root.addView(label("Incoming call", 14, "#8A948F"))

    root.addView(
      avatar(caller),
      LinearLayout.LayoutParams(dp(96), dp(96)).apply { topMargin = dp(28) }
    )

    root.addView(
      label(caller, 30, "#FFFFFF", bold = true),
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply { topMargin = dp(24) }
    )

    if (business.isNotBlank()) {
      root.addView(
        label("Calling $business", 16, "#8A948F"),
        LinearLayout.LayoutParams(
          LinearLayout.LayoutParams.MATCH_PARENT,
          LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(8) }
      )
    }

    // Pushes the buttons to the bottom, where a thumb already is.
    root.addView(
      View(this),
      LinearLayout.LayoutParams(0, 0, 1f)
    )

    val actions = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
      weightSum = 2f
    }
    actions.addView(
      actionButton("📵", "Decline", "#E5484D") { decline() },
      LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    )
    actions.addView(
      actionButton("📞", "Answer", "#2BA84A") { answer() },
      LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    )
    root.addView(
      actions,
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      )
    )
    return root
  }

  private fun label(text: String, sizeSp: Int, color: String, bold: Boolean = false) =
    TextView(this).apply {
      this.text = text
      setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp.toFloat())
      setTextColor(Color.parseColor(color))
      gravity = Gravity.CENTER
      if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

  /** The caller's initial in a circle — no avatar to download, none needed. */
  private fun avatar(caller: String) = TextView(this).apply {
    text = caller.trim().firstOrNull()?.uppercase() ?: "?"
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 40f)
    setTextColor(Color.WHITE)
    gravity = Gravity.CENTER
    background = GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(Color.parseColor("#1F6F54"))
    }
  }

  private fun actionButton(glyph: String, title: String, color: String, onTap: () -> Unit): View {
    val column = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
    }
    val circle = TextView(this).apply {
      text = glyph
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
      gravity = Gravity.CENTER
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor(color))
      }
      // The whole column is tappable, not just the circle — a ringing phone is
      // held one-handed and often in the dark.
      isClickable = false
    }
    column.addView(circle, LinearLayout.LayoutParams(dp(72), dp(72)))
    column.addView(
      label(title, 15, "#FFFFFF"),
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply { topMargin = dp(12) }
    )
    column.setOnClickListener { onTap() }
    return column
  }
}
