import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig, Easing } from 'remotion';

// LA SCENE DU COMPTOIR : le probleme joue, il n'est plus decrit.
//
// La version precedente illustrait « ça se passe au telephone, tu notes sur un
// cahier » par un combine plat et un cahier. Movsar a demande la vraie scene :
// « t'es au comptoir, t'as plein de gens a gerer et le telephone sonne, mais
// t'as pas le temps de repondre ». C'est ce qui se joue ici, en quatre temps
// cales sur les mots de la phrase :
//
//   « comptoir »   le plan de travail se construit en perspective
//   « groupes »    trois clients apparaissent l'un apres l'autre, en attente
//   « encaisser »  le terminal de paiement s'allume et attend
//   « sonne »      le telephone se met a vibrer, ondes et compteur d'appels
//
// Le telephone est construit en 3D CSS (perspective, biseau, reflet, ombre
// portee qui suit la vibration) plutot qu'en icone plate : c'est l'objet sur
// lequel se joue tout le probleme, il merite d'etre l'element le plus soigne du
// film.

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
type Contexte = { mots: Mot[]; decalage: number };

const nu = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const quand = (mots: Mot[], cle: string, repli: number) => {
  const m = mots.find((x) => nu(x.m).includes(nu(cle)));
  return m ? m.t0 : repli;
};
const temps = (c: Contexte, cle: string, repli: number, fps: number) =>
  c.decalage + quand(c.mots, cle, repli) * fps;

const ease = Easing.bezier(0.22, 0.9, 0.24, 1);
const ressort = Easing.bezier(0.2, 1.25, 0.3, 1);
const monte = (frame: number, de: number, duree = 12, easing = ease) =>
  interpolate(frame, [de, de + duree], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing,
  });

// ---------------------------------------------------------------------------
// Le telephone, en 3D
// ---------------------------------------------------------------------------

// LA CADENCE DE SONNERIE. Un telephone sonne par SALVES : ~1,3 s de sonnerie,
// ~0,9 s de silence. La version precedente vibrait et emettait des ondes sans
// interruption, ce qui ne ressemble a aucun telephone : et c'est cette cadence,
// bien plus que le nombre de reflets, qui fait reconnaitre l'objet.
// Elle est calee sur `sonnerie-telephone.mp3`, qui porte deux sonneries sur 4 s.
const CADENCE = 66;        // images pour un cycle complet
const SALVE = 39;          // dont sonnerie

/** Ou en est-on dans la salve ? 0 pendant le silence, 1 pendant la sonnerie,
 *  avec une attaque et une chute courtes pour ne pas claquer. */
const salve = (frame: number) => {
  const t = ((frame % CADENCE) + CADENCE) % CADENCE;
  if (t > SALVE) return 0;
  return Math.min(1, Math.min(t / 3, (SALVE - t) / 5));
};

/** Un smartphone vu de trois quarts. `sonne` de 0 a 1 autorise la sonnerie ;
 *  `entree` son apparition. La cadence, elle, vient du temps. */
