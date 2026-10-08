import type { AnalyticsReport } from "./domain/analytics-report.js";
import { escapeHtml } from "../../core/escape-html.js";

const FONTS =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap";

const PAGE_STYLE = `:root {
  --page: #f3f4f6;
  --surface: #ffffff;
  --ink: #121619;
  --ink-2: #4d5358;
  --muted: #767d84;
  --hair: #e6e8eb;
  --axis: #c6cbd0;
  --accent: #0f62fe;
  --accent-soft: #e8f0ff;
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #e87ba4;
  --q0: #d9dce0; --q1: #86b6ef; --q2: #3987e5; --q3: #1c5cab; --q4: #0d366b;
  --q0-ink: #4d5358; --q1-ink: #0b2545; --q2-ink: #ffffff; --q3-ink: #ffffff; --q4-ink: #ffffff;
  --good: #0e7a2f; --bad: #c21f1f;
  --tip-bg: #121619; --tip-ink: #f4f4f4;
  --sans: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --radius: 10px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --page: #0c0d0e; --surface: #161718; --ink: #f2f4f8; --ink-2: #c1c7cd; --muted: #8d9399;
    --hair: #26292c; --axis: #3d4146; --accent: #4589ff; --accent-soft: #14213a;
    --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181;
    --q0: #34383c; --q1: #184f95; --q2: #2a78d6; --q3: #6da7ec; --q4: #b7d3f6;
    --q0-ink: #c1c7cd; --q1-ink: #ffffff; --q2-ink: #ffffff; --q3-ink: #0b2545; --q4-ink: #0b2545;
    --good: #3fbf65; --bad: #ff7070; --tip-bg: #f2f4f8; --tip-ink: #121619;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0c0d0e; --surface: #161718; --ink: #f2f4f8; --ink-2: #c1c7cd; --muted: #8d9399;
  --hair: #26292c; --axis: #3d4146; --accent: #4589ff; --accent-soft: #14213a;
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181;
  --q0: #34383c; --q1: #184f95; --q2: #2a78d6; --q3: #6da7ec; --q4: #b7d3f6;
  --q0-ink: #c1c7cd; --q1-ink: #ffffff; --q2-ink: #ffffff; --q3-ink: #0b2545; --q4-ink: #0b2545;
  --good: #3fbf65; --bad: #ff7070; --tip-bg: #f2f4f8; --tip-ink: #121619;
}
* { box-sizing: border-box; }
body { background: var(--page); color: var(--ink); font-family: var(--sans); font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
.wrap { max-width: 1240px; margin: 0 auto; padding-inline: 24px; padding-block: 0 64px; }
@media (max-width: 600px) { .wrap { padding-inline: 16px; } }

/* header */
.top { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: color-mix(in srgb, var(--page) 88%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--hair); }
.top-in { max-width: 1240px; margin: 0 auto; padding-inline: 24px; padding-block: 14px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px; }
@media (max-width: 600px) { .top-in { padding-inline: 16px; } }
.brandmark { display: flex; align-items: baseline; gap: 12px; }
h1 { font-size: 20px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
.asof { font-family: var(--mono); font-size: 12px; color: var(--muted); }
nav.jump { display: flex; gap: 4px; flex-wrap: wrap; margin-left: auto; }
nav.jump a { font-size: 13px; color: var(--ink-2); text-decoration: none; padding: 5px 10px; border-radius: 6px; }
nav.jump a:hover, nav.jump a:focus-visible { background: var(--surface); color: var(--ink); outline: none; box-shadow: 0 0 0 1px var(--hair); }

.facts { display: flex; flex-wrap: wrap; gap: 8px; margin: 22px 0 6px; }
.chip { font-size: 12px; padding: 3px 10px; border-radius: 999px; background: var(--surface); border: 1px solid var(--hair); color: var(--ink-2); display: inline-flex; gap: 6px; align-items: center; }
.chip b { color: var(--ink); font-weight: 600; font-family: var(--mono); font-weight: 500; }
.chip.sample { background: var(--accent-soft); border-color: transparent; color: var(--accent); }

/* sections */
section { margin-top: 44px; scroll-margin-top: 80px; }
.sec-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; margin-bottom: 14px; }
h2 { font-size: 17px; font-weight: 600; margin: 0; }
.window { font-family: var(--mono); font-size: 11.5px; color: var(--muted); letter-spacing: 0.02em; }
.sec-note { flex-basis: 100%; color: var(--ink-2); font-size: 13px; margin: 0; max-width: 75ch; }

.grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }
.card { background: var(--surface); border: 1px solid var(--hair); border-radius: var(--radius); padding: 18px 20px 16px; min-width: 0; display: flex; flex-direction: column; }
.c3 { grid-column: span 3; } .c4 { grid-column: span 4; } .c5 { grid-column: span 5; } .c6 { grid-column: span 6; } .c7 { grid-column: span 7; } .c8 { grid-column: span 8; } .c12 { grid-column: span 12; }
@media (max-width: 1080px) { .c3 { grid-column: span 6; } .c4, .c5, .c7, .c8 { grid-column: span 12; } .c6 { grid-column: span 12; } }
@media (max-width: 600px) { .c3 { grid-column: span 12; } }
h3 { font-size: 14px; font-weight: 600; margin: 0; }
.q { color: var(--ink-2); font-size: 13px; margin: 2px 0 0; text-wrap: pretty; }
.base { margin-top: auto; padding-top: 12px; font-family: var(--mono); font-size: 11px; color: var(--muted); }
.chart { margin-top: 14px; position: relative; }
.chart svg { display: block; overflow: visible; }

/* tiles */
.tile .label { font-size: 13px; color: var(--ink-2); display: flex; justify-content: space-between; gap: 8px; }
.tile .val { font-size: 34px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; margin-top: 10px; font-feature-settings: "tnum"; }
.tile .val small { font-size: 15px; font-weight: 500; color: var(--muted); margin-left: 4px; letter-spacing: 0; }
.delta { font-family: var(--mono); font-size: 12px; margin-top: 6px; display: flex; gap: 6px; align-items: center; color: var(--muted); }
.delta .up-good, .delta .down-good { color: var(--good); }
.delta .up-bad, .delta .down-bad { color: var(--bad); }
.tile .sub { margin-top: 12px; display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--ink-2); }
.tile .sub span b { font-family: var(--mono); font-weight: 500; color: var(--ink); margin-left: 4px; }
.tile .def { font-size: 12px; color: var(--muted); margin-top: 10px; text-wrap: pretty; }
.spark { margin-top: 12px; }

/* legend */
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 12px; font-size: 12px; color: var(--ink-2); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.legend i.line { height: 2px; width: 14px; border-radius: 1px; }

/* svg text */
.tk { font-family: var(--mono); font-size: 11px; fill: var(--muted); }
.lb { font-family: var(--sans); font-size: 12px; fill: var(--ink-2); }
.lbs { font-family: var(--sans); font-size: 12px; fill: var(--ink); font-weight: 500; }
.vl { font-family: var(--mono); font-size: 11.5px; fill: var(--ink); }
.grid-l { stroke: var(--hair); stroke-width: 1; }
.base-l { stroke: var(--axis); stroke-width: 1; }
.hit { fill: transparent; cursor: default; }
.mark { transition: opacity .12s; }
.dim .mark { opacity: .35; }
.dim .mark.on { opacity: 1; }

/* size matrix */
.matrix { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 13px; }
.matrix th { text-align: left; font-weight: 500; color: var(--muted); font-size: 11.5px; font-family: var(--mono); padding: 0 10px 8px 0; border-bottom: 1px solid var(--hair); white-space: nowrap; }
.matrix td { padding: 12px 10px 12px 0; border-bottom: 1px solid var(--hair); vertical-align: middle; }
.matrix tr:last-child td { border-bottom: 0; }
.matrix .size b { font-weight: 600; font-size: 15px; }
.matrix .size div { color: var(--muted); font-size: 11.5px; font-family: var(--mono); }
.meter { display: flex; align-items: center; gap: 10px; min-width: 120px; }
.meter .trk { flex: 1; height: 8px; background: var(--q0); border-radius: 4px; overflow: hidden; min-width: 40px; }
.meter .fil { height: 100%; border-radius: 4px; }
.meter .n { font-family: var(--mono); font-size: 12px; color: var(--ink); white-space: nowrap; min-width: 78px; }
.matrix-wrap { overflow-x: auto; }
.pending { display: inline-flex; gap: 6px; align-items: center; font-size: 11.5px; color: var(--ink-2); background: var(--page); border: 1px dashed var(--axis); border-radius: 6px; padding: 2px 8px; margin-top: 8px; }

.tip { position: fixed; z-index: 20; pointer-events: none; background: var(--tip-bg); color: var(--tip-ink); font-size: 12px; padding: 7px 10px; border-radius: 7px; max-width: 280px; opacity: 0; transform: translateY(4px); transition: opacity .1s, transform .1s; box-shadow: 0 6px 20px rgba(0,0,0,.18); }
.tip.on { opacity: 1; transform: none; }
.tip .t { font-weight: 600; margin-bottom: 3px; }
.tip .r { display: flex; justify-content: space-between; gap: 16px; font-family: var(--mono); font-size: 11.5px; }
.tip .r i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; margin-right: 6px; }
footer { margin-top: 48px; color: var(--muted); font-size: 12px; max-width: 80ch; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }

.error { color: var(--bad); }
`;

