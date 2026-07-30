import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { SceneOpen } from './live/SceneOpen';
import { SceneFlyIn } from './live/SceneFlyIn';
import { SceneDetail } from './live/SceneDetail';
import { ScenePapers } from './live/ScenePapers';
import { SceneWbr } from './live/SceneWbr';
import { PaperTitleCard } from './PaperTitleCard';
import { SceneOutroLive } from './live/SceneOutroLive';
import { FlashCut } from './FlashCut';
import { NarrationCaption } from './NarrationCaption';
import { SFX, longueur } from './sfx';
import NARRATION from './narration.json';
import { AIFL_SHOTS } from './shots';
import { useGeist } from './fonts';

// La table de plans vit dans `shots.ts` (voir l'entete de ce fichier pour le
// pourquoi). On la re-exporte : les scenes l'importent depuis '../Main'.
export { AIFL_SHOTS, AIFL_TOTAL } from './shots';

// bottom-strip narration over the live shots (absolute frames; outro stays clean)
// Aucun chiffre qui ne soit pas AFFICHE par le produit dans le plan concerne :
// 38 reservations et 297 joueurs sont ecrits en clair dans l'en-tete du
// planning, et le script de capture refuse de livrer les assets si la journee
// de demonstration ne les porte pas. Les autres plans se passent de chiffres
// plutot que d'en avancer un que l'image ne montre pas.


// La ligne de narration qui doit s'afficher sur un carton donne. Le carton et la
// voix lisent la MEME entree : ils ne peuvent plus se desynchroniser.
// Recherche par NOM DE PLAN, pas par rang dans la liste des cartons : inserer un
// carton au milieu du film decalait tous les rangs suivants, et chaque carton
// affichait alors la phrase du precedent.
const ligneDe = (plan: string) => {
  const l = NARRATION.lignes.find((x) => x.plan === plan && x.cible === 'carton');
  if (!l) throw new Error(`aucune ligne de narration pour le carton ${plan}`);
  return l;
};
// De combien d'images le carton precede-t-il la voix ? Le mot ne doit apparaitre
// qu'a l'instant ou il est dit, pas a l'ouverture du carton.
const decalageDe = (plan: string, depart: number) =>
  Math.round(ligneDe(plan).at * NARRATION.fps) - depart;

// Un carton, tel qu'il est monte a chaque fois : sa duree vient de la table de
// plans, son texte et son minutage de la table de narration.
const Carton: React.FC<{ plan: 'cardA' | 'cardB' | 'card1' | 'card2' | 'cardWbr' | 'card3' }> = ({ plan }) => {
  const shot = AIFL_SHOTS[plan];
  const l = ligneDe(plan);
  return (
    <Sequence from={shot.from} durationInFrames={shot.duration}>
      <PaperTitleCard
        duration={shot.duration}
        words={l.mots.map((m) => ({ text: m.m }))}
        mots={l.mots}
        decalage={decalageDe(plan, shot.from)}
      />
    </Sequence>
  );
};

export const AiflMain: React.FC = () => {
  // La police se reserve DANS le contexte de rendu (voir fonts.ts).
  useGeist();
  return (
    <AbsoluteFill style={{ backgroundColor: '#f6f8fb' }}>
      {/* Bruitages, cales relativement au debut de leur plan (voir sfx.ts) */}
      {SFX.map((s, i) => (
        <Sequence key={`sfx-${i}`} from={s.from} durationInFrames={longueur(s)}>
          <Audio src={staticFile(`audio/${s.src}`)} volume={s.volume} />
        </Sequence>
      ))}
      <Sequence from={AIFL_SHOTS.morning.from} durationInFrames={AIFL_SHOTS.morning.duration}>
        <SceneOpen />
      </Sequence>
      {/* Les deux cartons du probleme : ce qui manquait pour un trafic froid. */}
      <Carton plan="cardA" />
      <Carton plan="cardB" />
      <Carton plan="card1" />
      <Sequence from={AIFL_SHOTS.table.from} durationInFrames={AIFL_SHOTS.table.duration}>
        <SceneFlyIn />
      </Sequence>
      <Sequence from={AIFL_SHOTS.macro.from} durationInFrames={AIFL_SHOTS.macro.duration}>
        <SceneDetail />
      </Sequence>
      <Carton plan="card2" />
      <Sequence from={AIFL_SHOTS.chart.from} durationInFrames={AIFL_SHOTS.chart.duration}>
        <ScenePapers />
      </Sequence>
      <Carton plan="cardWbr" />
      <Sequence from={AIFL_SHOTS.wbr.from} durationInFrames={AIFL_SHOTS.wbr.duration}>
        <SceneWbr />
      </Sequence>
      <Carton plan="card3" />
      <Sequence from={AIFL_SHOTS.outro.from} durationInFrames={AIFL_SHOTS.outro.duration}>
        <SceneOutroLive />
      </Sequence>
      {/* Bandeaux de narration : chaque ligne est posee a SON instant, tire de
          la table de narration, et ses mots apparaissent quand la voix les dit.
          La duree ajoute 26 images de tenue apres le dernier mot. */}
      {NARRATION.lignes.filter((l) => l.cible === 'bandeau').map((l) => {
        const from = Math.round(l.at * NARRATION.fps);
        const duree = Math.round(l.duree * NARRATION.fps) + 26;
        return (
          <Sequence key={`nar-${l.i}`} from={from} durationInFrames={duree}>
            <NarrationCaption mots={l.mots} duree={duree} />
          </Sequence>
        );
      })}
      {/* warm flash cuts straddling scene changes */}
      {[AIFL_SHOTS.table.from, AIFL_SHOTS.macro.from, AIFL_SHOTS.chart.from, AIFL_SHOTS.wbr.from].map((cut) => (
        <Sequence key={cut} from={cut - 5} durationInFrames={10}>
          <FlashCut duration={10} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
