// LA PORTE « ACCÈS ILLIMITÉ » TOUJOURS LA, ET L ACCES CREE SUR PLACE (2026-11-21).
//
// Un gerant, en colere : « c'est où pour mettre une activité en illimité, je trouve pas ». Ni Gembloux ni
// Libramont n avaient d acces illimite au catalogue : la porte de Reserver ne se montrait jamais, et rien
// ne disait ou le creer.
//
// Il joue la VRAIE console, le vrai api/ops.js, le vrai handler api/staff-reservations.js et le vrai
// moteur (scripts/comptoir-banc.js, base et catalogue en memoire), le samedi 16 janvier 2027 a 15:10 a
// Libramont, en vrais clics, et lit ce qui est ECRIT (le catalogue du banc, le dossier en base) :
//   [P] SANS OFFRE, LA PORTE EST LA : « Accès illimité » dans la rangee des portes, avec Formules et Sur
//       mesure, dit qu il se cree ici ; la fenetre tient sans defiler a 1366 x 768.
//   [V] AUCUN PRIX INVENTE : la creation ouverte, le prix est vide ; « Créer l’accès illimité » sans prix
//       tape ne part pas au serveur et le dit ; le catalogue ne bouge pas.
//   [R] UN ROLE ADMIN LE CREE : 32 € par joueur, 3 h, Minigolf retire en tuile. Au catalogue, par le chemin
//       de Tarifs (garderFormuleSurMesure, le corps de cevSaveIllimite) : son prix, sa duree, ses
//       activites, au comptoir seulement. Les tuiles de l acces s ouvrent aussitot ; une heure, « Créer » :
//       le dossier en acces illimite, au prix de l acces.
//   [S] SANS LE DROIT TARIFS : la porte et sa page disent qu un responsable le cree dans Tarifs &
//       formules, bouton « + Accès illimité » ; ni champ ni bouton ; Modifier pareil ; un envoi force est
//       refuse ; rien ne s enregistre.
//   [M] MODIFIER, SANS OFFRE : « À la carte | Accès illimité » ; « Accès illimité » ouvre la meme creation ;
//       creee, le dossier la prend et s enregistre en acces illimite.
//   [O] AVEC UNE OFFRE, RIEN NE CHANGE : la porte dit l acces et son prix et ouvre ses tuiles, sans
//       creation ; Modifier propose l acces du catalogue.
//   [H] AVEC UNE OFFRE, UN JOUR CHARGE (deux horaires retenus en ligne) : a 1366 x 768, la fenetre tient
//       sans defiler, les deux rangees de portes entieres, comme sans offre en [P].
//   [*] Zero erreur JavaScript.
//
// CONTRE-PREUVES : `--contre-preuves` sert le code casse expres, une mutation a la fois (en memoire, le
// disque n est jamais touche), et exige que chacune rougisse sa cible. `--seul=P,V` ne joue que ces
// lettres ; `--ancres` verifie que chaque ancre existe une fois ; `--captures=<dossier>` pose les images
// (jamais sous une contre-preuve). Zero reseau sortant, zero vraie base : rien ne part.
'use strict';
const fs = require('fs');
const path = require('path');
const eclats = require('./gates-eclats.js');
const { trancher } = require('./gates-tranche');
const C = require('./comptoir-banc.js');
const { chromium } = require('playwright-core');

const { B, FX, ROOT, JOUR } = C;
const PORT = Number(process.env.PINLANE_PORTE_ILLIMITE_PORT || 7150);
const CASSE = String(process.env.PORTE_ILLIMITE_CASSE || '');
const lf = (t) => String(t).split('\r\n').join('\n');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };

const APP = 'assets/app-main.js';
const CSS = 'assets/pinlane-staff.css';
// La correction de la hauteur (2026-11-21), d un bloc : l ecart minimum de la colonne, les portes d un doigt.
const HAUTEUR = '@media (min-width: 1101px) { .qb-modal.rv.rs.is-q-activites .rs-col { gap: 4px; } }\n.qb-modal.rv.rs .rs-portes.is-acces { margin-bottom: 0; }\n.qb-modal.rv.rs .rs-portes.is-acces .rs-porte, .qb-modal.rv.rs .rs-portes.is-acces + .rs-portes .rs-porte { min-height: 44px; }';

