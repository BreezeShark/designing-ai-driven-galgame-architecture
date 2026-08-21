# 月光笔记 · AI 驱动的 Galgame

一款由 **大语言模型（LLM）实时驱动** 的 Galgame 原型。两位女主角全部由 AI 扮演，
另有一位「剧情导演」AI 负责推进剧情、切换场景、生成选项；玩家的每一句话都会被记住，
好感度与长期记忆会随故事发展不断累积。

项目开箱即用：**不配置任何 API Key 也能完整游玩**（走本地离线模拟器）；接上任意
OpenAI 兼容的接入点后，AI 会接管所有对话与剧情，无需改动任何代码。

> 游戏标题「月光笔记」、女主角人设、剧情均为项目自带示例，可通过设置页自由修改。

---

## 功能特性

- **AI 女主**：两位女主角（林知鸢、江心妍）由 AI 扮演，性格、说话习惯由 persona 系统提示词控制。
- **AI 导演**：独立的「剧情导演」模块负责旁白、场景切换、时间推进、剧情选项与结局判定。
- **好感度与长期记忆**：每位女主在单个存档内独立累计好感度；通过「记忆摘要」把过往对话压缩成长期记忆，让角色"记得"你们之间的故事。
- **剧情选择（弹窗式）**：AI 导演会在关键节点给出多个选项。选项默认**收起**，画面底部只留一个「剧情选项 · N 个」按钮，点开才弹出对话框，不再常驻遮挡画面。
- **满屏立绘 + AI 选图**：立绘按场景高度铺满整个画面（多人同场时并排站位，非当前说话者自动压暗）；每位女主可拥有一整套立绘库，**由剧情导演 AI 根据场景 / 时间 / 氛围自动挑选**当前该用哪一张。
- **看图模式**：右侧「隐藏界面」一键收起所有 UI，只留场景与立绘；按 ESC 或点「显示界面」恢复。
- **实时立绘与场景**：女主立绘库、场景背景、标题画面均可在设置页上传替换。
- **SFW 模式（安全模式）**：一键把所有角色立绘替换为中性占位符，适合公开场合/直播游玩。
- **设置页可视化配置**：AI 接入点、密钥、模型、系统提示词、角色人设、界面素材全部可视化编辑，无需改代码。
- **多存档**：可创建多个存档，各自的剧情进度、好感度与记忆互相独立。
- **完全离线可用**：不接 API 时使用内置本地模拟器，游戏依然可玩。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Next.js 16（App Router）、React 19、Tailwind CSS 4、TypeScript |
| 后端 | Next.js API Routes（Route Handlers） |
| 数据库 | PostgreSQL + Drizzle ORM |
| AI | OpenAI 兼容 Chat Completions 接口（OpenAI / OpenRouter / vLLM / Ollama 等均可） |
| 立绘处理 | Python + onnxruntime ISNet 人像分割（完全离线抠图） |

---

## 快速开始

### 0. 环境要求

- Node.js 18+
- Docker（推荐，脚本会自动拉取 postgres:16）或本机 / 云端 PostgreSQL

### 1. 一键部署（推荐）

不用手动装依赖、配数据库、建表，一条命令全部搞定：

```bash
npm run start:local          # 开发模式：装依赖 → 起数据库 → 建表 → 启动
npm run start:local:prod     # 生产模式：构建 + 启动
```

也可以直接调用脚本并指定数据库来源：

```bash
bash scripts/start.sh dev --docker   # 数据库用 Docker（postgres:16）
bash scripts/start.sh dev --local    # 数据库用本机 PostgreSQL
```

脚本会自动完成：Node 版本检查 → 数据库准备（已有可用的 `DATABASE_URL` 直接复用；
否则优先 Docker postgres:16，没有 Docker 则退回本机 PostgreSQL）→ 生成 / 更新 `.env`
→ 缺依赖时 `npm install` → `drizzle-kit push` 建表 → 启动服务器（http://localhost:3000）。

### 2. 手动安装依赖

```bash
npm install
```

### 3. 手动配置数据库

