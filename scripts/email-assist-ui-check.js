// email-assist-ui-check : LA BARRE D AIDE A L ECRITURE (em-ia) TIENT SA PAROLE
// DANS LES CINQ EDITEURS DE LA PAGE EMAILS (2026-11-10, lot 1b).
//
// La barre est la meme partout : le nouveau message, la reponse dans Recus, le
// modele, la sequence et la campagne. Pour chacun, sur la vraie page et le vrai
// code, avec la porte emailAssist bouchonnee (des reponses ecrites ici) :
//   - un geste envoie la bonne intention et le bon contexte, avec l objet et le
//     texte du brouillon (et le mail recu, seulement dans Recus) ;
//   - pendant l appel, les champs sont verrouilles et la goutte dit ce qui se fait ;
//   - le resultat arrive dans l objet et le texte, variables {{…}} intactes ;
//   - « Revenir a mon texte » remet exactement ce qui etait la ;
//   - ok:false (200 ou 400) ne change rien et dit pourquoi ;
//   - le mode « regles » montre sa note et ses conseils, sans se dire IA ;
//   - « 3 objets » propose trois lignes, et le choix remplit l objet ;
//   - une reponse qui perd une variable ne remplace rien.
// Dans Recus, la reponse garde l objet de la conversation (regle du
// 2026-09-17) : l aide ne change que le texte et n offre pas « 3 objets ».
// Et : la demande en clair part en intention « ecrire » avec son brief ; la
// barre n existe pas pour un role sans emails.view, direction.view ni
// campaigns.manage ; l ancien bouton « Ameliorer par IA » est parti.
//
// Serveur : scripts/dev-console-server.js (fixtures, aucun reseau, aucune base,
// AUCUN envoi). `--mutate` sert le code casse expres, une mutation a la fois
// (le fichier du depot n est jamais touche), et exige que chacune rougisse sa
// cible.
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright-core');
const dev = require('./dev-console-server.js');

const ROOT = path.join(__dirname, '..');
// 4319 : aucun autre gate ne le prend.
const PORT = Number(process.env.PINLANE_EMAIL_ASSIST_UI_PORT || 4319);
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CASSE = String(process.env.EMAIL_ASSIST_UI_CASSE || '');

// [fichier, ancre, remplacement, libelle qui doit rougir]
const MUTATIONS = {
  contexte: ['staff-pages-v2.js', "      contexte: 'reponse',\n", "      contexte: 'message',\n", '[reponse] le geste envoie son intention et le contexte reponse'],
  revenir: ['staff-pages-v2.js', '    cible.poser({ subject: e.avant.subject, body: e.avant.body });\n', '    cible.poser(cible.lire());\n', 'Revenir a mon texte remet exactement le texte'],
  okfalse: ['staff-pages-v2.js', '    if (!payload || payload.ok === false || erreur) {\n', '    if (!payload) {\n', 'ok:false ne change rien'],
  objets: ['staff-pages-v2.js', '    cible.poser({ subject: objet, body: actuel.body });\n', '    cible.poser({ subject: actuel.subject, body: actuel.body });\n', '3 objets remplit l objet'],
  note: ['staff-pages-v2.js', "      e.note = String(payload.note || '').trim();\n", "      e.note = '';\n", 'le mode regles montre sa note'],
  variable: ['staff-pages-v2.js', '      if (perdues.length) {\n', '      if (false) {\n', 'une reponse qui perd une variable ne remplace rien'],
  objetfil: ['staff-pages-v2.js', '      garderObjet: true,\n', '      garderObjet: false,\n', 'l objet de la conversation reste'],
};

