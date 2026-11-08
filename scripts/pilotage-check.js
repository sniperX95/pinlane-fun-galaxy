// LE DASHBOARD QUI SE REGLE (2026-11-08). Ansar : « ameliore drasiquement le dashboard, des trucs
// vrm utile, des stat utile et changeable, des grapgiques vrm styler ».
//
//   [S] LE CALCUL : le vrai reponseDashboard, recompte a la main sur l historique du banc. La
//       comparaison se choisit ; sans « Voir les montants », plus un euro ; aucune identite.
//   [H] LE VRAI api/ops.js, sa base et sa session remplacees par des sondes : c est lui qui lit
//       le droit « Voir les montants » et la fenetre de comparaison.
//   [J] LA JOURNEE : les tuiles disent les vrais chiffres, l ecart au meme jour de la semaine
//       d avant, le graphique se change d un toucher.
//   [P] LES PERIODES : 7 jours, 30 jours, ce mois. Les chiffres du serveur, une comparaison jour
//       de semaine contre jour de semaine, une date passee dit ou la periode s arrete.
//   [C] LES CARTES : un creneau ferme ne se dessine pas, le creneau le plus vide n est ni la
//       premiere ni la derniere heure, chaque phrase dit le vrai chiffre.
//   [R] LES REGLAGES : changer une tuile, echanger deux tuiles, retirer, ajouter, deplacer une
//       carte, et tout retrouver apres un rechargement.
//   [V] LE DIRECT : le rendu de la page ne redessine rien, ne rend pas le focus, ne ferme pas
//       un menu ouvert.
//   [D] LES DROITS : sans « Voir les montants », aucune tuile d argent, aucun euro, nulle part.
//   [E] LES PANNES : serveur en panne, reponse sans chiffres, centre ferme, journee vide, un nom
//       de formule qui veut s executer.
//   [M] LES ECRANS : tablette, telephone, 320 px, sombre ; onze chiffres, quatre periodes, neuf
//       cartes, jamais un NaN.
//
// Le banc (scripts/pilotage-fixture.js) : un historique fixe passe dans le vrai calcul du serveur.
//
// CONTRE-PREUVES : `--contre-preuves [--seul=a,b]` casse le code, une regle a la fois, et exige
// que le controle vise rougisse.
'use strict';

process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';
process.env.STAFF_AUTH_SECRET = 'gate-pilotage-secret-2026';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const lf = (t) => String(t).split('\r\n').join('\n');
const CASSE = process.env.PILOTAGE_CASSE || '';
const PORT = Number(process.env.PINLANE_PILOTAGE_PORT || 5331);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const MODULE_JS = 'assets/pinlane-pilotage.js';
const LIB = 'lib/direction-analytics.js';
const OPS = 'api/ops.js';
const CSS = 'assets/pinlane-staff.css';

const MUTATIONS = {
  'comparaison-ignoree': { section: 'S', fichier: LIB, de: "compareStart <= compareEnd && compareEnd < startDate\n    ? { startDate: compareStart", vers: "false\n    ? { startDate: compareStart", rouge: '[S] la comparaison choisie est celle qui est servie' },
  'comparaison-recouvre': { section: 'S', fichier: LIB, de: "compareStart <= compareEnd && compareEnd < startDate\n    ? { startDate: compareStart", vers: "compareStart <= compareEnd\n    ? { startDate: compareStart", rouge: '[S] une comparaison qui recouvre la periode est refusee' },
  'montants-du-jour': { section: 'S', fichier: LIB, de: "['daily', 'weekly', 'monthly', 'byFormule', 'byPaymentMethod']", vers: "['weekly', 'monthly', 'byFormule', 'byPaymentMethod']", rouge: '[S] sans « Voir les montants », plus un euro dans la reponse' },
  'identite': { section: 'S', fichier: LIB, de: "    clients: { unique: complet.clients.unique, new: complet.clients.new,", vers: "    clients: { ...complet.clients, unique: complet.clients.unique, new: complet.clients.new,", rouge: '[S] aucune identite de client dans la reponse' },
  'pistes-du-plan': { section: 'S', fichier: LIB, de: "  if (planifiees > 0) return planifiees;\n", vers: "", rouge: '[S] les heures de piste se lisent sur le plan du dossier' },
  'droit-ignore': { section: 'H', fichier: OPS, de: "voitLesMontants: sessionHasPermission(options.session, 'payments.view'),", vers: "voitLesMontants: true,", rouge: '[H] le vrai handler retire les montants a qui ne peut pas les voir' },
  'annulees-du-jour': { section: 'J', fichier: MODULE_JS, de: "    const toutes = state.reservations.filter((r) => r.date === state.currentDate);\n", vers: "    const toutes = S.ctx.dayReservations || [];\n", rouge: '[J] la tuile Annulations compte les annulees du jour' },
  'cta-principal': { section: 'J', fichier: CSS, de: ".dash-alerts > .dash-alert-group:first-child .dash-alert-row:first-child .dash-alert-cta { background: var(--text);", vers: ".dash-alerts > .dash-alert-group:first-child .dash-alert-row:nth-child(2) .dash-alert-cta { background: var(--text);", rouge: '[J] le premier bouton de « À traiter » reste le bouton principal' },
  'recul-non-aligne': { section: 'P', fichier: MODULE_JS, de: "const recul = id === '7j' ? 7 : (id === 'mois' && nb <= 28 ? 28 : 35);", vers: "const recul = nb;", rouge: '[P] 30 jours : jour de semaine contre jour de semaine' },
  'compteur-qui-grimpe': { section: 'P', fichier: MODULE_JS, de: "${f.id === 'jour' ? ` data-pl-num=\"dash.${id}\"` : ''}", vers: " data-pl-num=\"dash.${id}\"", rouge: '[P] changer de periode ne fait pas grimper les chiffres' },
  'ligne-cassee': { section: 'P', fichier: MODULE_JS, de: "relier: st.format !== 'euro' && st.format !== 'int', ", vers: "", rouge: '[P] un taux passe par-dessus les jours fermes' },
  'titre-sans-date': { section: 'P', fichier: MODULE_JS, de: "const titre = fin === todayStr() ? p.titre : (id === 'mois' ? `Du 1er au ${jolie}` : `${p.jours} jours jusqu’au ${jolie}`);", vers: "const titre = p.titre;", rouge: '[P] une date passee dit ou la periode s arrete' },
  'ferme-comme-creux': { section: 'C', fichier: MODULE_JS, de: "(ouvert[r] && h >= ouvert[r].de && h < ouvert[r].a ? Number((heat[r] || {})[h]) || 0 : null)", vers: "(Number((heat[r] || {})[h]) || 0)", rouge: '[C] un creneau ferme ne se dessine pas' },
  'creux-au-bord': { section: 'C', fichier: MODULE_JS, de: "if (h > ouvert[r].de && h < ouvert[r].a - 1 && (!creux || v < creux.v)) creux = { v, r, h };", vers: "if (!creux || v < creux.v) creux = { v, r, h };", rouge: '[C] le creneau le plus vide n est ni la premiere ni la derniere heure' },
  'cartes-sans-couleur': { section: 'C', fichier: CSS, de: ".plt-carte-corps .plc-chart { color: var(--accent); }\n", vers: "", rouge: '[C] les graphiques des cartes portent la couleur de la marque' },
  'tuile-ecrasee': { section: 'R', fichier: MODULE_JS, de: "      const tuiles = r.tuiles.includes(choisi)\n        ? r.tuiles.map((x) => (x === id ? choisi : x === choisi ? id : x))\n        : r.tuiles.map((x) => (x === id ? choisi : x));\n", vers: "      const tuiles = r.tuiles.map((x) => (x === id ? choisi : x));\n", rouge: '[R] choisir un chiffre deja affiche echange les deux tuiles' },
  'ordre-oublie': { section: 'R', fichier: MODULE_JS, de: "      retenir({ cartes: [...S.cartes.querySelectorAll('.plt-carte')].map((c) => c.dataset.pltCarte) });\n", vers: "", rouge: '[R] une carte deplacee garde sa place' },
  'rien-sur-le-poste': { section: 'R', fichier: MODULE_JS, de: "    if (typeof save === 'function') save();\n", vers: "", rouge: '[R] les reglages reviennent apres un rechargement' },
  'courbe-redessinee': { section: 'V', fichier: MODULE_JS, de: "|${compare.map((x) => x.value).join(',')}`;\n    if (S.peint.courbe !== cle) {", vers: "|${compare.map((x) => x.value).join(',')}`;\n    if (cle) {", rouge: '[V] le rendu de la page ne redessine pas la courbe' },
  'focus-perdu': { section: 'V', fichier: MODULE_JS, de: "    if (dedans && focus.isConnected) focus.focus({ preventScroll: true });\n", vers: "", rouge: '[V] le rendu de la page laisse le focus sur la tuile' },
  'argent-sans-droit': { section: 'D', fichier: MODULE_JS, de: "return ORDRE_STATS.filter((id) => voitLArgent() || !STATS[id].argent);", vers: "return ORDRE_STATS;", rouge: '[D] sans le droit, aucune tuile d argent' },
  'reponse-sans-chiffres': { section: 'E', fichier: MODULE_JS, de: "      if (valide && !valide(reponse)) throw new Error('reponse sans chiffres');\n", vers: "", rouge: '[E] une reponse sans chiffres ne plante pas' },
  'pv-montant-expose': { section: 'S', fichier: LIB, de: "'avgBasket', 'amount', 'absentRevenue'].forEach", vers: "'avgBasket', 'amount'].forEach", rouge: '[S] sans « Voir les montants », plus un euro dans la reponse' },
  'pv-joueurs-faux': { section: 'S', fichier: LIB, de: "absentPax: absents.reduce((s, r) => s + r.pax, 0),", vers: "absentPax: absents.length,", rouge: '[S] les pas venus se comptent en joueurs et en euros' },
  'pv-perdu-faux': { section: 'S', fichier: LIB, de: "absentRevenue: round2(absents.reduce((s, r) => s + r.price, 0)),", vers: "absentRevenue: round2(active.reduce((s, r) => s + r.price, 0)),", rouge: '[S] les pas venus se comptent en joueurs et en euros' },
  'pv-tuile-muette': { section: 'J', fichier: MODULE_JS, de: "absents: div(attendus.filter((r) => r.absentAt).length, attendus.length, 100),", vers: "absents: div(0, attendus.length, 100),", rouge: '[J] la tuile Pas venus compte le groupe du jour' },
  'pv-absent-deux-fois': { section: 'J', fichier: MODULE_JS, de: "      if (res.absentAt) return;\n      const s = seau(res);", vers: "      const s = seau(res);", rouge: '[J] le taux d une heure ne compte pas deux fois le groupe pas venu' },
  'pv-jour-en-jours': { section: 'C', fichier: MODULE_JS, de: "if (attendue()) dessinerPasVenus(phrase, corps, pasVenusDe(reponse.analytics, true));", vers: "if (attendue()) dessinerPasVenus(phrase, corps, pasVenusDe(reponse.analytics, false));", rouge: '[C] Pas venus, journee : huit barres, une par semaine, qui font le total' },
  'pv-chiffre-en-dur': { section: 'C', fichier: MODULE_JS, de: "      [ecrire(pv.joueurs, 'int'), pv.joueurs > 1 ? 'Joueurs' : 'Joueur'],\n", vers: "      [ecrire(n, 'int'), pv.joueurs > 1 ? 'Joueurs' : 'Joueur'],\n", rouge: '[C] Pas venus, journee : groupes, joueurs et montant viennent des dossiers' },
  'pv-phrase-sans-taux': { section: 'C', fichier: MODULE_JS, de: "const taux = pv.taux < 1 ? 'moins de 1 %' : `${Math.round(pv.taux)} %`;", vers: "const taux = '1 %';", rouge: '[C] Pas venus, journee : la phrase dit le vrai nombre et le vrai taux' },
  'pv-sans-periode': { section: 'C', fichier: MODULE_JS, de: "      pasVenus: pasVenusDe(a, false),\n", vers: "      pasVenus: null,\n", rouge: '[C] Pas venus, 30 jours : une barre par jour, les chiffres de la periode' },
  'pv-vide-qui-reste': { section: 'C', fichier: MODULE_JS, de: "      poser(phrase, 'Aucun groupe pas venu sur cette période.', 'carte-p-pasvenus');\n      poser(corps, '', 'carte-c-pasvenus');\n", vers: "      poser(phrase, 'Aucun groupe pas venu sur cette période.', 'carte-p-pasvenus');\n", rouge: '[C] Pas venus : une periode sans absent ne garde pas l ancien graphique' },
  'pv-lecture-en-retard': { section: 'C', fichier: MODULE_JS, de: "    const attendue = () => carte.isConnected && S.pasVenusAttendu === jeton;\n", vers: "    const attendue = () => carte.isConnected;\n", rouge: '[C] une lecture en retard ne repeint pas la periode choisie' },
  'pv-repeinte': { section: 'V', fichier: MODULE_JS, de: "    if (S.peint['carte-c-pasvenus'] === cle && corps.querySelector('.plc-chart')) return;\n", vers: "", rouge: '[V] le rendu de la page ne redessine pas les cartes' },
  'pv-sans-droit': { section: 'D', fichier: MODULE_JS, de: "      ...(montants ? [[ecrire(pv.perdu, 'euro'), n > 1 ? 'Réservations perdues' : 'Réservation perdue']] : []),\n", vers: "      [ecrire(pv.perdu, 'euro'), n > 1 ? 'Réservations perdues' : 'Réservation perdue'],\n", rouge: '[D] Pas venus : sans le droit, deux chiffres et aucun montant' },
  'pv-panne-muette': { section: 'E', fichier: MODULE_JS, de: "      poser(phrase, 'Ces chiffres ne sont pas disponibles pour le moment.', 'carte-p-pasvenus');\n", vers: "", rouge: '[E] Pas venus : une panne se dit, aucun chiffre invente' },
  'pv-pas-par-defaut': { section: 'C', fichier: MODULE_JS, de: "const CARTES_PAR_DEFAUT = ['heures', 'rapporte', 'reserve', 'pasvenus'];", vers: "const CARTES_PAR_DEFAUT = ['heures', 'rapporte', 'reserve'];", rouge: '[C] quatre cartes au depart, dont les pas venus' },
  'pv-tuile-absente': { section: 'J', fichier: MODULE_JS, de: "const TUILES_PAR_DEFAUT = ['ca', 'resa', 'joueurs', 'absents', 'occupation'];", vers: "const TUILES_PAR_DEFAUT = ['ca', 'resa', 'joueurs', 'panier', 'occupation'];", rouge: '[J] cinq chiffres, dans l ordre choisi' },
  'carte-remise-vide': { section: 'R', fichier: MODULE_JS, de: "    delete S.peint[`carte-p-${id}`];\n    delete S.peint[`carte-c-${id}`];\n", vers: "", rouge: '[R] une carte retiree puis remise se repeint' },
  'nom-qui-s-execute': { section: 'E', fichier: MODULE_JS, de: "<span class=\"plt-rang-nom\" title=\"${escapeHtml(l.label)}\">${escapeHtml(l.label)}</span>", vers: "<span class=\"plt-rang-nom\">${l.label}</span>", rouge: '[E] un nom de formule ne s execute pas' },
};

