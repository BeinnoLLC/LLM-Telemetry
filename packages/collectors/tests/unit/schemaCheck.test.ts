import * as fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, stamp } from "../../src/schema.js";
import {
  SchemaError,
  TAGS,
  check,
  errorsFor,
  load,
  validate,
  type SchemaTag,
} from "../../src/schemaCheck.js";
import { demoPayload } from "../../src/cli.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("schema stamp", () => {
  it("sets schema_version in place and returns the payload", () => {
    const p: Record<string, unknown> = {};
    expect(stamp(p)).toBe(p);
    expect(p["schema_version"]).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(3); // shared with src/llm_telemetry/schema.py
  });
});

describe("schema check pass/fail (parity with python schema_check)", () => {
  it("passes a minimal live payload", () => {
    expect(check("live", stamp(demoPayload()))).toBeTruthy();
  });

  it("fails on a missing required key with python's message shape", () => {
    const payload = stamp(demoPayload());
    delete payload["profiles"];
    expect(() => check("live", payload)).toThrow(SchemaError);
    const errs = errorsFor(payload, load("live"), "live payload");
    expect(errs).toContain("<root>: required key 'profiles' is missing");
  });

  it("fails on a wrong type with python's message shape", () => {
    const payload = stamp(demoPayload());
    payload["bytes_per_token"] = "x";
    const errs = errorsFor(payload, load("live"), "live payload");
    expect(errs).toContain("bytes_per_token: expected null or number, found string");
  });

  it("keeps bool out of integer (python `_type_ok` rule)", () => {
    const errs = errorsFor(
      { n: true },
      { type: "object", properties: { n: { type: "integer" } }, required: ["n"] },
    );
    expect(errs).toEqual(["n: expected integer, found boolean"]);
  });

  it("enforces an additionalProperties sub-schema on extra keys", () => {
    const schema = {
      type: "object",
      properties: { known: { type: ["null", "string"] } },
      additionalProperties: { type: ["null", "number"] },
    };
    expect(errorsFor({ known: "ok", extra: 1 }, schema)).toEqual([]);
    expect(errorsFor({ extra: "bad" }, schema)).toEqual([
      "extra: expected null or number, found string",
    ]);
  });

  it("reports every problem and truncates with python's summary line", () => {
    const payload: Record<string, unknown> = { schema_version: 3 };
    // 12 distinct wrong-typed keys > the validate() limit of 8.
    const schemaProps: Record<string, unknown> = {};
    for (let i = 0; i < 12; i++) {
      payload[`k${i}`] = "x";
      schemaProps[`k${i}`] = { type: "number" };
    }
    const schema = { type: "object", properties: schemaProps };
    try {
      validate(payload, schema);
      expect.unreachable("validate must throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("schema: 12 problem(s)");
      expect(msg).toContain("\n  ... and 4 more");
    }
  });

  it("rejects unknown schema keywords instead of ignoring them (P1-02)", () => {
    expect(() =>
      validate({}, { type: "object", pattern: { x: 1 } }),
    ).toThrow(/unsupported schema keyword\(s\) pattern/);
  });

  it("rejects unknown types in a schema", () => {
    expect(() => validate(1, { type: "wat" })).toThrow("unknown type 'wat' in schema");
  });

  it("rejects unknown payload tags with python's message", () => {
    expect(() => load("nope")).toThrow(
      "unknown payload 'nope' (known: analytics, live, ollama, router)",
    );
    expect([...TAGS].sort()).toEqual(["analytics", "live", "ollama", "router"]);
  });

  it("rejects a non-object schema node", () => {
    expect(() => validate({}, true as unknown)).toThrow(
      "schema: schema node is boolean, not an object",
    );
  });

  // Parity anchor: the SAME committed samples that `python -m
  // llm_telemetry.schema_check` validates in CI must pass this validator — the
  // schemas stay the shared contract (migration plan §1/§8).
  for (const tag of TAGS as readonly SchemaTag[]) {
    it(`the committed ${tag} sample passes the shared schema`, () => {
      const path = join(REPO_ROOT, "examples", "reports", `${tag}-data.json`);
      const payload = JSON.parse(fs.readFileSync(path, "utf8")) as unknown;
      expect(check(tag, payload)).toBe(payload);
    });
  }
});
