import { completeJSON, type ChatMessage } from "./client";
import { simulateMemorySummary } from "./simulate";
import { DEFAULT_MEMORY_PROMPT } from "./prompts";
import { getSetting } from "@/lib/settings";

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
  const template = (await getSetting("prompt.memory").catch(() => undefined)) || DEFAULT_MEMORY_PROMPT;
  const memoryPrompt = template.replaceAll("{characterName}", params.characterName);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        memoryPrompt +
        "\n只输出严格JSON：{\"summary\": \"...\"}",
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