const PAGE_BODY = `<header class="top">
  <div class="top-in">
    <div class="brandmark">
      <h1>Usage analytics</h1>
      <span class="asof" id="asof"></span>
    </div>
    <nav class="jump" aria-label="Sections">
      <a href="#last7">Last 7 days</a>
      <a href="#onboarding">Onboarding</a>
      <a href="#use">All use</a>
      <a href="#agents">Agents now</a>
    </nav>
  </div>
</header>

<main class="wrap">
  <div class="facts">
    <span class="chip"><b id="totalUsers"></b> authenticated users</span>
    <span class="chip">Core team excluded from every count</span>
    <span class="chip">All days are UTC</span>
  </div>

  <section id="last7">
    <div class="sec-head">
      <h2>Last 7 days</h2>
      <span class="window" id="last7Window"></span>
      <p class="sec-note">An active day is a UTC day on which the user sent a message to an agent on any surface, or had a scheduled event fire.</p>
    </div>
    <div class="grid" id="tiles"></div>
  </section>

  <section id="onboarding">
    <div class="sec-head">
      <h2>Onboarding</h2>
      <span class="window">COHORTS BY CALENDAR WEEK OF FIRST LOGIN · MON – SUN</span>
      <p class="sec-note" id="cohortNote"></p>
    </div>
    <div class="grid">
      <div class="card c12">
        <h3>Acquisition funnel</h3>
        <p class="q">Where do users drop off during their first three weeks?</p>
        <div class="chart" id="funnel"></div>
        <div class="base" id="funnelBase"></div>
      </div>

      <div class="card c6">
        <h3>Active days in the first week</h3>
        <p class="q">Are new users coming back more often in their first 7 days?</p>
        <div class="chart" id="firstWeek"></div>
        <div class="legend" id="firstWeekLeg"></div>
        <div class="base">% of cohort · first week = 7 days from the day of first login</div>
      </div>

      <div class="card c6">
        <h3>Core features used on day one</h3>
        <p class="q">How many of the five core features does a new user touch on their first day?</p>
        <div class="chart" id="featCount"></div>
        <div class="legend" id="featCountLeg"></div>
        <div class="base">% of cohort · first day = UTC day of first login</div>
      </div>

      <div class="card c12">
        <h3>Day-one use of each feature</h3>
        <p class="q">Which features are new users picking up on their first day, and is that growing?</p>
        <div class="chart" id="smallMult"></div>
        <div class="base">% of cohort that used the feature on its first day · one panel per feature, shared scale · bars are cohorts, oldest to newest</div>
      </div>

      <div class="card c6">
        <h3>Starter kits on day one</h3>
        <p class="q">How do new users start, and which kits do they pick first?</p>
        <div class="chart" id="kitSplit"></div>
        <div class="chart" id="kitDay1"></div>
        <div class="base" id="kitDay1Base"></div>
      </div>

      <div class="card c6">
        <h3>Time until Slack is set up</h3>
        <p class="q">How long after first login does a user first connect Slack?</p>
        <div class="chart" id="slackLag"></div>
        <div class="legend" id="slackLagLeg"></div>
        <div class="base">Slack set up = an agent bound to a Slack channel, or a Slack account connected · % of cohort</div>
      </div>

      <div class="card c12">
        <h3>Time until the onboarding checklist is completed</h3>
        <p class="q">How long after creating a starter-kit agent does a user finish its checklist?</p>
        <div class="chart" id="checkLag"></div>
        <div class="legend" id="checkLagLeg"></div>
        <div class="base">Users with a starter-kit agent · first completion per user, measured from that agent's creation · kits without onboarding excluded · completions are recorded from this release on</div>
      </div>
    </div>
  </section>

  <section id="use">
    <div class="sec-head">
      <h2>All use</h2>
      <span class="window" id="useWindow"></span>
      <p class="sec-note">Everyone, including users still in onboarding. Each point is a full Monday-to-Sunday week, labelled with its Monday; the week in progress is not shown.</p>
    </div>
    <div class="grid">
      <div class="card c7">
        <h3>Weekly activity</h3>
        <p class="q">How often are users using the platform?</p>
        <div class="chart" id="activity"></div>
        <div class="legend" id="activityLeg"></div>
        <div class="base">Active 1+ · Regular 3+ · Super 5+ active days in the week · Abandoned: logged in at least once, 0 active days</div>
      </div>
      <div class="card c5">
        <h3>Longitudinal activity</h3>
        <p class="q">Of users past their first three weeks, who keeps coming back every week?</p>
        <div class="chart" id="longi"></div>
        <div class="legend" id="longiLeg"></div>
        <div class="base" id="longiBase"></div>
      </div>

      <div class="card c7">
        <h3>Agents created</h3>
        <p class="q">Is agent creation picking up, and how much of it comes from starter kits?</p>
        <div class="chart" id="agentsWk"></div>
        <div class="legend" id="agentsWkLeg"></div>
        <div class="base">Agents created per week · sub-agents started by other agents excluded</div>
      </div>
      <div class="card c5">
        <h3>Agents per user</h3>
        <p class="q">How many agents have users built?</p>
        <div class="chart" id="perUser"></div>
        <div class="base" id="perUserBase"></div>
      </div>

      <div class="card c6">
        <h3>Core feature adoption</h3>
        <p class="q">How many users have ever used each core feature?</p>
        <div class="chart" id="featUse"></div>
        <div class="base" id="featUseBase"></div>
      </div>
      <div class="card c6">
        <h3>Starter kit popularity</h3>
        <p class="q">Which kits are agents created from?</p>
        <div class="chart" id="kitUse"></div>
        <div class="base" id="kitUseBase"></div>
      </div>

      <div class="card c12">
        <h3>Onboarding checklist among starter-kit users</h3>
        <p class="q">Of users who created a starter-kit agent, how many finished a checklist?</p>
        <div class="chart" id="checkState"></div>
        <div class="base" id="checkStateBase"></div>
      </div>
    </div>
  </section>

  <section id="agents">
    <div class="sec-head">
      <h2>Agents right now</h2>
      <span class="window" id="agentsWindow"></span>
      <p class="sec-note">Read from the live agents when the report was generated. Deleted agents are not counted.</p>
    </div>
    <div class="grid">
      <div class="card c7">
        <h3>Size, always-on and memory</h3>
        <p class="q">What size are agents, which hold their compute around the clock, and which sizes run out of memory?</p>
        <div class="matrix-wrap"><table class="matrix" id="matrix"></table></div>
        <div class="base">1 slot = the default agent size · always on = set never to hibernate · out of memory = at least one restart for exceeding memory in 30 days, recorded from this release on</div>
      </div>
      <div class="card c5">
        <h3>Disk size</h3>
        <p class="q">How much workspace storage do agents have?</p>
        <div class="chart" id="disk"></div>
        <div class="base">Users can't resize disk; kits set smaller disks, the team sets larger ones on request</div>
      </div>
      <div class="card c6">
        <h3>Connections per agent</h3>
        <p class="q">How many connections does each agent hold?</p>
        <div class="chart" id="conns"></div>
        <div class="base">Includes knowledge-base connections</div>
      </div>
      <div class="card c6">
        <h3>Knowledge bases per agent</h3>
        <p class="q">How many shared knowledge bases is each agent connected to?</p>
        <div class="chart" id="kbs"></div>
        <div class="base">Knowledge-base connections granted to the agent</div>
      </div>
    </div>
  </section>

  <footer>Value proposition and the "notified of access" funnel stage are not part of this report yet.</footer>
</main>

<div class="tip" id="tip" role="tooltip"></div>
`;

