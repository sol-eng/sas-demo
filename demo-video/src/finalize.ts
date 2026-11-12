// Post-process the recording into videos/demo-<edition><story>.mp4, from videos/timing-<edition><story>.json
// (written by demo.ts). STORY=housing / STORY=clinical add the "-housing" / "-clinical" suffix to both names.
//
// Always: trim the pre-roll and the idle time after the closing card, overlay the separate browser windows
// (popups) while they were open, and remove the "cuts" (unrecorded work).
//
// Caption mode (timing has captions; all stories), in addition:
//   - speed-ups: the "fast" and "wait" stretches get the smallest factors (from 1.5x, 2x, 3x, ...) that bring the
//     video down to TARGET_SEC (default 180 s, housing 300 s, clinical 280 s); SPEED_FAST / SPEED_WAIT force factors.
//     A badge ("3x") shows while a stretch plays faster.
//   - layout: the screen is scaled into LAYOUT.screen with the caption bar beneath it; the title, architecture
//     and closing cards stay full frame.
//   - music: assets/music.mp3 (or .m4a/.wav, or MUSIC=path) is looped, leveled and faded under the video; the
//     credit line (MUSIC_CREDIT or assets/music-credit.txt) is shown on the closing card.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { CAPTIONS, CLINICAL, EDITION, HOUSING, LAYOUT, STORY_SUFFIX, overlayHtml } from "./cards.ts";
import type { Range, SpeedKind, Timing } from "./timeline.ts";

const NAME = `${EDITION}${STORY_SUFFIX}`;
// TIMING / OUT override the file names (tests on old recordings)
const OUT = process.env.OUT ?? `videos/demo-${NAME}.mp4`;
const FPS = 25;
const t = JSON.parse(readFileSync(process.env.TIMING ?? `videos/timing-${NAME}.json`, "utf8")) as Partial<Timing> & { popups: Timing["popups"] };
if (!t.main || t.demoStartSec === undefined) throw new Error("timing.json has no main video / demoStartSec");
const popups = t.popups.filter((p) => p.video);
const f3 = (n: number) => n.toFixed(3);

function popupInputs(args: string[]) {
  args.push("-i", t.main!);
  popups.forEach((p) => args.push("-itsoffset", p.startSec.toFixed(2), "-i", p.video!));
  let chain = "[0:v]setpts=PTS-STARTPTS[v0]";
  popups.forEach((p, i) => {
    chain += `;[v${i}][${i + 1}:v]overlay=0:0:eof_action=pass:enable='between(t,${p.startSec.toFixed(2)},${p.endSec.toFixed(2)})'[v${i + 1}]`;
  });
  return { chain, last: `v${popups.length}`, next: popups.length + 1 };
}

function ffmpeg(args: string[]) {
  console.log("ffmpeg", args.join(" ").slice(0, 600));
  execFileSync("ffmpeg", args, { stdio: "inherit" });
}

// ------------------------------------------------------------------ legacy ----

function legacy() {
  const args = ["-y"];
  const { chain: c0, last } = popupInputs(args);
  const end = t.demoEndSec ? `,${t.demoEndSec.toFixed(2)}` : ",1e9";
  const cuts = (t.cuts ?? []).map((c) => `*not(between(t,${c.startSec.toFixed(2)},${c.endSec.toFixed(2)}))`).join("");
  const chain = `${c0};[${last}]select='between(t,${t.demoStartSec!.toFixed(2)}${end})${cuts}',setpts=N/FRAME_RATE/TB[out]`;
  args.push("-filter_complex", chain, "-map", "[out]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-an", OUT);
  ffmpeg(args);
}

// ---------------------------------------------------------------- captions ----

interface Piece extends Range {
  kind: SpeedKind | "none";
  f: number;
  o: number; // output time of startSec
}
const RANK = { none: 0, fast: 1, wait: 2 } as const;

/** [start, end] minus the cuts, split at every speed-range edge, each piece tagged with its strongest speed kind. */
function pieces(start: number, end: number, cuts: Range[], speed: Timing["speed"]): Piece[] {
  let kept: Range[] = [{ startSec: start, endSec: end }];
  for (const c of cuts) {
    kept = kept.flatMap((k) =>
      c.endSec <= k.startSec || c.startSec >= k.endSec
        ? [k]
        : [
            ...(c.startSec > k.startSec ? [{ startSec: k.startSec, endSec: c.startSec }] : []),
            ...(c.endSec < k.endSec ? [{ startSec: c.endSec, endSec: k.endSec }] : []),
          ],
    );
  }
  const edges = speed.flatMap((s) => [s.startSec, s.endSec]);
  const out: Piece[] = [];
  for (const k of kept) {
    const cutsAt = [k.startSec, ...edges.filter((e) => e > k.startSec && e < k.endSec).sort((a, b) => a - b), k.endSec];
    for (let i = 0; i + 1 < cutsAt.length; i++) {
      const a = cutsAt[i];
      const b = cutsAt[i + 1];
      if (b - a < 0.02) continue;
      const mid = (a + b) / 2;
      let kind: Piece["kind"] = "none";
      for (const s of speed) if (s.startSec <= mid && mid < s.endSec && RANK[s.kind] > RANK[kind]) kind = s.kind;
      out.push({ startSec: a, endSec: b, kind, f: 1, o: 0 });
    }
  }
  return out;
}

