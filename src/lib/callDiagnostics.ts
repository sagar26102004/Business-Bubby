/**
 * "Call alerts on this phone" visibility flag.
 *
 * `features/notifications/CallAlertsCheck` is a DIAGNOSTIC panel, built to
 * chase down why an incoming call sometimes failed to pop up: it lists every
 * link in the ring chain, rings the phone on demand, opens system permission
 * screens and dumps the native ring log. Useful while testing, noise to a real
 * customer — half of it is only meaningful to someone holding a debugger.
 *
 * The rule, in order of authority:
 *
 *   1. `EXPO_PUBLIC_CALL_DIAGNOSTICS=true` -> on. This is how a TEST build
 *      keeps the panel: `eas.json` sets it on the `development` and `preview`
 *      profiles, and a preview APK is a release variant (`__DEV__` is false),
 *      so `__DEV__` alone would have hidden it exactly where it is needed.
 *   2. `EXPO_PUBLIC_CALL_DIAGNOSTICS=false` -> off, dev server included (lets
 *      you see what a customer sees without making a production build).
 *   3. Unset -> on with the dev server, off in any built app.
 *
 * ⛔ Never set this var on the `production` EAS profile. Unlike
 * `DEV_TOOLS_ENABLED`, this flag CAN be turned on in a release build — that is
 * the whole point for preview builds — so production's protection is that the
 * variable is absent there, not that the code refuses it.
 *
 * EXPO_PUBLIC_* vars are read at BUILD time, so restart the dev server after
 * editing `.env`.
 */
const flag = (process.env.EXPO_PUBLIC_CALL_DIAGNOSTICS ?? '').trim().toLowerCase();

export const CALL_DIAGNOSTICS_ENABLED = flag === 'true' || (__DEV__ && flag !== 'false');
