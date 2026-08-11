/**
 * The fallback look for an ad with no creative of its own.
 *
 * An offer without a photo or a video still has to fill a card, so it gets its
 * business's listing-type gradient with the emoji watermarked over it. Shared
 * between the Home carousel and the /deals feed so the same shop never renders
 * teal in one place and amber in the other.
 */
import type { ListingType } from '@/domain/types';

export const AD_GRADIENTS: Record<ListingType, [string, string]> = {
  service: ['#3B82F6', '#1E40AF'],
  shop: ['#14B8A6', '#0F766E'],
  item: ['#F59E0B', '#B45309'],
  rental: ['#0EA5E9', '#0369A1'],
};
