// LA CAMERA : elle vise un RECTANGLE DE LA PAGE, jamais des coordonnees.
//
// C'est l'invariant §I.6 du manuel. Les cadrages du film precedent visaient des
// nombres ecrits a la main, et un mot finissait toujours par etre coupe apres
// une recapture. Ici on donne une boite lue dans le DOM (`live-layout.json`) et
// la camera calcule elle-meme l'echelle et le centre : une page qui change de
// hauteur deplace la camera avec elle.
import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile } from 'remotion';
import { derive, ombre } from '../aifl/scene3d';

export type Boite = { x: number; y: number; width: number; height: number };

// Le cote du film. Carre : le format est le meme dans les deux sens, donc une
// seule constante et aucune ambiguite sur l'axe qui contraint.
export const COTE = 1080;

/** Interpole entre deux cadrages. `t` de 0 a 1. */
export const entre = (a: Boite, b: Boite, t: number): Boite => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  width: a.width + (b.width - a.width) * t,
  height: a.height + (b.height - a.height) * t,
});

/** La boite qui contient toute la page, avec une marge. */
export const pageEntiere = (pageW: number, pageH: number, marge = 0): Boite => ({
  x: -marge, y: -marge, width: pageW + marge * 2, height: pageH + marge * 2,
});

/** Elargit une boite pour lui donner de l'air, en gardant son centre. */
export const air = (b: Boite, facteur: number): Boite => ({
  x: b.x - (b.width * (facteur - 1)) / 2,
  y: b.y - (b.height * (facteur - 1)) / 2,
  width: b.width * facteur,
  height: b.height * facteur,
});

/** Rend la boite CARREE en l'elargissant sur son petit cote : sans ca, cadrer une
 *  bande large dans un film carre laisse deux bandes vides en haut et en bas. */
export const carrer = (b: Boite): Boite => {
  const c = Math.max(b.width, b.height);
  return { x: b.x + b.width / 2 - c / 2, y: b.y + b.height / 2 - c / 2, width: c, height: c };
};

/**
 * Un plan sur une capture de page. La texture est posee sur un plateau en
 * perspective, avec une ombre de contact en deux couches et une derive de
 * camera sous le seuil de conscience : un plan fixe se lit comme une image, pas
 * comme un film.
 */
export const Cadre: React.FC<{
  texture: string;
  pageW: number;
  pageH: number;
  vise: Boite;
  frame: number;
  /** Flou d'entree qui se resorbe. C'est le detail qui separe un mouvement
   *  anime d'un mouvement rendu image par image. */
  entree?: number;
  children?: React.ReactNode;
}> = ({ texture, pageW, pageH, vise, frame, entree = 1, children }) => {
  const c = carrer(vise);
  const echelle = COTE / c.width;
  const d = derive(frame, 0.9, 300);
  const flouEntree = (1 - Math.min(1, entree)) * 7;

  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          width: COTE, height: COTE,
          perspective: 2200, perspectiveOrigin: '50% 48%',
        }}
      >
        <div
          style={{
            width: COTE, height: COTE,
            transformStyle: 'preserve-3d',
            transform: `rotateX(${d.rotX}deg) rotateY(${d.rotY}deg)`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              width: pageW * echelle,
              height: pageH * echelle,
              left: -c.x * echelle,
              top: -c.y * echelle,
              filter: flouEntree > 0.05 ? `blur(${flouEntree}px)` : undefined,
              // L'ombre de contact en DEUX couches : la serree tient la page au
              // sol, la large donne la hauteur. Avec une seule, l'objet a l'air
              // colle ou a l'air de leviter.
              boxShadow: ombre(18),
              borderRadius: 10,
              overflow: 'hidden',
            }}
          >
            <Img
              src={staticFile(texture)}
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
          </div>
        </div>
      </div>
      {children}
    </AbsoluteFill>
  );
};

/** Convertit une boite de PAGE en boite d'ECRAN pour le cadrage courant : sert a
 *  poser une surbrillance exactement sur un element photographie. */
export const versEcran = (b: Boite, vise: Boite): Boite => {
  const c = carrer(vise);
  const e = COTE / c.width;
  return { x: (b.x - c.x) * e, y: (b.y - c.y) * e, width: b.width * e, height: b.height * e };
};

export const fondu = (frame: number, duree: number, entree = 10, sortie = 8) =>
  interpolate(frame, [0, entree, duree - sortie, duree], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