const NICE = [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20];

/** Smallest factors (fast first, then wait >= fast) that bring the video down to the target length. */
function chooseFactors(ps: Piece[], target: number) {
  const d = { none: 0, fast: 0, wait: 0 };
  for (const p of ps) d[p.kind] += p.endSec - p.startSec;
  const total = (ff: number, fw: number) => d.none + d.fast / ff + d.wait / fw;
  const forced = { fast: Number(process.env.SPEED_FAST) || undefined, wait: Number(process.env.SPEED_WAIT) || undefined };
  let pick: [number, number] | undefined;
  search: for (const fwMax of [12, 20]) {
    for (const ff of forced.fast ? [forced.fast] : [1.5, 2, 3, 4]) {
      for (const fw of forced.wait ? [forced.wait] : NICE.filter((f) => f >= ff && f <= fwMax)) {
        if (total(ff, fw) <= target) {
          pick = [ff, fw];
          break search;
        }
      }
    }
  }
  if (!pick) {
    pick = [forced.fast ?? 4, forced.wait ?? 20];
    console.warn(`target ${target}s not reachable with speed-ups alone`);
  }
  console.log(
    `real time: ${d.none.toFixed(0)}s, fast: ${d.fast.toFixed(0)}s, wait: ${d.wait.toFixed(0)}s -> factors fast ${pick[0]}x, wait ${pick[1]}x, ` +
      `length ${total(...pick).toFixed(0)}s (target ${target}s)`,
  );
  return { fast: pick[0], wait: pick[1] };
}

