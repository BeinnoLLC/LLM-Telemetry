/** T-6 (LLMTELEMET-285) live-collector port tests.
 *
 * Names describe the rules enforced: the Python collect_live semantics, one
 * test per rule that would silently change the Live payload if it broke.
 */
import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { join, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  classifySession,
  cleanTitle,
  foldModels,
  resolveTitle,
  sourceLabel,
  buildLive,
  localIsoSeconds,
} from "../../src/collectLive.js";
import { buildAgents, type Heartbeat, type Lease } from "../../src/agentsAlive.js";
import { estimateBytes, isLan, canonicalEndpoint, uploadTokens, splitRow } from "../../src/bandwidth.js";
import { localRates } from "../../src/energy.js";
import { isFreeTier, isLocal, priceRow, pyRound } from "../../src/pricing.js";
import { scrubSecrets, tailErrors, classify } from "../../src/failures.js";
import {
  parseClaudeSession,
  parseCodexSession,
  codexTokens,
  codexPhase,
  claudePhase,
  priceTokens,
  buildAgentLive,
  type AgentLiveRow,
} from "../../src/collectAgentLive.js";
import { discoverLiveJsonl, lastEventPhase } from "../../src/collectPiLive.js";
import { isoToUnix, parsePiSessionJsonl } from "../../src/collectPiAgents.js";
import { Config } from "../../src/config.js";
import type { Profile } from "../../src/config.js";
import { makeTmpDir } from "./helpers.js";

/** Point Config.liveProfiles() at fixture profiles (plain objects stand in for
 * the Profile class's name/db/errorsLog getters). */
function stubLiveProfiles(
  cfg: Config,
  profiles: Array<{ name: string; db: string; errorsLog: string }>,
): void {
  (cfg as unknown as { liveProfiles: () => Profile[] }).liveProfiles = () =>
    profiles as unknown as Profile[];
}

function writeJsonl(p: string, events: unknown[]): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

function setMtime(p: string, epochSeconds: number): void {
  utimesSync(p, epochSeconds, epochSeconds);
}

