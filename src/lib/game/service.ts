import { db } from "@/db";
import {
  characters,
  saves,
  saveCharacterStates,
  messages,
  type Character,
  type Save,
  type SaveCharacterState,
  type MessageRow,
  type PendingChoice,
} from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { CHARACTER_SEEDS } from "@/lib/data/characters";
import { ensureGirlCharacters, getGirlGalleries, getSpritesByCharacterId } from "@/lib/characters/gallery";
import { getCharacterReply } from "@/lib/ai/character";
import { getDirectorUpdate } from "@/lib/ai/director";
import { updateMemorySummary } from "@/lib/ai/memory";
import type { DirectorUpdate, HistoryItem } from "@/lib/ai/types";
import { isLiveAIEnabled } from "@/lib/ai/client";
import { getEffectiveBackgrounds } from "@/lib/settings";

export class GameError extends Error {}

const HISTORY_WINDOW = 20;
const MEMORY_SUMMARY_EVERY = 8;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export async function ensureCharactersSeeded(): Promise<Character[]> {
  // Prefer a real cover photo from love_girls/ for the seeded avatar.
  const manifest = await getGirlGalleries();
  const coverFor = (id: string, fallback: string) =>
    manifest.girls.find((g) => g.id === id)?.cover ?? fallback;

  const existing = await db.select().from(characters);
  if (existing.length === 0) {
    await db
      .insert(characters)
      .values(
        CHARACTER_SEEDS.map((c) => ({
          id: c.id,
          name: c.name,
          subtitle: c.subtitle,
          avatarUrl: coverFor(c.id, c.avatarUrl),
          accentColor: c.accentColor,
          persona: c.persona,
          speechStyle: c.speechStyle,
          sortOrder: c.sortOrder,
        })),
      )
      .onConflictDoNothing({ target: characters.id });
  }

  // Folders dropped into love_girls/ become playable heroines automatically.
  await ensureGirlCharacters();

  // Drop the old anime placeholder cast (himari / mio / hina) unless an
  // existing playthrough still references them — keeps saves from breaking
  // while making sure a fresh/legacy DB no longer shows the 2D characters.
  await db.execute(sql`
    DELETE FROM characters c
    WHERE c.id IN ('himari', 'mio', 'hina')
      AND NOT EXISTS (SELECT 1 FROM save_character_states s WHERE s.character_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.character_id = c.id)
  `);

  const rows = await db.select().from(characters);
  return rows.sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function listSaves(): Promise<Save[]> {
  return db.select().from(saves).orderBy(desc(saves.updatedAt));
}

export type CharacterStateWithInfo = SaveCharacterState & { character: Character };

export type FullState = {
  save: Save;
  characterStates: CharacterStateWithInfo[];
  messages: MessageRow[];
  characters: Character[];
  liveAI: boolean;
  /** backgroundKey → image URL, with user overrides from the settings page. */
  backgrounds: Record<string, string>;
  /** characterId → all real-photo sprites synced from love_girls/ */
  galleries: Record<string, string[]>;
};

function mapHistory(rows: MessageRow[]): HistoryItem[] {
  return rows.map((r) => ({ role: r.role, characterId: r.characterId, content: r.content }));
}

async function getRecentHistory(saveId: number, limit = HISTORY_WINDOW): Promise<MessageRow[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.saveId, saveId))
    .orderBy(desc(messages.id))
    .limit(limit);
  return rows.reverse();
}

async function getSaveRow(saveId: number): Promise<Save> {
  const [row] = await db.select().from(saves).where(eq(saves.id, saveId));
  if (!row) throw new GameError("存档不存在");
  return row;
}

async function getStates(saveId: number): Promise<SaveCharacterState[]> {
  return db.select().from(saveCharacterStates).where(eq(saveCharacterStates.saveId, saveId));
}

async function getOrCreateState(saveId: number, characterId: string): Promise<SaveCharacterState> {
  const [row] = await db
    .select()
    .from(saveCharacterStates)
    .where(and(eq(saveCharacterStates.saveId, saveId), eq(saveCharacterStates.characterId, characterId)));
  if (row) return row;
  const [created] = await db
    .insert(saveCharacterStates)
    .values({ saveId, characterId })
    .returning();
  return created;
}

