import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "月光笔记 | AI Galgame",
  description: "本地 AI galgame：多位 AI 女主角与你对话，AI 导演推进剧情，支持存档记忆。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-black text-white antialiased">{children}</body>
    </html>
  );
}
