'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const config = require('../config');
const db = require('../db');
const rateLimit = require('../ratelimit');
const { validateSubmission } = require('../validate');
const { notify } = require('../notify');
const views = require('../views/public');

const router = express.Router();

const urlencoded = express.urlencoded({ extended: false, limit: '256kb' });

const selectForm = db.prepare('SELECT * FROM forms WHERE slug = ?');
const selectFields = db.prepare('SELECT * FROM fields WHERE form_id = ? ORDER BY position, id');
const insertResponse = db.prepare(
  'INSERT INTO responses (form_id, ip, user_agent, data) VALUES (?, ?, ?, ?)'
);
const insertUpload = db.prepare(
  `INSERT INTO uploads (response_id, field_key, original_name, stored_path, mime_type, size_bytes)
   VALUES (?, ?, ?, ?, ?, ?)`
);

/** Keeps a safe extension from the uploaded name; drops anything suspicious. */
function safeExtension(originalName) {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(ext) ? ext : '';
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(config.uploadDir, path.basename(req.tallyForm.slug));
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  },
  filename(req, file, cb) {
    cb(null, `${Date.now()}-${crypto.randomUUID()}${safeExtension(file.originalname)}`);
  },
});

const uploader = multer({
  storage,
  limits: {
    fileSize: config.maxUploadBytes,
    files: 10,
    fields: 60,
    fieldSize: 64 * 1024,
  },
});

function removeFiles(files) {
  for (const file of files) {
    fs.unlink(file.path, () => {});
  }
}

/** Flattens multer's `req.files` map into { fieldKey: file }. */
function firstFilePerField(files) {
  const out = {};
  if (!files) return out;
  for (const [key, list] of Object.entries(files)) {
    if (list && list[0]) {
      out[key] = list[0];
      out[key].storedRelPath = path.relative(config.uploadDir, list[0].path);
    }
  }
  return out;
}

function allFiles(files) {
  return files ? Object.values(files).flat() : [];
}

/* Loads the form and its fields for every /f/:slug request. */
router.use('/:slug', (req, res, next) => {
  const form = selectForm.get(req.params.slug);
  if (!form) {
    return res.status(404).type('html').send(views.renderNotFound());
  }
  req.tallyForm = form;
  req.tallyFields = selectFields.all(form.id);
  next();
});

router.get('/:slug', (req, res) => {
  const form = req.tallyForm;
  if (!form.is_open) {
    return res.status(403).type('html').send(views.renderClosed(form));
  }
  res.type('html').send(views.renderForm({ form, fields: req.tallyFields }));
});

router.get('/:slug/thanks', (req, res) => {
  res.type('html').send(views.renderSuccess(req.tallyForm));
});

/* Rate limit before we spend any disk on a multipart body. */
router.post('/:slug', (req, res, next) => {
  const form = req.tallyForm;
  if (!form.is_open) {
    return res.status(403).type('html').send(views.renderClosed(form));
  }

  const verdict = rateLimit.check(form.id, req.ip);
  if (!verdict.allowed) {
    res.set('Retry-After', String(verdict.retryAfterSeconds));
    return res
      .status(429)
      .type('html')
      .send(
        views.renderForm({
          form,
          fields: req.tallyFields,
          formError: 'Too many submissions from this network. Please try again in a few minutes.',
        })
      );
  }
  next();
});

/*
 * Parse the body. Browsers only send multipart when we set the enctype, i.e.
 * when the form has a file field — but both parsers are wired up either way so
 * an unexpected content type gets a clean error instead of a crash. Each
 * parser ignores requests that are not its own content type.
 */
router.post('/:slug', (req, res, next) => {
  const fileFields = req.tallyFields
    .filter((f) => f.type === 'file')
    .map((f) => ({ name: f.key, maxCount: 1 }));

  const multipart =
    fileFields.length > 0 ? uploader.fields(fileFields) : uploader.none();

  const onParsed = (err) => {
    if (!err) {
      req.body = req.body || {};
      return next();
    }

    removeFiles(allFiles(req.files));
    rateLimit.refund(req.tallyForm.id, req.ip);

    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `That file is too large. The limit is ${config.maxUploadMb} MB.`
        : 'That submission could not be accepted. Please check any file and try again.';

    return res
      .status(400)
      .type('html')
      .send(views.renderForm({ form: req.tallyForm, fields: req.tallyFields, formError: message }));
  };

  urlencoded(req, res, (err) => (err ? onParsed(err) : multipart(req, res, onParsed)));
});

router.post('/:slug', (req, res) => {
  const form = req.tallyForm;
  const fields = req.tallyFields;
  const uploaded = allFiles(req.files);

  // Honeypot: a bot filled the hidden input. Accept silently so it learns nothing.
  if (typeof req.body.website_url === 'string' && req.body.website_url.trim() !== '') {
    removeFiles(uploaded);
    return res.redirect(303, `/f/${form.slug}/thanks`);
  }

  if (fields.length === 0) {
    removeFiles(uploaded);
    return res.status(400).type('html').send(
      views.renderForm({
        form,
        fields,
        formError: 'This form has no fields yet.',
      })
    );
  }

  const files = firstFilePerField(req.files);
  const { ok, values, errors } = validateSubmission(fields, req.body, files);

  if (!ok) {
    removeFiles(uploaded);
    rateLimit.refund(form.id, req.ip);
    return res
      .status(422)
      .type('html')
      .send(
        views.renderForm({
          form,
          fields,
          values,
          errors,
          formError: 'Please fix the highlighted fields.',
        })
      );
  }

  const ip = req.ip || '';
  const userAgent = String(req.get('user-agent') || '').slice(0, 500);

  const save = db.transaction(() => {
    const info = insertResponse.run(form.id, ip, userAgent, JSON.stringify(values));
    const responseId = info.lastInsertRowid;
    for (const [key, file] of Object.entries(files)) {
      insertUpload.run(
        responseId,
        key,
        file.originalname,
        file.storedRelPath,
        file.mimetype || '',
        file.size
      );
    }
    return responseId;
  });

  let responseId;
  try {
    responseId = save();
  } catch (err) {
    removeFiles(uploaded);
    throw err;
  }

  const stored = db.prepare('SELECT * FROM responses WHERE id = ?').get(responseId);

  // Fire and forget: a slow SMTP server must not hold up the respondent.
  notify(form, fields, stored).catch((err) =>
    console.error('[notify] unexpected failure:', err)
  );

  res.redirect(303, `/f/${form.slug}/thanks`);
});

module.exports = router;
