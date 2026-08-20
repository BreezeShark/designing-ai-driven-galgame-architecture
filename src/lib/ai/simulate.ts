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
  himari: {
    low: {
      positive: ["哼、算你还有点良心。", "别、别用那种语气跟我说话，很奇怪。", "我才没有很在意你说的话呢。"],
      neutral: ["……你今天怎么突然找我说话。", "有事就直说，我很忙的。", "班长的工作可不是给你聊天用的。"],
      negative: ["你、你说什么呢！真是的！", "哼，随便你怎么说。", "…我先去忙了，别烦我。"],
    },
    mid: {
      positive: ["笨蛋，突然说这种话让人怎么反应啦……", "…谢谢你，不过、不要总是这样突然说啦。", "算了，今天就当作没听到你这么甜的话。"],
      neutral: ["今天的值日表你看了吗，别又忘记。", "放学后要不要一起走一段？只是顺路而已。", "你最近怪怪的，有什么事瞒着我？"],
      negative: ["喂，你今天是怎么了，态度很差哦。", "……我还以为你会更懂事一点。", "算了，我不跟你计较。"],
    },
    high: {
      positive: ["…你总是这样，让人很难不在意你。", "只有对你，我才会说这种话，知道吗。", "有你在的话，好像什么都没那么难了。"],
      neutral: ["下次…可以再早点来找我吗，我会等你的。", "今天也想和你多待一会儿。", "跟你在一起的时候，感觉最放松。"],
      negative: ["你要是不理我，我会很难过的，知道吗。", "别用那种口气，我会当真的哦。", "…就算这样，我也还是会担心你。"],
    },
  },
  mio: {
    low: {
      positive: ["……谢谢。", "是吗，那就好。", "你，好像和其他人不太一样。"],
      neutral: ["……嗯。", "这本书，你也看过吗。", "图书室下午会比较安静，适合待着。"],
      negative: ["……我先回去了。", "抱歉，我不太想说这个。", "……没事。"],
    },
    mid: {
      positive: ["……和你说话，好像不会觉得累。", "谢谢你，一直愿意听我说这些。", "…难得会想让人多留一会儿。"],
      neutral: ["最近在看一本很安静的小说，讲的是等待的故事。", "如果你愿意，可以偶尔陪我待在图书室。", "……你今天看起来心情不错。"],
      negative: ["……我不是故意冷淡的，只是不太会表达。", "抱歉，让你误会了。", "……给我一点时间。"],
    },
    high: {
      positive: ["……只有你，会让我想多说一些平时不会说的话。", "有你在身边，安静的时间也变得不一样了。", "……谢谢你一直没有放弃靠近我。"],
      neutral: ["以后，可以一直像这样待在你身边吗。", "……今天可以晚一点再回去吗。", "和你在一起的时间，希望能再长一点。"],
      negative: ["……对不起，我不是想让你担心。", "别露出那种表情，我没事的，真的。", "……谢谢你还愿意留在我身边。"],
    },
  },
  hina: {
    low: {
      positive: ["嘿嘿，就知道你会这么说！", "诶嘿～被你这么一说我也开心啦！", "果然还是从小一起长大的最懂我！"],
      neutral: ["喂喂，今天要不要一起回家啦！", "你猜我今天带了什么好吃的～", "又在发呆，跟我说说话嘛！"],
      negative: ["诶——你怎么这样啦，好过分！", "哼，不理你了！", "…那我今天不去找你玩了，哼。"],
    },
    mid: {
      positive: ["笨蛋，突然说这种话会让人心跳加速的啦！", "嘿嘿，能一直和你这样真好。", "只要是你说的话，我都愿意相信哦！"],
      neutral: ["放学要不要一起去买那家新开的甜品店呀！", "今天陪我去个地方好不好，拜托啦～", "跟你在一起的时候时间过得好快。"],
      negative: ["你干嘛突然这样嘛，人家会难过的。", "…哼，那我今天就自己一个人啦。", "别这样啦，我们和好嘛。"],
    },
    high: {
      positive: ["…喜欢你这件事，我好像藏不住了。", "只要和你在一起，什么地方都像是节日。", "以后也要一直这样陪着我哦，说好了！"],
      neutral: ["今天可以牵着手一起走吗，就一小段也好。", "…有时候会突然很想紧紧抱住你。", "从小到大，最喜欢的人一直都是你。"],
      negative: ["…如果你不理我，我真的会很难过的。", "笨蛋，只有你能让我这么在意。", "…就算吵架，我也还是最喜欢你。"],
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
  const bank = REPLY_BANKS[params.characterId] ?? REPLY_BANKS.himari;
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
    location: "教室",
    backgroundKey: "classroom",
    timeOfDay: "morning",
    presentCharacterIds: ["himari"],
    narration: "清晨的阳光洒进教室，朝雾陽葵正抱着一叠文件走进来，看到你便皱了皱眉，像是在思考要不要过来打招呼。",
  },
  {
    location: "天台",
    backgroundKey: "rooftop",
    timeOfDay: "noon",
    presentCharacterIds: ["himari", "hina"],
    narration: "午休时间，你被叫到了天台。风有点大，星野陽菜已经占好了位置，正朝你用力挥手。",
  },
  {
    location: "图书室",
    backgroundKey: "library",
    timeOfDay: "afternoon",
    presentCharacterIds: ["mio"],
    narration: "放学后的图书室很安静，只有翻书声。雪代澪坐在靠窗的位置，注意到你进来时抬了下眼。",
  },
  {
    location: "公园",
    backgroundKey: "park",
    timeOfDay: "evening",
    presentCharacterIds: ["hina", "mio"],
    narration: "傍晚的公园很安静，长椅旁星野陽菜正踢着石子等你，雪代澪也难得地一起来了，安静地站在不远处。",
  },
  {
    location: "天台",
    backgroundKey: "rooftop",
    timeOfDay: "evening",
    presentCharacterIds: ["himari", "hina", "mio"],
    narration: "夕阳把天台染成橙红色，三个人似乎都在等你过来，气氛有种说不出的微妙。",
  },
  {
    location: "教室",
    backgroundKey: "classroom",
    timeOfDay: "night",
    presentCharacterIds: ["himari", "hina", "mio"],
    narration: "文化祭前夜，教室里还亮着灯，大家都在为明天做最后的准备，你也被留下来帮忙。",
  },
];

const ENDING_NARRATION =
  "文化祭的烟花在夜空中炸开，你身边的她转过头看着你，脸上带着这段时间以来最放松的笑容——这段故事，暂时告一段落。";

// The hand-authored script above only knows the built-in trio. This helper
// adapts a scene's cast to whatever heroines actually exist right now:
// deleted heroines are dropped, and custom heroines added on the settings
// page are appended so they always show up and can be talked to offline.
const SCRIPTED_IDS = new Set(["himari", "mio", "hina"]);

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
    storySummaryAppend: "故事开始：主角在校园中与大家相遇。",
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
    const cast = adaptCast(["himari", "hina", "mio"], params.names);
    return {
      narration: ENDING_NARRATION,
      location: "天台",
      backgroundKey: "rooftop",
      timeOfDay: "night",
      presentCharacterIds: cast,
      choices: null,
      phase: "ended",
      activeCharacterId: null,
      storySummaryAppend: "文化祭之夜，故事迎来了一个温暖的段落结尾。",
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
