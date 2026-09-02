#!/usr/bin/env node
import { openDatabase } from "../src/lib/db";
import { databasePath, loadEnvFile } from "../src/lib/env";
import { seedSampleData } from "../src/lib/sample-data";

loadEnvFile();
const file = databasePath();
const db = openDatabase(file);
const result = seedSampleData(db);

console.log(`Database: ${file}`);
if (result.alreadyPresent) {
  console.log("Sample data is already present — nothing added.");
  console.log("Remove it first with `npm run db:reset -- --sample` if you want a fresh set.");
} else {
  console.log("Added sample data, every row labelled [Sample]:");
  console.log(`  booking links     ${result.eventTypes}`);
  console.log(`  working hours     ${result.availabilityRules}`);
  console.log(`  calendar events   ${result.calendarEvents}`);
  console.log(`  bookings          ${result.bookings}`);
  console.log("");
  console.log("Delete all of it at any time from the Data page (/admin/data), or with:");
  console.log("  npm run db:reset -- --sample");
}
db.close();
