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
/** Must match CALL_CATEGORY_ID — puts Accept/Decline on the notification. */
const CALL_CATEGORY_ID = 'incoming_call';

/**
 * One entry from Expo's /push/send response — the fate of ONE message.
 *
 * `status: 'ok'` means Expo took it, not that a phone showed it; the delivery
 * answer proper is a receipt fetched later (~15 minutes), far too slow to help
 * a call that rings for 30 seconds. The ticket is the only feedback available in
 * time, and it is enough to separate the permanent failures (bad credentials,
 * dead token) from a phone that simply didn't react.
 */
interface Ticket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** What `ringDevices` learned — mirrors `RingPushResult` in the app. */
interface RingPushOutcome {
  sent: number;
  attempted?: number;
  failed?: number;
  failures?: string[];
  reason?: string;
}

/**
 * Wake the phones of everyone this call is ringing.
 *
 * In-app polling only finds a call while the app is OPEN, so without this a
 * business that closed Localo never learns anyone rang. The push is only the
 * doorbell — the call itself is unchanged.
 *
 * DATA-ONLY on purpose, and the bar for that is stricter than it looks.
 *
 * Expo's push service emits an FCM `android.notification` block if it is handed
 * ANY field that belongs in one. That block sets `gcm.n.e=1`, and
 * `FirebaseMessagingService.handleIntent()` renders such a message ITSELF and
 * returns *before* `onMessageReceived` whenever the app is backgrounded — so the
 * native `CallMessagingService` is selected and then never invoked, and the
 * CallStyle popup, the full-screen call screen and even the ring log never run.
 *
 * The non-obvious half: `channelId` counts as a notification field for this
 * purpose, because `android_channel_id` has to live inside that same block.
 * Dropping `title`/`body`/`sound` alone is NOT enough — `channelId` on its own
 * still triggers the FCM render, and the result is a genuinely BLANK
 * notification drawn on calls_v2 (`dumpsys notification` → `tag=FCM-
 * Notification:*`, `android.title=null`). That blank render is what made an
 * earlier data-only attempt look like a failure and get reverted. Measured on a
 * real phone 2026-08-10 (realme RMX3241 / Android 13).
 *
 * Dropping the channel costs nothing on the real path: the popup is posted
 * natively on CallNotifications.RING_CHANNEL_ID ('calls_v2'), and that channel
 * owns the ringtone and the vibration. Only expo-notifications' last-resort
 * render loses the channel and lands on the default one; `categoryId` still
 * gives it Accept/Decline.
 *
 * Best-effort by contract — never throws into `start()`. A push that fails
 * (nobody registered, Expo down, no network) must not stop a call being placed;
 * anyone with the app open still rings from the poll. The RESULT is still
 * returned (and logged by `start`), because "the server had nobody to ring" and
 * "the push went out and the phone dropped it" need completely different fixes.
 */
