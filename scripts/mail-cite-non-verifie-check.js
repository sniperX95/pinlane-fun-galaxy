#!/usr/bin/env node
'use strict';
// UNE CITATION N EST PAS UN ENVOI (2026-11-18, avant-lancement C1).
//
// Le serveur retrouve dans le mail d un client la reponse que le centre aurait ecrite depuis sa
// boite (lib/email-threads.js reponsesCiteesHorsPinlane). Ce texte vient du mail du client. Un
// expediteur exterieur qui citait un faux message du centre le faisait lire dans la console comme
// « Envoyé depuis votre boîte mail », avec la pastille et la couleur d un mail du centre.
//
// [V] la vraie console (scripts/dev-console-server.js, fil d exemple 906) : la reponse citee se lit
//     « Cité par le client, non vérifié », sans la pastille ni la couleur d un mail du centre, avec la
//     phrase qui dit qu aucune trace d envoi n existe. Le mail du client qui la precede ne se dit
//     pas « répondu ».
// [P] un mail vraiment envoye par Pinlane (fil 902, la reponse de Kevin) garde son affichage :
//     « Envoyé », la pastille et la couleur du centre, et « Répondu par Kevin » sous le mail du client.
//
// Donnees inventees, reseau exterieur coupe. Les contre-preuves servent au navigateur le fichier
// mute en memoire : rien ne s ecrit sur le disque.
// Lancement : node scripts/mail-cite-non-verifie-check.js [--contre-preuves]
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_MAIL_CITE_PORT || 4361);
const BASE = `http://127.0.0.1:${PORT}`;
const NAVIGATEUR = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PAGES = 'assets/staff-pages-v2.js';

const MUTATIONS = [
  { nom: 'citation-envoyee', lettre: 'V', editions: [{ de: "(boite ? 'Cité par le client, non vérifié' :", vers: "(boite ? 'Envoyé depuis votre boîte mail' :" }] },
  { nom: 'pastille-du-centre', lettre: 'V', editions: [{ de: '    const pastille = inbound || boite\n', vers: '    const pastille = inbound\n' }] },
  { nom: 'fond-du-centre', lettre: 'V', editions: [{ de: "${inbound ? ' is-inbound' : (boite ? '' : ' is-outbound')}", vers: "${inbound ? ' is-inbound' : ' is-outbound'}" }] },
  { nom: 'trace-d-envoi-tue', lettre: 'V', editions: [{ de: '. Pinlane n’a aucune trace de cet envoi.', vers: '' }] },
  { nom: 'repondu-depuis-la-boite', lettre: 'V', editions: [{ de: "reponse.origine === 'boite' ? 'Réponse citée par le client, non vérifiée'", vers: "reponse.origine === 'boite' ? 'Répondu depuis votre boîte mail'" }] },
  { nom: 'tout-non-verifie', lettre: 'P', editions: [{ de: "    const boite = m.origine === 'boite';\n", vers: "    const boite = m.origine === 'boite' || !inbound;\n" }] },
];

function sourceMutee(editions) {
  if (!editions.length) return null;
  let t = fs.readFileSync(path.join(ROOT, PAGES), 'utf8').replace(/\r\n/g, '\n');
  editions.forEach((e) => {
    if (t.split(e.de).length !== 2) throw new Error(`ANCRE DE MUTATION absente ou multiple : ${e.de.slice(0, 80)}`);
    t = t.split(e.de).join(e.vers);
  });
  return t;
}

async function ouvrir(browser, mute, erreurs) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
  if (mute !== null) await context.route(/\/assets\/staff-pages-v2\.js(\?|$)/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: mute }));
  const page = await context.newPage();
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.goto(`${BASE}/#/staff/emails/recus`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => typeof window.pv2EmailsGo === 'function' && typeof window.pv2ThreadOpen === 'function', null, { timeout: 20000 });
  await page.waitForFunction(() => pv2Threads.loaded, null, { timeout: 15000 });
  return { context, page };
}

// Les mails d un fil tels que l ecran les montre : classe, pastille, voie et sa couleur, parcours.
async function lireFil(page, id) {
  await page.evaluate((x) => pv2ThreadOpen(x), id);
  await page.waitForFunction((x) => pv2Threads.detail.loaded && pv2Threads.detail.thread && String(pv2Threads.detail.thread.id) === x
    && document.querySelectorAll('#staffEmailsPage .pl-timeline-msg').length > 0, id, { timeout: 15000 });
  return page.evaluate(() => [...document.querySelectorAll('#staffEmailsPage article.pl-timeline-msg')].map((a) => {
    const p = a.querySelector('.pv2-mail-entete .pv2-mail-pastille');
    const texte = (sel) => ((a.querySelector(sel) || {}).textContent || '').replace(/\s+/g, ' ').trim();
    return {
      id: a.getAttribute('data-message-id'), sortant: a.classList.contains('is-outbound'), nous: Boolean(p && p.classList.contains('is-nous')),
      fond: getComputedStyle(a.querySelector('.pv2-mail-voie') || a).backgroundColor, nom: texte('.pv2-mail-ligne strong'), voie: texte('.pv2-mail-voie'), corps: texte('.pv2-mail-corps'), trace: texte('.pl-timeline-trace'),
    };
  }));
}

