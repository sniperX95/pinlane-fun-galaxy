import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, Easing } from 'remotion';
import { PageCam, CamKey } from './PageCam';
import { AIFL_SHOTS } from '../Main';
import layout from '../live-layout.json';

const SANS = "'Geist', 'Geist Fallback', ui-sans-serif, system-ui, sans-serif";
const MONO = "'Geist Mono', 'Geist Mono Fallback', ui-monospace, SFMono-Regular, monospace";
const LETTERS = 'PINLANE'.split('');
const PAGE_H = layout.projects.pageH;
const WBR_PAGE_H = layout.wbr.pageH;

// real overshoot on landing (the old bezier(0.25,0.9,0.3,1) never crossed 1)
const FLY_EASE = Easing.bezier(0.34, 1.4, 0.44, 1);
const CRANE_EASE = Easing.bezier(0.3, 0, 0.2, 1);

/** One member of the group photo: a page element flying in from off-screen
 * to its settled pose around the wordmark. Sizes are 1x CSS px (textures 2x). */
type FlyEl = {
  key: string;
  file: string;
  w: number;
  h: number;
  cx: number;
  cy: number;
  scale: number;
  rot: number; // settled rotation, deg
  dx: number; // fly-in start offset
  dy: number;
  radius: number;
  cue: number; // scene frame the 12f flight starts
  wbrCrop?: boolean; // element I: crop out of wbr-full.png as a background
};

// LA COMPOSITION EST CONSERVEE, LES PROPORTIONS VIENNENT DES IMAGES.
//
// Les neuf poses portaient des dimensions ecrites en dur (cartes 358x312,
// panneaux 1104x225…). Nos elements ont d'autres proportions : gardees telles
// quelles, chaque image aurait ete etiree. On ne conserve donc de la pose que
// la LARGEUR VOULUE A L'ECRAN (largeur d'origine x son echelle), et la hauteur
// suit le rapport reel de l'image, lu dans le layout au moment de la capture.
const TAILLES = (layout as { assets?: Record<string, { w: number; h: number; px?: number }> }).assets ?? {};

// La fenetre de recadrage dans la page du tableau de bord : l'en-tete du premier
// bloc releve. L'offset d'origine (-576, -173) visait le titre d'un document qui
// n'existe pas ici.
const WBR_CROP = (() => {
  const b = layout.wbr.blocks[0] ?? { x: 0, y: 267, w: 685, h: 316 };
  return { x: b.x, y: b.y, w: Math.min(b.w, 700), h: 54 };
})();
const pose = (
  p: Omit<FlyEl, 'w' | 'h' | 'scale'> & { largeurEcran: number; replis: { w: number; h: number } },
): FlyEl => {
  const a = TAILLES[p.file] ?? p.replis;
  // PLAFOND DE DEFINITION NATIVE : une decoupe ne s'affiche jamais plus large
  // qu'elle ne contient de pixels reels. Sans ce plafond, l'en-tete du planning
  // (538 px) etait etale sur 1190 px — 4,4x d'agrandissement, mou et
  // surdimensionne au milieu d'elements nets.
  const natif = ('px' in a && a.px) ? a.px : a.w * 2;
  return { ...p, w: a.w, h: a.h, scale: Math.min(p.largeurEcran, natif) / a.w };
};

