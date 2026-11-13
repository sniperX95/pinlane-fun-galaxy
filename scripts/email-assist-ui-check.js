// email-assist-ui-check : L ASSISTANT D ECRITURE (em-ia) EST UNE CONVERSATION QUI TIENT SA PAROLE
// DANS LES CINQ EDITEURS DE LA PAGE EMAILS (2026-11-10, en conversation depuis le 2026-11-13).
//
// Ansar, 2026-11-12 : « tu vois pas le message de l'IA, tu sais pas corriger direct depuis la conv ». L assistant
// est le meme partout : le nouveau message, la reponse dans Recus, le modele, la sequence et la campagne. Pour
// chacun, sur la vraie page et le vrai code, avec la porte emailAssist bouchonnee (des reponses ecrites ici) :
//   - un geste envoie la bonne intention, le contexte, l objet et le texte du brouillon, et une conversation vide
//     (le mail recu, seulement dans Recus) ; pendant l appel, les champs sont verrouilles et le point bleu dit ce
//     qui se fait ;
//   - la demande de l equipe et le message de l assistant s affichent dans la conversation, le resultat arrive
//     dans les champs, et sa version se dit « dans l editeur » ;
//   - une correction tapee part en intention « corriger » avec sa phrase ET la conversation d avant ;
//   - en bande, les deux derniers echanges restent en vue, le reste sur demande ;
//   - « Revenir a cette version » remet cette version, « Revenir a mon texte » le texte d avant le premier
//     changement ;
//   - un refus (ok:false, en 200 comme en 400) ne change rien, s ecrit dans la conversation, et la phrase refusee
//     revient dans la saisie ;
//   - une reponse qui perd une variable ne remplace rien ;
//   - « 3 objets » propose trois objets, le choix remplit l objet ;
//   - sans IA branchee, l assistant le dit, n offre pas « Adapter », et le mode regles montre sa note et ses conseils.
// Dans Recus, la reponse garde l objet de la conversation (regle du 2026-09-17) : l aide ne change que le texte
// et n offre pas « 3 objets ». Et, dans le nouveau message : un message neuf repart d une conversation vierge avec
// des idees, une idee touchee part en intention « ecrire », Envoyer sans rien dire ne part pas ; l assistant
// n existe pas pour un role sans emails.view, direction.view ni campaigns.manage ; l ancien bouton « Ameliorer
// par IA » est parti.
//
// Serveur : scripts/dev-console-server.js (fixtures, aucun reseau, aucune base, AUCUN envoi). `--mutate` sert le
// code casse expres, une mutation a la fois (le fichier du depot n est jamais touche), et exige que chacune
// rougisse sa cible.
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
  historique: ['staff-pages-v2.js', "    const corps = { action: 'emailAssist', centerId: state.adminCenterId || 'libramont', intention, contexte: cible.contexte, subject: actuel.subject, body: actuel.body, brief, historique };\n", "    const corps = { action: 'emailAssist', centerId: state.adminCenterId || 'libramont', intention, contexte: cible.contexte, subject: actuel.subject, body: actuel.body, brief };\n", 'la correction part avec la conversation'],
  corriger: ['staff-pages-v2.js', "    emIaAppeler(cle, cible.lire().body.trim() ? 'corriger' : 'ecrire', brief);\n", "    emIaAppeler(cle, 'ecrire', brief);\n", 'une correction tapee part en intention corriger'],
  equipe: ['staff-pages-v2.js', "    e.fil.push({ qui: 'equipe', texte: libelle });\n", '', 'la demande de l equipe s affiche dans la conversation'],
  message: ['staff-pages-v2.js', "    const dit = String(payload.message || payload.note || '').trim();\n", "    const dit = '';\n", 'le message de l assistant s affiche'],
  version: ['staff-pages-v2.js', '    cible.poser({ subject: t.version.subject, body: t.version.body });\n', '    cible.poser(cible.lire());\n', 'Revenir a cette version remet cette version'],
  depart: ['staff-pages-v2.js', '    cible.poser({ subject: e.depart.subject, body: e.depart.body });\n', '    cible.poser(cible.lire());\n', 'Revenir a mon texte remet exactement le texte'],
  refus: ['staff-pages-v2.js', '    if (!payload || payload.ok === false || erreur) { refuser(', '    if (!payload) { refuser(', 'un refus ne change rien et s ecrit dans la conversation'],
  brief: ['staff-pages-v2.js', '      if (brief && !e.brief) e.brief = brief;\n', '', 'la phrase refusee revient dans la saisie'],
  objets: ['staff-pages-v2.js', '    const nouveau = { subject: objet, body: actuel.body };\n', '    const nouveau = { subject: actuel.subject, body: actuel.body };\n', '3 objets remplit l objet'],
  variable: ['staff-pages-v2.js', '      if (perdues.length) { refuser(', '      if (false) { refuser(', 'une reponse qui perd une variable ne remplace rien'],
  objetfil: ['staff-pages-v2.js', '      garderObjet: true,\n', '      garderObjet: false,\n', 'l objet de la conversation reste'],
  verrou: ['staff-pages-v2.js', '  function emIaVerrouiller() {\n', '  function emIaVerrouiller() {\n    return;\n', 'pendant l appel, les champs sont verrouilles'],
  sait: ['staff-pages-v2.js', '    const sait = ia\n', '    const sait = true\n', 'sans IA branchee, l assistant le dit'],
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
const MSG1 = 'J’ai raccourci le mail et gardé l’heure, 14 h.';
const CORRECTION = 'Ajoutez le laser game';
const V2 = { subject: 'Samedi à 14 h, {{prenom}}', body: 'Bonjour {{prenom}},\n\nPlace libre samedi à 14 h, laser game compris.\n\nL’équipe {{centre}}' };
const MSG2 = 'J’ai ajouté le laser game, le reste ne change pas.';
const REFUSEE = 'Ajoutez le prix du minigolf';
const REFUS = 'L’IA citait « 12 », absent des infos du centre et de votre demande. Votre texte n’a pas changé.';
const NOTE = 'La traduction demande l’IA, qui n’est pas branchée pour ce centre.';
const CONSEIL = 'Un texte court et clair se lit bien, même sans traduction.';

