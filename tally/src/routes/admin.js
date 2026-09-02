'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');

const config = require('../config');
const db = require('../db');
const auth = require('../auth');
const views = require('../views/admin');
const { displayValue } = require('../notify');
const {
  isValidType,
  typeHasOptions,
  slugify,
  uniqueSlug,
  parseOptions,
  fieldOptions,
} = require('../fields');
const { normalizeColor } = require('../views/public');

const router = express.Router();
const body = express.urlencoded({ extended: false, limit: '512kb' });

const PAGE_SIZE = 50;

const FLASH = {
  'form-created': { type: 'ok', text: 'Form created. Add some fields below.' },
  'form-saved': { type: 'ok', text: 'Settings saved.' },
  'notifications-saved': { type: 'ok', text: 'Notification settings saved.' },
  'form-deleted': { type: 'ok', text: 'Form deleted.' },
  'field-added': { type: 'ok', text: 'Field added.' },
  'field-saved': { type: 'ok', text: 'Field saved.' },
  'field-deleted': { type: 'ok', text: 'Field deleted.' },
  'response-deleted': { type: 'ok', text: 'Response deleted.' },
  'slug-taken': { type: 'err', text: 'That slug is already in use.' },
};

function flashFor(req) {
  const key = typeof req.query.flash === 'string' ? req.query.flash : null;
  return key && FLASH[key] ? FLASH[key] : null;
}

/* ------------------------------------------------------------- statements */

