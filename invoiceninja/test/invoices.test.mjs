import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { openDb } from '../src/db.mjs';
import {
  addLine,
  createClient,
  createInvoice,
  dashboard,
  deleteInvoice,
  getInvoice,
  isOverdue,
  recordPayment,
  saveSettings,
  getSettings,
  sendInvoice,
  updateClient,
  updateLine,
  voidInvoice,
  InvoiceError,
} from '../src/invoices.mjs';

const at = (iso) => Date.parse(iso);
const T2026 = at('2026-03-10T10:00:00Z');

function setup({ timezone = 'UTC' } = {}) {
  const db = openDb(':memory:', { timezone });
  saveSettings(db, {
    ...getSettings(db),
    business_name: 'Acme Studio',
    business_address: '1 Main St',
  });
  const clientId = createClient(db, { name: 'Globex', address: '9 Old Rd' }, T2026);
  const draft = (lines = [{ description: 'Work', qty_milli: 1000, unit_price: 10000, tax_rate_bp: 1000 }], currency = 'USD') => {
    const id = createInvoice(db, { client_id: clientId, currency }, T2026);
    for (const l of lines) addLine(db, id, l);
    return id;
  };
  return { db, clientId, draft };
}

test('AE2: numbers follow send order, and a sent invoice rejects line edits', () => {
  const { db, draft } = setup();
  const a = draft();
  const b = draft();
  assert.equal(sendInvoice(db, b, T2026), 'INV-2026-0001');
  assert.equal(sendInvoice(db, a, T2026 + 1000), 'INV-2026-0002');

  const lineId = getInvoice(db, a).lines[0].id;
  // Below the UI: the trigger itself refuses.
  assert.throws(() => db.prepare('UPDATE invoice_lines SET unit_price = 1 WHERE id = ?').run(lineId), /frozen/);
  assert.throws(() => db.prepare('DELETE FROM invoice_lines WHERE id = ?').run(lineId), /frozen/);
  assert.throws(
    () => db.prepare("INSERT INTO invoice_lines (invoice_id, position, description, qty_milli, unit_price, tax_rate_bp) VALUES (?, 9, 'x', 1, 1, 0)").run(a),
    /frozen/
  );
  // And through the module with a readable error.
  assert.throws(() => updateLine(db, a, lineId, { description: 'x', qty_milli: 1, unit_price: 1, tax_rate_bp: 0 }), InvoiceError);
});

test('frozen columns cannot change on a sent invoice', () => {
  const { db, draft } = setup();
  const id = draft();
  sendInvoice(db, id, T2026);
  for (const sql of [
    "UPDATE invoices SET total = 1 WHERE id = ?",
    "UPDATE invoices SET number = 'INV-2026-0099' WHERE id = ?",
    "UPDATE invoices SET client_name = 'Someone else' WHERE id = ?",
    "UPDATE invoices SET due_date = '2030-01-01' WHERE id = ?",
    "UPDATE invoices SET currency = 'EUR' WHERE id = ?",
  ]) {
    assert.throws(() => db.prepare(sql).run(id), /frozen/, sql);
  }
});

test('totals are saved on send and never recomputed', () => {
  const { db, draft } = setup();
  const id = draft([
    { description: 'a', qty_milli: 3000, unit_price: 3333, tax_rate_bp: 1000 },
    { description: 'b', qty_milli: 1000, unit_price: 1, tax_rate_bp: 1000 },
  ]);
  sendInvoice(db, id, T2026);
  const row = db.prepare('SELECT subtotal, tax_total, total, tax_breakdown FROM invoices WHERE id = ?').get(id);
  assert.deepEqual(
    { ...row, tax_breakdown: JSON.parse(row.tax_breakdown) },
    { subtotal: 10000, tax_total: 1000, total: 11000, tax_breakdown: [{ rateBp: 1000, net: 10000, tax: 1000 }] }
  );
  assert.equal(getInvoice(db, id).totals.total, 11000);
});

test('changing a client after sending leaves the invoice snapshot alone', () => {
  const { db, clientId, draft } = setup();
  const id = draft();
  sendInvoice(db, id, T2026);
  updateClient(db, clientId, { name: 'Globex Ltd', address: '42 New Ave' });
  saveSettings(db, { ...getSettings(db), business_address: 'Moved' });
  const inv = getInvoice(db, id);
  assert.equal(inv.client_name, 'Globex');
  assert.equal(inv.client_address, '9 Old Rd');
  assert.equal(inv.seller_address, '1 Main St');
});

