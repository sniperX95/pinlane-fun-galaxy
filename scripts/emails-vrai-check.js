// emails-vrai-check : CE QUE LA PAGE EMAILS DIT DE L ENVOI EST VRAI.
//
// Mesure du 2026-09-25 (serveur de dev, fixtures) : l Apercu affichait « 1 mail
// n'est jamais parti · Domaine d'envoi pas encore vérifié » pendant que
// l onglet Expediteurs, deux clics plus loin, affirmait « Envoi configuré » :
// la carte ne lisait que la PRESENCE de la cle d envoi. Elle lit maintenant les
// echecs reels de la file, avec la meme regle que le bandeau.
//
//   [A] une file ou un mail a echoue faute de domaine verifie : la carte le dit,
//       avec le bon compte, et le bandeau de l Apercu nomme la meme cause
//   [B] la meme file sans cet echec : « Envoi configuré », et aucun bandeau
//   [B2] la meme file sans cle d envoi : « Envoi non configuré », jamais un
//       « configuré » par defaut
//   [C] le suivi de l Apercu dit le nombre de mails remis que sert le serveur
//   [D] l onglet L'agent dit comment les mails recus sont lus, selon le
//       reglage servi (modele de langage ou regles internes)
//
// Serveur : scripts/dev-console-server.js (fixtures, aucun reseau, aucune
// base, AUCUN envoi). CONTRE-PREUVES : `--contre-preuves` sert le code casse
// expres, une mutation a la fois, et exige que chacune rougisse sa cible.
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright-core');
const dev = require('./dev-console-server.js');

const ROOT = path.join(__dirname, '..');
// 4305 : aucun autre gate ne le prend.
const PORT = Number(process.env.PINLANE_EMAILS_VRAI_PORT || 4305);
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CASSE = String(process.env.EMAILS_VRAI_CASSE || '');

const MUTATIONS = {
  domaine: ['staff-pages-v2.js', '                : domaineNonVerifie\n', '                : false\n', '[A] la carte du fournisseur dit que le domaine bloque l envoi'],
  cle: ['staff-pages-v2.js', '              ? (!channel.resendConfigured\n', '              ? (false\n', '[B2] sans cle d envoi, la carte dit que l envoi n est pas configure'],
  remis: ['staff-pages-v2.js', "evenements ? (remis7 !== null ? `${remis7} sur 7 j` : 'suivie')", "evenements ? 'suivie'", '[C] le suivi dit combien de mails ont ete remis'],
  lecture: ['staff-pages-v2.js', "${pv2Mail.channel && pv2Mail.channel.aiConfigured ? 'Il lit les mails reçus avec un modèle de langage.'", "${pv2Mail.channel && !pv2Mail.channel.aiConfigured ? 'Il lit les mails reçus avec un modèle de langage.'", '[D] l agent dit comment il lit les mails recus'],
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
    if (CASSE && !mutation) { console.error(`emails-vrai-check: contre-preuve inconnue ${CASSE}`); process.exit(2); }
    if (mutation && url.pathname === `/assets/${mutation[0]}`) {
      const src = fs.readFileSync(path.join(ROOT, 'assets', mutation[0]), 'utf8').replace(/\r\n/g, '\n');
      if (src.split(mutation[1]).length !== 2) { console.error(`emails-vrai-check: la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois (le code a change ?)`); process.exit(2); }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(src.replace(mutation[1], mutation[2]));
      return;
    }
    servir(req, res);
  });
}

