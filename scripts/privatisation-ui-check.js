// Gate : LA PRIVATISATION DANS LA CONSOLE (2026-11-18, Marius, Gembloux : « est-ce que tu as
// prévu un onglet privatisation ? Genre comme ça je suis sûr que personne ne rajoute de
// réservation à ce moment-là »).
//
// La vraie console sur le banc du comptoir (scripts/comptoir-banc.js) : le vrai handler de
// api/ops.js pour « Privatiser » et « Retirer », le vrai api/staff-reservations.js pour la
// simulation de la fenetre Reserver, le vrai api/staff-state.js pour les privatisations du jour,
// une table availability_blocks en memoire (scripts/privatisation-banc.js). Le samedi 16 janvier
// 2027 a 15:10, un manager (reservations.edit, sans le droit de regler le centre).
//
//   [A] LE GESTE : « Privatiser… » dans le menu du planning ; la fenetre (refaite le 2026-11-20)
//       dessine la journee avec ses reservations, et liste d elle-meme, sans bouton a toucher,
//       celles deja sur 18:00-22:00 (les memes que le serveur) avant d enregistrer, puis ecrit en
//       une fois ; le bandeau du planning, la grille du bowling et le planning laser la disent.
//   [B] AU COMPTOIR : Reserver a 19:30 dit « Privatisé : Anniversaire Dupont, de 18:00 à 22:00 »
//       avant « Créer », sans offrir « Créer quand même » ; l horloge du bowling dit « privatisé ».
//   [C] « Réserver pour Anniversaire Dupont » : le plan tient, pour le groupe prive, et ses heures
//       se disent possibles dans sa privatisation.
//   [H] « Modifier » depuis le bandeau : la fenetre revient remplie, 22:00 devient 23:00, et
//       « Enregistrer » remplace la privatisation en une ecriture (une seule reste).
//   [I] « Privatisations à venir » (menu « ⋯ ») la liste, et son « Modifier » la rouvre remplie.
//   [D] « Retirer » depuis le bandeau, confirme : la privatisation part, le planning redevient libre.
//   [E] LA STAFF BAR voit la privatisation, sans « Privatiser… » ni « Retirer ».
//   [F] SANS PRIVATISATION, RIEN NE CHANGE : pas de bandeau, rien de grise, la barre garde sa
//       hauteur.
//   [G] ETABLISSEMENT (la direction) : une privatisation de deux activites se lit en une ligne a
//       cote des fermetures, et « Retirer » la retire en entier sans toucher la fermeture.
//
// node scripts/privatisation-ui-check.js                  le gate
// node scripts/privatisation-ui-check.js --captures=DIR   le gate, et ses images dans DIR
// node scripts/privatisation-ui-check.js --contre-preuves les contre-preuves : le fichier servi est
//   casse en memoire (le disque n est jamais touche), une a la fois, et sa propriete doit rougir.
'use strict';
const fs = require('fs');
const path = require('path');

const C = require('./comptoir-banc.js');
const PB = require('./privatisation-banc.js');
const { chromium } = require('playwright-core');

const { FX, B, ROOT, JOUR } = C;
const PORT = Number(process.env.PINLANE_PRIVATISATION_UI_PORT || 4627);
const NOM = 'Anniversaire Dupont';
const PHRASE = `Privatisé : ${NOM}, de 18:00 à 22:00`;
const argument = (nom) => {
  const brut = process.argv.find((a) => a === `--${nom}` || a.startsWith(`--${nom}=`));
  if (!brut) return null;
  return brut.includes('=') ? brut.slice(brut.indexOf('=') + 1) : true;
};
const CAPTURES = typeof argument('captures') === 'string' ? path.resolve(argument('captures')) : '';
const CONTRE = Boolean(argument('contre-preuves'));

// Le samedi du banc, allege : un bowling a 17:00 (fini a 18:00), quatre dossiers sur 18:00-22:00
// (bowling, laser, activite), un bowling a 22:00 (commence a la fin).
const GARDES = new Set([1621, 1624, 1625, 1628, 1629, 1631]);
const JOURNEE = (liste) => liste.filter((r) => GARDES.has(Number(r.id)));

