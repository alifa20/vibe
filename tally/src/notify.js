'use strict';

const nodemailer = require('nodemailer');
const config = require('./config');
const { escapeHtml } = require('./html');

let transporter = null;

function getTransporter() {
  if (!config.smtp.enabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

/** Human-readable rendering of one answer, shared by email and the admin UI. */
function displayValue(field, value) {
  if (field.type === 'checkbox') return value ? 'Yes' : 'No';
  if (field.type === 'file') return value ? `${value.name} (${formatBytes(value.size)})` : '—';
  if (value === '' || value === null || value === undefined) return '—';
  return String(value);
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function buildEmail(form, fields, response) {
  const values = JSON.parse(response.data);
  const rows = fields
    .map((f) => {
      const shown = displayValue(f, values[f.key]);
      return `<tr>
        <td style="padding:8px 14px 8px 0;vertical-align:top;color:#666;white-space:nowrap">${escapeHtml(f.label)}</td>
        <td style="padding:8px 0;vertical-align:top;white-space:pre-wrap">${escapeHtml(shown)}</td>
      </tr>`;
    })
    .join('');

  const link = `${config.baseUrl}/admin/forms/${form.id}/responses`;

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">
    <p style="margin:0 0 16px">New response to <strong>${escapeHtml(form.title)}</strong>.</p>
    <table style="border-collapse:collapse">${rows}</table>
    <p style="margin:20px 0 0;color:#666;font-size:12px">
      ${escapeHtml(response.created_at)} UTC &middot; ${escapeHtml(response.ip || 'unknown IP')}<br>
      <a href="${escapeHtml(link)}">View all responses</a>
    </p>
  </div>`;

  const text = [
    `New response to ${form.title}`,
    '',
    ...fields.map((f) => `${f.label}: ${displayValue(f, values[f.key])}`),
    '',
    `${response.created_at} UTC · ${response.ip || 'unknown IP'}`,
    link,
  ].join('\n');

  return { html, text };
}

/**
 * Sends the configured notifications. Never throws: a failing SMTP server or
 * webhook must not turn a successfully stored response into an error page.
 */
async function notify(form, fields, response) {
  const tasks = [];

  if (form.notify_email) {
    tasks.push(sendEmail(form, fields, response));
  }
  if (form.webhook_url) {
    tasks.push(postWebhook(form, fields, response));
  }

  await Promise.allSettled(tasks);
}

async function sendEmail(form, fields, response) {
  const to = form.notify_email_to || config.notifyEmailTo;
  const mailer = getTransporter();

  if (!mailer) {
    console.warn(`[notify] form "${form.slug}": email enabled but SMTP_HOST is not set; skipping.`);
    return;
  }
  if (!to) {
    console.warn(`[notify] form "${form.slug}": no recipient (set NOTIFY_EMAIL_TO); skipping.`);
    return;
  }

  const { html, text } = buildEmail(form, fields, response);

  try {
    await mailer.sendMail({
      from: config.smtp.from || config.smtp.user || to,
      to,
      subject: `New response: ${form.title}`,
      text,
      html,
    });
  } catch (err) {
    console.error(`[notify] email failed for form "${form.slug}":`, err.message);
  }
}

function webhookPayload(form, fields, response) {
  const values = JSON.parse(response.data);
  return {
    form: { id: form.id, slug: form.slug, title: form.title },
    response: {
      id: response.id,
      created_at: `${response.created_at.replace(' ', 'T')}Z`,
      ip: response.ip,
      user_agent: response.user_agent,
    },
    answers: fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      value: values[f.key] === undefined ? null : values[f.key],
    })),
  };
}

async function postWebhook(form, fields, response) {
  const payload = webhookPayload(form, fields, response);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(form.webhook_url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'tally-forms/1.0',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!res.ok) {
      console.error(
        `[notify] webhook for form "${form.slug}" returned HTTP ${res.status}`
      );
    }
  } catch (err) {
    console.error(`[notify] webhook failed for form "${form.slug}":`, err.message);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { notify, displayValue, formatBytes, webhookPayload };
