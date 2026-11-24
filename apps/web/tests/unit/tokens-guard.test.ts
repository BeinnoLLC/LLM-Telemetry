import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const web = process.cwd();
const root = resolve(web, "../..");
const pythonTokens = join(root, "src/llm_telemetry/web/css/tokens.css");
const stylesStub = join(web, "styles/tokens.css");
const appStub = join(web, "app/tokens.css");
const globals = join(web, "app/globals.css");

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === ".next") return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return extname(path) === ".css" ? [path] : [];
  });
}

describe("token forwarding (RUN A1, LLMTELEMET-291)", () => {
  it("forwards to the Python token sheet with a valid relative import", () => {
    const stub = existsSync(stylesStub) ? stylesStub : appStub;
    expect(existsSync(stub), "token forwarding stub is missing").toBe(true);
    const match = readFileSync(stub, "utf8").match(/@import\s+["']([^"']+)["']/);
    expect(match, "stub has no @import").not.toBeNull();
    expect(resolve(dirname(stub), match![1])).toBe(pythonTokens);
    expect(existsSync(pythonTokens), "Python token sheet is missing").toBe(true);
  });

  it("keeps hex colour literals out of app CSS", () => {
    const leaks = cssFiles(web).filter((path) => /#[0-9a-fA-F]{3,8}\b/.test(readFileSync(path, "utf8")));
    expect(leaks).toEqual([]);
  });

  it("honours prefers-reduced-motion", () => {
    expect(readFileSync(globals, "utf8")).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });
});
