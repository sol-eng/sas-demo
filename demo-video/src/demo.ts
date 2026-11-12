// Recorded demo: drives Posit Workbench / Positron and records the screen.
//
//   npm run setup        # once: sync repo + recreate the sas7bdat files (not recorded)
//   npm run demo:apro    # record the Analytics Pro edition -> finalize -> videos/demo-apro.mp4
//   npm run demo:viya    # record the Viya edition          -> finalize -> videos/demo-viya.mp4
//                        # (EDITION=apro|viya npx tsx src/demo.ts records without finalizing; HEADED=1 to watch)
//
// Everything before "DEMO_START" (login, session start, folder trust) is
// pre-roll and is trimmed off again by `npm run finalize`.
import { chromium, type Locator, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { VIEWPORT, SLOW_MO, beat } from "./config.ts";
import * as h from "./helpers.ts";
import { CAPTION_MODE, CARDS, CLINICAL, EDITION, HOUSING, STORY_SUFFIX, mountCard, removeCard, showCard, type Card, type CaptionId } from "./cards.ts";
import { caption, fast, since, startClock, timing } from "./timeline.ts";
import { part, unzoomBox, upper, zoomAssistant, zoomOn, zoomOut, zoomPanel, zoomToBox } from "./zoom.ts";
import * as v from "./viya-login.ts";
import { explore, HOUSING_DIR } from "./explore.ts";
import * as clinical from "./clinical.ts";

const VIDEO_DIR = "videos";
mkdirSync(VIDEO_DIR, { recursive: true });
mkdirSync("screenshots", { recursive: true });

const browser = await chromium.launch({ headless: !process.env.HEADED, slowMo: process.env.HEADED ? SLOW_MO : 0 });
const context = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: VIDEO_DIR, size: VIEWPORT },
  permissions: ["clipboard-read", "clipboard-write"],
  bypassCSP: true, // lets the injected text cards load their inlined fonts and logo
});
await context.addInitScript(h.CURSOR_SCRIPT);

startClock(); // the raw video starts with the page below
/** The folder Positron opens: the repo for the sas/test.sas storyline, ~/housing for the housing story. */
const WORKDIR = HOUSING ? HOUSING_DIR : undefined; // undefined = default (~/sas-demo)
const PROFILE_FILE = EDITION === "viya" ? "viya.profile" : "apro.profile";
// timing (timeline.ts): cuts, popups, cards, captions and speed-ups for finalize.ts
const page = await context.newPage();
const popupVideos: Promise<string | undefined>[] = [];

async function step(name: string, fn: () => Promise<void>) {
  console.log(`[${since().toFixed(0)}s] ${name}`);
  try {
    await fn();
  } catch (e) {
    await page.screenshot({ path: `screenshots/fail-${name.replace(/\W+/g, "-")}.png` }).catch(() => {});
    throw e;
  }
}

// ---------------------------------------------------------------- steps ----

async function preroll() {
  if (EDITION === "viya") {
    await v.prepareViya(page); // clean sessions, signed out of SAS Viya CAF, home page
    return;
  }
  await h.login(page);
  await h.quitAllSessions(page);
  await h.startPositronSession(page);
  await h.openFolderAndTrust(page, undefined, WORKDIR);
  await h.dismissNotifications(page);
  // Prerequisites: no connection profile yet, SAS extension installed (needs a reload to activate)
  await h.prepareShell(page);
  await h.removeProfile(page);
  if (HOUSING) await h.snapshotHousing(page);
  await h.installSasExtension(page);
  await h.reloadSession(page);
  await h.closeAllEditors(page);
  await h.prepareShell(page);
  // Warm up Posit Assistant so a model is selected before "Fix" is used.
  await page.getByRole("tab", { name: /Posit Assistant/ }).click();
  await h.assistantFrame(page);
  await page.waitForTimeout(8000);
  await page.getByRole("tab", { name: /^Explorer/ }).click();
  await h.dismissNotifications(page);
}

