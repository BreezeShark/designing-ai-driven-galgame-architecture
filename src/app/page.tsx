import { listSaves } from "@/lib/game/service";
import { isLiveAIEnabled } from "@/lib/ai/client";
import { getEffectiveTitleBg } from "@/lib/settings";
import { getGirlGalleries } from "@/lib/characters/gallery";
import { TitleScreen } from "@/components/game/TitleScreen";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const saves = await listSaves();
  const manifest = await getGirlGalleries();
  return (
    <TitleScreen
      hasSaves={saves.length > 0}
      latestSaveId={saves[0]?.id ?? null}
      liveAI={await isLiveAIEnabled()}
      titleBgUrl={await getEffectiveTitleBg()}
      girls={manifest.girls.map((g) => ({ id: g.id, name: g.name, cover: g.cover, count: g.count }))}
    />
  );
}
