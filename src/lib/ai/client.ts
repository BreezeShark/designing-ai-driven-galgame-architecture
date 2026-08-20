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
//
// ---------------------------------------------------------------------------
// Multi-key / multi-scope configuration
// ---------------------------------------------------------------------------
// Every AI call in the game belongs to one of three scopes:
//
//   character — heroines' in-character dialogue replies   (character.ts)
//   director  — story/scene direction & choices           (director.ts)
//   memory    — long-term memory summary compression      (memory.ts)
//
// Each scope can override the API key, base URL and model independently, so
// you can use ONE provider with SEVERAL keys (e.g. to separate billing and
// rate limits per module), or even mix providers/models per module:
//
//   OPENAI_API_KEY_CHARACTER=sk-aaa   OPENAI_MODEL_CHARACTER=gpt-4o
//   OPENAI_API_KEY_DIRECTOR=sk-bbb    OPENAI_MODEL_DIRECTOR=gpt-4o-mini
//   OPENAI_API_KEY_MEMORY=sk-ccc      OPENAI_MODEL_MEMORY=gpt-4o-mini
//   OPENAI_BASE_URL_DIRECTOR=https...  (per-scope base URL also supported)
//
// Resolution order for each scope: scoped var → global var → default.
// Anything you don't set simply falls back, so the original single-key
// setup (just OPENAI_API_KEY) keeps working unchanged.

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type AIScope = "character" | "director" | "memory";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const REQUEST_TIMEOUT_MS = 25_000;

const SCOPES: AIScope[] = ["character", "director", "memory"];

function scopedEnv(prefix: string, scope?: AIScope): string | undefined {
  if (scope) {
    const scoped = process.env[`${prefix}_${scope.toUpperCase()}`];
    if (scoped) return scoped;
  }
  return process.env[prefix];
}

export function getApiKey(scope?: AIScope): string | undefined {
  return scopedEnv("OPENAI_API_KEY", scope);
}

export function getBaseUrl(scope?: AIScope): string {
  return scopedEnv("OPENAI_BASE_URL", scope) || DEFAULT_BASE_URL;
}

export function getModelName(scope?: AIScope): string {
  return scopedEnv("OPENAI_MODEL", scope) || DEFAULT_MODEL;
}

/**
 * Live AI is considered enabled if a global key OR any per-scope key exists.
 * Scopes without their own key fall back to the global key; a scope with
 * neither key silently uses the local simulator, so partially-keyed setups
 * degrade gracefully instead of breaking the game.
 */
export function isLiveAIEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY || SCOPES.some((s) => process.env[`OPENAI_API_KEY_${s.toUpperCase()}`]));
}

/**
 * Calls the chat completion endpoint and expects a JSON object back.
 * Returns `null` if the live AI is disabled for this scope, the request
 * fails, or the response cannot be parsed as JSON — callers should always
 * have a local simulated fallback ready for this case.
 */
export async function completeJSON<T>(
  messages: ChatMessage[],
  options?: { temperature?: number; scope?: AIScope },
): Promise<T | null> {
  const scope = options?.scope;
  const apiKey = getApiKey(scope);
  if (!apiKey) return null;

  const baseUrl = getBaseUrl(scope);
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
        model: getModelName(scope),
        messages,
        temperature: options?.temperature ?? 0.9,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`[ai:${scope ?? "default"}] chat completion failed`, res.status, await res.text());
      return null;
    }

    const data = await res.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    return JSON.parse(content) as T;
  } catch (err) {
    console.error(`[ai:${scope ?? "default"}] chat completion error`, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
