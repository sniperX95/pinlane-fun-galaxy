import React from 'react';
import { Img, interpolate, staticFile, useCurrentFrame, useVideoConfig, Easing } from 'remotion';

// LES INCRUSTATIONS DES CARTONS D'EXPLICATION.
//
// Le reproche : « quand il parle beaucoup, ça montre que du texte ». C'etait
// exact — les six cartons qui portent l'explication etaient de la typographie sur
// blanc. Sur un film de trafic froid, ce sont justement les moments ou il faut
// MONTRER, parce que c'est la qu'on explique.
//
// Chaque carton recoit donc une illustration animee qui joue ce que la phrase
// dit. Deux regles :
//
//   1. LES TEMPS SONT CALES SUR LES MOTS. Le telephone se met a sonner quand la
//      voix dit « telephone », le stylo ecrit quand elle dit « cahier », la
//      collision se produit quand elle dit « piste ». Meme doctrine que les
//      sous-titres : la date vient de l'alignement de la synthese, pas d'un
//      reglage. `quand(mots, 'piste')` rend l'instant du mot.
//
//   2. TOUT EST DETERMINISTE. Aucune date, aucun tirage aleatoire : chaque
//      valeur derive de `frame` et d'un index. Le rendu d'une image donnee est
//      toujours le meme, ce qui est la condition pour que Remotion puisse la
//      recalculer et pour qu'une garde soit reproductible.

const SANS = "'Geist', 'Geist Fallback', ui-sans-serif, system-ui, sans-serif";
const MONO = "'Geist Mono', 'Geist Mono Fallback', ui-monospace, SFMono-Regular, monospace";
const BLEU = '#0664fe';
const BLEU_CLAIR = '#1e74fe';
const PALE = '#eef4ff';
const NAVY = '#051e48';
const ENCRE = '#08111f';
const ATONE = '#55617a';
const TRAIT = 'rgba(5, 30, 72, 0.14)';

export type Mot = { m: string; t0: number; t1: number };

const nu = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Instant (en secondes, depuis le debut de la ligne) ou commence le premier mot
 *  qui contient `cle`. Rend `repli` si le mot n'est pas trouve — ce qui arrive si
 *  le texte est reecrit sans toucher a l'illustration, et vaut mieux qu'un plan
 *  qui ne joue plus rien. */
const quand = (mots: Mot[], cle: string, repli: number) => {
  const m = mots.find((x) => nu(x.m).includes(nu(cle)));
  return m ? m.t0 : repli;
};

// LE CARTON S'OUVRE AVANT QUE LA VOIX N'ATTAQUE.
//
// `useCurrentFrame()` compte depuis le debut du CARTON ; les dates des mots
// comptent depuis le debut de la LIGNE PARLEE. Sans ce decalage, le telephone
// sonnerait quelques images avant que la voix ne dise « telephone » — exactement
// le defaut de synchronisation qu'on vient de corriger sur les sous-titres. Les
// composants ci-dessous prennent donc `decalage` et l'ajoutent a chaque temps.
type Contexte = { mots: Mot[]; decalage: number };
const temps = (c: Contexte, cle: string, repli: number, fps: number) =>
  c.decalage + quand(c.mots, cle, repli) * fps;

const ease = Easing.bezier(0.22, 0.9, 0.24, 1);
const ressort = Easing.bezier(0.2, 1.25, 0.3, 1);

/** Apparition/disparition d'un sous-temps : monte en 8 images, tient, redescend. */
const fenetre = (frame: number, de: number, a: number) => interpolate(
  frame, [de, de + 8, a - 7, a], [0, 1, 1, 0],
  { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.linear },
);


// L'ILLUSTRATION S'ETABLIT DES L'OUVERTURE DU CARTON.
//
// Defaut mesure par la garde d'images plates : jusqu'a 0,57 s de blanc entre deux
// cartons. Cause : le carton s'ouvre quelques images avant que la voix n'attaque,
// les mots n'apparaissent qu'a leur date, et l'illustration attendait SON premier
// mot — donc l'ecran restait vide le temps de la jointure. Le decor (le combine,
// le pictogramme, les cadres des compteurs) apparait maintenant des l'image 2 ;
// seuls les EVENEMENTS restent cales sur les mots.
const etabli = (frame: number) => interpolate(frame, [2, 12], [0, 1], {
  extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
});

