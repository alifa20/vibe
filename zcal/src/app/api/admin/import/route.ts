import { apiError, guardOwner, invalid, ok, readJsonBody } from "@/lib/api";
import { applyBackup } from "@/lib/backup";
import { getDb } from "@/lib/db";
import { backupSchema, importSchema } from "@/lib/validation";

/**
 * Read a zcal backup back in. `merge` keeps what is here; `replace` clears the
 * database first. Everything is validated before a single row is written.
 */
export async function POST(request: Request) {
  const denied = await guardOwner();
  if (denied) return denied;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const envelope = importSchema.safeParse(body.value);
  if (!envelope.success) return invalid(envelope.error);

  const parsed = backupSchema.safeParse(envelope.data.payload);
  if (!parsed.success) {
    return apiError(
      422,
      "not_a_backup",
      "That file is not a zcal backup, or some of it could not be read. Nothing was changed.",
      Object.fromEntries(
        parsed.error.issues.slice(0, 8).map((issue) => [issue.path.join(".") || "file", issue.message]),
      ),
    );
  }

  return ok(applyBackup(getDb(), parsed.data, envelope.data.mode));
}
