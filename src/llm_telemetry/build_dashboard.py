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
data = json.load(open(DATA))
data["router"] = json.load(open(CFG.reports_dir / "router-data.json"))["profiles"]

HEAD = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LLM Telemetry</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%236366f1'/%3E%3Cg fill='%23fff'%3E%3Crect x='7' y='17' width='4' height='9' rx='1'/%3E%3Crect x='14' y='11' width='4' height='15' rx='1'/%3E%3Crect x='21' y='6' width='4' height='20' rx='1'/%3E%3C/g%3E%3C/svg%3E">
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
 [hidden]{display:none !important}
 .rounded-md{border-radius:4px !important}
 .chip{border:1px solid var(--border);border-radius:4px;padding:6px 12px;font-size:13px;
       cursor:pointer;color:var(--muted);user-select:none;white-space:nowrap}
 .chip:hover{color:var(--fg);border-color:var(--accent)}
 input[type=date]{background:var(--bg);border:1px solid var(--border);border-radius:4px;
   padding:6px 10px;font-size:13px;color:var(--fg);color-scheme:dark}
 [data-theme=light] input[type=date]{color-scheme:light}
 canvas{width:100% !important;max-height:280px}
 table{font-variant-numeric:tabular-nums;border-collapse:collapse;width:100%}
 tbody tr:hover{background:color-mix(in srgb,var(--accent) 7%,transparent)}
 .kpi{font-size:clamp(18px,2vw,26px);font-weight:600;letter-spacing:-.02em}
 .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
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
  color:var(--muted); font-size:13px; line-height:1.2;
  border-left:2px solid transparent; text-decoration:none;
}
.navitem:hover{ background:color-mix(in srgb, var(--accent) 10%, transparent); color:var(--fg); }
.navitem:focus-visible{ outline:2px solid var(--accent); outline-offset:1px; }
/* Active item: accent bar plus accent text, so it reads as "you are here"
   without relying on colour alone. */
.dkpis{display:flex;gap:18px;flex-wrap:wrap}
.dkpi{display:flex;flex-direction:column;gap:2px}
.dkpi-n{font-size:17px;font-weight:600}
.dkpi-n.ok{color:var(--z-ok-fg)}
.dkpi-n.bad{color:var(--z-bad-fg)}
.drow{display:grid;grid-template-columns:minmax(90px,1.1fr) minmax(60px,2fr) 42px minmax(90px,1fr);
  align-items:center;gap:8px;font-size:11px}
