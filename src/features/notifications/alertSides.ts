/**
 * Splitting a person's alerts into their two roles — customer and business —
 * for the Chats tab and the Explore bell (customer side only) and the Workspace
 * tab's badge (unread business messages). The rule itself is `isBusinessAlert` in
 * domain/notifications.ts; this file supplies the one thing it needs from the
 * repositories: which businesses this person runs or works at.
 */
import { useEffect, useState } from 'react';
import type { AppNotification } from '@/domain/types';
import { categoryOfKind, isBusinessAlert, isBusinessChatAlert } from '@/domain/notifications';
import { useAuth, useRepositories } from '@/data/DataProvider';
import type { Repositories } from '@/data/repositories';

/** The ids of every business this user owns or is on the team of. */
export async function loadMyBusinessIds(repos: Repositories, userId: string): Promise<Set<string>> {
  const [all, memberOf] = await Promise.all([
    repos.businesses.list(),
    repos.employees.listBusinessesForUser(userId),
  ]);
  return new Set([
    ...all.filter((b) => b.ownerId === userId).map((b) => b.id),
    ...memberOf.map((b) => b.id),
  ]);
}

/**
 * The signed-in user's business ids, loaded once per user. Business
 * membership changes rarely, so this doesn't poll.
 */
export function useMyBusinessIds(): Set<string> {
  const repos = useRepositories();
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? null;
  const [ids, setIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) {
      setIds(new Set());
      return;
    }
    let active = true;
    loadMyBusinessIds(repos, userId)
      .then((s) => active && setIds(s))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [repos, userId]);

  return ids;
}

/**
 * A customer-side alert that is NOT a message — what the Alerts screen (the
 * bell on Explore) lists. Messages are shown as conversations in Chats.
 */
export const isCustomerAlert = (n: AppNotification) => categoryOfKind(n.kind) !== 'chats';

export interface UnreadCounts {
  /** Unread messages to me as a customer — the Chats tab badge. */
  chats: number;
  /** Everything else that happened to me as a customer — the bell on Explore. */
  alerts: number;
  /** Unread customer messages to a business I answer for — the Workspace badge. */
  businessChats: number;
}

/** Unread counts for the bottom bar and the Explore bell. */
export function splitUnread(items: AppNotification[], myBusinessIds: ReadonlySet<string>): UnreadCounts {
  const counts: UnreadCounts = { chats: 0, alerts: 0, businessChats: 0 };
  for (const n of items) {
    if (n.read) continue;
    if (!isBusinessAlert(n, myBusinessIds)) {
      if (isCustomerAlert(n)) counts.alerts += 1;
      else counts.chats += 1;
    } else if (isBusinessChatAlert(n)) counts.businessChats += 1;
  }
  return counts;
}

const NO_UNREAD: UnreadCounts = { chats: 0, alerts: 0, businessChats: 0 };

/** Polls the viewer's alerts and returns the unread counts. */
export function useTabBadges(): UnreadCounts {
  const repos = useRepositories();
  const { currentUser } = useAuth();
  const recipientId = currentUser?.id ?? null;
  const myBusinessIds = useMyBusinessIds();
  const [counts, setCounts] = useState<UnreadCounts>(NO_UNREAD);

  useEffect(() => {
    // Guests have no notifications — don't poll (a placeholder id like 'guest'
    // is not a valid recipient and errors against a real backend).
    if (!recipientId) {
      setCounts(NO_UNREAD);
      return;
    }
    let active = true;
    const load = () =>
      repos.notifications
        .listForUser(recipientId)
        .then((list) => active && setCounts(splitUnread(list, myBusinessIds)))
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [repos, recipientId, myBusinessIds]);

  return counts;
}

/**
 * Mark read the "new message" alerts for one customer's thread at one
 * business — called when a team member opens that conversation, since the
 * workspace inbox (not the Chats tab) is where those messages are read now.
 */
export async function markBusinessThreadRead(
  repos: Repositories,
  recipientId: string,
  businessId: string,
  participantId?: string,
): Promise<void> {
  const list = await repos.notifications.listForUser(recipientId);
  await Promise.all(
    list
      .filter(
        (n) =>
          !n.read &&
          isBusinessChatAlert(n) &&
          n.businessId === businessId &&
          (participantId === undefined || n.participantId === participantId),
      )
      .map((n) => repos.notifications.markRead(n.id)),
  );
}
