import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs');

/** Run server.mjs from an empty directory with the given password. */
function startWith(password) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invoices-server-'));
  try {
    return spawnSync(process.execPath, [SERVER], {
      cwd: dir,
      env: { PATH: process.env.PATH, ADMIN_PASSWORD: password, PORT: '0', DB_PATH: path.join(dir, 'i.db') },
      encoding: 'utf8',
      timeout: 3000,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the server refuses to start with the .env.example placeholder password', () => {
  const run = startWith('change-me-to-a-long-random-password');
  assert.equal(run.status, 1);
  assert.match(run.stderr, /change-me/);
});

test('the server refuses to start with an empty password', () => {
  const run = startWith('');
  assert.equal(run.status, 1);
  assert.match(run.stderr, /ADMIN_PASSWORD/);
});

test('.env.example ships no usable password', () => {
  const example = fs.readFileSync(path.join(path.dirname(SERVER), '.env.example'), 'utf8');
  assert.match(example, /^ADMIN_PASSWORD=$/m);
});
