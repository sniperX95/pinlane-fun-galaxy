// L HEURE DE CHAQUE ACTIVITE SE CHANGE DANS LA FENETRE DU DOSSIER (2026-11-18).
//
// Ansar, 18/11, sa capture de la fenetre d Albert Coorens (Formule 5, laser
// 15:30, Minigolf Blacklight 15:55) a l appui : « on doit pouvoir modifier
// l heure de chaque activite ici », puis « super quali et super complet ». La
// regle : dans l onglet Modifier, toucher l heure d une activite ouvre son
// champ ; le serveur la juge tout de suite ; « Enregistrer » la deplace par le
// chemin du glisser du planning (PATCH activityMove : memes controles de place,
// de version et de droits).
//   [H1] l heure se touche, son champ s ouvre dans la rangee, la nouvelle heure
//        se lit a gauche (en couleur) et dans la barre du bas avant le clic ;
//        une heure qui va passe sans bruit (pas de phrase, pas de rouge) ;
//   [H2] « Enregistrer » la change en base par un seul PATCH activityMove (rien
//        d autre dans le corps), sur le planning (le programme que la console
//        lit, la fiche Infos), les autres activites et le prix ne bougent pas ;
//   [H3] la derniere modification et la ligne d historique racontent un
//        deplacement au planning, avec le nom de l activite, et le releve
//        Modifications le compte comme une activite deplacee ;
//   [U1] une seule heure par activite a gauche ; les parties d un laser se
//        disent en mots (« 1re partie à 15:00 · 2e partie à 15:30 ») ;
//   [U2] un refus se lit une fois a l activite (son champ en rouge, la phrase
//        juste dessous) et une fois en resume dans la barre du bas ; ni cadre
//        dans le corps, ni toast ; apres le clic, « Pas enregistré : … » ;
//   [F1] une plage se dit « de 16:00 à 17:30 », jamais « de 16:00-17:30 » ;
//   [S1] une heure qui ne va pas propose les heures libres les plus proches
//        (une avant, une apres, jamais celle qu elle a deja) ; un toucher
//        remplit le champ et revérifie, puis « Enregistrer » la pose ;
//   [T1] chaque activite a heure du banc (bowling, laser, minigolf, arcades) a son
//        champ qui marche, de bout en bout ; une activite « --:-- » n en montre pas ;
//        une activite « Libre » se touche pour recevoir son heure (2026-11-19,
//        scripts/programme-complet-check.js), sauf la plaine de jeux, libre toute la
//        journee (2026-11-21) ;
//   [O1] le programme se lit dans l ordre des heures ;
//   [R1] une ressource prise (une piste, l arene laser) : refusee avant le clic
//        avec le nom de la ressource et la plage, rien n est ecrit ;
//   [R2] une heure qui chevauche une autre activite du meme groupe ;
//   [R3] une heure avant l arrivee du groupe : « Avant l’arrivée du groupe à
//        16:00. », rien ne part ;
//   [R4] hors des horaires du jour, ouverture exceptionnelle comprise, et une
//        activite qui finirait apres la fermeture ;
//   [R5] une piste en maintenance, une activite bloquee a cette heure ;
//   [R6] une heure deja passee aujourd hui ;
//   [L1] le laser suit : une partie changee, l autre garde son heure ; posee sur
//        l heure prevue du minigolf, la barre le dit sans bloquer ;
//   [B1] une activite a pistes (bowling) suit, avec ses pistes ;
//   [C1] un autre poste a modifie le dossier entre-temps : le PATCH est refuse
//        (409), la barre le dit, rien n est ecrit, la note du collegue reste ;
//        la saisie reste, et un second « Enregistrer » passe sur sa version ;
//   [M1] une heure part avec tout le reste d un seul « Enregistrer » (2026-11-20,
//        le dossier 1953) : le deplacement, puis le dossier ; avec le telephone
//        comme avec les joueurs, qui recalculent les heures ;
//   [D1] au telephone et sur tablette : rien ne deborde, chaque heure, chaque
//        champ et chaque heure proposee se touche au doigt ;
//   [V1] le calcul a blanc des heures n ecrit rien ;
//   [P1] sans session, ce calcul a blanc repond 401, que le dossier existe ou non ;
//   [J1] aucune erreur JS.
// La console reelle (scripts/planning-v3-fixtures.js, journee « pic » de Fun
// Galaxy Libramont, samedi 16 janvier 2027 a 15:10) ; ses PATCH et ses calculs a
// blanc partent au VRAI handler api/staff-reservations.js, sur la base en memoire
// de scripts/reserver-banc.js (aucune base reelle, aucun reseau). Une piste en
// maintenance et un blocage d activite se posent dans cette base (lane_statuses,
// availability_blocks), une ouverture exceptionnelle sur le centre.
// --contre-preuves : chaque garde retiree (en memoire ; le disque n est jamais
// touche) fait rougir sa lettre ; chaque ancre existe une fois et une seule.
//   HA_MUTATIONS : un sous-ensemble ; HA_BAVARD : les lignes des contre-preuves ;
//   HA_CAPTURES=<dossier> : les images de la fenetre, cas par cas.
'use strict';
const fs = require('fs');
const path = require('path');
// La base en memoire et le faux 'pg' s installent au require, avant tout
// module de lib/ (aucune base reelle n est jamais ouverte).
const B = require('./reserver-banc.js');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_HEURE_ACTIVITE_PORT || 5457);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JS = 'assets/app-main.js';
const CSS = 'assets/pinlane-staff.css';
const API = 'api/staff-reservations.js';
const MOVE = 'lib/reservation-activity-move.js';
const BASE = 'lib/database.js';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);
const CAPTURES = process.env.HA_CAPTURES || '';

const LINA = 1601; // Formule 5, 11 joueurs, arrivee 15:00 : laser 15:00 et 15:30, Minigolf Blacklight 16:00
const CLARA = 1634; // bowling 15:00, 1h30, pistes 6 et 7 (la 6 est prise a 16:30)
const MANON = 1618; // laser 15:30 et 16:00, 8 joueurs (a 19:00, trois groupes tiennent les 30 armes)
const HENRARD = 1635; // bowling 16:00, piste 8, 6 joueurs, arrivee 16:00
const FOOT = 1616; // laser 13:00 et 13:30, bowling 14:00, arcades libres

let echecs = 0;
let silence = false;
const rouges = [];
class Mordu extends Error {}
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 900)}` : ''}`);
  if (!cond && mutation && label.startsWith(`[${mutation.lettre}]`)) throw new Mordu(label);
  return cond;
}

let mutation = null;
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel && !ed.serveur) t = t.replace(ed.de, () => ed.vers);
  return t;
}

