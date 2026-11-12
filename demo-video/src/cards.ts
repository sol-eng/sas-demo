// Full-screen text cards that are injected into the live page, so they end up
// in the recording. Styling follows the Posit brand (dark opener layout):
// dark blue background, orange mono eyebrow, short orange bar, white Light
// headline, Open Sans body. Fonts and logo come from ./assets and are inlined
// as data URIs (the recording context uses bypassCSP so the page cannot block them).
import { readFileSync } from "node:fs";
import type { Page } from "playwright";
import QRCode from "qrcode";

export const LINK = "https://posit-dev.github.io/positron-sas-extension/";
/** Which video is being made: "apro" (SAS Analytics Pro) or "viya" (SAS Viya). */
export const EDITION = (process.env.EDITION ?? "apro") as "apro" | "viya";
/** STORY=housing: the separate "housing" video (setup, then exploratory analysis of a SAS dataset with Posit Assistant). */
export const HOUSING = process.env.STORY === "housing";
/** STORY=clinical: the SAS Clinical Acceleration video (Viya only: repository setup, check-out/check-in, workspace data). */
export const CLINICAL = process.env.STORY === "clinical";
if (CLINICAL && EDITION !== "viya") throw new Error("STORY=clinical needs EDITION=viya");
/** STORY=studio: SAS Studio from the SAS Analytics Pro image as a Workbench session (Apro only, no Positron). */
export const STUDIO = process.env.STORY === "studio";
if (STUDIO && EDITION !== "apro") throw new Error("STORY=studio needs EDITION=apro");
/** STORY=local: Positron from the SAS Analytics Pro image, with the SAS 9.4 of that container (stdio profile). */
export const LOCAL = process.env.STORY === "local";
if (LOCAL && EDITION !== "apro") throw new Error("STORY=local needs EDITION=apro");
/** Suffix of the video and timing file names for the story ("", "-housing", "-clinical", "-studio", "-local"). */
export const STORY_SUFFIX = HOUSING ? "-housing" : CLINICAL ? "-clinical" : STUDIO ? "-studio" : LOCAL ? "-local" : "";
export const EDITION_TITLE = CLINICAL ? "Clinical Acceleration" : EDITION === "viya" ? "Viya edition" : "Analytics Pro edition";
const TOTAL_STEPS = CLINICAL ? 6 : STUDIO ? 2 : LOCAL ? 3 : HOUSING ? (EDITION === "viya" ? 3 : 2) : EDITION === "viya" ? 9 : 8;
/**
 * Caption mode (all stories): no full-screen step cards; finalize.ts shows the screen a bit smaller with a caption
 * bar underneath (CAPTIONS below). The step cards below are kept for `npm run cards` and the non-caption code paths.
 */
export const CAPTION_MODE = true;

export interface Card {
  eyebrow: string;
  title: string;
  /** shown beneath the title, e.g. "Analytics Pro edition" */
  subtitle?: string;
  lines: string[];
  link?: string;
  /** show "better together" next to the Posit + SAS lockup (every card has the lockup) */
  tagline?: boolean;
  /** inline SVG shown below the title (architecture slide); the card then uses the compact diagram layout */
  diagram?: string;
  /** QR code for `link`, bottom right */
  qr?: boolean;
  seconds: number;
}

/** Hold time of a stage card; override with CARD_SECONDS for quick test runs. */
const STAGE_SECONDS = Number(process.env.CARD_SECONDS ?? 6);

let stageNo = 0;
// Cards are numbered in the order of the CARDS literal below (evaluated top to bottom).
// `base` stages belong to the sas/test.sas storyline only; the housing and clinical stories skip them (and their
// numbers), and each of those stories has its own stages.
const stage = (title: string, lines: string[]): Card => ({
  eyebrow: `Step ${++stageNo} of ${TOTAL_STEPS}`,
  title,
  lines,
  seconds: STAGE_SECONDS,
});
const skipped = (title: string, lines: string[]): Card => ({ eyebrow: "", title, lines, seconds: 0 });
const base = (title: string, lines: string[]): Card => (HOUSING || CLINICAL || STUDIO || LOCAL ? skipped(title, lines) : stage(title, lines));
const housingStage = (title: string, lines: string[]): Card => (HOUSING ? stage(title, lines) : skipped(title, lines));
const clinicalStage = (title: string, lines: string[]): Card => (CLINICAL ? stage(title, lines) : skipped(title, lines));

/**
 * High-level architecture slide (inline SVG, 1560 x 600): user -SSO-> Posit Workbench (with the Positron
 * session inside) -ssh / REST API-> SAS, LDAP above and the shared /home below, both pointing at the
 * two systems.
 */
