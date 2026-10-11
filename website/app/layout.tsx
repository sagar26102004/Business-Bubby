import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import Link from 'next/link';
import { CONTACT_EMAIL, LEGAL, PLAY_STORE_URL, SITE_NAME, SITE_TAGLINE, siteUrl } from '@/lib/site';
import './globals.css';

const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${SITE_NAME} — ${SITE_TAGLINE}`, template: `%s · ${SITE_NAME}` },
  description:
    'Find cafés, shops, services and rentals near you — menus, prices, photos and reviews. Every business on One Place gets its own free website.',
  applicationName: SITE_NAME,
  openGraph: { siteName: SITE_NAME, type: 'website', locale: 'en_IN' },
  other: { 'google-play-app': 'app-id=in.oneplace.app' },
};

export const viewport: Viewport = {
  themeColor: '#2D5A43',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <header className="site-header">
          <div className="wrap">
            <Link href="/" className="brand" aria-label={SITE_NAME}>
              <img src="/logo.png" alt="" width={32} height={32} />
              <span className="brand-name">{SITE_NAME}</span>
            </Link>
            <nav className="top-nav">
              <Link href="/explore">Explore</Link>
              <Link href="/deals">Deals</Link>
              <Link href="/search" className="nav-search">
                Search
              </Link>
              <a className="btn btn-primary btn-sm" href={PLAY_STORE_URL}>
                Get the app
              </a>
            </nav>
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <div className="wrap">
            <span>
              © {new Date().getFullYear()} {SITE_NAME} · <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </span>
            <nav>
              <Link href="/explore">Explore</Link>
              <Link href="/deals">Deals</Link>
              <Link href="/list-your-business">List your business</Link>
              <a href={LEGAL.privacy}>Privacy</a>
              <a href={LEGAL.terms}>Terms</a>
              <a href={LEGAL.support}>Support</a>
              <a href={LEGAL.deleteAccount}>Delete account</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
