// Render every card to screenshots/card-*.png and (caption mode) every caption bar and a speed badge to
// screenshots/caption-*.png (no Workbench needed). EDITION / STORY select the wording.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { VIEWPORT } from "./config.ts";
import { CAPTIONS, CAPTION_MODE, CARDS, LAYOUT, mountCard, overlayHtml, removeCard } from "./cards.ts";

mkdirSync("screenshots", { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT, bypassCSP: true });
const page = await context.newPage();
await page.setContent("<body style='margin:0;background:#fff'>behind the card</body>");
for (const [key, card] of Object.entries(CARDS)) {
  await mountCard(page, card, { fadeIn: false });
  await page.screenshot({ path: `screenshots/card-${key}.png` });
  await removeCard(page);
  console.log(`screenshots/card-${key}.png`);
}
if (CAPTION_MODE) {
  await page.setViewportSize({ width: 1920, height: LAYOUT.band.height });
  for (const [id, caption] of Object.entries(CAPTIONS)) {
    await page.setContent(overlayHtml({ caption }));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `screenshots/caption-${id}.png` });
    console.log(`screenshots/caption-${id}.png`);
  }
  await page.setViewportSize({ width: 200, height: 60 });
  await page.setContent(overlayHtml({ speed: 3 }));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "screenshots/caption-badge.png", omitBackground: true });
}
await browser.close();
