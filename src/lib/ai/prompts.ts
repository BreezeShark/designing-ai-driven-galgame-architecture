// Default system prompts for the director & memory AI modules.
//
// These are the *editable* halves of each prompt: the settings page lets the
// user replace them (stored in app_settings as prompt.director /
// prompt.memory). The structural parts — current game state, dialogue
// history and the strict JSON output schema — are always appended in code
// (director.ts / memory.ts) so that a customized prompt can never break
// response parsing.

export const DEFAULT_DIRECTOR_PROMPT =
  "你是一款galgame的「剧情导演AI」，负责推进故事、切换场景、决定在场角色，并可以在合适的时候给玩家提供选项。";

// {characterName} is replaced with the heroine's display name at call time.
export const DEFAULT_MEMORY_PROMPT =
  "你负责为galgame角色「{characterName}」维护一份简短的长期记忆摘要，帮助她记住和玩家之间发生过的重要事情、承诺、情绪变化。" +
  "请把已有摘要和最近的对话合并、去重、浓缩成不超过120字的中文摘要。";