const q = {
  formsWithCounts: db.prepare(`
    SELECT f.*, (SELECT COUNT(*) FROM responses r WHERE r.form_id = f.id) AS response_count
    FROM forms f
    ORDER BY f.created_at DESC, f.id DESC
  `),
  formById: db.prepare('SELECT * FROM forms WHERE id = ?'),
  formBySlug: db.prepare('SELECT * FROM forms WHERE slug = ?'),
  allSlugs: db.prepare('SELECT slug FROM forms'),
  insertForm: db.prepare('INSERT INTO forms (slug, title) VALUES (?, ?)'),
  updateForm: db.prepare(`
    UPDATE forms SET title = ?, description = ?, slug = ?, accent_color = ?,
      submit_label = ?, success_message = ?, is_open = ?, updated_at = datetime('now')
    WHERE id = ?
  `),
  updateNotifications: db.prepare(`
    UPDATE forms SET notify_email = ?, notify_email_to = ?, webhook_url = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `),
  deleteForm: db.prepare('DELETE FROM forms WHERE id = ?'),

  fieldsByForm: db.prepare('SELECT * FROM fields WHERE form_id = ? ORDER BY position, id'),
  fieldById: db.prepare('SELECT * FROM fields WHERE id = ?'),
  fieldKeys: db.prepare('SELECT key FROM fields WHERE form_id = ?'),
  maxPosition: db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM fields WHERE form_id = ?'),
  insertField: db.prepare(`
    INSERT INTO fields (form_id, position, type, key, label, help_text, placeholder, options, required)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateField: db.prepare(`
    UPDATE fields SET type = ?, key = ?, label = ?, help_text = ?, placeholder = ?,
      options = ?, required = ? WHERE id = ?
  `),
  setPosition: db.prepare('UPDATE fields SET position = ? WHERE id = ?'),
  deleteField: db.prepare('DELETE FROM fields WHERE id = ?'),

  responsesByForm: db.prepare('SELECT * FROM responses WHERE form_id = ? ORDER BY id DESC'),
  responseById: db.prepare('SELECT * FROM responses WHERE id = ? AND form_id = ?'),
  countResponses: db.prepare('SELECT COUNT(*) AS n FROM responses WHERE form_id = ?'),
  deleteResponse: db.prepare('DELETE FROM responses WHERE id = ?'),
  uploadsByResponse: db.prepare('SELECT * FROM uploads WHERE response_id = ?'),
  uploadsByForm: db.prepare(`
    SELECT u.* FROM uploads u JOIN responses r ON r.id = u.response_id WHERE r.form_id = ?
  `),
  uploadByPath: db.prepare('SELECT * FROM uploads WHERE stored_path = ?'),
};

/* ------------------------------------------------------------------ auth */

router.get('/login', (req, res) => {
  if (auth.isAuthed(req)) return res.redirect('/admin');
  const next = typeof req.query.next === 'string' ? req.query.next : '/admin';
  res.type('html').send(views.loginPage({ next }));
});

router.post('/login', body, (req, res) => {
  const next = typeof req.body.next === 'string' && req.body.next.startsWith('/admin')
    ? req.body.next
    : '/admin';

  if (!auth.tokenMatches(req.body.token)) {
    // Slow brute force down a little without holding a worker for long.
    return setTimeout(() => {
      res.status(401).type('html').send(views.loginPage({ error: 'That token is not correct.', next }));
    }, 400);
  }

  auth.login(res);
  res.redirect(303, next);
});

router.post('/logout', body, (req, res) => {
  auth.logout(res);
  res.redirect(303, '/admin/login');
});

router.use(auth.requireAuth);

/* ----------------------------------------------------------------- helpers */

function loadForm(req, res) {
  const form = q.formById.get(Number(req.params.id));
  if (!form) {
    res.status(404).type('html').send(views.errorPage({ status: 404, message: 'No such form.' }));
    return null;
  }
  return form;
}

function loadField(req, res) {
  const field = q.fieldById.get(Number(req.params.fieldId));
  if (!field) {
    res.status(404).type('html').send(views.errorPage({ status: 404, message: 'No such field.' }));
    return null;
  }
  return field;
}

function uploadDirFor(slug) {
  return path.join(config.uploadDir, path.basename(slug));
}

/** Resolves a stored path inside uploadDir, or null if it escapes. */
function resolveStored(storedPath) {
  const root = path.resolve(config.uploadDir);
  const abs = path.resolve(root, storedPath);
  return abs.startsWith(root + path.sep) ? abs : null;
}

/**
 * Deletes the given uploads and tidies up any per-form directory they leave
 * behind. Renaming a form's slug leaves older files under the previous slug's
 * directory, so we clear every directory the batch touched, not just the
 * current one.
 */
function removeUploads(uploads, currentSlug = null) {
  const dirs = new Set();

  for (const upload of uploads) {
    const abs = resolveStored(upload.stored_path);
    if (!abs) continue;
    fs.rmSync(abs, { force: true });
    dirs.add(path.dirname(abs));
  }

  if (currentSlug) dirs.add(path.resolve(uploadDirFor(currentSlug)));

  for (const dir of dirs) {
    if (dir === path.resolve(config.uploadDir)) continue;
    // Only removes the directory when it is empty; a shared one is left alone.
    try {
      fs.rmdirSync(dir);
    } catch {
      /* not empty or already gone */
    }
  }
}

function parseData(row) {
  try {
    return JSON.parse(row.data);
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ forms */

router.get('/', (req, res) => {
  res.type('html').send(views.formsIndex({ forms: q.formsWithCounts.all(), flash: flashFor(req) }));
});

router.get('/forms/new', (req, res) => {
  res.type('html').send(views.newFormPage());
});

router.post('/forms', body, (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 120);
  if (!title) {
    return res
      .status(400)
      .type('html')
      .send(views.newFormPage({ values: req.body, error: 'A title is required.' }));
  }

  const requested = String(req.body.slug || '').trim();
  const base = slugify(requested || title, 'form');
  const taken = q.allSlugs.all().map((r) => r.slug);

  if (requested && taken.includes(base)) {
    return res
      .status(400)
      .type('html')
      .send(views.newFormPage({ values: req.body, error: 'That slug is already in use.' }));
  }

  const slug = uniqueSlug(base, taken);
  const info = q.insertForm.run(slug, title);
  res.redirect(303, `/admin/forms/${info.lastInsertRowid}?flash=form-created`);
});

router.get('/forms/:id', (req, res) => {
  const form = loadForm(req, res);
  if (!form) return;
  res.type('html').send(
    views.formEditor({
      form,
      fields: q.fieldsByForm.all(form.id),
      responseCount: q.countResponses.get(form.id).n,
      flash: flashFor(req),
    })
  );
});

router.post('/forms/:id', body, (req, res) => {
  const form = loadForm(req, res);
  if (!form) return;

  const title = String(req.body.title || '').trim().slice(0, 120) || form.title;
  const description = String(req.body.description || '').trim().slice(0, 2000);
  const submitLabel = String(req.body.submit_label || '').trim().slice(0, 40) || 'Submit';
  const successMessage =
    String(req.body.success_message || '').trim().slice(0, 300) ||
    'Thanks — your response has been recorded.';
  const accent = normalizeColor(req.body.accent_color);
  const isOpen = req.body.is_open ? 1 : 0;

  const wantedSlug = slugify(String(req.body.slug || '').trim() || title, form.slug);
  const clash = q.formBySlug.get(wantedSlug);
  if (clash && clash.id !== form.id) {
    return res.redirect(303, `/admin/forms/${form.id}?flash=slug-taken`);
  }

  q.updateForm.run(
    title,
    description,
    wantedSlug,
    accent,
    submitLabel,
    successMessage,
    isOpen,
    form.id
  );
  res.redirect(303, `/admin/forms/${form.id}?flash=form-saved`);
});

router.post('/forms/:id/notifications', body, (req, res) => {
  const form = loadForm(req, res);
  if (!form) return;

  const notifyEmail = req.body.notify_email ? 1 : 0;
  const to = String(req.body.notify_email_to || '').trim().slice(0, 200);

  let webhook = String(req.body.webhook_url || '').trim().slice(0, 500);
  if (webhook && !/^https?:\/\//i.test(webhook)) webhook = `https://${webhook}`;

  q.updateNotifications.run(notifyEmail, to, webhook, form.id);
  res.redirect(303, `/admin/forms/${form.id}?flash=notifications-saved`);
});

