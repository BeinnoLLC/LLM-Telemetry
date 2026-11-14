// LLMTELEMET-282 (T-3): dashboard live deltas over SSE, with a `?since=`
// polling fallback (plan §"Live feeds"). All logic lives in lib/live-feed so
// the Hive feed (T-8) can reuse the same ring/heartbeat/cap machinery.
import { eventsRequest } from "../../../../lib/live-feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return eventsRequest(request);
}
