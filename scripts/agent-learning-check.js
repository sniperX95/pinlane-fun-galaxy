// QUAND L AGENT NE SAIT PAS, IL DEMANDE, ET IL RETIENT LA REPONSE.
//
// Pourquoi ce gate existe, mot pour mot : « l IA ne sait pas, donc il doit y
// avoir une section apprentissage IA : quand l IA ne sait pas elle pose la
// question, ils repondent, et l agent le sait pour toutes les prochaines fois ».
//
// Le declencheur est un aveu, pas une panne. Quand un message ne rentre dans
// aucun sujet connu, la reponse proposee devient une pirouette (« appelez-nous
// au... »). Mesure du 2026-09-06 sur un vrai mail : « est-ce que je peux amener
// mon propre gateau ? » a produit exactement ca, parce que personne n avait
// jamais dit a l agent si le centre l autorise.
//
// La regle de detection et la memoire sont mesurees cote serveur ailleurs. Ce
// gate-ci pilote l ECRAN : c est lui qui transforme un aveu en question posee a
// quelqu un, et une reponse tapee en fait retenu.
//
// LES CINQ PROPRIETES :
//
//   [A] SANS QUESTION NI MEMOIRE, LA SECTION N EXISTE PAS. Un encart permanent
//       qui dit « rien a signaler » se fait ignorer, et le jour ou il a quelque
//       chose a dire, personne ne le lit.
//
//   [B] UNE QUESTION S AFFICHE AVEC SON ORIGINE. La question seule ne suffit
//       pas : sans le mail d ou elle vient, on ne sait pas quoi repondre.
//
//   [C] ON NE PEUT PAS APPRENDRE DU VIDE. Le bouton reste inactif tant que rien
//       n est ecrit : un fait vide appris serait pire qu aucun fait.
//
//   [D] REPONDRE ENVOIE LE FAIT AU SERVEUR. C est le geste central : sans lui,
//       toute la section est un formulaire decoratif.
//
//   [E] LA MEMOIRE SE CONSULTE ET SE CORRIGE. Un fait faux appris une fois
//       empoisonnerait toutes les reponses suivantes sans que rien ne le
//       signale : pouvoir le relire et le retirer est ce qui rend
//       l apprentissage sur, pas un supplement de confort.
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

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, moi }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'emails.view', 'emails.send', 'campaigns.manage', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: moi, name: 'Moi QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };

    const comms = [{
      id: 42, centerId: 'libramont', channel: 'email', direction: 'inbound', status: 'received',
      templateId: null, recipient: 'marie@exemple.be', subject: 'Une question',
      createdAt: new Date().toISOString(),
      payload: {
        from: 'marie@exemple.be', textBody: 'Je peux amener mon propre gateau ?',
        analysis: { intent: 'autre', intentLabel: 'Autre', summary: 'gateau', urgency: 'normale', provider: 'rules', question: 'Le centre autorise-t-il d apporter sa propre nourriture ?', reply: { subject: 'Re', body: 'Bonjour,' } },
      },
    }];
    // 2026-09-16 : le mail recu se lit dans SA CONVERSATION (spec emails v4,
    // contrats emailThreads / emailThread §3.7). Le fil est DERIVE du mail :
    // meme donnee, presentee comme le serveur la presente desormais.
    comms[0].threadId = 901;
    const filDe = (c) => ({
      id: 901, centerId: 'libramont', contactEmail: c.payload.from, contactName: c.payload.fromName || (c.payload.analysis && c.payload.analysis.clientName) || '',
      subject: c.subject, status: 'open', origin: 'inbound', rootCommunicationId: c.id,
      messageCount: 1, inboundCount: 1, outboundCount: 0, firstMessageAt: c.createdAt, lastMessageAt: c.createdAt, lastInboundAt: c.createdAt, lastOutboundAt: null,
      lastDirection: 'inbound', snippet: String(c.payload.textBody || '').slice(0, 120), lastInboundId: c.id, luParMoi: false, lecteurs: [], prise: null,
      intention: c.payload.analysis ? c.payload.analysis.intent : '', question: true, reponduPar: null,
    });
    const messageDe = (c) => ({
      id: c.id, direction: 'inbound', subject: c.subject, body: '', textBody: String(c.payload.textBody || ''), message: String(c.payload.textBody || ''), historique: '',
      createdAt: c.createdAt, sentAt: null, receivedAt: c.payload.receivedAt || c.createdAt, status: 'received', templateId: '', origine: 'inbound', sequenceLabel: '',
      sentBy: null, fromEmail: c.payload.from, fromLabel: c.payload.fromName || '', recipient: c.recipient, providerMessageId: '', messageId: '', inReplyTo: '',
      suivi: { deliveredAt: null, openedAt: null, openCount: 0, clickedAt: null, clickCount: 0, bouncedAt: null, complainedAt: null, lastError: '' },
      evenements: [], lectures: [], prise: null, analysis: c.payload.analysis || null, reservationId: null, errorReason: '', threadId: 901,
    });

    // L etat SERVEUR de la section, pilotable depuis le test.
    window.__QA_SAVOIR__ = { questions: [], appris: [] };
    window.__QA_APPELS__ = { apprendre: [], oublier: [] };

    const nf = window.fetch.bind(window);
    const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      let u;
      try { u = new URL(url, location.origin); } catch (e) { return nf(input, init); }
      if (!u.pathname.startsWith('/api/')) return nf(input, init);
      const method = String((init && init.method) || 'GET').toUpperCase();
      if (method === 'POST' && u.pathname === '/api/ops') {
        const b = JSON.parse((init && init.body) || '{}');
        if (b.action === 'answerAgentQuestion') {
          window.__QA_APPELS__.apprendre.push({ id: b.communicationId, reponse: b.reponse });
          window.__QA_SAVOIR__ = {
            questions: window.__QA_SAVOIR__.questions.filter((q) => Number(q.communicationId) !== Number(b.communicationId)),
            appris: [{ question: 'Le centre autorise-t-il d apporter sa propre nourriture ?', reponse: b.reponse, par: 'Moi QA', le: new Date().toISOString() }].concat(window.__QA_SAVOIR__.appris),
          };
          return J({ ok: true, reanalyse: true, appris: window.__QA_SAVOIR__.appris });
        }
        if (b.action === 'forgetAgentFact') {
          window.__QA_APPELS__.oublier.push(b.question);
          window.__QA_SAVOIR__ = {
            questions: window.__QA_SAVOIR__.questions,
            appris: window.__QA_SAVOIR__.appris.filter((f) => f.question !== b.question),
          };
          return J({ ok: true, appris: window.__QA_SAVOIR__.appris });
        }
        return J({ ok: true });
      }
      if (u.pathname === '/api/staff-auth') {
        return J({
          ok: true, authenticated: true, session: qaSession,
          accessControl: {
            selectedRoleId: 'direction', selectedMemberId: moi,
            roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }],
            members: [{ id: moi, name: 'Moi QA', contact: 'moi@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }],
            events: [], permissions: perms,
          },
        });
      }
      const action = u.searchParams.get('action');
      if (u.pathname === '/api/ops' && action === 'agentQuestions') return J({ ok: true, ...window.__QA_SAVOIR__ });
      if (u.pathname === '/api/ops' && action === 'pulse') return J({ ok: true, empreinte: 'stable' });
      if (u.pathname === '/api/ops' && action === 'emailClaims') return J({ ok: true, claims: [] });
      if (u.pathname === '/api/ops' && action === 'communications') return J({ ok: true, communications: comms });
      if (u.pathname === '/api/ops' && action === 'emailThreads') {
        const filtre = u.searchParams.get('filtre') || 'a-repondre';
        const threads = filtre === 'repondus' || filtre === 'termines' ? [] : [filDe(comms[0])];
        return J({ ok: true, threads, total: threads.length });
      }
      if (u.pathname === '/api/ops' && action === 'emailThread') {
        if (u.searchParams.get('id') !== '901') return new Response(JSON.stringify({ ok: false, message: 'Conversation introuvable.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        return J({ ok: true, thread: filDe(comms[0]), messages: [messageDe(comms[0])], contact: { email: comms[0].payload.from, name: filDe(comms[0]).contactName, autresFils: [], nbFils: 1 } });
      }
      if (u.pathname === '/api/ops' && action === 'emailStudio') return J({ ok: true, templates: [], identities: [{ id: 1, label: 'Accueil', email: 'contact@fungalaxy.be', isDefault: true }], channel: { resendConfigured: true, aiConfigured: false } });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: comms, samples: [], suggestions: [], events: [], claims: [], settings: {}, defaults: {}, sequences: [], overrides: {}, stats: {} });
      if (u.pathname === '/api/simulation') return J({ ok: true, status: 'idle', simulation: null });
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, moi: MOI });
}

