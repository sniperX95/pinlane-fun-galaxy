// QUAND L AGENT NE SAIT PAS, IL DEMANDE, ET IL RETIENT LA REPONSE.
//
// Pourquoi ce gate existe, mot pour mot : « l IA ne sait pas, donc il doit y
// avoir une section apprentissage IA : quand l IA ne sait pas elle pose la
// question, ils repondent, et l agent le sait pour toutes les prochaines fois ».
// Et le 2026-09-24 : « une meilleure interface, question reponse, on voit un
// suivi, on voit vraiment qu il apprend, et il change direct en fonction de ce
// qu il a appris la reponse client qu il avait proposee ».
//
// Le declencheur est un aveu, pas une panne. Quand un message ne rentre dans
// aucun sujet connu, la reponse proposee devient une pirouette (« appelez-nous
// au... »). Mesure du 2026-09-06 sur un vrai mail : « est-ce que je peux amener
// mon propre gateau ? » a produit exactement ca, parce que personne n avait
// jamais dit a l agent si le centre l autorise.
//
// La memoire elle-meme (table, centre, versions, oubli, budget du prompt) est
// mesuree par scripts/agent-memory-check.js. Ce gate-ci pilote l ECRAN : c est
// lui qui transforme un aveu en question posee a quelqu un, une reponse tapee
// en fait retenu, et qui MONTRE que l agent a change.
//
// LES PROPRIETES :
//
//   [A] L APERCU SE TAIT QUAND IL N Y A RIEN ; L AGENT DIT QU IL A TOUT SU. Un
//       encart permanent « rien a signaler » se fait ignorer dans l apercu ;
//       dans l onglet L agent, un bloc absent serait une page trouee.
//
//   [B] UNE QUESTION A LA FOIS, AVEC SON ORIGINE ET LE MESSAGE DU CLIENT. Sans
//       le mail d ou elle vient, on ne sait pas quoi repondre. « Passer » et la
//       liste complete menent aux autres.
//
//   [C] ON NE PEUT PAS APPRENDRE DU VIDE, NI TROP LONG. Au-dela de ce que le
//       serveur accepte, le compteur le dit AVANT l envoi, le bouton reste
//       inactif et le raccourci clavier ne part pas non plus.
//
//   [D] REPONDRE ENVOIE LE FAIT AU SERVEUR, au VRAI geste : taper, puis le
//       bouton ou Ctrl + Entree, sans aucun rendu entre les deux (2026-09-24 :
//       le gate redessinait la page lui-meme apres la frappe ; en vrai, le
//       bouton restait gris et la reponse de Movsar ne partait pas). Pendant
//       l attente, l ecran dit ce que fait l agent.
//
//   [E] ON VOIT QU IL A APPRIS : le fait retenu, la reponse proposee au client
//       AVANT et APRES (celles du serveur, pas un texte de l ecran), puis les
//       questions proches relues avec ce fait, chacune « resolue » ou
//       « encore ouverte » comme le serveur l a dit ; le suivi bouge.
//
//   [F] L ECRAN NE MENT PAS QUAND L AGENT N A PAS PU : sans reponse refaite, il
//       le dit, et ne presente pas l ancienne comme la nouvelle.
//
//   [G] LE SUIVI EST CELUI DU SERVEUR : le vrai nombre de questions en attente
//       (la liste est bornee), les faits, les resolues, la semaine.
//
//   [H] LA MEMOIRE SE CHERCHE, SE CORRIGE ET S OUBLIE, fait par fait (par son
//       identifiant : deux faits de meme libelle ne se confondent pas).
//
//   [I] ON LUI APPREND D OFFICE, sans attendre un client : sujet ET reponse.
//
//   [J] L APERCU RESUME ET RENVOIE A L AGENT.
//
//   [K] SANS LE DROIT D APPRENDRE, NI CASE NI BOUTON (DESIGN.md regle 9) : la
//       memoire reste lisible, le serveur refuserait le reste.
//
//   [L] LISIBLE ET SANS DEBORDEMENT : chaque texte de la section a 4,5:1 sur son
//       fond, dans les deux themes, et rien ne deborde en largeur telephone.
//
// Usage : node scripts/agent-learning-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_LEARN_PORT || 4235);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

const MOI = 'membre-qa';
const TOUTES = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'emails.view', 'emails.send', 'campaigns.manage', 'settings.manage', 'direction.view'];

