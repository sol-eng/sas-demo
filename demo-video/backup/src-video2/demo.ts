// Recorded demo, video 2: managed credentials, a new project, a Viya session, the Clinical
// Repository and Posit Assistant. Setup, helpers and card renderer are shared with video 1
// (../helpers.ts, ../config.ts, ../cards.ts); this folder only holds the storyline.
//
//   npx tsx src/video2/demo.ts       # record (HEADED=1 to watch it)
//   npx tsx src/video2/finalize.ts   # trim + overlay -> videos/video2/demo2.mp4
//
// Everything before "DEMO_START" (see prepare.ts: login, clean server state, signed out of
// SAS Viya CAF) is pre-roll and is trimmed off again by finalize.ts, so the video starts on
// the Workbench home page.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { SLOW_MO, VIEWPORT, beat } from "../config.ts";
import * as h from "../helpers.ts";
import { CARDS, mountCard, removeCard, showCard, type Card } from "./cards.ts";
import { prepareServer } from "./prepare.ts";
import * as p from "./positron.ts";

const VIDEO_DIR = "videos/video2";
const SHOT_DIR = "screenshots/video2";
mkdirSync(VIDEO_DIR, { recursive: true });
mkdirSync(SHOT_DIR, { recursive: true });

const PROJECT_NAME = "caf-project";
const ASSISTANT_PROMPT = "Can you analyse the AE dataset and produce a few (no more than 3 plots)";

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
const timing: { demoStartSec?: number; demoEndSec?: number; popups: { startSec: number; endSec: number; video?: string }[]; main?: string } = { popups: [] };
const page = await context.newPage();
const popupVideos: Promise<string | undefined>[] = [];

async function step(name: string, fn: () => Promise<void>) {
  console.log(`[${since().toFixed(0)}s] ${name}`);
  try {
    await fn();
  } catch (e) {
    await page.screenshot({ path: `${SHOT_DIR}/fail-${name.replace(/\W+/g, "-")}.png` }).catch(() => {});
    throw e;
  }
}

// ---------------------------------------------------------------- steps ----

// 1) Login and activating OAuth integration

async function openManagedCredentials() {
  await beat(1500); // home page
  await h.hclick(page, p.newSessionButton(page));
  await page.getByRole("dialog").waitFor();
  await beat(1500);
  await h.hclick(page, p.credentialsSettings(page)); // gear next to "Session Credentials"
  await page.getByText("SAS Viya CAF", { exact: true }).first().waitFor();
  await beat(1500);
  await h.highlight(page, p.signInButton(page), 2500); // the sign-in button of the integration
}

async function signInToViya() {
  // Signing in opens SAS Logon in its own browser window; finalize.ts overlays it.
  const popupPromise = context.waitForEvent("page");
  const popupStart = since();
  await h.hclick(page, p.signInButton(page));
  const popup = await popupPromise;
  popupVideos.push(Promise.resolve(popup.video()?.path()).catch(() => undefined));
  await popup.waitForLoadState("domcontentloaded");
  await popup.bringToFront();
  await beat(2500);
  await h.hclick(popup, popup.getByRole("link", { name: "Sign in with Keycloak" }));
  await p.finishKeycloakPopup(popup, (loc, text) => loc.pressSequentially(text, { delay: 120 }));
  timing.popups.push({ startSec: popupStart, endSec: since() });
  await page.bringToFront();
  // Signed in: the row button turns blue (Sign Out).
  await p.signOutButton(page).waitFor({ timeout: 60_000 });
  await beat(3000);
}

async function backToSessionDialog() {
  await h.hclick(page, p.projectsTab(page));
  await page.getByRole("dialog").waitFor(); // the New Session dialog reappears
  await beat(2000);
  // The arrow next to "Custom OAuth Credentials" lists the integration that provides the token
  await h.hclick(page, page.getByRole("button", { name: "Expand credentials list" }));
  await beat(3500);
}

async function startPositron() {
  await h.hclick(page, page.getByRole("button", { name: "Launch" }));
  await page.locator(".monaco-workbench").waitFor({ timeout: 180_000 });
  await beat(4000); // Positron is up
}

// 2) Create new project

/** Runs behind the step 2 card: let the Welcome page settle. */
async function settleWelcome() {
  await h.dismissNotifications(page);
  await p.newMenuButton(page);
}

