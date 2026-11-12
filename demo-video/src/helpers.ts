import type { Locator, Page } from "playwright";
import { BASE_URL, requireEnv } from "./config.ts";
import { forgetZoom, isZoomed, zoomAssistant, zoomOut } from "./zoom.ts";

/** SSO login via Keycloak (SAML). Credentials come from DEMO_U / DEMO_P. */
export async function login(page: Page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const signin = page.locator("#signinbutton");
  const home = page.getByRole("button", { name: "New Session", exact: true }).first();
  await signin.or(home).first().waitFor({ timeout: 90_000 });
  if (await signin.count()) {
    await signin.click();
    await page.fill("#username", requireEnv("DEMO_U"));
    await page.fill("#password", requireEnv("DEMO_P"));
    await page.click("#kc-login");
    await page.waitForURL((u) => u.origin === BASE_URL, { timeout: 60_000 });
  }
  await home.waitFor({ timeout: 90_000 });
}

/** Launch a brand-new Positron session using the pwb-session image. */
export async function startPositronSession(page: Page) {
  await page.getByRole("button", { name: "New Session", exact: true }).first().click();
  await page.locator("[id$='trigger-Positron']").click();
  await page.locator("#rstudio_label_image").click();
  await page.getByRole("option", { name: /pwb-session/ }).click();
  await page.getByRole("button", { name: "Launch" }).click();
  // Auto-join opens the session page; wait until the Positron UI is rendered.
  await page.locator(".monaco-workbench").waitFor({ timeout: 180_000 });
}

/** Quit every session of the demo user (cleanup). Throws if any survive. */
export async function quitAllSessions(page: Page) {
  await page.goto(BASE_URL);
  // Wait for the session list to render, either with sessions or without.
  const quit = page.getByRole("button", { name: "Quit All" });
  const idle = page.getByRole("button", { name: /^(Quit|New Session)$/ }).first();
  await idle.or(quit).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  if (await quit.count()) {
    await quit.click();
    await page.getByRole("dialog").getByRole("button", { name: /quit/i }).last().click();
  }
  const live = page.getByText(/^(Active|Pending|Starting)$/);
  await live.first().waitFor({ state: "detached", timeout: 60_000 }).catch(() => {});
  if (await live.count()) {
    throw new Error("Sessions are still running after cleanup");
  }
}

const REPO_DIR = "/home/demouser/sas-demo";

/**
 * Make sure the repo folder is open and trusted in a fresh Positron session.
 * A new session may start on the home folder or reopen sas-demo, so always
 * reload the session URL with ?folder= (deterministic), then trust if asked.
 * Pass `sasConsole` (e.g. "SAS Session (apro)") to also wait for that SAS console,
 * which only exists once a connection profile is in the user settings.
 */
export async function openFolderAndTrust(page: Page, sasConsole?: string, dir: string = REPO_DIR) {
  await page.locator(".monaco-workbench").waitFor({ timeout: 120_000 });
  const base = page.url().split("?")[0];
  await page.goto(`${base}?folder=${dir}`, { waitUntil: "domcontentloaded" });
  await afterReload(page, sasConsole);
}

/** Reload the Positron window (same URL, folder included) and wait until it is usable again. */
export async function reloadSession(page: Page, sasConsole?: string) {
  await page.goto(page.url(), { waitUntil: "domcontentloaded" });
  await afterReload(page, sasConsole);
}

async function afterReload(page: Page, sasConsole?: string) {
  forgetZoom(page);
  // the window title carries the name of the opened folder (sas-demo, or housing for the v2 chapter)
  const folderName = decodeURIComponent(new URL(page.url()).searchParams.get("folder") ?? REPO_DIR).split("/").filter(Boolean).pop()!;
  await page.waitForFunction(
    (name) => (document.querySelector(".window-title")?.textContent ?? "").includes(name),
    folderName,
    { timeout: 120_000 },
  );
  const manage = page.getByText("Manage", { exact: true });
  if (await manage.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await manage.click();
    await page.getByRole("button", { name: "Trust", exact: true }).click();
    await page.getByText("You trust this folder").waitFor();
    await page.locator('[aria-label="Close Modal Editor (Escape)"]').click();
  }
  if (sasConsole) await page.getByText(sasConsole).first().waitFor({ timeout: 120_000 });
  await autoDismissToasts(page);
}

