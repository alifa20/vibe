import { redirect } from "next/navigation";
import { AdminNav } from "@/components/AdminNav";
import { SignOutButton } from "@/components/SignOutButton";
import { isOwnerSignedIn } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** Everything under /admin is behind the passphrase. One gate, checked here. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isOwnerSignedIn())) redirect("/login");
  const settings = getSettings(getDb());

  return (
    <div className="shell">
      <header className="site-header">
        <div className="container site-header__inner">
          <a className="brand" href="/admin">
            <span className="brand__dot" aria-hidden="true" />
            zcal
            <span className="brand__tag">{settings.calendarName}</span>
          </a>
          <AdminNav />
          <SignOutButton />
        </div>
      </header>

      <main className="main" id="main">
        <div className="container">{children}</div>
      </main>

      <footer className="site-footer">
        <div className="container row row--between">
          <span>
            Times shown in <strong>{settings.timeZone}</strong>. Data stored locally in SQLite.
          </span>
          <span>No analytics, no telemetry, no third-party accounts.</span>
        </div>
      </footer>
    </div>
  );
}
