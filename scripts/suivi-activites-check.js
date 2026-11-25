// LE SUIVI DES ACTIVITES : UNE ACTIVITE N EST FAITE QUE COCHEE (2026-11-23).
//
// Le gerant, sur le planning complet et les plannings bowling et laser :
//   « pour bowling laser et tout planning je parle quand c'est une formule ça montre le suivi des
//   activités faites genre par une barre la petite et une fois fini ça les genre met en transparent
//   avec un V pour dire que c fait bah pourquoi pas faire la même pour tout ? » ;
//   « pour planning complet j'ai l'impression que ça barre les activités tout seul quand on met un
//   groupe arrivé et qu'il est l'heure de son activité mais non faut cocher tout le temps
//   manuellement prcq sinon on sait pas voir si c lancé ou pas par les students » ;
//   « ça serait cool que ça distingue les activités de la formule et activité en plus qu'il a et
//   aussi les sur mesure [...] ça doit taper à l'œil et pareil pour note équipe et note client
//   [...] mais ça doit pas prendre trop de place ».
// La vraie console (scripts/comptoir-banc.js : planning-v3-fixtures, le samedi « pic » du 16 janvier
// 2027 a 15:10, 1366 x 768) ; ses coches partent au VRAI handler api/staff-reservations.js, sur la
// base en memoire de scripts/reserver-banc.js (aucune base reelle, aucun reseau). La journee : le
// samedi tel quel, sans aucune coche, plus quatre dossiers retouches :
//   Arthur (1600)  Formule 3, arrive : son bowling de 13:30 est passe, son minigolf de 14:35 court,
//                  un bowling EN PLUS a 16:30 (piste 7) et un duckpin EN PLUS a 17:30, un mot du
//                  client et une note de l equipe ;
//   Club U12 (1616) A LA CARTE, arrive : bowling 14:00, deux parties de laser (13:00, 13:30), arcades ;
//   Gérard (1619)  SUR MESURE (formule du comptoir), son extra « Pizza margherita × 6 » ;
//   Inès (1608)    Formule 7 payee, sa visite finie : le groupe est reparti.
//   [A] L HEURE NE COCHE RIEN : au planning complet, aucune case barree ni cochee sans coche, la
//       case passee sans coche « pas encore cochée » (case vide devant l heure), celle qui court « à
//       lancer », le groupe reparti sans coche ni l un ni l autre ; la carte bowling passee d un
//       groupe sur place ne grise pas et attend sa coche ; au planning laser, ses parties jouees
//       gardent leur teinte et attendent ; la fiche dit « Non coché », jamais « Fini » ;
//   [B] COCHER, POUR DE VRAI : de vrais clics (la ligne, la case de la fiche, Fermer) ; le serveur
//       ecrit la coche ; la case passe barree avec sa coche, la carte bowling grise et sa jauge se
//       remplit ; tout coche, la carte et le groupe du planning laser passent en transparent avec ✓ ;
//   [C] LE SUIVI POUR TOUS : la jauge sur la carte bowling d une reservation a la carte, sur mesure,
//       en formule avec ses activites en plus, autant de segments que de cases a cocher du programme ;
//       la fiche a une case par activite (a la carte, sur mesure, formule et en plus, acces
//       illimite) ; le planning laser montre la jauge ;
//   [D] FORMULE, EN PLUS, SUR MESURE : la case d une activite en plus porte un « + » et le dit dans
//       sa bulle, celles de la formule non, aucune autre ligne ; le « + » reste dans sa case ; le sur
//       mesure a son etiquette cerclee et sa rubrique pleine ;
//   [E] LES NOTES TAPENT A L OEIL SANS PRENDRE DE PLACE : client, equipe et sur mesure sur un fond
//       leger de leur teinte, un liseré, trois teintes distinctes, l etiquette pleine a 4,5:1, deux
//       lignes au plus ;
//   [F] LA LEGENDE du menu « ⋯ » dit « à lancer », « fait », « en plus », plus « en cours » ;
//   [G] AU TELEPHONE (390 px) : le « + » se voit, aucune case vide, rien ne deborde ;
//   [J] aucune erreur JS.
// --contre-preuves : chaque regle retiree (au code servi, en memoire ; le disque n est jamais touche)
// a son ancre une fois et une seule, puis fait rougir sa lettre : la coche automatique remise, la
// carte bowling grise d office, le depart laser joue gris d office, la fiche qui dit « Fini », la
// planche qui ignore la coche, le suivi reserve aux formules, « en plus » non distingue ou invisible,
// le sur mesure sans sa rubrique pleine, les notes sans fond, la case vide revenue (2026-11-25, elle est partie).
//   SA_MUTATIONS : un sous-ensemble (noms separes par des virgules) ; SA_BAVARD : le detail des
//   contre-preuves.
'use strict';
const fs = require('fs');
const path = require('path');

const C = require('./comptoir-banc.js');
const { chromium } = require('playwright-core');

