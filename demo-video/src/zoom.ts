// Live zoom: scale the Positron UI (.monaco-workbench) with a CSS transform while recording, so a region
// fills the screen and its text is re-rendered sharply (instead of upscaling pixels in post).
//
// Clicks on elements of the top frame keep working while zoomed (bounding boxes include the transform),
// but hit-testing inside iframes (Posit Assistant, Viewer) does not: helpers.hclick zooms out first for
// those. Monaco text areas are not clicked while zoomed either; the scripts zoom out before that.
import type { Locator, Page } from "playwright";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface State {
  s: number;
  tx: number;
  ty: number;
}
const W = 1920;
const H = 1080;
const IDENTITY: State = { s: 1, tx: 0, ty: 0 };
const state = new WeakMap<Page, State>();
/** Posit Assistant chat column per page (see assistantColumn). */
const assistantCache = new WeakMap<Page, Box>();
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const isZoomed = (page: Page) => (state.get(page) ?? IDENTITY).s !== 1;

/** A reload re-creates the workbench (without the transform). */
export const forgetZoom = (page: Page) => {
  state.delete(page);
  assistantCache.delete(page);
};

/** Box measured on screen (possibly while zoomed) -> unzoomed page coordinates. */
export function unzoomBox(page: Page, b: Box): Box {
  const st = state.get(page) ?? IDENTITY;
  return { x: (b.x - st.tx) / st.s, y: (b.y - st.ty) / st.s, width: b.width / st.s, height: b.height / st.s };
}

async function apply(page: Page, st: State, ms: number) {
  await page.evaluate(
    ({ s, tx, ty, ms }) => {
      const w = document.querySelector(".monaco-workbench") as HTMLElement | null;
      if (!w) return;
      // The scaled workbench overflows its ancestors; focusing an off-screen element would scroll them (overflow:
      // hidden still scrolls programmatically) and shift the picture. overflow: clip cannot scroll at all.
      for (let a = w.parentElement; a; a = a.parentElement) {
        a.style.overflow = "clip";
        a.scrollTop = a.scrollLeft = 0;
      }
      w.style.transformOrigin = "0 0";
      w.style.transition = `transform ${ms}ms cubic-bezier(.4,0,.2,1)`;
      w.style.transform = s === 1 ? "" : `translate(${tx}px, ${ty}px) scale(${s})`;
    },
    { ...st, ms },
  );
  state.set(page, st);
  await page.waitForTimeout(ms + 150);
}

/** Zoom so the box (unzoomed page coordinates) fills the screen, up to `maxScale`. False if not worth it. */
export async function zoomToBox(page: Page, b: Box, opts: { maxScale?: number; pad?: number; ms?: number } = {}) {
  const { maxScale = 2, pad = 12, ms = 700 } = opts;
  const x0 = clamp(b.x - pad, 0, W);
  const y0 = clamp(b.y - pad, 0, H);
  const x1 = clamp(b.x + b.width + pad, 0, W);
  const y1 = clamp(b.y + b.height + pad, 0, H);
  if (x1 - x0 < 50 || y1 - y0 < 50) return false;
  const s = Math.min(maxScale, W / (x1 - x0), H / (y1 - y0));
  if (s < 1.15) return false;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const tx = clamp(W / 2 - s * cx, W - s * W, 0);
  const ty = clamp(H / 2 - s * cy, H - s * H, 0);
  await apply(page, { s, tx, ty }, ms);
  return true;
}

/**
 * Zoom onto a locator's element; `region` narrows its box (unzoomed coordinates), e.g. to the lower part of
 * a tall side bar. Never throws: a missing element just means no zoom (logged).
 */
export async function zoomOn(page: Page, loc: Locator, opts: { region?: (b: Box) => Box; maxScale?: number; pad?: number; ms?: number } = {}) {
  try {
    const bb = await loc.boundingBox({ timeout: 5000 });
    if (!bb) throw new Error("no bounding box");
    const b = unzoomBox(page, bb);
    const ok = await zoomToBox(page, opts.region ? opts.region(b) : b, opts);
    if (!ok) console.log(`zoom skipped (region too large): ${loc}`);
    return ok;
  } catch (e) {
    console.log(`zoom skipped: ${loc}: ${String(e).split("\n")[0]}`);
    return false;
  }
}

