// L ONGLET MODIFIER, RANGE COMME LA FICHE (2026-10-27).
//
// Movsar, 27/10 : « ameliore encore plus beau [...] un truc plus beau user
// friendly et quon comprend tout en un coup doeil genre heure activité joueur
// plus visible [...] et surtout ameliorer tout le frontend de lendroit
// modifier ». La regle : l onglet Modifier range ses champs aux places de
// l onglet Infos, et dit ce qui partira avant le clic.
//   [M1] en haut le jour, l arrivee et les joueurs ; a gauche le programme ; a
//        droite le prix puis le client, puis « Annuler ou supprimer » replie ;
//        une colonne au telephone, dans le meme ordre ;
//   [M2] chaque activite porte son heure, celle du programme de l onglet
//        Infos (getGroupeProgramme) ; « Libre » sans heure ;
//   [M3] rien de redit : pas de second interrupteur de statut (il se change
//        dans Infos, avec le moyen de paiement), pas de phrase d aide, pas de
//        « 10 joueurs sur 10 participants » quand l activite a tout le groupe,
//        une ligne de prix qui ne redit pas le montant des champs ;
//   [M4] la barre du bas dit « Aucune modification » a l ouverture, puis ce
//        qui partira (« Joueurs 10 → 11 », « Pistes … », « Prix … »,
//        « Téléphone ajouté ») ;
//   [M5] quand le jour, l arrivee, les joueurs ou le programme changent, les
//        heures d avant sont barrees et la fiche dit qu elles seront
//        recalculees (le moteur fait foi, la fiche n invente pas d heure) ;
//   [M6] une activite qui avait tout le groupe suit le nouveau nombre de
//        joueurs, une activite qui n en avait qu une partie garde la sienne,
//        et le prix suit ;
//   [M7] ouvrir l onglet ne change rien : les pistes proposees sont celles du
//        dossier, cherchees a l heure du bowling et pas a l heure d arrivee ;
//   [M8] l enregistrement envoie ce qui est affiche (joueurs, pistes, prix,
//        telephone, joueurs par activite) ; un groupe qui grandit ne rend pas
//        le dossier « adapté » ;
//   [P1] une formule qui change de groupe garde le prix de la formule (39 EUR
//        x 11 pour FORMULE 4), sans partir en programme adapte : elle se
//        chiffrait comme des activites a la carte (386 EUR au lieu de 429) ;
//   [P2] un prix egal a la base ecrite plus les extras ne se dit pas « Prix
//        ajusté » (la ligne comparait la base seule au prix) ;
// Nourriture et extras (Movsar, 27/10 : « faut que tu rendes plus complet tout
// modifiable ajoute le genre nourriture autre »), sur les Collegues de bureau :
// deux cruches et des tapas vendues avant les lignes (u1, u4), 289 EUR pour
// une base de 238.
//   [E1] les extras se lisent en lignes sous le programme, par sorte
//        (Nourriture, Boissons, Autre), deux cruches en une ligne « × 2 » ;
//   [E2] une pizza ajoutee, des tapas retirees : le total suit (« Nouveau
//        total, avant 289 € ») et la barre du bas le dit ;
//   [E3] l enregistrement envoie ces extras et ce total ; la base reste 238 ;
//   [E4] un groupe qui grandit garde ses extras dans le prix (l estimation ne
//        comptait que les activites), et des arcades vendues au groupe suivent
//        le groupe ;
//   [E5] changer un telephone garde la base du dossier (elle etait reecrite
//        avec le seul bowling d une visite, qui se lisait alors « ajusté ») ;
//   [O1] l occasion se change en un clic, la barre le dit, elle part ;
//   [O2] les accompagnants d un Kids Fun Day (adultes presents, qui ne jouent
//        pas) se changent et partent ; sans accompagnants, pas de champ.
//   [L1] la fiche tient dans l ecran, sans defilement de cote, sans champ qui
//        en chevauche un autre, sans texte sous 12 px, la barre du bas visible
//        pendant qu on fait defiler ;
//   [J1] aucune erreur JS.
// La console reelle, montee par scripts/planning-v3-fixtures.js sur la journee
// « pic » de Fun Galaxy Libramont a 15:10 (aucun reseau, aucune base ; le
// PATCH est lu dans __FIXTURE__.patchs). Le Club de foot y joue au bowling a
// 14:00 apres une arrivee a 13:00, sur les pistes 5 et 6 : la piste 5 est prise
// a 13:00 par un autre groupe, la 7 a 14:00.
// --contre-preuves : chaque regle retiree (en memoire, au texte servi ; le
// disque n est jamais touche) fait rougir sa lettre ; chaque ancre existe une
// fois et une seule.
//   FM_MUTATIONS : un sous-ensemble ; FM_BAVARD : les lignes des contre-preuves.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_FICHE_MODIFIER_PORT || 5194);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JS = 'assets/app-main.js';
const CSS = 'assets/pinlane-staff.css';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);

