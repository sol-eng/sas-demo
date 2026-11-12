// Local SAS story (STORY=local, EDITION=apro): Posit Workbench starts Positron from the SAS Analytics Pro image
// (Positron itself comes from the Workbench session init container); the SAS extension finds SAS in the container
// and adds a "local" stdio profile by itself; test.sas then runs on that SAS 9.4 (no ssh, no SAS server).
//
// The extension adds the profile only once per user: it remembers that in its global state
// ("SAS.localProfileAdded" in the browser-side storage of Positron, IndexedDB "positron-web-state-db-global",
// which Workbench keeps per user). resetLocalState() clears that flag and the user settings off camera.
import type { Page } from "playwright";
import { beat } from "./config.ts";
import * as h from "./helpers.ts";
import { caption, fast } from "./timeline.ts";
import { part, upper, zoomOn, zoomOut, zoomPanel, zoomToBox } from "./zoom.ts";

/** Remove "SAS.localProfileAdded" from the SAS extension's global state (run on a Positron page). */
export async function clearLocalProfileFlag(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open("positron-web-state-db-global");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const key = "posit.positron-sas";
    const v = await new Promise<unknown>((res) => {
      const tx = db.transaction("ItemTable", "readonly");
      const q = tx.objectStore("ItemTable").get(key);
      tx.oncomplete = () => res(q.result);
    });
    if (v === undefined) return "no state";
    const o = JSON.parse(typeof v === "string" ? v : new TextDecoder().decode(v as Uint8Array));
    const had = "SAS.localProfileAdded" in o;
    delete o["SAS.localProfileAdded"];
    await new Promise<void>((res) => {
      const tx = db.transaction("ItemTable", "readwrite");
      tx.objectStore("ItemTable").put(JSON.stringify(o), key);
      tx.oncomplete = () => res();
    });
    db.close();
    return had ? "cleared" : "not set";
  });
}

/**
 * Forget the SAS consoles of earlier runs (run on a Positron page): Positron keeps, per workspace, the sessions to
 * restore (`positron.workspaceSessionList.v3`) and the runtime to start with the workspace
 * (`positron.affiliatedRuntimeMetadata.v2.sas`). A stale SAS (local) entry shows "Session is no longer available".
 */
export async function forgetSasConsoles(page: Page): Promise<string> {
  // a string, not a function: tsx would wrap the helpers below in __name(), which the page does not define
  return page.evaluate(`(async () => {
    const changed = [];
    const text = (v) => (typeof v === "string" ? v : v instanceof Uint8Array ? new TextDecoder().decode(v) : "");
    for (const d of await indexedDB.databases()) {
      if (!d.name || !d.name.startsWith("positron-web-state-db") || d.name.endsWith("-global")) continue;
      const db = await new Promise((res, rej) => { const r = indexedDB.open(d.name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const read = (key) => new Promise((res) => { const tx = db.transaction("ItemTable", "readonly"); const q = tx.objectStore("ItemTable").get(key); tx.oncomplete = () => res(q.result); });
      const list = text(await read("positron.workspaceSessionList.v3"));
      const affiliated = text(await read("positron.affiliatedRuntimeMetadata.v2.sas"));
      if (/"sessionName":"local"/.test(list) || /sas-local/.test(affiliated)) {
        await new Promise((res) => {
          const tx = db.transaction("ItemTable", "readwrite");
          const os = tx.objectStore("ItemTable");
          if (list) os.put(JSON.stringify(JSON.parse(list).filter((s) => s.sessionName !== "local")), "positron.workspaceSessionList.v3");
          if (/sas-local/.test(affiliated)) os.delete("positron.affiliatedRuntimeMetadata.v2.sas");
          tx.oncomplete = () => res();
        });
        changed.push(d.name);
      }
      db.close();
    }
    return changed.length ? "cleaned " + changed.join(", ") : "nothing to clean";
  })()`);
}

/**
 * Pre-roll (not recorded): in a quiet Positron session from the default image (no SAS there, so nothing is
 * added): close the editors the sas-demo workspace would restore, drop the SAS profiles from the user settings
 * (git is missing in the Analytics Pro image: no warning), clear the
 * "profile added" flag; then quit all sessions and stay on the Workbench home page.
 */
export async function resetLocalState(page: Page) {
  await h.login(page);
  await h.quitAllSessions(page);
  await h.startPositronSession(page);
  await h.openFolderAndTrust(page);
  await h.dismissNotifications(page);
  await h.closeAllEditors(page);
  await h.prepareShell(page);
  // Keep the keys Workbench writes at session start (remote.autoForwardPorts, files.associations), as in any
  // user's settings: if they are missing, Workbench writes them while the extension adds its profile, and the
  // extension's write fails ("content of the file is newer"), so the profile is lost.
  const py = [
    "import json, os",
    "p = os.environ['S']",
    "s = json.load(open(p)) if os.path.exists(p) else {}",
    "s.pop('SAS.connectionProfiles', None)",
    "s['git.ignoreMissingGitWarning'] = True",
    "json.dump(s, open(p, 'w'), indent=4)",
  ].join("\n");
  await h.runInTerminal(page, `export S; python3 - <<'PYEOF'\n${py}\nPYEOF\nrm -f $S.new; cat $S; clear`);
  await page.waitForTimeout(1500);
  console.log(`local profile flag: ${await clearLocalProfileFlag(page)}`);
  console.log(`stale SAS consoles: ${await forgetSasConsoles(page)}`);
  await page.waitForTimeout(2000);
  await h.quitAllSessions(page);
}