// ---------------------------------------------------------------------------
// Briques reutilisables
// ---------------------------------------------------------------------------

/** Une pastille de reservation, comme dans le planning du produit. */
const Chip: React.FC<{ w?: number; h?: number; titre: string; sous?: string; ton?: 'bleu' | 'sable' | 'gris' }> = ({
  w = 350, h = 104, titre, sous, ton = 'bleu',
}) => {
  const fond = ton === 'bleu' ? PALE : ton === 'sable' ? '#fdf3e3' : '#f1f3f7';
  const barre = ton === 'bleu' ? BLEU : ton === 'sable' ? '#c98a2b' : ATONE;
  return (
    <div style={{
      width: w, height: h, background: fond, borderRadius: 10,
      borderLeft: `4px solid ${barre}`, padding: '10px 14px', boxSizing: 'border-box',
      fontFamily: SANS, display: 'flex', flexDirection: 'column', justifyContent: 'center',
      boxShadow: '0 2px 6px rgba(5, 30, 72, 0.08)',
    }}>
      <div style={{ fontSize: 27, fontWeight: 620, color: ENCRE, whiteSpace: 'nowrap' }}>{titre}</div>
      {sous ? <div style={{ fontSize: 20, color: ATONE, marginTop: 4 }}>{sous}</div> : null}
    </div>
  );
};