.dname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dbar{height:6px;border-radius:3px;background:color-mix(in srgb,var(--fg) 12%,transparent);overflow:hidden}
.dbar span{display:block;height:100%;border-radius:3px}
.dbar span.ok{background:var(--z-ok)}
.dbar span.bad{background:var(--z-bad)}
.dpct{text-align:right;font-variant-numeric:tabular-nums}
.dpct.ok{color:var(--z-ok-fg)}
.dpct.bad{color:var(--z-bad-fg)}
.dmeta{font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ditem{display:grid;grid-template-columns:8px 1fr auto;align-items:center;gap:8px;
  padding:3px 0;border-bottom:1px solid var(--border)}
.ditem:last-child{border-bottom:0}
.ddot{width:6px;height:6px;border-radius:50%}
.ddot.ok{background:var(--z-ok)}
.ddot.bad{background:var(--z-bad)}
.dgoal{font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:720px){.drow{grid-template-columns:minmax(80px,1fr) 1fr 40px}.dmeta{display:none}}
.navitem[aria-current="page"]{
  color:var(--accent); border-left-color:var(--accent);
  background:color-mix(in srgb, var(--accent) 14%, transparent);
  font-weight:600;
}
.navitem .nvico{ width:16px; text-align:center; flex:0 0 16px; font-size:13px; }
.navitem .nvlabel{ flex:1 1 auto; min-width:0; }
/* Counts ride on the right; hidden when zero so the rail stays quiet. */
.navitem .nvbadge{
  flex:0 0 auto; font-size:10px; padding:1px 6px; border-radius:999px;
  background:color-mix(in srgb, var(--accent) 22%, transparent); color:var(--accent);
}
#navdrawer .navsep{ height:1px; background:var(--border); margin:10px 6px; }

/* The rail is the nav at every width now (#4), so the chip strip is redundant
   everywhere rather than only on desktop. */
body.hasnav #views{ display:none; }
/* ---- Live row: models used (#107) ---- */
.lmhead{display:flex;align-items:center;gap:6px;font-size:9.5px;text-transform:uppercase;
  letter-spacing:.04em;margin-bottom:5px}
.lmmet{background:none;border:1px solid var(--border);color:var(--muted);cursor:pointer;
  border-radius:999px;padding:1px 7px;font:inherit;font-size:9.5px;text-transform:uppercase}
.lmmet.on{border-color:var(--accent);color:var(--accent);
  background:color-mix(in srgb,var(--accent) 16%,transparent)}
.lmbar{display:flex;height:9px;border-radius:5px;overflow:hidden;background:var(--bg);
  border:1px solid var(--border)}
.lmseg{display:block;height:100%;min-width:2px}
.lmseg:hover{filter:brightness(1.25)}
.lmlegend{display:flex;flex-wrap:wrap;gap:4px 12px;margin:5px 0 7px;font-size:10px}
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
.lmpanel table{width:100%;border-collapse:collapse;font-size:11px}
.lmpanel th{text-align:left;font-weight:500;color:var(--muted);font-size:9.5px;
  text-transform:uppercase;letter-spacing:.04em;padding:2px 8px 4px 0}
.lmpanel td{padding:3px 8px 3px 0;white-space:nowrap;border-top:1px solid var(--border)}
.lmpanel .num{text-align:right;font-variant-numeric:tabular-nums}
/* ---- Logs page (#104) ------------------------------------------------- */
.lgfacets{display:flex;flex-direction:column;gap:6px}
.lgrow{display:flex;align-items:flex-start;gap:10px}
.lglbl{flex:0 0 62px;font-size:10px;text-transform:uppercase;letter-spacing:.06em;
  color:var(--muted);padding-top:4px}
.lgchips{display:flex;gap:5px;flex-wrap:wrap;flex:1 1 auto;min-width:0}
.lgchip{border:1px solid var(--border);background:var(--bg);color:var(--muted);
  border-radius:999px;padding:2px 9px;font-size:11px;cursor:pointer;line-height:1.6;
  white-space:nowrap;max-width:280px;overflow:hidden;text-overflow:ellipsis}
.lgchip:hover{border-color:var(--accent);color:var(--fg)}
.lgchip.on{background:color-mix(in srgb,var(--accent) 18%,transparent);
  border-color:var(--accent);color:var(--accent);font-weight:600}
.lgchip .n{opacity:.65;margin-left:5px;font-variant-numeric:tabular-nums}
/* Event rows: monospace timestamps so they form a readable column. */
.lgev{display:grid;grid-template-columns:70px 66px 1fr;gap:9px;align-items:baseline;
  padding:4px 0;border-bottom:1px solid var(--border);font-size:11.5px}
.lgev:last-child{border-bottom:0}
.lgts{color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px}
.lgtag{font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lgtag.error{color:var(--z-bad-fg);font-weight:700}
.lgtag.tool{color:var(--accent)}
.lgtag.assistant{color:var(--z-ok-fg)}
.lgtag.user{color:var(--muted)}
.lgmsg{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lgev.open .lgmsg{white-space:pre-wrap;word-break:break-word}
.lgmeta{color:var(--muted);font-size:10px;margin-left:6px}
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
  color:var(--muted); font-size:14px; line-height:1; padding:4px 6px;
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
  font-size:11px; color:var(--fg); opacity:0; pointer-events:none;
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
 .bwarrow{font-size:13px;line-height:1;font-weight:700}
 .bwup{color:#f59e0b}      /* upload: the dominant direction here */
 .bwdown{color:#38bdf8}
 .bwrate{font-size:9px;letter-spacing:.02em}
 /* A running worker gets a moving arrow, so "is it transferring right now"
    is answerable without reading numbers. Paused when the OS asks for less
    motion — a permanently pulsing row is an accessibility problem. */
 @keyframes bwpulse{0%,100%{opacity:.35;transform:translateY(1px)}
   50%{opacity:1;transform:translateY(-1px)}}
 .bwlive .bwarrow{animation:bwpulse 1.1s ease-in-out infinite}
 .bwlive .bwarrow.bwdown{animation-delay:.55s}
 @media(prefers-reduced-motion:reduce){.bwlive .bwarrow{animation:none}}
 /* Preloader */
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
 .navsec{font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;
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
 .navico{width:20px;flex:none;text-align:center;font-size:14px;line-height:1}
 .navlbl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .navbadge{margin-left:auto;font-size:9px;font-weight:700;padding:1px 6px;
   border-radius:999px;background:var(--border);color:var(--fg);flex:none;
   font-variant-numeric:tabular-nums}
 .navbadge.alert{background:#ef4444;color:#fff}
 .navbadge[hidden]{display:none}
 .navsep{height:1px;background:var(--border);margin:8px 12px;flex:none}
 .navfoot{margin-top:auto;padding:10px 12px;font-size:9.5px;color:var(--muted)}
 #navpin{margin-left:auto;background:none;border:none;color:var(--muted);
   cursor:pointer;font-size:13px;line-height:1;padding:2px 4px}
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
   font-size:16px;line-height:1;flex:none}
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
   display:flex;align-items:center;justify-content:center;font-size:16px;
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
 .loe .needle{transform-origin:32px 34px;
   animation:needle-tremor var(--spd) ease-in-out infinite}
 .loe{display:inline-flex;align-items:center;line-height:0}
 /* One keyframe for every gauge; each card sets --d (target angle), --amp
    (tremor size) and --spd (tremor period) inline. */
 @keyframes needle-tremor{
   0%  {transform:rotate(calc(var(--d) - var(--amp)))}
   50% {transform:rotate(calc(var(--d) + var(--amp)))}
   100%{transform:rotate(calc(var(--d) - var(--amp)))}
 }

 /* Activity heatmap — GitHub-style calendar. Fixed cell size with horizontal
    scroll beats squeezing 26 weeks into a phone width. */
 /* The calendar stretches to consume the full card width: week columns share
    the space equally (flex:1) and cells stay square via aspect-ratio, instead
    of being fixed at 13px and leaving dead space on a wide screen. */
 .hm-scroll{padding-bottom:3px;width:100%}
 .hm-months{display:flex;gap:3px;margin-bottom:3px;padding-left:1px;width:100%}
 .hm-mon{flex:1 1 0;min-width:0;font-size:9px;color:var(--muted);letter-spacing:.02em}
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
 .hm-key{display:flex;align-items:center;gap:3px;margin-top:7px;font-size:9px;flex-wrap:wrap}
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
   color:var(--muted);width:24px;height:24px;border-radius:50%;font-size:13px;
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
 .hpt{font-size:16px;font-weight:700;margin-bottom:3px}
 .hpsub{font-size:11px;color:var(--muted);margin-bottom:16px}
 .hsec{margin:16px 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;
   letter-spacing:.06em;color:var(--muted)}
 .hnote{font-size:11.5px;color:var(--muted);margin:5px 0 9px;line-height:1.55}
 /* Each hop is a numbered row so the ORDER is unmistakable. */
 .hhop{display:flex;align-items:center;gap:9px;padding:6px 9px;border-radius:7px;
   border:1px solid var(--border);margin-bottom:5px;font-size:12px;background:var(--bg)}
 .hnum{width:19px;height:19px;border-radius:50%;flex:none;display:flex;
   align-items:center;justify-content:center;font-size:9.5px;font-weight:700;
   background:var(--border);color:var(--muted)}
 .hhop.primary .hnum{background:hsl(142 65% 45%);color:#04140a}
 .hmodel{font-size:13px;font-weight:600}
 .hurl{font-size:9.5px;color:var(--muted);margin-left:auto;font-family:ui-monospace,monospace}
 .harrow{color:var(--muted);font-size:13px;text-align:center;margin:1px 0}
 .htask{display:flex;align-items:baseline;gap:8px;padding:5px 0;
   border-bottom:1px dashed var(--border);font-size:12px}
 .htn{width:132px;flex:none;font-weight:600;font-size:11.5px}
 .htd{color:var(--muted);font-size:10.5px;flex:1}
 #helpclose{position:absolute;top:13px;right:15px;cursor:pointer;color:var(--muted);
   font-size:19px;line-height:1;background:none;border:none}
 #helpclose:hover{color:var(--fg)}
 #heatcard[hidden]{display:none}

 /* ---- Flow graph (Provider -> model -> task) -------------------------
    Force-directed, rendered as plain SVG. No d3: the layout is ~100 nodes,
    so a small velocity-Verlet loop is cheaper than shipping a library. */
 #flowwrap{position:relative;width:100%;height:calc(100vh - 250px);
   height:calc(100dvh - 250px);min-height:460px}
 #flow{width:100%;height:100%;display:block;cursor:grab}
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
 #flow .nd text{font-size:9px;fill:var(--muted);pointer-events:none;
   text-anchor:middle;paint-order:stroke;stroke:var(--card);stroke-width:2.5px}
 #flow .nd.root text,#flow .nd.prov text{font-size:11px;font-weight:600;fill:var(--fg)}
 #flow .nd.model text{font-size:10px;font-weight:600}
 /* Dim everything except the hovered subtree — with ~100 nodes the eye needs
    help following one provider's branch. */
 #flow.focus .nd,#flow.focus .lnk{opacity:.13}
 #flow.focus .nd.on,#flow.focus .lnk.on{opacity:1}
 .flowtip{position:absolute;pointer-events:none;opacity:0;transition:opacity .1s;
   background:var(--card);border:1px solid var(--border);border-radius:6px;
   padding:7px 10px;font-size:11px;box-shadow:0 8px 24px rgba(0,0,0,.45);z-index:5;
   max-width:260px}
 .flowtip.on{opacity:1}
 .flowtip .ft-h{font-weight:600;font-size:12px;margin-bottom:3px}
 .flowtip .ft-r{display:flex;justify-content:space-between;gap:14px;color:var(--muted)}
 .flowtip .ft-r b{color:var(--fg);font-weight:600}
 .flowctl{float:right;display:flex;gap:4px;align-items:center}
 .flowctl button{font-size:10px;text-transform:none;letter-spacing:0;
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
 .olname{font-size:14px;font-weight:600}
 /* Same inline-element trap as .olfill: <i> needs an explicit display or its
    width/height are ignored (the dot only looked right because of its ring). */
 .oldot{display:block;width:8px;height:8px;border-radius:50%;flex:none}
 .oldot.up{background:hsl(142 70% 45%);box-shadow:0 0 0 3px hsl(142 70% 45% / .18)}
 .oldot.down{background:hsl(0 72% 55%);box-shadow:0 0 0 3px hsl(0 72% 55% / .18)}
 /* "local" badge: same glyph + tint as the local provider badge elsewhere. */
 .olbadge{font-size:9.5px;padding:1px 6px;border-radius:4px;font-weight:600;
   background:hsl(196 88% 55% / .16);color:hsl(196 88% 60%);flex:none}
 .olver{font-size:9.5px;color:var(--muted);margin-left:auto;flex:none}
 .olurls{font-size:9.5px;color:var(--muted);margin:-4px 0 8px 0;word-break:break-all}
 /* Load bars. Colour is a judgement (green/amber/red), not decoration: it is
    the only thing that reads at a glance from across the room. */
 .olrow{display:flex;align-items:center;gap:7px;margin:5px 0;font-size:11px}
 .ollbl{width:74px;flex:none;color:var(--muted);font-size:10px}
 .olbar{flex:1;height:7px;border-radius:4px;background:var(--border);overflow:hidden;min-width:40px}
 /* display:block is REQUIRED: <i> defaults to display:inline, and inline
    non-replaced elements ignore width/height entirely — the fill rendered as a
    0x0 box, so every bar looked empty no matter what value it carried. */
 .olfill{display:block;height:100%;border-radius:4px;transition:width .45s ease}
 .olfill.good{background:hsl(142 65% 45%)}
 .olfill.warn{background:hsl(38 92% 52%)}
 .olfill.bad{background:hsl(0 72% 55%)}
 .olval{width:62px;flex:none;text-align:right;font-variant-numeric:tabular-nums;font-size:10.5px}
 /* The numeric readout carries the same traffic-light colour as its bar, so
    the value is legible as good/warn/bad without measuring the bar by eye. */
 .olval.good{color:hsl(142 55% 52%)}
 .olval.warn{color:hsl(38 88% 58%)}
 .olval.bad{color:hsl(0 70% 64%)}
 /* Per-GPU chips: only rendered for the local box, which is the only host that
    can report real device telemetry. */
 .olgpus{display:flex;flex-wrap:wrap;gap:5px;margin:5px 0 2px}
 .olgpu{font-size:9.5px;padding:1px 6px;border-radius:4px;border:1px solid var(--border);
   color:var(--muted);font-variant-numeric:tabular-nums}
 .olmod{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:7px 0 3px}
 .olmn{font-size:13px;font-weight:600}
 /* Capability pills — what this box can actually do (tools/vision/thinking). */
 .olcap{font-size:9px;padding:1px 5px;border-radius:3px;border:1px solid var(--border);
   color:var(--muted-foreground,var(--muted))}
 .olcap.tools{border-color:hsl(262 80% 60% / .5);color:hsl(262 80% 70%)}
 .olcap.vision{border-color:hsl(320 85% 60% / .5);color:hsl(320 85% 70%)}
 .olcap.thinking{border-color:hsl(38 92% 52% / .5);color:hsl(38 92% 60%)}
 .olidle{font-size:11px;color:var(--muted);padding:4px 0}
 .olwork{display:flex;gap:10px;flex-wrap:wrap;font-size:10px;color:var(--muted);
   margin-top:8px;padding-top:7px;border-top:1px solid var(--border)}
 .olwork b{color:var(--foreground);font-weight:600;font-variant-numeric:tabular-nums}
 .olstale{font-size:10px;color:hsl(38 92% 60%)}


 /* Model name inside a drawer log line — bigger than the surrounding text so
    the eye lands on "which model" before reading the message. */
 .evm{font-size:12.5px;font-weight:600}
 /* Tool name in a drawer line — same weight as the model name so the eye can
    scan either column, coloured from the tool palette. */
 .evt{font-size:12.5px;font-weight:600}

 /* Failure filter chips — same visual language as the drawer's filter tabs. */
 .fchip{padding:2px 8px;border-radius:4px;border:1px solid var(--border);
   background:transparent;color:var(--muted);cursor:pointer;font-size:10px;
   line-height:1.7;white-space:nowrap}
 .fchip:hover{border-color:var(--accent)}
 .fchip.on{background:var(--card);font-weight:600}
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
 .costpulse{animation:cost-pulse 2.2s ease-in-out infinite;
   color:var(--accent2);display:inline-block}

 /* ---- Logs drawer -------------------------------------------------------
    Fixed to the right edge, above everything, and translated off-screen when
    closed so it costs nothing until opened. */
 #logbtn{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:60;
   display:flex;align-items:center;gap:7px;padding:13px 10px;
   border-radius:7px 0 0 7px;border:1px solid var(--border);border-right:none;
   background:var(--card);color:var(--fg);cursor:pointer;font-size:12px;
   font-weight:600;letter-spacing:.04em;writing-mode:vertical-rl;
   box-shadow:-4px 0 18px rgba(0,0,0,.35);transition:padding .15s ease}
 #logbtn:hover{border-color:var(--accent);padding-right:14px}
 /* Hide the tab itself while the drawer is open — it would sit under the panel. */
 #logbtn.hidden{opacity:0;pointer-events:none}
 #logbtn .n{background:#ef4444;color:#fff;border-radius:999px;padding:1px 6px;
   font-size:10px;font-weight:600;line-height:1.5}
 #logbtn .n[hidden]{display:none}
 .n2{background:#ef4444;color:#fff;border-radius:999px;padding:0 5px;
   font-size:9px;font-weight:700;margin-left:3px}
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
 .dtab{font-size:10.5px;padding:3px 9px;border-radius:3px;cursor:pointer;
   border:1px solid var(--border);color:var(--muted);background:transparent}
 .dtab.on{background:var(--accent);border-color:var(--accent);color:#fff}
 #dbody{overflow-y:auto;flex:1;padding:4px 0;font-family:ui-monospace,SFMono-Regular,
   Menlo,monospace;font-size:11px;line-height:1.45}
 .ev{display:flex;gap:9px;padding:6px 15px;border-bottom:1px solid var(--border)}
 .ev:hover{background:rgba(127,127,127,.06)}
 .ev .t{color:var(--muted);flex-shrink:0;font-variant-numeric:tabular-nums}
 .ev .b{min-width:0;flex:1;word-break:break-word}
 .ev .k{display:inline-block;padding:0 5px;border-radius:2px;font-size:9.5px;
   margin-right:6px;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
 /* .k-* chip colours are generated at boot from FKIND (installKindCSS) so the
    drawer, the health bars and the failure filters can never disagree. */
 .ev.err .b{color:#fca5a5}
 #dfoot{padding:8px 15px;border-top:1px solid var(--border);flex-shrink:0;
   display:flex;align-items:center;justify-content:space-between;font-size:10px}
 /* Live tab: sessions list (wide) + stacked charts (narrow). Explicit tracks,
    because auto-fit + a fixed `span 2` disagree about the column count and
    leave dead space or a 0px track. Below 1000px the charts go under the list
    full-width rather than squeezing into an unreadable column. */
 .livegrid{display:grid;gap:var(--gap);align-items:stretch;
   grid-template-columns:minmax(0,2fr) minmax(300px,1fr)}
 .livegrid > *{min-width:0}
 @media(max-width:1000px){
   .livegrid{grid-template-columns:minmax(0,1fr)}
   /* the list is height-capped for the side-by-side case; unpin it when stacked */
   .livegrid > .card:first-child{max-height:none !important}
 }
 /* Mobile */
 @media(max-width:640px){
   :root{--fs:14px;--gap:12px;--pad:12px}
   .hide-mobile{display:none}
   .page-title{font-size:16px !important}
 }
 /* Tablet */
 @media(min-width:641px) and (max-width:1024px){
   :root{--fs:14px;--gap:14px;--pad:16px}
 }
 /* Large screens get more breathing room */
 @media(min-width:1600px){
   :root{--fs:16px;--gap:20px;--pad:28px}
 }
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
    <div class="muted text-[11px] mt-0.5 flex items-center gap-1.5">
     <span class="dot"></span><span id="meta"></span>
     <span aria-hidden="true" class="opacity-40">/</span>
     <span id="crumb" aria-live="polite" class="font-medium" style="color:var(--fg)"></span>
    </div>
   </div>
  </div>
  <div class="flex gap-2 items-center flex-wrap">
   <div class="flex gap-1.5 flex-wrap" id="tabs"></div>
   <button id="logbtn2" class="chip" title="Open live logs (L)" style="border-color:var(--accent);color:var(--accent)">&#9776; Logs <span class="n2" id="logn2" hidden>0</span></button>
   <a href="costs.html" class="chip" title="Per-million-token price sheet &mdash; how costs are calculated">&#36; Rates</a>
   <button id="refresh" class="chip" title="Refresh data">&#8635;</button>
   <button id="theme" class="chip" title="Toggle theme">&#9788;</button>
   <button id="helpbtn" title="How your work gets routed (?)">?</button>
  </div>
 </div>

 <div class="card p-3 flex items-center gap-2 flex-wrap">
  <span class="lbl">Range</span>
  <input type="date" id="from"><span class="muted text-[11px]">to</span><input type="date" id="to">
  <span class="flex gap-1.5 ml-1" id="presets"></span>
  <span class="muted text-[11px] ml-auto" id="rangeinfo"></span>
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
    <span class="muted normal-case tracking-normal text-[10px] ml-1"
      title="Every recorded API call whose date falls in the selected range, across all sessions, finished or not.">all sessions &middot; selected date range &middot; estimated</span>
   </div>
   <div id="xfertot" class="bw"></div>
   <div class="muted text-[10px] ml-auto" id="xfernote"></div>
  </div>
 </div>

 <div class="grid-kpi" id="kpis"></div>



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
 <div class="livegrid" id="live-grid">
   <div class="card p-4" style="min-width:0;display:flex;flex-direction:column;max-height:calc(100vh - 230px);max-height:calc(100dvh - 230px)">
    <div class="lbl mb-2.5 shrink-0">In progress now <span id="livestamp" class="muted text-[9px] normal-case tracking-normal ml-1">live · every 5s</span></div>
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
    <span class="muted normal-case tracking-normal text-[10px] ml-1" id="olsub"></span>
   </div>
   <div id="ollama" class="olgrid"></div>
  </div>
 </div>

 <div class="view" data-view="Flow" hidden>
  <div class="card p-4">
   <div class="lbl mb-2.5">Provider → model → task
    <span class="muted normal-case tracking-normal text-[10px] ml-1" id="flowsub"></span>
    <span class="flowctl" id="flowctl"></span>
   </div>
   <div id="flowwrap"><svg id="flow"></svg><div id="flowtip" class="flowtip"></div></div>
  </div>
 </div>

 <div class="view" data-view="Logs" hidden>
  <div class="card p-4 mb-3">
   <div class="flex items-center gap-2 flex-wrap mb-3">
    <div class="lbl">Log events</div>
    <span class="muted text-[10px]" id="lgscope">—</span>
    <span style="margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
     <input id="lgq" type="search" placeholder="Search text, tool, session…"
       style="background:var(--bg);border:1px solid var(--border);border-radius:7px;
              padding:5px 9px;font-size:12px;color:var(--fg);min-width:min(260px,52vw)">
     <button id="lgclear" class="chip" type="button">Clear</button>
    </span>
   </div>
   <!-- Facet rows. Each chip carries the count over the WHOLE window, not the
        capped slice, so the numbers stay true when events are truncated. -->
   <div class="lgfacets">
    <div class="lgrow"><span class="lglbl">Level</span><span id="lgf-level" class="lgchips"></span></div>
    <div class="lgrow"><span class="lglbl">Role</span><span id="lgf-role" class="lgchips"></span></div>
    <div class="lgrow"><span class="lglbl">Tool</span><span id="lgf-tool" class="lgchips"></span></div>
    <div class="lgrow"><span class="lglbl">Model</span><span id="lgf-model" class="lgchips"></span></div>
    <div class="lgrow"><span class="lglbl">Session</span><span id="lgf-session" class="lgchips"></span></div>
    <div class="lgrow" id="lgrow-kind"><span class="lglbl">Failure</span><span id="lgf-kind" class="lgchips"></span></div>
    <div class="lgrow"><span class="lglbl">Window</span><span class="lgchips">
      <button class="lgchip" data-win="1">1h</button>
      <button class="lgchip" data-win="6">6h</button>
      <button class="lgchip on" data-win="24">24h</button>
      <button class="lgchip" data-win="0">All loaded</button>
    </span></div>
   </div>
  </div>
  <div class="card p-4">
   <div class="flex items-center gap-2 mb-2">
    <span class="muted text-[10px]" id="lgcount">—</span>
    <span class="muted text-[10px]" id="lgcap" hidden></span>
    <button id="lgcsv" class="chip" type="button" style="margin-left:auto">Export CSV</button>
   </div>
   <div id="lglist" style="max-height:clamp(320px,58vh,760px);overflow:auto"></div>
  </div>
 </div>

 <div class="view" data-view="Health">
  <div class="card p-4 mb-3" id="delegcard" hidden>
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
  <div class="card p-4 mb-3">
   <div class="lbl mb-2.5">Success rate by model</div>
   <div id="healthgrid" class="flex flex-col gap-1.5"></div>
  </div>
  <div class="card p-4">
   <div class="lbl mb-2.5">Recent failures
    <button id="tolog" class="chip" style="float:right;font-size:10px;text-transform:none;letter-spacing:0">Open live logs &rarr;</button>
   </div>
   <!-- Filter chips are built from the data, so a kind only appears when it
        actually occurred; counts make a burst obvious before you read a row. -->
   <div id="failfilters" class="flex gap-1.5 flex-wrap mb-2.5"></div>
   <div id="faillist" class="flex flex-col gap-1.5"
     style="max-height:clamp(260px,38vh,520px);overflow-y:auto;padding-right:4px"></div>
   <div id="failcount" class="muted text-[10px] mt-2"></div>
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
   <div class="overflow-x-auto"><table class="w-full text-[12px]" id="tblProv"></table></div>
  </div>
 </div>

 <div class="view" data-view="Detail" hidden>
  <!-- Activity heatmap lives here rather than as a global band: it is a
       drill-down question ("when was this busy?"), not a headline number, and
       as a band it rendered on every tab including ones it said nothing about. -->
  <div class="card p-4 mb-4" id="heatcard">
   <div class="lbl mb-2.5">Activity <span class="muted normal-case tracking-normal text-[10px] ml-1" id="heatsub"></span></div>
   <div id="heatmap"></div>
  </div>
  <div class="card p-4">
   <div class="lbl mb-2.5">Per-model detail</div>
   <div class="overflow-x-auto"><table class="w-full text-[12px]" id="tbl"></table></div>
  </div>
 </div>

 <div class="text-[11px] muted border-l-2 pl-3" style="border-color:var(--accent)">
  <b>Est. cost</b> is what every request would cost at public API rates &mdash; local models at
  $0.00, everything else priced per token (input, output and cache-read rated separately) from
  the OpenRouter catalogue refreshed daily, plus official vendor rates for models OpenRouter does
  not list (Codex/Astra, some Fireworks SKUs).
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
 <div class="dhead">
  <span class="dot"></span>
  <b style="font-size:13px">Live tail</b>
  <span class="muted" id="dstamp" style="font-size:10px">live</span>
  <a href="#/logs" id="dfull" class="chip" style="font-size:10px;text-transform:none;letter-spacing:0">All logs &rarr;</a>
  <button id="dclose" class="chip" style="margin-left:auto" title="Close">&times;</button>
 </div>
 <div class="dtabs">
  <button class="dtab on" data-f="all">All</button>
  <button class="dtab" data-f="error">Failures</button>
  <button class="dtab" data-f="tool">Tools</button>
  <span style="margin-left:auto;display:flex;align-items:center;gap:5px">
   <input type="checkbox" id="dauto" checked style="accent-color:var(--accent)">
   <label for="dauto" class="muted" style="font-size:10px;cursor:pointer">follow</label>
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
function setRange(from,to){ $('from').value=from; $('to').value=to; render(); }

function presets(p){
  const [lo,hi] = bounds(p);
  const days = n => { const d=new Date(hi); d.setDate(d.getDate()-(n-1));
    const s=d.toISOString().slice(0,10); return s<lo?lo:s; };
  const defs = [['24h',()=>[hi,hi]],['7d',()=>[days(7),hi]],['30d',()=>[days(30),hi]],['All',()=>[lo,hi]]];
  $('presets').innerHTML = defs.map(([l],i)=>`<span class="chip" data-p="${i}">${l}</span>`).join('');
  $('presets').querySelectorAll('[data-p]').forEach((el,i)=>
    el.onclick = () => { const [a,b]=defs[i][1](); setRange(a,b); });
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
function provOf(p, model, url){
  const u=(url||'').toLowerCase();
  if(u){
    if(u.includes('fireworks.ai'))      return 'fireworks';
    if(u.includes('opencode.ai'))       return 'opencode-go';
    if(u.includes('api.anthropic.com')) return 'anthropic';
    if(u.includes('openai.com')||u.includes('chatgpt.com')) return 'openai-codex';
    if(u.includes('openrouter.ai'))     return 'openrouter';
    if(u.includes('nousresearch'))      return 'nous';
    // LOCAL_HOSTS is injected from config.local_host_patterns, so self-hosted
    // URLs are recognised on any LAN instead of only the author's.
    if(LOCAL_HOSTS.some(h => u.includes(h))) return 'local';
  }
  const key=(p||'').toLowerCase().trim();
  if(key && key!=='custom') return key;
  const m=(model||'').toLowerCase();
  if(m.includes('fireworks')) return 'fireworks';
  const isSlug = m.includes('/');
  if(!isSlug && LOCAL_RE.test(m)) return 'local';
  if(m.includes('claude')) return 'anthropic';
  if(m.includes('glm')||m.includes('kimi')||m.includes('minimax')) return 'opencode-go';
  // Nous portal model families (Hermes, stepfun/step-*) — old rows recorded
  // neither provider nor base_url, so match the model name as a last resort.
  if(m.startsWith('stepfun/')||m.startsWith('step-')||m.includes('hermes-')) return 'nous';
  if(m.startsWith('gpt-')) return 'openai-codex';
  if(key==='custom') return 'local';
  if(isSlug) return 'cloud';
  return 'local';
}
function provBadge(p){
  const key=(p||'').toLowerCase().trim();
  const s=PROV[key]||{icon:'○',bg:'rgba(148,163,184,.14)',fg:MU};
  return `<span class="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
    style="background:${s.bg};color:${s.fg};border:1px solid ${s.fg}33">
    <span style="font-size:9px">${s.icon}</span>${key}</span>`;
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

function render(){
  const p = DATA.profiles[current];
  const from = $('from').value, to = $('to').value;
  const inR = d => d && (!from || d>=from) && (!to || d<=to);
  const rows  = p.rows.filter(r=>inR(r.date));
  const hours = p.hours.filter(h=>inR(h.date));
  const sess  = p.sessions.filter(s=>inR(s.date));

  charts.forEach(c=>c.destroy()); charts=[];
  document.querySelectorAll('[data-tab]').forEach(b =>
    b.className='px-3 py-1 rounded-md border text-[12px] '+(b.dataset.tab===current?'tabon':'taboff'));

  const calls=rows.reduce((s,r)=>s+r.calls,0), tok=rows.reduce((s,r)=>s+r.inp+r.outp,0);
  const cache=rows.reduce((s,r)=>s+r.cread,0);
  const billed=rows.reduce((s,r)=>s+(r.billed_usd||0),0);
  const market=rows.reduce((s,r)=>s+(r.market_value_usd||0),0);
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
  const srCol = srate==null ? MU : srate>=95 ? '#22c55e' : srate>=80 ? '#f59e0b' : '#ef4444';
  const srVal = srate==null ? '—'
    : `<span style="color:${srCol}">${srate.toFixed(1)}%</span>`;

  $('kpis').innerHTML=[['API calls',calls.toLocaleString()],['Tokens',fmt(tok)],
    ['Cache read',fmt(cache)],['Sessions',nsess.toLocaleString()],
    ['Success rate',srVal],
    ['In progress',liveDot],
    ['Est. cost','<span class="costpulse">$'+market.toFixed(2)+'</span>']]
    .map(([l,v])=>`<div class="card p-2.5"><div class="text-[17px] font-semibold${l==='In progress'?' kpi-live':''}">${v}</div>
      <div class="muted text-[10px] uppercase tracking-wide">${l}</div></div>`).join('');

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
    ptbl.innerHTML=`<tr class="muted text-[10px] uppercase tracking-wide">
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
        <td class="text-right text-[11px]">${v.calls.toLocaleString()}</td>
        <td class="text-right text-[11px]">${fmt(v.tok)}</td>
        <td class="text-right text-[11px] bwup">${fmtB(v.up)}</td>
        <td class="text-right text-[11px] bwdown">${fmtB(v.down)}</td>
        <td class="text-right text-[11px] font-semibold" style="color:${s.fg}">$${v.mkt.toFixed(2)}</td>
        <td class="text-right text-[11px]">${v.models.size}</td>
        <td class="pl-3"><div style="height:5px;border-radius:2px;background:${s.fg};width:${barW}%;opacity:.7"></div></td>
      </tr>`;}).join('');
  }

  const t={};
  rows.forEach(r=>{const k=short(r.model)+'|'+provOf(r.provider,r.model,r.base_url);
    const o=t[k]||(t[k]={calls:0,tok:0,inp:0,outp:0,cache:0,cost:0,mkt:0,up:0,down:0,free:true,tasks:new Set()});
    o.calls+=r.calls;o.tok+=r.inp+r.outp;o.inp+=r.inp;o.outp+=r.outp;o.cache+=r.cread;o.cost+=(r.billed_usd||0);o.mkt+=(r.market_value_usd||0);o.up+=(r.up_bytes||0)+(r.lan_up_bytes||0);o.down+=(r.down_bytes||0)+(r.lan_down_bytes||0);if(r.cost_class!=='free')o.free=false;o.tasks.add(r.task);});
  const mx=Math.max(...Object.values(t).map(r=>r.calls),1);
  $('tbl').innerHTML=`<tr class="muted text-[10px] uppercase tracking-wide">
    <th class="text-left py-1.5">Model</th><th class="text-left">Provider</th>
    <th class="text-right">Calls</th><th class="text-right">In</th><th class="text-right">Out</th>
    <th class="text-right">Cache</th>
    <th class="text-right" title="Estimated bytes uploaded. Tokens x 4.68, not measured. Includes cache reads: prefix caching re-sends the prompt.">&#8593; Up (est)</th>
    <th class="text-right" title="Estimated bytes downloaded. Tokens x 4.68, not measured.">&#8595; Down (est)</th>
    <th class="text-right">Est. cost</th>
    <th class="text-left pl-3">Tasks</th></tr>`+
    Object.entries(t).sort((a,b)=>b[1].calls-a[1].calls).map(([k,v])=>{const [m,pr]=k.split('|');
      return `<tr style="border-top:1px solid ${BD}"><td class="py-1.5"><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${colorOf(m)};margin-right:6px"></span><span class="text-[14px] font-semibold" style="color:${colorOf(m)}">${m}</span></td>
        <td>${provBadge(pr)}</td>
        <td class="text-right">${v.calls.toLocaleString()}</td><td class="text-right">${fmt(v.inp)}</td><td class="text-right">${fmt(v.outp)}</td>
        <td class="text-right">${fmt(v.cache)}</td>
        <td class="text-right bwup">${fmtB(v.up)}</td>
        <td class="text-right bwdown">${fmtB(v.down)}</td>
        <td class="text-right">$${(+v.mkt).toFixed(2)}</td>
        <td class="pl-3"><div style="height:4px;border-radius:2px;background:${colorOf(m)};width:${Math.max(3,v.calls/mx*100)}%"></div>
        <span class="text-[10px] muted">${[...v.tasks].join(', ')}</span></td></tr>`;}).join('');
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
  // LAN is shown separately, never folded into the metered number: a session
  // can run a local and a hosted model at once (all 7 live sessions did), so
  // one combined figure would misstate what crossed the paid link.
  const lan = (lup || ldown)
    ? ` <span class="muted" title="Stayed on the LAN — not metered">· LAN ${fmtB(lup)}&uarr;</span>`
    : '';
  const rate = moving ? `<span class="muted bwrate">${fmtRate(upR + downR)}</span>` : '';
  return `<div class="bw mt-1 text-[10px]${moving ? ' bwlive' : ''}"
      title="Estimated from token counts (${(DATA.bytes_per_token || 4.68)} bytes/token) — not measured">
    <span class="bwleg"><span class="bwarrow bwup">&uarr;</span><span>${fmtB(up)}</span></span>
    <span class="bwleg"><span class="bwarrow bwdown">&darr;</span><span>${fmtB(down)}</span></span>
    ${rate}${lan}
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
  if (!up && !down && !lanUp && !lanDown){ card.hidden = true; return; }
  card.hidden = false;

  // Ratio is the headline finding: upload dwarfs download because prompts are
  // re-sent in full on every call while completions are small.
  const ratio = down > 0 ? (up / down) : null;
  $('xfertot').innerHTML =
    `<span class="bwleg"><span class="bwarrow bwup">&uarr;</span>
       <span class="text-[17px] font-semibold">${fmtB(up)}</span>
       <span class="muted text-[10px] uppercase tracking-wide">up</span></span>
     <span class="bwleg"><span class="bwarrow bwdown">&darr;</span>
       <span class="text-[17px] font-semibold">${fmtB(down)}</span>
       <span class="muted text-[10px] uppercase tracking-wide">down</span></span>`
    + (ratio ? `<span class="muted text-[10px]">${ratio.toFixed(0)}:1</span>` : '');

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
  ];

  let html = cards.map(([view, ico, desc, stat]) => `
    <a class="card p-4 homecard" href="#/${view.toLowerCase()}" data-gohome="${view}">
      <div class="flex items-center justify-between mb-2">
        <span class="hc-ico" style="color:var(--accent)">${ico}</span>
        <span class="muted text-[10px] uppercase tracking-wide">${view}</span>
      </div>
      <div class="hc-stat">${stat}</div>
      <div class="muted text-[11px] mt-1">${desc}</div>
    </a>`).join('');

  // Bandwidth card: both directions together, because the ratio is the point.
  // Labelled "est." on the card itself — a derived number that looks measured
  // is the failure this project keeps guarding against.
  html += `
    <a class="card p-4 homecard" href="#/usage" data-gohome="Usage">
      <div class="flex items-center justify-between mb-2">
        <span class="hc-ico" style="color:var(--accent)">\u21C5</span>
        <span class="muted text-[10px] uppercase tracking-wide">Bandwidth (est.)</span>
      </div>
      <div class="hc-stat"><span class="bwup">\u2191 ${fmtB(upB)}</span>
        <span class="muted" style="font-weight:400"> / </span>
        <span class="bwdown">\u2193 ${fmtB(downB)}</span></div>
      <div class="muted text-[11px] mt-1">Estimated from tokens, not measured</div>
    </a>`;

  // Rates is a separate page, so it stays a real external link.
  html += `
    <a class="card p-4 homecard" href="costs.html">
      <div class="flex items-center justify-between mb-2">
        <span class="hc-ico" style="color:var(--accent)">\u2696</span>
        <span class="muted text-[10px] uppercase tracking-wide">Rates</span>
      </div>
      <div class="hc-stat">Price sheet</div>
      <div class="muted text-[11px] mt-1">Current per-million-token rates</div>
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
    ? `<div class="muted text-[9px]">${L.nmodels} models used</div>` : '';
  const main = ms.filter(m => m.main).length;
  const tip = ms.map(m => `${short(m.model)} (${m.tasks.join(', ')})`).join('\n');
  const open = liveModelsOpen.has(L.id);
  return `<button type="button" class="lmbtn muted text-[9px]" data-lm="${esc(L.id)}"
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

function renderLive(){
  const p = DATA.profiles[current] || {};
  renderOllama(DATA.ollama);
  // Deduplicate live sessions by ID — the All tab can merge the same session from
  // two profiles, and the 5s poll can occasionally return duplicates mid-refresh.
  const seen = new Set();
  const live = (p.live || []).filter(L => { if(seen.has(L.id)) return false; seen.add(L.id); return true; });
  const box = $('livelist');
  if(!box) return;
  if(!live.length){
    box.innerHTML = '<div class="muted text-[12px] py-2">Nothing running right now.</div>';
  } else {
    box.innerHTML = live.map(L=>{
      const c = catOf(L.category);
      const mcol = colorOf(short(L.model));
      const tools = (L.tools||[]).slice(0,5).map(t=>
        `<span class="text-[9px] px-1 py-0.5 rounded" style="background:${BD};color:${MU}">${t}</span>`).join(' ');
      return `<div class="flex items-center gap-2.5 p-2 rounded" style="border:1px solid ${BD}">
        <div style="color:${c.c};font-size:15px;line-height:1.1">${c.i}</div>
        <div class="flex-1 min-w-0 self-center">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-[11px] font-semibold" style="color:${c.c}">${L.category}</span>
            <span class="text-[12px] truncate">${L.title}</span>
            ${provBadge(provOf('', L.model, L.base_url))}
            ${L.profile ? `<span class="text-[9px] px-1 rounded" style="background:${BD};color:${MU}">${L.profile}</span>` : ''}
            ${L.kind==='subagent'?'<span class="text-[9px] muted">↳ subagent</span>':''}
          </div>
          <div class="muted text-[10.5px] truncate">${L.phase||'—'}</div>
          <div class="flex items-center gap-1 mt-1 flex-wrap">${tools}</div>
        </div>
        <div class="metacol shrink-0">
          <div class="text-[15px] font-semibold truncate leading-tight" style="color:${mcol}" title="${short(L.model)}">${short(L.model)}</div>
          ${L.switched ? `<div class="text-[9px] truncate" style="color:#f59e0b" title="router fell back from ${short(L.init_model)}">↯ from ${short(L.init_model)}</div>` : ''}
          ${modelsBadge(L)}
          <div class="muted text-[10px]">${ago(L.idle_s)} ago</div>
        </div>
        <div class="loecol">${loeIcon(L)}${bwRow(L)}</div>
      </div>${modelsPanel(L)}`;
    }).join('');
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

// LOE indicator — a speedometer in its own column.
// A 180° dial with a needle that sweeps to the load position and then keeps a
// small tremor there, so a busy session reads as *alive* at a glance rather
// than as a static icon. Position on the sweep encodes the whole range, which
// a three-state dot or glyph cannot do.
// Inline SVG: no canvas, no library, no layout pass.
function loeIcon(L){
  const heavy = new Set(['delegate_task','execute_code','terminal','mcp__browser_exec']);
  const light = new Set(['read_file','search_files','web_search']);
  const tools = L.tools||[];
  let score = tools.filter(t=>heavy.has(t)).length*2 + tools.filter(t=>!heavy.has(t)&&!light.has(t)).length;
  score = Math.min(score, 6);
  const frac = score/6;
  const tier = frac>0.7 ? {c:'#ef4444', n:'Heavy'}
             : frac>0.4 ? {c:'#f59e0b', n:'Medium'}
             :            {c:'#22c55e', n:'Light'};
  // Needle sweeps -90° (idle) to +90° (redline) across the dial.
  const deg = (-90 + frac*180).toFixed(1);
  // Tremor amplitude and speed both rise with load: a heavy session visibly
  // judders, a light one barely moves.
  const amp = (1.2 + frac*4).toFixed(1);
  const spd = (1.5 - frac*1.05).toFixed(2);
  // Geometry: 64-wide viewBox, dial centre (32,34), radius 26 — roughly double
  // the first pass, so the needle is legible without hovering for the tooltip.
  const CX = 32, CY = 34, R = 26;
  const LEN = (Math.PI * R).toFixed(1);
  // Ticks every 30°; the three tier boundaries get a longer mark.
  const ticks = [0,1,2,3,4,5,6].map(i=>{
    const a = (-90 + i*30) * Math.PI/180;
    const major = (i===0 || i===3 || i===6);
    const r1 = major ? R-6 : R-4, r2 = R;
    return `<line x1="${(CX+r1*Math.sin(a)).toFixed(1)}" y1="${(CY-r1*Math.cos(a)).toFixed(1)}"
      x2="${(CX+r2*Math.sin(a)).toFixed(1)}" y2="${(CY-r2*Math.cos(a)).toFixed(1)}"
      stroke="${BD}" stroke-width="${major?1.6:1}"/>`;
  }).join('');
  // One shared keyframe in the stylesheet, parameterised per card by CSS vars —
  // a <style> block per card would mean 13 injected stylesheets on this page.
  return `<span class="loe" title="${tier.n} load — ${score}/6">
    <svg viewBox="0 0 64 44" width="62" height="43" aria-hidden="true">
      ${ticks}
      <path d="M6 34 A26 26 0 0 1 58 34" fill="none" stroke="${BD}" stroke-width="4"
        stroke-linecap="round"/>
      <path d="M6 34 A26 26 0 0 1 58 34" fill="none" stroke="${tier.c}" stroke-width="4"
        stroke-linecap="round" stroke-dasharray="${LEN}"
        stroke-dashoffset="${(LEN*(1-frac)).toFixed(1)}"/>
      <g class="needle" style="--d:${deg}deg;--amp:${amp}deg;--spd:${spd}s">
        <line x1="32" y1="34" x2="32" y2="12" stroke="${tier.c}" stroke-width="2.4"
          stroke-linecap="round"/>
      </g>
      <circle cx="32" cy="34" r="4" fill="${tier.c}"/>
      <circle cx="32" cy="34" r="1.8" fill="var(--card)"/>
      <text x="32" y="43" text-anchor="middle" fill="${tier.c}"
        style="font-size:9px;font-weight:600">${tier.n}</text>
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
  return {rows, hours, sessions:sess, live, active, health, recent_sessions, heatmap,
          node_sessions: NS,
          // Delegation outcomes merge like health does: per-child counters add
          // up across profiles. Omitting this left the DEFAULT tab with an
          // empty panel while each real profile had data — the panel looked
          // broken rather than empty.
          delegations: mergeDelegations(names.map(n => profiles[n].delegations)),
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
  $('delegmodels').innerHTML = rows || '<div class="muted text-[11px]">No child runs.</div>';

  // Why they failed. Counts only — the reasons come from the runtime's own
  // failure_reason field, so no guessing about what "rate_limit" means.
  const rs = Object.entries(g.reasons || {});
  $('delegreasons').innerHTML = rs.length
    ? rs.map(([k, v]) => `<span class="chip" style="text-transform:none">${esc(k)} <b>${v}</b></span>`).join('')
    : '<span class="muted text-[11px]">No failures in range.</span>';

  // Measured tool outcomes from inside delegated runs.
  const tl = (g.tools || []).slice(0, 8);
  $('delegtools').innerHTML = tl.length
    ? tl.map(t => `<div class="drow">
        <div class="dname">${esc(t.tool)}</div>
        <div class="dbar"><span style="width:${Math.max(0, Math.min(100, t.rate))}%" class="${t.rate >= 95 ? 'ok' : 'bad'}"></span></div>
        <div class="dpct ${t.rate >= 95 ? 'ok' : 'bad'}">${t.rate}%</div>
        <div class="dmeta muted">${t.calls} call${t.calls === 1 ? '' : 's'}${t.fail ? ` · ${t.fail} failed` : ''}</div>
      </div>`).join('')
    : '<div class="muted text-[11px]">No tool calls recorded.</div>';

  // Recent runs, newest first. Goal text is set with textContent by esc() —
  // it is model-authored and must never be interpolated as markup.
  const rec = (g.recent || []).slice(0, 12);
  $('deleglist').innerHTML = rec.map(r => {
    const okc = r.status === 'completed';
    const why = r.failure_reason || r.exit_reason || r.status;
    return `<div class="ditem">
      <span class="ddot ${okc ? 'ok' : 'bad'}"></span>
      <div class="dgoal" title="${esc(r.goal || '')}">${esc(r.goal || '(no goal recorded)')}</div>
      <div class="muted text-[10px]">${esc(short(r.model || ''))} · ${ago(r.seconds)}${okc ? '' : ' · ' + esc(why)}</div>
    </div>`;
  }).join('') || '<div class="muted text-[11px]">Nothing yet.</div>';
}

function renderHealth(){
  const p = DATA.profiles[current] || {};
  const H = (p.health||[]).filter(h => h.total > 0);
  const box = $('healthgrid');
  if(!box) return;
  if(!H.length){ box.innerHTML='<div class="muted text-[12px]">No calls recorded.</div>'; }
  else {
    box.innerHTML = H.slice(0,14).map(h=>{
      const r = h.rate;
      const col = rateColor(r);
      // stacked bar: green success, then one segment per failure kind
      const segs = Object.entries(h.kinds||{}).map(([k,v])=>
        `<div title="${fk(k).t}: ${v}" style="width:${(v/h.total*100).toFixed(2)}%;background:${fk(k).c}"></div>`).join('');
      const okPct = (h.ok/h.total*100).toFixed(2);
      const chips = Object.entries(h.kinds||{}).sort((a,b)=>b[1]-a[1]).slice(0,3)
        .map(([k,v])=>`<span class="text-[9px] px-1 rounded" style="background:${fk(k).c}22;color:${fk(k).c}">${fk(k).t} ${v}</span>`).join(' ');
      return `<div class="flex items-center gap-2.5">
        <div class="text-[14px] font-semibold truncate" style="width:172px;color:${colorOf(short(h.model))}" title="${short(h.model)}">${short(h.model)}</div>
        <div class="flex-1 flex h-[9px] rounded overflow-hidden" style="background:${h.fail===h.total ? FAILTRACK : BD}">
          <div style="width:${okPct}%;background:#22c55e"></div>${segs}
        </div>
        <div class="text-[11px] font-semibold text-right" style="width:52px;color:${col}">${r===null?'—':r+'%'}</div>
        <div class="text-[9px] muted text-right" style="width:96px">${h.ok.toLocaleString()} ok / ${h.fail}</div>
        <div class="flex gap-1 shrink-0" style="width:150px">${chips}</div>
      </div>`;
    }).join('');
  }

  // Recent failures: individual events, filterable by kind and by model. The
  // filter state lives outside renderHealth so a data refresh does not reset
  // the view the user is currently reading.
  renderFailures(p.failures_recent || []);
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
    const mc = Object.entries(models).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const chip = (act, val, label, col, n) =>
      `<button class="fchip${act?' on':''}" data-${val}="${label}"
        style="${act&&col?`border-color:${col};color:${col}`:''}">${label}${
        n!==undefined?` <span class="muted">${n}</span>`:''}</button>`;
    ff.innerHTML =
      chip(failKind==='all','fk','all',AC,F.length) +
      kc.map(([k,n])=>chip(failKind===k,'fk',k,fk(k).c,n)).join('') +
      (mc.length > 1
        ? `<span style="width:1px;background:${BD};margin:0 3px"></span>` +
          chip(failModel==='all','fm','all models') +
          mc.map(([m,n])=>chip(failModel===m,'fm',m,colorOf(m),n)).join('')
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

  fl.innerHTML = !rows.length
    ? `<div class="muted text-[12px]">${F.length
        ? 'No failures match this filter.'
        : 'No failures recorded in the last 7 days.'}</div>`
    : rows.map(f=>`<div class="flex items-start gap-2 text-[11px] py-0.5">
        <span class="text-[9px] px-1 rounded shrink-0" style="background:${fk(f.kind).c}22;color:${fk(f.kind).c}">${fk(f.kind).t}</span>
        <span class="shrink-0 text-[13px] font-semibold" style="color:${colorOf(short(f.model))}">${short(f.model)}</span>
        <span class="muted shrink-0 text-[10px]">${(f.when||'').slice(5,16)}</span>
        <span class="muted truncate text-[10px]" title="${(f.msg||'').replace(/"/g,'&quot;').replace(/</g,'&lt;')}">${(f.msg||'').replace(/</g,'&lt;')}</span>
      </div>`).join('');

  if (fc) fc.textContent = rows.length === F.length
    ? `${F.length} failures · last 7 days`
    : `${rows.length} of ${F.length} failures`;
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

function renderOllama(ol){
  const wrap = $('ollama'), card = $('olcard'), sub = $('olsub');
  if (!wrap || !card) return;
  const hosts = (ol && ol.hosts) || [];
  if (!hosts.length){ card.hidden = true; return; }
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
    .map(([d,l])=>`<button data-fd="${d}">${l}</button>`).join('');
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
  Cost:'$', Health:'\u2713', Detail:'\u2261', Logs:'\u2630'
};

function navViews(){
  return [...document.querySelectorAll('.view')].map(el => el.dataset.view);
}

function renderNav(){
  const box = document.getElementById('navlist');
  if (!box) return;
  box.innerHTML = navViews().map(v => `
    <a class="navitem" href="#/${slugOf(v)}" data-nav="${v}" data-tip="${v}">
      <span class="nvico" aria-hidden="true">${NAV_ICONS[v] || '\u2022'}</span>
      <span class="nvlabel">${v}</span>
      <span class="nvbadge" data-navbadge="${v}" hidden></span>
    </a>`).join('');
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
    LOGS = await r.json();
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
  if (!items || !items.length){ box.innerHTML = '<span class="muted text-[10px]">none</span>'; return; }
  box.innerHTML = items.map(it => {
    const v = it.v, on = lgSel[key].has(v) ? ' on' : '';
    return `<button class="lgchip${on}" data-facet="${key}" data-val="${esc(v)}" title="${esc(labelOf ? labelOf(it) : v)}">`
         + `${esc((labelOf ? labelOf(it) : v) || '—')}<span class="n">${fmt(it.n)}</span></button>`;
  }).join('');
}

function renderLogs(){
  const list = $('lglist');
  if (!list) return;
  if (logsLoading){ list.innerHTML = '<div class="muted text-[12px]">Loading log events…</div>'; return; }
  if (logsErr){
    list.innerHTML = `<div class="muted text-[12px]">Could not load logs-data.json (${esc(logsErr)}).`
      + ` Run <code>llm-telemetry logs</code>, and note that fetch is blocked when the page is opened from file://.</div>`;
    return;
  }
  const p = lgProfile();
  if (!p){ list.innerHTML = '<div class="muted text-[12px]">No log events in this window.</div>'; return; }

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

  const rows = p.events.filter(e => lgMatch(e, p));
  $('lgcount').textContent = `${fmt(rows.length)} shown`;
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
  }).join('') || '<div class="muted text-[12px]">Nothing matches these filters.</div>';
  if (rows.length > 1200){
    list.insertAdjacentHTML('beforeend',
      `<div class="muted text-[10px]" style="padding-top:6px">Showing the newest 1,200 of ${fmt(rows.length)} matches — narrow the filters to see more.</div>`);
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
  $('views').innerHTML=['Home','Live','Flow','Usage','Cost','Health','Detail','Logs']
    .map(v=>`<button data-vtab="${v}" onclick="pickView('${v}')" class="px-3 py-1 rounded-md border text-[12px] taboff">${v}</button>`).join('');
}
function pickView(v){
  view=v;
  document.querySelectorAll('.view').forEach(el=>el.hidden = el.dataset.view!==v);
  document.querySelectorAll('[data-vtab]').forEach(b=>{
    const on=b.dataset.vtab===v;
    b.className='px-3 py-1 rounded-md border text-[12px] '+(on?'tabon':'taboff');
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
  const all = buildAll(DATA.profiles);
  if (!all) return;
  const merged = {All: all};
  Object.keys(DATA.profiles).forEach(n => { if (n !== 'All') merged[n] = DATA.profiles[n]; });
  DATA.profiles = merged;
}

function tabs(){
  $('tabs').innerHTML=Object.keys(DATA.profiles)
    .map(n=>{
      // Profile badge colour is derived, not hardcoded: any profile name gets a
      // stable hue from the same hash the model palette uses, so a third
      // profile is styled automatically instead of falling back to grey.
      if (n === 'All') {
        return `<button data-tab="${n}" onclick="pick('${n}')" class="px-5 py-3 rounded-md border text-[16px] taboff">${n}</button>`;
      }
      const h = hashHue(n);
      return `<button data-tab="${n}" onclick="pick('${n}')" class="px-5 py-3 rounded-md border text-[16px] taboff" `
           + `style="background-color:hsl(${h} 62% 38%);color:#fff;border-color:hsl(${h} 70% 55%)">${n}</button>`;
    }).join('');
}
installAll();
// Build the palette ONCE, from every model in every profile. Charts then look
// their colour up rather than deriving it, so a model keeps the same shade on
// every tab, in every date range and on both profiles.
COLORS = buildColors(allModelNames());
TOOLCOLORS = buildToolColors(allToolNames());
current = Object.keys(DATA.profiles)[0];
tabs();
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
    if (!fresh.profiles || !Object.keys(fresh.profiles).length) throw new Error('empty payload');
    const keepFrom = $('from').value, keepTo = $('to').value, keepProfile = current;
    DATA = fresh;
    installAll();   // the merged tab must be rebuilt from the fresh payload
    // A model can appear for the first time in a refresh; recompute the global
    // palette so it gets a stable shade instead of the grey fallback.
    COLORS = buildColors(allModelNames());
    TOOLCOLORS = buildToolColors(allToolNames());
    tabs();
    pick(DATA.profiles[keepProfile] ? keepProfile : Object.keys(DATA.profiles)[0]);
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

// ---- Logs drawer ---------------------------------------------------------
// One chronological feed merging two sources: model failures parsed from
// errors.log, and tool events from the live sessions. Kept out of the tab
// system on purpose — a log you can only reach by changing tabs is not a log.
let dFilter = 'all', dSeen = 0, dOpen = false;

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
  if (on){
    dSeen = (DATA.errors || []).length;   // mark failures as read
    drawerSync();
  }
}

function installDrawer(){
  $('logbtn')?.addEventListener('click', () => drawerOpen(!dOpen));
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
    if (!fresh.profiles) throw new Error('empty payload');
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
    installAll();
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
pollLive();   // populate the drawer before the first 5s tick
document.addEventListener('visibilitychange', () => { if(!document.hidden) pollLive(); });

// Poll in place every 60s. A full location.reload() would throw away the
// selected tab, profile and date range mid-read; this swaps the data only.
setInterval(() => { if(!document.hidden) doRefresh(true); }, 60000);
// catch up immediately when the tab comes back to the foreground
document.addEventListener('visibilitychange', () => { if(!document.hidden) doRefresh(true); });
</script></body></html>
"""

html = (HEAD + JS.replace("__DATA__", json.dumps(data, default=str))
        .replace("__LOCAL_HOSTS__", json.dumps(CFG.local_host_patterns)))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w").write(html)
print(f"{OUT}  ({len(html):,} bytes)")
