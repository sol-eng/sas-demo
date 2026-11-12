# Demo video automation

Playwright (TypeScript) scripts that drive Posit Workbench and record two demo stories, each for two
editions (SAS Analytics Pro over ssh, SAS Viya over REST), plus a Viya-only Clinical Acceleration story and two
Analytics Pro-only stories (SAS Studio, and Positron with the local SAS of the Analytics Pro image):

| Story | Command | Output |
|---|---|---|
| Base: `sas/test.sas`, plots, connections, Data Explorer, Convert to Code, Fix, ask about a plot | `npm run demo:apro` / `npm run demo:viya` | `videos/demo-apro.mp4` / `videos/demo-viya.mp4` |
| Housing: explain a SAS dataset with Posit Assistant, `/report`, Quarto Preview in a standalone window | `npm run demo:apro:housing` / `npm run demo:viya:housing` | `videos/demo-apro-housing.mp4` / `videos/demo-viya-housing.mp4` |
| Clinical Acceleration (Viya only): set up the repository project with `../scripts`, check out / edit / check in `test.sas`, copy the study data to the workspace and read it in SAS | `npm run demo:viya:clinical` | `videos/demo-viya-clinical.mp4` |
| SAS Studio (Analytics Pro only, no Positron): New Session > SAS Studio from the SAS Analytics Pro image, run `test.sas` in SAS Studio | `npm run demo:apro:studio` | `videos/demo-apro-studio.mp4` |
| Local SAS (Analytics Pro only): Positron from the SAS Analytics Pro image, the auto-added `local` (stdio) profile, run `test.sas` | `npm run demo:apro:local` | `videos/demo-apro-local.mp4` |

## Prerequisites

- Node 20+, `ffmpeg` on the `PATH`, and Playwright's Chromium (`npx playwright install chromium`).
- `DEMO_U` / `DEMO_P` set to the Workbench SSO credentials.
- The Workbench server needs a clone of this repo at `~/sas-demo`, the SAS extension installed
  (`~/positron-sas-0.5.3.vsix`) and the connection profiles `~/apro.profile` and `~/viya.profile`
  (complete settings files that are copied over the user `settings.json`).
- Clinical story: extension **0.6.0-dev.23** (`~/positron-sas-0.6.0-dev.23.vsix`; downloaded from the GitHub
  pre-release by `installSasExtension` if missing). Clinical jobs, Run and Populate and Test need 0.6.0-dev.22+.
- SAS Studio story: the Workbench "SAS Studio" session type (image `…/sas/apro:<version>`, SAS Studio signs in
  with the Workbench login) and `~/sas-demo` with `large_study_data.sas7bdat` (`npm run setup`).
- Local SAS story: the SAS extension >= 0.4.0 installed for the user (adds the `local` stdio profile when it
  finds `/opt/sas/viya/home/SASFoundation/sas`), and the `…/sas/apro:<version>` image offered for Positron sessions.
- Viya edition: the demo user signs in to SAS Viya with managed credentials (OAuth) during the recording.
- Housing story only: the dataset `~/housing/ahs2023n.sas7bdat` (Positron opens `~/housing` as its workspace), the Quarto
  report skill of the extension, and the SAS host trusted by ssh for the demo user (Analytics Pro; see "Known issues").

## Usage

```sh
npm install
npm run setup          # not recorded: pull the repo, run create_data.sas, check both sas7bdat files exist
npm run demo:apro      # records (retries up to 3 times), then finalizes -> videos/demo-apro.mp4
npm run demo:viya
HEADED=1 npm run demo:apro   # watch it run
npm run cleanup        # quit all Workbench sessions of the demo user (also done automatically)
npm run cleanup:profile  # remove the connection profile (settings.json) and the files the housing story leaves behind
```

A run always starts from a fresh Positron session and cleans up after itself, even on failure:
sessions are quit, the connection profile (`settings.json`) is removed and the report files written by the
housing story are removed again: `~/housing_report` (the folder the report skill creates), everything new in `~/housing`
(compared with a file list taken at the start) and the leftovers of earlier runs in `~/sas-demo`.
`EDITION=apro|viya [STORY=housing] npx tsx src/demo.ts` records without finalizing; `npm run finalize` (with the same
variables) post-processes the last recording.

## Final video (`src/finalize.ts`)

All videos use **caption mode**:

- **Caption bar:** the screen is scaled to 1600x900 with a caption bar beneath it (chapter number and label, a
  headline, one line). The scripts switch captions with `caption(id)` (`src/timeline.ts`); the wording is in
  `CAPTIONS` in `src/cards.ts`. Title, architecture and closing card stay full frame.
