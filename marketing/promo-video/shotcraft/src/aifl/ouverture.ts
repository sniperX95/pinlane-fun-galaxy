import { AIFL_SHOTS } from './shots';
import NARRATION from './narration.json';

// LES ANCRAGES DU PLAN D'OUVERTURE, DERIVES DE LA VOIX.
//
// Ce fichier existe pour la meme raison que `shots.ts` : une donnee partagee par
// deux modules appartient a un troisieme (`SceneOpen` la lit pour sa camera,
// `sfx.ts` pour ses bruitages, et un import croise donnerait « Cannot access
// before initialization »).
//
// LE PROBLEME QU'IL RESOUT. Le plan d'ouverture tenait sa vue large 28 images —
// 0,9 seconde. Assez pour montrer le planning, pas pour l'expliquer, et c'est
// exactement ce que Movsar a vu : « le "ça" on capte pas, parce qu'on comprend
// pas direct que c'est un planning ». Le plan porte maintenant trois phrases :
// la question qui qualifie, la presentation de la grille, puis la reservation
// qu'on met en evidence.
//
// La camera ne part donc plus a une image ecrite en dur, elle part QUAND LA VOIX
// PASSE A LA RESERVATION. Les ecarts du motion design d'origine (114 -> 130 ->
// 140 -> 194 -> 212) sont conserves tels quels et decales d'un bloc : les
// courbes et les proportions de duree sont le travail du template, on ne touche
// qu'a l'ancrage (piege 52).

const MORNING = AIFL_SHOTS.morning;
const LIGNES_OUVERTURE = NARRATION.lignes.filter((l) => l.plan === 'morning');

// Combien d'images AVANT le mot ? L'oeil doit etre arrive sur la carte quand la
// voix la nomme, donc le mouvement commence avant la phrase.
const AVANCE = 16;

// Repli : la valeur d'origine du template, si jamais le plan d'ouverture perdait
// sa troisieme phrase. Le film joue toujours, avec l'ancien rythme.
const REPLI_VERROU = 114;

const troisieme = LIGNES_OUVERTURE[2];

/** Image (relative au plan) ou la camera quitte la vue large et part sur la
 *  reservation. */
export const T_VERROU = troisieme
  ? Math.max(96, Math.round(troisieme.at * NARRATION.fps) - MORNING.from - AVANCE)
  : REPLI_VERROU;

/** Le decalage a appliquer a tout ce qui suivait le verrou dans le template. */
export const DECALAGE_MACRO = T_VERROU - REPLI_VERROU;

/** Une image du template, replacee sur le nouveau rythme. Les instants ANTERIEURS
 *  au verrou (la marque, l'arrivee de la page) ne bougent pas. */
export const macro = (imageTemplate: number) =>
  (imageTemplate >= REPLI_VERROU ? imageTemplate + DECALAGE_MACRO : imageTemplate);

// LA MISE AU POINT TOMBE SUR LE MOT, comme les incrustations des cartons.
//
// La deuxieme phrase decrit la grille : « Chaque colonne, une piste. Chaque
// BLOC, un groupe qui a réservé. » Le cadre se ferme sur une reservation
// exactement quand la voix dit « bloc » — sinon il designe une carte pendant
// qu'on parle des colonnes, et c'est encore un « mal calibre avec l'image ».
// Repli : 62 images avant le depart de la camera, si le mot disparait du texte.
const nu = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const deuxieme = LIGNES_OUVERTURE[1];
const motBloc = deuxieme && deuxieme.mots.find((m) => nu(m.m).includes('bloc'));

export const T_MISE_AU_POINT = deuxieme && motBloc
  ? Math.round((deuxieme.at + motBloc.t0) * NARRATION.fps) - MORNING.from - 4
  : T_VERROU - 62;
