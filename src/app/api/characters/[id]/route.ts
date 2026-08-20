import { db } from "@/db";
import { characters } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** Update a heroine's editable prompt fields (persona / speech style / subtitle). */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "无效的请求体" }, { status: 400 });
  }

  const patch: Partial<{ persona: string; speechStyle: string; subtitle: string }> = {};
  if (typeof body.persona === "string") {
    const persona = body.persona.trim();
    if (!persona) return Response.json({ error: "人设提示词不能为空" }, { status: 400 });
    if (persona.length > 4000) return Response.json({ error: "人设提示词过长（最多4000字）" }, { status: 400 });
    patch.persona = persona;
  }
  if (typeof body.speechStyle === "string") patch.speechStyle = body.speechStyle.trim().slice(0, 100);
  if (typeof body.subtitle === "string") patch.subtitle = body.subtitle.trim().slice(0, 100);

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  const [updated] = await db.update(characters).set(patch).where(eq(characters.id, id)).returning();
  if (!updated) return Response.json({ error: "角色不存在" }, { status: 404 });

  return Response.json({ character: updated });
}