// Le serveur simule : l etat de la section et ce que chaque action repond,
// pilotables depuis le test ; chaque appel est note tel qu il est parti.
async function installMock(page, perms) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, moi, perms }) => {
    // Un role verrouille aurait toutes les permissions : le role de QA ne
    // l est pas, pour que la liste des droits soit la vraie.
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: moi, name: 'Moi QA', roleId: 'qa' }, role: { id: 'qa', name: 'QA', locked: false }, permissions: perms };

    const comms = [{
      id: 42, centerId: 'libramont', channel: 'email', direction: 'inbound', status: 'received',
      templateId: null, recipient: 'marie@exemple.be', subject: 'Une question',
      createdAt: new Date().toISOString(), threadId: 901,
      payload: {
        from: 'marie@exemple.be', textBody: 'Je peux amener mon propre gateau ?',
        analysis: { intent: 'autre', intentLabel: 'Autre', summary: 'gateau', urgency: 'normale', provider: 'rules', question: 'Le centre autorise-t-il d apporter sa propre nourriture ?', reply: { subject: 'Re', body: 'Bonjour,' } },
      },
    }];
    const filDe = (c) => ({
      id: 901, centerId: 'libramont', contactEmail: c.payload.from, contactName: '',
      subject: c.subject, status: 'open', origin: 'inbound', rootCommunicationId: c.id,
      messageCount: 1, inboundCount: 1, outboundCount: 0, firstMessageAt: c.createdAt, lastMessageAt: c.createdAt, lastInboundAt: c.createdAt, lastOutboundAt: null,
      lastDirection: 'inbound', snippet: String(c.payload.textBody || '').slice(0, 120), lastInboundId: c.id, luParMoi: false, lecteurs: [], prise: null,
      intention: c.payload.analysis ? c.payload.analysis.intent : '', question: true, reponduPar: null,
    });

    const S = { questions: [], appris: [], ouvertesEnPlus: 0, prochainId: 100 };
    const semaine = Date.now() - 7 * 86400000;
    const suivi = () => ({
      faits: S.appris.length,
      questions: S.questions.length + S.ouvertesEnPlus,
      resolues: S.appris.reduce((n, f) => n + (Number(f.resolues) || 0), 0),
      semaine: S.appris.filter((f) => Date.parse(f.le || '') >= semaine).length,
    });
    window.__QA_SAVOIR__ = S;
    // Ce que chaque action repond : reponse proposee avant/apres, questions
    // proches, relecture, delais.
    window.__QA_REPONSES__ = { avant: null, apres: null, proches: [], resultats: [], delai: 0, delaiRelecture: 0 };
    window.__QA_APPELS__ = { apprendre: [], relire: [], enseigner: [], corriger: [], oublier: [] };
    const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

    const nf = window.fetch.bind(window);
    const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      let u;
      try { u = new URL(url, location.origin); } catch (e) { return nf(input, init); }
      if (!u.pathname.startsWith('/api/')) return nf(input, init);
      const method = String((init && init.method) || 'GET').toUpperCase();
      const R = window.__QA_REPONSES__;
      if (method === 'POST' && u.pathname === '/api/ops') {
        const b = JSON.parse((init && init.body) || '{}');
        if (b.action === 'answerAgentQuestion') {
          window.__QA_APPELS__.apprendre.push({ id: b.communicationId, reponse: b.reponse });
          await attendre(R.delai);
          const q = S.questions.find((x) => Number(x.communicationId) === Number(b.communicationId));
          S.questions = S.questions.filter((x) => x !== q);
          const fait = { id: S.prochainId++, question: q ? q.question : '?', reponse: b.reponse, par: 'Moi QA', le: new Date().toISOString(), resolues: 1, versions: 0 };
          S.appris = [fait].concat(S.appris);
          return J({ ok: true, fait, appris: S.appris, reanalyse: Boolean(R.apres), avant: R.avant, apres: R.apres, proches: R.proches });
        }
        if (b.action === 'agentApplyFact') {
          window.__QA_APPELS__.relire.push({ factId: b.factId, ids: b.communicationIds });
          await attendre(R.delaiRelecture);
          const resolues = R.resultats.filter((x) => x.resolue);
          S.questions = S.questions.filter((x) => !resolues.some((r) => Number(r.communicationId) === Number(x.communicationId)));
          S.appris = S.appris.map((f) => (Number(f.id) === Number(b.factId) ? Object.assign({}, f, { resolues: f.resolues + resolues.length }) : f));
          return J({ ok: true, resultats: R.resultats, resolues: resolues.length });
        }
        if (b.action === 'teachAgentFact') {
          window.__QA_APPELS__.enseigner.push({ question: b.question, reponse: b.reponse });
          const fait = { id: S.prochainId++, question: b.question, reponse: b.reponse, par: 'Moi QA', le: new Date().toISOString(), resolues: 0, versions: 0 };
          S.appris = [fait].concat(S.appris);
          return J({ ok: true, fait, appris: S.appris, proches: R.proches });
        }
        if (b.action === 'editAgentFact') {
          window.__QA_APPELS__.corriger.push({ id: b.id, reponse: b.reponse });
          S.appris = S.appris.map((f) => (Number(f.id) === Number(b.id) ? Object.assign({}, f, { reponse: b.reponse, versions: f.versions + 1 }) : f));
          return J({ ok: true, fait: S.appris.find((f) => Number(f.id) === Number(b.id)), appris: S.appris });
        }
        if (b.action === 'forgetAgentFact') {
          window.__QA_APPELS__.oublier.push({ id: b.id, question: b.question });
          S.appris = S.appris.filter((f) => (b.id ? Number(f.id) !== Number(b.id) : f.question !== b.question));
          return J({ ok: true, appris: S.appris });
        }
        return J({ ok: true });
      }
      if (u.pathname === '/api/staff-auth') {
        return J({
          ok: true, authenticated: true, session: qaSession,
          accessControl: {
            selectedRoleId: 'qa', selectedMemberId: moi,
            roles: [{ id: 'qa', name: 'QA', code: 'QA', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: false, permissions: perms }],
            members: [{ id: moi, name: 'Moi QA', contact: 'moi@x', roleId: 'qa', status: 'active', code: 'X', lastSeen: new Date().toISOString() }],
            events: [], permissions: perms,
          },
        });
      }
      const action = u.searchParams.get('action');
      if (u.pathname === '/api/ops' && action === 'agentQuestions') return J({ ok: true, questions: S.questions, appris: S.appris, suivi: suivi() });
      if (u.pathname === '/api/ops' && action === 'pulse') return J({ ok: true, empreinte: 'stable' });
      if (u.pathname === '/api/ops' && action === 'emailClaims') return J({ ok: true, claims: [] });
      if (u.pathname === '/api/ops' && action === 'communications') return J({ ok: true, communications: comms });
      if (u.pathname === '/api/ops' && action === 'emailThreads') {
        const filtre = u.searchParams.get('filtre') || 'a-repondre';
        const threads = filtre === 'repondus' || filtre === 'termines' ? [] : [filDe(comms[0])];
        return J({ ok: true, threads, total: threads.length });
      }
      if (u.pathname === '/api/ops' && action === 'emailStudio') return J({ ok: true, templates: [], identities: [{ id: 1, label: 'Accueil', email: 'contact@fungalaxy.be', isDefault: true }], channel: { resendConfigured: true, aiConfigured: false } });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: comms, samples: [], suggestions: [], events: [], claims: [], settings: {}, defaults: {}, sequences: [], overrides: {}, stats: {} });
      if (u.pathname === '/api/simulation') return J({ ok: true, status: 'idle', simulation: null });
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, moi: MOI, perms });
}

