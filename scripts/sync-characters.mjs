#!/usr/bin/env node
// CLI wrapper around the love_girls → public/characters sync.
//   node scripts/sync-characters.mjs
// Also runs automatically via `npm run dev` / `npm run build`, and on the
// fly from the server (src/lib/characters/gallery.ts) so photos dropped into
// love_girls/ appear without restarting anything.

import { pathToFileURL } from "node:url";
import { syncLoveGirls } from "../src/lib/characters/sync-girls.mjs";

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const { girls, changed } = syncLoveGirls();
  if (girls.length === 0) {
    console.log("[sync-characters] love_girls/ 里还没有任何女主文件夹或照片。");
  } else {
    for (const g of girls) {
      console.log(`[sync-characters] ${g.name}  →  ${g.count} 张照片  (${g.cover} …)`);
    }
    console.log(`[sync-characters] ${changed ? "manifest 已更新" : "无变化"}，共 ${girls.length} 位女主。`);
  }
}