// Les cinq editeurs : comment les ouvrir avec le brouillon d origine, et ou lire leur objet et leur texte A L ECRAN.
// `colonne` : l assistant est une colonne a cote du mail (tous les echanges en vue), sinon une bande dessous.
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
    cle: 'modele', contexte: 'modele', section: 'modeles', colonne: true, champs: ['#pv2TplSubject', '#pv2TplBody'],
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
  // Le centre a son IA branchee (emailStudio : channel.aiConfigured), sauf quand un test la debranche.
  const etat = { ia: true };
  // La porte emailAssist, bouchonnee : chaque appel prend la reponse suivante de la file, et on garde ce que la
  // page a envoye.
  const appels = [];
  const file = [];
  await page.route(/\/api\/ops(\?|$)/, async (route) => {
    const req = route.request();
    if (req.method() === 'GET' && /[?&]action=emailStudio(&|$)/.test(req.url())) {
      const r = await route.fetch();
      const j = await r.json().catch(() => null);
      if (!j) return route.fulfill({ response: r });
      j.channel = { ...(j.channel || {}), aiConfigured: etat.ia };
      return route.fulfill({ response: r, json: j });
    }
    if (req.method() !== 'POST') return route.fallback();
    let corps = {};
    try { corps = JSON.parse(req.postData() || '{}'); } catch (e) { /* corps illisible */ }
    if (corps.action !== 'emailAssist') return route.fallback();
    appels.push(corps);
    const rep = file.shift() || { json: { ok: true, mode: 'ia', intention: corps.intention, subject: corps.subject, body: corps.body, objets: [], conseils: [], note: '', message: 'Je n’ai rien changé.' } };
    if (rep.delai) await dormir(rep.delai);
    await route.fulfill({ status: rep.status || 200, contentType: 'application/json', body: JSON.stringify(rep.json) });
  });
  await page.addInitScript(() => {
    try { localStorage.setItem('funGalaxy_v4', JSON.stringify({ view: 'staff', staffMenuPage: 'emails', staffEmailsSection: 'apercu', staffTheme: 'light' })); } catch (e) { /* stockage indisponible */ }
  });
  await page.goto(`${BASE}/#/staff/emails/apercu`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state === 'object' && state && state.view === 'staff', null, { timeout: 15000 });
  await page.waitForSelector('#staffEmailsPage .pl-subnav-item', { timeout: 20000 });
  return { ctx, page, erreurs, appels, file, etat };
}

