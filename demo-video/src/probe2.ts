import { chromium } from "playwright";
import { VIEWPORT } from "./config.ts";
import * as h from "./helpers.ts";
const cmds = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: VIEWPORT });
try {
  await h.login(page);
  await h.quitAllSessions(page);
  await h.startPositronSession(page);
  await h.openFolderAndTrust(page);
  await h.dismissNotifications(page);
  await h.prepareShell(page);
  for (const c of cmds) await h.typeInTerminal(page, c, { delay: 5, wait: Number(process.env.WAIT ?? 4000) });
  await page.screenshot({ path: "screenshots/probe2.png" });
} finally {
  const p = await browser.newPage({ viewport: VIEWPORT });
  await h.login(p);
  await h.quitAllSessions(p);
  await browser.close();
}
