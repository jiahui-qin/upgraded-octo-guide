// 构建个人观影记录展示页（杂志编辑风），零依赖、零 import src/。
// 读 data/movies.json + 扫描 posters/ → 生成自包含 dist/。
// 源文件位于 site/（index.html / style.css / app.js），构建时 CSS 内联进 HTML。
//
// 用法：node scripts/build-site.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, cpSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// 短哈希：用于给 data.js / app.js 的引用追加 ?v=<hash>，强制浏览器在每次构建后拉取新版本
// （python SimpleHTTPServer 不发 Cache-Control，浏览器会用启发式缓存；GitHub Pages 也发长缓存，版本化 URL 同样适用）
function shortHash(s) {
  return createHash("sha1").update(s).digest("hex").slice(0, 8);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_FILE = join(ROOT, "data", "movies.json");
const POSTER_DIR = join(ROOT, "posters");
const SITE_DIR = join(ROOT, "site");
const DIST_DIR = join(ROOT, "dist");

// ---------- 1. 读取并处理数据 ----------
function loadData() {
  if (!existsSync(DATA_FILE)) {
    throw new Error(`找不到 ${DATA_FILE}，请先运行爬虫 (npm start) 生成数据。`);
  }
  const raw = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  const movies = Array.isArray(raw) ? raw : raw.movies || [];
  if (!Array.isArray(movies)) throw new Error("movies.json 结构异常：movies 字段非数组。");
  return movies;
}

// 海报目录索引（一次扫描，避免逐条 existsSync）
function buildPosterIndex() {
  const set = new Set();
  if (existsSync(POSTER_DIR)) {
    for (const f of readdirSync(POSTER_DIR)) {
      if (f.endsWith(".jpg")) set.add(f);
    }
  }
  return set;
}

// 解析片长：取首个 "数字分钟"，回退首个数字，无则 0
function parseRuntime(s) {
  if (!s) return 0;
  const m = String(s).match(/(\d+)\s*分钟/);
  if (m) return parseInt(m[1], 10);
  const m2 = String(s).match(/(\d+)/);
  return m2 ? parseInt(m2[1], 10) : 0;
}

function processMovies(movies, posterSet) {
  return movies.map((m) => {
    const id = m.subject_id;
    const d = m.detail || {};
    // 海报解析：本地 jpg 优先 → 远程 webp → 占位
    let poster = { src: "", kind: "none" };
    if (id && posterSet.has(`${id}.jpg`)) {
      poster = { src: `./posters/${id}.jpg`, kind: "local" };
    } else if (m.poster_url) {
      poster = { src: m.poster_url, kind: "remote" };
    }
    return {
      id,
      title: m.title || d.title || "",
      alt: m.alt_title || "",
      url: m.url || "",
      myRating: m.my_rating ?? null,
      myDate: m.my_date || "",
      myComment: m.my_comment || "",
      poster,
      year: d.year || "",
      doubanRating: typeof d.douban_rating === "number" ? d.douban_rating : null,
      ratingCount: d.rating_count || 0,
      runtime: parseRuntime(d.runtime),
      directors: d.directors || [],
      actors: (d.actors || []).slice(0, 6),       // 灯箱仅展示前 6，截断省体积
      genres: d.genres || [],
      countries: d.countries || [],
      aka: (d.aka || []).slice(0, 3),             // 灯箱仅展示前 3
      imdb: d.imdb || "",
      releaseDates: (d.release_dates || []).slice(0, 2), // 灯箱仅展示前 2
    };
  });
}

// ---------- 2. 统计计算 ----------
function tally(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function computeStats(movies) {
  const total = movies.length;
  const dates = movies.map((m) => m.myDate).filter(Boolean).sort();
  const dateRange = dates.length ? { start: dates[0], end: dates[dates.length - 1] } : { start: "", end: "" };

  // 总片长（天）
  const totalMins = movies.reduce((s, m) => s + (m.runtime || 0), 0);
  const totalDays = +(totalMins / 60 / 24).toFixed(1);

  // 评分分布
  const ratingDist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let ratedCount = 0;
  for (const m of movies) {
    if (m.myRating && ratingDist[m.myRating] !== undefined) {
      ratingDist[m.myRating]++;
      ratedCount++;
    }
  }
  const fiveStar = ratingDist[5];

  // 类型频次 + 我的均分
  const genreMap = new Map(); // name -> {count, mySum, myN}
  for (const m of movies) {
    for (const g of m.genres) {
      if (!genreMap.has(g)) genreMap.set(g, { count: 0, mySum: 0, myN: 0 });
      const e = genreMap.get(g);
      e.count++;
      if (m.myRating) { e.mySum += m.myRating; e.myN++; }
    }
  }
  const genreCounts = [...genreMap.entries()]
    .map(([name, e]) => ({ name, count: e.count, avgMy: e.myN ? +(e.mySum / e.myN).toFixed(2) : null }))
    .sort((a, b) => b.count - a.count);

  // 国家频次
  const countryMap = new Map();
  for (const m of movies) for (const c of m.countries) tally(countryMap, c);
  const countryCounts = [...countryMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  // 上映年代（10 年桶）
  const decadeMap = new Map();
  for (const m of movies) {
    const y = parseInt(m.year, 10);
    if (!y || isNaN(y)) continue;
    const dec = Math.floor(y / 10) * 10;
    tally(decadeMap, dec);
  }
  const decadeDist = [...decadeMap.entries()].map(([decade, count]) => ({ decade, count })).sort((a, b) => a.decade - b.decade);

  // 观影月度热力
  const monthMap = new Map();
  for (const m of movies) {
    if (m.myDate) tally(monthMap, m.myDate.slice(0, 7));
  }
  const monthDist = [...monthMap.entries()].map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month));

  // 观影年度切片
  const watchYearMap = new Map();
  for (const m of movies) {
    if (m.myDate) tally(watchYearMap, m.myDate.slice(0, 4));
  }
  const watchYears = [...watchYearMap.entries()].map(([year, count]) => ({ year, count })).sort((a, b) => a.year.localeCompare(b.year));

  // 日度频次（供日历热力用，精简）
  const dayMap = new Map();
  for (const m of movies) {
    if (m.myDate) tally(dayMap, m.myDate);
  }
  const dayCounts = [...dayMap.entries()].map(([date, count]) => ({ date, count }));

  // Top 导演 / 演员（看过 ≥3 部的导演，≥5 部的演员）
  function topCreators(field, min) {
    const map = new Map();
    for (const m of movies) {
      for (const name of m[field]) {
        if (!map.has(name)) map.set(name, { count: 0, mySum: 0, myN: 0 });
        const e = map.get(name);
        e.count++;
        if (m.myRating) { e.mySum += m.myRating; e.myN++; }
      }
    }
    return [...map.entries()]
      .filter(([, e]) => e.count >= min)
      .map(([name, e]) => ({ name, count: e.count, avgMy: e.myN ? +(e.mySum / e.myN).toFixed(2) : null }))
      .sort((a, b) => b.count - a.count || (b.avgMy || 0) - (a.avgMy || 0))
      .slice(0, 12);
  }
  const topDirectors = topCreators("directors", 3);
  const topActors = topCreators("actors", 5);

  // 评分差极端片单：myRating*2 - doubanRating
  const diffed = movies
    .filter((m) => m.myRating && m.doubanRating != null)
    .map((m) => ({ id: m.id, title: m.title, year: m.year, mine: m.myRating, douban: m.doubanRating, diff: +(m.myRating * 2 - m.doubanRating).toFixed(1), poster: m.poster }))
    .sort((a, b) => b.diff - a.diff);
  const treasures = diffed.slice(0, 6); // 我高豆瓣低（独爱宝藏）
  const overhyped = [...diffed].reverse().slice(0, 6); // 我低豆瓣高

  // 最高产月
  let peakMonth = null;
  for (const m of monthDist) if (!peakMonth || m.count > peakMonth.count) peakMonth = m;

  // 卷首语原料
  const topGenre = genreCounts[0];
  const topCountry = countryCounts[0];

  return {
    total,
    dateRange,
    totalDays,
    totalMins,
    ratingDist,
    ratedCount,
    fiveStar,
    genreCounts,
    countryCounts,
    decadeDist,
    monthDist,
    watchYears,
    dayCounts,
    topDirectors,
    topActors,
    treasures,
    overhyped,
    peakMonth,
    topGenre,
    topCountry,
  };
}

// ---------- 3. 卷首语生成 ----------
function editorNote(stats) {
  const { total, totalDays, dateRange, peakMonth, topGenre, topCountry, ratingDist, fiveStar } = stats;
  const span = dateRange.start && dateRange.end ? `${dateRange.start.slice(0, 7)} 至 ${dateRange.end.slice(0, 7)}` : "—";
  const peak = peakMonth ? `${peakMonth.month}（${peakMonth.count} 部）` : "—";
  const genre = topGenre ? `${topGenre.name}（${topGenre.count} 部）` : "—";
  const country = topCountry ? `${topCountry.name}（${topCountry.count} 部）` : "—";
  return {
    span,
    peak,
    genre,
    country,
    body: `自 ${span}，我于光影间穿行 ${total} 次，累计 ${totalDays} 个昼夜不曾离开放映厅的光束。最沉浸的月份是 ${peak}；最常造访的类型是 ${genre}，最频繁的国度是 ${country}。其中 ${fiveStar} 部被我郑重授予五星——它们是我私人的电影正典。`,
  };
}

// ---------- 4. 文件组装 ----------
function readSite(name) {
  const p = join(SITE_DIR, name);
  if (!existsSync(p)) throw new Error(`缺少站点源文件 ${p}`);
  return readFileSync(p, "utf8");
}

function buildHtml(cssInline, appJs, dataJs) {
  let html = readSite("index.html");
  // 将 <!-- BUILD:STYLE --> 占位替换为内联 <style>
  html = html.replace("<!-- BUILD:STYLE -->", `<style>\n${cssInline}\n</style>`);
  // 给脚本引用追加内容哈希，破除浏览器对同名子资源的启发式缓存
  const appV = shortHash(appJs);
  const dataV = shortHash(dataJs);
  html = html.replace('src="./data.js"', `src="./data.js?v=${dataV}"`);
  html = html.replace('src="./app.js"', `src="./app.js?v=${appV}"`);
  return html;
}

// ---------- 5. 主流程 ----------
function main() {
  const t0 = Date.now();
  const movies = loadData();
  const posterSet = buildPosterIndex();
  const processed = processMovies(movies, posterSet);
  const stats = computeStats(processed);
  const note = editorNote(stats);

  // 清理并重建 dist
  if (existsSync(DIST_DIR)) rmSync(DIST_DIR, { recursive: true, force: true });
  mkdirSync(join(DIST_DIR, "posters"), { recursive: true });

  // data.js
  const dataPayload = {
    generatedAt: new Date().toISOString(),
    stats,
    note,
    movies: processed,
  };
  const dataJs = `window.__MOVIE_DATA__ = ${JSON.stringify(dataPayload)};`;
  writeFileSync(join(DIST_DIR, "data.js"), dataJs, "utf8");

  // app.js（原样复制，运行时读 window.__MOVIE_DATA__）
  const appJs = readSite("app.js");
  writeFileSync(join(DIST_DIR, "app.js"), appJs, "utf8");

  // index.html（内联 CSS + 脚本引用按内容哈希版本化，破除浏览器缓存）
  writeFileSync(join(DIST_DIR, "index.html"), buildHtml(readSite("style.css"), appJs, dataJs), "utf8");

  // 复制海报（仅本地存在的）
  let copied = 0;
  for (const f of posterSet) {
    cpSync(join(POSTER_DIR, f), join(DIST_DIR, "posters", f));
    copied++;
  }

  // 摘要
  const remoteCount = processed.filter((m) => m.poster.kind === "remote").length;
  const noPoster = processed.filter((m) => m.poster.kind === "none").length;
  console.log("─".repeat(56));
  console.log("  观影记录展示页构建完成");
  console.log("─".repeat(56));
  console.log(`  电影总数      ${String(stats.total).padStart(6)}`);
  console.log(`  观影跨度      ${stats.dateRange.start} → ${stats.dateRange.end}`);
  console.log(`  累计时长      ${stats.totalDays} 天 (${stats.totalMins} 分钟)`);
  console.log(`  五星数量      ${String(stats.fiveStar).padStart(6)}`);
  console.log(`  本地海报      ${String(copied).padStart(6)}  (已复制)`);
  console.log(`  远程兜底      ${String(remoteCount).padStart(6)}  (webp)`);
  console.log(`  无海报        ${String(noPoster).padStart(6)}  (占位图)`);
  console.log(`  输出目录      ${DIST_DIR}`);
  console.log(`  耗时          ${Date.now() - t0} ms`);
  console.log("─".repeat(56));
}

main();
