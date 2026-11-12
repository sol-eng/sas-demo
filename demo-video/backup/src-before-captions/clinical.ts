// Clinical Acceleration story (STORY=clinical, Viya only).
//
// Unrecorded preparation (`resetClinicalState`, behind the profile card once the demouser session runs):
//   - in demouser's Clinical Workspace: undo a check-out a failed run may have left and delete the
//     workspace copy of /PositDemo/SAS-Demo (the server refuses to delete a project with checked-out files,
//     and only the owner can undo a check-out);
//   - locally (this machine, viya_admin from ../scripts/env.sh): permanently delete the project, so the setup
//     scripts can create it on camera, and get a short-lived viya_admin token (the password stays here);
//   - in the terminal: copy the repository scripts, the starter program and an env.sh holding only the token
//     into ~/sas-demo/scripts on the server (plus a static jq, which the session image lacks).
// Recorded: the setup scripts in the terminal, then check-out / edit / check-in of test.sas and copying the
// study data to the workspace in the Clinical Acceleration view, and reading that data in SAS.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import type { Page } from "playwright";
import { beat } from "./config.ts";
import * as h from "./helpers.ts";

const REPO_ROOT = new URL("../../", import.meta.url).pathname; // the sas-demo checkout on this machine
const SCRIPTS = join(REPO_ROOT, "scripts");
const PROJECT = "/PositDemo/SAS-Demo";
const PROGRAM = `${PROJECT}/programs/test.sas`;
const DATASET = `${PROJECT}/data/sdtm/large_study_data.sas7bdat`;
const JQ_URL = "https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-linux-amd64";

// ------------------------------------------------------------ UI parts ----

/** The Clinical Acceleration activity-bar entry (its icon has no accessible name). */
const clinicalIcon = (page: Page) => page.locator(".activitybar .action-label[class*=sas-clinical-view-container]");
/** A view of the Clinical Acceleration container, by its header title. */
const pane = (page: Page, title: string) =>
  page.locator(".pane").filter({ has: page.locator(".pane-header", { hasText: new RegExp(`^${title}`, "i") }) }).first();
const repoPane = (page: Page) => pane(page, "Clinical Repository");
const wsPane = (page: Page) => pane(page, "Clinical Workspace");
const historyPane = (page: Page) => pane(page, "Clinical Version History");
/** Tree items carry the repository path as their accessible name. */
const item = (p: ReturnType<typeof pane>, path: string) => p.getByRole("treeitem", { name: path, exact: true });
const menuItem = (page: Page, label: RegExp) => page.locator(".monaco-menu [role=menuitem]", { hasText: label }).first();
const toast = (page: Page, text: RegExp) => page.locator(".notifications-toasts .notification-list-item-message", { hasText: text }).first();

