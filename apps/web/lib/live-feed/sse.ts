// LLMTELEMET-282 (T-3): SSE framing (port of serve.py `NoCacheHandler._sse`)
// plus the heartbeat comment contract (": heartbeat", cadence <= 20 s).
//
// Frame layout, identical to the Python writer:
//   id: <seq>\n            (omitted when seq is null)
//   event: <name>\n        (omitted when no event name)
//   data: <line>\n         (one line per line of the JSON payload)
//   \n
// The payload is standard compact JSON where Python's json.dumps uses
// ", "/" : " separators; both parse to the same values, and the parity test
// compares parsed frames, not bytes.

export const HEARTBEAT_COMMENT = ": heartbeat\n\n";

export function formatSse(
  data: unknown,
  seq: number | null = null,
  event: string | null = null,
): string {
  let out = "";
  if (seq !== null) out += `id: ${seq}\n`;
  if (event) out += `event: ${event}\n`;
  for (const ln of JSON.stringify(data).split("\n")) out += `data: ${ln}\n`;
  return out + "\n";
}
