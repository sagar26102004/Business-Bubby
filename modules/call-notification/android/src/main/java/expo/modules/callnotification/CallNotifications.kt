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
  private const val KEY_PENDING_ANSWER = "pendingAnswer"
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
   * RETIRED — a silent channel the full-screen notification used to have to
   * itself, back when it was a second notification sitting beside the ringing
   * one. It isn't posted on any more (the full-screen notification now REPLACES
   * the ringing one on `calls_v2`), so the id survives only to clear anything
   * left on it and to delete the channel from the user's settings.
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

  /**
   * Remember that the user pressed ANSWER, so the app can act on it once it is
   * running.
   *
   * ⚠️ THIS IS THE ANSWER, NOT THE DEEP LINK. Answering used to be expressed
   * ONLY as a URL — open the app at /call/session/<id>?answer=1 and let the
   * screen there join. That makes picking up a call depend on a cold-start deep
   * link resolving through the JS router, and when it doesn't, the app opens on
   * the home screen with the call still ringing: pressing the green button
   * looks like it did nothing. The URL is now an optimisation. THIS is the
   * instruction, and JS acts on it wherever it lands.
   *
   * Stamped with the time so a stale one can't answer a call that ended while
   * the app was starting — see takePendingAnswer.
   */
  fun storePendingAnswer(context: Context, callId: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_PENDING_ANSWER, "$callId|${System.currentTimeMillis()}")
      .apply()
  }

  /**
   * Read the pending answer and CLEAR it, so one press answers exactly one
   * call. Returns null when there isn't one, or when it is older than the ring
   * window — a call nobody got to in 60 seconds is over, and joining it on the
   * next launch would be a ghost.
   */
  fun takePendingAnswer(context: Context): String? {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val raw = prefs.getString(KEY_PENDING_ANSWER, null) ?: return null
    prefs.edit().remove(KEY_PENDING_ANSWER).apply()
    val parts = raw.split("|")
    if (parts.size != 2) return null
    val at = parts[1].toLongOrNull() ?: return null
    if (System.currentTimeMillis() - at > 60_000L) return null
    return parts[0].ifEmpty { null }
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

  /** The id the full-screen notification used to have, cleared on the way past. */
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
  ): String = showCallScreenResult(context, callId, callerName, businessName, timeoutMs).log

  /**
   * How the call screen got onto the display — the thing a caller has to know
   * before deciding whether to ring separately.
   */
  enum class ScreenRoute {
    /**
     * The direct launch was ATTEMPTED and nothing was posted — so the ring has
     * to come from somewhere else.
     *
     * Deliberately not "IncomingCallActivity is up": a background activity
     * start that the framework refuses is silent, so this route can never
     * promise more than that it asked.
     */
    ACTIVITY,
    /** A full-screen-intent notification was posted, and it IS the ring. */
    NOTIFICATION,
    /** Nothing could be shown. A ringing notification is all there will be. */
    NONE
  }

  /** The route taken, plus the sentence that goes in the ring log. */
  data class ScreenResult(val route: ScreenRoute, val log: String)

  /** As `showCallScreen`, but says which route it took. */
  fun showCallScreenResult(
    context: Context,
    callId: String,
    callerName: String,
    businessName: String,
    timeoutMs: Int
  ): ScreenResult {
    val screen = IncomingCallActivity.intentFor(context, callId, callerName, businessName, timeoutMs)

    // Route 1 — launch it ourselves. Needs "display over other apps", which is
    // what lifts the background-activity-start ban.
    //
    // ⚠️ IT CANNOT TELL YOU WHETHER IT WORKED, SO IT DOES NOT GET TO DECIDE
    // ANYTHING. A background activity start the framework refuses is not an
    // exception and not a return value: ActivityManager logs one line and drops
    // it, which from in here is indistinguishable from success. Stock Android
    // honours the overlay exemption, but a locked screen, a restricted
    // app-standby bucket, or an OEM ROM with its own separate "background
    // pop-up" switch (Xiaomi, Oppo, Vivo, Realme — off by default) all swallow
    // it in silence.
    //
    // So this is a BONUS: attempted, then forgotten. Route 2 runs either way.
    // Returning early here and suppressing the full-screen intent on the
    // strength of an unverifiable "success" is exactly what stopped calls
    // reaching the lock screen in versionCode 11.
    var launched = false
    if (canDrawOverlays(context)) {
      try {
        context.startActivity(screen)
        launched = true
      } catch (t: Throwable) {
        Log.w(TAG, "direct launch refused", t)
      }
    }

    /**
     * What to report when the full-screen intent can't be had. `why` describes
     * that route only — whether the direct launch was even tried is the
     * difference between ACTIVITY and NONE, and both mean the same thing to the
     * caller: ring separately.
     */
    fun fallback(why: String): ScreenResult =
      if (launched) {
        ScreenResult(
          ScreenRoute.ACTIVITY,
          "call screen asked for via display-over-other-apps, unverified; no full-screen backup ($why)"
        )
      } else {
        ScreenResult(ScreenRoute.NONE, "no call screen: $why")
      }

    // Route 2 — ask the SYSTEM to launch it, via a full-screen intent. Run even
    // when route 1 claimed success, because that claim is worth nothing. The
    // two cannot fight: IncomingCallActivity is singleTop with CLEAR_TOP, so a
    // second arrival re-binds the screen that is already there.
    if (!canUseFullScreenIntent(context)) {
      return fallback("full-screen intent not permitted")
    }

    return try {
      ensureChannel(context, RING_CHANNEL_ID)
      retireScreenChannel(context)
      val manager = NotificationManagerCompat.from(context)
      if (!manager.areNotificationsEnabled()) {
        return fallback("notifications are off")
      }

      // ⚠️ THE RINGING NOTIFICATION'S OWN ID AND CHANNEL, ON PURPOSE.
      //
      // This used to be a second, silent notification sitting beside the one
      // `show` posts, and the lock screen showed the same caller twice: one row
      // that rang and answered the call the moment it was touched, one that
      // opened the call screen. Now there is one row per call and this is it —
      // posted on the ring channel so it rings (calls_v2 owns the sound), with
      // the tap that opens the call screen.
      //
      // The caller is told (ScreenRoute.NOTIFICATION) that the ring is covered,
      // so nothing else posts on top of it. Anything that goes wrong below
      // reports through `fallback` instead, and the plain ringing notification
      // takes over — which is also the ONLY thing that ever suppresses it.
      val id = notificationId(callId)
      val caller = Person.Builder().setName(callerName).setImportant(true).build()
      val answer = PendingIntent.getActivity(
        context,
        id + 3,
        screen,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
      val decline = declineIntent(context, callId, id + 1)

      val notification = NotificationCompat.Builder(context, RING_CHANNEL_ID)
        .setSmallIcon(android.R.drawable.sym_call_incoming)
        .setContentTitle(callerName)
        .setContentText(if (businessName.isBlank()) "Incoming call" else "Incoming call for $businessName")
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setOngoing(true)
        .setAutoCancel(false)
        .setContentIntent(answer)
        .setTimeoutAfter(timeoutMs.toLong())
        .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer))
        // The line that actually launches IncomingCallActivity. Also MANDATORY
        // for CallStyle: without it (or a foreground service) the platform
        // rejects the post outright.
        .setFullScreenIntent(answer, true)
        .build()

      manager.notify(id, notification)
      ScreenResult(
        ScreenRoute.NOTIFICATION,
        if (launched) "full call screen (full-screen intent; direct launch also tried)"
        else "full call screen (full-screen intent)"
      )
    } catch (t: Throwable) {
      // Including a CallStyle the platform refused. Falling back here is what
      // sends the caller on to `show`, which rings with hand-added buttons —
      // so a rejected style costs the call screen, never the ring.
      fallback("${t.javaClass.simpleName} ${t.message.orEmpty()}")
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

  /**
   * Delete the retired call-screen channel.
   *
   * A phone that ran an older build has a second "Call screen" entry in the
   * app's notification settings which now controls nothing. Same reasoning as
   * the v1 `calls` channel in push.ts: a dead switch the user can toggle is
   * worse than no switch.
   */
  private fun retireScreenChannel(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      ?: return
    try {
      if (manager.getNotificationChannel(SCREEN_CHANNEL_ID) != null) {
        manager.deleteNotificationChannel(SCREEN_CHANNEL_ID)
      }
    } catch (t: Throwable) {
      Log.w(TAG, "could not delete the retired call-screen channel", t)
    }
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

  /**
   * The same deep link, minus the "answer it" flag.
   *
   * `answerUrlFor` (push.ts) builds `…/call/session/<id>?answer=1`, and the
   * session screen joins the call the moment it sees that. That is right for
   * the Answer pill and wrong for everything else: a notification whose whole
   * body is a hidden Accept button is a call answered by accident.
   *
   * Falls back to the URI it was given if it cannot be parsed — a body tap that
   * answers is still better than one that does nothing.
   */
  private fun viewUriFor(answerUri: String?): String? {
    if (answerUri.isNullOrBlank()) return answerUri
    return try {
      val src = Uri.parse(answerUri)
      val names = src.queryParameterNames
      if (!names.contains("answer")) return answerUri
      val out = src.buildUpon().clearQuery()
      for (name in names) {
        if (name == "answer") continue
        for (value in src.getQueryParameters(name)) out.appendQueryParameter(name, value)
      }
      out.build().toString()
    } catch (t: Throwable) {
      answerUri
    }
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
    // The BODY gets a different intent to the Answer button — see viewUriFor.
    // Tapping the notification used to send `?answer=1`, so brushing the lock
    // screen picked the call up before the owner had decided to.
    val open = openAppIntent(context, viewUriFor(answerUri), id + 2) ?: answer
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
      .setContentIntent(open)
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
          //
          // `open`, not `answer`: a full-screen intent fires BY ITSELF on a
          // locked phone, so pointing it at the answering deep link picks the
          // call up with nobody having touched anything.
          .setFullScreenIntent(open, true)
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

  /**
   * Clear OTHER notifications on the ring channel — in practice, the plain one
   * expo-notifications drew from the same push.
   *
   * Ours is a CallStyle notification that stays until the call is dealt with;
   * theirs is an ordinary alert that heads-up for a few seconds and then falls
   * into the shade. Both from one push means the good one is buried under a
   * duplicate, and the visible behaviour is the transient one — which reads as
   * "the popup vanished".
   *
   * ⚠️ ONLY CALL THIS ONCE OURS IS ACTUALLY POSTED. It is the exact mistake the
   * service's ordering comment warns about: remove the proven notification
   * before the better one exists and a failure leaves the phone silent. The id
   * is excluded rather than the channel cleared for the same reason — clearing
   * the channel would take ours down with it.
   */
  fun cancelOtherRingNotifications(context: Context, callId: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val keep = notificationId(callId)
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      ?: return
    try {
      for (posted in manager.activeNotifications) {
        if (posted.notification.channelId == RING_CHANNEL_ID && posted.id != keep) {
          manager.cancel(posted.tag, posted.id)
        }
      }
    } catch (t: Throwable) {
      // A duplicate in the shade is untidy; crashing the push handler is not
      // survivable. Leave it.
      Log.w(TAG, "could not clear the duplicate ring notification", t)
    }
  }

  fun dismiss(context: Context, callId: String) {
    cancelAllForCall(context, callId)
  }
}
