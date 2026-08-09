/** Voice calls — ports MockCallRepository (ring state machine + missed sweep). */
import { AccessToken } from 'livekit-server-sdk';
import type { Business, Call, CallAudioToken, CallParticipant, Employee, User } from '@/domain/types';
import { prisma } from '@/db';
import { config, isLivekitConfigured } from '@/config';
import { newUuid } from '@/lib/ids';
import { asData, rowsData, toJson, uuidOrNull } from '@/lib/data';
import { forbidden, HttpError, notFound } from '@/http/errors';
import { notify } from './notify';
import { pushService } from './push';

const RING_TIMEOUT_MS = 30_000;

/** Default window of the workspace call log: the last 7 days. */
const CALL_LOG_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

async function saveCall(call: Call): Promise<void> {
  await prisma.call.update({
    where: { id: call.id },
    data: { customerId: uuidOrNull(call.customerId), data: toJson(call) },
  });
}

async function notifyMissedCall(call: Call): Promise<void> {
  await Promise.all(
    call.participants
      .filter((p) => p.side === 'business')
      .map((p) =>
        notify({
          recipientId: p.id,
          kind: 'missed_call',
          title: `Missed call · ${call.businessName}`,
          body: `${call.customerName} tried to call.`,
          businessId: call.businessId,
        }),
      ),
  );
}

/**
 * Expire one call if it rang out. Persists + notifies. Returns the call.
 *
 * ⚠️ Both sides of this comparison must come from THIS machine. `startedAt` is
 * stamped by `start()` on the server, so `Date.now()` is a valid yardstick.
 *
 * Path A learned this the hard way: there the caller's DEVICE stamped
 * `startedAt` and every business member's poll judged it against THEIR clock, so
 * a phone running ~39s fast expired brand-new calls on its first poll — the
 * caller saw "No answer" within two seconds and that phone never rang at all.
 * If a client-supplied timestamp ever reaches this function, switch it to the
 * row's server `createdAt` instead of comparing clocks that don't agree.
 */
