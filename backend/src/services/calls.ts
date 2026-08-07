/** Voice calls — ports MockCallRepository (ring state machine + missed sweep). */
import { AccessToken } from 'livekit-server-sdk';
import type { Business, Call, CallAudioToken, CallParticipant, Employee, User } from '@/domain/types';
import { prisma } from '@/db';
import { config, isLivekitConfigured } from '@/config';
import { newUuid } from '@/lib/ids';
import { asData, rowsData, toJson, uuidOrNull } from '@/lib/data';
import { forbidden, HttpError, notFound } from '@/http/errors';
import { notify } from './notify';

const RING_TIMEOUT_MS = 30_000;

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

/** Expire one call if it rang out. Persists + notifies. Returns the call. */
async function sweepCall(call: Call): Promise<Call> {
  if (call.status === 'ringing' && Date.now() - new Date(call.startedAt).getTime() > RING_TIMEOUT_MS) {
    call.status = 'missed';
    call.endedAt = new Date().toISOString();
    await saveCall(call);
    await notifyMissedCall(call);
  }
  return call;
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
