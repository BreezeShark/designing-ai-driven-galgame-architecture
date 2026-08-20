import type { Save, SaveCharacterState, Character, PendingChoice } from "@/db/schema";
import { completeJSON, type ChatMessage } from "./client";
import {
  simulateDirectorStart,
  simulateDirectorChoice,
  simulateDirectorAdvance,
} from "./simulate";
import type { DirectorUpdate, HistoryItem } from "./types";
import { BACKGROUND_IMAGES } from "@/lib/data/characters";

const VALID_PHASES = ["narration", "dialogue", "ended"];
const VALID_BACKGROUNDS = Object.keys(BACKGROUND_IMAGES).filter((k) => k !== "default");

function sanitize(update: Partial<DirectorUpdate> | null, fallback: DirectorUpdate): DirectorUpdate {
  if (!update) return fallback;
  const phase = VALID_PHASES.includes(update.phase as string) ? (update.phase as DirectorUpdate["phase"]) : fallback.phase;
  const backgroundKey = VALID_BACKGROUNDS.includes(update.backgroundKey as string)
    ? (update.backgroundKey as string)
    : fallback.backgroundKey;
  const presentCharacterIds = Array.isArray(update.presentCharacterIds) && update.presentCharacterIds.length > 0
    ? update.presentCharacterIds.filter((x) => typeof x === "string")
    : fallback.presentCharacterIds;
  let choices: PendingChoice[] | null = null;
  if (Array.isArray(update.choices)) {
    choices = update.choices
      .filter((c) => c && typeof c.id === "string" && typeof c.label === "string")
      .slice(0, 4);
    if (choices.length === 0) choices = null;
  }
  return {
    narration: typeof update.narration === "string" ? update.narration.slice(0, 400) : fallback.narration,
    location: typeof update.location === "string" && update.location ? update.location : fallback.location,
    backgroundKey,
    timeOfDay: typeof update.timeOfDay === "string" && update.timeOfDay ? update.timeOfDay : fallback.timeOfDay,
    presentCharacterIds,
    choices: phase === "narration" ? choices ?? fallback.choices : null,
    phase,
    activeCharacterId:
      phase === "dialogue"
        ? (typeof update.activeCharacterId === "string" ? update.activeCharacterId : fallback.activeCharacterId)
        : null,
    storySummaryAppend: typeof update.storySummaryAppend === "string" ? update.storySummaryAppend.slice(0, 200) : "",
    ended: phase === "ended" ? true : Boolean(update.ended),
  };
}

function buildHistoryText(history: HistoryItem[]): string {
  return history
    .slice(-16)
    .map((h) => {
      if (h.role === "player") return `玩家: ${h.content}`;
      if (h.role === "narrator") return `旁白: ${h.content}`;
      if (h.role === "choice") return `玩家选择: ${h.content}`;
      return `${h.characterId ?? "角色"}: ${h.content}`;
    })
    .join("\n");
}

export async function getDirectorUpdate(params: {
  trigger: "start" | "choice" | "advance" | "auto";
  save: Save;
  characters: Character[];
  characterStates: SaveCharacterState[];
  history: HistoryItem[];
  chosenChoice?: PendingChoice | null;
}): Promise<DirectorUpdate> {
  const names: Record<string, string> = Object.fromEntries(params.characters.map((c) => [c.id, c.name]));

  // Compute the local scripted fallback first (cheap, deterministic).
  let fallback: DirectorUpdate;
  if (params.trigger === "start") {
    fallback = simulateDirectorStart(names);
  } else if (params.trigger === "choice" && params.chosenChoice) {
    fallback = simulateDirectorChoice({
      chapter: params.save.chapter,
      chosenChoiceId: params.chosenChoice.id,
      currentPresent: params.save.presentCharacterIds as string[],
      names,
    });
  } else {
    const totalAffection = params.characterStates.reduce((sum, s) => sum + s.affection, 0);
    fallback = simulateDirectorAdvance({
      chapter: params.save.chapter,
      names,
      totalAffection,
    });
  }

  const system = [
    "你是一款galgame的「剧情导演AI」，负责推进故事、切换场景、决定在场角色，并可以在合适的时候给玩家提供选项。",
    "已登场角色及好感度：" +
      params.characterStates
        .map((s) => `${names[s.characterId] ?? s.characterId}(好感度${s.affection}/100，心情${s.mood})`)
        .join("；"),
    `当前章节：${params.save.chapter}，当前地点：${params.save.location}，当前时间：${params.save.timeOfDay}，当前阶段：${params.save.phase}。`,
    params.save.storySummary ? `已知剧情摘要：${params.save.storySummary}` : "",
    "最近的对话记录：\n" + buildHistoryText(params.history),
    params.trigger === "choice" && params.chosenChoice
      ? `玩家刚刚选择了：「${params.chosenChoice.label}」，请给出这个选择导致的后续发展。`
      : "",
    params.trigger === "start" ? "请生成整个游戏的开场场景。" : "",
    params.trigger === "advance" ? "玩家主动要求推进剧情，请给出下一个场景或情节转折。" : "",
    params.trigger === "auto" ? "根据目前的对话自然地判断是否需要推进剧情或切换场景，如果时机不成熟可以让 narration 为空字符串、phase 保持 dialogue。" : "",
    "只输出严格 JSON，字段为：" +
      '{"narration": "旁白文字，可为空字符串", ' +
      `"location": "地点", "backgroundKey": "从 [${VALID_BACKGROUNDS.join(", ")}] 中选择", ` +
      '"timeOfDay": "morning/noon/afternoon/evening/night 之一", ' +
      '"presentCharacterIds": ["角色id数组，从已知角色id中选择"], ' +
      '"choices": [{"id":"字符串id","label":"选项文案"}] 或 null（当 phase 为 dialogue 时必须为 null）, ' +
      '"phase": "narration 或 dialogue 或 ended", ' +
      '"activeCharacterId": "当 phase 为 dialogue 时必须指定当前对话角色 id，否则为 null", ' +
      '"storySummaryAppend": "补充进长期剧情摘要的一两句话，可为空字符串", ' +
      '"ended": true/false（是否是整个故事的结局）}',
    `已知角色 id 列表：${params.characters.map((c) => c.id).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: ChatMessage[] = [{ role: "system", content: system }];

  const result = await completeJSON<Partial<DirectorUpdate>>(messages, { temperature: 0.8 });
  return sanitize(result, fallback);
}
