import type { Metadata } from 'next';
import Link from 'next/link';
import { BusinessGrid } from '@/components/BusinessGrid';
import { SearchBox } from '@/components/SearchBox';
import { inIntent, intentsWithCounts, realEntries, search, showcaseOrder } from '@/lib/directory';
import { getIntent } from '@/lib/intents';

export const metadata: Metadata = {
  title: 'Search',
  // Result pages are endless permutations of the same listings — keep them out of the index.
  robots: { index: false, follow: true },
};

type Props = { searchParams: Promise<{ q?: string; category?: string }> };

/** Enough to scan; anything past this, the visitor narrows the words. */
const MAX_RESULTS = 120;

export default async function SearchPage({ searchParams }: Props) {
  const { q = '', category } = await searchParams;
  const query = q.trim().slice(0, 80);
  const intent = getIntent(category);
  const entries = await realEntries();

  let results = intent ? inIntent(entries, intent) : entries;
  results = query ? search(results, query) : intent ? showcaseOrder(results) : [];

  return (
    <main className="wrap page">
      <h1>{intent ? `${intent.icon} ${intent.label}` : 'Search'}</h1>
      <SearchBox defaultValue={query} autoFocus={!query && !intent} />

      {!query && !intent ? (
        <section className="section">
          <h2>Browse by category</h2>
          <div className="chips chip-row">
            {intentsWithCounts(entries).map(({ intent: i, count }) => (
              <Link key={i.id} className="chip chip-link" href={`/search?category=${i.id}`}>
                {i.icon} {i.label} <span className="muted">{count}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <section className="section">
          <p className="muted" style={{ marginTop: 0 }}>
            {results.length === 0
              ? `Nothing matched${query ? ` “${query}”` : ''}. Try fewer or different words.`
              : `${results.length} result${results.length === 1 ? '' : 's'}${query ? ` for “${query}”` : ''}`}
          </p>
          <BusinessGrid entries={results.slice(0, MAX_RESULTS)} />
        </section>
      )}
    </main>
  );
}
