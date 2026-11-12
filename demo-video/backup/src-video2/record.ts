// Record video 2 until a run succeeds, then finalize it.
//   npx tsx src/video2/record.ts          # up to 4 attempts (RECORD_ATTEMPTS=n to change)
// Starting the Viya session from the automation fails now and then ("Connection timed out");
// a retry inside the recording would film the failure, so the whole run is repeated instead
// (each failed run cleans up its sessions and the next pre-roll resets the server state).
import { spawnSync } from "node:child_process";

const attempts = Number(process.env.RECORD_ATTEMPTS ?? 4);
for (let i = 1; i <= attempts; i++) {
  console.log(`\n=== recording attempt ${i} of ${attempts} ===`);
  const r = spawnSync("npx", ["tsx", "src/video2/demo.ts"], { stdio: "inherit" });
  if (r.status === 0) {
    const f = spawnSync("npx", ["tsx", "src/video2/finalize.ts"], { stdio: "inherit" });
    process.exit(f.status ?? 1);
  }
}
console.error(`no successful recording in ${attempts} attempts`);
process.exit(1);