/**
 * Click "Don't show again" on toasts (e.g. the Python venv prompt) the moment they appear, so they
 * never show up in the recording. Lives in the page, so it has to be installed again after a reload.
 */
export async function autoDismissToasts(page: Page) {
  // A string, not a function: tsx would inject a __name helper that does not exist in the page.
  await page.evaluate(`(() => {
    if (window.__toastWatcher) return;
    window.__toastWatcher = true;
    function dismiss() {
      document.querySelectorAll(".notifications-toasts *").forEach(function (e) {
        if (!e.children.length && /^Don't show again$/i.test((e.textContent || "").trim())) e.click();
      });
    }
    new MutationObserver(dismiss).observe(document.body, { childList: true, subtree: true });
    dismiss();
  })()`);
}

// ------------------------------------------------- connection profiles ----
// The SAS connection comes from a profile in the user settings. ~/apro.profile and
// ~/viya.profile on the server are complete settings.json files ({"SAS.connectionProfiles": {...}},
// not strict JSON, so no jq); "adding" one means copying it over ~/.positron-server/User/settings.json
// and reloading the window.

const BACKUP = "$HOME/settings.json.demo-bak";

/** Unrecorded shell setup: $S = user settings file. Clears the terminal afterwards. */
export async function prepareShell(page: Page) {
  await runInTerminal(page, 'S=$HOME/.positron-server/User/settings.json; mkdir -p $(dirname $S); clear');
  await page.waitForTimeout(1000);
}

/**
 * Unrecorded prerequisite: install the SAS extension from the vsix in the home folder (reload the window
 * afterwards). With `url`, a missing `~/<vsix>` is downloaded first (never overwritten).
 */
export async function installSasExtension(page: Page, vsix = "positron-sas-0.5.3.vsix", url?: string) {
  // SKIP_INSTALL=1: keep whatever SAS extension is installed (e.g. a local build installed by hand).
  if (process.env.SKIP_INSTALL) return;
  // Only installs when this version is missing (a forced reinstall of the active extension hangs).
  const version = vsix.replace(/^positron-sas-|\.vsix$/g, "");
  const download = url ? `test -f $HOME/${vsix} || curl -fsSL -o $HOME/${vsix} '${url}'; ` : "";
  await runInTerminal(
    page,
    `${download}positron --list-extensions --show-versions | grep -q 'positron-sas@${version}' || positron --install-extension $HOME/${vsix}; clear`,
  );
  // The terminal is WebGL-rendered (no text in the DOM), so its output cannot be read. A fresh
  // install takes 30-60 s; the SAS console appearing after the reload is the real check. A version
  // other than the default is usually a fresh install (plus download), so wait longer for it.
  const wait = Number(process.env.INSTALL_WAIT_SECONDS ?? (url ? 60 : 10));
  await page.waitForTimeout(wait * 1000);
}

/**
 * Shell command (run after the profile was copied to $S): switch the terminal to the DOM renderer, so its
 * text is in the page and can be read with `terminalText` (the default WebGL renderer draws on a canvas).
 * The profiles are complete settings files, so the setting goes in right after the opening brace.
 */
export const TERMINAL_DOM_CMD = `sed -i '0,/{/s//{\\n  "terminal.integrated.gpuAcceleration": "off",/' $S`;

/** Text of the visible terminal (only with the DOM renderer, see TERMINAL_DOM_CMD). */
export async function terminalText(page: Page) {
  return (await page.locator(".xterm-rows").filter({ visible: true }).allInnerTexts().catch(() => [])).join("\n");
}

