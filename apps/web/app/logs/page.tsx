"use client";

// T-23 RUN C: the Logs route is a thin composition shell. The view owns the
// single artifact fetch and all derived state; no props are invented here.
import LogsView from "@/components/sessions-logs/LogsView";
import "@/styles/logs-view.css";

export default function LogsPage() {
  return <LogsView />;
}