let echecs = 0;
let silence = false;
const rouges = [];
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)}` : ''}`);
  return cond;
}

let mutation = null;
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel) t = t.replace(ed.de, () => ed.vers);
  return t;
}

// Un dossier par forme : bowling + laser + arcades (le club, ses pistes),
// formule avec bowling, laser seul, bowling seul, activites libres.
const DOSSIERS = ['Club de foot', 'Anniversaire Noah', 'Patro Saint-Pierre', 'Famille Henrard', 'Amis de Julien'];

// ---------------------------------------------------------------------------
// DANS LA PAGE : ce que l onglet ecrit, et ce que la console sait du dossier.
// ---------------------------------------------------------------------------
function lireModifier(nom) {
  const r = state.reservations.find((x) => String(x.name || '').includes(nom));
  if (!r) return { absent: nom };
  if (typeof closePos === 'function') closePos();
  openPos(r.id);
  setTab('modifier');
  const m = document.querySelector('#posOverlay .edit-modal');
  const corps = m.querySelector('.edit-modal-body');
  corps.scrollTop = 0;
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const R = (el) => el.getBoundingClientRect();
  const cs = (el) => getComputedStyle(el);
  const vu = (el) => Boolean(el) && el.checkVisibility() && R(el).height > 0;
  const principal = m.querySelector('.fm-principal');
  const cote = m.querySelector('.fm-cote');
  const pied = m.querySelector('.fm-pied');
  // Ce que le programme de l onglet Infos dit de chaque activite.
  const etapes = getGroupeProgramme(r);
  const heureAttendue = (id) => {
    const siennes = etapes.filter((e) => e.activityId === id);
    const placee = siennes.find((e) => e.start !== null && e.start !== undefined);
    return placee ? formatClockDisplay(placee.start) : siennes.some((e) => e.libre) ? 'Libre' : '--:--';
  };
  const activites = Array.from(m.querySelectorAll('[data-edit-activity]')).map((row) => ({
    id: row.dataset.editActivity,
    heure: txt(row.querySelector('.fm-heure')),
    attendue: heureAttendue(row.dataset.editActivity),
    joueurs: txt(row.querySelector('.dossier-activity-count .staff-stepper-value')),
    explication: vu(row.querySelector('.dossier-participants-explanation')),
  }));
  const quand = Array.from(m.querySelectorAll('.fm-quand .fm-champ')).map((c) => { const i = c.querySelector('.input, .fm-stepper'); const b = R(i); return { g: Math.round(b.left), d: Math.round(b.right), h: Math.round(b.top), bas: Math.round(b.bottom) }; });
  const chevauchent = quand.some((a, i) => quand.some((b, j) => j > i && a.g < b.d - 1 && b.g < a.d - 1 && a.h < b.bas - 1 && b.h < a.bas - 1));
  const textes = [];
  const marche = document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
  for (let n = marche.nextNode(); n; n = marche.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || !el || !el.getClientRects().length || el.closest('.visually-hidden, .sr-only, details:not([open]) > :not(summary), option, select')) continue;
    if (!vu(el)) continue;
    textes.push({ t: n.textContent.trim().slice(0, 30), px: parseFloat(cs(el).fontSize) });
  }
  const prixLigne = m.querySelector('#editPrixEstime');
  // Un bloc se nomme par sa classe fm-* (ses autres classes servent aux gates
  // et au CSS d avant).
  const bloc = (c) => Array.from(c.classList).find((k) => k.startsWith('fm-')) || c.className;
  return {
    id: r.id,
    pax: Number(r.pax),
    prix: formatMoneyCentimes(Number(r.price) || 0),
    principal: principal ? Array.from(principal.children).map(bloc) : [],
    cote: cote ? Array.from(cote.children).map(bloc) : [],
    autresReplie: Boolean(m.querySelector('.fm-cote > details.fm-autres:not([open]) .btn-secondary.danger')),
    cotes: principal && cote ? { pd: Math.round(R(principal).right), cg: Math.round(R(cote).left), pb: Math.round(R(principal).bottom), ch: Math.round(R(cote).top) } : null,
    activites,
    statut: m.querySelectorAll('.es-seg-btn, [data-statut], [role="radiogroup"]').length,
    corps: corps.innerText,
    prixLigne: vu(prixLigne) ? txt(prixLigne) : '',
    modifs: txt(m.querySelector('#editModifs')),
    pistes: Array.from(m.querySelectorAll('.lane-picker .lane-chip.is-on')).map((n) => Number(n.textContent.trim())),
    pistesDossier: (r.lanes || []).map(Number),
    chevauchent,
    quand,
    deborde: { sw: m.scrollWidth, cw: m.clientWidth, csw: corps.scrollWidth, ccw: corps.clientWidth, page: document.scrollingElement.scrollWidth, iw: innerWidth },
    modal: { bas: Math.round(R(m).bottom), ih: innerHeight },
    pied: pied ? { bas: Math.round(R(pied).bottom), corpsBas: Math.round(R(corps).bottom), defile: corps.scrollHeight > corps.clientHeight + 4 } : null,
    petits: textes.filter((x) => x.px < 12),
  };
}

