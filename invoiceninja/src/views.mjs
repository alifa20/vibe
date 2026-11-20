/**
 * Server-rendered pages. Every interpolated value is HTML-escaped unless it is
 * itself an html`` result, so client names, notes and line descriptions can
 * never inject markup. No page carries a style="" attribute or an inline
 * script; all styling lives in /static/*.css under a strict CSP.
 */
import { formatMoney, formatQuantity, formatTaxRate, lineNet, moneyInput } from './money.mjs';
import { statusLabel } from './invoices.mjs';

const RAW = Symbol('raw-html');

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const raw = (value) => ({ [RAW]: true, value: String(value) });

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (typeof value === 'object' && value[RAW]) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += render(values[i]) + strings[i + 1];
  return raw(out);
}

export const toString = (value) => render(value);

/* ------------------------------------------------------------------ chrome */

function layout(title, body, { authed = true, active = '' } = {}) {
  const link = (href, label, key) => html`<a href="${href}"${key === active ? raw(' aria-current="page"') : ''}>${label}</a>`;
  return toString(html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} · invoices</title>
<link rel="stylesheet" href="/static/app.css">
</head>
<body>
<header class="top">
  <a class="brand" href="/">invoices</a>
  ${authed
    ? html`<nav>
    ${link('/', 'Dashboard', 'dashboard')}
    ${link('/invoices/new', 'New invoice', 'new')}
    ${link('/clients', 'Clients', 'clients')}
    ${link('/settings', 'Settings', 'settings')}
    <form method="post" action="/logout" class="inline"><button type="submit" class="link">Log out</button></form>
  </nav>`
    : ''}
</header>
<main>
${body}
</main>
</body>
</html>`);
}

function fieldError(errors, name) {
  return errors?.[name] ? html`<span class="error" id="${name}-error">${errors[name]}</span>` : '';
}

function input(name, label, value, errors, { type = 'text', required = false, hint = '', attrs = '' } = {}) {
  const invalid = errors?.[name] ? raw(` aria-invalid="true" aria-describedby="${name}-error"`) : '';
  return html`<label class="field${errors?.[name] ? ' has-error' : ''}"><span>${label}</span>
    <input type="${type}" name="${name}" value="${value ?? ''}"${required ? raw(' required') : ''}${invalid}${raw(attrs ? ` ${attrs}` : '')}>
    ${hint ? html`<small>${hint}</small>` : ''}${fieldError(errors, name)}</label>`;
}

function textarea(name, label, value, errors, { rows = 3 } = {}) {
  return html`<label class="field${errors?.[name] ? ' has-error' : ''}"><span>${label}</span>
    <textarea name="${name}" rows="${rows}">${value ?? ''}</textarea>${fieldError(errors, name)}</label>`;
}

function select(name, label, options, selected, errors) {
  return html`<label class="field${errors?.[name] ? ' has-error' : ''}"><span>${label}</span>
    <select name="${name}">${options.map(
      ([value, text]) => html`<option value="${value}"${String(value) === String(selected) ? raw(' selected') : ''}>${text}</option>`
    )}</select>${fieldError(errors, name)}</label>`;
}

const badge = (label) => html`<span class="badge badge-${label}">${label}</span>`;

function multiline(text) {
  return String(text ?? '')
    .split('\n')
    .map((line, i) => html`${i ? raw('<br>') : ''}${line}`);
}

function formErrorSummary(errors) {
  return errors && Object.keys(errors).length
    ? html`<p class="notice notice-error" role="alert">Please fix the highlighted fields. Nothing was saved.</p>`
    : '';
}

export function errorPage(status, message, { authed = true } = {}) {
  return layout(`Error ${status}`, html`<h1>${status === 404 ? 'Not found' : 'Something is off'}</h1><p>${message}</p><p><a href="/">Back to the dashboard</a></p>`, { authed });
}

/* ------------------------------------------------------------------- login */

export function loginPage({ error = '', next = '/' } = {}) {
  return layout(
    'Sign in',
    html`<section class="card narrow">
  <h1>Sign in</h1>
  ${error ? html`<p class="notice notice-error" role="alert">${error}</p>` : ''}
  <form method="post" action="/login">
    <input type="hidden" name="next" value="${next}">
    <label class="field"><span>Admin password</span><input type="password" name="password" autocomplete="current-password" required autofocus></label>
    <button type="submit">Sign in</button>
  </form>
</section>`,
    { authed: false }
  );
}

/* --------------------------------------------------------------- dashboard */

function invoiceRows(list, today) {
  return list.map((inv) => {
    const label = statusLabel(inv, today);
    return html`<tr>
      <td><a href="/invoices/${inv.id}">${inv.number || `Draft #${inv.id}`}</a></td>
      <td>${inv.client_name || inv.current_client_name}</td>
      <td>${inv.issue_date || '—'}</td>
      <td>${inv.due_date || '—'}</td>
      <td>${badge(label)}</td>
      <td class="num">${formatMoney(inv.total ?? 0, inv.currency)}</td>
    </tr>`;
  });
}

export function dashboardPage({ dash, today }) {
  const groups = [
    ['overdue', 'Overdue'],
    ['sent', 'Sent, awaiting payment'],
    ['draft', 'Drafts'],
    ['paid', 'Paid'],
    ['void', 'Void'],
  ];
  const byLabel = Object.fromEntries(groups.map(([k]) => [k, []]));
  for (const inv of dash.invoices) byLabel[statusLabel(inv, today)].push(inv);

  return layout(
    'Dashboard',
    html`<h1>Dashboard</h1>
<section class="card">
  <h2>Money owed</h2>
  ${dash.totals.length
    ? html`<table class="data totals-by-currency">
    <thead><tr><th>Currency</th><th class="num">Outstanding</th><th class="num">Overdue</th></tr></thead>
    <tbody>${dash.totals.map(
      (t) => html`<tr data-currency="${t.currency}">
        <td>${t.currency}</td>
        <td class="num outstanding">${formatMoney(t.outstanding, t.currency)} <small>(${t.outstandingCount})</small></td>
        <td class="num overdue">${formatMoney(t.overdue, t.currency)} <small>(${t.overdueCount})</small></td>
      </tr>`
    )}</tbody>
  </table>
  <p class="muted">Outstanding is sent and not yet due. Overdue is sent and past its due date. Each invoice counts in one column only. Today is ${today}.</p>`
    : html`<p class="muted">Nothing is owed right now.</p>`}
</section>
${groups.map(([key, title]) =>
  byLabel[key].length
    ? html`<section class="card" id="status-${key}">
  <h2>${title} <small>${byLabel[key].length}</small></h2>
  <table class="data">
    <thead><tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Due</th><th>Status</th><th class="num">Total</th></tr></thead>
    <tbody>${invoiceRows(byLabel[key], today)}</tbody>
  </table>
</section>`
    : ''
)}
${dash.invoices.length ? '' : html`<section class="card"><p>No invoices yet. <a href="/clients">Add a client</a>, then <a href="/invoices/new">create an invoice</a>.</p></section>`}`,
    { active: 'dashboard' }
  );
}

/* ----------------------------------------------------------------- clients */

function clientFields(values, errors) {
  return html`${input('name', 'Name', values.name, errors, { required: true })}
    ${input('email', 'Email', values.email, errors, { type: 'email' })}
    ${textarea('address', 'Address', values.address, errors)}
    ${input('tax_id', 'Tax ID', values.tax_id, errors)}`;
}

export function clientsPage({ clients, values = {}, errors = null, notice = '' }) {
  return layout(
    'Clients',
    html`<h1>Clients</h1>
${notice ? html`<p class="notice">${notice}</p>` : ''}
<section class="card">
  ${clients.length
    ? html`<table class="data">
    <thead><tr><th>Name</th><th>Email</th><th class="num">Invoices</th><th></th></tr></thead>
    <tbody>${clients.map(
      (c) => html`<tr><td>${c.name}</td><td>${c.email}</td><td class="num">${c.invoice_count}</td>
        <td class="actions"><a href="/clients/${c.id}/edit">Edit</a></td></tr>`
    )}</tbody>
  </table>`
    : html`<p class="muted">No clients yet.</p>`}
</section>
<section class="card">
  <h2>Add a client</h2>
  ${formErrorSummary(errors)}
  <form method="post" action="/clients" class="stack">
    ${clientFields(values, errors)}
    <button type="submit">Add client</button>
  </form>
</section>`,
    { active: 'clients' }
  );
}

export function clientEditPage({ client, values, errors = null, canDelete }) {
  return layout(
    `Edit ${client.name}`,
    html`<h1>Edit client</h1>
<section class="card">
  <p class="muted">Changes apply to drafts. Invoices already sent keep the details they were sent with.</p>
  ${formErrorSummary(errors)}
  <form method="post" action="/clients/${client.id}" class="stack">
    ${clientFields(values, errors)}
    <button type="submit">Save client</button>
  </form>
</section>
${canDelete
  ? html`<section class="card"><form method="post" action="/clients/${client.id}/delete"><button type="submit" class="danger">Delete client</button></form></section>`
  : ''}`,
    { active: 'clients' }
  );
}

/* ---------------------------------------------------------------- settings */

export function settingsPage({ values, errors = null, saved = false }) {
  return layout(
    'Settings',
    html`<h1>Settings</h1>
${saved ? html`<p class="notice">Settings saved.</p>` : ''}
${formErrorSummary(errors)}
<form method="post" action="/settings" class="card stack">
  <h2>Your business</h2>
  <p class="muted">Printed on every invoice. Sent invoices keep the details they were sent with.</p>
  ${input('business_name', 'Business name', values.business_name, errors)}
  ${input('business_email', 'Email', values.business_email, errors)}
  ${textarea('business_address', 'Address', values.business_address, errors)}
  ${input('business_tax_id', 'Tax ID', values.business_tax_id, errors)}
  ${textarea('payment_details', 'Payment details', values.payment_details, errors)}
  <h2>Defaults</h2>
  ${input('default_currency', 'Default currency', values.default_currency, errors, { hint: 'ISO code, e.g. USD, EUR, JPY', attrs: 'maxlength="3"' })}
  ${input('payment_terms_days', 'Payment terms (days)', values.payment_terms_days, errors, { type: 'number', attrs: 'min="0" max="365"' })}
  ${select('page_size', 'Paper size for printing', [['A4', 'A4'], ['Letter', 'Letter']], values.page_size, errors)}
  ${input('timezone', 'Timezone', values.timezone, errors, { hint: 'Sets the issue date, the numbering year and when an invoice becomes overdue.' })}
  <button type="submit">Save settings</button>
</form>`,
    { active: 'settings' }
  );
}

/* ---------------------------------------------------------------- invoices */

function headerFields(values, clients, errors) {
  return html`${select('client_id', 'Client', [['', 'Choose…'], ...clients.map((c) => [c.id, c.name])], values.client_id, errors)}
    ${input('currency', 'Currency', values.currency, errors, { attrs: 'maxlength="3"', hint: 'Fixed once lines are added.' })}
    ${input('due_date', 'Due date', values.due_date, errors, { type: 'date', hint: 'Leave empty to use your payment terms from the send date.' })}
    ${textarea('notes', 'Notes', values.notes, errors)}`;
}

export function invoiceNewPage({ clients, values, errors = null }) {
  return layout(
    'New invoice',
    html`<h1>New invoice</h1>
${clients.length
  ? html`<section class="card">
  ${formErrorSummary(errors)}
  <form method="post" action="/invoices" class="stack">
    ${headerFields(values, clients, errors)}
    <button type="submit">Create draft</button>
  </form>
</section>`
  : html`<section class="card"><p>Add a <a href="/clients">client</a> first.</p></section>`}`,
    { active: 'new' }
  );
}

export function totalsTable(totals, currency) {
  return html`<table class="totals">
  <tbody>
    <tr><th scope="row">Subtotal</th><td class="num">${formatMoney(totals.subtotal, currency)}</td></tr>
    ${totals.taxes
      .filter((t) => t.rateBp > 0)
      .map(
        (t) => html`<tr class="tax-row"><th scope="row">Tax ${formatTaxRate(t.rateBp)}% <small>on ${formatMoney(t.net, currency)}</small></th>
        <td class="num">${formatMoney(t.tax, currency)}</td></tr>`
      )}
    <tr class="grand"><th scope="row">Total</th><td class="num">${formatMoney(totals.total, currency)}</td></tr>
  </tbody>
</table>`;
}

function linesHead() {
  return html`<thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Tax</th><th class="num">Amount</th></tr></thead>`;
}

function lineCells(l, currency) {
  return html`<td>${multiline(l.description)}</td>
    <td class="num">${formatQuantity(l.qty_milli)}</td>
    <td class="num">${formatMoney(l.unit_price, currency)}</td>
    <td class="num">${formatTaxRate(l.tax_rate_bp)}%</td>
    <td class="num">${formatMoney(lineNet(l.qty_milli, l.unit_price), currency)}</td>`;
}

function lineFields(raw_, errors) {
  return html`<div class="line-grid">
    ${input('description', 'Description', raw_.description, errors, { required: true })}
    ${input('quantity', 'Quantity', raw_.quantity, errors, { attrs: 'inputmode="decimal"', required: true })}
    ${input('unit_price', 'Unit price', raw_.unit_price, errors, { attrs: 'inputmode="decimal"', required: true })}
    ${input('tax_rate', 'Tax %', raw_.tax_rate, errors, { attrs: 'inputmode="decimal"' })}
  </div>`;
}

export function invoiceEditPage({ inv, clients, header = null, headerErrors = null, line = null, lineErrors = null }) {
  const headerValues = header || { client_id: inv.client_id, currency: inv.currency, due_date: inv.due_date || '', notes: inv.notes };
  const lineRaw = line || { description: '', quantity: '1', unit_price: '', tax_rate: '0' };
  return layout(
    `Draft #${inv.id}`,
    html`<h1>Draft #${inv.id} ${badge('draft')}</h1>
<p class="muted">Drafts have no number yet. The number is assigned when you mark the invoice sent.</p>
<section class="card">
  <h2>Lines</h2>
  ${inv.lines.length
    ? html`<table class="data lines">
    ${linesHead()}
    <tbody>${inv.lines.map(
      (l) => html`<tr>${lineCells(l, inv.currency)}
        <td class="actions"><a href="/invoices/${inv.id}/lines/${l.id}/edit">Edit</a>
          <form method="post" action="/invoices/${inv.id}/lines/${l.id}/delete" class="inline"><button type="submit" class="link danger">Remove</button></form></td></tr>`
    )}</tbody>
  </table>
  ${totalsTable(inv.totals, inv.currency)}`
    : html`<p class="muted">No lines yet.</p>`}
  <h3>Add a line</h3>
  ${formErrorSummary(lineErrors)}
  <form method="post" action="/invoices/${inv.id}/lines" class="stack">
    ${lineFields(lineRaw, lineErrors)}
    <button type="submit">Add line</button>
  </form>
</section>
<section class="card">
  <h2>Details</h2>
  ${formErrorSummary(headerErrors)}
  <form method="post" action="/invoices/${inv.id}" class="stack">
    ${headerFields(headerValues, clients, headerErrors)}
    <button type="submit">Save details</button>
  </form>
</section>
<section class="card actions-row">
  <a class="button" href="/invoices/${inv.id}/print">Preview / print</a>
  ${inv.lines.length ? html`<a class="button primary" href="/invoices/${inv.id}/send">Mark sent…</a>` : ''}
  <a class="button danger" href="/invoices/${inv.id}/delete">Delete draft…</a>
</section>`
  );
}

