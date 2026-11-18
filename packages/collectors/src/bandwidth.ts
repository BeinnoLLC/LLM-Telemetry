/** Bandwidth estimation — T-6 (LLMTELEMET-285), port of `bandwidth.py`.
 *
 * LAN-vs-not drives the "local vs cloud" traffic split in live + analytics:
 * this is host-keyed exactly like Python (`is_lan` / `canonical_endpoint` in
 * bandwidth.py) — the URL's *hostname* is matched against the local host
 * patterns after `endpoint_aliases` canonicalisation. Never a substring match
 * on the whole URL: a cloud URL with "10.2" in its model path must not read
 * as LAN traffic.
 */

export const BYTES_PER_TOKEN = 4.68;

/** Stored body bytes to an estimated token count (Python `int(b / BYTES_PER_TOKEN)`). */
export function estimateTokens(byteCount: number | null | undefined): number {
  return Math.trunc((byteCount ?? 0) / BYTES_PER_TOKEN);
}

export function estimateBytes(tokens: number | null | undefined): number {
  return Math.trunc((tokens ?? 0) * BYTES_PER_TOKEN);
}

/** Python truthiness mirror (JSON values only). */
function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

/** Cache reads count as upload: reading a cache hit still streams the prompt
 * to the provider on first fill, so the prefix-cache write is what actually
 * crossed the wire (matches `upload_tokens` in bandwidth.py). */
export function uploadTokens(
  inputTokens: number | null | undefined,
  cacheRead: number | null | undefined,
  cacheWrite?: number | null | undefined,
): number {
  let total = (inputTokens ?? 0) + (cacheRead ?? 0);
  if (pyTruthy(cacheWrite)) total = Math.max(total, cacheWrite ?? 0);
  return Math.trunc(total); // Python: `return int(total)`
}

/** hostname of a base URL, mirroring Python's
 * `urlsplit(s if "//" in s else "//" + s).hostname`: lowercased host without
 * userinfo/port/IPv6 brackets, and null when the string has no authority at
 * all (e.g. a bare relative path — a "//" inside a path is not an authority). */
export function hostnameOf(raw: string): string | null {
  const s = raw.includes("//") ? raw : `//${raw}`;
  const m = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:)?\/\/([^/?#]*)/.exec(s);
  if (!m || m[1] === undefined) return null;
  let host = m[1];
  const at = host.lastIndexOf("@");
  if (at >= 0) host = host.slice(at + 1);
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    host = end >= 0 ? host.slice(1, end) : host.slice(1);
  } else {
    const colon = host.indexOf(":");
    if (colon >= 0) host = host.slice(0, colon);
  }
  return host ? host.toLowerCase() : null;
}

/** Python `canonical_endpoint(base_url)`: resolve the hostname, look it up in
 * the alias table (keyed by HOSTNAME, lowercased), and fall back to the
 * original string untouched — the returned alias value is used verbatim. */
export function canonicalEndpoint(
  base: string | null | undefined,
  aliases: Record<string, string> | null | undefined,
): string | null {
  if (!base) return base ?? null;
  const host = hostnameOf(base);
  if (!host) return base;
  const alias = aliases?.[host];
  return alias || base;
}

/** Python `is_lan(base_url)`: hostname (after alias resolution) matched
 * against `local_host_patterns` — ".suffix" is an endswith, "prefix." is a
 * startswith, anything else is exact-host or subdomain (`host == p or
 * host.startswith(p + ".")`). */
export function isLan(
  base: string | null | undefined,
  patterns: readonly string[],
  aliases: Record<string, string> | null | undefined,
): boolean {
  if (!base) return false;
  const resolved = canonicalEndpoint(base, aliases) || base;
  const host = hostnameOf(resolved);
  if (!host) return false;
  for (const raw of patterns) {
    const p = raw.toLowerCase();
    if (p.startsWith(".")) {
      if (host.endsWith(p)) return true;
    } else if (p.endsWith(".")) {
      if (host.startsWith(p)) return true;
    } else if (host === p || host.startsWith(`${p}.`)) {
      return true;
    }
  }
  return false;
}

/** Usage row -> estimated bytes, LAN-split exactly like Python `split_row`:
 * (up, down, lan_up, lan_down) with exactly one pair non-zero per endpoint. */
export function splitRow(
  baseUrl: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
  cacheRead: number | null | undefined,
  cacheWrite?: number | null | undefined,
  patterns: readonly string[] = [],
  aliases: Record<string, string> | null | undefined = null,
): { up: number; down: number; lanUp: number; lanDown: number } {
  const up = estimateBytes(uploadTokens(inputTokens, cacheRead, cacheWrite));
  const down = estimateBytes(outputTokens);
  if (isLan(baseUrl, patterns, aliases)) {
    return { up: 0, down: 0, lanUp: up, lanDown: down };
  }
  return { up, down, lanUp: 0, lanDown: 0 };
}
