import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const here = dirname(fileURLToPath(import.meta.url));
const client = postgres(url, {
  max: 1,
  ssl: process.env.DATABASE_SSL === "true" || /render\.com|neon\.tech|sslmode=require/.test(url) ? "require" : undefined,
  onnotice: () => {},
});
await migrate(drizzle(client), { migrationsFolder: join(here, "..", "migrations") });
await client.end();
console.log("migrations applied");