function architectureSvg(edition: "apro" | "viya") {
  if (STUDIO) return studioArchitectureSvg();
  if (LOCAL) return localArchitectureSvg();
  const sas = edition === "viya" ? "SAS Viya" : "SAS Analytics Pro";
  // clinical story: the SAS box names the Clinical Acceleration Repository on a second line
  const sasText = CLINICAL
    ? `<text class="boxt" x="1170" y="333">${sas}</text><text class="innert" x="1170" y="375" style="font-size:24px">Clinical Acceleration</text>`
    : `<text class="boxt" x="1170" y="350">${sas}</text>`;
  const link = edition === "viya" ? "REST API" : "ssh connection";
  return `<svg class="arch" viewBox="0 0 1560 600" width="1560" height="600" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="ah" viewBox="0 0 12 12" refX="11" refY="6" markerUnits="userSpaceOnUse" markerWidth="24" markerHeight="24" orient="auto-start-reverse">
      <path d="M0,0 L12,6 L0,12 z" fill="#EE6331"/>
    </marker>
  </defs>
  <style>
    .box{fill:#1B2A38;stroke:#9FC2E6;stroke-width:3}
    .inner{fill:#26394B;stroke:#9FC2E6;stroke-width:2}
    .boxt{fill:#fff;font:400 36px "Open Sans",Arial,sans-serif;text-anchor:middle}
    .innert{fill:#fff;font:400 30px "Open Sans",Arial,sans-serif;text-anchor:middle}
    .lbl{fill:#D0DBE5;font:400 28px "Source Code Pro",monospace;text-anchor:middle}
    .arrow{stroke:#EE6331;stroke-width:5;fill:none;marker-end:url(#ah)}
    .user{fill:#fff}
  </style>
  <!-- user -->
  <g class="user">
    <circle cx="60" cy="255" r="30"/>
    <path d="M0,355 C0,307 28,291 60,291 C92,291 120,307 120,355 Z"/>
  </g>
  <text class="lbl" x="60" y="407">User</text>
  <!-- Posit Workbench with the Positron session inside -->
  <rect class="box" x="280" y="200" width="420" height="230" rx="12"/>
  <text class="boxt" x="490" y="249">Posit Workbench</text>
  <rect class="inner" x="320" y="285" width="340" height="110" rx="10"/>
  <text class="innert" x="490" y="350">Positron session</text>
  <!-- SAS -->
  <rect class="box" x="1000" y="285" width="340" height="110" rx="12"/>
  ${sasText}
  <!-- LDAP above, /home below -->
  <rect class="box" x="720" y="10" width="220" height="100" rx="12"/>
  <text class="boxt" x="830" y="73">LDAP</text>
  <rect class="box" x="720" y="490" width="220" height="100" rx="12"/>
  <text class="boxt" x="830" y="553">/home</text>
  <text class="lbl" x="956" y="548" style="text-anchor:start">shared home directories</text>
  <!-- arrows -->
  <path class="arrow" d="M130,315 L272,315"/>
  <text class="lbl" x="201" y="285">SSO</text>
  <path class="arrow" d="M668,340 L992,340"/>
  <text class="lbl" x="850" y="310">${link}</text>
  <path class="arrow" d="M780,116 L560,192"/>
  <path class="arrow" d="M880,116 L1110,277"/>
  <path class="arrow" d="M780,484 L560,438"/>
  <path class="arrow" d="M880,484 L1110,403"/>
</svg>`;
}

/**
 * Architecture slide of the SAS Studio story: no separate SAS server - Posit Workbench runs a SAS Analytics Pro
 * session (Kubernetes pod) with SAS Studio and SAS 9.4+ inside, next to the Workbench session init container.
 * LDAP and /home as on the other slides, without arrows (they would all point at the one Workbench box).
 */