// LA MUTATION : une garde retiree expres, une a la fois. `lettre` dit quel scenario la juge, `cible` le
// debut du libelle qui doit rougir.
const MUTATIONS = [
  { nom: 'porte-cachee-sans-offre', lettre: 'P', cible: '[P] sans offre, la porte « Accès illimité » est la', fichier: APP, de: "  const aCreer = acces ? '' : rsPorteACreerHtml();", vers: "  const aCreer = '';" },
  { nom: 'prix-sans-saisie', lettre: 'V', cible: '[V] sans prix tape, rien ne part au serveur', fichier: APP, de: "  const prix = brut === '' ? NaN : Number(brut);\n  return Number.isFinite(prix) && prix >= 0 && prix <= 1000", vers: '  const prix = Number(brut);\n  return Number.isFinite(prix) && prix >= 0 && prix <= 1000' },
  { nom: 'sans-droit-cree', lettre: 'S', cible: '[S] sans le droit Tarifs, la porte et sa page disent qui le cree', fichier: APP, de: 'function illPeutCreer() {\n  return rsFmPeutGarder();\n}', vers: 'function illPeutCreer() {\n  return true;\n}' },
  { nom: 'duree-figee', lettre: 'R', cible: '[R] la duree se choisit d un toucher', fichier: APP, de: '  illNouvelRepeindre(ou, () => { n.minutes = minutes; n.autre = depuisAutre === true; });', vers: '  illNouvelRepeindre(ou, () => { n.autre = depuisAutre === true; });' },
  { nom: 'tuile-figee', lettre: 'R', cible: '[R] une activite se retire en tuile', fichier: APP, de: '  illNouvelRepeindre(ou, () => { n.retirees = f.illimite.activites.filter((x) => !suite.activites.includes(x)); });', vers: '  illNouvelRepeindre(ou, () => {});' },
  { nom: 'creation-sans-tuiles', lettre: 'R', cible: '[R] cree, les tuiles de l acces s ouvrent aussitot', fichier: APP, de: "  if (ou === 'ed') passerEnIllimiteEdition(id);\n  else rsOuvrirIllimite(id);", vers: "  if (ou === 'ed') passerEnIllimiteEdition(id);\n  else rvRepeindre();" },
  { nom: 'modifier-sans-entree', lettre: 'M', cible: '[M] Modifier sans offre : « À la carte | Accès illimité »', fichier: APP, de: '  if (!choix.length) { lireLesFormulesGardeesPourModifier(); return renderEditIllimiteACreer(deLOrigine); }', vers: "  if (!choix.length) { lireLesFormulesGardeesPourModifier(); return ''; }" },
  { nom: 'fenetre-qui-defile', lettre: 'H', cible: '[H] avec une offre, un jour charge, la fenetre tient sans defiler', fichier: CSS, de: HAUTEUR, vers: '' },
  { nom: 'ecart-de-12', lettre: 'H', cible: '[H] avec une offre, un jour charge, la fenetre tient sans defiler', fichier: CSS, de: '@media (min-width: 1101px) { .qb-modal.rv.rs.is-q-activites .rs-col { gap: 4px; } }', vers: '' },
  { nom: 'offre-ignoree', lettre: 'O', cible: '[O] avec une offre, la porte dit l acces et son prix', fichier: APP, de: "  const liste = s ? rsIllimitees() : [];\n  if (!liste.length) return '';", vers: "  const liste = s ? rsIllimitees() : [];\n  if (liste.length) return '';" },
];
const LES_MUTATIONS = new Map(MUTATIONS.map((m) => [m.nom, m]));

let echecs = 0;
let reussis = 0;
const mutation = CASSE ? LES_MUTATIONS.get(CASSE) : null;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}`); return true; }
  echecs += 1;
  console.log(`FAIL  ${label}${detail !== undefined ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  if (mutation && label.startsWith(mutation.cible)) throw Object.assign(new Error(`cible rouge : ${label}`), { cibleRouge: true });
  return false;
}
if (CASSE && !mutation) { console.error(`porte-illimite-check : contre-preuve inconnue ${CASSE}`); process.exit(2); }
const compteAncre = (m) => lf(fs.readFileSync(path.join(ROOT, m.fichier), 'utf8')).split(m.de).length - 1;
if (mutation && compteAncre(mutation) !== 1) { console.error(`porte-illimite-check : la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois`); process.exit(2); }
function transformer(rel, texte) {
  if (!mutation || mutation.fichier !== rel) return texte;
  return lf(texte).split(mutation.de).join(mutation.vers);
}

const serveur = C.monterServeur();
const ouvrir = (browser, options = {}) => C.ouvrirConsole(browser, serveur, { port: PORT, reservations: () => [], appareil: 'comptoir', ...options });
const finir = async (m, quoi) => { ok(m.erreurs.length === 0, `[*] zero erreur JavaScript (${quoi})`, m.erreurs.slice(0, 3).join(' | ')); await m.ctx.close(); };

// ---------------------------------------------------------------------------
// Le centre, le catalogue, la base.
// ---------------------------------------------------------------------------
const CENTRE = 'libramont';
const JOUEURS = 10;
const TEL = '0470 12 34 56';
const ID_ACCES = 'sm-libramont--acces-illimite';
const { listCenterActivities } = require(path.join(ROOT, 'lib/activity-catalog.js'));
// Ce que le serveur vend pour ce centre : la seule definition de « toutes les activites ».
const DU_CENTRE = () => listCenterActivities(CENTRE).map((a) => a.id);
const memeEnsemble = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const planDe = (r) => (r && (typeof r.ops_plan === 'string' ? JSON.parse(r.ops_plan) : r.ops_plan)) || {};
const PHRASE_OU = 'Un responsable le crée dans Tarifs & formules, avec le bouton « + Accès illimité » en haut de la page.';
// La journee chargee du banc et deux horaires retenus en ligne, ceux de comptoir-check [E] : la fenetre la
// plus haute qu il mesure.
const RETENUES_CHARGEES = [{ heure: '16:00', pistes: [6, 7], joueurs: 8, resteMinutes: 8, resteSecondes: 12 }, { heure: '16:30', laser: 12, resteMinutes: 4, resteSecondes: 40 }];
const OFFRE = { nom: 'Accès illimité', prixParPersonne: 32, minPax: 1, clients: false, illimite: true, dureeMinutes: 180, aVolonte: { bowling: true, laser_game: true } };

