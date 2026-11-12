// Dev probe (fast, no assistant, no SAS): open ~/housing, create a new Quarto document via New > New File,
// Preview it, then use the shared showReportWindow() (standalone window + scroll). Screenshots in PROBE_DIR.
//   PROBE_DIR=<dir> npx tsx src/probe-quarto.ts
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { VIEWPORT } from "./config.ts";
import * as h from "./helpers.ts";
import { HOUSING_DIR, showReportWindow } from "./explore.ts";

const OUT = process.env.PROBE_DIR!;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: VIEWPORT, permissions: ["clipboard-read", "clipboard-write"] });
await context.addInitScript(h.CURSOR_SCRIPT);
const page = await context.newPage();
const shot = async (n: string) => {
  await page.screenshot({ path: `${OUT}/${n}.png` }).catch(() => {});
};
const log = (m: string) => {
  console.log(m);
  writeFileSync(`${OUT}/log.txt`, m + "\n", { flag: "a" });
};
try {
  await h.login(page);
  await h.quitAllSessions(page);
  await h.startPositronSession(page);
  await h.openFolderAndTrust(page, undefined, HOUSING_DIR);
  await h.dismissNotifications(page);
  await h.snapshotHousing(page);
  await h.closeAllEditors(page);
  await shot("01-ready");

  // New > New File... > Quarto Document
  await h.hclick(page, page.getByRole("button", { name: /^New/ }).first());
  await page.waitForTimeout(1000);
  await shot("02-new-menu");
  await h.hclick(page, page.getByText("New File...", { exact: true }).filter({ visible: true }).first());
  await page.waitForTimeout(1500);
  await shot("03-new-file-picker");
  // wait for the file-type list (it appears once the extensions are active), then click the entry
  const quarto = page.getByText("Quarto Document", { exact: true }).filter({ visible: true }).first();
  await quarto.waitFor({ timeout: 60_000 });
  await shot("04-picker-filtered");
  await h.hclick(page, quarto);
  await page.waitForTimeout(3000);
  await shot("05-new-doc");

  // Preview
  const preview = page.getByRole("button", { name: /^Preview/ }).first();
  await preview.waitFor({ timeout: 30_000 });
  await h.hclick(page, preview);
  await page.waitForTimeout(4000);
  await shot("06-after-preview-click");
  // an untitled document has to be saved first: handle a save prompt / file name box if one shows up
  const quick = page.locator(".quick-input-widget:visible");
  if (await quick.count()) {
    log("quick input after Preview: " + (await quick.innerText().catch(() => "")).slice(0, 300));
    await page.keyboard.type("probe-quarto.qmd", { delay: 40 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
    await shot("07-after-save-name");
    // saving does not start the preview: press Preview again
    await h.hclick(page, page.getByRole("button", { name: /^Preview/ }).first());
    await page.waitForTimeout(3000);
  }
  const dlg = page.locator(".monaco-dialog-box:visible");
  if (await dlg.count()) {
    log("dialog after Preview: " + (await dlg.innerText().catch(() => "")).slice(0, 300));
    await shot("07b-dialog");
  }
  // give quarto time to render the small document
  await page.waitForTimeout(40_000);
  await shot("08-rendered");

  await showReportWindow(page, context, { shot });
  writeFileSync(`${OUT}/DONE.txt`, "ok");
} catch (e) {
  writeFileSync(`${OUT}/ERROR.txt`, String(e));
  await shot("error");
} finally {
  const p = await context.newPage();
  await h.cleanupProfile(p); // quits sessions, removes settings.json and everything new in ~/housing
  await context.close();
  await browser.close();
}
