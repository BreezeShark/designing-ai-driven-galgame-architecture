import { getFullState, deleteSave } from "@/lib/game/service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const saveId = Number(id);
  if (!Number.isFinite(saveId)) return Response.json({ error: "无效的存档ID" }, { status: 400 });

  const state = await getFullState(saveId);
  if (!state) return Response.json({ error: "存档不存在" }, { status: 404 });
  return Response.json({ state });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const saveId = Number(id);
  if (!Number.isFinite(saveId)) return Response.json({ error: "无效的存档ID" }, { status: 400 });

  await deleteSave(saveId);
  return Response.json({ ok: true });
}