const { B, FX, ROOT, BROWSER_PATH } = C;
// 5236 : aucun autre gate ne le prend.
const PORT = Number(process.env.PINLANE_SUIVI_ACTIVITES_PORT || 5236);
const APP = 'assets/app-main.js';
const PG = 'assets/pinlane-planning-global.js';
const PGC = 'assets/pinlane-planning-global.css';
const CSS = 'assets/pinlane-staff.css';
// SA_CAPTURES=<dossier> : en plus des verifications, des images brutes de la vraie console (pour montrer le
// resultat a quelqu un qui ne lit pas le code ; jamais une preuve, les preuves sont les « ok » ci-dessus).
const CAPTURES = process.env.SA_CAPTURES || '';
async function capturer(page, nom, selecteur, garder = null) {
  if (!CAPTURES) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  if (garder) {
    // (des lignes choisies, chacune photographiee a part : masquer les autres casserait la mise en page du tableau)
    const morceaux = [page.locator('#globalPlanningGridWrap thead tr, #globalPlanningGridWrap .gf-tete').first(), ...garder.ids.map((id) => page.locator(`${garder.lignes}[data-gf-id="${id}"]`))];
    for (let i = 0; i < morceaux.length; i += 1) await morceaux[i].screenshot({ path: path.join(CAPTURES, `${nom}.${i}.png`) });
    return;
  }
  await FX.repos(page, 200);
  await page.locator(selecteur).first().screenshot({ path: path.join(CAPTURES, nom) });
}
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);
const ARTHUR = 1600;
const CLUB = 1616;
const GERARD = 1619;
const INES = 1608;
const LEJEUNE = 1633;
const MATIN = 1609;

let echecs = 0;
let silence = false;
const rouges = [];
class Mordu extends Error {}
let mutation = null;
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 900)}` : ''}`);
  if (!cond && mutation && label.startsWith(`[${mutation.lettre}]`)) throw new Mordu(label);
  return cond;
}
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel) t = t.replace(ed.de, () => ed.vers);
  return t;
}

// ---------------------------------------------------------------------------
// LA JOURNEE : le samedi « pic », sans marque de demonstration, et quatre dossiers retouches.
// ---------------------------------------------------------------------------
const NOTE_DEMO = /\[DEMO-JOURS[^\]]*\][^\n]*/g;
const enMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
const enHeure = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function blocEnPlus(modele, activityId, debut, minutes, extra = {}) {
  const s = enMin(debut);
  return { ...modele, activityId, label: extra.label || modele.label, start: s, end: s + minutes, startTime: debut, endTime: enHeure(s + minutes), durationMinutes: minutes, enPlus: true, ...extra };
}
function journee() {
  const fx = FX.lireFixture('pic');
  const jour = fx.staffState.date;
  const tous = JSON.parse(JSON.stringify(fx.staffState.reservations)).map((r) => ({
    ...r, name: String(r.name || '').replace(/^DÉMO · /, ''), notes: String(r.notes || '').replace(NOTE_DEMO, '').trim(), activityProgress: {},
  }));
  const par = (id) => tous.find((r) => r.id === id);
  const equipe = (t, par2, heure) => `[equipe] ${JSON.stringify({ t, par: par2, le: FX.instant(jour, heure).toISOString() })}`;
  // ARTHUR : la Formule 3 telle quelle, deux activites en plus a cote (la forme de lib/formule-en-plus.js,
  // fusionnerLesEnPlus : leurs blocs marques `enPlus`, leurs lignes dans opsPlan.enPlus).
  const arthur = par(ARTHUR);
  const bowling = arthur.opsPlan.resourceBlocks.find((b) => b.resourceType === 'bowling_lane');
  const bowlingEnPlus = blocEnPlus(bowling, 'bowling', '16:30', 60, { lanes: [7], requiredLanes: 1, countIndex: 2 });
  const duckpin = { type: 'activity', activityId: 'duckpin_bowling', label: 'Duckpin Bowling', startTime: '17:30', endTime: '18:30', start: enMin('17:30'), end: enMin('18:30'), countIndex: 1, flexible: false, enPlus: true };
  arthur.opsPlan.resourceBlocks = [...arthur.opsPlan.resourceBlocks, bowlingEnPlus];
  arthur.opsPlan.timeline = [...arthur.opsPlan.timeline, { ...bowlingEnPlus }, duckpin];
  arthur.opsPlan.endTime = '18:35';
  arthur.opsPlan.enPlus = { prix: 102, complet: true, items: [
    { activityId: 'bowling', name: 'Bowling', participants: arthur.pax, duration: 1, heure: '16:30', price: 54, priceKnown: true },
    { activityId: 'duckpin_bowling', name: 'Duckpin Bowling', participants: arthur.pax, duration: 1, heure: '17:30', price: 48, priceKnown: true },
  ] };
  arthur.lanes = [3, 4, 7];
  arthur.notes = ['Gâteau au frigo du bar, bougies 9 et 10.', equipe('Papa paie à la fin, par carte', 'Julie', '13:25')].join('\n');
  // LE CLUB : a la carte, pointe arrive.
  par(CLUB).status = 'arrived';
  // GERARD : une formule du comptoir (lib/formule-comptoir.js), son extra et le mot du client.
  const gerard = par(GERARD);
  gerard.label = 'Formule sur mesure';
  gerard.program = { ...gerard.program, formuleSurMesure: { nom: 'Anniversaire pirate', prixParPersonne: 24 } };
  gerard.extras = [{ id: 'pz', name: 'Pizza margherita × 6', price: 54 }];
  gerard.notes = 'Deux enfants végétariens.';
  return tous;
}

