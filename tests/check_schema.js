#!/usr/bin/env node
/*
 * The four payload schemas, checked from the consumer's side (P1-02, #24).
 *
 * Python validates the payload at write time; this validates the same
 * committed samples with the same keyword subset from the side that reads
 * them. Both ends therefore have to agree about what a payload looks like, and
 * the schemas themselves are exercised by the page's own toolchain rather than
 * only by pytest.
 *
 * Keywords: type, required, properties, items, additionalProperties. An
 * unknown keyword is an error, not a no-op -- a schema that silently stops
 * checking something is worse than no schema.
 *
 * Checks: every sample validates; dropping a required key is rejected and the
 * message names the key; a wrong type is rejected with its path; an added
 * field is accepted (a new field is not a breaking change); bool is not an
 * integer; an unknown keyword is refused.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCHEMA_DIR = path.join(ROOT, 'src', 'llm_telemetry', 'schema');
const REPORTS = path.join(ROOT, 'examples', 'reports');
const TAGS = ['analytics', 'live', 'ollama', 'router'];
const KEYWORDS = ['type', 'required', 'properties', 'items', 'additionalProperties'];
const METADATA = ['$schema', 'title', 'description'];

let passed = 0;
let failed = 0;

function chk(ok, label, extra) {
  if (ok) passed++;
  else failed++;
  const tail = extra === undefined ? '' : `  ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${tail}`);
}

function kind(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return t === 'object' ? 'object' : t;
}

function typeOk(value, want) {
  switch (want) {
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number';
    case 'boolean': return typeof value === 'boolean';
    case 'string': return typeof value === 'string';
    case 'null': return value === null;
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    default: throw new Error(`unknown type ${want} in schema`);
  }
}

function walkSchema(schema, value, at, errors) {
  const unknown = Object.keys(schema).filter((k) => !KEYWORDS.includes(k) && !METADATA.includes(k));
  if (unknown.length) throw new Error(`unsupported schema keyword(s) ${unknown.join(', ')}`);
  if (schema.type !== undefined) {
    const wants = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!wants.some((w) => typeOk(value, w))) {
      errors.push(`${at || '<root>'}: expected ${wants.join(' or ')}, found ${kind(value)}`);
      return;                        // a wrong type makes children meaningless
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${at || '<root>'}: required key '${key}' is missing`);
    }
    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in value) walkSchema(sub, value[key], at ? `${at}.${key}` : key, errors);
      }
      const extra = schema.additionalProperties;
      if (extra !== true && extra !== undefined) {
        for (const [key, val] of Object.entries(value)) {
          if (!(key in schema.properties)) {
            walkSchema(extra, val, at ? `${at}.${key}` : key, errors);
          }
        }
      }
    }
  } else if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => walkSchema(schema.items, item, `${at}[${i}]`, errors));
  }
}

function errorsFor(schema, value) {
  const errors = [];
  walkSchema(schema, value, '', errors);
  return errors;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

// ---- every committed sample satisfies its schema --------------------------
const schema = {};
const sample = {};
for (const tag of TAGS) {
  try {
    schema[tag] = readJson(path.join(SCHEMA_DIR, `${tag}.schema.json`));
    sample[tag] = readJson(path.join(REPORTS, `${tag}-data.json`));
  } catch (err) {
    chk(false, `${tag}: schema and sample are readable`, err.message);
    continue;
  }
  const errors = errorsFor(schema[tag], sample[tag]);
  chk(errors.length === 0, `${tag}: the committed sample matches its schema`,
      errors.length ? errors.slice(0, 3) : undefined);
}

// The schemas must stay inside the subset the page can enforce.
const used = new Set();
for (const tag of TAGS) {
  if (!schema[tag]) continue;
  (function collect(node) {
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) if (!METADATA.includes(key)) used.add(key);
    for (const sub of Object.values(node.properties || {})) collect(sub);
    if (node.items) collect(node.items);
    if (node.additionalProperties && typeof node.additionalProperties === 'object') {
      collect(node.additionalProperties);
    }
  })(schema[tag]);
}
chk([...used].every((k) => KEYWORDS.includes(k)), 'every keyword used is implemented',
    [...used].sort());
chk(KEYWORDS.every((k) => used.has(k)), 'the samples exercise the whole subset',
    [...used].sort());

// ---- required means something, and a new field is not breaking -----------
for (const tag of TAGS) {
  if (!schema[tag]) continue;
  const root = schema[tag];
  let named = 0;
  for (const key of root.required || []) {
    const broken = clone(sample[tag]);
    delete broken[key];
    const errors = errorsFor(root, broken);
    if (!errors.some((e) => e.includes(key) && e.includes('required'))) {
      chk(false, `${tag}: dropping required key ${key} is rejected by name`, errors.slice(0, 2));
      continue;
    }
    named++;
  }
  chk(named === (root.required || []).length && named > 0,
      `${tag}: every root required key is enforced (${named})`);

  const grown = clone(sample[tag]);
  grown.a_field_added_later = { nested: [1, 2, 3] };
  chk(errorsFor(root, grown).length === 0, `${tag}: an added top-level field still validates`);
}

// A wrong type is caught, and the message carries the path.
for (const tag of TAGS) {
  if (!schema[tag]) continue;
  const key = (schema[tag].required || []).find((k) => {
    const t = schema[tag].properties && schema[tag].properties[k] && schema[tag].properties[k].type;
    return t && !Array.isArray(t) && t !== 'object' && t !== 'array';
  });
  if (!key) continue;
  const wrongType = schema[tag].properties[key].type === 'string' ? 12345 : true;
  const broken = clone(sample[tag]);
  broken[key] = wrongType;
  const errors = errorsFor(schema[tag], broken);
  chk(errors.some((e) => e.startsWith(`${key}:`)), `${tag}: wrong type at ${key} is rejected`,
      errors.slice(0, 1));
}

// ---- the validator itself ------------------------------------------------
chk(errorsFor({ type: 'integer' }, true).length === 1, 'bool fails an integer field');
chk(errorsFor({ type: 'integer' }, 5).length === 0, 'an integer passes an integer field');
chk(errorsFor({ type: 'number' }, 5.5).length === 0, 'a float passes a number field');
try {
  errorsFor({ type: 'string', minLength: 1 }, 'x');
  chk(false, 'an unsupported keyword is refused rather than ignored');
} catch (err) {
  chk(/minLength/.test(err.message), 'an unsupported keyword is refused rather than ignored',
      err.message);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
