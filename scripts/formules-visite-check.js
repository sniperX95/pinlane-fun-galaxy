#!/usr/bin/env node
'use strict';
// =============================================================================
// LES FORMULES A L ECRAN DES HEURES, LES PLAGES REPLIEES, LES PARTIES DE LASER
// SANS HEURE, LES ENFANTS DU KIDS FUN DAY
// -----------------------------------------------------------------------------
// Audit QA du 2026-09-28 et Movsar, le meme jour :
//   « les formules y a pas tous les details des activites quand on est dans
//   les choix des heures, et les formules ou y a certaines des activites en
//   illimite c est mal gere » ; reponse a la question posee : arrivee jusqu a
//   la fin, meme prix, l ecran previent du temps qui reste ;
//   « quand on est dans les horaires matin ou apres-midi on a pas les infos
//   genre decale, serre et tout, y a que sur soiree » ;
//   parties de laser 2 et 3 : « prevenir, mais ils peuvent tout de meme avoir
//   leur autre partie a placer sur place, c est mieux s ils choisissent ; la
//   premiere est obligatoire » ; audit : « alertes visibles pour les
//   activites non planifiees » ;
//   Kids Fun Day : « demander enfants / adultes ; seuls les enfants paient la
//   formule ».
//
//   [A] le serveur : l offre reservee aux enfants se lit dans les mots du
//       centre ; les accompagnants ne valent que pour elle ; le prix se fait
//       sur les enfants ; la base garde les accompagnants ;
//   [B] la Formule 4 a l ecran des heures : ses deux parties de laser (la 2e
//       sur place), ce qu elle comprend (les mots de sa carte), le conseil de
//       choisir l heure de la 2e partie ;
//   [C] les plages repliees disent ce qu elles cachent, avec les memes mots
//       que les puces, sans changer de hauteur ;
//   [D] le Kids Fun Day : combien d enfants, les adultes a cote, le prix sur
//       les enfants, la disponibilite demandee pour les enfants, le temps de
//       jeu qui reste a l heure d arrivee, le recapitulatif et l envoi ;
//   [E] la console : une partie de laser sans heure se voit sur la ligne du
//       dossier, et les accompagnants aussi ;
//   [F] contre-epreuves servies en memoire : chaque regle retiree, ce gate
//       ROUGIT, et le depot n est jamais touche.
// =============================================================================
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PINLANE_FORMULES_VISITE_PORT || 4389);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
process.env.PINLANE_DEVTUNNEL_PORT = String(PORT);
process.env.PINLANE_CALENDAR_SYNC = 'off';