/** Wait until the visible terminal shows `re` (needs TERMINAL_DOM_CMD); throws on `fail` or timeout. */
export async function waitForTerminal(page: Page, re: RegExp, opts: { fail?: RegExp; timeoutMs?: number } = {}) {
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  for (;;) {
    const text = await terminalText(page);
    if (re.test(text)) return text;
    if (opts.fail?.test(text)) throw new Error(`terminal shows an error: ${text.split("\n").filter((l) => opts.fail!.test(l)).slice(0, 3).join(" | ")}`);
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${re} in the terminal`);
    await page.waitForTimeout(1000);
  }
}

/** The commands shown in the recording (typed into the terminal). */
export const showProfileCmd = (file: string) => `cat ~/${file}`;
export const addProfileCmd = (file: string) => `cp ~/${file} $S`;

/** Type a command into the terminal slowly enough to read (like a person), then run it. */
export async function typeInTerminal(page: Page, cmd: string, opts: { delay?: number; wait?: number } = {}) {
  await page.getByRole("tab", { name: /Terminal/i }).click();
  await focusTerminal(page);
  await page.keyboard.type(cmd, { delay: opts.delay ?? 45 });
  await page.waitForTimeout(800);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(opts.wait ?? 2500);
}

/**
 * Unrecorded: remove the connection profile again. The demo account's clean state is "no user
 * settings.json" (the profile files are complete settings files), so this just deletes it.
 */
export async function removeProfile(page: Page) {
  await runInTerminal(page, "rm -f $S $S.new; clear");
  await page.waitForTimeout(1500);
}

/**
 * Start the SAS session of the active connection profile from the console's session picker
 * ("Select Session" > "New Console Session..." > "SAS (Apro)" / "SAS (Viya)") and wait until it is up.
 */
/** "local": the stdio profile the extension adds in a SAS Analytics Pro session (SAS in the same container). */
export type SasKind = "apro" | "viya" | "local";
export async function startSasSession(page: Page, kind: SasKind, timeoutMs = 240_000) {
  await page.getByRole("tab", { name: "Console", exact: true }).click();
  await page.waitForTimeout(800);
  // Which button exists depends on whether R has auto-started yet (a folder without R files starts no session
  // at first): "Select Session" once a session exists, "Start Session" in the top bar when there is none.
  // visible ones only: a console that failed to restore a session keeps hidden buttons of the same name
  const selectSession = page.getByRole("button", { name: "Select Session" }).filter({ visible: true }).first();
  const startSession = page.getByRole("button", { name: "Start Session" }).filter({ visible: true }).first();
  const appears = (loc: typeof selectSession, name: "select" | "start") =>
    loc.waitFor({ state: "visible", timeout: 90_000 }).then(() => name, () => undefined);
  const which = await Promise.race([appears(selectSession, "select"), appears(startSession, "start")]);
  if (which === "select") {
    // a session (e.g. R) exists: open its picker and ask for a new console session
    await hclick(page, selectSession);
    await hclick(page, page.getByText("New Console Session...", { exact: true }).filter({ visible: true }).first());
  } else if (which === "start") {
    await hclick(page, startSession); // opens the picker with the available interpreters
  } else {
    throw new Error("neither 'Select Session' nor 'Start Session' appeared");
  }
  const label = kind === "viya" ? "SAS (Viya)" : kind === "local" ? "SAS (local)" : "SAS (Apro)";
  // Filter the picker by typing instead of clicking: the list re-sorts while interpreters are still
  // being discovered, and a click on a position could land on "R 4.5.3".
  const entry = page.getByText(label, { exact: true }).filter({ visible: true }).first();
  await entry.waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(2500); // let the list settle
  await page.keyboard.type(label, { delay: 70 });
  await page.waitForTimeout(1000);
  await page.keyboard.press("Enter");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const text = await consoleText(page);
    if (kind === "viya") {
      if (/Viya started\./.test(text)) break;
      // The Viya compute server sometimes times out while creating the session; a retry would film the failure.
      if (/Viya failed to start/.test(text)) throw new Error("Viya failed to start (compute server timeout) - run the demo again");
    } else if (await page.getByText(kind === "local" ? /SAS Session \(local\)/ : /SAS Session \(apro\)/i).first().isVisible().catch(() => false)) {
      break;
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for the SAS session; console: ${text.slice(0, 400)}`);
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(kind === "viya" ? 8000 : 2000); // "Viya started." precedes the active session by a few seconds
}

/**
 * Run `trigger` and wait until SAS has finished. Analytics Pro writes a "submit-end" marker to the console; the
 * Viya console does not, so there we wait until the console output has changed and then stayed quiet for a few
 * seconds.
 */