async function sweepCall(call: Call): Promise<Call> {
  if (call.status === 'ringing' && Date.now() - new Date(call.startedAt).getTime() > RING_TIMEOUT_MS) {
    call.status = 'missed';
    call.endedAt = new Date().toISOString();
    await saveCall(call);
    await notifyMissedCall(call);
  }
  return call;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Must match CALL_CHANNEL_ID in src/features/notifications/push.ts. */
const CALL_CHANNEL_ID = 'calls_v2';
/** Must match CALL_CATEGORY_ID — puts Accept/Decline on the notification. */
const CALL_CATEGORY_ID = 'incoming_call';

/**
 * Wake the phones of everyone this call is ringing.
 *
 * In-app polling only finds a call while the app is OPEN, so without this a
 * business that closed Localo never learns anyone rang. The push is only the
 * doorbell — the call itself is unchanged.
 *
 * DATA-ONLY on purpose: a payload carrying title/body makes Android render its
 * own plain banner, which can't be restyled. Sending data only means the app's
 * background task wakes and posts the real system call popup instead.
 *
 * Best-effort by contract — never throws into `start()`. A push that fails
 * (nobody registered, Expo down, no network) must not stop a call being placed;
 * anyone with the app open still rings from the poll.
 */
async function ringDevices(call: Call): Promise<void> {
  try {
    const targets = call.participants
      .filter((p) => p.side === 'business' && p.state === 'ringing')
      .map((p) => p.id);
    const tokens = await pushService.tokensFor(targets);
    if (tokens.length === 0) return;
    const messages = tokens.map((to) => ({
      to,
      priority: 'high',
      channelId: CALL_CHANNEL_ID,
      categoryId: CALL_CATEGORY_ID,
      // A ring is worthless once answered elsewhere or timed out.
      ttl: RING_TIMEOUT_MS / 1000,
      data: {
        callId: call.id,
        kind: 'incoming_call',
        callerName: call.customerName,
        businessName: call.businessName,
      },
      _contentAvailable: true,
    }));
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
  } catch {
    /* the call still stands — see the contract above */
  }
}

/** Expire every ringing call past the timeout (used on reads that scan calls). */
async function sweepRinging(): Promise<void> {
  const rows = await prisma.call.findMany();
  for (const row of rows) {
    const call = asData<Call>(row);
    if (call.status === 'ringing') await sweepCall(call);
  }
}

async function mustFind(callId: string): Promise<Call> {
  const row = await prisma.call.findUnique({ where: { id: callId } });
  if (!row) throw notFound(`Call ${callId} not found`);
  return asData<Call>(row);
}

export const callService = {
  async start(businessId: string, customer: { id: string; name: string }): Promise<Call> {
    const bizRow = await prisma.business.findUnique({ where: { id: businessId } });
    if (!bizRow) throw notFound(`Business ${businessId} not found`);
    const business = asData<Business>(bizRow);

    const targets: CallParticipant[] = [];
    if (business.ownerHandlesCalls !== false) {
      const ownerRow = await prisma.profile.findUnique({ where: { id: business.ownerId } });
      const owner = ownerRow ? asData<User>(ownerRow) : undefined;
      targets.push({
        id: business.ownerId,
        name: owner?.name ?? 'Owner',
        side: 'business',
        roleLabel: 'Owner',
        state: 'ringing',
      });
    }
    const handlerIds = new Set(business.callHandlerIds ?? []);
    const employees = rowsData<Employee>(await prisma.employee.findMany({ where: { businessId } }));
    employees
      .filter((e) => handlerIds.has(e.id) && e.userId && e.userId !== business.ownerId)
      .forEach((e) =>
        targets.push({
          id: e.userId!,
          name: e.displayName,
          side: 'business',
          roleLabel: e.role ?? (e.level === 'manager' ? 'Manager' : 'Staff'),
          state: 'ringing',
        }),
      );
    // Never ring the caller themselves (they may be this business's owner or a
    // call-handler), and dedupe so one person can't appear twice — a duplicate
    // participant id crashes the session's participant list (React keys).
    const seen = new Set<string>([customer.id]);
    const ringTargets = targets.filter((t) => !seen.has(t.id) && seen.add(t.id));
    if (ringTargets.length === 0) {
      throw new Error(
        targets.some((t) => t.id === customer.id)
          ? "You're set to answer this business's calls yourself — there's no one else to ring."
          : 'No one at this business can take voice calls right now.',
      );
    }

    const now = new Date().toISOString();
    const call: Call = {
      id: newUuid(),
      businessId,
      businessName: business.name,
      customerId: customer.id,
      customerName: customer.name,
      status: 'ringing',
      participants: [
        { id: customer.id, name: customer.name, side: 'customer', state: 'joined', joinedAt: now },
        ...ringTargets,
      ],
      startedAt: now,
    };
    await prisma.call.create({
      data: {
        id: call.id,
        businessId,
        customerId: uuidOrNull(call.customerId),
        data: toJson(call),
      },
    });
    // Wake any handler whose app is closed. Deliberately not awaited: a slow or
    // failing push must not hold up (or fail) placing the call.
    void ringDevices(call);
    return call;
  },

  async getById(callId: string): Promise<Call | null> {
    const row = await prisma.call.findUnique({ where: { id: callId } });
    if (!row) return null;
    return sweepCall(asData<Call>(row));
  },

  async join(callId: string, participantId: string): Promise<Call> {
    const call = await sweepCall(await mustFind(callId));
    if (call.status !== 'ringing' && call.status !== 'active') {
      throw new Error('This call has already ended.');
    }
    const p = call.participants.find((x) => x.id === participantId);
    if (!p) throw new Error('You are not part of this call.');
    p.state = 'joined';
    p.joinedAt = new Date().toISOString();
    p.leftAt = undefined;
    if (call.status === 'ringing') {
      call.status = 'active';
      call.answeredAt = p.joinedAt;
    }
    await saveCall(call);
    return call;
  },

  async decline(callId: string, participantId: string): Promise<Call> {
    const call = await sweepCall(await mustFind(callId));
    const p = call.participants.find((x) => x.id === participantId && x.side === 'business');
    if (p && p.state === 'ringing') p.state = 'declined';
    const anyoneLeft = call.participants.some(
      (x) => x.side === 'business' && (x.state === 'ringing' || x.state === 'joined'),
    );
    if (!anyoneLeft && (call.status === 'ringing' || call.status === 'active')) {
      call.status = call.status === 'ringing' ? 'declined' : 'ended';
      call.endedAt = new Date().toISOString();
    }
    await saveCall(call);
    return call;
  },

  async leave(callId: string, participantId: string): Promise<Call> {
    const call = await sweepCall(await mustFind(callId));
    const p = call.participants.find((x) => x.id === participantId);
    if (!p) throw new Error('You are not part of this call.');
    const now = new Date().toISOString();
    p.state = 'left';
    p.leftAt = now;

    if (call.status === 'ringing' || call.status === 'active') {
      if (p.side === 'customer') {
        const wasRinging = call.status === 'ringing';
        call.status = wasRinging ? 'missed' : 'ended';
        call.endedAt = now;
        if (wasRinging) await notifyMissedCall(call);
      } else {
        const anyBusinessOn = call.participants.some(
          (x) => x.side === 'business' && x.state === 'joined',
        );
        if (call.status === 'active' && !anyBusinessOn) {
          call.status = 'ended';
          call.endedAt = now;
        }
      }
    }
    await saveCall(call);
    return call;
  },

  /**
   * Mint a LiveKit access token so this participant can join the call's audio
   * room. Mirrors the Supabase edge function (`dynamic-responder`): the caller
   * must already be a participant on the call, the room is `call_<callId>` and
   * the LiveKit identity is the user id.
   */
  async getAudioToken(callId: string, userId: string): Promise<CallAudioToken> {
    if (!isLivekitConfigured()) {
      throw new HttpError(501, 'Live audio is not configured.');
    }
    const call = await mustFind(callId);
    const me = call.participants.find((p) => p.id === userId);
    if (!me) throw forbidden('You are not part of this call.');

    const at = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
      identity: userId,
      name: me.name,
      ttl: '2h',
    });
    at.addGrant({
      room: `call_${callId}`,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });
    return { token: await at.toJwt(), url: config.livekitUrl };
  },

  /**
   * The workspace call log: every call this business received in the window,
   * newest first. Answered, missed and declined alike.
   *
   * Sweeps ring-timeouts first so a call that rang out reads as "missed" here
   * rather than as a permanently ringing ghost — the same rule every other read
   * path applies.
   */
  async listForBusiness(businessId: string, sinceIso?: string): Promise<Call[]> {
    await sweepRinging();
    const since = sinceIso ?? new Date(Date.now() - CALL_LOG_WINDOW_MS).toISOString();
    const rows = await prisma.call.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
    return rows
      .map((row) => asData<Call>(row))
      .filter((c) => c.startedAt >= since)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  },

  async getIncomingForUser(userId: string): Promise<Call | null> {
    await sweepRinging();
    const rows = await prisma.call.findMany();
    for (const row of rows) {
      const c = asData<Call>(row);
      if (
        (c.status === 'ringing' || c.status === 'active') &&
        c.customerId !== userId &&
        c.participants.some((p) => p.side === 'business' && p.id === userId && p.state === 'ringing')
      ) {
        return c;
      }
    }
    return null;
  },
};
