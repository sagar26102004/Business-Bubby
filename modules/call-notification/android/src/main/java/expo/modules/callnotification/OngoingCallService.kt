package expo.modules.callnotification

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Keeps an IN-PROGRESS call alive while the app isn't on screen.
 *
 * ⚠️ THIS SERVICE IS THE CALL. Without it the app was only connected while the
 * call screen was visible: lock the phone, switch apps, or swipe the app out of
 * Recents and Android froze or killed the process, the LiveKit room went with
 * it, and the person on the other end was left talking to nobody — with no
 * hang-up ever sent, so their screen still said "On call". A foreground service
 * is the ONLY thing Android accepts as "this app is doing something the user
 * asked for, leave it running", and it is what every real calling app runs.
 *
 * Three details do the actual work, and all three are load-bearing:
 *
 *  • **microphone service type.** From Android 14 a foreground service must
 *    declare WHY, and using the mic from the background is refused outright
 *    without `FOREGROUND_SERVICE_MICROPHONE` + this type. `phoneCall` would read
 *    better but is reserved for apps that register a ConnectionService with the
 *    telecom stack, which an internet-call app deliberately is not.
 *  • **`stopWithTask="false"`** (in the manifest). Swiping the app out of
 *    Recents destroys the Activity; that flag is what stops Android tearing the
 *    SERVICE down with it, which keeps the process — and therefore the JS
 *    engine, the poll and the WebRTC session — alive.
 *  • **an ongoing, non-dismissable notification** that deep-links back into the
 *    call. It isn't decoration: a foreground service must show one, and it is
 *    also the user's way back to a call they navigated away from.
 *
 * Started and stopped from JS (see CallNotificationModule / CallSessionContext)
 * rather than from the call screen, because the whole point is to outlive it.
 */
class OngoingCallService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stop()
      return START_NOT_STICKY
    }

    val callId = intent?.getStringExtra(EXTRA_CALL_ID)
    if (callId.isNullOrEmpty()) {
      // Nothing to show and nothing to return to. Starting a foreground service
      // and then failing to call startForeground() is a hard crash, so refuse
      // cleanly instead.
      Log.w(CallNotifications.TAG, "ongoing-call service started with no call id; stopping")
      stopSelf()
      return START_NOT_STICKY
    }

    val title = intent.getStringExtra(EXTRA_TITLE) ?: "Ongoing call"
    val text = intent.getStringExtra(EXTRA_TEXT) ?: "Tap to return to the call"

    try {
      val notification = buildNotification(callId, title, text)
      // The type passed here must be a SUBSET of what the manifest declares, or
      // Android throws — and `microphone` only exists from API 30, which is
      // also the first version whose manifest understands the string. Below
      // that, the typeless overload is both legal and correct: service types
      // did not become mandatory until API 34.
      if (Build.VERSION.SDK_INT >= 30) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      Log.d(CallNotifications.TAG, "ongoing-call service is up for $callId")
    } catch (err: Throwable) {
      // Android 12+ refuses to START a foreground service from the background,
      // and 14+ refuses the microphone type without the runtime mic permission.
      // Either way the call itself must survive — it simply won't outlive the
      // screen — so log it and get out rather than take the app down.
      Log.w(CallNotifications.TAG, "could not go foreground for $callId: ${err.message}")
      stopSelf()
    }
    // START_NOT_STICKY: if Android does kill us, the call is long gone. Coming
    // back to life with no call to serve would post a phantom "ongoing call".
    return START_NOT_STICKY
  }

  private fun stop() {
    if (Build.VERSION.SDK_INT >= 24) {
      stopForeground(Service.STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    stopSelf()
  }

  private fun buildNotification(callId: String, title: String, text: String): Notification {
    ensureChannel()
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(android.R.drawable.stat_sys_phone_call)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      // Ongoing + no auto-cancel: this is a state, not an announcement. The
      // user gets rid of it by ending the call, not by swiping it away.
      .setOngoing(true)
      .setAutoCancel(false)
      .setSilent(true)
      // The service starts when the call connects, so letting Android count
      // from here gives the shade a live duration for free.
      .setUsesChronometer(true)
      .setWhen(System.currentTimeMillis())
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)

    returnToCallIntent(callId)?.let { builder.setContentIntent(it) }
    return builder.build()
  }

  /**
   * Tapping the notification goes back to THIS call's screen — the same deep
   * link the Answer button uses, so there is one definition of "open a call"
   * and it keeps working when the app was killed and is starting cold.
   */
  private fun returnToCallIntent(callId: String): PendingIntent? {
    val uri = CallNotifications.answerUriFor(this, callId)
    val intent = if (uri != null) {
      Intent(Intent.ACTION_VIEW, Uri.parse(uri)).apply { setPackage(packageName) }
    } else {
      packageManager.getLaunchIntentForPackage(packageName)
    } ?: return null
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    return PendingIntent.getActivity(
      this,
      callId.hashCode() and 0x7fffffff,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }

  /**
   * A LOW-importance, silent channel. The ringing already happened on
   * `calls_v2`; this one only has to be present and quiet, because a
   * foreground service that made a noise every time you locked your phone
   * mid-call would be worse than the bug it fixes.
   */
  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Ongoing calls",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "Shows while you are on a call, so it keeps running in the background."
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    manager.createNotificationChannel(channel)
  }

  companion object {
    private const val CHANNEL_ID = "ongoing_call_v1"

    /**
     * One fixed id, not one per call. There is only ever one call in progress,
     * and a per-call id would leave the previous call's notification stuck in
     * the shade whenever a new call started before the old one was torn down.
     */
    private const val NOTIFICATION_ID = 0x0CA11

    private const val ACTION_STOP = "expo.modules.callnotification.STOP_ONGOING"
    private const val EXTRA_CALL_ID = "callId"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_TEXT = "text"

    fun start(context: Context, callId: String, title: String, text: String) {
      val intent = Intent(context, OngoingCallService::class.java).apply {
        putExtra(EXTRA_CALL_ID, callId)
        putExtra(EXTRA_TITLE, title)
        putExtra(EXTRA_TEXT, text)
      }
      // startForegroundService is required from API 26 — and it comes with a
      // ~5s deadline to call startForeground(), which onStartCommand does
      // first thing. Both calls can throw (a background start on 12+), and the
      // JS caller is best-effort, so let it surface there.
      if (Build.VERSION.SDK_INT >= 26) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      val intent = Intent(context, OngoingCallService::class.java).apply { action = ACTION_STOP }
      try {
        context.startService(intent)
      } catch (err: Throwable) {
        // Not running, or the app is background-restricted and may not start
        // services at all. Either way there is nothing left to stop.
        Log.d(CallNotifications.TAG, "ongoing-call service was not running: ${err.message}")
      }
    }
  }
}
