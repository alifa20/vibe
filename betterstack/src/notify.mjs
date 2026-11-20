import nodemailer from 'nodemailer';

/** SMTP settings from the environment, the same variables tally uses. */
export function smtpFromEnv(env = process.env) {
  const port = Number.parseInt(env.SMTP_PORT || '', 10);
  const smtp = {
    host: (env.SMTP_HOST || '').trim(),
    port: Number.isFinite(port) ? port : 587,
    secure: ['1', 'true', 'yes'].includes(String(env.SMTP_SECURE || '').toLowerCase()),
    user: (env.SMTP_USER || '').trim(),
    pass: env.SMTP_PASS || '',
    from: (env.SMTP_FROM || '').trim(),
  };
  smtp.enabled = Boolean(smtp.host);
  return smtp;
}

/**
 * nodemailer options for the SMTP settings. nodemailer's own timeouts run to
 * minutes (2 min connect, 10 min idle socket); a hung mail server must give
 * up long before that.
 */
export function smtpTransportOptions(smtp) {
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}

export function formatDuration(ms) {
  let s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.slice(0, 2).join(' ');
}

const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

/**
 * Builds and sends alert emails. `send` never throws: a broken SMTP server
 * must not stop the scheduler. `mailer` (anything with sendMail) can be
 * injected; otherwise one nodemailer transport is created on first use.
 */
export function createNotifier({ smtp = smtpFromEnv(), to = '', baseUrl = '', mailer = null, logger = console } = {}) {
  let transport = mailer;

  function getTransport() {
    if (transport) return transport;
    if (!smtp.enabled) return null;
    transport = nodemailer.createTransport(smtpTransportOptions(smtp));
    return transport;
  }

  const link = (path) => (baseUrl ? `\n\n${baseUrl.replace(/\/+$/, '')}${path}` : '');

  async function send(subject, text) {
    const t = getTransport();
    if (!t) {
      logger.warn(`[notify] SMTP_HOST is not set; not sending "${subject}"`);
      return false;
    }
    if (!to) {
      logger.warn(`[notify] ALERT_EMAIL_TO is not set; not sending "${subject}"`);
      return false;
    }
    try {
      await t.sendMail({ from: smtp.from || smtp.user || to, to, subject, text });
      return true;
    } catch (err) {
      logger.error(`[notify] sending "${subject}" failed: ${err?.message || err}`);
      return false;
    }
  }

  return {
    send,
    monitorDown(monitor, error, since) {
      return send(
        `[uptime] DOWN: ${monitor.name}`,
        `${monitor.name} is down.\n\nURL: ${monitor.url}\nError: ${error || 'unknown error'}\nFailing since: ${iso(since)}` + link(`/monitors/${monitor.id}`),
      );
    },
    monitorUp(monitor, durationMs) {
      return send(
        `[uptime] UP: ${monitor.name}`,
        `${monitor.name} is back up after ${formatDuration(durationMs)} of downtime.\n\nURL: ${monitor.url}` + link(`/monitors/${monitor.id}`),
      );
    },
    tlsExpiring(monitor, threshold, expiresAt) {
      const days = threshold === 1 ? '1 day' : `${threshold} days`;
      return send(
        `[uptime] TLS certificate for ${monitor.name} expires within ${days}`,
        `The certificate served by ${monitor.url} expires on ${iso(expiresAt)}, less than ${days} from now.` + link(`/monitors/${monitor.id}`),
      );
    },
    heartbeatDown(hb, reason, since) {
      return send(
        `[uptime] DOWN: ${hb.name}`,
        `${hb.name} is down.\n\nReason: ${reason}\nSince: ${iso(since)}` + link(`/heartbeats/${hb.id}`),
      );
    },
    heartbeatUp(hb, durationMs) {
      return send(
        `[uptime] UP: ${hb.name}`,
        `${hb.name} is back up after ${formatDuration(durationMs)} of downtime.` + link(`/heartbeats/${hb.id}`),
      );
    },
  };
}