复制环境变量模板并填入你的数据库连接串：

```bash
cp .env.example .env
# 编辑 .env，设置：
# DATABASE_URL=postgres://user:pass@localhost:5432/galgame
```

`DATABASE_URL` 是**必填项**，没有它应用无法启动。数据库表结构由 Drizzle 定义，
首次运行会在用到时自动建表 / 填充角色种子数据。

> 提示：需要一张数据库时，本地可以用
> `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=app_db postgres`
> 快速起一个。

### 4. 启动开发服务器

```bash
npm run dev
```

浏览器打开 http://localhost:3000 即可开始游戏。

### 5. （可选）接入真实 AI

**方式一：环境变量**（编辑 `.env`）

```bash
# 最简单的接法：只填这一个 key 即可让所有模块启用真实 AI
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1   # 可选，任意 OpenAI 兼容供应商
OPENAI_MODEL=gpt-4o-mini                    # 可选

# 慢模型（导演单次可能跑一两分钟）建议同时打开这两项，否则会 25s 超时并丢掉已经计费的结果
OPENAI_TIMEOUT_MS=120000                    # 可选，默认 25000
OPENAI_STREAM=1                             # 可选，SSE 流式；超时变为「空闲超时」
# OPENAI_MAX_TOKENS=4096                    # 可选，>0 时写入请求体
```

**方式二：设置页**（推荐，无需重启）

启动后在游戏内进入 **设置** 页，可视化填写各模块的接入点 / 密钥 / 模型。

> 优先级：**设置页（数据库）→ 环境变量 → 内置默认值**。
> 完全留空的模块会自动使用本地离线模拟器。

---

## 配置详解

### AI 模块（三个作用域）

每个 AI 模块可独立配置密钥 / 接入点 / 模型，用于对话、导演、记忆三个模块：

| 作用域 | 作用 | 环境变量前缀 |
| --- | --- | --- |
| `character`（角色对话） | 生成女主的台词 | `OPENAI_API_KEY_CHARACTER` |
| `director`（剧情导演） | 推进剧情、切换场景、生成选项 | `OPENAI_API_KEY_DIRECTOR` |
| `memory`（记忆摘要） | 压缩长期记忆摘要 | `OPENAI_API_KEY_MEMORY` |

字段解析顺序（先命中者胜）：

```
1. 数据库  ai.<scope>.<field>     ← 设置页配置
2. 环境变量 OPENAI_<FIELD>_<SCOPE> ← 如 OPENAI_API_KEY_DIRECTOR
3. 数据库  ai.global.<field>      ← 设置页「全局默认」
4. 环境变量 OPENAI_<FIELD>        ← 经典单 key 配置
5. 内置默认（无 key → 该模块走离线模拟器）
```

### 超时、流式输出与 max_tokens

这三个开关对三个模块（角色 / 导演 / 记忆）同时生效，写在 `.env` 里：

| 变量 | 默认 | 语义 |
| --- | --- | --- |
| `OPENAI_TIMEOUT_MS` | `25000` | 覆盖请求超时。非流式是**总超时**；流式是**空闲超时**（每收到一个 SSE chunk 就重新计时，模型一直在吐字就不会被掐断） |
| `OPENAI_STREAM` | 关闭 | `1` / `true` / `yes` / `on` 时请求体加 `stream: true`，走 SSE。女主台词会边生成边出现在对话框；导演输出的是整段场景 JSON，只享受空闲超时，不逐字上屏 |
| `OPENAI_MAX_TOKENS` | 不传 | 大于 0 时写入请求体的 `max_tokens` |

`POST /api/saves/[id]/message` 在请求体带 `{"stream": true}` 时返回 NDJSON 流（`application/x-ndjson`），一行一个事件：

```json
{"type":"delta","text":"笨、"}
{"type":"state","state":{…}}
{"type":"error","error":"…"}
```

不带 `stream` 时仍返回 `{ state }`，老调用方不受影响。即使开了 HTTP 流，只要 `OPENAI_STREAM` 没开，也只会收到一个 `state` 事件（本地模拟器同样如此）。

