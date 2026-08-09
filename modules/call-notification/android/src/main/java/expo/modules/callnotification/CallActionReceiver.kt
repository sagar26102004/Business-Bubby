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
 * "Clears the notifications", plural, is load-bearing: a real incoming call has
 * up to three faces (the ringing one expo-notifications posts, our full-screen
 * one, and the call screen itself) and stopping only the one that was pressed
 * leaves the phone still ringing, which reads as Decline being broken.
 *
 * IT ALSO TELLS THE SERVER, which it did not used to. Silencing the phone alone
 * left the call ringing the CALLER for the rest of its 30-second window before
 * landing in the missed log — so from the caller's side, declining and ignoring
 * were the same thing, and the button was only half a button. The server hop
 * needs no session (see the call-decline function: the device's push token is
 * the credential), which is what makes it possible from a dead app at all.
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

    // Stop the ringing FIRST and synchronously. Whatever happens to the network
    // call below, the one thing the user actually pressed the button for — the
    // noise stopping, now — must not be waiting behind a socket timeout.
    CallNotifications.cancelAllForCall(context, callId)
    if (callId.isEmpty()) return

    // `goAsync` keeps the receiver (and so the process) alive past the return of
    // this method, which is the only way to do network work here: onReceive
    // itself runs on the main thread, where an HTTP call is both illegal and
    // pointless. The budget is about ten seconds; postDecline times out inside
    // it, and `finish()` is in a finally so a throw can't strand the process.
    val pending = goAsync()
    val app = context.applicationContext
    Thread {
      try {
        CallLog.add(app, CallNotifications.postDecline(app, callId))
      } catch (t: Throwable) {
        CallLog.add(app, "decline not sent: ${t.javaClass.simpleName} ${t.message.orEmpty()}")
      } finally {
        pending.finish()
      }
    }.start()
  }
}
