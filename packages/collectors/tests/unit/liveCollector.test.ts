/** T-6 (LLMTELEMET-285) live-collector port tests.
 *
 * Names describe the rules enforced: the Python collect_live semantics, one
 * test per rule that would silently change the Live payload if it broke.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  classifySession,
  cleanTitle,
  foldModels,
  resolveTitle,
  sourceLabel,
  buildLive,
} from "../../src/collectLive.js";
import { buildAgents, type Heartbeat, type Lease } from "../../src/agentsAlive.js";
import { estimateBytes, isLan, canonicalEndpoint } from "../../src/bandwidth.js";
import { localRates } from "../../src/energy.js";
import { isFreeTier, isLocal, priceRow, pyRound } from "../../src/pricing.js";
import { scrubSecrets, tailErrors, classify } from "../../src/failures.js";
import { Config } from "../../src/config.js";
import type { Profile } from "../../src/config.js";

/** Point Config.liveProfiles() at fixture profiles (plain objects stand in for
 * the Profile class's name/db/errorsLog getters). */
function stubLiveProfiles(
  cfg: Config,
  profiles: Array<{ name: string; db: string; errorsLog: string }>,
): void {
  (cfg as unknown as { liveProfiles: () => Profile[] }).liveProfiles = () =>
    profiles as unknown as Profile[];
}

describe("collectLive title rules", () => {
  it("scrubs secrets before any cleanup or truncation", () => {
    expect(scrubSecrets("key ghp_abcdefghijklmnop123456 done")).toContain("[REDACTED]");
    expect(cleanTitle("api_key=sk-abcdefgh1234 please")).not.toContain("sk-abcdefgh");
  });

  it("keeps a real title verbatim (scrubbed + trimmed only)", () => {
    expect(resolveTitle("Fix the  login bug", null)).toBe("Fix the login bug");
  });

  it("falls back to the cleaned first user message for surface titles", () => {
    expect(resolveTitle("Bot Chat", "deploy https://host/x/y the thing")).toBe(
      "deploy host the thing",
    );
  });

  it("reduces a bot-relay envelope to Name: body", () => {
    expect(cleanTitle("Message from \ud83d\ude00 Alice (@alice): ship it")).toBe("Alice: ship it");
  });

  it("keeps file names but drops directories from paths", () => {
    expect(cleanTitle("see /home/user/proj/src/thing.py now")).toBe("see thing.py now");
  });

  it("marks an empty session untitled", () => {
    expect(resolveTitle("", "")).toBe("(untitled)");
    expect(resolveTitle("TUI", "  ")).toBe("(untitled)");
  });

  it("labels unknown sources as Bot Chat", () => {
    expect(sourceLabel("")).toBe("Bot Chat");
    expect(sourceLabel("tui")).toBe("TUI");
    expect(sourceLabel("my bot")).toBe("My Bot");
  });
});

describe("collectLive classify", () => {
  it("phase text wins outright over tool names", () => {
    // phrase match is substring-based: "command running" hits the Running bucket
    expect(classifySession("command running", "web_search")).toBe("Running");
    expect(classifySession("editing file", "")).toBe("Coding");
  });

  it("falls back to recent tools only when the phase carries no signal", () => {
    expect(classifySession("", "read_file,web_search")).toBe("Researching");
  });

  it("stream/turn/thinking phases are Generating", () => {
    expect(classifySession("streaming", "")).toBe("Generating");
  });

  it("no phase and no tools is Idle; tools without signal is Working", () => {
    expect(classifySession("", "")).toBe("Idle");
    expect(classifySession("", "mystery_tool")).toBe("Working");
  });
});

describe("collectLive fold_models", () => {
  it("groups per model, main first, then newest", () => {
    const rows = [
      ["s1", "m-main", "main", 3, 10, 2, 100, "https://api"],
      ["s1", "m-help", "helper", 1, 5, 1, 200, "https://api2"],
    ];
    const out = foldModels(rows);
    expect(out["s1"]?.[0]?.model).toBe("m-main");
    expect(out["s1"]?.[0]?.main).toBe(true);
    expect(out["s1"]?.[1]?.model).toBe("m-help");
    expect(out["s1"]?.[0]?.calls).toBe(3);
  });
});

