import type { Save, SaveCharacterState, Character, PendingChoice } from "@/db/schema";
import { completeJSON, type ChatMessage } from "./client";
import {
  simulateDirectorStart,
  simulateDirectorChoice,
  simulateDirectorAdvance,
} from "./simulate";
import type { DirectorUpdate, HistoryItem } from "./types";
import { BACKGROUND_IMAGES } from "@/lib/data/characters";
import { effectiveSprites } from "@/lib/data/sprite-scan";
import { DEFAULT_DIRECTOR_PROMPT } from "./prompts";
import { getSetting } from "@/lib/settings";

const VALID_PHASES = ["narration", "dialogue", "ended"];
const VALID_BACKGROUNDS = Object.keys(BACKGROUND_IMAGES).filter((k) => k !== "default");

/** Stable pseudo-random number derived from a string (offline sprite picking). */
function hashOf(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Offline / fallback sprite selection: deterministic per (character, scene) so
 * the same scene always renders the same 立绘, but different scenes rotate
 * through the heroine's whole sprite library.
 */
function fallbackSprites(params: {
  characters: Character[];
  presentCharacterIds: string[];
  sceneKey: string;
  previous: Record<string, string>;
}): Record<string, string> {
  const out: Record<string, string> = { ...params.previous };
  for (const id of params.presentCharacterIds) {
    const character = params.characters.find((c) => c.id === id);
    if (!character) continue;
    const sprites = effectiveSprites(character);
    if (sprites.length === 0) continue;
    const idx = hashOf(`${id}::${params.sceneKey}`) % sprites.length;
    out[id] = sprites[idx].url;
  }
  return out;
}

/** Map the model's `characterSprites` (1-based indices or URLs) to real URLs. */
function sanitizeSprites(
  raw: unknown,
  params: { characters: Character[]; presentCharacterIds: string[]; fallback: Record<string, string> },
): Record<string, string> {
  const out: Record<string, string> = { ...params.fallback };
  if (!raw || typeof raw !== "object") return out;
  for (const [characterId, value] of Object.entries(raw as Record<string, unknown>)) {
    const character = params.characters.find((c) => c.id === characterId);
    if (!character) continue;
    const sprites = effectiveSprites(character);
    if (sprites.length === 0) continue;

    // The model is asked for a 1-based index, but tolerate strings and URLs.
    let url: string | null = null;
    const asNumber = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
    if (Number.isFinite(asNumber) && asNumber >= 1 && asNumber <= sprites.length) {
      url = sprites[asNumber - 1].url;
    } else if (typeof value === "string") {
      url =
        sprites.find((s) => s.url === value)?.url ??
        sprites.find((s) => s.label === value)?.url ??
        null;
    }
    if (url) out[characterId] = url;
  }
  return out;
}

function sanitize(
  update: Partial<DirectorUpdate> | null,
  fallback: DirectorUpdate,
  ctx: { characters: Character[] },
): DirectorUpdate {
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
    characterSprites: sanitizeSprites(update.characterSprites, {
      characters: ctx.characters,
      presentCharacterIds,
      fallback: fallback.characterSprites,
    }),
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
  let base: Omit<DirectorUpdate, "characterSprites">;
  if (params.trigger === "start") {
    base = simulateDirectorStart(names);
  } else if (params.trigger === "choice" && params.chosenChoice) {
    base = simulateDirectorChoice({
      chapter: params.save.chapter,
      chosenChoiceId: params.chosenChoice.id,
      currentPresent: params.save.presentCharacterIds as string[],
      names,
    });
  } else {
    const totalAffection = params.characterStates.reduce((sum, s) => sum + s.affection, 0);
    base = simulateDirectorAdvance({
      chapter: params.save.chapter,
      names,
      totalAffection,
    });
  }

  const previousSprites = (params.save.characterSprites as Record<string, string> | null) ?? {};
  const fallback: DirectorUpdate = {
    ...base,
    characterSprites: fallbackSprites({
      characters: params.characters,
      presentCharacterIds: base.presentCharacterIds,
      sceneKey: `${base.backgroundKey}|${base.location}|${base.timeOfDay}|${params.save.chapter}`,
      previous: previousSprites,
    }),
  };

  const directorPrompt = (await getSetting("prompt.director").catch(() => undefined)) || DEFAULT_DIRECTOR_PROMPT;

  // Sprite catalogue: every heroine's available 立绘 with its 1-based index, so
  // the director can dress each character for the scene it just described.
  const spriteCatalogue = params.characters
    .map((c) => {
      const sprites = effectiveSprites(c);
      if (sprites.length === 0) return "";
      return `${c.name}(${c.id})：${sprites.map((s, i) => `${i + 1}=${s.label}`).join("，")}`;
    })
    .filter(Boolean)
    .join("\n");

  const system = [
    directorPrompt,
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
      '"characterSprites": {"角色id": 立绘序号（正整数）}，为每一位在场角色挑一张最贴合当前场景/时间/氛围的立绘, ' +
      '"choices": [{"id":"字符串id","label":"选项文案"}] 或 null（当 phase 为 dialogue 时必须为 null）, ' +
      '"phase": "narration 或 dialogue 或 ended", ' +
      '"activeCharacterId": "当 phase 为 dialogue 时必须指定当前对话角色 id，否则为 null", ' +
      '"storySummaryAppend": "补充进长期剧情摘要的一两句话，可为空字符串", ' +
      '"ended": true/false（是否是整个故事的结局）}',
    spriteCatalogue
      ? "可选立绘清单（characterSprites 里请填写下面的序号）：\n" +
        spriteCatalogue +
        "\n挑选原则：不同场景、不同时间、不同情绪尽量换用不同的立绘；同一个场景内保持稳定，除非剧情发生明显变化（换地点、换衣服、情绪大幅波动）。" +
        (Object.keys(previousSprites).length > 0
          ? "\n当前正在使用的立绘：" +
            Object.entries(previousSprites)
              .map(([id, url]) => {
                const c = params.characters.find((x) => x.id === id);
                if (!c) return "";
                const sprites = effectiveSprites(c);
                const idx = sprites.findIndex((s) => s.url === url);
                return idx >= 0 ? `${c.name}=${idx + 1}` : "";
              })
              .filter(Boolean)
              .join("，")
          : "")
      : "",
    `已知角色 id 列表：${params.characters.map((c) => c.id).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: ChatMessage[] = [{ role: "system", content: system }];

  const result = await completeJSON<Partial<DirectorUpdate>>(messages, { temperature: 0.8, scope: "director" });
  return sanitize(result, fallback, { characters: params.characters });
}
