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
  | 'stall'
  | 'ads';

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
  {
    id: 'ads',
    label: 'Ads',
    icon: '📣',
    description: 'Whether a promoted offer went live, and when a run ends.',
  },
];

/** Which family an alert belongs to. */
export function categoryOfKind(kind: AppNotification['kind']): NotificationCategory {
  switch (kind) {
    case 'chat_reply':
    case 'chat_message':
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
    case 'ad_update':
      return 'ads';
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

/**
 * Which SIDE of the app an alert belongs to.
 *
 * The Chats tab is the CUSTOMER's inbox — replies from businesses they
 * contacted, their orders and enrolments moving along, bills they were sent.
 * Alerts a person gets because they run or work at a business (a new order, a
 * customer's message, a missed call to the shop) belong to the WORKSPACE.
 *
 * Nearly every kind only ever goes one way. `order_update` is the exception:
 * it tells the customer their order moved, but also tells the owner when a
 * customer accepts or declines a proposal — so it is a business alert only
 * when it's about a business this person runs or works at.
 */
const BUSINESS_SIDE_KINDS = new Set<AppNotification['kind']>([
  'chat_message',
  'booking_requested',
  'order_requested',
  'missed_call',
  'review_posted',
  'product_question',
  'enroll_requested',
  'payment_reported',
  'ad_update',
]);

export function isBusinessAlert(
  notification: Pick<AppNotification, 'kind' | 'businessId'>,
  myBusinessIds: ReadonlySet<string>,
): boolean {
  if (BUSINESS_SIDE_KINDS.has(notification.kind)) return true;
  if (notification.kind === 'order_update') {
    return !!notification.businessId && myBusinessIds.has(notification.businessId);
  }
  return false;
}

/** A customer wrote to a business this person answers for. */
export const isBusinessChatAlert = (notification: Pick<AppNotification, 'kind'>) =>
  notification.kind === 'chat_message';
