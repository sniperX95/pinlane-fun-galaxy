import React from 'react';
import { interpolate, Easing } from 'remotion';

// LE SOCLE 3D DES INCRUSTATIONS.
//
// « On commence a passer de maquette a qualite amateur, mais nous on veut du
// pro. » Le diagnostic est juste et il est structurel : les incrustations
// etaient des formes PLATES posees sur du blanc, animees par une seule courbe
// d'entree. Trois choses manquaient, et aucune ne s'obtient en retouchant une
// valeur :
//
//   1. DE LA PROFONDEUR. Un objet sans epaisseur ni ombre de contact flotte. Il
//      faut une scene en perspective, des elements a des altitudes differentes,
//      et une ombre qui s'ecarte et se floute quand l'objet monte.
//   2. DE LA MATIERE. Un aplat de couleur avec un `border-radius` est une
//      maquette. Un degrade vertical, une arete claire en haut, une arete sombre
//      en bas et un reflet qui traverse font une SURFACE.
//   3. UN MOUVEMENT QUI A UNE MASSE. Une courbe d'easing unique donne un
//      glissement ; un ressort qui depasse puis se pose donne un objet qui a un
//      poids. Et un flou directionnel qui se resorbe est LE detail qui separe un
//      mouvement anime d'un mouvement rendu image par image.
//
// Tout ce qui suit est deterministe : chaque valeur derive de `frame`. Aucune
// date, aucun tirage : condition pour que Remotion recalcule une image et pour
// qu'une garde soit reproductible.

export const BLEU = '#0664fe';
export const BLEU_SOMBRE = '#0345b8';
export const ENCRE = '#08111f';
export const ATONE = '#55617a';
export const PALE = '#eef4ff';

const SANS = "'Geist', 'Geist Fallback', ui-sans-serif, system-ui, sans-serif";

/** Ressort amorti en forme CLOSE (jamais integre pas a pas : le rendu doit
 *  rester une fonction pure du temps). Depasse puis revient : c'est ce
 *  depassement qui donne une masse a l'objet. */
export const ressort = (frame: number, de: number, duree = 18, rebond = 1.7) => {
  const t = Math.min(1, Math.max(0, (frame - de) / duree));
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.exp(-6.5 * t) * Math.cos(rebond * Math.PI * t);
};

/** Rampe classique, pour tout ce qui ne doit PAS rebondir. */
export const monte = (frame: number, de: number, duree = 12, easing = Easing.bezier(0.22, 0.9, 0.24, 1)) =>
  interpolate(frame, [de, de + duree], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing,
  });

/** Flou directionnel qui se resorbe pendant l'entree. `px` est le flou a
 *  l'instant 0 ; il tombe a zero quand le mouvement se termine. */
export const flou = (t: number, px = 9) => `blur(${(1 - Math.min(1, t)) * px}px)`;

/** Ombre de contact en DEUX couches, pilotee par l'altitude (0 = pose, 1 = en
 *  l'air). La couche serree tient l'objet au sol, la couche large donne la
 *  hauteur. Sans les deux, l'objet a l'air colle ou a l'air de leviter. */
export const ombre = (altitude: number, teinte = '5, 30, 72') => {
  const a = Math.max(0, Math.min(1, altitude));
  return `0 ${2 + 8 * a}px ${6 + 14 * a}px rgba(${teinte}, ${0.14 + 0.06 * a}),`
    + ` 0 ${10 + 54 * a}px ${22 + 78 * a}px rgba(${teinte}, ${0.06 + 0.20 * a})`;
};

/** La derive lente de la « camera » d'une incrustation. Rien n'est jamais
 *  parfaitement immobile : un plan fige se lit comme une image, pas comme un
 *  film. L'amplitude est volontairement sous le seuil de conscience. */
export const derive = (frame: number, amplitude = 1.5, periode = 240) => ({
  rotY: Math.sin((frame / periode) * Math.PI * 2) * amplitude,
  rotX: Math.cos((frame / periode) * Math.PI * 2 + 1) * amplitude * 0.45,
});

/** La scene : perspective, derive de camera, et un sol qui recoit les ombres.
 *  Toutes les incrustations vivent dedans, ce qui leur donne un espace commun ,
 *  c'est cette coherence qui fait qu'un film a l'air fabrique par une seule
 *  main. */
