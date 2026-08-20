import type { PendingChoice } from "@/db/schema";

export type CharacterReplyResult = {
  reply: string;
  affectionDelta: number;
  mood: string;
};

export type DirectorUpdate = {
  narration: string;
  location: string;
  backgroundKey: string;
  timeOfDay: string;
  presentCharacterIds: string[];
  choices: PendingChoice[] | null;
  phase: "narration" | "dialogue" | "ended";
  activeCharacterId: string | null;
  storySummaryAppend: string;
  ended: boolean;
};

export type HistoryItem = {
  role: string; // player | character | narrator | choice
  characterId: string | null;
  content: string;
};
