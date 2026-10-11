import Link from 'next/link';
import { BusinessCard } from '@/components/BusinessCard';
import { DealRow } from '@/components/DealCard';
import { SearchBox } from '@/components/SearchBox';
import { listDeals, previewDeals } from '@/lib/deals';
import { cities as cityList, inCity, intentsWithCounts, realEntries } from '@/lib/directory';
import { PLAY_STORE_URL, SITE_NAME } from '@/lib/site';

export const revalidate = 600;

export default async function Home() {
  const [real, deals] = await Promise.all([realEntries(), listDeals()]);
  // Newest real listings with a photo first — the directory's shop window.
  const featured = [...real]
    .filter((e) => e.coverImageUrl)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12);
  const topCities = cityList(real);
  const cities = topCities.map((c) => c.name);
  // Categories link into the biggest city's pages; elsewhere, to search.
  const home = topCities[0];
  const intents = intentsWithCounts(home ? inCity(real, home.slug) : real);

  return (
    <main>
      <section className="hero">
        <div className="wrap">
          <span className="chip">📍 {cities.length ? cities.slice(0, 4).join(' · ') : 'Near you'}</span>
          <h1 style={{ marginTop: 14 }}>Every local business, in one place.</h1>
          <p>
            Menus, prices, photos and reviews for the cafés, shops, services and rentals around you.
            Order, chat and call them for free in the {SITE_NAME} app.
          </p>
          <div style={{ marginTop: 20, maxWidth: 560 }}>
            <SearchBox />
          </div>
          <div className="hero-actions">
            <a className="btn btn-cta" href={PLAY_STORE_URL}>
              Get it on Google Play
            </a>
            <Link className="btn btn-outline" href="/list-your-business">
              List your business — free
            </Link>
          </div>
        </div>
      </section>

      {deals.length > 0 && (
        <section className="section">
          <div className="wrap">
            <div className="section-head">
              <h2>🔥 Deals near you</h2>
              <Link href="/deals">See all {deals.length} ›</Link>
            </div>
            <DealRow deals={previewDeals(deals, 10)} />
          </div>
        </section>
      )}

      {intents.length > 0 && (
        <section className="section">
          <div className="wrap">
            <div className="section-head">
              <h2>{home ? `Browse ${home.name}` : 'Browse'}</h2>
              <Link href="/explore">All cities ›</Link>
            </div>
            <div className="tiles">
              {intents.map(({ intent, count }) => (
                <Link
                  key={intent.id}
                  href={home ? `/in/${home.slug}/${intent.id}` : `/search?category=${intent.id}`}
                  className="card tile"
                >
                  <span className="tile-icon">{intent.icon}</span>
                  <b>{intent.label}</b>
                  <span className="muted">{count}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {featured.length > 0 && (
        <section className="section">
          <div className="wrap">
            <h2>On {SITE_NAME}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {real.length} businesses and counting — every one with its own page.
            </p>
            <div className="grid">
              {featured.map((e) => (
                <BusinessCard key={e.id} entry={e} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="wrap">
          <h2>What you can do</h2>
          <div className="features">
            {[
              ['🍽️', 'See the full menu', 'Every dish, product, service and price — before you go.'],
              ['🛒', 'Order ahead', 'Send an order or a request; the business confirms it in the app.'],
              ['💬', 'Chat & call free', 'Message or call a business over the internet. No number swapping.'],
              ['⭐', 'Real reviews', 'Ratings from people who actually went.'],
            ].map(([icon, title, text]) => (
              <div key={title} className="card feature">
                <span className="icon">{icon}</span>
                <b>{title}</b>
                <span className="muted">{text}</span>
              </div>
            ))}
          </div>

          <div className="cta-band">
            <div>
              <h2>Run a business? Get a free website.</h2>
              <p>List on {SITE_NAME} and your page goes live on the web too — menu, photos, reviews, map.</p>
            </div>
            <Link className="btn btn-outline" href="/list-your-business">
              See how
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