const mutation = CASSE ? MUTATIONS[CASSE] : null;
if (CASSE && !mutation) { console.error(`pilotage-check: contre-preuve inconnue ${CASSE}`); process.exit(2); }
function appliquer(texte) {
  const src = lf(texte);
  if (src.split(mutation.de).length !== 2) { console.error(`pilotage-check: la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois`); process.exit(2); }
  return src.replace(mutation.de, () => mutation.vers);
}
// Le crochet passe AVANT tout require du produit : un module deja charge ne se recompile pas.
if (mutation && /^(lib|api)\//.test(mutation.fichier)) {
  const vise = path.join(ROOT, mutation.fichier);
  const compiler = Module.prototype._compile;
  Module.prototype._compile = function (contenu, fichier) {
    return compiler.call(this, fichier === vise ? appliquer(contenu) : contenu, fichier);
  };
}

const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');
const BANC = require('./pilotage-fixture');
const { reponseDashboard, heuresDePiste } = require('../lib/direction-analytics');
const { excludeSimulationRows } = require('../lib/simulation-filter');

const SEUL = mutation ? mutation.section : (process.env.PILOTAGE_SEUL || '');
const joue = (lettre) => !SEUL || SEUL.includes(lettre);

let echecs = 0;
let reussis = 0;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}${detail ? `  ${detail}` : ''}`); return; }
  echecs += 1;
  console.log(`FAIL  ${label}${detail ? `  ${detail}` : ''}`);
}

const normal = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const somme = (l, f) => l.reduce((s, x) => s + f(x), 0);
const ajouter = BANC.ajouterJours;
const fx = FX.lireFixture('normal');
const JOUR = fx.staffState.date;
const centre = FX.lireCentre().center;
const DU_JOUR = fx.staffState.reservations;
const PIEGE = { id: 900001, name: 'Client piege', phone: '0470999999', email: '', date: ajouter(JOUR, -2), startTime: '15:00', status: 'paid', absentAt: null, channel: 'staff', paymentMethod: 'Carte', occasion: '', centerId: 'libramont', type: 'formule', formuleId: 'banc-piege', label: '<img src=x onerror="window.__xss=1">', pax: 8, lanes: [1], duration: 1, price: 160 };
const history = BANC.historique({ jour: JOUR, center: centre, duJour: [...DU_JOUR, ...Array.from({ length: 9 }, (_, i) => ({ ...PIEGE, id: PIEGE.id + i }))] });
const jusque = (fin) => history.filter((r) => r.date <= fin);

function servi({ debut, fin, cd, cf, voitLesMontants = true }) {
  return reponseDashboard({ history: jusque(fin), startDate: debut, endDate: fin, compareStart: cd, compareEnd: cf, center: centre, voitLesMontants });
}

// ---------------------------------------------------------------------------
// [S] LE CALCUL
// ---------------------------------------------------------------------------
function sectionCalcul() {
  console.log('\n[S] LE CALCUL');
  const fin = JOUR;
  const debut = ajouter(fin, -29);
  const cd = ajouter(debut, -35);
  const cf = ajouter(fin, -35);
  const rep = servi({ debut, fin, cd, cf });
  const a = rep.analytics;
  const propres = excludeSimulationRows(history);
  const lignes = propres.filter((r) => r.date >= debut && r.date <= fin && ['pending', 'arrived', 'paid'].includes(r.status) && !r.absentAt);
  ok(Math.abs(a.totals.revenue - somme(lignes, (r) => r.price)) < 0.01 && a.totals.reservations === lignes.length && a.totals.pax === somme(lignes, (r) => r.pax),
    '[S] les totaux sont ceux des dossiers de la periode', `${a.totals.reservations} dossiers, ${a.totals.revenue} EUR`);
  const enLigne = lignes.filter((r) => r.channel === 'public').length;
  ok(a.totals.online === enLigne, '[S] les reservations en ligne se comptent', `${a.totals.online} / ${enLigne}`);
  const pasVenus = propres.filter((r) => r.date >= debut && r.date <= fin && r.absentAt && ['pending', 'arrived', 'paid'].includes(r.status));
  const absents = pasVenus.length;
  ok(a.totals.absents === absents, '[S] les groupes absents se comptent, hors du chiffre', `${a.totals.absents} / ${absents}`);
  ok(absents > 0 && a.totals.absentPax === somme(pasVenus, (r) => r.pax) && Math.abs(a.totals.absentRevenue - somme(pasVenus, (r) => r.price)) < 0.01,
    '[S] les pas venus se comptent en joueurs et en euros', `${absents} groupes, ${a.totals.absentPax} joueurs, ${a.totals.absentRevenue} EUR`);
  ok(a.daily.length === 30 && a.daily.every((d) => ['count', 'revenue', 'pax', 'cancelled', 'collected', 'online', 'absents', 'laneHours', 'capacity'].every((c) => Number.isFinite(d[c]))),
    '[S] chaque jour porte toutes ses colonnes', Object.keys(a.daily[0]).join(','));
  ok(Math.abs(somme(a.daily, (d) => d.laneHours) - a.occupancy.bookedLaneHours) < 1.6 && Math.abs(somme(a.daily, (d) => d.capacity) - a.occupancy.capacityLaneHours) < 1.6,
    '[S] la somme des jours redonne le remplissage de la periode', `${a.occupancy.bookedLaneHours} / ${a.occupancy.capacityLaneHours}`);
  ok(rep.previous.startDate === cd && rep.previous.endDate === cf && rep.previous.daily.length === 30, '[S] la comparaison choisie est celle qui est servie', `${rep.previous.startDate} au ${rep.previous.endDate}`);
  const recouvre = servi({ debut, fin, cd: ajouter(debut, -3), cf: ajouter(fin, -3) });
  ok(recouvre.previous.endDate === ajouter(debut, -1), '[S] une comparaison qui recouvre la periode est refusee', `${recouvre.previous.startDate} au ${recouvre.previous.endDate}`);
  const saisDeRien = servi({ debut, fin, cd: 'pas-une-date', cf: '' });
  ok(saisDeRien.previous.endDate === ajouter(debut, -1), '[S] une comparaison illisible retombe sur la periode d avant', saisDeRien.previous.startDate);

  const sans = servi({ debut, fin, cd, cf, voitLesMontants: false });
  const euros = [];
  const fouiller = (v, chemin) => {
    if (Array.isArray(v)) v.forEach((x, i) => fouiller(x, `${chemin}[${i}]`));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { if (['revenue', 'collected', 'avgBasket', 'amount', 'absentRevenue'].includes(k) && x !== 0) euros.push(`${chemin}.${k}=${x}`); fouiller(x, `${chemin}.${k}`); });
  };
  fouiller(sans, 'reponse');
  ok(euros.length === 0, '[S] sans « Voir les montants », plus un euro dans la reponse', euros.slice(0, 3).join(' ; ') || 'aucun montant');
  ok(sans.analytics.totals.pax === a.totals.pax && sans.analytics.totals.reservations === a.totals.reservations && sans.analytics.totals.absentPax === a.totals.absentPax, '[S] sans montants, la forme de l activite reste', `${sans.analytics.totals.pax} joueurs, ${sans.analytics.totals.absentPax} pas venus`);
  const brut = JSON.stringify(rep);
  ok(!/Client \d|0470\d{6}|"phone"|"email"|"name"/.test(brut), '[S] aucune identite de client dans la reponse');

  const blocs = (start, end, lanes) => ({ opsPlan: { resourceBlocks: [{ resourceType: 'bowling_lane', start, end, lanes }, { resourceType: 'laser_arena', start: 600, end: 620 }] } });
  ok(heuresDePiste({ lanes: [1], duration: 9, ...blocs(780, 900, [1, 2]) }) === 4, '[S] les heures de piste se lisent sur le plan du dossier', 'plan en minutes');
  ok(heuresDePiste({ lanes: [1], duration: 9, ...blocs(14, 15.5, [3]) }) === 1.5, '[S] un plan en heures se lit aussi', 'plan en heures');
  ok(heuresDePiste({ lanes: [1, 2], duration: 2 }) === 4, '[S] sans plan, pistes fois duree', 'sans plan');
}

// ---------------------------------------------------------------------------
// [H] LE VRAI api/ops.js
// ---------------------------------------------------------------------------
async function sectionHandler() {
  console.log('\n[H] LE VRAI HANDLER');
  const cheminBase = require.resolve('../lib/database');
  const cheminAuth = require.resolve('../lib/staff-auth');
  const vraieBase = require(cheminBase);
  const vraiAuth = require(cheminAuth);
  let session = null;
  require.cache[cheminBase].exports = new Proxy(vraieBase, {
    get(cible, cle) {
      if (cle === 'readAdminRangeState') return async (debut, fin) => ({ reservations: jusque(fin) });
      return cible[cle];
    },
  });
  require.cache[cheminAuth].exports = new Proxy(vraiAuth, {
    get(cible, cle) { return cle === 'requireStaffPermission' ? async () => session : cible[cle]; },
  });
  const handler = require('../api/ops');
  const appeler = async (permissions, q) => {
    session = { centerId: 'libramont', scope: 'center', expiresAt: new Date(Date.now() + 864e5).toISOString(), member: { id: 'libramont:banc', name: 'Banc', roleId: 'banc' }, role: { id: 'banc', name: 'Banc', locked: false }, permissions };
    const fin = { statut: 0, corps: '' };
    const res = { statusCode: 200, setHeader() {}, getHeader() {}, end(x) { fin.statut = this.statusCode; fin.corps = String(x || ''); } };
    await handler({ method: 'GET', url: `/api/ops?action=dashboardAnalytics&centerId=libramont&${q}`, headers: { host: 'localhost' } }, res);
    return { statut: fin.statut, json: JSON.parse(fin.corps || '{}') };
  };
  const fin = JOUR;
  const debut = ajouter(fin, -6);
  const q = `startDate=${debut}&endDate=${fin}&compareStart=${ajouter(debut, -7)}&compareEnd=${ajouter(fin, -7)}`;
  const sans = await appeler(['dashboard.view'], q);
  ok(sans.statut === 200 && sans.json.analytics.totals.revenue === 0 && sans.json.analytics.daily.every((d) => d.revenue === 0) && sans.json.analytics.totals.pax > 0,
    '[H] le vrai handler retire les montants a qui ne peut pas les voir', `${sans.statut}, ${sans.json.analytics && sans.json.analytics.totals.revenue} EUR, ${sans.json.analytics && sans.json.analytics.totals.pax} joueurs`);
  const avec = await appeler(['dashboard.view', 'payments.view'], q);
  ok(avec.statut === 200 && avec.json.analytics.totals.revenue > 0, '[H] ... et les laisse a qui les voit', `${avec.json.analytics && avec.json.analytics.totals.revenue} EUR`);
  ok(avec.json.previous && avec.json.previous.startDate === ajouter(debut, -7), '[H] la fenetre de comparaison passe par la requete', avec.json.previous && avec.json.previous.startDate);
  // Sept jours du banc sans aucun absent : trente, pour que ce controle ait de la matiere.
  const trente = `startDate=${ajouter(fin, -29)}&endDate=${fin}`;
  const sansPv = await appeler(['dashboard.view'], trente);
  const avecPv = await appeler(['dashboard.view', 'payments.view'], trente);
  ok(sansPv.json.analytics.totals.absentRevenue === 0 && sansPv.json.analytics.totals.absentPax > 0 && avecPv.json.analytics.totals.absentRevenue > 0,
    '[H] le vrai handler retire le montant des pas venus a qui ne peut pas le voir', `${sansPv.json.analytics.totals.absentRevenue} / ${avecPv.json.analytics.totals.absentRevenue} EUR`);
}

// ---------------------------------------------------------------------------
// LA PAGE
// ---------------------------------------------------------------------------
async function ouvrir(browser, { theme = 'light', appareil = 'ordinateur', voitLesMontants = true, intercepter = null } = {}) {
  const journal = [];
  const base = BANC.lecteur({ history, center: centre, voitLesMontants, journal });
  const lecture = (chemin) => (intercepter && intercepter(chemin)) || base(chemin);
  const { ctx, page, erreurs } = await FX.monter(browser, { fixture: 'normal', appareil, theme, port: PORT, heure: '15:10', avantChargement: (p) => p.exposeFunction('__fixtureLecture', lecture) });
  await page.evaluate(() => { location.hash = '#/staff/dashboard'; });
  await page.waitForSelector('.plt-panneau');
  await FX.repos(page, 800);
  await page.evaluate(() => {
    const m = window.PinlaneCharts;
    const b = m.barChart;
    const t = m.trendChart;
    m.barChart = (h, o) => { if (h.matches && h.matches('[data-plt-courbe]')) window.__bar = o; return b(h, o); };
    m.trendChart = (h, o) => { window.__trend = o; return t(h, o); };
  });
  return { ctx, page, erreurs, journal };
}

const lireTuiles = (page) => page.evaluate(() => [...document.querySelectorAll('[data-plt-tuile]')].map((t) => {
  const n = (s) => { const e = t.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
  return { id: t.dataset.pltTuile, valeur: n('.dash-kpi-value'), delta: n('.dash-kpi-delta'), on: t.classList.contains('is-on') };
}));
const tuile = (liste, id) => liste.find((t) => t.id === id) || {};
const phrase = async (page) => normal(await page.locator('.plt-panneau [data-plt-phrase]').textContent());
const phraseCarte = async (page, id) => normal(await page.locator(`.plt-carte[data-plt-carte="${id}"] [data-plt-carte-phrase]`).textContent());
const lireCartePv = (page) => page.evaluate(() => {
  const c = document.querySelector('.plt-carte[data-plt-carte="pasvenus"]');
  const net = (s) => s.replace(/\s+/g, ' ').trim();
  return {
    nom: net(c.querySelector('.plt-carte-nom').textContent),
    meta: net(c.querySelector('[data-plt-carte-meta]').textContent),
    chiffres: [...c.querySelectorAll('.plt-pv-chiffres li')].map((li) => [...li.children].map((n) => net(n.textContent)).join(' ')),
    barres: [...c.querySelectorAll('.plc-bar title')].map((t) => net(t.textContent)),
  };
});
const argent = async (page, v) => normal(await page.evaluate((x) => formatMoney(x), Math.round(v)));
const entier = (v) => normal(new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 }).format(Math.round(v)));
const deltaPct = (v, ref) => { const p = Math.round(((v - ref) / ref) * 100); return `${p > 0 ? '+' : ''}${p}%`; };
const periode = async (page, id) => { await page.locator(`[data-plt-periode="${id}"]`).click(); await FX.repos(page, 700); };
const toucher = async (page, id) => { await page.locator(`[data-plt-tuile="${id}"]`).click(); await FX.repos(page, 450); };

async function sectionJournee(browser) {
  console.log('\n[J] LA JOURNEE');
  const { ctx, page, erreurs } = await ouvrir(browser);
  const actives = DU_JOUR.filter((r) => r.status !== 'cancelled');
  const ca = somme(actives, (r) => r.price);
  const joueurs = somme(actives, (r) => r.pax);
  const refs = BANC.serieDesJours(history, JOUR, 14).find((d) => d.date === ajouter(JOUR, -7));
  let t = await lireTuiles(page);
  ok(t.map((x) => x.id).join() === 'ca,resa,joueurs,absents,occupation', '[J] cinq chiffres, dans l ordre choisi', t.map((x) => x.id).join());
  ok(await page.locator('[data-plt-tuile="absents"] .dash-kpi-label').textContent() === 'Pas venus', '[J] la tuile s appelle Pas venus');
  ok(tuile(t, 'ca').valeur === await argent(page, ca), '[J] le chiffre d affaires est celui des dossiers du jour', `${tuile(t, 'ca').valeur}`);
  ok(tuile(t, 'resa').valeur === String(actives.length) && tuile(t, 'joueurs').valeur === String(joueurs), '[J] reservations et joueurs aussi', `${tuile(t, 'resa').valeur} / ${tuile(t, 'joueurs').valeur}`);
  // Le panier n est plus une tuile de depart : on le pose a l ecran pour le lire.
  await page.evaluate(() => { state.dashPilotage.tuiles = ['ca', 'resa', 'joueurs', 'panier', 'occupation']; PinlanePilotage.rafraichir(); });
  await FX.repos(page, 150);
  const panierLu = tuile(await lireTuiles(page), 'panier').valeur;
  ok(panierLu === normal(`${(ca / joueurs).toFixed(2).replace('.', ',')} €`), '[J] le panier est le chiffre divise par les joueurs', panierLu);
  ok(tuile(t, 'ca').delta === deltaPct(ca, refs.revenue) && tuile(t, 'joueurs').delta === deltaPct(joueurs, refs.players), '[J] l ecart se compare au meme jour de la semaine d avant', `${tuile(t, 'ca').delta} / ${tuile(t, 'joueurs').delta}`);
  ok(tuile(t, 'joueurs').on && normal(await page.locator('.plt-nom-courbe').textContent()) === 'Arrivées par heure', '[J] le jour s ouvre sur les arrivees par heure');
  const pic = await page.evaluate(() => {
    const m = getStaffDashboardMetrics(todaysReservations());
    const debut = Math.floor(m.planningWindow.open);
    const parHeure = new Map();
    m.activeReservations.forEach((r) => { const h = Math.max(debut, Math.floor(getStaffTerrainSpan(r).start)); parHeure.set(h, (parHeure.get(h) || 0) + (Number(r.pax) || 0)); });
    const [h, n] = [...parHeure.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    return `Votre pic est à ${formatClockDisplay(h)}, avec ${n} joueurs.`;
  });
  ok(await phrase(page) === normal(pic), '[J] la phrase dit la vraie heure de pointe', await phrase(page));

  await toucher(page, 'ca');
  const bar = await page.evaluate(() => window.__bar);
  ok(bar && Math.abs(somme(bar.series, (p) => p.value) - ca) < 0.01 && bar.format === 'euro', '[J] toucher une tuile change le graphique, et les barres font le total', bar ? `${somme(bar.series, (p) => p.value)} EUR` : 'aucun');
  t = await lireTuiles(page);
  ok(tuile(t, 'ca').on && !tuile(t, 'joueurs').on, '[J] la tuile touchee se soude au graphique');
  await toucher(page, 'occupation');
  const o = await page.evaluate(() => ({ s: window.__bar.series.map((p) => p.value), occ: getStaffDashboardMetrics(todaysReservations()).occupancy }));
  const moyenne = somme(o.s, (v) => v) / o.s.length;
  ok(Math.abs(moyenne - o.occ) <= 2, '[J] les pistes occupees par heure redonnent le remplissage du jour', `moyenne ${moyenne.toFixed(1)} pour ${o.occ}`);
  ok(normal(await page.locator('.plt-nom-courbe').textContent()) === 'Pistes occupées par heure', '[J] le graphique dit ce qu il montre');

  // Une annulee n est pas dans la liste du jour : la tuile doit la voir quand meme.
  await page.evaluate(() => {
    state.reservations.push({ ...state.reservations.find((r) => r.status !== 'cancelled'), id: 777001, status: 'cancelled' });
    const r = state.dashPilotage;
    r.tuiles = ['annulations', 'resa', 'joueurs', 'panier', 'occupation'];
    renderStaffDashboard();
  });
  await FX.repos(page, 300);
  t = await lireTuiles(page);
  ok(tuile(t, 'annulations').valeur === `${Math.round((1 / (DU_JOUR.length + 1)) * 100)}%`, '[J] la tuile Annulations compte les annulees du jour', tuile(t, 'annulations').valeur);

  // Un groupe note « Pas venu » : sa tuile le dit, et son heure ne le divise pas deux fois.
  await page.evaluate(() => {
    const modele = state.reservations.find((r) => r.date === state.currentDate && r.status !== 'cancelled');
    state.reservations.push({ ...modele, id: 777002, status: 'pending', absentAt: `${state.currentDate}T14:00:00.000Z` });
    const r = state.dashPilotage;
    r.tuiles = ['absents', 'resa', 'joueurs', 'ca', 'occupation'];
    r.active = 'absents';
    renderStaffDashboard();
  });
  await FX.repos(page, 300);
  t = await lireTuiles(page);
  ok(tuile(t, 'absents').valeur === `${Math.round((1 / (actives.length + 1)) * 100)}%`, '[J] la tuile Pas venus compte le groupe du jour', tuile(t, 'absents').valeur);
  const heure = await page.evaluate(() => {
    const m = getStaffDashboardMetrics(todaysReservations());
    const debut = Math.floor(m.planningWindow.open);
    const fin = Math.ceil(m.planningWindow.close);
    const seau = (r) => Math.min(Math.max(Math.floor(getStaffTerrainSpan(r).start), debut), fin - 1);
    const pasVenu = state.reservations.find((r) => r.id === 777002);
    const memeHeure = state.reservations.filter((r) => r.date === state.currentDate && r.status !== 'cancelled' && seau(r) === seau(pasVenu)).length;
    return { attendu: 100 / memeHeure, lu: Math.max(...window.__bar.series.map((p) => p.value)) };
  });
  ok(Math.abs(heure.lu - heure.attendu) < 0.01, '[J] le taux d une heure ne compte pas deux fois le groupe pas venu', JSON.stringify(heure));

  const cta = await page.evaluate(() => {
    const b = document.querySelector('.dash-alerts .dash-alert-cta');
    const fond = getComputedStyle(b).backgroundColor;
    const temoin = document.createElement('i');
    temoin.style.color = 'var(--text)';
    document.body.appendChild(temoin);
    const encre = getComputedStyle(temoin).color;
    temoin.remove();
    return { fond, encre };
  });
  ok(cta.fond === cta.encre, '[J] le premier bouton de « À traiter » reste le bouton principal', `${cta.fond} / ${cta.encre}`);
  const ordre = await page.evaluate(() => [...document.getElementById('staffDashboardPage').children].map((n) => n.className.split(' ').filter((c) => /dash-hello|dash-now|plt-/.test(c))[0] || n.className));
  ok(ordre.join() === 'dash-hello,dash-now,plt-traiter,plt-slot-tete,plt-slot-panneau,plt-slot-cartes', '[J] ce qui attend d abord, les chiffres ensuite', ordre.join());
  ok(erreurs.length === 0, '[J] aucune erreur JavaScript', erreurs.join(' | '));
  await ctx.close();
}

async function sectionPeriodes(browser) {
  console.log('\n[P] LES PERIODES');
  const { ctx, page, erreurs, journal } = await ouvrir(browser);
  const cas = [
    { id: '7j', titre: 'Les 7 derniers jours', debut: ajouter(JOUR, -6), recul: 7, avant: 'les 7 jours d’avant' },
    { id: '30j', titre: 'Les 30 derniers jours', debut: ajouter(JOUR, -29), recul: 35, avant: 'les mêmes jours, 5 semaines plus tôt' },
    { id: 'mois', titre: 'Ce mois-ci', debut: `${JOUR.slice(0, 8)}01`, recul: 28, avant: 'le mois d’avant' },
  ];
  const nomLabel = { '7j': '7 jours', '30j': '30 jours', mois: 'ce mois' };
  for (const c of cas) {
    await periode(page, c.id);
    const cd = ajouter(c.debut, -c.recul);
    const cf = ajouter(JOUR, -c.recul);
    const rep = servi({ debut: c.debut, fin: JOUR, cd, cf });
    const a = rep.analytics;
    const p = rep.previous;
    const url = journal.find((l) => l.includes(`startDate=${c.debut}&endDate=${JOUR}&compareStart=${cd}&compareEnd=${cf}`));
    ok(Boolean(url), `[P] ${nomLabel[c.id]} : la bonne periode et la bonne comparaison sont demandees`, `${c.debut} / ${cd}`);
    if (c.id === '30j') {
      const jour = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
      ok(url && /compareStart=([\d-]+)/.test(url) && jour(/compareStart=([\d-]+)/.exec(url)[1]) === jour(c.debut) && /compareEnd=([\d-]+)/.exec(url)[1] < c.debut, '[P] 30 jours : jour de semaine contre jour de semaine', url && /compareStart=([\d-]+)/.exec(url)[1]);
    }
    const t = await lireTuiles(page);
    ok(normal(await page.locator('[data-plt-titre]').textContent()) === c.titre, `[P] ${nomLabel[c.id]} : le titre`, c.titre);
    ok(tuile(t, 'ca').valeur === await argent(page, a.totals.revenue) && tuile(t, 'resa').valeur === entier(a.totals.reservations) && tuile(t, 'joueurs').valeur === entier(a.totals.pax),
      `[P] ${nomLabel[c.id]} : les tuiles disent les chiffres du serveur`, `${tuile(t, 'ca').valeur}, ${tuile(t, 'resa').valeur}, ${tuile(t, 'joueurs').valeur}`);
    ok(tuile(t, 'ca').delta === deltaPct(a.totals.revenue, p.totals.revenue), `[P] ${nomLabel[c.id]} : l ecart est le bon`, tuile(t, 'ca').delta);
    const pctTexte = Math.abs(Math.round(((a.totals.revenue - p.totals.revenue) / p.totals.revenue) * 100));
    const sens = a.totals.revenue >= p.totals.revenue ? 'plus' : 'moins';
    const meilleur = [...a.daily].sort((x, y) => y.revenue - x.revenue)[0];
    const texteJour = await page.evaluate((d) => parseLocalDate(d).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' }), meilleur.date);
    const attendue = normal(`${pctTexte} % de ${sens} que ${c.avant}. Le meilleur jour est ${texteJour}, avec ${await argent(page, meilleur.revenue)}.`);
    ok(await phrase(page) === attendue, `[P] ${nomLabel[c.id]} : la phrase dit le vrai ecart et le vrai meilleur jour`, await phrase(page));
    ok(await page.locator('[data-pl-num^="dash."]').count() === 0, c.id === '7j' ? '[P] changer de periode ne fait pas grimper les chiffres' : `[P] ${nomLabel[c.id]} : pas de compteur`);
    const tr = await page.evaluate(() => window.__trend);
    ok(tr && tr.series.length === a.daily.length && tr.compare.length === a.daily.length, `[P] ${nomLabel[c.id]} : la courbe et sa comparaison ont autant de jours`, tr && `${tr.series.length} / ${tr.compare.length}`);
  }

  // L infobulle.
  await periode(page, '30j');
  await page.locator('[data-plt-tuile="ca"]').click();
  await FX.repos(page, 500);
  const svg = await page.locator('[data-plt-courbe] .plc-svg').boundingBox();
  await page.mouse.move(svg.x + svg.width - 16, svg.y + svg.height / 2);
  await page.waitForTimeout(120);
  const bulle = normal(await page.locator('[data-plt-courbe] .plc-tip').textContent());
  ok(/mercredi 13 janvier/.test(bulle) && /mercredi 9 décembre/.test(bulle), '[P] l infobulle dit le jour et le meme jour de la comparaison', bulle);
  await page.mouse.move(2, 2);

  // Un taux : les jours fermes ne cassent pas la ligne.
  await toucher(page, 'occupation');
  const occ = await page.evaluate(() => ({ d: document.querySelector('[data-plt-courbe] .plc-trend-line').getAttribute('d'), nuls: window.__trend.series.filter((p) => p.value === null).length, cmp: document.querySelector('[data-plt-courbe] .plc-trend-compare').getAttribute('d') }));
  ok(occ.nuls > 0 && (occ.d.match(/M/g) || []).length === 1 && (occ.cmp.match(/M/g) || []).length === 1, '[P] un taux passe par-dessus les jours fermes', `${occ.nuls} jours sans valeur, ${(occ.d.match(/M/g) || []).length} trait`);

  // Une date passee.
  await page.evaluate((d) => { state.currentDate = d; renderStaffDashboard(); }, ajouter(JOUR, -5));
  await FX.repos(page, 700);
  ok(normal(await page.locator('[data-plt-titre]').textContent()) === '30 jours jusqu’au 8 janvier', '[P] une date passee dit ou la periode s arrete', normal(await page.locator('[data-plt-titre]').textContent()));
  await page.evaluate((d) => { state.currentDate = d; renderStaffDashboard(); }, ajouter(JOUR, 3));
  await FX.repos(page, 700);
  ok(normal(await page.locator('[data-plt-titre]').textContent()) === 'Les 30 derniers jours', '[P] une date a venir garde la periode qui finit aujourd hui');
  ok(erreurs.length === 0, '[P] aucune erreur JavaScript', erreurs.join(' | '));
  await ctx.close();
}

async function sectionCartes(browser) {
  console.log('\n[C] LES CARTES');
  const { ctx, page, erreurs } = await ouvrir(browser);
  ok((await page.locator('.plt-carte').evaluateAll((l) => l.map((c) => c.dataset.pltCarte))).join() === 'heures,rapporte,reserve,pasvenus', '[C] quatre cartes au depart, dont les pas venus');
  const fin = JOUR;
  const huit = servi({ debut: ajouter(fin, -55), fin });
  const heat = huit.analytics.heatmap;
  const noms = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  const horaires = [1, 2, 3, 4, 5, 6, 0].map((js) => { const h = centre.defaultSchedule.regular[String(js)]; return h ? { de: Number(h.open.slice(0, 2)), a: Number(h.close.slice(0, 2)) } : null; });
  let creux = null;
  let plein = null;
  horaires.forEach((o, r) => {
    if (!o) return;
    for (let h = o.de; h < o.a; h += 1) {
      const v = Number(heat[r][h]) || 0;
      if (h > o.de && h < o.a - 1 && (!creux || v < creux.v)) creux = { v, r, h };
      if (!plein || v > plein.v) plein = { v, r, h };
    }
  });
  const texte = await phraseCarte(page, 'heures');
  ok(texte === normal(`${noms[creux.r]} à ${creux.h} h est votre créneau le plus vide. ${noms[plein.r]} à ${plein.h} h est le plus plein.`), '[C] les heures creuses disent le vrai creneau', texte);
  const colonnes = 14;
  const fermes = somme(horaires, (o) => (o ? colonnes - (o.a - o.de) : colonnes));
  const lu = await page.evaluate(() => ({ fermes: document.querySelectorAll('.plt-carte[data-plt-carte="heures"] .plc-heat-ferme').length, cellules: document.querySelectorAll('.plt-carte[data-plt-carte="heures"] .plc-heat-cell').length }));
  ok(lu.fermes === fermes && lu.cellules === 7 * colonnes - fermes, '[C] un creneau ferme ne se dessine pas', `${lu.fermes} fermes, ${lu.cellules} ouverts`);
  const debutRes = JOUR;
  const serie = BANC.serieDesJours(history, ajouter(debutRes, 13), 14);
  const total = somme(serie, (d) => d.revenue);
  const reserve = await phraseCarte(page, 'reserve');
  ok(reserve.startsWith(normal(`${await argent(page, total)} déjà réservés sur les 14 prochains jours.`)), '[C] « Déjà réservé » dit ce qui est dans le carnet', reserve);
  const rapporte = await phraseCarte(page, 'rapporte');
  ok(/^Formules fait \d+ % de votre chiffre\.$/.test(rapporte), '[C] « Ce qui rapporte » nomme l activite en tete', rapporte);
  const couleur = await page.evaluate(() => {
    const temoin = document.createElement('i');
    temoin.style.color = 'var(--accent)';
    document.body.appendChild(temoin);
    const bleu = getComputedStyle(temoin).color;
    temoin.remove();
    return { bleu, heat: getComputedStyle(document.querySelector('.plt-carte .plc-heatmap')).color, bar: getComputedStyle(document.querySelector('.plt-carte[data-plt-carte="reserve"] .plc-chart')).color };
  });
  ok(couleur.heat === couleur.bleu && couleur.bar === couleur.bleu, '[C] les graphiques des cartes portent la couleur de la marque', JSON.stringify(couleur));
  // La carte Pas venus, relue a l ecran et recomptee a la main sur les dossiers du banc.
  const propres = excludeSimulationRows(history);
  const pvAttendu = (de, a) => {
    const lignes = propres.filter((r) => r.date >= de && r.date <= a && ['pending', 'arrived', 'paid'].includes(r.status));
    const absents = lignes.filter((r) => r.absentAt);
    return { n: absents.length, joueurs: somme(absents, (r) => r.pax), perdu: somme(absents, (r) => r.price), taux: lignes.length ? (absents.length / lignes.length) * 100 : 0 };
  };
  const phrasePv = (x) => `${x.n} groupes ne sont pas venus, soit ${x.taux < 1 ? 'moins de 1 %' : `${Math.round(x.taux)} %`} de vos réservations.`;
  const chiffresPv = async (x) => `${entier(x.n)} Groupes | ${entier(x.joueurs)} Joueurs | ${await argent(page, x.perdu)} Réservations perdues`;
  const valeurBarre = (titre) => Number(titre.split(' : ').pop());
  const huitPv = pvAttendu(ajouter(fin, -55), fin);
  let pv = await lireCartePv(page);
  ok(huitPv.n > 0 && pv.nom === 'Pas venus (no-show)' && pv.meta === '8 dernières semaines', '[C] Pas venus, journee : la carte dit ce qu elle couvre', JSON.stringify({ nom: pv.nom, meta: pv.meta, groupes: huitPv.n }));
  ok(await phraseCarte(page, 'pasvenus') === phrasePv(huitPv), '[C] Pas venus, journee : la phrase dit le vrai nombre et le vrai taux', await phraseCarte(page, 'pasvenus'));
  const parSemaine = Array.from({ length: 8 }, (_, i) => pvAttendu(ajouter(fin, -7 * (7 - i) - 6), ajouter(fin, -7 * (7 - i))).n);
  ok(pv.barres.map(valeurBarre).join() === parSemaine.join() && somme(parSemaine, (v) => v) === huitPv.n, '[C] Pas venus, journee : huit barres, une par semaine, qui font le total', `${pv.barres.join(' | ')} / ${parSemaine.join()}`);
  ok(pv.chiffres.join(' | ') === await chiffresPv(huitPv), '[C] Pas venus, journee : groupes, joueurs et montant viennent des dossiers', pv.chiffres.join(' | '));
  // Huit semaines ne changent pas avec la periode : la carte ne se redessine pas.
  await page.evaluate(() => { document.querySelector('.plt-carte[data-plt-carte="heures"] .plc-chart').__temoin = 1; });
  await periode(page, '30j');
  ok(await page.evaluate(() => document.querySelector('.plt-carte[data-plt-carte="heures"] .plc-chart').__temoin === 1), '[C] changer de periode ne redessine pas les heures creuses');
  const trentePv = pvAttendu(ajouter(fin, -29), fin);
  pv = await lireCartePv(page);
  ok(trentePv.n > 0 && pv.meta === '' && pv.barres.length === 30 && somme(pv.barres, valeurBarre) === trentePv.n && pv.chiffres.join(' | ') === await chiffresPv(trentePv) && await phraseCarte(page, 'pasvenus') === phrasePv(trentePv),
    '[C] Pas venus, 30 jours : une barre par jour, les chiffres de la periode', `${pv.barres.length} barres, ${pv.chiffres.join(' | ')}, ${await phraseCarte(page, 'pasvenus')}`);
  await periode(page, '7j');
  const septPv = pvAttendu(ajouter(fin, -6), fin);
  pv = await lireCartePv(page);
  ok(septPv.n === 0 && await phraseCarte(page, 'pasvenus') === 'Aucun groupe pas venu sur cette période.' && pv.barres.length === 0 && pv.chiffres.length === 0,
    '[C] Pas venus : une periode sans absent ne garde pas l ancien graphique', `${septPv.n} absents, ${await phraseCarte(page, 'pasvenus')}, ${pv.barres.length} barres`);
  ok(erreurs.length === 0, '[C] aucune erreur JavaScript', erreurs.join(' | '));
  await ctx.close();

  // La journee lit huit semaines : si le gerant choisit une periode avant la reponse, elle ne
  // doit pas ecraser ce qu il regarde.
  let relacher = null;
  const servir = BANC.lecteur({ history, center: centre });
  const lente = await ouvrir(browser, {
    intercepter: (chemin) => {
      if (!chemin.includes('dashboardAnalytics') || !chemin.includes(`startDate=${ajouter(fin, -55)}`)) return null;
      return new Promise((rendre) => { relacher = () => rendre(servir(chemin)); });
    },
  });
  await periode(lente.page, '30j');
  const preteALire = typeof relacher === 'function';
  if (preteALire) relacher();
  await FX.repos(lente.page, 400);
  const tard = await lireCartePv(lente.page);
  ok(preteALire && tard.meta === '' && tard.barres.length === 30, '[C] une lecture en retard ne repeint pas la periode choisie', JSON.stringify({ preteALire, meta: tard.meta, barres: tard.barres.length }));
  await lente.ctx.close();

  // La premiere et la derniere heure d un jour sont vides par nature : on ne les conseille pas.
  const base = BANC.lecteur({ history, center: centre });
  const bord = await ouvrir(browser, {
    intercepter: (chemin) => {
      if (!chemin.includes('dashboardAnalytics')) return null;
      const rep = base(chemin);
      rep.analytics.heatmap = horaires.map((o) => { const l = {}; if (o) for (let h = o.de; h < o.a; h += 1) l[h] = 5; return l; });
      rep.analytics.heatmap[1][14] = 0;
      rep.analytics.heatmap[1][21] = 0;
      rep.analytics.heatmap[3][16] = 1;
      return rep;
    },
  });
  const conseil = await phraseCarte(bord.page, 'heures');
  ok(conseil.startsWith('Jeudi à 16 h est votre créneau le plus vide.'), '[C] le creneau le plus vide n est ni la premiere ni la derniere heure', conseil);
  await bord.ctx.close();
}

async function sectionReglages(browser) {
  console.log('\n[R] LES REGLAGES');
  const { ctx, page, erreurs } = await ouvrir(browser);
  await page.locator('[data-plt-modifier]').click();
  await FX.repos(page, 300);
  ok(normal(await page.locator('[data-plt-modifier]').textContent()) === 'Terminé', '[R] « Modifier » devient « Terminé »');
  ok(await page.locator('.plt-changer').count() === 5 && await page.locator('[data-plt-poignee]:visible').count() === 4 && await page.locator('[data-plt-retirer]:visible').count() === 4, '[R] chaque tuile se change, chaque carte se deplace et se retire');
  await page.locator('[data-plt-tuile="absents"]').click();
  await FX.repos(page, 200);
  ok(await page.locator('.plt-choix [data-plt-choix]').count() === 11, '[R] la tuile propose les onze chiffres');
  await page.locator('[data-plt-choix="enLigne"]').click();
  await FX.repos(page, 400);
  let t = await lireTuiles(page);
  ok(t.map((x) => x.id).join() === 'ca,resa,joueurs,enLigne,occupation', '[R] changer une tuile la remplace a sa place', t.map((x) => x.id).join());
  await page.locator('[data-plt-tuile="enLigne"]').click();
  await FX.repos(page, 200);
  await page.locator('[data-plt-choix="ca"]').click();
  await FX.repos(page, 400);
  t = await lireTuiles(page);
  ok(t.map((x) => x.id).join() === 'enLigne,resa,joueurs,ca,occupation', '[R] choisir un chiffre deja affiche echange les deux tuiles', t.map((x) => x.id).join());
  await page.locator('[data-plt-retirer="rapporte"]').click();
  await FX.repos(page, 300);
  ok((await page.locator('.plt-carte').evaluateAll((l) => l.map((c) => c.dataset.pltCarte))).join() === 'heures,reserve,pasvenus', '[R] une carte se retire');
  await page.locator('[data-plt-ajouter]').click();
  await FX.repos(page, 200);
  ok(await page.locator('.plt-choix [data-plt-choix]').count() === 6, '[R] « Ajouter » propose les cartes absentes');
  await page.locator('[data-plt-choix="clients"]').click();
  await FX.repos(page, 400);
  ok((await page.locator('.plt-carte').evaluateAll((l) => l.map((c) => c.dataset.pltCarte))).join() === 'heures,reserve,pasvenus,clients', '[R] une carte s ajoute a la fin');
  // Deplacer la premiere carte juste apres la troisieme, la derniere de sa rangee.
  const poignee = await page.locator('.plt-carte[data-plt-carte="heures"] [data-plt-poignee]').boundingBox();
  const cible = await page.locator('.plt-carte[data-plt-carte="pasvenus"]').boundingBox();
  await page.mouse.move(poignee.x + poignee.width / 2, poignee.y + poignee.height / 2);
  await page.mouse.down();
  await page.mouse.move(cible.x + cible.width * 0.8, cible.y + cible.height / 2, { steps: 8 });
  await page.mouse.up();
  await FX.repos(page, 400);
  const apres = await page.locator('.plt-carte').evaluateAll((l) => l.map((c) => c.dataset.pltCarte));
  const retenu = await page.evaluate(() => (state.dashPilotage.cartes || []).join());
  ok(apres.join() === 'reserve,pasvenus,heures,clients' && retenu === apres.join(), '[R] une carte deplacee garde sa place', `${apres.join()} / ${retenu}`);
  ok(await page.locator('.plt-trou').count() === 0 && await page.locator('.is-deplacee').count() === 0, '[R] le deplacement ne laisse aucune trace');
  await page.locator('[data-plt-modifier]').click();
  await FX.repos(page, 300);
  ok(await page.locator('[data-plt-poignee]:visible').count() === 0 && await page.locator('.plt-changer').count() === 0 && await page.locator('[data-plt-ajouter]').count() === 0, '[R] « Terminé » range les outils');
  await periode(page, '7j');
  await toucher(page, 'occupation');
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__fixturePrete === true, null, { timeout: 60000 });
  await page.evaluate(() => { location.hash = '#/staff/dashboard'; });
  await page.waitForSelector('.plt-panneau');
  await FX.repos(page, 900);
  t = await lireTuiles(page);
  const carnet = await page.locator('.plt-carte').evaluateAll((l) => l.map((c) => c.dataset.pltCarte));
  const titre = normal(await page.locator('[data-plt-titre]').textContent());
  ok(titre === 'Les 7 derniers jours' && t.map((x) => x.id).join() === 'enLigne,resa,joueurs,ca,occupation' && tuile(t, 'occupation').on && carnet.join() === 'reserve,pasvenus,heures,clients', '[R] les reglages reviennent apres un rechargement', `${titre} ; ${t.map((x) => x.id).join()} ; ${carnet.join()}`);

  // Une carte retiree puis remise est un noeud neuf : elle doit se repeindre en entier.
  await periode(page, '30j');
  await page.locator('[data-plt-modifier]').click();
  await FX.repos(page, 200);
  const phraseAvant = await phraseCarte(page, 'pasvenus');
  await page.locator('[data-plt-retirer="pasvenus"]').click();
  await FX.repos(page, 200);
  await page.locator('[data-plt-ajouter]').click();
  await FX.repos(page, 200);
  await page.locator('[data-plt-choix="pasvenus"]').click();
  await FX.repos(page, 400);
  const remise = await lireCartePv(page);
  ok(phraseAvant.length > 0 && await phraseCarte(page, 'pasvenus') === phraseAvant && remise.barres.length === 30 && remise.chiffres.length === 3, '[R] une carte retiree puis remise se repeint', `${await phraseCarte(page, 'pasvenus')} ; ${remise.barres.length} barres`);
  ok(erreurs.length === 0, '[R] aucune erreur JavaScript', erreurs.join(' | '));
  await ctx.close();
}

async function sectionDirect(browser) {
  console.log('\n[V] LE DIRECT');
  const { ctx, page, erreurs } = await ouvrir(browser);
  await periode(page, '30j');
  await page.evaluate(() => {
    document.querySelector('.plt-panneau').__temoin = 1;
    document.querySelector('[data-plt-courbe] .plc-chart').__temoin = 1;
    document.querySelector('[data-plt-tuile="resa"]').__temoin = 1;
    document.querySelector('.plt-carte[data-plt-carte="reserve"] .plc-chart').__temoin = 1;
    document.querySelector('.plt-carte[data-plt-carte="pasvenus"] .plc-chart').__temoin = 1;
  });
  await page.locator('[data-plt-tuile="resa"]').focus();
  await page.evaluate(() => { renderStaffDashboard(); renderStaffDashboard(); });
  await FX.repos(page, 300);
  const lu = await page.evaluate(() => ({
    panneau: document.querySelector('.plt-panneau').__temoin === 1,
    courbe: document.querySelector('[data-plt-courbe] .plc-chart').__temoin === 1,
    tuile: document.querySelector('[data-plt-tuile="resa"]').__temoin === 1,
    carte: document.querySelector('.plt-carte[data-plt-carte="reserve"] .plc-chart').__temoin === 1 && document.querySelector('.plt-carte[data-plt-carte="pasvenus"] .plc-chart').__temoin === 1,
    focus: document.activeElement && document.activeElement.dataset && document.activeElement.dataset.pltTuile,
  }));
  ok(lu.panneau && lu.tuile, '[V] le rendu de la page garde le panneau et ses tuiles', JSON.stringify(lu));
  ok(lu.courbe, '[V] le rendu de la page ne redessine pas la courbe');
  ok(lu.carte, '[V] le rendu de la page ne redessine pas les cartes');
  ok(lu.focus === 'resa', '[V] le rendu de la page laisse le focus sur la tuile', String(lu.focus));
  await page.locator('[data-plt-modifier]').click();
  await FX.repos(page, 200);
  await page.locator('[data-plt-tuile="joueurs"]').click();
  await FX.repos(page, 200);
  await page.evaluate(() => renderStaffDashboard());
  await FX.repos(page, 200);
  ok(await page.locator('.plt-choix').count() === 1, '[V] un menu ouvert reste ouvert');
  await page.keyboard.press('Escape');
  await FX.repos(page, 150);
  ok(await page.locator('.plt-choix').count() === 0 && await page.evaluate(() => document.activeElement.dataset.pltTuile === 'joueurs'), '[V] Echap ferme le menu et rend le focus a sa tuile');
  ok(erreurs.length === 0, '[V] aucune erreur JavaScript', erreurs.join(' | '));
  await ctx.close();
}

async function sectionDroits(browser) {
  console.log('\n[D] LES DROITS');
  const { ctx, page, erreurs } = await ouvrir(browser, { voitLesMontants: false });
  await page.evaluate(() => {
    const s = state.staffAuthSession;
    s.role = { ...s.role, locked: false };
    s.permissions = s.permissions.filter((p) => p !== 'payments.view');
    renderStaffDashboard();
  });
  await FX.repos(page, 500);
  let t = await lireTuiles(page);
  const argents = ['ca', 'encaisse', 'aEncaisser', 'panier'];
  ok(t.length === 5 && !t.some((x) => argents.includes(x.id)), '[D] sans le droit, aucune tuile d argent', t.map((x) => x.id).join());
  const sansEuro = async () => page.evaluate(() => {
    const zone = [...document.querySelectorAll('.plt-panneau, .plt-cartes')].map((n) => n.textContent).join(' ');
    return { euro: zone.includes('€'), extrait: zone.slice(0, 120) };
  });
  ok(!(await sansEuro()).euro, '[D] la journee ne montre pas un euro');
  ok(/Bowling|Formules|Laser/.test(await phraseCarte(page, 'rapporte')) && /de vos réservations\.$/.test(await phraseCarte(page, 'rapporte')), '[D] « Ce qui rapporte » parle en reservations', await phraseCarte(page, 'rapporte'));
  ok(/joueurs déjà réservés/.test(await phraseCarte(page, 'reserve')), '[D] « Déjà réservé » parle en joueurs', await phraseCarte(page, 'reserve'));
  const pvSansDroit = await lireCartePv(page);
  ok(pvSansDroit.chiffres.length === 2 && /Groupes$/.test(pvSansDroit.chiffres[0]) && /Joueurs$/.test(pvSansDroit.chiffres[1]) && pvSansDroit.barres.length === 8, '[D] Pas venus : sans le droit, deux chiffres et aucun montant', pvSansDroit.chiffres.join(' | '));
  for (const p of ['7j', '30j', 'mois']) { await periode(page, p); ok(!(await sansEuro()).euro, `[D] ${p} : pas un euro`); }
  await page.locator('[data-plt-modifier]').click();
  await FX.repos(page, 200);
  await page.locator('[data-plt-tuile="resa"]').click();
  await FX.repos(page, 200);
  const options = await page.locator('.plt-choix [data-plt-choix]').evaluateAll((l) => l.map((b) => b.dataset.pltChoix));
  ok(options.length === 7 && !options.some((x) => argents.includes(x)), '[D] la liste des chiffres ne propose pas l argent', options.join());
  await page.keyboard.press('Escape');
  await FX.repos(page, 150);
  await page.locator('[data-plt-ajouter]').click();
  await FX.repos(page, 200);
  const cartes = await page.locator('.plt-choix [data-plt-choix]').evaluateAll((l) => l.map((b) => b.dataset.pltChoix));
  ok(!cartes.includes('paiements'), '[D] la carte des paiements ne se propose pas', cartes.join());
  t = await lireTuiles(page);
  ok(erreurs.length === 0, '[D] aucune erreur JavaScript', erreurs.join(' | '));
  await ctx.close();
}

async function sectionPannes(browser) {
  console.log('\n[E] LES PANNES ET LES CAS VIDES');
  let panne = '500';
  const { ctx, page, erreurs } = await ouvrir(browser, {
    intercepter: (chemin) => {
      if (!chemin.includes('dashboardAnalytics') || !panne) return null;
      return panne === '500' ? { ok: false, error: 'panne du banc', __statut: 500 } : { ok: true };
    },
  });
  await FX.repos(page, 400);
  const pvPanne = await lireCartePv(page);
  ok(await phraseCarte(page, 'pasvenus') === 'Ces chiffres ne sont pas disponibles pour le moment.' && pvPanne.chiffres.length === 0 && pvPanne.barres.length === 0, '[E] Pas venus : une panne se dit, aucun chiffre invente', await phraseCarte(page, 'pasvenus'));
  await periode(page, '7j');
  ok(await phrase(page) === 'Ces chiffres ne sont pas disponibles pour le moment.', '[E] une panne se dit en une phrase', await phrase(page));
  ok(await page.locator('[data-plt-reessayer]').count() === 1 && await page.locator('[data-plt-tuile]').count() === 0, '[E] aucun chiffre invente, un bouton pour reessayer');
  panne = 'vide';
  await page.locator('[data-plt-reessayer]').click();
  await FX.repos(page, 500);
  ok(await phrase(page) === 'Ces chiffres ne sont pas disponibles pour le moment.' && erreurs.length === 0, '[E] une reponse sans chiffres ne plante pas', erreurs.join(' | ') || await phrase(page));
  panne = '';
  await page.locator('[data-plt-reessayer]').click();
  await FX.repos(page, 600);
  ok(await page.locator('[data-plt-tuile]').count() === 5 && await page.locator('[data-plt-reessayer]').count() === 0, '[E] « Réessayer » ramene les chiffres');

  await periode(page, 'jour');
  await page.evaluate(() => { state.currentDate = '2027-01-11'; renderStaffDashboard(); });
  await FX.repos(page, 400);
  ok(normal(await page.locator('[data-plt-courbe]').textContent()) === 'Centre fermé ce jour-là.', '[E] un jour ferme se dit', normal(await page.locator('[data-plt-courbe]').textContent()));
  await page.evaluate(() => { state.dashPilotage.tuiles = ['ca', 'resa', 'joueurs', 'panier', 'occupation']; state.currentDate = '2027-01-12'; renderStaffDashboard(); });
  await FX.repos(page, 400);
  ok(normal(await page.locator('[data-plt-courbe]').textContent()) === 'Aucune réservation sur cette date.', '[E] une journee vide se dit', normal(await page.locator('[data-plt-courbe]').textContent()));
  const t = await lireTuiles(page);
  ok(tuile(t, 'panier').valeur === '-' && tuile(t, 'resa').valeur === '0', '[E] un panier sans joueur n est pas un zero', `${tuile(t, 'panier').valeur} / ${tuile(t, 'resa').valeur}`);
  await page.evaluate((d) => { state.currentDate = d; state.dashPilotage.periode = '7j'; state.dashPilotage.cartes = ['formules']; renderStaffDashboard(); }, JOUR);
  await FX.repos(page, 700);
  const piege = await page.evaluate(() => ({ xss: window.__xss === 1, img: document.querySelectorAll('.plt-cartes img').length, texte: document.querySelector('.plt-carte[data-plt-carte="formules"]').textContent.includes('<img') }));
  ok(!piege.xss && piege.img === 0 && piege.texte, '[E] un nom de formule ne s execute pas', JSON.stringify(piege));
  ok(erreurs.length === 0, '[E] aucune erreur JavaScript', erreurs.join(' | '));
  await ctx.close();
}

async function debordement(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function sectionEcrans(browser) {
  console.log('\n[M] LES ECRANS');
  for (const appareil of ['tablette', 'telephone']) {
    const { ctx, page, erreurs } = await ouvrir(browser, { appareil });
    let pire = await debordement(page);
    for (const p of ['7j', '30j', 'mois', 'jour']) { await periode(page, p); pire = Math.max(pire, await debordement(page)); }
    ok(pire <= 0, `[M] ${appareil} : rien ne deborde, sur aucune periode`, `${pire} px`);
    if (appareil === 'telephone') {
      const place = await page.evaluate(() => {
        const t = document.querySelector('[data-plt-tuile="ca"]');
        const v = t.querySelector('.dash-kpi-value').getBoundingClientRect();
        const d = t.querySelector('.dash-kpi-delta').getBoundingClientRect();
        return { memeLigne: d.top < v.bottom && d.bottom > v.top, aDroite: d.left >= v.right };
      });
      ok(place.memeLigne && place.aDroite, '[M] telephone : l ecart est a cote du chiffre', JSON.stringify(place));
      await page.locator('[data-plt-modifier]').click();
      await FX.repos(page, 250);
      const taille = await page.locator('[data-plt-poignee]').first().boundingBox();
      ok(taille.width >= 40 && taille.height >= 40, '[M] telephone : la poignee se prend au doigt', `${taille.width} x ${taille.height}`);
      await page.locator('[data-plt-modifier]').click();
      await FX.repos(page, 250);
      await page.setViewportSize({ width: 320, height: 700 });
      await FX.repos(page, 500);
      ok(await debordement(page) <= 0, '[M] 320 px : rien ne deborde', `${await debordement(page)} px`);
    }
    ok(erreurs.length === 0, `[M] ${appareil} : aucune erreur JavaScript`, erreurs.join(' | '));
    await ctx.close();
  }

  const { ctx, page, erreurs } = await ouvrir(browser, { theme: 'dark' });
  const noms = await page.evaluate(() => ({ stats: Object.keys(PinlanePilotage.STATS), cartes: Object.keys(PinlanePilotage.CARTES) }));
  ok(noms.stats.length === 11 && noms.cartes.length === 9, '[M] onze chiffres, neuf cartes', `${noms.stats.length} / ${noms.cartes.length}`);
  const fautes = [];
  for (const p of ['jour', '7j', '30j', 'mois']) {
    for (const s of noms.stats) {
      const reste = noms.stats.filter((x) => x !== s).slice(0, 4);
      await page.evaluate(({ p: per, s: st, reste: r, cartes }) => { state.dashPilotage = { periode: per, tuiles: [st, ...r], active: st, cartes }; PinlanePilotage.rafraichir(); }, { p, s, reste, cartes: noms.cartes });
      await page.waitForTimeout(p === 'jour' ? 30 : 90);
      const zone = await page.evaluate(() => [...document.querySelectorAll('.plt-panneau, .plt-cartes')].map((n) => n.textContent).join(' '));
      if (/NaN|undefined|Infinity|\[object|null/.test(zone)) fautes.push(`${p}/${s}: ${/.{30}(NaN|undefined|Infinity|\[object|null).{30}/.exec(zone.replace(/\s+/g, ' '))?.[0]}`);
      if (/[\u2014\u2013]/.test(zone)) fautes.push(`${p}/${s}: tiret long`);
    }
  }
  ok(fautes.length === 0, '[M] onze chiffres, quatre periodes, neuf cartes : jamais un NaN', fautes.slice(0, 3).join(' | '));
  ok(erreurs.length === 0, '[M] sombre : aucune erreur JavaScript', erreurs.join(' | '));
  await ctx.close();
}

(async () => {
  if (process.argv.includes('--contre-preuves')) {
    const arg = process.argv.find((a) => a.startsWith('--seul='));
    const noms = arg ? arg.slice(7).split(',') : Object.keys(MUTATIONS);
    let manquees = 0;
    for (const nom of noms) {
      const m = MUTATIONS[nom];
      if (!m) { console.log(`FAIL  contre-preuve inconnue ${nom}`); manquees += 1; continue; }
      const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, PILOTAGE_CASSE: nom, PINLANE_PILOTAGE_PORT: String(PORT + 1) }, encoding: 'utf8', timeout: 240000 });
      const sortie = `${r.stdout || ''}${r.stderr || ''}`;
      const cibleRouge = sortie.split('\n').some((l) => l.startsWith('FAIL') && l.indexOf(m.rouge) >= 0);
      const mord = r.status === 1 && cibleRouge;
      if (!mord) manquees += 1;
      console.log(`${mord ? 'ok  ' : 'FAIL'}  contre-preuve ${nom} : ${mord ? `rougit « ${m.rouge} »` : `ne mord pas (code ${r.status}, cible ${cibleRouge ? 'rouge' : 'verte'})`}`);
      if (!mord) console.log(sortie.split('\n').filter((l) => l.startsWith('FAIL') || /Error|erreur/.test(l)).slice(0, 6).join('\n'));
    }
    console.log(`pilotage-check --contre-preuves: ${noms.length - manquees}/${noms.length} mordent`);
    process.exit(manquees ? 1 : 0);
  }

  if (joue('S')) sectionCalcul();
  if (joue('H')) await sectionHandler();

  const sections = [['J', sectionJournee], ['P', sectionPeriodes], ['C', sectionCartes], ['R', sectionReglages], ['V', sectionDirect], ['D', sectionDroits], ['E', sectionPannes], ['M', sectionEcrans]].filter(([l]) => joue(l));
  if (sections.length) {
    const transformer = mutation && /^assets\//.test(mutation.fichier)
      ? (rel, texte) => (rel === mutation.fichier ? appliquer(texte) : texte)
      : null;
    const serveur = await FX.servir({ port: PORT, transformer });
    const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
    try {
      for (const [, jouer] of sections) await jouer(browser);
    } finally {
      await browser.close();
      serveur.close();
    }
  }
  console.log(`\npilotage-check: ${reussis} ok, ${echecs} echec(s)${CASSE ? ` (contre-preuve ${CASSE})` : ''}`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(echecs ? 1 : 3); });
