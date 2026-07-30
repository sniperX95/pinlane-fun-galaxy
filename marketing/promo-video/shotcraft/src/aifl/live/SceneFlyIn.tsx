import { Img, interpolate, staticFile, useCurrentFrame, Easing } from 'remotion';
import { PageCam, CamKey } from './PageCam';
import layout from '../live-layout.json';

// La planche de ce plan n'est PAS celle du plan d'ouverture : c'est la page
// longue (planning entier + liste des reservations dessous), sur laquelle les
// 26 creneaux viennent atterrir.
const cards = layout.projects.cardsFull ?? layout.projects.cards;
const PAGE_H = layout.projects.fullPageH ?? layout.projects.pageH;

const HOVER_H = 40; // px above the slot (translateZ) a card hovers at mid-dive
const SETTLE_EASE = Easing.bezier(0.3, 0, 0.25, 1.15); // slight overshoot / compress
const DIVE_EASE = Easing.bezier(0.3, 0, 0.2, 1); // decelerate into the hover
const SLIDE_EASE = Easing.bezier(0.35, 0, 0.2, 1); // nano-lab card slide to the top slot

// Couleurs prises sur le produit au moment de la capture, pas choisies.
const PAPER = (layout as { bg?: string }).bg ?? '#fafafa';
const FIELD = '#ffffff'; // interieur du champ de recherche

const CARD_W = cards[0].w;
const CARD_H = cards[0].h;

// PAS D'EXTENSION DE PAPIER, PAS DE CARTES EN SURNOMBRE.
//
// Le template garnissait une extension de papier peint sous sa capture avec 16
// cartes dupliquees, pour avoir de quoi remplir une plongee de 3782 px. Mesure
// faite sur Pinlane : 62 creneaux tiennent dans 610 px, et la page continue avec
// de VRAI contenu (la liste des reservations). On plonge donc sur la page reelle
// et on supprime le decor : rien de peint, aucune reservation dupliquee.
const PAPER_EXT = { x: 0, y: PAGE_H, w: 1920, h: 0 };
const extras: typeof cards = [];

// ---- the DECK: all 26 cards start stacked in one pile at the page's top
// right. The shot opens on a rotating 3D close-up of the pile (0–35), pulls
// back to reveal the page (35–62), and the cards deal themselves to their
// slots in reading order (y, then x) on a hard-accelerating cadence — the gap
// between departures shrinks from 4f to 0.2f (gap_k = 4 − 0.1584k), so the
// dealing goes from deliberate to a blur. First departs at 36 (mid pull-back),
// last ≈88, lands ≈96. Pile poses carry a small deterministic jitter and each
// card keeps a stack height (top of pile = first to leave). ----
// La pile se pose a droite de la grille, dans la marge libre : la grille va de
// x=58 a x=1604, il reste 316 px. Une pile posee SUR la grille masquerait les
// creneaux ou les cartes doivent atterrir.
const PILE = { x: Math.min(1920 - CARD_W - 40, cards[0].x + 1500), y: 190 };
const N_CARDS = cards.length;
const DEAL_START = 36;
const STACK_STEP = 3; // px of physical height per card — the pile reads as a real stack

// dark-metal backdrop for the opening close-up: covers everything in the page
// plane, with a warm spotlight pooled on the pile; fades out with the pull-back
const METAL_FADE = [34, 56] as const;

const grid = [
  ...cards.map((c) => ({ file: c.file, x: c.x, y: c.y, w: c.w, h: c.h, title: c.title })),
  ...extras,
]
  .sort((a, b) => a.y - b.y || a.x - b.x)
  .map((c, k) => ({
    ...c,
    cue: DEAL_START + 4 * k - 0.0792 * k * (k - 1),
    // pile pose: tiny alternating offsets + roll, stacked top-down by k
    px: PILE.x + (((k * 7) % 9) - 4) * 2,
    py: PILE.y + (((k * 5) % 7) - 3) * 2,
    protZ: ((k * 11) % 7) - 3,
    pz: (N_CARDS - k) * STACK_STEP, // physical stack height; k=0 rides on top
  }));

