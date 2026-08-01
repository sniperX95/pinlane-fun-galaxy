import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, Easing } from 'remotion';
import { AIFL_SHOTS } from '../Main';
import { PageCam, CamKey } from './PageCam';
import layout from '../live-layout.json';
import { T_VERROU, T_MISE_AU_POINT, macro } from '../ouverture';

const SANS = "'Geist', 'Geist Fallback', ui-sans-serif, system-ui, sans-serif";
const MONO = "'Geist Mono', 'Geist Mono Fallback', ui-monospace, SFMono-Regular, monospace";

const INK = '#08111f';
const AMBER = '#0664fe';
const INK2 = '#55617a';

const WORDMARK = 'PINLANE';
const BLEU_HALO = 'rgba(6, 100, 254, 0.20)';
const KICKER = 'LA CONSOLE DE TON CENTRE';

const PAGE_H = layout.projects.pageH;

// --- LA reservation sur laquelle tout le plan d'ouverture se referme ---------
// Elle n'est plus choisie a la main : le script de capture designe celle qui est
// la plus proche du centre de page et ecrit son rang. Le centre compte, parce
// que la camera cadre le point (cx, cy) au milieu de l'image : un heros collé
// au bord fait entrer le hors-page dans le cadre.
const MAIN = layout.projects.heroIndex ?? 3;
const CARD = layout.projects.cards[MAIN];
// CE QUE LA RESERVATION AFFICHE, lu dans le DOM au moment de la capture. La
// scene l'ecrit a l'ecran et la narration le DIT : un seul fait, une seule
// source. Avant, les libelles venaient d'une liste appliquee par rang : de la
// decoration qui avait l'air d'une donnee.
const HERO = layout.projects.hero;
const HIRES = layout.projects.heroHires ?? 'card-hero-hires.png';
const MCX = CARD.x + CARD.w / 2;
const MCY = CARD.y + CARD.h / 2;
const RADIUS = 16;

// Grossissement du gros plan. Deux plafonds : la definition natives du gros
// plan (le script mesure combien de vrais pixels il contient : on reduit
// toujours une image, jamais on ne l'agrandit) et le confort de la TEXTURE de
// page dessous, capturee en densite 2, qui devient molle au-dela de ~1,5x.
// 3,4 n'est pas un chiffre rond choisi au hasard : c'est le plus fort
// grossissement qui laisse encore tenir l'annotation A GAUCHE de la
// reservation. A ce grossissement la moitie de l'image couvre 960/3,4 = 282 px
// de page, donc le cadre va de 616 a 1180 ; la reservation occupe 835 a 1022, il
// reste 219 px a sa gauche. Monter a 4,2 chassait l'annotation hors cadre.
const ZOOM_HERO = Math.min(layout.projects.heroZoomMax ?? 4, 3.4);

// Camera: straight-on full page (52→84, static while the spotlight roves and
// locks), then a 16-frame push-in that swings to a LEFT-SIDE view : rotY
// dominant so the card's left edge reads near and its right edge recedes, with
// only a slight downward tilt (rotX) : until the single card nearly fills the
// frame (84→100), then held to the end (190) with an almost-imperceptible pull.
// The focal page-point sits a touch LEFT of the card centre so the card lands
// slightly right of screen-centre, foregrounding its near (left) edge.
const WIDE_ZOOM = 0.78;
const CAM_KEYS: CamKey[] = [
  { frame: 82, cx: 960, cy: 540, zoom: WIDE_ZOOM, rotX: 0, rotY: 0, rotZ: 0, persp: 1200 },
  // LA VUE LARGE TIENT LE TEMPS QU'IL FAUT POUR EXPLIQUER LE PLANNING. Elle
  // durait 28 images ; c'est maintenant la voix qui decide (voir `ouverture.ts`),
  // et le reste du plan se decale d'un bloc sans qu'aucune courbe ne change.
  { frame: T_VERROU, cx: 960, cy: 540, zoom: WIDE_ZOOM, rotX: 0, rotY: 0, rotZ: 0, persp: 1200 },
  { frame: macro(130), cx: MCX - 30, cy: MCY, zoom: ZOOM_HERO, rotX: 8, rotY: 34, rotZ: 2, persp: 1200 },
  // DERIVE PENDANT LE VOL STATIONNAIRE. La pose etait tenue a l'identique
  // pendant 90 images : trois secondes d'image immobile pendant que la
  // reservation flotte. La camera contourne maintenant lentement la carte
  // (rotY 34 -> 29,5, rotX 8 -> 6,2), ce qui fait vivre le plan entier sans
  // rien changer au rythme du vol ni aux bruitages.
  { frame: AIFL_SHOTS.morning.duration, cx: MCX - 22, cy: MCY + 6, zoom: ZOOM_HERO + 0.06, rotX: 6.2, rotY: 29.5, rotZ: 1.4, persp: 1200 },
];

