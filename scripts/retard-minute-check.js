// LE RETARD A LA MINUTE, DANS UNE FENETRE OU TOUT SE REGLE (2026-11-22).
//
// Le gerant, devant la fenetre du retard d un groupe arrive en retard : « quand on a cette pop up faut
// que ça mette genre mtn le retard pas a 30 ou quoi et fait un truc complet ou on peut modifier tout
// genre quand les mettres et ça nous montre joliment les places dispo [...] ils ont 10min de retard ils
// arrivent a 14h10 ça doit lancé avec 10minutes de retard quoi pas les mettre a 30 c trop relou ».
//   [A] A LA MINUTE (l Anniversaire Noah, prevu a 14:00 : Bowling 14:00 pistes 1 et 2, Minigolf
//       Blacklight 15:05, deux parties de laser 16:00 et 16:30) : pointe « Arrivé » a 14:10, la fenetre
//       propose le bowling a 14:10, pas 14:30, et decale chaque activite suivante de 10 min ; chaque
//       ligne porte un champ d heure a la minute (type time, pas de 60 s) et ses pas de 5 min ; les places
//       a la nouvelle heure se voient : les huit pistes (1 et 2 au groupe, la 8 libre, les autres prises)
//       et les armes du laser (« 30 armes libres sur 30, il en faut 10 »), jamais « gilets » ; une heure
//       changee a la main (14:25) se rejuge au serveur, la suite repart de sa fin (jamais avant), puis
//       « Tout décaler » l ecrit telle quelle : la base, le planning et la fiche disent 14:25 ;
//   [B] UNE HEURE PRISE (14:35 : les pistes 1 et 2 sont a l Anniversaire Sacha des 15:30) : « Ne passe
//       pas », la raison en clair, les pistes du groupe marquees prises, et trois ou quatre heures libres
//       proches en boutons, jamais avant l arrivee du groupe ; en toucher une (14:30) la pose et la
//       rejuge, « Tout décaler » l ecrit, le planning la montre ;
//   [C] LE SERVEUR RESTE LE JUGE : la simulation propose 14:10 au bowling, la suite +10 min ; une
//       ecriture refuse une heure prise entre-temps meme si l ecran l a montree libre (409, rien
//       d ecrit), une heure affichee que son calcul ne retrouve pas (409), une heure posee avant
//       l arrivee du groupe, une activite qui n est plus a decaler ; une partie de laser qui
//       chevaucherait celle d un autre groupe (Amis de Manon a 16:00) ne passe pas a 16:10 et ne se
//       cale pas en silence : leur depart (16:00) est propose, pose il passe, et s ecrit tel quel ;
//   [T] AU TELEPHONE (390 px, theme sombre) : la fenetre tient dans l ecran, le champ, les pas et les
//       boutons se touchent au doigt (44 px), contraste AA des places ;
//   [V] SOBRE : un seul rouge (le jeton --danger), le bouton principal bleu plein, les autres encadres,
//       aucune animation, contraste AA (theme clair) ;
//   [J] aucune erreur JS.
// La vraie console (scripts/planning-v3-fixtures.js, le samedi « pic » de Libramont a 14:10, sans les
// marques de demonstration), ses PATCH et ses calculs a blanc au VRAI handler api/staff-reservations.js,
// sur la base en memoire de scripts/reserver-banc.js (aucune base reelle, aucun reseau).
// --contre-preuves : chaque regle retiree (au texte servi ou compile en memoire, le disque n est jamais
// touche) fait rougir sa lettre ; chaque ancre existe une fois et une seule.
//   RM_MUTATIONS : un sous-ensemble ; RM_SCENARIOS : un sous-ensemble ; RM_BAVARD : les lignes des
//   contre-preuves ; RM_CAPTURES=<dossier> : la fenetre (14:10), l heure posee a la main, l heure prise.
'use strict';
const fs = require('fs');
const path = require('path');
// La base en memoire et le faux 'pg' s installent au require, avant tout module de lib/.
const B = require('./reserver-banc.js');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_RETARD_MINUTE_PORT || 8100);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CAPTURES = process.env.RM_CAPTURES || '';
const JS = 'assets/app-main.js';
const CSS = 'assets/pinlane-staff.css';
const LIB = 'lib/retard-arrivee.js';
const BASE = 'lib/database.js';
const API = 'api/staff-reservations.js';
const liste = (v) => (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : null);

const NOAH = 1596; // Bowling 14:00 a 15:00 pistes 1 et 2, Minigolf 15:05, Laser 16:00 et 16:30 (10 joueurs)
const MANON = 1618; // Laser 15:30 et 16:00 : la partie de 16:00 est partagee avec celle de Noah
const HEURE = '14:10';
// L ecran du gerant.
FX.APPAREILS.ecran1366 = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: 'fr-BE' };