router.post('/forms/:id/delete', body, (req, res) => {
  const form = loadForm(req, res);
  if (!form) return;

  const uploads = q.uploadsByForm.all(form.id);
  q.deleteForm.run(form.id); // cascades to fields, responses, uploads
  removeUploads(uploads, form.slug);

  res.redirect(303, '/admin?flash=form-deleted');
});

/* ----------------------------------------------------------------- fields */

function readFieldInput(req, existingKeys, fallbackKey = null) {
  const label = String(req.body.label || '').trim().slice(0, 120);
  const type = String(req.body.type || 'text');
  const helpText = String(req.body.help_text || '').trim().slice(0, 200);
  const placeholder = String(req.body.placeholder || '').trim().slice(0, 120);
  const required = req.body.required ? 1 : 0;
  const options = typeHasOptions(type) ? parseOptions(req.body.options) : [];

  if (!label) return { error: 'A label is required.' };
  if (!isValidType(type)) return { error: 'Unknown field type.' };
  if (typeHasOptions(type) && options.length === 0) {
    return { error: 'A dropdown needs at least one option.' };
  }

  const requestedKey = String(req.body.key || '').trim();
  const base = slugify(requestedKey || label, fallbackKey || 'field');

  // An explicitly typed key that collides is an error worth showing; a key
  // derived from the label just gets a numeric suffix.
  if (base !== fallbackKey && existingKeys.includes(base)) {
    if (requestedKey) return { error: `Another field already uses the key “${base}”.` };
    return { label, type, helpText, placeholder, required,
      options: JSON.stringify(options), key: uniqueSlug(base, existingKeys) };
  }
  const key = base;

  return {
    label,
    type,
    helpText,
    placeholder,
    required,
    options: JSON.stringify(options),
    key,
  };
}

