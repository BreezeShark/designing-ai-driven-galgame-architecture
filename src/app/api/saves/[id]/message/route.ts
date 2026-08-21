import { GameError, sendPlayerMessage } from "@/lib/game/service";
import { runAction, parseSaveId, messageNdjsonResponse } from "@/lib/game/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content : "";
  const stream = body.stream === true;

  let saveId: number;
  try {
    saveId = parseSaveId(id);
  } catch (err) {
    const message = err instanceof GameError ? err.message : "无效的存档ID";
    return Response.json({ error: message }, { status: 400 });
  }

  if (!stream) {
    return runAction(() => sendPlayerMessage(saveId, content));
  }
  return messageNdjsonResponse(saveId, content);
}
