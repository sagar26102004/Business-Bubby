package expo.modules.callnotification

import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import org.json.JSONObject

/**
 * Draws the incoming-call popup the moment the push lands — in Kotlin, with no
 * JavaScript involved.
 *
 * WHY THIS REPLACED THE JS BACKGROUND TASK
 * The task worked beautifully while the app was running and did nothing at all
 * once it was closed: FCM starts the app PROCESS for a data message, but the
 * React runtime that the task needs is not guaranteed to come up with it. So
 * the styled popup appeared only when it was least needed, and a closed app got
 * the bare notification expo-notifications posts for a message with no title —
 * ringing, with nothing to press. A FirebaseMessagingService has no such
 * dependency: it is Android starting one of our classes directly.
 *
 * HOW IT TAKES PRIORITY
 * expo-notifications registers its own service with `android:priority="-1"`,
 * deliberately low so an app can put itself in front. Ours declares a higher
 * priority and extends theirs, so anything that is NOT a call falls through to
 * `super` and behaves exactly as before.
 */
class CallMessagingService : ExpoFirebaseMessagingService() {

  private data class IncomingCall(
    val callId: String,
    val callerName: String,
    val businessName: String,
  )

  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val call = parseCall(remoteMessage)
    if (call == null) {
      // Not ours — chat, orders, anything future. Let Expo present it.
      super.onMessageReceived(remoteMessage)
      return
    }

    // The app is on screen: IncomingCallGate is already showing the full
    // answer/decline UI and ringing. A second popup on top of it would just be
    // something else to dismiss.
    if (CallNotifications.appInForeground) return

    val answerUri = CallNotifications.answerUriFor(applicationContext, call.callId)
    if (answerUri == null) {
      // We were never told the app's URL scheme, so Answer would lead nowhere.
      // Expo's plain notification at least tells them someone called.
      super.onMessageReceived(remoteMessage)
      return
    }

    CallNotifications.show(
      context = applicationContext,
      callId = call.callId,
      callerName = call.callerName,
      businessName = call.businessName,
      channelId = remoteMessage.data["channelId"] ?: DEFAULT_CHANNEL_ID,
      answerUri = answerUri,
      timeoutMs = RING_MS,
    )
  }

  /**
   * Pull the call out of the push, or null if this isn't one.
   *
   * Expo's push service flattens a message into FCM string data: the custom
   * `data` object we sent arrives JSON-encoded under the key `body`. Parsing is
   * fully defensive — a malformed or unexpected payload must fall through to
   * Expo rather than throw, because an exception here would mean no
   * notification of ANY kind.
   */
  private fun parseCall(remoteMessage: RemoteMessage): IncomingCall? {
    return try {
      val raw = remoteMessage.data["body"] ?: return null
      val json = JSONObject(raw)
      if (json.optString("kind") != KIND_INCOMING_CALL) return null
      val callId = json.optString("callId")
      if (callId.isEmpty()) return null
      IncomingCall(
        callId = callId,
        callerName = json.optString("callerName").ifEmpty { "Someone" },
        businessName = json.optString("businessName").ifEmpty { "your business" },
      )
    } catch (e: Exception) {
      null
    }
  }

  companion object {
    /** Matches `kind` in the push payload sent by call-ring / ringDevices. */
    private const val KIND_INCOMING_CALL = "incoming_call"

    /** Matches CALL_CHANNEL_ID in src/features/notifications/push.ts. */
    private const val DEFAULT_CHANNEL_ID = "calls_v2"

    /** Matches RING_TIMEOUT_MS in the call repositories. */
    private const val RING_MS = 30_000
  }
}
