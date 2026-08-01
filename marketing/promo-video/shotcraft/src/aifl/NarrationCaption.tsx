import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing } from 'remotion';

const SANS = "'Geist', 'Geist Fallback', ui-sans-serif, system-ui, sans-serif";
const ENCRE = '#08111f';
const BLEU = '#0664fe';

// Une plage d'interpolation DOIT etre strictement croissante. Un mot tres court
// (« Ça », moins de deux images) faisait passer sa fin avant le point de montee
// et Remotion refusait de rendre : « inputRange must be strictly monotonically
// increasing but got [4,6,5.45,10.45] ». On force donc l'ordre au lieu de
// supposer que la duree du mot est suffisante.
const croissant = (a: number, b: number, c: number, d: number) => {
  const p1 = a + Math.max(0.5, b - a);
  const p2 = Math.max(c, p1 + 0.5);
  return [a, p1, p2, Math.max(d, p2 + 0.5)];
};

export type Mot = { m: string; t0: number; t1: number };

/**
 * SOUS-TITRE QUI SUIT LA VOIX AU MOT.
 *
 * Chaque mot apparait a l'instant ou il est prononce : sa date vient de
 * l'alignement caractere par caractere rendu par la synthese vocale, pas d'un
 * decalage par index. C'est la reponse au reproche « quand il dit des choses, ca
 * se dit pas en meme temps que le texte apparait » : le decalage n'est plus
 * regle, il est impossible.
 *
 * Le mot EN COURS de prononciation porte le bleu de la marque, puis retombe a
 * l'encre. C'est ce qui rend la synchronisation visible : l'oeil suit la voix.
 */
export const NarrationCaption: React.FC<{
  mots: Mot[];
  duree: number;          // duree de la ligne, en images
  bas?: number;
  taille?: number;
}> = ({ mots, duree, bas = 96, taille = 46 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // La ligne entiere s'efface sur les 7 dernieres images, pour ne pas couper net.
  const sortie = interpolate(frame, [duree - 7, duree], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: sortie }}>
      {/* LE VOILE : UN DEGRADE QUI S'ETEINT, PAS UNE PLAQUE.
          « Le texte avec un fond blanc qui gâche la vue derrière. » C'etait
          exact : une plaque opaque a 86 % posee sur le planning en cachait un
          tiers, et son bord franc dessinait un rectangle au milieu de l'image.
          Elle est remplacee par un degrade vertical qui part du bas et s'eteint
          completement avant le texte. Il assoit la typographie sans dessiner de
          contour, et le produit reste lisible de bout en bout. */}
      <div
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          height: bas + 240,
          background: 'linear-gradient(180deg,'
            + ' rgba(250, 251, 253, 0) 0%,'
            + ' rgba(250, 251, 253, 0.62) 42%,'
            + ' rgba(250, 251, 253, 0.90) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute', left: 0, right: 0, bottom: bas,
          display: 'flex', justifyContent: 'center',
        }}
      >
        <div
          style={{
            display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
            alignItems: 'baseline', columnGap: '0.30em', rowGap: 4,
            maxWidth: 1500, padding: '0 40px',
            fontFamily: SANS, fontSize: taille, fontWeight: 680,
            letterSpacing: '-0.016em', lineHeight: 1.14, color: ENCRE,
            // LA LISIBILITE VIENT D'UN HALO, PAS D'UNE BOITE. Quatre ombres
            // claires serrees autour des glyphes font un lisere qui detache le
            // texte de n'importe quel fond clair : y compris une capture d'ecran
            // dense : sans rien masquer. C'est ce que fait un sous-titre de
            // cinema, en inverse (halo sombre sur image claire ici).
            textShadow: '0 0 14px rgba(250,251,253,0.98),'
              + ' 0 0 28px rgba(250,251,253,0.92),'
              + ' 0 2px 3px rgba(250,251,253,1),'
              + ' 0 0 3px rgba(250,251,253,1)',
          }}
        >
          {mots.map((mot, i) => {
            const f0 = mot.t0 * fps;
            const f1 = mot.t1 * fps;
            const entree = interpolate(frame, [f0 - 1.5, f0 + 4], [0, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
              easing: Easing.bezier(0.2, 0.85, 0.25, 1),
            });
            // Le mot est « actif » pendant qu'il est dit, plus deux images de
            // trainee : la couleur suit la bouche, pas un compteur.
            const actif = interpolate(frame, croissant(f0, f0 + 1.5, f1 + 1, f1 + 5), [0, 1, 1, 0], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            });
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  opacity: entree,
                  transform: `translateY(${(1 - entree) * 14}px) scale(${0.9 + 0.1 * entree})`,
                  filter: `blur(${(1 - entree) * 5}px)`,
                  color: actif > 0.02 ? BLEU : ENCRE,
                  whiteSpace: 'pre',
                }}
              >
                {mot.m}
              </span>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