export async function getFullState(saveId: number): Promise<FullState | null> {
  const [save] = await db.select().from(saves).where(eq(saves.id, saveId));
  if (!save) return null;
  const chars = await ensureCharactersSeeded();
  const stateRows = await getStates(saveId);
  const characterStates: CharacterStateWithInfo[] = stateRows
    .map((s) => ({ ...s, character: chars.find((c) => c.id === s.characterId)! }))
    .filter((s) => s.character)
    .sort((a, b) => a.character.sortOrder - b.character.sortOrder);

  const msgRows = await db
    .select()
    .from(messages)
    .where(eq(messages.saveId, saveId))
    .orderBy(desc(messages.id))
    .limit(80);
  msgRows.reverse();

  return {
    save,
    characterStates,
    messages: msgRows,
    characters: chars,
    liveAI: await isLiveAIEnabled(),
    backgrounds: await getEffectiveBackgrounds(),
    galleries: await getSpritesByCharacterId(),
  };
}

async function applyDirectorUpdate(
  currentSave: Save,
  update: DirectorUpdate,
  options?: { incrementChapter?: boolean },
): Promise<void> {
  const mergedSummary = update.storySummaryAppend
    ? `${currentSave.storySummary} ${update.storySummaryAppend}`.trim().slice(-1200)
    : currentSave.storySummary;
  const newChapter = options?.incrementChapter ? currentSave.chapter + 1 : currentSave.chapter;

  await db
    .update(saves)
    .set({
      location: update.location,
      backgroundKey: update.backgroundKey,
      timeOfDay: update.timeOfDay,
      presentCharacterIds: update.presentCharacterIds,
      pendingChoices: update.choices,
      phase: update.phase,
      activeCharacterId: update.activeCharacterId,
      lastNarration: update.narration || currentSave.lastNarration,
      ended: update.ended,
      chapter: newChapter,
      storySummary: mergedSummary,
      updatedAt: new Date(),
    })
    .where(eq(saves.id, currentSave.id));

  if (update.narration) {
    await db.insert(messages).values({
      saveId: currentSave.id,
      role: "narrator",
      characterId: null,
      content: update.narration,
      meta: { location: update.location, backgroundKey: update.backgroundKey, timeOfDay: update.timeOfDay },
    });
  }

  // Make sure every present character has a state row (covers newly introduced heroines).
  for (const charId of update.presentCharacterIds) {
    await getOrCreateState(currentSave.id, charId);
  }
}

export async function createSave(params: { slotName: string; playerName: string }): Promise<FullState> {
  const chars = await ensureCharactersSeeded();
  const [save] = await db
    .insert(saves)
    .values({ slotName: params.slotName || "新的存档", playerName: params.playerName || "你" })
    .returning();

  await db
    .insert(saveCharacterStates)
    .values(chars.map((c) => ({ saveId: save.id, characterId: c.id })));

  const states = await getStates(save.id);
  const update = await getDirectorUpdate({
    trigger: "start",
    save,
    characters: chars,
    characterStates: states,
    history: [],
  });
  await applyDirectorUpdate(save, update);

  const full = await getFullState(save.id);
  if (!full) throw new GameError("存档创建失败");
  return full;
}

export async function deleteSave(saveId: number): Promise<void> {
  await db.delete(saves).where(eq(saves.id, saveId));
}

