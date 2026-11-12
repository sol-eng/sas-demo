// Clinical Acceleration story (STORY=clinical, Viya only).
//
// Unrecorded preparation (`resetClinicalState`, in the profile cut once the demouser session runs):
//   - in demouser's Clinical Workspace: undo a check-out a failed run may have left and delete the
//     workspace copy of /PositDemo/SAS-Demo (the server refuses to delete a project with checked-out files,
//     and only the owner can undo a check-out);
//   - locally (this machine, viya_admin from ../scripts/env.sh): permanently delete the project and create it
//     again with the repository scripts (setup_repo.sh, setup_users.sh, verify_setup.sh). The password and
//     tokens never leave this machine.
// Recorded (a programmer's round trip): check out test.sas and copy the study data to the workspace, run the
// program on SAS Viya (it reads the data from /clinical/workspaces), add a PROC MEANS step and run it, then
// check the program in as a new version. Chapter 05: run it as a clinical job, Run and Populate (the job
// declares its input data), add outputs/ as check-in location, check the job in, run it from the repository
// and show the manifest report (versions of program, input and output). Needs extension 0.6.0-dev.22+.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { Frame, Locator, Page } from "playwright";
import { beat } from "./config.ts";
import * as h from "./helpers.ts";
import { caption, fast } from "./timeline.ts";
import { part, unzoomBox, upper, zoomOn, zoomOut, zoomPanel, zoomToBox } from "./zoom.ts";

const REPO_ROOT = new URL("../../", import.meta.url).pathname; // the sas-demo checkout on this machine
const SCRIPTS = join(REPO_ROOT, "scripts");
const PROJECT = "/PositDemo/SAS-Demo";
const PROGRAM = `${PROJECT}/programs/test.sas`;
const DATASET = `${PROJECT}/data/sdtm/large_study_data.sas7bdat`;
const JOB = `${PROJECT}/programs/test.cjob`;
const OUTPUTS = `${PROJECT}/outputs`;

/** The clinical story needs the clinical jobs features (Run and Populate, Test: 0.6.0-dev.22+). */
export const CLINICAL_VSIX = "positron-sas-0.6.0-dev.23.vsix";
export const CLINICAL_VSIX_URL =
  "https://github.com/posit-dev/positron-sas-extension/releases/download/v0.6.0-dev.23/positron-sas-0.6.0-dev.23.vsix";

// ------------------------------------------------------------ UI parts ----

/** The Clinical Acceleration activity-bar entry (its icon has no accessible name). */
const clinicalIcon = (page: Page) => page.locator(".activitybar .action-label[class*=sas-clinical-view-container]");
/** A view of the Clinical Acceleration container, by its header title. */
const pane = (page: Page, title: string) =>
  page.locator(".pane").filter({ has: page.locator(".pane-header", { hasText: new RegExp(`^${title}`, "i") }) }).first();
const repoPane = (page: Page) => pane(page, "Clinical Repository");
const wsPane = (page: Page) => pane(page, "Clinical Workspace");
const historyPane = (page: Page) => pane(page, "Clinical Version History");
const jobsPane = (page: Page) => pane(page, "Clinical Jobs");
const schedulesPane = (page: Page) => pane(page, "Clinical Job Schedules");
/** Tree items carry the repository path as their accessible name. */
const item = (p: ReturnType<typeof pane>, path: string) => p.getByRole("treeitem", { name: path, exact: true });
const menuItem = (page: Page, label: RegExp) => page.locator(".monaco-menu [role=menuitem]", { hasText: label }).first();
const toast = (page: Page, text: RegExp) => page.locator(".notifications-toasts .notification-list-item-message", { hasText: text }).first();

async function openClinicalView(page: Page, show = false) {
  if (show) await zoomOut(page);
  const icon = clinicalIcon(page);
  // clicking the entry of the view that is already open would collapse the side bar
  if (await repoPane(page).isVisible().catch(() => false)) return;
  if (show) await h.hclick(page, icon);
  else await icon.click();
  await repoPane(page).waitFor({ timeout: 30_000 });
}