export async function waitForConsoleDone(page: Page, kind: SasKind, trigger: () => Promise<void>, timeoutMs = 300_000) {
  const baseline = (await consoleText(page)).length;
  const marks = (await consoleText(page)).split("submit-end").length;
  await trigger();
  const deadline = Date.now() + timeoutMs;
  if (kind === "viya") {
    let last = baseline;
    let quietSince = Date.now();
    for (;;) {
      const len = (await consoleText(page)).length;
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
    while ((await consoleText(page)).split("submit-end").length <= marks) {
      if (Date.now() > deadline) throw new Error("Timed out waiting for SAS");
      await page.waitForTimeout(1000);
    }
  }
  await page.waitForTimeout(1500);
}

/** Unrecorded: copy the profile into the user settings, reload the window and start the SAS session (used by setup and probes). */
export async function enableProfile(page: Page, file: string, kind: "apro" | "viya") {
  await prepareShell(page);
  await runInTerminal(page, `cp ~/${file} $S; clear`);
  await page.waitForTimeout(1500);
  await reloadSession(page);
  await closeAllEditors(page);
  await startSasSession(page, kind);
}

/**
 * Unrecorded cleanup in a throwaway Positron session: remove the connection profile again (delete
 * the user settings.json) and quit the session. Never throws; prints a warning instead.
 */
/**
 * Unrecorded: remove what the exploratory-analysis chapter (v2) leaves in ~/sas-demo (and the clinical story's
 * scripts/env.sh, which holds a viya_admin token) - the report the
 * assistant wrote (name varies: ahs2023-overview.qmd, ahs2023n-overview.qmd, ...), its render files, and
 * the exported saspy config with its python cache - so the next run starts clean. Only these names.
 */
// ~/housing holds the user's dataset, so it is never cleaned by pattern: the file list is recorded before the
// run (first snapshot wins) and only entries that appeared since are removed afterwards.
const HOUSING_LIST = "~/.demo-housing-list";
/** Unrecorded: remember what is in ~/housing before the exploratory-analysis chapter writes there. */
export async function snapshotHousing(page: Page) {
  // the report folder the assistant creates next to ~/housing (user-approved removal of this one folder)
  await runInTerminal(page, `rm -rf ~/housing_report; [ -f ${HOUSING_LIST} ] || ls -A ~/housing > ${HOUSING_LIST}; clear`);
  await page.waitForTimeout(1000);
}
const CLEAN_HOUSING = `[ -f ${HOUSING_LIST} ] && { cd ~/housing && for f in $(ls -A); do grep -qxF -- "$f" ${HOUSING_LIST} || rm -rf -- "$f"; done; rm -f ${HOUSING_LIST}; }`;

export async function removeExploreArtifacts(page: Page) {
  await runInTerminal(
    page,
    `cd ~/sas-demo && rm -rf ahs2023* quarto/ahs2023* sascfg_personal.py __pycache__ scripts/env.sh; ${CLEAN_HOUSING}; rm -rf ~/housing_report; cd; clear`,
  );
  await page.waitForTimeout(1500);
}

export async function cleanupProfile(page: Page) {
  try {
    await login(page);
    await quitAllSessions(page);
    await startPositronSession(page);
    await page.waitForTimeout(8000);
    await dismissNotifications(page);
    await prepareShell(page);
    await removeProfile(page);
    await removeExploreArtifacts(page);
    await page.waitForTimeout(2000);
    console.log("connection profile removed (settings.json deleted), exploratory-analysis files removed");
  } catch (e) {
    console.error("PROFILE CLEANUP FAILED - run `npm run cleanup:profile` or delete ~/.positron-server/User/settings.json:", String(e).split("\n")[0]);
  } finally {
    await quitAllSessions(page).catch(() => {});
  }
}

/** Close every open editor tab (middle-click, hover close button as a fallback). Positron restores old tabs after a reload. */
export async function closeAllEditors(page: Page) {
  // Only visible tabs: a restored tab of a collapsed/hidden editor group exists in the DOM but cannot be clicked.
  const tabs = page.locator(".tabs-container .tab").filter({ visible: true });
  for (let i = 0; i < 20; i++) {
    const n = await tabs.count();
    if (!n) return;
    await tabs.first().click({ button: "middle", timeout: 8000 });
    await page.waitForTimeout(600);
    if ((await tabs.count()) >= n) {
      await tabs.first().hover();
      await tabs.first().locator(".tab-actions .action-label").click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(600);
    }
  }
}

/** Dismiss toast notifications (e.g. the Python venv prompt) so they don't show up in the video. */
export async function dismissNotifications(page: Page) {
  await page.getByRole("button", { name: "Don't show again" }).click({ timeout: 3000 }).catch(() => {});
  await page.getByRole("button", { name: "Clear All Notifications" }).click({ timeout: 1000 }).catch(() => {});
}

async function consoleText(page: Page) {
  return (await page.locator(".console-instance").allInnerTexts().catch(() => [])).join("\n");
}

/** Click the editor's "Run" button for the active SAS file and wait until SAS reports completion. */
export async function runActiveSasFile(page: Page, timeoutMs = 300_000) {
  await page.getByRole("tab", { name: "Console", exact: true }).click();
  const marks = async () => (await consoleText(page)).split("submit-end").length;
  const before = await marks();
  await page.getByRole("button", { name: "Run Selected or All SAS Code" }).click();
  const deadline = Date.now() + timeoutMs;
  while ((await marks()) <= before) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for SAS to finish");
    await page.waitForTimeout(1000);
  }
}

