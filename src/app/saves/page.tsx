import { listSaves } from "@/lib/game/service";
import { SavesManager } from "@/components/game/SavesManager";

export const dynamic = "force-dynamic";

export default async function SavesPage() {
  const saves = await listSaves();
  return <SavesManager initialSaves={saves} />;
}
