// LES DROITS A NIVEAUX, JOUES SUR LES VRAIS HANDLERS (2026-11-03).
//
// Movsar : « gestion de qui peut le faire a quel niveau, par role ce qu ils ont
// droit ». Un ecran cache un bouton, il ne refuse rien : ce gate monte le vrai
// api/staff-reservations.js, le vrai api/public-reservations.js, le vrai
// api/ops.js, le vrai moteur et la vraie lib/database.js sur la base en memoire
// du banc (scripts/reserver-banc.js), et lit ce qui est REELLEMENT ecrit en base.
//
// Chaque groupe joue une porte par role et par niveau, et prouve les refus
// autant que les succes :
//   [N] le niveau d une session : les defauts, le verrouille, la plateforme.
//   [C] la creation : prix, raison, reference du serveur, sur mesure, formule,
//       « a placer », notes signees, simulation, lot.
//   [P] le prix d un PATCH : plafond, raison, trace du serveur, ajustement garde,
//       contenu change a prix constant, reference forgee, valeurs vides, et
//       sans prix envoye, le prix qui suit pose par le serveur.
//   [J] un centre qui vend aux parties, ou le moteur reprend la base recue.
//   [E] les extras d un PATCH : lignes inchangees, changees, retirees, catalogue.
//   [F] la formule d un PATCH : mot, programme, autre formule.
//   [O] les notes : ajout seul sans reservations.edit, auteur forge.
//   [U] le canal public : extras, fausses notes, faux canal, faux libelle.
//   [K] le catalogue : bornes, defaut, vraie carte, portes d api/ops.js.
//   [W] la console : le catalogue arrive a qui reserve, une lecture par centre.
//
// --contre-preuves : chaque garde retiree en memoire (le disque n est jamais
// touche), le groupe qui la prouve doit rougir, sur la ligne attendue.
//
// Zero reseau, zero base, rien ne part.
// Lancement : node scripts/droits-niveaux-check.js [--contre-preuves]
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('./reserver-banc.js');
const banc = require('./slot-holds-check.js');

const ROOT = B.ROOT;
const URL_RESA = '/api/staff-reservations';
const URL_OPS = '/api/ops';
const NOM = 'Rachel';

