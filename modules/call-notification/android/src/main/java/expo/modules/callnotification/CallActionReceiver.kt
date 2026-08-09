package expo.modules.callnotification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Handles the DECLINE pill.
 *
 * Decline deliberately does not open the app — being dragged into an app just
 * to refuse a call is the exact annoyance this whole feature exists to remove.
 * A broadcast receiver runs in-process without any UI, so the ring stops
 * instantly and the phone goes back to whatever it was doing.
 *
 * It only clears the notifications. Telling the SERVER the call was declined
 * would mean an authenticated HTTP call from Kotlin, duplicating auth and token
 * refresh that already live in TypeScript — so instead the call simply rings out
 * and lands in the missed log, which is the same outcome the user asked for.
 * The one visible difference is that the caller waits out the ring rather than
 * seeing "Declined" immediately.
 *
 * "Clears the notifications", plural, is load-bearing: a real incoming call has
 * up to three faces (the ringing one expo-notifications posts, our full-screen
 * one, and the call screen itself) and stopping only the one that was pressed
 * leaves the phone still ringing, which reads as Decline being broken.
 */
class CallActionReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION_DECLINE = "expo.modules.callnotification.DECLINE"
    const val EXTRA_NOTIFICATION_ID = "notificationId"
    const val EXTRA_CALL_ID = "callId"
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_DECLINE) return
    val callId = intent.getStringExtra(EXTRA_CALL_ID).orEmpty()
    CallLog.add(context, "declined ${callId.ifEmpty { "a call" }} from the notification")
    CallNotifications.cancelAllForCall(context, callId)
  }
}