describe("collectLive title rules", () => {
  it("scrubs secrets before any cleanup or truncation", () => {
    expect(scrubSecrets("key ghp_abcdefghijklmnop1234 done")).toContain("[REDACTED]");
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

describe("collectLive category rules (EA.classify CATEGORIES order)", () => {
  it("compressing turns win over everything", () => {
    expect(classifySession("context compression in progress", "bash")).toBe("Compressing");
    expect(classifySession("reviewing pr 12", "bash")).toBe("Reviewing");
  });

  it("waiting beats coding and researching when both match", () => {
    // "editing while waiting" hits Waiting's phrase first (list order), and
    // the Waiting bucket precedes Coding/Researching in EA.CATEGORIES.
    expect(classifySession("editing while waiting", "edit_file")).toBe("Waiting");
    expect(classifySession("waiting to search the web", "web_search")).toBe("Waiting");
  });

  it("thinking language is generating before the tool fallback", () => {
    expect(classifySession("thinking it through", "edit_file")).toBe("Thinking");
  });

  it("coding beats researching on a combined tool list", () => {
    expect(classifySession("", "read_file,edit_file")).toBe("Coding");
  });

  it("reading files is its own bucket", () => {
    expect(classifySession("", "read_file")).toBe("Reading");
    expect(classifySession("reading files now", "bash")).toBe("Reading");
  });
});

describe("bandwidth host-keyed LAN classification", () => {
  it("matches the URL's hostname, never URL substrings", () => {
    // The regression this pins: "10." appearing inside a URL PATH must not
    // read as LAN traffic (Python is_lan matches the parsed hostname only).
    expect(isLan("https://api.openai.com/v1/model-10.2", ["10."], {})).toBe(false);
    expect(isLan("https://10.2.3.4:8080/v1", ["10."], {})).toBe(true);
  });

  it("anchors suffix/prefix patterns to hostname boundaries", () => {
    // ".local" is an endswith; "10." is a startswith; a bare host matches
    // exactly or as `host.startswith(p + ".")` only (Python is_lan).
    expect(isLan("http://gpu-box.local:11434", [".local"], {})).toBe(true);
    expect(isLan("http://gpu-box.localevil.com", [".local"], {})).toBe(false);
    expect(isLan("http://10.0.0.5:8000", ["10."], {})).toBe(true);
    expect(isLan("http://api10.example.com", ["10."], {})).toBe(false);
    expect(isLan("http://mybox", ["mybox"], {})).toBe(true);
    expect(isLan("http://mybox.sub", ["mybox"], {})).toBe(true);
    expect(isLan("http://sub.mybox", ["mybox"], {})).toBe(false);
    expect(isLan("http://myboxer", ["mybox"], {})).toBe(false);
    // Python: host.startswith(p + ".") — "mybox.evil.com" DOES match a bare
    // "mybox" pattern (coarse by design, matched exactly here).
    expect(isLan("http://mybox.evil.com", ["mybox"], {})).toBe(true);
    expect(isLan("http://notmybox.example.com", ["mybox"], {})).toBe(false);
  });

  it("resolves endpoint aliases per hostname before classifying", () => {
    // A publicly-resolving hostname fronting a LAN box: alias keyed by HOST,
    // the alias value is used verbatim as the resolved endpoint.
    const aliases = { "llm.beinno.com": "10.0.0.5:8000" };
    expect(isLan("https://llm.beinno.com/v1", ["10."], aliases)).toBe(true);
    // ...and a substring hit in the alias lookup key must not resolve.
    expect(canonicalEndpoint("https://x.com/llm.beinno.com", aliases)).toBe(
      "https://x.com/llm.beinno.com",
    );
  });

  it("canonicalEndpoint keeps the raw URL when no alias matches", () => {
    expect(canonicalEndpoint("https://api.openai.com/v1", {})).toBe("https://api.openai.com/v1");
    expect(canonicalEndpoint("host:8000", { host: "10.0.0.5:8000" })).toBe("10.0.0.5:8000");
    expect(canonicalEndpoint(null, {})).toBeNull();
  });
});

describe("bandwidth upload rule", () => {
  it("cache_read counts as upload (prefix caching re-sends the prompt)", () => {
    // Exercise the actual upload rule end to end, not a vacuous estimateBytes
    // round-trip: cache_read is deliberately INCLUDED in the upload.
    expect(uploadTokens(10, 30)).toBe(40);
    expect(uploadTokens(10, 30, 50)).toBe(50); // cache_write floors at its own size
    expect(uploadTokens(10, 30, 20)).toBe(40);
    expect(uploadTokens(null, null)).toBe(0);
    const wan = splitRow("https://api.openai.com/v1", 10, 5, 30, 0, ["10."], {});
    expect(wan.up).toBe(estimateBytes(40)); // input + cache_read
    expect(wan.down).toBe(estimateBytes(5));
    expect(wan.lanUp).toBe(0);
    const lan = splitRow("http://10.0.0.5:8000/v1", 10, 5, 30, 0, ["10."], {});
    expect(lan.lanUp).toBe(estimateBytes(40));
    expect(lan.lanDown).toBe(estimateBytes(5));
    expect(lan.up).toBe(0);
  });
});

describe("pi live discovery depth (real layout)", () => {
  it("finds agent*/sessions/*/*.jsonl — depth 2, not 3", () => {
    const dir = makeTmpDir("pi-disc-");
    const now = Date.now() / 1000;
    // The real layout: agent*/sessions/<slug>/<file>.jsonl (depth 2 under
    // sessions/). The old walk looked one level deeper and skipped every one.
    const real = join(dir, "agent-pv", "sessions", "sess-slug", "sess-file.jsonl");
    writeJsonl(real, [{ type: "session", id: "s1", timestamp: "2026-01-01T00:00:00Z", cwd: "/w" }]);
    // Wrong depths that must NOT match the glob:
    const tooDeep = join(dir, "agent-pv", "sessions", "a", "b", "c.jsonl");
    const tooShallow = join(dir, "agent-pv", "sessions", "top.jsonl");
    writeJsonl(tooDeep, [{}]);
    writeJsonl(tooShallow, [{}]);
    const out = discoverLiveJsonl(dir, now + 5, 180);
    expect(out).toEqual([real]);
  });

  it("drops stale session files and skips dot-prefixed names", () => {
    const dir = makeTmpDir("pi-disc-");
    const now = Date.now() / 1000;
    const fresh = join(dir, "agent-pv", "sessions", "slug-a", "fresh.jsonl");
    const stale = join(dir, "agent-pv", "sessions", "slug-b", "stale.jsonl");
    writeJsonl(fresh, [{}]);
    writeJsonl(stale, [{}]);
    setMtime(stale, now - 600);
    const hidden = join(dir, ".agent-x", "sessions", "slug-c", "hid.jsonl");
    writeJsonl(hidden, [{}]);
    const out = discoverLiveJsonl(dir, now + 5, 180);
    expect(out).toEqual([fresh]);
  });
});

describe("pi session parse strictness (Python += TypeError drops)", () => {
  const base = (usage: unknown): unknown[] => [
    { type: "session", id: "s1", timestamp: "2026-01-01T00:00:00Z", cwd: "/w" },
    { type: "message", message: { role: "assistant" }, usage },
  ];

  it("drops the whole session on a non-numeric usage value", () => {
    // Python `session.input_tokens += usage.get("input", 0)` raises TypeError
    // on a string value and the except clause returns None for the file.
    const dir = makeTmpDir("pi-parse-");
    const bad = join(dir, "bad.jsonl");
    writeJsonl(bad, base({ input: "12" }));
    expect(parsePiSessionJsonl(bad)).toBeNull();
    const good = join(dir, "good.jsonl");
    writeJsonl(good, base({ input: 12, output: 3, cost: { total: 0.5 } }));
    const s = parsePiSessionJsonl(good);
    expect(s?.inputTokens).toBe(12);
    expect(s?.outputTokens).toBe(3);
    expect(s?.totalCost).toBe(0.5);
  });
});

describe("pi last event phase keeps raw tool names", () => {
  // Real PI message events nest role/content under event.message (verified
  // against ~/.pi/agent*/sessions/*/*.jsonl and Python's event.get("message")).
  it("renders `running <tool>` with the tool name verbatim (no safeName)", () => {
    const now = Date.now() / 1000;
    const evs = [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", name: "weird tool!" }],
        },
        timestamp: new Date((now - 5) * 1000).toISOString(),
      },
    ];
    expect(lastEventPhase(evs)[1]).toBe("running weird tool!");
  });

  it("prefers the tool call, then text, then thinking", () => {
    const now = Date.now() / 1000;
    const at = (s: number): string => new Date((now - s) * 1000).toISOString();
    const evs = [
      { type: "message", timestamp: at(30), message: { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }] } },
      { type: "message", timestamp: at(20), message: { role: "assistant", content: [{ type: "text", text: "working on it" }] } },
      { type: "message", timestamp: at(10), message: { role: "assistant", content: [{ type: "toolCall", name: "bash" }] } },
    ];
    expect(lastEventPhase(evs)[1]).toBe("running bash");
    expect(lastEventPhase(evs.slice(0, 2))[1]).toBe("working on it");
    expect(lastEventPhase(evs.slice(0, 1))[1]).toBe("thinking");
    // Python returns (last_event_unix_ts, phase) — the ts feeds idle_s.
    expect(lastEventPhase(evs)[0]).toBeCloseTo(now - 10, 0);
  });
});

