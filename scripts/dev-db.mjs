#!/usr/bin/env node
// Local development database: an embedded PostgreSQL (no system install
// needed) stored in .pgdata/ next to the repo, matching the credentials in
// drizzle.config.json (postgres/postgres @ 127.0.0.1:5432, database app_db).
//
//   node scripts/dev-db.mjs          # initialise (if needed) and keep running
//
// Stop with Ctrl+C; data persists in .pgdata/ between runs.
// Requires: npm i -D embedded-postgres   (already in devDependencies)

import path from "node:path";
import { existsSync } from "node:fs";

const DATA_DIR = path.resolve(process.cwd(), ".pgdata");
const DB_NAME = "app_db";

let EmbeddedPostgres;
try {
  ({ default: EmbeddedPostgres } = await import("embedded-postgres"));
} catch {
  console.error("[dev-db] 缺少 embedded-postgres，请先运行: npm install");
  process.exit(1);
}

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "postgres",
  password: "postgres",
  port: 5432,
  persistent: true, // keep running after this script exits? no — we await forever below
});

if (!existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
  console.log("[dev-db] 初始化数据库到 .pgdata/ ...");
  await pg.initialise();
}

await pg.start();
console.log("[dev-db] PostgreSQL 已启动: postgresql://postgres:postgres@127.0.0.1:5432/" + DB_NAME);

try {
  await pg.createDatabase(DB_NAME);
  console.log(`[dev-db] 已创建数据库 ${DB_NAME}`);
} catch {
  console.log(`[dev-db] 数据库 ${DB_NAME} 已存在`);
}

console.log("[dev-db] 保持运行中（Ctrl+C 停止）…");
setInterval(() => {}, 1 << 30);
