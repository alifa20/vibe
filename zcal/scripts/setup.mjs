#!/usr/bin/env node
/**
 * One command to go from a fresh clone to a working app.
 *
 *   npm run setup
 *
 * Creates .env from .env.example with real generated secrets (it never
 * overwrites an existing .env), applies migrations, and adds the sample data.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");

function generatePassphrase() {
  const words = [
    "amber", "birch", "cobalt", "dune", "ember", "fjord", "granite", "harbour",
    "indigo", "juniper", "kelp", "lantern", "meadow", "nimbus", "orchard", "pebble",
    "quarry", "ridge", "saffron", "thicket", "umber", "violet", "willow", "zenith",
  ];
  const picked = Array.from(
    { length: 4 },
    () => words[crypto.randomInt(0, words.length)],
  );
  return `${picked.join("-")}-${crypto.randomInt(100, 999)}`;
}

let created = false;
let passphrase = null;

if (fs.existsSync(envPath)) {
  console.log("Found an existing .env — leaving it exactly as it is.");
} else {
  if (!fs.existsSync(examplePath)) {
    console.error("Cannot find .env.example. Are you in the project root?");
    process.exit(1);
  }
  passphrase = generatePassphrase();
  const secret = crypto.randomBytes(32).toString("hex");
  const contents = fs
    .readFileSync(examplePath, "utf8")
    .replace(/^ZCAL_OWNER_PASSWORD=.*$/m, `ZCAL_OWNER_PASSWORD=${passphrase}`)
    .replace(/^ZCAL_SESSION_SECRET=.*$/m, `ZCAL_SESSION_SECRET=${secret}`);
  fs.writeFileSync(envPath, contents, { mode: 0o600 });
  created = true;
  console.log("Created .env with a generated passphrase and session secret (mode 600).");
}

function run(step, args) {
  console.log(`\n> ${step}`);
  execFileSync(process.execPath, args, { stdio: "inherit", cwd: root });
}

const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
run("applying migrations", [tsx, path.join(root, "scripts", "migrate.ts")]);
run("adding sample data", [tsx, path.join(root, "scripts", "seed.ts")]);

console.log("\n----------------------------------------------------------------");
console.log("zcal is ready.\n");
if (created && passphrase) {
  console.log("Your owner passphrase is:\n");
  console.log(`    ${passphrase}\n`);
  console.log("It is stored in .env, which is gitignored. Change it there any time.");
} else {
  console.log("Your owner passphrase is the ZCAL_OWNER_PASSWORD value in .env.");
}
console.log("\nStart it with:  npm run dev      then open http://localhost:3000");
console.log("----------------------------------------------------------------");
