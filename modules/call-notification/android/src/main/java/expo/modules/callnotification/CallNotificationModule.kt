package expo.modules.callnotification

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
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

    val notification = NotificationCompat.Builder(context, channelId)
      // A system drawable, so this can never break on a missing app resource.
      .setSmallIcon(android.R.drawable.sym_call_incoming)
      .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer))
      // Shown by launchers and accessibility services that don't render CallStyle.
      .setContentTitle(callerName)
      .setContentText("Incoming call for $businessName")
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      // The two properties that make it behave like a call rather than an alert:
      // it takes over a locked screen, and it does not slide away on its own.
      .setFullScreenIntent(answer, true)
      .setOngoing(true)
      .setAutoCancel(false)
      // Tapping the body (not a button) opens the call without answering it.
      .setContentIntent(answer)
      // Belt and braces against a phantom popup if every dismissal path fails.
      .setTimeoutAfter(timeoutMs.toLong())
      .addPerson(caller)
      .build()

    try {
      NotificationManagerCompat.from(context).notify(id, notification)
    } catch (e: SecurityException) {
      // POST_NOTIFICATIONS revoked between our permission check and here.
      // Nothing to do but stay silent — never crash the app over a notification.
    }
  }
}