/** Analytics Pro: show the profile, copy it into the user settings, reload and start the SAS session - all on screen. */
async function addProfileApro() {
  await h.typeInTerminal(page, h.showProfileCmd(PROFILE_FILE), { wait: 800 });
  await zoomPanel(page); // the profile, readable
  await beat(5000);
  await h.typeInTerminal(page, h.addProfileCmd(PROFILE_FILE), { wait: 2000 });
  await zoomOut(page);
  await fast("wait", async () => {
    await h.reloadSession(page);
    await h.dismissNotifications(page);
    await h.closeAllEditors(page);
  });
  caption("aproSession");
  await fast("wait", () => h.startSasSession(page, "apro"));
  await h.dismissNotifications(page);
  await zoomPanel(page, 420, "top"); // the fresh SAS console
  await beat(2500);
  await zoomOut(page);
}

// ---- Viya edition: OAuth sign-in as in the former video 2, then the profile behind a card

async function signInToViya() {
  const popupStart = since();
  await v.signInToViya(page, context, (popup) => popupVideos.push(Promise.resolve(popup.video()?.path()).catch(() => undefined)));
  timing.popups.push({ startSec: popupStart, endSec: since() });
}

/**
 * Viya: show the card, then add viya.profile to the user settings, reload into the sas-demo folder and
 * start the Viya session - not recorded: the card is put back before the work is cut out of the video.
 */
async function addProfileViya() {
  if (!CAPTION_MODE) {
    await mountCard(page, CARDS.profile, { fadeIn: true });
    await page.evaluate(() => ((document.getElementById("demo-card") as HTMLElement).style.pointerEvents = "none"));
    await page.waitForTimeout(CARDS.profile.seconds * 1000);
  }
  const cutStart = since();
  await page.locator(".monaco-workbench").waitFor({ timeout: 180_000 });
  await page.waitForTimeout(8000);
  await h.dismissNotifications(page);
  await h.prepareShell(page);
  if (HOUSING) await h.snapshotHousing(page);
  await (CLINICAL ? h.installSasExtension(page, clinical.CLINICAL_VSIX, clinical.CLINICAL_VSIX_URL) : h.installSasExtension(page));
  await h.openFolderAndTrust(page, undefined, WORKDIR); // reloads into the work folder with the extension active
  await h.prepareShell(page);
  await h.runInTerminal(page, `cp ~/${PROFILE_FILE} $S; clear`);
  await page.waitForTimeout(1500);
  await h.reloadSession(page);
  await h.dismissNotifications(page);
  await h.closeAllEditors(page);
  await h.startSasSession(page, "viya");
  await h.dismissNotifications(page);
  if (CLINICAL) await clinical.resetClinicalState(page); // clean workspace, project re-created from scratch
  await h.closeAllEditors(page);
  if (CAPTION_MODE) {
    // hard cut from the launching session to the running SAS Viya console
    await page.getByRole("tab", { name: "Console", exact: true }).click();
    await page.waitForTimeout(500);
    timing.cuts.push({ startSec: cutStart, endSec: since() });
    caption("viyaSession");
    await zoomPanel(page, 420, "top"); // the fresh SAS console
    await beat(3500);
    await zoomOut(page);
    return;
  }
  await mountCard(page, CARDS.profile, { fadeIn: false }); // the reloads removed the card: cover the cut
  await page.waitForTimeout(500);
  timing.cuts.push({ startSec: cutStart, endSec: since() });
  await page.evaluate(() => {
    const d = document.getElementById("demo-card");
    if (d) {
      d.style.transition = "opacity .6s ease";
      d.style.opacity = "0";
    }
  });
  await page.waitForTimeout(700);
  await removeCard(page);
}

async function runTestSas() {
  if (!(await page.getByText("test.sas", { exact: true }).count())) {
    await h.hclick(page, page.getByText("sas", { exact: true }).first());
  }
  await h.hclick(page, page.getByText("test.sas", { exact: true }).first(), { dbl: true });
  await page.getByRole("tab", { name: /test\.sas/ }).first().waitFor();
  await zoomOn(page, part(page, "editor"), { region: upper(560) }); // let the viewer read the code
  await beat(3000);
  await zoomOut(page);
  await page.getByRole("tab", { name: "Console", exact: true }).click();
  await fast("wait", () => waitForConsoleDone(() => h.hclick(page, page.getByRole("button", { name: "Run Selected or All SAS Code" }))));
  await h.dismissNotifications(page);
  await zoomPanel(page); // the end of the log
  await beat(3000);
  await zoomOut(page);
}

