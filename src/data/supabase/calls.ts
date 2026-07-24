/**
 * Supabase-backed CallRepository over the `calls` table. Participants live
 * inside `data` and are updated in place. Ring-timeout expiry is swept lazily
 * on read (the mock's stand-in for realtime signaling), on the specific call
 * being touched.
 */
import type { Business, Call, CallParticipant, Employee, User } from '@/domain/types';
import type { CallRepository } from '@/data/repositories';
import { sb, uuid, nowIso, uuidOrNull, notify } from './shared';

const RING_TIMEOUT_MS = 30_000;

async function saveCall(call: Call): Promise<void> {
  const { error } = await sb().from('calls').update({ data: call }).eq('id', call.id);
  if (error) throw error;
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

/** Expire a single ringing call that rang out. Persists + notifies if it did. */
async function sweepOne(call: Call): Promise<Call> {
  if (call.status === 'ringing' && Date.now() - new Date(call.startedAt).getTime() > RING_TIMEOUT_MS) {
    call.status = 'missed';
    call.endedAt = nowIso();
    await saveCall(call);
    await notifyMissedCall(call);
  }
  return call;
}

async function loadCall(id: string): Promise<Call> {
  const { data, error } = await sb().from('calls').select('data').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Call ${id} not found`);
  return data.data as Call;
}

export function createSupabaseCalls(): CallRepository {
  return {
    async start(businessId: string, customer: { id: string; name: string }): Promise<Call> {
      const { data: bizRow } = await sb().from('businesses').select('data').eq('id', businessId).maybeSingle();
      const business = bizRow?.data as Business | undefined;
      if (!business) throw new Error(`Business ${businessId} not found`);

      const targets: CallParticipant[] = [];
      if (business.ownerHandlesCalls !== false) {
        const { data: ownerRow } = await sb().from('profiles').select('data').eq('id', business.ownerId).maybeSingle();
        const owner = ownerRow?.data as User | undefined;
        targets.push({
          id: business.ownerId,
          name: owner?.name ?? 'Owner',
          side: 'business',
          roleLabel: 'Owner',
          state: 'ringing',
        });
      }
      const handlerIds = new Set(business.callHandlerIds ?? []);
      const { data: empRows } = await sb().from('employees').select('data').eq('business_id', businessId);
      (empRows ?? [])
        .map((r) => r.data as Employee)
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
      if (targets.length === 0) {
        throw new Error('No one at this business can take voice calls right now.');
      }

      const call: Call = {
        id: uuid(),
        businessId,
        businessName: business.name,
        customerId: customer.id,
        customerName: customer.name,
        status: 'ringing',
        participants: [
          { id: customer.id, name: customer.name, side: 'customer', state: 'joined', joinedAt: nowIso() },
          ...targets,
        ],
        startedAt: nowIso(),
      };
      const { error } = await sb().from('calls').insert({
        id: call.id,
        business_id: businessId,
        customer_id: uuidOrNull(customer.id),
        data: call,
      });
      if (error) throw error;
      return call;
    },

    async getById(callId: string): Promise<Call | null> {
      const { data, error } = await sb().from('calls').select('data').eq('id', callId).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return sweepOne(data.data as Call);
    },

    async join(callId: string, participantId: string): Promise<Call> {
      const call = await sweepOne(await loadCall(callId));
      if (call.status !== 'ringing' && call.status !== 'active') {
        throw new Error('This call has already ended.');
      }
      const p = call.participants.find((x) => x.id === participantId);
      if (!p) throw new Error('You are not part of this call.');
      p.state = 'joined';
      p.joinedAt = nowIso();
      p.leftAt = undefined;
      if (call.status === 'ringing') {
        call.status = 'active';
        call.answeredAt = p.joinedAt;
      }
      await saveCall(call);
      return call;
    },

    async decline(callId: string, participantId: string): Promise<Call> {
      const call = await sweepOne(await loadCall(callId));
      const p = call.participants.find((x) => x.id === participantId && x.side === 'business');
      if (p && p.state === 'ringing') p.state = 'declined';
      const anyoneLeft = call.participants.some(
        (x) => x.side === 'business' && (x.state === 'ringing' || x.state === 'joined'),
      );
      if (!anyoneLeft && (call.status === 'ringing' || call.status === 'active')) {
        call.status = call.status === 'ringing' ? 'declined' : 'ended';
        call.endedAt = nowIso();
      }
      await saveCall(call);
      return call;
    },

    async leave(callId: string, participantId: string): Promise<Call> {
      const call = await sweepOne(await loadCall(callId));
      const p = call.participants.find((x) => x.id === participantId);
      if (!p) throw new Error('You are not part of this call.');
      const now = nowIso();
      p.state = 'left';
      p.leftAt = now;
      if (call.status === 'ringing' || call.status === 'active') {
        if (p.side === 'customer') {
          const wasRinging = call.status === 'ringing';
          call.status = wasRinging ? 'missed' : 'ended';
          call.endedAt = now;
          if (wasRinging) await notifyMissedCall(call);
        } else {
          const anyBusinessOn = call.participants.some((x) => x.side === 'business' && x.state === 'joined');
          if (call.status === 'active' && !anyBusinessOn) {
            call.status = 'ended';
            call.endedAt = now;
          }
        }
      }
      await saveCall(call);
      return call;
    },

    async getIncomingForUser(userId: string): Promise<Call | null> {
      const { data, error } = await sb()
        .from('calls')
        .select('data')
        .in('status', ['ringing', 'active']);
      if (error) throw error;
      for (const row of data ?? []) {
        const swept = await sweepOne(row.data as Call);
        if (
          (swept.status === 'ringing' || swept.status === 'active') &&
          swept.customerId !== userId &&
          swept.participants.some((p) => p.side === 'business' && p.id === userId && p.state === 'ringing')
        ) {
          return swept;
        }
      }
      return null;
    },
  };
}
