import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Characters: static definitions of the AI-driven heroines.
// Each character has its own "persona" system prompt used by the character AI.
// ---------------------------------------------------------------------------
export const characters = pgTable("characters", {
  id: text("id").primaryKey(), // slug, e.g. "himari"
  name: text("name").notNull(),
  subtitle: text("subtitle").notNull().default(""), // relationship / role tag
  avatarUrl: text("avatar_url").notNull().default(""),
  accentColor: text("accent_color").notNull().default("#f472b6"),
  persona: text("persona").notNull(), // system prompt describing personality
  speechStyle: text("speech_style").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;

export type PendingChoice = { id: string; label: string };

// ---------------------------------------------------------------------------
// Saves: one row per save slot / playthrough. Holds the "director" story state.
// ---------------------------------------------------------------------------
export const saves = pgTable("saves", {
  id: serial("id").primaryKey(),
  slotName: text("slot_name").notNull().default("新的存档"),
  playerName: text("player_name").notNull().default("你"),
  chapter: integer("chapter").notNull().default(1),
  phase: text("phase").notNull().default("narration"), // narration | dialogue | ended
  location: text("location").notNull().default("教室"),
  timeOfDay: text("time_of_day").notNull().default("afternoon"),
  backgroundKey: text("background_key").notNull().default("classroom"),
  presentCharacterIds: jsonb("present_character_ids").$type<string[]>().notNull().default([]),
  activeCharacterId: text("active_character_id"),
  pendingChoices: jsonb("pending_choices").$type<PendingChoice[] | null>().default(null),
  storySummary: text("story_summary").notNull().default(""),
  lastNarration: text("last_narration").notNull().default(""),
  turnCount: integer("turn_count").notNull().default(0),
  ended: boolean("ended").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Save = typeof saves.$inferSelect;
export type NewSave = typeof saves.$inferInsert;

// ---------------------------------------------------------------------------
// Per-save, per-character relationship state + long-term memory summary.
// This is what lets a heroine "remember" the player across the whole game
// even though only a bounded window of raw messages is fed to the model.
// ---------------------------------------------------------------------------
export const saveCharacterStates = pgTable(
  "save_character_states",
  {
    id: serial("id").primaryKey(),
    saveId: integer("save_id")
      .notNull()
      .references(() => saves.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    affection: integer("affection").notNull().default(20),
    mood: text("mood").notNull().default("calm"),
    memorySummary: text("memory_summary").notNull().default(""),
    interactionCount: integer("interaction_count").notNull().default(0),
    unlocked: boolean("unlocked").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("save_character_unique").on(table.saveId, table.characterId),
    index("save_character_save_idx").on(table.saveId),
  ],
);

export type SaveCharacterState = typeof saveCharacterStates.$inferSelect;
export type NewSaveCharacterState = typeof saveCharacterStates.$inferInsert;

// ---------------------------------------------------------------------------
// Messages: full dialogue log per save, used both for on-screen history and
// as the raw short-term memory window fed back into the AI prompts.
// ---------------------------------------------------------------------------
export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    saveId: integer("save_id")
      .notNull()
      .references(() => saves.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // player | character | narrator | choice
    characterId: text("character_id"),
    content: text("content").notNull(),
    meta: jsonb("meta").default(null),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("messages_save_idx").on(table.saveId, table.id)],
);

export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;

// ---------------------------------------------------------------------------
// App settings: simple key/value store backing the visual settings page.
// Holds AI endpoint overrides (per-scope base URL / API key / model) and
// prompt overrides (director & memory system prompts). Anything stored here
// takes precedence over environment variables; missing keys fall back to
// env vars and then to built-in defaults.
// ---------------------------------------------------------------------------
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AppSetting = typeof appSettings.$inferSelect;

