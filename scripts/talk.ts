#!/usr/bin/env tsx
/**
 * Terminal Talk — 终端对话调试模式（完整游戏逻辑）
 *
 * 纯终端运行的 galgame 调试工具：不启动网页，直接在终端里体验完整游戏循环。
 * 完全复用游戏真实 AI 层：
 *   - getCharacterReply    角色对话
 *   - getDirectorUpdate    剧情导演（开场 / 剧情选项 / 推进 / 每轮对话后自动判断）
 *   - updateMemorySummary  长期记忆摘要（每 8 次互动压缩一次）
 * AI 配置解析顺序与网页端完全一致（数据库设置页 → 环境变量 → 默认），
 * 未配置 key 的模块自动走本地模拟器。所有状态只在内存中，不写数据库。
 *
 * 用法：
 *   npm run dev:talk                  # 交互模式
 *   npm run dev:talk -- "你好"        # 一次性模式：发一句话看回复后退出
 *   npm run dev:talk -- --character 江心妍
 *   npm run dev:talk -- --config      # 打印 AI 配置解析结果后退出
 *   npm run dev:talk -- --ai off      # 强制本地模拟器
 *   npm run dev:talk -- --stream on   # 强制流式输出（默认跟随 OPENAI_STREAM）
 *   npm run dev:talk -- --verbose     # 打印导演更新等调试细节
 *
 * 游戏内命令：/choice /advance /switch /list /affection /mood /mem /hist
 *             /ai /stream /config /help /quit
 */
import "dotenv/config";

