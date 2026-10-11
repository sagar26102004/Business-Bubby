import type { MetadataRoute } from 'next';
import { hasRealDeals, listDeals } from '@/lib/deals';
import { cities, inCity, intentsWithCounts, realEntries } from '@/lib/directory';
import { siteUrl } from '@/lib/site';

export const revalidate = 3600;

/**
 * Every real business page (demo samples left out), every city page and every
 * city × category page that has listings, plus the static pages. Search
 * results and `?tag=` filters are deliberately absent — they're views, not pages.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const [entries, deals] = await Promise.all([realEntries(), listDeals()]);
  const directory = cities(entries).flatMap((c) => [
    { url: `${base}/in/${c.slug}`, changeFrequency: 'daily' as const, priority: 0.9 },
    ...intentsWithCounts(inCity(entries, c.slug)).map(({ intent }) => ({
      url: `${base}/in/${c.slug}/${intent.id}`,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
  ]);
  return [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/explore`, changeFrequency: 'daily', priority: 0.9 },
    // Listed once a real business has a deal — until then it's demo samples (noindex).
    ...(hasRealDeals(deals) ? [{ url: `${base}/deals`, changeFrequency: 'daily' as const, priority: 0.8 }] : []),
    { url: `${base}/list-your-business`, changeFrequency: 'monthly', priority: 0.6 },
    ...directory,
    ...entries.map((e) => ({
      url: `${base}/${e.slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ];
}
