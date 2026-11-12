// The recording's timeline: everything finalize.ts needs to edit the raw video, in seconds since the
// recording started (= seconds into the raw .webm). Shared by demo.ts and explore.ts.
//
//   cuts      unrecorded work, removed from the video
//   popups    separate browser windows, overlaid on the main video while they were open
//   cards     full-screen text cards (title, architecture, closing): shown full frame, no caption bar
//   captions  caption bar under the (scaled) screen: each entry is shown until the next one or a card
//   speed     stretches to speed up: "fast" (typing, clicking through) and "wait" (SAS, Posit Assistant,
//             session start); finalize picks the factors so the video hits its target length
import type { CaptionId } from "./cards.ts";

export interface Range {
  startSec: number;
  endSec: number;
}
export type SpeedKind = "fast" | "wait";
export interface Timing {
  demoStartSec?: number;
  demoEndSec?: number;
  main?: string;
  popups: (Range & { video?: string })[];
  cuts: Range[];
  cards: Range[];
  captions: { startSec: number; id: CaptionId }[];
  speed: (Range & { kind: SpeedKind })[];
}

export const timing: Timing = { popups: [], cuts: [], cards: [], captions: [], speed: [] };

let t0 = Date.now();
/** Call right before the recording context is created (the raw video starts there). */
export const startClock = () => {
  t0 = Date.now();
};
export const since = () => (Date.now() - t0) / 1000;

/** Switch the caption bar to `id` from now on. */
export function caption(id: CaptionId) {
  timing.captions.push({ startSec: since(), id });
  console.log(`[${since().toFixed(0)}s] caption: ${id}`);
}

/** Run `fn` and mark its time span to be sped up in the final video. */
export async function fast<T>(kind: SpeedKind, fn: () => Promise<T>): Promise<T> {
  const startSec = since();
  try {
    return await fn();
  } finally {
    timing.speed.push({ startSec, endSec: since(), kind });
  }
}