function studioArchitectureSvg() {
  // read here, not with dataUri(): CARDS (and so this function) is evaluated before dataUri is defined
  const k8s = `data:image/svg+xml;base64,${readFileSync(new URL("../assets/kubernetes.svg", import.meta.url)).toString("base64")}`;
  return `<svg class="arch" viewBox="0 0 1560 600" width="1560" height="600" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="ah" viewBox="0 0 12 12" refX="11" refY="6" markerUnits="userSpaceOnUse" markerWidth="24" markerHeight="24" orient="auto-start-reverse">
      <path d="M0,0 L12,6 L0,12 z" fill="#EE6331"/>
    </marker>
  </defs>
  <style>
    .box{fill:#1B2A38;stroke:#9FC2E6;stroke-width:3}
    .inner{fill:#26394B;stroke:#9FC2E6;stroke-width:2}
    .inner2{fill:#33495E;stroke:#9FC2E6;stroke-width:2}
    .boxt{fill:#fff;font:400 36px "Open Sans",Arial,sans-serif;text-anchor:middle}
    .innert{fill:#fff;font:400 30px "Open Sans",Arial,sans-serif;text-anchor:middle}
    .lbl{fill:#D0DBE5;font:400 28px "Source Code Pro",monospace;text-anchor:middle}
    .arrow{stroke:#EE6331;stroke-width:5;fill:none;marker-end:url(#ah)}
    .user{fill:#fff}
  </style>
  <!-- user -->
  <g class="user">
    <circle cx="60" cy="255" r="30"/>
    <path d="M0,355 C0,307 28,291 60,291 C92,291 120,307 120,355 Z"/>
  </g>
  <text class="lbl" x="60" y="407">User</text>
  <!-- Posit Workbench, running the SAS Analytics Pro session (a Kubernetes pod) -->
  <rect class="box" x="280" y="150" width="1220" height="300" rx="12"/>
  <text class="boxt" x="310" y="197" style="text-anchor:start">Posit Workbench</text>
  <rect class="inner" x="330" y="215" width="800" height="205" rx="10"/>
  <image href="${k8s}" x="546" y="226" width="48" height="47"/>
  <text class="innert" x="610" y="260" style="text-anchor:start">SAS Analytics Pro</text>
  <rect class="inner2" x="365" y="292" width="345" height="100" rx="8"/>
  <text class="innert" x="537" y="352">SAS Studio</text>
  <rect class="inner2" x="750" y="292" width="345" height="100" rx="8"/>
  <text class="innert" x="922" y="352">SAS 9.4+</text>
  <!-- the Workbench session init container of the same pod -->
  <line x1="1130" y1="317" x2="1190" y2="317" stroke="#9FC2E6" stroke-width="3"/>
  <rect class="inner" x="1190" y="262" width="260" height="110" rx="10"/>
  <text class="innert" x="1320" y="315" style="font-size:27px">PWB session init</text>
  <text class="lbl" x="1320" y="351" style="font-size:22px">init container</text>
  <!-- LDAP above, /home below -->
  <rect class="box" x="720" y="10" width="220" height="100" rx="12"/>
  <text class="boxt" x="830" y="73">LDAP</text>
  <rect class="box" x="720" y="490" width="220" height="100" rx="12"/>
  <text class="boxt" x="830" y="553">/home</text>
  <text class="lbl" x="956" y="548" style="text-anchor:start">shared home directories</text>
  <!-- arrow -->
  <path class="arrow" d="M130,315 L272,315"/>
  <text class="lbl" x="201" y="285">SSO</text>
</svg>`;
}

/**
 * Architecture slide of the local SAS story: Posit Workbench runs a SAS Analytics Pro session (Kubernetes pod); the
 * Positron session comes from the Workbench session init container and uses the container's SAS 9.4 over stdio.
 */
function localArchitectureSvg() {
  const k8s = `data:image/svg+xml;base64,${readFileSync(new URL("../assets/kubernetes.svg", import.meta.url)).toString("base64")}`;
  return `<svg class="arch" viewBox="0 0 1560 600" width="1560" height="600" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="ah" viewBox="0 0 12 12" refX="11" refY="6" markerUnits="userSpaceOnUse" markerWidth="24" markerHeight="24" orient="auto-start-reverse">
      <path d="M0,0 L12,6 L0,12 z" fill="#EE6331"/>
    </marker>
  </defs>
  <style>
    .box{fill:#1B2A38;stroke:#9FC2E6;stroke-width:3}
    .inner{fill:#26394B;stroke:#9FC2E6;stroke-width:2}
    .inner2{fill:#33495E;stroke:#9FC2E6;stroke-width:2}
    .boxt{fill:#fff;font:400 36px "Open Sans",Arial,sans-serif;text-anchor:middle}
    .innert{fill:#fff;font:400 30px "Open Sans",Arial,sans-serif;text-anchor:middle}
    .lbl{fill:#D0DBE5;font:400 28px "Source Code Pro",monospace;text-anchor:middle}
    .arrow{stroke:#EE6331;stroke-width:5;fill:none;marker-end:url(#ah)}
    .user{fill:#fff}
  </style>
  <!-- user -->
  <g class="user">
    <circle cx="60" cy="255" r="30"/>
    <path d="M0,355 C0,307 28,291 60,291 C92,291 120,307 120,355 Z"/>
  </g>
  <text class="lbl" x="60" y="407">User</text>
  <!-- Posit Workbench, running the SAS Analytics Pro session (a Kubernetes pod) -->
  <rect class="box" x="280" y="150" width="1220" height="300" rx="12"/>
  <text class="boxt" x="310" y="197" style="text-anchor:start">Posit Workbench</text>
  <rect class="inner" x="330" y="215" width="490" height="205" rx="10"/>
  <image href="${k8s}" x="420" y="226" width="48" height="47"/>
  <text class="innert" x="482" y="260" style="text-anchor:start">SAS Analytics Pro</text>
  <rect class="inner2" x="370" y="292" width="410" height="100" rx="8"/>
  <text class="innert" x="575" y="352">SAS 9.4+</text>
  <!-- the Workbench session init container brings Positron into the same pod -->
  <rect class="inner" x="930" y="215" width="520" height="205" rx="10"/>
  <text class="innert" x="1190" y="255" style="font-size:27px">PWB session init</text>
  <text class="lbl" x="1190" y="284" style="font-size:22px">init container</text>
  <rect class="inner2" x="970" y="302" width="440" height="90" rx="8"/>
  <text class="innert" x="1190" y="357">Positron session</text>
  <path class="arrow" d="M962,347 L788,347"/>
  <text class="lbl" x="875" y="331" style="font-size:24px">stdio</text>
  <!-- LDAP above, /home below -->
  <rect class="box" x="720" y="10" width="220" height="100" rx="12"/>
  <text class="boxt" x="830" y="73">LDAP</text>
  <rect class="box" x="720" y="490" width="220" height="100" rx="12"/>
  <text class="boxt" x="830" y="553">/home</text>
  <text class="lbl" x="956" y="548" style="text-anchor:start">shared home directories</text>
  <!-- arrow -->
  <path class="arrow" d="M130,315 L272,315"/>
  <text class="lbl" x="201" y="285">SSO</text>
</svg>`;
}