// ordre de rendu = ordre des entrees, donc les derniers arrivent au-dessus
const ELS: FlyEl[] = [
  pose({ key: 'nav', file: 'nav.png', largeurEcran: 1190, replis: { w: 1920, h: 61 }, cx: 960, cy: 84, rot: 0, dx: 0, dy: -120, radius: 10, cue: 4 }),
  pose({ key: 'hero', file: layout.projects.heroHires ?? 'card-hero-hires.png', largeurEcran: 470, replis: { w: 358, h: 312 }, cx: 300, cy: 400, rot: -5, dx: -500, dy: 0, radius: 12, cue: 7 }),
  pose({ key: 'card1', file: 'card1.png', largeurEcran: 430, replis: { w: 358, h: 288 }, cx: 1630, cy: 380, rot: 4, dx: 500, dy: 0, radius: 12, cue: 10 }),
  // Descendu de 730 a 838 : a 730 il passait devant la baseline
  // « LA CONSOLE DE TON CENTRE » et en cachait le dernier mot.
  pose({ key: 'paper1', file: 'paper1.png', largeurEcran: 552, replis: { w: 1104, h: 225 }, cx: 1500, cy: 838, rot: -3, dx: 450, dy: 260, radius: 12, cue: 13 }),
  pose({ key: 'card7', file: 'card7.png', largeurEcran: 400, replis: { w: 358, h: 312 }, cx: 260, cy: 800, rot: 3, dx: -400, dy: 300, radius: 12, cue: 16 }),
  pose({ key: 'paper3', file: 'paper3.png', largeurEcran: 530, replis: { w: 1104, h: 225 }, cx: 620, cy: 930, rot: 2, dx: 0, dy: 320, radius: 12, cue: 19 }),
  pose({ key: 'search', file: 'float-search.png', largeurEcran: 420, replis: { w: 1016, h: 44 }, cx: 760, cy: 180, rot: -1.5, dx: 0, dy: -240, radius: 10, cue: 22 }),
  pose({ key: 'stats', file: 'float-stats.png', largeurEcran: 283, replis: { w: 315, h: 56 }, cx: 1560, cy: 950, rot: -2, dx: 380, dy: 0, radius: 10, cue: 25 }),
  // Ce dernier element n'est pas une decoupe mais un RECADRAGE dans la page du
  // tableau de bord : ses dimensions sont celles de la fenetre de recadrage, pas
  // celles du fichier. Elles suivent le premier bloc releve sur cette page.
  {
    key: 'wbr', file: 'wbr-full.png', w: WBR_CROP.w, h: WBR_CROP.h,
    scale: 550 / WBR_CROP.w, cx: 1620, cy: 170, rot: 2.5, dx: 360, dy: -200,
    radius: 8, cue: 28, wbrCrop: true,
  },
];

// 20 gold dust motes, all parameters index-derived (deterministic)
const DUST = Array.from({ length: 20 }, (_, i) => ({
  x: (i * 439 + 137) % 1920,
  y0: (i * 613 + 271) % 1080,
  rise: 0.3 + (i % 5) * 0.11, // px/frame upward
  swayAmp: 9 + (i % 4) * 5,
  swayFreq: 0.022 + (i % 3) * 0.008,
  phase: (i * 0.83) % (Math.PI * 2),
  size: 2 + (i % 3) * 0.5, // 2–3px
  opacity: 0.15 + ((i * 7) % 5) * 0.05, // 0.15–0.35
}));

/** Sign-off reworked as a "group photo": core elements from every page fly in
 * from off-screen in staggered beats and settle in an arc around the center;
 * then the letterpressed "AI Foundation Lab" wordmark appears while the assembled
 * elements recede slightly into the background — teammates in the back row.
 * Launch-event treatment: a crane-in camera on the whole photo layer, ghost
 * trails + landing glows on the fly-ins, a stage light behind the wordmark,
 * gold dust and a single opening light sweep for atmosphere. */
