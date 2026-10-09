import { closeDb } from "@proofbill/db";
import { runCollections } from "@proofbill/services";

/** Cron (Render, every 6h): sync open invoices from PayPal, send due reminders, assess late fees. */
const r = await runCollections();
console.log(JSON.stringify({ at: new Date().toISOString(), ...r }));
await closeDb();
process.exit(r.errors.length ? 1 : 0);
