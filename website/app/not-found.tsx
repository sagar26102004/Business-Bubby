import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="wrap notfound">
      <h1>We couldn’t find that page</h1>
      <p className="muted">The business may have changed its name or left One Place.</p>
      <Link className="btn btn-primary" href="/">
        Browse businesses
      </Link>
    </main>
  );
}