### SFW 模式

游戏内 **设置 → SFW 模式（安全模式）**，打开后所有角色立绘（大立绘 + 顶部头像）都会
替换为中性占位符，角色名与好感度保留。切换立即生效，无需重开游戏。

### 界面素材

在设置页可上传替换：标题画面、四张场景背景（教室 / 天台 / 公园 / 图书室）。
图片存储于数据库，服务器重启 / 重新部署后依然保留。

### 角色管理

- 可编辑已有女主的名字、身份标签、主题色、说话风格、人设提示词（persona）。
- 可**新增女主**（自定义名字 + persona + 立绘），新角色会自动加入后续剧情。
- 可删除角色（会连同她在所有存档中的好感度与记忆一并删除）。
- **立绘库**：每位女主下方是她的全部立绘缩略图，可以上传新增、删除、设为默认，
  并给每张写一句描述（如「校服 · 微笑」「居家 · 夜晚」「泳装 · 海边」）。
  描述会随 prompt 一起交给剧情导演 AI，它在切换场景时会挑一张最贴切的立绘；
  描述写得越具体，挑得越准。改完描述点「保存」，上传 / 删除 / 设为默认会立即保存。
- `public/images/characters/<角色名>/` 下的图片会被自动识别为该角色的立绘库
  （首次建表种子 + 老存档补齐都会扫描这个目录），所以 `npm run cutout` 抠出来的新图开箱即用。

---

## 项目结构

```
├── src/
│   ├── app/
│   │   ├── page.tsx                 # 标题画面
│   │   ├── play/[id]/page.tsx       # 游戏主界面
│   │   ├── saves/page.tsx           # 存档管理
│   │   ├── settings/page.tsx        # 设置页
│   │   └── api/                     # 后端 API Routes
│   │       ├── saves/               # 存档 CRUD + 对话/选项/推进/切换
│   │       ├── characters/          # 角色 CRUD
│   │       ├── settings/            # 设置读取与保存
│   │       ├── assets/              # 素材上传与读取（存于数据库）
│   │       └── health/              # 健康检查
│   ├── components/
│   │   ├── game/                    # 游戏前端组件
│   │   └── settings/                # 设置页前端
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── client.ts            # OpenAI 兼容客户端 + 多作用域配置解析
│   │   │   ├── character.ts         # 女主对话
│   │   │   ├── director.ts          # 剧情导演
│   │   │   ├── memory.ts            # 长期记忆摘要
│   │   │   ├── simulate.ts          # 本地离线模拟器
│   │   │   └── prompts.ts           # 默认系统提示词
│   │   ├── game/service.ts          # 游戏核心业务逻辑
│   │   ├── data/characters.ts       # 内置女主与背景定义
│   │   └── settings.ts              # 设置存储封装
│   └── db/
│       ├── schema.ts                # Drizzle 表结构
│       └── index.ts                 # 数据库连接
├── love_girls/                      # 女主角立绘素材目录
├── scripts/
│   ├── cutout.sh / cutout.py        # 本地离线抠图
│   └── fetch_model.py               # 下载抠图模型
├── public/images/                   # 内置图片与抠图产物
└── .env.example                     # 环境变量模板
```

---

## 数据模型

| 表 | 作用 |
| --- | --- |
| `characters` | 女主静态定义（名字、立绘库 `sprites`、默认立绘、主题色、persona 提示词） |
| `saves` | 存档（剧情进度、场景、章节、剧情摘要、结局状态） |
| `save_character_states` | 每存档 × 每角色的好感度、心情、长期记忆、互动次数 |
| `messages` | 完整对话日志（玩家 / 角色 / 旁白 / 选择） |
| `app_settings` | 键值设置（AI 配置、提示词、界面素材、SFW 模式等） |
| `assets` | 用户上传的图片（立绘 / 背景 / 标题图），以二进制存储于数据库 |

