// LLMTELEMET-293 (T-22 RUN C): Prices view. The catalogue is read once from
// the same snapshot; every number, source label and what-if rate is derived in
// prices.ts. An absent catalogue shows n/a instead of a fabricated sheet.
import PriceSheet from "@/components/usage-cost/PriceSheet";
import { loadUsageSnapshot } from "@/lib/usage-cost/load";
import "../../styles/usage-cost-charts.css";

export const dynamic = "force-dynamic";

export default async function PricesPage() {
  const snapshot = await loadUsageSnapshot();
  return <PriceSheet data={snapshot.costs} />;
}
