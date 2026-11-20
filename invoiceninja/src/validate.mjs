/**
 * Form validation. Each validator takes a parsed urlencoded body and returns
 * { ok, values, errors }: `values` is safe to persist when ok, and is also
 * what the form re-renders with when it is not. Error keys match input names.
 */
import { isKnownCurrency, parseMoney, parseQuantity, parseTaxRate } from './money.mjs';
import { isValidTimeZone } from './numbering.mjs';

const MAX_SHORT = 200;
const MAX_LONG = 2000;

const str = (v) => (typeof v === 'string' ? v.trim() : Array.isArray(v) ? String(v.at(-1) ?? '').trim() : '');

function text(body, key, errors, { required = false, max = MAX_SHORT, label = 'This field' } = {}) {
  const value = str(body[key]);
  if (!value && required) errors[key] = `${label} is required.`;
  else if (value.length > max) errors[key] = `Keep this under ${max} characters.`;
  return value;
}

export function isIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function currency(body, key, errors) {
  const value = str(body[key]).toUpperCase();
  if (!isKnownCurrency(value)) errors[key] = 'Use a three-letter ISO currency code, like USD or EUR.';
  return value;
}

const done = (values, errors) => ({ ok: Object.keys(errors).length === 0, values, errors });

export function validateClient(body) {
  const errors = {};
  const values = {
    name: text(body, 'name', errors, { required: true, label: 'Name' }),
    email: text(body, 'email', errors),
    address: text(body, 'address', errors, { max: MAX_LONG }),
    tax_id: text(body, 'tax_id', errors),
  };
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.email = 'That does not look like an email address.';
  return done(values, errors);
}

export function validateSettings(body) {
  const errors = {};
  const values = {
    business_name: text(body, 'business_name', errors),
    business_email: text(body, 'business_email', errors),
    business_address: text(body, 'business_address', errors, { max: MAX_LONG }),
    business_tax_id: text(body, 'business_tax_id', errors),
    payment_details: text(body, 'payment_details', errors, { max: MAX_LONG }),
    default_currency: currency(body, 'default_currency', errors),
    payment_terms_days: str(body.payment_terms_days),
    page_size: str(body.page_size),
    timezone: str(body.timezone),
  };
  const terms = Number(values.payment_terms_days);
  if (!/^\d+$/.test(values.payment_terms_days) || terms > 365) {
    errors.payment_terms_days = 'Use a whole number of days from 0 to 365.';
  } else {
    values.payment_terms_days = terms;
  }
  if (!['A4', 'Letter'].includes(values.page_size)) errors.page_size = 'Choose A4 or Letter.';
  if (!isValidTimeZone(values.timezone)) errors.timezone = 'Use an IANA timezone, like Europe/Berlin.';
  return done(values, errors);
}

/** Invoice header: client, currency, optional due date, notes. */
export function validateInvoice(body, clientIds) {
  const errors = {};
  const clientId = Number(str(body.client_id));
  const values = {
    client_id: clientId,
    currency: currency(body, 'currency', errors),
    due_date: str(body.due_date),
    notes: text(body, 'notes', errors, { max: MAX_LONG }),
  };
  if (!clientIds.includes(clientId)) errors.client_id = 'Choose a client.';
  if (values.due_date && !isIsoDate(values.due_date)) errors.due_date = 'Use a date like 2026-12-31.';
  if (!values.due_date) values.due_date = null;
  return done(values, errors);
}

/**
 * One line item. `raw` keeps what was typed so a failed form shows it back;
 * the parsed integers go to the database.
 */
export function validateLine(body, cur) {
  const errors = {};
  const raw = {
    description: text(body, 'description', errors, { required: true, max: 500, label: 'Description' }),
    quantity: str(body.quantity),
    unit_price: str(body.unit_price),
    tax_rate: str(body.tax_rate) || '0',
  };
  const qty = parseQuantity(raw.quantity);
  const price = parseMoney(raw.unit_price, cur);
  const rate = parseTaxRate(raw.tax_rate);
  if (qty === null) errors.quantity = 'Enter a number.';
  else if (qty < 0) errors.quantity = 'Quantity cannot be negative.';
  if (price === null) errors.unit_price = 'Enter an amount.';
  else if (price < 0) errors.unit_price = 'Unit price cannot be negative.';
  if (rate === null) errors.tax_rate = 'Enter a percentage.';
  else if (rate < 0 || rate > 10000) errors.tax_rate = 'Tax rate must be between 0 and 100%.';
  return {
    ...done({ description: raw.description, qty_milli: qty, unit_price: price, tax_rate_bp: rate }, errors),
    raw,
  };
}

export function validatePayment(body, issueDate) {
  const errors = {};
  const values = {
    paid_date: str(body.paid_date),
    payment_method: text(body, 'payment_method', errors),
  };
  if (!isIsoDate(values.paid_date)) errors.paid_date = 'Use a date like 2026-12-31.';
  else if (issueDate && values.paid_date < issueDate) errors.paid_date = 'The payment date is before the issue date.';
  return done(values, errors);
}
