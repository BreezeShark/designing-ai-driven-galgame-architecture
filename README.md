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
- **剧情选择**：AI 导演会在关键节点给出多个选项，玩家选择后剧情分叉推进。
- **实时立绘与场景**：女主立绘、场景背景、标题画面均可在设置页上传替换。
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
- PostgreSQL（本地或云端均可）

### 1. 安装依赖

```bash
npm install
```

### 2. 配置数据库

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

### 3. 启动开发服务器

```bash
npm run dev
```

浏览器打开 http://localhost:3000 即可开始游戏。

### 4. （可选）接入真实 AI

**方式一：环境变量**（编辑 `.env`）

```bash
# 最简单的接法：只填这一个 key 即可让所有模块启用真实 AI
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1   # 可选，任意 OpenAI 兼容供应商
OPENAI_MODEL=gpt-4o-mini                    # 可选
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
- 换立绘：上传透明背景 PNG 竖图，或改 `src/lib/data/characters.ts` 中的 `avatarUrl`（仅对重新种子生效）。

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
| `characters` | 女主静态定义（名字、立绘、主题色、persona 提示词） |
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
| `npm run build` | 生产构建 |
| `npm start` | 启动生产服务器 |
| `npm run lint` | ESLint 检查 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run cutout` | 对 `love_girls/` 中新照片离线抠图，输出到 `public/images/characters/` |

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

抠好的透明底立绘输出到 `public/images/characters/<名字>/`，游戏内可直接使用。
细节见 [`love_girls/README.md`](love_girls/README.md)。

---

## API 一览

| 方法 & 路径 | 说明 |
| --- | --- |
| `POST /api/saves` | 创建存档 |
| `GET /api/saves` | 存档列表 |
| `DELETE /api/saves/[id]` | 删除存档 |
| `POST /api/saves/[id]/message` | 发送玩家消息（女主回复） |
| `POST /api/saves/[id]/choice` | 提交剧情选项 |
| `POST /api/saves/[id]/advance` | 推进剧情 |
| `POST /api/saves/[id]/switch` | 切换当前对话的女主 |
| `GET/PUT /api/settings` | 读取 / 保存设置 |
| `POST /api/settings/test` | 测试某 AI 模块连接 |
| `GET/POST /api/characters` | 角色列表 / 新增 |
| `PUT/DELETE /api/characters/[id]` | 编辑 / 删除角色 |
| `POST /api/assets` | 上传素材（存数据库） |
| `GET /api/assets/[id]` | 读取素材 |
| `GET /api/health` | 健康检查 |

---

## 常见问题

**Q：不配置 API Key 能玩吗？**
能。所有模块在没有密钥时会自动使用本地离线模拟器，游戏完整可玩。

**Q：接入真实 AI 后表现如何？**
把角色 / 导演 / 记忆三个模块都接上真实 LLM 效果最佳。建议三个模块可以混用不同模型
（例如导演用更强模型，对话用更便宜的模型）。

**Q：为什么需要 PostgreSQL？**
存档、好感度、记忆、设置和上传的图片都存数据库，便于持久化与部署。

**Q：想换/加女主角怎么最省事？**
在设置页「角色管理」中直接新增，填名字 + persona，上传立绘即可。

---

## License

私有项目，仅供个人学习与交流使用。