// ---------------------------------------------------------------------------
// LA BASE : la journee de la fixture, en colonnes (l inverse de mapReservation),
// plus ce que le cas pose : une piste en maintenance, un blocage d activite.
// ---------------------------------------------------------------------------
const FIXTURE = FX.lireFixture('pic');
const JOUR = FIXTURE.staffState.date;
function ligneDepuis(r) {
  return {
    id: r.id, center_id: r.centerId || 'libramont', channel: r.channel || 'staff', name: r.name, phone: r.phone || '', email: r.email || '',
    date: r.date, start_time: r.startTime, duration: r.duration, total_duration: r.totalDuration ?? r.duration, lanes: (r.lanes || []).map(Number),
    pax: r.pax, status: r.status, base_price: r.basePrice, price: r.price, type: r.type, formule_id: r.formuleId || null, label: r.label,
    occasion: r.occasion || '', extras: r.extras || [], payment_method: r.paymentMethod || null, notes: r.notes || '',
    ops_plan: r.opsPlan || null, risk_level: r.riskLevel || '', risk_score: r.riskScore ?? null, validation_status: r.validationStatus || 'confirmed',
    activity_progress: r.activityProgress || {}, program: r.program || null, companions: r.companions || 0,
    created_at: new Date(r.createdAt), updated_at: new Date(r.updatedAt),
    acquisition: r.acquisition ?? null, client_key: r.clientKey || '', paid_at: r.paidAt ? new Date(r.paidAt) : null,
    amount_paid: r.amountPaid ?? null, discount_reason: r.discountReason || '', absent_at: r.absentAt ? new Date(r.absentAt) : null,
  };
}
let INJECTE = { pistes: [], blocs: [] };
const pgBanc = require(require.resolve('pg', { paths: [ROOT] }));
const requeteAvant = pgBanc.Client.prototype.query;
pgBanc.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (/ from lane_statuses /.test(s) && INJECTE.pistes.length) {
    const rows = INJECTE.pistes.map((n) => ({ lane_number: n, status: 'maintenance', updated_at: new Date('2027-01-16T08:00:00Z'), maintenance_from: null, maintenance_until: null, maintenance_note: 'Courroie' }));
    return { rows, rowCount: rows.length };
  }
  if (/ from availability_blocks /.test(s) && /scope_type/.test(s) && INJECTE.blocs.length) {
    return { rows: JSON.parse(JSON.stringify(INJECTE.blocs)), rowCount: INJECTE.blocs.length };
  }
  return requeteAvant.call(this, sql, params);
};
const brut = (id) => JSON.stringify(B.base.reservations.get(Number(id)) || null);
function enBase(id) {
  const row = B.base.reservations.get(Number(id));
  if (!row) return null;
  const plan = typeof row.ops_plan === 'string' ? JSON.parse(row.ops_plan) : (row.ops_plan || {});
  const heures = {};
  (plan.timeline || []).filter((s) => s && s.type === 'activity' && !s.flexible && s.startTime).forEach((s) => {
    const cle = s.activityId === 'laser_game' ? `laser_game:${s.countIndex || 1}.${s.groupWaveIndex || 1}` : s.activityId;
    if (!heures[cle]) heures[cle] = s.startTime;
  });
  (plan.resourceBlocks || []).filter((b) => b && b.resourceType === 'bowling_lane').forEach((b) => { if (!heures.bowling || b.startTime < heures.bowling) heures.bowling = b.startTime; });
  (plan.resourceBlocks || []).filter((b) => b && b.resourceType === 'laser_arena').forEach((b) => { heures[`laser_game:${b.countIndex || 1}.${b.groupWaveIndex || 1}`] = b.startTime; });
  return {
    prix: Number(row.price), pax: Number(row.pax), telephone: row.phone, notes: String(row.notes || ''), pistes: (row.lanes || []).map(Number).join(','), heures,
    quoi: (plan.derniereModif && plan.derniereModif.quoi) || [],
    bowling: (plan.resourceBlocks || []).filter((b) => b && b.resourceType === 'bowling_lane').map((b) => `${b.startTime}[${(b.lanes || []).join(',')}]`).join(' '),
  };
}

// ---------------------------------------------------------------------------
// DANS LA PAGE.
// ---------------------------------------------------------------------------
function lire() {
  const m = document.querySelector('#posOverlay .edit-modal');
  const toast = ((document.getElementById('toast') || {}).textContent || '').replace(/\s+/g, ' ').trim();
  if (!m || !state.selectedRes) return { fermee: true, toast };
  const t = (s) => { const n = m.querySelector(s); return n && !n.hidden ? n.textContent.replace(/\s+/g, ' ').trim() : ''; };
  const zone = m.querySelector('#editVerdict');
  const rangees = Array.from(m.querySelectorAll('.fm-act[data-edit-activity]'));
  const heures = {};
  const parties = {};
  const colonnes = {};
  rangees.forEach((a) => {
    const id = a.dataset.editActivity;
    heures[id] = Array.from(a.querySelectorAll('.fm-act-heure .fm-heure')).map((h) => h.textContent.trim()).join('/');
    colonnes[id] = a.querySelectorAll('.fm-act-heure .fm-heure').length;
    parties[id] = ((a.querySelector('.fm-act-parties') || {}).textContent || '').replace(/\s+/g, ' ').trim();
  });
  const erreur = document.getElementById('editError');
  return {
    fermee: false, toast,
    ton: zone ? (/is-(\w+)/.exec(zone.className) || [])[1] || '' : 'absent',
    verdict: t('#editVerdict'), pied: t('#editModifs'), heures, parties, colonnes,
    ordre: rangees.map((a) => a.dataset.editActivity).join(','),
    cadre: Boolean(erreur && !erreur.hidden && erreur.textContent.trim()),
    touchables: Array.from(m.querySelectorAll('.fm-heure-touche[data-heure-cle]')).map((b) => b.getAttribute('data-heure-cle')),
    changees: Array.from(m.querySelectorAll('.is-changee')).map((h) => h.textContent.trim()),
    champ: Array.from(m.querySelectorAll('[data-heure-champ]')).map((c) => `${c.getAttribute('data-heure-champ')}=${c.value}`),
    rouges: Array.from(m.querySelectorAll('.fm-heure-champ.is-refus')).map((c) => c.getAttribute('data-heure-zone')),
    refus: Array.from(m.querySelectorAll('[data-heure-refus]:not([hidden])')).map((z) => ({
      cle: z.getAttribute('data-heure-refus'),
      phrase: ((z.querySelector('.fm-heure-phrase') || {}).textContent || '').trim(),
      suggestions: Array.from(z.querySelectorAll('.fm-heure-suggestion')).map((b) => b.getAttribute('data-suggestion')),
    })),
    texte: m.innerText.replace(/\s+/g, ' '),
  };
}

async function verdictPose(page) {
  await page.waitForTimeout(120);
  await page.waitForFunction(() => { const z = document.getElementById('editVerdict'); return Boolean(z) && !z.classList.contains('is-calcul') && !verdictEdition().enCours; }, null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(150);
}

// Toucher l heure, puis taper la nouvelle : les deux gestes du comptoir.
const heure = (cle, valeur) => async (page) => {
  await page.locator(`#posOverlay [data-heure-cle="${cle}"]`).first().click();
  await page.fill(`#posOverlay [data-heure-champ="${cle}"]`, valeur);
};
const champ = (sel, valeur) => async (page) => { await page.fill(`#posOverlay ${sel}`, valeur); };
const suite = (...gestes) => async (page) => { for (const g of gestes) { await g(page); await verdictPose(page); } };
// Une heure libre proposee, touchee.
const proposee = (cle, valeur) => async (page) => { await page.click(`#posOverlay [data-heure-refus="${cle}"] .fm-heure-suggestion[data-suggestion="${valeur}"]`); };

async function enregistrer(page, fenetres) {
  await page.locator('#posOverlay .es-save').click();
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(120);
    const bouton = page.locator('.staff-confirm [data-role="confirm-ok"]');
    if (await bouton.count()) { fenetres.push((await page.locator('.staff-confirm strong').textContent()) || ''); await bouton.click(); }
    const etat = await page.evaluate(() => ({ fermee: !document.querySelector('#posOverlay .edit-modal') || !state.selectedRes, note: /Pas enregistré/.test((document.getElementById('editVerdict') || {}).textContent || '') }));
    if (etat.fermee || etat.note) break;
  }
  await page.waitForTimeout(250);
  return page.evaluate(lire);
}

