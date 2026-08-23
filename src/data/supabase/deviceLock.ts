/**
 * ONE ACCOUNT, ONE SIGNED-IN DEVICE.
 *
 * Signing in takes the account with you: the handset you left behind is signed
 * out and told why. Last sign-in wins — refusing the NEW device instead would
 * lock a person out of their own account the moment they lose a phone, and
 * there is nobody to ring to get unstuck.
 *
 * Two layers, because neither is sufficient alone (the long version is in
 * `supabase/migrations/0022_single_device_session.sql`):
 *
 *   1. `signOut({ scope: 'others' })` on every sign-in destroys the other
 *      sessions' refresh tokens server-side. Real revocation — but Supabase is
 *      explicit that already-issued ACCESS tokens stay valid until they expire,
 *      so on its own the old phone keeps working for up to an hour.
 *   2. The `active_devices` claim, polled by `SingleDeviceGate`, so the
 *      displaced device signs itself out within a minute and explains itself.
 *
 * WHY THIS LIVES IN THE SUPABASE FOLDER AND IS SHARED WITH PATH B.
 * Identity is Supabase on BOTH backends — `src/data/api/auth.ts` signs in
 * through the same GoTrue and holds the same session — so the claim belongs
 * next to the session it protects, and both auth implementations call this one
 * copy. Same precedent as media uploads (`lib/upload.ts`): no Express twin, and
 * nothing for the Path B sync queue.
 *
 * EVERYTHING HERE IS BEST-EFFORT AND NEVER THROWS. A claim that fails to write
 * must not break a sign-in that has already succeeded, and a check that fails
 * to read must not sign anybody out.
 */
import type { DeviceClaimState } from '@/data/repositories';
import { describeThisDevice, getDeviceId } from '@/lib/device';
import { sb, nowIso } from './shared';

/**
 * The session's account, or null when there is nobody to claim for.
 *
 * Anonymous sessions are deliberately excluded. A guest identity is a
 * throwaway minted per install, never shared between devices, so there is
 * nothing to enforce — and claiming for one would write a row for an account
 * that is about to be discarded.
 */
async function claimableUserId(): Promise<string | null> {
  const { data } = await sb().auth.getSession();
  const user = data.session?.user;
  if (!user || user.is_anonymous) return null;
  return user.id;
}

/**
 * Make this device the account's one signed-in device, displacing whatever
 * held it before.
 *
 * Called at the end of every real sign-in path (password, Google, sign-up, dev
 * impersonation). The upsert is a single statement on a `user_id` primary key,
 * so two devices signing in at the same instant serialise rather than racing.
 */
export async function claimThisDevice(): Promise<void> {
  try {
    const userId = await claimableUserId();
    if (!userId) return;
    const deviceId = await getDeviceId();

    const { error } = await sb()
      .from('active_devices')
      .upsert(
        { user_id: userId, device_id: deviceId, label: describeThisDevice(), claimed_at: nowIso() },
        { onConflict: 'user_id' },
      );
    // Loud in dev, harmless in production: a missing table (the project hasn't
    // run 0022) leaves the rule unenforced, and silence is how that goes
    // unnoticed for a month.
    if (error) warn('could not claim this device', error.message);

    // The half that a modified client cannot ignore. Runs even if the claim
    // above failed, because it is the stronger of the two.
    const { error: revokeError } = await sb().auth.signOut({ scope: 'others' });
    // `others` keeps THIS session and fires no SIGNED_OUT event, so the app
    // does not flicker through a signed-out state here.
    if (revokeError) warn('could not sign out other devices', revokeError.message);
  } catch (e) {
    warn('could not claim this device', e);
  }
}

/**
 * Give up this device's claim on the way out, so the row does not outlive the
 * session that owned it.
 *
 * Matches on `device_id` as well as the account: a device that has ALREADY been
 * displaced must not delete its successor's claim while signing itself out —
 * which is exactly what `SingleDeviceGate` makes it do.
 */
export async function releaseThisDevice(): Promise<void> {
  try {
    const userId = await claimableUserId();
    if (!userId) return;
    const deviceId = await getDeviceId();
    await sb()
      .from('active_devices')
      .delete()
      .eq('user_id', userId)
      .eq('device_id', deviceId);
  } catch (e) {
    warn('could not release this device', e);
  }
}

/**
 * Does this device still hold the account?
 *
 * A MISSING ROW IS NOT AN EVICTION — it is claimed instead. Accounts already
 * signed in when this shipped have no row at all, and reading "no row" as
 * "displaced" would sign every one of them out on their next app launch. The
 * first device to ask simply becomes the holder.
 */
export async function checkDeviceClaim(): Promise<DeviceClaimState> {
  try {
    const userId = await claimableUserId();
    // Nobody signed in, or a guest: nothing to enforce, and nothing to report.
    if (!userId) return 'active';
    const deviceId = await getDeviceId();

    const { data, error } = await sb()
      .from('active_devices')
      .select('device_id')
      .eq('user_id', userId)
      .maybeSingle();
    // Unreachable, or no such table yet. Fail OPEN — see `DeviceClaimState`.
    if (error) return 'unknown';

    if (!data) {
      await claimThisDevice();
      return 'active';
    }
    return data.device_id === deviceId ? 'active' : 'evicted';
  } catch {
    return 'unknown';
  }
}

function warn(what: string, detail: unknown): void {
  // eslint-disable-next-line no-console
  console.warn(`[single-device] ${what}:`, detail);
}