// ---- la cible de la recherche : le resultat glisse vers un creneau du haut ---
const QUERY = 'Dubois';
const nanoIdx = Math.max(0, grid.findIndex((c) => c.title.includes(QUERY)));
const nano = grid[nanoIdx];
// Le creneau d'atterrissage est celui de la premiere rangee le plus proche du
// CENTRE de page : la camera finit par pousser dessus a x2,2, et un creneau
// colle au bord gauche ferait entrer le hors-page dans le cadre.
const NANO_TO = (() => {
  const yMin = Math.min(...cards.map((c) => c.y));
  const rangee = cards.filter((c) => c.y === yMin);
  const cible = rangee.reduce((a, b) => (Math.abs(a.x + a.w / 2 - 960) <= Math.abs(b.x + b.w / 2 - 960) ? a : b));
  return { x: cible.x, y: cible.y };
})();
const CLICK_C = { x: NANO_TO.x + CARD_W / 2, y: NANO_TO.y + CARD_H / 2 };

// filter departure rank for the 19 non-target cards (reading order)
const leaveRank = new Map<number, number>();
grid.forEach((_, i) => {
  if (i !== nanoIdx) leaveRank.set(i, leaveRank.size);
});

// La boite de recherche vient du produit (relevee a la capture), pas d'une
// valeur ecrite a la main.
const SEARCH = layout.projects.search ?? { x: 1070, y: 40, w: 190, h: 32 };
const TYPE_START = 128; // 3 images par caractere -> dernier a ~146
const FILTER_START = 160; // beat of rest after typing, then the grid filters

// pile centre for the opening close-up
const PILE_CX = PILE.x + CARD_W / 2;
const PILE_CY = PILE.y + CARD_H / 2;

// Narrative: the shot opens on a rotating 3D CLOSE-UP of the 26-card pile
// (orbiting from a left-oblique to a right-oblique look), pulls back to
// reveal the page as the pile starts dealing cards to their grid slots, each
// departure faster than the last, extending the grid far below the page fold
// → the camera scrolls down chasing the dealing, FASTER each leg, arriving
// straight at the bottom → rests half a second on the full board → swooshes
// back up to the search box → "nano-lab" is typed (unhurried), a breath, then
// the grid filters down to one card which slides into the first row → a click
// ripple fires and the camera pushes into the card, handing off to detail.
const CAM_KEYS: CamKey[] = [
  { frame: 0, cx: PILE_CX - 30, cy: PILE_CY + 60, zoom: 1.95, rotX: 46, rotY: -30, rotZ: 9, persp: 1100 }, // low side view of the stack, left-oblique
  { frame: 34, cx: PILE_CX + 30, cy: PILE_CY + 40, zoom: 1.85, rotX: 42, rotY: 26, rotZ: -7, persp: 1100 }, // orbit around the pile to a right-oblique
  // La plongee est recalee sur la HAUTEUR REELLE de la page (1900) au lieu des
  // 3782 px de papier peint du template. Chaque palier reste dans la page :
  // a un grossissement z, la moitie de l'image couvre 540/z px, donc le point
  // vise ne peut pas descendre sous pageH - 540/z sans montrer du hors-page.
  // Le dernier palier arrive pile en bas (1900 - 540/0,72 = 1150).
  { frame: 62, cx: 960, cy: 700, zoom: 0.88, rotX: 26, rotY: 0, rotZ: 2, persp: 1300 }, // recul — le planning apparait, la distribution est lancee
  { frame: 82, cx: 950, cy: 950, zoom: 0.78, rotX: 14, rotY: 0, rotZ: 0, persp: 1300 }, // acceleration
  { frame: 98, cx: 960, cy: 1148, zoom: 0.72, rotX: 0, rotY: 0, rotZ: 0, persp: 1300 }, // arrive a plat sur le bas de page
  { frame: 113, cx: 960, cy: 1148, zoom: 0.72, rotX: 0, rotY: 0, rotZ: 0, persp: 1300 }, // 0,5 s de PAUSE sur la planche pleine
  { frame: 124, cx: 960, cy: 600, zoom: 0.9, rotX: 0, rotY: 0, rotZ: 0, persp: 1300 }, // remontee vers la barre de recherche
  { frame: 174, cx: 960, cy: 600, zoom: 0.9, rotX: 0, rotY: 0, rotZ: 0, persp: 1300 }, // tenue pendant la frappe, la respiration, le filtre
  { frame: 190, cx: CLICK_C.x, cy: CLICK_C.y, zoom: 2.2, rotX: 0, rotY: 0, rotZ: 0, persp: 1300 }, // push into the clicked card, carried through the white flash
];