async function verifier(editions = []) {
  const rouges = [];
  const ok = (cond, lettre, nom, detail = '') => {
    if (!cond) rouges.push(lettre);
    if (!editions.length) console.log(`${cond ? 'ok   ' : `ROUGE [${lettre}]`} ${nom}${cond || !detail ? '' : `  ${String(detail).slice(0, 600)}`}`);
  };
  const { chromium } = require('playwright-core');
  const dev = require('./dev-console-server.js');
  const mute = sourceMutee(editions);
  const serveur = dev.creerServeur(dev.creerRepondeurFixtures({ origine: BASE, exemples: true }));
  await new Promise((r) => serveur.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: NAVIGATEUR, headless: true });
  const erreurs = [];
  try {
    const { context, page } = await ouvrir(browser, mute, erreurs);

    const f906 = await lireFil(page, '906');
    const client = f906.find((m) => m.id === '61');
    const cite = f906.find((m) => m.id === 'boite-62');
    const resume = JSON.stringify(f906.map((m) => ({ id: m.id, sortant: m.sortant, nous: m.nous, voie: m.voie, trace: m.trace.slice(0, 140) })));
    ok(f906.map((m) => m.id).join(',') === '61,boite-62,62' && cite && /Oui, la salle anniversaire est libre samedi à 15 h/.test(cite.corps),
      'V', 'la reponse citee par le client garde sa place dans la conversation', resume);
    ok(cite && cite.voie === 'Cité par le client, non vérifié' && !/Envoy/.test(cite.voie),
      'V', 'la reponse citee se lit « Cité par le client, non vérifié », jamais « Envoyé »', resume);
    ok(cite && !cite.nous && !cite.sortant && client && cite.fond === client.fond,
      'V', 'elle n a ni la pastille ni la couleur d un mail du centre', resume);
    ok(cite && /Retrouvé dans la réponse de Paul Exemple\. Pinlane n’a aucune trace de cet envoi\./.test(cite.trace),
      'V', 'son parcours dit qu aucune trace d envoi n existe', resume);
    ok(client && /Réponse citée par le client, non vérifiée/.test(client.trace) && !/Répondu/.test(client.trace),
      'V', 'le mail du client qui la precede ne se dit pas « répondu »', resume);

    const f902 = await lireFil(page, '902');
    const kevin = f902.find((m) => m.id === '44');
    const marie = f902.find((m) => m.id === '43');
    const resume902 = JSON.stringify(f902.map((m) => ({ id: m.id, sortant: m.sortant, nous: m.nous, voie: m.voie, trace: m.trace.slice(0, 140) })));
    ok(kevin && kevin.sortant && kevin.nous && /^Envoyé/.test(kevin.voie) && !/non vérifié/.test(`${kevin.voie} ${kevin.trace}`) && marie && kevin.fond !== marie.fond,
      'P', 'une reponse envoyee par Pinlane garde « Envoyé », la pastille et la couleur du centre', resume902);
    ok(marie && /Répondu par Kevin/.test(marie.trace) && !/non vérifiée/.test(marie.trace),
      'P', 'et le mail du client auquel elle repond se dit « Répondu par Kevin »', resume902);

    await context.close();
    ok(!erreurs.length, 'V', 'aucune erreur JavaScript', erreurs.join(' | '));
  } finally {
    await browser.close();
    await new Promise((r) => serveur.close(r));
  }
  return rouges;
}

(async () => {
  if (process.argv.includes('--contre-preuves')) {
    const temoin = await verifier([]);
    if (temoin.length) { console.log('\nmail-cite-non-verifie-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte'); process.exit(1); }
    let vivantes = 0;
    for (const m of MUTATIONS) {
      // eslint-disable-next-line no-await-in-loop
      const rouges = await verifier(m.editions.map((e) => ({ ...e, fichier: PAGES }))).catch((e) => [`exception ${e.message}`]);
      const mord = rouges.includes(m.lettre);
      if (!mord) vivantes += 1;
      console.log(`${mord ? 'TUEE   ' : 'VIVANTE'} ${m.nom} (attendu : ROUGE [${m.lettre}])${mord ? '' : `  (rouges : ${rouges.join(' | ') || 'aucun'})`}`);
    }
    console.log(vivantes ? `\nmail-cite-non-verifie-check --contre-preuves: ${vivantes} mutation(s) vivante(s)` : `\nmail-cite-non-verifie-check --contre-preuves: ALL OK, ${MUTATIONS.length}/${MUTATIONS.length} mordent`);
    process.exit(vivantes ? 1 : 0);
  }
  const rouges = await verifier([]);
  if (rouges.length) { console.error(`\nmail-cite-non-verifie-check: ${rouges.length} ROUGE(S)`); process.exit(1); }
  console.log('\nmail-cite-non-verifie-check: ALL OK (une citation du client se lit non verifiee, un vrai envoi garde son affichage)');
})().catch((e) => { console.error('ERREUR', e && e.stack ? e.stack.slice(0, 1200) : e); process.exit(1); });
