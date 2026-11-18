// LA RESERVATION D UN GROS GROUPE SE LIT D UN COUP D OEIL (2026-11-18).
//
// Ansar, 18/11, sur un « Family Day » de 108 joueurs a Gembloux, pistes 3 a 8,
// pose a la main (18 joueurs par piste au lieu de 6) :
//   [P] « les 108 joueurs s affiche moche ici sur la resa » : sur chaque carte
//       du planning bowling, la pastille dit le nombre seul (« 108 », son unite
//       lisible sur son fond, 4,5:1, dans les deux themes), l alerte
//       des pistes chargees est a cote d elle, separee, et dit pourquoi au
//       survol (son nom et son infobulle : « Pistes chargées : 18 joueurs par
//       piste, 6 d’habitude ») ; du grand ecran au telephone, et sur une piste
//       serree de 134 a 60 px en fenetre comme en plein ecran, rien ne deborde
//       de la carte, l alerte ne reste jamais sans son nombre et ne part pas
//       tant qu elle tient (90 px de piste) ;
//   [F] « ya plein de texte on comprend rien » : sous le nom de la fiche, la
//       visite d abord (heure, joueurs, formule, jour, pistes, numero) sur une
//       ligne ; dessous, les etiquettes (Entreprise, Hors horaires...) separees
//       par un point median, jamais collees (« EntrepriseHors horaires »), puis
//       « Modifié 07:39, STAFF BAR GEMBLOUX » sans la liste des retraits, qui
//       reste dans son infobulle et dans l historique ; meme en-tete dans
//       l onglet Modifier ;
//   [H] « pourquoi deux fois dire formule sur mesure » : une formule posee ou
//       changee se dit une fois. L historique (lib/historique-dossier.js), la
//       raison d un prix ecrite au comptoir (rsRaisonPrix), la bulle de la
//       formule du Complet et sa rubrique Prix, l infobulle de la derniere
//       modification : une etiquette ne se redit jamais dans sa valeur, meme
//       sur une ligne deja ecrite en base avant ce lot ;
//   [J] aucune erreur JS.
// La console reelle sur la journee « pic » (scripts/planning-v3-fixtures.js),
// a laquelle la page ajoute le dossier 1892 tel qu il est en base : sa
// derniere modification (six changements, dont trois retraits et un prix a la
// raison redite), la trace du prix, l ouverture exceptionnelle de 09:30 a
// 22:00. L historique de la fiche est rendu par le vrai lib/historique-dossier.js
// sur une ligne du journal (window.__fixtureLecture).
// --contre-preuves : chaque garde retiree (en memoire, au texte servi ; le
// disque n est jamais touche) fait rougir sa lettre ; chaque ancre existe une
// fois et une seule.
// PINLANE_PHOTOS_DIR=<dossier> (et PINLANE_PHOTOS_PREFIXE) : les captures.
// Lancement : node scripts/resa-lisible-check.js [--contre-preuves]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_RESA_LISIBLE_PORT || 5237);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PHOTOS = process.env.PINLANE_PHOTOS_DIR || '';
const PREFIXE = process.env.PINLANE_PHOTOS_PREFIXE || '';
const JS = 'assets/app-main.js';
const CSS = 'assets/pinlane-staff.css';
const PG = 'assets/pinlane-planning-global.js';
const HISTO = 'lib/historique-dossier.js';
const ID = 1892;
const ID_NEUF = 1893;

let echecs = 0;
let silence = false;
const rouges = [];
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 700)}` : ''}`);
  return cond;
}