// Ou se trouve le heros A L'ECRAN dans la vue large ? Le projecteur doit
// verrouiller exactement dessus. La valeur d'origine (50 %, 67 %) etait juste
// pour une carte a y=772 ; la notre est a y=203, le projecteur aurait eclaire
// une zone vide a deux tiers de l'image. On la DERIVE de la meme transformation
// que celle qu'applique la camera : ecran = centre + (page - focale) x zoom.
const LOCK_X = ((960 + (MCX - 960) * WIDE_ZOOM) / 1920) * 100;
const LOCK_Y = ((540 + (MCY - 540) * WIDE_ZOOM) / 1080) * 100;

// L'annotation flottante se pose a GAUCHE de la reservation, au meme decalage
// relatif que dans le template (-225, +52). Ses coordonnees etaient ecrites en
// dur pour une carte a (781, 616) ; laissees telles quelles, elle aurait flotte
// hors du cadre.
const NOTE = { x: CARD.x - 215, y: CARD.y - 16, w: 200 };
const PUSH_EASE = Easing.bezier(0.35, 0, 0.2, 1);

const POP_EASE = Easing.bezier(0.2, 1.25, 0.3, 1); // spring with overshoot
const RESEAT_EASE = Easing.bezier(0.4, 0, 0.3, 1.05); // compress on touchdown
const PATCH = '#ffffff';
const SLOT_AMBER = '#0664fe';
const BEAM_CORE = 'rgba(255, 255, 255, 0.98)';

/** Brand open (0-83): an invisible pen draws an amber crosshair, "AI
 * Foundation Lab" letterpresses in glyph by glyph (all glyphs down by ~46), a mono kicker
 * types itself out, then the finished lockup RESTS fully-on for a second
 * (46-76) before dissolving and handing to the console.
 *
 * Single-card macro (82-220): a warm spotlight roves the dashboard, then locks
 * onto ONE card (pool shrinks, surroundings dim); the camera pushes in and
 * SWINGS to a left-side view (rotY-dominant: left edge near, right edge far)
 * until the card nearly fills the frame, a crisp 4x capture crossfading in over
 * the soft page texture; the card springs up off the plane and hovers ~54f
 * while a beam runs two laps around its rounded outline; then it settles flush
 * back into its slot (lock→touchdown ≈ 3.3s). */
