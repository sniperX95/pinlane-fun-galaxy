'use strict';
// LE TEXTE DE DEPART D UNE SEQUENCE EST LE TEXTE ENVOYE (2026-11-12). L editeur des mails automatiques
// partait d un texte ancien pour l accuse de reception, la confirmation, le rappel et le merci : un autre
// objet, des phrases en moins, et « Bien à vous, {{centre}} » en fin. Enregistre tel quel, ce texte
// remplacait le vrai mail, et sa fin faisait sauter la formule de la signature du centre (« Funement
// vôtre »). Les textes de depart (AUTOMATION_CONTENT_DEFAULTS) reprennent maintenant la prose des builders.
// Ce gate les compare au mail que le logiciel envoie, rendu sur la reservation d exemple de l apercu :
//   A. pour chaque sequence, le texte de depart (rendu comme s il etait enregistre) porte l objet du vrai
//      mail, mot pour mot ({{date}} s ecrit « samedi 20 juin », comme le logiciel), et dit les memes
//      phrases, a deux ecarts voulus pres : la date et l offre sont ecrites dans le texte, et ce qui depend
//      du dossier (le Laser Game, les blocs agenda de la confirmation) n y est pas ;
//   B. il finit comme le vrai mail, donc la signature du centre est la meme, formule de fin comprise ;
//   C. les trois mails de reservation gardent la date, l heure et l offre : un texte du centre remplace le
//      mail entier, son recapitulatif avec ;
//   D. le merci d un centre qui a donne sa fiche Google part du texte qui demande un avis ;
//   E. enregistrer le texte de depart sans changement garde le vrai mail, un texte change s enregistre,
//      « Réinitialiser » revient au vrai mail, et un texte deja ecrit par un centre part tel quel ;
//   F. dans la vraie console, l editeur montre ce texte de depart, la variante avec avis suit le lien de
//      la fiche, et « Enregistrer » sur un texte de depart n envoie aucun texte.
// Lancement : node scripts/sequences-texte-de-depart-check.js [--contre-preuves]
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const LIB = 'lib/ops-communications.js';
const FRONT = 'assets/staff-pages-v2.js';

const MUTATIONS = [
  { nom: 'phrase-en-moins', rouge: '[A] confirmation de reservation : le texte de depart dit les phrases du vrai mail', editions: [{ fichier: LIB, de: "      'Le montant se règle sur place le jour même, aucun paiement n’est demandé à l’avance.',\n", vers: '' }] },
  { nom: 'phrase-en-trop', rouge: '[A] rappel avant la venue : le texte de depart dit les phrases du vrai mail', editions: [{ fichier: LIB, de: "C’est ce qui permet de lancer tout le monde ensemble.',\n", vers: "C’est ce qui permet de lancer tout le monde ensemble.',\n      'Si possible, arrivez 10 minutes avant l’heure prévue.',\n" }] },
  { nom: 'ancien-objet', rouge: '[A] confirmation de reservation : le meme objet que le vrai mail', editions: [{ fichier: LIB, de: "subject: 'Votre réservation du {{date}} à {{heure}} est confirmée',", vers: "subject: 'Votre réservation {{centre}} est confirmée'," }] },
  { nom: 'ancienne-fin', rouge: '[B] accuse de reception : il finit comme le vrai mail, la signature du centre est la meme', editions: [{ fichier: LIB, de: "      'Notez déjà une arrivée 10 minutes avant {{heure}}.',\n", vers: "      'Notez déjà une arrivée 10 minutes avant {{heure}}.',\n      '',\n      'Bien à vous,',\n      '{{centre}}',\n" }] },
  { nom: 'date-en-chiffres', rouge: '[A] rappel avant la venue : le meme objet que le vrai mail', editions: [{ fichier: LIB, de: '    date: formatDateLongFr(reservation.date),\n    heure: vars.startTime,', vers: '    date: vars.date,\n    heure: vars.startTime,' }] },
  { nom: 'recapitulatif-perdu', rouge: '[C] les trois mails de reservation gardent la date, l heure et l offre', editions: [{ fichier: LIB, de: "'Rendez-vous le {{date}} à {{heure}}. Merci d’arriver", vers: "'Rendez-vous à {{heure}}. Merci d’arriver" }] },
  { nom: 'avis-oublie', rouge: '[D] le texte de depart du merci suit la fiche Google, et celui d un centre reste le sien', editions: [{ fichier: LIB, de: "body: String((reglage && reglage.body) || (avecAvis ? content.bodyAvecAvis : content.body) || ''),", vers: "body: String((reglage && reglage.body) || content.body || '')," }] },
  { nom: 'depart-enregistre', rouge: '[E] le texte de depart enregistre sans changement garde le vrai mail', editions: [{ fichier: LIB, de: 'if (!body || body === content.body || body === content.bodyAvecAvis) {', vers: 'if (!body) {' }] },
  { nom: 'reinitialiser-casse', rouge: '[E] « Réinitialiser » revient au vrai mail', editions: [{ fichier: LIB, de: '  if (normalized.reset === true) {\n    delete entry.subject;\n    delete entry.body;\n', vers: '  if (normalized.reset === true) {\n    delete entry.subject;\n' }] },
  { nom: 'editeur-sans-variante', rouge: '[F] le merci d un centre qui a donne sa fiche Google montre le texte qui demande un avis', editions: [{ fichier: FRONT, de: "placeholder: pv2AutoDepart(meta.key, d.reviewUrl) || 'Message par défaut'", vers: "placeholder: def.body || 'Message par défaut'" }] },
  { nom: 'lien-tape-ignore', rouge: '[F] le texte de depart du merci suit le lien tape dans l editeur', editions: [{ fichier: FRONT, de: "      if (champ) champ.setAttribute('data-placeholder', pv2Humanize(pv2AutoDepart(mkAuto.editKey, value)));\n", vers: '' }] },
  { nom: 'editeur-enregistre-le-depart', rouge: '[F] « Enregistrer » sur le texte de depart n envoie aucun texte', editions: [{ fichier: FRONT, de: '&& d.body !== def.body && d.body !== def.bodyAvecAvis) body.body = d.body;', vers: '&& d.body !== def.body) body.body = d.body;' }] },
];

