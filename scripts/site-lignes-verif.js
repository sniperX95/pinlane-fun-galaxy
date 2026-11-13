'use strict';
// LA BONNE LIGNE SUR LA BONNE PAGE. Lit les 15 pages publiques de fungalaxy.be (lecture seule, comme un visiteur) et dit,
// page par page et selon le centre deja choisi par le visiteur (cookie du site), quel formulaire est servi et quel
// centre Pinlane il reserve. Avant la pose : Gravity Forms 4 = Libramont, 1 = Gembloux. Apres : data-center de la ligne.
//
// Lancement : node scripts/site-lignes-verif.js        (a relancer juste apres la pose des deux lignes)
const SITE = process.env.SITE_FUNGALAXY || 'https://fungalaxy.be';
const PAGES = [
  ['/contact/', null],
  ['/activites/arcades-gembloux/', 'gembloux'],
  ['/activites/billard-gembloux/', 'gembloux'],
  ['/activites/bowling-gembloux/', 'gembloux'],
  ['/activites/golf-oclock/', 'gembloux'],
  ['/activites/laser-game-gembloux/', 'gembloux'],
  ['/activites/minigolf-blacklight-gembloux/', 'gembloux'],
  ['/activites/arcades/', 'libramont'],
  ['/activites/billards/', 'libramont'],
  ['/activites/bowling/', 'libramont'],
  ['/activites/duckpin-bowling/', 'libramont'],
  ['/activites/fun-run-by-pixel/', 'libramont'],
  ['/activites/laser-game/', 'libramont'],
  ['/activites/minigolf-blacklight/', 'libramont'],
  ['/activites/plaine-de-jeux/', 'libramont'],
];
const FORMULAIRES = { 1: 'gembloux', 4: 'libramont' };
const COOKIES = [['aucun choix', ''], ['a choisi Gembloux', 'guest_selection=Gembloux'], ['a choisi Libramont', 'guest_selection=Libramont']];

async function lire(chemin, cookie) {
  const r = await fetch(SITE + chemin, { headers: { 'User-Agent': 'Pinlane verification (lecture seule)', ...(cookie ? { Cookie: cookie } : {}) }, redirect: 'follow' });
  return { statut: r.status, html: await r.text() };
}
function ceQuiEstServi(html) {
  const lignes = [...html.matchAll(/<script[^>]*embed\.js[^>]*>/gi)].map((m) => {
    const c = m[0].match(/data-center\s*=\s*["']?([a-z0-9-]+)/i);
    return c ? c[1].toLowerCase() : '(sans centre)';
  });
  const formulaires = [...new Set([...html.matchAll(/gform_wrapper_(\d+)/g)].map((m) => Number(m[1])))].filter((n) => FORMULAIRES[n]);
  // La copie pendant l essai (data-miroir, 2026-11-13) : le formulaire qu elle remplit doit etre CELUI de la page,
  // et celui du meme centre (un « #gform_1 » colle dans le formulaire 4 ne recopierait rien).
  const miroirs = [...new Set([...html.matchAll(/<script[^>]*embed\.js[^>]*>/gi)].map((m) => (m[0].match(/data-miroir\s*=\s*["']?#gform_(\d+)/i) || [])[1]).filter(Boolean).map(Number))];
  return { lignes: [...new Set(lignes)], formulaires, miroirs };
}

(async () => {
  let ecarts = 0;
  let posees = 0;
  for (const [chemin, attendu] of PAGES) {
    const dit = [];
    for (const [nom, cookie] of COOKIES) {
      const { statut, html } = await lire(chemin, cookie);
      const s = ceQuiEstServi(html);
      const centres = s.lignes.length ? s.lignes : s.formulaires.map((n) => FORMULAIRES[n]);
      if (s.lignes.length) posees += 1;
      const copie = s.miroirs.length ? `, copie dans le formulaire ${s.miroirs.join('+')}` : ', sans copie';
      const quoi = s.lignes.length ? `ligne Pinlane ${s.lignes.join('+')}${copie}` : (s.formulaires.length ? `Gravity ${s.formulaires.join('+')} (${centres.join('+')})` : 'aucun');
      // Une page d activite appartient a un centre, quel que soit le choix du visiteur ; Contact suit son choix.
      const cible = attendu || (cookie.includes('Gembloux') ? 'gembloux' : cookie.includes('Libramont') ? 'libramont' : null);
      const copieFausse = s.miroirs.some((n) => !s.formulaires.includes(n) || FORMULAIRES[n] !== centres[0]);
      const faux = statut >= 400 || copieFausse || (cible && centres.length && !(centres.length === 1 && centres[0] === cible));
      if (faux) ecarts += 1;
      dit.push(`${faux ? 'ECART ' : ''}${nom} : ${quoi}`);
      await new Promise((ok) => setTimeout(ok, 150));
    }
    console.log(`${chemin.padEnd(44)} ${attendu || '(selon le choix)'}\n    ${dit.join('\n    ')}`);
  }
  console.log(`\n${ecarts ? `${ecarts} ECART(S)` : 'Aucun ecart'} ; ${posees ? `ligne Pinlane vue ${posees} fois` : 'ligne Pinlane pas encore posee'}.`);
  process.exit(ecarts ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
