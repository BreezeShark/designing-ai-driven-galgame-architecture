"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FullState } from "@/lib/game/service";
import { BACKGROUND_IMAGES, TIME_LABELS, MOOD_LABELS } from "@/lib/data/characters";
import { useTypewriter } from "@/lib/hooks/useTypewriter";

const ROLE_ORDER: Record<string, number> = { narrator: 0, choice: 1, player: 2, character: 3 };

export function PlayClient(props: { initialState: FullState }) {
  const router = useRouter();
  const [state, setState] = useState(props.initialState);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { save, characterStates, messages, characters, liveAI } = state;

  const activeState = useMemo(
    () => characterStates.find((c) => c.characterId === save.activeCharacterId) ?? null,
    [characterStates, save.activeCharacterId],
  );
  const presentStates = useMemo(
    () => characterStates.filter((c) => (save.presentCharacterIds as string[]).includes(c.characterId)),
    [characterStates, save.presentCharacterIds],
  );
  const backgroundUrl = BACKGROUND_IMAGES[save.backgroundKey] ?? BACKGROUND_IMAGES.default;
  const lastMessage = messages[messages.length - 1];
  const { display: typedLast, done: typedDone, skip: skipTyping } = useTypewriter(
    lastMessage ? lastMessage.content : "",
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function callApi(path: string, body?: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/saves/${save.id}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
      setState(data.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  function handleSend() {
    const content = input.trim();
    if (!content || busy) return;
    setInput("");
    callApi("/message", { content });
  }

  function nameFor(characterId: string | null): string {
    if (!characterId) return "";
    return characters.find((c) => c.id === characterId)?.name ?? characterId;
  }
  function colorFor(characterId: string | null): string {
    if (!characterId) return "#e5e7eb";
    return characters.find((c) => c.id === characterId)?.accentColor ?? "#e5e7eb";
  }

  const activeCharacter = save.activeCharacterId ? characters.find((c) => c.id === save.activeCharacterId) : null;

  return (
    <main className="relative h-screen w-full overflow-hidden select-none">
      <div key={save.backgroundKey} className="absolute inset-0 animate-[fadein_0.6s_ease]">
        <img src={backgroundUrl} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/30" />
      </div>

      {/* Character portrait */}
      {save.phase === "dialogue" && activeCharacter && (
        <div key={activeCharacter.id} className="absolute bottom-[30%] right-[4%] z-10 h-[62%] w-[38%] animate-[popin_0.35s_ease] sm:right-[8%]">
          <img src={activeCharacter.avatarUrl} alt={activeCharacter.name} className="h-full w-full object-contain drop-shadow-[0_20px_40px_rgba(0,0,0,0.5)]" />
        </div>
      )}

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 p-3 sm:p-4">
        <div className="flex items-center gap-2 rounded-full bg-black/50 px-4 py-1.5 text-xs text-white/80 backdrop-blur">
          <span>第 {save.chapter} 章</span>
          <span className="opacity-50">|</span>
          <span>{save.location}</span>
          <span className="opacity-50">|</span>
          <span>{TIME_LABELS[save.timeOfDay] ?? save.timeOfDay}</span>
        </div>

        <div className="flex items-center gap-2">
          {presentStates.map((cs) => (
            <button
              key={cs.characterId}
              disabled={save.phase !== "dialogue" || busy}
              onClick={() => callApi("/switch", { characterId: cs.characterId })}
              className={`flex items-center gap-2 rounded-full border px-2.5 py-1 backdrop-blur transition ${
                cs.characterId === save.activeCharacterId
                  ? "border-white bg-white/20"
                  : "border-white/20 bg-black/40 hover:bg-black/60"
              }`}
              style={{ boxShadow: cs.characterId === save.activeCharacterId ? `0 0 0 2px ${cs.character.accentColor}55` : undefined }}
            >
              <span className="h-6 w-6 overflow-hidden rounded-full border border-white/30">
                <img src={cs.character.avatarUrl} alt="" className="h-full w-full object-cover object-top" />
              </span>
              <span className="hidden text-xs text-white sm:inline">{cs.character.name}</span>
              <span className="flex items-center gap-0.5 text-[10px] text-pink-200">
                ❤ {cs.affection}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Right side controls */}
      <div className="absolute right-3 top-16 z-20 flex flex-col items-end gap-2 sm:top-20">
        <button
          onClick={() => callApi("/advance")}
          disabled={busy || save.ended}
          className="rounded-full bg-purple-500/80 px-4 py-1.5 text-xs font-medium text-white shadow backdrop-blur transition hover:bg-purple-400 disabled:opacity-50"
        >
          推进剧情
        </button>
        <button
          onClick={() => router.push("/saves")}
          className="rounded-full border border-white/30 bg-black/40 px-4 py-1.5 text-xs text-white/80 backdrop-blur hover:bg-black/60"
        >
          存档列表
        </button>
        <button
          onClick={() => router.push("/")}
          className="rounded-full border border-white/30 bg-black/40 px-4 py-1.5 text-xs text-white/80 backdrop-blur hover:bg-black/60"
        >
          返回标题
        </button>
        <span className="mt-1 rounded-full bg-black/40 px-3 py-1 text-[10px] text-white/50 backdrop-blur">
          {liveAI ? "Live AI" : "本地模拟"}
        </span>
      </div>

      {/* Bottom dialogue / interaction panel */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 p-3 sm:p-5">
        {error && (
          <div className="rounded-lg bg-red-500/80 px-3 py-1.5 text-xs text-white">{error}</div>
        )}

        <div
          ref={scrollRef}
          onClick={() => !typedDone && skipTyping()}
          className="max-h-[34vh] min-h-[110px] cursor-pointer overflow-y-auto rounded-2xl border border-white/15 bg-black/55 p-4 backdrop-blur-md"
        >
          {messages
            .slice(-14)
            .sort((a, b) => a.id - b.id || (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9))
            .map((m, idx, arr) => {
              const isLast = idx === arr.length - 1 && m.id === lastMessage?.id;
              const content = isLast ? typedLast : m.content;
              if (m.role === "narrator") {
                return (
                  <p key={m.id} className="mb-2 text-center text-[13px] italic leading-relaxed text-white/70">
                    {content}
                  </p>
                );
              }
              if (m.role === "choice") {
                return (
                  <p key={m.id} className="mb-2 text-center text-[12px] text-purple-200/80">
                    ▶ 你选择了「{content}」
                  </p>
                );
              }
              if (m.role === "player") {
                return (
                  <div key={m.id} className="mb-2 flex justify-end">
                    <span className="max-w-[80%] rounded-2xl rounded-br-sm bg-pink-500/80 px-3 py-1.5 text-sm text-white">
                      {content}
                    </span>
                  </div>
                );
              }
              return (
                <div key={m.id} className="mb-2">
                  <span className="mb-0.5 block text-xs font-semibold" style={{ color: colorFor(m.characterId) }}>
                    {nameFor(m.characterId)}
                  </span>
                  <span className="block max-w-[85%] rounded-2xl rounded-tl-sm border-l-2 bg-white/10 px-3 py-1.5 text-sm text-white" style={{ borderColor: colorFor(m.characterId) }}>
                    {content}
                  </span>
                </div>
              );
            })}
        </div>

        {save.ended ? (
          <div className="flex items-center justify-between rounded-2xl border border-white/15 bg-black/60 p-4 backdrop-blur">
            <span className="text-sm text-white/80">故事已完结 · 感谢游玩</span>
            <div className="flex gap-2">
              <button onClick={() => router.push("/saves")} className="rounded-full bg-white/15 px-4 py-1.5 text-xs text-white hover:bg-white/25">存档列表</button>
              <button onClick={() => router.push("/")} className="rounded-full bg-pink-500 px-4 py-1.5 text-xs text-white hover:bg-pink-400">返回标题</button>
            </div>
          </div>
        ) : save.phase === "narration" && save.pendingChoices ? (
          <div className="flex flex-col gap-2">
            {(save.pendingChoices as { id: string; label: string }[]).map((c) => (
              <button
                key={c.id}
                disabled={busy}
                onClick={() => callApi("/choice", { choiceId: c.id })}
                className="rounded-xl border border-pink-300/40 bg-white/10 px-4 py-2.5 text-left text-sm text-white backdrop-blur transition hover:bg-pink-500/30 disabled:opacity-50"
              >
                {c.label}
              </button>
            ))}
          </div>
        ) : save.phase === "dialogue" ? (
          <div className="flex items-center gap-2">
            <input
              value={input}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSend();
              }}
              placeholder={activeCharacter ? `对${activeCharacter.name}说点什么…` : "输入消息…"}
              maxLength={300}
              className="flex-1 rounded-full border border-white/20 bg-black/40 px-4 py-2.5 text-sm text-white outline-none backdrop-blur placeholder:text-white/40 focus:border-pink-400"
            />
            <button
              onClick={handleSend}
              disabled={busy || !input.trim()}
              className="rounded-full bg-pink-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-pink-400 disabled:opacity-50"
            >
              发送
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/15 bg-black/50 p-3 text-center text-sm text-white/60 backdrop-blur">
            剧情推进中…
          </div>
        )}
      </div>
    </main>
  );
}
