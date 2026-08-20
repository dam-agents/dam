export const STOCK_DASHBOARD_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Experiment</title>
<style>
  :root {
    color-scheme: light dark;
    /* --bg matches the app shell (#ffffff / #161616) so the iframe blends in
       the dock, while a downloaded results page stays readable standalone. */
    --bg: #ffffff;
    --fg: #18181b;
    --muted: #71717a;
    --border: #e4e4e7;
    --card: #ffffff;
    --chip: #f4f4f5;
    --accent: #3b82f6;
    --green: #059669;
    --red: #dc2626;
    --amber: #d97706;
    --violet: #7c3aed;
    --cyan: #0891b2;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #161616;
      --fg: #e4e4e7;
      --muted: #a1a1aa;
      --border: #2e2e33;
      --card: rgba(255,255,255,0.02);
      --chip: rgba(255,255,255,0.07);
      --accent: #60a5fa;
      --green: #34d399;
      --red: #f87171;
      --amber: #fbbf24;
      --violet: #a78bfa;
      --cyan: #22d3ee;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 14px 16px 18px;
    font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--fg); background: var(--bg);
    -webkit-font-smoothing: antialiased;
  }
  .muted { color: var(--muted); }
  .num { font-variant-numeric: tabular-nums; }
  .empty { padding: 56px 12px; text-align: center; color: var(--muted); font-size: 13px; }

  .head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .head .name { font-size: 14px; font-weight: 600; letter-spacing: -0.2px; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pill { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border);
    background: var(--chip); border-radius: 999px; padding: 1px 9px 1px 7px;
    font-size: 11px; font-weight: 500; color: var(--muted); }
  .pill .pdot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
  .pill.running { color: var(--accent); } .pill.running .pdot { background: var(--accent); }
  .pill.completed { color: var(--green); } .pill.completed .pdot { background: var(--green); }
  .pill.failed { color: var(--red); } .pill.failed .pdot { background: var(--red); }
  .pill.stopped { color: var(--amber); } .pill.stopped .pdot { background: var(--amber); }
  .drift-note { margin-top: 4px; font-size: 12px; color: var(--amber); }

  .stages { margin: 16px 0 4px; display: flex; flex-direction: column; }
  .lvl { display: flex; flex-wrap: wrap; gap: 2px 24px; }
  /* Parallel branches share a level: bracketed by a left rail so the
     grouping survives wrapping in a narrow dock. */
  .lvl.parallel { border-left: 2px solid var(--border); border-radius: 2px;
    padding-left: 12px; margin-left: 5px; }
  .lvl-gap { width: 2px; height: 12px; border-radius: 1px;
    background: var(--border); margin: 2px 0 2px 5px; }
  .stage { min-width: 130px; }
  .sdot { display: inline-block; width: 12px; height: 12px; flex: 0 0 auto;
    border-radius: 50%; background: var(--border); }
  .sdot.done { background: var(--green); }
  .sdot.bad { background: var(--red); }
  .sdot.live { background: var(--accent); animation: ping 1.8s cubic-bezier(0,0,.2,1) infinite; }
  @keyframes ping {
    0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent); }
    100% { box-shadow: 0 0 0 8px transparent; }
  }
  .srow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .srow .sname { font-weight: 600; font-size: 13px; }
  .sdesc { margin: 2px 0 0 20px; font-size: 11.5px; line-height: 1.35;
    color: var(--muted); max-width: 240px; }
  .srow .sdrift { font-size: 11px; color: var(--amber); border: 1px dashed var(--amber);
    border-radius: 6px; padding: 0 5px; }
  .smeta { margin: 1px 0 8px 20px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    font-size: 12px; color: var(--muted); }
  .smeta .live-txt { color: var(--accent); }
  .smeta .fail-txt { color: var(--red); }
  .chip { display: inline-flex; gap: 4px; background: var(--chip); border-radius: 6px;
    padding: 0 6px; font-size: 11px; color: var(--fg); }
  .chip b { font-weight: 600; }

  .card { border: 1px solid var(--border); background: var(--card); border-radius: 10px;
    padding: 12px; margin-top: 12px; }
  .card-title { display: flex; align-items: baseline; justify-content: space-between;
    gap: 8px; margin-bottom: 8px; }
  .card-title .t { font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.4px; color: var(--muted); }
  .card-title .r { font-size: 11px; color: var(--muted); }
  svg { display: block; width: 100%; height: auto; }
  .legend { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; }
  .legend .li { display: inline-flex; align-items: center; gap: 5px; font-size: 11px;
    color: var(--muted); }
  .legend .ldot { width: 8px; height: 8px; border-radius: 2px; }

  .kv { display: flex; gap: 8px; padding: 3px 0; align-items: baseline; }
  .kv .k { flex: 0 0 auto; max-width: 40%; font-size: 12px; color: var(--muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kv .v { min-width: 0; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow-wrap: anywhere; }
</style>
</head>
<body>
<div id="root"><div class="empty">Waiting for experiment data…</div></div>
<script>
(function () {
  var PALETTE = ["--accent", "--green", "--amber", "--violet", "--cyan", "--red"];

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function seriesColor(idx) {
    return cssVar(PALETTE[idx % PALETTE.length]);
  }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function fmt(n) {
    if (n === null || n === undefined) return "–";
    var a = Math.abs(n);
    if (a !== 0 && (a >= 10000 || a < 0.001)) return n.toExponential(2);
    return String(parseFloat(n.toPrecision(4)));
  }

  function renderHead(feed) {
    var head = el("div", "head");
    head.appendChild(el("div", "name", feed.experiment.name));
    var pill = el("span", "pill " + feed.experiment.status);
    pill.appendChild(el("span", "pdot"));
    pill.appendChild(el("span", null, feed.experiment.status));
    head.appendChild(pill);
    var wrap = el("div");
    wrap.appendChild(head);
    if (feed.experiment.drift.length) {
      wrap.appendChild(el("div", "drift-note",
        "drift: " + feed.experiment.drift.join(", ")));
    }
    return wrap;
  }

  function renderStage(s, description) {
    var box = el("div", "stage");
    if (description) box.title = description;
    var dot = "sdot";
    if (s.spansRunning > 0) dot += " live";
    else if (s.spansFailed > 0) dot += " bad";
    else if (s.spansTotal > 0) dot += " done";

    var title = el("div", "srow");
    title.appendChild(el("span", dot));
    title.appendChild(el("span", "sname", s.id));
    if (!s.declared) title.appendChild(el("span", "sdrift", "drift"));
    box.appendChild(title);
    if (description) box.appendChild(el("div", "sdesc", description));

    var meta = el("div", "smeta num");
    meta.appendChild(el("span", null,
      s.spansTotal + " run" + (s.spansTotal === 1 ? "" : "s")));
    if (s.spansRunning > 0)
      meta.appendChild(el("span", "live-txt", s.spansRunning + " live"));
    if (s.spansFailed > 0)
      meta.appendChild(el("span", "fail-txt", s.spansFailed + " failed"));
    if (s.bestScore !== null) {
      var best = el("span", "chip num");
      best.appendChild(el("span", "muted", "best"));
      best.appendChild(el("b", null, fmt(s.bestScore)));
      meta.appendChild(best);
      var last = el("span", "chip num");
      last.appendChild(el("span", "muted", "last"));
      last.appendChild(el("b", null, fmt(s.lastScore)));
      meta.appendChild(last);
    }
    box.appendChild(meta);
    return box;
  }

  // Layered DAG: level(stage) = 1 + max(level of its after-edges), so
  // parallel branches land on the same row, side by side. Drift stages
  // (no declared edges) collect on a final row.
  function renderStages(feed) {
    var wrap = el("div", "stages");
    var afterById = {};
    var descriptionById = {};
    ((feed.experiment.skeleton || {}).stages || []).forEach(function (s) {
      afterById[s.id] = s.after || [];
      if (s.description) descriptionById[s.id] = s.description;
    });
    var levelById = {};
    function levelOf(id, trail) {
      if (levelById[id] !== undefined) return levelById[id];
      if (trail[id] || afterById[id] === undefined) return 0;
      trail[id] = true;
      var max = -1;
      afterById[id].forEach(function (dep) {
        var l = levelOf(dep, trail);
        if (l > max) max = l;
      });
      levelById[id] = max + 1;
      return levelById[id];
    }
    var declared = feed.stages.filter(function (s) { return s.declared; });
    var drift = feed.stages.filter(function (s) { return !s.declared; });
    var buckets = [];
    declared.forEach(function (s) {
      var l = levelOf(s.id, {});
      while (buckets.length <= l) buckets.push([]);
      buckets[l].push(s);
    });
    if (drift.length) buckets.push(drift);
    buckets.forEach(function (bucket) {
      if (!bucket.length) return;
      if (wrap.children.length) wrap.appendChild(el("div", "lvl-gap"));
      var row = el("div", bucket.length > 1 ? "lvl parallel" : "lvl");
      bucket.forEach(function (s) {
        row.appendChild(renderStage(s, descriptionById[s.id]));
      });
      wrap.appendChild(row);
    });
    return wrap;
  }

  function renderChart(feed) {
    var series = feed.scoreSeries.filter(function (s) { return s.points.length > 0; });
    if (!series.length) return null;
    var W = 560, H = 180, L = 8, R = 8, T = 10, B = 14;
    var all = [];
    series.forEach(function (s) { s.points.forEach(function (p) { all.push(p.score); }); });
    var min = Math.min.apply(null, all), max = Math.max.apply(null, all);
    if (min === max) { min -= 1; max += 1; }
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    for (var g = 0; g <= 3; g++) {
      var y = T + (g * (H - T - B)) / 3;
      var grid = document.createElementNS(ns, "line");
      grid.setAttribute("x1", L); grid.setAttribute("x2", W - R);
      grid.setAttribute("y1", y); grid.setAttribute("y2", y);
      grid.setAttribute("stroke", cssVar("--border"));
      grid.setAttribute("stroke-width", "1");
      if (g > 0 && g < 3) grid.setAttribute("stroke-dasharray", "3 4");
      svg.appendChild(grid);
    }
    series.forEach(function (s, idx) {
      var color = seriesColor(idx);
      var n = s.points.length;
      var coords = s.points.map(function (p, i) {
        var x = L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
        var y = H - B - ((p.score - min) * (H - T - B)) / (max - min);
        return [x, y];
      });
      if (n > 1) {
        var line = document.createElementNS(ns, "polyline");
        line.setAttribute("points", coords.map(function (c) { return c[0] + "," + c[1]; }).join(" "));
        line.setAttribute("fill", "none");
        line.setAttribute("stroke", color);
        line.setAttribute("stroke-width", "2");
        line.setAttribute("stroke-linejoin", "round");
        line.setAttribute("stroke-linecap", "round");
        svg.appendChild(line);
      }
      if (n <= 60) {
        coords.forEach(function (c) {
          var pt = document.createElementNS(ns, "circle");
          pt.setAttribute("cx", c[0]); pt.setAttribute("cy", c[1]);
          pt.setAttribute("r", n > 1 ? "2.5" : "3.5");
          pt.setAttribute("fill", color);
          svg.appendChild(pt);
        });
      }
    });
    var card = el("div", "card");
    var title = el("div", "card-title");
    title.appendChild(el("span", "t", "Score"));
    title.appendChild(el("span", "r num", "min " + fmt(min) + " · max " + fmt(max)));
    card.appendChild(title);
    card.appendChild(svg);
    var legend = el("div", "legend");
    series.forEach(function (s, idx) {
      var item = el("span", "li");
      var ldot = el("span", "ldot");
      ldot.style.background = seriesColor(idx);
      item.appendChild(ldot);
      item.appendChild(el("span", null, s.stage));
      legend.appendChild(item);
    });
    if (series.length > 1) card.appendChild(legend);
    return card;
  }

  function renderCustom(custom) {
    var keys = Object.keys(custom || {});
    if (!keys.length) return null;
    var card = el("div", "card");
    var title = el("div", "card-title");
    title.appendChild(el("span", "t", "Data"));
    card.appendChild(title);
    keys.forEach(function (key) {
      var value = custom[key];
      var text = typeof value === "object" ? JSON.stringify(value, null, 1) : String(value);
      if (text.length > 400) text = text.slice(0, 400) + "\\u2026";
      var row = el("div", "kv");
      row.appendChild(el("span", "k", key));
      row.appendChild(el("span", "v", text));
      card.appendChild(row);
    });
    return card;
  }

  function render(feed) {
    var root = document.getElementById("root");
    root.textContent = "";
    root.appendChild(renderHead(feed));
    if (!feed.stages.length) {
      root.appendChild(el("div", "empty",
        "No skeleton declared — the graph appears as spans arrive."));
      return;
    }
    root.appendChild(renderStages(feed));
    if (feed.experiment.status === "draft") {
      root.appendChild(el("div", "empty", "Draft — waiting for a run."));
      return;
    }
    var chart = renderChart(feed);
    if (chart) root.appendChild(chart);
    var custom = renderCustom(feed.custom);
    if (custom) root.appendChild(custom);
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.type !== "experiment-feed" || !data.feed) return;
    try { render(data.feed); } catch (err) {
      document.getElementById("root").textContent = "dashboard render error: " + err;
    }
  });
})();
</script>
</body>
</html>
`;