describe("agent worker session identity is the file stem", () => {
  it("two same-id Claude transcripts collapse to one row keyed by stem", () => {
    const dir = makeTmpDir("claude-dup-");
    const now = Date.now() / 1000;
    const claudeHome = join(dir, "claude");
    // Two transcript files whose records ALL share message-level sessionId
    // "SAME-ID" — and the same stem, like a session copied across login homes.
    const older = join(claudeHome, "projects", "proj-a", "dup.jsonl");
    const newer = join(claudeHome, "projects", "proj-b", "dup.jsonl");
    const msg = (sid: string, model: string, age: number): unknown[] => [
      { type: "user", sessionId: sid, timestamp: new Date((now - age) * 1000).toISOString(), cwd: "/w/proj" },
      {
        type: "assistant",
        sessionId: sid, // message-level id: must NOT become the row identity
        timestamp: new Date((now - age + 1) * 1000).toISOString(),
        cwd: "/w/proj",
        message: { model, role: "assistant", content: [], usage: { input_tokens: 5, output_tokens: 2 } },
      },
    ];
    writeJsonl(older, msg("SAME-ID", "claude-old-1", 60));
    writeJsonl(newer, msg("SAME-ID", "claude-new-2", 10));
    setMtime(older, now - 60);
    setMtime(newer, now - 10);

    // The stem is the identity even when message ids differ across files.
    expect(parseClaudeSession(older)?.sessionId).toBe("dup");
    expect(parseClaudeSession(newer)?.sessionId).toBe("dup");

    const rows = buildAgentLive({
      cfg: new Config(),
      catalog: {},
      now,
      claudeHome,
      // hermetic: without this the real ~/.codex and agent-logins are scanned,
      // so a live codex session on the host adds rows and breaks the count
      codexHome: join(dir, "codex"),
      env: { LLM_TELEMETRY_AGENT_LOGINS: join(dir, "no-logins") },
    });
    expect(rows).toHaveLength(1);
    const row = rows[0] as AgentLiveRow;
    expect(row.session_id).toBe("dup");
    // newest-mtime file wins the row data
    expect(row.model).toBe("claude-new-2");
  });

  it("returns null when neither head nor tail yields events", () => {
    const dir = makeTmpDir("claude-empty-");
    const empty = join(dir, "empty.jsonl");
    writeFileSync(empty, "");
    expect(parseClaudeSession(empty)).toBeNull();
    expect(parseCodexSession(empty)).toBeNull();
    // garbage-only files yield no events -> no phantom rows
    const junk = join(dir, "junk.jsonl");
    writeFileSync(junk, "{not json\n\n");
    expect(parseClaudeSession(junk)).toBeNull();
  });

  it("claude phase end_turn settles to idle", () => {
    const dir = makeTmpDir("claude-");
    const p = join(dir, "sess.jsonl");
    writeJsonl(p, [
      { type: "user", timestamp: "2026-01-01T00:00:00Z" },
      { type: "assistant", timestamp: "2026-01-01T00:00:01Z", message: { model: "claude-3-5-sonnet-20241022", content: [{ type: "text", text: "hi" }], stop_reason: "end_turn" } },
    ]);
    const s = parseClaudeSession(p);
    expect(s?.phase).toBe("idle");
    expect(s?.model).toBe("claude-3-5-sonnet-20241022");
    expect(s?.sessionId).toBe("sess"); // file stem, not the message-level id
  });

  it("codex falls back to the trailing UUID of the stem, else the stem", () => {
    const dir = makeTmpDir("codex-sid-");
    const uuid = "0188a7b8-9cde-5f01-2345-6789abcdef01";
    const withUuid = join(dir, `${uuid}.jsonl`);
    writeJsonl(withUuid, [{ type: "turn_context", timestamp: "2026-01-01T00:00:00Z", payload: {} }]);
    expect(parseCodexSession(withUuid)?.sessionId).toBe(uuid);
    const plain = join(dir, "rollout-2026-01-01T00-00-01-plain.jsonl");
    writeJsonl(plain, [{ type: "turn_context", timestamp: "2026-01-01T00:00:00Z", payload: {} }]);
    expect(parseCodexSession(plain)?.sessionId).toBe("rollout-2026-01-01T00-00-01-plain");
  });

  it("codex identity/cwd/model come from head session_meta only", () => {
    const dir = makeTmpDir("codex-meta-");
    const p = join(dir, "rollout-1.jsonl");
    writeJsonl(p, [
      // head: session_meta carries id/cwd/model (first match wins)
      { type: "session_meta", timestamp: "2026-01-01T00:00:00Z", payload: { id: "cs-1", cwd: "/w/codex", model: "gpt-5-codex" } },
      // a response_item cwd must NOT leak into identity
      { type: "response_item", timestamp: "2026-01-01T00:00:01Z", payload: { type: "message", role: "assistant", cwd: "/WRONG", id: "WRONG" } },
      // tail: turn_context re-reads model/cwd only
      { type: "turn_context", timestamp: "2026-01-01T00:00:02Z", payload: { model: "gpt-5-codex-2", cwd: "/w/codex-2" } },
    ]);
    const s = parseCodexSession(p);
    expect(s?.sessionId).toBe("cs-1");
    expect(s?.model).toBe("gpt-5-codex-2");
    expect(s?.cwd).toBe("/w/codex-2");
    expect(s?.phase).toBe("responding"); // the message response_item in the tail
  });
});

