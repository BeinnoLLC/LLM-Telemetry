"use client";

// LLMTELEMET-291 (T-20 RUN D2): one roomy, two-line live session row.
// Every value comes from the RUN D1 shaped LiveRow (live.js:416-443). Text is
// rendered as JSX text/attributes, so untrusted DB titles are escaped by React.
import { ago, fmt, fmtB, money } from "../../lib/home/format";
import type { LiveKind, LiveRow } from "../../lib/home/live-rows";
import ModelBadge from "./ModelBadge";

const KIND_LABEL: Record<LiveKind, string> = {
  hermes: "Hermes", pi: "PI", claude: "Claude", codex: "Codex",
};

interface LiveRowProps {
  row: LiveRow;
}

export default function LiveRow({ row }: LiveRowProps) {
  const idle = row.idleS === null ? "—" : `${ago(row.idleS)} ago`;
  const elapsed = row.elapsedS === null ? "—" : ago(row.elapsedS);
  const detail = [
    row.profile ?? row.owner,
    row.category,
    row.parentTitle ? `from ${row.parentTitle}` : null,
    row.subagent ? "subagent" : null,
    row.sessionId,
  ].filter(Boolean).join(" · ");
  const plan =
    row.coveredBy === "Claude" || row.coveredBy === "ChatGPT"
      ? `covered by ${row.coveredBy} subscription`
      : "covered by subscription";
  const bandwidth = [
    row.upBytes === null ? null : `↑ ${fmtB(row.upBytes)}`,
    row.downBytes === null ? null : `↓ ${fmtB(row.downBytes)}`,
  ].filter(Boolean).join(" ");
  const load = row.load === null ? "—" : `${Math.round(row.load)}%`;

  return (
    <div
      className="lvrow"
      role="row"
      data-lvstate={row.state.toLowerCase()}
      data-key={row.key}
      {...(row.idleS !== null && row.idleS > 86400 ? { "data-longidle": "1" } : {})}
    >
      <div className="lvc lvc-kind" role="cell">
        <span className="lv-kind" title={KIND_LABEL[row.kind]}>
          {KIND_LABEL[row.kind]}
        </span>
      </div>
      <div
        className="lvc lvc-sess"
        role="cell"
        title={`${row.title} — ${row.sessionId}`}
      >
        <div className="lv-stk">
          <span className="lv-s1">{row.title}</span>
          {detail ? <span className="lv-s2">{detail}</span> : null}
        </div>
      </div>
      <div className="lvc lv-meta" role="cell">
        <ModelBadge row={row} />
      </div>
      <div className="lvc lvc-state" role="cell">
        <div className="lv-stk">
          <span className={`lv-state lv-state-${row.state.toLowerCase()}`}>
            {row.state}
          </span>
          <span className="lv-elapsed" title="running since session start">
            {elapsed}
          </span>
        </div>
      </div>
      <div className="lvc lv-num" role="cell" title="tokens in + out">
        <div className="lv-stk">
          <span>{row.tokens === null ? "—" : fmt(row.tokens)}</span>
          <span className="lv-s2">in + out</span>
        </div>
      </div>
      <div className="lvc lv-num lv-cost" role="cell">
        <div className="lv-stk">
          {row.subscription ? (
            <span
              className="lv-covered"
              title="API-price equivalent, not added to Est. cost"
            >
              {plan}
            </span>
          ) : (
            <span>{row.costUsd === null ? "—" : money(row.costUsd)}</span>
          )}
          <span className="lv-s2">
            {row.subscription ? "not in total" : "est. cost"}
          </span>
        </div>
      </div>
      <div className="lvc lvc-act" role="cell" title={row.phase ?? undefined}>
        <div className="lv-stk">
          <span className="lv-activity-line">{idle}</span>
          <span className="lv-s2">{row.phase ?? "—"}</span>
        </div>
        {row.tools.length > 0 ? (
          <div className="lv-tools" title={row.tools.join(", ")}>
            {row.tools.slice(0, 3).map((tool, index) => (
              <span className="lv-tool" key={`${tool}-${index}`} title={tool}>
                {tool}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="lvc lv-load" role="cell">
        <div className="lv-stk">
          <span>{load}</span>
          <span className="lv-s2">
            {bandwidth || (row.tools.length ? `${row.tools.length} tools` : "—")}
          </span>
        </div>
      </div>
    </div>
  );
}
