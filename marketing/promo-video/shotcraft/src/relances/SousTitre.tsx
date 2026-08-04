// LE SOUS-TITRE : UNE FENETRE QUI ROULE, PAS UN PARAGRAPHE QUI SE POSE.
//
// Movsar : « le texte est beaucoup trop long des fois. C'est sans motion, genre
// on voit uniquement le texte apparaitre sans grande motion sur le texte. Il
// parle 7 a 10 secondes sans motion, juste un texte qui apparait. »
//
// DEUX DEFAUTS, et ils ont la meme cause.
//
// La ligne entiere etait affichee d'un bloc, ses mots s'allumant un par un. Sur
// une phrase de vingt-six mots, ca fait dix secondes pendant lesquelles le cadre
// ne bouge pas : le seul evenement est un mot qui change de couleur. Et comme le
// bloc doit contenir toute la phrase, le corps est petit et la lecture molle.
//
// Ici la phrase est decoupee en GROUPES DE SOUFFLE de trois a cinq mots, et
// chaque groupe REMPLACE le precedent au moment ou il est dit. Trois consequences
// directes :
//
//   1. le texte est court, donc gros, donc lisible sur un telephone ;
//   2. il se passe quelque chose toutes les 1 a 2 secondes au lieu de toutes les
//      10 : le groupe monte, son flou se resorbe, le precedent s'efface ;
//   3. le mot en cours porte l'accent de marque, donc l'oeil suit la voix.
//
// Le decoupage se fait sur la PONCTUATION d'abord, sur le compte ensuite : une
// phrase se lit par groupes de souffle, pas par tranches de quatre mots.
import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { BLEU, ENCRE } from '../aifl/scene3d';

export type Mot = { m: string; t0: number; t1: number };

const MAX_MOTS = 5;

/** Coupe la ligne en groupes de souffle. La ponctuation ferme un groupe ; a
 *  defaut, on ferme a cinq mots. Un groupe d'un seul mot est recolle au
 *  precedent : « Anniversaire. » seul a l'ecran se lit comme un bug. */
export const grouper = (mots: Mot[]): Mot[][] => {
  const groupes: Mot[][] = [];
  let courant: Mot[] = [];
  mots.forEach((mot) => {
    courant.push(mot);
    const ferme = /[.!?:;,]$/.test(mot.m) || courant.length >= MAX_MOTS;
    if (ferme) { groupes.push(courant); courant = []; }
  });
  if (courant.length) groupes.push(courant);
  // Recollage des orphelins.
  for (let i = groupes.length - 1; i > 0; i -= 1) {
    if (groupes[i].length === 1 && groupes[i - 1].length + 1 <= MAX_MOTS + 1) {
      groupes[i - 1] = groupes[i - 1].concat(groupes[i]);
      groupes.splice(i, 1);
    }
  }
  return groupes;
};

export const SousTitre: React.FC<{
  mots: Mot[];
  duree: number;
  bas?: number;
  taille?: number;
}> = ({ mots, duree, bas = 96, taille = 58 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const groupes = grouper(mots);
  const t = frame / fps;

  // Le groupe courant : celui dont le premier mot a commence et dont le suivant
  // n'a pas encore commence. La bascule suit la VOIX, jamais une horloge.
  let index = 0;
  groupes.forEach((g, i) => { if (t >= g[0].t0 - 0.08) index = i; });
  const groupe = groupes[index];
  if (!groupe) return null;

  const debut = groupe[0].t0 - 0.08;
  const age = t - debut;
  // L'entree : monte, flou qui se resorbe, opacite. C'est ce qui manquait, et
  // c'est le seul mouvement du cadre pendant les longues phrases.
  const entree = interpolate(age, [0, 0.26], [0, 1], {
    easing: Easing.bezier(0.2, 0.9, 0.25, 1), extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  // La sortie de la LIGNE entiere, pour ne pas couper net a la coupe de plan.
  const finLigne = interpolate(frame, [duree - 7, duree], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute', left: 0, right: 0, bottom: bas,
        display: 'flex', justifyContent: 'center', padding: '0 70px',
        pointerEvents: 'none', opacity: finLigne,
      }}
    >
      <div
        style={{
          fontFamily: 'Geist', fontWeight: 600, fontSize: taille,
          lineHeight: 1.18, letterSpacing: '-0.026em', textAlign: 'center',
          color: ENCRE,
          opacity: entree,
          transform: `translateY(${(1 - entree) * 26}px) scale(${0.97 + 0.03 * entree})`,
          filter: entree < 0.99 ? `blur(${(1 - entree) * 7}px)` : undefined,
          // LE HALO, JAMAIS UNE PLAQUE. Une plaque opaque est un trou dans
          // l'image : celle du film precedent cachait un tiers du produit et son
          // bord franc dessinait un rectangle au milieu du cadre.
          textShadow: [
            '0 0 14px rgba(255,255,255,0.92)',
            '0 0 28px rgba(255,255,255,0.85)',
            '0 1px 0 rgba(255,255,255,0.9)',
            '0 2px 18px rgba(255,255,255,0.7)',
          ].join(', '),
        }}
      >
        {groupe.map((mot, i) => {
          // Le mot EN COURS porte l'accent de marque : l'oeil suit la voix au
          // lieu de balayer le groupe.
          const dit = t >= mot.t0 - 0.02;
          const encours = dit && t <= mot.t1 + 0.14;
          return (
            <span
              key={`${mot.m}-${i}`}
              style={{
                display: 'inline-block',
                marginRight: taille * 0.19,
                color: encours ? BLEU : ENCRE,
                opacity: dit ? 1 : 0.32,
                transform: `translateY(${dit ? 0 : 5}px)`,
              }}
            >
              {mot.m}
            </span>
          );
        })}
      </div>
    </div>
  );
};
