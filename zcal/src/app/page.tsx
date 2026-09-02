import Link from "next/link";
import { isOwnerSignedIn } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The front door. It deliberately lists nothing: booking links are shared by
 * you, one at a time, and are not discoverable from here.
 */
export default async function HomePage() {
  if (await isOwnerSignedIn()) redirect("/admin");

  return (
    <div className="shell">
      <header className="site-header">
        <div className="container site-header__inner">
          <span className="brand">
            <span className="brand__dot" aria-hidden="true" />
            zcal
            <span className="brand__tag">private scheduling</span>
          </span>
        </div>
      </header>

      <main className="main" id="main">
        <div className="container container--narrow stack stack--lg">
          <div>
            <h1>One calendar. One person. No accounts.</h1>
            <p className="page-head__lede">
              zcal publishes your free time, lets someone reserve a slot, and writes the meeting
              straight back to your calendar. Everything lives in a single SQLite file on this
              machine.
            </p>
          </div>

          <div className="card stack">
            <div>
              <h2 className="card__title">Have a booking link?</h2>
              <p className="card__hint">
                Open the address you were sent. It looks like <span className="mono">/book/intro-call</span>.
                Nothing is listed here, on purpose.
              </p>
            </div>
            <hr className="divider" />
            <div>
              <h2 className="card__title">Is this your calendar?</h2>
              <p className="card__hint">Sign in with your passphrase to manage it.</p>
            </div>
            <div>
              <Link className="btn" href="/login">
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </main>

      <footer className="site-footer">
        <div className="container">
          zcal — self-hosted. No analytics, no telemetry, no third-party accounts.
        </div>
      </footer>
    </div>
  );
}