describe("agentsAlive build_agents", () => {
  const hbs: Heartbeat[] = [
    {
      backend_id: "b1", pid: 1, started_at: 10, last_heartbeat: 95,
      profile: "p", host: "this",
    },
  ];
  const leases: Lease[] = [
    { conversation_id: "c", holder: "pid=1:b1", acquired_at: 9, expires_at: 999 },
  ];

  it("fresh heartbeat + /proc present is alive", () => {
    const rows = buildAgents(hbs, [], "this", 100, () => true);
    expect(rows[0]?.state).toBe("alive");
    expect(rows[0]?.leases).toBe(0);
  });

  it("past the threshold it goes stale", () => {
    const rows = buildAgents(hbs, [], "other", 95 + 121, () => true);
    expect(rows[0]?.state).toBe("stale");
    expect(rows[0]?.kill_hint).toBeNull();
  });

  it("/proc absence on THIS host marks dead with a kill hint", () => {
    const rows = buildAgents(hbs, [], "this", 100, () => false);
    expect(rows[0]?.state).toBe("dead");
    expect(rows[0]?.kill_hint).toBe("kill 1");
  });

  it("never asserts dead-by-pid across a host boundary", () => {
    const rows = buildAgents(hbs, [], "other-host", 100, () => null);
    expect(rows[0]?.state).toBe("alive");
  });

  it("leases count per pid from the holder string", () => {
    const rows = buildAgents(hbs, leases, "this", 100, () => true);
    expect(rows[0]?.leases).toBe(1);
    expect(rows[0]?.state).toBe("alive");
  });
});

describe("bandwidth + energy", () => {
  it("bytes estimate truncates at 4.68 bytes per token", () => {
    expect(estimateBytes(1000)).toBe(4680);
  });

  it("cache_read counts as upload", () => {
    expect(estimateBytes(10)).toBe(46);
  });

  it("alias-resolves and recognizes LAN endpoints", () => {
    expect(canonicalEndpoint("http://localhost:11434/", { "http://localhost:11434": "ollama" }))
      .toBe("ollama");
    expect(isLan("http://192.168.1.5:11434", ["192.168."], {})).toBe(true);
    expect(isLan("https://openrouter.ai", ["192.168."], {})).toBe(false);
  });

  it("local rates are derived from the electricity tariff", () => {
    const cfg = new Config();
    const { tps, rates } = localRates("qwen3-coder", cfg);
    expect(tps).toBeGreaterThan(0);
    expect(rates[1]).toBeGreaterThan(0);
  });
});

describe("pricing", () => {
  const cfg = new Config();

  it("free-tier models are free, cloud-suffixed locals are metered", () => {
    expect(isFreeTier("big-pickle")).toBe(true);
    expect(isFreeTier("gpt-5.6-luna:free")).toBe(true);
    expect(isLocal("gpt-oss:120b")).toBe(true);
    expect(isLocal("gpt-oss:120b:cloud")).toBe(false);
  });

  it("built-in rates beat the live catalogue only via RATE_OVERRIDES", () => {
    const row = priceRow(
      { provider: "fireworks", model: "accounts/fireworks/models/glm-5p3", input_tokens: 1000, output_tokens: 0 },
      { "z-ai/glm-5.3": { prompt: 9, completion: 9, input_cache_read: 9 } },
      cfg,
      [],
      {},
    );
    // 1000 tokens * $1.40/1M = 0.0014 (override), not the catalogue's 0.009.
    expect(row.market_value_usd).toBeCloseTo(0.0014, 6);
    expect(row.cost_class).toBe("metered");
  });

  it("market value is kept for subscription rows but never billed", () => {
    const row = priceRow(
      { provider: "openai-codex", model: "gpt-6-astra", input_tokens: 1000000, output_tokens: 0 },
      {},
      cfg,
      [],
      {},
    );
    expect(row.cost_class).toBe("subscription");
    expect(row.billed_usd).toBe(0);
    // 1M input tokens at WEB_RATES $10/1M = market value 10.
    expect(row.market_value_usd).toBeCloseTo(10, 6);
  });

  it("pyRound keeps 6-decimal money stable", () => {
    expect(pyRound(0.123456789, 6)).toBe(0.123457);
  });
});

