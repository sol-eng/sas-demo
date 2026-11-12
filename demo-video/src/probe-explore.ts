// Dev probe: Analytics Pro session, then the shared explore() chapter with screenshots. PROBE_DIR=<dir> npx tsx src/probe-explore.ts
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { VIEWPORT } from "./config.ts";
import * as h from "./helpers.ts";
import { explore } from "./explore.ts";
const OUT = process.env.PROBE_DIR!;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: `${OUT}/video`, size: VIEWPORT }, permissions: ["clipboard-read", "clipboard-write"] });
await context.addInitScript(h.CURSOR_SCRIPT);
const page = await context.newPage();
const shot = async (n: string) => { await page.screenshot({ path: `${OUT}/${n}.png` }).catch(() => {}); };
try {
  await h.login(page);
  await h.quitAllSessions(page);
  await h.startPositronSession(page);
  await h.openFolderAndTrust(page);
  await h.dismissNotifications(page);
  await h.prepareShell(page);
  await h.installSasExtension(page);
  await h.reloadSession(page);
  await h.closeAllEditors(page);
  await h.enableProfile(page, "apro.profile", "apro");
  const t0 = Date.now();
  const cuts: { startSec: number; endSec: number }[] = [];
  await explore(page, context, { shot, since: () => (Date.now() - t0) / 1000, cuts });
  writeFileSync(`${OUT}/cuts.json`, JSON.stringify(cuts));
  writeFileSync(`${OUT}/DONE.txt`, "ok");
  // what did the run leave in the home directory?
  await h.hclick(page, page.getByRole("tab", { name: /^Terminal/ }));
  await h.hclick(page, page.getByText("bash", { exact: true }).first()); // not the Quarto Preview terminal
  await h.typeInTerminal(page, "cd ~/sas-demo && git status --short && ls quarto | head -30 && ls ~/housing");
  await page.waitForTimeout(3000);
  await shot("z-state");
} catch (e) {
  writeFileSync(`${OUT}/ERROR.txt`, String(e));
  await shot("error");
} finally {
  const p = await context.newPage();
  await h.cleanupProfile(p);
  await context.close();
  await browser.close();
}
