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
//   [K] la simulation vise un chemin mort et marque ses messages ;
//   [L] une sauvegarde de plus de 26 h : un message, un seul, puis un quand elle
//       repart ; ce n est pas une panne, Neon dort toujours, et une vraie panne
//       pendant ce temps alerte quand meme, sans second message de sauvegarde ;
//   [M] Gembloux : son formulaire, son catalogue et ses creneaux cassent la sonde comme
//       ceux de Libramont ; une base qui n ecrit plus est une panne ; la garde arretee
//       depuis plus de 45 min : un message, un autre quand elle repart.
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
  '/fungalaxy/gembloux': lirePage('fungalaxy.html'),
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
  sante: () => json({ ok: true, db: true, derniereSauvegarde: '2026-11-04T01:15:10.000Z' }),
  catalogue: (url) => json({ ok: true, formules: [{ id: 'anniversaire' }], center: { id: new URL(url).searchParams.get('centerId') } }),
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
    if (pathname === '/api/public-booking-meta') return SAIN.catalogue(url);
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
const FOND = Date.parse('2026-11-04T09:16:00Z'); // minute 16 : le fond se joue
const santeDe = (date) => (url) => (url.includes('/api/healthz') ? json({ ok: true, db: true, ...(date === undefined ? {} : { derniereSauvegarde: date }) }) : null);
const ilYA = (heures) => new Date(FOND - heures * 3_600_000).toISOString();

