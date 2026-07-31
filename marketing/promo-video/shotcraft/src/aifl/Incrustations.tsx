import React from 'react';
import { Img, interpolate, staticFile, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { IncrustAilleurs, IncrustComptoir } from './IncrustComptoir';
import * as D3 from './scene3d';

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


// L'ILLUSTRATION S'ETABLIT DES L'OUVERTURE DU CARTON.
//
// Defaut mesure par la garde d'images plates : jusqu'a 0,57 s de blanc entre deux
// cartons. Cause : le carton s'ouvre quelques images avant que la voix n'attaque,
// les mots n'apparaissent qu'a leur date, et l'illustration attendait SON premier
// mot — donc l'ecran restait vide le temps de la jointure. Le decor (le combine,
// le pictogramme, les cadres des compteurs) apparait maintenant des l'image 2 ;
// seuls les EVENEMENTS restent cales sur les mots.
// MISE A JOUR : « des l'image 2 » ne suffisait pas. La garde d'images plates
// mesure encore 3 a 11 images d'ecart-type nul au debut de chaque carton — le
// fond blanc du carton est bien la, mais rien dessus. Une rampe qui part de zero
// laisse forcement quelques images sous le seuil de visibilite, quel que soit
// l'instant ou elle commence. Le decor part donc DEJA VISIBLE : il ne s'ouvre
// pas, il est la, et il finit seulement de s'asseoir.
const etabli = (frame: number) => interpolate(frame, [0, 8], [0.55, 1], {
  extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
});

// ---------------------------------------------------------------------------
// Briques reutilisables
// ---------------------------------------------------------------------------

// A et B vivent dans `IncrustComptoir.tsx` : la scene du comptoir et l'appel
// manque sont assez grosses pour meriter leur fichier, et elles partagent le
// telephone 3D.

// C · « Pinlane, c'est le logiciel qui gère tout ça à ta place »
// ---------------------------------------------------------------------------

const IncrustReprise: React.FC<Contexte> = (ctx) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tGere = temps(ctx, 'prend', 1.2, fps);

  // Les trois embetements du plan precedent viennent se faire absorber. Ils sont
  // nommes comme la scene du comptoir les a montres : sinon le spectateur ne
  // fait pas le lien entre ce qui est absorbe et ce qu'il a vu.
  const pieces = [
    { x: -560, y: -150, z: -260, label: 'Appels manqués' },
    { x: 580, y: -95, z: -180, label: 'File d’attente' },
    { x: -460, y: 180, z: -320, label: 'Encaissement' },
  ];
  const arriveeDe = (k: number) => tGere + 6 + k * 10;

  const halo = pieces.reduce((acc, _, k) => {
    const a = arriveeDe(k);
    return acc + interpolate(frame, [a - 4, a, a + 12], [0, 1, 0], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
  }, 0);

  const pose = Math.max(etabli(frame) * 0.62, D3.ressort(frame, 1, 22));

  return (
    <D3.Plateau frame={frame} largeur={1340} hauteur={400} perspective={1300} amplitude={2}>
      <D3.Halo intensite={0.6 + 1.6 * Math.min(1, halo)} taille={760} />

      {/* LE PICTOGRAMME, SUR SON SOCLE. Il ne flotte plus dans le vide : une
          ombre de contact au sol lui donne une place dans l'espace. */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        transform: `translate(-50%, -50%) translateZ(${70 + 26 * Math.min(1, halo)}px)`,
        transformStyle: 'preserve-3d', zIndex: 3,
      }}>
        <div style={{
          position: 'absolute', left: '50%', top: 198, width: 168, height: 26,
          transform: 'translateX(-50%)', borderRadius: '50%',
          background: `rgba(5,30,72,${0.13 + 0.06 * Math.min(1, halo)})`,
          filter: 'blur(16px)',
        }} />
        <Img
          src={staticFile('brand/picto.webp')}
          style={{
            width: 196, height: 180, objectFit: 'contain', display: 'block',
            opacity: pose,
            transform: `scale(${0.72 + 0.28 * pose + 0.05 * Math.min(1, halo)})`,
            filter: `drop-shadow(0 18px 34px rgba(6,100,254,${0.18 + 0.22 * Math.min(1, halo)}))`,
          }}
        />
      </div>

      {/* L'onde qui part du pictogramme a chaque absorption : un seul anneau a
          la fois. Les halos en rafale font cheap, un eclat unique de qualite non. */}
      {pieces.map((_, k) => {
        const a = arriveeDe(k);
        const t = interpolate(frame, [a, a + 22], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        return <D3.Eclat key={`onde-${k}`} t={t} taille={320} />;
      })}

      {pieces.map((p, k) => {
        const a = arriveeDe(k);
        const t = interpolate(frame, [tGere - 12 + k * 5, a], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.4, 0, 0.25, 1),
        });
        if (t >= 1) return null;
        // Elles arrivent DE LOIN (z negatif) et se rapprochent en accelerant :
        // c'est la profondeur qui fait sentir l'aspiration, pas la taille seule.
        return (
          <div key={p.label} style={{
            position: 'absolute', left: '50%', top: '50%',
            transform: 'translate(-50%, -50%)'
              + ` translate3d(${p.x * (1 - t)}px, ${p.y * (1 - t)}px, ${p.z * (1 - t) + 40 * t}px)`
              + ` scale(${1 - 0.5 * t})`,
            // Elles s'effacent AVANT d'arriver au centre : sinon elles passent
            // DEVANT le pictogramme et le masquent au lieu de le nourrir.
            opacity: interpolate(t, [0, 0.12, 0.55, 0.8], [0, 1, 1, 0]),
            filter: `blur(${t > 0.5 ? (t - 0.5) * 14 : 0}px)`,
            zIndex: 2,
          }}>
            <D3.Pastille texte={p.label} />
          </div>
        );
      })}
    </D3.Plateau>
  );
};

