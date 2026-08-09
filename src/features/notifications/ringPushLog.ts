/**
 * What the server said the last time this device asked it to ring someone.
 *
 * Placing a call fires the `call-ring` push and deliberately ignores the
 * result, because a failed push must never stop a call being made. That is the
 * right behaviour and it also means the single most useful fact — "the server
 * had nobody to ring" versus "the push went out and the phone dropped it" —
 * was being thrown away, leaving no way to tell the two apart without the
 * Supabase dashboard.
 *
 * So keep the answer in memory (this is a debugging aid, not state worth
 * persisting) and show it in the call-alerts check.
 */
export interface RingPushResult {
  at: string;
  /** How many devices the push service ACCEPTED the message for. */
  sent?: number;
  /** How many it was asked to ring — `sent` short of this means partial failure. */
  attempted?: number;
  /** Why it sent none: "no registered devices", "not ringing", an error… */
  reason?: string;
  /**
   * What the push service said about the messages it refused, verbatim.
   *
   * Worth keeping word-for-word because these sentences name their own fix —
   * "Unable to retrieve the FCM server key" means credentials are missing from
   * the EAS project, which no amount of fiddling on the phone will ever cure.
   */
  failures?: string[];
}

let last: RingPushResult | null = null;

export function recordRingPush(result: unknown): void {
  const body = (result ?? {}) as {
    sent?: number;
    attempted?: number;
    reason?: string;
    error?: string;
    failures?: string[];
  };
  last = {
    at: new Date().toISOString(),
    sent: typeof body.sent === 'number' ? body.sent : undefined,
    attempted: typeof body.attempted === 'number' ? body.attempted : undefined,
    reason: body.reason ?? body.error,
    failures: Array.isArray(body.failures) && body.failures.length > 0 ? body.failures : undefined,
  };
}

export function recordRingPushFailure(err: unknown): void {
  last = {
    at: new Date().toISOString(),
    reason: err instanceof Error ? err.message : 'the ring push could not be sent',
  };
}

export function getLastRingPush(): RingPushResult | null {
  return last;
}
