package expo.modules.callnotification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person

/**
 * Builds and posts the incoming-call notification.
 *
 * Lives in a plain object rather than inside the Expo module so that it needs
 * no React context to run: it was written for a FirebaseMessagingService
 * handling a push at a dead app, and it is kept that way so it can be used
 * from one again. Today its only caller is the module — the "ring this phone
 * now" check — while real incoming calls are drawn by expo-notifications from
 * the push itself (see the manifest).
 */
object CallNotifications {
  /** `adb logcat -s LocaloCall` follows everything this file decides. */
  private const val TAG = "LocaloCall"

  private const val PREFS = "localo.callNotification"
  private const val KEY_ANSWER_URI = "answerUriTemplate"

  /** Replaced with the call id in the stored deep-link template. */
  const val CALL_ID_PLACEHOLDER = "__CALL_ID__"

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
   * A stable notification id per call, so a repeated push for the SAME call
   * updates the existing popup instead of stacking a second one. Kept
   * non-negative because some OEM launchers behave oddly with negative ids.
   */
  fun notificationId(callId: String): Int = callId.hashCode() and 0x7fffffff

  /**
   * Can we post a full-screen intent?
   *
   * ⚠️ THE WHOLE FEATURE HINGES ON THIS. Android 14 (API 34) turned
   * USE_FULL_SCREEN_INTENT from an install-time grant into a per-app switch
   * that is ON by default only for apps Google Play classifies as calling or
   * alarm apps. Everyone else gets it OFF, and merely declaring it in the
   * manifest changes nothing.
   *
   * That matters far beyond the lock screen, because the platform REFUSES a
   * CallStyle notification that has neither a full-screen intent nor a
   * foreground service — `notify()` throws and nothing is posted at all. So
   * when this returns false we must not even try CallStyle; see `show()`.
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
   * Make sure the channel we're about to post on exists.
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
   * Post the incoming-call notification. Returns whether anything was shown,
   * so a caller that has another way to ring can use it instead of assuming.
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

  fun dismiss(context: Context, callId: String) {
    NotificationManagerCompat.from(context).cancel(notificationId(callId))
  }
}