// Joue une suite de passages espaces de 5 minutes et rend ce qui est parti.
async function jouer(sonde, { kv = fauxKv(), passages, envoyer, depart = SAMEDI }) {
  const messages = [];
  const calmes = [];
  let instant = depart;
  const resultats = [];
  for (const panne of passages) {
    // eslint-disable-next-line no-await-in-loop
    resultats.push(await sonde.passage({
      kv,
      fetcher: fauxSite(panne),
      maintenant: instant,
      attendre: async () => {},
      envoyer: envoyer || (async (texte, options = {}) => { messages.push(texte); calmes.push(Boolean(options.calme)); }),
    }));
    instant += 5 * 60_000;
  }
  return { messages, calmes, kv, resultats };
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
  ok(/^Pinlane : le site ne marche plus depuis \d{2}:\d{2}, vérifié à \d{2}:\d{2}\.\n/.test(panne.messages[0] || ''), '[B] le premier dit la panne', panne.messages[0]);
  ok(/Ce qui casse : tout le parcours \(ne répond pas\)\./.test(panne.messages[0] || '') && /Les clients ne peuvent plus réserver en ligne\. L’équipe n’a plus la console\./.test(panne.messages[0] || ''), '[B] et ce qui est casse, en mots simples, et qui est touche', panne.messages[0]);
  ok(panne.calmes[0] === false && panne.calmes[1] === true, '[B] la panne sonne, le retour arrive sans bruit', panne.calmes);
  ok(lisible(panne.messages[0], 'alerte') && lisible(panne.messages[1], 'regle'), '[B] les deux passent le gabarit des alertes de l application', [T.controlerTexte(panne.messages[0], { genre: 'alerte' }), T.controlerTexte(panne.messages[1], { genre: 'regle' })]);
  ok(/^Réglé : le site ne marchait plus pendant [^,]+, depuis \d{2}:\d{2}\.$/.test(panne.messages[1] || ''), '[B] le second dit le retour', panne.messages[1]);
  ok(/pendant 1 h 00/.test(panne.messages[1] || ''), '[B] avec la duree', panne.messages[1]);
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
  ok(siteSeulCoupe.messages.length === 1 && /\(ne répond pas\)/.test(siteSeulCoupe.messages[0]), '[D] controles vivants et site coupe : c est une panne');

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
  ok(unSamediVide.verdict === 'ok' && samedis === 3, '[F] un seul samedi vide n est pas une panne, le suivant repond', `${samedis}`);

  // [G]
  const facture = await jouer(sonde, { passages: fois(3, (url) => (url.includes('google.com') || url.includes('api.github.com') ? null
    : reponse('paused', 402, 'text/html', { 'x-vercel-error': 'DEPLOYMENT_DISABLED' }))) });
  ok(/l’hébergeur a suspendu le compte/.test(facture.messages[0] || '') && /\nCe que tu fais : règle la facture de l’hébergeur/.test(facture.messages[0] || ''), '[G] le 402 du 19/08 se nomme, et dit quoi faire', facture.messages[0]);
  const lienFacture = sonde.entitesDeLaSonde(facture.messages[0] || '')[0];
  ok(lienFacture && /settings\/billing/.test(lienFacture.url) && (facture.messages[0] || '').substr(lienFacture.offset, lienFacture.length) === 'Ouvrir la facture de l’hébergeur' && !/https?:\/\//.test(facture.messages[0] || ''), '[G] et donne le lien de facturation, qui s ouvre d un toucher', lienFacture);
  ok(lisible(facture.messages[0], 'alerte'), '[G] il passe le gabarit', T.controlerTexte(facture.messages[0], { genre: 'alerte' }));

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
  ok(aFond(journalFond) === 6, '[I] minute 16, juste apres le cron secours : le fond se joue, les deux centres et la sauvegarde', `${aFond(journalFond)}`);
  const kvSuspect = fauxKv();
  await sonde.passage({ kv: kvSuspect, fetcher: fauxSite(toutCasse), maintenant: SAMEDI, attendre: async () => {}, envoyer: async () => {} });
  const journalSuspect = [];
  await sonde.passage({ kv: kvSuspect, fetcher: fauxSite(() => null, journalSuspect), maintenant: SAMEDI + 300_000, attendre: async () => {}, envoyer: async () => {} });
  ok(aFond(journalSuspect) === 6, '[I] passage suspect : le fond se joue tout de suite', `${aFond(journalSuspect)}`);
  ok([...journalFond, ...journalSuspect].every((e) => e.methode === 'GET'), '[I] que des GET, jamais une ecriture en prod');

  const wrangler = fs.readFileSync(path.join(ROOT, 'workers', 'sonde-prod', 'wrangler.toml'), 'utf8');
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  ok(wrangler.includes('"1-59/5 * * * *"') && wrangler.includes('"0 7 * * 1"'), '[I] les crons du Worker sont ceux que le code attend');
  // Le moteur Cloudflare ne charge pas un module qui exporte autre chose qu une
  // fonction : vu au premier essai dans workerd, invisible sous Node.
  ok(Object.entries(sonde).every(([nom, valeur]) => typeof valeur === 'function' || (nom === 'default' && typeof valeur.scheduled === 'function')), '[I] le module ne porte que des fonctions, le moteur Cloudflare le charge');
  ok(vercel.crons.some((c) => c.path === '/api/cron/secours' && c.schedule === '*/15 * * * *'), '[I] le cron secours tourne toujours au quart d heure : le fond reste cale dessus');

  // [K] Les sujets du groupe Pinlane (2026-11-06) : les memes valeurs que sur Vercel.
  const sansGroupe = sonde.destinationTelegram({ TELEGRAM_CHAT: '42' }, 'pannes');
  const dansLeGroupe = (sujet) => sonde.destinationTelegram({ TELEGRAM_CHAT: '42', TELEGRAM_GROUPE: '-1004294441660', TELEGRAM_SUJETS: 'pannes:2,reservations:3,modifications:4,bilans:5' }, sujet);
  ok(sansGroupe.chat_id === '42' && !sansGroupe.message_thread_id && !sansGroupe.disable_notification, '[K] sans groupe : la conversation d Ansar, avec la sonnerie, comme avant');
  ok(dansLeGroupe('pannes').chat_id === '-1004294441660' && dansLeGroupe('pannes').message_thread_id === 2 && !dansLeGroupe('pannes').disable_notification, '[K] une panne : le sujet Pannes du groupe, avec la sonnerie');
  ok(dansLeGroupe('bilans').message_thread_id === 5 && dansLeGroupe('bilans').disable_notification === true, '[K] le bilan du lundi : le sujet Bilans, sans sonnerie');

  // [J]
  const kvBilan = fauxKv();
  const bilans = [];
  await sonde.bilan({ kv: kvBilan, fetcher: fauxSite(), maintenant: SAMEDI, attendre: async () => {}, envoyer: async (t) => { bilans.push(t); } });
  ok(bilans.length === 1 && /^Pinlane : la surveillance extérieure du site tourne\./.test(bilans[0]) && /Aucune panne/.test(bilans[0]), '[J] le bilan part sans panne', bilans[0]);
  await jouer(sonde, { kv: kvBilan, passages: [...fois(3, toutCasse), ...fois(3, sain)] });
  await sonde.bilan({ kv: kvBilan, fetcher: fauxSite(toutCasse), maintenant: SAMEDI, attendre: async () => {}, envoyer: async (t) => { bilans.push(t); } });
  ok(/Dernière panne/.test(bilans[1] || '') && /ne répond pas comme prévu/.test(bilans[1] || ''), '[J] il dit la derniere panne et un parcours casse', bilans[1]);
  ok(lisible(bilans[0], 'bilan') && lisible(bilans[1], 'bilan'), '[J] le bilan passe le gabarit', [T.controlerTexte(bilans[0], { genre: 'bilan' }), T.controlerTexte(bilans[1], { genre: 'bilan' })]);
  ok(/Dernière sauvegarde : 04\/11 à /.test(bilans[0] || ''), '[J] il dit la derniere sauvegarde', bilans[0]);
  ok(/Sauvegarde : pas de réponse/.test(bilans[1] || ''), '[J] et qu il n a pas pu la lire', bilans[1]);

  // [K]
  const kvSimulation = fauxKv();
  kvSimulation.valeurs.set('simulation', 'panne');
  const adresses = [];
  const simule = await jouer(sonde, {
    kv: kvSimulation,
    passages: fois(3, (url) => { adresses.push(url); return null; }),
  });
  ok(simule.messages.length === 1 && simule.messages[0].startsWith('[simulation] Pinlane : le site ne marche plus'), '[K] la simulation alerte, et le dit', simule.messages[0]);
  ok(adresses.filter((u) => !/google|github/.test(u)).every((u) => u.includes('/sonde-simulation')), '[K] elle ne vise qu un chemin mort');
  kvSimulation.valeurs.delete('simulation');
  const finie = await jouer(sonde, { kv: kvSimulation, passages: fois(3, sain) });
  ok(finie.messages.length === 1 && finie.messages[0].startsWith('[simulation] Réglé : le site ne marchait plus'), '[K] le retour aussi', finie.messages[0]);
  const kvReseau = fauxKv();
  kvReseau.valeurs.set('simulation', 'reseau');
  const simuleReseau = await jouer(sonde, { kv: kvReseau, passages: fois(6, (url) => (url.includes('.invalid') ? coupure() : null)) });
  ok(simuleReseau.messages.length === 0, '[K] la simulation reseau n alerte pas');

  // [M]
  const casse = (panne) => sonde.sonder({ fetcher: fauxSite(panne), maintenant: FOND, attendre: async () => {} });
  const cassePour = async (panne, nom, detail) => {
    const vu = await casse(panne);
    return vu.verdict === 'ko' && vu.casses.some((c) => c.nom === nom && (!detail || c.detail === detail));
  };
  ok(await cassePour((url) => (url.includes('/fungalaxy/gembloux') ? reponse('oups', 500) : null), 'page de réservation de Gembloux'), '[M] le formulaire de Gembloux tombe : la sonde le voit');
  ok(await cassePour((url) => (url.includes('public-booking-meta') && url.includes('centerId=gembloux') ? json({ ok: false }) : null), 'catalogue de Gembloux'), '[M] le catalogue de Gembloux tombe : la sonde le voit');
  ok(await cassePour((url) => (url.includes('public-booking-meta') && url.includes('centerId=gembloux') ? json({ ok: true, formules: [{ id: 'a' }], center: { id: 'libramont' } }) : null), 'catalogue de Gembloux', 'mauvais centre'), '[M] Gembloux sert le catalogue de Libramont : la sonde le voit');
  ok(await cassePour((url) => (url.includes('public-availability') && url.includes('centerId=gembloux') ? json({ ok: true, slots: [] }) : null), 'créneaux de Gembloux'), '[M] plus aucun creneau a Gembloux : la sonde le voit');
  ok(await cassePour((url) => (url.includes('/api/healthz') ? json({ ok: true, db: true, ecriture: false }) : null), 'base', 'la base refuse d’écrire'), '[M] la base lit mais n ecrit plus : c est une panne');
  const gardeDe = (date) => (url) => (url.includes('/api/healthz') ? json({ ok: true, db: true, derniereSauvegarde: ilYA(1), derniereGarde: date }) : null);
  const arretee = await jouer(sonde, { passages: fois(9, gardeDe(ilYA(2))), depart: FOND });
  ok(arretee.messages.length === 1 && /^Pinlane : la surveillance du quart d’heure ne tourne plus\./.test(arretee.messages[0]), '[M] la garde arretee depuis 2 h : un seul message sur 9 passages', arretee.messages.join(' | '));
  ok(arretee.calmes[0] === false && lisible(arretee.messages[0], 'alerte'), '[M] elle sonne, au gabarit', [arretee.calmes, T.controlerTexte(arretee.messages[0] || '', { genre: 'alerte' })]);
  const sansPanne = JSON.parse(arretee.kv.valeurs.get('etat'));
  ok(sansPanne.statut === 'ok' && sansPanne.echecs === 0, '[M] ce n est pas une panne du site : ni statut, ni compteur');
  const relancee = await jouer(sonde, { kv: arretee.kv, passages: fois(6, gardeDe(ilYA(0.1))), depart: FOND });
  ok(relancee.messages.length === 1 && /^Réglé : la surveillance du quart d’heure ne tournait plus, depuis \d{2}:\d{2}\.$/.test(relancee.messages[0]), '[M] elle repart : un message', relancee.messages.join(' | '));
  ok(relancee.calmes[0] === true, '[M] et le retour arrive sans bruit', relancee.calmes);
  const jamais = await jouer(sonde, { passages: fois(3, gardeDe(null)), depart: FOND });
  ok(jamais.messages.length === 1 && /aucune date lisible/.test(jamais.messages[0]), '[M] le site repond sans date de garde : ca s entend', jamais.messages.join(' | '));
  const absente = await jouer(sonde, { passages: fois(3, santeDe(ilYA(1))), depart: FOND });
  ok(absente.messages.length === 0, '[M] le champ absent ne dit rien : aucune alerte', absente.messages.join(' | '));

  // [L]
  const enRetard = santeDe(ilYA(32));
  const retard = await jouer(sonde, { passages: fois(12, enRetard) });
  ok(retard.messages.length === 1, '[L] plus de 26 h : un seul message sur 12 passages', `${retard.messages.length}`);
  ok(/^Pinlane : la sauvegarde de la nuit n’est pas partie\./.test(retard.messages[0] || '') && /il y a 32 h 00/.test(retard.messages[0] || ''), '[L] il dit depuis quand', retard.messages[0]);
  ok(retard.calmes[0] === true && lisible(retard.messages[0], 'alerte'), '[L] sans sonnerie, au gabarit : le site marche', [retard.calmes, T.controlerTexte(retard.messages[0] || '', { genre: 'alerte' })]);
  const etatRetard = JSON.parse(retard.kv.valeurs.get('etat'));
  ok(etatRetard.statut === 'ok' && etatRetard.echecs === 0, '[L] ce n est pas une panne : ni statut, ni compteur');
  const journalRetard = [];
  await sonde.passage({ kv: retard.kv, fetcher: fauxSite(enRetard, journalRetard), maintenant: Date.parse('2026-11-04T12:06:00Z'), attendre: async () => {}, envoyer: async () => {} });
  ok(aFond(journalRetard) === 0, '[L] en retard, Neon dort toujours : minute 6 sans route de fond', `${aFond(journalRetard)}`);
  const repartie = await jouer(sonde, { kv: retard.kv, passages: fois(6, sain) });
  ok(repartie.messages.length === 1 && /^Réglé : la sauvegarde de la nuit n’était pas partie, depuis \d{2}:\d{2}\.$/.test(repartie.messages[0]), '[L] elle repart : un message', repartie.messages[0]);

  const melees = await jouer(sonde, { passages: [...fois(4, enRetard), ...fois(3, toutCasse), ...fois(3, enRetard)] });
  const genreDe = (m) => (/sauvegarde/.test(m.split('\n')[0]) ? 'SAUVEGARDE' : /^Réglé : le site/.test(m) ? 'RETOUR' : /^Pinlane : le site/.test(m) ? 'PANNE' : '?');
  ok(melees.messages.map(genreDe).join(',') === 'SAUVEGARDE,PANNE,RETOUR', '[L] une vraie panne alerte quand meme, sans second message de sauvegarde', melees.messages.map((m) => m.split('\n')[0]).join(' | '));

  const alerteA = async (fetcher) => {
    const recus = [];
    await sonde.passage({ kv: fauxKv(), fetcher, maintenant: FOND, attendre: async () => {}, envoyer: async (t) => { recus.push(t); } });
    return recus;
  };
  ok((await alerteA(fauxSite(santeDe(ilYA(25.9))))).length === 0, '[L] 25 h 54 : rien');
  ok((await alerteA(fauxSite(santeDe(ilYA(26.1))))).length === 1, '[L] 26 h 06 : le message');
  ok(/aucune date lisible/.test((await alerteA(fauxSite(santeDe(null))))[0] || ''), '[L] jamais reussie : le message');
  ok(/aucune date lisible/.test((await alerteA(fauxSite(santeDe(undefined))))[0] || ''), '[L] champ disparu de la route : le message');
  ok(/aucune date lisible/.test((await alerteA(fauxSite(santeDe('hier'))))[0] || ''), '[L] date illisible : le message');
  ok((await alerteA(fauxSite(() => null, []))).length === 0, '[L] sauvegarde de la nuit : rien');

  let essaisSauvegarde = 0;
  const recusSauvegarde = [];
  await jouer(sonde, {
    passages: fois(8, enRetard),
    envoyer: async (texte) => {
      essaisSauvegarde += 1;
      if (essaisSauvegarde === 1) throw new Error('canal coupe');
      recusSauvegarde.push(texte);
    },
  });
  ok(recusSauvegarde.length === 1, '[L] canal coupe : le message reste du et part une fois', `${recusSauvegarde.length}`);

  const kvSauvegarde = fauxKv();
  kvSauvegarde.valeurs.set('simulation', 'sauvegarde');
  const adressesSauvegarde = [];
  const simuleeSauvegarde = await jouer(sonde, { kv: kvSauvegarde, passages: fois(6, (url) => { adressesSauvegarde.push(url); return null; }) });
  ok(simuleeSauvegarde.messages.length === 1 && simuleeSauvegarde.messages[0].startsWith('[simulation] Pinlane : la sauvegarde de la nuit n’est pas partie'), '[L] la simulation alerte, et le dit', simuleeSauvegarde.messages[0]);
  ok(adressesSauvegarde.every((u) => !u.includes('/sonde-simulation')), '[L] le site reste sonde pour de vrai');
  kvSauvegarde.valeurs.delete('simulation');
  const finSimulee = await jouer(sonde, { kv: kvSauvegarde, passages: fois(6, sain) });
  ok(finSimulee.messages.length === 1 && finSimulee.messages[0].startsWith('[simulation] Réglé : la sauvegarde de la nuit n’était pas partie'), '[L] le retour aussi', finSimulee.messages[0]);

  return resultat;
}

// Contre-preuves : chaque garde retiree rougit la preuve qu elle soutient.
async function chargerMutant(avant, apres) {
  // Le depot sort en CRLF sous Windows, en LF ailleurs : une ancre sur deux lignes
  // doit valoir pour les deux.
  const source = fs.readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');
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

  const retourQuiSonne = await chargerMutant("  return calme(`${etat.simulation ? '[simulation] ' : ''}Réglé : le site ne marchait plus", "  return (`${etat.simulation ? '[simulation] ' : ''}Réglé : le site ne marchait plus");
  const sonnerie = await jouer(retourQuiSonne, { passages: [...fois(10, toutCasse), ...fois(3, sain)] });
  ok(sonnerie.calmes[1] === false, '[contre-épreuve] un retour qui sonne, [B] rougit', sonnerie.calmes);
  const panneDAvant = await chargerMutant("Pinlane : le site ne marche plus depuis ${heure(etat.depuis)}, vérifié à ${heure(maintenant)}.\\n`", "PANNE Pinlane\\nDepuis ${heure(etat.depuis)}.\\n`");
  const avant = await jouer(panneDAvant, { passages: fois(10, toutCasse) });
  ok(!lisible(avant.messages[0], 'alerte'), '[contre-épreuve] la panne dite comme avant, [B] rougit', avant.messages[0]);
  const detailBrut = await chargerMutant("function detailLisible(detail) {\n  const d = String(detail || '');", "function detailLisible(detail) {\n  return String(detail || '');\n  const d = String(detail || '');");
  const brut = await jouer(detailBrut, { passages: fois(10, toutCasse) });
  ok(/HTTP 503/.test(brut.messages[0] || ''), '[contre-épreuve] le code d erreur recopie, [B] rougit', brut.messages[0]);
  const alertePerdue = await chargerMutant('restent.push(du);', '');
  let essais = 0;
  const recus = [];
  await jouer(alertePerdue, {
    passages: fois(5, toutCasse),
    envoyer: async (texte) => { essais += 1; if (essais === 1) throw new Error('coupe'); recus.push(texte); },
  });
  ok(recus.length === 0, '[contre-épreuve] alerte non remise en attente : perdue, [H] rougit', `${recus.length}`);

  const enRetard = santeDe(ilYA(32));
  const sansSeuil = await chargerMutant('const SEUIL_SAUVEGARDE_MS = 26 * 3_600_000;', 'const SEUIL_SAUVEGARDE_MS = 9e15;');
  const muette = await jouer(sansSeuil, { passages: fois(6, enRetard) });
  ok(muette.messages.length === 0, '[contre-épreuve] sans seuil : la sauvegarde se tait, [L] rougit', `${muette.messages.length}`);

  const sansMemoire = await chargerMutant("if (enRetard === Boolean(etat.sauvegardeEnRetard)) return etat;", '');
  const bavarde = await jouer(sansMemoire, { passages: fois(6, enRetard) });
  ok(bavarde.messages.length > 1, '[contre-épreuve] sans memoire du retard : un message par passage, [L] rougit', `${bavarde.messages.length}`);

  const oublie = await chargerMutant('    sauvegardeEnRetard: etat.sauvegardeEnRetard,\n', '');
  const melees = await jouer(oublie, { passages: [...fois(4, enRetard), ...fois(3, toutCasse), ...fois(3, enRetard)] });
  ok(melees.messages.length > 3, '[contre-épreuve] le retard oublie au retour d une panne : second message, [L] rougit', `${melees.messages.length}`);

  const sansSeuilGarde = await chargerMutant('maintenant - date > SEUIL_GARDE_MS', 'false');
  const gardeMuette = await jouer(sansSeuilGarde, { passages: fois(3, (url) => (url.includes('/api/healthz') ? json({ ok: true, db: true, derniereSauvegarde: ilYA(1), derniereGarde: ilYA(2) }) : null)), depart: FOND });
  ok(gardeMuette.messages.length === 0, '[contre-épreuve] sans seuil : la garde arretee se tait, [M] rougit', `${gardeMuette.messages.length}`);

  const sansGembloux = await chargerMutant("const CENTRES = ['libramont', 'gembloux'];", "const CENTRES = ['libramont'];");
  const gemblouxMort = await sansGembloux.sonder({ fetcher: fauxSite((url) => (url.includes('public-booking-meta') && url.includes('centerId=gembloux') ? json({ ok: false }) : null)), maintenant: FOND, attendre: async () => {} });
  ok(gemblouxMort.verdict === 'ok', '[contre-épreuve] sans Gembloux dans la liste : sa panne ne se voit pas, [M] rougit');

  const horsDuFond = await chargerMutant('if (profond && !surLeSite) {', 'if (!surLeSite) {');
  const journal2 = [];
  await horsDuFond.passage({ kv: fauxKv(), fetcher: fauxSite(() => null, journal2), maintenant: SAMEDI, attendre: async () => {}, envoyer: async () => {} });
  ok(journal2.some((e) => e.url.includes('/api/')), '[contre-épreuve] lue a chaque passage : Neon ne dort plus, [L] rougit');
}

// Le gabarit des alertes de l application (lib/alertes-texte.js) : la sonde le recopie, ce gate le controle.
const T = require('../lib/alertes-texte');
function lisible(texte, genre) {
  return T.controlerTexte(String(texte || ''), { genre }).length === 0;
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
