package expo.modules.callnotification

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JavaScript face of the incoming-call notification (Android only).
 *
 * The rendering itself lives in `CallNotifications`, because the important
 * caller is `CallMessagingService` — a push arriving at a CLOSED app, where no
 * JS exists to ask. This module is what the RUNNING app uses: to dismiss a
 * popup once the call is answered elsewhere, to hand over the deep-link
 * template, and to report whether the system will let us draw the real thing.
 *
 * It also tracks whether the app is on screen, which is what stops a popup
 * appearing on top of the in-app call screen.
 */
class CallNotificationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CallNotification")

    // Whether to draw a popup at all is decided by these two lines. While the
    // app is visible the in-app gate owns incoming calls; the moment it isn't,
    // the notification does. A killed process runs neither, so the flag stays
    // false — exactly what a closed app should report.
    OnActivityEntersForeground { CallNotifications.appInForeground = true }
    OnActivityEntersBackground { CallNotifications.appInForeground = false }

    /**
     * Show the incoming-call notification.
     *
     * Kept for a call JS knows about that the push didn't deliver. `timeoutMs`
     * should match the call's ring window — Android then clears the
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
      CallNotifications.show(
        context, callId, callerName, businessName, channelId, answerUri, timeoutMs
      )
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
     * the Answer button on a popup drawn by the push service would have nowhere
     * to go.
     */
    AsyncFunction("setAnswerUriTemplate") { template: String ->
      CallNotifications.storeAnswerUriTemplate(context, template)
    }

    /** The placeholder JS must substitute into that template. */
    Constants("callIdPlaceholder" to CallNotifications.CALL_ID_PLACEHOLDER)

    /**
     * Whether this app may post a full-screen intent — i.e. whether the real
     * call popup is available at all. Often false on Android 14+; see
     * `CallNotifications.canUseFullScreenIntent`.
     */
    AsyncFunction("canUseFullScreenIntent") {
      CallNotifications.canUseFullScreenIntent(context)
    }

    /**
     * Send the user to the system toggle that grants it. There is no runtime
     * dialog for this permission — Android 14 deliberately made it a manual
     * settings switch, so the only thing an app can do is take them there.
     */
    AsyncFunction("openFullScreenIntentSettings") {
      CallNotifications.openFullScreenIntentSettings(context)
    }
  }

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "No react context" }
}
