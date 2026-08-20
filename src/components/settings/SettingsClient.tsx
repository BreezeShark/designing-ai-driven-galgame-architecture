"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types mirroring GET /api/settings
// ---------------------------------------------------------------------------

type StoredScope = { baseUrl: string; model: string; apiKeySet: boolean; apiKeyPreview: string };

type EffectiveValue = { value: string; source: "database" | "env" | "default"; level: string };
type EffectiveScope = {
  baseUrl: EffectiveValue;
  model: EffectiveValue;
  apiKey: { set: boolean; preview?: string; source?: string; level?: string };
};

type CharacterInfo = {
  id: string;
  name: string;
  subtitle: string;
  avatarUrl: string;
  accentColor: string;
  speechStyle: string;
  persona: string;
  defaultPersona: string;
};

type SettingsPayload = {
  ai: {
    scopes: Record<string, StoredScope>;
    effective: Record<string, EffectiveScope>;
  };
  prompts: {
    director: { value: string; default: string };
    memory: { value: string; default: string };
  };
  characters: CharacterInfo[];
};

const SCOPE_META: { id: string; label: string; desc: string }[] = [
  { id: "global", label: "全局默认", desc: "所有模块的兜底配置；模块没有单独配置时使用这里的值" },
  { id: "character", label: "角色对话", desc: "女主角的台词生成（character.ts）" },
  { id: "director", label: "剧情导演", desc: "推进剧情、切换场景、生成选项（director.ts）" },
  { id: "memory", label: "记忆摘要", desc: "压缩长期记忆摘要（memory.ts）" },
];

const SOURCE_LABEL: Record<string, string> = {
  database: "设置页",
  env: "环境变量",
  default: "内置默认",
};

type ScopeForm = { baseUrl: string; model: string; apiKeyInput: string; clearKey: boolean };

