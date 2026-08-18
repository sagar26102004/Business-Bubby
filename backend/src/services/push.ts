/**
 * Device push tokens — how a CLOSED app still gets told a call is ringing.
 *
 * Incoming calls are discovered by polling, which only runs while the app is
 * open. A business owner who swiped Localo away never learns anyone called. So
 * every signed-in device registers its Expo push token here, and `calls.start`
 * pushes to the ring targets (see `ringDevices`). The push is only the
 * DOORBELL — the call audio still runs over LiveKit, unchanged.
 *
 * ⚠️ A push token is a routable address for a specific handset. There is
 * deliberately NO read or list endpoint, and a caller may only ever touch their
 * own rows — otherwise one user could enumerate another's devices and spam them
 * directly.
 */
import { prisma } from '@/db';

export const pushService = {
  /**
   * Attach this device's token to the signed-in user. Idempotent.
   *
   * `token` is the primary key and the upsert OVERWRITES `user_id` on
   * conflict — that reassignment is the point: when one person signs out of a
   * shared handset and another signs in, the token must follow the current
   * account or the phone would ring for calls that aren't theirs.
   */
  async register(userId: string, token: string, platform?: string): Promise<void> {
    if (!token) return;
    const now = new Date();
    await prisma.pushToken.upsert({
      where: { token },
      create: { token, userId, platform, updatedAt: now },
      update: { userId, platform, updatedAt: now },
    });
  },

  /**
   * Will the SERVER ring this phone for this account?
   *
   * ⚠️ Scoped to the caller's own rows on purpose. Holding a push token must
   * never answer whether SOMEONE ELSE's device is registered, or this becomes an
   * oracle for exactly the enumeration the table's RLS exists to prevent.
   *
   * It exists because the call-alerts check used to report "registered" purely
   * because `getPushToken()` returned a token — a DEVICE-side fact. Registration
   * is a separate server-side write that the registrar swallows on failure and
   * skips for guests, so a phone could look healthy while the ring reported "no
   * registered devices", with both sides telling the truth.
   */
  async isRegistered(userId: string, token: string): Promise<boolean> {
    if (!token) return false;
    const row = await prisma.pushToken.findFirst({
      where: { token, userId },
      select: { token: true },
    });
    return Boolean(row);
  },

  /**
   * Detach a token — on sign-out. Scoped to the caller's own rows, so a stale
   * token that now belongs to someone else is left alone rather than silently
   * unsubscribing them.
   */
  async unregister(userId: string, token: string): Promise<void> {
    if (!token) return;
    await prisma.pushToken.deleteMany({ where: { token, userId } });
  },

  /**
   * Forget tokens the push service told us are dead (`DeviceNotRegistered` —
   * the install behind them is gone). Internal use only, and deliberately NOT
   * called for any other push failure: `InvalidCredentials` is a project
   * misconfiguration, and pruning on it would delete perfectly good tokens.
   */
  async dropTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await prisma.pushToken.deleteMany({ where: { token: { in: tokens } } });
  },

  /**
   * Who a push token belongs to, or null if it is not registered.
   *
   * ⚠️ Internal use only, and the ONE place a raw token is allowed to identify
   * somebody. It exists for the decline-from-a-closed-app path, where there is
   * no JWT to verify — see `callService.declineByDevice`.
   */
  async userForToken(token: string): Promise<string | null> {
    if (!token) return null;
    const row = await prisma.pushToken.findUnique({
      where: { token },
      select: { userId: true },
    });
    return row?.userId ?? null;
  },

  /** The Expo push tokens registered by these users. Internal use only. */
  async tokensFor(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await prisma.pushToken.findMany({
      where: { userId: { in: userIds } },
      select: { token: true },
    });
    return rows.map((r) => r.token);
  },
};
