// Local, fully offline fallback "AI" used whenever OPENAI_API_KEY is not
// configured. It keeps the whole game fully playable without any external
// dependency, while exposing exactly the same shape of data that the real
// LLM-backed character/director modules produce — so switching a provider
// on later is a drop-in change with zero UI/DB changes required.

import type { PendingChoice } from "@/db/schema";

export type SimCharacterReply = {
  reply: string;
  affectionDelta: number;
  mood: string;
};

const POSITIVE_WORDS = [
  "喜欢", "爱", "漂亮", "可爱", "谢谢", "厉害", "加油", "想你", "在一起",
  "开心", "美丽", "温柔", "陪你", "陪我", "谢谢你", "辛苦了", "真好",
];
const NEGATIVE_WORDS = [
  "讨厌", "笨", "滚", "闭嘴", "烦", "丑", "无聊", "傻", "生气", "垃圾",
];

function sentimentDelta(message: string): number {
  let delta = Math.random() > 0.5 ? 1 : 0;
  for (const w of POSITIVE_WORDS) if (message.includes(w)) delta += 3;
  for (const w of NEGATIVE_WORDS) if (message.includes(w)) delta -= 4;
  return Math.max(-6, Math.min(6, delta));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function tierOf(affection: number): "low" | "mid" | "high" {
  if (affection < 35) return "low";
  if (affection < 70) return "mid";
  return "high";
}

type ReplyBank = Record<"low" | "mid" | "high", { positive: string[]; neutral: string[]; negative: string[] }>;

const REPLY_BANKS: Record<string, ReplyBank> = {
  zhiyuan: {
    low: {
      positive: ["……谢谢，你人挺好的。", "你记得啊……有点意外。", "嗯，我会的，谢谢关心。"],
      neutral: ["……你好，这里可以坐吗。", "不好意思，我看到比较重要的段落了。", "窗边这个位置，我一般都来得比较早。"],
      negative: ["……抱歉，我想先看完这一章。", "没、没什么，你不用在意。", "……我先去还书了。"],
    },
    mid: {
      positive: ["……被你这么一说，有点不知道该看哪里了。", "你总是能注意到我没说出口的事。", "这页我读了很多遍……讲给你听，好像也不错。"],
      neutral: ["今天的云很好看，我在随笔里画了下来。", "如果你不赶时间，可以陪我走一段。", "江心妍又拉我去社团了……你要一起来吗。"],
      negative: ["……我不是故意冷落你，只是不太会说。", "让我安静一会儿，好吗。", "……你今天有点奇怪。"],
    },
    high: {
      positive: ["小说里的句子，突然都变成你的样子了。", "……只有在你面前，我才敢说这些话。", "如果结局是我们一起写的，好像就不怕了。"],
      neutral: ["我把靠窗的位置，留了一半给你。", "今天……可以晚一点再回宿舍吗。", "和你待着的时候，连沉默都是舒服的。"],
      negative: ["……对不起，我不是想让你担心。", "别露出那种表情，我真的没事。", "……谢谢你还愿意留在这里。"],
    },
  },
  xinyan: {
    low: {
      positive: ["哟，会说话嘛你！再来一句？", "哈哈，你这个人还挺有意思的。", "行吧，看你态度不错，记你一功。"],
      neutral: ["同学，挡到我的镜头了哦。", "你也是来蹭彩排的吗？站这边。", "广播站招新，考虑一下？就缺你这样的。"],
      negative: ["喂，这话可就不礼貌了啊。", "行行行，说不过你。", "哼，那我去找别人玩。"],
    },
    mid: {
      positive: ["……你这样我会当真的哦，说好了？", "知鸢说我提到你的时候眼睛在发光，胡说！", "今天心情好，请你喝奶茶，仅此一次。"],
      neutral: ["晚上广播站有我的节目，记得收听啊。", "陪我去采个访呗，就当放学散步。", "你上次随口说的那家店，我记着呢。"],
      negative: ["喂，你今天怎么回事，态度很差哦。", "哦——原来我在你心里是这样的人。", "不理我？行，那你明天别想吃我带的早饭。"],
    },
    high: {
      positive: ["本来想再等等的……但喜欢你这件事，藏不住了。", "话筒前我从不紧张，只有面对你才会。", "下一个节目，想只念你的名字。"],
      neutral: ["今天放学，只准陪我一个人走。", "……偶尔也想被你主动找一次啊，笨蛋。", "和你在一起，连加班改稿都是甜的。"],
      negative: ["你要是不理我，我可是会在节目里点歌骂人的。", "只有你能让我这么在意，知不知道。", "……吵架也要和好，这次我先低头。"],
    },
  },
};

export function simulateCharacterReply(params: {
  characterId: string;
  affection: number;
  playerMessage: string;
}): SimCharacterReply {
  const delta = sentimentDelta(params.playerMessage);
  const tier = tierOf(params.affection);
  const bank = REPLY_BANKS[params.characterId] ?? REPLY_BANKS.xinyan;
  const sentiment = delta > 1 ? "positive" : delta < 0 ? "negative" : "neutral";
  const reply = pick(bank[tier][sentiment]);
  const mood = delta > 2 ? "happy" : delta < -1 ? "annoyed" : tier === "high" ? "shy" : "calm";
  return { reply, affectionDelta: delta, mood };
}

// ---------------------------------------------------------------------------
// Director simulation: a small hand-authored story script that rotates
// through locations/heroines. The real director AI (see director.ts) can
// improvise freely; this fallback just walks the script deterministically
// so the game always has somewhere sensible to go next.
// ---------------------------------------------------------------------------

export type SimDirectorUpdate = {
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

type SceneScript = {
  location: string;
  backgroundKey: string;
  timeOfDay: string;
  presentCharacterIds: string[];
  narration: string;
};

const SCRIPT: SceneScript[] = [
  {
    location: "图书馆",
    backgroundKey: "library",
    timeOfDay: "afternoon",
    presentCharacterIds: ["zhiyuan"],
    narration: "午后的图书馆很安静，阳光斜斜地落在靠窗的位置。林知鸢合上手边的书，认出了你，犹豫了一下，朝旁边空着的座位轻轻偏了偏头。",
  },
  {
    location: "湖边小路",
    backgroundKey: "park",
    timeOfDay: "noon",
    presentCharacterIds: ["xinyan"],
    narration: "中午的湖边小路人不多。江心妍举着话筒在录校园广播的街采，一转头看见你，眼睛立刻亮了，冲你招手：来得正好！",
  },
  {
    location: "教学楼天台",
    backgroundKey: "rooftop",
    timeOfDay: "evening",
    presentCharacterIds: ["zhiyuan", "xinyan"],
    narration: "黄昏的天台被染成暖橙色。江心妍拽着林知鸢说要看日落，看见你上来，笑着挪出中间的位置：就等你一个了。",
  },
  {
    location: "湖畔公园",
    backgroundKey: "park",
    timeOfDay: "afternoon",
    presentCharacterIds: ["zhiyuan"],
    narration: "周末的湖畔公园，风把柳条吹得晃动。林知鸢坐在长椅上写随笔，看见你，把速写本往怀里收了收，往边上让了让。",
  },
  {
    location: "教室",
    backgroundKey: "classroom",
    timeOfDay: "night",
    presentCharacterIds: ["xinyan", "zhiyuan"],
    narration: "晚自习后的教室还亮着灯，黑板上写着晚会彩排的分工。江心妍踩在椅子上挂横幅，林知鸢在下面帮她扶着椅子脚，两人同时看向你。",
  },
  {
    location: "图书馆",
    backgroundKey: "library",
    timeOfDay: "night",
    presentCharacterIds: ["xinyan", "zhiyuan"],
    narration: "闭馆前的图书馆只剩你们三个人。管理员打着哈欠关掉一半的灯，江心妍压低声音说今晚谁最后走谁请宵夜，林知鸢的笔尖在纸上停了很久。",
  },
];

const ENDING_NARRATION =
  "晚会散场后的操场很空，远处还有零星的欢呼声。身边的人和你并排慢慢走着，谁都没有先开口，路灯把两个影子拉得很长——这段故事，暂时告一段落。";

// The hand-authored script above only knows the built-in trio. This helper
// adapts a scene's cast to whatever heroines actually exist right now:
// deleted heroines are dropped, and custom heroines added on the settings
// page are appended so they always show up and can be talked to offline.
const SCRIPTED_IDS = new Set(["zhiyuan", "xinyan"]);

function adaptCast(sceneIds: string[], names: Record<string, string>): string[] {
  const present = sceneIds.filter((id) => names[id]);
  const extras = Object.keys(names).filter((id) => !SCRIPTED_IDS.has(id) && !present.includes(id));
  const cast = [...present, ...extras];
  // Every scene needs at least someone on stage.
  return cast.length > 0 ? cast : Object.keys(names).slice(0, 1);
}

function buildTalkChoices(presentCharacterIds: string[], names: Record<string, string>): PendingChoice[] {
  const choices: PendingChoice[] = presentCharacterIds.map((id) => ({
    id: `talk_${id}`,
    label: `找${names[id] ?? id}说话`,
  }));
  choices.push({ id: "wait", label: "先在原地观察一下周围" });
  return choices;
}

export function simulateDirectorStart(names: Record<string, string>): SimDirectorUpdate {
  const scene = SCRIPT[0];
  const cast = adaptCast(scene.presentCharacterIds, names);
  return {
    narration: scene.narration,
    location: scene.location,
    backgroundKey: scene.backgroundKey,
    timeOfDay: scene.timeOfDay,
    presentCharacterIds: cast,
    choices: buildTalkChoices(cast, names),
    phase: "narration",
    activeCharacterId: null,
    storySummaryAppend: "故事开始：主角在临江大学与她们相遇。",
    ended: false,
  };
}

export function simulateDirectorChoice(params: {
  chapter: number;
  chosenChoiceId: string;
  currentPresent: string[];
  names: Record<string, string>;
}): SimDirectorUpdate {
  const scene = SCRIPT[Math.min(params.chapter - 1, SCRIPT.length - 1)];
  const cast = adaptCast(scene.presentCharacterIds, params.names);
  if (params.chosenChoiceId.startsWith("talk_")) {
    const targetId = params.chosenChoiceId.replace("talk_", "");
    return {
      narration: "",
      location: scene.location,
      backgroundKey: scene.backgroundKey,
      timeOfDay: scene.timeOfDay,
      presentCharacterIds: cast,
      choices: null,
      phase: "dialogue",
      activeCharacterId: targetId,
      storySummaryAppend: "",
      ended: false,
    };
  }
  // "wait" or unknown choice -> stay in narration, add a little flavor text.
  return {
    narration: "你静静观察了一下周围，气氛似乎没什么变化，大家都在等你先开口。",
    location: scene.location,
    backgroundKey: scene.backgroundKey,
    timeOfDay: scene.timeOfDay,
    presentCharacterIds: cast,
    choices: buildTalkChoices(cast, params.names),
    phase: "narration",
    activeCharacterId: null,
    storySummaryAppend: "",
    ended: false,
  };
}

export function simulateDirectorAdvance(params: {
  chapter: number;
  names: Record<string, string>;
  totalAffection: number;
}): SimDirectorUpdate {
  const nextChapter = params.chapter; // caller increments chapter before storing
  if (nextChapter >= SCRIPT.length) {
    const cast = adaptCast(["xinyan", "zhiyuan"], params.names);
    return {
      narration: ENDING_NARRATION,
      location: "天台",
      backgroundKey: "rooftop",
      timeOfDay: "night",
      presentCharacterIds: cast,
      choices: null,
      phase: "ended",
      activeCharacterId: null,
      storySummaryAppend: "校园晚会落幕之夜，故事迎来了一个温暖的段落结尾。",
      ended: true,
    };
  }
  const scene = SCRIPT[nextChapter];
  const cast = adaptCast(scene.presentCharacterIds, params.names);
  return {
    narration: scene.narration,
    location: scene.location,
    backgroundKey: scene.backgroundKey,
    timeOfDay: scene.timeOfDay,
    presentCharacterIds: cast,
    choices: buildTalkChoices(cast, params.names),
    phase: "narration",
    activeCharacterId: null,
    storySummaryAppend: `剧情推进到「${scene.location}」。`,
    ended: false,
  };
}

export function simulateMemorySummary(existing: string, recentText: string): string {
  const gist = recentText.slice(0, 80).replace(/\n/g, " ");
  const merged = `${existing} 最近聊到：${gist}...`.trim();
  return merged.length > 400 ? merged.slice(merged.length - 400) : merged;
}