let echecs = 0;
let reussis = 0;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}${detail ? `  ${detail}` : ''}`); return; }
  echecs += 1;
  console.log(`FAIL  ${label}${detail ? `  ${detail}` : ''}`);
}

function serveur() {
  const interne = dev.creerServeur(dev.creerRepondeurFixtures({ origine: BASE }));
  const servir = interne.listeners('request')[0];
  return http.createServer((req, res) => {
    const url = new URL(req.url, BASE);
    const mutation = CASSE ? MUTATIONS[CASSE] : null;
    if (CASSE && !mutation) { console.error(`email-assist-ui-check: contre-preuve inconnue ${CASSE}`); process.exit(2); }
    if (mutation && url.pathname === `/assets/${mutation[0]}`) {
      const src = fs.readFileSync(path.join(ROOT, 'assets', mutation[0]), 'utf8').replace(/\r\n/g, '\n');
      if (src.split(mutation[1]).length !== 2) { console.error(`email-assist-ui-check: la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois (le code a change ?)`); process.exit(2); }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(src.replace(mutation[1], mutation[2]));
      return;
    }
    servir(req, res);
  });
}

const SUJET = 'Votre venue chez nous, {{prenom}}';
const CORPS = 'Bonjour {{prenom}},\n\nMerci pour votre demande. Nous avons de la place samedi à 14 h.\n\nL’équipe {{centre}}';
const COURT = { subject: 'Votre venue, {{prenom}}', body: 'Bonjour {{prenom}},\n\nPlace libre samedi à 14 h.\n\nL’équipe {{centre}}' };
const NOTE = 'Sans IA reliée, la traduction ne se fait pas. Votre texte reste en français.';
const CONSEIL = 'Un texte court et clair se lit bien, même sans traduction.';

// Les cinq editeurs : comment les ouvrir avec le brouillon d origine, et ou
// lire leur objet et leur texte A L ECRAN.
const EDITEURS = [
  {
    cle: 'message', contexte: 'message', section: 'apercu', champs: ['#pv2ComposerSubject', '#pv2ComposerBody'],
    ouvrir: ({ sujet, corps }) => { window.pv2OpenComposer({ to: 'claire.dumont@gmail.com', name: 'Claire Dumont', subject: sujet, body: corps }); },
  },
  {
    cle: 'reponse', contexte: 'reponse', section: 'recus', recu: true, garderObjet: true, champs: ['#staffEmailsPage .pv2-inbox-reply-subject', '#pv2ThreadReplyBody'],
    ouvrir: ({ sujet, corps }) => { const r = pv2Threads.reply[String(pv2Threads.detail.thread.id)]; r.subject = sujet; r.body = corps; renderStaffEmailsPage(); },
  },
  {
    cle: 'modele', contexte: 'modele', section: 'modeles', champs: ['#pv2TplSubject', '#pv2TplBody'],
    ouvrir: ({ sujet, corps }) => { pv2TplEdit(null); pv2Settings.tplEditing.name = 'Modèle du gate'; pv2Settings.tplEditing.subject = sujet; pv2Settings.tplEditing.body = corps; renderStaffEmailsPage(); },
  },
  {
    cle: 'sequence', contexte: 'sequence', section: 'sequences', champs: ['#mkAutoSubject', '#mkAutoBody'],
    ouvrir: ({ sujet, corps }) => { pv2AutoEdit('confirmation'); pv2AutoEditField('subject', sujet); pv2AutoEditField('body', corps); renderStaffEmailsPage(); },
  },
  {
    cle: 'campagne', contexte: 'campagne', section: 'campagnes', champs: ['#pv2CampSubject', '#pv2CampBody'],
    ouvrir: ({ sujet, corps }) => { pv2CampOpenForm(); pv2Camp.form.name = 'Campagne du gate'; pv2Camp.form.subject = sujet; pv2Camp.form.body = corps; renderStaffEmailsPage(); },
  },
];

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const attendre = (page, fn, arg, ms = 8000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);

async function ouvrirPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String((e && e.message) || e)));
  // La porte emailAssist, bouchonnee : chaque appel prend la reponse suivante
  // de la file, et on garde ce que la page a envoye.
  const appels = [];
  const file = [];
  await page.route(/\/api\/ops(\?|$)/, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    let corps = {};
    try { corps = JSON.parse(req.postData() || '{}'); } catch (e) { /* corps illisible */ }
    if (corps.action !== 'emailAssist') return route.fallback();
    appels.push(corps);
    const rep = file.shift() || { json: { ok: true, mode: 'ia', intention: corps.intention, subject: corps.subject, body: corps.body, objets: [], conseils: [], note: '' } };
    if (rep.delai) await dormir(rep.delai);
    await route.fulfill({ status: rep.status || 200, contentType: 'application/json', body: JSON.stringify(rep.json) });
  });
  await page.addInitScript(() => {
    try { localStorage.setItem('funGalaxy_v4', JSON.stringify({ view: 'staff', staffMenuPage: 'emails', staffEmailsSection: 'apercu', staffTheme: 'light' })); } catch (e) { /* stockage indisponible */ }
  });
  await page.goto(`${BASE}/#/staff/emails/apercu`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state === 'object' && state && state.view === 'staff', null, { timeout: 15000 });
  await page.waitForSelector('#staffEmailsPage .pl-subnav-item', { timeout: 20000 });
  return { ctx, page, erreurs, appels, file };
}