// Edit the wording here.
export const CARDS = {
  title: {
    eyebrow: "SAS in Posit Workbench",
    title: STUDIO ? "SAS Studio in Posit Workbench" : LOCAL ? "Positron in SAS Analytics Pro" : "Positron Extension for SAS",
    subtitle: EDITION_TITLE,
    lines: [
      CLINICAL
        ? "Work with the SAS Clinical Acceleration Repository in Positron."
        : STUDIO
          ? "Launch SAS Studio from the SAS Analytics Pro image, next to Positron, RStudio and Jupyter."
          : LOCAL
            ? "Run Positron in the SAS Analytics Pro image and use its SAS 9.4 directly."
            : "Write, run and explore SAS code in Positron on Posit Workbench.",
    ],
    ...(STUDIO ? {} : { link: LINK, qr: true }),
    tagline: true,
    seconds: process.env.CARD_SECONDS ? STAGE_SECONDS : CAPTION_MODE ? 4 : 8,
  } satisfies Card,
  architecture: {
    eyebrow: "Architecture",
    title: "How the pieces fit together",
    lines: [],
    diagram: architectureSvg(EDITION),
    seconds: process.env.CARD_SECONDS ? STAGE_SECONDS : CAPTION_MODE ? 7 : 12,
  } satisfies Card,
  ...(EDITION === "viya"
    ? {
        signin: stage("Login and activating OAuth integration", [
          "Sign in to SAS Viya CAF with managed credentials in Posit Workbench.",
          "Then start a Positron session that carries the token.",
        ]),
      }
    : {}),
  profile: stage("Add the SAS connection profile", EDITION === "viya"
    ? [
        "A connection profile in the user settings points Positron at SAS Viya.",
        "Add it to settings.json, reload and start a SAS (Viya) session.",
      ]
    : [
        "A connection profile in the user settings points Positron at SAS Analytics Pro.",
        "Add it to settings.json, reload and start a SAS (Apro) session.",
      ]),
  explore: housingStage("Explore a dataset and write a report", [
    "Ask Posit Assistant to explain a SAS dataset and plot the trends in it.",
    "Then turn the analysis into a Quarto report with /report and preview it.",
  ]),
  checkoutData: clinicalStage("Check out and get the data", [
    "The Clinical Acceleration view in Positron browses the repository.",
    "Check out test.sas and copy the study data to your workspace.",
  ]),
  runViya: clinicalStage("Run in SAS Viya", [
    "The program reads the data from /clinical/workspaces.",
    "Run it on SAS Viya: log in the Console, output in the Viewer.",
  ]),
  changeCheckin: clinicalStage("Change and check in", [
    "Add a summary step and run it.",
    "Check the program in as a new version of the repository file.",
  ]),
  repoRun: clinicalStage("Run from the repository", [
    "Run the program as a clinical job and record its inputs with Run and Populate.",
    "Check the job in, run it from the repository and review the manifest.",
  ]),
  run: base("Run SAS code", [
    "Open test.sas and run it with one click.",
    EDITION === "viya"
      ? "The code executes on SAS Viya and the results come back into Positron."
      : "The code executes on SAS Analytics Pro and the results come back into Positron.",
  ]),
  results: base("Review the results", [
    "The HTML output opens in its own browser window.",
    "The plots appear in the Session pane, ready to browse.",
  ]),
  connections: base("Browse your libraries", [
    "Data Connections shows the SAS session as a single connection.",
    "Expand it to see every library, such as WORK, SASHELP and DEMO.",
  ]),
  explorer: base("Explore data without writing code", [
    "Open DEMO.LARGE_STUDY_DATA in the Data Explorer.",
    "Scroll a large table, select columns, sort and add filters.",
  ]),
  convert: base("Convert to code", [
    "Turn the Data Explorer view into SAS code.",
    "Paste it into the console, run it and compare the result.",
  ]),
  fix: base("Fix errors with Posit Assistant", [
    "We introduce a typo in the table name and run the code.",
    "The Fix button in the console hands the error to Posit Assistant.",
  ]),
  context: base("Ask about your results", [
    "Posit Assistant sees the code and plots from this session.",
    "Ask it to explain one of the plots that test.sas created.",
  ]),
  closing: (STUDIO
    ? {
        eyebrow: "SAS in Posit Workbench",
        title: "SAS Studio in Posit Workbench",
        subtitle: EDITION_TITLE,
        lines: ["One Workbench for SAS Studio, Positron, RStudio and Jupyter.", "Same login, same home directory."],
        tagline: true,
        seconds: 6,
      }
    : {
        eyebrow: "Get started",
        title: "Positron Extension for SAS",
        subtitle: EDITION_TITLE,
        lines: ["Documentation and installation:"],
        link: LINK,
        tagline: true,
        qr: true,
        seconds: 6,
      }) satisfies Card,
};

