// Exploratory-analysis chapter of the v2 videos (shared by demo.ts and probe-explore.ts):
//   1. new Posit Assistant conversation: explain housing/ahs2023n.sas7bdat, up to 3 plots on a few key variables
//   2. /report -> the assistant proposes an outline (plain-text question) -> we approve -> Quarto document appears
//   3. Preview -> the rendered report opens in the Viewer -> open it in its own browser window and scroll through it
import type { BrowserContext, Page } from "playwright";
import { beat } from "./config.ts";
import * as h from "./helpers.ts";
import { caption, fast } from "./timeline.ts";
import { part, upper, zoomAssistant, zoomOn, zoomOut } from "./zoom.ts";

/** The folder opened as the workspace for this chapter: it holds the dataset, and the report and saspy config are written there. */
export const HOUSING_DIR = "/home/demouser/housing";
export const EXPLORE_PROMPT =
  "Briefly explain the SAS dataset ahs2023n.sas7bdat in this folder. " +
  "It has over 3,000 variables, so do not list them all: restrict yourself to a few key variables " +
  "(for example household income, home value, number of rooms) and produce up to 3 meaningful plots " +
  "that help explain some trends in the data.";
export const APPROVE_REPLY = "Yes, the outline looks good. Please go ahead and generate the report.";

export interface ExploreHooks {
  /** screenshot/log hook used by the probe */
  shot?: (name: string) => Promise<void>;
  /** seconds since the recording started (to place the popup overlay) */
  since?: () => number;
  /** timing.cuts of demo.ts: idle render time that finalize removes */
  cuts?: { startSec: number; endSec: number }[];
  /** timing.popups of demo.ts */
  popups?: { startSec: number; endSec: number; video?: string }[];
  /** collects the popup's video path promises (demo.ts) */
  popupVideos?: Promise<string | undefined>[];
}

/** The assistant's own wording when the report file is written (tool line, progress line or summary). */
const REPORT_WRITTEN = /write:\s*\S+\.qmd|Writing Quarto report to\s+\S+\.qmd[\s.]*done|(I wrote|Source:)\s*\S*\.qmd/i;
const reportWritten = async (f: Awaited<ReturnType<typeof h.assistantFrame>>) => REPORT_WRITTEN.test(await f.locator("body").innerText().catch(() => ""));

/** Open the written report: click its name in the chat (the element type varies), else double-click it in the Explorer. */
async function openReport(page: Page) {
  const f = await h.assistantFrame(page);
  const candidates = [
    f.locator("a").filter({ hasText: /\.qmd/ }),
    f.getByRole("link", { name: /\.qmd/ }),
    f.getByText(/[\w.-]+\.qmd/).filter({ visible: true }),
  ];
  for (const c of candidates) {
    if (!(await c.count().catch(() => 0))) continue;
    await h.hclick(page, c.last());
    if (await qmdTab(page).first().waitFor({ timeout: 8000 }).then(() => true, () => false)) return;
  }
  // fall back to the Explorer (the report is in the opened folder)
  await h.hclick(page, page.getByRole("tab", { name: /^Explorer/ }));
  const file = page.getByText(/\.qmd$/).filter({ visible: true }).last();
  if (await file.count()) await h.hclick(page, file, { dbl: true });
}
const qmdTab = (page: Page) => page.getByRole("tab", { name: /\.qmd/ });

async function typeInAssistant(page: Page, text: string, delay = 25) {
  const f = await h.assistantFrame(page);
  await h.hclick(page, f.locator(".tiptap-input-editor"));
  await page.keyboard.type(text, { delay });
}

