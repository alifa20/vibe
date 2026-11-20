/**
 * Business operations on clients and invoices. Everything takes the database
 * handle explicitly and, where time matters, a timestamp in ms, so tests can
 * drive the clock. Rules the database enforces (frozen invoices, status moves)
 * are also checked here first, so the UI gets a readable message instead of
 * a trigger error; the triggers stay as the backstop.
 */
import { computeTotals } from './money.mjs';
import { addDays, localDate, localYear, nextNumber } from './numbering.mjs';

export class InvoiceError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = 'InvoiceError';
    this.status = status;
  }
}

const iso = (ms) => new Date(ms).toISOString();

/* ------------------------------------------------------------------ settings */

export function getSettings(db) {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get();
}

export function saveSettings(db, s) {
  db.prepare(
    `UPDATE settings SET business_name = @business_name, business_email = @business_email,
       business_address = @business_address, business_tax_id = @business_tax_id,
       payment_details = @payment_details, default_currency = @default_currency,
       payment_terms_days = @payment_terms_days, page_size = @page_size, timezone = @timezone
     WHERE id = 1`
  ).run(s);
}

/* ------------------------------------------------------------------- clients */

export function listClients(db) {
  return db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM invoices i WHERE i.client_id = c.id) AS invoice_count
       FROM clients c ORDER BY c.name COLLATE NOCASE, c.id`
    )
    .all();
}

export function getClient(db, id) {
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
}

export function createClient(db, c, now) {
  return Number(
    db
      .prepare(
        `INSERT INTO clients (name, email, address, tax_id, created_at)
         VALUES (@name, @email, @address, @tax_id, @created_at)`
      )
      .run({ email: '', address: '', tax_id: '', ...c, created_at: iso(now) }).lastInsertRowid
  );
}

export function updateClient(db, id, c) {
  const info = db
    .prepare('UPDATE clients SET name = @name, email = @email, address = @address, tax_id = @tax_id WHERE id = @id')
    .run({ email: '', address: '', tax_id: '', ...c, id });
  if (!info.changes) throw new InvoiceError('No such client.', 404);
}

export function deleteClient(db, id) {
  const used = db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE client_id = ?').get(id).n;
  if (used) throw new InvoiceError('This client has invoices, so it cannot be deleted.');
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
}

/* ------------------------------------------------------------------ invoices */

export function createInvoice(db, { client_id, currency, notes = '', due_date = null }, now) {
  if (!getClient(db, client_id)) throw new InvoiceError('Choose a client.', 400);
  return Number(
    db
      .prepare(
        `INSERT INTO invoices (status, client_id, currency, notes, due_date, created_at, updated_at)
         VALUES ('draft', ?, ?, ?, ?, ?, ?)`
      )
      .run(client_id, currency, notes, due_date || null, iso(now), iso(now)).lastInsertRowid
  );
}

function requireDraft(db, id) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!inv) throw new InvoiceError('No such invoice.', 404);
  if (inv.status !== 'draft') throw new InvoiceError('This invoice has been sent and can no longer be edited.');
  return inv;
}

export function updateDraft(db, id, { client_id, currency, notes = '', due_date = null }, now) {
  const inv = requireDraft(db, id);
  if (!getClient(db, client_id)) throw new InvoiceError('Choose a client.', 400);
  if (currency !== inv.currency && lineCount(db, id) > 0) {
    throw new InvoiceError('Remove the lines before changing the currency.', 400);
  }
  db.prepare(
    'UPDATE invoices SET client_id = ?, currency = ?, notes = ?, due_date = ?, updated_at = ? WHERE id = ?'
  ).run(client_id, currency, notes, due_date || null, iso(now), id);
}

const lineCount = (db, id) => db.prepare('SELECT COUNT(*) AS n FROM invoice_lines WHERE invoice_id = ?').get(id).n;

export function getLines(db, invoiceId) {
  return db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY position, id').all(invoiceId);
}

/**
 * An invoice with its lines and totals. Drafts compute totals live; anything
 * that has been sent reads the totals stored at send time and never recomputes.
 */
export function getInvoice(db, id) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!inv) return null;
  const lines = getLines(db, id);
  let totals;
  if (inv.status === 'draft') {
    totals = computeTotals(lines);
  } else {
    totals = {
      subtotal: inv.subtotal,
      taxTotal: inv.tax_total,
      total: inv.total,
      taxes: JSON.parse(inv.tax_breakdown || '[]'),
    };
  }
  const client = inv.status === 'draft' ? getClient(db, inv.client_id) : null;
  return { ...inv, lines, totals, client };
}

export function addLine(db, invoiceId, line) {
  requireDraft(db, invoiceId);
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM invoice_lines WHERE invoice_id = ?').get(invoiceId).p;
  return Number(
    db
      .prepare(
        `INSERT INTO invoice_lines (invoice_id, position, description, qty_milli, unit_price, tax_rate_bp)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(invoiceId, pos, line.description, line.qty_milli, line.unit_price, line.tax_rate_bp).lastInsertRowid
  );
}