// ---------------------------------------------------------------------------
// Ce que le banc ne connait pas : les notes sous verrou et la table des centres.
// ---------------------------------------------------------------------------
const DATES = ['created_at', 'updated_at', 'expires_at', 'released_at', 'paid_at', 'absent_at'];
const copieLigne = (row) => JSON.parse(JSON.stringify(row), (k, v) => (DATES.includes(k) && v ? new Date(v) : v));
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryDuBanc = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const tx = this && this.tx && !this.tx.abandonnee ? this.tx : null;
  const lire = (id) => (tx && tx.reservations.get(Number(id))) || B.base.reservations.get(Number(id));
  if (s === 'select * from reservations where id = $1 and center_id = $2 for update;') {
    const row = lire(params[0]);
    return row && row.center_id === params[1] ? { rows: [copieLigne(row)], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (s === 'update reservations set notes = $3, updated_at = now() where id = $1 and center_id = $2 returning *;') {
    const avant = lire(params[0]);
    if (!avant) return { rows: [], rowCount: 0 };
    const row = { ...avant, notes: params[2], updated_at: new Date(Date.now() + 1) };
    if (tx) tx.reservations.set(row.id, row); else B.base.reservations.set(row.id, row);
    return { rows: [copieLigne(row)], rowCount: 1 };
  }
  if (s === 'select settings from centers where id = $1 limit 1;') {
    const centre = B.base.centers.find((c) => c.id === params[0]);
    return centre ? { rows: [JSON.parse(JSON.stringify({ settings: centre.settings }))], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (s.startsWith('update centers set settings = jsonb_set(')) {
    const centre = B.base.centers.find((c) => c.id === params[0]);
    if (centre) centre.settings = { ...(centre.settings || {}), config: JSON.parse(params[1]) };
    return { rows: [], rowCount: centre ? 1 : 0 };
  }
  return queryDuBanc.call(this, sql, params);
};

// ---------------------------------------------------------------------------
// Les sessions : les droits sont lus par la vraie regle.
// ---------------------------------------------------------------------------
const VUE = ['reservations.view'];
const CREE = ['reservations.view', 'reservations.quick', 'reservations.create'];
const EDITE = ['reservations.view', 'reservations.quick', 'reservations.create', 'reservations.edit', 'reservations.status'];
const STATUT = ['reservations.view', 'reservations.status'];
const niveaux = (choix) => Object.entries(choix).map(([cle, option]) => `niveau:${cle}:${option}`);
const session = (permissions, choix = {}, { locked = false, nom = NOM } = {}) => ({
  centerId: 'libramont',
  member: { id: 'm-essai', name: nom },
  role: { id: 'essai', locked },
  permissions: [...permissions, ...niveaux(choix)],
});
const TOUT_NON = { surmesure: 'non', prix: 'non', formule: 'non', forcer: 'non', historique: 'non' };
const roleDePrix = (prix) => session(EDITE, { ...TOUT_NON, surmesure: 'libre', prix });
const roleDeMesure = (surmesure, prix = 'non') => session(EDITE, { ...TOUT_NON, surmesure, prix });
const verrouille = () => session([], {}, { locked: true, nom: 'Direction' });

const BOWLING = (extra = {}) => B.corpsStaff({ type: 'bowling', pax: 4, startTime: '20:00', duration: 1, totalDuration: 1, lanes: [], laneCount: 1, ...extra });
const LASER = (extra = {}) => B.corpsStaff({ type: 'laser', pax: 4, startTime: '15:00', laserGames: 3, duration: 1.5, ...extra });
const MINIGOLF = (extra = {}) => B.corpsStaff({ type: 'visite', pax: 4, startTime: '15:00', program: [{ activityId: 'minigolf_blacklight', participants: 4 }], ...extra });
const PIZZA_CARTE = { name: 'Pizza Margherita × 2', price: 999 };
const enBase = (id) => B.base.reservations.get(Number(id));
const notesDe = (ligne) => String((ligne && ligne.notes) || '').split('\n').map((t) => {
  try { return t.startsWith('[equipe] ') ? JSON.parse(t.slice(9)) : null; } catch (error) { return null; }
}).filter(Boolean);
const lignesEcrites = () => B.base.reservations.size;

function verdicts() {
  const liste = [];
  const v = (cond, label, detail = '') => { liste.push({ ok: Boolean(cond), label, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); return Boolean(cond); };
  return { liste, v };
}

function monter(mutations, sessionDepart = verrouille()) {
  const m = B.monter({ mutations, session: sessionDepart });
  m.en = (s) => m.changerSession(s);
  m.creer = async (s, corps) => {
    m.changerSession(s);
    const r = await m.appeler('POST', URL_RESA, corps);
    return { statut: r.statut, code: r.json.code, message: r.json.message || '', r: r.json.reservation || null, json: r.json };
  };
  m.modifier = async (s, corps) => {
    m.changerSession(s);
    const r = await m.appeler('PATCH', URL_RESA, { centerId: 'libramont', ...corps });
    return { statut: r.statut, code: r.json.code, message: r.json.message || '', r: r.json.reservation || null, json: r.json };
  };
  return m;
}
const dire = (x) => `${x.statut} ${x.code || ''} ${x.message}`.trim();

// ---------------------------------------------------------------------------
// [N] LE NIVEAU D UNE SESSION.
// ---------------------------------------------------------------------------
async function groupeNiveaux(mutations = []) {
  const { liste, v } = verdicts();
  B.semer([]);
  monter(mutations);
  const { niveauEffectif, sessionHasPermission, STAFF_ROLE_PRESETS, __test } = require(path.join(ROOT, 'lib/staff-auth.js'));
  const lire = (s) => ['surmesure', 'prix', 'formule', 'forcer', 'historique'].map((cle) => niveauEffectif(s, cle)).join(' ');
  v(lire(session(EDITE)) === 'libre libre oui oui oui', '[N] un role qui modifie, sans niveau ecrit : le maximum, aucun geste perdu', lire(session(EDITE)));
  v(lire(session(CREE)) === 'catalogue non non non non', '[N] creation sans modification : le catalogue, non ailleurs', lire(session(CREE)));
  v(lire(session(VUE)) === 'non non non non non', '[N] sans creation : non partout', lire(session(VUE)));
  v(lire(session([], {}, { locked: true })) === 'libre libre oui oui oui', '[N] role verrouille : le maximum, tableau vide', lire(session([], {}, { locked: true })));
  v(lire(session([], TOUT_NON, { locked: true })) === 'libre libre oui oui oui', '[N] role verrouille : jamais lu dans le tableau');
  v(lire(session(['platform.admin'], TOUT_NON)) === 'libre libre oui oui oui' && sessionHasPermission(session(['platform.admin']), 'platform.admin'), '[N] plateforme : le maximum, jamais lu dans le tableau');
  v(niveauEffectif(session(EDITE, { prix: '5' }), 'prix') === '5', '[N] une option ecrite prime sur le defaut');
  v(niveauEffectif(session(EDITE, { prix: '15' }), 'prix') === 'libre', '[N] une option morte retombe sur le defaut, pas sur le maximum d un autre', niveauEffectif(session(EDITE, { prix: '15' }), 'prix'));
  v(niveauEffectif(session(EDITE), 'inconnue') === 'non' && niveauEffectif(session([], {}, { locked: true }), 'inconnue') === 'non', '[N] une cle inconnue vaut non, meme verrouille');
  v(niveauEffectif(null, 'prix') === 'non', '[N] sans session : non');
  v(niveauEffectif(session(EDITE, { prix: '5' }), 'prix') === '5' && niveauEffectif({ ...session(EDITE), permissions: [...EDITE, 'niveau:prix:5', 'niveau:prix:10'] }, 'prix') === '10', '[N] deux options lues : la derniere, comme a l ecriture');
  const { nomDeSession } = require(path.join(ROOT, 'lib/droits-reservation.js'));
  v(nomDeSession({ member: { name: '<b>Rachel</b>' } }) === 'bRachel/b', '[N] le nom d une session ne porte pas de balise');
  v(nomDeSession({}) === 'Équipe' && nomDeSession({ member: { name: 'x'.repeat(99) } }).length === 80, '[N] une session sans nom signe « Équipe », et un nom tient 80 caracteres');
  const preset = (id) => lire({ ...session(STAFF_ROLE_PRESETS.find((r) => r.id === id).permissions) });
  v(preset('direction') === 'libre libre oui oui oui', '[N] preset Direction', preset('direction'));
  v(preset('manager') === 'libre 20 oui oui oui', '[N] preset Manager', preset('manager'));
  v(preset('staff-bar') === 'catalogue non non non non', '[N] preset Staff bar', preset('staff-bar'));
  v(preset('marketing') === 'non non non non non' && preset('technique') === 'non non non non non', '[N] presets Marketing et Technique');
  const propres = __test.safePermissions(['reservations.view', 'niveau:prix:10', 'niveau:prix:5', 'niveau:surmesure:peut-etre', 'niveau:inconnue:oui', 'niveau:forcer:oui:plus', 'droit.invente']);
  v(propres.includes('niveau:prix:5') && !propres.includes('niveau:prix:10') && !propres.some((p) => /peut-etre|inconnue|invente|plus/.test(p)), '[N] a l ecriture : une option par cle, rien d inconnu ne passe', propres);
  return liste;
}

// ---------------------------------------------------------------------------
// [C] LA CREATION.
// ---------------------------------------------------------------------------
async function groupePrixCreation(mutations = []) {
  const { liste, v } = verdicts();
  B.semer([]);
  const m = monter(mutations);
  const accepte = async (s, prix, label, extra = {}) => {
    B.semer([]);
    const x = await m.creer(s, BOWLING({ price: prix, prixRaison: 'Geste', ...extra }));
    v(x.statut === 201 && enBase(x.r.id) && Number(enBase(x.r.id).price) === prix, label, dire(x));
    return x;
  };
  const refuse = async (s, prix, code, label, extra = {}, motif = /./) => {
    B.semer([]);
    const x = await m.creer(s, BOWLING({ price: prix, prixRaison: 'Geste', ...extra }));
    v(x.statut === (code === 'prix_raison_requise' || code === 'prix_invalide' ? 422 : 403) && x.code === code && motif.test(x.message) && lignesEcrites() === 0, label, dire(x));
  };
  // La reference d un bowling de 4 a cette date : 39 EUR, calculee par le serveur.
  B.semer([]);
  const sans = await m.creer(roleDePrix('non'), BOWLING());
  v(sans.statut === 201 && Number(sans.r.basePrice) === 39 && Number(sans.r.price) === 39 && !notesDe(enBase(sans.r.id)).length, '[C] sans prix envoye, la reference, aucune trace', dire(sans));
  await accepte(roleDePrix('non'), 39.5, '[C] niveau non : a 50 centimes de la reference, ce n est pas un ecart');
  await refuse(roleDePrix('non'), 39.51, 'prix_niveau_insuffisant', '[C] niveau non : 51 centimes, refus au contrat, rien d ecrit', {}, /ne permet pas d’ajuster un prix/);
  await accepte(roleDePrix('5'), 37.05, '[C] niveau 5 % : 5 % pile passe');
  await refuse(roleDePrix('5'), 37.04, 'prix_niveau_insuffisant', '[C] niveau 5 % : un centime de plus, refus');
  await accepte(roleDePrix('10'), 35.1, '[C] niveau 10 % : 10 % pile passe');
  await refuse(roleDePrix('10'), 35.09, 'prix_niveau_insuffisant', '[C] niveau 10 % : un centime de plus, refus');
  await accepte(roleDePrix('20'), 31.2, '[C] niveau 20 % : 20 % pile passe');
  await refuse(roleDePrix('20'), 31.19, 'prix_niveau_insuffisant', '[C] niveau 20 % : un centime de plus, refus');
  await accepte(roleDePrix('20'), 46.8, '[C] niveau 20 % : vers le haut aussi, 20 % passe');
  await refuse(roleDePrix('20'), 46.81, 'prix_niveau_insuffisant', '[C] niveau 20 % : vers le haut, un centime de plus, refus');
  await accepte(roleDePrix('libre'), 0, '[C] sans limite : offert passe');
  const trace = await accepte(verrouille(), 20, '[C] Direction verrouillee : 20 au lieu de 39 passe');
  const note = notesDe(trace.r && enBase(trace.r.id)).find((n) => n.type === 'prix');
  v(note && note.par === 'Direction' && note.t === 'Prix 39 € → 20 €, Geste' && note.prix.de === 39 && note.prix.a === 20 && note.prix.raison === 'Geste' && /^\d{4}-\d{2}-\d{2}T/.test(note.le),
    '[C] la trace est ecrite par le serveur, au nom de la session, avec les deux montants', note);
  await refuse(verrouille(), 20, 'prix_raison_requise', '[C] Direction sans raison : refus, rien d ecrit', { prixRaison: '   ' });
  await refuse(verrouille(), 100001, 'prix_invalide', '[C] au dela de 100 000 EUR : refus');
  await refuse(roleDePrix('non'), 20, 'prix_niveau_insuffisant', '[C] une base forgee dans le corps ne cree pas de marge', { basePrice: 20, base_price: 20 });
  B.semer([]);
  const forge = await m.creer(roleDePrix('libre'), BOWLING({ price: 30, prixRaison: 'Geste', basePrice: 5 }));
  v(forge.statut === 201 && Number(enBase(forge.r.id).base_price) === 39, '[C] la base ecrite est celle du serveur, jamais celle du corps', dire(forge));
  // La reference nulle : une activite dont le tarif se decide au comptoir.
  B.semer([]);
  const nulle = await m.creer(roleDePrix('20'), MINIGOLF({ price: 10, prixRaison: 'Geste' }));
  v(nulle.statut === 403 && nulle.code === 'prix_niveau_insuffisant' && /Sans prix de référence/.test(nulle.message) && lignesEcrites() === 0, '[C] reference nulle : un plafond en % ne passe pas', dire(nulle));
  B.semer([]);
  const nulleLibre = await m.creer(roleDePrix('libre'), MINIGOLF({ price: 10, prixRaison: 'Geste' }));
  v(nulleLibre.statut === 201 && Number(enBase(nulleLibre.r.id).price) === 10, '[C] reference nulle : seul « libre » passe', dire(nulleLibre));
  // Un programme : la reference est celle du moteur, la base du corps n y entre pas.
  const programme = [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1 }];
  B.semer([]);
  const juste = await m.creer(roleDePrix('non'), B.corpsStaff({ type: 'visite', pax: 4, startTime: '15:00', program: programme }));
  v(juste.statut === 201 && Number(juste.r.basePrice) > 0, '[C] MONTAGE un programme se cree a son prix', dire(juste));
  B.semer([]);
  const forgeProgramme = await m.creer(roleDePrix('non'), B.corpsStaff({ type: 'visite', pax: 4, startTime: '15:00', program: programme, basePrice: 1, price: 1, prixRaison: 'Geste' }));
  v(forgeProgramme.statut === 403 && forgeProgramme.code === 'prix_niveau_insuffisant' && lignesEcrites() === 0, '[C] un programme avec une base forgee : refus, rien d ecrit', dire(forgeProgramme));
  return liste;
}

async function groupeExtrasCreation(mutations = []) {
  const { liste, v } = verdicts();
  B.semer([]);
  const catalogue = {
    categories: [{ id: 'nourriture', nom: 'Nourriture' }, { id: 'boissons', nom: 'Boissons' }, { id: 'decoration', nom: 'Décoration' }, { id: 'masquee', nom: 'Masquée', actif: false }],
    articles: [
      { id: 'pizza-margherita', nom: 'Pizza Margherita', categorie: 'nourriture', prix: 14, unite: 'piece', heure: true, actif: true },
      { id: 'cruche', nom: 'Cruche maison', categorie: 'boissons', prix: 6, unite: 'joueur', heure: false, actif: true },
      { id: 'gateau', nom: 'Gâteau d’anniversaire', categorie: 'nourriture', prix: 0, unite: 'piece', heure: true, actif: true },
      { id: 'arche', nom: 'Arche de ballons', categorie: 'decoration', prix: 150, unite: 'piece', heure: false, actif: true },
      { id: 'retiree', nom: 'Pizza retirée', categorie: 'nourriture', prix: 9, unite: 'piece', heure: false, actif: false },
      { id: 'cachee', nom: 'Secrète', categorie: 'masquee', prix: 9, unite: 'piece', heure: false, actif: true },
    ],
  };
  B.base.centers = [{ id: 'libramont', name: 'Libramont', status: 'active', timezone: 'Europe/Brussels', settings: { config: { surMesure: catalogue } } }];
  const m = monter(mutations);
  const ligneDe = (x) => (x.r ? (enBase(x.r.id).extras || [])[0] : null);
  const creer = async (s, extras, extra = {}) => { B.semer([]); return m.creer(s, BOWLING({ extras, ...extra })); };

  let x = await creer(roleDeMesure('non'), [{ name: 'Pizza × 2', price: 20 }]);
  v(x.statut === 403 && x.code === 'sur_mesure_refuse' && lignesEcrites() === 0, '[C] sur mesure non : aucune ligne, rien d ecrit', dire(x));
  x = await creer(roleDeMesure('catalogue'), [PIZZA_CARTE]);
  let l = ligneDe(x);
  v(x.statut === 201 && l && l.price === 28 && l.prixUnitaire === 14 && l.qte === 2 && l.articleId === 'pizza-margherita' && l.categorie === 'nourriture' && l.name === 'Pizza Margherita × 2',
    '[C] catalogue : le serveur recalcule le prix de la ligne, 14 x 2, pas 999', { reponse: dire(x), ligne: l });
  v(x.statut === 201 && Number(enBase(x.r.id).price) === 67, '[C] catalogue : le total suit la ligne recalculee', x.r && x.r.price);
  v(l && l.par === NOM && /^\d{4}-\d{2}-\d{2}T/.test(l.le), '[C] la ligne dit qui l a posee et quand', l);
  x = await creer(roleDeMesure('catalogue'), [{ articleId: 'pizza-margherita', qte: 3, name: 'Ce que je veux', price: 1 }]);
  l = ligneDe(x);
  v(l && l.price === 42 && l.name === 'Pizza Margherita × 3', '[C] catalogue : l article designe par son id, le nom vient de lui', { reponse: dire(x), ligne: l });
  x = await creer(roleDeMesure('catalogue'), [{ articleId: 'inconnu', name: 'Pizza Margherita', price: 14 }]);
  v(x.statut === 403 && x.code === 'sur_mesure_hors_catalogue', '[C] catalogue : un id inconnu ne se rattrape pas par le nom', dire(x));
  const horsBorne = [];
  for (const ligne of [{ articleId: 'pizza-margherita', qte: 1000, name: 'Pizza', price: 1 }, { articleId: 'pizza-margherita', qte: 1.5, name: 'Pizza', price: 1 },
    { articleId: 'pizza-margherita', qte: 0, name: 'Pizza', price: 1 }, { name: 'Pizza Margherita × 1000', price: 1 }]) {
    x = await creer(roleDeMesure('catalogue'), [ligne]);
    horsBorne.push(`${x.statut} ${x.code || ''} ${lignesEcrites()}`);
  }
  v(horsBorne.every((r) => r === '422 quantite_invalide 0'), '[C] catalogue : une quantite hors de 1 a 999 est refusee, jamais devinee', horsBorne);
  x = await creer(roleDeMesure('catalogue'), [{ articleId: 'pizza-margherita', qte: 999, name: 'Pizza', price: 1 }]);
  l = ligneDe(x);
  v(x.statut === 201 && l && l.qte === 999 && l.price === 13986 && l.prixUnitaire === 14, '[C] catalogue : 999 passe, price = qte × prixUnitaire', { reponse: dire(x), ligne: l });
  x = await creer(roleDeMesure('catalogue'), [{ articleId: 'arche', qte: 999, name: 'Arche', price: 1 }]);
  v(x.statut === 422 && x.code === 'prix_invalide' && lignesEcrites() === 0, '[C] catalogue : une ligne calculee au dela de 100 000 EUR : refus', dire(x));
  x = await creer(roleDeMesure('catalogue'), [{ articleId: 'cruche', name: 'Cruche', price: 0 }]);
  l = ligneDe(x);
  v(l && l.qte === 4 && l.price === 24, '[C] catalogue : un article par joueur vaut le groupe', { reponse: dire(x), ligne: l });
  x = await creer(roleDeMesure('catalogue'), [{ name: 'Gateau d’anniversaire × 1', price: 35 }]);
  l = ligneDe(x);
  v(l && l.price === 35 && l.prixUnitaire === 35, '[C] catalogue : un article a 0 est « prix a saisir », le prix tape reste', { reponse: dire(x), ligne: l });
  x = await creer(roleDeMesure('catalogue'), [{ name: 'Gateau d\'anniversaire × 1', price: 35 }]);
  v(x.statut === 201 && ligneDe(x).articleId === 'gateau', '[C] catalogue : l apostrophe droite trouve l article', dire(x));
  x = await creer(roleDeMesure('catalogue'), [{ articleId: 'gateau', name: 'Gateau', qte: 2, prixUnitaire: -5, price: 30 }]);
  l = ligneDe(x);
  v(x.statut === 201 && l && l.prixUnitaire === 15 && l.price === 30, '[C] catalogue : un prix unitaire negatif ne s ecrit jamais', { reponse: dire(x), ligne: l });
  x = await creer(roleDeMesure('non'), ['Pizza', null, 5]);
  v(x.statut === 201 && !enBase(x.r.id).extras.length, '[C] ce qui n est pas une ligne ne compte pas', dire(x));
  x = await creer(roleDeMesure('non'), 'rien du tout');
  v(x.statut === 201 && !enBase(x.r.id).extras.length, '[C] des extras qui ne sont pas une liste ne comptent pas', dire(x));
  x = await creer(roleDeMesure('catalogue'), [{ name: 'Cheval × 1', price: 5 }]);
  v(x.statut === 403 && x.code === 'sur_mesure_hors_catalogue' && lignesEcrites() === 0, '[C] catalogue : hors catalogue, refus', dire(x));
  x = await creer(roleDeMesure('catalogue'), [{ articleId: 'retiree', name: 'Pizza retirée', price: 9 }]);
  v(x.statut === 403 && x.code === 'sur_mesure_hors_catalogue', '[C] catalogue : un article inactif, refus', dire(x));
  x = await creer(roleDeMesure('catalogue'), [{ articleId: 'cachee', name: 'Secrète', price: 9 }]);
  v(x.statut === 403 && x.code === 'sur_mesure_hors_catalogue', '[C] catalogue : une categorie masquee, refus', dire(x));
  x = await creer(roleDeMesure('libre'), [{ name: 'Decoration licorne', price: 45, par: 'Direction', le: '2020-01-01T00:00:00.000Z', categorie: 'autre', note: 'Pour 15 h', heure: '15:30' }]);
  l = ligneDe(x);
  v(x.statut === 201 && l && l.price === 45 && l.par === NOM && !String(l.le).startsWith('2020') && l.note === 'Pour 15 h' && l.heure === '15:30' && l.categorie === 'autre',
    '[C] libre : nom et prix au choix, l auteur du corps ne survit pas', { reponse: dire(x), ligne: l });
  x = await creer(roleDeMesure('libre', '20'), [{ name: 'Remise', price: -10 }]);
  v(x.statut === 403 && x.code === 'sur_mesure_negatif' && lignesEcrites() === 0, '[C] une ligne negative sans prix libre : refus', dire(x));
  x = await creer(roleDeMesure('libre', 'libre'), [{ name: 'Remise', price: -10 }]);
  v(x.statut === 201 && ligneDe(x).price === -10, '[C] une ligne negative avec prix libre passe', dire(x));
  x = await creer(roleDeMesure('libre', 'libre'), [{ name: 'Lustre', price: 100001 }]);
  v(x.statut === 422 && x.code === 'prix_invalide' && lignesEcrites() === 0, '[C] une ligne au dela de 100 000 EUR : refus', dire(x));
  x = await creer(roleDeMesure('libre', 'libre'), [{ name: 'Lustre', price: 'abc' }]);
  v(x.statut === 422 && x.code === 'prix_invalide' && lignesEcrites() === 0, '[C] un prix de ligne illisible : refus, pas 0', dire(x));
  x = await creer(session(CREE), [PIZZA_CARTE]);
  v(x.statut === 201 && ligneDe(x).price === 28, '[C] un role qui cree sans modifier : le catalogue par defaut, sans ecrire de niveau', dire(x));
  x = await creer(session(CREE), [{ name: 'Cheval', price: 1 }]);
  v(x.statut === 403 && x.code === 'sur_mesure_hors_catalogue', '[C] un role qui cree sans modifier : pas de ligne libre par l API (trou 1)', dire(x));
  // La simulation montre le meme prix et ne refuse rien.
  B.semer([]);
  m.en(roleDeMesure('catalogue'));
  const simule = await m.appeler('POST', URL_RESA, BOWLING({ dryRun: true, extras: [PIZZA_CARTE] }));
  const cree = await creer(roleDeMesure('catalogue'), [PIZZA_CARTE]);
  v(simule.statut === 200 && simule.json.plan && simule.json.plan.prix === 67 && cree.statut === 201 && Number(enBase(cree.r.id).price) === 67 && lignesEcrites() === 1,
    '[C] la simulation n ecrit rien et montre le prix que la creation pose', simule.json.plan && simule.json.plan.prix);
  x = await creer(roleDeMesure('libre', 'libre'), [{ name: 'Remise', price: -100 }]);
  v(x.statut === 201 && Number(enBase(x.r.id).price) === 0 && !notesDe(enBase(x.r.id)).length, '[C] une remise plus grande que le dossier : la reference s arrete a zero, aucun ecart', dire(x));
  B.semer([]);
  m.en(roleDeMesure('non'));
  const simuleRefus = await m.appeler('POST', URL_RESA, BOWLING({ dryRun: true, extras: [PIZZA_CARTE] }));
  v(simuleRefus.statut === 200, '[C] la simulation ne refuse pas : le refus tombe a l ecriture', `${simuleRefus.statut} ${simuleRefus.json.message || ''}`);
  B.base.centers = [];
  return liste;
}

async function groupeFormuleForcer(mutations = []) {
  const { liste, v } = verdicts();
  B.semer([]);
  const m = monter(mutations);
  const adaptee = (extra = {}) => B.corpsStaff({ type: 'formule', formuleId: 'f1', pax: 8, startTime: '15:00', duration: 1, totalDuration: 2, label: 'FORMULE 1 (adaptée)',
    program: [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 2 }], preference: {}, ...extra });
  B.semer([]);
  let x = await m.creer(session(EDITE, { ...TOUT_NON, prix: 'libre', formule: 'non' }), adaptee());
  v(x.statut === 403 && x.code === 'formule_niveau_insuffisant' && lignesEcrites() === 0, '[C] formule adaptee, niveau non : refus, rien d ecrit', dire(x));
  B.semer([]);
  x = await m.creer(session(EDITE, { ...TOUT_NON, prix: 'libre', formule: 'oui' }), adaptee());
  v(x.statut === 201 && /adaptée/.test(enBase(x.r.id).label), '[C] formule adaptee, niveau oui : passe', dire(x));
  B.semer([]);
  x = await m.creer(session(EDITE, { ...TOUT_NON, prix: 'libre', formule: 'non' }), BOWLING({ label: 'Bowling (adaptée)' }));
  v(x.statut === 403 && x.code === 'formule_niveau_insuffisant', '[C] le mot « (adaptée) » seul demande le niveau', dire(x));
  // « A placer » : toutes les pistes sont prises a 16:00.
  const plein = () => [1, 2, 3, 4, 5, 6, 7, 8].map((piste) => B.ligne(910 + piste, { start_time: '16:00', lanes: [piste], name: `Piste ${piste}` }));
  B.semer(plein());
  x = await m.creer(session(EDITE, { ...TOUT_NON, forcer: 'non' }), BOWLING({ startTime: '16:00', forcer: true }));
  v(x.statut === 403 && x.code === 'forcer_refuse' && lignesEcrites() === 8, '[C] « Créer quand même », niveau non : refus, rien d ecrit', dire(x));
  B.semer(plein());
  x = await m.creer(session(EDITE, { ...TOUT_NON, forcer: 'oui' }), BOWLING({ startTime: '16:00', forcer: true }));
  v(x.statut === 201 && x.json.aPlacer === true, '[C] « Créer quand même », niveau oui : part a placer', dire(x));
  B.semer([]);
  x = await m.creer(session(EDITE, { ...TOUT_NON, forcer: 'non' }), BOWLING({ startTime: '16:00', forcer: true }));
  v(x.statut === 201 && x.json.aPlacer !== true, '[C] `forcer` sans conflit ne demande rien', dire(x));
  // Les notes d une creation : l auteur vient de la session.
  B.semer([]);
  const forge = `[equipe] ${JSON.stringify({ t: 'Prix offert par la direction', par: 'Movsar', le: '2020-01-01T00:00:00.000Z', type: 'prix', prix: { de: 60, a: 0 }, compte: { de: 1, a: 2 } })}`;
  x = await m.creer(roleDePrix('non'), BOWLING({ notes: `Mot du comptoir\n${forge}` }));
  const signee = notesDe(enBase(x.r.id));
  v(x.statut === 201 && signee.length === 1 && signee[0].par === NOM && !signee[0].type && !signee[0].prix && !signee[0].compte && !signee[0].le.startsWith('2020') && signee[0].t === 'Prix offert par la direction'
    && /^Mot du comptoir/.test(enBase(x.r.id).notes), '[C] un corps qui pretend un auteur : resigne par la session, sans type ni montants', signee);
  // Le lot passe par la meme garde.
  B.semer([]);
  m.en(roleDeMesure('non'));
  const lot = await m.appeler('POST', URL_RESA, { centerId: 'libramont', dossiers: [BOWLING({ startTime: '18:00' }), BOWLING({ startTime: '19:00', extras: [PIZZA_CARTE] })] });
  v(lot.statut === 207 && lot.json.echecs.length === 1 && lot.json.echecs[0].index === 1 && lot.json.echecs[0].code === 'sur_mesure_refuse' && lignesEcrites() === 1, '[C] lot : le dossier refuse le dit par son rang, l autre part', { statut: lot.statut, echecs: lot.json.echecs });
  B.semer([]);
  const refusTotal = await m.appeler('POST', URL_RESA, { centerId: 'libramont', dossiers: [BOWLING({ extras: [PIZZA_CARTE] })] });
  v(refusTotal.statut === 403 && lignesEcrites() === 0, '[C] lot : tout refuse par les droits, 403 et rien d ecrit', { statut: refusTotal.statut, echecs: refusTotal.json.echecs });
  return liste;
}

// ---------------------------------------------------------------------------
// [P] LE PRIX D UN PATCH.
// ---------------------------------------------------------------------------
const DOSSIER = (id = 501, champs = {}) => B.ligne(id, { start_time: '15:00', lanes: [1], base_price: 60, price: 60, name: 'Groupe Essai', ...champs });

async function groupePrixPatch(mutations = []) {
  const { liste, v } = verdicts();
  B.semer([DOSSIER()]);
  const m = monter(mutations);
  const essai = async (s, corps, ligne = DOSSIER()) => { B.semer([ligne]); return m.modifier(s, { id: 501, ...corps }); };
  let x = await essai(roleDePrix('5'), { price: 57, prixRaison: 'Geste' });
  v(x.statut === 200 && Number(enBase(501).price) === 57, '[P] 5 % : 57 sur 60 passe', dire(x));
  const note = notesDe(enBase(501)).find((n) => n.type === 'prix');
  v(note && note.par === NOM && note.prix.de === 60 && note.prix.a === 57 && note.t === 'Prix 60 € → 57 €, Geste', '[P] la trace : qui, quand, de combien a combien, pourquoi', note);
  x = await essai(roleDePrix('5'), { price: 56.99, prixRaison: 'Geste' });
  v(x.statut === 403 && x.code === 'prix_niveau_insuffisant' && Number(enBase(501).price) === 60, '[P] 5 % : un centime de plus, refus, rien d ecrit', dire(x));
  x = await essai(roleDePrix('10'), { price: 54, prixRaison: 'Geste' });
  v(x.statut === 200, '[P] 10 % pile passe', dire(x));
  x = await essai(roleDePrix('10'), { price: 53.99, prixRaison: 'Geste' });
  v(x.statut === 403 && x.code === 'prix_niveau_insuffisant', '[P] 10 % : un centime de plus, refus', dire(x));
  x = await essai(roleDePrix('20'), { price: 48, prixRaison: 'Geste' });
  v(x.statut === 200, '[P] 20 % pile passe', dire(x));
  x = await essai(roleDePrix('20'), { price: 47.99, prixRaison: 'Geste' });
  v(x.statut === 403 && x.code === 'prix_niveau_insuffisant', '[P] 20 % : un centime de plus, refus', dire(x));
  x = await essai(roleDePrix('non'), { price: 59, prixRaison: 'Geste' });
  v(x.statut === 403 && x.code === 'prix_niveau_insuffisant' && Number(enBase(501).price) === 60, '[P] niveau non : refus', dire(x));
  x = await essai(roleDePrix('non'), { price: 60.5, prixRaison: 'Geste' });
  v(x.statut === 200 && !notesDe(enBase(501)).length, '[P] niveau non : dans la marge de 50 centimes, aucune trace', dire(x));
  x = await essai(roleDePrix('libre'), { price: 0 });
  v(x.statut === 422 && x.code === 'prix_raison_requise' && Number(enBase(501).price) === 60, '[P] sans raison : refus, rien d ecrit', dire(x));
  x = await essai(verrouille(), { price: 10, prixRaison: 'Geste', par: 'Quelqu un', auteur: 'Quelqu un' });
  v(x.statut === 200 && (notesDe(enBase(501))[0] || {}).par === 'Direction', '[P] Direction verrouillee passe, sous son nom, pas celui du corps', notesDe(enBase(501)));
  x = await essai(roleDePrix('non'), { name: 'Autre nom', price: 60 });
  v(x.statut === 200 && enBase(501).name === 'Autre nom' && !notesDe(enBase(501)).length, '[P] renvoyer le dossier a son prix ne juge rien', dire(x));
  // Une base forgee ne deplace pas la reference, et ne s ecrit pas.
  x = await essai(roleDePrix('non'), { price: 10, basePrice: 10, prixRaison: 'Geste' });
  v(x.statut === 403 && x.code === 'prix_niveau_insuffisant', '[P] une base forgee ne cree pas de marge', dire(x));
  x = await essai(roleDePrix('libre'), { name: 'Base forgee', basePrice: 1 });
  v(x.statut === 200 && Number(enBase(501).base_price) === 60, '[P] sans replan, la base du corps ne s ecrit jamais', `${dire(x)} base ${enBase(501).base_price}`);
  // Un ajustement deja en place se garde.
  const ami = DOSSIER(501, { price: 40 });
  x = await essai(roleDeMesure('libre', 'non'), { price: 45, extras: [{ id: 'x', name: 'Cafe × 1', price: 5 }] }, ami);
  v(x.statut === 200 && Number(enBase(501).price) === 45 && !notesDe(enBase(501)).some((n) => n.type === 'prix'), '[P] un prix d ami garde son ecart quand un cafe s ajoute, sans redemander', dire(x));
  x = await essai(roleDeMesure('libre', 'non'), { price: 60 }, ami);
  v(x.statut === 200 && !notesDe(enBase(501)).some((n) => n.type === 'prix'), '[P] revenir a la reference ne demande aucun niveau', dire(x));
  x = await essai(roleDeMesure('libre', 'non'), { price: 35, prixRaison: 'Geste' }, ami);
  v(x.statut === 403 && x.code === 'prix_niveau_insuffisant', '[P] creuser un ecart existant demande le niveau', dire(x));
  // Le contenu change a prix constant : autant de joueurs en plus, gratuits.
  const laser = () => DOSSIER(501, { type: 'laser', lanes: [], pax: 4, duration: 1.5, total_duration: 1.5, base_price: 100, price: 100, label: 'Laser Game' });
  x = await essai(roleDePrix('non'), { pax: 8, price: 100, prixRaison: 'Geste', laserGames: 3 }, laser());
  v(x.statut === 403 && x.code === 'prix_niveau_insuffisant' && Number(enBase(501).pax) === 4, '[P] doubler le groupe a prix constant : refus', dire(x));
  x = await essai(roleDePrix('non'), { pax: 8, price: 200, basePrice: 1, laserGames: 3 }, laser());
  v(x.statut === 200 && Number(enBase(501).price) === 200 && Number(enBase(501).base_price) === 200, '[P] le groupe double, le prix suit : passe, et la base du corps ne s ecrit pas', `${dire(x)} base ${enBase(501).base_price}`);
  x = await essai(roleDePrix('non'), { pax: 8, price: 100, basePrice: 100, laserGames: 3, prixRaison: 'Geste' }, laser());
  v(x.statut === 403 && x.code === 'prix_niveau_insuffisant', '[P] un laser sans plan de pistes : la base forgee du corps ne le sauve pas', dire(x));
  // Sans prix envoye, le contenu change : le serveur pose le prix qui suit
  // (prixQuiSuit). Il gardait 100 EUR pour 8 et refusait.
  x = await essai(roleDePrix('non'), { pax: 8, laserGames: 3 }, laser());
  v(x.statut === 200 && Number(enBase(501).pax) === 8 && Number(enBase(501).price) > 100 && Number(enBase(501).price) === Number(enBase(501).base_price) && !notesDe(enBase(501)).some((n) => n.type === 'prix'),
    '[P] un laser sans prix envoye : le serveur pose le tarif de 8, aucune trace, meme au niveau non', `${dire(x)} prix ${enBase(501).price} base ${enBase(501).base_price}`);
  x = await essai(roleDePrix('non'), { pax: 8, laserGames: 3 }, DOSSIER(501, { type: 'laser', lanes: [], pax: 4, duration: 1.5, total_duration: 1.5, base_price: 100, price: 80, label: 'Laser Game' }));
  v(x.statut === 200 && Number(enBase(501).price) === Number(enBase(501).base_price) - 20 && !notesDe(enBase(501)).some((n) => n.type === 'prix'),
    '[P] un prix d ami sans prix envoye garde son ecart sur le nouveau tarif, sans rien redemander', `${dire(x)} prix ${enBase(501).price} base ${enBase(501).base_price}`);
  x = await essai(roleDePrix('non'), { pax: 8, price: 60 });
  v(x.statut === 200 && Number(enBase(501).price) > 60 && Number(enBase(501).price) === Number(enBase(501).base_price), '[P] un bowling a son prix de reference : le moteur le recalcule, rien a juger', `${dire(x)} prix ${enBase(501).price}`);
  // Une formule retiree de la carte n a plus de tarif : sa base est la derniere connue.
  const sansTarif = () => DOSSIER(501, { type: 'formule', formule_id: 'disparue', label: 'Ancienne formule', lanes: [], pax: 8, duration: 1, total_duration: 2, base_price: 50, price: 50 });
  x = await essai(roleDePrix('non'), { pax: 9, price: 50 }, sansTarif());
  v(x.statut === 200 && Number(enBase(501).base_price) === 50 && Number(enBase(501).pax) === 9, '[P] sans tarif calculable, le groupe change et la base reste', `${dire(x)} base ${enBase(501).base_price}`);
  // Les valeurs vides.
  x = await essai(roleDePrix('non'), { price: '', name: 'Sans prix' });
  v(x.statut === 200 && Number(enBase(501).price) === 60, '[P] un prix vide ne vaut pas 0', dire(x));
  x = await essai(roleDePrix('non'), { price: null, name: 'Sans prix' });
  v(x.statut === 200 && Number(enBase(501).price) === 60, '[P] un prix nul ne vaut pas 0', dire(x));
  return liste;
}

// ---------------------------------------------------------------------------
// [J] UN CENTRE QUI VEND AUX PARTIES : le moteur reprend la base qu on lui passe.
// ---------------------------------------------------------------------------
function jourSuivant(date, numeroDeJour) {
  const jour = new Date(`${date}T12:00:00Z`);
  do { jour.setUTCDate(jour.getUTCDate() + 1); } while (jour.getUTCDay() !== numeroDeJour);
  return jour.toISOString().slice(0, 10);
}

async function groupeParties(mutations = []) {
  const { liste, v } = verdicts();
  const pricing = { mode: 'per_game_per_person', minutesPerGame: 60, tiers: [{ days: [3, 4], prices: [6, 11] }, { days: [5, 6, 0], prices: [7, 13] }] };
  B.base.centers = [{ id: 'libramont', name: 'Libramont', status: 'active', timezone: 'Europe/Brussels', settings: { config: { resources: { bowling: { pricing } } } } }];
  const ligne = () => DOSSIER(501, { base_price: 28, price: 28, pax: 4, lanes: [1], label: 'Bowling Classique' });
  B.semer([ligne()]);
  const m = monter(mutations);
  const essai = async (s, corps) => { B.semer([ligne()]); return m.modifier(s, { id: 501, ...corps }); };
  const jourDe = new Date(`${B.JOUR}T12:00:00Z`).getUTCDay();
  v(jourDe === 6 || jourDe === 5 || jourDe === 0, '[J] MONTAGE le jour du banc est au tarif de 7 EUR', jourDe);
  let x = await essai(roleDePrix('non'), { pax: 5, price: 20, basePrice: 20 });
  v(x.statut === 403 && x.code === 'prix_niveau_insuffisant' && Number(enBase(501).pax) === 4, '[J] une base forgee que le moteur reprendrait : refus, rien d ecrit', dire(x));
  x = await essai(roleDePrix('non'), { pax: 5, price: 35, basePrice: 20 });
  v(x.statut === 200 && Number(enBase(501).base_price) === 35, '[J] le prix juste passe, et la base ecrite est celle du serveur', `${dire(x)} base ${enBase(501).base_price}`);
  const mercredi = jourSuivant(B.JOUR, 3);
  x = await essai(roleDePrix('non'), { date: mercredi, price: 24, basePrice: 24, allowPastStart: true });
  v(x.statut === 200 && Number(enBase(501).base_price) === 24 && Number(enBase(501).price) === 24, '[J] le meme dossier deplace un jour moins cher suit le tarif du jour', `${dire(x)} base ${enBase(501).base_price}`);
  // Un dossier deplace d une heure ne rouvre pas un ancien tarif.
  B.semer([DOSSIER(501, { base_price: 20, price: 20, pax: 4, lanes: [1], label: 'Bowling Classique' })]);
  x = await m.modifier(roleDePrix('non'), { id: 501, startTime: '16:00', allowPastStart: true });
  v(x.statut === 200 && Number(enBase(501).base_price) === 20 && enBase(501).start_time === '16:00', '[J] une heure de plus ne rouvre pas la base d un ancien tarif', `${dire(x)} base ${enBase(501).base_price}`);
  // Un programme sur ce centre : le moteur calcule sa base, elle ne se reprend pas.
  x = await essai(roleDePrix('non'), { program: [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1 }], allowPastStart: true });
  v(x.statut === 200 && Number(enBase(501).base_price) > 28 && Number(enBase(501).base_price) === Number(enBase(501).price), '[J] un programme garde la base du moteur, pas le tarif du bowling seul', `${dire(x)} base ${enBase(501).base_price} prix ${enBase(501).price}`);
  B.base.centers = [];
  return liste;
}

// ---------------------------------------------------------------------------
// [E] LES EXTRAS D UN PATCH.
// ---------------------------------------------------------------------------
async function groupeExtrasPatch(mutations = []) {
  const { liste, v } = verdicts();
  const ancienne = { id: 'nourriture-1', name: 'Pizza × 2', price: 20 };
  const signee = { id: 'n', name: 'Gateau × 1', price: 30, par: 'Lea', le: '2026-10-01T10:00:00.000Z', categorie: 'nourriture' };
  const ligne = () => DOSSIER(501, { base_price: 60, price: 110, extras: [ancienne, signee] });
  B.semer([ligne()]);
  B.base.centers = [{ id: 'libramont', name: 'Libramont', status: 'active', timezone: 'Europe/Brussels', settings: { config: { surMesure: {
    categories: [{ id: 'nourriture', nom: 'Nourriture' }, { id: 'boissons', nom: 'Boissons' }, { id: 'decoration', nom: 'Décoration' }],
    articles: [
      { id: 'pizza-margherita', nom: 'Pizza Margherita', categorie: 'nourriture', prix: 14, unite: 'piece', heure: true, actif: true },
      { id: 'cruche', nom: 'Cruche maison', categorie: 'boissons', prix: 6, unite: 'joueur', heure: false, actif: true },
      { id: 'arche', nom: 'Arche de ballons', categorie: 'decoration', prix: 150, unite: 'piece', heure: false, actif: true },
    ],
  } } } }];
  const m = monter(mutations);
  const essai = async (s, corps) => { B.semer([ligne()]); return m.modifier(s, { id: 501, ...corps }); };
  const refait = [{ id: 'autre-id', name: 'pizza × 2', price: 20 }, { id: 'autre', name: 'Gateau × 1', price: 30, par: 'Faux', le: '2020-01-01' }];
  let x = await essai(roleDeMesure('non'), { extras: refait, price: 110 });
  const ecrites = enBase(501).extras;
  v(x.statut === 200 && ecrites.length === 2 && ecrites[1].par === 'Lea' && ecrites[1].le === signee.le, '[E] niveau non : les lignes deja la passent, leur auteur reste, ids refaits ou pas', { reponse: dire(x), ecrites });
  v(JSON.stringify(Object.keys(ecrites[0])) === JSON.stringify(['id', 'name', 'price']) && ecrites[0].price === 20, '[E] une ancienne ligne ressort a l identique', ecrites[0]);
  x = await essai(roleDeMesure('non'), { extras: [ancienne, signee, { name: 'Cafe', price: 3 }], price: 113 });
  v(x.statut === 403 && x.code === 'sur_mesure_refuse' && enBase(501).extras.length === 2, '[E] niveau non : une ligne nouvelle, refus, rien d ecrit', dire(x));
  x = await essai(roleDeMesure('non'), { extras: [{ ...ancienne, price: 2 }, signee], price: 92 });
  v(x.statut === 403 && x.code === 'sur_mesure_refuse', '[E] niveau non : changer le prix d une ligne, c est une ligne changee', dire(x));
  x = await essai(roleDeMesure('non'), { extras: [ancienne], price: 80 });
  v(x.statut === 200 && enBase(501).extras.length === 1 && Number(enBase(501).price) === 80, '[E] retirer une ligne reste permis, le prix suit', dire(x));
  x = await essai(roleDeMesure('libre', 'libre'), { extras: [ancienne], price: 110, prixRaison: 'Garde tel quel' });
  const garde = notesDe(enBase(501)).find((n) => n.type === 'prix');
  v(x.statut === 200 && garde && garde.prix.de === 80 && garde.prix.a === 110, '[E] un prix garde malgre une ligne retiree : la trace part de la nouvelle reference', { reponse: dire(x), garde });
  x = await essai(roleDeMesure('non'), { extras: [ancienne] });
  v(x.statut === 200 && Number(enBase(501).price) === 80 && !notesDe(enBase(501)).some((n) => n.type === 'prix'), '[E] une ligne retiree sans prix envoye : le prix suit (80 EUR), aucune trace', dire(x));
  x = await essai(roleDeMesure('non'), { extras: [{ ...ancienne, heure: '15:30', note: 'Pour le gouter' }, signee], price: 110 });
  const precisee = (enBase(501).extras || [])[0] || {};
  v(x.statut === 200 && precisee.heure === '15:30' && precisee.note === 'Pour le gouter', '[E] l heure et la note d une ligne deja la se precisent sans la rejuger', { reponse: dire(x), precisee });
  x = await essai(roleDeMesure('catalogue'), { extras: [ancienne, signee, PIZZA_CARTE], price: 138 });
  const pizza = (enBase(501).extras || [])[2];
  v(x.statut === 200 && pizza && pizza.price === 28 && pizza.prixUnitaire === 14 && pizza.par === NOM, '[E] catalogue : la ligne nouvelle est recalculee, les autres ne sont pas jugees', { reponse: dire(x), pizza });
  x = await essai(roleDeMesure('catalogue'), { extras: [ancienne, signee, { name: 'Cheval', price: 1 }], price: 111 });
  v(x.statut === 403 && x.code === 'sur_mesure_hors_catalogue', '[E] catalogue : hors catalogue, refus', dire(x));
  x = await essai(roleDeMesure('libre', 'libre'), { extras: [ancienne, signee, { name: 'Lustre', price: 100001 }], price: 100 });
  v(x.statut === 422 && x.code === 'prix_invalide', '[E] au dela de 100 000 EUR : refus', dire(x));
  x = await essai(roleDeMesure('non'), { extras: 'rien du tout', name: 'Sans liste' });
  v(x.statut === 200 && enBase(501).extras.length === 2, '[E] des extras qui ne sont pas une liste n effacent rien', dire(x));
  x = await essai(roleDeMesure('non'), { extras: [ancienne, ancienne, signee], price: 130 });
  v(x.statut === 403 && x.code === 'sur_mesure_refuse' && enBase(501).extras.length === 2, '[E] une ligne dupliquee n est pas une ligne deja la', dire(x));
  x = await essai(roleDeMesure('libre', 'libre'), { extras: [ancienne, signee, { name: 'Remise', price: -200 }], price: 0 });
  v(x.statut === 200 && Number(enBase(501).price) === 0 && !notesDe(enBase(501)).length, '[E] une remise plus grande que le dossier : la reference s arrete a zero, aucun ecart', dire(x));
  x = await essai(roleDeMesure('catalogue', 'libre'), { extras: [ancienne, signee, { articleId: 'arche', qte: 999, name: 'Arche', price: 1 }], price: 110, prixRaison: 'Geste' });
  v(x.statut === 422 && x.code === 'prix_invalide' && enBase(501).extras.length === 2, '[E] catalogue : une ligne calculee au dela de 100 000 EUR : refus', dire(x));
  x = await essai(roleDeMesure('catalogue'), { pax: 6, extras: [ancienne, signee, { articleId: 'cruche', name: 'Cruche', price: 0 }], price: 146 });
  const cruche = (enBase(501).extras || [])[2] || {};
  v(x.statut === 200 && cruche.qte === 6 && cruche.price === 36, '[E] un article par joueur suit le nouveau groupe, pas l ancien', { reponse: dire(x), cruche });
  B.base.centers = [];
  // La derniere barriere, sous les gardes : la lib borne ce qu elle ecrit.
  B.semer([ligne()]);
  await m.S.db.updateReservation({ id: 501, centerId: 'libramont', extras: [
    { name: 'Fou', price: 200000, articleId: 'a'.repeat(99), qte: 'beaucoup', heure: '25:99', note: `<b>${'n'.repeat(300)}</b>` },
    { name: 'Mille', price: 1, qte: 1000, heure: '9:30' },
    { name: 'Demi', price: 1, qte: 2.5, heure: '09:3' },
    { name: 'Juste', price: 1, qte: 999, heure: '23:59', inconnu: 'garde' },
  ] }).catch(() => null);
  const [borne = {}, mille = {}, demi = {}, juste = {}] = enBase(501).extras || [];
  v(borne.price === 100000 && borne.articleId.length === 60 && borne.qte === undefined && borne.heure === undefined && borne.note.length === 200 && !/[<>]/.test(borne.note)
    && mille.qte === undefined && mille.heure === undefined && demi.qte === undefined && demi.heure === undefined
    && juste.qte === 999 && juste.heure === '23:59' && juste.inconnu === undefined, '[E] normalizeExtras borne le prix et les champs', enBase(501).extras);
  return liste;
}

// ---------------------------------------------------------------------------
// [F] LA FORMULE D UN PATCH.
// ---------------------------------------------------------------------------
async function groupeFormulePatch(mutations = []) {
  const { liste, v } = verdicts();
  const f1 = () => DOSSIER(701, { type: 'formule', formule_id: 'f1', label: 'FORMULE 1', pax: 8, lanes: [1, 2], duration: 1, total_duration: 2, base_price: 208, price: 208 });
  B.semer([f1()]);
  const m = monter(mutations);
  const non = session(EDITE, { ...TOUT_NON, prix: 'libre', formule: 'non' });
  const oui = session(EDITE, { ...TOUT_NON, prix: 'libre', formule: 'oui' });
  const essai = async (s, corps) => { B.semer([f1()]); return m.modifier(s, { id: 701, prixRaison: 'Geste', ...corps }); };
  let x = await essai(non, { label: 'FORMULE 1 (adaptée)' });
  v(x.statut === 403 && x.code === 'formule_niveau_insuffisant' && enBase(701).label === 'FORMULE 1', '[F] « (adaptée) » pose, niveau non : refus, rien d ecrit', dire(x));
  x = await essai(oui, { label: 'FORMULE 1 (adaptée)' });
  v(x.statut === 200 && /adaptée/.test(enBase(701).label), '[F] « (adaptée) » pose, niveau oui : passe', dire(x));
  x = await essai(non, { program: [{ activityId: 'bowling', duration: 1 }], allowPastStart: true });
  v(x.statut === 403 && x.code === 'formule_niveau_insuffisant', '[F] une activite retiree, niveau non : refus', dire(x));
  x = await essai(non, { program: [{ activityId: 'bowling', duration: 2 }, { activityId: 'laser_game', games: 1 }, { activityId: 'arcade_time' }], allowPastStart: true });
  v(x.statut === 403 && x.code === 'formule_niveau_insuffisant', '[F] la duree du bowling changee, niveau non : refus', dire(x));
  x = await essai(non, { program: [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 2 }, { activityId: 'arcade_time' }], allowPastStart: true });
  v(x.statut === 403 && x.code === 'formule_niveau_insuffisant', '[F] les parties de laser changees, niveau non : refus', dire(x));
  x = await essai(non, { program: [{ activityId: 'bowling', duration: 1, participants: 8 }, { activityId: 'laser_game', games: 1, participants: 8 }, { activityId: 'arcade_time', participants: 8 }], allowPastStart: true });
  v(x.code !== 'formule_niveau_insuffisant', '[F] le meme contenu renvoye en programme n adapte rien', dire(x));
  x = await essai(non, { program: [{ id: 'bowling', duration: 1 }, { id: 'laser_game', extraLaser: { games: 1 } }, { id: 'arcade_time' }], allowPastStart: true });
  v(x.code !== 'formule_niveau_insuffisant', '[F] le meme contenu sous la forme stockee n adapte rien', dire(x));
  x = await essai(non, { program: { items: [{ activityId: 'bowling', duration: 1 }] }, allowPastStart: true });
  v(x.statut === 403 && x.code === 'formule_niveau_insuffisant', '[F] un programme emballe dans items se lit pareil : refus', dire(x));
  x = await essai(non, { formulaId: 'f2', program: [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1 }, { activityId: 'arcade_time' }], allowPastStart: true });
  v(x.statut === 403 && x.code === 'formule_niveau_insuffisant', '[F] le contenu de f1 sous le nom de f2, par formulaId : refus', dire(x));
  x = await essai(non, { name: 'Sans programme' });
  v(x.statut === 200 && enBase(701).name === 'Sans programme', '[F] un PATCH sans programme n adapte rien', dire(x));
  x = await essai(non, { name: 'Programme vide', program: [] });
  v(x.code !== 'formule_niveau_insuffisant', '[F] un programme vide n adapte rien', dire(x));
  x = await essai(non, { formuleId: 'f2', program: [{ activityId: 'bowling', duration: 1 }], allowPastStart: true });
  v(x.statut === 403 && x.code === 'formule_niveau_insuffisant', '[F] une autre formule avec un programme a soi : refus', dire(x));
  x = await essai(non, { formuleId: '', formulaId: '', type: 'visite', program: [{ activityId: 'bowling', duration: 1 }], allowPastStart: true });
  v(x.statut === 403 && x.code === 'formule_niveau_insuffisant', '[F] quitter la formule en gardant une partie de son contenu : refus', dire(x));
  x = await essai(non, { formuleId: 'f2', label: 'FORMULE 2', program: null, opsPlan: null, allowPastStart: true });
  v(x.code !== 'formule_niveau_insuffisant', '[F] passer a une autre formule sans programme n adapte rien', dire(x));
  B.semer([DOSSIER(502, { type: 'bowling', label: 'Bowling' })]);
  m.changerSession(non);
  const simple = await m.appeler('PATCH', URL_RESA, { id: 502, centerId: 'libramont', label: 'Bowling (adaptée)' });
  v(simple.statut === 403 && simple.json.code === 'formule_niveau_insuffisant', '[F] le mot sur un dossier sans formule : refus', `${simple.statut} ${simple.json.message || ''}`);
  // Le mot deja pose.
  const adaptee = () => DOSSIER(703, { type: 'formule', formule_id: 'f1', label: 'FORMULE 1 (adaptée)', pax: 8, lanes: [1, 2], duration: 1, total_duration: 2, base_price: 208, price: 208 });
  B.semer([adaptee()]);
  x = await m.modifier(non, { id: 703, label: 'FORMULE 1' });
  v(x.statut === 403 && x.code === 'formule_niveau_insuffisant' && /adaptée/.test(enBase(703).label), '[F] « (adaptée) » retire, niveau non : refus, rien d ecrit', dire(x));
  B.semer([adaptee()]);
  x = await m.modifier(non, { id: 703, label: 'FORMULE 1 (adaptée)', name: 'Meme mot' });
  v(x.statut === 200 && enBase(703).name === 'Meme mot', '[F] le meme libelle renvoye n adapte rien', dire(x));
  // Une visite composee n a pas de formule a adapter.
  B.semer([DOSSIER(504, { type: 'visite', label: 'Visite', pax: 4, lanes: [1], program: [{ activityId: 'bowling', duration: 1 }] })]);
  x = await m.modifier(non, { id: 504, program: [{ activityId: 'bowling', duration: 2 }], allowPastStart: true });
  v(x.code !== 'formule_niveau_insuffisant', '[F] le programme d une visite se change sans le niveau formule', dire(x));
  // Une formule retiree de la carte : rien a comparer, rien a refuser.
  B.semer([DOSSIER(705, { type: 'formule', formule_id: 'disparue', label: 'Ancienne formule', pax: 8, lanes: [1, 2], duration: 1, total_duration: 2, base_price: 208, price: 208 })]);
  x = await m.modifier(non, { id: 705, program: [{ activityId: 'bowling', duration: 1 }], allowPastStart: true });
  v(x.code !== 'formule_niveau_insuffisant', '[F] une formule retiree de la carte ne se compare pas, elle ne refuse pas', dire(x));
  return liste;
}

