import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { getPosterBuffer } from "./http.js";

export function posterPath(subjectId) {
  return path.join(config.posterDir, `${subjectId}.jpg`);
}

export function posterExists(subjectId) {
  return fs.existsSync(posterPath(subjectId));
}

// 下载单张海报；已存在则跳过。返回本地相对路径（相对项目根）
export async function downloadPoster(subjectId, posterUrl) {
  const dest = posterPath(subjectId);
  if (posterExists(subjectId)) return `posters/${subjectId}.jpg`;

  if (!posterUrl) return null;

  const buf = await getPosterBuffer(posterUrl);
  fs.writeFileSync(dest, buf);
  return `posters/${subjectId}.jpg`;
}

// 批量并行下载海报（受 posterConcurrency 限制）
// movies: [{subject_id, poster_url, ...}]；onDone: 每完成一张的回调
export async function downloadPostersBatch(movies, onProgress) {
  const todo = movies.filter(
    (m) => m.poster_url && !posterExists(m.subject_id)
  );
  if (todo.length === 0) return { total: 0, ok: 0, fail: 0 };

  let ok = 0;
  let fail = 0;
  let index = 0;
  const concurrency = config.posterConcurrency;
  const total = todo.length;

  async function worker() {
    while (index < todo.length) {
      const cur = todo[index++];
      try {
        const local = await downloadPoster(cur.subject_id, cur.poster_url);
        cur.poster = local;
        if (local) ok++;
        else fail++;
      } catch (err) {
        fail++;
        if (err.name === "AuthWallError") throw err;
        console.warn(`  [海报失败] ${cur.subject_id}: ${err.message}`);
      }
      if (onProgress) onProgress({ done: ok + fail, total, ok, fail });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, todo.length) }, () =>
    worker()
  );
  await Promise.all(workers);
  return { total, ok, fail };
}
