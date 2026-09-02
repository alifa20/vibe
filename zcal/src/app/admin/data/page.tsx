import type { Metadata } from "next";
import { DataManager } from "./DataManager";
import { getDb } from "@/lib/db";
import { databasePath } from "@/lib/env";
import { countSampleData } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Data" };

export default async function DataPage() {
  const sample = countSampleData(getDb());

  return (
    <div className="stack stack--lg">
      <div className="page-head">
        <div>
          <h1>Data</h1>
          <p className="page-head__lede">
            Export, import, and delete. Nothing here leaves this machine unless you download it
            yourself.
          </p>
        </div>
      </div>

      <DataManager sample={sample} databasePath={databasePath()} />
    </div>
  );
}
