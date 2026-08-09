package expo.modules.callnotification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import org.json.JSONObject

/**
 * Everything the Android side knows about drawing an incoming call.
 *
 * Lives in a plain object rather than inside the Expo module because its most
 * important caller has no React context at all: CallMessagingService, handling a
 * push at an app that isn't running. Nothing here may assume JavaScript exists.
 *
 * There are two products in this file, and they are layered on purpose:
 *
 *  • `showCallScreen` — the WhatsApp-style full-screen call (IncomingCallActivity).
 *    An UPGRADE. It is allowed to fail, and says so instead of pretending.
 *  • `show` — a single self-contained notification with Answer and Decline.
 *    Used by the "ring this phone now" check, and the last resort.
 *
 * Underneath both sits the notification `expo-notifications` draws from the push
 * by itself, which needs no code from us and is the thing proven to ring real
 * phones on real lock screens. The service hands the message to that FIRST and
 * only then tries to improve on it — so the worst case here is not silence, it
 * is an ordinary ringing notification.
 */
object CallNotifications {
  /** `adb logcat -s LocaloCall` follows everything this file decides. */
  internal const val TAG = "LocaloCall"

  private const val PREFS = "localo.callNotification"
  private const val KEY_ANSWER_URI = "answerUriTemplate"
  private const val KEY_DECLINE_URL = "declineUrl"
  private const val KEY_PUSH_TOKEN = "pushToken"

  /** Replaced with the call id in the stored deep-link template. */
  const val CALL_ID_PLACEHOLDER = "__CALL_ID__"

  /**
   * The channel the RINGING notification uses — the one expo-notifications posts
   * from the push, and the one the edge function names.
   *
   * ⚠️ Must match CALL_CHANNEL_ID in src/features/notifications/push.ts and
   * call-ring/index.ts. It is duplicated here rather than passed in because
   * silencing a call has to work from a broadcast receiver that was handed
   * nothing but a call id.
   */
  const val RING_CHANNEL_ID = "calls_v2"

  /**
   * A SILENT channel for the full-screen call.
   *
   * The full-screen notification exists only to make Android launch the call
   * screen; the ringing is already being done by the notification Expo posted
   * from the same push. Giving this one a sound too would ring the phone twice,
   * slightly out of step, which sounds broken.
   */
  private const val SCREEN_CHANNEL_ID = "call_screen_v1"