const lireChamps = (page, champs) => page.evaluate(([s, b]) => {
  const v = (sel) => { const el = document.querySelector(sel); if (!el) return null; return typeof el.value === 'string' ? el.value : el.textContent; };
  return { subject: v(s), body: v(b) };
}, champs);
// L assistant tel qu il est a l ecran : son en-tete, sa conversation tour par tour, sa saisie.
const lireAssistant = (page, cle) => page.evaluate((c) => {
  const el = document.querySelector(`[data-em-ia="${c}"]`);
  if (!el) return null;
  const qui = (li) => ['equipe', 'refus', 'note', 'travail', 'plus', 'accueil'].find((k) => li.classList.contains(`is-${k}`)) || 'aide';
  const tours = [...el.querySelectorAll('.em-ia-fil > .em-ia-tour')].map((li) => ({
    qui: qui(li),
    texte: ((li.querySelector('.em-ia-dit') || li.querySelector('p') || li).textContent || '').replace(/\s+/g, ' ').trim(),
    etat: ((li.querySelector('.em-ia-tour-etat') || {}).textContent || '').trim(),
    geste: ((li.querySelector('.em-ia-tour-geste') || {}).textContent || '').trim(),
    objets: [...li.querySelectorAll('.em-ia-objet')].map((b) => b.textContent.trim()),
    conseils: [...li.querySelectorAll('.em-ia-conseils li')].map((x) => x.textContent.trim()),
    // 2026-11-11 : le signe de travail est un point bleu qui respire, jamais un rond qui tourne (canevas).
    point: Boolean(li.querySelector('.em-ia-point')) && !li.querySelector('canvas'),
  }));
  const brief = el.querySelector('.em-ia-brief');
  return {
    occupe: el.getAttribute('aria-busy') === 'true',
    sait: ((el.querySelector('.em-ia-sait') || {}).textContent || '').trim(),
    depart: Boolean(el.querySelector('.em-ia-depart')),
    adapter: Boolean(el.querySelector('[data-em-ia-intention="adapter"]')),
    saisie: brief ? brief.value : null,
    aide: ((el.querySelector('.em-ia-saisie-aide') || {}).textContent || '').trim(),
    tours,
  };
}, cle);
const dernier = (a, qui) => (a ? [...a.tours].reverse().find((t) => t.qui === qui) : null) || {};
const libre = (page, cle) => attendre(page, (c) => { const el = document.querySelector(`[data-em-ia="${c}"]`); return el && el.getAttribute('aria-busy') !== 'true'; }, cle);

// La barre montre trois gestes, « Traduire » et « Plus » rangent les autres dans un menu (lot S, 2026-11-11).
// Comme la gerante, on ouvre le menu qui porte le geste avant de cliquer dessus.
async function ouvrirMenuDe(page, cle, intention) {
  await page.evaluate(([c, i]) => {
    const b = document.querySelector(`[data-em-ia="${c}"] [data-em-ia-intention="${i}"]`);
    const menu = b && b.closest('details.em-ia-menu');
    if (menu && !menu.open) menu.querySelector('summary').click();
  }, [cle, intention]);
}
async function geste(page, cle, intention) {
  await ouvrirMenuDe(page, cle, intention);
  await page.click(`[data-em-ia="${cle}"] [data-em-ia-intention="${intention}"]`);
  await libre(page, cle);
  await dormir(120);
}
async function envoyer(page, cle, texte) {
  await page.fill(`[data-em-ia="${cle}"] .em-ia-brief`, texte);
  await page.press(`[data-em-ia="${cle}"] .em-ia-brief`, 'Enter');
  await libre(page, cle);
  await dormir(150);
}
async function brancherIa(page, etat, oui, cle) {
  etat.ia = oui;
  await page.evaluate(([o, c]) => {
    window.pv2Mail.channel = { ...(window.pv2Mail.channel || {}), aiConfigured: o };
    if (c === 'message') window.pv2RenderComposer(); else renderStaffEmailsPage();
  }, [oui, cle]);
  await dormir(150);
}