export const Plateau: React.FC<{
  frame: number;
  largeur: number;
  hauteur: number;
  /** Distance de l'observateur. Plus elle est courte, plus la perspective est
   *  marquee. 1400 donne du relief sans deformer les textes. */
  perspective?: number;
  amplitude?: number;
  children: React.ReactNode;
}> = ({ frame, largeur, hauteur, perspective = 1400, amplitude = 1.5, children }) => {
  const d = derive(frame, amplitude);
  return (
    <div style={{ width: largeur, height: hauteur, margin: '0 auto', perspective, perspectiveOrigin: '50% 45%' }}>
      <div
        style={{
          position: 'relative', width: '100%', height: '100%',
          transformStyle: 'preserve-3d',
          transform: `rotateX(${d.rotX}deg) rotateY(${d.rotY}deg)`,
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** Une surface qui a une EPAISSEUR. Le degrade vertical, l'arete claire en haut
 *  et l'arete sombre en bas sont ce qui distingue une carte d'un rectangle. */
export const MATIERE_CLAIRE: React.CSSProperties = {
  background: 'linear-gradient(180deg, #ffffff 0%, #fbfcfe 55%, #f4f7fc 100%)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(5,30,72,0.07)',
};

export const MATIERE_BLEUE: React.CSSProperties = {
  background: `linear-gradient(165deg, #2b7cff 0%, ${BLEU} 45%, ${BLEU_SOMBRE} 100%)`,
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 0 rgba(2,32,92,0.35)',
};

/** Un reflet qui TRAVERSE une surface. Il ne s'allume pas, il passe : c'est ce
 *  passage qui fait lire du verre plutot que du papier. `t` va de 0 a 1 sur la
 *  duree du balayage. */
export const Reflet: React.FC<{ t: number; rayon?: number; angle?: number }> = ({ t, rayon = 14, angle = 108 }) => {
  if (t <= 0 || t >= 1) return null;
  const x = -60 + t * 220;
  return (
    <div
      style={{
        position: 'absolute', inset: 0, borderRadius: rayon, overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute', top: '-60%', bottom: '-60%', left: `${x}%`, width: '32%',
          background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 100%)',
          transform: `rotate(${angle - 90}deg)`,
          filter: 'blur(6px)',
          opacity: Math.sin(t * Math.PI),
        }}
      />
    </div>
  );
};

/** Le halo doux qui detache un objet du fond blanc. Sans lui, un objet clair sur
 *  un fond clair n'a pas de presence. */
export const Halo: React.FC<{ intensite: number; taille?: number; couleur?: string }> = ({
  intensite, taille = 460, couleur = '6, 100, 254',
}) => (
  <div
    style={{
      position: 'absolute', left: '50%', top: '50%',
      width: taille, height: taille, transform: 'translate(-50%, -50%)',
      background: `radial-gradient(circle, rgba(${couleur}, ${0.16 * intensite}), transparent 68%)`,
      pointerEvents: 'none',
    }}
  />
);

/** Une particule de lumiere qui part d'un point : l'accent qu'on pose sur un
 *  impact. Une seule, jamais une rafale : les halos en serie font cheap, un
 *  eclat unique de qualite non. */
export const Eclat: React.FC<{ t: number; taille?: number }> = ({ t, taille = 200 }) => {
  if (t <= 0 || t >= 1) return null;
  const e = Math.sin(t * Math.PI);
  return (
    <div
      style={{
        position: 'absolute', left: '50%', top: '50%',
        width: taille * (0.5 + t), height: taille * (0.5 + t),
        transform: 'translate(-50%, -50%)',
        borderRadius: '50%',
        border: `2px solid rgba(6, 100, 254, ${0.5 * (1 - t)})`,
        boxShadow: `0 0 ${40 * e}px rgba(6, 100, 254, ${0.35 * e})`,
        pointerEvents: 'none',
      }}
    />
  );
};

/** Une etiquette de valeur, en typographie de produit. Utilisee partout pour que
 *  les chiffres du film aient tous la meme voix graphique. */
export const Pastille: React.FC<{
  texte: string; actif?: boolean; opacite?: number; echelle?: number; z?: number;
}> = ({ texte, actif = false, opacite = 1, echelle = 1, z = 0 }) => (
  <div
    style={{
      fontFamily: SANS, fontSize: 22, fontWeight: 560, letterSpacing: '0.02em',
      color: actif ? '#fff' : ATONE,
      ...(actif ? MATIERE_BLEUE : MATIERE_CLAIRE),
      border: actif ? 'none' : '1px solid rgba(5, 30, 72, 0.10)',
      padding: '13px 24px', borderRadius: 999, whiteSpace: 'nowrap',
      opacity: opacite,
      transform: `translateZ(${z}px) scale(${echelle})`,
      boxShadow: actif
        ? `0 10px 28px rgba(6, 100, 254, 0.30), ${MATIERE_BLEUE.boxShadow}`
        : `0 6px 18px rgba(5, 30, 72, 0.10), ${MATIERE_CLAIRE.boxShadow}`,
    }}
  >
    {texte}
  </div>
);
