import { AIFL_SHOTS } from './shots';
import NARRATION from './narration.json';

// LA TABLE DE BRUITAGES — CALEE RELATIVEMENT AU DEBUT DE CHAQUE PLAN.
//
// Regle dure de `video-shotcraft/references/sound-design.md` § 4.5 : ne jamais
// ecrire de frame absolue. La version precedente le faisait, et la moindre
// modification de duree d'un plan invalidait toutes les entrees suivantes — la
// table du template a ete recalee trois fois, dont deux uniquement a cause de
// changements d'image. Ici chaque son est pose comme `plan.from + decalage` :
// changer la duree d'un plan anterieur ne casse rien.
//
// TROIS REGLES ANTI-MITRAILLETTE (§ 4.2), appliquees a la distribution des
// reservations, qui est le passage le plus dense du film :
//   1. DEUX ECHANTILLONS ALTERNES au lieu d'un seul repete.
//   2. VOLUME DECROISSANT le long de la serie, pour donner de la distance.
//   3. QUAND LA RAFALE SE BROUILLE, ON ARRETE DE SONORISER CHAQUE CARTE et on
//      laisse un seul whoosh la couvrir. L'oreille ne distingue pas plus les
//      individus d'une rafale que l'oeil ceux d'un flou de mouvement.
// Objectif d'ecoute : « un rythme qu'on peut compter », pas une repetition
// mecanique.

export type Son = { from: number; src: string; volume: number; coupe?: number };

const S = AIFL_SHOTS;
// UN SON SUR LE MOT QUI LE DECLENCHE.
//
// Les incrustations des cartons jouent leurs temps sur des MOTS (le telephone
// sonne quand la voix dit « telephone », les deux reservations se percutent quand
// elle dit « piste »). Leurs sons doivent donc tomber sur ces memes mots, pas sur
// un decalage devine depuis le debut du plan.  cherche le mot dans la
// table de narration et rend son image ABSOLUE dans le film.
const surMot = (plan: string, cle: string, repli: number) => {
  const l = NARRATION.lignes.find((x) => x.plan === plan);
  if (!l) return AIFL_SHOTS[plan as keyof typeof AIFL_SHOTS].from + repli;
  const nu = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const m = l.mots.find((x) => nu(x.m).includes(nu(cle)));
  const t = m ? m.t0 : null;
  const base = Math.round(l.at * NARRATION.fps);
  return t === null
    ? AIFL_SHOTS[plan as keyof typeof AIFL_SHOTS].from + repli
    : base + Math.round(t * NARRATION.fps);
};


// La cadence de distribution du plan `table` : la carte k part a
// `36 + 4k - 0.0792 k(k-1)` et se pose 12 images plus tard (SceneFlyIn). On
// sonorise les DOUZE premieres poses — au-dela l'intervalle tombe sous 2 images
// et la rafale se brouille : c'est le whoosh de la ligne suivante qui la porte.
const POSES_SONORISEES = 12;
const posePlan = (k: number) => Math.round(36 + 4 * k - 0.0792 * k * (k - 1)) + 12;

const distribution: Son[] = Array.from({ length: POSES_SONORISEES }, (_, k) => ({
  from: S.table.from + posePlan(k),
  // 1. deux echantillons alternes
  src: k % 2 === 0 ? 'paper-move-quick.mp3' : 'paper-slide.mp3',
  // 2. volume decroissant : 0,42 -> 0,20 sur la serie
  volume: +(0.42 - (0.22 * k) / (POSES_SONORISEES - 1)).toFixed(3),
  coupe: 14,
}));

