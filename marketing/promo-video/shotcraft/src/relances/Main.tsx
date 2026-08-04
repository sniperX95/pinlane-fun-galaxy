// LE MONTAGE DU FILM « MAILS ET RELANCES ».
//
// Il n'y a AUCUNE duree ecrite dans ce fichier. Tout vient de `narration-*.json`,
// calcule depuis l'alignement au mot de la prise : les plans, les instants de
// chaque phrase, et la date de chaque mot. C'est l'invariant §I.1 du manuel, et
// c'est ce qui rend impossible la desynchronisation entre ce qui est dit et ce
// qui est ecrit.
//
// DEUX VOIX, DEUX TABLES. Le composant prend sa narration en argument : la
// composition `RelancesKael` et la composition `RelancesMichael` sont le meme
// montage nourri par deux tables differentes. Un montage commun aurait etire la
// voix rapide pour la faire tenir dans les plans de la lente (mesure sur le film
// Subify : 50,64 % de phonation contre 64,10 %, soit le plancher du skill).
import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { PaperTitleCard } from '../aifl/PaperTitleCard';
import { NarrationCaption } from '../aifl/NarrationCaption';
import { FlashCut } from '../aifl/FlashCut';
import { useGeist } from '../aifl/fonts';
import {
  SceneOuverture, SceneProbleme, SceneSequences, SceneEnumere, SceneInterrupteur,
  SceneCreer, SceneRecu, SceneVeut, SceneReponse, SceneApprend, SceneOutro,
} from './Scenes';

type Mot = { m: string; t0: number; t1: number };
type Ligne = {
  i: number; plan: string; cible: string; texte: string; mots: Mot[];
  /** Bornes de la phrase DANS LA PRISE. */
  de: number; a: number;
  /** Instant de la phrase DANS LE FILM, et sa duree. */
  at: number; duree: number;
};
type Plan = { from: number; duration: number };
export type Narration = {
  fps: number; total: number; audio?: string;
  plans: Record<string, Plan>;
  lignes: Ligne[];
};

// Les cartons : leur texte et leur minutage viennent de la MEME entree que la
// voix, cherchee par NOM DE PLAN et non par rang. Inserer un plan au milieu du
// film decalait tous les rangs suivants, et chaque carton affichait alors la
// phrase du precedent.
const ligneDe = (n: Narration, plan: string) => {
  const l = n.lignes.find((x) => x.plan === plan && x.cible === 'carton');
  if (!l) throw new Error(`aucune ligne de narration pour le carton ${plan}`);
  return l;
};

const Carton: React.FC<{ n: Narration; plan: string }> = ({ n, plan }) => {
  const shot = n.plans[plan];
  const l = ligneDe(n, plan);
  // De combien d'images le carton precede-t-il la voix ? Le mot ne doit
  // apparaitre qu'a l'instant ou il est dit, pas a l'ouverture du carton.
  const decalage = Math.round(l.at * n.fps) - shot.from;
  return (
    <Sequence from={shot.from} durationInFrames={shot.duration}>
      <PaperTitleCard
        duration={shot.duration}
        words={l.mots.map((m) => ({ text: m.m }))}
        mots={l.mots}
        decalage={decalage}
      />
    </Sequence>
  );
};

