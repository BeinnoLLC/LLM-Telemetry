/**
 * T-19 (LLMTELEMET-290): thin App Router wrapper around the settings port.
 * The guard, validation and atomic write live in lib/api/settings.ts so tests
 * can exercise them without a running Next server.
 */

import { handleSettingsGet, handleSettingsPost, peerDepsFromEnv } from "@/lib/api/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Route handlers cannot see the socket peer. The configured peer (or the
// loopback default) is passed explicitly; proxy headers stay untrusted unless
// LLM_TELEMETRY_TRUST_PROXY opts in.
export function GET(request: Request): Response {
  return handleSettingsGet(request, peerDepsFromEnv(process.env));
}

export function POST(request: Request): Promise<Response> {
  return handleSettingsPost(request, peerDepsFromEnv(process.env));
}