const IncrustRemontee: React.FC<Contexte> = (ctx) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tRemonte = temps(ctx, 'remonte', 1.3, fps);

  const H = 84;
  const GAP = 14;
  const N = 5;
  const CIBLE = 3;                       // la ligne qui remonte
  const t = interpolate(frame, [tRemonte, tRemonte + 26], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.3, 0, 0.2, 1),
  });
  const noms = ['Team building Nexo', 'Anniversaire Léa', 'Groupe amis',
    'Famille Dubois · acompte', 'Club Padel'];

  return (
    <D3.Plateau frame={frame} largeur={1120} hauteur={(H + GAP) * N} perspective={1500} amplitude={1.3}>
      {noms.map((nom, i) => {
        const actif = i === CIBLE;
        const rang = actif ? CIBLE * (1 - t) : (i < CIBLE ? i + t : i);
        const entree = Math.max(etabli(frame) * 0.6, D3.monte(frame, i * 2.5, 12));
        // LA CARTE DECOLLE DE LA PILE. C'est tout le propos : elle ne se glisse
        // pas entre ses voisines, elle passe AU-DESSUS. Son altitude pilote a la
        // fois son elevation, son ombre et son echelle — les trois ensemble font
        // lire un objet qui se souleve, aucune ne suffit seule.
        const vol = actif ? Math.sin(t * Math.PI) : 0;
        return (
          <div key={nom} style={{
            position: 'absolute', left: 0, right: 0, top: rang * (H + GAP),
            height: H, borderRadius: 14,
            ...D3.MATIERE_CLAIRE,
            border: '1px solid rgba(5, 30, 72, 0.08)',
            borderLeft: `4px solid ${actif ? BLEU : 'rgba(5,30,72,0.16)'}`,
            boxShadow: `${D3.ombre(actif ? 0.18 + 0.82 * vol : 0.08)}, ${D3.MATIERE_CLAIRE.boxShadow}`,
            outline: actif && t > 0.02 ? `2px solid rgba(6,100,254,${0.35 + 0.65 * t})` : 'none',
            outlineOffset: -1,
            opacity: entree,
            transform: `translateZ(${actif ? 120 * vol : 0}px) scale(${1 + 0.035 * vol})`,
            display: 'flex', alignItems: 'center', padding: '0 28px',
            fontFamily: SANS, fontSize: 26, fontWeight: actif ? 620 : 500,
            color: actif ? ENCRE : ATONE,
            zIndex: actif ? 9 : 1,
          }}>
            {actif && vol > 0.05 ? (
              <D3.Reflet t={interpolate(frame, [tRemonte + 4, tRemonte + 22], [0, 1],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} rayon={14} />
            ) : null}
            <span style={{
              width: 13, height: 13, borderRadius: 7, marginRight: 20,
              ...(actif ? D3.MATIERE_BLEUE : {}),
              background: actif ? undefined : 'rgba(5,30,72,0.18)',
              boxShadow: actif ? `0 0 ${10 + 14 * t}px rgba(6,100,254,0.7)` : 'none',
            }} />
            {nom}
            {actif ? (
              <span style={{
                marginLeft: 'auto', fontFamily: MONO, fontSize: 18, letterSpacing: '0.08em',
                color: '#fff', textTransform: 'uppercase',
                ...D3.MATIERE_BLEUE, padding: '8px 16px', borderRadius: 999,
                opacity: t,
              }}>
                à traiter
              </span>
            ) : null}
          </div>
        );
      })}
    </D3.Plateau>
  );
};

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
  const socle = etabli(frame);
  const poseA = D3.ressort(frame, 0, 24);
  const poseB = D3.ressort(frame, 7, 24);

  return (
    <D3.Plateau frame={frame} largeur={1340} hauteur={370} perspective={1600} amplitude={1.2}>
      <D3.Halo intensite={socle * 0.8} taille={860} />
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
        justifyContent: 'center', gap: 84, transformStyle: 'preserve-3d',
      }}>
        {/* LE CHIFFRE DU JOUR, sur une carte qui a une epaisseur. */}
        <div style={{
          position: 'relative', width: 580, padding: '32px 38px', boxSizing: 'border-box',
          borderRadius: 20, ...D3.MATIERE_CLAIRE,
          border: '1px solid rgba(5, 30, 72, 0.08)',
          boxShadow: `${D3.ombre(0.55 * (1 - poseA) + 0.30)}, ${D3.MATIERE_CLAIRE.boxShadow}`,
          opacity: Math.min(1, socle * 1.3),
          transform: `translateZ(${40 - 30 * (1 - poseA)}px) translateY(${(1 - poseA) * 22}px)`,
          filter: D3.flou(poseA, 8),
        }}>
          <D3.Reflet t={interpolate(frame, [18, 52], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} rayon={20} />
          <div style={{ fontFamily: MONO, fontSize: 19, letterSpacing: '0.12em', color: ATONE, textTransform: 'uppercase' }}>
            Chiffre du jour
          </div>
          <div style={{
            fontFamily: SANS, fontSize: 88, fontWeight: 640, letterSpacing: '-0.025em', marginTop: 6,
            // Le chiffre est en degrade, pas en aplat : c'est ce qui le fait
            // lire comme un element de marque et non comme du texte de gabarit.
            background: `linear-gradient(180deg, ${ENCRE} 30%, #24406e 100%)`,
            WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
          }}>
            {euros.toLocaleString('fr-FR')} €
          </div>
          {/* la jauge : creusee dans la carte, remplie d'une matiere bleue */}
          <div style={{
            height: 10, borderRadius: 5, background: '#e8eefb', marginTop: 16, overflow: 'hidden',
            boxShadow: 'inset 0 1px 2px rgba(5,30,72,0.14)',
          }}>
            <div style={{
              height: '100%', width: `${(euros / 5936) * 100}%`, borderRadius: 5,
              ...D3.MATIERE_BLEUE,
              boxShadow: `0 0 14px rgba(6,100,254,0.45), ${D3.MATIERE_BLEUE.boxShadow}`,
            }} />
          </div>
        </div>

        {/* LE TAUX D'OCCUPATION, en anneau, pose plus pres de l'observateur. */}
        <div style={{
          position: 'relative', width: 236, height: 236,
          opacity: Math.min(1, socle * 1.3),
          transform: `translateZ(${75 - 45 * (1 - poseB)}px) scale(${0.9 + 0.1 * poseB})`,
          filter: D3.flou(poseB, 8),
        }}>
          {/* l'ombre de l'anneau sur le plateau */}
          <div style={{
            position: 'absolute', left: '50%', bottom: -22, width: 190, height: 26,
            transform: 'translateX(-50%)', borderRadius: '50%',
            background: 'rgba(5,30,72,0.16)', filter: 'blur(14px)',
          }} />
          <svg width={236} height={236} viewBox="0 0 236 236" style={{ transform: 'rotate(-90deg)' }}>
            <defs>
              <linearGradient id="anneau" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#3b86ff" />
                <stop offset="100%" stopColor={BLEU} />
              </linearGradient>
            </defs>
            <circle cx={118} cy={118} r={R} fill="none" stroke="#e8eefb" strokeWidth={24} />
            <circle
              cx={118} cy={118} r={R} fill="none" stroke="url(#anneau)" strokeWidth={24}
              strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - taux / 100)}
              style={{ filter: 'drop-shadow(0 4px 12px rgba(6,100,254,0.35))' }}
            />
          </svg>
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', fontFamily: SANS,
          }}>
            <div style={{ fontSize: 58, fontWeight: 640, color: ENCRE, letterSpacing: '-0.02em' }}>{taux} %</div>
            <div style={{ fontFamily: MONO, fontSize: 16, color: ATONE, letterSpacing: '0.1em' }}>OCCUPATION</div>
          </div>
        </div>
      </div>
    </D3.Plateau>
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
    <D3.Plateau frame={frame} largeur={1560} hauteur={400} perspective={1500} amplitude={1.4}>
      <D3.Halo intensite={0.5 * etabli(frame)} taille={980} />
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
        justifyContent: 'center', gap: 44, transformStyle: 'preserve-3d',
      }}>
        {blocs.map((b, k) => {
          const d = t[k];
          // LE DECOR S'ETABLIT, SEUL L'EVENEMENT ATTEND SON MOT : les trois
          // cartes sont la des la premiere image, a demi-teinte, et chacune
          // s'allume quand la voix la nomme.
          const pose = D3.ressort(frame, d - 4, 22);
          const vie = Math.max(etabli(frame) * 0.55, pose);
          const barre = interpolate(frame, [d + 6, d + 20], [0, 1], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
          });
          const eclat = interpolate(frame, [d + 4, d + 26], [0, 1], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
          });
          return (
            <div key={b.titre} style={{
              position: 'relative', width: 396, padding: '30px 22px 26px',
              boxSizing: 'border-box', textAlign: 'center',
              borderRadius: 22, ...D3.MATIERE_CLAIRE,
              border: '1px solid rgba(5, 30, 72, 0.07)',
              boxShadow: `${D3.ombre(0.20 + 0.55 * pose)}, ${D3.MATIERE_CLAIRE.boxShadow}`,
              opacity: vie,
              transform: `translateZ(${20 + 70 * pose}px) scale(${0.90 + 0.10 * vie})`,
              filter: D3.flou(pose, 8),
            }}>
              <D3.Reflet t={interpolate(frame, [d + 2, d + 26], [0, 1],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} rayon={22} />
              {eclat > 0 && eclat < 1 ? <D3.Eclat t={eclat} taille={260} /> : null}

              {/* L'ICONE, CREUSEE DANS LA CARTE. Un cercle en retrait avec une
                  ombre interne : ca donne une epaisseur au support au lieu de
                  poser un pictogramme a plat. */}
              <div style={{
                position: 'relative', width: 118, height: 118, margin: '0 auto 14px',
                borderRadius: '50%', background: '#eef2f9',
                boxShadow: 'inset 0 2px 5px rgba(5,30,72,0.16), inset 0 -1px 0 rgba(255,255,255,0.9)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width={76} height={76} viewBox="0 0 48 48" fill="none">
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
                      <rect x={18} y={20} width={24} height={16} rx={3} stroke={ATONE} strokeWidth={2.4} fill="#eef2f9" />
                    </>
                  ) : (
                    <path
                      d="M13 21c2.4 4.8 6.4 8.8 11.2 11.2l4.2-4.2c.6-.6 1.4-.8 2.2-.4 2.4.8 5 1.2 7.6 1.2 1.2 0 2 .8 2 2v6c0 1.2-.8 2-2 2C21 39 8 26 8 9.8c0-1.2.8-2 2-2h6.6c1.2 0 2 .8 2 2 0 2.6.4 5.2 1.2 7.6.2.8 0 1.6-.4 2.2L13 21z"
                      stroke={ATONE} strokeWidth={2.2} fill="none"
                    />
                  )}
                </svg>
                {/* la barre qui raye, avec un point de lumiere a sa pointe */}
                <svg width={132} height={132} viewBox="0 0 132 132" style={{ position: 'absolute', inset: 0 }}>
                  <path d="M22 112 L110 24" stroke={BLEU} strokeWidth={7} strokeLinecap="round"
                    pathLength={1} strokeDasharray={1} strokeDashoffset={1 - barre}
                    style={{ filter: 'drop-shadow(0 2px 6px rgba(6,100,254,0.5))' }} />
                  {barre > 0.02 && barre < 0.99 ? (
                    <circle cx={22 + 88 * barre} cy={112 - 88 * barre} r={7} fill="#fff"
                      style={{ filter: 'drop-shadow(0 0 10px rgba(6,100,254,0.9))' }} />
                  ) : null}
                </svg>
              </div>

              {/* LE ZERO, en degrade et non en aplat. */}
              <div style={{
                fontFamily: SANS, fontSize: 112, fontWeight: 640, lineHeight: 1,
                letterSpacing: '-0.035em',
                background: 'linear-gradient(180deg, #3b86ff 10%, #0345b8 100%)',
                WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
              }}>
                0
              </div>
              <div style={{
                fontFamily: MONO, fontSize: 20, letterSpacing: '0.1em', color: ATONE,
                textTransform: 'uppercase', marginTop: 8,
              }}>
                {b.titre}
              </div>
            </div>
          );
        })}
      </div>
    </D3.Plateau>
  );
};

