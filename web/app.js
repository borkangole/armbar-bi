/* ArmBar BI dashboard - reads window.ARMBAR_DATA (built by pipeline/prepare.py) */
(() => {
  "use strict";
  const D = window.ARMBAR_DATA;
  const $ = (s) => document.querySelector(s);

  // ---------- EMPTY MODE: no data file loaded -> show the layout with empty panels ----------
  // To turn data back on, re-add  <script src="data/armbar-data.js"></script>  in index.html.
  if (!D) { renderEmptyShell(); return; }
  function renderEmptyShell() {
    const tiles = (labels) => labels.map((l) =>
      `<div class="kpi"><span class="label">${l}</span><span class="value muted">—</span><span class="delta">&nbsp;</span></div>`).join("");
    $("#kpisOverview").innerHTML = tiles(["Total revenue", "Operating profit", "Operating profit margin",
      "Membership renewal rate", "Active gym members"]);
    $("#kpisDrill").innerHTML = tiles(["New gym members", "Bar gross margin", "Member share of Bar sales",
      "Bar discount rate", "Average Bar ticket"]);
    const empty = `<div class="empty-state"><svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>
      <span>No data yet</span><span class="small">This panel will fill in once the dataset is connected.</span></div>`;
    document.querySelectorAll(".chart-box").forEach((b) => (b.innerHTML = empty));
    document.querySelectorAll(".table-wrap").forEach((t) => (t.innerHTML = empty));
    const tn = $("#thresholdNote"); if (tn) tn.textContent = "";
    const gd = $("#genDate"); if (gd) gd.textContent = "No dataset connected yet.";
    ["#fFrom", "#fTo", "#fBranch"].forEach((id) => { const el = $(id); el.innerHTML = "<option>—</option>"; el.disabled = true; });
    $("#fUnit").disabled = true; $("#fReset").disabled = true;
    $("#periodNote").textContent = "No data loaded";
    document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
      document.querySelectorAll(".page").forEach((p) => (p.hidden = p.id !== "page-" + t.dataset.page));
      document.querySelector(".filters").style.display = t.dataset.page === "about" ? "none" : "";
    }));
    try { const t = localStorage.getItem("armbar-theme"); if (t) document.documentElement.dataset.theme = t; } catch (_) {}
    $("#themeToggle").onclick = () => {
      const r = document.documentElement, dark = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      r.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem("armbar-theme", r.dataset.theme); } catch (_) {}
    };
  }

  // ---------- expand compact tables into row objects ----------
  const T = {};
  for (const k of ["barProduct", "barMonth", "planMonth", "serviceMonth", "renewMonth", "activeMonth", "opexMonth"]) {
    const { cols, rows } = D[k];
    T[k] = rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
  }
  const MONTHS = D.months;
  const monthLabel = (m) => new Date(m + "-01T00:00:00").toLocaleString("en-US", { month: "short", year: "2-digit" });
  const BR = D.branches.map((b) => b.branch_name);
  const DISC_MI = MONTHS.indexOf(D.memberDiscountStart);

  // ---------- thresholds used for exceptions (documented on "Data & KPIs") ----------
  const TH = { renewCrit: 0.65, renewWarn: 0.72, marginCrit: 0.15, marginWarn: 0.25, renewTarget: 0.70 };

  // ---------- state ----------
  const DEFAULT = { from: Math.max(0, MONTHS.length - 6), to: MONTHS.length - 1, branch: "all", unit: "all" };
  const S = { ...DEFAULT };
  const inB = (bi) => S.branch === "all" || bi === +S.branch;

  // ---------- formatting ----------
  const peso = (v) => {
    const a = Math.abs(v), s = v < 0 ? "−" : "";
    if (a >= 1e6) return `${s}₱${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
    if (a >= 1e3) return `${s}₱${(a / 1e3).toFixed(0)}K`;
    return `${s}₱${a.toFixed(0)}`;
  };
  const pesoFull = (v) => "₱" + Math.round(v).toLocaleString("en-US");
  const pct = (v, d = 1) => (v == null || !isFinite(v) ? "—" : (v * 100).toFixed(d) + "%");
  const num = (v) => Math.round(v).toLocaleString("en-US");
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ---------- aggregation ----------
  function agg(from, to, branchFn = inB) {
    const ok = (r) => r.mi >= from && r.mi <= to && branchFn(r.bi);
    const a = { gymRev: 0, gymDirect: 0, gymOpex: 0, barRev: 0, barCogs: 0, barOpex: 0, due: 0, renewed: 0,
                newM: 0, txns: 0, memTxns: 0, gross: 0, disc: 0, net: 0, memRev: 0, active: 0 };
    for (const r of T.planMonth) if (ok(r)) { a.gymRev += r.rev; a.newM += r.new; }
    for (const r of T.serviceMonth) if (ok(r)) { a.gymRev += r.rev; a.gymDirect += r.cost; }
    for (const r of T.barProduct) if (ok(r)) { a.barRev += r.rev; a.barCogs += r.cost; a.memRev += r.memRev; }
    for (const r of T.barMonth) if (ok(r)) { a.txns += r.txns; a.memTxns += r.memTxns; a.gross += r.gross; a.disc += r.disc; a.net += r.net; }
    for (const r of T.opexMonth) if (ok(r)) { if (r.u === 0) a.gymOpex += r.amount; else a.barOpex += r.amount; }
    for (const r of T.renewMonth) if (ok(r)) { a.due += r.due; a.renewed += r.renewed; }
    for (const r of T.activeMonth) if (r.mi === to && branchFn(r.bi)) a.active += r.active;
    a.gymProfit = a.gymRev - a.gymDirect - a.gymOpex;
    a.barProfit = a.barRev - a.barCogs - a.barOpex;
    const u = S.unit;
    a.rev = u === "0" ? a.gymRev : u === "1" ? a.barRev : a.gymRev + a.barRev;
    a.profit = u === "0" ? a.gymProfit : u === "1" ? a.barProfit : a.gymProfit + a.barProfit;
    a.margin = a.rev ? a.profit / a.rev : null;
    a.gymMargin = a.gymRev ? a.gymProfit / a.gymRev : null;
    a.barMargin = a.barRev ? a.barProfit / a.barRev : null;
    a.renewRate = a.due ? a.renewed / a.due : null;
    a.barGM = a.barRev ? (a.barRev - a.barCogs) / a.barRev : null;
    a.memShare = a.barRev ? a.memRev / a.barRev : null;
    a.discRate = a.gross ? a.disc / a.gross : null;
    a.ticket = a.txns ? a.net / a.txns : null;
    return a;
  }
  function prior() {
    const len = S.to - S.from + 1;
    return S.from - len >= 0 ? [S.from - len, S.from - 1] : null;
  }

  // ---------- KPI tiles ----------
  function tile({ label, value, delta, deltaKind, hint }) {
    return `<div class="kpi"><span class="label">${label}</span><span class="value">${value}</span>
      <span class="delta ${deltaKind || ""}">${delta || "&nbsp;"}</span>${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
  }
  function deltaPct(cur, prev, upIsGood = true) {
    if (prev == null || cur == null || !prev) return {};
    const d = cur / prev - 1, up = d >= 0;
    return { delta: `${up ? "▲" : "▼"} ${Math.abs(d * 100).toFixed(1)}% vs prior period`, deltaKind: (up === upIsGood ? (up ? "up-good" : "down-good") : (up ? "up-bad" : "down-bad")) };
  }
  function deltaPts(cur, prev, upIsGood = true) {
    if (prev == null || cur == null) return {};
    const d = (cur - prev) * 100, up = d >= 0;
    return { delta: `${up ? "▲" : "▼"} ${Math.abs(d).toFixed(1)} pts vs prior period`, deltaKind: (up === upIsGood ? (up ? "up-good" : "down-good") : (up ? "up-bad" : "down-bad")) };
  }

  function renderKpis() {
    const a = agg(S.from, S.to), p = prior(), b = p ? agg(p[0], p[1]) : null;
    const unitName = S.unit === "0" ? "Gym" : S.unit === "1" ? "Bar" : "Gym + Bar";
    const noPrior = p ? "" : "No prior period in data for comparison";
    $("#kpisOverview").innerHTML = [
      tile({ label: `Total revenue · ${unitName}`, value: peso(a.rev), ...deltaPct(a.rev, b && b.rev), hint: noPrior }),
      tile({ label: "Operating profit", value: peso(a.profit), ...deltaPct(a.profit, b && b.profit), hint: noPrior }),
      tile({ label: "Operating profit margin", value: pct(a.margin), ...deltaPts(a.margin, b && b.margin), hint: noPrior }),
      tile({ label: "Membership renewal rate", value: pct(a.renewRate), ...deltaPts(a.renewRate, b && b.renewRate), hint: `Gym · target ≥ ${pct(TH.renewTarget, 0)}` }),
      tile({ label: "Active gym members (end of period)", value: num(a.active), ...deltaPct(a.active, b && b.active), hint: noPrior }),
    ].join("");
    $("#kpisDrill").innerHTML = [
      tile({ label: "New gym members", value: num(a.newM), ...deltaPct(a.newM, b && b.newM), hint: noPrior }),
      tile({ label: "Bar gross margin", value: pct(a.barGM), ...deltaPts(a.barGM, b && b.barGM), hint: "(Bar sales − cost of goods) ÷ Bar sales" }),
      tile({ label: "Member share of Bar sales", value: pct(a.memShare), ...deltaPts(a.memShare, b && b.memShare), hint: "Sales to gym members ÷ Bar sales" }),
      tile({ label: "Bar discount rate", value: pct(a.discRate), ...deltaPts(a.discRate, b && b.discRate, false), hint: "Discounts ÷ gross Bar sales" }),
      tile({ label: "Average Bar ticket", value: a.ticket ? pesoFull(a.ticket) : "—", ...deltaPct(a.ticket, b && b.ticket), hint: "Net Bar sales ÷ transactions" }),
    ].join("");
    $("#periodNote").textContent = p
      ? `Comparing ${monthLabel(MONTHS[S.from])}–${monthLabel(MONTHS[S.to])} with ${monthLabel(MONTHS[p[0]])}–${monthLabel(MONTHS[p[1]])}`
      : `${monthLabel(MONTHS[S.from])}–${monthLabel(MONTHS[S.to])}`;
  }

  // ---------- charts ----------
  const charts = {};
  function baseOptions(extra = {}) {
    const grid = css("--grid"), muted = css("--muted"), text2 = css("--text-2");
    Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = text2;
    return Chart.helpers.merge({
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      plugins: {
        legend: { position: "top", align: "start", labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2, color: text2 } },
        tooltip: { backgroundColor: css("--surface"), titleColor: css("--text"), bodyColor: css("--text-2"),
                   borderColor: css("--axis"), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true },
      },
      scales: {
        x: { grid: { color: grid, drawTicks: false }, border: { color: css("--axis") }, ticks: { color: muted, padding: 6 } },
        y: { grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { color: muted, padding: 6 } },
      },
    }, extra);
  }
  function draw(id, config) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), config);
  }
  const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, "0");
  const barStyle = { borderRadius: 4, borderSkipped: "start", maxBarThickness: 24, borderWidth: 0 };

  // vertical marker plugin (member discount start)
  const markerPlugin = {
    id: "marker",
    afterDatasetsDraw(chart, _args, opts) {
      if (opts.index == null || opts.index < 0) return;
      const x = chart.scales.x.getPixelForValue(opts.index);
      const { top, bottom } = chart.chartArea;
      const c = chart.ctx; c.save();
      c.strokeStyle = css("--text-2"); c.lineWidth = 1; c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke();
      c.fillStyle = css("--text-2"); c.font = '12px system-ui, sans-serif'; c.textAlign = "left";
      c.fillText(opts.label, x + 6, top + 12); c.restore();
    },
  };

  // shades the selected period on full-history trend charts
  const bandPlugin = {
    id: "band",
    beforeDatasetsDraw(chart, _a, opts) {
      if (opts.from == null) return;
      const x = chart.scales.x, n = chart.data.labels.length;
      if (opts.from === 0 && opts.to === n - 1) return;
      const step = n > 1 ? x.getPixelForValue(1) - x.getPixelForValue(0) : 0;
      const pad = chart.config.type === "bar" ? step / 2 : 0;
      const l = Math.max(chart.chartArea.left, x.getPixelForValue(opts.from) - pad);
      const r = Math.min(chart.chartArea.right, x.getPixelForValue(opts.to) + pad);
      const c = chart.ctx; c.save(); c.fillStyle = alpha(css("--s1"), 0.07);
      c.fillRect(l, chart.chartArea.top, r - l, chart.chartArea.bottom - chart.chartArea.top);
      c.fillStyle = css("--muted"); c.font = "11px system-ui, sans-serif"; c.textAlign = "right";
      c.fillText("selected period", r - 4, chart.chartArea.bottom - 6); c.restore();
    },
  };
  const ALL = MONTHS.map((_, i) => i);
  const inSel = (m) => m >= S.from && m <= S.to;

  function renderOverviewCharts() {
    const s1 = css("--s1"), s2 = css("--s2");
    const idx = []; for (let m = S.from; m <= S.to; m++) idx.push(m);
    const showGym = S.unit !== "1", showBar = S.unit !== "0";

    // 1. monthly revenue by unit (stacked columns)
    const gymM = ALL.map((m) => agg(m, m).gymRev), barM = ALL.map((m) => agg(m, m).barRev);
    const ds = [];
    const fadeM = (c) => ALL.map((m) => (inSel(m) ? c : alpha(c, 0.3)));
    if (showGym) ds.push({ label: "ArmBar Gym", data: gymM, backgroundColor: fadeM(s1), ...barStyle, borderSkipped: false, borderRadius: 0 });
    if (showBar) ds.push({ label: "ArmBar Bar", data: barM, backgroundColor: fadeM(s2), ...barStyle, borderSkipped: false, borderRadius: 0 });
    if (ds.length) { ds[ds.length - 1].borderRadius = { topLeft: 4, topRight: 4 }; }
    ds.forEach((d) => { d.borderColor = css("--surface"); d.borderWidth = { top: ds.length > 1 ? 1 : 0 }; });
    draw("cRevTrend", { type: "bar", plugins: [bandPlugin], data: { labels: ALL.map((m) => monthLabel(MONTHS[m])), datasets: ds },
      options: baseOptions({
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: (v) => peso(v) } } },
        interaction: { mode: "index", intersect: false },
        plugins: { band: { from: S.from, to: S.to }, legend: { labels: { generateLabels: (ch) => ch.data.datasets.map((d, i) => ({ text: d.label,
          fillStyle: i === 0 && showGym ? s1 : s2, strokeStyle: "transparent", lineWidth: 0, fontColor: css("--text-2"), datasetIndex: i })) } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${pesoFull(c.raw)}`,
          footer: (items) => "Total: " + pesoFull(items.reduce((s, i) => s + i.raw, 0)) } } },
      }) });

    // 2. revenue by branch (horizontal stacked), unselected branches faded
    const perB = BR.map((_, bi) => agg(S.from, S.to, (b) => b === bi));
    const fade = (c, bi) => (inB(bi) ? c : alpha(c, 0.25));
    const ds2 = [];
    if (showGym) ds2.push({ label: "ArmBar Gym", data: perB.map((a) => a.gymRev), backgroundColor: BR.map((_, bi) => fade(s1, bi)) });
    if (showBar) ds2.push({ label: "ArmBar Bar", data: perB.map((a) => a.barRev), backgroundColor: BR.map((_, bi) => fade(s2, bi)) });
    ds2.forEach((d, i) => Object.assign(d, { borderRadius: i === ds2.length - 1 ? { topRight: 4, bottomRight: 4 } : 0,
      borderSkipped: false, maxBarThickness: 24, borderColor: css("--surface"), borderWidth: ds2.length > 1 ? { right: i === 0 ? 2 : 0 } : 0 }));
    draw("cRevBranch", { type: "bar", data: { labels: BR, datasets: ds2 },
      options: baseOptions({ indexAxis: "y",
        scales: { x: { stacked: true, ticks: { callback: (v) => peso(v) } }, y: { stacked: true, grid: { display: false } } },
        plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${pesoFull(c.raw)}`,
          footer: (items) => { const a = perB[items[0].dataIndex];
            return `Total: ${pesoFull((showGym ? a.gymRev : 0) + (showBar ? a.barRev : 0))}`; } } } },
      }) });

    // 3. operating margin by branch & unit (grouped horizontal)
    const ds3 = [];
    if (showGym) ds3.push({ label: "ArmBar Gym", data: perB.map((a) => a.gymMargin * 100), backgroundColor: BR.map((_, bi) => fade(s1, bi)), ...barStyle, maxBarThickness: 14 });
    if (showBar) ds3.push({ label: "ArmBar Bar", data: perB.map((a) => a.barMargin * 100), backgroundColor: BR.map((_, bi) => fade(s2, bi)), ...barStyle, maxBarThickness: 14 });
    draw("cMarginBranch", { type: "bar", data: { labels: BR, datasets: ds3 },
      options: baseOptions({ indexAxis: "y",
        scales: { x: { ticks: { callback: (v) => v + "%" } }, y: { grid: { display: false } } },
        plugins: { tooltip: { callbacks: { label: (c) => {
          const a = perB[c.dataIndex], g = c.dataset.label.includes("Gym");
          return ` ${c.dataset.label}: ${c.raw.toFixed(1)}%  (profit ${pesoFull(g ? a.gymProfit : a.barProfit)})`; } } } },
      }) });

    // 4. exceptions table
    const p = prior();
    const rows = BR.map((name, bi) => {
      const a = perB[bi], b = p ? agg(p[0], p[1], (x) => x === bi) : null;
      const growth = b && b.rev ? a.rev / b.rev - 1 : null;
      const flags = []; let level = 0;
      if (a.renewRate != null && a.renewRate < TH.renewCrit) { flags.push("Renewal rate below 65%"); level = 2; }
      else if (a.renewRate != null && a.renewRate < TH.renewWarn) { flags.push("Renewal rate below 72%"); level = Math.max(level, 1); }
      if (a.margin != null && a.margin < TH.marginCrit) { flags.push("Operating margin below 15%"); level = 2; }
      else if (a.margin != null && a.margin < TH.marginWarn) { flags.push("Operating margin below 25%"); level = Math.max(level, 1); }
      if (growth != null && growth < 0) { flags.push("Revenue declining"); level = Math.max(level, 1); }
      if (b && b.active && a.active / b.active - 1 < -0.05) { flags.push("Active members down >5%"); level = Math.max(level, 1); }
      return { name, bi, a, growth, flags, level };
    }).sort((x, y) => y.level - x.level || (x.a.margin ?? 0) - (y.a.margin ?? 0));
    const st = ["good|On track", "warning|Watch", "critical|Act now"];
    $("#tExceptions").innerHTML = `<thead><tr><th>Branch</th><th>Status</th><th class="num">Revenue</th><th class="num">Growth</th>
      <th class="num">Op. margin</th><th class="num">Renewal</th><th>Why flagged</th></tr></thead><tbody>` +
      rows.map((r) => { const [cls, txt] = st[r.level].split("|");
        return `<tr style="${inB(r.bi) ? "" : "opacity:.45"}"><td>${r.name}</td>
          <td><span class="status ${cls}"><span class="dot" aria-hidden="true"></span>${txt}</span></td>
          <td class="num">${peso(r.a.rev)}</td><td class="num">${r.growth == null ? "—" : (r.growth >= 0 ? "+" : "") + (r.growth * 100).toFixed(1) + "%"}</td>
          <td class="num">${pct(r.a.margin)}</td><td class="num">${pct(r.a.renewRate)}</td>
          <td class="flags">${r.flags.join(" · ") || "—"}</td></tr>`; }).join("") + "</tbody>";
    $("#thresholdNote").textContent = `Act now: renewal < ${pct(TH.renewCrit, 0)} or operating margin < ${pct(TH.marginCrit, 0)}. ` +
      `Watch: renewal < ${pct(TH.renewWarn, 0)}, margin < ${pct(TH.marginWarn, 0)}, revenue or active members falling vs prior period.`;
  }

  function renderDrillCharts() {
    const pal = ["--s1", "--s2", "--s3", "--s4", "--s5"].map(css);
    const idx = ALL;
    const labels = idx.map((m) => monthLabel(MONTHS[m]));
    const band = { from: S.from, to: S.to };

    // 5. renewal rate by branch (lines) + target
    const ds = BR.map((name, bi) => {
      const on = inB(bi);
      return { label: name, data: idx.map((m) => { const a = agg(Math.max(0, m - 2), m, (b) => b === bi); return a.renewRate == null ? null : a.renewRate * 100; }),
        borderColor: on ? pal[bi] : alpha(pal[bi], 0.25), backgroundColor: pal[bi], borderWidth: 2, pointRadius: 0,
        pointHoverRadius: 5, pointHoverBorderColor: css("--surface"), pointHoverBorderWidth: 2, tension: 0.25, spanGaps: true };
    });
    ds.push({ label: `Target ${pct(TH.renewTarget, 0)}`, data: idx.map(() => TH.renewTarget * 100), borderColor: css("--muted"),
      borderWidth: 1, borderDash: [4, 4], pointRadius: 0, pointHoverRadius: 0 });
    draw("cRenewal", { type: "line", data: { labels, datasets: ds }, plugins: [bandPlugin],
      options: baseOptions({ plugins: { band }, interaction: { mode: "index", intersect: false },
        scales: { y: { suggestedMin: 45, suggestedMax: 90, ticks: { callback: (v) => v + "%" } }, x: { grid: { display: false } } },
        plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.raw == null ? "—" : c.raw.toFixed(1) + "%"}` } } } }) });

    // 6. bar gross margin + member share (same unit: %), discount marker
    const gm = idx.map((m) => agg(m, m).barGM * 100), ms = idx.map((m) => agg(m, m).memShare * 100);
    const line = (label, data, color) => ({ label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0,
      pointHoverRadius: 5, pointHoverBorderColor: css("--surface"), pointHoverBorderWidth: 2, tension: 0.25 });
    const mIdx = DISC_MI;
    draw("cBarMargin", { type: "line", data: { labels, datasets: [line("Bar gross margin", gm, pal[0]), line("Member share of Bar sales", ms, pal[2])] },
      plugins: [bandPlugin, markerPlugin],
      options: baseOptions({ interaction: { mode: "index", intersect: false },
        scales: { y: { min: 0, max: 70, ticks: { callback: (v) => v + "%" } }, x: { grid: { display: false } } },
        plugins: { band, marker: { index: mIdx, label: "15% member discount starts" },
          tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.raw.toFixed(1)}%` } } } }) });

    // 7. bar products by gross profit (colored by category)
    const cats = [...new Set(D.products.map((p) => p.category))];
    const catColor = Object.fromEntries(cats.map((c, i) => [c, pal[i]]));
    const prod = D.products.map((p, pi) => ({ ...p, rev: 0, cost: 0, qty: 0 }));
    for (const r of T.barProduct) if (r.mi >= S.from && r.mi <= S.to && inB(r.bi)) { const p = prod[r.pi]; p.rev += r.rev; p.cost += r.cost; p.qty += r.qty; }
    prod.forEach((p) => (p.gp = p.rev - p.cost));
    prod.sort((a, b) => b.gp - a.gp);
    draw("cProducts", { type: "bar",
      data: { labels: prod.map((p) => p.product_name), datasets: [{ label: "Gross profit", data: prod.map((p) => p.gp),
        backgroundColor: prod.map((p) => catColor[p.category]), ...barStyle, maxBarThickness: 16 }] },
      options: baseOptions({ indexAxis: "y",
        scales: { x: { ticks: { callback: (v) => peso(v) } }, y: { grid: { display: false }, ticks: { autoSkip: false, color: css("--text-2") } } },
        plugins: {
          legend: { labels: { generateLabels: () => cats.map((c) => ({ text: c, fillStyle: catColor[c], strokeStyle: catColor[c], lineWidth: 0, fontColor: css("--text-2") })) }, onClick: () => {} },
          tooltip: { callbacks: { title: (i) => prod[i[0].dataIndex].product_name + " · " + prod[i[0].dataIndex].category,
            label: (c) => { const p = prod[c.dataIndex];
              return [` Gross profit: ${pesoFull(p.gp)}`, ` Sales: ${pesoFull(p.rev)}`, ` Margin: ${pct(p.gp / p.rev)}`, ` Units: ${num(p.qty)}`]; } } } } }) });

    // 8. gym revenue by plan & service
    const items = D.plans.map((p) => ({ name: p.plan_name + " plan", kind: "Membership plan", rev: 0, n: 0 }))
      .concat(D.services.map((s) => ({ name: s, kind: "Gym service", rev: 0, n: 0 })));
    for (const r of T.planMonth) if (r.mi >= S.from && r.mi <= S.to && inB(r.bi)) { items[r.pli].rev += r.rev; items[r.pli].n += r.new + r.ren; }
    for (const r of T.serviceMonth) if (r.mi >= S.from && r.mi <= S.to && inB(r.bi)) { items[D.plans.length + r.si].rev += r.rev; items[D.plans.length + r.si].n += r.n; }
    items.sort((a, b) => b.rev - a.rev);
    const kc = { "Membership plan": pal[0], "Gym service": pal[2] };
    draw("cGymMix", { type: "bar",
      data: { labels: items.map((i) => i.name), datasets: [{ label: "Revenue", data: items.map((i) => i.rev),
        backgroundColor: items.map((i) => kc[i.kind]), ...barStyle, maxBarThickness: 18 }] },
      options: baseOptions({ indexAxis: "y",
        scales: { x: { ticks: { callback: (v) => peso(v), maxRotation: 0, maxTicksLimit: 6 } }, y: { grid: { display: false }, ticks: { autoSkip: false, color: css("--text-2") } } },
        plugins: {
          legend: { labels: { generateLabels: () => Object.entries(kc).map(([t, c]) => ({ text: t, fillStyle: c, strokeStyle: c, lineWidth: 0, fontColor: css("--text-2") })) }, onClick: () => {} },
          tooltip: { callbacks: { label: (c) => { const i = items[c.dataIndex];
            return [` Revenue: ${pesoFull(i.rev)}`, ` ${i.kind === "Gym service" ? "Sessions/passes" : "Payments"}: ${num(i.n)}`]; } } } } }) });
  }

  // ---------- page 3: definitions & DQ ----------
  const KPI_DEFS = [
    ["Total revenue", "Σ membership payments + Σ gym service sales + Σ net Bar sales (after discounts, voids removed)", "₱", "fact_membership_payments.amount, fact_gym_services.amount, fact_bar_sales.net_amount", "GM, Ops Manager", "Higher is better; compare with prior equal-length period"],
    ["Operating profit margin", "(Revenue − direct costs − operating expenses) ÷ Revenue. Direct costs: Bar cost of goods, trainer/instructor fees", "%", "+ fact_bar_sales.line_cost, fact_gym_services.direct_cost, fact_operating_expenses.amount", "GM, Branch Managers", "< 15% = act now; < 25% = watch"],
    ["Membership renewal rate", "Memberships renewed within 14 days of expiry ÷ memberships that expired in the period (only fully observable expiries)", "%", "fact_membership_renewals.renewed, expiry_date", "Gym Manager, Branch Managers", "Target ≥ 70%; < 65% = act now"],
    ["Active gym members", "Distinct members with a paid, unexpired membership on the last day of the period", "members", "fact_membership_payments (payment_date, period_end)", "Gym Manager", "Trend matters more than level"],
    ["Bar gross margin", "(Net Bar sales − cost of goods) ÷ Net Bar sales", "%", "fact_bar_sales.net_amount, line_cost", "Bar Manager", "Falls when discounts rise or product mix shifts to low-margin items"],
    ["Member share of Bar sales", "Net Bar sales to gym members ÷ Net Bar sales", "%", "fact_bar_sales.is_member_sale, net_amount", "Bar Manager, GM", "Shows whether the Gym is feeding the Bar"],
    ["Bar discount rate", "Σ discount_amount ÷ Σ gross Bar sales (before discount)", "%", "fact_bar_sales.discount_amount, gross_sales", "Bar Manager", "Lower is better unless offset by volume"],
  ];
  function renderAbout() {
    $("#tKpiDefs").innerHTML = "<thead><tr><th>KPI</th><th>Formula</th><th>Unit</th><th>Data fields</th><th>Stakeholder</th><th>Interpretation</th></tr></thead><tbody>" +
      KPI_DEFS.map((r) => "<tr>" + r.map((c) => `<td>${c}</td>`).join("") + "</tr>").join("") + "</tbody>";
    $("#tDq").innerHTML = "<thead><tr><th>ID</th><th>Source</th><th>Issue</th><th class='num'>Rows</th><th>Treatment</th><th>Impact if untreated</th></tr></thead><tbody>" +
      D.dataQuality.map((r) => `<tr><td>${r.issue_id}</td><td>${r.source_table}</td><td>${r.issue}</td><td class="num">${num(r.rows_affected)}</td><td>${r.treatment}</td><td>${r.bi_impact_if_untreated}</td></tr>`).join("") + "</tbody>";
    $("#genDate").textContent = `Data refreshed ${D.generated}.`;
  }

  // ---------- filters, tabs, theme ----------
  function initFilters() {
    const opts = MONTHS.map((m, i) => `<option value="${i}">${monthLabel(m)}</option>`).join("");
    $("#fFrom").innerHTML = opts; $("#fTo").innerHTML = opts;
    $("#fBranch").innerHTML = `<option value="all">All branches</option>` + BR.map((b, i) => `<option value="${i}">${b}</option>`).join("");
    const sync = () => { $("#fFrom").value = S.from; $("#fTo").value = S.to; $("#fBranch").value = S.branch; $("#fUnit").value = S.unit; };
    sync();
    $("#fFrom").onchange = (e) => { S.from = +e.target.value; if (S.from > S.to) S.to = S.from; sync(); render(); };
    $("#fTo").onchange = (e) => { S.to = +e.target.value; if (S.to < S.from) S.from = S.to; sync(); render(); };
    $("#fBranch").onchange = (e) => { S.branch = e.target.value; render(); };
    $("#fUnit").onchange = (e) => { S.unit = e.target.value; render(); };
    $("#fReset").onclick = () => { Object.assign(S, DEFAULT); sync(); render(); };
  }
  let page = "overview";
  function initTabs() {
    document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
      page = t.dataset.page;
      document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
      document.querySelectorAll(".page").forEach((p) => (p.hidden = p.id !== "page-" + page));
      document.querySelector(".filters").style.display = page === "about" ? "none" : "";
      try { history.replaceState(null, "", "#" + page); } catch (_) {}
      render();
    }));
    const h = location.hash.slice(1);
    if (h) { const t = document.querySelector(`.tab[data-page="${h}"]`); if (t) t.click(); }
  }
  function initTheme() {
    try { const t = localStorage.getItem("armbar-theme"); if (t) document.documentElement.dataset.theme = t; } catch (_) {}
    $("#themeToggle").onclick = () => {
      const dark = document.documentElement.dataset.theme
        ? document.documentElement.dataset.theme === "dark"
        : matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem("armbar-theme", document.documentElement.dataset.theme); } catch (_) {}
      render();
    };
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  }

  function render() {
    renderKpis();
    if (page === "overview") renderOverviewCharts();
    if (page === "drilldown") renderDrillCharts();
    if (page === "about") renderAbout();
  }

  initFilters(); initTheme(); initTabs(); render();
})();
