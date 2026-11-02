// LA SONDE PREVIENT UNE FOIS, ET SEULEMENT POUR UNE VRAIE PANNE (2026-11-02).
//
// La sonde vit sur un Worker Cloudflare (workers/sonde-prod/sonde.mjs) : ce gate
// la joue contre un faux site servi depuis les VRAIES pages du depot, sans
// reseau, sans base, sans envoi.
//
// CE QUE CE GATE PROUVE :
//   [A] prod saine : aucun message, aucune ecriture de l etat, et les marqueurs
//       que la sonde attend existent dans les pages du depot (renommer un
//       fichier rougit ici, pas sur le telephone de Movsar a 3 h du matin) ;
//   [B] une panne de 10 passages : exactement une alerte, au 3e, puis un seul
//       retour apres 3 passages verts, avec la duree ;
//   [C] un hoquet de 1 ou 2 passages : aucun message ; un echec guerit par le
//       second essai du meme passage : ne compte meme pas ;
//   [D] le reseau de la sonde coupe (controles morts aussi), 20 passages : aucun
//       message, l etat ne bouge pas ; une limite de debit non plus ;
//   [E] une panne qui clignote : une alerte, un retour, pas dix ;
//   [F] un 200 ne suffit pas : HTML sur une route JSON, ok:false, catalogue
//       vide, base morte, quatre samedis sans creneau, un fichier de page
//       absent, une page sans son contenu sont des pannes ; un samedi vide n en
//       est pas une ;
//   [G] le 402 du 19/08 se nomme et donne le lien de facturation ;
//   [H] le canal en panne : l alerte reste due, part au passage suivant, une fois ;
//   [I] le fond (la base) ne se joue qu aux minutes qui suivent le cron secours,
//       Neon dort ; sur un passage suspect il se joue tout de suite ; aucun POST ;
//   [J] le bilan du lundi part meme sans panne, et dit la derniere ;
//   [K] la simulation vise un chemin mort et marque ses messages.
//
// Usage : node scripts/sonde-prod-check.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'workers', 'sonde-prod', 'sonde.mjs');

// La sonde journalise chaque passage pour Cloudflare : ici, ce serait du bruit.
const imprimer = console.log.bind(console);
console.log = (...texte) => { if (!String(texte[0]).startsWith('{"verdict"')) imprimer(...texte); };

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

const lirePage = (fichier) => fs.readFileSync(path.join(ROOT, fichier), 'utf8');
const PAGES = {
  '/fungalaxy/libramont': lirePage('fungalaxy.html'),
  '/': lirePage('index.html'),
  '/menu/libramont/': lirePage('menu/libramont/index.html'),
  '/menu/gembloux/': lirePage('menu/gembloux/index.html'),
};

const reponse = (corps, statut = 200, type = 'text/html; charset=utf-8', entetes = {}) => new Response(corps, {
  status: statut,
  headers: { 'content-type': type, ...entetes },
});
const json = (corps, statut = 200) => reponse(JSON.stringify(corps), statut, 'application/json; charset=utf-8');
const SAIN = {
  sante: () => json({ ok: true, db: true }),
  catalogue: () => json({ ok: true, formules: [{ id: 'anniversaire' }], center: { id: 'libramont' } }),
  creneaux: () => json({ ok: true, slots: [{ time: '10:00' }] }),
};

// Le faux site. `panne(url, options)` rend une reponse pour casser cette adresse,
// ou rien pour la laisser saine ; il peut lever pour simuler une coupure.
function fauxSite(panne = () => null, journal = []) {
  return async (url, options = {}) => {
    journal.push({ url, methode: options.method || 'GET' });
    const cassee = await panne(url, options);
    if (cassee) return cassee;
    const { pathname } = new URL(url);
    if (url.includes('google.com') || url.includes('api.github.com')) return reponse('', 200, 'text/plain');
    if (pathname === '/api/healthz') return SAIN.sante();
    if (pathname === '/api/public-booking-meta') return SAIN.catalogue();
    if (pathname === '/api/public-availability') return SAIN.creneaux();
    if (PAGES[pathname]) return reponse(PAGES[pathname]);
    if (/\.js$/.test(pathname)) return reponse('//', 200, 'application/javascript; charset=utf-8');
    if (/\.css$/.test(pathname)) return reponse('', 200, 'text/css; charset=utf-8');
    return reponse('Unauthorized', 401, 'text/plain');
  };
}

