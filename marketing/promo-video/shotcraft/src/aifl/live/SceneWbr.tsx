import { interpolate, useCurrentFrame, Easing } from 'remotion';
import { PageCam, CamKey } from './PageCam';
import layout from '../live-layout.json';

type Block = { x: number; y: number; w: number; h: number; tag: string };
const blocks = layout.wbr.blocks as Block[];
const leftRail = layout.wbr.leftRail;
const rightRail = layout.wbr.rightRail;
const PAGE_H = layout.wbr.pageH;

const MONO = "'Geist Mono', 'Geist Mono Fallback', ui-monospace, SFMono-Regular, monospace";
const PAPER = '#ffffff';
const AMBER = '#0664fe';
const AMBER_WASH = '#e8f0ff';

// editor-title close-up → ease out to the whole page (both rails on camera)
// → tiny breathing hold.
const CAM_KEYS: CamKey[] = [
  { frame: 0, cx: 920, cy: 280, zoom: 1.25 },
  { frame: 22, cx: 920, cy: 310, zoom: 1.21 }, // slow push while the title writes in
  { frame: 64, cx: 960, cy: 540, zoom: 0.997 }, // whole page, rails fully in frame
  { frame: 78, cx: 960, cy: 540, zoom: 1.003 }, // micro-breath
  { frame: 102, cx: 960, cy: 540, zoom: 0.995 }, // exhale — whole-page reading hold
];

const REVEAL_EASE = Easing.bezier(0.4, 0, 0.6, 1);

// 20 content blocks would overshoot the 70-frame reveal budget one-by-one, so
// blocks are revealed two at a time: pair g starts at 6 + g*3.5, 8 frames each
// (last pair done by ~49, well before the frame-64 full-page settle).
const cueFor = (i: number) => 6 + Math.floor(i / 2) * 3.5;
const WIPE = 8;

// ---- past weeks stack into the left rail: the captured texture only holds
// the live W28 entry, so W27…W22 drop in from above one after another (list
// stacking, same vocabulary as the papers shot), landing below it. ----
const SANS = "'Geist', 'Geist Fallback', ui-sans-serif, system-ui, sans-serif";
// Les jours precedents qui viennent s'empiler dans la colonne. Le template
// livrait ici des libelles EN CHINOIS (« 2026 第 27 周 ») et des titres anglais :
// ils s'affichent a l'ecran vers la 28e seconde, et personne ne les avait vus
// parce que ce plan n'avait ete controle qu'a son debut. Un plan se verifie sur
// toute sa duree, pas sur sa premiere image.
const PAST_WEEKS = [
  { week: 'Hier', date: 'Mer. 29', title: 'Journée du 29 juillet' },
  { week: 'Mardi', date: 'Mar. 28', title: 'Journée du 28 juillet' },
  { week: 'Lundi', date: 'Lun. 27', title: 'Journée du 27 juillet' },
  { week: 'Dimanche', date: 'Dim. 26', title: 'Journée du 26 juillet' },
  { week: 'Samedi', date: 'Sam. 25', title: 'Journée du 25 juillet' },
  { week: 'Vendredi', date: 'Ven. 24', title: 'Journée du 24 juillet' },
];
// Les quatre indicateurs du haut du tableau de bord, releves a la capture.
// Ils s'allument sur les temps 65, 70, 75, 80 — soit exactement les quatre
// premiers « pop » de la table de bruitages (frames absolues 840, 845, 850, 855
// moins l'origine du plan, 775).
const KPIS = (layout.wbr as { kpis?: { x: number; y: number; w: number; h: number }[] }).kpis ?? [];
const KPI_CUE = (i: number) => 65 + i * 5;
const WEEK_DROP = Easing.bezier(0.2, 1.15, 0.3, 1); // drop with a light bounce

// member-name headings (tag=h2) get the @-mention amber wash; the pinned
// "Jackie's Download" digest heading (the first h2) is not a member name.
const memberH2 = new Set<number>();
{
  let seenH2 = 0;
  blocks.forEach((b, i) => {
    if (b.tag === 'h2' && seenH2++ > 0) memberH2.add(i);
  });
}

/** Weekly brief: the full report is "written" in block by block (paper mask
 * wipes left→right behind an amber caret), member names get an @-mention amber
 * wash, then the week list (left) and comment sidebar (right) wipe on stage —
 * the whole page, both rails included, settles into frame. */