function lineOwner(db, invoiceId, lineId) {
  const line = db.prepare('SELECT * FROM invoice_lines WHERE id = ? AND invoice_id = ?').get(lineId, invoiceId);
  if (!line) throw new InvoiceError('No such line.', 404);
  requireDraft(db, invoiceId);
  return line;
}

export function updateLine(db, invoiceId, lineId, line) {
  lineOwner(db, invoiceId, lineId);
  db.prepare('UPDATE invoice_lines SET description = ?, qty_milli = ?, unit_price = ?, tax_rate_bp = ? WHERE id = ?').run(
    line.description,
    line.qty_milli,
    line.unit_price,
    line.tax_rate_bp,
    lineId
  );
}

export function deleteLine(db, invoiceId, lineId) {
  lineOwner(db, invoiceId, lineId);
  db.prepare('DELETE FROM invoice_lines WHERE id = ?').run(lineId);
}

export function deleteInvoice(db, id) {
  requireDraft(db, id);
  db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
}

/**
 * Marks a draft sent: takes the next number for the local year, stamps the
 * issue and due dates, snapshots seller and client details, and stores the
 * totals. All in one BEGIN IMMEDIATE transaction, so two senders queue up
 * behind each other and a failure leaves no gap in the numbering.
 */
export function sendInvoice(db, id, now) {
  return db
    .transaction(() => {
      const inv = requireDraft(db, id);
      const lines = getLines(db, id);
      if (!lines.length) throw new InvoiceError('Add at least one line before sending.', 400);
      const s = getSettings(db);
      const client = getClient(db, inv.client_id);
      const issue = localDate(now, s.timezone);
      const due = inv.due_date || addDays(issue, s.payment_terms_days);
      if (due < issue) throw new InvoiceError('The due date is before today.', 400);
      const year = localYear(now, s.timezone);
      const number = nextNumber(db, year);
      const t = computeTotals(lines);
      db.prepare(
        `UPDATE invoices SET status = 'sent', number = @number, year = @year, issue_date = @issue, due_date = @due,
           seller_name = @seller_name, seller_email = @seller_email, seller_address = @seller_address,
           seller_tax_id = @seller_tax_id, seller_payment_details = @seller_payment_details,
           client_name = @client_name, client_email = @client_email, client_address = @client_address,
           client_tax_id = @client_tax_id, subtotal = @subtotal, tax_total = @tax_total, total = @total,
           tax_breakdown = @tax_breakdown, updated_at = @updated_at
         WHERE id = @id AND status = 'draft'`
      ).run({
        id,
        number,
        year,
        issue,
        due,
        seller_name: s.business_name,
        seller_email: s.business_email,
        seller_address: s.business_address,
        seller_tax_id: s.business_tax_id,
        seller_payment_details: s.payment_details,
        client_name: client.name,
        client_email: client.email,
        client_address: client.address,
        client_tax_id: client.tax_id,
        subtotal: t.subtotal,
        tax_total: t.taxTotal,
        total: t.total,
        tax_breakdown: JSON.stringify(t.taxes),
        updated_at: iso(now),
      });
      return number;
    })
    .immediate();
}

