/** Validate a payload against its JSON Schema — T-4 (LST-283) port of
 * src/llm_telemetry/schema_check.py. Behaviour-faithful port, same messages:
 * a schema drift between the two stacks must fail BOTH validators, not one.
 *
 * Deliberately the same small subset of JSON Schema — `type`, `required`,
 * `properties`, `items`, `additionalProperties` — with the same rule that a
 * keyword outside that set is an ERROR rather than being ignored: silently
 * skipping an unknown keyword is how a schema stops enforcing anything
 * (P1-02).
 *
 * The JSON Schemas stay the shared contract and live unchanged in
 * `src/llm_telemetry/schema/*.schema.json`; this module reads them from there
 * (overridable via LLM_TELEMETRY_SCHEMA_DIR for tests).
 *
 * One documented divergence from the Python validator: Python's `json.load`
 * distinguishes 3 from 3.0 (int vs float) while JSON.parse does not, so a
 * literal `3.0` passes an `integer` check here and fails it in Python. JSON
 * data round-tripped through either stack is unaffected (the shipped schemas
 * use `number`).
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expand } from "./config.js";

export type SchemaTag = "analytics" | "live" | "ollama" | "router";

export const TAGS: readonly SchemaTag[] = ["analytics", "live", "ollama", "router"];

const KEYWORDS = ["type", "required", "properties", "items", "additionalProperties"];
const METADATA = ["$schema", "title", "description"];

// src/ under vitest, dist/ after `npm run build` — one level up is the package
// root either way, so the shared schema dir resolves identically from both.
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(HERE);
const SCHEMA_DIR = process.env.LLM_TELEMETRY_SCHEMA_DIR
  ? resolve(expand(process.env.LLM_TELEMETRY_SCHEMA_DIR))
  : join(PKG_ROOT, "..", "..", "src", "llm_telemetry", "schema");

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}

export function schemaPath(tag: string): string {
  return join(SCHEMA_DIR, `${tag}.schema.json`);
}

const cache = new Map<string, unknown>();

export function load(tag: string): unknown {
  if (!TAGS.includes(tag as SchemaTag)) {
    throw new SchemaError(`unknown payload '${tag}' (known: ${TAGS.join(", ")})`);
  }
  if (!cache.has(tag)) {
    cache.set(tag, JSON.parse(readFileSync(schemaPath(tag), "utf8")));
  }
  return cache.get(tag);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON Schema type test, with bool kept out of integer/number (P1-02). */
function typeOk(value: unknown, want: string): boolean {
  switch (want) {
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "null":
      return value === null;
    default:
      throw new SchemaError(`unknown type '${want}' in schema`);
  }
}

/** The JSON type name of a value, for error messages. */
function kind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "number":
      return Number.isInteger(value) ? "integer" : "number";
    case "string":
      return "string";
    default:
      return "object";
  }
}

function walk(
  schema: unknown,
  value: unknown,
  path: string,
  errors: string[],
  where: string,
): void {
  if (!isRecord(schema)) {
    throw new SchemaError(`${where}: schema node is ${kind(schema)}, not an object`);
  }
  const unknown = Object.keys(schema).filter(
    (k) => !KEYWORDS.includes(k) && !METADATA.includes(k),
  );
  if (unknown.length) {
    throw new SchemaError(
      `${where}: unsupported schema keyword(s) ${[...unknown].sort().join(", ")}; ` +
        `the validator implements ${KEYWORDS.join(", ")} only (P1-02)`,
    );
  }
  const want = schema["type"];
  if (want !== undefined && want !== null) {
    const wants = typeof want === "string" ? [want] : [...(want as string[])];
    if (!wants.some((w) => typeOk(value, w))) {
      errors.push(
        `${path || "<root>"}: expected ${wants.join(" or ")}, found ${kind(value)}`,
      );
      return;
    }
  }
  if (isRecord(value)) {
    for (const key of (schema["required"] as string[] | undefined) ?? []) {
      if (!(key in value)) {
        errors.push(`${path || "<root>"}: required key '${key}' is missing`);
      }
    }
    const props = schema["properties"];
    if (props !== undefined && props !== null) {
      const propsRec = props as Record<string, unknown>;
      for (const [key, sub] of Object.entries(propsRec)) {
        if (key in value) {
          walk(sub, value[key], path ? `${path}.${key}` : key, errors, where);
        }
      }
      const extra = schema["additionalProperties"];
      if (extra !== true && extra !== undefined && extra !== null) {
        for (const [key, val] of Object.entries(value)) {
          if (!(key in propsRec)) {
            walk(extra, val, path ? `${path}.${key}` : key, errors, where);
          }
        }
      }
    }
  } else if (Array.isArray(value)) {
    // Python's `schema.get("items")` is truthiness-tested (an empty `items: {}`
    // is skipped there); mirror that so both validators agree on every schema.
    const items = schema["items"];
    if (items !== undefined && items !== null && Object.keys(items as object).length > 0) {
      value.forEach((item, i) => {
        walk(items, item, `${path}[${i}]`, errors, where);
      });
    }
  }
}

/** Every way `payload` fails `schema` (empty when it satisfies it). */
export function errorsFor(payload: unknown, schema: unknown, where = "schema"): string[] {
  const errs: string[] = [];
  walk(schema, payload, "", errs, where);
  return errs;
}

/** Throw SchemaError unless `payload` satisfies `schema` (same message shape
 * as Python's `validate()`, limit included). */
export function validate(
  payload: unknown,
  schema: unknown,
  where = "schema",
  limit = 8,
): void {
  const errs = errorsFor(payload, schema, where);
  if (errs.length) {
    const more = errs.length <= limit ? "" : `\n  ... and ${errs.length - limit} more`;
    throw new SchemaError(
      `${where}: ${errs.length} problem(s)\n  ${errs.slice(0, limit).join("\n  ")}${more}`,
    );
  }
}

/** Validate one of the four collector payloads; throw SchemaError if bad. */
export function check<T>(tag: SchemaTag, payload: T): T {
  validate(payload, load(tag), `${tag} payload`);
  return payload;
}