- **Speed-ups with a badge:** the scripts mark stretches with `fast("fast" | "wait", ...)` (typing and clicking
  through / waiting for SAS, Posit Assistant, session start). finalize picks the smallest factors (1.5x, 2x, 3x ...)
  that bring the video to `TARGET_SEC` (default 180 s, housing 300 s) and shows a "3x" badge while a stretch plays
  faster. `SPEED_FAST=2 SPEED_WAIT=6 npm run finalize` forces factors.
- **Zoom:** `src/zoom.ts` scales the Positron UI with a CSS transform while recording, so the region of interest
  (console, Viewer, Assistant chat, Convert to Code dialog ...) fills the screen with sharp text. `hclick` zooms
  out by itself before clicking into an iframe (Assistant, Viewer), where hit-testing would miss.
- **Music:** `assets/music.mp3` (or `.m4a` / `.wav`, or `MUSIC=path`) is looped, leveled (-26 LUFS) and faded in
  and out. The credit line comes from `assets/music-credit.txt` (or `MUSIC_CREDIT`) and is shown on the closing card.
  Without a music file the video is silent.
- `TIMING=... OUT=...` finalize another timing file / write elsewhere (tests on old recordings).

## Storyline (`src/demo.ts`)

Title card (4 s), architecture slide (7 s; user -SSO-> Workbench/Positron -ssh or REST-> SAS, LDAP, shared /home), then
(captions instead of step cards, see "Final video"):

0. Analytics Pro: show `~/apro.profile` (`cat`), copy it over `settings.json`, reload and start the
   SAS session from the picker. Viya: OAuth sign-in to SAS Viya, start Positron; the profile is added
   behind a card (cut out of the video).
1. Run `sas/test.sas`
2. Open the HTML output in a separate browser window
3. Step through the plots in the session pane
4. Data Connections: expand the SAS entry and its libraries
5. Open `DEMO.LARGE_STUDY_DATA` in Data Explorer, scroll, select columns, sort, add 3 filters,
   *Convert to Code* (SAS), paste into the SAS console and run it
6. Break the pasted code, run it, and let *Fix* hand the error to Posit Assistant
   (a fresh Assistant conversation is started first, unrecorded)
7. Ask Posit Assistant to explain one of the plots

### Housing story (`src/explore.ts`)

Title card, architecture slide, then setup (Viya: OAuth sign-in, profile added behind a card and cut out; Analytics
Pro: visible profile step), with Positron opened on `~/housing`. Then: new Assistant conversation, explain
`ahs2023n.sas7bdat` and plot a few key variables; `/report` (the outline approval, as a panel or in plain text, is
answered automatically); the assistant writes the Quarto report; it is asked to render it and fix errors when it has
not already; the `.qmd` is opened, *Preview* is pressed, and the rendered report is opened in its own window and
scrolled through (code chunks and plots). Idle render time is cut out. The whole chapter is capped at 20 minutes
(`EXPLORE_TIMEOUT_MIN`).

### Clinical Acceleration story (`src/clinical.ts`)

Subtitle "Clinical Acceleration". Title card, architecture slide, the Viya sign-in and the SAS Viya console as in
the Viya video (chapter 01), then a programmer's round trip (captions, zooms and speed-ups as in the other videos):

2. **Check out and get the data** (runbook steps 1 and 2) in the Clinical Acceleration view (activity bar): refresh
   the repository, check out `programs/test.sas` (With Content), Copy to Workspace > Copy Latest Version on
   `data/sdtm/large_study_data.sas7bdat`, show both in the Clinical Workspace.
3. **Run in SAS Viya:** open the workspace copy of `test.sas`, highlight its `libname demo` on
   `&ws/PositDemo/SAS-Demo/data/sdtm/`, run it (log in the Console, ODS output in the Viewer). `&ws` is
   `_SASWS_` in a clinical job and `/clinical/workspaces` interactively (`_SASWS_` is undefined there).
4. **Change and check in:** append a `proc means` step, save, select the new lines and run only them (the summary
   table in the Viewer), Check In (Minor, with a comment) and show v1.1 in Clinical Version History.
