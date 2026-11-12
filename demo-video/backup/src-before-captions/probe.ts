// Dev probe: throwaway session -> install extension -> copy a profile to settings.json -> reload -> report the SAS console -> remove the profile.
import { chromium } from "playwright";
import { VIEWPORT } from "./config.ts";
import * as h from "./helpers.ts";
const file = process.argv[2] ?? "apro.profile";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: VIEWPORT });
try {
  await h.login(page);
  await h.quitAllSessions(page);
  await h.startPositronSession(page);
  await h.openFolderAndTrust(page);
  await h.dismissNotifications(page);
  await h.prepareShell(page);
  await h.removeProfile(page);
  await h.installSasExtension(page);
  await h.reloadSession(page);
  await h.closeAllEditors(page);
  await h.prepareShell(page);
  await h.typeInTerminal(page, h.showProfileCmd(file), { delay: 5 });
  await h.typeInTerminal(page, h.addProfileCmd(file), { delay: 5 });
  await page.screenshot({ path: "screenshots/probe-merged.png" });
  await h.reloadSession(page);
  await page.waitForTimeout(40_000);
  await page.getByRole("tab", { name: "Console", exact: true }).click();
  await page.getByRole("button", { name: "Select Session" }).click().catch((e) => console.log("no Select Session button", String(e).slice(0, 80)));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "screenshots/probe-session-menu.png" });
  await page.getByText("New Console Session...", { exact: true }).filter({ visible: true }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "screenshots/probe-session-menu2.png" });
  await h.prepareShell(page);
  await h.removeProfile(page);
} finally {
  const p = await browser.newPage({ viewport: VIEWPORT });
  await h.login(p);
  await h.quitAllSessions(p);
  await browser.close();
}
