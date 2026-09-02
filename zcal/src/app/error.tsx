"use client";

import { useEffect } from "react";

/**
 * The last line of defence. It shows what went wrong in general terms and
 * never renders the underlying message, which could contain a file path.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is a hash; the full error is already in the server console.
    console.error("Something failed while rendering this page.", error.digest ?? "");
  }, [error]);

  return (
    <div className="shell">
      <main className="main" id="main">
        <div className="container container--narrow stack">
          <h1>Something went wrong</h1>
          <p className="text-muted">
            The page could not be built. Nothing was changed. The details are in the terminal where
            you started the server.
          </p>
          <div className="row">
            <button type="button" className="btn" onClick={reset}>
              Try again
            </button>
            <a className="btn btn--secondary" href="/admin">
              Back to the overview
            </a>
          </div>
          {error.digest ? <p className="mono text-muted">Reference: {error.digest}</p> : null}
        </div>
      </main>
    </div>
  );
}
