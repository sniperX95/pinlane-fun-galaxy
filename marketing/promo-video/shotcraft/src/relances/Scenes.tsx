// LES TREIZE PLANS, REDESSINES.
//
// Deux corrections de fond par rapport a la premiere version :
//
//   1. PLUS AUCUNE CAPTURE N'EST DEPLACEE A L'ECRAN. Chaque element est
//      redessine par `Interface.tsx` a partir des donnees lues dans le DOM.
//      C'est ce qui permet a un interrupteur de basculer, a un compteur de
//      rouler et a un texte de s'ecrire : rien de tout ca n'existe sur un
//      bitmap.
//   2. CHAQUE PLAN NE MONTRE QUE CE QUE SA PHRASE DIT. « Ce qu'on voit
//      visuellement c'est pas ce que le mec dit » : les phrases a deux idees
//      ont ete coupees en deux plans, et chaque plan a maintenant un seul sujet.
import React from 'react';
import { AbsoluteFill, interpolate, Img, staticFile, useCurrentFrame } from 'remotion';
import { BLEU, ENCRE, ATONE, ressort, monte, flou, ombre, derive, Halo, Reflet } from '../aifl/scene3d';
import {
  CarteSequence, LigneRecue, Puce, Champ, Etiquette, TexteQuiSEcrit,
  surface, TRAIT, VERT, Seq,
} from './Interface';
import LAYOUT from './live-layout.json';

export const COTE = 1080;
const SEQ = LAYOUT.donnees.sequences as unknown as Seq[];
const RECUS = LAYOUT.donnees.recus as unknown as { de: string; demande: string; statut: string }[];

// Le fond du film : celui du produit, MESURE, jamais choisi.
const FOND_PRODUIT = LAYOUT.fond as string;

// La grille des cartes : trois colonnes, deux rangs. Reproduire la bande de
// 1580 x 210 px de la page dans un cadre carre la rendait illisible (13 % de la
// hauteur). Les cartes sont redessinees, donc leur disposition est libre.
const COLS = 2;
const MARGE = 46;
const GOUT = 22;
const CASE_L = (COTE - MARGE * 2 - GOUT * (COLS - 1)) / COLS;
const CASE_H = 246;
const HAUT = 58;
const caseDe = (i: number) => ({
  x: MARGE + (i % COLS) * (CASE_L + GOUT),
  y: HAUT + Math.floor(i / COLS) * (CASE_H + GOUT),
});

// UN PLAN FIXE SE LIT COMME UNE IMAGE, PAS COMME UN FILM.
//
// Entre deux evenements, la grille etait figee : rien ne bougeait pendant deux
// ou trois secondes. On ajoute deux couches SOUS LE SEUIL DE CONSCIENCE, qui ne
// se remarquent pas une par une mais qui empechent le cadre de mourir.
//
// 1. LA RESPIRATION. Chaque carte flotte sur sa propre phase, avec des periodes
//    incommensurables : deux sinusoides de meme periode battent comme un
//    metronome et se voient. L'amplitude est de trois pixels, soit moins que ce
//    que l'oeil nomme.
const flotte = (frame: number, i: number) => {
  const a = Math.sin((frame / 30) * 0.62 + i * 1.7) * 3.0;
  const b = Math.sin((frame / 30) * 0.41 + i * 2.3) * 1.6;
  return { y: a + b, r: Math.sin((frame / 30) * 0.33 + i * 1.1) * 0.22 };
};

