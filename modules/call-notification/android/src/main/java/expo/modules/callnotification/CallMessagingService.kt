package expo.modules.callnotification

import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import org.json.JSONObject

/**
 * Receives the push that says someone is calling, and turns it into a
 * full-screen call.
 *
 * ORDER IS THE WHOLE DESIGN — READ THIS BEFORE CHANGING ANYTHING.
 *
 * An earlier version of this class handled the message ITSELF and, when it
 * succeeded, did not pass it on. That is the normal way to write a
 * FirebaseMessagingService and it was a mistake: whenever our own drawing
 * quietly failed — a channel that didn't exist yet, a CallStyle the platform
 * refused, a permission revoked while the app was closed — the message had
 * already been consumed, so expo-notifications never got to post the ordinary
 * notification that WOULD have worked. The phone went completely silent, and
 * the silence looked like the push never arriving. Three builds were spent on
 * that theory.
 *
 * So: `super.onMessageReceived` runs FIRST, unconditionally, before we look at
 * the message at all. That is the notification that rings, sits on the lock
 * screen, and carries Accept and Decline (the `incoming_call` category, from
 * push.ts) — it is the behaviour that has been observed working on real phones,
 * and nothing in this class is allowed to prevent it.
 *
 * Only then do we try to UPGRADE it to a real call screen. Every part of that
 * is inside a catch, and every outcome is written to CallLog so that a failure
 * on someone else's phone can be read back afterwards instead of guessed at.
 *
 * The cost is one extra row in the notification shade while the call screen is
 * up. That is a fair price for a path that cannot make things worse.
 */
class CallMessagingService : ExpoFirebaseMessagingService() {
  private companion object {
    /** Matches the app's ring window, so a dead call clears itself. */
    const val RING_WINDOW_MS = 30_000
  }

  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    // 1. The proven path. Never guarded by a condition, never skipped.
    try {
      super.onMessageReceived(remoteMessage)
    } catch (t: Throwable) {
      CallLog.add(this, "expo-notifications threw: ${t.javaClass.simpleName} ${t.message.orEmpty()}")
    }

    // 2. The upgrade. Allowed to fail; not allowed to throw.
    try {
      upgradeToCallScreen(remoteMessage)
    } catch (t: Throwable) {
      CallLog.add(this, "call screen failed: ${t.javaClass.simpleName} ${t.message.orEmpty()}")
    }
  }

  private fun upgradeToCallScreen(remoteMessage: RemoteMessage) {
    val call = parse(remoteMessage)
    if (call == null) {
      // Still logged: a chat or order push arriving proves pushes reach this
      // phone at all, which is half the diagnosis when calls don't.
      CallLog.add(this, "push arrived (not a call)")
      return
    }

    if (CallNotifications.appIsInForeground(this)) {
      // IncomingCallGate is already on screen with its own answer/decline UI.
      CallLog.add(this, "call ${call.id} — app is open, in-app screen takes it")
      return
    }

    CallLog.add(this, "call ${call.id} from ${call.callerName}")

    // UPGRADE 1 — replace the transient alert with a notification that STAYS.
    //
    // What expo-notifications drew above is an ordinary heads-up: it appears
    // for a few seconds and then drops into the shade, which for a ringing call
    // reads as the popup vanishing before you can answer it. This posts the
    // same CallStyle notification the in-app "Ring this phone now" check uses —
    // round caller avatar, coloured Answer/Decline pills, `ongoing` so it can't
    // be swiped or time out on its own.
    //
    // The duplicate is only cleared once ours is confirmed posted. `show`
    // returns false when it could not draw anything at all (notifications
    // revoked, CallStyle refused AND the plain fallback refused), and in that
    // case expo's alert is left exactly where it is — a transient notification
    // is worth having when the alternative is silence, which is precisely the
    // trap this service's ordering comment exists to avoid.
    val answerUri = CallNotifications.answerUriFor(this, call.id)
    val posted = CallNotifications.show(
      this,
      call.id,
      call.callerName,
      call.businessName,
      CallNotifications.RING_CHANNEL_ID,
      answerUri,
      RING_WINDOW_MS
    )
    if (posted) {
      CallNotifications.cancelOtherRingNotifications(this, call.id)
      CallLog.add(this, "posted the CallStyle notification")
    } else {
      CallLog.add(this, "could not draw CallStyle — keeping the plain alert")
    }

    // UPGRADE 2 — the full-screen call screen, on top of that.
    val outcome = CallNotifications.showCallScreen(
      this,
      call.id,
      call.callerName,
      call.businessName,
      RING_WINDOW_MS
    )
    CallLog.add(this, outcome)
  }

  private data class IncomingCall(val id: String, val callerName: String, val businessName: String)

  /**
   * Pull the call out of an Expo push.
   *
   * Expo packs the message's `data` object into a single FCM data field called
   * `body`, as JSON — so the fields the edge function sent are one level down,
   * not where you would expect. Top-level keys are read as well, because that
   * is where they'd be if the push were ever sent through FCM directly, and
   * because a parser that only understands one shape is a parser that breaks
   * the day the sender changes.
   */
  private fun parse(remoteMessage: RemoteMessage): IncomingCall? {
    val data = remoteMessage.data
    val nested = data["body"]?.let { runCatching { JSONObject(it) }.getOrNull() }

    fun field(name: String): String? =
      nested?.optString(name)?.takeIf { it.isNotBlank() } ?: data[name]?.takeIf { it.isNotBlank() }

    if (field("kind") != "incoming_call") return null
    val id = field("callId") ?: return null
    return IncomingCall(
      id = id,
      callerName = field("callerName") ?: "Incoming call",
      businessName = field("businessName").orEmpty()
    )
  }
}