let echecs = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return Boolean(cond);
}
function section(titre) { console.log(`\n[${titre}]`); }
async function attendre(page, fn, ms, arg) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (error) { return false; }
}
// LA FENETRE « ENVIE D UN PEU PLUS ? » s ouvre seule a l arrivee au
// recapitulatif quand le serveur a joint des offres au creneau : un client la
// ferme (« Non merci ») avant de valider, ce parcours aussi. Tant que le
// formulaire n a pas decide de l ouvrir, elle porte data-attendue.
async function passerLaVitrine(f) {
  await attendre(f, () => { const v = document.querySelector('#vitrine'); return !v || !v.hasAttribute('data-attendue'); }, 5000);
  const ouverte = await f.evaluate(() => { const v = document.querySelector('#vitrine'); return Boolean(v && !v.hidden); });
  if (ouverte) {
    await f.click('#vitrine .fg-vitrine__non');
    await attendre(f, () => document.querySelector('#vitrine').hidden, 3000);
  }
  return ouverte;
}
const txt = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// [A] LE SERVEUR
// ---------------------------------------------------------------------------
function verifierServeur(jourKfd) {
  section('A. LE SERVEUR');
  const { getEffectiveFormules } = require('../lib/booking-config');
  const formules = getEffectiveFormules('libramont');
  const kfd = formules.find((f) => f.id === 'kfd') || {};
  const enfants = formules.filter((f) => f.kidsOnly);
  ok(kfd.kidsOnly && kfd.kidsOnly.ageMin === 5 && kfd.kidsOnly.ageMax === 12 && enfants.length === 1,
    'le Kids Fun Day est lu comme reserve aux enfants de 5 a 12 ans (sa description le dit), et lui seul', enfants.map((f) => `${f.id}:${JSON.stringify(f.kidsOnly)}`).join(' '));

  const { normalizeReservationRequest } = require('../lib/reservation-request');
  const base = { name: 'QA KFD', phone: '+32470000000', email: 'qa@example.com', centerId: 'libramont', date: jourKfd, startTime: '12:00', channel: 'public' };
  let kfdReq = null; let erreurKfd = '';
  try { kfdReq = normalizeReservationRequest({ ...base, type: 'formule', formuleId: 'kfd', pax: 6, companions: 2 }, { channel: 'public', requireEmail: true }); } catch (error) { erreurKfd = error.message; }
  ok(kfdReq && kfdReq.companions === 2 && Number(kfdReq.pax) === 6, 'un Kids Fun Day de 6 enfants garde ses 2 accompagnants', erreurKfd || JSON.stringify(kfdReq && { pax: kfdReq.pax, companions: kfdReq.companions }));
  ok(kfdReq && Number(kfdReq.price) === 6 * Number(kfd.price), `le prix se fait sur les enfants seuls (6 x ${kfd.price} EUR)`, kfdReq ? `${kfdReq.price} EUR` : '');
  let f4Req = null; let erreurF4 = '';
  try { f4Req = normalizeReservationRequest({ ...base, type: 'formule', formuleId: 'f4', pax: 12, companions: 3 }, { channel: 'public', requireEmail: true }); } catch (error) { erreurF4 = error.message; }
  ok(f4Req && f4Req.companions === 0, 'ailleurs, un compte d accompagnants envoye de force est ignore (Formule 4 : tout le groupe joue et paie)', erreurF4 || String(f4Req && f4Req.companions));

  const { normalizeReservationPayload } = require('../lib/database');
  const rangee = normalizeReservationPayload({ centerId: 'libramont', type: 'formule', formuleId: 'kfd', date: jourKfd, startTime: '12:00', duration: 5, pax: 6, companions: 2, name: 'QA', phone: '+32470000000' }, {});
  const inchangee = normalizeReservationPayload({ id: 7, status: 'confirmed' }, { ...rangee, id: 7 });
  const bornee = normalizeReservationPayload({ centerId: 'libramont', type: 'formule', formuleId: 'kfd', date: jourKfd, startTime: '12:00', duration: 5, pax: 6, companions: 9999, name: 'QA', phone: '+32470000000' }, {});
  ok(rangee.companions === 2 && inchangee.companions === 2 && bornee.companions === 500,
    'la base garde les accompagnants, un changement de statut ne les efface pas, la borne est celle de la colonne', `${rangee.companions} / ${inchangee.companions} / ${bornee.companions}`);
  const sql = fs.readFileSync(path.join(ROOT, 'lib', 'database.js'), 'utf8');
  const migration = fs.readFileSync(path.join(ROOT, 'database', 'reservation-companions-schema.sql'), 'utf8');
  ok(/add column if not exists companions integer not null default 0/.test(migration) && /companions >= 0 and companions <= 500/.test(migration),
    'la migration 0048 ajoute la colonne a defaut 0, bornee comme le code');
  ok((sql.match(/\bcompanions\b/g) || []).length >= 6, 'l insertion et la mise a jour du dossier ecrivent les accompagnants');
}

