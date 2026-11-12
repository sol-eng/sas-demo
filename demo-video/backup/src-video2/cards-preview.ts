// Render the video 2 cards to screenshots/video2/card-*.png (no Workbench needed).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { VIEWPORT } from "../config.ts";
import { CARDS, mountCard, removeCard } from "./cards.ts";

mkdirSync("screenshots/video2", { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT, bypassCSP: true });
const page = await context.newPage();
await page.setContent("<body style='margin:0;background:#fff'>behind the card</body>");
for (const [key, card] of Object.entries(CARDS)) {
  await mountCard(page, card, { fadeIn: false });
  await page.screenshot({ path: `screenshots/video2/card-${key}.png` });
  await removeCard(page);
  console.log(`screenshots/video2/card-${key}.png`);
}
await browser.close();
