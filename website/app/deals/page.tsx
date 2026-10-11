import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { DealCard } from '@/components/DealCard';
import { dealCities, dealsInCity, hasRealDeals, listDeals, type Deal } from '@/lib/deals';
import { INTENT_CATEGORIES, intentMatches } from '@/lib/intents';
import { PLAY_STORE_URL, SITE_NAME, siteUrl } from '@/lib/site';

/**
 * DEALS — the web twin of the app's Deals feed (`src/app/deals.tsx`): every
 * live offer, filtered by the same controls where a web page can honour them.
 *
 *   CITY      — stands in for the app's distance range (no GPS on a web page).
 *   CATEGORY  — the same INTENT_CATEGORIES as everywhere else.
 *   REELS     — offers with a video; offered only when one is in view.
 *   ENDING    — offers with an end date, soonest first; offered only when one
 *               exists. A filter that always empties the page is worse than none.
 *
 * Every filter is a plain link (?city=&category=&video=1&sort=ending), so the
 * page works with JavaScript off and each view can be shared.
 */

type Params = { city?: string; category?: string; video?: string; sort?: string };
type Props = { searchParams: Promise<Params> };

async function load(params: Params) {
  const all = await listDeals();
  const cities = dealCities(all);
  const city = cities.find((c) => c.slug === params.city);
  const inCity = city ? dealsInCity(all, city.slug) : all;

  const reels = params.video === '1';
  const ending = params.sort === 'ending';
  const pool = reels ? inCity.filter((d) => d.offer.videoUrl) : inCity;

  // Only categories that actually have a deal here — no dead chips.
  const categories = INTENT_CATEGORIES.filter((c) => pool.some((d) => intentMatches(d.entry, c)));
  const category = categories.find((c) => c.id === params.category);

  let shown: Deal[] = category ? pool.filter((d) => intentMatches(d.entry, category)) : pool;
  if (ending) {
    shown = shown
      .filter((d) => d.offer.endsAt)
      .sort((a, b) => a.offer.endsAt!.localeCompare(b.offer.endsAt!));
  }

  return {
    all,
    cities,
    city,
    categories,
    category,
    reels,
    ending,
    shown,
    hasReels: inCity.some((d) => d.offer.videoUrl),
    hasEnding: inCity.some((d) => d.offer.endsAt),
  };
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  const { all, city, category } = await load(params);
  const where = city ? ` in ${city.name}` : ' near you';
  const what = category ? `${category.label} deals` : 'Deals';
  return {
    title: `${what}${where}`,
    description: `Offers, combos and reels from local businesses${city ? ` in ${city.name}` : ''} — live on ${SITE_NAME}.`,
    alternates: { canonical: '/deals' },
    // Filtered views are permutations of one page; and until a real business
    // posts a deal, the feed is all demo samples — keep both out of the index.
    robots:
      hasRealDeals(all) && !city && !category && !params.video && !params.sort
        ? undefined
        : { index: false, follow: true },
  };
}

export default async function DealsPage({ searchParams }: Props) {
  const params = await searchParams;
  const { all, cities, city, categories, category, reels, ending, shown, hasReels, hasEnding } = await load(params);

  /** This view with some filters changed — every chip is a link. */
  const href = (change: Partial<Params>) => {
    const next: Params = {
      city: city?.slug,
      category: category?.id,
      video: reels ? '1' : undefined,
      sort: ending ? 'ending' : undefined,
      ...change,
    };
    const qs = new URLSearchParams(
      Object.entries(next).filter((e): e is [string, string] => !!e[1]),
    ).toString();
    return qs ? `/deals?${qs}` : '/deals';
  };

  return (
    <main className="wrap page">
      <Breadcrumbs base={siteUrl()} trail={[{ label: 'Home', href: '/' }, { label: 'Deals' }]} />
      <h1>
        🔥 {category ? `${category.label} deals` : 'Deals'} {city ? `in ${city.name}` : 'near you'}
      </h1>
      <p className="muted lead">
        {shown.length} live offer{shown.length === 1 ? '' : 's'} — tap one to see the business.
      </p>

      {cities.length > 1 && (
        <div className="chips chip-row">
          <Link className={`chip chip-link${city ? '' : ' chip-active'}`} href={href({ city: undefined })}>
            📍 All cities
          </Link>
          {cities.map((c) => (
            <Link
              key={c.slug}
              className={`chip chip-link${city?.slug === c.slug ? ' chip-active' : ''}`}
              href={href({ city: c.slug, category: undefined })}
            >
              {c.name} <span className="muted">{c.count}</span>
            </Link>
          ))}
        </div>
      )}

      {(categories.length > 1 || hasReels || hasEnding) && (
        <div className="chips chip-row chip-scroll">
          {categories.length > 1 && (
            <>
              <Link
                className={`chip chip-link${category ? '' : ' chip-active'}`}
                href={href({ category: undefined })}
              >
                All
              </Link>
              {categories.map((c) => (
                <Link
                  key={c.id}
                  className={`chip chip-link${category?.id === c.id ? ' chip-active' : ''}`}
                  href={href({ category: c.id })}
                >
                  {c.icon} {c.label}
                </Link>
              ))}
            </>
          )}
          {hasReels && (
            <Link
              className={`chip chip-link${reels ? ' chip-active' : ''}`}
              href={href({ video: reels ? undefined : '1', category: undefined })}
            >
              ▶ Reels only
            </Link>
          )}
          {hasEnding && (
            <Link
              className={`chip chip-link${ending ? ' chip-active' : ''}`}
              href={href({ sort: ending ? undefined : 'ending' })}
            >
              ⏳ Ending soon
            </Link>
          )}
        </div>
      )}

      {shown.length > 0 ? (
        <div className="deal-grid">
          {shown.map((d) => (
            <DealCard key={d.offer.id} deal={d} />
          ))}
        </div>
      ) : (
        <div className="card empty">
          <b>{all.length ? 'Nothing matches these filters.' : 'No live deals right now.'}</b>
          <p className="muted">
            {all.length ? (
              <Link href="/deals">See every deal ›</Link>
            ) : (
              'Businesses post offers from the One Place app — check back soon.'
            )}
          </p>
        </div>
      )}

      <div className="cta-band">
        <div>
          <h2>Run a business? Post your own deal.</h2>
          <p>Offers and reels you post in the {SITE_NAME} app show up here and on your free website.</p>
        </div>
        <a className="btn btn-outline" href={PLAY_STORE_URL}>
          Get the app
        </a>
      </div>
    </main>
  );
}