async function testerEditeur(page, appels, file, etat, ed) {
  const { cle, contexte, champs } = ed;
  const objetDe = (v) => (ed.garderObjet ? SUJET : v.subject);
  console.log(`\n[${cle.toUpperCase()}] l assistant dans l editeur`);
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
  ok(present, `[${cle}] l assistant est dans l editeur`);
  if (!present) return;
  await brancherIa(page, etat, true, cle);
  const avant = await lireChamps(page, champs);
  ok(avant.subject === SUJET && avant.body === CORPS, `[${cle}] le brouillon d origine est a l ecran`, JSON.stringify(avant).slice(0, 120));
  const accueil = await lireAssistant(page, cle);
  ok(accueil && /vraies activités/.test(accueil.sait) && accueil.adapter, `[${cle}] avec l IA branchee, l assistant dit qu il ecrit avec les vrais faits du centre, et offre « Adapter »`, accueil && accueil.sait.slice(0, 80));

  // UN GESTE : la bonne intention, le contexte, le brouillon, une conversation vide ; les champs verrouilles et
  // le point bleu pendant l appel ; la demande et le message dans la conversation ; le resultat dans les champs.
  file.push({ delai: 700, json: { ok: true, mode: 'ia', intention: 'raccourcir', ...COURT, objets: [], conseils: [], note: '', message: MSG1 } });
  const n0 = appels.length;
  await page.click(`[data-em-ia="${cle}"] [data-em-ia-intention="raccourcir"]`);
  await dormir(250);
  const pendant = await lireAssistant(page, cle);
  const verrou = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return Boolean(el && (el.getAttribute('contenteditable') === 'false' || el.disabled === true));
  }, champs[1]);
  const travail = dernier(pendant, 'travail');
  ok(pendant && pendant.occupe && /Je raccourcis le mail/.test(travail.texte || '') && travail.point && verrou,
    `[${cle}] pendant l appel, les champs sont verrouilles et le point bleu dit ce qui se fait`, JSON.stringify({ occupe: pendant && pendant.occupe, travail: travail.texte, point: travail.point, verrou }));
  ok(dernier(pendant, 'equipe').texte === 'Plus court', `[${cle}] la demande de l equipe s affiche dans la conversation, des le geste`, dernier(pendant, 'equipe').texte);
  await libre(page, cle);
  await dormir(150);
  const envoi = appels[n0] || {};
  ok(envoi.intention === 'raccourcir' && envoi.contexte === contexte && envoi.subject === SUJET && envoi.body === CORPS && Array.isArray(envoi.historique) && envoi.historique.length === 0
    && (ed.recu ? typeof envoi.recu === 'string' && envoi.recu.length > 10 : !('recu' in envoi)),
  `[${cle}] le geste envoie son intention et le contexte ${contexte}`, JSON.stringify({ intention: envoi.intention, contexte: envoi.contexte, historique: envoi.historique, recu: ed.recu ? String(envoi.recu || '').slice(0, 30) : ('recu' in envoi) }));
  const apres = await lireChamps(page, champs);
  ok(apres.subject === objetDe(COURT) && apres.body === COURT.body,
    `[${cle}] le resultat arrive ${ed.garderObjet ? 'dans le texte, l objet de la conversation reste' : 'dans l objet et le texte'}, variables intactes`, JSON.stringify(apres).slice(0, 120));
  const fait = await lireAssistant(page, cle);
  const reponse1 = dernier(fait, 'aide');
  ok(reponse1.texte === MSG1 && /dans l’éditeur/.test(reponse1.etat) && fait.depart,
    `[${cle}] le message de l assistant s affiche, avec sa version dans l editeur et « Revenir a mon texte »`, `${reponse1.texte} / ${reponse1.etat}`);

  // UNE CORRECTION TAPEE : intention « corriger », sa phrase, et la conversation d avant.
  file.push({ json: { ok: true, mode: 'ia', intention: 'corriger', ...V2, objets: [], conseils: [], note: '', message: MSG2 } });
  const n1 = appels.length;
  await envoyer(page, cle, CORRECTION);
  const envoi2 = appels[n1] || {};
  ok(envoi2.intention === 'corriger' && envoi2.brief === CORRECTION && envoi2.body === COURT.body,
    `[${cle}] une correction tapee part en intention corriger, avec sa phrase et le mail actuel`, JSON.stringify({ intention: envoi2.intention, brief: envoi2.brief }));
  ok(JSON.stringify(envoi2.historique) === JSON.stringify([{ qui: 'equipe', texte: 'Plus court' }, { qui: 'aide', texte: MSG1 }]),
    `[${cle}] la correction part avec la conversation d avant`, JSON.stringify(envoi2.historique));
  const corrige = await lireChamps(page, champs);
  const apresCorrection = await lireAssistant(page, cle);
  ok(corrige.subject === objetDe(V2) && corrige.body === V2.body && dernier(apresCorrection, 'equipe').texte === CORRECTION && dernier(apresCorrection, 'aide').texte === MSG2 && apresCorrection.saisie === '',
    `[${cle}] la correction arrive dans les champs, la phrase et la reponse dans la conversation, la saisie se vide`, JSON.stringify(corrige).slice(0, 90));
  if (!ed.colonne) {
    const vus = apresCorrection.tours.filter((t) => ['equipe', 'aide'].includes(t.qui)).length;
    const plus = apresCorrection.tours.find((t) => t.qui === 'plus');
    ok(vus === 2 && plus && /Voir les 2 échanges d’avant/.test(plus.geste || plus.texte), `[${cle}] en bande, les deux derniers echanges restent en vue, le reste sur demande`, `${vus} / ${plus && (plus.geste || plus.texte)}`);
    await page.click(`[data-em-ia="${cle}"] .em-ia-tour.is-plus .em-ia-tour-geste`);
    await dormir(150);
  }

  // REVENIR A UNE VERSION de la conversation, puis au texte de depart.
  await page.locator(`[data-em-ia="${cle}"] li.em-ia-tour.is-aide`, { hasText: MSG1 }).locator('.em-ia-tour-geste').click();
  await dormir(200);
  const v1 = await lireChamps(page, champs);
  const apresVersion = await lireAssistant(page, cle);
  ok(v1.subject === objetDe(COURT) && v1.body === COURT.body && /Cette version est revenue/.test(dernier(apresVersion, 'note').texte || ''),
    `[${cle}] Revenir a cette version remet cette version, et la conversation le dit`, JSON.stringify(v1).slice(0, 90));
  await page.click(`[data-em-ia="${cle}"] .em-ia-depart`);
  await dormir(200);
  const revenu = await lireChamps(page, champs);
  const apresDepart = await lireAssistant(page, cle);
  ok(revenu.subject === SUJET && revenu.body === CORPS && !apresDepart.depart && /texte de départ est revenu/.test(dernier(apresDepart, 'note').texte || ''),
    `[${cle}] Revenir a mon texte remet exactement le texte`, JSON.stringify(revenu).slice(0, 120));

  // UN REFUS, en 200 puis en 400 : rien ne change, il s ecrit dans la conversation, la phrase revient.
  file.push({ json: { ok: false, refus: true, message: REFUS } });
  await envoyer(page, cle, REFUSEE);
  const refus = await lireChamps(page, champs);
  const apresRefus = await lireAssistant(page, cle);
  ok(refus.subject === SUJET && refus.body === CORPS && dernier(apresRefus, 'refus').texte === REFUS,
    `[${cle}] un refus ne change rien et s ecrit dans la conversation`, `${JSON.stringify(refus).slice(0, 60)} / ${dernier(apresRefus, 'refus').texte}`);
  ok(apresRefus.saisie === REFUSEE, `[${cle}] la phrase refusee revient dans la saisie`, JSON.stringify(apresRefus.saisie));
  await page.fill(`[data-em-ia="${cle}"] .em-ia-brief`, '');
  file.push({ status: 400, json: { ok: false, message: 'Le texte est trop long pour cette aide.' } });
  await geste(page, cle, 'formel');
  const refus400 = await lireChamps(page, champs);
  ok(refus400.subject === SUJET && refus400.body === CORPS && /trop long/.test(dernier(await lireAssistant(page, cle), 'refus').texte || ''),
    `[${cle}] un refus 400 ne change rien et dit pourquoi`, JSON.stringify(refus400).slice(0, 60));

  // Une reponse qui perd {{prenom}} ne remplace rien.
  file.push({ json: { ok: true, mode: 'ia', intention: 'chaleureux', subject: SUJET, body: 'Bonjour,\n\nNous avons de la place samedi.\n\nL’équipe {{centre}}', objets: [], conseils: [], note: '', message: 'Plus chaleureux.' } });
  await geste(page, cle, 'chaleureux');
  const perdu = await lireChamps(page, champs);
  ok(perdu.subject === SUJET && perdu.body === CORPS && /\{\{prenom\}\}/.test(dernier(await lireAssistant(page, cle), 'refus').texte || ''),
    `[${cle}] une reponse qui perd une variable ne remplace rien`, dernier(await lireAssistant(page, cle), 'refus').texte);

  // Trois objets : trois boutons, le choix remplit l objet, le texte reste. Une reponse garde l objet de la
  // conversation : le geste n y est pas.
  if (ed.garderObjet) {
    ok(!(await page.$(`[data-em-ia="${cle}"] [data-em-ia-intention="objets"]`)), `[${cle}] la reponse garde l objet de la conversation, sans « 3 objets »`);
  } else {
    file.push({ json: { ok: true, mode: 'ia', intention: 'objets', subject: SUJET, body: CORPS, objets: ['Objet un', 'Objet deux', 'Objet trois'], conseils: [], note: '', message: 'Voici trois objets.' } });
    await geste(page, cle, 'objets');
    const propose = dernier(await lireAssistant(page, cle), 'aide');
    ok(propose.objets.join('|') === 'Objet un|Objet deux|Objet trois', `[${cle}] « 3 objets » propose trois objets dans la conversation`, propose.objets.join(' | '));
    if (propose.objets.length === 3) {
      await page.locator(`[data-em-ia="${cle}"] li.em-ia-tour.is-aide [data-em-ia-objet="1"]`).last().click();
      await dormir(200);
    }
    const choisi = await lireChamps(page, champs);
    ok(choisi.subject === 'Objet deux' && choisi.body === CORPS, `[${cle}] 3 objets remplit l objet, le texte reste`, JSON.stringify(choisi).slice(0, 90));
    await page.click(`[data-em-ia="${cle}"] .em-ia-depart`).catch(() => {});
    await dormir(200);
  }

  // SANS IA BRANCHEE : l assistant le dit, n offre pas « Adapter », et le mode regles montre sa note et ses
  // conseils sans rien changer.
  await brancherIa(page, etat, false, cle);
  const sansIa = await lireAssistant(page, cle);
  ok(sansIa && /n’est pas branchée/.test(sansIa.sait) && !sansIa.adapter, `[${cle}] sans IA branchee, l assistant le dit et n offre pas « Adapter »`, sansIa && sansIa.sait.slice(0, 80));
  file.push({ json: { ok: true, mode: 'regles', intention: 'nl', subject: SUJET, body: CORPS, objets: [], conseils: [CONSEIL], note: NOTE, message: NOTE } });
  await geste(page, cle, 'nl');
  const regle = dernier(await lireAssistant(page, cle), 'aide');
  const regles = await lireChamps(page, champs);
  ok(regle.texte === NOTE && regle.conseils.includes(CONSEIL) && regles.subject === SUJET && regles.body === CORPS,
    `[${cle}] le mode regles montre sa note et ses conseils, sans rien changer`, `${regle.texte} / ${regle.conseils.join(' | ')}`);
  await brancherIa(page, etat, true, cle);
}

