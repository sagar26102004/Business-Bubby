package expo.modules.callnotification

import android.util.Log
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
 * the styled popup appeared only when it was least needed. A
 * FirebaseMessagingService has no such dependency — it is Android starting one
 * of our classes directly.
 *
 * HOW IT TAKES PRIORITY
 * expo-notifications registers its own service with `android:priority="-1"`,
 * deliberately low so an app can put itself in front. Ours declares a higher
 * priority and extends theirs, so anything that is NOT a call falls through to
 * `super` and behaves exactly as before.
 *
 * ⚠️ FALLING THROUGH IS NOT FREE. Everything below is written so that a call we
 * recognise is ALWAYS drawn here, because handing a call back to `super` costs
 * the Answer and Decline buttons unless the push also carried a title. It does
 * carry one now — the two paths are belt and braces — but this one is the good
 * path and it should not be given up over a missing name or an unexpected
 * payload shape.
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
      Log.d(TAG, "not a call push; handing to expo-notifications")
      super.onMessageReceived(remoteMessage)
      return
    }

    // Deliberately NOT skipped when the app is on screen. An earlier version
    // held a "is the app in the foreground" flag and returned here, so that the
    // popup never landed on top of IncomingCallGate — which meant one stale
    // flag was all it took to silence every call, with nothing to show for it.
    // Posting always and letting the gate clear it (it does, the moment it
    // renders) can at worst flash a notification for a second. That is a much
    // cheaper mistake than a phone that never rings.

    // A missing template is survivable: `show` falls back to opening the app.
    val answerUri = CallNotifications.answerUriFor(applicationContext, call.callId)
    val shown = CallNotifications.show(
      context = applicationContext,
      callId = call.callId,
      callerName = call.callerName,
      businessName = call.businessName,
      channelId = remoteMessage.data["channelId"] ?: DEFAULT_CHANNEL_ID,
      answerUri = answerUri,
      timeoutMs = RING_MS,
    )
    Log.d(TAG, "call ${call.callId}: popup shown=$shown, deepLink=${answerUri != null}")

    // Couldn't draw anything ourselves — let Expo post its own notification
    // rather than leave the phone silent. The push carries a title and the
    // Accept/Decline category, so that one has buttons too.
    if (!shown) super.onMessageReceived(remoteMessage)
  }

  /**
   * Pull the call out of the push, or null if this isn't one.
   *
   * DELIBERATELY GENEROUS. Expo's push service flattens a message into FCM
   * string data, and the exact shape has moved between versions: the custom
   * `data` object normally arrives JSON-encoded under `body`, but the fields
   * can also appear at the top level. Being strict here is how a call ends up
   * misread as an ordinary notification, so this accepts any of the shapes and
   * treats the call channel or category as proof on their own. Names fall back
   * to the push's own title/message, and then to something generic — a call
   * from "Someone" you can answer beats a correctly-labelled one you can't.
   */
  private fun parseCall(remoteMessage: RemoteMessage): IncomingCall? {
    return try {
      val data = remoteMessage.data
      val payload = data["body"]?.let {
        try {
          JSONObject(it)
        } catch (e: Exception) {
          null
        }
      }

      val callId = payload?.optString("callId")?.ifEmpty { null }
        ?: data["callId"]?.ifEmpty { null }
        ?: return null

      val looksLikeCall = payload?.optString("kind") == KIND_INCOMING_CALL ||
        data["kind"] == KIND_INCOMING_CALL ||
        data["categoryId"] == CALL_CATEGORY_ID ||
        data["channelId"] == DEFAULT_CHANNEL_ID
      if (!looksLikeCall) return null

      IncomingCall(
        callId = callId,
        callerName = payload?.optString("callerName")?.ifEmpty { null }
          ?: data["callerName"]?.ifEmpty { null }
          ?: data["title"]?.ifEmpty { null }
          ?: "Someone",
        businessName = payload?.optString("businessName")?.ifEmpty { null }
          ?: data["businessName"]?.ifEmpty { null }
          ?: "your business",
      )
    } catch (e: Exception) {
      // A parse failure must never cost the whole notification.
      Log.w(TAG, "could not read the call push", e)
      null
    }
  }

  companion object {
    private const val TAG = "LocaloCall"

    /** Matches `kind` in the push payload sent by call-ring / ringDevices. */
    private const val KIND_INCOMING_CALL = "incoming_call"

    /** Matches CALL_CATEGORY_ID in src/features/notifications/push.ts. */
    private const val CALL_CATEGORY_ID = "incoming_call"

    /** Matches CALL_CHANNEL_ID in src/features/notifications/push.ts. */
    private const val DEFAULT_CHANNEL_ID = "calls_v2"

    /** Matches RING_TIMEOUT_MS in the call repositories. */
    private const val RING_MS = 30_000
  }
}