export async function explore(page: Page, context: BrowserContext, hooks: ExploreHooks = {}) {
  const shot = hooks.shot ?? (async (n: string) => { await page.screenshot({ path: `screenshots/explore-${n}.png` }).catch(() => {}); });
  // 1 --- new conversation, analysis
  // Open the Assistant view only if it is not showing: clicking the tab of the view that is already
  // open would collapse the side bar.
  const newChat = (fr: Awaited<ReturnType<typeof h.assistantFrame>>) => fr.getByRole("button", { name: "New conversation", exact: true });
  let f = await h.assistantFrame(page, 2000).catch(() => undefined); // not open yet: do not wait (a frozen screen)
  if (!f || !(await newChat(f).isVisible().catch(() => false))) {
    await h.hclick(page, page.getByRole("tab", { name: /Posit Assistant/ }));
    f = await h.assistantFrame(page);
  }
  caption("explain");
  await h.hclick(page, f.getByRole("button", { name: "New conversation", exact: true }));
  await beat(1500);
  await fast("fast", () => typeInAssistant(page, EXPLORE_PROMPT));
  await beat(800);
  await page.keyboard.press("Enter");
  await zoomAssistant(page);
  await fast("wait", () => h.settleAssistant(page, { quietSec: 20, minSec: 30, maxSec: 720, zoom: true }));
  await shot("e1-analysis-done");
  await zoomAssistant(page);
  await beat(4000); // read the summary
  await zoomOut(page);
  caption("housingPlots");
  await zoomOn(page, part(page, "auxiliarybar"), { region: upper(560) }); // the SAS output and plots in the Viewer
  await beat(4500);
  await zoomOut(page);

  // 2 --- /report, approve the outline, wait for the .qmd
  caption("report");
  await typeInAssistant(page, "/report", 80);
  await beat(1200);
  await page.keyboard.press("Enter");
  let approved = false;
  for (let round = 0; round < 6; round++) {
    await zoomAssistant(page);
    await fast("wait", () => h.settleAssistant(page, { quietSec: 20, minSec: 20, maxSec: 900, zoom: true }));
    await shot(`e2-report-round-${round}`);
    if (await qmdTab(page).count()) break;
    // The current extension writes (and renders) the report itself and links the .qmd in the chat; the file
    // may be outside the workspace, in which case no editor tab opens by itself.
    if (approved && (await reportWritten(await h.assistantFrame(page)))) break;
    // the assistant asks for approval in plain text (or with a panel: submit it if there is one)
    const ff = await h.assistantFrame(page);
    const submit = ff.getByRole("button", { name: /Submit Answers|Accept|Continue/ });
    if (await submit.count()) {
      // "Approve report outline" panel: pick "Yes, generate it" first, otherwise Submit Answers stays disabled
      await beat(2500); // let the viewer read the outline
      // option wording differs between extension versions: "Yes, generate it" / "Approve outline" (not the panel title "Approve report outline")
      const yes = ff.getByText(/^(Yes\b|Approve outline)/i).first();
      if (await yes.count()) {
        await h.hclick(page, yes);
        await beat(800);
      }
      await h.hclick(page, submit.first());
      approved = true;
    } else {
      await beat(2500); // let the viewer read the outline
      await typeInAssistant(page, APPROVE_REPLY, 30);
      await beat(600);
      await page.keyboard.press("Enter");
      approved = true;
    }
  }
  if (!(await qmdTab(page).count())) {
    // open the report from the link in the chat
    await beat(2500);
    await openReport(page);
  }
  await fast("wait", async () => {
    await qmdTab(page).first().waitFor({ timeout: 60_000 });
    await h.settleAssistant(page, { quietSec: 15, minSec: 10, maxSec: 300 });
  });
  await shot("e3-qmd-open");
  // The generated SAS chunk headers are not always valid for Quarto (no blank line after "#| label:"), so
  // have the assistant render the report and fix errors before Preview. Use its own follow-up offer when
  // it shows one, otherwise ask for it.
  const ff2 = await h.assistantFrame(page);
  const chatText = await ff2.locator("body").innerText().catch(() => "");
  const alreadyRendered = /renders? cleanly|rendered (successfully|without)|Rendered HTML|Output created/i.test(chatText);
  console.log("report already rendered by the assistant:", alreadyRendered);
  if (!alreadyRendered) {
    caption("render");
    const renderChip = ff2.getByText(/Render .*(check that it runs|fix any errors)/i).last();
    await beat(2500);
    if (await renderChip.count()) {
      await h.hclick(page, renderChip);
    } else {
      await typeInAssistant(page, "Please render the report and fix any errors.", 30);
      await beat(600);
      await page.keyboard.press("Enter");
    }
    await zoomAssistant(page);
    const w0 = hooks.since?.() ?? 0;
    await fast("wait", () => h.settleAssistant(page, { quietSec: 25, minSec: 30, maxSec: 720, zoom: true }));
    const w1 = hooks.since?.() ?? 0;
    if (hooks.cuts && w1 - w0 > 60) hooks.cuts.push({ startSec: w0 + 25, endSec: w1 - 4 }); // keep the start and the end of the wait
    await shot("e3b-render-checked");
    await beat(2500);
  }
  await zoomOut(page);
  caption("preview");
  await h.hclick(page, qmdTab(page).first());
  await zoomOn(page, part(page, "editor"), { region: upper(560) }); // show the document
  await beat(4000);
  await zoomOut(page);

  // 3 --- Preview
  const actions = await page.locator(".editor-actions .action-label, .editor-actions a, .editor-actions button").evaluateAll((n) => n.map((e) => (e.getAttribute("aria-label") ?? e.getAttribute("title") ?? e.textContent ?? "").trim()).filter(Boolean)).catch(() => []);
  console.log("editor actions:", JSON.stringify(actions));
  const preview = page.getByRole("button", { name: /^Preview/ }).or(page.locator('.editor-actions [aria-label^="Preview"]')).first();
  await h.hclick(page, preview);
  await shot("e4-preview-clicked");
  // rendering reruns the SAS code in a new session: wait until the Viewer shows the report
  const rendered = await fast("wait", () => waitForReport(page, shot, hooks.since, hooks.cuts));
  if (!rendered) throw new Error("Quarto preview did not finish rendering within 8 minutes");
  console.log("report rendered:", rendered);
  await beat(3000);

  // 4 --- standalone window, scroll through code chunks and plots
  await showReportWindow(page, context, hooks);
}

/**
 * True once the Viewer shows the rendered report. Rendering starts a new SAS session and reads the
 * 1.4 GB dataset, so it can take many minutes; the Viewer keeps showing the earlier "SAS Output"
 * until the preview is ready, so the title changing away from that is the completion signal.
 */
