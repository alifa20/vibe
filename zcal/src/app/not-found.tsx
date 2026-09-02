import Link from "next/link";

export default function NotFound() {
  return (
    <div className="shell">
      <main className="main" id="main">
        <div className="container container--narrow stack">
          <h1>Nothing here</h1>
          <p className="text-muted">
            That address does not match a booking link or a booking on this calendar. Check the link
            you were sent — it is case-sensitive and has no trailing spaces.
          </p>
          <div>
            <Link className="btn btn--secondary" href="/">
              Back to the start
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