describe("codex tokens read the real event_msg/token_count shape", () => {
  it("takes the newest cumulative total_token_usage under payload.info", () => {
    const count = (input: number, cached: number, output: number): Record<string, unknown> => ({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: input,
            cached_input_tokens: cached,
            output_tokens: output,
          },
        },
      },
    });
    const events = [count(100, 30, 20), count(200, 50, 40)];
    // Newest event is the session total; input_tokens INCLUDES the cached
    // ones, which are split out here.
    expect(codexTokens(events, "gpt-5-codex")).toEqual({
      "gpt-5-codex": { input: 150, output: 40, cache_read: 50, cache_write: 0 },
    });
    // A Codex session with no model is grouped under "", never "codex".
    expect(codexTokens(events, null)).toEqual({
      "": { input: 150, output: 40, cache_read: 50, cache_write: 0 },
    });
  });

  it("ignores the old top-level token_count shape", () => {
    const old = [{ type: "token_count", payload: { total_token_usage: { input_tokens: 9 } } }];
    expect(codexTokens(old, "m")).toBeNull();
  });
});

describe("codex phase covers all Python branches", () => {
  it("response_item tool calls run, outputs/reasoning think, messages respond", () => {
    expect(codexPhase({ type: "response_item", payload: { type: "function_call", name: "shell" } })).toBe("running shell");
    expect(codexPhase({ type: "response_item", payload: { type: "custom_tool_call", name: "web!_search" } })).toBe("running web_search");
    expect(codexPhase({ type: "response_item", payload: { type: "local_shell_call" } })).toBe("running shell");
    expect(codexPhase({ type: "response_item", payload: { type: "function_call" } })).toBe("running tool");
    expect(codexPhase({ type: "response_item", payload: { type: "function_call_output" } })).toBe("thinking");
    expect(codexPhase({ type: "response_item", payload: { type: "custom_tool_call_output" } })).toBe("thinking");
    expect(codexPhase({ type: "response_item", payload: { type: "reasoning" } })).toBe("thinking");
    expect(codexPhase({ type: "response_item", payload: { type: "message", role: "user" } })).toBe("thinking");
    expect(codexPhase({ type: "response_item", payload: { type: "message", role: "assistant" } })).toBe("responding");
  });

  it("event_msg task lifecycle: complete/abort/shutdown idle, started/user think", () => {
    expect(codexPhase({ type: "event_msg", payload: { type: "task_complete" } })).toBe("idle");
    expect(codexPhase({ type: "event_msg", payload: { type: "turn_aborted" } })).toBe("idle");
    expect(codexPhase({ type: "event_msg", payload: { type: "shutdown_complete" } })).toBe("idle");
    expect(codexPhase({ type: "event_msg", payload: { type: "task_started" } })).toBe("thinking");
    expect(codexPhase({ type: "event_msg", payload: { type: "user_message" } })).toBe("thinking");
    expect(codexPhase({ type: "event_msg", payload: { type: "agent_message" } })).toBeNull();
    expect(codexPhase({ type: "other", payload: {} })).toBeNull();
    expect(claudePhase({ type: "assistant", message: { content: [{ type: "thinking" }] } })).toBe("thinking");
    expect(claudePhase({ type: "assistant", message: { content: "x" } })).toBe("responding");
  });
});

