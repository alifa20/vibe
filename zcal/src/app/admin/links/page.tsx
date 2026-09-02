import type { Metadata } from "next";
import { LinksManager } from "./LinksManager";
import { getDb } from "@/lib/db";
import { publicBaseUrl } from "@/lib/env";
import { listEventTypes } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Booking links" };

export default async function LinksPage() {
  const eventTypes = listEventTypes(getDb());

  return (
    <div className="stack stack--lg">
      <div className="page-head">
        <div>
          <h1>Booking links</h1>
          <p className="page-head__lede">
            Each link is a page you can send to someone. It shows only your free time — never what
            you are doing, and never who else has booked.
          </p>
        </div>
      </div>

      <LinksManager eventTypes={eventTypes} baseUrl={publicBaseUrl()} />
    </div>
  );
}
