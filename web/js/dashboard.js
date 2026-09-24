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
  const tooltip = () => ({ backgroundColor: css("--tip-bg"), titleColor: css("--text"), bodyColor: css("--text-2"), borderColor: css("--axis"),
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
    c.save(); c.fillStyle = css("--band"); c.fillRect(l, ar.top, r - l, ar.bottom - ar.top);
    c.fillStyle = css("--muted"); c.font = "11px Poppins, sans-serif"; c.textAlign = "center";
    c.fillText("Selected period", (l + r) / 2, ar.top + 12); c.restore(); } };

  // margin labels at the end of each branch bar
  const endLabels = { id: "endLabels", afterDatasetsDraw(chart, _a, o) {
    if (!o.labels) return;
    const meta = chart.getDatasetMeta(chart.data.datasets.length - 1), c = chart.ctx;
    c.save(); c.font = "600 11.5px Poppins, sans-serif"; c.textBaseline = "middle";
    meta.data.forEach((bar, i) => { const l = o.labels[i]; if (!l) return;
      c.fillStyle = l.crit ? css("--crit-text") : css("--text-2"); c.globalAlpha = l.dim ? 0.4 : 1;
      c.fillText((l.crit ? "⚠ " : "") + l.text, bar.x + 8, bar.y); });
    c.restore(); } };

  function spark(el, values, lvl) {
    const color = lvl === "critical" ? css("--crit-text") : lvl === "warning" ? css("--warning") : css("--text-2");
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
      const hi = [css("--hi1"), css("--hi2"), css("--hi3")];
      const ds = series.map((s) => { const k = focus.indexOf(s.bi), on = k >= 0;
        return { label: s.name, data: s.data, ...lineBase, borderColor: on ? hi[k % hi.length] : css("--context-line"), borderWidth: on ? 2.5 : 1.5,
                 pointHoverBackgroundColor: on ? hi[k % hi.length] : "#8a8a8a", order: on ? 0 : 1 }; });
      ds.push({ label: `Target ${pct(TGT.renew, 0)}`, data: all.map(() => TGT.renew * 100), borderColor: css("--muted"), borderWidth: 1, borderDash: [5, 5], pointRadius: 0, pointHoverRadius: 0, order: 2 });
      const endNames = { id: "endNames", afterDatasetsDraw(chart) {
        const c = chart.ctx; c.save(); c.font = "600 11.5px Poppins, sans-serif"; c.textBaseline = "middle";
        const placed = [];
        chart.data.datasets.forEach((d, i) => { if (i >= series.length) return; const meta = chart.getDatasetMeta(i);
          const pt = meta.data[S.to]; if (!pt || d.data[S.to] == null) return;
          let y = pt.y; while (placed.some((p) => Math.abs(p - y) < 14)) y += 14; placed.push(y);
          c.fillStyle = focus.includes(series[i].bi) ? css("--text") : css("--muted"); c.fillText(series[i].name, chart.chartArea.right + 8, y); });
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

  /* ---------------- shared tables (report page + exports) ---------------- */
  const scopeText = () => {
    const unitName = S.unit === "gym" ? "ArmBar Gym" : S.unit === "bar" ? "ArmBar Bar" : "Gym + Bar";
    return `${mLabel(MONTHS[S.from], 1)} – ${mLabel(MONTHS[S.to], 1)} · ${S.branch === "all" ? "All branches" : BR[+S.branch]} · ${unitName}`;
  };
  function branchRows() {
    const pr = priorRange();
    return BR.map((name, bi) => ({ name, bi, a: agg(S.from, S.to, (x) => x === bi), b: pr ? agg(pr[0], pr[1], (x) => x === bi) : null }))
      .filter((r) => inBranch(r.bi));
  }
  function productRows() {
    const prod = D.products.map((p) => ({ ...p, rev: 0, cost: 0, qty: 0, disc: 0 }));
    for (const r of T.barProduct) if (r.mi >= S.from && r.mi <= S.to && inBranch(r.bi)) { const p = prod[r.pi]; p.rev += r.rev; p.cost += r.cost; p.qty += r.qty; p.disc += r.disc; }
    prod.forEach((p) => { p.gp = p.rev - p.cost; p.m = p.rev ? p.gp / p.rev : 0; });
    return prod.sort((x, y) => y.gp - x.gp);
  }
  function gymRows() {
    const items = D.plans.map((p) => ({ name: p.plan_name + " plan", kind: "Membership plan", rev: 0, n: 0 }))
      .concat(D.services.map((s) => ({ name: s, kind: "Gym service", rev: 0, n: 0 })));
    for (const r of T.planMonth) if (r.mi >= S.from && r.mi <= S.to && inBranch(r.bi)) { items[r.pli].rev += r.rev; items[r.pli].n += r.new + r.ren; }
    for (const r of T.serviceMonth) if (r.mi >= S.from && r.mi <= S.to && inBranch(r.bi)) { const it = items[D.plans.length + r.si]; it.rev += r.rev; it.n += r.n; }
    return items.sort((x, y) => y.rev - x.rev);
  }

  /* ---------------- render: page 3 (Insights & report) ---------------- */
  let lastInsights = [], lastRecs = [];
  function buildInsights() {
    const a = agg(S.from, S.to), pr = priorRange(), b = pr ? agg(pr[0], pr[1]) : null;
    const showGym = S.unit !== "bar", showBar = S.unit !== "gym";
    const rows = branchRows(), out = [], recs = [];
    const g = (c, p) => (p ? c / p - 1 : null);

    // 1 - growth quality
    if (b) {
      const rg = g(a.rev, b.rev), pg = g(a.profit, b.profit), gg = g(a.gymRev, b.gymRev), bg = g(a.barRev, b.barRev);
      const conv = pg != null && rg != null && pg > rg;
      out.push({ title: "Is growth turning into profit?", tag: "BQ1",
        big: `${signed(rg * 100)} revenue`,
        evidence: `Revenue <b>${peso(a.rev)}</b> vs ${peso(b.rev)} in the prior period. Operating profit <b>${peso(a.profit)}</b> (${signed(pg * 100)}). ` +
                  (S.unit === "all" ? `Gym ${signed(gg * 100)}, Bar ${signed(bg * 100)}.` : ""),
        insight: rg >= 0 ? (conv ? "Growth is healthy: profit is rising faster than revenue, so extra sales are adding margin, not just volume."
                                 : "Revenue is growing but profit is not keeping pace, so part of the growth is being eaten by costs or discounts.")
                         : "Revenue is shrinking versus the prior period, so the business is losing ground before costs are even considered.",
        action: rg >= 0 && conv ? "Keep the current mix; direct attention to the branches flagged below rather than network-wide changes."
                                : "Review operating costs and discounting in the lowest-margin branches before investing in more volume." });
    }

    // 2 - branches needing intervention
    const weak = rows.filter((r) => (r.a.renew != null && r.a.renew < TGT.renewCrit) || (r.a.margin != null && r.a.margin < TGT.marginCrit));
    const net = agg(S.from, S.to, () => true);
    if (weak.length) {
      const names = weak.map((r) => r.name).join(" and ");
      const avgRen = weak.reduce((s, r) => s + (r.a.renew || 0), 0) / weak.length, avgM = weak.reduce((s, r) => s + r.a.margin, 0) / weak.length;
      const memChg = weak.map((r) => (r.b && r.b.active ? `${r.name} ${signed((r.a.active / r.b.active - 1) * 100, 0)}` : null)).filter(Boolean).join(", ");
      out.push({ title: `${names} need${weak.length > 1 ? "" : "s"} intervention`, tag: "BQ2 · BQ5",
        big: `${pct(avgRen, 0)} renewal`,
        evidence: `Renewal rate <b>${pct(avgRen, 1)}</b> vs ${pct(net.renew, 1)} network and a ${pct(TGT.renew, 0)} target. Operating margin <b>${pct(avgM, 1)}</b> vs ${pct(net.margin, 1)} network.` +
                  (memChg ? ` Active members: ${memChg}.` : ""),
        insight: "These branches are losing members faster than they replace them, and their fixed costs (rent, staff) are spread over a shrinking base, so margin falls with them.",
        action: `Run a retention push at ${names}: call members 14 days before expiry, offer a Quarterly/Annual upgrade, and review staffing hours against check-in data.` });
      recs.push({ prio: "high", action: `Member retention programme at ${names}`, owner: "Branch managers + Gym manager",
                  kpi: "Membership renewal rate", target: `≥ ${pct(TGT.renew, 0)} within 2 quarters (now ${pct(avgRen, 0)})` });
      recs.push({ prio: "med", action: `Cost review at ${names} (rent, staffing, utilities)`, owner: "General Manager + Finance",
                  kpi: "Operating profit margin", target: `≥ ${pct(TGT.marginCrit, 0)} next quarter, ${pct(TGT.margin, 0)} by year end` });
    } else {
      out.push({ title: "No branch is below the action thresholds", tag: "BQ2 · BQ5", big: `${pct(a.renew, 0)} renewal`,
        evidence: `Renewal <b>${pct(a.renew, 1)}</b> and operating margin <b>${pct(a.margin, 1)}</b> for the selected scope.`,
        insight: "Performance in this scope is within target, so there is no urgent intervention.",
        action: "Monitor monthly; widen the filter to all branches to compare against the network." });
    }

    // 3 - member discount effect (Bar)
    const di = MONTHS.indexOf(D.memberDiscountStart);
    if (showBar && di > 0) {
      const mAgg = (m) => agg(m, m);
      const before = [], after = [];
      for (let m = 0; m < di; m++) before.push(mAgg(m)); for (let m = di; m < MONTHS.length; m++) after.push(mAgg(m));
      const avg = (arr, f) => arr.reduce((s, x) => s + f(x), 0) / arr.length;
      const gmB = avg(before, (x) => x.barGM), gmA = avg(after, (x) => x.barGM), msB = avg(before, (x) => x.memShare), msA = avg(after, (x) => x.memShare);
      const memRevB = avg(before, (x) => x.memRev), memRevA = avg(after, (x) => x.memRev), discA = avg(after, (x) => x.disc);
      const extraGP = (memRevA - memRevB) * gmA, net6 = (extraGP - discA) * 6;
      out.push({ title: "Is the 15% member discount paying for itself?", tag: "BQ4 · BQ5",
        big: `${signed((gmA - gmB) * 100, 1, " pts")} Bar margin`,
        evidence: `Since ${mLabel(D.memberDiscountStart, 1)}: member share of Bar sales <b>${pct(msB, 0)} → ${pct(msA, 0)}</b>, Bar gross margin <b>${pct(gmB, 1)} → ${pct(gmA, 1)}</b>. ` +
                  `Discounts given ≈ <b>${peso(discA)}/month</b> vs ≈ ${peso(extraGP)}/month extra gross profit from member sales.`,
        insight: net6 < 0 ? `The discount brings gym members into the Bar, but it gives away more than it earns back: roughly <b>${peso(-net6)}</b> lost every 6 months.`
                          : `The discount brings members in and roughly pays for itself (about ${peso(net6)} gained every 6 months).`,
        action: net6 < 0 ? "Replace the blanket 15% with a narrower perk, e.g. 10% on protein shakes and grilled bowls only, which members already favour."
                         : "Keep the discount and track it monthly against Bar gross margin." });
      if (net6 < 0) recs.push({ prio: "med", action: "Replace blanket 15% member discount with a targeted perk", owner: "Bar manager",
                                kpi: "Bar gross margin · Member share of Bar sales", target: `Margin back to ≥ ${pct(gmB, 0)} while member share stays ≥ ${pct(msB + (msA - msB) / 2, 0)}` });
    }

    // 4 - Bar product mix
    if (showBar) {
      const prods = productRows(), tot = prods.reduce((s, p) => s + p.gp, 0), top3 = prods.slice(0, 3);
      const sold = prods.filter((p) => p.qty > 0), low = sold.slice().sort((x, y) => x.m - y.m)[0];
      out.push({ title: "Which Bar products carry the profit?", tag: "BQ4",
        big: `${pct(top3.reduce((s, p) => s + p.gp, 0) / tot, 0)} from top 3`,
        evidence: `${top3.map((p) => `<b>${p.product_name}</b> ${peso(p.gp)}`).join(", ")}. Lowest margin: <b>${low.product_name}</b> at ${pct(low.m, 0)}.`,
        insight: top3.reduce((s, p) => s + p.gp, 0) / tot > 0.5
          ? "A few items earn most of the Bar's gross profit; low-margin items sell, but add little per sale."
          : "Profit is spread across the menu, so no single item carries the Bar; the gains come from lifting margin on the weakest items and pushing the strongest.",
        action: `Feature the top three in promos and bundles; re-price or re-cost ${low.product_name}.` });
    }

    // 5 - Gym plan mix
    if (showGym) {
      const items = gymRows(), plans = items.filter((i) => i.kind === "Membership plan"), ptot = plans.reduce((s, i) => s + i.rev, 0);
      const longP = plans.filter((i) => /Quarterly|Semi|Annual/.test(i.name)).reduce((s, i) => s + i.rev, 0);
      out.push({ title: "Which Gym offerings bring the revenue?", tag: "BQ4",
        big: `${pct(longP / ptot, 0)} from long plans`,
        evidence: `Quarterly, Semi-Annual and Annual plans bring <b>${pct(longP / ptot, 0)}</b> of membership revenue. Top offering: <b>${items[0].name}</b> (${peso(items[0].rev)}).`,
        insight: "Longer plans lock members in for months, which is exactly what the low-renewal branches are missing.",
        action: "Promote Quarterly/Annual upgrades at renewal time, especially where renewal is below target." });
    }
    lastInsights = out.slice(0, 5); lastRecs = recs.slice(0, 3);
    if (!lastRecs.length) lastRecs.push({ prio: "med", action: "Keep monitoring monthly; no branch breaches the thresholds", owner: "General Manager", kpi: "All headline KPIs", target: "Stay above targets" });
    return { a, pr };
  }

  function renderReport() {
    const { pr } = buildInsights();
    $("#periodNote3").textContent = scopeText() + (pr ? ` · vs ${mLabel(MONTHS[pr[0]])}–${mLabel(MONTHS[pr[1]])}` : "");
    $("#insights").innerHTML = lastInsights.map((x, i) => `<article class="card ins">
        <div class="title">${x.title}<span class="tag">${x.tag}</span></div>
        <div class="no">${String(i + 1).padStart(2, "0")}</div>
        <div class="col evidence"><h4>Evidence</h4><span class="big">${x.big}</span><p>${x.evidence}</p></div>
        <div class="col"><h4>Insight</h4><p>${x.insight}</p></div>
        <div class="col action"><h4>Recommended action</h4><p>${x.action}</p></div></article>`).join("");
    $("#tblRecs").innerHTML = `<thead><tr><th></th><th>Action</th><th>Priority</th><th>Owner</th><th>KPI to track</th><th>Target</th></tr></thead><tbody>` +
      lastRecs.map((r, i) => `<tr><td>${i + 1}</td><td><b>${r.action}</b></td><td><span class="prio ${r.prio}">${r.prio === "high" ? "High" : "Medium"}</span></td>
        <td>${r.owner}</td><td>${r.kpi}</td><td>${r.target}</td></tr>`).join("") + "</tbody>";
    $("#limits").innerHTML = [
      "Data is <b>simulated</b> (Jan 2025 – Jun 2026), so findings show the method, not ArmBar's real results.",
      "Revenue is <b>cash-based</b>: a 12-month membership counts fully in the month it is paid, which makes monthly Gym revenue lumpy.",
      "Renewals are only counted after a <b>14-day grace period</b>, so the most recent 2 weeks are not yet in the renewal rate.",
      "Operating costs come from a monthly finance sheet; there is <b>no cost per product or per class</b> beyond cost of goods and trainer fees.",
    ].map((t) => `<li>${t}</li>`).join("");
    $("#nexts").innerHTML = [
      "Connect the real Gym system, Bar POS and finance exports on a <b>scheduled daily refresh</b> instead of a static file.",
      "Add <b>member-level churn prediction</b> (visits in the last 30 days, plan type) so branches can call at-risk members before expiry.",
      "Track the <b>new discount perk as an experiment</b>: compare branches with and without it for one quarter.",
      "Move login to <b>per-user accounts with roles</b> (GM sees all branches, branch managers see only theirs).",
    ].map((t) => `<li>${t}</li>`).join("");
    const hi = lastInsights.find((x) => /intervention/.test(x.title));
    $("#headline3").textContent = hi ? `Top priority: ${lastRecs[0].action}.`
                                     : "Evidence → Insight → Recommended action, generated from the selected filters.";
  }

  /* ---------------- export ---------------- */
  const toast = (msg) => { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600); };
  const fileStamp = () => `ArmBar_BI_${MONTHS[S.from]}_to_${MONTHS[S.to]}${S.branch === "all" ? "" : "_" + BR[+S.branch].replace(/\s+/g, "")}`;
  const r2 = (v) => (v == null || !isFinite(v) ? "" : Math.round(v * 100) / 100);
  const p1 = (v) => (v == null || !isFinite(v) ? "" : Math.round(v * 1000) / 10);

  function monthlyTable() {
    const head = ["Month", "Branch", "Gym revenue (PHP)", "Bar revenue (PHP)", "Total revenue (PHP)", "Operating costs (PHP)", "Operating profit (PHP)",
                  "Operating margin (%)", "Memberships due", "Memberships renewed", "Renewal rate (%)", "Active members (end of month)", "Bar gross margin (%)", "Member share of Bar sales (%)"];
    const rows = [];
    for (let m = S.from; m <= S.to; m++) BR.forEach((name, bi) => {
      if (!inBranch(bi)) return;
      const a = agg(m, m, (x) => x === bi);
      const costs = (S.unit !== "bar" ? a.gymDirect + a.gymOpex : 0) + (S.unit !== "gym" ? a.barCogs + a.barOpex : 0);
      rows.push([MONTHS[m], name, S.unit === "bar" ? "" : r2(a.gymRev), S.unit === "gym" ? "" : r2(a.barRev), r2(a.rev), r2(costs), r2(a.profit),
                 p1(a.margin), a.due, a.renewed, p1(a.renew), a.active, S.unit === "gym" ? "" : p1(a.barGM), S.unit === "gym" ? "" : p1(a.memShare)]);
    });
    return [head, ...rows];
  }
  function workbookSheets() {
    const a = agg(S.from, S.to), pr = priorRange(), b = pr ? agg(pr[0], pr[1]) : null;
    buildInsights();
    const summary = [["ArmBar Business Intelligence: export"], ["Scope", scopeText()], ["Compared with", pr ? `${MONTHS[pr[0]]} to ${MONTHS[pr[1]]}` : "n/a"],
      ["Exported", new Date().toLocaleString("en-PH")], ["Source", "ArmBar Gym system, Bar POS, Finance (simulated data)"], [],
      ["KPI", "Value", "Prior period", "Target", "Unit"],
      ["Total revenue", r2(a.rev), b ? r2(b.rev) : "", "", "PHP"],
      ["Operating profit", r2(a.profit), b ? r2(b.profit) : "", "", "PHP"],
      ["Operating profit margin", p1(a.margin), b ? p1(b.margin) : "", p1(TGT.margin), "%"],
      ["Membership renewal rate", p1(a.renew), b ? p1(b.renew) : "", p1(TGT.renew), "%"],
      ["Bar gross margin", p1(a.barGM), b ? p1(b.barGM) : "", "", "%"],
      ["Active gym members (end of period)", a.active, b ? b.active : "", "", "members"],
      ["New gym members", a.newM, b ? b.newM : "", "", "members"],
      ["Member share of Bar sales", p1(a.memShare), b ? p1(b.memShare) : "", "", "%"],
      ["Average Bar ticket", r2(a.ticket), b ? r2(b.ticket) : "", "", "PHP"]];
    const branches = [["Branch", "Revenue (PHP)", "Prior period revenue (PHP)", "Growth (%)", "Operating profit (PHP)", "Operating margin (%)", "Renewal rate (%)", "Active members", "Bar gross margin (%)"],
      ...branchRows().map((r) => [r.name, r2(r.a.rev), r.b ? r2(r.b.rev) : "", r.b && r.b.rev ? p1(r.a.rev / r.b.rev - 1) : "", r2(r.a.profit), p1(r.a.margin), p1(r.a.renew), r.a.active, p1(r.a.barGM)])];
    const products = [["Product", "Category", "Units sold", "Sales after discount (PHP)", "Discounts (PHP)", "Cost of goods (PHP)", "Gross profit (PHP)", "Gross margin (%)"],
      ...productRows().map((p) => [p.product_name, p.category, p.qty, r2(p.rev), r2(p.disc), r2(p.cost), r2(p.gp), p1(p.m)])];
    const gym = [["Offering", "Type", "Payments / sessions", "Revenue (PHP)"], ...gymRows().map((i) => [i.name, i.kind, i.n, r2(i.rev)])];
    const strip = (h) => String(h).replace(/<[^>]+>/g, "");
    const insights = [["#", "Question", "Evidence", "Insight", "Recommended action"], ...lastInsights.map((x, i) => [i + 1, x.title, strip(x.evidence), strip(x.insight), strip(x.action)]),
      [], ["#", "Recommended action", "Priority", "Owner", "KPI to track", "Target"], ...lastRecs.map((r, i) => [i + 1, r.action, r.prio === "high" ? "High" : "Medium", r.owner, r.kpi, r.target])];
    const sheets = [["Summary", summary], ["Branches", branches], ["Monthly", monthlyTable()]];
    if (S.unit !== "gym") sheets.push(["Bar products", products]);
    if (S.unit !== "bar") sheets.push(["Gym plans & services", gym]);
    sheets.push(["Insights", insights]);
    return sheets;
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function exportCSV() {
    const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = monthlyTable().map((r) => r.map(esc).join(",")).join("\r\n");
    download(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), fileStamp() + "_monthly.csv");
    toast("CSV downloaded");
  }
  let xlsxLoading = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve();
    return xlsxLoading || (xlsxLoading = new Promise((ok, fail) => {
      const s = document.createElement("script"); s.src = "vendor/xlsx.mini.min.js"; s.onload = ok; s.onerror = fail; document.head.appendChild(s); }));
  }
  async function exportXLSX() {
    toast("Preparing Excel file…");
    try { await loadXLSX(); } catch { toast("Couldn't load the Excel exporter. Try CSV instead."); return; }
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of workbookSheets()) {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = rows.reduce((w, r) => { r.forEach((c, i) => { w[i] = Math.min(60, Math.max(w[i] || 8, String(c ?? "").length + 2)); }); return w; }, []).map((wch) => ({ wch }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    download(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileStamp() + ".xlsx");
    toast("Excel workbook downloaded");
  }
  function printPage() {
    $("#printCtx").textContent = `${document.querySelector(".tab[aria-selected='true'] b").textContent} · ${scopeText()} · printed ${new Date().toLocaleDateString("en-PH")}`;
    window.print();
  }
  // switch charts to print colours while printing
  let printing = false;
  addEventListener("beforeprint", () => { if (printing) return; printing = true; document.documentElement.dataset.print = "1"; Chart.defaults.animation = false; render(); });
  const resizeAll = () => Object.values(Chart.instances || {}).forEach((c) => c.resize());
  matchMedia("print").addEventListener("change", (e) => { if (e.matches) resizeAll(); });
  addEventListener("afterprint", () => { printing = false; delete document.documentElement.dataset.print; Chart.defaults.animation = {}; render(); });

  const exp = $("#export"), expBtn = $("#exportBtn");
  const closeMenu = () => { exp.classList.remove("open"); expBtn.setAttribute("aria-expanded", "false"); };
  expBtn.addEventListener("click", (e) => { e.stopPropagation(); const o = exp.classList.toggle("open"); expBtn.setAttribute("aria-expanded", String(o)); if (o) exp.querySelector(".menu button").focus(); });
  document.addEventListener("click", (e) => { if (!exp.contains(e.target)) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  document.querySelectorAll("[data-export]").forEach((btn) => btn.addEventListener("click", () => {
    closeMenu();
    const k = btn.dataset.export;
    if (k === "csv") exportCSV(); else if (k === "xlsx") exportXLSX(); else printPage();
  }));

  let page = "overview";
  const render = () => (page === "overview" ? renderOverview() : page === "drill" ? renderDrill() : renderReport());

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
    $("#page-report").hidden = p !== "report";
    scrollTo({ top: 0 });
    render();
  };
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => show(t.dataset.page)));
  $("#refresh").textContent = `Data refreshed ${D.generated} · Jan 2025 – Jun 2026 · 5 branches`;
  $("#refreshSide").textContent = `Data refreshed ${D.generated}`;

  initFilters();
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => show("overview"));
})();
