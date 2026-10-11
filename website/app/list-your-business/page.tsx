import type { Metadata } from 'next';
import { CONTACT_EMAIL, PLAY_STORE_URL, SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: 'List your business — get a free website',
  description: `List your shop, café, service or rental on ${SITE_NAME} for free. Your listing becomes a website customers can open without installing anything.`,
};

const STEPS = [
  ['1', 'Install the app', `Get ${SITE_NAME} from Google Play and sign up — it takes a minute.`],
  ['2', 'List your business', 'Name, location, hours, photos — then your menu, products, services or rentals. Paste a whole list at once if you have one.'],
  ['3', 'Share your website', 'Your page is live on the web straight away. Put the link on WhatsApp, Instagram, Google Maps and your visiting card.'],
];

const PERKS = [
  ['🌐', 'Your own web page', 'Found on Google, opens in any browser — no app needed to look.'],
  ['🧾', 'Menu & price list online', 'Update it in the app; the website follows within minutes.'],
  ['🛒', 'Orders & requests', 'Customers order, request or enroll; you accept in your workspace.'],
  ['💬', 'Free chat & calls', 'Customers reach you in-app without seeing your phone number.'],
  ['⭐', 'Reviews', 'Ratings build trust and show on your page and in search results.'],
  ['👥', 'Your team', 'Add managers and staff, route chats and calls to them.'],
];

export default function ListYourBusiness() {
  return (
    <main>
      <section className="hero">
        <div className="wrap">
          <span className="chip">Free for every business</span>
          <h1 style={{ marginTop: 14 }}>Your business, online in minutes.</h1>
          <p>
            Every business listed on {SITE_NAME} gets its own website — a page customers can open,
            share and find on Google, without downloading anything.
          </p>
          <div className="hero-actions">
            <a className="btn btn-cta" href={PLAY_STORE_URL}>
              Get the app & list free
            </a>
            <a className="btn btn-outline" href={`mailto:${CONTACT_EMAIL}?subject=List my business on ${SITE_NAME}`}>
              Need help? Email us
            </a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>How it works</h2>
          <div className="features">
            {STEPS.map(([n, title, text]) => (
              <div key={n} className="card feature">
                <span className="chip">Step {n}</span>
                <b>{title}</b>
                <span className="muted">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>What you get</h2>
          <div className="features">
            {PERKS.map(([icon, title, text]) => (
              <div key={title} className="card feature">
                <span className="icon">{icon}</span>
                <b>{title}</b>
                <span className="muted">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
