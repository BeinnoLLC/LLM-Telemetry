/**
 * T-19 (LLMTELEMET-290): Next port of the legacy dashboard's static report
 * artifact reads. GET and HEAD share the allowlist, path guard and no-cache
 * headers in lib/api/reports.ts.
 */

import { handleDataRequest } from "@/lib/api/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ name: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { name } = await context.params;
  return handleDataRequest(name, "GET");
}

export async function HEAD(_request: Request, context: RouteContext): Promise<Response> {
  const { name } = await context.params;
  return handleDataRequest(name, "HEAD");
}
