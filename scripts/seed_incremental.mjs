// 预填前 N 页的列表数据到 movies.json + state.json（不含详情/海报），
// 用于验证增量更新逻辑：之后跑增量应快速命中已有数据并停止。
import { config, validateConfig } from "../src/config.js";
import { getListHtml } from "../src/http.js";
import { parseListPage } from "../src/listParser.js";
import { saveMovies, saveState, setSubjectState } from "../src/store.js";
import { nowISO } from "../src/utils.js";

validateConfig();

const PAGES = 2; // 预填前 2 页 = 30 条
const movies = [];
const state = { user_id: config.userId, last_run_at: nowISO(), subjects: {} };

for (let p = 0; p < PAGES; p++) {
  const start = p * config.pageSize;
  const html = await getListHtml(start);
  const { items } = parseListPage(html);
  for (const item of items) {
    movies.push({ ...item, poster: null, detail: null });
    setSubjectState(state, item.subject_id, {
      my_date: item.my_date, has_detail: false, has_poster: false,
    });
  }
  console.log(`预填第 ${p + 1} 页: ${items.length} 条`);
}

saveMovies({
  meta: { user_id: config.userId, total_seen: movies.length, last_crawl_at: nowISO(), crawl_mode: "seed" },
  movies,
});
saveState(state);
console.log(`预填完成: ${movies.length} 部，现在跑增量应只翻 1 页就停`);
