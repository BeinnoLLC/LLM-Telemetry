/** Token/byte accounting — T-6 (LLMTELEMET-285), port of `bandwidth.py`.
 *
 * Tokens are not bytes, but a network budget can only count bytes. The rule
 * from the Python collector: ~4.68 bytes/token, derived from measured LLM
 * payload sizes — not guessed, kept in one place.
 */

export const BYTES_PER_TOKEN = 4.68;

/** Rough byte estimate for a token count (truncated to whole bytes, parity
 * with Python `int(...)` on positive values). */
export function estimateBytes(tokens: number | null): number {
  return Math.trunc((tokens ?? 0) * BYTES_PER_TOKEN);
}

/** Endpoint alias table: every `from` URL is counted as its `to` twin. */
export function canonicalEndpoint(
  base: string | null,
  aliases: Record<string, string> | null | undefined,
): string {
  let u = (base ?? "").trim();
  if (!u) return u;
  u = u.replace(/\/+$/, "");
  if (aliases && Object.prototype.hasOwnProperty.call(aliases, u)) {
    return (aliases[u] ?? "").replace(/\/+$/, "");
  }
  return u;
}

/** True when the URL points at a LAN/private host (config-driven patterns,
 * parity with `bandwidth.is_lan`). */
export function isLan(
  base: string | null,
  patterns: readonly string[],
  aliases: Record<string, string> | null | undefined,
): boolean {
  const u = canonicalEndpoint(base, aliases).toLowerCase();
  return patterns.some((p) => p !== "" && u.includes(p.toLowerCase()));
}