/** Click the Refresh action in a view's header (only visible while hovering the header). */
async function refreshPane(page: Page, p: ReturnType<typeof pane>, show = false) {
  await p.locator(".pane-header").hover();
  const refresh = p.locator(".pane-header .action-label[aria-label^=Refresh]");
  if (show) await h.hclick(page, refresh);
  else await refresh.click();
  await page.waitForTimeout(2500);
}

/** Expand the folders along `paths` (in order), clicking only those that are still collapsed. */
async function expand(page: Page, p: ReturnType<typeof pane>, paths: string[], show = true) {
  for (const path of paths) {
    const it = item(p, path);
    await it.waitFor({ timeout: 30_000 });
    if ((await it.getAttribute("aria-expanded")) === "true") continue;
    if (show) await h.hclick(page, it, { steps: 12 });
    else await it.click();
    await page.waitForTimeout(show ? 1200 : 800);
  }
}

/** Right-click `it`, then pick `entry` (or `entry` > `sub` for a submenu). */
async function contextMenu(page: Page, it: ReturnType<Page["locator"]>, entry: RegExp, sub?: RegExp) {
  await zoomOut(page); // menus are laid out in unscaled page coordinates: open them unzoomed
  await h.hclick(page, it, { right: true });
  await page.waitForTimeout(1000); // the menu takes no clicks while it is still animating in
  if (sub) {
    const parent = menuItem(page, entry);
    const b = await parent.boundingBox();
    if (!b) throw new Error(`context menu entry ${entry} not visible`);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await page.waitForTimeout(900);
    await h.hclick(page, menuItem(page, sub), { steps: 12 });
  } else {
    await h.hclick(page, menuItem(page, entry), { steps: 12 });
  }
}

/** Unrecorded variant of `contextMenu`: the menu needs a moment to settle before an entry takes a click. */
async function quietMenu(page: Page, it: ReturnType<Page["locator"]>, entry: RegExp) {
  await page.keyboard.press("Escape");
  await it.click({ button: "right" });
  await page.waitForTimeout(1000);
  await menuItem(page, entry).click();
  await page.locator(".monaco-menu").first().waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
}

// ------------------------------------------------------- local (admin) ----

