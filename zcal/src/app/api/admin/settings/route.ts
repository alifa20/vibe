import { guardOwner, invalid, ok, readJsonBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getSettings, updateSettings } from "@/lib/repo";
import { settingsSchema } from "@/lib/validation";

export async function GET() {
  const denied = await guardOwner();
  if (denied) return denied;
  return ok(getSettings(getDb()));
}

export async function PUT(request: Request) {
  const denied = await guardOwner();
  if (denied) return denied;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = settingsSchema.safeParse(body.value);
  if (!parsed.success) return invalid(parsed.error);

  return ok(updateSettings(getDb(), parsed.data));
}
