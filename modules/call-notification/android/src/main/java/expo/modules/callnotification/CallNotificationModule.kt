package expo.modules.callnotification

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Posts the SYSTEM incoming-call notification — the one with a round avatar,
 * "Incoming call", and coloured Decline / Answer pills that stays on screen for
 * the whole ring.
 *
 * WHY THIS EXISTS
 * That styling is `Notification.CallStyle` (Android 12+), and taking over a
 * locked screen needs `setFullScreenIntent`. `expo-notifications` exposes
 * neither, so a JS-only notification can only ever be a plain banner with text
 * buttons — visually nothing like a call, and it collapses after a few seconds.
 *
 * DELIBERATELY TINY
 * This module ONLY renders and cancels. Deciding who to ring, waking the device,
 * and talking to the server all stay in JS/TypeScript where they can be tested
 * without a 15-minute native build. Two functions is the entire surface.
 */
class CallNotificationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CallNotification")

    /**
     * Show the incoming-call notification.
     *
     * `answerUri` / `declineUri` are built in JS (expo-linking) rather than
     * hardcoded here, so the app's scheme lives in exactly one place.
     * `timeoutMs` should match the call's ring window — Android then clears the
     * notification by itself if nobody ever answers, so a dead call can't leave
     * a phantom ringing popup behind.
     */
    AsyncFunction("showIncomingCall") {
        callId: String,
        callerName: String,
        businessName: String,
        channelId: String,
        answerUri: String,
        timeoutMs: Int ->
      show(callId, callerName, businessName, channelId, answerUri, timeoutMs)
    }

    /** Clear it — answered elsewhere, cancelled by the caller, or rang out. */
    AsyncFunction("dismiss") { callId: String ->
      NotificationManagerCompat.from(context).cancel(notificationId(callId))
    }

    /**
     * Whether this app may post a full-screen intent — i.e. whether the real
     * call popup is available at all. See `canUseFullScreenIntent()` below for
     * why the answer is often NO on Android 14+.
     */
    AsyncFunction("canUseFullScreenIntent") { canUseFullScreenIntent() }

    /**
     * Send the user to the system toggle that grants it. There is no runtime
     * dialog for this permission — Android 14 deliberately made it a manual
     * settings switch, so the only thing an app can do is take them there.
     */
    AsyncFunction("openFullScreenIntentSettings") { openFullScreenIntentSettings() }
  }

  /**
   * Can we post a full-screen intent?
   *
   * ⚠️ THE WHOLE FEATURE HINGES ON THIS. Android 14 (API 34) turned
   * USE_FULL_SCREEN_INTENT from an install-time grant into a per-app switch that
   * is ON by default only for apps Google Play classifies as calling or alarm
   * apps. Everyone else gets it OFF, and merely declaring it in the manifest
   * changes nothing.
   *
   * That matters far beyond the lock screen, because the platform REFUSES a
   * CallStyle notification that has neither a full-screen intent nor a
   * foreground service — `notify()` throws IllegalArgumentException and nothing
   * is posted at all. So when this returns false we must not even try CallStyle;
   * see `show()` for the fallback.
   */
  private fun canUseFullScreenIntent(): Boolean {
    if (Build.VERSION.SDK_INT < 34) return true
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
    return manager?.canUseFullScreenIntent() ?: false
  }

  private fun openFullScreenIntentSettings() {
    // String literals rather than the API-34 constants, so this file compiles
    // against any compileSdk the Expo template happens to ship with.
    val intent = if (Build.VERSION.SDK_INT >= 34) {
      Intent("android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT", Uri.parse("package:${context.packageName}"))
    } else {
      Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
  }

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "No react context" }

  /**
   * A stable notification id per call, so a repeated push for the SAME call
   * updates the existing popup instead of stacking a second one. Kept
   * non-negative because some OEM launchers behave oddly with negative ids.
   */
  private fun notificationId(callId: String): Int = callId.hashCode() and 0x7fffffff

  /** PendingIntent that opens the app at a deep link. */
  private fun openAppIntent(uri: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).apply {
      // Scope to our own app so the chooser never appears.
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      // FLAG_IMMUTABLE is mandatory from API 31; UPDATE_CURRENT keeps a
      // re-posted notification pointing at the current call rather than a stale one.
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }

  /** PendingIntent for Decline, handled in-process so the app never opens. */
  private fun declineIntent(callId: String, requestCode: Int): PendingIntent {
    val intent = Intent(context, CallActionReceiver::class.java).apply {
      action = CallActionReceiver.ACTION_DECLINE
      putExtra(CallActionReceiver.EXTRA_NOTIFICATION_ID, notificationId(callId))
      putExtra(CallActionReceiver.EXTRA_CALL_ID, callId)
    }
    return PendingIntent.getBroadcast(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }

  private fun show(
    callId: String,
    callerName: String,
    businessName: String,
    channelId: String,
    answerUri: String,
    timeoutMs: Int
  ) {
    val id = notificationId(callId)
    // CallStyle renders this person as the caller: their name is the headline
    // and their initial fills the avatar.
    val caller = Person.Builder().setName(callerName).setImportant(true).build()

    val answer = openAppIntent(answerUri, id)
    val decline = declineIntent(callId, id + 1)

    /** Everything both variants share. */
    fun base() = NotificationCompat.Builder(context, channelId)
      // A system drawable, so this can never break on a missing app resource.
      .setSmallIcon(android.R.drawable.sym_call_incoming)
      // Shown by launchers and accessibility services that don't render CallStyle.
      .setContentTitle(callerName)
      .setContentText("Incoming call for $businessName")
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      // Do not slide away on its own, the way an ordinary alert does.
      .setOngoing(true)
      .setAutoCancel(false)
      // Tapping the body (not a button) opens the call without answering it.
      .setContentIntent(answer)
      // Belt and braces against a phantom popup if every dismissal path fails.
      .setTimeoutAfter(timeoutMs.toLong())
      .addPerson(caller)

    /**
     * The plain variant: no CallStyle, but the two buttons added BY HAND.
     *
     * This exists because CallStyle is all-or-nothing — the answer/decline pills
     * are generated by the style, so a notification the platform refuses to
     * style arrives with no buttons at all, which is precisely the "it rings but
     * I can't answer it" failure. Explicit actions can't be taken away.
     */
    fun plain() = base()
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", decline)
      .addAction(android.R.drawable.sym_action_call, "Answer", answer)
      .build()

    val manager = NotificationManagerCompat.from(context)
    try {
      if (canUseFullScreenIntent()) {
        val styled = base()
          .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer))
          // Lets it take over a locked screen. Also MANDATORY for CallStyle:
          // without it (or a foreground service) the platform rejects the post.
          .setFullScreenIntent(answer, true)
          .build()
        manager.notify(id, styled)
      } else {
        manager.notify(id, plain())
      }
    } catch (e: SecurityException) {
      // POST_NOTIFICATIONS revoked between our permission check and here.
      // Nothing to do but stay silent — never crash the app over a notification.
    } catch (e: Exception) {
      // Any OEM or version that rejects CallStyle for a reason we didn't predict
      // must still ring with usable buttons — a ring you can't answer is worse
      // than an unstyled one. Deliberately broad: this is the last line of
      // defence, and it runs on devices we cannot test.
      try {
        manager.notify(id, plain())
      } catch (ignored: Exception) {
      }
    }
  }
}
