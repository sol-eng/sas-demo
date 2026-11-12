// Cards for video 2. The look comes unchanged from ../cards.ts (same Posit + SAS
// lockup, fonts, QR code); only the wording and the step numbering live here.
import { CARDS as BASE, type Card } from "../cards.ts";

export { showCard, mountCard, removeCard, type Card } from "../cards.ts";

/** Keep in sync with the number of stage cards below. */
const TOTAL_STEPS = 5;
const STAGE_SECONDS = Number(process.env.CARD_SECONDS ?? 6);

const stage = (n: number, title: string, lines: string[]): Card => ({
  eyebrow: `Step ${n} of ${TOTAL_STEPS}`,
  title,
  lines,
  seconds: STAGE_SECONDS,
});

// Edit the wording here. The titles are the labels from the storyline.
export const CARDS = {
  title: BASE.title,
  signin: stage(1, "Login and activating OAuth integration", [
    "Sign in to SAS Viya CAF with managed credentials in Posit Workbench.",
    "Then start a Positron session that carries the token.",
  ]),
  project: stage(2, "Create new project", [
    "Create a new project folder from the Empty Project template.",
    "Open it in the current window to start working in the new project.",
  ]),
  viya: stage(3, "Start a Viya session", [
    "Pick SAS (Viya) as the session type.",
    "The console reports when the Viya session has started.",
  ]),
  clinical: stage(4, "Copy some data from the Clinical Repository into the workspace", [
    "Browse PositLabs > Curanex-XR > data > sdtm in the SAS pane and open ae.sas7bdat.",
    "Copy it into the workspace, keeping the folder hierarchy.",
  ]),
  assistant: stage(5, "Get Posit Assistant to write a piece of SAS code", [
    "Ask Posit Assistant to analyse the AE dataset and plot it.",
  ]),
  closing: BASE.closing,
};
