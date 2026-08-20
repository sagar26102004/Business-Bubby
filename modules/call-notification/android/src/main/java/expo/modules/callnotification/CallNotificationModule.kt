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
     * Teach the native side how to DECLINE a call with no app running.
     *
     * The Decline pill is handled entirely in Kotlin so that refusing a call
     * never drags you into the app — which also means it has no Supabase client
     * and no session to authenticate with. Both halves of that are supplied
     * here: the endpoint to post to, and this device's push token, which the
     * function accepts as proof that this is the device being rung.
     */
    AsyncFunction("setDeclineEndpoint") { url: String, pushToken: String ->
      CallNotifications.storeDeclineEndpoint(context, url, pushToken)
    }

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

    /**
     * The call the user pressed ANSWER on while the app was closed, if any.
     * Reading it CLEARS it, so one press answers one call. See
     * CallNotifications.storePendingAnswer for why answering is expressed as a
     * stored instruction rather than only as a deep link.
     */
    AsyncFunction("takePendingAnswer") {
      CallNotifications.takePendingAnswer(context)
    }

    /**
     * Go foreground for the duration of a call, so it survives the app leaving
     * the screen. See OngoingCallService for why this is the difference
     * between a call and a call that dies when you lock your phone.
     *
     * Deliberately NOT silent about failure, unlike most of this file: if
     * Android refuses (a background start on 12+, or a missing microphone
     * permission on 14+) the call is about to become fragile, and the JS side
     * turns that into something it can log rather than pretending all is well.
     */
    AsyncFunction("startOngoingCall") { callId: String, title: String, text: String ->
      OngoingCallService.start(context, callId, title, text)
    }

    AsyncFunction("stopOngoingCall") {
      OngoingCallService.stop(context)
    }
  }

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "No react context" }
}
