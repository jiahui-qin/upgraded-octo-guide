// 端到端冒烟测试：爬 1 页列表 + 第一条电影的详情 + 海报，验证完整链路
import { config, validateConfig } from "../src/config.js";
import { getListHtml, getDetailHtml, getPosterBuffer } from "../src/http.js";
import { parseListPage } from "../src/listParser.js";
import { parseDetailPage } from "../src/detailParser.js";
import fs from "fs";
import path from "path";

validateConfig();
fs.mkdirSync(config.posterDir, { recursive: true });

console.log("1) 抓取第一页列表...");
const html = await getListHtml(0);
const { items, total, totalPage } = parseListPage(html);
console.log(`   总数 ${total}, 总页 ${totalPage}, 本页 ${items.length} 条`);
console.log(`   第一条: ${items[0].title} (${items[0].subject_id}) 评分${items[0].my_rating} ${items[0].my_date}`);

console.log("2) 抓取第一条详情...");
const dhtml = await getDetailHtml(items[0].subject_id);
const detail = parseDetailPage(dhtml);
console.log(`   ${detail.title} (${detail.year}) 豆瓣${detail.douban_rating} ${detail.rating_count}人评`);
console.log(`   导演: ${detail.directors.join(", ")} | 类型: ${detail.genres.join("/")}`);

console.log("3) 下载第一条海报...");
const buf = await getPosterBuffer(items[0].poster_url);
const dest = path.join(config.posterDir, `${items[0].subject_id}.jpg`);
fs.writeFileSync(dest, buf);
console.log(`   保存到 ${dest} (${(buf.length/1024).toFixed(1)} KB)`);

console.log("\n✅ 冒烟测试通过");