// -------------------------------------------------------------- captions ----
// Caption bar (caption mode): chapter number and label on the left, a headline and one line beneath it.
// demo.ts / explore.ts switch captions with timeline.caption(id); finalize.ts renders and places them.

const SAS_NAME = EDITION === "viya" ? "SAS Viya" : "SAS Analytics Pro";
/** chapter of "Run SAS code": 02 in the base story, 03 in the local story */
const RUN_NO = LOCAL ? "03" : "02";
export interface Caption {
  no: string;
  label: string;
  headline: string;
  sub: string;
}
const cap = (no: string, label: string, headline: string, sub: string): Caption => ({ no, label, headline, sub });
const CONNECT = "Connect to SAS";
const REPO_RUN = "Run from the repository";
const STUDIO_LAUNCH = "Launch SAS Studio";
const STUDIO_RUN = "Run SAS code";
export const CAPTIONS = {
  // 01 - both stories
  signin: cap("01", CONNECT, "Sign in to SAS Viya from Posit Workbench", "Managed credentials: Workbench holds the OAuth token for SAS Viya"),
  viyaSession: cap("01", CONNECT, "A SAS Viya console in Positron", "A connection profile in the user settings points Positron at SAS Viya"),
  profile: cap("01", CONNECT, "Add the SAS connection profile", "A profile in the user settings points Positron at SAS Analytics Pro over ssh"),
  aproSession: cap("01", CONNECT, "Start a SAS console", "SAS runs in the Console, next to R and Python"),
  // base story
  run: cap(RUN_NO, "Run SAS code", "Run SAS from the editor", LOCAL ? "SAS 9.4 in the same container runs test.sas, the log streams into the Console" : `test.sas runs on ${SAS_NAME}, the log streams into the Console`),
  html: cap(RUN_NO, "Run SAS code", "ODS output opens in the Viewer", "Or in its own browser window, one click away"),
  plots: cap(RUN_NO, "Run SAS code", "Graphs go to the Plots pane", "Step through every plot of the run"),
  connections: cap("03", "Libraries and data", "SAS libraries show up in Data Connections", "WORK, SASHELP and DEMO, read live from the SAS session"),
  explorer: cap("03", "Libraries and data", "Tables open in the Data Explorer", "Column profiles with histograms, missing values and summary statistics"),
  filter: cap("03", "Libraries and data", "Sort and filter without writing code", "The Data Explorer runs each query as SAS in your session"),
  convert: cap("04", "Convert to code", "Convert to Code writes the PROC SQL for you", "The current filters and sort order, as SAS"),
  convertRun: cap("04", "Convert to code", "Run it in the SAS console", "The same rows as in the Data Explorer"),
  fix: cap("05", "Posit Assistant", "Fix hands the SAS error to Posit Assistant", "A typo in the table name: the assistant finds it and corrects the query"),
  context: cap("05", "Posit Assistant", "Ask about your results", "Posit Assistant sees the code, output and plots of this SAS session"),
  // housing story
  explain: cap("02", "Explore a dataset", "Ask Posit Assistant about a SAS dataset", "ahs2023n.sas7bdat has over 3,000 variables: the assistant explores it with SAS"),
  housingPlots: cap("02", "Explore a dataset", "Key variables, summarized and plotted", "The SAS code runs in your session, the results appear in the Viewer"),
  report: cap("03", "Write a report", "/report turns the analysis into a Quarto report", "Approve the outline, and the assistant writes the .qmd document"),
  render: cap("03", "Write a report", "The assistant renders the report and fixes errors", "Every SAS chunk runs again, in a fresh SAS session"),
  preview: cap("04", "Preview the report", "Preview renders the Quarto document", "Quarto runs every SAS chunk in a fresh SAS session"),
  reportWindow: cap("04", "Preview the report", "The finished report, in its own window", "Code, output and plots, ready to share"),
  // clinical story
  clinicalView: cap("02", "Check out and get the data", "The Clinical Acceleration view in Positron", "The repository and your personal workspace, side by side"),
  checkout: cap("02", "Check out and get the data", "Check out test.sas to your workspace", "The repository marks the file as checked out to you"),
  copyData: cap("02", "Check out and get the data", "Copy the study data to your workspace", "Copy Latest Version of large_study_data.sas7bdat"),
  libname: cap("03", "Run in SAS Viya", "The program reads the data from your workspace", "Interactively at /clinical/workspaces, in a clinical job at _SASWS_"),
  clinicalRun: cap("03", "Run in SAS Viya", "Run test.sas on SAS Viya", "The log streams into the Console, the output opens in the Viewer"),
  edit: cap("04", "Change and check in", "Add a summary step in the editor", "PROC MEANS of the outcome by treatment group"),
  rerun: cap("04", "Change and check in", "Run just the new step", "Select the lines and run them: the summary table opens in the Viewer"),
  checkin: cap("04", "Change and check in", "Check in saves a new version", "Pick a minor version and describe the change"),
  history: cap("04", "Change and check in", "The version history shows v1.1", "The starter program stays available as v1.0"),
  jobCreate: cap("05", REPO_RUN, "Run test.sas as a clinical job", "Positron creates test.cjob next to the program and runs it"),
  jobPopulate: cap("05", REPO_RUN, "Run and Populate records the inputs", "SAS notes what the program reads and writes, and stores it in the job"),
  jobInputs: cap("05", REPO_RUN, "The job now declares its input data", "Every repository run gets large_study_data.sas7bdat copied in"),
  jobCheckinFolder: cap("05", REPO_RUN, "Outputs are checked in to outputs/", "As new, versioned files of the repository"),
  jobCheckin: cap("05", REPO_RUN, "Check the job in to the repository", "Versioned like the program: test.cjob v1.0"),
  jobRepoRun: cap("05", REPO_RUN, "Run the job from the repository", "SAS runs it in a clean workspace with exactly the declared inputs"),
  manifest: cap("05", REPO_RUN, "The manifest report", "Which job ran, when, and as whom"),
  manifestInputs: cap("05", REPO_RUN, "Exact versions of program and data", "test.sas v1.1 read large_study_data.sas7bdat v1.0, with checksums"),
  // SAS Studio story
  studioLaunch: cap("01", STUDIO_LAUNCH, "New Session: SAS Studio", "Posit Workbench offers it next to Positron, RStudio, JupyterLab and VS Code"),
  studioImage: cap("01", STUDIO_LAUNCH, "Its own container image", "Positron runs in the Workbench session image, SAS Studio in SAS Analytics Pro"),
  studioStart: cap("01", STUDIO_LAUNCH, "Workbench starts SAS Analytics Pro", "A Kubernetes pod with SAS Studio and SAS 9.4, signed in with your Workbench login"),
  studioOpen: cap("02", STUDIO_RUN, "SAS Studio, in your browser", "Your home directory is the same as in every other Workbench session"),
  studioRun: cap("02", STUDIO_RUN, "Run test.sas", "SAS 9.4 in the Analytics Pro pod runs it, SAS Studio shows the results"),
  studioResults: cap("02", STUDIO_RUN, "Tables and plots in the Results tab", "PROC HPMIXED, UNIVARIATE and SGPLOT output"),
  // local SAS story
  localLaunch: cap("01", "Launch Positron", "New Session for the sas-demo project", "Positron Pro, as in every other Workbench session"),
  localImage: cap("01", "Launch Positron", "Pick the SAS Analytics Pro image", "Instead of the Workbench session image: SAS 9.4 is installed in it"),
  localStart: cap("01", "Launch Positron", "Workbench starts the Analytics Pro container", "The session init container adds Positron to it"),
  localProfile: cap("02", CONNECT, "The extension finds SAS in the container", "and adds a \"local\" connection profile by itself: SAS over stdio"),
  localSession: cap("02", CONNECT, "Start a SAS (local) console", "No SAS server, no ssh: SAS runs inside the Positron session"),
  manifestOutputs: cap("05", REPO_RUN, "The output, checked in as a new version", "residuals_vs_predicted.pdf v1.0, traced back to its program"),
} satisfies Record<string, Caption>;
export type CaptionId = keyof typeof CAPTIONS;

