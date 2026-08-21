// Shared validation helper for a heroine's 立绘 library (sprite list).
// Kept out of the route files so both /api/characters routes can use it.

import type { CharacterSprite } from "@/db/schema";

export const MAX_SPRITES = 40;

/** Normalize a client-supplied sprite library ({url,label}[]); null when absent. */
export function parseSprites(raw: unknown): CharacterSprite[] | null {
  if (!Array.isArray(raw)) return null;
  const out: CharacterSprite[] = [];
  for (const item of raw.slice(0, MAX_SPRITES)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<CharacterSprite>;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!url) continue;
    const label = typeof record.label === "string" ? record.label.trim() : "";
    out.push({ url: url.slice(0, 300), label: (label || `立绘${out.length + 1}`).slice(0, 40) });
  }
  return out;
}