const PAGE_SCRIPT = `(() => {
const R = JSON.parse(document.getElementById("report-data").textContent);
const NS = "http://www.w3.org/2000/svg";
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmt = (iso) => { const [, m, d] = iso.split("-"); return \`\${Number(d)} \${MONTHS[Number(m) - 1]}\`; };
const fmtUp = (iso) => fmt(iso).toUpperCase();
const col = (k) => k === "q2b" ? "color-mix(in srgb, var(--q2) 50%, var(--q3))" : \`var(--\${k})\`;
const ink = (k) => (k.startsWith("q") ? \`var(--\${k === "q2b" ? "q2" : k}-ink)\` : "#fff");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const svg = (w, h) => { const s = document.createElementNS(NS, "svg"); s.setAttribute("width", w); s.setAttribute("height", h); s.setAttribute("viewBox", \`0 0 \${w} \${h}\`); return s; };
const el = (tag, attrs, parent, text) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; };
const niceScale = (raw) => { const m = Math.max(raw, 4); const p = Math.pow(10, Math.floor(Math.log10(m / 4))); const step = [1, 2, 2.5, 5, 10].map((x) => x * p).find((st) => Math.ceil(m / st) <= 5); const k = Math.ceil(m / step); return { max: k * step, step, k }; };
const barPath = (x, y, w, h, r = 4) => { r = Math.max(0, Math.min(r, h, w / 2)); return \`M\${x},\${y + h}V\${y + r}Q\${x},\${y} \${x + r},\${y}H\${x + w - r}Q\${x + w},\${y} \${x + w},\${y + r}V\${y + h}Z\`; };
const hbarPath = (x, y, w, h, r = 4) => { r = Math.max(0, Math.min(r, w, h / 2)); return \`M\${x},\${y}H\${x + w - r}Q\${x + w},\${y} \${x + w},\${y + r}V\${y + h - r}Q\${x + w},\${y + h} \${x + w - r},\${y + h}H\${x}Z\`; };
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const setText = (id, text) => { document.getElementById(id).textContent = text; };

const tip = document.getElementById("tip");
function moveTip(e) {
  const pad = 14, r = tip.getBoundingClientRect();
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
function showTip(e, html) { tip.innerHTML = html; tip.classList.add("on"); moveTip(e); }
function hideTip() { tip.classList.remove("on"); }
function bindTip(node, html, group) {
  node.addEventListener("pointerenter", (e) => { showTip(e, html); if (group) { group.classList.add("dim"); node.classList.add("on"); } });
  node.addEventListener("pointermove", moveTip);
  node.addEventListener("pointerleave", () => { hideTip(); if (group) { group.classList.remove("dim"); node.classList.remove("on"); } });
}
const row = (sw, k, v) => \`<div class="r"><span>\${sw ? \`<i style="background:\${sw}"></i>\` : ""}\${esc(k)}</span><span>\${esc(v)}</span></div>\`;
function legend(id, cats, ramp, line) {
  document.getElementById(id).innerHTML = cats.map((c, i) => \`<span><i class="\${line ? "line" : ""}" style="background:\${col(ramp[i])}"></i>\${esc(c)}</span>\`).join("");
}
function emptyNote(host, text) { host.innerHTML = \`<p class="q">\${esc(text)}</p>\`; }

function sparkline(vals, w, h) {
  const s = svg(w, h);
  const pts = vals.map((v, i) => [i, v]).filter(([, v]) => v !== null);
  if (pts.length < 2) return s;
  const ys = pts.map(([, v]) => v), max = Math.max(...ys), min = Math.min(...ys);
  const x = (i) => 2 + (i * (w - 6)) / (vals.length - 1), y = (v) => h - 3 - ((v - min) / (max - min || 1)) * (h - 8);
  const line = pts.map(([i, v]) => \`\${x(i)},\${y(v)}\`).join(" ");
  el("polygon", { points: \`\${x(pts[0][0])},\${h} \${line} \${x(pts.at(-1)[0])},\${h}\`, fill: "var(--accent)", opacity: 0.08 }, s);
  el("polyline", { points: line, fill: "none", stroke: "var(--accent)", "stroke-width": 1.75, "stroke-linejoin": "round", "stroke-linecap": "round" }, s);
  el("circle", { cx: x(pts.at(-1)[0]), cy: y(pts.at(-1)[1]), r: 3, fill: "var(--accent)", stroke: "var(--surface)", "stroke-width": 1.5 }, s);
  return s;
}

function renderTiles() {
  const L = R.last7;
  const tiles = [
    { label: "Weekly active users", t: L.weeklyActive, good: "up", sub: [["3+ days", L.weeklyActive.regular], ["5+ days", L.weeklyActive.super]], def: "1+ active days" },
    { label: "Weekly abandoned", t: L.weeklyAbandoned, good: "down", def: "Logged in at least once, 0 active days in the last 7" },
    { label: "Longitudinally active", t: L.longitudinallyActive, of: L.longitudinallyActive.eligible, good: "up", def: "1+ active days in each of the last 3 weeks, of users 21+ days past first login" },
    { label: "Agents created", t: L.agentsCreated, good: "up", sub: [["from kits", L.agentsCreated.fromKits], ["other", L.agentsCreated.other]] },
    { label: "Starter kit adoption", t: L.starterKitAdoption, unit: "%", pp: true, good: "up", def: "Share of new agents created from a starter kit" },
    { label: "Onboarding conversion", t: L.onboardingConversion, unit: "%", pp: true, good: "up", def: \`Reached 3 active days in their first week · \${L.onboardingConversion.users} users whose first week ended in the last 7 days\` },
  ];
  const g = document.getElementById("tiles"); g.innerHTML = "";
  for (const t of tiles) {
    const c = document.createElement("div"); c.className = "card tile c4";
    const v = t.t.value, p = t.t.previous, unit = t.unit || "";
    let delta = \`<span>no earlier data</span>\`;
    if (v !== null && p !== null) {
      const d = v - p, dir = d > 0 ? "up" : d < 0 ? "down" : "flat";
      const cls = dir === "flat" ? "" : \`\${dir}-\${dir === t.good ? "good" : "bad"}\`;
      const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "■";
      delta = \`<span class="\${cls}">\${arrow} \${d > 0 ? "+" : ""}\${d}\${t.pp ? " pp" : ""}</span><span>vs previous 7 days (\${p}\${unit})</span>\`;
    }
    c.innerHTML = \`<div class="label"><span>\${esc(t.label)}</span></div>
      <div class="val">\${v === null ? "–" : v}\${v !== null && unit ? \`<small>\${unit}</small>\` : ""}\${t.of !== undefined ? \`<small>of \${t.of}</small>\` : ""}</div>
      <div class="delta">\${delta}</div>
      \${t.sub ? \`<div class="sub">\${t.sub.map(([k, n]) => \`<span>\${esc(k)}<b>\${n}</b></span>\`).join("")}</div>\` : ""}
      \${t.def ? \`<div class="def">\${esc(t.def)}</div>\` : ""}\`;
    const sp = document.createElement("div"); sp.className = "spark"; c.appendChild(sp); g.appendChild(c);
    sp.appendChild(sparkline(t.t.trend, Math.max(120, sp.clientWidth), 34));
  }
}

function stacked100(id, panel, ramp) {
  const host = document.getElementById(id); host.innerHTML = "";
  if (!panel.rows.length) { emptyNote(host, "No cohort has completed its first week yet."); return; }
  const W = host.clientWidth, lw = 64, nw = W > 480 ? 44 : 0, bh = 22, gap = 10;
  const H = panel.rows.length * (bh + gap) - gap;
  const s = svg(W, H), g = el("g", {}, s); host.appendChild(s);
  const bw = W - lw - nw;
  panel.rows.forEach((r, ri) => {
    const y = ri * (bh + gap), label = fmt(r.weekStart);
    el("text", { x: 0, y: y + bh / 2 + 4, class: "lb" }, g, label);
    if (nw) el("text", { x: W, y: y + bh / 2 + 4, class: "tk", "text-anchor": "end" }, g, \`n=\${r.size}\`);
    if (!r.size) { el("rect", { x: lw, y, width: bw, height: bh, rx: 4, fill: "var(--page)" }, g); el("text", { x: lw + 10, y: y + bh / 2 + 4, class: "tk" }, g, "no users"); return; }
    let x = lw;
    const tipHtml = \`<div class="t">Week of \${esc(label)}</div>\` + panel.categories.map((c, k) => row(col(ramp[k]), c, \`\${pct(r.counts[k], r.size)}% · \${r.counts[k]}\`)).join("") + \`<div class="r" style="opacity:.7;margin-top:3px"><span>cohort</span><span>\${r.size} users</span></div>\`;
    r.counts.forEach((v, ci) => {
      if (!v) return;
      const w = (v / r.size) * bw;
      const first = x === lw, last = Math.abs(x + w - (lw + bw)) < 0.5;
      const gw = Math.max(1, w - (last ? 0 : 2));
      const m = el("rect", { x, y, width: gw, height: bh, rx: (first || last) ? 4 : 1.5, fill: col(ramp[ci]), class: "mark" }, g);
      if (w > 30) el("text", { x: x + gw / 2, y: y + bh / 2 + 4, "text-anchor": "middle", "font-family": "var(--mono)", "font-size": 11, fill: ink(ramp[ci]), "pointer-events": "none" }, g, \`\${pct(v, r.size)}%\`);
      bindTip(m, tipHtml, g);
      x += w;
    });
  });
}

function oneBar(id, shares, ramp, showCounts) {
  const host = document.getElementById(id); host.innerHTML = "";
  const tot = shares.reduce((a, b) => a + b.count, 0);
  if (!tot) { emptyNote(host, "No users yet."); return; }
  const W = host.clientWidth, bh = 34, s = svg(W, bh + 26), g = el("g", {}, s); host.appendChild(s);
  let x = 0;
  shares.forEach((sh, i) => {
    if (!sh.count) return;
    const w = (sh.count / tot) * W, last = Math.abs(x + w - W) < 0.5, gw = Math.max(1, w - (last ? 0 : 2));
    const m = el("rect", { x, y: 0, width: gw, height: bh, rx: 4, fill: col(ramp[i]), class: "mark" }, g);
    const p = pct(sh.count, tot);
    if (w > 48) el("text", { x: x + 10, y: bh / 2 + 5, "font-family": "var(--mono)", "font-size": 12.5, "font-weight": 500, fill: ink(ramp[i]), "pointer-events": "none" }, g, showCounts ? \`\${sh.count}\` : \`\${p}%\`);
    if (w > 60) el("text", { x: x + 1, y: bh + 18, class: "lb" }, g, w > 140 ? \`\${sh.label} · \${p}%\` : \`\${p}%\`);
    bindTip(m, \`<div class="t">\${esc(sh.label)}</div>\` + row(null, "users", \`\${sh.count} (\${p}%)\`), g);
    x += w;
  });
}

function funnel(id, stages) {
  const host = document.getElementById(id); host.innerHTML = "";
  const base = stages[0].count;
  if (!base) { emptyNote(host, "No users yet."); return; }
  const W = host.clientWidth, H = 250, bot = 44, n = stages.length;
  const gap = W > 700 ? 14 : 6, bw = (W - gap * (n - 1)) / n;
  const sc = (v) => (v / base) * (H - 26 - bot);
  const s = svg(W, H), g = el("g", {}, s); host.appendChild(s);
  el("line", { x1: 0, x2: W, y1: H - bot, y2: H - bot, class: "base-l" }, g);
  stages.forEach((st, i) => {
    const x = i * (bw + gap), h = sc(st.count), y = H - bot - h;
    const sub = i === n - 1;
    if (sub) {
      const sx = x - gap / 2;
      el("line", { x1: sx, x2: sx, y1: 4, y2: H - bot + 36, stroke: "var(--axis)", "stroke-dasharray": "2 4" }, g);
      el("text", { x: x + bw / 2, y: 12, "text-anchor": "middle", class: "tk" }, g, \`of \${st.base} users 21+ days in\`);
    }
    if (i > 0 && !sub) {
      const prev = stages[i - 1].count, ph = sc(prev);
      el("rect", { x, y: H - bot - ph, width: bw, height: Math.max(0, ph - h), fill: "none", stroke: "var(--axis)", "stroke-dasharray": "3 3", rx: 4 }, g);
      const lost = prev - st.count;
      if (ph - h > 16) el("text", { x: x + bw / 2, y: H - bot - ph + (ph - h) / 2 + 4, "text-anchor": "middle", "font-family": "var(--mono)", "font-size": 11, fill: "var(--bad)" }, g, \`−\${lost} · \${pct(lost, prev)}%\`);
    }
    const m = el("path", { d: barPath(x, y, bw, h, 5), fill: sub ? "var(--q3)" : "var(--q2)", class: "mark" }, g);
    const inside = h > 42;
    el("text", { x: x + bw / 2, y: inside ? y + 20 : y - 22, "text-anchor": "middle", "font-family": "var(--sans)", "font-size": W > 700 ? 18 : 14, "font-weight": 600, fill: inside ? "#fff" : "var(--ink)", "pointer-events": "none" }, g, st.count);
    el("text", { x: x + bw / 2, y: inside ? y + 36 : y - 8, "text-anchor": "middle", "font-family": "var(--mono)", "font-size": 11, fill: inside ? "#fff" : "var(--ink-2)", opacity: 0.85, "pointer-events": "none" }, g, \`\${pct(st.count, st.base)}%\`);
    const words = st.label.split(" "), half = Math.ceil(words.length / 2);
    el("text", { x: x + bw / 2, y: H - bot + 18, "text-anchor": "middle", class: "lbs" }, g, W > 820 ? st.label : words.slice(0, half).join(" "));
    if (W <= 820 && words.length > half) el("text", { x: x + bw / 2, y: H - bot + 33, "text-anchor": "middle", class: "lbs" }, g, words.slice(half).join(" "));
    const prev = i && !sub ? stages[i - 1].count : null;
    bindTip(m, \`<div class="t">\${esc(st.label)}</div>\` + row(null, "users", st.count) + row(null, \`of \${st.base} users\`, \`\${pct(st.count, st.base)}%\`) + (prev ? row(null, "kept from previous step", \`\${pct(st.count, prev)}%\`) : ""), g);
  });
}

function smallMult(id, panels, weeks, sizes) {
  const host = document.getElementById(id); host.innerHTML = "";
  if (!weeks.length) { emptyNote(host, "No cohort has completed its first week yet."); return; }
  const W = host.clientWidth, cols = W > 900 ? 6 : W > 520 ? 3 : 2, gap = 18, pw = (W - gap * (cols - 1)) / cols;
  const ph = 112, head = 22, H = Math.ceil(panels.length / cols) * (ph + head + 14);
  const { max } = niceScale(Math.max(...panels.flatMap((p) => p.percents)));
  const s = svg(W, H); host.appendChild(s);
  panels.forEach((p, i) => {
    const cx = (i % cols) * (pw + gap), cy = Math.floor(i / cols) * (ph + head + 14);
    const g = el("g", { transform: \`translate(\${cx},\${cy})\` }, s);
    const c = i === 0 ? "q0" : "s1";
    el("text", { x: 0, y: 13, class: "lbs" }, g, p.label);
    el("text", { x: pw, y: 13, class: "vl", "text-anchor": "end" }, g, \`\${p.percents.at(-1)}%\`);
    const by = head + ph - 14;
    [0, max / 2, max].forEach((t) => { const yy = by - (t / max) * (ph - 24); el("line", { x1: 0, x2: pw, y1: yy, y2: yy, class: t ? "grid-l" : "base-l" }, g); if (i % cols === 0 && t) el("text", { x: 0, y: yy - 3, class: "tk" }, g, \`\${t}%\`); });
    const n = p.percents.length, bg = 3, bw = (pw - bg * (n - 1)) / n;
    p.percents.forEach((v, k) => {
      const h = (v / max) * (ph - 24), x = k * (bw + bg);
      const m = el("path", { d: barPath(x, by - h, bw, Math.max(h, 0.5), 3), fill: col(c), opacity: k === n - 1 ? 1 : 0.55, class: "mark" }, g);
      bindTip(m, \`<div class="t">\${esc(p.label)}</div>\` + row(null, \`week of \${fmt(weeks[k])}\`, \`\${v}%\`) + row(null, "cohort", \`\${sizes[k]} users\`));
    });
    el("text", { x: 0, y: by + 13, class: "tk" }, g, fmt(weeks[0]));
    el("text", { x: pw, y: by + 13, class: "tk", "text-anchor": "end" }, g, fmt(weeks.at(-1)));
  });
}

function hbars(id, shares, opts) {
  const host = document.getElementById(id); host.innerHTML = "";
  if (!shares.length) { emptyNote(host, opts.empty || "Nothing yet."); return; }
  const W = host.clientWidth, bh = opts.bh || 18, gap = opts.gap || 9, lw = opts.lw || 128, vw = 74;
  const H = shares.length * (bh + gap) - gap, s = svg(W, H), g = el("g", {}, s); host.appendChild(s);
  const max = Math.max(1, ...shares.map((d) => d.count)), bw = W - lw - vw;
  shares.forEach((sh, i) => {
    const y = i * (bh + gap), w = Math.max(2, (sh.count / max) * bw);
    el("text", { x: lw - 10, y: y + bh / 2 + 4, "text-anchor": "end", class: "lb" }, g, sh.label);
    el("rect", { x: lw, y, width: bw, height: bh, rx: 4, fill: "var(--page)" }, g);
    const m = el("path", { d: hbarPath(lw, y, w, bh), fill: col(opts.color || "s1"), class: "mark" }, g);
    const text = opts.pctOnly ? \`\${pct(sh.count, opts.total)}%\` : \`\${sh.count} · \${pct(sh.count, opts.total)}%\`;
    el("text", { x: lw + w + 8, y: y + bh / 2 + 4, class: "vl" }, g, text);
    bindTip(m, \`<div class="t">\${esc(sh.label)}</div>\` + row(null, opts.unit, \`\${sh.count} · \${pct(sh.count, opts.total)}%\`), g);
  });
}

function columns(id, shares, opts) {
  const host = document.getElementById(id); host.innerHTML = "";
  const W = host.clientWidth, H = opts.h || 190, top = 20, bot = 26;
  const tot = shares.reduce((a, b) => a + b.count, 0), { max } = niceScale(Math.max(...shares.map((d) => d.count)));
  const s = svg(W, H), g = el("g", {}, s); host.appendChild(s);
  const n = shares.length, gap = Math.min(18, W / n / 4), bw = (W - gap * (n - 1)) / n;
  el("line", { x1: 0, x2: W, y1: H - bot, y2: H - bot, class: "base-l" }, g);
  shares.forEach((sh, i) => {
    const h = (sh.count / max) * (H - top - bot), x = i * (bw + gap), y = H - bot - h;
    const m = el("path", { d: barPath(x, y, bw, Math.max(h, 0.5), 4), fill: col("q2"), class: "mark" }, g);
    el("text", { x: x + bw / 2, y: y - 6, "text-anchor": "middle", class: "vl" }, g, \`\${sh.count}\`);
    el("text", { x: x + bw / 2, y: H - bot + 16, "text-anchor": "middle", class: "lb" }, g, sh.label);
    bindTip(m, \`<div class="t">\${esc(sh.label)}</div>\` + row(null, opts.unit, \`\${sh.count} · \${pct(sh.count, tot)}%\`), g);
  });
}

function lines(id, xs, series, colors, legId) {
  const host = document.getElementById(id); host.innerHTML = "";
  const W = host.clientWidth, H = 230, L = 34, R2 = W > 520 ? 82 : 12, T = 10, B = 26;
  const { max, step, k: nt } = niceScale(Math.max(...series.flatMap((s) => s.values)));
  const x = (i) => L + (i * (W - L - R2)) / Math.max(1, xs.length - 1), y = (v) => T + (1 - v / max) * (H - T - B);
  const s = svg(W, H); host.appendChild(s);
  for (let k = 0; k <= nt; k++) { const v = step * k; el("line", { x1: L, x2: W - R2, y1: y(v), y2: y(v), class: k ? "grid-l" : "base-l" }, s); el("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end", class: "tk" }, s, Math.round(v)); }
  xs.forEach((lab, i) => { if (xs.length <= 6 || i % 2 === 0 || i === xs.length - 1) el("text", { x: x(i), y: H - 8, "text-anchor": "middle", class: "tk" }, s, fmt(lab)); });
  const ends = [];
  series.forEach((sr, si) => {
    el("polyline", { points: sr.values.map((v, i) => \`\${x(i)},\${y(v)}\`).join(" "), fill: "none", stroke: col(colors[si]), "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, s);
    el("circle", { cx: x(sr.values.length - 1), cy: y(sr.values.at(-1)), r: 4, fill: col(colors[si]), stroke: "var(--surface)", "stroke-width": 2 }, s);
    ends.push({ name: sr.label, v: sr.values.at(-1), y: y(sr.values.at(-1)) });
  });
  if (R2 > 20) {
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    for (const e of ends) {
      const t = el("text", { x: W - R2 + 10, y: e.y + 4, class: "lb" }, s);
      el("tspan", { "font-family": "var(--mono)", fill: "var(--ink)" }, t, \`\${e.v} \`);
      el("tspan", { fill: "var(--muted)" }, t, e.name);
    }
  }
  const cross = el("line", { y1: T, y2: H - B, stroke: "var(--axis)", "stroke-width": 1, opacity: 0 }, s);
  const dots = series.map((_, si) => el("circle", { r: 4.5, fill: col(colors[si]), stroke: "var(--surface)", "stroke-width": 2, opacity: 0 }, s));
  const hit = el("rect", { x: L, y: T, width: Math.max(0, W - L - R2), height: H - T - B, class: "hit" }, s);
  hit.addEventListener("pointermove", (e) => {
    const r = s.getBoundingClientRect(), px = e.clientX - r.left;
    const i = Math.max(0, Math.min(xs.length - 1, Math.round(((px - L) / (W - L - R2)) * (xs.length - 1))));
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("opacity", 1);
    series.forEach((sr, k) => { dots[k].setAttribute("cx", x(i)); dots[k].setAttribute("cy", y(sr.values[i])); dots[k].setAttribute("opacity", 1); });
    showTip(e, \`<div class="t">Week of \${esc(fmt(xs[i]))}</div>\` + series.map((sr, k) => row(col(colors[k]), sr.label, sr.values[i])).join(""));
  });
  hit.addEventListener("pointerleave", () => { hideTip(); cross.setAttribute("opacity", 0); dots.forEach((d) => d.setAttribute("opacity", 0)); });
  legend(legId, series.map((sr) => sr.label), colors, true);
}

function agentsWeekly(id, weeks, kit, other) {
  const host = document.getElementById(id); host.innerHTML = "";
  const W = host.clientWidth, H = 210, L = 30, T = 18, B = 26;
  const tot = kit.map((k, i) => k + other[i]), { max, step, k: nt } = niceScale(Math.max(...tot));
  const s = svg(W, H), g = el("g", {}, s); host.appendChild(s);
  const y = (v) => T + (1 - v / max) * (H - T - B), n = weeks.length, gap = Math.min(16, (W - L) / n / 3), bw = (W - L - gap * (n - 1)) / n;
  for (let k = 0; k <= nt; k++) { const v = step * k; el("line", { x1: L, x2: W, y1: y(v), y2: y(v), class: k ? "grid-l" : "base-l" }, g); el("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end", class: "tk" }, g, Math.round(v)); }
  weeks.forEach((wk, i) => {
    const x = L + i * (bw + gap), yo = y(other[i]), yk = y(tot[i]);
    const grp = el("g", { class: "mark" }, g);
    if (kit[i]) {
      if (other[i]) el("rect", { x, y: yo, width: bw, height: H - B - yo, fill: "var(--s3)" }, grp);
      el("path", { d: barPath(x, yk, bw, Math.max(0, yo - yk - (other[i] ? 2 : 0)), 4), fill: "var(--s1)" }, grp);
    } else if (other[i]) {
      el("path", { d: barPath(x, yo, bw, H - B - yo, 4), fill: "var(--s3)" }, grp);
    }
    el("text", { x: x + bw / 2, y: yk - 6, "text-anchor": "middle", class: "vl" }, g, tot[i]);
    if (n <= 6 || i % 2 === 0 || i === n - 1 || W > 560) el("text", { x: x + bw / 2, y: H - 8, "text-anchor": "middle", class: "tk" }, g, fmt(wk));
    el("rect", { x, y: T, width: bw, height: H - T - B, class: "hit" }, grp);
    bindTip(grp, \`<div class="t">Week of \${esc(fmt(wk))}</div>\` + row("var(--s1)", "From a starter kit", kit[i]) + row("var(--s3)", "From scratch", other[i]) + row(null, "Total", tot[i]), g);
  });
  legend("agentsWkLeg", ["From a starter kit", "From scratch"], ["s1", "s3"]);
}

function matrix(sizes) {
  const t = document.getElementById("matrix"), total = sizes.reduce((a, b) => a + b.agents, 0);
  const labels = { "1x": ["1×", "1 slot"], "2x": ["2×", "2 slots"], "4x": ["4×", "4 slots"], custom: ["Custom", "set by a kit or the team"] };
  const meter = (v, of, c) => { const p = pct(v, of); return \`<div class="meter"><div class="trk"><div class="fil" style="width:\${Math.max(p, v ? 2 : 0)}%;background:\${c}"></div></div><span class="n">\${p}% · \${v}</span></div>\`; };
  t.innerHTML = \`<thead><tr><th>Size</th><th>Agents</th><th>Always on</th><th>Out of memory · 30 d</th></tr></thead><tbody>\` +
    sizes.map((r) => \`<tr><td class="size"><b>\${labels[r.size][0]}</b><div>\${labels[r.size][1]}</div></td>
      <td>\${meter(r.agents, total, "var(--q2)")}</td><td>\${meter(r.alwaysOn, r.agents, "var(--s4)")}</td><td>\${meter(r.outOfMemory, r.agents, "var(--bad)")}</td></tr>\`).join("") + \`</tbody>\`;
}

function renderText() {
  const O = R.onboarding, A = R.allUse;
  setText("asof", \`as of \${R.generatedAt.slice(0, 16).replace("T", " ")} UTC\`);
  setText("totalUsers", R.totalUsers);
  setText("last7Window", \`\${fmtUp(R.last7.from)} – \${fmtUp(R.last7.to)} · ROLLING · COMPARED WITH THE 7 DAYS BEFORE\`);
  setText("cohortNote", O.cohortWeeks.length ? \`A cohort appears once every member has had at least 7 days since first login, so the newest shown is the week of \${fmt(O.cohortWeeks.at(-1))}.\` : "A cohort appears once every member has had at least 7 days since first login.");
  const weekThree = O.funnel.at(-1);
  setText("funnelBase", \`First five columns: the \${O.funnel[0].count} users whose first login was at least 4 days ago, so each could have reached a 4th active day; active days counted within each user's first 21 days · Active in week 3: only the \${weekThree.base} users whose first login was at least 21 days ago, with an active day in days 15–21\`);
  setText("kitDay1Base", \`Split: % of users in the cohorts above (n = \${O.cohortSizes.reduce((a, b) => a + b, 0)}) · kits: % of the \${O.firstDayKitUsers} users who created a starter-kit agent on their first day\`);
  setText("useWindow", \`CALENDAR WEEKS · MON – SUN · LAST COMPLETE WEEK \${fmtUp(A.weeks.at(-1))}\`);
  setText("longiBase", \`Same thresholds, met in each of the 3 weeks ending that week · base grows from \${A.longitudinalEligible[0]} to \${A.longitudinalEligible.at(-1)} users\`);
  setText("perUserBase", \`All \${R.totalUsers} authenticated users · agents ever created\`);
  setText("featUseBase", \`Of \${R.totalUsers} authenticated users\`);
  setText("kitUseBase", \`\${A.kitPopularity.reduce((a, b) => a + b.count, 0)} agents created from starter kits\`);
  setText("checkStateBase", \`\${A.checklistState.reduce((a, b) => a + b.count, 0)} users · a user counts as completed if any of their kit agents completed, otherwise as started if any checklist exists\`);
  setText("agentsWindow", \`CURRENT STATE · \${R.agentsNow.total} LIVE AGENTS\`);
}

const RAMPS = {
  firstWeek: ["q0", "q1", "q2", "q3"],
  featCount: ["q0", "q1", "q2", "q2b", "q3", "q4"],
  slackLag: ["q3", "q2", "q1", "q0"],
  checkLag: ["q3", "q2", "q1", "s4", "q0"],
  activity: ["s1", "s3", "s5", "s2"],
};

function renderAll() {
  const O = R.onboarding, A = R.allUse, N = R.agentsNow;
  renderTiles();
  funnel("funnel", O.funnel);
  stacked100("firstWeek", O.firstWeekActiveDays, RAMPS.firstWeek); legend("firstWeekLeg", O.firstWeekActiveDays.categories, RAMPS.firstWeek);
  stacked100("featCount", O.firstDayFeatureCount, RAMPS.featCount); legend("featCountLeg", O.firstDayFeatureCount.categories, RAMPS.featCount);
  smallMult("smallMult", O.firstDayFeatureUse, O.cohortWeeks, O.cohortSizes);
  oneBar("kitSplit", O.firstDayStart, ["s1", "s3", "q0"], false);
  hbars("kitDay1", O.firstDayKits, { total: O.firstDayKitUsers, unit: "users", lw: 136, pctOnly: true, empty: "No starter-kit agents created on a first day yet." });
  stacked100("slackLag", O.slackSetup, RAMPS.slackLag); legend("slackLagLeg", O.slackSetup.categories, RAMPS.slackLag);
  stacked100("checkLag", O.checklistCompletion, RAMPS.checkLag); legend("checkLagLeg", O.checklistCompletion.categories, RAMPS.checkLag);
  lines("activity", A.weeks, A.activity, RAMPS.activity, "activityLeg");
  lines("longi", A.longitudinalWeeks, A.longitudinal, RAMPS.activity, "longiLeg");
  agentsWeekly("agentsWk", A.weeks, A.agentsCreated.fromKits, A.agentsCreated.other);
  columns("perUser", A.agentsPerUser, { unit: "users" });
  hbars("featUse", A.featureAdoption, { total: R.totalUsers, unit: "users", lw: 120, bh: 22, gap: 12 });
  hbars("kitUse", A.kitPopularity, { total: A.kitPopularity.reduce((a, b) => a + b.count, 0), unit: "agents", lw: 136, empty: "No agents created from starter kits yet." });
  oneBar("checkState", A.checklistState, ["s3", "s4", "q0"], true);
  matrix(N.sizes);
  columns("disk", N.disk, { unit: "agents", h: 200 });
  columns("conns", N.connections, { unit: "agents" });
  columns("kbs", N.knowledgeBases, { unit: "agents" });
}

renderText();
let raf, lastW = 0;
const ro = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w === lastW) return; lastW = w; cancelAnimationFrame(raf); raf = requestAnimationFrame(renderAll); });
ro.observe(document.querySelector("main"));
})();
`;

function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function page(body: string, script: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    "<title>Usage analytics</title>",
    `<link rel="stylesheet" href="${FONTS}" />`,
    `<style>${PAGE_STYLE}</style>`,
    "</head>",
    "<body>",
    body,
    script,
    "</body>",
    "</html>",
  ].join("\n");
}

export function renderAnalyticsPage(report: AnalyticsReport): string {
  return page(
    PAGE_BODY,
    `<script type="application/json" id="report-data">${embedJson(report)}</script>\n<script>${PAGE_SCRIPT}</script>`,
  );
}

export function renderAnalyticsErrorPage(reason: string): string {
  return page(
    `<main class="wrap"><h1>Usage analytics</h1><p class="error">The report could not be built: ${escapeHtml(reason)}</p></main>`,
    "",
  );
}