/** Final-video layout in caption mode: the screen, scaled down, and the caption band beneath it. */
export const LAYOUT = { screen: { x: 160, y: 24, width: 1600, height: 900 }, band: { y: 924, height: 156 }, bg: "#111C26" };

let cachedOverlayCss: string | undefined;
const overlayCss = () =>
  (cachedOverlayCss ??= `
@font-face{font-family:"Open Sans";src:url(${dataUri("OpenSans.ttf", "font/ttf")}) format("truetype");font-weight:300 800}
@font-face{font-family:"Source Code Pro";src:url(${dataUri("SourceCodePro.ttf", "font/ttf")}) format("truetype");font-weight:200 900}
html,body{margin:0;background:transparent}
#band{position:relative;width:1920px;height:${LAYOUT.band.height}px;background:${LAYOUT.bg};color:#fff;font-family:"Open Sans",Arial,sans-serif}
#band .no{position:absolute;left:${LAYOUT.screen.x}px;top:28px;font:600 30px "Source Code Pro",monospace;color:#EE6331}
#band .label{position:absolute;left:${LAYOUT.screen.x}px;top:70px;font:500 19px "Source Code Pro",monospace;letter-spacing:.08em;text-transform:uppercase;color:#D0DBE5;max-width:360px}
#band .head{position:absolute;left:560px;right:${1920 - LAYOUT.screen.x - LAYOUT.screen.width}px;top:22px;font-weight:600;font-size:34px;line-height:1.25;white-space:nowrap}
#band .sub{position:absolute;left:560px;right:${1920 - LAYOUT.screen.x - LAYOUT.screen.width}px;top:72px;font-weight:400;font-size:24px;line-height:1.3;color:#9FC2E6;white-space:nowrap}
#badge{display:inline-flex;align-items:center;gap:10px;padding:8px 16px 8px 14px;border-radius:10px;background:rgba(17,28,38,.88);
  color:#fff;font:600 28px "Source Code Pro",monospace}
#badge svg{display:block}
#credit{display:inline-block;font:400 22px "Open Sans",Arial,sans-serif;color:#9FC2E6}
`);