// ---------------------------------------------------------------------------
// LES REGLES, par dossier, a l ouverture.
// ---------------------------------------------------------------------------
function juger(f, label, appareil) {
  const ordi = !['telephone', 'tablette-portrait'].includes(appareil);
  // [M1]
  ok(f.principal.join() === 'fm-quand,fm-programme,fm-extras' && f.cote.join() === 'fm-prix,fm-client,fm-autres' && f.autresReplie,
    `[M1] ${label} : en haut le jour, l arrivee, les joueurs, puis le programme et ses extras ; a cote le prix, le client, « Annuler ou supprimer » replie`, { principal: f.principal, cote: f.cote, replie: f.autresReplie });
  if (f.cotes) {
    ok(ordi ? f.cotes.cg >= f.cotes.pd - 1 : f.cotes.ch >= f.cotes.pb - 1,
      `[M1] ${label} : ${ordi ? 'deux colonnes, comme la fiche' : 'une colonne, le prix et le client sous le programme'}`, f.cotes);
  }
  // [M2]
  ok(f.activites.length > 0 && f.activites.every((a) => a.heure === a.attendue),
    `[M2] ${label} : chaque activite porte l heure du programme`, f.activites.map((a) => `${a.id} ${a.heure}/${a.attendue}`));
  // [M3]
  ok(f.statut === 0, `[M3] ${label} : pas de second interrupteur de statut`, f.statut);
  const redites = ['Réglez les joueurs', 'calculé automatiquement', 'Tarif catalogue', 'Le montant actuel est conservé', 'Organisation de la visite', 'Coordonnées du client', '€/personne'].filter((p) => f.corps.includes(p));
  ok(redites.length === 0, `[M3] ${label} : aucune phrase d aide ni ligne redite`, redites);
  ok(f.activites.every((a) => a.explication === (Number(a.joueurs) !== f.pax)), `[M3] ${label} : « N joueurs sur M » seulement quand l activite n a pas tout le groupe`, f.activites.map((a) => `${a.id} ${a.joueurs}/${f.pax} ${a.explication}`));
  ok(!f.prixLigne.replace(/\s/g, '').includes(f.prix.replace(/\s/g, '')), `[M3] ${label} : la ligne sous le prix ne redit pas le montant (${f.prix})`, f.prixLigne);
  // [M4]
  ok(f.modifs === 'Aucune modification', `[M4] ${label} : « Aucune modification » a l ouverture`, f.modifs);
  // [M7]
  ok(JSON.stringify(f.pistes) === JSON.stringify(f.pistesDossier.filter(() => f.pistes.length)), `[M7] ${label} : ouvrir l onglet garde les pistes du dossier`, { cochees: f.pistes, dossier: f.pistesDossier });
  // [L1]
  ok(f.deborde.sw <= f.deborde.cw + 1 && f.deborde.csw <= f.deborde.ccw + 1 && f.deborde.page <= f.deborde.iw && f.modal.bas <= f.modal.ih,
    `[L1] ${label} : la fiche tient dans l ecran, sans defilement de cote`, { ...f.deborde, ...f.modal });
  ok(!f.chevauchent, `[L1] ${label} : aucun champ du haut n en chevauche un autre`, f.quand);
  ok(f.petits.length === 0, `[L1] ${label} : aucun texte sous 12 px`, f.petits.slice(0, 4));
  if (f.pied && f.pied.defile) ok(f.pied.bas <= f.pied.corpsBas + 1 && f.pied.bas <= f.modal.ih, `[L1] ${label} : la barre du bas reste visible en haut de la fiche`, f.pied);
}