async function createProject() {
  const dlg = page.getByTestId("positron-modal-overlay");
  const empty = dlg.getByText("Empty Project", { exact: true });
  for (let attempt = 1; ; attempt++) {
    await h.hclick(page, await p.newMenuButton(page));
    await p.menuItem(page, /New Folder from Template/);
    if (await empty.waitFor({ timeout: 8000 }).then(() => true, () => false)) break;
    if (attempt >= 3) throw new Error("The Folder Template dialog did not open");
    await page.keyboard.press("Escape"); // close a menu that did not react, then try again
    await page.waitForTimeout(800);
  }
  await beat(1200);
  await h.hclick(page, empty);
  await beat(500);
  await h.hclick(page, dlg.getByRole("button", { name: "Next", exact: true }));
  const name = dlg.locator("input").first();
  await h.hclick(page, name);
  await name.press("ControlOrMeta+A");
  await name.pressSequentially(PROJECT_NAME, { delay: 110 });
  await beat(1500);
  await h.hclick(page, dlg.getByRole("button", { name: "Create", exact: true }));
  const current = page.getByRole("button", { name: "Current Window" });
  await current.waitFor();
  await beat(1500);
  await h.hclick(page, current);
  // The window reloads with the new folder
  await page.waitForURL(/folder=/, { timeout: 60_000 });
  await page.waitForFunction(() => (document.querySelector(".window-title")?.textContent ?? "").includes("caf-project"), null, { timeout: 120_000 });
}

// 3) Start a Viya session

/** Runs behind the step 3 card: the reloaded window may reopen editors from earlier work. */
async function settleProject() {
  await page.locator(".monaco-workbench").waitFor();
  await h.dismissNotifications(page);
  const deadline = Date.now() + 180_000;
  while (!/to quit R/.test(await h.consoleText(page))) {
    if (Date.now() > deadline) throw new Error("R console did not start");
    await page.waitForTimeout(1500);
  }
  // Editors from earlier work in caf-project are restored a few seconds after the reload (stale
  // "No active SAS session" tabs would take over later clicks on the same file): close them.
  const tabs = page.locator(".tabs-container .tab");
  for (let i = 0; i < 12 && !(await tabs.count()); i++) await page.waitForTimeout(1000);
  await p.closeAllEditors(page);
  await page.waitForTimeout(2000);
  await p.closeAllEditors(page);
  console.log("  editor tabs left:", await tabs.count());
}

/** "Viya started." is printed a little before the extension treats the session as active. */
const VIYA_ACTIVE_AFTER_MS = Number(process.env.VIYA_ACTIVE_SECONDS ?? 8) * 1000;
let viyaStartedAt = 0;

async function waitForActiveViyaSession() {
  const wait = viyaStartedAt + VIYA_ACTIVE_AFTER_MS - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
}

async function startViyaSession() {
  await h.hclick(page, page.getByRole("tab", { name: "Console", exact: true }));
  await beat(800);
  await h.hclick(page, page.getByRole("button", { name: "Select Session" }));
  await h.hclick(page, page.getByText("New Console Session...", { exact: true }).filter({ visible: true }).first());
  await h.hclick(page, page.getByText("SAS (Viya)", { exact: true }).filter({ visible: true }).first());
  const deadline = Date.now() + 180_000;
  for (;;) {
    const text = await h.consoleText(page);
    if (/Viya started\./.test(text)) break;
    // The Viya compute server sometimes times out while creating the session. A retry would
    // film the failure, so stop and let the run be repeated (the cleanup still runs).
    if (/Viya failed to start/.test(text)) throw new Error("Viya failed to start (compute server timeout) - run the demo again");
    if (Date.now() > deadline) throw new Error("Timed out waiting for the Viya session");
    await page.waitForTimeout(1000);
  }
  viyaStartedAt = Date.now();
  await beat(4000);
}

// 4) Copy some data from the Clinical Repository into the workspace

