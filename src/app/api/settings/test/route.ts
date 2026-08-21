import { resolveAIConfig, type AIScope } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

const SCOPES: AIScope[] = ["character", "director", "memory"];

/**
 * Fires a minimal real chat-completion request with the *effective* config
 * of the given scope so the user can verify endpoint/key/model right from
 * the settings page.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const scope = SCOPES.includes(body?.scope) ? (body.scope as AIScope) : undefined;
  if (!scope) return Response.json({ error: "无效的 scope" }, { status: 400 });

  const cfg = await resolveAIConfig(scope);
  if (!cfg.apiKey) {
    return Response.json({
      ok: false,
      error: "该模块没有可用的 API Key（数据库和环境变量都未配置），当前会使用本地离线模拟器。",
    });
  }

  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${cfg.baseUrl.value.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey.value}`,
      },
      body: JSON.stringify({
        model: cfg.model.value,
        messages: [
          { role: "system", content: '连通性测试。只输出严格JSON：{"pong": true}' },
          { role: "user", content: "ping" },
        ],
        temperature: 0,
        max_tokens: 20,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      return Response.json({ ok: false, latencyMs, error: `HTTP ${res.status}：${text}` });
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    return Response.json({
      ok: true,
      latencyMs,
      model: cfg.model.value,
      baseUrl: cfg.baseUrl.value,
      sample: typeof content === "string" ? content.slice(0, 100) : "",
    });
  } catch (err) {
    return Response.json({
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? (err.name === "AbortError" ? "请求超时（15s）" : err.message) : "请求失败",
    });
  } finally {
    clearTimeout(timeout);
  }
}
