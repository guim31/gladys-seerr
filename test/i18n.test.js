// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, and the four documentation files, with the same sections. German says
// "du", never the polite "Sie". (Adapted from guim31/gladys-wled.)
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { NAMES } from '../src/devices.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  INIT_FAILED,
  ISSUE_TEXT,
  MEDIA_TEXT,
  REPORT_TEXT,
  STATE_TEXT,
  UNKNOWN_TITLE,
} from '../src/texts.js';
import { CAPTION_TEXT, DONE_TEXT, TEXT } from '../src/widgets.js';
import { ERROR_KINDS } from '../src/seerr/client.js';
import { ISSUE_TYPES, MEDIA_TYPES, STATES } from '../src/seerr/model.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  short: 24,
  status: 40,
  featureName: 40,
  badge: 16,
  caption: 80,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max, render = (value) => value) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(render(value), `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(Object.keys(NAMES), LANGS);
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 80, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the catalog description holds 10 characters at least in every language', () => {
  for (const lang of LANGS) {
    assert.ok(manifest.description[lang].length >= 10, `description.${lang} is too short`);
  }
});

test('every message table of the code has the four languages', () => {
  // Widget texts shown as tiles, rows or buttons are short; the others are messages.
  const longWidgetTexts = new Set(['pick', 'unknown', 'nothing']);
  const statusTexts = new Set(['update']);
  const found = [
    ...problems(INIT_FAILED, 'INIT_FAILED', MAX.message),
    ...Object.entries(CONNECTION_TEXT).flatMap(([key, value]) =>
      problems(value, `CONNECTION_TEXT.${key}`, MAX.message),
    ),
    ...Object.entries(ACTION_TEXT).flatMap(([key, value]) =>
      problems(value, `ACTION_TEXT.${key}`, MAX.message),
    ),
    ...Object.entries(ERROR_TEXT).flatMap(([key, value]) =>
      problems(value, `ERROR_TEXT.${key}`, 100),
    ),
    ...Object.entries(MEDIA_TEXT).flatMap(([key, value]) =>
      problems(value, `MEDIA_TEXT.${key}`, MAX.short),
    ),
    ...Object.entries(ISSUE_TEXT).flatMap(([key, value]) =>
      problems(value, `ISSUE_TEXT.${key}`, MAX.short),
    ),
    ...Object.entries(STATE_TEXT).flatMap(([key, value]) =>
      problems(value, `STATE_TEXT.${key}`, MAX.badge),
    ),
    ...Object.entries(TEXT).flatMap(([key, value]) =>
      problems(
        value,
        `TEXT.${key}`,
        longWidgetTexts.has(key) ? MAX.message : statusTexts.has(key) ? MAX.status : MAX.short,
      ),
    ),
  ];
  assert.deepEqual(found, []);
  assert.deepEqual(sorted(Object.keys(ERROR_TEXT)), sorted(Object.values(ERROR_KINDS)));
  assert.deepEqual(sorted(Object.keys(MEDIA_TEXT)), sorted(Object.values(MEDIA_TYPES)));
  assert.deepEqual(sorted(Object.keys(ISSUE_TEXT)), sorted(Object.values(ISSUE_TYPES)));
  assert.deepEqual(sorted(Object.keys(STATE_TEXT)), sorted(Object.values(STATES)));
});

test('the feature names exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName), []);
});

test('the reports, captions, toasts and fallback titles exist in every language', () => {
  const render = (value) =>
    typeof value === 'function' ? value('A movie with a rather long title', 30) : value;
  assert.deepEqual(tableProblems(REPORT_TEXT, 'REPORT_TEXT', MAX.message, render), []);
  assert.deepEqual(tableProblems(DONE_TEXT, 'DONE_TEXT', MAX.message, render), []);
  const one = (table) =>
    Object.fromEntries(Object.entries(table).map(([l, f]) => [l, { text: f }]));
  assert.deepEqual(tableProblems(one(CAPTION_TEXT), 'CAPTION_TEXT', MAX.caption, render), []);
  assert.deepEqual(tableProblems(one(UNKNOWN_TITLE), 'UNKNOWN_TITLE', MAX.label, render), []);
});

// --- Documentation -------------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);

const headings = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => /^#{1,3} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('the four documentation files exist, with the same sections', () => {
  for (const lang of LANGS) {
    assert.ok(docs[lang].length >= 300, `docs/${lang}.md is too short for the store`);
    assert.deepEqual(headings(docs[lang]), headings(docs.en), `docs/${lang}.md sections`);
  }
  assert.ok(headings(docs.en).length >= 8);
});

test('the documentation names every trigger, action, setting, feature and widget button', () => {
  for (const lang of LANGS) {
    const doc = docs[lang];
    for (const item of [...manifest.scene_triggers, ...manifest.scene_actions]) {
      assert.ok(doc.includes(item.label[lang]), `docs/${lang}.md: "${item.label[lang]}"`);
    }
    for (const key of ['approve', 'decline']) {
      assert.ok(doc.includes(TEXT[key][lang]), `docs/${lang}.md: "${TEXT[key][lang]}"`);
    }
    for (const name of Object.values(NAMES[lang])) {
      assert.ok(doc.includes(name), `docs/${lang}.md: feature "${name}"`);
    }
    for (const field of manifest.config_schema.filter((f) => f.type !== 'section')) {
      assert.ok(doc.includes(field.label[lang]), `docs/${lang}.md: setting "${field.label[lang]}"`);
    }
    assert.ok(doc.includes(manifest.widgets[0].label[lang]), `docs/${lang}.md: widget`);
  }
});

test('the German documentation says "du"', () => {
  const polite = docs.de
    .split('\n')
    .filter((line) => !line.startsWith('`') && POLITE_GERMAN.test(line));
  assert.deepEqual(polite, []);
});

test('the documentation links the issues, and asks for feedback from real installations', () => {
  const feedback = {
    en: 'feedback welcome',
    fr: 'retours bienvenus',
    de: 'Rückmeldungen willkommen',
    es: 'comentarios bienvenidos',
  };
  for (const lang of LANGS) {
    const text = docs[lang].replace(/\s*\n>?\s*/g, ' ');
    assert.ok(text.includes(feedback[lang]), `docs/${lang}.md: "${feedback[lang]}"`);
    assert.match(docs[lang], /github\.com\/guim31\/gladys-seerr\/issues/);
  }
});
