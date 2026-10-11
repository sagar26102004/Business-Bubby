import Link from 'next/link';

/** "Home › Indore › Food" — visible trail plus schema.org data for search engines. */
export function Breadcrumbs({ trail, base }: { trail: { label: string; href?: string }[]; base: string }) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.label,
      item: t.href ? `${base}${t.href}` : undefined,
    })),
  };
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }}
      />
      {trail.map((t, i) => (
        <span key={`${t.label}-${i}`}>
          {i > 0 && <span className="sep">›</span>}
          {t.href ? <Link href={t.href}>{t.label}</Link> : <span>{t.label}</span>}
        </span>
      ))}
    </nav>
  );
}
