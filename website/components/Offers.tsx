import { priceLabel } from '@/lib/catalog';
import { CARD_WIDTH, sized } from '@/lib/media';
import { endsLabel } from '@/lib/offers';
import type { Offer } from '@/lib/types';
import { DealVideo } from './DealVideo';

export function Offers({ offers }: { offers: Offer[] }) {
  if (!offers.length) return null;
  return (
    <section className="block" id="offers">
      <h2>
        🔥 Offers <small>{offers.length}</small>
      </h2>
      <div className="offers">
        {offers.map((o) => {
          const image = o.imageUrl ? sized(o.imageUrl, CARD_WIDTH) : undefined;
          const lines = (o.lines ?? []).map((l) =>
            (l.quantity ?? 1) > 1 ? `${l.quantity} × ${l.name}` : l.name,
          );
          return (
            <div key={o.id} className="card offer">
              {o.videoUrl ? (
                <DealVideo src={o.videoUrl} poster={image} />
              ) : image ? (
                <img src={image} alt="" loading="lazy" />
              ) : (
                <div className="offer-emoji">{o.emoji ?? '🎁'}</div>
              )}
              <div className="offer-body">
                {o.tag && <span className="chip chip-sticker">{o.tag}</span>}
                <b>{o.title}</b>
                {o.description && <div className="item-desc">{o.description}</div>}
                {lines.length > 0 && <div className="item-desc">{lines.join(' + ')}</div>}
                {(o.price || o.wasPrice) && (
                  <div className="item-price">
                    {priceLabel(o.price)}
                    {o.wasPrice && <s className="muted">{priceLabel(o.wasPrice)}</s>}
                  </div>
                )}
                {o.endsAt && <span className="deal-ends">{endsLabel(o.endsAt)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
