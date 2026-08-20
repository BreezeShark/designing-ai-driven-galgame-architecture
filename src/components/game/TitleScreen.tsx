"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type TitleGirl = {
  id: string;
  name: string;
  cover: string;
  count: number;
};

export function TitleScreen(props: {
  hasSaves: boolean;
  latestSaveId: number | null;
  liveAI: boolean;
  titleBgUrl?: string;
  girls?: TitleGirl[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "naming">("idle");
  const [playerName, setPlayerName] = useState("你");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function startNewGame() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/saves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerName: playerName.trim() || "你",
          slotName: `存档 ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      router.push(`/play/${data.state.save.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败，请重试");
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen w-full overflow-hidden">
      <img
        src={props.titleBgUrl || "/images/title-bg.jpg"}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/10" />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-between px-6 py-16">
        <div className="mt-8 text-center">
          <p className="text-sm tracking-[0.4em] text-pink-200/80">AI GALGAME</p>
          <h1 className="mt-3 text-5xl font-bold tracking-wide text-white drop-shadow-[0_4px_20px_rgba(0,0,0,0.6)] sm:text-6xl">
            月光笔记
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/70">
            三位由 AI 扮演的女主角，一位负责推进剧情与场景的 AI 导演。
            <br />
            你的每一句话都会被记住。
          </p>
        </div>

        <div className="mb-6 flex w-full max-w-sm flex-col items-center gap-4">
          {mode === "idle" ? (
            <>
              <button
                onClick={() => setMode("naming")}
                className="w-full rounded-full bg-pink-500/90 px-8 py-3 text-lg font-semibold text-white shadow-lg shadow-pink-900/40 transition hover:bg-pink-400 active:scale-95"
              >
                开始新的故事
              </button>
              {props.hasSaves && (
                <button
                  onClick={() => router.push(props.latestSaveId ? `/play/${props.latestSaveId}` : "/saves")}
                  className="w-full rounded-full border border-white/40 bg-white/10 px-8 py-3 text-lg font-medium text-white backdrop-blur transition hover:bg-white/20 active:scale-95"
                >
                  继续游戏
                </button>
              )}
              <button
                onClick={() => router.push("/saves")}
                className="w-full rounded-full border border-white/20 px-8 py-2.5 text-sm text-white/80 transition hover:bg-white/10"
              >
                存档管理
              </button>
              <button
                onClick={() => router.push("/settings")}
                className="w-full rounded-full border border-white/20 px-8 py-2.5 text-sm text-white/80 transition hover:bg-white/10"
              >
                设置（AI 接入 / 提示词）
              </button>
            </>
          ) : (
            <div className="w-full rounded-2xl border border-white/20 bg-black/50 p-5 backdrop-blur">
              <label className="mb-1 block text-xs text-white/60">男主角的名字</label>
              <input
                autoFocus
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                maxLength={12}
                placeholder="你"
                className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white outline-none placeholder:text-white/40 focus:border-pink-400"
              />
              {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
              <div className="mt-4 flex gap-3">
                <button
                  disabled={loading}
                  onClick={startNewGame}
                  className="flex-1 rounded-full bg-pink-500 px-4 py-2 font-medium text-white transition hover:bg-pink-400 disabled:opacity-60"
                >
                  {loading ? "正在生成剧情…" : "进入故事"}
                </button>
                <button
                  disabled={loading}
                  onClick={() => setMode("idle")}
                  className="rounded-full border border-white/30 px-4 py-2 text-white/80 transition hover:bg-white/10"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          <p className="mt-2 text-[11px] text-white/40">
            {props.liveAI ? "● 已连接真实大模型（Live AI）" : "● 当前为本地离线模拟模式，可在「设置」页配置 API Key 切换为真实大模型"}
          </p>
        </div>
      </div>
    </main>
  );
}
