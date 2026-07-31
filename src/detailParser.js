import * as cheerio from "cheerio";
import { splitTrim } from "./utils.js";

// 按 <br> 切分 #info，解析出 label -> value 的映射
function parseInfoBlock($) {
  const result = {};
  const info = $("#info")[0];
  if (!info) return result;

  const segments = [];
  let current = "";
  for (const node of info.children) {
    if (node.type === "tag" && node.name === "br") {
      segments.push(current);
      current = "";
    } else {
      current += $(node).text();
    }
  }
  if (current) segments.push(current);

  for (const seg of segments) {
    const clean = seg.replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const m = clean.match(
      /^(导演|编剧|主演|类型|制片国家\/地区|语言|上映日期|片长|又名|IMDb)[:：]\s*(.*)$/
    );
    if (m) result[m[1]] = m[2].trim();
  }
  return result;
}

// 解析详情页 HTML，返回结构化字段
export function parseDetailPage(html) {
  const $ = cheerio.load(html);
  const info = parseInfoBlock($);

  // 片名与年份
  const title = $('[property="v:itemreviewed"]').text().trim() || $("h1").text().trim();
  const yearText = $("h1 .year").text().trim(); // "(1997)"
  const year = yearText.match(/\((\d{4})\)/)?.[1] || info["上映日期"]?.match(/(\d{4})/)?.[1] || null;

  // 豆瓣评分与评分人数
  const doubanRating = parseFloat($('[property="v:average"]').text().trim()) || null;
  const ratingCount = parseInt($('[property="v:votes"]').text().trim(), 10) || null;

  return {
    title,
    year,
    douban_rating: doubanRating,
    rating_count: ratingCount,
    directors: splitTrim(info["导演"]),
    writers: splitTrim(info["编剧"]),
    actors: splitTrim(info["主演"]),
    genres: splitTrim(info["类型"]),
    countries: splitTrim(info["制片国家/地区"]),
    languages: splitTrim(info["语言"]),
    release_dates: splitTrim(info["上映日期"]),
    runtime: info["片长"] || null,
    aka: splitTrim(info["又名"]),
    imdb: info["IMDb"] || null,
  };
}
