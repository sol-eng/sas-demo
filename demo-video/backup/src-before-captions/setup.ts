// Unrecorded pre-step: bring the server checkout up to date and (re)create the
// sas7bdat files by running create_data.sas. Uses a throwaway Positron session
// and always cleans up afterwards.
import { chromium } from "playwright";
import { VIEWPORT } from "./config.ts";
import {
  login, startPositronSession, openFolderAndTrust, dismissNotifications,
  runActiveSasFile, runInTerminal, submitInSasConsole, consoleText, quitAllSessions,
  enableProfile, cleanupProfile, installSasExtension, prepareShell, reloadSession,
} from "./helpers.ts";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: VIEWPORT });
try {
  await login(page);
  await quitAllSessions(page); // start from a clean slate
  await startPositronSession(page);
  await openFolderAndTrust(page);
  await dismissNotifications(page);

  // Sync the checkout. Local edits to tracked SAS files (e.g. a manual rootdir
  // workaround) are stashed, not discarded, so they stay recoverable.
  await runInTerminal(page, "cd ~/sas-demo && git stash push -m demo-setup -- sas || true; git pull --ff-only && git log --oneline -1");
  await page.waitForTimeout(8000);

  // The SAS session needs the connection profile (removed again below)
  await prepareShell(page);
  await installSasExtension(page);
  await reloadSession(page);
  await enableProfile(page, "apro.profile", "apro");

  // Recreate the data
  await page.getByText("create_data.sas", { exact: true }).dblclick();
  await page.getByRole("tab", { name: /create_data\.sas/ }).waitFor();
  await runActiveSasFile(page);

  // Verify both files exist
  await submitInSasConsole(
    page,
    "%put CHECK root=%sysfunc(fileexist(%sysget(HOME)/sas-demo/large_study_data.sas7bdat)) quarto=%sysfunc(fileexist(%sysget(HOME)/sas-demo/quarto/large_study_data.sas7bdat));",
  );
  await page.waitForTimeout(5000);
  const m = (await consoleText(page)).match(/CHECK root=(\d) quarto=(\d)/g)?.pop();
  console.log(m);
  if (m !== "CHECK root=1 quarto=1") throw new Error("sas7bdat files were not created");
  console.log("setup ok");
} finally {
  await page.screenshot({ path: "screenshots/19-setup-end.png" }).catch(() => {});
  const cleanup = await browser.newPage({ viewport: VIEWPORT });
  await cleanupProfile(cleanup); // removes the profile and quits all sessions
  await browser.close();
}
