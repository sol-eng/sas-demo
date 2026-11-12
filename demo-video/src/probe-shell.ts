// Dev probe: run shell commands (PROBE_CMDS, separated by ";;") in the Positron terminal of a fresh Apro session, screenshot after each.
import { chromium } from "playwright";
import { VIEWPORT } from "./config.ts";
import * as h from "./helpers.ts";
const OUT = process.env.PROBE_DIR!;
const cmds = (process.env.PROBE_CMDS ?? "").split(";;").map((c) => c.trim()).filter(Boolean);
const waitSec = Number(process.env.PROBE_WAIT ?? 4);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: VIEWPORT });
try {
  await h.login(page);
  await h.quitAllSessions(page);
  await h.startPositronSession(page);
  await h.openFolderAndTrust(page);
  await h.dismissNotifications(page);
  await h.closeAllEditors(page);
  await page.getByRole("tab", { name: /Terminal/i }).click();
  // maximize the bottom panel so more output is visible
  await page.keyboard.press("Control+`").catch(() => {});
  let i = 0;
  for (const entry of cmds) {
    // "<seconds>|<command>" sets a per-command wait
    const m = entry.match(/^(\d+)\|(.*)$/s);
    const c = m ? m[2] : entry;
    await h.typeInTerminal(page, c, { delay: 5, wait: (m ? Number(m[1]) : waitSec) * 1000 });
    await page.screenshot({ path: `${OUT}/cmd-${++i}.png` });
  }
} finally {
  await h.quitAllSessions(page).catch(() => {});
  await browser.close();
}
