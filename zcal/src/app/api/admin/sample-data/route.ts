import { guardOwner, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { countSampleData, deleteSampleData } from "@/lib/repo";
import { seedSampleData } from "@/lib/sample-data";

export async function GET() {
  const denied = await guardOwner();
  if (denied) return denied;
  return ok(countSampleData(getDb()));
}

/** Put the demo content back, for when you want to look around again. */
export async function POST() {
  const denied = await guardOwner();
  if (denied) return denied;
  return ok(seedSampleData(getDb()));
}

/** Remove every row that carries the sample flag, in one transaction. */
export async function DELETE() {
  const denied = await guardOwner();
  if (denied) return denied;
  return ok({ removed: deleteSampleData(getDb()) });
}
