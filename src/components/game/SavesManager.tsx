"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Save } from "@/db/schema";

function formatDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("zh-CN", { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const PHASE_LABEL: Record<string, string> = {
  narration: "剧情推进中",
  dialogue: "对话中",
  ended: "已完结",
};

export function SavesManager(props: { initialSaves: Save[] }) {
  const router = useRouter();
  const [saves, setSaves] = useState(props.initialSaves);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [playerName, setPlayerName] = useState("你");
  const [showForm, setShowForm] = useState(false);

  async function handleDelete(id: number) {
    setBusyId(id);
    try {
      await fetch(`/api/saves/${id}`, { method: "DELETE" });
      setSaves((prev) => prev.filter((s) => s.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreate() {
    setCreating(true);
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
      if (!res.ok) throw new Error(data.error);
      router.push(`/play/${data.state.save.id}`);
    } catch {
      setCreating(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#120814] px-4 py-10 text-white sm:px-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold">存档管理</h1>
          <button
            onClick={() => router.push("/")}
            className="rounded-full border border-white/20 px-4 py-1.5 text-sm text-white/70 hover:bg-white/10"
          >
            返回标题
          </button>
        </div>

        {showForm ? (
          <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-5">
            <label className="mb-1 block text-xs text-white/60">男主角的名字</label>
            <input
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              maxLength={12}
              className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 outline-none focus:border-pink-400"
            />
            <div className="mt-4 flex gap-3">
              <button
                disabled={creating}
                onClick={handleCreate}
                className="flex-1 rounded-full bg-pink-500 px-4 py-2 font-medium hover:bg-pink-400 disabled:opacity-60"
              >
                {creating ? "生成中…" : "创建并进入"}
              </button>
              <button
                disabled={creating}
                onClick={() => setShowForm(false)}
                className="rounded-full border border-white/30 px-4 py-2 text-white/80 hover:bg-white/10"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="mb-6 w-full rounded-2xl border border-dashed border-pink-400/50 bg-pink-500/5 py-4 text-pink-200 transition hover:bg-pink-500/10"
          >
            + 新建存档
          </button>
        )}

        <div className="flex flex-col gap-3">
          {saves.length === 0 && (
            <p className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-white/50">
              还没有存档，创建一个新的故事吧。
            </p>
          )}
          {saves.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{s.slotName}</p>
                <p className="mt-1 text-xs text-white/50">
                  第 {s.chapter} 章 · {PHASE_LABEL[s.phase] ?? s.phase} · {s.location} · 更新于 {formatDate(s.updatedAt)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => router.push(`/play/${s.id}`)}
                  className="rounded-full bg-pink-500 px-4 py-1.5 text-sm font-medium hover:bg-pink-400"
                >
                  继续
                </button>
                <button
                  disabled={busyId === s.id}
                  onClick={() => handleDelete(s.id)}
                  className="rounded-full border border-red-400/40 px-4 py-1.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