5. **Run from the repository:** Run as Clinical Job on the workspace `test.sas` (creates `test.cjob`), Run and
   Populate (Use Relative Paths: Publish Setup gets `../data/sdtm/large_study_data.sas7bdat` and `../outputs`, and the
   check-in locations are cleared), job editor: highlight Input files, Add Folder... `outputs` as check-in location
   and Version new files, save; Check In `test.cjob` (versioning Yes, 1.0, comment); Run Clinical Job on it in the
   Clinical Repository (Clinical Jobs zoomed until done); Show Manifest Report, Viewer maximized: Summary, then the
   Programs (test.sas 1.1) and Inputs (large_study_data 1.0) rows, then Outputs (residuals_vs_predicted.pdf 1.0).
   Job runs take ~25-35 s each (sped up).

Right-click menus are opened unzoomed (they are laid out in unscaled page coordinates); the trees, the libname lines,
the typed step, the log, the Viewer, the check-in prompt and the version history are zoomed.

Unrecorded, in the profile cut (`resetClinicalState`):

- demouser's Clinical Workspace: Undo Check out and Delete on `/PositDemo/SAS-Demo` (only the owner can undo a
  check-out, and a checked-out file blocks deleting the project). Deleting a large copy can take minutes.
- Locally, with `../scripts/env.sh` (viya_admin): `teardown_repo.sh --yes` **permanently** deletes the project (this
  server cannot move projects to the trash), then `setup_repo.sh`, `setup_users.sh` and `verify_setup.sh` create it
  again from `../large_study_data.sas7bdat` and `../sas/test.sas` (about 25 s). Nothing is copied to the server.
- Clinical Jobs: Clear Finished Runs (hidden in Positron only); Clinical Job Schedules collapsed.

### SAS Studio story (`src/studio.ts`)

Subtitle "Analytics Pro edition", title "SAS Studio in Posit Workbench"; the architecture slide shows Posit Workbench
running a SAS Analytics Pro session (Kubernetes logo) with SAS Studio and SAS 9.4+ inside, connected to the "PWB
session init" (init container) box; LDAP and /home without arrows.
The pre-roll only signs in to Workbench and quits all sessions (no Positron, no profile, no extension).

1. **Launch SAS Studio:** New Session (dialog zoomed); Positron Pro first with its image (`…/pwb-session:…`)
   highlighted, then SAS Studio with its image (`…/sas/apro:…`) highlighted; Launch. Workbench starts the pod
   (~50 s) and SAS Studio signs in by itself and loads (~30 s), sped up.
2. **Run SAS code:** Explorer > sas-analytics-pro > Home > sas-demo > sas (upper tree zoomed, so the files in `~`
   stay out of the picture), open `test.sas`, hide the side pane, show the program zoomed, Run; zoom on the log
   summary (Errors / Warnings / Notes), then the HPMIXED tables and the histogram, Q-Q plot and residual plot
   from the Results tab (an `about:srcdoc` iframe; each plot scrolled into view and zoomed).

The live zoom scales `<body>` on these pages (no `.monaco-workbench`). `STUDIO=1 npx tsx src/repl.ts <dir>` signs in
and waits on the home page for snippets (they get the story as `studio`).

### Local SAS story (`src/local.ts`)

Title "Positron in SAS Analytics Pro"; the architecture slide shows SAS 9.4+ in the SAS Analytics Pro box and the
Positron session in the "PWB session init" (init container) box, with a stdio arrow from Positron to SAS 9.4+.

Pre-roll (`resetLocalState`, not recorded): a quiet Positron session from the default image in `~/sas-demo` closes
the restored editors, removes `SAS.connectionProfiles` from the user settings (keeping the keys Workbench writes,
adding `git.ignoreMissingGitWarning`: the apro image has no git) and clears the extension's `SAS.localProfileAdded`
flag; then all sessions are quit.

1. **Launch Positron:** sas-demo row > Create new session, Positron Pro, the default image highlighted, the Image
   list opened and `…/sas/apro:…` picked and highlighted, Launch (~20 s).
2. **Connect to SAS:** the status bar shows the `local` profile; Open User Settings (JSON) shows the profile the
   extension added (`connectionType: stdio`, `saspath`), zoomed and highlighted; start the SAS (local) console.
3. **Run SAS code:** `runTestSas` as in the base story (~6 s), the Viewer, the Plots pane.

## Text cards

Cards are injected into the live page while recording (see `src/cards.ts`), so no extra post-processing is
needed. Fonts and the logo come from `assets/` (Posit brand).

- Every card carries a transparent Posit + SAS logo lockup (white Posit logo and the official white SAS
  logo, `assets/sas-logo-white.png` from sas.com, unmodified). The title and closing cards add the edition
  as a subtitle, "better together" and a QR code for the link (generated with the `qrcode` package).