export const SceneOutroLive: React.FC = () => {
  const frame = useCurrentFrame();
  const duration = AIFL_SHOTS.outro.duration; // 115

  const blur = interpolate(frame, [0, 24], [0, 14], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.4, 0, 0.4, 1),
  });
  const rule = interpolate(frame, [58, 70], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.3, 0, 0.2, 1),
  });
  const tag = interpolate(frame, [68, 80], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(frame, [duration - 12, duration], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // as the wordmark takes the stage (42–50) the assembled elements step back
  const recede = interpolate(frame, [42, 50], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // ---- camera crane on the whole group-photo layer (wordmark stays outside) ----
  // 0–40: crane down from a slight top angle onto the stage; 40–end: keep breathing in
  const craneT = interpolate(frame, [0, 40], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: CRANE_EASE,
  });
  const pushT = interpolate(frame, [40, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const camScale = 1.06 - 0.06 * craneT + 0.035 * pushT;
  const camTilt = 4 * (1 - craneT); // rotateX deg

  // opening light sweep: one wide, faint warm band crossing the screen, 2–14
  const sweepX = interpolate(frame, [2, 14], [-700, 2020], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.4, 0, 0.6, 1),
  });
  const sweepOpacity = interpolate(frame, [2, 5, 11, 14], [0, 0.12, 0.12, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // stage light behind the wordmark: 0 → 0.5 → 0.25 across 42–58
  const stageLight = interpolate(frame, [42, 50, 58], [0, 0.5, 0.25], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // closing vignette focuses the center from the wordmark beat on
  const vignette = interpolate(frame, [42, 54], [0, 0.1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // rule extension lines: shoot out to ±320px (58–66), then fade over 6 frames
  const ruleExt = interpolate(frame, [58, 66], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.3, 0, 0.2, 1),
  });
  const ruleExtFade = interpolate(frame, [66, 72], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // one breath of letter-spacing once the wordmark is fully set (62–66)
  const wordSpacing = interpolate(frame, [62, 66], [-0.01, 0.005], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.3, 0, 0.2, 1),
  });

  const CAM: CamKey[] = [{ frame: 0, cx: 960, cy: 700, zoom: 0.75 }];

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      {/* ---- group-photo layer under a slow crane-in camera ---- */}
      <AbsoluteFill
        style={{
          transform: `perspective(1400px) rotateX(${camTilt}deg) scale(${camScale})`,
          transformOrigin: '50% 45%',
        }}
      >
        <PageCam src="textures/live/projects-full.png" pageH={PAGE_H} keys={CAM} blur={blur} saturate={0.9} />
        {/* warm scrim under the flying elements: keeps the center legible without washing them */}
        <AbsoluteFill style={{ background: 'radial-gradient(1200px 800px at 50% 48%, rgba(250,247,242,0.82), rgba(250,247,242,0.55) 60%, rgba(250,247,242,0.35))', pointerEvents: 'none' }} />

        {/* group photo: elements fly in from all sides and settle around the wordmark */}
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
          {ELS.map((el) => {
            if (frame < el.cue) return null;

            const t = interpolate(frame, [el.cue, el.cue + 12], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: FLY_EASE,
            });
            const opacity = interpolate(frame, [el.cue, el.cue + 3], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });

            const x = el.dx * (1 - t);
            const y = el.dy * (1 - t);
            const rot = el.rot * (2 - t); // rot×2 in flight → rot settled
            const scale = el.scale * (1.12 - 0.12 * t);

            // shadow: big and soft while airborne, tightening to a dual layer at rest
            const air = Math.max(0, 1 - t);
            const shadow =
              air > 0.01
                ? `0 ${10 + 26 * air}px ${24 + 46 * air}px rgba(5, 30, 72, ${0.16 + 0.1 * air}), 0 2px 6px rgba(30,25,18,.08)`
                : '0 10px 24px rgba(30,25,18,.16), 0 2px 6px rgba(30,25,18,.08)';

            const settledOpacity = opacity * (1 - 0.12 * recede);
            const saturate = 1 - 0.08 * recede;

            const texture = el.wbrCrop
              ? {
                  background: `#fff url(${staticFile(`textures/live/${el.file}`)}) -${WBR_CROP.x}px -${WBR_CROP.y}px / 1920px ${WBR_PAGE_H}px no-repeat`,
                  border: '1px solid rgba(5, 30, 72, 0.10)',
                }
              : null;

            // ghost trail while airborne: a blurred faint copy lagging 8% along the path
            const linT = interpolate(frame, [el.cue, el.cue + 12], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            const showGhost = linT > 0.05 && linT < 0.95;

            // landing glow: an amber spot blooming at the bbox center as the element sets
            const glow = interpolate(frame, [el.cue + 12, el.cue + 18], [0.35, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            const showGlow = frame >= el.cue + 12 && frame < el.cue + 18;
            const glowR = el.w * el.scale * 0.5;

            return (
              <div key={el.key}>
                {showGhost ? (
                  <div
                    style={{
                      position: 'absolute',
                      left: el.cx - el.w / 2,
                      top: el.cy - el.h / 2,
                      width: el.w,
                      height: el.h,
                      transform: `translate(${x + el.dx * 0.08}px, ${y + el.dy * 0.08}px) rotate(${rot}deg) scale(${scale})`,
                      transformOrigin: 'center center',
                      borderRadius: el.radius,
                      overflow: 'hidden',
                      opacity: 0.2 * Math.max(0, 1 - linT),
                      filter: 'blur(8px)',
                      ...texture,
                    }}
                  >
                    {el.wbrCrop ? null : (
                      <Img
                        src={staticFile(`textures/live/${el.file}`)}
                        style={{ position: 'absolute', inset: 0, width: el.w, height: el.h, display: 'block' }}
                      />
                    )}
                  </div>
                ) : null}
                <div
                  style={{
                    position: 'absolute',
                    left: el.cx - el.w / 2,
                    top: el.cy - el.h / 2,
                    width: el.w,
                    height: el.h,
                    transform: `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${scale})`,
                    transformOrigin: 'center center',
                    borderRadius: el.radius,
                    overflow: 'hidden',
                    boxShadow: shadow,
                    opacity: settledOpacity,
                    filter: `saturate(${saturate})`,
                    ...texture,
                  }}
                >
                  {el.wbrCrop ? null : (
                    <Img
                      src={staticFile(`textures/live/${el.file}`)}
                      style={{ position: 'absolute', inset: 0, width: el.w, height: el.h, display: 'block' }}
                    />
                  )}
                </div>
                {showGlow ? (
                  <div
                    style={{
                      position: 'absolute',
                      left: el.cx - glowR,
                      top: el.cy - glowR,
                      width: glowR * 2,
                      height: glowR * 2,
                      borderRadius: '50%',
                      background: 'radial-gradient(circle, rgba(30, 116, 254, 0.9), rgba(30, 116, 254, 0) 70%)',
                      opacity: glow,
                      mixBlendMode: 'multiply',
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </AbsoluteFill>
      </AbsoluteFill>

      {/* ---- atmosphere: gold dust drifting up in front of the group photo ---- */}
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        {DUST.map((d, i) => {
          const y = (((d.y0 - frame * d.rise) % 1080) + 1080) % 1080;
          const x = d.x + Math.sin(frame * d.swayFreq + d.phase) * d.swayAmp;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: d.size,
                height: d.size,
                borderRadius: '50%',
                background: '#1e74fe',
                opacity: d.opacity,
              }}
            />
          );
        })}
      </AbsoluteFill>

      {/* opening light sweep: one wide, faint warm band left → right (2–14) */}
      {sweepOpacity > 0 ? (
        <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'overlay' }}>
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: sweepX - 300,
              width: 600,
              background: 'linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(255, 255, 255, 1) 50%, rgba(255, 255, 255, 0))',
              opacity: sweepOpacity,
            }}
          />
        </AbsoluteFill>
      ) : null}

      {/* stage light behind the wordmark: warm top-light pooling where the logo lands */}
      {stageLight > 0 ? (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            background: 'radial-gradient(700px 360px at 960px 470px, rgba(255, 255, 255, 0.96), rgba(226, 238, 255, 0.4) 55%, rgba(226, 238, 255, 0) 75%)',
            opacity: stageLight,
          }}
        />
      ) : null}

      {/* closing vignette: faint warm-brown corners focus the center */}
      {vignette > 0 ? (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            background: 'radial-gradient(1400px 900px at 50% 50%, rgba(5, 30, 72, 0) 55%, rgba(5, 30, 72, 0.55) 100%)',
            opacity: vignette,
          }}
        />
      ) : null}

      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', pointerEvents: 'none' }}>
        <div style={{ textAlign: 'center' }}>
          {/* Le pictogramme de la marque au-dessus du mot : c'est le lockup
              fourni, pas un mot pose seul. */}
          <div style={{ position: 'relative', width: 112, height: 103, margin: '0 auto 28px', opacity: tag }}>
            <Img
              src={staticFile('brand/picto.png')}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </div>
          {/* « PIN » bleu, « LANE » navy, capitales trackees a .19em : la
              construction exacte du logo. Le template posait un mot en serif. */}
          <div style={{ fontFamily: SANS, fontSize: 128, fontWeight: 620, color: '#08111f', letterSpacing: `${0.19 + wordSpacing}em`, display: 'flex' }}>
            {LETTERS.map((ch, i) => {
              const delay = Math.round(42 + i * 1.8);
              const t = interpolate(frame, [delay, delay + 8], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
                easing: Easing.bezier(0.2, 0.75, 0.3, 1),
              });
              return (
                <span
                  key={i}
                  style={{
                    opacity: t,
                    transform: `translateY(${(1 - t) * 28}px) scale(${1.35 - 0.35 * t})`,
                    filter: `blur(${(1 - t) * 8}px)`,
                    display: 'inline-block',
                    whiteSpace: 'pre',
                    color: i < 3 ? '#0664fe' : undefined,
                  }}
                >
                  {ch}
                </span>
              );
            })}
          </div>
          <div style={{ position: 'relative', height: 6, width: 260, margin: '34px auto 0' }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: 3, background: '#0664fe', transform: `scaleX(${rule})` }} />
            {/* launch lower-third: 1px amber lines shooting out from the rule ends, then fading */}
            {ruleExt > 0 && ruleExtFade > 0 ? (
              <>
                <div style={{ position: 'absolute', top: 2.5, height: 1, right: '100%', width: 190 * ruleExt, background: '#0664fe', opacity: ruleExtFade }} />
                <div style={{ position: 'absolute', top: 2.5, height: 1, left: '100%', width: 190 * ruleExt, background: '#0664fe', opacity: ruleExtFade }} />
              </>
            ) : null}
          </div>
          <div style={{ fontFamily: MONO, fontSize: 25, letterSpacing: '0.14em', color: '#55617a', marginTop: 30, opacity: tag, textTransform: 'uppercase' }}>
            La console de ton centre
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
