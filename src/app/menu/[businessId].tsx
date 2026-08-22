/**
 * The menu — one of the four offering buckets, shown by the shared catalog
 * screen (`features/offerings/OfferingCatalog`) that also shows a business's
 * products, services and rentals. This route exists because "menu" reads
 * better in a URL and the whole app already links to it.
 */
import { useLocalSearchParams } from 'expo-router';
import { OfferingCatalog } from '@/features/offerings/OfferingCatalog';

export default function MenuScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  return <OfferingCatalog businessId={businessId} bucket="menu" />;
}
