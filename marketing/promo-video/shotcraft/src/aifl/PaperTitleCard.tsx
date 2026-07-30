import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { DigitRoll } from './DigitRoll';

const SERIF = "'Geist', 'Geist Fallback', ui-sans-serif, system-ui, sans-serif";
const MONO = "'Geist Mono', 'Geist Mono Fallback', ui-monospace, SFMono-Regular, monospace";

// Une plage d'interpolation DOIT etre strictement croissante. Un mot tres court
// (« Ça », moins de deux images) faisait passer sa fin avant le point de montee
// et Remotion refusait de rendre : « inputRange must be strictly monotonically
// increasing but got [4,6,5.45,10.45] ». On force donc l'ordre au lieu de
// supposer que la duree du mot est suffisante.
const croissant = (a: number, b: number, c: number, d: number) => {
  const p1 = a + Math.max(0.5, b - a);
  const p2 = Math.max(c, p1 + 0.5);
  return [a, p1, p2, Math.max(d, p2 + 0.5)];
};

/**
 * Paper title card: warm paper field, serif statement letterpressed word by
 * word, amber italic accent word, amber underline growing beneath.
 */
export const PaperTitleCard: React.FC<{
  duration: number;
  words: { text: string; accent?: boolean }[];
  sub?: string;
  subDigits?: string;
  /** Dates de chaque mot, en secondes depuis le debut du carton. Quand elles
   *  sont fournies, les mots apparaissent A L'INSTANT OU LA VOIX LES DIT au lieu
   *  d'un decalage par index — et le mot en cours porte le bleu de la marque. */
  mots?: { m: string; t0: number; t1: number }[];
  /** Decalage, en images, entre le debut du CARTON et le debut de la ligne
   *  parlee. Le carton s'ouvre quelques images avant que la voix n'attaque ;
   *  sans ce decalage les mots apparaissaient 4 images trop tot — soit exactement
   *  le defaut de synchronisation qu'on corrige. */
  decalage?: number;
}> = ({ duration, words, sub, subDigits, mots, decalage = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeOut = interpolate(frame, [duration - 8, duration], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const underline = interpolate(frame, [16, 34], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.3, 0, 0.2, 1),
  });
  const subT = interpolate(frame, [10, 22], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // POUSSEE CONTINUE. Les mots apparaissaient puis l'image se figeait jusqu'a la
  // coupe — pres de deux secondes d'arret sur chacun des quatre cartons. Une
  // lente montee d'echelle et une derive du halo suffisent a garder le plan
  // vivant, sans toucher au rythme d'apparition des mots.
  const pousse = interpolate(frame, [0, duration], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.25, 0, 0.4, 1),
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#ffffff',
        justifyContent: 'center',
        alignItems: 'center',
        opacity: fadeOut,
        backgroundImage: `radial-gradient(${1100 + pousse * 220}px ${750 + pousse * 150}px at 50% ${42 - pousse * 4}%, rgba(255, 255, 255, 0.92), transparent 65%)`,
      }}
    >
      <div
        style={{
          textAlign: 'center', maxWidth: 1500,
          transform: `scale(${1 + pousse * 0.035}) translateY(${-pousse * 10}px)`,
          transformOrigin: 'center center',
        }}
      >
        <div
          style={{
            fontFamily: SERIF, fontSize: 116, fontWeight: 600, lineHeight: 1.14,
            color: '#08111f', letterSpacing: '-0.012em',
            display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '0.26em',
          }}
        >
          {(mots ? mots.map((m) => ({ text: m.m, accent: false })) : words).map((w, i) => {
            const m = mots ? mots[i] : null;
            // Avec les dates de la voix : le mot entre juste avant d'etre dit.
            // Sans elles : l'ancien decalage par index, 4 images par mot.
            const f0 = m ? decalage + m.t0 * fps - 2 : 4 + i * 4;
            const f1 = m ? decalage + m.t1 * fps : f0 + 9;
            const t = interpolate(frame, [f0, f0 + 9], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: Easing.bezier(0.2, 0.75, 0.3, 1),
            });
            // Le mot prononce porte le bleu, puis retombe a l'encre : la couleur
            // est un curseur de lecture cale sur la bouche.
            const actif = m
              ? interpolate(frame, croissant(decalage + m.t0 * fps, decalage + m.t0 * fps + 2, f1 + 1, f1 + 6), [0, 1, 1, 0], {
                extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
              })
              : 0;
            const bleu = m ? actif > 0.02 : !!w.accent;
            return (
              <span
                key={i}
                style={{
                  opacity: t,
                  transform: `scale(${1.28 - 0.28 * t})`,
                  filter: `blur(${(1 - t) * 7}px)`,
                  display: 'inline-block',
                  fontStyle: !mots && w.accent ? 'italic' : 'normal',
                  color: bleu ? '#0664fe' : undefined,
                }}
              >
                {w.text}
              </span>
            );
          })}
        </div>
        <div
          style={{
            height: 6, width: 220, margin: '38px auto 0', borderRadius: 3,
            background: '#0664fe', transform: `scaleX(${underline})`,
          }}
        />
        {sub ? (
          <div style={{ fontFamily: MONO, fontSize: 26, letterSpacing: '0.12em', color: '#55617a', marginTop: 34, opacity: subT, textTransform: 'uppercase', display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: '0.5em' }}>
            {subDigits ? <DigitRoll value={subDigits} delay={12} fontSize={26} /> : null}
            <span>{sub}</span>
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