export const RelancesMain: React.FC<{ narration: Narration; voix: string }> = ({ narration: n, voix }) => {
  useGeist();
  const P = n.plans;

  // Les instants d'allumage des cartes enumerees : les dates des mots de la
  // ligne qui les nomme, relatives au debut de son plan. Une phrase reecrite
  // deplace les allumages toute seule.
  const ligneEnum = n.lignes.find((l) => l.plan === 'enumere');
  const instants = (() => {
    if (!ligneEnum) return [0, 0, 0, 0];
    const base = Math.round(ligneEnum.at * n.fps) - P.enumere.from;
    // Un allumage par PHRASE de l'enumeration : on repere les mots qui suivent
    // un point, plus le premier.
    const departs: number[] = [];
    ligneEnum.mots.forEach((mot, k) => {
      const precedent = k > 0 ? ligneEnum.mots[k - 1].m : '';
      if (k === 0 || /[.!?]$/.test(precedent)) departs.push(base + Math.round(mot.t0 * n.fps));
    });
    while (departs.length < 4) departs.push(departs[departs.length - 1] || 0);
    return departs.slice(0, 4);
  })();

  return (
    <AbsoluteFill style={{ backgroundColor: '#eef2f8' }}>
      {/* LE MONTAGE DE LA VOIX SE FAIT ICI, PAR REMOTION.
          La prise est un enregistrement CONTINU : ses phrases s'enchainent au
          rythme de la synthese. Le film a des plans dont la duree est bornee par
          leur animation, donc ses phrases tombent a des instants DIFFERENTS. La
          table porte les deux horloges : `de`/`a` dans la prise, `at` dans le
          film. Jouer la prise entiere depuis l'image 0 revient a utiliser une
          horloge pour le son et l'autre pour l'image : l'ecart est nul au debut
          et se creuse a chaque plan (mesure : 6,9 s a la derniere phrase).
          On pose donc UN extrait par phrase, a son instant de film.

          Quatre montages ffmpeg ont echoue avant celui-ci, chacun rendant un
          fichier de la bonne duree partiellement muet. Remotion decoupe et pose
          nativement : il n'y a ni horodatage a negocier ni format a accorder. */}
      {n.lignes.map((l) => {
        const de = Math.max(0, Math.round((l.de - 0.05) * n.fps));
        const a = Math.round((l.a + 0.16) * n.fps);
        return (
          <Sequence
            key={`voix-${l.i}`}
            from={Math.round(l.at * n.fps)}
            durationInFrames={Math.max(2, a - de)}
          >
            <Audio src={staticFile(`audio/prise-${voix}.mp3`)} startFrom={de} endAt={a} />
          </Sequence>
        );
      })}

      <Sequence from={P.ouverture.from} durationInFrames={P.ouverture.duration}>
        <SceneOuverture duree={P.ouverture.duration} />
      </Sequence>
      <Sequence from={P.probleme.from} durationInFrames={P.probleme.duration}>
        <SceneProbleme duree={P.probleme.duration} />
      </Sequence>
      <Sequence from={P.sequences.from} durationInFrames={P.sequences.duration}>
        <SceneSequences duree={P.sequences.duration} />
      </Sequence>
      <Sequence from={P.enumere.from} durationInFrames={P.enumere.duration}>
        <SceneEnumere duree={P.enumere.duration} instants={instants} />
      </Sequence>
      <Sequence from={P.interrupteur.from} durationInFrames={P.interrupteur.duration}>
        <SceneInterrupteur duree={P.interrupteur.duration} />
      </Sequence>
      <Sequence from={P.creer.from} durationInFrames={P.creer.duration}>
        <SceneCreer duree={P.creer.duration} />
      </Sequence>
      <Carton n={n} plan="bascule" />
      <Sequence from={P.recu.from} durationInFrames={P.recu.duration}>
        <SceneRecu duree={P.recu.duration} />
      </Sequence>
      <Sequence from={P.veut.from} durationInFrames={P.veut.duration}>
        <SceneVeut duree={P.veut.duration} />
      </Sequence>
      <Sequence from={P.reponse.from} durationInFrames={P.reponse.duration}>
        <SceneReponse duree={P.reponse.duration} />
      </Sequence>
      <Sequence from={P.apprend.from} durationInFrames={P.apprend.duration}>
        <SceneApprend duree={P.apprend.duration} />
      </Sequence>
      <Carton n={n} plan="manque" />
      <Sequence from={P.outro.from} durationInFrames={P.outro.duration}>
        <SceneOutro duree={P.outro.duration} />
      </Sequence>

      {/* LES SOUS-TITRES PORTENT LE FILM, ILS NE L'ACCOMPAGNENT PAS.
          LinkedIn se regarde en silence. Le traitement reste donc le meme du
          debut a la fin (procede CONSTANT attache a un TYPE d'element), a halo
          et jamais dans une plaque opaque : une plaque est un trou dans
          l'image. */}
      {n.lignes.filter((l) => l.cible === 'bandeau').map((l) => {
        const from = Math.round(l.at * n.fps);
        const plan = P[l.plan];
        const finDuPlan = plan ? plan.from + plan.duration : n.total;
        // 24 images de tenue apres le dernier mot, MAIS jamais au-dela de la fin
        // du plan : un bandeau qui deborde se lit comme une coupe ratee.
        const duree = Math.max(12, Math.min(Math.round(l.duree * n.fps) + 24, finDuPlan - from - 2));
        return (
          <Sequence key={`nar-${l.i}`} from={from} durationInFrames={duree}>
            <NarrationCaption mots={l.mots} duree={duree} bas={52} taille={43} />
          </Sequence>
        );
      })}

      {/* Un accent sur CHAQUE coupe : un film qui change de plan sans que rien
          ne le marque se lit comme une suite de diapositives. */}
      {Object.values(P).map((s) => s.from).filter((f) => f > 0).map((cut) => (
        <Sequence key={cut} from={cut - 5} durationInFrames={10}>
          <FlashCut duration={10} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
