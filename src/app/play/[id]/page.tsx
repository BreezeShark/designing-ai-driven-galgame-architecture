import { notFound } from "next/navigation";
import { getFullState } from "@/lib/game/service";
import { PlayClient } from "@/components/game/PlayClient";

export const dynamic = "force-dynamic";

export default async function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const saveId = Number(id);
  if (!Number.isFinite(saveId)) notFound();

  const state = await getFullState(saveId);
  if (!state) notFound();

  return <PlayClient initialState={state} />;
}