describe("priceTokens returns exactly the six Python price_tokens keys", () => {
  const cfg = new Config();
  const t = (n: number): Record<string, number> => ({ input: n, output: n, cache_read: 0, cache_write: 0 });
  const sixKeys = [
    "cache_read_tok",
    "cache_write_tok",
    "cost_class",
    "cost_usd",
    "in_tok",
    "out_tok",
  ];

  it("priced model: 4-decimal cost, no extra priced/rate_source keys", () => {
    const out = priceTokens("codex", { "gpt-6-astra": t(10) }, {}, cfg);
    expect(Object.keys(out).sort()).toEqual(sixKeys);
    expect(typeof out["cost_usd"]).toBe("number");
    expect(out["cost_usd"]).toBe(pyRound(out["cost_usd"] as number, 4));
    expect(out["cost_class"]).toBe("subscription");
  });

  it("unpriced model: cost_usd is null (never a real $0), same six keys", () => {
    const out = priceTokens("claude", { "zz-made-up-model-zz": t(10) }, {}, cfg);
    expect(Object.keys(out).sort()).toEqual(sixKeys);
    expect(out["cost_usd"]).toBeNull();
  });

  it("one unpriced model anywhere un-prices the whole session (AND, not OR)", () => {
    const out = priceTokens("codex", {
      "gpt-6-astra": t(10),
      "zz-made-up-model-zz": t(10),
    }, {}, cfg);
    expect(out["cost_usd"]).toBeNull();
    expect(out["in_tok"]).toBe(20);
    expect(out["priced"]).toBeUndefined();
    expect(out["rate_source"]).toBeUndefined();
  });

  it("no tokens at all yields no fields", () => {
    expect(priceTokens("claude", null, {}, cfg)).toEqual({});
  });
});

