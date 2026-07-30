import NARRATION from './narration.json';

// LA TABLE DE PLANS VIENT DE LA NARRATION.
//
// Elle etait ecrite ici a la main. Elle est maintenant CALCULEE par
// `scripts/promo-narration.js` puis lue depuis `narration.json`, pour une raison
// mesuree : la duree d'une phrase varie d'environ 10 % d'un appel de synthese a
// l'autre (une meme phrase a mesure 2,29 s puis 2,91 s). Les cartons, qui n'ont
// pas d'animation a figer, prennent donc exactement la duree que leur phrase
// exige, et les plans produit gardent la leur avec une queue elastique de 20
// images. Tenir cette table separement de la voix la ferait deriver — c'est
// exactement le defaut qu'on vient de corriger sur les sous-titres.
//
// Ordre : marque+planning · probleme · ce qu'il coute · basculement ·
// distribution+recherche · arrivees · action a prendre · dossiers · le soir ·
// tableau de bord · benefice · signature+appel a l'action.

type Plan = { from: number; duration: number };

export const AIFL_SHOTS = NARRATION.plans as unknown as {
  morning: Plan; cardA: Plan; cardB: Plan; card1: Plan; table: Plan; macro: Plan;
  card2: Plan; chart: Plan; cardWbr: Plan; wbr: Plan; card3: Plan; outro: Plan;
};

export const AIFL_TOTAL: number = NARRATION.total;
