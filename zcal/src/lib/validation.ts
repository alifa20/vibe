import { z } from "zod";
import { hhMmToMinutes, isValidTimeZone, parseIsoDate } from "./time";

/**
 * Every request body from a browser is untrusted, including the owner's own.
 * Nothing reaches SQL without passing through one of these schemas first.
 */

const trimmed = (max: number) => z.string().trim().max(max);

export const isoDateString = z
  .string()
  .trim()
  .refine((value) => parseIsoDate(value) !== null, "Use the format YYYY-MM-DD.");

export const isoInstantString = z
  .string()
  .trim()
  .refine((value) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(value)) return false;
    return !Number.isNaN(Date.parse(value));
  }, "Expected an ISO-8601 UTC timestamp.");

export const timeZoneString = z
  .string()
  .trim()
  .min(1, "Choose a timezone.")
  .refine(isValidTimeZone, "That is not a recognised IANA timezone name.");

export const hhMmString = z
  .string()
  .trim()
  .refine((value) => hhMmToMinutes(value) !== null, "Use a 24-hour time like 09:30.");

export const slugString = z
  .string()
  .trim()
  .min(1, "Add a link name.")
  .max(60, "Keep the link name under 60 characters.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers and single hyphens, like intro-call.",
  );

export const loginSchema = z.object({
  password: z.string().min(1, "Enter your passphrase.").max(512),
});

export const settingsSchema = z.object({
  ownerName: trimmed(120),
  ownerEmail: z.union([z.literal(""), z.string().trim().email("Enter a valid email address.")]),
  timeZone: timeZoneString,
  calendarName: trimmed(120).min(1, "Give your calendar a name."),
});

export const eventTypeSchema = z
  .object({
    slug: slugString,
    title: trimmed(120).min(1, "Add a title."),
    description: trimmed(2000).default(""),
    location: trimmed(300).default(""),
    durationMinutes: z.coerce.number().int().min(5).max(480),
    bufferBeforeMinutes: z.coerce.number().int().min(0).max(240).default(0),
    bufferAfterMinutes: z.coerce.number().int().min(0).max(240).default(0),
    minNoticeMinutes: z.coerce.number().int().min(0).max(20160).default(120),
    maxDaysAhead: z.coerce.number().int().min(1).max(365).default(30),
    slotIntervalMinutes: z.coerce.number().int().min(5).max(240).default(30),
    isActive: z.coerce.boolean().default(true),
  })
  .refine(
    (value) => value.slotIntervalMinutes <= value.durationMinutes + 240,
    { message: "The slot interval is far larger than the meeting length.", path: ["slotIntervalMinutes"] },
  );

export const availabilityRuleSchema = z
  .object({
    weekday: z.coerce.number().int().min(0).max(6),
    start: hhMmString,
    end: hhMmString,
  })
  .refine(
    (value) => (hhMmToMinutes(value.end) ?? 0) > (hhMmToMinutes(value.start) ?? 0),
    { message: "The end time must be after the start time.", path: ["end"] },
  );

export const availabilityRulesSchema = z.object({
  rules: z.array(availabilityRuleSchema).max(50, "That is more than 50 windows."),
});

export const calendarEventSchema = z
  .object({
    title: trimmed(200).min(1, "Add a title."),
    description: trimmed(2000).default(""),
    location: trimmed(300).default(""),
    startsAt: isoInstantString,
    endsAt: isoInstantString,
  })
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
    message: "The event must end after it starts.",
    path: ["endsAt"],
  })
  .refine(
    (value) => Date.parse(value.endsAt) - Date.parse(value.startsAt) <= 366 * 86_400_000,
    { message: "That event is longer than a year.", path: ["endsAt"] },
  );

export const bookingRequestSchema = z.object({
  slug: slugString,
  startsAt: isoInstantString,
  name: trimmed(120).min(1, "Tell us your name."),
  email: z.string().trim().max(200).email("Enter a valid email address."),
  notes: trimmed(1000).default(""),
});

export const cancelRequestSchema = z.object({
  token: z.string().trim().min(1).max(200),
  reason: trimmed(500).default(""),
});

export const importSchema = z.object({
  mode: z.enum(["merge", "replace"]).default("merge"),
  payload: z.unknown(),
});

/** The shape produced by GET /api/admin/export, and accepted back on import. */
export const backupSchema = z.object({
  format: z.literal("zcal-backup"),
  version: z.number().int().min(1),
  exportedAt: z.string().optional(),
  settings: z
    .object({
      ownerName: z.string().max(120).default(""),
      ownerEmail: z.string().max(200).default(""),
      timeZone: timeZoneString,
      calendarName: z.string().max(120).default("My calendar"),
    })
    .optional(),
  eventTypes: z
    .array(
      z.object({
        slug: slugString,
        title: z.string().max(120),
        description: z.string().max(2000).default(""),
        location: z.string().max(300).default(""),
        durationMinutes: z.number().int().min(5).max(480),
        bufferBeforeMinutes: z.number().int().min(0).max(240).default(0),
        bufferAfterMinutes: z.number().int().min(0).max(240).default(0),
        minNoticeMinutes: z.number().int().min(0).max(20160).default(120),
        maxDaysAhead: z.number().int().min(1).max(365).default(30),
        slotIntervalMinutes: z.number().int().min(5).max(240).default(30),
        isActive: z.boolean().default(true),
        isSample: z.boolean().default(false),
      }),
    )
    .max(500)
    .default([]),
  availabilityRules: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startMinute: z.number().int().min(0).max(1440),
        endMinute: z.number().int().min(0).max(1440),
        isSample: z.boolean().default(false),
      }),
    )
    .max(200)
    .default([]),
  calendarEvents: z
    .array(
      z.object({
        uid: z.string().max(300).default(""),
        title: z.string().max(200),
        description: z.string().max(2000).default(""),
        location: z.string().max(300).default(""),
        startsAt: isoInstantString,
        endsAt: isoInstantString,
        source: z.enum(["local", "booking", "ics"]).default("local"),
        busy: z.boolean().default(true),
        isSample: z.boolean().default(false),
      }),
    )
    .max(20000)
    .default([]),
  bookings: z
    .array(
      z.object({
        publicId: z.string().max(64),
        eventTypeSlug: slugString,
        inviteeName: z.string().max(120),
        inviteeEmail: z.string().max(200),
        notes: z.string().max(1000).default(""),
        startsAt: isoInstantString,
        endsAt: isoInstantString,
        status: z.enum(["confirmed", "cancelled"]).default("confirmed"),
        isSample: z.boolean().default(false),
        createdAt: z.string().max(40).optional(),
        cancelledAt: z.string().max(40).nullable().optional(),
      }),
    )
    .max(20000)
    .default([]),
});

export type Backup = z.infer<typeof backupSchema>;

/** Flatten a ZodError into { field: message } for rendering next to inputs. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