// La console au comptoir, sur cette journee : la base du banc et la page voient les memes dossiers.
async function ouvrir(browser, { appareil = 'comptoir' } = {}) {
  const dossiers = journee();
  const serveur = C.monterServeur();
  const m = await C.ouvrirConsole(browser, serveur, { port: PORT, role: 'direction', appareil, reservations: () => dossiers });
  await m.page.evaluate((jour) => {
    const fx = window.__FIXTURE__;
    fx.jours[fx.jour] = jour.map((x) => JSON.parse(JSON.stringify(x)));
    state.reservations = jour.map((x) => JSON.parse(JSON.stringify(x)));
    renderStaff();
  }, dossiers);
  await FX.repos(m.page, 400);
  return { ...m, serveur };
}
async function avec(browser, lettre, o, corps) {
  const m = await ouvrir(browser, o);
  try {
    await corps(m.page, m);
    ok(m.erreurs.length === 0, `[J] aucune erreur de page (${lettre})`, m.erreurs.slice(0, 3));
  } finally { await m.ctx.close(); }
}
const aller = async (page, vue) => { await page.locator({ all: '#staffTabAll', bowling: '#staffTabBowling', laser: '#staffTabLaser' }[vue]).click(); await FX.repos(page, 250); };

// ---------------------------------------------------------------------------
// CE QUI SE LIT DANS LA PAGE.
// ---------------------------------------------------------------------------
// Une case du planning complet : son etat, sa case vide, sa coche, son trait, son « + ».
const lireCases = (page, id) => page.evaluate((rid) => {
  const vu = (el) => Boolean(el) && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  const tr = document.querySelector(`#globalPlanningGridWrap tr.gf-r[data-gf-id="${rid}"]`);
  if (!tr) return null;
  return Array.from(tr.querySelectorAll('td.gf-a .gf-x')).map((x) => {
    const t = x.querySelector('.gf-x__t');
    const td = x.closest('td');
    const plus = x.querySelector('.gf-x__plus');
    const rp = plus && plus.getBoundingClientRect();
    const rt = td.getBoundingClientRect();
    return {
      col: td.getAttribute('data-gf-titre'),
      heure: t ? t.textContent.trim() : x.textContent.trim(),
      etat: (x.className.match(/\bis-(fini|clos|lancer|acocher|avenir|retard|aplacer)\b/) || [])[1] || '',
      enPlus: x.classList.contains('is-en-plus'),
      // (la case vide devant l heure est partie le 2026-11-25 : tout dessin de plus que la coche et le « + » rougit)
      vide: Boolean(x.querySelector('.gf-x__ac, .gf-x__attend, svg:not(.gf-x__ok)')),
      coche: vu(x.querySelector('.gf-x__ok')),
      trait: Boolean(t) && getComputedStyle(t, '::after').content !== 'none',
      barre: Boolean(t) && /line-through/.test(getComputedStyle(t).textDecorationLine),
      // (le « + » est dessine par la feuille de style : la pastille ne dit que son heure)
      plus: vu(plus) ? getComputedStyle(plus, '::before').content.replace(/"/g, '') : '',
      plusDedans: !rp || (rp.right <= rt.right + 0.5 && rp.top >= rt.top - 0.5 && rp.left >= rt.left - 0.5),
      bulle: x.getAttribute('title') || '',
      cerne: t ? getComputedStyle(t).boxShadow : '',
    };
  });
}, id);
const caseA = (cases, col, heure) => (cases || []).find((c) => c.col === col && c.heure.includes(heure));

// Une carte du planning bowling.
const lireCartes = (page, id) => page.evaluate((rid) => Array.from(document.querySelectorAll(`#planningGridWrap .booking[data-booking-res-id="${rid}"]`)).map((c) => ({
  start: Number(c.getAttribute('data-booking-start')),
  aCocher: c.classList.contains('is-a-cocher'),
  passee: c.classList.contains('is-passee'),
  complete: c.classList.contains('activities-complete'),
  opacite: Number(getComputedStyle(c).opacity),
  coin: getComputedStyle(c, '::after').content,
  vide: getComputedStyle(c.querySelector('.bk-time') || c, '::before').content,
  cerne: getComputedStyle(c).boxShadow,
  aria: c.getAttribute('aria-label') || '',
  segments: c.querySelectorAll('.activity-pill .activity-seg').length,
  pleins: c.querySelectorAll('.activity-pill .activity-seg.on').length,
  jauge: Boolean(c.querySelector('.activity-pill')),
})), id);

// Un groupe du planning laser, partie par partie.
const lireLaser = (page, id) => page.evaluate((rid) => Array.from(document.querySelectorAll(`#laserPlanningGridWrap .lp-g[data-laser-res-id="${rid}"]`)).map((g) => {
  const dep = g.closest('.lp-dep');
  return {
    t: dep ? Number(dep.getAttribute('data-lp-t')) : null,
    joue: Boolean(dep && dep.classList.contains('is-joue')),
    aCocher: g.classList.contains('is-a-cocher'),
    coche: g.classList.contains('is-coche'),
    complete: g.classList.contains('activities-complete'),
    opacite: Number(getComputedStyle(g).opacity),
    teinte: getComputedStyle(g).getPropertyValue('--lp-c').trim(),
    gris: getComputedStyle(g).getPropertyValue('--lp-line-strong').trim(),
    repere: getComputedStyle(g.querySelector('.lp-g__nom'), '::before').content,
    jauge: g.querySelectorAll('.activity-pill .activity-seg').length,
    titre: g.getAttribute('title') || '',
  };
}), id);

// Le programme d un dossier, tel que la fiche le coche (getGroupeProgramme), et sa fiche ouverte d un clic.
const programme = (page, id) => page.evaluate((rid) => {
  const r = state.reservations.find((x) => Number(x.id) === rid);
  return r ? getGroupeProgramme(r).filter((e) => e.coche).map((e) => ({ cle: e.coche, nom: e.nom, fait: Boolean(e.fait), enPlus: Boolean(e.enPlus) })) : null;
}, id);
async function ouvrirFiche(page, id) {
  await aller(page, 'all');
  await page.locator(`#globalPlanningGridWrap tr.gf-r[data-gf-id="${id}"] .gf-nom__t`).click();
  await page.waitForSelector('#posOverlay:not(.hidden) .fx-programme', { timeout: 10000 });
  await FX.repos(page, 200);
}
async function fermerFiche(page) {
  await page.locator('#posOverlay .close-btn').first().click();
  await page.waitForFunction(() => document.getElementById('posOverlay').classList.contains('hidden'), null, { timeout: 8000 });
  await FX.repos(page, 200);
}
const lireFiche = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#posOverlay .fx-programme .gc-step')).map((li) => ({
  quoi: (li.querySelector('.gc-step-what b') || {}).textContent || '',
  etat: ((li.querySelector('.gc-step-state') || {}).textContent || '').trim(),
  case: Boolean(li.querySelector('button.gc-check')),
  cle: ((li.querySelector('button.gc-check') || { getAttribute: () => '' }).getAttribute('data-pl-focus') || '').split('.').slice(3).join('.'),
})));

