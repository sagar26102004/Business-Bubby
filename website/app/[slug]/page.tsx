import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { Catalog } from '@/components/Catalog';
import { Offers } from '@/components/Offers';
import { liveOffers } from '@/lib/offers';
import { OpenNow } from '@/components/OpenNow';
import { ShareButton } from '@/components/ShareButton';
import { catalogBuckets } from '@/lib/catalog';
import { findBySlug, getBusiness, getReviews, isIndexable, type DirectoryEntry, type ReviewSummary } from '@/lib/data';
import { cities, cityOf, realEntries } from '@/lib/directory';
import { INTENT_CATEGORIES, intentMatches } from '@/lib/intents';
import { DAY_LABELS_FULL, formatDayHours, hasUsableHours, openingHoursSpec } from '@/lib/hours';
import { IMAGE_WIDTH, THUMB_WIDTH, sized } from '@/lib/media';
import { PLAY_STORE_URL, SITE_NAME, appIntentUrl, siteUrl } from '@/lib/site';
import type { Business } from '@/lib/types';

/** Pages are built on first visit and refreshed in the background every 10 min. */
export const revalidate = 600;

export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  const entry = await findBySlug(slug);
  if (!entry) return undefined;
  const [business, reviews] = await Promise.all([getBusiness(entry.id), getReviews(entry.id)]);
  if (!business) return undefined;
  return { entry, business, reviews };
}

/** Home › Indore › Food › <name> — only links to directory pages that exist. */
async function trailFor(entry: DirectoryEntry) {
  const trail: { label: string; href?: string }[] = [{ label: 'Home', href: '/' }];
  const citySlug = cityOf(entry);
  const city = citySlug ? cities(await realEntries()).find((c) => c.slug === citySlug) : undefined;
  if (city) {
    trail.push({ label: city.name, href: `/in/${city.slug}` });
    const intent = INTENT_CATEGORIES.find((i) => intentMatches(entry, i));
    if (intent) trail.push({ label: intent.label, href: `/in/${city.slug}/${intent.id}` });
  }
  trail.push({ label: entry.name });
  return trail;
}

/** Exact spot hidden for home businesses and anyone who asked — city only. */
function preciseLocation(b: Business) {
  const loc = b.location;
  if (!loc || loc.isHome || loc.hidePreciseLocation) return undefined;
  return loc;
}

function subtitle(b: Business): string {
  return [b.providerType ?? b.tags?.[0], b.location?.city].filter(Boolean).join(' · ');
}

function describe(b: Business, reviews: ReviewSummary): string {
  const parts = [
    b.tagline ?? b.description?.split('\n')[0],
    subtitle(b),
    reviews.avg ? `Rated ${reviews.avg.toFixed(1)}★ by ${reviews.count} customers` : undefined,
  ].filter(Boolean);
  return (parts.join(' — ') || `${b.name} on ${SITE_NAME}`).slice(0, 300);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) return { title: 'Not found', robots: { index: false } };
  const { entry, business, reviews } = data;
  const title = business.location?.city ? `${business.name}, ${business.location.city}` : business.name;
  const image = sized(business.coverImageUrl, IMAGE_WIDTH);
  return {
    title,
    description: describe(business, reviews),
    alternates: { canonical: `/${entry.slug}` },
    robots: isIndexable(business) ? undefined : { index: false, follow: true },
    openGraph: {
      title,
      description: describe(business, reviews),
      url: `/${entry.slug}`,
      images: image ? [{ url: image }] : undefined,
    },
    twitter: { card: image ? 'summary_large_image' : 'summary' },
  };
}

function Stars({ value }: { value: number }) {
  return (
    <span className="rating">
      <span className="star">★</span> {value.toFixed(1)}
    </span>
  );
}

