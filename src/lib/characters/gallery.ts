// Server-side access to the real-photo sprite galleries synced from
// `love_girls/`. Runs the sync on demand (cheap, cached for a few seconds)
// so photos dropped into the folder show up in an already-running game.
//
// This module touches the DB and the filesystem — server only, never import
// it from a client component. Play pages receive the plain
// `Record<characterId, spriteUrl[]>` map through FullState instead.

import { db } from "@/db";
import { characters } from "@/db/schema";
import { eq } from "drizzle-orm";
import { syncLoveGirls } from "./sync-girls.mjs";

export type GirlGallery = {
  id: string;
  name: string;
  cover: string;
  count: number;
  sprites: string[];
};

export type GirlManifest = {
  generatedAt: string;
  girls: GirlGallery[];
};

const CACHE_TTL_MS = 5_000;

const globalForGirls = globalThis as typeof globalThis & {
  __girlGalleryCache?: { at: number; manifest: GirlManifest };
};

export async function getGirlGalleries(): Promise<GirlManifest> {
  const cached = globalForGirls.__girlGalleryCache;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.manifest;
  const manifest = syncLoveGirls() as GirlManifest;
  globalForGirls.__girlGalleryCache = { at: Date.now(), manifest };
  return manifest;
}

/** characterId → list of sprite URLs ("/characters/<id>/NN.jpg"). */
export async function getSpritesByCharacterId(): Promise<Record<string, string[]>> {
  const manifest = await getGirlGalleries();
  return Object.fromEntries(manifest.girls.map((g) => [g.id, g.sprites]));
}

function templatePersona(name: string): string {
  return (
    `你正在扮演现实风格恋爱游戏中的女主角「${name}」。她是一位真实、鲜活的现代女孩，` +
    "与玩家（男主角）在日常相处中逐渐熟悉、产生感情。" +
    "性格由你根据对话自然塑造：真实、有主见、情绪有起伏，像一个真实的人而不是模板角色。" +
    "务必：始终使用第一人称、口语化的中文对话；每次回复只输出她当下会说的一两句话（不超过60字），" +
    "不要写旁白、不要写星号动作描述、不要出现markdown。" +
    "回复要自然体现好感度：好感低时礼貌但有距离；好感高时更坦率、会主动关心玩家。"
  );
}

const ACCENT_PALETTE = ["#38bdf8", "#fb7185", "#fbbf24", "#34d399", "#a78bfa", "#f472b6"];

/** Should this avatar be kept in sync with the girl's current cover photo? */
function followsGalleryAvatar(avatarUrl: string): boolean {
  return (
    avatarUrl === "" ||
    avatarUrl.startsWith("/images/char-") ||
    avatarUrl.startsWith("/characters/")
  );
}

/**
 * Make sure every folder in love_girls/ exists as a playable character:
 * - new folders become new heroines with a generic realistic persona
 *   (fully editable later on the settings page);
 * - known girls get their avatar refreshed to the current cover photo,
 *   unless the player pointed it at something custom.
 */
export async function ensureGirlCharacters(): Promise<void> {
  const manifest = await getGirlGalleries();
  if (manifest.girls.length === 0) return;

  const rows = await db.select().from(characters);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const byName = new Map(rows.map((r) => [r.name, r]));

  let i = 0;
  for (const girl of manifest.girls) {
    const existing = byId.get(girl.id) ?? byName.get(girl.name);
    if (!existing) {
      await db
        .insert(characters)
        .values({
          id: girl.id,
          name: girl.name,
          subtitle: "love_girls 新女主角",
          avatarUrl: girl.cover,
          accentColor: ACCENT_PALETTE[i % ACCENT_PALETTE.length],
          persona: templatePersona(girl.name),
          speechStyle: "自然真实、口语化",
          sortOrder: 50 + i,
        })
        .onConflictDoNothing({ target: characters.id });
    } else if (existing.id === girl.id && followsGalleryAvatar(existing.avatarUrl)) {
      if (existing.avatarUrl !== girl.cover) {
        await db.update(characters).set({ avatarUrl: girl.cover }).where(eq(characters.id, existing.id));
      }
    }
    i += 1;
  }
}
