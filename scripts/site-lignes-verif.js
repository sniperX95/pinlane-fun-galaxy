'use strict';
// LA BONNE LIGNE SUR LA BONNE PAGE. Lit les 16 pages publiques de fungalaxy.be (lecture seule, comme un visiteur) et dit,
// page par page et selon le centre deja choisi par le visiteur (cookie du site), quel formulaire est servi et quel
// centre Pinlane il reserve. Avant la pose : Gravity Forms 4 = Libramont, 1 = Gembloux. Apres : data-center de la ligne.
// La page Evenements (2026-11-24) sert le formulaire 3 a Libramont et le 2 a Gembloux ; sa ligne ouvre la demande de groupe
// (data-start="sur-mesure"), et une ligne d un autre centre ou sans cet attribut est un ecart.
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
  ['/evenements/', null],
];
const EVENEMENTS = '/evenements/';
const FORMULAIRES_RESERVATION = { 1: 'gembloux', 4: 'libramont' };
const FORMULAIRES_EVENEMENTS = { 2: 'gembloux', 3: 'libramont' };
const formulairesDe = (chemin) => (chemin === EVENEMENTS ? FORMULAIRES_EVENEMENTS : FORMULAIRES_RESERVATION);
const COOKIES = [['aucun choix', ''], ['a choisi Gembloux', 'guest_selection=Gembloux'], ['a choisi Libramont', 'guest_selection=Libramont']];

async function lire(chemin, cookie) {
  const r = await fetch(SITE + chemin, { headers: { 'User-Agent': 'Pinlane verification (lecture seule)', ...(cookie ? { Cookie: cookie } : {}) }, redirect: 'follow' });
  return { statut: r.status, html: await r.text() };
}
function ceQuiEstServi(html, chemin) {
  const FORMULAIRES = formulairesDe(chemin);
  const balises = [...html.matchAll(/<script[^>]*embed\.js[^>]*>/gi)].map((m) => m[0]);
  const lignes = balises.map((b) => {
    const c = b.match(/data-center\s*=\s*["']?([a-z0-9-]+)/i);
    return c ? c[1].toLowerCase() : '(sans centre)';
  });
  // La demande de groupe ouverte d entree de jeu : la page Evenements l attend, les autres ne l attendent pas.
  const departs = balises.filter((b) => /data-start\s*=\s*["']?sur-mesure/i.test(b)).length;
  const formulaires = [...new Set([...html.matchAll(/gform_wrapper_(\d+)/g)].map((m) => Number(m[1])))].filter((n) => FORMULAIRES[n]);
  // La copie pendant l essai (data-miroir, 2026-11-13) : le formulaire qu elle remplit doit etre CELUI de la page,
  // et celui du meme centre (un « #gform_1 » colle dans le formulaire 4 ne recopierait rien).
  const miroirs = [...new Set([...html.matchAll(/<script[^>]*embed\.js[^>]*>/gi)].map((m) => (m[0].match(/data-miroir\s*=\s*["']?#gform_(\d+)/i) || [])[1]).filter(Boolean).map(Number))];
  return { lignes: [...new Set(lignes)], formulaires, miroirs, departs, nbLignes: balises.length };
}

(async () => {
  let ecarts = 0;
  let posees = 0;
  for (const [chemin, attendu] of PAGES) {
    const dit = [];
    for (const [nom, cookie] of COOKIES) {
      const { statut, html } = await lire(chemin, cookie);
      const FORMULAIRES = formulairesDe(chemin);
      const s = ceQuiEstServi(html, chemin);
      const centres = s.lignes.length ? s.lignes : s.formulaires.map((n) => FORMULAIRES[n]);
      if (s.lignes.length) posees += 1;
      const copie = s.miroirs.length ? `, copie dans le formulaire ${s.miroirs.join('+')}` : ', sans copie';
      const quoi = s.lignes.length ? `ligne Pinlane ${s.lignes.join('+')}${s.departs ? ', demande de groupe' : ''}${copie}` : (s.formulaires.length ? `Gravity ${s.formulaires.join('+')} (${centres.join('+')})` : 'aucun');
      // Une page d activite appartient a un centre, quel que soit le choix du visiteur ; Contact suit son choix.
      const cible = attendu || (cookie.includes('Gembloux') ? 'gembloux' : cookie.includes('Libramont') ? 'libramont' : null);
      const copieFausse = s.miroirs.some((n) => !s.formulaires.includes(n) || FORMULAIRES[n] !== centres[0]);
      // Evenements : la ligne doit nommer le centre du formulaire servi, et ouvrir la demande de groupe. Ailleurs : jamais.
      const departFaux = s.lignes.length > 0 && (chemin === EVENEMENTS ? s.departs !== s.nbLignes : s.departs > 0);
      const centreFaux = chemin === EVENEMENTS && s.lignes.length > 0 && s.formulaires.length > 0 && (s.lignes.length !== 1 || s.lignes[0] !== FORMULAIRES[s.formulaires[0]]);
      const faux = statut >= 400 || copieFausse || departFaux || centreFaux || (cible && centres.length && !(centres.length === 1 && centres[0] === cible));
      if (faux) ecarts += 1;
      dit.push(`${faux ? 'ECART ' : ''}${nom} : ${quoi}`);
      await new Promise((ok) => setTimeout(ok, 150));
    }
    console.log(`${chemin.padEnd(44)} ${attendu || '(selon le choix)'}\n    ${dit.join('\n    ')}`);
  }
  console.log(`\n${ecarts ? `${ecarts} ECART(S)` : 'Aucun ecart'} ; ${posees ? `ligne Pinlane vue ${posees} fois` : 'ligne Pinlane pas encore posee'}.`);
  process.exit(ecarts ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