/** Run a bash snippet in the local repo root with scripts/env.sh (viya_admin) sourced; returns stdout. */
function localAdmin(snippet: string) {
  return execFileSync("bash", ["-c", `set -euo pipefail; source scripts/env.sh; ${snippet}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

/**
 * Local: permanently delete the demo project (the server cannot move projects to the trash) and create it again
 * with the repository scripts in ../scripts (data ./large_study_data.sas7bdat, starter program ./sas/test.sas).
 */
export function recreateRepositoryLocally() {
  localAdmin(`${SCRIPTS}/teardown_repo.sh --yes`);
  const left = localAdmin(`source ${SCRIPTS}/lib.sh; item_by_path '${PROJECT}'`).trim();
  if (left) throw new Error(`${PROJECT} still exists after teardown_repo.sh`);
  localAdmin(`${SCRIPTS}/setup_repo.sh >&2 && ${SCRIPTS}/setup_users.sh >&2`);
  const verify = localAdmin(`${SCRIPTS}/verify_setup.sh || true`);
  if (!/All checks passed\./.test(verify)) throw new Error(`verify_setup.sh failed:\n${verify.split("\n").filter((l) => /FAIL|error/i.test(l)).join("\n")}`);
}

// ------------------------------------------------------------ unrecorded ----

/**
 * Unrecorded: start from a clean workspace and a freshly created project (see the header comment). Runs in the
 * profile cut, with the SAS (Viya) session up. Leaves the Explorer side bar open, as the other stories expect.
 */
export async function resetClinicalState(page: Page) {
  await openClinicalView(page);
  const ws = wsPane(page);
  await refreshPane(page, ws);
  // the project row only exists once its organization is expanded (a fresh session shows the tree collapsed)
  if (await item(ws, "/PositDemo").count()) await expand(page, ws, ["/PositDemo"], false);
  await page.waitForTimeout(1500);
  const root = item(ws, PROJECT);
  if (await root.count()) {
    // undo a check-out left by a failed run ("not checked out by you" is reported as an error toast; harmless)
    await quietMenu(page, root, /^Undo Check out$/);
    await page.waitForTimeout(4000);
    await quietMenu(page, root, /^Delete$/);
    await page.locator(".monaco-dialog-box").getByRole("button", { name: "Delete", exact: true }).click();
    await toast(page, /Deleted the selected item/).waitFor({ timeout: 300_000 }); // large copies take minutes
  }
  recreateRepositoryLocally();
  await refreshPane(page, repoPane(page));
  await refreshPane(page, ws);
  // chapter 05 starts with an empty Clinical Jobs list (hidden in Positron only, the server keeps the runs)
  const jobs = jobsPane(page);
  await jobs.locator(".pane-header").hover();
  await jobs.locator(".pane-header .action-label[aria-label^='Clear Finished Runs']").click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // schedules are not used: collapse that view so Workspace and Jobs get the room
  const schedHeader = schedulesPane(page).locator(".pane-header");
  if ((await schedHeader.getAttribute("aria-expanded").catch(() => null)) === "true") await schedHeader.click();
  await page.getByRole("button", { name: "Clear All Notifications" }).click({ timeout: 1000 }).catch(() => {});
  await h.dismissNotifications(page);
  await page.getByRole("tab", { name: /^Explorer/ }).click();
  await page.waitForTimeout(500);
}

// ------------------------------------------------------------- recorded ----

/** Move to and click a rendered line inside the visible part of the active editor. */
async function clickVisibleEditorLine(page: Page) {
  const scroller = page.locator(".part.editor .monaco-editor .monaco-scrollable-element.editor-scrollable").filter({ visible: true }).first();
  const area = await scroller.boundingBox();
  if (!area) throw new Error("no visible editor");
  const lines = page.locator(".part.editor .monaco-editor .view-line").filter({ visible: true });
  for (let i = 0; i < (await lines.count()); i++) {
    const b = await lines.nth(i).boundingBox();
    if (b && b.y > area.y + 20 && b.y + b.height < area.y + area.height - 20) {
      const x = Math.min(area.x + 300, area.x + area.width / 2);
      await page.mouse.move(x, b.y + b.height / 2, { steps: 20 });
      await page.waitForTimeout(300);
      await page.mouse.click(x, b.y + b.height / 2);
      return;
    }
  }
  throw new Error("no editor line inside the visible editor area");
}

/** A rendered editor line by its text. */
const editorLine = (page: Page, text: string | RegExp) => page.locator(".part.editor .monaco-editor .view-line", { hasText: text }).first();

/** Zoom onto the editor around the text cursor (the lines being typed), `above` px above it and `below` px below. */
async function zoomOnCursor(page: Page, above = 300, below = 220) {
  const ed = await part(page, "editor").boundingBox();
  const cur = await page.locator(".part.editor .monaco-editor .cursor").filter({ visible: true }).first().boundingBox().catch(() => null);
  if (!ed || !cur) return zoomOn(page, part(page, "editor"), { region: upper(520) });
  const e = unzoomBox(page, ed);
  const c = unzoomBox(page, cur);
  const y0 = Math.max(e.y, c.y - above);
  const y1 = Math.min(e.y + e.height, c.y + below);
  return zoomToBox(page, { x: e.x, y: y0, width: Math.min(e.width, 1000), height: y1 - y0 });
}

/** Zoom onto the sidebar from the top of `from` down to the bottom of `to` (at most `maxHeight` px). */
async function zoomSidebar(page: Page, from: Locator, to: Locator = from, maxHeight = 640) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) return false;
  const ua = unzoomBox(page, a);
  const ub = unzoomBox(page, b);
  const y1 = Math.min(ub.y + ub.height, ua.y + maxHeight);
  return zoomToBox(page, { x: ua.x, y: ua.y, width: ua.width, height: y1 - ua.y }, { pad: 4 });
}

/**
 * Click "Run Selected or All SAS Code". From 0.6.0 a Clinical Workspace program's run button is a split button
 * whose main action may be "Run as Clinical Job"; the SAS run is then an entry of its "Run or Debug..." dropdown.
 */
async function clickRunSas(page: Page) {
  const direct = page.getByRole("button", { name: "Run Selected or All SAS Code" }).filter({ visible: true }).first();
  if (await direct.isVisible().catch(() => false)) return h.hclick(page, direct);
  await h.hclick(page, page.getByRole("button", { name: "Run or Debug..." }).filter({ visible: true }).first());
  await page.waitForTimeout(900);
  await h.hclick(page, page.locator(".action-menu-item", { hasText: /^Run Selected or All SAS Code/ }).first());
}

/** Run the selection (or the whole file) on SAS and wait (sped up) until SAS is done. */
async function runSas(page: Page) {
  await zoomOut(page);
  await page.getByRole("tab", { name: "Console", exact: true }).click();
  await fast("wait", () => h.waitForConsoleDone(page, "viya", () => clickRunSas(page)));
  await h.dismissNotifications(page);
}

/** The Viewer (ODS HTML output), zoomed. */
async function showViewer(page: Page, read: number) {
  await h.hclick(page, page.getByRole("tab", { name: /^Viewer/ }));
  await beat(800);
  await zoomOn(page, part(page, "auxiliarybar"), { region: upper(540) });
  await beat(read);
  await zoomOut(page);
}

/** The lines added to test.sas in the recording (the editor indents the statements itself). */
const EDIT_LINES = [
  "",
  "",
  "/* Summary of the outcome by treatment group */",
  "proc means data=demo.large_study_data n mean std maxdec=2;",
  "class treatment_group;",
  "var outcome;",
  "run;",
];

/** Recorded, chapter 02: check out test.sas and copy the study data to the workspace (runbook steps 1 and 2). */
export async function checkoutAndCopyData(page: Page) {
  caption("clinicalView");
  await openClinicalView(page, true);
  await beat(1200);
  const repo = repoPane(page);
  await fast("fast", async () => {
    await refreshPane(page, repo, true);
    await expand(page, repo, ["/PositDemo", PROJECT, `${PROJECT}/programs`]);
  });
  await zoomSidebar(page, repo, repo, 420); // the project in the repository tree
  await beat(3000);
  // check out the program
  caption("checkout");
  await contextMenu(page, item(repo, PROGRAM), /^Check out to Workspace/, /^With Content$/);
  await fast("wait", () => toast(page, /Successfully checked out/).waitFor({ timeout: 60_000 }));
  await beat(1500);
  // copy the study data
  caption("copyData");
  await fast("fast", () => expand(page, repo, [`${PROJECT}/data`, `${PROJECT}/data/sdtm`]));
  await beat(800);
  await contextMenu(page, item(repo, DATASET), /^Copy to Workspace/, /^Copy Latest Version$/);
  await fast("wait", () => toast(page, /Successfully copied/).waitFor({ timeout: 120_000 }));
  await beat(1200);
  // both in the workspace
  const ws = wsPane(page);
  await fast("fast", async () => {
    await refreshPane(page, ws, true);
    await expand(page, ws, ["/PositDemo", PROJECT, `${PROJECT}/programs`, `${PROJECT}/data`, `${PROJECT}/data/sdtm`]);
  });
  await item(ws, DATASET).waitFor({ timeout: 30_000 });
  await zoomSidebar(page, ws, ws, 420);
  await beat(3000);
  await zoomOut(page);
}

/** Recorded, chapter 03: open the workspace copy, show where it reads the data, run it on SAS Viya. */
export async function runOnViya(page: Page) {
  caption("libname");
  const ws = wsPane(page);
  await h.hclick(page, item(ws, PROGRAM), { dbl: true });
  await page.locator(".tabs-container .tab", { hasText: "test.sas" }).first().waitFor({ timeout: 30_000 });
  await beat(1000);
  // Click one visible line of the editor (not `.view-lines`: that layer is as tall as the whole file, so its
  // center can fall below the editor into the panel), then go to the top: Positron may restore a scrolled editor.
  await clickVisibleEditorLine(page);
  await page.keyboard.press("ControlOrMeta+ArrowUp"); // top of the file (Cmd+Up on macOS)
  const libname = editorLine(page, "libname demo &repo_path;");
  await libname.waitFor({ timeout: 10_000 });
  const ed = await part(page, "editor").boundingBox();
  const lb = await libname.boundingBox();
  if (ed && lb) await zoomToBox(page, { x: ed.x, y: ed.y, width: Math.min(ed.width, 1000), height: lb.y + lb.height + 30 - ed.y });
  const repoPath = editorLine(page, "%let repo_path=");
  const a = await repoPath.boundingBox();
  const b = await libname.boundingBox();
  if (a && b) await h.highlightRegion(page, { x: a.x - 6, y: a.y - 4, width: Math.max(a.width, b.width) * 0.75, height: b.y + b.height - a.y + 8 }, 4000);
  await beat(1000);
  // run the whole program
  caption("clinicalRun");
  await runSas(page);
  await zoomPanel(page); // the end of the log
  await beat(3000);
  await zoomOut(page);
  await showViewer(page, 3500);
}

/** Recorded, chapter 04: add a PROC MEANS step, run just that step, check the program in as a new version. */
export async function changeAndCheckIn(page: Page) {
  caption("edit");
  await clickVisibleEditorLine(page);
  await page.keyboard.press("ControlOrMeta+ArrowDown"); // end of the file (Cmd+Down on macOS)
  await page.keyboard.press("End");
  await page.waitForTimeout(500);
  await zoomOnCursor(page, 260, 260);
  await fast("fast", async () => {
    for (const [i, line] of EDIT_LINES.entries()) {
      if (i) await page.keyboard.press("Enter");
      await page.keyboard.type(line, { delay: 45 });
    }
  });
  // the typed comment must show up as an editor line (the tab is not reliably marked dirty: the file may save itself)
  if (!(await editorLine(page, "Summary of the outcome by treatment group").count())) {
    throw new Error("the edit did not reach the test.sas editor");
  }
  await page.keyboard.press("ControlOrMeta+S");
  await beat(1200);
  // select the new step (cursor at the end of "run;", the comment is four lines up) and run only that
  caption("rerun");
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("Shift+Home");
  await beat(1500);
  await runSas(page);
  await showViewer(page, 4000);
  // check in: version scheme (Minor), then the version comment
  caption("checkin");
  await openClinicalView(page, true);
  const ws = wsPane(page);
  await contextMenu(page, item(ws, PROGRAM), /^Check In/);
  const qi = page.locator(".quick-input-widget").filter({ visible: true });
  await qi.locator(".monaco-list-row", { hasText: /^Minor/ }).waitFor({ timeout: 30_000 });
  await zoomOn(page, qi, { pad: 40 });
  await beat(2000);
  await h.hclick(page, qi.locator(".monaco-list-row", { hasText: /^Minor/ }));
  await qi.getByText("Comment", { exact: true }).waitFor({ timeout: 30_000 });
  await zoomOn(page, qi, { pad: 40 }); // the comment box is smaller than the version list
  await fast("fast", () => page.keyboard.type("Add outcome summary by treatment group", { delay: 45 }));
  await beat(1500);
  await page.keyboard.press("Enter");
  await zoomOut(page);
  await fast("wait", () => toast(page, /Successfully checked in/).waitFor({ timeout: 60_000 }));
  await beat(1500);
  // the repository now holds version 1.1 with the comment
  caption("history");
  const repo = repoPane(page);
  await h.hclick(page, item(repo, PROGRAM));
  const history = historyPane(page);
  await history.getByRole("treeitem", { name: /1\.1/ }).or(history.getByText(/v1\.1/)).first().waitFor({ timeout: 30_000 });
  await beat(500);
  await zoomOn(page, history, { pad: 30 });
  await h.highlight(page, history, 3500);
  await beat(1000);
  await zoomOut(page);
}

// ------------------------------------------------------------ chapter 05 ----

/** Wait (sped up) until the clinical job run started last ends; throws unless it completed successfully. */
async function waitForJob(page: Page, done: RegExp = /completed successfully/, timeout = 600_000) {
  const ok = toast(page, done);
  const bad = toast(page, /failed|not checked in|was not changed|cancel|completed with (errors|warnings)/i);
  await fast("wait", () => ok.or(bad).first().waitFor({ timeout }));
  if (await bad.isVisible().catch(() => false)) throw new Error(`clinical job did not complete: ${await bad.innerText()}`);
}

/** The frame (webview or Viewer page) that contains `marker`. */
async function frameWith(page: Page, marker: (f: Frame) => Locator, timeout = 60_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const f of page.frames()) if (await marker(f).count().catch(() => 0)) return f;
    await page.waitForTimeout(500);
  }
  throw new Error("frame not found");
}

/**
 * Zoom onto the page region from the top of `a` to the bottom of `b` (frame locators give page coordinates),
 * at most `maxWidth` px wide from its left edge (wide report tables: only their left columns).
 */
async function zoomSpan(page: Page, a: Locator, b: Locator, pad = 16, maxWidth = 1100) {
  await zoomOut(page);
  const ba = await a.boundingBox();
  const bb = await b.boundingBox();
  if (!ba || !bb) return false;
  const x0 = Math.min(ba.x, bb.x);
  const x1 = Math.min(Math.max(ba.x + ba.width, bb.x + bb.width), x0 + maxWidth);
  return zoomToBox(page, { x: x0, y: ba.y, width: x1 - x0, height: bb.y + bb.height - ba.y }, { pad });
}

/** Highlight the first `cells` cells of a table row (path and version), measured while zoomed. */
async function markCells(page: Page, row: Locator, ms: number, cells = 2, pad = 6) {
  const a = await row.locator("td").first().boundingBox();
  const b = await row.locator("td").nth(cells - 1).boundingBox();
  if (!a || !b) return;
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y + a.height, b.y + b.height);
  await h.highlightRegion(page, { x: a.x - pad, y: y0 - pad, width: b.x + b.width - a.x + 2 * pad, height: y1 - y0 + 2 * pad }, ms);
}

/** Highlight `loc` (measured while zoomed, as the overlay is drawn in screen coordinates). */
async function mark(page: Page, loc: Locator, ms: number, pad = 6) {
  const b = await loc.boundingBox();
  if (b) await h.highlightRegion(page, { x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad }, ms);
}

/** Scroll the Viewer (mouse wheel over it) until `target` is near the top of the visible report. */
async function scrollViewerTo(page: Page, target: Locator, topY = 160) {
  await zoomOut(page);
  const aux = await part(page, "auxiliarybar").boundingBox();
  if (!aux) return;
  await page.mouse.move(aux.x + aux.width / 2, aux.y + aux.height / 2, { steps: 10 });
  for (let i = 0; i < 40; i++) {
    const b = await target.boundingBox();
    if (!b || b.y <= topY) break;
    await page.mouse.wheel(0, Math.min(120, b.y - topY));
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(400);
}

/** A quick-pick row by its accessible name (row text can carry stale detail text of a reused list). */
const pickRow = (page: Page, label: string) =>
  page.locator(".quick-input-widget").filter({ visible: true }).locator(`.monaco-list-row[aria-label$=" ${label}"]`).first();

/**
 * Recorded, chapter 05: run test.sas as a clinical job, Run and Populate, add outputs/ as check-in location,
 * check the job in, run it from the repository, and walk through the manifest report.
 */
export async function runFromRepository(page: Page) {
  const ws = wsPane(page);
  const repo = repoPane(page);
  const jobs = jobsPane(page);
  // 1. a workspace job for the program
  caption("jobCreate");
  await openClinicalView(page, true);
  await h.dismissNotifications(page);
  await contextMenu(page, item(ws, PROGRAM), /^Run as Clinical Job$/);
  await waitForJob(page);
  await beat(800);
  await fast("fast", () => refreshPane(page, ws, true));
  await item(ws, JOB).waitFor({ timeout: 30_000 });
  await zoomSidebar(page, item(ws, `${PROJECT}/programs`), jobs, 520); // test.cjob and its run
  await beat(3000);
  // 2. Run and Populate: the job learns what the program reads and writes
  caption("jobPopulate");
  await h.dismissNotifications(page);
  await contextMenu(page, item(ws, JOB), /^Run and Populate/);
  const qi = page.locator(".quick-input-widget").filter({ visible: true });
  const relative = qi.locator(".monaco-list-row", { hasText: "Use Relative Paths" }).first();
  await relative.waitFor({ timeout: 30_000 });
  await zoomOn(page, qi, { pad: 40 });
  await beat(2500);
  await h.hclick(page, relative);
  await zoomOut(page);
  await waitForJob(page, /was populated/);
  const populated = toast(page, /was populated/);
  await zoomOn(page, populated, { pad: 30 });
  await beat(3500);
  await zoomOut(page);
  // 3. the job editor: the input it found, and outputs/ as check-in location
  caption("jobInputs");
  await h.hclick(page, item(ws, JOB), { dbl: true });
  const editor = await frameWith(page, (f) => f.locator("h2", { hasText: "Repository runs" }));
  const repoRuns = editor.locator("h2", { hasText: "Repository runs" });
  // to the top of the editor, so Input files and the check-in settings below are both on screen
  await repoRuns.evaluate((e) => e.scrollIntoView({ block: "start", behavior: "smooth" }));
  await beat(1200);
  const inputFiles = editor.locator("h3", { hasText: "Input files" });
  const inputFolders = editor.locator("h3", { hasText: "Input folders" });
  await zoomSpan(page, repoRuns, inputFolders, 30);
  await mark(page, inputFiles.locator("xpath=following-sibling::*[1]"), 3000);
  await beat(800);
  caption("jobCheckinFolder");
  await zoomOut(page);
  await h.hclick(page, editor.getByRole("button", { name: "Add Folder..." }).last());
  for (const label of ["PositDemo", "SAS-Demo", "outputs", "Use this folder"]) {
    await pickRow(page, label).waitFor({ timeout: 30_000 });
    await beat(label === "Use this folder" ? 1200 : 500);
    await h.hclick(page, pickRow(page, label), { steps: 10 });
    await page.waitForTimeout(1200);
  }
  await h.hclick(page, editor.getByLabel("Version new files"));
  await beat(600);
  await zoomSpan(page, editor.locator("h3", { hasText: "Check-in of outputs" }), editor.locator("h3", { hasText: "Check-in locations" }).locator("xpath=following-sibling::*[1]"), 30);
  await beat(3000);
  await zoomOut(page);
  await editor.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+S");
  const jobTab = page.locator(".tabs-container .tab", { hasText: "test.cjob" }).first();
  for (let i = 0; i < 20 && /\bdirty\b/.test((await jobTab.getAttribute("class")) ?? ""); i++) await page.waitForTimeout(500);
  if (/\bdirty\b/.test((await jobTab.getAttribute("class")) ?? "")) throw new Error("test.cjob was not saved");
  await beat(800);
  // 4. check the job in (a new file: versioned 1.0)
  caption("jobCheckin");
  await h.dismissNotifications(page);
  await contextMenu(page, item(ws, JOB), /^Check In/);
  const yes = qi.locator(".monaco-list-row", { hasText: /^Yes/ }).first();
  await yes.waitFor({ timeout: 30_000 });
  await zoomOn(page, qi, { pad: 40 });
  await beat(1800);
  await h.hclick(page, yes);
  await qi.getByText("Version", { exact: true }).waitFor({ timeout: 30_000 });
  await beat(1500);
  await page.keyboard.press("Enter"); // 1.0 is prefilled
  await qi.getByText("Comment", { exact: true }).waitFor({ timeout: 30_000 });
  await fast("fast", () => page.keyboard.type("Job for test.sas, inputs from Run and Populate", { delay: 45 }));
  await beat(1000);
  await page.keyboard.press("Enter");
  await zoomOut(page);
  await fast("wait", () => toast(page, /Successfully checked in/).waitFor({ timeout: 60_000 }));
  await beat(1000);
  // 5. run it from the repository
  caption("jobRepoRun");
  await fast("fast", async () => {
    await refreshPane(page, repo, true);
    await expand(page, repo, ["/PositDemo", PROJECT, `${PROJECT}/programs`]);
  });
  await item(repo, JOB).waitFor({ timeout: 30_000 });
  await h.dismissNotifications(page);
  await contextMenu(page, item(repo, JOB), /^Run Clinical Job$/);
  await page.waitForTimeout(1500);
  await zoomSidebar(page, jobs, jobs, 200);
  await waitForJob(page);
  await beat(2500);
  // 6. the manifest report of that run
  caption("manifest");
  await zoomOut(page);
  const run = jobs.locator("[role=treeitem]").first();
  await run.hover();
  await page.waitForTimeout(600);
  await h.hclick(page, run.locator(".action-label[aria-label^='Show Manifest Report']"));
  const report = await frameWith(page, (f) => f.locator("h1", { hasText: "Clinical job manifest" }));
  await beat(1000);
  await h.hclick(page, page.locator(".action-label[aria-label='Maximize Secondary Side Bar']"));
  await beat(1200);
  const section = (title: string) => report.locator("h2", { hasText: new RegExp(`^${title}$`) }).first();
  const tableAfter = (title: string) => section(title).locator("xpath=following-sibling::table[1]");
  await zoomSpan(page, report.locator("h1"), tableAfter("Summary").locator("tr").filter({ hasText: "Run as" }), 24);
  await beat(3500);
  caption("manifestInputs");
  await scrollViewerTo(page, section("Programs"), 200);
  await zoomSpan(page, section("Programs"), tableAfter("Inputs"), 24);
  await beat(800);
  await markCells(page, tableAfter("Programs").locator("tr", { hasText: "test.sas" }).first(), 2500);
  await markCells(page, tableAfter("Inputs").locator("tr", { hasText: "large_study_data" }).first(), 3500);
  await beat(800);
  caption("manifestOutputs");
  await scrollViewerTo(page, section("Outputs"), 200);
  await zoomSpan(page, section("Outputs"), tableAfter("Outputs"), 24);
  await beat(800);
  await markCells(page, tableAfter("Outputs").locator("tr", { hasText: "residuals_vs_predicted.pdf" }).first(), 3500);
  await beat(1000);
  await zoomOut(page);
  await h.hclick(page, page.locator(".action-label[aria-label='Restore Secondary Side Bar']"));
  await beat(1000);
}