// 2. LA LUMIERE QUI DERIVE. Une tache tres floue qui traverse le fond en une
//    quarantaine de secondes. Elle ne se voit pas, elle empeche le fond d'etre
//    un aplat.
const Fond: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const x = 50 + Math.sin((frame / 30) * 0.16) * 26;
  const y = 42 + Math.cos((frame / 30) * 0.11) * 16;
  return (
    <AbsoluteFill style={{ background: FOND_PRODUIT, overflow: 'hidden', fontFamily: 'Geist' }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(88% 74% at ${x}% ${y}%, rgba(6,100,254,0.03) 0%, rgba(6,100,254,0) 72%)`,
        }}
      />
      {children}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// 1 · OUVERTURE
// ---------------------------------------------------------------------------
export const SceneOuverture: React.FC<{ duree: number }> = ({ duree }) => {
  const frame = useCurrentFrame();
  const p = ressort(frame, 3, 22);
  const mot = monte(frame, 15, 14);
  const d = derive(frame, 1.1, 260);
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(120% 90% at 50% 36%, #ffffff 0%, #eef4ff 60%, #dfe9fb 100%)' }}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', perspective: 1600 }}>
        <div style={{ transform: `rotateX(${d.rotX}deg) rotateY(${d.rotY}deg)`, textAlign: 'center' }}>
          <div style={{ position: 'relative', display: 'inline-block', transform: `scale(${0.72 + 0.28 * p})`, filter: flou(p, 12) }}>
            <Halo intensite={p * 0.8} taille={420} couleur={BLEU} />
            <Img src={staticFile('brand/picto.png')} style={{ width: 250, display: 'block', filter: `drop-shadow(${ombre(26)})` }} />
            <Reflet t={Math.min(1, Math.max(0, (frame - 18) / 26))} rayon={22} />
          </div>
          <div style={{
            marginTop: 32, fontFamily: 'Geist', fontWeight: 600, fontSize: 90,
            letterSpacing: '-0.035em', color: ENCRE,
            opacity: mot, transform: `translateY(${(1 - mot) * 20}px)`, filter: flou(mot, 8),
          }}>
            Pinlane
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// 2 · LE PROBLEME. « Il réserve, il vient, il repart. Et plus personne ne lui
//     écrit. » Trois etapes qui s'allument, une quatrieme qui reste eteinte :
//     c'est la phrase, dessinee.
// ---------------------------------------------------------------------------
export const SceneProbleme: React.FC<{ duree: number; instants: number[] }> = ({ duree, instants }) => {
  const frame = useCurrentFrame();
  // LES ETAPES S'ALLUMENT SUR LEUR MOT, pas a des images choisies a la main.
  // Le plan dure dix secondes parce que sa phrase en dure dix ; avec des images
  // fixes, tout se jouait dans les trois premieres et les sept suivantes etaient
  // mortes. Les instants viennent des mots « réserve », « vient », « repart ».
  const etapes = [
    { libelle: 'Il réserve', de: instants[0] },
    { libelle: 'Il vient', de: instants[1] },
    { libelle: 'Il repart', de: instants[2] },
  ];
  // Et la case vide arrive sur « plus personne ne lui écrit ».
  const vide = monte(frame, instants[3], 20);
  const battement = 0.5 + 0.5 * Math.sin((frame / 30) * Math.PI * 1.1);
  return (
    <Fond>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 26, flexDirection: 'column' }}>
        {etapes.map((e) => {
          const p = ressort(frame, e.de, 18);
          return (
            <div
              key={e.libelle}
              style={{
                ...surface(1),
                width: 620, padding: '26px 34px', boxSizing: 'border-box',
                display: 'flex', alignItems: 'center', gap: 20,
                opacity: Math.min(1, p * 1.5),
                transform: `translateY(${(1 - p) * 34}px) scale(${0.96 + 0.04 * p})`,
                filter: flou(p, 8),
              }}
            >
              <div style={{
                width: 34, height: 34, borderRadius: 999, flex: 'none',
                background: VERT, opacity: p,
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4), 0 2px 6px rgba(22,163,74,0.35)',
              }} />
              <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.022em', color: ENCRE }}>{e.libelle}</div>
            </div>
          );
        })}
        <div
          style={{
            width: 620, padding: '26px 34px', boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', gap: 20,
            border: `2px dashed ${TRAIT}`, borderRadius: 18,
            opacity: vide * (0.55 + 0.45 * battement),
            transform: `translateY(${(1 - vide) * 26}px)`,
          }}
        >
          <div style={{ width: 34, height: 34, borderRadius: 999, flex: 'none', border: '2px dashed #c9cfda' }} />
          <div style={{ fontSize: 34, fontWeight: 500, letterSpacing: '-0.022em', color: '#aeb6c4' }}>
            Personne ne lui écrit
          </div>
        </div>
      </AbsoluteFill>
    </Fond>
  );
};

// ---------------------------------------------------------------------------
// 3 · LES SIX SEQUENCES arrivent, redessinees. Elles tombent en quinconce, et
//     chaque interrupteur bascule a l'arrivee de SA carte.
// ---------------------------------------------------------------------------
export const SceneSequences: React.FC<{ duree: number }> = ({ duree }) => {
  const frame = useCurrentFrame();
  return (
    <Fond>
      {SEQ.map((s, i) => {
        const p = ressort(frame, 2 + i * 5, 20);
        const c = caseDe(i);
        return (
          <div
            key={s.titre}
            style={{
              position: 'absolute', left: c.x, top: c.y, width: CASE_L, height: CASE_H,
              opacity: Math.min(1, p * 1.5),
              transform: `translateY(${(1 - p) * 80 + flotte(frame, i).y * p}px)`
                + ` rotate(${flotte(frame, i).r * p}deg) scale(${0.93 + 0.07 * p})`,
              filter: flou(p, 9),
            }}
          >
            {/* L'interrupteur suit l'etat REEL de la sequence : la sixieme est
                eteinte dans le produit, elle l'est donc a l'image. */}
            <CarteSequence
              seq={s}
              actif={s.allumee ? monte(frame, 10 + i * 5, 12) : 0}
              compteur={monte(frame, 6 + i * 5, 20)}
              largeur={CASE_L}
            />
          </div>
        );
      })}
    </Fond>
  );
};

// ---------------------------------------------------------------------------
// 4 · L'ENUMERATION. Chaque carte se met en avant SUR SON MOT, les instants
//     venant de la narration. Une phrase reecrite deplace les mises en avant.
// ---------------------------------------------------------------------------
export const SceneEnumere: React.FC<{ duree: number; instants: number[] }> = ({ duree, instants }) => {
  const frame = useCurrentFrame();
  return (
    <Fond>
      {SEQ.map((s, i) => {
        const c = caseDe(i);
        const rang = [1, 2, 3, 4].indexOf(i);
        const depart = rang >= 0 ? instants[rang] : -999;
        const sb = rang >= 0 ? monte(frame, depart, 8) : 0;
        // La carte citee monte, les autres reculent : c'est le mouvement qui
        // designe, pas une couleur posee dessus.
        const recul = rang >= 0 ? 0 : interpolate(frame, [0, 14], [1, 0.34], { extrapolateRight: 'clamp' });
        return (
          <div
            key={s.titre}
            style={{
              position: 'absolute', left: c.x, top: c.y, width: CASE_L, height: CASE_H,
              opacity: rang >= 0 ? 0.44 + 0.56 * sb : recul,
              transform: `translateY(${-10 * sb + flotte(frame, i).y}px)`
                + ` rotate(${flotte(frame, i).r}deg) scale(${1 + 0.05 * sb})`,
              zIndex: sb > 0.3 ? 2 : 1,
            }}
          >
            <CarteSequence seq={s} actif={s.allumee ? 1 : 0} surbrillance={sb} largeur={CASE_L} />
          </div>
        );
      })}
    </Fond>
  );
};

// ---------------------------------------------------------------------------
// 5 · L'INTERRUPTEUR. « Chacune s'allume ou se coupe. » Une carte en grand, et
//     son interrupteur qui bascule pour de vrai, dans les deux sens.
// ---------------------------------------------------------------------------
export const SceneInterrupteur: React.FC<{ duree: number }> = ({ duree }) => {
  const frame = useCurrentFrame();
  const s = SEQ[2];
  const entree = ressort(frame, 2, 20);
  const actif = frame < 24 ? 1 : (frame < 48 ? 1 - monte(frame, 24, 9) : monte(frame, 48, 9));
  return (
    <Fond>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: 640, opacity: Math.min(1, entree * 1.5),
          transform: `scale(${0.9 + 0.1 * entree})`, filter: flou(entree, 8),
        }}>
          <CarteSequence seq={s} actif={actif} largeur={660} />
        </div>
        <div style={{
          marginTop: 36, opacity: monte(frame, 56, 14),
          fontSize: 31, color: ATONE, letterSpacing: '-0.01em',
        }}>
          Rien ne part sans toi
        </div>
      </AbsoluteFill>
    </Fond>
  );
};

// ---------------------------------------------------------------------------
// 6 · CREER LA SIENNE. Le plan qui repare le faux : le produit n'a pas six
//     sequences, il en a six pretes PLUS jusqu'a dix ecrites par le gerant.
//     Les libelles de declencheur sont ceux du serveur
//     (`CUSTOM_SEQUENCE_LIMITS`, lib/ops-communications.js).
// ---------------------------------------------------------------------------
export const SceneCreer: React.FC<{ duree: number }> = ({ duree }) => {
  const frame = useCurrentFrame();
  const carte = ressort(frame, 2, 20);
  const nom = interpolate(frame, [12, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const decl = monte(frame, 44, 12);
  const delai = monte(frame, 60, 12);
  const L = 680;
  return (
    <Fond>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            ...surface(1 + carte * 1.4),
            width: L, padding: 34, boxSizing: 'border-box',
            display: 'flex', flexDirection: 'column', gap: 20,
            opacity: Math.min(1, carte * 1.5),
            transform: `scale(${0.9 + 0.1 * carte})`, filter: flou(carte, 9),
            borderColor: BLEU,
          }}
        >
          <div style={{ fontSize: 27, fontWeight: 600, color: BLEU, letterSpacing: '-0.015em' }}>
            Nouvelle séquence
          </div>
          <div>
            <Etiquette texte="Nom" taille={21} />
            <Champ largeur={L - 68} padding={18}>
              <TexteQuiSEcrit texte="Relance des groupes" avancement={nom} taille={27} />
            </Champ>
          </div>
          <div style={{ opacity: decl, transform: `translateY(${(1 - decl) * 14}px)` }}>
            <Etiquette texte="Déclencheur" taille={21} />
            <Champ largeur={L - 68} padding={18}>
              <span style={{ fontSize: 27 }}>X jours après une visite</span>
            </Champ>
          </div>
          <div style={{ opacity: delai, transform: `translateY(${(1 - delai) * 14}px)`, display: 'flex', gap: 18 }}>
            <div>
              <Etiquette texte="Délai" taille={21} />
              <Champ largeur={(L - 68 - 18) / 2} padding={18}>
                <span style={{ fontSize: 27 }}>7 jours</span>
              </Champ>
            </div>
            <div>
              <Etiquette texte="Cible" taille={21} />
              <Champ largeur={(L - 68 - 18) / 2} padding={18}>
                <span style={{ fontSize: 27 }}>Fidèles</span>
              </Champ>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 32, opacity: monte(frame, 78, 14), fontSize: 29, color: ATONE }}>
          jusqu’à dix, en plus des six
        </div>
      </AbsoluteFill>
    </Fond>
  );
};

// ---------------------------------------------------------------------------
// 8 · UN CLIENT ECRIT. Le mail arrive, et rien d'autre ne se passe ici.
// ---------------------------------------------------------------------------
export const SceneRecu: React.FC<{ duree: number }> = ({ duree }) => {
  const frame = useCurrentFrame();
  const p = ressort(frame, 2, 20);
  return (
    <Fond>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: 820, ...surface(1 + p * 1.4), padding: 36, boxSizing: 'border-box',
          opacity: Math.min(1, p * 1.5), transform: `translateY(${(1 - p) * 44}px) scale(${0.94 + 0.06 * p})`,
          filter: flou(p, 9),
        }}>
          <Etiquette texte="Mail reçu" taille={22} />
          <div style={{ fontSize: 31, fontWeight: 600, letterSpacing: '-0.02em', color: ENCRE, marginBottom: 20 }}>
            Anniversaire pour ma fille
          </div>
          <TexteQuiSEcrit
            texte={'Bonjour,\n\nJe voudrais organiser l’anniversaire de ma fille,\nelle a 10 ans. On serait 12 enfants.\nEst-ce que vous avez de la place samedi après-midi ?'}
            avancement={interpolate(frame, [6, 42], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
            taille={27}
            couleur={ATONE}
          />
        </div>
      </AbsoluteFill>
    </Fond>
  );
};

// ---------------------------------------------------------------------------
// 9 · CE QU'IL VEUT. L'analyse se pose : la puce d'intention d'abord, le resume
//     ensuite, dans l'ordre ou on les lit.
// ---------------------------------------------------------------------------
export const SceneVeut: React.FC<{ duree: number }> = ({ duree }) => {
  const frame = useCurrentFrame();
  const bloc = ressort(frame, 3, 22);
  const puce = ressort(frame, 13, 18);
  const resume = interpolate(frame, [22, 48], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <Fond>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: 840, ...surface(1 + bloc * 1.6), padding: 38, boxSizing: 'border-box',
          borderColor: BLEU, opacity: Math.min(1, bloc * 1.5),
          transform: `scale(${0.9 + 0.1 * bloc})`, filter: flou(bloc, 10),
        }}>
          <Etiquette texte="Ce qu'il veut" taille={23} />
          <div style={{
            marginBottom: 22, opacity: Math.min(1, puce * 1.4),
            transform: `scale(${0.85 + 0.15 * puce})`, transformOrigin: 'left center',
          }}>
            <Puce texte="Anniversaire" taille={27} />
          </div>
          <TexteQuiSEcrit
            texte={'Anniversaire pour 12 enfants de 10 ans,\ndemande la disponibilité de samedi après-midi'}
            avancement={resume} taille={32} curseur={false}
          />
        </div>
      </AbsoluteFill>
    </Fond>
  );
};

// ---------------------------------------------------------------------------
// 10 · LA REPONSE DEJA ECRITE. Elle s'ECRIT : une reponse qui apparait d'un
//      coup ne se lit pas comme « elle est deja la ».
// ---------------------------------------------------------------------------
const REPONSE = 'Bonjour Julie,\n\nAvec plaisir. Pour 12 enfants de 10 ans, la formule\nanniversaire est la plus adaptée : elle comprend la piste,\nla boisson et le gâteau.';

export const SceneReponse: React.FC<{ duree: number }> = ({ duree }) => {
  const frame = useCurrentFrame();
  const bloc = ressort(frame, 2, 20);
  const corps = interpolate(frame, [10, 74], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <Fond>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: 860, ...surface(1 + bloc * 1.5), padding: 36, boxSizing: 'border-box',
          opacity: Math.min(1, bloc * 1.5), transform: `scale(${0.93 + 0.07 * bloc})`,
        }}>
          <Etiquette texte="Réponse proposée (IA)" taille={23} />
          <Champ largeur={860 - 72} padding={18}>
            <span style={{ fontSize: 27, fontWeight: 600 }}>Re: Anniversaire pour ma fille</span>
          </Champ>
          <div style={{ height: 16 }} />
          <Champ largeur={860 - 72} hauteur={250} padding={22}>
            <TexteQuiSEcrit texte={REPONSE} avancement={corps} taille={26} />
          </Champ>
        </div>
      </AbsoluteFill>
    </Fond>
  );
};

// ---------------------------------------------------------------------------
// 11 · L'AGENT APPREND. Un mot est remplace sous nos yeux, puis la pastille
//      arrive. Le surlignage vise le mot REEL : pose a un pourcentage de la
//      boite sur une capture, il tombait a cote.
// ---------------------------------------------------------------------------
export const SceneApprend: React.FC<{ duree: number }> = ({ duree }) => {
  const frame = useCurrentFrame();
  const bloc = monte(frame, 0, 14);
  const surligne = monte(frame, 14, 10);
  const efface = monte(frame, 30, 8);
  const ecrit = interpolate(frame, [40, 72], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const pastille = ressort(frame, 86, 20);
  return (
    <Fond>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 860, ...surface(1.4), padding: 36, boxSizing: 'border-box', opacity: bloc }}>
          <Etiquette texte="Réponse proposée (IA)" taille={23} />
          <Champ largeur={860 - 72} hauteur={240} padding={24}>
            <span style={{ fontSize: 27, lineHeight: 1.6, color: ENCRE, whiteSpace: 'pre-wrap' }}>
              {'Bonjour Julie,\n\nAvec plaisir. Pour 12 enfants de 10 ans, '}
              <span style={{
                background: `${BLEU}${surligne > 0.05 ? '26' : '00'}`,
                boxShadow: surligne > 0.05 ? `0 0 0 5px ${BLEU}18` : 'none',
                borderRadius: 5,
                opacity: 1 - efface,
              }}>
                la formule anniversaire
              </span>
              {efface > 0.9 ? (
                <span style={{ color: BLEU, fontWeight: 600 }}>
                  <TexteQuiSEcrit texte="notre formule Kids" avancement={ecrit} taille={27} couleur={BLEU} />
                </span>
              ) : null}
              {' est la plus adaptée.'}
            </span>
          </Champ>
          <div style={{
            marginTop: 28, display: 'flex', alignItems: 'center', gap: 16,
            opacity: Math.min(1, pastille * 1.4),
            transform: `translateY(${(1 - pastille) * 16}px)`,
          }}>
            <div style={{
              background: BLEU, color: '#fff', fontWeight: 600, fontSize: 26,
              padding: '11px 24px', borderRadius: 999, boxShadow: ombre(10),
            }}>
              retenu
            </div>
            <span style={{ fontSize: 25, color: ATONE }}>la fois d’après, il écrira comme ça</span>
          </div>
        </div>
      </AbsoluteFill>
    </Fond>
  );
};

// ---------------------------------------------------------------------------
// 13 · SIGNATURE. Les cartes reviennent en retrait autour du logotype.
// ---------------------------------------------------------------------------
export const SceneOutro: React.FC<{ duree: number }> = ({ duree }) => {
  const frame = useCurrentFrame();
  const p = ressort(frame, 2, 22);
  const d = derive(frame, 1.0, 240);
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(120% 90% at 50% 42%, #ffffff 0%, #eef4ff 62%, #dbe7fa 100%)', fontFamily: 'Geist' }}>
      {SEQ.map((s, i) => {
        const a = monte(frame, 5 + i * 3, 16);
        const angle = -68 + i * 27;
        const r = 450;
        return (
          <div
            key={s.titre}
            style={{
              position: 'absolute',
              left: COTE / 2 + Math.cos((angle * Math.PI) / 180) * r - 130,
              top: COTE / 2 + Math.sin((angle * Math.PI) / 180) * r - 82,
              width: 260, opacity: a * 0.2,
              transform: `scale(${0.9 + 0.1 * a}) rotate(${(i - 2.5) * 2}deg)`,
            }}
          >
            <CarteSequence seq={s} actif={s.allumee ? 1 : 0} largeur={260} />
          </div>
        );
      })}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', perspective: 1600 }}>
        <div style={{ transform: `rotateX(${d.rotX}deg) rotateY(${d.rotY}deg)`, textAlign: 'center' }}>
          <div style={{ position: 'relative', display: 'inline-block', transform: `scale(${0.84 + 0.16 * p})` }}>
            <Halo intensite={p} taille={460} couleur={BLEU} />
            <Img src={staticFile('brand/picto.png')} style={{ width: 205, display: 'block', filter: `drop-shadow(${ombre(22)})` }} />
          </div>
          <div style={{
            marginTop: 26, fontWeight: 600, fontSize: 82,
            letterSpacing: '-0.035em', color: ENCRE, opacity: monte(frame, 9, 14),
          }}>
            Pinlane
          </div>
          <div style={{
            marginTop: 12, fontWeight: 500, fontSize: 29,
            letterSpacing: '-0.01em', color: ATONE, opacity: monte(frame, 19, 16),
          }}>
            Abonne-toi, je montre la suite
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
