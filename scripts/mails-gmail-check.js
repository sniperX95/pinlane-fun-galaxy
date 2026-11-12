#!/usr/bin/env node
'use strict';
// LES MAILS COMME DANS GMAIL (2026-11-12, Ansar : « les mails on distingue pas, faut un ptit truc
// stylé qui ressemble à Gmail », puis « on doit pouvoir tout voir, les images, les liens, tout beau
// tout propre, et les réponses envoyées aussi, pas forcément par nous avec Pinlane »).
//
// Ce que le gate prouve :
//   [A] un mail du formulaire du site se lit en questions et reponses (assets/email-thread.js) ;
//   [B] une reponse partie de la boite du centre, hors Pinlane, se retrouve dans la citation du
//       client, et seulement quand elle vient du centre (lib/email-threads.js) ;
//   [C] le mail recu se lit en entier chez Resend, une fois, borne au centre et aux mails recus,
//       les liens des pieces jointes signes par Resend seulement (lib/mail-recu-complet.js) ;
//   [D] dans la vraie console (scripts/dev-console-server.js, fils d exemple) : chaque mail a son
//       en-tete, le formulaire en liste, la reponse de la boite a sa place, le mail HTML en entier
//       dans un cadre qui ne lance aucun script, ses liens dans un autre onglet, l historique
//       replie, les pieces jointes comme dans Gmail, le papier blanc en sombre, rien qui deborde
//       au telephone.
// Donnees inventees. Rien ne sort de la machine : Resend est un faux, le reseau exterieur coupe.
// Lancement : node scripts/mails-gmail-check.js [--contre-preuves]
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_MAILS_GMAIL_PORT || 4277);
const BASE = `http://127.0.0.1:${PORT}`;
const NAVIGATEUR = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PAGES = 'assets/staff-pages-v2.js';
const FIL = 'assets/email-thread.js';
const FILS = 'lib/email-threads.js';
const COMPLET = 'lib/mail-recu-complet.js';
const CSP_DU_CADRE = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: blob:; style-src 'unsafe-inline'; font-src data:">`;

const MUTATIONS = [
  { nom: 'adresse-doublee', rouge: '[A] un formulaire du site se lit en questions et reponses', editions: [{ fichier: FIL, de: '      champs[c].valeur = nettoyerValeur(champs[c].valeur);\n', vers: '' }] },
  { nom: 'notre-mail-en-double', rouge: '[B] un mail deja envoye par Pinlane ne se montre pas deux fois', editions: [{ fichier: FILS, de: '    if (ids.some((id) => nosMails.has(id))) continue;\n', vers: '' }] },
  { nom: 'citation-de-n-importe-qui', rouge: '[B] une citation qui ne vient pas du centre ne se montre pas', editions: [{ fichier: FILS, de: '    if (!adresses.has(citation.adresse)) continue;\n', vers: '' }] },
  { nom: 'lien-quelconque', rouge: '[C] une piece jointe garde son lien signe par Resend, un autre lien tombe', editions: [{ fichier: COMPLET, de: "i.test(texte) ? texte : '';", vers: 'i.test(texte) ? texte : texte;' }] },
  { nom: 'autre-centre', rouge: '[C] un mail d un autre centre ou un envoi ne se lit pas', editions: [{ fichier: COMPLET, de: "     where id = $1 and center_id = $2 and direction = 'inbound' limit 1;`,", vers: "     where id = $1 and direction = 'inbound' limit 1;`," }] },
  { nom: 'html-relu', rouge: '[C] le HTML se garde dans la ligne du mail, la deuxieme ouverture ne le redemande pas', editions: [{ fichier: COMPLET, de: '      else if (html.length <= MAX_HTML) maj.htmlBody = html;\n', vers: '' }] },
  { nom: 'formulaire-a-plat', rouge: '[D] le formulaire du site se lit en questions et reponses', editions: [{ fichier: PAGES, de: '    const form = pv2ChampsDuFormulaire(message);', vers: '    const form = null;' }] },
  { nom: 'sans-pastille', rouge: '[D] chaque mail a son en-tete : pastille, nom, adresse, heure', editions: [{ fichier: PAGES, de: '        ${pastille}\n', vers: '' }] },
  { nom: 'sans-boite', rouge: '[D] la reponse partie de la boite du centre apparait a sa place', editions: [{ fichier: PAGES, de: '    const affiches = pv2AvecReponsesDeLaBoite(messages, contact, fil);', vers: '    const affiches = messages;' }] },
  { nom: 'photo-perdue', rouge: '[D] le mail recu s affiche en entier, la photo collee comprise', editions: [{ fichier: PAGES, de: "        if (url) { img.setAttribute('src', url); cidsUtilises.add(cid); } else img.remove();", vers: '        img.remove();' }] },
  { nom: 'script-permis', rouge: '[D] le cadre du mail n a pas le droit de lancer un script', editions: [{ fichier: PAGES, de: 'sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"', vers: 'sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"' }] },
  { nom: 'script-garde', rouge: '[D] le HTML du mail est nettoye : ni script, ni on*, ni javascript:, ni pixel', editions: [{ fichier: PAGES, de: "doc.querySelectorAll('script, iframe, frame, frameset", vers: "doc.querySelectorAll('iframe, frame, frameset" }] },
  { nom: 'sans-csp', rouge: '[D] le cadre du mail n accepte que des images et du style', editions: [{ fichier: PAGES, de: CSP_DU_CADRE, vers: '' }] },
  { nom: 'lien-sur-place', rouge: '[D] les liens du mail s ouvrent dans un autre onglet, sans rien dire de la console', editions: [{ fichier: PAGES, de: "    doc.querySelectorAll('a[href]').forEach((a) => { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); });\n", vers: '' }] },
  { nom: 'historique-deplie', rouge: '[D] l historique du mail se replie et se deplie', editions: [{ fichier: PAGES, de: '    if (aDeLHistorique && !avecHistorique) {', vers: '    if (aDeLHistorique && false) {' }] },
  { nom: 'piece-en-double', rouge: '[D] les pieces jointes se montrent comme dans Gmail, sans la photo deja dans le mail', editions: [{ fichier: PAGES, de: '    const liste = (complet.pieces || []).filter((p) => !(p.contentId && dejaDansLeMail.has(String(p.contentId).toLowerCase())));', vers: '    const liste = complet.pieces || [];' }] },
  { nom: 'papier-transparent', rouge: '[D] en sombre, le mail garde son papier blanc', editions: [{ fichier: PAGES, de: 'background:#fff;color:#1f1f1f;', vers: 'color:#1f1f1f;' }] },
  { nom: 'image-deborde', rouge: '[D] au telephone, rien ne deborde, le mail non plus', editions: [{ fichier: PAGES, de: 'img{max-width:100%;height:auto}', vers: '' }] },
];

