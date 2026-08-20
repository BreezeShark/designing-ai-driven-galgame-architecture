import { completeJSON, type ChatMessage } from "./client";
import { simulateMemorySummary } from "./simulate";

/**
 * Compresses recent raw dialogue into a running long-term memory summary for
 * a character. This is what allows a heroine to "remember" the player across
 * an arbitrarily long playthrough without ever-growing prompt sizes: only a
 * short sliding window of raw messages + this summary are sent to the model.
 */
export async function updateMemorySummary(params: {
  characterName: string;
  existingSummary: string;
  recentText: string;
}): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        `你负责为galgame角色「${params.characterName}」维护一份简短的长期记忆摘要，帮助她记住和玩家之间发生过的重要事情、承诺、情绪变化。` +
        "请把已有摘要和最近的对话合并、去重、浓缩成不超过120字的中文摘要。只输出严格JSON：{\"summary\": \"...\"}",
    },
    {
      role: "user",
      content: `已有摘要：${params.existingSummary || "（无）"}\n\n最近对话：\n${params.recentText}`,
    },
  ];

  const result = await completeJSON<{ summary: string }>(messages, { temperature: 0.4, scope: "memory" });
  if (result && typeof result.summary === "string" && result.summary.trim()) {
    return result.summary.trim().slice(0, 400);
  }
  return simulateMemorySummary(params.existingSummary, params.recentText);
}