const lireChamps = (page, champs) => page.evaluate(([s, b]) => {
  const v = (sel) => { const el = document.querySelector(sel); if (!el) return null; return typeof el.value === 'string' ? el.value : el.textContent; };
  return { subject: v(s), body: v(b) };
}, champs);
const barre = (page, cle) => page.evaluate((c) => {
  const el = document.querySelector(`[data-em-ia="${c}"]`);
  if (!el) return null;
  return {
    occupe: el.getAttribute('aria-busy') === 'true',
    texte: el.innerText.replace(/\s+/g, ' ').trim(),
    erreur: ((el.querySelector('.em-ia-erreur') || {}).textContent || '').trim(),
    note: ((el.querySelector('.em-ia-note') || {}).textContent || '').trim(),
    conseils: [...el.querySelectorAll('.em-ia-conseil')].map((x) => x.textContent.trim()),
    objets: [...el.querySelectorAll('.em-ia-objet')].map((x) => x.textContent.trim()),
    revenir: Boolean(el.querySelector('.em-ia-revenir')),
    travail: ((el.querySelector('.em-ia-travail') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    // 2026-11-11 : le signe de travail est un point bleu qui respire, plus un
    // rond qui tourne (canevas) : on exige le point et l absence de canevas.
    goutte: Boolean(el.querySelector('.em-ia-travail .em-ia-point') && !el.querySelector('.em-ia-travail canvas')),
  };
}, cle);
async function geste(page, cle, intention) {
  await page.click(`[data-em-ia="${cle}"] [data-em-ia-intention="${intention}"]`);
  await attendre(page, (c) => { const el = document.querySelector(`[data-em-ia="${c}"]`); return el && el.getAttribute('aria-busy') !== 'true'; }, cle);
  await dormir(120);
}

async function testerEditeur(page, appels, file, ed) {
  const { cle, contexte, champs } = ed;
  console.log(`\n[${cle.toUpperCase()}] la barre dans l editeur`);
  await page.evaluate((s) => pv2EmailsGo(s), ed.section);
  await dormir(500);
  if (cle === 'reponse') {
    await page.evaluate(() => pv2ThreadsFilter('tous'));
    await attendre(page, () => pv2Threads.loaded && document.querySelector('#staffEmailsPage .pv2-thread-row[data-thread-id="901"]'));
    await page.evaluate(() => pv2ThreadOpen('901'));
    await attendre(page, () => pv2Threads.detail.loaded && pv2Threads.detail.thread && String(pv2Threads.detail.thread.id) === '901' && pv2Threads.reply['901']);
  }
  if (cle === 'sequence') await attendre(page, () => typeof window.toggleStaffAutomation === 'function' && document.querySelector('#staffEmailsPage .mk-auto-edit-btn'));
  if (cle === 'campagne') await attendre(page, () => window.pv2Camp && window.pv2Camp.loaded);
  await page.evaluate(`(${ed.ouvrir.toString()})(${JSON.stringify({ sujet: SUJET, corps: CORPS })})`);
  const present = await attendre(page, (c) => document.querySelector(`[data-em-ia="${c}"]`), cle);
  ok(present, `[${cle}] la barre est dans l editeur`);
  if (!present) return;
  const avant = await lireChamps(page, champs);
  ok(avant.subject === SUJET && avant.body === CORPS, `[${cle}] le brouillon d origine est a l ecran`, JSON.stringify(avant).slice(0, 120));

  // Un geste : la bonne intention, le bon contexte, le brouillon ; les champs
  // verrouilles et la goutte pendant l appel ; le resultat dans les champs.
  file.push({ delai: 700, json: { ok: true, mode: 'ia', intention: 'raccourcir', ...COURT, objets: [], conseils: [], note: '' } });
  const n0 = appels.length;
  await page.click(`[data-em-ia="${cle}"] [data-em-ia-intention="raccourcir"]`);
  await dormir(250);
  const pendant = await barre(page, cle);
  const verrou = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return Boolean(el && (el.getAttribute('contenteditable') === 'false' || el.disabled === true));
  }, champs[1]);
  ok(pendant && pendant.occupe && /Je raccourcis votre texte\./.test(pendant.travail) && pendant.goutte && verrou,
    `[${cle}] pendant l appel, les champs sont verrouilles et la goutte dit ce qui se fait`, JSON.stringify({ occupe: pendant && pendant.occupe, travail: pendant && pendant.travail, goutte: pendant && pendant.goutte, verrou }));
  await attendre(page, (c) => { const el = document.querySelector(`[data-em-ia="${c}"]`); return el && el.getAttribute('aria-busy') !== 'true'; }, cle);
  await dormir(150);
  const envoi = appels[n0] || {};
  ok(envoi.intention === 'raccourcir' && envoi.contexte === contexte && envoi.subject === SUJET && envoi.body === CORPS
    && (ed.recu ? typeof envoi.recu === 'string' && envoi.recu.length > 10 : !('recu' in envoi)),
  `[${cle}] le geste envoie son intention et le contexte ${contexte}`, JSON.stringify({ intention: envoi.intention, contexte: envoi.contexte, recu: ed.recu ? String(envoi.recu || '').slice(0, 30) : ('recu' in envoi) }));
  const apres = await lireChamps(page, champs);
  ok(apres.subject === (ed.garderObjet ? SUJET : COURT.subject) && apres.body === COURT.body,
    `[${cle}] le resultat arrive ${ed.garderObjet ? 'dans le texte, l objet de la conversation reste' : 'dans l objet et le texte'}, variables intactes`, JSON.stringify(apres).slice(0, 120));
  const fait = await barre(page, cle);
  ok(fait && fait.revenir && /par l’IA/.test(fait.texte), `[${cle}] le resultat se presente comme de l IA, avec « Revenir a mon texte »`, fait && fait.texte.slice(0, 90));

  // Revenir remet exactement le brouillon d origine.
  await page.click(`[data-em-ia="${cle}"] .em-ia-revenir`);
  await dormir(200);
  const revenu = await lireChamps(page, champs);
  ok(revenu.subject === SUJET && revenu.body === CORPS, `[${cle}] Revenir a mon texte remet exactement le texte`, JSON.stringify(revenu).slice(0, 120));

  // ok:false, servi en 200 puis en 400 : rien ne change, la barre dit pourquoi.
  file.push({ json: { ok: false, message: 'Cette aide n’existe pas.', subject: 'NE PAS POSER {{prenom}}', body: 'NE PAS POSER {{prenom}} {{centre}}' } });
  await geste(page, cle, 'ameliorer');
  const refus = await lireChamps(page, champs);
  const b1 = await barre(page, cle);
  ok(refus.subject === SUJET && refus.body === CORPS && /Cette aide n’existe pas/.test(b1.erreur), `[${cle}] ok:false ne change rien et dit pourquoi`, `${JSON.stringify(refus).slice(0, 80)} / ${b1.erreur}`);
  file.push({ status: 400, json: { ok: false, message: 'Le texte est trop long pour cette aide.' } });
  await geste(page, cle, 'formel');
  const refus400 = await lireChamps(page, champs);
  const b2 = await barre(page, cle);
  ok(refus400.subject === SUJET && refus400.body === CORPS && /trop long/.test(b2.erreur), `[${cle}] un refus 400 ne change rien et dit pourquoi`, b2.erreur);

  // Le mode regles : la note et les conseils en phrases, jamais « IA ».
  file.push({ json: { ok: true, mode: 'regles', intention: 'nl', subject: SUJET, body: CORPS, objets: [], conseils: [CONSEIL], note: NOTE } });
  await geste(page, cle, 'nl');
  const b3 = await barre(page, cle);
  const regles = await lireChamps(page, champs);
  // La note du serveur peut dire « Sans IA » : c est le reste de la barre qui
  // ne doit jamais presenter le resultat comme de l IA.
  const horsNote = b3.texte.replace(/Dites ce que vous voulez écrire…/, '').replace(NOTE, '').replace(CONSEIL, '');
  ok(b3.note === NOTE && b3.conseils.includes(CONSEIL) && !/\bIA\b/.test(horsNote) && regles.body === CORPS,
    `[${cle}] le mode regles montre sa note et ses conseils, sans se dire IA`, b3.texte.slice(0, 120));

  // Trois objets : trois lignes, le choix remplit l objet, le texte reste.
  // Une reponse garde l objet de la conversation : le geste n y est pas.
  if (ed.garderObjet) {
    const geste3 = await page.$(`[data-em-ia="${cle}"] [data-em-ia-intention="objets"]`);
    ok(!geste3, `[${cle}] la reponse garde l objet de la conversation, sans « 3 objets »`);
  } else {
    file.push({ json: { ok: true, mode: 'ia', intention: 'objets', subject: SUJET, body: CORPS, objets: ['Objet un', 'Objet deux', 'Objet trois'], conseils: [], note: '' } });
    await geste(page, cle, 'objets');
    const b4 = await barre(page, cle);
    ok(b4.objets.join('|') === 'Objet un|Objet deux|Objet trois', `[${cle}] « 3 objets » propose trois lignes`, b4.objets.join(' | '));
    if (b4.objets.length === 3) {
      await page.click(`[data-em-ia="${cle}"] [data-em-ia-objet="1"]`);
      await dormir(200);
    }
    const choisi = await lireChamps(page, champs);
    ok(choisi.subject === 'Objet deux' && choisi.body === CORPS, `[${cle}] 3 objets remplit l objet, le texte reste`, JSON.stringify(choisi).slice(0, 90));
    await page.click(`[data-em-ia="${cle}"] .em-ia-revenir`).catch(() => {});
    await dormir(200);
  }

  // Une reponse qui perd {{prenom}} ne remplace rien.
  file.push({ json: { ok: true, mode: 'ia', intention: 'chaleureux', subject: SUJET, body: 'Bonjour,\n\nNous avons de la place samedi.\n\nL’équipe {{centre}}', objets: [], conseils: [], note: '' } });
  await geste(page, cle, 'chaleureux');
  const perdu = await lireChamps(page, champs);
  const b5 = await barre(page, cle);
  ok(perdu.subject === SUJET && perdu.body === CORPS && /\{\{prenom\}\}/.test(b5.erreur), `[${cle}] une reponse qui perd une variable ne remplace rien`, b5.erreur);
}

