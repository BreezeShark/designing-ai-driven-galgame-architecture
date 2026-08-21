import type { Character } from "@/db/schema";
import { completeJSON, type ChatMessage } from "./client";
import { simulateCharacterReply } from "./simulate";
import type { CharacterReplyResult, HistoryItem } from "./types";
import { MOOD_LABELS } from "@/lib/data/characters";

function affectionTierDescription(affection: number): string {
  if (affection < 20) return "陌生/警惕，还不太信任对方";
  if (affection < 40) return "普通熟人，保持礼貌距离";
  if (affection < 60) return "心动，会紧张、会在意对方看法";
  if (affection < 80) return "恋人般的亲密，愿意主动表达感情";
  return "被调教成性玩物，完全沉迷、服从、依赖对方，一条想要被调教的母狗";
}

function toChatHistory(history: HistoryItem[], characterId: string): ChatMessage[] {
  return history
    .filter((h) => h.role === "player" || h.role === "character" || h.role === "narrator")
    .slice(-12)
    .map((h): ChatMessage => {
      if (h.role === "player") return { role: "user", content: `玩家：${h.content}` };
      if (h.role === "narrator") return { role: "user", content: `[场景旁白] ${h.content}` };
      if (h.characterId === characterId) return { role: "assistant", content: h.content };
      return { role: "user", content: `[${h.characterId ?? "其他角色"}] ${h.content}` };
    });
}

/**
 * Incrementally extract the `reply` string from a partial JSON buffer so the
 * dialogue can render token-by-token before the object is complete. Hanging
 * backslashes wait for the next chunk; an unescaped `"` ends the string so
 * trailing fields like `,"affectionDelta":3` never leak onto the screen.
 */
export function extractPartialReply(buffer: string): string {
  const key = buffer.match(/"reply"\s*:\s*"/);
  if (!key || key.index === undefined) return "";
  let i = key.index + key[0].length;
  let out = "";
  while (i < buffer.length) {
    const ch = buffer[i];
    if (ch === "\\") {
      const next = buffer[i + 1];
      if (next === undefined) break; // 转义符被切在两个 chunk 之间
      if (next === "u") {
        const hex = buffer.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };
      out += map[next] ?? next;
      i += 2;
      continue;
    }
    if (ch === '"') break; // 字符串结束
    out += ch;
    i += 1;
  }
  return out;
}

export async function getCharacterReply(params: {
  character: Character;
  affection: number;
  mood: string;
  memorySummary: string;
  history: HistoryItem[];
  playerMessage: string;
  playerName: string;
  location: string;
  timeOfDay: string;
  onDelta?: (delta: string) => void;
}): Promise<CharacterReplyResult> {
  const { character } = params;

  const system = [
    params.character.persona,
    `当前场景：${params.location}，时间：${params.timeOfDay}。`,
    `你和玩家（名字：${params.playerName}）目前的好感度是 ${params.affection}/100，关系阶段：${affectionTierDescription(params.affection)}。`,
    `你当前的心情状态：${MOOD_LABELS[params.mood] ?? params.mood}。`,
    params.memorySummary ? `你还记得和玩家过去互动的要点：${params.memorySummary}` : "",
    "请只输出严格的 JSON，字段顺序必须是 reply、affectionDelta、mood，字段为：" +
      '{"reply": "你说的一两句话，中文，不含旁白或动作描写", ' +
      '"affectionDelta": 一个 -8 到 8 之间的整数，代表这句话让好感度产生的变化, ' +
      '"mood": "从 happy/shy/angry/sad/calm/excited/annoyed/touched 中选一个最贴切的心情"}',
  ]
    .filter(Boolean)
    .join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...toChatHistory(params.history, character.id),
    { role: "user", content: `玩家对你说：${params.playerMessage}` },
  ];

  let emitted = 0;
  const result = await completeJSON<CharacterReplyResult>(messages, {
    temperature: 1,
    scope: "character",
    onProgress: params.onDelta
      ? (accumulated) => {
          const partial = extractPartialReply(accumulated);
          if (partial.length > emitted) {
            const chunk = partial.slice(emitted);
            emitted = partial.length;
            params.onDelta!(chunk);
          }
        }
      : undefined,
  });

  if (
    result &&
    typeof result.reply === "string" &&
    result.reply.trim().length > 0 &&
    typeof result.affectionDelta === "number"
  ) {
    return {
      reply: result.reply.trim().slice(0, 200),
      affectionDelta: Math.max(-8, Math.min(8, Math.round(result.affectionDelta))),
      mood: typeof result.mood === "string" ? result.mood : "calm",
    };
  }

  // Fallback: local simulator keeps the game fully playable offline.
  return simulateCharacterReply({
    characterId: character.id,
    affection: params.affection,
    playerMessage: params.playerMessage,
  });
}
