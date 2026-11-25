"use client";

// T-23 RUN A: #projweight radiogroup. Mirrors dashboard.html:642-647 and
// views.js:1771-1793; persistence is owned by the page (RUN B stub for onOpen).
import type { WeightAxis } from "../../lib/sessions-logs/types";

const ITEMS: ReadonlyArray<{ axis: WeightAxis; label: string }> = [
  { axis: "cost", label: "Cost" },
  { axis: "calls", label: "Calls" },
  { axis: "tokens", label: "Tokens" },
  { axis: "sessions", label: "Sessions" },
];

export interface WeightToggleProps {
  value: WeightAxis;
  onChange: (axis: WeightAxis) => void;
}

export default function WeightToggle({ value, onChange }: WeightToggleProps) {
  return (
    <div id="projweight" role="radiogroup" aria-label="Weighting" className="sm-weight">
      {ITEMS.map(({ axis, label }) => {
        const on = axis === value;
        return (
          <button
            key={axis}
            type="button"
            data-w={axis}
            className={`sm-chip${on ? " on" : ""}`}
            aria-pressed={on}
            onClick={() => onChange(axis)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
