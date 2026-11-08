'use client';

import Link from 'next/link';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section>
      <h1 className="title">Something went wrong</h1>
      <p className="notice" role="alert">
        An unexpected error occurred while communicating with the service.
      </p>
      <p style={{ marginTop: '1.5rem' }}>
        <button type="button" onClick={() => reset()} style={{ marginRight: '1rem' }}>
          Try again
        </button>
        <Link href="/" className="muted">
          Back to open bounties
        </Link>
      </p>
    </section>
  );
}
