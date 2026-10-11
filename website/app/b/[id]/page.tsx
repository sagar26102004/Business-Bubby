import { notFound, permanentRedirect } from 'next/navigation';
import { findById } from '@/lib/data';

/**
 * `/b/<business id>` → the business's readable page. The app knows ids, not
 * slugs, so this is the link a "Share my website" button can always build.
 */
export default async function ById({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = await findById(id);
  if (!entry) notFound();
  permanentRedirect(`/${entry.slug}`);
}