// Le catalogue du centre sans aucune formule gardee : ni Gembloux ni Libramont n ont d acces illimite.
function viderLeCatalogue() {
  C.CATALOGUE_BANC.formules.clear();
  C.CATALOGUE_BANC.etapes = [];
  require(path.join(ROOT, 'lib/catalog-store.js')).applyCatalogState({ formulas: [], steps: [], activities: [], centerClients: [{ id: 'libramont', client_id: 'fungalaxy' }, { id: 'gembloux', client_id: 'fungalaxy' }] });
}
const lesGardees = () => [...C.CATALOGUE_BANC.formules.keys()];
const envoisDeGarde = (journal) => journal.filter((e) => e.m === 'POST' && String(e.url || '').startsWith('/api/ops') && e.corps && e.corps.action === 'garderFormuleSurMesure');
async function garderParLeServeur(corps, role = 'manager') {
  serveur.changerSession(C.roleDe(role));
  return serveur.appeler('POST', '/api/ops', { action: 'garderFormuleSurMesure', centerId: CENTRE, formule: corps });
}

async function attendre(page, cond) {
  for (let i = 0; i < 80; i += 1) { if (cond()) return true; await page.waitForTimeout(100); }
  return cond();
}
async function neufs(page, avant) {
  for (let i = 0; i < 80; i += 1) {
    const l = [...B.base.reservations.entries()].filter(([id]) => !avant.has(id)).map(([, r]) => r);
    if (l.length) return l;
    await page.waitForTimeout(100);
  }
  return [];
}
async function creer(page, nom) {
  await page.locator('#qbPhone').fill(TEL);
  await page.locator('#qbName').fill(nom);
  await page.waitForTimeout(200);
  await C.pret(page);
  await page.locator('#rvCreer').click();
}