async function showHtmlOutput() {
  caption("html");
  await h.hclick(page, page.getByRole("tab", { name: /^Viewer/ }));
  await zoomOn(page, part(page, "auxiliarybar"), { region: upper(540) });
  await beat(3000);
  await zoomOut(page);
  // "Select where to open" opens the output in its own browser page
  const popupPromise = context.waitForEvent("page");
  const popupStart = since();
  await h.hclick(page, page.getByRole("button", { name: "Select where to open" }).first());
  const popup = await popupPromise;
  popupVideos.push(Promise.resolve(popup.video()?.path()).catch(() => undefined));
  await popup.waitForLoadState("domcontentloaded");
  await popup.bringToFront();
  await beat(2500);
  await fast("fast", async () => {
    for (let i = 0; i < 14; i++) {
      await popup.mouse.wheel(0, 260);
      await popup.waitForTimeout(350);
    }
    await beat(1500);
    for (let i = 0; i < 14; i++) {
      await popup.mouse.wheel(0, -260);
      await popup.waitForTimeout(120);
    }
  });
  await beat(1000);
  await popup.close();
  timing.popups.push({ startSec: popupStart, endSec: since() });
  await page.bringToFront();
  await beat(1000);
}

async function showPlots() {
  await h.hclick(page, page.getByRole("tab", { name: /^Session/ }));
  await beat(1500);
  // The plots section occupies the lower part of the session pane
  const section = await page.getByRole("button", { name: "Plots Section" }).boundingBox();
  const region = { x: (section?.x ?? 1345) + 2, y: (section?.y ?? 664) - 2, width: 570, height: 395 };
  caption("plots");
  await zoomToBox(page, unzoomBox(page, region));
  await beat(2000);
  for (let i = 0; i < 3; i++) {
    await h.hclick(page, page.getByRole("button", { name: "Show Previous Plot" }), { steps: 12 });
    await beat(1800);
  }
  for (let i = 0; i < 3; i++) {
    await h.hclick(page, page.getByRole("button", { name: "Show Next Plot" }), { steps: 12 });
    await beat(900);
  }
  await beat(1000);
  await zoomOut(page);
}

async function showConnections() {
  await h.hclick(page, page.getByRole("tab", { name: /Data Connections/ }));
  await zoomOn(page, part(page, "sidebar"), { region: upper(500), maxScale: 1.9 });
  await beat(1000);
  const sas = page.getByText(EDITION === "viya" ? "SAS (viya)" : "SAS (apro)").first();
  await h.hclick(page, sas);
  await page.keyboard.press("ArrowRight");
  await beat(1800);
  for (const lib of ["WORK", "SASHELP"]) {
    await h.hclick(page, page.getByText(lib, { exact: true }).first());
    await page.keyboard.press("ArrowRight");
    await beat(1800);
    await page.keyboard.press("ArrowLeft");
    await beat(500);
  }
  await h.hclick(page, page.getByText("DEMO", { exact: true }).first());
  await page.keyboard.press("ArrowRight");
  await beat(1500);
  await zoomOut(page);
}

const header = (name: string) => page.locator(".data-grid-column-header").filter({ hasText: name }).first();