const NOMS = {
  request_received: 'accuse de reception',
  confirmation: 'confirmation de reservation',
  reminder_48h: 'rappel avant la venue',
  post_visit: 'merci post-visite',
  birthday_j30: 'anniversaire',
  reactivation: 'reactivation',
};
const RESERVATION = ['request_received', 'confirmation', 'reminder_48h'];
const LIEN_AVIS = 'https://g.page/r/exemple-du-banc';

function purger() {
  Object.keys(require.cache).forEach((cle) => { if (cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`)) delete require.cache[cle]; });
}

// Les mutations du serveur passent par le chargeur de modules : le fichier sur le disque ne change jamais.
function armer(editions) {
  const parFichier = new Map();
  editions.filter((e) => e.fichier !== FRONT).forEach((e) => {
    const cible = path.normalize(path.join(ROOT, e.fichier));
    if (!parFichier.has(cible)) parFichier.set(cible, []);
    parFichier.get(cible).push(e);
  });
  const origine = Module._extensions['.js'];
  Module._extensions['.js'] = function charger(m, f) {
    const liste = parFichier.get(path.normalize(f));
    if (!liste) { origine(m, f); return; }
    let texte = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    liste.forEach((e) => {
      if (texte.split(e.de).length !== 2) throw new Error(`ancre introuvable ou multiple : ${e.de.slice(0, 80)}`);
      texte = texte.split(e.de).join(e.vers);
    });
    m._compile(texte, f);
  };
  return () => { Module._extensions['.js'] = origine; };
}

// Le texte d un mail, pour comparer deux textes qui disent la meme chose : les apostrophes, la date
// (en lettres chez le logiciel, en chiffres pour {{date}}), l heure et l offre de l exemple deviennent des
// jetons ; la date et l offre ecrites dans le texte de depart, et la phrase du Laser Game (elle depend de
// la formule du dossier), ne comptent pas.
const MOIS = 'janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre';
function jetons(texte, faits) {
  let t = String(texte || '').replace(/[’ʼ]/g, '\'');
  t = t.replace(new RegExp(`\\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) \\d{1,2}(?:er)? (?:${MOIS})(?: \\d{4})?`, 'g'), '«date»');
  if (faits.date) t = t.split(faits.date).join('«date»');
  if (faits.offre) t = t.split(faits.offre).join('«offre»');
  if (faits.heure) t = t.split(faits.heure).join('«heure»');
  return t;
}
function prose(texte, faits) {
  return jetons(texte, faits).replace(/,? pour «offre»/g, '').replace(/ le «date»/g, '').replace(/, surtout avec du Laser Game dans la formule/g, '');
}
function phrases(texte) {
  return String(texte || '').split('\n').map((l) => l.trim()).filter(Boolean)
    .flatMap((l) => l.split(/(?<=[.!?])\s+(?=\S)/)).map((p) => p.trim()).filter(Boolean);
}
// Le corps que le logiciel ecrit, sans les blocs ajoutes apres lui (agenda et partage de la confirmation,
// qu un texte du centre ne recoit pas) : ils commencent par un titre en gras, que la version texte
// ecrit sans ses asterisques depuis le 13/11.
function corpsDuLogiciel(textBody) {
  const lignes = String(textBody || '').split('\n');
  const bloc = lignes.findIndex((l) => /^\*\*.+\*\*$|^Pour ceux qui viennent avec vous$/.test(l.trim()));
  return (bloc < 0 ? lignes : lignes.slice(0, bloc)).join('\n');
}
// Ce que la signature ajoute sous le texte : la difference entre le texte lu par le client et le corps.
function signatureDe(apercu) {
  return String(apercu.texteEnvoye || '').slice(String(apercu.textBody || '').replace(/\s+$/, '').length).trim();
}

async function verifierServeur(editions, ok) {
  const titre = (t) => { if (!editions.length) console.log(t); };
  purger();
  const restaurer = armer(editions);
  try {
    process.env.PINLANE_CALENDAR_SYNC = 'off';
    // La base du banc : les reglages des mails d un centre, rien d autre.
    const reglages = new Map();
    const interroger = async (sql, params = []) => {
      if (/insert into center_automation_settings/.test(String(sql))) {
        reglages.set(String(params[0]), JSON.parse(params[1]));
        return { rows: [], rowCount: 1 };
      }
      if (/from center_automation_settings/.test(String(sql))) {
        const s = reglages.get(String(params[0]));
        return { rows: s ? [{ settings: s }] : [], rowCount: s ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    };
    const db = require(path.join(ROOT, 'lib/database.js'));
    db.getPool = () => ({ query: interroger, connect: async () => ({ query: interroger, release() {} }) });
    const OC = require(path.join(ROOT, LIB));
    const deps = { query: interroger };
    const apercu = async (cle, patch = {}) => { OC.__test.invaliderCacheDesign(); return OC.buildAutomationPreview('libramont', cle, patch); };
    const defauts = OC.getAutomationDefaults();
    // Les faits de l exemple, lus par les variables elles-memes : rien n est recopie de la fixture.
    const sonde = await apercu('confirmation', { body: '{{formule}}|{{date}}|{{heure}}' });
    const [offre, date, heure] = String(sonde.textBody || '').trim().split('|');
    const faits = { offre, date, heure };
    ok(Boolean(offre && date && heure), '[A] les faits de la reservation d exemple se lisent', JSON.stringify(faits));
    OC.__test.invaliderCacheDesign();
    const design = await OC.resolveEmailDesign('libramont');
    const formule = String(((design || {}).signature || {}).closing || '').trim();

    titre('\n[A] le texte de depart dit le vrai mail, [B] il finit comme lui');
    for (const cle of Object.keys(NOMS)) {
      const d = defauts[cle] || {};
      // eslint-disable-next-line no-await-in-loop
      const vrai = await apercu(cle);
      // eslint-disable-next-line no-await-in-loop
      const depart = await apercu(cle, { subject: d.subject, body: d.body });
      const attendues = phrases(prose(corpsDuLogiciel(vrai.textBody), faits));
      const lues = phrases(prose(depart.textBody, faits));
      const ecart = { manquent: attendues.filter((p) => !lues.includes(p)), en_trop: lues.filter((p) => !attendues.includes(p)) };
      ok(attendues.length > 1 && JSON.stringify(attendues) === JSON.stringify(lues), `[A] ${NOMS[cle]} : le texte de depart dit les phrases du vrai mail`, JSON.stringify(ecart));
      ok(Boolean(vrai.subject) && depart.subject === vrai.subject, `[A] ${NOMS[cle]} : le meme objet que le vrai mail`, JSON.stringify({ vrai: vrai.subject, depart: depart.subject }));
      const signe = signatureDe(depart);
      ok(Boolean(signe) && signe === signatureDe(vrai) && (!RESERVATION.includes(cle) || (Boolean(formule) && signe.startsWith(formule))),
        `[B] ${NOMS[cle]} : il finit comme le vrai mail, la signature du centre est la meme`, JSON.stringify({ vrai: signatureDe(vrai).slice(0, 80), depart: signe.slice(0, 80), formule }));
    }

    titre('\n[C] le recapitulatif');
    const sansFait = RESERVATION.filter((cle) => !['{{date}}', '{{heure}}', '{{formule}}'].every((v) => String((defauts[cle] || {}).body || '').includes(v)));
    ok(!sansFait.length, '[C] les trois mails de reservation gardent la date, l heure et l offre', JSON.stringify(sansFait));

    titre('\n[D] le merci d un centre qui a donne sa fiche Google');
    const pv = defauts.post_visit || {};
    const vraiAvecAvis = await apercu('post_visit', { reviewUrl: LIEN_AVIS });
    const departAvecAvis = await apercu('post_visit', { reviewUrl: LIEN_AVIS, subject: pv.subject, body: pv.bodyAvecAvis });
    ok(Boolean(pv.bodyAvecAvis) && /avis/.test(String(vraiAvecAvis.textBody || '')) && JSON.stringify(phrases(prose(vraiAvecAvis.textBody, faits))) === JSON.stringify(phrases(prose(departAvecAvis.textBody, faits))) && signatureDe(vraiAvecAvis) === signatureDe(departAvecAvis),
      '[D] avec la fiche Google, le texte de depart du merci dit le vrai mail, qui demande un avis', JSON.stringify({ vrai: String(vraiAvecAvis.textBody || '').slice(0, 200), depart: String(departAvecAvis.textBody || '').slice(0, 200) }));
    const departDe = OC.texteDeDepartDeLaSequence;
    ok(departDe('post_visit', { reviewUrl: LIEN_AVIS }).body === pv.bodyAvecAvis && departDe('post_visit', {}).body === pv.body && departDe('post_visit', { reviewUrl: LIEN_AVIS, body: 'Le texte du centre.' }).body === 'Le texte du centre.' && departDe('confirmation', {}).subject === defauts.confirmation.subject,
      '[D] le texte de depart du merci suit la fiche Google, et celui d un centre reste le sien');

    titre('\n[E] enregistrer, reinitialiser, et le texte d un centre');
    const nonGardes = [];
    for (const cle of Object.keys(NOMS)) {
      const d = defauts[cle] || {};
      for (const corps of [d.body, d.bodyAvecAvis].filter(Boolean)) {
        reglages.clear();
        // eslint-disable-next-line no-await-in-loop
        await OC.setAutomationSetting('libramont', cle, { subject: d.subject, body: corps }, deps);
        const garde = (reglages.get('libramont') || {})[cle] || {};
        if (garde.body !== undefined || garde.subject !== undefined) nonGardes.push(cle);
      }
    }
    ok(!nonGardes.length, '[E] le texte de depart enregistre sans changement garde le vrai mail', JSON.stringify(nonGardes));
    reglages.clear();
    const change = `${defauts.confirmation.body}\nÀ très vite.`;
    await OC.setAutomationSetting('libramont', 'confirmation', { body: change }, deps);
    const enregistre = ((reglages.get('libramont') || {}).confirmation || {}).body;
    await OC.setAutomationSetting('libramont', 'confirmation', { reset: true }, deps);
    const apresReset = (reglages.get('libramont') || {}).confirmation || {};
    ok(enregistre === change, '[E] un texte change s enregistre', JSON.stringify(String(enregistre || '').slice(-40)));
    ok(apresReset.body === undefined && apresReset.subject === undefined, '[E] « Réinitialiser » revient au vrai mail', JSON.stringify(apresReset));
    reglages.set('libramont', { confirmation: { enabled: true, body: 'Bonjour {{nom}},\nLe texte écrit par le centre pour le {{date}}.' } });
    const duCentre = await apercu('confirmation');
    reglages.clear();
    ok(String(duCentre.textBody || '').includes(`Le texte écrit par le centre pour le ${faits.date}.`) && !/Funement|Le montant se règle/.test(String(duCentre.textBody || '')),
      '[E] un texte deja ecrit par un centre part tel quel', String(duCentre.textBody || '').slice(0, 160));
    return { defauts };
  } finally {
    restaurer();
    purger();
  }
}

// La vraie console, avec le harnais de la page Emails : les reglages des sequences viennent des vrais
// textes de depart, et le centre a donne sa fiche Google au merci.
async function verifierEditeur(editions, ok, defauts) {
  const { chromium } = require('playwright-core');
  const harnais = require('./emails-page-check');
  const server = await harnais.serveStatic();
  const browser = await chromium.launch({ executablePath: harnais.BROWSER_PATH, headless: true });
  const erreurs = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    page.on('pageerror', (e) => erreurs.push(e.message));
    const front = editions.filter((e) => e.fichier === FRONT);
    if (front.length) {
      let source = fs.readFileSync(path.join(ROOT, FRONT), 'utf8').replace(/\r\n/g, '\n');
      front.forEach((e) => {
        if (source.split(e.de).length !== 2) throw new Error(`ancre introuvable ou multiple : ${e.de.slice(0, 80)}`);
        source = source.split(e.de).join(e.vers);
      });
      await page.route('**/assets/staff-pages-v2.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: source }));
    }
    await harnais.installMock(page);
    const reglages = { request_received: { enabled: true }, confirmation: { enabled: true }, reminder_48h: { enabled: true }, post_visit: { enabled: true, reviewUrl: LIEN_AVIS }, birthday_j30: { enabled: true }, reactivation: { enabled: false } };
    await page.addInitScript(({ defautsVrais, etat }) => {
      if (window !== window.top) return;
      const avant = window.fetch;
      window.__DEPART_POSTS__ = [];
      const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
      window.fetch = async (input, init = {}) => {
        const u = new URL(typeof input === 'string' ? input : (input && input.url) || '', window.location.origin);
        const methode = String(init.method || 'GET').toUpperCase();
        if (u.pathname === '/api/ops' && methode === 'GET' && u.searchParams.get('action') === 'automationSettings') return J({ ok: true, settings: etat, defaults: defautsVrais, stats: {} });
        if (u.pathname === '/api/ops' && methode === 'POST') {
          const b = JSON.parse(init.body || '{}');
          if (b.action === 'automationSettings') { window.__DEPART_POSTS__.push(b); return J({ ok: true, settings: etat, defaults: defautsVrais, stats: {} }); }
          if (b.action === 'automationPreview') return J({ ok: true, subject: 'Apercu', html: '<html><body><p>Apercu</p></body></html>', textBody: 'Apercu' });
        }
        return avant(input, init);
      };
    }, { defautsVrais: defauts, etat: reglages });
    await page.goto(`${harnais.BASE_URL}/?v=depart-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => { state.staffMenuPage = 'emails'; save(); setView('staff'); renderStaff(); });
    await page.waitForFunction(() => typeof window.pv2EmailsGo === 'function', null, { timeout: 15000 });
    await page.evaluate(() => pv2EmailsGo('sequences'));
    await page.waitForFunction(() => document.querySelectorAll('#staffEmailsPage .mk-auto-edit-btn').length >= 6, null, { timeout: 15000 });
    ok(true, '[F] la page Emails, section Séquences, est montee');

    // Le texte de depart se lit dans l editeur : chaque morceau fixe de chaque ligne (entre deux variables).
    const morceaux = (corps) => String(corps || '').split('\n').flatMap((l) => l.split(/\{\{[^}]+\}\}/)).map((m) => m.trim()).filter((m) => m.length > 3);
    // (ouvrir une autre sequence ferme celle qui etait ouverte : un seul editeur a la fois)
    const ouvrir = async (cle) => {
      await page.evaluate((k) => pv2AutoEdit(k), cle);
      await page.waitForFunction((k) => {
        const carte = document.querySelector('#staffEmailsPage .mk-auto.is-editing');
        return Boolean(carte && carte.querySelector(`[data-switch-key="auto:${k}"]`) && carte.querySelector('#mkAutoBody'));
      }, cle, { timeout: 5000 });
      return page.evaluate(() => document.getElementById('mkAutoBody').getAttribute('data-placeholder') || '');
    };
    const sansLeDepart = [];
    for (const cle of RESERVATION) {
      // eslint-disable-next-line no-await-in-loop
      const lu = await ouvrir(cle);
      const manque = morceaux(defauts[cle].body).filter((m) => !lu.includes(m));
      if (manque.length || /Bien à vous/.test(lu)) sansLeDepart.push({ cle, manque: manque.slice(0, 2) });
    }
    ok(!sansLeDepart.length, '[F] l editeur montre le texte de depart des mails de reservation', JSON.stringify(sansLeDepart));

    const merci = await ouvrir('post_visit');
    ok(morceaux(defauts.post_visit.bodyAvecAvis).every((m) => merci.includes(m)),
      '[F] le merci d un centre qui a donne sa fiche Google montre le texte qui demande un avis', merci.slice(0, 200));
    await page.evaluate(() => pv2AutoEditField('reviewUrl', ''));
    const sansLien = await page.evaluate(() => document.getElementById('mkAutoBody').getAttribute('data-placeholder') || '');
    await page.evaluate((lien) => pv2AutoEditField('reviewUrl', lien), LIEN_AVIS);
    const avecLien = await page.evaluate(() => document.getElementById('mkAutoBody').getAttribute('data-placeholder') || '');
    ok(morceaux(defauts.post_visit.body).every((m) => sansLien.includes(m)) && !/Deux choses/.test(sansLien) && morceaux(defauts.post_visit.bodyAvecAvis).every((m) => avecLien.includes(m)),
      '[F] le texte de depart du merci suit le lien tape dans l editeur', JSON.stringify({ sansLien: sansLien.slice(0, 120), avecLien: avecLien.slice(0, 120) }));

    await page.evaluate((corps) => { pv2AutoEditField('body', corps); pv2AutoEditSave('post_visit'); }, defauts.post_visit.bodyAvecAvis);
    await page.waitForTimeout(300);
    const apresDepart = await page.evaluate(() => window.__DEPART_POSTS__.filter((p) => p.body !== undefined).length);
    await page.evaluate(() => { const ed = document.getElementById('mkAutoBody'); if (!ed) pv2AutoEdit('post_visit'); });
    await page.waitForFunction(() => Boolean(document.getElementById('mkAutoBody')), null, { timeout: 5000 });
    await page.evaluate((corps) => { pv2AutoEditField('body', corps); pv2AutoEditSave('post_visit'); }, `${defauts.post_visit.bodyAvecAvis}\nÀ très vite.`);
    await page.waitForTimeout(400);
    const apresChange = await page.evaluate(() => window.__DEPART_POSTS__.filter((p) => p.body !== undefined).map((p) => p.body.slice(-12)));
    ok(apresDepart === 0 && apresChange.length === 1,
      '[F] « Enregistrer » sur le texte de depart n envoie aucun texte', JSON.stringify({ apresDepart, apresChange }));
    ok(!erreurs.length, '[F] aucune erreur dans la page', erreurs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
}

async function verifier(editions = []) {
  const echecs = [];
  const ok = (cond, nom, detail = '') => {
    if (!cond) echecs.push(nom);
    if (!editions.length) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${nom}${cond || !detail ? '' : `  ${String(detail).slice(0, 500)}`}`);
  };
  const serveur = !editions.length || editions.some((e) => e.fichier !== FRONT);
  const editeur = !editions.length || editions.some((e) => e.fichier === FRONT);
  let defauts = null;
  if (serveur) ({ defauts } = await verifierServeur(editions, ok));
  if (editeur) {
    if (!defauts) { purger(); defauts = require(path.join(ROOT, LIB)).getAutomationDefaults(); }
    if (!editions.length) console.log('\n[F] l editeur de la vraie console');
    await verifierEditeur(editions, ok, defauts);
  }
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
    console.log(`\nsequences-texte-de-depart --contre-preuves: ${mordent}/${MUTATIONS.length} mordent`);
    process.exit(mordent === MUTATIONS.length ? 0 : 1);
  }
  const echecs = await verifier([]);
  if (echecs.length) { console.error(`\nsequences-texte-de-depart-check: ${echecs.length} FAIL`); process.exit(1); }
  console.log('\nsequences-texte-de-depart-check: ALL OK (le texte de depart dit le vrai mail et finit comme lui, le recapitulatif, la fiche Google, enregistrer et reinitialiser, l editeur)');
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
