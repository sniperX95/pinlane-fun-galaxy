import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig, Easing } from 'remotion';

// LA SCENE DU COMPTOIR — le probleme joue, il n'est plus decrit.
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

/** Un smartphone vu de trois quarts. `sonne` de 0 a 1 pilote la vibration, les
 *  ondes et l'eclat de l'ecran ; `entree` son apparition. */
const Telephone: React.FC<{ entree: number; sonne: number; frame: number; echelle?: number }> = ({
  entree, sonne, frame, echelle = 1,
}) => {
  // Vibration : deux frequences superposees pour que ca ne batte pas comme un
  // metronome. Un telephone sur un comptoir tressaute, il n'oscille pas.
  const vx = (Math.sin(frame * 1.9) * 2.4 + Math.sin(frame * 3.7) * 1.1) * sonne;
  const vr = (Math.sin(frame * 2.1 + 1) * 1.6) * sonne;
  const L = 214;
  const H = 424;

  return (
    <div style={{
      position: 'relative', width: L * echelle, height: H * echelle,
      perspective: 1100, transformStyle: 'preserve-3d',
      opacity: entree,
    }}>
      {/* ombre portee sur le comptoir : elle s'ecarte quand l'appareil tressaute */}
      <div style={{
        position: 'absolute', left: '50%', bottom: -26 * echelle,
        width: L * 1.15 * echelle, height: 42 * echelle,
        transform: `translateX(calc(-50% + ${vx * 0.6}px))`,
        background: 'radial-gradient(ellipse at 50% 50%, rgba(5, 30, 72, 0.28), transparent 70%)',
        filter: 'blur(9px)',
        opacity: 0.7 * entree,
      }} />

      {/* ondes d'appel : elles epousent la forme du telephone, pas des cercles */}
      {[0, 1, 2].map((k) => {
        const cycle = 26;
        const p = ((frame + k * 9) % cycle) / cycle;
        return (
          <div key={k} style={{
            position: 'absolute', left: '50%', top: '50%',
            width: (L + 40 + p * 260) * echelle, height: (H * 0.55 + 40 + p * 260) * echelle,
            transform: 'translate(-50%, -50%)',
            border: `${3 * echelle}px solid ${BLEU}`,
            borderRadius: 999,
            opacity: (1 - p) * 0.55 * sonne,
          }} />
        );
      })}

      {/* corps */}
      <div style={{
        position: 'absolute', inset: 0,
        transform: `rotateY(-21deg) rotateX(7deg) rotateZ(${-5 + vr}deg) translateX(${vx}px)`,
        transformStyle: 'preserve-3d',
        borderRadius: 34 * echelle,
        background: 'linear-gradient(148deg, #16233d 0%, #0b1526 46%, #05101f 100%)',
        boxShadow: `inset 0 0 0 ${1.6 * echelle}px rgba(255,255,255,0.14),`
          + ` inset 0 ${2 * echelle}px 0 rgba(255,255,255,0.10),`
          + ` 0 ${26 * echelle}px ${52 * echelle}px rgba(5, 30, 72, 0.34)`,
      }}>
        {/* ecran */}
        <div style={{
          position: 'absolute', inset: 9 * echelle, borderRadius: 27 * echelle,
          background: `linear-gradient(158deg, ${BLEU_CLAIR} 0%, ${BLEU} 42%, #0b3ea8 100%)`,
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'space-between',
          padding: `${34 * echelle}px ${16 * echelle}px ${26 * echelle}px`,
          boxSizing: 'border-box',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: MONO, fontSize: 15 * echelle, letterSpacing: '0.16em',
              color: 'rgba(255,255,255,0.72)', textTransform: 'uppercase',
            }}>
              Appel entrant
            </div>
            <div style={{
              fontFamily: SANS, fontSize: 27 * echelle, fontWeight: 620, color: '#fff',
              marginTop: 8 * echelle, whiteSpace: 'nowrap',
            }}>
              06 12 34 …
            </div>
          </div>

          {/* les deux boutons : cercles blancs, l'un incline pour « raccrocher ».
              Pas de vert/rouge — le film tient sur deux couleurs de marque. */}
          <div style={{ display: 'flex', gap: 26 * echelle }}>
            {[0, 1].map((k) => (
              <div key={k} style={{
                width: 52 * echelle, height: 52 * echelle, borderRadius: '50%',
                background: k === 0 ? '#fff' : 'rgba(255,255,255,0.22)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: k === 0 ? `0 ${6 * echelle}px ${14 * echelle}px rgba(0,0,0,0.22)` : 'none',
                transform: `scale(${k === 0 ? 1 + 0.06 * Math.sin(frame * 0.5) * sonne : 1})`,
              }}>
                <svg width={26 * echelle} height={26 * echelle} viewBox="0 0 24 24"
                  style={{ transform: k === 1 ? 'rotate(134deg)' : 'none' }}>
                  <path
                    d="M6.6 10.8c1.2 2.4 3.2 4.4 5.6 5.6l2.1-2.1c.3-.3.7-.4 1.1-.2 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V19c0 .6-.4 1-1 1C10.5 20 4 13.5 4 5.4c0-.6.4-1 1-1h3.3c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.2 1.1l-2.1 2.1z"
                    fill={k === 0 ? BLEU : '#fff'}
                  />
                </svg>
              </div>
            ))}
          </div>

          {/* reflet : une bande diagonale qui glisse lentement */}
          <div style={{
            position: 'absolute', inset: -40 * echelle,
            background: 'linear-gradient(118deg, transparent 38%, rgba(255,255,255,0.20) 47%,'
              + ' rgba(255,255,255,0.06) 53%, transparent 62%)',
            transform: `translateX(${((frame * 0.7) % 320) - 160}px)`,
            pointerEvents: 'none',
          }} />
        </div>
      </div>
    </div>
  );
};