// Le nouveau message : un message neuf repart d une conversation vierge, ses idees, une demande en clair.
async function testerNouveauMessage(page, appels, file) {
  console.log('\n[MESSAGE] un message neuf');
  const ouvrirVide = () => page.evaluate(() => { window.pv2OpenComposer({ to: 'claire.dumont@gmail.com', name: 'Claire Dumont', subject: '', body: '' }); });
  await ouvrirVide();
  await attendre(page, () => document.querySelector('[data-em-ia="message"] .em-ia-idee'));
  const neuf = await lireAssistant(page, 'message');
  const idees = await page.$$eval('[data-em-ia="message"] .em-ia-idee', (bs) => bs.map((b) => b.textContent.trim()));
  ok(neuf && !neuf.tours.some((t) => ['equipe', 'aide', 'refus', 'note'].includes(t.qui)) && neuf.tours.some((t) => t.qui === 'accueil') && idees.length === 3,
    '[message] un nouveau message repart d une conversation vierge, avec des idees', idees.join(' | '));
  file.push({ json: { ok: true, mode: 'ia', intention: 'ecrire', subject: 'On vous attend chez nous, {{prenom}}', body: 'Bonjour {{prenom}},\n\nCela fait un moment que nous ne vous avons pas vu.', objets: [], conseils: [], note: '', message: 'Voici le mail.' } });
  const n0 = appels.length;
  await page.click('[data-em-ia="message"] .em-ia-idee >> nth=0');
  await libre(page, 'message');
  await dormir(150);
  const envoi = appels[n0] || {};
  const champs = await lireChamps(page, EDITEURS[0].champs);
  const apres = await lireAssistant(page, 'message');
  ok(envoi.intention === 'ecrire' && envoi.brief === idees[0] && champs.subject === 'On vous attend chez nous, {{prenom}}' && dernier(apres, 'equipe').texte === idees[0] && dernier(apres, 'aide').texte === 'Voici le mail.',
    '[message] une idee touchee part en intention ecrire, et le mail arrive', JSON.stringify({ intention: envoi.intention, brief: envoi.brief }));
  const avantVide = appels.length;
  await page.fill('[data-em-ia="message"] .em-ia-brief', '');
  await page.click('[data-em-ia="message"] .em-ia-envoyer');
  await dormir(200);
  const vide = await lireAssistant(page, 'message');
  ok(appels.length === avantVide && /ce qu’il faut changer/.test(vide.aide), '[message] Envoyer sans rien dire ne part pas et dit quoi faire', vide.aide);

  await ouvrirVide();
  await attendre(page, () => document.querySelector('[data-em-ia="message"] .em-ia-brief'));
  file.push({ json: { ok: true, mode: 'ia', intention: 'ecrire', subject: 'Votre anniversaire chez nous', body: 'Bonjour {{prenom}},\n\nNous serions ravis de fêter cet anniversaire avec vous.', objets: [], conseils: [], note: '', message: 'Voici le mail.' } });
  const n1 = appels.length;
  await envoyer(page, 'message', 'Propose un anniversaire pour 10 enfants samedi');
  const envoi2 = appels[n1] || {};
  const champs2 = await lireChamps(page, EDITEURS[0].champs);
  ok(envoi2.intention === 'ecrire' && envoi2.contexte === 'message' && envoi2.brief === 'Propose un anniversaire pour 10 enfants samedi' && champs2.subject === 'Votre anniversaire chez nous',
    '[message] la demande en clair part en intention ecrire avec son brief, et le mail arrive', JSON.stringify({ intention: envoi2.intention, brief: envoi2.brief }));

  const ancien = await page.evaluate(() => /Améliorer par IA|Améliorer avec l'IA/.test(document.getElementById('pv2MailOverlay').innerText) || typeof window.pv2ComposerImprove === 'function' || typeof window.pv2CampImprove === 'function');
  ok(!ancien, '[message] l ancien bouton « Ameliorer par IA » a laisse la place a l assistant');
  // Sans emails.view, direction.view ni campaigns.manage : pas d assistant.
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
  ok(cachee.absente && cachee.revenue, '[permissions] sans emails.view, direction.view ni campaigns.manage, l assistant n existe pas', JSON.stringify(cachee));
  await page.evaluate(() => { if (typeof window.pv2CloseComposer === 'function') window.pv2CloseComposer(); });
  await dormir(200);
}

async function run() {
  const srv = serveur();
  await new Promise((resolve) => srv.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    const { ctx, page, erreurs, appels, file, etat } = await ouvrirPage(browser);
    for (const ed of EDITEURS) {
      await testerEditeur(page, appels, file, etat, ed);
      if (ed.cle === 'message') {
        await page.evaluate(() => { if (typeof window.pv2CloseComposer === 'function') window.pv2CloseComposer(); });
        await testerNouveauMessage(page, appels, file);
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

// Les ancres des contre-preuves, sans navigateur : chacune doit exister une seule fois dans le code d aujourd hui.
function ancres() {
  let bonnes = 0;
  for (const [nom, [fichier, ancre]] of Object.entries(MUTATIONS)) {
    const src = fs.readFileSync(path.join(ROOT, 'assets', fichier), 'utf8').replace(/\r\n/g, '\n');
    const n = src.split(ancre).length - 1;
    if (n === 1) bonnes += 1;
    console.log(`${n === 1 ? 'ok   ' : 'FAIL '} ancre ${nom} : ${n} fois`);
  }
  console.log(`\nemail-assist-ui-check --ancres: ${bonnes}/${Object.keys(MUTATIONS).length}`);
  process.exit(bonnes === Object.keys(MUTATIONS).length ? 0 : 1);
}

if (process.argv.includes('--mutate')) contrePreuves();
else if (process.argv.includes('--ancres')) ancres();
else {
  run().then(() => {
    console.log(`\nemail-assist-ui-check: ${echecs ? `${echecs} echec(s)` : 'ALL OK'} (${reussis} ok)`);
    process.exit(echecs ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
