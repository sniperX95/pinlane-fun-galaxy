// LE RETARD SE VOIT EN ROUGE, PARTOUT, ET RESTE APRES L ARRIVEE (2026-11-21).
//
// Le gerant : « quand on met quelqu un en retard, faut que ce soit super bien visible mais
// bien pro aussi, genre rouge bien visible, le temps bien visible, toutes les activites
// aussi, on doit comprendre que c est en retard ». Puis : le retard reste lisible apres
// « Arrivé » et « Payé », et un groupe pointe apres son heure, sans retard note, ouvre une
// fenetre qui dit le retard et la nouvelle heure de chaque activite, jugee par le serveur.
// Puis (le gerant, le 21/11) : « Arrivé » et « Payé » s enregistrent TOUT DE SUITE, en un geste,
// comme avant ; le serveur note le retard avec le statut ; la fenetre s ouvre ENSUITE pour
// proposer le decalage ; fermee, le statut et le retard note restent, seules les heures restent.
//   [A] AU PLANNING COMPLET, un groupe en retard (Hugo, attendu a 15:00, il est 15:20) : sa
//       ligne porte le filet rouge, CHAQUE case d activite aussi (filet et heure en rouge),
//       la pastille « En retard · 20 min » (rouge, AA) et « prévu 15:00 » ; la minute qui
//       passe la fait courir ; un groupe a l heure n a aucun rouge ; un seul rouge, le jeton
//       --danger (couleur calculee egale a celle du jeton), sans animation ; sa fiche (un
//       anniversaire, la table a 14:50) dit un seul nombre : le bandeau « En retard de 21 min ·
//       prévu à 15:00 », l etape d arrivee « Attendu à 15:00, il y a 21 min », et l en-tete garde
//       l arrivee conseillee, « Arrivée 14:50, début 15:00 » ;
//   [B] « Retard » DE LA FICHE (Louise, 16:00, a l heure) : +15 min ouvre la fenetre du
//       retard (le meme calcul), « Garder les heures » note le retard en une ecriture ; la
//       ligne, chaque case et la pastille « En retard · 15 min » sont rouges, la fiche dit
//       « En retard de 15 min · prévu à 16:00 » en rouge et marque son programme ;
//       le compteur « En retard » la compte et y mene ;
//   [C] LA FENETRE APRES L ARRIVEE (Hugo, le minigolf bloque de 16:20 a 16:40) : « Arrivé »
//       s ecrit tout de suite, un PATCH de statut seul, le groupe arrive en base avec son retard
//       de 20 min note, les heures intactes ; la fenetre s ouvre ENSUITE, « Arrivé avec 20 min de
//       retard » ; le minigolf « Ne passe pas », sa raison en mots, les arcades passent ; pas de
//       « Tout décaler » ; « Décaler ce qui passe » ecrit les heures seules, sans statut, le
//       retard compte une fois, le minigolf garde 16:05 ; la marque « Arrivé avec 20 min de
//       retard » reste rouge sur la ligne, chaque case et la fiche, et l historique la dit ;
//       apres « Payé » aussi, sans nouvelle fenetre ;
//   [D] LA PLAINE EST LIBRE TOUTE LA JOURNEE (le gerant, le 21/11 : « il n'y a pas d'heure, c'est
//       vraiment libre tout le temps ») : Hugo, sa plaine bloquee de 15:15 a 15:45 ; la fenetre ne
//       la montre pas et ne dit jamais « Ne passe pas » pour elle ; tout passe, « Tout décaler »,
//       le statut d abord puis une ecriture des heures ; la plaine garde 15:00, le programme de la
//       fiche la dit « Libre » ;
//   [H] LA BULLE « ILS ARRIVENT DANS » DU PLANNING : la meme fenetre, jamais l ancien plan en
//       cascade (il deplacait d autres groupes) ; « Garder les heures » n ecrit que ce dossier ;
//   [S] L ENCHAINEMENT (le gerant, le 21/11) : un F1 serre (Bowling 13:15, Arcades 30 min dans la
//       formule mais 15 au plan, Laser 14:30), « Retard » +15 min puis « Tout décaler » : chaque
//       activite garde sa vraie duree, les arcades finissent avant le laser (pousse a 15:00),
//       aucun chevauchement ; des arcades en credits passent « libre », sans heure ;
//   [P] « PAYÉ » EN RETARD (Clara, bowling a 15:00, la piste 6 prise a 16:30) : paye tout de
//       suite, le retard note avec ; la fenetre ensuite : son bowling manque (15:00, avant son
//       arrivee a 15:20) n est pas « commence », il se propose a 15:20 (a la minute, le 22/11 :
//       scripts/retard-minute-check.js) et ne passe pas ;
//       « Garder les heures » seul, il ferme sans rien ecrire ; le bowling garde son heure, la
//       marque reste ;
//   [E] UN GROUPE A L HEURE (Sacha) : « Arrivé » n ouvre aucune fenetre, aucun rouge apres ;
//   [F] LE SERVEUR : la simulation n ecrit rien ; « Tout décaler » avec une heure qui ne passe
//       pas est refuse (409) et rien ne s ecrit, ni le statut, ni le retard, ni une heure ;
//   [G] UNE ACTIVITE COMMENCEE EST GELEE (le gerant, le 21/11 : un retard avait deplace un
//       groupe en pleine partie, de la piste 1 a la piste 5) : un groupe joue piste 1 depuis
//       10 min, un autre arrive en retard et demande « Tout décaler » : refuse, « Bowling 15:30 :
//       la piste 1 est prise par un groupe qui joue. », la piste 1 et son heure ne bougent pas ;
//       un groupe sur place garde son bowling commence, seule la suite se decale ; l ancien plan
//       en cascade (applyReservationScheduleUpdates) refuse de deplacer le groupe qui joue ;
//   [T] AU TELEPHONE (390 px) : la fenetre tient dans l ecran, ses boutons pleine largeur et
//       au doigt (44 px), la fiche ne deborde pas ; la croix la ferme : le statut et le retard
//       note restent ecrits, seules les heures ne bougent pas ;
//   [U] UN TOUCHER SUR « ARRIVÉ » RESTE ANNULABLE : la fenetre s ouvre par-dessus le toast
//       « Annuler », dont le delai ne court pas tant qu elle est ouverte ; fermee, « Annuler »
//       se touche et marche : le groupe redevient attendu, le retard que ce pointage avait note
//       s efface, la ligne redit « En retard · 20 min » ;
//   [J] aucune erreur JS.
// La vraie console (scripts/planning-v3-fixtures.js, samedi « pic » de Fun Galaxy Libramont
// a 15:20) ; ses PATCH et ses calculs a blanc partent au VRAI handler api/staff-reservations.js,
// sur la base en memoire de scripts/reserver-banc.js (aucune base reelle, aucun reseau).
// --contre-preuves : chaque regle retiree (au texte servi ou compile en memoire, le disque
// n est jamais touche) fait rougir sa lettre ; chaque ancre existe une fois et une seule.
//   RV_MUTATIONS : un sous-ensemble ; RV_BAVARD : les lignes des contre-preuves ;
//   RV_CAPTURES=<dossier> : la ligne en retard, le planning, sa fiche, la fenetre (une activite
//   qui ne passe pas, puis tout qui passe), la marque gardee apres « Payé ».
'use strict';
const fs = require('fs');
const path = require('path');
// La base en memoire et le faux 'pg' s installent au require, avant tout module de lib/.
const B = require('./reserver-banc.js');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
// 6811 : aucun autre gate ne le prend.
const PORT = Number(process.env.PINLANE_RETARD_VISIBLE_PORT || 6811);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CAPTURES = process.env.RV_CAPTURES || '';
const JS = 'assets/app-main.js';
const PG = 'assets/pinlane-planning-global.js';
const PGC = 'assets/pinlane-planning-global.css';
const LIB = 'lib/retard-arrivee.js';
const BASE = 'lib/database.js';
const liste = (v) => (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : null);

const HUGO = 1602; // 15:00 : Playground 15:00, Minigolf Blacklight 16:05, Arcades 16:55 (table 14:50)
const CLARA = 1634; // bowling 15:00 a 16:30, pistes 6 et 7 (la 6 est prise a 16:30)
const SACHA = 1604; // bowling 15:30 : a l heure a 15:20
const LOUISE = 1605; // bowling 16:00 : a l heure, son retard se note par « Retard »
const HEURE = '15:20';
const SACHA_F1 = 1604; // le F1 de la journee, reecrit serre pour [S]

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
  for (const ed of mutation.editions) if (ed.fichier === rel && !ed.serveur) t = t.replace(ed.de, () => ed.vers);
  return t;
}

// ---------------------------------------------------------------------------
// LA BASE : la journee de la fixture, en colonnes ; un blocage d activite au besoin.
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
const BLOC_PLAINE = { id: 91, center_id: 'libramont', scope_type: 'activity', scope_ref: 'playground', recurrence: 'once', date: JOUR, day_of_week: null, date_from: null, date_until: null, start_time: '15:15', end_time: '15:45', reason: 'Entretien', created_by: 'gate' };
const BLOC_MINIGOLF = { ...BLOC_PLAINE, id: 92, scope_ref: 'minigolf_blacklight', start_time: '16:20', end_time: '16:40' };
let BLOCS = [];
const pgBanc = require(require.resolve('pg', { paths: [ROOT] }));
const requeteAvant = pgBanc.Client.prototype.query;
const DATES = ['created_at', 'updated_at', 'paid_at', 'absent_at'];
const copie = (row) => JSON.parse(JSON.stringify(row), (k, v) => (DATES.includes(k) && v ? new Date(v) : v));
pgBanc.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (/ from availability_blocks /.test(s) && /scope_type/.test(s) && BLOCS.length) return { rows: JSON.parse(JSON.stringify(BLOCS)), rowCount: BLOCS.length };
  // LE STATUT SEUL (setReservationStatus) : la base du banc ne le jouait pas ; meme ligne, meme
  // transaction que l UPDATE complet du banc.
  if (/^update reservations set status = \$2, payment_method = \$3, updated_at = now\(\) where id = \$1 returning \*;?$/.test(s)) {
    const tx = this.tx && !this.tx.abandonnee ? this.tx : null;
    const id = Number(params[0]);
    const avant = (tx && tx.reservations.get(id)) || B.base.reservations.get(id);
    if (!avant) return { rows: [], rowCount: 0 };
    const row = { ...avant, status: params[1], payment_method: params[2], updated_at: new Date(Math.max(Date.now(), new Date(avant.updated_at).getTime() + 1)) };
    if (tx) tx.reservations.set(id, row); else B.base.reservations.set(id, row);
    return { rows: [copie(row)], rowCount: 1 };
  }
  return requeteAvant.call(this, sql, params);
};
function enBase(id) {
  const row = B.base.reservations.get(Number(id));
  if (!row) return null;
  const plan = typeof row.ops_plan === 'string' ? JSON.parse(row.ops_plan) : (row.ops_plan || {});
  const heures = {};
  (plan.timeline || []).filter((s) => s && s.type === 'activity' && !s.flexible && s.startTime && s.activityId !== 'laser_game').forEach((s) => { if (!heures[s.activityId]) heures[s.activityId] = s.startTime; });
  (plan.resourceBlocks || []).filter((b) => b && b.resourceType === 'bowling_lane').forEach((b) => { if (!heures.bowling || b.startTime < heures.bowling) heures.bowling = b.startTime; });
  const f = plan.delayFlag || null;
  return { statut: row.status, moyen: row.payment_method || '', heures, retard: f && !f.cleared ? { minutes: f.minutes, de: f.from, a: f.to } : null, version: new Date(row.updated_at).toISOString() };
}

