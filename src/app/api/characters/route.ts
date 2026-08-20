import { ensureCharactersSeeded } from "@/lib/game/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const chars = await ensureCharactersSeeded();
  return Response.json({ characters: chars });
}