let echecs = 0;
let silence = false;
const rouges = [];
class Mordu extends Error {}
let mutation = null;
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1200)}` : ''}`);
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
// LA JOURNEE : le samedi de la fixture sans ses marques de demonstration ; Noah attendu (il etait
// paye dans la fixture) ; les Amis de Manon retires sauf quand [C] juge leur partie partagee.
// ---------------------------------------------------------------------------
const FIXTURE = FX.lireFixture('pic');
const JOUR = FIXTURE.staffState.date;
const NOTE_DEMO = '[DEMO-JOURS-2027-01] Dossier fictif de démonstration : aucun contact, aucun message.';
function journee({ avecManon = false } = {}) {
  return FIXTURE.staffState.reservations.filter((r) => avecManon || r.id !== MANON).map((r) => {
    const c = JSON.parse(JSON.stringify(r));
    c.name = String(c.name || '').replace(/^DÉMO · /, '');
    c.notes = String(c.notes || '').split(NOTE_DEMO).join('').trim();
    if (c.id === NOAH) Object.assign(c, { status: 'pending', paymentMethod: null, paidAt: null, amountPaid: null });
    return c;
  });
}
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
// LE STATUT SEUL (setReservationStatus) : la base du banc ne le jouait pas ; meme ligne, meme
// transaction que l UPDATE complet du banc (le montage de scripts/retard-visible-check.js).
const pgBanc = require(require.resolve('pg', { paths: [ROOT] }));
const requeteAvant = pgBanc.Client.prototype.query;
const DATES = ['created_at', 'updated_at', 'paid_at', 'absent_at'];
const copie = (row) => JSON.parse(JSON.stringify(row), (k, v) => (DATES.includes(k) && v ? new Date(v) : v));
pgBanc.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
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
const planDe = (row) => (typeof row.ops_plan === 'string' ? JSON.parse(row.ops_plan) : (row.ops_plan || {}));
// Ce qui est en base : chaque heure du dossier (le bowling et les parties de laser par leurs blocs,
// le reste par la frise), le retard note, le statut.
function enBase(id) {
  const row = B.base.reservations.get(Number(id));
  if (!row) return null;
  const plan = planDe(row);
  const heures = {};
  (plan.resourceBlocks || []).forEach((b) => {
    if (b && b.resourceType === 'bowling_lane' && (!heures.bowling || b.startTime < heures.bowling)) heures.bowling = b.startTime;
    if (b && b.resourceType === 'laser_arena') heures[`laser_game:${Number(b.countIndex || 1)}.${Number(b.groupWaveIndex || 1)}`] = b.startTime;
  });
  (plan.timeline || []).filter((s) => s && s.type === 'activity' && !s.flexible && s.startTime && !['bowling', 'laser_game'].includes(s.activityId) && !/^service_/.test(s.activityId)).forEach((s) => { if (!heures[s.activityId]) heures[s.activityId] = s.startTime; });
  const frise = {};
  (plan.timeline || []).filter((s) => s && s.activityId === 'laser_game' && s.startTime).forEach((s) => { frise[`laser_game:${Number(s.countIndex || 1)}.${Number(s.groupWaveIndex || 1)}`] = s.startTime; });
  const f = plan.delayFlag || null;
  return { statut: row.status, heures, frise, retard: f && !f.cleared ? { minutes: f.minutes, de: f.from } : null, version: new Date(row.updated_at).toISOString() };
}
async function attendreBase(id, cond, ms = 6000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (cond(enBase(id))) return true; await new Promise((fin) => setTimeout(fin, 50)); }
  return false;
}
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const mn = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
// Un groupe de plus sur les pistes 1 et 2 (une reservation prise pendant que la fenetre est ouverte).
function bowlingVoisin(id, debut, fin) {
  const modele = journee().find((r) => r.id === 1633);
  const c = JSON.parse(JSON.stringify(modele));
  Object.assign(c, { id, name: 'Famille Voisin', startTime: hm(debut), lanes: [1, 2], pax: 6, updatedAt: new Date('2026-11-01T10:00:00Z').toISOString() });
  [...c.opsPlan.resourceBlocks, ...c.opsPlan.timeline].filter((b) => b && (b.resourceType === 'bowling_lane' || b.activityId === 'bowling')).forEach((b) => Object.assign(b, { start: debut, end: fin, startTime: hm(debut), endTime: hm(fin), lanes: [1, 2], players: 6 }));
  return ligneDepuis(c);
}