export function lineEditPage({ inv, lineId, raw: lineRaw, errors = null }) {
  return layout(
    'Edit line',
    html`<h1>Edit line on draft #${inv.id}</h1>
<section class="card">
  ${formErrorSummary(errors)}
  <form method="post" action="/invoices/${inv.id}/lines/${lineId}" class="stack">
    ${lineFields(lineRaw, errors)}
    <button type="submit">Save line</button> <a href="/invoices/${inv.id}">Cancel</a>
  </form>
</section>`
  );
}

export const lineToRaw = (l, currency) => ({
  description: l.description,
  quantity: formatQuantity(l.qty_milli),
  unit_price: moneyInput(l.unit_price, currency),
  tax_rate: formatTaxRate(l.tax_rate_bp),
});

/** Read-only view of anything that has left draft. No edit or delete controls. */
export function invoiceViewPage({ inv, today, notice = '' }) {
  const label = statusLabel(inv, today);
  return layout(
    inv.number,
    html`<h1>${inv.number} ${badge(label)}</h1>
${notice ? html`<p class="notice">${notice}</p>` : ''}
<p class="muted">Status: <strong class="status-text">${label}</strong>. This invoice is frozen: its lines, totals and details cannot change.</p>
<section class="card">
  <dl class="meta">
    <dt>Client</dt><dd>${inv.client_name}</dd>
    <dt>Issued</dt><dd>${inv.issue_date}</dd>
    <dt>Due</dt><dd>${inv.due_date}</dd>
    ${inv.paid_date ? html`<dt>Paid</dt><dd>${inv.paid_date}${inv.payment_method ? html` · ${inv.payment_method}` : ''}</dd>` : ''}
    ${inv.voided_at ? html`<dt>Voided</dt><dd>${inv.voided_at.slice(0, 10)}</dd>` : ''}
  </dl>
  <table class="data lines">${linesHead()}<tbody>${inv.lines.map((l) => html`<tr>${lineCells(l, inv.currency)}</tr>`)}</tbody></table>
  ${totalsTable(inv.totals, inv.currency)}
</section>
<section class="card actions-row">
  <a class="button" href="/invoices/${inv.id}/print">Print / PDF</a>
  ${inv.status === 'sent' ? html`<a class="button primary" href="/invoices/${inv.id}/pay">Record payment…</a>` : ''}
  ${inv.status === 'sent' || inv.status === 'paid' ? html`<a class="button danger" href="/invoices/${inv.id}/void">Void…</a>` : ''}
</section>`
  );
}

