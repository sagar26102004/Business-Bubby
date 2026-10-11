import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/PrintButton';
import { catalogBuckets, priceLabel } from '@/lib/catalog';
import { findBySlug, getBusiness } from '@/lib/data';
import { SITE_NAME } from '@/lib/site';

export const revalidate = 600;

export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  const entry = await findBySlug(slug);
  const business = entry ? await getBusiness(entry.id) : undefined;
  return entry && business ? { entry, business } : undefined;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) return { title: 'Not found', robots: { index: false } };
  return {
    title: `${data.business.name} — menu & prices`,
    // Same content as the business page; send search engines there.
    alternates: { canonical: `/${data.entry.slug}` },
  };
}

/**
 * The whole catalog on one flat page, every section open — made to be printed,
 * saved as a PDF, or shown on a counter tablet.
 */
export default async function MenuPage({ params }: Props) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { entry, business: b } = data;
  const buckets = catalogBuckets(b);

  return (
    <main className="wrap page printable">
      <div className="no-print print-bar">
        <Link href={`/${entry.slug}`}>‹ Back to {b.name}</Link>
        <PrintButton />
      </div>

      <header className="print-head">
        <h1>{b.name}</h1>
        <div className="muted">
          {[b.providerType, b.location?.city].filter(Boolean).join(' · ')}
        </div>
      </header>

      {buckets.length === 0 && <p className="muted">Nothing listed yet.</p>}

      {buckets.map((bucket) => (
        <section key={bucket.bucket} className="print-bucket">
          {buckets.length > 1 && <h2>{bucket.title}</h2>}
          {bucket.sections.map((section) => (
            <div key={section.title} className="print-section">
              <h3>{section.title}</h3>
              {section.folders.map((folder) => (
                <div key={folder.path || '_root'}>
                  {folder.path && <div className="folder-title">{folder.path}</div>}
                  {folder.items.map((item, i) => (
                    <div key={`${item.name}-${i}`} className="print-row">
                      <span className="print-name">
                        {item.isVeg !== undefined && (
                          <span className={`veg ${item.isVeg ? 'veg-yes' : 'veg-no'}`} />
                        )}
                        {item.name}
                        {item.detail && <span className="muted"> · {item.detail}</span>}
                      </span>
                      <span className="print-dots" />
                      <span className="print-price">
                        {priceLabel(item.price) ?? ''}
                        {item.badge ? ` ${item.badge}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}

      <footer className="print-foot muted">
        Order, chat or call {b.name} free on the {SITE_NAME} app.
      </footer>
    </main>
  );
}
