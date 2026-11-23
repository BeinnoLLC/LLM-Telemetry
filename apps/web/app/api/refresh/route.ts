/**
 * T-19 (LLMTELEMET-290): thin App Router wrapper around the refresh port.
 * The handler logic and injectable starter live in lib/api/refresh.ts; this
 * module deliberately contains no process spawning.
 */

import { handleRefreshPost } from "@/lib/api/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return handleRefreshPost(request);
}
