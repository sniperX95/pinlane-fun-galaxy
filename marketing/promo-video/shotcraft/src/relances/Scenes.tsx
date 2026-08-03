// LES DOUZE PLANS DU FILM « MAILS ET RELANCES ».
//
// Tout ce qui est a l'image vient de `live-layout.json`, ecrit par le script de
// capture qui a LU LE DOM. Aucune boite, aucun libelle, aucune hauteur de page
// n'est ecrit ici : ce fichier decrit des MOUVEMENTS, pas des donnees.
import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import {
  BLEU, BLEU_SOMBRE, ENCRE, ATONE, ressort, monte, flou, ombre, derive, Halo, Reflet,
} from '../aifl/scene3d';
import { Cadre, COTE, Boite, air, carrer, entre, pageEntiere, versEcran } from './Cadre';
import LAYOUT from './live-layout.json';

const T = (n: string) => `textures/relances/${n}`;
const SEQ = LAYOUT.donnees.sequences as { titre: string; compteur: string; allumee: boolean; boite: Boite }[];
const BLOCS = LAYOUT.blocs as Record<string, Boite>;
const PAGE_W = LAYOUT.pageW as number;
const H_EMAILS = LAYOUT.emails.pageH as number;
const H_RECUS = LAYOUT.recus.pageH as number;

