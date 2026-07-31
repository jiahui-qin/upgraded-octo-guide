import { Command } from "commander";
import { config, validateConfig, baseUrl } from "./config.js";
import { getListHtml, getDetailHtml, AuthWallError } from "./http.js";
import { parseListPage } from "./listParser.js";
import { parseDetailPage } from "./detailParser.js";
import {
  ensureDirs,
  loadMovies,
  saveMovies,
  indexMovies,
  loadState,
  saveState,
  setSubjectState,
} from "./store.js";
import { downloadPostersBatch, posterExists } from "./poster.js";
import { nowISO } from "./utils.js";

const program = new Command();
program
  .name("douban")
  .description("豆瓣\"我看过的电影\"爬虫（支持增量更新）")
  .option("--full", "全量重爬所有列表页")
  .option("--refresh-detail", "重爬所有电影的详情页")
  .option("--no-poster", "跳过海报下载")
  .helpOption("-h, --help", "查看帮助");
program.parse(process.argv);
const opts = program.opts();

// 处理详情：若未爬则抓详情页并解析
async function fetchDetail(movie, state) {
  try {
    const html = await getDetailHtml(movie.subject_id);
    const detail = parseDetailPage(html);
    movie.detail = detail;
    setSubjectState(state, movie.subject_id, { has_detail: true });
    return true;
  } catch (err) {
    if (err instanceof AuthWallError) throw err;
    console.warn(`  [详情失败] ${movie.title} (${movie.subject_id}): ${err.message}`);
    return false;
  }
}

// 对单条电影补充详情（海报留到最后批量并行下载）
async function enrichMovie(movie, state) {
  const st = state.subjects[movie.subject_id] || {};
  if (!st.has_detail) await fetchDetail(movie, state);
}

