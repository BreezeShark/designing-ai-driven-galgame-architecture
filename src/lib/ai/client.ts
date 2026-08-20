// Thin wrapper around an OpenAI-compatible Chat Completions endpoint.
//
// The whole game works fully offline out of the box using the local
// simulator in `simulate.ts`. Once an API key is configured — either on the
// visual settings page (/settings) or via environment variables — real LLM
// calls take over automatically, no other code changes required:
//
//   OPENAI_API_KEY=sk-...            (enables live AI)
//   OPENAI_BASE_URL=https://...      (optional, defaults to OpenAI)
//   OPENAI_MODEL=gpt-4o-mini         (optional, defaults to gpt-4o-mini)
//
// Any OpenAI-compatible provider (OpenRouter, Azure OpenAI gateway, local
// vLLM/Ollama proxy, etc.) can be used by pointing the base URL at it.
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
// rate limits per module), or even mix providers/models per module.
//
// Per-field resolution order (first hit wins):
//
//   1. database  ai.<scope>.<field>     — set on the /settings page
//   2. env       OPENAI_<FIELD>_<SCOPE> — e.g. OPENAI_API_KEY_DIRECTOR
//   3. database  ai.global.<field>      — set on the /settings page
//   4. env       OPENAI_<FIELD>         — classic single-key setup
//   5. built-in default (no key → offline simulator for that scope)

import { getSettings } from "@/lib/settings";

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type AIScope = "character" | "director" | "memory";

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "gpt-4o-mini";
const REQUEST_TIMEOUT_MS = 25_000;

const SCOPES: AIScope[] = ["character", "director", "memory"];

type Field = "apiKey" | "baseUrl" | "model";

const ENV_PREFIX: Record<Field, string> = {
  apiKey: "OPENAI_API_KEY",
  baseUrl: "OPENAI_BASE_URL",
  model: "OPENAI_MODEL",
};

export type ResolvedValue = {
  value: string;
  /** Where the effective value came from. */
  source: "database" | "env" | "default";
  /** Which level provided it. */
  level: "scope" | "global" | "default";
};

export type ResolvedAIConfig = {
  apiKey: ResolvedValue | null; // null → no key anywhere → simulator
  baseUrl: ResolvedValue;
  model: ResolvedValue;
};

function resolveField(field: Field, scope: AIScope | undefined, db: Record<string, string>): ResolvedValue | null {
  if (scope) {
    const dbScoped = db[`ai.${scope}.${field}`];
    if (dbScoped) return { value: dbScoped, source: "database", level: "scope" };
    const envScoped = process.env[`${ENV_PREFIX[field]}_${scope.toUpperCase()}`];
    if (envScoped) return { value: envScoped, source: "env", level: "scope" };
  }
  const dbGlobal = db[`ai.global.${field}`];
  if (dbGlobal) return { value: dbGlobal, source: "database", level: "global" };
  const envGlobal = process.env[ENV_PREFIX[field]];
  if (envGlobal) return { value: envGlobal, source: "env", level: "global" };
  if (field === "baseUrl") return { value: DEFAULT_BASE_URL, source: "default", level: "default" };
  if (field === "model") return { value: DEFAULT_MODEL, source: "default", level: "default" };
  return null; // apiKey has no default
}

export async function resolveAIConfig(scope?: AIScope): Promise<ResolvedAIConfig> {
  const db = await getSettings();
  return {
    apiKey: resolveField("apiKey", scope, db),
    baseUrl: resolveField("baseUrl", scope, db)!,
    model: resolveField("model", scope, db)!,
  };
}

/**
 * Live AI is considered enabled if ANY scope can resolve an API key (from
 * the settings page or from env vars). Scopes without a key silently use
 * the local simulator, so partially-keyed setups degrade gracefully.
 */
export async function isLiveAIEnabled(): Promise<boolean> {
  try {
    const db = await getSettings();
    return SCOPES.some((s) => resolveField("apiKey", s, db) !== null);
  } catch {
    // If the DB is unreachable fall back to env-only detection.
    return Boolean(
      process.env.OPENAI_API_KEY || SCOPES.some((s) => process.env[`OPENAI_API_KEY_${s.toUpperCase()}`]),
    );
  }
}

/**
 * Calls the chat completion endpoint and expects a JSON object back.
 * Returns `null` if no API key is configured for this scope, the request
 * fails, or the response cannot be parsed as JSON — callers should always
 * have a local simulated fallback ready for this case.
 */
export async function completeJSON<T>(
  messages: ChatMessage[],
  options?: { temperature?: number; scope?: AIScope },
): Promise<T | null> {
  const scope = options?.scope;
  let config: ResolvedAIConfig;
  try {
    config = await resolveAIConfig(scope);
  } catch (err) {
    console.error(`[ai:${scope ?? "default"}] failed to resolve config`, err);
    return null;
  }
  if (!config.apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${config.baseUrl.value.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey.value}`,
      },
      body: JSON.stringify({
        model: config.model.value,
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
