import { guardOwner, invalid, ok, readJsonBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { listAvailabilityRules, replaceAvailabilityRules } from "@/lib/repo";
import { hhMmToMinutes } from "@/lib/time";
import { availabilityRulesSchema } from "@/lib/validation";

export async function GET() {
  const denied = await guardOwner();
  if (denied) return denied;
  return ok({ rules: listAvailabilityRules(getDb()) });
}

/** Working hours are saved as a whole week, so this is a replace, not a patch. */
export async function PUT(request: Request) {
  const denied = await guardOwner();
  if (denied) return denied;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = availabilityRulesSchema.safeParse(body.value);
  if (!parsed.success) return invalid(parsed.error);

  const rules = parsed.data.rules.map((rule) => ({
    weekday: rule.weekday,
    startMinute: hhMmToMinutes(rule.start)!,
    endMinute: hhMmToMinutes(rule.end)!,
  }));

  return ok({ rules: replaceAvailabilityRules(getDb(), rules) });
}