// L etat serveur pose, puis relu comme la page le relit (requestOpsAdminLoad) :
// le test ne fabrique jamais le cache de la page a la main.
async function poserEtat(page, { questions = [], appris = [], ouvertesEnPlus = 0 } = {}, reponses = {}) {
  await page.evaluate(({ questions, appris, ouvertesEnPlus, reponses }) => {
    const S = window.__QA_SAVOIR__;
    S.questions = questions; S.appris = appris; S.ouvertesEnPlus = ouvertesEnPlus;
    window.__QA_REPONSES__ = Object.assign({ avant: null, apres: null, proches: [], resultats: [], delai: 0, delaiRelecture: 0 }, reponses);
    Object.keys(window.__QA_APPELS__).forEach((k) => { window.__QA_APPELS__[k] = []; });
    Object.assign(pv2Mail, { savoirCle: '', dernierApprentissage: null, memoireFiltre: '', faitEnEdition: '', nouveauFait: { question: '' }, nouveauOuvert: false, listeOuverte: false, memoireOuverte: false, reponsesApprises: {}, apprentissageBusy: '' });
    requestOpsAdminLoad(true);
  }, { questions, appris, ouvertesEnPlus, reponses });
  await page.waitForFunction((n) => typeof opsAdminCache === 'object' && opsAdminCache && (opsAdminCache.questions || []).length === n
    && (opsAdminCache.appris || []).length === window.__QA_SAVOIR__.appris.length, questions.length, { timeout: 8000 });
  await page.evaluate(() => renderStaffEmailsPage());
  await page.waitForTimeout(150);
}

async function aller(page, section) {
  await page.evaluate((s) => pv2EmailsGo(s), section);
  await page.waitForTimeout(250);
}

async function lire(page) {
  return page.evaluate(() => {
    const s = document.querySelector('#staffEmailsPage .pv2-savoir:not(.is-apercu)') || document.querySelector('#staffEmailsPage .pv2-savoir');
    if (!s) return { presente: false };
    const t = (sel) => ((s.querySelector(sel) || {}).textContent || '').replace(/\s+/g, ' ').trim();
    const bouton = s.querySelector('.pv2-savoir-carte .pv2-savoir-apprendre');
    return {
      presente: true,
      apercu: s.classList.contains('is-apercu'),
      texte: s.innerText.replace(/\s+/g, ' ').trim(),
      compte: t('.pv2-savoir-compte'),
      chiffres: [...s.querySelectorAll('.pv2-savoir-chiffres dd')].map((d) => d.textContent.trim()),
      jauge: t('.pv2-savoir-jauge-texte'),
      cartes: s.querySelectorAll('.pv2-savoir-carte').length,
      rang: t('.pv2-savoir-rang span'),
      question: t('.pv2-savoir-carte .pv2-savoir-question'),
      origine: t('.pv2-savoir-carte .pv2-savoir-origine'),
      extrait: t('.pv2-savoir-carte .pv2-savoir-extrait'),
      champ: Boolean(s.querySelector('.pv2-savoir-carte .pv2-savoir-reponse')),
      boutonActif: bouton ? !bouton.disabled : null,
      compteur: t('.pv2-savoir-carte .pv2-savoir-compteur'),
      compteurTrop: Boolean(s.querySelector('.pv2-savoir-carte .pv2-savoir-compteur.is-trop')),
      attente: t('.pv2-savoir-carte .pv2-savoir-relit'),
      resultat: Boolean(s.querySelector('.pv2-savoir-resultat')),
      fait: t('.pv2-savoir-fait-retenu'),
      avant: t('.pv2-savoir-avant p'),
      apres: t('.pv2-savoir-apres p'),
      apresEnAttente: Boolean(s.querySelector('.pv2-savoir-apres.is-attente')),
      relit: t('.pv2-savoir-resultat .pv2-savoir-relit'),
      proches: [...s.querySelectorAll('.pv2-savoir-proches li')].map((li) => ({ resolue: li.classList.contains('is-resolue'), texte: li.textContent.replace(/\s+/g, ' ').trim() })),
      suivante: (() => { const b = s.querySelector('.pv2-savoir-fin .pv2-btn'); return b ? { texte: b.textContent.trim(), actif: !b.disabled } : null; })(),
      faits: [...s.querySelectorAll('.pv2-savoir-fait')].map((li) => ({ visible: !li.hidden && li.offsetParent !== null, texte: li.textContent.replace(/\s+/g, ' ').trim() })),
      aucun: (() => { const p = s.querySelector('.pv2-savoir-aucun'); return p && !p.hidden ? p.textContent.trim() : ''; })(),
      nouveau: Boolean(s.querySelector('.pv2-savoir-nouveau')),
      boutonsMemoire: s.querySelectorAll('.pv2-savoir-fait-actions .pv2-btn').length,
    };
  });
}

