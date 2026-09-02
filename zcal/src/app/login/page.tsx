import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "./LoginForm";
import { Notice } from "@/components/Notice";
import { isOwnerSignedIn } from "@/lib/auth";
import { configProblems } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await isOwnerSignedIn()) redirect("/admin");
  const problems = configProblems();

  return (
    <div className="shell">
      <header className="site-header">
        <div className="container site-header__inner">
          <a className="brand" href="/">
            <span className="brand__dot" aria-hidden="true" />
            zcal
          </a>
        </div>
      </header>

      <main className="main" id="main">
        <div className="container container--narrow stack stack--lg">
          <div>
            <h1>Sign in</h1>
            <p className="page-head__lede">
              There is one account and it is yours. The passphrase is the{" "}
              <span className="mono">ZCAL_OWNER_PASSWORD</span> value in your{" "}
              <span className="mono">.env</span> file.
            </p>
          </div>

          {problems.length > 0 ? (
            <Notice tone="warning" title="Finish setting up first">
              <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.15rem" }}>
                {problems.map((problem) => (
                  <li key={problem.variable}>
                    <span className="mono">{problem.variable}</span> {problem.message}
                  </li>
                ))}
              </ul>
              <p style={{ marginTop: "0.5rem" }}>
                Run <span className="mono">npm run setup</span>, or edit{" "}
                <span className="mono">.env</span> and restart the server.
              </p>
            </Notice>
          ) : (
            <LoginForm />
          )}
        </div>
      </main>
    </div>
  );
}
