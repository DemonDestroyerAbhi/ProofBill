import { closeDb } from "@proofbill/db";
import { paypalMode, workerTick } from "@proofbill/services";
import { aiEnabled } from "@proofbill/ai";

/**
 * Background worker: polls public repos for merged PRs, runs AI evidence→milestone mapping,
 * and auto-accepts milestones whose acceptance window has passed.
 */
const INTERVAL = Number(process.env.WORKER_INTERVAL_MS ?? 30_000);
let stopping = false;

async function loop() {
  console.log(`proofbill worker up · every ${INTERVAL / 1000}s · paypal=${paypalMode()} · ai=${aiEnabled() ? "claude" : "heuristic"}`);
  while (!stopping) {
    const t = Date.now();
    try {
      const r = await workerTick();
      if (r.polled || r.mapped || r.autoAccepted || r.errors.length) console.log(JSON.stringify({ at: new Date().toISOString(), ...r }));
    } catch (e) {
      console.error("tick failed", e);
    }
    await new Promise((res) => setTimeout(res, Math.max(1000, INTERVAL - (Date.now() - t))));
  }
  await closeDb();
}

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    stopping = true;
    console.log(`${sig} — finishing current tick`);
  });

void loop();
