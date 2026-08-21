import { db } from "@/db";
import { characters } from "@/db/schema";
import { desc } from "drizzle-orm";
import { ensureCharactersSeeded } from "@/lib/game/service";
import { parseSprites } from "@/lib/data/sprites";

export const dynamic = "force-dynamic";

export async function GET() {
  const chars = await ensureCharactersSeeded();
  return Response.json({ characters: chars });
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Create a new heroine from the settings page. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "无效的请求体" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
  const persona = typeof body.persona === "string" ? body.persona.trim().slice(0, 4000) : "";
  if (!name) return Response.json({ error: "角色名字不能为空" }, { status: 400 });
  if (!persona) return Response.json({ error: "人设提示词不能为空" }, { status: 400 });

  const subtitle = typeof body.subtitle === "string" ? body.subtitle.trim().slice(0, 100) : "";
  const speechStyle = typeof body.speechStyle === "string" ? body.speechStyle.trim().slice(0, 100) : "";
  const avatarUrl = typeof body.avatarUrl === "string" ? body.avatarUrl.trim().slice(0, 300) : "";
  const accentColor =
    typeof body.accentColor === "string" && HEX_COLOR.test(body.accentColor) ? body.accentColor : "#f472b6";
  // Optional 立绘 library; the director AI picks one of these per scene.
  const sprites = parseSprites(body.sprites) ?? [];

  const [{ maxOrder }] = await db
    .select({ maxOrder: characters.sortOrder })
    .from(characters)
    .orderBy(desc(characters.sortOrder))
    .limit(1)
    .then((rows) => (rows.length ? rows.map((r) => ({ maxOrder: r.maxOrder })) : [{ maxOrder: 0 }]));

  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

  const [created] = await db
    .insert(characters)
    .values({
      id,
      name,
      subtitle,
      speechStyle,
      persona,
      avatarUrl: avatarUrl || sprites[0]?.url || "/images/char-placeholder.svg",
      sprites:
        sprites.length > 0
          ? sprites
          : [{ url: avatarUrl || "/images/char-placeholder.svg", label: "默认立绘" }],
      accentColor,
      sortOrder: (maxOrder ?? 0) + 1,
    })
    .returning();

  return Response.json({ character: created });
}
