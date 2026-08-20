// Key/value settings store backing the visual settings page (/settings).
//
// AI endpoint keys:   ai.<scope>.apiKey | ai.<scope>.baseUrl | ai.<scope>.model
//                     where <scope> is global | character | director | memory
// Prompt keys:        prompt.director | prompt.memory
//
// Resolution order everywhere: database → environment variable → default.

import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { inArray } from "drizzle-orm";

export type SettingsMap = Record<string, string>;

const AI_SCOPES = ["global", "character", "director", "memory"] as const;
export type SettingsScope = (typeof AI_SCOPES)[number];

export const AI_SETTING_KEYS: string[] = AI_SCOPES.flatMap((s) => [
  `ai.${s}.apiKey`,
  `ai.${s}.baseUrl`,
  `ai.${s}.model`,
]);
export const PROMPT_SETTING_KEYS = ["prompt.director", "prompt.memory"];

// UI art overrides: values are asset URLs (e.g. /api/assets/3) set from the
// settings page. Missing keys fall back to the bundled images.
export const ASSET_SETTING_KEYS = [
  "asset.titleBg",
  "asset.bg.classroom",
  "asset.bg.rooftop",
  "asset.bg.park",
  "asset.bg.library",
];
export const ALL_SETTING_KEYS = [...AI_SETTING_KEYS, ...PROMPT_SETTING_KEYS, ...ASSET_SETTING_KEYS];

export async function getSettings(keys?: string[]): Promise<SettingsMap> {
  const rows = keys
    ? await db.select().from(appSettings).where(inArray(appSettings.key, keys))
    : await db.select().from(appSettings);
  const map: SettingsMap = {};
  for (const row of rows) map[row.key] = row.value;
  return map;
}

export async function getSetting(key: string): Promise<string | undefined> {
  const map = await getSettings([key]);
  return map[key];
}

/** Upsert when value is a non-empty string; delete the row when value is "". */
export async function setSetting(key: string, value: string): Promise<void> {
  if (!ALL_SETTING_KEYS.includes(key)) throw new Error(`unknown setting key: ${key}`);
  if (value === "") {
    const { eq } = await import("drizzle-orm");
    await db.delete(appSettings).where(eq(appSettings.key, key));
    return;
  }
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

// ---------------------------------------------------------------------------
// Effective UI art (bundled defaults + user overrides from the settings page)
// ---------------------------------------------------------------------------

import { BACKGROUND_IMAGES } from "@/lib/data/characters";

export const DEFAULT_TITLE_BG = "/images/title-bg.jpg";

/** Background-key → image URL map with user overrides applied. */
export async function getEffectiveBackgrounds(): Promise<Record<string, string>> {
  const stored = await getSettings(ASSET_SETTING_KEYS);
  const map: Record<string, string> = { ...BACKGROUND_IMAGES };
  for (const key of Object.keys(BACKGROUND_IMAGES)) {
    if (key === "default") continue;
    const override = stored[`asset.bg.${key}`];
    if (override) map[key] = override;
  }
  map.default = map.classroom ?? map.default;
  return map;
}

export async function getEffectiveTitleBg(): Promise<string> {
  const stored = await getSettings(["asset.titleBg"]);
  return stored["asset.titleBg"] || DEFAULT_TITLE_BG;
}
