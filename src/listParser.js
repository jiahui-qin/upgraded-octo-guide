import * as cheerio from "cheerio";
import { config } from "./config.js";

// 从电影 URL 提取 subject_id
function extractSubjectId(href) {
  if (!href) return null;
  const m = href.match(/\/subject\/(\d+)/);
  return m ? m[1] : null;
}

// 从评分 span 的 class（如 rating5-t）提取星级
function parseRating(className) {
  if (!className) return null;
  const m = className.match(/rating(\d)-t/);
  return m ? parseInt(m[1], 10) : null;
}

// 从 "(940 有用)" 提取点赞数
function parseUseful(text) {
  if (!text) return null;
  const m = text.match(/(\d+)\s*有用/);
  return m ? parseInt(m[1], 10) : null;
}

// 解析单页列表 HTML，返回 { items, total, totalPage }
export function parseListPage(html) {
  const $ = cheerio.load(html);

  // 总数：<h1>我看过的影视(1801)</h1>
  let total = null;
  const h1Text = $("h1").text().trim();
  const totalMatch = h1Text.match(/\((\d+)\)/);
  if (totalMatch) total = parseInt(totalMatch[1], 10);

  // 总页数
  let totalPage = null;
  const tp = $("span.thispage").attr("data-total-page");
  if (tp) totalPage = parseInt(tp, 10);

  const items = [];
  $("div.item.comment-item").each((_, el) => {
    const $el = $(el);
    const $titleA = $el.find(".info li.title a").first();
    const titleEm = $el.find(".info li.title em").text().trim();
    const href = $titleA.attr("href");
    const subjectId = extractSubjectId(href);

    // 标题：em 里可能是 "中文名 / 外文名"，取主名
    const titleParts = titleEm.split("/").map((s) => s.trim());
    const title = titleParts[0] || $el.find(".pic a.nbg").attr("title") || "";
    const altTitle =
      titleParts.length > 1 ? titleParts.slice(1).join(" / ") : null;

    // 海报
    const posterUrl = $el.find(".pic img").attr("src") || null;

    // 我的评分
    const ratingClass = $el
      .find('.info li span[class^="rating"][class$="-t"]')
      .attr("class");
    const myRating = parseRating(ratingClass);

    // 评价日期
    const myDate = $el.find(".info li span.date").text().trim() || null;

    // 短评
    const myComment = $el.find(".info li span.comment").text().trim() || null;

    // 点赞数
    const usefulText = $el.find(".info li span.pl").text().trim();
    const myCommentUseful = parseUseful(usefulText);

    items.push({
      subject_id: subjectId,
      title,
      alt_title: altTitle,
      url: href,
      poster_url: posterUrl,
      my_rating: myRating,
      my_date: myDate,
      my_comment: myComment,
      my_comment_useful: myCommentUseful,
    });
  });

  return { items, total, totalPage };
}
