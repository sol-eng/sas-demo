// Dev REPL: keeps one browser + one fresh Positron session alive and runs
// snippets dropped into a command file. Usage: tsx src/repl.ts <dir>
// Writes <dir>/ready when the session is up, runs <dir>/cmd.mjs whenever it
// changes (default export: async (page, h) => ...), results go to <dir>/out.txt.
// VIYA=1: sign in to SAS Viya CAF (managed credentials), add viya.profile with a DOM-rendered terminal
// (see TERMINAL_DOM_CMD) and start the SAS (Viya) session first. CLINICAL=1 (with VIYA=1): install the clinical
// story's extension version; snippets get the clinical module as `clinical`. STUDIO=1: only sign in to Workbench
// (home page, no session) for the SAS Studio story; cleanup just quits the sessions.
import { chromium } from "playwright";
import { existsSync, statSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { VIEWPORT } from "./config.ts";
import * as h from "./helpers.ts";
import * as v from "./viya-login.ts";
import * as clinical from "./clinical.ts";
import * as studio from "./studio.ts";

const dir = process.argv[2];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: VIEWPORT });
const page = await context.newPage();
const cleanup = async () => {
  try {
    const p = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
    if (process.env.STUDIO) await h.login(p).then(() => h.quitAllSessions(p));
    else await h.cleanupProfile(p); // quits the sessions and removes settings.json again
  } finally {
    await browser.close();
    process.exit(0);
  }
};
try {
  if (process.env.VIYA) {
    await v.signInAndLaunchQuietly(page, context);
    await page.waitForTimeout(8000);
    await h.dismissNotifications(page);
    await h.prepareShell(page);
    if (process.env.CLINICAL) await h.installSasExtension(page, clinical.CLINICAL_VSIX, clinical.CLINICAL_VSIX_URL);
    else await h.installSasExtension(page);
    await h.openFolderAndTrust(page);
    await h.prepareShell(page);
    await h.runInTerminal(page, `cp ~/viya.profile $S; ${h.TERMINAL_DOM_CMD}; clear`);
    await page.waitForTimeout(1500);
    await h.reloadSession(page);
    await h.dismissNotifications(page);
    await h.closeAllEditors(page);
    await h.startSasSession(page, "viya");
  } else if (process.env.STUDIO) {
    await h.login(page);
    await h.quitAllSessions(page);
  } else {
    await h.login(page);
    await h.quitAllSessions(page);
    await h.startPositronSession(page);
    await h.openFolderAndTrust(page);
    await h.dismissNotifications(page);
  }
  writeFileSync(`${dir}/ready`, "ok");
  let last = 0;
  for (;;) {
    if (existsSync(`${dir}/stop`)) break;
    if (existsSync(`${dir}/cmd.mjs`)) {
      const m = statSync(`${dir}/cmd.mjs`).mtimeMs;
      if (m !== last) {
        last = m;
        let out = "";
        const log = (...a: unknown[]) => { out += a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n"; };
        try {
          const mod = await import(pathToFileURL(`${dir}/cmd.mjs`).href + `?t=${m}`);
          await mod.default(page, { ...h, log, context, clinical, studio });
          out += "DONE\n";
        } catch (e) {
          out += `ERROR: ${String(e).split("\n").slice(0, 6).join("\n")}\n`;
        }
        writeFileSync(`${dir}/out.txt`, out);
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
} catch (e) {
  writeFileSync(`${dir}/out.txt`, `REPL STARTUP ERROR: ${String(e).slice(0, 800)}\n`);
} finally {
  await cleanup();
}
