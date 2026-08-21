import { GameError, sendPlayerMessage, type FullState } from "./service";

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

/** NDJSON stream for POST /api/saves/[id]/message when the client asks for stream:true. */
export function messageNdjsonResponse(saveId: number, content: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const write = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const state = await sendPlayerMessage(saveId, content, {
          onDelta: (text) => write({ type: "delta", text }),
        });
        write({ type: "state", state });
      } catch (err) {
        const message = err instanceof GameError ? err.message : "操作失败，请稍后重试";
        if (!(err instanceof GameError)) console.error(err);
        write({ type: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
