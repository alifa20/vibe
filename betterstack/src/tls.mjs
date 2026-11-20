import net from 'node:net';
import tls from 'node:tls';

export const TLS_THRESHOLDS = [14, 7, 1];
const DAY = 86_400_000;

/**
 * Pure threshold logic. `warned` is the smallest threshold already emailed
 * for the current certificate (null for none). Returns the threshold to warn
 * about now (or null) and the new `warned` value. Each of 14, 7 and 1 days
 * fires at most once; a certificate with more than 14 days left resets it.
 */
export function tlsWarningDue(expiresAt, now, warned) {
  const daysLeft = (expiresAt - now) / DAY;
  if (daysLeft > TLS_THRESHOLDS[0]) return { threshold: null, warned: null };
  const threshold = Math.min(...TLS_THRESHOLDS.filter((t) => daysLeft <= t));
  if (warned === null || warned === undefined || threshold < warned) return { threshold, warned: threshold };
  return { threshold: null, warned };
}

/**
 * Opens a TLS connection and reads the peer certificate's expiry. Resolves
 * { validTo } in epoch ms, rejects on connection or handshake errors. The
 * chain is not verified here: the HTTP check already fails on a bad chain,
 * and this probe only cares about the expiry date.
 */
export function probeTls(url, { timeoutMs = 10_000, host } = {}) {
  const u = new URL(url);
  const hostname = u.hostname.replace(/^\[|\]$/g, '');
  const port = Number(u.port || 443);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: host || hostname,
      port,
      servername: net.isIP(hostname) ? undefined : hostname,
      rejectUnauthorized: false,
    });
    const fail = (err) => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error(`TLS timeout after ${timeoutMs / 1000}s`)));
    socket.once('error', fail);
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      const validTo = Date.parse(cert?.valid_to ?? '');
      if (!Number.isFinite(validTo)) return reject(new Error('No certificate expiry in the TLS handshake'));
      resolve({ validTo });
    });
  });
}

/**
 * Returns a hook for the scheduler: after a check of an https monitor it
 * re-reads the certificate at most every `everyMs` and emails each threshold once.
 */
export function createTlsChecker({ db, notifier, probe = probeTls, logger = console, everyMs = 6 * 3600_000, timeoutMs = 10_000 }) {
  return async function afterCheck(monitor, _result, now) {
    if (!monitor || !monitor.url.startsWith('https:')) return;
    if (monitor.tls_checked_at && now - monitor.tls_checked_at < everyMs) return;

    let validTo;
    try {
      ({ validTo } = await probe(monitor.url, { timeoutMs: Math.min(timeoutMs, monitor.timeout_s * 1000) }));
    } catch (err) {
      const message = String(err?.message || err).slice(0, 300);
      db.prepare('UPDATE monitors SET tls_checked_at = ?, tls_error = ? WHERE id = ?').run(now, message, monitor.id);
      logger.warn(`[tls] ${monitor.name}: ${message}`);
      return;
    }

    const { threshold, warned } = tlsWarningDue(validTo, now, monitor.tls_warned);
    db.prepare('UPDATE monitors SET tls_checked_at = ?, tls_expires_at = ?, tls_warned = ?, tls_error = NULL WHERE id = ?')
      .run(now, validTo, warned, monitor.id);
    if (threshold !== null) {
      logger.warn(`[tls] ${monitor.name}: certificate expires within ${threshold} day(s)`);
      await notifier.tlsExpiring(monitor, threshold, validTo);
    }
  };
}