function fauxKv() {
  const valeurs = new Map();
  return {
    ecritures: 0,
    valeurs,
    get: async (cle) => (valeurs.has(cle) ? valeurs.get(cle) : null),
    async put(cle, valeur) { this.ecritures += 1; valeurs.set(cle, valeur); },
  };
}

const coupure = () => { throw Object.assign(new Error('coupure'), { name: 'TimeoutError' }); };
const toutCasse = (url) => (url.includes('google.com') || url.includes('api.github.com') ? null : reponse('oups', 503));
const toutCoupe = () => coupure();
const SAMEDI = Date.parse('2026-11-04T09:06:00Z'); // minute 6 : surface seule

// Joue une suite de passages espaces de 5 minutes et rend ce qui est parti.
async function jouer(sonde, { kv = fauxKv(), passages, envoyer, depart = SAMEDI }) {
  const messages = [];
  let instant = depart;
  const resultats = [];
  for (const panne of passages) {
    // eslint-disable-next-line no-await-in-loop
    resultats.push(await sonde.passage({
      kv,
      fetcher: fauxSite(panne),
      maintenant: instant,
      attendre: async () => {},
      envoyer: envoyer || (async (texte) => { messages.push(texte); }),
    }));
    instant += 5 * 60_000;
  }
  return { messages, kv, resultats };
}

const fois = (n, valeur) => Array.from({ length: n }, () => valeur);
const sain = () => null;