// ---------------------------------------------------------------------------
// LE FORMULAIRE : navigation commune
// ---------------------------------------------------------------------------
async function versFormules(page, date, pax) {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  await page.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
  await attendre(page, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
  await page.click('#dayBtn');
  const [y, mo] = date.split('-').map(Number);
  const cible = `${cap(MOIS[mo - 1])} ${y}`;
  for (let k = 0; k < 16; k += 1) {
    const titre = await page.evaluate(() => document.querySelector('#calTitle').textContent.trim());
    if (titre === cible) break;
    const [nom, an] = titre.split(' ');
    const courant = Number(an) * 12 + MOIS.indexOf(nom.toLowerCase());
    await page.click(y * 12 + (mo - 1) > courant ? '#calNext' : '#calPrev');
    await attendre(page, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, titre);
  }
  await attendre(page, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, date);
  await page.click(`#calGrid .fg-cal__day[data-date="${date}"]`);
  await attendre(page, () => document.querySelector('#dayPop').hidden, 3000);
  await page.fill('#paxInput', String(pax));
  await page.press('#paxInput', 'Enter');
  await attendre(page, (n) => document.querySelector('#paxInput').value === String(n), 3000, pax);
  await page.click('#goActivities');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000);
  await page.click('#tabFor');
  return attendre(page, () => !document.querySelector('#panelFor').hidden && document.querySelectorAll('#gridFor .fg-card').length > 0, 5000);
}
async function versHeures(page) {
  await page.click('#goHours');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active'), 6000);
  return attendre(page, () => document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone.is-busy'), 12000);
}
function lireVisite(page) {
  return page.evaluate(() => {
    const t = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
    const zone = document.querySelector('#planZone');
    return {
      etapes: [...zone.querySelectorAll('.fg-visit__step')].map((li) => ({ b: t(li.querySelector('b')), titre: t(li.querySelector('span')), detail: t(li.querySelector('small')), detail2: t(li.querySelectorAll('small')[1]), genre: li.className })),
      groupes: [...zone.querySelectorAll('.fg-visit__group')].map(t),
      encadre: Boolean(zone.querySelector('.fg-visit__incl')),
      tete: t(zone.querySelector('.fg-visit__span')),
      parties: t(document.querySelector('.fg-track[data-activity="laser_game"] .fg-parts__note')),
      sous: t(document.querySelector('#hourSub')),
    };
  });
}
// Chaque plage : ses cles, et le compte de ses puces par etat (hors choisie,
// proposee et heures de ses propres parties) : la regle est que l en-tete dise
// exactement ce que cachent les puces.
function lirePlages(page) {
  return page.evaluate(() => [...document.querySelectorAll('.fg-track .fg-period')].map((sec) => {
    const puces = [...sec.querySelectorAll('.fg-chip')];
    const autres = puces.filter((c) => !c.classList.contains('is-on') && !c.classList.contains('is-proposed') && c.dataset.state !== 'wave');
    const n = puces.filter((c) => c.dataset.ok !== 'false').length;
    const btn = sec.querySelector('.fg-period__btn');
    return {
      piste: sec.closest('.fg-track').dataset.activity,
      nom: sec.dataset.period,
      cles: [...sec.querySelectorAll('.fg-period__keys .fg-key')].map((k) => ({ classe: k.className, texte: k.textContent.trim() })),
      dit: (sec.querySelector('.fg-period__dit') || {}).textContent || '',
      shift: autres.filter((c) => c.dataset.state === 'shift').length,
      soft: autres.filter((c) => c.dataset.state === 'soft').length,
      hard: autres.filter((c) => c.dataset.state === 'hard').length,
      n,
      hauteur: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
    };
  }));
}
function plagesCoherentes(plages) {
  const ecarts = [];
  plages.forEach((p) => {
    const a = (m) => p.cles.some((k) => k.classe.includes(`fg-key--${m}`));
    const attendu = { shift: p.shift > 0, soft: p.soft > 0, hard: p.hard > 0, ok: !p.shift && !p.soft && !p.hard && p.n > 0 };
    Object.keys(attendu).forEach((m) => { if (a(m) !== attendu[m]) ecarts.push(`${p.piste}/${p.nom} ${m}: cle ${a(m)} puces ${JSON.stringify({ shift: p.shift, soft: p.soft, hard: p.hard, n: p.n })}`); });
    if (a('shift') && !/d[ée]cale/.test(p.cles.find((k) => k.classe.includes('fg-key--shift')).texte)) ecarts.push(`${p.piste}/${p.nom} mot de la cle shift`);
    if (a('soft') && !/serr/.test(p.cles.find((k) => k.classe.includes('fg-key--soft')).texte)) ecarts.push(`${p.piste}/${p.nom} mot de la cle soft`);
    if (p.shift && !new RegExp(`${p.shift} d[ée]cale`).test(p.dit)) ecarts.push(`${p.piste}/${p.nom} phrase lue « ${p.dit} »`);
  });
  return ecarts;
}

// ---------------------------------------------------------------------------
// [B] [C] LA FORMULE 4, UN SAMEDI, 12 PERSONNES
// ---------------------------------------------------------------------------
async function parcoursF4(browser, mock, largeur) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String((e && e.message) || e)));
  const sortie = { erreurs };
  try {
    sortie.arrive = await versFormules(page, mock.DATE, 12);
    await page.click('#gridFor .fg-card[data-formule="f4"]');
    await page.waitForTimeout(200);
    sortie.heures = await versHeures(page);
    await page.waitForTimeout(400);
    sortie.visite = await lireVisite(page);
    sortie.plagesAvant = await lirePlages(page);
    // Le bowling pose le matin : les heures du laser qui le chevauchent
    // deviennent « decale », dans une plage repliee ou non.
    const pose = await page.evaluate(() => {
      const puce = [...document.querySelectorAll('.fg-track[data-activity="bowling"] .fg-chip')].find((c) => c.dataset.ok !== 'false' && c.dataset.time === '11:00');
      if (!puce) return false;
      puce.click();
      return true;
    });
    sortie.pose = pose;
    await attendre(page, () => !document.querySelector('#hourZone.is-busy') && document.querySelector('.fg-track[data-activity="bowling"] .fg-chip.is-on'), 8000);
    await page.waitForTimeout(400);
    sortie.plagesApres = await lirePlages(page);
  } finally {
    await ctx.close();
  }
  return sortie;
}