export const SFX: Son[] = [
  // ---- Ouverture : marque, puis passage a la console --------------------
  { from: S.morning.from + 4, src: 'transition-soft.mp3', volume: 0.42 },
  { from: S.morning.from + 12, src: 'sparkle-touch.mp3', volume: 0.30 },   // le pictogramme se pose
  { from: S.morning.from + 78, src: 'whoosh-fast.mp3', volume: 0.45 },     // marque -> planning
  { from: S.morning.from + 114, src: 'ui-zoom-in.mp3', volume: 0.85 },     // debut du rapproche (fichier a -14 dB)
  { from: S.morning.from + 127, src: 'whoosh-big.mp3', volume: 0.50 },     // la reservation se souleve
  { from: S.morning.from + 141, src: 'sparkle.mp3', volume: 0.34 },        // le faisceau la balaie
  { from: S.morning.from + 196, src: 'air-woosh-quick.mp3', volume: 0.30 },// elle redescend
  { from: S.morning.from + 204, src: 'transition-snap.mp3', volume: 0.50 },// et se recale

  // ---- LA SCENE DU COMPTOIR ET L'APPEL MANQUE -------------------------
  //
  // Ces deux plans jouent le probleme au lieu de le decrire : on est derriere le
  // comptoir, il y a du monde, ca doit s'ENTENDRE. D'ou une nappe d'ambiance de
  // centre de loisirs (brouhaha, quilles au loin, arcade) sous toute la sequence,
  // et des sons cales sur les mots exactement comme l'animation qu'ils
  // accompagnent.
  //
  // L'ambiance dure 5 s : trois passes couvrent les deux cartons. Elle est
  // volontairement basse — c'est un fond, pas un effet.
  ...[0, 1, 2].map((n) => ({
    from: S.cardA.from + n * 150,
    src: 'ambiance-centre.mp3',
    volume: 0.20,
    coupe: 152,
  })),

  { from: S.cardA.from, src: 'swoosh-quick.mp3', volume: 0.40 },
  { from: surMot('cardA', 'comptoir', 20) - 4, src: 'sweep-fast-small.mp3', volume: 0.30 }, // le plan se pose
  // trois personnes qui arrivent : trois pops en decroissance (regle 4.2)
  ...[0, 1, 2].map((n) => ({
    from: surMot('cardA', 'groupes', 50) - 6 + n * 5,
    src: n % 2 === 0 ? 'pop.mp3' : 'switch-tap.mp3',
    volume: +(0.30 - n * 0.05).toFixed(3),
    coupe: 14,
  })),
  { from: surMot('cardA', 'encaisser', 92) - 4, src: 'ui-select-click.mp3', volume: 0.34 }, // le terminal
  { from: surMot('cardA', 'encaisser', 92) + 6, src: 'switch-tap.mp3', volume: 0.24 },
  // et le telephone qui sonne, deux fois, sans qu'on le prenne
  { from: surMot('cardA', 'sonne', 130) - 4, src: 'ui-notify-tech.mp3', volume: 0.40 },
  { from: surMot('cardA', 'sonne', 130) + 26, src: 'ui-notify-tech.mp3', volume: 0.34 },
  { from: surMot('cardA', 'sonne', 130) + 52, src: 'ui-notify-tech.mp3', volume: 0.28 },

  { from: S.cardB.from, src: 'sweep-short.mp3', volume: 0.34 },
  { from: S.cardB.from + 6, src: 'ui-notify-tech.mp3', volume: 0.26 },                      // ca sonne encore
  { from: surMot('cardB', 'rates', 56), src: 'bass-hit-short.mp3', volume: 0.40 },          // l'appel tombe
  { from: surMot('cardB', 'rates', 56) + 2, src: 'heartbeat-single.mp3', volume: 0.34 },
  { from: surMot('cardB', 'ailleurs', 90) - 8, src: 'air-woosh-quick.mp3', volume: 0.34 },  // ils s'en vont
  { from: surMot('cardB', 'ailleurs', 90) + 14, src: 'ui-select-click.mp3', volume: 0.30 }, // et reservent la-bas

  // ---- Carton du basculement : on ouvre ------------------------------
  { from: S.card1.from, src: 'wind-swoosh-short.mp3', volume: 0.42 },
  { from: S.card1.from + 10, src: 'shimmer-sparkle-sweep.mp3', volume: 0.26, coupe: 40 },

  // ---- Distribution : la pile, puis les cartes ------------------------
  { from: S.table.from + 2, src: 'transition-soft.mp3', volume: 0.40 },
  { from: S.table.from + 30, src: 'paper-page-turn.mp3', volume: 0.45 },   // la pile se decolle
  { from: S.table.from + 33, src: 'whoosh-big.mp3', volume: 0.48 },        // recul de la camera
  ...distribution,
  // 3. la rafale se brouille : un seul whoosh la couvre au lieu de 14 sons
  { from: S.table.from + 78, src: 'whoosh-swirl.mp3', volume: 0.46 },
  { from: S.table.from + 96, src: 'hit-weak.mp3', volume: 0.34 },          // derniere carte au sol
  { from: S.table.from + 100, src: 'air-woosh-quick.mp3', volume: 0.34 },  // plongee
  { from: S.table.from + 113, src: 'whoosh-big.mp3', volume: 0.46 },       // remontee vers la recherche
  { from: S.table.from + 126, src: 'keyboard.mp3', volume: 0.40, coupe: 20 },
  { from: S.table.from + 160, src: 'sweep-fast-small.mp3', volume: 0.40 }, // la grille se filtre
  { from: S.table.from + 176, src: 'click-camera.mp3', volume: 0.60 },     // le clic : SFX le plus fort du film
  { from: S.table.from + 180, src: 'swoosh-quick.mp3', volume: 0.35 },     // et on pousse dedans

  // ---- Detail : cinq lignes qui s'encastrent --------------------------
  { from: S.macro.from + 2, src: 'transition-soft.mp3', volume: 0.42 },
  { from: S.macro.from + 6, src: 'data-scan.mp3', volume: 0.24, coupe: 34 },  // la liste se lit
  // `paper-staple` est l'echantillon que la bibliotheque associe a `row-embed`.
  ...[0, 1, 2, 3, 4].map((n) => ({
    from: S.macro.from + 12 + n * 9 + 12,
    src: n % 2 === 0 ? 'paper-staple.mp3' : 'hit-weak.mp3',
    volume: +(0.40 - n * 0.035).toFixed(3),
    coupe: 16,
  })),

  // ---- Carton 2 --------------------------------------------------------
  { from: S.card2.from, src: 'swoosh-quick.mp3', volume: 0.40 },

  // ---- Dossiers : la pile s'empile ------------------------------------
  { from: S.chart.from + 3, src: 'transition-soft.mp3', volume: 0.42 },
  { from: S.chart.from + 8, src: 'sweep-fast-small.mp3', volume: 0.30 },     // le tri
  // ScenePapers : depart du bloc n a CUES[n] = 18 + 12n, atterrissage 22 images
  // plus tard. Le son doit tomber sur l'ATTERRISSAGE (40, 52, 64, 76, 88) : la
  // premiere version le posait sur le depart, donc 22 images — presque une
  // seconde — avant que le bloc ne touche.
  ...[0, 1, 2, 3, 4].map((n) => ({
    from: S.chart.from + 18 + n * 12 + 22,
    src: n % 2 === 0 ? 'paper-slide.mp3' : 'paper-move-quick.mp3',
    volume: +(0.40 - n * 0.03).toFixed(3),
    coupe: 18,
  })),
  { from: S.chart.from + 92, src: 'ui-success-soft.mp3', volume: 0.30 },   // la pile est complete

  // ---- Carton 3 --------------------------------------------------------
  { from: S.cardWbr.from, src: 'swoosh-quick.mp3', volume: 0.40 },
  { from: surMot('cardWbr', 'chiffre', 30), src: 'clock-knob-spin.mp3', volume: 0.30, coupe: 34 },
  { from: surMot('cardWbr', 'occupation', 60), src: 'data-scan.mp3', volume: 0.22, coupe: 30 },

  // ---- Tableau de bord : il se remplit, puis les 4 chiffres s'allument -
  { from: S.wbr.from + 4, src: 'transition-soft.mp3', volume: 0.40 },
  { from: S.wbr.from + 6, src: 'keyboard.mp3', volume: 0.32, coupe: 40 },
  ...[0, 1, 2, 3].map((n) => ({
    from: S.wbr.from + 65 + n * 5,
    src: n % 2 === 0 ? 'ui-select-click.mp3' : 'switch-tap.mp3',
    volume: +(0.40 - n * 0.04).toFixed(3),
    coupe: 12,
  })),
  { from: S.wbr.from + 88, src: 'ui-success-soft.mp3', volume: 0.34 },

  // ---- Carton 4 --------------------------------------------------------
  { from: S.card3.from, src: 'swoosh-quick.mp3', volume: 0.40 },
  { from: surMot('card3', 'saisie', 20), src: 'ui-select-click.mp3', volume: 0.36 },
  { from: surMot('card3', 'double', 55), src: 'ui-select-click.mp3', volume: 0.32 },
  { from: surMot('card3', 'appel', 90), src: 'ui-success-soft.mp3', volume: 0.34 },

  // ---- Signature : la formule en trois temps de la reference (§ 4.3) ---
  // riser (montee) -> ~35 images plus tard l'impact (le pic du film) ->
  // 25 images plus tard le sparkle (la resonance). C'est le seul enchainement
  // du template qui n'a jamais ete retouche.
  { from: S.outro.from + 5, src: 'riser-cine.mp3', volume: 0.48 },
  { from: S.outro.from + 40, src: 'impact-deep-whoosh.mp3', volume: 0.56 },
  { from: S.outro.from + 65, src: 'sparkle.mp3', volume: 0.30 },
  { from: S.outro.from + 78, src: 'camera-autofocus.mp3', volume: 0.24 },  // la baseline se pose
  { from: S.outro.from + 104, src: 'chime-crystal.mp3', volume: 0.26, coupe: 46 }, // l'appel a l'action
];

// Longueur jouee. Les echantillons longs (`keyboard` 19,6 s, `riser-cine` 4,8 s,
// `sparkle` 4,5 s) doivent etre tronques, sinon ils debordent sur le plan suivant
// — la reference en liste 21 dans ce cas.
export const longueur = (s: Son) => s.coupe ?? 90;
