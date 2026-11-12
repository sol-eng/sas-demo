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
  await page.keyboard.type("Briefly explain the SAS dataset housing/ahs2023n.sas7bdat in my home directory. It has over 3,000 variables, so do not list them all: restrict yourself to a few key variables (for example household income, home value, number of rooms) and produce up to 3 meaningful plots that help explain some trends in the data.", { delay: 20 });
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
  // answer the assistant's questions as they come: pick the SAS option, then submit / accept
  let submits = 0;
  for (let i = 1; i <= 30; i++) {
    await page.waitForTimeout(10_000);
    const ff = await h.assistantFrame(page);
    if (submits < 3) {
      const radios = ff.getByRole("radio");
      const nRadios = await radios.count();
      if (i === 1 || nRadios) {
        writeFileSync(`${OUT}/radios-${i}.txt`, JSON.stringify(await ff.locator("[role=radio], input[type=radio], label").evaluateAll((n) => n.map((e) => `${e.tagName}|${e.getAttribute("role")}|${(e.textContent ?? "").trim().slice(0, 60)}`))));
      }
      // pick the option that keeps the SAS code (wording varies from run to run); never R / Python / Other
      const sas = nRadios ? radios.filter({ hasText: /SAS/i }).first() : ff.getByText(/SAS code|Keep SAS|SAS cells/i).first();
      if ((await sas.count()) && (await sas.isVisible().catch(() => false))) {
        await sas.click().catch(() => {});
        await page.waitForTimeout(800);
      }
    }
    const allow = ff.getByRole("button", { name: "Allow", exact: true });
    if (await allow.count()) await allow.first().click().catch(() => {});
    const submit = ff.getByRole("button", { name: /Submit Answers|Accept|Continue|Next/ });
    if (submits < 3 && (await submit.count())) {
      submits++;
      writeFileSync(`${OUT}/05-step-${i}.click.txt`, await submit.first().innerText());
      await shot(`05-before-submit-${i}`);
      await submit.first().click().catch(() => {});
    }
    await shot(`05-step-${i}`);
    await dump(`05-step-${i}`);
    const buttons = await ff.getByRole("button").evaluateAll((n) => n.map((e) => (e.textContent ?? "").trim()).filter(Boolean)).catch(() => []);
    writeFileSync(`${OUT}/05-step-${i}.buttons.txt`, JSON.stringify(buttons));
    const editorTabs = await page.locator(".tabs-container .tab").allInnerTexts().catch(() => []);
    writeFileSync(`${OUT}/05-step-${i}.tabs.txt`, JSON.stringify(editorTabs));
    if ((await page.getByRole("tab", { name: /\.qmd/ }).count()) > 0) {
      writeFileSync(`${OUT}/qmd-found-at.txt`, String(i));
      break;
    }
  }
  await page.waitForTimeout(8000);
  await shot("06-qmd");
  const actions = await page.locator(".editor-actions .action-label, .editor-actions a, .editor-actions button").evaluateAll((n) => n.map((e) => (e.getAttribute("aria-label") ?? e.getAttribute("title") ?? e.textContent ?? "").trim()).filter(Boolean));
  writeFileSync(`${OUT}/06-editor-actions.txt`, JSON.stringify(actions, null, 1));
  const prev = page.getByRole("button", { name: /Preview/ }).or(page.locator('[aria-label*="Preview"]')).first();
  if (await prev.count()) {
    await prev.click().catch((e) => writeFileSync(`${OUT}/06-preview-click-error.txt`, String(e)));
    for (let i = 1; i <= 8; i++) {
      await page.waitForTimeout(10_000);
      await shot(`07-preview-${i}`);
    }
    const open = page.getByRole("button", { name: "Select where to open" }).first();
    if (await open.count()) {
      const popupPromise = page.context().waitForEvent("page", { timeout: 20_000 }).catch(() => null);
      await open.click().catch(() => {});
      const popup = await popupPromise;
      if (popup) {
        await popup.waitForLoadState("domcontentloaded").catch(() => {});
        await popup.bringToFront();
        await page.waitForTimeout(4000);
        await popup.screenshot({ path: `${OUT}/08-popup-top.png` });
        writeFileSync(`${OUT}/08-popup-text.txt`, (await popup.locator("body").innerText().catch(() => "")).slice(0, 3000));
        for (let i = 0; i < 12; i++) { await popup.mouse.wheel(0, 500); await popup.waitForTimeout(300); }
        await popup.screenshot({ path: `${OUT}/08-popup-mid.png` });
      }
    }
  }
} catch (e) {
  writeFileSync(`${OUT}/ERROR.txt`, String(e));
  await shot("error").catch(() => {});
} finally {
  const p = await browser.newPage({ viewport: VIEWPORT });
  await h.cleanupProfile(p);
  await browser.close();
}
