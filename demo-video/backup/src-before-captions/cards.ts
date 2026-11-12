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
/** Suffix of the video and timing file names for the story ("", "-housing", "-clinical"). */
export const STORY_SUFFIX = HOUSING ? "-housing" : CLINICAL ? "-clinical" : "";
export const EDITION_TITLE = CLINICAL ? "Clinical Acceleration" : EDITION === "viya" ? "Viya edition" : "Analytics Pro edition";
const TOTAL_STEPS = CLINICAL ? 5 : HOUSING ? (EDITION === "viya" ? 3 : 2) : EDITION === "viya" ? 9 : 8;

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
const base = (title: string, lines: string[]): Card => (HOUSING || CLINICAL ? skipped(title, lines) : stage(title, lines));
const housingStage = (title: string, lines: string[]): Card => (HOUSING ? stage(title, lines) : skipped(title, lines));
const clinicalStage = (title: string, lines: string[]): Card => (CLINICAL ? stage(title, lines) : skipped(title, lines));

/**
 * High-level architecture slide (inline SVG, 1560 x 600): user -SSO-> Posit Workbench (with the Positron
 * session inside) -ssh / REST API-> SAS, LDAP above and the shared /home below, both pointing at the
 * two systems.
 */
function architectureSvg(edition: "apro" | "viya") {
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

// Edit the wording here.
export const CARDS = {
  title: {
    eyebrow: "SAS in Posit Workbench",
    title: "Positron Extension for SAS",
    subtitle: EDITION_TITLE,
    lines: [
      CLINICAL
        ? "Work with the SAS Clinical Acceleration Repository in Positron."
        : "Write, run and explore SAS code in Positron on Posit Workbench.",
    ],
    link: LINK,
    tagline: true,
    qr: true,
    seconds: process.env.CARD_SECONDS ? STAGE_SECONDS : 8,
  } satisfies Card,
  architecture: {
    eyebrow: "Architecture",
    title: "How the pieces fit together",
    lines: [],
    diagram: architectureSvg(EDITION),
    seconds: process.env.CARD_SECONDS ? STAGE_SECONDS : 12,
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
  repoSetup: clinicalStage("Set up the clinical repository", [
    "A repository administrator creates the project with REST API scripts.",
    "Folders, study data, a starter program and permissions for the programmer.",
  ]),
  checkout: clinicalStage("Check out, edit and check in", [
    "The Clinical Acceleration view in Positron browses the repository.",
    "Check out a program to your workspace, edit it and check it back in as a new version.",
  ]),
  workspaceData: clinicalStage("Use repository data in SAS", [
    "Copy the study data from the repository to your workspace.",
    "SAS Viya reads it from /clinical/workspaces, ready for the Data Explorer.",
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
  closing: {
    eyebrow: "Get started",
    title: "Positron Extension for SAS",
    subtitle: EDITION_TITLE,
    lines: ["Documentation and installation:"],
    link: LINK,
    tagline: true,
    qr: true,
    seconds: 6,
  } satisfies Card,
};

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