/** Local-wall-time epoch the way Python reads a naive datetime: same
 * machine, same timezone, so `datetime.timestamp()` and the local Date
 * constructor must agree. */
function localEpoch(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): number {
  const dt = new Date(0);
  dt.setFullYear(y, mo - 1, d);
  dt.setHours(h, mi, s, ms);
  return dt.getTime() / 1000;
}

describe("isoToUnix matches Python _iso_to_unix (fromisoformat, now fallback)", () => {
  it("now fallback on unparseable input", () => {
    const n = Date.now() / 1000;
    for (const bad of ["abc", "", "2026", "2026-10", "2026-10-15T24:00:00", "2026-02-30", "2026-1-15", "T21:04:60", "2021-W53-1", "20261015T21042"]) {
      const v = isoToUnix(bad);
      expect(v).toBeGreaterThanOrEqual(n - 0.5);
      expect(v).toBeLessThan(n + 5);
    }
    // Non-strings raise AttributeError in Python -> same "now" fallback.
    const v = (isoToUnix as unknown as (x: unknown) => number)(123);
    expect(v).toBeGreaterThanOrEqual(n - 0.5);
  });

  it("Z timestamps keep their epoch (existing behavior preserved)", () => {
    expect(isoToUnix("2026-10-15T21:04:25Z")).toBe(1792098265);
    expect(isoToUnix("2026-10-15T21:04:25.681Z")).toBe(1792098265.681);
    expect(isoToUnix("2026-10-15T21:04:25.681212345Z")).toBe(1792098265.681212);
    expect(isoToUnix("2026-10-15T21:04:25-03:30")).toBe(1792098265 + 3.5 * 3600);
  });

  it("valid timestamps the old Date.parse path rejected now parse", () => {
    expect(isoToUnix("2026-10-15T21:04:25+03")).toBe(1792098265 - 3 * 3600);
    expect(isoToUnix("2026-10-15T21:04:25+0330")).toBe(1792098265 - (3 * 3600 + 30 * 60));
    expect(isoToUnix("2026-10-15T210425.6812+00:00")).toBe(1792098265.6812);
  });

  it("compact and separator-variant forms like CPython 3.12", () => {
    expect(isoToUnix("2026-10-15T210425Z")).toBe(1792098265);
    expect(isoToUnix("20261015T210425Z")).toBe(1792098265);
    expect(isoToUnix("2026-10-15 21:04:25+00:00")).toBe(1792098265);
    expect(isoToUnix("2026-10-15T21,25+00:00")).toBe(1792098000.25);
    expect(isoToUnix("2026-10-15T21:04.25+00:00")).toBe(1792098240.25);
  });

  it("naive timestamps read as local wall time, like datetime.timestamp()", () => {
    expect(isoToUnix("2026-10-15")).toBe(localEpoch(2026, 10, 15));
    expect(isoToUnix("2026-10-15T21:04:25")).toBe(localEpoch(2026, 10, 15, 21, 4, 25));
    expect(isoToUnix("20261015")).toBe(localEpoch(2026, 10, 15));
  });

  it("ISO week dates resolve like date.fromisocalendar", () => {
    expect(isoToUnix("2026-W42-3")).toBe(localEpoch(2026, 10, 14));
    expect(isoToUnix("2026W423")).toBe(localEpoch(2026, 10, 14));
    expect(isoToUnix("2026-W42")).toBe(localEpoch(2026, 10, 12));
    expect(isoToUnix("2026W42")).toBe(localEpoch(2026, 10, 12));
    expect(isoToUnix("2020-W53-1")).toBe(localEpoch(2020, 12, 28));
    expect(isoToUnix("2026-W41-6")).toBe(1791579600);
  });

  it("Python lenient edge forms (verified against the 3.12.3 venv)", () => {
    expect(isoToUnix("2026-10-15T21+00:00")).toBe(1792098000); // hour-only + tz
    expect(isoToUnix("2026-10-15521:04Z")).toBe(1792098240); // digit separator
    expect(isoToUnix("2026W421Z")).toBe(localEpoch(2026, 10, 12)); // greedy day
    expect(isoToUnix("2026-10-15T21:04:25+03:60")).toBe(1792098265 - 4 * 3600); // carried offset
  });

  it("invalid forms Python rejects fall back to now (no false epochs)", () => {
    const n = Date.now() / 1000;
    for (const bad of ["2026W4212:04", "2026W9", "2026-W4-2", "2026-02-29", "2026-10-15T21:60", "+24:00"]) {
      const v = isoToUnix(bad);
      expect(v).toBeGreaterThanOrEqual(n - 0.5);
      expect(v).toBeLessThan(n + 5);
    }
  });
});

