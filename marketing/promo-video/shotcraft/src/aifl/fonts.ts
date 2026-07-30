import { continueRender, delayRender, staticFile } from 'remotion';

// GEIST, LA POLICE DE LA MARQUE — CHARGEE ET VERIFIEE.
//
// Declarer `font-family: Geist` ne charge rien. C'est exactement le defaut qui a
// fait passer la page de vente pour « cheap » pendant six iterations : le CSS
// reclamait Geist, aucun `@font-face` ne la fournissait, et tous les titres
// s'affichaient en Segoe UI. `getComputedStyle` ne le montre pas — il renvoie la
// DECLARATION, pas la police resolue.
//
// Ici on fait donc deux choses : on bloque le rendu jusqu'a ce que les fichiers
// soient charges, et on MESURE la largeur d'un meme texte dans Geist puis dans
// une police de secours volontairement differente. Largeurs egales = le fichier
// n'est pas arrive, et le rendu s'arrete au lieu de sortir 1085 images dans la
// mauvaise police.

const CSS = `
@font-face {
  font-family: 'Geist';
  src: url('${staticFile('brand/geist-latin.woff2')}') format('woff2');
  font-weight: 100 900;
  font-display: block;
}
@font-face {
  font-family: 'Geist Mono';
  src: url('${staticFile('brand/geist-mono-latin.woff2')}') format('woff2');
  font-weight: 100 900;
  font-display: block;
}
`;

let pose = false;

export const chargerGeist = () => {
  if (pose || typeof document === 'undefined') return;
  pose = true;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const attente = delayRender('Geist', { timeoutInMilliseconds: 60000 });

  const mesurer = (police: string) => {
    const c = document.createElement('canvas').getContext('2d');
    if (!c) return null;               // pas de contexte : on ne conclut rien
    c.font = `620 96px ${police}`;
    return c.measureText('PINLANE 76 % 4 288 €').width;
  };

  Promise.all([
    document.fonts.load(`620 96px 'Geist'`),
    document.fonts.load(`400 96px 'Geist Mono'`),
  ])
    .then(() => {
      // `document.fonts.check` est l'autorite : il repond sur la police
      // REELLEMENT disponible. La mesure de largeur ne sert que de second avis.
      if (!document.fonts.check(`620 96px 'Geist'`)) {
        throw new Error('Geist absente apres chargement — verifier public/brand/geist-latin.woff2');
      }
      // La mesure a d'abord ete la seule preuve, et elle faisait ECHOUER le
      // rendu complet : Remotion ouvre plusieurs onglets en parallele et
      // `getContext('2d')` y renvoie parfois null, ce que je lisais comme
      // « police absente ». Une sonde indisponible n'est pas un echec — elle est
      // seulement muette.
      const geist = mesurer(`'Geist', monospace`);
      const secours = mesurer('monospace');
      if (geist !== null && secours !== null && geist > 0 && geist === secours) {
        throw new Error(`Geist non appliquee : meme largeur que le secours (${geist} px)`);
      }
      continueRender(attente);
    })
    .catch((e) => {
      // Un echec de police ARRETE le rendu : sortir 1085 images en Segoe UI est
      // exactement le defaut qu'on rend impossible ici.
      // eslint-disable-next-line no-console
      console.error(e);
      throw e;
    });
};
