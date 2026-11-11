// LE COMPTOIR RESERVE D UN GESTE, ET LA RECHERCHE VOIT TOUTES LES DATES (2026-11-02).
//
// Movsar, 02/11 : « tout doit être interconnecté pour simplifier à mort tout...
// super clair et simple... pour que ça soit UTILE ». L audit joue sur la vraie
// console, un samedi a 15:10 : un client sans reservation veut une piste pour 6 :
// 5 gestes, 8 s il paie, plus le nom. Réserver s ouvrait a 15:30 en rouge quand le
// tableau disait « Pistes 4 libres », et le groupe cree a 15:00 naissait « +10 min ».
// Un nom absent du jour coutait 15 gestes, Annuler 6.
//
// Ce gate rejoue ces parcours sur la VRAIE console (scripts/planning-v3-fixtures.js),
// le VRAI handler api/staff-reservations.js et le vrai moteur (scripts/reserver-banc.js,
// base en memoire), un samedi charge. Il lit l ecran, pas le modele.
//
//   [R1] RESERVER S OUVRE SUR UNE HEURE QUI TIENT. A 15:10 pour 6 : 15:00, sa piste
//        libre, jamais de rouge. L heure suit le groupe tant que personne ne l a
//        choisie ; a la main, elle ne bouge plus. Le planning a le dernier mot : si
//        le serveur refuse ce que ce poste croyait libre, la fenetre va ou il dit
//        que tout tient, sans passer par le rouge.
//   [R2] LA PORTE DU TABLEAU. reserverAuComptoir({ type, startTime, pax }) : sans
//        heure la plus proche ; une heure qui tient s ouvre dessus ; une heure qui ne
//        tient pas donne la plus proche, et le dit. Le laser garde son depart.
//   [R3] UN CLIENT DEVANT LE COMPTOIR EST ARRIVE. Une heure atteinte ou dans la
//        demi-heure nait « Ils sont 6 », jamais « +10 min » : En retard ne bouge pas.
//        Plus tard, le groupe reste attendu.
//   [R4] CREER ET ENCAISSER D UN COUP. « Payé carte » et « Payé espèces » : un
//        dossier, une fois, paye, avec son moyen, son toast « Annuler ». Un refus du
//        paiement laisse le groupe cree ; un refus de creation ne paie rien ensuite.
//        Pas de bouton utilisable sans le droit, ni pour un autre jour, ni pour un
//        lot : Les seances les eteignent (disabled) au lieu de les retirer.
//   [R5] LE SERVEUR NE CREE NI PAYE NI ARRIVE SANS LE DROIT.
//   [R6] LE MOINS DE CHAMPS POSSIBLE. Rien tape : le dossier part sous « Client », sans
//        contact, et ne devient pas un faux client.
//   [R7] LA RECHERCHE TROUVE CE QUI EST ECRIT SUR LA LIGNE : l heure, la piste, le
//        nombre, une faute legere de nom. Un nom juste ne ramene pas ses voisins.
//   [R8] SANS RESULTAT AUJOURD HUI, LES AUTRES DATES : une ligne par reservation, qui
//        ouvre sa fiche sans quitter le jour ; « Réserver pour Dupont » avec le nom tape.
//        Un nom piege reste du texte.
//   [R9] ANNULER SE VOIT dans Infos, sans defiler, avec sa confirmation ; le contact
//        de Modifier attend dans un pli qui garde son etat.
//   [R10] A L ECRAN : 44 px au doigt, 32 a la souris, rien sous 12 px, contraste 4,5:1
//        en clair et en sombre, un seul bouton plein au pied, rien ne deborde.
//   [*]  Zero erreur JavaScript.
//
// Les gestes (le nombre de clics pour chaque parcours) se comptent et s affichent.
//
// LA FENETRE EST « LES SEANCES » (2026-11-03) : le nombre de joueurs se choisit d abord
// (#rsHaut [data-pax], Créer dit « Combien de joueurs ? » avant), Créer dit « Créer à
// 15:00 » et porte data-pret="1" quand le plan du serveur est la et tient ; un refus se
// dit en rouge sur la ligne du ticket (#rvRefus) et Créer devient « Prendre 16:00 ».
//
// CONTRE-PREUVES : `--contre-preuves` sert le code casse expres, une mutation a la
// fois (les fichiers sont modifies en memoire, le disque n est jamais touche), et
// exige que chacune rougisse sa cible ; `--contre-preuves=nom,nom` en joue quelques-
// unes ; `--ancres` verifie seulement que chaque ancre existe une seule fois. Chaque
// mutation ne rejoue que son bloc, dans un pool de fils (scripts/gates-eclats.js,
// PINLANE_ECLATS). `--seul=R3` ne joue qu une lettre, `--bloc=pli` qu un de ses blocs.
//
// Zero reseau sortant, zero vraie base : rien ne part.
'use strict';
const fs = require('fs');
const path = require('path');
const eclats = require('./gates-eclats.js');

delete process.env.RESEND_API_KEY;
delete process.env.POSTGRES_URL;
process.env.DATABASE_URL = 'postgres://gate:gate@127.0.0.1:1/gate';
process.env.PINLANE_CALENDAR_SYNC = 'off';
const fetchOrigine = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url && url.url ? url.url : url);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u)) throw new Error(`gate : appel sortant refuse vers ${u.slice(0, 80)}`);
  return fetchOrigine(url, init);
};

// La base en memoire et le faux 'pg' s installent au require.
const B = require('./reserver-banc.js');
const FX = require('./planning-v3-fixtures.js');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_COMPTOIR_RESERVER_PORT || 4723);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CASSE = String(process.env.COMPTOIR_CASSE || '');
const CAPTURES = process.env.PINLANE_COMPTOIR_CAPTURES || '';
const lf = (t) => String(t).split('\r\n').join('\n');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };
const joue = (bloc) => { const voulu = argument('bloc'); return typeof voulu !== 'string' || voulu === bloc; };

const APP = 'assets/app-main.js';
const GF = 'assets/pinlane-planning-global.js';
const V2 = 'assets/staff-pages-v2.js';
const FEN = 'lib/reserver-fenetre.js';

