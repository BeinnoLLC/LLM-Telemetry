// LLMTELEMET-293 (T-22 RUN C): Prices sheet. The shell, table, tabs, search,
// grouped what-if select and cache-aware estimate are the React form of
// views.js:3169-3524. Only the embedded catalogue feeds it; a missing rate is
// a dash or "no rate available", never a silent $0.
"use client";

import { useState } from "react";
import { HEXAGON_PATH } from "../../lib/home-board/provider-icons";
import { colorOfProvider, providerMark } from "../../lib/usage-cost/usage";
import {
  PRICE_TABS,
  cacheMix,
  defaultWhatIfIndex,
  fmtMoney,
  fmtN,
  isPriceTab,
  priceRows,
  priceShell,
  provenanceTitle,
  rateText,
  servedBy,
  sourceLabel,
  whatIfCalculate,
  whatIfGroups,
  type PriceTab,
  type WhatIfInputs,
} from "../../lib/usage-cost/prices";
import type { CostModel, CostsData } from "../../lib/usage-cost/types";

const EMPTY_INPUTS: WhatIfInputs = { input: "10k", cached: "", output: "5k", runs: "1" };

function ProviderBadges({ model }: { model: CostModel }) {
  const badges = servedBy(model);
  if (!badges.length) {
    return (
      <span className="uc-muted" title={numCalls(model) > 0
        ? "Observed traffic ran through this provider, but telemetry could not attribute it"
        : "No observed traffic yet — served-by fills in after your first calls"}>
        —
      </span>
    );
  }
  return (
    <>
      {badges.map((badge) => {
        const key = badge.label;
        const color = colorOfProvider(key);
        return (
          <span key={badge.label}
                className={`pv-badge${badge.inferred ? " pv-badge-inferred" : ""}`}
                data-inferred={String(badge.inferred)}
                title={badge.inferred
                  ? "Inferred from the model’s family — no traffic recorded yet"
                  : "Observed traffic ran through this provider"}
                style={{ color, borderColor: color }}>
            <svg className="uc-prov-mark" viewBox="0 0 24 24" aria-hidden="true" style={{ color }}>
              <path d={providerMark(key) ?? HEXAGON_PATH} fill="currentColor" />
            </svg>
            {badge.label}
          </span>
        );
      })}
    </>
  );
}

function numCalls(model: CostModel): number {
  return Number(model.calls) || 0;
}

function PriceRow({
  model,
  modelIndex,
  sheetAge,
}: {
  model: CostModel;
  modelIndex: number;
  sheetAge: unknown;
}) {
  const used = numCalls(model) > 0;
  const origin = String(model.rate_origin ?? "");
  return (
    <tr className={used ? "" : "pv-unused"} data-model={String(model.model ?? "")}
        data-used={used ? "1" : "0"} data-source={String(model.source ?? "")}
        data-model-index={modelIndex} {...(model.oid ? { "data-oid": String(model.oid) } : {})}>
      <td>{String(model.model ?? "n/a")}</td>
      <td className="uc-num">{rateText(model.in_1m)}</td>
      <td className="uc-num">{rateText(model.out_1m)}</td>
      <td className="uc-num">{rateText(model.cache_1m)}</td>
      <td className="pv-source-cell">
        {origin === "override" && (
          <span className="pv-src pv-src-override" title="Manual override, not a fetched rate">override</span>
        )}
        <span className={`pv-src pv-src-${String(model.source ?? "unknown")}`}
              title={provenanceTitle(model, sheetAge)}>{sourceLabel(model.source)}</span>
      </td>
      <td className="uc-num">{used ? numCalls(model).toLocaleString("en-US") : "—"}</td>
      <td className="uc-num">{used ? fmtN(model.outp) : "—"}</td>
      <td className="uc-num">{used ? fmtMoney(model.cost) : "—"}</td>
      <td><ProviderBadges model={model} /></td>
    </tr>
  );
}

