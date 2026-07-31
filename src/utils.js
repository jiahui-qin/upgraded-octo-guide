// 通用工具函数

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 在 [min, max] 范围内取一个随机毫秒数
export function randomMs(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 随机延迟（毫秒），带抖动
export async function randomDelay(min, max) {
  await sleep(randomMs(min, max));
}

// 把字符串数组按分隔符切分并清理空白；空则返回 []
export function splitTrim(str, sep = "/") {
  if (!str) return [];
  return str
    .split(sep)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ISO 时间戳（本地时区），用于 meta 字段
export function nowISO() {
  return new Date().toISOString();
}