function verifierF4(bureau, tel) {
  section('B. LA FORMULE 4 A L ECRAN DES HEURES');
  ok(bureau.arrive && bureau.heures && bureau.erreurs.length === 0, 'MONTAGE le formulaire arrive aux heures de la Formule 4, sans erreur', bureau.erreurs.join(' | '));
  const v = bureau.visite || { etapes: [], compris: [] };
  const laser = v.etapes.filter((e) => /Laser Game/.test(e.titre));
  ok(laser.some((e) => /partie 1 sur 2/.test(e.titre)), 'la 1re partie de laser a son heure et se dit « partie 1 sur 2 »', laser.map((e) => `${e.b} ${e.titre}`).join(' | '));
  // DANS LA FOULEE (Movsar, 2026-09-29 : « met "dans la foulee", pas une
  // heure imposee ») : la 2e partie, sans heure, sous le titre du groupe.
  const suite = v.etapes.filter((e) => /fg-visit__step--suite/.test(e.genre));
  ok((v.groupes || []).some((g) => /^Dans la foulée/.test(g)) && laser.some((e) => /partie 2 sur 2/.test(e.titre) && /fg-visit__step--suite/.test(e.genre) && e.b === '' && /^placée sur place avec l’équipe · environ \d/.test(e.detail)),
    'la 2e partie se joue « dans la foulee », sans heure, placee par l equipe, avec le temps qu elle prend', `${(v.groupes || []).join(' | ')} :: ${laser.map((e) => `[${e.b}] ${e.titre} ${e.detail}`).join(' | ')}`);
  const { getEffectiveFormules } = require('../lib/booking-config');
  const f4 = getEffectiveFormules('libramont').find((f) => f.id === 'f4');
  // Ce que comprend la carte, DANS la visite : chaque mot de la carte a sa
  // ligne ; ce qui a deja sa ligne a heure (bowling, laser) n est pas redit.
  const attenduDansLaFoulee = f4.desc.filter((d) => !/bowling|laser/i.test(d));
  const compris = suite.filter((e) => /fg-visit__step--incl/.test(e.genre)).map((e) => e.titre);
  ok(JSON.stringify(compris) === JSON.stringify(attenduDansLaFoulee) && !v.encadre,
    'ce que comprend la formule se lit DANS la visite, dans les mots de sa carte (minigolf, boissons), sans encadre a part', `${compris.join(' | ')} / attendu ${attenduDansLaFoulee.join(' | ')}`);
  ok(/Partie 2 sans heure : placée sur place avec l’équipe/.test(v.parties) && /Touchez une heure ci-dessous pour la choisir/.test(v.parties),
    'le cadre des parties previent : la 2e sans heure est placee sur place, toucher une heure la choisit', `« ${v.parties} »`);

  section('C. LES PLAGES REPLIEES DISENT CE QU ELLES CACHENT');
  ok(bureau.pose, 'MONTAGE le bowling se pose a 11:00');
  const apres = bureau.plagesApres || [];
  const decalent = apres.filter((p) => p.shift > 0);
  ok(decalent.length > 0, 'MONTAGE une plage du laser contient des heures qui decalent le bowling', apres.map((p) => `${p.piste}/${p.nom}:${p.shift}`).join(' '));
  const ecartsAvant = plagesCoherentes(bureau.plagesAvant || []);
  const ecartsApres = plagesCoherentes(apres);
  ok(ecartsAvant.length === 0 && ecartsApres.length === 0, 'chaque en-tete porte exactement les mots de ses puces (decale, serre, complet), ou « rien ne coince »', ecartsAvant.concat(ecartsApres).slice(0, 4).join(' ; '));
  ok(apres.some((p) => p.nom === 'Matin' && p.cles.some((k) => k.classe.includes('fg-key--shift'))), 'le MATIN dit « decale » quand ses heures decalent le bowling (Movsar : « y a que sur soiree »)',
    apres.filter((p) => p.nom === 'Matin').map((p) => `${p.piste}: ${p.cles.map((k) => k.texte).join(',')}`).join(' | '));
  const hauteurs = (tel.plagesAvant || []).concat(tel.plagesApres || []).map((p) => p.hauteur);
  ok(hauteurs.length > 0 && new Set(hauteurs).size === 1, 'au telephone, tous les en-tetes gardent la meme hauteur, cles ou pas', [...new Set(hauteurs)].join(','));
}