const APP = 'assets/app-main.js';
const MUTATIONS = [
  { nom: 'complet-sans-hachures', lettre: 'A', cible: '[A] le planning complet hachure chaque demi-heure privatisee, dit « privatisé », et elle ne se reserve pas d un toucher', fichier: 'assets/pinlane-planning-global.js',
    de: "    if (prive && prive.centre) classes += ' is-prive';\n", vers: '' },
  { nom: 'hachures-sans-css', lettre: 'A', cible: '[A] le planning complet hachure chaque demi-heure privatisee, dit « privatisé », et elle ne se reserve pas d un toucher', fichier: 'assets/pinlane-planning-global.css',
    de: '.gf-t td.gf-bloc.is-prive, .gf-t tr.gf-libre.is-prive > td.gf-libre__l { background: repeating-linear-gradient(45deg, var(--subtle), var(--subtle) 7px, var(--surface) 7px, var(--surface) 14px); }', vers: '' },
  { nom: 'prive-reservable', lettre: 'A', cible: '[A] le planning complet hachure chaque demi-heure privatisee, dit « privatisé », et elle ne se reserve pas d un toucher', fichier: 'assets/pinlane-planning-global.js',
    de: ' && !(prive && prive.centre);\n', vers: ';\n' },
  { nom: 'bandeau-muet', lettre: 'A', cible: `[A] le planning dit la privatisation : bandeau « ${PHRASE} », tout le centre`, fichier: APP,
    de: "  const liste = state.view === 'staff' ? privatisationsGroupees(getAvailabilityBlocksForDate(state.currentDate), state.currentDate) : [];", vers: '  const liste = [];' },
  { nom: 'journee-sans-fermetures', lettre: 'A', cible: `[A] le planning dit la privatisation : bandeau « ${PHRASE} », tout le centre`, fichier: APP,
    de: '  if (Array.isArray(liste)) fermeturesDuJour.set(`${centerId}:${dateStr}`, liste.filter(b => b && b.scopeType));', vers: '' },
  { nom: 'liste-cachee', lettre: 'A', cible: '[A] avant d enregistrer, la fenetre liste les reservations deja sur ces heures, les memes que le serveur', fichier: APP,
    de: '      privatiserMontrer(reponse);\n', vers: '      privatiserMontrer({ ...reponse, reservations: [] });\n' },
  { nom: 'zone-sans-nom', lettre: 'A', cible: '[A] la grille du bowling grise chaque piste, au nom du groupe', fichier: APP,
    de: "reason: prive ? `Privatisé : ${block.reason || 'groupe privé'}` : block.reason || '', full, prive };", vers: "reason: block.reason || '', full, prive };" },
  { nom: 'phrase-mangee', lettre: 'B', cible: `[B] au comptoir, « ${PHRASE} » se lit avant « Créer »`, fichier: APP,
    de: "  const prive = /^Privatisé : /.exec(String(texte || ''));", vers: '  const prive = null;' },
  { nom: 'forcer-offert', lettre: 'B', cible: '[B] « Créer quand même » n est pas offert sur une privatisation', fichier: APP,
    de: "<div class=\"rs-tk-liens\">${(plan && plan.fermeture) || chevauche ? '' : forcer}<button", vers: "<div class=\"rs-tk-liens\">${chevauche ? '' : forcer}<button" },
  { nom: 'groupe-oublie', lettre: 'C', cible: `[C] « Réserver pour ${NOM} » : le plan tient, pour le groupe prive`, fichier: APP,
    de: '    ...(s.privatisation ? { privatisation: s.privatisation } : {}),\n', vers: '' },
  { nom: 'heures-sans-le-groupe', lettre: 'C', cible: '[C] pour le groupe, ses heures se disent possibles dans sa privatisation (20:00)', fichier: APP,
    de: 'Math.floor(currentTimeDecimal() * 60), s.privatisation || 0];', vers: 'Math.floor(currentTimeDecimal() * 60)];' },
  { nom: 'retrait-sans-ecriture', lettre: 'D', cible: '[D] « Retirer » retire la privatisation : la base, le bandeau et les zones grises', fichier: APP,
    de: "    await apiRequest(API_ENDPOINTS.ops, { method: 'POST', body: JSON.stringify({ action: 'retirerPrivatisation', centerId: getCurrentStaffCenterId(), ids }) });\n", vers: '' },
  { nom: 'barre-privatise', lettre: 'E', cible: '[E] la Staff bar voit la privatisation, sans « Privatiser… » ni « Retirer »', fichier: APP,
    de: "  privatiser: (peut) => peut(['reservations.edit', 'settings.manage']),", vers: '  privatiser: () => true,' },
  { nom: 'etablissement-bloc-par-bloc', lettre: 'G', cible: '[G] Etablissement liste la privatisation en une ligne (ses deux activites), a cote des fermetures', fichier: APP,
    de: "  const blocks = tous.filter(block => block.kind !== 'private');", vers: '  const blocks = tous;' },
  { nom: 'bandeau-vide-montre', lettre: 'F', cible: '[F] sans privatisation, pas de bandeau, rien de grise, la barre garde sa hauteur', fichier: APP,
    de: '  zone.hidden = !liste.length;', vers: '  zone.hidden = false;' },
  { nom: 'jauge-sans-la-journee', lettre: 'A', cible: '[A] la fenetre dessine la journee : chaque reservation du jour, celles de la plage en fonce', fichier: APP,
    de: '  privatiserJournee(jour);\n', vers: '' },
  { nom: 'modifier-sans-remplace', lettre: 'H', cible: '[H] « Enregistrer » remplace la privatisation en une fois : une seule, 18:00 a 23:00, le bandeau la dit', fichier: APP,
    de: '  if (remplace.length) envoi.remplace = remplace;\n', vers: '' },
  { nom: 'liste-a-venir-vide', lettre: 'I', cible: '[I] « Privatisations à venir » la liste (18:00 a 23:00, son nom), et « Modifier » la rouvre remplie', fichier: APP,
    de: '  privatisationsAVenir = Array.isArray(reponse && reponse.privatisations) ? reponse.privatisations : [];', vers: '  privatisationsAVenir = [];' },
];