async function preuves(sonde) {
  const resultat = {};

  // [A]
  const saine = await jouer(sonde, { passages: fois(30, sain) });
  ok(saine.messages.length === 0, '[A] prod saine : aucun message sur 30 passages');
  ok(saine.kv.ecritures <= 1, '[A] prod saine : l etat ne s ecrit qu une fois', `${saine.kv.ecritures}`);
  const vue = await sonde.sonder({ fetcher: fauxSite(), maintenant: SAMEDI, attendre: async () => {} });
  ok(vue.verdict === 'ok', '[A] les marqueurs de la sonde existent dans les pages du depot', JSON.stringify(vue.casses));

  // [B]
  const panne = await jouer(sonde, { passages: [...fois(10, toutCasse), ...fois(3, sain)] });
  resultat.panneMessages = panne.messages.length;
  ok(panne.messages.length === 2, '[B] 10 passages casses, 3 verts : deux messages et pas plus', `${panne.messages.length}`);
  ok(/^PANNE Pinlane/.test(panne.messages[0] || ''), '[B] le premier dit la panne');
  ok(/page de réservation \(HTTP 503\)/.test(panne.messages[0] || ''), '[B] et ce qui est casse', panne.messages[0]);
  ok(/^RETOUR Pinlane/.test(panne.messages[1] || ''), '[B] le second dit le retour');
  ok(/Panne de 1 h 00/.test(panne.messages[1] || ''), '[B] avec la duree', panne.messages[1]);
  const envoisAuTroisieme = await jouer(sonde, { passages: fois(3, toutCasse) });
  ok(envoisAuTroisieme.messages.length === 1, '[B] l alerte part au 3e passage');
  const deuxPassages = await jouer(sonde, { passages: fois(2, toutCasse) });
  ok(deuxPassages.messages.length === 0, '[B] pas au 2e');

  // [C]
  const hoquet = await jouer(sonde, { passages: [toutCasse, sain, toutCasse, toutCasse, sain, sain, toutCasse, sain] });
  resultat.hoquetMessages = hoquet.messages.length;
  ok(hoquet.messages.length === 0, '[C] des hoquets de 1 ou 2 passages : aucun message', `${hoquet.messages.length}`);
  let essais = 0;
  const secondEssai = await jouer(sonde, { passages: fois(5, (url) => {
    if (!url.includes('/fungalaxy/libramont')) return null;
    essais += 1;
    return essais % 2 ? reponse('oups', 503) : null;
  }) });
  ok(secondEssai.messages.length === 0, '[C] gueri au second essai : ne compte pas');
  ok(JSON.parse(secondEssai.kv.valeurs.get('etat')).echecs === 0, '[C] compteur a zero');

  // [D]
  const reseau = await jouer(sonde, { passages: fois(20, toutCoupe) });
  resultat.reseauMessages = reseau.messages.length;
  ok(reseau.messages.length === 0, '[D] reseau de la sonde coupe, 20 passages : aucun message', `${reseau.messages.length}`);
  ok(JSON.parse(reseau.kv.valeurs.get('etat') || '{"echecs":0}').echecs === 0, '[D] l etat ne bouge pas');
  const limite = await jouer(sonde, { passages: fois(6, (url) => (url.includes('/menu/') ? reponse('{}', 429, 'application/json') : null)) });
  ok(limite.messages.length === 0, '[D] une limite de debit n est pas une panne');
  const siteSeulCoupe = await jouer(sonde, { passages: fois(3, (url) => (url.includes('google.com') || url.includes('api.github.com') ? null : coupure())) });
  ok(siteSeulCoupe.messages.length === 1 && /délai dépassé/.test(siteSeulCoupe.messages[0]), '[D] controles vivants et site coupe : c est une panne');

  // [E]
  const clignote = await jouer(sonde, { passages: [...fois(3, toutCasse), sain, toutCasse, sain, sain, toutCasse, ...fois(3, sain)] });
  resultat.clignoteMessages = clignote.messages.length;
  ok(clignote.messages.length === 2, '[E] une panne qui clignote : une alerte, un retour', `${clignote.messages.length}`);

  // [F]
  const estPanne = async (nom, casse) => {
    const vu = await sonde.sonder({ fetcher: fauxSite(casse), maintenant: SAMEDI, attendre: async () => {} });
    return ok(vu.verdict === 'ko', `[F] ${nom}`, JSON.stringify(vu.casses));
  };
  await estPanne('une page HTML sur une route JSON', (url) => (url.includes('/api/public-booking-meta') ? reponse('<html>ok</html>') : null));
  await estPanne('ok:false en 200', (url) => (url.includes('/api/public-availability') ? json({ ok: false, message: 'non' }) : null));
  await estPanne('catalogue vide en 200', (url) => (url.includes('/api/public-booking-meta') ? json({ ok: true, formules: [], center: { id: 'libramont' } }) : null));
  await estPanne('catalogue d un autre centre', (url) => (url.includes('/api/public-booking-meta') ? json({ ok: true, formules: [{}], center: { id: 'gembloux' } }) : null));
  await estPanne('base morte', (url) => (url.includes('/api/healthz') ? json({ ok: false, db: false }, 503) : null));
  await estPanne('quatre samedis sans creneau', (url) => (url.includes('/api/public-availability') ? json({ ok: true, slots: [] }) : null));
  await estPanne('le fichier de la page absent', (url) => (url.includes('fungalaxy-booking.js') ? reponse('non', 404, 'text/plain') : null));
  await estPanne('un fichier servi en page HTML', (url) => (url.includes('fungalaxy-booking.css') ? reponse('<html>') : null));
  await estPanne('une page sans son contenu', (url) => (url.endsWith('/menu/libramont/') ? reponse('<html></html>') : null));
  await estPanne('une page sans ses fichiers', (url) => (url.includes('/fungalaxy/libramont') ? reponse('<title>Fun Galaxy</title>') : null));
  await estPanne('un 401 du garde', (url) => (url.includes('app.pinlane.be') ? reponse('Unauthorized', 401, 'text/plain') : null));
  let samedis = 0;
  const unSamediVide = await sonde.sonder({
    fetcher: fauxSite((url) => {
      if (!url.includes('/api/public-availability')) return null;
      samedis += 1;
      return samedis === 1 ? json({ ok: true, slots: [] }) : null;
    }),
    maintenant: SAMEDI,
    attendre: async () => {},
  });
  ok(unSamediVide.verdict === 'ok' && samedis === 2, '[F] un seul samedi vide n est pas une panne, le suivant repond');

  // [G]
  const facture = await jouer(sonde, { passages: fois(3, (url) => (url.includes('google.com') || url.includes('api.github.com') ? null
    : reponse('paused', 402, 'text/html', { 'x-vercel-error': 'DEPLOYMENT_DISABLED' }))) });
  ok(/compte Vercel suspendu/.test(facture.messages[0] || ''), '[G] le 402 du 19/08 se nomme', facture.messages[0]);
  ok(/settings\/billing/.test(facture.messages[0] || ''), '[G] et donne le lien de facturation');

  // [H]
  const kvCanal = fauxKv();
  let essaisCanal = 0;
  const recus = [];
  const canal = await jouer(sonde, {
    kv: kvCanal,
    passages: fois(6, toutCasse),
    envoyer: async (texte) => {
      essaisCanal += 1;
      if (essaisCanal <= 2) throw new Error('canal coupe');
      recus.push(texte);
    },
  });
  resultat.canalRecus = recus.length;
  ok(recus.length === 1, '[H] canal coupe deux fois : l alerte part ensuite, une fois', `${recus.length}`);
  ok(essaisCanal === 3, '[H] puis plus aucun essai', `${essaisCanal}`);
  ok(JSON.parse(canal.kv.valeurs.get('etat')).aEnvoyer.length === 0, '[H] plus rien de du');

  // [I]
  const aFond = (journal) => journal.filter((e) => e.url.includes('/api/')).length;
  const journalSurface = [];
  await sonde.passage({ kv: fauxKv(), fetcher: fauxSite(() => null, journalSurface), maintenant: SAMEDI, attendre: async () => {}, envoyer: async () => {} });
  resultat.fondHorsCreneau = aFond(journalSurface);
  ok(aFond(journalSurface) === 0, '[I] minute 6 : aucune route qui reveille Neon', `${aFond(journalSurface)}`);
  const journalFond = [];
  await sonde.passage({ kv: fauxKv(), fetcher: fauxSite(() => null, journalFond), maintenant: Date.parse('2026-11-04T09:16:00Z'), attendre: async () => {}, envoyer: async () => {} });
  ok(aFond(journalFond) === 3, '[I] minute 16, juste apres le cron secours : le fond se joue', `${aFond(journalFond)}`);
  const kvSuspect = fauxKv();
  await sonde.passage({ kv: kvSuspect, fetcher: fauxSite(toutCasse), maintenant: SAMEDI, attendre: async () => {}, envoyer: async () => {} });
  const journalSuspect = [];
  await sonde.passage({ kv: kvSuspect, fetcher: fauxSite(() => null, journalSuspect), maintenant: SAMEDI + 300_000, attendre: async () => {}, envoyer: async () => {} });
  ok(aFond(journalSuspect) === 3, '[I] passage suspect : le fond se joue tout de suite', `${aFond(journalSuspect)}`);
  ok([...journalFond, ...journalSuspect].every((e) => e.methode === 'GET'), '[I] que des GET, jamais une ecriture en prod');

  const wrangler = fs.readFileSync(path.join(ROOT, 'workers', 'sonde-prod', 'wrangler.toml'), 'utf8');
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  ok(wrangler.includes('"1-59/5 * * * *"') && wrangler.includes('"0 7 * * 1"'), '[I] les crons du Worker sont ceux que le code attend');
  // Le moteur Cloudflare ne charge pas un module qui exporte autre chose qu une
  // fonction : vu au premier essai dans workerd, invisible sous Node.
  ok(Object.entries(sonde).every(([nom, valeur]) => typeof valeur === 'function' || (nom === 'default' && typeof valeur.scheduled === 'function')), '[I] le module ne porte que des fonctions, le moteur Cloudflare le charge');
  ok(vercel.crons.some((c) => c.path === '/api/cron/secours' && c.schedule === '*/15 * * * *'), '[I] le cron secours tourne toujours au quart d heure : le fond reste cale dessus');

  // [J]
  const kvBilan = fauxKv();
  const bilans = [];
  await sonde.bilan({ kv: kvBilan, fetcher: fauxSite(), maintenant: SAMEDI, attendre: async () => {}, envoyer: async (t) => { bilans.push(t); } });
  ok(bilans.length === 1 && /Sonde Pinlane en vie/.test(bilans[0]) && /Aucune panne/.test(bilans[0]), '[J] le bilan part sans panne', bilans[0]);
  await jouer(sonde, { kv: kvBilan, passages: [...fois(3, toutCasse), ...fois(3, sain)] });
  await sonde.bilan({ kv: kvBilan, fetcher: fauxSite(toutCasse), maintenant: SAMEDI, attendre: async () => {}, envoyer: async (t) => { bilans.push(t); } });
  ok(/Dernière panne/.test(bilans[1] || '') && /non vert/.test(bilans[1] || ''), '[J] il dit la derniere panne et un parcours casse', bilans[1]);

  // [K]
  const kvSimulation = fauxKv();
  kvSimulation.valeurs.set('simulation', 'panne');
  const adresses = [];
  const simule = await jouer(sonde, {
    kv: kvSimulation,
    passages: fois(3, (url) => { adresses.push(url); return null; }),
  });
  ok(simule.messages.length === 1 && simule.messages[0].startsWith('[simulation] PANNE'), '[K] la simulation alerte, et le dit', simule.messages[0]);
  ok(adresses.filter((u) => !/google|github/.test(u)).every((u) => u.includes('/sonde-simulation')), '[K] elle ne vise qu un chemin mort');
  kvSimulation.valeurs.delete('simulation');
  const finie = await jouer(sonde, { kv: kvSimulation, passages: fois(3, sain) });
  ok(finie.messages.length === 1 && finie.messages[0].startsWith('[simulation] RETOUR'), '[K] le retour aussi', finie.messages[0]);
  const kvReseau = fauxKv();
  kvReseau.valeurs.set('simulation', 'reseau');
  const simuleReseau = await jouer(sonde, { kv: kvReseau, passages: fois(6, (url) => (url.includes('.invalid') ? coupure() : null)) });
  ok(simuleReseau.messages.length === 0, '[K] la simulation reseau n alerte pas');

  return resultat;
}

