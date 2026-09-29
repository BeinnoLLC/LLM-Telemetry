#!/usr/bin/env python3
"""Render analytics JSON into a Tailwind + Chart.js dashboard with date filtering."""
import json, os, sys, subprocess

from .config import get as _cfg

CFG = _cfg()
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = str(CFG.reports_dir / "analytics-data.json")
OUT  = sys.argv[1] if len(sys.argv) > 1 else str(CFG.reports_dir / "dashboard.html")

# LLM_TELEMETRY_NO_COLLECT renders from whatever JSON is already on disk.
# Required for the sample build: the collectors would otherwise overwrite the
# synthetic payload with real local telemetry (chat titles included) — which is
# exactly the data the public repo must never carry.
if os.environ.get("LLM_TELEMETRY_NO_COLLECT"):
    pass
else:
    subprocess.run([sys.executable, "-m", "llm_telemetry.collect_analytics", "-o", DATA], check=True)
    # Router config is small and changes only when you edit config.yaml, so it is
    # baked into the page rather than polled. Regenerated on every build, so the
    # help page cannot drift from the config the agent actually loads.
    subprocess.run([sys.executable, "-m", "llm_telemetry.collect_router",
                    str(CFG.reports_dir / "router-data.json")], check=True)
from .schema import SCHEMA_VERSION


def _load_versioned(path):
    """Load a payload and refuse a shape this build does not understand (#23).

    Failing the build is the loud version of the blank-dashboard bug: better a
    clear message here than a page that renders nothing.
    """
    d = json.load(open(path))
    got = d.get("schema_version")
    if got != SCHEMA_VERSION:
        sys.exit(f"{path}: schema_version {got!r}, expected {SCHEMA_VERSION} "
                 f"(stale payload — re-run the collector)")
    return d


data = _load_versioned(DATA)
data["router"] = _load_versioned(CFG.reports_dir / "router-data.json")["profiles"]

HEAD = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LLM Telemetry</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2064%2064'%3E%3Cdefs%3E%3ClinearGradient%20id='bg'%20x1='0'%20y1='0'%20x2='1'%20y2='1'%3E%3Cstop%20offset='0%25'%20stop-color='%23161c2a'/%3E%3Cstop%20offset='100%25'%20stop-color='%230b0f17'/%3E%3C/linearGradient%3E%3ClinearGradient%20id='trend'%20x1='0'%20y1='1'%20x2='1'%20y2='0'%3E%3Cstop%20offset='0%25'%20stop-color='%236366f1'/%3E%3Cstop%20offset='55%25'%20stop-color='%23818cf8'/%3E%3Cstop%20offset='100%25'%20stop-color='%2322c55e'/%3E%3C/linearGradient%3E%3C/defs%3E%3C!--%20rounded-square%20tile%20in%20the%20dashboard's%20own%20card%20palette%20--%3E%3Crect%20width='64'%20height='64'%20rx='15'%20fill='url(%23bg)'/%3E%3Crect%20x='0.75'%20y='0.75'%20width='62.5'%20height='62.5'%20rx='14.5'%20fill='none'%20stroke='%232b3446'%20stroke-width='1.5'/%3E%3C!--%20Ascending%20telemetry%20line,%20same%20shape%20family%20as%20the%20header%20brandmark.%20The%20faint%20bar%20chart%20that%20sat%20behind%20this%20was%20DROPPED:%20at%2032px%20three%20translucent%20bars%20plus%20a%20gradient%20line%20read%20as%20mud,%20and%20the%20bars%20carried%20no%20meaning%20the%20line%20does%20not.%20One%20bold%20mark%20survives%20scaling.%20--%3E%3Cpath%20d='M13%2044%20L25%2030%20L34%2037%20L49%2020'%20fill='none'%20stroke='url(%23trend)'%20stroke-width='6'%20stroke-linecap='round'%20stroke-linejoin='round'/%3E%3C!--%20endpoint%20node:%20the%20'live'%20pulse,%20inset%20so%20it%20is%20never%20clipped%20--%3E%3Ccircle%20cx='49'%20cy='20'%20r='5'%20fill='%2322c55e'/%3E%3C/svg%3E">
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
 :root{
   --bg:#0b0f17; --card:#131822; --fg:#e6edf6; --muted:#8b98ab;
   --border:#232b39; --accent:#6366f1; --accent2:#22c55e;
   --fs:15px; --gap:16px; --pad:20px;
   /* ---- Fluid type + spacing scale ---------------------------------
      One continuous scale instead of per-breakpoint font rules. Every
      step is clamp(min, preferred, max) so text grows with the viewport
      and never drops below a legible floor on a phone: --fs-xs is 11px
      at 360px, which is the smallest size we allow anywhere. */
   --fs-xs:clamp(11px,.62vw + 8.8px,12px);
   --fs-sm:clamp(12px,.70vw + 9.5px,13.5px);
   --fs-md:clamp(13px,.75vw + 10.3px,15px);
   --fs-lg:clamp(15px,1.1vw + 11px,18px);
   --fs-xl:clamp(17px,1.8vw + 11px,24px);
   --sp-1:4px;  --sp-2:6px;
   --sp-3:clamp(8px,1vw,10px);
   --sp-4:clamp(10px,1.4vw,14px);
   --sp-5:clamp(14px,2vw,20px);
   --sp-6:clamp(18px,2.8vw,28px);
   /* Gauge sizing — a single knob drives stroke, ticks and readout. */
   --gauge-size:84px;
   /* Gauge severity zones, themeable without touching the SVG code. */
   --z-ok:hsl(142 65% 45%); --z-warn:hsl(38 92% 52%); --z-bad:hsl(0 72% 55%);
   --z-ok-fg:hsl(142 55% 52%); --z-warn-fg:hsl(38 88% 58%); --z-bad-fg:hsl(0 70% 64%);
   --nav-w:232px; --rail-w:60px; --bar-h:52px;
 }
 [data-theme=light]{
   --bg:#f7f8fb; --card:#ffffff; --fg:#111827; --muted:#6b7280;
   --border:#e5e7eb; --accent:#4f46e5; --accent2:#16a34a;
   /* Darker zone fills: the dark-theme hues fail 3:1 against a white card. */
   --z-ok:hsl(142 62% 34%); --z-warn:hsl(32 92% 42%); --z-bad:hsl(0 70% 46%);
   --z-ok-fg:hsl(142 62% 28%); --z-warn-fg:hsl(28 92% 35%); --z-bad-fg:hsl(0 70% 42%);
 }
 *{box-sizing:border-box}
 html,body{background:var(--bg);color:var(--fg);margin:0;padding:0;height:100%}
 body{font:var(--fs)/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
      -webkit-font-smoothing:antialiased}
 /* Full viewport width — no max-width cap */
 .page{width:100%;padding:var(--pad) var(--pad) 40px;display:flex;flex-direction:column;gap:var(--gap)}
 .card{background:var(--card);border:1px solid var(--border);border-radius:8px}
 .muted{color:var(--muted)}
 .tabon{background:var(--accent);border-color:var(--accent);color:#fff}
 .taboff{background:transparent;border:1px solid var(--border);color:var(--muted)}
 .taboff:hover{color:var(--fg);border-color:var(--accent)}
 .livehdr{display:flex;align-items:baseline;gap:4px}
 .livebw{margin-left:auto;display:flex;gap:10px;text-transform:none;letter-spacing:0;font-size:var(--fs-sm);font-weight:500;color:var(--fg)}
 [hidden]{display:none !important}
 .rounded-md{border-radius:4px !important}
 .chip{border:1px solid var(--border);border-radius:4px;padding:6px 12px;font-size:var(--fs-md);
       cursor:pointer;color:var(--muted);user-select:none;white-space:nowrap}
 .chip:hover{color:var(--fg);border-color:var(--accent)}
 input[type=date]{background:var(--bg);border:1px solid var(--border);border-radius:4px;
   padding:6px 10px;font-size:var(--fs-md);color:var(--fg);color-scheme:dark}
 [data-theme=light] input[type=date]{color-scheme:light}
 canvas{width:100% !important;max-height:280px}
 table{font-variant-numeric:tabular-nums;border-collapse:collapse;width:100%}
 tbody tr:hover{background:color-mix(in srgb,var(--accent) 7%,transparent)}
 .kpi{font-size:clamp(18px,2vw,26px);font-weight:600;letter-spacing:-.02em}
 .lbl{font-size:var(--fs-sm);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
 .dot{width:7px;height:7px;border-radius:50%;background:var(--accent2);
      display:inline-block;margin-right:5px;animation:p 2s infinite}
 @keyframes p{0%,100%{opacity:1}50%{opacity:.35}}
 /* Responsive grid helpers */
 .grid-auto{display:grid;gap:var(--gap);
   grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))}
 .grid-kpi{display:grid;gap:10px;
   grid-template-columns:repeat(auto-fit,minmax(min(130px,100%),1fr))}
 /* Two-up chart rows. Written as auto-fit rather than `1fr 1fr` so a narrow
    viewport reflows to one column instead of producing two ~160px tracks that
    hold a squashed canvas and force horizontal overflow. min() keeps the track
    from ever exceeding the available width. */
 .grid-2{display:grid;gap:var(--gap);
   grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr))}
 /* Canvases and long strings would otherwise set the track's min-content width
    and blow the grid out sideways. */
/* Left nav drawer (#3). Fixed rail, content shifts right. Mobile behaviour
   (off-canvas + scrim) is ticket #4; this keeps it simply hidden below the
   tablet breakpoint so the page never loses its nav mid-refactor. */
#navdrawer{
  position:fixed; top:0; left:0; bottom:0; z-index:40;
  width:var(--rail-now);
  background:var(--card); border-right:1px solid var(--border);
  display:flex; flex-direction:column; overflow-y:auto; overflow-x:hidden;
  padding:14px 10px; transition:width .18s ease, transform .2s ease;
}
#navdrawer .navbrand{
  display:flex; align-items:center; gap:8px; padding:4px 8px 12px;
  font-weight:650; letter-spacing:-.02em;
}
.navitem{
  display:flex; align-items:center; gap:10px; width:100%;
  padding:8px 10px; margin-bottom:2px; border-radius:8px;
  border:0; background:none; cursor:pointer; text-align:left;
  color:var(--muted); font-size:var(--fs-md); line-height:1.2;
  border-left:2px solid transparent; text-decoration:none;
}
.navitem:hover{ background:color-mix(in srgb, var(--accent) 10%, transparent); color:var(--fg); }
.navitem:focus-visible{ outline:2px solid var(--accent); outline-offset:1px; }
/* Active item: accent bar plus accent text, so it reads as "you are here"
   without relying on colour alone. */
.dkpis{display:flex;gap:18px;flex-wrap:wrap}
.dkpi{display:flex;flex-direction:column;gap:2px}
.dkpi-n{font-size:var(--fs-lg);font-weight:600}
.dkpi-n.ok{color:var(--z-ok-fg)}
.dkpi-n.bad{color:var(--z-bad-fg)}
.drow{display:grid;grid-template-columns:minmax(90px,1.1fr) minmax(60px,2fr) 42px minmax(90px,1fr);
  align-items:center;gap:8px;font-size:var(--fs-sm)}
.dname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dbar{height:6px;border-radius:3px;background:color-mix(in srgb,var(--fg) 12%,transparent);overflow:hidden}
.dbar span{display:block;height:100%;border-radius:3px}
.dbar span.ok{background:var(--z-ok)}
.dbar span.bad{background:var(--z-bad)}
.dpct{text-align:right;font-variant-numeric:tabular-nums}
.dpct.ok{color:var(--z-ok-fg)}
.dpct.bad{color:var(--z-bad-fg)}
.dmeta{font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ditem{display:grid;grid-template-columns:8px 1fr auto;align-items:center;gap:8px;
  padding:3px 0;border-bottom:1px solid var(--border)}
.ditem:last-child{border-bottom:0}
.ddot{width:6px;height:6px;border-radius:50%}
.ddot.ok{background:var(--z-ok)}
.ddot.bad{background:var(--z-bad)}
.dgoal{font-size:var(--fs-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:720px){.drow{grid-template-columns:minmax(80px,1fr) 1fr 40px}.dmeta{display:none}}
.navitem[aria-current="page"]{
  color:var(--accent); border-left-color:var(--accent);
  background:color-mix(in srgb, var(--accent) 14%, transparent);
  font-weight:600;
}
.navitem .nvico{ width:16px; text-align:center; flex:0 0 16px; font-size:var(--fs-md); }
.navitem .nvlabel{ flex:1 1 auto; min-width:0; }
/* Counts ride on the right; hidden when zero so the rail stays quiet. */
.navitem .nvbadge{
  flex:0 0 auto; font-size:var(--fs-xs); padding:1px 6px; border-radius:999px;
  background:color-mix(in srgb, var(--accent) 22%, transparent); color:var(--accent);
}
#navdrawer .navsep{ height:1px; background:var(--border); margin:10px 6px; }
/* Grouped nav (#122): a small uppercase label over each cluster. Muted and
   non-selectable so it reads as a heading, not a nav item. */
#navdrawer .navgroup{ display:flex; flex-direction:column; }
#navdrawer .navgroup-h{
  font-size:var(--fs-xs); text-transform:uppercase; letter-spacing:.08em;
  color:var(--muted); opacity:.75; padding:6px 10px 3px;
  user-select:none; pointer-events:none;
}

/* The rail is the nav at every width now (#4), so the chip strip is redundant
   everywhere rather than only on desktop. */
body.hasnav #views{ display:none; }
/* ---- Live row: models used (#107) ---- */
.lmhead{display:flex;align-items:center;gap:6px;font-size:var(--fs-xs);text-transform:uppercase;
  letter-spacing:.04em;margin-bottom:5px}
.lmmet{background:none;border:1px solid var(--border);color:var(--muted);cursor:pointer;
  border-radius:999px;padding:1px 7px;font:inherit;font-size:var(--fs-xs);text-transform:uppercase}
.lmmet.on{border-color:var(--accent);color:var(--accent);
  background:color-mix(in srgb,var(--accent) 16%,transparent)}
.lmbar{display:flex;height:9px;border-radius:5px;overflow:hidden;background:var(--bg);
  border:1px solid var(--border)}
.lmseg{display:block;height:100%;min-width:2px}
.lmseg:hover{filter:brightness(1.25)}
.lmlegend{display:flex;flex-wrap:wrap;gap:4px 12px;margin:5px 0 7px;font-size:var(--fs-xs)}
.lmkey{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.lmkey.cur{font-weight:600}
.lmdot{width:7px;height:7px;border-radius:50%;flex:0 0 7px}
.lmcell{width:88px;min-width:88px}
.lmrowbar{display:block;height:6px;border-radius:3px;min-width:2px}
.lmbtn{background:none;border:0;padding:0;cursor:pointer;text-decoration:underline dotted;font:inherit}
.lmbtn:hover{color:var(--fg)}
.lmpanel{margin:-4px 0 4px 26px;padding:6px 8px;border:1px solid var(--border);border-top:0;
  border-radius:0 0 6px 6px;
  /* #livelist is a flex COLUMN with overflow-y:auto, so every child is a flex
     item that shrinks by default. A shrunk panel clipped its own content to
     nothing -- and because overflow-x:auto forces overflow-y from visible to
     auto, the clipped content was invisible rather than spilling. Never shrink,
     and scroll only on the axis that needs it. */
  flex:0 0 auto; min-height:max-content; overflow-x:auto; overflow-y:visible}
.lmpanel table{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
.lmpanel th{text-align:left;font-weight:500;color:var(--muted);font-size:var(--fs-xs);
  text-transform:uppercase;letter-spacing:.04em;padding:2px 8px 4px 0}
.lmpanel td{padding:3px 8px 3px 0;white-space:nowrap;border-top:1px solid var(--border)}
.lmpanel .num{text-align:right;font-variant-numeric:tabular-nums}
/* ---- Logs page (#104, redesigned #108) ---------------------------------
   Old layout: six facet rows of identical pill chips stacked with almost no
   air between them (6px gap) and no feedback about which filters were
   active — you had to scan every row for a highlighted chip. Redesign:
   - the search row gains a live "N filters active" readout and a visible
     active-filter strip (removable chips) so state is legible at a glance;
   - facet rows get real spacing, a hover affordance and alternating
     backgrounds so six rows read as a list, not a wall of pills;
   - the Window control is a time range, not a data facet, so it is visually
     separated (divider) instead of sitting in the same rhythm as Level/Role/
     Tool/Model/Session. */
.lgfacets{display:flex;flex-direction:column;gap:2px;margin-top:2px}
.lgrow{display:flex;align-items:flex-start;gap:12px;padding:7px 8px;border-radius:7px}
.lgrow:hover{background:color-mix(in srgb,var(--fg) 4%,transparent)}
.lglbl{flex:0 0 64px;font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.06em;
  color:var(--muted);padding-top:5px;font-weight:600}
.lgchips{display:flex;gap:6px;flex-wrap:wrap;flex:1 1 auto;min-width:0}
.lgchip{border:1px solid var(--border);background:var(--bg);color:var(--muted);
  border-radius:999px;padding:3px 10px;font-size:var(--fs-sm);cursor:pointer;line-height:1.6;
  white-space:nowrap;max-width:280px;overflow:hidden;text-overflow:ellipsis;
  transition:border-color .12s,color .12s,background .12s}
.lgchip:hover{border-color:var(--accent);color:var(--fg)}
.lgchip.on{background:color-mix(in srgb,var(--accent) 18%,transparent);
  border-color:var(--accent);color:var(--accent);font-weight:600}
.lgchip .n{opacity:.65;margin-left:5px;font-variant-numeric:tabular-nums}
/* Window is a time range, not a category — a divider and looser gap mark it
   as a different kind of control from the facets above it. */
.lgrow-window{border-top:1px solid var(--border);margin-top:5px;padding-top:11px}
/* Active-filter strip: every currently-applied facet as a removable chip, so
   "why am I seeing this" never requires re-scanning six rows of pills. Empty
   (hidden) when nothing is selected — it must not be a second copy of the
   facets, only a summary of what's ON. */
#lgactive{display:none;align-items:center;gap:6px;flex-wrap:wrap;
  padding:8px 0 2px;margin-bottom:2px;border-bottom:1px solid var(--border)}
#lgactive.show{display:flex}
#lgactive .lbl{flex:0 0 auto;margin:0}
.lgactivechip{display:inline-flex;align-items:center;gap:5px;
  background:color-mix(in srgb,var(--accent) 14%,transparent);
  border:1px solid var(--accent);color:var(--accent);border-radius:999px;
  padding:2px 6px 2px 10px;font-size:var(--fs-sm);font-weight:600;cursor:pointer}
.lgactivechip:hover{background:color-mix(in srgb,var(--accent) 24%,transparent)}
.lgactivechip .x{opacity:.75;font-weight:700}
#lgcountbadge{background:var(--accent);color:#fff;border-radius:999px;
  font-size:var(--fs-xs);font-weight:700;padding:1px 7px;line-height:1.5}
/* Event rows: monospace timestamps so they form a readable column. */
.lgev{display:grid;grid-template-columns:70px 66px 1fr;gap:9px;align-items:baseline;
  padding:4px 0;border-bottom:1px solid var(--border);font-size:var(--fs-sm)}
.lgev:last-child{border-bottom:0}
.lgts{color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:var(--fs-xs)}
.lgtag{font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.05em;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lgtag.error{color:var(--z-bad-fg);font-weight:700}
.lgtag.tool{color:var(--accent)}
.lgtag.assistant{color:var(--z-ok-fg)}
.lgtag.user{color:var(--muted)}
.lgmsg{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lgev.open .lgmsg{white-space:pre-wrap;word-break:break-word}
.lgmeta{color:var(--muted);font-size:var(--fs-xs);margin-left:6px}
@media (max-width:640px){
  .lgev{grid-template-columns:58px 1fr}
  .lgev .lgtag{grid-column:2}
  .lglbl{flex-basis:52px}
}

/* ---- Nav rail: collapsible, collapsed by default (#102) -------------------
   One element, one width variable. `body.navcollapsed` drives --rail-now, and
   .page reads the SAME variable for its offset, so the content can never
   disagree with the rail about how wide it is. The old code hard-coded 232px
   in one place and 60px in another, which is how .page ended up 232px wider
   than the viewport (width:100% + margin-left) and clipped the right edge. */
#navdrawer{
  position:fixed; top:0; left:0; bottom:0; z-index:40;
  width:var(--rail-now);
  background:var(--card); border-right:1px solid var(--border);
  display:flex; flex-direction:column; overflow-y:auto; overflow-x:hidden;
  padding:14px 10px; transition:width .18s ease, transform .2s ease;
}
/* Collapsed (DEFAULT): icons only. */
body.navcollapsed{ --rail-now:var(--rail-w); }
body.navcollapsed #navdrawer .nvlabel,
body.navcollapsed #navdrawer .navbrand .brandword{ display:none; }
/* Collapsed rail is icon-only, and an icon-only rail has no room for a text
   heading: hide the group labels but KEEP the separators, so the grouping is
   still visible as rhythm without trying to spell it out. */
body.navcollapsed #navdrawer .navgroup-h{ display:none; }
body.navcollapsed #navdrawer .navitem{ justify-content:center; padding:9px 0; position:relative; }
body.navcollapsed #navdrawer .nvbadge{ position:absolute; transform:translate(14px,-9px); }
body.navcollapsed #navdrawer .navbrand{ justify-content:center; padding:4px 0 12px; }
/* Expanded: labels visible. */
body:not(.navcollapsed){ --rail-now:var(--nav-w); }
/* THE LAYOUT FIX: width:100% + margin-left overflowed the viewport by exactly
   the rail width. Reserve the space with padding on a full-width box instead,
   so box-sizing:border-box actually contains it. */
body.hasnav .page{ margin-left:0; padding-left:calc(var(--rail-now) + var(--pad)); }
/* Collapse toggle sits in the rail header. */
#navcollapse{
  margin-left:auto; border:0; background:none; cursor:pointer;
  color:var(--muted); font-size:var(--fs-md); line-height:1; padding:4px 6px;
  border-radius:6px; flex:0 0 auto;
}
#navcollapse:hover{ background:color-mix(in srgb,var(--accent) 12%,transparent); color:var(--fg); }
#navcollapse:focus-visible{ outline:2px solid var(--accent); outline-offset:1px; }
body.navcollapsed #navcollapse{ margin:6px auto 0; }
/* Collapsed labels become tooltips so icons stay identifiable. */
body.navcollapsed #navdrawer .navitem::after{
  content:attr(data-tip); position:absolute; left:calc(100% + 8px); top:50%;
  transform:translateY(-50%); white-space:nowrap; background:var(--card);
  border:1px solid var(--border); border-radius:6px; padding:4px 8px;
  font-size:var(--fs-sm); color:var(--fg); opacity:0; pointer-events:none;
  transition:opacity .12s ease; z-index:41;
}
body.navcollapsed #navdrawer .navitem:hover::after,
body.navcollapsed #navdrawer .navitem:focus-visible::after{ opacity:1; }
/* Off-canvas (<=640): the rail slides over the content and reserves nothing.
   Full width here — a 60px strip is harder to hit than a real panel. */
@media (max-width:640px){
  #navdrawer{ width:264px; transform:translateX(-100%); box-shadow:0 8px 28px rgba(0,0,0,.35); }
  body.navopen #navdrawer{ transform:translateX(0); }
  /* Mobile shows labels regardless of the desktop collapse state. */
  body.navcollapsed #navdrawer .nvlabel,
  body.navcollapsed #navdrawer .navbrand .brandword{ display:inline; }
  body.navcollapsed #navdrawer .navitem{ justify-content:flex-start; padding:8px 10px; }
  body.navcollapsed #navdrawer .nvbadge{ position:static; transform:none; }
  body.navcollapsed #navdrawer .navbrand{ justify-content:flex-start; padding:4px 8px 12px; }
  body.navcollapsed #navdrawer .navitem::after{ display:none; }
  body.hasnav .page{ padding-left:var(--pad); }
  #navcollapse{ display:none; }
  #navscrim{
    position:fixed; inset:0; z-index:39; background:rgba(0,0,0,.55);
    backdrop-filter:blur(2px); opacity:0; pointer-events:none;
    transition:opacity .2s ease; display:block;
  }
  body.navopen #navscrim{ opacity:1; pointer-events:auto; }
  body.navopen{ overflow:hidden; }
  #navtoggle{ display:inline-flex; }
}
#navtoggle{ display:none; }
#navscrim{ display:none; }
@media (prefers-reduced-motion:reduce){ #navdrawer,#navscrim,#navcollapse{ transition:none; } }

}
 .brandmark{color:var(--accent);flex:0 0 auto}
 @media(max-width:640px){.brandmark{width:20px;height:20px}}
 /* Home cards. auto-fit rather than fixed columns so the reflow to 2-up on
    tablet and 1-up on mobile needs no extra media query. */
 .grid-home{display:grid;gap:var(--gap);
   grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))}
 .grid-home > *{min-width:0}
 .homecard{display:block;text-decoration:none;color:inherit;transition:
   transform .12s ease,border-color .12s ease}
 .homecard:hover{transform:translateY(-2px);border-color:var(--accent)}
 .homecard:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
 .homecard .hc-ico{font-size:20px;line-height:1}
 .homecard .hc-stat{font-size:19px;font-weight:650;letter-spacing:-.02em}
 @media(prefers-reduced-motion:reduce){.homecard:hover{transform:none}}
 .grid-2 > *,.grid-auto > *{min-width:0}
 /* ---- Bandwidth -------------------------------------------------------
    Up and down are one card, not two: the pair is only meaningful together
    (a 278:1 ratio is the finding, and two separate cards hide it). Arrows
    carry the direction so the numbers read without a legend. */
 .bw{display:flex;align-items:center;gap:14px}
 .bwleg{display:flex;align-items:baseline;gap:5px}
 .bwarrow{font-size:var(--fs-md);line-height:1;font-weight:700}
 .bwup{color:#f59e0b}      /* upload: the dominant direction here */
 .bwdown{color:#38bdf8}
 .bwrate{font-size:var(--fs-xs);letter-spacing:.02em}
 /* A running worker gets a moving arrow, so "is it transferring right now"
    is answerable without reading numbers. Paused when the OS asks for less
    motion — a permanently pulsing row is an accessibility problem. */
 @keyframes bwpulse{0%,100%{opacity:.35;transform:translateY(1px)}
   50%{opacity:1;transform:translateY(-1px)}}
 .bwlive .bwarrow{animation:bwpulse 1.1s ease-in-out infinite}
 .bwlive .bwarrow.bwdown{animation-delay:.55s}
 @media(prefers-reduced-motion:reduce){.bwlive .bwarrow{animation:none}}
 /* Preloader */
 /* Profile resolution (P5-04, #53) */
 .resinfo{position:relative;margin-left:6px}
 .resbtn{font:inherit;color:var(--muted);background:none;border:1px dashed var(--border);border-radius:9px;padding:0 7px;cursor:pointer}
 .resbtn:hover{color:var(--fg);border-color:var(--accent)}
 .resbtn.warn{color:#f59e0b;border-color:#f59e0b88;border-style:solid}
 .resbad{color:#f59e0b}
 .respop{position:absolute;top:22px;left:0;z-index:40;min-width:300px;max-width:440px;padding:12px;box-shadow:0 8px 24px rgba(0,0,0,.3)}
 .respop code{font-size:var(--fs-sm)}
 #boot{position:fixed;inset:0;z-index:50;background:var(--bg);display:flex;
       align-items:center;justify-content:center;flex-direction:column;gap:14px;
       transition:opacity .35s ease}
 #boot.gone{opacity:0;pointer-events:none}
 .bars{display:flex;align-items:flex-end;gap:5px;height:34px}
 .bars i{display:block;width:7px;border-radius:2px;background:var(--accent);
         animation:bb 1.05s ease-in-out infinite}
 .bars i:nth-child(1){height:38%;animation-delay:0s}
 .bars i:nth-child(2){height:66%;animation-delay:.12s;background:hsl(17 66% 55%)}
 .bars i:nth-child(3){height:100%;animation-delay:.24s;background:hsl(250 85% 66%)}
 .bars i:nth-child(4){height:54%;animation-delay:.36s;background:hsl(213 90% 60%)}
 @keyframes bb{0%,100%{transform:scaleY(.45);opacity:.55}50%{transform:scaleY(1);opacity:1}}
 .bars i{transform-origin:bottom}
 @media (prefers-reduced-motion:reduce){
   .bars i,.dot{animation:none}
   .costpulse{animation:none}
   .loe .needle{animation:none;transform:rotate(var(--d))}
 }
 @keyframes loe-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}

 /* ==== App shell: left nav drawer + top app bar ========================
    Section navigation used to be a wrapping row of chips in the header,
    competing with Logs/Rates/refresh/theme for the same line. The drawer
    owns sections now; the bar owns global actions. Three drawer modes,
    driven purely by width:
      >=1200px  expanded (icon + label), pinned, content shifted right
      641-1199  icon rail, labels on hover/tooltip
      <=640px   off-canvas over a scrim, opened from the hamburger      */
 #nav{position:fixed;top:0;left:0;bottom:0;width:var(--nav-w);z-index:64;
   background:var(--card);border-right:1px solid var(--border);
   display:flex;flex-direction:column;overflow-y:auto;overscroll-behavior:contain;
   transition:transform .2s ease,width .2s ease}
 #nav::-webkit-scrollbar{width:6px}
 #nav::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}
 .navbrand{display:flex;align-items:center;gap:8px;padding:14px 14px 12px;
   font-weight:700;font-size:var(--fs-sm);letter-spacing:-.01em;flex:none;
   border-bottom:1px solid var(--border)}
 .navbrand svg{flex:none}
 .navsec{font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.08em;
   color:var(--muted);padding:12px 14px 4px;flex:none}
 .navlist{display:flex;flex-direction:column;gap:2px;padding:6px 8px}
 /* Real anchors, so middle-click and ⌘-click open a section in a new tab. */
 .navitem{display:flex;align-items:center;gap:10px;padding:8px 10px;
   border-radius:6px;color:var(--muted);text-decoration:none;font-size:var(--fs-sm);
   position:relative;min-height:40px;cursor:pointer;
   border-left:2px solid transparent;transition:background .12s ease,color .12s ease}
 .navitem:hover{background:color-mix(in srgb,var(--accent) 9%,transparent);color:var(--fg)}
 .navitem.on{color:var(--accent);background:color-mix(in srgb,var(--accent) 13%,transparent);
   border-left-color:var(--accent);font-weight:600}
 .navico{width:20px;flex:none;text-align:center;font-size:var(--fs-md);line-height:1}
 .navlbl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .navbadge{margin-left:auto;font-size:var(--fs-xs);font-weight:700;padding:1px 6px;
   border-radius:999px;background:var(--border);color:var(--fg);flex:none;
   font-variant-numeric:tabular-nums}
 .navbadge.alert{background:#ef4444;color:#fff}
 .navbadge[hidden]{display:none}
 .navsep{height:1px;background:var(--border);margin:8px 12px;flex:none}
 .navfoot{margin-top:auto;padding:10px 12px;font-size:var(--fs-xs);color:var(--muted)}
 #navpin{margin-left:auto;background:none;border:none;color:var(--muted);
   cursor:pointer;font-size:var(--fs-md);line-height:1;padding:2px 4px}
 #navpin:hover{color:var(--accent)}
 #navscrim{position:fixed;inset:0;z-index:63;background:rgba(0,0,0,.55);
   backdrop-filter:blur(2px);opacity:0;pointer-events:none;transition:opacity .2s ease}
 #navscrim.open{opacity:1;pointer-events:auto}
 /* Content is pushed, not overlapped, whenever the drawer is pinned open. */
 body{--shell-pad:var(--nav-w)}
 .shell{padding-left:var(--shell-pad);transition:padding-left .2s ease}

 /* Top app bar — slim, sticky, one row at every width. */
 .appbar{position:sticky;top:0;z-index:40;display:flex;align-items:center;
   gap:var(--sp-3);min-height:var(--bar-h);padding:var(--sp-2) var(--pad);
   background:color-mix(in srgb,var(--bg) 88%,transparent);
   backdrop-filter:blur(8px);border-bottom:1px solid transparent;
   transition:border-color .15s ease}
 .appbar.scrolled{border-bottom-color:var(--border)}
 .appbar .bartitle{font-size:var(--fs-lg);font-weight:650;letter-spacing:-.02em;
   white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .appbar .barmeta{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;
   overflow:hidden;text-overflow:ellipsis}
 .baractions{margin-left:auto;display:flex;align-items:center;gap:var(--sp-2)}
 #hamburger{display:none;background:none;border:1px solid var(--border);
   color:var(--fg);border-radius:6px;width:38px;height:38px;cursor:pointer;
   font-size:var(--fs-lg);line-height:1;flex:none}
 #hamburger:hover{border-color:var(--accent);color:var(--accent)}
 /* Below ~480px the secondary actions collapse behind a ⋯ menu. */
 #barmore{display:none;position:relative}
 #barmenu{position:absolute;right:0;top:calc(100% + 6px);z-index:45;
   background:var(--card);border:1px solid var(--border);border-radius:8px;
   padding:6px;min-width:172px;box-shadow:0 14px 34px rgba(0,0,0,.45);
   flex-direction:column;gap:2px;display:none}
 #barmenu.open{display:flex}
 #barmenu > *{width:100%;text-align:left;justify-content:flex-start}

 /* ---- Home: navigation cards ---------------------------------------- */
 .homegrid{display:grid;gap:var(--gap);
   grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))}
 .homecard{display:flex;flex-direction:column;gap:var(--sp-2);padding:var(--sp-5);
   text-decoration:none;color:inherit;border-radius:10px;
   background:var(--card);border:1px solid var(--border);min-width:0;
   transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease}
 .homecard:hover{transform:translateY(-2px);border-color:var(--accent);
   box-shadow:0 10px 26px rgba(0,0,0,.28)}
 .homecard .hc-top{display:flex;align-items:center;gap:9px}
 .homecard .hc-ico{width:34px;height:34px;border-radius:9px;flex:none;
   display:flex;align-items:center;justify-content:center;font-size:var(--fs-lg);
   background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}
 .homecard .hc-name{font-size:var(--fs-md);font-weight:650}
 .homecard .hc-desc{font-size:var(--fs-xs);color:var(--muted);line-height:1.5}
 .homecard .hc-stat{margin-top:auto;padding-top:var(--sp-2);font-size:var(--fs-sm);
   font-weight:650;font-variant-numeric:tabular-nums}

 /* ---- Empty states --------------------------------------------------- */
 .empty{display:flex;flex-direction:column;align-items:center;justify-content:center;
   gap:6px;padding:var(--sp-6) var(--sp-4);text-align:center;color:var(--muted)}
 .empty .e-ico{font-size:24px;opacity:.55;line-height:1}
 .empty .e-msg{font-size:var(--fs-sm)}
 .empty .e-hint{font-size:var(--fs-xs);opacity:.8}

 /* A focus ring that is actually visible in both themes. Applied globally via
    :focus-visible so keyboard users never lose their place, while mouse
    clicks stay ring-free. */
 :where(a,button,input,select,summary,[tabindex]):focus-visible{
   outline:2px solid var(--accent);outline-offset:2px;border-radius:5px}
 /* Speedometer: LAST column, fixed width, so every gauge lands on the same
    vertical line no matter how long the title or model name is. The meta
    column beside it is fixed too — otherwise its width would shift the dial. */
 /* align-self:stretch makes the column span the full row height, so its
    justify-content:center actually has room to work. Sized to content it would
    simply sit wherever the flex row's align-items dropped it, which reads as
    top-aligned next to the taller gauge. */
 .metacol{width:150px;text-align:right;min-width:0;align-self:stretch;
   display:flex;flex-direction:column;justify-content:center;gap:1px}
 /* Dial on top, this session's transfer directly beneath it. Column, not
    row, so the bytes read as a caption to the gauge they belong to. A hairline
    divider marks the seam between the two different metrics (load vs. bytes)
    stacked in the same column, so they don't read as one merged block. */
 .loecol{width:78px;display:flex;flex-direction:column;align-items:center;
   justify-content:center;gap:2px;align-self:stretch;margin-left:2px}
 .loecol .bw{justify-content:center;flex-wrap:wrap;gap:2px 6px;margin-top:0;
   padding-top:4px;border-top:1px solid var(--border);width:100%}
 /* #7/#8/#9/#10/#12 gauge rebuild ----------------------------------------
    Single component, three size presets driven purely by --gauge-size: the
    viewBox is a fixed 100x100 square, so scaling the CSS width/height alone
    scales every stroke width, tick length and font size in lockstep — no
    separate "spindly at large size" math needed (#10). */
 .loe{display:inline-flex;align-items:center;line-height:0;
   --gauge-size:var(--gauge-md,84px)}
 .loe.sz-sm{--gauge-size:56px}
 .loe.sz-md{--gauge-size:84px}
 .loe.sz-lg{--gauge-size:132px}
 .loe svg{width:var(--gauge-size);height:var(--gauge-size);display:block}
 /* Dark theme only: a faint glow under the value arc so it reads as an
    instrument face, not a flat vector (#7). */
 [data-theme=dark] .loe .gval{filter:drop-shadow(0 0 3px currentColor)}
 .loe .needle{transform-origin:50% 38%}
 /* Travel: on first paint and every refresh the needle SWEEPS from its
    previous angle (--from) to the new one (--d) — refreshes must be visibly
    alive (#9). animation-fill-mode:both holds the end angle once the travel
    finishes; the idle tremor (unchanged mechanism, much smaller amplitude
    now that travel carries the "something changed" signal) starts only
    after travel completes via its own animation-delay, so the two never
    fight over the transform mid-sweep. */
 .loe .needle{
   animation: needle-travel .6s cubic-bezier(.22,1,.36,1) both,
              needle-tremor var(--spd) ease-in-out .6s infinite;
 }
 @keyframes needle-travel{
   0%  {transform:rotate(var(--from))}
   100%{transform:rotate(var(--d))}
 }
 @keyframes needle-tremor{
   0%  {transform:rotate(calc(var(--d) - var(--amp)))}
   50% {transform:rotate(calc(var(--d) + var(--amp)))}
   100%{transform:rotate(calc(var(--d) - var(--amp)))}
 }
 /* #8: danger state pulses the whole dial, same mechanism as .costpulse,
    so "this is bad" uses the same visual vocabulary as the rest of the page
    rather than inventing a second animation for the same meaning. Disabled
    under prefers-reduced-motion below, same as every other pulse. */
 .loe.gdanger{animation:cost-pulse 1.3s ease-in-out infinite}
 @media (prefers-reduced-motion:reduce){
   .loe.gdanger{animation:none}
 }

 /* Activity heatmap — GitHub-style calendar. Fixed cell size with horizontal
    scroll beats squeezing 26 weeks into a phone width. */
 /* The calendar stretches to consume the full card width: week columns share
    the space equally (flex:1) and cells stay square via aspect-ratio, instead
    of being fixed at 13px and leaving dead space on a wide screen. */
 .hm-scroll{padding-bottom:3px;width:100%}
 .hm-months{display:flex;gap:3px;margin-bottom:3px;padding-left:1px;width:100%}
 .hm-mon{flex:1 1 0;min-width:0;font-size:var(--fs-xs);color:var(--muted);letter-spacing:.02em}
 .hm-grid{display:flex;gap:3px;width:100%}
 .hm-w{display:flex;flex-direction:column;gap:3px;flex:1 1 0;min-width:0}
 .hm-d{width:100%;aspect-ratio:1;border-radius:2px;display:block;
   background:var(--border);transition:transform .1s ease}
 .hm-d:hover{transform:scale(1.35)}
 .hm-d.hm-pad{visibility:hidden}
 .hm-d.l0{background:color-mix(in srgb,var(--border) 55%,transparent)}
 .hm-d.l1{background:color-mix(in srgb,var(--accent) 22%,var(--border))}
 .hm-d.l2{background:color-mix(in srgb,var(--accent) 45%,var(--border))}
 .hm-d.l3{background:color-mix(in srgb,var(--accent) 68%,var(--border))}
 .hm-d.l4{background:color-mix(in srgb,var(--accent) 85%,var(--border))}
 .hm-d.l5{background:var(--accent)}
 .hm-key{display:flex;align-items:center;gap:3px;margin-top:7px;font-size:var(--fs-xs);flex-wrap:wrap}
 /* Key swatches must NOT stretch like the calendar cells. */
 .hm-key .hm-d{width:11px;height:11px;flex:none;aspect-ratio:auto}
 .hm-lg{display:inline-flex;align-items:center;gap:3px;margin-right:7px}
 .hm-sw{width:9px;height:9px;border-radius:2px;display:inline-block;flex:none}
 .hm-sep{width:1px;height:11px;background:var(--border);margin:0 6px}

 /* ---- Router help overlay -------------------------------------------
    Explains what actually runs the work for the CURRENT profile. Model and
    provider names keep their palette colour here too, so a name learnt in a
    chart is recognisable in the explanation. */
 #helpbtn{cursor:pointer;border:1px solid var(--border);background:var(--card);
   color:var(--muted);width:24px;height:24px;border-radius:50%;font-size:var(--fs-md);
   font-weight:700;line-height:1;display:inline-flex;align-items:center;
   justify-content:center;transition:all .15s ease;flex:none}
 #helpbtn:hover{color:var(--accent);border-color:var(--accent)}
 #helpwrap{position:fixed;inset:0;z-index:70;display:none}
 #helpwrap.open{display:block}
 #helpscrim{position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px)}
 #helppanel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
   width:min(900px,94vw);max-height:88vh;overflow-y:auto;background:var(--card);
   border:1px solid var(--border);border-radius:12px;padding:22px 26px;
   box-shadow:0 24px 60px rgba(0,0,0,.5)}
 .hpt{font-size:var(--fs-lg);font-weight:700;margin-bottom:3px}
 .hpsub{font-size:var(--fs-sm);color:var(--muted);margin-bottom:16px}
 .hsec{margin:16px 0 8px;font-size:var(--fs-sm);font-weight:700;text-transform:uppercase;
   letter-spacing:.06em;color:var(--muted)}
 .hnote{font-size:var(--fs-sm);color:var(--muted);margin:5px 0 9px;line-height:1.55}
 /* Each hop is a numbered row so the ORDER is unmistakable. */
 .hhop{display:flex;align-items:center;gap:9px;padding:6px 9px;border-radius:7px;
   border:1px solid var(--border);margin-bottom:5px;font-size:var(--fs-sm);background:var(--bg)}
 .hnum{width:19px;height:19px;border-radius:50%;flex:none;display:flex;
   align-items:center;justify-content:center;font-size:var(--fs-xs);font-weight:700;
   background:var(--border);color:var(--muted)}
 .hhop.primary .hnum{background:hsl(142 65% 45%);color:#04140a}
 .hmodel{font-size:var(--fs-md);font-weight:600}
 .hurl{font-size:var(--fs-xs);color:var(--muted);margin-left:auto;font-family:ui-monospace,monospace}
 .harrow{color:var(--muted);font-size:var(--fs-md);text-align:center;margin:1px 0}
 .htask{display:flex;align-items:baseline;gap:8px;padding:5px 0;
   border-bottom:1px dashed var(--border);font-size:var(--fs-sm)}
 .htn{width:132px;flex:none;font-weight:600;font-size:var(--fs-sm)}
 .htd{color:var(--muted);font-size:var(--fs-xs);flex:1}
 #helpclose{position:absolute;top:13px;right:15px;cursor:pointer;color:var(--muted);
   font-size:19px;line-height:1;background:none;border:none}
 #helpclose:hover{color:var(--fg)}
 #heatcard[hidden]{display:none}

 /* ---- Flow graph (Provider -> model -> task) -------------------------
    Force-directed, rendered as plain SVG. No d3: the layout is ~100 nodes,
    so a small velocity-Verlet loop is cheaper than shipping a library. */
 #flowwrap{position:relative;width:100%;height:calc(100vh - 250px);
   height:calc(100dvh - 250px);min-height:460px}
 #flow{width:100%;height:100%;display:block;cursor:grab;touch-action:none}
 #flow.drag{cursor:grabbing}
 /* Work-proportional glow. --heat (0..1) is sqrt(calls/maxCalls), set per node
    in renderFlow, so the busiest node burns brightest and idle ones stay flat.
    drop-shadow on the GROUP (not the circle) so the label glows with it.
    Radii are generous (up to 26px): a 9px blur on a 26px node was measurably
    present but invisible against the dark card. Three stacked shadows — tight
    core, mid bloom, wide falloff — read as light rather than a flat ring. */
 .nd{cursor:grab;
   filter:drop-shadow(0 0 calc(1px + 5px * var(--heat,0)) color-mix(in srgb, var(--glow,#fff) calc(95% * var(--heat,0)), transparent))
          drop-shadow(0 0 calc(2px + 13px * var(--heat,0)) color-mix(in srgb, var(--glow,#fff) calc(75% * var(--heat,0)), transparent))
          drop-shadow(0 0 calc(3px + 26px * var(--heat,0)) color-mix(in srgb, var(--glow,#fff) calc(45% * var(--heat,0)), transparent));
   transition:filter .18s ease}
 /* Dragging overrides the heat ramp: while held, a node is always legible. */
 .nd.dragging{cursor:grabbing;
   filter:drop-shadow(0 0 8px color-mix(in srgb, var(--glow,#fff) 95%, transparent))
          drop-shadow(0 0 22px color-mix(in srgb, var(--glow,#fff) 70%, transparent))}
 .nd.dragging circle{stroke-width:2.5}
 /* A node the user placed keeps a thin ring, so deliberate layout survives
    visually even after the pointer leaves. */
 .nd.pinned circle{stroke-dasharray:2 2}
 #flow .lnk{stroke:var(--border);stroke-opacity:.55;fill:none}
 /* grab, not pointer: these nodes are draggable. Higher specificity than the
    .nd base rule, so it must carry the drag cursor too. */
 #flow .nd{cursor:grab}
 #flow .nd.dragging{cursor:grabbing}
 #flow .nd circle{transition:stroke-width .12s ease}
 #flow .nd text{font-size:var(--fs-xs);fill:var(--muted);pointer-events:none;
   text-anchor:middle;paint-order:stroke;stroke:var(--card);stroke-width:2.5px}
 #flow .nd.root text,#flow .nd.prov text{font-size:var(--fs-sm);font-weight:600;fill:var(--fg)}
 #flow .nd.model text{font-size:var(--fs-xs);font-weight:600}
 /* Dim everything except the hovered subtree — with ~100 nodes the eye needs
    help following one provider's branch. */
 #flow.focus .nd,#flow.focus .lnk{opacity:.13}
 #flow.focus .nd.on,#flow.focus .lnk.on{opacity:1}
 /* #18: zoomed further out than the initial fit — the graph is now a tangle
    of overlapping labels, so hide the small/task labels (the tooltip on tap
    still gives the name) and dim links to cut noise. Model/provider/root
    labels stay: they carry the graph's structure, not its detail. */
 #flow.zoomedout .nd.task text{display:none}
 #flow.zoomedout .lnk{stroke-opacity:.22}
 .flowtip{position:absolute;pointer-events:none;opacity:0;transition:opacity .1s;
   background:var(--card);border:1px solid var(--border);border-radius:6px;
   padding:7px 10px;font-size:var(--fs-sm);box-shadow:0 8px 24px rgba(0,0,0,.45);z-index:5;
   max-width:260px}
 .flowtip.on{opacity:1}
 .flowtip .ft-h{font-weight:600;font-size:var(--fs-sm);margin-bottom:3px}
 .flowtip .ft-r{display:flex;justify-content:space-between;gap:14px;color:var(--muted)}
 .flowtip .ft-r b{color:var(--fg);font-weight:600}
 /* #120 task queue: two lanes, animated chip lifecycle. Kept CSS-driven
    (transform/opacity transitions + one keyframe animation) rather than a
    JS render loop, so the idle shimmer costs nothing on low-power devices. */
 /* Three lanes on desktop, one on narrow screens. Deliberately NOT
    `1fr 1fr 1fr`: that fixed triple is exactly what check_responsive_grid.js
    forbids (it squashes canvases and overflows), and it is also the wrong
    tool here — auto-fit lets the lanes collapse to fewer columns on a
    narrower screen without a media query doing the same job twice. */
 .qlanes{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
 .qlane{min-height:64px;min-width:0}
 .qlanehdr{font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.05em;
   color:var(--muted);display:flex;align-items:center;gap:6px;margin-bottom:6px}
 .qcount{background:var(--card);border:1px solid var(--border);border-radius:999px;
   padding:0 6px;font-size:var(--fs-xs);line-height:16px;min-width:16px;text-align:center}
 .qitems{display:flex;flex-direction:column;gap:6px;min-height:2px}
 .qempty{font-size:var(--fs-sm);color:var(--muted);padding:10px 0;
   display:flex;align-items:center;gap:6px}
 .qempty .qdot{width:6px;height:6px;border-radius:999px;background:#22c55e;
   box-shadow:0 0 0 rgba(34,197,94,.5);animation:qpulse-ok 2.2s ease-out infinite}
 @keyframes qpulse-ok{0%{box-shadow:0 0 0 0 rgba(34,197,94,.45)}
   70%{box-shadow:0 0 0 7px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
 /* One chip per task; enters via qin, sits with an idle shimmer while queued,
    TRAVELS to the next lane via a FLIP transform (queued->running->done),
    leaves for good via qout once its lane fills past 10 and it ages out. */
 .qchip{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:8px;
   border:1px solid var(--border);background:var(--card);font-size:var(--fs-sm);
   animation:qin .28s cubic-bezier(.2,.8,.2,1) both;
   transition:transform .32s cubic-bezier(.3,.85,.35,1),opacity .25s ease,border-color .25s ease}
 .qchip.leaving{animation:qout .22s ease-in forwards}
 .qchip.travel{will-change:transform}
 .qchip.arrived{animation:qland .3s cubic-bezier(.3,.9,.3,1) both}
 @keyframes qin{from{opacity:0;transform:translateY(4px) scale(.97)}to{opacity:1;transform:none}}
 @keyframes qout{to{opacity:0;transform:translateX(10px) scale(.96)}}
 @keyframes qland{0%{transform:scale(1.05)}100%{transform:scale(1)}}
 .qchip .qdotwrap{width:7px;height:7px;border-radius:999px;flex:none}
 .qlane[data-lane="queued"] .qchip .qdotwrap{background:#f59e0b;
   animation:qshimmer 1.6s ease-in-out infinite}
 .qlane[data-lane="running"] .qchip .qdotwrap{background:#22c55e}
 .qlane[data-lane="done"] .qchip .qdotwrap{background:#64748b}
 .qlane[data-lane="done"] .qchip{opacity:.82}
 @keyframes qshimmer{0%,100%{opacity:.4}50%{opacity:1}}
 .qchip .qmodel{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}
 .qchip .qprof{color:var(--muted);font-size:var(--fs-xs);
   padding:0 5px;border:1px solid var(--border);border-radius:999px}
 .qchip .qwait{margin-left:auto;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap}
 .flowctl{float:right;display:flex;gap:4px;align-items:center}
 .flowctl button{font-size:var(--fs-xs);text-transform:none;letter-spacing:0;
   padding:2px 8px;border-radius:4px;border:1px solid var(--border);
   background:transparent;color:var(--muted);cursor:pointer}
 .flowctl button.on{border-color:var(--accent);color:var(--accent)}


 /* ---- Ollama host panel (Live tab) -----------------------------------
    One card per PHYSICAL box (several URLs can front the same server), because
    showing four "hosts" when two exist would misreport capacity. */
 .olgrid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(310px,1fr))}
 .olcard{border:1px solid var(--border);border-radius:9px;padding:11px 12px;
   background:color-mix(in srgb,var(--card) 70%,transparent)}
 .olcard.down{opacity:.62;border-style:dashed}
 .olhead{display:flex;align-items:center;gap:7px;margin-bottom:8px}
 .olname{font-size:var(--fs-md);font-weight:600}
 /* Same inline-element trap as .olfill: <i> needs an explicit display or its
    width/height are ignored (the dot only looked right because of its ring). */
 .oldot{display:block;width:8px;height:8px;border-radius:50%;flex:none}
 .oldot.up{background:hsl(142 70% 45%);box-shadow:0 0 0 3px hsl(142 70% 45% / .18)}
 .oldot.down{background:hsl(0 72% 55%);box-shadow:0 0 0 3px hsl(0 72% 55% / .18)}
 /* "local" badge: same glyph + tint as the local provider badge elsewhere. */
 .olbadge{font-size:var(--fs-xs);padding:1px 6px;border-radius:4px;font-weight:600;
   background:hsl(196 88% 55% / .16);color:hsl(196 88% 60%);flex:none}
 .olver{font-size:var(--fs-xs);color:var(--muted);margin-left:auto;flex:none}
 .olurls{font-size:var(--fs-xs);color:var(--muted);margin:-4px 0 8px 0;word-break:break-all}
 /* Load bars. Colour is a judgement (green/amber/red), not decoration: it is
    the only thing that reads at a glance from across the room. */
 .olrow{display:flex;align-items:center;gap:7px;margin:5px 0;font-size:var(--fs-sm)}
 .ollbl{width:74px;flex:none;color:var(--muted);font-size:var(--fs-xs)}
 .olbar{flex:1;height:7px;border-radius:4px;background:var(--border);overflow:hidden;min-width:40px}
 /* display:block is REQUIRED: <i> defaults to display:inline, and inline
    non-replaced elements ignore width/height entirely — the fill rendered as a
    0x0 box, so every bar looked empty no matter what value it carried. */
 .olfill{display:block;height:100%;border-radius:4px;transition:width .45s ease}
 .olfill.good{background:hsl(142 65% 45%)}
 .olfill.warn{background:hsl(38 92% 52%)}
 .olfill.bad{background:hsl(0 72% 55%)}
 .olval{width:62px;flex:none;text-align:right;font-variant-numeric:tabular-nums;font-size:var(--fs-xs)}
 /* The numeric readout carries the same traffic-light colour as its bar, so
    the value is legible as good/warn/bad without measuring the bar by eye. */
 .olval.good{color:hsl(142 55% 52%)}
 .olval.warn{color:hsl(38 88% 58%)}
 .olval.bad{color:hsl(0 70% 64%)}
 /* Per-GPU chips: only rendered for the local box, which is the only host that
    can report real device telemetry. */
 .olgpus{display:flex;flex-wrap:wrap;gap:5px;margin:5px 0 2px}
 .olgpu{font-size:var(--fs-xs);padding:1px 6px;border-radius:4px;border:1px solid var(--border);
   color:var(--muted);font-variant-numeric:tabular-nums}
 .olmod{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:7px 0 3px}
 .olmn{font-size:var(--fs-md);font-weight:600}
 /* Capability pills — what this box can actually do (tools/vision/thinking). */
 .olcap{font-size:var(--fs-xs);padding:1px 5px;border-radius:3px;border:1px solid var(--border);
   color:var(--muted-foreground,var(--muted))}
 .olcap.tools{border-color:hsl(262 80% 60% / .5);color:hsl(262 80% 70%)}
 .olcap.vision{border-color:hsl(320 85% 60% / .5);color:hsl(320 85% 70%)}
 .olcap.thinking{border-color:hsl(38 92% 52% / .5);color:hsl(38 92% 60%)}
 .olidle{font-size:var(--fs-sm);color:var(--muted);padding:4px 0}
 .olwork{display:flex;gap:10px;flex-wrap:wrap;font-size:var(--fs-xs);color:var(--muted);
   margin-top:8px;padding-top:7px;border-top:1px solid var(--border)}
 #soundtoggle.on{border-color:var(--accent);color:var(--accent)}
 .olwork b{color:var(--foreground);font-weight:600;font-variant-numeric:tabular-nums}
 .olstale{font-size:var(--fs-xs);color:hsl(38 92% 60%)}


 /* Model name inside a drawer log line — bigger than the surrounding text so
    the eye lands on "which model" before reading the message. */
 .evm{font-size:var(--fs-md);font-weight:600}
 /* Tool name in a drawer line — same weight as the model name so the eye can
    scan either column, coloured from the tool palette. */
 .evt{font-size:var(--fs-sm);font-weight:600}

 /* Failure filter chips — same visual language as the drawer's filter tabs. */
 .fchip{padding:2px 8px;border-radius:4px;border:1px solid var(--border);
   background:transparent;color:var(--muted);cursor:pointer;font-size:var(--fs-xs);
   line-height:1.7;white-space:nowrap}
 .fchip:hover{border-color:var(--accent)}
 .fchip.on{background:var(--card);font-weight:600}
 /* Health page (#110) */
 .hsum{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--gap)}
 @media (max-width:900px){.hsum{grid-template-columns:repeat(2,minmax(0,1fr))}}
 .hsumc{padding:12px 14px;min-width:0}
 .hsumv{font-size:22px;font-weight:700;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .hsuml{font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-top:4px}
 .hsums{font-size:var(--fs-xs);margin-top:2px}
 .hhdr{display:flex;align-items:baseline;gap:8px}
 .hsub{text-transform:none;letter-spacing:0;font-weight:400;font-size:var(--fs-xs)}
 .hrow.hthin{opacity:.5}
 .ffwrap{display:flex;flex-direction:column;gap:6px}
 .ffrow{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
 .fflbl{width:48px;flex:none;font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
 .frow{padding:4px 6px;border-radius:4px}
 .frow:hover{background:var(--card)}
 .fwhen{min-width:74px;font-variant-numeric:tabular-nums}
 .fmsg{flex:1;min-width:0;color:var(--fg)}
 .fcnt{min-width:36px;text-align:center;font-size:var(--fs-xs);font-weight:600;padding:0 6px;border-radius:9px;border:1px solid var(--border);color:var(--muted)}
 .fkind{width:72px;text-align:center}
 .fmodel{width:150px}
 .fwhen{width:92px}
 .fmsg{flex:1;min-width:0}
 #faillist::-webkit-scrollbar{width:7px}
 #faillist::-webkit-scrollbar-track{background:transparent}
 #faillist::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}
 #faillist{scrollbar-width:thin;scrollbar-color:var(--border) transparent}

 /* Live session list scrolls inside its card; keep the scrollbar unobtrusive
    so a long list never looks like a broken layout. */
 #livelist::-webkit-scrollbar{width:7px}
 #livelist::-webkit-scrollbar-track{background:transparent}
 #livelist::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}
 #livelist::-webkit-scrollbar-thumb:hover{background:var(--muted)}
 #livelist{scrollbar-width:thin;scrollbar-color:var(--border) transparent}

 /* Est. cost pulses so the number the user cares about most catches the eye
    without shouting — opacity only, no layout shift. */
 @keyframes cost-pulse{0%,100%{opacity:1}50%{opacity:.35}}
 /* Local electricity cost (P7-04, #68): distinct from billed spend. */
 .elecmark{font-size:var(--fs-xs);font-weight:600;letter-spacing:.04em;text-transform:uppercase;
   padding:0 4px;border-radius:3px;background:rgba(234,179,8,.14);color:#eab308;vertical-align:1px}
 .kpisub{font-size:var(--fs-xs);font-weight:500;margin-top:1px;color:var(--muted)}

/* #11: radial KPI rings — compact, no-needle variant of the gauge for
   bounded 0-100 metrics inside the tight KPI strip; sparklines for the
   unbounded counters next to it, so both live in the same card recipe. */
.kpi-ring{display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center}
.kringwrap{width:44px;height:44px}
.kring{display:block;width:100%;height:100%}
.kring svg{width:100%;height:100%;display:block}
.kspwrap{display:inline-block;width:64px;height:20px;vertical-align:middle;margin-left:6px}
.kspark{width:100%;height:100%;display:block}

 /* Unpriced / free-tier cost states (P9-05, #82) */
 .unpriced{font-size:var(--fs-xs);font-weight:600;letter-spacing:.04em;text-transform:uppercase;
   padding:1px 5px;border-radius:3px;background:rgba(239,68,68,.14);color:#f87171}
 .freetier{color:var(--muted)}
 .ftmark{font-size:var(--fs-xs);font-weight:600;letter-spacing:.04em;text-transform:uppercase;
   padding:0 4px;border-radius:3px;background:rgba(168,85,247,.15);color:#c084fc;vertical-align:1px}
 .unpricedbanner{margin:8px 0 2px;padding:8px 12px;border-radius:8px;font-size:var(--fs-sm);line-height:1.5;
   border:1px solid rgba(239,68,68,.4);background:rgba(239,68,68,.07)}
 .unpricedbanner[hidden]{display:none}
 .unpricedbanner a{color:var(--accent);text-decoration:underline}
 .costpulse{animation:cost-pulse 2.2s ease-in-out infinite;
   color:var(--accent2);display:inline-block}
 .resendname{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 @media (max-width:560px){#resendtbl .rsx{display:none} .resendname{max-width:130px}}
 /* Settings (P7-03, #67) */
 .setgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
 .setf{display:flex;flex-direction:column;gap:4px;border:1px solid var(--border);border-radius:8px;padding:10px}
 .setl{font-size:var(--fs-sm);text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
 .setin{display:flex;align-items:center;gap:6px;font-size:var(--fs-md)}
 .setin input{width:100%;min-width:0;max-width:140px;background:transparent;color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:4px 6px;font:inherit}
 .setin input:focus{outline:2px solid var(--accent);outline-offset:1px}
 .setin input:invalid{border-color:#ef4444}
 .seth{font-size:var(--fs-sm);color:var(--muted)}
 .setderiv{margin-top:12px;font-size:var(--fs-sm);overflow-wrap:anywhere}
 .setderiv code{font-size:var(--fs-sm)}
 .setbad{color:#ef4444}
 .setok{color:#22c55e}
 .setfacts2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
 .setfacts2 td,.setfacts2 th{padding:2px 6px}
 .setlist{list-style:disc;padding-left:16px;display:flex;flex-direction:column;gap:6px}
 #setsave:disabled{opacity:.45;cursor:not-allowed}
 @media (max-width:640px){ .setfacts2{grid-template-columns:1fr} .setin input{max-width:none} }

 /* ---- Logs drawer -------------------------------------------------------
    Fixed to the right edge, above everything, and translated off-screen when
    closed so it costs nothing until opened. */
 #logbtn{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:60;
   display:flex;align-items:center;gap:7px;padding:13px 10px;
   border-radius:7px 0 0 7px;border:1px solid var(--border);border-right:none;
   background:var(--card);color:var(--fg);cursor:pointer;font-size:var(--fs-sm);
   font-weight:600;letter-spacing:.04em;writing-mode:vertical-rl;
   box-shadow:-4px 0 18px rgba(0,0,0,.35);transition:padding .15s ease}
 #logbtn:hover{border-color:var(--accent);padding-right:14px}
 /* Hide the tab itself while the drawer is open — it would sit under the panel. */
 #logbtn.hidden{opacity:0;pointer-events:none}
 #logbtn .n{background:#ef4444;color:#fff;border-radius:999px;padding:1px 6px;
   font-size:var(--fs-xs);font-weight:600;line-height:1.5}
 #logbtn .n[hidden]{display:none}
 .n2{background:#ef4444;color:#fff;border-radius:999px;padding:0 5px;
   font-size:var(--fs-xs);font-weight:700;margin-left:3px}
 .n2[hidden]{display:none}
 #drawer{position:fixed;top:0;right:0;bottom:0;width:min(460px,92vw);z-index:70;
   background:var(--card);border-left:1px solid var(--border);display:flex;
   flex-direction:column;transform:translateX(100%);transition:transform .22s ease;
   box-shadow:-12px 0 40px rgba(0,0,0,.4)}
 #drawer.open{transform:translateX(0)}
 #scrim{position:fixed;inset:0;z-index:65;background:rgba(0,0,0,.45);opacity:0;
   pointer-events:none;transition:opacity .22s ease}
 #scrim.open{opacity:1;pointer-events:auto}
 .dhead{display:flex;align-items:center;gap:8px;padding:13px 15px;
   border-bottom:1px solid var(--border);flex-shrink:0}
 .dtabs{display:flex;gap:5px;padding:9px 15px;border-bottom:1px solid var(--border);
   flex-shrink:0;flex-wrap:wrap}
 .dtab{font-size:var(--fs-xs);padding:3px 9px;border-radius:3px;cursor:pointer;
   border:1px solid var(--border);color:var(--muted);background:transparent}
 .dtab.on{background:var(--accent);border-color:var(--accent);color:#fff}
 /* #17: 641-1024px keeps a side panel (like desktop) but widened — 460px is
    comfortable on a 1440px screen but eats half a portrait tablet. */
 @media(min-width:641px) and (max-width:1024px){
   #drawer{width:60vw}
 }
 /* #17: below 641px the side panel becomes an actual bottom sheet — a side
    panel this narrow either covers everything or leaves a useless sliver.
    The drag handle + ~92dvh height + tab strip that scrolls instead of
    wrapping are the same fixes a native app would ship for this. */
 @media(max-width:640px){
   #drawer{top:auto;right:0;left:0;width:auto;height:92dvh;max-height:92dvh;
     border-left:none;border-top:1px solid var(--border);
     border-radius:14px 14px 0 0;
     transform:translateY(100%);box-shadow:0 -12px 40px rgba(0,0,0,.4)}
   #drawer.open{transform:translateY(0)}
   #drawer .dhead{padding-top:6px}
   #draghandle{display:block;width:36px;height:4px;border-radius:2px;
     background:var(--muted);opacity:.5;margin:0 auto 8px;flex-shrink:0}
   .dtabs{flex-wrap:nowrap;overflow-x:auto;scroll-snap-type:x mandatory;
     -webkit-overflow-scrolling:touch}
   .dtab{scroll-snap-align:start;flex-shrink:0}
 }
 #draghandle{display:none}
 #dbody{overflow-y:auto;flex:1;padding:4px 0;font-family:ui-monospace,SFMono-Regular,
   Menlo,monospace;font-size:var(--fs-sm);line-height:1.45}
 .ev{display:flex;gap:9px;padding:6px 15px;border-bottom:1px solid var(--border)}
 .ev:hover{background:rgba(127,127,127,.06)}
 .ev .t{color:var(--muted);flex-shrink:0;font-variant-numeric:tabular-nums}
 .ev .b{min-width:0;flex:1;word-break:break-word}
 .ev .k{display:inline-block;padding:0 5px;border-radius:2px;font-size:var(--fs-xs);
   margin-right:6px;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
 /* .k-* chip colours are generated at boot from FKIND (installKindCSS) so the
    drawer, the health bars and the failure filters can never disagree. */
 .ev.err .b{color:#fca5a5}
 #dfoot{padding:8px 15px;border-top:1px solid var(--border);flex-shrink:0;
   display:flex;align-items:center;justify-content:space-between;font-size:var(--fs-xs)}
 /* Live tab: sessions list (wide) + stacked charts (narrow). Explicit tracks,
    because auto-fit + a fixed `span 2` disagree about the column count and
    leave dead space or a 0px track. Below 835px (tablet PORTRAIT and down,
    #14) the charts go under the list full-width rather than squeezing into
    an unreadable column — an 835-1024px LANDSCAPE tablet has the width to
    keep them side by side, so it no longer gets force-stacked. */
 .livegrid{display:grid;gap:var(--gap);align-items:stretch;
   grid-template-columns:minmax(0,2fr) minmax(300px,1fr)}
 .livegrid > *{min-width:0}
 @media(max-width:834px){
   .livegrid{grid-template-columns:minmax(0,1fr)}
   /* the list is height-capped for the side-by-side case; unpin it when stacked */
   .livegrid > .card:first-child{max-height:none !important}
 }
 /* Mobile */
 @media(max-width:640px){
   :root{--fs:14px;--gap:12px;--pad:12px}
   .hide-mobile{display:none}
   .page-title{font-size:var(--fs-lg) !important}

   /* #13: header collapses to one row — hamburger, title, overflow controls
      wrap onto their own line only if the viewport is truly too narrow for
      all of refresh/theme/sound/help, instead of the desktop's baseline-
      aligned two-block layout fighting for the same row. */
   .page > .flex.items-end.justify-between{align-items:center}
   .page > .flex.items-end.justify-between > .flex.items-center.gap-2{min-width:0;flex:1 1 auto}
   .page-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
   .page > .flex.items-end.justify-between > div > .muted.flex{flex-wrap:wrap}

   /* Every chip/button is a tap target: 44x44 minimum (#13). */
   .chip, button{min-height:44px;min-width:44px;padding-left:14px;padding-right:14px;
     display:inline-flex;align-items:center;justify-content:center}
   #navtoggle{padding:0;width:44px}
   #theme,#soundtoggle,#helpbtn{padding:0}

   /* Date range collapses to a single active-preset chip; tapping it reveals
      the two date inputs + full preset row beneath instead of all of them
      fighting for one line (avoids the desktop row overflowing at 360px). */
   #rangebar{flex-direction:column;align-items:stretch !important}
   #rangebar > .lbl{display:none}
   #rangebar input[type=date]{flex:1;min-width:0}
   #rangebar:not(.rangeopen) input[type=date],
   #rangebar:not(.rangeopen) > span.muted:not(#rangeinfo){display:none}
   #rangebar #presets{flex-wrap:wrap;width:100%}
   #rangebar:not(.rangeopen) #presets{display:none}
   #rangebar #rangeinfo{margin-left:0;width:100%;order:-1}
   #rangetoggle{display:flex !important}

   /* KPI strip: 2 columns, 1 below 400px (separate query further down). */
   .grid-kpi{grid-template-columns:repeat(2,minmax(0,1fr))}

   /* Live session rows: stack meta under the title instead of a side-by-side
      row that has no room left once the gauge and tool chips are in it. */
   .livegrid{grid-template-columns:minmax(0,1fr)}
   #livelist .liverow{flex-direction:column;align-items:flex-start;gap:6px}
   #livelist .liverow .metacol{width:100%}
   #livelist .liverow .loecol{align-self:flex-end}

   /* .olgrid (Ollama host cards, minmax(310px,1fr)) forced to one column —
      310px plus card padding overflows a 360px viewport (#13). */
   .olgrid{grid-template-columns:1fr}

   /* #19: health rows and the failure list switch from fixed-width flex
      columns (built for a wide screen) to a stacked card-per-row layout.
      Long identifiers get overflow-wrap so a model/provider name that is
      still too long to fit never forces the row wider than the viewport. */
   .hrow{flex-wrap:wrap;align-items:flex-start !important;gap:4px 8px !important;
     padding:8px 0;border-bottom:1px solid var(--border)}
   .hrow .hname{width:auto !important;flex:1 1 100%;overflow-wrap:anywhere;white-space:normal}
   .hrow .hbar{flex:1 1 100%;order:3}
   .hrow .hrate{width:auto !important;order:2}
   .hrow .hcount{width:auto !important;order:2;margin-left:auto}
   .hrow .hchips{width:auto !important;order:4;flex:1 1 100%}

   .frow{flex-wrap:wrap;gap:3px 6px !important;padding:6px 0}
   .frow .fmodel{width:auto !important;overflow-wrap:anywhere;white-space:normal;max-width:70%}
   .frow .fwhen{margin-left:auto}
   .frow .fmsg{flex:1 1 100%;white-space:normal;overflow-wrap:anywhere}
   }
 @media(max-width:400px){
   /* KPI strip: down to a single column once 2-up gets too cramped for the
      ring/sparkline cards to stay legible. */
   .grid-kpi{grid-template-columns:1fr}
 }

 /* Tablet — #14: portrait and landscape get different treatment rather than
    one 641-1024 band, because a portrait tablet has desktop-narrow WIDTH but
    plenty of HEIGHT, while landscape has the opposite. */
 @media(min-width:641px) and (max-width:1024px){
   :root{--fs:14px;--gap:14px;--pad:16px}
 }
 /* Portrait tablet (<=834px, e.g. 768x1024): single-column content, charts
    full width at a taller aspect ratio so they stay readable without the
    width a landscape/desktop layout assumes. */
 @media(min-width:641px) and (max-width:834px) and (orientation:portrait){
   .grid-2{grid-template-columns:1fr}
   canvas{max-height:min(46vh,360px) !important}
 }
 /* Landscape tablet (835-1024px, e.g. 1024x768): keep chart pairs 2-up (the
    default .grid-2 auto-fit already does this at this width) and give charts
    a viewport-height-driven ceiling instead of the desktop's fixed 280px, so
    a short landscape window does not force scrolling to see a whole chart. */
 @media(min-width:835px) and (max-width:1024px) and (orientation:landscape){
   canvas{max-height:min(38vh,300px) !important}
 }

 /* Large screens get more breathing room */
 @media(min-width:1600px){
   :root{--fs:16px;--gap:20px;--pad:28px}
 }
 /* Bandwidth panel (P8-05, #72) */
 #bwpanel[hidden]{display:none}
 .bwpkpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
 .bwpt{border:1px solid var(--border);border-radius:6px;padding:10px 12px}
 .bwpv{font-size:22px;font-weight:600;line-height:1.1;font-variant-numeric:tabular-nums}
 .bwpl{font-size:var(--fs-sm);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-top:4px}
 .bwps{font-size:var(--fs-xs);margin-top:2px}
 .bwrrow{display:grid;grid-template-columns:minmax(90px,150px) 1fr 58px 52px;align-items:center;gap:8px;font-size:var(--fs-sm)}
 .bwrm{font-weight:600}
 .bwrbar{height:8px;background:var(--border);border-radius:4px;overflow:hidden}
 .bwrbar i{display:block;height:100%;background:var(--accent);border-radius:4px}
 .bwrrow.hot .bwrbar i{background:#ef4444}
 .bwrx{text-align:right;font-variant-numeric:tabular-nums}
 .bwrflag{font-size:var(--fs-xs);color:#ef4444;white-space:nowrap}
</style></head><body>
<div id="boot"><div class="bars"><i></i><i></i><i></i><i></i></div>
  <div class="lbl">loading analytics</div></div>
<div id="navscrim"></div>
<nav id="navdrawer" aria-label="Sections">
 <div class="navbrand"><span style="color:var(--accent)">◈</span><span class="brandword"> LLM Telemetry</span><button id="navcollapse" type="button" aria-expanded="false" aria-controls="navdrawer" aria-label="Expand navigation">&#187;</button></div>
 <div id="navlist"></div>
 <div class="navsep"></div>
 <a class="navitem" href="costs.html" data-tip="Rates"><span class="nvico" aria-hidden="true">$</span><span class="nvlabel">Rates</span></a>
 <button class="navitem" type="button" id="navdrawerbtn" data-tip="Live tail"><span class="nvico" aria-hidden="true">▤</span><span class="nvlabel">Live tail</span><span class="nvbadge" id="navlogn" hidden>0</span></button>
</nav>
<div class="page flex flex-col gap-4">
 <div class="flex items-end justify-between flex-wrap gap-3">
  <div class="flex items-center gap-2">
   <button id="navtoggle" class="chip" type="button" aria-expanded="false" aria-controls="navdrawer" aria-label="Open navigation">&#9776;</button>
   <!-- Inline SVG, not a file: the dashboard is one self-contained artifact
        (ADR 0001), so an external src would break opening it from file://.
        currentColor so the mark follows the theme instead of vanishing. -->
   <svg class="brandmark" viewBox="0 0 24 24" width="26" height="26" fill="none"
        stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
    <path d="M3 17.5 8 11l4 3.5L21 5"/>
    <circle cx="8" cy="11" r="1.6" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="14.5" r="1.6" fill="currentColor" stroke="none"/>
    <circle cx="21" cy="5" r="1.8" fill="currentColor" stroke="none"/>
    <path d="M3 21h18" opacity=".35"/>
   </svg>
   <div>
    <div class="page-title" style="font-size:clamp(16px,2.5vw,22px);font-weight:650;letter-spacing:-.02em">LLM Telemetry</div>
    <div class="muted text-[length:var(--fs-xs)] mt-0.5 flex items-center gap-1.5">
     <span class="dot"></span><span id="meta"></span>
     <span id="resinfo" class="resinfo"></span>
     <span aria-hidden="true" class="opacity-40">/</span>
     <span id="crumb" aria-live="polite" class="font-medium" style="color:var(--fg)"></span>
    </div>
   </div>
  </div>
  <div class="flex gap-2 items-center flex-wrap">
   <div class="flex gap-1.5 flex-wrap items-center" id="tabs"></div>
   <span class="muted text-[length:var(--fs-xs)] whitespace-nowrap" id="tabsub"></span>
   <button id="refresh" class="chip" title="Refresh data">&#8635;</button>
   <button id="theme" class="chip" title="Toggle theme">&#9788;</button>
   <button id="soundtoggle" class="chip" type="button" aria-pressed="false"
     title="Play a tone when a session or task completes (off by default)">&#128263;</button>
   <button id="helpbtn" title="How your work gets routed (?)">?</button>
  </div>
 </div>

 <div class="card p-3 flex items-center gap-2 flex-wrap" id="rangebar">
  <span class="lbl">Range</span>
  <!-- #13: on mobile this chip is the only thing visible until tapped; it
       shows the active preset so the collapsed state still says something,
       then reveals the date inputs + preset row beneath it. Desktop ignores
       it entirely (display:none outside the mobile media query). -->
  <button type="button" id="rangetoggle" class="chip" style="display:none" aria-expanded="false" aria-controls="rangebar"></button>
  <input type="date" id="from"><span class="muted text-[length:var(--fs-xs)]">to</span><input type="date" id="to">
  <span class="flex gap-1.5 ml-1" id="presets"></span>
  <span class="muted text-[length:var(--fs-xs)] ml-auto" id="rangeinfo"></span>
 </div>

 <div class="flex gap-1.5" id="views"></div>

 <!-- Transferred: ONE card holding both directions, because the interesting
      fact is the ratio between them (upload dominates ~255:1 -- a whole
      conversation is re-sent to receive one paragraph) and splitting the
      directions across cards would hide exactly that. Sits BEFORE the KPI row:
      it is a headline number, not a drill-down. -->
 <div class="card p-3 mb-3" id="xfercard" hidden>
  <div class="flex items-center gap-3 flex-wrap">
   <div class="lbl">Transferred
    <span class="muted normal-case tracking-normal text-[length:var(--fs-xs)] ml-1"
      title="Every recorded API call whose date falls in the selected range, across all sessions, finished or not.">all sessions &middot; selected date range &middot; estimated</span>
   </div>
   <div id="xfertot" class="bw"></div>
   <div class="muted text-[length:var(--fs-xs)] ml-auto" id="xfernote"></div>
  </div>
 </div>

 <div class="grid-kpi" id="kpis"></div>
 <div id="unpricedbanner" class="unpricedbanner" hidden></div>



 <!-- Home: the landing surface. Opening the tool used to drop you straight
      into Live with no explanation of what the other sections hold. Cards carry
      a real stat from the loaded payload, so this answers "what is going on"
      instead of being a menu. -->
 <div class="view" data-view="Home">
  <div class="grid-home" id="homecards"></div>
 </div>

 <div class="view" data-view="Live">
  <!-- Two columns that END TOGETHER. The session list is unbounded (it grows
       with concurrency) while the charts are fixed-content, so the right column
       used to stop short and leave a dead gap. Capping the row height and
       letting the list scroll inside itself keeps both columns the same height
       at any session count. -->
  <!-- Explicit two-column layout, NOT auto-fit. The list used to carry
      `grid-column:span 2` against an auto-fit track list, so the column count
      changed with width while the span stayed at 2: at ~900px the charts wrapped
      onto their own row at half width (leaving ~465px dead), and at 640px the
      track list collapsed to `589px 0px` — a zero-width column with the list
      overflowing it. Fixed tracks + a media query remove both failure modes. -->
  <!-- #120/#125: task queue visualization, ABOVE the in-progress grid:
       "what is about to run" is the question you ask before "what is running",
       and the queued lane is the earliest warning that the fleet is saturated.
       Three lanes, each capped to the 10 most recent workers (user request) so
       the panel never grows without bound:
         Queued  — real per-host waiting depth from the Ollama poller (h.queue)
         Running — the live session list below it
         Done    — sessions that actually ended, from the same recent_sessions
                   feed the Analytics page uses; not a synthetic "completed"
                   event invented for this panel.
       A chip TRAVELS between lanes (FLIP-animated DOM move) rather than fading
       out in one and back in in another, so the same task visibly crosses the
       gap. Running -> Done is an exact identity match (same session id, from
       two feeds that agree); Queued -> Running stays the count-based estimate
       documented in renderQueue() because a queue slot carries no id. -->
  <div class="card p-4 mb-3" id="qcard">
   <div class="lbl mb-2.5">Task queue
    <span class="muted normal-case tracking-normal text-[length:var(--fs-xs)] ml-1" id="qsub"></span>
   </div>
   <div id="qlanes" class="qlanes">
    <div class="qlane" data-lane="queued">
     <div class="qlanehdr">Queued<span class="qcount" id="qcount-queued">0</span></div>
     <div class="qitems" id="qitems-queued"></div>
    </div>
    <div class="qlane" data-lane="running">
     <div class="qlanehdr">Running<span class="qcount" id="qcount-running">0</span></div>
     <div class="qitems" id="qitems-running"></div>
    </div>
    <div class="qlane" data-lane="done">
     <div class="qlanehdr">Done<span class="qcount" id="qcount-done">0</span></div>
     <div class="qitems" id="qitems-done"></div>
    </div>
   </div>
  </div>
 <div class="livegrid" id="live-grid">
   <div class="card p-4" style="min-width:0;display:flex;flex-direction:column;max-height:calc(100vh - 230px);max-height:calc(100dvh - 230px)">
    <div class="lbl mb-2.5 shrink-0 livehdr">In progress now <span id="livestamp" class="muted text-[length:var(--fs-xs)] normal-case tracking-normal ml-1">live · every 5s</span><span id="livebw" class="livebw" title="Open sessions only · estimated from token counts, not measured"></span></div>
    <div id="livelist" class="flex flex-col gap-2" style="overflow-y:auto;min-height:0;flex:1;padding-right:4px"></div>
   </div>
   <div class="flex flex-col gap-3" style="max-height:calc(100vh - 230px);max-height:calc(100dvh - 230px);min-width:0">
    <div class="card p-4 flex flex-col" style="flex:1;min-height:0"><div class="lbl mb-2.5 shrink-0">By category</div><div style="flex:1;min-height:0;position:relative"><canvas id="cLiveCat"></canvas></div></div>
    <div class="card p-4 flex flex-col" style="flex:1;min-height:0"><div class="lbl mb-2.5 shrink-0">Tool calls · last hour</div><div style="flex:1;min-height:0;position:relative"><canvas id="cTools"></canvas></div></div>
   </div>
  </div>
  <!-- Ollama fleet: below the live grid because it answers "can the fleet take
       more work", which you ask after seeing what is running, not before. -->
  <div class="card p-4 mt-3" id="olcard" hidden>
   <div class="lbl mb-2.5">Local inference hosts
    <span class="muted normal-case tracking-normal text-[length:var(--fs-xs)] ml-1" id="olsub"></span>
   </div>
   <div id="ollama" class="olgrid"></div>
  </div>
 </div>

 <div class="view" data-view="Flow" hidden>
  <div class="card p-4">
   <div class="lbl mb-2.5">Provider → model → task
    <span class="muted normal-case tracking-normal text-[length:var(--fs-xs)] ml-1" id="flowsub"></span>
    <span class="flowctl" id="flowctl"></span>
   </div>
   <div id="flowwrap"><svg id="flow"></svg><div id="flowtip" class="flowtip"></div></div>
  </div>
 </div>

 <!-- Settings (P7-03, #67). The power model that prices local inference.
      Explains each number, recomputes live, and saves to the SAME config file
      the collectors read via the serve process (POST /api/settings). -->
 <div class="view" data-view="Settings" hidden>
  <div class="card p-4 mb-3" id="setcard">
   <div class="flex items-center gap-2 flex-wrap mb-1">
    <div class="lbl">Electricity &amp; hardware</div>
    <span class="muted text-[length:var(--fs-xs)]" id="setsrc">—</span>
   </div>
   <p class="text-[length:var(--fs-sm)] mb-3" id="setnotbill"><b>Local cost is electricity, not billing.</b>
    Nobody invoices you for a local run; the power is paid to your utility. These
    numbers turn a second of inference into dollars so a local model is never read
    as free, and so it can be set beside an API bill <i>knowing</i> they are
    different kinds of money.</p>
   <div class="setgrid">
    <label class="setf" for="set_kwh">
     <span class="setl">Electricity rate</span>
     <span class="setin"><span class="muted">$</span><input id="set_kwh" data-key="electricity_rate_kwh" type="number" step="any" min="0.0001" max="10" inputmode="decimal"><span class="muted">/ kWh</span></span>
     <span class="seth">What your utility charges. Scales every local cost linearly.</span>
    </label>
    <label class="setf" for="set_gpu">
     <span class="setl">GPU draw under load</span>
     <span class="setin"><input id="set_gpu" data-key="gpu_draw_watts" type="number" step="any" min="1" max="5000" inputmode="numeric"><span class="muted">W</span></span>
     <span class="seth">Sustained draw of the inference box while generating.</span>
    </label>
    <label class="setf" for="set_host">
     <span class="setl">Host overhead</span>
     <span class="setin"><input id="set_host" data-key="host_overhead_watts" type="number" step="any" min="0" max="5000" inputmode="numeric"><span class="muted">W</span></span>
     <span class="seth">CPU, RAM, fans and PSU loss while a job runs.</span>
    </label>
    <div class="setf">
     <span class="setl">Currency</span>
     <span class="setin"><b>USD ($)</b></span>
     <span class="seth">Display only. Every rate on this dashboard is USD; nothing is converted.</span>
    </div>
   </div>
   <div class="setderiv" id="setderiv" aria-live="polite"></div>
   <div class="flex items-center gap-2 flex-wrap mt-3">
    <button id="setsave" class="px-3 py-1 rounded-md border text-[length:var(--fs-sm)] tabon" type="button">Save to config</button>
    <button id="setreset" class="px-3 py-1 rounded-md border text-[length:var(--fs-sm)] taboff" type="button">Defaults</button>
    <span class="text-[length:var(--fs-xs)]" id="setmsg" role="status"></span>
   </div>
  </div>
  <div class="card p-4 mb-3">
   <div class="lbl mb-1">How a local token is priced</div>
   <p class="muted text-[length:var(--fs-xs)] mb-2">Read-only: measured on this hardware and fixed in
    <code>energy.py</code>. Shown so a number you disagree with is visible before it is used.</p>
   <div id="setfacts"></div>
  </div>
  <!-- #126: per-profile colour, adjustable from Settings. The stable hashHue()
       derivation stays the default (so an install that never touches this page
       still gets deterministic, collision-avoiding colours) — this is an
       OVERRIDE stored per-browser in localStorage next to the visibility
       toggles it sits beside conceptually (#121). profileHue() is the one
       function every chip/badge/lane-dot call site reads, so a change here
       reaches all of them without hunting down each usage. -->
  <div class="card p-4 mb-3" id="setcolorcard">
   <div class="flex items-center gap-2 flex-wrap mb-1">
    <div class="lbl">Profile colours</div>
   </div>
   <p class="text-[length:var(--fs-sm)] mb-3">Each profile's tab, badges and live-session dots share one
    colour. Defaults are derived from the name so two profiles never collide; override
    any of them here. Stored in this browser only — it never changes what is collected.</p>
   <div class="setgrid" id="setcolorgrid"></div>
   <div class="flex items-center gap-2 flex-wrap mt-3">
    <button id="setcolorreset" class="px-3 py-1 rounded-md border text-[length:var(--fs-sm)] taboff" type="button">Reset to defaults</button>
    <span class="text-[length:var(--fs-xs)]" id="setcolormsg" role="status"></span>
   </div>
  </div>
 </div>

 <div class="view" data-view="Logs" hidden>
  <div class="card p-4 mb-3">
   <div class="flex items-center gap-2 flex-wrap mb-3">
    <div class="lbl">Log events</div>
    <span class="muted text-[length:var(--fs-xs)]" id="lgscope">—</span>
    <span id="lgcountbadge" hidden></span>
    <span style="margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
     <input id="lgq" type="search" placeholder="Search text, tool, session…"
       style="background:var(--bg);border:1px solid var(--border);border-radius:7px;
              padding:5px 9px;font-size:var(--fs-sm);color:var(--fg);min-width:min(260px,52vw)">
     <button id="lgclear" class="chip" type="button">Clear</button>
    </span>
   </div>
   <!-- Active-filter summary: every applied facet as a removable chip, so the
        current filter state is legible without scanning six rows below. -->
   <div id="lgactive"><span class="lbl muted text-[length:var(--fs-xs)]">Active</span></div>
   <!-- Facet rows. Each chip carries the count over the WHOLE window, not the
        capped slice, so the numbers stay true when events are truncated. -->
   <div class="lgfacets">
    <div class="lgrow"><span class="lglbl">Level</span><span id="lgf-level" class="lgchips"></span></div>
    <div class="lgrow"><span class="lglbl">Role</span><span id="lgf-role" class="lgchips"></span></div>
    <div class="lgrow"><span class="lglbl">Tool</span><span id="lgf-tool" class="lgchips"></span></div>
    <div class="lgrow"><span class="lglbl">Model</span><span id="lgf-model" class="lgchips"></span></div>
    <div class="lgrow"><span class="lglbl">Session</span><span id="lgf-session" class="lgchips"></span></div>
    <div class="lgrow" id="lgrow-kind"><span class="lglbl">Failure</span><span id="lgf-kind" class="lgchips"></span></div>
    <div class="lgrow lgrow-window"><span class="lglbl">Window</span><span class="lgchips">
      <button class="lgchip" data-win="1">1h</button>
      <button class="lgchip" data-win="6">6h</button>
      <button class="lgchip on" data-win="24">24h</button>
      <button class="lgchip" data-win="0">All loaded</button>
    </span></div>
   </div>
  </div>
  <div class="card p-4">
   <div class="flex items-center gap-2 mb-2">
    <span class="muted text-[length:var(--fs-xs)]" id="lgcount">—</span>
    <span class="muted text-[length:var(--fs-xs)]" id="lgcap" hidden></span>
    <button id="lgcsv" class="chip" type="button" style="margin-left:auto">Export CSV</button>
   </div>
   <div id="lglist" style="max-height:clamp(320px,58vh,760px);overflow:auto"></div>
  </div>
 </div>

 <div class="view" data-view="Health">
  <!-- Order follows the question a reader brings here: "is anything failing?"
       (headline strip) -> "which model?" (success rate) -> "what exactly?"
       (failures) -> subagent runs, the narrowest slice, last. The delegated
       panel used to open the page and push the main answer below the fold. -->
  <div id="hsummary" class="hsum mb-3"></div>
  <div class="card p-4 mb-3">
   <div class="lbl mb-2.5 hhdr">Success rate by model
    <span class="muted hsub">most failures first · faded rows have under 5 calls</span>
   </div>
   <div id="healthgrid" class="flex flex-col gap-1.5"></div>
  </div>
  <div class="card p-4 mb-3">
   <div class="lbl mb-2.5 hhdr">Recent failures
    <span class="muted hsub">identical errors grouped</span>
    <button id="tolog" class="chip" style="margin-left:auto;font-size:var(--fs-xs);text-transform:none;letter-spacing:0">Open live logs &rarr;</button>
   </div>
   <!-- Filter chips are built from the data, so a kind only appears when it
        actually occurred; counts make a burst obvious before you read a row. -->
   <div id="failfilters" class="ffwrap mb-2.5"></div>
   <div id="faillist" class="flex flex-col gap-1.5"
     style="max-height:clamp(260px,38vh,520px);overflow-y:auto;padding-right:4px"></div>
   <div id="failcount" class="muted text-[length:var(--fs-xs)] mt-2"></div>
  </div>
  <div class="card p-4" id="delegcard" hidden>
   <div class="lbl mb-2.5">Delegated runs
    <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400"> — outcomes recorded by the runtime</span>
   </div>
   <div id="delegkpi" class="dkpis mb-3"></div>
   <div class="grid-2 gap-4">
    <div>
     <div class="lbl mb-2">Completion rate by model</div>
     <div id="delegmodels" class="flex flex-col gap-1.5"></div>
     <div class="lbl mb-2 mt-3">Why runs ended early</div>
     <div id="delegreasons" class="flex gap-1.5 flex-wrap"></div>
    </div>
    <div>
     <!-- These rates are MEASURED per call by the runtime, unlike the
          text-inferred tool failures shown elsewhere. Saying so is the point. -->
     <div class="lbl mb-2">Tool success inside runs <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">— measured</span></div>
     <div id="delegtools" class="flex flex-col gap-1.5"></div>
     <div class="lbl mb-2 mt-3">Recent runs</div>
     <div id="deleglist" class="flex flex-col gap-1"
       style="max-height:clamp(160px,22vh,300px);overflow-y:auto;padding-right:4px"></div>
    </div>
   </div>
  </div>
 </div>

 <div class="view" data-view="Usage">
  <!-- Row 1: Provider distribution full width -->
  <div class="card p-4 mb-4">
   <div class="lbl mb-2.5">Provider distribution — calls</div>
   <div style="height:clamp(130px,12vw,180px)"><canvas id="cProvDist"></canvas></div>
  </div>
  <!-- Row 2: Calls by model + Token share -->
  <div class="grid-2 mb-4">
   <div class="card p-4"><div class="lbl mb-2.5">Calls by model</div><div style="height:clamp(200px,20vw,300px)"><canvas id="cModels"></canvas></div></div>
   <div class="card p-4"><div class="lbl mb-2.5">Token share</div><div style="height:clamp(200px,20vw,300px)"><canvas id="cShare"></canvas></div></div>
  </div>
  <!-- Row 3: Daily activity + Hourly distribution -->
  <div class="grid-2">
   <div class="card p-4"><div class="lbl mb-2.5">Daily activity</div><div style="height:clamp(200px,20vw,300px)"><canvas id="cDaily"></canvas></div></div>
   <div class="card p-4"><div class="lbl mb-2.5">Hourly distribution</div><div style="height:clamp(200px,20vw,300px)"><canvas id="cHours"></canvas></div></div>
  </div>
  <!-- Row 4: Bandwidth (P8-05, #72). Reads the PERSISTED series
       (bandwidth_daily), never the live day rows, so a recalibrated constant
       cannot quietly redraw history. -->
  <div class="card p-4 mt-4" id="bwpanel">
   <div class="lbl mb-2.5">Bandwidth
    <span class="muted normal-case tracking-normal text-[length:var(--fs-xs)] ml-1" id="bwpsub"></span>
   </div>
   <div id="bwpkpi" class="bwpkpi mb-3"></div>
   <div class="grid-2">
    <div>
     <div class="lbl mb-2">Daily transfer <span class="muted normal-case tracking-normal">— internet up / down, LAN separate</span></div>
     <div style="height:clamp(200px,20vw,280px)"><canvas id="cBwTrend"></canvas></div>
    </div>
    <div>
     <div class="lbl mb-2">Context re-send by model <span class="muted normal-case tracking-normal">— prompt tokens sent per fresh token</span></div>
     <div id="bwresend" class="flex flex-col gap-1"></div>
    </div>
   </div>
   <div class="muted text-[length:var(--fs-xs)] mt-3" id="bwpnote"></div>
  </div>
 </div>

 <div class="view" data-view="Cost" hidden>
  <!-- Row 1: Cost by category + Calls by task -->
  <div class="grid-2 mb-4">
   <div class="card p-4"><div class="lbl mb-2.5">Cost by category</div><div style="height:clamp(200px,20vw,300px)"><canvas id="cTaskCost"></canvas></div></div>
   <div class="card p-4"><div class="lbl mb-2.5">Calls by task</div><div style="height:clamp(200px,20vw,300px)"><canvas id="cTasks"></canvas></div></div>
  </div>
  <!-- Row 2: Cost by model + Provider mix -->
  <div class="grid-2 mb-4">
   <div class="card p-4"><div class="lbl mb-2.5">Cost by model</div><div style="height:clamp(200px,20vw,300px)"><canvas id="cModelCost"></canvas></div></div>
   <div class="card p-4"><div class="lbl mb-2.5">Provider mix</div><div style="height:clamp(200px,20vw,300px)"><canvas id="cProv"></canvas></div></div>
  </div>
  <!-- Row 3: Cost by provider table full width -->
  <div class="card p-4">
   <div class="lbl mb-2.5">Cost by provider</div>
   <div class="overflow-x-auto"><table class="w-full text-[length:var(--fs-sm)]" id="tblProv"></table></div>
  </div>
  <!-- Context re-send (P9-03, #80). One panel for the fact that the bandwidth
       re-send panel (#72, Usage) shows in bytes: here it is in dollars, per
       session, worst first. -->
  <div class="card p-4 mt-4" id="resendpanel">
   <div class="flex items-baseline justify-between flex-wrap gap-2 mb-2">
    <div class="lbl">Context re-sent per session</div>
    <span class="muted text-[length:var(--fs-xs)]" id="resendsub"></span>
   </div>
   <div class="muted text-[length:var(--fs-xs)] mb-2">Every call re-sends the conversation so far. The cached share is billed at the
    cache-read rate; this ranks sessions by what that re-sent context is worth. Sessions under
    <span id="resendmin"></span> calls are left out: a short session has no meaningful average.</div>
   <div class="overflow-x-auto"><table class="w-full text-[length:var(--fs-sm)]" id="resendtbl"></table></div>
  </div>
 </div>

 <div class="view" data-view="Detail" hidden>
  <!-- Activity heatmap lives here rather than as a global band: it is a
       drill-down question ("when was this busy?"), not a headline number, and
       as a band it rendered on every tab including ones it said nothing about. -->
  <div class="card p-4 mb-4" id="heatcard">
   <div class="lbl mb-2.5">Activity <span class="muted normal-case tracking-normal text-[length:var(--fs-xs)] ml-1" id="heatsub"></span></div>
   <div id="heatmap"></div>
  </div>
  <div class="card p-4">
   <div class="lbl mb-2.5">Per-model detail</div>
   <div class="overflow-x-auto"><table class="w-full text-[length:var(--fs-sm)]" id="tbl"></table></div>
  </div>
 </div>

 <div class="text-[length:var(--fs-xs)] muted border-l-2 pl-3" style="border-color:var(--accent)">
  <b>Est. cost</b> is what every request would cost at public API rates, priced per token (input,
  output and cache-read rated separately) from the OpenRouter catalogue (cached __PRICE_TTL__), plus
  official vendor rates for models OpenRouter does not list (Codex/Astra, some Fireworks SKUs).
  Local models are priced from electricity at your tariff and marked <b>elec</b>; they are
  never shown as $0.
  It is a <i>consumption estimate, not an invoice</i>: traffic on Anthropic OAuth, OpenCode Go and
  Codex is covered by flat monthly subscriptions, so the dollars here show the worth of what you
  consumed rather than money leaving your account. Only Fireworks is genuinely pay-per-token.
 </div>
</div><!-- /.page — the drawer must live OUTSIDE it, as a direct child of
     <body>: a position:fixed element is trapped by any ancestor with a
     transform/filter/contain, and .page is exactly the kind of container that
     grows one later. Keeping it at body level makes that impossible. -->
<!-- Router help overlay. Direct body child, like the drawer: any transform or
     `contain` on an ancestor would break the fixed positioning. -->
<div id="helpwrap" role="dialog" aria-modal="true" aria-label="How routing works">
 <div id="helpscrim"></div>
 <div id="helppanel">
  <button id="helpclose" aria-label="Close">&times;</button>
  <div class="hpt">How your work gets routed</div>
  <div class="hpsub" id="helpprof"></div>
  <div id="helpbody"></div>
 </div>
</div>

<div id="scrim"></div>
<div id="drawer" role="dialog" aria-label="Live logs" aria-hidden="true">
 <div id="draghandle"></div>
 <div class="dhead">
  <span class="dot"></span>
  <b style="font-size:var(--fs-md)">Live tail</b>
  <span class="muted" id="dstamp" style="font-size:var(--fs-xs)">live</span>
  <a href="#/logs" id="dfull" class="chip" style="font-size:var(--fs-xs);text-transform:none;letter-spacing:0">All logs &rarr;</a>
  <button id="dclose" class="chip" style="margin-left:auto" title="Close">&times;</button>
 </div>
 <div class="dtabs">
  <button class="dtab on" data-f="all">All</button>
  <button class="dtab" data-f="error">Failures</button>
  <button class="dtab" data-f="tool">Tools</button>
  <span style="margin-left:auto;display:flex;align-items:center;gap:5px">
   <input type="checkbox" id="dauto" checked style="accent-color:var(--accent)">
   <label for="dauto" class="muted" style="font-size:var(--fs-xs);cursor:pointer">follow</label>
  </span>
 </div>
 <div id="dbody"></div>
 <div id="dfoot">
  <span class="muted" id="dcount">—</span>
  <span class="muted">summary · refreshes every 5s</span>
 </div>
</div>

<button id="logbtn" title="Open live logs (L)">
 <span style="color:var(--accent)">&#9776;</span> Logs
 <span class="n" id="logn" hidden>0</span>
</button>
"""

JS = r"""
<script>
let DATA = __DATA__;
// Injected from config.local_host_patterns so provOf() classifies self-hosted
// endpoints correctly on any network, not just the author's LAN.
const LOCAL_HOSTS = __LOCAL_HOSTS__;
// ---- Payload contract (P1-01, #23) ---------------------------------------
// Every payload carries schema_version. A missing or different version means
// the page and the collector disagree about the shape; rendering anyway is how
// "wrong data" used to show up as a silently empty dashboard. Refuse, loudly.
const SCHEMA_VERSION = __SCHEMA_VERSION__;
function schemaProblem(payload, name){
  if (!payload || typeof payload !== 'object') return `${name}: not a JSON object`;
  if (!('schema_version' in payload))
    return `${name} is a stale payload (no schema_version) — re-run \`llm-telemetry dashboard\``;
  if (payload.schema_version !== SCHEMA_VERSION)
    return `${name} has schema_version ${JSON.stringify(payload.schema_version)}, this page expects ${SCHEMA_VERSION} — re-run \`llm-telemetry dashboard\``;
  return '';
}
function showSchemaError(msg){
  let el = document.getElementById('schemaerr');
  if (!el) {
    el = document.createElement('div');
    el.id = 'schemaerr';
    el.setAttribute('role', 'alert');
    el.style.cssText = 'position:fixed;inset:0;z-index:100;display:flex;align-items:center;'
      + 'justify-content:center;background:var(--bg);padding:24px';
    document.body.appendChild(el);
  }
  el.innerHTML = '<div class="card" style="max-width:640px;padding:24px;border-color:#ef4444">'
    + '<div style="color:#ef4444;font-weight:600;font-size:var(--fs-lg);margin-bottom:8px">Payload version mismatch</div>'
    + '<div class="schemamsg" style="font-size:var(--fs-md);line-height:1.5"></div>'
    + '<div class="muted" style="font-size:var(--fs-xs);margin-top:12px">The dashboard refused to render rather than show '
    + 'numbers it cannot interpret.</div></div>';
  el.querySelector('.schemamsg').textContent = msg;
}
{
  const bad = schemaProblem(DATA, 'analytics-data.json');
  if (bad) {
    const go = () => { showSchemaError(bad); const b = document.getElementById('boot'); if (b) b.remove(); };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
    throw new Error('schema mismatch: ' + bad);   // stop this script: nothing below may render
  }
}
// ---- Profile resolution (P5-04, #53) -------------------------------------
// Zero profiles is an actionable state, not a blank page: say which agent
// home was searched and how to point the tool elsewhere.
// flash(): one-line transient notice for guarded actions (#119 uses it when
// the last visible profile is protected from being switched off).
function flash(msg){
  let f = document.getElementById('flash');
  if (!f){
    f = document.createElement('div');
    f.id = 'flash';
    f.setAttribute('role', 'status');
    f.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);'
      + 'z-index:80;padding:8px 14px;border-radius:8px;border:1px solid var(--border);'
      + 'background:var(--card);color:var(--fg);font-size:var(--fs-sm);box-shadow:0 4px 14px rgba(0,0,0,.25);'
      + 'opacity:0;transition:opacity .2s';
    document.body.appendChild(f);
  }
  f.textContent = msg;
  requestAnimationFrame(() => { f.style.opacity = '1'; });
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { f.style.opacity = '0'; }, 2600);
}
{
  const res = DATA.resolution || {};
  if (!DATA.profiles || !Object.keys(DATA.profiles).length) {
    const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
    const why = res.mode === 'explicit-empty'
      ? `The config file${res.config_file ? ` (${esc(res.config_file)})` : ''} sets <code>"profiles": []</code>, which means read no profiles.`
      : `No profile with a state.db was found under <code>${esc(res.agent_home || '~/.hermes')}</code>.`;
    const failed = (res.failed || []).map(f =>
      `<li><b>${esc(f.name)}</b>: ${esc(f.reason)}</li>`).join('');
    const go = () => {
      const el = document.createElement('div');
      el.id = 'noprofiles';
      el.className = 'card';
      el.style.cssText = 'max-width:640px;margin:15vh auto;padding:24px;line-height:1.55';
      el.innerHTML = `<div style="font-size:var(--fs-lg);font-weight:650;margin-bottom:8px">No profiles to show</div>
        <div class="muted" style="font-size:var(--fs-md)">${why}</div>
        ${failed ? `<div style="margin-top:10px;font-size:var(--fs-md)">Unreadable:<ul style="margin:4px 0 0 18px;list-style:disc">${failed}</ul></div>` : ''}
        <div class="muted" style="font-size:var(--fs-sm);margin-top:12px">Point the tool at your agent with
        <code>LLM_TELEMETRY_AGENT_HOME=/path</code> or <code>"agent_home"</code> in the config, then re-run
        <code>llm-telemetry dashboard</code>.</div>`;
      document.body.appendChild(el);
      const b = document.getElementById('boot'); if (b) b.remove();
    };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
    throw new Error('no profiles');   // nothing below can render without one
  }
}
// Header summary: "3 profiles · 1 excluded · 1 unreadable", detail on click.
function renderResolution(){
  const el = $('resinfo'); if (!el) return;
  const res = DATA.resolution || {};
  const n = Object.keys(DATA.profiles).filter(k => k !== 'All').length;
  const ex = res.excluded || [], bad = res.failed || [];
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const bits = [`${n} profile${n === 1 ? '' : 's'}`];
  if (ex.length) bits.push(`${ex.length} excluded`);
  if (bad.length) bits.push(`<span class="resbad">${bad.length} unreadable</span>`);
  el.innerHTML = `<button type="button" id="resbtn" class="resbtn${bad.length ? ' warn' : ''}"
      aria-expanded="false" title="How the profile list was built">${bad.length ? '&#9888; ' : ''}${bits.join(' · ')}</button>
    <div id="respop" class="respop card" hidden>
      <div class="lbl mb-1">Profiles</div>
      <div class="muted text-[length:var(--fs-xs)] mb-2">Agent home <code>${esc(res.agent_home || '—')}</code>${res.mode ? ` · ${esc(res.mode)}` : ''}</div>
      ${(res.discovered || []).length ? `<div class="text-[length:var(--fs-sm)]"><b>Discovered:</b> ${res.discovered.map(esc).join(', ')}</div>` : ''}
      ${(res.configured || []).length ? `<div class="text-[length:var(--fs-sm)]"><b>From config:</b> ${res.configured.map(esc).join(', ')}</div>` : ''}
      ${ex.length ? `<div class="text-[length:var(--fs-sm)]"><b>Excluded:</b> ${ex.map(e => `${esc(e.name)} <span class="muted">(${esc(e.reason)})</span>`).join(', ')}</div>` : ''}
      ${bad.length ? `<div class="text-[length:var(--fs-sm)] resbad mt-1"><b>Unreadable:</b><ul style="margin:2px 0 0 16px;list-style:disc">${bad.map(f => `<li>${esc(f.name)}: ${esc(f.reason)}</li>`).join('')}</ul></div>` : ''}
    </div>`;
  const btn = $('resbtn'), pop = $('respop');
  btn.onclick = e => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); };
  document.addEventListener('click', e => { if (!el.contains(e.target)) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
}
const css = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim() || '#888';
let AC, MU, BD, FG;
function readTheme(){ AC=css('--accent'); MU=css('--muted'); BD=css('--border'); FG=css('--fg');
  Chart.defaults.color=MU; Chart.defaults.borderColor=BD; }
const PAL = ['#6366f1','#22c55e','#f59e0b','#ef4444','#06b6d4','#a855f7','#ec4899','#84cc16','#eab308','#14b8a6'];
// Fade a hex colour to a translucent rgba(), so a filled series can sit under
// another without hiding it.
const fade = (hex, a) => {
  const h = hex.replace('#','');
  const n = parseInt(h.length === 3 ? h.split('').map(c=>c+c).join('') : h, 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
};

// One hue per model family, matching that family's provider badge. Every chart
// colours a model from this map, so "orange" always means Claude, "violet"
// always means an OpenCode model, etc. Shades vary within a family (lightness
// steps) so sibling models stay distinguishable without changing meaning.
// Base hues are spaced so that even a crowded family's fan (up to ~92 degrees)
// does not bleed into its neighbour: claude 17, codex 120, local 196,
// deepseek 262, opencode 320.
const FAMILY = [
  {re:/claude|opus|sonnet|haiku/i,                 key:'claude',   h: 17, s:66},
  {re:/glm|kimi|minimax/i,                         key:'opencode', h:320, s:85},
  {re:/deepseek/i,                                 key:'deepseek', h:262, s:80},
  {re:/qwen|gpt-oss|nemotron|llama|mistral|phi|gemma/i, key:'local', h:196, s:88},
  {re:/gpt-|astra|luna|codex/i,                    key:'codex',    h:120, s:70},
];
// A model outside every known family still deserves its own colour — grouping
// them all under one grey means two unrelated models look identical. Derive a
// stable hue from the name, avoiding the arc already owned by the families
// above (162-250) so an unknown model never impersonates a known one.
const FAM_OTHER = {key:'other', h:215, s:16};
function hashHue(s){
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h*31 + s.charCodeAt(i)) | 0;
  // Usable arc: 260-500(=140) wrapping past red, skipping the family band.
  return (260 + (Math.abs(h) % 240)) % 360;
}
function famOf(model){
  const m = (model||'').toLowerCase();
  const hit = FAMILY.find(f => f.re.test(m));
  if (hit) return hit;
  // One shared "other" family, so unknowns get evenly fanned across the
  // leftover arc by buildColors() instead of landing wherever their hash falls
  // — two hashes can sit 2 degrees apart and look identical.
  return {key:'other', h: 60, s:55};
}
// Deterministic and GLOBAL: the shade for a model is computed from the full
// model list across every profile, not from whatever survives the current
// filter. Otherwise a model's colour would move when the date range or profile
// changes — the same bar would be a different orange on two tabs.
//
// Within a family we spread hue, saturation AND lightness. Lightness alone gave
// eight Claude models ~3.7% steps apart, which is invisible; fanning the hue
// across a band keeps the family readable at a glance while making siblings
// genuinely distinguishable.
const FAM_HUE_SPREAD = 46;   // total degrees a family fans across
function buildColors(models){
  const groups = {};
  models.forEach(m => { const f = famOf(m); (groups[f.key] ||= {f, list:[]}).list.push(m); });
  const out = {};
  Object.values(groups).forEach(({f, list}) => {
    const uniq = [...new Set(list)].sort();
    const n = uniq.length;
    uniq.forEach((m, i) => {
      if (n === 1){ out[m] = `hsl(${f.h} ${f.s}% 55%)`; return; }
      // Wider fan when a family is crowded: 6 siblings need more arc than 2.
      const spread = Math.min(FAM_HUE_SPREAD + (n - 2) * 7, 92);
      const t = i / (n - 1);                    // 0..1 across the family
      const hue = f.h - spread/2 + t*spread;
      // Zig-zag lightness so ADJACENT entries differ sharply instead of
      // drifting; alternate saturation for a further cue.
      const alt = i % 2 ? 1 : 0;
      const light = 40 + t*26 + (alt ? 12 : 0);
      const sat = Math.max(35, Math.min(95, f.s - (alt ? 14 : 0)));
      out[m] = `hsl(${((hue%360)+360)%360|0} ${sat|0}% ${Math.min(78, light)|0}%)`;
    });
  });
  return out;
}

// Every model name Hermes has ever recorded, across all profiles. Computed once
// at load so the palette is a fixed property of the data set, not of the view.
function allModelNames(){
  const out = [];
  Object.values(DATA.profiles || {}).forEach(p => {
    (p.rows || []).forEach(r => out.push(short(r.model)));
    (p.live || []).forEach(L => {
      if (L.model) out.push(short(L.model));
      if (L.init_model) out.push(short(L.init_model));
    });
    // health is an ARRAY of {model,...}; Object.keys() on it would yield the
    // indices "0","1",... and register them as phantom models.
    (p.health || []).forEach(h => h && h.model && out.push(short(h.model)));
    (p.failures_recent || []).forEach(f => f && f.model && out.push(short(f.model)));
  });
  (DATA.errors || []).forEach(e => e && e.model && out.push(short(e.model)));
  return out;
}
let COLORS = {};
// Fall back through famOf(), not to a flat grey: a model that appears only in
// an error log (never in usage rows, so absent from COLORS) still gets its own
// stable, distinguishable colour instead of sharing one grey with every other
// unknown.
const colorOf = m => {
  if (COLORS[m]) return COLORS[m];
  const f = famOf(m);
  return `hsl(${f.h} ${f.s}% 55%)`;
};
const fmt = n => { n=+n||0; for (const [u,d] of [['B',1e9],['M',1e6],['K',1e3]]) if (n>=d) return (n/d).toFixed(1)+u; return String(Math.round(n)); };
// Bytes with binary units. Separate from fmt() on purpose: fmt's 'B' means
// billions, which beside a byte count would read as "bytes" and be off by 1e9.
const fmtB = n => { n=+n||0;
  for (const [u,d] of [['TB',1099511627776],['GB',1073741824],['MB',1048576],['KB',1024]])
    if (n>=d) return (n/d).toFixed(n/d<10?2:1)+' '+u;
  return Math.round(n)+' B'; };
// Per-second rate, from the delta between two polls.
const fmtRate = bps => (bps==null||!isFinite(bps)||bps<=0) ? '' : fmtB(bps)+'/s';
// Previous poll's byte totals, keyed by session id, so a rate can be derived
// without the collector having to persist state between runs.
let bwPrev = {}, bwPrevAt = 0;
const money = v => v ? '$'+(+v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
const short = m => String(m).split('/').pop();
const esc = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const $ = id => document.getElementById(id);

let charts = [], current = null;
let view = localStorage.getItem('hermes-dash-view') || 'Home';
Chart.defaults.font.size = 10; readTheme();
const noLeg = {plugins:{legend:{display:false}}};

const bounds = p => {
  const ds = [...new Set(p.rows.map(r=>r.date).filter(Boolean))].sort();
  return [ds[0]||'', ds[ds.length-1]||''];
};
function setRange(from,to){ $('from').value=from; $('to').value=to; render(); updateRangeToggleLabel(); }

// #13: mobile-only collapsed range chip. Desktop never toggles .rangeopen
// (the toggle button stays display:none outside the mobile media query), so
// this is a no-op cost on every other viewport.
function updateRangeToggleLabel(){
  const rt = $('rangetoggle'); if (!rt) return;
  const from = $('from').value, to = $('to').value;
  rt.textContent = from && to ? (from === to ? from : `${from} → ${to}`) : 'Range';
}
(function initRangeToggle(){
  const rt = $('rangetoggle'), rb = $('rangebar'); if (!rt || !rb) return;
  rt.onclick = () => {
    const open = rb.classList.toggle('rangeopen');
    rt.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
})();

function presets(p){
  const [lo,hi] = bounds(p);
  const days = n => { const d=new Date(hi); d.setDate(d.getDate()-(n-1));
    const s=d.toISOString().slice(0,10); return s<lo?lo:s; };
  const defs = [['24h',()=>[hi,hi]],['7d',()=>[days(7),hi]],['30d',()=>[days(30),hi]],['All',()=>[lo,hi]]];
  $('presets').innerHTML = defs.map(([l],i)=>`<span class="chip" data-p="${i}">${l}</span>`).join('');
  $('presets').querySelectorAll('[data-p]').forEach((el,i)=>
    el.onclick = () => { const [a,b]=defs[i][1](); setRange(a,b); });
  updateRangeToggleLabel();
}

// Shared chart factory: used by render() and renderLive(), so it must live at
// module scope rather than inside render().
// Resolve a chart label back to its colour. Labels carry a provider glyph
// prefix (ic()/PROV.icon), so strip that before looking the name up. Models
// resolve through COLORS, providers through PROV — meaning a label is tinted
// the same as the bar, slice or line it names, in EVERY chart.
function labelColor(raw){
  const s = String(raw).replace(/^\s*\S\s+/, '').trim();   // drop the glyph
  if (COLORS[s]) return COLORS[s];
  if (PROV[s]) return PROV[s].fg;
  // Tools resolve last: a tool name can never collide with a model name, and
  // checking TOOLCOLORS directly (not toolColor()) avoids tinting every
  // unrelated category label with a hash colour.
  if (TOOLCOLORS[s]) return TOOLCOLORS[s];
  return null;
}

// Applied to every chart: bigger, model-coloured category labels and legend
// text. Chart.js has no per-tick colour callback for legends, so the legend
// gets generateLabels() and the axis gets a tick colour function.
const LABEL_FONT = {size:13, weight:'600'};
function tintTicks(axis){
  return {...axis, ticks:{...(axis&&axis.ticks||{}), font:LABEL_FONT,
    color: ctx => labelColor(ctx.tick && ctx.tick.label) || MU}};
}

function mk(id,type,labels,datasets,opts={}){const el=$(id); if(!el)return;
  // Chart.js refuses to bind a second chart to a canvas that still has one
  // ("Canvas is already in use"). charts[] is emptied on every render, but a
  // chart created outside that cycle — the live poll repaints cLiveCat every
  // few seconds — is not in the array and survives, so the next render throws
  // and the whole live feed stalls. Ask Chart.js itself what owns the canvas.
  const prev = (typeof Chart.getChart === 'function') ? Chart.getChart(el) : null;
  if (prev) { try { prev.destroy(); } catch(_){} }
  // Don't skip hidden views — Chart.js handles zero-size canvases fine, and
  // skipping them means Cost/Detail charts never get per-model colors.
  const o = {responsive:true,maintainAspectRatio:false,...opts};

  // Doughnut/pie/radar have no cartesian axes. Injecting `scales` into them
  // materialises a stray "0" axis next to the ring.
  const RADIAL = /^(doughnut|pie|polarArea|radar)$/.test(type);
  if (!RADIAL){
    // Tint the category axis: x for vertical bars/lines, y for horizontal bars.
    const catAxis = (o.indexAxis === 'y') ? 'y' : 'x';
    o.scales = o.scales || {};
    o.scales[catAxis] = tintTicks(o.scales[catAxis] || {});
  }

  // Tint legend entries to match their dataset, and enlarge them.
  const leg = (o.plugins && o.plugins.legend) || {};
  if (leg.display !== false){
    o.plugins = {...(o.plugins||{}), legend:{...leg,
      labels:{...(leg.labels||{}), font:LABEL_FONT,
        generateLabels(chart){
          // Each chart TYPE supplies its own generator: the doughnut/pie one
          // emits a label per slice, while Chart.defaults' generic version
          // emits one per dataset — using the latter on a doughnut yields a
          // single "undefined" entry.
          const t = chart.config.type;
          const src = (Chart.overrides && Chart.overrides[t] && Chart.overrides[t].plugins
                       && Chart.overrides[t].plugins.legend
                       && Chart.overrides[t].plugins.legend.labels
                       && Chart.overrides[t].plugins.legend.labels.generateLabels)
                    || Chart.defaults.plugins.legend.labels.generateLabels;
          const base = src(chart) || [];
          base.forEach(it => {
            const c = labelColor(it.text);
            if (c) it.fontColor = c;
          });
          return base;
        }}}};
  }
  charts.push(new Chart(el,{type,data:{labels,datasets},options:o}));}

function agg(rows, keyFn, valFn){
  const m=new Map(); rows.forEach(r=>{const k=keyFn(r); m.set(k,(m.get(k)||0)+(+valFn(r)||0));});
  return [...m.entries()].sort((a,b)=>b[1]-a[1]);
}

// Badge colours are the same hues as the chart families above, so a provider's
// badge and its models' bars read as one colour system.
const PROV = {
  'anthropic':   {icon:'✳', bg:'hsl(17 66% 55% / .16)',  fg:'hsl(17 66% 55%)'},
  'opencode-go': {icon:'◈', bg:'hsl(250 85% 62% / .16)', fg:'hsl(250 85% 68%)'},
  'fireworks':   {icon:'✦', bg:'rgba(255,102,61,.16)',   fg:'#ff663d'},
  'openai-codex':{icon:'◉', bg:'hsl(162 82% 38% / .16)', fg:'hsl(162 82% 40%)'},
  'local':       {icon:'▣', bg:'hsl(213 90% 60% / .14)', fg:'hsl(213 90% 62%)'},
  'moa':         {icon:'⬡', bg:'rgba(244,114,182,.16)',  fg:'#f472b6'},
  'cloud':       {icon:'☁', bg:'hsl(205 80% 55% / .16)', fg:'hsl(205 80% 58%)'},
  'ollama-cloud':{icon:'☁', bg:'hsl(199 90% 52% / .16)', fg:'hsl(199 90% 55%)'},
  'nous':        {icon:'◆', bg:'rgba(234,179,8,.16)',    fg:'#eab308'}
};
// Provider resolution order, strongest evidence first:
//   1. billing_base_url — the endpoint the call actually hit. Authoritative.
//   2. billing_provider — the config slot name ("custom" just means
//      OpenAI-compatible, so it is only trustworthy once the URL says nothing).
//   3. model-name shape — last resort for old rows with neither recorded.
// Guessing from the model name alone mislabelled Fireworks kimi-k3 as local,
// because it was routed through a custom-named slot.
const LOCAL_RE = /^(qwen|gpt-oss|deepseek-r1|nemotron|llama|mistral|phi|gemma)/i;
// Ollama Cloud tags carry an explicit cloud marker ("kimi-k3:cloud",
// "qwen3-coder:480b-cloud", "gpt-oss:120b-cloud"). The marker is authoritative
// and must be tested BEFORE LOCAL_RE, because those same names match local hints
// and were rendering a LOCAL badge on hosted traffic.
const CLOUD_SUFFIX = /(:|-|\.)cloud$/i;
function provOf(p, model, url){
  const u=(url||'').toLowerCase();
  if(u){
    if(u.includes('fireworks.ai'))      return 'fireworks';
    if(u.includes('opencode.ai'))       return 'opencode-go';
    if(u.includes('api.anthropic.com')) return 'anthropic';
    if(u.includes('openai.com')||u.includes('chatgpt.com')) return 'openai-codex';
    if(u.includes('openrouter.ai'))     return 'openrouter';
    if(u.includes('nousresearch'))      return 'nous';
    // Ollama Cloud (https://ollama.com/v1) is hosted, not LAN: match it before
    // the local patterns so it can never be mistaken for a self-hosted host.
    if(u.includes('ollama.com'))        return 'ollama-cloud';
    // LOCAL_HOSTS is injected from config.local_host_patterns, so self-hosted
    // URLs are recognised on any LAN instead of only the author's.
    if(LOCAL_HOSTS.some(h => u.includes(h))) return 'local';
  }
  const key=(p||'').toLowerCase().trim();
  if(key && key!=='custom') return key;
  const m=(model||'').toLowerCase();
  if(m.includes('fireworks')) return 'fireworks';
  if(CLOUD_SUFFIX.test(m)) return 'ollama-cloud';
  const isSlug = m.includes('/');
  if(!isSlug && LOCAL_RE.test(m)) return 'local';
  if(m.includes('claude')) return 'anthropic';
  if(m.includes('glm')||m.includes('kimi')||m.includes('minimax')) return 'opencode-go';
  // Nous portal model families (Hermes, stepfun/step-*) — old rows recorded
  // neither provider nor base_url, so match the model name as a last resort.
  if(m.startsWith('stepfun/')||m.startsWith('step-')||m.includes('hermes-')) return 'nous';
  if(m.startsWith('gpt-')) return 'openai-codex';
  if(key==='custom') return 'local';
  // Nothing identified it, so it is remote — not local hardware. Defaulting to
  // 'local' here is what put a LOCAL badge on every unrecognised hosted model.
  return 'cloud';
}
function provBadge(p){
  const key=(p||'').toLowerCase().trim();
  const s=PROV[key]||{icon:'○',bg:'rgba(148,163,184,.14)',fg:MU};
  return `<span class="text-[length:var(--fs-xs)] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
    style="background:${s.bg};color:${s.fg};border:1px solid ${s.fg}33">
    <span style="font-size:var(--fs-xs)">${s.icon}</span>${key}</span>`;
}
// Chart-axis labels are plain strings, so a provider is shown as its unicode
// glyph prefixed to the model name: "◆ step-3.7-flash". rowsForModel lets a
// short model name resolve back to the provider that served it.
let MODEL_PROV = {};
function buildModelProv(rows){
  MODEL_PROV = {};
  (rows||[]).forEach(r=>{
    const sm = short(r.model);
    if(!MODEL_PROV[sm]) MODEL_PROV[sm] = provOf(r.provider, r.model, r.base_url);
  });
}
function provIcon(sm){
  const key = MODEL_PROV[sm] || provOf('', sm, '');
  return (PROV[key]||{icon:'○'}).icon;
}
// Prefix a provider glyph to a model label for chart axes/legends.
function ic(sm){ return provIcon(sm) + ' ' + sm; }

// ---- Bandwidth panel (P8-05, #72) ------------------------------------------
// Source: p.bandwidth_daily, the frozen per-day ledger (P8-04). Deliberately
// not p.rows: rows are recomputed with today's bytes_per_token on every build,
// the ledger is not, and this panel is the one that claims to show history.
//
// Re-send factor = prompt tokens sent / fresh prompt tokens
//                = (input + cache_read + cache_write) / (input + cache_write).
// cache_write is fresh text too: Anthropic reports it OUTSIDE input_tokens, so
// the naive cache_read/input form gives 64,000x for claude-opus-5 where the
// honest figure is ~15x. Hand-checked against state.db for #72.
function resendOf(r){
  const fresh = (+r.input_tokens||0) + (+r.cache_write_tokens||0);
  const sent  = fresh + (+r.cache_read_tokens||0);
  return {fresh, sent, x: fresh ? sent / fresh : null};
}
function renderBandwidthPanel(p, inR){
  const card = $('bwpanel'); if (!card) return;
  const all = (p.bandwidth_daily || []);
  const S = all.filter(r => inR(r.date));
  if (!S.length){
    card.hidden = !all.length ? true : false;
    if (!all.length) return;
    $('bwpkpi').innerHTML = '<span class="muted text-[length:var(--fs-sm)]">No bandwidth recorded in this range.</span>';
    $('bwresend').innerHTML = ''; $('bwpsub').textContent = ''; $('bwpnote').textContent = '';
    return;
  }
  card.hidden = false;
  const days = [...new Set(S.map(r => r.date))].sort();
  const sum = (k, rs=S) => rs.reduce((a, r) => a + (+r[k]||0), 0);
  const up = sum('up_bytes'), down = sum('down_bytes');
  const lan = sum('lan_up_bytes') + sum('lan_down_bytes');
  const tot = resendOf({input_tokens:sum('input_tokens'), cache_read_tokens:sum('cache_read_tokens'),
                        cache_write_tokens:sum('cache_write_tokens')});
  const ratio = down ? up / down : null;
  const frozen = S.filter(r => r.frozen).length;
  const bpts = [...new Set(S.map(r => r.bytes_per_token))].sort();

  $('bwpsub').textContent = `${days.length} day${days.length===1?'':'s'} · estimated, not measured`;
  const tile = (v, l, sub) => `<div class="bwpt"><div class="bwpv">${v}</div><div class="bwpl">${l}</div>${sub?`<div class="muted bwps">${sub}</div>`:''}</div>`;
  $('bwpkpi').innerHTML = [
    tile(tot.x == null ? '—' : `${tot.x.toFixed(1)}&times;`, 'context re-send',
         'each fresh prompt token is sent this many times'),
    tile(ratio == null ? '—' : `${Math.round(ratio).toLocaleString()}:1`, 'upload : download',
         'a whole conversation goes up to get a reply back'),
    tile(`&uarr; ${fmtB(up)}`, 'internet upload', `&darr; ${fmtB(down)} download`),
    tile(fmtB(lan), 'LAN', 'local models · not metered'),
  ].join('');

  // Daily trend: internet up/down on the left axis, LAN as its own line so a
  // local-heavy day cannot inflate the metered picture.
  const by = d => S.filter(r => r.date === d);
  // Upload dwarfs download ~190:1, so on one axis download is an invisible
  // sliver. Upload gets the bars and the left axis; download and LAN get lines
  // on their own right axis, so each is legible and none is misread as zero.
  mk('cBwTrend', 'bar', days.map(d => d.slice(5)), [
    {label:'upload', data:days.map(d => sum('up_bytes', by(d))), backgroundColor:'#f59e0b',
     borderRadius:2, yAxisID:'y', order:2},
    {label:'download', type:'line', data:days.map(d => sum('down_bytes', by(d))),
     borderColor:'#38bdf8', backgroundColor:'#38bdf8', pointRadius:3, tension:.3, yAxisID:'y1', order:1},
    {label:'LAN', type:'line', data:days.map(d => sum('lan_up_bytes', by(d)) + sum('lan_down_bytes', by(d))),
     borderColor:MU, backgroundColor:MU, borderDash:[4,3], pointRadius:2, tension:.3, yAxisID:'y1', order:1},
  ], {plugins:{legend:{labels:{boxWidth:8}},
       tooltip:{callbacks:{title:c => days[c[0].dataIndex],
                           label:c => `${c.dataset.label}: ${fmtB(c.parsed.y)}`}}},
      scales:{x:{grid:{display:false}},
              y:{position:'left', grid:{color:BD}, title:{display:true, text:'upload', color:'#f59e0b', font:{size:10}},
                 ticks:{maxTicksLimit:5, callback:v => fmtB(v)}},
              y1:{position:'right', grid:{display:false}, title:{display:true, text:'download · LAN', color:'#38bdf8', font:{size:10}},
                  ticks:{maxTicksLimit:5, callback:v => fmtB(v)}}}});

  // Re-send per model, worst first. Flag anything well above the fleet median:
  // those are the candidates for shorter contexts or earlier compaction.
  const M = {};
  S.forEach(r => {
    const o = M[r.model] || (M[r.model] = {model:r.model, input_tokens:0, cache_read_tokens:0,
                                          cache_write_tokens:0, up:0, calls:0});
    o.input_tokens += +r.input_tokens||0; o.cache_read_tokens += +r.cache_read_tokens||0;
    o.cache_write_tokens += +r.cache_write_tokens||0; o.up += +r.up_bytes||0; o.calls += +r.calls||0;
  });
  const rows = Object.values(M).map(o => ({...o, ...resendOf(o)}))
    .filter(o => o.x != null && o.sent > 0).sort((a, b) => b.x - a.x);
  const xs = rows.map(o => o.x).sort((a, b) => a - b);
  const med = xs.length ? (xs.length % 2 ? xs[(xs.length-1)/2] : (xs[xs.length/2-1] + xs[xs.length/2]) / 2) : 0;
  const max = rows.length ? rows[0].x : 1;
  const TOP = 12;
  $('bwresend').innerHTML = !rows.length
    ? '<div class="muted text-[length:var(--fs-sm)]">No prompt tokens in range.</div>'
    : rows.slice(0, TOP).map(o => {
        const hot = med && o.x >= 2 * med;
        return `<div class="bwrrow${hot ? ' hot' : ''}" data-model="${short(o.model)}" data-x="${o.x.toFixed(2)}"
                  title="${o.sent.toLocaleString()} prompt tokens sent · ${o.fresh.toLocaleString()} fresh · ${o.calls.toLocaleString()} calls">
          <span class="bwrm truncate" style="color:${colorOf(short(o.model))}">${short(o.model)}</span>
          <span class="bwrbar"><i style="width:${Math.max(2, 100 * o.x / max).toFixed(1)}%"></i></span>
          <span class="bwrx">${o.x.toFixed(1)}&times;</span>
          ${hot ? '<span class="bwrflag" title="At least 2x the fleet median">&#9650; high</span>' : '<span class="bwrflag"></span>'}
        </div>`;
      }).join('')
      + `<div class="muted text-[length:var(--fs-xs)] mt-1">fleet median ${med.toFixed(1)}&times;${rows.length > TOP ? ` · top ${TOP} of ${rows.length} models` : ''}</div>`;

  $('bwpnote').textContent =
    `Estimated from token counts × ${bpts.map(b => (+b).toFixed(2)).join(' / ')} bytes/token, ` +
    `not measured on the wire. ${frozen} of ${S.length} rows are frozen history: each keeps the ` +
    `constant it was computed with, so recalibrating never restates past days. ` +
    `Re-send = (input + cache read + cache write) ÷ (input + cache write).`;
}

// Local rows are electricity, not billing (P7-04, #68): a real figure with a
// visible "elec" marker, never "$0" or "free". Cents matter here — a local run
// is often a fraction of a dollar — so small values keep enough digits to be
// non-zero.
// Three states used to render identically as "$0.00" (P9-05, #82):
//   unpriced  -> no rate found, the real cost is unknown and NOT counted
//   local     -> electricity at your tariff, marked "elec" (P7)
//   free tier -> an OpenRouter ":free" SKU, a genuine $0
function costCell(v, local, state){
  v = +v || 0;
  if (state === 'unpriced') return `<span class="unpriced" title="No price found for this model: its traffic is counted at $0, so Est. cost is understated. Fix: add it to WEB_RATES or ALIASES in pricing.py.">unpriced</span>`;
  if (state === 'freetier') return `<span class="freetier" title="OpenRouter :free tier: genuinely $0 per token.">$0 <span class="ftmark">free tier</span></span>`;
  if (!local) return '$' + v.toFixed(2);
  const s = v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v > 0 ? v.toFixed(4) : '0';
  return `<span class="eleccost" title="Electricity at your tariff (electricity_rate_kwh). Not billed by any provider.">~$${s} <span class="elecmark">elec</span></span>`;
}

// ---- Unpriced traffic (P9-05, #82) ------------------------------------------
// Computed from the payload: a model is unpriced when none of its rows found
// a rate and it is neither local (electricity) nor a ":free" tier nor a router
// preset. Its traffic is counted at $0, so Est. cost is understated; the
// banner says so and names the models. Zero unpriced hides it entirely.
function unpricedModels(rows){
  const by = {};
  rows.forEach(r => {
    const k = short(r.model);
    const o = by[k] || (by[k] = {calls: 0, priced: false});
    o.calls += r.calls || 0;
    if (r.priced || r.cost_class === 'local' || r.cost_class === 'free' || r.cost_class === 'preset') o.priced = true;
  });
  return Object.entries(by).filter(([, o]) => !o.priced && o.calls > 0)
    .sort((a, b) => b[1].calls - a[1].calls);
}
function renderUnpriced(rows){
  const el = document.getElementById('unpricedbanner');
  if (!el) return;
  const un = unpricedModels(rows);
  if (!un.length){ el.hidden = true; el.innerHTML = ''; return; }
  const calls = un.reduce((s, [, o]) => s + o.calls, 0);
  el.hidden = false;
  el.innerHTML = `<b>${un.length} model${un.length === 1 ? '' : 's'} with traffic ${un.length === 1 ? 'has' : 'have'} no price</b>`
    + ` (${un.map(([m]) => '<span class="mono">' + esc(m) + '</span>').join(', ')}; ${calls.toLocaleString()} calls).`
    + ` Est. cost excludes that traffic, so it is understated.`
    + ` <a href="costs.html">Price sheet</a> shows the fix.`;
}
// ---- Context re-send per session (P9-03, #80) ------------------------------
// Rows come from the collector (p.resend): calls, average prompt context per
// call, cache-read share, and re-sent cost priced by the same price_row() as
// the Cost view. Filtered by the date range on the session's last activity.
const RESEND_MIN = 10;   // mirrors RESEND_MIN_CALLS in collect_analytics.py
const escA = v => esc(v).replace(/"/g, '&quot;');   // attribute-safe: titles are user text
function renderResend(p, inR){
  const tbl = $('resendtbl'); if (!tbl) return;
  $('resendmin').textContent = RESEND_MIN;
  const day = ts => { const d = new Date(ts * 1000);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
  const rows = (p.resend || []).filter(r => r.calls >= RESEND_MIN && (!r.last || inR(day(r.last))));
  if (!rows.length){
    tbl.innerHTML = '<tr><td class="muted py-2">No session in this range has enough calls to average.</td></tr>';
    $('resendsub').textContent = '';
    return;
  }
  const total = rows.reduce((s, r) => s + (r.resend_usd || 0), 0);
  $('resendsub').textContent = `${rows.length} sessions · $${total.toFixed(2)} of re-sent context`;
  const mx = Math.max(...rows.map(r => r.resend_usd || 0), 0.01);
  const head = `<tr class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">
    <th class="text-left py-1">Session</th><th class="text-left rsx">Model</th>
    <th class="text-right">Calls</th><th class="text-right rsx" title="Average prompt tokens per call: fresh input + cache write + cache read">Avg context</th>
    <th class="text-right" title="Share of prompt tokens served from cache">Cached</th>
    <th class="text-right">Re-sent cost</th><th class="rsx"></th></tr>`;
  tbl.innerHTML = head + rows.slice(0, 15).map(r => {
    const cost = r.cost_class === 'local' ? costCell(r.resend_usd, true) : '$' + (r.resend_usd || 0).toFixed(2);
    const name = esc(r.title || r.id);
    return `<tr class="resendrow" data-sid="${escA(r.id)}" style="border-top:1px solid var(--border)">
      <td class="py-1 pr-2 resendname" title="${escA(r.id)}">${name}</td>
      <td class="pr-2 rsx" style="white-space:nowrap">${esc(short(r.model))}</td>
      <td class="text-right">${r.calls.toLocaleString()}</td>
      <td class="text-right rsx">${fmt(r.ctx_per_call)}</td>
      <td class="text-right">${r.cread_pct.toFixed(1)}%</td>
      <td class="text-right font-semibold">${cost}</td>
      <td class="pl-3 rsx" style="width:18%"><div style="height:4px;border-radius:2px;background:var(--accent);width:${Math.max(2, (r.resend_usd||0) / mx * 100)}%"></div></td>
    </tr>`;
  }).join('');
}

function render(){
  const p = DATA.profiles[current];
  const from = $('from').value, to = $('to').value;
  const inR = d => d && (!from || d>=from) && (!to || d<=to);
  const rows  = p.rows.filter(r=>inR(r.date));
  const hours = p.hours.filter(h=>inR(h.date));
  const sess  = p.sessions.filter(s=>inR(s.date));

  charts.forEach(c=>c.destroy()); charts=[];
  // Profile chip styling (size, hue) is owned entirely by tabs() (#121) — it
  // sets the on/off style inline per-profile. Re-styling [data-tab] here with
  // a flat tabon/taboff class used to stomp that on every render() call,
  // which fires on every tab click via pick() — the chip would flash from its
  // real 16px/hue treatment to a generic 12px on/off pair and back. #126.

  const calls=rows.reduce((s,r)=>s+r.calls,0), tok=rows.reduce((s,r)=>s+r.inp+r.outp,0);
  const cache=rows.reduce((s,r)=>s+r.cread,0);
  const billed=rows.reduce((s,r)=>s+(r.billed_usd||0),0);
  const market=rows.reduce((s,r)=>s+(r.market_value_usd||0),0);
  const elec=rows.reduce((s,r)=>s+(r.cost_class==='local'?(r.energy_usd||0):0),0);
  renderUnpriced(rows);
  const nsess=sess.reduce((s,r)=>s+r.sessions,0);
  const nd=new Set(rows.map(r=>r.date)).size;
  $('meta').textContent=`generated ${DATA.generated.replace('T',' ')} · auto-refresh every 1 min`;
  $('rangeinfo').textContent=`${nd} day${nd===1?'':'s'} · ${rows.length} rows`;
  // `active` is a live count from the DB, deliberately NOT filtered by the date
  // range — "in progress" means right now, whatever window you are looking at.
  const live = DATA.profiles[current].active || 0;
  const liveDot = live
    ? `<span style="color:#22c55e">●</span> ${live}`
    : `<span class="muted">●</span> 0`;
  // Success rate: successes + failures come from p.health (DB successes,
  // errors.log failures). One number over every model in this profile.
  const H = DATA.profiles[current].health || [];
  let okN=0, failN=0;
  H.forEach(h=>{ okN+=(h.ok||0); failN+=(h.fail||0); });
  const totCalls = okN+failN;
  const srate = totCalls ? (okN/totCalls*100) : null;

  // #11: cache hit rate — real data (cache_read vs. total prompt tokens
  // actually sent), a genuinely bounded 0-100% metric, so it earns a ring
  // like success rate.
  const promptIn = rows.reduce((s,r)=>s+r.inp,0);
  const cacheDenom = promptIn + cache;
  const cacheRate = cacheDenom ? (cache/cacheDenom*100) : null;

  // #11: 7-day trend for the unbounded counters, computed from the same
  // rows already loaded for this range (last 7 distinct dates present).
  const kdays=[...new Set(rows.map(r=>r.date))].sort().slice(-7);
  const callsSeries = kdays.map(d=>rows.filter(r=>r.date===d).reduce((s,r)=>s+r.calls,0));
  const tokSeries = kdays.map(d=>rows.filter(r=>r.date===d).reduce((s,r)=>s+r.inp+r.outp,0));

  $('kpis').innerHTML=[
    ['API calls',calls.toLocaleString(),sparkSvg(callsSeries,AC)],
    ['Tokens',fmt(tok),sparkSvg(tokSeries,PAL[1])],
    ['Cache hit rate',null,null,radialRing(cacheRate,{label:'Cache hit rate',warnAt:60,badAt:30})],
    ['Sessions',nsess.toLocaleString()],
    ['Success rate',null,null,radialRing(srate,{label:'Success rate',warnAt:95,badAt:80})],
    ['In progress',liveDot],
    ['Est. cost','<span class="costpulse">$'+market.toFixed(2)+'</span>'+(elec>0?'<div class="kpisub" title="Local models: electricity at your tariff, included in Est. cost">incl. '+costCell(elec,true)+'</div>':'')]]
    .map(([l,v,spark,ring])=>{
      if (ring) return `<div class="card p-2.5 kpi-ring"><div class="kringwrap">${ring}</div>
        <div class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">${l}</div></div>`;
      return `<div class="card p-2.5"><div class="text-[length:var(--fs-lg)] font-semibold${l==='In progress'?' kpi-live':''}">${v}${spark?`<span class="kspwrap">${spark}</span>`:''}</div>
      <div class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">${l}</div></div>`;
    }).join('');

  // Live data is independent of the date filter — render it before the early
  // return, so an empty range never blanks the Live tab.
  renderLive();
  renderHealth();
  renderDeleg();
  renderHome(inR);
  renderXfer(rows);
  renderHeatmap(p.heatmap);
  // Flow graph before the empty-rows early return below, so switching to an
  // empty date range clears the graph instead of leaving a stale one on screen.
  flowControls();
  if (view === 'Flow') renderFlow(rows);

  // Before the empty-range return: a range with no ledger rows must say so,
  // not keep showing the previous range's numbers.
  renderBandwidthPanel(p, inR);
  renderResend(p, inR);

  if(!rows.length){ $('tbl').innerHTML='<tr><td class="muted py-3">No data in this range.</td></tr>'; return; }

  buildModelProv(rows);

  const byM=agg(rows,r=>short(r.model),r=>r.calls).slice(0,10);
  mk('cModels','bar',byM.map(x=>ic(x[0])),[{data:byM.map(x=>x[1]),backgroundColor:byM.map(x=>colorOf(x[0])),borderRadius:3}],
    {indexAxis:'y',...noLeg,scales:{x:{grid:{color:BD}},y:{grid:{display:false}}}});

  const byT=agg(rows,r=>short(r.model),r=>r.inp+r.outp).slice(0,8);
  mk('cShare','doughnut',byT.map(x=>ic(x[0])),[{data:byT.map(x=>x[1]),backgroundColor:byT.map(x=>colorOf(x[0])),borderWidth:0}],
    {plugins:{legend:{position:'right',labels:{boxWidth:8,padding:6}}},cutout:'55%'});

  const days=[...new Set(rows.map(r=>r.date))].sort();
  mk('cDaily','line',days,[
    {label:'calls',data:days.map(d=>rows.filter(r=>r.date===d).reduce((s,r)=>s+r.calls,0)),
     borderColor:AC,backgroundColor:AC+'22',fill:true,tension:.3,yAxisID:'y'},
    {label:'tokens',data:days.map(d=>rows.filter(r=>r.date===d).reduce((s,r)=>s+r.inp+r.outp,0)),
     borderColor:PAL[1],tension:.3,yAxisID:'y1'}],
    {plugins:{legend:{labels:{boxWidth:8}}},scales:{y:{position:'left',grid:{color:BD}},
     y1:{position:'right',grid:{display:false},ticks:{callback:v=>fmt(v)}}}});

  const bt=agg(rows,r=>r.task,r=>r.calls);
  mk('cTasks','bar',bt.map(x=>x[0]),[{data:bt.map(x=>x[1]),backgroundColor:PAL[2],borderRadius:3}],
    {...noLeg,indexAxis:'y',scales:{x:{grid:{color:BD}},y:{grid:{display:false}}}});

  // Cost by model — horizontal so long model names stay readable.
  const mc=agg(rows,r=>short(r.model),r=>r.market_value_usd||0).slice(0,8);
  mk('cModelCost','bar',mc.map(x=>ic(x[0])),[{data:mc.map(x=>+x[1].toFixed(4)),backgroundColor:mc.map(x=>colorOf(x[0])),borderRadius:3}],
    {...noLeg,indexAxis:'y',
     plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>' $'+(+c.raw).toFixed(2)}}},
     scales:{x:{grid:{color:BD},ticks:{callback:v=>'$'+v}},y:{grid:{display:false}}}});

  // Cost per category. `main` dwarfs the rest, so cost uses a log scale while
  // calls stay linear on the right axis — cheap-but-frequent work stays visible.
  const tcost=agg(rows,r=>r.task,r=>r.market_value_usd||0);
  const tcalls=Object.fromEntries(agg(rows,r=>r.task,r=>r.calls));
  const tl=tcost.map(x=>x[0]);
  mk('cTaskCost','bar',tl,[
     // Bars are translucent and explicitly ordered BEHIND the line: Chart.js
     // paints higher `order` first, so without this the opaque bars bury the
     // calls series wherever the two overlap.
     {label:'Est. cost',data:tcost.map(x=>+x[1].toFixed(4)),
      backgroundColor:fade(PAL[1],.42),
      borderColor:fade(PAL[1],.85),borderWidth:1,borderRadius:3,yAxisID:'y',order:2},
     {label:'Calls',type:'line',data:tl.map(t=>tcalls[t]||0),borderColor:PAL[4],backgroundColor:'transparent',
      borderWidth:2.5,pointRadius:3,pointBackgroundColor:PAL[4],
      pointBorderColor:css('--card'),pointBorderWidth:1.5,tension:.3,yAxisID:'y1',order:1}],
    {plugins:{legend:{labels:{boxWidth:8,padding:6}},
      tooltip:{callbacks:{label:c=>c.datasetIndex===0
        ? ' $'+(+c.raw).toFixed(2) : ' '+(+c.raw).toLocaleString()+' calls'}}},
     scales:{x:{grid:{display:false}},
       y:{type:'logarithmic',position:'left',grid:{color:BD},
          ticks:{callback:v=>'$'+(v>=1?v:(+v).toFixed(2))}},
       y1:{position:'right',grid:{display:false},ticks:{callback:v=>fmt(v)}}}});

  const hv=Array.from({length:24},(_,h)=>hours.filter(x=>x.hour===h).reduce((s,x)=>s+x.calls,0));
  mk('cHours','bar',Array.from({length:24},(_,h)=>String(h).padStart(2,'0')),
    [{data:hv,backgroundColor:PAL[4],borderRadius:2}],
    {...noLeg,scales:{x:{grid:{display:false}},y:{grid:{color:BD}}}});
  const bp=agg(rows,r=>provOf(r.provider,r.model,r.base_url),r=>r.calls);
  mk('cProv','doughnut',bp.map(x=>x[0]),[{data:bp.map(x=>x[1]),
      backgroundColor:bp.map(x=>(PROV[x[0]]||{fg:MU}).fg),borderWidth:0}],
    {plugins:{legend:{position:'right',labels:{boxWidth:8,padding:6}}},cutout:'55%'});

  // Provider distribution full-width chart (Usage tab top row)
  const bpd=agg(rows,r=>provOf(r.provider,r.model,r.base_url),r=>r.calls);
  mk('cProvDist','bar',bpd.map(x=>{const s=PROV[x[0]]||{icon:'○'};return s.icon+' '+x[0];}),[{
    data:bpd.map(x=>x[1]),
    backgroundColor:bpd.map(x=>(PROV[x[0]]||{fg:MU}).fg),
    borderRadius:4}],
    {...noLeg,indexAxis:'y',scales:{x:{grid:{color:BD},ticks:{callback:v=>v.toLocaleString()}},y:{grid:{display:false}}}});

  // Provider cost table (Cost tab)
  const ptbl=$('tblProv'); if(ptbl){
    const pCost={};
    rows.forEach(r=>{
      const k=provOf(r.provider,r.model,r.base_url);
      const o=pCost[k]||(pCost[k]={calls:0,tok:0,inp:0,outp:0,mkt:0,up:0,down:0,models:new Set()});
      o.calls+=r.calls;o.tok+=r.inp+r.outp;o.inp+=r.inp;o.outp+=r.outp;
      o.mkt+=(r.market_value_usd||0);o.models.add(short(r.model));
      // LAN and metered bytes are summed together here: this column answers
      // 'how much did this provider move', not 'what did it cost'.
      o.up+=(r.up_bytes||0)+(r.lan_up_bytes||0);
      o.down+=(r.down_bytes||0)+(r.lan_down_bytes||0);
    });
    const pmx=Math.max(...Object.values(pCost).map(v=>v.mkt),0.01);
    ptbl.innerHTML=`<tr class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">
      <th class="text-left py-1.5">Provider</th><th class="text-right">Calls</th>
      <th class="text-right">Tokens</th>
      <th class="text-right" title="Estimated bytes sent to this provider. Derived from tokens, not measured.">&#8593; Up (est)</th>
      <th class="text-right" title="Estimated bytes received from this provider. Derived from tokens, not measured.">&#8595; Down (est)</th>
      <th class="text-right">Est. cost</th>
      <th class="text-right">Models</th><th class="text-left pl-3">Breakdown</th></tr>`+
    Object.entries(pCost).sort((a,b)=>b[1].mkt-a[1].mkt).map(([pr,v])=>{
      const s=PROV[pr]||{icon:'○',fg:MU};
      const barW=Math.max(2,v.mkt/pmx*100);
      return `<tr style="border-top:1px solid ${BD}">
        <td class="py-1.5">${provBadge(pr)}</td>
        <td class="text-right text-[length:var(--fs-xs)]">${v.calls.toLocaleString()}</td>
        <td class="text-right text-[length:var(--fs-xs)]">${fmt(v.tok)}</td>
        <td class="text-right text-[length:var(--fs-xs)] bwup">${fmtB(v.up)}</td>
        <td class="text-right text-[length:var(--fs-xs)] bwdown">${fmtB(v.down)}</td>
        <td class="text-right text-[length:var(--fs-xs)] font-semibold" style="color:${s.fg}">$${v.mkt.toFixed(2)}</td>
        <td class="text-right text-[length:var(--fs-xs)]">${v.models.size}</td>
        <td class="pl-3"><div style="height:5px;border-radius:2px;background:${s.fg};width:${barW}%;opacity:.7"></div></td>
      </tr>`;}).join('');
  }

  const t={};
  rows.forEach(r=>{const k=short(r.model)+'|'+provOf(r.provider,r.model,r.base_url);
    const o=t[k]||(t[k]={calls:0,tok:0,inp:0,outp:0,cache:0,cost:0,mkt:0,elec:0,up:0,down:0,local:false,priced:false,freetier:false,tasks:new Set()});
    o.calls+=r.calls;o.tok+=r.inp+r.outp;o.inp+=r.inp;o.outp+=r.outp;o.cache+=r.cread;o.cost+=(r.billed_usd||0);o.mkt+=(r.market_value_usd||0);o.up+=(r.up_bytes||0)+(r.lan_up_bytes||0);o.down+=(r.down_bytes||0)+(r.lan_down_bytes||0);if(r.cost_class==='local'){o.local=true;o.elec+=(r.energy_usd||0);}if(r.priced||r.cost_class==='local'||r.cost_class==='preset')o.priced=true;if(r.cost_class==='free')o.freetier=true;o.tasks.add(r.task);});
  const mx=Math.max(...Object.values(t).map(r=>r.calls),1);
  $('tbl').innerHTML=`<tr class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">
    <th class="text-left py-1.5">Model</th><th class="text-left">Provider</th>
    <th class="text-right">Calls</th><th class="text-right">In</th><th class="text-right">Out</th>
    <th class="text-right">Cache</th>
    <th class="text-right" title="Estimated bytes uploaded. Tokens x 4.68, not measured. Includes cache reads: prefix caching re-sends the prompt.">&#8593; Up (est)</th>
    <th class="text-right" title="Estimated bytes downloaded. Tokens x 4.68, not measured.">&#8595; Down (est)</th>
    <th class="text-right">Est. cost</th>
    <th class="text-left pl-3">Tasks</th></tr>`+
    Object.entries(t).sort((a,b)=>b[1].calls-a[1].calls).map(([k,v])=>{const [m,pr]=k.split('|');
      return `<tr data-model="${esc(m)}" data-cost="${v.local?'local':'other'}" style="border-top:1px solid ${BD}"><td class="py-1.5"><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${colorOf(m)};margin-right:6px"></span><span class="text-[length:var(--fs-md)] font-semibold" style="color:${colorOf(m)}">${m}</span></td>
        <td>${provBadge(pr)}</td>
        <td class="text-right">${v.calls.toLocaleString()}</td><td class="text-right">${fmt(v.inp)}</td><td class="text-right">${fmt(v.outp)}</td>
        <td class="text-right">${fmt(v.cache)}</td>
        <td class="text-right bwup">${fmtB(v.up)}</td>
        <td class="text-right bwdown">${fmtB(v.down)}</td>
        <td class="text-right">${costCell(v.mkt, v.local, v.freetier ? 'freetier' : (!v.priced && !v.local) ? 'unpriced' : '')}</td>
        <td class="pl-3"><div style="height:4px;border-radius:2px;background:${colorOf(m)};width:${Math.max(3,v.calls/mx*100)}%"></div>
        <span class="text-[length:var(--fs-xs)] muted">${[...v.tasks].join(', ')}</span></td></tr>`;}).join('');
}

function pick(name){
  current=name; const p=DATA.profiles[name]; const [lo,hi]=bounds(p);
  $('from').min=lo; $('from').max=hi; $('to').min=lo; $('to').max=hi;
  if(!$('from').value || $('from').value<lo || $('from').value>hi) $('from').value=lo;
  if(!$('to').value || $('to').value>hi || $('to').value<lo) $('to').value=hi;
  presets(p); render();
}

// Live view: what is running right now, not what the date filter says. The
// category colours are fixed so a glance tells you the shape of the work.
const CAT = {
  'Running':    {c:'#f59e0b', i:'▶'},
  'Coding':     {c:'#22c55e', i:'✎'},
  'Generating': {c:'#6366f1', i:'✦'},
  'Thinking':   {c:'#a855f7', i:'◐'},
  'Researching':{c:'#06b6d4', i:'⌕'},
  'Reading':    {c:'#60a5fa', i:'▤'},
  'Reviewing':  {c:'#ec4899', i:'✓'},
  'Compressing':{c:'#94a3b8', i:'⇲'},
  'Waiting':    {c:'#eab308', i:'⏸'},
  'Working':    {c:'#84cc16', i:'•'},
  'Idle':       {c:'#6b7280', i:'○'}
};
const catOf = n => CAT[n] || {c:'#6b7280', i:'•'};
const ago = s => s<60 ? s+'s' : s<3600 ? Math.round(s/60)+'m' : Math.round(s/3600)+'h';

// One bandwidth line for a live session: estimated bytes up/down, plus a live
// rate when two polls are far enough apart to divide safely. `bwlive` animates
// the arrows only while the session is genuinely transferring, so a stalled row
// does not look busy.
function bwRow(L){
  const up = +L.up_bytes || 0, down = +L.down_bytes || 0;
  const lup = +L.lan_up_bytes || 0, ldown = +L.lan_down_bytes || 0;
  if (!up && !down && !lup && !ldown) return '';
  const prev = bwPrev[L.id];
  const dt = bwPrevAt ? (Date.now() - bwPrevAt) / 1000 : 0;
  // Only trust a rate over a sane interval: a sub-second gap divides by noise,
  // and a long gap (tab was backgrounded) averages away the thing being shown.
  let upR = null, downR = null;
  if (prev && dt >= 2 && dt <= 120) {
    upR = Math.max(0, (up + lup) - prev.up) / dt;
    downR = Math.max(0, (down + ldown) - prev.down) / dt;
  }
  const moving = (upR > 0 || downR > 0);
  // Per-row LAN label removed (#109): it duplicated the metered figure's
  // job and cluttered every row. LAN bytes still count toward the live rate.
  const rate = moving ? `<span class="muted bwrate">${fmtRate(upR + downR)}</span>` : '';
  return `<div class="bw mt-1 text-[length:var(--fs-xs)]${moving ? ' bwlive' : ''}"
      title="Estimated from token counts (${(DATA.bytes_per_token || 4.68)} bytes/token) — not measured">
    <span class="bwleg"><span class="bwarrow bwup">&uarr;</span><span>${fmtB(up)}</span></span>
    <span class="bwleg"><span class="bwarrow bwdown">&darr;</span><span>${fmtB(down)}</span></span>
    ${rate}
  </div>`;
}

// Aggregated bandwidth across every live session in the current profile, both
// directions in one card. Internet and LAN are summed separately: LAN traffic is
// real load but costs nothing on a metered link, so blending them would overstate
// what the connection is carrying.
// Aggregated transfer for the SELECTED RANGE (#86). Distinct from the live
// card above it: that one sums sessions in flight, this sums every row in the
// date filter. The live card answers "what is moving now", this one answers
// "how much have I moved" — the number that was previously impossible to see.
// #114: sticky-after-first-sighting latch for the bandwidth card.
let XF_SEEN = false;
function renderXfer(rows){
  const card = $('xfercard'); if (!card) return;
  const R = rows || [];
  let up = 0, down = 0, lanUp = 0, lanDown = 0;
  R.forEach(r => {
    up += +r.up_bytes || 0;
    down += +r.down_bytes || 0;
    lanUp += +r.lan_up_bytes || 0;
    lanDown += +r.lan_down_bytes || 0;
  });
  // #114 (same class as the host card): a refresh that momentarily carries no
  // byte rows must not blank this card — the numbers from the previous round
  // are still true. Only hide it while nothing has EVER been seen; keep the
  // totals on screen through a transient empty payload.
  if (!(up + down + lanUp + lanDown)){
    if (!XF_SEEN){ card.hidden = true; }
    return;
  }
  XF_SEEN = true;
  card.hidden = false;

  // Ratio is the headline finding: upload dwarfs download because prompts are
  // re-sent in full on every call while completions are small.
  const ratio = down > 0 ? (up / down) : null;
  $('xfertot').innerHTML =
    `<span class="bwleg"><span class="bwarrow bwup">&uarr;</span>
       <span class="text-[length:var(--fs-lg)] font-semibold">${fmtB(up)}</span>
       <span class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">up</span></span>
     <span class="bwleg"><span class="bwarrow bwdown">&darr;</span>
       <span class="text-[length:var(--fs-lg)] font-semibold">${fmtB(down)}</span>
       <span class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">down</span></span>`
    + (ratio ? `<span class="muted text-[length:var(--fs-xs)]">${ratio.toFixed(0)}:1</span>` : '');

  // LAN disclosed separately and never folded into the metered total: bytes to
  // a box on your own network cost nothing, so mixing them would overstate
  // what you actually paid to move.
  const bits = [];
  if (lanUp || lanDown) bits.push(`LAN ${fmtB(lanUp + lanDown)} (not metered)`);
  bits.push(`${R.length} row${R.length === 1 ? '' : 's'}`);
  $('xfernote').textContent = bits.join(' \u00b7 ');
}

// Home cards. Each stat is DERIVED from the loaded payload — a hardcoded
// number on a landing page is a lie with a long shelf life. Cards are anchors
// so middle-click and keyboard both work; the click handler routes in-page.
function renderHome(inR){
  const box = $('homecards'); if (!box) return;
  const p = DATA.profiles[current] || {};
  // inR is render()'s date-range predicate, passed in rather than reached for:
  // it is a local of render(), so calling it from here failed with a
  // ReferenceError and silently left the card grid empty.
  const pass = typeof inR === 'function' ? inR : () => true;
  const rows = (p.rows || []).filter(r => pass(r.date));
  const live = p.live || [];

  const sum = (f) => rows.reduce((a, r) => a + (+f(r) || 0), 0);
  const models = new Set(rows.map(r => short(r.model)));
  const cost = sum(r => r.market_value_usd);
  const calls = sum(r => r.calls);
  const upB = sum(r => (+r.up_bytes || 0) + (+r.lan_up_bytes || 0));
  const downB = sum(r => (+r.down_bytes || 0) + (+r.lan_down_bytes || 0));

  // Health: the payload carries a list of per-day entries, so derive the rate
  // rather than assuming a precomputed field exists.
  const hl = Array.isArray(p.health) ? p.health : [];
  const hOk = hl.reduce((a, h) => a + (+h.ok || 0), 0);
  const hTot = hl.reduce((a, h) => a + (+h.ok || 0) + (+h.fail || 0), 0);
  const okPct = hTot ? (hOk / hTot * 100).toFixed(1) + '%' : '\u2014';
  const fails = (p.failures_recent || []).length;

  const cards = [
    ['Live', '\u25C9', 'Sessions in flight right now',
      live.length ? live.length + (live.length === 1 ? ' session' : ' sessions') : 'idle'],
    ['Flow', '\u21C4', 'Provider \u2192 model \u2192 task routing',
      models.size + (models.size === 1 ? ' model' : ' models')],
    ['Usage', '\u25A4', 'Calls and tokens over time', fmt(calls) + ' calls'],
    ['Cost', '\u0024', 'What the traffic is worth at public rates',
      '$' + cost.toFixed(2)],
    ['Health', '\u2713', 'Success rate and recent failures',
      okPct + (fails ? ' \u00b7 ' + fails + ' recent' : '')],
    ['Detail', '\u2261', 'Per-model table and the activity calendar',
      rows.length + ' rows'],
    ['Settings', '\u2699', 'Electricity tariff and hardware behind local cost',
      '$' + (+POWER.tariff.electricity_rate_kwh) + ' / kWh'],
  ];

  let html = cards.map(([view, ico, desc, stat]) => `
    <a class="card p-4 homecard" href="#/${view.toLowerCase()}" data-gohome="${view}">
      <div class="flex items-center justify-between mb-2">
        <span class="hc-ico" style="color:var(--accent)">${ico}</span>
        <span class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">${view}</span>
      </div>
      <div class="hc-stat">${stat}</div>
      <div class="muted text-[length:var(--fs-xs)] mt-1">${desc}</div>
    </a>`).join('');

  // Bandwidth card: both directions together, because the ratio is the point.
  // Labelled "est." on the card itself — a derived number that looks measured
  // is the failure this project keeps guarding against.
  html += `
    <a class="card p-4 homecard" href="#/usage" data-gohome="Usage">
      <div class="flex items-center justify-between mb-2">
        <span class="hc-ico" style="color:var(--accent)">\u21C5</span>
        <span class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">Bandwidth (est.)</span>
      </div>
      <div class="hc-stat"><span class="bwup">\u2191 ${fmtB(upB)}</span>
        <span class="muted" style="font-weight:400"> / </span>
        <span class="bwdown">\u2193 ${fmtB(downB)}</span></div>
      <div class="muted text-[length:var(--fs-xs)] mt-1">Estimated from tokens, not measured</div>
    </a>`;

  // Rates is a separate page, so it stays a real external link.
  html += `
    <a class="card p-4 homecard" href="costs.html">
      <div class="flex items-center justify-between mb-2">
        <span class="hc-ico" style="color:var(--accent)">\u2696</span>
        <span class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">Rates</span>
      </div>
      <div class="hc-stat">Price sheet</div>
      <div class="muted text-[length:var(--fs-xs)] mt-1">Current per-million-token rates</div>
    </a>`;

  box.innerHTML = html;
  // Route in-page instead of relying on the hash alone, so a card works even
  // before the router has attached.
  box.querySelectorAll('[data-gohome]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      pickView(a.dataset.gohome);
    });
  });
}

// Which models a live session used (#107). The row used to say "4 models used"
// with no names, and that count ignored helper tasks (compression, approval,
// title generation) that also spend tokens. L.models comes from collect_live.
const liveModelsOpen = new Set();   // survives the 5s re-render
function modelsOf(L){ return Array.isArray(L.models) ? L.models : []; }
function modelsBadge(L){
  const ms = modelsOf(L);
  if (ms.length < 2) return (L.nmodels||0) > 1
    ? `<div class="muted text-[length:var(--fs-xs)]">${L.nmodels} models used</div>` : '';
  const main = ms.filter(m => m.main).length;
  const tip = ms.map(m => `${short(m.model)} (${m.tasks.join(', ')})`).join('\n');
  const open = liveModelsOpen.has(L.id);
  return `<button type="button" class="lmbtn muted text-[length:var(--fs-xs)]" data-lm="${esc(L.id)}"
     aria-expanded="${open}" title="${esc(tip)}">${ms.length} models used`
    + (main < ms.length ? ` (${main} main, ${ms.length - main} helper)` : '')
    + ` ${open ? '\u25B4' : '\u25BE'}</button>`;
}
// Which metric the share bar divides up. Tokens is the default because one
// call is not one unit of work: in a real session claude-opus-5 had 1,003 calls
// but 150M tokens, while a helper had 26 calls and 341k. Calls alone would make
// those look comparable.
let lmMetric = 'tokens';
const LM_METRIC = {
  tokens: {label: 'tokens', of: m => (+m.in_tok||0) + (+m.out_tok||0), fmt: v => fmt(v)},
  calls:  {label: 'calls',  of: m => (+m.calls||0),                     fmt: v => fmt(v)},
};

// Proportional share of the session, one segment per model, coloured with the
// same palette as the model name so the bar and the row read as one thing.
function modelsShare(ms, cur){
  const M = LM_METRIC[lmMetric] || LM_METRIC.tokens;
  const vals = ms.map(M.of);
  const tot = vals.reduce((a, b) => a + b, 0);
  if (!tot) return '';
  const segs = ms.map((m, i) => {
    const pct = vals[i] / tot * 100;
    if (pct <= 0) return '';
    const nm = short(m.model);
    // A model with real usage must stay visible even at 0.2%: min-width keeps
    // a sliver on screen rather than silently dropping it from the picture.
    return `<span class="lmseg" style="width:${pct.toFixed(3)}%;background:${colorOf(nm)}"
       title="${esc(nm)} — ${M.fmt(vals[i])} ${M.label} (${pct.toFixed(1)}%)"></span>`;
  }).join('');
  const legend = ms.map((m, i) => {
    const nm = short(m.model), pct = vals[i] / tot * 100;
    return `<span class="lmkey${nm === cur ? ' cur' : ''}">`
      + `<span class="lmdot" style="background:${colorOf(nm)}"></span>${esc(nm)}`
      + `<span class="muted"> ${pct < 0.1 && pct > 0 ? '<0.1' : pct.toFixed(1)}%</span></span>`;
  }).join('');
  return `<div class="lmbar" role="img"
      aria-label="share of ${M.label} per model">${segs}</div>
    <div class="lmlegend">${legend}</div>`;
}

function modelsPanel(L){
  const ms = modelsOf(L);
  if (ms.length < 2 || !liveModelsOpen.has(L.id)) return '';
  const cur = short(L.model);
  const M = LM_METRIC[lmMetric] || LM_METRIC.tokens;
  const vals = ms.map(M.of);
  const max = Math.max(...vals, 1);
  const rows = ms.map((m, i) => {
    const nm = short(m.model);
    // Per-row bar scaled to the BIGGEST model, not to the total: it answers
    // "how does this one compare with the heaviest", which is what the eye is
    // doing when it scans a column of numbers.
    const w = vals[i] / max * 100;
    return `<tr><td><span style="color:${colorOf(nm)}">\u25CF</span> ${esc(nm)}`
      + (nm === cur ? ' <span class="muted">(now)</span>' : '') + `</td>`
      + `<td>${provBadge(provOf('', m.model, m.base_url))}</td>`
      + `<td class="muted">${m.tasks.map(esc).join(', ')}</td>`
      + `<td class="lmcell"><span class="lmrowbar" style="width:${w.toFixed(2)}%;`
      + `background:${colorOf(nm)}"></span></td>`
      + `<td class="num">${fmt(m.calls)}</td>`
      + `<td class="num">${fmt(m.in_tok)} / ${fmt(m.out_tok)}</td>`
      + `<td class="num muted">${m.last ? ago(Math.max(0, Date.now()/1000 - m.last)) + ' ago' : ''}</td></tr>`;
  }).join('');
  const toggle = Object.keys(LM_METRIC).map(k =>
    `<button type="button" class="lmmet${k === lmMetric ? ' on' : ''}" data-lmmet="${k}">`
    + `${LM_METRIC[k].label}</button>`).join('');
  return `<div class="lmpanel" data-lmp="${esc(L.id)}">
    <div class="lmhead"><span class="muted">share of</span>${toggle}</div>
    ${modelsShare(ms, cur)}
    <table>
    <thead><tr><th>Model</th><th>Provider</th><th>Used for</th><th>Share</th><th class="num">Calls</th>
    <th class="num">Tokens in / out</th><th class="num">Last used</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
document.addEventListener('click', e => {
  const mt = e.target.closest && e.target.closest('[data-lmmet]');
  if (mt) { lmMetric = mt.dataset.lmmet; renderLive(); return; }
  const b = e.target.closest && e.target.closest('[data-lm]');
  if (!b) return;
  const id = b.dataset.lm;
  liveModelsOpen.has(id) ? liveModelsOpen.delete(id) : liveModelsOpen.add(id);
  renderLive();
});

// ---- Task queue visualization (#120/#125) ----------------------------------
// Three lanes fed only by data that already exists — no fabricated queue:
//   queued  : per-host queue depth from the Ollama poller (h.queue). This is
//             the real number of requests Hermes has dispatched that the box
//             has not started yet.
//   running : the live session list already powering the grid above.
//   done    : sessions that actually ended, from the same recent_sessions feed
//             the Analytics page uses — not a synthetic "completed" event
//             invented for this panel.
// Each lane is capped to the 10 most recent workers so the panel never grows
// without bound; the count badge always shows the real total, with a "+N
// more" footer when the lane is truncated, so capping the DISPLAY never hides
// the true number from anyone glancing at the header.
//
// A chip's identity is host+slot for queued items (there is no per-request id
// in the payload) and session id for running/done ones. Running and done
// share the SAME dom key (`s:${id}`), so when a session ends the reconciler
// below sees "same key, different lane" and TRAVELS the existing chip element
// into the done lane via a FLIP transform, instead of fading it out in one
// lane and faking a fresh one into the other — the same task visibly crosses
// the gap. Queued->running has no such identity (a queue slot carries no id),
// so that edge stays the count-based estimate from #120: the queue shrank
// while new running chips appeared in the same poll.
const Q_SEEN = new Map();   // dom key -> {lane, chip} so we can detect travel

function fillChip(el, kind, key, label, meta, profileColor){
  el.dataset.key = key;
  el.dataset.lane = kind;
  const h = profileColor == null ? null : profileColor;
  el.innerHTML =
    `<span class="qdotwrap"${h != null ? ` style="background:hsl(${h} 62% 45%)"` : ''}></span>`
    + `<span class="qmodel">${esc(label)}</span>`
    + (meta ? `<span class="qprof">${esc(meta)}</span>` : '');
}

function qChip(kind, key, label, meta, profileColor){
  const el = document.createElement('div');
  el.className = 'qchip';
  fillChip(el, kind, key, label, meta, profileColor);
  return el;
}

// Slide an existing chip from its current screen position to wherever it
// lands after a DOM move, so a lane change reads as travel rather than a
// teleport. FLIP: measure First, move it, measure Last, Invert with a
// transform, then let the CSS transition Play it back to zero.
// In an environment with no real layout (a jsdom test) every rect is 0x0, so
// this degrades to a no-op transform — harmless, and the important thing a
// test CAN verify (the DOM node's identity persisting across lanes) still
// holds regardless of layout.
function flipMove(el, toContainer){
  const first = el.getBoundingClientRect();
  toContainer.appendChild(el);
  const last = el.getBoundingClientRect();
  const dx = first.left - last.left, dy = first.top - last.top;
  if (dx || dy){
    el.classList.add('travel');
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px,${dy}px)`;
    // eslint-disable-next-line no-unused-expressions
    el.offsetHeight; // force reflow so the next line animates FROM here
    el.style.transition = '';
    el.style.transform = '';
  }
  el.classList.add('arrived');
  setTimeout(() => { el.classList.remove('travel'); el.classList.remove('arrived'); }, 320);
}

function renderQueue(){
  const qBox = $('qitems-queued'), rBox = $('qitems-running'), dBox = $('qitems-done');
  if (!qBox || !rBox || !dBox) return;
  const p = DATA.profiles[current] || {};
  const hosts = (DATA.ollama && DATA.ollama.hosts) || [];
  const CAP = 10;

  // --- queued: expand each host's real depth into depth-many chips ---------
  const queuedAll = [];
  hosts.forEach(h => {
    const depth = Math.max(0, (+h.queue || 0));
    for (let i = 0; i < depth; i++) {
      queuedAll.push({ key: `q:${h.label}:${i}`, label: h.label, meta: 'waiting' });
    }
  });
  const queued = queuedAll.slice(0, CAP);

  // --- running: the same live sessions the grid shows, most active first ---
  const seenLive = new Set();
  const liveDedup = (p.live || []).filter(L => {
    if (seenLive.has(L.id)) return false; seenLive.add(L.id); return true;
  });
  const runningAll = liveDedup
    .slice()
    .sort((a, b) => (+a.idle_s || 0) - (+b.idle_s || 0)) // most recently active first
    .map(L => ({
      key: `s:${L.id}`, sid: L.id,
      label: (L.title && L.title !== '(untitled)') ? L.title : (short(L.model) || 'session'),
      meta: short(L.model) || '', hue: profileHue(L.profile || ''),
    }));
  const running = runningAll.slice(0, CAP);

  // --- done: sessions that actually ended, newest first --------------------
  const doneAll = (p.recent_sessions || [])
    .slice()
    .sort((a, b) => (+b.last_ts || 0) - (+a.last_ts || 0))
    .map(s => ({
      key: `s:${s.id}`, sid: s.id,
      label: (s.title && s.title !== '(untitled)') ? s.title : (short(s.last_model || s.model) || 'session'),
      meta: s.dur_s != null ? `${ago(Math.max(0, +s.dur_s))} run` : '',
      hue: null,
    }));
  const done = doneAll.slice(0, CAP);

  // --- reconcile against what is on screen ----------------------------------
  // Promotion (queued -> running) is detected by COUNT, not identity: a queue
  // slot carries no request id (queued items are only "host X has N
  // waiting"), so claiming an exact task-to-task match there would be
  // inventing data. Running -> done DOES have identity (the same session id
  // in both feeds), so that edge travels the real chip instead of guessing.
  const queuedBefore = [...Q_SEEN.values()].filter(v => v.lane === 'queued').length;
  const runningBefore = new Set(
    [...Q_SEEN.entries()].filter(([, v]) => v.lane === 'running').map(([k]) => k));
  let promoteBudget = Math.max(0, queuedBefore - queued.length);

  const next = new Map();
  const want = [
    ...queued.map(q => ({ ...q, lane: 'queued', hue: null })),
    ...running.map(r => ({ ...r, lane: 'running' })),
    ...done.map(d => ({ ...d, lane: 'done' })),
  ];
  const laneBox = { queued: qBox, running: rBox, done: dBox };
  want.forEach(w => {
    const prev = Q_SEEN.get(w.key);
    if (prev && prev.chip.isConnected && prev.lane === w.lane){
      // same chip, same lane: reuse it so CSS does not replay the entry
      // animation on every 5s poll (that would read as a flicker, the very
      // thing #114 fixed elsewhere).
      w.chip = prev.chip;
      const m = w.chip.querySelector('.qmodel');
      if (m && m.textContent !== w.label) m.textContent = w.label;
      const pr = w.chip.querySelector('.qprof');
      if (pr && w.meta && pr.textContent !== w.meta) pr.textContent = w.meta;
    } else if (prev && prev.chip.isConnected && prev.lane !== w.lane){
      // same key, different lane: this task TRAVELED (today only reachable
      // via running -> done, since queued/running/done keys only collide
      // when they share a real session id). Reuse the element and animate
      // its move instead of destroying and recreating it.
      w.chip = prev.chip;
      fillChip(w.chip, w.lane, w.key, w.label, w.meta, w.hue);
      flipMove(w.chip, laneBox[w.lane]);
    } else {
      w.chip = qChip(w.lane, w.key, w.label, w.meta, w.hue);
      // A running chip that was not running last render, while the queue was
      // draining, is the visible signal that a waiting task started.
      const isNewRunning = w.lane === 'running' && !runningBefore.has(w.key);
      if (isNewRunning && promoteBudget > 0){
        promoteBudget--;
        w.chip.classList.add('promoting');
        setTimeout(() => w.chip.classList.remove('promoting'), 400);
      }
    }
    next.set(w.key, w);
  });
  // chips that vanished entirely (not present in ANY lane this render): play
  // the exit animation, then drop them. This is also how a done chip finally
  // leaves once it ages out past the 10-item cap.
  Q_SEEN.forEach((prev, key) => {
    if (next.has(key)) return;
    if (!prev.chip.isConnected) return;
    prev.chip.classList.add('leaving');
    const chip = prev.chip;
    setTimeout(() => chip.remove(), 240);
  });
  Q_SEEN.clear();
  next.forEach((v, k) => Q_SEEN.set(k, v));

  // --- paint: reuse existing nodes where possible so only real changes move
  const paint = (box, items) => {
    items.forEach(it => { if (it.chip.parentNode !== box) box.appendChild(it.chip); });
    [...box.children].forEach(c => {
      if (c.classList.contains('qmore')) { c.remove(); return; }
      if (!items.some(i => i.chip === c) && !c.classList.contains('leaving')) c.remove();
    });
  };
  paint(qBox, want.filter(w => w.lane === 'queued'));
  paint(rBox, want.filter(w => w.lane === 'running'));
  paint(dBox, want.filter(w => w.lane === 'done'));

  // --- overflow footers: the cap limits what's SHOWN, never what's counted --
  const overflow = (box, all, shown) => {
    if (all.length > shown.length){
      const m = document.createElement('div');
      m.className = 'qmore muted';
      m.textContent = `+${all.length - shown.length} more`;
      box.appendChild(m);
    }
  };
  overflow(qBox, queuedAll, queued);
  overflow(rBox, runningAll, running);
  overflow(dBox, doneAll, done);

  // --- empty states: calm, not blank --------------------------------------
  if (!queued.length){
    if (!qBox.querySelector('.qempty')){
      const e = document.createElement('div');
      e.className = 'qempty';
      e.innerHTML = '<span class="qdot"></span>queue clear — nothing waiting';
      qBox.insertBefore(e, qBox.firstChild);
    }
  } else {
    const e = qBox.querySelector('.qempty'); if (e) e.remove();
  }
  if (!running.length){
    if (!rBox.querySelector('.qempty')){
      const e = document.createElement('div');
      e.className = 'qempty muted';
      e.innerHTML = '<span class="muted">idle — nothing running</span>';
      rBox.insertBefore(e, rBox.firstChild);
    }
  } else {
    const e = rBox.querySelector('.qempty'); if (e) e.remove();
  }
  if (!done.length){
    if (!dBox.querySelector('.qempty')){
      const e = document.createElement('div');
      e.className = 'qempty muted';
      e.innerHTML = '<span class="muted">nothing finished yet</span>';
      dBox.insertBefore(e, dBox.firstChild);
    }
  } else {
    const e = dBox.querySelector('.qempty'); if (e) e.remove();
  }

  // --- counts + subtitle ----------------------------------------------------
  // Counts show the REAL total, even when the lane is capped to 10 chips —
  // capping the display must never quietly change what the number means.
  const cq = $('qcount-queued'), cr = $('qcount-running'), cd = $('qcount-done'), sub = $('qsub');
  if (cq) cq.textContent = String(queuedAll.length);
  if (cr) cr.textContent = String(runningAll.length);
  if (cd) cd.textContent = String(doneAll.length);
  if (sub){
    const busy = hosts.filter(h => (+h.queue || 0) > 0).map(h => h.label);
    sub.textContent = busy.length
      ? `backed up on ${busy.join(', ')}`
      : (hosts.length ? `fleet clear · ${hosts.length} host${hosts.length===1?'':'s'}` : '');
  }
}

function renderLive(){
  const p = DATA.profiles[current] || {};
  renderOllama(DATA.ollama);
  renderQueue();
  // Deduplicate live sessions by ID — the All tab can merge the same session from
  // two profiles, and the 5s poll can occasionally return duplicates mid-refresh.
  const seen = new Set();
  const live = (p.live || []).filter(L => { if(seen.has(L.id)) return false; seen.add(L.id); return true; });
  const box = $('livelist');
  if(!box) return;
  if(!live.length){
    box.innerHTML = '<div class="muted text-[length:var(--fs-sm)] py-2">Nothing running right now.</div>';
  } else {
    box.innerHTML = live.map(L=>{
      const c = catOf(L.category);
      const mcol = colorOf(short(L.model));
      const tools = (L.tools||[]).slice(0,5).map(t=>
        `<span class="text-[length:var(--fs-xs)] px-1 py-0.5 rounded" style="background:${BD};color:${MU}">${t}</span>`).join(' ');
      return `<div class="liverow flex items-center gap-2.5 p-2 rounded" style="border:1px solid ${BD}">
        <div style="color:${c.c};font-size:var(--fs-lg);line-height:1.1" title="${esc(L.category)}">${c.i}</div>
        <div class="flex-1 min-w-0 self-center">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-[length:var(--fs-md)] font-semibold truncate" title="${esc(L.title)}">${esc(L.title)}</span>
            <span class="text-[length:var(--fs-xs)] font-medium" style="color:${c.c}">${L.category}</span>
            ${provBadge(provOf('', L.model, L.base_url))}
            ${L.profile ? `<span class="text-[length:var(--fs-xs)] px-1 rounded" style="background:hsl(${profileHue(L.profile)} 62% 30%);color:hsl(${profileHue(L.profile)} 80% 78%);border:1px solid hsl(${profileHue(L.profile)} 55% 42%)">${L.profile}</span>` : ''}
            ${L.kind==='subagent'?'<span class="text-[length:var(--fs-xs)] muted">↳ subagent</span>':''}
          </div>
          <div class="muted text-[length:var(--fs-xs)] truncate">${L.phase||'—'}</div>
          <div class="flex items-center gap-1 mt-1 flex-wrap">${tools}</div>
        </div>
        <div class="metacol shrink-0">
          <div class="text-[length:var(--fs-sm)] muted truncate leading-tight" style="color:${mcol}" title="${short(L.model)}">${short(L.model)}</div>
          ${L.switched ? `<div class="text-[length:var(--fs-xs)] truncate" style="color:#f59e0b" title="router fell back from ${short(L.init_model)}">↯ from ${short(L.init_model)}</div>` : ''}
          ${modelsBadge(L)}
          <div class="muted text-[length:var(--fs-xs)]">${ago(L.idle_s)} ago</div>
        </div>
        <div class="loecol">${loeIcon(L, {id:L.id, label:(L.title&&L.title!=='(untitled)')?L.title:'session load'})}${bwRow(L)}</div>
      </div>${modelsPanel(L)}`;
    }).join('');
  }

  // Open-session bandwidth total on the "In progress now" heading (#109).
  // Only sessions in `live` are summed, so it goes to zero when nothing runs.
  const lbw = $('livebw');
  if (lbw) {
    const tu = live.reduce((a,L)=>a+(+L.up_bytes||0)+(+L.lan_up_bytes||0),0);
    const td = live.reduce((a,L)=>a+(+L.down_bytes||0)+(+L.lan_down_bytes||0),0);
    lbw.innerHTML = (tu||td)
      ? `<span><span class="bwarrow bwup">&uarr;</span> ${fmtB(tu)}</span><span><span class="bwarrow bwdown">&darr;</span> ${fmtB(td)}</span>`
      : '';
  }

  // Snapshot byte totals so the NEXT poll can derive a rate. Done after the
  // rows are rendered, so this render compares against the previous poll.
  bwPrev = {}; live.forEach(L => { bwPrev[L.id] = {
    up:(+L.up_bytes||0)+(+L.lan_up_bytes||0),
    down:(+L.down_bytes||0)+(+L.lan_down_bytes||0)}; });
  bwPrevAt = Date.now();

  const cats = agg(live, L=>L.category, ()=>1);
  mk('cLiveCat','doughnut',cats.map(x=>x[0]),
     [{data:cats.map(x=>x[1]),backgroundColor:cats.map(x=>catOf(x[0]).c),borderWidth:0}],
     {plugins:{legend:{position:'right',labels:{boxWidth:8,padding:5,font:{size:9}}}},cutout:'52%'});

  const tr = (p.tools_recent||[]).slice(0,8);
  // Per-tool colour, not one flat accent: the same tool keeps its colour in the
  // chart, its axis label and the drawer, so it is traceable across the session.
  mk('cTools','bar',tr.map(x=>x.tool),
     [{data:tr.map(x=>x.calls),backgroundColor:tr.map(x=>toolColor(x.tool)),borderRadius:2}],
     {...noLeg,indexAxis:'y',scales:{x:{grid:{color:BD}},y:{grid:{display:false},ticks:{font:{size:9}}}}});


}

// LOE indicator — a speedometer in its own column (#7/#8/#9/#10/#12 rebuild).
// A 270° instrument dial: gradient progress arc (green->amber->red across the
// whole sweep) plus a needle that TRAVELS from its previous angle to the new
// one on every refresh (so a refresh is visibly alive, not a permanent idle
// wobble), a small settled tremor, and a real numeric readout — legible
// without a tooltip, and exposed to assistive tech as a proper meter.
// Inline SVG: no canvas, no library, no layout pass. One fixed 100x100
// viewBox scaled purely by CSS width/height (--gauge-size / .sz-sm|md|lg), so
// every stroke/tick/font scales together instead of going spindly at 132px.
const GAUGE_PREV = new Map();   // stable id -> previous needle angle, for travel

// #11: compact radial ring — the gauge's zone colours and geometry style
// without a needle, for bounded 0-100 metrics living in the tight KPI strip
// (success rate, cache hit rate). Reuses --z-ok/--z-warn/--z-bad so "green
// ring" means the same thing as the full instrument dial (#7/#8) everywhere
// on the page. Deliberately NOT used for every KPI: only genuinely bounded
// percentages get a ring — unbounded counters (calls, tokens, spend) keep a
// plain number plus a 7-day sparkline (sparkSvg below), because a 0-100 ring
// around a number with no ceiling would be a fabricated bound.
function radialRing(pct, opts){
  const o = opts || {};
  const label = o.label || '';
  const warnAt = o.warnAt != null ? o.warnAt : 80;   // #11 rings read HIGH=good
  const badAt  = o.badAt  != null ? o.badAt  : 60;   // (success/cache-hit rate), so bands invert vs. loeIcon's load gauge
  const tier = pct == null ? {c:'var(--muted)', n:'—'}
             : pct >= warnAt ? {c:'var(--z-ok)', n:'Healthy'}
             : pct >= badAt  ? {c:'var(--z-warn)', n:'Watch'}
             :                 {c:'var(--z-bad)', n:'Low'};
  const R = 15.5, CX = 18, CY = 18;
  const CIRC = (2*Math.PI*R).toFixed(2);
  const frac = pct == null ? 0 : Math.max(0, Math.min(1, pct/100));
  const dash = (CIRC*frac).toFixed(2);
  const valueText = pct == null ? '—' : `${Math.round(pct)}%`;
  const ariaText = pct == null ? `${label}: no data` : `${label} ${Math.round(pct)} percent, ${tier.n.toLowerCase()}`;
  return `<span class="kring" role="meter" aria-valuenow="${pct==null?0:Math.round(pct)}"
      aria-valuemin="0" aria-valuemax="100" aria-valuetext="${escA(ariaText)}" aria-label="${escA(label)}"
      title="${escA(ariaText)}">
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <title>${escA(ariaText)}</title>
      <circle cx="${CX}" cy="${CY}" r="${R}" fill="none"
        stroke="color-mix(in srgb,var(--border) 60%,transparent)" stroke-width="4"/>
      <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${tier.c}" stroke-width="4"
        stroke-linecap="round" stroke-dasharray="${CIRC}" stroke-dashoffset="${(CIRC-dash).toFixed(2)}"
        transform="rotate(-90 ${CX} ${CY})"/>
      <text x="${CX}" y="${CY+1}" text-anchor="middle" dominant-baseline="middle"
        fill="${tier.c}" style="font-size:10.5px;font-weight:700;font-variant-numeric:tabular-nums">${valueText}</text>
    </svg></span>`;
}

// #11: 7-day trend sparkline for the unbounded KPI counters (API calls,
// tokens) — these have no ceiling, so a ring would imply a fake bound;
// a trend line answers "is this going up or down" instead.
function sparkSvg(values, color){
  const vals = (values||[]).map(v=>+v||0);
  if (vals.length < 2 || vals.every(v=>v===vals[0])) return '';
  const W = 64, H = 20, PAD = 2;
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max-min) || 1;
  const pts = vals.map((v,i)=>{
    const x = PAD + (i/(vals.length-1))*(W-2*PAD);
    const y = H-PAD - ((v-min)/span)*(H-2*PAD);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = pts[pts.length-1].split(',');
  return `<svg class="kspark" viewBox="0 0 ${W} ${H}" aria-hidden="true" role="img">
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="1.8" fill="${color}"/>
  </svg>`;
}

function loeIcon(L, opts){
  const heavy = new Set(['delegate_task','execute_code','terminal','mcp__browser_exec']);
  const light = new Set(['read_file','search_files','web_search']);
  const tools = L.tools||[];
  let score = tools.filter(t=>heavy.has(t)).length*2 + tools.filter(t=>!heavy.has(t)&&!light.has(t)).length;
  score = Math.min(score, 6);
  const frac = score/6;
  const pct = Math.round(frac*100);
  const o = opts || {};
  const size = o.size || 'md';                 // #10: sm|md|lg preset
  const id = o.id != null ? String(o.id) : (L.id || L.sid || 'x');
  const label = o.label || 'load';
  // #8: zone thresholds — configurable per metric via opts, default matches
  // the original Light/Medium/Heavy split (40%/70%) so existing behaviour is
  // unchanged unless a caller opts into different bands (e.g. olBar's queue).
  const warnAt = o.warnAt != null ? o.warnAt : 40;
  const badAt  = o.badAt  != null ? o.badAt  : 70;
  const tier = pct >= badAt ? {c:'var(--z-bad)', cls:'gdanger', n:'Heavy'}
             : pct >= warnAt ? {c:'var(--z-warn)', cls:'', n:'Medium'}
             :                 {c:'var(--z-ok)', cls:'', n:'Light'};
  // Needle sweeps a 270° arc: -135° (0%) to +135° (100%), leaving a 90° gap
  // at the bottom for the readout — a proper instrument face, not a half-pipe.
  const deg = (-135 + frac*270).toFixed(1);
  const from = GAUGE_PREV.has(id) ? GAUGE_PREV.get(id) : deg;   // #9: travel FROM last angle
  GAUGE_PREV.set(id, deg);
  // Tremor: much smaller now that travel itself carries the "this changed"
  // signal (#9) — the old amplitude read as permanent noise since it never
  // stopped; this settles to a barely-there idle once travel finishes.
  const amp = (0.4 + frac*1.2).toFixed(2);
  const spd = (2.2 - frac*1.1).toFixed(2);
  // Geometry: 100x100 viewBox, centre (50,58), radius 40.
  const CX = 50, CY = 58, R = 40;
  const SWEEP = 270 * Math.PI/180;
  const LEN = (R * SWEEP).toFixed(2);
  const pt = (angDeg, r) => {
    const a = (angDeg - 90) * Math.PI/180;
    return [(CX + r*Math.cos(a)).toFixed(2), (CY + r*Math.sin(a)).toFixed(2)];
  };
  const [x1,y1] = pt(-135, R), [x2,y2] = pt(135, R);
  const arcPath = `M${x1} ${y1} A${R} ${R} 0 1 1 ${x2} ${y2}`;
  // Minor ticks every 10% (10 gaps -> 11 ticks), major ticks (longer, labelled
  // 0/50/100) at the ends and centre (#7).
  const gid = `gg${id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const ticks = Array.from({length:11}, (_,i)=>{
    const a = -135 + i*27;
    const major = (i===0 || i===5 || i===10);
    const [tx1,ty1] = pt(a, major ? R-9 : R-5), [tx2,ty2] = pt(a, R+1);
    return `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}"
      stroke="${BD}" stroke-width="${major?1.8:1}"/>`;
  }).join('');
  const majorLabels = [0,50,100].map((v,i)=>{
    const a = -135 + i*135;
    const [lx,ly] = pt(a, R+11);
    return `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle"
      fill="var(--muted)" style="font-size:7px">${v}</text>`;
  }).join('');
  const valueText = `${pct}%`;
  const ariaText = `${label} ${pct} percent, ${tier.n.toLowerCase()}`;
  return `<span class="loe sz-${size} ${tier.cls}" role="meter"
      aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
      aria-valuetext="${escA(ariaText)}" aria-label="${escA(label)}"
      title="${tier.n} load — ${score}/6 (${pct}%)">
    <svg viewBox="0 0 100 116" aria-hidden="true">
      <title>${escA(ariaText)}</title>
      <defs>
        <linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
          <stop offset="0%" stop-color="var(--z-ok)"/>
          <stop offset="50%" stop-color="var(--z-warn)"/>
          <stop offset="100%" stop-color="var(--z-bad)"/>
        </linearGradient>
      </defs>
      ${ticks}${majorLabels}
      <path d="${arcPath}" fill="none" stroke="color-mix(in srgb,var(--border) 60%,transparent)"
        stroke-width="7" stroke-linecap="round"/>
      <path class="gval" d="${arcPath}" fill="none" stroke="url(#${gid})" stroke-width="7"
        stroke-linecap="round" stroke-dasharray="${LEN}"
        stroke-dashoffset="${(LEN*(1-frac)).toFixed(2)}"/>
      <g class="needle" style="--from:${from}deg;--d:${deg}deg;--amp:${amp}deg;--spd:${spd}s">
        <line x1="${CX}" y1="${CY}" x2="${CX}" y2="${CY-R+10}" stroke="${tier.c}" stroke-width="2.6"
          stroke-linecap="round"/>
      </g>
      <circle cx="${CX}" cy="${CY}" r="5" fill="${tier.c}"/>
      <circle cx="${CX}" cy="${CY}" r="2.2" fill="var(--card)"/>
      <text x="${CX}" y="${CY+26}" text-anchor="middle" fill="${tier.c}"
        style="font-size:19px;font-weight:700;font-variant-numeric:tabular-nums">${valueText}</text>
      <text x="${CX}" y="${CY+40}" text-anchor="middle" fill="${tier.c}"
        style="font-size:10px;font-weight:600">${tier.n}</text>
    </svg></span>`;
}

// Merge delegation payloads across profiles for the synthetic "All" tab.
//
// Rates CANNOT be averaged — a profile with 2 children at 50% and one with 100
// children at 99% do not average to 74.5%. Every rate here is recomputed from
// summed counters, the same way the Python collector derives it per profile.
function mergeDelegations(list){
  const parts = (list || []).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];

  const M = {}, T = {}, reasons = {}, exits = {};
  let children = 0, ok = 0, wasted = 0, cost = 0, recent = [];

  parts.forEach(g => {
    children += g.children || 0;
    ok += g.ok || 0;
    wasted += g.wasted_hours || 0;
    cost += g.cost_usd || 0;
    (g.by_model || []).forEach(m => {
      const o = M[m.model] || (M[m.model] = {model:m.model, n:0, ok:0,
        cost_usd:0, tokens:0, hours:0, wasted_hours:0});
      o.n += m.n; o.ok += m.ok; o.cost_usd += m.cost_usd || 0;
      o.tokens += m.tokens || 0; o.hours += m.hours || 0;
      o.wasted_hours += m.wasted_hours || 0;
    });
    (g.tools || []).forEach(t => {
      const o = T[t.tool] || (T[t.tool] = {tool:t.tool, calls:0, fail:0});
      o.calls += t.calls; o.fail += t.fail;
    });
    Object.entries(g.reasons || {}).forEach(([k,v]) => reasons[k] = (reasons[k]||0) + v);
    Object.entries(g.exits || {}).forEach(([k,v]) => exits[k] = (exits[k]||0) + v);
    recent = recent.concat(g.recent || []);
  });

  const by_model = Object.values(M).map(m => ({
    ...m,
    rate: m.n ? Math.round(1000*m.ok/m.n)/10 : 0,
    cost_usd: Math.round(m.cost_usd*1e4)/1e4,
    hours: Math.round(m.hours*100)/100,
    wasted_hours: Math.round(m.wasted_hours*100)/100,
  })).sort((a,b) => (b.n - a.n) || a.model.localeCompare(b.model));

  const tools = Object.values(T).map(t => ({
    ...t, rate: t.calls ? Math.round(1000*(t.calls-t.fail)/t.calls)/10 : 0,
  })).sort((a,b) => b.calls - a.calls);

  recent.sort((a,b) => (b.at||0) - (a.at||0));

  return {
    children, ok, failed: children - ok,
    rate: children ? Math.round(1000*ok/children)/10 : 0,
    wasted_hours: Math.round(wasted*100)/100,
    cost_usd: Math.round(cost*1e4)/1e4,
    by_model,
    reasons: Object.fromEntries(Object.entries(reasons).sort((a,b) => b[1]-a[1])),
    exits: Object.fromEntries(Object.entries(exits).sort((a,b) => b[1]-a[1])),
    tools,
    tools_measured: parts.every(g => g.tools_measured === true),
    recent: recent.slice(0, 40),
  };
}

// Synthetic "All" profile: every real profile merged, so the first tab answers
// "what is my whole setup doing / costing" without switching back and forth.
// Built client-side from DATA so it always matches what the tabs show.
function buildAll(profiles){
  // Only merge real profiles — skip any already-merged 'All' key to prevent
  // the cost/call totals from doubling every time installAll is re-called.
  const names = Object.keys(profiles).filter(n => n !== 'All');
  if (names.length < 2) return null;
  const rows = [], hours = [], sess = [], live = [], tools = {};
  const H = {}, fails = [];
  let active = 0;
  names.forEach(n => {
    const p = profiles[n];
    // tag each row with its origin so the merged view can still attribute work
    (p.rows||[]).forEach(r => rows.push({...r, profile:n}));
    (p.hours||[]).forEach(h => hours.push(h));
    (p.sessions||[]).forEach(s => sess.push(s));
    (p.live||[]).forEach(L => live.push({...L, profile:n}));
    (p.tools_recent||[]).forEach(t => tools[t.tool] = (tools[t.tool]||0) + t.calls);
    (p.failures_recent||[]).forEach(f => fails.push({...f, profile:n}));
    // merge reliability per model: the same model can run in both profiles
    (p.health||[]).forEach(h => {
      const o = H[h.model] || (H[h.model] = {model:h.model, ok:0, fail:0, total:0,
                                             kinds:{}, last:'', last_kind:'', last_msg:''});
      o.ok += h.ok; o.fail += h.fail; o.total += h.total;
      Object.entries(h.kinds||{}).forEach(([k,v]) => o.kinds[k] = (o.kinds[k]||0) + v);
      if ((h.last||'') > o.last) { o.last = h.last; o.last_kind = h.last_kind; o.last_msg = h.last_msg; }
    });
    active += (p.active||0);
  });
  const health = Object.values(H).map(h => ({
    ...h, rate: h.total ? Math.round(1000*h.ok/h.total)/10 : null
  })).sort((a,b) => (b.fail-a.fail) || (b.total-a.total));
  fails.sort((a,b) => (b.when||'').localeCompare(a.when||''));
  const dates = rows.map(r=>r.date).filter(Boolean).sort();
  const recent_sessions = names.flatMap(n=>(profiles[n].recent_sessions||[]).map(r=>({...r,profile:n})))
    .sort((a,b)=>(b.last_ts||0)-(a.last_ts||0)).slice(0,40);
  // Context re-send (#80): session ids are unique per profile, so the merged
  // list is a concatenation re-ranked by cost, never a sum.
  const resend = names.flatMap(n=>(profiles[n].resend||[]).map(r=>({...r,profile:n})))
    .sort((a,b)=>(b.resend_usd||0)-(a.resend_usd||0)).slice(0,60);
  // Heatmap: sum the per-day call counts across profiles so the merged tab
  // shows total activity per day, not one profile's.
  const HM = {};
  // Merge on (day, provider-identity) so the per-provider split survives the
  // All-profiles view. Collapsing on the day alone would sum both profiles into
  // one number and the cells would lose their provider bands.
  names.forEach(n => (profiles[n].heatmap||[]).forEach(x => {
    const k = `${x.d}\u0000${x.p||''}\u0000${x.url||''}\u0000${x.m||''}`;
    if (!HM[k]) HM[k] = {d:x.d, p:x.p, url:x.url, m:x.m, v:0};
    HM[k].v += (x.v||0);
  }));
  const heatmap = Object.values(HM).sort((a,b)=>a.d.localeCompare(b.d));
  // Merge per-node session lists across profiles, then re-cap: the same model
  // can serve chats in both profiles, and concatenating without re-sorting
  // would show profile order rather than the busiest chats.
  const NS = {};
  names.forEach(n => Object.entries(profiles[n].node_sessions||{}).forEach(([k,v])=>{
    (NS[k] ||= []).push(...v);
  }));
  Object.keys(NS).forEach(k => {
    NS[k].sort((a,b)=>b.calls-a.calls); NS[k] = NS[k].slice(0,5);
  });
  return {rows, hours, sessions:sess, live, active, health, recent_sessions, resend, heatmap,
          node_sessions: NS,
          // Delegation outcomes merge like health does: per-child counters add
          // up across profiles. Omitting this left the DEFAULT tab with an
          // empty panel while each real profile had data — the panel looked
          // broken rather than empty.
          delegations: mergeDelegations(names.map(n => profiles[n].delegations)),
          // Ledger rows concatenate: each is already keyed by provider/model/day,
          // and the panel aggregates. Summing them into new rows would lose the
          // per-row bytes_per_token the panel reports.
          bandwidth_daily: names.flatMap(n => profiles[n].bandwidth_daily || []),
          // Match the per-profile cap: 14 would silently re-collapse the
          // failure list that the Health panel now pages through.
          failures_recent: fails.slice(0,60),
          tools_recent: Object.entries(tools).map(([tool,calls])=>({tool,calls}))
                              .sort((a,b)=>b.calls-a.calls),
          min_date: dates[0]||null, max_date: dates[dates.length-1]||null};
}

// Failure kinds get their own colour so the matrix reads at a glance: a wall
// of amber is a throttle, red is auth/config and needs you.
// SINGLE SOURCE OF TRUTH for failure-kind colour. This object drives the health
// bar segments, the health chips, the failure-filter chips AND the drawer's
// .k-* chips — the drawer used to carry its own hand-written CSS palette, so
// the same failure kind rendered one colour in the Health tab and a different
// one in the drawer (unavailable was grey here, purple there).
//
// 'unavailable' must NOT be a near-neutral grey: it is drawn on the empty-bar
// track (--border #232b39), so a model that failed 100% of its calls looked
// like a model with no data at all. It is now a distinct violet.
const FKIND = {
  rate_limit:  {c:'#f59e0b', t:'throttled'},
  overloaded:  {c:'#fb923c', t:'overloaded'},
  timeout:     {c:'#60a5fa', t:'timeout'},
  auth:        {c:'#ef4444', t:'auth'},
  server_error:{c:'#a855f7', t:'5xx'},
  // Slate-blue, NOT grey: grey sat on top of the empty-track colour and made a
  // fully-unavailable model look like a model with no data at all. Also kept
  // clear of server_error's purple.
  unavailable: {c:'#64b5c9', t:'unavailable'},
  tool:        {c:'#818cf8', t:'tool'}
};

// Emit the .k-* chip rules from FKIND so the drawer cannot drift from the
// Health tab again. Runs once at boot, before the first drawer render.
function installKindCSS(){
  const st = document.createElement('style');
  st.textContent = Object.entries(FKIND).map(([k, v]) =>
    `.k-${k}{background:${v.c}2e;color:${v.c}}`).join('\n');
  document.head.appendChild(st);
}
// Called HERE, not at the top of the script: FKIND is a const, so calling this
// before its declaration would throw a temporal-dead-zone ReferenceError and
// kill the whole page script.
installKindCSS();
const fk = k => FKIND[k] || {c:MU, t:k||'—'};
// Track colour for a row where EVERY call failed. The segments already paint
// the bar, but 'unavailable' grey sat so close to the empty-track grey that a
// 100%-failure row was indistinguishable from a row with no data. A red wash
// behind it makes total failure read as failure at a glance.
const FAILTRACK = 'rgba(239,68,68,.22)';
// Green above 95%, amber 80-95, red below: matches how you would triage it.
const rateColor = r => r===null ? MU : r>=95 ? '#22c55e' : r>=80 ? '#f59e0b' : '#ef4444';

// Delegation outcomes (#90). Two sources of truth live side by side here and
// must never merge: the per-child rates are MEASURED by the runtime, while the
// tool failure rates elsewhere in this dashboard are inferred from message
// text. The panel says "measured" out loud for that reason.
function renderDeleg(){
  const card = $('delegcard');
  if (!card) return;
  const p = DATA.profiles[current] || {};
  const g = p.delegations || null;
  if (!g || !g.children){ card.hidden = true; return; }
  card.hidden = false;

  // Headline: the three numbers that change a decision — how many children
  // ran, what share came back clean, and how much wall-clock the rest burned.
  const bad = g.children - g.ok;
  $('delegkpi').innerHTML = `
    <div class="dkpi"><span class="dkpi-n">${g.children}</span><span class="lbl">children</span></div>
    <div class="dkpi"><span class="dkpi-n ${g.rate >= 95 ? 'ok' : 'bad'}">${g.rate}%</span><span class="lbl">completed</span></div>
    <div class="dkpi"><span class="dkpi-n ${bad ? 'bad' : ''}">${g.wasted_hours}h</span><span class="lbl">burned on failures</span></div>
    <div class="dkpi"><span class="dkpi-n">${money(g.cost_usd)}</span><span class="lbl">child spend</span></div>`;

  // Per model: this is the routing decision. A model that finishes 56% of the
  // work it is handed is not cheaper than one that finishes 100%, whatever its
  // per-token price says.
  const rows = (g.by_model || []).map(m => {
    const w = Math.max(0, Math.min(100, m.rate));
    return `<div class="drow">
      <div class="dname" title="${esc(m.model)}">${esc(short(m.model))}</div>
      <div class="dbar"><span style="width:${w}%" class="${m.rate >= 95 ? 'ok' : 'bad'}"></span></div>
      <div class="dpct ${m.rate >= 95 ? 'ok' : 'bad'}">${m.rate}%</div>
      <div class="dmeta muted">${m.n} run${m.n === 1 ? '' : 's'}${m.wasted_hours ? ` · ${m.wasted_hours}h lost` : ''}</div>
    </div>`;
  }).join('');
  $('delegmodels').innerHTML = rows || '<div class="muted text-[length:var(--fs-xs)]">No child runs.</div>';

  // Why they failed. Counts only — the reasons come from the runtime's own
  // failure_reason field, so no guessing about what "rate_limit" means.
  const rs = Object.entries(g.reasons || {});
  $('delegreasons').innerHTML = rs.length
    ? rs.map(([k, v]) => `<span class="chip" style="text-transform:none">${esc(k)} <b>${v}</b></span>`).join('')
    : '<span class="muted text-[length:var(--fs-xs)]">No failures in range.</span>';

  // Measured tool outcomes from inside delegated runs.
  const tl = (g.tools || []).slice(0, 8);
  $('delegtools').innerHTML = tl.length
    ? tl.map(t => `<div class="drow">
        <div class="dname">${esc(t.tool)}</div>
        <div class="dbar"><span style="width:${Math.max(0, Math.min(100, t.rate))}%" class="${t.rate >= 95 ? 'ok' : 'bad'}"></span></div>
        <div class="dpct ${t.rate >= 95 ? 'ok' : 'bad'}">${t.rate}%</div>
        <div class="dmeta muted">${t.calls} call${t.calls === 1 ? '' : 's'}${t.fail ? ` · ${t.fail} failed` : ''}</div>
      </div>`).join('')
    : '<div class="muted text-[length:var(--fs-xs)]">No tool calls recorded.</div>';

  // Recent runs, newest first. Goal text is set with textContent by esc() —
  // it is model-authored and must never be interpolated as markup.
  const rec = (g.recent || []).slice(0, 12);
  $('deleglist').innerHTML = rec.map(r => {
    const okc = r.status === 'completed';
    const why = r.failure_reason || r.exit_reason || r.status;
    return `<div class="ditem">
      <span class="ddot ${okc ? 'ok' : 'bad'}"></span>
      <div class="dgoal" title="${esc(r.goal || '')}">${esc(r.goal || '(no goal recorded)')}</div>
      <div class="muted text-[length:var(--fs-xs)]">${esc(short(r.model || ''))} · ${ago(r.seconds)}${okc ? '' : ' · ' + esc(why)}</div>
    </div>`;
  }).join('') || '<div class="muted text-[length:var(--fs-xs)]">Nothing yet.</div>';
}

function renderHealth(){
  const p = DATA.profiles[current] || {};
  const H = (p.health||[]).filter(h => h.total > 0);
  renderHealthSummary(H, p.failures_recent || []);
  const box = $('healthgrid');
  if(!box) return;
  if(!H.length){ box.innerHTML='<div class="muted text-[length:var(--fs-sm)]">No calls recorded.</div>'; }
  else {
    box.innerHTML = H.slice(0,14).map(h=>{
      const r = h.rate;
      const col = rateColor(r);
      // A 0% on one call and a 0% on a thousand are different claims; fade
      // the thin ones so they do not read as outages.
      const thin = h.total < 5;
      // stacked bar: green success, then one segment per failure kind
      const segs = Object.entries(h.kinds||{}).map(([k,v])=>
        `<div title="${fk(k).t}: ${v}" style="width:${(v/h.total*100).toFixed(2)}%;background:${fk(k).c}"></div>`).join('');
      const okPct = (h.ok/h.total*100).toFixed(2);
      const chips = Object.entries(h.kinds||{}).sort((a,b)=>b[1]-a[1]).slice(0,3)
        .map(([k,v])=>`<span class="text-[length:var(--fs-xs)] px-1 rounded" style="background:${fk(k).c}22;color:${fk(k).c}">${fk(k).t} ${v}</span>`).join(' ');
      // "236 ok / 27" read as "236 out of 27". Say what each number is.
      const count = h.fail
        ? `${h.ok.toLocaleString()} of ${h.total.toLocaleString()} · <span style="color:${col}">${h.fail.toLocaleString()} failed</span>`
        : `${h.ok.toLocaleString()} of ${h.total.toLocaleString()}`;
      return `<div class="flex items-center gap-2.5 hrow${thin?' hthin':''}" title="${thin?'Fewer than 5 calls — too few to judge':''}">
        <div class="hname text-[length:var(--fs-md)] font-semibold truncate" style="width:172px;color:${colorOf(short(h.model))}" title="${short(h.model)}">${short(h.model)}</div>
        <div class="hbar flex-1 flex h-[9px] rounded overflow-hidden" style="background:${h.fail===h.total ? FAILTRACK : BD}">
          <div style="width:${okPct}%;background:#22c55e"></div>${segs}
        </div>
        <div class="hrate text-[length:var(--fs-xs)] font-semibold text-right" style="width:52px;color:${col}">${r===null?'—':r+'%'}</div>
        <div class="hcount text-[length:var(--fs-xs)] muted text-right" style="width:150px">${count}</div>
        <div class="hchips flex gap-1 shrink-0 flex-wrap" style="width:170px">${chips}</div>
      </div>`;
    }).join('');
  }

  // Recent failures: individual events, filterable by kind and by model. The
  // filter state lives outside renderHealth so a data refresh does not reset
  // the view the user is currently reading.
  renderFailures(p.failures_recent || []);
}

// Headline strip: the three numbers that answer "is anything wrong" before
// any chart is read. Computed from the same rows the grid shows.
function renderHealthSummary(H, F){
  const el = $('hsummary'); if (!el) return;
  const tot = H.reduce((a,h)=>a+h.total,0), ok = H.reduce((a,h)=>a+h.ok,0);
  const rate = tot ? +(ok/tot*100).toFixed(1) : null;
  const failing = H.filter(h => h.fail > 0);
  // "Worst" needs enough calls to mean something; otherwise one 0/1 wins.
  const judged = failing.filter(h => h.total >= 5).sort((a,b)=>(a.rate??101)-(b.rate??101));
  const worst = judged[0];
  const card = (v, l, col, sub) => `<div class="card hsumc"><div class="hsumv" style="${col?`color:${col}`:''}">${v}</div>
    <div class="hsuml">${l}</div>${sub?`<div class="muted hsums">${sub}</div>`:''}</div>`;
  el.innerHTML =
    card(rate===null?'—':rate+'%', 'Overall success', rate===null?'':rateColor(rate), `${ok.toLocaleString()} of ${tot.toLocaleString()} calls`) +
    card(F.length.toLocaleString(), 'Failures · last 7 days', F.length?'#ef4444':'#22c55e', F.length?`${groupFailures(F).length} distinct errors`:'none recorded') +
    card(`${failing.length} <span class="muted" style="font-size:var(--fs-md)">of ${H.length}</span>`, 'Models with failures', '', '') +
    card(worst ? short(worst.model) : '—', 'Least reliable (≥5 calls)', worst ? colorOf(short(worst.model)) : '',
      worst ? `${worst.rate}% · ${worst.fail.toLocaleString()} failed` : 'nothing below 100%');
}

// Same model + kind + message (with run-specific ids stripped) is one
// problem, not N. Raw rows repeated the same 524 seven times.
function failMsgClean(m){
  m = String(m||'');
  // Cloudflare error pages arrive as a JSON blob; the title is the message.
  const t = m.match(/"title"\s*:\s*"([^"]+)"/);
  const code = m.match(/^HTTP (\d{3})/);
  if (t) return (code ? `HTTP ${code[1]} · ` : '') + t[1];
  return m.replace(/\bthread=\S+/g, '')
          .replace(/\bprompt-turn-[\w:.-]+/g, '')
          .replace(/\s{2,}/g, ' ').trim();
}
function groupFailures(F){
  const g = new Map();
  F.forEach(f => {
    const msg = failMsgClean(f.msg);
    const key = short(f.model) + '|' + f.kind + '|' + msg;
    const e = g.get(key);
    if (e) { e.n++; if ((f.when||'') > e.last) e.last = f.when||''; if ((f.when||'') < e.first) e.first = f.when||''; }
    else g.set(key, {model:f.model, kind:f.kind, msg, raw:f.msg||'', n:1, first:f.when||'', last:f.when||''});
  });
  return [...g.values()].sort((a,b)=> b.last.localeCompare(a.last));
}

let failKind = 'all', failModel = 'all';

function renderFailures(F){
  const fl = $('faillist'), ff = $('failfilters'), fc = $('failcount');
  if (!fl) return;

  // A filter for a kind that never happened is noise — build from the data.
  const kinds = {}, models = {};
  F.forEach(f => {
    kinds[f.kind] = (kinds[f.kind] || 0) + 1;
    models[short(f.model)] = (models[short(f.model)] || 0) + 1;
  });
  // Drop a stale selection when that kind/model vanished from the payload.
  if (failKind !== 'all' && !kinds[failKind]) failKind = 'all';
  if (failModel !== 'all' && !models[failModel]) failModel = 'all';

  if (ff){
    const kc = Object.entries(kinds).sort((a,b)=>b[1]-a[1]);
    const mc = Object.entries(models).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const chip = (act, val, label, col, n) =>
      `<button class="fchip${act?' on':''}" data-${val}="${label}"
        style="${act&&col?`border-color:${col};color:${col}`:''}">${label}${
        n!==undefined?` <span class="muted">${n}</span>`:''}</button>`;
    // Two labelled rows: kind and model were one run-on line of chips with
    // only a hairline between them.
    ff.innerHTML =
      `<div class="ffrow"><span class="fflbl">Kind</span>` +
        chip(failKind==='all','fk','all',AC,F.length) +
        kc.map(([k,n])=>chip(failKind===k,'fk',k,fk(k).c,n)).join('') + `</div>` +
      (mc.length > 1
        ? `<div class="ffrow"><span class="fflbl">Model</span>` +
          chip(failModel==='all','fm','all models') +
          mc.map(([m,n])=>chip(failModel===m,'fm',m,colorOf(m),n)).join('') + `</div>`
        : '');
    ff.querySelectorAll('[data-fk]').forEach(b => b.onclick = () => {
      failKind = b.dataset.fk; renderFailures(F);
    });
    ff.querySelectorAll('[data-fm]').forEach(b => b.onclick = () => {
      failModel = b.dataset.fm === 'all models' ? 'all' : b.dataset.fm;
      renderFailures(F);
    });
  }

  const rows = F.filter(f =>
    (failKind === 'all' || f.kind === failKind) &&
    (failModel === 'all' || short(f.model) === failModel));
  const groups = groupFailures(rows);
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');

  fl.innerHTML = !groups.length
    ? `<div class="muted text-[length:var(--fs-sm)]">${F.length
        ? 'No failures match this filter.'
        : 'No failures recorded in the last 7 days.'}</div>`
    : groups.map(g=>`<div class="flex items-start gap-2 text-[length:var(--fs-xs)] py-0.5 frow" data-n="${g.n}">
        <span class="text-[length:var(--fs-xs)] px-1 rounded shrink-0 fkind" style="background:${fk(g.kind).c}22;color:${fk(g.kind).c}">${fk(g.kind).t}</span>
        <span class="shrink-0 text-[length:var(--fs-md)] font-semibold truncate fmodel" style="color:${colorOf(short(g.model))}" title="${short(g.model)}">${short(g.model)}</span>
        <span class="muted shrink-0 text-[length:var(--fs-xs)] fwhen">${g.n > 1 && g.first.slice(5,16) !== g.last.slice(5,16) ? `${g.first.slice(5,16)} → ${g.last.slice(11,16)}` : g.last.slice(5,16)}</span>
        <span class="truncate text-[length:var(--fs-xs)] fmsg" title="${esc(g.raw)}">${esc(g.msg)}</span>
        <span class="fcnt shrink-0"${g.n > 1 ? ` title="${g.n} identical failures">&times;${g.n}` : ' style="visibility:hidden">'}</span>
      </div>`).join('');

  if (fc) fc.textContent = rows.length === F.length
    ? `${F.length} failures in ${groups.length} groups · last 7 days`
    : `${rows.length} of ${F.length} failures (${groups.length} groups)`;
}

// ---- Ollama fleet panel -------------------------------------------------
// Three load signals per host, because no single number answers "is this box
// in trouble":
//   queue     — requests waiting. The only true saturation signal.
//   vram      — how full the GPU is. Explains WHY a queue is forming.
//   residency — share of the loaded model actually on GPU. A model at 46%
//               residency is half on CPU and will be ~10x slower; VRAM can
//               look fine while throughput quietly collapses, so this is the
//               signal that catches the failure the other two miss.
function olBar(pct, lbl, val, invert){
  const p = Math.max(0, Math.min(100, pct||0));
  // invert: for residency HIGH is good; for queue/vram/cpu/gpu HIGH is bad.
  // Load thresholds are tighter than the old 70/90 — a GPU at 85% is already
  // the thing slowing you down, so it must read amber, not green.
  const sev = invert ? (p >= 90 ? 'good' : p >= 60 ? 'warn' : 'bad')
                     : (p >= 85 ? 'bad'  : p >= 60 ? 'warn' : 'good');
  return `<div class="olrow"><span class="ollbl">${lbl}</span>` +
         `<span class="olbar"><i class="olfill ${sev}${invert?' inv':''}" style="width:${p}%"></i></span>` +
         `<span class="olval ${sev}">${val}</span></div>`;
}
const GB = n => (n/1e9).toFixed(1) + 'G';

// #114: the section is STICKY once discovery has shown it. A refresh that
// momentarily carries no ollama payload (the export timer and the poll are
// not in lockstep) used to hide the card, then the next poll brought it back —
// which read as the whole panel blinking in and out. Once seen, it stays:
// an empty refresh keeps the last known hosts instead of blanking the card.
let OL_SEEN = false;
function renderOllama(ol){
  const wrap = $('ollama'), card = $('olcard'), sub = $('olsub');
  if (!wrap || !card) return;
  const hosts = (ol && ol.hosts) || [];
  if (!hosts.length){
    // No data this round. Before the first sighting, stay hidden (nothing to
    // show). After it, keep the existing card and content: a transient gap in
    // the payload is not news, and blanking it is the blink this fixes.
    if (!OL_SEEN){ card.hidden = true; }
    return;
  }
  OL_SEEN = true;
  card.hidden = false;

  wrap.innerHTML = hosts.map(h => {
    const urls = (h.urls||[]).map(u => u.base);
    // Several URLs can front ONE box; say so explicitly rather than listing
    // them as separate hosts and overstating the fleet.
    const alias = urls.length > 1
      ? `<div class="olurls">${urls.length} endpoints → this box: ${urls.join(' · ')}</div>` : '';
    if (!h.up){
      return `<div class="olcard down"><div class="olhead">` +
        `<i class="oldot down"></i><span class="olname">${h.label}</span>` +
        `<span class="olbadge">local</span>` +
        `<span class="olver">unreachable</span></div>` +
        `<div class="olidle">${h.err ? String(h.err).slice(0,90) : 'no response'}</div></div>`;
    }
    const loaded = h.loaded || [];
    const vramUsed = loaded.reduce((a,m) => a + (m.vram||0), 0);
    // No VRAM total is exposed by Ollama, so scale against what is loaded and
    // fall back to the largest loaded model rather than inventing a capacity.
    const vramPct = h.vram_total ? (vramUsed / h.vram_total) * 100 : (loaded.length ? 100 : 0);
    const q = h.queue || 0;
    // Queue depth is real now (in-flight requests Hermes dispatched to this
    // host). Scale: 1 request is mild, 4+ saturates the bar.
    const L = h.load || null;
    // CPU/GPU only exist for the box we run on; a remote Ollama exposes no
    // telemetry, so its bars are omitted rather than shown as a fake zero.
    const loadBars = L ? (
      (L.cpu != null ? olBar(L.cpu, 'cpu', L.cpu.toFixed(0) + '%') : '') +
      (L.gpu != null ? olBar(L.gpu, 'gpu', L.gpu.toFixed(0) + '%') : '') +
      (L.gpu_mem != null ? olBar(L.gpu_mem, 'gpu mem', L.gpu_mem.toFixed(0) + '%') : '')
    ) : '';
    const gpuNames = L && L.gpus && L.gpus.length
      ? `<div class="olgpus">${L.gpus.map(g =>
          `<span class="olgpu" title="${g.name}">GPU${g.i} ${g.util.toFixed(0)}% · ${(g.used/1024).toFixed(1)}/${(g.total/1024).toFixed(1)}G · ${g.temp.toFixed(0)}&deg;C</span>`
        ).join('')}</div>`
      : '';
    const models = loaded.length ? loaded.map(m => {
      const caps = (m.caps||[]).filter(c => c !== 'completion')
        .map(c => `<span class="olcap ${c}">${c}</span>`).join('');
      const res = m.res == null ? '' : olBar(m.res, 'on GPU', m.res + '%', true);
      return `<div class="olmod"><span class="olmn" style="color:${colorOf(m.name)}">${m.name}</span>${caps}</div>` +
             `<div class="olrow"><span class="ollbl">ctx</span>` +
             `<span class="olval" style="width:auto">${(m.ctx||0).toLocaleString()} tok · ${GB(m.vram||0)} vram</span></div>` +
             res;
    }).join('') : '<div class="olidle">idle — no model resident</div>';

    const w = h.work || {};
    const tasks = Object.entries(w.tasks||{}).sort((a,b)=>b[1]-a[1])
      .map(([k,n]) => `${k} <b>${n}</b>`).join(' · ');

    return `<div class="olcard"><div class="olhead">` +
      `<i class="oldot up"></i><span class="olname">${h.label}</span>` +
      `<span class="olbadge">▣ local</span>` +
      `<span class="olver">v${h.version||'?'} · ${h.ms}ms · ${h.installed} models</span></div>` +
      alias +
      olBar(q ? Math.min(100, q*25) : 0, 'queue', q ? `${q} waiting` : 'clear') +
      olBar(vramPct, 'vram', GB(vramUsed)) +
      loadBars + gpuNames +
      models +
      `<div class="olwork"><span>24h: <b>${(w.calls||0).toLocaleString()}</b> calls</span>` +
      `<span><b>${((w.tokens||0)/1e6).toFixed(1)}M</b> tok</span>` +
      (tasks ? `<span>${tasks}</span>` : '') + `</div></div>`;
  }).join('');

  const up = hosts.filter(h => h.up).length;
  const stale = ol.age != null && ol.age > 90;
  if (sub) sub.innerHTML =
    `${up}/${hosts.length} up · ${hosts.reduce((a,h)=>a+(h.loaded||[]).length,0)} models resident` +
    (stale ? ` · <span class="olstale">stale ${Math.round(ol.age/60)}m</span>` : '');
}

// ---- Flow graph: provider -> model -> task ---------------------------------
// A force-directed tree of where work actually goes. Three ring levels:
//   root (all calls) -> provider -> model -> task
//
// Implemented directly rather than with d3-force: the graph is ~100 nodes, and
// the whole simulation below is smaller than the d3 bundle it would replace.
// Colours are NOT new: providers use PROV[], models use colorOf() — the same
// palette as every other widget, so a model is one colour dashboard-wide.
let FLOWSIM = null;      // running animation handle, so tab switches can stop it
let FLOWROWS = null;     // last rows rendered, so a resize can re-render without refetching
let flowDepth = 3;       // 2 = provider>model, 3 = provider>model>task

function flowData(rows){
  // Aggregate rows into a tree. Calls are the size metric; cost rides along for
  // the tooltip because "who is expensive" is the other question this answers.
  const root = {id:'root', name:'all traffic', kind:'root', calls:0, cost:0, kids:[]};
  const pmap = new Map();
  rows.forEach(r => {
    const pk = provOf(r.provider, r.model, r.base_url);
    const mk = short(r.model);
    const cost = r.market_value_usd || 0;
    root.calls += r.calls; root.cost += cost;

    let P = pmap.get(pk);
    if (!P){ P = {id:'p:'+pk, name:pk, kind:'prov', calls:0, cost:0, kids:[], _m:new Map()};
             pmap.set(pk, P); root.kids.push(P); }
    P.calls += r.calls; P.cost += cost;

    let M = P._m.get(mk);
    if (!M){ M = {id:'p:'+pk+'|m:'+mk, name:mk, kind:'model', calls:0, cost:0, kids:[], _t:new Map()};
             P._m.set(mk, M); P.kids.push(M); }
    M.calls += r.calls; M.cost += cost;

    if (flowDepth >= 3){
      const tk = r.task || 'main';
      let T = M._t.get(tk);
      if (!T){ T = {id:M.id+'|t:'+tk, name:tk, kind:'task', calls:0, cost:0, kids:[]};
               M._t.set(tk, T); M.kids.push(T); }
      T.calls += r.calls; T.cost += cost;
    }
  });
  // Biggest first: stable ordering keeps the layout from reshuffling on refresh.
  const sort = n => { n.kids.sort((a,b)=>b.calls-a.calls); n.kids.forEach(sort); };
  sort(root);
  return root;
}

function flowFlatten(root){
  const nodes = [], links = [];
  (function walk(n, depth, parent){
    n.depth = depth; nodes.push(n);
    if (parent) links.push({s:parent, t:n});
    (n.kids||[]).forEach(k => walk(k, depth+1, n));
  })(root, 0, null);
  return {nodes, links};
}

// Which chats a Flow node served.
//
// node_sessions is keyed by the FULL model id + task ("accounts/fireworks/
// models/kimi-k3\tmain"), but graph nodes carry the SHORT display name, so a
// direct lookup silently returns nothing. Each model node therefore remembers
// its full ids (several can collapse to one short name) and we union them.
// ---- Tool palette ---------------------------------------------------------
// Same contract as the model palette: ONE colour per tool, everywhere, stable
// across tabs/ranges/profiles. Tools group into families by what they do, so
// related tools read as related (all file ops are green-ish, all execution is
// amber-ish) while staying individually distinguishable.
const TOOL_FAM = [
  {re:/^(read_file|write_file|patch|search_files|glob)$/,        h:150, s:58},
  {re:/^(terminal|execute_code|process_manage)$/,                h: 34, s:78},
  {re:/^(web_search|web_extract|browser)/,                       h:200, s:70},
  {re:/^(skill_view|skills_list|skill_manage|context_notes)$/,   h:280, s:62},
  {re:/^(delegate_task|todo_list|clarify)$/,                     h:330, s:64},
  {re:/^(vision_analyze|text_to_speech)$/,                       h: 96, s:55},
  // Meta/infra tools: without a family these fell through to hashHue() and two
  // of them landed 3.7 dE apart — indistinguishable.
  {re:/^(tool_search|tool_describe|tool_call)$/,                 h:250, s:60},
  {re:/^(cronjob_manage|computer_use|desktop_preview|chat_history_lookup)$/, h: 15, s:50},
];
function toolFam(t){
  const hit = TOOL_FAM.find(f => f.re.test(t||''));
  return hit || {h: hashHue(t||''), s:52};
}
let TOOLCOLORS = {};
// Built ONCE from every tool seen anywhere (live feed + drawer logs across both
// profiles), never per-render: building from a filtered subset is exactly the
// bug that made models shift shade between tabs.
// Known tools, so a tool's colour depends on its FAMILY SLOT, not on how many
// siblings happen to be present. Without this, discovering a new tool mid-
// session reshuffles every other tool in its family — the same instability the
// model palette had when it was built from filtered rows.
const TOOL_ROSTER = [
  'read_file','write_file','patch','search_files','glob',
  'terminal','execute_code','process_manage',
  'web_search','web_extract','browser_exec',
  'skill_view','skills_list','skill_manage','context_notes','memory',
  'delegate_task','todo_list','clarify',
  'vision_analyze','text_to_speech',
  // Deferred/loadable tools also appear in logs; listing them keeps their
  // family membership fixed instead of hash-scattered.
  'tool_search','tool_describe','tool_call',
  'cronjob_manage','computer_use','desktop_preview','chat_history_lookup',
];
function allToolNames(){
  const out = new Set();
  Object.values(DATA.profiles||{}).forEach(p => {
    (p.tools_recent||[]).forEach(t => t && t.tool && out.add(t.tool));
    (p.logs||[]).forEach(l => l && l.tool && out.add(l.tool));
  });
  (DATA.errors||[]).forEach(e => e && e.tool && out.add(e.tool));
  TOOL_ROSTER.forEach(t => out.add(t));
  return [...out];
}
function buildToolColors(list){
  const byFam = {};
  // Sort the INPUT first: allToolNames() returns Set-insertion order, which
  // shifts as the live feed changes. Sorting makes a tool's shade depend only
  // on its family membership, not on when it happened to be discovered.
  [...new Set(list)].sort().forEach(t => { const f = toolFam(t); (byFam[f.h] ||= []).push(t); });
  const out = {};
  Object.values(byFam).forEach(members => {
    members.sort();
    const n = members.length, f = toolFam(members[0]);
    members.forEach((t, i) => {
      if (n === 1){ out[t] = `hsl(${f.h} ${f.s}% 58%)`; return; }
      // Fan hue AND lightness within the family, alternating so neighbours in
      // the sorted list never land on adjacent shades.
      const spread = Math.min(26 + (n - 2) * 5, 54);
      const tt = i / (n - 1);
      // Wrap into 0-360: a family centred near 15 fans below zero and emits
      // hsl(-3 ...). Browsers cope, but it breaks any tooling that parses it.
      const hue = (((f.h - spread/2 + tt*spread) % 360) + 360) % 360;
      const li = 46 + (i % 2 ? 16 : 0) + (tt * 10);
      out[t] = `hsl(${hue.toFixed(1)} ${(f.s - (i%3)*7)}% ${li.toFixed(1)}%)`;
    });
  });
  return out;
}
const toolColor = t => TOOLCOLORS[t] || `hsl(${hashHue(t||'')} 52% 58%)`;

function flowSessions(n){
  const ns = (DATA.profiles[current]||{}).node_sessions || {};
  const keys = [];
  if (n.kind === 'task'){
    (n.fullModels||[]).forEach(fm => keys.push(fm + '\t' + n.name));
  } else if (n.kind === 'model'){
    (n.fullModels||[]).forEach(fm => (n.kids||[]).forEach(t => keys.push(fm + '\t' + t.name)));
  } else return [];
  const by = {};
  keys.forEach(k => (ns[k]||[]).forEach(s => {
    const e = (by[s.id] ||= {title:s.title, calls:0, id:s.id});
    e.calls += s.calls;
  }));
  return Object.values(by).sort((a,b)=>b.calls-a.calls).slice(0,4);
}

function flowColor(n){
  if (n.kind === 'root')  return css('--accent');
  if (n.kind === 'prov')  return (PROV[n.name]||{}).fg || css('--accent');
  if (n.kind === 'model') return colorOf(n.name);
  // Tasks inherit their model's hue so a branch reads as one family.
  return colorOf(n.parentModel || n.name);
}

function renderFlow(rows){
  const svg = $('flow'), wrap = $('flowwrap'), sub = $('flowsub');
  if (!svg || !wrap) return;
  if (FLOWSIM){ cancelAnimationFrame(FLOWSIM); FLOWSIM = null; }

  if (!rows || !rows.length){
    svg.innerHTML = '';
    if (sub) sub.textContent = 'no data in this range';
    return;
  }

  const root = flowData(rows);
  // Tag tasks with their model name before flattening, for colour inheritance.
  root.kids.forEach(P => (P.kids||[]).forEach(M =>
    (M.kids||[]).forEach(T => T.parentModel = M.name)));

  const {nodes, links} = flowFlatten(root);
  // The wrapper measures 0 while the tab is still hidden (display:none), which
  // would collapse the whole layout into a dot. Fall back to the card's width
  // and a sane height, then re-render once the tab is actually visible.
  const W = wrap.clientWidth || svg.parentElement?.clientWidth || 1100;
  const H = wrap.clientHeight || 560;
  const cx = W/2, cy = H/2;

  // Radius encodes calls (sqrt so area is proportional, not radius).
  const maxCalls = Math.max(...nodes.map(n=>n.calls), 1);
  const R = n => n.kind==='root' ? 26
    : Math.max(4, Math.sqrt(n.calls/maxCalls) * (n.kind==='prov'?30:n.kind==='model'?22:14));

  // Seed positions on concentric rings by depth, spread by index. Starting from
  // a sane layout means the simulation only has to relax, not untangle.
  const byDepth = {};
  nodes.forEach(n => (byDepth[n.depth] ||= []).push(n));
  // Ring radii scale with the canvas: fixed pixel rings left ~80% of a
  // 1495x707 card empty, because the springs pulled everything to the middle.
  const SPAN = Math.min(W, H) / 2 - 40;
  const RING = {0:0, 1:SPAN*0.34, 2:SPAN*0.66, 3:SPAN*0.95};
  Object.entries(byDepth).forEach(([d, list]) => {
    list.forEach((n, i) => {
      const a = (i/list.length) * Math.PI*2 + (+d)*0.6;
      n.x = cx + Math.cos(a)*RING[d]; n.y = cy + Math.sin(a)*RING[d];
      n.vx = n.vy = 0;
    });
  });
  root.x = cx; root.y = cy;

  // --- force simulation (velocity Verlet, fixed step count) ---
  const LINK_LEN = d => d===1 ? SPAN*0.34 : d===2 ? SPAN*0.32 : SPAN*0.26;
  function step(){
    // repulsion — O(n^2) is fine at ~100 nodes
    for (let i=0;i<nodes.length;i++){
      const a = nodes[i];
      for (let j=i+1;j<nodes.length;j++){
        const b = nodes[j];
        let dx = b.x-a.x, dy = b.y-a.y;
        let d2 = dx*dx + dy*dy || 0.01;
        const minD = (R(a)+R(b)+14);
        // Stronger push when circles actually overlap: label collisions are
        // what make these graphs unreadable, not node distance in the abstract.
        // Repulsion scales with the canvas too — a constant that worked on a
        // 600px card is invisible on a 1500px one.
        const K = SPAN * SPAN * 0.035;
        const f = (d2 < minD*minD ? K*2.9 : K) / d2;
        const d = Math.sqrt(d2);
        const ux = dx/d, uy = dy/d;
        a.vx -= ux*f*0.01; a.vy -= uy*f*0.01;
        b.vx += ux*f*0.01; b.vy += uy*f*0.01;
      }
    }
    // springs along links
    links.forEach(l => {
      const a = l.s, b = l.t;
      const dx = b.x-a.x, dy = b.y-a.y;
      const d = Math.sqrt(dx*dx+dy*dy) || 0.01;
      const want = LINK_LEN(b.depth);
      const f = (d - want) * 0.035;
      const ux = dx/d, uy = dy/d;
      a.vx += ux*f; a.vy += uy*f;
      b.vx -= ux*f; b.vy -= uy*f;
    });
    // gentle pull to centre + damping
    nodes.forEach(n => {
      if (n.kind === 'root'){ n.x = cx; n.y = cy; n.vx = n.vy = 0; return; }
      n.vx += (cx - n.x) * 0.0016;
      n.vy += (cy - n.y) * 0.0016;
      n.vx *= 0.82; n.vy *= 0.82;
      n.x += n.vx; n.y += n.vy;
      // keep inside the viewport
      const r = R(n) + 4;
      n.x = Math.max(r, Math.min(W-r, n.x));
      n.y = Math.max(r, Math.min(H-r, n.y));
    });
  }
  for (let i=0;i<260;i++) step();

  // Fit the relaxed layout to the canvas. Tuning forces alone is fragile — the
  // equilibrium size depends on node count, so a 6-node day and a 90-node week
  // would fill the card differently. Scaling the final positions makes the
  // graph fill the space at ANY size, and caps zoom so a tiny graph does not
  // get blown up into absurdly distant nodes.
  (function fit(){
    const free = nodes.filter(n => n.kind !== 'root');
    if (!free.length) return;
    const pad = 46;
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    nodes.forEach(n => { const r=R(n);
      x0=Math.min(x0,n.x-r); x1=Math.max(x1,n.x+r);
      y0=Math.min(y0,n.y-r); y1=Math.max(y1,n.y+r); });
    const bw = x1-x0, bh = y1-y0;
    if (bw < 1 || bh < 1) return;
    // Independent x/y scales: the card is much wider than tall (1495x707), and
    // a radially symmetric layout scaled uniformly leaves the sides empty.
    // Allowing the x-stretch to exceed y (capped, so circles stay circles and
    // the tree does not look smeared) uses the real estate the card has.
    const kx0 = (W-pad*2)/bw, ky0 = (H-pad*2)/bh;
    const ky = Math.min(ky0, 2.6);
    const kx = Math.min(kx0, ky * 1.85, 3.4);
    const ox = (x0+x1)/2, oy = (y0+y1)/2;
    nodes.forEach(n => {
      n.x = cx + (n.x-ox)*kx;
      n.y = cy + (n.y-oy)*ky;
    });
  })();

  // --- draw ---
  const NS = 'http://www.w3.org/2000/svg';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = '';
  const gl = document.createElementNS(NS,'g'), gn = document.createElementNS(NS,'g');
  svg.appendChild(gl); svg.appendChild(gn);

  links.forEach(l => {
    const p = document.createElementNS(NS,'path');
    // Curved links read better than straight ones when many share an endpoint.
    const mx = (l.s.x+l.t.x)/2, my = (l.s.y+l.t.y)/2;
    const dx = l.t.x-l.s.x, dy = l.t.y-l.s.y;
    const nx = -dy*0.12, ny = dx*0.12;
    p.setAttribute('d', `M${l.s.x.toFixed(1)},${l.s.y.toFixed(1)} Q${(mx+nx).toFixed(1)},${(my+ny).toFixed(1)} ${l.t.x.toFixed(1)},${l.t.y.toFixed(1)}`);
    p.setAttribute('class','lnk');
    p.setAttribute('stroke-width', Math.max(0.6, Math.sqrt(l.t.calls/maxCalls)*5).toFixed(2));
    l.el = p; gl.appendChild(p);
  });

  nodes.forEach(n => {
    const g = document.createElementNS(NS,'g');
    g.setAttribute('class', 'nd ' + n.kind);
    g.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
    const c = document.createElementNS(NS,'circle');
    const col = flowColor(n);
    c.setAttribute('r', R(n).toFixed(1));
    c.setAttribute('fill', col);
    c.setAttribute('fill-opacity', n.kind==='task' ? '.55' : '.9');
    c.setAttribute('stroke', col);
    c.setAttribute('stroke-width','1.5');
    g.appendChild(c);

    // #18: an invisible hit-area circle padded out to >=24px radius — the
    // visible circle for a small task node can be a few px, which is too
    // small to reliably hit with a finger even though a mouse cursor is
    // precise enough not to need it.
    const hit = document.createElementNS(NS,'circle');
    hit.setAttribute('r', Math.max(R(n), 12).toFixed(1));
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('class', 'hitarea');
    g.appendChild(hit);

    // Glow intensity = how much work this node did, as a share of the busiest
    // node. sqrt matches the radius scale, so glow and size tell the same
    // story; a linear ramp would leave everything but the top node dark.
    // Stored as a CSS var so the drag handler can brighten without recomputing.
    const heat = Math.sqrt(n.calls / maxCalls) || 0;
    n.heat = heat;
    g.style.setProperty('--heat', heat.toFixed(3));
    g.style.setProperty('--glow', col);
    n.circle = c;

    // Label every node big enough to carry one; tiny task nodes stay bare and
    // rely on the tooltip, otherwise the graph turns into a word cloud.
    if (n.kind !== 'task' || R(n) > 9){
      const t = document.createElementNS(NS,'text');
      t.setAttribute('y', (R(n) + 10).toFixed(1));
      t.textContent = n.name.length > 22 ? n.name.slice(0,21)+'…' : n.name;
      if (n.kind === 'model') t.setAttribute('fill', col);
      g.appendChild(t);
    }
    n.el = g; gn.appendChild(g);
  });

  // --- interaction: drag to reposition, hover focuses a subtree ---
  // Dragging is worth the complexity here: the force layout optimises for "no
  // overlaps", not "the comparison you care about" — let people pull a node
  // clear of its neighbours to read it.
  const tip = $('flowtip');

  // Viewport px -> SVG user units. The SVG is scaled by CSS (viewBox 0 0 W H
  // rendered into whatever the card is), so using clientX directly makes the
  // node drift away from the cursor on any non-1:1 card.
  function toSvg(ev){
    const b = svg.getBoundingClientRect();
    return { x: (ev.clientX - b.left) * (W / b.width),
             y: (ev.clientY - b.top)  * (H / b.height) };
  }

  let drag = null;
  function moveNode(n, x, y){
    const r = R(n) + 4;
    n.x = Math.max(r, Math.min(W - r, x));
    n.y = Math.max(r, Math.min(H - r, y));
    n.el.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
    // Redraw only the links touching this node — rebuilding all of them on
    // every pointermove is what makes naive drag implementations stutter.
    links.forEach(l => {
      if (l.s !== n && l.t !== n) return;
      const mx = (l.s.x + l.t.x) / 2, my = (l.s.y + l.t.y) / 2;
      const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
      const nx = -dy * 0.12, ny = dx * 0.12;
      l.el.setAttribute('d',
        `M${l.s.x.toFixed(1)},${l.s.y.toFixed(1)} Q${(mx+nx).toFixed(1)},${(my+ny).toFixed(1)} ${l.t.x.toFixed(1)},${l.t.y.toFixed(1)}`);
    });
  }

  nodes.forEach(n => {
    if (n.kind === 'root') return;          // root is pinned to the centre
    n.el.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      const p = toSvg(ev);
      drag = { n, dx: n.x - p.x, dy: n.y - p.y, moved: false };
      // Capture on the SVG, not the node: a fast drag outruns the cursor and
      // would otherwise drop the node the moment the pointer leaves its circle.
      svg.setPointerCapture(ev.pointerId);
      svg.classList.add('drag');
      n.el.classList.add('dragging');
    });
  });

  svg.addEventListener('pointermove', ev => {
    if (!drag) return;
    const p = toSvg(ev);
    drag.moved = true;
    moveNode(drag.n, p.x + drag.dx, p.y + drag.dy);
  });

  function endDrag(ev){
    if (!drag) return;
    drag.n.el.classList.remove('dragging');
    // Mark as user-placed so it reads as deliberately positioned, and so a
    // future re-layout can respect the placement instead of snapping it back.
    if (drag.moved) drag.n.el.classList.add('pinned');
    svg.classList.remove('drag');
    try { svg.releasePointerCapture(ev.pointerId); } catch (e) {}
    drag = null;
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  // #18: pan + pinch-zoom via viewBox, independent of node-drag (drag only
  // starts from a node's own pointerdown, so background pointerdowns are
  // always free for panning). Two active pointers = pinch; one = pan.
  const view = { x: 0, y: 0, w: W, h: H }; // current viewBox rect, in SVG units
  svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  const active = new Map(); // pointerId -> last client {x,y}
  let panStart = null, pinchStart = null;

  function applyView(){
    svg.setAttribute('viewBox', `${view.x.toFixed(1)} ${view.y.toFixed(1)} ${view.w.toFixed(1)} ${view.h.toFixed(1)}`);
    // Below ~60% of the fitted scale, the graph is more zoomed-out than its
    // initial fit — thin the labels so it doesn't turn into a tangle.
    svg.classList.toggle('zoomedout', view.w > W * 1.4);
  }
  function clampView(){
    // Zoom out capped at 3x the fitted size (nothing new to see past that),
    // zoom in capped so a pinch cannot shrink the viewBox to nothing.
    view.w = Math.max(W * 0.15, Math.min(W * 3, view.w));
    view.h = Math.max(H * 0.15, Math.min(H * 3, view.h));
  }
  function zoomAt(clientX, clientY, factor){
    const b = svg.getBoundingClientRect();
    // The point under the cursor/pinch-centre, in viewBox units, stays fixed.
    const px = view.x + (clientX - b.left) / b.width  * view.w;
    const py = view.y + (clientY - b.top)  / b.height * view.h;
    view.w /= factor; view.h /= factor;
    clampView();
    view.x = px - (clientX - b.left) / b.width  * view.w;
    view.y = py - (clientY - b.top)  / b.height * view.h;
    applyView();
  }
  function fitView(){
    view.x = 0; view.y = 0; view.w = W; view.h = H;
    applyView();
  }
  svg._flowFit = fitView; // exposed for the #flowctl "Fit" button

  svg.addEventListener('pointerdown', ev => {
    if (drag) return; // a node drag owns this pointer
    active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (active.size === 1){
      panStart = { view: { ...view }, p: { x: ev.clientX, y: ev.clientY } };
    } else if (active.size === 2){
      const pts = [...active.values()];
      pinchStart = {
        view: { ...view },
        d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2,
      };
      panStart = null;
    }
  });
  svg.addEventListener('pointermove', ev => {
    if (drag || !active.has(ev.pointerId)) return;
    active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const b = svg.getBoundingClientRect();
    if (active.size === 2 && pinchStart){
      const pts = [...active.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const factor = d / (pinchStart.d || 1);
      view.w = pinchStart.view.w / factor;
      view.h = pinchStart.view.h / factor;
      clampView();
      const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
      // Two-finger pan happens naturally alongside the pinch: keep the
      // midpoint under the fingers, not just the zoom centred on itself.
      const px = pinchStart.view.x + (pinchStart.cx - b.left) / b.width  * pinchStart.view.w;
      const py = pinchStart.view.y + (pinchStart.cy - b.top)  / b.height * pinchStart.view.h;
      view.x = px - (cx - b.left) / b.width  * view.w;
      view.y = py - (cy - b.top)  / b.height * view.h;
      applyView();
    } else if (active.size === 1 && panStart){
      const dx = (ev.clientX - panStart.p.x) / b.width  * panStart.view.w;
      const dy = (ev.clientY - panStart.p.y) / b.height * panStart.view.h;
      view.x = panStart.view.x - dx;
      view.y = panStart.view.y - dy;
      applyView();
    }
  });
  function endPointer(ev){
    active.delete(ev.pointerId);
    if (active.size < 2) pinchStart = null;
    if (active.size === 1){
      const [p] = active.values();
      panStart = { view: { ...view }, p };
    } else if (active.size === 0) panStart = null;
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('pointerleave', endPointer);

  // Trackpad pinch and mouse-wheel zoom (desktop): ctrlKey is how browsers
  // report a trackpad pinch gesture via wheel events.
  svg.addEventListener('wheel', ev => {
    ev.preventDefault();
    const factor = Math.exp(-ev.deltaY * 0.0035);
    zoomAt(ev.clientX, ev.clientY, factor);
  }, { passive: false });

  // Double-tap/double-click resets to the fitted view.
  svg.addEventListener('dblclick', () => fitView());

  // #18: responsive viewBox — a rotation or a window resize changes W/H, and
  // the old fixed viewBox from the initial render would then either crop the
  // graph or leave dead space. Re-run the whole layout (debounced) whenever
  // the wrapper's own size actually changes, but only while the Flow tab is
  // the one on screen (recomputing a force layout you cannot see is wasted
  // work and would also un-pin nodes the user placed on a hidden tab).
  if (!wrap._flowResizeWired && typeof ResizeObserver !== 'undefined'){
    wrap._flowResizeWired = true;
    let t = null;
    new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        if ($('views')?.querySelector('[data-vtab="Flow"].tabon') && FLOWROWS)
          renderFlow(FLOWROWS);
      }, 200);
    }).observe(wrap);
  }
  FLOWROWS = rows;

  const kids = new Map();          // node -> descendant set (computed once)
  function descend(n, set){ (n.kids||[]).forEach(k => { set.add(k); descend(k, set); }); return set; }
  nodes.forEach(n => kids.set(n, descend(n, new Set())));

  function focus(n){
    if (!n){ svg.classList.remove('focus');
             nodes.forEach(x=>x.el.classList.remove('on'));
             links.forEach(l=>l.el.classList.remove('on'));
             tip.classList.remove('on'); return; }
    const set = kids.get(n); set.add(n);
    // Also light the path back to the root, so you see which provider owns it.
    let up = n; while (up){ set.add(up); up = up.parent; }
    svg.classList.add('focus');
    nodes.forEach(x => x.el.classList.toggle('on', set.has(x)));
    links.forEach(l => l.el.classList.toggle('on', set.has(l.s) && set.has(l.t)));
  }
  // parent pointers for the upward path
  links.forEach(l => l.t.parent = l.s);

  const pct = n => root.calls ? (n.calls/root.calls*100) : 0;
  nodes.forEach(n => {
    n.el.addEventListener('mouseenter', () => {
      focus(n);
      const rows = [
        ['calls', n.calls.toLocaleString() + ` (${pct(n).toFixed(1)}%)`],
        ['est. cost', '$' + n.cost.toFixed(2)],
      ];
      if (n.kids && n.kids.length) rows.push([n.kind==='prov'?'models':'tasks', n.kids.length]);
      // Which chats this node served. Model nodes aggregate across their task
      // children, task nodes are exact — so the same lookup serves both.
      const chats = flowSessions(n);
      const chatHtml = chats.length
        ? `<div class="ft-s">chats</div>` + chats.map(c =>
            `<div class="ft-c"><span>${esc(c.title)}</span><b>${c.calls.toLocaleString()}</b></div>`).join('')
        : '';
      tip.innerHTML = `<div class="ft-h" style="color:${flowColor(n)}">${n.name}</div>` +
        rows.map(([k,v])=>`<div class="ft-r"><span>${k}</span><b>${v}</b></div>`).join('') + chatHtml;
      const bx = wrap.getBoundingClientRect();
      const sx = bx.width / W, sy = bx.height / H;
      tip.style.left = Math.min(bx.width-230, n.x*sx + 14) + 'px';
      tip.style.top  = Math.max(0, n.y*sy - 10) + 'px';
      tip.classList.add('on');
    });
    n.el.addEventListener('mouseleave', () => focus(null));
  });

  const nProv = root.kids.length;
  const nModel = root.kids.reduce((s,p)=>s+p.kids.length,0);
  if (sub) sub.textContent =
    `${nProv} providers · ${nModel} models · ${nodes.length} nodes · ${root.calls.toLocaleString()} calls`;
}

function flowControls(){
  const box = $('flowctl');
  if (!box || box.dataset.wired) return;
  box.dataset.wired = '1';
  box.innerHTML = [[2,'provider → model'],[3,'+ task']]
    .map(([d,l])=>`<button data-fd="${d}">${l}</button>`).join('') +
    // #18: reset control for the pinch/pan/drag state — the graph's own
    // fitView() is stashed on the <svg> element by renderFlow each time it
    // rebuilds, so this button always calls whatever is current.
    `<button data-flowfit title="Reset pan/zoom to fit">Fit</button>`;
  box.querySelectorAll('[data-fd]').forEach(b => {
    b.addEventListener('click', () => {
      flowDepth = +b.dataset.fd;
      box.querySelectorAll('[data-fd]').forEach(x =>
        x.classList.toggle('on', +x.dataset.fd === flowDepth));
      render();
    });
  });
  box.querySelectorAll('[data-fd]').forEach(x =>
    x.classList.toggle('on', +x.dataset.fd === flowDepth));
  box.querySelector('[data-flowfit]')?.addEventListener('click', () => {
    $('flow')?._flowFit?.();
  });
}

// Activity heatmap — a GitHub-style calendar. Weeks are columns, weekdays are
// rows, so seasonality and gaps are obvious. Intensity is bucketed on quartiles
// of the observed range rather than absolute counts, so the scale stays useful
// whether a busy day is 200 calls or 20,000.
function renderHeatmap(hm){
  const wrap = $('heatmap'), sub = $('heatsub'), card = $('heatcard');
  if (!wrap) return;
  const data = (hm||[]).filter(x => x && x.d);
  if (!data.length){ if (card) card.hidden = true; return; }
  if (card) card.hidden = false;

  // Per day: total calls + a per-provider breakdown. Provider identity comes
  // from the shared provOf() so a cell's colours match the provider badges,
  // the provider-distribution chart and the cost table exactly.
  const by = {};
  data.forEach(x => {
    const day = (by[x.d] ||= {v:0, prov:{}});
    const n = x.v || 0;
    day.v += n;
    // Pre-split rows (no provider fields) still work: they fall into '?' and
    // render with the neutral accent, so an old payload degrades rather than
    // throwing.
    const key = (x.p === undefined && x.url === undefined) ? '?' : provOf(x.p, x.m, x.url);
    day.prov[key] = (day.prov[key] || 0) + n;
  });

  const vals = Object.values(by).map(o => o.v).filter(v => v > 0).sort((a,b)=>a-b);
  const q = p => vals.length ? vals[Math.min(vals.length-1, Math.floor(vals.length*p))] : 0;
  const cuts = [q(.25), q(.5), q(.75), q(.92)];
  const level = v => !v ? 0 : v<=cuts[0] ? 1 : v<=cuts[1] ? 2 : v<=cuts[2] ? 3 : v<=cuts[3] ? 4 : 5;

  // A day's cell is a hard-stop linear-gradient: one band per provider, sized
  // by that provider's share of the day. Opacity still encodes volume (the
  // quartile level), so colour answers "who" and brightness answers "how much".
  const OPA = [0, .34, .52, .70, .86, 1];
  function cellStyle(day){
    const lv = level(day.v);
    if (!lv) return '';
    const parts = Object.entries(day.prov).sort((a,b)=>b[1]-a[1]);
    const alpha = OPA[lv];
    const col = k => {
      const c = (PROV[k]||{}).fg || 'var(--accent)';
      return `color-mix(in srgb, ${c} ${Math.round(alpha*100)}%, var(--border))`;
    };
    if (parts.length === 1) return `background:${col(parts[0][0])}`;
    let acc = 0;
    const stops = parts.map(([k, n]) => {
      const from = (acc / day.v) * 100; acc += n;
      return `${col(k)} ${from.toFixed(2)}% ${((acc / day.v) * 100).toFixed(2)}%`;
    });
    return `background:linear-gradient(135deg, ${stops.join(',')})`;
  }
  const provTip = day => Object.entries(day.prov).sort((a,b)=>b[1]-a[1])
    .map(([k,n]) => `${k} ${Math.round(n/day.v*100)}%`).join(' · ');

  // Always end on today and start on a Sunday, so columns are whole weeks.
  const end = new Date(); end.setHours(12,0,0,0);
  // A full year of columns: at full card width 26 weeks would blow each cell up
  // to ~56px, so a year both fills the space and keeps cells a sane size.
  const start = new Date(end); start.setDate(start.getDate() - 7*52);
  start.setDate(start.getDate() - start.getDay());
  const iso = d => d.toISOString().slice(0,10);

  const weeks = []; let col = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)){
    const k = iso(d);
    col.push({d:k, day: by[k] || null, v: (by[k]||{}).v || 0, dow: d.getDay()});
    if (d.getDay() === 6){ weeks.push(col); col = []; }
  }
  if (col.length) weeks.push(col);

  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let lastMon = -1;
  const heads = weeks.map(w => {
    const m = new Date(w[0].d + 'T12:00:00').getMonth();
    if (m !== lastMon){ lastMon = m; return `<span class="hm-mon">${MON[m]}</span>`; }
    return '<span class="hm-mon"></span>';
  }).join('');

  const cols = weeks.map(w => {
    const cells = [];
    for (let r = 0; r < 7; r++){
      const c = w.find(x => x.dow === r);
      cells.push(c
        ? `<i class="hm-d l${level(c.v)}"${c.day ? ` style="${cellStyle(c.day)}"` : ''}` +
          ` title="${c.d} · ${c.v.toLocaleString()} calls${c.day ? ' · ' + provTip(c.day) : ''}"></i>`
        : '<i class="hm-d hm-pad"></i>');
    }
    return `<div class="hm-w">${cells.join('')}</div>`;
  }).join('');

  // Legend: which providers appear in this range (colour = who), plus the
  // intensity ramp (brightness = how much). The old ramp alone no longer
  // explained the cells once they became multi-coloured.
  const seen = {};
  Object.values(by).forEach(day => Object.entries(day.prov)
    .forEach(([k,n]) => seen[k] = (seen[k]||0) + n));
  const provKeys = Object.entries(seen).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
  const provLegend = provKeys.map(k =>
    `<span class="hm-lg"><i class="hm-sw" style="background:${(PROV[k]||{}).fg||'var(--accent)'}"></i>` +
    `<span class="muted">${k}</span></span>`).join('');

  wrap.innerHTML =
    `<div class="hm-scroll"><div class="hm-months">${heads}</div>
      <div class="hm-grid">${cols}</div>
      <div class="hm-key">${provLegend}
        <span class="hm-sep"></span>
        <span class="muted">less</span>
        ${[0,1,2,3,4,5].map(l=>`<i class="hm-d l${l}"></i>`).join('')}
        <span class="muted">more</span></div></div>`;

  const total = vals.reduce((a,b)=>a+b,0);
  // by[] values are objects now: sort on .v, not the entry itself.
  const busiest = Object.entries(by).sort((a,b)=>b[1].v-a[1].v)[0];
  if (sub) sub.textContent =
    `${vals.length} active days · ${total.toLocaleString()} calls` +
    (busiest ? ` · busiest ${busiest[0]} (${busiest[1].v.toLocaleString()})` : '');
}

// ---- Hash routing (#5) --------------------------------------------------
// The hash is the single source of truth for which view is showing, so a
// deep link, a refresh, and the back button all agree. Without this the tab
// lived only in localStorage: a shared URL always opened on someone else's
// last-used tab.
function slugOf(v){ return String(v).toLowerCase(); }

// Written by pickView. No timing flag: compare the hash to the view that is
// already showing. A timer-based guard raced with jsdom's async hashchange and
// let a redundant re-render wipe the live list mid-update.
function setHash(v){
  const want = '#/' + slugOf(v);
  if (location.hash !== want) location.hash = want;
}

// Resolve a hash to a real view name, case-insensitively, falling back to the
// stored view then Home. An unknown slug must not blank the page.
function viewFromHash(){
  const raw = (location.hash || '').replace(/^#\/?/, '').trim();
  if (!raw) return null;
  const names = [...document.querySelectorAll('.view')].map(el => el.dataset.view);
  return names.find(nm => slugOf(nm) === slugOf(raw)) || null;
}

window.addEventListener('hashchange', () => {
  const v = viewFromHash();
  // Back/forward land here, and so does pickView's own hash write. Comparing
  // against the visible view makes the self-write a no-op, so a view change
  // renders exactly once.
  if (v && v !== view) pickView(v);
});

// ---- Settings (P7-03, #67) -------------------------------------------------
// POWER is embedded at build time from energy.py (tariff as configured when
// the page was built, plus the read-only measured facts). The live values
// come from GET /api/settings when the serve process is present, so the page
// shows what is in effect *now*, not what it was built with.
const POWER = __POWER__;
const SET_DEFAULTS = POWER.defaults;
let setState = {values: {...POWER.tariff}, writable: false, api: false, file: POWER.config_file || ''};

function usdPerSec(v){
  return ((+v.gpu_draw_watts || 0) + (+v.host_overhead_watts || 0)) / 1000
    * (+v.electricity_rate_kwh || 0) / 3600;
}
function outPer1M(v, tps){ return usdPerSec(v) * 1e6 / tps; }

function setRead(){
  const v = {};
  document.querySelectorAll('#setcard input[data-key]').forEach(i => { v[i.dataset.key] = +i.value; });
  return v;
}
function setWrite(v){
  document.querySelectorAll('#setcard input[data-key]').forEach(i => {
    if (v[i.dataset.key] != null) i.value = v[i.dataset.key];
  });
}
function setInvalid(){
  return [...document.querySelectorAll('#setcard input[data-key]')]
    .filter(i => i.value === '' || !i.checkValidity()).map(i => i.dataset.key);
}

function renderSetDeriv(){
  const box = document.getElementById('setderiv'); if (!box) return;
  const v = setRead(), bad = setInvalid();
  if (bad.length){
    box.innerHTML = `<span class="setbad">Check ${bad.map(esc).join(', ')}: out of range or empty.</span>`;
  } else {
    const w = (+v.gpu_draw_watts) + (+v.host_overhead_watts);
    const s = usdPerSec(v);
    const o30 = outPer1M(v, 30);
    box.innerHTML =
      `<code>(${+v.gpu_draw_watts} W + ${+v.host_overhead_watts} W) / 1000 \u00d7 $${+v.electricity_rate_kwh} / 3600</code>` +
      ` = <b id="setusdsec">$${s.toPrecision(2)}</b> per second of inference` +
      `<div class="muted text-[length:var(--fs-xs)] mt-1">A 30B model at 30 tok/s \u2192 <b>$${o30.toFixed(4)}</b> per 1M output tokens,` +
      ` $${(o30 / POWER.prefill).toFixed(4)} per 1M input, $${(o30 / POWER.cachex).toFixed(4)} per 1M cached.` +
      ` Total draw ${w} W.</div>`;
  }
  const changed = Object.keys(SET_DEFAULTS).some(k => +v[k] !== +setState.values[k]);
  const save = document.getElementById('setsave');
  if (save) save.disabled = !setState.writable || !changed || bad.length > 0;
}

function renderSetFacts(){
  const box = document.getElementById('setfacts'); if (!box) return;
  const v = setRead();
  const rows = POWER.tps.map(([band, tps]) =>
    `<tr><td>${esc(band)}</td><td class="text-right">${tps}</td>` +
    `<td class="text-right">$${outPer1M(v, tps).toFixed(4)}</td></tr>`).join('');
  box.innerHTML =
    `<div class="setfacts2"><table class="w-full text-[length:var(--fs-xs)]"><thead><tr class="muted text-left">` +
    `<th>Size band</th><th class="text-right">tok/s</th><th class="text-right">$/1M out</th></tr></thead>` +
    `<tbody>${rows}<tr><td class="muted">unknown size</td><td class="text-right">${POWER.tps_default}</td>` +
    `<td class="text-right">$${outPer1M(v, POWER.tps_default).toFixed(4)}</td></tr></tbody></table>` +
    `<ul class="text-[length:var(--fs-xs)] setlist">` +
    `<li><b>Prefill \u00d7${POWER.prefill}</b> cheaper than generating: the prompt is one batched forward pass.</li>` +
    `<li><b>Cache read \u00d7${POWER.cachex}</b> cheaper: no matmuls, but KV tensors still stream out of VRAM with the GPU powered.</li>` +
    `<li>Throughput is measured per model size on the local inference box; a model is matched to the first band in its name.</li>` +
    `</ul></div>`;
}

function setMsg(text, kind){
  const m = document.getElementById('setmsg'); if (!m) return;
  m.textContent = text || '';
  m.className = 'text-[length:var(--fs-xs)] ' + (kind === 'err' ? 'setbad' : kind === 'ok' ? 'setok' : 'muted');
}

function renderSettings(){
  const src = document.getElementById('setsrc');
  if (src){
    src.textContent = setState.api
      ? (setState.file ? 'config: ' + setState.file : '')
      : 'read-only: values as built' + (setState.file ? ' from ' + setState.file : '');
  }
  if (!setState.api){
    setMsg('Saving needs the dashboard served by `llm-telemetry serve`. Edit the config file directly, or paste: '
      + JSON.stringify(setRead()), 'info');
  } else if (!setState.writable){
    setMsg('Settings can only be changed from the machine running the dashboard.', 'info');
  }
  renderSetDeriv();
  renderSetFacts();
  renderSetColors();
}

// ---- #126: per-profile colour picker on the Settings page -----------------
// One swatch+slider row per profile that has ever been seen (PV_ALL, not just
// the currently-on set, so a toggled-off profile's colour is still editable).
// The row reflects the CURRENT effective hue (override if set, else the
// hashHue default) so opening Settings never shows a value that disagrees
// with what the tab strip is actually drawing right now.
function setColorSwatch(n){
  const h = profileHue(n);
  const overridden = pvHueOverride(n) !== null;
  return `<div class="setf" data-scname="${escA(n)}">
    <span class="setl">${esc(n)}</span>
    <span class="setin">
      <span style="width:16px;height:16px;border-radius:999px;flex:none;background:hsl(${h} 62% 45%);border:1px solid var(--border)"></span>
      <input type="range" min="0" max="359" step="1" value="${h}" data-schue="${escA(n)}" style="flex:1;min-width:0">
      <span class="muted text-[length:var(--fs-xs)]" style="min-width:2.6em;text-align:right" data-schuen="${escA(n)}">${h}°</span>
    </span>
    <span class="seth">${overridden ? 'Custom — ' : 'Default (from name) — '}used for its tab, badges and live dots.</span>
  </div>`;
}
function renderSetColors(){
  const box = document.getElementById('setcolorgrid');
  if (!box || !PV_ALL) return;
  // Rebuild only when the profile SET changed; a slider drag re-renders via
  // direct DOM writes below so mid-drag input events don't fight a rebuild.
  const names = Object.keys(PV_ALL);
  const have = [...box.querySelectorAll('[data-scname]')].map(el => el.dataset.scname);
  if (have.length === names.length && have.every(n => names.includes(n))) return;
  box.innerHTML = names.map(setColorSwatch).join('') || '<div class="muted text-[length:var(--fs-sm)]">No profiles yet.</div>';
}
function setColorsInstall(){
  const box = document.getElementById('setcolorgrid');
  if (!box) return;
  box.addEventListener('input', e => {
    const inp = e.target.closest && e.target.closest('[data-schue]');
    if (!inp) return;
    const n = inp.dataset.schue;
    const deg = Number(inp.value);
    pvHueSet(n, deg);
    // live-update the swatch and readout without a full rebuild, so dragging
    // the slider stays smooth instead of re-rendering the whole grid per tick
    const row = inp.closest('[data-scname]');
    if (row){
      const dot = row.querySelector('.setin > span[style*="border-radius:999px"]');
      if (dot) dot.style.background = `hsl(${deg} 62% 45%)`;
      const readout = row.querySelector(`[data-schuen="${CSS.escape(n)}"]`);
      if (readout) readout.textContent = deg + '°';
      const hint = row.querySelector('.seth');
      if (hint) hint.textContent = 'Custom — used for its tab, badges and live dots.';
    }
    // Everywhere else that draws this profile's colour must pick it up
    // immediately, not just on the next poll — a settings change with no
    // visible effect elsewhere reads as broken.
    tabs(); renderLive();
  });
  document.getElementById('setcolorreset')?.addEventListener('click', () => {
    Object.keys(PV_ALL || {}).forEach(n => pvHueSet(n, null));
    const box2 = document.getElementById('setcolorgrid');
    if (box2) box2.innerHTML = '';   // force renderSetColors() to rebuild every row
    renderSetColors();
    tabs(); renderLive();
    const m = document.getElementById('setcolormsg');
    if (m) { m.textContent = 'Reset to name-derived defaults.'; m.className = 'text-[length:var(--fs-xs)] ok'; }
  });
}

async function loadSettings(){
  setWrite(setState.values);
  try {
    const r = await fetch('api/settings', {cache: 'no-store'});
    if (r.ok){
      const j = await r.json();
      // Only a well-formed settings reply counts: a static host or a stub
      // that answers every URL with some other JSON must leave the page on
      // its embedded, read-only values rather than crash it.
      const ok = j && j.values && Object.keys(SET_DEFAULTS).every(k => Number.isFinite(+j.values[k]));
      if (ok){
        setState = {values: j.values, writable: !!j.writable, api: true, file: j.config_file || setState.file};
        setWrite(setState.values);
      }
    }
  } catch (e) { /* static hosting: stay read-only */ }
  renderSettings();
}

async function saveSettings(){
  const bad = setInvalid();
  if (bad.length) return setMsg('Fix ' + bad.join(', ') + ' first.', 'err');
  const v = setRead();
  const body = {};
  Object.keys(SET_DEFAULTS).forEach(k => { if (+v[k] !== +setState.values[k]) body[k] = +v[k]; });
  if (!Object.keys(body).length) return setMsg('Nothing changed.', 'info');
  setMsg('Saving\u2026', 'info');
  try {
    const r = await fetch('api/settings', {method: 'POST', cache: 'no-store',
      headers: {'Content-Type': 'application/json', 'X-LLM-Telemetry': '1'}, body: JSON.stringify(body)});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(j.error || ('Save failed (' + r.status + ')'), 'err');
    setState.values = j.values; setState.file = j.config_file || setState.file;
    setWrite(setState.values);
    setMsg('Saved to ' + setState.file + '. Costs update on the next refresh (about a minute).', 'ok');
    renderSetDeriv();
  } catch (e) {
    setMsg('Save failed: ' + e.message, 'err');
  }
}

function settingsInstall(){
  const card = document.getElementById('setcard'); if (!card) return;
  card.querySelectorAll('input[data-key]').forEach(i => i.addEventListener('input', () => {
    renderSetDeriv(); renderSetFacts();
  }));
  document.getElementById('setsave')?.addEventListener('click', saveSettings);
  document.getElementById('setreset')?.addEventListener('click', () => {
    setWrite(SET_DEFAULTS); renderSetDeriv(); renderSetFacts();
    setMsg('Defaults filled in; not saved yet.', 'info');
  });
  setColorsInstall();
  loadSettings();
}

// ---- Breadcrumb (#6) ------------------------------------------------------
// Reflects the current section in the header, so the page says where you are
// rather than leaving the active tab chip as the only cue.
function setCrumb(v){
  const el = document.getElementById('crumb');
  if (el) el.textContent = v || '';
}

// ---- Left nav drawer (#3) -------------------------------------------------
// The rail is the primary section nav on desktop. It renders from the same
// view list as the chip strip, so the two can never disagree about which
// sections exist. Items are <a href="#/slug"> so middle-click and "copy link"
// behave, with a click handler for in-page routing.
const NAV_ICONS = {
  Home:'\u2302', Live:'\u25C9', Flow:'\u21C4', Usage:'\u2211',
  Cost:'$', Health:'\u2713', Detail:'\u2261', Logs:'\u2630', Settings:'\u2699'
};

// Grouped sections (#122). The rail is grouped by what a view is FOR, so the
// list stays scannable as it grows. The order here is the display order.
// A view with no entry falls into the trailing "More" group rather than
// disappearing — a new view must never be silently missing from the nav.
const NAV_GROUPS = [
  {name:'Overview',  views:['Home', 'Live', 'Flow']},
  {name:'Analysis',  views:['Usage', 'Cost', 'Health']},
  {name:'System',    views:['Detail', 'Logs', 'Settings']},
];
const NAV_FALLBACK_GROUP = 'More';

function navViews(){
  return [...document.querySelectorAll('.view')].map(el => el.dataset.view);
}

// -> [{name, views:[...]}] covering EVERY view exactly once, in NAV_GROUPS
// order, with anything unlisted appended to the fallback group.
function navGroups(){
  const all = navViews();
  const seen = new Set();
  const out = [];
  NAV_GROUPS.forEach(g => {
    const views = g.views.filter(v => all.includes(v));
    views.forEach(v => seen.add(v));
    if (views.length) out.push({name:g.name, views});
  });
  const rest = all.filter(v => !seen.has(v));
  if (rest.length) out.push({name:NAV_FALLBACK_GROUP, views:rest});
  return out;
}

function renderNav(){
  const box = document.getElementById('navlist');
  if (!box) return;
  const groups = navGroups();
  const item = v => `
    <a class="navitem" href="#/${slugOf(v)}" data-nav="${v}" data-tip="${v}">
      <span class="nvico" aria-hidden="true">${NAV_ICONS[v] || '\u2022'}</span>
      <span class="nvlabel">${v}</span>
      <span class="nvbadge" data-navbadge="${v}" hidden></span>
    </a>`;
  box.innerHTML = groups.map((g, i) => `
    ${i ? '<div class="navsep"></div>' : ''}
    <div class="navgroup" data-navgroup="${g.name}">
      <div class="navgroup-h">${g.name}</div>
      ${g.views.map(item).join('')}
    </div>`).join('');
  box.querySelectorAll('[data-nav]').forEach(a => {
    a.addEventListener('click', e => {
      // Let modified clicks (new tab, new window) behave natively.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      pickView(a.dataset.nav);
    });
  });
  navSync();
}

// Active state + counts. Called on every view change and every live poll, so
// the rail never disagrees with the page.
function navSync(){
  document.querySelectorAll('[data-nav]').forEach(a => {
    const on = a.dataset.nav === view;
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const p = (typeof DATA !== 'undefined' && DATA.profiles) ? (DATA.profiles[current] || {}) : {};
  const counts = {
    Live: (p.live || []).length,
    // Failures are the number worth surfacing on Health; 0 stays hidden so the
    // rail does not shout when nothing is wrong.
    Health: ((DATA && DATA.errors) || []).length
  };
  Object.entries(counts).forEach(([v, n]) => {
    const b = document.querySelector(`[data-navbadge="${v}"]`);
    if (!b) return;
    b.textContent = n;
    b.hidden = !n;
  });
}
// ---- Off-canvas drawer control (#4) --------------------------------------
// Mobile only. The panel is the same #navdrawer; a body class drives the
// transform, so there is one source of truth for open/closed.
let navOpen = false;

function isOffCanvas(){
  return window.matchMedia('(max-width:640px)').matches;
}

// Focus trap. Only while the panel is open on mobile: it is a modal surface
// there, and tabbing out to content the scrim covers would leave the keyboard
// somewhere the eye cannot follow.
function navFocusables(){
  const rail = document.getElementById('navdrawer');
  if (!rail) return [];
  // No visibility filtering here: offsetParent is null for everything under
  // jsdom and for any element in a transformed container, which emptied the
  // list and silently disabled both the focus move and the trap. The rail only
  // contains nav controls, and it is only focus-managed while open, so every
  // control in it is a legitimate target.
  return [...rail.querySelectorAll('a[href],button:not([disabled])')];
}

function navTrap(e){
  if (!navOpen || e.key !== 'Tab') return;
  const f = navFocusables();
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
}

function navSetOpen(on){
  navOpen = !!on && isOffCanvas();
  document.body.classList.toggle('navopen', navOpen);
  const t = document.getElementById('navtoggle');
  if (t) t.setAttribute('aria-expanded', navOpen ? 'true' : 'false');
  const rail = document.getElementById('navdrawer');
  // aria-hidden only in off-canvas mode: on desktop the rail is permanent
  // furniture and must stay in the accessibility tree.
  if (rail){
    if (isOffCanvas() && !navOpen) rail.setAttribute('aria-hidden', 'true');
    else rail.removeAttribute('aria-hidden');
  }
  if (navOpen){
    const f = navFocusables();
    if (f.length) f[0].focus();
  } else if (t && isOffCanvas()){
    // Focus returns to the control that opened it, not to the top of the page.
    t.focus();
  }
}

// Collapse state (#102). Collapsed is the DEFAULT: the rail is navigation, not
// content, and 232px of chrome on every page load is a poor trade when the
// icons carry the same information. The choice persists once the user makes it.
const NAVKEY = 'hermes-dash-navcollapsed';
function navCollapsed(){
  const v = localStorage.getItem(NAVKEY);
  return v === null ? true : v === '1';   // default collapsed
}
function navApplyCollapsed(on){
  document.body.classList.toggle('navcollapsed', on);
  const b = document.getElementById('navcollapse');
  if (b){
    b.setAttribute('aria-expanded', String(!on));
    b.setAttribute('aria-label', on ? 'Expand navigation' : 'Collapse navigation');
    b.textContent = on ? '\u00BB' : '\u00AB';
  }
  // Charts are responsive:true but only react to window resize; the rail
  // changing width resizes their container without one, so they must be told.
  requestAnimationFrame(() => charts.forEach(c => { try { c.resize(); } catch(_){} }));
}
function navSetCollapsed(on){
  localStorage.setItem(NAVKEY, on ? '1' : '0');
  navApplyCollapsed(on);
}

// ---- Logs page (#104) ---------------------------------------------------
// Fetched lazily: logs-data.json is ~1.3 MB per profile and most visits never
// open this view, so loading it with the dashboard would tax every page view
// for a minority feature. The drawer keeps its own 80-row live feed and is
// untouched by any of this — that answers "what is happening", this answers
// "find the thing that happened".
let LOGS = null, logsLoading = false, logsErr = '';
const lgSel = {level:new Set(), role:new Set(), tool:new Set(), model:new Set(),
               session:new Set(), kind:new Set()};
let lgWindow = 24, lgQ = '';

async function loadLogs(){
  if (LOGS || logsLoading) return;
  logsLoading = true; logsErr = '';
  renderLogs();
  try {
    const r = await fetch('logs-data.json?t=' + Date.now(), {cache:'no-store'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const fresh = await r.json();
    const bad = schemaProblem(fresh, 'logs-data.json');
    if (bad) throw new Error(bad);
    LOGS = fresh;
  } catch (e) {
    // file:// and a missing collector both land here. Say which, rather than
    // showing an empty list that looks like "no logs".
    logsErr = e.message;
  } finally {
    logsLoading = false;
    renderLogs();
  }
}

function lgProfile(){
  if (!LOGS || !LOGS.profiles) return null;
  // The merged "All" tab has no logs profile of its own; fall back to the
  // first real one rather than rendering nothing.
  return LOGS.profiles[current] || LOGS.profiles[Object.keys(LOGS.profiles)[0]] || null;
}

function lgMatch(e, p){
  if (lgSel.level.size && !lgSel.level.has(e.level)) return false;
  if (lgSel.role.size  && !lgSel.role.has(e.role))   return false;
  if (lgSel.tool.size  && !lgSel.tool.has(e.tool))   return false;
  if (lgSel.model.size && !lgSel.model.has(e.model)) return false;
  if (lgSel.session.size && !lgSel.session.has(e.session)) return false;
  if (lgSel.kind.size  && !lgSel.kind.has(e.kind))   return false;
  if (lgWindow){
    const cutoff = (p.generated || (Date.now()/1000)) - lgWindow*3600;
    if (e.ts < cutoff) return false;
  }
  if (lgQ){
    const hay = (e.preview + ' ' + e.tool + ' ' + e.title + ' ' + e.model + ' ' + e.session).toLowerCase();
    if (!hay.includes(lgQ)) return false;
  }
  return true;
}

function lgChips(boxId, key, items, labelOf){
  const box = $(boxId);
  if (!box) return;
  if (!items || !items.length){ box.innerHTML = '<span class="muted text-[length:var(--fs-xs)]">none</span>'; return; }
  box.innerHTML = items.map(it => {
    const v = it.v, on = lgSel[key].has(v) ? ' on' : '';
    return `<button class="lgchip${on}" data-facet="${key}" data-val="${esc(v)}" title="${esc(labelOf ? labelOf(it) : v)}">`
         + `${esc((labelOf ? labelOf(it) : v) || '—')}<span class="n">${fmt(it.n)}</span></button>`;
  }).join('');
}

// Human labels for the active-filter strip. Facet chip labels already apply
// short()/session-label truncation inside lgChips; duplicate the same rule
// here so a removable chip in the summary reads identically to its source.
function lgActiveLabel(key, v){
  if (key === 'model') return short(v);
  if (key === 'session'){
    const p = lgProfile();
    const hit = p && p.facets.session && p.facets.session.find(s => s.v === v);
    return (hit && hit.label) || v.slice(0, 8);
  }
  return v;
}
const LG_FACET_NAMES = {level:'Level', role:'Role', tool:'Tool', model:'Model',
                         session:'Session', kind:'Failure'};

function renderLgActive(){
  const bar = $('lgactive');
  if (!bar) return;
  const chips = [];
  for (const key of Object.keys(lgSel)){
    for (const v of lgSel[key]){
      chips.push(`<button type="button" class="lgactivechip" data-unfacet="${key}" data-val="${esc(v)}">`
        + `${esc(LG_FACET_NAMES[key] || key)}: ${esc(lgActiveLabel(key, v))}<span class="x">×</span></button>`);
    }
  }
  bar.classList.toggle('show', chips.length > 0);
  bar.innerHTML = '<span class="lbl muted text-[length:var(--fs-xs)]">Active</span>' + chips.join('');
}

function renderLogs(){
  const list = $('lglist');
  if (!list) return;
  if (logsLoading){ list.innerHTML = '<div class="muted text-[length:var(--fs-sm)]">Loading log events…</div>'; return; }
  if (logsErr){
    list.innerHTML = `<div class="muted text-[length:var(--fs-sm)]">Could not load logs-data.json (${esc(logsErr)}).`
      + ` Run <code>llm-telemetry logs</code>, and note that fetch is blocked when the page is opened from file://.</div>`;
    return;
  }
  const p = lgProfile();
  if (!p){ list.innerHTML = '<div class="muted text-[length:var(--fs-sm)]">No log events in this window.</div>'; return; }

  // Level facet is derived: errors come from errors.log, everything else is a
  // message row. Counting them here keeps the chip honest without a second query.
  const lvl = {};
  p.events.forEach(e => lvl[e.level] = (lvl[e.level]||0)+1);
  lgChips('lgf-level', 'level', Object.entries(lvl).map(([v,n])=>({v,n})).sort((a,b)=>b.n-a.n));
  lgChips('lgf-role', 'role', p.facets.role);
  lgChips('lgf-tool', 'tool', p.facets.tool);
  lgChips('lgf-model', 'model', (p.facets.model||[]).map(x=>({...x, v:x.v})), it=>short(it.v));
  lgChips('lgf-session', 'session', p.facets.session, it => it.label || it.v.slice(0,8));
  const kindRow = $('lgrow-kind');
  if (kindRow) kindRow.hidden = !(p.facets.kind && p.facets.kind.length);
  if (p.facets.kind) lgChips('lgf-kind', 'kind', p.facets.kind);
  renderLgActive();

  const rows = p.events.filter(e => lgMatch(e, p));
  $('lgcount').textContent = `${fmt(rows.length)} shown`;
  const badge = $('lgcountbadge');
  if (badge){
    const nActive = Object.values(lgSel).reduce((s, set) => s + set.size, 0);
    badge.hidden = nActive === 0;
    badge.textContent = `${nActive} filter${nActive === 1 ? '' : 's'} active`;
  }
  const cap = $('lgcap');
  if (cap){
    // The cap is disclosed, never hidden: the facet counts are computed over
    // the whole window, so they legitimately exceed the number of rows here.
    cap.hidden = !p.capped;
    cap.textContent = p.capped
      ? `· newest ${fmt(p.events_shown)} of ${fmt(p.events_total)} in the last ${p.window_h}h — filter counts cover the full window`
      : '';
  }
  $('lgscope').textContent = `last ${p.window_h}h · ${fmt(p.events_total)} events`;

  list.innerHTML = rows.slice(0, 1200).map((e,i) => {
    const t = new Date(e.ts*1000).toLocaleTimeString();
    const tag = e.level === 'error' ? (e.kind || 'error') : (e.tool || e.role);
    const cls = e.level === 'error' ? 'error' : e.role;
    const meta = [e.title, short(e.model||'')].filter(Boolean).join(' · ');
    return `<div class="lgev" data-i="${i}">`
      + `<span class="lgts">${t}</span>`
      + `<span class="lgtag ${cls}">${esc(tag)}</span>`
      + `<span class="lgmsg">${esc(e.preview||'')}`
      + (meta ? `<span class="lgmeta">${esc(meta)}</span>` : '') + `</span></div>`;
  }).join('') || '<div class="muted text-[length:var(--fs-sm)]">Nothing matches these filters.</div>';
  if (rows.length > 1200){
    list.insertAdjacentHTML('beforeend',
      `<div class="muted text-[length:var(--fs-xs)]" style="padding-top:6px">Showing the newest 1,200 of ${fmt(rows.length)} matches — narrow the filters to see more.</div>`);
  }
}

function logsInstall(){
  // Facet clicks toggle; delegated so re-rendered chips keep working.
  document.querySelector('[data-view="Logs"]')?.addEventListener('click', e => {
    const chip = e.target.closest('[data-facet]');
    if (chip){
      const k = chip.dataset.facet, v = chip.dataset.val;
      lgSel[k].has(v) ? lgSel[k].delete(v) : lgSel[k].add(v);
      renderLogs(); return;
    }
    // Removing from the active-filter summary strip does the same thing as
    // un-clicking the source chip, just reachable without scrolling to it.
    const unchip = e.target.closest('[data-unfacet]');
    if (unchip){
      lgSel[unchip.dataset.unfacet].delete(unchip.dataset.val);
      renderLogs(); return;
    }
    const win = e.target.closest('[data-win]');
    if (win){
      lgWindow = +win.dataset.win;
      document.querySelectorAll('[data-win]').forEach(b =>
        b.classList.toggle('on', b === win));
      renderLogs(); return;
    }
    // Clicking a row expands it: previews are one line by default so the list
    // stays scannable, but the full 120 chars must be readable without leaving.
    const row = e.target.closest('.lgev');
    if (row) row.classList.toggle('open');
  });
  $('lgq')?.addEventListener('input', e => { lgQ = e.target.value.trim().toLowerCase(); renderLogs(); });
  $('lgclear')?.addEventListener('click', () => {
    Object.values(lgSel).forEach(s => s.clear());
    lgQ = ''; const q = $('lgq'); if (q) q.value = '';
    renderLogs();
  });
  $('lgcsv')?.addEventListener('click', () => {
    const p = lgProfile(); if (!p) return;
    const rows = p.events.filter(e => lgMatch(e, p));
    // Quote every field: previews contain commas and quotes routinely.
    const q = s => '"' + String(s == null ? '' : s).replace(/"/g,'""') + '"';
    const csv = ['when,level,role,tool,model,session,title,preview']
      .concat(rows.map(e => [new Date(e.ts*1000).toISOString(), e.level, e.role,
        e.tool, e.model, e.session, e.title, e.preview].map(q).join(',')))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
    const a = document.createElement('a');
    a.href = url; a.download = 'log-events.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

// Wiring. Every close path the ticket names: scrim, Esc, nav activation, and
// crossing the breakpoint.
function navInstall(){
  document.getElementById('navcollapse')
    ?.addEventListener('click', () => navSetCollapsed(!document.body.classList.contains('navcollapsed')));
  document.getElementById('navtoggle')
    ?.addEventListener('click', () => navSetOpen(!navOpen));
  document.getElementById('navscrim')
    ?.addEventListener('click', () => navSetOpen(false));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && navOpen) navSetOpen(false);
    navTrap(e);
  });
  // Activating a section closes the panel: on mobile the content is what you
  // asked for, and leaving the sheet over it would hide the result.
  document.getElementById('navlist')?.addEventListener('click', e => {
    if (e.target.closest('[data-nav]') && navOpen) navSetOpen(false);
  });
  // Resizing past the breakpoint must not leave a scroll lock or a stuck
  // panel behind — the class is cleared whenever off-canvas stops applying.
  window.addEventListener('resize', () => {
    if (!isOffCanvas() && navOpen) navSetOpen(false);
    else if (!isOffCanvas()) document.body.classList.remove('navopen');
  });
  // Set the initial aria state for the current width.
  navSetOpen(false);
}
function views(){
  $('views').innerHTML=['Home','Live','Flow','Usage','Cost','Health','Detail','Logs','Settings']
    .map(v=>`<button data-vtab="${v}" onclick="pickView('${v}')" class="px-3 py-1 rounded-md border text-[length:var(--fs-sm)] taboff">${v}</button>`).join('');
}
function pickView(v){
  view=v;
  document.querySelectorAll('.view').forEach(el=>el.hidden = el.dataset.view!==v);
  document.querySelectorAll('[data-vtab]').forEach(b=>{
    const on=b.dataset.vtab===v;
    b.className='px-3 py-1 rounded-md border text-[length:var(--fs-sm)] '+(on?'tabon':'taboff');
  });
  localStorage.setItem('hermes-dash-view', v);
  setHash(v);
  setCrumb(v);
  navSync();
  render();
  // The logs payload is ~1.3 MB and most visits never open this view, so it
  // is fetched on first navigation rather than with the page.
  if (v === 'Logs') loadLogs();
  // Re-render the graph AFTER the view is unhidden: the force layout needs the
  // real wrapper size, and while the tab was hidden it measured 0 — which
  // collapsed every node into a single clump in the corner.
  if (v === 'Flow') requestAnimationFrame(() => {
    const p = DATA.profiles[current];
    const from = $('from').value, to = $('to').value;
    const inR = d => d && (!from || d>=from) && (!to || d<=to);
    renderFlow(p.rows.filter(r=>inR(r.date)));
  });
}
views();
logsInstall();
renderNav();
navInstall();
document.body.classList.add('hasnav');
navApplyCollapsed(navCollapsed());

// Prepend the merged "All" view so it is the default tab. Done before `current`
// is chosen so the page opens on the overview.
function installAll(){
  // #121: there is no synthetic "All" profile any more. The visible set is
  // the merge — pvFilter() builds it directly. Kept as a no-op alias because
  // three call sites (boot, doRefresh, pollLive) already invoke it; the
  // refresh/live paths re-filter through pvFilter() below.
}
// ---- Per-profile toggles (#121) --------------------------------------------
// Every profile tab is an on/off toggle chip. There is NO separate "All"
// tab: when every profile is on, the merge IS what "All" used to show. The
// choice is per-browser UI state (localStorage), not data — the profile is
// still collected regardless of visibility. Kept in one place so the boot
// path, the merge and the tab strip all consult it.
const PV_OFF = {};
function pvKey(n){ return 'llmtelemetry.profileVisibility.' + n; }
function pvOff(n){
  if (n in PV_OFF) return PV_OFF[n];
  let v = null;
  try { v = localStorage.getItem(pvKey(n)); } catch(e){}
  PV_OFF[n] = (v === 'off');
  return PV_OFF[n];
}
function pvSet(n, off){
  PV_OFF[n] = !!off;
  try { localStorage.setItem(pvKey(n), off ? 'off' : 'on'); } catch(e){}
}
function pvOnProfiles(){
  return Object.keys(PV_ALL).filter(n => !pvOff(n));
}
// #126: per-profile colour override, settable from the Settings page. Same
// pattern as pvOff/pvSet above — a per-browser UI preference in localStorage,
// not server data, because the hue is a display choice and every profile is
// still collected regardless of what colour it is drawn in. null/absent means
// "use the deterministic hashHue(name)" (the original, collision-avoiding
// default), so a user who never opens Settings sees exactly the old colours.
const PV_HUE = {};
function pvHueKey(n){ return 'llmtelemetry.profileHue.' + n; }
function pvHueOverride(n){
  if (n in PV_HUE) return PV_HUE[n];
  let v = null;
  try { v = localStorage.getItem(pvHueKey(n)); } catch(e){}
  const num = v === null ? null : Number(v);
  PV_HUE[n] = (num === null || !Number.isFinite(num)) ? null : ((num % 360) + 360) % 360;
  return PV_HUE[n];
}
function pvHueSet(n, deg){
  const v = (deg === null || deg === undefined) ? null : ((Math.round(deg) % 360) + 360) % 360;
  PV_HUE[n] = v;
  try {
    if (v === null) localStorage.removeItem(pvHueKey(n));
    else localStorage.setItem(pvHueKey(n), String(v));
  } catch(e){}
}
// The one function every profile-colour call site should use instead of
// hashHue(name) directly, so a Settings override actually reaches every chip,
// badge and lane dot that colours itself by profile.
function profileHue(n){
  const o = pvHueOverride(n);
  return o === null ? hashHue(n) : o;
}
// Full, unfiltered profile map — captured once at boot so a toggled-off
// profile can come back without refetching (DATA.profiles is the filtered set).
let PV_ALL = null;
function pvFilter(keep){
  // keep: null = everything on (boot). Rebuilds DATA.profiles from PV_ALL.
  // With 2+ profiles on the merged view is materialised as the 'All' DATA KEY
  // (the same merge the old "All" tab showed) and is what `current` points at
  // by default. That key is an implementation detail of the DATA shape — 19
  // call sites read DATA.profiles[current] — and is NOT rendered as a tab:
  // the tab strip shows only real profiles, as on/off chips (#121).
  // With exactly 1 profile on there is nothing to merge, so that profile's
  // own data is the view and no 'All' key exists.
  const on = Object.keys(PV_ALL).filter(n => !pvOff(n));
  const merged = {};
  on.forEach(n => { merged[n] = PV_ALL[n]; });
  if (on.length >= 2){
    const all = buildAll(Object.fromEntries(on.map(n => [n, PV_ALL[n]])));
    if (all) merged['All'] = all;
  }
  return merged;
}
// The view is DERIVED from the on-set, never picked independently (#121):
// 2+ profiles on -> the merged view (what "all on means all" promises);
// exactly 1 on -> that profile. There is no "look at one profile while
// others are on" state, because that is what the toggles are for.
function pvSyncCurrent(){
  current = ('All' in DATA.profiles) ? 'All'
          : (pvOnProfiles()[0] || Object.keys(DATA.profiles)[0]);
  return current;
}
// Toggle a profile on/off from its chip (left click) or its context menu.
// The last enabled profile cannot be turned off; the view then re-derives.
function pvToggle(n){
  if (pvOff(n)) { pvSet(n, false); }
  else if (pvOnProfiles().length <= 1){
    flash('At least one profile must stay visible.');
    return;
  } else { pvSet(n, true); }
  DATA.profiles = pvFilter();
  pvSyncCurrent();
  tabs(); pick(current);
}
function tabs(){
  // #121: toggle chips. Each profile is ALWAYS rendered (you can see every
  // profile and its state), coloured by its stable hashHue — ON is filled,
  // OFF is a dimmed outline of the same hue. No "All" chip: the merge is
  // what you see when everything is on, and the view always shows the
  // on-set's merge, so there is nothing for a separate tab to select.
  $('tabs').innerHTML=Object.keys(PV_ALL)
    .map(n=>{
      const h = profileHue(n);
      const off = pvOff(n);
      const st = off
        ? `style="background:transparent;color:hsl(${h} 45% 62%);border-color:hsl(${h} 40% 34%);opacity:.62"`
        : `style="background-color:hsl(${h} 62% 38%);color:#fff;border-color:hsl(${h} 70% 55%)"`;
      return `<button data-tab="${n}" data-off="${off?1:0}" onclick="pvToggle('${n}')"`
           + ` oncontextmenu="pvMenu(event,'${esc(n)}')" title="${off?'Off — click to turn on':'On — click to turn off'}"`
           + ` class="px-5 py-3 rounded-md border text-[length:var(--fs-lg)] taboff" ${st}>${n}</button>`;
    }).join('');
  // a compact "N/M on" readout so the merge's extent is stated, not implied
  const on = pvOnProfiles().length, tot = Object.keys(PV_ALL).length;
  const sub = $('tabsub');
  if (sub) sub.textContent = on === tot ? `all ${tot} shown` : `${on}/${tot} on`;
}
// Right-click a profile tab to toggle it (#119). A tiny menu explains what
// will happen and keeps the accidental-disabled-profile footgun Behind a
// deliberate click.
function pvMenu(ev, n){
  ev.preventDefault();
  const off = pvOff(n);
  const others = pvOnProfiles().length;
  if (!off && others <= 1 && pvOnProfiles()[0] === n){
    flash('At least one profile must stay visible.');
    return;
  }
  pvToggle(n);
}
installAll();
// Visibility filter (#121): PV_ALL captures the full set BEFORE removal, so
// toggling a profile back on restores its data without a refetch. The view is
// always the merge of the ON profiles — with everything on that merge is
// exactly what the old "All" tab used to show, so there is no All tab.
PV_ALL = Object.fromEntries(Object.entries(DATA.profiles).filter(([n]) => n !== 'All'));
DATA.profiles = pvFilter();
// Build the palette ONCE, from every model in every profile. Charts then look
// their colour up rather than deriving it, so a model keeps the same shade on
// every tab, in every date range and on both profiles.
COLORS = buildColors(allModelNames());
TOOLCOLORS = buildToolColors(allToolNames());
// Default to the merged view when it exists (all profiles on): that is the
// overview, and it is what "all on means all" promises. With a single profile
// on at boot there is no merge, so the profile itself is the view.
current = ('All' in DATA.profiles) ? 'All' : Object.keys(DATA.profiles)[0];
tabs();
renderResolution();
$('from').onchange=render; $('to').onchange=render;

const saved = localStorage.getItem('hermes-dash-theme');
if(saved==='light') document.documentElement.setAttribute('data-theme','light');
$('theme').onclick = () => {
  const light = document.documentElement.getAttribute('data-theme')==='light';
  if(light) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme','light');
  localStorage.setItem('hermes-dash-theme', light?'dark':'light');
  readTheme(); render();
};
pickView(viewFromHash() || view);
pick(current);

// Hide the preloader once the first render has actually painted. The rAF pair
// waits for the frame that contains the charts, so there is no flash of an
// empty page. The timeout is a safety net: a render error must never leave the
// user staring at a spinner forever.
function bootDone(){
  const b = $('boot');
  if (b && !b.classList.contains('gone')) {
    b.classList.add('gone');
    setTimeout(()=>b.remove(), 400);
  }
}
requestAnimationFrame(()=>requestAnimationFrame(bootDone));
setTimeout(bootDone, 4000);

async function doRefresh(silent){
  const b = $('refresh');
  if (b.dataset.busy) return;
  b.dataset.busy = '1'; if(!silent) b.style.opacity = '.5';
  try {
    const r = await fetch('analytics-data.json?t=' + Date.now(), {cache:'no-store'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const fresh = await r.json();
    const bad = schemaProblem(fresh, 'analytics-data.json');
    if (bad) { showSchemaError(bad); throw new Error(bad); }
    if (!fresh.profiles || !Object.keys(fresh.profiles).length) throw new Error('empty payload');
    const keepFrom = $('from').value, keepTo = $('to').value, keepProfile = current;
    DATA = fresh;
    // #121: re-filter through the ON set (this also rebuilds the merge).
    // installAll() alone would put the raw profile map back and lose the
    // toggles; pvFilter() reads PV_ALL, which the capture below refreshes.
    PV_ALL = Object.fromEntries(Object.entries(DATA.profiles).filter(([n]) => n !== 'All'));
    DATA.profiles = pvFilter();
    // A model can appear for the first time in a refresh; recompute the global
    // palette so it gets a stable shade instead of the grey fallback.
    COLORS = buildColors(allModelNames());
    TOOLCOLORS = buildToolColors(allToolNames());
    tabs();
    renderResolution();
    // keep the user where they were: the same profile if it is still shown,
    // else the merge, else whatever is left.
    pick(DATA.profiles[keepProfile] ? keepProfile
       : ('All' in DATA.profiles ? 'All' : Object.keys(DATA.profiles)[0]));
    // restore the range the user was looking at, when it is still in bounds
    if (keepFrom) $('from').value = keepFrom;
    if (keepTo) $('to').value = keepTo;
    render();
  } catch (e) {
    $('meta').textContent = 'refresh failed: ' + e.message + ' — showing last good data';
  } finally {
    b.dataset.busy = ''; b.style.opacity = '';
  }
}
$('refresh').onclick = () => doRefresh(false);

// ---- fast live polling -------------------------------------------------
// Live data is the one thing that is genuinely "now", so it gets its own tiny
// endpoint (~2 KB, 56 ms to build) polled every 5s, independent of the 60s
// full refresh. Only the Live view's data is swapped, so cost/usage charts are
// never rebuilt by a live tick.
const LIVE_MS = 5000;
let liveBusy = false, liveFails = 0;

// ---- Completion sound (#105) -----------------------------------------------
// Off by default (localStorage remembers the choice), generated with Web
// Audio so there is no audio file to ship (the dashboard is one
// self-contained HTML page, ADR 0001). Browsers block audio until a user
// gesture, so turning it on is itself the gesture -- no separate unlock step
// is needed or possible.
let soundOn = localStorage.getItem('lt-sound') === '1';
let audioCtx = null;
let soundBaseline = true;   // true until the first poll has been diffed once
let seenEnded = new Set();  // session ids already sounded for, across polls
let seenDeleg = new Set();  // delegation ids already sounded for
let soundDebounceUntil = 0;

function ensureAudioCtx(){
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Two short, distinct tones: a rising two-note chime for success, a single
// lower note for failure. Both are quiet (gain 0.06) and under 300ms so a
// burst of completions does not read as an alarm.
function playTone(kind){
  if (!soundOn) return;
  // Sound is most useful when you are not looking at the tab; still allowed
  // when visible (some users want it either way), but never on a baseline
  // snapshot or a profile switch -- those are not real completions.
  const ctx = ensureAudioCtx();
  const now = ctx.currentTime;
  const notes = kind === 'success' ? [880, 1174.66] : [220];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    const t0 = now + i * 0.09;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.06, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + 0.16);
  });
}

// Debounce: several completions inside one poll, or across polls within 2s,
// play as a single tone rather than a burst. `kind` escalates to 'fail' if
// anything in the batch failed, even if most succeeded. A prior version
// returned early once inside the 2s window WITHOUT scheduling a play, which
// silently dropped a completion that arrived mid-window instead of merging
// it into the next tone -- fixed by always scheduling, timed to fire no
// sooner than the window allows.
let pendingKind = null;
let soundTimerPending = false;
function scheduleTone(kind){
  if (kind === 'fail') pendingKind = 'fail';
  else if (!pendingKind) pendingKind = 'success';
  if (soundTimerPending) return;   // a play is already queued; it will pick up any escalation
  soundTimerPending = true;
  const wait = Math.max(0, soundDebounceUntil - Date.now());
  setTimeout(() => {
    if (pendingKind) playTone(pendingKind);
    pendingKind = null;
    soundTimerPending = false;
    soundDebounceUntil = Date.now() + 2000;
  }, wait);
}

// Diff recent_ended / recent_delegations against what has already sounded.
// Runs on every poll for every profile that was fetched, not just the one
// showing, so a completion in a background profile is never missed.
function checkCompletions(freshProfiles){
  let any = false;
  Object.values(freshProfiles).forEach(f => {
    (f.recent_ended || []).forEach(s => {
      if (seenEnded.has(s.id)) return;
      seenEnded.add(s.id);
      if (soundBaseline) return;
      any = true;
      const bad = /orphan_reap|error/i.test(s.end_reason || '');
      scheduleTone(bad ? 'fail' : 'success');
    });
    (f.recent_delegations || []).forEach(d => {
      if (seenDeleg.has(d.id)) return;
      seenDeleg.add(d.id);
      if (soundBaseline) return;
      any = true;
      scheduleTone(d.state === 'error' ? 'fail' : 'success');
    });
  });
  return any;
}

function soundToggleInstall(){
  const btn = $('soundtoggle');
  if (!btn) return;
  // Expose the module-scope `let` bindings on window: they are plain lexical
  // vars (not properties), so a test harness driving pollLive() directly
  // needs a live view of them, not a snapshot taken at install time.
  Object.defineProperty(window, 'soundOn', { get: () => soundOn, set: v => { soundOn = v; } });
  Object.defineProperty(window, 'soundBaseline', { get: () => soundBaseline, set: v => { soundBaseline = v; } });
  Object.defineProperty(window, 'seenEnded', { get: () => seenEnded, set: v => { seenEnded = v; } });
  Object.defineProperty(window, 'seenDeleg', { get: () => seenDeleg, set: v => { seenDeleg = v; } });
  const paint = () => {
    btn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    btn.classList.toggle('on', soundOn);
    btn.innerHTML = soundOn ? '&#128266;' : '&#128263;';
  };
  paint();
  btn.addEventListener('click', () => {
    soundOn = !soundOn;
    localStorage.setItem('lt-sound', soundOn ? '1' : '0');
    if (soundOn) { ensureAudioCtx(); playTone('success'); }
    paint();
  });
}


// ---- Logs drawer ---------------------------------------------------------
// One chronological feed merging two sources: model failures parsed from
// errors.log, and tool events from the live sessions. Kept out of the tab
// system on purpose — a log you can only reach by changing tabs is not a log.
let dFilter = 'all', dSeen = 0, dOpen = false, dScrollY = 0, dHistoryPushed = false;

// Log lines are raw provider output — they can contain angle brackets and
// quotes, so they must never be interpolated into innerHTML unescaped.

function drawerEvents(){
  const ev = [];
  (DATA.errors || []).forEach(e => ev.push({
    ts: e.ts * 1000, level: 'error', kind: e.kind,
    model: e.model || '', profile: e.profile || '',
    text: e.msg || '',
  }));
  Object.entries(DATA.profiles || {}).forEach(([pn, p]) => {
    if (pn === 'All') return;   // already counted under its real profile
    (p.logs || []).forEach(l => {
      if (!l.tool) return;      // plain assistant text is noise here
      ev.push({
        ts: l.ts * 1000, level: 'tool', kind: 'tool',
        model: '', profile: pn,
        // Carry the tool name as its own field so the drawer can colour it;
        // baking it into `text` made it unstylable.
        tool: l.tool,
        text: (l.title || 'untitled').slice(0, 52),
      });
    });
  });
  // Summary only (#104). The drawer answers "anything I should look at right
  // now"; the Logs view answers "find the thing that happened". Routine
  // read-only tool chatter is dropped here so failures cannot be buried by it
  // — read_file/search_files alone are ~48k of the last 24h.
  const NOISE = new Set(['read_file','search_files','skill_view','tool_describe',
                         'tool_search','web_search','web_extract']);
  const notable = ev.filter(e => e.level === 'error' || !NOISE.has(e.tool || ''));
  return notable.sort((a, b) => b.ts - a.ts).slice(0, 120);
}

function drawerSync(){
  const all = drawerEvents();
  const errs = all.filter(e => e.level === 'error');

  // Unread badge: only failures are worth interrupting for.
  const unread = dOpen ? 0 : Math.max(0, errs.length - dSeen);
  for (const bid of ['logn','logn2']){
    const badge = $(bid);
    if (badge){ badge.textContent = unread; badge.hidden = unread === 0; }
  }

  const body = $('dbody');
  if (!body) return;
  const rows = all.filter(e => dFilter === 'all' || e.level === dFilter);
  const stick = $('dauto')?.checked;
  const atTop = body.scrollTop < 40;

  body.innerHTML = rows.length ? rows.map(e => {
    const t = new Date(e.ts).toLocaleTimeString([], {hour12:false});
    const who = e.model ? `<span class="evm" style="color:${colorOf(short(e.model))}">${short(e.model)}</span> ` : '';
    // Tool events get the tool's own palette colour, same contract as models.
    const twho = e.tool ? `<span class="evt" style="color:${toolColor(e.tool)}">${esc(e.tool)}</span> ` : '';
    const pf = e.profile ? `<span class="muted">[${e.profile}]</span> ` : '';
    return `<div class="ev ${e.level==='error'?'err':''}">
      <span class="t">${t}</span>
      <span class="b"><span class="k k-${e.kind}">${e.kind.replace('_',' ')}</span>${pf}${who}${twho}${esc(e.text)}</span>
    </div>`;
  }).join('') : `<div class="muted" style="padding:18px 15px">No events in the last 2 hours.</div>`;

  const c = $('dcount');
  if (c) c.textContent = `${rows.length} events · ${errs.length} failures`;
  const s = $('dstamp');
  if (s) s.textContent = 'updated ' + new Date().toLocaleTimeString();
  // Newest is at the top, so "follow" means stay pinned to the top.
  if (stick && atTop) body.scrollTop = 0;
}

function drawerOpen(on){
  dOpen = on;
  $('drawer')?.classList.toggle('open', on);
  $('scrim')?.classList.toggle('open', on);
  $('drawer')?.setAttribute('aria-hidden', String(!on));
  $('logbtn')?.classList.toggle('hidden', on);
  // #17: body scroll locked while the sheet/drawer is open, restored exactly
  // on close (remembers the real scroll position, not just 0).
  if (on){
    dScrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${dScrollY}px`;
    document.body.style.width = '100%';
  } else if (document.body.style.position === 'fixed') {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, dScrollY);
  }
  // #17: push a history state when opening so Android/gesture back closes
  // the sheet instead of leaving the page; pop it (without re-navigating)
  // when closing any other way so back/forward stays in sync.
  if (on && !dHistoryPushed) {
    history.pushState({ llmtDrawer: true }, '');
    dHistoryPushed = true;
  } else if (!on && dHistoryPushed) {
    dHistoryPushed = false;
    if (history.state && history.state.llmtDrawer) history.back();
  }
  if (on){
    dSeen = (DATA.errors || []).length;   // mark failures as read
    drawerSync();
  }
}
window.addEventListener('popstate', () => {
  if (dOpen) drawerOpen(false);
});

// #17: drag-down-to-close on the handle (and the header, so a stray tap
// just below the handle still works) — touch AND mouse via Pointer Events.
function installDrawerDrag(){
  const sheet = $('drawer'), handle = $('draghandle');
  if (!sheet || !handle) return;
  let startY = null, startTransform = 0, dragging = false;
  const onDown = e => {
    if (window.innerWidth > 640) return; // only a bottom sheet at mobile width
    dragging = true; startY = e.clientY; startTransform = 0;
    sheet.style.transition = 'none';
    handle.setPointerCapture?.(e.pointerId);
  };
  const onMove = e => {
    if (!dragging || startY === null) return;
    const dy = Math.max(0, e.clientY - startY);
    startTransform = dy;
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    sheet.style.transform = '';
    // Past a quarter of the sheet's own height counts as "let go of it".
    if (startTransform > sheet.offsetHeight * 0.25) drawerOpen(false);
    startY = null;
  };
  handle.addEventListener('pointerdown', onDown);
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
}

function installDrawer(){
  installDrawerDrag();
  $('logbtn')?.addEventListener('click', () => drawerOpen(!dOpen));
  // The header "Logs" chip was removed (#116): the floating edge tab and the
  // nav drawer button are the entry points. Optional-chained handlers, so the
  // markup stays the single source of truth for which controls exist.
  $('logbtn2')?.addEventListener('click', () => drawerOpen(!dOpen));
  $('navdrawerbtn')?.addEventListener('click', () => drawerOpen(!dOpen));
  // The drawer's "All logs" link hands off to the full view: close the panel,
  // then navigate, so the page you asked for is not sitting behind a sheet.
  $('dfull')?.addEventListener('click', e => {
    e.preventDefault();
    drawerOpen(false);
    pickView('Logs');
  });
  $('dclose')?.addEventListener('click', () => drawerOpen(false));
  $('scrim')?.addEventListener('click', () => drawerOpen(false));
  // The Health tab's failure panel and this drawer are both summaries; the
  // Logs view is the searchable record.
  $('tolog')?.addEventListener('click', () => drawerOpen(true));
  document.querySelectorAll('.dtab').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.dtab').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    dFilter = b.dataset.f;
    drawerSync();
  }));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && dOpen) drawerOpen(false);
    // Plain "l" toggles, but not while typing in the date inputs.
    if (e.key === 'l' && !/input|textarea/i.test(e.target.tagName)) drawerOpen(!dOpen);
  });
}

async function pollLive(){
  // The drawer is reachable from every tab, so the feed must keep running even
  // when Live is not on screen. Only a hidden document stops it.
  if (liveBusy || document.hidden) return;
  liveBusy = true;
  try {
    const r = await fetch('live-data.json?t=' + Date.now(), {cache:'no-store'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const fresh = await r.json();
    // Version check is NOT a transient miss: say so on the first poll, not the third.
    const bad = schemaProblem(fresh, 'live-data.json');
    if (bad) { liveFails = 2; throw new Error(bad); }
    if (!fresh.profiles) throw new Error('empty payload');
    // Diff for completions BEFORE merging into DATA -- once merged there is
    // no "previous" state left to compare against. First call ever is a
    // baseline (soundBaseline stays true through it): every open session and
    // delegation is "recent" on a page load, and none of that is a real
    // completion the user should hear about.
    checkCompletions(fresh.profiles);
    soundBaseline = false;
    // Merge the live slice into each profile in place, then rebuild the
    // synthetic All profile so its merged live list stays correct.
    Object.keys(fresh.profiles).forEach(n => {
      if (!DATA.profiles[n]) return;
      const f = fresh.profiles[n];
      DATA.profiles[n].live = f.live;
      DATA.profiles[n].active = f.active;
      DATA.profiles[n].tools_recent = f.tools_recent;
      DATA.profiles[n].logs = f.logs;
    });
    DATA.errors = fresh.errors || [];
    // Fleet telemetry is global (not per-profile): both profiles share the
    // same two GPU boxes, so it hangs off DATA, not DATA.profiles[n].
    DATA.ollama = fresh.ollama || DATA.ollama;
    // #121: re-apply the ON set. The live slice was merged INTO PV_ALL's
    // profiles above, so re-filtering keeps the toggles honoured while the
    // merge picks up the fresh live rows.
    PV_ALL = Object.fromEntries(
      Object.entries(PV_ALL).map(([n, p]) => [n, DATA.profiles[n] || p]));
    DATA.profiles = pvFilter();
    tabs();
    drawerSync();
    // Repaint unconditionally. This used to be `if (view === 'Live')`, which
    // left the live list and the bandwidth card holding the first payload
    // whenever any other tab was open — the numbers silently went stale, and
    // switching back showed a jump rather than a live feed. renderLive writes
    // into hidden nodes cheaply, so there is no reason to gate it on the view.
    renderLive();
    navSync();
    // Update only the "In progress" KPI in place — the other cards depend on
    // date-filtered aggregates the live feed does not carry, so a full KPI
    // rebuild here would show wrong numbers.
    const p = DATA.profiles[current] || {};
    const card = document.querySelector('#kpis .kpi-live');
    if (card) card.innerHTML = p.active
      ? `<span style="color:#22c55e">●</span> ${p.active}`
      : `<span class="muted">●</span> 0`;
    liveFails = 0;
    const t = $('livestamp');
    if (t) t.textContent = 'live · updated ' + new Date().toLocaleTimeString();
  } catch (e) {
    // Fail quietly: a transient miss must not blank the panel the user is
    // watching. Only a sustained outage is worth reporting.
    if (++liveFails === 3) {
      const t = $('livestamp');
      if (t) t.textContent = 'live feed stalled — ' + e.message;
    }
  } finally {
    liveBusy = false;
  }
}
setInterval(pollLive, LIVE_MS);
installDrawer();
soundToggleInstall();
settingsInstall();
pollLive();   // populate the drawer before the first 5s tick
document.addEventListener('visibilitychange', () => { if(!document.hidden) pollLive(); });

// Poll in place every 60s. A full location.reload() would throw away the
// selected tab, profile and date range mid-read; this swaps the data only.
setInterval(() => { if(!document.hidden) doRefresh(true); }, 60000);
// catch up immediately when the tab comes back to the foreground
document.addEventListener('visibilitychange', () => { if(!document.hidden) doRefresh(true); });
</script></body></html>
"""

from . import energy as _E


def _shown_path(f):
    """A path fit to embed in a page: relative to the working directory when
    inside it (the sample build), else with the home directory as ~. An
    absolute home path must never reach the HTML."""
    if not f:
        return ""
    f = os.path.abspath(f)
    cwd = os.getcwd()
    if f.startswith(cwd + os.sep):
        return os.path.relpath(f, cwd)
    home = os.path.expanduser("~")
    return "~" + f[len(home):] if f.startswith(home + os.sep) else os.path.basename(f)


from .pricing import ttl_label as _ttl_label
_kwh, _gw, _hw = _E.tariff(CFG)
# Defaults come from the Config dataclass itself, so the page's "Defaults"
# button can never disagree with what an unconfigured install uses.
from .config import Config as _Config
_d = _Config()
POWER = {"tariff": {"electricity_rate_kwh": _kwh, "gpu_draw_watts": _gw, "host_overhead_watts": _hw},
         "defaults": {"electricity_rate_kwh": _d.electricity_rate_kwh,
                      "gpu_draw_watts": _d.gpu_draw_watts,
                      "host_overhead_watts": _d.host_overhead_watts},
         "tps": _E.LOCAL_TPS, "tps_default": _E.LOCAL_TPS_DEFAULT,
         "prefill": _E.PREFILL_SPEEDUP, "cachex": _E.CACHE_SPEEDUP,
         "config_file": _shown_path((CFG.resolution or {}).get("config_file", ""))}
html = (HEAD.replace("__PRICE_TTL__", _ttl_label()) + JS.replace("__DATA__", json.dumps(data, default=str))
        .replace("__POWER__", json.dumps(POWER))
        .replace("__LOCAL_HOSTS__", json.dumps(CFG.local_host_patterns))
        .replace("__SCHEMA_VERSION__", str(SCHEMA_VERSION)))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w").write(html)
print(f"{OUT}  ({len(html):,} bytes)")
