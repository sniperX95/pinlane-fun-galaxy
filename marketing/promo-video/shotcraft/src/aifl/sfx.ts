import { AIFL_SHOTS } from './shots';
import NARRATION from './narration.json';
import { macro } from './ouverture';

// LA TABLE DE BRUITAGES. CALEE RELATIVEMENT AU DEBUT DE CHAQUE PLAN.
//
// Regle dure de `video-shotcraft/references/sound-design.md` § 4.5 : ne jamais
// ecrire de frame absolue. La version precedente le faisait, et la moindre
// modification de duree d'un plan invalidait toutes les entrees suivantes : la
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
// sonorise les DOUZE premieres poses : au-dela l'intervalle tombe sous 2 images
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
  // La vue large tient maintenant le temps de deux phrases : ces cinq sons
  // suivent la camera au lieu d'une image ecrite en dur (voir `ouverture.ts`).
  { from: S.morning.from + macro(110), src: 'sweep-fast-small.mp3', volume: 0.28 }, // le cadre se ferme sur la carte
  { from: S.morning.from + macro(114), src: 'ui-zoom-in.mp3', volume: 0.85 },     // debut du rapproche (fichier a -14 dB)
  { from: S.morning.from + macro(127), src: 'whoosh-big.mp3', volume: 0.50 },     // la reservation se souleve
  { from: S.morning.from + macro(141), src: 'sparkle.mp3', volume: 0.34 },        // le faisceau la balaie
  { from: S.morning.from + macro(196), src: 'air-woosh-quick.mp3', volume: 0.30 },// elle redescend
  { from: S.morning.from + macro(204), src: 'transition-snap.mp3', volume: 0.50 },// et se recale

  // ---- LA SCENE DU COMPTOIR ET L'APPEL MANQUE -------------------------
  //
  // Ces deux plans jouent le probleme au lieu de le decrire : on est derriere le
  // comptoir, il y a du monde, ca doit s'ENTENDRE. D'ou une nappe d'ambiance de
  // centre de loisirs (brouhaha, quilles au loin, arcade) sous toute la sequence,
  // et des sons cales sur les mots exactement comme l'animation qu'ils
  // accompagnent.
  //
  // L'ambiance dure 5 s : quatre passes couvrent les TROIS cartons du probleme
  // (`cardA` est nouveau : la marche « d'ou vient une resa »). Elle est
  // volontairement basse : c'est un fond, pas un effet.
  // « Les SFX de bowling c'est trop, il doit y en avoir qu'une. » L'ambiance est
  // regeneree : brouhaha etouffe, une SEULE quille au loin, pas d'arcade.
  //
  // `volume` EST UN COEFFICIENT, PAS UN NIVEAU CIBLE : piege documente par la
  // reference du skill pour les fichiers enregistres bas. Celui-ci sort a
  // -47,1 dB de moyenne (crete -33,5) : a 0,20 il n'existait pas. A x4 la moyenne
  // monte a -35 dB et la crete a -21,5, donc aucun risque de saturation.
  // (PLUS D'AMBIANCE DE FOND. Il y en avait une : brouhaha de centre de loisirs ,
  // sous les trois cartons du probleme, et je l'avais rendue 20 dB plus forte au
  // tour precedent en croyant l'ameliorer. Verdict : « y a trop de bruit
  // parasite, des gens qui parlent en fond, je demandais pas ca ». C'etait une
  // idee a moi, jamais demandee, et la monter n'a fait que la rendre genante.
  // Un fond d'ambiance ajoute de la texture SEULEMENT si le film en manque ;
  // ici il y a deja une nappe musicale et cinquante bruitages, et un troisieme
  // lit de son ne fait qu'encombrer le milieu du spectre, la ou vit la voix.)

  // cardA : d'ou arrive une reservation : trois chemins se tracent, celui du
  // telephone l'emporte.
  { from: S.cardA.from, src: 'whoosh-swirl.mp3', volume: 0.38, coupe: 44 },
  // LES TROIS CHEMINS QUI SE TRACENT. Le son tombe sur l'ARRIVEE du point de
  // lumiere sur la carte, pas sur son depart : le trace dure 16 images, donc le
  // contact se produit 16 images apres le debut du mouvement (piege 71).
  ...[0, 1, 2].map((n) => ({
    from: surMot('cardA', 'comment', 45) + n * 7,
    src: n % 2 === 0 ? 'sweep-fast-small.mp3' : 'air-woosh-quick.mp3',
    volume: +(0.26 - n * 0.04).toFixed(3),
    coupe: 16,
  })),
  ...[0, 1, 2].map((n) => ({
    from: surMot('cardA', 'comment', 45) + n * 7 + 16,
    src: n % 2 === 0 ? 'ui-select-click.mp3' : 'switch-tap.mp3',
    volume: +(0.30 - n * 0.05).toFixed(3),
    coupe: 12,
  })),
  // Le telephone l'emporte : une vraie sonnerie, une seule, sur le mot, plus
  // l'impact qui marque le verdict.
  { from: surMot('cardA', 'neuf', 92) + 4, src: 'sonnerie-telephone.mp3', volume: 0.44, coupe: 66 },
  { from: surMot('cardA', 'neuf', 92) + 10, src: 'hit-weak.mp3', volume: 0.30, coupe: 14 },

  // cardB : la scene du comptoir.
  { from: S.cardB.from, src: 'wind-swoosh-short.mp3', volume: 0.36, coupe: 40 },
  { from: surMot('cardB', 'comptoir', 34) - 4, src: 'sweep-fast-small.mp3', volume: 0.30 }, // le plan se pose
  // trois personnes qui arrivent : trois pops en decroissance (regle 4.2)
  ...[0, 1, 2].map((n) => ({
    from: surMot('cardB', 'groupes', 62) - 6 + n * 5,
    src: n % 2 === 0 ? 'pop.mp3' : 'switch-tap.mp3',
    volume: +(0.30 - n * 0.05).toFixed(3),
    coupe: 14,
  })),
  { from: surMot('cardB', 'encaisser', 104) - 4, src: 'ui-select-click.mp3', volume: 0.34 }, // le terminal
  { from: surMot('cardB', 'encaisser', 104) + 6, src: 'switch-tap.mp3', volume: 0.24 },
  // UNE VRAIE SONNERIE, pas un bip d'interface. `ui-notify-tech` est une
  // notification logicielle : elle ne dit pas « le telephone du comptoir sonne ».
  { from: surMot('cardB', 'sonne', 22) - 4, src: 'sonnerie-telephone.mp3', volume: 0.50, coupe: 120 },

  // cardC : ce que l'appel manque coute.
  { from: S.cardC.from, src: 'sweep-short.mp3', volume: 0.34 },
  { from: S.cardC.from + 3, src: 'impact-cine.mp3', volume: 0.22, coupe: 40 },
  { from: surMot('cardC', 'rates', 56), src: 'bass-hit-short.mp3', volume: 0.40 },          // l'appel tombe
  { from: surMot('cardC', 'rates', 56) + 2, src: 'heartbeat-single.mp3', volume: 0.34 },
  { from: surMot('cardC', 'ailleurs', 90) - 8, src: 'air-woosh-quick.mp3', volume: 0.34 },  // ils s'en vont
  { from: surMot('cardC', 'ailleurs', 90) + 14, src: 'ui-select-click.mp3', volume: 0.30 }, // et reservent la-bas

  // ---- Carton du basculement : on ouvre ------------------------------
  { from: S.card1.from, src: 'riser-cine.mp3', volume: 0.30, coupe: 42 },
  { from: S.card1.from + 10, src: 'shimmer-sparkle-sweep.mp3', volume: 0.26, coupe: 40 },
  // LES TROIS ABSORPTIONS. Le pictogramme avale une etiquette toutes les dix
  // images a partir de `prend` + 6 : chacune produit une onde, donc chacune a
  // son son. Deux echantillons alternes et un volume decroissant (regle 4.2) ,
  // trois fois le meme timbre se serait entendu comme un bug.
  ...[0, 1, 2].map((n) => ({
    from: surMot('card1', 'prend', 36) + 6 + n * 10,
    src: n % 2 === 0 ? 'pop-electric.mp3' : 'sparkle-touch.mp3',
    volume: +(0.34 - n * 0.05).toFixed(3),
    coupe: 20,
  })),
  { from: surMot('card1', 'prend', 36) + 32, src: 'ui-success-soft.mp3', volume: 0.26, coupe: 24 },

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
  { from: S.card2.from, src: 'swoosh-quick.mp3', volume: 0.38 },
  // LA CARTE QUI DECOLLE, PUIS QUI SE REPOSE. Le mouvement dure 26 images et son
  // altitude suit un sinus : elle est en haut a la moitie, reposee a la fin.
  // Deux sons, donc, et le second sur l'ATTERRISSAGE.
  { from: surMot('card2', 'remonte', 40) - 2, src: 'whoosh-big.mp3', volume: 0.34, coupe: 26 },
  { from: surMot('card2', 'remonte', 40) + 26, src: 'transition-snap.mp3', volume: 0.38, coupe: 18 },

  // ---- Dossiers : la pile s'empile ------------------------------------
  { from: S.chart.from + 3, src: 'transition-soft.mp3', volume: 0.42 },
  { from: S.chart.from + 8, src: 'sweep-fast-small.mp3', volume: 0.30 },     // le tri
  // ScenePapers : depart du bloc n a CUES[n] = 18 + 12n, atterrissage 22 images
  // plus tard. Le son doit tomber sur l'ATTERRISSAGE (40, 52, 64, 76, 88) : la
  // premiere version le posait sur le depart, donc 22 images : presque une
  // seconde : avant que le bloc ne touche.
  ...[0, 1, 2, 3, 4].map((n) => ({
    from: S.chart.from + 18 + n * 12 + 22,
    src: n % 2 === 0 ? 'paper-slide.mp3' : 'paper-move-quick.mp3',
    volume: +(0.40 - n * 0.03).toFixed(3),
    coupe: 18,
  })),
  { from: S.chart.from + 92, src: 'ui-success-soft.mp3', volume: 0.30 },   // la pile est complete

  // ---- Carton 3 --------------------------------------------------------
  { from: S.cardWbr.from, src: 'transition-soft.mp3', volume: 0.40 },
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
  { from: S.card3.from, src: 'sweep-fast-small.mp3', volume: 0.36 },
  // LES TROIS ZEROS : la carte apparait sur le mot, et sa barre la raye six
  // images plus tard. Deux evenements distincts, donc deux sons : c'est ce
  // decalage qui fait entendre une mecanique au lieu d'un simple clic.
  ...[
    { cle: 'saisie', repli: 20 },
    { cle: 'double', repli: 55 },
    { cle: 'appel', repli: 90 },
  ].flatMap((z, n) => [
    { from: surMot('card3', z.cle, z.repli) - 4, src: n % 2 === 0 ? 'pop.mp3' : 'pop-electric.mp3',
      volume: +(0.34 - n * 0.03).toFixed(3), coupe: 16 },
    { from: surMot('card3', z.cle, z.repli) + 8, src: 'hit-weak.mp3',
      volume: +(0.28 - n * 0.03).toFixed(3), coupe: 14 },
  ]),
  { from: surMot('card3', 'appel', 90) + 22, src: 'ui-success-soft.mp3', volume: 0.32, coupe: 26 },

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
// : la reference en liste 21 dans ce cas.
export const longueur = (s: Son) => s.coupe ?? 90;