export const SceneFlyIn: React.FC = () => {
  const frame = useCurrentFrame();

  // DOF fades out over the straightening leg of the scroll (82 → 98)
  const dofStrength = interpolate(frame, [82, 98], [5, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // typed characters: one every 3 frames from TYPE_START (unhurried typing)
  const typedCount = frame < TYPE_START
    ? 0
    : Math.min(QUERY.length, Math.floor((frame - TYPE_START) / 3) + 1);
  // caret: solid while typing, then blinks on an 8-frame cycle until the click
  const caretOn =
    frame >= TYPE_START - 2 &&
    frame <= 185 &&
    (frame <= TYPE_START + 24 || Math.floor((frame - (TYPE_START + 24)) / 8) % 2 === 0);

  return (
    <PageCam
      src="textures/live/projects-empty.png"
      pageH={PAGE_H}
      keys={CAM_KEYS}
      ease={Easing.bezier(0.33, 0, 0.15, 1)}
      dof={dofStrength > 0.1 ? { focusY: 260, strength: dofStrength } : undefined}
    >
      {/* ---- dark brushed-metal table under the opening pile close-up: a huge
              plane (covers the viewport at any oblique angle) with a warm
              spotlight pooled on the stack; fades away as the camera pulls
              back and the dashboard page takes over ---- */}
      {frame < METAL_FADE[1] ? (
        <div
          style={{
            position: 'absolute',
            left: -3000,
            top: -3000,
            width: 9000,
            height: 9000,
            opacity: interpolate(frame, [METAL_FADE[0], METAL_FADE[1]], [1, 0], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            }),
            background: [
              // warm key light pooled on the pile
              `radial-gradient(1300px 900px at ${3000 + PILE_CX}px ${3000 + PILE_CY}px, rgba(30, 116, 254, 0.24), rgba(30, 116, 254, 0.08) 40%, transparent 68%)`,
              // brushed-metal grain: fine anisotropic streaks
              'repeating-linear-gradient(100deg, rgba(255,255,255,0.028) 0px, rgba(255,255,255,0.028) 1px, transparent 2px, transparent 7px)',
              'repeating-linear-gradient(100deg, rgba(0,0,0,0.16) 0px, rgba(0,0,0,0.16) 2px, transparent 4px, transparent 13px)',
              // broad steel sheen
              'linear-gradient(115deg, #0b1220 0%, #14203a 28%, #070d18 55%, #101b30 78%, #050a14 100%)',
            ].join(', '),
            pointerEvents: 'none',
          }}
        />
      ) : null}

      {/* ---- paper extension: the page grows past the texture so the three
              extra rows sit on paper, not on the void ---- */}
      <div
        style={{
          position: 'absolute',
          left: PAPER_EXT.x,
          top: PAPER_EXT.y,
          width: PAPER_EXT.w,
          height: PAPER_EXT.h,
          background: PAPER,
          pointerEvents: 'none',
        }}
      />

      {/* ---- nettoyage au filtrage : un aplat couvre tout ce qui est CUIT dans
              la texture sous la premiere rangee (les autres creneaux, la liste
              en dessous), pour que le resultat reste seul a l'ecran. La limite
              suit la rangee d'atterrissage au lieu d'un y=500 ecrit en dur. ---- */}
      {frame >= FILTER_START ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: NANO_TO.y + CARD_H + 10,
            width: 1920,
            height: PAGE_H - (NANO_TO.y + CARD_H + 10),
            background: PAPER,
            opacity: interpolate(frame, [FILTER_START, FILTER_START + 8], [0, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            }),
            pointerEvents: 'none',
          }}
        />
      ) : null}

      {/* ---- 26 cards: visible pile at top right from frame 0, each card
              deals itself to its slot (arc flight, roll resolving) on an
              accelerating cadence; on filter the 25 non-matches fade+sink
              away and nano-lab slides up to row one ---- */}
      {grid.map((c, i) => {
        const { cue } = c;
        const radius = 16;
        const isNano = i === nanoIdx;

        // --- filter fade-out for the 25 non-target cards (staggered, 5f) ---
        const outCue = isNano ? Infinity : FILTER_START + leaveRank.get(i)! * 0.4;
        if (frame >= outCue + 5) return null;
        const outT = isNano
          ? 0
          : interpolate(frame, [outCue, outCue + 5], [0, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.quad),
            });

        // --- beat 1: deal (cue → cue+8): from the pile pose (px,py, stack
        // height pz, small roll) to the hover pose over the slot. The flight
        // arcs UP first (z bulge) like a card snapped off the top of a deck. ---
        const diveT = interpolate(frame, [cue, cue + 8], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: DIVE_EASE,
        });

        // --- beat 2: settle (cue+8 → cue+12): Z from HOVER_H down to 0 ---
        const settleT = interpolate(frame, [cue + 8, cue + 12], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: SETTLE_EASE,
        });

        // in-flight pose: pile → slot, roll resolving to 0 by touchdown-hover.
        const dx = (c.px - c.x) * (1 - diveT);
        const dy = (c.py - c.y) * (1 - diveT);
        const rotFlight = c.protZ * (1 - diveT);

        // depth: stack height → arc bulge (+90 at mid-flight) → hover → settle 0.
        const arc = Math.sin(diveT * Math.PI) * 90;
        const zDive = interpolate(diveT, [0, 1], [c.pz, HOVER_H]) + arc;
        const z = frame < cue ? c.pz : zDive * (1 - settleT); // pile height before the deal

        // scale: in the pile 1, snap up 1.06 mid-flight, settle back to 1
        const dealScale = 1 + Math.sin(diveT * Math.PI) * 0.06;
        const press = interpolate(frame, [cue + 10, cue + 11, cue + 12], [1, 0.996, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        const scale = dealScale * press;

        // --- nano-lab slide (104 → 114): glide from (408,1402) to the first-row
        // slot with a light float (scale 1→1.02→1, small Z lift, wider shadow) ---
        const slideT = isNano
          ? interpolate(frame, [FILTER_START, FILTER_START + 10], [0, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: SLIDE_EASE,
            })
          : 0;
        const slideDy = (NANO_TO.y - nano.y) * slideT;
        const slideDx = (NANO_TO.x - nano.x) * slideT;
        const float = Math.sin(slideT * Math.PI); // 0→1→0 across the slide
        const slideScale = 1 + 0.02 * float;
        const slideZ = 18 * float;

        // once fully settled, force an exact identity so the card sits flush
        // with its slot on the tilted board (no residual sub-px drift).
        const landed = frame >= cue + 12;
        const inPile = frame < cue;
        const transform = isNano && frame >= FILTER_START
          ? `translate3d(${slideDx}px, ${slideDy}px, ${slideZ}px) scale(${slideScale})`
          : outT > 0
            ? `translate3d(0px, ${8 * outT}px, 0px)`
            : landed
              ? 'translate3d(0px, 0px, 0px)'
              : inPile
                ? `translate3d(${c.px - c.x}px, ${c.py - c.y}px, ${c.pz}px) rotateZ(${c.protZ}deg)`
                : `translate3d(${dx}px, ${dy}px, ${z}px) rotateZ(${rotFlight}deg) scale(${scale})`;

        // shadow: stacked cards carry almost none (they sit on each other),
        // airborne large/soft, tight when flush, widening on the slide
        const shadow = isNano && frame >= FILTER_START
          ? `0 ${2 + 14 * float}px ${6 + 26 * float}px rgba(5, 30, 72, ${0.08 + 0.1 * float})`
          : landed
            ? '0 2px 6px rgba(5, 30, 72, 0.08)'
            : inPile
              ? '0 1px 3px rgba(5, 30, 72, 0.14)'
              : `0 ${36 - 30 * settleT}px ${70 - 60 * settleT}px rgba(5, 30, 72, ${0.3 - 0.22 * settleT})`;

        // motion-blur ghost during the deal: a faint blurred copy trailing the flight path
        const showGhost = diveT > 0.02 && diveT < 0.98;
        const ghostLagX = (c.px - c.x) * 0.05;
        const ghostLagY = (c.py - c.y) * 0.05;

        return (
          <div key={`${c.file}-${i}`} style={{ transformStyle: 'preserve-3d' }}>
            {showGhost ? (
              <div
                style={{
                  position: 'absolute',
                  left: c.x,
                  top: c.y,
                  width: c.w,
                  height: c.h,
                  transform: `translate3d(${dx + ghostLagX}px, ${dy + ghostLagY}px, ${z}px) rotateZ(${rotFlight}deg) scale(${scale})`,
                  transformOrigin: 'center center',
                  opacity: 0.25 * (1 - diveT),
                  filter: 'blur(6px)',
                  borderRadius: radius,
                  overflow: 'hidden',
                  pointerEvents: 'none',
                }}
              >
                <Img
                  src={staticFile(`textures/live/${c.file}`)}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
                />
              </div>
            ) : null}

            <div
              style={{
                position: 'absolute',
                left: c.x,
                top: c.y,
                width: c.w,
                height: c.h,
                transform,
                transformOrigin: 'center center',
                boxShadow: shadow,
                borderRadius: radius,
                opacity: 1 - outT,
                overflow: 'hidden',
              }}
            >
              <Img
                src={staticFile(`textures/live/${c.file}`)}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
              />
            </div>
          </div>
        );
      })}

      {/* ---- search box: paper patch over the placeholder text (keeps the
              magnifier icon), then "nano-lab" typed in with a blinking caret ---- */}
      {frame >= 118 ? (
        <div
          style={{
            position: 'absolute',
            // L'aplat couvre le texte d'invite SANS manger la loupe, qui est a
            // droite du champ dans Pinlane. Les valeurs etaient calees sur une
            // boite a x=408 large de 1016 px ; la notre est a x=1070, large de
            // 190 — laissees en dur, l'aplat aurait couvert un bout de grille.
            left: SEARCH.x + 8,
            top: SEARCH.y + 4,
            width: SEARCH.w - 44,
            height: SEARCH.h - 8,
            background: FIELD,
            opacity: interpolate(frame, [118, 124], [0, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            }),
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {frame >= TYPE_START - 2 ? (
        <div
          style={{
            position: 'absolute',
            left: SEARCH.x + 12,
            top: SEARCH.y,
            height: SEARCH.h,
            display: 'flex',
            alignItems: 'center',
            fontFamily: "'Geist', 'Geist Fallback', ui-sans-serif, system-ui, sans-serif",
            fontSize: 15,
            letterSpacing: 0.2,
            color: '#08111f',
            pointerEvents: 'none',
          }}
        >
          <span>{QUERY.slice(0, typedCount)}</span>
          {caretOn ? (
            <span
              style={{
                display: 'inline-block',
                width: 2,
                height: 20,
                marginLeft: 2,
                background: '#0664fe',
              }}
            />
          ) : null}
        </div>
      ) : null}

      {/* ---- click ripple on the filtered card: two concentric amber rings ---- */}
      {[0, 1].map((r) => {
        const start = 176 + r * 3;
        if (frame < start || frame > start + 10) return null;
        const t = interpolate(frame, [start, start + 10], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
        });
        const rad = interpolate(t, [0, 1], [14, r === 0 ? 54 : 78]);
        return (
          <div
            key={`ripple-${r}`}
            style={{
              position: 'absolute',
              left: CLICK_C.x - rad,
              top: CLICK_C.y - rad,
              width: rad * 2,
              height: rad * 2,
              borderRadius: '50%',
              border: '2px solid #0664fe',
              opacity: 1 - t,
              pointerEvents: 'none',
            }}
          />
        );
      })}

      {/* ---- selected-card amber outline, lit from the click until the cut ---- */}
      {frame >= 178 ? (
        <div
          style={{
            position: 'absolute',
            left: NANO_TO.x - 6,
            top: NANO_TO.y - 6,
            width: nano.w + 12,
            height: nano.h + 12,
            borderRadius: 16,
            border: '3px solid #0664fe',
            boxShadow: '0 0 40px rgba(6, 100, 254, 0.5)',
            opacity: interpolate(frame, [178, 181], [0.5, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            }),
            pointerEvents: 'none',
          }}
        />
      ) : null}

      {/* near-edge rim light along the extended board's leading (bottom) edge */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: PAPER_EXT.y + PAPER_EXT.h - 8,
          height: 8,
          background: 'rgba(255,255,255,0.85)',
          filter: 'blur(6px)',
          opacity: 0.5,
          pointerEvents: 'none',
        }}
      />
    </PageCam>
  );
};