function appliquer(texte, editions) {
  let t = texte.replace(/\r\n/g, '\n');
  editions.forEach((e) => {
    if (t.split(e.de).length !== 2) throw new Error(`ancre introuvable ou multiple : ${e.de.slice(0, 80)}`);
    t = t.split(e.de).join(e.vers);
  });
  return t;
}
function sourceMutee(rel, editions) {
  const miennes = editions.filter((e) => e.fichier === rel);
  return miennes.length ? appliquer(fs.readFileSync(path.join(ROOT, rel), 'utf8'), miennes) : null;
}
// Un module mute se compile en memoire : rien ne s ecrit sur le disque.
function charger(rel, editions) {
  const fichier = path.join(ROOT, rel);
  const mute = sourceMutee(rel, editions);
  if (mute === null) return require(fichier);
  const m = new Module(fichier, module);
  m.filename = fichier;
  m.paths = Module._nodeModulePaths(path.dirname(fichier));
  m._compile(mute, fichier);
  return m.exports;
}

// ---------------------------------------------------------------------------
// [A] [B] [C] : les fonctions, sans base ni reseau.
const FORMULAIRE = 'Pour commencer, quel est votre nom ?   MARC TEST Choix du centre   Libramont Quelle activité vous tente ?   Bowling Nombre de participants ?   9 Date souhaitée   vendredi 4 décembre Téléphone   0470 11 22 33\nE-mail   marc@exemple.be [marc@exemple.be]\nVotre message   Pour un départ à la retraite.\n\nCe message a été envoyé depuis le site.';
const CITATION_GMAIL = 'Le jeu. 12 nov. 2026 à 18:40, Fun Galaxy Libramont <libramont@fungalaxy.be> a écrit :\n> Bonjour Paul,\n>\n> Oui, la salle est libre samedi.\n>\n> > Bonjour,\n> > La salle est-elle libre ?';
const CITATION_OUTLOOK = 'De : Fun Galaxy Libramont <libramont@fungalaxy.be>\nEnvoyé : jeudi 12 novembre 2026 18:40\nÀ : Paul Test <paul@exemple.be>\nObjet : Salle\n\nBonjour Paul,\nOui, la salle est libre.\n\nDe : Paul Test <paul@exemple.be>\nEnvoyé : mercredi 11 novembre 2026 09:12\n\nLa salle est-elle libre ?';
const REPONSE_DU_CLIENT = (adresse) => `Super, merci !\n\nLe jeu. 12 nov. 2026 à 18:40, Fun Galaxy Libramont <${adresse}> a écrit :\n> Bonjour Paul,\n> Oui, la salle est libre samedi.`;