/** Submit a line of SAS code in the console and return the console text. */
export async function submitInSasConsole(page: Page, code: string) {
  await page.getByRole("tab", { name: "Console", exact: true }).click();
  await page.locator(".console-input").last().click();
  await page.keyboard.type(code);
  await page.keyboard.press("Enter");
}

/**
 * Focus the input of the visible terminal. There can be more than one terminal instance (e.g. a hidden one),
 * so pick the textarea inside the visible xterm; the last one in the DOM is not always it.
 */
export async function focusTerminal(page: Page) {
  const visible = page.locator(".xterm").filter({ visible: true }).locator(".xterm-helper-textarea");
  if (await visible.count()) await visible.first().focus();
  else await page.locator(".xterm-helper-textarea").last().focus();
}

/** Run a shell command in the Positron terminal. */
export async function runInTerminal(page: Page, cmd: string) {
  await page.getByRole("tab", { name: /Terminal/i }).click();
  await focusTerminal(page);
  await page.keyboard.type(cmd);
  await page.keyboard.press("Enter");
}

export { consoleText };

/** Reconnect to the single running session of the demo user (used by probes). */
export async function joinRunningSession(page: Page) {
  await page.goto(BASE_URL);
  await page.getByRole("link", { name: /Positron Pro Session/ }).first().click({ timeout: 30_000 });
  await page.locator(".monaco-workbench").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(5000);
}

/** List aria-labels / titles / text of buttons and tabs, optionally within a CSS scope. */
export async function labels(page: Page, scope = "body") {
  return page.locator(`${scope} [role=button], ${scope} [role=tab], ${scope} button, ${scope} a.action-label`).evaluateAll((n) =>
    n.map((e) => {
      const r = e.getBoundingClientRect();
      const l = (e.getAttribute("aria-label") ?? e.getAttribute("title") ?? e.textContent ?? "").trim().replace(/\s+/g, " ");
      return r.width > 0 && l ? `${l} @(${Math.round(r.left)},${Math.round(r.top)})` : "";
    }).filter(Boolean),
  );
}

/** Dev helper: persistent Chromium profile so Positron's browser-side state (workspace trust) survives between probe runs. */
export async function launchPersistent() {
  const { chromium } = await import("playwright");
  const { VIEWPORT } = await import("./config.ts");
  const context = await chromium.launchPersistentContext("auth/profile", { headless: true, viewport: VIEWPORT });
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
}

/** The Posit Assistant UI is a nested webview; find the frame that hosts the chat input. */
export async function assistantFrame(page: Page, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const f of page.frames()) {
      if (await f.locator(".tiptap-input-editor").count().catch(() => 0)) return f;
    }
    if (Date.now() > deadline) throw new Error("Posit Assistant frame not found");
    await page.waitForTimeout(1000);
  }
}

/** Visible fake cursor in the top frame (Playwright videos do not contain the OS cursor). */
export const CURSOR_SCRIPT = `(() => {
  if (window.top !== window) return;
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;z-index:2147483647;width:24px;height:24px;border-radius:50%;background:rgba(255,90,0,.35);border:2px solid #ff5a00;pointer-events:none;transform:translate(-50%,-50%);left:-60px;top:-60px;transition:left .02s,top .02s";
  const add = () => document.documentElement.appendChild(d);
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", add) : add();
  addEventListener("mousemove", (e) => { d.style.left = e.clientX + "px"; d.style.top = e.clientY + "px"; }, true);
})();`;

