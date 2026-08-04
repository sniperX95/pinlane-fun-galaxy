// LE SOUS-TITRE : DE LA TYPOGRAPHIE CINETIQUE, PAS UN INTERRUPTEUR.
//
// Movsar, deux fois : « plus de motion sur le texte que t'ecris, parce que
// c'est moche la, le texte qui pop comme ca ».
//
// LA CAUSE DU « POP », nommable : les mots pas encore dits etaient affiches en
// fantome a 32 %, puis passaient a 100 % au moment ou la voix les disait. Ce
// n'est pas une animation, c'est un INTERRUPTEUR : deux etats, aucun trajet
// entre les deux. Et le fantome fait de la bouillie visuelle avant meme que le
// mot compte.
//
// Ce qui remplace : un mot pas encore dit n'existe PAS, et chaque mot ARRIVE
// avec son propre geste, cale sur sa propre date. Quatre couches faibles
// superposees, jamais un effet fort (regle du vault d'Arlan) :
//
//   1. il monte avec un depassement, comme les objets du film (ressort ferme) ;
//   2. son flou directionnel se resorbe, ce qui separe un mouvement anime d'un
//      mouvement rendu image par image ;
//   3. une PASTILLE de marque flashe derriere lui puis se dissout : c'est le
//      « typer » du vault d'Arlan, ou une lettre passe par un etat plein avant
//      d'atterrir en texte nu. Version sobre, parce qu'un sous-titre doit rester
//      lisible sur un telephone en silence ;
//   4. l'interlettrage se resserre en arrivant, de 0,04 em a la valeur finale.
//
// Le traitement est le MEME du debut a la fin du film : c'est un procede attache
// a un TYPE d'element (§I.5 bis), donc sa constance fait le style. Ce qui varie,
// c'est uniquement la date de chaque mot, et elle vient de l'alignement.
import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { BLEU, ENCRE } from '../aifl/scene3d';

export type Mot = { m: string; t0: number; t1: number };

const MAX_MOTS = 5;

/** Coupe la ligne en groupes de souffle. La ponctuation ferme un groupe ; a
 *  defaut, on ferme a cinq mots. Un groupe d'un seul mot se recolle au
 *  precedent : un mot seul a l'ecran se lit comme un bug. */
export const grouper = (mots: Mot[]): Mot[][] => {
  const groupes: Mot[][] = [];
  let courant: Mot[] = [];
  mots.forEach((mot) => {
    courant.push(mot);
    if (/[.!?:;,]$/.test(mot.m) || courant.length >= MAX_MOTS) { groupes.push(courant); courant = []; }
  });
  if (courant.length) groupes.push(courant);
  for (let i = groupes.length - 1; i > 0; i -= 1) {
    if (groupes[i].length === 1 && groupes[i - 1].length + 1 <= MAX_MOTS + 1) {
      groupes[i - 1] = groupes[i - 1].concat(groupes[i]);
      groupes.splice(i, 1);
    }
  }
  return groupes;
};

/** Le ressort en forme CLOSE : jamais integre pas a pas, sinon le rendu cesse
 *  d'etre une fonction pure de l'image et Remotion ne peut plus recalculer une
 *  image isolee. Le depassement est ce qui donne un poids au mot. */
const ressort = (t: number) => (t <= 0 ? 0 : (t >= 1 ? 1 : 1 - Math.exp(-6.5 * t) * Math.cos(1.7 * Math.PI * t)));

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
  groupes.forEach((g, i) => { if (t >= g[0].t0 - 0.10) index = i; });
  const groupe = groupes[index];
  if (!groupe) return null;

  // La sortie du groupe : il derive vers le bas et se floute quand le suivant
  // arrive. Une coupe nette entre deux groupes se lit comme un clignotement.
  const suivant = groupes[index + 1];
  const sortie = suivant
    ? interpolate(t, [suivant[0].t0 - 0.22, suivant[0].t0 - 0.10], [1, 0], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    })
    : 1;
  const finLigne = interpolate(frame, [duree - 8, duree], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute', left: 0, right: 0, bottom: bas,
        display: 'flex', justifyContent: 'center', padding: '0 66px',
        pointerEvents: 'none', opacity: finLigne * sortie,
        transform: `translateY(${(1 - sortie) * 14}px)`,
        filter: sortie < 0.99 ? `blur(${(1 - sortie) * 5}px)` : undefined,
      }}
    >
      <div
        style={{
          fontFamily: 'Geist', fontWeight: 600, fontSize: taille,
          lineHeight: 1.22, textAlign: 'center', color: ENCRE,
          display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
          columnGap: taille * 0.2, rowGap: taille * 0.04,
        }}
      >
        {groupe.map((mot, i) => {
          // CHAQUE MOT A SA PROPRE DATE, donc sa propre arrivee. C'est ce qui
          // remplace l'interrupteur : il y a un TRAJET entre l'absence et la
          // presence, et ce trajet dure 0,34 s.
          const age = t - (mot.t0 - 0.06);
          if (age < 0) {
            // Le mot n'existe pas encore : il occupe sa place pour que la ligne
            // ne saute pas, mais il n'est pas visible. Un fantome a 32 % faisait
            // de la bouillie avant meme que le mot compte.
            return (
              <span key={`${mot.m}-${i}`} style={{ display: 'inline-block', opacity: 0 }}>{mot.m}</span>
            );
          }
          const p = ressort(Math.min(1, age / 0.34));
          const doux = interpolate(age, [0, 0.34], [0, 1], {
            easing: Easing.bezier(0.22, 0.9, 0.24, 1), extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
          });
          // La pastille de marque : pleine a l'arrivee, dissoute en 0,3 s. C'est
          // le « typer » du vault d'Arlan, ramene a ce qu'un sous-titre supporte.
          const pastille = interpolate(age, [0, 0.06, 0.30], [0, 0.9, 0], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
          });
          const encours = t >= mot.t0 - 0.02 && t <= mot.t1 + 0.16;
          return (
            <span
              key={`${mot.m}-${i}`}
              style={{
                position: 'relative', display: 'inline-block',
                opacity: doux,
                transform: `translateY(${(1 - p) * 16}px) scale(${0.93 + 0.07 * p})`,
                filter: doux < 0.98 ? `blur(${(1 - doux) * 6}px)` : undefined,
                letterSpacing: `${-0.026 + (1 - doux) * 0.05}em`,
                color: encours ? BLEU : ENCRE,
                // LE HALO, JAMAIS UNE PLAQUE : une plaque opaque est un trou
                // dans l'image.
                textShadow: [
                  '0 0 13px rgba(255,255,255,0.95)',
                  '0 0 26px rgba(255,255,255,0.88)',
                  '0 1px 0 rgba(255,255,255,0.92)',
                  '0 2px 20px rgba(255,255,255,0.72)',
                ].join(', '),
              }}
            >
              {/* La pastille vit DERRIERE le mot, en flux inverse : elle
                  s'imprime puis rend la place au texte nu. */}
              <span
                style={{
                  position: 'absolute',
                  left: -taille * 0.11, right: -taille * 0.11,
                  top: taille * 0.06, bottom: taille * 0.12,
                  background: BLEU,
                  borderRadius: 999,
                  opacity: pastille * 0.22,
                  transform: `scaleX(${0.86 + 0.14 * Math.min(1, age / 0.06)})`,
                  zIndex: -1,
                }}
              />
              {mot.m}
            </span>
          );
        })}
      </div>
    </div>
  );
};
