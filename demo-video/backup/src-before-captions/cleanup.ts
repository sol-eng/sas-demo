// Quit all Workbench sessions of the demo user.
import { chromium } from "playwright";
import { VIEWPORT } from "./config.ts";
import { login, quitAllSessions } from "./helpers.ts";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: VIEWPORT });
await login(page);
await quitAllSessions(page);
console.log("all sessions quit");
await browser.close();
