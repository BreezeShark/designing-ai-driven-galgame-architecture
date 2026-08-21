import type { Character } from "@/db/schema";
import { completeJSON, type ChatMessage } from "./client";
import { simulateCharacterReply } from "./simulate";
import type { CharacterReplyResult, HistoryItem } from "./types";
import { MOOD_LABELS } from "@/lib/data/characters";

function affectionTierDescription(affection: number): string {
  if (affection < 20) return "陌生/警惕，还不太信任对方";
  if (affection < 40) return "普通熟人，保持礼貌距离";
  if (affection < 60) return "朋友，比较自然放松";
  if (affection < 80) return "心动，会紧张、会在意对方看法";
  return "恋人般的亲密，愿意主动表达感情";
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
}): Promise<CharacterReplyResult> {
  const { character } = params;

  const system = [
    params.character.persona,
    `当前场景：${params.location}，时间：${params.timeOfDay}。`,
    `你和玩家（名字：${params.playerName}）目前的好感度是 ${params.affection}/100，关系阶段：${affectionTierDescription(params.affection)}。`,
    `你当前的心情状态：${MOOD_LABELS[params.mood] ?? params.mood}。`,
    params.memorySummary ? `你还记得和玩家过去互动的要点：${params.memorySummary}` : "",
    "请只输出严格的 JSON，字段为：" +
      '{"reply": "你说的一两句话，中文，不含旁白或动作描写", ' +
      '"affectionDelta": 一个 -6 到 6 之间的整数，代表这句话让好感度产生的变化, ' +
      '"mood": "从 happy/shy/angry/sad/calm/excited/annoyed/touched 中选一个最贴切的心情"}',
  ]
    .filter(Boolean)
    .join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...toChatHistory(params.history, character.id),
    { role: "user", content: `玩家对你说：${params.playerMessage}` },
  ];

  const result = await completeJSON<CharacterReplyResult>(messages, { temperature: 1, scope: "character" });

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
