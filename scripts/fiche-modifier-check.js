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
// Changer de formule (Movsar, 27/10 : « passer par exemple de FORMULE 4 à
// FORMULE 5, avec le prix et le programme qui suivent »), sur Noah (FORMULE 4,
// 10 joueurs, pistes 1 et 2) et Lina (FORMULE 5, 11 joueurs, sans piste) :
//   [F1] un menu Formule propose toutes les formules du centre, celle du
//        dossier choisie ; une formule hors regles ce jour-la le dit dans le
//        menu et reste choisissable (le comptoir decide) ;
//   [F2] FORMULE 4 -> FORMULE 5 (au clavier, le focus reste sur le menu) : le
//        programme devient celui de la carte (laser, minigolf ; ni bowling ni
//        pistes ni champ Duree), sans les heures de l ancienne, le prix suit
//        (260 EUR) et la barre dit « Formule 4 → Formule 5 · Prix … » ;
//   [F3] l enregistrement envoie la nouvelle formule depuis sa carte : type,
//        formuleId, nom, duree, sans programme ni plan de l ancienne (le
//        serveur la planifie a partir de l arrivee), sans pistes, son prix ;
//   [F4] revenir a la formule du dossier rend ce qu il avait a l ouverture,
//        pistes choisies a la main comprises ;
//   [F5] FORMULE 5 -> FORMULE 4 : le bowling arrive avec ses pistes, libres a
//        son heure, et elles partent ;
//   [F6] une formule hors regles (Kids Fun Day un samedi) le dit sous le menu,
//        « possible au comptoir », se lit par sa carte et part quand meme ;
//   [F7] la variante de l ancienne formule (la Formule 4 aux arcades) ne
//        suit pas la nouvelle.
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
// La contre-preuve en cours (`mutation`) a mordu des que sa lettre rougit : la
// suite de ses scenarios n apporterait plus rien (2026-10-30, la suite
// raccourcie ; chaque scenario ferme sa page dans un finally).
class Mordu extends Error {}
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)}` : ''}`);
  if (!cond && mutation && label.startsWith(`[${mutation.lettre}]`)) throw new Mordu(label);
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
    // Le dossier servi aussi : le rafraichissement periodique le relit, et
    // rendait sinon a la fiche le prix d avant pendant le geste.
    const servi = window.__FIXTURE__.jours[window.__FIXTURE__.jour].find((x) => x.id === r.id);
    if (extras) [r, servi].filter(Boolean).forEach((d) => { d.extras = JSON.parse(JSON.stringify(extras)); d.price = prix; });
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
    const servi = window.__FIXTURE__.jours[window.__FIXTURE__.jour].find((x) => x.id === r.id);
    [r, servi].filter(Boolean).forEach((d) => {
      d.extras = [{ id: 'arcades-temps', name: `Arcades 30 min × ${d.pax} joueurs`, price: 5 * d.pax }];
      d.price = Number(d.basePrice) + 5 * d.pax;
    });
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