export const SceneWbr: React.FC = () => {
  const frame = useCurrentFrame();

  // screen-space kicker stamps in
  const kick = interpolate(frame, [8, 16], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // caret follows only the newest block still being written
  let caretIdx = -1;
  blocks.forEach((_, i) => {
    if (frame >= cueFor(i) && frame <= cueFor(i) + WIPE + 2) caretIdx = i;
  });

  return (
    <>
      <PageCam src="textures/live/wbr-full.png" pageH={PAGE_H} keys={CAM_KEYS} ease={Easing.bezier(0.33, 0, 0.15, 1)}>
        {blocks.map((p, i) => {
          const cue = cueFor(i);
          // paper cover wipes away left→right (anchored right, width 100%→0)
          const coverT = interpolate(frame, [cue, cue + WIPE], [1, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: REVEAL_EASE,
          });
          // li boxes exclude their ::marker dot (drawn ~22px left of the text),
          // so bullet covers extend left to hide the dot until the wipe.
          const bx = p.tag === 'li' ? p.x - 28 : p.x - 4;
          const by = p.y - 3;
          const bw = p.w + (p.tag === 'li' ? 34 : 10);
          const bh = p.h + 6;

          // caret rides the reveal front edge (left edge of the cover)
          const caretX = bx + bw * (1 - coverT);
          const caretH = Math.min(20, p.h - 2);

          // member-name @-mention wash, 4 frames after the wipe completes,
          // sized to the heading's true text width
          const nameCue = cue + WIPE + 4;
          const nameGrow = memberH2.has(i)
            ? interpolate(frame, [nameCue, nameCue + 8], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
                easing: Easing.bezier(0.3, 0, 0.2, 1),
              })
            : 0;

          return (
            <div key={i}>
              {/* @-mention wash on the member name (under the cover) */}
              {nameGrow > 0 ? (
                <div
                  style={{
                    position: 'absolute',
                    left: p.x - 3,
                    top: p.y - 1,
                    width: (p.w + 8) * nameGrow,
                    height: p.h + 2,
                    background: AMBER_WASH,
                    opacity: 0.7,
                    borderRadius: 3,
                    pointerEvents: 'none',
                  }}
                />
              ) : null}

              {/* paper cover that wipes off to reveal the "written" text */}
              {coverT > 0 ? (
                <div
                  style={{
                    position: 'absolute',
                    left: bx,
                    top: by,
                    width: bw,
                    height: bh,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 0,
                      bottom: 0,
                      width: `${coverT * 100}%`,
                      background: PAPER,
                    }}
                  />
                </div>
              ) : null}

              {/* amber caret at the writing front — newest block only */}
              {i === caretIdx ? (
                <div
                  style={{
                    position: 'absolute',
                    left: caretX,
                    top: p.y + (p.h - caretH) / 2,
                    width: 2,
                    height: caretH,
                    background: AMBER,
                    opacity:
                      coverT > 0
                        ? 1
                        : interpolate(frame, [cue + WIPE, cue + WIPE + 2], [1, 0], {
                            extrapolateLeft: 'clamp',
                            extrapolateRight: 'clamp',
                          }),
                    pointerEvents: 'none',
                  }}
                />
              ) : null}
            </div>
          );
        })}

        {/* side-rail entrances: each rail hides under a paper patch, then wipes
            on top→bottom while its inner edge lights up amber and fades. */}
        {[
          { rail: leftRail, cue: 46, inner: 'right' as const },
          { rail: rightRail, cue: 54, inner: 'left' as const },
        ].map(({ rail, cue, inner }, i) => {
          const t = interpolate(frame, [cue, cue + 10], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.bezier(0.3, 0, 0.2, 1),
          });
          const lineFade = interpolate(frame, [cue + 10, cue + 24], [1, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <div key={`rail${i}`}>
              {/* paper patch shrinking downward = rail revealed top→bottom */}
              {t < 1 ? (
                <div
                  style={{
                    position: 'absolute',
                    left: rail.x,
                    top: rail.y + rail.h * t,
                    width: rail.w,
                    height: rail.h * (1 - t),
                    background: PAPER,
                    pointerEvents: 'none',
                  }}
                />
              ) : null}
              {/* inner-edge amber line: grows with the wipe, then fades */}
              {frame >= cue && lineFade > 0 ? (
                <div
                  style={{
                    position: 'absolute',
                    left: inner === 'right' ? rail.x + rail.w - 1.5 : rail.x,
                    top: rail.y,
                    width: 1.5,
                    height: rail.h * t,
                    background: AMBER,
                    opacity: lineFade,
                    pointerEvents: 'none',
                  }}
                />
              ) : null}
            </div>
          );
        })}
        {/* LES QUATRE CHIFFRES DU JOUR S'ALLUMENT UN PAR UN.

            Ce que le template faisait ici : empiler des « semaines passees » dans
            une colonne laterale. Notre tableau de bord n'a pas de colonne libre —
            ces cartes atterrissaient sur un panneau blanc qui RECOUVRAIT le
            graphique d'affluence. Le mecanisme ne s'applique pas a cette page.

            Ce qu'il devient : les quatre indicateurs du haut (48 reservations,
            376 joueurs, 5 936 €, 76 % d'occupation) s'allument l'un apres
            l'autre, sur les memes temps que les six « pop » de la table de
            bruitages — donc un son par evenement visible, et exactement les
            chiffres que le sous-titre annonce a cet instant. */}
        {KPIS.map((k, i) => {
          const cue = KPI_CUE(i);
          if (frame < cue) return null;
          const t = interpolate(frame, [cue, cue + 10], [0, 1], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: WEEK_DROP,
          });
          const eclat = interpolate(frame, [cue, cue + 5, cue + 16], [0, 1, 0], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
          });
          return (
            <div
              key={`kpi-${i}`}
              style={{
                position: 'absolute',
                left: k.x - 3, top: k.y - 3, width: k.w + 6, height: k.h + 6,
                borderRadius: 16,
                border: `2px solid ${AMBER}`,
                opacity: t * (0.28 + 0.72 * eclat),
                boxShadow: `0 0 ${18 * eclat}px rgba(6, 100, 254, ${0.4 * eclat}),`
                  + ` 0 ${8 * t}px ${22 * t}px rgba(5, 30, 72, ${0.1 * t})`,
                transform: `scale(${1 + 0.012 * eclat})`,
                transformOrigin: 'center center',
                pointerEvents: 'none',
              }}
            />
          );
        })}
      </PageCam>

      {/* PAS DE CARTOUCHE ICI.
          Le template posait un titre en haut a droite, dans la bande vide de son
          en-tete. Notre tableau de bord occupe cette zone (bouton
          « + Reservation rapide »), et le cartouche passait derriere. Il etait de
          toute facon redondant : la page affiche son propre titre, sa date et
          « Vue d'ensemble de votre activite ». Un texte qui repete l'image et la
          salit ne merite pas d'etre replace ailleurs — il merite d'etre retire. */}
    </>
  );
};
