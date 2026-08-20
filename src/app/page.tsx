import { listSaves } from "@/lib/game/service";
import { isLiveAIEnabled } from "@/lib/ai/client";
import { TitleScreen } from "@/components/game/TitleScreen";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const saves = await listSaves();
  return (
    <TitleScreen
      hasSaves={saves.length > 0}
      latestSaveId={saves[0]?.id ?? null}
      liveAI={await isLiveAIEnabled()}
    />
  );
}