// ---------------------------------------------------------------------------
// LES GESTES, sur le Club de foot : son laser n a que 6 des 10 joueurs.
// ---------------------------------------------------------------------------
async function gestes(page, label) {
  const avant = await page.evaluate(() => {
    const r = state.reservations.find((x) => x.name.includes('Club de foot'));
    r.program.items = r.program.items.map((i) => (i.activityId === 'laser_game' ? { ...i, participants: 6 } : i));
    closePos(); openPos(r.id); setTab('modifier');
    const joueurs = () => Object.fromEntries(Array.from(document.querySelectorAll('[data-edit-activity]')).map((row) => [row.dataset.editActivity, Number(row.querySelector('.staff-stepper-value').textContent)]));
    return { joueurs: joueurs(), prix: document.getElementById('editPriceInput').value, modifs: document.getElementById('editModifs').textContent.replace(/\s+/g, ' ').trim() };
  });
  await page.click('#posOverlay button[aria-label="Un joueur de plus"]');
  await page.waitForTimeout(150);
  const plus = await page.evaluate(() => {
    const replan = document.querySelector('.fm-replan');
    const barree = document.querySelector('.fm-programme .fm-heure:not(.is-vide)');
    return {
      joueurs: Object.fromEntries(Array.from(document.querySelectorAll('[data-edit-activity]')).map((row) => [row.dataset.editActivity, Number(row.querySelector('.staff-stepper-value').textContent)])),
      prix: document.getElementById('editPriceInput').value,
      estime: getEditPrixEstime() ? getEditPrixEstime().total : null,
      ligne: document.getElementById('editPrixEstime').textContent,
      modifs: document.getElementById('editModifs').textContent.replace(/\s+/g, ' ').trim(),
      replanVu: Boolean(replan) && replan.checkVisibility(),
      barree: barree ? getComputedStyle(barree).textDecorationLine : '',
    };
  });
  // [M6]
  ok(plus.joueurs.bowling === 11 && plus.joueurs.arcade_time === 11 && plus.joueurs.laser_game === 6,
    `[M6] ${label} : le bowling et les arcades suivent le groupe (11), le laser garde ses 6 joueurs`, plus.joueurs);
  ok(Number(plus.prix) === Number(plus.estime) && Number(plus.prix) !== Number(avant.prix) && /^Nouveau tarif, avant /.test(plus.ligne),
    `[M6] ${label} : le prix suit (${avant.prix} → ${plus.prix}) et dit le montant d avant`, { avant: avant.prix, apres: plus.prix, estime: plus.estime, ligne: plus.ligne });
  // [M5]
  ok(plus.replanVu && plus.barree.includes('line-through'), `[M5] ${label} : les heures d avant barrees, « recalculées à l’enregistrement » dit`, { replan: plus.replanVu, barree: plus.barree });
  await page.click('.lane-picker .lane-chip[onclick="toggleEditLane(8)"]');
  await page.fill('#editPhoneInput', '0471 23 45 67');
  await page.waitForTimeout(150);
  const apres = await page.evaluate(() => ({ modifs: document.getElementById('editModifs').textContent.replace(/\s+/g, ' ').trim(), prix: document.getElementById('editPriceInput').value }));
  // [M4]
  const prixAvant = avant.prix;
  ok(/Joueurs 10 → 11/.test(apres.modifs) && /Pistes 5, 6 → 5, 6, 8/.test(apres.modifs) && new RegExp(`Prix ${prixAvant}\\s*€ → ${String(apres.prix).replace('.', ',')}\\s*€`).test(apres.modifs) && /Téléphone ajouté/.test(apres.modifs) && /^À enregistrer/.test(apres.modifs),
    `[M4] ${label} : la barre dit ce qui partira`, apres.modifs);
  await page.click('#posOverlay .es-save');
  await page.waitForTimeout(700);
  const envoi = await page.evaluate(() => (window.__FIXTURE__.patchs || []).slice(-1)[0] || null);
  const libelle = await page.evaluate(() => state.reservations.find((x) => x.name.includes('Club de foot')).label);
  const par = envoi && envoi.program ? Object.fromEntries(envoi.program.items.map((i) => [i.activityId, Number(i.participants)])) : {};
  // [M8]
  ok(envoi && Number(envoi.pax) === 11 && JSON.stringify(envoi.lanes) === '[5,6,8]' && envoi.phone === '0471 23 45 67' && Number(envoi.price) === Number(apres.prix) && par.bowling === 11 && par.laser_game === 6 && par.arcade_time === 11,
    `[M8] ${label} : l enregistrement envoie ce qui est affiche`, envoi ? { pax: envoi.pax, lanes: envoi.lanes, phone: envoi.phone, price: envoi.price, par } : 'aucun envoi');
  ok(envoi && envoi.label === libelle && !/adaptée/.test(envoi.label || ''), `[M8] ${label} : un groupe qui grandit ne rend pas le dossier « adapté »`, envoi ? envoi.label : 'aucun envoi');
}

// UNE FORMULE QUI GRANDIT : FORMULE 4, 39 EUR par joueur, 10 puis 11 joueurs.
async function formuleQuiGrandit(page, label) {
  const avant = await page.evaluate(() => {
    const r = state.reservations.find((x) => x.name.includes('Anniversaire Noah'));
    closePos(); openPos(r.id); setTab('modifier');
    return { label: r.label, prixParJoueur: Number(resolveDisplayFormule(r.formuleId).price) };
  });
  await page.click('#posOverlay button[aria-label="Un joueur de plus"]');
  await page.waitForTimeout(150);
  const ecran = await page.evaluate(() => document.getElementById('editPriceInput').value);
  await page.click('#posOverlay .es-save');
  await page.waitForTimeout(700);
  const envoi = await page.evaluate(() => (window.__FIXTURE__.patchs || []).slice(-1)[0] || null);
  const attendu = avant.prixParJoueur * 11;
  // [P1]
  ok(Number(ecran) === attendu && envoi && Number(envoi.price) === attendu && Number(envoi.pax) === 11,
    `[P1] ${label} : FORMULE 4 a 11 joueurs = ${avant.prixParJoueur} € × 11 = ${attendu} € (ecran ${ecran}, envoye ${envoi ? envoi.price : 'rien'})`, envoi);
  ok(envoi && !envoi.program && envoi.label === avant.label, `[P1] ${label} : la formule reste la formule (pas de programme adapte, libelle « ${avant.label} »)`, envoi ? { program: envoi.program, label: envoi.label } : 'aucun envoi');
}