/** Un fragment de planning : une piste, ses graduations. */
const Piste: React.FC<{ w: number; libelle: string }> = ({ w, libelle }) => (
  <div style={{ width: w, fontFamily: SANS }}>
    <div style={{ fontSize: 15, color: ATONE, letterSpacing: '0.06em', marginBottom: 8 }}>{libelle}</div>
    <div style={{ height: 128, border: `1px solid ${TRAIT}`, borderRadius: 10, background: '#fff', position: 'relative' }}>
      {[0.25, 0.5, 0.75].map((p) => (
        <div key={p} style={{ position: 'absolute', left: `${p * 100}%`, top: 8, bottom: 8, width: 1, background: TRAIT }} />
      ))}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// A · « ça se passe au téléphone · tu notes sur un cahier · la même piste »
// ---------------------------------------------------------------------------

const IncrustProbleme: React.FC<Contexte> = (ctx) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Trois temps, chacun declenche par SON mot.
  const tTel = temps(ctx, 'telephone', 1.4, fps);
  const tCahier = temps(ctx, 'cahier', 3.2, fps);
  const tPiste = temps(ctx, 'piste', 5.2, fps);

  const vTel = Math.min(etabli(frame), fenetre(frame, 2, tCahier - 4));
  const vCahier = fenetre(frame, tCahier - 14, tPiste - 6);
  const vPiste = interpolate(frame, [tPiste - 16, tPiste - 8], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // --- 1. le telephone qui sonne : trois ondes qui partent en boucle
  const ondes = [0, 1, 2].map((k) => {
    const cycle = 22;
    const p = ((frame - tTel + 16 + k * 7) % cycle) / cycle;
    return { p, o: (1 - p) * 0.7 };
  });
  // il tremble legerement, comme un combine qui vibre
  const vib = Math.sin((frame - tTel) * 1.1) * 2.5 * vTel;

  // --- 2. le cahier : deux lignes tracees, puis une rayee
  const trace = (de: number, duree: number) => interpolate(frame, [tCahier + de, tCahier + de + duree], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
  });
  const l1 = trace(2, 12);
  const l2 = trace(14, 12);
  const rature = trace(26, 10);

  // --- 3. deux pastilles glissent sur LA MEME piste et se percutent
  const arrive = interpolate(frame, [tPiste - 10, tPiste + 6], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
  });
  const choc = interpolate(frame, [tPiste + 6, tPiste + 10, tPiste + 22], [0, 1, 0.55], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const secousse = Math.sin((frame - tPiste - 6) * 2.2) * 5 * Math.max(0, choc - 0.4);

  return (
    <div style={{ position: 'relative', width: 1500, height: 400, margin: '0 auto' }}>
      {/* 1 · téléphone */}
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: vTel,
      }}>
        <div style={{ position: 'relative', width: 340, height: 340 }}>
          {ondes.map((o, k) => (
            <div key={k} style={{
              position: 'absolute', left: '50%', top: '50%',
              width: 140 + o.p * 260, height: 140 + o.p * 260,
              transform: 'translate(-50%, -50%)',
              border: `3px solid ${BLEU}`, borderRadius: '50%',
              // Les ondes, elles, ne partent que sur le mot « telephone ».
              opacity: o.o * vTel * interpolate(frame, [tTel - 4, tTel + 4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            }} />
          ))}
          <div style={{
            position: 'absolute', left: '50%', top: '50%', width: 140, height: 140,
            transform: `translate(-50%, -50%) rotate(${vib}deg)`,
            background: BLEU, borderRadius: 34,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 18px 44px rgba(6, 100, 254, 0.30)`,
          }}>
            {/* combiné */}
            <svg width={74} height={74} viewBox="0 0 24 24" fill="none">
              <path
                d="M6.6 10.8c1.2 2.4 3.2 4.4 5.6 5.6l2.1-2.1c.3-.3.7-.4 1.1-.2 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V19c0 .6-.4 1-1 1C10.5 20 4 13.5 4 5.4c0-.6.4-1 1-1h3.3c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.2 1.1l-2.1 2.1z"
                fill="#fff"
              />
            </svg>
          </div>
          {/* petite pastille de compteur d'appels manqués */}
          <div style={{
            position: 'absolute', left: 'calc(50% + 48px)', top: 'calc(50% - 82px)',
            minWidth: 44, height: 44, padding: '0 10px', borderRadius: 22,
            background: NAVY, color: '#fff', fontFamily: MONO, fontSize: 20, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transform: `scale(${interpolate(frame, [tTel + 6, tTel + 14], [0, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ressort,
            })})`,
          }}>
            {Math.min(6, Math.max(1, Math.floor((frame - tTel) / 14) + 1))}
          </div>
        </div>
      </div>

      {/* 2 · le cahier */}
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: vCahier,
      }}>
        <div style={{
          width: 620, height: 330, background: '#fff', borderRadius: 12,
          border: `1px solid ${TRAIT}`, boxShadow: '0 20px 50px rgba(5, 30, 72, 0.12)',
          padding: '30px 40px', boxSizing: 'border-box', position: 'relative', overflow: 'hidden',
        }}>
          {/* marge du cahier */}
          <div style={{ position: 'absolute', left: 74, top: 0, bottom: 0, width: 2, background: 'rgba(6,100,254,0.18)' }} />
          {[0, 1, 2, 3, 4].map((k) => (
            <div key={k} style={{ position: 'absolute', left: 30, right: 30, top: 66 + k * 52, height: 1, background: TRAIT }} />
          ))}
          <svg width={540} height={270} viewBox="0 0 540 270" style={{ position: 'absolute', left: 40, top: 24 }}>
            {/* deux notes griffonnées */}
            <path d="M60 52 C120 46, 180 58, 250 50 S330 44, 400 52" stroke={ENCRE} strokeWidth={4}
              fill="none" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - l1} />
            <path d="M60 104 C130 98, 200 110, 270 102 S350 96, 430 104" stroke={ENCRE} strokeWidth={4}
              fill="none" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - l2} />
            {/* la rature : ce qu'on avait note et qui ne tient plus */}
            <path d="M52 100 L440 110" stroke={BLEU} strokeWidth={5}
              fill="none" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - rature} />
          </svg>
          {/* le stylo suit la ligne en cours d'écriture */}
          {(l1 > 0 && l1 < 1) || (l2 > 0 && l2 < 1) ? (
            <div style={{
              position: 'absolute',
              left: 100 + (l1 < 1 ? l1 * 340 : l2 * 370),
              top: l1 < 1 ? 62 : 114,
              width: 8, height: 34, background: NAVY, borderRadius: 3,
              transform: 'rotate(20deg)',
            }} />
          ) : null}
        </div>
      </div>

      {/* 3 · deux réservations sur la même piste */}
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: vPiste,
      }}>
        <div style={{ position: 'relative', width: 1230 }}>
          <Piste w={1230} libelle="PISTE 4 · 18:00" />
          <div style={{
            position: 'absolute', left: 66, top: 46,
            transform: `translateX(${(1 - arrive) * -420}px) translateY(${secousse}px)`,
          }}>
            <Chip titre="Famille Dubois" sous="8 joueurs · 1 h" ton="sable" />
          </div>
          <div style={{
            position: 'absolute', right: 66, top: 46,
            transform: `translateX(${(1 - arrive) * 420}px) translateY(${-secousse}px)`,
          }}>
            <Chip titre="Anniversaire Lucas" sous="6 joueurs · 1 h" />
          </div>
          {/* le heurt : un liseré qui pulse entre les deux */}
          {choc > 0.02 ? (
            <div style={{
              position: 'absolute', left: '50%', top: 40, width: 7, height: 142,
              transform: 'translateX(-50%)', background: NAVY, borderRadius: 3,
              opacity: choc, boxShadow: `0 0 ${18 * choc}px rgba(5, 30, 72, 0.5)`,
            }} />
          ) : null}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// B · « un créneau oublié, c'est un groupe qui part ailleurs »
// ---------------------------------------------------------------------------

const IncrustCreneau: React.FC<Contexte> = (ctx) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tVide = temps(ctx, 'oublie', 0.5, fps);
  const tPart = temps(ctx, 'part', 1.7, fps);

  const grille = Array.from({ length: 12 }, (_, i) => i);
  const VIDE = 6;
  const pulse = 0.5 + 0.5 * Math.sin((frame - tVide) * 0.22);

  return (
    <div style={{ position: 'relative', width: 1300, height: 400, margin: '0 auto' }}>
      <div style={{
        position: 'absolute', left: 0, top: 30,
        display: 'grid', gridTemplateColumns: 'repeat(4, 200px)', gap: 16,
      }}>
        {grille.map((i) => {
          const vide = i === VIDE;
          const entree = interpolate(frame, [i * 1.6, i * 1.6 + 10], [0, 1], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
          });
          return (
            <div key={i} style={{
              height: 92, borderRadius: 10,
              background: vide ? 'transparent' : PALE,
              border: vide ? `2.5px dashed ${BLEU}` : `1px solid ${TRAIT}`,
              borderLeft: vide ? `2.5px dashed ${BLEU}` : `4px solid ${BLEU_CLAIR}`,
              opacity: entree * (vide ? 0.35 + 0.65 * pulse : 1),
              transform: `translateY(${(1 - entree) * 16}px)`,
            }} />
          );
        })}
      </div>
      {/* le groupe s'en va vers la droite */}
      {[0, 1, 2].map((k) => {
        const depart = tPart + k * 5;
        const p = interpolate(frame, [depart, depart + 34], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.4, 0, 0.6, 1),
        });
        return (
          <div key={k} style={{
            position: 'absolute', left: 250 + k * 62 + p * 760, top: 250 - k * 8,
            opacity: (1 - p) * interpolate(frame, [depart, depart + 6], [0, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            }),
            transform: `translateY(${Math.sin(p * Math.PI * 4 + k) * 5}px)`,
          }}>
            <svg width={54} height={72} viewBox="0 0 54 72">
              <circle cx={27} cy={17} r={14} fill={ATONE} />
              <path d="M6 70 C6 48, 16 38, 27 38 C38 38, 48 48, 48 70 Z" fill={ATONE} />
            </svg>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// C · « Pinlane, c'est le logiciel qui gère tout ça à ta place »
// ---------------------------------------------------------------------------

const IncrustReprise: React.FC<Contexte> = (ctx) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t0 = temps(ctx, 'pinlane', 0.1, fps);
  const tGere = temps(ctx, 'gere', 1.2, fps);

  // Les trois embetements du plan precedent viennent se faire absorber.
  const pieces = [
    { x: -520, y: -140, label: 'Appels' },
    { x: 540, y: -90, label: 'Cahier' },
    { x: -430, y: 170, label: 'Doublons' },
  ];

  const halo = pieces.reduce((acc, _, k) => {
    const arrivee = tGere + 6 + k * 9;
    return acc + interpolate(frame, [arrivee - 3, arrivee, arrivee + 10], [0, 1, 0], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
  }, 0);

  const pictoIn = interpolate(frame, [2, 14], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ressort,
  });
  void t0;

  return (
    <div style={{ position: 'relative', width: 1300, height: 380, margin: '0 auto' }}>
      <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
        <div style={{
          position: 'absolute', left: '50%', top: '50%', width: 460, height: 460,
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle, rgba(6,100,254,${0.10 + 0.18 * Math.min(1, halo)}), transparent 68%)`,
        }} />
        <Img
          src={staticFile('brand/picto.webp')}
          style={{
            width: 184, height: 169, objectFit: 'contain', display: 'block',
            opacity: pictoIn,
            transform: `scale(${0.7 + 0.3 * pictoIn + 0.04 * Math.min(1, halo)})`,
          }}
        />
      </div>
      {pieces.map((p, k) => {
        const arrivee = tGere + 6 + k * 9;
        const t = interpolate(frame, [tGere - 10 + k * 4, arrivee], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.4, 0, 0.3, 1),
        });
        if (t >= 1) return null;
        return (
          <div key={p.label} style={{
            position: 'absolute', left: '50%', top: '50%',
            transform: `translate(-50%, -50%) translate(${p.x * (1 - t)}px, ${p.y * (1 - t)}px) scale(${1 - 0.55 * t})`,
            // Elles s'effacent AVANT d'arriver au centre : a 0,82 elles passaient
            // encore DEVANT le pictogramme et le masquaient au lieu de le nourrir.
            opacity: interpolate(t, [0, 0.12, 0.55, 0.78], [0, 1, 1, 0]),
            fontFamily: MONO, fontSize: 22, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: ATONE, background: '#fff', border: `1px solid ${TRAIT}`,
            padding: '14px 22px', borderRadius: 999, whiteSpace: 'nowrap',
            boxShadow: '0 10px 26px rgba(5, 30, 72, 0.10)',
          }}>
            {p.label}
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// D · « ce qui demande une action remonte tout seul en haut de la liste »
// ---------------------------------------------------------------------------

const IncrustRemontee: React.FC<Contexte> = (ctx) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tRemonte = temps(ctx, 'remonte', 1.3, fps);

  const H = 82;
  const GAP = 12;
  const N = 5;
  const CIBLE = 3;                       // la ligne qui remonte
  const t = interpolate(frame, [tRemonte, tRemonte + 24], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.3, 0, 0.2, 1),
  });
  const noms = ['Team building Nexo', 'Anniversaire Léa', 'Groupe amis', 'Famille Dubois · à encaisser', 'Club Padel'];

  return (
    <div style={{ position: 'relative', width: 1080, height: (H + GAP) * N, margin: '0 auto' }}>
      {noms.map((nom, i) => {
        const actif = i === CIBLE;
        // La cible monte au rang 0 ; celles qu'elle depasse descendent d'un rang.
        const rang = actif ? CIBLE * (1 - t) : (i < CIBLE ? i + t : i);
        const entree = interpolate(frame, [i * 2.5, i * 2.5 + 10], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
        });
        const lift = actif ? Math.sin(t * Math.PI) : 0;
        return (
          <div key={nom} style={{
            position: 'absolute', left: 0, right: 0, top: rang * (H + GAP),
            height: H, borderRadius: 12, background: '#fff',
            border: `1px solid ${TRAIT}`,
            borderLeft: `4px solid ${actif ? BLEU : 'rgba(5,30,72,0.18)'}`,
            boxShadow: actif
              ? `0 ${6 + 22 * lift}px ${14 + 40 * lift}px rgba(5, 30, 72, ${0.10 + 0.14 * lift})`
              : '0 1px 3px rgba(5, 30, 72, 0.06)',
            outline: actif ? `2px solid ${BLEU}` : 'none',
            outlineOffset: -1,
            opacity: entree,
            transform: `scale(${1 + 0.02 * lift})`,
            display: 'flex', alignItems: 'center', padding: '0 26px',
            fontFamily: SANS, fontSize: 26, fontWeight: actif ? 620 : 500,
            color: actif ? ENCRE : ATONE,
            zIndex: actif ? 3 : 1,
          }}>
            <span style={{
              width: 12, height: 12, borderRadius: 6, marginRight: 18,
              background: actif ? BLEU : 'rgba(5,30,72,0.20)',
            }} />
            {nom}
            {actif ? (
              <span style={{
                marginLeft: 'auto', fontFamily: MONO, fontSize: 19, letterSpacing: '0.08em',
                color: BLEU, textTransform: 'uppercase',
              }}>
                à traiter
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// E · « le soir, ton chiffre et ton taux d'occupation sont déjà calculés »
// ---------------------------------------------------------------------------

const IncrustSoir: React.FC<Contexte> = (ctx) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tChiffre = temps(ctx, 'chiffre', 1.0, fps);
  const tTaux = temps(ctx, 'occupation', 2.0, fps);

  const compte = (depart: number, cible: number) => {
    const p = interpolate(frame, [depart, depart + 30], [0, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.15, 0.85, 0.2, 1),
    });
    return Math.round(cible * p);
  };
  const euros = compte(tChiffre, 5936);
  const taux = compte(tTaux, 76);

  const R = 86;
  const C = 2 * Math.PI * R;

  return (
    <div style={{
      width: 1300, height: 340, margin: '0 auto',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 90,
    }}>
      {/* le chiffre du jour */}
      <div style={{
        width: 560, padding: '30px 36px', boxSizing: 'border-box',
        background: '#fff', border: `1px solid ${TRAIT}`, borderRadius: 18,
        boxShadow: '0 14px 40px rgba(5, 30, 72, 0.10)',
        opacity: etabli(frame),
        transform: `translateY(${(1 - etabli(frame)) * 18}px)`,
      }}>
        <div style={{ fontFamily: MONO, fontSize: 19, letterSpacing: '0.12em', color: ATONE, textTransform: 'uppercase' }}>
          Chiffre du jour
        </div>
        <div style={{ fontFamily: SANS, fontSize: 84, fontWeight: 620, color: ENCRE, letterSpacing: '-0.02em', marginTop: 6 }}>
          {euros.toLocaleString('fr-FR')} €
        </div>
        <div style={{ height: 8, borderRadius: 4, background: PALE, marginTop: 14, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${(euros / 5936) * 100}%`, background: BLEU, borderRadius: 4,
          }} />
        </div>
      </div>

      {/* le taux d'occupation */}
      <div style={{
        position: 'relative', width: 220, height: 220,
        opacity: etabli(frame),
      }}>
        <svg width={220} height={220} viewBox="0 0 220 220" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={110} cy={110} r={R} fill="none" stroke={PALE} strokeWidth={22} />
          <circle
            cx={110} cy={110} r={R} fill="none" stroke={BLEU} strokeWidth={22} strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - taux / 100)}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', fontFamily: SANS,
        }}>
          <div style={{ fontSize: 56, fontWeight: 620, color: ENCRE }}>{taux} %</div>
          <div style={{ fontFamily: MONO, fontSize: 16, color: ATONE, letterSpacing: '0.1em' }}>OCCUPATION</div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// F · « zéro saisie · zéro double réservation · zéro appel manqué »
// ---------------------------------------------------------------------------

const IncrustZeros: React.FC<Contexte> = (ctx) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Un temps par « zéro » : les trois occurrences du mot dans la phrase.
  const zeros = ctx.mots.filter((m) => nu(m.m).includes('zero')).map((m) => ctx.decalage + m.t0 * fps);
  const t = [0, 1, 2].map((k) => (zeros[k] !== undefined ? zeros[k] : ctx.decalage + (0.4 + k * 1.2) * fps));

  const blocs = [
    { titre: 'saisie', icone: 'clavier' as const },
    { titre: 'double réservation', icone: 'doublon' as const },
    { titre: 'appel manqué', icone: 'telephone' as const },
  ];

  return (
    <div style={{
      width: 1560, height: 360, margin: '0 auto',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 60,
    }}>
      {blocs.map((b, k) => {
        const d = t[k];
        const pose = interpolate(frame, [d - 4, d + 8], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ressort,
        });
        const barre = interpolate(frame, [d + 6, d + 18], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
        });
        return (
          <div key={b.titre} style={{
            width: 460, textAlign: 'center', opacity: pose,
            transform: `scale(${0.86 + 0.14 * pose})`,
          }}>
            <div style={{ position: 'relative', width: 128, height: 128, margin: '0 auto 14px' }}>
              <svg width={128} height={128} viewBox="0 0 48 48" fill="none">
                {b.icone === 'clavier' ? (
                  <>
                    <rect x={5} y={15} width={38} height={20} rx={4} stroke={ATONE} strokeWidth={2.4} />
                    {[0, 1, 2, 3].map((i) => (
                      <rect key={i} x={9 + i * 8} y={20} width={5} height={4} rx={1} fill={ATONE} />
                    ))}
                    <rect x={13} y={27} width={22} height={4} rx={1} fill={ATONE} />
                  </>
                ) : b.icone === 'doublon' ? (
                  <>
                    <rect x={6} y={13} width={24} height={16} rx={3} stroke={ATONE} strokeWidth={2.4} />
                    <rect x={18} y={20} width={24} height={16} rx={3} stroke={ATONE} strokeWidth={2.4} fill="#fff" />
                  </>
                ) : (
                  <path
                    d="M13 21c2.4 4.8 6.4 8.8 11.2 11.2l4.2-4.2c.6-.6 1.4-.8 2.2-.4 2.4.8 5 1.2 7.6 1.2 1.2 0 2 .8 2 2v6c0 1.2-.8 2-2 2C21 39 8 26 8 9.8c0-1.2.8-2 2-2h6.6c1.2 0 2 .8 2 2 0 2.6.4 5.2 1.2 7.6.2.8 0 1.6-.4 2.2L13 21z"
                    stroke={ATONE} strokeWidth={2.2} fill="none"
                  />
                )}
              </svg>
              {/* la barre qui raye : ce qui disparait */}
              <svg width={128} height={128} viewBox="0 0 128 128" style={{ position: 'absolute', inset: 0 }}>
                <path d="M18 110 L110 18" stroke={BLEU} strokeWidth={7} strokeLinecap="round"
                  pathLength={1} strokeDasharray={1} strokeDashoffset={1 - barre} />
              </svg>
            </div>
            <div style={{
              fontFamily: SANS, fontSize: 120, fontWeight: 620, color: BLEU,
              lineHeight: 1, letterSpacing: '-0.03em',
            }}>
              0
            </div>
            <div style={{
              fontFamily: MONO, fontSize: 21, letterSpacing: '0.1em', color: ATONE,
              textTransform: 'uppercase', marginTop: 10,
            }}>
              {b.titre}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------

const PAR_PLAN: Record<string, React.FC<Contexte>> = {
  cardA: IncrustProbleme,
  cardB: IncrustCreneau,
  card1: IncrustReprise,
  card2: IncrustRemontee,
  cardWbr: IncrustSoir,
  card3: IncrustZeros,
};

/** L'incrustation d'un carton, ou `null` s'il n'en a pas. */
export const Incrustation: React.FC<{ plan: string; mots: Mot[]; decalage: number }> = ({ plan, mots, decalage }) => {
  const C = PAR_PLAN[plan];
  if (!C) return null;
  return <C mots={mots} decalage={decalage} />;
};

export const A_UNE_INCRUSTATION = (plan: string) => Boolean(PAR_PLAN[plan]);
