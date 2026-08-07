/**
 * Notification categories — the families of alert a person can silence.
 *
 * A busy cafe owner gets pinged for every order, every call and every chat.
 * Muting is per PERSON, per BUSINESS, per FAMILY: mute "Orders" for the cafe
 * and the pings stop, while the orders themselves keep arriving in the
 * workspace exactly as before. Nothing is deleted or blocked — muting only
 * decides what reaches the Alerts tab and its unread badge.
 *
 * Mutes are stored on `User.mutedNotifications` as `"<businessId>:<category>"`
 * keys, with the businessId `*` meaning "this family, everywhere".
 */
import type { AppNotification } from './types';

export type NotificationCategory =
  | 'orders'
  | 'chats'
  | 'calls'
  | 'bookings'
  | 'billing'
  | 'members'
  | 'reviews'
  | 'stall';

export interface NotificationCategoryDef {
  id: NotificationCategory;
  label: string;
  icon: string;
  /** One line for the toggle row. */
  description: string;
}

/** Every family, in the order the settings screen lists them. */
export const NOTIFICATION_CATEGORIES: NotificationCategoryDef[] = [
  {
    id: 'orders',
    label: 'Orders',
    icon: '🛒',
    description: 'New orders, proposals and order updates.',
  },
  {
    id: 'chats',
    label: 'Chats',
    icon: '💬',
    description: 'New messages and replies.',
  },
  {
    id: 'calls',
    label: 'Calls',
    icon: '📞',
    description: 'Missed voice calls. Ringing is never silenced.',
  },
  {
    id: 'bookings',
    label: 'Appointments',
    icon: '📅',
    description: 'Booking requests and their accept/decline.',
  },
  {
    id: 'billing',
    label: 'Bills & payments',
    icon: '🧾',
    description: 'Bills issued and reported payments.',
  },
  {
    id: 'members',
    label: 'Members & plans',
    icon: '🎫',
    description: 'Enrolment and subscription requests.',
  },
  {
    id: 'reviews',
    label: 'Ratings & reviews',
    icon: '⭐',
    description: 'New ratings customers leave.',
  },
  {
    id: 'stall',
    label: 'Stall questions',
    icon: '🏷️',
    description: 'Questions and price offers on items for sale.',
  },
];

/** Which family an alert belongs to. */
export function categoryOfKind(kind: AppNotification['kind']): NotificationCategory {
  switch (kind) {
    case 'chat_reply':
      return 'chats';
    case 'missed_call':
      return 'calls';
    case 'order_requested':
    case 'order_update':
      return 'orders';
    case 'bill_issued':
    case 'payment_reported':
    case 'payment_update':
      return 'billing';
    case 'booking_requested':
    case 'booking_update':
      return 'bookings';
    case 'review_posted':
      return 'reviews';
    case 'product_question':
    case 'product_reply':
      return 'stall';
    case 'enroll_requested':
    case 'enroll_update':
      return 'members';
    default:
      return 'chats';
  }
}

/** The stored key for one toggle. `businessId` omitted = everywhere (`*`). */
export function muteKey(category: NotificationCategory, businessId?: string): string {
  return `${businessId ?? '*'}:${category}`;
}

/** Is this family silenced for this business (or everywhere)? */
export function isCategoryMuted(
  mutes: string[] | undefined,
  category: NotificationCategory,
  businessId?: string,
): boolean {
  if (!mutes || mutes.length === 0) return false;
  if (mutes.includes(muteKey(category))) return true;
  return businessId ? mutes.includes(muteKey(category, businessId)) : false;
}

/**
 * Should this alert be hidden from the recipient's Alerts tab and badge?
 * Used by every `NotificationRepository.listForUser`/`unreadCount`.
 */
export function isNotificationMuted(
  notification: Pick<AppNotification, 'kind' | 'businessId'>,
  mutes: string[] | undefined,
): boolean {
  return isCategoryMuted(mutes, categoryOfKind(notification.kind), notification.businessId);
}

/** Add or remove one toggle, returning the new list (stable order). */
export function toggleMute(
  mutes: string[] | undefined,
  category: NotificationCategory,
  businessId: string | undefined,
  muted: boolean,
): string[] {
  const key = muteKey(category, businessId);
  const rest = (mutes ?? []).filter((m) => m !== key);
  return muted ? [...rest, key] : rest;
}