async function openClinicalView(page: Page, show = false) {
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
 * Local: permanently delete the demo project (the server cannot move projects to the trash), then return a
 * fresh viya_admin access token for the scripts on the server.
 */
export function resetRepositoryLocally(): string {
  localAdmin("./scripts/teardown_repo.sh --yes");
  const left = localAdmin(`source scripts/lib.sh; item_by_path '${PROJECT}'`).trim();
  if (left) throw new Error(`${PROJECT} still exists after teardown_repo.sh`);
  const token = localAdmin("source scripts/lib.sh; get_token").trim();
  if (token.split(".").length !== 3) throw new Error("no access token for viya_admin");
  return token;
}

/** Server URL of the clinical repository, from the local scripts/env.sh. */
const baseUrl = () => localAdmin('printf %s "$SAS_BASE_URL"');

// ------------------------------------------------------------ unrecorded ----

/**
 * Unrecorded, in the Positron terminal (needs TERMINAL_DOM_CMD): unpack scripts/*.sh, the starter program
 * (local sas/test.sas, the clinical version) and an env.sh with the token into ~/sas-demo/scripts, and make
 * sure curl and jq exist (jq is fetched once into scripts/bin). The files travel as a base64 tarball (about
 * 15 KB of text) typed into the terminal. `$((1+1))` in the echo keeps the typed command from matching the expected output.
 */
export async function uploadScripts(page: Page, token: string) {
  const stage = mkdtempSync(join(tmpdir(), "clinical-"));
  try {
    const dst = join(stage, "scripts");
    mkdirSync(join(dst, "starter"), { recursive: true });
    for (const f of readdirSync(SCRIPTS)) {
      if (f.endsWith(".sh") && f !== "env.sh") copyFileSync(join(SCRIPTS, f), join(dst, f));
    }
    copyFileSync(join(REPO_ROOT, "sas", "test.sas"), join(dst, "starter", "test.sas"));
    writeFileSync(
      join(dst, "env.sh"),
      [
        "# Written by the demo-video automation: a short-lived viya_admin token, no password. Removed after the run.",
        `export SAS_BASE_URL="${baseUrl()}"`,
        `export SAS_TOKEN="${token}"`,
        'export SAS_PROGRAM_FILE="./scripts/starter/test.sas"',
        'export PATH="$HOME/sas-demo/scripts/bin:$PATH"',
        "",
      ].join("\n"),
    );
    chmodSync(join(dst, "env.sh"), 0o600);
    // gzip in Node: bsdtar pads compressed output to its 20 KB block size
    const tar = execFileSync("tar", ["cf", "-", "-C", stage, "scripts"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
    const b64 = gzipSync(tar).toString("base64");
    // Appended in chunks with printf: one long heredoc line arrives incompletely through the web terminal.
    const tmp = "~/.demo-upload.b64";
    await h.runInTerminal(page, `clear; cd ~/sas-demo && rm -f ${tmp}`);
    for (const chunk of b64.match(/.{1,2000}/g) ?? []) {
      await page.keyboard.insertText(`printf %s '${chunk}' >> ${tmp}; clear`); // the terminal still has the focus
      await page.keyboard.press("Enter");
      await page.waitForTimeout(400);
    }
    await h.runInTerminal(page, `base64 -d ${tmp} | tar xzf - && rm -f ${tmp} && echo UPLOAD_$((1+1))OK`);
    await h.waitForTerminal(page, /UPLOAD_2OK/, { fail: /tar:|base64:|No such file/, timeoutMs: 120_000 });
    await h.runInTerminal(
      page,
      `clear; export PATH=~/sas-demo/scripts/bin:$PATH; command -v jq >/dev/null || { mkdir -p scripts/bin && curl -fsSL -o scripts/bin/jq ${JQ_URL} && chmod +x scripts/bin/jq; }; command -v curl >/dev/null && jq --version && echo TOOLS_$((1+1))OK || echo TOOLS_MISSING`,
    );
    const out = await h.waitForTerminal(page, /TOOLS_2OK|TOOLS_MISSING/, { timeoutMs: 120_000 });
    if (/TOOLS_MISSING/.test(out)) throw new Error("curl or jq is missing in the session (jq download failed?)");
    await h.runInTerminal(page, "clear");
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/**
 * Unrecorded: start from a clean repository and workspace (see the header comment). Runs in the profile cut,
 * with the SAS (Viya) session up. Leaves the Explorer side bar open, as the other stories expect.
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
    await toast(page, /Deleted the selected item/).waitFor({ timeout: 60_000 });
  }
  const token = resetRepositoryLocally();
  await uploadScripts(page, token);
  await refreshPane(page, repoPane(page));
  await page.getByRole("button", { name: "Clear All Notifications" }).click({ timeout: 1000 }).catch(() => {});
  await h.dismissNotifications(page);
  await page.getByRole("tab", { name: /^Explorer/ }).click();
  await page.waitForTimeout(500);
}

// ------------------------------------------------------------- recorded ----

const SCRIPT_FAIL = /^error:|curl: \(\d+\)/m;

/** Recorded: the administrator's setup scripts in the terminal (output is readable thanks to TERMINAL_DOM_CMD). */
export async function setupRepoOnCamera(page: Page) {
  await h.runInTerminal(page, "clear");
  await beat(1500);
  await h.typeInTerminal(page, "source scripts/env.sh", { wait: 1500 });
  await h.typeInTerminal(page, "./scripts/setup_repo.sh", { wait: 500 });
  await h.waitForTerminal(page, /Next: \.\/scripts\/setup_users\.sh/, { fail: SCRIPT_FAIL, timeoutMs: 180_000 });
  await beat(4000);
  await h.typeInTerminal(page, "./scripts/setup_users.sh", { wait: 500 });
  await h.waitForTerminal(page, /Next: \.\/scripts\/verify_setup\.sh/, { fail: SCRIPT_FAIL, timeoutMs: 180_000 });
  await beat(4000);
  await h.typeInTerminal(page, "clear; ./scripts/verify_setup.sh", { wait: 500 });
  await h.waitForTerminal(page, /All checks passed\./, { fail: /Some checks FAILED|^error:/m, timeoutMs: 180_000 });
  await beat(6000);
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

/** Recorded: runbook step 1 - check out test.sas to the workspace, edit it, check it in as a new version. */
export async function checkoutEditCheckin(page: Page) {
  await openClinicalView(page, true);
  await beat(1500);
  const repo = repoPane(page);
  await refreshPane(page, repo, true); // the project was just created by the scripts
  await expand(page, repo, ["/PositDemo", PROJECT, `${PROJECT}/programs`]);
  await beat(1500);
  // check out
  await contextMenu(page, item(repo, PROGRAM), /^Check out to Workspace/, /^With Content$/);
  await toast(page, /Successfully checked out/).waitFor({ timeout: 60_000 });
  await beat(2500);
  // open the workspace copy
  const ws = wsPane(page);
  await refreshPane(page, ws, true);
  await expand(page, ws, ["/PositDemo", PROJECT, `${PROJECT}/programs`]);
  await h.hclick(page, item(ws, PROGRAM), { dbl: true });
  await page.locator(".tabs-container .tab", { hasText: "test.sas" }).first().waitFor({ timeout: 30_000 });
  await beat(2500);
  // edit: append a summary step at the end and save
  // click a line of test.sas itself: generic Monaco selectors also match the SAS console input, a Monaco
  // editor hidden behind the terminal, and the typing would then go to bash
  await h.hclick(page, page.locator(".view-line", { hasText: "Analysis of the synthetic study dataset" }).first());
  await page.keyboard.press("ControlOrMeta+ArrowDown");
  await page.keyboard.press("End");
  for (const [i, line] of EDIT_LINES.entries()) {
    if (i) await page.keyboard.press("Enter");
    await page.keyboard.type(line, { delay: 45 });
  }
  const tab = page.locator(".tabs-container .tab", { hasText: "test.sas" }).first();
  if (!/\bdirty\b/.test((await tab.getAttribute("class")) ?? "")) throw new Error("the edit did not reach the test.sas editor");
  await beat(1500);
  await page.keyboard.press("ControlOrMeta+S");
  await beat(2000);
  // check in: version scheme (Minor), then the version comment
  await contextMenu(page, item(ws, PROGRAM), /^Check In/);
  const qi = page.locator(".quick-input-widget").filter({ visible: true });
  await qi.locator(".monaco-list-row", { hasText: /^Minor/ }).waitFor({ timeout: 30_000 });
  await beat(1500);
  await h.hclick(page, qi.locator(".monaco-list-row", { hasText: /^Minor/ }));
  await qi.getByText("Comment", { exact: true }).waitFor({ timeout: 30_000 });
  await page.keyboard.type("Add outcome summary by treatment group", { delay: 45 });
  await beat(800);
  await page.keyboard.press("Enter");
  await toast(page, /Successfully checked in/).waitFor({ timeout: 60_000 });
  await beat(2000);
  // the repository now holds version 1.1 with the comment
  await h.hclick(page, item(repo, PROGRAM));
  const history = historyPane(page);
  await history.getByRole("treeitem", { name: /1\.1/ }).or(history.getByText(/v1\.1/)).first().waitFor({ timeout: 30_000 });
  await beat(800);
  await h.highlight(page, history, 3500);
  await beat(1000);
}

/** Recorded: runbook step 2 - copy the dataset to the workspace and read it from SAS (libname, Data Explorer). */
export async function copyDataAndExplore(page: Page) {
  await openClinicalView(page, true);
  const repo = repoPane(page);
  await expand(page, repo, [`${PROJECT}/data`, `${PROJECT}/data/sdtm`]);
  await beat(1200);
  await contextMenu(page, item(repo, DATASET), /^Copy to Workspace/, /^Copy Latest Version$/);
  await toast(page, /Successfully copied/).waitFor({ timeout: 120_000 });
  await beat(2000);
  const ws = wsPane(page);
  await refreshPane(page, ws, true);
  await expand(page, ws, [`${PROJECT}/data`, `${PROJECT}/data/sdtm`]);
  await item(ws, DATASET).waitFor({ timeout: 30_000 });
  await h.highlight(page, item(ws, DATASET), 2500);
  // SAS Viya sees the workspace at /clinical/workspaces, mirroring the repository path
  await page.getByRole("tab", { name: "Console", exact: true }).click();
  await h.hclick(page, page.locator(".console-input").last());
  await page.keyboard.type('libname demo "/clinical/workspaces/PositDemo/SAS-Demo/data/sdtm/";', { delay: 45 });
  await beat(1000);
  await page.keyboard.press("Enter");
  const deadline = Date.now() + 60_000;
  while (!/Libref DEMO was successfully assigned/.test(await h.consoleText(page))) {
    if (Date.now() > deadline) throw new Error("libname demo was not assigned");
    await page.waitForTimeout(1000);
  }
  await beat(3000);
  // Data Connections -> SAS (viya) -> DEMO -> LARGE_STUDY_DATA in the Data Explorer
  await h.hclick(page, page.getByRole("tab", { name: /Data Connections/ }));
  await beat(1200);
  await h.hclick(page, page.getByText("SAS (viya)").first());
  await page.keyboard.press("ArrowRight");
  await beat(1500);
  await h.hclick(page, page.getByText("DEMO", { exact: true }).first());
  await page.keyboard.press("ArrowRight");
  await beat(1500);
  await h.openDataExplorer(page);
  await h.scrollAround(page);
  await beat(2000);
}
