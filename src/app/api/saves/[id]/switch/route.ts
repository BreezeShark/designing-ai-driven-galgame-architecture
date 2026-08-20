import { switchActiveCharacter } from "@/lib/game/service";
import { runAction, parseSaveId } from "@/lib/game/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const characterId = typeof body.characterId === "string" ? body.characterId : "";
  return runAction(() => switchActiveCharacter(parseSaveId(id), characterId));
}