// sansEchec : la file servie perd ses mails en echec (meme serveur, memes
// fixtures pour tout le reste). modeleDeLangage : le reglage de l agent servi.
// sansCle : le canal servi n a pas de cle d envoi.
async function ouvrir(browser, section, { sansEchec = false, modeleDeLangage = null, sansCle = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String((e && e.message) || e)));
  await page.addInitScript((sec) => {
    try { localStorage.setItem('funGalaxy_v4', JSON.stringify({ view: 'staff', staffMenuPage: 'emails', staffEmailsSection: sec, staffTheme: 'light' })); } catch (e) { /* stockage indisponible */ }
  }, section);
  if (sansEchec) {
    await page.route('**/api/ops?action=communications**', async (r) => {
      const reponse = await r.fetch();
      const corps = await reponse.json();
      corps.communications = (corps.communications || []).filter((c) => c.status !== 'failed' && c.status !== 'error');
      r.fulfill({ response: reponse, json: corps });
    });
  }
  if (modeleDeLangage !== null || sansCle) {
    await page.route('**/api/ops?action=emailStudio**', async (r) => {
      const reponse = await r.fetch();
      const corps = await reponse.json();
      corps.channel = {
        ...(corps.channel || {}),
        ...(modeleDeLangage !== null ? { aiConfigured: modeleDeLangage } : {}),
        ...(sansCle ? { resendConfigured: false } : {}),
      };
      r.fulfill({ response: reponse, json: corps });
    });
  }
  await page.goto(`${BASE}/#/staff/emails/${section}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state === 'object' && state && state.view === 'staff', null, { timeout: 15000 });
  await page.waitForSelector('#staffEmailsPage .pl-subnav-item', { timeout: 20000 });
  // La file (ops-console) arrive apres le premier rendu : on attend qu elle soit la.
  await page.waitForFunction(() => typeof getStaffEmailRows === 'function' && getStaffEmailRows().length > 0, null, { timeout: 15000 }).catch(() => {});
  return { ctx, page, erreurs };
}

const attendre = (page, fn, arg, ms = 8000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
const carte = (page) => page.evaluate(() => {
  const el = document.querySelector('#staffEmailsPage [aria-label="Fournisseur d\'envoi"] [data-pv2-envoi]');
  const note = el && el.parentElement ? el.parentElement.querySelector('.pv2-note') : null;
  return el ? { etat: el.getAttribute('data-pv2-envoi'), titre: el.textContent.trim(), note: note ? note.textContent.replace(/\s+/g, ' ').trim() : '' } : null;
});

async function run() {
  const srv = serveur();
  await new Promise((resolve) => srv.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    // =====================================================================
    console.log('[A] UNE FILE OU LE DOMAINE BLOQUE L ENVOI');
    // =====================================================================
    const a = await ouvrir(browser, 'expediteurs');
    await attendre(a.page, () => document.querySelector('#staffEmailsPage [aria-label="Fournisseur d\'envoi"] [data-pv2-envoi]'));
    const montageA = await a.page.evaluate(() => {
      const sortants = getStaffEmailRows().filter((r) => r.direction !== 'inbound' && r.status !== 'received');
      const groupe = getStaffEmailFailureGroups(sortants).find((g) => g.label === 'Domaine d\'envoi pas encore vérifié');
      return { sortants: sortants.length, domaine: groupe ? groupe.count : 0 };
    });
    ok(montageA.domaine >= 1, 'MONTAGE [A] la file servie porte un echec « domaine non verifie »', `${montageA.domaine} echec(s) sur ${montageA.sortants} mail(s) sortant(s)`);
    const vueA = await carte(a.page);
    const attenduA = montageA.domaine > 1 ? `${montageA.domaine} mails ne sont pas partis` : 'Un mail n\'est pas parti';
    ok(vueA && vueA.etat === 'domaine' && vueA.titre === 'Domaine d\'envoi pas encore vérifié' && vueA.note.startsWith(attenduA),
      '[A] la carte du fournisseur dit que le domaine bloque l envoi', vueA ? `${vueA.etat} · « ${vueA.titre} » · « ${vueA.note.slice(0, 80)} »` : 'carte absente');
    await a.page.evaluate(() => pv2EmailsGo('apercu'));
    await attendre(a.page, () => document.querySelector('#staffEmailsPage .pv2-alert'));
    const alerte = await a.page.evaluate(() => ((document.querySelector('#staffEmailsPage .pv2-alert') || {}).textContent || '').replace(/\s+/g, ' ').trim());
    ok(/Domaine d'envoi pas encore vérifié/.test(alerte), '[A] le bandeau de l Apercu nomme la meme cause', `« ${alerte.slice(0, 90)} »`);
    ok(a.erreurs.length === 0, '[A] aucune erreur JavaScript', a.erreurs.slice(0, 3).join(' | '));
    await a.ctx.close();

    // =====================================================================
    console.log('');
    console.log('[B] LA MEME FILE SANS ECHEC');
    // =====================================================================
    const b = await ouvrir(browser, 'expediteurs', { sansEchec: true });
    await attendre(b.page, () => document.querySelector('#staffEmailsPage [aria-label="Fournisseur d\'envoi"] [data-pv2-envoi]'));
    const montageB = await b.page.evaluate(() => ({
      sortants: getStaffEmailRows().filter((r) => r.direction !== 'inbound' && r.status !== 'received').length,
      echecs: getStaffEmailRows().filter((r) => r.statusKind === 'failed').length,
      cle: Boolean(pv2Mail && pv2Mail.channel && pv2Mail.channel.resendConfigured),
    }));
    ok(montageB.sortants > 0 && montageB.echecs === 0 && montageB.cle, 'MONTAGE [B] des mails sortants, aucun echec, une cle d envoi', JSON.stringify(montageB));
    const vueB = await carte(b.page);
    ok(vueB && vueB.etat === 'ok' && vueB.titre === 'Envoi configuré', '[B] sans echec, la carte dit que l envoi est configure', vueB ? `${vueB.etat} · « ${vueB.titre} »` : 'carte absente');
    await b.page.evaluate(() => pv2EmailsGo('apercu'));
    await b.page.waitForTimeout(600);
    const alerteB = await b.page.evaluate(() => Boolean(document.querySelector('#staffEmailsPage .pv2-alert')));
    ok(!alerteB, '[B] et l Apercu n affiche aucun bandeau d echec');
    ok(b.erreurs.length === 0, '[B] aucune erreur JavaScript', b.erreurs.slice(0, 3).join(' | '));
    await b.ctx.close();

    // =====================================================================
    console.log('');
    console.log('[B2] LA MEME FILE SANS CLE D ENVOI');
    // =====================================================================
    const b2 = await ouvrir(browser, 'expediteurs', { sansEchec: true, sansCle: true });
    await attendre(b2.page, () => pv2Mail && pv2Mail.channel && pv2Mail.channel.resendConfigured === false
      && document.querySelector('#staffEmailsPage [aria-label="Fournisseur d\'envoi"] [data-pv2-envoi]'));
    const montageB2 = await b2.page.evaluate(() => ({
      echecs: getStaffEmailRows().filter((r) => r.statusKind === 'failed').length,
      cle: pv2Mail && pv2Mail.channel ? pv2Mail.channel.resendConfigured : null,
    }));
    ok(montageB2.echecs === 0 && montageB2.cle === false, 'MONTAGE [B2] aucun echec, et le canal servi n a pas de cle d envoi', JSON.stringify(montageB2));
    const vueB2 = await carte(b2.page);
    ok(vueB2 && vueB2.etat === 'absent' && vueB2.titre === 'Envoi non configuré',
      '[B2] sans cle d envoi, la carte dit que l envoi n est pas configure', vueB2 ? `${vueB2.etat} · « ${vueB2.titre} »` : 'carte absente');
    ok(b2.erreurs.length === 0, '[B2] aucune erreur JavaScript', b2.erreurs.slice(0, 3).join(' | '));
    await b2.ctx.close();

    // =====================================================================
    console.log('');
    console.log('[C] LE SUIVI DES ENVOIS');
    // =====================================================================
    const c = await ouvrir(browser, 'apercu');
    await attendre(c.page, () => typeof pv2Overview === 'object' && pv2Overview.data && document.querySelector('#staffEmailsPage .pv2-suivi .pv2-suivi-ligne'));
    const suivi = await c.page.evaluate(() => {
      const o = pv2Overview.data || {};
      const ligne = document.querySelector('#staffEmailsPage .pv2-suivi .pv2-suivi-ligne');
      return {
        evenements: Boolean(o.suivi && o.suivi.evenementsRecus30j),
        remis: o.remis7j,
        etat: ligne ? ((ligne.querySelector('.pv2-suivi-etat') || {}).textContent || '').trim() : '',
      };
    });
    ok(suivi.evenements && Number.isFinite(Number(suivi.remis)), 'MONTAGE [C] le serveur sert des remises confirmees', JSON.stringify(suivi));
    ok(suivi.etat === `${suivi.remis} sur 7 j`, '[C] le suivi dit combien de mails ont ete remis', `« ${suivi.etat} » pour ${suivi.remis} remis`);
    await c.ctx.close();

    // =====================================================================
    console.log('');
    console.log('[D] COMMENT L AGENT LIT LES MAILS');
    // =====================================================================
    for (const modele of [false, true]) {
      const d = await ouvrir(browser, 'agent', { modeleDeLangage: modele });
      await attendre(d.page, (m) => pv2Mail && pv2Mail.channel && pv2Mail.channel.aiConfigured === m, modele);
      await d.page.evaluate(() => renderStaffEmailsPage());
      const sous = await d.page.evaluate(() => ((document.querySelector('#staffEmailsPage [aria-label="Réglages de l\'agent"] .pv2-panel-sub') || {}).textContent || '').trim());
      const attendu = modele ? /avec un modèle de langage\.$/ : /Sans modèle de langage relié, il lit les mails reçus avec ses règles internes\.$/;
      ok(attendu.test(sous), '[D] l agent dit comment il lit les mails recus', `${modele ? 'modele' : 'regles'} : « ${sous.slice(-80)} »`);
      await d.ctx.close();
    }
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
    const res = spawnSync(process.execPath, [__filename], { env: { ...process.env, EMAILS_VRAI_CASSE: nom }, encoding: 'utf8', timeout: 240000 });
    const sortie = `${res.stdout || ''}${res.stderr || ''}`;
    const rougit = sortie.split('\n').some((ligne) => ligne.startsWith('FAIL') && ligne.includes(cible));
    if (res.status === 2) console.log(`FAIL  contre-epreuve DESARMEE : ${nom} (ancre introuvable)`);
    else if (rougit) { mordent += 1; console.log(`ok    contre-preuve ${nom} : « ${cible} » rougit`); }
    else console.log(`FAIL  contre-preuve ${nom} : « ${cible} » reste vert`);
  }
  console.log(`\nemails-vrai-check --contre-preuves: ${mordent}/${noms.length} mordent`);
  process.exit(mordent === noms.length ? 0 : 1);
}

if (process.argv.includes('--contre-preuves')) contrePreuves();
else {
  run().then(() => {
    console.log(`\nemails-vrai-check: ${echecs ? `${echecs} echec(s)` : 'ALL OK'} (${reussis} ok)`);
    process.exit(echecs ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