/** HTML (with styles) of an overlay image: the caption band, a speed badge, or the music credit line. */
export function overlayHtml(o: { caption: Caption } | { speed: number } | { credit: string } | { blank: true }) {
  let body: string;
  if ("caption" in o) {
    const c = o.caption;
    body = `<div id="band" class="shot"><div class="no">${esc(c.no)}</div><div class="label">${esc(c.label)}</div><div class="head">${esc(c.headline)}</div><div class="sub">${esc(c.sub)}</div></div>`;
  } else if ("blank" in o) {
    body = `<div id="band" class="shot"></div>`;
  } else if ("speed" in o) {
    const arrows = `<svg width="34" height="22" viewBox="0 0 34 22"><path d="M0 0 L16 11 L0 22Z M17 0 L33 11 L17 22Z" fill="#EE6331"/></svg>`;
    body = `<div id="badge" class="shot">${arrows}<span>${o.speed}\u00d7</span></div>`;
  } else {
    body = `<div id="credit" class="shot">${esc(o.credit)}</div>`;
  }
  return `<!doctype html><html><head><style>${overlayCss()}</style></head><body>${body}</body></html>`;
}

// ---------------------------------------------------------------- render ----

const asset = (f: string) => readFileSync(new URL(`../assets/${f}`, import.meta.url));
const dataUri = (f: string, mime: string) => `data:${mime};base64,${asset(f).toString("base64")}`;

