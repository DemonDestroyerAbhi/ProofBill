import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };
export { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";

export type Db = PostgresJsDatabase<typeof schema>;

const g = globalThis as unknown as { __pbDb?: { db: Db; sql: postgres.Sql } };

function connectionOptions(url: string): postgres.Options<{}> {
  // Hosted Postgres (Render external, Neon, …) needs TLS; local doesn't. Allow override.
  const ssl = needsSsl(url) ? "require" : undefined;
  // Transaction-mode poolers (Neon "-pooler" hosts, PgBouncer) don't support prepared statements.
  const prepare = !/-pooler\.|pgbouncer=true/.test(url);
  return { max: Number(process.env.DATABASE_POOL ?? 10), ssl, prepare, onnotice: () => {} };
}

export function needsSsl(url: string): boolean {
  return process.env.DATABASE_SSL === "true" || /render\.com|neon\.tech|sslmode=require/.test(url);
}

/** Process-wide singleton (survives Next.js dev hot reloads). */
export function getDb(): Db {
  if (!g.__pbDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const client = postgres(url, connectionOptions(url));
    g.__pbDb = { db: drizzle(client, { schema }), sql: client };
  }
  return g.__pbDb.db;
}

export async function closeDb(): Promise<void> {
  if (g.__pbDb) {
    await g.__pbDb.sql.end({ timeout: 5 });
    g.__pbDb = undefined;
  }
}

/** Transaction handle type — same query API as Db. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