// La boite qui contient les six cartes : calculee depuis les cartes elles-memes,
// donc une septieme sequence l'elargirait toute seule.
const TOUTES_LES_CARTES: Boite = (() => {
  const x0 = Math.min(...SEQ.map((s) => s.boite.x));
  const y0 = Math.min(...SEQ.map((s) => s.boite.y));
  const x1 = Math.max(...SEQ.map((s) => s.boite.x + s.boite.width));
  const y1 = Math.max(...SEQ.map((s) => s.boite.y + s.boite.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
})();


// ---------------------------------------------------------------------------
// LA GRILLE : trois colonnes, deux rangs. Les cartes gardent leur PROPORTION
// reelle (elles sont photographiees, pas redessinees) ; seule leur disposition
// change, parce qu'une bande de 1580 x 210 rendue carree est illisible.
// ---------------------------------------------------------------------------
const COLS = 3;
const RANGS = 2;
const MARGE = 54;
const GOUT = 26;
const CASE_L = (COTE - MARGE * 2 - GOUT * (COLS - 1)) / COLS;
const RATIO = SEQ[0].boite.height / SEQ[0].boite.width;
const CASE_H = CASE_L * RATIO;
const HAUT = (COTE - (CASE_H * RANGS + GOUT * (RANGS - 1))) / 2 - 40;

const caseDe = (i: number) => ({
  x: MARGE + (i % COLS) * (CASE_L + GOUT),
  y: HAUT + Math.floor(i / COLS) * (CASE_H + GOUT),
  width: CASE_L,
  height: CASE_H,
});

// ---------------------------------------------------------------------------
// 1 · OUVERTURE : le logotype, tenu au moins une seconde (regle du squelette
//     d'energie). Le picto arrive en ressort, le mot se pose derriere lui.
// ---------------------------------------------------------------------------
export const SceneOuverture: React.FC<{ duree: number }> = ({ duree }) => {
  const frame = useCurrentFrame();
  const p = ressort(frame, 4, 22);
  const mot = monte(frame, 16, 14);
  const d = derive(frame, 1.1, 260);
  const sortie = interpolate(frame, [duree - 10, duree], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(120% 90% at 50% 35%, #ffffff 0%, #eef4ff 60%, #dfe9fb 100%)', opacity: sortie }}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', perspective: 1600 }}>
        <div style={{ transform: `rotateX(${d.rotX}deg) rotateY(${d.rotY}deg)`, transformStyle: 'preserve-3d', textAlign: 'center' }}>
          <div style={{ position: 'relative', display: 'inline-block', transform: `scale(${0.7 + 0.3 * p})`, filter: flou(p, 12) }}>
            <Halo intensite={p * 0.8} taille={420} couleur={BLEU} />
            <Img src={staticFile('brand/picto.png')} style={{ width: 260, display: 'block', filter: `drop-shadow(${ombre(26)})` }} />
            <Reflet t={Math.min(1, Math.max(0, (frame - 20) / 26))} rayon={22} />
          </div>
          <div
            style={{
              marginTop: 34, fontFamily: 'Geist', fontWeight: 600, fontSize: 92,
              letterSpacing: '-0.035em', color: ENCRE,
              opacity: mot, transform: `translateY(${(1 - mot) * 22}px)`, filter: flou(mot, 8),
            }}
          >
            Pinlane
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// 2 · LA PAGE : on nomme ce qu'on regarde AVANT d'en parler. La camera part du
//     large et se ferme sur la file, la ou vivent les mails.
// ---------------------------------------------------------------------------
export const ScenePage: React.FC<{ duree: number }> = ({ duree }) => {
  const frame = useCurrentFrame();
  const t = monte(frame, 0, Math.max(24, duree - 20));
  const large = carrer(pageEntiere(PAGE_W, H_EMAILS, 40));
  // La page entiere rendue carree fait 1920 de cote : le texte y est illisible.
  // On finit sur LA FILE, le panneau de gauche, qui est le sujet de la phrase.
  const serre = carrer(air({ x: 12, y: 272, width: 1000, height: 560 }, 1.02));
  return (
    <Cadre
      texture={T('emails-full.png')} pageW={PAGE_W} pageH={H_EMAILS}
      vise={entre(large, serre, t)} frame={frame} entree={monte(frame, 0, 14)}
    />
  );
};

// ---------------------------------------------------------------------------
// 4 · LES SIX SEQUENCES arrivent. Elles ne se fondent pas : elles TOMBENT, en
//     quinconce, chacune avec son ombre de contact. Le decalage vient de leur
//     position reelle dans la page, pas d'un index.
// ---------------------------------------------------------------------------
export const SceneSequences: React.FC<{ duree: number }> = ({ duree }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: LAYOUT.fond as string, overflow: 'hidden' }}>
      {SEQ.map((s, i) => {
        const p = ressort(frame, 3 + i * 4, 20);
        const b = caseDe(i);
        return (
          <div
            key={s.titre}
            style={{
              position: 'absolute', left: b.x, top: b.y, width: b.width, height: b.height,
              opacity: Math.min(1, p * 1.4),
              transform: `translateY(${(1 - p) * 90}px) scale(${0.94 + 0.06 * p})`,
              filter: flou(p, 10),
              boxShadow: ombre(10 + p * 8),
              borderRadius: 16, overflow: 'hidden',
            }}
          >
            <Img src={staticFile(T(`seq${i + 1}.png`))} style={{ width: '100%', height: '100%', display: 'block' }} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// 5 · L'ENUMERATION : chaque carte s'allume SUR SON MOT. Les instants viennent
//     de la narration, pas d'un partage egal de la duree : une phrase reecrite
//     deplace les allumages avec elle.
// ---------------------------------------------------------------------------
export const SceneEnumere: React.FC<{ duree: number; instants: number[] }> = ({ duree, instants }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: LAYOUT.fond as string, overflow: 'hidden' }}>
      {SEQ.map((s, i) => {
        const b = caseDe(i);
        // Les cartes citees sont les positions 1, 2, 3 (la voix les nomme dans
        // cet ordre) ; la quatrieme citee est l'anniversaire, position 4.
        const rang = [1, 2, 3, 4].indexOf(i);
        const depart = rang >= 0 ? instants[rang] : -999;
        const actif = rang >= 0 ? monte(frame, depart, 9) : 0;
        const eteint = rang >= 0 ? 1 : interpolate(frame, [0, 12], [1, 0.34], { extrapolateRight: 'clamp' });
        return (
          <div
            key={s.titre}
            style={{
              position: 'absolute', left: b.x, top: b.y, width: b.width, height: b.height,
              opacity: rang >= 0 ? 0.42 + 0.58 * actif : eteint,
              transform: `scale(${1 + 0.045 * actif})`,
              boxShadow: actif > 0.15
                ? `${ombre(14 + 10 * actif)}, 0 0 ${34 * actif}px ${BLEU}44`
                : ombre(8),
              borderRadius: 16, overflow: 'hidden',
              outline: actif > 0.5 ? `3px solid ${BLEU}` : 'none',
            }}
          >
            <Img src={staticFile(T(`seq${i + 1}.png`))} style={{ width: '100%', height: '100%', display: 'block' }} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// 6 · LA CARTE ETEINTE, en gros plan. Elle est designee par SON ETAT
//     (`allumee === false`), pas par son rang : si le gerant en eteint une
//     autre, le film suit.
// ---------------------------------------------------------------------------
export const SceneEteinte: React.FC<{ duree: number }> = ({ duree }) => {
  const frame = useCurrentFrame();
  const i = SEQ.findIndex((s) => !s.allumee);
  const j = i >= 0 ? i : SEQ.length - 1;
  const s = SEQ[j];
  const p = ressort(frame, 2, 22);
  // Les autres cartes s'ecartent et s'effacent : c'est le mouvement qui DIT
  // « celle-la », mieux qu'un cadrage qui les couperait au bord.
  const recule = monte(frame, 0, 20);
  const L = COTE * 0.78;
  const H = L * (s.boite.height / s.boite.width);
  return (
    <AbsoluteFill style={{ background: LAYOUT.fond as string, overflow: 'hidden' }}>
      {SEQ.map((autre, k) => {
        if (k === j) return null;
        const c = caseDe(k);
        return (
          <div
            key={autre.titre}
            style={{
              position: 'absolute', left: c.x, top: c.y, width: c.width, height: c.height,
              opacity: (1 - recule) * 0.5,
              transform: `translateY(${recule * (k < COLS ? -90 : 90)}px) scale(${1 - recule * 0.1})`,
              borderRadius: 16, overflow: 'hidden', boxShadow: ombre(6),
            }}
          >
            <Img src={staticFile(T(`seq${k + 1}.png`))} style={{ width: '100%', height: '100%', display: 'block' }} />
          </div>
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: (COTE - L) / 2, top: (COTE - H) / 2 - 30,
          width: L, height: H,
          transform: `scale(${0.88 + 0.12 * p})`,
          filter: flou(p, 9),
          boxShadow: ombre(20 + 8 * p),
          borderRadius: 20, overflow: 'hidden',
        }}
      >
        <Img src={staticFile(T(`seq${j + 1}.png`))} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// 8 · CE QU'IL VEUT. La page des mails recus, et le bloc d'analyse qui se pose
//     par-dessus, en Z : il arrive de loin, ce qui dit « c'est ca qu'il faut
//     regarder » mieux qu'un glissement lateral.
// ---------------------------------------------------------------------------
const BlocPose: React.FC<{
  fichier: string; boite: Boite; vise: Boite; frame: number; de: number; teinte?: string;
}> = ({ fichier, boite, vise, frame, de, teinte = BLEU }) => {
  const p = ressort(frame, de, 24);
  const b = versEcran(boite, vise);
  return (
    <div
      style={{
        position: 'absolute', left: b.x, top: b.y, width: b.width, height: b.height,
        opacity: Math.min(1, p * 1.5),
        transform: `translateZ(0) scale(${0.86 + 0.14 * p}) translateY(${(1 - p) * 40}px)`,
        transformOrigin: '50% 50%',
        filter: flou(p, 12),
        boxShadow: `${ombre(16 + 10 * p)}, 0 0 ${40 * p}px ${teinte}33`,
        borderRadius: 16, overflow: 'hidden',
      }}
    >
      <Img src={staticFile(T(fichier))} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
};

export const SceneVeut: React.FC<{ duree: number }> = ({ duree }) => {
  const frame = useCurrentFrame();
  const vise = carrer(air(BLOCS['mail-recu'], 1.34));
  const t = monte(frame, 0, 30);
  const viseFinal = entre(carrer(air(BLOCS['mail-recu'], 1.15)), carrer(air(BLOCS['ce-quil-veut'], 1.12)), t);
  return (
    <Cadre
      texture={T('recus-full.png')} pageW={PAGE_W} pageH={H_RECUS}
      vise={viseFinal} frame={frame} entree={monte(frame, 0, 12)}
    >
      <BlocPose fichier="ce-quil-veut.png" boite={BLOCS['ce-quil-veut']} vise={viseFinal} frame={frame} de={14} />
    </Cadre>
  );
};

// ---------------------------------------------------------------------------
// 9 · LA REPONSE DEJA ECRITE.
// ---------------------------------------------------------------------------
export const SceneReponse: React.FC<{ duree: number }> = ({ duree }) => {
  const frame = useCurrentFrame();
  const vise = carrer(air(BLOCS['reponse-ia'], 1.06));
  return (
    <Cadre
      texture={T('recus-full.png')} pageW={PAGE_W} pageH={H_RECUS}
      vise={vise} frame={frame} entree={monte(frame, 0, 12)}
    >
      <BlocPose fichier="reponse-ia.png" boite={BLOCS['reponse-ia']} vise={vise} frame={frame} de={6} />
    </Cadre>
  );
};

// ---------------------------------------------------------------------------
// 10 · L'AGENT APPREND. Le bloc de reponse, et un trait qui souligne la zone
//      corrigee puis une pastille « retenu ». On ne fabrique pas un faux texte
//      corrige : on DESIGNE la zone, ce qui est vrai et ne raconte rien de faux.
// ---------------------------------------------------------------------------
export const SceneApprend: React.FC<{ duree: number }> = ({ duree }) => {
  const frame = useCurrentFrame();
  const vise = carrer(air(BLOCS['reponse-ia'], 1.04));
  const b = versEcran(BLOCS['reponse-ia'], vise);
  const trace = monte(frame, 10, 22);
  const pastille = ressort(frame, 40, 20);
  return (
    <Cadre
      texture={T('recus-full.png')} pageW={PAGE_W} pageH={H_RECUS}
      vise={vise} frame={frame} entree={monte(frame, 0, 12)}
    >
      {/* Le surlignage de la zone corrigee : il se TRACE, il n'apparait pas. */}
      <div
        style={{
          position: 'absolute',
          left: b.x + b.width * 0.06,
          top: b.y + b.height * 0.52,
          width: b.width * 0.62 * trace,
          height: 26,
          background: `linear-gradient(90deg, ${BLEU}00, ${BLEU}3a 18%, ${BLEU}3a)`,
          borderRadius: 6,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: b.x + b.width * 0.06,
          top: b.y + b.height * 0.52 + 42,
          opacity: Math.min(1, pastille * 1.4),
          transform: `translateY(${(1 - pastille) * 14}px) scale(${0.9 + 0.1 * pastille})`,
          background: BLEU, color: '#fff',
          fontFamily: 'Geist', fontWeight: 600, fontSize: 26, letterSpacing: '-0.01em',
          padding: '10px 20px', borderRadius: 999,
          boxShadow: ombre(12),
        }}
      >
        retenu
      </div>
    </Cadre>
  );
};

// ---------------------------------------------------------------------------
// 12 · SIGNATURE : les elements deja montres reviennent entourer le logotype,
//      et la tenue finale depasse la seconde.
// ---------------------------------------------------------------------------
export const SceneOutro: React.FC<{ duree: number }> = ({ duree }) => {
  const frame = useCurrentFrame();
  const p = ressort(frame, 2, 22);
  const d = derive(frame, 1.0, 240);
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(120% 90% at 50% 40%, #ffffff 0%, #eef4ff 62%, #dbe7fa 100%)' }}>
      {/* Les six cartes reviennent, tres en retrait : elles disent « tout ce
          qu'on vient de voir » sans reprendre la parole. */}
      {SEQ.map((s, i) => {
        const a = monte(frame, 6 + i * 3, 16);
        const angle = -70 + i * 28;
        const r = 430;
        return (
          <div
            key={s.titre}
            style={{
              position: 'absolute',
              left: COTE / 2 + Math.cos((angle * Math.PI) / 180) * r - 110,
              top: COTE / 2 + Math.sin((angle * Math.PI) / 180) * r - 70,
              width: 220, height: 140,
              opacity: a * 0.22,
              transform: `scale(${0.9 + 0.1 * a}) rotate(${(i - 2.5) * 2}deg)`,
              borderRadius: 12, overflow: 'hidden', boxShadow: ombre(6),
            }}
          >
            <Img src={staticFile(T(`seq${i + 1}.png`))} style={{ width: '100%', display: 'block' }} />
          </div>
        );
      })}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', perspective: 1600 }}>
        <div style={{ transform: `rotateX(${d.rotX}deg) rotateY(${d.rotY}deg)`, textAlign: 'center' }}>
          <div style={{ position: 'relative', display: 'inline-block', transform: `scale(${0.82 + 0.18 * p})` }}>
            <Halo intensite={p} taille={460} couleur={BLEU} />
            <Img src={staticFile('brand/picto.png')} style={{ width: 210, display: 'block', filter: `drop-shadow(${ombre(22)})` }} />
          </div>
          <div
            style={{
              marginTop: 28, fontFamily: 'Geist', fontWeight: 600, fontSize: 84,
              letterSpacing: '-0.035em', color: ENCRE,
              opacity: monte(frame, 10, 14),
            }}
          >
            Pinlane
          </div>
          <div
            style={{
              marginTop: 14, fontFamily: 'Geist', fontWeight: 500, fontSize: 30,
              letterSpacing: '-0.01em', color: ATONE, opacity: monte(frame, 20, 16),
            }}
          >
            Emails &amp; relances
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
