// Remove the connection profile (user settings.json) from the demo account and quit all sessions.
import { chromium } from "playwright";
import { VIEWPORT } from "./config.ts";
import { cleanupProfile } from "./helpers.ts";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: VIEWPORT });
await cleanupProfile(page);
await browser.close();