/* ----------------------------------------------------------- confirmations */

const CONFIRM = {
  send: {
    title: 'Mark as sent',
    button: 'Mark sent',
    body: 'This assigns the next invoice number, sets today as the issue date, and freezes the invoice. After this, its lines, totals, your business details and the client details on it cannot be edited, and it cannot be deleted. To correct a sent invoice you void it and create a new one.',
  },
  void: {
    title: 'Void invoice',
    button: 'Void permanently',
    body: 'Voiding is permanent. The invoice keeps its number so the sequence has no gap, but it no longer counts as owed. It cannot be un-voided.',
  },
  delete: {
    title: 'Delete draft',
    button: 'Delete draft',
    body: 'This deletes the draft and its lines. Drafts have no number, so nothing is skipped in the sequence.',
  },
  pay: {
    title: 'Record payment',
    button: 'Mark paid',
    body: 'Records the invoice as paid in full. Partial payments are not tracked.',
  },
};

export function confirmPage({ inv, action, values = {}, errors = null }) {
  const c = CONFIRM[action];
  const name = inv.number || `Draft #${inv.id}`;
  const total = formatMoney(inv.totals.total, inv.currency);
  return layout(
    c.title,
    html`<h1>${c.title}: ${name}</h1>
<section class="card narrow">
  <p><strong>${inv.client_name || inv.client?.name}</strong> · ${total}</p>
  <p>${c.body}</p>
  ${formErrorSummary(errors)}
  <form method="post" action="/invoices/${inv.id}/${action}" class="stack">
    ${action === 'pay'
      ? html`${input('paid_date', 'Paid on', values.paid_date, errors, { type: 'date', required: true })}
        ${input('payment_method', 'Method (optional)', values.payment_method, errors, { hint: 'e.g. bank transfer' })}`
      : ''}
    <div class="actions-row">
      <button type="submit" class="${action === 'void' || action === 'delete' ? 'danger' : 'primary'}">${c.button}</button>
      <a href="/invoices/${inv.id}">Cancel</a>
    </div>
  </form>
</section>`
  );
}