const imageField = (page: Page) => page.locator("#rstudio_label_image");

/** 01: from the sas-demo project row, New Session with Positron Pro and the SAS Analytics Pro image; Launch. */
export async function launchPositron(page: Page) {
  caption("localLaunch");
  const row = page.getByRole("row").filter({ hasText: "~/sas-demo" }).first();
  const dialog = page.getByRole("dialog");
  await row.waitFor();
  await page.waitForTimeout(1500); // the session table re-renders after the pre-roll quit the sessions
  for (let i = 0; i < 3 && !(await dialog.isVisible()); i++) {
    await h.hclick(page, row.getByText("Create new session").first());
    await dialog.waitFor({ timeout: 5000 }).catch(() => {});
  }
  await dialog.waitFor();
  await page.waitForTimeout(800);
  await zoomOn(page, dialog, { maxScale: 1.6 });
  await h.hclick(page, page.locator("[id$='trigger-Positron']"));
  await beat(800);
  caption("localImage");
  await h.highlight(page, imageField(page), 1800); // the default: the Workbench session image
  // the option list is positioned in unscaled page coordinates: open it with the dialog unzoomed
  await zoomOut(page);
  await h.hclick(page, imageField(page));
  const apro = page.getByRole("option").filter({ hasText: /sas\/apro/ }).first();
  await apro.waitFor();
  await beat(600);
  await h.highlight(page, apro, 1600);
  await h.hclick(page, apro);
  await page.waitForFunction(() => /sas\/apro/.test(document.querySelector("#rstudio_label_image")?.textContent ?? ""), null, { timeout: 15_000 });
  await zoomOn(page, dialog, { maxScale: 1.6 });
  await beat(500);
  await h.highlight(page, imageField(page), 2500);
  caption("localStart");
  await h.hclick(page, page.getByRole("button", { name: "Launch" }));
  await zoomOut(page);
  await fast("wait", async () => {
    await page.locator(".monaco-workbench").waitFor({ timeout: 300_000 });
    await page.waitForTimeout(10_000); // extensions activate; the SAS extension adds the local profile
    await h.dismissNotifications(page);
    await h.closeAllEditors(page); // a Welcome page may open
  });
}

/** 02: the profile the extension added (user settings JSON, zoomed), then start the SAS (local) console. */
export async function showLocalProfile(page: Page) {
  caption("localProfile");
  // the status bar names the active profile
  const status = page.locator(".statusbar-item").filter({ hasText: /^\s*local\s*$/ }).first();
  if (await status.isVisible().catch(() => false)) {
    const b = await status.boundingBox();
    if (b) await zoomToBox(page, { x: Math.max(0, b.x - 300), y: b.y - 200, width: 640, height: 230 });
    await h.highlight(page, status, 2000);
    await zoomOut(page);
  }
  await page.keyboard.press("ControlOrMeta+Shift+P");
  await page.waitForTimeout(600);
  await page.keyboard.type("Open User Settings (JSON)", { delay: 25 });
  await page.waitForTimeout(1200);
  await page.keyboard.press("Enter");
  const first = page.locator(".monaco-editor .view-line", { hasText: "SAS.connectionProfiles" }).first();
  await first.waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  const last = page.locator(".monaco-editor .view-line", { hasText: "saspath" }).first();
  const a = await first.boundingBox();
  const b = await last.boundingBox();
  if (a && b) {
    const box = { x: a.x - 20, y: a.y - 60, width: 760, height: b.y + b.height - a.y + 140 };
    await zoomToBox(page, box, { maxScale: 2 });
    const a2 = await first.boundingBox();
    const b2 = await last.boundingBox();
    if (a2 && b2) await h.highlightRegion(page, { x: a2.x - 8, y: a2.y - 4, width: Math.max(a2.width, b2.width) * 0.8, height: b2.y + b2.height - a2.y + 8 }, 4000);
    await beat(800);
    await zoomOut(page);
  }
  await page.keyboard.press("Escape"); // the settings JSON opens in a modal editor
  await h.closeAllEditors(page);
  await beat(800);
  caption("localSession");
  await fast("wait", () => h.startSasSession(page, "local"));
  await h.dismissNotifications(page);
  await zoomPanel(page, 420, "top"); // the fresh SAS console
  await beat(2500);
  await zoomOut(page);
}

/** 03 (after runTestSas): the ODS output in the Viewer, zoomed. */
export async function showViewer(page: Page) {
  caption("html");
  await h.hclick(page, page.getByRole("tab", { name: /^Viewer/ }));
  await zoomOn(page, part(page, "auxiliarybar"), { region: upper(540) });
  await beat(3000);
  await zoomOut(page);
}
