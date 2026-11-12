// Post-process the recording: trim the pre-roll (and the idle time after the
// last card) and overlay the separate
// browser window (HTML output) on the main timeline while it was open.
// Also removes the "cuts" (unrecorded work behind a text card).
// STORY=housing / STORY=clinical add the "-housing" / "-clinical" suffix to both names.
// EDITION=apro|viya: reads videos/timing-<edition>.json (written by demo.ts), writes videos/demo-<edition>.mp4.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const EDITION = process.env.EDITION ?? "apro";
const SUFFIX = process.env.STORY === "housing" ? "-housing" : process.env.STORY === "clinical" ? "-clinical" : "";
const OUT = `videos/demo-${EDITION}${SUFFIX}.mp4`;
const t = JSON.parse(readFileSync(`videos/timing-${EDITION}${SUFFIX}.json`, "utf8")) as {
  cuts?: { startSec: number; endSec: number }[];
  demoStartSec?: number;
  demoEndSec?: number;
  main?: string;
  popups: { startSec: number; endSec: number; video?: string }[];
};
if (!t.main || t.demoStartSec === undefined) throw new Error("timing.json has no main video / demoStartSec");

const popups = t.popups.filter((p) => p.video);
const args = ["-y", "-i", t.main];
popups.forEach((p) => args.push("-itsoffset", p.startSec.toFixed(2), "-i", p.video!));

let chain = "[0:v]setpts=PTS-STARTPTS[v0]";
popups.forEach((p, i) => {
  chain += `;[v${i}][${i + 1}:v]overlay=0:0:eof_action=pass:enable='between(t,${p.startSec.toFixed(2)},${p.endSec.toFixed(2)})'[v${i + 1}]`;
});
const end = t.demoEndSec ? `,${t.demoEndSec.toFixed(2)}` : ",1e9";
const cuts = (t.cuts ?? []).map((c) => `*not(between(t,${c.startSec.toFixed(2)},${c.endSec.toFixed(2)}))`).join("");
chain += `;[v${popups.length}]select='between(t,${t.demoStartSec.toFixed(2)}${end})${cuts}',setpts=N/FRAME_RATE/TB[out]`;

args.push("-filter_complex", chain, "-map", "[out]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-an", OUT);
console.log("ffmpeg", args.join(" "));
execFileSync("ffmpeg", args, { stdio: "inherit" });
console.log(`wrote ${OUT}`);
