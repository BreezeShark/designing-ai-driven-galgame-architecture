import { resolveChoice } from "@/lib/game/service";
import { runAction, parseSaveId } from "@/lib/game/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const choiceId = typeof body.choiceId === "string" ? body.choiceId : "";
  return runAction(() => resolveChoice(parseSaveId(id), choiceId));
}
