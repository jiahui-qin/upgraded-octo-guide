import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { nowISO } from "./utils.js";

// 确保 data / posters 目录存在
export function ensureDirs() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.posterDir, { recursive: true });
}

// ---------- movies.json ----------

export function loadMovies() {
  try {
    const raw = fs.readFileSync(config.moviesFile, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data.movies) ? data : { meta: {}, movies: [] };
  } catch {
    return { meta: {}, movies: [] };
  }
}

export function saveMovies(data) {
  const tmp = config.moviesFile + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, config.moviesFile);
}

// 按 subject_id 建索引，便于增量比对
export function indexMovies(data) {
  const byId = new Map();
  for (const m of data.movies) byId.set(m.subject_id, m);
  return byId;
}

// ---------- state.json ----------

export function loadState() {
  try {
    const raw = fs.readFileSync(config.stateFile, "utf8");
    return JSON.parse(raw);
  } catch {
    return { user_id: config.userId, last_run_at: null, subjects: {} };
  }
}

export function saveState(state) {
  state.user_id = config.userId;
  state.last_run_at = nowISO();
  const tmp = config.stateFile + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmp, config.stateFile);
}

// 更新某个 subject 的状态
export function setSubjectState(state, subjectId, patch) {
  if (!state.subjects[subjectId]) {
    state.subjects[subjectId] = { has_detail: false, has_poster: false, my_date: null };
  }
  Object.assign(state.subjects[subjectId], patch);
}
