// Dev probe: Analytics Pro session, then the exploratory-analysis flow in Posit Assistant (screenshots + text dumps).
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { VIEWPORT } from "./config.ts";
import * as h from "./helpers.ts";
const OUT = process.env.PROBE_DIR!;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: VIEWPORT });
const shot = (n: string) => page.screenshot({ path: `${OUT}/${n}.png` });
const dump = async (n: string) => {
  const f = await h.assistantFrame(page);
  writeFileSync(`${OUT}/${n}.txt`, (await f.locator("body").innerText().catch(() => "")).slice(-3500));
};
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
  await page.getByRole("tab", { name: /Posit Assistant/ }).click();
  const f = await h.assistantFrame(page);
  await page.waitForTimeout(6000);
  await shot("01-assistant");
  const btns = await f.getByRole("button").evaluateAll((n) => n.map((e) => (e.getAttribute("aria-label") ?? e.getAttribute("title") ?? e.textContent ?? "").trim()).filter(Boolean));
  writeFileSync(`${OUT}/buttons.txt`, JSON.stringify(btns, null, 1));
  await h.hclick(page, f.getByRole("button", { name: "New conversation", exact: true }));
  await page.waitForTimeout(1500);
  await h.hclick(page, f.locator(".tiptap-input-editor"));
  await page.keyboard.type("Analyze large_study_data.sas7bdat and come up with 2 interesting plots", { delay: 20 });
  await page.keyboard.press("Enter");
  await h.settleAssistant(page, { quietSec: 12, minSec: 20, maxSec: 360 });
  await shot("02-after-plots");
  await dump("02-after-plots");
  await h.hclick(page, f.locator(".tiptap-input-editor"));
  await page.keyboard.type("/report", { delay: 80 });
  await page.waitForTimeout(1500);
  await shot("03-slash");
  await dump("03-slash");
  await page.keyboard.press("Enter");
  for (let i = 1; i <= 12; i++) {
    await page.waitForTimeout(10_000);
    await shot(`04-report-${i}`);
    await dump(`04-report-${i}`);
    const ff = await h.assistantFrame(page);
    const buttons = await ff.getByRole("button").evaluateAll((n) => n.map((e) => (e.textContent ?? "").trim()).filter(Boolean)).catch(() => []);
    writeFileSync(`${OUT}/04-report-${i}.buttons.txt`, JSON.stringify(buttons));
  }
} catch (e) {
  writeFileSync(`${OUT}/ERROR.txt`, String(e));
  await shot("error").catch(() => {});
} finally {
  const p = await browser.newPage({ viewport: VIEWPORT });
  await h.cleanupProfile(p);
  await browser.close();
}