const Q1 = { communicationId: 42, question: 'Le centre autorise-t-il d apporter sa propre nourriture ?', mailSujet: 'Une question', mailDe: 'marie@exemple.be', extrait: 'Je peux amener mon propre gateau ?', recuLe: new Date().toISOString() };
const Q2 = { communicationId: 43, question: 'Quel est le tarif des arcades ?', mailSujet: 'Arcades', mailDe: 'paul@exemple.be', extrait: 'Combien coutent les arcades pour 8 enfants ?', recuLe: new Date().toISOString() };
const Q3 = { communicationId: 44, question: 'Peut-on apporter des boissons pour un anniversaire ?', mailSujet: 'Anniversaire samedi', mailDe: 'lea@exemple.be', extrait: 'On peut venir avec nos boissons ?', recuLe: new Date().toISOString() };
const Q4 = { communicationId: 45, question: 'Faut-il des chaussettes au trampoline ?', mailSujet: 'Trampoline', mailDe: 'tom@exemple.be', extrait: 'Chaussettes obligatoires ?', recuLe: new Date().toISOString() };
const AVANT = { subject: 'Re: Une question', body: 'Bonjour Marie,\n\nJe verifie ce point avec l equipe et je vous reponds tres vite.' };
const APRES = { subject: 'Re: Une question', body: 'Bonjour Marie,\n\nOui, vous pouvez apporter votre gateau d anniversaire : les autres aliments restent interdits.' };

