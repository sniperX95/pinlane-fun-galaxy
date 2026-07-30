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
import { chargerGeist } from './fonts';

chargerGeist();

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
const CARTONS = NARRATION.lignes.filter((l) => l.cible === 'carton');
const ligneDe = (n: number) => CARTONS[n];
// De combien d'images le carton precede-t-il la voix ? Le mot ne doit apparaitre
// qu'a l'instant ou il est dit, pas a l'ouverture du carton.
const decalageDe = (n: number, depart: number) =>
  Math.round(CARTONS[n].at * NARRATION.fps) - depart;

export const AiflMain: React.FC = () => {
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
      <Sequence from={AIFL_SHOTS.card1.from} durationInFrames={AIFL_SHOTS.card1.duration}>
        <PaperTitleCard
          duration={AIFL_SHOTS.card1.duration}
          words={ligneDe(0).mots.map((m) => ({ text: m.m }))}
          mots={ligneDe(0).mots}
          decalage={decalageDe(0, AIFL_SHOTS.card1.from)}
        />
      </Sequence>
      <Sequence from={AIFL_SHOTS.table.from} durationInFrames={AIFL_SHOTS.table.duration}>
        <SceneFlyIn />
      </Sequence>
      <Sequence from={AIFL_SHOTS.macro.from} durationInFrames={AIFL_SHOTS.macro.duration}>
        <SceneDetail />
      </Sequence>
      <Sequence from={AIFL_SHOTS.card2.from} durationInFrames={AIFL_SHOTS.card2.duration}>
        <PaperTitleCard
          duration={AIFL_SHOTS.card2.duration}
          words={ligneDe(1).mots.map((m) => ({ text: m.m }))}
          mots={ligneDe(1).mots}
          decalage={decalageDe(1, AIFL_SHOTS.card2.from)}
        />
      </Sequence>
      <Sequence from={AIFL_SHOTS.chart.from} durationInFrames={AIFL_SHOTS.chart.duration}>
        <ScenePapers />
      </Sequence>
      <Sequence from={AIFL_SHOTS.cardWbr.from} durationInFrames={AIFL_SHOTS.cardWbr.duration}>
        <PaperTitleCard
          duration={AIFL_SHOTS.cardWbr.duration}
          words={ligneDe(2).mots.map((m) => ({ text: m.m }))}
          mots={ligneDe(2).mots}
          decalage={decalageDe(2, AIFL_SHOTS.cardWbr.from)}
        />
      </Sequence>
      <Sequence from={AIFL_SHOTS.wbr.from} durationInFrames={AIFL_SHOTS.wbr.duration}>
        <SceneWbr />
      </Sequence>
      <Sequence from={AIFL_SHOTS.card3.from} durationInFrames={AIFL_SHOTS.card3.duration}>
        <PaperTitleCard
          duration={AIFL_SHOTS.card3.duration}
          words={ligneDe(3).mots.map((m) => ({ text: m.m }))}
          mots={ligneDe(3).mots}
          decalage={decalageDe(3, AIFL_SHOTS.card3.from)}
        />
      </Sequence>
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
