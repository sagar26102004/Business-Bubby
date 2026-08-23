/**
 * Mounted once in the root layout. Renders nothing.
 *
 * Enforces the second half of the one-account-one-device rule: this device asks,
 * regularly, whether it still holds the account, and signs itself out with an
 * explanation the moment it finds out it doesn't.
 *
 * WHY A POLL AND NOT A PUSH. Signing in elsewhere already revokes this device's
 * refresh token server-side (`signOut({ scope: 'others' })` in deviceLock.ts) —
 * but Supabase is explicit that an access token already issued stays valid
 * until it expires, up to an hour later. Without this the displaced phone keeps
 * working for that hour and then dies with a token error nobody can read. The
 * poll turns that into "you were signed out because your account was used on an
 * Android phone", inside a minute.
 *
 * A realtime subscription would be instant rather than near-instant, at the
 * cost of a live socket on every device for an event that fires once in a blue
 * moon. Not worth it; a minute is well inside what a person forgives.
 *
 * WHAT IT WILL NOT DO. `'unknown'` — offline, server down, migration 0022 not
 * applied — never signs anybody out. A person on a patchy connection losing
 * their session would be a far worse bug than a second device surviving a few
 * extra minutes.
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { showAlert } from '@/lib/alert';

/**
 * How often a foregrounded app re-checks.
 *
 * One read of one row by primary key, so the cost is negligible next to the
 * 2-second call poll already running. The real bound on how fast a person
 * learns is the app being open at all — hence the foreground check below, which
 * is what actually catches the phone left in a pocket.
 */
const CHECK_EVERY_MS = 60_000;

export function SingleDeviceGate() {
  const { auth } = useRepositories();
  const { currentUser, isGuest, signOut } = useAuth();
  // Guests are exempt: an anonymous identity is minted per install and shared
  // with nobody, so there is no second device it could be signed in on.
  const enabled = !!currentUser && !isGuest;

  /**
   * Stops a slow check that resolves AFTER the person has already signed out
   * (or been signed out) from firing a second alert at whoever is here now.
   */
  const evicting = useRef(false);
  useEffect(() => {
    evicting.current = false;
  }, [currentUser?.id]);

  const check = useCallback(async () => {
    if (!enabled || evicting.current) return;
    const state = await auth.checkDeviceClaim();
    if (state !== 'evicted' || evicting.current) return;
    evicting.current = true;
    // Sign out FIRST, then explain. The other order leaves a modal sitting on
    // top of screens still rendering an account this device no longer holds.
    await signOut().catch(() => {});
    // Deliberately says "another device" and not which one: the claim row
    // records a label, but naming it would tell whoever is holding THIS phone
    // something about where its owner is, and the person who needs the detail
    // is the one who did the signing in.
    showAlert(
      'Signed out',
      'Your account was signed in on another device. Localo allows one device ' +
        'at a time — sign in again here to move it back.',
    );
  }, [auth, enabled, signOut]);

  useEffect(() => {
    if (!enabled) return;
    void check();
    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    // The important one: a phone that spent the night in a pocket asks the
    // instant it is picked up, rather than up to a minute later.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled, check]);

  return null;
}