async function copyClinicalData() {
  await h.hclick(page, page.getByRole("tab", { name: "SAS", exact: true }));
  await beat(1500);
  const repo = p.sasPane(page, "Clinical Repository Section");
  for (const n of ["PositLabs", "Curanex-XR", "data", "sdtm"]) await p.expandRow(page, repo, n);
  const file = p.treeRow(repo, "ae.sas7bdat");
  await waitForActiveViyaSession(); // short grace period; the retry below covers a slower start
  // The dataset opens in the Data Explorer once the Viya session is active. If it is not yet,
  // the viewer shows "No active SAS session": close it and try again.
  for (let attempt = 1; ; attempt++) {
    await p.revealRow(page, repo, file);
    await p.stableClick(page, file, { steps: 12 });
    const opened = await page.locator(".data-grid-column-header").first().waitFor({ timeout: 30_000 }).then(() => true, () => false);
    if (opened) break;
    if (attempt >= 4) throw new Error("ae.sas7bdat did not open in the Data Explorer");
    console.log(`  attempt ${attempt}: no Data Explorer yet (Viya session not active?), retrying`);
    await page.screenshot({ path: `${SHOT_DIR}/dbg-open-attempt-${attempt}.png` });
    await page.waitForTimeout(15_000);
    await p.closeAllEditors(page);
  }
  await beat(4000);
  // The menu does not always react to the hover + Enter: repeat until Positron reports the copy.
  const copyStarted = page.getByText(/Copying to your workspace|Successfully copied/).first();
  for (let attempt = 1; ; attempt++) {
    await p.rightClick(page, file);
    await p.menuItem(page, /^Copy to Workspace$/, { enter: false });
    await p.menuItem(page, /^Copy Latest Version$/);
    if (await copyStarted.waitFor({ timeout: 10_000 }).then(() => true, () => false)) break;
    if (attempt >= 3) throw new Error("Copy to Workspace did not start");
    console.log(`  copy attempt ${attempt}: nothing happened, retrying`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  }
  await page.getByText(/Successfully copied/).first().waitFor({ timeout: 180_000 }); // can take a while
  await beat(2000);
  // the copy shows up under "Clinical Workspace", same hierarchy
  const ws = p.sasPane(page, "Clinical Workspace Section");
  for (const n of ["PositLabs", "Curanex-XR", "data", "sdtm"]) await p.expandRow(page, ws, n);
  const copy = p.treeRow(ws, "ae.sas7bdat");
  await copy.waitFor({ timeout: 30_000 });
  await h.highlight(page, copy, 2500);
  await beat(1500);
}

// 5) Get Posit Assistant to write a piece of SAS code

async function askAssistant() {
  await h.hclick(page, page.getByRole("tab", { name: /Posit Assistant/ }));
  const f = await h.assistantFrame(page);
  await beat(2500);
  await h.hclick(page, f.getByRole("button", { name: "New conversation", exact: true }));
  await beat(1200);
  await h.hclick(page, f.locator(".tiptap-input-editor"));
  await page.keyboard.type(ASSISTANT_PROMPT, { delay: 35 });
  await beat(800);
  await page.keyboard.press("Enter");
  await h.settleAssistant(page, { quietSec: 12, minSec: 20, maxSec: 300 });
  await beat(4000);
}

// ----------------------------------------------------------------- main ----

const card = (name: string, c: Card, opts?: { fadeIn?: boolean; fadeOut?: boolean }) => step(`card: ${name}`, () => showCard(page, c, opts));

/** Like card(), but does `work` behind the card (e.g. waiting for a reload), so it never shows on screen. */
const cardWhile = (name: string, c: Card, work: () => Promise<void>) =>
  step(`card: ${name}`, async () => {
    await mountCard(page, c, { fadeIn: true });
    await page.evaluate(() => ((document.getElementById("demo-card") as HTMLElement).style.pointerEvents = "none")); // work behind it can click
    await Promise.all([page.waitForTimeout(c.seconds * 1000), work()]);
    await page.evaluate(() => {
      const d = document.getElementById("demo-card");
      if (d) {
        d.style.transition = "opacity .6s ease";
        d.style.opacity = "0";
      }
    });
    await page.waitForTimeout(700);
    await removeCard(page);
  });

let failed: unknown;
try {
  await step("pre-roll (clean server state, signed out of Viya)", () => prepareServer(page, context));
  // finalize.ts trims everything before this, so the video starts on the title card
  timing.demoStartSec = since();
  console.log(`DEMO_START at ${timing.demoStartSec.toFixed(1)}s`);
  await card("title", CARDS.title, { fadeIn: false });
  await card("1 login and OAuth integration", CARDS.signin);
  await step("1a new session, managed credentials", openManagedCredentials);
  await step("1b sign in to SAS Viya CAF", signInToViya);
  await step("1c back to the session dialog", backToSessionDialog);
  await step("1d start Positron", startPositron);
  await cardWhile("2 create new project", CARDS.project, settleWelcome);
  await step("2 create caf-project", createProject);
  await cardWhile("3 start a Viya session", CARDS.viya, settleProject);
  await step("3 start the Viya session", startViyaSession);
  await card("4 clinical repository", CARDS.clinical);
  await step("4 open and copy ae.sas7bdat", copyClinicalData);
  await card("5 posit assistant", CARDS.assistant);
  await step("5 ask posit assistant", askAssistant);
  await card("closing", CARDS.closing, { fadeOut: false });
  timing.popups.forEach((q) => (q.endSec = Math.min(q.endSec, since())));
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
  const mainVideo = page.video();
  await context.close();
  timing.main = await mainVideo?.path();
  const popupPaths = await Promise.all(popupVideos);
  timing.popups.forEach((q, i) => (q.video = popupPaths[i]));
  writeFileSync(`${VIDEO_DIR}/timing.json`, JSON.stringify(timing, null, 2));
  await browser.close();
}
process.exit(failed ? 1 : 0);