async function selectSortFilter() {
  // select a few columns
  for (const col of ["study_id", "site_id", "unique_subject_id"]) {
    await h.hclick(page, header(col), { mod: col !== "study_id", steps: 12 });
    await page.waitForTimeout(400);
  }
  await beat(1200);
  // reveal "visit" and sort it descending
  await page.mouse.wheel(300, 0);
  await page.waitForTimeout(600);
  await h.hclick(page, header("visit").getByRole("button", { name: "Column Actions" }));
  await h.hclick(page, page.getByText("Sort Descending", { exact: true }));
  await beat(1500);
  // three filters in total
  const filters: [string, string, string][] = [
    ["age", "is greater than", "40"],
    ["outcome", "is less than", "60"],
    ["visit", "is greater than", "1"],
  ];
  for (const [col, cond, value] of filters) {
    await h.hclick(page, page.getByRole("button", { name: "Add Filter" }).first());
    await h.hclick(page, page.getByText("Select Column", { exact: true }));
    await h.hclick(page, page.locator(".column-selector").getByText(col, { exact: true }));
    await h.hclick(page, page.getByText("Select Condition", { exact: true }));
    await h.hclick(page, page.getByText(cond, { exact: true }));
    await page.locator("input[placeholder=value]").pressSequentially(value, { delay: 160 });
    await beat(400);
    await h.hclick(page, page.getByRole("button", { name: "Apply Filter" }));
    await beat(1800);
  }
  await beat(1500);
}

/** Run `trigger` and wait until SAS has finished (see helpers.waitForConsoleDone). */
const waitForConsoleDone = (trigger: () => Promise<void>, timeoutMs?: number) => h.waitForConsoleDone(page, EDITION, trigger, timeoutMs);

/** Zoom onto the area that holds all the given elements (e.g. a dialog: its title and its buttons). */
async function zoomUnion(locs: Locator[], pad = 24) {
  const boxes = (await Promise.all(locs.map((l) => l.boundingBox({ timeout: 5000 }).catch(() => null)))).filter((b) => b !== null).map((b) => unzoomBox(page, b));
  if (!boxes.length) return false;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return zoomToBox(page, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, { pad });
}

async function convertToCodeAndRun() {
  await h.hclick(page, page.getByText("Convert to Code", { exact: true }));
  const copy = page.getByRole("button", { name: "Copy Code" });
  await copy.waitFor();
  await zoomUnion([page.getByText("Select code syntax").first(), copy]); // read the generated code
  await beat(4000);
  await zoomOut(page);
  await h.hclick(page, copy);
  await beat(800);
  caption("convertRun");
  await page.getByRole("tab", { name: "Console", exact: true }).click();
  await h.hclick(page, page.locator(".console-input").last());
  await fast("wait", () =>
    waitForConsoleDone(async () => {
      await page.keyboard.press("ControlOrMeta+V");
      await beat(2500); // show the pasted code
      await page.keyboard.press("Enter");
    }),
  );
  await zoomPanel(page); // compare with Data Explorer / Viewer
  await beat(3500);
  await zoomOut(page);
}

/**
 * Posit Assistant reopens the last conversation of the account (history is kept on the server), so the
 * Fix step would continue some earlier chat. Start a fresh one, not recorded (cut out in finalize).
 */
