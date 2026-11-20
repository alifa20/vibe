import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  currencyExponent,
  isKnownCurrency,
  parseDecimal,
  parseMoney,
  parseQuantity,
  parseTaxRate,
  lineNet,
  computeTotals,
  formatMoney,
  formatQuantity,
  formatTaxRate,
  roundDiv,
} from '../src/money.mjs';

test('currency exponents come from Intl', () => {
  assert.equal(currencyExponent('USD'), 2);
  assert.equal(currencyExponent('JPY'), 0);
  assert.equal(currencyExponent('KWD'), 3);
});

test('only ISO currencies Intl knows are accepted', () => {
  assert.equal(isKnownCurrency('EUR'), true);
  assert.equal(isKnownCurrency('XYZ'), false);
  assert.equal(isKnownCurrency('usd'), false);
  assert.equal(isKnownCurrency(''), false);
});

test('roundDiv rounds half away from zero', () => {
  assert.equal(roundDiv(5, 10), 1);
  assert.equal(roundDiv(4, 10), 0);
  assert.equal(roundDiv(15, 10), 2);
  assert.equal(roundDiv(-15, 10), -2);
  assert.equal(roundDiv(-14, 10), -1);
  assert.equal(roundDiv(25, 10), 3);
});

test('parseDecimal is exact and never goes through floats', () => {
  assert.equal(parseDecimal('33.33', 2), 3333);
  assert.equal(parseDecimal('0.1', 2), 10);
  assert.equal(parseDecimal('1,234.50', 2), 123450);
  assert.equal(parseDecimal('120', 2), 12000);
  assert.equal(parseDecimal('-2.5', 1), -25);
  assert.equal(parseDecimal('abc', 2), null);
  assert.equal(parseDecimal('', 2), null);
  assert.equal(parseDecimal('1.2.3', 2), null);
});

test('money is stored in minor units for the currency', () => {
  assert.equal(parseMoney('33.33', 'USD'), 3333);
  assert.equal(parseMoney('333', 'JPY'), 333);
  assert.equal(parseMoney('1.234', 'KWD'), 1234);
});

test('quantity is stored x1000 and tax rate in basis points', () => {
  assert.equal(parseQuantity('1.5'), 1500);
  assert.equal(parseQuantity('3'), 3000);
  assert.equal(parseTaxRate('10'), 1000);
  assert.equal(parseTaxRate('7.25'), 725);
});

test('1.5 hours at 120.00 is 180.00', () => {
  assert.equal(lineNet(parseQuantity('1.5'), parseMoney('120.00', 'USD')), 18000);
});

test('tax is computed once per rate per invoice, rounded half away from zero', () => {
  const lines = [
    { qty_milli: 3000, unit_price: 3333, tax_rate_bp: 1000 },
    { qty_milli: 1000, unit_price: 1, tax_rate_bp: 1000 },
  ];
  const t = computeTotals(lines);
  assert.equal(t.subtotal, 10000);
  assert.equal(t.taxTotal, 1000);
  assert.equal(t.total, 11000);
  assert.deepEqual(t.taxes, [{ rateBp: 1000, net: 10000, tax: 1000 }]);
});

test('per-rate rounding differs from per-line rounding', () => {
  // Three lines of 0.05 at 10%: per line each tax is 0.005 -> 0.01, total 0.03.
  // Per rate: 0.15 at 10% = 0.015 -> 0.02.
  const lines = Array.from({ length: 3 }, () => ({ qty_milli: 1000, unit_price: 5, tax_rate_bp: 1000 }));
  assert.equal(computeTotals(lines).taxTotal, 2);
});

test('several rates get one row each, ordered by rate', () => {
  const t = computeTotals([
    { qty_milli: 1000, unit_price: 1000, tax_rate_bp: 2000 },
    { qty_milli: 1000, unit_price: 500, tax_rate_bp: 0 },
    { qty_milli: 2000, unit_price: 250, tax_rate_bp: 2000 },
  ]);
  assert.deepEqual(t.taxes, [
    { rateBp: 0, net: 500, tax: 0 },
    { rateBp: 2000, net: 1500, tax: 300 },
  ]);
  assert.equal(t.total, 2300);
});

test('a JPY invoice of 3 x 333 stores 999 with exponent 0', () => {
  const t = computeTotals([{ qty_milli: parseQuantity('3'), unit_price: parseMoney('333', 'JPY'), tax_rate_bp: 0 }]);
  assert.equal(t.total, 999);
  assert.equal(formatMoney(999, 'JPY'), '¥999');
});

test('a KWD amount keeps three decimals', () => {
  const minor = parseMoney('12.345', 'KWD');
  assert.equal(minor, 12345);
  assert.match(formatMoney(minor, 'KWD'), /12\.345/);
});

test('formatting is exact for large and negative amounts', () => {
  assert.equal(formatMoney(123456789012, 'USD'), '$1,234,567,890.12');
  assert.equal(formatMoney(-5, 'USD'), '-$0.05');
  assert.equal(formatQuantity(1500), '1.5');
  assert.equal(formatQuantity(3000), '3');
  assert.equal(formatTaxRate(725), '7.25');
  assert.equal(formatTaxRate(1000), '10');
});