// NOURRITURE ET EXTRAS, OCCASION.
const EXTRAS_VENDUS = [{ id: 'u1', name: 'Cruche Bière', price: 18 }, { id: 'u1', name: 'Cruche Bière', price: 18 }, { id: 'u4', name: 'Tapas', price: 15 }];
async function extrasEtOccasion(page, ou) {
  const label = `Collègues de bureau ${ou}`;
  const vite = { timeout: 5000 };
  const ouvrir = (nom, extras = null, prix = null) => page.evaluate(({ nom, extras, prix }) => {
    const r = state.reservations.find((x) => x.name.includes(nom));
    if (extras) { r.extras = JSON.parse(JSON.stringify(extras)); r.price = prix; }
    closePos(); openPos(r.id); setTab('modifier');
    return { basePrice: r.basePrice, price: r.price, pax: r.pax };
  }, { nom, extras, prix });
  const lire = () => page.evaluate(() => {
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    const sec = document.querySelector('#posOverlay .fm-extras');
    return {
      lignes: sec ? Array.from(sec.querySelectorAll('.fm-x-groupe')).map((g) => `${txt(g.querySelector('.fm-x-titre'))}: ${Array.from(g.querySelectorAll('.fm-x-ligne')).map((l) => `${l.querySelector('.fm-x-choix').value} ${l.querySelector('.fm-x-qte').value} × ${l.querySelector('.fm-x-prix').value} = ${txt(l.querySelector('.fm-x-somme'))}`).join(' ; ')}`).join(' | ') : '',
      total: sec ? txt(sec.querySelector('#fmExtrasTotal')) : '',
      prix: document.getElementById('editPriceInput').value,
      ligne: txt(document.getElementById('editPrixEstime')),
      modifs: txt(document.getElementById('editModifs')),
    };
  });
  const envoi = () => page.evaluate(() => (window.__FIXTURE__.patchs || []).slice(-1)[0] || null);
  const enregistrer = async () => { await page.click('#posOverlay .es-save', vite); await page.waitForTimeout(700); return envoi(); };
  const fermer = () => page.evaluate(() => { try { closePos(); } catch (e) { /* deja fermee */ } });

  await ouvrir('Collègues de bureau', EXTRAS_VENDUS, 289);
  const a = await lire();
  // [E1] [P2]
  ok(a.lignes === 'Nourriture: Tapas 1 × 15 = 15 € | Boissons: Cruche Bière 2 × 18 = 36 €' && a.total === '51 €',
    `[E1] ${label} : les extras vendus se lisent en lignes, par sorte, deux cruches en « × 2 »`, a);
  ok(a.ligne === '' && a.modifs === 'Aucune modification', `[P2] ${label} : 238 € de base et 51 € d extras pour 289 €, ce n est pas un prix « ajusté »`, a);
  await page.click('#posOverlay .fm-extras .fm-ajout:has-text("Nourriture")', vite);
  await page.keyboard.type('Pizza');
  const pizza = '#posOverlay .fm-extras .fm-x-groupe[aria-label="Nourriture"] .fm-x-ligne:last-child';
  await page.fill(`${pizza} .fm-x-qte`, '3', vite);
  await page.fill(`${pizza} .fm-x-prix`, '10', vite);
  await page.waitForTimeout(150);
  const b = await lire();
  // [E2]
  ok(b.prix === '319' && b.total === '81 €' && /^Nouveau total, avant 289 €/.test(b.ligne) && /Ajout : Pizza × 3/.test(b.modifs) && /Prix 289 € → 319 €/.test(b.modifs),
    `[E2] ${label} : trois pizzas a 10 € s ajoutent au total (319 €) et a la barre`, b);
  await page.click('#posOverlay .fm-extras button[aria-label="Retirer Tapas"]', vite);
  await page.waitForTimeout(150);
  const c = await lire();
  ok(c.prix === '304' && /Retrait : Tapas/.test(c.modifs), `[E2] ${label} : les tapas retirees sortent du total (304 €)`, c);
  await page.click('#posOverlay .fm-occasion [data-occasion="anniversaire"]', vite);
  await page.waitForTimeout(100);
  const d = await lire();
  // [O1]
  ok(/Occasion Entreprise → Anniversaire/.test(d.modifs), `[O1] ${label} : l occasion se change en un clic, la barre le dit`, d.modifs);
  const e1 = await enregistrer();
  // [E3]
  ok(e1 && Number(e1.price) === 304 && Number(e1.basePrice) === 238 && JSON.stringify((e1.extras || []).map((x) => [x.name, x.price])) === JSON.stringify([['Pizza × 3', 30], ['Cruche Bière × 2', 36]]),
    `[E3] ${label} : l enregistrement envoie les extras et le total affiches, la base reste 238 €`, e1 ? { price: e1.price, basePrice: e1.basePrice, extras: e1.extras } : 'aucun envoi');
  ok(e1 && e1.occasion === 'anniversaire', `[O1] ${label} : l occasion part avec le dossier`, e1 ? e1.occasion : 'aucun envoi');
  await fermer();

  // [E4] le groupe grandit : les extras restent dans le prix.
  await ouvrir('Collègues de bureau', EXTRAS_VENDUS, 289);
  await page.click('#posOverlay button[aria-label="Un joueur de plus"]', vite);
  await page.waitForTimeout(150);
  const f = await page.evaluate(() => ({ prix: Number(document.getElementById('editPriceInput').value), activites: getEditPrixActivites().total }));
  const e2 = await enregistrer();
  ok(f.prix === f.activites + 51 && e2 && Number(e2.price) === f.prix && JSON.stringify(e2.extras) === JSON.stringify(EXTRAS_VENDUS),
    `[E4] ${label} : 9 joueurs au lieu de 8, les extras restent dans le prix (${f.activites} + 51 = ${f.prix} €)`, { ...f, envoi: e2 ? { price: e2.price, extras: e2.extras } : null });
  await fermer();

  // [E5] un telephone seul, sur une visite a plusieurs activites.
  const cf = await ouvrir('Club de foot');
  await page.fill('#editPhoneInput', '0471 00 00 00', vite);
  const e3 = await enregistrer();
  ok(e3 && e3.phone === '0471 00 00 00' && Number(e3.basePrice) === Number(cf.basePrice) && Number(e3.price) === Number(cf.price),
    `[E5] Club de foot ${ou} : changer un telephone garde la base et le prix du dossier (${cf.basePrice} €)`, e3 ? { basePrice: e3.basePrice, price: e3.price } : 'aucun envoi');
  await fermer();

  // [E4] des arcades vendues a tout le groupe suivent le groupe.
  const ar = await page.evaluate(() => {
    const r = state.reservations.find((x) => x.name.includes('Club de foot'));
    r.extras = [{ id: 'arcades-temps', name: `Arcades 30 min × ${r.pax} joueurs`, price: 5 * r.pax }];
    r.price = Number(r.basePrice) + 5 * r.pax;
    closePos(); openPos(r.id); setTab('modifier');
    return { pax: Number(r.pax) };
  });
  await page.click('#posOverlay button[aria-label="Un joueur de plus"]', vite);
  await page.waitForTimeout(150);
  const e4 = await enregistrer();
  const arcades = e4 && (e4.extras || []).find((x) => x.id === 'arcades-temps');
  ok(arcades && arcades.name === `Arcades 30 min × ${ar.pax + 1} joueurs` && Number(arcades.price) === 5 * (ar.pax + 1),
    `[E4] Club de foot ${ou} : des arcades vendues aux ${ar.pax} joueurs passent a ${ar.pax + 1}`, e4 ? e4.extras : 'aucun envoi');
  await fermer();

  // [O2] les accompagnants d un Kids Fun Day.
  await ouvrir('Collègues de bureau');
  const sansChamp = await page.evaluate(() => !document.querySelector('#posOverlay #editCompanionsInput'));
  await fermer();
  await page.evaluate(() => {
    const r = state.reservations.find((x) => x.name.includes('Anniversaire Noah'));
    r.companions = 2;
    closePos(); openPos(r.id); setTab('modifier');
  });
  await page.click('#posOverlay button[aria-label="Un accompagnant de plus"]', vite);
  await page.waitForTimeout(100);
  const acc = await lire();
  const e5 = await enregistrer();
  ok(sansChamp && /Accompagnants 2 → 3/.test(acc.modifs) && e5 && Number(e5.companions) === 3 && Number(e5.pax) === 10,
    `[O2] Anniversaire Noah ${ou} : 2 accompagnants passent a 3 et partent, les joueurs restent 10 ; un dossier sans accompagnants n en montre pas le champ`, { sansChamp, modifs: acc.modifs, envoi: e5 ? { companions: e5.companions, pax: e5.pax } : null });
  await page.evaluate(() => { state.reservations.find((x) => x.name.includes('Anniversaire Noah')).companions = 0; });
  await fermer();
}

