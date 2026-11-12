// Workbench managed-credentials (SAS Viya CAF OAuth) helpers for the Viya edition,
// carried over from the former video 2 (see backup/src-video2/positron.ts).
import type { BrowserContext, Locator, Page } from "playwright";
import { BASE_URL, beat, requireEnv } from "./config.ts";
import * as h from "./helpers.ts";

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

/** Unrecorded pre-roll of the Viya edition: clean sessions, signed out of SAS Viya CAF, clean home page. */
export async function prepareViya(page: Page) {
  await h.login(page);
  await h.quitAllSessions(page);
  await ensureViyaSignedOut(page);
  await page.goto(BASE_URL); // clean home page, no dialog
  await newSessionButton(page).waitFor({ timeout: 60_000 });
}

/**
 * Unrecorded (dev aids, probes): clean state, sign in to SAS Viya CAF with managed credentials and launch
 * Positron from the New Session dialog - the same path as steps 1a-1d, without the pauses.
 */
export async function signInAndLaunchQuietly(page: Page, context: BrowserContext) {
  await prepareViya(page);
  await openCredentialSettings(page);
  const popupPromise = context.waitForEvent("page");
  await signInButton(page).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await popup.getByRole("link", { name: "Sign in with Keycloak" }).click();
  await finishKeycloakPopup(popup);
  await signOutButton(page).waitFor({ timeout: 60_000 });
  await projectsTab(page).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Launch" }).click();
  await page.locator(".monaco-workbench").waitFor({ timeout: 180_000 });
}

// ---- recorded steps (same storyline as the former video 2, steps 1a-1d) ----

export async function openManagedCredentials(page: Page) {
  await beat(1500); // home page
  await h.hclick(page, newSessionButton(page));
  await page.getByRole("dialog").waitFor();
  await beat(1500);
  await h.hclick(page, credentialsSettings(page)); // gear next to "Session Credentials"
  await page.getByText("SAS Viya CAF", { exact: true }).first().waitFor();
  await beat(1500);
  await h.highlight(page, signInButton(page), 2500);
}

/** Signing in opens SAS Logon in its own browser window; the caller records it for the overlay. */
export async function signInToViya(page: Page, context: BrowserContext, onPopup: (popup: Page, startedAt: () => void) => void) {
  const popupPromise = context.waitForEvent("page");
  await h.hclick(page, signInButton(page));
  const popup = await popupPromise;
  onPopup(popup, () => {});
  await popup.waitForLoadState("domcontentloaded");
  await popup.bringToFront();
  await beat(2500);
  await h.hclick(popup, popup.getByRole("link", { name: "Sign in with Keycloak" }));
  await finishKeycloakPopup(popup, (loc, text) => loc.pressSequentially(text, { delay: 120 }));
  await page.bringToFront();
  await signOutButton(page).waitFor({ timeout: 60_000 }); // signed in: the row button turns blue
  await beat(3000);
}

export async function backToSessionDialog(page: Page) {
  await h.hclick(page, projectsTab(page));
  await page.getByRole("dialog").waitFor();
  await beat(2000);
  // The arrow next to "Custom OAuth Credentials" lists the integration that provides the token
  await h.hclick(page, page.getByRole("button", { name: "Expand credentials list" }));
  await beat(3500);
}

export async function launchPositronFromDialog(page: Page) {
  await h.hclick(page, page.getByRole("button", { name: "Launch" }));
  await page.locator(".monaco-workbench").waitFor({ timeout: 180_000 });
  await beat(4000);
}