async function main() {
  validateConfig();
  ensureDirs();
  const withPoster = opts.poster !== false;

  // 加载已有数据
  const data = loadMovies();
  const state = loadState();
  const existing = indexMovies(data); // Map<subject_id, movie>
  const isFirstRun = data.movies.length === 0;
  const fullMode = opts.full || isFirstRun;
  const refreshDetail = !!opts.refreshDetail;

  console.log(`豆瓣看过爬虫 | 用户 ${config.userId} | 模式: ${fullMode ? "全量" : "增量"}${refreshDetail ? " + 刷新详情" : ""}${withPoster ? "" : " | 无海报"}`);
  console.log(`已有数据: ${data.movies.length} 部`);

  // --- refresh-detail 模式：只重爬详情，不爬列表 ---
  if (refreshDetail && !fullMode) {
    let ok = 0, fail = 0;
    for (const movie of data.movies) {
      const success = await fetchDetail(movie, state);
      if (success) ok++; else fail++;
      if ((ok + fail) % 10 === 0) { saveMovies(data); saveState(state); }
    }
    finalize(data, state, "refresh-detail");
    console.log(`详情刷新完成: 成功 ${ok} 失败 ${fail}`);
    return;
  }

  // --- 列表爬取 ---
  let start = 0;
  let total = null, totalPage = null;
  let newCount = 0;
  // 增量模式：连续整页全部命中已有的计数
  let consecutiveFullHitPages = 0;

  while (true) {
    const html = await getListHtml(start);
    const { items, total: t, totalPage: tp } = parseListPage(html);
    if (total === null) { total = t; totalPage = tp; }
    console.log(`\n[列表] start=${start} | 本页 ${items.length} 条 | 共 ${total} 部 / ${totalPage} 页`);

    let pageHitCount = 0; // 本页命中"已有且date一致"的数量
    for (const item of items) {
      const old = existing.get(item.subject_id);
      if (old) {
        // 已有：更新基础字段（评分/短评可能变化），记录命中
        Object.assign(old, {
          title: item.title, alt_title: item.alt_title, url: item.url,
          poster_url: item.poster_url, my_rating: item.my_rating,
          my_date: item.my_date, my_comment: item.my_comment, my_comment_useful: item.my_comment_useful,
        });
        if (old.my_date === item.my_date) pageHitCount++;
        setSubjectState(state, item.subject_id, { my_date: item.my_date });
      } else {
        // 新电影：加入数据 + 立即补详情/海报
        const movie = { ...item, poster: null, detail: null };
        data.movies.push(movie);
        existing.set(item.subject_id, movie);
        setSubjectState(state, item.subject_id, { my_date: item.my_date });
        newCount++;
        console.log(`  [新增] ${item.title} (${item.subject_id}) | ${item.my_date} | 评分 ${item.my_rating}`);
        await enrichMovie(movie, state);
      }
    }

    // 每页结束落盘
    saveMovies(data);
    saveState(state);

    // 增量模式停止判断：整页全部命中已有且 date 一致
    if (!fullMode && items.length > 0 && pageHitCount === items.length) {
      consecutiveFullHitPages++;
      console.log(`  本页全部命中已有 (${pageHitCount}/${items.length})，连续 ${consecutiveFullHitPages} 页`);
      if (consecutiveFullHitPages >= 1) {
        console.log("  已追上历史，增量爬取结束");
        break;
      }
    } else {
      consecutiveFullHitPages = 0;
    }

    // 翻页
    start += config.pageSize;
    if (totalPage !== null && start >= totalPage * config.pageSize) {
      console.log("  已到最后一页");
      break;
    }
    if (total !== null && start >= total) {
      console.log("  已爬完总数");
      break;
    }
  }

  // --- 全量模式：补全所有缺失的详情 ---
  if (fullMode) {
    console.log("\n=== 补全详情 ===");
    let detailDone = 0, detailMiss = 0;
    for (const movie of data.movies) {
      const st = state.subjects[movie.subject_id] || {};
      if (!st.has_detail) {
        const ok = await fetchDetail(movie, state);
        if (ok) detailDone++; else detailMiss++;
      } else detailDone++;
      if ((detailDone + detailMiss) % 20 === 0) {
        saveMovies(data); saveState(state);
        console.log(`  详情进度 ${detailDone + detailMiss}/${data.movies.length}`);
      }
    }
    saveMovies(data);
    saveState(state);
    console.log(`详情: 完成 ${detailDone} 缺失 ${detailMiss}`);
  }

  // --- 批量并行下载海报 ---
  if (withPoster) {
    console.log("\n=== 批量下载海报 ===");
    const result = await downloadPostersBatch(data.movies, ({ done, total, ok, fail }) => {
      if (done % 50 === 0 || done === total) {
        console.log(`  海报进度 ${done}/${total} (成功 ${ok} 失败 ${fail})`);
        // 进度落盘
        for (const m of data.movies) {
          if (m.poster) setSubjectState(state, m.subject_id, { has_poster: true });
        }
        saveMovies(data); saveState(state);
      }
    });
    // 最终标记所有已下载海报
    for (const m of data.movies) {
      if (posterExists(m.subject_id)) {
        m.poster = `posters/${m.subject_id}.jpg`;
        setSubjectState(state, m.subject_id, { has_poster: true });
      }
    }
    saveMovies(data); saveState(state);
    console.log(`海报: 待下载 ${result.total} 成功 ${result.ok} 失败 ${result.fail}`);
  }

  finalize(data, state, fullMode ? "full" : "incremental");
  const rated = data.movies.filter((m) => m.my_rating !== null).length;
  console.log(`\n完成: 共 ${data.movies.length} 部 | 新增 ${newCount} | 有评分 ${rated}`);
}

function finalize(data, state, mode) {
  data.meta = {
    user_id: config.userId,
    total_seen: data.movies.length,
    last_crawl_at: nowISO(),
    crawl_mode: mode,
  };
  saveMovies(data);
  saveState(state);
}

main().catch((err) => {
  if (err instanceof AuthWallError) {
    console.error("\n❌ " + err.message);
    process.exit(2);
  }
  console.error("\n运行出错:", err);
  process.exit(1);
});