async function run() {
  const srv = serveur();
  await new Promise((resolve) => srv.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    const { ctx, page, erreurs, appels, file } = await ouvrirPage(browser);
    for (const ed of EDITEURS) {
      await testerEditeur(page, appels, file, ed);
      if (ed.cle === 'message') {
        // La demande en clair : intention « ecrire », avec ce qui a ete tape.
        console.log('\n[MESSAGE] la demande en clair');
        file.push({ json: { ok: true, mode: 'ia', intention: 'ecrire', subject: 'Votre anniversaire chez nous', body: 'Bonjour {{prenom}},\n\nNous serions ravis de fêter cet anniversaire avec vous.', objets: [], conseils: [], note: '' } });
        const n0 = appels.length;
        await page.fill('[data-em-ia="message"] .em-ia-brief', 'Propose un anniversaire pour 10 enfants samedi');
        await page.press('[data-em-ia="message"] .em-ia-brief', 'Enter');
        await attendre(page, () => { const el = document.querySelector('[data-em-ia="message"]'); return el && el.getAttribute('aria-busy') !== 'true'; });
        await dormir(150);
        const envoi = appels[n0] || {};
        const champs = await lireChamps(page, EDITEURS[0].champs);
        ok(envoi.intention === 'ecrire' && envoi.contexte === 'message' && envoi.brief === 'Propose un anniversaire pour 10 enfants samedi' && champs.subject === 'Votre anniversaire chez nous',
          '[message] la demande en clair part en intention ecrire avec son brief, et le mail arrive', JSON.stringify({ intention: envoi.intention, brief: envoi.brief }));
        const ancien = await page.evaluate(() => /Améliorer par IA|Améliorer avec l'IA/.test(document.getElementById('pv2MailOverlay').innerText) || typeof window.pv2ComposerImprove === 'function' || typeof window.pv2CampImprove === 'function');
        ok(!ancien, '[message] l ancien bouton « Ameliorer par IA » a laisse la place a la barre');
        // Sans emails.view, direction.view ni campaigns.manage : pas de barre.
        const cachee = await page.evaluate(() => {
          const vrai = window.canUseStaffPermission;
          const sans = ['emails.view', 'direction.view', 'campaigns.manage'];
          window.canUseStaffPermission = (p) => { const l = Array.isArray(p) ? p : [p]; return l.some((x) => !sans.includes(x)) && vrai(l.filter((x) => !sans.includes(x))); };
          window.pv2RenderComposer();
          const absente = !document.querySelector('[data-em-ia="message"]');
          window.canUseStaffPermission = vrai;
          window.pv2RenderComposer();
          return { absente, revenue: Boolean(document.querySelector('[data-em-ia="message"]')) };
        });
        ok(cachee.absente && cachee.revenue, '[permissions] sans emails.view, direction.view ni campaigns.manage, la barre n existe pas', JSON.stringify(cachee));
        await page.evaluate(() => { if (typeof window.pv2CloseComposer === 'function') window.pv2CloseComposer(); });
        await dormir(200);
      }
    }
    ok(erreurs.length === 0, 'aucune erreur JavaScript', erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => srv.close(resolve));
  }
}

function contrePreuves() {
  const noms = Object.keys(MUTATIONS);
  let mordent = 0;
  for (const nom of noms) {
    const cible = MUTATIONS[nom][3];
    const res = spawnSync(process.execPath, [__filename], { env: { ...process.env, EMAIL_ASSIST_UI_CASSE: nom }, encoding: 'utf8', timeout: 300000 });
    const sortie = `${res.stdout || ''}${res.stderr || ''}`;
    const rougit = sortie.split('\n').some((ligne) => ligne.startsWith('FAIL') && ligne.includes(cible));
    if (res.status === 2) console.log(`FAIL  contre-preuve DESARMEE : ${nom} (ancre introuvable)`);
    else if (rougit) { mordent += 1; console.log(`ok    contre-preuve ${nom} : « ${cible} » rougit`); }
    else console.log(`FAIL  contre-preuve ${nom} : « ${cible} » reste vert`);
  }
  console.log(`\nemail-assist-ui-check --mutate: ${mordent}/${noms.length} mordent`);
  process.exit(mordent === noms.length ? 0 : 1);
}

if (process.argv.includes('--mutate')) contrePreuves();
else {
  run().then(() => {
    console.log(`\nemail-assist-ui-check: ${echecs ? `${echecs} echec(s)` : 'ALL OK'} (${reussis} ok)`);
    process.exit(echecs ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