/** Move the mouse to the middle of a locator in small steps, pause, then click (double-click, right-click). */
export async function hclick(page: Page, loc: Locator, opts: { dbl?: boolean; right?: boolean; mod?: boolean; steps?: number; pause?: number } = {}) {
  await loc.waitFor({ state: "visible", timeout: 60_000 });
  if (isZoomed(page)) {
    // Inside an iframe (Posit Assistant, Viewer) clicks miss while the workbench is scaled; so do
    // targets the zoom pushed off screen (scrolling them into view would scroll the whole page).
    const inFrame = await loc.evaluate(() => window !== window.top).catch(() => true);
    const bz = await loc.boundingBox().catch(() => null);
    const offScreen = !bz || bz.x + bz.width / 2 < 0 || bz.x + bz.width / 2 > 1920 || bz.y + bz.height / 2 < 0 || bz.y + bz.height / 2 > 1080;
    if (inFrame || offScreen) await zoomOut(page);
  }
  if (!isZoomed(page)) await loc.scrollIntoViewIfNeeded().catch(() => {});
  const b = await loc.boundingBox();
  if (!b) throw new Error("No bounding box for " + loc);
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y, { steps: opts.steps ?? 20 });
  await page.waitForTimeout(opts.pause ?? 300);
  if (opts.mod) await page.keyboard.down("ControlOrMeta");
  if (opts.dbl) await page.mouse.dblclick(x, y);
  else await page.mouse.click(x, y, { button: opts.right ? "right" : "left" });
  if (opts.mod) await page.keyboard.up("ControlOrMeta");
}

/** Draw a temporary outline around a screen region (top frame) to draw the viewer's eye. */
export async function highlightRegion(page: Page, r: { x: number; y: number; width: number; height: number }, ms = 2000) {
  await page.evaluate((r) => {
    const d = document.createElement("div");
    d.id = "__hl";
    d.style.cssText = `position:fixed;z-index:2147483646;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;border:5px solid #ff5a00;border-radius:8px;box-shadow:0 0 18px rgba(255,90,0,.7);pointer-events:none`;
    document.documentElement.appendChild(d); // outside a scaled <body> (zoom.ts)
  }, r);
  await page.waitForTimeout(ms);
  await page.evaluate(() => document.getElementById("__hl")?.remove());
}

/** Highlight a locator's element. */
export async function highlight(page: Page, loc: Locator, ms = 2000) {
  const b = await loc.boundingBox();
  if (b) await highlightRegion(page, b, ms);
}

/**
 * Let Posit Assistant work: approve tool-permission prompts as they appear and
 * return once its output has been stable for `quietSec` (or after maxSec).
 */
export async function settleAssistant(page: Page, opts: { quietSec?: number; minSec?: number; maxSec?: number; zoom?: boolean } = {}) {
  const { quietSec = 12, minSec = 10, maxSec = 180 } = opts;
  const f = await assistantFrame(page);
  const start = Date.now();
  let last = -1;
  let stableSince = Date.now();
  while ((Date.now() - start) / 1000 < maxSec) {
    // "Allow" (tool approvals) or "Allow once" (access outside the workspace) - never "always"
    const allow = f.getByRole("button", { name: /^Allow( once)?$/ });
    if (await allow.count().catch(() => 0)) {
      await hclick(page, allow.first()); // zooms out (iframe)
      if (opts.zoom) await zoomAssistant(page);
      stableSince = Date.now();
    }
    const text = await f.locator("body").innerText().catch(() => "");
    const len = text.length;
    // the assistant shows "Working…" while a turn (or a long-running tool call) is in progress
    if (/Working(…|\.\.\.)/.test(text)) stableSince = Date.now();
    if (len !== last) {
      last = len;
      stableSince = Date.now();
    }
    if ((Date.now() - start) / 1000 > minSec && (Date.now() - stableSince) / 1000 > quietSec) return;
    await page.waitForTimeout(1000);
  }
}

/** Double-click a table in Data Connections and wait until the Data Explorer shows it. */
export async function openDataExplorer(page: Page, table: RegExp = /^large_study_data$/i) {
  await hclick(page, page.getByText(table).first(), { dbl: true });
  await page.locator(".data-grid-column-header").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(3000);
}

/** Scroll the Data Explorer grid down, right and back, so the viewer sees the size of the table. */
export async function scrollAround(page: Page) {
  await page.mouse.move(1000, 350, { steps: 15 });
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 380);
    await page.waitForTimeout(130);
  }
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(300, 0);
    await page.waitForTimeout(160);
  }
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, -500);
    await page.waitForTimeout(110);
  }
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(-300, 0);
    await page.waitForTimeout(110);
  }
  await page.waitForTimeout(800);
}
