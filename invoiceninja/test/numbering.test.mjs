import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../src/db.mjs';
import { formatNumber, localDate, localYear, nextNumber } from '../src/numbering.mjs';

const at = (iso) => Date.parse(iso);

test('numbers look like INV-YYYY-NNNN', () => {
  assert.equal(formatNumber(2026, 1), 'INV-2026-0001');
  assert.equal(formatNumber(2026, 12345), 'INV-2026-12345');
});

test('local year and date follow the configured timezone', () => {
  // 2027-01-01 08:00 in Melbourne (UTC+11) is still 2026-12-31 in UTC.
  const t = at('2026-12-31T21:00:00Z');
  assert.equal(localYear(t, 'UTC'), 2026);
  assert.equal(localYear(t, 'Australia/Melbourne'), 2027);
  assert.equal(localDate(t, 'Australia/Melbourne'), '2027-01-01');
  assert.equal(localDate(t, 'UTC'), '2026-12-31');
});

test('the counter is sequential per year and resets in a new year', () => {
  const db = openDb(':memory:');
  const take = (year) => db.transaction(() => nextNumber(db, year)).immediate();
  assert.equal(take(2026), 'INV-2026-0001');
  assert.equal(take(2026), 'INV-2026-0002');
  assert.equal(take(2027), 'INV-2027-0001');
  assert.equal(take(2026), 'INV-2026-0003');
  db.close();
});

test('a rolled-back transaction does not burn a number', () => {
  const db = openDb(':memory:');
  assert.throws(() =>
    db.transaction(() => {
      nextNumber(db, 2026);
      throw new Error('boom');
    }).immediate()
  );
  assert.equal(db.transaction(() => nextNumber(db, 2026)).immediate(), 'INV-2026-0001');
  db.close();
});
