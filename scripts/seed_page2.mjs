// 预填第 2 页数据（start=15，即第 16-30 条），模拟"漏掉了较新的第 1 页"。
// 之后跑增量：第 1 页 15 条全是新增（爬详情）→ 第 2 页全命中 → 停止。
import { config, validateConfig } from "../src/config.js";
import { getListHtml } from "../src/http.js";
import { parseListPage } from "../src/listParser.js";
import { saveMovies, saveState, setSubjectState } from "../src/store.js";
import { nowISO } from "../src/utils.js";

validateConfig();

const movies = [];
const state = { user_id: config.userId, last_run_at: nowISO(), subjects: {} };

// 只抓第 2 页（start=15）
const html = await getListHtml(15);
const { items } = parseListPage(html);
for (const item of items) {
  movies.push({ ...item, poster: null, detail: null });
  setSubjectState(state, item.subject_id, {
    my_date: item.my_date, has_detail: false, has_poster: false,
  });
}
console.log(`预填第 2 页: ${items.length} 条，subject_id 范围 ${items[0].subject_id}..${items[items.length-1].subject_id}`);

saveMovies({
  meta: { user_id: config.userId, total_seen: movies.length, last_crawl_at: nowISO(), crawl_mode: "seed" },
  movies,
});
saveState(state);
console.log(`预填完成: ${movies.length} 部。跑增量应: 第1页15条新增+详情 → 第2页全命中 → 停`);