/** Une silhouette de client qui attend. */
const Client: React.FC<{ h?: number; ton?: string; impatience?: number }> = ({
  h = 150, ton = ATONE, impatience = 0,
}) => (
  <svg width={h * 0.62} height={h} viewBox="0 0 62 150" style={{ display: 'block' }}>
    <circle cx={31} cy={26 + impatience} r={21} fill={ton} />
    <path d={`M2 150 C2 96, 15 74, 31 74 C47 74, 60 96, 60 150 Z`} fill={ton} />
  </svg>
);

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
  const plan = monte(frame, 2, 14);
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
            <Client h={186 + (k % 2) * 22} ton={k === 1 ? '#6b768c' : ATONE} />
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

  const plan = monte(frame, 2, 12);
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
            position: 'absolute', left: 520 + k * 96 + d * 470, bottom: 96,
            opacity: plan * (1 - Math.max(0, (d - 0.86) / 0.14)),
            transform: `translateY(${Math.sin(d * Math.PI * 5 + k) * 6}px)`,
          }}>
            <Client h={138} ton={k === 1 ? '#6b768c' : ATONE} />
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
        {[0, 1, 2].map((k) => {
          const pris = k === 1;
          const arrive = pris ? monte(frame, tAilleurs + 12, 12, ressort) : 1;
          return (
            <div key={k} style={{
              height: 74, marginBottom: 10, borderRadius: 10,
              background: pris ? PALE : '#fff',
              border: `1px solid ${TRAIT}`,
              borderLeft: `4px solid ${pris ? BLEU : 'rgba(5,30,72,0.15)'}`,
              display: 'flex', alignItems: 'center', padding: '0 18px',
              fontFamily: SANS, fontSize: 20, fontWeight: pris ? 620 : 500,
              color: pris ? ENCRE : 'rgba(5,30,72,0.28)',
              transform: pris ? `translateX(${(1 - arrive) * 90}px)` : 'none',
              opacity: pris ? arrive : 1,
              boxShadow: pris ? `0 ${8 * arrive}px ${20 * arrive}px rgba(5,30,72,0.12)` : 'none',
            }}>
              {pris ? 'Groupe de 8 · 18:00' : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
};
