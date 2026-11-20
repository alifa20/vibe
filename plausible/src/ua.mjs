/**
 * Browser, OS and device from a user-agent string, using a short regex table.
 * Order matters: the first match wins, so the more specific tokens come first
 * (Edge and Opera both also say "Chrome"; Chrome also says "Safari").
 */
import { isbot } from 'isbot';

const BROWSERS = [
  ['Edge', /\bEdg(?:e|A|iOS)?\//],
  ['Opera', /\bOPR\/|\bOpera\b/],
  ['Samsung Internet', /\bSamsungBrowser\//],
  ['Firefox', /\bFirefox\/|\bFxiOS\//],
  ['Chrome', /\bChrome\/|\bCriOS\//],
  ['Safari', /\bVersion\/[\d.]+.*\bSafari\//]
];

const SYSTEMS = [
  ['iOS', /\b(?:iPhone|iPad|iPod)\b/],
  ['Android', /\bAndroid\b/],
  ['Windows', /\bWindows\b/],
  ['ChromeOS', /\bCrOS\b/],
  ['macOS', /\bMac OS X\b|\bMacintosh\b/],
  ['Linux', /\bLinux\b/]
];

function first(table, ua) {
  for (const [name, re] of table) if (re.test(ua)) return name;
  return 'Other';
}

function deviceOf(ua) {
  if (/\biPad\b|\bTablet\b/i.test(ua)) return 'tablet';
  if (/\bAndroid\b/.test(ua) && !/\bMobile\b/.test(ua)) return 'tablet';
  if (/\bMobi|\biPhone\b|\biPod\b/.test(ua)) return 'mobile';
  return 'desktop';
}

export function parseUA(ua) {
  const value = String(ua || '');
  return { browser: first(BROWSERS, value), os: first(SYSTEMS, value), device: deviceOf(value) };
}

/** Empty user agents count as bots: every real browser sends one. */
export const isBotUA = (ua) => !ua || isbot(String(ua));
