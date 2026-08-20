import { createSave, listSaves, GameError } from "@/lib/game/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const saves = await listSaves();
  return Response.json({ saves });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const slotName = typeof body.slotName === "string" ? body.slotName : "新的存档";
    const playerName = typeof body.playerName === "string" && body.playerName.trim() ? body.playerName.trim() : "你";
    const state = await createSave({ slotName, playerName });
    return Response.json({ state });
  } catch (err) {
    const message = err instanceof GameError ? err.message : "创建存档失败";
    console.error(err);
    return Response.json({ error: message }, { status: err instanceof GameError ? 400 : 500 });
  }
}