// ---------------------------------------------------------------------------
// [D] LE KIDS FUN DAY, UN MERCREDI, 8 PERSONNES
// ---------------------------------------------------------------------------
async function parcoursKfd(browser, mock, date) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const erreurs = [];
  const demandes = [];
  page.on('pageerror', (e) => erreurs.push(String((e && e.message) || e)));
  page.on('request', (req) => { if (req.url().includes('/api/public-availability') && req.url().includes('formuleId=kfd')) demandes.push(req.url()); });
  const sortie = { erreurs };
  const tiroir = () => page.evaluate(() => {
    const t = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
    const item = document.querySelector('#gridFor .fg-card[data-formule="kfd"]').closest('.fg-grid__item');
    const boite = item.querySelector('.fg-kids');
    return {
      unite: t(item.querySelector('.fg-for__price small')),
      ouvert: item.classList.contains('is-on') && boite ? getComputedStyle(item.querySelector('.fg-card__optin')).visibility === 'visible' : false,
      titre: t(item.querySelector('.fg-card__optlabel')),
      n: t(item.querySelector('.fg-kids__n')),
      adultes: t(item.querySelector('.fg-kids__adults')),
      prix: t(item.querySelector('.fg-kids__prix')),
      moinsOff: Boolean(item.querySelector('[data-kids="-1"]') && item.querySelector('[data-kids="-1"]').disabled),
      plusOff: Boolean(item.querySelector('[data-kids="1"]') && item.querySelector('[data-kids="1"]').disabled),
    };
  });
  try {
    sortie.arrive = await versFormules(page, date, 8);
    await page.click('#gridFor .fg-card[data-formule="kfd"]');
    await page.waitForTimeout(500);
    sortie.depart = await tiroir();
    await page.click('#gridFor [data-kids="-1"]');
    await page.click('#gridFor [data-kids="-1"]');
    await page.waitForTimeout(200);
    sortie.six = await tiroir();
    sortie.heures = await versHeures(page);
    await page.waitForTimeout(300);
    sortie.visiteMidi = await lireVisite(page);
    sortie.demande = demandes[demandes.length - 1] || '';
    const tard = await page.evaluate(() => {
      const puce = [...document.querySelectorAll('.fg-track .fg-chip')].find((c) => c.dataset.time === '16:30');
      if (!puce) return false;
      puce.click();
      return true;
    });
    sortie.tard = tard;
    await page.waitForTimeout(400);
    sortie.visiteTard = await lireVisite(page);
    // Les coordonnees, puis le recapitulatif et l envoi (le mock garde la demande).
    await page.click('#goContact');
    await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 5000);
    await page.fill('#cPrenom', 'Qa');
    await page.fill('#cNom', 'Enfants');
    await page.fill('#cEmail', 'qa@invalid.test');
    await page.fill('#cTel', '0471234567');
    await page.click('#occasions [data-occasion="famille"]');
    await page.check('#cConsent');
    await page.click('#goRecap');
    await attendre(page, () => document.querySelector('.fg-scene[data-scene="recap"].is-active'), 5000);
    await passerLaVitrine(page);
    sortie.recap = await page.evaluate(() => [...document.querySelectorAll('.fg-recap__row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
    mock.dernierePose.body = null;
    await page.click('#confirmBtn');
    await attendre(page, () => document.querySelector('.fg-scene[data-scene="fin"].is-active'), 8000);
    sortie.envoi = mock.dernierePose.body;
  } finally {
    await ctx.close();
  }
  return sortie;
}

function verifierKfd(r) {
  section('D. LE KIDS FUN DAY');
  ok(r.arrive && r.erreurs.length === 0, 'MONTAGE le formulaire arrive aux formules un mercredi, sans erreur', r.erreurs.join(' | '));
  const d = r.depart || {};
  ok(d.unite === 'par enfant', 'la carte dit « par enfant »', `« ${d.unite} »`);
  ok(d.ouvert && /Enfants de 5 à 12 ans/.test(d.titre) && d.n === '8' && d.adultes === 'Aucun adulte accompagnant' && d.plusOff && !d.moinsOff,
    'choisie, elle demande combien d enfants de 5 a 12 ans : tout le groupe par defaut', JSON.stringify(d));
  const s = r.six || {};
  ok(s.n === '6' && s.adultes === '+ 2 adultes qui accompagnent, sans payer la formule' && s.prix === '180 € pour 6 enfants',
    'deux de moins : 6 enfants, 2 adultes qui ne paient pas, 180 EUR pour les enfants', JSON.stringify(s));
  const pax = r.demande ? new URL(r.demande).searchParams.get('pax') : '';
  ok(pax === '6', 'la disponibilite se demande pour les 6 enfants', `pax=${pax}`);
  const midi = r.visiteMidi || { etapes: [], compris: [] };
  const illimiteMidi = midi.etapes.find((e) => /illimit/.test(e.b)) || {};
  ok(/KIDS FUN DAY/.test(illimiteMidi.titre) && /jusqu’à 17:00/.test(illimiteMidi.detail) && /5 h de jeu/.test(illimiteMidi.detail) && /même prix à toute heure/.test(illimiteMidi.detail),
    'arrivee a 12:00 : a volonte jusqu a 17:00, 5 h de jeu, meme prix a toute heure', JSON.stringify(illimiteMidi));
  const tard = (r.visiteTard || { etapes: [] }).etapes.find((e) => /illimit/.test(e.b)) || {};
  ok(r.tard && /30 min de jeu/.test(tard.detail), 'arrivee a 16:30 : l ecran dit 30 min de jeu (plus de visite de 5 h vendue pour 40 min sans le dire)', JSON.stringify(tard));
  ok(/fin de la formule/.test((r.visiteTard || {}).tete || ''), 'l en-tete dit « fin de la formule », pas une heure estimee', `« ${(r.visiteTard || {}).tete} »`);
  const { getEffectiveFormules } = require('../lib/booking-config');
  const kfd = getEffectiveFormules('libramont').find((f) => f.id === 'kfd');
  ok(illimiteMidi.detail2 === kfd.desc.join(' · ') && !midi.encadre, 'ce qu elle comprend : les mots du centre (« toutes les activites illimitees »), sur sa ligne, pas la liste du moteur', `« ${illimiteMidi.detail2} »`);
  ok(/6 enfants \+ 2 adultes/.test(midi.sous || ''), 'le rappel des heures dit « 6 enfants + 2 adultes »', `« ${midi.sous} »`);
  ok((r.recap || []).some((l) => l === '6 enfants + 2 adultes'), 'le recapitulatif aussi', (r.recap || []).join(' | '));
  const e = r.envoi || {};
  ok(Number(e.pax) === 6 && Number(e.companions) === 2 && e.formuleId === 'kfd', 'la demande part avec 6 joueurs et 2 accompagnants', JSON.stringify({ pax: e.pax, companions: e.companions, formuleId: e.formuleId }));
}

// ---------------------------------------------------------------------------
// [E] LA CONSOLE
// ---------------------------------------------------------------------------
async function console_(browser, jour) {
  const { getEffectiveFormules } = require('../lib/booking-config');
  const dossiers = [
    // Une Formule 4 dont la 1re partie de laser est posee et la 2e attend.
    { id: 880001, centerId: 'libramont', channel: 'public', name: 'QA Parties', phone: '+32470000000', email: 'qa@invalid.test', date: jour, startTime: '10:00', duration: 1, totalDuration: 3.5, lanes: [1, 2], laneCount: 2, pax: 12, companions: 0, status: 'pending', validationStatus: 'confirmed', type: 'formule', formuleId: 'f4', label: 'FORMULE 4', price: 468, basePrice: 468, extras: [], program: null,
      opsPlan: { resourceBlocks: [
        { type: 'activity', activityId: 'bowling', resourceType: 'bowling_lane', startTime: '10:00', endTime: '11:00', countIndex: 1, lanes: [1, 2], requiredLanes: 2, players: 12 },
        { type: 'activity', activityId: 'laser_game', resourceType: 'laser_arena', startTime: '11:00', endTime: '11:25', countIndex: 1, groupWaveIndex: 1, groupWaveCount: 1, players: 12 },
      ], laserPassPlan: { mode: 'manual_after_first', totalGames: 2, scheduledGames: 1, remainingGames: 1, scheduledPasses: [{ countIndex: 1, status: 'scheduled', startTime: '11:00' }], pendingPasses: [{ countIndex: 2, status: 'pending' }] } } },
    // Un Kids Fun Day de 6 enfants venus avec 2 adultes.
    { id: 880002, centerId: 'libramont', channel: 'public', name: 'QA Enfants', phone: '+32470000001', email: 'qa2@invalid.test', date: jour, startTime: '12:00', duration: 5, totalDuration: 5, lanes: [], laneCount: 0, pax: 6, companions: 2, status: 'pending', validationStatus: 'confirmed', type: 'formule', formuleId: 'kfd', label: 'KIDS FUN DAY', price: 180, basePrice: 180, extras: [], program: null, opsPlan: { resourceBlocks: [] } },
  ];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, DOSSIERS, FORMULES, JOUR }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'settings.manage', 'direction.view', 'centers.switch'];
    const session = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const J = (p) => {
      const corps = JSON.stringify(p);
      let h = 0;
      for (let i = 0; i < corps.length; i += 1) h = (h * 31 + corps.charCodeAt(i)) | 0;
      return new Response(corps, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${(h >>> 0).toString(36)}` } });
    };
    const natif = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const u = new URL(typeof input === 'string' ? input : (input && input.url) || '', window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: DOSSIERS, laneStatuses: {}, centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: DOSSIERS, emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/public-booking-meta') {
        const r = await natif(input, init);
        const payload = await r.clone().json().catch(() => null);
        if (payload) { payload.formules = FORMULES; payload.today = JOUR; return J(payload); }
        return r;
      }
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {}, blocks: [], centers: [], activities: [] });
      return natif(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session));
  }, { expiresAt, DOSSIERS: dossiers, FORMULES: getEffectiveFormules('libramont'), JOUR: jour });
  try {
    await page.goto(`${BASE_URL}/?v=formules-visite`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.renderStaff === 'function', null, { timeout: 20000 });
    await page.evaluate((jour) => {
      state.currentDate = jour;
      state.staffMenuPage = 'planning';
      state.staffResourceView = 'all';
      state.staffStatusFilter = 'all';
      state.searchTerm = '';
      save();
      setView('staff');
    }, jour);
    await attendre(page, () => document.querySelectorAll('#resList .res-row').length >= 2, 15000);
    // Depuis le 2026-10-01 (cartes de groupe a la caisse), une partie sans
    // heure est une LIGNE du programme de la carte (« Heure à placer ») ; les
    // joueurs se lisent sous le nom, avant les marques (« · Hors planning »).
    const lignes = await page.evaluate(() => [...document.querySelectorAll('#resList .res-row')].map((row) => {
      const n = row.querySelectorAll('.gc-step.is-aplacer').length;
      return {
        nom: (row.querySelector('.res-row-name') || {}).textContent || '',
        joueurs: (((row.querySelector('.gc-who span') || {}).textContent || '').split(' · ')[0] || '').trim(),
        aPlacer: n ? `${n} partie${n > 1 ? 's' : ''} à placer` : '',
      };
    }));
    return { lignes, erreurs };
  } finally {
    await ctx.close();
  }
}

function verifierConsole(r) {
  section('E. LA CONSOLE');
  ok(r.erreurs.length === 0 && r.lignes.length >= 2, 'MONTAGE la liste du jour montre les deux dossiers, sans erreur', r.erreurs.join(' | '));
  const f4 = r.lignes.find((l) => /QA Parties/.test(l.nom)) || {};
  const kfd = r.lignes.find((l) => /QA Enfants/.test(l.nom)) || {};
  ok(f4.aPlacer === '1 partie à placer', 'la Formule 4 dont la 2e partie attend porte « 1 partie a placer » sur sa ligne', `« ${f4.aPlacer} »`);
  ok(!kfd.aPlacer, 'un dossier sans laser n en porte pas', `« ${kfd.aPlacer} »`);
  ok(kfd.joueurs === '6 joueurs + 2 accompagnants' && f4.joueurs === '12 joueurs', 'la ligne dit les joueurs et les accompagnants', `« ${kfd.joueurs} » / « ${f4.joueurs} »`);
}

// ---------------------------------------------------------------------------
// [F] CONTRE-EPREUVES, servies en memoire
// ---------------------------------------------------------------------------
const MUTATIONS = {
  cles: ['      rendreCles(sec, chips, n);\n', ''],
  compris: ["    var carte = formule ? (formule.desc || []).filter(Boolean).map(function (x) { return { texte: String(x), genre: genreCompris(x) }; }) : [];\n", "    var carte = [];\n"],
  enfants: ['      pax: joueursDemandes(),\n', '      pax: state.pax,\n'],
  aPlacer: ['  [...new Set(getPendingLaserPassesForReservation(r).map(unit => Number(unit.countIndex) || 1))]', '  [...new Set([].map(unit => Number(unit.countIndex) || 1))]'],
};
let mutation = '';
function serveur(mock) {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const fichier = url.pathname === '/assets/fungalaxy-booking.js' ? 'fungalaxy-booking.js' : url.pathname === '/assets/app-main.js' ? 'app-main.js' : '';
    if (mutation && fichier) {
      const [avant, apres] = MUTATIONS[mutation];
      const src = fs.readFileSync(path.join(ROOT, 'assets', fichier), 'utf8').replace(/\r\n/g, '\n');
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(src.includes(avant) ? src.replace(avant, apres) : src);
      return;
    }
    base.emit('request', req, res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}
function ancreUnique(fichier, avant) {
  const src = fs.readFileSync(path.join(ROOT, 'assets', fichier), 'utf8').replace(/\r\n/g, '\n');
  return src.split(avant).length === 2;
}

async function contreEpreuves(browser, mock, jourKfd, jourConsole) {
  section('F. CONTRE-EPREUVES');
  const empreintes = ['fungalaxy-booking.js', 'app-main.js'].map((f) => fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8'));
  if (ok(ancreUnique('fungalaxy-booking.js', MUTATIONS.cles[0]), 'contre-epreuve montable : les cles des plages se posent une fois')) {
    mutation = 'cles';
    const r = await parcoursF4(browser, mock, 1440);
    mutation = '';
    ok(plagesCoherentes(r.plagesApres || []).length > 0, 'sans les cles, les plages repliees se taisent : ce gate ROUGIRAIT');
  }
  if (ok(ancreUnique('fungalaxy-booking.js', MUTATIONS.compris[0]), 'contre-epreuve montable : ce que comprend la formule se lit une fois')) {
    mutation = 'compris';
    const r = await parcoursF4(browser, mock, 1440);
    mutation = '';
    ok(!((r.visite || {}).etapes || []).some((e) => /fg-visit__step--incl/.test(e.genre)), 'sans les mots de la carte, le minigolf et les boissons disparaissent de l ecran des heures : ce gate ROUGIRAIT');
  }
  if (ok(ancreUnique('fungalaxy-booking.js', MUTATIONS.enfants[0]), 'contre-epreuve montable : les joueurs de la demande se comptent une fois')) {
    mutation = 'enfants';
    const r = await parcoursKfd(browser, mock, jourKfd);
    mutation = '';
    ok(Number((r.envoi || {}).pax) === 8, 'sans elle, les 8 personnes partent comme joueurs et les adultes paient : ce gate ROUGIRAIT', JSON.stringify(r.envoi && { pax: r.envoi.pax, companions: r.envoi.companions }));
  }
  if (ok(ancreUnique('app-main.js', MUTATIONS.aPlacer[0]), 'contre-epreuve montable : la pastille des parties a placer se decide une fois')) {
    mutation = 'aPlacer';
    const r = await console_(browser, jourConsole);
    mutation = '';
    ok(!((r.lignes.find((l) => /QA Parties/.test(l.nom)) || {}).aPlacer), 'sans elle, la 2e partie de laser ne se voit plus sur la ligne : ce gate ROUGIRAIT');
  }
  const apres = ['fungalaxy-booking.js', 'app-main.js'].map((f) => fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8'));
  ok(apres[0] === empreintes[0] && apres[1] === empreintes[1], 'le depot n a jamais ete touche');
}

// Un mercredi ouvert, hors vacances : le calendrier du VRAI serveur le dit.
async function mercrediOuvert() {
  const corps = await new Promise((resolve, reject) => {
    http.get(`${BASE_URL}/api/public-booking-meta?centerId=libramont&calendar=90`, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; }); res.on('end', () => resolve(b));
    }).on('error', reject);
  });
  const meta = JSON.parse(corps);
  const cal = (meta.center && meta.center.calendar) || meta.calendar || [];
  const liste = Array.isArray(cal) ? cal : (Array.isArray(cal.days) ? cal.days : []);
  const ok3 = liste.find((j) => {
    const d = new Date(`${j.date}T12:00:00Z`);
    return d.getUTCDay() === 3 && j.open && !j.formulaHolidayOff && !j.holiday && j.date > meta.today;
  });
  return ok3 ? ok3.date : '';
}

async function main() {
  const mock = require('./dev-tunnel-server');
  const { chromium } = require('playwright-core');
  const srv = await serveur(mock);
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    const jourKfd = await mercrediOuvert();
    if (!ok(Boolean(jourKfd), 'MONTAGE un mercredi ouvert hors vacances existe dans les 90 jours', jourKfd)) throw new Error('pas de mercredi');
    verifierServeur(jourKfd);
    const bureau = await parcoursF4(browser, mock, 1440);
    const tel = await parcoursF4(browser, mock, 390);
    verifierF4(bureau, tel);
    verifierKfd(await parcoursKfd(browser, mock, jourKfd));
    verifierConsole(await console_(browser, mock.DATE));
    await contreEpreuves(browser, mock, jourKfd, mock.DATE);
  } catch (error) {
    ok(false, `exception : ${error && error.message}`);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${echecs === 0 ? 'formules-visite-check: ALL OK' : `formules-visite-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
