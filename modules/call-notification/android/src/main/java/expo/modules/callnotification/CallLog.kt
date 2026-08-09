package expo.modules.callnotification

import android.content.Context
import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * A tiny on-device diary of what happened to incoming-call pushes.
 *
 * WHY THIS EXISTS. Everything interesting about a call arriving happens while
 * the app is CLOSED: there is no JavaScript running, no console, no error
 * screen, and — when it goes wrong — no notification either. Debugging it has
 * meant shipping a build, calling the phone, and inferring the cause from
 * silence, which is how several builds in a row got shipped against the wrong
 * theory.
 *
 * So every decision the push path takes is written here, survives the process
 * dying, and can be read back inside the app afterwards (Call alerts check).
 * "The push never arrived" and "the push arrived and we drew nothing" look
 * identical from the caller's side and have completely different fixes; this is
 * what tells them apart.
 *
 * Kept deliberately dumb — plain strings in SharedPreferences, capped — because
 * anything that can throw while handling a push is a way to lose the ring.
 */
object CallLog {
  private const val PREFS = "localo.callNotification"
  private const val KEY = "ringLog"
  private const val SEPARATOR = "\n"

  /** Enough to cover a testing session; small enough to never be a problem. */
  private const val MAX_LINES = 40

  private val clock = SimpleDateFormat("MMM d HH:mm:ss", Locale.US)

  @Synchronized
  fun add(context: Context, line: String) {
    // Mirrored to logcat for anyone with a cable: `adb logcat -s LocaloCall`.
    Log.d(CallNotifications.TAG, line)
    try {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val existing = prefs.getString(KEY, "").orEmpty()
      val entry = "${clock.format(Date())}  $line"
      val kept = (if (existing.isEmpty()) listOf(entry) else existing.split(SEPARATOR) + entry)
        .takeLast(MAX_LINES)
      // commit(), not apply(): this often runs in a service that the system is
      // free to tear down the moment it returns, and a lost line is exactly the
      // line we needed.
      prefs.edit().putString(KEY, kept.joinToString(SEPARATOR)).commit()
    } catch (ignored: Throwable) {
      // A diagnostic must never be the thing that breaks the feature.
    }
  }

  /** Newest first, which is the order anyone reading it actually wants. */
  fun read(context: Context): List<String> =
    try {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(KEY, "")
        .orEmpty()
        .split(SEPARATOR)
        .filter { it.isNotBlank() }
        .reversed()
    } catch (ignored: Throwable) {
      emptyList()
    }

  fun clear(context: Context) {
    try {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).commit()
    } catch (ignored: Throwable) {
    }
  }
}
