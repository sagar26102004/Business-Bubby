import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { BusinessGrid } from '@/components/BusinessGrid';
import { cities, hasTag, inCity, inIntent, presentTags, realEntries, showcaseOrder } from '@/lib/directory';
import { getIntent } from '@/lib/intents';
import { SITE_NAME, siteUrl } from '@/lib/site';

export const revalidate = 600;

type Props = {
  params: Promise<{ city: string; category: string }>;
  searchParams: Promise<{ tag?: string }>;
};

async function load(citySlug: string, categoryId: string) {
  const intent = getIntent(categoryId);
  if (!intent) return undefined;
  const entries = await realEntries();
  const city = cities(entries).find((c) => c.slug === citySlug);
  if (!city) return undefined;
  const matching = inIntent(inCity(entries, citySlug), intent);
  if (!matching.length) return undefined;
  return { intent, city, matching };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ city: c, category }, { tag }] = await Promise.all([params, searchParams]);
  const data = await load(c, category);
  if (!data) return { title: 'Not found', robots: { index: false } };
  const { intent, city, matching } = data;
  const what = tag ?? intent.label;
  return {
    title: `${what} in ${city.name}`,
    description: `${matching.length} ${intent.label.toLowerCase()} places in ${city.name} with menus, prices, photos and reviews — on ${SITE_NAME}.`,
    // The ?tag= views are filters of this page, not pages of their own.
    alternates: { canonical: `/in/${city.slug}/${intent.id}` },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const [{ city: c, category }, { tag }] = await Promise.all([params, searchParams]);
  const data = await load(c, category);
  if (!data) notFound();
  const { intent, city, matching } = data;
  const tags = presentTags(matching, intent);
  const active = tag && tags.some((t) => t.tag === tag) ? tag : undefined;
  const shown = showcaseOrder(active ? matching.filter((e) => hasTag(e, active)) : matching);
  const base = `/in/${city.slug}/${intent.id}`;

  return (
    <main className="wrap page">
      <Breadcrumbs
        base={siteUrl()}
        trail={[
          { label: 'Home', href: '/' },
          { label: city.name, href: `/in/${city.slug}` },
          { label: intent.label },
        ]}
      />
      <h1>
        {intent.icon} {active ?? intent.label} in {city.name}
      </h1>
      <p className="muted lead">
        {shown.length} place{shown.length === 1 ? '' : 's'}
      </p>

      {tags.length > 1 && (
        <div className="chips chip-row">
          <Link className={`chip chip-link${active ? '' : ' chip-active'}`} href={base}>
            All
          </Link>
          {tags.map((t) => (
            <Link
              key={t.tag}
              className={`chip chip-link${active === t.tag ? ' chip-active' : ''}`}
              href={`${base}?tag=${encodeURIComponent(t.tag)}`}
            >
              {t.tag} <span className="muted">{t.count}</span>
            </Link>
          ))}
        </div>
      )}

      <BusinessGrid entries={shown} />
    </main>
  );
}
