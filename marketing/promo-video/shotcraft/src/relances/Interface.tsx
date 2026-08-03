// L'INTERFACE, REDESSINEE. Pas photographiee.
//
// Movsar, sur la premiere version : « tu reprends toujours comme c'est tel quel
// sur l'image, donc notre site, mais du coup ca fait pas clean parce que c'est
// genre comme des decoupes, alors que du motion design c'est beaucoup plus
// qualitatif que ca ».
//
// Il a raison, et l'erreur etait dans ma lecture de mon propre invariant. §I.2
// dit que **les DONNEES** viennent du DOM. Il n'a jamais dit que **l'IMAGE**
// devait etre une photo du DOM. J'ai confondu les deux, et le resultat est un
// diaporama de captures qu'on deplace.
//
// Ici : les donnees restent lues sur le produit (`live-layout.json`), et chaque
// element est REDESSINE. Consequence directe, un interrupteur peut basculer, un
// compteur peut rouler, un texte peut s'ecrire, un surlignage peut viser un mot
// reel. Aucune de ces trois choses n'est possible sur un bitmap.
//
// La grammaire de profondeur suit la regle du vault d'Arlan : un objet cher est
// un EMPILEMENT DE COUCHES FAIBLES (corps en degrade, biseau clair en haut,
// poids sombre en bas, liseré, ombre de contact), jamais un effet fort. Et une
// seule direction de lumiere, tenue partout : des que deux controles ne sont pas
// d'accord sur d'ou vient la lumiere, l'illusion casse.
import React from 'react';
import { interpolate, Easing } from 'remotion';
import { BLEU, ENCRE, ATONE } from '../aifl/scene3d';

export const BLANC = '#ffffff';
export const TRAIT = '#e6e9ef';
export const FOND = '#f7f8fa';
export const VERT = '#16a34a';
export const ORANGE = '#d97706';

const lisse = (t: number) => interpolate(t, [0, 1], [0, 1], {
  easing: Easing.bezier(0.22, 0.9, 0.24, 1), extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
});

/** L'empilement qui fait qu'une surface a un corps. Cinq couches faibles. */
export const surface = (releve = 1): React.CSSProperties => ({
  background: 'linear-gradient(180deg, #ffffff 0%, #fcfcfd 100%)',
  border: `1px solid ${TRAIT}`,
  borderRadius: 18,
  boxShadow: [
    'inset 0 1px 0 rgba(255,255,255,0.9)',            // le biseau eclaire, en haut
    'inset 0 -1px 0 rgba(9,17,31,0.045)',             // le poids, en bas
    `0 ${2 * releve}px ${5 * releve}px rgba(9,17,31,${0.05 * releve})`,   // contact serre
    `0 ${10 * releve}px ${28 * releve}px rgba(9,17,31,${0.06 * releve})`, // hauteur
  ].join(', '),
});