router.post('/forms/:id/fields', body, (req, res) => {
  const form = loadForm(req, res);
  if (!form) return;

  const existingKeys = q.fieldKeys.all(form.id).map((r) => r.key);
  const input = readFieldInput(req, existingKeys);

  if (input.error) {
    return res.status(400).type('html').send(
      views.formEditor({
        form,
        fields: q.fieldsByForm.all(form.id),
        responseCount: q.countResponses.get(form.id).n,
        flash: null,
        fieldError: input.error,
        fieldValues: req.body,
      })
    );
  }

  const position = q.maxPosition.get(form.id).p + 1;
  q.insertField.run(
    form.id,
    position,
    input.type,
    input.key,
    input.label,
    input.helpText,
    input.placeholder,
    input.options,
    input.required
  );

  res.redirect(303, `/admin/forms/${form.id}?flash=field-added`);
});

router.get('/fields/:fieldId/edit', (req, res) => {
  const field = loadField(req, res);
  if (!field) return;
  const form = q.formById.get(field.form_id);
  res.type('html').send(views.fieldEditor({ form, field }));
});

router.post('/fields/:fieldId', body, (req, res) => {
  const field = loadField(req, res);
  if (!field) return;
  const form = q.formById.get(field.form_id);

  const otherKeys = q.fieldKeys
    .all(form.id)
    .map((r) => r.key)
    .filter((k) => k !== field.key);

  const input = readFieldInput(req, otherKeys, field.key);
  if (input.error) {
    return res.status(400).type('html').send(views.fieldEditor({ form, field, error: input.error }));
  }

  // Preserve existing options when switching away from and back to a select
  // is not possible, so only overwrite when the new type actually uses them.
  const options = typeHasOptions(input.type)
    ? input.options
    : JSON.stringify(fieldOptions(field));

  q.updateField.run(
    input.type,
    input.key,
    input.label,
    input.helpText,
    input.placeholder,
    options,
    input.required,
    field.id
  );

  res.redirect(303, `/admin/forms/${form.id}?flash=field-saved`);
});

router.post('/fields/:fieldId/delete', body, (req, res) => {
  const field = loadField(req, res);
  if (!field) return;
  q.deleteField.run(field.id);
  res.redirect(303, `/admin/forms/${field.form_id}?flash=field-deleted`);
});

router.post('/fields/:fieldId/move', body, (req, res) => {
  const field = loadField(req, res);
  if (!field) return;

  const fields = q.fieldsByForm.all(field.form_id);
  const index = fields.findIndex((f) => f.id === field.id);
  const target = req.body.dir === 'up' ? index - 1 : index + 1;

  if (index !== -1 && target >= 0 && target < fields.length) {
    const swap = db.transaction(() => {
      // Positions can contain gaps or duplicates; renumber the whole list.
      const reordered = fields.slice();
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      reordered.forEach((f, i) => q.setPosition.run(i, f.id));
    });
    swap();
  }

  res.redirect(303, `/admin/forms/${field.form_id}`);
});

/* -------------------------------------------------------------- responses */

function sortedResponses(form, fields, sort, dir) {
  const rows = q.responsesByForm.all(form.id).map((row) => ({
    id: row.id,
    created_at: row.created_at,
    ip: row.ip,
    values: parseData(row),
  }));

  const field = fields.find((f) => f.key === sort);
  const factor = dir === 'asc' ? 1 : -1;

  if (!field) {
    rows.sort((a, b) => (a.id - b.id) * factor);
    return rows;
  }

  const sortable = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'object') return String(value.name || '').toLowerCase();
    const asNumber = Number(value);
    if (value !== '' && Number.isFinite(asNumber)) return asNumber;
    return String(value).toLowerCase();
  };

  rows.sort((a, b) => {
    const av = sortable(a.values[field.key]);
    const bv = sortable(b.values[field.key]);
    // Empty answers always sink to the bottom, whichever direction we sort.
    if (av === null && bv === null) return b.id - a.id;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return b.id - a.id;
  });

  return rows;
}

