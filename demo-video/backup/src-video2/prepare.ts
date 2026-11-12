// Unrecorded pre-roll for video 2: bring the account into the state the storyline expects.
//
//  - signed in to SAS Viya CAF (needed to reach the Clinical Repository), then a throwaway
//    Positron session is used to
//      * move ~/caf-project aside to ~/caf-project.bak-<timestamp> (nothing is deleted)
//      * delete Curanex-XR (with everything below it) from the Clinical Workspace
//  - all sessions quit, signed out of SAS Viya CAF again so the recording can show the sign-in
import type { BrowserContext, Page } from "playwright";
import { BASE_URL } from "../config.ts";
import * as h from "../helpers.ts";
import {
  ensureViyaSignedIn, ensureViyaSignedOut, launchPositron, newSessionButton,
  sasPane, treeRow, expandRow, rightClick, menuItem, runInConsole,
} from "./positron.ts";

const MOVE_CAF_PROJECT_ASIDE =
  'if (dir.exists("~/caf-project")) file.rename("~/caf-project", path.expand(paste0("~/caf-project.bak-", format(Sys.time(), "%Y%m%d-%H%M%S")))); ' +
  'cat("CAFDIR_", dir.exists("~/caf-project"), "\\n", sep = "")';

async function clearClinicalWorkspace(page: Page) {
  await page.getByRole("tab", { name: "SAS", exact: true }).click();
  const ws = sasPane(page, "Clinical Workspace Section");
  await expandRow(page, ws, "PositLabs");
  await page.waitForTimeout(3000); // children load lazily
  const folder = treeRow(ws, "Curanex-XR");
  if (!(await folder.count())) {
    console.log("prepare: Clinical Workspace is already empty");
    return;
  }
  await rightClick(page, folder);
  await menuItem(page, /^Delete$/);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await folder.waitFor({ state: "detached", timeout: 60_000 });
  console.log("prepare: deleted Curanex-XR from the Clinical Workspace");
}

export async function prepareServer(page: Page, context: BrowserContext) {
  await h.login(page);
  await h.quitAllSessions(page);
  await ensureViyaSignedIn(page, context);
  await launchPositron(page);
  await h.dismissNotifications(page);
  try {
    // wait for R to be up, then use its console for the file system part
    await page.getByRole("tab", { name: "Console", exact: true }).click();
    const deadline = Date.now() + 180_000;
    while (!/to quit R/.test(await h.consoleText(page))) {
      if (Date.now() > deadline) throw new Error("R console did not start");
      await page.waitForTimeout(1500);
    }
    await runInConsole(page, MOVE_CAF_PROJECT_ASIDE, /CAFDIR_FALSE/);
    console.log("prepare: ~/caf-project is out of the way");
    await clearClinicalWorkspace(page);
  } finally {
    await page.screenshot({ path: "screenshots/video2/prepare-end.png" }).catch(() => {});
  }
  await h.quitAllSessions(page);
  await ensureViyaSignedOut(page);
  await page.goto(BASE_URL); // clean home page, no dialog
  await newSessionButton(page).waitFor({ timeout: 60_000 });
}
