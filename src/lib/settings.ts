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
export const ALL_SETTING_KEYS = [...AI_SETTING_KEYS, ...PROMPT_SETTING_KEYS];

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