async function ringDevices(call: Call): Promise<RingPushOutcome> {
  try {
    const targets = call.participants
      .filter((p) => p.side === 'business' && p.state === 'ringing')
      .map((p) => p.id);
    if (targets.length === 0) return { sent: 0, reason: 'nobody to ring' };
    const tokens = await pushService.tokensFor(targets);
    if (tokens.length === 0) return { sent: 0, reason: 'no registered devices' };
    const messages = tokens.map((to) => ({
      to,
      priority: 'high',
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
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
    if (!res.ok) {
      return { sent: 0, attempted: messages.length, reason: 'the push service rejected the request' };
    }

    // ⚠️ A 200 HERE DOES NOT MEAN ANYONE'S PHONE RANG. Expo answers every
    // /push/send with 200 and a PER-MESSAGE ticket, and a message it could not
    // accept comes back as `{ status: 'error' }` inside that otherwise happy
    // response. Reporting `messages.length` as "sent" — which this used to do —
    // therefore claimed success for the two failures that actually happen:
    //
    //   • InvalidCredentials — no FCM V1 key uploaded for this EAS project, so
    //     Expo has nothing to hand the message to. EVERY Android push fails.
    //   • DeviceNotRegistered — the token belongs to an install that is gone
    //     (reinstall, cleared data, uninstalled). Permanently silent.
    //
    // Both are indistinguishable from "the phone ignored it" without this, and
    // that is a completely different problem with a completely different fix.
    const tickets: Ticket[] = Array.isArray(body?.data) ? (body!.data as Ticket[]) : [];

    // Tickets come back in the order the messages went out, which is the only
    // thing tying a failure back to the token that caused it.
    const failures = tickets
      .map((ticket, i) => ({ ticket, token: tokens[i] }))
      .filter((x) => x.ticket?.status === 'error');

    // A token whose device is gone will never work again, so stop sending to it
    // (Expo's own guidance). ONLY for DeviceNotRegistered: InvalidCredentials is
    // a project misconfiguration, and pruning on it would destroy perfectly good
    // tokens and turn a five-minute fix into a re-registration hunt.
    const dead = failures
      .filter((x) => x.ticket.details?.error === 'DeviceNotRegistered')
      .map((x) => x.token);
    if (dead.length > 0) await pushService.dropTokens(dead);

    const accepted = tickets.filter((t) => t?.status === 'ok').length;
    // Distinct messages only: ten phones failing for one reason is one fact.
    // Kept verbatim from Expo — its messages name their own fix ("Unable to
    // retrieve the FCM server key…"), and paraphrasing them would lose that.
    const reasons = [...new Set(failures.map((x) => x.ticket.message).filter(Boolean))] as string[];

    return {
      // `sent` means ACCEPTED BY EXPO, not "handed to fetch".
      sent: accepted,
      attempted: messages.length,
      failed: failures.length,
      failures: reasons,
      reason:
        accepted === 0 && reasons.length > 0
          ? reasons.join('; ')
          : accepted === 0
            ? 'the push service accepted nothing and gave no reason'
            : undefined,
    };
  } catch (err) {
    /* the call still stands — see the contract above */
    return { sent: 0, reason: err instanceof Error ? err.message : 'the ring push could not be sent' };
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
    // failing push must not hold up (or fail) placing the call. The outcome is
    // logged rather than dropped — it is the only place that says whether Expo
    // actually accepted the messages.
    void ringDevices(call).then((outcome) => {
      if (outcome.sent === 0) {
        console.warn(`[calls] ring push for ${call.id} reached nobody: ${outcome.reason ?? 'unknown'}`);
      }
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

  /**
   * Refuse a ringing call from a phone with NO SESSION — the Decline pill on the
   * incoming-call notification.
   *
   * That button is handled in Kotlin (`CallActionReceiver`) precisely so it does
   * not open the app, which means there is no JavaScript, no signed-in session
   * and no access token to send. Without this the receiver could only silence
   * the phone locally: the call kept ringing the CALLER for the rest of its
   * 30-second window and then landed in the missed log, so declining and
   * ignoring were the same thing from the caller's side.
   *
   * AUTHORIZATION IS BY DEVICE, NOT BY USER. The Expo push token saved next to
   * the app is the address the call was rung on, so possessing it is exactly the
   * claim being made — "I am the device you rang". It resolves to a user, and
   * that user must ALREADY be a business participant on THIS call whose state is
   * still `ringing`. The worst a stolen token can do is refuse a call ringing
   * that handset right now, which is also what holding the phone would allow.
   *
   * Deliberately NOT routed through `decline()` above: that one expects an
   * authenticated caller, and this one must never be reachable with a user id
   * supplied by the request.
   */
  async declineByDevice(callId: string, pushToken: string): Promise<{ ok: true; status: string }> {
    if (!callId || !pushToken) throw new HttpError(400, 'callId and pushToken are required');
    // A token that isn't registered proves nothing, so it gets the same flat
    // refusal as a wrong one.
    const deviceUserId = await pushService.userForToken(pushToken);
    if (!deviceUserId) throw forbidden('Unknown device');

    const call = await mustFind(callId);
    const me = call.participants.find((p) => p.id === deviceUserId && p.side === 'business');
    if (!me) throw forbidden('You are not on this call');
    // Someone who already joined is LEAVING, not declining — a different verb
    // with different consequences for the call's status.
    if (me.state !== 'ringing') return { ok: true, status: call.status };

    me.state = 'declined';
    // The call itself only ends when NOBODY on the business side is left: a
    // group ring where one person declines must keep ringing the others.
    const anyoneLeft = call.participants.some(
      (p) => p.side === 'business' && (p.state === 'ringing' || p.state === 'joined'),
    );
    if (!anyoneLeft && (call.status === 'ringing' || call.status === 'active')) {
      call.status = call.status === 'ringing' ? 'declined' : 'ended';
      call.endedAt = new Date().toISOString();
    }
    await saveCall(call);
    return { ok: true, status: call.status };
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
