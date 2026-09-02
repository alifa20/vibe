import type { Metadata } from "next";
import { HoursEditor } from "./HoursEditor";
import { ProfileForm } from "./ProfileForm";
import { getDb } from "@/lib/db";
import { getSettings, listAvailabilityRules } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Hours & profile" };

function supportedTimeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;
  try {
    return supported ? supported("timeZone") : ["UTC"];
  } catch {
    return ["UTC"];
  }
}

export default async function HoursPage() {
  const db = getDb();
  const settings = getSettings(db);
  const rules = listAvailabilityRules(db);

  return (
    <div className="stack stack--lg">
      <div className="page-head">
        <div>
          <h1>Hours &amp; profile</h1>
          <p className="page-head__lede">
            Your working hours are the outer edge of what anyone can book. Your calendar then
            subtracts everything you are already doing.
          </p>
        </div>
      </div>

      <ProfileForm settings={settings} timeZones={supportedTimeZones()} />
      <HoursEditor rules={rules} timeZone={settings.timeZone} />
    </div>
  );
}