function WhatIf({
  models,
  selected,
  onSelect,
}: {
  models: readonly CostModel[];
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const [inputs, setInputs] = useState<WhatIfInputs>(EMPTY_INPUTS);
  const groups = whatIfGroups(models);
  const model = selected == null ? undefined : models[selected];
  const result = model ? whatIfCalculate(model, inputs) : null;
  const change = (key: keyof WhatIfInputs, value: string) =>
    setInputs((previous) => ({ ...previous, [key]: value }));
  return (
    <section className="uc-card pv-whatif" data-panel="whatif">
      <h2>What-if calculator</h2>
      <div className="pv-whatif-fields">
        <label>
          <span className="pv-label">Model</span>
          <select className="chip pv-input" data-testid="whatif-model" value={selected ?? ""}
                  onChange={(event) => {
                    const index = Number(event.target.value);
                    onSelect(index);
                    const chosen = models[index];
                    const mix = chosen ? cacheMix(chosen) : null;
                    change("cached", mix == null ? "" : String(Math.round(mix * 100)));
                  }}>
            {groups.map((group) => (
              <optgroup key={group.key} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.index} value={option.index}>{option.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {([
          ["input", "In tokens", "100k", "Tokens per run sent to the model"],
          ["cached", "Cached in", "0", "Tokens per run served from the provider cache, billed at the cache-read rate"],
          ["output", "Out tokens", "50k", "Tokens returned per run"],
          ["runs", "Runs", "", "Runs to multiply the estimate by"],
        ] as const).map(([key, label, placeholder, title]) => (
          <label key={key}>
            <span className="pv-label" title={title}>{label}</span>
            <input className="chip pv-input" data-testid={`whatif-${key}`} placeholder={placeholder}
                   value={inputs[key]} onChange={(event) => change(key, event.target.value)} />
          </label>
        ))}
      </div>
      <div className="pv-whatif-total" data-kind={result?.kind ?? "n/a"}
           style={result?.kind === "unpriced" ? { color: "var(--c-red)" } : undefined}>
        {result?.totalText ?? "n/a"}
      </div>
      <p className="uc-muted" data-testid="whatif-breakdown">{result?.breakdown ?? "No model selected."}</p>
    </section>
  );
}

export default function PriceSheet({ data }: { data: CostsData | null }) {
  const models = data?.models ?? [];
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<PriceTab>("all");
  const [selected, setSelected] = useState<number | null>(() => defaultWhatIfIndex(models));
  const shell = priceShell(data);
  const rows = priceRows(models, tab, query);
  const freshClass = shell.fresh.state === "stale" ? "stale" : shell.fresh.state === "old" ? "old" : "";

  if (shell.missing) {
    return (
      <main className="view prices-view" data-price-missing="true">
        <h1>Prices</h1>
        <p className="uc-meta">{shell.note}</p>
      </main>
    );
  }

  return (
    <main className="view prices-view" data-cat-state={shell.catalogSource}>
      <div className="pv-head">
        <div>
          <h1>Price sheet</h1>
          <p className="pv-freshpill-wrap">
            <span className={`pv-freshpill ${freshClass}`} data-fresh-state={shell.fresh.state}
                  title={shell.fresh.hint || undefined}>
              · updated {shell.fresh.label} · {shell.sourceLabel}
            </span>
          </p>
          <p className="uc-meta">
            {shell.catalogSize} models in catalogue · {shell.usedCount} with observed traffic · generated {shell.generated}
          </p>
        </div>
        <div className="pv-controls">
          <input className="chip pv-search" data-testid="priceSearch" placeholder="Search model, provider or source…"
                 value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="pv-tabs" data-testid="priceTabs">
            {PRICE_TABS.map(([key, label]) => (
              <button type="button" key={key} className={`chip pt-tab${tab === key ? " on" : ""}`}
                      data-tab={key} aria-pressed={tab === key}
                      onClick={() => setTab(isPriceTab(key) ? key : "all")}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="uc-table-wrap pv-wrap">
        <table className="uc-table pv-tbl" data-table-id="pv-tbl">
          <thead>
            <tr>
              <th>Model</th><th className="uc-num">In $/1M</th><th className="uc-num">Out $/1M</th>
              <th className="uc-num">Cache $/1M</th><th>Source</th><th className="uc-num">Calls</th>
              <th className="uc-num">Tok Out</th><th className="uc-num">Spend</th><th>Served by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((model) => {
              const index = models.indexOf(model);
              return <PriceRow key={`${String(model.model)}-${index}`} model={model}
                               modelIndex={index} sheetAge={data?.freshness?.age_s} />;
            })}
            {!rows.length && <tr><td className="uc-nodata" colSpan={9}>No models match.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="uc-meta">{rows.length} shown of {models.length}</p>
      <p className="uc-meta">{shell.note}</p>
      <WhatIf models={models} selected={selected} onSelect={setSelected} />
    </main>
  );
}