---

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run start:local` | 一键本地部署：自动装依赖 / 起数据库 / 建表 / 启动开发服务器 |
| `npm run start:local:prod` | 一键本地部署：生产构建 + 启动 |
| `npm run restart` | 重启开发服务器（改完 `.env` 后让配置生效，等价 `bash scripts/restart.sh`） |
| `npm run restart:prod` | 重启生产服务器（等价 `bash scripts/restart.sh prod`） |
| `npm run dev:talk` | 终端对话调试模式（Terminal Talk） |
| `npm run build` | 生产构建 |
| `npm start` | 启动生产服务器 |
| `npm run lint` | ESLint 检查 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run cutout` | 对 `love_girls/` 中新照片离线抠图，输出到 `public/images/characters/` |

---

## 重启服务（让 `.env` 改动生效）

`.env` 只在进程启动时读取一次。改完 `.env` 后，用下面的命令重启服务即可生效
（脚本会先结束占用端口的旧进程，再启动新进程）：

```bash
npm run restart            # 重启开发服务器（默认后台运行，日志 .logs/server.log，PID .run/server.pid）
npm run restart:prod       # 重启生产服务器（需先 npm run build）

bash scripts/restart.sh status     # 查看运行状态
bash scripts/restart.sh stop       # 只停止
bash scripts/restart.sh --foreground   # 前台运行（日志打到当前终端）
bash scripts/restart.sh --port 3001    # 指定端口
```

> 注意：`ai.*` 的密钥 / 接入点 / 模型若在**设置页**配置过，是存在数据库里的，
> 优先级高于 `.env`，改 `.env` 不会覆盖它们，需到设置页修改。
> `OPENAI_STREAM` / `OPENAI_TIMEOUT_MS` / `OPENAI_MAX_TOKENS` 只读环境变量，重启后一定生效。

---

## 终端对话调试模式（Terminal Talk）

不需要打开浏览器，在终端里体验**完整游戏循环**的调试工具。它完全复用游戏真实 AI 层：
`getCharacterReply`（角色对话）、`getDirectorUpdate`（剧情导演：开场 / 剧情选项 /
推进剧情 / 每轮对话后自动判断）、`updateMemorySummary`（长期记忆摘要）。AI 配置解析
顺序与网页端完全一致（数据库设置页 → 环境变量 → 默认），未配置 key 的模块自动走
本地模拟器，适合快速调试 persona 提示词、模型接入与剧情节奏。

```bash
npm run dev:talk                     # 交互模式（完整游戏循环）
npm run dev:talk -- "你好"           # 一次性模式：发一句话看回复后退出
npm run dev:talk -- --character 江心妍   # 指定对话角色（名字或 id），开场后直接与她对话
npm run dev:talk -- --config         # 打印 AI 配置解析结果后退出
npm run dev:talk -- --ai off         # 强制本地模拟器（不调用任何接口）
npm run dev:talk -- --stream on      # 强制流式输出（默认 auto：跟随 OPENAI_STREAM）
npm run dev:talk -- --verbose        # 打印导演更新等调试细节
```

| 命令 | 说明 |
| --- | --- |
| 输入数字 | 选择当前剧情选项 |
| `/choice` | 重新显示剧情选项 |
| `/advance` | 让剧情导演推进剧情 / 切换场景 |
| `/switch [名字]` | 切换当前对话的女主 |
| `/list` | 列出全部角色与好感度 / 心情 |
| `/affection [名字] [0-100]` | 查看或（调试）设置好感度 |
| `/mood [名字] [心情]` | 查看或（调试）设置心情 |
| `/mem [名字|all]` | 查看长期记忆摘要 |
| `/hist` | 查看最近 20 条历史对话 |
| `/ai [on/off]` | 真实 AI 层 / 强制本地模拟器切换 |
| `/stream [on/off]` | 流式输出开关（默认跟随 `OPENAI_STREAM`，下次对话生效） |
| `/config` | 打印 AI 配置解析结果 |
| `/help` / `/quit` | 帮助 / 退出 |

说明：

- **完全复用真实 AI 层**：对话、导演、记忆三个模块与网页版共用同一套代码，
  配置解析顺序一致（数据库设置页 → 环境变量 → 默认），未配置 key 的模块自动走本地模拟器。
