import { execSync } from "node:child_process";
import postgres from "postgres";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://proofbill:proofbill@localhost:5432/proofbill_test";
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await sql.end();
  execSync("pnpm --filter @proofbill/db migrate", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