const ici = (s) => `${s.appareil}${s.theme === 'light' ? ' clair' : ''}`;
async function scenario(browser, s) {
  const { ctx, page, erreurs } = await FX.monter(browser, { fixture: 'pic', appareil: s.appareil, theme: s.theme || 'dark', port: PORT });
  try {
    for (const nom of DOSSIERS.filter((x) => !s.dossiers || s.dossiers.includes(x))) {
      const f = await page.evaluate(lireModifier, nom);
      if (f.absent) { ok(false, `[J1] ${ici(s)} : dossier ${f.absent} introuvable dans la fixture`); continue; }
      juger(f, `${nom} ${ici(s)}`, s.appareil);
      await page.evaluate(() => closePos());
    }
    if (s.gestes) {
      await gestes(page, `Club de foot ${ici(s)}`);
      await formuleQuiGrandit(page, `Anniversaire Noah ${ici(s)}`);
      await extrasEtOccasion(page, ici(s));
    }
    ok(erreurs.length === 0, `[J1] ${ici(s)} : aucune erreur JS`, erreurs.slice(0, 3));
  } finally { await ctx.close(); }
}

const SCENARIOS = [
  { appareil: 'ordinateur', gestes: true },
  { appareil: 'grand' },
  { appareil: 'ordinateur', theme: 'light' },
  { appareil: 'tablette' },
  { appareil: 'tablette-portrait' },
  { appareil: 'telephone', gestes: true },
  { appareil: 'telephone', theme: 'light' },
];

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const ORDI = [{ appareil: 'ordinateur', dossiers: ['Club de foot'] }];
const GESTES = [{ appareil: 'ordinateur', dossiers: [], gestes: true }];
const MUTATIONS = [
  { nom: 'une-seule-colonne', lettre: 'M1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .fm-colonnes { grid-template-columns: minmax(0, 1.55fr) minmax(280px, 1fr);', vers: '.fx-modal .fm-colonnes { grid-template-columns: minmax(0, 1fr);' }] },
  { nom: 'client-en-tete', lettre: 'M1', scenarios: ORDI, editions: [{ fichier: JS, de: '        <aside class="fm-cote">\n          ${adapte ? renderEditPrix(r) : \'\'}', vers: '        <aside class="fm-cote">\n          <section class="fm-client"></section>${adapte ? renderEditPrix(r) : \'\'}' }] },
  { nom: 'heures-perdues', lettre: 'M2', scenarios: ORDI, editions: [{ fichier: JS, de: '    const heureHtml = placees.length', vers: '    const heureHtml = false' }] },
  { nom: 'statut-revenu', lettre: 'M3', scenarios: ORDI, editions: [{ fichier: JS, de: '          <section class="fm-programme', vers: '          <div class="es-seg" role="radiogroup"><button type="button" class="es-seg-btn" data-statut="pending">Confirmé</button></div><section class="fm-programme' }] },
  { nom: 'aide-revenue', lettre: 'M3', scenarios: ORDI, editions: [{ fichier: JS, de: '    <p class="fm-replan" role="status">', vers: '    <p class="dossier-edit-help">Réglez les joueurs et les options de chaque activité, puis cliquez sur Enregistrer.</p><p class="fm-replan" role="status">' }] },
  { nom: 'explication-toujours', lettre: 'M3', scenarios: ORDI, editions: [{ fichier: JS, de: "  const explique = explicit === 'ecart' ? Number(courant) !== Number(pax) : Boolean(explicit);", vers: '  const explique = Boolean(explicit);' }] },
  { nom: 'prix-redit', lettre: 'M3', scenarios: ORDI, editions: [{ fichier: JS, de: '  return surPlace;\n}\n\n// LE PRIX DE LA VISITE', vers: '  return phrase(`${formatMoneyCentimes(r.price)} au total.`);\n}\n\n// LE PRIX DE LA VISITE' }] },
  { nom: 'barre-muette', lettre: 'M4', scenarios: GESTES, editions: [{ fichier: JS, de: '    zone.innerHTML = resumeModifsEditionHtml();', vers: "    zone.innerHTML = 'Aucune modification';" }] },
  { nom: 'replan-tu', lettre: 'M5', scenarios: GESTES, editions: [{ fichier: CSS, de: '.fx-modal .fm-programme.is-replan .fm-replan { display: block; }', vers: '.fx-modal .fm-programme.is-replan .fm-replan { }' }] },
  { nom: 'groupe-ne-suit-pas', lettre: 'M6', scenarios: GESTES, editions: [{ fichier: JS, de: '    suivreLeGroupe(value);\n', vers: '' }] },
  { nom: 'pistes-a-l-arrivee', lettre: 'M7', scenarios: ORDI, editions: [{ fichier: JS, de: 'getSuggestedEditLanes(requiredCount, state.selectedRes.date, debutBowlingEdition(state.selectedRes, state.editState), duration', vers: 'getSuggestedEditLanes(requiredCount, state.selectedRes.date, state.editState.startTime, duration' }] },
  { nom: 'groupe-adapte', lettre: 'M8', scenarios: GESTES, editions: [{ fichier: JS, de: '      if (modifsProgrammeEdition().length) updated.label = libelleAdapte;', vers: '      updated.label = libelleAdapte;' }] },
  { nom: 'formule-a-la-carte', lettre: 'P1', scenarios: GESTES, editions: [{ fichier: JS, de: '  const formule = estimerFormuleEdition(r, e);\n  if (formule) return formule;\n', vers: '' }] },
  { nom: 'formule-ecrite-par-le-groupe', lettre: 'P1', scenarios: GESTES, editions: [{ fichier: JS, de: '    if (!(Number(options.participants) > 0) || participantsLigneProgramme(options, reference) !== reference) return;', vers: '    if (participantsLigneProgramme(options, reference) !== reference) return;' }] },
  { nom: 'telephone-oublie', lettre: 'M8', scenarios: GESTES, editions: [{ fichier: JS, de: `oninput="setEditField('phone', this.value)"`, vers: 'oninput="majModifsEdition()"' }] },
  { nom: 'ajuste-sans-extras', lettre: 'P2', scenarios: GESTES, editions: [{ fichier: JS, de: '  const etat = getReservationPriceState(r);\n  if (etat.ajuste)', vers: '  const etat = { ajuste: Number(r.basePrice) > 0 && Math.round(Number(r.basePrice) * 100) !== Math.round((Number(r.price) || 0) * 100), reference: Number(r.basePrice) };\n  if (etat.ajuste)' }] },
  { nom: 'extras-absents', lettre: 'E1', scenarios: GESTES, editions: [{ fichier: JS, de: "          ${adapte ? renderEditExtras(r) : ''}\n", vers: '' }] },
  { nom: 'cruches-separees', lettre: 'E1', scenarios: GESTES, editions: [{ fichier: JS, de: '    if (meme) meme.qte += qte;\n    else modele[groupe].push({ choix, qte, prix });', vers: '    modele[groupe].push({ choix, qte, prix });' }] },
  { nom: 'ajout-muet', lettre: 'E2', scenarios: GESTES, editions: [{ fichier: JS, de: '  modifs.push(...modifsExtrasEdition());\n', vers: '' }] },
  { nom: 'extras-hors-prix', lettre: 'E2', scenarios: GESTES, editions: [{ fichier: JS, de: '  const ecartExtras = editExtrasAChange() ?', vers: '  const ecartExtras = false ?' }] },
  { nom: 'extras-non-envoyes', lettre: 'E3', scenarios: GESTES, editions: [{ fichier: JS, de: '    if (extrasNouveaux) updated.extras = extrasNouveaux;\n', vers: '' }] },
  { nom: 'groupe-sans-extras', lettre: 'E4', scenarios: GESTES, editions: [{ fichier: JS, de: '  const extras = extrasCourantsEdition();\n  if (!extras.length) return estime;', vers: '  const extras = [];\n  if (!extras.length) return estime;' }] },
  { nom: 'arcades-figees', lettre: 'E4', scenarios: GESTES, editions: [{ fichier: JS, de: "  if (field === 'pax') suivreLeGroupeExtras(", vers: '  if (false) suivreLeGroupeExtras(' }] },
  { nom: 'base-reecrite', lettre: 'E5', scenarios: GESTES, editions: [{ fichier: JS, de: '    if (!changementOperationnel) {\n      updated.basePrice = dossier.basePrice;', vers: '    if (false) {\n      updated.basePrice = dossier.basePrice;' }] },
  { nom: 'occasion-oubliee', lettre: 'O1', scenarios: GESTES, editions: [{ fichier: JS, de: "occasion: String(es.occasion || ''), ", vers: '' }] },
  { nom: 'accompagnants-caches', lettre: 'O2', scenarios: GESTES, editions: [{ fichier: JS, de: '${Number(r.companions) > 0 || Number(e.companions) > 0 ? `<div class="fm-champ fm-accompagnants">', vers: '${false ? `<div class="fm-champ fm-accompagnants">' }] },
  { nom: 'accompagnants-oublies', lettre: 'O2', scenarios: GESTES, editions: [{ fichier: JS, de: '  if (accompagnants !== Math.trunc(Number(origine.companions) || 0)) champsSaisis.companions = accompagnants;\n', vers: '' }] },
  { nom: 'champ-qui-deborde', lettre: 'L1', scenarios: [{ appareil: 'telephone', dossiers: ['Club de foot'] }], editions: [{ fichier: CSS, de: '.fx-modal .fm .input { box-sizing: border-box; width: 100%; min-width: 0;', vers: '.fx-modal .fm .input { box-sizing: border-box; width: 100%; min-width: 200px;' }] },
  { nom: 'libelle-11px', lettre: 'L1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .fm .lbl { margin: 0; font-size: 12px;', vers: '.fx-modal .fm .lbl { margin: 0; font-size: 11px;' }] },
  { nom: 'pied-qui-defile', lettre: 'L1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .fm .fm-pied.dossier-actions { position: sticky;', vers: '.fx-modal .fm .fm-pied.dossier-actions { position: static;' }] },
];

async function main() {
  const serveur = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      for (const s of SCENARIOS) await scenario(browser, s);
    } else {
      console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.FM_MUTATIONS || liste(process.env.FM_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.FM_BAVARD;
        try {
          for (const s of m.scenarios) await scenario(browser, s);
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
  if (echecs) { console.error(`\nfiche-modifier-check: FAIL ${echecs}`); process.exitCode = 1; return; }
  console.log(`\nfiche-modifier-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
