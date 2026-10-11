import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { BusinessGrid } from '@/components/BusinessGrid';
import { DealRow } from '@/components/DealCard';
import { SearchBox } from '@/components/SearchBox';
import { dealsInCity, listDeals, previewDeals } from '@/lib/deals';
import { cities, inCity, inIntent, intentsWithCounts, realEntries, showcaseOrder } from '@/lib/directory';
import { SITE_NAME, siteUrl } from '@/lib/site';

export const revalidate = 600;

export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ city: string }> };

/** How many businesses each category previews before "See all". */
const PREVIEW = 8;

async function load(citySlug: string) {
  const [entries, deals] = await Promise.all([realEntries(), listDeals()]);
  const city = cities(entries).find((c) => c.slug === citySlug);
  if (!city) return undefined;
  return { city, here: inCity(entries, citySlug), deals: dealsInCity(deals, citySlug) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: slug } = await params;
  const data = await load(slug);
  if (!data) return { title: 'Not found', robots: { index: false } };
  const { city } = data;
  return {
    title: `Local businesses in ${city.name}`,
    description: `${city.count} cafés, shops, services and rentals in ${city.name} — menus, prices, photos and reviews on ${SITE_NAME}.`,
    alternates: { canonical: `/in/${city.slug}` },
  };
}

export default async function CityPage({ params }: Props) {
  const { city: slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { city, here, deals } = data;
  const intents = intentsWithCounts(here);

  return (
    <main className="wrap page">
      <Breadcrumbs
        base={siteUrl()}
        trail={[{ label: 'Home', href: '/' }, { label: 'Explore', href: '/explore' }, { label: city.name }]}
      />
      <h1>Businesses in {city.name}</h1>
      <p className="muted lead">{city.count} places on {SITE_NAME}.</p>
      <SearchBox />

      <div className="chips chip-row">
        {intents.map(({ intent, count }) => (
          <Link key={intent.id} className="chip chip-link" href={`/in/${city.slug}/${intent.id}`}>
            {intent.icon} {intent.label} <span className="muted">{count}</span>
          </Link>
        ))}
      </div>

      {deals.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>🔥 Deals in {city.name}</h2>
            <Link href={`/deals?city=${city.slug}`}>See all {deals.length} ›</Link>
          </div>
          <DealRow deals={previewDeals(deals, 10)} />
        </section>
      )}

      {intents.map(({ intent, count }) => (
        <section key={intent.id} className="section">
          <div className="section-head">
            <h2>
              {intent.icon} {intent.label}
            </h2>
            {count > PREVIEW && <Link href={`/in/${city.slug}/${intent.id}`}>See all {count} ›</Link>}
          </div>
          <BusinessGrid entries={showcaseOrder(inIntent(here, intent)).slice(0, PREVIEW)} />
        </section>
      ))}
    </main>
  );
}