async function photo(page, nom, cle = '') {
  if (!CAPTURES || mutation || !nom) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  if (cle) await page.locator(`#posOverlay [data-heure-champ="${cle}"]`).first().scrollIntoViewIfNeeded().catch(() => null);
  const m = page.locator('#posOverlay .edit-modal');
  if (await m.count()) await m.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
  else await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

// Un cas : la fiche ouverte sur Modifier, le geste, le verdict, puis le clic.
async function jouerCas(browser, { id, geste, enregistrer: clic = true, avantClic = null, secondClic = false, nom = '', cle = '', apres = null, appareil = 'ordinateur', pistes = [], blocs = [], ouvertures = null, mesure = null }) {
  B.semer(FIXTURE.staffState.reservations.map(ligneDepuis));
  INJECTE = { pistes, blocs };
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  require(path.join(ROOT, 'lib/ops-knowledge.js')).getCenter('libramont').ouverturesExceptionnelles = ouvertures || [];
  const patchs = [];
  const reponses = [];
  const blancs = [];
  const fenetres = [];
  const { ctx, page, erreurs } = await FX.monter(browser, {
    fixture: 'pic', appareil, theme: 'light', port: PORT, heure: '15:10',
    avantChargement: async (p) => {
      await p.exposeFunction('__fixtureServeur', async (corps) => { patchs.push(corps); const rep = await serveur.appeler('PATCH', '/api/staff-reservations', corps); reponses.push(rep.statut); return rep; });
      await p.exposeFunction('__fixtureBlanc', async (corps) => { blancs.push(corps); return serveur.appeler('POST', '/api/staff-reservations', corps); });
    },
  });
  try {
    const depart = brut(id);
    await page.evaluate((i) => { closePos(); openPos(i); setTab('modifier'); }, id);
    await page.waitForTimeout(150);
    const ouverture = await page.evaluate(lire);
    await photo(page, nom && `${nom}-avant`);
    await geste(page);
    await verdictPose(page);
    const avant = await page.evaluate(lire);
    await photo(page, nom && `${nom}-verdict`, cle);
    const mesures = mesure ? await mesure(page) : null;
    const intacte = brut(id) === depart && patchs.length === 0;
    let apresClic = null;
    let second = null;
    let colleague = null;
    if (clic) {
      if (avantClic) colleague = avantClic(id);
      apresClic = await enregistrer(page, fenetres);
      if (!apresClic.fermee) await photo(page, nom && `${nom}-clic`, cle);
      if (secondClic && apresClic && !apresClic.fermee) second = await enregistrer(page, fenetres);
    }
    const lu = apres ? await apres(page) : null;
    if (nom && CAPTURES && !mutation && ((apresClic && apresClic.fermee) || (second && second.fermee))) {
      await page.evaluate((i) => { openPos(i); setTab('modifier'); }, id);
      await page.waitForTimeout(250);
      await photo(page, `${nom}-apres`);
    }
    return { ouverture, avant, apres: apresClic, second, intacte, ecrit: brut(id) !== depart, base: enBase(id), patchs, reponses, blancs, fenetres, lu, colleague, mesures, journal: serveur.journal, erreurs: erreurs.slice() };
  } finally {
    INJECTE = { pistes: [], blocs: [] };
    await ctx.close();
  }
}

// Ce que la console sait du dossier apres l enregistrement : le programme qu elle
// lit (getGroupeProgramme, le meme que la carte et la fiche) et la fiche Infos.
const programmeLu = (id) => async (page) => page.evaluate((i) => {
  const r = state.reservations.find((x) => x.id === i);
  const programme = getGroupeProgramme(r).filter((e) => e.start !== null && e.start !== undefined).map((e) => `${e.activityId}@${formatClockDisplay(e.start)}`);
  closePos();
  openPos(i);
  setTab('infos');
  const fiche = ((document.querySelector('#posOverlay .edit-modal') || {}).innerText || '').replace(/\s+/g, ' ');
  closePos();
  return { programme, fiche };
}, id);

// UN AUTRE POSTE ecrit sur le dossier : une note, une version neuve.
function collegueEcrit(id) {
  const row = B.base.reservations.get(Number(id));
  row.notes = `${row.notes || ''}\nNote d’un autre poste`.trim();
  row.updated_at = new Date(new Date(row.updated_at).getTime() + 60000);
  return row.notes;
}

// Un refus lu a l activite : son champ rouge, sa phrase, ses heures proposees, une seule fois.
function refusA(lu, cle) { return (lu.refus || []).find((z) => z.cle === cle) || null; }
function uneFois(lu, morceau) { return lu.texte.split(morceau).length - 1 === 1; }

async function scenarioPasse(browser) {
  // Le minigolf de Lina de 16:00 a 16:30 : deux gestes, puis Enregistrer.
  const h = await jouerCas(browser, { id: LINA, geste: heure('minigolf_blacklight', '16:30'), nom: 'minigolf-16h30', cle: 'minigolf_blacklight', apres: programmeLu(LINA) });
  ok(h.ouverture.touchables.includes('minigolf_blacklight') && h.ouverture.touchables.includes('laser_game:1.1') && h.ouverture.touchables.includes('laser_game:2.1') && h.ouverture.pied === 'Aucune modification',
    '[H1] a l ouverture : chaque heure se touche (le minigolf, chaque partie du laser), « Aucune modification »', h.ouverture);
  ok(Object.values(h.ouverture.colonnes).every((n) => n === 1) && h.ouverture.heures.laser_game === '15:00' && h.ouverture.parties.laser_game === '1re partie à 15:00 · 2e partie à 15:30' && h.ouverture.parties.minigolf_blacklight === '',
    '[U1] une seule heure par activite a gauche ; les parties du laser se disent en mots', { colonnes: h.ouverture.colonnes, heures: h.ouverture.heures, parties: h.ouverture.parties });
  ok(h.avant.champ.includes('minigolf_blacklight=16:30') && h.avant.heures.minigolf_blacklight === '16:30' && h.avant.changees.includes('16:30') && /Minigolf Blacklight 16:00 → 16:30/.test(h.avant.pied),
    '[H1] la nouvelle heure se lit a gauche, en couleur, et dans la barre du bas, avant le clic', h.avant);
  ok(h.avant.verdict === '' && !h.avant.rouges.length && !h.avant.refus.length, '[H1] une heure qui va passe sans bruit : pas de phrase, pas de champ rouge', { verdict: h.avant.verdict, rouges: h.avant.rouges });
  ok(h.intacte && h.blancs.some((b) => b.deplacement), '[V1] le calcul a blanc des heures n a rien ecrit (la ligne est la meme, aucun PATCH)', { blancs: h.blancs.length });
  const corps = h.patchs[0] || {};
  ok(h.apres && h.apres.fermee && h.patchs.length === 1 && Object.keys(corps).sort().join(',') === 'activityMove,baseUpdatedAt,centerId,id'
    && JSON.stringify(corps.activityMove) === JSON.stringify({ activityId: 'minigolf_blacklight', startTime: '16:30' }),
  '[H2] « Enregistrer » envoie UN deplacement d activite, rien d autre, et la fenetre se ferme', { patchs: h.patchs, apres: h.apres });
  ok(h.base.heures.minigolf_blacklight === '16:30' && h.base.heures['laser_game:1.1'] === '15:00' && h.base.heures['laser_game:2.1'] === '15:30' && h.base.prix === 286,
    '[H2] en base : le minigolf a 16:30, les deux parties de laser a leur heure, le prix inchange (286 €)', h.base);
  ok(h.lu && h.lu.programme.includes('minigolf_blacklight@16:30') && !h.lu.programme.includes('minigolf_blacklight@16:00') && /16:30/.test(h.lu.fiche),
    '[H2] sur le planning : le programme de la console et la fiche Infos disent 16:30', h.lu);
  const heuresLues = h.lu ? h.lu.programme.map((e) => e.split('@')[1]) : [];
  ok(h.lu && heuresLues.length > 2 && heuresLues.every((x, i) => i === 0 || heuresLues[i - 1] <= x) && h.lu.programme.indexOf('minigolf_blacklight@16:30') > h.lu.programme.indexOf('laser_game@15:30'),
    '[O1] apres le changement, le programme se lit dans l ordre des heures (le minigolf de 16:30 apres le laser de 15:30)', h.lu && h.lu.programme);
  ok(/Heure changée : Minigolf Blacklight à 16:30/.test(h.apres.toast), '[H2] la console dit ce qui a change', h.apres.toast);
  const audit = h.journal.audits.find((a) => a.action === 'moveReservationActivity');
  const histo = require(path.join(ROOT, 'lib/historique-dossier.js'));
  const entree = audit ? histo.entreeDuJournal({ ...audit, occurredAt: new Date() }, LINA) : null;
  const releve = audit ? require(path.join(ROOT, 'lib/garde-journal.js')).classer({ ...audit, entity_id: LINA, champs: audit.changes || {} }) : null;
  ok(h.base.quoi.includes('Déplacé au planning : Minigolf Blacklight à 16:30') && entree && entree.quoi.includes('Déplacé au planning : Minigolf Blacklight à 16:30')
    && releve && /activité déplacée/.test(releve.ligne || ''),
  '[H3] la derniere modification et l historique disent « Déplacé au planning : Minigolf Blacklight à 16:30 », le releve Modifications « une activité déplacée »', { quoi: h.base.quoi, entree, releve });

  // Le laser suit : la partie 2 de Lina a 16:55, la partie 1 reste a 15:00.
  const l = await jouerCas(browser, { id: LINA, geste: heure('laser_game:2.1', '16:55') });
  ok(l.avant.verdict === '' && /Laser Game, 2e partie 15:30 → 16:55/.test(l.avant.pied) && /2e partie à 16:55/.test(l.avant.parties.laser_game) && l.apres && l.apres.fermee
    && l.base.heures['laser_game:2.1'] === '16:55' && l.base.heures['laser_game:1.1'] === '15:00' && l.base.heures.minigolf_blacklight === '16:00' && l.base.prix === 286
    && JSON.stringify((l.patchs[0] || {}).activityMove) === JSON.stringify({ activityId: 'laser_game', unitKey: '2.1', startTime: '16:55' }),
  '[L1] le laser suit : la 2e partie passe a 16:55 par son unitKey, la 1re et le minigolf gardent leur heure, le prix aussi', { verdict: l.avant.verdict, pied: l.avant.pied, parties: l.avant.parties, base: l.base, patchs: l.patchs });
  const lm = await jouerCas(browser, { id: LINA, geste: heure('laser_game:2.1', '16:30'), enregistrer: false });
  ok(lm.avant.ton === 'attention' && /Minigolf Blacklight reste à 16:00, pendant le Laser Game/.test(lm.avant.verdict),
    '[L1] une partie posee sur l heure prevue du minigolf : la barre le dit avant le clic, sans bloquer', lm.avant.verdict);

  // Une activite a pistes suit : le bowling de la famille Henrard de 16:00 a 16:30, piste 8.
  const b = await jouerCas(browser, { id: HENRARD, geste: heure('bowling', '16:30') });
  ok(b.avant.verdict === '' && b.apres && b.apres.fermee && b.base.bowling === '16:30[8]' && b.base.prix === 39
    && JSON.stringify((b.patchs[0] || {}).activityMove) === JSON.stringify({ activityId: 'bowling', startTime: '16:30', lanes: [8] }),
  '[B1] le bowling suit, avec ses pistes : 16:30 sur la piste 8, le prix inchange', { verdict: b.avant.verdict, base: b.base, patchs: b.patchs });

  // L heure avec le telephone : les deux partent, l heure d abord.
  const t = await jouerCas(browser, { id: LINA, geste: suite(heure('minigolf_blacklight', '16:15'), async (page) => { await page.click('#posOverlay #editContactPli summary'); }, champ('#editPhoneInput', '0470 11 22 33')) });
  ok(t.apres && t.apres.fermee && t.patchs.length === 2 && t.patchs[0].activityMove && !t.patchs[1].activityMove && t.base.heures.minigolf_blacklight === '16:15' && t.base.telephone === '0470 11 22 33' && t.base.prix === 286,
    '[M1] une heure et un telephone : les deux partent (le deplacement, puis le dossier), le prix inchange', { patchs: t.patchs.map((p) => Object.keys(p).join('|')), base: t.base, apres: t.apres });

  // Le programme du Club de foot se lit dans l ordre des heures : son laser (13:00) avant son bowling (14:00).
  const o = await jouerCas(browser, { id: FOOT, geste: async () => {}, enregistrer: false });
  ok(o.ouverture.ordre.startsWith('laser_game,bowling'), '[O1] le programme se lit dans l ordre des heures : le laser de 13:00 avant le bowling de 14:00, le libre apres', o.ouverture.ordre);
  ok([h, l, lm, b, t, o].every((x) => !x.erreurs.length), '[J1] aucune erreur JS (heures qui passent)', [h, l, lm, b, t, o].flatMap((x) => x.erreurs).slice(0, 3));
}

// [T1] CHAQUE ACTIVITE A HEURE DU BANC, de bout en bout.
async function scenarioTypes(browser) {
  B.semer(FIXTURE.staffState.reservations.map(ligneDepuis));
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  const { ctx, page, erreurs } = await FX.monter(browser, {
    fixture: 'pic', appareil: 'ordinateur', theme: 'light', port: PORT, heure: '15:10',
    avantChargement: async (p) => { await p.exposeFunction('__fixtureBlanc', async (corps) => serveur.appeler('POST', '/api/staff-reservations', corps)); },
  });
  let lignes = [];
  try {
    lignes = await page.evaluate(() => state.reservations.filter((r) => r.status !== 'cancelled').flatMap((r) => {
      closePos(); openPos(r.id); setTab('modifier');
      const m = document.querySelector('#posOverlay .edit-modal');
      const vues = m ? Array.from(m.querySelectorAll('.fm-act[data-edit-activity]')).map((a) => ({
        id: r.id, activite: a.dataset.editActivity,
        heure: ((a.querySelector('.fm-act-heure .fm-heure') || {}).textContent || '').trim(),
        colonne: a.querySelectorAll('.fm-act-heure .fm-heure').length,
        touche: Boolean(a.querySelector('.fm-act-heure .fm-heure-touche')),
      })) : [];
      closePos();
      return vues;
    }));
  } finally { await ctx.close(); }
  const aHeure = lignes.filter((l) => /^\d{2}:\d{2}$/.test(l.heure));
  const sansHeure = lignes.filter((l) => !/^\d{2}:\d{2}$/.test(l.heure));
  const types = [...new Set(aHeure.filter((l) => l.touche).map((l) => l.activite))].sort();
  ok(lignes.length > 40 && lignes.every((l) => l.colonne === 1), '[T1] le banc entier : chaque rangee a une seule heure a gauche', { rangees: lignes.length, plusieurs: lignes.filter((l) => l.colonne !== 1).slice(0, 3) });
  // (2026-11-19, scripts/programme-complet-check.js) Une activite « Libre » se touche pour recevoir son heure, sauf le
  // bowling, le laser, la table d anniversaire, les jetons et les boissons ; « --:-- » ne se touche pas. Ni la plaine
  // de jeux, libre toute la journee (2026-11-21, le gerant : « il n'y a pas d'heure ») : scripts/retard-visible-check.js.
  const libreQuiSeTouche = (l) => l.heure === 'Libre' && !['bowling', 'laser_game', 'party_table', 'arcade_credit', 'playground'].includes(l.activite) && !/^service_/.test(l.activite);
  ok(aHeure.every((l) => l.touche || ['party_table'].includes(l.activite) || /^service_/.test(l.activite)) && sansHeure.every((l) => (libreQuiSeTouche(l) ? l.touche : !l.touche)),
    '[T1] chaque activite a heure se touche ; « Libre » se touche pour recevoir une heure, « --:-- » ne se touche pas', { sansBouton: aHeure.filter((l) => !l.touche).slice(0, 4), libresTouchables: sansHeure.filter((l) => l.touche).slice(0, 4) });
  ok(['arcade_time', 'bowling', 'laser_game', 'minigolf_blacklight'].every((x) => types.includes(x)) && !types.includes('playground'), '[T1] les activites a heure du banc : bowling, laser, minigolf, arcades ; la plaine, libre, n en a pas', types);
  console.log(`      (types a heure sur le banc : ${types.join(', ')} ; sans heure : ${[...new Set(sansHeure.map((l) => l.activite))].join(', ')})`);
  // Chaque type, de bout en bout : son heure decalee (5 min, 30 pour le bowling), une heure proposee si le serveur refuse, puis Enregistrer.
  const parCinq = (texte, plus) => { const [hh, mm] = texte.split(':').map(Number); const m = hh * 60 + mm + plus; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  const faits = [];
  for (const type of types) {
    // Une heure a venir (il est 15:10) : une heure deja passee est refusee, a raison.
    const ligne = aHeure.filter((l) => l.activite === type && l.touche).sort((x, y) => (x.heure >= '15:15' ? 0 : 1) - (y.heure >= '15:15' ? 0 : 1))[0];
    const cle = type === 'laser_game' ? null : type;
    let voulue = parCinq(ligne.heure, type === 'bowling' ? 30 : 5);
    let choisie = voulue;
    const c = await jouerCas(browser, {
      id: ligne.id,
      geste: async (page) => {
        const bouton = page.locator(`#posOverlay .fm-act[data-edit-activity="${type}"] .fm-act-heure .fm-heure-touche`).first();
        const k = await bouton.getAttribute('data-heure-cle');
        await bouton.click();
        await page.fill(`#posOverlay [data-heure-champ="${k}"]`, voulue);
        await verdictPose(page);
        const lu = await page.evaluate(lire);
        const refus = (lu.refus || []).find((z) => z.cle === k);
        if (refus && refus.suggestions.length) {
          choisie = refus.suggestions[refus.suggestions.length - 1];
          await page.click(`#posOverlay [data-heure-refus="${k}"] .fm-heure-suggestion[data-suggestion="${choisie}"]`);
        }
        faits.push({ type, k });
      },
    });
    const k = (faits.find((f) => f.type === type) || {}).k || cle;
    ok(c.apres && c.apres.fermee && c.base.heures[k] === choisie && c.patchs.length === 1,
      `[T1] ${type} (dossier ${ligne.id}) : ${ligne.heure} → ${choisie}${choisie !== voulue ? ` (heure proposee, ${voulue} ne passait pas)` : ''}, enregistre en base`, { verdict: c.avant.verdict, refus: c.avant.refus, base: c.base.heures, apres: c.apres && c.apres.verdict });
  }
  ok(!erreurs.length, '[J1] aucune erreur JS (tous les types)', erreurs.slice(0, 3));
}

async function scenarioRefus(browser) {
  // Clara a 16:00 : la piste 6 est prise a 16:30 par la famille Noel.
  const c = await jouerCas(browser, { id: CLARA, geste: heure('bowling', '16:00'), nom: 'refus-piste-prise', cle: 'bowling' });
  const rc = refusA(c.avant, 'bowling');
  ok(c.avant.ton === 'refus' && c.avant.verdict === 'Ne passera pas : Bowling à 16:00.' && rc && rc.phrase === 'Piste 6 déjà prise de 16:00 à 17:30.' && c.intacte,
    '[R1] une piste prise par un autre groupe : refusee avant le clic, avec le nom de la piste et la plage', { verdict: c.avant.verdict, refus: c.avant.refus });
  ok(c.avant.rouges.includes('bowling') && uneFois(c.avant, 'Piste 6 déjà prise') && !c.avant.cadre,
    '[U2] le refus se lit une fois a l activite (champ rouge, phrase dessous), une fois en resume en bas, sans cadre', { rouges: c.avant.rouges, cadre: c.avant.cadre });
  ok(/de 16:00 à 17:30/.test(rc ? rc.phrase : '') && !/\d-\d/.test(c.avant.texte.replace(/\d{2}-\d{2}-\d{4}/g, '')), '[F1] la plage se dit « de 16:00 à 17:30 »', rc && rc.phrase);
  ok(c.apres && !c.apres.fermee && c.apres.verdict === 'Pas enregistré : Bowling à 16:00.' && !c.apres.cadre && !c.apres.toast && uneFois(c.apres, 'Piste 6 déjà prise') && !c.ecrit && c.reponses.join() === '409' && /Bowling 15:00 → 16:00/.test(c.apres.pied),
    '[U2] apres le clic : « Pas enregistré » en bas, la phrase toujours a l activite, ni cadre ni toast, rien d ecrit, la saisie gardee', { apres: c.apres && { verdict: c.apres.verdict, cadre: c.apres.cadre, toast: c.apres.toast, refus: c.apres.refus }, reponses: c.reponses, ecrit: c.ecrit });
  // La 2e partie de Manon a 19:00 : trois groupes y tiennent deja les 30 armes.
  const m = await jouerCas(browser, { id: MANON, geste: heure('laser_game:2.1', '19:00'), enregistrer: false, nom: 'refus-laser-complet', cle: 'laser_game:2.1' });
  const rm = refusA(m.avant, 'laser_game:2.1');
  ok(m.avant.ton === 'refus' && rm && /^Laser Game complet de 19:00 à 19:25 : \d+ joueurs pour 30 armes\.$/.test(rm.phrase) && m.intacte, '[R1] l arene laser pleine : refusee avant le clic, avec la plage et le compte des armes', rm);
  ok(rm && rm.suggestions.length >= 1 && rm.suggestions.every((x) => x !== '19:00'), '[S1] l arene pleine propose des heures libres proches', rm);
  // Le minigolf de Lina a 15:40 : le groupe joue au laser de 15:30 a 15:55.
  const g = await jouerCas(browser, { id: LINA, geste: heure('minigolf_blacklight', '15:40'), nom: 'refus-chevauche', cle: 'minigolf_blacklight' });
  const rg = refusA(g.avant, 'minigolf_blacklight');
  ok(g.avant.ton === 'refus' && rg && rg.phrase === 'Ce déplacement chevauche le Laser Game du groupe, de 15:30 à 15:55.' && g.apres && !g.apres.fermee && !g.ecrit,
    '[R2] une heure qui chevauche une autre activite du groupe : refusee avant le clic, avec la plage, rien n est ecrit', { refus: rg, ecrit: g.ecrit });
  ok(rg && rg.suggestions.includes('15:55'), '[S1] le minigolf qui chevauche propose 15:55, juste apres le laser', rg);
  // Le bowling de la famille Henrard a 15:30 : le groupe arrive a 16:00.
  const a = await jouerCas(browser, { id: HENRARD, geste: heure('bowling', '15:30'), nom: 'refus-avant-arrivee', cle: 'bowling' });
  const ra = refusA(a.avant, 'bowling');
  ok(a.avant.ton === 'refus' && ra && ra.phrase === 'Avant l’arrivée du groupe à 16:00.' && a.patchs.length === 0 && !a.ecrit && a.apres && a.apres.verdict === 'Pas enregistré : Bowling à 15:30.',
    '[R3] une heure avant l arrivee du groupe : « Avant l’arrivée du groupe à 16:00. », rien ne part', { refus: ra, patchs: a.patchs.length, apres: a.apres && a.apres.verdict });
  ok(ra && ra.suggestions.length === 1 && ra.suggestions[0] === '16:30', '[S1] avant l arrivee : l heure libre proposee vient apres l arrivee, jamais celle que le bowling a deja (16:00)', ra);
  // Le minigolf de Lina a 15:05 : il est 15:10.
  const p = await jouerCas(browser, { id: LINA, geste: heure('minigolf_blacklight', '15:05'), nom: 'refus-deja-passe', cle: 'minigolf_blacklight' });
  const rp = refusA(p.avant, 'minigolf_blacklight');
  ok(p.avant.ton === 'refus' && rp && rp.phrase === '15:05 est déjà passé : il est 15:10.' && p.patchs.length === 0 && !p.ecrit,
    '[R6] une heure deja passee aujourd hui : refusee, rien ne part', { refus: rp, patchs: p.patchs.length });
  // Le minigolf de Lina a 23:40 : il finirait a 00:25, le centre ferme a minuit.
  const f = await jouerCas(browser, { id: LINA, geste: heure('minigolf_blacklight', '23:40'), enregistrer: false, nom: 'refus-fermeture', cle: 'minigolf_blacklight' });
  const rf = refusA(f.avant, 'minigolf_blacklight');
  ok(f.avant.ton === 'refus' && rf && rf.phrase === 'Hors des horaires d’ouverture : l’activité finirait à 00:25, le centre ferme à minuit ce jour-là.' && f.intacte,
    '[R4] une activite qui finirait apres la fermeture : refusee avant le clic, l heure qui coince dite', rf);
  // Une fermeture exceptionnelle a 18:00 ce jour-la : 17:30 ne passe plus.
  const x = await jouerCas(browser, { id: LINA, geste: heure('minigolf_blacklight', '17:30'), enregistrer: false, ouvertures: [{ date: JOUR, open: '10:00', close: '18:00' }], nom: 'refus-horaire-exceptionnel', cle: 'minigolf_blacklight' });
  const rx = refusA(x.avant, 'minigolf_blacklight');
  ok(x.avant.ton === 'refus' && rx && rx.phrase === 'Hors des horaires d’ouverture : l’activité finirait à 18:15, le centre ferme à 18:00 ce jour-là.' && x.intacte,
    '[R4] l ouverture exceptionnelle du jour compte : fermeture a 18:00, 17:30 refuse', rx);
  // La piste 8 en maintenance : le bowling de la famille Henrard ne s y deplace pas.
  const s = await jouerCas(browser, { id: HENRARD, geste: heure('bowling', '16:30'), pistes: [8], nom: 'refus-maintenance', cle: 'bowling' });
  const rs = refusA(s.avant, 'bowling');
  ok(s.avant.ton === 'refus' && rs && rs.phrase === 'Piste 8 en maintenance.' && s.apres && !s.apres.fermee && !s.ecrit,
    '[R5] une piste en maintenance : refusee avant le clic, rien n est ecrit', { refus: rs, ecrit: s.ecrit });
  // Le minigolf bloque de 16:00 a 18:00 ce jour-la : 16:30 refuse, 18:00 propose, touche, enregistre.
  const bloc = { id: 91, center_id: 'libramont', scope_type: 'activity', scope_ref: 'minigolf_blacklight', recurrence: 'once', date: JOUR, day_of_week: null, date_from: null, date_until: null, start_time: '16:00', end_time: '18:00', reason: 'Entretien', created_by: 'gate' };
  const k = await jouerCas(browser, { id: LINA, geste: heure('minigolf_blacklight', '16:30'), blocs: [bloc], enregistrer: false, nom: 'refus-bloque', cle: 'minigolf_blacklight' });
  const rk = refusA(k.avant, 'minigolf_blacklight');
  ok(k.avant.ton === 'refus' && rk && rk.phrase === 'Minigolf Blacklight indisponible de 16:30 à 17:15.' && k.intacte,
    '[R5] une activite bloquee a cette heure : refusee avant le clic, avec la plage', rk);
  ok(rk && rk.suggestions.join() === '18:00', '[S1] le minigolf bloque propose 18:00, la premiere heure libre apres le blocage', rk);
  const ks = await jouerCas(browser, { id: LINA, geste: suite(heure('minigolf_blacklight', '16:30'), proposee('minigolf_blacklight', '18:00')), blocs: [bloc], nom: 'suggestion-touchee', cle: 'minigolf_blacklight' });
  ok(ks.avant.champ.includes('minigolf_blacklight=18:00') && ks.avant.verdict === '' && !ks.avant.rouges.length && ks.apres && ks.apres.fermee && ks.base.heures.minigolf_blacklight === '18:00',
    '[S1] l heure proposee touchee remplit le champ, se revérifie sans bruit, et « Enregistrer » la pose', { champ: ks.avant.champ, verdict: ks.avant.verdict, rouges: ks.avant.rouges, base: ks.base.heures });
  // Une heure et les joueurs (2026-11-20, le dossier 1953) : un seul « Enregistrer », le deplacement
  // puis le dossier ; aucun refus avant le clic, et la nouvelle heure tient apres le nouveau calcul.
  const j = await jouerCas(browser, { id: LINA, geste: suite(heure('minigolf_blacklight', '16:30'), champ('#editPaxInput', '12')) });
  ok(j.avant.ton !== 'refus' && !/s’enregistre seule/.test(j.avant.verdict) && j.patchs.length >= 2 && j.patchs[0].activityMove && !j.patchs[1].activityMove
    && j.base.heures.minigolf_blacklight === '16:30' && j.base.pax === 12,
  '[M1] une heure et les joueurs : les deux partent d un seul « Enregistrer », le minigolf a 16:30 et 12 joueurs', { verdict: j.avant.verdict, patchs: j.patchs.map((p) => Object.keys(p).filter((k) => /activityMove|pax/.test(k)).join('|')), base: j.base });
  ok([c, m, g, a, p, f, x, s, k, ks, j].every((y) => !y.erreurs.length), '[J1] aucune erreur JS (refus)', [c, m, g, a, p, f, x, s, k, ks, j].flatMap((y) => y.erreurs).slice(0, 3));
}

async function scenarioConflit(browser) {
  // Le minigolf de Lina a 16:30, mais un autre poste ecrit sur le dossier avant le clic.
  const c = await jouerCas(browser, { id: LINA, geste: heure('minigolf_blacklight', '16:30'), avantClic: collegueEcrit, secondClic: true, nom: 'autre-poste', cle: 'minigolf_blacklight' });
  ok(c.apres && !c.apres.fermee && /^Pas enregistré : la réservation a changé sur un autre poste entre-temps/.test(c.apres.verdict) && !c.apres.cadre && !c.apres.toast && c.reponses[0] === 409 && /Minigolf Blacklight 16:00 → 16:30/.test(c.apres.pied),
    '[C1] un autre poste a ecrit avant : le deplacement est refuse (409), la barre le dit une fois, la saisie reste', { apres: c.apres && { verdict: c.apres.verdict, cadre: c.apres.cadre, toast: c.apres.toast }, reponses: c.reponses });
  ok(c.second && c.second.fermee && c.reponses.join() === '409,200' && c.base.heures.minigolf_blacklight === '16:30' && /Note d’un autre poste/.test(c.base.notes),
    '[C1] un second « Enregistrer » passe sur la version du collegue : le minigolf a 16:30, sa note gardee', { second: c.second, reponses: c.reponses, base: c.base });
  ok(!c.erreurs.length, '[J1] aucune erreur JS (autre poste)', c.erreurs.slice(0, 3));
}

// [D1] AU TELEPHONE ET SUR TABLETTE : rien ne deborde, tout se touche au doigt.
async function scenarioAppareils(browser) {
  const mesure = async (page) => page.evaluate(() => {
    const m = document.querySelector('#posOverlay .edit-modal');
    const corps = m.querySelector('.edit-modal-body') || m;
    const boite = (n) => { const b = n.getBoundingClientRect(); return { l: Math.round(b.width), h: Math.round(b.height), droite: Math.round(b.right) }; };
    const largeur = document.documentElement.clientWidth;
    const debordent = Array.from(m.querySelectorAll('.fm-act, .fm-heure-champ, .fm-heure-refus, .fm-heure-suggestion, .fm-act-parties, .fm-pied')).filter((n) => n.getBoundingClientRect().right > largeur + 1).length;
    return {
      largeur, defile: corps.scrollWidth - corps.clientWidth, debordent,
      heures: Array.from(m.querySelectorAll('.fm-act-heure .fm-heure-touche')).map(boite),
      mots: Array.from(m.querySelectorAll('.fm-heure-mot.fm-heure-touche')).map(boite),
      propositions: Array.from(m.querySelectorAll('.fm-heure-suggestion')).map(boite),
      champs: Array.from(m.querySelectorAll('[data-heure-champ]')).map(boite),
    };
  });
  const vus = [];
  for (const appareil of ['telephone', 'tablette']) {
    const c = await jouerCas(browser, { id: LINA, appareil, geste: heure('minigolf_blacklight', '15:40'), enregistrer: false, mesure, nom: `appareil-${appareil}`, cle: 'minigolf_blacklight' });
    const d = c.mesures;
    const doigt = (liste, h, l) => liste.length > 0 && liste.every((b) => b.h >= h && b.l >= l);
    ok(d && d.defile <= 1 && d.debordent === 0, `[D1] ${appareil} (${d && d.largeur} px) : rien ne deborde de la fenetre`, d && { defile: d.defile, debordent: d.debordent });
    ok(d && doigt(d.heures, 40, 44) && doigt(d.mots, 36, 44) && doigt(d.propositions, 44, 64) && doigt(d.champs, 44, 100),
      `[D1] ${appareil} : chaque heure, chaque champ et chaque heure proposee se touche au doigt`, d && { heures: d.heures, mots: d.mots, propositions: d.propositions, champs: d.champs });
    ok(c.avant.ton === 'refus' && (refusA(c.avant, 'minigolf_blacklight') || {}).suggestions, `[D1] ${appareil} : le refus et ses heures proposees se lisent a l activite`, c.avant.refus);
    vus.push(c);
  }
  ok(vus.every((c) => !c.erreurs.length), '[J1] aucune erreur JS (telephone, tablette)', vus.flatMap((c) => c.erreurs).slice(0, 3));
}

// [P1] LA PORTE : sans session, le calcul a blanc des heures repond 401 sans rien lire.
async function scenarioPorte() {
  B.semer(FIXTURE.staffState.reservations.map(ligneDepuis));
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [] });
  serveur.changerSession(null);
  const demander = (id) => serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', deplacement: { id, baseUpdatedAt: 'x', activityMoves: [{ activityId: 'minigolf_blacklight', startTime: '16:30' }] } }).catch((e) => ({ statut: 500, json: { message: String(e && e.message) } }));
  const connu = await demander(LINA);
  const inconnu = await demander(999999);
  ok(connu.statut === 401 && inconnu.statut === 401 && JSON.stringify(connu.json) === JSON.stringify(inconnu.json) && !connu.json.deplacement,
    '[P1] sans session, le calcul a blanc des heures repond 401, la meme reponse que le dossier existe ou non', { connu, inconnu });
}

