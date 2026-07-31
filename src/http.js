import axios from "axios";
import { config, baseUrl } from "./config.js";
import { randomDelay } from "./utils.js";

// 模拟桌面浏览器的请求头
const baseHeaders = {
  "User-Agent": config.userAgent,
  Cookie: config.cookie,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: baseUrl,
  Connection: "keep-alive",
};

// 自定义错误：检测到登录墙 / 验证码
export class AuthWallError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "AuthWallError";
  }
}

// axios 实例：不自动跟随 302，便于检测登录跳转
const client = axios.create({
  baseURL: "https://movie.douban.com",
  timeout: 30000,
  maxRedirects: 0,
  validateStatus: (s) => s < 400, // 3xx 由我们处理
  headers: baseHeaders,
});

// 检查响应是否撞上登录墙 / 验证码
function checkAuthWall(html, status, headers) {
  // 豆瓣登录跳转：302 -> /account/login
  if (status === 302 && /\/account\/login/i.test(headers?.location || "")) {
    throw new AuthWallError("被重定向到登录页，Cookie 可能已过期，请重新复制 DOUBAN_COOKIE");
  }
  if (typeof html === "string") {
    if (/\/account\/login|请先登录|登录豆瓣/.test(html) && html.length < 4000) {
      throw new AuthWallError("页面提示需要登录，Cookie 可能已过期，请重新复制 DOUBAN_COOKIE");
    }
    if (/请输入下面的验证码|访问验证|captcha/i.test(html) && html.length < 6000) {
      throw new AuthWallError("触发验证码，请求过快或被风控。请暂停一段时间后重试");
    }
  }
}

// 通用 GET：带重试 + 随机延迟
// kind: 'list' | 'detail' | 'poster'，用于选择请求间隔
export async function get(url, kind = "list") {
  let lastErr;
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      const res = await client.get(url, {
        responseType: kind === "poster" ? "arraybuffer" : "text",
      });
      checkAuthWall(res.data, res.status, res.headers);
      // 请求成功后等待随机延迟，避免连续请求触发风控
      await randomDelay(...config.delay[kind]);
      return res;
    } catch (err) {
      lastErr = err;
      if (err instanceof AuthWallError) throw err; // 登录墙不重试，直接抛出

      const status = err.response?.status;
      const retryable =
        err.code === "ECONNABORTED" ||
        err.code === "ETIMEDOUT" ||
        status === 429 ||
        (status >= 500 && status < 600);
      if (!retryable || attempt === config.maxRetries) throw err;

      // 指数退避：2s, 4s, 8s
      const backoff = 2000 * Math.pow(2, attempt - 1);
      console.warn(`  [重试 ${attempt}/${config.maxRetries}] ${status || err.code}，${backoff}ms 后重试`);
      await randomDelay(backoff, backoff + 1000);
    }
  }
  throw lastErr;
}

// 取列表页 HTML
export function getListHtml(start) {
  const url = `${baseUrl}?start=${start}&sort=time&type=all&filter=all&mode=grid`;
  return get(url, "list").then((res) => res.data);
}

// 取详情页 HTML
export function getDetailHtml(subjectId) {
  return get(`https://movie.douban.com/subject/${subjectId}/`, "detail").then(
    (res) => res.data
  );
}

// 下载海报，返回 Buffer
export async function getPosterBuffer(posterUrl) {
  const res = await get(posterUrl, "poster");
  return Buffer.from(res.data);
}