export async function zoomOut(page: Page, ms = 600) {
  if (!isZoomed(page)) return;
  await apply(page, IDENTITY, ms);
}

/** Workbench parts: "sidebar" (Explorer, Data Connections, Posit Assistant), "panel" (Console, Terminal), "auxiliarybar" (Session, Viewer, Plots), "editor". */
export const part = (page: Page, name: "sidebar" | "panel" | "auxiliarybar" | "editor") =>
  page.locator(`.part.${name}`).filter({ visible: true }).first();

/** The lower part of a tall pane (where a chat or a log grows), `height` px high. */
export const lower = (height: number) => (b: Box): Box => ({ x: b.x, y: b.y + Math.max(0, b.height - height), width: b.width, height: Math.min(b.height, height) });
/** The upper part of a pane, `height` px high. */
export const upper = (height: number) => (b: Box): Box => ({ ...b, height: Math.min(b.height, height) });

/** The bottom-left part of a pane (where console output and the input line are), at most `width` x `height`. */
export const lowerLeft = (width: number, height: number) => (b: Box): Box => ({
  x: b.x,
  y: b.y + Math.max(0, b.height - height),
  width: Math.min(b.width, width),
  height: Math.min(b.height, height),
});
/**
 * Zoom onto the Console / Terminal: the panel spans nearly the full width, so take its bottom-left part (newest
 * output), or its top-left part for a console that has just started (its few lines are at the top).
 */
export const zoomPanel = (page: Page, height = 520, from: "bottom" | "top" = "bottom") =>
  zoomOn(page, part(page, "panel"), { region: from === "top" ? (b) => ({ x: b.x, y: b.y, width: Math.min(b.width, 1100), height: Math.min(b.height, height) }) : lowerLeft(1100, height) });

/**
 * The Posit Assistant chat column, in unzoomed page coordinates: derived from its input box (Playwright reports
 * boxes of elements inside nested frames in top-level coordinates). Measured only while unzoomed (inside iframes
 * the transform is not accounted for) and remembered per page for re-zooms.
 */
async function assistantColumn(page: Page): Promise<Box | null> {
  // The chat column does not move during a story; re-measuring while a tool-approval panel is open can hit
  // another editor, so the first measurement wins (a reload forgets it, see forgetZoom).
  const cached = assistantCache.get(page);
  if (cached || isZoomed(page)) return cached ?? null;
  let best: Box | null = null;
  const seen: string[] = [];
  for (const f of page.frames()) {
    const input = f.locator(".tiptap-input-editor").first();
    if (!(await input.count().catch(() => 0))) continue;
    const b = await input.boundingBox().catch(() => null);
    seen.push(JSON.stringify(b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }));
    if (!b || b.width < 50 || b.x < 0 || b.y < 0 || b.x + b.width > W + 1 || b.y + b.height > H + 1) continue; // hidden webviews are parked off screen
    if (!best || b.width > best.width) best = b;
  }
  if (!best) {
    console.log(`Posit Assistant inputs seen: ${seen.join(" ") || "none"}`);
    return null;
  }
  const bottom = Math.min(H, best.y + best.height + 40);
  const col = { x: Math.max(0, best.x - 20), y: Math.max(0, bottom - 560), width: best.width + 40, height: Math.min(560, bottom) };
  assistantCache.set(page, col);
  return col;
}

/** Zoom onto the newest part of the Posit Assistant chat (the column above its input box, input included). */
export async function zoomAssistant(page: Page) {
  const col = await assistantColumn(page);
  if (!col) {
    console.log("zoom skipped: Posit Assistant input not found on screen");
    return false;
  }
  const ok = await zoomToBox(page, col, { maxScale: 1.9, pad: 0 });
  if (!ok) console.log(`zoom skipped (region too large): Posit Assistant column ${JSON.stringify(col)}`);
  return ok;
}
