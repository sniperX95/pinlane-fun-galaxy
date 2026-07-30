// LA TABLE DE PLANS, DANS SON PROPRE MODULE.
//
// Elle vivait dans `Main.tsx`. Des que la table de bruitages a commence a caler
// ses sons RELATIVEMENT au debut de chaque plan (regle dure de la reference de
// sound design), `sfx.ts` a du lire cette table — et `Main.tsx` lit `sfx.ts`.
// Import circulaire : au chargement, « Cannot access 'AIFL_SHOTS' before
// initialization ». Une donnee partagee par deux modules appartient a un
// troisieme.

// ~36.2s @ 30fps — paper-and-ink morning reading room (10 shots). Both wordmark
// moments (brand open, outro sign-off) hold a full second once fully on.
export const AIFL_SHOTS = {
  morning: { from: 0, duration: 220 },  // 0–7.3s  brand ~46f + 30f hold + 138f macro
  card1: { from: 220, duration: 55 },   // 7.3–9.2s "All your team's research, one place to go."
  table: { from: 275, duration: 190 },  // 9.2–15.5s pile close-up → deal → scroll → search → filter → click
  macro: { from: 465, duration: 100 },  // 15.5–18.8s macro card detail, rows reveal
  card2: { from: 565, duration: 55 },   // 18.8–20.7s "Paper Radar, tailored for your morning reading."
  chart: { from: 620, duration: 105 },  // 20.7–24.2s papers stack radar
  cardWbr: { from: 725, duration: 50 }, // 24.2–25.8s "Every project, linked to your weekly report."
  wbr: { from: 775, duration: 110 },    // 25.8–29.5s weekly report / collaborative write
  card3: { from: 885, duration: 55 },   // 29.5–31.3s "The whole team, on the same page."
  outro: { from: 940, duration: 145 },  // 31.3–36.2s defocus + letterpress sign-off (+1s hold)
} as const; // sum = 1085

export const AIFL_TOTAL = 1085;
