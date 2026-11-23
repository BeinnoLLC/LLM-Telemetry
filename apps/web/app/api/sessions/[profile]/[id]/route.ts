/**
 * T-19 (LLMTELEMET-290): Next port of the legacy dashboard's
 * `sessions/<profile>/<id>.json` fetch. The byte-for-byte response and path
 * guard live in lib/api/reports.ts; this wrapper only unwraps route params.
 */

import { handleSessionGet } from "@/lib/api/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ profile: string; id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { profile, id } = await context.params;
  return handleSessionGet(profile, id);
}
