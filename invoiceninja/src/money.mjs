/**
 * Exact money. Every amount is an integer count of the currency's minor unit
 * (cents, yen, fils). Quantities are stored x1000 and tax rates in basis
 * points, so nothing here ever touches a binary float. Intermediate products
 * go through BigInt so large invoices cannot lose precision either.
 */

export const QTY_SCALE = 1000; // 1.5 hours -> 1500
export const RATE_SCALE = 10000; // 10% -> 1000 basis points

const KNOWN = new Set(Intl.supportedValuesOf('currency'));

export function isKnownCurrency(code) {
  return typeof code === 'string' && KNOWN.has(code);
}

/** Digits after the decimal point for a currency: USD 2, JPY 0, KWD 3. */
export function currencyExponent(code) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).resolvedOptions()
    .maximumFractionDigits;
}

/** Integer division rounded half away from zero. Accepts numbers or BigInts, returns a number. */
export function roundDiv(n, d) {
  let num = BigInt(n);
  let den = BigInt(d);
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const neg = num < 0n;
  const abs = neg ? -num : num;
  const q = (abs * 2n + den) / (den * 2n);
  return Number(neg ? -q : q);
}

/**
 * Parses a human decimal ("1,234.50") into an integer scaled by 10^scale.
 * Extra digits beyond the scale are rounded half away from zero.
 * Returns null for anything that is not a plain decimal number.
 */
export function parseDecimal(input, scale) {
  if (input === null || input === undefined) return null;
  const text = String(input).trim().replace(/[,\s_]/g, '');
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m) return null;
  const [, sign, int = '', frac = ''] = m;
  if (!int && !frac) return null;
  let value;
  if (frac.length <= scale) {
    value = BigInt((int || '0') + frac.padEnd(scale, '0'));
  } else {
    value = BigInt(roundDiv(BigInt((int || '0') + frac), 10n ** BigInt(frac.length - scale)));
  }
  if (sign === '-') value = -value;
  const out = Number(value);
  return Number.isSafeInteger(out) ? out : null;
}

export const parseMoney = (input, currency) => parseDecimal(input, currencyExponent(currency));
export const parseQuantity = (input) => parseDecimal(input, 3);
export const parseTaxRate = (input) => parseDecimal(input, 2);

/** Net amount of one line, in minor units. */
export function lineNet(qtyMilli, unitPrice) {
  return roundDiv(BigInt(qtyMilli) * BigInt(unitPrice), QTY_SCALE);
}

/**
 * Totals for a set of lines. Tax is computed once per distinct rate on the
 * summed net of that rate, never per line, then rounded half away from zero.
 */
export function computeTotals(lines) {
  const byRate = new Map();
  let subtotal = 0n;
  for (const line of lines) {
    const net = BigInt(lineNet(line.qty_milli, line.unit_price));
    subtotal += net;
    byRate.set(line.tax_rate_bp, (byRate.get(line.tax_rate_bp) ?? 0n) + net);
  }
  const taxes = [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rateBp, net]) => ({ rateBp, net: Number(net), tax: roundDiv(net * BigInt(rateBp), RATE_SCALE) }));
  const taxTotal = taxes.reduce((sum, t) => sum + t.tax, 0);
  return { subtotal: Number(subtotal), taxTotal, total: Number(subtotal) + taxTotal, taxes };
}

/** Integer scaled by 10^scale -> plain decimal string ("12.345", "-0.05"). */
export function toDecimalString(value, scale, { trim = false } = {}) {
  const neg = value < 0;
  const digits = String(Math.abs(value)).padStart(scale + 1, '0');
  let int = digits.slice(0, digits.length - scale);
  let frac = scale ? digits.slice(-scale) : '';
  if (trim) frac = frac.replace(/0+$/, '');
  return (neg ? '-' : '') + int + (frac ? `.${frac}` : '');
}

/** Formats minor units as currency. Intl gets a decimal string, so the output is exact. */
export function formatMoney(minor, currency) {
  const str = toDecimalString(minor, currencyExponent(currency));
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(str);
}

/** Minor units as a plain input value, e.g. 3333 USD -> "33.33". */
export const moneyInput = (minor, currency) => toDecimalString(minor, currencyExponent(currency));
export const formatQuantity = (milli) => toDecimalString(milli, 3, { trim: true });
export const formatTaxRate = (bp) => toDecimalString(bp, 2, { trim: true });
