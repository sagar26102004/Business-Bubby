package expo.modules.callnotification

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JavaScript face of incoming calls (Android only).
 *
 * The interesting work happens with no JavaScript alive at all — see
 * CallMessagingService. What is exposed here is everything the RUNNING app
 * needs around it: dismissing a call that was answered elsewhere, ringing the
 * phone on demand from the call-alerts check, reporting which of the three
 * permissions Android hides behind three unrelated settings screens are
 * granted, and reading back the log of what happened to calls that arrived
 * while the app was closed.
 */
class CallNotificationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CallNotification")

    /**
     * Show the incoming-call notification.
     *
     * For a call JS knows about that the push didn't deliver, and for the test
     * ring. `timeoutMs` should match the call's ring window — Android then
     * clears the notification by itself if nobody ever answers, so a dead call
     * can't leave a phantom ringing popup behind.
     */
    AsyncFunction("showIncomingCall") {
        callId: String,
        callerName: String,
        businessName: String,
        channelId: String,
        answerUri: String,
        timeoutMs: Int ->
      CallNotifications.show(
        context, callId, callerName, businessName, channelId, answerUri, timeoutMs
      )
    }

    /**
     * Show the full-screen call screen, exactly as an incoming push would.
     *
     * Exists so the call-alerts check can prove the WhatsApp-style screen works
     * on THIS phone without needing a second device and a real call. Returns
     * the same phrase that goes into the ring log, so a refusal explains itself.
     */
    AsyncFunction("showCallScreen") {
        callId: String, callerName: String, businessName: String, timeoutMs: Int ->
      CallNotifications.showCallScreen(context, callId, callerName, businessName, timeoutMs)
    }

    /** Clear it — answered elsewhere, cancelled by the caller, or rang out. */
    AsyncFunction("dismiss") { callId: String ->
      CallNotifications.dismiss(context, callId)
    }

    /**
     * Teach the native side how to deep-link into a call, with
     * `callIdPlaceholder` standing in for the id.
     *
     * The URL scheme is app.json's, i.e. something only JS knows. Without this
     * the Answer button on a call that arrived while the app was closed would
     * have nowhere to go.
     */
    AsyncFunction("setAnswerUriTemplate") { template: String ->
      CallNotifications.storeAnswerUriTemplate(context, template)
    }

    /** The placeholder JS must substitute into that template. */
    Constants("callIdPlaceholder" to CallNotifications.CALL_ID_PLACEHOLDER)

    /**
     * What happened to the last few call pushes — written by the push service
     * while the app was closed, so this is the only way to see it.
     */
    AsyncFunction("getRingLog") {
      CallLog.read(context)
    }

    AsyncFunction("clearRingLog") {
      CallLog.clear(context)
    }

    /**
     * Whether this app may post a full-screen intent — one of the two routes to
     * a call screen. Often false on Android 14+; see
     * `CallNotifications.canUseFullScreenIntent`.
     */
    AsyncFunction("canUseFullScreenIntent") {
      CallNotifications.canUseFullScreenIntent(context)
    }

    /**
     * Send the user to the system toggle that grants it. There is no runtime
     * dialog for this permission — Android deliberately made it a manual
     * settings switch, so the only thing an app can do is take them there. The
     * same is true of the two below.
     */
    AsyncFunction("openFullScreenIntentSettings") {
      CallNotifications.openFullScreenIntentSettings(context)
    }

    /** "Display over other apps" — the other route to a call screen. */
    AsyncFunction("canDrawOverlays") {
      CallNotifications.canDrawOverlays(context)
    }

    AsyncFunction("openOverlaySettings") {
      CallNotifications.openOverlaySettings(context)
    }

    /**
     * Whether the phone is still allowed to wake us for pushes. When this is
     * false the call never reaches the device at all and nothing else on this
     * list matters.
     */
    AsyncFunction("isIgnoringBatteryOptimizations") {
      CallNotifications.isIgnoringBatteryOptimizations(context)
    }

    AsyncFunction("openBatterySettings") {
      CallNotifications.openBatterySettings(context)
    }
  }

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "No react context" }
}