let mutation = null;
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel) t = t.replace(ed.de, () => ed.vers);
  return t;
}
const lire = (rel) => transformer(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n'));

// Une etiquette redite dans sa valeur : « X : X », ou « X : X suite ».
const cle = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function redite(phrase) {
  const vus = [];
  String(phrase || '').replace(/(^|, | · )([^,·:]+?) : ([^,·]+?)(?=$|, | · )/g, (tout, avant, e, v) => {
    if (cle(e) && (cle(v) === cle(e) || cle(v).startsWith(`${cle(e)} `))) vus.push(tout.trim());
    return tout;
  });
  return vus;
}

// ---------------------------------------------------------------------------
// LE DOSSIER 1892 TEL QU IL EST EN BASE.
// ---------------------------------------------------------------------------
const JOUR = FX.lireFixture('pic').staffState.date;
// (la console est montee a 08:00 : la visite de 09:30 est a venir, comme sur l ecran d Ansar)
const HEURE = '08:00';
const LE_MODIF = FX.instant(JOUR, '07:39').toISOString();
const LE_PRIX = FX.instant(JOUR, '07:37').toISOString();
const RAISON_ANCIENNE = 'Formule sur mesure : Formule sur mesure';
const notePrix = (de, a, raison, le = LE_PRIX) => `[equipe] ${JSON.stringify({ t: `Prix ${de} € → ${a} €, ${raison}`, par: 'STAFF BAR GEMBLOUX', le, type: 'prix', prix: { de, a, raison } })}`;
const QUOI = ['Retrait : Laser Game', 'Retrait : Minigolf Blacklight', 'Retrait : Golf o\'Clock', 'Ajout : Boissons × 108, 324 €', `Prix 5842 € → 4006,80 €, ${RAISON_ANCIENNE}`, '120 → 108 joueurs'];

// La ligne du journal que le serveur a ecrite a 07:37 (le prix et sa trace).
function ligneDuJournal(raison) {
  return {
    action: 'updateReservation', actorLabel: 'STAFF BAR GEMBLOUX', actorKind: 'staff', occurredAt: LE_PRIX,
    centerId: 'libramont', entityType: 'reservation', entityId: String(ID), outcome: 'success', context: {},
    changes: { price: { before: 5842, after: 4006.8 }, notes: { before: '', after: notePrix(5842, 4006.8, raison) } },
  };
}

function chargerHisto() {
  const fichier = path.join(ROOT, HISTO);
  const m = new Module(fichier, module);
  m.filename = fichier;
  m.paths = Module._nodeModulePaths(path.dirname(fichier));
  m._compile(lire(HISTO), fichier);
  return m.exports;
}

// ---------------------------------------------------------------------------
// [H] LE SERVEUR ET LE COMPTOIR, HORS NAVIGATEUR.
// ---------------------------------------------------------------------------
function fonctionDuSource(src, nom) {
  const debut = src.indexOf(`function ${nom}(`);
  if (debut < 0) throw new Error(`fonction absente : ${nom}`);
  let i = src.indexOf('{', src.indexOf(')', debut));
  let profondeur = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') profondeur += 1;
    else if (src[i] === '}') { profondeur -= 1; if (profondeur === 0) break; }
  }
  return src.slice(src.lastIndexOf('\n', debut) + 1, i + 1);
}

function groupeServeur() {
  const H = chargerHisto();
  const entree = H.entreeDuJournal(ligneDuJournal(RAISON_ANCIENNE), String(ID));
  const quoi = (entree && entree.quoi) || [];
  ok(quoi.includes('Prix 5842 € → 4006,80 €, Formule sur mesure'), '[H] l historique dit « Prix 5842 € → 4006,80 €, Formule sur mesure », la formule une fois (ligne deja en base)', quoi);
  const nommee = H.entreeDuJournal(ligneDuJournal('Formule sur mesure : Family Day'), String(ID));
  ok(((nommee && nommee.quoi) || []).includes('Prix 5842 € → 4006,80 €, Formule sur mesure : Family Day'), '[H] une formule nommee garde son etiquette et son nom', nommee && nommee.quoi);
  const prolongee = H.entreeDuJournal(ligneDuJournal('Formule sur mesure : Formule sur mesure Family Day'), String(ID));
  ok(((prolongee && prolongee.quoi) || []).includes('Prix 5842 € → 4006,80 €, Formule sur mesure Family Day'), '[H] un nom qui commence par l etiquette ne la redit pas', prolongee && prolongee.quoi);
  const avant = { price: 5842, notes: '' };
  const apres = { price: 4006.8, notes: notePrix(5842, 4006.8, RAISON_ANCIENNE) };
  const derniere = H.derniereModifDu(avant, apres, { par: 'STAFF BAR GEMBLOUX', maintenant: new Date(LE_PRIX) });
  ok(derniere && derniere.quoi.includes('Prix 5842 € → 4006,80 €, Formule sur mesure'), '[H] la derniere modification ecrite avec le dossier ne la redit pas non plus', derniere && derniere.quoi);
  const toutes = [...quoi, ...((derniere && derniere.quoi) || []), ...H.phrasesDuChangement({ occasion: 'Entreprise' }, { occasion: 'Entreprise : entreprise' }).contenu];
  ok(toutes.every((p) => !redite(p).length), '[H] aucune phrase du journal ne redit son etiquette', toutes.filter((p) => redite(p).length));
  ok(quoi.length && H.phrasesDuChangement({ extras: [{ name: 'Laser Game', price: 0 }] }, { extras: [] }).contenu[0] === 'Retrait : Laser Game', '[H] « Retrait : Laser Game » reste tel quel');

  // Le comptoir : la raison du prix d une formule composee (rsRaisonPrix).
  const src = lire(JS);
  const bac = { quickBookState: null };
  vm.createContext(bac);
  vm.runInContext(`${['rsFmMontant', 'rsFmActive', 'rsFmNom', 'rsRaisonPrix'].map((n) => fonctionDuSource(src, n)).join('\n')}\nthis.raison = (s) => { quickBookState = s; return rsRaisonPrix(); };`, bac);
  const s = (nom, prixRaison = '') => ({ type: 'visite', fm: { nom, mode: 'personne', montant: '37,10' }, prixRaison, prixRaisonLibre: '' });
  ok(bac.raison(s('')) === 'Formule sur mesure', '[H] au comptoir, une formule sans nom donne la raison « Formule sur mesure », une fois', bac.raison(s('')));
  ok(bac.raison(s('Family Day', 'Geste commercial')) === 'Formule sur mesure : Family Day · Geste commercial', '[H] au comptoir, une formule nommee dit son nom', bac.raison(s('Family Day', 'Geste commercial')));
  ok(bac.raison(s('Formule sur mesure entreprise')) === 'Formule sur mesure entreprise', '[H] au comptoir, un nom qui dit deja « formule sur mesure » ne la redit pas', bac.raison(s('Formule sur mesure entreprise')));
}