// LES IMAGES (--captures=<dossier>) : jamais sous une contre-preuve.
const CAPTURES = typeof argument('captures') === 'string' ? argument('captures') : '';
async function photo(page, nom, selecteur = '') {
  if (!CAPTURES || mutation) return;
  // (la fenetre entre en fondu : la photo attend la fin du mouvement)
  await page.waitForTimeout(900);
  fs.mkdirSync(CAPTURES, { recursive: true });
  const cible = selecteur ? page.locator(selecteur).first() : null;
  if (cible && await cible.count()) await cible.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
  else await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

// La porte telle qu on la lit : son nom, sa ligne, son prix, sa place, ce qu elle dit a l oreille.
const lirePorte = (page) => page.evaluate(() => {
  const b = document.getElementById('rsIllimite');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  const col = document.getElementById('rsCol');
  const rangee = b.closest('.rs-portes');
  const formules = document.querySelector('#rsFormules .rs-porte-l');
  const t = (sel) => ((b.querySelector(sel) || {}).textContent || '').replace(/\s+/g, ' ').trim();
  return {
    nom: t('b'), ligne: t('.rs-porte-l'), prix: t('em span'), total: t('em small'), aCreer: b.classList.contains('is-a-creer'), titre: b.getAttribute('title') || '',
    // (sa rangee, dans l ordre ; la ligne de Formules reste entiere a cote d elle)
    rangee: rangee ? Array.from(rangee.querySelectorAll('.rs-porte')).map((p) => p.id) : [],
    formulesEntier: Boolean(formules && formules.scrollWidth <= formules.clientWidth + 1),
    visible: r.width > 0 && r.top >= 0 && r.bottom <= innerHeight, defile: col ? col.scrollHeight - col.clientHeight : -1,
  };
});

// La creation sur place telle qu on la lit (Reserver : rsIlN, Modifier : edIlN).
const lireCreation = (page, p) => page.evaluate((x) => {
  const z = document.getElementById(x);
  const t = (el) => ((el || {}).textContent || '').replace(/\s+/g, ' ').trim();
  const prix = document.getElementById(`${x}Prix`);
  return {
    la: Boolean(z),
    prix: prix ? prix.value : null,
    indice: prix ? prix.getAttribute('placeholder') || '' : '',
    duree: Array.from(z ? z.querySelectorAll('.rs-ill-nv-seg [aria-checked="true"]') : []).map((d) => t(d)).join(),
    tuiles: Array.from(z ? z.querySelectorAll('.rs-ill-act') : []).map((li) => ({ id: li.dataset.illActivite, pris: (li.querySelector('.rs-ill-t') || {}).getAttribute ? li.querySelector('.rs-ill-t').getAttribute('aria-pressed') : '', tag: t(li.querySelector('.rs-ill-tag')) })),
    reglages: z ? z.querySelectorAll('.rs-ill-seg').length : -1,
    dit: t(document.getElementById(`${x}Dit`)),
    erreur: t(document.getElementById(`${x}Erreur`)),
    bouton: t(document.getElementById(`${x}Creer`)),
    sansDroit: t(document.getElementById(`${x}SansDroit`)),
  };
}, p);

// ---------------------------------------------------------------------------
// [P] SANS OFFRE, LA PORTE EST LA
// ---------------------------------------------------------------------------
async function scenarioP(browser) {
  console.log('\n[P] sans offre, la porte est la');
  viderLeCatalogue();
  // (la journee chargee : la fenetre la plus haute)
  const m = await ouvrir(browser, { role: 'manager', reservations: null, retenues: RETENUES_CHARGEES });
  try {
    const { page } = m;
    await C.ouvrirFenetre(page, 7);
    await page.waitForTimeout(500);
    const etat = await page.evaluate(() => ({ offres: rsIllimitees().length, lues: illOffresLues() }));
    const porte = await lirePorte(page);
    ok(etat.offres === 0 && etat.lues && porte && porte.nom === 'Accès illimité' && porte.ligne === 'à créer ici' && porte.aCreer && !porte.prix && porte.rangee.join() === 'rsFormules,rsIllimite,rsMesure' && porte.visible,
      '[P] sans offre, la porte « Accès illimité » est la, entre Formules et Sur mesure, et dit qu il se cree ici', { etat, porte });
    ok(porte && porte.defile <= 1 && porte.formulesEntier, '[P] la fenetre tient toujours sans defiler a 1366 x 768, la ligne de Formules entiere', porte);
    await photo(page, 'porte-a-creer', '#quickBookOverlay .qb-modal.rv');
  } finally { await finir(m, 'P'); }
}

// ---------------------------------------------------------------------------
// [V] AUCUN PRIX INVENTE
// ---------------------------------------------------------------------------
async function scenarioV(browser) {
  console.log('\n[V] aucun prix invente');
  viderLeCatalogue();
  const m = await ouvrir(browser, { role: 'manager' });
  try {
    const { page, journal } = m;
    await C.ouvrirFenetre(page, JOUEURS);
    await page.locator('#rsIllimite').click();
    await page.waitForSelector('#rsIlN', { timeout: 8000 }).catch(() => {});
    const ouverte = await lireCreation(page, 'rsIlN');
    ok(ouverte.la && ouverte.prix === '' && !/\d/.test(ouverte.indice) && ouverte.duree === '3 h' && ouverte.bouton === 'Créer l’accès illimité', '[V] la creation s ouvre, le prix vide : aucun prix propose', ouverte);
    // « Créer » sans prix, au clic puis a la touche Entree dans le champ vide (s il est encore la : un acces
    // parti au serveur a deja change la page).
    await page.locator('#rsIlNCreer').click();
    await page.waitForTimeout(800);
    if (await page.locator('#rsIlNPrix').count()) {
      await page.locator('#rsIlNPrix').press('Enter');
      await page.waitForTimeout(600);
    }
    const refus = await lireCreation(page, 'rsIlN');
    ok(envoisDeGarde(journal).length === 0 && lesGardees().length === 0 && refus.erreur === 'Tapez le prix par joueur, de 0 à 1000 €.',
      '[V] sans prix tape, rien ne part au serveur, rien ne s enregistre, et la creation le dit', { envois: envoisDeGarde(journal).length, catalogue: lesGardees(), erreur: refus.erreur });
    // Taper le prix efface l erreur, la phrase le dit ; le vider la rend vide.
    await page.locator('#rsIlNPrix').fill('32');
    await page.waitForTimeout(250);
    const tape = await lireCreation(page, 'rsIlN');
    await page.locator('#rsIlNPrix').fill('');
    await page.waitForTimeout(250);
    const vide = await lireCreation(page, 'rsIlN');
    ok(tape.erreur === '' && tape.dit === 'Tout à volonté pendant 3 h, 32 € par joueur' && vide.dit === 'Tout à volonté pendant 3 h', '[V] le prix tape se lit dans la phrase, un prix efface n en laisse aucun', { tape: tape.dit, vide: vide.dit });
  } finally { await finir(m, 'V'); }
}

// ---------------------------------------------------------------------------
// [R] UN ROLE ADMIN LE CREE, PUIS RESERVE
// ---------------------------------------------------------------------------
async function scenarioR(browser) {
  console.log('\n[R] un role admin le cree, puis reserve');
  viderLeCatalogue();
  const m = await ouvrir(browser, { role: 'direction' });
  try {
    const { page, journal } = m;
    await C.ouvrirFenetre(page, JOUEURS);
    await page.locator('#rsIllimite').click();
    await page.waitForSelector('#rsIlN', { timeout: 8000 }).catch(() => {});
    const depart = await lireCreation(page, 'rsIlN');
    ok(depart.la && memeEnsemble(depart.tuiles.map((t) => t.id), DU_CENTRE()) && depart.tuiles.every((t) => t.pris === 'true') && depart.reglages === 0 && depart.dit === 'Tout à volonté pendant 3 h' && depart.duree === '3 h',
      '[R] les activites du centre sont prises d office, en tuiles, 3 h', depart);
    // La duree : 4 h, puis 3 h.
    await page.locator('#rsIlND-240').click();
    await page.waitForTimeout(250);
    const quatre = await lireCreation(page, 'rsIlN');
    await page.locator('#rsIlND-180').click();
    await page.waitForTimeout(250);
    const trois = await lireCreation(page, 'rsIlN');
    ok(quatre.duree === '4 h' && quatre.dit === 'Tout à volonté pendant 4 h' && trois.duree === '3 h' && trois.dit === 'Tout à volonté pendant 3 h', '[R] la duree se choisit d un toucher, la phrase la suit', { quatre: [quatre.duree, quatre.dit], trois: [trois.duree, trois.dit] });
    // Minigolf se retire en tuile, puis le prix.
    await page.locator('[id="rsIlNT-minigolf_blacklight"]').click();
    await page.waitForTimeout(250);
    await page.locator('#rsIlNPrix').fill('32');
    await page.waitForTimeout(250);
    const prete = await lireCreation(page, 'rsIlN');
    const restantes = DU_CENTRE().filter((id) => id !== 'minigolf_blacklight');
    const mini = prete.tuiles.find((t) => t.id === 'minigolf_blacklight') || {};
    ok(mini.pris === 'false' && mini.tag === 'hors accès' && prete.dit === `${restantes.length} activités à volonté pendant 3 h, 32 € par joueur`, '[R] une activite se retire en tuile, et la phrase le dit', { minigolf: mini, dit: prete.dit });
    await photo(page, 'creation-sur-place', '#quickBookOverlay .qb-modal.rv');
    await page.locator('#rsIlNCreer').click();
    await attendre(page, () => C.CATALOGUE_BANC.formules.has(ID_ACCES));
    await page.waitForSelector('#rsAcces .rs-ill-act', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(300);
    // Le chemin de Tarifs : la meme action, le meme corps que cevSaveIllimite.
    const envois = envoisDeGarde(journal);
    const corps = envois.length === 1 ? envois[0].corps : null;
    const f = corps ? corps.formule : {};
    ok(corps && corps.centerId === CENTRE && JSON.stringify(Object.keys(f).sort()) === JSON.stringify(['aVolonte', 'activites', 'clients', 'dureeMinutes', 'illimite', 'minPax', 'nom', 'prixParPersonne'])
      && f.nom === 'Accès illimité' && f.prixParPersonne === 32 && f.minPax === 1 && f.clients === false && f.illimite === true && f.dureeMinutes === 180 && memeEnsemble(f.activites, restantes) && f.aVolonte.bowling === true && f.aVolonte.laser_game === true,
    '[R] une seule ecriture, par le chemin de Tarifs : garderFormuleSurMesure et le corps de cevSaveIllimite', { envois: envois.length, corps });
    const ligne = C.CATALOGUE_BANC.formules.get(ID_ACCES) || {};
    const etapes = C.CATALOGUE_BANC.etapes.filter((e) => e.formula_id === ID_ACCES).map((e) => e.activity_id);
    const servie = require(path.join(ROOT, 'lib/booking-config.js')).getEffectiveFormules(CENTRE, { comptoir: true }).find((x) => x.id === ID_ACCES) || {};
    ok(Number(ligne.price_value) === 32 && ligne.price_type === 'per_pax' && ligne.order_policy === 'illimite:bowling,laser_game' && ligne.human_validation === 'comptoir' && memeEnsemble(etapes, restantes) && servie.illimite && servie.illimite.minutes === 180,
      '[R] au catalogue du centre : 32 € par joueur, 3 h, sans Minigolf, au comptoir seulement', { prix: ligne.price_value, politique: ligne.order_policy, validation: ligne.human_validation, etapes, minutes: servie.illimite && servie.illimite.minutes });
    const apres = await page.evaluate(() => ({
      formule: (rvFormuleIllimitee() || {}).id || '',
      tuiles: Array.from(document.querySelectorAll('#rsAcces .rs-ill-act')).map((li) => li.dataset.illActivite),
      creation: Boolean(document.getElementById('rsIlN')),
      prix: ((document.querySelector('#rsAcces .rs-acces-prix b') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    }));
    ok(apres.formule === ID_ACCES && memeEnsemble(apres.tuiles, restantes) && !apres.creation && apres.prix === '32 € par joueur', '[R] cree, les tuiles de l acces s ouvrent aussitot, pret a reserver', apres);
    // Une heure, « Créer » : le dossier.
    await page.waitForSelector('.rs-s-l.is-formule .rs-h[data-heure="15:30"]', { timeout: 10000 }).catch(() => {});
    await page.locator('.rs-s-l.is-formule .rs-h[data-heure="15:30"]').click();
    await C.pret(page);
    await page.waitForTimeout(400);
    const debut = new Set([...B.base.reservations.keys()]);
    await creer(page, 'Team building sur place');
    const [r] = await neufs(page, debut);
    const plan = planDe(r);
    ok(r && r.formule_id === ID_ACCES && r.type === 'formule' && Number(r.price) === 32 * JOUEURS && plan.illimite && memeEnsemble(plan.illimite.activites || [], restantes),
      '[R] « Créer » : le dossier en acces illimite, au prix de l acces par joueur', r && { formule: r.formule_id, type: r.type, prix: r.price, choix: plan.illimite });
  } finally { await finir(m, 'R'); }
}

// ---------------------------------------------------------------------------
// [S] SANS LE DROIT TARIFS
// ---------------------------------------------------------------------------
// Le dossier de Modifier : une visite bowling creee au comptoir, poussee dans la page.
async function unDossier(page, nom) {
  const cree = await serveur.appeler('POST', '/api/staff-reservations', { centerId: CENTRE, date: JOUR, startTime: '16:00', duration: 1, totalDuration: 1, lanes: [], pax: JOUEURS, status: 'confirmed', type: 'visite', name: nom, phone: TEL, program: [{ activityId: 'bowling', pax: JOUEURS, participants: JOUEURS, duration: 1 }], preference: { activityOrder: ['bowling'], preferredTimes: { bowling: '16:00' } } });
  const id = Number(cree.json.reservation && cree.json.reservation.id);
  if (!id) return { id: 0, statut: cree.statut, message: cree.json.message };
  await page.evaluate((r) => { window.__FIXTURE__.jours[window.__FIXTURE__.jour].push(r); upsertReservationInState(r); renderStaff(); }, cree.json.reservation);
  await page.evaluate(() => { serveurSaitModifierABlanc = true; }); // eslint-disable-line no-undef
  await page.evaluate((i) => { closePos(); openPos(i); setTab('modifier'); }, id);
  await page.waitForSelector('#editAcces', { timeout: 8000 }).catch(() => {});
  return { id };
}
const lireChoix = (page) => page.evaluate(() => {
  const z = document.getElementById('editAcces');
  return {
    segments: Array.from(z ? z.querySelectorAll('.fm-choix-seg button') : []).map((b) => `${b.textContent.trim()}=${b.getAttribute('aria-checked')}`),
    dit: (((z && z.querySelector('.fm-choix-dit')) || {}).textContent || '').replace(/\s+/g, ' ').trim(),
  };
});

async function scenarioS(browser) {
  console.log('\n[S] sans le droit Tarifs');
  viderLeCatalogue();
  const m = await ouvrir(browser, { role: 'sans-tarifs' });
  try {
    const { page, journal } = m;
    await C.ouvrirFenetre(page, JOUEURS);
    await page.waitForTimeout(300);
    const porte = await lirePorte(page);
    await page.locator('#rsIllimite').click();
    await page.waitForSelector('#rsIlNSansDroit', { timeout: 8000 }).catch(() => {});
    const page1 = await lireCreation(page, 'rsIlN');
    ok(porte && porte.nom === 'Accès illimité' && porte.ligne === 'par un responsable' && porte.titre === `Accès illimité. ${PHRASE_OU}` && porte.rangee.join() === 'rsFormules,rsIllimite,rsMesure' && porte.formulesEntier
      && page1.sansDroit === PHRASE_OU && !page1.la && page1.prix === null && !page1.bouton,
    '[S] sans le droit Tarifs, la porte et sa page disent qui le cree, et ou : ni champ ni bouton', { porte, page: page1 });
    await photo(page, 'sans-droit', '#quickBookOverlay .qb-modal.rv');
    // Le geste force depuis la page : rien ne part.
    await page.evaluate(() => { const n = illNouvel('rs'); n.prix = '32'; return illNouvelCreer('rs'); });
    await page.waitForTimeout(500);
    await page.evaluate(() => closeQuickBook());
    await page.waitForTimeout(300);
    // Modifier : « Accès illimité » ouvre la meme phrase.
    const { id } = await unDossier(page, 'Groupe sans droit');
    const avant = await lireChoix(page);
    if (await page.locator('#editAccesCreer').count()) await page.locator('#editAccesCreer').click();
    await page.waitForTimeout(300);
    const ouvert = await lireCreation(page, 'edIlN');
    const apres = await lireChoix(page);
    ok(id && avant.segments.join() === 'À la carte=true,Accès illimité=false' && apres.segments.join() === 'À la carte=false,Accès illimité=true' && ouvert.sansDroit === PHRASE_OU && !ouvert.la && ouvert.prix === null,
      '[S] dans Modifier aussi : « Accès illimité » dit qui le cree, sans champ ni bouton', { id, avant, apres, ouvert });
    // Le serveur refuse un envoi force (le droit Tarifs), et rien ne s est enregistre.
    const force = await garderParLeServeur({ nom: 'Accès illimité', prixParPersonne: 32, minPax: 1, clients: false, illimite: true, dureeMinutes: 180 }, 'sans-tarifs');
    ok(force.statut === 403 && envoisDeGarde(journal).length === 0 && lesGardees().length === 0, '[S] rien ne s enregistre : aucun envoi de la console, le serveur refuse l envoi force', { statut: force.statut, envois: envoisDeGarde(journal).length, catalogue: lesGardees() });
  } finally { await finir(m, 'S'); }
}

// ---------------------------------------------------------------------------
// [M] MODIFIER, SANS OFFRE
// ---------------------------------------------------------------------------
async function enregistrerEdition(page) {
  await page.locator('#posOverlay .es-save').click();
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(150);
    const bouton = page.locator('.staff-confirm [data-role="confirm-ok"]');
    if (await bouton.count()) await bouton.click();
    const fermee = await page.evaluate(() => !document.querySelector('#posOverlay .edit-modal') || !state.selectedRes);
    if (fermee) break;
  }
  await page.waitForTimeout(300);
}
const verdictPose = async (page) => {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => { const z = document.getElementById('editVerdict'); return !z || (!z.classList.contains('is-calcul') && !(typeof verdictEdition === 'function' && verdictEdition().enCours)); }, null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(200);
};

async function scenarioM(browser) {
  console.log('\n[M] Modifier, sans offre');
  viderLeCatalogue();
  const m = await ouvrir(browser, { role: 'manager' });
  try {
    const { page, journal } = m;
    const { id, statut, message } = await unDossier(page, 'Groupe Modifier');
    ok(Boolean(id), '[M] le dossier de depart (une visite bowling) est cree', { statut, message });
    if (!id) return;
    const avant = await lireChoix(page);
    ok(avant.segments.join() === 'À la carte=true,Accès illimité=false' && avant.dit === 'Ce centre n’a pas encore d’accès illimité.', '[M] Modifier sans offre : « À la carte | Accès illimité », et la phrase dit qu il n y en a pas', avant);
    if (!(await page.locator('#editAccesCreer').count())) return;
    await page.locator('#editAccesCreer').click();
    await page.waitForSelector('#edIlN', { timeout: 8000 }).catch(() => {});
    const ouvert = await lireCreation(page, 'edIlN');
    ok(ouvert.la && ouvert.prix === '' && memeEnsemble(ouvert.tuiles.map((t) => t.id), DU_CENTRE()) && ouvert.duree === '3 h' && (await lireChoix(page)).segments.join() === 'À la carte=false,Accès illimité=true',
      '[M] « Accès illimité » ouvre la meme creation que Reserver, le prix vide', ouvert);
    // Sans prix : rien ne part.
    await page.locator('#edIlNCreer').click();
    await page.waitForTimeout(400);
    const refus = await lireCreation(page, 'edIlN');
    ok(envoisDeGarde(journal).length === 0 && lesGardees().length === 0 && refus.erreur === 'Tapez le prix par joueur, de 0 à 1000 €.', '[M] sans prix tape, rien ne part', { envois: envoisDeGarde(journal).length, erreur: refus.erreur });
    await page.locator('#edIlNPrix').fill('30');
    await page.waitForTimeout(200);
    const tape = await lireCreation(page, 'edIlN');
    ok(tape.dit === 'Tout à volonté pendant 3 h, 30 € par joueur' && tape.erreur === '', '[M] le prix tape se lit dans la phrase', tape);
    await photo(page, 'modifier-creation', '#posOverlay .edit-modal');
    await page.locator('#edIlNCreer').click();
    await attendre(page, () => C.CATALOGUE_BANC.formules.has(ID_ACCES));
    await page.waitForSelector(`#editAcces [data-formule="${ID_ACCES}"][aria-checked="true"]`, { timeout: 10000 }).catch(() => {});
    await verdictPose(page);
    const pris = await page.evaluate(() => ({
      choix: Array.from(document.querySelectorAll('#editAcces .fm-choix-seg button')).map((b) => `${b.textContent.trim()}=${b.getAttribute('aria-checked')}`),
      tuiles: document.querySelectorAll('#editAcces .rs-ill-act').length,
      creation: Boolean(document.getElementById('edIlN')),
      formule: (state.editState && state.editState.formuleId) || '',
    }));
    ok(lesGardees().join() === ID_ACCES && pris.formule === ID_ACCES && pris.choix.join() === 'À la carte=false,Accès illimité=true' && pris.tuiles === DU_CENTRE().length && !pris.creation,
      '[M] cree, le dossier prend l acces : ses tuiles, « Accès illimité » pris', pris);
    await enregistrerEdition(page);
    const r = B.base.reservations.get(id);
    ok(r && r.formule_id === ID_ACCES && r.type === 'formule' && Number(r.price) === 30 * JOUEURS, '[M] enregistre : le dossier en acces illimite, au prix de l acces par joueur', r && { formule: r.formule_id, type: r.type, prix: r.price });
  } finally { await finir(m, 'M'); }
}

// ---------------------------------------------------------------------------
// [O] AVEC UNE OFFRE, RIEN NE CHANGE
// ---------------------------------------------------------------------------
async function scenarioO(browser) {
  console.log('\n[O] avec une offre, rien ne change');
  viderLeCatalogue();
  const garde = await garderParLeServeur({ nom: 'Accès illimité', prixParPersonne: 32, minPax: 1, clients: false, illimite: true, dureeMinutes: 180, aVolonte: { bowling: true, laser_game: true } });
  ok(garde.statut === 200 && C.CATALOGUE_BANC.formules.has(ID_ACCES), '[O] l offre du centre est au catalogue', { statut: garde.statut });
  const m = await ouvrir(browser, { role: 'manager' });
  try {
    const { page, journal } = m;
    await C.ouvrirFenetre(page, JOUEURS);
    await page.waitForFunction((x) => getEffectiveCatalogFormules().some((f) => f.id === x), ID_ACCES, { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => rsPeindreActivites && rsPeindreActivites()).catch(() => {});
    const porte = await lirePorte(page);
    ok(porte && porte.nom === 'Accès illimité' && /^Tout à volonté pendant 3 h/.test(porte.ligne) && porte.prix === '32 € par joueur' && porte.total === `320 € pour ${JOUEURS} joueurs` && !porte.aCreer && porte.rangee.join() === 'rsIllimite' && porte.visible,
      '[O] avec une offre, la porte dit l acces et son prix, comme avant', porte);
    await page.locator('#rsIllimite').click();
    await page.waitForSelector('#rsAcces .rs-ill-act', { timeout: 8000 }).catch(() => {});
    const ouverte = await page.evaluate(() => ({ formule: (rvFormuleIllimitee() || {}).id || '', tuiles: document.querySelectorAll('#rsAcces .rs-ill-act').length, creation: Boolean(document.getElementById('rsIlN') || document.getElementById('rsIlNSansDroit')) }));
    ok(ouverte.formule === ID_ACCES && ouverte.tuiles === DU_CENTRE().length && !ouverte.creation, '[O] la porte ouvre les tuiles de l acces, sans creation', ouverte);
    await page.evaluate(() => closeQuickBook());
    await page.waitForTimeout(300);
    await unDossier(page, 'Groupe avec offre');
    await page.waitForSelector(`#editAcces [data-formule="${ID_ACCES}"]`, { timeout: 8000 }).catch(() => {});
    const choix = await page.evaluate((x) => ({ offre: Boolean(document.querySelector(`#editAcces [data-formule="${x}"]`)), creer: Boolean(document.getElementById('editAccesCreer')) }), ID_ACCES);
    ok(choix.offre && !choix.creer && envoisDeGarde(journal).length === 0 && lesGardees().join() === ID_ACCES, '[O] Modifier propose l acces du catalogue, sans creation ni ecriture', { ...choix, envois: envoisDeGarde(journal).length });
  } finally { await finir(m, 'O'); }
}

// ---------------------------------------------------------------------------
// [H] AVEC UNE OFFRE, UN JOUR CHARGE, LA FENETRE TIENT SANS DEFILER
// ---------------------------------------------------------------------------
// L acces cree avec la porte devient l etat normal du gerant : sa rangee pleine largeur, plus les horaires
// retenus en ligne, faisait defiler la colonne de 63 px a 1366 x 768. Sans offre, la meme mesure est en [P].
async function scenarioH(browser) {
  console.log('\n[H] avec une offre, un jour charge, la fenetre tient sans defiler');
  viderLeCatalogue();
  const garde = await garderParLeServeur(OFFRE);
  const m = await ouvrir(browser, { role: 'manager', reservations: null, retenues: RETENUES_CHARGEES });
  try {
    const { page } = m;
    await C.ouvrirFenetre(page, 7);
    await page.waitForFunction((x) => getEffectiveCatalogFormules().some((f) => f.id === x), ID_ACCES, { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => rsPeindreActivites && rsPeindreActivites()).catch(() => {});
    await page.waitForTimeout(500);
    const porte = await lirePorte(page);
    // (les deux rangees de portes entieres dans la colonne, la derniere comprise)
    const bas = await page.evaluate(() => {
      const col = document.getElementById('rsCol').getBoundingClientRect();
      const dedans = (id) => { const e = document.getElementById(id); if (!e) return false; const r = e.getBoundingClientRect(); return r.top >= col.top - 0.5 && r.bottom <= col.bottom + 0.5; };
      return { acces: dedans('rsIllimite'), formules: dedans('rsFormules'), mesure: dedans('rsMesure') };
    });
    ok(garde.statut === 200 && porte && !porte.aCreer && porte.prix === '32 € par joueur' && porte.rangee.join() === 'rsIllimite' && porte.defile <= 1 && bas.acces && bas.formules && bas.mesure,
      '[H] avec une offre, un jour charge, la fenetre tient sans defiler a 1366 x 768, les portes entieres', { porte, bas });
    await photo(page, 'porte-visible', '#quickBookOverlay .qb-modal.rv');
  } finally { await finir(m, 'H'); }
}

// ---------------------------------------------------------------------------
const SCENARIOS = { P: scenarioP, V: scenarioV, R: scenarioR, S: scenarioS, M: scenarioM, O: scenarioO, H: scenarioH };

function verifierLesAncres() {
  let mortes = 0;
  MUTATIONS.forEach((m) => { const n = compteAncre(m); if (n !== 1) { mortes += 1; console.log(`FAIL  ancre ${m.nom} trouvee ${n} fois : ${m.de.slice(0, 80)}`); } });
  if (new Set(MUTATIONS.map((m) => m.nom)).size !== MUTATIONS.length) { mortes += 1; console.log('FAIL  deux contre-preuves portent le meme nom'); }
  console.log(`porte-illimite-check --ancres : ${MUTATIONS.length - mortes}/${MUTATIONS.length} uniques`);
  return mortes;
}

async function contrePreuves() {
  if (verifierLesAncres()) process.exit(1);
  const voulues = typeof argument('contre-preuves') === 'string' ? argument('contre-preuves').split(',') : null;
  const liste = trancher(voulues ? MUTATIONS.filter((m) => voulues.includes(m.nom)) : MUTATIONS);
  const runs = await eclats.enPool(liste, eclats.nombreDeFils(liste.length), (m, fil) => eclats.lancer(__filename, [`--seul=${m.lettre}`], {
    env: { ...process.env, PORTE_ILLIMITE_CASSE: m.nom, PINLANE_PORTE_ILLIMITE_PORT: String(PORT + 1 + fil) },
    timeout: 300000,
  }));
  let mordent = 0;
  liste.forEach((m, i) => {
    const sortie = `${runs[i].stdout || ''}${runs[i].stderr || ''}`;
    if (runs[i].status === 2) { console.log(`FAIL  contre-preuve ${m.nom} DESARMEE : ${sortie.trim().split('\n').pop()}`); return; }
    const rouges = sortie.split('\n').filter((l) => l.startsWith('FAIL'));
    if (rouges.some((l) => l.includes(m.cible))) { mordent += 1; console.log(`ok    contre-preuve ${m.nom} : « ${m.cible} » rougit`); return; }
    console.log(`FAIL  contre-preuve ${m.nom} : « ${m.cible} » reste vert (${rouges.length} autre(s) rouge(s) : ${rouges[0] ? rouges[0].slice(0, 140) : sortie.trim().split('\n').pop().slice(0, 160)})`);
  });
  console.log(`porte-illimite-check --contre-preuves : ${mordent}/${liste.length} mordent`);
  process.exit(mordent === liste.length ? 0 : 1);
}

async function main() {
  if (argument('ancres')) process.exit(verifierLesAncres() ? 1 : 0);
  if (argument('contre-preuves')) { await contrePreuves(); return; }
  const seul = typeof argument('seul') === 'string' ? argument('seul').split(',') : Object.keys(SCENARIOS);
  const http = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: C.BROWSER_PATH, headless: true });
  try {
    for (const nom of seul) {
      try { await SCENARIOS[nom](browser); } catch (erreur) {
        if (erreur && erreur.cibleRouge) break;
        ok(false, `[${nom}] le scenario va jusqu au bout`, erreur && (erreur.message || String(erreur)).slice(0, 200));
      }
    }
  } finally {
    await browser.close();
    http.close();
  }
  console.log(`\nporte-illimite-check : ${reussis} ok, ${echecs} echec(s)`);
  process.exit(echecs ? 1 : 0);
}

main().catch((erreur) => {
  console.error('porte-illimite-check : interrompu', erreur && (erreur.stack || erreur));
  process.exit(1);
});
