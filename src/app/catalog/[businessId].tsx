/**
 * A business's products, services or rentals in full — the same screen the
 * menu gets (`features/offerings/OfferingCatalog`), because all four lists are
 * the same kind of thing and a customer should only have to learn one way of
 * reading one.
 *
 * Which list is the `bucket` param; an unknown one falls back to the menu.
 */
import { useLocalSearchParams } from 'expo-router';
import { isOfferingBucket } from '@/domain/offerings';
import { OfferingCatalog } from '@/features/offerings/OfferingCatalog';

export default function CatalogScreen() {
  const { businessId, bucket } = useLocalSearchParams<{ businessId: string; bucket?: string }>();
  return (
    <OfferingCatalog businessId={businessId} bucket={isOfferingBucket(bucket) ? bucket : 'menu'} />
  );
}
