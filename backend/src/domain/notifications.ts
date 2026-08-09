/**
 * Notification mute families — the server-side twin of src/domain/notifications.ts.
 *
 * ⚠️ The category mapping below MUST stay identical to the app's copy. Mutes are
 * stored as `"<businessId>:<category>"` strings, so if the two sides disagree
 * about which family a `kind` belongs to, muting "Orders" would silence
 * something else entirely — and the user would have no way to tell why.
 *
 * Only the logic the API needs is ported. The labels, icons and descriptions in
 * the app's `NOTIFICATION_CATEGORIES` are for rendering the settings screen and
 * have no business on the server.
 *
 * Muting is enforced on READ, never on write: `notify()` still records
 * everything, so the order/call/message behind a muted alert stays fully visible
 * in the workspace. A mute hides the alert, it does not drop the work.
 */
import type { AppNotification } from '@/domain/types';

export type NotificationCategory =
  | 'orders'
  | 'chats'
  | 'calls'
  | 'bookings'
  | 'billing'
  | 'members'
  | 'reviews'
  | 'stall';

/** Which family an alert belongs to. Keep in lockstep with the app's copy. */
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

/** Should this alert be hidden from the recipient's Alerts tab and badge? */
export function isNotificationMuted(
  notification: Pick<AppNotification, 'kind' | 'businessId'>,
  mutes: string[] | undefined,
): boolean {
  return isCategoryMuted(mutes, categoryOfKind(notification.kind), notification.businessId);
}