// ---------------------------------------------------------------------------
// [O] LES NOTES.
// ---------------------------------------------------------------------------
async function groupeNotes(mutations = []) {
  const { liste, v } = verdicts();
  const raison = `[equipe] ${JSON.stringify({ t: 'Prix 60 € → 40 €, geste', par: 'Lea', le: '2026-10-01T10:00:00.000Z', type: 'prix', prix: { de: 60, a: 40, raison: 'geste' } })}`;
  const mot = 'Mot du client';
  const notes = `${mot}\n${raison}`;
  const ligne = () => DOSSIER(501, { notes });
  B.semer([ligne()]);
  const m = monter(mutations);
  const statut = session(STATUT);
  const essai = async (s, corps) => { B.semer([ligne()]); return m.modifier(s, { id: 501, ...corps }); };
  let x = await essai(statut, { notes: `${notes}\nUne ligne de plus` });
  v(x.statut === 200 && enBase(501).notes === `${notes}\nUne ligne de plus`, '[O] sans reservations.edit : ajouter a la fin passe', dire(x));
  x = await essai(statut, { notes: mot });
  v(x.statut === 403 && x.code === 'notes_ajout_seulement' && enBase(501).notes === notes, '[O] retirer la raison du prix : 403, rien d ecrit (trou 3)', dire(x));
  x = await essai(statut, { notes: '' });
  v(x.statut === 403 && x.code === 'notes_ajout_seulement', '[O] vider les notes : 403', dire(x));
  x = await essai(statut, { notes: `Mot change\n${raison}` });
  v(x.statut === 403 && x.code === 'notes_ajout_seulement', '[O] modifier une ligne : 403', dire(x));
  x = await essai(statut, { notes: `Avant\n${notes}` });
  v(x.statut === 403 && x.code === 'notes_ajout_seulement', '[O] inserer devant : 403', dire(x));
  x = await essai(statut, { status: 'arrived', notes: mot });
  v(x.statut === 403 && x.code === 'notes_ajout_seulement' && enBase(501).status === 'confirmed', '[O] glisser des notes avec un statut ne contourne rien', dire(x));
  x = await essai(session(EDITE), { notes: mot });
  v(x.statut === 200 && enBase(501).notes === mot, '[O] avec reservations.edit : modifier passe', dire(x));
  const forge = `[equipe] ${JSON.stringify({ t: 'Offert', par: 'Movsar', le: '2026-10-01T10:00:00.000Z', type: 'prix', prix: { de: 60, a: 0 } })}`;
  x = await essai(statut, { notes: `${notes}\n${forge}` });
  const dernieres = notesDe(enBase(501));
  v(x.statut === 200 && dernieres.length === 2 && dernieres[1].par === NOM && !dernieres[1].type && dernieres[1].le !== '2026-10-01T10:00:00.000Z' && dernieres[0].par === 'Lea', '[O] une ligne ajoutee au nom d un autre : resignee, la cle `le` reste unique', dernieres);
  x = await essai(statut, { notes: `${notes}\n${forge}\n${forge.replace('Offert', 'Encore offert')}` });
  const deux = notesDe(enBase(501)).slice(1);
  v(x.statut === 200 && deux.length === 2 && deux[0].le !== deux[1].le, '[O] deux lignes dans le meme envoi : deux cles', deux);
  x = await essai(statut, { notes: `${notes}\n${raison}` });
  const copie = notesDe(enBase(501));
  v(x.statut === 200 && copie.length === 2 && copie[0].par === 'Lea' && copie[1].par === NOM && !copie[1].type, '[O] recopier la ligne d une collegue : la copie est a la session', copie);
  const balise = `[equipe] ${JSON.stringify({ t: 'Offert <img src=x onerror=1>', par: 'Movsar', le: '2026-10-01T10:00:00.000Z' })}`;
  x = await essai(statut, { notes: `${notes}\n${balise}` });
  v(x.statut === 200 && !/<|onerror=1>/.test(notesDe(enBase(501))[1].t), '[O] une ligne forgee ne garde pas ses balises', notesDe(enBase(501)));
  const vide = `[equipe] ${JSON.stringify({ t: ' <> ', par: 'Movsar', le: '2026-10-01T10:00:00.000Z' })}`;
  x = await essai(statut, { notes: `${notes}\n${vide}` });
  v(x.statut === 200 && enBase(501).notes === notes, '[O] une ligne forgee sans texte tombe', enBase(501).notes);
  // La cle `le` d une trace ne prend jamais celle d une ligne deja la.
  const maintenant = new Date('2026-11-03T10:00:00.000Z');
  const prise = `[equipe] ${JSON.stringify({ t: 'Deja la', par: 'Lea', le: maintenant.toISOString() })}`;
  const parTrace = m.S.db.notesAvecPrix(prise, { de: 60, a: 50, raison: 'Geste', par: NOM, maintenant }).split('\n').map((t) => JSON.parse(t.slice(9)));
  v(parTrace[0].le !== parTrace[1].le, '[O] une trace de prix prend une cle libre', parTrace);
  const parSigne = m.S.db.signerNotesEquipe(`${prise}\n${forge}`, { avant: prise, par: NOM, maintenant }).split('\n').map((t) => JSON.parse(t.slice(9)));
  v(parSigne[0].le !== parSigne[1].le, '[O] une ligne resignee prend une cle libre', parSigne);
  x = await essai(session(EDITE), { notes: `${notes}\n${forge}` });
  v(x.statut === 200 && notesDe(enBase(501))[1].par === NOM, '[O] meme avec le droit de modifier, l auteur vient de la session', notesDe(enBase(501)));
  x = await essai(session(EDITE), { notes: null, name: 'Sans notes' });
  v(x.statut === 200 && enBase(501).notes === notes, '[O] des notes nulles ne vident rien', dire(x));
  x = await essai(statut, { noteEquipe: { retrait: '2026-10-01T10:00:00.000Z' } });
  v(x.statut === 403 && x.code === 'notes_ajout_seulement' && enBase(501).notes === notes, '[O] noteEquipe retrait sans le droit : 403', dire(x));
  x = await essai(statut, { noteEquipe: { modifier: { le: '2026-10-01T10:00:00.000Z', baseText: 'Prix 60 € → 40 €, geste', texte: 'Autre chose' } } });
  v(x.statut === 403 && x.code === 'notes_ajout_seulement' && enBase(501).notes === notes, '[O] noteEquipe modifier sans le droit : 403', dire(x));
  x = await essai(statut, { noteEquipe: { ajout: 'Le groupe arrive en retard' } });
  v(x.statut === 200 && notesDe(enBase(501)).pop().par === NOM, '[O] noteEquipe ajout : un geste d accueil, a l auteur de la session', dire(x));
  x = await essai(session(EDITE), { noteEquipe: { retrait: '2026-10-01T10:00:00.000Z' } });
  v(x.statut === 200 && !notesDe(enBase(501)).length, '[O] noteEquipe retrait avec le droit : passe', dire(x));
  return liste;
}