// ---------------------------------------------------------------------------
// DANS LA PAGE : le dossier pose sur la journee, puis ce que l ecran montre.
// ---------------------------------------------------------------------------
function poser({ id, idNeuf, quoi, leModif, notes, notesNeuf }) {
  const fx = window.__FIXTURE__;
  const liste = fx.jours[fx.jour];
  const copie = (o) => JSON.parse(JSON.stringify(o));
  const bloc = (debut, minutes, pistes, joueurs, capacite) => {
    const [h, m] = debut.split(':').map(Number);
    const s = h * 60 + m;
    const fin = s + minutes;
    const hh = (x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
    return { end: fin, type: 'activity', label: 'Bowling', lanes: pistes, start: s, endTime: hh(fin), players: joueurs, critical: true, startTime: debut, activityId: 'bowling', countIndex: 1, resourceType: 'bowling_lane', requiredLanes: pistes.length, durationMinutes: minutes, ...(capacite ? { bowlingCapacity: capacite, emergencyWarning: '18 + 18 + 18 + 18 + 18 + 18 joueurs sur 6 pistes : choisi à la main.' } : {}) };
  };
  const dossier = (modele, champs, b) => {
    const r = copie(liste.find((x) => x.id === modele));
    Object.assign(r, champs, { lanes: b.lanes.slice(), startTime: b.startTime, duration: b.durationMinutes / 60, totalDuration: b.durationMinutes / 60 });
    r.opsPlan = Object.assign({}, r.opsPlan || {}, { startTime: b.startTime, endTime: b.endTime, assignedLanes: b.lanes.slice(), resourceBlocks: [b], timeline: [Object.assign({}, b)], conflicts: [] });
    delete r.opsPlan.derniereModif;
    return r;
  };
  const capacite = { emergency: true, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7, normalLanesNeeded: 18, lanePlayers: [18, 18, 18, 18, 18, 18], estimatedMinutes: 180, speedWarning: true };
  const r = dossier(1617, {
    id, name: 'Family Day', pax: 108, status: 'pending', validationStatus: 'confirmed', type: 'bowling', occasion: 'entreprise', label: 'Formule sur mesure',
    price: 4006.8, basePrice: 5842, notes, phone: '', email: '', extras: [],
    program: { items: [{ activityId: 'bowling', name: 'Bowling', duration: 1, participants: 108, planned: true }], price: 4006.8, formuleSurMesure: { nom: 'Formule sur mesure', prixParPersonne: 37.1 } },
  }, bloc('09:30', 60, [3, 4, 5, 6, 7, 8], 108, capacite));
  r.opsPlan.derniereModif = { le: leModif, par: 'STAFF BAR GEMBLOUX', quoi };
  // Un dossier pose apres ce lot : sa raison dit « Formule sur mesure » une fois.
  const neuf = dossier(1610, {
    id: idNeuf, name: 'Famille Sur Mesure', pax: 6, status: 'pending', validationStatus: 'confirmed', type: 'bowling', occasion: 'famille', label: 'Formule sur mesure',
    price: 200, basePrice: 240, notes: notesNeuf, phone: '', email: '', extras: [],
    program: { items: [{ activityId: 'bowling', name: 'Bowling', duration: 1, participants: 6, planned: true }], price: 200, formuleSurMesure: { nom: 'Formule sur mesure' } },
  }, bloc('11:00', 60, [8], 6, null));
  [r, neuf].forEach((x) => { const i = liste.findIndex((y) => y.id === x.id); if (i >= 0) liste.splice(i, 1, x); else liste.push(x); });
  // L ouverture exceptionnelle du jour, comme staff-state la porte (un releve ne l efface pas).
  const ouverture = { date: fx.jour, open: '09:30', close: '22:00' };
  if (!window.__ouvertureGardee) {
    const poserOuvertures = window.smPoserOuvertures;
    window.smPoserOuvertures = (l) => poserOuvertures((Array.isArray(l) ? l : []).filter((o) => o && o.date !== ouverture.date).concat([ouverture]));
    window.__ouvertureGardee = true;
  }
  window.smPoserOuvertures([]);
  state.reservations = liste.map((x) => Object.assign({}, x));
  renderStaff();
  const lu = state.reservations.find((x) => x.id === id);
  return { marques: (window.pgMarques ? window.pgMarques(lu) : []).map((m) => m.mot), occasion: getReservationOccasion(lu) };
}

function lirePlanning(id) {
  const cartes = Array.from(document.querySelectorAll(`.booking[data-booking-res-id="${id}"]`));
  const R = (el) => el.getBoundingClientRect();
  const vu = (el) => Boolean(el) && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && R(el).width > 0;
  return cartes.map((c) => {
    const pax = c.querySelector('.bk-pax');
    const alerte = c.querySelector('.bk-pax-alerte');
    const cr = R(c);
    const dedans = (el) => { if (!vu(el)) return true; const b = R(el); return b.left >= cr.left - 0.5 && b.right <= cr.right + 0.5 && b.top >= cr.top - 0.5 && b.bottom <= cr.bottom + 0.5; };
    const enfants = Array.from(c.querySelectorAll('.booking-head > *, .booking-foot > *, .booking-stats > *')).filter(vu);
    // L unite (« j », « joueurs ») sur le fond de la pastille quand elle en a un : son
    // contraste, opacite comprise (WCAG AA, 4,5:1 pour un petit texte).
    const rvb = (s) => (String(s).match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const fond = pax ? rvb(getComputedStyle(pax).backgroundColor) : [];
    const unite = pax ? Array.from(pax.querySelectorAll('.u-short, .u-long')).find((u) => vu(u) && u.textContent.trim()) : null;
    let contrasteUnite = null;
    if (unite && fond.length >= 3 && (fond.length < 4 || fond[3] > 0.5)) {
      const [r, g, b, a = 1] = rvb(getComputedStyle(unite).color);
      let o = a;
      for (let n = unite; n && n !== pax; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
      const melange = [r, g, b].map((v, i) => v * o + fond[i] * (1 - o));
      const [l1, l2] = [lum(melange), lum(fond)].sort((x, y) => y - x);
      contrasteUnite = Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
    }
    return {
      piste: c.getAttribute('data-booking-lane'),
      largeur: Math.round(cr.width),
      paxVu: vu(pax),
      // (le nombre sans son unite, « j » ou « joueurs » selon la place)
      paxTexte: pax ? (() => { const c = pax.cloneNode(true); c.querySelectorAll('.u').forEach((u) => u.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); })() : '',
      paxContientAlerte: Boolean(pax && pax.querySelector('.bk-pax-alerte, [aria-label*="secours"], [aria-label*="joueurs par piste"]')) || /⚠/.test(pax ? pax.textContent : ''),
      alerteVue: vu(alerte),
      alerteNom: alerte ? alerte.getAttribute('aria-label') || '' : '',
      alerteBulle: alerte ? alerte.getAttribute('title') || '' : '',
      alerteRole: alerte ? alerte.getAttribute('role') || '' : '',
      ecart: vu(pax) && vu(alerte) ? Math.round((R(alerte).left - R(pax).right) * 10) / 10 : null,
      alerteHaut: vu(alerte) ? Math.round(R(alerte).height) : 0,
      contrasteUnite,
      dedans: [pax, alerte].every(dedans) && enfants.every(dedans),
      deborde: Array.from(c.querySelectorAll('.booking-foot, .booking-stats, .booking-head')).filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.className),
    };
  });
}

function lireEnTete() {
  const m = document.querySelector('#posOverlay .edit-modal');
  if (!m) return null;
  const R = (el) => el.getBoundingClientRect();
  const txt = (el) => (el ? el.innerText.replace(/\s+/g, ' ').trim() : '');
  const ligne = m.querySelector('.fz-ligne');
  const faits = Array.from(m.querySelectorAll('.fx-chiffres .dossier-fact, .dossier-facts .dossier-fact')).map((f) => ({ t: txt(f.querySelector('strong') || f), haut: Math.round(R(f.querySelector('strong') || f).top) }));
  const etiquettes = Array.from(m.querySelectorAll('.fz-ligne .fx-etiquette')).map((e) => ({ t: txt(e), haut: Math.round(R(e).top) }));
  const modif = m.querySelector('.fz-ligne [data-fx-modif]');
  return {
    vue: Boolean(ligne) && ligne.getClientRects().length > 0 && getComputedStyle(ligne).display !== 'none',
    texte: txt(ligne),
    faits,
    etiquettes,
    modif: modif ? { t: txt(modif), bulle: modif.getAttribute('title') || '', haut: Math.round(R(modif).top) } : null,
    edition: m.classList.contains('is-edition'),
  };
}

async function lireHistorique(page, id) {
  await page.evaluate((x) => { const d = document.querySelector(`#posOverlay [data-fx-histo="${x}"]`); if (d && !d.open) d.querySelector('summary').click(); }, id);
  await page.waitForSelector(`#posOverlay [data-fx-histo="${id}"] .fx-histo-entree`, { timeout: 8000 }).catch(() => null);
  return page.evaluate((x) => Array.from(document.querySelectorAll(`#posOverlay [data-fx-histo="${x}"] .fx-histo-quoi li`)).map((li) => li.textContent.trim()), id);
}

async function photo(page, nom, selecteur) {
  if (!PHOTOS) return;
  fs.mkdirSync(PHOTOS, { recursive: true });
  const fichier = path.join(PHOTOS, `${PREFIXE}${nom}.png`);
  const el = selecteur ? await page.$(selecteur) : null;
  if (el) await el.screenshot({ path: fichier });
  else await page.screenshot({ path: fichier });
}

// ---------------------------------------------------------------------------
// UN ECRAN : le planning bowling, le Complet, la fiche, Modifier, l historique.
// ---------------------------------------------------------------------------
async function scenario(browser, s) {
  const H = chargerHisto();
  const { ctx, page, erreurs } = await FX.monter(browser, {
    fixture: 'pic', appareil: s.appareil, theme: s.theme || 'light', port: PORT, heure: HEURE,
    avantChargement: async (p) => {
      await p.exposeFunction('__fixtureLecture', (url) => {
        if (!/historique=/.test(url)) return null;
        const id = new URL(url, 'http://x').searchParams.get('historique');
        const entree = id === String(ID) ? H.entreeDuJournal(ligneDuJournal(RAISON_ANCIENNE), String(ID)) : null;
        return { ok: true, historique: entree ? [entree] : [] };
      });
    },
  });
  const ici = `${s.appareil}${s.theme === 'dark' ? ' sombre' : ''}`;
  try {
    const pose = await page.evaluate(poser, { id: ID, idNeuf: ID_NEUF, quoi: QUOI, leModif: LE_MODIF, notes: notePrix(5842, 4006.8, RAISON_ANCIENNE), notesNeuf: notePrix(240, 200, 'Formule sur mesure') });
    ok(pose.marques.includes('Entreprise') && pose.marques.includes('Hors horaires'), `[J] ${ici} : prerequis, le dossier est « Entreprise » et « Hors horaires »`, pose);
    await FX.repos(page, 300);

    // [H] LE COMPLET : la bulle de la formule et la rubrique Prix.
    const complet = await page.evaluate(({ id, idNeuf }) => {
      const ligne = (x) => document.querySelector(`.gf-r[data-gf-id="${x}"]`);
      const t = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
      return {
        bulle: (ligne(id) && ligne(id).querySelector('.gf-formule') || {}).title || '',
        prix: t(ligne(id) && ligne(id).querySelector('.gf-i--prix p')),
        prixNeuf: t(ligne(idNeuf) && ligne(idNeuf).querySelector('.gf-i--prix p')),
        formuleNeuf: t(ligne(idNeuf) && ligne(idNeuf).querySelector('.gf-i--formule p')),
        // (la raison que lisent l infobulle du prix des cartes et l encadre « Prix ajusté »)
        raison: window.pgEssentiel(state.reservations.find((r) => r.id === id)).raison,
      };
    }, { id: ID, idNeuf: ID_NEUF });
    ok(complet.raison === 'formule sur mesure', `[H] ${ici} : la raison du prix lue par les cartes et l encadre dit la formule une fois`, complet.raison);
    ok(complet.bulle === 'Formule sur mesure', `[H] ${ici} : la bulle de la formule du Complet dit « Formule sur mesure », une fois`, complet);
    ok(complet.prix && complet.prixNeuf && !/sur mesure/i.test(complet.prix) && !/sur mesure/i.test(complet.prixNeuf) && /Formule sur mesure/.test(complet.formuleNeuf),
      `[H] ${ici} : la rubrique Prix du Complet ne redit pas la formule que la rubrique Formule vient de dire (ancienne et nouvelle raison)`, complet);
    if (s.photos) await photo(page, `complet-${s.appareil}`, `.gf-r[data-gf-id="${ID}"]`);

    // [P] LE PLANNING BOWLING.
    await page.evaluate(() => { setStaffResourceView('bowling'); });
    await FX.repos(page, 300);
    await page.evaluate((id) => { const c = document.querySelector(`.booking[data-booking-res-id="${id}"]`); if (c) c.scrollIntoView({ block: 'center', inline: 'center' }); }, ID);
    await FX.repos(page, 200);
    const cartes = await page.evaluate(lirePlanning, ID);
    ok(cartes.length === 6, `[P] ${ici} : six cartes, une par piste (3 a 8)`, cartes.map((c) => c.piste));
    ok(cartes.every((c) => !c.paxContientAlerte && c.paxTexte === '108'), `[P] ${ici} : la pastille dit « 108 », le nombre seul, sans l alerte collee`, cartes.map((c) => c.paxTexte));
    ok(cartes.every((c) => c.paxVu && c.alerteVue), `[P] ${ici} : la carte dit le nombre ET son alerte`, cartes.map((c) => `${c.piste}:${c.paxVu}/${c.alerteVue}@${c.largeur}`));
    ok(cartes.every((c) => !c.alerteVue || (c.alerteRole === 'img' && /^Pistes chargées : 18 joueurs par piste, 6 d’habitude\./.test(c.alerteNom) && c.alerteBulle === c.alerteNom && /180 min/.test(c.alerteBulle))),
      `[P] ${ici} : l alerte dit pourquoi au survol et a la synthese vocale (« Pistes chargées : 18 joueurs par piste, 6 d’habitude », environ 180 min)`, cartes.map((c) => c.alerteBulle).slice(0, 1));
    ok(cartes.every((c) => c.ecart === null || c.ecart >= 3), `[P] ${ici} : l alerte n est pas soudee au nombre (3 px au moins entre eux)`, cartes.map((c) => c.ecart));
    ok(cartes.every((c) => c.alerteHaut === 0 || (c.alerteHaut >= 10 && c.alerteHaut <= 16)), `[P] ${ici} : l alerte a la taille d un marqueur de carte`, cartes.map((c) => c.alerteHaut));
    ok(cartes.every((c) => c.dedans && !c.deborde.length), `[P] ${ici} : rien ne deborde de la carte`, cartes.filter((c) => !c.dedans || c.deborde.length));
    ok(cartes.every((c) => c.contrasteUnite === null || c.contrasteUnite >= 4.5), `[P] ${ici} : dans la pastille, l unite se lit (4,5:1 au moins sur son fond)`, cartes.map((c) => c.contrasteUnite));
    if (s.pastille) ok(cartes.some((c) => c.contrasteUnite !== null), `[P] ${ici} : prerequis, la pastille a son fond a cette largeur (le contraste de l unite est mesure)`, cartes.map((c) => c.largeur));
    if (s.photos) await photo(page, `planning-${s.appareil}`, '#planningGridWrap');
    // LES PISTES SERREES une a une, en fenetre et en plein ecran (la largeur reelle de
    // la colonne, celle que lisent les regles de cession) : rien ne deborde, l alerte
    // ne reste jamais sans son nombre, et elle ne part pas tant qu elle tient (90 px).
    if (s.etroit) {
      for (const plein of [false, true]) {
        await page.evaluate((p) => { state.staffPlanningExpanded = p; renderStaff(); }, plein);
        await FX.repos(page, 200);
        for (const largeur of [134, 120, 116, 112, 108, 100, 90, 88, 80, 70, 64, 60]) {
          await page.evaluate(({ id, largeur }) => new Promise((fin) => {
            document.querySelectorAll(`.booking[data-booking-res-id="${id}"]`).forEach((c) => { const col = c.closest('.lane-col'); col.style.flex = `0 0 ${largeur}px`; col.style.minWidth = `${largeur}px`; col.style.maxWidth = `${largeur}px`; });
            requestAnimationFrame(() => requestAnimationFrame(() => fin(null)));
          }), { id: ID, largeur });
          const c = await page.evaluate(lirePlanning, ID);
          ok(c.length === 6 && c.every((x) => (!x.alerteVue || x.paxVu) && (largeur < 90 || x.alerteVue) && x.dedans && !x.deborde.length && (x.ecart === null || x.ecart >= 3) && (!x.paxVu || x.paxTexte === '108')),
            `[P] ${ici}${plein ? ' plein ecran' : ''} : piste de ${largeur} px, rien ne deborde, l alerte jamais sans son nombre${largeur >= 90 ? ', et la' : ''}`,
            c.map((x) => `${x.largeur}px ${x.paxVu ? 'nombre' : '-'}/${x.alerteVue ? 'alerte' : '-'}${x.dedans ? '' : ' DEBORDE'}${x.deborde.length ? ` ${x.deborde.join(',')}` : ''}`).slice(0, 2));
        }
        await page.evaluate((id) => document.querySelectorAll(`.booking[data-booking-res-id="${id}"]`).forEach((c) => { const col = c.closest('.lane-col'); ['flex', 'min-width', 'max-width'].forEach((p) => col.style.removeProperty(p)); }), ID);
      }
      await page.evaluate(() => { state.staffPlanningExpanded = false; renderStaff(); });
      await FX.repos(page, 200);
    }

    // [F] LA FICHE : Infos.
    await page.evaluate((id) => { if (typeof closePos === 'function') closePos(); openPos(id); }, ID);
    await page.waitForSelector('#posOverlay .fx-modal', { timeout: 10000 });
    await FX.repos(page, 300);
    const juger = (t, ou) => {
      ok(t && t.vue, `[F] ${ou} : la ligne sous le nom est a l ecran`, t);
      if (!t || !t.vue) return;
      const attendus = [/^09:30\s*→\s*10:30$/, /^108 joueurs$/, /^Formule sur mesure$/, /^sam\. 16 janv\.$/, /^Pistes 3 à 8$/, new RegExp(`^n° ${ID}$`)];
      ok(attendus.every((re, i) => t.faits[i] && re.test(t.faits[i].t)), `[F] ${ou} : la visite d abord, heure, joueurs, formule, jour, pistes, numero`, t.faits.map((f) => f.t));
      ok(t.etiquettes.map((e) => e.t).join('|') === 'Entreprise|Hors horaires, ouverture exceptionnelle de 09:30 à 22:00', `[F] ${ou} : les etiquettes, chacune entiere`, t.etiquettes.map((e) => e.t));
      ok(/Entreprise · Hors horaires/.test(t.texte) && !/EntrepriseHors/.test(t.texte), `[F] ${ou} : les etiquettes separees par un point median, jamais collees`, t.texte);
      ok(t.modif && t.modif.t === 'Modifié 07:39, STAFF BAR GEMBLOUX', `[F] ${ou} : « Modifié 07:39, STAFF BAR GEMBLOUX », court`, t.modif);
      ok(!/Retrait|\+\d/.test(t.texte), `[F] ${ou} : la ligne ne liste plus les retraits`, t.texte);
      ok(t.modif && /Retrait : Laser Game/.test(t.modif.bulle) && /120 → 108 joueurs/.test(t.modif.bulle) && !redite(t.modif.bulle).length, `[F] ${ou} : le detail reste dans l infobulle, entier, sans redite`, t.modif && t.modif.bulle);
      if (s.ordi) {
        const l1 = t.faits[0] ? t.faits[0].haut : -1;
        ok(t.faits.every((f) => Math.abs(f.haut - l1) <= 2), `[F] ${ou} : la visite tient sur une ligne`, t.faits.map((f) => f.haut));
        const l2 = t.etiquettes.length ? t.etiquettes[0].haut : -1;
        ok(l2 > l1 + 10 && t.modif && Math.abs(t.modif.haut - l2) <= 2 && t.etiquettes.every((e) => Math.abs(e.haut - l2) <= 2), `[F] ${ou} : dessous, les etiquettes puis « Modifié », sur leur ligne`, { l1, etiquettes: t.etiquettes.map((e) => e.haut), modif: t.modif && t.modif.haut });
      }
    };
    juger(await page.evaluate(lireEnTete), `${ici} Infos`);
    if (s.photos) await photo(page, `fiche-${s.appareil}`, '#posOverlay .edit-modal-head');

    // [H] L HISTORIQUE DE LA FICHE (le vrai lib/historique-dossier.js).
    const histo = await lireHistorique(page, ID);
    ok(histo.includes('Prix 5842 € → 4006,80 €, Formule sur mesure') && histo.every((x) => (x.match(/formule sur mesure/gi) || []).length <= 1),
      `[H] ${ici} : l historique de la fiche dit la formule une fois`, histo);
    if (s.photos) await photo(page, `historique-${s.appareil}`, `#posOverlay [data-fx-histo="${ID}"]`);

    // [F] MODIFIER : le meme en-tete (au telephone, Modifier garde le nom seul).
    if (s.ordi) {
      await page.evaluate(() => setTab('modifier'));
      await FX.repos(page, 400);
      juger(await page.evaluate(lireEnTete), `${ici} Modifier`);
      if (s.photos) await photo(page, `modifier-${s.appareil}`, '#posOverlay .edit-modal-head');
    }
    await page.evaluate(() => { if (typeof closePos === 'function') closePos(); });
    ok(erreurs.length === 0, `[J] ${ici} : aucune erreur JS`, erreurs.slice(0, 3));
  } finally { await ctx.close(); }
}

const SCENARIOS = [
  { appareil: 'ordinateur', ordi: true, photos: true, etroit: true },
  { appareil: 'grand', ordi: true, photos: true, pastille: true },
  { appareil: 'grand', ordi: true, theme: 'dark', pastille: true },
  { appareil: 'portable', ordi: true, theme: 'dark' },
  { appareil: 'tablette-portrait' },
  { appareil: 'telephone', photos: true },
];

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une garde retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const ORDI = [SCENARIOS[0]];
const MUTATIONS = [
  // [P] la carte du planning.
  { nom: 'alerte-dans-la-pastille', lettre: 'P', scenarios: ORDI, editions: [{ fichier: JS, de: '">${paxNum}<span class="u"><span class="u-short">j</span>', vers: '">${paxNum}${charge ? \'<span aria-label="Capacité de secours">⚠</span>\' : \'\'}<span class="u"><span class="u-short">j</span>' }] },
  { nom: 'alerte-muette', lettre: 'P', scenarios: ORDI, editions: [{ fichier: JS, de: '<span class="bk-pax-alerte" role="img" aria-label="${escapeHtml(charge)}" title="${escapeHtml(charge)}">', vers: '<span class="bk-pax-alerte">' }] },
  { nom: 'six-fois-dix-huit', lettre: 'P', scenarios: ORDI, editions: [{ fichier: JS, de: "const partition = plusieurs && parPiste.every(n => n === parPiste[0]) ? String(parPiste[0]) : parPiste.join(' + ');", vers: "const partition = parPiste.join(' + ');" }] },
  { nom: 'alerte-soudee', lettre: 'P', scenarios: ORDI, editions: [{ fichier: CSS, de: '.bk-pax-alerte {\n  flex: 0 0 auto;', vers: '.bk-pax-alerte {\n  flex: 0 0 auto;\n  margin-left: -5px;' }] },
  { nom: 'alerte-avant-la-duree-retiree', lettre: 'P', scenarios: ORDI, editions: [{ fichier: CSS, de: '@container piste (max-width: 87px) {\n  .booking .bk-pax-alerte { display: none; }\n}', vers: '' }] },
  { nom: 'progression-garde-sa-place', lettre: 'P', scenarios: ORDI, editions: [{ fichier: CSS, de: '@container piste (max-width: 119px) {\n  .booking:has(.bk-pax-alerte) .activity-pill { display: none; }\n}', vers: '' }] },
  { nom: 'unite-illisible-dans-la-pastille', lettre: 'P', scenarios: [SCENARIOS[1]], editions: [{ fichier: CSS, de: '.booking .bk-pax:is(.grp-l, .grp-xl) .u { color: inherit; }\n', vers: '' }] },
  // [F] l en-tete de la fiche.
  { nom: 'etiquettes-collees', lettre: 'F', scenarios: ORDI, editions: [{ fichier: JS, de: "contexte.join(' <span class=\"fx-sep\" aria-hidden=\"true\">·</span> ')", vers: "contexte.join('')" }] },
  { nom: 'detail-apres-un-point-median', lettre: 'F', scenarios: ORDI, editions: [{ fichier: JS, de: ': `<span class="fx-etiquette">${escapeHtml(e.titre)}${e.texte ? `, ${escapeHtml(e.texte)}` : \'\'}</span>`));', vers: ': `<span class="fx-etiquette">${escapeHtml(e.titre)}${e.texte ? ` · ${escapeHtml(e.texte)}` : \'\'}</span>`));' }] },
  { nom: 'modif-bavarde', lettre: 'F', scenarios: ORDI, editions: [{ fichier: JS, de: '${escapeHtml(derniereModifCourte)}</span>', vers: '${escapeHtml(derniereModif)}</span>' }] },
  { nom: 'detail-perdu', lettre: 'F', scenarios: ORDI, editions: [{ fichier: JS, de: '<span class="fx-modif" data-fx-modif title="${escapeHtml(derniereModif)}">', vers: '<span class="fx-modif" data-fx-modif>' }] },
  { nom: 'contexte-dans-la-ligne', lettre: 'F', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .fz-ligne .fz-faits > .fx-contexte { display: block; margin: 0; }', vers: '.fx-modal .fz-ligne .fz-faits > .fx-contexte { display: inline; margin: 0; }' }] },
  { nom: 'modif-ancienne-redite', lettre: 'F', scenarios: ORDI, editions: [{ fichier: JS, de: "${dits.map(sansRedite).join(' · ')}", vers: "${dits.join(' · ')}" }] },
  // [H] une formule se dit une fois.
  { nom: 'historique-redit', lettre: 'H', serveur: true, scenarios: ORDI, editions: [
    { fichier: HISTO, de: 'phrases.map((phrase) => sansRedite(texte(phrase)))', vers: 'phrases.map((phrase) => texte(phrase))' },
    { fichier: HISTO, de: 'quoiDuJournal(ligne, reservationId).map((phrase) => sansRedite(texte(phrase)))', vers: 'quoiDuJournal(ligne, reservationId).map((phrase) => texte(phrase))' }] },
  { nom: 'comptoir-redit', lettre: 'H', serveur: true, editions: [{ fichier: JS, de: "const formule = !nom ? '' : /^formule sur mesure\\b/i.test(nom) ? nom : `Formule sur mesure : ${nom}`;", vers: "const formule = nom ? `Formule sur mesure : ${nom}` : '';" }] },
  { nom: 'bulle-du-complet-redit', lettre: 'H', scenarios: ORDI, editions: [{ fichier: PG, de: "long: gfSansRedite('Formule sur mesure : ' + comptoir.nom)", vers: "long: 'Formule sur mesure : ' + comptoir.nom" }] },
  { nom: 'prix-du-complet-redit', lettre: 'H', scenarios: ORDI, editions: [{ fichier: PG, de: ".replace(comptoir ? /,\\s*formule sur mesure(?:\\s*:[^·,]*)?(\\s*·\\s*)?/i : /$^/, function (x, suite) { return suite ? ', ' : ''; });", vers: ".replace(comptoir ? /,?\\s*formule sur mesure\\s*:.*$/i : /$^/, '');" }] },
  { nom: 'raison-du-prix-redit', lettre: 'H', scenarios: ORDI, editions: [{ fichier: PG, de: "var raison = gfSansRedite((notePrix && notePrix.raison) || r.discountReason || '');", vers: "var raison = (notePrix && notePrix.raison) || r.discountReason || '';" }] },
];

async function main() {
  const contre = process.argv.includes('--contre-preuves');
  const serveur = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!contre) {
      groupeServeur();
      for (const s of SCENARIOS) await scenario(browser, s);
    } else {
      console.log('[K] contre-preuves : chaque garde retiree fait rougir sa lettre');
      for (const m of MUTATIONS) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.RL_BAVARD;
        try {
          if (m.serveur) groupeServeur();
          for (const s of m.scenarios || []) await scenario(browser, s);
        } catch (e) { rouges.push(`[${m.lettre}] crash ${e.message}`); }
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
    serveur.close();
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nresa-lisible-check: FAIL ${echecs}`); process.exitCode = 1; return; }
  console.log(`\nresa-lisible-check: ALL OK${contre ? ' (contre-preuves)' : ''}`);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
// (le banc de captures du lot rejoue la meme journee)
else module.exports = { poser, chargerHisto, ligneDuJournal, notePrix, QUOI, ID, ID_NEUF, HEURE, LE_MODIF, RAISON_ANCIENNE };