async function freshAssistantConversation() {
  const c0 = since();
  await page.getByRole("tab", { name: /Posit Assistant/ }).click();
  const f = await h.assistantFrame(page);
  await f.getByRole("button", { name: "New conversation", exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("tab", { name: /^Explorer/ }).click();
  await page.waitForTimeout(500);
  timing.cuts.push({ startSec: c0, endSec: since() });
}

async function breakAndFix() {
  await freshAssistantConversation();
  // paste the code again and introduce a typo in the table name
  await h.hclick(page, page.locator(".console-input").last());
  await waitForConsoleDone(async () => {
    await page.keyboard.press("ControlOrMeta+V");
    await beat(1500);
    const line = page.locator(".console-input .view-line", { hasText: "LARGE_STUDY_DATA" }).last();
    const b = await line.boundingBox();
    if (!b) throw new Error("pasted code not visible");
    await page.mouse.move(b.x + b.width, b.y + b.height / 2, { steps: 15 });
    await page.mouse.click(b.x + b.width - 1, b.y + b.height / 2);
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace"); // LARGE_STUDY_DAT
    await beat(2500);
    await page.keyboard.press("Enter");
  });
  await zoomPanel(page, 420); // let the error sink in
  await beat(2500);
  // The error panel offers Show Traceback / Fix / Explain
  const fix = page.getByText("Fix", { exact: true }).last();
  await h.hclick(page, fix);
  await zoomOut(page);
  if (await page.getByText(/No model selected/).isVisible({ timeout: 4000 }).catch(() => false)) {
    await h.hclick(page, fix); // assistant was still starting up
  }
  await h.assistantFrame(page);
  await zoomAssistant(page);
  await fast("wait", () => h.settleAssistant(page, { quietSec: 10, minSec: 15, maxSec: 180, zoom: true }));
  await zoomAssistant(page); // again, in case a tool approval zoomed out
  await beat(3000);
}

async function askAboutPlot() {
  const f = await h.assistantFrame(page);
  await h.hclick(page, f.locator(".tiptap-input-editor"));
  await page.keyboard.type(
    "Explain the Residuals vs Predicted Values plot that test.sas created. Does the model fit look good?",
    { delay: 35 },
  );
  await beat(800);
  await page.keyboard.press("Enter");
  await zoomAssistant(page);
  await fast("wait", () => h.settleAssistant(page, { quietSec: 12, minSec: 20, maxSec: 240, zoom: true }));
  await zoomAssistant(page);
  await beat(4500);
  await zoomOut(page);
}

// ----------------------------------------------------------------- main ----

const card = (name: string, c: Card, opts?: { fadeIn?: boolean; fadeOut?: boolean }) => step(`card: ${name}`, () => showCard(page, c, opts));

/**
 * Caption mode: a full-screen card (title, architecture, closing) without fades - the final video cuts between
 * the full-frame card and the framed screen. The card's time span is logged for finalize.ts.
 */
async function fullCard(name: string, c: Card, opts: { last?: boolean } = {}) {
  await step(`card: ${name}`, async () => {
    await mountCard(page, c, { fadeIn: false });
    const startSec = since();
    if (timing.cards.length === 0) timing.demoStartSec = startSec; // the video starts on the title card
    await page.waitForTimeout(c.seconds * 1000);
    timing.cards.push({ startSec, endSec: since() });
    if (!opts.last) await removeCard(page);
  });
}

/** Start of a story section: a caption (caption mode) or a full-screen step card (clinical story). */
const chapter = (name: string, c: Card, id: CaptionId) => (CAPTION_MODE ? (caption(id), Promise.resolve()) : card(name, c));

let failed: unknown;
try {
  await step("pre-roll (login, session, folder)", preroll);
  // finalize.ts trims everything before this, so the video starts on the title card (caption mode: set by fullCard)
  timing.demoStartSec = since();
  console.log(`DEMO_START at ${timing.demoStartSec.toFixed(1)}s`);
  if (CAPTION_MODE) {
    await fullCard("title", CARDS.title);
    await fullCard("architecture", CARDS.architecture);
  } else {
    await card("title", CARDS.title, { fadeIn: false });
    await card("architecture", CARDS.architecture);
  }
  if (EDITION === "viya") {
    await chapter("login and OAuth integration", CARDS.signin!, "signin");
    await fast("fast", () => step("1a new session, managed credentials", () => v.openManagedCredentials(page)));
    await fast("fast", () => step("1b sign in to SAS Viya CAF", signInToViya));
    await fast("fast", () => step("1c back to the session dialog", () => v.backToSessionDialog(page)));
    await fast("wait", () => step("1d start Positron", () => v.launchPositronFromDialog(page)));
    await step("profile (not recorded: cut out in finalize)", addProfileViya);
  } else {
    await chapter("profile", CARDS.profile, "profile");
    await step("profile: add apro.profile, reload, start SAS", addProfileApro);
  }
  if (CLINICAL) {
    // the clinical steps set their own captions
    if (!CAPTION_MODE) await card("check out and get the data", CARDS.checkoutData);
    await step("2 check out test.sas, copy the data to the workspace", () => clinical.checkoutAndCopyData(page));
    if (!CAPTION_MODE) await card("run in SAS Viya", CARDS.runViya);
    await step("3 run test.sas on SAS Viya", () => clinical.runOnViya(page));
    if (!CAPTION_MODE) await card("change and check in", CARDS.changeCheckin);
    await step("4 add a step, run it, check in", () => clinical.changeAndCheckIn(page));
    if (!CAPTION_MODE) await card("run from the repository", CARDS.repoRun);
    await step("5 run from the repository, manifest report", () => clinical.runFromRepository(page));
  } else if (HOUSING) {
    if (!CAPTION_MODE) await card("explore", CARDS.explore); // explore() sets its own captions
    // hard cap for the whole chapter (analysis + /report + render); a stuck run fails, cleans up and is retried
    const capMin = Number(process.env.EXPLORE_TIMEOUT_MIN ?? 20);
    let capTimer: NodeJS.Timeout | undefined;
    await step("explore housing data, /report, Quarto preview", () =>
      Promise.race([
        explore(page, context, { since, popups: timing.popups, popupVideos, cuts: timing.cuts }),
        new Promise<never>((_, reject) => {
          capTimer = setTimeout(() => reject(new Error(`exploratory-analysis step exceeded ${capMin} minutes`)), capMin * 60_000);
        }),
      ]).finally(() => clearTimeout(capTimer)),
    );
  } else {
    await chapter("run", CARDS.run, "run");
    await step("1 run test.sas", runTestSas);
    if (!CAPTION_MODE) await card("results", CARDS.results); // showHtmlOutput sets the caption
    await step("2 html output in separate window", showHtmlOutput);
    await step("3 plots in session pane", showPlots);
    await chapter("connections", CARDS.connections, "connections");
    await step("4 data connections", showConnections);
    await chapter("explorer", CARDS.explorer, "explorer");
    await step("5a open data explorer", () => h.openDataExplorer(page));
    await fast("fast", () => step("5b scroll around", () => h.scrollAround(page)));
    await zoomOn(page, part(page, "editor"), { region: (b) => ({ x: b.x, y: b.y, width: Math.min(b.width, 900), height: Math.min(b.height, 500) }) });
    await beat(3000); // column profiles
    await zoomOut(page);
    if (CAPTION_MODE) caption("filter");
    await fast("fast", () => step("5c select, sort, filter", selectSortFilter));
    await chapter("convert", CARDS.convert, "convert");
    await step("5d convert to code, paste, run", convertToCodeAndRun);
    await chapter("fix", CARDS.fix, "fix");
    await step("6 break code, fix with assistant", breakAndFix);
    await chapter("context", CARDS.context, "context");
    await step("7 ask assistant about a plot", askAboutPlot);
  }
  await zoomOut(page);
  if (CAPTION_MODE) await fullCard("closing", CARDS.closing, { last: true });
  else await card("closing", CARDS.closing, { fadeOut: false });
  timing.popups.forEach((p) => (p.endSec = Math.min(p.endSec, since())));
  timing.demoEndSec = since(); // finalize.ts trims the idle cleanup time after this
  console.log(`DEMO_END at ${since().toFixed(1)}s`);
} catch (e) {
  failed = e;
  console.error("DEMO FAILED:", String(e).split("\n").slice(0, 8).join("\n"));
} finally {
  // Always clean up the session, even when the demo failed.
  try {
    const cleanup = await context.newPage();
    await h.login(cleanup);
    await h.quitAllSessions(cleanup);
    await cleanup.close();
  } catch (e) {
    console.error("CLEANUP FAILED - quit sessions manually (npm run cleanup):", String(e).split("\n")[0]);
  }
  // Remove the connection profile again (settings.json), unrecorded
  try {
    const cleanup = await context.newPage();
    await h.cleanupProfile(cleanup);
    await cleanup.close();
  } catch (e) {
    console.error("PROFILE CLEANUP FAILED:", String(e).split("\n")[0]);
  }
  const mainVideo = page.video();
  await context.close();
  timing.main = await mainVideo?.path();
  const popupPaths = await Promise.all(popupVideos);
  timing.popups.forEach((p, i) => (p.video = popupPaths[i]));
  writeFileSync(`${VIDEO_DIR}/timing-${EDITION}${STORY_SUFFIX}.json`, JSON.stringify(timing, null, 2));
  await browser.close();
}
process.exit(failed ? 1 : 0);
