/**
 * Counting offer views — what the workspace Offers screen reads back as
 * "184 views · 12 today".
 *
 * One view per offer per app session: scrolling past the same deal ten times,
 * or reopening the same business page, is one person seeing it once. The owner
 * looking at their own offers isn't a view at all.
 */
import type { BusinessRepository } from '@/data/repositories';

const counted = new Set<string>();

export function countOfferView(
  businesses: BusinessRepository,
  businessId: string,
  offerId: string,
  viewerId?: string,
  ownerId?: string,
): void {
  if (viewerId && viewerId === ownerId) return;
  const key = `${businessId}:${offerId}`;
  if (counted.has(key)) return;
  counted.add(key);
  void businesses.recordOfferView(businessId, offerId);
}
