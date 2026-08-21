// Server-only helper: discovers every 立绘 (sprite) shipped in
// public/images/characters/<角色名>/ so a heroine can own a whole sprite
// library instead of a single portrait.
//
// The director AI picks one sprite per scene (see lib/ai/director.ts), so the
// same heroine can appear in different outfits / poses depending on where the
// story currently is.
//
// NOTE: keep this module out of client components — it touches `fs`.

import fs from "node:fs";
import path from "node:path";
import type { CharacterSprite } from "@/db/schema";

const SPRITE_ROOT = path.join(process.cwd(), "public", "images", "characters");
const IMAGE_EXT = new Set([".webp", ".png", ".jpg", ".jpeg", ".gif", ".avif"]);

/** Escape only the characters that would terminate / confuse a URL path. */
function escapePath(path: string): string {
  return path.replace(/[#?%]/g, (ch) => encodeURIComponent(ch));
}

/**
 * All bundled sprites of a heroine, sorted by filename.
 * Returns [] when the character has no bundled sprite folder (e.g. heroines
 * created from the settings page, whose sprites live in the DB as asset URLs).
 */
export function scanBundledSprites(characterName: string): CharacterSprite[] {
  if (!characterName) return [];
  const dir = path.join(SPRITE_ROOT, characterName);
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return files
    .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .map((f, i) => ({
      // Keep the path human-readable (Chinese folder names are fine in URLs);
      // only escape characters that would break the URL itself.
      url: escapePath(`/images/characters/${characterName}/${f}`),
      label: `立绘${i + 1}`,
    }));
}

/**
 * Effective sprite library of a character: stored sprites when present,
 * otherwise the bundled folder, otherwise just the default portrait.
 */
export function effectiveSprites(character: {
  name: string;
  avatarUrl: string;
  sprites?: CharacterSprite[] | null;
}): CharacterSprite[] {
  const stored = (character.sprites ?? []).filter((s) => s && typeof s.url === "string" && s.url);
  if (stored.length > 0) return stored;
  const bundled = scanBundledSprites(character.name);
  if (bundled.length > 0) return bundled;
  return character.avatarUrl ? [{ url: character.avatarUrl, label: "默认立绘" }] : [];
}