// Contre-preuves : chaque garde retiree rougit la preuve qu elle soutient.
async function chargerMutant(avant, apres) {
  const source = fs.readFileSync(SOURCE, 'utf8');
  if (!source.includes(avant)) throw new Error(`Ancre de mutation morte : ${avant}`);
  const fichier = path.join(os.tmpdir(), `sonde-mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(fichier, source.replace(avant, apres));
  try {
    return await import(pathToFileURL(fichier).href);
  } finally {
    fs.unlinkSync(fichier);
  }
}

async function contrePreuves() {
  const seuilUn = await chargerMutant('const SEUIL_PANNE = 3;', 'const SEUIL_PANNE = 1;');
  const hoquet = await jouer(seuilUn, { passages: [toutCasse, sain, toutCasse, sain] });
  ok(hoquet.messages.length > 0, '[contre-épreuve] alerte au premier echec : [C] rougit', `${hoquet.messages.length}`);

  const sansControle = await chargerMutant("return { verdict: 'aveugle', etapes: etapes.length, casses };\n}\n\nfunction messagePanne", "return { verdict: 'ko', etapes: etapes.length, casses };\n}\n\nfunction messagePanne");
  const reseau = await jouer(sansControle, { passages: fois(6, toutCoupe) });
  ok(reseau.messages.length > 0, '[contre-épreuve] sans controle du reseau : [D] rougit', `${reseau.messages.length}`);

  const sansDedoublonnage = await chargerMutant("if (vu.verdict === 'ko') return { ...suivant, succes: 0 };", "if (vu.verdict === 'ko') { suivant.aEnvoyer.push('PANNE encore'); return { ...suivant, succes: 0 }; }");
  const panne = await jouer(sansDedoublonnage, { passages: fois(10, toutCasse) });
  ok(panne.messages.length > 2, '[contre-épreuve] sans anti-doublon : [B] rougit', `${panne.messages.length}`);

  const retourImmediat = await chargerMutant('const SEUIL_RETOUR = 3;', 'const SEUIL_RETOUR = 1;');
  const clignote = await jouer(retourImmediat, { passages: [...fois(3, toutCasse), sain, ...fois(3, toutCasse), sain] });
  ok(clignote.messages.length > 2, '[contre-épreuve] retour au premier vert : [E] rougit', `${clignote.messages.length}`);

  const sansContrat = await chargerMutant("return 'réponse illisible';", 'return null;');
  const page = await sansContrat.sonder({ fetcher: fauxSite((url) => (url.includes('/api/public-booking-meta') ? reponse('<html>ok</html>') : null)), maintenant: SAMEDI, attendre: async () => {} });
  ok(page.verdict === 'ok', '[contre-épreuve] sans lecture du contrat : un 200 HTML passe, [F] rougit');

  const toujoursFond = await chargerMutant('new Date(maintenant).getUTCMinutes() % 15 === 1', 'true');
  const journal = [];
  await toujoursFond.passage({ kv: fauxKv(), fetcher: fauxSite(() => null, journal), maintenant: SAMEDI, attendre: async () => {}, envoyer: async () => {} });
  ok(journal.some((e) => e.url.includes('/api/')), '[contre-épreuve] fond a chaque passage : Neon ne dort plus, [I] rougit');

  const alertePerdue = await chargerMutant('restent.push(texte);', '');
  let essais = 0;
  const recus = [];
  await jouer(alertePerdue, {
    passages: fois(5, toutCasse),
    envoyer: async (texte) => { essais += 1; if (essais === 1) throw new Error('coupe'); recus.push(texte); },
  });
  ok(recus.length === 0, '[contre-épreuve] alerte non remise en attente : perdue, [H] rougit', `${recus.length}`);
}

(async () => {
  const sonde = await import(pathToFileURL(SOURCE).href);
  await preuves(sonde);
  await contrePreuves();
  console.log('');
  console.log(failures ? `sonde-prod-check: ${failures} FAIL` : 'sonde-prod-check: ALL OK (une alerte par panne, aucune pour le reseau, le contrat lu)');
  process.exit(failures ? 1 : 0);
})().catch((erreur) => {
  console.error(erreur);
  process.exit(1);
});
