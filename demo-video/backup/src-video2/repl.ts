// Dev REPL for video 2: one fresh Positron session (default image, SAS Viya CAF
// already signed in), snippets run from <dir>/cmd.mjs: export default async (page, h) => ...
// Usage: npx tsx src/video2/repl.ts <dir>   (writes <dir>/ready, results in <dir>/out.txt, <dir>/stop ends it)
import { chromium } from "playwright";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { BASE_URL, VIEWPORT } from "../config.ts";
import * as h from "../helpers.ts";
import { ensureViyaSignedIn } from "./positron.ts";

const dir = process.argv[2];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: VIEWPORT, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
const cleanup = async () => {
  try {
    const p = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
    await h.login(p);
    await h.quitAllSessions(p);
  } finally {
    await browser.close();
    process.exit(0);
  }
};
try {
  await h.login(page);
  await h.quitAllSessions(page);
  await ensureViyaSignedIn(page, context);
  await page.goto(BASE_URL);
  await page.getByRole("button", { name: "New Session", exact: true }).first().click();
  await page.getByRole("button", { name: "Launch" }).click();
  await page.locator(".monaco-workbench").waitFor({ timeout: 180_000 });
  await page.waitForTimeout(3000);
  // same window as in the demo: the caf-project folder (created by a previous demo run)
  await page.goto(`${page.url().split("?")[0]}?folder=/home/demouser/caf-project`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (document.querySelector(".window-title")?.textContent ?? "").includes("caf-project"), null, { timeout: 120_000 });
  await page.waitForTimeout(8000);
  writeFileSync(`${dir}/ready`, "ok");
  let last = 0;
  for (;;) {
    if (existsSync(`${dir}/stop`)) break;
    if (existsSync(`${dir}/cmd.mjs`)) {
      const m = statSync(`${dir}/cmd.mjs`).mtimeMs;
      if (m !== last) {
        last = m;
        let out = "";
        const log = (...a: unknown[]) => { out += a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n"; };
        try {
          const mod = await import(pathToFileURL(`${dir}/cmd.mjs`).href + `?t=${m}`);
          await mod.default(page, { ...h, log, context });
          out += "DONE\n";
        } catch (e) {
          out += `ERROR: ${String(e).split("\n").slice(0, 6).join("\n")}\n`;
        }
        writeFileSync(`${dir}/out.txt`, out);
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
} catch (e) {
  writeFileSync(`${dir}/out.txt`, `REPL STARTUP ERROR: ${String(e).slice(0, 800)}\n`);
} finally {
  await cleanup();
}