// ---------------------------------------------------------------------------
// L'INTERRUPTEUR. Sur une capture il est fige ; ici il bascule, et c'est
// exactement ce que la phrase « chacune s'allume ou se coupe » demande de voir.
// ---------------------------------------------------------------------------
export const Interrupteur: React.FC<{ actif: number; taille?: number }> = ({ actif, taille = 1 }) => {
  const L = 62 * taille;
  const H = 34 * taille;
  const R = H - 8 * taille;
  const t = lisse(actif);
  return (
    <div
      style={{
        width: L, height: H, borderRadius: 999, position: 'relative', flex: 'none',
        background: t > 0.5
          ? `linear-gradient(180deg, ${ENCRE} 0%, #0b1626 100%)`
          : 'linear-gradient(180deg, #dfe3ea 0%, #d3d8e1 100%)',
        boxShadow: 'inset 0 1px 2px rgba(9,17,31,0.18), inset 0 -1px 0 rgba(255,255,255,0.35)',
        transition: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute', top: 4 * taille, left: 4 * taille + t * (L - R - 8 * taille),
          width: R, height: R, borderRadius: 999,
          background: 'linear-gradient(180deg, #ffffff 0%, #f2f4f7 100%)',
          boxShadow: '0 1px 2px rgba(9,17,31,0.28), 0 3px 8px rgba(9,17,31,0.16)',
        }}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// LE COMPTEUR QUI ROULE. Une colonne de chiffres deplacee, jamais du texte
// remplace : c'est ce qui distingue un nombre qui compte d'un nombre qui
// clignote.
// ---------------------------------------------------------------------------
export const Compteur: React.FC<{ valeur: number; t: number; taille?: number; couleur?: string }> = ({
  valeur, t, taille = 26, couleur = ENCRE,
}) => {
  const affiche = Math.round(valeur * lisse(t));
  const chiffres = String(affiche).padStart(String(valeur).length, ' ').split('');
  return (
    <span style={{ display: 'inline-flex', fontVariantNumeric: 'tabular-nums', fontSize: taille, color: couleur, fontWeight: 600 }}>
      {chiffres.map((c, i) => (
        <span key={i} style={{ display: 'inline-block', height: taille * 1.2, overflow: 'hidden', width: c === ' ' ? 0 : taille * 0.58 }}>
          <span
            style={{
              display: 'block',
              transform: `translateY(${-Number(c || 0) * taille * 1.2}px)`,
            }}
          >
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
              <span key={d} style={{ display: 'block', height: taille * 1.2, lineHeight: `${taille * 1.2}px` }}>{d}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
};

// ---------------------------------------------------------------------------
// LA PUCE. Un libelle, un ton. Le meme composant sert aux intentions de l'agent
// et aux etats : un procede attache a un TYPE d'element se tient partout.
// ---------------------------------------------------------------------------
export const Puce: React.FC<{ texte: string; ton?: 'bleu' | 'orange' | 'vert' | 'gris'; taille?: number }> = ({
  texte, ton = 'bleu', taille = 22,
}) => {
  const tons = {
    bleu: { fond: '#eaf1ff', encre: BLEU, bord: '#d3e2ff' },
    orange: { fond: '#fff4e6', encre: ORANGE, bord: '#fde3c0' },
    vert: { fond: '#e9f8ee', encre: VERT, bord: '#c9edd6' },
    gris: { fond: '#f1f3f7', encre: ATONE, bord: TRAIT },
  }[ton];
  return (
    <span
      style={{
        display: 'inline-block', padding: `${taille * 0.22}px ${taille * 0.6}px`,
        borderRadius: 999, background: tons.fond, color: tons.encre,
        border: `1px solid ${tons.bord}`,
        fontSize: taille, fontWeight: 600, letterSpacing: '-0.006em', whiteSpace: 'nowrap',
      }}
    >
      {texte}
    </span>
  );
};

// ---------------------------------------------------------------------------
// LA CARTE DE SEQUENCE, redessinee. Son titre, sa description et son compteur
// viennent du DOM ; son interrupteur bascule et son compteur roule.
// ---------------------------------------------------------------------------
export type Seq = { titre: string; description: string; compteur: string; allumee: boolean };

export const CarteSequence: React.FC<{
  seq: Seq; actif: number; surbrillance?: number; largeur: number;
  /** Avancement du compteur, INDEPENDANT de l etat de la sequence : branche sur
   *  `actif`, il redescendait quand l interrupteur basculait et affichait un
   *  nombre que le produit ne dit nulle part. */
  compteur?: number;
}> = ({ seq, actif, surbrillance = 0, largeur, compteur = 1 }) => {
  const e = largeur / 395;               // echelle par rapport a la carte de reference
  const nombre = Number((seq.compteur.match(/^\d+/) || ['0'])[0]);
  const sb = lisse(surbrillance);
  return (
    <div
      style={{
        ...surface(1 + sb * 1.6),
        width: largeur, padding: 22 * e, boxSizing: 'border-box',
        borderColor: sb > 0.4 ? BLEU : TRAIT,
        outline: sb > 0.4 ? `${2 * e}px solid ${BLEU}22` : 'none',
        fontFamily: 'Geist', color: ENCRE, display: 'flex', flexDirection: 'column', gap: 12 * e,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 * e }}>
        <div style={{ fontSize: 25 * e, fontWeight: 600, letterSpacing: '-0.018em', lineHeight: 1.18 }}>
          {seq.titre}
        </div>
        <Interrupteur actif={actif} taille={e * 0.92} />
      </div>
      <div style={{ fontSize: 19 * e, lineHeight: 1.42, color: ATONE, letterSpacing: '-0.004em' }}>
        {seq.description}
      </div>
      <div style={{ marginTop: 'auto', paddingTop: 10 * e, display: 'flex', alignItems: 'center', gap: 8 * e }}>
        <Compteur valeur={nombre} t={compteur} taille={21 * e} couleur={ATONE} />
        <span style={{ fontSize: 18 * e, color: ATONE }}>envoyés sur 30 jours</span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// UN MAIL RECU. Ce que l'expediteur ecrit, et ce que l'agent en comprend.
// ---------------------------------------------------------------------------
export const LigneRecue: React.FC<{
  de: string; sujet: string; intent: string; urgent?: boolean; resume: string;
  entree: number; largeur: number;
}> = ({ de, sujet, intent, urgent, resume, entree, largeur }) => {
  const t = lisse(entree);
  const e = largeur / 900;
  return (
    <div
      style={{
        ...surface(1),
        width: largeur, padding: 24 * e, boxSizing: 'border-box',
        fontFamily: 'Geist', color: ENCRE,
        opacity: Math.min(1, t * 1.5),
        transform: `translateX(${(1 - t) * 40}px)`,
        display: 'flex', flexDirection: 'column', gap: 12 * e,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 * e }}>
        <div style={{ fontSize: 26 * e, fontWeight: 600, letterSpacing: '-0.018em' }}>{de}</div>
        <Puce texte={intent} taille={19 * e} />
        {urgent ? <Puce texte="Urgent" ton="orange" taille={19 * e} /> : null}
      </div>
      <div style={{ fontSize: 22 * e, color: ATONE }}>{sujet}</div>
      <div style={{ fontSize: 22 * e, lineHeight: 1.4 }}>{resume}</div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// LE TEXTE QUI S'ECRIT. Pas un fondu : une reponse qui apparait d'un coup ne se
// lit pas comme « elle est deja ecrite », elle se lit comme un ecran de plus.
// Le curseur clignote sur une periode fixe, donc le rendu reste une fonction
// pure de l'image.
// ---------------------------------------------------------------------------
export const TexteQuiSEcrit: React.FC<{
  texte: string; avancement: number; taille: number; couleur?: string; curseur?: boolean;
}> = ({ texte, avancement, taille, couleur = ENCRE, curseur = true }) => {
  const n = Math.floor(interpolate(avancement, [0, 1], [0, texte.length], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  }));
  const fini = n >= texte.length;
  return (
    <span style={{ fontSize: taille, color: couleur, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
      {texte.slice(0, n)}
      {curseur && !fini ? (
        <span style={{ display: 'inline-block', width: taille * 0.06, height: taille * 0.98, background: BLEU, marginLeft: 2, verticalAlign: 'text-bottom' }} />
      ) : null}
    </span>
  );
};

// ---------------------------------------------------------------------------
// UN CHAMP, tel que le produit les dessine : creux, et non en relief. Presser
// c'est inverser : sombre en haut, clair en bas, aucune ombre exterieure.
// ---------------------------------------------------------------------------
export const Champ: React.FC<{ children: React.ReactNode; largeur: number; hauteur?: number; padding?: number }> = ({
  children, largeur, hauteur, padding = 20,
}) => (
  <div
    style={{
      width: largeur, minHeight: hauteur, padding, boxSizing: 'border-box',
      background: '#fbfcfd', border: `1px solid ${TRAIT}`, borderRadius: 12,
      boxShadow: 'inset 0 1px 2px rgba(9,17,31,0.06), inset 0 -1px 0 rgba(255,255,255,0.8)',
      fontFamily: 'Geist', color: ENCRE,
    }}
  >
    {children}
  </div>
);

/** L'etiquette au-dessus d'un champ, dans le vocabulaire du produit. */
export const Etiquette: React.FC<{ texte: string; taille?: number }> = ({ texte, taille = 20 }) => (
  <div style={{ fontFamily: 'Geist', fontSize: taille, color: ATONE, marginBottom: 10, letterSpacing: '-0.004em' }}>
    {texte}
  </div>
);