export function SettingsClient() {
  const router = useRouter();
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [loadError, setLoadError] = useState("");

  // ---- AI endpoint form state ----
  const [activeScope, setActiveScope] = useState("global");
  const [forms, setForms] = useState<Record<string, ScopeForm>>({});
  const [savingAI, setSavingAI] = useState(false);
  const [aiNotice, setAiNotice] = useState("");
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [testing, setTesting] = useState("");

  // ---- prompt form state ----
  const [directorPrompt, setDirectorPrompt] = useState("");
  const [memoryPrompt, setMemoryPrompt] = useState("");
  const [savingPrompts, setSavingPrompts] = useState(false);
  const [promptNotice, setPromptNotice] = useState("");

  // ---- character persona form state ----
  const [charForms, setCharForms] = useState<Record<string, { persona: string; speechStyle: string; subtitle: string }>>({});
  const [savingChar, setSavingChar] = useState("");
  const [charNotice, setCharNotice] = useState<Record<string, string>>({});

  async function load() {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("加载设置失败");
      const payload: SettingsPayload = await res.json();
      setData(payload);
      const nextForms: Record<string, ScopeForm> = {};
      for (const meta of SCOPE_META) {
        const s = payload.ai.scopes[meta.id];
        nextForms[meta.id] = { baseUrl: s?.baseUrl ?? "", model: s?.model ?? "", apiKeyInput: "", clearKey: false };
      }
      setForms(nextForms);
      setDirectorPrompt(payload.prompts.director.value);
      setMemoryPrompt(payload.prompts.memory.value);
      const nextChar: typeof charForms = {};
      for (const c of payload.characters) {
        nextChar[c.id] = { persona: c.persona, speechStyle: c.speechStyle, subtitle: c.subtitle };
      }
      setCharForms(nextChar);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "加载设置失败");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const form = forms[activeScope];
  const stored = data?.ai.scopes[activeScope];
  const meta = useMemo(() => SCOPE_META.find((m) => m.id === activeScope)!, [activeScope]);

  function patchForm(patch: Partial<ScopeForm>) {
    setForms((prev) => ({ ...prev, [activeScope]: { ...prev[activeScope], ...patch } }));
  }

  async function saveAI() {
    if (!data) return;
    setSavingAI(true);
    setAiNotice("");
    try {
      const settings: Record<string, string> = {};
      for (const m of SCOPE_META) {
        const f = forms[m.id];
        const s = data.ai.scopes[m.id];
        if (!f || !s) continue;
        if (f.baseUrl.trim() !== s.baseUrl) settings[`ai.${m.id}.baseUrl`] = f.baseUrl.trim();
        if (f.model.trim() !== s.model) settings[`ai.${m.id}.model`] = f.model.trim();
        if (f.clearKey) settings[`ai.${m.id}.apiKey`] = "";
        else if (f.apiKeyInput.trim()) settings[`ai.${m.id}.apiKey`] = f.apiKeyInput.trim();
      }
      if (Object.keys(settings).length === 0) {
        setAiNotice("没有需要保存的改动");
        return;
      }
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "保存失败");
      setAiNotice("✓ 已保存，立即生效");
      setTestResult({});
      await load();
    } catch (err) {
      setAiNotice(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingAI(false);
    }
  }

  async function testScope(scope: string) {
    setTesting(scope);
    setTestResult((prev) => ({ ...prev, [scope]: { ok: true, text: "测试中…" } }));
    try {
      const res = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const body = await res.json();
      if (body.ok) {
        setTestResult((prev) => ({
          ...prev,
          [scope]: { ok: true, text: `✓ 连接成功 · ${body.model} · ${body.latencyMs}ms` },
        }));
      } else {
        setTestResult((prev) => ({ ...prev, [scope]: { ok: false, text: `✗ ${body.error}` } }));
      }
    } catch {
      setTestResult((prev) => ({ ...prev, [scope]: { ok: false, text: "✗ 测试请求失败" } }));
    } finally {
      setTesting("");
    }
  }

  async function savePrompts() {
    setSavingPrompts(true);
    setPromptNotice("");
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            "prompt.director": directorPrompt.trim(),
            "prompt.memory": memoryPrompt.trim(),
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "保存失败");
      setPromptNotice("✓ 已保存，下一次 AI 调用即生效");
    } catch (err) {
      setPromptNotice(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingPrompts(false);
    }
  }

  async function saveCharacter(id: string) {
    const f = charForms[id];
    if (!f) return;
    setSavingChar(id);
    setCharNotice((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/characters/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "保存失败");
      setCharNotice((prev) => ({ ...prev, [id]: "✓ 已保存，新对话立即使用新人设" }));
    } catch (err) {
      setCharNotice((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : "保存失败" }));
    } finally {
      setSavingChar("");
    }
  }

  if (loadError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-6 py-4 text-sm">{loadError}</div>
      </main>
    );
  }

  if (!data || !form || !stored) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white/60">
        加载设置中…
      </main>
    );
  }

  const effective = data.ai.effective;

  const inputCls =
    "w-full rounded-xl border border-white/15 bg-black/40 px-4 py-2.5 text-sm text-white outline-none backdrop-blur placeholder:text-white/30 focus:border-pink-400";
  const labelCls = "mb-1.5 block text-xs font-medium tracking-wide text-white/60";
  const sectionCls = "rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-md sm:p-6";
  const btnPrimary =
    "rounded-full bg-pink-500 px-6 py-2 text-sm font-medium text-white transition hover:bg-pink-400 disabled:opacity-50";
  const btnGhost =
    "rounded-full border border-white/25 px-4 py-1.5 text-xs text-white/80 transition hover:bg-white/10 disabled:opacity-50";

  return (
    <main className="relative min-h-screen w-full overflow-x-hidden bg-slate-950">
      <img src="/images/title-bg.jpg" alt="" className="fixed inset-0 h-full w-full object-cover opacity-30" />
      <div className="fixed inset-0 bg-gradient-to-b from-slate-950/80 via-slate-950/60 to-slate-950/90" />

      <div className="relative z-10 mx-auto max-w-3xl px-4 py-10 sm:px-6">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-xs tracking-[0.4em] text-pink-200/70">SETTINGS</p>
            <h1 className="mt-1 text-3xl font-bold text-white">设置</h1>
          </div>
          <button onClick={() => router.push("/")} className={btnGhost}>
            ← 返回标题
          </button>
        </div>

        {/* ================= AI 接入 ================= */}
        <section className={sectionCls}>
          <h2 className="text-lg font-semibold text-white">AI 接入（Endpoint / 密钥 / 模型）</h2>
          <p className="mt-1 text-xs leading-relaxed text-white/50">
            解析顺序：<span className="text-white/70">模块设置 → 模块环境变量 → 全局设置 → 全局环境变量 → 默认值</span>。
            全部留空则该模块自动使用本地离线模拟器，游戏依然可玩。
          </p>

          {/* scope tabs */}
          <div className="mt-4 flex flex-wrap gap-2">
            {SCOPE_META.map((m) => (
              <button
                key={m.id}
                onClick={() => setActiveScope(m.id)}
                className={`rounded-full border px-4 py-1.5 text-xs transition ${
                  activeScope === m.id
                    ? "border-pink-400 bg-pink-500/25 text-white"
                    : "border-white/15 bg-black/30 text-white/60 hover:bg-black/50"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <p className="mt-3 text-xs text-white/45">{meta.desc}</p>

          <div className="mt-4 grid gap-4">
            <div>
              <label className={labelCls}>Base URL（OpenAI 兼容接入点）</label>
              <input
                className={inputCls}
                value={form.baseUrl}
                onChange={(e) => patchForm({ baseUrl: e.target.value })}
                placeholder={activeScope === "global" ? "https://api.openai.com/v1（留空使用默认）" : "留空则回落到全局配置"}
              />
            </div>
            <div>
              <label className={labelCls}>模型</label>
              <input
                className={inputCls}
                value={form.model}
                onChange={(e) => patchForm({ model: e.target.value })}
                placeholder={activeScope === "global" ? "gpt-4o-mini（留空使用默认）" : "留空则回落到全局配置"}
              />
            </div>
            <div>
              <label className={labelCls}>API Key</label>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  className={inputCls}
                  value={form.apiKeyInput}
                  disabled={form.clearKey}
                  onChange={(e) => patchForm({ apiKeyInput: e.target.value })}
                  placeholder={
                    form.clearKey
                      ? "保存后将清除已存密钥"
                      : stored.apiKeySet
                        ? `已保存 ${stored.apiKeyPreview}，输入新值可覆盖`
                        : "sk-...（留空则回落到环境变量/全局配置）"
                  }
                />
                {stored.apiKeySet && (
                  <button
                    onClick={() => patchForm({ clearKey: !form.clearKey, apiKeyInput: "" })}
                    className={`${btnGhost} shrink-0 ${form.clearKey ? "border-amber-400/60 text-amber-300" : ""}`}
                  >
                    {form.clearKey ? "取消清除" : "清除密钥"}
                  </button>
                )}
              </div>
            </div>

            {/* effective config + test, for runtime scopes */}
            {activeScope !== "global" && effective[activeScope] && (
              <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs leading-relaxed text-white/60">
                <p className="mb-1 font-medium text-white/80">当前实际生效</p>
                <p>
                  接入点：{effective[activeScope].baseUrl.value}
                  <span className="text-white/35">（来自{SOURCE_LABEL[effective[activeScope].baseUrl.source]}）</span>
                </p>
                <p>
                  模型：{effective[activeScope].model.value}
                  <span className="text-white/35">（来自{SOURCE_LABEL[effective[activeScope].model.source]}）</span>
                </p>
                <p>
                  密钥：
                  {effective[activeScope].apiKey.set ? (
                    <>
                      {effective[activeScope].apiKey.preview}
                      <span className="text-white/35">
                        （来自{SOURCE_LABEL[effective[activeScope].apiKey.source ?? ""] ?? "?"}）
                      </span>
                    </>
                  ) : (
                    <span className="text-amber-300/90">未配置 → 使用本地离线模拟器</span>
                  )}
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <button onClick={() => testScope(activeScope)} disabled={testing !== ""} className={btnGhost}>
                    {testing === activeScope ? "测试中…" : "测试连接"}
                  </button>
                  {testResult[activeScope] && (
                    <span className={testResult[activeScope].ok ? "text-emerald-300" : "text-red-300"}>
                      {testResult[activeScope].text}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button onClick={saveAI} disabled={savingAI} className={btnPrimary}>
              {savingAI ? "保存中…" : "保存 AI 接入设置"}
            </button>
            {aiNotice && <span className="text-xs text-emerald-300">{aiNotice}</span>}
          </div>
          <p className="mt-2 text-[11px] text-white/35">
            密钥保存在服务端数据库，接口只返回打码预览，不会回传完整密钥。改动会同时保存所有标签页的修改。
          </p>
        </section>

        {/* ================= 系统提示词 ================= */}
        <section className={`${sectionCls} mt-6`}>
          <h2 className="text-lg font-semibold text-white">系统提示词</h2>
          <p className="mt-1 text-xs text-white/50">
            这里只编辑「角色/风格」部分；游戏状态和 JSON 输出格式约束会在运行时自动附加，随便改也不会弄坏解析。
          </p>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium tracking-wide text-white/60">剧情导演提示词</label>
              <button onClick={() => setDirectorPrompt("")} className={btnGhost}>
                恢复默认
              </button>
            </div>
            <textarea
              rows={3}
              className={`${inputCls} resize-y leading-relaxed`}
              value={directorPrompt}
              onChange={(e) => setDirectorPrompt(e.target.value)}
              placeholder={`留空使用默认：${data.prompts.director.default}`}
            />
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium tracking-wide text-white/60">
                记忆摘要提示词 <span className="text-white/35">（可用占位符 {"{characterName}"}）</span>
              </label>
              <button onClick={() => setMemoryPrompt("")} className={btnGhost}>
                恢复默认
              </button>
            </div>
            <textarea
              rows={3}
              className={`${inputCls} resize-y leading-relaxed`}
              value={memoryPrompt}
              onChange={(e) => setMemoryPrompt(e.target.value)}
              placeholder={`留空使用默认：${data.prompts.memory.default}`}
            />
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button onClick={savePrompts} disabled={savingPrompts} className={btnPrimary}>
              {savingPrompts ? "保存中…" : "保存提示词"}
            </button>
            {promptNotice && <span className="text-xs text-emerald-300">{promptNotice}</span>}
          </div>
        </section>

        {/* ================= 角色人设 ================= */}
        <section className={`${sectionCls} mt-6`}>
          <h2 className="text-lg font-semibold text-white">角色人设提示词</h2>
          <p className="mt-1 text-xs text-white/50">
            每位女主角的 persona 是她对话时的系统提示词核心，保存后新对话立即生效（对已有存档同样生效）。
          </p>

          <div className="mt-4 grid gap-5">
            {data.characters.map((c) => {
              const f = charForms[c.id];
              if (!f) return null;
              return (
                <div key={c.id} className="rounded-xl border border-white/10 bg-black/30 p-4" style={{ borderLeftColor: c.accentColor, borderLeftWidth: 3 }}>
                  <div className="flex items-center gap-3">
                    <span className="h-12 w-12 overflow-hidden rounded-full border border-white/20 bg-black/40">
                      <img src={c.avatarUrl} alt="" className="h-full w-full object-cover object-top" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white">{c.name}</p>
                      <input
                        className="mt-0.5 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-white/60 outline-none focus:border-white/20 focus:bg-black/40"
                        value={f.subtitle}
                        onChange={(e) => setCharForms((p) => ({ ...p, [c.id]: { ...p[c.id], subtitle: e.target.value } }))}
                        placeholder="身份标签，如：同班同学 · 班长"
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className={labelCls}>说话风格（展示用）</label>
                    <input
                      className={inputCls}
                      value={f.speechStyle}
                      onChange={(e) => setCharForms((p) => ({ ...p, [c.id]: { ...p[c.id], speechStyle: e.target.value } }))}
                    />
                  </div>

                  <div className="mt-3">
                    <label className={labelCls}>人设提示词（persona · 系统提示词）</label>
                    <textarea
                      rows={6}
                      className={`${inputCls} resize-y leading-relaxed`}
                      value={f.persona}
                      onChange={(e) => setCharForms((p) => ({ ...p, [c.id]: { ...p[c.id], persona: e.target.value } }))}
                    />
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <button onClick={() => saveCharacter(c.id)} disabled={savingChar === c.id} className={btnPrimary}>
                      {savingChar === c.id ? "保存中…" : "保存"}
                    </button>
                    <button
                      onClick={() => setCharForms((p) => ({ ...p, [c.id]: { ...p[c.id], persona: c.defaultPersona || p[c.id].persona } }))}
                      className={btnGhost}
                    >
                      恢复默认人设
                    </button>
                    {charNotice[c.id] && <span className="text-xs text-emerald-300">{charNotice[c.id]}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <p className="mt-8 text-center text-[11px] text-white/30">
          所有设置存储在服务端数据库（app_settings / characters 表），优先于环境变量生效。
        </p>
      </div>
    </main>
  );
}