let cachedCss: string | undefined;
const css = () =>
  (cachedCss ??= `
@font-face{font-family:"Open Sans";src:url(${dataUri("OpenSans.ttf", "font/ttf")}) format("truetype");font-weight:300 800}
@font-face{font-family:"Source Code Pro";src:url(${dataUri("SourceCodePro.ttf", "font/ttf")}) format("truetype");font-weight:200 900}
#demo-card{position:fixed;inset:0;z-index:2147483647;background:#111C26;color:#fff;
  font-family:"Open Sans",Arial,sans-serif;display:flex;flex-direction:column;justify-content:center;
  padding:0 180px;box-sizing:border-box;cursor:none}
#demo-card .eyebrow{font-family:"Source Code Pro",monospace;font-weight:400;text-transform:uppercase;
  letter-spacing:.08em;font-size:28px;color:#EE6331}
#demo-card .bar{width:40px;height:3px;background:#EE6331;margin:28px 0 36px}
#demo-card h1{font-weight:300;font-size:96px;line-height:1.1;letter-spacing:-.01em;margin:0 0 48px;max-width:1500px}
#demo-card h1+.sub{font-weight:300;font-size:56px;line-height:1.1;color:#9FC2E6;margin:-24px 0 48px}
#demo-card p{font-weight:400;font-size:36px;line-height:1.5;margin:0 0 14px;max-width:1360px;color:#D0DBE5}
#demo-card .partners{position:absolute;top:64px;left:180px;display:flex;align-items:center;gap:32px}
#demo-card .partners img{height:60px;display:block}
#demo-card .partners .plus{font-weight:300;font-size:52px;line-height:1;color:#fff}
#demo-card .partners .tag{font-weight:300;font-size:44px;letter-spacing:-.01em;color:#fff;margin-left:24px}
#demo-card .qr{position:absolute;right:180px;bottom:120px;display:flex;flex-direction:column;align-items:center;gap:20px}
#demo-card .qr img{width:300px;height:300px;display:block;background:#fff;padding:18px;border-radius:12px;box-sizing:content-box}
#demo-card .qr span{font-family:"Source Code Pro",monospace;text-transform:uppercase;letter-spacing:.08em;font-size:24px;color:#fff}
#demo-card.diagram h1{font-size:64px;margin:0 0 12px}
#demo-card.diagram .bar{margin:20px 0 24px}
#demo-card svg.arch{display:block;margin-top:8px}
#demo-card .link{margin-top:36px;font-weight:700;font-size:36px;color:#fff;border-bottom:3px solid #447099;
  align-self:flex-start;padding-bottom:4px}
`);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function html(c: Card, qr?: string) {
  const logo = `<div class="partners"><img src="${dataUri("posit-horiz-reverse.png", "image/png")}" alt="posit"><span class="plus">+</span><img src="${dataUri("sas-logo-white.png", "image/png")}" alt="SAS">${c.tagline ? '<span class="tag">better together</span>' : ""}</div>`;
  return `${logo}
<div class="eyebrow">${esc(c.eyebrow)}</div><div class="bar"></div>
<h1>${esc(c.title)}</h1>
${c.subtitle ? `<div class="sub">${esc(c.subtitle)}</div>` : ""}
${c.lines.map((l) => `<p>${esc(l)}</p>`).join("")}
${c.diagram ?? ""}
${c.link ? `<div class="link">${esc(c.link)}</div>` : ""}
${qr ? `<div class="qr"><img src="${qr}" alt="QR code"><span>Scan to get the extension</span></div>` : ""}`;
}

/** Add the card to the page (hidden or visible); resolves once fonts are ready. */
export async function mountCard(page: Page, c: Card, opts: { fadeIn: boolean }) {
  const qr = c.qr && c.link ? await QRCode.toDataURL(c.link, { errorCorrectionLevel: "M", margin: 1, width: 600, color: { dark: "#111C26", light: "#FFFFFF" } }) : undefined;
  await page.evaluate(
    async ({ style, body, fadeIn }) => {
      document.getElementById("demo-card")?.remove();
      if (!document.getElementById("demo-card-style")) {
        const s = document.createElement("style");
        s.id = "demo-card-style";
        s.textContent = style;
        document.head.appendChild(s);
      }
      const d = document.createElement("div");
      d.id = "demo-card";
      d.innerHTML = body;
      if (body.includes('class="arch"')) d.classList.add("diagram");
      d.style.opacity = fadeIn ? "0" : "1";
      document.documentElement.appendChild(d);
      await Promise.all([
        document.fonts.load('300 96px "Open Sans"'),
        document.fonts.load('400 36px "Open Sans"'),
        document.fonts.load('300 56px "Open Sans"'),
        document.fonts.load('700 36px "Open Sans"'),
        document.fonts.load('400 28px "Source Code Pro"'),
        ...Array.from(d.querySelectorAll("img")).map((i) => i.decode().catch(() => {})),
      ]);
      if (fadeIn) {
        d.style.transition = "opacity .5s ease";
        requestAnimationFrame(() => requestAnimationFrame(() => (d.style.opacity = "1")));
      }
    },
    { style: css(), body: html(c, qr), fadeIn: opts.fadeIn },
  );
}

export async function removeCard(page: Page) {
  await page.evaluate(() => document.getElementById("demo-card")?.remove());
}

/** Show a card for `c.seconds`, then fade it out. The first card of the video appears without fade-in. */
export async function showCard(page: Page, c: Card, opts: { fadeIn?: boolean; fadeOut?: boolean } = {}) {
  await mountCard(page, c, { fadeIn: opts.fadeIn ?? true });
  await page.waitForTimeout(c.seconds * 1000);
  if (opts.fadeOut === false) return; // last card of the video: leave it up, finalize trims right after
  await page.evaluate(() => {
    const d = document.getElementById("demo-card");
    if (d) {
      d.style.transition = "opacity .6s ease";
      d.style.opacity = "0";
    }
  });
  await page.waitForTimeout(700);
  await removeCard(page);
}
