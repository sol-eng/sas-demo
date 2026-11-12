// SAS Studio story (STORY=studio, EDITION=apro): Posit Workbench launches SAS Studio from the SAS Analytics Pro
// image; test.sas from the shared home directory runs in SAS Studio. No Positron, no connection profile.
//
// SAS Studio signs in with the Workbench login by itself (its /signin page forwards to /main). It remembers the
// last side pane across sessions (Explorer open, closed or another pane), so runTestSas() checks what is shown.
import type { Frame, Page } from "playwright";
import { beat } from "./config.ts";
import * as h from "./helpers.ts";
import { caption, fast } from "./timeline.ts";
import { unzoomBox, zoomOn, zoomOut, zoomToBox } from "./zoom.ts";

const imageField = (page: Page) => page.locator("#rstudio_label_image");
const imageShows = (page: Page, re: RegExp) =>
  page.waitForFunction((src) => new RegExp(src).test(document.querySelector("#rstudio_label_image")?.textContent ?? ""), re.source, { timeout: 15_000 });

/** 01: New Session dialog, Positron's image vs. SAS Studio's image (both highlighted), Launch, wait for SAS Studio. */
export async function launchStudio(page: Page) {
  caption("studioLaunch");
  await h.hclick(page, page.getByRole("button", { name: "New Session", exact: true }).first());
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.waitForTimeout(800);
  await zoomOn(page, dialog, { maxScale: 1.6 });
  // The dialog opens on the last-used IDE: show Positron first, so the image change is visible.
  await h.hclick(page, page.locator("[id$='trigger-Positron']"));
  await imageShows(page, /pwb-session/);
  await beat(800);
  caption("studioImage");
  await h.highlight(page, imageField(page), 2200);
  await h.hclick(page, page.locator("[id$='trigger-SAS Studio']"));
  await imageShows(page, /sas\/apro/);
  await beat(600);
  await h.highlight(page, imageField(page), 3000);
  await beat(500);
  caption("studioStart");
  await h.hclick(page, page.getByRole("button", { name: "Launch" }));
  await zoomOut(page);
  // Workbench starts the pod (~50 s), then SAS Studio signs in and loads (~30 s)
  await fast("wait", async () => {
    await page.waitForURL(/SASStudio\/main/, { timeout: 300_000 });
    await page.locator("#__pane2").waitFor({ timeout: 180_000 });
    await page.waitForTimeout(3000);
  });
}

/** The results iframe of SAS Studio (a srcdoc frame with the ODS images). */
async function resultsFrame(page: Page): Promise<Frame | undefined> {
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    if ((await f.locator("img").count().catch(() => 0)) >= 4) return f;
  }
  return undefined;
}

/** 02: open ~/sas-demo/sas/test.sas from the Explorer, run it, show tables and plots. */
export async function runTestSas(page: Page) {
  caption("studioOpen");
  const items = page.locator("[role=treeitem]");
  const root = items.filter({ hasText: /^sas-analytics-pro$/ });
  for (let i = 0; i < 3 && !(await root.isVisible()); i++) {
    await h.hclick(page, page.locator("#__pane2")); // Explorer (toggles the side pane)
    await page.waitForTimeout(1500);
  }
  await root.waitFor({ timeout: 10_000 });
  // the upper part of the tree: Home, sas-demo, sas (the files in ~ further down stay out of the picture)
  await zoomToBox(page, { x: 40, y: 85, width: 430, height: 420 });
  await fast("fast", async () => {
    for (const name of ["sas-analytics-pro", "Home", "sas-demo", "sas"]) {
      const node = items.filter({ hasText: new RegExp(`^${name}$`) }).first();
      if ((await node.getAttribute("aria-expanded")) !== "true") {
        await h.hclick(page, node, { dbl: true });
        await page.waitForFunction(
          (n) => [...document.querySelectorAll("[role=treeitem]")].some((e) => (e as HTMLElement).innerText === n && e.getAttribute("aria-expanded") === "true"),
          name,
          { timeout: 20_000 },
        );
      }
      await page.waitForTimeout(500);
    }
  });
  const file = items.filter({ hasText: /^test\.sas$/ }).first();
  await beat(600);
  await h.highlight(page, file, 1200);
  await h.hclick(page, file, { dbl: true });
  await page.waitForFunction(() => /proc hpmixed/i.test(document.body.innerText), null, { timeout: 60_000 });
  await zoomOut(page);
  await beat(800);
  // more room for code and results
  await h.hclick(page, page.locator("button[title='Hide pane']").filter({ visible: true }).first());
  await beat(1200);
  caption("studioRun");
  await zoomToBox(page, { x: 40, y: 120, width: 930, height: 680 }); // the program
  await beat(3500);
  await zoomOut(page);
  const run = page.locator("button[id$='codeSubmitButton1']").filter({ visible: true }).first();
  await h.hclick(page, run);
  // the log comes first, with its summary (Errors / Warnings / Notes) on top
  const summary = page.getByText(/^\s*Errors \(\d+\)\s*$/).first();
  const logShown = await fast("wait", () => summary.waitFor({ timeout: 90_000 }).then(() => true, () => false));
  if (logShown) {
    await page.waitForTimeout(800);
    await zoomToBox(page, { x: 990, y: 190, width: 900, height: 170 }, { maxScale: 1.8 });
    await beat(2500);
    await zoomOut(page);
  } else console.log("SAS Studio: no log summary seen, zoom skipped");
  let results: Frame | undefined;
  await fast("wait", async () => {
    for (let i = 0; i < 180 && !(results = await resultsFrame(page)); i++) await page.waitForTimeout(1000);
    if (!results) throw new Error("SAS Studio: no results after 3 minutes");
    await page.waitForTimeout(1500);
  });
  caption("studioResults");
  await zoomToBox(page, { x: 990, y: 180, width: 900, height: 560 }); // HPMIXED tables
  await beat(3000);
  await zoomOut(page);
  // the plots: histogram, Q-Q plot, residuals vs predicted
  const imgs = results!.locator("img");
  for (const k of [1, 2, 3]) {
    await imgs.nth(k).evaluate((e) => e.scrollIntoView({ behavior: "smooth", block: "center" }));
    await page.waitForTimeout(1200);
    const b = await imgs.nth(k).boundingBox();
    if (b) await zoomToBox(page, unzoomBox(page, b), { maxScale: 1.6, pad: 20 });
    await beat(2600);
    await zoomOut(page, 400);
  }
}
