import type { Metadata } from 'next';
import Link from 'next/link';
import { SearchBox } from '@/components/SearchBox';
import { cities, intentsWithCounts, realEntries } from '@/lib/directory';
import { SITE_NAME } from '@/lib/site';

export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Explore local businesses',
  description: `Browse every business on ${SITE_NAME} by city and category — food, groceries, health, beauty, home services, rentals and more.`,
  alternates: { canonical: '/explore' },
};

export default async function Explore() {
  const entries = await realEntries();
  const cityList = cities(entries);
  const intents = intentsWithCounts(entries);

  return (
    <main className="wrap page">
      <h1>Explore</h1>
      <p className="muted lead">{entries.length} businesses on {SITE_NAME}.</p>
      <SearchBox />

      <section className="section">
        <h2>Cities</h2>
        <div className="tiles">
          {cityList.map((c) => (
            <Link key={c.slug} href={`/in/${c.slug}`} className="card tile">
              <span className="tile-icon">📍</span>
              <b>{c.name}</b>
              <span className="muted">{c.count} businesses</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Categories</h2>
        <p className="muted" style={{ margin: 0 }}>
          Across every city — pick a city above to narrow it down.
        </p>
        <div className="tiles">
          {intents.map(({ intent, count }) => (
            <Link key={intent.id} href={`/search?category=${intent.id}`} className="card tile">
              <span className="tile-icon">{intent.icon}</span>
              <b>{intent.label}</b>
              <span className="muted">{count}</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