// LA MUTATION : le code casse expres, une regle a la fois. `lettre` dit quel scenario
// la juge, `cible` le debut du libelle qui doit rougir.
const MUTATIONS = [
  { nom: 'heure-non-proposee', lettre: 'R1', bloc: 'ouverture', cible: '[R1] et revient pour 6', fichier: APP, de: '  rvPoserHeureProposee(rvHeureLaPlusProche(rvHeuresQuiTiennent(), rvReferenceDeLHeure(s)));', vers: '' },
  { nom: 'heure-la-premiere', lettre: 'R1', bloc: 'calme', cible: '[R1] a 15:25 sur un jour calme, c est 15:30', fichier: APP, de: '    if (e <= ecart + 1e-9) { meilleure = h; ecart = e; }', vers: "    if (!meilleure) { meilleure = h; ecart = e; }" },
  { nom: 'choix-ignore', lettre: 'R1', bloc: 'main', cible: '[R1] une heure choisie a la main ne bouge plus', fichier: APP, de: '    // Une heure choisie a la main ne bouge plus toute seule.\n    s.heureProposee = false;', vers: '' },
  { nom: 'serveur-ignore', lettre: 'R1', bloc: 'serveur', cible: '[R1] le planning a le dernier mot', fichier: APP, de: "  if (rvSuivreLePlanning()) return;\n  rvRepeindre();\n}", vers: '  rvRepeindre();\n}' },
  { nom: 'rouge-montre', lettre: 'R1', bloc: 'serveur', cible: '[R1] sans passer par le rouge', fichier: APP, de: '  if (!plan || plan.disponible || rvHeureEnRecherche()) return null;', vers: '  if (!plan || plan.disponible) return null;' },
  { nom: 'recherche-sans-fin', lettre: 'R1', bloc: 'aucune', cible: '[R1] si les heures candidates ne repondent pas', fichier: APP, de: "  return !(c && c.base === s.cleCourante && (c.etat === 'ok' || c.etat === 'erreur' || c.etat === 'local'));", vers: '  return true;' },
  { nom: 'panne-relancee', lettre: 'R1', bloc: 'aucune', cible: '[R1] une recherche en panne ne se relance pas d elle-meme', fichier: APP, de: "  if (c && c.etat === 'erreur' && c.id === id && c.partie === 0 && c.base === quickBookState.cleCourante) return;\n", vers: '' },
  { nom: 'passe-deplace', lettre: 'R2', cible: '[R2] une heure deja passee reste un choix', fichier: APP, de: 'heureSouhaitee: !rvHeurePassee(state.currentDate, heure)', vers: 'heureSouhaitee: true' },
  { nom: 'laser-commence', lettre: 'R2', cible: '[R2] une partie de laser commencee ne se propose pas', fichier: APP, de: '    .filter((h) => !(laserDabord && maintenant !== null && timeToNum(h) <= maintenant + 1e-9));', vers: ';' },
  // (la phrase « 15:30 ne tient pas » se dit sur la ligne d etat du ticket, rsVerdictHtml)
  { nom: 'souhait-muet', lettre: 'R2', cible: '[R2] et le dit', fichier: APP, de: '    if (rvPropositionActive(s) && s.heureVoulue && s.heureVoulue !== s.startTime) morceaux.push(', vers: '    if (false) morceaux.push(' },
  { nom: 'souhait-fige', lettre: 'R2', cible: '[R2] une heure qui ne tient pas donne la plus proche', fichier: APP, de: '    quickBookState.heureVoulue = quickBookState.startTime;\n    quickBookState.heureProposee = true;', vers: '    quickBookState.heureVoulue = quickBookState.startTime;' },
  { nom: 'souhait-ignore', lettre: 'R2', cible: '[R2] une heure qui tient s ouvre dessus', fichier: APP, de: "...(heure ? { startTime: heure, heureSouhaitee: !rvHeurePassee(state.currentDate, heure) } : {}),", vers: '' },
  { nom: 'naît-attendu', lettre: 'R3', bloc: 'atteinte', cible: '[R3] une heure atteinte nait arrivee', fichier: APP, de: "status: !simulation && rvNaitArrive(s) ? 'arrived' : 'pending',", vers: "status: 'pending'," },
  { nom: 'demi-heure-oubliee', lettre: 'R3', bloc: 'demi-heure', cible: '[R3] une heure dans la demi-heure nait arrivee', fichier: APP, de: 'const RV_ARRIVE_SOUS = 0.5;', vers: 'const RV_ARRIVE_SOUS = 0;' },
  { nom: 'tout-arrive', lettre: 'R3', bloc: 'plus-tard', cible: '[R3] plus tard, le groupe reste attendu', fichier: APP, de: 'const RV_ARRIVE_SOUS = 0.5;', vers: 'const RV_ARRIVE_SOUS = 24;' },
  { nom: 'pas-encaisse', lettre: 'R4', bloc: 'Carte', cible: '[R4] Payé carte cree et encaisse d un coup', fichier: APP, de: '    if (encaisser) encaisserReservation(payload.reservation.id, moyen);', vers: '' },
  { nom: 'moyen-reste', lettre: 'R4', bloc: 'creation-refusee', cible: '[R4] apres un refus de creation, Créer n encaisse rien', fichier: APP, de: "  const moyen = etat.payNow || '';\n  etat.payNow = false;", vers: "  const moyen = etat.payNow || '';" },
  { nom: 'droit-oublie', lettre: 'R4', bloc: 'boutons', cible: '[R4] sans le droit d encaisser, pas de bouton', fichier: APP, de: "  if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('payments.markPaid')) return false;\n  const plan = rvPlanCourant();", vers: '  const plan = rvPlanCourant();' },
  { nom: 'autre-jour-paye', lettre: 'R4', bloc: 'boutons', cible: '[R4] pour un autre jour, pas de bouton', fichier: APP, de: "  if (!s || s.date !== todayStr() || rvResas.length > 1 || s.forcer || rvTicketVide()) return false;", vers: "  if (!s || rvResas.length > 1 || s.forcer || rvTicketVide()) return false;" },
  { nom: 'lot-paye', lettre: 'R4', bloc: 'boutons', cible: '[R4] pour plusieurs dossiers, pas de bouton', fichier: APP, de: "  if (!s || s.date !== todayStr() || rvResas.length > 1 || s.forcer || rvTicketVide()) return false;", vers: "  if (!s || s.date !== todayStr() || s.forcer || rvTicketVide()) return false;" },
  { nom: 'paye-pas-arrive', lettre: 'R4', bloc: 'paye-plus-tard', cible: '[R4] paye veut dire arrive', fichier: GF, de: "if (r.status === 'paid' && mo && mo.etat !== 'absent') {", vers: 'if (false) {', aussi: [{ fichier: APP, de: "if (r.status === 'paid' && moment && moment.etat !== 'absent') {", vers: 'if (false) {' }, { fichier: APP, de: "  if (status === 'arrived' || status === 'paid' || span.start <= context.now) return 'onsite';", vers: "  if (status === 'arrived' || span.start <= context.now) return 'onsite';" }] },
  { nom: 'serveur-paye', lettre: 'R5', cible: '[R5] le corps ne cree pas un dossier paye', serveur: true, fichier: FEN, de: '  corps.status = statutDeCreation(corps.status, session);\n', vers: '' },
  { nom: 'serveur-arrive-sans-droit', lettre: 'R5', cible: '[R5] sans le droit de pointer, le dossier nait attendu', serveur: true, fichier: FEN, de: "return statut === 'arrived' && sessionHasPermission(session, ['reservations.status', 'reservations.edit']) ? 'arrived' : 'pending';", vers: "return statut === 'arrived' ? 'arrived' : 'pending';" },
  { nom: 'heure-introuvable', lettre: 'R7', cible: '[R7] « 15:00 » trouve les groupes de 15:00', fichier: GF, de: '    var heure = GF_Q_HEURE.exec(q);\n    if (heure) {', vers: '    var heure = null;\n    if (heure) {' },
  { nom: 'piste-introuvable', lettre: 'R7', cible: '[R7] « P3 » trouve les groupes de la piste 3', fichier: GF, de: '    var piste = GF_Q_PISTE.exec(q);', vers: '    var piste = null;' },
  { nom: 'nombre-introuvable', lettre: 'R7', cible: '[R7] « 10 pers » trouve les groupes de 10', fichier: GF, de: '    return Boolean(pers) && Number(r.pax) === Number(pers[1]);', vers: '    return false;' },
  { nom: 'faute-refusee', lettre: 'R7', cible: '[R7] « mason » trouve Masson', fichier: GF, de: '    return m.groupes.filter(function (g) { return nomRessemble(gfCle(g.r.name), q); });', vers: '    return justes;' },
  { nom: 'voisins-ramenes', lettre: 'R7', cible: '[R7] un nom juste ne ramene pas ses voisins', fichier: GF, de: "    if (justes.length || typeof nomRessemble !== 'function') return justes;\n    return m.groupes.filter(function (g) { return nomRessemble(gfCle(g.r.name), q); });", vers: '    return m.groupes.filter(function (g) { return gfTrouve(g, q) || nomRessemble(gfCle(g.r.name), q); });' },
  { nom: 'autres-dates-muettes', lettre: 'R8', cible: '[R8] les autres dates se lisent sous le tableau', fichier: GF, de: "      + gfAutresDatesHtml(m, terme);", vers: "      + '';" },
  { nom: 'fiche-change-le-jour', lettre: 'R8', cible: '[R8] la fiche ne fait pas quitter le jour', fichier: GF, de: 'onclick="pv2ResSearchOpen(this.dataset.id, true)"', vers: 'onclick="pv2ResSearchOpen(this.dataset.id)"' },
  { nom: 'nom-non-echappe', lettre: 'R8', cible: '[R8] un nom piege reste du texte', fichier: GF, de: `? '<button type="button" class="gf-rien__reserver" data-nom="' + gpEsc(terme) + '" onclick="reserverAuComptoir({ name: this.dataset.nom })">Réserver pour ' + gpEsc(terme) + '</button>'`, vers: `? '<button type="button" class="gf-rien__reserver" data-nom="' + gpEsc(terme) + '" onclick="reserverAuComptoir({ name: this.dataset.nom })">Réserver pour ' + terme + '</button>'` },
  { nom: 'bouton-sans-nom', lettre: 'R8', cible: '[R8] « Réserver pour Dupont » ouvre Réserver avec le nom tape', fichier: APP, de: "    name: prefill.name || prefill.nomTape || '',", vers: "    name: prefill.name || ''," },
  { nom: 'autre-centre', lettre: 'R8', cible: '[R8] les resultats d un autre centre ne se montrent pas', fichier: V2, de: '    if (pv2ResSearch.center && pv2ResSearch.center !== getActiveOpsCenterId()) return [];\n    const q = pv2ResSearchNormalize(terme);', vers: '    const q = pv2ResSearchNormalize(terme);' },
  { nom: 'cache-garde', lettre: 'R8', cible: '[R8] une reservation creee se trouve', fichier: APP, de: "  if (typeof window.pv2ResSearchAjouter === 'function') window.pv2ResSearchAjouter(reservations);", vers: '' },
  { nom: 'filtre-cache-le-groupe', lettre: 'R8', cible: '[R8] un groupe cache par un filtre', fichier: GF, de: '    var caches = m.visibles ? gfRecherche(m, q).length : 0;', vers: '    var caches = 0;' },
  { nom: 'annuler-cache', lettre: 'R9', bloc: 'annuler', cible: '[R9] Annuler se voit dans Infos, sans defiler', fichier: APP, de: "${droits.annuler && r.status !== 'cancelled' ? `<div class=\"fx-annuler-rang\">", vers: "${false ? `<div class=\"fx-annuler-rang\">" },
  { nom: 'annuler-sans-droit', lettre: 'R9', bloc: 'droit', cible: '[R9] sans le droit d annuler, pas de bouton', fichier: APP, de: "${droits.annuler && r.status !== 'cancelled' ? `<div class=\"fx-annuler-rang\">", vers: "${r.status !== 'cancelled' ? `<div class=\"fx-annuler-rang\">" },
  { nom: 'pli-ouvert', lettre: 'R9', bloc: 'pli', cible: '[R9] le telephone, l e-mail et l occasion attendent dans un pli', fichier: APP, de: `<details class="fm-pli" id="editContactPli"\${editContactOuvert ? ' open' : ''}`, vers: `<details class="fm-pli" id="editContactPli" open` },
  { nom: 'pli-oublie', lettre: 'R9', bloc: 'pli', cible: '[R9] le pli garde son etat d un rendu a l autre', fichier: APP, de: ' ontoggle="editContactOuvert = this.open"', vers: '' },
  { nom: 'email-cache', lettre: 'R9', bloc: 'pli', cible: '[R9] un e-mail invalide rouvre le pli', fichier: APP, de: ` oninvalid="document.getElementById('editContactPli').open = true"`, vers: '' },
  { nom: 'bouton-petit', lettre: 'R10', bloc: 'comptoir-light', cible: '[R10] au doigt, 44 px', fichier: 'assets/pinlane-staff.css', de: '.qb-modal.rv.rs .rs-payer { min-width: 0; height: 44px;', vers: '.qb-modal.rv.rs .rs-payer { min-width: 0; height: 24px;' },
  { nom: 'deux-pleins', lettre: 'R10', bloc: 'comptoir-light', cible: '[R10] un seul bouton plein au pied', fichier: 'assets/pinlane-staff.css', de: 'border: 1px solid var(--rs-ligne-forte); border-radius: 10px; background: var(--surface); font-size: 14px; font-weight: 550; line-height: 1; color: var(--text);', vers: 'border: 0; border-radius: 10px; background: var(--accent); font-size: 14px; font-weight: 550; line-height: 1; color: var(--accent-contrast);' },
];
const LES_MUTATIONS = new Map(MUTATIONS.map((m) => [m.nom, m]));

// LE JOUR DU SERVEUR : celui de la fixture, a son heure, quel que soit le jour ou le
// gate tourne. La lecture de l heure du metier passe par cette seule fonction
// (getBusinessNowParts) : le moteur juge « le jour meme » comme en production, et le
// gate ne rougit pas au lendemain du 16 janvier 2027.
const HORLOGE_SERVEUR = { fichier: 'lib/booking-config.js', de: 'function getBusinessNowParts(date = new Date()) {', vers: 'function getBusinessNowParts(date = new Date(globalThis.__comptoirMaintenant || Date.now())) {' };

let echecs = 0;
let reussis = 0;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}`); return true; }
  echecs += 1;
  console.log(`FAIL  ${label}${detail !== undefined ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return false;
}
const GESTES = [];
function gestes(parcours, avant, apres) { GESTES.push({ parcours, avant, apres }); }

// ---------------------------------------------------------------------------
// LE MONTAGE
// ---------------------------------------------------------------------------
FX.APPAREILS.comptoir = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: 'fr-BE' };

// « Payé » et « Arrivé » ecrits par setReservationStatus (lib/database.js), sur la vue
// de la transaction du client, comme les ecritures du banc.
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryAvant = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (s === 'update reservations set status = $2, payment_method = $3, updated_at = now() where id = $1 returning *;') {
    const tx = this && this.tx && !this.tx.abandonnee ? this.tx : null;
    const avant = (tx && tx.reservations.get(Number(params[0]))) || B.base.reservations.get(Number(params[0]));
    if (!avant) return { rows: [], rowCount: 0 };
    const precedent = avant.updated_at ? new Date(avant.updated_at).getTime() : 0;
    const row = { ...avant, status: params[1], payment_method: params[2] || null, updated_at: new Date(Math.max(Date.now(), precedent + 1)) };
    if (tx) tx.reservations.set(row.id, row); else B.base.reservations.set(row.id, row);
    return { rows: [JSON.parse(JSON.stringify(row), (k, v) => (['created_at', 'updated_at', 'paid_at', 'absent_at'].includes(k) && v ? new Date(v) : v))], rowCount: 1 };
  }
  return queryAvant.call(this, sql, params);
};