export const SceneOpen: React.FC = () => {
  const frame = useCurrentFrame();
  const duration = AIFL_SHOTS.morning.duration;

  // --- crosshair draw-on (SVG pathLength = 100) ---
  const vDraw = interpolate(frame, [0, 9], [100, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.3, 0, 0.2, 1),
  });
  const hDraw = interpolate(frame, [8, 18], [100, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.linear,
  });
  const crossFade = interpolate(frame, [24, 34], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // --- kicker typewriter (28 -> ~44), 0.7 frames per char ---
  const perChar = 0.7;
  const kickStart = 28;
  const kickChars = Math.floor(Math.max(0, frame - kickStart) / perChar);
  const kickDone = kickStart + KICKER.length * perChar; // ~43.4
  const cursorOn = (() => {
    if (frame < kickStart) return false;
    if (frame < kickDone) return true;
    if (frame > 74) return false; // keep blinking through the 1s rest
    const b = frame - kickDone;
    return Math.floor(b / 2) % 2 === 0;
  })();

  // --- brand group rests fully-on for ~1s (46 -> 76), then dissolves out
  // (76 -> 83): lift + shrink + fade ---
  const brandOut = interpolate(frame, [76, 83], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.4, 0, 0.5, 1),
  });
  const brandOpacity = 1 - brandOut;
  const groupY = -brandOut * 40;
  const groupScale = 1 - brandOut * 0.12;

  // --- macro fades in only after the brand is gone (82 -> 90) ---
  const macroIn = interpolate(frame, [82, 90], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.3, 0, 0.2, 1),
  });

  // --- LA MISE AU POINT, A LA PLACE DU PROJECTEUR ---------------------------
  //
  // Verdict de Movsar sur la version precedente : « le motion ça montre un focus
  // avec reflet, c'est blanc avec un cercle comme un projecteur, mais c'est
  // super moche et mal fait ». Il avait raison sur la cause : deux degrades
  // radiaux blancs qui balayaient la page, plus une vignette. Un degrade radial
  // n'a pas de bord : il fait une TACHE, et une tache sur une capture d'ecran se
  // lit comme un defaut de rendu, pas comme une intention.
  //
  // Ce qui remplace : une SELECTION. Un voile clair couvre la page, perce d'un
  // trou RECTANGULAIRE exactement aux dimensions de la reservation (quatre
  // bandes, donc des aretes nettes), un cadre bleu se trace autour d'elle cote
  // par cote, et une etiquette vient se poser a cote avec ses vraies valeurs.
  // C'est geometrique, c'est aligne sur le produit, et ca dit « celle-là »
  // au lieu de « quelque part par ici ».
  //
  // Tout est en espace ECRAN et non dans la page : la camera est immobile
  // pendant cette phase, et un element pose dans la page serait reduit par le
  // zoom de 0,78 : l'etiquette y serait sortie a 17 px de haut.
  const misePoint = interpolate(frame, [T_MISE_AU_POINT, T_MISE_AU_POINT + 14], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.3, 0, 0.2, 1),
  });
  // Elle s'efface des que la camera part : a partir de la, c'est le gros plan
  // lui-meme qui designe la carte, un cadre par-dessus ferait doublon.
  const misePointOut = interpolate(frame, [T_VERROU - 6, T_VERROU + 8], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const focus = misePoint * (1 - misePointOut);

  // Le trou, en pixels d'ecran. `LOCK_X`/`LOCK_Y` donnent deja le centre de la
  // reservation a l'ecran ; la taille suit le meme zoom que la page.
  const trou = {
    w: CARD.w * WIDE_ZOOM,
    h: CARD.h * WIDE_ZOOM,
    cx: (LOCK_X / 100) * 1920,
    cy: (LOCK_Y / 100) * 1080,
  };
  const marge = 14;
  const cadre = {
    left: trou.cx - trou.w / 2 - marge,
    top: trou.cy - trou.h / 2 - marge,
    width: trou.w + marge * 2,
    height: trou.h + marge * 2,
  };
  // Les quatre cotes se tracent l'un apres l'autre : un cadre qui apparait d'un
  // coup se lit comme un calque, un cadre qui se trace se lit comme un geste.
  const cote = (n: number) => interpolate(
    frame, [T_MISE_AU_POINT + 8 + n * 4, T_MISE_AU_POINT + 8 + n * 4 + 7], [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.3, 0, 0.2, 1) },
  );
  const etiquetteIn = interpolate(
    frame, [T_MISE_AU_POINT + 22, T_MISE_AU_POINT + 34], [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.2, 1.15, 0.3, 1) },
  );

  // --- DOF rises through the push-in, then relaxes to zero while the card
  // hovers (the hero is the only subject and the surround is already dim). ---
  const dofStrength = interpolate(frame, [macro(114), macro(130), macro(140), macro(150)], [0, 9, 9, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // --- hero card pop-up ------------------------------------------------------
  // rise 130→140 (spring overshoot), hover 140→194 (54f sin bob), reseat
  // 194→212 (18f, gentle) : lock(114)→touchdown(212) ≈ 98f ≈ 3.3s.
  const rise = interpolate(frame, [macro(130), macro(140)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: POP_EASE,
  });
  const reseat = interpolate(frame, [macro(194), macro(212)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: RESEAT_EASE,
  });
  const lift = rise * (1 - reseat); // altitude fraction, 0 at rest / reseated
  // slow hover bob over the 54-frame float (period ~40f -> ~1.35 cycles)
  const bob = Math.sin(((frame - macro(140)) / 40) * Math.PI * 2) * 4 * lift;
  const z = 110 * lift + bob;
  const landed = frame >= macro(212);

  // press-bounce on touchdown (0.997 → 1 over the last few reseat frames)
  const press = interpolate(frame, [macro(208), macro(211), macro(212)], [1, 0.997, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // two-layer shadow that grows with altitude
  const shadow = `0 ${8 * lift}px ${10 + 12 * lift}px rgba(5, 30, 72, ${0.18 * lift}), 0 ${46 * lift}px ${90 * lift}px rgba(5, 30, 72, ${0.22 * lift})`;

  // vacated-slot amber outline: alive while airborne, brightens as the card
  // lands, then vanishes.
  const slotVis = Math.min(1, rise * 2) * (1 - reseat);
  const landPulse = interpolate(frame, [macro(208), macro(212), macro(216)], [0, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const slotEdge = Math.min(1, 0.4 * (1 - reseat)) + landPulse * 0.6;

  // --- perimeter beam: TWO laps around the card outline during the hover.
  // Lap 1 (142→156) runs fast and bright; lap 2 (162→182) runs slower and
  // weaker : two laps read as a sustained scan rather than a single blink. A
  // faint amber ring lingers after lap 2 and fades before reseat (182→194). ---
  const beam1Prog = interpolate(frame, [macro(142), macro(156)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.linear,
  });
  const beam1On = frame >= macro(141) && frame <= macro(157);
  const beam2Prog = interpolate(frame, [macro(162), macro(182)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.4, 0, 0.4, 1),
  });
  const beam2On = frame >= macro(161) && frame <= macro(183);
  const beamTrail = interpolate(frame, [macro(182), macro(194)], [0.35, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const bw = CARD.w + 6;
  const bh = CARD.h + 6;

  // --- hi-res hero: a 4x element capture crossfades in as the push-in starts
  // (84→90), covering the soft 2x page texture underneath. It stays on top for
  // the pop-up / hover / reseat so the enlarged card reads crisp. ---
  const hiresIn = interpolate(frame, [macro(114), macro(120)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // --- whole scene dissolves to paper just before the cut -> title card 1 ---
  // Le fondu de sortie ne va pas jusqu'au blanc : termine a 1 pile a `duration`,
  // il laissait quatre images entierement vides avant la coupe. Meme correction
  // que sur les cartons.
  const outT = interpolate(frame, [duration - 4, duration - 1], [0, 0.28], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.5, 0, 0.6, 1),
  });
  const rootOpacity = 1 - outT;

  return (
    <AbsoluteFill style={{ backgroundColor: '#fafafa', opacity: rootOpacity }}>
      {frame >= 84 ? (
        <AbsoluteFill style={{ opacity: macroIn }}>
          <PageCam
            src="textures/live/projects-full.png"
            pageH={PAGE_H}
            keys={CAM_KEYS}
            ease={PUSH_EASE}
            dof={{ focusY: 240, strength: dofStrength }}
          >
            {/* rim light along the near (bottom) edge of the tilted plane */}
            <div
              style={{
                position: 'absolute', left: 0, right: 0, bottom: 0, height: 8,
                background: 'rgba(255,255,255,0.85)', filter: 'blur(6px)',
                opacity: 0.6 * Math.min(1, lift + Math.max(0, (frame - macro(114)) / 16)),
                pointerEvents: 'none',
              }}
            />

            {/* hero card: lifts off its slot, hovers, beam runs, settles back */}
            <div style={{ transformStyle: 'preserve-3d' }}>
              {/* vacated-slot patch + breathing amber outline (only when up) */}
              {slotVis > 0.02 ? (
                <div
                  style={{
                    position: 'absolute', left: CARD.x - 2, top: CARD.y - 2,
                    width: CARD.w + 4, height: CARD.h + 4, background: PATCH,
                    borderRadius: RADIUS,
                    boxShadow: `inset 0 0 26px rgba(6, 100, 254, ${0.12 * slotEdge})`,
                    opacity: slotVis,
                  }}
                >
                  <div
                    style={{
                      position: 'absolute', inset: 0, borderRadius: RADIUS,
                      border: `1.5px solid ${SLOT_AMBER}`, opacity: slotEdge,
                      pointerEvents: 'none',
                    }}
                  />
                </div>
              ) : null}

              {/* the levitating card */}
              <div
                style={{
                  position: 'absolute', left: CARD.x, top: CARD.y,
                  width: CARD.w, height: CARD.h,
                  transform: `translateZ(${z}px) scale(${press})`,
                  transformOrigin: 'center center',
                  transformStyle: 'preserve-3d',
                }}
              >
                {/* card body (clipped) + top-light gradient */}
                <div
                  style={{
                    position: 'absolute', inset: 0, borderRadius: RADIUS,
                    overflow: 'hidden',
                    boxShadow: landed ? 'none' : shadow,
                  }}
                >
                  <Img
                    src={staticFile(`textures/live/${CARD.file}`)}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
                  />
                  {/* 4x hi-res capture layered on top, laid out at plain CARD
                      size. Because PageCam now applies the push-in magnification
                      as a LAYOUT-scale CSS `zoom` (not a transform scale), this
                      image rasterizes at its enlarged device size (~CARD.w*zoom
                      px) and samples DOWN from the 1432px source — crisp — rather
                      than being downsampled to layout size and GPU-upscaled. */}
                  <Img
                    src={staticFile(`textures/live/${HIRES}`)}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      display: 'block',
                      opacity: hiresIn,
                    }}
                  />
                  {/* top-light sheen, like a card lit from above by the spot */}
                  <div
                    style={{
                      position: 'absolute', inset: 0,
                      background: 'linear-gradient(160deg, rgba(255,255,255,0.5), transparent 40%)',
                      opacity: lift, pointerEvents: 'none',
                    }}
                  />
                </div>
                {/* 1px white inner stroke (lit paper edge) */}
                <div
                  style={{
                    position: 'absolute', inset: 0, borderRadius: RADIUS,
                    boxShadow: `inset 0 0 0 1px rgba(255,255,255,${0.7 * lift})`,
                    pointerEvents: 'none',
                  }}
                />

                {/* perimeter beam: SVG rounded-rect, pathLength=1 travelling arc.
                    Lap 1 (fast, bright) then lap 2 (slow, weaker). */}
                {(beam1On || beam2On) && lift > 0.4 ? (
                  <svg
                    width={bw}
                    height={bh}
                    viewBox={`0 0 ${bw} ${bh}`}
                    style={{
                      position: 'absolute', left: -3, top: -3, overflow: 'visible',
                      pointerEvents: 'none',
                      opacity: beam1On ? 1 : 0.62,
                      filter: `drop-shadow(0 0 6px ${AMBER}) drop-shadow(0 0 18px rgba(190, 220, 255, 0.6))`,
                    }}
                  >
                    {/* amber edge (wider) */}
                    <rect
                      x={2} y={2} width={bw - 4} height={bh - 4} rx={RADIUS} fill="none"
                      stroke={AMBER} strokeWidth={beam1On ? 5 : 3.5} strokeLinecap="round"
                      pathLength={1} strokeDasharray="0.14 1" strokeDashoffset={-(beam1On ? beam1Prog : beam2Prog)}
                    />
                    {/* warm-white core (narrower) */}
                    <rect
                      x={2} y={2} width={bw - 4} height={bh - 4} rx={RADIUS} fill="none"
                      stroke={BEAM_CORE} strokeWidth={beam1On ? 2.5 : 1.75} strokeLinecap="round"
                      pathLength={1} strokeDasharray="0.14 1" strokeDashoffset={-(beam1On ? beam1Prog : beam2Prog)}
                    />
                  </svg>
                ) : null}

                {/* faint amber ring left behind, fades out */}
                {beamTrail > 0.01 ? (
                  <div
                    style={{
                      position: 'absolute', inset: -3, borderRadius: RADIUS + 3,
                      border: `1.5px solid ${AMBER}`, opacity: beamTrail,
                      pointerEvents: 'none',
                    }}
                  />
                ) : null}
              </div>
            </div>

            {/* 3D floating annotation LEFT of the hovering card: big serif note
                lifted off the page plane (translateZ), seen through the same
                oblique camera; a marker highlight sweeps under the key words. */}
            {frame >= macro(142) && frame <= macro(212) ? (() => {
              const noteIn = interpolate(frame, [macro(142), macro(152)], [0, 1], {
                extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.2, 0.75, 0.3, 1),
              });
              const noteOut = interpolate(frame, [macro(198), macro(208)], [1, 0], {
                extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
              });
              const noteVis = noteIn * noteOut;
              // gentle bob in sympathy with the card's hover
              const noteZ = 92 + Math.sin(((frame - 142) / 44) * Math.PI * 2) * 3;
              const hl = interpolate(frame, [macro(156), macro(168)], [0, 1], {
                extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.3, 0, 0.2, 1),
              });
              return (
                <div style={{ transformStyle: 'preserve-3d', pointerEvents: 'none' }}>
                  {/* soft shadow the note casts onto the page */}
                  <div
                    style={{
                      position: 'absolute', left: NOTE.x + 10, top: NOTE.y + 68, width: 210, height: 74,
                      transform: 'translateZ(2px)',
                      background: 'radial-gradient(ellipse at 50% 50%, rgba(5, 30, 72, 0.3), transparent 70%)',
                      filter: 'blur(12px)',
                      opacity: 0.55 * noteVis,
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute', left: NOTE.x, top: NOTE.y, width: NOTE.w,
                      transform: `translateZ(${noteZ}px) translateY(${(1 - noteIn) * 26}px)`,
                      opacity: noteVis,
                      filter: `blur(${(1 - noteIn) * 4}px)`,
                      // UNE PLAQUE SOUS LE TEXTE. Le template posait cette note
                      // au-dessus d'une grande carte quasi vide ; ici elle tombe
                      // sur une grille dense de creneaux et le serif noir devenait
                      // illisible. La plaque la detache du fond sans la cacher.
                      background: 'rgba(255, 255, 255, 0.94)',
                      padding: '14px 18px 18px',
                      borderRadius: 10,
                      boxShadow: '0 10px 30px rgba(5, 30, 72, 0.16), 0 2px 6px rgba(5, 30, 72, 0.1)',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: SANS, fontSize: 27, fontWeight: 600, color: INK,
                        lineHeight: 1.16, letterSpacing: '-0.012em',
                      }}
                    >
                      Une résa,
                    </div>
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      {/* marker highlight sweeping in behind the words */}
                      <div
                        style={{
                          position: 'absolute', left: -5, top: '12%', bottom: '4%',
                          width: `calc(${hl} * (100% + 10px))`,
                          background: '#cfe0ff',
                          borderRadius: 4,
                        }}
                      />
                      <div
                        style={{
                          position: 'relative',
                          fontFamily: SANS, fontStyle: 'italic', fontSize: 27, fontWeight: 600,
                          color: INK, lineHeight: 1.16, letterSpacing: '-0.012em',
                        }}
                      >
                        zéro saisie.
                      </div>
                    </div>
                  </div>
                </div>
              );
            })() : null}
          </PageCam>

          {/* LA MISE AU POINT. Quatre bandes de voile qui laissent un trou
              rectangulaire net sur la reservation, un cadre qui se trace, et
              l'etiquette de ses vraies valeurs. */}
          {focus > 0.01 ? (
            <AbsoluteFill style={{ pointerEvents: 'none', opacity: focus }}>
              {/* le voile, perce : quatre rectangles plutot qu'un degrade, donc
                  des aretes franches au lieu d'une tache */}
              {[
                { left: 0, top: 0, width: 1920, height: cadre.top },
                { left: 0, top: cadre.top + cadre.height, width: 1920, height: 1080 - cadre.top - cadre.height },
                { left: 0, top: cadre.top, width: cadre.left, height: cadre.height },
                { left: cadre.left + cadre.width, top: cadre.top, width: 1920 - cadre.left - cadre.width, height: cadre.height },
              ].map((r, i) => (
                <div key={`voile-${i}`} style={{
                  position: 'absolute', ...r,
                  background: 'rgba(250, 250, 250, 0.70)',
                  backdropFilter: 'saturate(0.55)',
                }} />
              ))}
              {/* le cadre, trace cote par cote (haut, droite, bas, gauche) */}
              <div style={{ position: 'absolute', left: cadre.left, top: cadre.top, width: cadre.width, height: cadre.height }}>
                <div style={{ position: 'absolute', left: 0, top: 0, height: 2.5, width: `${cote(0) * 100}%`, background: AMBER }} />
                <div style={{ position: 'absolute', right: 0, top: 0, width: 2.5, height: `${cote(1) * 100}%`, background: AMBER }} />
                <div style={{ position: 'absolute', right: 0, bottom: 0, height: 2.5, width: `${cote(2) * 100}%`, background: AMBER }} />
                <div style={{ position: 'absolute', left: 0, bottom: 0, width: 2.5, height: `${cote(3) * 100}%`, background: AMBER }} />
              </div>
              {/* le trait qui relie le cadre a son etiquette : sans lui, les deux
                  se lisent comme deux calques poses au hasard */}
              <div style={{
                position: 'absolute',
                left: cadre.left + cadre.width,
                top: cadre.top + cadre.height / 2,
                width: 26 * etiquetteIn, height: 1.5,
                background: AMBER, opacity: 0.7,
              }} />
              {/* l'etiquette : ce que la reservation AFFICHE, lu dans le DOM au
                  moment de la capture. La voix dit les memes valeurs. */}
              <div style={{
                position: 'absolute',
                left: cadre.left + cadre.width + 26,
                top: cadre.top + cadre.height / 2,
                transform: `translateY(-50%) translateX(${(1 - etiquetteIn) * -18}px)`,
                opacity: etiquetteIn,
                background: '#fff', borderRadius: 11, borderLeft: `4px solid ${AMBER}`,
                padding: '13px 19px', boxShadow: '0 16px 40px rgba(5, 30, 72, 0.16)',
                whiteSpace: 'nowrap',
              }}>
                <div style={{ fontFamily: MONO, fontSize: 18, letterSpacing: '0.1em', color: AMBER }}>
                  {HERO.plage}
                </div>
                <div style={{ fontFamily: SANS, fontSize: 26, fontWeight: 620, color: INK, marginTop: 5 }}>
                  {HERO.title}
                </div>
                <div style={{ fontFamily: SANS, fontSize: 19, color: INK2, marginTop: 4 }}>
                  {HERO.pax} joueurs · Piste {HERO.piste}
                </div>
              </div>
            </AbsoluteFill>
          ) : null}
        </AbsoluteFill>
      ) : null}

      {/* brand group: crosshair + wordmark + kicker, dissolves out by frame 53 */}
      {brandOpacity > 0 ? (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', pointerEvents: 'none', opacity: brandOpacity }}>
          <div
            style={{
              textAlign: 'center',
              transform: `translateY(${groupY}px) scale(${groupScale})`,
              transformOrigin: 'center center',
            }}
          >
            {/* LE PICTOGRAMME DE LA MARQUE, pas un viseur generique.
                Le template dessinait une croix a la plume : joli mouvement, mais
                aucun rapport avec Pinlane. Le pictogramme entre par un ressort,
                avec un halo bleu qui pulse une fois, puis reste dans le lockup —
                un logo ne disparait pas avant son nom. */}
            <div style={{ position: 'relative', width: 152, height: 140, margin: '0 auto 26px' }}>
              <div
                style={{
                  position: 'absolute', inset: '-30% -30%',
                  background: `radial-gradient(circle, ${BLEU_HALO}, transparent 68%)`,
                  opacity: interpolate(frame, [4, 14, 30], [0, 1, 0.45], {
                    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
                  }),
                }}
              />
              <Img
                src={staticFile('brand/picto.png')}
                style={{
                  position: 'absolute', inset: 0, width: '100%', height: '100%',
                  objectFit: 'contain',
                  opacity: interpolate(frame, [2, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
                  transform: `scale(${interpolate(frame, [2, 16], [0.62, 1], {
                    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: POP_EASE,
                  })})`,
                  filter: `blur(${interpolate(frame, [2, 12], [7, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px)`,
                }}
              />
            </div>

            {/* LE LOCKUP REEL : « PIN » bleu, « LANE » navy, capitales tres
                trackees (.19em) — la construction du logo fourni. Le template
                posait un mot en serif ; ce n'etait pas notre marque. */}
            <div
              style={{
                fontFamily: SANS, fontSize: 124, fontWeight: 620, color: INK,
                letterSpacing: '0.19em', lineHeight: 1, whiteSpace: 'pre',
                display: 'inline-flex', alignItems: 'flex-end',
              }}
            >
              {WORDMARK.split('').map((ch, i) => {
                const delay = 10 + i * 3;
                const t = interpolate(frame, [delay, delay + 12], [0, 1], {
                  extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
                  easing: Easing.bezier(0.2, 0.7, 0.25, 1),
                });
                const glintCenter = delay + 12;
                const glint = interpolate(frame, [glintCenter - 4, glintCenter, glintCenter + 4], [0, 1, 0], {
                  extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
                });
                return (
                  <span
                    key={i}
                    style={{
                      position: 'relative',
                      display: 'inline-block',
                      opacity: t,
                      transform: `scale(${1.6 - 0.6 * t})`,
                      transformOrigin: 'center bottom',
                      color: i < 3 ? AMBER : INK,
                      filter: `blur(${(1 - t) * 6}px)`,
                    }}
                  >
                    {ch === ' ' ? ' ' : ch}
                    <span
                      style={{
                        position: 'absolute',
                        left: '50%',
                        bottom: -6,
                        transform: 'translateX(-50%)',
                        width: `${glint * 100}%`,
                        height: 2,
                        background: AMBER,
                        opacity: glint,
                        borderRadius: 2,
                      }}
                    />
                  </span>
                );
              })}
            </div>

            {/* mono kicker typewriter + amber block cursor */}
            <div
              style={{
                fontFamily: MONO, fontSize: 26, letterSpacing: '0.14em', color: INK2,
                marginTop: 30, textTransform: 'uppercase', height: 30,
                display: 'flex', justifyContent: 'center', alignItems: 'center',
              }}
            >
              <span style={{ whiteSpace: 'pre' }}>{KICKER.slice(0, kickChars)}</span>
              <span
                style={{
                  display: 'inline-block',
                  width: 14,
                  height: 24,
                  marginLeft: 4,
                  background: AMBER,
                  opacity: cursorOn ? 0.85 : 0,
                }}
              />
            </div>
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
