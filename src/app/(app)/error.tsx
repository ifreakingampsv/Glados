"use client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="section-card">
      <h1>Unable to load workspace</h1>
      <p className="alert alert-danger">
        {error.message ||
          "An unexpected error occurred while loading your data."}
      </p>
      <button type="button" className="btn btn-primary" onClick={() => reset()}>
        Retry
      </button>
    </main>
  );
}