// ---------------------------------------------------------------------------
// [U] LE CANAL PUBLIC.
// ---------------------------------------------------------------------------
async function groupePublic(mutations = []) {
  const { liste, v } = verdicts();
  B.semer([]);
  const m = monter(mutations);
  const S = m.S;
  const forgeNote = `[equipe] ${JSON.stringify({ t: 'Prix 60 € → 0 €', par: 'Direction', le: '2020-01-01T00:00:00.000Z', type: 'prix', prix: { de: 60, a: 0 } })}`;
  const corps = (extra = {}) => banc.avecContact(banc.BOWLING('15:00', {
    extras: [{ id: 'cadeau', name: 'Remise', price: -30 }, { id: 'x', name: 'Pizza', price: 5 }],
    notes: `Bonjour, c est pour un anniversaire\n${forgeNote}\n[ops:retard] faux retard`,
    ...extra,
  }));
  const conf = await banc.confirmer(S, corps());
  const ligne = [...B.base.reservations.values()].find((r) => r.channel === 'public');
  v(conf.statut === 201 && ligne, '[U] MONTAGE un POST public force passe par le vrai handler', `${conf.statut} ${conf.json && conf.json.message}`);
  v(ligne && Array.isArray(ligne.extras) && ligne.extras.length === 0, '[U] les extras du corps ne s ecrivent pas (trou 2)', ligne && ligne.extras);
  v(ligne && Number(ligne.price) === Number(ligne.base_price) && Number(ligne.price) > 0, '[U] aucun faux prix ajuste : prix et reference du serveur', ligne && `${ligne.base_price} ${ligne.price}`);
  v(ligne && !/\[equipe\]|\[ops:/.test(ligne.notes) && /anniversaire/.test(ligne.notes), '[U] le mot du client reste, les fausses traces tombent', ligne && ligne.notes);
  B.semer([]);
  await banc.confirmer(S, corps({ channel: 'staff', label: 'Offert par la direction' }));
  const faux = [...B.base.reservations.values()][0];
  v(faux && faux.channel === 'public' && !/Offert/.test(faux.label) && faux.extras.length === 0, '[U] un corps qui se dit staff ne change ni le canal, ni le libelle, ni les extras', faux && `${faux.channel} ${faux.label}`);
  // Avec ses horaires retenus, la confirmation ne repasse pas par le moteur : le
  // libelle de la premiere lecture du corps est celui qui s ecrit.
  B.semer([]);
  const retenu = banc.BOWLING('15:00', { channel: 'staff', label: 'Offert par la direction' });
  const tenu = await banc.retenir(S, retenu);
  await banc.confirmer(S, banc.avecContact({ ...retenu, holdToken: tenu.json.holdToken }));
  const fauxRetenu = [...B.base.reservations.values()][0];
  v(tenu.statut === 201 && fauxRetenu && !/Offert/.test(fauxRetenu.label), '[U] un corps qui se dit staff, horaires retenus : le libelle reste celui du serveur', fauxRetenu && fauxRetenu.label);
  B.semer([]);
  await banc.confirmer(S, banc.avecContact({ centerId: 'libramont', date: B.JOUR, startTime: '15:00', pax: 4, type: 'bowling', duration: 1, totalDuration: 1, label: 'Bowling (adaptée)', preference: {} }));
  const mot = [...B.base.reservations.values()][0];
  v(mot && !/adapt/i.test(mot.label), '[U] « (adaptée) » ne s ecrit pas depuis le tunnel', mot && mot.label);
  B.semer([]);
  const dup = await banc.confirmer(S, banc.avecContact(banc.visite('15:00', [{ activityId: 'arcade_time', arcadeMode: 'credit', arcadeOfferId: 'credit-25', cards: 4, sansHeure: true }], { extras: [{ id: 'arcades-temps', price: 45 }] })));
  v(dup.statut >= 400 && dup.statut < 500 && B.base.reservations.size === 0, '[U] le doublon d arcades reste refuse, pas seulement efface', `${dup.statut} ${dup.json && dup.json.message}`);
  return liste;
}

// ---------------------------------------------------------------------------
// [K] LE CATALOGUE.
// ---------------------------------------------------------------------------
function carteDuMenu(centre) {
  const html = fs.readFileSync(path.join(ROOT, `menu/${centre}/index.html`), 'utf8');
  const debut = html.indexOf('aria-label="Transcription texte de la carte"');
  const bloc = html.slice(debut, html.indexOf('</section>', debut));
  const prix = (t) => Number(t.replace('€', '').trim().replace(',', '.'));
  const attendus = [];
  for (const [, titre, corps] of bloc.matchAll(/<h3>([^<]+)<\/h3>\s*<ul>([\s\S]*?)<\/ul>/g)) {
    for (const [, li] of corps.matchAll(/<li>([^<]+)<\/li>/g)) {
      const unique = /:\s*(\d+) €$/.exec(titre);
      if (unique) { attendus.push(`${/^\d+\.\s+([^:]+?)\s+:/.exec(li)[1]}=${Number(unique[1])}`); continue; }
      const coupe = li.lastIndexOf(' : ');
      const nom = li.slice(0, coupe).trim();
      const valeur = li.slice(coupe + 3).trim();
      if (valeur.includes('/')) {
        const [a, b] = valeur.split('/');
        const racine = nom.replace(' 25 cl / 33 cl', '');
        attendus.push(`${racine} 25 cl=${prix(a)}`, `${racine} 33 cl=${prix(b)}`);
      } else if (titre === 'Granitas') attendus.push(`Granita (${nom.charAt(0).toLowerCase()}${nom.slice(1)})=${prix(valeur)}`);
      else if (titre.startsWith('Pizzas')) attendus.push(`Pizza ${nom}=${prix(valeur)}`);
      else attendus.push(`${nom}=${prix(valeur)}`);
    }
  }
  return attendus.sort();
}

async function groupeCatalogue(mutations = []) {
  const { liste, v } = verdicts();
  B.semer([]);
  B.base.centers = [{ id: 'libramont', name: 'Libramont', status: 'active', timezone: 'Europe/Brussels', settings: {} }];
  const m = monter(mutations, session(['reservations.view', 'pricing.manage']));
  const config = require(path.join(ROOT, 'lib/center-config.js'));
  const { normalizeSurMesure, catalogueSurMesure, catalogueSurMesureParDefaut } = config;
  const BON = { categories: [{ id: 'nourriture', nom: 'Nourriture' }], articles: [{ id: 'a', nom: 'Article', categorie: 'nourriture', prix: 3, unite: 'piece', heure: false, actif: true }] };
  const article = (champs) => ({ categories: BON.categories, articles: [{ ...BON.articles[0], ...champs }] });
  const refuse = (entree) => { try { normalizeSurMesure(entree, { strict: true }); return false; } catch (error) { return error.statusCode === 422 && error.expose === true; } };
  v(normalizeSurMesure(null) === null && !refuse(undefined), '[K] rien n est decide : null, le defaut se lit a la demande');
  v(refuse({ categories: [], articles: 'x' }) && normalizeSurMesure({ categories: [], articles: 'x' }) === null, '[K] une forme fausse : refus a l ecriture, ignoree a la lecture');
  const lu = normalizeSurMesure(article({ prix: 3.456, heure: undefined, actif: undefined })).articles[0];
  v(lu.prix === 3.46 && lu.heure === false && lu.actif === true, '[K] sans interrupteur : pas d heure, article actif, prix au centime', lu);
  v(refuse(article({ prix: -1 })), '[K] prix negatif : refus');
  v(refuse(article({ prix: 100001 })), '[K] prix au dela de 100 000 : refus');
  v(refuse(article({ prix: 'abc' })) && refuse(article({ prix: '' })) && refuse(article({ prix: null })), '[K] prix illisible : refus');
  v(normalizeSurMesure(article({ prix: 'abc' })).articles.length === 0 && normalizeSurMesure(article({ prix: '' })).articles.length === 0, '[K] un prix illisible ne devient jamais 0 (« a saisir ») a la lecture');
  v(refuse(article({ categorie: 'absente' })), '[K] categorie absente : refus');
  v(refuse(article({ id: 'Avec Espace' })), '[K] identifiant instable : refus');
  v(refuse(article({ nom: 'x'.repeat(81) })) && refuse(article({ nom: '  ' })), '[K] nom vide ou trop long : refus');
  v(refuse(article({ unite: 'kilo' })), '[K] unite inconnue : refus');
  v(refuse(article({ actif: 'oui' })) && refuse(article({ heure: 1 })), '[K] interrupteur non booleen : refus');
  v(refuse({ categories: BON.categories, articles: [BON.articles[0], BON.articles[0]] }), '[K] article en double : refus');
  v(refuse({ categories: [BON.categories[0], BON.categories[0]], articles: [] }), '[K] categorie en double : refus');
  v(refuse({ categories: BON.categories, articles: Array.from({ length: 401 }, (_, i) => ({ ...BON.articles[0], id: `a${i}` })) }), '[K] 401 articles : refus');
  v(refuse({ categories: Array.from({ length: 31 }, (_, i) => ({ id: `c${i}`, nom: 'C' })), articles: [] }), '[K] 31 categories : refus');
  v(refuse({ categories: [{ id: 'Avec Espace', nom: 'C' }], articles: [] }), '[K] categorie a l identifiant instable : refus');
  v(refuse({ categories: [{ id: 'c', nom: 'x'.repeat(81) }], articles: [] }) && refuse({ categories: [{ id: 'c', nom: ' ' }], articles: [] }), '[K] categorie au nom vide ou trop long : refus');
  v(refuse({ categories: [{ id: 'c', nom: 'C', actif: 'non' }], articles: [] }), '[K] categorie a l interrupteur non booleen : refus');
  v(normalizeSurMesure({ categories: BON.categories, articles: Array.from({ length: 401 }, (_, i) => ({ ...BON.articles[0], id: `a${i}` })) }).articles.length === 400, '[K] a la lecture, 400 articles au plus');
  v(normalizeSurMesure({ categories: Array.from({ length: 31 }, (_, i) => ({ id: `c${i}`, nom: 'C' })), articles: [] }).categories.length === 30, '[K] a la lecture, 30 categories au plus');
  v(normalizeSurMesure(article({ nom: 'Pizza <b>' })).articles[0].nom === 'Pizza b', '[K] un nom ne porte pas de balise');
  const defaut = catalogueSurMesureParDefaut();
  v(JSON.stringify(defaut.categories.map((c) => c.nom)) === JSON.stringify(['Nourriture', 'Boissons', 'Gâteaux', 'Décoration', 'Autre']) && defaut.articles.every((a) => a.prix === 0) && defaut.articles.length === 13,
    '[K] le catalogue par defaut : cinq categories, treize articles, prix a saisir', defaut.articles.length);
  v(normalizeSurMesure(defaut, { strict: true }) !== null, '[K] le catalogue par defaut passe ses propres bornes');
  v(JSON.stringify(catalogueSurMesure('ciney')) === JSON.stringify(defaut), '[K] un centre sans catalogue recoit le defaut, pas celui d un voisin');
  let inconnu = '';
  try { catalogueSurMesure('centre-inconnu'); } catch (error) { inconnu = error.message; }
  v(/inconnu/i.test(inconnu), '[K] un centre inconnu ne tombe pas sur un autre', inconnu);
  v(JSON.stringify(catalogueSurMesure('')) === JSON.stringify(defaut), '[K] sans centre nomme, jamais le catalogue de Libramont');
  // La vraie carte, relue dans le HTML.
  const centres = require(path.join(ROOT, 'ops-knowledge/centers.json')).centers;
  for (const centre of ['libramont', 'gembloux']) {
    const articles = centres.find((c) => c.id === centre).surMesure.articles;
    const ecrit = articles.map((a) => `${a.nom}=${a.prix}`).sort();
    const attendu = carteDuMenu(centre);
    const manque = attendu.filter((x) => !ecrit.includes(x));
    const invente = ecrit.filter((x) => !attendu.includes(x));
    v(attendu.length > 80 && !manque.length && !invente.length, `[K] ${centre} : chaque plat et chaque prix de la carte, aucun d invente (${ecrit.length})`, { manque, invente });
    v(normalizeSurMesure(centres.find((c) => c.id === centre).surMesure, { strict: true }).articles.length === articles.length, `[K] ${centre} : la carte passe les bornes du centre`);
    const fausse = [...ecrit, 'Pizza Hawaienne=9'];
    v(fausse.filter((x) => !attendu.includes(x)).length === 1, `[K] ${centre} : un plat invente serait vu`);
  }
  // Les portes d api/ops.js, sur le vrai handler. Le journal bloquant est double
  // avant le chargement d api/ops.js : il dit ce qu il voit au moment de la trace,
  // et il sait tomber en panne.
  const audit = require(path.join(ROOT, 'lib/audit-log.js'));
  const traces = [];
  let journalEnPanne = false;
  audit.writeAuditLogOrThrow = async (entree) => {
    if (journalEnPanne) throw Object.assign(new Error('Action refusee : sa trace d audit n a pas pu etre enregistree.'), { statusCode: 503, expose: true });
    traces.push({ action: entree.action, type: entree.entityType, id: entree.entityId, dejaEcrit: Boolean((B.base.centers[0].settings.config || {}).surMesure) });
    return { ok: true };
  };
  const ops = require(path.join(ROOT, 'api/ops.js'));
  const lire = (s) => { m.changerSession(s); return B.appeler(ops, 'GET', `${URL_OPS}?action=surMesureCatalogue&centerId=libramont`); };
  const ecrire = (s, corps) => { m.changerSession(s); return B.appeler(ops, 'POST', URL_OPS, { centerId: 'libramont', ...corps }); };
  let r = await lire(session(CREE));
  v(r.statut === 200 && r.json.surMesure && r.json.surMesure.articles.some((a) => a.id === 'pizza-margherita'), '[K] lire : un role qui reserve lit le catalogue du centre', `${r.statut} ${r.json.message || ''}`);
  r = await lire(session(['reservations.view', 'reservations.edit']));
  v(r.statut === 200 && r.json.surMesure && r.json.surMesure.articles.length > 0, '[K] lire : un role qui modifie sans creer le lit aussi', `${r.statut} ${r.json.message || ''}`);
  r = await lire(session(['reservations.view']));
  const tableau = await lire(session(['dashboard.view']));
  v(r.statut === 403 && tableau.statut === 403, '[K] lire : voir sans reserver ne lit pas le catalogue, 403', `${r.statut} ${tableau.statut}`);
  r = await ecrire(session(['settings.manage']), { action: 'saveSurMesure', surMesure: BON });
  v(r.statut === 403 && !B.base.centers[0].settings.config, '[K] ecrire : settings.manage ne suffit pas', `${r.statut} ${r.json.message || ''}`);
  r = await ecrire(session(['pricing.manage']), { action: 'saveSurMesure', surMesure: BON });
  v(r.statut === 200 && JSON.stringify(r.json.surMesure.articles.map((a) => a.id)) === '["a"]' && B.base.centers[0].settings.config.surMesure.articles.length === 1, '[K] ecrire : pricing.manage passe, le catalogue est en base', `${r.statut} ${r.json.message || ''}`);
  v(traces.length === 1 && traces[0].action === 'saveSurMesure' && traces[0].dejaEcrit === false, '[K] la trace du catalogue part avant l ecriture', traces);
  v(traces.length === 1 && traces[0].type === 'center' && traces[0].id === 'libramont', '[K] la trace du catalogue nomme le centre', traces);
  journalEnPanne = true;
  r = await ecrire(session(['pricing.manage']), { action: 'saveSurMesure', surMesure: article({ prix: 7 }) });
  journalEnPanne = false;
  v(r.statut === 503 && (((B.base.centers[0].settings.config || {}).surMesure || {}).articles || [{}])[0].prix === 3, '[K] sans trace possible, le catalogue ne s ecrit pas', `${r.statut} ${r.json.message || ''}`);
  r = await lire(session(CREE));
  v(r.statut === 200 && r.json.surMesure.articles.length === 1, '[K] le catalogue ecrit se relit aussitot', r.json.surMesure && r.json.surMesure.articles.length);
  r = await ecrire(session(['pricing.manage']), { action: 'saveSurMesure', surMesure: { categories: [{ id: 'nourriture', nom: 'Repas' }] } });
  v(r.statut === 422 && (((B.base.centers[0].settings.config || {}).surMesure || {}).categories || [{}])[0].nom === 'Nourriture', '[K] un catalogue incomplet ne se fusionne pas avec l ancien', `${r.statut} ${r.json.message || ''}`);
  r = await ecrire(session(['pricing.manage']), { action: 'saveSurMesure' });
  v(r.statut === 422 && ((B.base.centers[0].settings.config.surMesure || {}).articles || []).length === 1, '[K] un corps vide n efface pas la carte du centre', `${r.statut} ${r.json.message || ''}`);
  r = await ecrire(session(['pricing.manage']), { action: 'saveSurMesure', surMesure: article({ prix: -5 }) });
  v(r.statut === 422 && (((B.base.centers[0].settings.config.surMesure || {}).articles || [])[0] || {}).prix === 3, '[K] une saisie fausse revient au contrat, rien n est ecrit', `${r.statut} ${r.json.message || ''}`);
  r = await ecrire(session(['settings.manage', 'ai.ops']), { action: 'saveCenterConfig', config: { surMesure: { categories: [], articles: [] }, accueil: { lateThresholdMinutes: 9 } } });
  v(r.statut === 200 && ((B.base.centers[0].settings.config.surMesure || {}).articles || []).length === 1 && B.base.centers[0].settings.config.accueil.lateThresholdMinutes === 9, '[K] saveCenterConfig ecrit sa config, pas le catalogue', `${r.statut} ${r.json.message || ''}`);
  // La console ne recoit que ce qui se choisit : ni article retire, ni categorie
  // masquee, ni interrupteur, ni rien d autre de la configuration du centre.
  const MELANGE = {
    categories: [{ id: 'nourriture', nom: 'Nourriture' }, { id: 'cachee', nom: 'Cachée', actif: false }],
    articles: [
      { id: 'a', nom: 'Article', categorie: 'nourriture', prix: 3, unite: 'piece', heure: true, actif: true },
      { id: 'b', nom: 'Retire', categorie: 'nourriture', prix: 4, unite: 'piece', heure: false, actif: false },
      { id: 'c', nom: 'Secret', categorie: 'cachee', prix: 5, unite: 'joueur', heure: false, actif: true },
    ],
  };
  r = await ecrire(session(['pricing.manage']), { action: 'saveSurMesure', surMesure: MELANGE });
  const ecritMelange = r.statut;
  r = await lire(session(CREE));
  const attendu = { categories: [{ id: 'nourriture', nom: 'Nourriture' }], articles: [{ id: 'a', nom: 'Article', categorie: 'nourriture', prix: 3, unite: 'piece', heure: true }] };
  v(ecritMelange === 200 && r.statut === 200 && JSON.stringify(r.json.surMesure) === JSON.stringify(attendu) && JSON.stringify(Object.keys(r.json).sort()) === '["centerId","ok","surMesure"]',
    '[K] la console ne recoit que ce qui se choisit, rien d autre du centre', { ecrit: ecritMelange, recu: r.json });
  B.base.centers = [];
  return liste;
}

// ---------------------------------------------------------------------------
// [W] LA CONSOLE : chargerCatalogueSurMesure, la lecture que Reserver appelle.
// Le vrai source d assets/app-main.js, joue dans un bac (les mutations y sont
// posees comme ailleurs, en memoire).
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

async function groupeConsole(mutations = []) {
  const { liste, v } = verdicts();
  const vm = require('vm');
  let src = fs.readFileSync(path.join(ROOT, 'assets/app-main.js'), 'utf8').replace(/\r\n/g, '\n');
  for (const mutation of mutations.filter((mu) => mu.fichier === 'assets/app-main.js')) src = src.replace(mutation.de, mutation.vers);
  const appels = [];
  const reponses = [];
  const bac = {
    centre: 'libramont',
    droits: ['reservations.view'],
    getCurrentStaffCenterId: () => bac.centre,
    canUseStaffPermission: (p) => (Array.isArray(p) ? p : [p]).some((x) => bac.droits.includes(x)),
    API_ENDPOINTS: { ops: '/api/ops' },
    apiRequest: (url) => { appels.push(url); return new Promise((ok, ko) => reponses.push({ ok, ko })); },
    document: { getElementById: () => null },
    QB_EXTRA_SUGGESTIONS: { nourriture: [], boissons: [] },
    escapeHtml: String,
  };
  vm.createContext(bac);
  const etat = (/let catalogueSurMesureConsole = [^;]+;\nlet catalogueSurMesureEnCours = null;/.exec(src) || [''])[0];
  vm.runInContext(`${etat}\n${['suggestionsSurMesure', 'optionsSurMesure', 'chargerCatalogueSurMesure', 'niveauStaff'].map((n) => fonctionDuSource(src, n)).join('\n')}
    this.api = { chargerCatalogueSurMesure, niveauStaff, lu: () => catalogueSurMesureConsole };`, bac);
  const { chargerCatalogueSurMesure, lu } = bac.api;
  v(typeof bac.api.niveauStaff === 'function' && /^function niveauStaff\(cle\)/m.test(src), '[W] window.niveauStaff(cle) est une fonction de premier niveau de la console');
  const CARTE = { surMesure: { categories: [{ id: 'nourriture', nom: 'Nourriture' }], articles: [{ id: 'a', nom: 'Article', categorie: 'nourriture', prix: 3, unite: 'piece', heure: false }] } };
  // Chaque lecture partie recoit sa reponse : une mutation qui en ajoute une ne
  // laisse jamais le gate pendu.
  const repondre = (echec = false) => { while (reponses.length) { const r = reponses.shift(); if (echec) r.ko(new Error('reseau')); else r.ok(CARTE); } };
  let p = chargerCatalogueSurMesure();
  repondre();
  let x = await p;
  v(appels.length === 0 && x.articles === null, '[W] voir sans reserver : aucune lecture, aucun catalogue', { appels, x });
  bac.droits = ['reservations.view', 'reservations.create'];
  const premier = chargerCatalogueSurMesure();
  const second = chargerCatalogueSurMesure();
  const lectures = appels.length;
  repondre();
  const [a, b] = await Promise.all([premier, second]);
  v(lectures === 1 && a.articles && a.articles.length === 1 && a.categories.length === 1 && b === a && lu().centre === 'libramont', '[W] un role qui reserve recoit le catalogue, une seule lecture pour deux appels', { lectures, a, b });
  p = chargerCatalogueSurMesure();
  const relu = appels.length;
  repondre();
  x = await p;
  v(relu === 1 && x.articles.length === 1, '[W] le catalogue lu se relit sans requete', appels);
  bac.centre = 'gembloux';
  const ailleurs = chargerCatalogueSurMesure();
  bac.centre = 'ciney';
  repondre();
  x = await ailleurs;
  v(x.centre === 'gembloux' && lu().centre === 'libramont', '[W] une reponse arrivee apres un changement de centre ne remplit pas celui d a cote', { x, garde: lu() });
  const panne = chargerCatalogueSurMesure();
  repondre(true);
  x = await panne;
  const avant = appels.length;
  const relance = chargerCatalogueSurMesure();
  const apres = appels.length;
  repondre();
  await relance;
  v(x.articles === null && apres === avant + 1, '[W] une lecture en panne rend null et se relit au prochain appel', { x, appels });
  return liste;
}

// ---------------------------------------------------------------------------
// LES GROUPES ET LEURS CONTRE-PREUVES.
// ---------------------------------------------------------------------------
const GROUPES = { groupeNiveaux, groupePrixCreation, groupeExtrasCreation, groupeFormuleForcer, groupePrixPatch, groupeParties, groupeExtrasPatch, groupeFormulePatch, groupeNotes, groupePublic, groupeCatalogue, groupeConsole };

const CONTRE_PREUVES = [
  // Le niveau d une session.
  { nom: 'un role verrouille lu dans son tableau', groupe: 'groupeNiveaux', attendu: /jamais lu dans le tableau/, fichier: 'lib/staff-auth.js', de: "if (session.role?.locked || sessionHasPermission(session, 'platform.admin')) return niveauMaximum(cle);", vers: "if (sessionHasPermission(session, 'platform.admin')) return niveauMaximum(cle);" },
  { nom: 'creation sans modification au maximum', groupe: 'groupeNiveaux', attendu: /creation sans modification/, fichier: 'lib/staff-auth.js', de: "  if (droits.has('reservations.create') && cle === 'surmesure') return 'catalogue';", vers: "  if (droits.has('reservations.create')) return niveauMaximum(cle);" },
  { nom: 'deux options gardees pour une cle', groupe: 'groupeNiveaux', attendu: /une option par cle/, fichier: 'lib/staff-auth.js', de: 'const known = [...new Set(uneOptionParCle((Array.isArray(permissions) ? permissions : [])\n    .filter((item) => allowed.has(item) || lireOptionDeNiveau(item))))];', vers: 'const known = [...new Set((Array.isArray(permissions) ? permissions : [])\n    .filter((item) => allowed.has(item) || lireOptionDeNiveau(item)))];' },
  { nom: 'modifier ne vaut plus le maximum', groupe: 'groupeNiveaux', attendu: /un role qui modifie, sans niveau ecrit/, fichier: 'lib/staff-auth.js', de: "  if (droits.has('reservations.edit')) return niveauMaximum(cle);\n", vers: '' },
  { nom: 'une option morte lue telle quelle', groupe: 'groupeNiveaux', attendu: /une option morte retombe/, fichier: 'lib/staff-auth.js', de: 'if (reste.length || !(NIVEAUX_PAR_CLE.get(cle) || []).includes(option)) return null;', vers: 'if (reste.length) return null;' },
  { nom: 'une option a rallonge acceptee', groupe: 'groupeNiveaux', attendu: /rien d inconnu ne passe/, fichier: 'lib/staff-auth.js', de: 'if (reste.length || !(NIVEAUX_PAR_CLE.get(cle) || []).includes(option)) return null;', vers: 'if (!(NIVEAUX_PAR_CLE.get(cle) || []).includes(option)) return null;' },
  { nom: 'la premiere option lue', groupe: 'groupeNiveaux', attendu: /deux options lues/, fichier: 'lib/staff-auth.js', de: 'const ecrite = uneOptionParCle(permissions).map(lireOptionDeNiveau)', vers: 'const ecrite = permissions.map(lireOptionDeNiveau)' },
  { nom: 'une cle inconnue sans repli', groupe: 'groupeNiveaux', attendu: /une cle inconnue vaut non/, fichier: 'lib/staff-auth.js', de: "return options[options.length - 1] || 'non';", vers: 'return options[options.length - 1];' },
  { nom: 'chevrons dans le nom de session', groupe: 'groupeNiveaux', attendu: /le nom d une session ne porte pas de balise/, fichier: 'lib/droits-reservation.js', de: ".replace(/[<>]/g, '').trim();", vers: '.trim();' },
  { nom: 'session sans nom ni borne', groupe: 'groupeNiveaux', attendu: /une session sans nom signe/, fichier: 'lib/droits-reservation.js', de: "return (nom || 'Équipe').slice(0, 80);", vers: 'return nom;' },
  // La creation.
  { nom: 'le refus ne tombe plus a l ecriture', groupe: 'groupePrixCreation', attendu: /niveau non : 51 centimes/, fichier: 'api/staff-reservations.js', de: '  exigerLesDroits(prepare);\n', vers: '' },
  { nom: 'plafond en pourcentage retire', groupe: 'groupePrixCreation', attendu: /niveau 20 % : un centime/, fichier: 'lib/droits-reservation.js', de: 'if (ecart * 100 > pourcent * centimes(reference)) {', vers: 'if (false) {' },
  { nom: 'niveau non qui laisse passer', groupe: 'groupePrixCreation', attendu: /niveau non : 51 centimes/, fichier: 'lib/droits-reservation.js', de: "if (niveau === 'non') throw refus('prix_niveau_insuffisant', 'Votre rôle ne permet pas d’ajuster un prix.');", vers: '' },
  { nom: 'reference nulle ouverte au pourcentage', groupe: 'groupePrixCreation', attendu: /reference nulle : un plafond/, fichier: 'lib/droits-reservation.js', de: "if (centimes(reference) <= 0) throw refus('prix_niveau_insuffisant', 'Sans prix de référence, seul le niveau « Sans limite » peut fixer ce prix.');", vers: '' },
  { nom: 'raison facultative', groupe: 'groupePrixCreation', attendu: /Direction sans raison/, fichier: 'lib/droits-reservation.js', de: "if (!motif) throw refus('prix_raison_requise', 'Indiquez la raison de ce prix.', 422);", vers: '' },
  { nom: 'marge de 50 centimes retiree', groupe: 'groupePrixCreation', attendu: /a 50 centimes de la reference/, fichier: 'lib/droits-reservation.js', de: 'const TOLERANCE_CENTIMES = 50;', vers: 'const TOLERANCE_CENTIMES = 0;' },
  { nom: 'base du corps crue a la creation', groupe: 'groupePrixCreation', attendu: /base forgee dans le corps|la base ecrite est celle du serveur/, fichier: 'lib/reserver-fenetre.js', de: '    request.basePrice = tarifDeReference(request);\n', vers: '' },
  { nom: 'trace de prix non ecrite a la creation', groupe: 'groupePrixCreation', attendu: /la trace est ecrite par le serveur/, fichier: 'lib/reserver-fenetre.js', de: 'dossier: droits.notePrix\n      ? { ...final, notes: require(\'./database\').notesAvecPrix(final.notes, droits.notePrix) }\n      : final,', vers: 'dossier: final,' },
  { nom: 'plafond de 100 000 retire a la creation', groupe: 'groupePrixCreation', attendu: /au dela de 100 000 EUR/, fichier: 'lib/droits-reservation.js', de: "if (prix > PRIX_MAX) throw refus('prix_invalide', 'Prix invalide : entre 0 et 100 000 €.', 422);", vers: '' },
  { nom: 'refus sans code stable', groupe: 'groupePrixCreation', attendu: /niveau non : 51 centimes/, fichier: 'api/staff-reservations.js', de: ': estRefusDeDroit(error) ? { code: error.code } : {};', vers: ': {};' },
  { nom: 'raison du prix perdue a la creation', groupe: 'groupePrixCreation', attendu: /la trace est ecrite par le serveur|Direction verrouillee/, fichier: 'lib/reserver-fenetre.js', de: 'droits.notePrix = jugerPrixDeCreation({ session, dossier, raison: corps.prixRaison });', vers: 'droits.notePrix = jugerPrixDeCreation({ session, dossier });' },
  { nom: 'plafond qui ignore le niveau', groupe: 'groupePrixCreation', attendu: /niveau 5 % : un centime/, fichier: 'lib/droits-reservation.js', de: 'const pourcent = Number(niveau);', vers: 'const pourcent = 20;' },
  // Le sur mesure a la creation.
  { nom: 'extras refuses ignores a la creation', groupe: 'groupeExtrasCreation', attendu: /sur mesure non : aucune ligne/, fichier: 'lib/reserver-fenetre.js', de: '    if (refusDesExtras) throw refusDesExtras;\n', vers: '' },
  { nom: 'niveau non qui laisse poser une ligne', groupe: 'groupeExtrasCreation', attendu: /sur mesure non : aucune ligne/, fichier: 'lib/droits-reservation.js', de: "    if (niveau === 'non') {\n      noter(", vers: "    if (false) {\n      noter(" },
  { nom: 'le prix de la ligne vient du corps', groupe: 'groupeExtrasCreation', attendu: /le serveur recalcule le prix/, fichier: 'lib/droits-reservation.js', de: 'price: euros(Math.round(prixUnitaire * qte * 100)),', vers: 'price: Number(ligne.price),' },
  { nom: 'article a 0 sans prix tape', groupe: 'groupeExtrasCreation', attendu: /« prix a saisir »/, fichier: 'lib/droits-reservation.js', de: ': Number.isFinite(saisi) && saisi >= 0 ? saisi : euros(Math.round(centimes(ligne.price) / qte));', vers: ': 0;' },
  { nom: 'prix unitaire negatif accepte', groupe: 'groupeExtrasCreation', attendu: /un prix unitaire negatif/, fichier: 'lib/droits-reservation.js', de: 'Number.isFinite(saisi) && saisi >= 0 ? saisi', vers: 'Number.isFinite(saisi) ? saisi' },
  { nom: 'les accents comptent', groupe: 'groupeExtrasCreation', attendu: /« prix a saisir »/, fichier: 'lib/droits-reservation.js', de: ".normalize('NFD')", vers: '' },
  { nom: 'l apostrophe droite perdue', groupe: 'groupeExtrasCreation', attendu: /l apostrophe droite/, fichier: 'lib/droits-reservation.js', de: ".replace(/[’`]/g, '\\'')", vers: '' },
  { nom: 'id inconnu rattrape par le nom', groupe: 'groupeExtrasCreation', attendu: /un id inconnu/, fichier: 'lib/droits-reservation.js', de: 'if (id) return choisissables.find((article) => article.id === id) || null;', vers: 'if (id && choisissables.find((article) => article.id === id)) return choisissables.find((article) => article.id === id);' },
  { nom: 'quantite envoyee ignoree', groupe: 'groupeExtrasCreation', attendu: /l article designe par son id/, fichier: 'lib/droits-reservation.js', de: '    : Number(ligne.qte);', vers: '    : nomEtQuantite(ligne.name).qte || null;' },
  { nom: 'quantite du libelle ignoree', groupe: 'groupeExtrasCreation', attendu: /14 x 2, pas 999/, fichier: 'lib/droits-reservation.js', de: '    ? nomEtQuantite(ligne.name).qte || null', vers: '    ? null' },
  { nom: 'quantite sans borne', groupe: 'groupeExtrasCreation', attendu: /une quantite hors de 1 a 999/, fichier: 'lib/droits-reservation.js', de: 'return Number.isInteger(envoyee) && envoyee >= 1 && envoyee <= EXTRA_QTE_MAX ? envoyee : null;', vers: 'return envoyee >= 1 ? Math.trunc(envoyee) : null;' },
  { nom: 'quantite refusee qui passe', groupe: 'groupeExtrasCreation', attendu: /une quantite hors de 1 a 999/, fichier: 'lib/droits-reservation.js', de: "      if (qte === null) {\n        noter(refus('quantite_invalide'", vers: "      if (false) {\n        noter(refus('quantite_invalide'" },
  { nom: 'plafond de 999 deplace', groupe: 'groupeExtrasCreation', attendu: /999 passe, price = qte × prixUnitaire/, fichier: 'lib/database.js', de: 'const EXTRA_QTE_MAX = 999;', vers: 'const EXTRA_QTE_MAX = 99;' },
  { nom: 'ligne calculee sans plafond', groupe: 'groupeExtrasPatch', attendu: /une ligne calculee au dela/, fichier: 'lib/droits-reservation.js', de: 'if (Math.abs(resolue.price) > PRIX_MAX) {', vers: 'if (false) {' },
  { nom: 'une valeur nue jugee comme une ligne', groupe: 'groupeExtrasCreation', attendu: /ce qui n est pas une ligne/, fichier: 'lib/droits-reservation.js', de: ".filter((ligne) => ligne && typeof ligne === 'object')", vers: '' },
  { nom: 'des extras qui ne sont pas une liste', groupe: 'groupeExtrasCreation', attendu: /des extras qui ne sont pas une liste/, fichier: 'lib/droits-reservation.js', de: 'const lignes = (Array.isArray(extras) ? extras : [])', vers: 'const lignes = (extras || [])' },
  { nom: 'categorie masquee perdue a la lecture', groupe: 'groupeExtrasCreation', attendu: /une categorie masquee/, fichier: 'lib/center-config.js', de: 'categories.push(brute.actif === false ? { id, nom, actif: false } : { id, nom });', vers: 'categories.push({ id, nom });' },
  { nom: 'reference sous zero a la creation', groupe: 'groupeExtrasCreation', attendu: /une remise plus grande que le dossier/, fichier: 'lib/droits-reservation.js', de: 'const reference = Math.max(0, euros(centimes(dossier.basePrice) + centimes(totalExtrasComptoir(dossier.extras))));', vers: 'const reference = euros(centimes(dossier.basePrice) + centimes(totalExtrasComptoir(dossier.extras)));' },
  { nom: 'article inactif accepte', groupe: 'groupeExtrasCreation', attendu: /un article inactif/, fichier: 'lib/center-config.js', de: 'catalogue.articles.filter((article) => article.actif && ouvertes.has(article.categorie))', vers: 'catalogue.articles.filter((article) => ouvertes.has(article.categorie))' },
  { nom: 'categorie masquee acceptee', groupe: 'groupeExtrasCreation', attendu: /une categorie masquee/, fichier: 'lib/center-config.js', de: 'const categories = catalogue.categories.filter((categorie) => categorie.actif !== false);', vers: 'const categories = catalogue.categories;' },
  { nom: 'quantite d un article par joueur oubliee', groupe: 'groupeExtrasCreation', attendu: /un article par joueur/, fichier: 'lib/droits-reservation.js', de: "if (envoyee === null) return article.unite === 'joueur' ? Math.max(1, Math.trunc(Number(pax)) || 1) : 1;", vers: 'if (envoyee === null) return 1;' },
  { nom: 'l auteur du corps garde', groupe: 'groupeExtrasCreation', attendu: /l auteur du corps ne survit pas/, fichier: 'lib/droits-reservation.js', de: 'id: ligne.id, name: ligne.name, price: prix, par, le };', vers: 'id: ligne.id, name: ligne.name, price: prix, par: ligne.par, le: ligne.le };' },
  { nom: 'ligne negative sans prix libre', groupe: 'groupeExtrasCreation', attendu: /ligne negative sans prix libre/, fichier: 'lib/droits-reservation.js', de: "if (prix < 0 && !(niveau === 'libre' && prixLibre)) {", vers: 'if (false) {' },
  { nom: 'ligne illisible acceptee', groupe: 'groupeExtrasCreation', attendu: /un prix de ligne illisible/, fichier: 'lib/droits-reservation.js', de: 'if (!Number.isFinite(prix) || Math.abs(prix) > PRIX_MAX) {', vers: 'if (false) {' },
  // Formule, placement, notes de creation, lot.
  { nom: 'formule adaptee sans niveau a la creation', groupe: 'groupeFormuleForcer', attendu: /formule adaptee, niveau non/, fichier: 'lib/reserver-fenetre.js', de: '    if (corpsAdapteUneFormule(corps, formuleAdaptee)) exigerAdaptationDeFormule(session);\n', vers: '' },
  { nom: 'le mot « (adaptée) » libre a la creation', groupe: 'groupeFormuleForcer', attendu: /le mot « \(adaptée\) » seul/, fichier: 'lib/droits-reservation.js', de: "return Boolean(formuleAdaptee) || LIBELLE_ADAPTE.test(String(corps.label || ''));", vers: 'return Boolean(formuleAdaptee);' },
  { nom: 'creer a placer sans niveau', groupe: 'groupeFormuleForcer', attendu: /niveau non : refus, rien d ecrit/, fichier: 'lib/reserver-fenetre.js', de: '    if (aPlacer) exigerForcer(session);\n', vers: '' },
  { nom: 'notes de creation non signees', groupe: 'groupeFormuleForcer', attendu: /un corps qui pretend un auteur/, fichier: 'lib/reserver-fenetre.js', de: "  if (typeof corps.notes === 'string') corps.notes = require('./database').signerNotesEquipe(corps.notes, { par: nomDeSession(session) });\n", vers: '' },
  { nom: 'lot : le rang sans son code', groupe: 'groupeFormuleForcer', attendu: /lot : le dossier refuse/, fichier: 'api/staff-reservations.js', de: "...(code ? { code } : {}) }))", vers: '}))' },
  { nom: 'lot : un refus de droit devient 422', groupe: 'groupeFormuleForcer', attendu: /lot : tout refuse par les droits/, fichier: 'api/staff-reservations.js', de: "echecs.every((echec) => echec.refusDeDroit) ? 403 : 422;", vers: '422;' },
  // Le prix d un PATCH.
  { nom: 'le contenu change a prix constant', groupe: 'groupePrixPatch', attendu: /doubler le groupe a prix constant/, fichier: 'lib/droits-reservation.js', de: 'if (!contenuChange && prixInchange) return null;', vers: 'if (prixInchange) return null;' },
  { nom: 'ajustement existant rejuge', groupe: 'groupePrixPatch', attendu: /un prix d ami garde son ecart/, fichier: 'lib/droits-reservation.js', de: 'if (Math.abs(ecart - ecartAvant) <= TOLERANCE_CENTIMES) return null;', vers: '' },
  { nom: 'trace de prix non ecrite au PATCH', groupe: 'groupePrixPatch', attendu: /la trace : qui, quand/, fichier: 'api/staff-reservations.js', de: 'if (notePrix) patch.notes = notesAvecPrix(patch.notes ?? current.notes, notePrix);', vers: '' },
  { nom: 'base du corps ecrite au PATCH', groupe: 'groupePrixPatch', attendu: /la base du corps ne s ecrit/, fichier: 'api/staff-reservations.js', de: '      patch.basePrice = base;\n', vers: '' },
  { nom: 'base du corps crue sans plan de pistes', groupe: 'groupePrixPatch', attendu: /un laser sans plan de pistes|doubler le groupe/, fichier: 'lib/droits-reservation.js', de: 'const tarif = tarifDeReference({ ...demande, ...(ops.laneCount != null ? { laneCount: ops.laneCount } : {}) });\n  return tarif > 0 ? tarif : Number(current.basePrice) || 0;', vers: 'return Number(demande.basePrice) || 0;' },
  { nom: 'prix vide ecrit a 0', groupe: 'groupePrixPatch', attendu: /un prix vide ne vaut pas 0/, fichier: 'api/staff-reservations.js', de: "      if (patch.price === null || patch.price === '') delete patch.price;\n", vers: '' },
  { nom: 'le contenu ne compte plus', groupe: 'groupePrixPatch', attendu: /doubler le groupe a prix constant/, fichier: 'api/staff-reservations.js', de: 'const contenuChange = contenuDuDossier({ ...current, ...patch, ...ops, extras: extrasFinales }) !== contenuDuDossier(current);', vers: 'const contenuChange = false;' },
  { nom: 'revenir a la reference juge', groupe: 'groupePrixPatch', attendu: /revenir a la reference ne demande aucun niveau/, fichier: 'lib/droits-reservation.js', de: '  if (Math.abs(ecart) <= TOLERANCE_CENTIMES) return null;\n', vers: '' },
  { nom: 'le prix du moteur ignore', groupe: 'groupePrixPatch', attendu: /le moteur le recalcule, rien a juger/, fichier: 'api/staff-reservations.js', de: 'const prixFinal = ops.price ?? patch.price ?? current.price;', vers: 'const prixFinal = patch.price ?? current.price;' },
  { nom: 'un tarif nul efface la base', groupe: 'groupePrixPatch', attendu: /sans tarif calculable/, fichier: 'lib/droits-reservation.js', de: 'return tarif > 0 ? tarif : Number(current.basePrice) || 0;', vers: 'return tarif;' },
  { nom: 'raison du prix perdue au PATCH', groupe: 'groupePrixPatch', attendu: /5 % : 57 sur 60 passe/, fichier: 'api/staff-reservations.js', de: 'contenuChange, raison: patch.prixRaison });', vers: 'contenuChange });' },
  { nom: 'le prix qui suit non pose', groupe: 'groupePrixPatch', attendu: /un laser sans prix envoye : le serveur pose/, fichier: 'api/staff-reservations.js', de: '      if (prixSuivi) {\n        patch.price = prixQuiSuit(', vers: '      if (false) {\n        patch.price = prixQuiSuit(' },
  { nom: 'le prix qui suit perd l ajustement', groupe: 'groupePrixPatch', attendu: /un prix d ami sans prix envoye garde son ecart/, fichier: 'lib/droits-reservation.js', de: '(baseAvant > 0 ? prixAvant - baseAvant - extrasAvant : 0)', vers: '0' },
  // Un centre qui vend aux parties.
  { nom: 'la base forgee reprise par le moteur', groupe: 'groupeParties', attendu: /une base forgee que le moteur reprendrait/, fichier: 'lib/droits-reservation.js', de: 'if (!auxParties) return donnee;', vers: 'return donnee;' },
  { nom: 'le changement de jour ne compte pas', groupe: 'groupeParties', attendu: /tarif du jour/, fichier: 'lib/droits-reservation.js', de: 'if (!contenuChange && !jourChange) return', vers: 'if (!contenuChange) return' },
  { nom: 'une heure rouvre la base', groupe: 'groupeParties', attendu: /une heure de plus ne rouvre pas/, fichier: 'lib/droits-reservation.js', de: '  if (!contenuChange && !jourChange) return Number(current.basePrice) || 0;\n', vers: '' },
  { nom: 'la base du moteur ecrite', groupe: 'groupeParties', attendu: /la base ecrite est celle du serveur/, fichier: 'api/staff-reservations.js', de: "      if (Object.prototype.hasOwnProperty.call(ops, 'basePrice')) ops.basePrice = base;\n", vers: '' },
  { nom: 'un programme juge au tarif du bowling', groupe: 'groupeParties', attendu: /un programme garde la base du moteur/, fichier: 'lib/droits-reservation.js', de: '    if (ops.program) return donnee;\n', vers: '' },
  // Les extras d un PATCH.
  { nom: 'extras refuses ignores au PATCH', groupe: 'groupeExtrasPatch', attendu: /une ligne nouvelle, refus/, fichier: 'api/staff-reservations.js', de: '        if (refus) throw refus;\n', vers: '' },
  { nom: 'chaque ligne rejugee', groupe: 'groupeExtrasPatch', attendu: /les lignes deja la passent/, fichier: 'lib/droits-reservation.js', de: 'if (deja && deja.length) {', vers: 'if (false) {' },
  { nom: 'le corps reecrit l auteur d une ligne', groupe: 'groupeExtrasPatch', attendu: /leur auteur reste/, fichier: 'lib/droits-reservation.js', de: 'return { ...stockee, ...(ligne.heure', vers: 'return { ...stockee, par: ligne.par, le: ligne.le, ...(ligne.heure' },
  { nom: 'extras non liste qui effacent', groupe: 'groupeExtrasPatch', attendu: /n effacent rien/, fichier: 'api/staff-reservations.js', de: "      if (Object.prototype.hasOwnProperty.call(patch, 'extras') && !Array.isArray(patch.extras)) delete patch.extras;\n", vers: '' },
  { nom: 'normalizeExtras sans borne', groupe: 'groupeExtrasPatch', attendu: /normalizeExtras borne/, fichier: 'lib/database.js', de: 'price: Math.max(-EXTRA_PRIX_MAX, Math.min(EXTRA_PRIX_MAX, toNumber(item.price, 0))),', vers: 'price: toNumber(item.price, 0),' },
  { nom: 'normalizeExtras sans borne de quantite', groupe: 'groupeExtrasPatch', attendu: /normalizeExtras borne/, fichier: 'lib/database.js', de: 'if (Number.isInteger(qte) && qte >= 1 && qte <= EXTRA_QTE_MAX) ligne.qte = qte;', vers: 'if (qte >= 1) ligne.qte = qte;' },
  { nom: 'normalizeExtras sans format d heure', groupe: 'groupeExtrasPatch', attendu: /normalizeExtras borne/, fichier: 'lib/database.js', de: "if (EXTRA_HEURE.test(String(item.heure || ''))) ligne.heure = String(item.heure);", vers: 'if (item.heure) ligne.heure = String(item.heure);' },
  { nom: 'heure et note d une ligne perdues', groupe: 'groupeExtrasPatch', attendu: /l heure et la note d une ligne deja la/, fichier: 'lib/droits-reservation.js', de: 'return { ...stockee, ...(ligne.heure !== undefined ? { heure: ligne.heure } : {}), ...(ligne.note !== undefined ? { note: ligne.note } : {}) };', vers: 'return stockee;' },
  { nom: 'trace partie de l ancien prix', groupe: 'groupeExtrasPatch', attendu: /la trace part de la nouvelle reference/, fichier: 'lib/droits-reservation.js', de: 'de: prixInchange ? reference : prixAvant,', vers: 'de: prixAvant,' },
  { nom: 'la casse d une ligne compte', groupe: 'groupeExtrasPatch', attendu: /les lignes deja la passent/, fichier: 'lib/droits-reservation.js', de: ".toLowerCase().replace(/\\s+/g, ' ').trim();", vers: ".replace(/\\s+/g, ' ').trim();" },
  { nom: 'une ligne en base vaut pour deux', groupe: 'groupeExtrasPatch', attendu: /une ligne dupliquee/, fichier: 'lib/droits-reservation.js', de: 'const stockee = deja.shift();', vers: 'const stockee = deja[0];' },
  { nom: 'reference sous zero au PATCH', groupe: 'groupeExtrasPatch', attendu: /une remise plus grande que le dossier/, fichier: 'lib/droits-reservation.js', de: 'const reference = Math.max(0, euros(centimes(base) + centimes(totalExtrasComptoir(extras))));', vers: 'const reference = euros(centimes(base) + centimes(totalExtrasComptoir(extras)));' },
  { nom: 'article par joueur sur l ancien groupe', groupe: 'groupeExtrasPatch', attendu: /suit le nouveau groupe/, fichier: 'api/staff-reservations.js', de: 'centerId: requestedCenterId, pax: patch.pax ?? current.pax });', vers: 'centerId: requestedCenterId, pax: current.pax });' },
  // La formule d un PATCH.
  { nom: 'formule adaptee sans niveau au PATCH', groupe: 'groupeFormulePatch', attendu: /« \(adaptée\) » pose, niveau non/, fichier: 'api/staff-reservations.js', de: '      if (patchAdapteLaFormule(patch, current)) exigerAdaptationDeFormule(session);\n', vers: '' },
  { nom: 'le programme d une autre formule passe', groupe: 'groupeFormulePatch', attendu: /une autre formule avec un programme/, fichier: 'lib/droits-reservation.js', de: 'const avant = formuleApres && formuleApres !== formuleAvant\n    ? compositionDeLaFormule({ ...current, formuleId: formuleApres, opsPlan: null })\n    : compositionDuProgramme(current.program) ?? compositionDeLaFormule(current);', vers: 'const avant = formuleApres !== formuleAvant ? null : compositionDuProgramme(current.program) ?? compositionDeLaFormule(current);' },
  { nom: 'la duree du bowling ignoree', groupe: 'groupeFormulePatch', attendu: /la duree du bowling changee/, fichier: 'lib/droits-reservation.js', de: "duree: id === 'bowling' ? Number(item.duration) || 0 : 0,", vers: "duree: id === 'bowling' ? 1 : 0," },
  { nom: 'les parties de laser ignorees', groupe: 'groupeFormulePatch', attendu: /les parties de laser changees/, fichier: 'lib/droits-reservation.js', de: "parties: id === 'laser_game' ? Number((item.extraLaser && item.extraLaser.games) || item.games) || 0 : 0,", vers: "parties: id === 'laser_game' ? 1 : 0," },
  { nom: 'les etapes de service comptees', groupe: 'groupeFormulePatch', attendu: /le meme contenu renvoye/, fichier: 'lib/droits-reservation.js', de: 'items.filter((ligne) => ligne.id && !ETAPES_DE_SERVICE.has(ligne.id))', vers: 'items.filter((ligne) => ligne.id)' },
  { nom: 'extraLaser ignore', groupe: 'groupeFormulePatch', attendu: /le meme contenu sous la forme stockee/, fichier: 'lib/droits-reservation.js', de: 'Number((item.extraLaser && item.extraLaser.games) || item.games)', vers: 'Number(item.games)' },
  { nom: 'l id stocke ignore', groupe: 'groupeFormulePatch', attendu: /le meme contenu sous la forme stockee/, fichier: 'lib/droits-reservation.js', de: 'String((item && (item.activityId || item.id)) || \'\')', vers: 'String((item && item.activityId) || \'\')' },
  { nom: 'la forme items ignoree', groupe: 'groupeFormulePatch', attendu: /un programme emballe dans items/, fichier: 'lib/droits-reservation.js', de: 'const items = Array.isArray(program) ? program : (program && Array.isArray(program.items) ? program.items : null);', vers: 'const items = Array.isArray(program) ? program : null;' },
  { nom: 'formulaId ignore', groupe: 'groupeFormulePatch', attendu: /par formulaId/, fichier: 'lib/droits-reservation.js', de: 'String(patch.formuleId ?? patch.formulaId ?? formuleAvant)', vers: 'String(patch.formuleId ?? formuleAvant)' },
  { nom: 'tout PATCH adapte la formule', groupe: 'groupeFormulePatch', attendu: /un PATCH sans programme/, fichier: 'lib/droits-reservation.js', de: '  if (apres === null) return false;\n', vers: '' },
  { nom: 'un programme vide adapte', groupe: 'groupeFormulePatch', attendu: /un programme vide/, fichier: 'lib/droits-reservation.js', de: 'if (!items || !items.length) return null;', vers: 'if (!items) return null;' },
  { nom: 'le mot retire passe', groupe: 'groupeFormulePatch', attendu: /« \(adaptée\) » retire/, fichier: 'lib/droits-reservation.js', de: "LIBELLE_ADAPTE.test(String(patch.label || '')) !== libelleAvant) return true;", vers: "LIBELLE_ADAPTE.test(String(patch.label || ''))) return true;" },
  { nom: 'une visite demande le niveau formule', groupe: 'groupeFormulePatch', attendu: /le programme d une visite/, fichier: 'lib/droits-reservation.js', de: "  if (!formuleAvant && current.type !== 'formule' && !formuleApres) return false;\n", vers: '' },
  { nom: 'une formule retiree refuse', groupe: 'groupeFormulePatch', attendu: /une formule retiree de la carte/, fichier: 'lib/droits-reservation.js', de: 'return avant !== null && avant !== apres;', vers: 'return avant !== apres;' },
  // Les notes.
  { nom: 'notes reecrites sans le droit', groupe: 'groupeNotes', attendu: /retirer la raison du prix/, fichier: 'lib/droits-reservation.js', de: "if (!sessionHasPermission(session, 'reservations.edit') && !notesSeulementAjoutees(notes, current.notes)) {", vers: 'if (false) {' },
  { nom: 'une ligne inseree devant passe', groupe: 'groupeNotes', attendu: /inserer devant/, fichier: 'lib/database.js', de: 'return enBase.every((ligne, index) => recues[index] === ligne);', vers: 'return enBase.every((ligne) => recues.includes(ligne));' },
  { nom: 'notes du PATCH non signees', groupe: 'groupeNotes', attendu: /une ligne ajoutee au nom d un autre/, fichier: 'lib/droits-reservation.js', de: 'return signerNotesEquipe(notes, { avant: current.notes, par: nomDeSession(session) });', vers: 'return notes;' },
  { nom: 'notes nulles qui vident', groupe: 'groupeNotes', attendu: /des notes nulles ne vident rien/, fichier: 'api/staff-reservations.js', de: '      if (patch.notes === null) delete patch.notes;\n', vers: '' },
  { nom: 'noteEquipe retrait sans le droit', groupe: 'groupeNotes', attendu: /noteEquipe retrait sans le droit/, fichier: 'api/staff-reservations.js', de: '        if (geste.retrait !== undefined || geste.modifier !== undefined) exigerRetraitDeNote(session);\n', vers: '' },
  { nom: 'deux lignes, une cle', groupe: 'groupeNotes', attendu: /deux lignes dans le meme envoi/, fichier: 'lib/database.js', de: '    pris.add(le);\n', vers: '' },
  { nom: 'chaque ligne resignee', groupe: 'groupeNotes', attendu: /ajouter a la fin passe/, fichier: 'lib/database.js', de: '    if (dejaLa >= 0) { enBase.splice(dejaLa, 1); return propre; }\n', vers: '' },
  { nom: 'une copie passe pour l originale', groupe: 'groupeNotes', attendu: /recopier la ligne d une collegue/, fichier: 'lib/database.js', de: 'if (dejaLa >= 0) { enBase.splice(dejaLa, 1); return propre; }', vers: 'if (dejaLa >= 0) return propre;' },
  { nom: 'balises gardees', groupe: 'groupeNotes', attendu: /ne garde pas ses balises/, fichier: 'lib/database.js', de: "const texte = stripUnsafeMarkup(note.t).replace(/[ \\t]+/g, ' ').trim().slice(0, NOTE_EQUIPE_LONGUEUR);", vers: "const texte = String(note.t).replace(/[ \\t]+/g, ' ').trim().slice(0, NOTE_EQUIPE_LONGUEUR);" },
  { nom: 'ligne sans texte gardee', groupe: 'groupeNotes', attendu: /une ligne forgee sans texte/, fichier: 'lib/database.js', de: '    if (!texte) return null;\n', vers: '' },
  { nom: 'trace de prix sur une cle prise', groupe: 'groupeNotes', attendu: /une trace de prix prend une cle libre/, fichier: 'lib/database.js', de: "  while (pris.has(new Date(instant).toISOString())) instant += 1;\n  const motif", vers: '  const motif' },
  { nom: 'ligne resignee sur une cle prise', groupe: 'groupeNotes', attendu: /une ligne resignee prend une cle libre/, fichier: 'lib/database.js', de: '    while (pris.has(new Date(instant).toISOString())) instant += 1;\n    const le =', vers: '    const le =' },
  // Le canal public.
  { nom: 'extras publics gardes', groupe: 'groupePublic', attendu: /les extras du corps ne s ecrivent pas/, fichier: 'lib/reservation-request.js', de: '    request.extras = [];\n', vers: '' },
  { nom: 'fausses traces publiques gardees', groupe: 'groupePublic', attendu: /les fausses traces tombent/, fichier: 'lib/reservation-request.js', de: '    if (input.notes !== undefined && input.notes !== null) request.notes = notesDuClient(input.notes);\n', vers: '' },
  { nom: 'libelle impose par le canal du corps', groupe: 'groupePublic', attendu: /un corps qui se dit staff, horaires retenus/, fichier: 'lib/reservation-request.js', de: 'const libelleImpose = options.staff === true && normalizeText(request.label);', vers: 'const libelleImpose = !isPublicChannel({ channel: request.channel }) && normalizeText(request.label);' },
  { nom: '« (adaptée) » public garde', groupe: 'groupePublic', attendu: /ne s ecrit pas depuis le tunnel/, fichier: 'lib/reservation-request.js', de: "  if (request.label) request.label = String(request.label).replace(MARQUE_ADAPTEE, '').trim();\n", vers: '' },
  { nom: 'les fausses traces du moteur gardees', groupe: 'groupePublic', attendu: /les fausses traces tombent/, fichier: 'lib/reservation-request.js', de: 'const LIGNE_DE_TRACE = /^\\s*\\[(?:equipe\\]|ops:)/;', vers: 'const LIGNE_DE_TRACE = /^\\s*\\[equipe\\]/;' },
  // Le catalogue.
  { nom: 'saveCenterConfig ecrit le catalogue', groupe: 'groupeCatalogue', attendu: /saveCenterConfig ecrit sa config/, fichier: 'api/ops.js', de: 'sansCatalogueSurMesure(body.config || {})', vers: 'body.config || {}' },
  { nom: 'ecriture du catalogue hors pricing.manage', groupe: 'groupeCatalogue', attendu: /pricing.manage passe|settings.manage ne suffit pas/, fichier: 'api/ops.js', de: "'resetClientFormuleOverride', 'saveSurMesure'].includes(action)", vers: "'resetClientFormuleOverride'].includes(action)" },
  { nom: 'lecture du catalogue ouverte a qui voit', groupe: 'groupeCatalogue', attendu: /voir sans reserver ne lit pas le catalogue/, fichier: 'api/ops.js', de: "if (action === 'surMesureCatalogue') return ['reservations.create', 'reservations.edit', 'pricing.manage'];", vers: "if (action === 'surMesureCatalogue') return ['reservations.view', 'reservations.create', 'reservations.edit', 'pricing.manage'];" },
  { nom: 'lecture du catalogue fermee a qui modifie', groupe: 'groupeCatalogue', attendu: /un role qui modifie sans creer le lit aussi/, fichier: 'api/ops.js', de: "if (action === 'surMesureCatalogue') return ['reservations.create', 'reservations.edit', 'pricing.manage'];", vers: "if (action === 'surMesureCatalogue') return ['reservations.create', 'pricing.manage'];" },
  { nom: 'la console recoit tout le catalogue', groupe: 'groupeCatalogue', attendu: /ne recoit que ce qui se choisit/, fichier: 'api/ops.js', de: 'surMesure: surMesureChoisissable(catalogueSurMesure(centerId)) });', vers: 'surMesure: catalogueSurMesure(centerId) });' },
  { nom: 'la console recoit les interrupteurs', groupe: 'groupeCatalogue', attendu: /ne recoit que ce qui se choisit/, fichier: 'lib/center-config.js', de: '\n    .map(({ id, nom, categorie, prix, unite, heure }) => ({ id, nom, categorie, prix, unite, heure }));', vers: ';' },
  { nom: 'corps vide qui efface la carte', groupe: 'groupeCatalogue', attendu: /un corps vide n efface pas/, fichier: 'api/ops.js', de: "    if (body.surMesure == null) throw createHttpError('Catalogue sur mesure invalide.', 422, true);\n", vers: '' },
  { nom: 'prix illisible lu 0', groupe: 'groupeCatalogue', attendu: /un prix illisible ne devient jamais 0/, fichier: 'lib/center-config.js', de: "const prix = brut?.prix === '' || brut?.prix == null ? NaN : Number(brut.prix);", vers: 'const prix = Number(brut?.prix) || 0;' },
  { nom: 'sans centre, le catalogue de Libramont', groupe: 'groupeCatalogue', attendu: /sans centre nomme/, fichier: 'lib/center-config.js', de: '  if (!centerId) return catalogueSurMesureParDefaut();\n', vers: '  if (!centerId) return normalizeSurMesure(require(\'./ops-knowledge\').getCenter().surMesure);\n' },
  { nom: 'catalogue hors du journal bloquant', groupe: 'groupeCatalogue', attendu: /la trace du catalogue part avant l ecriture/, fichier: 'lib/audit-log.js', de: "  'saveSurMesure',\n", vers: '' },
  { nom: 'trace du catalogue sans son centre', groupe: 'groupeCatalogue', attendu: /la trace du catalogue nomme le centre/, fichier: 'api/ops.js', de: '/^(saveCenterConfig|saveSurMesure|saveCenter|setCenterStatus)$/', vers: '/^(saveCenterConfig|saveCenter|setCenterStatus)$/' },
  { nom: 'catalogue fusionne avec l ancien', groupe: 'groupeCatalogue', attendu: /un catalogue incomplet/, fichier: 'lib/center-config.js', de: "const REMPLACES_EN_BLOC = ['validationEquipe', 'secours', 'surMesure'];", vers: "const REMPLACES_EN_BLOC = ['validationEquipe', 'secours'];" },
  { nom: 'rien de decide refuse', groupe: 'groupeCatalogue', attendu: /rien n est decide/, fichier: 'lib/center-config.js', de: '  if (input == null) return null;\n  if (!isPlainObject(input) || !Array.isArray(input.categories)', vers: '  if (!isPlainObject(input) || !Array.isArray(input.categories)' },
  { nom: 'forme fausse acceptee', groupe: 'groupeCatalogue', attendu: /une forme fausse/, fichier: 'lib/center-config.js', de: 'if (!isPlainObject(input) || !Array.isArray(input.categories) || !Array.isArray(input.articles)) {', vers: 'if (false) {' },
  { nom: 'prix negatif accepte', groupe: 'groupeCatalogue', attendu: /prix negatif : refus/, fichier: 'lib/center-config.js', de: '&& prix >= 0 && prix <= SUR_MESURE_PRIX_MAX', vers: '&& prix <= SUR_MESURE_PRIX_MAX' },
  { nom: 'prix sans plafond', groupe: 'groupeCatalogue', attendu: /prix au dela de 100 000/, fichier: 'lib/center-config.js', de: '&& prix >= 0 && prix <= SUR_MESURE_PRIX_MAX', vers: '&& prix >= 0' },
  { nom: 'categorie absente acceptee', groupe: 'groupeCatalogue', attendu: /categorie absente : refus/, fichier: 'lib/center-config.js', de: '      && idsCategories.has(categorie)\n', vers: '' },
  { nom: 'identifiant libre d un article', groupe: 'groupeCatalogue', attendu: /identifiant instable : refus/, fichier: 'lib/center-config.js', de: 'const valide = SUR_MESURE_ID.test(id) && !idsArticles.has(id) && nom', vers: 'const valide = !idsArticles.has(id) && nom' },
  { nom: 'article en double accepte', groupe: 'groupeCatalogue', attendu: /article en double/, fichier: 'lib/center-config.js', de: 'const valide = SUR_MESURE_ID.test(id) && !idsArticles.has(id) && nom', vers: 'const valide = SUR_MESURE_ID.test(id) && nom' },
  { nom: 'nom d article sans borne', groupe: 'groupeCatalogue', attendu: /nom vide ou trop long : refus/, fichier: 'lib/center-config.js', de: '!idsArticles.has(id) && nom && nom.length <= SUR_MESURE_MAX_NOM\n', vers: '!idsArticles.has(id) && nom\n' },
  { nom: 'unite libre', groupe: 'groupeCatalogue', attendu: /unite inconnue/, fichier: 'lib/center-config.js', de: "      && (unite === 'piece' || unite === 'joueur')\n", vers: '' },
  { nom: 'interrupteurs d article libres', groupe: 'groupeCatalogue', attendu: /interrupteur non booleen : refus/, fichier: 'lib/center-config.js', de: '      && booleenSurMesure(brut?.heure) && booleenSurMesure(brut?.actif);', vers: '      ;' },
  { nom: 'identifiant libre d une categorie', groupe: 'groupeCatalogue', attendu: /categorie a l identifiant instable/, fichier: 'lib/center-config.js', de: 'const valide = SUR_MESURE_ID.test(id) && !idsCategories.has(id) && nom', vers: 'const valide = !idsCategories.has(id) && nom' },
  { nom: 'categorie en double acceptee', groupe: 'groupeCatalogue', attendu: /categorie en double/, fichier: 'lib/center-config.js', de: 'const valide = SUR_MESURE_ID.test(id) && !idsCategories.has(id) && nom', vers: 'const valide = SUR_MESURE_ID.test(id) && nom' },
  { nom: 'nom de categorie sans borne', groupe: 'groupeCatalogue', attendu: /categorie au nom vide ou trop long/, fichier: 'lib/center-config.js', de: '!idsCategories.has(id) && nom && nom.length <= SUR_MESURE_MAX_NOM && booleenSurMesure(brute?.actif);', vers: '!idsCategories.has(id) && nom && booleenSurMesure(brute?.actif);' },
  { nom: 'interrupteur de categorie libre', groupe: 'groupeCatalogue', attendu: /categorie a l interrupteur non booleen/, fichier: 'lib/center-config.js', de: '!idsCategories.has(id) && nom && nom.length <= SUR_MESURE_MAX_NOM && booleenSurMesure(brute?.actif);', vers: '!idsCategories.has(id) && nom && nom.length <= SUR_MESURE_MAX_NOM;' },
  { nom: '401 articles tronques en silence', groupe: 'groupeCatalogue', attendu: /401 articles : refus/, fichier: 'lib/center-config.js', de: '  if (strict && input.articles.length > SUR_MESURE_MAX_ARTICLES) refusSurMesure(`${SUR_MESURE_MAX_ARTICLES} articles au plus.`);\n', vers: '' },
  { nom: '31 categories tronquees en silence', groupe: 'groupeCatalogue', attendu: /31 categories : refus/, fichier: 'lib/center-config.js', de: '  if (strict && input.categories.length > SUR_MESURE_MAX_CATEGORIES) refusSurMesure(`${SUR_MESURE_MAX_CATEGORIES} catégories au plus.`);\n', vers: '' },
  { nom: 'lecture sans plafond d articles', groupe: 'groupeCatalogue', attendu: /a la lecture, 400 articles/, fichier: 'lib/center-config.js', de: 'for (const brut of input.articles.slice(0, SUR_MESURE_MAX_ARTICLES)) {', vers: 'for (const brut of input.articles) {' },
  { nom: 'lecture sans plafond de categories', groupe: 'groupeCatalogue', attendu: /a la lecture, 30 categories/, fichier: 'lib/center-config.js', de: 'for (const brute of input.categories.slice(0, SUR_MESURE_MAX_CATEGORIES)) {', vers: 'for (const brute of input.categories) {' },
  { nom: 'chevrons gardes dans un nom', groupe: 'groupeCatalogue', attendu: /un nom ne porte pas de balise/, fichier: 'lib/center-config.js', de: "String(valeur ?? '').replace(/[\\u0000-\\u001f\\u007f<>]/g, ' ').replace(/\\s+/g, ' ').trim();", vers: "String(valeur ?? '').replace(/\\s+/g, ' ').trim();" },
  { nom: 'prix sans arrondi', groupe: 'groupeCatalogue', attendu: /prix au centime/, fichier: 'lib/center-config.js', de: 'prix: Math.round(prix * 100) / 100,', vers: 'prix,' },
  { nom: 'article actif par defaut perdu', groupe: 'groupeCatalogue', attendu: /sans interrupteur/, fichier: 'lib/center-config.js', de: 'actif: brut.actif !== false });', vers: 'actif: brut.actif === true });' },
  // La console.
  { nom: 'catalogue lu par qui ne reserve pas', groupe: 'groupeConsole', attendu: /voir sans reserver : aucune lecture/, fichier: 'assets/app-main.js', de: " || !canUseStaffPermission(['reservations.create', 'reservations.edit', 'pricing.manage'])) {", vers: ') {' },
  { nom: 'deux lectures pour deux appels', groupe: 'groupeConsole', attendu: /une seule lecture pour deux appels/, fichier: 'assets/app-main.js', de: '  if (catalogueSurMesureEnCours && catalogueSurMesureEnCours.centre === centre) return catalogueSurMesureEnCours.promesse;\n', vers: '' },
  { nom: 'catalogue relu a chaque appel', groupe: 'groupeConsole', attendu: /se relit sans requete/, fichier: 'assets/app-main.js', de: '  if (catalogueSurMesureConsole.centre === centre && catalogueSurMesureConsole.articles) return catalogueSurMesureConsole;\n', vers: '' },
  { nom: 'reponse d un autre centre posee', groupe: 'groupeConsole', attendu: /changement de centre/, fichier: 'assets/app-main.js', de: '      if (centre === getCurrentStaffCenterId()) {', vers: '      if (true) {' },
  { nom: 'lecture en panne jamais relue', groupe: 'groupeConsole', attendu: /une lecture en panne/, fichier: 'assets/app-main.js', de: '      if (catalogueSurMesureEnCours === course) catalogueSurMesureEnCours = null;', vers: '' },
];

// Une promesse jamais tenue vide la boucle et Node sort en 0 sans bilan : ce
// silence-la est un rouge (B.sortir sort toujours par process.exit).
process.on('beforeExit', () => {
  console.error('FAIL  droits-niveaux-check s est arrete avant son bilan : une promesse jamais tenue');
  process.exit(1);
});

async function main() {
  const contrePreuves = process.argv.includes('--contre-preuves');
  let echecs = 0;
  if (!contrePreuves) {
    for (const [nom, groupe] of Object.entries(GROUPES)) {
      const liste = await groupe();
      liste.forEach(({ ok, label, detail }) => {
        console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`);
        if (!ok) echecs += 1;
      });
      if (!liste.length) { console.log(`FAIL  ${nom} n a rien verifie`); echecs += 1; }
    }
    B.sortir('droits-niveaux-check', echecs, 'chaque niveau tient au serveur, a la creation comme a la modification, et les portes voisines suivent.');
    return;
  }
  // Les ancres sont lues avant tout : une ancre morte n est pas un vert.
  for (const c of CONTRE_PREUVES) {
    const liste = await GROUPES[c.groupe]([{ fichier: c.fichier, de: c.de, vers: c.vers }]).catch((error) => [{ ok: false, label: `exception : ${error.message}`, detail: '' }]);
    const rouges = liste.filter((x) => !x.ok);
    const mord = rouges.some((x) => c.attendu.test(x.label));
    console.log(`${mord ? 'ok  ' : 'FAIL'}  contre-preuve « ${c.nom} » : ${mord ? 'le gate rougit' : `AUCUN ROUGE ATTENDU (${rouges.length} rouge(s) : ${rouges.slice(0, 2).map((x) => x.label).join(' | ') || 'aucun'})`}`);
    if (!mord) echecs += 1;
  }
  B.sortir('droits-niveaux-check --contre-preuves', echecs, `${CONTRE_PREUVES.length} gardes retirees une a une, chacune fait rougir sa ligne.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
