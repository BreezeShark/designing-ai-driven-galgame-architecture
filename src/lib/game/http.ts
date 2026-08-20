import { GameError, type FullState } from "./service";

export async function runAction(fn: () => Promise<FullState>): Promise<Response> {
  try {
    const state = await fn();
    return Response.json({ state });
  } catch (err) {
    const message = err instanceof GameError ? err.message : "操作失败，请稍后重试";
    if (!(err instanceof GameError)) console.error(err);
    return Response.json({ error: message }, { status: err instanceof GameError ? 400 : 500 });
  }
}

export function parseSaveId(id: string): number {
  const saveId = Number(id);
  if (!Number.isFinite(saveId)) throw new GameError("无效的存档ID");
  return saveId;
}