async function verifierFonctions(editions, ok) {
  const reseau = [];
  const fetchAvant = global.fetch;
  global.fetch = async (url) => { reseau.push(String(url)); throw new Error('aucun appel reseau dans ce gate'); };
  const cles = { RESEND_INBOUND_API_KEY: process.env.RESEND_INBOUND_API_KEY, RESEND_API_KEY: process.env.RESEND_API_KEY };
  try {
    const ET = charger(FIL, editions);
    const form = ET.champsDuFormulaire(FORMULAIRE);
    const champ = (q) => ((form && form.champs.find((c) => c.question === q)) || {}).valeur;
    ok(form && form.champs.length === 8 && champ('Pour commencer, quel est votre nom ?') === 'MARC TEST' && champ('Choix du centre') === 'Libramont'
      && champ('Nombre de participants ?') === '9' && champ('Date souhaitée') === 'vendredi 4 décembre' && champ('E-mail') === 'marc@exemple.be'
      && champ('Votre message') === 'Pour un départ à la retraite.' && form.fin === 'Ce message a été envoyé depuis le site.',
    '[A] un formulaire du site se lit en questions et reponses', JSON.stringify(form && form.champs.map((c) => [c.question, c.valeur])));
    ok(ET.champsDuFormulaire('Bonjour,\n\nLa salle est-elle libre samedi ?\n\nMerci,\nPaul') === null && ET.champsDuFormulaire('Nom   Marc Centre   Libramont') === null,
      '[A] un mail ordinaire reste un texte');

    const gmail = ET.premiereCitation(CITATION_GMAIL);
    ok(gmail && gmail.auteur === 'Fun Galaxy Libramont' && gmail.adresse === 'libramont@fungalaxy.be' && /Oui, la salle est libre samedi/.test(gmail.texte)
      && !/est-elle libre/.test(gmail.texte) && gmail.date && new Date(gmail.date).getDate() === 12 && new Date(gmail.date).getHours() === 18,
    '[B] la citation de Gmail donne son auteur, son adresse, sa date et son seul premier niveau', JSON.stringify(gmail));
    const outlook = ET.premiereCitation(CITATION_OUTLOOK);
    ok(outlook && outlook.auteur === 'Fun Galaxy Libramont' && outlook.adresse === 'libramont@fungalaxy.be' && /Oui, la salle est libre/.test(outlook.texte) && !/est-elle libre/.test(outlook.texte),
      '[B] le bloc d Outlook se lit aussi', JSON.stringify(outlook));
    ok(ET.premiereCitation('Merci, a samedi.') === null, '[B] sans citation, rien n est invente');

    const { reponsesCiteesHorsPinlane } = charger(FILS, editions).__test;
    const fausseBase = (nosIds = [], identites = []) => {
      const q = async (sql, params) => {
        const s = String(sql).replace(/\s+/g, ' ').trim();
        q.appels.push({ s, params });
        if (/^select message_id from communications where center_id = \$1 and direction <> 'inbound'/i.test(s)) return { rows: nosIds.filter((id) => (params[1] || []).includes(id)).map((id) => ({ message_id: id })) };
        if (/^select email from email_identities where center_id = \$1/i.test(s)) return { rows: params[0] === 'libramont' ? identites.map((email) => ({ email })) : [] };
        throw new Error(`requete inattendue : ${s.slice(0, 80)}`);
      };
      q.appels = [];
      return q;
    };
    const citees = async (lignes, q) => {
      const rows = lignes.map(([inReplyTo, texte], i) => ({ id: i + 1, direction: 'inbound', in_reply_to: inReplyTo, payload: { textBody: texte } }));
      const messages = rows.map((r) => ({ id: r.id }));
      await reponsesCiteesHorsPinlane(q, { centre: 'libramont', rows, messages });
      return messages;
    };
    const b1 = fausseBase();
    const m1 = await citees([['<boite-1@fungalaxy.be>', REPONSE_DU_CLIENT('libramont@fungalaxy.be')]], b1);
    ok(m1[0].reponseCitee && m1[0].reponseCitee.adresse === 'libramont@fungalaxy.be' && m1[0].reponseCitee.auteur === 'Fun Galaxy Libramont'
      && /Oui, la salle est libre samedi/.test(m1[0].reponseCitee.texte) && b1.appels.some((a) => /message_id = any/.test(a.s) && a.params[0] === 'libramont'),
    '[B] une reponse partie de la boite du centre se retrouve dans la citation du client', JSON.stringify(m1[0]));
    const m2 = await citees([['<pinlane-1@fungalaxy.be>', REPONSE_DU_CLIENT('libramont@fungalaxy.be')]], fausseBase(['<pinlane-1@fungalaxy.be>']));
    ok(!m2[0].reponseCitee, '[B] un mail deja envoye par Pinlane ne se montre pas deux fois', JSON.stringify(m2[0]));
    const m3 = await citees([['<x-1@autre.be>', REPONSE_DU_CLIENT('quelquun@autre.be')]], fausseBase());
    ok(!m3[0].reponseCitee, '[B] une citation qui ne vient pas du centre ne se montre pas', JSON.stringify(m3[0]));
    const m4 = await citees([['<s-1@fungalaxy.be>', REPONSE_DU_CLIENT('sophie@fungalaxy.be')]], fausseBase([], ['sophie@fungalaxy.be']));
    ok(m4[0].reponseCitee && m4[0].reponseCitee.adresse === 'sophie@fungalaxy.be', '[B] une adresse d envoi du centre compte aussi', JSON.stringify(m4[0]));
    const m5 = await citees([['<boite-1@fungalaxy.be>', REPONSE_DU_CLIENT('libramont@fungalaxy.be')], ['<boite-1@fungalaxy.be>', REPONSE_DU_CLIENT('libramont@fungalaxy.be')]], fausseBase());
    ok(m5[0].reponseCitee && !m5[1].reponseCitee, '[B] la meme reponse citee deux fois ne se montre qu une fois', JSON.stringify(m5));

    const MRC = charger(COMPLET, editions);
    const baseDeMails = (lignes) => {
      const query = async (sql, params) => {
        const s = String(sql).replace(/\s+/g, ' ').trim();
        const borne = /center_id = \$2/.test(s);
        const recus = /direction = 'inbound'/.test(s);
        const visees = lignes.filter((l) => l.id === Number(params[0]) && (!borne || l.center_id === params[1]) && (!recus || l.direction === 'inbound'));
        if (/^select id, payload from communications/i.test(s)) return { rows: visees.map((l) => ({ id: l.id, payload: JSON.parse(JSON.stringify(l.payload)) })) };
        if (/^update communications set payload/i.test(s)) { visees.forEach((l) => Object.assign(l.payload, JSON.parse(params[2]))); return { rows: [] }; }
        throw new Error(`requete inattendue : ${s.slice(0, 80)}`);
      };
      return query;
    };
    const fauxResend = (reponses) => {
      const appels = [];
      const fetchImpl = async (url, options = {}) => {
        appels.push({ url: String(url), auth: (options.headers || {}).Authorization });
        const cle = Object.keys(reponses).find((k) => String(url).endsWith(k));
        return cle ? { ok: true, status: 200, json: async () => reponses[cle] } : { ok: false, status: 404, json: async () => ({}) };
      };
      return { fetchImpl, appels };
    };
    process.env.RESEND_INBOUND_API_KEY = 'cle-de-test-du-gate';
    const r1 = fauxResend({});
    const c1 = await MRC.lireMailRecuComplet(baseDeMails([{ id: 10, center_id: 'libramont', direction: 'inbound', payload: { provider: 'resend', providerEmailId: 'r-10', htmlBody: '<p>Bonjour</p>', piecesJointes: [] } }]),
      { centerId: 'libramont', communicationId: 10, fetchImpl: r1.fetchImpl });
    ok(c1 && c1.html === '<p>Bonjour</p>' && c1.piecesJointes.length === 0 && r1.appels.length === 0, '[C] un mail garde avec son HTML se lit sans rien demander a Resend', JSON.stringify({ c1, appels: r1.appels }));

    const lignes = [
      { id: 11, center_id: 'libramont', direction: 'inbound', payload: { provider: 'resend', providerEmailId: 'r-11', textBody: 'Photo' } },
      { id: 12, center_id: 'autre-centre', direction: 'inbound', payload: { provider: 'resend', providerEmailId: 'r-12', htmlBody: '<p>Pas a vous</p>', piecesJointes: [] } },
      { id: 13, center_id: 'libramont', direction: 'outbound', payload: { provider: 'resend', providerEmailId: 'r-13', htmlBody: '<p>Un envoi</p>', piecesJointes: [] } },
    ];
    const base = baseDeMails(lignes);
    const r2 = fauxResend({
      '/emails/receiving/r-11': { html: '<p>La photo <img src="cid:ph"></p>' },
      '/emails/receiving/r-11/attachments': { data: [
        { id: 'a1', filename: 'photo.jpg', size: 1200, content_type: 'image/jpeg', content_disposition: 'inline', content_id: '<ph>', download_url: 'https://inbound-cdn.resend.com/a1?signature=1', expires_at: '2026-11-13T12:00:00Z' },
        { id: 'a2', filename: 'menu.pdf', size: 3000, content_type: 'application/pdf', content_disposition: 'attachment', content_id: '', download_url: 'https://pirate.exemple/menu.pdf', expires_at: null },
      ] },
    });
    const c2 = await MRC.lireMailRecuComplet(base, { centerId: 'libramont', communicationId: 11, fetchImpl: r2.fetchImpl });
    const a1 = c2 && c2.piecesJointes.find((p) => p.id === 'a1');
    const a2 = c2 && c2.piecesJointes.find((p) => p.id === 'a2');
    ok(c2 && /La photo/.test(c2.html) && r2.appels[0] && r2.appels[0].url === 'https://api.resend.com/emails/receiving/r-11' && r2.appels.every((a) => a.auth === 'Bearer cle-de-test-du-gate'),
      '[C] un ancien mail se lit en entier chez Resend', JSON.stringify({ c2, appels: r2.appels }));
    ok(a1 && a1.url === 'https://inbound-cdn.resend.com/a1?signature=1' && a1.enLigne === true && a1.contentId === 'ph' && a2 && a2.url === '',
      '[C] une piece jointe garde son lien signe par Resend, un autre lien tombe', JSON.stringify(c2 && c2.piecesJointes));
    const avant = r2.appels.length;
    const c3 = await MRC.lireMailRecuComplet(base, { centerId: 'libramont', communicationId: 11, fetchImpl: r2.fetchImpl });
    const nouveaux = r2.appels.slice(avant).map((a) => a.url);
    ok(lignes[0].payload.htmlBody === '<p>La photo <img src="cid:ph"></p>' && Array.isArray(lignes[0].payload.piecesJointes) && lignes[0].payload.piecesJointes.length === 2
      && !lignes[0].payload.piecesJointes.some((p) => 'url' in p) && c3 && c3.html === c2.html && nouveaux.length === 1 && /\/attachments$/.test(nouveaux[0]),
    '[C] le HTML se garde dans la ligne du mail, la deuxieme ouverture ne le redemande pas', JSON.stringify({ garde: lignes[0].payload, nouveaux }));
    const r4 = fauxResend({});
    const etranger = await MRC.lireMailRecuComplet(base, { centerId: 'libramont', communicationId: 12, fetchImpl: r4.fetchImpl });
    const envoi = await MRC.lireMailRecuComplet(base, { centerId: 'libramont', communicationId: 13, fetchImpl: r4.fetchImpl });
    ok(etranger === null && envoi === null && r4.appels.length === 0, '[C] un mail d un autre centre ou un envoi ne se lit pas', JSON.stringify({ etranger, envoi }));
    delete process.env.RESEND_INBOUND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const r5 = fauxResend({ '/emails/receiving/r-14': { html: '<p>non</p>' } });
    const c5 = await MRC.lireMailRecuComplet(baseDeMails([{ id: 14, center_id: 'libramont', direction: 'inbound', payload: { provider: 'resend', providerEmailId: 'r-14', textBody: 'Texte' } }]),
      { centerId: 'libramont', communicationId: 14, fetchImpl: r5.fetchImpl });
    ok(c5 && c5.html === '' && c5.raison === 'sans-cle' && r5.appels.length === 0, '[C] sans cle de lecture, le mail se montre en texte, sans erreur', JSON.stringify(c5));
    ok(reseau.length === 0, '[A-C] aucun appel reseau', reseau.join(' | '));
  } finally {
    global.fetch = fetchAvant;
    Object.entries(cles).forEach(([nom, valeur]) => { if (valeur === undefined) delete process.env[nom]; else process.env[nom] = valeur; });
  }
}