const lf = (t) => String(t).replace(/\r\n/g, '\n');
let mutation = null;
function transformer(rel, texte) {
  if (!mutation || mutation.fichier !== rel) return texte;
  return lf(texte).split(mutation.de).join(mutation.vers);
}

let echecs = [];
function ok(cond, label, detail) {
  if (cond) { if (!mutation) console.log(`ok    ${label}`); return true; }
  echecs.push(label);
  if (!mutation) console.log(`FAIL  ${label}${detail !== undefined ? `  ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500)}` : ''}`);
  return false;
}

const serveur = C.monterServeur();
const ops = require(path.join(ROOT, 'api/ops.js'));
const staffState = require(path.join(ROOT, 'api/staff-state.js'));

// LA CONSOLE DU BANC, avec la privatisation branchee au vrai serveur : « Privatiser » et
// « Retirer » partent a api/ops.js, la journee servie recoit les privatisations et la revision du
// vrai staff-state (le planning de la fixture garde ses dossiers).
async function ouvrir(browser, role) {
  const m = await C.ouvrirConsole(browser, serveur, { port: PORT, role, theme: 'light', reservations: JOURNEE });
  const { page } = m;
  page.on('dialog', (dialogue) => { dialogue.accept().catch(() => {}); });
  await page.exposeFunction('__etatReel', async (url) => B.appeler(staffState, 'GET', url));
  await page.evaluate(() => {
    window.__privatisationAppels = [];
    const avant = window.fetch;
    window.fetch = async (input, init) => {
      init = init || {};
      const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
      const me = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
      const json = (corps, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
      if (u.pathname === '/api/ops' && me === 'POST') {
        const corps = init.body ? JSON.parse(init.body) : {};
        if (corps.action === 'privatiser' || corps.action === 'retirerPrivatisation' || corps.action === 'listerPrivatisations') {
          window.__privatisationAppels.push(corps);
          const rep = await window.__vraiAppel('POST', '/api/ops', corps);
          return json(rep.json || {}, rep.statut);
        }
      }
      if (u.pathname === '/api/ops' && me === 'GET' && u.searchParams.get('action') === 'listAvailabilityBlocks') {
        const rep = await window.__vraiAppel('GET', u.pathname + u.search);
        return json(rep.json || {}, rep.statut);
      }
      if (u.pathname === '/api/staff-state' && me === 'GET' && !(Number(u.searchParams.get('days')) > 0)) {
        const r = await avant(input, init);
        const j = await r.clone().json();
        const reel = await window.__etatReel(u.pathname + u.search);
        if (reel && reel.json && Array.isArray(reel.json.blocks)) {
          j.blocks = reel.json.blocks;
          j.revision = `${j.revision || ''}::${reel.json.revision || ''}`;
        }
        return json(j, r.status);
      }
      return avant(input, init);
    };
  });
  await relire(page);
  return m;
}

const relire = async (page) => {
  await page.evaluate((jour) => syncDateReservations(jour, { silent: true }), JOUR);
  await FX.repos(page, 250);
};
const photo = async (page, nom) => {
  if (!CAPTURES || mutation) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
};
const finir = async (m, quoi) => {
  ok(m.erreurs.length === 0, `[*] zero erreur JavaScript (${quoi})`, m.erreurs.slice(0, 3).join(' | '));
  await m.ctx.close();
};
const menuPlus = async (page) => {
  await page.evaluate(() => closeStaffFloatingMenus());
  await page.locator('#planningPlus').click();
  await FX.repos(page, 120);
  const boutons = await page.evaluate(() => Array.from(document.querySelectorAll('.staff-action-popover button')).map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
  return boutons;
};
const bandeau = (page) => page.evaluate(() => {
  const z = document.getElementById('planningPrivatisations');
  return {
    vu: Boolean(z && !z.hidden && z.getClientRects().length && getComputedStyle(z).display !== 'none'),
    texte: z ? z.textContent.replace(/\s+/g, ' ').trim() : '',
    retirer: z ? z.querySelectorAll('.pb-prive__x').length : 0,
  };
});
const attendre = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 10000 }).catch(() => {});

// Ce que le vrai serveur liste pour 18:00-22:00 (la lecture a blanc), pour comparer a l ecran.
async function listeDuServeur() {
  const r = await B.appeler(ops, 'POST', '/api/ops', { action: 'privatiser', centerId: 'libramont', aBlanc: true, date: JOUR, startTime: '18:00', endTime: '22:00', toutLeCentre: true, nom: NOM });
  return ((r.json || {}).reservations || []).map((x) => x.nom);
}