const PASSE = ['passe'];
const REFUS = ['refus'];
const MUTATIONS = [
  { nom: 'heure-pas-touchable', lettre: 'H1', scenarios: PASSE, editions: [{ fichier: JS, de: '  if (!cle || !peutChangerHeureEdition(state.selectedRes, activityId)) return `<span class="${classes}">${escapeHtml(heure)}</span>`;', vers: '  if (true) return `<span class="${classes}">${escapeHtml(heure)}</span>`;' }] },
  { nom: 'heure-pas-montree', lettre: 'H1', scenarios: PASSE, editions: [{ fichier: JS, de: '  modifs.push(...modifsHeuresEdition());\n', vers: '' }] },
  { nom: 'verdict-bavard', lettre: 'H1', scenarios: PASSE, editions: [{ fichier: JS, de: "  if (resultat && resultat.silencieux) return { ton: '', texte: '' };\n", vers: '' }] },
  { nom: 'enregistrer-par-le-dossier', lettre: 'H2', scenarios: PASSE, editions: [{ fichier: JS, de: '  if (Object.keys(heuresChangeesEdition()).length) { await enregistrerHeuresEdition(); return; }', vers: '' }] },
  { nom: 'serveur-sans-autre-activite', lettre: 'H2', scenarios: PASSE, editions: [{ fichier: MOVE, serveur: true, de: "  const autre = typeof activity === 'string' && activity !== 'bowling' && activity !== 'laser_game';", vers: '  const autre = false;' }] },
  { nom: 'historique-anonyme', lettre: 'H3', scenarios: PASSE, editions: [{ fichier: 'lib/historique-dossier.js', serveur: true, de: "    const autre = nomDeLActivite(String(deplacement.activityId || ''), etats) || 'une activité';", vers: "    const autre = 'une activité';" }] },
  { nom: 'parties-sans-mots', lettre: 'U1', scenarios: PASSE, editions: [{ fichier: JS, de: "  if (activityId !== 'laser_game' || !placees.length || partiesLaserDuDossier(placees) < 2) return '';", vers: "  if (true) return '';" }] },
  { nom: 'ordre-du-catalogue', lettre: 'O1', scenarios: PASSE, editions: [{ fichier: JS, de: '  }).filter(Boolean).sort((a, b) => a.ordre - b.ordre || a.rang - b.rang).map(rangee => rangee.html).join(\'\');', vers: "  }).filter(Boolean).map(rangee => rangee.html).join('');" }] },
  { nom: 'laser-d-un-bloc', lettre: 'L1', scenarios: PASSE, editions: [{ fichier: JS, de: "  if (etape.activityId === 'laser_game') return etape.unite ? `laser_game:${etape.unite}` : '';", vers: "  if (etape.activityId === 'laser_game') return 'laser_game';" }] },
  { nom: 'chevauchement-prevu-tu', lettre: 'L1', scenarios: PASSE, editions: [{ fichier: JS, de: '        if (!lignes.includes(phrase)) lignes.push(phrase);', vers: '' }] },
  { nom: 'pistes-oubliees', lettre: 'B1', scenarios: PASSE, editions: [{ fichier: JS, de: "      ? { activityId: 'bowling', startTime: heure, lanes: [...new Set(getBowlingWindowsFromReservation(r).flatMap(fenetre => fenetre.lanes || []))].map(Number).sort((a, b) => a - b) }", vers: "      ? { activityId: 'bowling', startTime: heure, lanes: [] }" }] },
  { nom: 'contact-oublie', lettre: 'M1', scenarios: PASSE, editions: [{ fichier: JS, de: '  const envoi = reste ? preparerModificationEdition() : null;', vers: '  const envoi = null;' }] },
  { nom: 'blanc-ecrit', lettre: 'V1', scenarios: PASSE, editions: [{ fichier: API, serveur: true, de: '    return { ok: true, dryRun: true, deplacement: true, reservation: candidat };', vers: '    await updateReservation({ id: current.id, centerId: centre, baseUpdatedAt: corps.baseUpdatedAt, activityMove: deplacements[0], modifiePar: \'Blanc\' });\n    return { ok: true, dryRun: true, deplacement: true, reservation: candidat };' }] },
  { nom: 'type-oublie', lettre: 'T1', scenarios: ['types'], editions: [{ fichier: JS, de: "  if (!activityId || activityId === 'party_table' || /^service_/.test(activityId)) return false;", vers: "  if (!activityId || activityId === 'party_table' || activityId === 'playground' || /^service_/.test(activityId)) return false;" }] },
  { nom: 'verdict-heures-muet', lettre: 'R1', scenarios: REFUS, editions: [{ fichier: JS, de: '      v.resultat = lireVerdictDeplacement(reponse, envoi);', vers: '      v.resultat = null;' }] },
  { nom: 'refus-en-double', lettre: 'U2', scenarios: REFUS, editions: [{ fichier: JS, de: "      noterHeuresEdition({ ton: 'refus', texte: `${deja}Pas enregistré : ${d.point.nom} à ${d.heure}.`, refus: { cle: d.cle, phrase: motif, suggestions: suggestionsConnuesEdition(d.cle) } });", vers: '      failEdit(motif);' }] },
  { nom: 'refus-pas-a-l-activite', lettre: 'U2', scenarios: REFUS, editions: [{ fichier: JS, de: '  return refus && refus.cle === cle ? refus : null;', vers: '  return null;' }] },
  { nom: 'plage-avec-tiret', lettre: 'F1', scenarios: REFUS, editions: [{ fichier: BASE, serveur: true, de: '  const horaire = (startHour, endHour) => `${minutesToClock(Math.round(startHour * 60))} à ${minutesToClock(Math.round(endHour * 60))}`;', vers: '  const horaire = (startHour, endHour) => `${minutesToClock(Math.round(startHour * 60))}-${minutesToClock(Math.round(endHour * 60))}`;' }] },
  { nom: 'suggestions-tues', lettre: 'S1', scenarios: REFUS, editions: [{ fichier: API, serveur: true, de: '        error.suggestions = heuresLibresProches(candidat, deplacement, auPlusTot, essayer);', vers: '        error.suggestions = [];' }] },
  { nom: 'heure-actuelle-proposee', lettre: 'S1', scenarios: REFUS, editions: [{ fichier: API, serveur: true, de: '    if (minutes < 0 || minutes >= 24 * 60 || minutes === actuelle || (auPlusTot !== null && minutes < auPlusTot)) return false;', vers: '    if (minutes < 0 || minutes >= 24 * 60 || (auPlusTot !== null && minutes < auPlusTot)) return false;' }] },
  { nom: 'chevauchement-ignore', lettre: 'R2', scenarios: REFUS, editions: [{ fichier: MOVE, serveur: true, de: ' || (autre && jeuAHeure(block))));', vers: '));' }] },
  { nom: 'arrivee-ignoree', lettre: 'R3', scenarios: REFUS, editions: [{ fichier: JS, de: "      : Number.isFinite(arrivee) && minutes < arrivee ? `Avant l’arrivée du groupe à ${formatClockDisplay(arrivee / 60)}.` : '';", vers: "      : '';" }] },
  { nom: 'fermeture-floue', lettre: 'R4', scenarios: REFUS, editions: [{ fichier: MOVE, serveur: true, de: '  if (tard) reject(`Hors des horaires d’ouverture : l’activité finirait à ${lisible(end(tard))}, le centre ferme à ${lisible(Math.round(schedule.close * 60))} ce jour-là.`);', vers: "  if (tard) reject('Cette activité ne tient pas dans les horaires d’ouverture.');" }] },
  { nom: 'blocages-ignores', lettre: 'R5', scenarios: REFUS, editions: [{ fichier: API, serveur: true, de: "      blocs = resolveBlocksForDate(await loadAvailabilityBlocks(require('../lib/database').getPool(), centre), current.date);", vers: '      blocs = [];' }] },
  { nom: 'passe-ignore', lettre: 'R6', scenarios: REFUS, editions: [{ fichier: JS, de: '    const plancher = maintenant !== null && minutes < maintenant', vers: '    const plancher = false && minutes < maintenant' }] },
  { nom: 'melange-refuse', lettre: 'M1', scenarios: REFUS, editions: [{ fichier: JS, de: '  const changees = heuresChangeesEdition();\n  const points = pointsHeureEdition(r);\n', vers: "  const changees = heuresChangeesEdition();\n  if (resumeModifsEdition().length > modifsHeuresEdition().length) return { heures: true, erreur: 'Une heure d’activité s’enregistre seule.' };\n  const points = pointsHeureEdition(r);\n" }] },
  { nom: 'conflit-mal-repris', lettre: 'C1', scenarios: ['conflit'], editions: [{ fichier: JS, de: '    if (error.conflit && error.reservation) {\n      // Un autre poste a ecrit avant', vers: '    if (false) {\n      // Un autre poste a ecrit avant' }] },
  { nom: 'doigt-trop-petit', lettre: 'D1', scenarios: ['appareils'], editions: [{ fichier: CSS, de: '  body:is(.staff-mode, .admin-mode) .fx-modal .fm-heure-suggestion { min-height: 44px; min-width: 72px; }\n', vers: '' }] },
  { nom: 'blanc-sans-porte', lettre: 'P1', scenarios: ['porte'], editions: [{ fichier: API, serveur: true, de: '        if (!(await requireAnyStaffSession(req, res))) return;\n        await warmCenterKnowledge();\n        const blanc = await deplacerABlanc(', vers: '        await warmCenterKnowledge();\n        const blanc = await deplacerABlanc(' }] },
];

async function jouer(browser, noms) {
  for (const nom of noms) {
    if (nom === 'passe') await scenarioPasse(browser);
    if (nom === 'types') await scenarioTypes(browser);
    if (nom === 'refus') await scenarioRefus(browser);
    if (nom === 'conflit') await scenarioConflit(browser);
    if (nom === 'appareils') await scenarioAppareils(browser);
    if (nom === 'porte') await scenarioPorte();
  }
}

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, (liste(process.env.HA_SCENARIOS) || ['passe', 'types', 'refus', 'conflit', 'appareils', 'porte']));
    } else {
      console.log('[K] contre-preuves : chaque garde retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.HA_MUTATIONS || liste(process.env.HA_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.HA_BAVARD;
        try {
          await jouer(browser, m.scenarios);
        } catch (e) { if (!(e instanceof Mordu)) rouges.push(`[${m.lettre}] crash ${e.message}`); }
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
  if (echecs) { console.error(`\nheure-activite-dossier-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nheure-activite-dossier-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
