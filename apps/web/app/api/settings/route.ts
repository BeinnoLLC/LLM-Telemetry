/**
 * T-19 (LLMTELEMET-290): thin App Router wrapper around the settings port.
 * The guard, validation and atomic write live in lib/api/settings.ts so tests
 * can exercise them without a running Next server.
 */

import { handleSettingsGet, handleSettingsPost } from "@/lib/api/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  return handleSettingsGet(request);
}

export function POST(request: Request): Promise<Response> {
  return handleSettingsPost(request);
}
