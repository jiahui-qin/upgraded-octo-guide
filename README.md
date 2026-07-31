# 豆瓣"我看过的电影"爬虫

爬取豆瓣用户的"看过"电影列表，含基础字段（标题/评分/评价日期/短评）、电影详情、海报图片，输出 `data/movies.json`。**支持增量更新**——后续运行只抓新增，不重复爬历史。

## 安装

```bash
npm install
```

## 配置

复制 `.env.example` 为 `.env`，填入：

```
DOUBAN_USER_ID=62818720          # 个人主页 URL 中的 ID
DOUBAN_COOKIE=bid=...; dbcl2=... # 登录 Cookie（见下方获取方法）
```

### 获取 Cookie

1. 用浏览器登录 https://www.douban.com
2. 打开 https://movie.douban.com/people/62818720/collect
3. 按 F12 打开开发者工具 → Network 标签
4. 刷新页面，点击任意一个请求 → Headers → Request Headers
5. 找到 `Cookie:` 那一行，复制冒号后面的**整段**内容，粘贴到 `.env` 的 `DOUBAN_COOKIE=` 后面

> Cookie 含登录态（`dbcl2`），会过期。脚本检测到登录墙会暂停并提示重新复制。

## 使用

```bash
# 增量更新（默认）—— 只抓新增电影及其详情/海报
npm start

# 全量重爬 —— 重爬所有列表页（断点续爬仍生效，详情/海报已完成则跳过）
npm run full

# 重爬所有电影的详情页（不重爬列表和海报）
npm run refresh-detail

# 跳过海报下载
node src/index.js --no-poster
```

## 输出

- `data/movies.json` —— 全量电影数据（每次运行后保持最新）
- `data/state.json` —— 运行状态（增量比对 + 断点续爬）
- `posters/{subject_id}.jpg` —— 海报图片

### movies.json 结构

```json
{
  "meta": {
    "user_id": "62818720",
    "user_name": "...",
    "total_seen": 218,
    "last_crawl_at": "2026-07-29T...",
    "crawl_mode": "incremental"
  },
  "movies": [
    {
      "subject_id": "26752088",
      "title": "我不是药神",
      "url": "https://movie.douban.com/subject/26752088/",
      "poster": "posters/26752088.jpg",
      "my_rating": 5,
      "my_date": "2018-07-16",
      "my_comment": "好电影",
      "detail": {
        "directors": ["文牧野"],
        "actors": ["徐峥", "王传君"],
        "year": "2018",
        "genres": ["剧情", "喜剧"],
        "douban_rating": 9.0
      }
    }
  ]
}
```

## 增量更新原理

豆瓣"看过"按标记时间倒序（最新在前）。增量运行时从第 1 页往后爬：

- 遇到 `subject_id` 不在本地 → 新电影，全量爬详情+海报
- 当**连续一整页（15 条）全部已是本地已有且评价日期一致** → 判定已追上历史，停止翻页

这样最多多爬一页即可检测新增，不用重爬全量。

## 注意事项

- 首次全量约 15–25 分钟（列表页 + 详情页 + 海报，按间隔请求避免触发反爬）
- 修改已有电影的评分/短评不会改变排序，默认增量**不检测**这类修改；需要时用 `npm run full` 全量重爬
- 固定使用 `mode=grid` 视图

## 观影手记 · 展示页

基于爬虫数据生成一个**杂志编辑风**的个人观影记录静态站：刊头/卷首语、观影日历热力图、品味坐标散点、海报片单、类型光谱、地理版图、年代河流、常驻创作者、年度回顾等 12 个栏目，纯 HTML + CSS + 手写 SVG，零框架、零图表库。

### 本地预览

```bash
npm run build:site          # 读 data/movies.json + posters/ → 生成 dist/
npx serve dist              # 或 python -m http.server -d dist 8765
```

构建脚本 `scripts/build-site.mjs` 零依赖、零 `import src/`，与爬虫完全解耦：只把 `site/index.html`、`site/style.css`、`site/app.js` 与数据/海报合成自包含的 `dist/`（CSS 内联进 HTML，数据内联为 `window.__MOVIE_DATA__`，全部用相对路径）。`dist/` 不入库。

### 部署到 GitHub Pages

仓库已配好 `.github/workflows/deploy.yml`：`main` 分支上 `data/movies.json`、`posters/`、`site/`、`scripts/build-site.mjs` 等路径有变更即自动构建并部署；也支持在仓库 **Actions** 标签页手动触发。所以日常只需 `git commit && git push` 数据，展示页会自动更新。

**首次使用需做一次设置**（之后无需再改）：

1. 推送代码到 GitHub 的 `main` 分支（确保 `.gitignore` 已放行 `data/movies.json` 与 `posters/`，否则 CI 拿不到数据）
2. 仓库 **Settings → Pages → Build and deployment → Source** 选 **"GitHub Actions"**（默认是 "Deploy from a branch"，必须切过来）
3. 回 **Actions** 标签页，确认 "部署观影手记到 GitHub Pages" 跑绿，之后访问 Pages 给出的 URL 即可

> 远程海报兜底依赖访客联网（本地 `posters/*.jpg` 优先）；无本地海报且无远程 `poster_url` 者用 CSS 占位图。仓库公开时观影数据即公开——本就是公开展示页，无额外暴露。