router.get('/forms/:id/responses', (req, res) => {
  const form = loadForm(req, res);
  if (!form) return;

  const fields = q.fieldsByForm.all(form.id);
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'created_at';
  const dir = req.query.dir === 'asc' ? 'asc' : 'desc';

  const all = sortedResponses(form, fields, sort, dir);
  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(req.query.page) || 1), pages);
  const rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  res.type('html').send(
    views.responsesPage({
      form,
      fields,
      rows,
      total,
      sort,
      dir,
      page,
      pages,
      flash: flashFor(req),
    })
  );
});

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

router.get('/forms/:id/responses.csv', (req, res) => {
  const form = loadForm(req, res);
  if (!form) return;

  const fields = q.fieldsByForm.all(form.id);
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'created_at';
  const dir = req.query.dir === 'asc' ? 'asc' : 'desc';
  const rows = sortedResponses(form, fields, sort, dir);

  const header = ['id', 'submitted_at_utc', 'ip', ...fields.map((f) => f.key)];
  const lines = [header.map(csvCell).join(',')];

  for (const row of rows) {
    const cells = [
      row.id,
      row.created_at,
      row.ip,
      ...fields.map((f) => {
        const value = row.values[f.key];
        if (f.type === 'checkbox') return value ? 'yes' : 'no';
        if (f.type === 'file') return value ? value.name : '';
        return value ?? '';
      }),
    ];
    lines.push(cells.map(csvCell).join(','));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${form.slug}-responses-${stamp}.csv"`);
  // BOM so Excel opens UTF-8 correctly.
  res.send(`﻿${lines.join('\r\n')}\r\n`);
});

router.get('/forms/:id/responses/:responseId', (req, res) => {
  const form = loadForm(req, res);
  if (!form) return;

  const response = q.responseById.get(Number(req.params.responseId), form.id);
  if (!response) {
    return res
      .status(404)
      .type('html')
      .send(views.errorPage({ status: 404, message: 'No such response.' }));
  }

  const fields = q.fieldsByForm.all(form.id);
  const values = parseData(response);
  const known = new Set(fields.map((f) => f.key));

  const orphans = Object.entries(values)
    .filter(([key]) => !known.has(key))
    .map(([key, value]) => ({
      key,
      text: displayValue({ type: typeof value === 'boolean' ? 'checkbox' : 'text' }, value),
    }));

  res.type('html').send(views.responseDetail({ form, fields, response, values, orphans }));
});

router.post('/forms/:id/responses/:responseId/delete', body, (req, res) => {
  const form = loadForm(req, res);
  if (!form) return;

  const response = q.responseById.get(Number(req.params.responseId), form.id);
  if (!response) {
    return res
      .status(404)
      .type('html')
      .send(views.errorPage({ status: 404, message: 'No such response.' }));
  }

  const uploads = q.uploadsByResponse.all(response.id);
  q.deleteResponse.run(response.id);
  removeUploads(uploads);

  res.redirect(303, `/admin/forms/${form.id}/responses?flash=response-deleted`);
});

/* ------------------------------------------------------- upload downloads */

router.get('/uploads/*storedPath', (req, res) => {
  const relative = Array.isArray(req.params.storedPath)
    ? req.params.storedPath.join('/')
    : String(req.params.storedPath || '');

  const upload = q.uploadByPath.get(relative);
  if (!upload) {
    return res
      .status(404)
      .type('html')
      .send(views.errorPage({ status: 404, message: 'That file is no longer stored.' }));
  }

  const abs = path.resolve(config.uploadDir, upload.stored_path);
  if (!abs.startsWith(path.resolve(config.uploadDir) + path.sep) || !fs.existsSync(abs)) {
    return res
      .status(404)
      .type('html')
      .send(views.errorPage({ status: 404, message: 'That file is missing from disk.' }));
  }

  res.download(abs, upload.original_name);
});

module.exports = router;
