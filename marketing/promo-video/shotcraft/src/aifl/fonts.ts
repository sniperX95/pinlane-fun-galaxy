import { useEffect, useState } from 'react';
import { continueRender, delayRender } from 'remotion';
import { GEIST_MONO_B64, GEIST_SANS_B64 } from './geist-inline';

// GEIST, LA POLICE DE LA MARQUE. INTEGREE, ET ATTENDUE DANS LE COMPOSANT.
//
// Deux defauts payes ici, dans cet ordre :
//
// 1. CHARGEE PAR URL, ELLE FAISAIT EXPIRER LE RENDU. Remotion ouvre plusieurs
//    onglets ; sur un film long la requete echouait parfois, et
//    `document.fonts.load` NE REJETTE PAS quand le fichier n'arrive pas : elle
//    resout avec une liste vide. Les fichiers sont donc INLINES en base64
//    (`geist-inline.ts`) : une police en `data:` ne peut pas ne pas arriver.
//
// 2. `delayRender` APPELE AU CHARGEMENT DU MODULE n'appartient a aucun passage de
//    rendu. Le symptome etait deroutant : le rendu d'une image seule marchait, le
//    rendu complet mourait apres 58 s sur « A delayRender() "Geist" was called
//    but not cleared », et aucun de mes messages n'apparaissait dans le journal ,
//    parce que la promesse ne se terminait meme pas. C'est un HOOK maintenant :
//    la reservation se fait dans le contexte de rendu, comme le veut le patron
//    documente de Remotion.
//
// Et pourquoi verifier du tout : declarer `font-family: Geist` ne charge rien.
// C'est exactement ce qui a fait passer la page de vente pour « cheap » pendant
// six iterations : le CSS reclamait Geist, aucun `@font-face` ne la fournissait,
// et tous les titres sortaient en Segoe UI. `getComputedStyle` ne le montre pas :
// il renvoie la DECLARATION, pas la police resolue.

const CSS = `
@font-face {
  font-family: 'Geist';
  src: url('data:font/woff2;base64,${GEIST_SANS_B64}') format('woff2');
  font-weight: 100 900;
  font-display: block;
}
@font-face {
  font-family: 'Geist Mono';
  src: url('data:font/woff2;base64,${GEIST_MONO_B64}') format('woff2');
  font-weight: 100 900;
  font-display: block;
}
`;

let injecte = false;
const injecter = () => {
  if (injecte || typeof document === 'undefined') return;
  injecte = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
};

const mesurer = (police: string) => {
  const c = document.createElement('canvas').getContext('2d');
  if (!c) return null;                 // sonde indisponible : elle ne conclut rien
  c.font = `620 96px ${police}`;
  return c.measureText('PINLANE 76 % 4 288 €').width;
};

export const useGeist = () => {
  const [attente] = useState(() => {
    injecter();
    return delayRender('Geist', { timeoutInMilliseconds: 60000 });
  });

  useEffect(() => {
    let vivant = true;
    Promise.all([
      document.fonts.load(`620 96px 'Geist'`),
      document.fonts.load(`400 96px 'Geist Mono'`),
    ])
      .then(() => {
        // `document.fonts.check` est l'autorite : il repond sur la police
        // REELLEMENT disponible. La mesure de largeur n'est qu'un second avis.
        if (!document.fonts.check(`620 96px 'Geist'`)) {
          // eslint-disable-next-line no-console
          console.error('GEIST-ABSENTE : check() dit non apres chargement');
        } else {
          const geist = mesurer(`'Geist', monospace`);
          const secours = mesurer('monospace');
          if (geist !== null && secours !== null && geist > 0 && geist === secours) {
            // eslint-disable-next-line no-console
            console.error(`GEIST-ABSENTE : meme largeur que le secours (${geist} px)`);
          }
        }
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error('GEIST-ABSENTE :', e && e.message ? e.message : e);
      })
      .finally(() => {
        // ON LIBERE TOUJOURS. Relancer l'erreur laissait le `delayRender`
        // suspendu : le rendu mourait sur un timeout qui ne disait rien de la
        // cause. Une garde qui masque ce qu'elle detecte est pire que pas de
        // garde : la verification se fait en cherchant « GEIST-ABSENTE » dans le
        // journal de rendu.
        if (vivant) continueRender(attente);
      });
    return () => { vivant = false; continueRender(attente); };
  }, [attente]);
};