// A0 · « Une résa comme celle-là, chez toi, elle arrive comment ?
//        Neuf fois sur dix : au téléphone. »
// ---------------------------------------------------------------------------
//
// LA MARCHE QUI MANQUAIT. Le film passait de la reservation a l'ecran au
// comptoir sous pression sans dire pourquoi les deux avaient un rapport : « il
// parle direct du telephone qui sonne mais le lien est pas fait ». Cette
// incrustation EST le lien, et elle le montre au lieu de l'affirmer — la carte
// qu'on vient de voir en gros plan, et les trois chemins par lesquels elle
// arrive aujourd'hui. Celui du telephone s'allume, les deux autres s'eteignent.

// Le chemin est un COUDE, pas une diagonale : une ligne droite tiree d'une puce
// haute vers le bord d'une carte basse ne touche ni l'une ni l'autre — au
// premier rendu les trois traits flottaient a cote de ce qu'ils reliaient. Un
// coude a angle droit avec un rayon, lui, part du bord de la puce et arrive sur
// le bord de la carte : il se lit comme un acheminement.
// `ecart` = a quelle distance du bord de la carte le chemin fait son angle. Il
// est DIFFERENT pour les deux canaux de gauche : au meme ecart, leurs segments
// verticaux se superposaient sur la meme colonne de pixels, et le premier rendu
// montrait un seul trait pour deux chemins.
const CANAUX = [
  { nom: 'Téléphone', cote: -1, dy: -118, ecart: 46 },
  { nom: 'Sur place', cote: -1, dy: 118, ecart: 92 },
  { nom: 'Messages', cote: 1, dy: -118, ecart: 46 },
];
const CARTE_L = 280;
const CARTE_H = 108;
const PUCE_X = 452;