// ---------------------------------------------------------------------------
// LE MONTAGE : la console a 15:20, le vrai handler derriere chaque PATCH et chaque calcul
// a blanc ; ce qui part est note.
// ---------------------------------------------------------------------------
// L HEURE DU SERVEUR EST CELLE DE LA CONSOLE (2026-11-21) : le serveur note le retard d un groupe
// pointe apres son heure (lib/retard-arrivee.js, retardALArrivee), a l heure du centre ; sur le
// banc, sa montre est reglee sur celle de la page (UTC+1 en janvier), puis rendue (jouer).
let horlogeVraie = null;
function reglerHorlogeServeur(hhmm) {
  const montre = require(path.join(ROOT, LIB)).__horloge;
  if (!horlogeVraie) horlogeVraie = { montre, instant: montre.instant };
  const [h, m] = hhmm.split(':').map(Number);
  montre.instant = () => new Date(`${JOUR}T${String(h - 1).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
}
function rendreHorlogeServeur() {
  if (horlogeVraie) horlogeVraie.montre.instant = horlogeVraie.instant;
  horlogeVraie = null;
}
async function monter(browser, { blocs = [], appareil = 'ordinateur', theme = 'light', heure = HEURE, reecrire = null } = {}) {
  const journee = FIXTURE.staffState.reservations.map((r) => (reecrire ? reecrire(r) : r));
  B.semer(journee.map(ligneDepuis));
  BLOCS = blocs;
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  reglerHorlogeServeur(heure);
  const patchs = [];
  const blancs = [];
  const { ctx, page, erreurs } = await FX.monter(browser, {
    fixture: 'pic', appareil, theme, port: PORT, heure, variante: ['sansdemo'],
    avantChargement: async (p) => {
      await p.exposeFunction('__fixtureServeur', async (corps) => { patchs.push(corps); return serveur.appeler('PATCH', '/api/staff-reservations', corps); });
      await p.exposeFunction('__fixtureBlanc', async (corps) => { blancs.push(corps); return serveur.appeler('POST', '/api/staff-reservations', corps); });
    },
  });
  if (reecrire) {
    const changes = journee.filter((r, i) => r !== FIXTURE.staffState.reservations[i]);
    await page.evaluate((liste) => {
      liste.forEach((r) => {
        const jour = window.__FIXTURE__.jours[window.__FIXTURE__.jour];
        const i = jour.findIndex((x) => x.id === r.id);
        if (i >= 0) jour[i] = Object.assign({}, r);
        const j = state.reservations.findIndex((x) => x.id === r.id);
        if (j >= 0) state.reservations[j] = Object.assign({}, r);
      });
      renderStaff();
    }, changes);
    await FX.repos(page, 200);
  }
  return { ctx, page, erreurs, serveur, patchs, blancs };
}

// LE F1 SERRE (2026-11-21, le cas du gerant) : Bowling 13:15 a 14:15 (piste 8), les arcades
// posees 15 min au plan (14:15 a 14:30) quand la formule en vend 30, le laser a 14:30. 6 joueurs.
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function f1Serre(r) {
  if (r.id !== SACHA_F1) return r;
  const c = JSON.parse(JSON.stringify(r));
  const pose = (b, debut, fin) => Object.assign(b, { start: debut, end: fin, startTime: hm(debut), endTime: hm(fin) });
  c.startTime = '13:15';
  c.pax = 6;
  c.lanes = [8];
  const p = c.opsPlan;
  p.resourceBlocks.forEach((b) => {
    if (b.resourceType === 'bowling_lane') { pose(b, 795, 855); b.lanes = [8]; b.players = 6; }
    if (b.resourceType === 'laser_arena') { pose(b, 870, 895); b.players = 6; }
  });
  p.timeline = p.timeline.filter((b) => b.type !== 'service');
  let boissons = 0;
  p.timeline.forEach((b) => {
    if (b.activityId === 'bowling') { pose(b, 795, 855); b.players = 6; if (Array.isArray(b.lanes)) b.lanes = [8]; }
    if (b.activityId === 'arcade_time') pose(b, 855, 870);
    if (b.activityId === 'laser_game') { pose(b, 870, 895); b.players = 6; }
    if (b.activityId === 'service_drinks') { pose(b, 935 + boissons * 5, 940 + boissons * 5); boissons += 1; }
  });
  Object.assign(p, { assignedLanes: [8], startTime: '13:15', endTime: '15:45' });
  return c;
}
async function photo(page, nom, selecteur = '') {
  if (!CAPTURES || mutation) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  const cible = selecteur ? page.locator(selecteur).first() : null;
  if (cible && await cible.count()) await cible.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
  else await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

// Ce que la page montre, lu sur ses vrais noeuds. D : le jeton --danger, resolu.
const LIRE = `
  window.__rv = window.__rv || {};
  __rv.jeton = (nom) => { const p = document.createElement('span'); p.style.color = 'var(' + nom + ')'; (document.getElementById('globalPlanningGridWrap') || document.body).appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  __rv.rgb = (c) => (String(c).match(/[\\d.]+/g) || []).map(Number);
  __rv.lum = (c) => { const [r, g, b] = __rv.rgb(c).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  __rv.fond = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; const a = __rv.rgb(c); if (a.length >= 3 && (a.length < 4 || a[3] > 0.5)) return c; } return 'rgb(255, 255, 255)'; };
  __rv.contraste = (el) => { if (!el) return 0; const a = __rv.lum(getComputedStyle(el).color); const b = __rv.lum(__rv.fond(el)); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; };
  __rv.ligne = (id) => {
    const D = __rv.jeton('--danger');
    const tr = document.querySelector('#globalPlanningGridWrap .gf-r[data-gf-id="' + id + '"]');
    if (!tr) return null;
    const cs = (el, p) => (el ? getComputedStyle(el)[p] : '');
    const pill = tr.querySelector('[data-gf-retard]');
    const arrive = tr.querySelector('.gf-h__retard.is-arrive');
    // (le groupe seul : la case de la demi-heure, « Bowling complet », dit la journee, pas le groupe)
    const rougeTexte = [...tr.querySelectorAll('td.gf-nom *, td.gf-a *')].filter((el) => el.childElementCount === 0 && el.textContent.trim() && getComputedStyle(el).color === D).map((el) => el.textContent.trim());
    const anime = [...tr.querySelectorAll('*')].some((el) => getComputedStyle(el).animationName !== 'none' && /retard|rt/.test(el.className && el.className.baseVal === undefined ? el.className : ''));
    return {
      D, cls: tr.className, barre: cs(tr.querySelector('td.gf-h'), 'backgroundColor'), filet: cs(tr.querySelector('td.gf-nom'), 'boxShadow'),
      cases: [...tr.querySelectorAll('td.gf-a .gf-x')].map((x) => ({ titre: x.closest('td').getAttribute('data-gf-titre'), ombre: cs(x, 'boxShadow'), heure: cs(x.querySelector('.gf-x__t'), 'color'), t: (x.querySelector('.gf-x__t') || x).textContent.trim() })),
      pastille: pill ? pill.textContent : '', pastilleCouleur: cs(pill, 'color'), pastilleAA: __rv.contraste(pill),
      prevu: (tr.querySelector('.gf-h__prevu') || {}).textContent || '',
      arrive: arrive ? arrive.textContent : '', arriveCouleur: cs(arrive, 'color'), arriveAA: __rv.contraste(arrive),
      rougeTexte, anime,
    };
  };
  __rv.fiche = (id) => {
    if (typeof closePos === 'function') closePos();
    openPos(id);
    const D = __rv.jeton('--danger');
    const b = document.querySelector('#posOverlay .fz-retard');
    const titre = b ? b.querySelector('.fz-retard__titre') : null;
    const etapes = [...document.querySelectorAll('#posOverlay .fx-programme .gc-step')];
    const corps = document.querySelector('#posOverlay .edit-modal');
    const lire = (el) => (el ? el.textContent.replace(/\\s+/g, ' ').trim() : '');
    return {
      D, texte: b ? b.textContent.replace(/\\s+/g, ' ').trim() : '', etat: b ? b.getAttribute('data-retard-etat') : '',
      etapeArrivee: lire(document.querySelector('#posOverlay .fz-arrivee .fx-moment')), tete: lire(document.querySelector('#posOverlay .dossier-head')),
      couleur: titre ? getComputedStyle(titre).color : '', aa: __rv.contraste(titre), premier: Boolean(b && b === b.parentElement.firstElementChild),
      etapes: etapes.map((li) => ({ ombre: getComputedStyle(li).boxShadow, heure: li.querySelector('.gc-step-time:not(.is-free)') ? getComputedStyle(li.querySelector('.gc-step-time:not(.is-free)')).color : '' })),
      deborde: corps ? corps.scrollWidth > corps.clientWidth + 1 : false,
      notesRetard: Boolean(document.querySelector('#posOverlay .gc-retard')),
    };
  };
  __rv.fenetre = () => {
    const f = document.querySelector('#retardFenetre .rt-fenetre');
    if (!f) return null;
    const bleu = __rv.jeton('--console-selected');
    const r = f.getBoundingClientRect();
    return {
      titre: f.querySelector('.rt-titre').textContent, sous: f.querySelector('.rt-sous').textContent, etat: f.querySelector('.rt-etat').textContent,
      // (la nouvelle heure est un champ depuis le 22/11 : sa valeur se lit a sa place)
      etapes: [...f.querySelectorAll('.rt-etape')].map((li) => ({ cle: li.getAttribute('data-rt-cle'), nom: li.querySelector('.rt-etape__nom').textContent, heures: [...li.querySelector('.rt-etape__heures').childNodes].map((n) => (n.nodeName === 'INPUT' ? n.value : n.textContent)).join('').replace(/\\s+/g, ' ').trim(), mot: li.querySelector('.rt-etape__mot').textContent, raison: (li.querySelector('.rt-etape__raison') || {}).textContent || '' })),
      boutons: [...f.querySelectorAll('.rt-pied button')].map((b) => { const q = b.getBoundingClientRect(); return { t: b.textContent, choix: b.getAttribute('data-rt-choix'), plein: b.classList.contains('est-plein'), fond: getComputedStyle(b).backgroundColor, bleu, haut: Math.round(q.height), large: Math.round(q.width) }; }),
      titreCouleur: getComputedStyle(f.querySelector('.rt-titre')).color, titreAA: __rv.contraste(f.querySelector('.rt-titre')),
      cadre: { g: Math.round(r.left), d: Math.round(r.right), h: Math.round(r.top), b: Math.round(r.bottom), large: Math.round(r.width) }, vue: { l: window.innerWidth, h: window.innerHeight },
      deborde: f.scrollWidth > f.clientWidth + 1 || document.documentElement.scrollWidth > window.innerWidth + 1,
      modal: f.getAttribute('role') === 'dialog' && f.getAttribute('aria-modal') === 'true',
    };
  };
  true;
`;
const lireLigne = (page, id) => page.evaluate(`(${'() => { ' + LIRE + ' return __rv.ligne(' + Number(id) + '); }'})()`);
const lireFiche = (page, id) => page.evaluate(`(${'() => { ' + LIRE + ' return __rv.fiche(' + Number(id) + '); }'})()`);
const lireFenetre = (page) => page.evaluate(`(${'() => { ' + LIRE + ' return __rv.fenetre(); }'})()`);
const fermerFiche = (page) => page.evaluate(() => { if (typeof closePos === 'function') closePos(); });
const attendreVerdict = (page) => page.waitForFunction(() => document.querySelector('#retardFenetre .rt-fenetre') && !document.querySelector('#retardFenetre .rt-etape.is-calcul') && !/Vérification/.test(document.querySelector('#retardFenetre .rt-etat').textContent), null, { timeout: 8000 }).catch(() => null);
const attendreFermee = (page) => page.waitForFunction(() => !document.getElementById('retardFenetre'), null, { timeout: 8000 }).catch(() => null);
const minutesDe = (t) => { const m = /^En retard · (\d+) min$/.exec(String(t || '').trim()); return m ? Number(m[1]) : NaN; };
// En cours, la barre du statut passe au rouge ; arrive, un filet rouge longe le groupe.
const rouge = (ligne) => Boolean(ligne) && (/\bis-rt-arrive\b/.test(ligne.cls) ? ligne.filet.includes(ligne.D) : ligne.barre === ligne.D);
const casesRouges = (ligne, avecHeure) => Boolean(ligne) && ligne.cases.length > 0 && ligne.cases.every((c) => c.ombre.includes(ligne.D) && (!avecHeure || c.heure === ligne.D));
const sansRouge = (ligne) => Boolean(ligne) && !/\bis-rt/.test(ligne.cls) && ligne.barre !== ligne.D && !ligne.filet.includes(ligne.D) && ligne.cases.every((c) => !c.ombre.includes(ligne.D) && c.heure !== ligne.D) && !ligne.pastille && !ligne.arrive && ligne.rougeTexte.length === 0;
// Ce qui est en base au bout de l ecriture (le PATCH part, le vrai handler ecrit ensuite).
async function attendreBase(id, cond, ms = 6000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (cond(enBase(id))) return true; await new Promise((fin) => setTimeout(fin, 50)); }
  return false;
}
async function cliquerArrive(page, id) {
  await page.locator(`#globalPlanningGridWrap [data-gf-arrive="${id}"]`).first().click();
  await FX.repos(page, 200);
}

// ---------------------------------------------------------------------------
// [A] [B] [E] : le planning a 15:20 ; Hugo en retard, Sacha et Louise a l heure.
// ---------------------------------------------------------------------------
async function scenarioPlanning(browser) {
  const { ctx, page, erreurs, serveur, patchs } = await monter(browser);
  try {
    const hugo = await lireLigne(page, HUGO);
    ok(rouge(hugo) && /\bis-rt\b/.test(hugo.cls), '[A] la ligne du groupe en retard porte le filet rouge du jeton --danger', hugo && { cls: hugo.cls, barre: hugo.barre, D: hugo.D });
    ok(casesRouges(hugo, true) && hugo.cases.length >= 3, '[A] CHAQUE case d activite du groupe porte le rouge (filet et heure)', hugo && hugo.cases);
    ok(minutesDe(hugo && hugo.pastille) === 20 && hugo.pastilleCouleur === hugo.D, '[A] la pastille dit « En retard · 20 min », en rouge', hugo && { p: hugo.pastille, c: hugo.pastilleCouleur });
    ok(hugo && /prévu 15:00/.test(hugo.prevu), '[A] l heure prevue se lit a cote : « prévu 15:00 »', hugo && hugo.prevu);
    ok(hugo && hugo.pastilleAA >= 4.5, '[A] la pastille passe le contraste AA (4,5:1)', hugo && hugo.pastilleAA);
    ok(hugo && !hugo.anime, '[A] ni clignotement ni animation sur le retard');
    await photo(page, 'ligne-en-retard', `#globalPlanningGridWrap .gf-r[data-gf-id="${HUGO}"]`);
    for (const id of [SACHA, LOUISE]) {
      const l = await lireLigne(page, id);
      ok(sansRouge(l), `[A] un groupe a l heure (${id}) n a aucun rouge`, l && { cls: l.cls, barre: l.barre, rouges: l.rougeTexte, cases: l.cases });
    }
    // La minute qui passe : la pastille court.
    await page.clock.setFixedTime(FX.instant(JOUR, '15:21'));
    await page.evaluate(() => tickHorlogeStaff());
    await FX.repos(page, 200);
    const apresMinute = await lireLigne(page, HUGO);
    ok(minutesDe(apresMinute && apresMinute.pastille) === 21, '[A] la pastille se met a jour en direct : 21 min une minute plus tard', apresMinute && apresMinute.pastille);
    const ficheHugo = await lireFiche(page, HUGO);
    ok(/^En retard de 21 min · prévu à 15:00/.test(ficheHugo.texte) && ficheHugo.etat === 'encours' && ficheHugo.couleur === ficheHugo.D && ficheHugo.aa >= 4.5,
      '[A] la fiche du groupe en retard : le bandeau rouge « En retard de 21 min · prévu à 15:00 » (AA)', ficheHugo);
    ok(ficheHugo.etapes.length >= 3 && ficheHugo.etapes.every((e) => e.ombre.includes(ficheHugo.D)) && ficheHugo.etapes.filter((e) => e.heure).every((e) => e.heure === ficheHugo.D),
      '[A] chaque activite du programme de la fiche porte le rouge', ficheHugo.etapes);
    ok(ficheHugo.etapeArrivee === 'Attendu à 15:00, il y a 21 min' && /Arrivée 14:50, début 15:00/.test(ficheHugo.tete),
      '[A] l anniversaire avec table : l etape d arrivee dit « Attendu à 15:00, il y a 21 min », l heure et le nombre du bandeau ; l en-tete garde « Arrivée 14:50 », l heure conseillee', { etape: ficheHugo.etapeArrivee, tete: ficheHugo.tete.slice(0, 140) });
    await photo(page, 'fiche-groupe-en-retard', '#posOverlay .edit-modal');
    await fermerFiche(page);

    // [E] Sacha, a l heure : « Arrivé » n ouvre aucune fenetre, et rien ne rougit apres.
    const avantSacha = patchs.length;
    await cliquerArrive(page, SACHA);
    await attendreBase(SACHA, (b) => b.statut === 'arrived');
    await FX.repos(page, 200);
    const fenetreSacha = await lireFenetre(page);
    const envoiSacha = patchs.slice(avantSacha);
    const sacha = await lireLigne(page, SACHA);
    ok(!fenetreSacha && envoiSacha.length === 1 && envoiSacha[0].status === 'arrived' && !('retard' in envoiSacha[0]) && enBase(SACHA).statut === 'arrived',
      '[E] un groupe a l heure : « Arrivé » s ecrit tout de suite, sans fenetre ni retard', { fenetreSacha, envoiSacha });
    ok(sansRouge(sacha), '[E] apres « Arrivé », le groupe a l heure n a toujours aucun rouge', sacha && { cls: sacha.cls, rouges: sacha.rougeTexte });

    // [B] Louise, a l heure : « Retard » de la fiche, +15 min, la fenetre, « Garder les heures ».
    await page.evaluate((id) => { closePos(); openPos(id); }, LOUISE);
    await page.locator('#posOverlay .fx-outil-retard').click();
    await page.locator(`#fxRetard${LOUISE} .delay-chip`, { hasText: '+15 min' }).click();
    await attendreVerdict(page);
    const fenetreLouise = await lireFenetre(page);
    ok(fenetreLouise && fenetreLouise.titre === 'Retard de 15 min' && fenetreLouise.modal && fenetreLouise.etapes.length >= 2 && fenetreLouise.etapes.every((e) => /^(Passe|Ne passe pas)$/.test(e.mot)),
      '[B] « Retard » +15 min ouvre la fenetre du retard : chaque activite, sa nouvelle heure jugee par le serveur', fenetreLouise);
    const avantLouise = patchs.length;
    await page.locator('#retardFenetre [data-rt-choix="garder"]').click();
    await attendreFermee(page);
    await FX.repos(page, 250);
    const envoiLouise = patchs.slice(avantLouise);
    const baseLouise = enBase(LOUISE);
    ok(envoiLouise.length === 1 && envoiLouise[0].retard && envoiLouise[0].retard.choix === 'garder' && !envoiLouise[0].status && baseLouise.retard && baseLouise.retard.minutes === 15 && baseLouise.retard.de === '16:00' && baseLouise.heures.bowling === '16:00' && baseLouise.statut === 'pending',
      '[B] « Garder les heures » note le retard en une ecriture, les heures restent', { envoiLouise, baseLouise });
    await fermerFiche(page);
    const louise = await lireLigne(page, LOUISE);
    ok(rouge(louise) && casesRouges(louise, true) && minutesDe(louise.pastille) === 15 && louise.pastilleCouleur === louise.D && /prévu 16:00/.test(louise.prevu),
      '[B] le groupe mis en retard : sa ligne, chaque case et la pastille « En retard · 15 min · prévu 16:00 » en rouge', louise);
    const ficheLouise = await lireFiche(page, LOUISE);
    ok(/^En retard de 15 min · prévu à 16:00/.test(ficheLouise.texte) && ficheLouise.couleur === ficheLouise.D && ficheLouise.premier && !ficheLouise.notesRetard && ficheLouise.etapes.every((e) => e.ombre.includes(ficheLouise.D)),
      '[B] sa fiche : le bandeau rouge en tete, le programme marque, les notes ne le repetent pas', ficheLouise);
    await fermerFiche(page);
    await photo(page, 'planning-groupe-en-retard', '#globalPlanningBox');
    // Le compteur « En retard » les compte et y mene.
    const compteur = await page.evaluate(() => { const c = document.querySelector('.gf-c[data-gf-filtre="late"]'); return c ? Number((c.querySelector('.gf-c__v') || {}).textContent) : NaN; });
    await page.locator('.gf-c[data-gf-filtre="late"]').click();
    await FX.repos(page, 300);
    const filtre = await page.evaluate(() => [...document.querySelectorAll('#globalPlanningGridWrap .gf-r[data-gf-id]')].map((tr) => ({ id: Number(tr.getAttribute('data-gf-id')), rt: /\bis-rt\b/.test(tr.className) })));
    ok(filtre.some((l) => l.id === LOUISE) && filtre.some((l) => l.id === HUGO) && !filtre.some((l) => l.id === SACHA) && filtre.length === compteur && filtre.filter((l) => [LOUISE, HUGO].includes(l.id)).every((l) => l.rt),
      '[B] le compteur « En retard » compte le groupe mis en retard et mene a ces groupes', { compteur, filtre });
    await page.evaluate(() => setStaffStatusFilter('all'));
    ok(erreurs.length === 0, '[J] aucune erreur JS (planning)', erreurs);
    void serveur;
  } finally { await ctx.close(); }
}

// ---------------------------------------------------------------------------
// [C] la fenetre a l arrivee, une activite qui ne passe pas ; puis « Payé ».
// ---------------------------------------------------------------------------
async function scenarioArrivee(browser) {
  const { ctx, page, erreurs, serveur, patchs, blancs } = await monter(browser, { blocs: [BLOC_MINIGOLF] });
  try {
    const depart = enBase(HUGO);
    await cliquerArrive(page, HUGO);
    await attendreVerdict(page);
    const f = await lireFenetre(page);
    const pointe = enBase(HUGO);
    const parNom = (n) => (f && f.etapes.find((e) => e.cle === n || e.nom === n)) || null;
    ok(patchs.length === 1 && Object.keys(patchs[0]).filter((k) => !['id', 'centerId', 'baseUpdatedAt'].includes(k)).join() === 'status' && patchs[0].status === 'arrived'
      && pointe.statut === 'arrived' && pointe.retard && pointe.retard.minutes === 20 && pointe.retard.de === '15:00' && JSON.stringify(pointe.heures) === JSON.stringify(depart.heures),
    '[C] « Arrivé » s ecrit tout de suite, en un geste : un PATCH de statut seul, le groupe arrive en base, son retard de 20 min note avec, les heures intactes', { patchs, pointe, depart: depart.heures });
    ok(f && f.titre === 'Arrivé avec 20 min de retard' && f.modal && /prévu à 15:00, il est 15:20/.test(f.sous) && /noté/.test(f.sous) && blancs.some((b) => b.dryRun === true && b.retard && b.retard.minutes === 20 && b.retard.de === '15:00'),
      '[C] la fenetre du retard s ouvre ENSUITE : « Arrivé avec 20 min de retard », prévu à 15:00, jugee par le serveur', { f, blancs: blancs.length });
    const minigolf = parNom('minigolf_blacklight');
    const arcades = parNom('arcade_time');
    ok(minigolf && minigolf.mot === 'Ne passe pas' && /16:05 → 16:25/.test(minigolf.heures) && /16:2\d/.test(minigolf.raison) && /Reste à 16:05/.test(minigolf.raison),
      '[C] le minigolf ne passe pas : sa raison en mots, il garde 16:05', minigolf);
    ok(arcades && arcades.mot === 'Passe' && /16:55 → 17:15/.test(arcades.heures) && f.etapes.length === 2,
      '[C] les arcades passent (17:15) ; la plaine, libre, n est pas dans la fenetre', f && f.etapes);
    const choix = f ? f.boutons.map((b) => b.choix) : [];
    const principal = f ? f.boutons.find((b) => b.plein) : null;
    ok(choix.join() === 'garder,passe' && principal && principal.choix === 'passe' && principal.fond === principal.bleu && f.boutons.find((b) => b.choix === 'garder').fond !== principal.bleu,
      '[C] pas de « Tout décaler » ; « Décaler ce qui passe » en bleu plein, « Garder les heures » encadre', f && f.boutons);
    ok(f && f.titreCouleur && f.titreAA >= 4.5, '[C] le titre de la fenetre en rouge lisible (AA)', f && f.titreAA);
    await photo(page, 'fenetre-retard-une-passe-une-non', '#retardFenetre .rt-fenetre');
    await page.locator('#retardFenetre [data-rt-choix="passe"]').click();
    await attendreFermee(page);
    await FX.repos(page, 300);
    const base = enBase(HUGO);
    const decale = patchs[1] || {};
    ok(patchs.length === 2 && !('status' in decale) && decale.retard && decale.retard.choix === 'passe' && decale.retard.dejaNote === true && decale.retard.cles.join() === 'arcade_time',
      '[C] « Décaler ce qui passe » : un PATCH des heures seules, sans statut, sur le retard deja note', patchs);
    ok(base.statut === 'arrived' && base.retard && base.retard.minutes === 20 && base.retard.de === '15:00' && base.heures.playground === '15:00' && base.heures.minigolf_blacklight === '16:05' && base.heures.arcade_time === '17:15',
      '[C] en base : arrive, retard de 20 min compte une fois, arcades 17:15, le minigolf garde 16:05, la plaine 15:00', base);
    const ligne = await lireLigne(page, HUGO);
    ok(ligne && /\bis-rt-arrive\b/.test(ligne.cls) && rouge(ligne) && casesRouges(ligne, false) && ligne.arrive === 'Arrivé avec 20 min de retard' && ligne.arriveCouleur === ligne.D && ligne.arriveAA >= 4.5 && !ligne.pastille,
      '[C] apres « Arrivé », la marque reste : filet, chaque case et « Arrivé avec 20 min de retard » en rouge', ligne);
    const fiche = await lireFiche(page, HUGO);
    ok(/^Arrivé avec 20 min de retard · prévu à 15:00/.test(fiche.texte) && fiche.etat === 'arrive' && fiche.couleur === fiche.D && fiche.etapes.every((e) => e.ombre.includes(fiche.D)),
      '[C] la fiche garde la marque rouge « Arrivé avec 20 min de retard », le programme aussi', fiche);
    const H = require(path.join(ROOT, 'lib/historique-dossier.js'));
    const dit = (action) => { const a = serveur.journal.audits.find((x) => x.action === action); const e = a ? H.entreeDuJournal({ ...a, occurredAt: new Date(), outcome: 'success' }, String(HUGO)) : null; return e ? e.quoi : []; };
    const histoire = { pointage: dit('setReservationStatus'), decalage: dit('noterRetard') };
    ok(histoire.pointage.some((q) => /^Arrivé avec 20 min de retard/.test(q)) && histoire.decalage.some((q) => /^Heures décalées du retard de 20 min, sauf celles qui ne passaient pas/.test(q)),
      '[C] l historique du dossier le dit : « Arrivé avec 20 min de retard », puis les heures decalees', histoire);
    // « Payé » : la marque reste.
    await page.locator('#posOverlay .res-status-btn.paid', { hasText: 'Carte' }).first().click();
    await attendreBase(HUGO, (b) => b.statut === 'paid');
    await FX.repos(page, 300);
    const payee = enBase(HUGO);
    const fichePayee = await lireFiche(page, HUGO);
    await fermerFiche(page);
    const lignePayee = await lireLigne(page, HUGO);
    ok(payee.statut === 'paid' && payee.retard && payee.retard.minutes === 20 && !(await lireFenetre(page)), '[C] « Payé » ensuite : paye, sans nouvelle fenetre, le retard reste note', payee);
    ok(/^Arrivé avec 20 min de retard/.test(fichePayee.texte) && fichePayee.couleur === fichePayee.D && lignePayee && lignePayee.arrive === 'Arrivé avec 20 min de retard' && casesRouges(lignePayee, false),
      '[C] apres « Payé », la marque reste rouge sur la fiche, la ligne et chaque case', { fichePayee, lignePayee });
    ok(erreurs.length === 0, '[J] aucune erreur JS (arrivee)', erreurs);
  } finally { BLOCS = []; await ctx.close(); }
}

// ---------------------------------------------------------------------------
// [D] la plaine libre, tout passe ; [P] « Payé » en retard, rien ne passe.
// ---------------------------------------------------------------------------
async function scenarioToutEtPaye(browser) {
  // (la plaine bloquee de 15:15 a 15:45 : libre toute la journee, elle ne compte pas)
  const { ctx, page, erreurs, patchs } = await monter(browser, { blocs: [BLOC_PLAINE] });
  try {
    await cliquerArrive(page, HUGO);
    await attendreVerdict(page);
    const f = await lireFenetre(page);
    const plaine = f ? f.etapes.filter((e) => e.cle === 'playground' || /plaine|playground/i.test(e.nom + ' ' + e.raison)) : [];
    ok(f && plaine.length === 0 && !f.etapes.some((e) => e.mot === 'Ne passe pas'),
      '[D] la plaine de jeux, libre toute la journee : jamais dans la fenetre, jamais « Ne passe pas »', f && f.etapes);
    ok(f && f.etapes.map((e) => e.cle).join() === 'minigolf_blacklight,arcade_time' && f.etapes.every((e) => e.mot === 'Passe') && f.boutons.map((b) => b.choix).join() === 'garder,tout' && f.boutons.find((b) => b.choix === 'tout').plein,
      '[D] tout passe : « Tout décaler » en bleu plein, et « Garder les heures »', f);
    await photo(page, 'fenetre-retard-tout-passe', '#retardFenetre .rt-fenetre');
    await page.locator('#retardFenetre [data-rt-choix="tout"]').click();
    await attendreFermee(page);
    await FX.repos(page, 300);
    const base = enBase(HUGO);
    ok(patchs.length === 2 && patchs[0].status === 'arrived' && !patchs[0].retard && patchs[1].retard && patchs[1].retard.choix === 'tout' && patchs[1].retard.dejaNote === true && !('status' in patchs[1])
      && base.statut === 'arrived' && base.retard && base.retard.minutes === 20 && base.heures.playground === '15:00' && base.heures.minigolf_blacklight === '16:25' && base.heures.arcade_time === '17:15',
    '[D] « Tout décaler » : le statut d abord, puis une ecriture des heures ; le minigolf et les arcades decales, la plaine reste', { patchs, base });
    const programme = await page.evaluate((id) => {
      closePos();
      openPos(id);
      const li = [...document.querySelectorAll('#posOverlay .fx-programme .gc-step')].find((x) => /plaine|playground/i.test(x.textContent));
      const t = li ? li.querySelector('.gc-step-time') : null;
      const dit = t ? t.textContent.replace(/\s+/g, ' ').trim() : '';
      closePos();
      return { vu: Boolean(li), libre: Boolean(t && t.classList.contains('is-free')), dit };
    }, HUGO);
    ok(programme.vu && programme.libre && /^Libre\b/.test(programme.dit) && !/\d{2}:\d{2}/.test(programme.dit),
      '[D] au programme de la fiche, la plaine dit « Libre », sans heure', programme);
    const caseReserver = await page.evaluate(() => (typeof rsCaseDuContenuHtml === 'function' ? rsCaseDuContenuHtml({ texte: 'Accès à la plaine de jeux', id: '' }) : ''));
    ok(/is-libre/.test(caseReserver) && />libre</.test(caseReserver) && !/\d{2}:\d{2}|data-heure-bouton/.test(caseReserver),
      '[D] dans Réserver, la case de la plaine d une formule dit « libre », sans heure a choisir', caseReserver);
    // [P] Clara, en retard, paie : payee tout de suite, la fenetre ensuite, rien ne passe.
    await page.evaluate((id) => { closePos(); openPos(id); }, CLARA);
    const avantClara = patchs.length;
    await page.locator('#posOverlay .res-status-btn.paid', { hasText: 'Carte' }).first().click();
    await attendreVerdict(page);
    const g = await lireFenetre(page);
    const paye = patchs.slice(avantClara);
    const payee = enBase(CLARA);
    ok(paye.length === 1 && paye[0].status === 'paid' && paye[0].paymentMethod === 'Carte Bancaire' && !paye[0].retard && payee.statut === 'paid' && payee.retard && payee.retard.minutes === 20 && payee.heures.bowling === '15:00',
      '[P] « Payé » s ecrit tout de suite, en un geste, son retard de 20 min note avec', { paye, payee });
    ok(g && g.titre === 'Arrivé avec 20 min de retard' && g.etapes.length === 1 && g.etapes[0].mot === 'Ne passe pas' && /15:00 → 15:20/.test(g.etapes[0].heures) && g.etapes[0].raison.length > 20 && g.boutons.map((b) => b.choix).join() === 'garder' && g.boutons[0].plein,
      '[P] la fenetre s ouvre ensuite ; le bowling manque se propose a 15:20, a la minute, et ne passe pas, sa raison ; « Garder les heures » seul', g);
    await page.locator('#retardFenetre [data-rt-choix="garder"]').click();
    await attendreFermee(page);
    await FX.repos(page, 300);
    const clara = enBase(CLARA);
    ok(patchs.length === avantClara + 1 && clara.statut === 'paid' && clara.moyen === 'Carte Bancaire' && clara.retard && clara.retard.minutes === 20 && clara.heures.bowling === '15:00',
      '[P] « Garder les heures » ferme sans rien ecrire : payee par carte, le retard note, le bowling garde 15:00', { clara, patchs: patchs.slice(avantClara) });
    const fiche = await lireFiche(page, CLARA);
    await fermerFiche(page);
    const ligne = await lireLigne(page, CLARA);
    ok(/^Arrivé avec 20 min de retard/.test(fiche.texte) && fiche.couleur === fiche.D && ligne && ligne.arrive === 'Arrivé avec 20 min de retard' && casesRouges(ligne, false),
      '[P] la marque reste apres « Payé » : fiche, ligne, chaque case', { fiche, ligne });
    const rangee = `#globalPlanningGridWrap .gf-r[data-gf-id="${CLARA}"]`;
    if (CAPTURES && !mutation) await page.locator(rangee).first().scrollIntoViewIfNeeded().catch(() => null);
    await photo(page, 'marque-apres-paye', rangee);
    ok(erreurs.length === 0, '[J] aucune erreur JS (tout et paye)', erreurs);
  } finally { await ctx.close(); }
}

// ---------------------------------------------------------------------------
// [F] le serveur seul : la simulation n ecrit rien ; « tout » refuse ce qui ne passe pas.
// ---------------------------------------------------------------------------
async function scenarioServeur() {
  B.semer(FIXTURE.staffState.reservations.map(ligneDepuis));
  BLOCS = [BLOC_MINIGOLF];
  try {
    const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
    const hugo = FIXTURE.staffState.reservations.find((x) => x.id === HUGO);
    const toutes = ['minigolf_blacklight', 'arcade_time'];
    const depart = JSON.stringify(enBase(HUGO));
    const sim = await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', retard: { id: HUGO, baseUpdatedAt: hugo.updatedAt, minutes: 20, de: '15:00' } });
    ok(sim.statut === 200 && sim.json.retard === true && sim.json.etapes.map((e) => `${e.cle}:${e.apres}:${e.passe}`).join() === 'minigolf_blacklight:16:25:false,arcade_time:17:15:true' && JSON.stringify(enBase(HUGO)) === depart,
      '[F] la simulation juge chaque heure et n ecrit rien', { statut: sim.statut, json: sim.json });
    const tout = await serveur.appeler('PATCH', '/api/staff-reservations', { id: HUGO, centerId: 'libramont', baseUpdatedAt: hugo.updatedAt, status: 'arrived', retard: { minutes: 20, de: '15:00', choix: 'tout', cles: toutes } });
    ok(tout.statut === 409 && JSON.stringify(enBase(HUGO)) === depart, '[F] « Tout décaler » avec une heure qui ne passe pas : refuse, rien ne s ecrit (ni statut, ni retard, ni heure)', { statut: tout.statut, json: tout.json, base: enBase(HUGO) });
    const sansVersion = await serveur.appeler('PATCH', '/api/staff-reservations', { id: HUGO, centerId: 'libramont', status: 'arrived', retard: { minutes: 20, de: '15:00', choix: 'garder', cles: [] } });
    const camille = FIXTURE.staffState.reservations.find((x) => x.id === 1603);
    const credits = await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', retard: { id: 1603, baseUpdatedAt: camille.updatedAt, minutes: 20, de: '15:30' } });
    const arcadesCredits = (credits.json.etapes || []).find((e) => e.activityId === 'arcade_credit');
    ok(arcadesCredits && arcadesCredits.libre === true && arcadesCredits.apres === '' && arcadesCredits.passe === true, '[S] des arcades vendues en credits passent « libre », sans heure', credits.json);
    ok(sansVersion.statut >= 400 && JSON.stringify(enBase(HUGO)) === depart, '[F] sans la version du dossier, rien ne s ecrit', sansVersion);
    // Le bar pointe et encaisse, il ne deplace rien au planning : il note le retard, sans decaler.
    serveur.changerSession(B.sessionDuRole('staff-bar', { nom: 'Lou' }));
    const bar = await serveur.appeler('PATCH', '/api/staff-reservations', { id: HUGO, centerId: 'libramont', baseUpdatedAt: hugo.updatedAt, status: 'arrived', retard: { minutes: 20, de: '15:00', choix: 'passe', cles: toutes.slice(1) } });
    ok(bar.statut === 403 && JSON.stringify(enBase(HUGO)) === depart, '[F] decaler une heure demande le droit du glisser du planning : refuse au bar, rien d ecrit', { statut: bar.statut, json: bar.json });
    const barGarde = await serveur.appeler('PATCH', '/api/staff-reservations', { id: HUGO, centerId: 'libramont', baseUpdatedAt: hugo.updatedAt, status: 'arrived', retard: { minutes: 20, de: '15:00', choix: 'garder', cles: [] } });
    const apresBar = enBase(HUGO);
    ok(barGarde.statut === 200 && apresBar.statut === 'arrived' && apresBar.retard && apresBar.retard.minutes === 20 && apresBar.heures.minigolf_blacklight === '16:05' && apresBar.heures.playground === '15:00',
      '[F] le bar pointe le groupe et note son retard, les heures restent', { statut: barGarde.statut, json: barGarde.json, base: apresBar });
  } catch (error) {
    if (error instanceof Mordu) throw error;
    ok(false, '[F] le serveur repond', error.message);
  } finally { BLOCS = []; }
}

// ---------------------------------------------------------------------------
// [S] l enchainement : le F1 serre, « Retard » +15 min, « Tout décaler ».
// ---------------------------------------------------------------------------
function heuresDuPlan(id) {
  const row = B.base.reservations.get(Number(id));
  const plan = typeof row.ops_plan === 'string' ? JSON.parse(row.ops_plan) : (row.ops_plan || {});
  const mn = (v) => { const m = /^(\d{2}):(\d{2})$/.exec(String(v || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
  const jeux = [...(plan.resourceBlocks || []), ...(plan.timeline || []).filter((b) => b.type === 'activity' && b.activityId !== 'bowling' && b.activityId !== 'laser_game' && !/^service_/.test(b.activityId))]
    .filter((b) => b && b.flexible !== true && b.startTime).map((b) => ({ id: b.activityId || (b.resourceType === 'bowling_lane' ? 'bowling' : 'laser_game'), debut: mn(b.startTime), fin: mn(b.endTime) }))
    .sort((a, b) => a.debut - b.debut);
  return jeux;
}
async function scenarioEnchainement(browser) {
  const { ctx, page, erreurs, patchs } = await monter(browser, { heure: '13:05', reecrire: f1Serre });
  try {
    await page.evaluate((id) => { closePos(); openPos(id); }, SACHA_F1);
    await page.locator('#posOverlay .fx-outil-retard').click();
    await page.locator(`#fxRetard${SACHA_F1} .delay-chip`, { hasText: '+15 min' }).click();
    await attendreVerdict(page);
    const f = await lireFenetre(page);
    const dit = f ? f.etapes.map((e) => `${e.cle} ${e.heures} ${e.mot}`) : [];
    ok(f && dit.join(' | ') === 'bowling 13:15 → 13:30 Passe | arcade_time 14:15 → 14:30 Passe | laser_game:1.1 14:30 → 15:00 Passe' && f.boutons.map((b) => b.choix).join() === 'garder,tout',
      '[S] la fenetre pousse le laser apres les 30 min d arcades : bowling 13:30, arcades 14:30, laser 15:00', f && f.etapes);
    await page.locator('#retardFenetre [data-rt-choix="tout"]').click();
    await attendreFermee(page);
    await FX.repos(page, 250);
    const jeux = heuresDuPlan(SACHA_F1);
    const de = (id) => jeux.find((j) => j.id === id) || {};
    const arcades = de('arcade_time');
    const laser = de('laser_game');
    const chevauche = jeux.some((j, i) => i > 0 && j.debut < jeux[i - 1].fin);
    ok(patchs.length === 1 && patchs[0].retard.choix === 'tout' && de('bowling').debut === 810 && arcades.debut === 870 && laser.debut === 900,
      '[S] « Tout décaler » : une ecriture, bowling 13:30, arcades 14:30, laser 15:00', jeux.map((j) => `${j.id} ${hm(j.debut)}-${hm(j.fin)}`));
    ok(Number.isFinite(laser.debut) && laser.debut >= arcades.debut + 30 && !chevauche,
      '[S] les arcades (30 min) finissent avant le laser, aucun chevauchement du groupe', jeux.map((j) => `${j.id} ${hm(j.debut)}-${hm(j.fin)}`));
    ok(erreurs.length === 0, '[J] aucune erreur JS (enchainement)', erreurs);
  } finally { await ctx.close(); }
}

// ---------------------------------------------------------------------------
// [G] LES ACTIVITES COMMENCEES SONT GELEES (2026-11-21, vu en vrai par le gerant : un retard a
// deplace un autre groupe en pleine partie, de la piste 1 a la piste 5). Le serveur seul, a
// l heure du centre reglee.
// ---------------------------------------------------------------------------
const pistesDuPlan = (id) => {
  const row = B.base.reservations.get(Number(id));
  const plan = typeof row.ops_plan === 'string' ? JSON.parse(row.ops_plan) : (row.ops_plan || {});
  return JSON.stringify({ statut: row.status, lanes: row.lanes, blocs: (plan.resourceBlocks || []).filter((b) => b.resourceType === 'bowling_lane').map((b) => `${b.startTime}-${b.endTime}:${b.lanes}`) });
};
// La Famille Louise (A) joue piste 1 depuis 15:00 ; les Amis de Clara (B), attendus piste 1 de
// 14:30 a 15:00, arrivent a 15:10. La piste 1 n a personne d autre de 14:30 a 16:00.
function gelPiste1(r) {
  const pose = (b, debut, fin, lanes) => Object.assign(b, { start: debut, end: fin, startTime: hm(debut), endTime: hm(fin) }, lanes ? { lanes } : {});
  const ids = { [LOUISE]: [900, 960, [1]], [CLARA]: [870, 900, [1]] };
  if (!ids[r.id] && r.id !== SACHA && r.id !== 1596) return r;
  const c = JSON.parse(JSON.stringify(r));
  const bowling = (b) => b && (b.resourceType === 'bowling_lane' || b.activityId === 'bowling');
  if (ids[r.id]) {
    const [debut, fin, lanes] = ids[r.id];
    c.startTime = hm(debut);
    c.lanes = lanes;
    [...c.opsPlan.resourceBlocks, ...c.opsPlan.timeline].filter(bowling).forEach((b) => pose(b, debut, fin, lanes));
    if (r.id === LOUISE) c.status = 'arrived';
    return c;
  }
  // (Sacha a 15:30 et le groupe de 14:00 gardent la piste 2 seule)
  c.lanes = [2];
  [...c.opsPlan.resourceBlocks, ...c.opsPlan.timeline].filter(bowling).forEach((b) => { if (Array.isArray(b.lanes)) b.lanes = [2]; });
  return c;
}
async function scenarioGel() {
  let montre = null;
  let vraie = null;
  const regler = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); montre.instant = () => new Date(`${JOUR}T${String(h - 1).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`); };
  try {
    // [G] un AUTRE groupe joue : il ne bouge pas, l heure qui tomberait sur sa piste ne passe pas.
    const journee = FIXTURE.staffState.reservations.map(gelPiste1);
    B.semer(journee.map(ligneDepuis));
    BLOCS = [];
    const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
    montre = require(path.join(ROOT, LIB)).__horloge;
    vraie = montre.instant;
    regler('15:10'); // (UTC+1 en janvier)
    const clara = journee.find((x) => x.id === CLARA);
    const departA = pistesDuPlan(LOUISE);
    const departB = JSON.stringify(enBase(CLARA));
    const sim = await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', retard: { id: CLARA, baseUpdatedAt: clara.updatedAt, minutes: 40, de: '14:30' } });
    const bowling = ((sim.json && sim.json.etapes) || []).find((e) => e.cle === 'bowling');
    ok(bowling && bowling.apres === '15:10' && bowling.passe === false && bowling.raison === 'Bowling 15:10 : la piste 1 est prise par un groupe qui joue.' && pistesDuPlan(LOUISE) === departA,
      '[G] la fenetre : « Bowling 15:10 : la piste 1 est prise par un groupe qui joue. », rien ne bouge', sim.json);
    const tout = await serveur.appeler('PATCH', '/api/staff-reservations', { id: CLARA, centerId: 'libramont', baseUpdatedAt: clara.updatedAt, status: 'arrived', retard: { minutes: 40, de: '14:30', choix: 'tout', cles: ['bowling'] } });
    ok(tout.statut === 409 && pistesDuPlan(LOUISE) === departA && JSON.stringify(enBase(CLARA)) === departB,
      '[G] « Tout décaler » refuse : la piste 1 du groupe qui joue ne bouge pas, ni sa piste ni son heure, rien ne s ecrit', { statut: tout.statut, json: tout.json, a: pistesDuPlan(LOUISE) });
    const garder = await serveur.appeler('PATCH', '/api/staff-reservations', { id: CLARA, centerId: 'libramont', baseUpdatedAt: clara.updatedAt, status: 'arrived', retard: { minutes: 40, de: '14:30', choix: 'garder', cles: [] } });
    const b = enBase(CLARA);
    ok(garder.statut === 200 && pistesDuPlan(LOUISE) === departA && b.statut === 'arrived' && b.retard && b.retard.minutes === 40 && b.heures.bowling === '14:30',
      '[G] « Garder les heures » : le retard note, le groupe qui joue garde sa piste 1 et son heure', { statut: garder.statut, json: garder.json, a: pistesDuPlan(LOUISE), b });
    // L ANCIEN PLAN EN CASCADE (api/ops.js delayApply, l assistant s en sert encore) : le defaut vu en
    // vrai, le groupe qui joue pousse de la piste 1 a la piste 5. Refuse, rien ne bouge.
    const a = journee.find((x) => x.id === LOUISE);
    const plan5 = JSON.parse(JSON.stringify(a.opsPlan));
    [...plan5.resourceBlocks, ...plan5.timeline].filter((x) => x && (x.resourceType === 'bowling_lane' || x.activityId === 'bowling')).forEach((x) => { x.lanes = [5]; });
    let refusCascade = null;
    try {
      await require(path.join(ROOT, BASE)).applyReservationScheduleUpdates({ centerId: 'libramont', date: JOUR, updates: [{ id: LOUISE, startTime: '15:00', lanes: [5], opsPlan: plan5 }] });
    } catch (error) { refusCascade = error; }
    ok(refusCascade && refusCascade.statusCode === 409 && /joue, il ne bouge pas/.test(refusCascade.message) && pistesDuPlan(LOUISE) === departA,
      '[G] l ancien plan en cascade ne pousse pas le groupe qui joue de la piste 1 a la piste 5 : refuse, rien ne bouge', { message: refusCascade && refusCascade.message, a: pistesDuPlan(LOUISE) });

    // [G] le groupe EN RETARD lui-meme, sur place : son bowling commence ne bouge pas, la suite oui.
    const f1 = FIXTURE.staffState.reservations.map(f1Serre).map((r) => (r.id === SACHA_F1 ? { ...r, status: 'arrived' } : r));
    B.semer(f1.map(ligneDepuis));
    const serveur2 = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
    montre = require(path.join(ROOT, LIB)).__horloge;
    if (!vraie) vraie = montre.instant;
    regler('13:25');
    const sacha = f1.find((x) => x.id === SACHA_F1);
    const sim2 = await serveur2.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', retard: { id: SACHA_F1, baseUpdatedAt: sacha.updatedAt, minutes: 15, de: '13:15' } });
    const dit = ((sim2.json && sim2.json.etapes) || []).map((e) => `${e.cle} ${e.apres} ${e.passe}`).join(' | ');
    // (2026-11-24, le gerant : « quand on met en retard manuellement ca decale pas » : un retard pose a la main dit que
    // le groupe n etait pas la ; son bowling pas coche se decale aussi, retards-planning [C] garde le coche « fait »)
    ok(dit === 'bowling 13:30 true | arcade_time 14:30 true | laser_game:1.1 15:00 true', '[G] retard pose a la main sur un groupe pointe : le bowling 13:30, les arcades 14:30, le laser 15:00', sim2.json);
    const tout2 = await serveur2.appeler('PATCH', '/api/staff-reservations', { id: SACHA_F1, centerId: 'libramont', baseUpdatedAt: sacha.updatedAt, retard: { minutes: 15, de: '13:15', choix: 'tout', cles: ['bowling', 'arcade_time', 'laser_game:1.1'] } });
    const jeux = heuresDuPlan(SACHA_F1);
    const de = (id) => jeux.find((j) => j.id === id) || {};
    ok(tout2.statut === 200 && de('bowling').debut === 810 && de('bowling').fin === 870 && /"lanes":\[8\]/.test(pistesDuPlan(SACHA_F1)) && de('arcade_time').debut === 870 && de('laser_game').debut === 900,
      '[G] « Tout décaler » : le bowling garde sa piste 8 et part a 13:30, la suite suit', { statut: tout2.statut, json: tout2.json, jeux: jeux.map((j) => `${j.id} ${hm(j.debut)}-${hm(j.fin)}`), pistes: pistesDuPlan(SACHA_F1) });
  } catch (error) {
    if (error instanceof Mordu) throw error;
    ok(false, '[G] le serveur repond', error.message);
  } finally { if (montre && vraie) montre.instant = vraie; }
}

// ---------------------------------------------------------------------------
// [H] la bulle « Ils arrivent dans » du planning : la fenetre du retard, ce dossier seul.
// ---------------------------------------------------------------------------
async function scenarioBulle(browser) {
  const { ctx, page, erreurs, patchs, blancs } = await monter(browser);
  try {
    const autres = () => JSON.stringify([...B.base.reservations.values()].filter((row) => Number(row.id) !== HUGO).map((row) => [row.id, new Date(row.updated_at).toISOString(), row.start_time, row.lanes]));
    const avantAutres = autres();
    await page.locator(`#globalPlanningGridWrap [data-gf-retarder="${HUGO}"]`).first().click();
    await FX.repos(page, 200);
    const bulle = await page.evaluate(() => [...document.querySelectorAll('.staff-action-popover button')].map((b) => b.textContent.trim()));
    ok(bulle.join() === '10 min,20 min,30 min', '[H] le retard du planning ouvre sa bulle « Ils arrivent dans » : 10, 20, 30 min', bulle);
    await page.locator('.staff-action-popover button', { hasText: '10 min' }).click();
    await attendreVerdict(page);
    const f = await lireFenetre(page);
    const ancien = await page.evaluate(() => { const o = document.getElementById('delayOverlay'); return Boolean(o && !o.classList.contains('hidden') && o.innerHTML.trim()); });
    ok(f && f.titre === 'Retard de 30 min' && f.modal && f.etapes.length >= 1 && !ancien && blancs.some((x) => x.dryRun && x.retard && Number(x.retard.id) === HUGO && x.retard.minutes === 30),
      '[H] « 10 min » : la fenetre du retard (les 20 min qui courent + 10), jugee au serveur ; jamais l ancien plan en cascade', { f, ancien, blancs: blancs.length });
    await page.locator('#retardFenetre [data-rt-choix="garder"]').click();
    await attendreFermee(page);
    await FX.repos(page, 250);
    const base = enBase(HUGO);
    ok(patchs.length === 1 && patchs[0].retard && patchs[0].retard.choix === 'garder' && base.retard && base.retard.minutes === 30 && autres() === avantAutres,
      '[H] « Garder les heures » : une ecriture, ce dossier seul, aucun autre groupe ne bouge', { patchs, base });
    ok(erreurs.length === 0, '[J] aucune erreur JS (bulle)', erreurs);
  } finally { await ctx.close(); }
}

// ---------------------------------------------------------------------------
// [T] au telephone, 390 px.
// ---------------------------------------------------------------------------
async function scenarioTelephone(browser) {
  const { ctx, page, erreurs, patchs } = await monter(browser, { appareil: 'telephone', blocs: [BLOC_MINIGOLF] });
  try {
    await page.evaluate((id) => { closePos(); openPos(id); }, HUGO);
    const fiche = await lireFiche(page, HUGO);
    ok(/^En retard de 20 min/.test(fiche.texte) && !fiche.deborde, '[T] au telephone, le bandeau de la fiche se lit sans deborder', fiche);
    const depart = enBase(HUGO);
    await page.locator('#posOverlay .fz-arrivee-ligne').first().click();
    await attendreVerdict(page);
    const f = await lireFenetre(page);
    ok(f && f.cadre.g >= 0 && f.cadre.d <= f.vue.l && f.cadre.b <= f.vue.h + 1 && !f.deborde && f.boutons.length >= 2 && f.boutons.every((b) => b.haut >= 44 && b.large >= f.cadre.large - 40),
      '[T] au telephone, la fenetre tient dans l ecran, ses boutons pleine largeur et au doigt', f && { cadre: f.cadre, vue: f.vue, boutons: f.boutons, deborde: f.deborde });
    const principal = f ? f.boutons[f.boutons.length - 1] : null;
    ok(principal && principal.plein, '[T] au telephone, le bouton principal en bas', f && f.boutons);
    await page.locator('#retardFenetre .rt-fermer').click();
    await attendreFermee(page);
    await FX.repos(page, 200);
    const base = enBase(HUGO);
    ok(patchs.length === 1 && patchs[0].status === 'arrived' && !patchs[0].retard && base.statut === 'arrived' && base.retard && base.retard.minutes === 20 && JSON.stringify(base.heures) === JSON.stringify(depart.heures),
      '[T] la croix ferme la fenetre : le statut et le retard note restent, seules les heures ne bougent pas', { patchs, base, depart: depart.heures });
    ok(erreurs.length === 0, '[J] aucune erreur JS (telephone)', erreurs);
  } finally { BLOCS = []; await ctx.close(); }
}

// ---------------------------------------------------------------------------
// [U] un toucher sur « Arrivé » reste annulable, la fenetre du retard ouverte par-dessus.
// ---------------------------------------------------------------------------
const lireToast = (page) => page.evaluate(() => {
  const t = document.getElementById('toast');
  const b = t ? t.querySelector('.toast-annuler') : null;
  const r = b ? b.getBoundingClientRect() : null;
  const dessus = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
  return { vu: Boolean(t && !t.classList.contains('hidden')), texte: t ? t.textContent.replace(/\s+/g, ' ').trim() : '', annuler: Boolean(b), touchable: Boolean(b && dessus && (dessus === b || b.contains(dessus))) };
});
async function scenarioAnnuler(browser) {
  const { ctx, page, erreurs, patchs } = await monter(browser);
  try {
    const depart = enBase(HUGO);
    await cliquerArrive(page, HUGO);
    await attendreVerdict(page);
    const fenetre = await lireFenetre(page);
    const pendant = await lireToast(page);
    // (plus que les 6 s du toast, la fenetre ouverte)
    await page.waitForTimeout(6800);
    const apresDelai = await lireToast(page);
    ok(fenetre && fenetre.titre === 'Arrivé avec 20 min de retard' && pendant.vu && pendant.annuler && apresDelai.vu && apresDelai.annuler && /arrivé/.test(apresDelai.texte),
      '[U] la fenetre ouverte apres « Arrivé », le toast « Annuler » attend : son delai ne court pas tant qu elle est ouverte', { titre: fenetre && fenetre.titre, pendant, apresDelai });
    await page.locator('#retardFenetre .rt-fermer').click();
    await attendreFermee(page);
    const ferme = await lireToast(page);
    await page.locator('#toast .toast-annuler').click({ timeout: 3000 }).catch(() => null);
    await attendreBase(HUGO, (b) => b.statut === 'pending');
    await FX.repos(page, 300);
    const base = enBase(HUGO);
    const retour = patchs[1] || {};
    ok(ferme.vu && ferme.touchable && patchs.length === 2 && retour.status === 'pending' && !retour.retard && base.statut === 'pending' && !base.retard && JSON.stringify(base.heures) === JSON.stringify(depart.heures),
      '[U] fermee, « Annuler » se touche et marche : le groupe redevient attendu, le retard que ce pointage avait note s efface', { ferme, patchs, base });
    const ligne = await lireLigne(page, HUGO);
    ok(ligne && /\bis-rt\b/.test(ligne.cls) && minutesDe(ligne.pastille) === 20 && !ligne.arrive,
      '[U] la ligne redit « En retard · 20 min », sans la marque « Arrivé avec »', ligne && { cls: ligne.cls, pastille: ligne.pastille, arrive: ligne.arrive });
    ok(erreurs.length === 0, '[J] aucune erreur JS (annuler)', erreurs);
  } finally { await ctx.close(); }
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  { nom: 'cases-sans-rouge', lettre: 'A', scenarios: ['planning'], editions: [
    { fichier: PGC, de: '.gf-r.is-rt .gf-a .gf-x { box-shadow: inset 3px 0 0 var(--danger); }\n', vers: '' },
    { fichier: PGC, de: '.gf-r.is-rt .gf-a .gf-x .gf-x__t { background: var(--danger-soft); color: var(--danger); font-weight: 700; }\n', vers: '' },
  ] },
  { nom: 'minutes-absentes', lettre: 'A', scenarios: ['planning'], editions: [{ fichier: PG, de: "      var texte = 'En retard · ' + (typeof dureeDuRetard === 'function' ? dureeDuRetard(min) : min + ' min');", vers: "      var texte = 'En retard';" }] },
  { nom: 'groupe-a-l-heure-en-rouge', lettre: 'A', scenarios: ['planning'], editions: [{ fichier: JS, de: '    if (!(moment && moment.late) && !annonce) return null;', vers: '' }] },
  { nom: 'fiche-sans-bandeau', lettre: 'A', scenarios: ['planning'], editions: [{ fichier: JS, de: '    ${bandeauBloquant || ficheBandeauRetard(r, moment)}\n', vers: '    ${bandeauBloquant}\n' }] },
  // L etape d arrivee qui compte depuis la table d anniversaire (« Attendu à 14:50, il y a 31 min »).
  { nom: 'etape-fiche-depuis-la-table', lettre: 'A', scenarios: ['planning'], editions: [{ fichier: JS, de: '  if (moment && moment.late) return `Attendu à ${formatClockDisplay(prevuDuRetard)}, il y a ${dureeDuRetard(Math.max(1, Math.round((moment.now - prevuDuRetard) * 60)))}`;', vers: '  if (moment && moment.late) return `Attendu à ${formatClockDisplay(moment.item.start)}, il y a ${formatStaffTerrainDelay(moment.now - moment.item.start)}`;' }] },
  { nom: 'fenetre-absente', lettre: 'C', scenarios: ['arrivee'], editions: [{ fichier: JS, de: "    if (note) ouvrirFenetreRetard(payload.reservation, { mode: 'arrivee', minutes: note.minutes, de: note.from });\n", vers: '' }] },
  // (la regle du 21/11 retiree : la fenetre s ouvre avant le statut, qui attend le choix)
  { nom: 'fenetre-avant-le-statut', lettre: 'C', scenarios: ['arrivee'], editions: [{ fichier: JS, de: "  if (isReservationMutationInFlight(id, 'status', status)) return;", vers: "  if (['arrived', 'paid'].includes(status) && !options.sansAnnulation && isUpcomingReservationStatus(current.status)) { ouvrirFenetreRetard(current, { mode: 'annonce', minutes: 20 }); return; }\n  if (isReservationMutationInFlight(id, 'status', status)) return;" }] },
  // (le statut s ecrit sans son retard : fermee, la fenetre ne laisse plus le retard note)
  { nom: 'retard-pas-note-avec-le-statut', lettre: 'T', scenarios: ['telephone'], editions: [{ fichier: BASE, serveur: true, de: '    const retard = retardALArrivee(current, { status: input.status });', vers: '    const retard = null;' }] },
  // (le decalage apres l arrivee rajoute les minutes deja notees : 40 au lieu de 20)
  { nom: 'retard-compte-deux-fois', lettre: 'C', scenarios: ['arrivee'], editions: [{ fichier: LIB, serveur: true, de: '  if (dejaNote && existant && !existant.cleared) {', vers: '  if (false) {' }] },
  // [U] le toast « Annuler » qui court sous la fenetre : passe le delai, il a disparu.
  { nom: 'toast-court-sous-la-fenetre', lettre: 'U', scenarios: ['annuler'], editions: [{ fichier: JS, de: '  rendreFenetreRetard(true);\n  toastAnnulableEnAttente(true);\n', vers: '  rendreFenetreRetard(true);\n' }] },
  // [U] « Annuler » qui laisse le retard note par le pointage (il ne se noterait plus a la vraie arrivee).
  { nom: 'annuler-garde-le-retard', lettre: 'U', scenarios: ['annuler'], editions: [{ fichier: BASE, serveur: true, de: ' : planSansRetardDuPointage(current, { status: input.status });', vers: ' : null;' }] },
  // (une activite manquee avant l arrivee du groupe en retard comptee « commencee » : plus rien a decaler)
  { nom: 'arrivee-en-retard-gelee', lettre: 'P', scenarios: ['tout'], editions: [{ fichier: LIB, serveur: true, de: '(surPlace(current) && etape.debut <= maintenant && etape.debut >= arrivee && (etape.debut >= la || etape.fin <= maintenant));', vers: '(surPlace(current) && etape.debut <= maintenant);' }] },
  { nom: 'decale-ce-qui-ne-passe-pas', lettre: 'C', scenarios: ['arrivee'], editions: [{ fichier: LIB, serveur: true, de: '      etapes[i] = { passe: false, raison: phraseDuRefus(error.message) };', vers: "      dossier = require('./reservation-activity-move').buildActivityMove(dossier, move);\n      etapes[i] = { passe: true };" }] },
  { nom: 'retard-oublie-apres-arrivee', lettre: 'C', scenarios: ['arrivee'], editions: [{ fichier: JS, de: "  if ((r.status === 'arrived' || r.status === 'paid') && annonce) return { etat: 'arrive', annonce, prevu: prevuNote };", vers: '' }] },
  { nom: 'retard-oublie-en-base', lettre: 'B', scenarios: ['planning'], editions: [{ fichier: BASE, serveur: true, de: '    payload.opsPlan = planAvecRetard(payload.opsPlan, current, { minutes: input.minutes, de: input.de, decale: moves.length > 0, dejaNote: Boolean(note) });', vers: '' }] },
  { nom: 'retard-oublie-apres-paye', lettre: 'P', scenarios: ['tout'], editions: [{ fichier: JS, de: "  if ((r.status === 'arrived' || r.status === 'paid') && annonce) return { etat: 'arrive', annonce, prevu: prevuNote };", vers: "  if (r.status === 'arrived' && annonce) return { etat: 'arrive', annonce, prevu: prevuNote };" }] },
  { nom: 'tout-decaler-toujours', lettre: 'C', scenarios: ['arrivee'], editions: [{ fichier: JS, de: '    : toutPasse ? `<button', vers: '    : true ? `<button' }] },
  { nom: 'ecriture-partielle', lettre: 'F', scenarios: ['serveur'], editions: [{ fichier: BASE, serveur: true, de: '      if (!jugement.toutPasse) {\n', vers: '      if (false) {\n' }] },
  { nom: 'bouton-retard-ancien-calcul', lettre: 'B', scenarios: ['planning'], editions: [{ fichier: JS, de: 'onclick="ouvrirRetardFiche(${id}, ${m}, event)">+${m} min</button>', vers: 'onclick="openDelayImpact(${id}, ${m}, event)">+${m} min</button>' }] },
  { nom: 'compteur-sans-le-retard-note', lettre: 'B', scenarios: ['planning'], editions: [{ fichier: JS, de: "  if (etat === 'upcoming' && m && (m.late || (getReservationDelayFlag(r) && !retardPousseDe(r)))) return 'late';", vers: "  if (etat === 'upcoming' && m && m.late) return 'late';" }] },
  { nom: 'duree-des-arcades-ignoree', lettre: 'S', scenarios: ['enchainement'], editions: [{ fichier: LIB, serveur: true, de: '    finPrecedente = debut + dureeReelle(current, etape);', vers: '    finPrecedente = debut + (etape.fin - etape.debut);' }] },
  { nom: 'suite-pas-poussee', lettre: 'S', scenarios: ['enchainement'], editions: [{ fichier: LIB, serveur: true, de: '    let debut = Math.max(etape.debut + minutes, finPrecedente);', vers: '    let debut = etape.debut + minutes;' }] },
  { nom: 'arcades-en-credits-a-heure', lettre: 'S', scenarios: ['serveur'], editions: [{ fichier: LIB, serveur: true, de: "  if (activityId === 'arcade_credit') return true;", vers: '' }] },
  { nom: 'telephone-boutons-etroits', lettre: 'T', scenarios: ['telephone'], editions: [{ fichier: 'assets/pinlane-staff.css', de: '  .rt-bouton { width: 100%; min-height: 44px; }\n', vers: '' }] },
  // [G] un calcul qui deplace une activite commencee : la sienne, puis celle d un groupe qui joue
  // (le controle ne le compte plus, comme le calcul qui l a pousse de la piste 1 a la piste 5).
  // (l activite commencee mais pas cochee se decale avec un retard pose a la main depuis le 2026-11-24 : [G] ;
  // la coche « fait » qui gele se prouve dans retards-planning-check, [C])
  { nom: 'plan-en-cascade-sans-garde', lettre: 'G', scenarios: ['gel'], editions: [{ fichier: BASE, serveur: true, de: "    require('./retard-arrivee').refuserSiUnGroupeQuiJoueBouge(merged, safeDate);\n", vers: '' }] },
  // [D] la plaine de jeux remise a une heure : au calcul, au programme de la fiche, dans Réserver.
  { nom: 'plaine-a-heure', lettre: 'D', scenarios: ['tout'], editions: [{ fichier: LIB, serveur: true, de: '    if (LIBRES_TOUTE_LA_JOURNEE.includes(id)) return;\n', vers: '' }] },
  { nom: 'plaine-a-heure-au-programme', lettre: 'D', scenarios: ['tout'], editions: [
    { fichier: JS, de: "      start: accesIllimite || sansHeure(item) ? null : item.start,", vers: '      start: accesIllimite ? null : item.start,' },
    { fichier: JS, de: "      end: accesIllimite || sansHeure(item) ? null : item.end,", vers: '      end: accesIllimite ? null : item.end,' },
    { fichier: JS, de: "      ...(accesIllimite ? { libre: true, volonte: true } : sansHeure(item) ? { libre: true } : {}),", vers: '      ...(accesIllimite ? { libre: true, volonte: true } : {}),' },
  ] },
  { nom: 'plaine-a-heure-dans-reserver', lettre: 'D', scenarios: ['tout'], editions: [{ fichier: JS, de: "  if (!id && getFormulaActivityIds({ desc: [texte] }).includes('playground')) return `<li class=\"is-libre\">${escapeHtml(texte)}<span class=\"rs-cc-libre\">libre</span></li>`;\n", vers: '' }] },
  // [H] la bulle du planning qui rouvre l ancien plan en cascade.
  { nom: 'bulle-ancien-plan', lettre: 'H', scenarios: ['bulle'], editions: [{ fichier: PG, de: 'ouvrirRetardFiche(Number(id), Math.min(240, deja + Number(n)), ev);', vers: 'openDelayImpact(Number(id), Math.min(240, deja + Number(n)), ev);' }] },
  { nom: 'groupe-qui-joue-pousse', lettre: 'G', scenarios: ['gel'], editions: [
    { fichier: LIB, serveur: true, de: '  if (enJeu && enJeu.exclusif) throw refus(enJeu.phrase, 409);', vers: '' },
    { fichier: 'api/staff-reservations.js', serveur: true, de: '      try { return validateActivityMoveResources(essai, move, autres, snapshot.laneStatuses, snapshot.blocks || [], current.date); }', vers: "      try { return validateActivityMoveResources(essai, move, autres.filter((o) => !['arrived', 'paid'].includes(o.status)), snapshot.laneStatuses, snapshot.blocks || [], current.date); }" },
    // (celle du retard : le decalage de tout le groupe, ecrireLeGroupeDecale, porte depuis c82ff34 la meme ligne)
    { fichier: BASE, serveur: true, de: '      const essayer = jugeDuRetard({ current, autres: reservations, maintenant, valider: (essai, move) => {\n        try { return validateActivityMoveResources(essai, move, reservations, laneStatuses, blocks, current.date); }', vers: "      const essayer = jugeDuRetard({ current, autres: reservations, maintenant, valider: (essai, move) => {\n        try { return validateActivityMoveResources(essai, move, reservations.filter((o) => !['arrived', 'paid'].includes(o.status)), laneStatuses, blocks, current.date); }" },
  ] },
];

async function jouer(browser, noms) {
  for (const nom of noms) {
    try {
      if (nom === 'planning') await scenarioPlanning(browser);
      if (nom === 'arrivee') await scenarioArrivee(browser);
      if (nom === 'tout') await scenarioToutEtPaye(browser);
      if (nom === 'serveur') await scenarioServeur();
      if (nom === 'telephone') await scenarioTelephone(browser);
      if (nom === 'enchainement') await scenarioEnchainement(browser);
      if (nom === 'gel') await scenarioGel();
      if (nom === 'bulle') await scenarioBulle(browser);
      if (nom === 'annuler') await scenarioAnnuler(browser);
    } finally { rendreHorlogeServeur(); }
  }
}

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, liste(process.env.RV_SCENARIOS) || ['planning', 'arrivee', 'tout', 'serveur', 'enchainement', 'gel', 'bulle', 'telephone', 'annuler']);
    } else {
      console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.RV_MUTATIONS || liste(process.env.RV_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.RV_BAVARD;
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
  if (echecs) { console.error(`\nretard-visible-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nretard-visible-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
