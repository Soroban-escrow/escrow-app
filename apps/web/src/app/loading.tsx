export default function Loading() {
  return (
    <div className="container" aria-busy="true" aria-live="polite">
      <p className="muted">Loading content...</p>
    </div>
  );
}
