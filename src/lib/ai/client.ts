// Thin wrapper around an OpenAI-compatible Chat Completions endpoint.
//
// The whole game works fully offline out of the box using the local
// simulator in `simulate.ts`. Once you export an API key, real LLM calls
// take over automatically — no other code changes required:
//
//   OPENAI_API_KEY=sk-...            (required to enable live AI)
//   OPENAI_BASE_URL=https://...      (optional, defaults to OpenAI)
//   OPENAI_MODEL=gpt-4o-mini         (optional, defaults to gpt-4o-mini)
//
// Any OpenAI-compatible provider (OpenRouter, Azure OpenAI gateway, local
// vLLM/Ollama proxy, etc.) can be used by pointing OPENAI_BASE_URL at it.

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const REQUEST_TIMEOUT_MS = 25_000;

export function isLiveAIEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getModelName(): string {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

/**
 * Calls the chat completion endpoint and expects a JSON object back.
 * Returns `null` if the live AI is disabled, the request fails, or the
 * response cannot be parsed as JSON — callers should always have a local
 * simulated fallback ready for this case.
 */
export async function completeJSON<T>(
  messages: ChatMessage[],
  options?: { temperature?: number },
): Promise<T | null> {
  if (!isLiveAIEnabled()) return null;

  const baseUrl = process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
  const apiKey = process.env.OPENAI_API_KEY;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: getModelName(),
        messages,
        temperature: options?.temperature ?? 0.9,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error("[ai] chat completion failed", res.status, await res.text());
      return null;
    }

    const data = await res.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    return JSON.parse(content) as T;
  } catch (err) {
    console.error("[ai] chat completion error", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