async function ouvrirConsole(browser, perms, viewport = { width: 1400, height: 950 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  await installMock(page, perms);
  await page.goto(`${BASE_URL}/?v=learn-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
  await page.evaluate(() => { state.staffMenuPage = 'emails'; state.staffTheme = 'dark'; save(); setView('staff'); renderStaff(); });
  await page.waitForTimeout(1200);
  return { context, page, errs };
}

// Le contraste de chaque texte de la section sur le fond reellement peint
// derriere lui (le premier ancetre opaque).
async function contrastes(page) {
  return page.evaluate(() => {
    const s = document.querySelector('#staffEmailsPage .pv2-savoir');
    const rgb = (c) => { const m = String(c).match(/[\d.]+/g) || []; return { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] }; };
    const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const fond = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.a >= 0.99) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
    const pire = { ratio: 99, texte: '' };
    const w = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
    let n;
    let mesures = 0;
    while ((n = w.nextNode())) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || el.closest('[hidden]') || !el.getClientRects().length) continue;
      if (el.closest('.pv2-btn.primary')) continue;
      const c = rgb(st.color);
      const f = fond(el);
      const col = { r: c.r * c.a + f.r * (1 - c.a), g: c.g * c.a + f.g * (1 - c.a), b: c.b * c.a + f.b * (1 - c.a) };
      const L1 = lum(col); const L2 = lum(f);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      mesures += 1;
      if (ratio < pire.ratio) { pire.ratio = Math.round(ratio * 100) / 100; pire.texte = n.textContent.trim().slice(0, 40); }
    }
    return { mesures, ...pire };
  });
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const toutesErreurs = [];
  try {
    const { context, page, errs } = await ouvrirConsole(browser, TOUTES);

    // =====================================================================
    console.log('[A] l apercu se tait quand il n y a rien ; L agent dit qu il a tout su');
    // =====================================================================
    await aller(page, 'apercu');
    await poserEtat(page, {});
    ok((await lire(page)).presente === false, '[A] apercu : aucune section quand l agent n a rien a demander ni rien retenu');
    await aller(page, 'agent');
    const vide = await lire(page);
    ok(vide.presente && !vide.apercu && /a su répondre à tous les messages/.test(vide.texte) && vide.cartes === 0,
      '[A] L agent : la section est la et dit que l agent a su repondre a tout', vide.texte.slice(0, 90));
    ok(vide.chiffres.join('|') === '0|0|0|+0' && /Aucune question en attente/.test(vide.compte),
      '[A] et le suivi a zero, sans rien inventer', JSON.stringify({ chiffres: vide.chiffres, compte: vide.compte }));

    // =====================================================================
    console.log('\n[B] une question a la fois, avec son origine et le message du client');
    // =====================================================================
    await poserEtat(page, { questions: [Q1, Q2, Q3] });
    const b1 = await lire(page);
    ok(b1.cartes === 1 && b1.rang === 'Question 1 sur 3', '[B] une seule carte, « Question 1 sur 3 »', JSON.stringify({ cartes: b1.cartes, rang: b1.rang }));
    ok(b1.question === Q1.question, '[B] la question posee par l agent est lisible', b1.question);
    ok(/marie@exemple\.be/.test(b1.origine) && /Une question/.test(b1.origine), '[B] avec qui l a posee et a propos de quoi', b1.origine);
    ok(b1.extrait === Q1.extrait, '[B] et le debut du message du client, pour repondre en le lisant', b1.extrait);
    await page.click('#staffEmailsPage .pv2-savoir-passer');
    await page.waitForTimeout(150);
    const b2 = await lire(page);
    ok(b2.rang === 'Question 2 sur 3' && b2.question === Q2.question, '[B] « Passer » mene a la question suivante', JSON.stringify({ rang: b2.rang, q: b2.question }));
    await page.click('#staffEmailsPage .pv2-savoir-bloc > summary >> text=Toutes les questions (3)');
    await page.waitForTimeout(150);
    await page.click(`#staffEmailsPage .pv2-savoir-toutes .pv2-link-btn >> text=${Q3.question}`);
    await page.waitForTimeout(150);
    const b3 = await lire(page);
    ok(b3.rang === 'Question 3 sur 3' && b3.question === Q3.question, '[B] la liste complete mene a n importe laquelle', JSON.stringify({ rang: b3.rang, q: b3.question }));
    await page.click(`#staffEmailsPage .pv2-savoir-toutes .pv2-link-btn >> text=${Q1.question}`);
    await page.waitForTimeout(150);

    // =====================================================================
    console.log('\n[C] on ne peut pas apprendre du vide, ni trop long');
    // =====================================================================
    const c0 = await lire(page);
    ok(c0.question === Q1.question && c0.boutonActif === false, '[C] le bouton Apprendre est inactif tant que rien n est ecrit', String(c0.boutonActif));
    // La limite est celle que le serveur applique, relue dans sa source
    // (APPRIS_LIMITS, lib/email-agent.js), jamais recopiee ici.
    const limite = Number((/APPRIS_LIMITS = \{ question: \d+, reponse: (\d+) \}/.exec(fs.readFileSync(path.join(ROOT, 'lib', 'email-agent.js'), 'utf8')) || [])[1]);
    await page.fill('#staffEmailsPage .pv2-savoir-carte .pv2-savoir-reponse', 'x'.repeat(limite + 1));
    const trop = await lire(page);
    ok(limite > 0 && trop.boutonActif === false && trop.compteurTrop && trop.compteur.indexOf(`${limite + 1} / ${limite}`) === 0,
      '[C] au-dela de ce que le serveur accepte, le compteur le dit avant l envoi et le bouton reste inactif', JSON.stringify({ limite, compteur: trop.compteur.slice(0, 40), actif: trop.boutonActif }));
    await page.focus('#staffEmailsPage .pv2-savoir-carte .pv2-savoir-reponse');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(300);
    ok((await page.evaluate(() => window.__QA_APPELS__.apprendre.length)) === 0, '[C] Ctrl + Entree ne part pas davantage que le bouton');
    await page.fill('#staffEmailsPage .pv2-savoir-carte .pv2-savoir-reponse', '');
    const videe = await lire(page);
    ok(videe.boutonActif === false && !videe.compteurTrop && videe.compteur === `0 / ${limite}`, '[C] videe, la case redevient « 0 », et le bouton inactif', JSON.stringify({ compteur: videe.compteur, actif: videe.boutonActif }));

    // =====================================================================
    console.log('\n[D] repondre envoie le fait au serveur, au vrai geste');
    // =====================================================================
    await page.evaluate((r) => { Object.assign(window.__QA_REPONSES__, r); }, {
      avant: AVANT, apres: APRES, delai: 700, delaiRelecture: 900,
      // La question PROCHAINE dans la liste (Q2) est celle que la relecture
      // resout : la suite ne doit pas la reproposer.
      proches: [Q2, Q3].map((q) => ({ communicationId: q.communicationId, question: q.question })),
      resultats: [
        { communicationId: 43, relu: true, resolue: true, question: Q2.question, encore: '', mailDe: Q2.mailDe },
        { communicationId: 44, relu: true, resolue: false, question: Q3.question, encore: 'Les boissons sont-elles autorisees pour un anniversaire du soir ?', mailDe: Q3.mailDe },
      ],
    });
    await page.click('#staffEmailsPage .pv2-savoir-carte .pv2-savoir-reponse');
    await page.keyboard.type('Oui, uniquement le gateau d anniversaire.');
    const frappe = await lire(page);
    ok(frappe.boutonActif === true && frappe.compteur.indexOf(`41 / ${limite}`) === 0,
      '[D] le bouton s active pendant la frappe, sans attendre un autre rendu, et le compteur suit', JSON.stringify({ actif: frappe.boutonActif, compteur: frappe.compteur }));
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(250);
    const pendant = await lire(page);
    ok(/retient votre réponse et refait la sienne/.test(pendant.attente) && pendant.boutonActif === false,
      '[D] pendant l attente, l ecran dit ce que fait l agent et le bouton ne se retouche pas', JSON.stringify({ attente: pendant.attente, actif: pendant.boutonActif }));
    await page.waitForFunction(() => document.querySelector('#staffEmailsPage .pv2-savoir-resultat'), null, { timeout: 5000 });
    const envoyes = await page.evaluate(() => window.__QA_APPELS__.apprendre);
    ok(envoyes.length === 1 && Number(envoyes[0].id) === 42, '[D] le fait part vers le serveur, rattache au bon message', JSON.stringify(envoyes));
    ok(String(envoyes[0] && envoyes[0].reponse) === 'Oui, uniquement le gateau d anniversaire.', '[D] avec exactement ce qui a ete tape', String(envoyes[0] && envoyes[0].reponse));

    // =====================================================================
    console.log('\n[E] on voit qu il a appris');
    // =====================================================================
    const e1 = await lire(page);
    ok(/^Appris/.test(e1.texte.slice(e1.texte.indexOf('Appris'))) && e1.fait.indexOf(Q1.question) === 0 && /uniquement le gateau/.test(e1.fait),
      '[E] « Appris », avec la question et ce que l agent a retenu', e1.fait.slice(0, 90));
    ok(e1.avant === AVANT.body.replace(/\s+/g, ' ') && e1.apres === APRES.body.replace(/\s+/g, ' '),
      '[E] la reponse proposee au client AVANT et APRES, telles que le serveur les a rendues', JSON.stringify({ avant: e1.avant.slice(0, 40), apres: e1.apres.slice(0, 40) }));
    ok(/L’agent relit 2 questions proches avec ce fait/.test(e1.relit) && e1.suivante && e1.suivante.actif === false,
      '[E] l agent relit les questions proches, et on attend la fin de la relecture pour passer a la suite', JSON.stringify({ relit: e1.relit, suivante: e1.suivante }));
    const relus = await page.evaluate(() => window.__QA_APPELS__.relire);
    ok(relus.length === 1 && Number(relus[0].factId) === 100 && JSON.stringify(relus[0].ids) === '[43,44]',
      '[E] la relecture porte sur le fait appris et les questions proches que le serveur a designees', JSON.stringify(relus));
    await page.waitForFunction(() => document.querySelectorAll('#staffEmailsPage .pv2-savoir-proches li').length === 2, null, { timeout: 5000 });
    await page.waitForTimeout(200);
    const e2 = await lire(page);
    ok(e2.proches.length === 2 && e2.proches[0].resolue && /^Résolue/.test(e2.proches[0].texte) && e2.proches[0].texte.indexOf(Q2.question) > 0
      && !e2.proches[1].resolue && /^Encore ouverte/.test(e2.proches[1].texte) && /anniversaire du soir/.test(e2.proches[1].texte),
      '[E] chaque question relue dit ce que le serveur a dit : resolue, ou encore ouverte avec la question qui reste', JSON.stringify(e2.proches));
    ok(/Questions proches relues avec ce fait : 1 résolue sur 2/.test(e2.texte), '[E] et le compte de la relecture');
    ok(e2.chiffres.join('|') === '1|1|2|+1' && /1 question en attente/.test(e2.compte),
      '[E] le suivi bouge : 1 fait appris, 1 question en attente, 2 resolues', JSON.stringify({ chiffres: e2.chiffres, compte: e2.compte }));
    ok(e2.suivante && e2.suivante.actif && e2.suivante.texte === 'Question suivante', '[E] la relecture finie, « Question suivante »', JSON.stringify(e2.suivante));
    await page.click('#staffEmailsPage .pv2-savoir-fin .pv2-btn');
    await page.waitForTimeout(250);
    const e3 = await lire(page);
    ok(!e3.resultat && e3.question === Q3.question && e3.rang === 'Question 1 sur 1',
      '[E] la suite est la question qui reste, pas celle que la relecture vient de resoudre', JSON.stringify({ q: e3.question, rang: e3.rang }));
    ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('pv2-savoir-reponse')),
      '[E] et le curseur est deja dans sa case');

    // =====================================================================
    console.log('\n[F] l ecran ne ment pas quand l agent n a pas pu');
    // =====================================================================
    await poserEtat(page, { questions: [Q1] }, { avant: AVANT, apres: null });
    await page.click('#staffEmailsPage .pv2-savoir-carte .pv2-savoir-reponse');
    await page.keyboard.type('Oui, le gateau seulement.');
    await page.click('#staffEmailsPage .pv2-savoir-carte .pv2-savoir-apprendre');
    await page.waitForFunction(() => document.querySelector('#staffEmailsPage .pv2-savoir-resultat'), null, { timeout: 5000 });
    const f1 = await lire(page);
    ok(f1.apresEnAttente && /n’a pas pu refaire sa réponse/.test(f1.apres) && f1.apres.indexOf(AVANT.body.slice(0, 20)) < 0,
      '[F] sans reponse refaite, l ecran le dit et ne presente pas l ancienne comme la nouvelle', f1.apres.slice(0, 80));
    ok(f1.relit === '' && f1.proches.length === 0 && (await page.evaluate(() => window.__QA_APPELS__.relire.length)) === 0,
      '[F] sans question proche, aucune relecture inventee');
    ok(f1.suivante && f1.suivante.texte === 'Terminer', '[F] la derniere question apprise, le bouton dit « Terminer »', JSON.stringify(f1.suivante));

    // =====================================================================
    console.log('\n[G] le suivi est celui du serveur');
    // =====================================================================
    const vieux = new Date(Date.now() - 30 * 86400000).toISOString();
    const recent = new Date().toISOString();
    const faits = [
      { id: 7, question: 'Le parking est-il gratuit ?', reponse: 'Oui, gratuit derriere le batiment.', par: 'Sophie Martin', le: recent, resolues: 3, versions: 0 },
      { id: 6, question: 'Les chiens sont-ils admis ?', reponse: 'Non, sauf chiens d assistance.', par: 'Kevin Dubois', le: vieux, resolues: 1, versions: 2 },
      { id: 5, question: 'Les chiens sont-ils admis ?', reponse: 'Ancien doublon garde pour le test d identifiant.', par: 'Kevin Dubois', le: vieux, resolues: 0, versions: 0 },
    ];
    await poserEtat(page, { questions: [Q1, Q2, Q3], appris: faits, ouvertesEnPlus: 54 });
    const g1 = await lire(page);
    ok(/57 questions en attente/.test(g1.compte) && g1.rang === 'Question 1 sur 57',
      '[G] le vrai nombre de questions en attente, pas la longueur de la liste chargee', JSON.stringify({ compte: g1.compte, rang: g1.rang }));
    ok(g1.chiffres.join('|') === '3|57|4|+1', '[G] faits, en attente, resolues, cette semaine : ceux du serveur', JSON.stringify(g1.chiffres));
    ok(g1.jauge === '4 questions résolues sur 61 posées par des clients', '[G] la jauge dit ce qu elle mesure', g1.jauge);

    // =====================================================================
    console.log('\n[H] la memoire se cherche, se corrige et s oublie');
    // =====================================================================
    await page.click('#staffEmailsPage .pv2-savoir-bloc > summary >> text=Sa mémoire (3 faits)');
    await page.waitForTimeout(150);
    const h0 = await lire(page);
    ok(h0.faits.length === 3 && h0.faits.every((f) => f.visible) && /appris par Kevin Dubois/.test(h0.faits[1].texte) && /corrigé 2 fois/.test(h0.faits[1].texte) && /3 questions résolues/.test(h0.faits[0].texte),
      '[H] chaque fait dit qui l a appris, ce qu il a resolu, combien de fois il a ete corrige', JSON.stringify(h0.faits.map((f) => f.texte.slice(0, 60))));
    await page.click('#staffEmailsPage .pv2-savoir-recherche');
    await page.keyboard.type('chien');
    const h1 = await lire(page);
    ok(h1.faits.filter((f) => f.visible).length === 2 && !h1.faits[0].visible && h1.aucun === '',
      '[H] la recherche filtre sur place', JSON.stringify(h1.faits.map((f) => f.visible)));
    ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('pv2-savoir-recherche') && document.activeElement.value === 'chien'),
      '[H] sans perdre la saisie ni le curseur');
    await page.keyboard.type('zzz');
    const h2 = await lire(page);
    ok(h2.faits.every((f) => !f.visible) && /Aucun fait ne contient « chienzzz »/.test(h2.aucun), '[H] et dit quand rien ne correspond', h2.aucun);
    await page.fill('#staffEmailsPage .pv2-savoir-recherche', '');
    await page.evaluate(() => pv2SavoirFiltre(''));
    await page.click('#staffEmailsPage .pv2-savoir-fait:nth-child(2) .pv2-btn >> text=Corriger');
    await page.waitForTimeout(200);
    const edition = await page.evaluate(() => {
      const z = document.querySelector('#staffEmailsPage .pv2-savoir-fait .pv2-savoir-reponse');
      const b = document.querySelector('#staffEmailsPage .pv2-savoir-fait .pv2-savoir-apprendre');
      return { valeur: z ? z.value : null, focus: document.activeElement === z, bouton: b ? b.textContent.trim() : '' };
    });
    ok(edition.valeur === 'Non, sauf chiens d assistance.' && edition.focus && edition.bouton === 'Enregistrer',
      '[H] corriger ouvre le fait tel qu il est, le curseur dedans, bouton « Enregistrer »', JSON.stringify(edition));
    await page.fill('#staffEmailsPage .pv2-savoir-fait .pv2-savoir-reponse', 'Non, sauf chiens d assistance, tenus en laisse.');
    await page.click('#staffEmailsPage .pv2-savoir-fait .pv2-savoir-apprendre');
    await page.waitForFunction(() => window.__QA_APPELS__.corriger.length === 1, null, { timeout: 5000 });
    await page.waitForTimeout(250);
    const corrige = await page.evaluate(() => window.__QA_APPELS__.corriger);
    const h3 = await lire(page);
    ok(Number(corrige[0].id) === 6 && corrige[0].reponse === 'Non, sauf chiens d assistance, tenus en laisse.',
      '[H] la correction part pour CE fait (son identifiant), avec le nouveau texte', JSON.stringify(corrige));
    ok(/tenus en laisse/.test(h3.faits[1].texte) && /corrigé 3 fois/.test(h3.faits[1].texte), '[H] la memoire montre le fait corrige', h3.faits[1].texte.slice(0, 90));
    await page.evaluate(() => { window.confirm = () => true; });
    await page.click('#staffEmailsPage .pv2-savoir-fait:nth-child(3) .pv2-btn >> text=Oublier');
    await page.waitForFunction(() => window.__QA_APPELS__.oublier.length === 1, null, { timeout: 5000 });
    await page.waitForTimeout(250);
    const oublis = await page.evaluate(() => window.__QA_APPELS__.oublier);
    const h4 = await lire(page);
    ok(Number(oublis[0].id) === 5 && h4.faits.length === 2 && h4.faits.some((f) => /tenus en laisse/.test(f.texte)),
      '[H] oublier retire CE fait-la, pas son homonyme', JSON.stringify({ oublis, restants: h4.faits.map((f) => f.texte.slice(0, 30)) }));

    // =====================================================================
    console.log('\n[I] on lui apprend d office, sans attendre un client');
    // =====================================================================
    await poserEtat(page, { questions: [Q2] }, { proches: [{ communicationId: 43, question: Q2.question }], resultats: [{ communicationId: 43, relu: true, resolue: true, question: Q2.question, encore: '', mailDe: Q2.mailDe }] });
    await page.click('#staffEmailsPage .pv2-savoir-nouveau > summary');
    await page.waitForTimeout(150);
    const boutonNouveau = () => page.evaluate(() => !document.querySelector('#staffEmailsPage .pv2-savoir-nouveau .pv2-savoir-apprendre').disabled);
    await page.click('#staffEmailsPage .pv2-savoir-nouveau .pv2-savoir-reponse');
    await page.keyboard.type('Une carte par personne : 15 euros les 30 minutes.');
    ok(await boutonNouveau() === false, '[I] une reponse sans sujet ne s apprend pas');
    await page.click('#staffEmailsPage .pv2-savoir-sujet input');
    await page.keyboard.type('Tarifs des arcades');
    ok(await boutonNouveau() === true, '[I] sujet et reponse ecrits, le bouton s active sans autre rendu');
    await page.click('#staffEmailsPage .pv2-savoir-nouveau .pv2-savoir-apprendre');
    await page.waitForFunction(() => document.querySelectorAll('#staffEmailsPage .pv2-savoir-proches li').length === 1, null, { timeout: 5000 });
    const enseigne = await page.evaluate(() => window.__QA_APPELS__.enseigner);
    const i1 = await lire(page);
    ok(enseigne.length === 1 && enseigne[0].question === 'Tarifs des arcades' && /15 euros/.test(enseigne[0].reponse),
      '[I] le sujet et la reponse partent ensemble', JSON.stringify(enseigne));
    ok(i1.fait.indexOf('Tarifs des arcades') === 0 && i1.avant === '' && i1.apres === '' && i1.proches.length === 1 && i1.proches[0].resolue,
      '[I] « Appris », sans avant/apres invente, et la question ouverte qu il resout du meme coup', JSON.stringify({ fait: i1.fait.slice(0, 40), proches: i1.proches }));

    // =====================================================================
    console.log('\n[J] l apercu resume et renvoie a L agent');
    // =====================================================================
    await poserEtat(page, { questions: [Q1, Q2], appris: faits.slice(0, 1) });
    await aller(page, 'apercu');
    const j1 = await lire(page);
    ok(j1.presente && j1.apercu && /Le centre autorise-t-il/.test(j1.texte) && j1.chiffres.length === 4 && !j1.champ,
      '[J] l apercu montre le suivi et la question du moment, sans case a remplir', j1.texte.slice(0, 90));
    await page.click('#staffEmailsPage .pv2-savoir.is-apercu .pv2-btn');
    await page.waitForTimeout(250);
    ok(await page.evaluate(() => state.staffEmailsSection === 'agent' && Boolean(document.querySelector('#staffEmailsPage .pv2-savoir-carte .pv2-savoir-reponse'))),
      '[J] « Lui repondre » ouvre L agent sur la question');

    // =====================================================================
    console.log('\n[L] lisible et sans debordement');
    // =====================================================================
    await poserEtat(page, { questions: [Q1, Q2], appris: faits }, { avant: AVANT, apres: APRES, proches: [{ communicationId: 43, question: Q2.question }], resultats: [{ communicationId: 43, relu: true, resolue: false, question: Q2.question, encore: 'Et pour 12 enfants ?', mailDe: Q2.mailDe }] });
    await page.evaluate(() => { pv2Mail.memoireOuverte = true; pv2Mail.listeOuverte = true; renderStaffEmailsPage(); });
    for (const theme of ['dark', 'light']) {
      await page.evaluate((t) => { setStaffTheme(t); }, theme);
      await page.waitForTimeout(300);
      const c = await contrastes(page);
      ok(c.mesures > 20 && c.ratio >= 4.5, `[L] ${theme} : chaque texte de la section a 4,5:1 sur son fond`, JSON.stringify(c));
    }
    await page.click('#staffEmailsPage .pv2-savoir-carte .pv2-savoir-reponse');
    await page.keyboard.type('Oui, le gateau seulement.');
    await page.click('#staffEmailsPage .pv2-savoir-carte .pv2-savoir-apprendre');
    await page.waitForFunction(() => document.querySelectorAll('#staffEmailsPage .pv2-savoir-proches li').length === 1, null, { timeout: 5000 });
    await page.waitForTimeout(400);
    for (const theme of ['dark', 'light']) {
      await page.evaluate((t) => { setStaffTheme(t); }, theme);
      await page.waitForTimeout(300);
      const c = await contrastes(page);
      ok(c.ratio >= 4.5, `[L] ${theme} : le resultat aussi (avant, apres, resolue, encore ouverte)`, JSON.stringify(c));
    }
    // Capture optionnelle : PINLANE_LEARN_SHOT=<dossier>.
    if (process.env.PINLANE_LEARN_SHOT) {
      const dossier = process.env.PINLANE_LEARN_SHOT;
      fs.mkdirSync(dossier, { recursive: true });
      for (const theme of ['dark', 'light']) {
        await page.evaluate((t) => { setStaffTheme(t); }, theme);
        await page.waitForTimeout(400);
        const bloc = await page.$('#staffEmailsPage .pv2-savoir');
        if (bloc) await bloc.screenshot({ path: path.join(dossier, `apprentissage-resultat-${theme}.png`) });
      }
      await page.evaluate(() => { pv2SavoirSuivante(); });
      await page.waitForTimeout(400);
      const bloc = await page.$('#staffEmailsPage .pv2-savoir');
      if (bloc) await bloc.screenshot({ path: path.join(dossier, 'apprentissage-question-light.png') });
    }
    toutesErreurs.push(...errs);
    await context.close();

    for (const largeur of [390, 768]) {
      const tel = await ouvrirConsole(browser, TOUTES, { width: largeur, height: 860 });
      await aller(tel.page, 'agent');
      await poserEtat(tel.page, { questions: [Q1, Q2], appris: faits }, {});
      await tel.page.evaluate(() => { pv2Mail.memoireOuverte = true; pv2Mail.nouveauOuvert = true; renderStaffEmailsPage(); });
      await tel.page.waitForTimeout(300);
      const deb = await tel.page.evaluate(() => {
        const s = document.querySelector('#staffEmailsPage .pv2-savoir');
        const r = s.getBoundingClientRect();
        const dehors = [...s.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && (b.right > r.right + 0.5 || b.left < r.left - 0.5); }).map((e) => e.className || e.tagName).slice(0, 4);
        return { section: s.scrollWidth <= s.clientWidth, page: document.documentElement.scrollWidth <= window.innerWidth, dehors, colonnes: getComputedStyle(s.querySelector('.pv2-savoir-chiffres')).gridTemplateColumns.split(' ').length };
      });
      ok(deb.section && deb.dehors.length === 0, `[L] ${largeur} px : rien ne deborde de la section`, JSON.stringify(deb));
      if (largeur === 390) ok(deb.colonnes === 2, '[L] 390 px : les chiffres du suivi passent sur deux colonnes', String(deb.colonnes));
      toutesErreurs.push(...tel.errs);
      await tel.context.close();
    }

    // =====================================================================
    console.log('\n[K] sans le droit d apprendre, ni case ni bouton');
    // =====================================================================
    const lecteur = await ouvrirConsole(browser, TOUTES.filter((p) => p !== 'emails.send' && p !== 'direction.view'));
    await aller(lecteur.page, 'agent');
    await poserEtat(lecteur.page, { questions: [Q1], appris: faits.slice(0, 1) });
    await lecteur.page.evaluate(() => { pv2Mail.memoireOuverte = true; renderStaffEmailsPage(); });
    await lecteur.page.waitForTimeout(200);
    const k1 = await lire(lecteur.page);
    ok(k1.question === Q1.question && !k1.champ && !k1.nouveau && k1.boutonsMemoire === 0 && k1.faits.length === 1,
      '[K] la question et la memoire se lisent ; aucune case, ni « Lui apprendre », ni Corriger/Oublier', JSON.stringify({ champ: k1.champ, nouveau: k1.nouveau, boutons: k1.boutonsMemoire }));
    ok(/réservé à qui envoie les e-mails ou à la direction/.test(k1.texte), '[K] et l ecran dit pourquoi');
    toutesErreurs.push(...lecteur.errs);
    await lecteur.context.close();

    ok(toutesErreurs.length === 0, 'aucune erreur JavaScript dans la page', toutesErreurs.slice(0, 3).join(' | '));
    console.log(failures ? `\n${failures} controle(s) en echec.` : '\nagent-learning-check: ALL OK');
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});