describe("failures", () => {
  it("classifies failure kinds in Python KINDS order", () => {
    expect(classify("2026-01-01 00:00:00 HTTP 429 model=x")).toBe("rate_limit");
    expect(classify("2026-01-01 00:00:00 HTTP 503 model=x")).toBe("overloaded");
  });

  it("tail_errors keeps only model/status failures inside the window", () => {
    const dir = mkdtempSync(join(tmpdir(), "lst285-"));
    const log = join(dir, "errors.log");
    const now = 1_800_000_000;
    const stamp = new Date(now * 1000);
    const ymd = `${String(stamp.getFullYear()).padStart(4, "0")}-${String(
      stamp.getMonth() + 1,
    ).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")}`;
    const hms = `${String(stamp.getHours()).padStart(2, "0")}:${String(
      stamp.getMinutes(),
    ).padStart(2, "0")}:${String(stamp.getSeconds()).padStart(2, "0")}`;
    writeFileSync(
      log,
      `${ymd} ${hms} [WARN] HTTP 429 rate_limit_error, provider=anthropic, model=claude-sonnet-4-5 (retry 1/4)\n` +
        `${ymd} ${hms} [INFO] all good model=ok\n`,
      "utf8",
    );
    const cfg = new Config();
    stubLiveProfiles(cfg, [{ name: "p1", db: join(dir, "x.db"), errorsLog: log }]);
    const rows = tailErrors(cfg, now, 60, 7200);
    expect(rows.length).toBe(1);
    expect(rows[0]?.kind).toBe("rate_limit");
    expect(rows[0]?.model).toBe("claude-sonnet-4-5");
  });
});

describe("buildLive smoke (read-only SQLite)", () => {
  it("builds the profile payload from a session DB", () => {
    const dir = mkdtempSync(join(tmpdir(), "lst285-db-"));
    const dbPath = join(dir, "sessions.db");
    const now = 1_800_000_000;
    mkdirSync(join(dir, "pi"), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`
      create table sessions (id text, title text, model text, started_at int,
        last_activity_at int, last_activity_description text,
        parent_session_id text, ended_at int, source text, chat_type text,
        end_reason text);
      create table messages (id int, session_id text, ts int, timestamp int, role text,
        content text, tool_name text);
      create table session_model_usage (session_id text, model text, task text,
        api_call_count int, input_tokens int, output_tokens int, cache_read_tokens int,
        last_seen int, billing_base_url text);
    `);
    db.exec(`insert into sessions values ('s1','Bot Chat','glm-5.3',${now - 50},${now - 5},
      'editing file','', null,'tui','dm', null)`);
    db.exec(`insert into messages values (1,'s1',${now - 5},${now - 5},'assistant',
      'patch done','edit_file')`);
    db.exec(`insert into messages values (2,'s1',${now - 6},${now - 6},'user',
      'patch done', '')`);
    db.exec(`insert into session_model_usage values ('s1','glm-5.3','main',2,10,4,3,${now - 5},
      'https://openrouter.ai/api')`);
    db.close();

    const cfg = new Config();
    stubLiveProfiles(cfg, [{ name: "p1", db: dbPath, errorsLog: "" }]);
    const payload = buildLive({
      cfg,
      now,
      piHome: join(dir, "pi"),
      claudeHome: join(dir, "claude"),
      codexHome: join(dir, "codex"),
      thisHost: "h",
      pidExists: () => true,
    });
    const p = payload.profiles["p1"];
    expect(p?.active).toBe(1);
    const row = p?.live[0] as Record<string, unknown>;
    expect(row["category"]).toBe("Coding");
    expect(row["kind"]).toBe("top-level");
    expect(row["switched"]).toBe(false);
    expect(row["models"]).toHaveLength(1);
    // 13 tokens at 4.68 B/token = 60 bytes, WAN (openrouter is not LAN).
    expect(row["up_bytes"]).toBe(estimateBytes(13));
    expect(row["bw_local"]).toBe(false);
    // Title: surface name -> cleaned first user message.
    expect(row["title"]).toBe("patch done");
    expect(payload.bytes_per_token).toBe(4.68);
    expect(payload.pi_live).toEqual([]);
  });
});
