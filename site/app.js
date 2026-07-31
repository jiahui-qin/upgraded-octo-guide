/* ============================================================
   观影手记 · app.js
   原生 JS，无框架。读 window.__MOVIE_DATA__ 驱动整页。
   ============================================================ */
(function () {
  "use strict";
  const DATA = window.__MOVIE_DATA__ || { stats: {}, note: {}, movies: [] };
  const STATS = DATA.stats || {};
  const NOTE = DATA.note || {};
  const MOVIES = DATA.movies || [];

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const svgNS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, children) => {
    const n = document.createElementNS(svgNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (children != null) n.textContent = children;
    return n;
  };
  const fmtDate = (s) => (s ? s.replace(/-/g, "／") : "");
  const stars = (n) => "★".repeat(n || 0) + "☆".repeat(5 - (n || 0));

  // ---------- 工具：防抖 ----------
  function debounce(fn, ms) {
    let t;
    return function (...a) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, a), ms);
    };
  }

  // ---------- 刊头统计行 ----------
  function renderMasthead() {
    const meta = $("#mastheadMeta");
    if (!meta) return;
    const dr = STATS.dateRange || {};
    const items = [
      ["Vol.", dr.start ? dr.start.slice(0, 4) : "—"],
      ["期数", `${STATS.total || 0} 部`],
      ["编纂", NOTE.span || "—"],
    ];
    meta.innerHTML = items.map(([k, v]) => `<span>${k} · <b>${escapeHtml(v)}</b></span>`).join("");
  }

  // ---------- 卷首语 ----------
  function renderEditorNote() {
    $("#editorNoteBody").textContent = NOTE.body || "";
    $("#noteSpan").textContent = NOTE.span || "—";
    $("#notePeak").textContent = NOTE.peak || "—";
    $("#noteGenre").textContent = NOTE.genre || "—";
    $("#noteCountry").textContent = NOTE.country || "—";
  }

  // ---------- 数据仪表 ----------
  function renderNumbers() {
    const grid = $("#numbersGrid");
    if (!grid) return;
    const cells = [
      [STATS.total, "部", "总观影"],
      [STATS.totalDays, "天", "累计时长"],
      [(STATS.genreCounts || []).length, "种", "涉猎类型"],
      [(STATS.countryCounts || []).length, "国", "到访国度"],
      [STATS.fiveStar, "部", "五星正典"],
    ];
    grid.innerHTML = cells
      .map(
        ([n, u, l]) =>
          `<div class="cell"><div class="num">${n ?? 0}<span class="unit">${u}</span></div><div class="label">${l}</div></div>`
      )
      .join("");
  }

  // ---------- 图表 tooltip ----------
  const tip = $("#chartTip");
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.classList.add("show");
    const r = tip.getBoundingClientRect();
    let px = x + 12, py = y + 12;
    if (px + r.width > window.innerWidth - 8) px = x - r.width - 12;
    if (py + r.height > window.innerHeight - 8) py = y - r.height - 12;
    tip.style.left = px + "px";
    tip.style.top = py + "px";
  }
  function hideTip() {
    tip.classList.remove("show");
  }

  // ---------- 观影日历热力 ----------
  function renderCalendar() {
    const svg = $("#calendarChart");
    if (!svg) return;
    const dayCounts = STATS.dayCounts || [];
    const countMap = new Map(dayCounts.map((d) => [d.date, d.count]));
    const months = STATS.monthDist || [];
    if (!months.length) return;

    // 布局：按"年"分行堆叠——每年一行（54 个周列 × 7 个工作日行），
    // 年与年上下排列。这样 9+ 年的数据无需横向滚动，格子也能保持可读尺寸。
    const cell = 15, gap = 4, step = cell + gap;     // 每周列 19px
    const colsPerYear = 54;                            // 一年最多 53 周，留 1 列余量
    const padL = 48, padR = 14, padT = 10, padB = 14;
    const yearLabelH = 24, yearGap = 18;
    const yearH = yearLabelH + 7 * step;               // 单年行高 = 24 + 133 = 157

    // 追踪区间：用本地时间分量构造，避免与下方 new Date(yr,mo,dd)（也是本地）
    // 产生 UTC/Local 时差导致首尾各漏一天。
    const startParts = months[0].month.split("-").map(Number);   // [2012, 7]
    const endParts = months[months.length - 1].month.split("-").map(Number);
    const trackStart = new Date(startParts[0], startParts[1] - 1, 1);
    const trackEnd = new Date(endParts[0], endParts[1], 0);       // 该月最后一天
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const inRange = (d) => d >= trackStart && d <= trackEnd;

    // 年份列表
    const years = [];
    for (let y = trackStart.getFullYear(); y <= trackEnd.getFullYear(); y++) years.push(y);

    const W = padL + colsPerYear * step + padR;        // 48 + 1026 + 14 = 1088
    const H = padT + years.length * yearH + (years.length - 1) * yearGap + padB;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";

    // 颜色阶：固定阈值（峰值仅 6 部/天，1/2/3/4/5+ 分级最自然）
    // 空日灰比纸面深一档，与"看过"暖色拉开对比；范围外透明，留出部分年的空白
    // 色盲友好：各级用明度递进 + 色相拉开（暖金→橙→赭→暗红），红绿色盲也能凭明度分辨少/多
    // EMPTY 走 CSS 变量：亮色暖灰 #ece5d8"存在但安静"，暗色 #2a2832 不再成刺眼黄斑
    const EMPTY = "var(--cal-empty)";
    const OOR = "transparent";
    // 色阶随主题切换：暗色底上原暖色后两档几乎不可见，换一套明度上提的色阶
    const colors = document.body.classList.contains("dark")
      ? ["#f0d068", "#e8a040", "#d06828", "#b04020", "#8e2818"]
      : ["#e6c14a", "#d8842a", "#b8521a", "#8a2e15", "#5e1810"]; // 1 / 2 / 3 / 4 / 5+ 部（明度逐级明显下沉）
    function colorFor(c) {
      if (c < 0) return OOR;
      if (c === 0) return EMPTY;
      if (c >= 5) return colors[4];
      return colors[Math.min(c, 4) - 1];
    }

    const dowLabels = ["一", "二", "三", "四", "五", "六", "日"];

    years.forEach((yr, yi) => {
      const rowTop = padT + yi * (yearH + yearGap);
      const gridTop = rowTop + yearLabelH;

      // 年号（左侧行首）
      svg.appendChild(el("text", {
        x: 6, y: gridTop - 6, "font-size": 14, "font-weight": "600",
        fill: "var(--ink)", "font-family": "var(--serif)",
      }, String(yr)));

      // 周几标签（每行左侧，便于长滚动时辨识）
      dowLabels.forEach((lb, i) => {
        if (i % 2 === 1 && yi !== 0) return; // 非首行隔行显示，减噪
        svg.appendChild(el("text", {
          x: padL - 7, y: gridTop + i * step + cell - 3,
          "text-anchor": "end", "font-size": 9.5, fill: "var(--ink-faint)",
        }, lb));
      });

      // 月份标签（仅标在范围内的月份首日所在列）
      for (let mo = 0; mo < 12; mo++) {
        const m1 = new Date(yr, mo, 1);
        if (!inRange(m1)) continue;
        const weekCol = weekColumn(m1, yr);
        svg.appendChild(el("text", {
          x: padL + weekCol * step, y: gridTop - 8,
          "font-size": 9.5, fill: "var(--ink-soft)", "font-family": "var(--sans)",
        }, mo + 1 + "月"));
      }

      // 格子：遍历该年所有日子
      const yStart = new Date(yr, 0, 1);
      const yEnd = new Date(yr, 11, 31);
      for (let d = new Date(yStart); d <= yEnd; d.setDate(d.getDate() + 1)) {
        if (!inRange(d)) continue;
        const dateStr = fmt(d);
        const dow = (d.getDay() + 6) % 7;
        const weekCol = weekColumn(d, yr);
        if (weekCol >= colsPerYear) continue;
        const c = countMap.get(dateStr) || 0;
        const r = el("rect", {
          x: padL + weekCol * step, y: gridTop + dow * step,
          width: cell, height: cell, rx: 2.5,
          fill: colorFor(c), stroke: "var(--paper)", "stroke-width": 1.2,
          tabindex: "0", role: "img",
        });
        r.style.cursor = "pointer";
        const tip = c > 0 ? `${dateStr}　${c} 部` : `${dateStr}　未观影`;
        r.addEventListener("mouseenter", (e) => showTip(tip, e.clientX, e.clientY));
        r.addEventListener("mouseleave", hideTip);
        r.addEventListener("focus", (e) => { const b = r.getBoundingClientRect(); showTip(tip, b.left, b.top); });
        r.addEventListener("blur", hideTip);
        svg.appendChild(r);
      }
    });

    // 计算"某日在其所在年的第几周列"（以该年 1 月 1 日所在周的周一为第 0 列）
    function weekColumn(d, yr) {
      const jan1 = new Date(yr, 0, 1);
      const firstDow = (jan1.getDay() + 6) % 7; // 1月1日是周几（周一=0）
      const monday = new Date(jan1);
      monday.setDate(monday.getDate() - firstDow);
      return Math.floor((d - monday) / (7 * 86400000));
    }

    // 图例：空 + 5 级
    const legend = $("#calendarLegend");
    if (legend) {
      legend.innerHTML = [EMPTY, ...colors]
        .map((c) => `<span class="sw" style="background:${c}"></span>`).join("");
    }
  }

  // ---------- 品味坐标散点 ----------
  function renderScatter() {
    const svg = $("#scatterChart");
    if (!svg) return;
    const pts = MOVIES.filter((m) => m.myRating && m.doubanRating != null).map((m) => ({
      x: m.doubanRating, y: m.myRating * 2, count: m.ratingCount || 1, m,
    }));
    if (!pts.length) return;

    const W = 1000, H = 460, padL = 56, padR = 30, padT = 24, padB = 48;
    const iw = W - padL - padR, ih = H - padT - padB;
    const xMin = 2, xMax = 10, yMin = 2, yMax = 10;
    const sx = (x) => padL + ((x - xMin) / (xMax - xMin)) * iw;
    const sy = (y) => padT + ih - ((y - yMin) / (yMax - yMin)) * ih;

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";

    // 网格 + 轴
    for (let i = 0; i <= 4; i++) {
      const xv = xMin + (i * (xMax - xMin)) / 4;
      svg.appendChild(el("line", { x1: sx(xv), y1: padT, x2: sx(xv), y2: padT + ih, stroke: "var(--rule-fine)", "stroke-width": 1 }));
      svg.appendChild(el("text", { x: sx(xv), y: H - padB + 16, "text-anchor": "middle", "font-size": 10, fill: "var(--ink-faint)" }, xv.toFixed(1)));
      const yv = yMin + (i * (yMax - yMin)) / 4;
      svg.appendChild(el("line", { x1: padL, y1: sy(yv), x2: padL + iw, y2: sy(yv), stroke: "var(--rule-fine)", "stroke-width": 1 }));
      svg.appendChild(el("text", { x: padL - 10, y: sy(yv) + 3, "text-anchor": "end", "font-size": 10, fill: "var(--ink-faint)" }, yv.toFixed(0)));
    }
    // 轴标题
    svg.appendChild(el("text", { x: padL + iw / 2, y: H - 8, "text-anchor": "middle", "font-size": 11, fill: "var(--ink-soft)", "font-family": "var(--serif)", "font-style": "italic" }, "豆瓣评分 →"));
    svg.appendChild(el("text", { x: 16, y: padT + ih / 2, "text-anchor": "middle", "font-size": 11, fill: "var(--ink-soft)", "font-family": "var(--serif)", "font-style": "italic", transform: `rotate(-90 16 ${padT + ih / 2})` }, "← 私人评分"));

    // 对角参考线 y=x（一致线）
    svg.appendChild(el("line", { x1: sx(2), y1: sy(2), x2: sx(10), y2: sy(10), stroke: "var(--gold)", "stroke-width": 1, "stroke-dasharray": "4 4", opacity: 0.5 }));

    // 气泡：第三维（评分人数）已用半径承载，再用色彩/形状点出极端口味
    //   独爱宝藏（我高豆瓣低）→ 金色圆点；大众力捧，我独无感（我低豆瓣高）→ 暗红菱形 ◇；其余 → 暗红圆点
    const tIds = new Set((STATS.treasures || []).map((t) => t.id));
    const oIds = new Set((STATS.overhyped || []).map((t) => t.id));
    const maxCount = Math.max(...pts.map((p) => p.count));
    pts.forEach((p) => {
      const r = 3 + Math.sqrt(p.count / maxCount) * 16;
      const cx = sx(p.x), cy = sy(p.y);
      const isTreasure = tIds.has(p.m.id);
      const isOver = oIds.has(p.m.id);
      const fill = isTreasure ? "var(--gold)" : "var(--accent)";
      const baseOpacity = isTreasure ? 0.4 : 0.28;
      let c, grow, shrink;
      if (isOver) {
        // 菱形：旋转 45° 的正方形，悬停以菱形中心缩放回弹（translate 把缩放原点移到中心，避免飞走）
        c = el("rect", { x: cx - r, y: cy - r, width: r * 2, height: r * 2, transform: `rotate(45 ${cx} ${cy})`, fill, "fill-opacity": baseOpacity, stroke: fill, "stroke-width": 1, "stroke-opacity": 0.6, tabindex: "0", role: "img" });
        grow = () => c.setAttribute("transform", `translate(${cx} ${cy}) rotate(45) scale(1.3) translate(${-cx} ${-cy})`);
        shrink = () => c.setAttribute("transform", `rotate(45 ${cx} ${cy})`);
      } else {
        c = el("circle", { cx, cy, r, fill, "fill-opacity": baseOpacity, stroke: fill, "stroke-width": 1, "stroke-opacity": 0.6, tabindex: "0", role: "img" });
        grow = () => c.setAttribute("r", r * 1.3);
        shrink = () => c.setAttribute("r", r);
      }
      const tipHtml = `<b>${escapeHtml(p.m.title)}</b> (${p.m.year || "—"})<br>我：${stars(p.m.myRating)} ${p.m.myRating * 2}<br>豆瓣评分：${p.doubanRating} · ${p.count} 人评`;
      c.style.cursor = "pointer";
      c.addEventListener("mouseenter", (e) => { c.setAttribute("fill-opacity", 0.5); grow(); showTip(tipHtml, e.clientX, e.clientY); });
      c.addEventListener("mouseleave", () => { c.setAttribute("fill-opacity", baseOpacity); shrink(); hideTip(); });
      c.addEventListener("focus", () => { c.setAttribute("fill-opacity", 0.5); grow(); const b = c.getBoundingClientRect(); showTip(tipHtml, b.left, b.top); });
      c.addEventListener("blur", () => { c.setAttribute("fill-opacity", baseOpacity); shrink(); hideTip(); });
      c.addEventListener("click", () => openLightbox(p.m));
      svg.appendChild(c);
    });

    // 散点图例：说明三类点
    const legend = $("#scatterLegend");
    if (legend) legend.hidden = false;
  }

  // ---------- 散点附注片单 ----------
  function renderFilmLists() {
    const row = (f) => `<li data-id="${f.id}"><span class="ft"><b>${escapeHtml(f.title)}</b><span class="yr">${f.year || ""}</span></span><span class="fr"><span class="mine">${f.mine}★</span><span class="vs">/</span>${f.douban}</span></li>`;
    const tl = $("#treasureList");
    const ol = $("#overhypedList");
    if (tl) tl.innerHTML = (STATS.treasures || []).map(row).join("");
    if (ol) ol.innerHTML = (STATS.overhyped || []).map(row).join("");
    $$(".film-list li").forEach((li) => {
      li.addEventListener("click", () => {
        const m = MOVIES.find((x) => x.id === li.dataset.id);
        if (m) openLightbox(m);
      });
    });
  }

  // ---------- 类型光谱 / 国家条形 ----------
  function renderBars(container, data, maxN) {
    const c = $(container);
    if (!c) return;
    const max = maxN || Math.max(...data.map((d) => d.count));
    c.innerHTML = data
      .map((d) => {
        const w = (d.count / max) * 100;
        const avg = d.avgMy != null ? ` <span class="faint" style="font-size:.72rem">均${d.avgMy}★</span>` : "";
        return `<div class="bar-row"><div class="name">${d.name}${avg}</div><div class="bar-track"><div class="bar-fill" style="width:0%" data-w="${w}%"></div></div><div class="count">${d.count}</div></div>`;
      })
      .join("");
    // 触发动画
    requestAnimationFrame(() => {
      $$(".bar-fill", c).forEach((b) => (b.style.width = b.dataset.w));
    });
  }

  // ---------- 年代河流（面积图） ----------
  function renderDecades() {
    const svg = $("#decadeChart");
    if (!svg) return;
    const data = STATS.decadeDist || [];
    if (!data.length) return;
    const W = 1000, H = 360, padL = 50, padR = 30, padT = 24, padB = 40;
    const iw = W - padL - padR, ih = H - padT - padB;
    const maxC = Math.max(...data.map((d) => d.count));
    const xAt = (i) => padL + (i / (data.length - 1)) * iw;
    const yAt = (v) => padT + ih - (v / maxC) * ih;

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";

    // 网格
    for (let i = 0; i <= 4; i++) {
      const v = (maxC * i) / 4;
      const y = yAt(v);
      svg.appendChild(el("line", { x1: padL, y1: y, x2: padL + iw, y2: y, stroke: "var(--rule-fine)" }));
      svg.appendChild(el("text", { x: padL - 8, y: y + 3, "text-anchor": "end", "font-size": 10, fill: "var(--ink-faint)" }, Math.round(v)));
    }
    // 面积路径
    const pts = data.map((d, i) => [xAt(i), yAt(d.count)]);
    const lineD = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
    const areaD = lineD + ` L ${xAt(data.length - 1)} ${padT + ih} L ${xAt(0)} ${padT + ih} Z`;
    svg.appendChild(el("path", { d: areaD, fill: "var(--accent)", "fill-opacity": 0.12 }));
    svg.appendChild(el("path", { d: lineD, fill: "none", stroke: "var(--accent)", "stroke-width": 2 }));
    // 点 + 标签
    pts.forEach((p, i) => {
      const d = data[i];
      const c = el("circle", { cx: p[0], cy: p[1], r: 4, fill: "var(--accent)" });
      c.addEventListener("mouseenter", (e) => showTip(`<b>${d.decade}s</b><br>${d.count} 部`, e.clientX, e.clientY));
      c.addEventListener("mouseleave", hideTip);
      svg.appendChild(c);
      svg.appendChild(el("text", { x: p[0], y: padT + ih + 20, "text-anchor": "middle", "font-size": 11, fill: "var(--ink-soft)", "font-family": "var(--serif)" }, d.decade + "s"));
    });
  }

  // ---------- 评分趋势（折线图）----------
  // 按月聚合私人评分均值，看口味随时间变化；低样本月半透明，标记年度均分
  function renderTrend() {
    const svg = $("#trendChart");
    if (!svg) return;
    const rated = MOVIES.filter((m) => m.myRating && m.myDate);
    if (!rated.length) return;
    // 按月分桶
    const buckets = new Map(); // "YYYY-MM" -> [ratings]
    rated.forEach((m) => {
      const k = m.myDate.slice(0, 7);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(m.myRating);
    });
    const months = [...buckets.keys()].sort();
    const pts = months.map((k) => {
      const arr = buckets.get(k);
      return { month: k, avg: arr.reduce((s, r) => s + r, 0) / arr.length, n: arr.length };
    });

    const W = 1000, H = 360, padL = 50, padR = 30, padT = 24, padB = 48;
    const iw = W - padL - padR, ih = H - padT - padB;
    const yMin = 1, yMax = 5;
    const xAt = (i) => padL + (months.length <= 1 ? iw / 2 : (i / (months.length - 1)) * iw);
    const yAt = (v) => padT + ih - ((v - yMin) / (yMax - yMin)) * ih;

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";

    // 网格 + 轴
    for (let i = 0; i <= 4; i++) {
      const yv = yMin + (i * (yMax - yMin)) / 4;
      svg.appendChild(el("line", { x1: padL, y1: yAt(yv), x2: padL + iw, y2: yAt(yv), stroke: "var(--rule-fine)" }));
      svg.appendChild(el("text", { x: padL - 8, y: yAt(yv) + 3, "text-anchor": "end", "font-size": 10, fill: "var(--ink-faint)" }, yv.toFixed(0) + "★"));
    }
    // X 轴：年份标签（每年首月处）
    let lastYear = "";
    pts.forEach((p, i) => {
      const yr = p.month.slice(0, 4);
      if (yr === lastYear) return;
      lastYear = yr;
      svg.appendChild(el("text", { x: xAt(i), y: H - padB + 16, "text-anchor": "middle", "font-size": 10, fill: "var(--ink-soft)", "font-family": "var(--serif)" }, yr));
    });
    svg.appendChild(el("text", { x: padL + iw / 2, y: H - 8, "text-anchor": "middle", "font-size": 11, fill: "var(--ink-soft)", "font-family": "var(--serif)", "font-style": "italic" }, "观影时间 →"));
    svg.appendChild(el("text", { x: 16, y: padT + ih / 2, "text-anchor": "middle", "font-size": 11, fill: "var(--ink-soft)", "font-family": "var(--serif)", "font-style": "italic", transform: `rotate(-90 16 ${padT + ih / 2})` }, "← 我的月均评分"));

    // 折线 + 面积
    const lineD = pts.map((p, i) => (i ? "L" : "M") + xAt(i) + " " + yAt(p.avg)).join(" ");
    const areaD = lineD + ` L ${xAt(pts.length - 1)} ${padT + ih} L ${xAt(0)} ${padT + ih} Z`;
    svg.appendChild(el("path", { d: areaD, fill: "var(--accent)", "fill-opacity": 0.1 }));
    svg.appendChild(el("path", { d: lineD, fill: "none", stroke: "var(--accent)", "stroke-width": 2 }));

    // 数据点（低样本月半透明；hover/focus 显示详情）
    pts.forEach((p, i) => {
      const low = p.n < 3;
      const c = el("circle", { cx: xAt(i), cy: yAt(p.avg), r: low ? 2.5 : 4, fill: "var(--accent)", "fill-opacity": low ? 0.4 : 1, tabindex: "0", role: "img" });
      const tipHtml = `<b>${p.month}</b><br>月均 ${p.avg.toFixed(2)}★ · ${p.n} 部`;
      c.style.cursor = "pointer";
      c.addEventListener("mouseenter", (e) => showTip(tipHtml, e.clientX, e.clientY));
      c.addEventListener("mouseleave", hideTip);
      c.addEventListener("focus", () => { const b = c.getBoundingClientRect(); showTip(tipHtml, b.left, b.top); });
      c.addEventListener("blur", hideTip);
      svg.appendChild(c);
    });
  }

  // ---------- 常驻创作者 ----------
  function renderCompany() {
    const row = (r, i) => `<li><span class="num">${i + 1}</span><span class="nm">${escapeHtml(r.name)}</span><span class="meta">${r.count} 部${r.avgMy ? " · 均 " + r.avgMy + "★" : ""}</span></li>`;
    const dr = $("#directorRank");
    const ar = $("#actorRank");
    if (dr) dr.innerHTML = (STATS.topDirectors || []).map(row).join("");
    if (ar) ar.innerHTML = (STATS.topActors || []).map(row).join("");
  }

  // ---------- 年度回顾 ----------
  function renderYearReview() {
    const tabs = $("#yearTabs");
    const panels = $("#yearPanels");
    if (!tabs || !panels) return;
    const years = STATS.watchYears || [];
    if (!years.length) return;

    // 每年统计
    const yearStats = years.map((y) => {
      const ysMovies = MOVIES.filter((m) => m.myDate && m.myDate.slice(0, 4) === y.year);
      const rated = ysMovies.filter((m) => m.myRating);
      const topRated = [...rated].sort((a, b) => (b.myRating - a.myRating) || (b.doubanRating || 0) - (a.doubanRating || 0)).slice(0, 6);
      // 高产月
      const mm = {};
      ysMovies.forEach((m) => { const mo = m.myDate.slice(0, 7); mm[mo] = (mm[mo] || 0) + 1; });
      const peak = Object.entries(mm).sort((a, b) => b[1] - a[1])[0];
      const avgDouban = ysMovies.filter((m) => m.doubanRating != null);
      const avgD = avgDouban.length ? +(avgDouban.reduce((s, m) => s + m.doubanRating, 0) / avgDouban.length).toFixed(1) : null;
      return { ...y, topRated, peak: peak ? { month: peak[0], count: peak[1] } : null, avgDouban: avgD };
    });

    tabs.innerHTML = yearStats.map((y, i) => `<button class="year-tab${i === 0 ? " active" : ""}" data-year="${y.year}">${y.year}</button>`).join("");
    panels.innerHTML = yearStats.map((y, i) => {
      const peakStr = y.peak ? `${y.peak.month}（${y.peak.count}部）` : "—";
      const hl = y.topRated.map((m) => `<div style="cursor:pointer" data-id="${m.id}"><div style="aspect-ratio:2/3;background:var(--paper-tint);overflow:hidden;border:1px solid var(--rule-fine)">${posterImg(m, "")}</div><div style="font-family:var(--serif);font-size:.8rem;margin-top:.3rem;line-height:1.2">${escapeHtml(m.title)}</div><div style="font-size:.7rem;color:var(--accent)">${stars(m.myRating)}</div></div>`).join("");
      return `<div class="year-panel${i === 0 ? " active" : ""}" data-year="${y.year}">
        <div class="year-stat"><div class="num">${y.count}</div><div class="label">部</div></div>
        <div class="year-stat"><div class="num">${y.avgDouban ?? "—"}</div><div class="label">豆瓣均分</div></div>
        <div class="year-stat"><div class="num">${peakStr.split("（")[0]}</div><div class="label">高产月</div></div>
        <div class="year-stat best"><div class="num">${y.topRated[0] ? escapeHtml(y.topRated[0].title) : "—"}</div><div class="label">年度最佳</div></div>
        <div class="year-highlights"><h5>该年高光</h5><div class="hl-grid">${hl}</div></div>
      </div>`;
    }).join("");

    $$(".year-tab").forEach((t) => t.addEventListener("click", () => {
      $$(".year-tab").forEach((x) => x.classList.remove("active"));
      $$(".year-panel").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      $(`.year-panel[data-year="${t.dataset.year}"]`).classList.add("active");
    }));
    $$(".year-highlights [data-id]").forEach((d) => d.addEventListener("click", () => {
      const m = MOVIES.find((x) => x.id === d.dataset.id);
      if (m) openLightbox(m);
    }));
  }

  // ---------- 海报 img 生成 ----------
  function posterImg(m, cls) {
    const p = m.poster || { kind: "none", src: "" };
    const t = escapeHtml(m.title || "");
    if (p.kind === "none") return `<div class="poster-placeholder ${cls}">${t}</div>`;
    return `<img class="${cls}" src="${p.src}" alt="${t} 海报" loading="lazy" onerror="this.outerHTML='<div class=&quot;poster-placeholder&quot;>${t}</div>'" />`;
  }

  // ---------- 片单 + 筛选 ----------
  let filtered = MOVIES.slice();
  let gridGen = 0; // 渲染代次：每次 renderGrid 自增，过期 chunk 循环据此中止
  // 分卷定义：评分 → 卷。未评分单列一卷。展示顺序从高星到低星再到未评。
  const VOLUMES = [
    { key: 5, stars: "★★★★★", title: "五星正典", en: "The Canon" },
    { key: 4, stars: "★★★★", title: "四星推荐", en: "Recommended" },
    { key: 3, stars: "★★★", title: "三星可观", en: "Fair" },
    { key: 2, stars: "★★☆", title: "两星及以下", en: "Marginal" },
    { key: 0, stars: "", title: "未评分", en: "Unrated" },
  ];
  const PREVIEW_N = 12; // 每卷默认展示数
  const expandedVolumes = new Set(); // 记录用户手动展开的卷 key
  const CHIP_IDS = ["#f-year", "#f-rating", "#f-genre", "#f-country", "#f-sort"];

  // 触发式标签 chip：把空容器 <div class="chip" id="..."> 注入成
  //   <button class="chip-trigger">label ▾</button> + <ul class="chip-menu">opts</ul>
  // 选中后写入 root.dataset.value 并 dispatch change，复用现有 change→applyFilters 监听。
  // opts: ["v1","v2"] 或 [["value","label"],...]；首项为"全部"占位（value=""）。
  function chipDropdown(root, opts, allLabel) {
    if (!root) return;
    const norm = opts.map((o) => (Array.isArray(o) ? o : [o, o]));
    root.classList.add("chip");
    root.dataset.value = "";
    root.innerHTML =
      `<button class="chip-trigger" type="button" aria-haspopup="listbox" aria-expanded="false"><span class="chip-label">${allLabel}</span><span class="chip-caret">▾</span></button>` +
      `<ul class="chip-menu" role="listbox" hidden><li><button class="chip-opt active" type="button" data-value="" role="option">${allLabel}</button></li>` +
      norm.map(([v, l]) => `<li><button class="chip-opt" type="button" data-value="${v}" role="option">${l}</button></li>`).join("") + `</ul>`;
    const trigger = $(".chip-trigger", root);
    const menu = $(".chip-menu", root);
    const label = $(".chip-label", root);

    const close = () => { menu.hidden = true; root.classList.remove("open"); trigger.setAttribute("aria-expanded", "false"); };
    const open = () => {
      // 单开互斥：先关掉其他 chip
      $$(".chip.open").forEach((r) => { if (r !== root) { const m = $(".chip-menu", r); if (m) m.hidden = true; r.classList.remove("open"); const t = $(".chip-trigger", r); if (t) t.setAttribute("aria-expanded", "false"); } });
      menu.hidden = false; root.classList.add("open"); trigger.setAttribute("aria-expanded", "true");
    };
    const toggle = () => (menu.hidden ? open() : close());
    const pick = (opt) => {
      const v = opt.dataset.value;
      root.dataset.value = v;
      label.textContent = v ? opt.textContent : allLabel;
      root.classList.toggle("has-value", !!v);
      $$(".chip-opt", root).forEach((o) => o.classList.toggle("active", o === opt));
      close();
      root.dispatchEvent(new Event("change"));
    };

    trigger.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
    $$(".chip-opt", root).forEach((opt) => opt.addEventListener("click", (e) => { e.stopPropagation(); pick(opt); }));
    // click-outside 关闭
    document.addEventListener("click", (e) => { if (!root.contains(e.target)) close(); });
    // 键盘：trigger 上 Enter/Space/↓ 展开；菜单内 ↑↓ 导航、Enter 选、Esc 关
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); open(); const f = $(".chip-opt", root); if (f) f.focus(); }
      else if (e.key === "Escape") close();
    });
    menu.addEventListener("keydown", (e) => {
      const opts = $$(".chip-opt", root);
      const i = opts.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); opts[(i + 1) % opts.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); opts[(i - 1 + opts.length) % opts.length].focus(); }
      else if (e.key === "Enter") { e.preventDefault(); if (opts[i]) pick(opts[i]); }
      else if (e.key === "Escape") { close(); trigger.focus(); }
    });
    // 对外暴露重置接口
    root._reset = () => { root.dataset.value = ""; label.textContent = allLabel; root.classList.remove("has-value"); $$(".chip-opt", root).forEach((o, i) => o.classList.toggle("active", i === 0)); };
  }

  function initCollection() {
    // 填充筛选项（chip 形态）
    const years = [...new Set(MOVIES.map((m) => m.year).filter(Boolean))].sort((a, b) => b.localeCompare(a));
    const genres = (STATS.genreCounts || []).map((g) => g.name);
    const countries = (STATS.countryCounts || []).map((c) => c.name);
    chipDropdown($("#f-year"), years, "全部年代");
    chipDropdown($("#f-genre"), genres, "全部类型");
    chipDropdown($("#f-country"), countries, "全部国家");
    chipDropdown($("#f-rating"), [5, 4, 3, 2, 1].map((r) => [String(r), r + " 星"]), "全部评分");
    chipDropdown($("#f-sort"), [
      ["date-desc", "最新观看"], ["date-asc", "最早观看"], ["rating-desc", "私人评分高→低"],
      ["rating-asc", "私人评分低→高"], ["douban-desc", "豆瓣评分高→低"], ["year-desc", "上映新→旧"],
    ], "排序");
    // sort 默认值 date-desc
    const sortRoot = $("#f-sort");
    if (sortRoot) { sortRoot.dataset.value = "date-desc"; const lbl = $(".chip-label", sortRoot); if (lbl) lbl.textContent = "最新观看"; const def = $('.chip-opt[data-value="date-desc"]', sortRoot); if (def) { $$(".chip-opt", sortRoot).forEach((o) => o.classList.toggle("active", o === def)); } }

    CHIP_IDS.forEach((id) => $(id)?.addEventListener("change", applyFilters));
    $("#f-search")?.addEventListener("input", debounce(applyFilters, 200));
    applyFilters();
  }

  function applyFilters() {
    const year = $("#f-year")?.dataset.value || "";
    const rating = $("#f-rating")?.dataset.value || "";
    const genre = $("#f-genre")?.dataset.value || "";
    const country = $("#f-country")?.dataset.value || "";
    const sort = $("#f-sort")?.dataset.value || "date-desc";
    const q = ($("#f-search")?.value || "").trim().toLowerCase();

    let list = MOVIES.filter((m) => {
      if (year && m.year !== year) return false;
      if (rating && String(m.myRating) !== rating) return false;
      if (genre && !m.genres.includes(genre)) return false;
      if (country && !m.countries.includes(country)) return false;
      if (q) {
        const hay = (m.title + " " + m.alt + " " + (m.directors || []).join(" ")).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const cmp = {
      "date-desc": (a, b) => (b.myDate || "").localeCompare(a.myDate || ""),
      "date-asc": (a, b) => (a.myDate || "").localeCompare(b.myDate || ""),
      "rating-desc": (a, b) => (b.myRating || 0) - (a.myRating || 0) || (b.doubanRating || 0) - (a.doubanRating || 0),
      "rating-asc": (a, b) => (a.myRating || 0) - (b.myRating || 0),
      "douban-desc": (a, b) => (b.doubanRating || 0) - (a.doubanRating || 0),
      "year-desc": (a, b) => (b.year || "").localeCompare(a.year || ""),
    }[sort];
    list.sort(cmp);
    filtered = list;
    renderGrid();
  }

  function makeCard(m) {
    const card = document.createElement("div");
    card.className = "poster-card";
    card.dataset.id = m.id;
    card.innerHTML = `<div class="poster-frame">${posterImg(m, "")}${m.myRating ? `<div class="poster-rating">${m.myRating}★</div>` : ""}</div><div class="poster-meta"><h3 class="poster-title">${escapeHtml(m.title)}</h3><div class="poster-sub">${m.year || "—"}　${(m.genres || []).slice(0, 2).join(" · ")}</div></div>`;
    card.addEventListener("click", () => openLightbox(m));
    return card;
  }

  // 评分 → 卷 key：未评分=0，其余按星归并（1/2 星并入"两星及以下"）
  function volKeyOf(m) {
    const r = m.myRating;
    if (r == null) return 0;
    if (r >= 5) return 5;
    if (r >= 4) return 4;
    if (r >= 3) return 3;
    return 2;
  }

  function renderGrid() {
    const root = $("#posterGrid");
    const count = $("#collCount");
    if (count) count.innerHTML = `显示 <b>${filtered.length}</b> / ${MOVIES.length} 部`;
    if (!root) return;
    // 用 generation token 防止连续筛选时旧的分块循环与新一轮竞争
    const gen = ++gridGen;
    root.innerHTML = "";
    if (!filtered.length) {
      root.innerHTML = '<p class="empty-state">没有找到符合条件的电影。</p>';
      return;
    }

    // 按评分分卷（filtered 已按当前排序排好，各卷继承该顺序）
    const buckets = {};
    VOLUMES.forEach((v) => (buckets[v.key] = []));
    filtered.forEach((m) => buckets[volKeyOf(m)].push(m));

    // 大卷分块渲染队列：{(grid, items)}
    const queue = [];

    VOLUMES.forEach((v) => {
      const items = buckets[v.key];
      if (!items.length) return;
      const expanded = expandedVolumes.has(v.key);
      const show = expanded ? items : items.slice(0, PREVIEW_N);
      const vol = document.createElement("div");
      vol.className = "volume" + (expanded ? " expanded" : "");
      vol.dataset.vol = v.key;
      const canToggle = items.length > PREVIEW_N;
      vol.innerHTML = `
        <div class="volume-head">
          <div class="volume-title">
            ${v.stars ? `<span class="volume-stars" aria-hidden="true">${v.stars}</span>` : `<span class="volume-stars none" aria-hidden="true">—</span>`}
            <h3>${v.title}</h3>
            <span class="volume-en">${v.en}</span>
          </div>
          <div class="volume-meta">
            <span class="volume-count">${items.length} 部</span>
            ${canToggle ? `<button class="volume-toggle" data-vol="${v.key}">${expanded ? "收起本卷 ↑" : `展开本卷全部 ${items.length} 部 ↓`}</button>` : ""}
          </div>
        </div>
        <div class="poster-grid"></div>`;
      root.appendChild(vol);
      const grid = $(".poster-grid", vol);
      if (show.length <= PREVIEW_N) {
        show.forEach((m) => grid.appendChild(makeCard(m))); // 量小，同步渲染
      } else {
        queue.push({ grid, items: show }); // 量大队列，分块追加
      }
    });

    // 展开/收起
    $$(".volume-toggle", root).forEach((btn) =>
      btn.addEventListener("click", () => {
        const k = +btn.dataset.vol;
        if (expandedVolumes.has(k)) expandedVolumes.delete(k);
        else expandedVolumes.add(k);
        renderGrid();
      })
    );

    // 分块处理大队列（仅用户展开某卷时触发）
    if (queue.length) {
      let qi = 0, idx = 0;
      const CHUNK = 60;
      (function chunk() {
        if (gen !== gridGen) return; // 已被新一轮渲染取代
        while (qi < queue.length) {
          const { grid, items } = queue[qi];
          const end = Math.min(idx + CHUNK, items.length);
          for (; idx < end; idx++) grid.appendChild(makeCard(items[idx]));
          if (idx < items.length) { requestAnimationFrame(chunk); return; }
          qi++; idx = 0;
        }
      })();
    }
  }

  // ---------- 灯箱 ----------
  let lastFocus = null;
  const LB_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function openLightbox(m) {
    lastFocus = document.activeElement;
    const lb = $("#lightbox");
    const card = $("#lightboxCard");
    const dirNames = (m.directors || []).slice(0, 4);
    const directorCell = dirNames.length
      ? dirNames.map((d) => `<button class="fact-link" data-dir="${escapeHtml(d)}" type="button">${escapeHtml(d)}</button>`).join("、")
      : "—";
    const facts = [
      ["导演", directorCell, true],
      ["主演", (m.actors || []).slice(0, 6).join("、") || "—"],
      ["类型", (m.genres || []).join("、") || "—"],
      ["国家", (m.countries || []).join("、") || "—"],
      ["年份", m.year || "—"],
      ["片长", m.runtime ? m.runtime + " 分钟" : "—"],
      ["上映", (m.releaseDates || []).slice(0, 2).join("；") || "—"],
      ["又名", (m.aka || []).slice(0, 3).join("、") || "—"],
    ];
    card.innerHTML = `<div class="lightbox-poster">${posterImg(m, "")}</div><div class="lightbox-body">
      <h3>${escapeHtml(m.title)}</h3>
      <p class="alt">${escapeHtml(m.alt || "")}</p>
      <div class="lightbox-ratings">
        <div class="blk my"><span class="label">私人评分</span><span class="val">${m.myRating ? stars(m.myRating) : "未评"}</span></div>
        <div class="blk"><span class="label">豆瓣评分</span><span class="val">${m.doubanRating ?? "—"}</span></div>
        <div class="blk"><span class="label">评分人数</span><span class="val">${(m.ratingCount || 0).toLocaleString()}</span></div>
      </div>
      ${m.myComment ? `<div class="lightbox-comment"><span class="kicker">My Words</span>${escapeHtml(m.myComment)}</div>` : ""}
      <div class="lightbox-facts">${facts.map(([k, v, html]) => `<div class="row"><span class="k">${k}</span><span>${html ? v : escapeHtml(v)}</span></div>`).join("")}</div>
      ${m.url ? `<a class="lightbox-link" href="${m.url}" target="_blank" rel="noopener">在豆瓣查看 →</a>` : ""}
    </div>`;
    lb.classList.add("open");
    document.body.style.overflow = "hidden";
    // 焦点陷阱：Tab 在灯箱内循环
    lb.addEventListener("keydown", trapFocus);
    // 点导演名 → 跳转片单并按该导演筛选
    $$(".fact-link", card).forEach((b) =>
      b.addEventListener("click", () => {
        const dir = b.dataset.dir;
        closeLightbox();
        scrollToCollection();
        const search = $("#f-search");
        if (search) { search.value = dir; applyFilters(); }
      })
    );
    $("#lightboxClose").focus();
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function scrollToCollection() {
    const sec = $("#sec-collection");
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function trapFocus(e) {
    if (e.key !== "Tab") return;
    const lb = $("#lightbox");
    const focusables = $$(LB_SELECTOR, lb).filter((el) => el.offsetParent !== null || el === $("#lightboxClose"));
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function closeLightbox() {
    const lb = $("#lightbox");
    lb.classList.remove("open");
    lb.removeEventListener("keydown", trapFocus);
    document.body.style.overflow = "";
    if (lastFocus) lastFocus.focus();
  }
  $("#lightboxClose")?.addEventListener("click", closeLightbox);
  $("#lightbox")?.addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });

  // ---------- 目录导航 ----------
  function renderTOC() {
    const sections = $$("section[id]");
    const toc = $("#toc");
    if (!toc) return;
    const labels = {
      "sec-note": "卷首", "sec-numbers": "数说", "sec-calendar": "日历", "sec-scatter": "坐标",
      "sec-collection": "片单", "sec-genre": "类型", "sec-atlas": "版图", "sec-decades": "年代",
      "sec-trend": "趋势", "sec-company": "创作者", "sec-year": "年度", "sec-colophon": "版权",
    };
    toc.innerHTML = sections.map((s) => `<li><a href="#${s.id}" data-id="${s.id}">${labels[s.id] || s.id}</a></li>`).join("");
    // 滚动高亮
    const links = $$(".toc a");
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          links.forEach((l) => l.classList.toggle("active", l.dataset.id === e.target.id));
        }
      });
    }, { rootMargin: "-40% 0px -55% 0px" });
    sections.forEach((s) => obs.observe(s));
    // 移动端：点目录链接后收起导航
    links.forEach((l) => l.addEventListener("click", () => {
      const nav = $("#topNav");
      if (nav && nav.classList.contains("open")) nav.classList.remove("open");
      const t = $("#navToggle");
      if (t) { t.setAttribute("aria-expanded", "false"); t.textContent = "☰"; }
    }));
  }

  // 移动端导航展开/收起
  function initNavToggle() {
    const btn = $("#navToggle");
    const nav = $("#topNav");
    if (!btn || !nav) return;
    btn.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      btn.setAttribute("aria-expanded", String(open));
      btn.textContent = open ? "✕" : "☰";
    });
  }

  // ---------- 滚动揭示 ----------
  function initReveal() {
    const items = $$(".reveal");
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); obs.unobserve(e.target); } });
    }, { threshold: 0.15 });
    items.forEach((i) => obs.observe(i));
  }

  // ---------- 主题切换 ----------
  // 优先级：localStorage 用户选择 > prefers-color-scheme 系统；切换后以 localStorage 覆盖
  function initTheme() {
    const btn = $("#themeToggle");
    if (!btn) return;
    const saved = localStorage.getItem("vj-theme");
    const sysDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = saved ? saved === "dark" : sysDark;
    document.body.classList.toggle("dark", dark);
    btn.textContent = dark ? "白昼" : "阅览室";
    btn.addEventListener("click", () => {
      const d = document.body.classList.toggle("dark");
      btn.textContent = d ? "白昼" : "阅览室";
      localStorage.setItem("vj-theme", d ? "dark" : "light");
      // 主题切换后重绘日历（色阶随主题取不同套）；仅当已渲染过才重绘，避免提前触发懒渲染
      if ($("#calendarChart")?.children.length) renderCalendar();
    });
  }

  // ---------- 版权页时间戳 ----------
  function renderColophon() {
    const s = $("#colophonStamp");
    if (!s || !DATA.generatedAt) return;
    const d = new Date(DATA.generatedAt);
    s.textContent = `Generated ${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} · ${STATS.total || 0} titles archived`;
  }

  // ---------- 结构化数据 JSON-LD（社交分享富文本）----------
  function renderJSONLD() {
    const el = $("#ld-json");
    if (!el) return;
    const items = MOVIES.slice(0, 50).map((m, i) => ({
      "@type": "ListItem", position: i + 1, name: m.title,
      url: m.url || undefined,
    }));
    const ld = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "观影手记 · The Viewing Journal",
      description: "一份私人的电影观看记录。",
      numberOfItems: MOVIES.length,
      itemListElement: items,
    };
    el.textContent = JSON.stringify(ld);
  }

  // ---------- 片单附加控件：随机一部 / 重置筛选 / 搜索建议 ----------
  function initCollectionExtras() {
    // 随机一部
    $("#f-random")?.addEventListener("click", () => {
      const pool = filtered.length ? filtered : MOVIES;
      openLightbox(pool[Math.floor(Math.random() * pool.length)]);
    });
    // 重置筛选
    $("#f-reset")?.addEventListener("click", () => {
      CHIP_IDS.forEach((id) => { const r = $(id); if (r && r._reset) r._reset(); });
      const sortRoot = $("#f-sort");
      if (sortRoot) { sortRoot.dataset.value = "date-desc"; const lbl = $(".chip-label", sortRoot); if (lbl) lbl.textContent = "最新观看"; const def = $('.chip-opt[data-value="date-desc"]', sortRoot); if (def) { $$(".chip-opt", sortRoot).forEach((o) => o.classList.toggle("active", o === def)); } }
      const q = $("#f-search"); if (q) q.value = "";
      hideSuggest();
      applyFilters();
    });
    // 搜索自动补全
    const input = $("#f-search");
    const box = $("#f-suggest");
    if (input && box) {
      input.addEventListener("input", debounce(() => updateSuggest(input, box), 120));
      input.addEventListener("focus", () => updateSuggest(input, box));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { hideSuggest(); return; }
        if (box.hidden) return;
        if (e.key === "ArrowDown") { e.preventDefault(); moveSuggest(box, 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); moveSuggest(box, -1); }
        else if (e.key === "Enter" && suggestIdx >= 0) {
          const li = $$("li", box)[suggestIdx];
          if (li) {
            e.preventDefault();
            const m = MOVIES.find((x) => x.id === li.dataset.id);
            if (m) openLightbox(m);
            hideSuggest();
          }
        }
      });
      document.addEventListener("click", (e) => {
        if (!box.contains(e.target) && e.target !== input) hideSuggest();
      });
    }
  }
  let suggestIdx = -1; // 搜索建议当前高亮项，-1 表示未选中
  function updateSuggest(input, box) {
    const q = input.value.trim().toLowerCase();
    if (!q) { hideSuggest(); return; }
    const matches = MOVIES.filter((m) => {
      const hay = (m.title + " " + m.alt + " " + (m.directors || []).join(" ")).toLowerCase();
      return hay.includes(q);
    }).slice(0, 8);
    if (!matches.length) { hideSuggest(); return; }
    box.innerHTML = matches.map((m, i) =>
      `<li role="option" data-id="${m.id}" data-idx="${i}"><span class="s-title">${escapeHtml(m.title)}</span><span class="s-meta">${m.year || ""}　${escapeHtml((m.directors || []).slice(0, 1).join(""))}</span></li>`
    ).join("");
    box.hidden = false;
    suggestIdx = -1;
    $$("li", box).forEach((li) =>
      li.addEventListener("click", () => {
        const m = MOVIES.find((x) => x.id === li.dataset.id);
        if (m) openLightbox(m);
        hideSuggest();
      })
    );
  }
  function moveSuggest(box, dir) {
    const items = $$("li", box);
    if (!items.length) return;
    suggestIdx = Math.max(-1, Math.min(suggestIdx + dir, items.length - 1));
    items.forEach((li, i) => li.classList.toggle("active", i === suggestIdx));
    if (suggestIdx >= 0) items[suggestIdx].scrollIntoView({ block: "nearest" });
  }
  function hideSuggest() { const box = $("#f-suggest"); if (box) { box.hidden = true; box.innerHTML = ""; } }

  // 非首屏图表延迟渲染：进入视口附近才绘制，避免首屏一次性算完所有 SVG
  function lazyRender(id, fn) {
    const node = $(id);
    if (!node) { fn(); return; }
    const rect = node.getBoundingClientRect();
    // 已在视口内则立即渲染
    if (rect.top < window.innerHeight + 400) { fn(); return; }
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { fn(); obs.disconnect(); }
      });
    }, { rootMargin: "400px 0px" });
    obs.observe(node);
  }

  // ---------- 滚动进度条：贴底超细暗红线，如电影播放进度条 ----------
  function initScrollProgress() {
    const bar = $("#scrollProgress");
    if (!bar) return;
    let ticking = false;
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const w = max > 0 ? (window.scrollY / max) * 100 : 0;
      bar.style.width = Math.min(100, Math.max(0, w)) + "%";
      ticking = false;
    };
    window.addEventListener("scroll", () => {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();
  }

  // 刊头标题「观影手记」点击/回车回到顶部
  function initToTop() {
    const t = $("#toTop");
    if (!t) return;
    const top = () => window.scrollTo({ top: 0, behavior: "smooth" });
    t.addEventListener("click", top);
    t.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); top(); }
    });
  }

  // ---------- 启动 ----------
  function init() {
    // 首屏：同步渲染
    renderMasthead();
    renderEditorNote();
    renderNumbers();
    renderTOC();
    renderColophon();
    renderJSONLD();
    initTheme();
    initNavToggle();
    initCollection();        // 片单在首屏下方但体积可控，先初始化筛选与分卷
    initReveal();
    initCollectionExtras();
    initScrollProgress();
    initToTop();
    // 非首屏图表：进入视口附近再渲染，降低首屏负担
    lazyRender("#sec-calendar", renderCalendar);
    lazyRender("#sec-scatter", () => { renderScatter(); renderFilmLists(); });
    lazyRender("#genreBars", () => renderBars("#genreBars", STATS.genreCounts || []));
    lazyRender("#countryBars", () => renderBars("#countryBars", (STATS.countryCounts || []).slice(0, 20)));
    lazyRender("#sec-decades", renderDecades);
    lazyRender("#sec-trend", renderTrend);
    lazyRender("#sec-company", renderCompany);
    lazyRender("#sec-year", renderYearReview);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
