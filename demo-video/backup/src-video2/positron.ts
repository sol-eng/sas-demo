// Positron / Workbench UI helpers specific to video 2 (the generic ones live in ../helpers.ts).
import type { BrowserContext, Locator, Page } from "playwright";
import { BASE_URL, requireEnv } from "../config.ts";
import * as h from "../helpers.ts";

// ------------------------------------------------------------ workbench ----

export const newSessionButton = (page: Page) => page.getByRole("button", { name: "New Session", exact: true }).first();
export const projectsTab = (page: Page) => page.getByRole("link", { name: "Projects", exact: true });
export const credentialsSettings = (page: Page) => page.getByRole("link", { name: "Managed credentials settings" });
// The row button is icon-only until hovered; data-action tells the two states apart.
export const signInButton = (page: Page) => page.locator("button[data-action=sign-in]");
export const signOutButton = (page: Page) => page.locator("button[data-action=sign-out]");

/** Home page -> New Session dialog -> Managed Credentials settings. */
export async function openCredentialSettings(page: Page) {
  await page.goto(BASE_URL);
  await newSessionButton(page).click();
  await credentialsSettings(page).click();
  await signInButton(page).or(signOutButton(page)).first().waitFor({ timeout: 30_000 });
}

/** Unrecorded sign-in to SAS Viya CAF (popup -> "Sign in with Keycloak"). No-op when already signed in. */
export async function ensureViyaSignedIn(page: Page, context: BrowserContext) {
  await openCredentialSettings(page);
  if (await signOutButton(page).count()) return;
  const popupPromise = context.waitForEvent("page");
  await signInButton(page).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await popup.getByRole("link", { name: "Sign in with Keycloak" }).click();
  await finishKeycloakPopup(popup);
  await signOutButton(page).waitFor({ timeout: 60_000 });
}

/** With a live Keycloak session the SAS Logon window closes by itself; otherwise Keycloak asks for credentials. */
export async function finishKeycloakPopup(popup: Page, type: (loc: Locator, text: string) => Promise<void> = (l, t) => l.fill(t)) {
  const kcLogin = popup.locator("#kc-login");
  const outcome = await Promise.race([
    popup.waitForEvent("close").then(() => "closed" as const),
    kcLogin.waitFor({ timeout: 20_000 }).then(() => "form" as const).catch(() => "closed" as const),
  ]);
  if (outcome === "form" && !popup.isClosed()) {
    await type(popup.locator("#username"), requireEnv("DEMO_U"));
    await type(popup.locator("#password"), requireEnv("DEMO_P"));
    await kcLogin.click();
    await popup.waitForEvent("close", { timeout: 60_000 }).catch(() => {});
  }
}

/** Unrecorded: make sure SAS Viya CAF is signed out, so the recording can show the sign-in. */
export async function ensureViyaSignedOut(page: Page) {
  await openCredentialSettings(page);
  if (await signOutButton(page).count()) {
    await signOutButton(page).click();
    await signInButton(page).waitFor({ timeout: 30_000 });
  }
}

/** Home -> New Session dialog (default Positron Pro, default image) -> Launch, wait for Positron. */
export async function launchPositron(page: Page) {
  await page.goto(BASE_URL);
  await newSessionButton(page).click();
  await page.getByRole("button", { name: "Launch" }).click();
  await page.locator(".monaco-workbench").waitFor({ timeout: 180_000 });
}

// ------------------------------------------------------------- positron ----

/** A pane of the SAS view, found by its section button ("Clinical Workspace Section", ...). */
export const sasPane = (page: Page, section: string | RegExp) =>
  page.locator(".pane", { has: page.getByRole("button", { name: section }) }).first();

export const treeRow = (pane: Locator, name: string) =>
  pane.locator(".monaco-list-row").filter({ hasText: new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) }).first();

