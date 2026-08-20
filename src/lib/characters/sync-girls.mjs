// Syncs the player's real-photo character sprites ("立绘") from the
// top-level `love_girls/` folder into `public/characters/` so Next.js can
// serve them as static assets.
//
// Conventions (drop-in friendly, no config needed):
//   love_girls/<女主名>/xxx.jpg   →  one folder = one heroine
//   - Folder name is used as the heroine's display name.
//   - Known folders get stable ASCII ids (see GIRL_FOLDER_TO_ID); unknown
//     ASCII folders become their lowercase name; other folders get `girl-N`.
//   - Images are copied (size-changed files only) to public/characters/<id>/NN.ext
//     and a manifest.json is written for the game to consume.
//   - Anything dropped into the folder later shows up on the next sync —
//     which runs on dev/build start AND on the fly from server code.
//
// This file is plain ESM JavaScript on purpose: it is imported both by plain
// `node` (scripts/sync-characters.mjs) and by the Next.js server bundle.

import fs from "node:fs";
import path from "node:path";

/** folder name → stable character id (must match CHARACTER_SEEDS ids). */
export const GIRL_FOLDER_TO_ID = {
  林知鸢: "zhiyuan",
  江心妍: "xinyan",
};

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/**
 * @param {{ root?: string }} [opts]
 * @returns {{ generatedAt: string, changed: boolean, girls: Array<{ id: string, name: string, cover: string, count: number, sprites: string[] }> }}
 */
export function syncLoveGirls(opts = {}) {
  const root = opts.root ?? process.cwd();
  const srcDir = path.join(root, "love_girls");
  const outDir = path.join(root, "public", "characters");
  const girls = [];

  if (fs.existsSync(srcDir)) {
    const folders = fs
      .readdirSync(srcDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();

    const usedIds = new Set();
    folders.forEach((folder, folderIdx) => {
      const files = fs
        .readdirSync(path.join(srcDir, folder))
        .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()) && !f.startsWith("."))
        .sort();
      if (files.length === 0) return;

      let id =
        GIRL_FOLDER_TO_ID[folder] ??
        (/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(folder) ? folder.toLowerCase() : `girl-${folderIdx + 1}`);
      while (usedIds.has(id)) id += "-x";
      usedIds.add(id);

      const destDir = path.join(outDir, id);
      fs.mkdirSync(destDir, { recursive: true });

      const wanted = new Set();
      const sprites = [];
      files.forEach((file, i) => {
        const ext = path.extname(file).toLowerCase();
        const name = `${String(i + 1).padStart(2, "0")}${ext}`;
        wanted.add(name);
        const src = path.join(srcDir, folder, file);
        const dest = path.join(destDir, name);
        let needCopy = true;
        try {
          needCopy = fs.statSync(src).size !== fs.statSync(dest).size;
        } catch {
          // destination missing → copy
        }
        if (needCopy) fs.copyFileSync(src, dest);
        sprites.push(`/characters/${id}/${name}`);
      });

      // Remove stale outputs (photos deleted / renumbered in love_girls).
      for (const f of fs.readdirSync(destDir)) {
        if (IMAGE_EXTS.has(path.extname(f).toLowerCase()) && !wanted.has(f)) {
          try {
            fs.rmSync(path.join(destDir, f));
          } catch {
            // best effort
          }
        }
      }

      girls.push({ id, name: folder, cover: sprites[0], count: sprites.length, sprites });
    });

    // Remove output dirs for folders that no longer exist in love_girls/.
    if (fs.existsSync(outDir)) {
      for (const entry of fs.readdirSync(outDir, { withFileTypes: true })) {
        if (entry.isDirectory() && !usedIds.has(entry.name)) {
          try {
            fs.rmSync(path.join(outDir, entry.name), { recursive: true, force: true });
          } catch {
            // best effort
          }
        }
      }
    }
  }

  const manifest = { generatedAt: new Date().toISOString(), girls };
  const json = JSON.stringify(manifest, null, 2);
  const manifestPath = path.join(outDir, "manifest.json");
  let changed = true;
  try {
    changed = fs.readFileSync(manifestPath, "utf8") !== json;
  } catch {
    // first run
  }
  if (changed) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(manifestPath, json);
  }

  return { ...manifest, changed };
}
