// Recorded demo: drives Posit Workbench / Positron and records the screen.
//
//   npm run setup        # once: sync repo + recreate the sas7bdat files (not recorded)
//   npm run demo:apro    # record the Analytics Pro edition -> finalize -> videos/demo-apro.mp4
//   npm run demo:viya    # record the Viya edition          -> finalize -> videos/demo-viya.mp4
//                        # (EDITION=apro|viya npx tsx src/demo.ts records without finalizing; HEADED=1 to watch)
//
// Everything before "DEMO_START" (login, session start, folder trust) is
// pre-roll and is trimmed off again by `npm run finalize`.
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { VIEWPORT, SLOW_MO, beat } from "./config.ts";
import * as h from "./helpers.ts";
import { CARDS, CLINICAL, EDITION, HOUSING, STORY_SUFFIX, mountCard, removeCard, showCard, type Card } from "./cards.ts";
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

const t0 = Date.now();
const since = () => (Date.now() - t0) / 1000;
/** The folder Positron opens: the repo for the sas/test.sas storyline, ~/housing for the housing story. */
const WORKDIR = HOUSING ? HOUSING_DIR : undefined; // undefined = default (~/sas-demo)
const PROFILE_FILE = EDITION === "viya" ? "viya.profile" : "apro.profile";
// cuts: unrecorded work that happened behind a text card; finalize.ts removes these ranges from the video
const timing: { demoStartSec?: number; demoEndSec?: number; popups: { startSec: number; endSec: number; video?: string }[]; cuts: { startSec: number; endSec: number }[]; main?: string } = { popups: [], cuts: [] };
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
  await h.typeInTerminal(page, h.showProfileCmd(PROFILE_FILE), { wait: 6000 });
  await h.typeInTerminal(page, h.addProfileCmd(PROFILE_FILE), { wait: 3000 });
  await h.reloadSession(page);
  await h.dismissNotifications(page);
  await h.closeAllEditors(page);
  await h.startSasSession(page, "apro");
  await h.dismissNotifications(page);
  await beat(1500);
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
  await mountCard(page, CARDS.profile, { fadeIn: true });
  await page.evaluate(() => ((document.getElementById("demo-card") as HTMLElement).style.pointerEvents = "none"));
  await page.waitForTimeout(CARDS.profile.seconds * 1000);
  const cutStart = since();
  await page.locator(".monaco-workbench").waitFor({ timeout: 180_000 });
  await page.waitForTimeout(8000);
  await h.dismissNotifications(page);
  await h.prepareShell(page);
  if (HOUSING) await h.snapshotHousing(page);
  await h.installSasExtension(page);
  await h.openFolderAndTrust(page, undefined, WORKDIR); // reloads into the work folder with the extension active
  await h.prepareShell(page);
  // clinical story: DOM-rendered terminal, so the setup scripts' output can be waited for
  await h.runInTerminal(page, `cp ~/${PROFILE_FILE} $S;${CLINICAL ? ` ${h.TERMINAL_DOM_CMD};` : ""} clear`);
  await page.waitForTimeout(1500);
  await h.reloadSession(page);
  await h.dismissNotifications(page);
  await h.closeAllEditors(page);
  await h.startSasSession(page, "viya");
  await h.dismissNotifications(page);
  if (CLINICAL) await clinical.resetClinicalState(page); // clean workspace + project, scripts on the server
  await h.closeAllEditors(page);
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
  await beat(2500); // let the viewer see the code
  await page.getByRole("tab", { name: "Console", exact: true }).click();
  await waitForConsoleDone(() => h.hclick(page, page.getByRole("button", { name: "Run Selected or All SAS Code" })));
  await h.dismissNotifications(page);
  await beat(2500);
}

async function showHtmlOutput() {
  await h.hclick(page, page.getByRole("tab", { name: /^Viewer/ }));
  await beat(1500);
  // "Select where to open" opens the output in its own browser page
  const popupPromise = context.waitForEvent("page");
  const popupStart = since();
  await h.hclick(page, page.getByRole("button", { name: "Select where to open" }).first());
  const popup = await popupPromise;
  popupVideos.push(Promise.resolve(popup.video()?.path()).catch(() => undefined));
  await popup.waitForLoadState("domcontentloaded");
  await popup.bringToFront();
  await beat(2500);
  for (let i = 0; i < 14; i++) {
    await popup.mouse.wheel(0, 260);
    await popup.waitForTimeout(350);
  }
  await beat(1500);
  for (let i = 0; i < 14; i++) {
    await popup.mouse.wheel(0, -260);
    await popup.waitForTimeout(120);
  }
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
  await h.highlightRegion(page, region, 2500);
  for (let i = 0; i < 3; i++) {
    await h.hclick(page, page.getByRole("button", { name: "Show Previous Plot" }), { steps: 12 });
    await h.highlightRegion(page, region, 1800);
  }
  for (let i = 0; i < 3; i++) {
    await h.hclick(page, page.getByRole("button", { name: "Show Next Plot" }), { steps: 12 });
    await beat(900);
  }
  await beat(1000);
}

