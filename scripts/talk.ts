#!/usr/bin/env tsx
/**
 * Terminal Talk — 终端对话调试模式
 *
 * 纯终端运行的 galgame 调试工具：不启动网页，直接在终端里和 AI 女主对话。
 * 复用游戏真实 AI 层（getCharacterReply 等），AI 配置解析顺序与网页端完全
 * 一致（数据库设置页 → 环境变量 → 默认），未配置 key 时自动走本地模拟器。
 * 所有状态（好感度、心情、历史）只在内存中，不写数据库。
 *
 * 用法：
 *   npm run dev:talk                  # 交互模式
 *   npm run dev:talk -- "你好"        # 一次性模式：发一句话看回复后退出
 *   npm run dev:talk -- --character 江心妍
 *   npm run dev:talk -- --config      # 打印 AI 配置解析结果后退出
 *   npm run dev:talk -- --ai off      # 强制本地模拟器
 *   npm run dev:talk -- --verbose     # 打印调试细节
 *
 * 游戏内命令：/list /switch /hist /ai /config /help /quit
 */
import "dotenv/config";

import { createInterface, type Interface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { Character, Save, SaveCharacterState } from "@/db/schema";
import { CHARACTER_SEEDS, MOOD_LABELS } from "@/lib/data/characters";
import { getCharacterReply } from "@/lib/ai/character";
import { isLiveAIEnabled, resolveAIConfig, type AIScope } from "@/lib/ai/client";
import type { CharacterReplyResult, HistoryItem } from "@/lib/ai/types";
import { simulateCharacterReply } from "@/lib/ai/simulate";
import { getPool, closeDb } from "@/db";
import { getSetting } from "@/lib/settings";

const HISTORY_WINDOW = 20;

// ---------------------------------------------------------------------------
// 终端输出
// ---------------------------------------------------------------------------
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function paint(code: string, s: string): string {
  return useColor ? `${code}${s}${C.reset}` : s;
}
const dim = (s: string) => paint(C.dim, s);
function out(s = ""): void {
  process.stdout.write(`${s}\n`);
}
function printSystem(s: string): void {
  out(paint(C.yellow, `[系统] ${s}`));
}

// ---------------------------------------------------------------------------
// 内存游戏状态（不写库）
// ---------------------------------------------------------------------------
type TalkState = {
  characters: Character[];
  save: Save;
  states: Map<string, SaveCharacterState>;
  history: HistoryItem[];
  verbose: boolean;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function buildCharacter(seed: (typeof CHARACTER_SEEDS)[number]): Character {
  return { ...seed, createdAt: new Date() };
}

function buildSave(): Save {
  const now = new Date();
  return {
    id: 1,
    slotName: "Terminal Talk",
    playerName: "你",
    chapter: 1,
    phase: "dialogue",
    location: "教室",
    timeOfDay: "afternoon",
    backgroundKey: "classroom",
    presentCharacterIds: [],
    activeCharacterId: null,
    pendingChoices: null,
    storySummary: "",
    lastNarration: "",
    turnCount: 0,
    ended: false,
    createdAt: now,
    updatedAt: now,
  };
}

function buildStateRow(characterId: string): SaveCharacterState {
  return {
    id: 0,
    saveId: 1,
    characterId,
    affection: 20,
    mood: "calm",
    memorySummary: "",
    interactionCount: 0,
    unlocked: true,
    updatedAt: new Date(),
  };
}

function pushHistory(st: TalkState, item: HistoryItem): void {
  st.history.push(item);
  if (st.history.length > HISTORY_WINDOW) {
    st.history.splice(0, st.history.length - HISTORY_WINDOW);
  }
}

function findCharacter(st: TalkState, query: string): Character | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return (
    st.characters.find((c) => c.id.toLowerCase() === q) ??
    st.characters.find((c) => c.name.toLowerCase().includes(q))
  );
}

// ---------------------------------------------------------------------------
// AI 调用封装：useLiveAI=false 时强制本地模拟器；否则走真实 AI 层
// （真实层内部在未配置 key 时也会自动回落模拟器）
// ---------------------------------------------------------------------------
let useLiveAI = true;

async function characterReply(
  st: TalkState,
  character: Character,
  state: SaveCharacterState,
  playerMessage: string,
): Promise<CharacterReplyResult> {
  if (!useLiveAI) {
    return simulateCharacterReply({
      characterId: character.id,
      affection: state.affection,
      playerMessage,
    });
  }
  const result = await getCharacterReply({
    character,
    affection: state.affection,
    mood: state.mood,
    memorySummary: state.memorySummary,
    history: st.history,
    playerMessage,
    playerName: st.save.playerName,
    location: st.save.location,
    timeOfDay: st.save.timeOfDay,
  });
  if (st.verbose) out(dim(`[debug] characterReply -> ${JSON.stringify(result)}`));
  return result;
}

async function handlePlayerMessage(st: TalkState, content: string): Promise<void> {
  const save = st.save;
  const character = st.characters.find((c) => c.id === save.activeCharacterId);
  if (!character) {
    printSystem("没有可对话的角色，用 /switch 选择一位。");
    return;
  }
  const state = st.states.get(character.id);
  if (!state) {
    printSystem(`找不到角色 ${character.name} 的状态。`);
    return;
  }
  const trimmed = content.trim();
  if (!trimmed) return;

  pushHistory(st, { role: "player", characterId: null, content: trimmed });

  const result = await characterReply(st, character, state, trimmed);
  state.affection = clamp(state.affection + result.affectionDelta, 0, 100);
  state.mood = result.mood;
  state.interactionCount += 1;
  state.updatedAt = new Date();

  pushHistory(st, { role: "character", characterId: character.id, content: result.reply });
  out(`${paint(C.bold, `${character.name}：`)} ${result.reply}`);
  if (st.verbose) {
    out(
      dim(
        `[debug] affection ${result.affectionDelta >= 0 ? "+" : ""}${result.affectionDelta} → ${state.affection}/100，mood=${state.mood}`,
      ),
    );
  }
  save.turnCount += 1;
  save.updatedAt = new Date();
}

// ---------------------------------------------------------------------------
// 游戏内命令
// ---------------------------------------------------------------------------
function cmdList(st: TalkState): void {
  for (const c of st.characters) {
    const s = st.states.get(c.id);
    if (!s) continue;
    const flags = [
      st.save.presentCharacterIds.includes(c.id) ? "在场" : "",
      st.save.activeCharacterId === c.id ? "对话中" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    out(
      `${c.name}（${c.id}）${flags ? ` ${dim(`[${flags}]`)}` : ""} 好感 ${s.affection}/100 心情 ${
        MOOD_LABELS[s.mood] ?? s.mood
      } 互动 ${s.interactionCount}`,
    );
  }
}

function cmdSwitch(st: TalkState, arg?: string): void {
  if (!arg) {
    printSystem(`当前对话对象：${st.characters.find((c) => c.id === st.save.activeCharacterId)?.name ?? "无"}。用法：/switch <名字或id>`);
    return;
  }
  const target = findCharacter(st, arg);
  if (!target) {
    printSystem(`找不到角色「${arg}」，用 /list 查看角色。`);
    return;
  }
  st.save.activeCharacterId = target.id;
  if (!st.save.presentCharacterIds.includes(target.id)) {
    st.save.presentCharacterIds.push(target.id);
  }
  printSystem(`已切换对话对象 → ${target.name}`);
}

function cmdHist(st: TalkState): void {
  if (st.history.length === 0) {
    printSystem("（还没有对话记录）");
    return;
  }
  out(dim(`— 最近 ${st.history.length} 条历史 —`));
  for (const h of st.history) {
    if (h.role === "player") out(`你: ${h.content}`);
    else if (h.role === "narrator") out(paint(C.cyan, `旁白: ${h.content}`));
    else {
      const name = st.characters.find((c) => c.id === h.characterId)?.name ?? h.characterId ?? "角色";
      out(`${name}: ${h.content}`);
    }
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

async function printConfig(st: TalkState): Promise<void> {
  out(paint(C.bold, "AI 配置解析结果（与网页端一致：数据库设置页 → 环境变量 → 默认）"));
  const scopes: AIScope[] = ["character", "director", "memory"];
  let live = false;
  for (const scope of scopes) {
    const cfg = await resolveAIConfig(scope);
    const keyText = cfg.apiKey
      ? `${maskKey(cfg.apiKey.value)}（来源：${cfg.apiKey.source}/${cfg.apiKey.level}）`
      : "未配置 key —— 该模块走本地模拟器";
    if (cfg.apiKey) live = true;
    out(`  ${scope.padEnd(9)} key=${keyText}`);
    out(
      `             baseUrl=${cfg.baseUrl.value}（${cfg.baseUrl.source}） model=${cfg.model.value}（${cfg.model.source}）`,
    );
  }
  out(dim(live ? "实时 AI：已启用（有 key 的模块走真实接口）" : "实时 AI：未配置任何 key，全部走本地模拟器"));

  let dbStatus = "未配置 DATABASE_URL（对话调试不受影响，配置读取仅用环境变量）";
  try {
    await getPool().query("select 1");
    dbStatus = "已连接（数据库配置生效）";
  } catch {
    if (process.env.DATABASE_URL) dbStatus = "不可达（回落到环境变量配置）";
  }
  out(dim(`数据库：${dbStatus}`));

  const directorPrompt = await getSetting("prompt.director").catch(() => undefined);
  out(dim(`导演提示词：${directorPrompt ? "自定义（数据库）" : "默认（src/lib/ai/prompts.ts）"}`));
  out(dim(`当前角色：${st.characters.map((c) => c.name).join("、")}，对话对象：${
    st.characters.find((c) => c.id === st.save.activeCharacterId)?.name ?? "无"
  }`));
}

async function cmdAi(st: TalkState, args: string[]): Promise<void> {
  if (args[0] === "on") {
    useLiveAI = true;
    printSystem("已启用真实 AI 层（未配置 key 的模块会自动回落模拟器）");
  } else if (args[0] === "off") {
    useLiveAI = false;
    printSystem("已强制本地模拟器（不调用任何 AI 接口）");
  } else {
    const live = await isLiveAIEnabled();
    printSystem(
      `当前模式：${useLiveAI ? "真实 AI 层" : "本地模拟器（--ai off）"}；${
        live ? "检测到已配置 key" : "未配置 key，走本地模拟器"
      }。用法：/ai [on|off]`,
    );
  }
}

function printHelp(): void {
  out(paint(C.bold, "Terminal Talk 命令："));
  out("  /list               列出全部角色与好感度 / 心情");
  out("  /switch [名字|id]   切换当前对话对象");
  out("  /hist               查看最近 20 条历史对话");
  out("  /ai [on|off]        真实 AI 层 / 强制本地模拟器切换");
  out("  /config             打印 AI 配置解析结果");
  out("  /help               显示本帮助");
  out("  /quit               退出");
  out(dim("直接输入文字即可对当前角色说话。"));
}

// ---------------------------------------------------------------------------
// CLI 参数解析
// ---------------------------------------------------------------------------
type CliOptions = {
  message: string | null;
  characterId: string | null;
  showConfig: boolean;
  ai: "auto" | "on" | "off";
  verbose: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { message: null, characterId: null, showConfig: false, ai: "auto", verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") opts.showConfig = true;
    else if (a === "--verbose" || a === "-v") opts.verbose = true;
    else if (a === "--character" || a === "-c") opts.characterId = argv[++i] ?? null;
    else if (a === "--ai") {
      const v = argv[++i];
      if (v === "on" || v === "off" || v === "auto") opts.ai = v;
    } else if (a.startsWith("--character=")) opts.characterId = a.slice("--character=".length);
    else if (a.startsWith("--ai=")) {
      const v = a.slice("--ai=".length);
      if (v === "on" || v === "off" || v === "auto") opts.ai = v;
    } else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    } else if (!a.startsWith("-")) {
      opts.message = a; // 一次性模式的消息
    }
  }
  return opts;
}

function printUsage(): void {
  out(paint(C.bold, "月光笔记 · Terminal Talk 终端对话调试模式"));
  out("");
  out("用法：");
  out("  npm run dev:talk                      交互模式");
  out('  npm run dev:talk -- "你好"            一次性模式：发一句话看回复后退出');
  out("  npm run dev:talk -- --character 江心妍  指定对话角色（名字或 id）");
  out("  npm run dev:talk -- --config          打印 AI 配置解析结果后退出");
  out("  npm run dev:talk -- --ai off          强制本地模拟器");
  out("  npm run dev:talk -- --verbose         打印调试细节");
  out("");
  printHelp();
}

// ---------------------------------------------------------------------------
// 交互循环
// ---------------------------------------------------------------------------
// 用事件队列而非逐次 question()：question() 在两次提问之间会丢失管道/缓冲
// 输入的行（readline 在无 listener 时把 line 事件丢弃），队列方式保证
// `printf 'a\nb\n' | npm run dev:talk` 这类场景逐行不漏。
function createAsker(rl: Interface): { ask: (query: string) => Promise<string | null> } {
  const pending: string[] = [];
  let closed = false;
  rl.on("line", (line) => pending.push(line));
  rl.on("close", () => {
    closed = true;
  });
  return {
    ask: (query: string) =>
      new Promise<string | null>((resolve) => {
        process.stdout.write(query);
        const poll = async () => {
          for (;;) {
            if (pending.length > 0) return resolve(pending.shift() ?? null);
            if (closed) return resolve(null);
            await new Promise<void>((r) => {
              rl.once("line", r);
              rl.once("close", r);
            });
          }
        };
        void poll();
      }),
  };
}

async function interactive(st: TalkState): Promise<void> {
  await printBanner(st);
  const rl = createInterface({ input, output });
  const { ask } = createAsker(rl);
  let exitCode = 0;
  try {
    while (true) {
      const active = st.characters.find((c) => c.id === st.save.activeCharacterId);
      const prompt = `${paint(C.green, "你")}${active ? `（对 ${active.name}）` : ""} > `;
      const line = await ask(prompt);
      if (line === null) break; // EOF
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === "/quit" || trimmed === "/exit") break;
      if (trimmed.startsWith("/")) {
        await runCommand(st, trimmed);
        continue;
      }
      await handlePlayerMessage(st, trimmed);
    }
  } catch (err) {
    console.error("[talk] 输入读取失败：", err);
    exitCode = 1;
  } finally {
    rl.close();
  }
  out(dim("再见。"));
  await shutdown(exitCode);
}

async function runCommand(st: TalkState, raw: string): Promise<void> {
  const [cmd, ...args] = raw.slice(1).trim().split(/\s+/).filter(Boolean);
  switch (cmd) {
    case "list":
      cmdList(st);
      break;
    case "switch":
      cmdSwitch(st, args[0]);
      break;
    case "hist":
      cmdHist(st);
      break;
    case "ai":
      await cmdAi(st, args);
      break;
    case "config":
      await printConfig(st);
      break;
    case "help":
      printHelp();
      break;
    default:
      printSystem(`未知命令 /${cmd}，输入 /help 查看帮助。`);
      break;
  }
}

async function printBanner(st: TalkState): Promise<void> {
  out("");
  out(paint(C.bold, "月光笔记 · Terminal Talk 终端对话调试模式"));
  out(dim(`角色：${st.characters.map((c) => c.name).join("、")} · 历史窗口 ${HISTORY_WINDOW} 条`));
  const live = await isLiveAIEnabled();
  out(
    dim(
      `实时 AI：${
        live ? "已启用（未配置 key 的模块自动回落模拟器）" : "未配置 key —— 全部走本地模拟器"
      }`,
    ),
  );
  out(dim("输入 /help 查看命令，/quit 退出。"));
  out("");
}

async function shutdown(code = 0): Promise<never> {
  try {
    await Promise.race([closeDb(), new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    // 忽略关闭连接时的错误，确保进程退出
  }
  process.exit(code);
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  useLiveAI = opts.ai !== "off";

  const characters = CHARACTER_SEEDS.map(buildCharacter);
  const st: TalkState = {
    characters,
    save: buildSave(),
    states: new Map(),
    history: [],
    verbose: opts.verbose,
  };
  for (const c of characters) st.states.set(c.id, buildStateRow(c.id));
  st.save.presentCharacterIds = characters.map((c) => c.id);

  const preferred = opts.characterId ? findCharacter(st, opts.characterId) : undefined;
  if (opts.characterId && !preferred) {
    printSystem(`找不到角色「${opts.characterId}」，使用默认角色。`);
  }
  st.save.activeCharacterId = preferred?.id ?? characters[0]?.id ?? null;

  if (opts.showConfig) {
    await printConfig(st);
    await shutdown(0);
  }
  if (opts.message !== null) {
    await handlePlayerMessage(st, opts.message);
    await shutdown(0);
  }
  await interactive(st);
}

process.on("SIGINT", () => {
  out("");
  out(dim("再见。"));
  void shutdown(0);
});

main().catch((err) => {
  console.error("[talk] 运行出错：", err);
  void shutdown(1);
});