// CHANGER DE FORMULE. La Formule 4 jouee aux arcades : la variante que son plan
// garde (lib/formula-choice), telle que le serveur l ecrit.
const VARIANTE_ARCADES = { id: 'arcade60', label: '60 min d’arcades', replaces: ['laser_game'], steps: [{ activityId: 'arcade_time', count: 1, durationMinutes: 60 }], desc: ['1 partie de Minigolf', '1h de Bowling', '60 min d’arcades', '2 cruches boissons'], formulaId: 'f4' };
async function changementDeFormule(page, ou) {
  const vite = { timeout: 5000 };
  const menu = '#posOverlay #editFormuleSelect';
  const ouvrir = (nom, prep = {}) => page.evaluate(({ nom, prep }) => {
    const r = state.reservations.find((x) => x.name.includes(nom));
    const servi = window.__FIXTURE__.jours[window.__FIXTURE__.jour].find((x) => x.id === r.id);
    [r, servi].filter(Boolean).forEach((dossier) => {
      if (prep.lanes) dossier.lanes = prep.lanes;
      if (prep.variante) dossier.opsPlan = { ...(dossier.opsPlan || {}), formulaChoice: prep.variante };
    });
    closePos(); openPos(r.id); setTab('modifier');
    return { pax: Number(r.pax), price: Number(r.price) };
  }, { nom, prep });
  const lire = () => page.evaluate(() => {
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    const m = document.querySelector('#posOverlay .edit-modal');
    const sel = m.querySelector('#editFormuleSelect');
    const replan = m.querySelector('.fm-replan');
    return {
      formule: sel ? sel.value : null,
      options: sel ? Array.from(sel.options).map((o) => ({ id: o.value, t: o.textContent, off: o.disabled })) : [],
      catalogue: getEffectiveCatalogFormules().map((f) => f.id),
      indice: txt(m.querySelector('#editFormuleHint')),
      hors: Boolean(m.querySelector('#editFormuleHint.is-hors')),
      activites: Array.from(m.querySelectorAll('[data-edit-activity]')).map((row) => row.dataset.editActivity).join(','),
      heures: Array.from(m.querySelectorAll('.fm-act-heure .fm-heure')).map((n) => n.textContent.trim()).join(' '),
      carte: Array.from(m.querySelectorAll('.fm-acts .edit-formule-list li')).map(txt),
      selecteurPistes: Boolean(m.querySelector('.lane-picker')),
      pistes: Array.from(m.querySelectorAll('.lane-picker .lane-chip.is-on')).map((n) => Number(n.textContent.trim())),
      dureeEnTete: Boolean(m.querySelector('.fm-quand #editDurationInput')),
      replanVu: Boolean(replan) && replan.checkVisibility(),
      prix: document.getElementById('editPriceInput').value,
      ligne: txt(document.getElementById('editPrixEstime')),
      detail: Array.from(m.querySelectorAll('.dossier-price-detail li')).map(txt),
      modifs: txt(document.getElementById('editModifs')),
      focus: document.activeElement ? document.activeElement.id : '',
    };
  });
  const choisir = async (id) => { await page.selectOption(menu, id, vite); await page.waitForTimeout(200); };
  const enregistrer = async () => {
    await page.evaluate(() => { window.__FIXTURE__.patchs.length = 0; });
    await page.click('#posOverlay .es-save', vite);
    await page.waitForTimeout(700);
    return page.evaluate(() => (window.__FIXTURE__.patchs || []).slice(-1)[0] || null);
  };
  const champs = (p) => (p ? Object.fromEntries(['type', 'formuleId', 'label', 'program', 'opsPlan', 'lanes', 'laneCount', 'requiresLanes', 'duration', 'price', 'basePrice', 'pax'].map((k) => [k, p[k]])) : 'aucun envoi');
  const fermer = () => page.evaluate(() => { try { closePos(); } catch (e) { /* deja fermee */ } });

  // [F1] le menu, a l ouverture.
  await ouvrir('Anniversaire Noah');
  const a = await lire();
  const kfd = a.options.find((o) => o.id === 'kfd');
  ok(a.formule === 'f4' && a.options.length === a.catalogue.length && a.catalogue.every((id) => a.options.some((o) => o.id === id)) && a.indice === 'Changer une activité ne vaut que pour cette visite.',
    `[F1] Anniversaire Noah ${ou} : le menu Formule propose les ${a.catalogue.length} formules du centre, FORMULE 4 choisie`, { formule: a.formule, options: a.options.length, catalogue: a.catalogue.length, indice: a.indice });
  ok(kfd && /Indisponible ce jour/.test(kfd.t) && a.options.every((o) => !o.off),
    `[F1] Anniversaire Noah ${ou} : une formule hors regles ce jour-la le dit dans le menu et reste choisissable (le comptoir decide)`, { kfd, desactivees: a.options.filter((o) => o.off).map((o) => o.id) });

  // [F2] FORMULE 4 -> FORMULE 5 au clavier.
  await page.focus(menu);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  const b = await lire();
  ok(b.formule === 'f5' && b.focus === 'editFormuleSelect', `[F2] Anniversaire Noah ${ou} : la fleche du clavier passe a FORMULE 5 et le menu garde le focus`, { formule: b.formule, focus: b.focus });
  ok(b.activites === 'laser_game,minigolf_blacklight' && !b.selecteurPistes && b.heures === '--:-- --:--' && b.replanVu && !b.dureeEnTete,
    `[F2] Anniversaire Noah ${ou} : le programme devient celui de la carte (laser, minigolf ; ni bowling ni pistes), sans les heures de l ancienne ni champ Duree`, b);
  ok(b.prix === '260' && b.ligne === 'Nouveau tarif, avant 390 €.' && /^FORMULE 5 /.test(b.detail[0] || '') && /Formule 4 → Formule 5/.test(b.modifs) && /Prix 390 € → 260 €/.test(b.modifs) && !/Durée/.test(b.modifs),
    `[F2] Anniversaire Noah ${ou} : le prix suit (26 € × 10 = 260 €), la barre dit « Formule 4 → Formule 5 · Prix 390 € → 260 € »`, { prix: b.prix, ligne: b.ligne, detail: b.detail, modifs: b.modifs });
  // [F3]
  const e1 = await enregistrer();
  ok(e1 && e1.type === 'formule' && e1.formuleId === 'f5' && e1.label === 'FORMULE 5' && e1.program === null && e1.opsPlan === null && JSON.stringify(e1.lanes) === '[]' && e1.requiresLanes === false && Number(e1.duration) === 0.5 && Number(e1.price) === 260 && Number(e1.basePrice) === 260 && Number(e1.pax) === 10,
    `[F3] Anniversaire Noah ${ou} : l enregistrement envoie la FORMULE 5 depuis sa carte (sans programme ni plan de la 4, sans pistes, 260 €)`, champs(e1));
  await fermer();

  // [F4] revenir a la formule du dossier, des pistes choisies a la main (3 pour 2).
  await ouvrir('Anniversaire Noah', { lanes: [1, 2, 3] });
  const c0 = await lire();
  await choisir('f5');
  await choisir('f4');
  const c = await lire();
  ok(c.formule === 'f4' && c.modifs === 'Aucune modification' && JSON.stringify(c.pistes) === '[1,2,3]' && c.heures === c0.heures && c.prix === c0.prix && c.activites === c0.activites,
    `[F4] Anniversaire Noah ${ou} : revenir a FORMULE 4 rend le dossier tel qu a l ouverture (pistes 1, 2, 3, heures, prix)`, { avant: c0, apres: c });
  await page.evaluate(() => {
    const r = state.reservations.find((x) => x.name.includes('Anniversaire Noah'));
    [r, window.__FIXTURE__.jours[window.__FIXTURE__.jour].find((x) => x.id === r.id)].filter(Boolean).forEach((dossier) => { dossier.lanes = [1, 2]; });
  });
  await fermer();

  // [F5] FORMULE 5 -> FORMULE 4 : la formule avec bowling recoit ses pistes.
  const lina = await ouvrir('Anniversaire Lina');
  await choisir('f4');
  const d = await lire();
  const e2 = await enregistrer();
  ok(d.selecteurPistes && d.pistes.length === 2 && d.activites === 'bowling,laser_game,minigolf_blacklight' && d.prix === String(39 * lina.pax) && /Formule 5 → Formule 4/.test(d.modifs),
    `[F5] Anniversaire Lina ${ou} : FORMULE 5 → FORMULE 4, le bowling arrive avec ses 2 pistes et le prix suit (39 € × ${lina.pax})`, d);
  ok(e2 && e2.formuleId === 'f4' && e2.requiresLanes === true && JSON.stringify(e2.lanes) === JSON.stringify(d.pistes) && Number(e2.laneCount) === 2 && Number(e2.duration) === 1 && Number(e2.price) === 39 * lina.pax,
    `[F5] Anniversaire Lina ${ou} : l enregistrement envoie la FORMULE 4, ses pistes et son prix`, champs(e2));
  await fermer();

  // [F6] hors regles : Kids Fun Day un samedi.
  await ouvrir('Anniversaire Noah');
  await choisir('kfd');
  const g = await lire();
  const e3 = await enregistrer();
  ok(g.hors && g.indice === 'Indisponible ce jour · possible au comptoir.' && g.carte.includes('Toutes les activités illimitées') && g.prix === '300',
    `[F6] Anniversaire Noah ${ou} : Kids Fun Day un samedi le dit sous le menu (« possible au comptoir ») et se lit par sa carte`, g);
  ok(e3 && e3.formuleId === 'kfd' && Number(e3.price) === 300, `[F6] Anniversaire Noah ${ou} : elle part quand meme, le comptoir decide`, champs(e3));
  await fermer();

  // [F7] la variante de l ancienne formule ne suit pas.
  await ouvrir('Anniversaire Noah', { variante: VARIANTE_ARCADES });
  const h0 = await lire();
  await choisir('f5');
  const h = await lire();
  ok(!/laser_game/.test(h0.activites) && h.activites === 'laser_game,minigolf_blacklight' && /^FORMULE 5 /.test(h.detail[0] || '') && !/arcades/.test(h.detail[0] || ''),
    `[F7] Anniversaire Noah ${ou} : la FORMULE 4 jouee aux arcades passe en FORMULE 5 avec ses parties de laser, sans les arcades de l ancienne`, { avant: h0.activites, apres: h.activites, detail: h.detail });
  await page.evaluate(() => {
    const r = state.reservations.find((x) => x.name.includes('Anniversaire Noah'));
    [r, window.__FIXTURE__.jours[window.__FIXTURE__.jour].find((x) => x.id === r.id)].filter(Boolean).forEach((dossier) => { if (dossier.opsPlan) delete dossier.opsPlan.formulaChoice; });
  });
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
    if (s.gestes || s.formules) await changementDeFormule(page, ici(s));
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
const FORMULES = [{ appareil: 'ordinateur', dossiers: [], formules: true }];
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
  { nom: 'pistes-a-l-arrivee', lettre: 'M7', scenarios: ORDI, editions: [{ fichier: JS, de: 'getSuggestedEditLanes(requiredCount, state.selectedRes.date, debutBowlingEdition(dossier, state.editState), duration', vers: 'getSuggestedEditLanes(requiredCount, state.selectedRes.date, state.editState.startTime, duration' }] },
  { nom: 'groupe-adapte', lettre: 'M8', scenarios: GESTES, editions: [{ fichier: JS, de: '  const programmeAdapte = Boolean(programme) && modifsProgrammeEdition().length > 0;', vers: '  const programmeAdapte = Boolean(programme);' }] },
  { nom: 'formule-a-la-carte', lettre: 'P1', scenarios: GESTES, editions: [{ fichier: JS, de: '  const formule = estimerFormuleEdition(dossierPourFormule(r), e);\n  if (formule) return formule;\n', vers: '' }] },
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
  { nom: 'hors-regles-tue', lettre: 'F1', scenarios: FORMULES, editions: [{ fichier: JS, de: "${dispo.ok ? '' : ` · ${dispo.message}`}`;", vers: '`;' }] },
  { nom: 'hors-regles-interdite', lettre: 'F1', scenarios: FORMULES, editions: [{ fichier: JS, de: "${String(f.id) === String(e.formuleId) ? ' selected' : ''}>", vers: "${String(f.id) === String(e.formuleId) ? ' selected' : ''}${dispo.ok ? '' : ' disabled'}>" }] },
  { nom: 'focus-perdu', lettre: 'F2', scenarios: FORMULES, editions: [{ fichier: JS, de: ' data-pl-focus="fiche.edit.formule"', vers: '' }] },
  { nom: 'programme-de-l-ancienne', lettre: 'F2', scenarios: FORMULES, editions: [{ fichier: JS, de: '  delete e.programmeEdite;\n  delete e.programmeEditeInitial;\n  ensureEditProgram(dossierPourFormule(r));\n', vers: '' }] },
  { nom: 'prix-de-l-ancienne', lettre: 'F2', scenarios: FORMULES, editions: [{ fichier: JS, de: '  const formule = estimerFormuleEdition(dossierPourFormule(r), e);', vers: '  const formule = estimerFormuleEdition(r, e);' }] },
  { nom: 'barre-sans-formule', lettre: 'F2', scenarios: FORMULES, editions: [{ fichier: JS, de: '  if (formuleChangee) modifs.push(`${nomFormule(origine.formuleId)} → ${nomFormule(e.formuleId)}`);\n', vers: '' }] },
  { nom: 'duree-en-tete', lettre: 'F2', scenarios: FORMULES, editions: [{ fichier: JS, de: " && String(rf.type || '') !== 'formule') ? durationControl", vers: ') ? durationControl' }] },
  { nom: 'formule-non-envoyee', lettre: 'F3', scenarios: FORMULES, editions: [{ fichier: JS, de: '      updated.formuleId = nouvelleFormule.id;\n', vers: '' }] },
  { nom: 'plan-de-l-ancienne', lettre: 'F3', scenarios: FORMULES, editions: [{ fichier: JS, de: '      updated.opsPlan = null;\n', vers: '' }] },
  { nom: 'retour-sans-pistes', lettre: 'F4', scenarios: FORMULES, editions: [{ fichier: JS, de: "  if (retour) e.lanesStr = (origine.lanes || []).join(', ');\n  else syncEditLaneAssignment();", vers: '  syncEditLaneAssignment();' }] },
  { nom: 'pistes-de-l-ancienne', lettre: 'F5', scenarios: FORMULES, editions: [{ fichier: JS, de: '  const dossier = dossierPourFormule(state.selectedRes);\n  const requiresLanes = reservationNeedsLanes(dossier.type, dossier.formuleId);', vers: '  const dossier = state.selectedRes;\n  const requiresLanes = reservationNeedsLanes(dossier.type, dossier.formuleId);' }] },
  { nom: 'hors-regles-muet', lettre: 'F6', scenarios: FORMULES, editions: [{ fichier: JS, de: '    : { texte: `${dispo.message} · possible au comptoir.`, hors: true };', vers: "    : { texte: 'Programme et prix de la nouvelle formule.', hors: false };" }] },
  { nom: 'variante-qui-suit', lettre: 'F7', scenarios: FORMULES, editions: [{ fichier: JS, de: '  const { program: _programme, opsPlan: _plan, ...reste } = r;', vers: '  const { program: _programme, ...reste } = r;' }] },
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
    serveur.close();
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nfiche-modifier-check: FAIL ${echecs}`); process.exitCode = 1; return; }
  console.log(`\nfiche-modifier-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
