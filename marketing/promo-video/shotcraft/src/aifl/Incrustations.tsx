import React from 'react';
import { Img, interpolate, staticFile, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { IncrustAilleurs, IncrustComptoir } from './IncrustComptoir';

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
  const t0 = temps(ctx, 'pinlane', 0.1, fps);
  const tGere = temps(ctx, 'gere', 1.2, fps);

  // Les trois embetements du plan precedent viennent se faire absorber.
  const pieces = [
    // Les trois choses que la scene du comptoir vient de montrer, nommees telles
    // quelles : sinon le spectateur ne fait pas le lien entre ce qui est absorbe
    // et ce qu'il a vu dix secondes plus tot.
    { x: -520, y: -140, label: 'Appels manqués' },
    { x: 540, y: -90, label: 'File d’attente' },
    { x: -430, y: 170, label: 'Encaissement' },
  ];

  const halo = pieces.reduce((acc, _, k) => {
    const arrivee = tGere + 6 + k * 9;
    return acc + interpolate(frame, [arrivee - 3, arrivee, arrivee + 10], [0, 1, 0], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
  }, 0);

  // Le pictogramme est la des la premiere image : il ne s'ouvre pas, il finit
  // de s'asseoir. Sans ca le carton demarrait sur trois images vides.
  const pictoIn = Math.max(etabli(frame) * 0.62, interpolate(frame, [2, 14], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ressort,
  }));
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
        // La liste est etablie des l'ouverture ; c'est la REMONTEE, elle, qui
        // attend son mot. Une cascade partant de zero ouvrait le carton sur neuf
        // images vides — le deuxieme plus gros trou du film.
        const entree = Math.max(etabli(frame) * 0.6, interpolate(frame, [i * 2.5, i * 2.5 + 10], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
        }));
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
        // LE DECOR S'ETABLIT, SEUL L'EVENEMENT ATTEND SON MOT. Les trois blocs
        // n'apparaissaient qu'a leur « zéro » : le carton ouvrait sur onze images
        // entierement vides, le plus gros trou du film. Ils sont maintenant la
        // des la premiere image, a demi-teinte, et chacun s'allume quand la voix
        // le nomme — c'est le rayage qui reste cale sur le mot.
        const vie = Math.max(etabli(frame) * 0.55, pose);
        const barre = interpolate(frame, [d + 6, d + 18], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
        });
        return (
          <div key={b.titre} style={{
            width: 460, textAlign: 'center', opacity: vie,
            transform: `scale(${0.86 + 0.14 * vie})`,
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
  // Les trois chemins se tracent sur « comment » ; le telephone l'emporte sur
  // « neuf ». Un texte reecrit sans ces mots retombe sur les replis et
  // l'illustration continue de jouer.
  const tRoutes = temps(ctx, 'comment', 1.5, fps);
  const tGagne = temps(ctx, 'neuf', 3.0, fps);

  const L = 1320;
  const H = 340;
  const cx = L / 2;
  const cy = H / 2;
  const verdict = interpolate(frame, [tGagne, tGagne + 12], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
  });

  return (
    <div style={{ position: 'relative', width: L, height: H, margin: '0 auto', opacity: socle }}>
      {/* Les chemins, en dessous de tout : ils partent des puces et arrivent sur
          les bords de la carte. */}
      <svg width={L} height={H} style={{ position: 'absolute', left: 0, top: 0 }}>
        {CANAUX.map((c, k) => {
          const depart = tRoutes + k * 7;
          const trace = interpolate(frame, [depart, depart + 15], [0, 1], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
          });
          const gagnant = k === 0;
          const vie = gagnant ? 1 : 1 - 0.78 * verdict;
          const xPuce = cx + c.cote * (PUCE_X - 92);
          const xCarte = cx + c.cote * (CARTE_L / 2);
          // L'angle se fait DEHORS : place a l'interieur, le segment vertical
          // passait derriere la carte et ressortait dessous.
          const coude = xCarte + c.cote * c.ecart;
          const r = 18 * c.cote;
          const sens = c.dy > 0 ? -1 : 1;
          const d = `M ${xPuce} ${cy + c.dy}`
            + ` H ${coude + r}`
            + ` Q ${coude} ${cy + c.dy} ${coude} ${cy + c.dy + sens * 18}`
            + ` V ${cy - sens * 18}`
            + ` Q ${coude} ${cy} ${coude - r} ${cy}`
            + ` H ${xCarte}`;
          // `pathLength` normalise a 100 : le trait se DESSINE quelle que soit sa
          // longueur reelle, donc les trois chemins avancent au meme rythme.
          return (
            <path
              key={c.nom} d={d} fill="none" pathLength={100}
              stroke={gagnant && verdict > 0 ? BLEU : ATONE}
              strokeWidth={gagnant ? 2 + 2 * verdict : 2}
              strokeLinecap="round"
              strokeDasharray="100" strokeDashoffset={100 - 100 * trace}
              opacity={(gagnant ? 0.45 + 0.55 * verdict : 0.34) * vie}
            />
          );
        })}
      </svg>

      {/* La reservation, au centre : c'est l'objet dont on parle. */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%', width: CARTE_L, height: CARTE_H,
        transform: `translate(-50%, -50%) scale(${0.92 + 0.08 * socle})`,
        background: '#fff', borderRadius: 12, borderLeft: `5px solid ${BLEU}`,
        boxShadow: '0 14px 34px rgba(5, 30, 72, 0.13)',
        padding: '20px 22px', boxSizing: 'border-box', zIndex: 2,
      }}>
        <div style={{ fontFamily: SANS, fontSize: 26, fontWeight: 620, color: ENCRE }}>Une réservation</div>
        <div style={{ fontFamily: MONO, fontSize: 19, color: ATONE, marginTop: 9, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
          11:00 · 11 JOUEURS
        </div>
      </div>

      {CANAUX.map((c, k) => {
        const depart = tRoutes + k * 7;
        const trace = interpolate(frame, [depart, depart + 15], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
        });
        const gagnant = k === 0;
        const vie = gagnant ? 1 : 1 - 0.78 * verdict;
        const allume = gagnant && verdict > 0;
        return (
          <div key={c.nom} style={{
            position: 'absolute', left: '50%', top: '50%',
            transform: `translate(-50%, -50%) translate(${c.cote * PUCE_X}px, ${c.dy}px)`
              + ` scale(${0.86 + 0.14 * trace + (gagnant ? 0.10 * verdict : 0)})`,
            opacity: trace * vie,
            fontFamily: MONO, fontSize: 22, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: allume ? '#fff' : ATONE,
            background: allume ? BLEU : '#fff',
            border: `1px solid ${allume ? BLEU : TRAIT}`,
            padding: '14px 24px', borderRadius: 999, whiteSpace: 'nowrap', zIndex: 2,
            boxShadow: allume
              ? `0 12px 30px rgba(6, 100, 254, ${0.30 * verdict})`
              : '0 10px 26px rgba(5, 30, 72, 0.09)',
          }}>
            {c.nom}
          </div>
        );
      })}

      {/* La proportion, en chiffres : « neuf fois sur dix » se retient mieux
          ecrit que dit. */}
      <div style={{
        position: 'absolute', left: '50%', bottom: -14,
        transform: `translateX(-50%) scale(${0.9 + 0.1 * verdict})`,
        opacity: interpolate(frame, [tGagne + 6, tGagne + 16], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        }),
        fontFamily: MONO, fontSize: 24, fontWeight: 600, letterSpacing: '0.14em',
        color: BLEU, textTransform: 'uppercase',
        background: PALE, border: `1px solid rgba(6, 100, 254, 0.22)`,
        padding: '11px 20px', borderRadius: 999,
      }}>
        9 fois sur 10
      </div>
    </div>
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
