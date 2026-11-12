// Record one edition until a run succeeds, then finalize it.
//   EDITION=apro npx tsx src/record.ts     (npm run demo:apro | demo:viya)
// Starting the Viya session from the automation fails now and then ("Connection timed out"); a retry
// inside the recording would film the failure, so the whole run is repeated instead (each run cleans
// up after itself and the next pre-roll resets the state). RECORD_ATTEMPTS=n changes the limit.
import { spawnSync } from "node:child_process";

const attempts = Number(process.env.RECORD_ATTEMPTS ?? 3);
for (let i = 1; i <= attempts; i++) {
  console.log(`\n=== ${process.env.EDITION ?? "apro"}: recording attempt ${i} of ${attempts} ===`);
  const r = spawnSync("npx", ["tsx", "src/demo.ts"], { stdio: "inherit" });
  if (r.status === 0) {
    const f = spawnSync("npx", ["tsx", "src/finalize.ts"], { stdio: "inherit" });
    process.exit(f.status ?? 1);
  }
}
console.error(`no successful recording in ${attempts} attempts`);
process.exit(1);