/** Wait until an element has stopped moving (the SAS view re-renders while a session becomes active). */
export async function settled(loc: Locator, stableMs = 600, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let prev = "";
  let since = Date.now();
  while (Date.now() < deadline) {
    const b = await loc.boundingBox().catch(() => null);
    const key = b ? `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.height)}` : "";
    if (key !== prev) {
      prev = key;
      since = Date.now();
    } else if (key && Date.now() - since >= stableMs) {
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** hclick that first waits for the target to hold still. */
export async function stableClick(page: Page, loc: Locator, opts: Parameters<typeof h.hclick>[2] = {}) {
  await loc.waitFor({ state: "visible", timeout: 60_000 });
  await settled(loc);
  await h.hclick(page, loc, opts);
}

/**
 * Scroll a tree so that `row` is fully inside its (small) pane, using the mouse wheel.
 * Without this a row can sit half under the next pane's header and the click lands on the wrong row.
 */
export async function revealRow(page: Page, pane: Locator, row: Locator) {
  await row.waitFor({ state: "visible", timeout: 30_000 });
  for (let i = 0; i < 8; i++) {
    const r = await row.boundingBox();
    const pb = await pane.boundingBox();
    if (!r || !pb) return;
    const top = pb.y + 24; // below the pane header
    const bottom = pb.y + pb.height;
    if (r.y >= top && r.y + r.height <= bottom) return;
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2, { steps: 5 });
    await page.mouse.wheel(0, r.y < top ? -60 : 60);
    await page.waitForTimeout(400);
  }
}

/** Expand a tree row if it is collapsed (with a visible click). */
export async function expandRow(page: Page, pane: Locator, name: string) {
  const row = treeRow(pane, name);
  await revealRow(page, pane, row);
  if ((await row.getAttribute("aria-expanded")) === "false") {
    await stableClick(page, row, { steps: 12 });
    await page.waitForTimeout(1200);
  }
}

/** Right-click with a visible mouse movement. */
export async function rightClick(page: Page, loc: Locator) {
  await loc.waitFor({ state: "visible", timeout: 30_000 });
  await settled(loc);
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const b = await loc.boundingBox();
  if (!b) throw new Error("No bounding box for " + loc);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
  await page.waitForTimeout(300);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: "right" });
}

/**
 * Pick an entry of a context menu: move the mouse over it, then press Enter
 * (a plain click on these menu entries is unreliable). `enter: false` only
 * hovers, which opens a submenu.
 */
export async function menuItem(page: Page, label: string | RegExp, opts: { enter?: boolean; pause?: number } = {}) {
  const item = page.locator(".context-view .action-label").filter({ hasText: label }).first();
  await item.waitFor({ state: "visible", timeout: 15_000 });
  const b = await item.boundingBox();
  if (!b) throw new Error("No bounding box for menu item " + label);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy, { steps: 12 });
  await page.waitForTimeout(opts.pause ?? 800);
  // the menu only acts on Enter once the entry has focus; a hover does not always get there
  const focused = () => item.evaluate((el) => !!el.closest(".action-item")?.classList.contains("focused")).catch(() => false);
  for (let i = 0; i < 4 && !(await focused()); i++) {
    await page.mouse.move(cx + 6, cy + 2, { steps: 4 });
    await page.mouse.move(cx, cy, { steps: 4 });
    await page.waitForTimeout(400);
  }
  if (opts.enter ?? true) await page.keyboard.press("Enter");
}

/**
 * Close every open editor tab. (The command palette does not open in this headless web client;
 * middle-clicking a tab works, with its hover close button as a fallback.)
 */
export async function closeAllEditors(page: Page) {
  const tabs = page.locator(".tabs-container .tab");
  for (let i = 0; i < 20; i++) {
    const n = await tabs.count();
    if (!n) return;
    await tabs.first().click({ button: "middle" });
    await page.waitForTimeout(600);
    if ((await tabs.count()) >= n) {
      await tabs.first().hover();
      await tabs.first().locator(".tab-actions .action-label").click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(600);
    }
  }
}

/** Run a line in the active console and wait until `done` shows up in the console text. */
export async function runInConsole(page: Page, code: string, done: RegExp, timeoutMs = 90_000) {
  await page.getByRole("tab", { name: "Console", exact: true }).click();
  const input = page.locator(".console-input").last();
  await input.waitFor({ timeout: 60_000 });
  await input.click();
  await page.waitForTimeout(500);
  await page.keyboard.type(code, { delay: 15 });
  await page.keyboard.press("Enter");
  const deadline = Date.now() + timeoutMs;
  while (!done.test(await h.consoleText(page))) {
    if (Date.now() > deadline) throw new Error(`Console did not show ${done} in time`);
    await page.waitForTimeout(1000);
  }
}

/** The "New" button of Positron's top toolbar (other elements can also contain the text "New"). */
export async function newMenuButton(page: Page): Promise<Locator> {
  const candidates = page.getByText("New", { exact: true });
  await candidates.first().waitFor({ timeout: 30_000 });
  for (const c of await candidates.all()) {
    const b = await c.boundingBox();
    if (b && b.y < 60 && b.x < 250) return c;
  }
  throw new Error("Toolbar 'New' button not found");
}
