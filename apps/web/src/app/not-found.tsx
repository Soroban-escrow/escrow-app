import Link from 'next/link';

export default function NotFound() {
  return (
    <section>
      <h1 className="title">Page not found</h1>
      <p className="muted" role="alert">
        The requested page or resource could not be found.
      </p>
      <p style={{ marginTop: '1.5rem' }}>
        <Link href="/" className="cta">
          Back to open bounties
        </Link>
      </p>
    </section>
  );
}
