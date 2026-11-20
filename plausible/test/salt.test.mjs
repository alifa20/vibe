import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.mjs';
import { createSaltStore, visitorHash } from '../src/salt.mjs';
import { fakeClock, CHROME_UA } from './helpers.mjs';

const saltRows = (db) => db.prepare('SELECT day, salt FROM salts').all();

test('two hits from the same visitor on one day share a hash (AE1)', () => {
  const db = openDb(':memory:');
  const clock = fakeClock('2026-11-20T09:00:00Z');
  const salts = createSaltStore(db, clock);
  const a = visitorHash(salts.current().salt, 'example.com', '203.0.113.7', CHROME_UA);
  clock.advance(3 * 3600_000);
  const b = visitorHash(salts.current().salt, 'example.com', '203.0.113.7', CHROME_UA);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{16}$/, 'SHA-256 truncated to 64 bits');
});

test('the hash depends on site, IP and user agent', () => {
  const salt = Buffer.alloc(32, 1);
  const base = visitorHash(salt, 'example.com', '203.0.113.7', CHROME_UA);
  assert.notEqual(base, visitorHash(salt, 'other.com', '203.0.113.7', CHROME_UA));
  assert.notEqual(base, visitorHash(salt, 'example.com', '203.0.113.8', CHROME_UA));
  assert.notEqual(base, visitorHash(salt, 'example.com', '203.0.113.7', CHROME_UA + 'x'));
  assert.notEqual(base, visitorHash(Buffer.alloc(32, 2), 'example.com', '203.0.113.7', CHROME_UA));
});

test('after UTC midnight the salt rotates and the old one is gone from memory and the database', () => {
  const db = openDb(':memory:');
  const clock = fakeClock('2026-11-20T23:59:59Z');
  const salts = createSaltStore(db, clock);
  const before = salts.current();
  assert.equal(before.day, '2026-11-20');
  const hashBefore = visitorHash(before.salt, 'example.com', '203.0.113.7', CHROME_UA);

  clock.advance(1000); // 00:00:00 the next day
  const after = salts.current();
  assert.equal(after.day, '2026-11-21');
  assert.notDeepEqual(after.salt, before.salt);
  assert.notEqual(visitorHash(after.salt, 'example.com', '203.0.113.7', CHROME_UA), hashBefore);

  const rows = saltRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].day, '2026-11-21');
  assert.ok(!rows.some((r) => Buffer.from(r.salt).equals(before.salt)));
  // Nothing keeps a reference: the store only exposes today's salt.
  assert.equal(salts.current().day, '2026-11-21');
});

test('rotate() deletes yesterday\'s salt even when no traffic arrives', () => {
  const db = openDb(':memory:');
  const clock = fakeClock('2026-11-20T10:00:00Z');
  const salts = createSaltStore(db, clock);
  salts.current();
  clock.set('2026-11-21T00:00:30Z');
  salts.rotate();
  assert.deepEqual(saltRows(db).map((r) => r.day), ['2026-11-21']);
});

test('a restart on the same day reuses the stored salt', () => {
  const db = openDb(':memory:');
  const clock = fakeClock('2026-11-20T10:00:00Z');
  const first = createSaltStore(db, clock).current();
  const second = createSaltStore(db, clock).current();
  assert.ok(Buffer.from(second.salt).equals(Buffer.from(first.salt)));
});

test('a restart on a later day discards the stale salt', () => {
  const db = openDb(':memory:');
  const clock = fakeClock('2026-11-20T10:00:00Z');
  const first = createSaltStore(db, clock).current();
  clock.set('2026-11-23T08:00:00Z');
  const later = createSaltStore(db, clock).current();
  assert.equal(later.day, '2026-11-23');
  assert.ok(!Buffer.from(later.salt).equals(Buffer.from(first.salt)));
  assert.equal(saltRows(db).length, 1);
});

test('salts are 32 random bytes', () => {
  const db = openDb(':memory:');
  const { salt } = createSaltStore(db, fakeClock()).current();
  assert.equal(Buffer.from(salt).length, 32);
});

test('a rotated-out salt leaves no bytes in the database file or its WAL', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-salt-'));
  const file = path.join(dir, 'salt.db');
  const db = openDb(file);
  try {
    const clock = fakeClock('2026-11-20T10:00:00Z');
    const salts = createSaltStore(db, clock);
    const old = Buffer.from(salts.current().salt);
    clock.set('2026-11-21T00:00:30Z');
    salts.rotate();
    const today = Buffer.from(salts.current().salt);
    for (const f of [file, `${file}-wal`]) {
      if (!fs.existsSync(f)) continue;
      const bytes = fs.readFileSync(f);
      assert.equal(bytes.indexOf(old), -1, `old salt bytes found in ${path.basename(f)}`);
    }
    assert.notEqual(fs.readFileSync(file).indexOf(today), -1, "sanity: today's salt is on disk");
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
