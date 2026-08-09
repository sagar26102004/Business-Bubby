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
   * Detach a token — on sign-out. Scoped to the caller's own rows, so a stale
   * token that now belongs to someone else is left alone rather than silently
   * unsubscribing them.
   */
  async unregister(userId: string, token: string): Promise<void> {
    if (!token) return;
    await prisma.pushToken.deleteMany({ where: { token, userId } });
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
