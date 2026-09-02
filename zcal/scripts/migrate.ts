#!/usr/bin/env node
import { migrate, openDatabase, schemaVersion } from "../src/lib/db";
import { databasePath, loadEnvFile } from "../src/lib/env";

loadEnvFile();
const file = databasePath();
const db = openDatabase(file);
const applied = migrate(db);
console.log(`Database: ${file}`);
console.log(
  applied > 0
    ? `Applied ${applied} migration(s). Schema is now at version ${schemaVersion(db)}.`
    : `Already up to date at schema version ${schemaVersion(db)}.`,
);
db.close();
