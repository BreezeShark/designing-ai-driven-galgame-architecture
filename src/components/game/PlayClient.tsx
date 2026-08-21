"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FullState } from "@/lib/game/service";
import type { Character, PendingChoice } from "@/db/schema";
import { BACKGROUND_IMAGES, TIME_LABELS } from "@/lib/data/characters";
import { useTypewriter } from "@/lib/hooks/useTypewriter";

const ROLE_ORDER: Record<string, number> = { narrator: 0, choice: 1, player: 2, character: 3 };

// Neutral placeholder used for every 立绘 while SFW mode is enabled.
export const SFW_PLACEHOLDER = "/images/sfw-placeholder.svg";

export function PlayClient(props: { initialState: FullState }) {
  const router = useRouter();
  const [state, setState] = useState(props.initialState);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 剧情选项默认隐藏，点按钮才弹出（不再常驻占用画面）。
  // 记录「当前展开的是哪一批选项」，新选项到来时自动回到收起状态。
  const [openChoicesKey, setOpenChoicesKey] = useState<string | null>(null);
  // 隐藏所有 UI，只看立绘与场景（galgame 常见的「看图」模式）。
  const [uiHidden, setUiHidden] = useState(false);
  // In-flight streamed reply: "" = thinking placeholder, non-empty = partial text, null = not streaming.
  const [pendingPlayer, setPendingPlayer] = useState<string | null>(null);
  const [draftReply, setDraftReply] = useState<string | null>(null);
  const streamedContentRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { save, characterStates, messages, characters, liveAI, sfwMode } = state;

  const pendingChoices = useMemo<PendingChoice[]>(
    () => (save.phase === "narration" && save.pendingChoices ? (save.pendingChoices as PendingChoice[]) : []),
    [save.phase, save.pendingChoices],
  );
  const choicesKey = pendingChoices.map((c) => c.id).join("|");
  const choicesOpen = pendingChoices.length > 0 && openChoicesKey === choicesKey;

  // Sprite chosen by the director AI for the current scene, per character.
  const sceneSprites = (save.characterSprites ?? {}) as Record<string, string>;
  // SFW mode: every character sprite falls back to the neutral placeholder.
  // A sprite deleted from the settings page falls back to the default portrait.
  const spriteFor = (character: Character): string => {
    if (sfwMode) return SFW_PLACEHOLDER;
    const chosen = sceneSprites[character.id];
    const library = character.sprites ?? [];
    if (chosen && (library.length === 0 || library.some((s) => s.url === chosen))) return chosen;
    return character.avatarUrl;
  };

  const presentStates = useMemo(
    () => characterStates.filter((c) => (save.presentCharacterIds as string[]).includes(c.characterId)),
    [characterStates, save.presentCharacterIds],
  );
  const bgMap = state.backgrounds ?? BACKGROUND_IMAGES;
  const backgroundUrl = bgMap[save.backgroundKey] ?? bgMap.default ?? BACKGROUND_IMAGES.default;
  const lastMessage = messages[messages.length - 1];
  const skipTypewriter =
    streamedContentRef.current !== null && lastMessage?.content === streamedContentRef.current;
  const { display: typedLast, done: typedDone, skip: skipTyping } = useTypewriter(
    lastMessage ? lastMessage.content : "",
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, draftReply, pendingPlayer]);

  const callApi = useCallback(
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
    },
    [save.id],
  );

  // ESC closes the choice dialog / restores hidden UI.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpenChoicesKey(null);
      setUiHidden(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function handleSend() {
    const content = input.trim();
    if (!content || busy) return;
    setInput("");
    setBusy(true);
    setError("");
    streamedContentRef.current = null;
    setPendingPlayer(content);
    setDraftReply("");

    try {
      const res = await fetch(`/api/saves/${save.id}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, stream: true }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json") && !contentType.includes("ndjson")) {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "操作失败");
        setState(data.state);
        return;
      }

      if (!res.body) throw new Error("操作失败");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let sawDelta = false;
      let gotState = false;

      const handleEvent = (event: { type?: string; text?: string; state?: FullState; error?: string }) => {
        if (event.type === "delta" && typeof event.text === "string") {
          sawDelta = true;
          setDraftReply((prev) => (prev ?? "") + event.text);
        } else if (event.type === "state" && event.state) {
          const last = event.state.messages[event.state.messages.length - 1];
          if (sawDelta && last?.role === "character") {
            streamedContentRef.current = last.content;
          }
          setState(event.state);
          gotState = true;
        } else if (event.type === "error") {
          throw new Error(event.error || "操作失败");
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl = buf.indexOf("\n");
        while (nl !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) handleEvent(JSON.parse(line) as { type?: string; text?: string; state?: FullState; error?: string });
          nl = buf.indexOf("\n");
        }
      }
      const rest = buf.trim();
      if (rest) handleEvent(JSON.parse(rest) as { type?: string; text?: string; state?: FullState; error?: string });
      if (!gotState && !res.ok) throw new Error("操作失败");
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setPendingPlayer(null);
      setDraftReply(null);
      setBusy(false);
    }
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

  // Everyone standing on stage right now, speaker last so she paints on top.
  const stageCharacters = useMemo(() => {
    const ids = save.presentCharacterIds as string[];
    const list = characters.filter((c) => ids.includes(c.id));
    if (list.length === 0 && activeCharacter) return [activeCharacter];
    return list.sort((a, b) => {
      if (a.id === save.activeCharacterId) return 1;
      if (b.id === save.activeCharacterId) return -1;
      return a.sortOrder - b.sortOrder;
    });
  }, [characters, save.presentCharacterIds, save.activeCharacterId, activeCharacter]);

  // Sprites fill the whole stage height; width budget shrinks as the cast grows.
  const stageWidth =
    stageCharacters.length <= 1 ? "max-w-[74%]" : stageCharacters.length === 2 ? "max-w-[54%]" : "max-w-[40%]";

  return (
    <main className="relative h-screen w-full overflow-hidden select-none">
      <div key={save.backgroundKey} className="absolute inset-0 animate-[fadein_0.6s_ease]">
        <img src={backgroundUrl} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />
      </div>

      {/* Character sprites: full-height, standing on the bottom edge of the scene */}
      <div className="pointer-events-none absolute inset-0 z-10 flex items-end justify-center">
        {stageCharacters.map((c) => {
          const isActive = !activeCharacter || c.id === activeCharacter.id;
          return (
            <div
              key={`${c.id}:${spriteFor(c)}`}
              onClick={() => {
                if (save.phase === "dialogue" && !busy && c.id !== save.activeCharacterId) {
                  callApi("/switch", { characterId: c.id });
                }
              }}
              className={`pointer-events-auto relative h-full flex-1 origin-bottom animate-[spritein_0.45s_ease] transition-all duration-500 ${stageWidth} ${
                isActive
                  ? "z-10 scale-100 opacity-100"
                  : "z-0 scale-[0.9] opacity-80 brightness-[0.55] saturate-[0.9] hover:brightness-75"
              } ${save.phase === "dialogue" && c.id !== save.activeCharacterId ? "cursor-pointer" : ""}`}
            >
              <img
                src={spriteFor(c)}
                alt={c.name}
                className="h-full w-full object-contain object-bottom drop-shadow-[0_24px_50px_rgba(0,0,0,0.55)]"
              />
            </div>
          );
        })}
      </div>

      {/* Restore button while the interface is hidden */}
      {uiHidden && (
        <button
          onClick={() => setUiHidden(false)}
          className="absolute right-3 top-3 z-30 rounded-full border border-white/25 bg-black/45 px-4 py-1.5 text-xs text-white/85 backdrop-blur transition hover:bg-black/70"
        >
          显示界面
        </button>
      )}

      {!uiHidden && (
        <>
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
                    <img src={spriteFor(cs.character)} alt="" className="h-full w-full object-cover object-top" />
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
              onClick={() => setUiHidden(true)}
              className="rounded-full border border-white/30 bg-black/40 px-4 py-1.5 text-xs text-white/80 backdrop-blur hover:bg-black/60"
            >
              隐藏界面
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
              onClick={() => !skipTypewriter && !typedDone && skipTyping()}
              className="max-h-[26vh] min-h-[96px] cursor-pointer overflow-y-auto rounded-2xl border border-white/15 bg-black/55 p-4 backdrop-blur-md"
            >
              {messages
                .slice(-14)
                .sort((a, b) => a.id - b.id || (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9))
                .map((m, idx, arr) => {
                  const isLast = idx === arr.length - 1 && m.id === lastMessage?.id;
                  const content = isLast ? (skipTypewriter ? m.content : typedLast) : m.content;
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
              {pendingPlayer && (
                <div className="mb-2 flex justify-end">
                  <span className="max-w-[80%] rounded-2xl rounded-br-sm bg-pink-500/80 px-3 py-1.5 text-sm text-white">
                    {pendingPlayer}
                  </span>
                </div>
              )}
              {draftReply !== null && (
                <div className="mb-2">
                  <span className="mb-0.5 block text-xs font-semibold" style={{ color: colorFor(save.activeCharacterId) }}>
                    {nameFor(save.activeCharacterId)}
                  </span>
                  <span
                    className="block max-w-[85%] rounded-2xl rounded-tl-sm border-l-2 bg-white/10 px-3 py-1.5 text-sm text-white"
                    style={{ borderColor: colorFor(save.activeCharacterId) }}
                  >
                    {draftReply || "正在思考…"}
                    {draftReply ? (
                      <span
                        className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-white/85 align-middle"
                        style={{ animation: "caretblink 1s step-end infinite" }}
                      />
                    ) : null}
                  </span>
                </div>
              )}
            </div>

            {save.ended ? (
              <div className="flex items-center justify-between rounded-2xl border border-white/15 bg-black/60 p-4 backdrop-blur">
                <span className="text-sm text-white/80">故事已完结 · 感谢游玩</span>
                <div className="flex gap-2">
                  <button onClick={() => router.push("/saves")} className="rounded-full bg-white/15 px-4 py-1.5 text-xs text-white hover:bg-white/25">存档列表</button>
                  <button onClick={() => router.push("/")} className="rounded-full bg-pink-500 px-4 py-1.5 text-xs text-white hover:bg-pink-400">返回标题</button>
                </div>
              </div>
            ) : pendingChoices.length > 0 ? (
              /* 选项默认收起，只留一个按钮，把画面留给立绘 */
              <div className="flex items-center justify-center">
                <button
                  onClick={() => setOpenChoicesKey(choicesKey)}
                  disabled={busy}
                  className="animate-[choicepulse_2.2s_ease-in-out_infinite] rounded-full bg-pink-500/90 px-6 py-2.5 text-sm font-medium text-white shadow-lg backdrop-blur transition hover:bg-pink-400 disabled:opacity-50"
                >
                  剧情选项 · {pendingChoices.length} 个
                </button>
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
        </>
      )}

      {/* Choice dialog: hidden until the player opens it */}
      {choicesOpen && pendingChoices.length > 0 && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/55 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => setOpenChoicesKey(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md animate-[slideup_0.25s_ease] rounded-2xl border border-white/15 bg-neutral-950/85 p-4 shadow-2xl sm:p-5"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-white/90">做出你的选择</span>
              <button
                onClick={() => setOpenChoicesKey(null)}
                className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/60 transition hover:bg-white/10"
              >
                稍后再说
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {pendingChoices.map((c) => (
                <button
                  key={c.id}
                  disabled={busy}
                  onClick={() => {
                    setOpenChoicesKey(null);
                    callApi("/choice", { choiceId: c.id });
                  }}
                  className="rounded-xl border border-pink-300/40 bg-white/10 px-4 py-3 text-left text-sm text-white transition hover:bg-pink-500/30 disabled:opacity-50"
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