/** Full payment only: one paid date and an optional method. */
export function recordPayment(db, id, { paid_date, payment_method = '' }, now) {
  const inv = db.prepare('SELECT status FROM invoices WHERE id = ?').get(id);
  if (!inv) throw new InvoiceError('No such invoice.', 404);
  if (inv.status !== 'sent') throw new InvoiceError('Only a sent invoice can be marked paid.');
  db.prepare(
    "UPDATE invoices SET status = 'paid', paid_date = ?, payment_method = ?, updated_at = ? WHERE id = ?"
  ).run(paid_date, payment_method, iso(now), id);
}

export function voidInvoice(db, id, now) {
  const inv = db.prepare('SELECT status FROM invoices WHERE id = ?').get(id);
  if (!inv) throw new InvoiceError('No such invoice.', 404);
  if (inv.status !== 'sent' && inv.status !== 'paid') {
    throw new InvoiceError(inv.status === 'draft' ? 'A draft can be deleted instead.' : 'This invoice is already void.');
  }
  db.prepare("UPDATE invoices SET status = 'void', voided_at = ?, updated_at = ? WHERE id = ?").run(iso(now), iso(now), id);
}

/* ------------------------------------------------------------------ overdue */

/** Overdue is a label, never stored: sent, unpaid, and the due date is behind us. */
export function isOverdue(inv, today) {
  return inv.status === 'sent' && Boolean(inv.due_date) && inv.due_date < today;
}

export function today(db, now) {
  return localDate(now, getSettings(db).timezone);
}

/** Display label for a status, with overdue folded in. */
export function statusLabel(inv, todayDate) {
  return isOverdue(inv, todayDate) ? 'overdue' : inv.status;
}

export function listInvoices(db, { status } = {}) {
  const rows = db
    .prepare(
      `SELECT i.*, c.name AS current_client_name,
         (SELECT COUNT(*) FROM invoice_lines l WHERE l.invoice_id = i.id) AS line_count
       FROM invoices i JOIN clients c ON c.id = i.client_id
       ORDER BY CASE i.status WHEN 'draft' THEN 0 WHEN 'sent' THEN 1 WHEN 'paid' THEN 2 ELSE 3 END,
                i.issue_date DESC, i.id DESC`
    )
    .all();
  const withTotals = rows.map((r) => (r.status === 'draft' ? { ...r, total: computeTotals(getLines(db, r.id)).total } : r));
  return status ? withTotals.filter((r) => r.status === status) : withTotals;
}

/**
 * Dashboard numbers. Outstanding is sent and not yet due; overdue is sent
 * and past due. An invoice counts in exactly one of the two. Totals are
 * kept per currency, because adding yen to euros means nothing.
 */
export function dashboard(db, todayDate) {
  const all = listInvoices(db);
  const counts = { draft: 0, sent: 0, overdue: 0, paid: 0, void: 0 };
  const byCurrency = new Map();
  const bucket = (cur) => {
    if (!byCurrency.has(cur)) byCurrency.set(cur, { currency: cur, outstanding: 0, overdue: 0, outstandingCount: 0, overdueCount: 0 });
    return byCurrency.get(cur);
  };
  for (const inv of all) {
    const label = statusLabel(inv, todayDate);
    counts[label] += 1;
    if (label === 'overdue') {
      const b = bucket(inv.currency);
      b.overdue += inv.total;
      b.overdueCount += 1;
    } else if (label === 'sent') {
      const b = bucket(inv.currency);
      b.outstanding += inv.total;
      b.outstandingCount += 1;
    }
  }
  const totals = [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  return { counts, totals, invoices: all };
}