async function waitForReport(page: Page, shot: (n: string) => Promise<void>, since?: () => number, cuts?: { startSec: number; endSec: number }[]): Promise<boolean> {
  const start = Date.now();
  const startSec = since?.() ?? 0;
  let i = 0;
  let done = false;
  while ((Date.now() - start) / 1000 < 480) {
    await page.waitForTimeout(5000);
    if (i++ % 12 === 0) await shot(`e4-preview-wait-${i}`);
    if (!(await page.getByText("SAS Output", { exact: true }).count())) {
      done = true;
      break;
    }
  }
  // keep ~12 s of the render running and the last 2 s before the report shows up, cut the idle time in between
  const endSec = since?.() ?? 0;
  if (cuts && endSec - startSec > 25) cuts.push({ startSec: startSec + 12, endSec: endSec - 2 });
  await shot("e4-preview-done");
  return done;
}

/** Smooth scroll down the standalone report page, pausing where there are code chunks and images. */
async function scrollThrough(popup: Page) {
  const total = await popup.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  const stepPx = 260;
  const steps = Math.min(Math.ceil(total / stepPx), 120);
  for (let i = 0; i < steps; i++) {
    await popup.mouse.wheel(0, stepPx);
    await popup.waitForTimeout(380);
    if (i % 8 === 7) await popup.waitForTimeout(1500); // linger so the viewer can read
  }
}

/**
 * Open the rendered report (shown in the Viewer) in its own browser window and scroll through it; falls back
 * to scrolling inside the maximized Viewer if no window opens. Shared by explore() and probe-quarto.ts.
 */
export async function showReportWindow(page: Page, context: BrowserContext, hooks: ExploreHooks = {}) {
  const shot = hooks.shot ?? (async (n: string) => { await page.screenshot({ path: `screenshots/explore-${n}.png` }).catch(() => {}); });
  // The rendered report is shown in the Viewer's web view; the icon at the right end of its address bar
  // ("open in new window") has no accessible name, so it is clicked by position (the layout is fixed at
  // 1920x1080). Log what sits there, for diagnosis.
  const OPEN_ICON = { x: 1892, y: 141 };
  const atPoint = await page
    .evaluate(({ x, y }) => {
      const e = document.elementFromPoint(x, y);
      return e ? `${e.tagName} class="${e.getAttribute("class") ?? ""}" aria-label="${e.getAttribute("aria-label") ?? ""}" title="${e.getAttribute("title") ?? ""}"` : "none";
    }, OPEN_ICON)
    .catch(() => "n/a");
  console.log("element at open icon position:", atPoint);
  await shot("e5-before-open");
  const openBtn = null as ReturnType<Page["locator"]> | null;
  const popupStart = hooks.since?.() ?? 0;
  let popup: Page | undefined;
  try {
    const popupPromise = context.waitForEvent("page", { timeout: 20_000 });
    popupPromise.catch(() => {}); // never leave it unhandled
    if (openBtn) {
      await h.hclick(page, openBtn);
    } else {
      await page.mouse.move(OPEN_ICON.x, OPEN_ICON.y, { steps: 15 });
      await page.waitForTimeout(600);
      await page.mouse.click(OPEN_ICON.x, OPEN_ICON.y);
    }
    // the button may open a menu instead of the page itself
    const menuItem = page.getByText(/Open in (the )?(default |external )?(web )?browser|Open in (a )?new (browser )?window|new browser window/i).filter({ visible: true }).first();
    if (await menuItem.isVisible({ timeout: 2500 }).catch(() => false)) await h.hclick(page, menuItem);
    popup = await popupPromise;
  } catch (e) {
    console.log("standalone window did not open:", String(e).split("\n")[0]);
    await shot("e5-no-popup");
  }
  if (popup) {
    caption("reportWindow");
    if (hooks.popupVideos) hooks.popupVideos.push(Promise.resolve(popup.video()?.path()).catch(() => undefined));
    await popup.waitForLoadState("domcontentloaded");
    await popup.bringToFront();
    await beat(3000);
    await shot("e5-popup-top");
    await fast("fast", () => scrollThrough(popup!));
    await beat(1500);
    await popup.close();
    hooks.popups?.push({ startSec: popupStart, endSec: hooks.since?.() ?? 0 });
    await page.bringToFront();
  } else {
    // Fallback: scroll the report inside the maximized Viewer so the run still yields a usable video.
    console.log("fallback: scrolling the report in the Viewer pane");
    caption("reportWindow");
    const max = page.getByRole("button", { name: /Maximize/i }).first();
    if (await max.isVisible({ timeout: 2000 }).catch(() => false)) await h.hclick(page, max);
    await beat(2000);
    await page.mouse.move(1500, 600);
    for (let i = 0; i < 70; i++) {
      await page.mouse.wheel(0, 260);
      await page.waitForTimeout(380);
      if (i % 8 === 7) await page.waitForTimeout(1500);
    }
    await shot("e5-fallback-scrolled");
  }
  await beat(1500);
}
