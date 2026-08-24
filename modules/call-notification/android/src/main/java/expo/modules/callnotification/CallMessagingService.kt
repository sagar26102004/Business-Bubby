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
 * Those upgrades post AT MOST ONE notification between them. The call screen is
 * asked for first because its full-screen-intent route has to post a ringing
 * notification of its own; only when it didn't do we post ours. Ringing twice
 * for one call is not a cosmetic problem — the two rows are indistinguishable
 * on the lock screen and did different things when tapped, so which one you hit
 * decided whether the call was answered or merely opened.
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

    // UPGRADE 1 — the call screen itself: IncomingCallActivity, over the lock
    // screen, the way a phone call looks everywhere else.
    //
    // It goes FIRST because of what its second route does. When it can only
    // reach the display through a full-screen intent, that intent has to hang
    // off a notification — and that notification is posted on the ring channel,
    // so it rings by itself. Asking first means we know whether the phone is
    // already ringing before posting anything, which is what keeps ONE call to
    // ONE row in the shade. Two rows is what this looked like before, and the
    // wrong one of them answered the call the moment it was touched.
    //
    // ⚠️ ONLY A POSTED NOTIFICATION COUNTS AS "HANDLED" BELOW. The other route
    // — launching the activity ourselves over the lock screen — cannot report
    // failure, so it is never allowed to switch anything off. See the long note
    // in showCallScreenResult.
    val screen = try {
      CallNotifications.showCallScreenResult(
        this,
        call.id,
        call.callerName,
        call.businessName,
        RING_WINDOW_MS
      )
    } catch (t: Throwable) {
      // Never let this decide whether the phone rings — that is what the
      // fallback below is for.
      CallNotifications.ScreenResult(
        CallNotifications.ScreenRoute.NONE,
        "call screen threw: ${t.javaClass.simpleName} ${t.message.orEmpty()}"
      )
    }
    CallLog.add(this, screen.log)

    // UPGRADE 2 — the ring, unless the call screen's own notification is
    // already doing it.
    //
    // This replaces the transient alert expo-notifications drew above with one
    // that STAYS: round caller avatar, coloured Answer/Decline pills, `ongoing`
    // so it can't be swiped or time out on its own. Expo's is only cleared once
    // ours is confirmed posted — `show` returns false when it could not draw
    // anything at all, and a transient notification is worth having when the
    // alternative is silence, which is precisely the trap this service's
    // ordering comment exists to avoid.
    if (screen.route == CallNotifications.ScreenRoute.NOTIFICATION) {
      CallNotifications.cancelOtherRingNotifications(this, call.id)
      return
    }

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
      CallLog.add(this, "posted the ringing notification")
    } else {
      CallLog.add(this, "could not draw the ringing notification — keeping the plain alert")
    }
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