export async function sendPlayerMessage(saveId: number, content: string): Promise<FullState> {
  const trimmed = content.trim();
  if (!trimmed) throw new GameError("消息不能为空");

  const save = await getSaveRow(saveId);
  if (save.ended) throw new GameError("这段故事已经结束了");
  if (save.phase !== "dialogue" || !save.activeCharacterId) {
    throw new GameError("当前不是对话阶段，请先做出剧情选择");
  }

  const chars = await ensureCharactersSeeded();
  const character = chars.find((c) => c.id === save.activeCharacterId);
  if (!character) throw new GameError("角色不存在");

  const state = await getOrCreateState(saveId, character.id);
  const recentRows = await getRecentHistory(saveId);
  const history = mapHistory(recentRows);

  await db.insert(messages).values({ saveId, role: "player", characterId: null, content: trimmed });

  const result = await getCharacterReply({
    character,
    affection: state.affection,
    mood: state.mood,
    memorySummary: state.memorySummary,
    history,
    playerMessage: trimmed,
    playerName: save.playerName,
    location: save.location,
    timeOfDay: save.timeOfDay,
  });

  const newAffection = clamp(state.affection + result.affectionDelta, 0, 100);
  const newInteractionCount = state.interactionCount + 1;
  let newMemorySummary = state.memorySummary;

  if (newInteractionCount % MEMORY_SUMMARY_EVERY === 0) {
    const recentText = [...history, { role: "player", characterId: null, content: trimmed }]
      .slice(-MEMORY_SUMMARY_EVERY * 2)
      .map((h) => `${h.role === "player" ? "玩家" : character.name}: ${h.content}`)
      .join("\n");
    newMemorySummary = await updateMemorySummary({
      characterName: character.name,
      existingSummary: state.memorySummary,
      recentText,
    });
  }

  await db
    .update(saveCharacterStates)
    .set({
      affection: newAffection,
      mood: result.mood,
      interactionCount: newInteractionCount,
      memorySummary: newMemorySummary,
      updatedAt: new Date(),
    })
    .where(eq(saveCharacterStates.id, state.id));

  await db.insert(messages).values({
    saveId,
    role: "character",
    characterId: character.id,
    content: result.reply,
    meta: { affectionDelta: result.affectionDelta, mood: result.mood },
  });

  await db
    .update(saves)
    .set({ turnCount: save.turnCount + 1, updatedAt: new Date() })
    .where(eq(saves.id, saveId));

  const full = await getFullState(saveId);
  if (!full) throw new GameError("存档不存在");
  return full;
}

export async function resolveChoice(saveId: number, choiceId: string): Promise<FullState> {
  const save = await getSaveRow(saveId);
  if (save.ended) throw new GameError("这段故事已经结束了");
  if (save.phase !== "narration" || !save.pendingChoices) {
    throw new GameError("当前没有可选择的选项");
  }
  const choice = (save.pendingChoices as PendingChoice[]).find((c) => c.id === choiceId);
  if (!choice) throw new GameError("选项不存在");

  await db.insert(messages).values({ saveId, role: "choice", characterId: null, content: choice.label });

  const chars = await ensureCharactersSeeded();
  const states = await getStates(saveId);
  const recentRows = await getRecentHistory(saveId);
  const history = mapHistory(recentRows);

  const update = await getDirectorUpdate({
    trigger: "choice",
    save,
    characters: chars,
    characterStates: states,
    history,
    chosenChoice: choice,
  });
  await applyDirectorUpdate(save, update);

  const full = await getFullState(saveId);
  if (!full) throw new GameError("存档不存在");
  return full;
}

export async function advanceStory(saveId: number): Promise<FullState> {
  const save = await getSaveRow(saveId);
  if (save.ended) throw new GameError("这段故事已经结束了");

  const chars = await ensureCharactersSeeded();
  const states = await getStates(saveId);
  const recentRows = await getRecentHistory(saveId);
  const history = mapHistory(recentRows);

  const update = await getDirectorUpdate({
    trigger: "advance",
    save,
    characters: chars,
    characterStates: states,
    history,
  });
  await applyDirectorUpdate(save, update, { incrementChapter: true });

  const full = await getFullState(saveId);
  if (!full) throw new GameError("存档不存在");
  return full;
}

export async function switchActiveCharacter(saveId: number, characterId: string): Promise<FullState> {
  const save = await getSaveRow(saveId);
  if (save.phase !== "dialogue") throw new GameError("当前不是对话阶段");
  const present = save.presentCharacterIds as string[];
  if (!present.includes(characterId)) throw new GameError("该角色目前不在场景中");

  await db
    .update(saves)
    .set({ activeCharacterId: characterId, updatedAt: new Date() })
    .where(eq(saves.id, saveId));

  const full = await getFullState(saveId);
  if (!full) throw new GameError("存档不存在");
  return full;
}
