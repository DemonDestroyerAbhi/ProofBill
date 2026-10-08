import { closeDb } from "@proofbill/db";
import { getOrCreateDemoUser, seedDemoWorkspace } from "../src";

const user = await getOrCreateDemoUser();
const id = await seedDemoWorkspace(user.id, { reset: process.argv.includes("--reset") });
console.log(`Seeded demo contract ${id} for ${user.login}`);
await closeDb();
