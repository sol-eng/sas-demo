// One-off: clear the Positron workspace state on the demo account, then check a fresh session.
import { chromium } from "playwright";
import { VIEWPORT } from "./config.ts";
import * as h from "./helpers.ts";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: VIEWPORT });
try {
  await h.login(page);
  await h.quitAllSessions(page);
  await h.startPositronSession(page);
  await page.waitForTimeout(8000);
  await h.dismissNotifications(page);
  await h.runInTerminal(page, "clear; ls ~/.positron-server/data/User; rm -rf ~/.positron-server/data/User/workspaceStorage ~/.positron-server/data/User/History ~/.positron-server/User/workspaceStorage ~/.positron-server/User/History ~/.positron-server/User/settings.json.new ~/.positron-server/User/settings.json; echo CLEARED; ls ~/.positron-server/data/User ~/.positron-server/User");
  await page.waitForTimeout(4000);
  await page.screenshot({ path: "screenshots/probe3-a.png" });
  await h.quitAllSessions(page);
  await h.startPositronSession(page);
  await h.openFolderAndTrust(page);
  await page.waitForTimeout(15000);
  await page.screenshot({ path: "screenshots/probe3-b.png" });
} finally {
  const p = await browser.newPage({ viewport: VIEWPORT });
  await h.login(p);
  await h.quitAllSessions(p);
  await browser.close();
}
