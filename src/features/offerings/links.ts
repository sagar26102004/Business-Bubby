/**
 * Where each offering bucket's full catalog lives.
 *
 * The menu kept its own route — it is linked from all over the app and reads
 * better in a URL — and products, services and rentals share the generic
 * catalog route. Both render the same screen (`OfferingCatalog`), so this is
 * purely about the address.
 */
import type { OfferingBucket } from '@/domain/offerings';

export type CatalogLink =
  | { pathname: '/menu/[businessId]'; params: { businessId: string } }
  | { pathname: '/catalog/[businessId]'; params: { businessId: string; bucket: OfferingBucket } };

/** The route that shows this bucket's full catalog for this business. */
export function catalogLink(businessId: string, bucket: OfferingBucket): CatalogLink {
  return bucket === 'menu'
    ? { pathname: '/menu/[businessId]', params: { businessId } }
    : { pathname: '/catalog/[businessId]', params: { businessId, bucket } };
}