describe("session classification, models, rounding", () => {
  it("classifySession maps idle text to Idle", () => {
    expect(classifySession("Idle", "")).toBe("Idle");
    // "working on it" carries no EA.CATEGORIES signal and no tools -> Idle.
    expect(classifySession("working on it", "")).toBe("Idle");
    expect(classifySession("", "mystery_tool")).toBe("Working");
  });

  it("foldModels groups rows per session", () => {
    const rows = [["s1", "m1", "main", 1, 1, 1, 1, "u"]];
    expect(foldModels(rows)["s1"]?.[0]?.model).toBe("m1");
    expect(foldModels(rows)["s1"]?.[0]?.calls).toBe(1);
    expect(foldModels([])).toEqual({});
  });

  it("pyRound is Python ties-even, not toFixed ties-away", () => {
    expect(pyRound(0.123456789, 6)).toBe(0.123457);
    // 0.125 is an exact binary tie: Python round() -> 0.12 (to even), toFixed -> 0.13
    expect(pyRound(0.125, 2)).toBe(0.12);
    // classic: 2.675 is 2.6749... in binary -> 2.67 in Python
    expect(pyRound(2.675, 2)).toBe(2.67);
  });

  it("agentsAlive counts leases per backend pid", () => {
    const hbs: Heartbeat[] = [
      { backend_id: "b1", pid: 1, started_at: 0, last_heartbeat: 95, profile: "p", host: "this" },
    ];
    const leases: Lease[] = [
      { conversation_id: "c1", holder: "pid=1:b1", acquired_at: 0, expires_at: 0 },
    ];
    const rows = buildAgents(hbs, leases, "this", 100, () => true);
    expect(rows[0]?.leases).toBe(1);
  });

  it("an empty pid= lease holder is dropped, never pid 0", () => {
    // Python `int(part[4:])` raises on "" and the lease is not counted;
    // Number("") would invent a pid=0 row.
    const hbs: Heartbeat[] = [
      { backend_id: "b1", pid: 1, started_at: 0, last_heartbeat: 95, profile: "p", host: "this" },
    ];
    const leases: Lease[] = [
      { conversation_id: "c1", holder: "pid=:b1", acquired_at: 0, expires_at: 0 },
    ];
    const rows = buildAgents(hbs, leases, "this", 100, () => true);
    expect(rows[0]?.leases).toBe(0);
  });
});

describe("live payload timestamp", () => {
  it("generated is local wall time (no Z / offset suffix)", () => {
    // Python: datetime.now().isoformat(timespec="seconds") — LOCAL time. The
    // old toISOString().slice(0,19) silently shifted by the host UTC offset.
    const s = localIsoSeconds(new Date(2026, 0, 2, 3, 4, 5));
    expect(s).toBe("2026-01-02T03:04:05");
    expect(s).not.toMatch(/Z$|[+-]\d{2}:\d{2}$/);
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

  it("leases attach by holder pid, not conversation id", () => {
    const rows = buildAgents(hbs, leases, "this", 100, () => true);
    expect(rows[0]?.leases).toBe(1);
  });
});

describe("bandwidth + energy", () => {
  it("bytes estimate truncates at 4.68 bytes per token", () => {
    expect(estimateBytes(1000)).toBe(4680);
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
});

describe("failures", () => {
  it("classifies failure kinds in Python KINDS order", () => {
    expect(classify("2026-01-01 00:00:00 HTTP 429 model=x")).toBe("rate_limit");
    expect(classify("2026-01-01 00:00:00 HTTP 503 model=x")).toBe("overloaded");
  });

  it("tail_errors keeps only model/status failures inside the window", () => {
    const dir = makeTmpDir("fail-");
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

describe("buildLive end to end", () => {
  it("builds one classified session row with models and bandwidth", () => {
    const dir = makeTmpDir("live-e2e-");
    const now = Date.now() / 1000;
    const dbPath = join(dir, "live.db");
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