import { createInterface, type Interface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { Character, Save, SaveCharacterState, PendingChoice } from "@/db/schema";
import { CHARACTER_SEEDS, MOOD_LABELS, TIME_LABELS } from "@/lib/data/characters";
import { getCharacterReply } from "@/lib/ai/character";
import { getDirectorUpdate } from "@/lib/ai/director";
import { updateMemorySummary } from "@/lib/ai/memory";
import { isLiveAIEnabled, isStreamEnabled, resolveAIConfig, type AIScope } from "@/lib/ai/client";
import type { CharacterReplyResult, DirectorUpdate, HistoryItem } from "@/lib/ai/types";
import {
  simulateCharacterReply,
  simulateDirectorStart,
  simulateDirectorChoice,
  simulateDirectorAdvance,
  simulateMemorySummary,
} from "@/lib/ai/simulate";
import { getPool, closeDb } from "@/db";
import { getSetting } from "@/lib/settings";

const HISTORY_WINDOW = 20;
const MEMORY_SUMMARY_EVERY = 8;

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
  preferredId: string | null;
  verbose: boolean;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function buildCharacter(seed: (typeof CHARACTER_SEEDS)[number]): Character {
  return { ...seed, sprites: [{ url: seed.avatarUrl, label: "默认立绘" }], createdAt: new Date() };
}

function buildSave(): Save {
  const now = new Date();
  return {
    id: 1,
    slotName: "Terminal Talk",
    playerName: "你",
    chapter: 1,
    phase: "narration",
    location: "教室",
    timeOfDay: "morning",
    backgroundKey: "classroom",
    presentCharacterIds: [],
    characterSprites: {},
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

function namesOf(st: TalkState): Record<string, string> {
  return Object.fromEntries(st.characters.map((c) => [c.id, c.name]));
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
  onDelta?: (delta: string) => void,
): Promise<CharacterReplyResult> {
  if (!useLiveAI) {
    return simulateCharacterReply({
      characterId: character.id,
      affection: state.affection,
      playerMessage,
    });
  }
  // onDelta 只在真实 AI + OPENAI_STREAM 开启时被逐段回调（否则从不触发），
  // 调用方据此在「流式逐字输出」与「整句打印」之间切换。
  return getCharacterReply({
    character,
    affection: state.affection,
    mood: state.mood,
    memorySummary: state.memorySummary,
    history: st.history,
    playerMessage,
    playerName: st.save.playerName,
    location: st.save.location,
    timeOfDay: st.save.timeOfDay,
    onDelta,
  });
}

async function directorUpdate(
  st: TalkState,
  params: { trigger: "start" | "choice" | "advance" | "auto"; chosenChoice?: PendingChoice | null },
): Promise<DirectorUpdate> {
  if (!useLiveAI) {
    const names = namesOf(st);
    // The terminal client has no artwork, so sprites stay empty offline.
    if (params.trigger === "start") return { ...simulateDirectorStart(names), characterSprites: {} };
    if (params.trigger === "choice" && params.chosenChoice) {
      return {
        ...simulateDirectorChoice({
          chapter: st.save.chapter,
          chosenChoiceId: params.chosenChoice.id,
          currentPresent: st.save.presentCharacterIds,
          names,
        }),
        characterSprites: {},
      };
    }
    const totalAffection = [...st.states.values()].reduce((sum, s) => sum + s.affection, 0);
    return {
      ...simulateDirectorAdvance({ chapter: st.save.chapter, names, totalAffection }),
      characterSprites: {},
    };
  }
  const update = await getDirectorUpdate({
    trigger: params.trigger,
    save: st.save,
    characters: st.characters,
    characterStates: [...st.states.values()],
    history: st.history,
    chosenChoice: params.chosenChoice,
  });
  if (st.verbose) out(dim(`[debug] director(${params.trigger}) -> ${JSON.stringify(update)}`));
  return update;
}

async function memoryUpdate(characterName: string, existingSummary: string, recentText: string): Promise<string> {
  if (!useLiveAI) return simulateMemorySummary(existingSummary, recentText);
  return updateMemorySummary({ characterName, existingSummary, recentText });
}

/** 把导演更新应用到内存状态（与 src/lib/game/service.ts 的语义一致）。 */
function applyDirectorUpdate(st: TalkState, update: DirectorUpdate, opts?: { incrementChapter?: boolean }): void {
  const save = st.save;
  const chapter = opts?.incrementChapter ? save.chapter + 1 : save.chapter;
  if (update.narration) {
    save.lastNarration = update.narration;
    pushHistory(st, { role: "narrator", characterId: null, content: update.narration });
    out("");
    out(dim(`— ${update.location} · ${TIME_LABELS[update.timeOfDay] ?? update.timeOfDay} · 第 ${chapter} 章 —`));
    out(paint(C.cyan, `【旁白】${update.narration}`));
  }
  save.location = update.location;
  save.backgroundKey = update.backgroundKey;
  save.timeOfDay = update.timeOfDay;
  save.presentCharacterIds = update.presentCharacterIds;
  save.pendingChoices = update.choices;
  save.phase = update.phase;
  save.activeCharacterId = update.activeCharacterId;
  if (update.storySummaryAppend) {
    save.storySummary = `${save.storySummary} ${update.storySummaryAppend}`.trim().slice(-1200);
  }
  save.ended = update.ended;
  if (opts?.incrementChapter) save.chapter += 1;
  save.updatedAt = new Date();
  // 新登场的角色确保有状态行
  for (const id of update.presentCharacterIds) {
    if (!st.states.has(id)) st.states.set(id, buildStateRow(id));
  }
}

async function startGame(st: TalkState): Promise<void> {
  const update = await directorUpdate(st, { trigger: "start" });
  applyDirectorUpdate(st, update);
}

async function handleChoice(st: TalkState, choice: PendingChoice): Promise<void> {
  const save = st.save;
  if (save.ended) {
    printSystem("这段故事已经结束了，输入 /quit 退出。");
    return;
  }
  if (save.phase !== "narration" || !save.pendingChoices) {
    printSystem("当前没有可选择的选项。");
    return;
  }
  pushHistory(st, { role: "choice", characterId: null, content: choice.label });
  out(dim(`> 你选择了「${choice.label}」`));
  const update = await directorUpdate(st, { trigger: "choice", chosenChoice: choice });
  applyDirectorUpdate(st, update);
  if (save.ended) printSystem("故事完结。");
}

async function handleAdvance(st: TalkState): Promise<void> {
  const save = st.save;
  if (save.ended) {
    printSystem("这段故事已经结束了，输入 /quit 退出。");
    return;
  }
  printSystem("推进剧情…");
  const update = await directorUpdate(st, { trigger: "advance" });
  applyDirectorUpdate(st, update, { incrementChapter: true });
  if (save.ended) printSystem("故事完结。");
}

async function handlePlayerMessage(
  st: TalkState,
  content: string,
  opts?: { skipAutoDirector?: boolean },
): Promise<void> {
  const save = st.save;
  if (save.ended) {
    printSystem("这段故事已经结束了，输入 /quit 退出。");
    return;
  }
  if (save.phase !== "dialogue" || !save.activeCharacterId) {
    printSystem("当前不是对话阶段：请从剧情选项中选择（输入数字），或用 /advance 推进剧情、/switch 切换角色。");
    return;
  }
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

  // 流式输出：真实 AI + OPENAI_STREAM=1 时，先打印「角色名：」前缀，再随
  // delta 逐字写终端；未走流式（本地模拟器 / 未开流式）时 onDelta 不会被
  // 调用，回复走下面的整句打印。
  let streamed = false;
  const result = await characterReply(st, character, state, trimmed, (delta) => {
    if (!streamed) {
      process.stdout.write(`${paint(C.bold, `${character.name}：`)} `);
      streamed = true;
    }
    process.stdout.write(delta);
  });
  state.affection = clamp(state.affection + result.affectionDelta, 0, 100);
  state.mood = result.mood;
  state.interactionCount += 1;
  state.updatedAt = new Date();

  // 每 8 次互动压缩一次长期记忆摘要
  if (state.interactionCount % MEMORY_SUMMARY_EVERY === 0) {
    const recentText = st.history
      .slice(-MEMORY_SUMMARY_EVERY * 2)
      .map((h) => `${h.role === "player" ? "玩家" : character.name}: ${h.content}`)
      .join("\n");
    state.memorySummary = await memoryUpdate(character.name, state.memorySummary, recentText);
    printSystem(`[记忆] ${character.name} 的长期记忆摘要已更新`);
  }

  pushHistory(st, { role: "character", characterId: character.id, content: result.reply });
  if (streamed) {
    out(""); // 结束流式行
  } else {
    out(`${paint(C.bold, `${character.name}：`)} ${result.reply}`);
  }
  if (st.verbose) {
    out(
      dim(
        `[debug] affection ${result.affectionDelta >= 0 ? "+" : ""}${result.affectionDelta} → ${state.affection}/100，mood=${state.mood}，interaction=${state.interactionCount}`,
      ),
    );
  }
  save.turnCount += 1;
  save.updatedAt = new Date();

  // 导演自动判断：是否推进剧情 / 切换场景 / 给出新选项
  if (!opts?.skipAutoDirector) {
    const update = await directorUpdate(st, { trigger: "auto" });
    applyDirectorUpdate(st, update);
  }
}

// ---------------------------------------------------------------------------
// 游戏内命令
// ---------------------------------------------------------------------------
function printChoiceList(st: TalkState): void {
  const choices = st.save.pendingChoices ?? [];
  if (choices.length === 0) {
    printSystem("当前没有剧情选项。");
    return;
  }
  out(paint(C.magenta, "剧情选项（输入数字选择，/choice 重看）："));
  choices.forEach((c, i) => out(`  ${i + 1}. ${c.label}`));
}

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
  const save = st.save;
  if (!arg) {
    const present = save.presentCharacterIds.map((id) => st.characters.find((c) => c.id === id)?.name ?? id);
    printSystem(`在场角色：${present.length ? present.join("、") : "（无）"}。用法：/switch <名字或id>`);
    return;
  }
  const target = findCharacter(st, arg);
  if (!target) {
    printSystem(`找不到角色「${arg}」，用 /list 查看角色。`);
    return;
  }
  if (save.phase !== "dialogue") {
    printSystem("当前不是对话阶段，无法切换聊天对象（可先 /advance 推进剧情）。");
    return;
  }
  if (!save.presentCharacterIds.includes(target.id)) {
    printSystem(`${target.name} 目前不在场景中（在场：${save.presentCharacterIds.map((id) => st.characters.find((c) => c.id === id)?.name ?? id).join("、") || "无"}）`);
    return;
  }
  save.activeCharacterId = target.id;
  printSystem(`已切换对话对象 → ${target.name}`);
}

function cmdAffection(st: TalkState, args: string[]): void {
  if (!args[0]) {
    for (const c of st.characters) {
      const s = st.states.get(c.id);
      if (s) out(`${c.name}：好感 ${s.affection}/100`);
    }
    return;
  }
  const target = findCharacter(st, args[0]);
  if (!target) {
    printSystem(`找不到角色「${args[0]}」。`);
    return;
  }
  const s = st.states.get(target.id);
  if (!s) return;
  if (args[1] !== undefined) {
    const v = Number(args[1]);
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      printSystem("好感度需为 0-100 的数字。");
      return;
    }
    s.affection = Math.round(v);
    s.updatedAt = new Date();
    printSystem(`已将 ${target.name} 的好感度设为 ${s.affection}/100（调试用）。`);
    return;
  }
  out(`${target.name}：好感 ${s.affection}/100`);
}

function cmdMood(st: TalkState, args: string[]): void {
  if (!args[0]) {
    for (const c of st.characters) {
      const s = st.states.get(c.id);
      if (s) out(`${c.name}：心情 ${MOOD_LABELS[s.mood] ?? s.mood}`);
    }
    return;
  }
  const target = findCharacter(st, args[0]);
  if (!target) {
    printSystem(`找不到角色「${args[0]}」。`);
    return;
  }
  const s = st.states.get(target.id);
  if (!s) return;
  if (args[1] !== undefined) {
    const raw = args[1];
    const key =
      Object.keys(MOOD_LABELS).find((k) => k === raw) ??
      Object.entries(MOOD_LABELS).find(([, label]) => label === raw)?.[0];
    if (!key) {
      printSystem(`未知心情「${raw}」，可选：${Object.keys(MOOD_LABELS).join("/")}（或中文标签）。`);
      return;
    }
    s.mood = key;
    s.updatedAt = new Date();
    printSystem(`已将 ${target.name} 的心情设为 ${MOOD_LABELS[key]}（调试用）。`);
    return;
  }
  out(`${target.name}：心情 ${MOOD_LABELS[s.mood] ?? s.mood}`);
}

function cmdMem(st: TalkState, args: string[]): void {
  if (args[0] === "all") {
    for (const c of st.characters) {
      const s = st.states.get(c.id);
      if (s) out(`${c.name}：${s.memorySummary || "（暂无）"}`);
    }
    return;
  }
  const target = args[0]
    ? findCharacter(st, args[0])
    : st.characters.find((c) => c.id === st.save.activeCharacterId);
  if (!target) {
    printSystem(args[0] ? `找不到角色「${args[0]}」。` : "当前没有对话对象。");
    return;
  }
  const s = st.states.get(target.id);
  if (!s) return;
  out(`${target.name}：${s.memorySummary || "（暂无）"}`);
  out(dim(`（已互动 ${s.interactionCount} 次，每 ${MEMORY_SUMMARY_EVERY} 次更新一次摘要）`));
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
    else if (h.role === "choice") out(dim(`选择: ${h.content}`));
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
  out(
    dim(
      `当前：${st.save.location} · ${TIME_LABELS[st.save.timeOfDay] ?? st.save.timeOfDay} · 第 ${st.save.chapter} 章 · 阶段 ${st.save.phase}` +
        (st.save.storySummary ? ` · 剧情摘要 ${st.save.storySummary.length} 字` : ""),
    ),
  );
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

function cmdStream(args: string[]): void {
  if (args[0] === "on") {
    process.env.OPENAI_STREAM = "1";
    printSystem("已开启流式输出（OPENAI_STREAM=1，下次对话生效）");
  } else if (args[0] === "off") {
    delete process.env.OPENAI_STREAM;
    printSystem("已关闭流式输出（下次对话生效）");
  } else {
    printSystem(
      `当前流式：${isStreamEnabled() ? "开启" : "关闭"}（读取环境变量 OPENAI_STREAM）。用法：/stream [on|off]`,
    );
  }
}

function printHelp(): void {
  out(paint(C.bold, "Terminal Talk 命令："));
  out("  输入数字            选择当前剧情选项（/choice 重看选项）");
  out("  /advance            让剧情导演推进剧情 / 切换场景");
  out("  /switch [名字]      切换当前对话的女主");
  out("  /list               列出全部角色与好感度 / 心情");
  out("  /affection [名字] [0-100]   查看或（调试）设置好感度");
  out("  /mood [名字] [心情]         查看或（调试）设置心情");
  out("  /mem [名字|all]     查看长期记忆摘要");
  out("  /hist               查看最近 20 条历史对话");
  out("  /ai [on|off]        真实 AI 层 / 强制本地模拟器切换");
  out("  /stream [on|off]    流式输出开关（默认跟随 OPENAI_STREAM）");
  out("  /config             打印 AI 配置解析结果");
  out("  /help               显示本帮助");
  out("  /quit               退出");
}

// ---------------------------------------------------------------------------
// CLI 参数解析
// ---------------------------------------------------------------------------
type CliOptions = {
  message: string | null;
  characterId: string | null;
  showConfig: boolean;
  ai: "auto" | "on" | "off";
  stream: "auto" | "on" | "off";
  verbose: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    message: null,
    characterId: null,
    showConfig: false,
    ai: "auto",
    stream: "auto",
    verbose: false,
  };
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
    } else if (a === "--stream") {
      const v = argv[++i];
      if (v === "on" || v === "off" || v === "auto") opts.stream = v;
    } else if (a.startsWith("--stream=")) {
      const v = a.slice("--stream=".length);
      if (v === "on" || v === "off" || v === "auto") opts.stream = v;
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
  out("  npm run dev:talk -- --stream on       强制流式输出（默认跟随 OPENAI_STREAM）");
  out("  npm run dev:talk -- --verbose         打印导演更新等调试细节");
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

function promptText(st: TalkState): string {
  const save = st.save;
  if (save.phase === "narration") return `${paint(C.green, "你")}（选择剧情选项） > `;
  const active = st.characters.find((c) => c.id === save.activeCharacterId);
  return `${paint(C.green, "你")}${active ? `（对 ${active.name}）` : ""} > `;
}

function showPrompt(st: TalkState): void {
  const save = st.save;
  if (save.ended) {
    printSystem("故事已完结。输入 /quit 退出，或用 /hist 回顾剧情。");
    return;
  }
  if (save.phase === "narration" && save.pendingChoices?.length) {
    printChoiceList(st);
    return;
  }
  if (save.phase === "dialogue") {
    const active = st.characters.find((c) => c.id === save.activeCharacterId);
    out(dim(`（对 ${active?.name ?? "???"} 说话，或 /advance 推进剧情、/switch 换人）`));
  }
}

async function interactive(st: TalkState): Promise<void> {
  await printBanner(st);
  await startGame(st);
  // --character 指定角色时，开场后自动进入与她的对话：
  // 已登场 → 走导演的剧情选项；未登场 → 调试模式直接切入
  if (st.preferredId) {
    const preferred = st.characters.find((c) => c.id === st.preferredId);
    if (preferred && st.save.phase !== "ended") {
      const choice = st.save.pendingChoices?.find((c) => c.id === `talk_${st.preferredId}`);
      if (choice) {
        await handleChoice(st, choice);
      } else {
        printSystem(`${preferred.name} 尚未登场，调试模式直接进入与她的对话。`);
        st.save.phase = "dialogue";
        st.save.activeCharacterId = preferred.id;
        st.save.pendingChoices = null;
        if (!st.save.presentCharacterIds.includes(preferred.id)) {
          st.save.presentCharacterIds.push(preferred.id);
        }
      }
    }
  }
  showPrompt(st);

  const rl = createInterface({ input, output });
  const { ask } = createAsker(rl);
  let exitCode = 0;
  try {
    while (true) {
      const line = await ask(promptText(st));
      if (line === null) break; // EOF
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === "/quit" || trimmed === "/exit") break;
      if (trimmed.startsWith("/")) {
        await runCommand(st, trimmed);
        continue;
      }
      const save = st.save;
      if (save.phase === "narration" && save.pendingChoices?.length && /^\d+$/.test(trimmed)) {
        const idx = Number(trimmed) - 1;
        const choice = save.pendingChoices[idx];
        if (!choice) {
          printSystem(`请输入 1-${save.pendingChoices.length} 之间的数字。`);
          printChoiceList(st);
          continue;
        }
        await handleChoice(st, choice);
      } else {
        await handlePlayerMessage(st, trimmed);
      }
      showPrompt(st);
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
    case "choice":
      printChoiceList(st);
      break;
    case "advance":
      await handleAdvance(st);
      break;
    case "switch":
      cmdSwitch(st, args[0]);
      break;
    case "list":
      cmdList(st);
      break;
    case "affection":
      cmdAffection(st, args);
      break;
    case "mood":
      cmdMood(st, args);
      break;
    case "mem":
      cmdMem(st, args);
      break;
    case "hist":
      cmdHist(st);
      break;
    case "ai":
      await cmdAi(st, args);
      break;
    case "stream":
      cmdStream(args);
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
  out(
    dim(
      `角色：${st.characters.map((c) => c.name).join("、")} · 历史窗口 ${HISTORY_WINDOW} 条 · 每 ${MEMORY_SUMMARY_EVERY} 次互动更新记忆摘要`,
    ),
  );
  out(dim("剧情导演：开场 / 剧情选项 / /advance / 每轮对话后自动判断（复用真实导演模块）"));
  const live = await isLiveAIEnabled();
  out(
    dim(
      `实时 AI：${
        live ? "已启用（未配置 key 的模块自动回落模拟器）" : "未配置 key —— 全部走本地模拟器"
      }`,
    ),
  );
  out(
    dim(
      `流式输出：${
        isStreamEnabled() ? "开启（女主台词逐字上屏）" : "关闭（整句输出；/stream on 或 --stream on 开启）"
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
async function oneShot(st: TalkState, message: string): Promise<void> {
  const target = st.characters.find((c) => c.id === st.preferredId) ?? st.characters[0];
  st.save.phase = "dialogue";
  st.save.activeCharacterId = target.id;
  st.save.presentCharacterIds = [target.id];
  st.save.location = "教室";
  st.save.timeOfDay = "afternoon";
  await handlePlayerMessage(st, message, { skipAutoDirector: true });
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  useLiveAI = opts.ai !== "off";
  // --stream 强制开关流式：底层 completeJSON 通过 OPENAI_STREAM 环境变量判断，
  // 这里在发起请求前改写 env 即可复用同一套逻辑（auto = 跟随 .env 的值）。
  if (opts.stream === "on") process.env.OPENAI_STREAM = "1";
  else if (opts.stream === "off") delete process.env.OPENAI_STREAM;

  const characters = CHARACTER_SEEDS.map(buildCharacter);
  const st: TalkState = {
    characters,
    save: buildSave(),
    states: new Map(),
    history: [],
    preferredId: null,
    verbose: opts.verbose,
  };
  for (const c of characters) st.states.set(c.id, buildStateRow(c.id));

  if (opts.characterId) {
    const preferred = findCharacter(st, opts.characterId);
    if (preferred) {
      st.preferredId = preferred.id;
    } else {
      printSystem(`找不到角色「${opts.characterId}」，使用默认角色。`);
    }
  }

  if (opts.showConfig) {
    await printConfig(st);
    await shutdown(0);
  }
  if (opts.message !== null) {
    await oneShot(st, opts.message);
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
