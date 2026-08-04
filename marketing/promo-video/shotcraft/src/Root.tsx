import { Composition } from 'remotion';
import { AiflMain, AIFL_TOTAL } from './aifl/Main';
import { RelancesMain, Narration, Phrase } from './relances/Main';
import KAEL from './relances/narration-kael.json';
import MICHAEL from './relances/narration-michael.json';
import PH_KAEL from './relances/phrases-kael.json';
import PH_MICHAEL from './relances/phrases-michael.json';

// Deux compositions carrees pour le film « mails et relances » : le MEME
// montage, nourri par deux tables de plans differentes. Chaque voix garde son
// rythme naturel au lieu d'etre etiree pour tenir dans les plans de l'autre.
const kael = KAEL as unknown as Narration;
const michael = MICHAEL as unknown as Narration;

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="AiflPromo"
        component={AiflMain}
        durationInFrames={AIFL_TOTAL}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="RelancesKael"
        component={RelancesMain}
        durationInFrames={kael.total}
        fps={kael.fps}
        width={1080}
        height={1080}
        defaultProps={{ narration: kael, phrases: PH_KAEL as Phrase[], voix: 'kael' }}
      />
      <Composition
        id="RelancesMichael"
        component={RelancesMain}
        durationInFrames={michael.total}
        fps={michael.fps}
        width={1080}
        height={1080}
        defaultProps={{ narration: michael, phrases: PH_MICHAEL as Phrase[], voix: 'michael' }}
      />
    </>
  );
};