/* ------------------------------------------------------------------- print */

/** Seller and client details: the frozen snapshot once sent, live values for a draft. */
export function partiesFor(inv, settings) {
  if (inv.status === 'draft') {
    const c = inv.client || {};
    return {
      seller: { name: settings.business_name, email: settings.business_email, address: settings.business_address, tax_id: settings.business_tax_id, payment: settings.payment_details },
      client: { name: c.name, email: c.email, address: c.address, tax_id: c.tax_id },
    };
  }
  return {
    seller: { name: inv.seller_name, email: inv.seller_email, address: inv.seller_address, tax_id: inv.seller_tax_id, payment: inv.seller_payment_details },
    client: { name: inv.client_name, email: inv.client_email, address: inv.client_address, tax_id: inv.client_tax_id },
  };
}

function party(p) {
  return html`<p class="party-name">${p.name}</p>
    ${p.address ? html`<p>${multiline(p.address)}</p>` : ''}
    ${p.email ? html`<p>${p.email}</p>` : ''}
    ${p.tax_id ? html`<p>Tax ID: ${p.tax_id}</p>` : ''}`;
}

export function printPage({ inv, settings, today }) {
  const { seller, client } = partiesFor(inv, settings);
  const pageCss = settings.page_size === 'Letter' ? 'page-letter.css' : 'page-a4.css';
  const label = statusLabel(inv, today);
  const stamp = { draft: 'DRAFT', void: 'VOID', paid: 'PAID' }[inv.status];
  const title = inv.number ? `Invoice ${inv.number}` : `Draft invoice #${inv.id}`;
  return toString(html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<link rel="stylesheet" href="/static/print.css">
<link rel="stylesheet" href="/static/${pageCss}">
</head>
<body class="print">
<div class="print-bar">
  <a href="/invoices/${inv.id}">← Back</a>
  <button type="button" id="print-button">Print or save as PDF</button>
  <p class="print-hint">In the print dialog, choose “Save as PDF” and turn off <strong>Headers and footers</strong> so the browser does not stamp its own URL, date and page title on each page. Paper size: ${settings.page_size}.</p>
</div>
<article class="sheet">
  <header class="sheet-head">
    <div class="seller">${party(seller)}</div>
    <div class="doc-meta">
      <h1>Invoice</h1>
      ${stamp ? html`<p class="stamp stamp-${inv.status}">${stamp}</p>` : ''}
      <dl>
        ${inv.number ? html`<dt>Number</dt><dd class="invoice-number">${inv.number}</dd>` : ''}
        <dt>Issued</dt><dd>${inv.issue_date || 'not yet sent'}</dd>
        <dt>Due</dt><dd>${inv.due_date || 'on sending'}</dd>
        ${inv.paid_date ? html`<dt>Paid</dt><dd>${inv.paid_date}</dd>` : ''}
        ${label === 'overdue' ? html`<dt>Status</dt><dd>Overdue</dd>` : ''}
      </dl>
    </div>
  </header>
  <section class="bill-to">
    <h2>Bill to</h2>
    ${party(client)}
  </section>
  <table class="lines">
    ${linesHead()}
    <tbody>${inv.lines.map((l) => html`<tr>${lineCells(l, inv.currency)}</tr>`)}</tbody>
  </table>
  ${totalsTable(inv.totals, inv.currency)}
  ${inv.notes ? html`<section class="notes"><h2>Notes</h2><p>${multiline(inv.notes)}</p></section>` : ''}
  ${seller.payment ? html`<section class="notes"><h2>How to pay</h2><p>${multiline(seller.payment)}</p></section>` : ''}
  <p class="currency-note">Amounts in ${inv.currency}.</p>
</article>
<script src="/static/print.js"></script>
</body>
</html>`);
}
