/* ArmBar BI - Performance dashboard (page 1). Reads window.ARMBAR_DATA (built by pipeline/prepare.py). */
(() => {
  "use strict";
  const D = window.ARMBAR_DATA;
  const $ = (s) => document.querySelector(s);
  if (!D) { $("#headline").textContent = "Data file not found (data/armbar-data.js)."; return; }

  /* ---------------- data ---------------- */
  const T = {};
  for (const k of ["barProduct", "barMonth", "planMonth", "serviceMonth", "renewMonth", "activeMonth", "opexMonth"]) {
    const { cols, rows } = D[k];
    T[k] = rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
  }
  const MONTHS = D.months;
  const BR = D.branches.map((b) => b.branch_name);
  const mLabel = (m, long) => new Date(m + "-01T00:00:00").toLocaleString("en-US", { month: "short", year: long ? "numeric" : "2-digit" });

  /* targets & thresholds (documented on the page and in the report) */
  const TGT = { margin: 0.25, marginCrit: 0.15, renew: 0.70, renewCrit: 0.65 };

  /* ---------------- state ---------------- */
  const DEFAULT = { from: Math.max(0, MONTHS.length - 6), to: MONTHS.length - 1, branch: "all", unit: "all" };
  const S = { ...DEFAULT };
  const inBranch = (bi) => S.branch === "all" || bi === +S.branch;

  /* ---------------- formatting ---------------- */
  const peso = (v) => { const a = Math.abs(v), s = v < 0 ? "−" : "";
    return a >= 1e6 ? `${s}₱${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M` : a >= 1e3 ? `${s}₱${Math.round(a / 1e3)}K` : `${s}₱${Math.round(a)}`; };
  const pesoFull = (v) => "₱" + Math.round(v).toLocaleString("en-US");
  const pct = (v, d = 1) => (v == null || !isFinite(v) ? "—" : (v * 100).toFixed(d) + "%");
  const signed = (v, d = 1, unit = "%") => (v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d) + unit);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  /* ---------------- aggregation ---------------- */
  function agg(from, to, bf = inBranch) {
    const ok = (r) => r.mi >= from && r.mi <= to && bf(r.bi);
    const a = { gymRev: 0, gymDirect: 0, gymOpex: 0, barRev: 0, barCogs: 0, barOpex: 0, due: 0, renewed: 0, active: 0,
                newM: 0, memRev: 0, txns: 0, net: 0, gross: 0, disc: 0 };
    for (const r of T.planMonth) if (ok(r)) { a.gymRev += r.rev; a.newM += r.new; }
    for (const r of T.barMonth) if (ok(r)) { a.txns += r.txns; a.net += r.net; a.gross += r.gross; a.disc += r.disc; }
    for (const r of T.serviceMonth) if (ok(r)) { a.gymRev += r.rev; a.gymDirect += r.cost; }
    for (const r of T.barProduct) if (ok(r)) { a.barRev += r.rev; a.barCogs += r.cost; a.memRev += r.memRev; }
    for (const r of T.opexMonth) if (ok(r)) { if (r.u === 0) a.gymOpex += r.amount; else a.barOpex += r.amount; }
    for (const r of T.renewMonth) if (ok(r)) { a.due += r.due; a.renewed += r.renewed; }
    for (const r of T.activeMonth) if (r.mi === to && bf(r.bi)) a.active += r.active;
    a.gymProfit = a.gymRev - a.gymDirect - a.gymOpex;
    a.barProfit = a.barRev - a.barCogs - a.barOpex;
    const u = S.unit;
    a.rev = u === "gym" ? a.gymRev : u === "bar" ? a.barRev : a.gymRev + a.barRev;
    a.profit = u === "gym" ? a.gymProfit : u === "bar" ? a.barProfit : a.gymProfit + a.barProfit;
    a.margin = a.rev ? a.profit / a.rev : null;
    a.renew = a.due ? a.renewed / a.due : null;
    a.barGM = a.barRev ? (a.barRev - a.barCogs) / a.barRev : null;
    a.memShare = a.barRev ? a.memRev / a.barRev : null;
    a.ticket = a.txns ? a.net / a.txns : null;
    a.discRate = a.gross ? a.disc / a.gross : null;
    return a;
  }
  const priorRange = () => { const len = S.to - S.from + 1; return S.from - len >= 0 ? [S.from - len, S.from - 1] : null; };

  /* ---------------- status helpers ---------------- */
  const ICON = {
    good: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M3 8.5l3.2 3L13 4.5"/></svg>',
    warning: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.5l7 12.5H1z"/><path stroke="#141413" stroke-width="1.6" stroke-linecap="round" d="M8 6v3.6M8 11.8v.1"/></svg>',
    critical: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path stroke="#141413" stroke-width="1.8" stroke-linecap="round" d="M8 4.3v4.4M8 11.3v.1"/></svg>',
  };
  const LABEL = { good: "On track", warning: "Watch", critical: "Act now" };
  const pill = (lvl, text) => `<span class="status ${lvl}">${ICON[lvl]}${text || LABEL[lvl]}</span>`;
  const byTarget = (v, target, crit) => (v == null ? null : v >= target ? "good" : v >= crit ? "warning" : "critical");

  /* ---------------- charts ---------------- */
  const charts = {};
  Chart.defaults.font.family = 'Poppins, system-ui, sans-serif';
  Chart.defaults.font.size = 11.5;
  Chart.defaults.color = css("--muted");
  const draw = (id, cfg) => { if (charts[id]) charts[id].destroy(); charts[id] = new Chart(document.getElementById(id), cfg); };
  const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, "0");
  const tooltip = () => ({ backgroundColor: "#1f1f1e", titleColor: "#fff", bodyColor: css("--text-2"), borderColor: css("--axis"),
                           borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true });
  const axes = (extra = {}) => Chart.helpers.merge({
    x: { grid: { color: css("--grid"), drawTicks: false }, border: { color: css("--axis") }, ticks: { padding: 6 } },
    y: { grid: { color: css("--grid"), drawTicks: false }, border: { display: false }, ticks: { padding: 6 } },
  }, extra);

  // highlight band for the selected period on the trend chart
  const bandPlugin = { id: "band", beforeDatasetsDraw(chart, _a, o) {
    if (o.from == null || (o.from === 0 && o.to === chart.data.labels.length - 1)) return;
    const x = chart.scales.x, step = x.getPixelForValue(1) - x.getPixelForValue(0), c = chart.ctx, ar = chart.chartArea;
    const l = x.getPixelForValue(o.from) - step / 2, r = x.getPixelForValue(o.to) + step / 2;
    c.save(); c.fillStyle = "rgba(255,255,255,.045)"; c.fillRect(l, ar.top, r - l, ar.bottom - ar.top);
    c.fillStyle = css("--muted"); c.font = "11px Poppins, sans-serif"; c.textAlign = "center";
    c.fillText("Selected period", (l + r) / 2, ar.top + 12); c.restore(); } };

  // margin labels at the end of each branch bar
  const endLabels = { id: "endLabels", afterDatasetsDraw(chart, _a, o) {
    if (!o.labels) return;
    const meta = chart.getDatasetMeta(chart.data.datasets.length - 1), c = chart.ctx;
    c.save(); c.font = "600 11.5px Poppins, sans-serif"; c.textBaseline = "middle";
    meta.data.forEach((bar, i) => { const l = o.labels[i]; if (!l) return;
      c.fillStyle = l.crit ? "#ff6b6b" : css("--text-2"); c.globalAlpha = l.dim ? 0.4 : 1;
      c.fillText((l.crit ? "⚠ " : "") + l.text, bar.x + 8, bar.y); });
    c.restore(); } };

  function spark(el, values, lvl) {
    const color = lvl === "critical" ? "#ff6b6b" : lvl === "warning" ? css("--warning") : css("--text-2");
    return new Chart(el, { type: "line", data: { labels: values.map((_, i) => i), datasets: [{ data: values, borderColor: alpha(css("--text-2").slice(0, 7), 0.55),
      borderWidth: 1.5, pointRadius: values.map((_, i) => (i === values.length - 1 ? 3 : 0)), pointBackgroundColor: color, pointBorderWidth: 0, tension: 0.3, fill: false }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { enabled: false } },
                 scales: { x: { display: false }, y: { display: false } }, layout: { padding: 4 } } });
  }

  /* ---------------- render: page 1 ---------------- */
  function renderOverview() {
    const a = agg(S.from, S.to), pr = priorRange(), b = pr ? agg(pr[0], pr[1]) : null;
    const unitName = S.unit === "gym" ? "ArmBar Gym" : S.unit === "bar" ? "ArmBar Bar" : "Gym + Bar";
    const scope = S.branch === "all" ? "all branches" : BR[+S.branch];
    $("#periodNote").textContent = `${mLabel(MONTHS[S.from], 1)} – ${mLabel(MONTHS[S.to], 1)} · ${scope} · ${unitName}` +
      (pr ? ` · compared with ${mLabel(MONTHS[pr[0]])}–${mLabel(MONTHS[pr[1]])}` : "");

    // ---- KPI cards
    const revGrowth = b && b.rev ? a.rev / b.rev - 1 : null;
    const kpis = [
      { label: `Total revenue · ${unitName}`, value: peso(a.rev),
        cmp: revGrowth == null ? "No prior period to compare" : `<b class="${revGrowth >= 0 ? "up" : "down"}">${revGrowth >= 0 ? "▲" : "▼"} ${signed(revGrowth * 100)}</b> vs prior period`,
        lvl: revGrowth == null ? null : revGrowth >= 0 ? "good" : revGrowth > -0.05 ? "warning" : "critical",
        series: (m) => agg(m, m).rev },
      { label: "Operating profit margin", value: pct(a.margin),
        cmp: `Target ${pct(TGT.margin, 0)}` + (b ? ` · <b class="${a.margin >= b.margin ? "up" : "down"}">${signed((a.margin - b.margin) * 100, 1, " pts")}</b> vs prior` : ""),
        lvl: byTarget(a.margin, TGT.margin, TGT.marginCrit), series: (m) => agg(m, m).margin },
      { label: "Membership renewal rate", tag: "Gym", value: pct(a.renew),
        cmp: `Target ${pct(TGT.renew, 0)}` + (b ? ` · <b class="${a.renew >= b.renew ? "up" : "down"}">${signed((a.renew - b.renew) * 100, 1, " pts")}</b> vs prior` : ""),
        lvl: byTarget(a.renew, TGT.renew, TGT.renewCrit), series: (m) => agg(Math.max(0, m - 2), m).renew },
      { label: "Bar gross margin", tag: "Bar", value: pct(a.barGM),
        cmp: b ? `<b class="${a.barGM >= b.barGM ? "up" : "down"}">${signed((a.barGM - b.barGM) * 100, 1, " pts")}</b> vs prior period` : "No prior period to compare",
        lvl: b ? ((a.barGM - b.barGM) >= 0 ? "good" : (a.barGM - b.barGM) > -0.03 ? "warning" : "critical") : null,
        series: (m) => agg(m, m).barGM },
    ];
    const sparkFrom = Math.max(0, S.to - 11);
    $("#kpis").innerHTML = kpis.map((k, i) => `<article class="card kpi">
        <div class="label"><span>${k.label}${k.tag ? ` <span style="color:var(--muted)">· ${k.tag}</span>` : ""}</span>${k.lvl ? pill(k.lvl) : ""}</div>
        <div class="value">${k.value}</div><div class="cmp">${k.cmp}</div>
        <div class="spark"><canvas id="sp${i}" aria-hidden="true"></canvas></div></article>`).join("");
    kpis.forEach((k, i) => { const vals = []; for (let m = sparkFrom; m <= S.to; m++) vals.push(k.series(m)); spark(document.getElementById("sp" + i), vals, k.lvl); });

    // ---- trend (full history, selection highlighted)
    const all = MONTHS.map((_, i) => i), inSel = (m) => m >= S.from && m <= S.to;
    const showGym = S.unit !== "bar", showBar = S.unit !== "gym";
    const ds = [];
    const fade = (c) => all.map((m) => (inSel(m) ? c : alpha(c, 0.28)));
    if (showGym) ds.push({ label: "ArmBar Gym", data: all.map((m) => agg(m, m).gymRev), backgroundColor: fade(css("--gym")) });
    if (showBar) ds.push({ label: "ArmBar Bar", data: all.map((m) => agg(m, m).barRev), backgroundColor: fade(css("--bar")) });
    ds.forEach((d, i) => Object.assign(d, { maxBarThickness: 26, borderSkipped: false, borderColor: css("--surface"), borderWidth: { top: ds.length > 1 && i === 0 ? 2 : 0 },
      borderRadius: i === ds.length - 1 ? { topLeft: 4, topRight: 4 } : 0 }));
    draw("cTrend", { type: "bar", data: { labels: MONTHS.map((m) => mLabel(m)), datasets: ds }, plugins: [bandPlugin],
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 300 }, interaction: { mode: "index", intersect: false },
        scales: axes({ x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 9 } },
                       y: { stacked: true, ticks: { callback: (v) => peso(v), maxTicksLimit: 6 } } }),
        plugins: { legend: { display: false }, band: { from: S.from, to: S.to },
          tooltip: { ...tooltip(), callbacks: { label: (c) => ` ${c.dataset.label}: ${pesoFull(c.raw)}`,
            footer: (it) => (it.length > 1 ? "Total: " + pesoFull(it.reduce((s, i) => s + i.raw, 0)) : "") } } } } });
    if (b) {
      const g = b.gymRev ? a.gymRev / b.gymRev - 1 : 0, r = b.barRev ? a.barRev / b.barRev - 1 : 0;
      $("#tTrend").textContent = S.unit === "gym" ? `Gym revenue ${g >= 0 ? "up" : "down"} ${Math.abs(g * 100).toFixed(1)}% vs prior period`
        : S.unit === "bar" ? `Bar revenue ${r >= 0 ? "up" : "down"} ${Math.abs(r * 100).toFixed(1)}% vs prior period`
        : `Revenue ${revGrowth >= 0 ? "up" : "down"} ${Math.abs(revGrowth * 100).toFixed(1)}%: Gym ${signed(g * 100)}, Bar ${signed(r * 100)}`;
    } else $("#tTrend").textContent = "Monthly revenue by business unit";

    // ---- branch comparison
    const per = BR.map((name, bi) => ({ name, bi, a: agg(S.from, S.to, (x) => x === bi), b: pr ? agg(pr[0], pr[1], (x) => x === bi) : null }))
      .sort((x, y) => y.a.rev - x.a.rev);
    const dimC = (c, bi) => (inBranch(bi) ? c : alpha(c, 0.25));
    const bds = [];
    if (showGym) bds.push({ label: "ArmBar Gym", data: per.map((p) => p.a.gymRev), backgroundColor: per.map((p) => dimC(css("--gym"), p.bi)) });
    if (showBar) bds.push({ label: "ArmBar Bar", data: per.map((p) => p.a.barRev), backgroundColor: per.map((p) => dimC(css("--bar"), p.bi)) });
    bds.forEach((d, i) => Object.assign(d, { maxBarThickness: 24, borderSkipped: false, borderColor: css("--surface"),
      borderWidth: { right: bds.length > 1 && i === 0 ? 2 : 0 }, borderRadius: i === bds.length - 1 ? { topRight: 4, bottomRight: 4 } : 0 }));
    const maxRev = Math.max(...per.map((p) => p.a.rev));
    draw("cBranch", { type: "bar", data: { labels: per.map((p) => p.name), datasets: bds }, plugins: [endLabels],
      options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: { duration: 300 }, layout: { padding: { right: 8 } },
        scales: axes({ x: { stacked: true, max: maxRev * 1.32, ticks: { callback: (v) => peso(v), maxTicksLimit: 5 } },
                       y: { stacked: true, grid: { display: false }, ticks: { color: css("--text-2"), font: { size: 12.5 } } } }),
        plugins: { legend: { display: false },
          endLabels: { labels: per.map((p) => ({ text: `${pct(p.a.margin, 0)} margin`, crit: p.a.margin < TGT.marginCrit, dim: !inBranch(p.bi) })) },
          tooltip: { ...tooltip(), callbacks: { label: (c) => ` ${c.dataset.label}: ${pesoFull(c.raw)}`,
            footer: (it) => { const p = per[it[0].dataIndex]; return `Total ${pesoFull(p.a.rev)} · Operating margin ${pct(p.a.margin)}`; } } } } } });
    const weak = per.filter((p) => p.a.margin < TGT.marginCrit).map((p) => p.name);
    $("#tBranch").textContent = weak.length ? `${weak.join(" and ")} earn the least per peso (margin below ${pct(TGT.marginCrit, 0)})`
      : `${per[0].name} leads revenue; all branches above ${pct(TGT.marginCrit, 0)} margin`;

    // ---- exceptions table
    const rows = per.map((p) => {
      const g = p.b && p.b.rev ? p.a.rev / p.b.rev - 1 : null, act = p.b && p.b.active ? p.a.active / p.b.active - 1 : null;
      const why = []; let lvl = 0;
      if (p.a.renew != null && p.a.renew < TGT.renewCrit) { why.push(`Renewal ${pct(p.a.renew, 0)} (below ${pct(TGT.renewCrit, 0)})`); lvl = 2; }
      else if (p.a.renew != null && p.a.renew < TGT.renew) { why.push(`Renewal ${pct(p.a.renew, 0)} (below target)`); lvl = Math.max(lvl, 1); }
      if (p.a.margin < TGT.marginCrit) { why.push(`Margin ${pct(p.a.margin, 0)} (below ${pct(TGT.marginCrit, 0)})`); lvl = 2; }
      else if (p.a.margin < TGT.margin) { why.push(`Margin ${pct(p.a.margin, 0)} (below target)`); lvl = Math.max(lvl, 1); }
      if (g != null && g < 0) { why.push("Revenue falling"); lvl = Math.max(lvl, 1); }
      if (act != null && act < -0.05) { why.push(`Members ${signed(act * 100, 0)}`); lvl = Math.max(lvl, 1); }
      return { ...p, g, act, why, lvl: ["good", "warning", "critical"][lvl], rank: lvl };
    }).sort((x, y) => y.rank - x.rank || x.a.margin - y.a.margin);
    $("#tblExc").innerHTML = `<thead><tr><th>Status</th><th>Branch</th><th class="num">Revenue</th><th class="num">vs prior</th>
      <th class="num">Op. margin</th><th class="num">Renewal</th><th class="num">Active members</th><th>Why</th></tr></thead><tbody>` +
      rows.map((r) => `<tr class="${inBranch(r.bi) ? "" : "dim"}"><td>${pill(r.lvl)}</td><td class="branch">${r.name}</td>
        <td class="num">${peso(r.a.rev)}</td><td class="num">${r.g == null ? "—" : signed(r.g * 100)}</td>
        <td class="num">${pct(r.a.margin)}</td><td class="num">${pct(r.a.renew)}</td>
        <td class="num">${r.a.active.toLocaleString()} ${r.act == null ? "" : `<span style="color:var(--muted)">(${signed(r.act * 100, 0)})</span>`}</td>
        <td class="why">${r.why.join(" · ") || "No issues"}</td></tr>`).join("") + "</tbody>";
    const crit = rows.filter((r) => r.rank === 2).map((r) => r.name), watch = rows.filter((r) => r.rank === 1).length;
    $("#tExc").textContent = crit.length ? `${crit.length} branch${crit.length > 1 ? "es" : ""} need action now: ${crit.join(", ")}`
      : watch ? `${watch} branch${watch > 1 ? "es" : ""} to watch, none critical` : "All branches on track";

    // ---- headline
    $("#headline").textContent = crit.length
      ? `Focus next month on ${crit.join(" and ")}: falling member renewals and thin margins.`
      : "No branch needs urgent action this period.";
  }

  /* ---------------- render: page 2 (Gym & Bar drill-down) ---------------- */
  function renderDrill() {
    const a = agg(S.from, S.to), pr = priorRange(), b = pr ? agg(pr[0], pr[1]) : null;
    const scope = S.branch === "all" ? "all branches" : BR[+S.branch];
    $("#periodNote2").textContent = `${mLabel(MONTHS[S.from], 1)} – ${mLabel(MONTHS[S.to], 1)} · ${scope}` +
      (pr ? ` · compared with ${mLabel(MONTHS[pr[0]])}–${mLabel(MONTHS[pr[1]])}` : "");
    const showGym = S.unit !== "bar", showBar = S.unit !== "gym";
    document.querySelectorAll('#page-drill [data-unit="gym"]').forEach((e) => (e.hidden = !showGym));
    document.querySelectorAll('#page-drill [data-unit="bar"]').forEach((e) => (e.hidden = !showBar));

    // ---- KPI cards
    const chg = (cur, prev, fmt) => (prev == null || cur == null || !prev ? "No prior period to compare"
      : `<b class="${cur >= prev ? "up" : "down"}">${cur >= prev ? "▲" : "▼"} ${fmt(cur, prev)}</b> vs prior period`);
    const rel = (c, p) => signed((c / p - 1) * 100), pts = (c, p) => signed((c - p) * 100, 1, " pts");
    const actChg = b && b.active ? a.active / b.active - 1 : null;
    const k2 = [
      { unit: "gym", label: "Active gym members", tag: "end of period", value: a.active.toLocaleString(), cmp: chg(a.active, b && b.active, rel),
        lvl: actChg == null ? null : actChg >= 0 ? "good" : actChg > -0.05 ? "warning" : "critical", series: (m) => agg(m, m).active },
      { unit: "gym", label: "New gym members", value: a.newM.toLocaleString(), cmp: chg(a.newM, b && b.newM, rel), lvl: null, series: (m) => agg(m, m).newM },
      { unit: "bar", label: "Member share of Bar sales", value: pct(a.memShare), cmp: chg(a.memShare, b && b.memShare, pts), lvl: null, series: (m) => agg(m, m).memShare },
      { unit: "bar", label: "Average Bar ticket", value: a.ticket ? pesoFull(a.ticket) : "—", cmp: chg(a.ticket, b && b.ticket, rel),
        lvl: b && b.ticket ? (a.ticket >= b.ticket ? "good" : a.ticket / b.ticket - 1 > -0.08 ? "warning" : "critical") : null, series: (m) => agg(m, m).ticket },
    ].filter((k) => (k.unit === "gym" ? showGym : showBar));
    const sparkFrom = Math.max(0, S.to - 11);
    $("#kpis2").innerHTML = k2.map((k, i) => `<article class="card kpi">
        <div class="label"><span>${k.label}${k.tag ? ` <span style="color:var(--muted)">· ${k.tag}</span>` : ""}</span>${k.lvl ? pill(k.lvl) : ""}</div>
        <div class="value">${k.value}</div><div class="cmp">${k.cmp}</div>
        <div class="spark"><canvas id="sq${i}" aria-hidden="true"></canvas></div></article>`).join("");
    k2.forEach((k, i) => { const v = []; for (let m = sparkFrom; m <= S.to; m++) v.push(k.series(m)); spark(document.getElementById("sq" + i), v, k.lvl); });

    const all = MONTHS.map((_, i) => i), labels = MONTHS.map((m) => mLabel(m));
    const lineBase = { borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2, pointHoverBorderColor: css("--surface"), tension: 0.3, spanGaps: true };

    // ---- renewal by branch: grey context, highlight branches below target (or the selected branch)
    if (showGym) {
      const series = BR.map((name, bi) => ({ name, bi, data: all.map((m) => { const r = agg(Math.max(0, m - 2), m, (x) => x === bi).renew; return r == null ? null : r * 100; }) }));
      const last = (s) => { const v = s.data.slice(0, S.to + 1).filter((x) => x != null); return v[v.length - 1]; };
      const focus = S.branch !== "all" ? [+S.branch] : series.filter((s) => last(s) < TGT.renew * 100).map((s) => s.bi);
      const hi = ["#ffffff", "#ff8a8a", "#f5c542"];
      const ds = series.map((s) => { const k = focus.indexOf(s.bi), on = k >= 0;
        return { label: s.name, data: s.data, ...lineBase, borderColor: on ? hi[k % hi.length] : "rgba(195,194,183,.35)", borderWidth: on ? 2.5 : 1.5,
                 pointHoverBackgroundColor: on ? hi[k % hi.length] : "#8a8a8a", order: on ? 0 : 1 }; });
      ds.push({ label: `Target ${pct(TGT.renew, 0)}`, data: all.map(() => TGT.renew * 100), borderColor: css("--muted"), borderWidth: 1, borderDash: [5, 5], pointRadius: 0, pointHoverRadius: 0, order: 2 });
      const endNames = { id: "endNames", afterDatasetsDraw(chart) {
        const c = chart.ctx; c.save(); c.font = "600 11.5px Poppins, sans-serif"; c.textBaseline = "middle";
        const placed = [];
        chart.data.datasets.forEach((d, i) => { if (i >= series.length) return; const meta = chart.getDatasetMeta(i);
          const pt = meta.data[S.to]; if (!pt || d.data[S.to] == null) return;
          let y = pt.y; while (placed.some((p) => Math.abs(p - y) < 14)) y += 14; placed.push(y);
          c.fillStyle = focus.includes(series[i].bi) ? "#fff" : css("--muted"); c.fillText(series[i].name, chart.chartArea.right + 8, y); });
        c.restore(); } };
      draw("cRenew", { type: "line", data: { labels, datasets: ds }, plugins: [bandPlugin, endNames],
        options: { responsive: true, maintainAspectRatio: false, animation: { duration: 300 }, interaction: { mode: "index", intersect: false },
          layout: { padding: { right: 88 } },
          scales: axes({ x: { grid: { display: false }, ticks: { maxRotation: 0, maxTicksLimit: 9 } }, y: { suggestedMin: 50, suggestedMax: 85, ticks: { callback: (v) => v + "%" } } }),
          plugins: { legend: { display: false }, band: { from: S.from, to: S.to },
            tooltip: { ...tooltip(), itemSort: (x, y) => y.raw - x.raw, filter: (i) => i.datasetIndex < series.length,
              callbacks: { label: (c) => ` ${c.dataset.label}: ${c.raw == null ? "—" : c.raw.toFixed(1) + "%"}` } } } } });
      const below = series.filter((s) => last(s) < TGT.renewCrit * 100).map((s) => s.name);
      $("#tRenew").textContent = below.length ? `${below.join(" and ")} renewals fell below ${pct(TGT.renewCrit, 0)}` : "All branches renew at or near target";
    }

    // ---- member discount effect (Bar)
    if (showBar) {
      const gm = all.map((m) => agg(m, m).barGM * 100), ms = all.map((m) => agg(m, m).memShare * 100);
      const di = MONTHS.indexOf(D.memberDiscountStart);
      const marker = { id: "marker", afterDatasetsDraw(chart) { if (di < 0) return;
        const x = chart.scales.x.getPixelForValue(di) - (chart.scales.x.getPixelForValue(1) - chart.scales.x.getPixelForValue(0)) / 2, ar = chart.chartArea, c = chart.ctx;
        c.save(); c.strokeStyle = css("--text-2"); c.setLineDash([3, 3]); c.beginPath(); c.moveTo(x, ar.top); c.lineTo(x, ar.bottom); c.stroke();
        c.setLineDash([]); c.fillStyle = css("--text-2"); c.font = "11px Poppins, sans-serif"; c.textAlign = "right"; c.fillText("15% member discount →", x - 6, ar.top + 12); c.restore(); } };
      draw("cDisc", { type: "line", data: { labels, datasets: [
          { label: "Bar gross margin", data: gm, ...lineBase, borderColor: css("--bar"), pointHoverBackgroundColor: css("--bar") },
          { label: "Member share of Bar sales", data: ms, ...lineBase, borderColor: css("--teal"), pointHoverBackgroundColor: css("--teal") }] },
        plugins: [bandPlugin, marker],
        options: { responsive: true, maintainAspectRatio: false, animation: { duration: 300 }, interaction: { mode: "index", intersect: false },
          scales: axes({ x: { grid: { display: false }, ticks: { maxRotation: 0, maxTicksLimit: 7 } }, y: { min: 0, max: 70, ticks: { callback: (v) => v + "%", stepSize: 10 } } }),
          plugins: { legend: { display: false }, band: { from: S.from, to: S.to },
            tooltip: { ...tooltip(), callbacks: { label: (c) => ` ${c.dataset.label}: ${c.raw.toFixed(1)}%` } } } } });
      const avg = (arr, f, t) => { const v = arr.slice(f, t + 1); return v.reduce((s, x) => s + x, 0) / v.length; };
      if (di > 0) {
        const gmB = avg(gm, 0, di - 1), gmA = avg(gm, di, MONTHS.length - 1), msB = avg(ms, 0, di - 1), msA = avg(ms, di, MONTHS.length - 1);
        $("#tDisc").textContent = `Discount lifted member share ${msB.toFixed(0)}% → ${msA.toFixed(0)}%, but cut Bar margin ${(gmB - gmA).toFixed(1)} pts`;
      }
    }

    // ---- Bar products by gross profit
    if (showBar) {
      const prod = D.products.map((p) => ({ ...p, rev: 0, cost: 0, qty: 0 }));
      for (const r of T.barProduct) if (r.mi >= S.from && r.mi <= S.to && inBranch(r.bi)) { const p = prod[r.pi]; p.rev += r.rev; p.cost += r.cost; p.qty += r.qty; }
      prod.forEach((p) => { p.gp = p.rev - p.cost; p.m = p.rev ? p.gp / p.rev : 0; });
      prod.sort((x, y) => y.gp - x.gp);
      const top = prod.slice(0, 10);
      const maxGp = top[0].gp;
      draw("cProd", { type: "bar", data: { labels: top.map((p) => p.product_name), datasets: [{ label: "Gross profit", data: top.map((p) => p.gp),
          backgroundColor: top.map((_, i) => (i < 3 ? css("--bar") : alpha(css("--bar"), 0.45))), maxBarThickness: 18, borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: false }] },
        plugins: [endLabels],
        options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
          scales: axes({ x: { max: maxGp * 1.25, ticks: { callback: (v) => peso(v), maxTicksLimit: 5 } }, y: { grid: { display: false }, ticks: { color: css("--text-2"), autoSkip: false } } }),
          plugins: { legend: { display: false }, endLabels: { labels: top.map((p) => ({ text: pct(p.m, 0) })) },
            tooltip: { ...tooltip(), callbacks: { title: (i) => `${top[i[0].dataIndex].product_name} · ${top[i[0].dataIndex].category}`,
              label: (c) => { const p = top[c.dataIndex]; return [` Gross profit: ${pesoFull(p.gp)}`, ` Sales: ${pesoFull(p.rev)}`, ` Units sold: ${p.qty.toLocaleString()}`]; } } } } } });
      $("#tProd").textContent = `${top[0].product_name} and ${top[1].product_name} earn the Bar the most profit`;
    }

    // ---- Gym revenue by plan & service
    if (showGym) {
      const items = D.plans.map((p) => ({ name: p.plan_name + " plan", kind: "plan", rev: 0, n: 0 }))
        .concat(D.services.map((s) => ({ name: s, kind: "service", rev: 0, n: 0 })));
      for (const r of T.planMonth) if (r.mi >= S.from && r.mi <= S.to && inBranch(r.bi)) { items[r.pli].rev += r.rev; items[r.pli].n += r.new + r.ren; }
      for (const r of T.serviceMonth) if (r.mi >= S.from && r.mi <= S.to && inBranch(r.bi)) { const it = items[D.plans.length + r.si]; it.rev += r.rev; it.n += r.n; }
      items.sort((x, y) => y.rev - x.rev);
      const total = items.reduce((s, i) => s + i.rev, 0), maxR = items[0].rev;
      draw("cPlans", { type: "bar", data: { labels: items.map((i) => i.name), datasets: [{ label: "Revenue", data: items.map((i) => i.rev),
          backgroundColor: items.map((i) => (i.kind === "plan" ? css("--gym") : alpha(css("--gym"), 0.45))), maxBarThickness: 18, borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: false }] },
        plugins: [endLabels],
        options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
          scales: axes({ x: { max: maxR * 1.25, ticks: { callback: (v) => peso(v), maxTicksLimit: 5 } }, y: { grid: { display: false }, ticks: { color: css("--text-2"), autoSkip: false } } }),
          plugins: { legend: { display: false }, endLabels: { labels: items.map((i) => ({ text: pct(i.rev / total, 0) })) },
            tooltip: { ...tooltip(), callbacks: { label: (c) => { const i = items[c.dataIndex];
              return [` Revenue: ${pesoFull(i.rev)} (${pct(i.rev / total, 0)} of Gym)`, ` ${i.kind === "plan" ? "Payments" : "Sessions / passes"}: ${i.n.toLocaleString()}`]; } } } } } });
      $("#tPlans").textContent = `${items[0].name.replace(" plan", "")} memberships bring ${pct(items[0].rev / total, 0)} of Gym revenue`;
    }

    // ---- headline
    const parts = [];
    if (showGym && actChg != null) parts.push(`active members ${actChg >= 0 ? "up" : "down"} ${Math.abs(actChg * 100).toFixed(0)}%`);
    if (showBar && b) parts.push(`member share of Bar sales ${pct(a.memShare, 0)}`);
    $("#headline2").textContent = parts.length ? `This period: ${parts.join(", ")}.` : "What is driving the numbers inside each business unit?";
  }

  let page = "overview";
  const render = () => (page === "overview" ? renderOverview() : renderDrill());

  /* ---------------- filters, tabs ---------------- */
  function initFilters() {
    const opts = MONTHS.map((m, i) => `<option value="${i}">${mLabel(m, 1)}</option>`).join("");
    $("#fFrom").innerHTML = opts; $("#fTo").innerHTML = opts;
    $("#fBranch").innerHTML = `<option value="all">All branches</option>` + BR.map((b, i) => `<option value="${i}">${b}</option>`).join("");
    const sync = () => { $("#fFrom").value = S.from; $("#fTo").value = S.to; $("#fBranch").value = S.branch; $("#fUnit").value = S.unit; };
    sync();
    $("#fFrom").onchange = (e) => { S.from = +e.target.value; if (S.from > S.to) S.to = S.from; sync(); render(); };
    $("#fTo").onchange = (e) => { S.to = +e.target.value; if (S.to < S.from) S.from = S.to; sync(); render(); };
    $("#fBranch").onchange = (e) => { S.branch = e.target.value; render(); };
    $("#fUnit").onchange = (e) => { S.unit = e.target.value; render(); };
  }
  const show = (p) => {
    page = p;
    document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.page === p)));
    $("#page-overview").hidden = p !== "overview";
    $("#page-drill").hidden = p !== "drill";
    try { history.replaceState(null, "", "#" + p); } catch (_) {}
    scrollTo({ top: 0 });
    render();
  };
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => show(t.dataset.page)));
  $("#refresh").textContent = `Data refreshed ${D.generated} · Jan 2025 – Jun 2026 · 5 branches`;
  $("#refreshSide").textContent = `Data refreshed ${D.generated}`;

  initFilters();
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => show(location.hash === "#drill" ? "drill" : "overview"));
})();
