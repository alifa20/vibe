import { guardOwner } from "@/lib/api";
import { buildBackup } from "@/lib/backup";
import { getDb } from "@/lib/db";

/**
 * Everything you have, as JSON. Cancellation tokens are the one thing left
 * out — they are per-invitee secrets, and importing mints fresh ones.
 */
export async function GET() {
  const denied = await guardOwner();
  if (denied) return denied;

  const backup = buildBackup(getDb());
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="zcal-backup-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