  /**
   * Remember how to deep-link into a call.
   *
   * The app's URL scheme lives in app.json and is known to expo-linking, i.e.
   * to JS. The push service knows nothing about it, and neither does this file.
   * So JS hands the template over once (see PushRegistrar) and we keep it in
   * SharedPreferences, where a headless push can still read it. Any device that
   * can be rung has necessarily run the app and registered a token first, so
   * the template is always there by the time a call arrives.
   */
  fun storeAnswerUriTemplate(context: Context, template: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_ANSWER_URI, template)
      .apply()
  }

  fun answerUriFor(context: Context, callId: String): String? =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_ANSWER_URI, null)
      ?.replace(CALL_ID_PLACEHOLDER, callId)

  /**
   * Remember how to tell the SERVER a call was declined.
   *
   * Same reasoning as the answer URI above, for the same reason: the project's
   * function URL and this device's push token are both known only to JS, and
   * the code that needs them runs in a process with no JS in it. Handed over
   * once at registration (PushRegistrar) and kept where a headless broadcast
   * receiver can still read them.
   *
   * The push token doubles as the credential — see the call-decline function
   * for why that is both sufficient and tightly bounded.
   */
  fun storeDeclineEndpoint(context: Context, url: String, pushToken: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_DECLINE_URL, url)
      .putString(KEY_PUSH_TOKEN, pushToken)
      .apply()
  }

  /**
   * Tell the server this call was declined. Blocking — CALL IT OFF THE MAIN
   * THREAD (CallActionReceiver holds the broadcast open with goAsync while this
   * runs).
   *
   * Best effort by design. If it fails, the call simply rings out and lands in
   * the missed log, which is exactly the behaviour this replaces — so a network
   * error costs nothing that wasn't already lost, and must never be allowed to
   * stop the phone going quiet.
   */
  fun postDecline(context: Context, callId: String): String {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val url = prefs.getString(KEY_DECLINE_URL, null)
    val pushToken = prefs.getString(KEY_PUSH_TOKEN, null)
    if (url.isNullOrBlank() || pushToken.isNullOrBlank()) {
      return "decline not sent: this device never registered for calls"
    }

    return try {
      val connection = (java.net.URL(url).openConnection() as java.net.HttpURLConnection).apply {
        requestMethod = "POST"
        setRequestProperty("Content-Type", "application/json")
        doOutput = true
        // A broadcast receiver gets roughly ten seconds in total before the
        // system may kill the process, so fail fast rather than hang and lose
        // the notification-clearing work queued behind this.
        connectTimeout = 4000
        readTimeout = 4000
      }
      try {
        val body = JSONObject()
          .put("callId", callId)
          .put("pushToken", pushToken)
          .toString()
        connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        val code = connection.responseCode
        if (code in 200..299) "decline sent" else "decline refused by server (HTTP $code)"
      } finally {
        connection.disconnect()
      }
    } catch (t: Throwable) {
      "decline not sent: ${t.javaClass.simpleName} ${t.message.orEmpty()}"
    }
  }

  /**
   * A stable notification id per call, so a repeated push for the SAME call
   * updates the existing popup instead of stacking a second one. Kept
   * non-negative because some OEM launchers behave oddly with negative ids.
   */
  fun notificationId(callId: String): Int = callId.hashCode() and 0x7fffffff

  /** A second id, for the full-screen notification, which coexists with it. */
  private fun screenNotificationId(callId: String): Int =
    "$callId#screen".hashCode() and 0x7fffffff

  // ------------------------------------------------------- permissions

  /**
   * Can we post a full-screen intent?
   *
   * Android 14 (API 34) turned USE_FULL_SCREEN_INTENT from an install-time grant
   * into a per-app switch that is ON by default only for apps Google Play
   * classifies as calling or alarm apps. Everyone else gets it OFF, and merely
   * declaring it in the manifest changes nothing.
   *
   * It matters beyond the lock screen: the platform REFUSES a CallStyle
   * notification that has neither a full-screen intent nor a foreground
   * service — `notify()` throws and nothing is posted at all. So when this is
   * false we must not even try CallStyle; see `show()`.
   */
  fun canUseFullScreenIntent(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 34) return true
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
    return manager?.canUseFullScreenIntent() ?: false
  }

  fun openFullScreenIntentSettings(context: Context) {
    // String literals rather than the API-34 constants, so this compiles
    // against any compileSdk the Expo template happens to ship with.
    val intent = if (Build.VERSION.SDK_INT >= 34) {
      Intent(
        "android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT",
        Uri.parse("package:${context.packageName}")
      )
    } else {
      Intent("android.settings.APP_NOTIFICATION_SETTINGS")
        .putExtra("android.provider.extra.APP_PACKAGE", context.packageName)
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
  }

  /**
   * "Display over other apps" — the OTHER way onto a locked screen.
   *
   * Worth having as well as the full-screen intent because the two are granted
   * by completely different, unrelated switches, and on any given phone one of
   * them is usually already on. With this one, a background app may start an
   * activity directly, which is both simpler and prettier than the full-screen
   * intent route: no extra notification is posted at all.
   */
  fun canDrawOverlays(context: Context): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) Settings.canDrawOverlays(context) else true

  fun openOverlaySettings(context: Context) {
    val intent = Intent(
      Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
      Uri.parse("package:${context.packageName}")
    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
  }

  /**
   * Is the phone allowed to keep waking us for pushes?
   *
   * Battery optimisation is the single most common reason a closed app never
   * rings, and it is invisible: the push is simply never delivered, so nothing
   * anywhere in this file ever runs. Aggressive OEM ROMs are stricter still —
   * on several, swiping the app away counts as a force-stop and kills push
   * delivery until the app is opened by hand.
   */
  fun isIgnoringBatteryOptimizations(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
    val power = context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
      ?: return true
    return power.isIgnoringBatteryOptimizations(context.packageName)
  }

  /**
   * Open the battery optimisation LIST rather than asking directly.
   *
   * ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS shows a one-tap dialog but needs
   * a permission Google Play restricts to a short list of app types. The list
   * screen needs nothing, works everywhere, and costs the user two extra taps.
   */
  fun openBatterySettings(context: Context) {
    val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      context.startActivity(intent)
    } catch (t: Throwable) {
      // Some ROMs simply don't have that screen. Their own app settings do at
      // least get the user to the right area.
      context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    }
  }

  /** True while any part of Localo is on screen. */
  fun appIsInForeground(context: Context): Boolean =
    try {
      val activity = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      activity?.runningAppProcesses.orEmpty().any {
        it.processName == context.packageName &&
          it.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
      }
    } catch (t: Throwable) {
      // Assume it isn't: showing a call screen over an app that is already
      // showing one is a cosmetic bug, missing the call is not.
      false
    }

  // ------------------------------------------------------- the call screen

  /**
   * Put the full-screen call on the display. Returns a short phrase describing
   * which route worked (or didn't), which goes straight into the ring log — the
   * whole point being that "it didn't ring" stops being a mystery.
   *
   * Both routes are attempted every time rather than picking one up front,
   * because the permissions behind them can be revoked while the app is closed.
   */
  fun showCallScreen(
    context: Context,
    callId: String,
    callerName: String,
    businessName: String,
    timeoutMs: Int
  ): String {
    val screen = IncomingCallActivity.intentFor(context, callId, callerName, businessName, timeoutMs)

    // Route 1 — launch it ourselves. Needs "display over other apps", which is
    // what lifts the background-activity-start ban.
    if (canDrawOverlays(context)) {
      try {
        context.startActivity(screen)
        return "full call screen (display-over-other-apps)"
      } catch (t: Throwable) {
        Log.w(TAG, "direct launch refused", t)
        // Fall through — the full-screen intent may still be allowed.
      }
    }

    // Route 2 — ask the system to launch it, via a full-screen intent.
    if (!canUseFullScreenIntent(context)) {
      return "no call screen: neither permission granted (ringing notification only)"
    }

    return try {
      ensureSilentChannel(context)
      val manager = NotificationManagerCompat.from(context)
      if (!manager.areNotificationsEnabled()) return "no call screen: notifications are off"

      val id = screenNotificationId(callId)
      val caller = Person.Builder().setName(callerName).setImportant(true).build()
      val answer = PendingIntent.getActivity(
        context,
        id,
        screen,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
      val decline = declineIntent(context, callId, id + 1)

      val notification = NotificationCompat.Builder(context, SCREEN_CHANNEL_ID)
        .setSmallIcon(android.R.drawable.sym_call_incoming)
        .setContentTitle(callerName)
        .setContentText(if (businessName.isBlank()) "Incoming call" else "Incoming call for $businessName")
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setOngoing(true)
        .setAutoCancel(false)
        // Ringing belongs to the other notification; this one must be mute.
        .setSilent(true)
        .setContentIntent(answer)
        .setTimeoutAfter(timeoutMs.toLong())
        .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer))
        // The line that actually launches IncomingCallActivity. Also MANDATORY
        // for CallStyle: without it (or a foreground service) the platform
        // rejects the post outright.
        .setFullScreenIntent(answer, true)
        .build()

      manager.notify(id, notification)
      "full call screen (full-screen intent)"
    } catch (t: Throwable) {
      "no call screen: ${t.javaClass.simpleName} ${t.message.orEmpty()}"
    }
  }

  // ------------------------------------------------------- channels

  /**
   * Make sure the ringing channel exists.
   *
   * ⚠️ A NOTIFICATION SENT TO A MISSING CHANNEL IS DROPPED IN SILENCE. Android
   * logs one line and shows nothing — no error, no fallback, no crash. The
   * channel is normally created by JS at sign-in, which means it does NOT exist
   * on a phone where the app was reinstalled and not yet opened, or where the
   * user signed out. Those are exactly the phones we most need to ring, so
   * create it here too rather than assume.
   *
   * Settings are frozen at creation, so this deliberately mirrors
   * `ensureCallChannel` in src/features/notifications/push.ts. Whichever side
   * gets there first wins and the other becomes a no-op.
   */
  private fun ensureChannel(context: Context, channelId: String) {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      ?: return
    if (manager.getNotificationChannel(channelId) != null) return

    Log.d(TAG, "channel $channelId was missing; creating it natively")
    val channel = NotificationChannel(
      channelId,
      "Incoming calls",
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = "Rings when someone calls your business."
      // The bundled 32s ring if it's there (Android plays a channel's sound
      // once per notification, so ringing for the whole window comes from the
      // file's length), otherwise the phone's own ringtone.
      val bundled = context.resources
        .getIdentifier("call_ringtone", "raw", context.packageName)
      val sound = if (bundled != 0) {
        Uri.parse("android.resource://${context.packageName}/raw/call_ringtone")
      } else {
        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
      }
      setSound(
        sound,
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 700, 550, 700, 2050)
      enableLights(true)
      // A phone call is the one thing that earns an interruption.
      setBypassDnd(true)
      lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
    }
    manager.createNotificationChannel(channel)
  }

  /** The mute channel the full-screen notification is posted on. */
  private fun ensureSilentChannel(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      ?: return
    if (manager.getNotificationChannel(SCREEN_CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      SCREEN_CHANNEL_ID,
      "Call screen",
      // HIGH so it may take over the screen, but with nothing to hear: the
      // ringing notification on the calls channel is doing that.
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = "Shows the full-screen call when someone rings you."
      setSound(null, null)
      enableVibration(false)
      setBypassDnd(true)
      lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
    }
    manager.createNotificationChannel(channel)
  }

  /** PendingIntent for Decline, handled in-process so the app never opens. */
  private fun declineIntent(context: Context, callId: String, requestCode: Int): PendingIntent {
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

  /**
   * PendingIntent that opens the app at a deep link — or just opens the app,
   * when we were never told what the deep link looks like.
   *
   * The fallback matters more than it sounds. Answering used to be abandoned
   * entirely if the URI was missing, which handed the whole notification back
   * to Expo and produced a ring with no buttons on it. Landing on the home
   * screen with the call still ringing is worse than a deep link and far better
   * than not being able to answer at all — IncomingCallGate takes over the
   * moment the app is open.
   */
  private fun openAppIntent(context: Context, uri: String?, requestCode: Int): PendingIntent? {
    val intent = if (uri != null) {
      Intent(Intent.ACTION_VIEW, Uri.parse(uri)).apply {
        // Scope to our own app so the chooser never appears.
        setPackage(context.packageName)
      }
    } else {
      context.packageManager.getLaunchIntentForPackage(context.packageName)
    } ?: return null
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      // FLAG_IMMUTABLE is mandatory from API 31; UPDATE_CURRENT keeps a
      // re-posted notification pointing at the current call, not a stale one.
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }

  // ------------------------------------------------------- plain notification

  /**
   * Post a self-contained incoming-call notification. Returns whether anything
   * was shown, so a caller that has another way to ring can use it instead of
   * assuming.
   *
   * This is what the "ring this phone now" check exercises, and it is the only
   * path that both rings AND carries buttons without help from anything else.
   */
  fun show(
    context: Context,
    callId: String,
    callerName: String,
    businessName: String,
    channelId: String,
    answerUri: String?,
    timeoutMs: Int
  ): Boolean {
    val id = notificationId(callId)
    // CallStyle renders this person as the caller: their name is the headline
    // and their initial fills the avatar.
    val caller = Person.Builder().setName(callerName).setImportant(true).build()

    // Only truly impossible if the app has no launcher activity, which cannot
    // happen for us — but a null here would mean a notification you can't act
    // on, so say so rather than posting one.
    val answer = openAppIntent(context, answerUri, id) ?: return false
    val decline = declineIntent(context, callId, id + 1)

    /** Everything both variants share. */
    fun base() = NotificationCompat.Builder(context, channelId)
      // A system drawable, so this can never break on a missing app resource.
      .setSmallIcon(android.R.drawable.sym_call_incoming)
      // Shown by launchers and accessibility services that don't render CallStyle.
      .setContentTitle(callerName)
      .setContentText("Incoming call for $businessName")
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      // Do not slide away on its own, the way an ordinary alert does.
      .setOngoing(true)
      .setAutoCancel(false)
      // Tapping the body (not a button) opens the call without answering it.
      .setContentIntent(answer)
      // Belt and braces against a phantom popup if every dismissal path fails.
      .setTimeoutAfter(timeoutMs.toLong())
      .addPerson(caller)

    /**
     * The plain variant: no CallStyle, but the two buttons added BY HAND.
     *
     * This exists because CallStyle is all-or-nothing — the answer/decline
     * pills are generated by the style, so a notification the platform refuses
     * to style arrives with no buttons at all, which is precisely the "it rings
     * but I can't answer it" failure. Explicit actions can't be taken away.
     */
    fun plain() = base()
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", decline)
      .addAction(android.R.drawable.sym_action_call, "Answer", answer)
      .build()

    ensureChannel(context, channelId)

    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) {
      // Nothing we post can be seen. Say so instead of reporting success, so
      // the caller can fall back rather than believe the phone is ringing.
      Log.w(TAG, "notifications are disabled for this app; cannot ring")
      return false
    }
    return try {
      if (canUseFullScreenIntent(context)) {
        val styled = base()
          .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer))
          // Lets it take over a locked screen. Also MANDATORY for CallStyle:
          // without it (or a foreground service) the platform rejects the post.
          .setFullScreenIntent(answer, true)
          .build()
        manager.notify(id, styled)
      } else {
        manager.notify(id, plain())
      }
      true
    } catch (e: SecurityException) {
      // POST_NOTIFICATIONS revoked between our permission check and here.
      // Nothing to do but stay silent — never crash the app over a notification.
      false
    } catch (e: Exception) {
      // Any OEM or version that rejects CallStyle for a reason we didn't predict
      // must still ring with usable buttons — a ring you can't answer is worse
      // than an unstyled one. Deliberately broad: this is the last line of
      // defence, and it runs on devices we cannot test.
      try {
        manager.notify(id, plain())
        true
      } catch (ignored: Exception) {
        false
      }
    }
  }

  // ------------------------------------------------------- clearing up

  /**
   * Silence a call completely: our own notifications, the one Expo posted from
   * the push, and the full-screen activity if it is up.
   *
   * The Expo one has an id we never knew, so it is found by CHANNEL instead —
   * safe because `calls_v2` carries nothing but incoming calls. Without this,
   * pressing Decline on a closed app stopped our notification and left Expo's
   * still ringing, which reads as the decline not having worked.
   */
  fun cancelAllForCall(context: Context, callId: String) {
    val compat = NotificationManagerCompat.from(context)
    if (callId.isNotEmpty()) {
      compat.cancel(notificationId(callId))
      compat.cancel(screenNotificationId(callId))
    }

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
    if (manager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        for (posted in manager.activeNotifications) {
          val channel = posted.notification.channelId
          if (channel == RING_CHANNEL_ID || channel == SCREEN_CHANNEL_ID) {
            manager.cancel(posted.tag, posted.id)
          }
        }
      } catch (t: Throwable) {
        Log.w(TAG, "could not enumerate active notifications", t)
      }
    }

    // Take down the full-screen call screen too, wherever it is running.
    context.sendBroadcast(
      Intent(IncomingCallActivity.ACTION_CALL_ENDED)
        .setPackage(context.packageName)
        .putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId)
    )
  }

  fun dismiss(context: Context, callId: String) {
    cancelAllForCall(context, callId)
  }
}