function ligneDepuis(r) {
  return {
    id: r.id, center_id: r.centerId || 'libramont', channel: r.channel || 'staff', name: String(r.name).replace('DÉMO · ', ''), phone: r.phone || '', email: r.email || '',
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

const editsDe = (m) => [m, ...(m.aussi || [])];
const mutation = CASSE ? LES_MUTATIONS.get(CASSE) : null;
if (CASSE && !mutation) { console.error(`comptoir-reserver-check : contre-preuve inconnue ${CASSE}`); process.exit(2); }

function verifierAncre(m) {
  const texte = lf(fs.readFileSync(path.join(ROOT, m.fichier), 'utf8'));
  return texte.split(m.de).length - 1;
}
if (mutation && editsDe(mutation).some((e) => verifierAncre(e) !== 1)) {
  console.error(`comptoir-reserver-check : la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois`);
  process.exit(2);
}

function transformer(rel, texte) {
  const edits = mutation && !mutation.serveur ? editsDe(mutation).filter((e) => e.fichier === rel) : [];
  return edits.length ? edits.reduce((t, e) => t.split(e.de).join(e.vers), lf(texte)) : texte;
}

const serveur = B.monter({
  mutations: [HORLOGE_SERVEUR, ...(mutation && mutation.serveur ? [{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }] : [])],
  session: B.sessionDuRole('manager', { nom: 'Accueil' }),
});

async function ouvrir(browser, { fixture = 'pic', appareil = 'comptoir', theme = 'light', heure = '15:10', autresDates = [] } = {}) {
  const fx = FX.lireFixture(fixture);
  globalThis.__comptoirMaintenant = FX.instant(fx.staffState.date, heure).getTime();
  B.semer(fx.staffState.reservations.map(ligneDepuis));
  serveur.changerSession(B.sessionDuRole('manager', { nom: 'Accueil' }));
  const journal = [];
  const m = await FX.monter(browser, {
    fixture, appareil, theme, port: PORT, heure,
    avantChargement: async (page) => {
      await page.exposeFunction('__fixtureServeur', async (corps) => { journal.push({ m: 'PATCH', corps }); return serveur.appeler('PATCH', '/api/staff-reservations', corps); });
      await page.exposeFunction('__vraiAppel', async (methode, url, corps) => { journal.push({ m: methode, url, corps }); return serveur.appeler(methode, url, corps); });
      await page.route('**/*fixture=*', async (route) => {
        const r = await route.fetch();
        let b = await r.text();
        // (les noms de la journee, sans leur marque de demonstration)
        b = b.split('DÉMO · ').join('').split('D\\u00c9MO \\u00b7 ').join('').replace(/\[DEMO-JOURS[^"\\]*\]\s*/g, '').replace(/Dossier fictif de d(?:é|\\u00e9)monstration[^"]*/g, '');
        await route.fulfill({ response: r, body: b });
      });
    },
  });
  const { ctx, page, erreurs } = m;
  page.setDefaultTimeout(8000);
  await page.evaluate((autres) => {
    window.__autresDates = autres;
    window.__lecturesAutresDates = 0;
    window.__refuserCreation = false;
    window.__refuserCandidats = false;
    const avant = window.fetch;
    window.fetch = async (input, init) => {
      init = init || {};
      const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
      const me = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
      if (u.pathname === '/api/admin-range') {
        window.__lecturesAutresDates += 1;
        return new Response(JSON.stringify({ ok: true, reservations: window.__autresDates }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
      if (u.pathname === '/api/staff-reservations' && me !== 'PATCH') {
        const corps = init.body ? JSON.parse(init.body) : undefined;
        if (window.__refuserCreation && me === 'POST' && corps && !corps.dryRun) {
          return new Response(JSON.stringify({ ok: false, message: 'Refus du gate.' }), { status: 422, headers: { 'content-type': 'application/json; charset=utf-8' } });
        }
        if (window.__refuserCandidats && me === 'POST' && corps && corps.candidats) {
          window.__candidatsRefuses = (window.__candidatsRefuses || 0) + 1;
          return new Response(JSON.stringify({ ok: false, message: 'Panne du gate.' }), { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } });
        }
        const rep = await window.__vraiAppel(me, u.pathname + u.search, corps);
        const j = rep.json || {};
        if (me === 'POST' && !corps.dryRun && j.reservation) window.__FIXTURE__.jours[window.__FIXTURE__.jour].push(j.reservation);
        return new Response(JSON.stringify(j), { status: rep.statut, headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
      return avant(input, init);
    };
  }, autresDates);
  const finir = async (lettre) => {
    ok(erreurs.length === 0, `[*] zero erreur JavaScript (${lettre})`, erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  };
  return { ctx, page, erreurs, journal, finir };
}

// ---- Lire l ecran ---------------------------------------------------------
const texte = (page, sel) => page.evaluate((s) => Array.from(document.querySelectorAll(s)).filter((e) => e.getClientRects().length).map((e) => e.innerText.replace(/\s+/g, ' ').trim()).join(' | '), sel);
// Le plan est pose : Créer est pret (data-pret="1" : le plan du serveur est la et
// tient), ou le refus se dit (#rvRefus, « Prendre 16:00 »), et la fenetre ne cherche
// plus (« Recherche… », « Le planning cherche l’heure qui tient »).
const planPose = (page) => page.waitForFunction(() => {
  const b = document.getElementById('rvCreer');
  if (!b || /cherche|Création/.test(b.textContent) || /cherche/.test((document.getElementById('rvVerdict') || {}).textContent || '')) return false;
  return b.dataset.pret === '1' || Boolean(b.dataset.proche) || Boolean(document.getElementById('rvRefus'));
}, null, { timeout: 8000 }).catch(() => {});
const pret = (page) => page.evaluate(() => { const b = document.getElementById('rvCreer'); return Boolean(b && b.dataset.pret === '1'); });
// LE TELEPHONE AVANT LE CLIC QUI CREE (2026-11-11) : la creation l exige ; un parcours qui ne le tape
// pas encore le tape ici, juste avant « Créer » ou « Payé », sans rien changer au reste de son geste.
// [R6] seul cree sans lui, pour prouver le refus.
const TEL_COMPTOIR = '0470 12 34 56';
async function avecTelephone(page) {
  const vide = await page.evaluate(() => { const c = document.getElementById('qbPhone'); return Boolean(c) && !c.value.trim(); });
  if (vide) await page.fill('#qbPhone', TEL_COMPTOIR);
}
// Les joueurs se choisissent sur leur touche ; celle qui est choisie est pressee.
const joueurs = (page, n) => page.locator(`#rsHaut [data-pax="${n}"]`);
const joueursPris = (page) => page.evaluate(() => { const k = document.querySelector('#rsHaut [data-pax][aria-pressed="true"]'); const autre = document.getElementById('qbPax'); return k ? k.dataset.pax : (autre ? autre.value : ''); });
// Les deux boutons « Payé » du pied : affiches, et utilisables (pas disabled).
const payes = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#rvPied .rs-payer')).map((b) => ({ mot: b.textContent.trim(), visible: b.getClientRects().length > 0, actif: !b.disabled })));
const utilisables = (liste) => liste.filter((p) => p.visible && p.actif).length;
const fenetreFermee = (page) => page.waitForFunction(() => document.getElementById('quickBookOverlay').classList.contains('hidden'), null, { timeout: 8000 });
const creationsDe = (journal) => journal.filter((j) => j.m === 'POST' && j.corps && !j.corps.dryRun);
const compteur = (page, f) => page.evaluate((c) => Number((document.querySelector(`[data-gf-filtre="${c}"] .gf-c__v`) || {}).textContent), f);
async function clic(n, locator) { n.n += 1; await locator.click(); }
const ligneDe = (page, id) => texte(page, `.gf-r[data-gf-id="${id}"]`);
function enBase(id) {
  const row = B.base.reservations.get(Number(id));
  return row ? { status: row.status, moyen: row.payment_method, nom: row.name, tel: row.phone, heure: String(row.start_time).slice(0, 5), pistes: (row.lanes || []).map(Number) } : null;
}
async function chercher(page, terme) {
  await page.evaluate((q) => { const c = document.getElementById('globalPlanningSearchInput'); c.value = q; applyStaffSearch(q, { immediate: true }); }, terme);
  await page.waitForTimeout(120);
  return page.evaluate(() => Array.from(document.querySelectorAll('#globalPlanningGridWrap tr.gf-r')).map((tr) => tr.getAttribute('data-gf-id')));
}
const nomsDe = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#globalPlanningGridWrap tr.gf-r .gf-nom__t')).map((n) => n.textContent));
// Le rouge se guette tout du long : un etat qui passe ne laisse pas de trace a la fin.
// Un refus se dit sur la ligne du ticket (#rvRefus), sur la seance choisie, au resume
// du telephone, dans le verdict, et Créer propose « Prendre 16:00 » (data-proche).
const guetterLeRouge = (page) => page.evaluate(() => {
  window.__rouge = 0;
  const note = () => { if (document.querySelector('#rvRefus, #quickBookOverlay .rs-h.is-ko, #quickBookOverlay .rs-v-ligne.is-ko, #rsResume .is-ko, #rvCreer[data-proche]')) window.__rouge += 1; };
  new MutationObserver(note).observe(document.getElementById('quickBookOverlay'), { subtree: true, childList: true, attributes: true, characterData: true });
});
const leRouge = (page) => page.evaluate(() => window.__rouge || 0);

// ---------------------------------------------------------------------------
// [R1] L HEURE QUI TIENT
// ---------------------------------------------------------------------------
async function scenarioR1(browser) {
  console.log('\n[R1] Réserver s ouvre sur une heure qui tient');
  if (joue('ouverture')) {
    const m = await ouvrir(browser);
    const { page } = m;
    await guetterLeRouge(page);
    const n = { n: 0 };
    await clic(n, page.getByRole('button', { name: 'Réservation', exact: true }).first());
    await page.waitForSelector('#rvCreer');
    const a4 = await texte(page, '#rvCreer');
    await clic(n, joueurs(page, 6));
    await page.waitForTimeout(350);
    await planPose(page);
    const a6 = await texte(page, '#rvCreer');
    const pret6 = await pret(page);
    const ligne6 = await texte(page, '#rsL-a-bowling');
    ok(/Créer à 15:00/.test(a6), '[R1] a 15:10, Réserver s ouvre sur une heure qui tient (15:00 pour 6)', `${a4} | ${a6} | ${ligne6}`);
    // (« Possible » : le plan du serveur est la et tient ; ses pistes se lisent sur la ligne du ticket)
    ok(pret6 && /piste \d/.test(ligne6), '[R1] et dit ses pistes libres', `pret ${pret6} | ${ligne6}`);
    ok(await leRouge(page) === 0, '[R1] sans passer par le rouge, a l ouverture', await leRouge(page));
    // Le groupe grandit : l heure le suit, puis revient.
    await joueurs(page, 20).click();
    await page.waitForTimeout(350);
    await planPose(page);
    const a20 = await texte(page, '#rvCreer');
    const pret20 = await pret(page);
    ok(!/15:00/.test(a20) && pret20, '[R1] pour 20, l heure suit le groupe', `${a20} | pret ${pret20} | ${await texte(page, '#rsL-a-bowling')}`);
    await joueurs(page, 6).click();
    await page.waitForTimeout(350);
    await planPose(page);
    ok(/Créer à 15:00/.test(await texte(page, '#rvCreer')), '[R1] et revient pour 6', await texte(page, '#rvCreer'));
    await page.evaluate(() => closeQuickBook());
    await m.finir('R1');
  }
  if (joue('main')) {
    // A LA MAIN, ELLE NE BOUGE PLUS.
    const m = await ouvrir(browser);
    const { page } = m;
    // (le groupe de 4, puis « Autres » du bowling : toutes les heures, 17:30 a la main)
    await page.getByRole('button', { name: 'Réservation', exact: true }).first().click();
    await joueurs(page, 4).click();
    await page.waitForTimeout(350);
    await planPose(page);
    await page.locator('#quickBookOverlay .rs-h-autres[data-activite="bowling"]').click();
    await page.locator('#quickBookOverlay .rs-heures .rs-h[data-heure="17:30"]').click();
    await page.waitForTimeout(350);
    await planPose(page);
    const choisie = await texte(page, '#rvCreer');
    await joueurs(page, 2).click();
    await page.waitForTimeout(350);
    await planPose(page);
    const apres = await texte(page, '#rvCreer');
    ok(/17:30/.test(choisie) && /17:30/.test(apres), '[R1] une heure choisie a la main ne bouge plus quand le groupe change', `${choisie} | ${apres}`);
    await m.finir('R1 main');
  }
  if (joue('serveur')) {
    // LE PLANNING A LE DERNIER MOT. Un autre poste vient de prendre les pistes libres :
    // la base le sait, ce poste pas encore. Il propose 15:00, le serveur refuse et dit
    // ou tout tient.
    const m = await ouvrir(browser);
    const { page } = m;
    await guetterLeRouge(page);
    [1, 2, 5, 8].forEach((p, i) => {
      B.base.reservations.set(9700 + i, B.ligne(9700 + i, { start_time: '15:00', lanes: [p], date: '2027-01-16', duration: 1, total_duration: 1, center_id: 'libramont', name: `Autre poste ${p}`, status: 'pending' }));
    });
    // (le groupe de 4, celui qui ouvrait la fenetre avant Les seances)
    await page.getByRole('button', { name: 'Réservation', exact: true }).first().click();
    await joueurs(page, 4).click();
    await page.waitForFunction(() => /Créer à (?!15:00)\d\d:\d\d/.test((document.getElementById('rvCreer') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    await planPose(page);
    const creer = await texte(page, '#rvCreer');
    const tient = await pret(page);
    ok(/Créer à \d\d:\d\d/.test(creer) && !/15:00/.test(creer) && tient, '[R1] le planning a le dernier mot : la fenetre va ou il dit que tout tient', `${creer} | pret ${tient} | ${await texte(page, '#rsL-a-bowling')}`);
    ok(await leRouge(page) === 0, '[R1] sans passer par le rouge, quand le serveur refuse', await leRouge(page));
    await page.evaluate(() => closeQuickBook());
    await m.finir('R1 serveur');
  }
  if (joue('calme')) {
    // A 15:25, une heure payee ne perd pas 25 minutes pour etre « la premiere ».
    const m = await ouvrir(browser, { fixture: 'calme', heure: '15:25' });
    const { page } = m;
    await page.getByRole('button', { name: 'Réservation', exact: true }).first().click();
    await joueurs(page, 4).click();
    await page.waitForTimeout(350);
    await planPose(page);
    ok(/Créer à 15:30/.test(await texte(page, '#rvCreer')), '[R1] a 15:25 sur un jour calme, c est 15:30', await texte(page, '#rvCreer'));
    await page.evaluate(() => closeQuickBook());
    await m.finir('R1 calme');
  }
  if (joue('aucune')) {
    // AUCUNE HEURE NE TIENT : la fenetre ne cherche pas pour rien, elle dit le refus.
    const m = await ouvrir(browser);
    const { page } = m;
    // (« cherche » : Créer dit « Recherche… », le verdict « Le planning cherche l’heure qui tient »)
    const enRecherche = async () => `${await texte(page, '#rvCreer')} | ${await texte(page, '#rvVerdict')}`;
    await page.evaluate(() => reserverAuComptoir({ type: 'bowling', pax: 240 }));
    await page.waitForSelector('#rvRefus', { timeout: 8000 }).catch(() => {});
    const refus = await texte(page, '#rvRefus');
    const pied = await enRecherche();
    ok(Boolean(refus) && !/cherche/.test(pied), '[R1] si aucune heure ne tient, le refus se dit, sans chercher pour rien', `${refus} | ${pied}`);
    await page.evaluate(() => closeQuickBook());
    // La recherche ne repond pas : la fenetre ne reste pas a chercher non plus.
    await page.evaluate(() => { window.__refuserCandidats = true; reserverAuComptoir({ type: 'bowling', pax: 240 }); });
    await page.waitForSelector('#rvRefus', { timeout: 8000 }).catch(() => {});
    const refusPanne = await texte(page, '#rvRefus');
    const piedPanne = await enRecherche();
    ok(Boolean(refusPanne) && !/cherche/.test(piedPanne), '[R1] si les heures candidates ne repondent pas, le refus se dit aussi', `${refusPanne} | ${piedPanne}`);
    // (2026-11-03 : chaque repeint relancait la recherche en panne, 512 requetes en 4 s)
    const relancesAvant = await page.evaluate(() => window.__candidatsRefuses || 0);
    await page.waitForTimeout(1500);
    const relances = (await page.evaluate(() => window.__candidatsRefuses || 0)) - relancesAvant;
    ok(relances <= 1, '[R1] une recherche en panne ne se relance pas d elle-meme', `${relances} requete(s) en 1,5 s sans un geste`);
    await page.evaluate(() => closeQuickBook());
    await m.finir('R1 aucune heure');
  }
}

// ---------------------------------------------------------------------------
// [R2] LA PORTE DU TABLEAU
// ---------------------------------------------------------------------------
async function scenarioR2(browser) {
  console.log('\n[R2] reserverAuComptoir');
  const m = await ouvrir(browser);
  const { page } = m;
  // (les joueurs donnes se lisent sur leur touche, pressee : #qbPax n est plus que « Autre »)
  await page.evaluate(() => reserverAuComptoir({ type: 'bowling', pax: 6 }));
  await planPose(page);
  ok(/Créer à 15:00/.test(await texte(page, '#rvCreer')) && await joueursPris(page) === '6', '[R2] sans heure, la plus proche qui tient, avec ses joueurs', `${await texte(page, '#rvCreer')} | joueurs ${await joueursPris(page)}`);
  await page.evaluate(() => closeQuickBook());

  // (ce que la fenetre dit d une heure deplacee, elle le dit dans son texte visible)
  const fenetre = () => texte(page, '#quickBookOverlay');
  await page.evaluate(() => reserverAuComptoir({ type: 'bowling', startTime: '17:30', pax: 4 }));
  await planPose(page);
  const tient = await texte(page, '#rvCreer');
  ok(/Créer à 17:30/.test(tient) && !/17:30 ne tient pas|ne tient pas à 17:30/.test(await fenetre()), '[R2] une heure qui tient s ouvre dessus', tient);
  await page.evaluate(() => closeQuickBook());

  await guetterLeRouge(page);
  await page.evaluate(() => reserverAuComptoir({ type: 'bowling', startTime: '15:30', pax: 6 }));
  await page.waitForTimeout(350);
  await planPose(page);
  const proche = await texte(page, '#rvCreer');
  const dit = await fenetre();
  ok(/Créer à \d\d:\d\d/.test(proche) && !/15:30/.test(proche), '[R2] une heure qui ne tient pas donne la plus proche', proche);
  // (l ancienne fenetre : « 15:30 ne tient pas. Voici l’heure la plus proche. »)
  ok(/15:30 ne tient pas|ne tient pas à 15:30/.test(dit), '[R2] et le dit : « 15:30 ne tient pas »', `${proche} | ${dit.slice(0, 400)}`);
  ok(await leRouge(page) === 0, '[R2] sans rouge', await leRouge(page));
  await page.evaluate(() => closeQuickBook());

  // Une heure passee reste un choix : on note un groupe deja venu.
  await page.evaluate(() => reserverAuComptoir({ type: 'bowling', startTime: '14:00', pax: 20 }));
  await planPose(page);
  ok(/14:00/.test(await texte(page, '#rvHeure-bowling')), '[R2] une heure deja passee reste un choix : on note un groupe deja venu', await texte(page, '#rvHeure-bowling'));
  await page.evaluate(() => closeQuickBook());

  // Le laser garde sa porte : l heure du depart, verrouillee.
  await page.evaluate(() => reserverAuComptoir({ type: 'laser', startTime: '15:30', pax: 4 }));
  await planPose(page);
  const depart = await texte(page, '#rvCreer');
  const verrou = await page.evaluate(() => quickBookState.lockStartTime);
  ok(/Créer à 15:30/.test(depart) && verrou === true && await joueursPris(page) === '4', '[R2] le laser garde openQuickBookForLaserSession : son depart, verrouille', `${depart} ${verrou} joueurs ${await joueursPris(page)}`);
  await page.evaluate(() => closeQuickBook());

  await page.evaluate(() => reserverAuComptoir({ type: 'laser', pax: 4 }));
  await planPose(page);
  const laser = await texte(page, '#rvCreer');
  ok(((laser.match(/\d\d:\d\d/) || [''])[0]) > '15:10', '[R2] une partie de laser commencee ne se propose pas', laser);
  await page.evaluate(() => closeQuickBook());
  await m.finir('R2');
}

// ---------------------------------------------------------------------------
// [R3] DEVANT LE COMPTOIR, ARRIVE
// ---------------------------------------------------------------------------
async function scenarioR3(browser) {
  console.log('\n[R3] un client devant le comptoir est arrive');
  if (joue('atteinte')) {
    const m = await ouvrir(browser);
    const { page, journal } = m;
    const late = await compteur(page, 'late');
    const onsite = await compteur(page, 'onsite');
    const n = { n: 0 };
    await clic(n, page.getByRole('button', { name: 'Réservation', exact: true }).first());
    await clic(n, joueurs(page, 6));
    await page.waitForTimeout(350);
    await planPose(page);
    await avecTelephone(page);
    await clic(n, page.locator('#rvCreer'));
    await fenetreFermee(page);
    const cree = creationsDe(journal)[0];
    ok(cree && cree.corps.status === 'arrived', '[R3] une heure atteinte nait arrivee, sans geste de plus', cree && cree.corps.status);
    const id = (await page.evaluate(() => Math.max(...state.reservations.map((r) => Number(r.id)))));
    await page.waitForTimeout(200);
    const ligne = await ligneDe(page, id);
    // Le numero du client s affiche sur la ligne (« +32 470… ») : seul un retard « +10 min » est interdit.
    ok(enBase(id).status === 'arrived' && /Ils sont 6/.test(ligne) && !/\+\d+\s*min/.test(ligne), '[R3] la ligne dit « Ils sont 6 », jamais « +10 min »', `${JSON.stringify(enBase(id))} ${ligne}`);
    ok(await compteur(page, 'late') === late, '[R3] En retard ne bouge pas', `${late} -> ${await compteur(page, 'late')}`);
    ok(await compteur(page, 'onsite') === onsite + 1, '[R3] Sur place compte le groupe', `${onsite} -> ${await compteur(page, 'onsite')}`);
    gestes('Client sans reservation, piste pour 6', '5 gestes', `${n.n} gestes`);
    await m.finir('R3');
  }
  if (joue('demi-heure')) {
    // DANS LA DEMI-HEURE : le depart laser de 15:30, a 15:10.
    const m = await ouvrir(browser);
    const { page } = m;
    await page.evaluate(() => reserverAuComptoir({ type: 'laser', startTime: '15:30', pax: 4 }));
    await planPose(page);
    await avecTelephone(page);
    await page.locator('#rvCreer').click();
    await fenetreFermee(page);
    const id = await page.evaluate(() => Math.max(...state.reservations.map((r) => Number(r.id))));
    ok(enBase(id).status === 'arrived', '[R3] une heure dans la demi-heure nait arrivee', enBase(id));
    await m.finir('R3 demi-heure');
  }
  if (joue('plus-tard')) {
    // PLUS TARD : personne n est encore la.
    const m = await ouvrir(browser);
    const { page } = m;
    await page.evaluate(() => reserverAuComptoir({ type: 'bowling', startTime: '17:30', pax: 4 }));
    await planPose(page);
    await avecTelephone(page);
    await page.locator('#rvCreer').click();
    await fenetreFermee(page);
    const id = await page.evaluate(() => Math.max(...state.reservations.map((r) => Number(r.id))));
    await page.waitForTimeout(200);
    ok(enBase(id).status === 'pending' && /Arrivé/.test(await ligneDe(page, id)), '[R3] plus tard, le groupe reste attendu et se pointe', `${JSON.stringify(enBase(id))} ${await ligneDe(page, id)}`);
    await m.finir('R3 plus tard');
  }
}

// ---------------------------------------------------------------------------
// [R4] CREER ET ENCAISSER
// ---------------------------------------------------------------------------
async function scenarioR4(browser) {
  console.log('\n[R4] creer et encaisser d un coup');
  for (const [mot, valeur, moyenBase] of [['Carte', 'Payé carte', 'Carte Bancaire'], ['Espèces', 'Payé espèces', 'Espèces']]) {
    if (!joue(mot)) continue;
    const m = await ouvrir(browser);
    const { page, journal } = m;
    const late = await compteur(page, 'late');
    const onsite = await compteur(page, 'onsite');
    const n = { n: 0 };
    await clic(n, page.getByRole('button', { name: 'Réservation', exact: true }).first());
    await clic(n, joueurs(page, 6));
    await page.waitForTimeout(350);
    await planPose(page);
    await avecTelephone(page);
    await clic(n, page.locator('#rvPied .rs-payer', { hasText: valeur }));
    await fenetreFermee(page);
    await page.waitForFunction(() => /pay/i.test((document.getElementById('toast') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
    const id = await page.evaluate(() => Math.max(...state.reservations.map((r) => Number(r.id))));
    const base = enBase(id);
    ok(base && base.status === 'paid' && base.moyen === moyenBase && creationsDe(journal).length === 1 && journal.filter((j) => j.m === 'PATCH').length === 1, `[R4] ${valeur} cree et encaisse d un coup`, `${JSON.stringify(base)} ${journal.map((j) => j.m + (j.corps && j.corps.dryRun ? ':dry' : '')).join(',')}`);
    await page.waitForTimeout(150);
    ok(/Payé/.test(await ligneDe(page, id)) && !/\+\d+\s*min/.test(await ligneDe(page, id)), `[R4] la ligne dit Payé (${mot})`, await ligneDe(page, id));
    ok(await compteur(page, 'late') === late && await compteur(page, 'onsite') === onsite + 1, `[R4] paye veut dire arrive : En retard ne bouge pas, Sur place compte le groupe (${mot})`, `retard ${late} -> ${await compteur(page, 'late')}, sur place ${onsite} -> ${await compteur(page, 'onsite')}`);
    const toast = await texte(page, '#toast');
    ok(/Annuler/.test(toast), `[R4] le toast garde son « Annuler » (${mot})`, toast);
    if (mot === 'Carte') {
      gestes('Le meme, qui paie tout de suite', '8 gestes', `${n.n} gestes`);
      await page.locator('#toast .toast-annuler').click();
      await page.waitForFunction((i) => /Ils sont/.test((document.querySelector(`.gf-r[data-gf-id="${i}"]`) || {}).textContent || ''), id, { timeout: 6000 }).catch(() => {});
      ok(enBase(id).status === 'arrived', '[R4] « Annuler » rend le groupe arrive, pas attendu', enBase(id));
    }
    await m.finir(`R4 ${mot}`);
  }
  if (joue('paye-plus-tard')) {
    // PAYE POUR 17:30, A 15:10 : le client est passe au comptoir, il compte sur place.
    const m = await ouvrir(browser);
    const { page } = m;
    const onsite = await compteur(page, 'onsite');
    const upcoming = await compteur(page, 'upcoming');
    await page.evaluate(() => reserverAuComptoir({ type: 'bowling', startTime: '17:30', pax: 4 }));
    await planPose(page);
    await avecTelephone(page);
    await page.locator('#rvPied .rs-payer', { hasText: 'Payé carte' }).click();
    await fenetreFermee(page);
    await page.waitForFunction(() => /pay/i.test((document.getElementById('toast') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(200);
    ok(await compteur(page, 'onsite') === onsite + 1 && await compteur(page, 'upcoming') === upcoming, '[R4] paye veut dire arrive, meme pour plus tard : il quitte À venir', `sur place ${onsite} -> ${await compteur(page, 'onsite')}, à venir ${upcoming} -> ${await compteur(page, 'upcoming')}`);
    await m.finir('R4 plus tard');
  }
  if (joue('paiement-refuse')) {
    // UN REFUS DU PAIEMENT LAISSE LE GROUPE CREE.
    const m = await ouvrir(browser);
    const { page } = m;
    const sansEncaisser = B.sessionDuRole('staff-bar', { nom: 'Accueil' });
    sansEncaisser.permissions = sansEncaisser.permissions.filter((p) => p !== 'payments.markPaid');
    serveur.changerSession(sansEncaisser);
    await page.getByRole('button', { name: 'Réservation', exact: true }).first().click();
    await joueurs(page, 4).click();
    await page.waitForTimeout(350);
    await planPose(page);
    await avecTelephone(page);
    await page.locator('#rvPied .rs-payer', { hasText: 'Payé carte' }).click();
    await fenetreFermee(page);
    await page.waitForFunction(() => /(permission|droit|insuffisant)/i.test((document.getElementById('toast') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
    const id = await page.evaluate(() => Math.max(...state.reservations.map((r) => Number(r.id))));
    ok(enBase(id) && enBase(id).status === 'arrived', '[R4] un paiement refuse laisse le groupe cree et arrive', enBase(id));
    ok(/(permission|droit|insuffisant)/i.test(await texte(page, '#toast')), '[R4] et le dit', await texte(page, '#toast'));
    await m.finir('R4 refus');
  }
  if (joue('creation-refusee')) {
    // UN REFUS DE CREATION N ENCAISSE RIEN ENSUITE.
    const m = await ouvrir(browser);
    const { page, journal } = m;
    await page.getByRole('button', { name: 'Réservation', exact: true }).first().click();
    await joueurs(page, 4).click();
    await page.waitForTimeout(350);
    await planPose(page);
    await page.evaluate(() => { window.__refuserCreation = true; });
    await avecTelephone(page);
    await page.locator('#rvPied .rs-payer', { hasText: 'Payé carte' }).click();
    await page.waitForFunction(() => /Refus du gate/.test((document.getElementById('rvVerdict') || {}).textContent || ''), null, { timeout: 6000 });
    await page.evaluate(() => { window.__refuserCreation = false; });
    await page.locator('#rvCreer').click();
    await fenetreFermee(page);
    await page.waitForTimeout(350);
    const id = await page.evaluate(() => Math.max(...state.reservations.map((r) => Number(r.id))));
    ok(enBase(id).status === 'arrived' && !journal.some((j) => j.m === 'PATCH'), '[R4] apres un refus de creation, Créer n encaisse rien', `${JSON.stringify(enBase(id))}`);
    await m.finir('R4 creation refusee');
  }
  if (joue('double-clic')) {
    // UN DOUBLE CLIC NE CREE PAS DEUX DOSSIERS.
    const m = await ouvrir(browser);
    const { page, journal } = m;
    await page.getByRole('button', { name: 'Réservation', exact: true }).first().click();
    await joueurs(page, 4).click();
    await page.waitForTimeout(350);
    await planPose(page);
    await avecTelephone(page);
    await page.locator('#rvPied .rs-payer', { hasText: 'Payé carte' }).dblclick();
    await fenetreFermee(page);
    await page.waitForTimeout(400);
    ok(creationsDe(journal).length === 1, '[R4] un double clic ne cree qu un dossier', creationsDe(journal).length);
    await m.finir('R4 double clic');
  }
  if (joue('boutons')) {
    // OU LES BOUTONS SERVENT. Les seances les laissent a leur place, eteints (disabled),
    // quand encaisser n a pas de sens : chaque cas se joue avec un plan qui tient et des
    // joueurs choisis, pour que seule la regle du cas les eteigne.
    const m = await ouvrir(browser);
    const { page } = m;
    const etat = async () => `${JSON.stringify(await payes(page))} pret ${await pret(page)} | ${await texte(page, '#rvCreer')}`;
    await page.getByRole('button', { name: 'Réservation', exact: true }).first().click();
    await joueurs(page, 6).click();
    await page.waitForTimeout(350);
    await planPose(page);
    const aujourdhui = await payes(page);
    ok(aujourdhui.length === 2 && utilisables(aujourdhui) === 2, '[R4] aujourd hui, les deux boutons Payé, utilisables', await etat());
    await page.locator('#rvEncore').click();
    await page.waitForTimeout(350);
    await joueurs(page, 4).click();
    await page.waitForTimeout(350);
    await planPose(page);
    ok(utilisables(await payes(page)) === 0 && await pret(page), '[R4] pour plusieurs dossiers, pas de bouton Payé utilisable : chacun se paie sur sa fiche', await etat());
    await page.evaluate(() => closeQuickBook());
    await page.getByRole('button', { name: 'Réservation', exact: true }).first().click();
    await joueurs(page, 6).click();
    await page.locator('#rsHaut [data-jour]', { hasText: 'Demain' }).click();
    await page.waitForTimeout(350);
    await planPose(page);
    ok(utilisables(await payes(page)) === 0 && await pret(page), '[R4] pour un autre jour, pas de bouton Payé utilisable : on paie sur place', await etat());
    await page.evaluate(() => closeQuickBook());
    await page.evaluate(() => {
      const s = state.staffAuthSession;
      state.staffAuthSession = { ...s, role: { ...s.role, locked: false }, permissions: (s.permissions || []).filter((p) => p !== 'payments.markPaid') };
    });
    await page.getByRole('button', { name: 'Réservation', exact: true }).first().click();
    await joueurs(page, 6).click();
    await page.waitForTimeout(350);
    await planPose(page);
    ok(utilisables(await payes(page)) === 0 && await pret(page), '[R4] sans le droit d encaisser, pas de bouton Payé utilisable', await etat());
    await page.evaluate(() => closeQuickBook());
    await m.finir('R4 boutons');
  }
}

// ---------------------------------------------------------------------------
// [R5] LE SERVEUR
// ---------------------------------------------------------------------------
async function scenarioR5() {
  console.log('\n[R5] le serveur ne cree ni paye ni arrive sans le droit');
  const fx = FX.lireFixture('calme');
  globalThis.__comptoirMaintenant = FX.instant(fx.staffState.date, '15:10').getTime();
  B.semer([]);
  const jour = fx.staffState.date;
  const corps = (heure, status) => B.corpsStaff({ date: jour, type: 'bowling', pax: 4, startTime: heure, duration: 1, totalDuration: 1, lanes: [], laneCount: 1, name: 'Client', phone: TEL_COMPTOIR, email: '', status, requiresLanes: true, channel: 'staff', allowPastStart: true });
  serveur.changerSession(B.sessionDuRole('staff-bar', { nom: 'Accueil' }));
  const paye = await serveur.appeler('POST', '/api/staff-reservations', corps('15:30', 'paid'));
  ok(paye.statut === 201 && enBase(paye.json.reservation.id).status === 'pending', '[R5] le corps ne cree pas un dossier paye : encaisser passe par le PATCH', `${paye.statut} ${JSON.stringify(paye.json.reservation ? enBase(paye.json.reservation.id) : paye.json)}`);
  const arrive = await serveur.appeler('POST', '/api/staff-reservations', corps('16:00', 'arrived'));
  ok(arrive.statut === 201 && enBase(arrive.json.reservation.id).status === 'arrived', '[R5] avec le droit de pointer, le dossier nait arrive', `${arrive.statut} ${JSON.stringify(arrive.json.reservation ? enBase(arrive.json.reservation.id) : arrive.json)}`);
  const sansPointer = B.sessionDuRole('staff-bar', { nom: 'Accueil' });
  sansPointer.permissions = sansPointer.permissions.filter((p) => !['reservations.status', 'reservations.edit'].includes(p));
  serveur.changerSession(sansPointer);
  const refuse = await serveur.appeler('POST', '/api/staff-reservations', corps('16:30', 'arrived'));
  ok(refuse.statut === 201 && enBase(refuse.json.reservation.id).status === 'pending', '[R5] sans le droit de pointer, le dossier nait attendu', `${refuse.statut} ${JSON.stringify(refuse.json.reservation ? enBase(refuse.json.reservation.id) : refuse.json)}`);
}

// ---------------------------------------------------------------------------
// [R6] LE MOINS DE CHAMPS
// ---------------------------------------------------------------------------
async function scenarioR6(browser) {
  console.log('\n[R6] le moins de champs possible');
  const m = await ouvrir(browser);
  const { page } = m;
  await page.evaluate(() => reserverAuComptoir({ type: 'bowling', pax: 6 }));
  await planPose(page);
  // (2026-11-11, Ansar : le telephone est obligatoire, le nom reste facultatif : sans
  // nom, le dossier part au nom de « Client ».)
  const exige = await page.evaluate(() => { const t = document.getElementById('qbPhone'); const n = document.getElementById('qbName'); return { tel: Boolean(t && t.required && t.getAttribute('aria-required') === 'true' && /obligatoire/.test((t.closest('label') || {}).textContent || '')), nom: Boolean(n && !n.required && n.getAttribute('aria-required') !== 'true') }; });
  ok(exige.tel && exige.nom, '[R6] la fenetre dit que le telephone est obligatoire, et le nom non', exige);
  await page.locator('#rvCreer').click();
  await page.waitForTimeout(400);
  const sansTel = await page.evaluate(() => ({ ouverte: quickBookState !== null, focus: document.activeElement ? document.activeElement.id : '' }));
  ok(sansTel.ouverte && sansTel.focus === 'qbPhone', '[R6] sans telephone, Créer ne cree rien et mene au telephone', sansTel);
  await page.locator('#qbPhone').fill('0470 12 34 56');
  await page.locator('#rvCreer').click();
  await fenetreFermee(page);
  const id = await page.evaluate(() => Math.max(...state.reservations.map((r) => Number(r.id))));
  const base = enBase(id);
  ok(base.nom === 'Client' && String(base.tel || '').replace(/\D/g, '').endsWith('470123456'), '[R6] le telephone seul tape : « Client », son numero, et Créer passe', base);
  await page.waitForTimeout(150);
  ok(/Client/.test(await ligneDe(page, id)), '[R6] la ligne se lit', await ligneDe(page, id));
  const { cleClient } = require(path.join(ROOT, 'lib/donnees-clients.js'));
  ok(cleClient({ name: base.nom, phone: '', email: '', clientKey: 'n:client' }) === '', '[R6] et ce dossier ne devient pas un faux client « Client » : le nom de repli reste celui que les fiches clients reconnaissent');
  await m.finir('R6');
}

// ---------------------------------------------------------------------------
// [R7] LA RECHERCHE
// ---------------------------------------------------------------------------
async function scenarioR7(browser) {
  console.log('\n[R7] la recherche trouve ce qui est ecrit sur la ligne');
  const m = await ouvrir(browser);
  const { page } = m;
  const heures = await chercher(page, '15:00');
  const noms15 = await nomsDe(page);
  ok(heures.length >= 3 && noms15.some((n) => /Clara/.test(n)) && noms15.some((n) => /Lina/.test(n)), '[R7] « 15:00 » trouve les groupes de 15:00', noms15);
  ok((await chercher(page, '15h')).length >= heures.length, '[R7] « 15h » aussi, et toute l heure', await nomsDe(page));
  await chercher(page, 'P3');
  const p3 = await nomsDe(page);
  ok(p3.length >= 2 && p3.some((n) => /Arthur/.test(n)) && p3.some((n) => /Pirotte/.test(n)) && !p3.some((n) => /Masson/.test(n)), '[R7] « P3 » trouve les groupes de la piste 3', p3);
  const pers = await chercher(page, '10 pers');
  const cases = await page.evaluate(() => Array.from(document.querySelectorAll('#globalPlanningGridWrap tr.gf-r .gf-n b')).map((b) => b.textContent));
  ok(pers.length >= 3 && cases.every((c) => c === '10'), '[R7] « 10 pers » trouve les groupes de 10', cases);
  await chercher(page, 'mason');
  const faute = await nomsDe(page);
  // (Manon est a une lettre, elle aussi : l oeil choisit ; ce qui compte, c est que
  // Masson y soit et que la journee ne revienne pas entiere.)
  ok(faute.some((n) => /Masson/.test(n)) && faute.length <= 3, '[R7] « mason » trouve Masson', faute);
  await chercher(page, 'Masson');
  ok((await nomsDe(page)).length === 1, '[R7] « Masson » reste exact', await nomsDe(page));
  await chercher(page, 'mas');
  ok(!(await nomsDe(page)).length || (await nomsDe(page)).every((n) => /mas/i.test(n)), '[R7] sous 4 lettres, aucune tolerance', await nomsDe(page));
  await chercher(page, '');
  // UN NOM JUSTE NE RAMENE PAS SES VOISINS : un groupe « Mason » de plus.
  await page.evaluate(() => reserverAuComptoir({ type: 'bowling', startTime: '17:30', pax: 2, name: 'Famille Mason' }));
  await planPose(page);
  await avecTelephone(page);
  await page.locator('#rvCreer').click();
  await fenetreFermee(page);
  await page.waitForTimeout(150);
  await chercher(page, 'Masson');
  const juste = await nomsDe(page);
  ok(juste.length === 1 && /Masson/.test(juste[0]), '[R7] un nom juste ne ramene pas ses voisins', juste);
  await chercher(page, '');
  await m.finir('R7');
}

// ---------------------------------------------------------------------------
// [R8] LES AUTRES DATES
// ---------------------------------------------------------------------------
async function scenarioR8(browser) {
  console.log('\n[R8] sans resultat aujourd hui, les autres dates');
  const modele = FX.lireFixture('pic').staffState.reservations.find((r) => r.id === 1638);
  const dossier = (id, date, heure, nom, pax) => ({ ...modele, id, date, startTime: heure, name: nom, pax, status: 'pending', phone: '+32470123456', email: '', clientKey: '' });
  const autres = [dossier(7001, '2027-01-23', '18:00', 'Famille Dupont', 8), dossier(7002, '2026-12-05', '14:00', 'Dupont Marc', 4), dossier(7003, '2027-01-30', '19:00', 'Famille Durand', 6), dossier(7004, '2027-01-16', '19:30', 'Dupont du jour', 3)];
  const m = await ouvrir(browser, { autresDates: autres });
  const { page, journal } = m;
  const nGestes = { n: 0 };
  await page.keyboard.type('Dupont', { delay: 20 });
  nGestes.n += 1; // (le nom tape, d un trait)
  // (le nom entier : sous charge, « Dupo » avait deja ses autres dates quand la mesure partait)
  await page.waitForFunction(() => { const t = (document.querySelector('.gf-rien') || {}).textContent || ''; return /Autres dates/.test(t) && /« Dupont »/.test(t); }, null, { timeout: 6000 }).catch(() => {});
  const rien = await texte(page, '.gf-rien');
  const lignes = await page.locator('.gf-rien__l').count();
  ok(/Aucun groupe ne correspond à « Dupont » aujourd’hui/.test(rien), '[R8] le tableau le dit', rien);
  ok(lignes === 2 && /Dupont/.test(rien) && !/Durand/.test(rien) && !/du jour/.test(rien), '[R8] les autres dates se lisent sous le tableau : une ligne par reservation, pas celles du jour', `${lignes} ${rien}`);
  ok(/sam\. 23 janv\. · 18:00/.test(rien) && /8 joueurs/.test(rien), '[R8] avec la date, l heure, le nom et le nombre', rien);
  ok(await page.evaluate(() => window.__lecturesAutresDates) === 1, '[R8] une seule lecture lourde, pour toutes les lettres', await page.evaluate(() => window.__lecturesAutresDates));
  // LA FICHE D UNE AUTRE DATE, SANS QUITTER LE JOUR.
  await clicN(nGestes, page.locator('.gf-rien__l').first());
  await page.waitForFunction(() => !document.getElementById('posOverlay').classList.contains('hidden'), null, { timeout: 6000 });
  const fiche = await texte(page, '#posOverlay .edit-modal');
  ok(/Famille Dupont/.test(fiche), '[R8] une ligne ouvre sa fiche', fiche.slice(0, 160));
  gestes('Nom pas trouve, reservation d une autre date', '15 gestes', `${nGestes.n} gestes (le nom, puis la ligne)`);
  await page.evaluate(() => closePos());
  await page.waitForTimeout(150);
  await page.evaluate(() => { const c = document.getElementById('globalPlanningSearchInput'); c.value = ''; applyStaffSearch('', { immediate: true }); });
  await page.waitForTimeout(200);
  const apres = await page.evaluate(() => state.currentDate);
  const tete = (await texte(page, '.gf-r')).length;
  ok(apres === '2027-01-16' && tete > 0, '[R8] la fiche ne fait pas quitter le jour : le tableau du jour revient', apres);
  // RESERVER POUR DUPONT.
  await chercher(page, 'Dupont');
  await page.waitForSelector('.gf-rien__reserver');
  const n = { n: 0 };
  ok(/Réserver pour Dupont/.test(await texte(page, '.gf-rien__reserver')), '[R8] le bouton nomme le client', await texte(page, '.gf-rien__reserver'));
  await clic(n, page.locator('.gf-rien__reserver'));
  await page.waitForSelector('#qbName').catch(() => {});
  ok(await page.locator('#qbName').inputValue() === 'Dupont', '[R8] « Réserver pour Dupont » ouvre Réserver avec le nom tape', await page.locator('#qbName').inputValue().catch(() => 'pas de champ'));
  // (Les seances demandent le nombre de joueurs avant Créer : 4, comme avant)
  await clic(n, joueurs(page, 4));
  await page.waitForTimeout(350);
  await planPose(page);
  // Le telephone, obligatoire (2026-11-11) : un geste de plus.
  n.n += 1;
  await page.locator('#qbPhone').fill('0470 12 34 56');
  const lecturesAvant = await page.evaluate(() => window.__lecturesAutresDates);
  await clic(n, page.locator('#rvCreer'));
  await fenetreFermee(page);
  await page.waitForTimeout(250);
  const recherche = await page.evaluate(() => ({ trouvee: pv2ResSearchMatches('Dupont').some((r) => r.name === 'Dupont' && r.date === state.currentDate), lectures: window.__lecturesAutresDates }));
  ok(recherche.trouvee && recherche.lectures === lecturesAvant, '[R8] une reservation creee se trouve tout de suite, sans relire toutes les dates', { ...recherche, lecturesAvant });
  const creee = creationsDe(journal)[0];
  ok(creee && creee.corps.name === 'Dupont' && (await nomsDe(page)).join() === 'Dupont', '[R8] le groupe cree se lit sur le tableau, sous son nom', `${creee && creee.corps.name} ${await nomsDe(page)}`);
  gestes('Nom pas trouve, client a creer', '15 gestes', `${n.n + 1} gestes (le nom, le bouton, les joueurs, le téléphone, Créer)`);
  await chercher(page, '');
  // UN GROUPE CACHE PAR UN FILTRE N EST PAS ABSENT : pas de doublon propose.
  await page.locator('button[data-gf-filtre="late"]').click();
  await chercher(page, 'Masson');
  await page.waitForSelector('.gf-rien');
  const cache = await texte(page, '.gf-rien');
  ok(/1 groupe trouvé, caché par ce filtre/.test(cache) && !/Réserver pour/.test(cache) && !/Aucun groupe/.test(cache), '[R8] un groupe cache par un filtre ne se reserve pas une deuxieme fois', cache);
  await page.locator('.gf-rien__reserver').click();
  await page.waitForTimeout(200);
  ok((await nomsDe(page)).some((n) => /Masson/.test(n)), '[R8] « Enlever le filtre » le montre', await nomsDe(page));
  await chercher(page, '');
  // UN NOM PIEGE RESTE DU TEXTE.
  const piege = `"><img src=x onerror="window.__piege=1"> O'Neil`;
  await chercher(page, piege);
  await page.waitForTimeout(200);
  const injecte = await page.evaluate(() => ({ img: document.querySelectorAll('.gf-rien img').length, piege: window.__piege || 0 }));
  ok(injecte.img === 0 && injecte.piege === 0, '[R8] un nom piege reste du texte', injecte);
  await page.locator('.gf-rien__reserver').click();
  await page.waitForSelector('#qbName').catch(() => {});
  ok(await page.locator('#qbName').inputValue() === piege, '[R8] et arrive tel quel dans le champ', await page.locator('#qbName').inputValue().catch(() => 'pas de champ'));
  await page.evaluate(() => closeQuickBook());
  await chercher(page, '');
  // UN AUTRE CENTRE NE VOIT PAS CES LIGNES.
  const fuite = await page.evaluate(() => { const c = state.adminCenterId; state.adminCenterId = 'autre-centre'; const lu = pv2ResSearchMatches('Dupont').length; state.adminCenterId = c; return lu; });
  ok(fuite === 0, '[R8] les resultats d un autre centre ne se montrent pas', fuite);
  await m.finir('R8');
}
async function clicN(n, locator) { n.n += 1; await locator.click(); }

// ---------------------------------------------------------------------------
// [R9] LA FICHE
// ---------------------------------------------------------------------------
async function scenarioR9(browser) {
  console.log('\n[R9] annuler se voit, le contact se replie');
  const CAMILLE = 1603;
  if (joue('annuler')) {
    const m = await ouvrir(browser);
    const { page, journal } = m;
    const n = { n: 0 };
    await clic(n, page.locator(`[data-gf-id="${CAMILLE}"] .gf-nom__t`));
    await page.waitForSelector('#posOverlay .fx-act');
    const b = await page.locator('#posOverlay .fx-annuler').boundingBox({ timeout: 1500 }).catch(() => null);
    ok(b && b.y + b.height <= 768 && b.y >= 0, '[R9] Annuler se voit dans Infos, sans defiler', b);
    if (!b) { await m.finir('R9 annuler'); return; }
    await clic(n, page.locator('#posOverlay .fx-annuler'));
    await page.waitForSelector('.staff-confirm-overlay');
    ok(/Annuler cette réservation/.test(await texte(page, '.staff-confirm-overlay')), '[R9] avec sa confirmation', await texte(page, '.staff-confirm-overlay'));
    await clic(n, page.locator('.staff-confirm-overlay button').last());
    await page.waitForFunction(() => document.getElementById('posOverlay').classList.contains('hidden'), null, { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(300);
    ok(enBase(CAMILLE).status === 'cancelled' && !(await ligneDe(page, CAMILLE)), '[R9] et le groupe part', `${JSON.stringify(enBase(CAMILLE))} ${journal.filter((j) => j.m !== 'GET' && !(j.corps && j.corps.dryRun)).length}`);
    gestes('Annuler une reservation', '6 gestes', `${n.n} gestes`);
    await m.finir('R9 annuler');
  }
  if (joue('droit')) {
    const m = await ouvrir(browser);
    const { page } = m;
    await page.evaluate(() => {
      const s = state.staffAuthSession;
      state.staffAuthSession = { ...s, role: { ...s.role, locked: false }, permissions: (s.permissions || []).filter((p) => p !== 'reservations.cancel') };
    });
    await page.locator(`[data-gf-id="${CAMILLE}"] .gf-nom__t`).click();
    await page.waitForSelector('#posOverlay .fx-act');
    ok(await page.locator('#posOverlay .fx-annuler').count() === 0, '[R9] sans le droit d annuler, pas de bouton', await texte(page, '#posOverlay .fx-act'));
    await m.finir('R9 droit');
  }
  if (joue('pli')) {
    const m = await ouvrir(browser);
    const { page } = m;
    await page.locator(`[data-gf-id="${CAMILLE}"] .gf-nom__t`).click();
    await page.waitForSelector('#posOverlay .fx-act');
    await page.locator('#posOverlay button', { hasText: /^Modifier$/ }).first().click();
    await page.waitForSelector('#editNameInput');
    ok(await page.locator('#editNameInput').isVisible() && !(await page.locator('#editPhoneInput').isVisible()) && !(await page.locator('#editEmailInput').isVisible()) && !(await page.locator('#posOverlay .fm-occasion').isVisible()), '[R9] le telephone, l e-mail et l occasion attendent dans un pli');
    await page.locator('#editContactPli > summary').click();
    ok(await page.locator('#editPhoneInput').isVisible() && await page.locator('#editEmailInput').isVisible(), '[R9] un toucher les montre');
    await page.fill('#editPhoneInput', '0471 00 00 00');
    await page.evaluate(() => renderPos());
    await page.waitForTimeout(100);
    ok(await page.locator('#editPhoneInput').isVisible() && await page.locator('#editPhoneInput').inputValue() === '0471 00 00 00', '[R9] le pli garde son etat d un rendu a l autre', await page.locator('#editPhoneInput').isVisible());
    await page.fill('#editEmailInput', 'pas-un-mail');
    await page.locator('#editContactPli > summary').click();
    await page.locator('#posOverlay button.es-save').click();
    await page.waitForTimeout(200);
    ok(await page.locator('#editEmailInput').isVisible(), '[R9] un e-mail invalide rouvre le pli, le navigateur peut le montrer');
    await page.evaluate(() => closePos());
    await page.locator(`[data-gf-id="${CAMILLE}"] .gf-nom__t`).click();
    await page.waitForSelector('#posOverlay .fx-act');
    await page.locator('#posOverlay button', { hasText: /^Modifier$/ }).first().click();
    await page.waitForSelector('#editNameInput');
    ok(!(await page.locator('#editPhoneInput').isVisible()), '[R9] une fiche qui s ouvre repart repliee');
    await m.finir('R9 pli');
  }
}

// ---------------------------------------------------------------------------
// [R10] A L ECRAN
// ---------------------------------------------------------------------------
// Le contraste se lit au pixel : un canvas rend la couleur calculee, ou que le
// navigateur l ecrive (color-mix, oklab).
function mesures(selecteurs) {
  const canvas = document.createElement('canvas');
  canvas.width = 1; canvas.height = 1;
  const c = canvas.getContext('2d', { willReadFrequently: true });
  const px = (couleur) => { c.clearRect(0, 0, 1, 1); c.fillStyle = couleur; c.fillRect(0, 0, 1, 1); const d = c.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const fond = (el) => {
    const pile = [];
    for (let n = el; n; n = n.parentElement) { const p = px(getComputedStyle(n).backgroundColor); if (p[3] > 0) { pile.unshift(p); if (p[3] === 1) break; } }
    return pile.reduce((a, p) => [0, 1, 2].map((i) => a[i] * (1 - p[3]) + p[i] * p[3]), [255, 255, 255]);
  };
  const lum = (rgb) => { const f = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  return selecteurs.flatMap((sel) => Array.from(document.querySelectorAll(sel)).filter((e) => e.getClientRects().length).map((e) => {
    const st = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return { sel, h: Math.round(r.height), w: Math.round(r.width), police: parseFloat(st.fontSize), contraste: Math.round(ratio(px(st.color).slice(0, 3), fond(e)) * 100) / 100, famille: st.fontFamily.split(',')[0] };
  }));
}

// (`PINLANE_COMPTOIR_CAPTURES=<dossier>` garde ce que le gate regarde, pour l oeil)
async function photo(page, nom) {
  if (!CAPTURES) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

async function scenarioR10(browser) {
  console.log('\n[R10] a l ecran');
  for (const [appareil, theme] of [['comptoir', 'light'], ['comptoir', 'dark'], ['tablette', 'light'], ['telephone', 'dark']]) {
    if (!joue(`${appareil}-${theme}`)) continue;
    const m = await ouvrir(browser, { appareil, theme });
    const { page } = m;
    const doigt = appareil !== 'comptoir';
    const lieu = `${appareil} ${theme}`;
    const min = doigt ? 44 : 32;
    await page.evaluate(() => reserverAuComptoir({ type: 'bowling', pax: 6 }));
    await planPose(page);
    // (au telephone, les boutons Payé vivent dans le ticket, qui s ouvre au toucher du resume)
    if (appareil === 'telephone') { await page.locator('#rsResume').click(); await page.waitForSelector('.qb-modal.rv.is-ticket #rvCreerPaye0'); }
    const pied = await page.evaluate(mesures, ['#rvPied .rv-creer-paye', '#rvCreer']);
    ok(pied.length === 3 && pied.every((x) => x.h >= 44), `[R10] au doigt, 44 px : les boutons du pied (${lieu})`, pied);
    ok(pied.every((x) => x.police >= 12 && x.contraste >= 4.5), `[R10] rien sous 12 px, contraste 4,5:1 au pied (${lieu})`, pied);
    // (plein : le fond est la couleur d accent de la console, celle de Créer)
    const pleins = await page.evaluate(() => {
      const modale = document.querySelector('.qb-modal.rv');
      const sonde = document.createElement('i');
      sonde.style.background = 'var(--accent)';
      modale.appendChild(sonde);
      const accent = getComputedStyle(sonde).backgroundColor;
      sonde.remove();
      return Array.from(document.querySelectorAll('#rvPied button')).filter((b) => b.getClientRects().length && getComputedStyle(b).backgroundColor === accent).map((b) => b.textContent.trim());
    });
    ok(pleins.length === 1, `[R10] un seul bouton plein au pied (${lieu})`, pleins);
    const deborde = await page.evaluate(() => { const p = document.getElementById('rvPied'); const m = document.querySelector('.qb-modal.rv').getBoundingClientRect(); return Array.from(p.querySelectorAll('button')).filter((b) => b.getClientRects().length).filter((b) => { const r = b.getBoundingClientRect(); return r.right > m.right + 1 || r.left < m.left - 1 || b.scrollWidth > b.clientWidth + 1; }).map((b) => b.textContent); });
    ok(deborde.length === 0, `[R10] rien ne deborde du pied (${lieu})`, deborde);
    await photo(page, `${appareil}-${theme}-reserver`);
    await page.evaluate(() => closeQuickBook());
    await page.evaluate(() => {
      window.__autresDates = [{ ...state.reservations[0], id: 7001, date: '2027-01-23', startTime: '18:00', name: 'Famille Dupont', pax: 8, status: 'pending' }];
    });
    // Le vrai geste, pas un champ rempli par script : au telephone la page est une
    // longue colonne, le champ est en haut, et c est sous lui que tout doit se lire.
    await page.locator('#globalPlanningSearchInput').click();
    await page.keyboard.type('Dupont', { delay: 15 });
    await page.waitForSelector('.gf-rien__l');
    await photo(page, `${appareil}-${theme}-autres-dates`);
    const sousLeChamp = await page.evaluate(() => { const b = document.querySelector('.gf-rien__l').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; });
    ok(sousLeChamp, `[R10] les autres dates se lisent sous le champ, sans defiler (${lieu})`);
    const rien = await page.evaluate(mesures, ['.gf-rien__reserver', '.gf-rien__l', '.gf-rien__q', '.gf-rien__n', '.gf-rien__p', '.gf-rien b', '.gf-rien__titre']);
    const cibles = rien.filter((x) => /reserver|__l$/.test(x.sel));
    ok(cibles.length === 2 && cibles.every((x) => x.h >= min), `[R10] les cibles sous le tableau font ${min} px (${lieu})`, rien);
    ok(rien.every((x) => x.police >= 12 && x.contraste >= 4.5), `[R10] sous le tableau, rien sous 12 px, contraste 4,5:1 (${lieu})`, rien);
    ok(rien.every((x) => /Geist/i.test(x.famille)), `[R10] Geist partout (${lieu})`, rien.map((x) => x.famille));
    await page.evaluate(() => { const c = document.getElementById('globalPlanningSearchInput'); c.value = ''; applyStaffSearch('', { immediate: true }); });
    await page.locator('[data-gf-id="1603"] .gf-nom__t').click();
    await page.waitForSelector('#posOverlay .fx-annuler');
    await photo(page, `${appareil}-${theme}-fiche`);
    const annuler = await page.evaluate(mesures, ['#posOverlay .fx-annuler']);
    ok(annuler.length === 1 && annuler[0].h >= min && annuler[0].police >= 12 && annuler[0].contraste >= 4.5, `[R10] Annuler : ${min} px, 12 px, 4,5:1 (${lieu})`, annuler);
    await page.locator('#posOverlay button', { hasText: /^Modifier$/ }).first().click();
    await page.waitForSelector('#editContactPli');
    await photo(page, `${appareil}-${theme}-modifier`);
    const pli = await page.evaluate(mesures, ['#editContactPli > summary']);
    ok(pli.length === 1 && pli[0].h >= (doigt ? 40 : 32) && pli[0].police >= 12 && pli[0].contraste >= 4.5, `[R10] le pli se lit et se touche (${lieu})`, pli);
    await m.finir(`R10 ${lieu}`);
  }
}

// ---------------------------------------------------------------------------
const SCENARIOS = { R1: scenarioR1, R2: scenarioR2, R3: scenarioR3, R4: scenarioR4, R5: scenarioR5, R6: scenarioR6, R7: scenarioR7, R8: scenarioR8, R9: scenarioR9, R10: scenarioR10 };

function verifierLesAncres() {
  let mortes = 0;
  for (const m of [...MUTATIONS.flatMap(editsDe), HORLOGE_SERVEUR]) {
    const n = verifierAncre(m);
    if (n !== 1) { mortes += 1; console.log(`FAIL  ancre ${m.nom || m.fichier} trouvee ${n} fois : ${m.de.slice(0, 80)}`); }
  }
  const toutes = MUTATIONS.flatMap(editsDe).length + 1;
  console.log(`comptoir-reserver-check --ancres : ${toutes - mortes}/${toutes} uniques`);
  return mortes;
}

async function contrePreuves() {
  if (verifierLesAncres()) process.exit(1);
  const voulues = typeof argument('contre-preuves') === 'string' ? argument('contre-preuves').split(',') : null;
  const liste = voulues ? MUTATIONS.filter((m) => voulues.includes(m.nom)) : MUTATIONS;
  const runs = await eclats.enPool(liste, eclats.nombreDeFils(liste.length), (m, fil) => eclats.lancer(__filename, [`--seul=${m.lettre}`, ...(m.bloc ? [`--bloc=${m.bloc}`] : [])], {
    env: { ...process.env, COMPTOIR_CASSE: m.nom, PINLANE_COMPTOIR_RESERVER_PORT: String(PORT + 1 + fil) },
    timeout: 300000,
  }));
  let mordent = 0;
  liste.forEach((m, i) => {
    const sortie = `${runs[i].stdout || ''}${runs[i].stderr || ''}`;
    if (runs[i].status === 2) { console.log(`FAIL  contre-preuve ${m.nom} DESARMEE : ${sortie.trim().split('\n').pop()}`); return; }
    const rouges = sortie.split('\n').filter((l) => l.startsWith('FAIL'));
    if (rouges.some((l) => l.includes(m.cible))) { mordent += 1; console.log(`ok    contre-preuve ${m.nom} : « ${m.cible} » rougit`); return; }
    console.log(`FAIL  contre-preuve ${m.nom} : « ${m.cible} » reste vert (${rouges.length} autre(s) rouge(s) : ${rouges[0] ? rouges[0].slice(0, 120) : sortie.trim().split('\n').pop().slice(0, 160)})`);
  });
  console.log(`comptoir-reserver-check --contre-preuves : ${mordent}/${liste.length} mordent`);
  process.exit(mordent === liste.length ? 0 : 1);
}

async function main() {
  if (argument('ancres')) process.exit(verifierLesAncres() ? 1 : 0);
  if (argument('contre-preuves')) { await contrePreuves(); return; }
  const seul = typeof argument('seul') === 'string' ? argument('seul').split(',') : Object.keys(SCENARIOS);
  const http = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    for (const nom of seul) await SCENARIOS[nom](browser);
  } finally {
    await browser.close();
    http.close();
  }
  if (GESTES.length) {
    console.log('\nLes gestes, avant et apres :');
    GESTES.forEach((g) => console.log(`  ${g.parcours} : ${g.avant} -> ${g.apres}`));
  }
  console.log(`\ncomptoir-reserver-check : ${reussis} ok, ${echecs} echec(s)`);
  process.exit(echecs ? 1 : 0);
}

main().catch((erreur) => {
  console.error('comptoir-reserver-check : interrompu', erreur && (erreur.stack || erreur));
  process.exit(1);
});