async function etatSection(page) {
  return page.evaluate(() => {
    const s = document.querySelector('#staffEmailsPage .pv2-savoir');
    if (!s) return { presente: false };
    const bouton = s.querySelector('.pv2-savoir-carte .pv2-btn');
    return {
      presente: true,
      texte: s.innerText.replace(/\s+/g, ' ').trim(),
      cartes: s.querySelectorAll('.pv2-savoir-carte').length,
      boutonActif: bouton ? !bouton.disabled : null,
      memoireVisible: Boolean(s.querySelector('.pv2-savoir-memoire')),
      faits: s.querySelectorAll('.pv2-savoir-fait').length,
    };
  });
}

async function poserEtat(page, savoir) {
  await page.evaluate((s) => {
    window.__QA_SAVOIR__ = s;
    if (typeof opsAdminCache === 'object' && opsAdminCache) {
      opsAdminCache.questions = s.questions;
      opsAdminCache.appris = s.appris;
    }
    if (typeof renderStaffEmailsPage === 'function') renderStaffEmailsPage();
  }, savoir);
  await page.waitForTimeout(250);
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=learn-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => { state.staffMenuPage = 'emails'; state.staffTheme = 'dark'; save(); setView('staff'); renderStaff(); });
    await page.waitForTimeout(1200);

    // =====================================================================
    console.log('[A] sans question ni memoire, la section n existe pas');
    // =====================================================================
    await poserEtat(page, { questions: [], appris: [] });
    ok((await etatSection(page)).presente === false,
      '[A] aucune section quand l agent n a rien a demander ni rien retenu');

    // =====================================================================
    console.log('\n[B] une question s affiche avec son origine');
    // =====================================================================
    const question = {
      communicationId: 42,
      question: 'Le centre autorise-t-il d apporter sa propre nourriture ?',
      mailSujet: 'Une question', mailDe: 'marie@exemple.be',
      extrait: 'Je peux amener mon propre gateau ?',
    };
    await poserEtat(page, { questions: [question], appris: [] });
    // Capture optionnelle : PINLANE_LEARN_SHOT=<dossier>. Le harnais est deja
    // monte ; le dupliquer ailleurs le ferait diverger en silence.
    if (process.env.PINLANE_LEARN_SHOT) {
      const dossier = process.env.PINLANE_LEARN_SHOT;
      fs.mkdirSync(dossier, { recursive: true });
      for (const theme of ["dark", "light"]) {
        await page.evaluate((t) => { setStaffTheme(t); }, theme);
        await page.waitForTimeout(400);
        const bloc = await page.$("#staffEmailsPage .pv2-savoir");
        if (bloc) await bloc.screenshot({ path: path.join(dossier, `apprentissage-${theme}.png`) });
      }
      await page.evaluate(() => { setStaffTheme("dark"); });
      await page.waitForTimeout(300);
    }

    const avecQuestion = await etatSection(page);
    ok(avecQuestion.presente, '[B] la section apparait des qu il y a une question');
    ok(/apporter sa propre nourriture/.test(avecQuestion.texte),
      '[B] la question posee par l agent est lisible', avecQuestion.texte.slice(0, 70));
    ok(/marie@exemple\.be/.test(avecQuestion.texte),
      '[B] avec le mail d ou elle vient : sans lui, on ne sait pas quoi repondre');
    ok(avecQuestion.cartes === 1, '[B] une carte par question', String(avecQuestion.cartes));

    // =====================================================================
    console.log('\n[C] on ne peut pas apprendre du vide');
    // =====================================================================
    ok(avecQuestion.boutonActif === false,
      '[C] le bouton Apprendre est inactif tant que rien n est ecrit', String(avecQuestion.boutonActif));

    // =====================================================================
    console.log('\n[D] repondre envoie le fait au serveur');
    // =====================================================================
    await page.click('#staffEmailsPage .pv2-savoir-reponse');
    await page.keyboard.type('Oui, uniquement le gateau d anniversaire.');
    await page.waitForTimeout(200);
    await page.evaluate(() => renderStaffEmailsPage());
    await page.waitForTimeout(200);
    ok((await etatSection(page)).boutonActif === true,
      '[D] le bouton s active une fois la reponse ecrite');
    await page.click('#staffEmailsPage .pv2-savoir-carte .pv2-btn');
    await page.waitForTimeout(900);
    const envoyes = await page.evaluate(() => window.__QA_APPELS__.apprendre);
    ok(envoyes.length === 1 && Number(envoyes[0].id) === 42,
      '[D] le fait part vers le serveur, rattache au bon message', JSON.stringify(envoyes));
    ok(/gateau d anniversaire/.test(String(envoyes[0] && envoyes[0].reponse)),
      '[D] avec exactement ce qui a ete tape', String(envoyes[0] && envoyes[0].reponse));
    const apresApprentissage = await etatSection(page);
    ok(apresApprentissage.cartes === 0,
      '[D] et la question quitte la liste : on ne repond pas deux fois a la meme', String(apresApprentissage.cartes));

    // =====================================================================
    console.log('\n[E] la memoire se consulte et se corrige');
    // =====================================================================
    ok(/appris/i.test(apresApprentissage.texte),
      '[E] la memoire constituee est annoncee', apresApprentissage.texte.slice(0, 80));
    ok(apresApprentissage.memoireVisible === false,
      '[E] repliee par defaut : elle grandit, elle ne doit pas noyer les questions');
    await page.click('#staffEmailsPage .pv2-savoir-bascule');
    await page.waitForTimeout(300);
    const depliee = await etatSection(page);
    ok(depliee.faits === 1, '[E] elle se deplie et montre le fait retenu', String(depliee.faits));
    ok(/gateau d anniversaire/.test(depliee.texte), '[E] avec ce que l agent a retenu, mot pour mot');
    await page.evaluate(() => { window.confirm = () => true; });
    await page.click('#staffEmailsPage .pv2-savoir-fait .pv2-btn');
    await page.waitForTimeout(900);
    const oublies = await page.evaluate(() => window.__QA_APPELS__.oublier);
    ok(oublies.length === 1 && /apporter sa propre nourriture/.test(String(oublies[0])),
      '[E] un fait devenu faux peut etre retire : l apprentissage reste reversible', JSON.stringify(oublies));

    if (errs.length) console.log('\nErreurs console :\n' + errs.slice(0, 5).join('\n'));
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
