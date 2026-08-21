import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// The connection pool is created lazily on first use (instead of at module
// load) so that tooling which doesn't need a live database — e.g. the
// Terminal Talk debug mode (scripts/talk.ts) or `npm run typecheck` — can
// import this module even without DATABASE_URL set. Queries against a
// missing / unreachable database fail fast, and callers that support
// offline fallbacks handle that themselves.

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

/** Returns the shared connection pool, creating it on first use. */
export function getPool(): Pool {
  if (globalForDb.__arenaNextJsPostgresqlPool) return globalForDb.__arenaNextJsPostgresqlPool;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required：请配置 .env 中的 DATABASE_URL（可用 scripts/start.sh 自动生成）",
    );
  }
  const pool = new Pool({ connectionString: databaseUrl });
  globalForDb.__arenaNextJsPostgresqlPool = pool;
  return pool;
}

/**
 * Ends the shared pool. CLI tools (Terminal Talk) call this before exiting
 * so the process never hangs on open / reconnecting connections.
 */
export async function closeDb(): Promise<void> {
  const pool = globalForDb.__arenaNextJsPostgresqlPool;
  if (!pool) return;
  delete globalForDb.__arenaNextJsPostgresqlPool;
  await pool.end();
}

type Db = ReturnType<typeof drizzle>;
let dbInstance: Db | null = null;

function getDb(): Db {
  if (!dbInstance) dbInstance = drizzle(getPool());
  return dbInstance;
}

// Lazily-initialised drop-in replacement for the previous `drizzle(pool)`
// constant: the drizzle instance (and its pool) is created on first use.
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
