# 月光笔记 · AI Galgame（现实风格 · 真人照片立绘）

一个 AI 驱动的 galgame 架构 demo：女主角台词、剧情导演、长期记忆摘要分别由可插拔的
LLM 模块负责（未配置 API Key 时自动走本地离线模拟器，开箱即玩）。

**立绘全部来自 `love_girls/` 文件夹里的真人照片，不做二次元风格。**

## 快速开始

```bash
npm install
npm run db        # 启动本地嵌入式 PostgreSQL（数据在 .pgdata/，首次自动初始化）
npm run dev       # 打开 http://localhost:3000 （首次启动会自动同步立绘并建表）
```

数据库连接读取 `.env` 里的 `DATABASE_URL`（本地默认
`postgresql://postgres:postgres@127.0.0.1:5432/app_db`）。首次访问任意页面时
drizzle 会自动建表（`npm run db` 已包含）；也可以手动执行 `npx drizzle-kit push`。

## 立绘管理（love_girls/）

- `love_girls/<女主名>/` —— **一个文件夹 = 一位女主角**，文件夹名就是她的名字。
  目前有两位：`林知鸢/`（11 张）和 `江心妍/`（17 张）。
- 把新的 `.jpg / .jpeg / .png / .webp` 照片直接丢进对应文件夹即可：
  - `npm run dev` / `npm run build` 启动时自动同步；
  - 游戏运行中也会自动发现（约 5 秒缓存），刷新页面即可看到。
- **新增一个女主**：在 `love_girls/` 下新建一个以她名字命名的文件夹，放入照片，
  游戏会自动创建该角色（通用现实向人设，可在游戏内「设置」页改成你想要的人设）。
- 删除照片同样会被同步（`public/characters/` 只是自动生成的副本，勿手动编辑）。

照片会同步到 `public/characters/<id>/` 并生成 `manifest.json`；游戏中对话进行时
立绘自动轮换，也可以点击立绘手动切换照片。

## AI 接入

不填任何 Key 即可玩（本地离线模拟）。要接真实大模型，在游戏内 **设置** 页
（`/settings`）可视化配置各模块的 endpoint / 密钥 / 模型 / 提示词，或参考
`.env.example` 使用环境变量。三个模块：

| 模块 | 职责 |
| --- | --- |
| CHARACTER | 女主角台词生成（每个角色独立 persona） |
| DIRECTOR | 剧情导演：场景切换、时间、在场角色、剧情选项 |
| MEMORY | 长期记忆摘要，让女主"记住"你们的对话 |

## 目录速览

```
love_girls/            真人照片立绘源（一个文件夹一位女主）
scripts/sync-characters.mjs   立绘同步 CLI（dev/build 自动执行）
scripts/dev-db.mjs     本地嵌入式 PostgreSQL
src/lib/characters/    立绘同步 + 图库读取（gallery.ts / sync-girls.mjs）
src/lib/ai/            三个 AI 模块 + 离线模拟器
src/lib/game/          游戏核心逻辑（存档/对话/剧情推进）
```