- Edit the wording in the `CARDS` constant in `src/cards.ts` (captions: `CAPTIONS`).
- `npm run cards` renders all cards to `screenshots/card-*.png` and the caption bars to `screenshots/caption-*.png`
  without touching Workbench (`EDITION=viya` for the Viya wording).
- `CARD_SECONDS=2 npm run demo:apro` shortens every card for quick test runs.
- The link on the title and closing cards is not clickable in a video; repeat it in the video description.

## Known issues (housing story)

- **ssh host key (Analytics Pro):** the report render runs `sas_connect()` over ssh. If `ssh sas-analytics-pro.posit.svc.cluster.local`
  fails with "Host key verification failed" for `demouser`, the render hangs at `2/17 [setup]`. Trust the host once
  (`ssh-keyscan -H <host> >> ~/.ssh/known_hosts`, after checking the fingerprint).
- **Viya compute timeouts:** `sas_connect()` in the report starts its own Viya compute session. It sometimes times out
  after 60 s ("sessions ... timed out"); the run then fails and is retried automatically (up to 3 attempts). A
  successful attempt can still show the assistant troubleshooting such a timeout in the chat.
- **Report chunk headers:** older extension versions wrote `*|`/`#|` option lines without a blank line after them (Quarto
  YAML error); the assistant repaired that when it rendered the report itself. Fixed in the current extension.
- Quarto may end with "Directory not empty (os error 39)" when cleaning `.quarto` in `~/housing`; the HTML is still written.

## Known issues (clinical story)

- The Clinical Acceleration activity-bar icon has no accessible name; it is found by its CSS class
  (`sas-clinical-view-container`). Context menus need ~1 s after opening before an entry takes a click.
- Newly created or copied items appear in the Clinical Repository / Workspace views only after Refresh.
- From 0.6.0 the run button of a Clinical Workspace program is a split button whose main action can be "Run as
  Clinical Job"; `runSas` picks "Run Selected or All SAS Code" from its "Run or Debug..." dropdown then.
- The job editor's folder picker reuses list rows, so a row's text can carry stale detail text: pick rows by
  `aria-label` (`folder  outputs`, `check  Use this folder`). Toast buttons such as "Open Job" vanish quickly:
  open the job by double-click instead.
- The manifest report shows "Check-in locations: None" although the job and the `.cmnf` list `outputs/` and the PDF
  was checked in (extension display issue, reported 2026-11-11); the video does not zoom on that row.
- "Viya failed to start / Connection timed out" on every attempt (also for REST sessions as viya_admin) is a cluster
  problem: check `kubectl -n sas-viya logs deploy/sas-launcher` (2026-11-10 it could not parse pod status on
  Kubernetes 1.36, `allocatedResources`, and launched no compute servers; it recovered by itself).

## Known issues (local SAS story)

- The extension adds the `local` profile once per user and records that in its global state, which Positron on
  Workbench keeps in the browser-side storage (IndexedDB `positron-web-state-db-global`, key `posit.positron-sas`)
  that Workbench restores for every new browser. `clearLocalProfileFlag` edits it from a Positron page.
- If `settings.json` lacks the keys Workbench adds at session start (`remote.autoForwardPorts`,
  `files.associations`), Workbench writes them while the extension adds its profile; the extension's write then
  fails ("Failed to save 'settings.json': The content of the file is newer") and the profile is lost (status bar
  "No Profile"). The reset therefore keeps those keys. Editing `settings.json` from a terminal while a window has
  it loaded causes the same kind of conflict.

## Known issues (SAS Studio story)

- The New Session dialog opens on the last-used IDE, so the script always clicks the Positron tab first.
- SAS Studio remembers the side pane across sessions (Explorer, another pane, or hidden); `runTestSas` clicks the
  Explorer icon until the tree shows. Unsaved program tabs are restored too: close probe tabs with "Don't Save".

## Notes

- `backup/` and `videos/backup/` hold the earlier versions of the videos and the old separate video 2 code;
  `backup/src-before-captions/` and `videos/backup/before-captions/` are the step-card versions before caption mode.
- Workspace trust, the Posit Assistant webview (a nested iframe) and the SAS
  session behave differently when you re-join an existing session, so the scripts never do that.
- Posit Assistant reopens the account's last conversation; the scripts start a new one where it matters.
- `src/probe*.ts` and `src/repl.ts` are development aids (map new UI, inspect the server state).
- Output (`videos/`, `screenshots/`, `auth/`) is git-ignored.