// ---------------------------------------------------------------------------
// [D] : la vraie console, servie par le serveur de dev avec ses fils d exemple.
async function attendre(page, fn, arg, timeout = 15000) {
  try { await page.waitForFunction(fn, arg, { timeout }); return true; } catch (error) { return false; }
}
async function ouvrir(browser, { theme, largeur, hauteur, mobile = false, mute, erreurs }) {
  const context = await browser.newContext({ viewport: { width: largeur, height: hauteur }, isMobile: mobile, hasTouch: mobile });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
  if (mute !== null) await context.route(/\/assets\/staff-pages-v2\.js(\?|$)/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: mute }));
  const page = await context.newPage();
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.goto(`${BASE}/#/staff/emails/recus`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => typeof window.pv2EmailsGo === 'function' && typeof window.pv2ThreadOpen === 'function', null, { timeout: 20000 });
  await page.evaluate((t) => setStaffTheme(t), theme);
  await page.waitForFunction(() => pv2Threads.loaded, null, { timeout: 15000 });
  return { context, page };
}
async function ouvrirFil(page, id) {
  await page.evaluate((x) => pv2ThreadOpen(x), id);
  return attendre(page, (x) => pv2Threads.detail.loaded && pv2Threads.detail.thread && String(pv2Threads.detail.thread.id) === x
    && document.querySelectorAll('#staffEmailsPage .pl-timeline-msg').length > 0, id);
}
const CADRE_PRET = (texte) => {
  const f = [...document.querySelectorAll('#staffEmailsPage iframe.pv2-mail-recu-cadre')].pop();
  const d = f && f.contentDocument;
  return Boolean(d && d.body && d.body.textContent.includes(texte) && [...d.images].every((i) => i.complete) && f.style.height);
};

