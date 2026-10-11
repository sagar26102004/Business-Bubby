import Link from 'next/link';
import { priceLabel } from '@/lib/catalog';
import type { Deal } from '@/lib/deals';
import { CARD_WIDTH, sized } from '@/lib/media';
import { endsLabel } from '@/lib/offers';
import { DealVideo } from './DealVideo';

/**
 * One deal, poster-shaped like the app's deal cards: the offer's photo or reel
 * with its shout tag on top, then what it is, the price, and whose it is. The
 * whole card opens the business page at its Offers section.
 */
export function DealCard({ deal }: { deal: Deal }) {
  const { offer, entry } = deal;
  const poster = sized(offer.imageUrl, CARD_WIDTH);
  return (
    <Link href={`/${entry.slug}#offers`} className="card deal-card">
      <div className="deal-media">
        {offer.videoUrl ? (
          <DealVideo src={offer.videoUrl} poster={poster} />
        ) : poster ? (
          <img src={poster} alt="" loading="lazy" />
        ) : (
          <div className="deal-emoji">{offer.emoji ?? '🎁'}</div>
        )}
        {offer.tag && <span className="deal-tag">{offer.tag}</span>}
        {offer.videoUrl && <span className="deal-reel">▶ Reel</span>}
      </div>
      <div className="body">
        <b>{offer.title}</b>
        {(offer.price || offer.wasPrice) && (
          <div className="item-price">
            {priceLabel(offer.price)}
            {offer.wasPrice && <s className="muted">{priceLabel(offer.wasPrice)}</s>}
          </div>
        )}
        <span className="muted deal-biz">
          {entry.name}
          {entry.city ? ` · ${entry.city}` : ''}
        </span>
        {offer.endsAt && <span className="deal-ends">{endsLabel(offer.endsAt)}</span>}
      </div>
    </Link>
  );
}

/** A horizontal strip of deals — the Home and city-page preview. */
export function DealRow({ deals }: { deals: Deal[] }) {
  return (
    <div className="deal-row">
      {deals.map((d) => (
        <DealCard key={d.offer.id} deal={d} />
      ))}
    </div>
  );
}