async function renderOverlays(dir: string, items: { file: string; html: string; width: number; height: number; css?: string }[]) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const it of items) {
    await page.setViewportSize({ width: it.width, height: it.height });
    await page.setContent(it.html);
    if (it.css) await page.addStyleTag({ content: it.css });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${dir}/${it.file}`, omitBackground: true });
  }
  await browser.close();
}

/** An image track (concat demuxer) that shows `events[i].file` from events[i].t until the next event. */
function imageTrack(dir: string, name: string, events: { t: number; file: string }[], total: number) {
  const ev = events.filter((e, i) => i === 0 || e.t > events[i - 1].t + 0.001 || e.file !== events[i - 1].file).sort((a, b) => a.t - b.t);
  const lines = ["ffconcat version 1.0"];
  ev.forEach((e, i) => {
    const until = i + 1 < ev.length ? ev[i + 1].t : total;
    if (until - e.t < 0.001) return;
    lines.push(`file '${resolve(dir, e.file)}'`, `duration ${f3(until - e.t)}`);
  });
  lines.push(`file '${resolve(dir, ev[ev.length - 1].file)}'`); // the concat demuxer needs the last file twice
  const list = `${dir}/${name}.ffconcat`;
  writeFileSync(list, lines.join("\n") + "\n");
  return list;
}

async function captioned() {
  const start = t.demoStartSec!;
  const end = t.demoEndSec ?? 1e9;
  const ps = pieces(start, end, t.cuts ?? [], t.speed ?? []);
  const target = Number(process.env.TARGET_SEC ?? (HOUSING ? 300 : CLINICAL ? 280 : 180));
  const fac = chooseFactors(ps, target);
  let o = 0;
  for (const p of ps) {
    p.f = p.kind === "none" ? 1 : fac[p.kind];
    p.o = o;
    o += (p.endSec - p.startSec) / p.f;
  }
  const total = o;
  /** raw time -> output time (times inside a cut map to where the cut was) */
  const map = (raw: number) => {
    for (const p of ps) {
      if (raw < p.startSec) return p.o;
      if (raw < p.endSec) return p.o + (raw - p.startSec) / p.f;
    }
    return total;
  };

  // overlay images
  const dir = `videos/overlays-${NAME}`;
  mkdirSync(dir, { recursive: true });
  const usedCaptions = [...new Set((t.captions ?? []).map((c) => c.id))];
  const factors = [...new Set(ps.map((p) => p.f).filter((f) => f > 1))];
  const creditFile = "assets/music-credit.txt";
  const credit = process.env.MUSIC_CREDIT ?? (existsSync(creditFile) ? readFileSync(creditFile, "utf8").trim() : "");
  const music = process.env.MUSIC ?? ["assets/music.mp3", "assets/music.m4a", "assets/music.wav"].find((f) => existsSync(f));
  const band = { width: 1920, height: LAYOUT.band.height };
  const badge = { width: 200, height: 60, css: "body{display:flex;justify-content:flex-end;align-items:flex-start}" };
  await renderOverlays(dir, [
    { file: "cap-blank.png", html: overlayHtml({ blank: true }), ...band },
    ...usedCaptions.map((id) => ({ file: `cap-${id}.png`, html: overlayHtml({ caption: CAPTIONS[id] }), ...band })),
    { file: "badge-none.png", html: "<!doctype html><html><body style='margin:0;background:transparent'></body></html>", ...badge },
    ...factors.map((f) => ({ file: `badge-${f}.png`, html: overlayHtml({ speed: f }), ...badge })),
    ...(credit ? [{ file: "credit.png", html: overlayHtml({ credit }), width: 1400, height: 40 }] : []),
  ]);

  // caption track: blank before the first caption and while a full-screen card is up
  const cards = (t.cards ?? []).map((c) => ({ s: map(c.startSec), e: map(c.endSec) }));
  const capEvents = [{ t: 0, file: "cap-blank.png" }];
  const sortedCaps = [...(t.captions ?? [])].sort((a, b) => a.startSec - b.startSec);
  for (const c of sortedCaps) capEvents.push({ t: map(c.startSec), file: `cap-${c.id}.png` });
  for (const c of cards) {
    // after a card, the caption that was current continues
    const current = sortedCaps.filter((x) => map(x.startSec) <= c.e).pop();
    capEvents.push({ t: c.s, file: "cap-blank.png" }, { t: c.e, file: current ? `cap-${current.id}.png` : "cap-blank.png" });
  }
  capEvents.sort((a, b) => a.t - b.t);

  // badge track: merged stretches with the same factor, at least 1 s long in the output
  const badgeEvents = [{ t: 0, file: "badge-none.png" }];
  for (let i = 0; i < ps.length; ) {
    let j = i;
    while (j + 1 < ps.length && ps[j + 1].f === ps[i].f && Math.abs(ps[j + 1].startSec - ps[j].endSec) < 0.05) j++;
    const s = ps[i].o;
    const e = ps[j].o + (ps[j].endSec - ps[j].startSec) / ps[j].f;
    if (ps[i].f > 1 && e - s >= 1) badgeEvents.push({ t: s, file: `badge-${ps[i].f}.png` }, { t: e, file: "badge-none.png" });
    i = j + 1;
  }
  badgeEvents.sort((a, b) => a.t - b.t);

  const args = ["-y"];
  const { chain: c0, last, next } = popupInputs(args);
  const capIdx = next;
  const badgeIdx = next + 1;
  args.push("-f", "concat", "-safe", "0", "-i", imageTrack(dir, "captions", capEvents, total));
  args.push("-f", "concat", "-safe", "0", "-i", imageTrack(dir, "badges", badgeEvents, total));
  let idx = next + 2;
  const creditIdx = credit ? idx++ : -1;
  if (credit) args.push("-i", `${dir}/credit.png`);
  const musicIdx = music ? idx++ : -1;
  if (music) args.push("-stream_loop", "-1", "-i", music);

  const sel = ps.map((p) => `gte(t,${f3(p.startSec)})*lt(t,${f3(p.endSec)})`).join("+");
  const pts = ps.map((p) => `gte(T,${f3(p.startSec)})*lt(T,${f3(p.endSec)})*(${f3(p.o)}+(T-${f3(p.startSec)})/${p.f})`).join("+");
  const { screen } = LAYOUT;
  const cardsOn = cards.length ? cards.map((c) => `between(t,${f3(c.s)},${f3(c.e)})`).join("+") : "0";
  const closing = cards[cards.length - 1];
  let g = c0;
  g += `;[${last}]select='${sel}',setpts='(${pts})/TB',fps=${FPS},split[full][sc]`;
  g += `;[sc]scale=${screen.width}:${screen.height}:flags=lanczos,pad=1920:1080:${screen.x}:${screen.y}:color=${LAYOUT.bg.replace("#", "0x")}[pad]`;
  g += `;[${capIdx}:v]fps=${FPS},format=rgba[cap];[pad][cap]overlay=0:${LAYOUT.band.y}[l1]`;
  g += `;[${badgeIdx}:v]fps=${FPS},format=rgba[bdg];[l1][bdg]overlay=${screen.x + screen.width - badge.width - 16}:${screen.y + 16}[l2]`;
  g += `;[l2][full]overlay=0:0:enable='${cardsOn}'[l3]`;
  if (credit && closing) g += `;[${creditIdx}:v]format=rgba[cr];[l3][cr]overlay=180:1010:enable='between(t,${f3(closing.s)},${f3(closing.e + 1)})'[vout]`;
  else g += ";[l3]null[vout]";
  if (music) {
    const fadeOut = Math.max(0, total - 3);
    g += `;[${musicIdx}:a]atrim=0:${f3(total)},asetpts=PTS-STARTPTS,loudnorm=I=-26:TP=-2:LRA=7,afade=t=in:st=0:d=1.5,afade=t=out:st=${f3(fadeOut)}:d=3[aout]`;
  }
  const graph = `${dir}/filter.txt`;
  writeFileSync(graph, g);
  args.push("-/filter_complex", graph, "-map", "[vout]");
  if (music) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "160k");
  else args.push("-an");
  args.push("-t", f3(total), "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", OUT);
  console.log(`music: ${music ?? "none (put assets/music.mp3 in place to add it)"}${credit ? `, credit: ${credit}` : ""}`);
  ffmpeg(args);
}

if (t.captions?.length) await captioned();
else legacy();
console.log(`wrote ${OUT}`);
