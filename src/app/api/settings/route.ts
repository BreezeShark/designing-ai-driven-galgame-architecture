import {
  getSettings,
  setSetting,
  ALL_SETTING_KEYS,
} from "@/lib/settings";
import { resolveAIConfig, type AIScope } from "@/lib/ai/client";
import { DEFAULT_DIRECTOR_PROMPT, DEFAULT_MEMORY_PROMPT } from "@/lib/ai/prompts";
import { CHARACTER_SEEDS, BACKGROUND_IMAGES } from "@/lib/data/characters";
import { ensureCharactersSeeded } from "@/lib/game/service";

export const dynamic = "force-dynamic";

const AI_SCOPES = ["global", "character", "director", "memory"] as const;
const RUNTIME_SCOPES: AIScope[] = ["character", "director", "memory"];

const BG_LABELS: Record<string, string> = {
  classroom: "教室",
  rooftop: "天台",
  park: "公园",
  library: "图书室",
};

function maskKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

export async function GET() {
  const stored = await getSettings();
  const chars = await ensureCharactersSeeded();

  // Raw stored values per scope (API keys masked, never returned in full).
  const scopes: Record<string, { baseUrl: string; model: string; apiKeySet: boolean; apiKeyPreview: string }> = {};
  for (const s of AI_SCOPES) {
    const key = stored[`ai.${s}.apiKey`] ?? "";
    scopes[s] = {
      baseUrl: stored[`ai.${s}.baseUrl`] ?? "",
      model: stored[`ai.${s}.model`] ?? "",
      apiKeySet: Boolean(key),
      apiKeyPreview: key ? maskKey(key) : "",
    };
  }

  // Effective (post-fallback) config per runtime scope, for the status line.
  const effective: Record<string, unknown> = {};
  for (const s of RUNTIME_SCOPES) {
    const cfg = await resolveAIConfig(s);
    effective[s] = {
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      apiKey: cfg.apiKey
        ? { set: true, preview: maskKey(cfg.apiKey.value), source: cfg.apiKey.source, level: cfg.apiKey.level }
        : { set: false },
    };
  }

  return Response.json({
    ai: { scopes, effective },
    prompts: {
      director: { value: stored["prompt.director"] ?? "", default: DEFAULT_DIRECTOR_PROMPT },
      memory: { value: stored["prompt.memory"] ?? "", default: DEFAULT_MEMORY_PROMPT },
    },
    assets: {
      titleBg: { value: stored["asset.titleBg"] ?? "", default: "/images/title-bg.jpg", label: "标题画面" },
      backgrounds: Object.fromEntries(
        Object.keys(BACKGROUND_IMAGES)
          .filter((k) => k !== "default")
          .map((k) => [
            k,
            { value: stored[`asset.bg.${k}`] ?? "", default: BACKGROUND_IMAGES[k], label: BG_LABELS[k] ?? k },
          ]),
      ),
    },
    characters: chars.map((c) => ({
      id: c.id,
      name: c.name,
      subtitle: c.subtitle,
      avatarUrl: c.avatarUrl,
      accentColor: c.accentColor,
      speechStyle: c.speechStyle,
      persona: c.persona,
      defaultPersona: CHARACTER_SEEDS.find((s) => s.id === c.id)?.persona ?? "",
    })),
  });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  const settings = body?.settings;
  if (!settings || typeof settings !== "object") {
    return Response.json({ error: "无效的请求体" }, { status: 400 });
  }

  const entries = Object.entries(settings as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (!ALL_SETTING_KEYS.includes(key)) {
      return Response.json({ error: `未知的设置项：${key}` }, { status: 400 });
    }
    if (typeof value !== "string" || value.length > 8000) {
      return Response.json({ error: `设置项 ${key} 的值无效` }, { status: 400 });
    }
  }

  for (const [key, value] of entries) {
    await setSetting(key, (value as string).trim());
  }

  return Response.json({ ok: true });
}
