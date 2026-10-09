import { closeDb } from "@proofbill/db";
import { createDemoUser, seedDemoWorkspace } from "../src";

const user = await createDemoUser();
const id = await seedDemoWorkspace(user.id, { reset: process.argv.includes("--reset") });
console.log(`Seeded demo contract ${id} for ${user.login}`);
await closeDb();