// ---------------------------------------------------------------------------
// [A] [B] [C] [D] : le manager.
// ---------------------------------------------------------------------------
async function scenarioManager(browser) {
  PB.vider();
  const m = await ouvrir(browser, 'manager');
  const { page } = m;
  try {
    // [A] LE GESTE
    const menu = await menuPlus(page);
    ok(menu.includes('Privatiser…'), '[A] le menu « ⋯ » du planning offre « Privatiser… » au manager', menu);
    await page.locator('.staff-action-popover button', { hasText: 'Privatiser' }).first().click();
    await page.waitForSelector('#prvForm', { timeout: 8000 });
    await page.locator('#prvDe').fill('18:00');
    await page.locator('#prvA').fill('22:00');
    await page.locator('#prvNom').fill(NOM);
    // (la liste se lit d elle-meme ; « Privatiser » s allume quand elle est celle de la demande)
    await attendre(page, () => { const b = document.getElementById('prvOk'); return b && !b.disabled && document.querySelector('#prvVu .prv-dit'); });
    await FX.repos(page, 200);
    await photo(page, '1-privatiser-la-fenetre');
    const attendus = await listeDuServeur();
    const vu = await page.evaluate(() => ({
      phrase: ((document.querySelector('#prvResume .prv-phrase') || {}).textContent || '').trim(),
      noms: Array.from(document.querySelectorAll('#prvVu .prv-resa b')).map((b) => b.textContent.trim()),
      dit: ((document.querySelector('#prvVu .prv-dit') || {}).textContent || '').trim(),
      bouton: (document.getElementById('prvOk') || {}).textContent || '',
      actif: !(document.getElementById('prvOk') || {}).disabled,
    }));
    ok(attendus.length >= 3 && vu.noms.join('|') === attendus.join('|') && /déjà sur ces heures/.test(vu.dit) && vu.bouton === 'Privatiser' && vu.actif,
      '[A] avant d enregistrer, la fenetre liste les reservations deja sur ces heures, les memes que le serveur', { attendus, vu });
    ok(vu.phrase === `${PHRASE}.`, '[A] la fenetre dit la phrase que le planning et le comptoir diront', vu.phrase);
    ok(PB.privees().length === 0, '[A] voir ce qui est deja la n ecrit rien', PB.privees());
    // LA JOURNEE DESSINEE : un trait par reservation du jour (la lecture a blanc de la journee
    // entiere, faite ici au vrai serveur), en fonce celles que la plage ferme.
    const ouverture = await page.evaluate((jour) => privatiserOuverture(jour), JOUR);
    const hhmm = (m) => (m >= 1440 ? '24:00' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    const journee = await B.appeler(ops, 'POST', '/api/ops', { action: 'privatiser', centerId: 'libramont', aBlanc: true, date: JOUR, startTime: hhmm(ouverture.open), endTime: hhmm(ouverture.close), toutLeCentre: true, nom: 'Journée' });
    const duJour = ((journee.json || {}).reservations || []).length;
    const jauge = await page.evaluate(() => ({
      traits: document.querySelectorAll('#prvJaugeResas .prv-trait').length,
      fonces: document.querySelectorAll('#prvJaugeResas .prv-trait.is-touchee').length,
      selection: Boolean(document.querySelector('#prvJaugeSel:not([hidden])')),
    }));
    ok(duJour > attendus.length && jauge.traits === duJour && jauge.fonces === attendus.length && jauge.selection,
      '[A] la fenetre dessine la journee : chaque reservation du jour, celles de la plage en fonce', { duJour, attendus: attendus.length, jauge });
    await photo(page, '2-reservations-deja-sur-la-plage');
    await page.locator('#prvOk').click();
    await attendre(page, () => !document.getElementById('prvForm'));
    const lignes = PB.privees();
    const appels = await page.evaluate(() => window.__privatisationAppels.filter((a) => a.action === 'privatiser' && !a.aBlanc));
    ok(lignes.length === 1 && lignes[0].scope_type === 'center' && lignes[0].reason === NOM && /^18:00/.test(String(lignes[0].start_time)) && /^22:00/.test(String(lignes[0].end_time)) && lignes[0].date === JOUR,
      '[A] « Privatiser » ecrit une privatisation : tout le centre, 18:00 a 22:00, au nom donne', lignes);
    ok(appels.length === 1 && appels[0].reservationsVues.length === attendus.length && !appels[0].reservationId,
      '[A] l ecriture dit les reservations vues, et aucune n est le groupe prive', appels);
    await attendre(page, (p) => { const z = document.getElementById('planningPrivatisations'); return z && !z.hidden && z.textContent.includes(p); }, PHRASE);
    const b = await bandeau(page);
    ok(b.vu && b.texte.includes(PHRASE) && /Tout le centre/.test(b.texte) && b.retirer === 1,
      `[A] le planning dit la privatisation : bandeau « ${PHRASE} », tout le centre`, b);
    await page.evaluate(() => pbChanger('bowling'));
    await FX.repos(page, 400);
    const grille = await page.evaluate(() => ({
      pistes: document.querySelectorAll('#planningGridWrap .lane-col').length,
      zones: Array.from(document.querySelectorAll('#planningGridWrap .planning-blocked.is-prive')).map((z) => z.textContent.trim()),
    }));
    ok(grille.pistes > 0 && grille.zones.length === grille.pistes && grille.zones.every((t) => t === `Privatisé : ${NOM}`),
      '[A] la grille du bowling grise chaque piste, au nom du groupe', grille);
    ok((await bandeau(page)).vu, '[A] le bandeau reste sur le planning bowling');
    await photo(page, '3-planning-privatise');
    await page.evaluate(() => pbChanger('laser'));
    await FX.repos(page, 400);
    const laser = await page.evaluate((n) => Array.from(document.querySelectorAll('#laserPlanningGridWrap .lp-libre')).filter((e) => e.textContent.trim() === `Privatisé : ${n}`).length, NOM);
    ok(laser > 0, '[A] le planning laser dit les departs privatises, au nom du groupe', laser);
    await page.evaluate(() => pbChanger('all'));
    await FX.repos(page, 300);
    // LE PLANNING COMPLET (2026-11-20, Ansar : « pour privatisé faut que ça grisille aussi sur le
    // planning complet ») : chaque demi-heure de 18:00 a 21:30 hachuree (le fond se lit calcule),
    // dite « privatisé » et plus « complet », sans bouton pour reserver ; avant 18:00, rien.
    const complet = await page.evaluate(() => Array.from(document.querySelectorAll('.gf-t td.gf-bloc[data-gf-bloc]')).filter((td) => td.getClientRects().length).map((td) => ({
      h: td.dataset.gfBloc, prive: td.classList.contains('is-prive'), texte: td.textContent.replace(/\s+/g, ' ').trim(),
      bouton: Boolean(td.querySelector('button')), hachure: getComputedStyle(td).backgroundImage.includes('repeating-linear-gradient'),
    })));
    const dedans = complet.filter((c) => c.h >= '18:00' && c.h < '22:00');
    const avant = complet.filter((c) => c.h < '18:00');
    ok(dedans.length >= 4 && dedans.every((c) => c.prive && c.hachure && /privatisé/.test(c.texte) && !/complet/.test(c.texte) && !c.bouton) && avant.length > 0 && avant.every((c) => !c.prive && !c.hachure),
      '[A] le planning complet hachure chaque demi-heure privatisee, dit « privatisé », et elle ne se reserve pas d un toucher', { dedans, avantPrives: avant.filter((c) => c.prive || c.hachure).map((c) => c.h) });
    await photo(page, '3b-planning-complet-privatise');

    // [B] AU COMPTOIR
    await page.evaluate((jour) => openQuickBook({ date: jour, startTime: '19:30', type: 'bowling', pax: 4 }), JOUR);
    await page.waitForSelector('.qb-modal.rv', { timeout: 8000 });
    if (!(await page.evaluate(() => rsEtat().faits.combien))) await page.locator('#rsHaut [data-pax="4"]').click();
    await attendre(page, () => { const p = rvPlanCourant(); return p && p.disponible === false; });
    await FX.repos(page, 300);
    const r = await page.evaluate(() => {
      const plan = rvPlanCourant();
      return {
        plan: plan ? { disponible: plan.disponible, refus: plan.refus, fermeture: plan.fermeture || null } : null,
        texte: (document.querySelector('.qb-modal.rv') || {}).innerText || '',
        creer: ((document.getElementById('rvCreer') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
        forcer: Boolean(document.getElementById('rvForcer')),
        niveauForcer: rsNiveau('forcer'),
        pour: ((document.getElementById('rvPourPrive') || {}).textContent || '').trim(),
        heure: quickBookState.startTime,
      };
    });
    ok(r.plan && r.plan.disponible === false && r.plan.fermeture && r.plan.fermeture.type === 'privatisation' && r.heure === '19:30',
      '[B] MONTAGE : le vrai serveur refuse 19:30, privatise', r.plan);
    ok(r.texte.includes(PHRASE) && !/^Créer/.test(r.creer), `[B] au comptoir, « ${PHRASE} » se lit avant « Créer »`, { creer: r.creer, texte: r.texte.slice(0, 600) });
    ok(r.niveauForcer === 'oui', '[B] MONTAGE : le manager a le niveau « Créer quand même »', r.niveauForcer);
    ok(!r.forcer, '[B] « Créer quand même » n est pas offert sur une privatisation', r);
    ok(r.pour === `Réserver pour ${NOM}`, `[B] la fenetre offre « Réserver pour ${NOM} » (la privatisation n a pas encore de dossier)`, r.pour);
    await attendre(page, () => { const b = document.querySelector('#rsZ-bowling .rs-h[data-heure="20:00"] small'); return b && b.textContent.trim() === 'privatisé'; });
    const h20avant = await page.evaluate(() => ((document.querySelector('#rsZ-bowling .rs-h[data-heure="20:00"] small') || {}).textContent || '').trim());
    ok(h20avant === 'privatisé', '[B] l horloge du bowling marque les heures privatisees « privatisé » (20:00)', h20avant);
    await photo(page, '4-comptoir-refus-privatise');

    // [C] LE DOSSIER DU GROUPE
    await page.locator('#rvPourPrive').click();
    await attendre(page, () => { const p = rvPlanCourant(); return p && p.disponible === true; });
    await FX.repos(page, 300);
    const c = await page.evaluate(() => {
      const plan = rvPlanCourant();
      return {
        plan: plan ? { disponible: plan.disponible, pour: plan.pourPrivatisation || null } : null,
        note: ((document.getElementById('rvPourPrivatisation') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
        creer: ((document.getElementById('rvCreer') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      };
    });
    ok(c.plan && c.plan.disponible && c.plan.pour && c.plan.pour.nom === NOM && c.note.includes(`Dossier du groupe privé : ${NOM}, de 18:00 à 22:00.`),
      `[C] « Réserver pour ${NOM} » : le plan tient, pour le groupe prive`, c);
    await attendre(page, () => { const b = document.querySelector('#rsZ-bowling .rs-h[data-heure="20:00"] small'); return b && b.textContent.trim() && b.textContent.trim() !== 'privatisé'; });
    const h20 = await page.evaluate(() => ((document.querySelector('#rsZ-bowling .rs-h[data-heure="20:00"] small') || {}).textContent || '').trim());
    ok(Boolean(h20) && h20 !== 'privatisé', '[C] pour le groupe, ses heures se disent possibles dans sa privatisation (20:00)', h20);
    await photo(page, '5-reserver-pour-le-groupe');
    await page.evaluate(() => closeQuickBook());
    await FX.repos(page, 200);

    // [H] MODIFIER depuis le bandeau
    const avantIds = PB.privees().map((l) => Number(l.id));
    await page.locator('#planningPrivatisations .pb-prive__b').first().click();
    await page.waitForSelector('#prvForm', { timeout: 8000 });
    const rempli = await page.evaluate(() => ({
      titre: ((document.getElementById('bdgFenT') || {}).textContent || '').trim(),
      jour: (document.getElementById('prvDate') || {}).value || '',
      de: (document.getElementById('prvDe') || {}).value || '',
      a: (document.getElementById('prvA') || {}).value || '',
      nom: (document.getElementById('prvNom') || {}).value || '',
      quoi: (document.querySelector('input[name="prvQuoi"]:checked') || {}).value || '',
      bouton: ((document.getElementById('prvOk') || {}).textContent || '').trim(),
    }));
    ok(rempli.titre === 'Modifier la privatisation' && rempli.jour === JOUR && rempli.de === '18:00' && rempli.a === '22:00' && rempli.nom === NOM && rempli.quoi === 'centre' && rempli.bouton === 'Enregistrer',
      '[H] « Modifier » rouvre la privatisation remplie : le jour, 18:00 a 22:00, le nom, tout le centre', rempli);
    await page.locator('#prvA').fill('23:00');
    await attendre(page, () => { const b = document.getElementById('prvOk'); return b && !b.disabled && document.querySelector('#prvVu .prv-dit'); });
    await FX.repos(page, 200);
    await photo(page, '6-modifier-la-privatisation');
    await page.locator('#prvOk').click();
    const PHRASE23 = `Privatisé : ${NOM}, de 18:00 à 23:00`;
    await attendre(page, (p) => { const z = document.getElementById('planningPrivatisations'); return !document.getElementById('prvForm') && z && z.textContent.includes(p); }, PHRASE23);
    const modifiee = PB.privees();
    const bm = await bandeau(page);
    ok(modifiee.length === 1 && /^18:00/.test(String(modifiee[0].start_time)) && /^23:00/.test(String(modifiee[0].end_time)) && modifiee[0].reason === NOM && !avantIds.includes(Number(modifiee[0].id)) && bm.texte.includes(PHRASE23) && bm.retirer === 1,
      '[H] « Enregistrer » remplace la privatisation en une fois : une seule, 18:00 a 23:00, le bandeau la dit', { modifiee, bm });

    // [I] LES PRIVATISATIONS A VENIR
    const menuListe = await menuPlus(page);
    await page.locator('.staff-action-popover button', { hasText: 'Privatisations à venir' }).first().click();
    await attendre(page, () => document.querySelector('#prvListe .prv-liste__l'));
    const lue = await page.evaluate(() => Array.from(document.querySelectorAll('#prvListe .prv-liste__l')).map((l) => l.textContent.replace(/\s+/g, ' ').trim()));
    await photo(page, '7-privatisations-a-venir');
    let rouverte = null;
    if (lue.length) {
      await page.locator('#prvListe .prv-liste__l .pb-prive__b').first().click();
      await page.waitForSelector('#prvForm', { timeout: 8000 }).catch(() => {});
      rouverte = await page.evaluate(() => ({ titre: ((document.getElementById('bdgFenT') || {}).textContent || '').trim(), a: (document.getElementById('prvA') || {}).value || '', nom: (document.getElementById('prvNom') || {}).value || '' }));
      await page.locator('#prvForm .bdg-b').first().click();
      await attendre(page, () => document.getElementById('prvListe'));
    }
    const revenue = await page.evaluate(() => Boolean(document.getElementById('prvListe')));
    ok(menuListe.includes('Privatisations à venir') && lue.length === 1 && lue[0].includes(NOM) && /18:00/.test(lue[0]) && /23:00/.test(lue[0]) && /Tout le centre/.test(lue[0])
      && rouverte && rouverte.titre === 'Modifier la privatisation' && rouverte.a === '23:00' && rouverte.nom === NOM && revenue,
    '[I] « Privatisations à venir » la liste (18:00 a 23:00, son nom), et « Modifier » la rouvre remplie', { menuListe, lue, rouverte, revenue });
    await page.evaluate(() => smFenetreFermer());
    await FX.repos(page, 150);

    // [D] RETIRER (la confirmation de la console, plus la boite du navigateur)
    await page.locator('#planningPrivatisations .pb-prive__x').first().click();
    await page.locator('.staff-confirm [data-role="confirm-ok"]').click({ timeout: 5000 }).catch(() => {});
    await attendre(page, () => { const z = document.getElementById('planningPrivatisations'); return z && z.hidden; });
    await page.evaluate(() => pbChanger('bowling'));
    await FX.repos(page, 400);
    const apres = { base: PB.privees().length, bandeau: await bandeau(page), zones: await page.evaluate(() => document.querySelectorAll('#planningGridWrap .planning-blocked.is-prive').length) };
    ok(apres.base === 0 && !apres.bandeau.vu && apres.zones === 0, '[D] « Retirer » retire la privatisation : la base, le bandeau et les zones grises', apres);
  } finally { await finir(m, 'manager'); }
}

// ---------------------------------------------------------------------------
// [E] la Staff bar.
// ---------------------------------------------------------------------------
async function scenarioBarre(browser) {
  PB.vider();
  await PB.poserBlocs([{ scope_type: 'center', scope_ref: null, date: JOUR, start_time: '18:00', end_time: '22:00', reason: NOM, kind: 'private' }]);
  const m = await ouvrir(browser, 'catalogue');
  const { page } = m;
  try {
    const menu = await menuPlus(page);
    await page.evaluate(() => closeStaffFloatingMenus());
    const b = await bandeau(page);
    const geste = await page.evaluate(() => peutGeste('privatiser'));
    ok(menu.length > 0 && !menu.some((x) => /Privatis(er|ations)/.test(x)) && b.vu && b.texte.includes(PHRASE) && b.retirer === 0 && geste === false,
      '[E] la Staff bar voit la privatisation, sans « Privatiser… » ni « Retirer »', { menu, b, geste });
  } finally { await finir(m, 'staff bar'); }
}

// ---------------------------------------------------------------------------
// [F] sans privatisation.
// ---------------------------------------------------------------------------
async function scenarioSans(browser) {
  PB.vider();
  const m = await ouvrir(browser, 'manager');
  const { page } = m;
  try {
    for (const vue of ['all', 'bowling']) {
      await page.evaluate((v) => pbChanger(v), vue);
      await FX.repos(page, 300);
      const f = await page.evaluate(() => {
        const z = document.getElementById('planningPrivatisations');
        const barre = document.getElementById('planningBarre');
        const avec = barre.getBoundingClientRect().height;
        const parent = z.parentNode;
        const suivant = z.nextSibling;
        z.remove();
        const sans = barre.getBoundingClientRect().height;
        parent.insertBefore(z, suivant);
        return { affiche: getComputedStyle(z).display, enfants: z.children.length, avec, sans, prive: document.querySelectorAll('.planning-blocked.is-prive, .gf-t .is-prive').length };
      });
      ok(f.affiche === 'none' && f.enfants === 0 && f.avec === f.sans && f.prive === 0,
        '[F] sans privatisation, pas de bandeau, rien de grise, la barre garde sa hauteur', { vue, ...f });
    }
  } finally { await finir(m, 'sans privatisation'); }
}

// ---------------------------------------------------------------------------
// [G] Etablissement (la direction) : une privatisation, une ligne et un « Retirer ».
// ---------------------------------------------------------------------------
async function scenarioEtablissement(browser) {
  PB.vider();
  await PB.poserBlocs([
    { scope_type: 'activity', scope_ref: 'minigolf_blacklight', date: JOUR, start_time: '12:00', end_time: '14:00', reason: 'École Saint-Joseph', kind: 'private' },
    { scope_type: 'activity', scope_ref: 'laser_game', date: JOUR, start_time: '12:00', end_time: '14:00', reason: 'École Saint-Joseph', kind: 'private' },
    { scope_type: 'lane', scope_ref: '3', date: JOUR, start_time: '10:00', end_time: '11:00', reason: 'Piste capricieuse', kind: 'closure' },
  ]);
  const m = await ouvrir(browser, 'direction');
  const { page } = m;
  try {
    await page.evaluate(async () => { window.openStaffMenuPage('establishment'); await loadAvailabilityBlocks(true); });
    await page.waitForSelector('[data-estab-page]', { timeout: 10000 });
    await page.evaluate(() => ebOuvrir('horaires'));
    await attendre(page, () => document.querySelector('#avbList [data-privatisation]'));
    const liste = await page.evaluate(() => ({
      prives: Array.from(document.querySelectorAll('#avbList [data-privatisation]')).map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
      fermetures: Array.from(document.querySelectorAll('#avbList [data-block-id]')).map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
    }));
    ok(liste.prives.length === 1 && /^Privatisé : École Saint-Joseph, le samedi 16 janvier, de 12:00 à 14:00/.test(liste.prives[0]) && /Minigolf/.test(liste.prives[0]) && /Laser/.test(liste.prives[0])
      && liste.fermetures.length === 1 && /Piste 3/.test(liste.fermetures[0]),
    '[G] Etablissement liste la privatisation en une ligne (ses deux activites), a cote des fermetures', liste);
    await page.locator('#avbList [data-privatisation] .availability-del').click();
    await page.locator('.staff-confirm [data-role="confirm-ok"]').click({ timeout: 5000 }).catch(() => {});
    await attendre(page, () => !document.querySelector('#avbList [data-privatisation]'));
    const reste = { privees: PB.privees().length, fermetures: PB.table.lignes.filter((l) => l.kind === 'closure').length };
    ok(reste.privees === 0 && reste.fermetures === 1, '[G] « Retirer » dans Etablissement retire toute la privatisation, la fermeture reste', reste);
  } finally { await finir(m, 'etablissement'); }
}

const SCENARIOS = { G: scenarioEtablissement, A: scenarioManager, B: scenarioManager, C: scenarioManager, D: scenarioManager, H: scenarioManager, I: scenarioManager, E: scenarioBarre, F: scenarioSans };

async function main() {
  const http = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: C.BROWSER_PATH, headless: true });
  let code = 0;
  try {
    if (!CONTRE) {
      for (const s of [scenarioManager, scenarioBarre, scenarioSans, scenarioEtablissement]) await s(browser);
      console.log(`\n${echecs.length ? `privatisation-ui-check: ${echecs.length} ECHEC(S)` : 'privatisation-ui-check: ALL OK (le geste, la journee dessinee et la liste lue d elle-meme, le bandeau, Modifier en une ecriture, les privatisations a venir, la grille et le laser, la phrase au comptoir sans « Créer quand même », le dossier du groupe, le retrait, la Staff bar, rien ne change sans privatisation, Etablissement la liste et la retire en entier)'}`);
      if (CAPTURES && !echecs.length) console.log(`images : ${CAPTURES}`);
      code = echecs.length ? 1 : 0;
    } else {
      let mordent = 0;
      // (PRIVATISATION_UI_SEULES=nom,nom : seulement ces contre-preuves)
      const seules = String(process.env.PRIVATISATION_UI_SEULES || '').split(',').filter(Boolean);
      const liste = MUTATIONS.filter((x) => !seules.length || seules.includes(x.nom));
      for (const m of liste) {
        const source = lf(fs.readFileSync(path.join(ROOT, m.fichier), 'utf8'));
        if (source.split(m.de).length !== 2) { console.log(`FAIL  contre-preuve ${m.nom} : son ancre n est pas unique dans ${m.fichier}`); continue; }
        mutation = m;
        echecs = [];
        try { await SCENARIOS[m.lettre](browser); } catch (erreur) { echecs.push(`exception : ${erreur.message}`); }
        mutation = null;
        if (echecs.includes(m.cible)) { mordent += 1; console.log(`ok    contre-preuve ${m.nom} : « ${m.cible} » rougit`); } else console.log(`FAIL  contre-preuve ${m.nom} : « ${m.cible} » reste vert (${echecs.length} autre(s) rouge(s) : ${(echecs[0] || '').slice(0, 140)})`);
      }
      console.log(`\nprivatisation-ui-check --contre-preuves : ${mordent}/${liste.length} mordent`);
      code = mordent === liste.length ? 0 : 1;
    }
  } finally {
    await browser.close();
    http.close();
  }
  process.exit(code);
}

main().catch((erreur) => {
  console.error('privatisation-ui-check : interrompu', erreur && (erreur.stack || erreur));
  process.exit(1);
});