async function showConnections() {
  await h.hclick(page, page.getByRole("tab", { name: /Data Connections/ }));
  await beat(1500);
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

let consoleMarks = 0;
const consoleBefore = async () => {
  consoleMarks = (await h.consoleText(page)).split("submit-end").length;
};
/**
 * Run `trigger` and wait until SAS has finished. Analytics Pro writes a "submit-end" marker to the
 * console; the Viya console does not, so there we wait until the console output has changed and then
 * stayed quiet for a few seconds.
 */
async function waitForConsoleDone(trigger: () => Promise<void>, timeoutMs = 300_000) {
  const baseline = (await h.consoleText(page)).length;
  await consoleBefore();
  await trigger();
  const deadline = Date.now() + timeoutMs;
  if (EDITION === "viya") {
    let last = baseline;
    let quietSince = Date.now();
    for (;;) {
      const len = (await h.consoleText(page)).length;
      if (len !== last) {
        last = len;
        quietSince = Date.now();
      } else if (last !== baseline && Date.now() - quietSince > 6000) {
        break;
      }
      if (Date.now() > deadline) throw new Error("Timed out waiting for SAS (Viya)");
      await page.waitForTimeout(1000);
    }
  } else {
    while ((await h.consoleText(page)).split("submit-end").length <= consoleMarks) {
      if (Date.now() > deadline) throw new Error("Timed out waiting for SAS");
      await page.waitForTimeout(1000);
    }
  }
  await page.waitForTimeout(1500);
}

async function convertToCodeAndRun() {
  await h.hclick(page, page.getByText("Convert to Code", { exact: true }));
  await beat(3500); // read the generated code
  await h.hclick(page, page.getByRole("button", { name: "Copy Code" }));
  await beat(800);
  await page.getByRole("tab", { name: "Console", exact: true }).click();
  await h.hclick(page, page.locator(".console-input").last());
  await waitForConsoleDone(async () => {
    await page.keyboard.press("ControlOrMeta+V");
    await beat(2500); // show the pasted code
    await page.keyboard.press("Enter");
  });
  await beat(3500); // compare with Data Explorer / Viewer
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
  await beat(2500); // let the error sink in
  // The error panel offers Show Traceback / Fix / Explain
  const fix = page.getByText("Fix", { exact: true }).last();
  await h.hclick(page, fix);
  if (await page.getByText(/No model selected/).isVisible({ timeout: 4000 }).catch(() => false)) {
    await h.hclick(page, fix); // assistant was still starting up
  }
  await h.assistantFrame(page);
  await h.settleAssistant(page, { quietSec: 10, minSec: 15, maxSec: 180 });
  await beat(2500);
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
  await h.settleAssistant(page, { quietSec: 12, minSec: 20, maxSec: 240 });
  await beat(4000);
}

// ----------------------------------------------------------------- main ----

const card = (name: string, c: Card, opts?: { fadeIn?: boolean; fadeOut?: boolean }) => step(`card: ${name}`, () => showCard(page, c, opts));

let failed: unknown;
try {
  await step("pre-roll (login, session, folder)", preroll);
  // finalize.ts trims everything before this, so the video starts on the title card
  timing.demoStartSec = since();
  console.log(`DEMO_START at ${timing.demoStartSec.toFixed(1)}s`);
  await card("title", CARDS.title, { fadeIn: false });
  await card("architecture", CARDS.architecture);
  if (EDITION === "viya") {
    await card("login and OAuth integration", CARDS.signin!);
    await step("1a new session, managed credentials", () => v.openManagedCredentials(page));
    await step("1b sign in to SAS Viya CAF", signInToViya);
    await step("1c back to the session dialog", () => v.backToSessionDialog(page));
    await step("1d start Positron", () => v.launchPositronFromDialog(page));
    await step("profile (not recorded: cut out in finalize)", addProfileViya);
  } else {
    await card("profile", CARDS.profile);
    await step("profile: add apro.profile, reload, start SAS", addProfileApro);
  }
  if (CLINICAL) {
    await card("repository setup", CARDS.repoSetup);
    await step("3 set up the repository with the scripts", () => clinical.setupRepoOnCamera(page));
    await card("check out, edit, check in", CARDS.checkout);
    await step("4 check out, edit, check in test.sas", () => clinical.checkoutEditCheckin(page));
    await card("workspace data", CARDS.workspaceData);
    await step("5 copy data to the workspace, read it in SAS", () => clinical.copyDataAndExplore(page));
  } else if (HOUSING) {
    await card("explore", CARDS.explore);
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
    await card("run", CARDS.run);
    await step("1 run test.sas", runTestSas);
    await card("results", CARDS.results);
    await step("2 html output in separate window", showHtmlOutput);
    await step("3 plots in session pane", showPlots);
    await card("connections", CARDS.connections);
    await step("4 data connections", showConnections);
    await card("explorer", CARDS.explorer);
    await step("5a open data explorer", () => h.openDataExplorer(page));
    await step("5b scroll around", () => h.scrollAround(page));
    await step("5c select, sort, filter", selectSortFilter);
    await card("convert", CARDS.convert);
    await step("5d convert to code, paste, run", convertToCodeAndRun);
    await card("fix", CARDS.fix);
    await step("6 break code, fix with assistant", breakAndFix);
    await card("context", CARDS.context);
    await step("7 ask assistant about a plot", askAboutPlot);
  }
  await card("closing", CARDS.closing, { fadeOut: false });
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