export default async function BusinessPage({ params }: Props) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { entry, business: b, reviews } = data;

  const buckets = catalogBuckets(b);
  const precise = preciseLocation(b);
  const point = precise?.point;
  const address = precise
    ? [precise.addressLine, precise.city, precise.region].filter(Boolean).join(', ')
    : [b.location?.city, b.location?.region].filter(Boolean).join(', ');
  const directions = point
    ? `https://www.google.com/maps/dir/?api=1&destination=${point.latitude},${point.longitude}`
    : undefined;
  const photos = (b.portfolio ?? []).filter((p) => p.kind === 'photo');
  const videos = (b.portfolio ?? []).filter((p) => p.kind === 'video');
  const appLink = appIntentUrl(b.id);
  const offers = liveOffers(b);
  const trail = await trailFor(entry);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': buckets.some((x) => x.bucket === 'menu') ? 'Restaurant' : 'LocalBusiness',
    name: b.name,
    description: b.description ?? b.tagline,
    url: `${siteUrl()}/${entry.slug}`,
    image: sized(b.coverImageUrl, IMAGE_WIDTH),
    address: {
      '@type': 'PostalAddress',
      streetAddress: precise?.addressLine,
      addressLocality: b.location?.city,
      addressRegion: b.location?.region,
      addressCountry: b.location?.country ?? 'IN',
    },
    geo: point ? { '@type': 'GeoCoordinates', latitude: point.latitude, longitude: point.longitude } : undefined,
    openingHoursSpecification: openingHoursSpec(b.openingHours),
    aggregateRating: reviews.count
      ? { '@type': 'AggregateRating', ratingValue: reviews.avg!.toFixed(1), reviewCount: reviews.count }
      : undefined,
  };

  return (
    <main className="has-mobile-bar">
      {isIndexable(b) && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
      )}

      {b.coverImageUrl && (
        <div className="biz-hero">
          <img src={sized(b.coverImageUrl, IMAGE_WIDTH)} alt={b.name} fetchPriority="high" />
        </div>
      )}

      <div className="wrap">
        <div className="biz-head">
          <Breadcrumbs base={siteUrl()} trail={trail} />
          <h1>{b.name}</h1>
          {subtitle(b) && <div className="sub">{subtitle(b)}</div>}
          <div className="meta-row">
            {reviews.avg !== undefined && (
              <span>
                <Stars value={reviews.avg} />{' '}
                <span className="muted">
                  ({reviews.count} review{reviews.count === 1 ? '' : 's'})
                </span>
              </span>
            )}
            <OpenNow hours={b.openingHours} fallback={b.openNow} />
            {b.priceLabel && <span className="muted">{b.priceLabel}</span>}
          </div>
          {b.tagline && <p className="muted" style={{ margin: '10px 0 0' }}>{b.tagline}</p>}
          <div className="actions">
            <a className="btn btn-cta" href={appLink}>
              Order / chat in app
            </a>
            {directions && (
              <a className="btn btn-outline" href={directions} target="_blank" rel="noopener">
                📍 Directions
              </a>
            )}
            {buckets.length > 0 && (
              <Link className="btn btn-outline" href={`/${entry.slug}/menu`}>
                🖨️ {buckets[0].bucket === 'menu' ? 'Printable menu' : 'Price list'}
              </Link>
            )}
            <ShareButton title={b.name} />
          </div>
        </div>

        <div className="layout">
          <div>
            {b.description && (
              <section className="block">
                <h2>About</h2>
                <p className="about">{b.description}</p>
                {b.tags && b.tags.length > 0 && (
                  <div className="chips">
                    {b.tags.map((t) => (
                      <span key={t} className="chip">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            )}

            <Offers offers={offers} />

            {buckets.map((bucket) => (
              <Catalog key={bucket.bucket} bucket={bucket} />
            ))}

            {(photos.length > 0 || videos.length > 0 || (b.showcaseLinks?.length ?? 0) > 0) && (
              <section className="block" id="showcase">
                <h2>📸 Photos & work</h2>
                {(photos.length > 0 || videos.length > 0) && (
                  <div className="gallery">
                    {photos.map((p) => (
                      <a key={p.id} href={sized(p.url, IMAGE_WIDTH)} target="_blank" rel="noopener">
                        <img src={sized(p.url, THUMB_WIDTH)} alt={p.title ?? ''} loading="lazy" />
                      </a>
                    ))}
                    {videos.map((v) => (
                      <a key={v.id} href={v.url} target="_blank" rel="noopener" className="card" title="Play video">
                        {v.thumbnailUrl ? (
                          <img src={sized(v.thumbnailUrl, THUMB_WIDTH)} alt="Video" loading="lazy" />
                        ) : (
                          <span className="cover-empty" style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 32 }}>
                            ▶
                          </span>
                        )}
                      </a>
                    ))}
                  </div>
                )}
                {(b.showcaseLinks?.length ?? 0) > 0 && (
                  <div className="chips" style={{ marginTop: 12 }}>
                    {b.showcaseLinks!.map((l) => (
                      <a key={l.id} className="chip" href={l.url} target="_blank" rel="noopener nofollow">
                        {l.kind === 'website' ? 'Website' : l.kind[0].toUpperCase() + l.kind.slice(1)} ↗
                      </a>
                    ))}
                  </div>
                )}
              </section>
            )}

            <section className="block" id="reviews">
              <h2>
                ⭐ Reviews {reviews.count > 0 && <small>{reviews.count}</small>}
              </h2>
              {reviews.latest.length === 0 ? (
                <p className="muted">
                  {reviews.count > 0
                    ? `Rated ${reviews.avg!.toFixed(1)} out of 5 by ${reviews.count} customers.`
                    : 'No reviews yet.'}{' '}
                  Rate {b.name} in the {SITE_NAME} app.
                </p>
              ) : (
                reviews.latest.map((r) => (
                  <div key={r.id} className="card review">
                    <div className="review-top">
                      <b>{r.customerName}</b>
                      <span className="rating">
                        <span className="star">{'★'.repeat(Math.round(r.rating))}</span>
                      </span>
                    </div>
                    <p style={{ margin: '6px 0 0' }}>{r.comment}</p>
                  </div>
                ))
              )}
            </section>
          </div>

          <aside className="aside">
            <div className="card info app-box">
              <h3>Order, chat or call — free</h3>
              <p>
                Place an order, chat or make a free in-app call to {b.name} with the {SITE_NAME} app.
              </p>
              <a className="btn btn-outline" href={appLink}>
                Open in {SITE_NAME}
              </a>
            </div>

            {(address || point) && (
              <div className="card info">
                <h3>📍 Location</h3>
                <div>{address}</div>
                {!precise && <div className="muted" style={{ fontSize: 14 }}>Exact address shared in the app.</div>}
                {point && (
                  <iframe
                    className="map"
                    title={`Map of ${b.name}`}
                    loading="lazy"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${point.longitude - 0.006},${point.latitude - 0.004},${point.longitude + 0.006},${point.latitude + 0.004}&layer=mapnik&marker=${point.latitude},${point.longitude}`}
                  />
                )}
              </div>
            )}

            {hasUsableHours(b.openingHours) ? (
              <div className="card info">
                <h3>🕒 Opening hours</h3>
                <table className="hours">
                  <tbody>
                    {DAY_LABELS_FULL.map((day, i) => (
                      <tr key={day}>
                        <td>{day}</td>
                        <td>{formatDayHours(b.openingHours!.days[i])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {b.openingHours!.note && <p className="muted" style={{ fontSize: 14 }}>{b.openingHours!.note}</p>}
              </div>
            ) : (
              b.hours && (
                <div className="card info">
                  <h3>🕒 Opening hours</h3>
                  <div>{b.hours}</div>
                </div>
              )
            )}

            {b.website && (
              <div className="card info">
                <h3>🌐 Website</h3>
                <a href={b.website} target="_blank" rel="noopener nofollow">
                  {b.website.replace(/^https?:\/\//, '')}
                </a>
              </div>
            )}
          </aside>
        </div>

      </div>

      <div className="mobile-bar">
        <a className="btn btn-cta" href={appLink}>
          Order in app
        </a>
        {directions ? (
          <a className="btn btn-outline" href={directions} target="_blank" rel="noopener">
            Directions
          </a>
        ) : (
          <a className="btn btn-outline" href={PLAY_STORE_URL}>
            Get the app
          </a>
        )}
      </div>
    </main>
  );
}
