/**
 * T-19 (LLMTELEMET-290): thin App Router wrapper around the refresh port.
 * The handler logic and injectable starter live in lib/api/refresh.ts; this
 * module deliberately contains no process spawning.
 */

import { handleRefreshPost } from "@/lib/api/refresh";
import { peerDepsFromEnv } from "@/lib/api/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Route handlers cannot see the socket peer. The configured peer (or the
// loopback default) is passed explicitly; proxy headers stay untrusted unless
// LLM_TELEMETRY_TRUST_PROXY opts in.
export function POST(request: Request): Promise<Response> {
  return handleRefreshPost(request, peerDepsFromEnv(process.env));
}