const IncrustCanaux: React.FC<Contexte> = (ctx) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const socle = etabli(frame);
  // Profondeur : la carte est DEVANT, les puces derriere, et l'ecart se voit
  // parce que la scene est en perspective et que les ombres suivent l'altitude.
  const derive3d = D3.derive(frame, 1.6);
  // Les trois chemins se tracent sur « comment » ; le telephone l'emporte sur
  // « neuf ». Un texte reecrit sans ces mots retombe sur les replis et
  // l'illustration continue de jouer.
  const tRoutes = temps(ctx, 'comment', 1.5, fps);
  const tGagne = temps(ctx, 'neuf', 3.0, fps);

  const L = 1320;
  const H = 360;
  const cx = L / 2;
  const cy = H / 2;
  const verdict = interpolate(frame, [tGagne, tGagne + 14], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
  });
  // La carte arrive en ressort et se pose : c'est ce depassement qui lui donne
  // une masse. Son altitude pilote son ombre ET son elevation en Z.
  const pose = D3.ressort(frame, 0, 24);
  const altitude = 1 - Math.min(1, pose);

  return (
    <D3.Plateau frame={frame} largeur={L} hauteur={H} perspective={1500} amplitude={1.6}>
      <D3.Halo intensite={socle * (0.5 + 0.5 * verdict)} taille={720} />

      {/* Les chemins, au fond de la scene. */}
      <svg width={L} height={H} style={{ position: 'absolute', left: 0, top: 0, transform: 'translateZ(-40px)' }}>
        <defs>
          <linearGradient id="fil-actif" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={D3.BLEU} stopOpacity="0.15" />
            <stop offset="100%" stopColor={D3.BLEU} stopOpacity="1" />
          </linearGradient>
        </defs>
        {CANAUX.map((c, k) => {
          const depart = tRoutes + k * 7;
          const trace = interpolate(frame, [depart, depart + 16], [0, 1], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
          });
          const gagnant = k === 0;
          const vie = gagnant ? 1 : 1 - 0.80 * verdict;
          const xPuce = cx + c.cote * (PUCE_X - 96);
          const xCarte = cx + c.cote * (CARTE_L / 2);
          const coude = xCarte + c.cote * c.ecart;
          const r = 20 * c.cote;
          const sens = c.dy > 0 ? -1 : 1;
          const d = `M ${xPuce} ${cy + c.dy}`
            + ` H ${coude + r}`
            + ` Q ${coude} ${cy + c.dy} ${coude} ${cy + c.dy + sens * 20}`
            + ` V ${cy - sens * 20}`
            + ` Q ${coude} ${cy} ${coude - r} ${cy}`
            + ` H ${xCarte}`;
          return (
            <g key={c.nom}>
              {/* la trace eteinte, toujours la : le chemin EXISTE avant qu'on
                  le parcoure, ce qui evite l'effet « trait qui pousse dans le
                  vide » */}
              <path d={d} fill="none" stroke={D3.ATONE} strokeWidth={1.5}
                opacity={0.14 * Math.min(1, trace * 3) * vie} />
              <path
                d={d} fill="none" pathLength={100}
                stroke={gagnant && verdict > 0 ? 'url(#fil-actif)' : D3.ATONE}
                strokeWidth={gagnant ? 2.5 + 2 * verdict : 2}
                strokeLinecap="round"
                strokeDasharray="100" strokeDashoffset={100 - 100 * trace}
                opacity={(gagnant ? 0.5 + 0.5 * verdict : 0.36) * vie}
              />
              {/* LE POINT DE LUMIERE QUI PARCOURT LE TRAIT. C'est lui qui
                  raconte l'acheminement : un trait qui s'allonge dit « ca
                  pousse », un point qui court dit « ca circule ».
                  Sa position est calculee ANALYTIQUEMENT le long du coude —
                  pas de `<animate>` SVG, qui est une animation temporelle que
                  Remotion ne pilote pas et qui casserait le determinisme. */}
              {trace > 0.03 && trace < 0.98 ? (() => {
                const l1 = Math.abs(coude - xPuce);
                const l2 = Math.abs(c.dy) + 0;
                const l3 = Math.abs(xCarte - coude);
                const total = l1 + l2 + l3;
                let d1 = trace * total;
                let px = xPuce;
                let py = cy + c.dy;
                if (d1 <= l1) {
                  px = xPuce + Math.sign(coude - xPuce) * d1;
                } else if (d1 <= l1 + l2) {
                  px = coude;
                  py = cy + c.dy + Math.sign(-c.dy) * (d1 - l1);
                } else {
                  px = coude + Math.sign(xCarte - coude) * (d1 - l1 - l2);
                  py = cy;
                }
                return (
                  <g opacity={0.95 * vie}>
                    <circle cx={px} cy={py} r={gagnant ? 11 : 8}
                      fill={gagnant ? D3.BLEU : D3.ATONE} opacity={0.18} />
                    <circle cx={px} cy={py} r={gagnant ? 4.5 : 3.2}
                      fill={gagnant ? D3.BLEU : D3.ATONE} />
                  </g>
                );
              })() : null}
            </g>
          );
        })}
      </svg>

      {/* La reservation : au premier plan, avec une vraie epaisseur. */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%', width: CARTE_L, height: CARTE_H,
        transform: `translate(-50%, -50%) translateZ(${60 + 40 * altitude}px)`
          + ` translateY(${-26 * altitude}px) scale(${0.94 + 0.06 * pose})`,
        opacity: Math.min(1, socle * 1.4),
        filter: D3.flou(pose, 10),
        borderRadius: 14, borderLeft: `5px solid ${D3.BLEU}`,
        ...D3.MATIERE_CLAIRE,
        boxShadow: `${D3.ombre(0.35 + 0.65 * altitude)}, ${D3.MATIERE_CLAIRE.boxShadow}`,
        padding: '22px 24px', boxSizing: 'border-box', zIndex: 3,
      }}>
        <D3.Reflet t={interpolate(frame, [16, 46], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
        <div style={{ fontFamily: SANS, fontSize: 27, fontWeight: 640, color: ENCRE, letterSpacing: '-0.01em' }}>
          Une réservation
        </div>
        <div style={{ fontFamily: MONO, fontSize: 19, color: ATONE, marginTop: 10, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
          11:00 · 11 JOUEURS
        </div>
      </div>

      {CANAUX.map((c, k) => {
        const depart = tRoutes + k * 7;
        const entree = D3.ressort(frame, depart - 6, 20);
        const gagnant = k === 0;
        const vie = gagnant ? 1 : 1 - 0.78 * verdict;
        const allume = gagnant && verdict > 0.02;
        // Le gagnant AVANCE vers l'observateur quand il l'emporte ; les autres
        // reculent. La hierarchie se lit en profondeur, pas seulement en couleur.
        const z = allume ? 30 * verdict : -20 * verdict;
        return (
          <div key={c.nom} style={{
            position: 'absolute', left: '50%', top: '50%',
            transform: `translate(-50%, -50%) translate(${c.cote * PUCE_X}px, ${c.dy}px)`
              + ` translateZ(${z}px) scale(${0.88 + 0.12 * entree + (gagnant ? 0.08 * verdict : 0)})`,
            opacity: entree * vie,
            filter: D3.flou(entree, 7),
            zIndex: 2,
          }}>
            <D3.Pastille texte={c.nom} actif={allume} />
          </div>
        );
      })}

      {/* La proportion, en chiffres. */}
      <div style={{
        position: 'absolute', left: '50%', bottom: -18,
        transform: `translateX(-50%) translateZ(${20 * verdict}px) scale(${0.88 + 0.12 * D3.ressort(frame, tGagne + 6, 18)})`,
        opacity: interpolate(frame, [tGagne + 6, tGagne + 16], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        }),
        fontFamily: MONO, fontSize: 24, fontWeight: 600, letterSpacing: '0.14em',
        color: BLEU, textTransform: 'uppercase',
        ...D3.MATIERE_CLAIRE,
        border: '1px solid rgba(6, 100, 254, 0.24)',
        padding: '12px 22px', borderRadius: 999,
        boxShadow: D3.ombre(0.25, '6, 100, 254'),
      }}>
        9 fois sur 10
      </div>
    </D3.Plateau>
  );
};

// ---------------------------------------------------------------------------

const PAR_PLAN: Record<string, React.FC<Contexte>> = {
  // La sequence du probleme se joue en trois marches : d'ou vient la resa,
  // pourquoi tu ne peux pas repondre, ce que ca coute.
  cardA: IncrustCanaux,
  cardB: IncrustComptoir,
  cardC: IncrustAilleurs,
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
