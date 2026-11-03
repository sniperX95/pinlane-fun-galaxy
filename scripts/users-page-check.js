// Gate UI de la page STAFF "Utilisateurs" (menu 'users'), par le RENDU REEL.
//
// POURQUOI CE GATE. Deux regressions signalees par le proprietaire :
//   (a) le role/membre "Proprietaire plateforme" (platform.admin, backdoor
//       Pinlane) apparaissait dans le rail, les compteurs (30/29) et la liste
//       des membres : un acces PLATEFORME n'est pas un role d'equipe du centre
//       et ne doit JAMAIS y etre visible ni manipulable ;
//   (b) editer une permission "teleportait" la selection sur Manager :
//       runStaffAuthAction ecrasait state.staffAccessControl avec la reponse
//       serveur (qui ne porte pas selectedRoleId), et ensureStaffAccessControl
//       retombait sur un defaut en dur.
// On prouve les deux par de VRAIS clics et une lecture du DOM (Playwright +
// Edge), puis des CONTRE-PREUVES par mutation : selection forcee sur le role
// plateforme -> re-resolue ailleurs ; garde anti-blocage neutralisee en
// memoire -> l'appel PART (le zero observe vient bien de la garde).
//
// Zero reseau externe : serveur statique local + /api/* mocke dans la page.
// Lancement : node scripts/users-page-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_USERS_CHECK_PORT || 4249);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// Les 29 permissions centre (miroir de STAFF_PERMISSION_GROUPS, app-main.js).
const ALL_PERMS = [
  'dashboard.view', 'direction.view', 'centers.switch', 'reports.export',
  'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'planning.past',
  'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.cancel', 'reservations.status', 'reservations.quick',
  'clients.view', 'clients.edit', 'payments.view', 'payments.markPaid', 'exports.download',
  'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents',
  'pricing.manage', 'users.manage', 'settings.manage', 'security.codes', 'ai.ops',
];

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, allPerms }) => {
    const now = new Date().toISOString();
    const hier = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
    // Session DIRECTION du centre (pas proprietaire plateforme) : la page doit
    // etre logique pour un client normal.
    const qaSession = {
      token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt,
      member: { id: 'libramont:dir', name: 'Directrice Demo' },
      role: { id: 'direction', name: 'Direction', locked: true },
      permissions: allPerms,
    };
    // accessControl serveur : contient le role plateforme (30 permissions dont
    // platform.admin) et le membre qui le porte : la PAGE doit les exclure.
    const AC = {
      roles: [
        { id: 'direction', name: 'Direction', code: 'DI', summary: 'Controle total multi-centres', tone: 'admin', permissions: [...allPerms], locked: true, accessCode: 'DI-21-QAAA', updatedAt: now },
        { id: 'manager', name: 'Manager', code: 'MA', summary: 'Operations, clients et caisse', tone: 'manager', permissions: allPerms.slice(0, 16), locked: false, accessCode: 'MA-21-QABB', updatedAt: now },
        { id: 'staff-bar', name: 'Staff bar', code: 'ST', summary: 'Accueil et rush terrain', tone: 'staff', permissions: allPerms.slice(0, 12), locked: false, accessCode: 'ST-21-QACC', updatedAt: now },
        { id: 'marketing', name: 'Marketing', code: 'MK', summary: 'Campagnes et communication', tone: 'marketing', permissions: ['dashboard.view', 'clients.view', 'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents', 'reports.export'], locked: false, accessCode: 'MK-21-QADD', updatedAt: now },
        { id: 'maintenance', name: 'Technique', code: 'TE', summary: 'Pistes, laser et incidents', tone: 'tech', permissions: ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view'], locked: false, accessCode: 'TE-21-QAEE', updatedAt: now },
        { id: 'platform-owner', name: 'Proprietaire plateforme', code: 'PF', summary: 'Acces plateforme Pinlane', tone: 'admin', permissions: [...allPerms, 'platform.admin'], locked: true, accessCode: 'PF-21-QAFF', updatedAt: now },
      ],
      members: [
        { id: 'libramont:dir', name: 'Directrice Demo', contact: 'direction@fungalaxy.be', roleId: 'direction', status: 'active', code: 'DI-4821', lastSeen: now },
        { id: 'libramont:sam', name: 'Bar Sam', contact: 'sam@fungalaxy.be', roleId: 'staff-bar', status: 'active', code: 'ST-1174', lastSeen: hier },
        { id: 'libramont:theo', name: 'Techno Theo', contact: 'theo@fungalaxy.be', roleId: 'maintenance', status: 'pending', code: 'TE-9042', lastSeen: null },
        { id: 'libramont:platform-owner', name: 'Movsar Plateforme', contact: 'Acces plateforme', roleId: 'platform-owner', status: 'active', code: 'PF-0001', lastSeen: now },
      ],
      events: [{ id: 1, label: 'Code du role Technique regenere.', at: hier }],
    };
    // Comme le vrai serveur : la reponse ne porte JAMAIS selectedRoleId.
    const cloneAC = () => JSON.parse(JSON.stringify(AC));
    window.__AC = AC;
    window.__staffAuthPosts = [];
    window.__lastAccessControlResponse = null;
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') {
        const method = String((init && init.method) || (typeof input === 'object' && input && input.method) || 'GET').toUpperCase();
        if (method === 'GET') {
          const acc = cloneAC();
          window.__lastAccessControlResponse = acc;
          return J({ ok: true, authenticated: true, session: qaSession, accessControl: acc });
        }
        let body = {};
        try { body = JSON.parse((init && init.body) || '{}'); } catch (e) {}
        window.__staffAuthPosts.push(body.action || 'unknown');
        if (body.action === 'updateRolePermissions') {
          const role = AC.roles.find((r) => r.id === body.roleId);
          if (role) role.permissions = Array.isArray(body.permissions) ? body.permissions : role.permissions;
        }
        const acc = cloneAC();
        window.__lastAccessControlResponse = acc;
        return J({ ok: true, accessControl: acc });
      }
      if (u.pathname.startsWith('/api/')) return J({ ok: true, reservations: [], laneStatuses: {}, communications: [] });
      return nf(input, init);
    };
    try { localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession)); } catch (e) {}
  }, { expiresAt, allPerms: ALL_PERMS });
}

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=upc-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      state.staffAccessControl = JSON.parse(JSON.stringify(window.__AC));
      state.staffMenuPage = 'users';
      state.staffTheme = 'dark';
      save();
      setView('staff');
      renderStaff();
    });
    await page.waitForFunction(() => document.querySelectorAll('.staff-role-pill').length > 0, null, { timeout: 15000 });
    await page.waitForTimeout(300);

    // ---- (a) Le role/membre plateforme est EXCLU de tout l'affichage -------
    const exclusion = await page.evaluate(() => {
      const pills = [...document.querySelectorAll('.staff-role-pill')];
      const pillNames = pills.map((p) => (p.querySelector('strong') || {}).textContent || '');
      const railCount = (document.querySelector('.staff-role-rail-head em') || {}).textContent || '';
      const kpiPrimary = (document.querySelector('.utility-overview-value-row strong') || {}).textContent || '';
      const memberNames = [...document.querySelectorAll('.staff-member-card .staff-member-top strong')].map((n) => n.textContent);
      const optionValues = [...document.querySelectorAll('.staff-member-card select option')].map((o) => o.value);
      const meta = [...document.querySelectorAll('.staff-role-pill-meta em')].map((e) => e.textContent.trim());
      const pageText = document.querySelector('.staff-access-console') ? document.querySelector('.staff-access-console').textContent : '';
      return { pillNames, railCount, kpiPrimary, memberNames, optionValues, meta, pageText };
    });
    ok(exclusion.pillNames.length === 5, `rail : 5 roles du centre (recu : ${exclusion.pillNames.length} : ${exclusion.pillNames.join(', ')})`);
    ok(!exclusion.pillNames.some((n) => /plateforme/i.test(n)), 'rail : aucun role "Proprietaire plateforme"');
    ok(!/plateforme/i.test(exclusion.pageText), 'page : aucune mention du role/membre plateforme nulle part');
    ok(exclusion.railCount === '5', `compteur du rail = 5 (recu : "${exclusion.railCount}")`);
    ok(exclusion.kpiPrimary === '5', `KPI "Roles" de l'entete Acces = 5 (recu : "${exclusion.kpiPrimary}")`);
    ok(!exclusion.memberNames.some((n) => /Movsar/i.test(n)), 'membres : le porteur du role plateforme est absent de la liste');
    ok(!exclusion.optionValues.includes('platform-owner'), 'selecteurs de role membre : platform-owner jamais propose');
    const metaOk = exclusion.meta.length === 5 && exclusion.meta.every((m) => {
      const match = /^(\d+)\/29$/.exec(m);
      return match && Number(match[1]) <= 29;
    });
    ok(metaOk, `compteurs de permissions coherents, jamais N/29 avec N > 29 (recu : ${exclusion.meta.join(' ')})`);

    // ---- (b) Editer une permission GARDE le role selectionne ---------------
    await page.click('.staff-role-pill:has-text("Technique")');
    await page.waitForFunction(() => {
      const active = document.querySelector('.staff-role-pill.active strong');
      return active && active.textContent === 'Technique';
    }, null, { timeout: 10000 });
    // Vrai clic sur un toggle eteint d'un groupe ouvert (change -> POST -> re-rendu).
    await page.click('.staff-permission-group[open] .staff-permission-toggle:not(.is-on)');
    await page.waitForFunction(() => window.__staffAuthPosts.includes('updateRolePermissions'), null, { timeout: 10000 });
    await page.waitForTimeout(400);
    const afterToggle = await page.evaluate(() => ({
      activeName: (document.querySelector('.staff-role-pill.active strong') || {}).textContent || '',
      selectedRoleId: state.staffAccessControl ? state.staffAccessControl.selectedRoleId : '',
      responseHadSelection: window.__lastAccessControlResponse ? ('selectedRoleId' in window.__lastAccessControlResponse) : true,
      techniqueMeta: (() => {
        const pill = [...document.querySelectorAll('.staff-role-pill')].find((p) => ((p.querySelector('strong') || {}).textContent || '') === 'Technique');
        return pill ? pill.querySelector('.staff-role-pill-meta em').textContent.trim() : '';
      })(),
    }));
    ok(!afterToggle.responseHadSelection, 'contre-verification : la reponse serveur mockee ne porte PAS selectedRoleId (l\'ancien code aurait teleporte)');
    ok(afterToggle.activeName === 'Technique', `apres edition d'une permission, le role selectionne reste "Technique" (recu : "${afterToggle.activeName}")`);
    ok(afterToggle.selectedRoleId === 'maintenance', `state.selectedRoleId reste 'maintenance' (recu : "${afterToggle.selectedRoleId}")`);
    ok(afterToggle.techniqueMeta === '7/29', `la permission editee est bien enregistree : Technique passe a 7/29 (recu : "${afterToggle.techniqueMeta}")`);

    // ---- Sur mesure et prix : un choix par reglage, enregistre au clic ------
    await page.click('.staff-role-pill:has-text("Manager")');
    await page.waitForFunction(() => (document.querySelector('.staff-role-pill.active strong') || {}).textContent === 'Manager', null, { timeout: 10000 });
    const lireGroupe = () => page.evaluate(() => ({
      titre: (document.querySelector('.staff-niveaux-group .staff-permission-group-head strong') || {}).textContent || '',
      reglages: [...document.querySelectorAll('.staff-niveaux-group .staff-niveau')].map((ligne) => ({
        nom: ligne.querySelector('.staff-niveau-nom').textContent,
        options: [...ligne.querySelectorAll('.staff-niveau-option span')].map((s) => s.textContent),
        choisi: (ligne.querySelector('input:checked + span') || {}).textContent || '',
        desactive: [...ligne.querySelectorAll('input')].every((i) => i.disabled),
      })),
      compteur: (document.querySelector('.staff-niveaux-group .staff-permission-group-head em') || {}).textContent || '',
    }));
    const groupe = await lireGroupe();
    ok(groupe.titre === 'Sur mesure et prix' && groupe.reglages.length === 5, `le groupe « Sur mesure et prix » porte cinq reglages (recu : ${groupe.titre}, ${groupe.reglages.length})`);
    ok(JSON.stringify(groupe.reglages[1].options) === JSON.stringify(['Non', '5 %', '10 %', '20 %', 'Sans limite']), `« Ajuster un prix » propose ses cinq niveaux (recu : ${groupe.reglages[1].options.join(', ')})`);
    ok(groupe.reglages.every((r) => r.choisi), 'un role sans niveau ecrit affiche son niveau par defaut, jamais rien de coche');
    // Vrai clic sur le segment : POST, re-rendu, role garde, option remplacee.
    const avantClic = await page.evaluate(() => window.__staffAuthPosts.length);
    await page.click('.staff-niveau-option:has([data-niveau-choix="prix:10"])');
    await page.waitForFunction((n) => window.__staffAuthPosts.length > n, avantClic, { timeout: 10000 });
    await page.waitForTimeout(300);
    const apresClic = await page.evaluate(() => ({
      actif: (document.querySelector('.staff-role-pill.active strong') || {}).textContent || '',
      coche: (document.querySelector('[name="staffNiveau-prix"]:checked') || {}).dataset?.niveauChoix || '',
      focus: document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.niveauChoix : '',
      enBase: window.__AC.roles.find((r) => r.id === 'manager').permissions.filter((p) => p.startsWith('niveau:prix:')),
    }));
    ok(apresClic.actif === 'Manager' && apresClic.coche === 'prix:10' && apresClic.focus === 'prix:10', `le choix s enregistre au clic, le role reste, le focus revient (recu : ${JSON.stringify(apresClic)})`);
    ok(JSON.stringify(apresClic.enBase) === JSON.stringify(['niveau:prix:10']), `une seule option par cle part au serveur (recu : ${apresClic.enBase.join(', ')})`);
    await page.click('.staff-niveau-option:has([data-niveau-choix="prix:5"])');
    await page.waitForFunction(() => window.__AC.roles.find((r) => r.id === 'manager').permissions.includes('niveau:prix:5'), null, { timeout: 10000 });
    const remplace = await page.evaluate(() => window.__AC.roles.find((r) => r.id === 'manager').permissions.filter((p) => p.startsWith('niveau:prix:')));
    ok(JSON.stringify(remplace) === JSON.stringify(['niveau:prix:5']), `changer d avis remplace l option (recu : ${remplace.join(', ')})`);
    const meta = await page.evaluate(() => [...document.querySelectorAll('.staff-role-pill-meta em')].map((e) => e.textContent.trim()));
    ok(meta.every((m) => { const [a, b] = m.split('/').map(Number); return a <= b; }), `les compteurs ne comptent pas les niveaux (recu : ${meta.join(' ')})`);
    // Les cibles et les textes, dans les deux themes.
    const mesurer = () => page.evaluate(() => {
      const options = [...document.querySelectorAll('.staff-niveaux-group .staff-niveau-option span')];
      const textes = [...document.querySelectorAll('.staff-niveaux-group *')].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
      const lum = (c) => {
        const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      // Fond compose : une couleur translucide se pose sur le fond du dessous.
      const melange = (haut, bas) => {
        const h = haut.match(/[\d.]+/g).map(Number);
        const b = bas.match(/[\d.]+/g).map(Number);
        const a = h.length > 3 ? h[3] : 1;
        return `rgb(${[0, 1, 2].map((i) => h[i] * a + b[i] * (1 - a)).join(', ')})`;
      };
      const fond = (n) => {
        const couches = [];
        for (let e = n; e; e = e.parentElement) couches.push(getComputedStyle(e).backgroundColor);
        return couches.reverse().reduce((bas, haut) => (/^rgba\(.*, 0\)$|transparent/.test(haut) ? bas : melange(haut, bas)), 'rgb(255, 255, 255)');
      };
      const contraste = (n) => { const a = lum(getComputedStyle(n).color); const b = lum(fond(n)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
      return {
        hauteurMin: Math.min(...options.map((o) => o.getBoundingClientRect().height)),
        policeMin: Math.min(...textes.map((n) => parseFloat(getComputedStyle(n).fontSize))),
        contrasteMin: Math.min(...options.map(contraste)),
      };
    });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(350);
      const m = await mesurer();
      ok(m.hauteurMin >= 32, `${theme} : cibles de 32 px au moins a la souris (recu : ${m.hauteurMin})`);
      ok(m.policeMin >= 12, `${theme} : rien sous 12 px (recu : ${m.policeMin})`);
      ok(m.contrasteMin >= 4.5, `${theme} : texte lisible sur chaque segment (recu : ${m.contrasteMin.toFixed(2)})`);
      if (process.env.PINLANE_CAPTURES) await page.locator('.staff-niveaux-group').screenshot({ path: path.join(process.env.PINLANE_CAPTURES, `niveaux-${theme}.png`) });
    }
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    // La direction : tout au maximum, rien a changer.
    await page.click('.staff-role-pill:has-text("Direction")');
    await page.waitForFunction(() => (document.querySelector('.staff-role-pill.active strong') || {}).textContent === 'Direction', null, { timeout: 10000 });
    const direction = await lireGroupe();
    ok(direction.reglages.every((r) => r.desactive) && direction.reglages[1].choisi === 'Sans limite' && direction.compteur === '5/5', `la direction voit le maximum, sans pouvoir le changer (recu : ${direction.reglages[1].choisi}, ${direction.compteur})`);
    const defenseDirection = await page.evaluate(async () => {
      const avant = window.__staffAuthPosts.length;
      await choisirNiveauRole('direction', 'prix', 'non');
      return window.__staffAuthPosts.length - avant;
    });
    ok(defenseDirection === 0, `un appel direct sur la direction ne part pas (recu : ${defenseDirection})`);
    // Au doigt : 44 px, et rien ne deborde a la largeur d un telephone.
    const doigt = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const tel = await doigt.newPage();
    await installMock(tel);
    await tel.goto(`${BASE_URL}/?v=upt-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await tel.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await tel.evaluate(() => {
      state.staffAccessControl = JSON.parse(JSON.stringify(window.__AC));
      state.staffMenuPage = 'users';
      state.staffTheme = 'dark';
      save();
      setView('staff');
      renderStaff();
    });
    await tel.waitForFunction(() => {
      const option = document.querySelector('.staff-niveaux-group .staff-niveau-option span');
      return option && option.getBoundingClientRect().height > 0;
    }, null, { timeout: 15000 });
    // La lecture de l equipe repeint la page une fois de plus : on mesure apres.
    await tel.waitForTimeout(800);
    const auDoigt = await tel.evaluate(() => {
      const options = [...document.querySelectorAll('.staff-niveaux-group .staff-niveau-option span')];
      return { grossier: matchMedia('(pointer: coarse)').matches, hauteurMin: Math.min(...options.map((o) => o.getBoundingClientRect().height)), debord: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    ok(auDoigt.grossier && auDoigt.hauteurMin >= 44, `au doigt, 44 px au moins (recu : ${JSON.stringify(auDoigt)})`);
    ok(auDoigt.debord <= 0, `a 390 px, la page ne deborde pas (recu : ${auDoigt.debord})`);
    if (process.env.PINLANE_CAPTURES) await tel.locator('.staff-niveaux-group').screenshot({ path: path.join(process.env.PINLANE_CAPTURES, 'niveaux-telephone.png') });
    await doigt.close();

    // ---- Contre-preuve par mutation : selection forcee sur le role plateforme
    const forced = await page.evaluate(() => {
      state.staffAccessControl.selectedRoleId = 'platform-owner';
      renderStaffUtilityPage();
      return {
        resolved: state.staffAccessControl.selectedRoleId,
        pillCount: document.querySelectorAll('.staff-role-pill').length,
        hasPlatform: /plateforme/i.test((document.querySelector('.staff-access-console') || {}).textContent || ''),
      };
    });
    ok(forced.resolved !== 'platform-owner', `selectedRoleId force sur platform-owner est re-resolu ailleurs (recu : "${forced.resolved}")`);
    ok(forced.pillCount === 5 && !forced.hasPlatform, 'apres mutation forcee, le rail reste a 5 roles sans le role plateforme');

    // ---- Defense en profondeur : le membre plateforme est intouchable ------
    const defense = await page.evaluate(async () => {
      window.confirm = () => true;
      const before = window.__staffAuthPosts.length;
      await toggleStaffMemberStatus('libramont:platform-owner');
      await deleteStaffMember('libramont:platform-owner');
      await updateStaffMemberRole('libramont:platform-owner', 'manager');
      await updateStaffMemberRole('libramont:sam', 'platform-owner');
      return { posted: window.__staffAuthPosts.slice(before) };
    });
    ok(defense.posted.length === 0, `bloquer/supprimer/re-roler l'acces plateforme (appels directs) : AUCUNE requete ne part (recu : ${JSON.stringify(defense.posted)})`);

    // Contre-preuve : garde neutralisee en memoire -> l'appel PART. Prouve que
    // le zero ci-dessus vient de la garde, pas d'un harnais casse.
    const counterProof = await page.evaluate(async () => {
      const original = window.isPlatformStaffMember;
      const before = window.__staffAuthPosts.length;
      try {
        window.isPlatformStaffMember = () => false;
        await toggleStaffMemberStatus('libramont:platform-owner');
      } finally {
        window.isPlatformStaffMember = original;
      }
      return { posted: window.__staffAuthPosts.slice(before) };
    });
    ok(counterProof.posted.includes('toggleMemberStatus'), `contre-preuve : garde neutralisee, la requete toggleMemberStatus PART (recu : ${JSON.stringify(counterProof.posted)})`);

    const fatal = errs.filter((e) => !/localStorage|sandboxed|favicon|cdn\.vercel-insights/i.test(e));
    ok(fatal.length === 0, `aucune erreur page fatale (recu : ${fatal.slice(0, 3).join(' | ') || 'aucune'})`);

    if (failures) {
      console.error(`\nusers-page-check: ${failures} echec(s).`);
      process.exit(1);
    }
    console.log('\nusers-page-check: ALL OK (role plateforme exclu partout et intouchable, selection de role stable apres edition, contre-preuves rouges)');
    process.exit(0);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error('users-page-check: exception', error && (error.stack || error.message)); process.exit(1); });
