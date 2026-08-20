import { db } from "@/db";
import { characters, saves } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Update a heroine's editable fields (persona / name / avatar / color / ...). */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "无效的请求体" }, { status: 400 });
  }

  const patch: Partial<{
    persona: string;
    speechStyle: string;
    subtitle: string;
    name: string;
    avatarUrl: string;
    accentColor: string;
  }> = {};

  if (typeof body.persona === "string") {
    const persona = body.persona.trim();
    if (!persona) return Response.json({ error: "人设提示词不能为空" }, { status: 400 });
    if (persona.length > 4000) return Response.json({ error: "人设提示词过长（最多4000字）" }, { status: 400 });
    patch.persona = persona;
  }
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return Response.json({ error: "角色名字不能为空" }, { status: 400 });
    patch.name = name.slice(0, 40);
  }
  if (typeof body.speechStyle === "string") patch.speechStyle = body.speechStyle.trim().slice(0, 100);
  if (typeof body.subtitle === "string") patch.subtitle = body.subtitle.trim().slice(0, 100);
  if (typeof body.avatarUrl === "string") patch.avatarUrl = body.avatarUrl.trim().slice(0, 300);
  if (typeof body.accentColor === "string" && HEX_COLOR.test(body.accentColor)) {
    patch.accentColor = body.accentColor;
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  const [updated] = await db.update(characters).set(patch).where(eq(characters.id, id)).returning();
  if (!updated) return Response.json({ error: "角色不存在" }, { status: 404 });

  return Response.json({ character: updated });
}

/**
 * Delete a heroine. Her per-save states cascade automatically; we also scrub
 * references inside each save (present list / active speaker) so existing
 * playthroughs keep working.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const all = await db.select().from(characters);
  if (!all.some((c) => c.id === id)) return Response.json({ error: "角色不存在" }, { status: 404 });
  if (all.length <= 1) return Response.json({ error: "至少要保留一位女主角" }, { status: 400 });

  // Scrub references in existing saves before deleting.
  const saveRows = await db.select().from(saves);
  for (const s of saveRows) {
    const present = (s.presentCharacterIds as string[]).filter((cid) => cid !== id);
    const wasActive = s.activeCharacterId === id;
    const choicesReference =
      Array.isArray(s.pendingChoices) && s.pendingChoices.some((c) => c.id === `talk_${id}`);
    if (present.length !== (s.presentCharacterIds as string[]).length || wasActive || choicesReference) {
      await db
        .update(saves)
        .set({
          presentCharacterIds: present,
          activeCharacterId: wasActive ? null : s.activeCharacterId,
          phase: wasActive && s.phase === "dialogue" ? "narration" : s.phase,
          pendingChoices: choicesReference
            ? (s.pendingChoices ?? []).filter((c) => c.id !== `talk_${id}`)
            : s.pendingChoices,
          updatedAt: new Date(),
        })
        .where(eq(saves.id, s.id));
    }
  }

  await db.delete(characters).where(eq(characters.id, id));
  return Response.json({ ok: true });
}
