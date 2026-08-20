import { db } from "@/db";
import { assets } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const assetId = Number(id);
  if (!Number.isFinite(assetId)) return new Response("bad id", { status: 400 });

  const [row] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!row) return new Response("not found", { status: 404 });

  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mimeType,
      // Uploads are immutable (replacing an image creates a new id).
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
