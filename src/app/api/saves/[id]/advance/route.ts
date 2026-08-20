import { advanceStory } from "@/lib/game/service";
import { runAction, parseSaveId } from "@/lib/game/http";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runAction(() => advanceStory(parseSaveId(id)));
}