const Telephone: React.FC<{ entree: number; sonne: number; frame: number; echelle?: number }> = ({
  entree, sonne, frame, echelle = 1,
}) => {
  const actif = sonne * salve(frame);
  // Vibration : deux frequences superposees pour que ca ne batte pas comme un
  // metronome. Un telephone sur un comptoir tressaute, il n'oscille pas.
  const vx = (Math.sin(frame * 1.9) * 2.6 + Math.sin(frame * 3.7) * 1.2) * actif;
  const vy = (Math.sin(frame * 2.6 + 0.7) * 1.4) * actif;
  const vr = (Math.sin(frame * 2.1 + 1) * 1.7) * actif;
  const L = 214;
  const H = 424;
  const px = (v: number) => v * echelle;

  return (
    <div style={{
      position: 'relative', width: px(L), height: px(H),
      perspective: 1100, transformStyle: 'preserve-3d',
      opacity: entree,
    }}>
      {/* ombre portee : elle se resserre et fonce quand l'appareil tressaute */}
      <div style={{
        position: 'absolute', left: '50%', bottom: px(-30),
        width: px(L * 1.2), height: px(46),
        transform: `translateX(calc(-50% + ${vx * 0.6}px)) scaleX(${1 - 0.06 * actif})`,
        background: `radial-gradient(ellipse at 50% 50%, rgba(5, 30, 72, ${0.26 + 0.08 * actif}), transparent 70%)`,
        filter: 'blur(10px)',
        opacity: 0.75 * entree,
      }} />

      {/* LES ONDES PARTENT DU HAUT DE L'APPAREIL, en arcs, comme une emission —
          et non en ellipses centrees dessus, qui ne ressemblent a rien. Elles ne
          vivent que pendant la salve. */}
      {actif > 0.02 ? [0, 1, 2].map((k) => {
        const cycle = 22;
        const q = (((frame - k * 7) % cycle) + cycle) % cycle / cycle;
        const r = px(46 + q * 150);
        return (
          <svg
            key={k}
            width={px(420)} height={px(300)}
            viewBox="0 0 420 300"
            style={{
              position: 'absolute', left: '50%', top: px(-52),
              transform: 'translateX(-50%)',
              opacity: (1 - q) * 0.7 * actif,
              overflow: 'visible',
            }}
          >
            <path
              d={`M ${210 - r / echelle} 150 A ${r / echelle} ${r / echelle} 0 0 1 ${210 + r / echelle} 150`}
              fill="none" stroke={BLEU} strokeWidth={3.2} strokeLinecap="round"
            />
          </svg>
        );
      }) : null}

      {/* corps : coque, biseau interieur, tranche laterale et bouton */}
      <div style={{
        position: 'absolute', inset: 0,
        transform: `rotateY(-21deg) rotateX(7deg) rotateZ(${-5 + vr}deg)`
          + ` translateX(${vx}px) translateY(${vy}px)`,
        transformStyle: 'preserve-3d',
        borderRadius: px(34),
        background: 'linear-gradient(148deg, #1b2a48 0%, #0d1830 44%, #050d1c 100%)',
        boxShadow: `inset 0 0 0 ${px(1.6)}px rgba(255,255,255,0.16),`
          + ` inset 0 ${px(2)}px 0 rgba(255,255,255,0.12),`
          + ` inset 0 ${px(-3)}px ${px(6)}px rgba(0,0,0,0.5),`
          + ` 0 ${px(28)}px ${px(56)}px rgba(5, 30, 72, ${0.34 + 0.08 * actif})`,
      }}>
        {/* le bouton de tranche : un detail qui coute trois lignes et qui fait
            lire un objet fabrique plutot qu'un rectangle */}
        <div style={{
          position: 'absolute', right: px(-3), top: px(112),
          width: px(4), height: px(56), borderRadius: px(3),
          background: 'linear-gradient(180deg, #2a3c5e, #16233d)',
        }} />

        {/* ecran */}
        <div style={{
          position: 'absolute', inset: px(9), borderRadius: px(27),
          background: `linear-gradient(158deg, ${BLEU_CLAIR} 0%, ${BLEU} 42%, #0b3ea8 100%)`,
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'space-between',
          padding: `${px(26)}px ${px(16)}px ${px(24)}px`,
          boxSizing: 'border-box',
          boxShadow: `inset 0 0 ${px(30)}px rgba(0,0,0,0.28)`,
        }}>
          {/* l'encoche : encore un detail d'objet reel */}
          <div style={{
            position: 'absolute', left: '50%', top: px(8), transform: 'translateX(-50%)',
            width: px(72), height: px(9), borderRadius: px(6),
            background: 'rgba(0,0,0,0.34)',
          }} />

          <div style={{ textAlign: 'center', marginTop: px(16) }}>
            {/* la pastille d'appelant : elle pulse au rythme de la salve */}
            <div style={{
              width: px(64), height: px(64), borderRadius: '50%', margin: '0 auto',
              background: 'rgba(255,255,255,0.18)',
              border: `${px(2)}px solid rgba(255,255,255,0.38)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transform: `scale(${1 + 0.07 * actif})`,
              boxShadow: `0 0 ${px(18 * actif)}px rgba(255,255,255,${0.4 * actif})`,
            }}>
              <svg width={px(30)} height={px(30)} viewBox="0 0 24 24">
                <circle cx={12} cy={8} r={4} fill="rgba(255,255,255,0.9)" />
                <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="rgba(255,255,255,0.9)" />
              </svg>
            </div>
            <div style={{
              fontFamily: MONO, fontSize: px(14), letterSpacing: '0.16em',
              color: 'rgba(255,255,255,0.72)', textTransform: 'uppercase',
              marginTop: px(12),
            }}>
              Appel entrant
            </div>
            <div style={{
              fontFamily: SANS, fontSize: px(26), fontWeight: 620, color: '#fff',
              marginTop: px(5), whiteSpace: 'nowrap',
            }}>
              06 12 34 …
            </div>
          </div>

          {/* les deux boutons : celui qu'on ne prendra pas respire au rythme de
              la salve. Pas de vert/rouge — le film tient sur deux couleurs. */}
          <div style={{ display: 'flex', gap: px(26) }}>
            {[0, 1].map((k) => (
              <div key={k} style={{
                width: px(52), height: px(52), borderRadius: '50%',
                background: k === 0
                  ? 'linear-gradient(180deg, #ffffff, #e6edf9)'
                  : 'rgba(255,255,255,0.20)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: k === 0
                  ? `0 ${px(6)}px ${px(14)}px rgba(0,0,0,0.26), 0 0 ${px(20 * actif)}px rgba(255,255,255,${0.5 * actif})`
                  : 'inset 0 0 0 1px rgba(255,255,255,0.18)',
                transform: `scale(${k === 0 ? 1 + 0.08 * actif : 1})`,
              }}>
                <svg width={px(26)} height={px(26)} viewBox="0 0 24 24"
                  style={{ transform: k === 1 ? 'rotate(134deg)' : 'none' }}>
                  <path
                    d="M6.6 10.8c1.2 2.4 3.2 4.4 5.6 5.6l2.1-2.1c.3-.3.7-.4 1.1-.2 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V19c0 .6-.4 1-1 1C10.5 20 4 13.5 4 5.4c0-.6.4-1 1-1h3.3c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.2 1.1l-2.1 2.1z"
                    fill={k === 0 ? BLEU : '#fff'}
                  />
                </svg>
              </div>
            ))}
          </div>

          {/* reflet : une bande diagonale qui glisse lentement sur le verre */}
          <div style={{
            position: 'absolute', inset: px(-40),
            background: 'linear-gradient(118deg, transparent 38%, rgba(255,255,255,0.22) 47%,'
              + ' rgba(255,255,255,0.07) 53%, transparent 62%)',
            transform: `translateX(${((frame * 0.7) % 320) - 160}px)`,
            pointerEvents: 'none',
          }} />
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Les silhouettes, avec un vrai cycle de marche
// ---------------------------------------------------------------------------

/** Une personne. `marche` est la distance parcourue en pas (0 = immobile) :
 *  c'est elle qui pilote le cycle, donc la vitesse des jambes suit toujours
 *  celle du deplacement : un personnage dont les jambes bougent sans qu'il
 *  avance, ou l'inverse, se voit immediatement. */
const Silhouette: React.FC<{
  h?: number; ton?: string; marche?: number; impatience?: number; phase?: number;
}> = ({ h = 150, ton = ATONE, marche = 0, impatience = 0, phase = 0 }) => {
  const k = h / 150;
  const c = (marche + phase) * Math.PI * 2;
  const anime = marche > 0.001 ? 1 : 0;
  // Le corps monte et descend DEUX fois par pas, jamais une : c'est la
  // signature d'une demarche.
  const rebond = Math.abs(Math.sin(c)) * 4 * k * anime;
  const jambeA = Math.sin(c) * 22 * anime;
  const jambeB = Math.sin(c + Math.PI) * 22 * anime;
  const brasA = Math.sin(c + Math.PI) * 16 * anime;
  const brasB = Math.sin(c) * 16 * anime;
  // L'ombre de contact se resserre quand un pied porte le poids.
  const appui = 0.6 + 0.4 * Math.abs(Math.cos(c));

  return (
    <div style={{ position: 'relative', width: h * 0.66, height: h * 1.06 }}>
      <div style={{
        position: 'absolute', left: '50%', bottom: 0,
        width: h * 0.5 * appui, height: h * 0.075,
        transform: 'translateX(-50%)', borderRadius: '50%',
        background: 'rgba(5,30,72,0.20)', filter: `blur(${h * 0.035}px)`,
      }} />
      {/* LA POSE DE REPOS DOIT DEJA ETRE JUSTE. Premier essai : deux jambes
          posees a trois pixels l'une de l'autre et des bras de 38 px accroches
          trop haut — a l'arret elles se superposaient en un seul bloc et les
          bras faisaient des moignons. Un cycle de marche ne rattrape pas une
          silhouette mal proportionnee : on dessine d'abord la station debout,
          l'animation ne fait ensuite que pivoter les membres. */}
      <svg
        width={h * 0.66} height={h}
        viewBox="0 0 66 150"
        style={{ display: 'block', position: 'absolute', left: 0, bottom: h * 0.03,
          transform: `translateY(${-rebond}px)` }}
      >
        {/* jambes : deux troncs SEPARES, qui pivotent depuis la hanche */}
        <g transform="translate(33, 92)">
          <rect x={-13} y={-4} width={12} height={58} rx={6} fill={ton} opacity={0.78}
            transform={`rotate(${jambeB})`} style={{ transformOrigin: '-7px 0px' }} />
          <rect x={1} y={-4} width={12} height={58} rx={6} fill={ton}
            transform={`rotate(${jambeA})`} style={{ transformOrigin: '7px 0px' }} />
        </g>
        {/* bras : longs, le long du corps, en opposition aux jambes */}
        <g transform="translate(33, 60)">
          <rect x={-21} y={0} width={8} height={44} rx={4} fill={ton} opacity={0.72}
            transform={`rotate(${brasA})`} style={{ transformOrigin: '-17px 2px' }} />
          <rect x={13} y={0} width={8} height={44} rx={4} fill={ton} opacity={0.88}
            transform={`rotate(${brasB})`} style={{ transformOrigin: '17px 2px' }} />
        </g>
        {/* buste : des epaules et une taille, pas une goutte */}
        <path
          d="M15 96 C13 78, 12 60, 33 56 C54 60, 53 78, 51 96 Z"
          fill={ton}
        />
        <circle cx={33} cy={30 + impatience} r={17} fill={ton} />
        {/* le cou : sans lui la tete est posee sur les epaules comme une bille */}
        <rect x={29} y={42} width={8} height={10} fill={ton} />
      </svg>
    </div>
  );
};

// ---------------------------------------------------------------------------
// A · « t'es au comptoir · trois groupes qui attendent · une commande a
//       encaisser · et le telephone qui sonne »
// ---------------------------------------------------------------------------

export const IncrustComptoir: React.FC<Contexte> = (ctx) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const tComptoir = temps(ctx, 'comptoir', 1.6, fps);
  const tGroupes = temps(ctx, 'groupes', 2.6, fps);
  const tCaisse = temps(ctx, 'encaisser', 3.9, fps);
  const tSonne = temps(ctx, 'sonne', 5.0, fps);

  // Le decor s'etablit des l'ouverture du carton (sinon l'ecran reste blanc le
  // temps que la voix attaque) ; les EVENEMENTS, eux, attendent leur mot.
  // Le decor part DEJA VISIBLE : une rampe qui commence a zero laisse
  // toujours quelques images sous le seuil de visibilite, et la garde d'images
  // plates les comptait a l'ouverture de chaque carton.
  const plan = 0.55 + 0.45 * monte(frame, 0, 10);
  const sonne = monte(frame, tSonne - 4, 8);
  const caisse = monte(frame, tCaisse - 4, 10, ressort);

  return (
    <div style={{ position: 'relative', width: 1500, height: 470, margin: '0 auto' }}>
      {/* --- le comptoir, en perspective --- */}
      <div style={{
        // Un comptoir, pas une etagere : plus profond, un degrade qui part du fond
        // vers l'avant, et une arete franche. Sans cela le plan se lisait comme une
        // planche flottante et les personnages avaient l'air poses dessus.
        position: 'absolute', left: '50%', bottom: 0, width: 1330, height: 240,
        transform: `translateX(-50%) perspective(1000px) rotateX(${62 - 6 * plan}deg) scaleY(${plan})`,
        transformOrigin: 'center bottom',
        background: 'linear-gradient(180deg, #dde5f0 0%, #eef2f8 34%, #ffffff 100%)',
        borderRadius: '22px 22px 6px 6px',
        boxShadow: `inset 0 2px 0 rgba(255,255,255,0.95), 0 -1px 0 ${TRAIT}`,
        border: `1px solid ${TRAIT}`,
      }} />
      {/* la tranche du comptoir, qui lui donne son epaisseur */}
      <div style={{
        position: 'absolute', left: '50%', bottom: 0, width: 1330, height: 34,
        transform: 'translateX(-50%)',
        background: 'linear-gradient(180deg, #e2e8f2, #ccd6e5)',
        borderRadius: '0 0 10px 10px', opacity: plan,
        boxShadow: '0 10px 22px rgba(5,30,72,0.10)',
      }} />

      {/* --- les trois groupes qui attendent, derriere le comptoir --- */}
      {[0, 1, 2].map((k) => {
        const t = monte(frame, tGroupes - 6 + k * 5, 12, ressort);
        // Une impatience qui monte : ils se balancent un peu plus a chaque seconde.
        const imp = Math.sin((frame - tGroupes) * 0.13 + k * 1.7) * (1.6 + k * 0.5) * t;
        return (
          <div key={k} style={{
            position: 'absolute', left: 150 + k * 138, bottom: 152,
            opacity: t,
            transform: `translateY(${(1 - t) * 26}px) translateX(${imp}px)`,
          }}>
            {/* Ils ATTENDENT : pas de cycle de marche, mais une impatience qui
                monte — le poids passe d'un pied sur l'autre. */}
            <Silhouette h={186 + (k % 2) * 22} ton={k === 1 ? '#6b768c' : ATONE}
              impatience={imp * 0.4} />
          </div>
        );
      })}
      {/* le compte de la file */}
      <div style={{
        position: 'absolute', left: 154, bottom: 372,
        opacity: monte(frame, tGroupes + 4, 10),
        fontFamily: MONO, fontSize: 21, letterSpacing: '0.12em', color: ATONE,
        textTransform: 'uppercase', whiteSpace: 'nowrap',
      }}>
        3 groupes · en attente
      </div>

      {/* --- le terminal de paiement, au centre du comptoir --- */}
      <div style={{
        position: 'absolute', left: 660, bottom: 116,
        transform: `translateY(${(1 - caisse) * 20}px) scale(${0.86 + 0.14 * caisse})`,
        opacity: caisse,
      }}>
        <div style={{
          width: 214, height: 122, borderRadius: 14, background: '#fff',
          border: `1px solid ${TRAIT}`, boxShadow: '0 14px 30px rgba(5,30,72,0.14)',
          padding: '16px 18px', boxSizing: 'border-box', fontFamily: SANS,
        }}>
          <div style={{ fontFamily: MONO, fontSize: 14, letterSpacing: '0.12em', color: ATONE, textTransform: 'uppercase' }}>
            À encaisser
          </div>
          <div style={{ fontSize: 34, fontWeight: 620, color: ENCRE, marginTop: 6 }}>142 €</div>
          <div style={{
            height: 5, borderRadius: 3, marginTop: 10, background: PALE, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: `${40 + 60 * Math.abs(Math.sin(frame * 0.06))}%`,
              background: BLEU, borderRadius: 3,
            }} />
          </div>
        </div>
      </div>

      {/* --- le telephone, a droite sur le comptoir --- */}
      <div style={{ position: 'absolute', right: 168, bottom: 130 }}>
        <Telephone entree={plan} sonne={sonne} frame={frame} echelle={0.60} />
      </div>

      {/* compteur d'appels manques, qui monte pendant que ca sonne */}
      <div style={{
        position: 'absolute', right: 138, bottom: 400,
        minWidth: 60, height: 60, padding: '0 14px', borderRadius: 30,
        background: NAVY, color: '#fff',
        fontFamily: MONO, fontSize: 28, fontWeight: 600,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: sonne,
        transform: `scale(${0.6 + 0.4 * monte(frame, tSonne + 2, 10, ressort)})`,
        boxShadow: '0 10px 24px rgba(5,30,72,0.28)',
      }}>
        {Math.min(4, Math.max(1, Math.floor((frame - tSonne) / 16) + 1))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// B · « tu peux pas decrocher · l'appel que tu rates, c'est un groupe qui
//       reserve ailleurs »
// ---------------------------------------------------------------------------

export const IncrustAilleurs: React.FC<Contexte> = (ctx) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const tRate = temps(ctx, 'rates', 1.9, fps);
  const tAilleurs = temps(ctx, 'ailleurs', 3.0, fps);

  // Le decor part DEJA VISIBLE : une rampe qui commence a zero laisse
  // toujours quelques images sous le seuil de visibilite, et la garde d'images
  // plates les comptait a l'ouverture de chaque carton.
  const plan = 0.55 + 0.45 * monte(frame, 0, 10);
  // L'appel sonne, puis s'eteint : c'est l'appel qu'on ne prend pas.
  const sonne = interpolate(frame, [2, 12, tRate - 6, tRate + 2], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const manque = monte(frame, tRate, 10, ressort);
  const partent = monte(frame, tAilleurs - 8, 30, Easing.bezier(0.4, 0, 0.6, 1));

  return (
    <div style={{ position: 'relative', width: 1500, height: 470, margin: '0 auto' }}>
      {/* le telephone, a gauche */}
      <div style={{ position: 'absolute', left: 170, top: 24 }}>
        <Telephone entree={plan} sonne={sonne} frame={frame} echelle={0.7} />
      </div>

      {/* le bandeau « appel manqué » qui vient barrer l'ecran */}
      <div style={{
        position: 'absolute', left: 108, top: 190,
        transform: `rotate(-7deg) scale(${0.8 + 0.2 * manque})`,
        opacity: manque,
        background: NAVY, color: '#fff', borderRadius: 10,
        padding: '14px 22px', fontFamily: MONO, fontSize: 24,
        letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap',
        boxShadow: '0 14px 32px rgba(5,30,72,0.3)',
      }}>
        Appel manqué
      </div>

      {/* le groupe traverse et va reserver ailleurs */}
      {[0, 1, 2].map((k) => {
        const d = Math.max(0, partent - k * 0.06) / (1 - k * 0.06 || 1);
        return (
          <div key={k} style={{
            position: 'absolute', left: 500 + k * 112 + d * 470, bottom: 92,
            opacity: plan * (1 - Math.max(0, (d - 0.86) / 0.14)),
            transform: `translateY(${Math.sin(d * Math.PI * 5 + k) * 6}px)`,
          }}>
            <Silhouette h={172} ton={k === 1 ? '#6b768c' : ATONE}
              marche={d * 3.4} phase={k * 0.37} />
          </div>
        );
      })}

      {/* le planning du concurrent, a droite : la reservation s'y pose */}
      <div style={{
        position: 'absolute', right: 130, bottom: 92, width: 360,
        opacity: plan,
      }}>
        <div style={{
          fontFamily: MONO, fontSize: 17, letterSpacing: '0.1em', color: ATONE,
          textTransform: 'uppercase', marginBottom: 10,
        }}>
          Le centre d’à côté
        </div>
        {/* LES CRENEAUX DU CONCURRENT. Les deux qui ne recoivent rien portent
            quand meme un squelette de contenu : vides, ils se lisaient comme des
            cadres pas finis plutot que comme un planning. */}
        {[0, 1, 2].map((k) => {
          const pris = k === 1;
          const arrive = pris ? monte(frame, tAilleurs + 12, 12, ressort) : 1;
          return (
            <div key={k} style={{
              height: 76, marginBottom: 12, borderRadius: 12,
              background: pris ? PALE : '#fff',
              border: `1px solid ${TRAIT}`,
              borderLeft: `4px solid ${pris ? BLEU : 'rgba(5,30,72,0.13)'}`,
              display: 'flex', alignItems: 'center', padding: '0 18px', gap: 14,
              fontFamily: SANS, fontSize: 20, fontWeight: pris ? 620 : 500,
              color: pris ? ENCRE : 'rgba(5,30,72,0.28)',
              transform: pris ? `translateX(${(1 - arrive) * 90}px) scale(${0.96 + 0.04 * arrive})` : 'none',
              opacity: pris ? arrive : 1,
              boxShadow: pris
                ? `0 ${10 * arrive}px ${24 * arrive}px rgba(5,30,72,0.14)`
                : 'inset 0 1px 0 rgba(255,255,255,0.9)',
            }}>
              {pris ? (
                <>
                  <span style={{
                    fontFamily: MONO, fontSize: 17, letterSpacing: '0.08em',
                    color: BLEU,
                  }}>
                    18:00
                  </span>
                  <span>Groupe de 8</span>
                </>
              ) : (
                <>
                  <div style={{ width: 52, height: 10, borderRadius: 5, background: 'rgba(5,30,72,0.08)' }} />
                  <div style={{ width: 128 + k * 26, height: 12, borderRadius: 6, background: 'rgba(5,30,72,0.06)' }} />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
