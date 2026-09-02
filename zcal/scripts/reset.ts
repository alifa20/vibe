#!/usr/bin/env node
import fs from "node:fs";
import { openDatabase } from "../src/lib/db";
import { databasePath, loadEnvFile } from "../src/lib/env";
import { deleteAllData, deleteSampleData } from "../src/lib/repo";

loadEnvFile();
const file = databasePath();
const args = process.argv.slice(2);
const sampleOnly = args.includes("--sample");
const dropFile = args.includes("--hard");

if (dropFile) {
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${file}${suffix}`, { force: true });
  }
  console.log(`Deleted ${file} and its journal files. Run \`npm run db:migrate\` to start again.`);
  process.exit(0);
}

const db = openDatabase(file);
if (sampleOnly) {
  const removed = deleteSampleData(db);
  console.log(`Database: ${file}`);
  console.log(
    `Removed sample data: ${removed.eventTypes} links, ${removed.availabilityRules} working-hours rows, ` +
      `${removed.calendarEvents} calendar events, ${removed.bookings} bookings.`,
  );
} else {
  deleteAllData(db);
  console.log(`Database: ${file}`);
  console.log("Deleted all links, working hours, calendar events and bookings. Settings kept.");
  console.log("Use `--sample` to remove only the sample rows, or `--hard` to delete the file.");
}
db.close();