// ---------------------------------------------------------------------------
// LE MONTAGE : la console a 14:10, le vrai handler derriere chaque PATCH et chaque calcul a blanc,
// la montre du serveur reglee sur celle de la page (UTC+1 en janvier).
// ---------------------------------------------------------------------------
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
function monterServeur({ avecManon = false } = {}) {
  const jour = journee({ avecManon });
  B.semer(jour.map(ligneDepuis));
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  reglerHorlogeServeur(HEURE);
  return { jour, serveur };
}
async function monter(browser, { appareil = 'ecran1366', theme = 'light' } = {}) {
  const { jour, serveur } = monterServeur();
  const patchs = [];
  const blancs = [];
  const { ctx, page, erreurs } = await FX.monter(browser, {
    fixture: 'pic', appareil, theme, port: PORT, heure: HEURE, variante: ['sansdemo'],
    avantChargement: async (p) => {
      await p.exposeFunction('__fixtureServeur', async (corps) => { patchs.push(corps); return serveur.appeler('PATCH', '/api/staff-reservations', corps); });
      await p.exposeFunction('__fixtureBlanc', async (corps) => { blancs.push(corps); return serveur.appeler('POST', '/api/staff-reservations', corps); });
    },
  });
  // (la journee de la page est celle de la base : Noah attendu, Manon absente)
  await page.evaluate((liste) => {
    const j = window.__FIXTURE__.jours[window.__FIXTURE__.jour];
    j.length = 0;
    liste.forEach((r) => j.push(Object.assign({}, r)));
    state.reservations = liste.map((r) => Object.assign({}, r));
    renderStaff();
  }, jour);
  await FX.repos(page, 250);
  return { ctx, page, erreurs, serveur, patchs, blancs };
}
async function photo(page, nom) {
  if (!CAPTURES || mutation) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  // (le champ qu on vient de remplir garde sinon son segment surligne)
  await page.evaluate(() => { const f = document.activeElement; if (f && f.matches('input.rt-heure')) f.blur(); });
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

// Ce que la fenetre montre, lu sur ses vrais noeuds.
const LIRE = `
  window.__rm = window.__rm || {};
  __rm.jeton = (nom) => { const p = document.createElement('span'); p.style.color = 'var(' + nom + ')'; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  __rm.rgb = (c) => (String(c).match(/[\\d.]+/g) || []).map(Number);
  __rm.lum = (c) => { const [r, g, b] = __rm.rgb(c).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  __rm.fond = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; const a = __rm.rgb(c); if (a.length >= 3 && (a.length < 4 || a[3] > 0.5)) return c; } return 'rgb(255, 255, 255)'; };
  __rm.contraste = (el) => { if (!el) return null; const a = __rm.lum(getComputedStyle(el).color); const b = __rm.lum(__rm.fond(el)); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; };
  __rm.rouge = (c) => { const [r, g, b, a] = __rm.rgb(c); return a !== 0 && r > 120 && r > g + 50 && r > b + 50; };
  __rm.fenetre = () => {
    const f = document.querySelector('#retardFenetre .rt-fenetre');
    if (!f) return null;
    const D = __rm.jeton('--danger');
    const bleu = __rm.jeton('--console-selected');
    const r = f.getBoundingClientRect();
    const haut = (el) => (el ? Math.round(el.getBoundingClientRect().height) : 0);
    const lignes = [...f.querySelectorAll('.rt-etape')].map((li) => {
      const champ = li.querySelector('.rt-etape__heures input');
      const places = li.querySelector('.rt-etape__places');
      return {
        cle: li.getAttribute('data-rt-cle'), cls: li.className, nom: (li.querySelector('.rt-etape__nom') || {}).textContent || '',
        mot: (li.querySelector('.rt-etape__mot') || {}).textContent || '', avant: (li.querySelector('.rt-etape__heures s') || {}).textContent || '',
        heure: champ ? champ.value : ((li.querySelector('.rt-etape__heures b') || {}).textContent || ''),
        champ: champ ? { type: champ.type, pas: champ.getAttribute('step'), etiquette: champ.getAttribute('aria-label') || '', haut: haut(champ) } : null,
        pas: [...li.querySelectorAll('.rt-pas')].map((b) => ({ t: b.textContent, haut: haut(b) })),
        raison: (li.querySelector('.rt-etape__raison') || {}).textContent || '',
        libres: [...li.querySelectorAll('.rt-libre')].map((b) => b.textContent.trim()),
        places: places ? places.textContent.replace(/\\s+/g, ' ').trim() : '',
        pistes: [...li.querySelectorAll('.rt-piste')].map((p) => ({ n: Number(p.textContent), cls: p.className, aa: __rm.contraste(p) })),
        armes: Boolean(li.querySelector('.rt-armes')),
        placesAA: __rm.contraste(li.querySelector('.rt-places__dit')),
        libresHaut: [...li.querySelectorAll('.rt-libre')].map(haut),
      };
    });
    const tous = [f, ...f.querySelectorAll('*')];
    const rouges = [...new Set(tous.flatMap((el) => { const s = getComputedStyle(el); return [s.color, s.borderTopColor, s.backgroundColor].filter((c) => __rm.rouge(c)); }))];
    return {
      titre: f.querySelector('.rt-titre').textContent, etat: f.querySelector('.rt-etat').textContent, lignes,
      boutons: [...f.querySelectorAll('.rt-pied button')].map((b) => { const q = b.getBoundingClientRect(); const s = getComputedStyle(b); return { t: b.textContent, choix: b.getAttribute('data-rt-choix'), plein: b.classList.contains('est-plein'), off: b.disabled, fond: s.backgroundColor, bord: s.borderTopColor, couleur: s.color, bleu, haut: Math.round(q.height), large: Math.round(q.width) }; }),
      D, rouges, anime: tous.some((el) => getComputedStyle(el).animationName !== 'none'),
      texte: f.textContent,
      aa: { titre: __rm.contraste(f.querySelector('.rt-titre')), etat: __rm.contraste(f.querySelector('.rt-etat')), libre: __rm.contraste(f.querySelector('.rt-libre')), pas: __rm.contraste(f.querySelector('.rt-pas')), champ: __rm.contraste(f.querySelector('.rt-heure')) },
      cadre: { g: Math.round(r.left), d: Math.round(r.right), h: Math.round(r.top), b: Math.round(r.bottom), large: Math.round(r.width) }, vue: { l: window.innerWidth, h: window.innerHeight },
      deborde: f.scrollWidth > f.clientWidth + 1 || document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  };
  true;
`;
const lireFenetre = (page) => page.evaluate(`(${'() => { ' + LIRE + ' return __rm.fenetre(); }'})()`);
const attendreVerdict = (page) => page.waitForFunction(() => {
  const f = document.querySelector('#retardFenetre .rt-fenetre');
  return f && !/Vérification/.test(f.querySelector('.rt-etat').textContent);
}, null, { timeout: 10000 }).catch(() => null);
const attendreFermee = (page) => page.waitForFunction(() => !document.getElementById('retardFenetre'), null, { timeout: 8000 }).catch(() => null);
const ligneDe = (f, cle) => (f && f.lignes.find((l) => l.cle === cle)) || null;
const champDe = (page, cle) => page.locator(`#retardFenetre .rt-etape[data-rt-cle="${cle}"] input.rt-heure`);
// La case Bowling de la ligne du planning, et l heure du bowling au programme de la fiche.
const lirePlanning = (page, id) => page.evaluate((n) => {
  const tr = document.querySelector(`#globalPlanningGridWrap .gf-r[data-gf-id="${n}"]`);
  const td = tr ? tr.querySelector('td.gf-a[data-gf-titre="Bowling"]') : null;
  return td ? td.textContent.replace(/\s+/g, ' ').trim() : null;
}, id);
const lireFiche = (page, id) => page.evaluate((n) => {
  if (typeof closePos === 'function') closePos();
  openPos(n);
  const etape = [...document.querySelectorAll('#posOverlay .fx-programme .gc-step')].find((li) => /Bowling/.test(li.textContent));
  const t = etape ? etape.querySelector('.gc-step-time') : null;
  const lu = t ? t.textContent.replace(/\s+/g, ' ').trim() : '';
  closePos();
  return lu;
}, id);
async function arriver(page, id) {
  await page.locator(`#globalPlanningGridWrap [data-gf-arrive="${id}"]`).first().click();
  await FX.repos(page, 150);
  await attendreVerdict(page);
  await FX.repos(page, 150);
}
async function poser(page, cle, heure) {
  await champDe(page, cle).fill(heure);
  await page.waitForTimeout(80);
  await attendreVerdict(page);
  await FX.repos(page, 120);
}
const LE_DECALAGE = ['bowling', 'minigolf_blacklight', 'laser_game:1.1', 'laser_game:2.1'];

// ---------------------------------------------------------------------------
// [A] [V] A LA MINUTE, puis une heure changee a la main.
// ---------------------------------------------------------------------------
async function scenarioMinute(browser) {
  const { ctx, page, erreurs, patchs, blancs } = await monter(browser);
  try {
    await arriver(page, NOAH);
    const pointe = enBase(NOAH);
    ok(patchs.length === 1 && patchs[0].status === 'arrived' && pointe.statut === 'arrived' && pointe.retard && pointe.retard.minutes === 10 && pointe.retard.de === '14:00' && pointe.heures.bowling === '14:00',
      '[A] « Arrivé » a 14:10 : le groupe prevu a 14:00 arrive, son retard de 10 min note, les heures intactes', { patchs, pointe });
    const f = await lireFenetre(page);
    const dit = f ? f.lignes.map((l) => `${l.cle} ${l.avant}>${l.heure} ${l.mot}`) : [];
    ok(f && f.titre === 'Arrivé avec 10 min de retard' && f.lignes.map((l) => l.cle).join() === LE_DECALAGE.join() && f.lignes[0].cle === 'bowling' && f.lignes[0].heure === '14:10',
      '[A] la fenetre propose la premiere activite, le bowling, a 14:10 (pas 14:30)', dit);
    ok(f && f.lignes.every((l) => mn(l.heure) - mn(l.avant) === 10 && l.mot === 'Passe') && f.boutons.map((b) => b.choix).join() === 'garder,tout',
      '[A] chaque activite suivante est decalee du meme retard, 10 min, et passe : « Tout décaler »', dit);
    ok(f && f.lignes.every((l) => l.champ && l.champ.type === 'time' && l.champ.pas === '60' && /Nouvelle heure/.test(l.champ.etiquette) && l.pas.map((p) => p.t).join() === '−5,+5'),
      '[A] chaque ligne porte un champ d heure a la minute (type time, pas de 60 s), nomme, et ses pas de 5 min', f && f.lignes.map((l) => ({ cle: l.cle, champ: l.champ, pas: l.pas })));
    const bowling = ligneDe(f, 'bowling');
    const etats = bowling ? Object.fromEntries(bowling.pistes.map((p) => [p.n, p.cls])) : {};
    ok(bowling && bowling.pistes.length === 8 && /is-groupe/.test(etats[1]) && /is-libre/.test(etats[1]) && /is-groupe/.test(etats[2]) && /is-libre/.test(etats[8]) && !/is-groupe/.test(etats[8])
      && [3, 4, 5, 6, 7].every((n) => /is-prise/.test(etats[n])) && /^Pistes 1 et 2 libres · 1 autre libre/.test(bowling.places),
    '[A] les pistes a 14:10 se voient : 1 et 2 au groupe, la 8 libre, 3 a 7 prises, « Pistes 1 et 2 libres · 1 autre libre »', bowling && { places: bowling.places, pistes: bowling.pistes });
    const lasers = f ? f.lignes.filter((l) => /^laser_game/.test(l.cle)) : [];
    ok(lasers.length === 2 && lasers.every((l) => l.armes && /^30 armes libres sur 30, il en faut 10$/.test(l.places)) && f && !/gilet/i.test(f.texte),
      '[A] les armes du laser se voient : « 30 armes libres sur 30, il en faut 10 », jamais « gilets »', lasers.map((l) => l.places));
    ok(blancs.length >= 1 && blancs.every((b) => b.dryRun === true && b.retard && b.retard.minutes === 10 && b.retard.de === '14:00'), '[A] la fenetre s est jugee au serveur, sans rien ecrire', blancs);
    // [V] sobre : un seul rouge, les boutons de la console, aucune animation, AA.
    const principal = f ? f.boutons.find((b) => b.plein) : null;
    const second = f ? f.boutons.find((b) => !b.plein) : null;
    ok(f && f.rouges.every((c) => c === f.D) && principal && principal.choix === 'tout' && principal.fond === principal.bleu && second && second.fond !== second.bleu && second.bord !== 'rgba(0, 0, 0, 0)' && !f.anime,
      '[V] un seul rouge (le jeton --danger), « Tout décaler » bleu plein, « Garder les heures » encadre, aucune animation', f && { rouges: f.rouges, D: f.D, boutons: f.boutons, anime: f.anime });
    ok(f && bowling && Object.values(f.aa).filter((v) => v !== null).every((v) => v >= 4.5) && bowling.placesAA >= 4.5 && bowling.pistes.every((p) => p.aa >= 4.5) && lasers.every((l) => l.placesAA >= 4.5),
      '[V] contraste AA (theme clair) : titre, etat, champ, pas, places et chaque piste', f && { aa: f.aa, places: bowling && bowling.placesAA, pistes: bowling && bowling.pistes.map((p) => p.aa) });
    await photo(page, '2-apres-bowling-a-14h10');

    // L heure changee a la main : 14:25, rejugee, la suite repart de sa fin.
    const avantBlancs = blancs.length;
    await poser(page, 'bowling', '14:25');
    const g = await lireFenetre(page);
    const posee = blancs.slice(avantBlancs);
    const heuresG = g ? Object.fromEntries(g.lignes.map((l) => [l.cle, l.heure])) : {};
    ok(posee.length >= 1 && posee[posee.length - 1].retard.heures && posee[posee.length - 1].retard.heures.bowling === '14:25',
      '[A] 14:25 tape dans le champ du bowling se rejuge au serveur (une simulation qui porte l heure posee)', posee.map((b) => b.retard.heures));
    ok(g && ligneDe(g, 'bowling').heure === '14:25' && ligneDe(g, 'bowling').mot === 'Passe' && /is-posee/.test(ligneDe(g, 'bowling').cls) && g.boutons.map((b) => b.choix).join() === 'garder,tout',
      '[A] le bowling a 14:25 passe, marque pose a la main', g && g.lignes.map((l) => `${l.cle} ${l.heure} ${l.mot} ${l.cls}`));
    ok(g && heuresG.minigolf_blacklight === '15:25' && heuresG['laser_game:1.1'] === '16:10' && heuresG['laser_game:2.1'] === '16:40' && mn(heuresG.minigolf_blacklight) >= mn('14:25') + 60,
      '[A] la suite repart de la fin du bowling (15:25), jamais avant ; les lasers gardent leur decalage', heuresG);
    await photo(page, '3-apres-heure-modifiee-14h25');
    await page.locator('#retardFenetre [data-rt-choix="tout"]').click();
    await attendreFermee(page);
    await attendreBase(NOAH, (b) => b.heures.bowling === '14:25');
    await FX.repos(page, 300);
    const base = enBase(NOAH);
    const envoi = patchs[patchs.length - 1] || {};
    // (ce qui s ecrit d abord : une autre heure que celle de l ecran rougit ici, pas sur la forme de l envoi)
    ok(base.heures.bowling === '14:25' && base.heures.minigolf_blacklight === '15:25' && base.heures['laser_game:1.1'] === '16:10' && base.heures['laser_game:2.1'] === '16:40' && base.retard && base.retard.minutes === 10 && base.statut === 'arrived',
      '[A] en base : exactement les heures affichees, bowling 14:25, minigolf 15:25, lasers 16:10 et 16:40, le retard compte une fois', base);
    ok(patchs.length === 2 && envoi.retard && envoi.retard.choix === 'tout' && envoi.retard.heures && envoi.retard.heures.bowling === '14:25' && envoi.retard.attendues && envoi.retard.attendues.bowling === '14:25' && envoi.retard.attendues.minigolf_blacklight === '15:25',
      '[A] « Tout décaler » envoie l heure posee et les heures affichees', envoi);
    const planning = await lirePlanning(page, NOAH);
    ok(planning && /14:25/.test(planning) && !/14:00|14:10/.test(planning), '[A] le planning montre le bowling a 14:25', planning);
    const fiche = await lireFiche(page, NOAH);
    ok(/^14:25/.test(fiche), '[A] la fiche montre le bowling a 14:25', fiche);
    ok(erreurs.length === 0, '[J] aucune erreur JS (a la minute)', erreurs);
  } finally { await ctx.close(); }
}

// ---------------------------------------------------------------------------
// [B] une heure prise, ses heures libres, un toucher.
// ---------------------------------------------------------------------------
async function scenarioPrise(browser) {
  const { ctx, page, erreurs, patchs } = await monter(browser);
  try {
    await arriver(page, NOAH);
    await poser(page, 'bowling', '14:35');
    const f = await lireFenetre(page);
    const b = ligneDe(f, 'bowling');
    const etats = b ? Object.fromEntries(b.pistes.map((p) => [p.n, p.cls])) : {};
    ok(b && b.heure === '14:35' && b.mot === 'Ne passe pas' && /Piste 1, 2 déjà prise de 14:35 à 15:35\./.test(b.raison) && /Reste à 14:00\.$/.test(b.raison),
      '[B] 14:35 : « Ne passe pas », la raison en clair (les pistes 1 et 2 prises de 14:35 a 15:35)', b);
    ok(b && b.libres.length >= 3 && b.libres.length <= 4 && b.libres.every((h) => mn(h) >= mn('14:10') && h !== '14:35' && Math.abs(mn(h) - mn('14:35')) <= 60) && b.libres.includes('14:30'),
      '[B] trois ou quatre heures libres proches en boutons, jamais avant l arrivee du groupe (14:10)', b && b.libres);
    ok(b && /is-groupe/.test(etats[1]) && /is-prise/.test(etats[1]) && /is-prise/.test(etats[2]) && /^Pistes 1 et 2 prises/.test(b.places),
      '[B] les pistes du groupe se lisent prises a cette heure', b && { places: b.places, pistes: b.pistes });
    ok(f && f.boutons.map((x) => x.choix).join() === 'garder,passe' && f.rouges.every((c) => c === f.D) && b.libresHaut.every((h) => h >= 36),
      '[B] « Décaler ce qui passe » seulement, un seul rouge, des boutons d heure qui se touchent', f && { boutons: f.boutons, rouges: f.rouges, D: f.D });
    await photo(page, '4-apres-heure-prise-heures-libres');
    await page.locator('#retardFenetre .rt-etape[data-rt-cle="bowling"] .rt-libre', { hasText: '14:30' }).click();
    await page.waitForTimeout(80);
    await attendreVerdict(page);
    await FX.repos(page, 120);
    const g = await lireFenetre(page);
    const b2 = ligneDe(g, 'bowling');
    ok(b2 && b2.heure === '14:30' && b2.mot === 'Passe' && b2.libres.length === 0 && g.boutons.map((x) => x.choix).join() === 'garder,tout',
      '[B] toucher 14:30 la pose dans le champ ; rejugee, elle passe', g && g.lignes.map((l) => `${l.cle} ${l.heure} ${l.mot}`));
    await page.locator('#retardFenetre [data-rt-choix="tout"]').click();
    await attendreFermee(page);
    await attendreBase(NOAH, (x) => x.heures.bowling === '14:30');
    await FX.repos(page, 300);
    const base = enBase(NOAH);
    ok(base.heures.bowling === '14:30' && base.heures.minigolf_blacklight === '15:30' && patchs[patchs.length - 1].retard.heures.bowling === '14:30',
      '[B] « Tout décaler » l ecrit : le bowling a 14:30 en base, la suite apres lui', base);
    const planning = await lirePlanning(page, NOAH);
    ok(planning && /14:30/.test(planning), '[B] le planning montre le bowling a 14:30', planning);
    ok(erreurs.length === 0, '[J] aucune erreur JS (heure prise)', erreurs);
  } finally { await ctx.close(); }
}

// ---------------------------------------------------------------------------
// [C] le serveur seul : a la minute, et juge de chaque ecriture.
// ---------------------------------------------------------------------------
async function scenarioServeur() {
  try {
    const { jour, serveur } = monterServeur();
    const noah = jour.find((r) => r.id === NOAH);
    const blanc = (heures = {}) => serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', retard: { id: NOAH, baseUpdatedAt: noah.updatedAt, minutes: 10, de: '14:00', heures } });
    const ecrire = (retard) => serveur.appeler('PATCH', '/api/staff-reservations', { id: NOAH, centerId: 'libramont', baseUpdatedAt: noah.updatedAt, retard: { minutes: 10, de: '14:00', ...retard } });
    const affichees = (json) => Object.fromEntries((json.etapes || []).map((e) => [e.cle, e.apres]));
    const depart = JSON.stringify(enBase(NOAH));
    const sim = await blanc();
    const vu = affichees(sim.json);
    ok(sim.statut === 200 && JSON.stringify(vu) === JSON.stringify({ bowling: '14:10', minigolf_blacklight: '15:15', 'laser_game:1.1': '16:10', 'laser_game:2.1': '16:40' }) && sim.json.toutPasse === true && JSON.stringify(enBase(NOAH)) === depart,
      '[C] la simulation : bowling 14:10, la suite +10 min, tout passe, rien d ecrit', sim.json);
    // Une reservation prend les pistes 1 et 2 pendant que la fenetre est ouverte.
    B.base.reservations.set(9901, bowlingVoisin(9901, 14 * 60 + 40, 15 * 60 + 40));
    const prise = await ecrire({ choix: 'tout', cles: LE_DECALAGE, heures: {}, attendues: vu });
    ok(prise.statut === 409 && JSON.stringify(enBase(NOAH)) === depart, '[C] une heure prise entre-temps, montree libre par l ecran : le PATCH refuse (409), rien d ecrit', { statut: prise.statut, json: prise.json });
    const revue = await blanc();
    const bowlingRevu = (revue.json.etapes || []).find((e) => e.cle === 'bowling') || {};
    ok(bowlingRevu.passe === false && /déjà prise/.test(bowlingRevu.raison || ''), '[C] relue, la fenetre dit que le bowling ne passe plus', bowlingRevu);
    B.base.reservations.delete(9901);
    const autre = await ecrire({ choix: 'tout', cles: LE_DECALAGE, heures: {}, attendues: { ...vu, bowling: '14:20' } });
    ok(autre.statut === 409 && /heures ont changé/.test(autre.json.message || autre.json.error || '') && JSON.stringify(enBase(NOAH)) === depart,
      '[C] une heure affichee que le calcul ne retrouve pas : refuse (409), rien d ecrit', { statut: autre.statut, json: autre.json });
    const tot = await blanc({ bowling: '13:55' });
    const bowlingTot = (tot.json.etapes || []).find((e) => e.cle === 'bowling') || {};
    ok(bowlingTot.passe === false && bowlingTot.raison === 'Trop tôt : le groupe n’est là qu’à partir de 14:10.' && Array.isArray(bowlingTot.libres) && bowlingTot.libres.length && bowlingTot.libres.every((h) => mn(h) >= mn('14:10')),
      '[C] une heure posee avant l arrivee du groupe ne passe pas, ses heures libres partent de 14:10', bowlingTot);
    const totEcrit = await ecrire({ choix: 'tout', cles: LE_DECALAGE, heures: { bowling: '13:55' }, attendues: affichees(tot.json) });
    ok(totEcrit.statut === 409 && JSON.stringify(enBase(NOAH)) === depart, '[C] ecrite quand meme, elle est refusee (409), rien d ecrit', { statut: totEcrit.statut, json: totEcrit.json });
    const table = await blanc({ party_table: '15:00' });
    ok(table.json.refus && table.json.refus.statut === 409 && JSON.stringify(enBase(NOAH)) === depart, '[C] une heure posee sur ce qui ne se decale pas (la table) : refusee', table.json);
    const pose = await blanc({ bowling: '14:25' });
    const bon = await ecrire({ choix: 'tout', cles: LE_DECALAGE, heures: { bowling: '14:25' }, attendues: affichees(pose.json) });
    const ecrit = enBase(NOAH);
    ok(bon.statut === 200 && JSON.stringify(ecrit.heures) === JSON.stringify({ bowling: '14:25', 'laser_game:1.1': '16:10', 'laser_game:2.1': '16:40', minigolf_blacklight: '15:25' }) && ecrit.retard && ecrit.retard.minutes === 10 && ecrit.retard.de === '14:00',
      '[C] l heure posee, rejugee : ecrite telle quelle avec la suite affichee, et le retard note', { statut: bon.statut, json: bon.json.message, ecrit });

    // La partie de laser partagee : celle des Amis de Manon a 16:00.
    const avec = monterServeur({ avecManon: true });
    const noah2 = avec.jour.find((r) => r.id === NOAH);
    const blanc2 = (heures = {}) => avec.serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', retard: { id: NOAH, baseUpdatedAt: noah2.updatedAt, minutes: 10, de: '14:00', heures } });
    const s1 = await blanc2();
    const laser = (s1.json.etapes || []).find((e) => e.cle === 'laser_game:1.1') || {};
    ok(laser.apres === '16:10' && laser.passe === false && /l’arène joue déjà la partie de 16:00 \(Amis de Manon, 8 joueurs\)/.test(laser.raison || '') && (laser.libres || []).includes('16:00') && laser.places && laser.places.armes && laser.places.armes.libres === 22,
      '[C] une partie qui chevaucherait celle des Amis de Manon (16:00) ne passe pas a 16:10, sans calage en silence : leur depart est propose', laser);
    const s2 = await blanc2({ 'laser_game:1.1': '16:00' });
    const laser2 = (s2.json.etapes || []).find((e) => e.cle === 'laser_game:1.1') || {};
    ok(laser2.apres === '16:00' && laser2.passe === true && laser2.places && laser2.places.armes && (laser2.places.armes.avec || []).includes('Amis de Manon'),
      '[C] posee sur leur depart, la partie passe et se dit partagee avec les Amis de Manon', laser2);
    const e2 = await avec.serveur.appeler('PATCH', '/api/staff-reservations', { id: NOAH, centerId: 'libramont', baseUpdatedAt: noah2.updatedAt, retard: { minutes: 10, de: '14:00', choix: 'tout', cles: LE_DECALAGE, heures: { 'laser_game:1.1': '16:00' }, attendues: affichees(s2.json) } });
    const ecrit2 = enBase(NOAH);
    ok(e2.statut === 200 && ecrit2.heures['laser_game:1.1'] === '16:00' && ecrit2.frise['laser_game:1.1'] === '16:00' && ecrit2.heures.bowling === '14:10',
      '[C] ecrite, la partie part a 16:00, la frise du programme aussi : l heure lue a l ecran', { statut: e2.statut, json: e2.json.message, ecrit2 });
  } catch (error) {
    if (error instanceof Mordu) throw error;
    ok(false, '[C] le serveur repond', error.stack || error.message);
  }
}

// ---------------------------------------------------------------------------
// [T] au telephone, 390 px, theme sombre.
// ---------------------------------------------------------------------------
async function scenarioTelephone(browser) {
  const { ctx, page, erreurs } = await monter(browser, { appareil: 'telephone', theme: 'dark' });
  try {
    // (au telephone, « Arrivé » se touche dans la fiche du groupe)
    await page.evaluate((id) => { closePos(); openPos(id); }, NOAH);
    await page.locator('#posOverlay .fz-arrivee-ligne').first().click();
    await FX.repos(page, 150);
    await attendreVerdict(page);
    await FX.repos(page, 150);
    await poser(page, 'bowling', '14:35');
    const f = await lireFenetre(page);
    const lignes = f ? f.lignes : [];
    ok(f && f.cadre.g >= 0 && f.cadre.d <= f.vue.l && !f.deborde && lignes.length === 4,
      '[T] au telephone, la fenetre tient dans l ecran, rien ne deborde', f && { cadre: f.cadre, vue: f.vue, deborde: f.deborde });
    ok(f && lignes.every((l) => l.champ && l.champ.haut >= 44 && l.pas.every((p) => p.haut >= 44)) && lignes.every((l) => l.libresHaut.every((h) => h >= 44)) && f.boutons.every((b) => b.haut >= 44 && b.large >= f.cadre.large - 40),
      '[T] le champ, les pas, les heures proposees et les choix se touchent au doigt (44 px)', f && { lignes: lignes.map((l) => ({ champ: l.champ && l.champ.haut, pas: l.pas.map((p) => p.haut), libres: l.libresHaut })), boutons: f.boutons });
    const bowling = ligneDe(f, 'bowling');
    ok(f && bowling && bowling.placesAA >= 4.5 && bowling.pistes.every((p) => p.aa >= 4.5) && f.aa.champ >= 4.5 && f.aa.libre >= 4.5 && f.rouges.every((c) => c === f.D),
      '[T] theme sombre : contraste AA des places, des pistes, du champ, des heures proposees ; un seul rouge', f && { aa: f.aa, places: bowling && bowling.placesAA, pistes: bowling && bowling.pistes.map((p) => p.aa), rouges: f.rouges, D: f.D });
    ok(erreurs.length === 0, '[J] aucune erreur JS (telephone)', erreurs);
  } finally { await ctx.close(); }
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  // L arrondi a la demi-heure remis : le bowling repart a 14:30.
  { nom: 'arrondi-a-30', lettre: 'A', scenarios: ['minute'], editions: [{ fichier: LIB, serveur: true, de: '    let debut = Math.max(etape.debut + minutes, finPrecedente);\n', vers: "    let debut = Math.max(etape.debut + minutes, finPrecedente);\n    if (etape.activityId === 'bowling') debut = Math.ceil(debut / 30) * 30;\n" }] },
  { nom: 'arrondi-a-30-au-serveur', lettre: 'C', scenarios: ['serveur'], editions: [{ fichier: LIB, serveur: true, de: '    let debut = Math.max(etape.debut + minutes, finPrecedente);\n', vers: "    let debut = Math.max(etape.debut + minutes, finPrecedente);\n    if (etape.activityId === 'bowling') debut = Math.ceil(debut / 30) * 30;\n" }] },
  // Le juge sans la minute : le bowling a 14:10 refuse (« pleine ou demie »).
  { nom: 'juge-sans-la-minute', lettre: 'A', scenarios: ['minute'], editions: [{ fichier: LIB, serveur: true, de: '    const essai = buildActivityMove(base, move, { aLaMinute: true });', vers: '    const essai = buildActivityMove(base, move);' }] },
  // Le champ d heure absent : l heure se lit, ne se change plus.
  { nom: 'champ-heure-absent', lettre: 'A', scenarios: ['minute'], editions: [{ fichier: JS, de: '    : champ ? `<input class="rt-heure"', vers: '    : false ? `<input class="rt-heure"' }] },
  // Les places libres absentes.
  { nom: 'places-absentes', lettre: 'A', scenarios: ['minute'], editions: [{ fichier: JS, de: '<div class="rt-etape__places">${placesDuRetardHtml(e)}</div>', vers: '<div class="rt-etape__places"></div>' }] },
  // Une autre heure ecrite que celle affichee : le choix part sans les heures de l ecran.
  { nom: 'autre-heure-ecrite', lettre: 'A', scenarios: ['minute'], editions: [{ fichier: JS, de: "  const heures = choix === 'garder' ? {} : { heures: { ...etat.heures }, attendues };", vers: '  const heures = {};' }] },
  // La suite qui ne repart pas d une heure posee a la main.
  { nom: 'heure-posee-ignoree', lettre: 'A', scenarios: ['minute'], editions: [{ fichier: LIB, serveur: true, de: '    if (Number.isFinite(posee)) debut = posee;\n', vers: '' }] },
  // Les heures libres proches absentes.
  { nom: 'heures-libres-absentes', lettre: 'B', scenarios: ['prise'], editions: [{ fichier: API, serveur: true, de: '      proposer: (dossier, move, i) => heuresLibresDuRetard(dossier, move, { auPlusTot: etapes[i].auPlusTot, essayer }),\n', vers: '' }] },
  // Un toucher sur une heure libre qui ne la pose pas.
  { nom: 'heure-libre-sans-effet', lettre: 'B', scenarios: ['prise'], editions: [{ fichier: JS, de: '  if (champ) champ.value = heure;\n  poserHeureRetard(cle, heure, true);\n', vers: '' }] },
  // Le PATCH qui ne rejuge pas : une heure prise entre-temps s ecrit.
  { nom: 'patch-sans-rejuger', lettre: 'C', scenarios: ['serveur'], editions: [{ fichier: BASE, serveur: true, de: '      if (!jugement.toutPasse) {\n', vers: '      if (false) {\n' }] },
  // Les heures affichees que l ecriture ne compare plus.
  { nom: 'heures-affichees-ignorees', lettre: 'C', scenarios: ['serveur'], editions: [{ fichier: LIB, serveur: true, de: '  if (voulues.some((cle) => attendues[cle] !== undefined && attendues[cle] !== parCle.get(cle).apres)) {', vers: '  if (false) {' }] },
  // Une heure posee avant l arrivee du groupe acceptee.
  { nom: 'trop-tot-accepte', lettre: 'C', scenarios: ['serveur'], editions: [{ fichier: LIB, serveur: true, de: '    const trop = !(posee < auPlusTot) ? \'\'', vers: '    const trop = true ? \'\'' }] },
  // Une partie de laser calee en silence sur celle d un autre groupe.
  { nom: 'partie-calee-en-silence', lettre: 'C', scenarios: ['serveur'], editions: [{ fichier: LIB, serveur: true, de: '    if (calee) throw calee;\n', vers: '' }] },
  // Au telephone, le champ et les pas trop petits pour le doigt.
  { nom: 'telephone-champ-etroit', lettre: 'T', scenarios: ['telephone'], editions: [{ fichier: CSS, de: '  .rt-heure, .rt-pas, .rt-libre { min-height: 44px; }\n', vers: '' }] },
];

async function jouer(browser, noms) {
  for (const nom of noms) {
    try {
      if (nom === 'minute') await scenarioMinute(browser);
      if (nom === 'prise') await scenarioPrise(browser);
      if (nom === 'serveur') await scenarioServeur();
      if (nom === 'telephone') await scenarioTelephone(browser);
    } finally { rendreHorlogeServeur(); }
  }
}

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, liste(process.env.RM_SCENARIOS) || ['minute', 'prise', 'serveur', 'telephone']);
    } else {
      console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.RM_MUTATIONS || liste(process.env.RM_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.RM_BAVARD;
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
  if (echecs) { console.error(`\nretard-minute-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nretard-minute-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
