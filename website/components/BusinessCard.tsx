import Link from 'next/link';
import type { DirectoryEntry } from '@/lib/data';
import { CARD_WIDTH, sized } from '@/lib/media';

/** A tile in a grid of businesses. The whole card is one link. */
export function BusinessCard({ entry }: { entry: DirectoryEntry }) {
  const sub = [entry.providerType ?? entry.tags[0], entry.city].filter(Boolean).join(' · ');
  return (
    <Link href={`/${entry.slug}`} className="card biz-card">
      {entry.coverImageUrl ? (
        <img className="cover" src={sized(entry.coverImageUrl, CARD_WIDTH)} alt="" loading="lazy" />
      ) : (
        <div className="cover cover-empty">🏪</div>
      )}
      <div className="body">
        <b>{entry.name}</b>
        {sub && <span className="muted">{sub}</span>}
      </div>
    </Link>
  );
}