test('a draft can be deleted, a sent invoice cannot', () => {
  const { db, draft } = setup();
  const d = draft();
  deleteInvoice(db, d);
  assert.equal(getInvoice(db, d), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invoice_lines WHERE invoice_id = ?').get(d).n, 0);

  const s = draft();
  sendInvoice(db, s, T2026);
  assert.throws(() => db.prepare('DELETE FROM invoices WHERE id = ?').run(s), /only draft/);
  assert.throws(() => deleteInvoice(db, s), InvoiceError);
});

test('status moves: sent->paid, sent->void, paid->void allowed; paid->draft rejected', () => {
  const { db, draft } = setup();
  const p = draft();
  sendInvoice(db, p, T2026);
  recordPayment(db, p, { paid_date: '2026-03-12', payment_method: 'bank transfer' }, T2026);
  assert.equal(getInvoice(db, p).status, 'paid');
  assert.throws(() => db.prepare("UPDATE invoices SET status = 'draft' WHERE id = ?").run(p), /invalid invoice status/);
  assert.throws(() => db.prepare("UPDATE invoices SET status = 'sent' WHERE id = ?").run(p), /invalid invoice status/);
  voidInvoice(db, p, T2026);
  assert.equal(getInvoice(db, p).status, 'void');
  assert.throws(() => db.prepare("UPDATE invoices SET status = 'sent' WHERE id = ?").run(p));

  const v = draft();
  sendInvoice(db, v, T2026);
  voidInvoice(db, v, T2026);
  assert.equal(getInvoice(db, v).status, 'void');

  const d = draft();
  assert.throws(() => db.prepare("UPDATE invoices SET status = 'paid', paid_date = '2026-01-01' WHERE id = ?").run(d), /invalid invoice status/);
});

test('overdue: sent and past due; not on the due date, not once paid', () => {
  const base = { status: 'sent', due_date: '2026-03-24' };
  assert.equal(isOverdue(base, '2026-03-24'), false);
  assert.equal(isOverdue(base, '2026-03-25'), true);
  assert.equal(isOverdue({ ...base, status: 'paid' }, '2026-03-25'), false);
  assert.equal(isOverdue({ ...base, status: 'draft' }, '2026-03-25'), false);
  assert.equal(isOverdue({ ...base, status: 'void' }, '2026-03-25'), false);
});

test('due date defaults to issue date plus payment terms', () => {
  const { db, draft } = setup();
  const id = draft();
  sendInvoice(db, id, T2026);
  const inv = getInvoice(db, id);
  assert.equal(inv.issue_date, '2026-03-10');
  assert.equal(inv.due_date, '2026-03-24');
});

test('the counter resets in a new year', () => {
  const { db, draft } = setup();
  sendInvoice(db, draft(), T2026);
  sendInvoice(db, draft(), T2026);
  assert.equal(sendInvoice(db, draft(), at('2027-02-01T10:00:00Z')), 'INV-2027-0001');
});

test('the numbering year follows the timezone setting', () => {
  const { db, draft } = setup({ timezone: 'Australia/Melbourne' });
  // 2027-01-01 08:00 in Melbourne, still 2026-12-31 in UTC.
  const id = draft();
  assert.equal(sendInvoice(db, id, at('2026-12-31T21:00:00Z')), 'INV-2027-0001');
  assert.equal(getInvoice(db, id).issue_date, '2027-01-01');
});

test('a failed send does not burn a number', () => {
  const { db, clientId, draft } = setup();
  const empty = createInvoice(db, { client_id: clientId, currency: 'USD' }, T2026);
  assert.throws(() => sendInvoice(db, empty, T2026), /at least one line/);
  assert.equal(sendInvoice(db, draft(), T2026), 'INV-2026-0001');
});

test('dashboard totals are per currency and overdue counts only as overdue', () => {
  const { db, draft } = setup();
  const usdLate = draft();
  const usdOk = draft([{ description: 'x', qty_milli: 2000, unit_price: 5000, tax_rate_bp: 0 }]);
  const jpy = draft([{ description: 'y', qty_milli: 3000, unit_price: 333, tax_rate_bp: 0 }], 'JPY');
  sendInvoice(db, usdLate, at('2026-01-01T10:00:00Z')); // due 2026-01-15
  sendInvoice(db, usdOk, T2026); // due 2026-03-24
  sendInvoice(db, jpy, T2026);
  const d = dashboard(db, '2026-03-11');
  assert.deepEqual(d.totals, [
    { currency: 'JPY', outstanding: 999, overdue: 0, outstandingCount: 1, overdueCount: 0 },
    { currency: 'USD', outstanding: 10000, overdue: 11000, outstandingCount: 1, overdueCount: 1 },
  ]);
  assert.equal(d.counts.overdue, 1);
  assert.equal(d.counts.sent, 2);
});

test('two connections sending at once never share a number (file-backed)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invoices-'));
  const file = path.join(dir, 'test.db');
  try {
    const db = openDb(file, { timezone: 'UTC' });
    const clientId = createClient(db, { name: 'Globex' }, T2026);
    const ids = [];
    for (let i = 0; i < 60; i += 1) {
      const id = createInvoice(db, { client_id: clientId, currency: 'USD' }, T2026);
      addLine(db, id, { description: 'w', qty_milli: 1000, unit_price: 100, tax_rate_bp: 0 });
      ids.push(id);
    }
    db.close();

    const run = (mine) =>
      new Promise((resolve, reject) => {
        const w = new Worker(new URL('./send-worker.mjs', import.meta.url), { workerData: { file, ids: mine, now: T2026 } });
        w.once('message', resolve);
        w.once('error', reject);
      });
    const results = await Promise.all([run(ids.filter((_, i) => i % 2 === 0)), run(ids.filter((_, i) => i % 2 === 1))]);
    const numbers = results.flat();
    assert.equal(numbers.length, 60);
    assert.equal(new Set(numbers).size, 60);
    const seqs = numbers.map((n) => Number(n.slice(-4))).sort((x, y) => x - y);
    assert.deepEqual(seqs, Array.from({ length: 60 }, (_, i) => i + 1));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