// ---------------------------------------------------------------------------
// LA LECTURE : [A] [C] [D] [E] [F], sans un geste qui ecrit.
// ---------------------------------------------------------------------------
async function lecture(browser) {
  await avec(browser, 'lecture', {}, async (page) => {
    // [A] LE PLANNING COMPLET A 15:10
    const tout = await page.evaluate(() => ({
      faites: document.querySelectorAll('#globalPlanningGridWrap .gf-x.is-fini').length,
      cochees: Array.from(document.querySelectorAll('#globalPlanningGridWrap .gf-x__ok')).filter((x) => x.getClientRects().length).length,
      attendues: document.querySelectorAll('#globalPlanningGridWrap .gf-x:is(.is-lancer, .is-acocher)').length,
      coches: state.reservations.filter((r) => getGroupeProgramme(r).some((e) => e.fait)).length,
      lignes: document.querySelectorAll('#globalPlanningGridWrap tr.gf-r').length,
    }));
    ok(tout.lignes > 40 && tout.coches === 0, '[A] le montage : le samedi a 15:10, aucune activite cochee', tout);
    ok(tout.faites === 0 && tout.cochees === 0, '[A] aucune case barree ni cochee sans coche : l heure ne coche rien', tout);
    ok(tout.attendues >= 3, '[A] les activites dont l heure est venue, groupe sur place, attendent leur coche', tout);
    const arthur = await lireCases(page, ARTHUR);
    const passe = caseA(arthur, 'Bowling', '13:30');
    ok(Boolean(passe) && passe.etat === 'acocher' && !passe.vide && !passe.coche && !passe.trait && !passe.barre && /1\.5px/.test(passe.cerne) && /pas encore coché/.test(passe.bulle),
      '[A] Arthur, son bowling de 13:30 passe sans coche : la pastille cernee, la bulle « pas encore coché », ni petit carre, ni trait, ni coche', passe);
    const court = caseA(arthur, 'Minigolf', '14:35');
    ok(Boolean(court) && court.etat === 'lancer' && !court.vide && !court.trait && /à lancer, pas encore coché/.test(court.bulle) && /1\.5px/.test(court.cerne),
      '[A] Arthur, son minigolf de 14:35 court sans coche : la bulle « à lancer », la pastille cerclee, sans petit carre', court);
    const ines = await lireCases(page, INES);
    ok(Array.isArray(ines) && ines.length > 0 && ines.every((c) => c.etat === 'clos' && !c.vide && !c.coche && !c.trait && !c.barre),
      '[A] Ines, payee et repartie, sans coche : ses cases grises, ni case vide, ni coche, ni trait', ines);
    // La carte bowling d un groupe sur place, passee sans coche : elle ne grise pas, elle attend.
    await aller(page, 'bowling');
    const cartes = await lireCartes(page, ARTHUR);
    const formule = cartes.filter((c) => Math.abs(c.start - 13.5) < 0.01);
    ok(formule.length === 2 && formule.every((c) => c.aCocher && !c.passee && /2px/.test(c.cerne) && c.vide === 'none' && /pas encore coché/.test(c.aria)),
      '[A] bowling : les cartes passees d Arthur (pistes 3 et 4) attendent leur coche, cernees, sans petit carre devant l heure, pas grisees', formule);
    // Le planning laser : les parties jouees du club, sur place, gardent leur teinte et attendent.
    await aller(page, 'laser');
    const laser = await lireLaser(page, CLUB);
    ok(laser.length === 2 && laser.every((g) => g.joue && g.aCocher && !g.coche && g.teinte && g.teinte !== g.gris && g.repere === 'none' && /pas encore coché/.test(g.titre)),
      '[A] laser : les deux parties jouees du club attendent leur coche, a leur teinte, pas grises, sans petit carre devant le nom', laser);
    // La fiche dit « Non coché », jamais « Fini » ni « En cours ».
    await ouvrirFiche(page, CLUB);
    const fiche = await lireFiche(page);
    const passees = fiche.filter((e) => /Bowling|Laser/.test(e.quoi));
    ok(passees.length === 3 && passees.every((e) => e.etat === 'Non coché') && !fiche.some((e) => /^(Fini|En cours)/.test(e.etat)),
      '[A] la fiche du club (a la carte) : ses activites passees disent « Non coché », aucune « Fini » ni « En cours »', fiche);
    await fermerFiche(page);

    // [C] LE SUIVI POUR TOUS : la jauge, une case par activite.
    await aller(page, 'bowling');
    for (const [id, quoi] of [[CLUB, 'a la carte'], [LEJEUNE, 'a la carte, attendu'], [GERARD, 'sur mesure'], [ARTHUR, 'formule et ses activites en plus']]) {
      const p = await programme(page, id);
      const c = await lireCartes(page, id);
      ok(Array.isArray(p) && p.length > 0 && c.length > 0 && c.every((x) => x.jauge && x.segments === p.length && x.pleins === 0),
        `[C] bowling : la carte de ${id} (${quoi}) porte la jauge, un segment par case du programme (${p ? p.length : '?'})`, { programme: p, cartes: c.map((x) => ({ seg: x.segments, on: x.pleins })) });
    }
    await aller(page, 'laser');
    const jauge = await lireLaser(page, CLUB);
    ok(jauge.length === 2 && jauge.every((g) => g.jauge === 4), '[C] laser : le club (a la carte) montre sa jauge, quatre cases', jauge);
    for (const [id, quoi] of [[CLUB, 'a la carte'], [GERARD, 'sur mesure'], [ARTHUR, 'formule et en plus'], [MATIN, 'acces illimite']]) {
      await ouvrirFiche(page, id);
      const f = await lireFiche(page);
      const p = await programme(page, id);
      ok(Array.isArray(p) && p.length > 0 && f.length === p.length && f.every((e) => e.case) && p.every((e) => f.some((x) => x.cle === e.cle)),
        `[C] la fiche de ${id} (${quoi}) : une case a cocher par activite du programme (${p ? p.length : '?'})`, { fiche: f, programme: p });
      if (id === ARTHUR) ok(p.filter((e) => e.enPlus).length === 2, '[C] la fiche d Arthur : ses deux activites en plus ont leur case', p);
      await fermerFiche(page);
    }

    // [D] FORMULE, EN PLUS, SUR MESURE
    await aller(page, 'all');
    const a = await lireCases(page, ARTHUR);
    const deLaFormule = caseA(a, 'Bowling', '13:30');
    const enPlus = caseA(a, 'Bowling', '16:30');
    const duck = caseA(a, 'Duckpin', '17:30');
    ok(Boolean(enPlus) && enPlus.enPlus && enPlus.plus === '+' && enPlus.heure === '16:30' && /en plus de la formule/.test(enPlus.bulle) && enPlus.plusDedans,
      '[D] Arthur : le bowling en plus de 16:30 porte son « + » (sa pastille ne dit que l heure), sa bulle dit « en plus de la formule », le « + » reste dans sa case', enPlus);
    ok(Boolean(duck) && duck.enPlus && duck.plus === '+' && /en plus de la formule/.test(duck.bulle), '[D] Arthur : le duckpin en plus de 17:30 se voit, avec son « + »', duck);
    ok(Boolean(deLaFormule) && !deLaFormule.enPlus && !deLaFormule.plus && a.filter((c) => !c.enPlus).every((c) => !c.plus), '[D] Arthur : les activites de la formule ne portent pas de « + »', a);
    const ailleurs = await page.evaluate(() => Array.from(document.querySelectorAll('#globalPlanningGridWrap tr.gf-r')).filter((tr) => tr.querySelector('.gf-x.is-en-plus, .gf-x__plus')).map((tr) => tr.getAttribute('data-gf-id')));
    ok(ailleurs.length === 1 && ailleurs[0] === String(ARTHUR), '[D] aucune autre ligne ne porte de « + »', ailleurs);
    const mesure = await page.evaluate((rid) => {
      const tr = document.querySelector(`#globalPlanningGridWrap tr.gf-r[data-gf-id="${rid}"]`);
      const f = tr && tr.querySelector('.gf-formule');
      const r = tr && tr.querySelector('.gf-i--mesure');
      const mot = r && r.querySelector('.gf-i__mot');
      return f ? { formule: f.textContent.trim(), mesure: f.classList.contains('is-mesure'), cerne: getComputedStyle(f).boxShadow, rubrique: Boolean(r), note: Boolean(r && r.classList.contains('gf-i--note')), mot: mot ? mot.textContent : '', texte: r ? r.textContent : '', fondMot: mot ? getComputedStyle(mot).backgroundColor : '' } : null;
    }, GERARD);
    ok(Boolean(mesure) && mesure.formule === 'Sur mesure' && mesure.mesure && /1\.5px/.test(mesure.cerne), '[D] Gerard : « Sur mesure » se lit dans la colonne Formule, cerne de 1,5 px', mesure);
    ok(Boolean(mesure) && mesure.rubrique && mesure.note && mesure.mot === 'Sur mesure' && /6 × Pizza margherita/.test(mesure.texte) && !/rgba\(0, 0, 0, 0\)/.test(mesure.fondMot),
      '[D] Gerard : la rubrique « Sur mesure » a son etiquette pleine, son texte a la suite', mesure);

    // [E] LES NOTES (et le sur mesure) TAPENT A L OEIL SANS PRENDRE DE PLACE
    const notes = await page.evaluate(([idA, idG]) => {
      const rgb = (s) => (String(s).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const lum = (c) => { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const ratio = (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const lire = (id, cle) => {
        const tr = document.querySelector(`#globalPlanningGridWrap tr.gf-r[data-gf-id="${id}"]`);
        const d = tr && tr.querySelector(`.gf-i--${cle}`);
        if (!d) return null;
        const s = getComputedStyle(d);
        const mot = d.querySelector('.gf-i__mot');
        const p = d.querySelector('p');
        const portee = document.createRange();
        portee.selectNodeContents(p);
        const hauts = Array.from(portee.getClientRects()).map((x) => x.top).sort((a, b) => a - b);
        return {
          fond: s.backgroundColor, fondLigne: getComputedStyle(tr.querySelector('td.gf-nom')).backgroundColor, page: getComputedStyle(document.body).backgroundColor,
          liseré: parseFloat(s.borderLeftWidth), teinte: s.borderLeftColor, poids: Number(getComputedStyle(p).fontWeight),
          etiquette: mot ? ratio(getComputedStyle(mot).color, getComputedStyle(mot).backgroundColor) : 0,
          lignes: hauts.filter((t, i) => i === 0 || t - hauts[i - 1] > 6).length, hauteur: d.getBoundingClientRect().height, ligne: parseFloat(getComputedStyle(p).lineHeight),
        };
      };
      return { client: lire(idA, 'client'), equipe: lire(idA, 'equipe'), mesure: lire(idG, 'mesure') };
    }, [ARTHUR, GERARD]);
    const vides = (c) => !c || /rgba\(0, 0, 0, 0\)|transparent/.test(c);
    const trois = [notes.client, notes.equipe, notes.mesure];
    ok(trois.every(Boolean), '[E] le montage : Arthur a un mot du client et une note de l equipe, Gerard son sur mesure', notes);
    ok(trois.every((n) => n && !vides(n.fond) && n.fond !== (vides(n.fondLigne) ? n.page : n.fondLigne) && n.liseré >= 3),
      '[E] client, equipe et sur mesure : un fond leger de leur teinte, un liseré de 3 px', notes);
    ok(new Set(trois.map((n) => n && n.teinte)).size === 3 && new Set(trois.map((n) => n && n.fond)).size === 3, '[E] trois teintes distinctes : on sait laquelle on lit', trois.map((n) => n && n.teinte));
    ok(trois.every((n) => n && n.etiquette >= 4.5 && n.poids >= 550), '[E] l etiquette pleine se lit a 4,5:1, le texte un cran plus gras', trois.map((n) => n && { etiquette: n.etiquette.toFixed(2), poids: n.poids }));
    ok(trois.every((n) => n && n.lignes <= 2 && n.hauteur <= 2 * n.ligne + 8), '[E] deux lignes au plus, quelques pixels de plus seulement', trois.map((n) => n && { lignes: n.lignes, hauteur: n.hauteur }));

    // [F] LA LEGENDE DU MENU « ⋯ »
    await page.locator('#planningPlus').click();
    await FX.repos(page, 200);
    const leg = await page.evaluate(() => { const l = document.querySelector('.staff-action-popover .gf-legende-menu'); return l ? l.textContent.replace(/\s+/g, ' ').trim() : ''; });
    ok(/à lancer : pas encore coché/.test(leg) && /fait : coché/.test(leg) && /en plus de la formule/.test(leg) && !/en cours/.test(leg), '[F] la legende dit « à lancer », « fait », « en plus », plus « en cours »', leg);
    await page.keyboard.press('Escape');
    await aller(page, 'all');
    await capturer(page, 'brut-pas-de-coche-auto.png', '#globalPlanningGridWrap', { lignes: '#globalPlanningGridWrap tr.gf-r', ids: [ARTHUR, CLUB, INES] });
    await capturer(page, 'brut-lisible.png', '#globalPlanningGridWrap', { lignes: '#globalPlanningGridWrap tr.gf-r', ids: [ARTHUR, GERARD] });
  });
}

// ---------------------------------------------------------------------------
// [B] COCHER, POUR DE VRAI : la ligne, la case de la fiche, Fermer.
// ---------------------------------------------------------------------------
async function cocher(page, m, id, cle) {
  const avant = m.journal.length;
  await page.locator(`#posOverlay button.gc-check[data-pl-focus="fiche.activite.${id}.${cle}"]`).click();
  await page.waitForFunction(([rid, k]) => { const r = state.reservations.find((x) => Number(x.id) === rid); return Boolean(r && r.activityProgress && r.activityProgress[k] && r.activityProgress[k].done); }, [id, cle], { timeout: 8000 }).catch(() => null);
  await page.waitForFunction(() => !document.querySelector('[data-pl-anim]'), null, { timeout: 4000 }).catch(() => null);
  await FX.repos(page, 300);
  return m.journal.slice(avant).filter((j) => j.m === 'PATCH' && j.corps && j.corps.activityToggle && j.corps.activityToggle.key === cle);
}
async function scenarioCocher(browser) {
  await avec(browser, 'cocher', {}, async (page, m) => {
    await ouvrirFiche(page, CLUB);
    const envoi = await cocher(page, m, CLUB, 'bowling-1');
    const enBase = () => { const ligne = B.base.reservations.get(CLUB); const p = ligne && ligne.activity_progress; return typeof p === 'string' ? JSON.parse(p) : (p || {}); };
    ok(envoi.length === 1 && envoi[0].corps.activityToggle.done === true, '[B] la case du bowling part au serveur : une coche, celle-la', envoi.map((j) => j.corps));
    ok(Boolean(enBase()['bowling-1'] && enBase()['bowling-1'].done), '[B] le serveur l ecrit en base : bowling-1 fait', enBase());
    await fermerFiche(page);
    const cases = await lireCases(page, CLUB);
    const b = caseA(cases, 'Bowling', '14:00');
    ok(Boolean(b) && b.etat === 'fini' && b.coche && b.trait && !b.vide, '[B] planning complet : le bowling coche passe barre, sa coche devant l heure', b);
    ok(cases.filter((c) => c.col === 'Laser').every((c) => c.etat === 'acocher'), '[B] les parties de laser, pas cochees, attendent toujours', cases);
    await aller(page, 'bowling');
    const cartes = await lireCartes(page, CLUB);
    ok(cartes.length === 2 && cartes.every((c) => !c.aCocher && c.passee && c.segments === 4 && c.pleins === 1 && !c.complete), '[B] bowling : la carte cochee grise, sa jauge a un segment plein sur quatre', cartes);
    // Le reste, d un toucher chacun : le dossier entier coche.
    const p = await programme(page, CLUB);
    await ouvrirFiche(page, CLUB);
    for (const e of p.filter((x) => !x.fait)) await cocher(page, m, CLUB, e.cle);
    await fermerFiche(page);
    ok(p.every((e) => enBase()[e.cle] && enBase()[e.cle].done), '[B] chaque coche est en base', { attendu: p.map((e) => e.cle), base: Object.keys(enBase()) });
    await aller(page, 'bowling');
    const finies = await lireCartes(page, CLUB);
    await capturer(page, 'brut-barre.png', '#planningGridWrap');
    ok(finies.length === 2 && finies.every((c) => c.complete && c.opacite < 0.8 && /✓/.test(c.coin) && c.pleins === 4), '[B] tout coche : la carte bowling passe en transparent avec ✓, sa jauge pleine', finies);
    await aller(page, 'laser');
    const groupes = await lireLaser(page, CLUB);
    ok(groupes.length === 2 && groupes.every((g) => g.coche && !g.aCocher && g.complete && g.opacite < 0.8 && g.repere !== 'none' && /· fait/.test(g.titre)), '[B] tout coche : au planning laser, chaque partie dit « fait », le groupe en transparent', groupes);
    await aller(page, 'all');
    const toutes = await lireCases(page, CLUB);
    ok(toutes.length >= 3 && toutes.every((c) => c.etat === 'fini' && !c.vide), '[B] planning complet : chaque case du club est faite, aucune n attend plus', toutes);
  });
}

// ---------------------------------------------------------------------------
// [G] AU TELEPHONE
// ---------------------------------------------------------------------------
async function telephone(browser) {
  await avec(browser, 'telephone', { appareil: 'telephone' }, async (page) => {
    await page.evaluate((rid) => { const tr = document.querySelector(`#globalPlanningGridWrap tr.gf-r[data-gf-id="${rid}"]`); if (tr) tr.scrollIntoView({ block: 'center' }); }, ARTHUR);
    await FX.repos(page, 200);
    const t = await page.evaluate((rid) => {
      const tr = document.querySelector(`#globalPlanningGridWrap tr.gf-r[data-gf-id="${rid}"]`);
      const vides = tr ? Array.from(tr.querySelectorAll('.gf-x:is(.is-lancer, .is-acocher)')) : [];
      const plus = tr ? Array.from(tr.querySelectorAll('.gf-x__plus')).filter((x) => x.getClientRects().length) : [];
      return { attendues: vides.length, vides: vides.filter((x) => x.querySelector('.gf-x__ac, .gf-x__attend, svg:not(.gf-x__ok)')).length, plus: plus.length, page: document.scrollingElement.scrollWidth, iw: innerWidth, carte: tr ? Math.round(tr.getBoundingClientRect().width) : 0 };
    }, ARTHUR);
    ok(t.attendues >= 2 && t.vides === 0 && t.plus === 2, '[G] au telephone, le « + » se voit sur la carte d Arthur, sans petit carre', t);
    ok(t.page <= t.iw + 1 && t.carte <= t.iw, '[G] au telephone, rien ne deborde de cote', t);
  });
}

const SCENARIOS = { lecture, cocher: scenarioCocher, telephone };

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : chaque regle retiree au code servi fait rougir sa lettre.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  { nom: 'coche-automatique', lettre: 'A', scenario: 'lecture', editions: [{ fichier: PG, de: "    if (e.fait) return 'fini';\n", vers: "    if (e.fait || (e.end != null && m.maintenant != null && e.end <= m.maintenant)) return 'fini';\n" }] },
  { nom: 'carte-grise-d-office', lettre: 'A', scenario: 'lecture', editions: [{ fichier: APP, de: "${isToday && item.window.end <= curH + 1e-6 && !attendue ? ' is-passee' : ''}", vers: "${isToday && item.window.end <= curH + 1e-6 ? ' is-passee' : ''}" }] },
  { nom: 'depart-joue-gris-d-office', lettre: 'A', scenario: 'lecture', editions: [{ fichier: CSS, de: '.lp .lp-dep.is-joue :is(.lp-g:not(.is-a-cocher), .lp-cases i) {', vers: '.lp .lp-dep.is-joue :is(.lp-g, .lp-cases i) {' }] },
  { nom: 'fiche-fini-tout-seul', lettre: 'A', scenario: 'lecture', editions: [{ fichier: APP, de: "  if (now >= etape.end) return { cle: 'noncoche', mot: 'Non coché' };", vers: "  if (now >= etape.end) return etape.exige ? { cle: 'noncoche', mot: 'Non coché' } : { cle: 'fini', mot: 'Fini' };" }] },
  { nom: 'case-vide-revenue', lettre: 'A', scenario: 'lecture', editions: [{ fichier: PG, de: "    var repere = fait ? GF_FAIT : '';", vers: "    var repere = fait ? GF_FAIT : attend ? '<svg class=\"gf-x__ac\" viewBox=\"0 0 24 24\"></svg>' : '';" }] },
  { nom: 'case-vide-revenue-a-la-carte', lettre: 'A', scenario: 'lecture', editions: [{ fichier: CSS, de: '.lp .lp-g.is-a-cocher:not(.is-choisi) {', vers: ".booking.is-a-cocher .bk-time::before { content: ''; }\n.lp .lp-g.is-a-cocher:not(.is-choisi) {" }] },
  { nom: 'coche-ignoree', lettre: 'B', scenario: 'cocher', editions: [{ fichier: PG, de: "    if (e.fait) return 'fini';\n", vers: '' }] },
  { nom: 'suivi-reserve-aux-formules', lettre: 'C', scenario: 'lecture', editions: [{ fichier: APP, de: "function renderActivityProgressPill(r, summary = suiviDuDossier(r)) {\n  if (!summary.total) return '';", vers: "function renderActivityProgressPill(r, summary = suiviDuDossier(r)) {\n  if (!reservationHasFormulaActivities(r)) return '';\n  if (!summary.total) return '';" }] },
  { nom: 'en-plus-non-distingue', lettre: 'D', scenario: 'lecture', editions: [{ fichier: PG, de: "    var plus = enPlus && t !== '' ? GF_PLUS : '';", vers: "    var plus = '';" }] },
  { nom: 'en-plus-invisible', lettre: 'D', scenario: 'lecture', editions: [{ fichier: PGC, de: '.gf-x__plus { position: absolute;', vers: '.gf-x__plus { display: none; position: absolute;' }] },
  { nom: 'sur-mesure-en-gris', lettre: 'D', scenario: 'lecture', editions: [{ fichier: PG, de: '  var GF_NOTES = { client: true, equipe: true, mesure: true };', vers: '  var GF_NOTES = { client: true, equipe: true };' }] },
  { nom: 'notes-sans-fond', lettre: 'E', scenario: 'lecture', editions: [{ fichier: PGC, de: '.gf-i.gf-i--note { padding: 1px 6px 1px 5px; border-left: 3px solid var(--gf-i-teinte); border-radius: 0 4px 4px 0; background: color-mix(in srgb, var(--gf-i-teinte) 9%, var(--surface)); }', vers: '' }] },
  { nom: 'legende-en-cours', lettre: 'F', scenario: 'lecture', editions: [{ fichier: APP, de: "<i class=\"gf-leg is-lancer\" aria-hidden=\"true\"></i>à lancer : pas encore coché</span>", vers: "<i class=\"gf-leg is-lancer\" aria-hidden=\"true\"></i>en cours</span>" }] },
  { nom: 'case-vide-revenue-au-telephone', lettre: 'G', scenario: 'telephone', editions: [{ fichier: PG, de: "    var repere = fait ? GF_FAIT : '';", vers: "    var repere = fait ? GF_FAIT : attend ? '<svg class=\"gf-x__ac\" viewBox=\"0 0 24 24\"></svg>' : '';" }] },
];

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      for (const nom of Object.keys(SCENARIOS)) { console.log(`\n[${nom}]`); await SCENARIOS[nom](browser); }
    } else {
      console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.SA_MUTATIONS || liste(process.env.SA_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.SA_BAVARD;
        try {
          await SCENARIOS[m.scenario](browser);
        // (un plantage n est pas une regle qui rougit : il se dit, et la contre-preuve reste a prouver)
        } catch (e) { if (!(e instanceof Mordu)) rouges.push(`plantage : ${e.message}`); }
        silence = false;
        mutation = null;
        const vus = rouges.slice(garde);
        rouges.length = garde;
        echecs = avant;
        ok(vus.some((l) => l.startsWith(`[${m.lettre}]`)), `[K] mutation ${m.nom} : [${m.lettre}] rougit`, vus.slice(0, 3).join(' ; ') || 'rien n a rougi');
      }
    }
  } finally {
    await browser.close();
    serveurHttp.close();
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nsuivi-activites-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nsuivi-activites-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}

// La journee et l ouverture servent aussi aux captures avant / apres.
module.exports = { journee, ouvrir, aller, PORT, ARTHUR, CLUB, GERARD };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
