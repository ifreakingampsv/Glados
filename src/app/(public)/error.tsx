"use client";

export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="section-card">
      <h1>Something went wrong</h1>
      <p className="alert alert-danger">
        {error.message || "Unable to load this page right now."}
      </p>
      <button type="button" className="btn btn-primary" onClick={() => reset()}>
        Try again
      </button>
    </main>
  );
}
