// Post-process the video 2 recording (same logic as ../finalize.ts, other paths):
// trim the pre-roll and the idle time after the last card, and overlay the
// separate browser window (SAS Logon popup) while it was open.
// Reads videos/video2/timing.json (written by demo.ts), writes videos/video2/demo2.mp4.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const DIR = "videos/video2";
const t = JSON.parse(readFileSync(`${DIR}/timing.json`, "utf8")) as {
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
chain += `;[v${popups.length}]trim=start=${t.demoStartSec.toFixed(2)}${t.demoEndSec ? `:end=${t.demoEndSec.toFixed(2)}` : ""},setpts=PTS-STARTPTS[out]`;

const out = `${DIR}/demo2.mp4`;
args.push("-filter_complex", chain, "-map", "[out]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-an", out);
console.log("ffmpeg", args.join(" "));
execFileSync("ffmpeg", args, { stdio: "inherit" });
console.log(`wrote ${out}`);