- **流式输出**：真实 AI 且开启 `OPENAI_STREAM`（或 `--stream on`、游戏内 `/stream on`）时，
  女主台词会**逐字打印**到终端；否则整句输出。本地模拟器无流式。
- **数据只在内存**：剧情、好感度、长期记忆都不写入数据库，退出即丢弃，适合快速试验。
- **历史窗口**：最近 20 条对话作为上下文窗口；每 8 次互动调用一次记忆摘要，压缩长期记忆。

---

## 关于立绘（love_girls / 抠图）

两位女主角的立绘是**现实风格真人照片**，存放在 `love_girls/<角色名>/` 目录。
想加照片或换立绘：

```bash
# 把照片丢进 love_girls/<角色名>/ 后，跑抠图（只处理新增的，已抠过的自动跳过）
npm run cutout
# 其他用法
npm run cutout -- --force          # 全部重新抠
npm run cutout -- --only 林知鸢     # 只处理某一位
npm run cutout -- --png            # 输出 PNG（默认 webp）
npm run cutout -- --model small    # 小模型（更省内存）
```

抠好的透明底立绘输出到 `public/images/characters/<名字>/`，游戏内可直接使用：
该目录下的每张图都会自动成为这位女主「立绘库」中的一张，剧情导演 AI 会按场景挑选，
也可以在设置页给它们补上描述、调整默认立绘。
细节见 [`love_girls/README.md`](love_girls/README.md)。

---

## API 一览

| 方法 & 路径 | 说明 |
| --- | --- |
| `POST /api/saves` | 创建存档 |
| `GET /api/saves` | 存档列表 |
| `DELETE /api/saves/[id]` | 删除存档 |
| `POST /api/saves/[id]/message` | 发送玩家消息（女主回复）。请求体带 `stream: true` 时返回 NDJSON：`delta` / `state` / `error` |
| `POST /api/saves/[id]/choice` | 提交剧情选项 |
| `POST /api/saves/[id]/advance` | 推进剧情 |
| `POST /api/saves/[id]/switch` | 切换当前对话的女主 |
| `GET/PUT /api/settings` | 读取 / 保存设置 |
| `POST /api/settings/test` | 测试某 AI 模块连接 |
| `GET/POST /api/characters` | 角色列表 / 新增 |
| `PUT/DELETE /api/characters/[id]` | 编辑 / 删除角色 |
| `POST /api/assets` | 上传素材（存数据库） |
| `GET /api/assets/[id]` | 读取素材 |
| `GET 能玩吗？**
能。所有模块在没有密钥时会自动使用本地离线模拟器，游戏完整可玩。

**Q：接入真实 AI 后表现如何？**
把角色 / 导演 / 记忆三个模块都接上真实 LLM 效果最佳。建议三个模块可以混用不同模型
（例如导演用更强模型，对话用更便宜的模型）。

**Q：为什么需要 PostgreSQL？**
存档、好感度、记忆、设置和上传的图片都存数据库，便于持久化与部署。

**Q：想换/加女主角怎么最省事？**
在设置页「角色管理」中直接新增，填名字 + persona，上传立绘即可。

**Q：控制台出现「[ai:...] 请求在 25s 后被超时中断」怎么办？**
这是请求超时。供应商可能已经算完并扣费，但客户端等不及把结果丢掉，游戏会静默回落到本地模拟器，看起来像「AI 没接上」。处理办法：

1. 把 `OPENAI_TIMEOUT_MS` 调大（导演模块建议 120000～180000，慢推理模型单次可能跑好几分钟）。
2. 打开 `OPENAI_STREAM=1`。超时变成「空闲超时」：只要模型一直在吐字就不会被掐；真正卡死（N 秒没有任何数据）才中断。女主台词还会边生成边出现在对话框里。
3. 给该模块换更快的模型（尤其是导演，它输出整段场景 JSON，token 数远多于台词）。

---

## License

私有项目，仅供个人学习与交流使用。