async function verifierConsole(editions, ok) {
  const { chromium } = require('playwright-core');
  const dev = require('./dev-console-server.js');
  const mute = sourceMutee(PAGES, editions);
  const serveur = dev.creerServeur(dev.creerRepondeurFixtures({ origine: BASE, exemples: true }));
  await new Promise((r) => serveur.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: NAVIGATEUR, headless: true });
  const erreurs = [];
  try {
    // --- ordinateur, theme clair -------------------------------------------
    const clair = await ouvrir(browser, { theme: 'light', largeur: 1440, hauteur: 1000, mute, erreurs });
    const page = clair.page;
    const fils = await page.evaluate(() => (pv2Threads.threads || []).map((t) => String(t.id)));
    ok(['905', '906', '907'].every((id) => fils.includes(id)), '[montage] les trois fils d exemple sont dans Recus', fils.join(','));

    await ouvrirFil(page, '905');
    const f905 = await page.evaluate(() => {
      const a = document.querySelector('#staffEmailsPage article.pl-timeline-msg');
      return {
        champs: [...a.querySelectorAll('.pv2-mail-champs .pv2-mail-champ')].map((c) => [c.querySelector('dt').textContent.trim(), c.querySelector('dd').textContent.trim()]),
        nom: ((a.querySelector('.pv2-mail-ligne strong') || {}).textContent || '').trim(),
        dest: ((a.querySelector('.pv2-mail-dest') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      };
    });
    const champ = (q) => (f905.champs.find((c) => c[0] === q) || [])[1];
    ok(f905.champs.length === 8 && champ('Pour commencer, quel est votre nom ?') === 'JULIE EXEMPLE' && champ('Nombre de participants ?') === '15'
      && champ('E-mail') === 'julie@exemple.be' && f905.nom === 'Julie Exemple' && /via le formulaire du site/.test(f905.dest),
    '[D] le formulaire du site se lit en questions et reponses', JSON.stringify(f905));

    await ouvrirFil(page, '906');
    const e906 = await page.evaluate(() => [...document.querySelectorAll('#staffEmailsPage article.pl-timeline-msg')].map((a) => {
      const p = a.querySelector('.pv2-mail-entete .pv2-mail-pastille');
      const texte = (sel) => ((a.querySelector(sel) || {}).textContent || '').replace(/\s+/g, ' ').trim();
      return { id: a.getAttribute('data-message-id'), lettre: p ? p.textContent.trim() : '', fond: p ? getComputedStyle(p).backgroundColor : '', nous: Boolean(p && p.classList.contains('is-nous')),
        nom: texte('.pv2-mail-ligne strong'), adresse: texte('.pv2-mail-adresse'), heure: Boolean(a.querySelector('.pv2-mail-quand time')), voie: texte('.pv2-mail-voie'), corps: texte('.pv2-mail-corps'), trace: texte('.pl-timeline-trace') };
    }));
    const transparent = (c) => !c || c === 'transparent' || /rgba\(\d+, \d+, \d+, 0\)/.test(c);
    const client = e906.find((m) => m.id === '61');
    const boite = e906.find((m) => m.id === 'boite-62');
    ok(e906.length === 3 && e906.every((m) => m.lettre && m.nom && m.heure && !transparent(m.fond)) && client && client.adresse === '<paul.exemple@exemple.be>'
      && boite && boite.nous && client.fond !== boite.fond,
    '[D] chaque mail a son en-tete : pastille, nom, adresse, heure', JSON.stringify(e906.map(({ corps, trace, ...m }) => m)));
    ok(e906.map((m) => m.id).join(',') === '61,boite-62,62' && boite.voie === 'Envoyé depuis votre boîte mail' && boite.nom === 'Fun Galaxy Libramont'
      && boite.adresse === '<libramont@fungalaxy.be>' && /Oui, la salle anniversaire est libre samedi à 15 h/.test(boite.corps) && !/est-elle libre/.test(boite.corps)
      && /retrouvé dans la réponse de Paul Exemple/.test(boite.trace) && /Répondu depuis votre boîte mail/.test(client.trace),
    '[D] la reponse partie de la boite du centre apparait a sa place', JSON.stringify(e906.map((m) => ({ id: m.id, voie: m.voie, corps: m.corps.slice(0, 90), trace: m.trace.slice(0, 120) }))));

    await ouvrirFil(page, '907');
    await attendre(page, CADRE_PRET, 'photo de la f');
    await page.evaluate(() => { const p = document.querySelector('#staffEmailsPage .pv2-mail-pieces'); if (p) p.scrollIntoView({ block: 'center' }); });
    await attendre(page, () => [...document.querySelectorAll('#staffEmailsPage .pv2-mail-piece img')].every((i) => i.complete && i.naturalWidth > 0), null, 6000);
    const m907 = await page.evaluate(() => {
      const f = [...document.querySelectorAll('#staffEmailsPage iframe.pv2-mail-recu-cadre')].pop();
      if (!f || !f.contentDocument) return null;
      const d = f.contentDocument;
      const article = f.closest('article');
      const csp = d.querySelector('meta[http-equiv="Content-Security-Policy"]');
      return {
        sandbox: (f.getAttribute('sandbox') || '').split(/\s+/).filter(Boolean).sort(),
        pirate: typeof window.__mailPirate,
        hauteurCadre: Math.round(f.getBoundingClientRect().height),
        hauteurDoc: d.documentElement.scrollHeight,
        texte: d.body.textContent.replace(/\s+/g, ' '),
        images: [...d.images].map((i) => ({ alt: i.alt, w: i.naturalWidth, src: String(i.getAttribute('src') || '').slice(0, 40) })),
        scripts: d.querySelectorAll('script').length,
        attributsOn: [...d.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((x) => x.name)).filter((n) => /^on/i.test(n)),
        liens: [...d.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') || '', texte: a.textContent.trim() })),
        csp: csp ? csp.getAttribute('content') : '',
        referrer: (d.querySelector('meta[name="referrer"]') || {}).content || '',
        citation: Boolean(d.querySelector('.gmail_quote')),
        plus: Boolean(article && article.querySelector('.pv2-mail-plus')),
        titrePieces: ((article && article.querySelector('.pv2-mail-pieces-titre')) || {}).textContent || '',
        pieces: [...(article ? article.querySelectorAll('.pv2-mail-piece') : [])].map((p) => ({ image: p.classList.contains('est-image'), w: p.querySelector('img') ? p.querySelector('img').naturalWidth : 0,
          type: ((p.querySelector('.pv2-mail-piece-type') || {}).textContent || '').trim(), nom: ((p.querySelector('.pv2-mail-piece-nom') || {}).textContent || '').trim(), target: p.getAttribute('target'), rel: p.getAttribute('rel') || '' })),
      };
    });
    const m = m907 || { sandbox: [], images: [], liens: [], pieces: [], attributsOn: [], texte: '', csp: '' };
    ok(Boolean(m907) && m.images.length === 1 && m.images[0].alt === 'La piste pendant la fête' && m.images[0].w > 0 && /Merci encore/.test(m.texte)
      && m.hauteurCadre > 200 && m.hauteurCadre >= m.hauteurDoc - 2,
    '[D] le mail recu s affiche en entier, la photo collee comprise', JSON.stringify({ images: m.images, hauteurCadre: m.hauteurCadre, hauteurDoc: m.hauteurDoc }));
    ok(m.sandbox.join(' ') === 'allow-popups allow-popups-to-escape-sandbox allow-same-origin' && m.pirate === 'undefined',
      '[D] le cadre du mail n a pas le droit de lancer un script', JSON.stringify({ sandbox: m.sandbox, pirate: m.pirate }));
    const piege = m.liens.find((l) => l.texte === 'le programme');
    ok(Boolean(m907) && m.scripts === 0 && m.attributsOn.length === 0 && !m.liens.some((l) => /^\s*javascript:/i.test(l.href || '')) && piege && piege.href === null
      && !m.images.some((i) => /pixel/.test(i.src)),
    '[D] le HTML du mail est nettoye : ni script, ni on*, ni javascript:, ni pixel', JSON.stringify({ scripts: m.scripts, on: m.attributsOn, liens: m.liens, images: m.images }));
    ok(m.csp.includes("default-src 'none'") && m.csp.includes('img-src https: data: blob:') && !/script-src/.test(m.csp),
      '[D] le cadre du mail n accepte que des images et du style', m.csp);
    const avecHref = m.liens.filter((l) => l.href);
    ok(avecHref.some((l) => l.href === 'https://photos.exemple.be/album/lea') && avecHref.every((l) => l.target === '_blank' && /noopener/.test(l.rel) && /noreferrer/.test(l.rel)) && m.referrer === 'no-referrer',
      '[D] les liens du mail s ouvrent dans un autre onglet, sans rien dire de la console', JSON.stringify({ liens: avecHref, referrer: m.referrer }));
    let deplie = false;
    if (m.plus && !m.citation && !/Bonjour Léa, à samedi/.test(m.texte)) {
      await page.locator('#staffEmailsPage article.pl-timeline-msg .pv2-mail-plus').last().click();
      deplie = await attendre(page, CADRE_PRET, 'Bonjour Léa, à samedi', 8000);
    }
    ok(deplie, '[D] l historique du mail se replie et se deplie', JSON.stringify({ plus: m.plus, citation: m.citation }));
    ok(m.pieces.length === 2 && m.titrePieces === '2 pièces jointes' && m.pieces.some((p) => p.image && p.w > 0 && p.nom === 'fun-run.webp')
      && m.pieces.some((p) => !p.image && p.type === 'PDF' && p.nom === 'programme-anniversaire.pdf') && m.pieces.every((p) => p.target === '_blank' && /noopener/.test(p.rel)),
    '[D] les pieces jointes se montrent comme dans Gmail, sans la photo deja dans le mail', JSON.stringify({ titre: m.titrePieces, pieces: m.pieces }));
    await clair.context.close();

    // --- ordinateur, theme sombre ------------------------------------------
    const sombre = await ouvrir(browser, { theme: 'dark', largeur: 1440, hauteur: 1000, mute, erreurs });
    await ouvrirFil(sombre.page, '907');
    await attendre(sombre.page, CADRE_PRET, 'photo de la f');
    const fond = await sombre.page.evaluate(() => {
      const f = [...document.querySelectorAll('#staffEmailsPage iframe.pv2-mail-recu-cadre')].pop();
      return { theme: document.documentElement.getAttribute('data-theme'), papier: f && f.contentDocument ? getComputedStyle(f.contentDocument.body).backgroundColor : '' };
    });
    ok(fond.theme === 'dark' && fond.papier === 'rgb(255, 255, 255)', '[D] en sombre, le mail garde son papier blanc', JSON.stringify(fond));
    await sombre.context.close();

    // --- telephone -----------------------------------------------------------
    const tel = await ouvrir(browser, { theme: 'light', largeur: 390, hauteur: 844, mobile: true, mute, erreurs });
    const mesures = [];
    for (const id of ['905', '907']) {
      // eslint-disable-next-line no-await-in-loop
      await ouvrirFil(tel.page, id);
      // eslint-disable-next-line no-await-in-loop
      if (id === '907') await attendre(tel.page, CADRE_PRET, 'photo de la f');
      // eslint-disable-next-line no-await-in-loop
      mesures.push(await tel.page.evaluate((x) => {
        const f = [...document.querySelectorAll('#staffEmailsPage iframe.pv2-mail-recu-cadre')].pop();
        const d = f && f.contentDocument;
        const a = document.querySelector('#staffEmailsPage article.pl-timeline-msg');
        return { fil: x, page: document.documentElement.scrollWidth - window.innerWidth, article: a ? Math.round(a.getBoundingClientRect().right - window.innerWidth) : 99,
          cadre: f ? Math.round(f.getBoundingClientRect().right - window.innerWidth) : null, dedans: d ? d.documentElement.scrollWidth - d.documentElement.clientWidth : null };
      }, id));
    }
    ok(mesures.length === 2 && mesures.every((x) => x.page <= 1 && x.article <= 1) && mesures[1].cadre !== null && mesures[1].cadre <= 1 && mesures[1].dedans <= 1,
      '[D] au telephone, rien ne deborde, le mail non plus', JSON.stringify(mesures));
    await tel.context.close();
    ok(!erreurs.length, '[D] aucune erreur JavaScript', erreurs.join(' | '));
  } finally {
    await browser.close();
    await new Promise((r) => serveur.close(r));
  }
}

async function verifier(editions = []) {
  const echecs = [];
  const ok = (cond, nom, detail = '') => {
    if (!cond) echecs.push(nom);
    if (!editions.length) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${nom}${cond || !detail ? '' : `  ${String(detail).slice(0, 600)}`}`);
  };
  const touche = (rel) => !editions.length || editions.some((e) => e.fichier === rel);
  if (touche(FIL) || touche(FILS) || touche(COMPLET)) await verifierFonctions(editions, ok);
  if (touche(PAGES)) await verifierConsole(editions, ok);
  return echecs;
}

(async () => {
  if (process.argv.includes('--contre-preuves')) {
    let mordent = 0;
    for (const m of MUTATIONS) {
      // eslint-disable-next-line no-await-in-loop
      const echecs = await verifier(m.editions).catch((e) => [`exception ${e.message}`]);
      const mord = echecs.includes(m.rouge);
      if (mord) mordent += 1;
      console.log(`${mord ? 'ok  ' : 'FAIL'}  contre-preuve ${m.nom} : rougit « ${m.rouge} »${mord ? '' : `  (rouges : ${echecs.join(' | ') || 'aucun'})`}`);
    }
    console.log(`\nmails-gmail --contre-preuves: ${mordent}/${MUTATIONS.length} mordent`);
    process.exit(mordent === MUTATIONS.length ? 0 : 1);
  }
  const echecs = await verifier([]);
  if (echecs.length) { console.error(`\nmails-gmail-check: ${echecs.length} FAIL`); process.exit(1); }
  console.log('\nmails-gmail-check: ALL OK (le formulaire en liste, la reponse de la boite retrouvee, le mail complet sans script, les liens dans un autre onglet, les pieces jointes, le sombre, le telephone)');
})().catch((e) => { console.error('ERREUR', e && e.stack ? e.stack.slice(0, 1200) : e); process.exit(1); });
