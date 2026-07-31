import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(root, ".env") });

export const config = {
  userId: process.env.DOUBAN_USER_ID?.trim(),
  cookie: process.env.DOUBAN_COOKIE?.trim(),
  root,
  dataDir: path.join(root, "data"),
  posterDir: path.join(root, "posters"),
  moviesFile: path.join(root, "data", "movies.json"),
  stateFile: path.join(root, "data", "state.json"),
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  // 请求间隔（毫秒，带随机抖动）
  delay: {
    list: [1000, 1500],
    detail: [1000, 2000],
    poster: [400, 800],
  },
  posterConcurrency: 4, // 海报批量下载并发数
  maxRetries: 3,
  pageSize: 15,
};

export function validateConfig() {
  const errors = [];
  if (!config.userId) errors.push("缺少 DOUBAN_USER_ID，请在 .env 中配置");
  if (!config.cookie) errors.push("缺少 DOUBAN_COOKIE，请在 .env 中配置");
  if (errors.length) {
    throw new Error(
      "配置校验失败：\n  " + errors.join("\n  ") + "\n\n请参考 .env.example / README.md 配置 .env"
    );
  }
}

export const baseUrl = `https://movie.douban.com/people/${config.userId}/collect`;
