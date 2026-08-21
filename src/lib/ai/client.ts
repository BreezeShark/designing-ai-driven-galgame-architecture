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
//   OPENAI_TIMEOUT_MS=25000          (optional; non-stream = total timeout,
//                                     stream = idle timeout between chunks)
//   OPENAI_STREAM=1                  (optional; SSE streaming via stream:true)
//   OPENAI_MAX_TOKENS=2048           (optional; >0 adds max_tokens)
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

import { getSettings, type SettingsMap } from "@/lib/settings";

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type AIScope = "character" | "director" | "memory";

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "gpt-4o-mini";
export const DEFAULT_TIMEOUT_MS = 25_000;

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
  // If the database is unreachable, fall back to env-only resolution instead
  // of throwing — callers with offline fallbacks (and the Terminal Talk debug
  // tool) keep working, and environment-based keys still take effect.
  const db = await getSettings().catch(() => ({} as SettingsMap));
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

function envTruthy(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function envPositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Effective request timeout: OPENAI_TIMEOUT_MS, or 25000ms. */
export function getRequestTimeoutMs(): number {
  return envPositiveInt(process.env.OPENAI_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;
}

/** True when OPENAI_STREAM is 1/true/yes/on. */
export function isStreamEnabled(): boolean {
  return envTruthy(process.env.OPENAI_STREAM);
}

function getMaxTokens(): number | undefined {
  return envPositiveInt(process.env.OPENAI_MAX_TOKENS);
}

function isAbortError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "name" in err && (err as { name: string }).name === "AbortError");
}

/**
 * Resettable timeout used as:
 *   - non-stream: a single total deadline
 *   - stream: idle timeout — every SSE chunk calls arm() to restart the clock
 */
function createArmableTimeout(ms: number, controller: AbortController) {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (handle !== undefined) clearTimeout(handle);
    handle = setTimeout(() => controller.abort(), ms);
  };
  const dispose = () => {
    if (handle !== undefined) {
      clearTimeout(handle);
      handle = undefined;
    }
  };
  arm();
  return { arm, dispose };
}

/**
 * Loose JSON parse for real-model replies that wrap the object in markdown
 * fences or a `<think>…</think>` preamble. Returns null (and logs a 300-char
 * preview) when nothing parseable remains.
 */
export function parseJSONLoose<T>(raw: string): T | null {
  let s = raw.trim();
  s = s.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  const tryParse = (input: string): T | null => {
    try {
      return JSON.parse(input) as T;
    } catch {
      return null;
    }
  };

  const direct = tryParse(s);
  if (direct !== null) return direct;

  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const sliced = tryParse(s.slice(start, end + 1));
    if (sliced !== null) return sliced;
  }

  console.error(`[ai] JSON 解析失败，原文前 300 字：${raw.slice(0, 300)}`);
  return null;
}

function extractDeltaContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const delta = (choices[0] as { delta?: { content?: unknown } } | undefined)?.delta;
  // Intentionally ignore reasoning_content — thinking traces must not leak into dialogue.
  const content = delta?.content;
  return typeof content === "string" && content.length > 0 ? content : null;
}

/**
 * Read an OpenAI-compatible SSE body, concatenating choices[0].delta.content
 * only. Handles lines split across chunks, `data: [DONE]`, and unparseable
 * keep-alive packets (skipped, never thrown).
 */
async function readSSEContent(
  body: ReadableStream<Uint8Array>,
  options: {
    arm: () => void;
    onProgress?: (accumulated: string) => void;
  },
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let lineBuf = "";
  let accumulated = "";

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) return;
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      // keep-alive / partial junk — skip, don't throw
      return;
    }
    const piece = extractDeltaContent(parsed);
    if (piece === null) return;
    accumulated += piece;
    options.onProgress?.(accumulated);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      options.arm();
      lineBuf += decoder.decode(value, { stream: true });
      let nl = lineBuf.indexOf("\n");
      while (nl !== -1) {
        const line = lineBuf.slice(0, nl).replace(/\r$/, "");
        lineBuf = lineBuf.slice(nl + 1);
        consumeLine(line);
        nl = lineBuf.indexOf("\n");
      }
    }
    lineBuf += decoder.decode();
    if (lineBuf.trim()) consumeLine(lineBuf.replace(/\r$/, ""));
    return accumulated;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

export type CompleteJSONOptions = {
  temperature?: number;
  scope?: AIScope;
  /** Streaming only: called with the accumulated raw text after every content chunk. */
  onProgress?: (accumulated: string) => void;
};

/**
 * Calls the chat completion endpoint and expects a JSON object back.
 * Returns `null` if no API key is configured for this scope, the request
 * fails, or the response cannot be parsed as JSON — callers should always
 * have a local simulated fallback ready for this case.
 */
export async function completeJSON<T>(
  messages: ChatMessage[],
  options?: CompleteJSONOptions,
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

  const timeoutMs = getRequestTimeoutMs();
  const stream = isStreamEnabled();
  const maxTokens = getMaxTokens();
  const controller = new AbortController();
  const timer = createArmableTimeout(timeoutMs, controller);
  const startedAt = Date.now();
  const tag = `[ai:${scope ?? "default"}]`;

  const body: Record<string, unknown> = {
    model: config.model.value,
    messages,
    temperature: options?.temperature ?? 0.9,
    response_format: { type: "json_object" },
  };
  if (stream) body.stream = true;
  if (maxTokens !== undefined) body.max_tokens = maxTokens;

  try {
    const res = await fetch(`${config.baseUrl.value.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey.value}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`${tag} chat completion failed`, res.status, await res.text());
      return null;
    }

    let content: string | undefined;
    if (stream) {
      if (!res.body) {
        console.error(`${tag} stream response has no body`);
        return null;
      }
      content = await readSSEContent(res.body, {
        arm: timer.arm,
        onProgress: options?.onProgress,
      });
    } else {
      const data = await res.json();
      const raw: unknown = data?.choices?.[0]?.message?.content;
      content = typeof raw === "string" ? raw : undefined;
    }

    if (!content) return null;
    return parseJSONLoose<T>(content);
  } catch (err) {
    if (isAbortError(err)) {
      const elapsedMs = Date.now() - startedAt;
      const elapsedSec = (elapsedMs / 1000).toFixed(1);
      const kind = stream ? "流式空闲超时" : "非流式总超时";
      console.error(
        `${tag} 请求在 ${elapsedSec}s 后被超时中断（${kind}，OPENAI_TIMEOUT_MS=${timeoutMs}）。` +
          `建议：调大 OPENAI_TIMEOUT_MS / 开 OPENAI_STREAM=1 / 给该模块换更快的模型。` +
          `本轮已回落到本地模拟器。`,
      );
      return null;
    }
    console.error(`${tag} chat completion error`, err);
    return null;
  } finally {
    timer.dispose();
  }
}
