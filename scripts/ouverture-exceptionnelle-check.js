'use strict';
// OUVRIR UN JOUR AUTREMENT, POUR L EQUIPE SEULEMENT (2026-11-09, Ansar : « par exemple c 14-22
// on puet ouvirr le centre a 10 h ou fermer a minuit »).
//
// Ce gate joue le vrai code, sans base :
//   [A] le moteur ne lit l exception que dans la porte de l equipe, et le dit encore apres un await ;
//   [B] les lignes enregistrees sont bornees et propres ;
//   [C] la porte d ecriture : le droit, les dates, les heures, et une plage ne cache jamais un groupe ;
//   [D] les portes du comptoir voient l exception, la porte publique non ;
//   [E] le vrai moteur place un groupe a 09:00 pour l equipe et le refuse au public ;
//   [F] la liste arrive a la console et change la revision ;
//   [G] l enregistrement general du centre ne peut ni l ecrire ni l effacer ;
//   [H] contre-epreuves : chaque garde retiree fait rougir ce gate. Le depot n est jamais touche.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
let echecs = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `\n      ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return cond;
}
const section = (titre) => console.log(`\n[${titre}]`);
const rapporter = (lignes) => lignes.forEach(([c, l, d]) => ok(c, l, d));
const rouge = (lignes) => lignes.some(([c]) => !c);

// Une reservation peut tenir dans le cache d un module : tout le projet se recharge a chaque passage.
function purger() {
  Object.keys(require.cache).forEach((cle) => {
    if (cle.startsWith(ROOT) && !cle.includes('node_modules') && cle !== __filename) delete require.cache[cle];
  });
}

// Un mardi, assez loin pour que la regle des 24 heures ne compte pas.
function mardiLointain() {
  const d = new Date(Date.now() + 21 * 86400000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const JOUR = mardiLointain();
const AUJOURDHUI = new Date().toISOString().slice(0, 10);

function erreurDe(travail) {
  return Promise.resolve().then(travail).then(() => null, (error) => error);
}

function fauxPool(etat) {
  return {
    query: async (sql, params = []) => {
      const q = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
      if (q.startsWith('select settings from centers')) return { rowCount: 1, rows: [{ settings: { config: etat.config } }] };
      if (q.startsWith('select status from centers')) return { rowCount: 1, rows: [{ status: 'active' }] };
      if (q.startsWith('update centers')) { etat.config = JSON.parse(params[1]); etat.ecritures += 1; return { rowCount: 1, rows: [] }; }
      if (q.includes('from centers')) return { rowCount: 1, rows: [{ id: 'libramont', name: 'Libramont', status: 'active', timezone: 'Europe/Brussels', settings: { config: etat.config } }] };
      return { rowCount: 0, rows: [] };
    },
  };
}

const responsable = { role: { locked: true }, permissions: ['reservations.create'], member: { name: 'Rachel' }, authorizedCenterId: 'libramont', centerId: 'libramont' };
const etudiant = { role: { locked: false }, permissions: ['reservations.create'], member: { name: 'Lou' }, authorizedCenterId: 'libramont', centerId: 'libramont' };

function fausseReponse() {
  return {
    statusCode: 200, entetes: {}, corps: null,
    setHeader(k, v) { this.entetes[String(k).toLowerCase()] = v; },
    getHeader(k) { return this.entetes[String(k).toLowerCase()]; },
    writeHead(code, h) { this.statusCode = code; Object.entries(h || {}).forEach(([k, v]) => this.setHeader(k, v)); return this; },
    end(texte) { if (texte) { try { this.corps = JSON.parse(String(texte)); } catch (e) { this.corps = String(texte); } } this.fini = true; },
  };
}

function requeteJson(methode, url, corps, entetes = {}) {
  const req = corps === undefined ? Readable.from([]) : Readable.from([JSON.stringify(corps)]);
  req.method = methode;
  req.url = url;
  req.headers = { host: 'localhost', 'content-type': 'application/json', ...entetes };
  return req;
}

function liste(...lignes) { return lignes; }

// ---------------------------------------------------------------------------
async function verifierContexte() {
  purger();
  const { getSchedule, pourLEquipe } = require('../lib/booking-config');
  const centre = { ouverturesExceptionnelles: [{ date: JOUR, open: '08:00', close: '25:00' }] };
  const dehors = getSchedule(JOUR, centre);
  const dedans = pourLEquipe(() => getSchedule(JOUR, centre));
  const apresAttente = await pourLEquipe(async () => { await new Promise((r) => setTimeout(r, 2)); return getSchedule(JOUR, centre); });
  const apres = getSchedule(JOUR, centre);
  const autreJour = pourLEquipe(() => getSchedule('2031-01-07', centre));
  return liste(
    [!dehors || !dehors.exceptionnelle, 'hors de la porte de l equipe, l horaire habituel', JSON.stringify(dehors)],
    [dedans && dedans.open === 8 && dedans.close === 25 && dedans.exceptionnelle === true, 'dans la porte, l exception, et une nuit qui deborde reste 25:00', JSON.stringify(dedans)],
    [apresAttente && apresAttente.open === 8, 'la porte tient apres un await', JSON.stringify(apresAttente)],
    [!apres || !apres.exceptionnelle, 'en sortant, l horaire habituel revient', JSON.stringify(apres)],
    [!autreJour || !autreJour.exceptionnelle, 'un autre jour n est pas touche', JSON.stringify(autreJour)],
  );
}

function verifierNormalisation() {
  purger();
  const { normalizeOuvertures, sansOuvertures, normalizeCenterConfig } = require('../lib/center-config');
  const lu = normalizeOuvertures([
    { date: '2031-01-08', open: '10:00', close: '24:00', motif: '<b>Team</b>   building' },
    { date: '2031-01-07', open: '09:00', close: '22:00' },
    { date: '2031-01-08', open: '11:00', close: '23:00' },
    { date: 'pas une date', open: '10:00', close: '12:00' },
    { date: '2031-01-09', open: '14:00', close: '10:00' },
    null,
  ]);
  const beaucoup = normalizeOuvertures(Array.from({ length: 260 }, (_, i) => ({ date: `20${30 + Math.floor(i / 28)}-01-${String((i % 28) + 1).padStart(2, '0')}`, open: '10:00', close: '12:00' })));
  const propre = normalizeOuvertures([{ date: '2031-01-08', open: '10:00', close: '24:00', motif: '<b>Team</b>   building' }])[0];
  const config = normalizeCenterConfig({}, 'libramont');
  return liste(
    [lu.length === 2 && lu[0].date === '2031-01-07' && lu[1].open === '11:00', 'une ligne par jour, la derniere gagne, triee, le reste ecarte', JSON.stringify(lu)],
    [beaucoup.length === 200, 'la liste est bornee', String(beaucoup.length)],
    [propre.motif === 'bTeam/b building', 'le motif est nettoye', propre.motif],
    [!('ouverturesExceptionnelles' in config), 'sans ouverture, aucune cle de plus dans la configuration'],
    [!('ouverturesExceptionnelles' in sansOuvertures({ ouverturesExceptionnelles: [1], accueil: {} })), 'l enregistrement general la retire du corps'],
  );
}

async function verifierPorte() {
  purger();
  const { poserOuverture } = require('../lib/ouverture-exceptionnelle');
  const { getCenter, applyCenterOverrides } = require('../lib/ops-knowledge');
  const vieille = '2020-01-07';
  const proche = (() => { const d = new Date(`${AUJOURDHUI}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 3); return d.toISOString().slice(0, 10); })();
  const etat = { config: { ouverturesExceptionnelles: [{ date: vieille, open: '10:00', close: '12:00' }, { date: proche, open: '10:00', close: '12:00' }] }, ecritures: 0 };
  const pool = fauxPool(etat);
  const rafraichir = async () => { applyCenterOverrides(new Map([['libramont', etat.config]])); };
  await rafraichir();
  const base = (sur = {}) => ({ pool, centerId: 'libramont', session: responsable, date: JOUR, open: '08:00', close: '24:00', motif: 'Proximus', aujourdhui: AUJOURDHUI, lireLeJour: async () => ({ reservations: [] }), centre: () => getCenter('libramont'), rafraichir, ...sur });
  const groupe = (startTime, duree, statut = 'confirmed') => ({ name: 'Proximus', startTime, duration: duree, status: statut });

  const refuseRole = await erreurDe(() => poserOuverture(base({ session: etudiant })));
  const ecrituresApresRefus = etat.ecritures;
  const passee = await erreurDe(() => poserOuverture(base({ date: '2020-05-05' })));
  const faux = await erreurDe(() => poserOuverture(base({ date: '2031-02-31' })));
  const heures = await erreurDe(() => poserOuverture(base({ open: '12:00', close: '10:00' })));
  const avant = await erreurDe(() => poserOuverture(base({ open: '12:00', close: '22:00', lireLeJour: async () => ({ reservations: [groupe('10:00', 1)] }) })));
  const apres = await erreurDe(() => poserOuverture(base({ open: '10:00', close: '20:00', lireLeJour: async () => ({ reservations: [groupe('19:00', 3)] }) })));
  const annulee = await erreurDe(() => poserOuverture(base({ open: '12:00', close: '22:00', lireLeJour: async () => ({ reservations: [groupe('10:00', 1, 'cancelled')] }) })));
  const ecrit = etat.config.ouverturesExceptionnelles;
  const pose = await poserOuverture(base({}));
  const apresPose = etat.config.ouverturesExceptionnelles;
  const retirer = await erreurDe(() => poserOuverture(base({ retirer: true, lireLeJour: async () => ({ reservations: [groupe('09:00', 1)] }) })));
  const retire = await poserOuverture(base({ retirer: true }));

  return liste(
    [refuseRole && refuseRole.code === 'ouverture_refusee' && refuseRole.statusCode === 403 && ecrituresApresRefus === 0, 'un role sans « forcer » est refuse, rien ne s ecrit', String(refuseRole && refuseRole.code)],
    [passee && passee.code === 'ouverture_date', 'une date passee est refusee', String(passee && passee.code)],
    [faux && faux.code === 'ouverture_date', 'le 31 fevrier est refuse', String(faux && faux.code)],
    [heures && heures.code === 'ouverture_heures', 'une fermeture avant l ouverture est refusee', String(heures && heures.code)],
    [avant && avant.code === 'ouverture_reservations' && /10:00/.test(avant.message) && /Proximus/.test(avant.message), 'ouvrir apres un groupe est refuse, avec son nom et son heure', String(avant && avant.message)],
    [apres && apres.code === 'ouverture_reservations' && /22:00/.test(apres.message), 'fermer avant la fin d un groupe est refuse', String(apres && apres.message)],
    [annulee === null && ecrit.some((l) => l.date === JOUR && l.open === '12:00'), 'une reservation annulee ne compte pas', String(annulee && annulee.message)],
    [pose.ouverture && pose.ouverture.open === '08:00' && pose.ouverture.par === 'Rachel', 'la plage est enregistree, au nom de la session', JSON.stringify(pose.ouverture)],
    [apresPose.filter((l) => l.date === JOUR).length === 1, 'le meme jour se remplace', JSON.stringify(apresPose)],
    [!apresPose.some((l) => l.date === vieille) && apresPose.some((l) => l.date === proche), 'une ligne vieille de plus d un mois s en va, une recente reste', JSON.stringify(apresPose.map((l) => l.date))],
    [retirer && retirer.code === 'ouverture_reservations', 'revenir aux horaires habituels est refuse si un groupe joue en dehors', String(retirer && retirer.message)],
    [retire.ouverture === null && !(etat.config.ouverturesExceptionnelles || []).some((l) => l.date === JOUR), 'les horaires habituels reviennent', JSON.stringify(etat.config.ouverturesExceptionnelles)],
  );
}

// Les portes du comptoir et la porte publique : ce que le moteur voit au moment ou la requete entre.
async function verifierPortes() {
  purger();
  const auth = require('../lib/staff-auth');
  const { getSchedule } = require('../lib/booking-config');
  const centre = { ouverturesExceptionnelles: [{ date: JOUR, open: '08:00', close: '24:00' }] };
  const vus = [];
  auth.requireStaffPermission = async (req, res) => { vus.push(getSchedule(JOUR, centre)); res.statusCode = 401; res.end('{}'); return null; };
  const appels = [
    ['api/staff-state', 'GET', `/api/staff-state?date=${JOUR}&centerId=libramont`],
    ['api/staff-reservations', 'POST', '/api/staff-reservations'],
    ['api/staff-lanes', 'PATCH', '/api/staff-lanes'],
    ['api/admin-range', 'GET', `/api/admin-range?startDate=${JOUR}&centerId=libramont`],
  ];
  const lignes = [];
  for (const [fichier, methode, url] of appels) {
    vus.length = 0;
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const handler = require(`../${fichier}`);
    // eslint-disable-next-line no-await-in-loop
    await handler(requeteJson(methode, url, methode === 'GET' ? undefined : { centerId: 'libramont', date: JOUR }), fausseReponse());
    lignes.push([vus.length > 0 && vus[0] && vus[0].exceptionnelle === true, `${fichier} : l equipe voit l exception`, JSON.stringify(vus)]);
  }
  // Le retard d un groupe (api/ops.js, delayImpact et delayApply) : la reservation se lit dans la porte.
  for (const action of ['delayImpact', 'delayApply']) {
    purger();
    const auth2 = require('../lib/staff-auth');
    const db = require('../lib/database');
    const { getSchedule: horaire } = require('../lib/booking-config');
    const vusRetard = [];
    auth2.requireStaffPermission = async () => ({ ...responsable });
    db.getReservationById = async () => { vusRetard.push(horaire(JOUR, centre)); throw new Error('arret du gate'); };
    const ops = require('../api/ops');
    // eslint-disable-next-line no-await-in-loop
    await ops(requeteJson('POST', '/api/ops?centerId=libramont', { action, centerId: 'libramont', reservationId: 1, delayMinutes: 30 }), fausseReponse());
    lignes.push([vusRetard.length > 0 && vusRetard[0] && vusRetard[0].exceptionnelle === true, `api/ops ${action} : le retard voit l exception`, JSON.stringify(vusRetard)]);
  }
  purger();
  const { getSchedule: horaireApres } = require('../lib/booking-config');
  const dehors = horaireApres(JOUR, centre);
  lignes.push([!dehors || !dehors.exceptionnelle, 'apres ces requetes, le processus revoit l horaire habituel', JSON.stringify(dehors)]);
  return lignes;
}

// Le vrai moteur : le comptoir place, le public refuse, l etude d une demande s elargit.
async function verifierMoteur() {
  purger();
  const { pourLEquipe, getSchedule } = require('../lib/booking-config');
  const { applyCenterOverrides, getCenter } = require('../lib/ops-knowledge');
  const { planifierPourLaFenetre } = require('../lib/reserver-fenetre');
  const { etudeDeLaDemande } = require('../lib/demande-bureau-centre');
  const { isCenterClosedAt } = require('../lib/availability-blocks');
  const { disponibiliteInterne } = require('../lib/disponibilite-interne');
  applyCenterOverrides(new Map([['libramont', { ouverturesExceptionnelles: [{ date: JOUR, open: '08:00', close: '24:00' }] }]]));
  const habituel = getSchedule(JOUR, getCenter('libramont'));
  const session = { authorizedCenterId: 'libramont', role: { locked: true }, permissions: [] };
  const corps = { centerId: 'libramont', date: JOUR, pax: 6, startTime: '09:00', type: 'bowling', duration: 1, laneCount: 1, name: 'Gate ouverture', phone: '+32470000000', email: 'gate@example.test' };
  const vide = async () => ({ reservations: [], laneStatuses: {} });
  const planifier = () => planifierPourLaFenetre(corps, session, { readState: vide }).then((r) => r, (error) => ({ erreur: error.message }));
  const equipe = await pourLEquipe(planifier);
  const public_ = await planifier();
  const place = (r) => Boolean(r && !r.erreur && r.plan && r.plan.disponible !== false);
  const item = { id: 1, centerId: 'libramont', email: '', pax: 6, status: 'new', message: '', createdAt: `${AUJOURDHUI}T08:00:00.000Z`, payload: { demande: { version: 1, groupType: 'entreprise', groupTypeLabel: 'Entreprise', participants: 6, companions: 0, flexible: false, date: JOUR, alternativeDate: '', period: '', moment: 'indifferent', momentLabel: 'Peu importe', formulas: [], activities: [{ id: 'bowling', name: 'Bowling' }], advice: false, budgetPerPerson: 0 } } };
  const deps = { rafraichir: async () => {}, centre: () => getCenter('libramont'), fermetures: async () => [], getSchedule, isCenterClosedAt, disponibilite: (p) => disponibiliteInterne(p), planning: async () => ({ reservations: [] }), aujourdhui: () => AUJOURDHUI, client: async () => null };
  const etudeEquipe = await pourLEquipe(() => etudeDeLaDemande(item, deps));
  const etudeDehors = await etudeDeLaDemande(item, deps);
  const hE = etudeEquipe.etude.dates[0].horaires;
  const hD = etudeDehors.etude.dates[0].horaires;
  return liste(
    [habituel && habituel.open >= 12 && !habituel.exceptionnelle, `MONTAGE : ce mardi ouvre l apres-midi (${habituel && habituel.open}h)`, JSON.stringify(habituel)],
    [place(equipe), 'pour l equipe, le vrai moteur place un bowling a 09:00', JSON.stringify(equipe).slice(0, 300)],
    [!place(public_), 'sans la porte de l equipe, le meme bowling est refuse', JSON.stringify(public_).slice(0, 300)],
    [hE && hE.de === '08:00' && hE.exceptionnelle === true, 'l etude d une demande s ouvre a 08:00 pour l equipe', JSON.stringify(hE)],
    [hD && hD.de !== '08:00' && !hD.exceptionnelle, 'le mail automatique et tout ce qui reste dehors gardent l horaire habituel', JSON.stringify(hD)],
  );
}

async function verifierEtat() {
  purger();
  const auth = require('../lib/staff-auth');
  const db = require('../lib/database');
  const { applyCenterOverrides } = require('../lib/ops-knowledge');
  auth.requireStaffPermission = async () => ({ ...responsable });
  db.readStaffState = async (date) => ({ date, reservations: [], laneStatuses: {}, revision: 'r1' });
  db.getPool = () => { throw new Error('pas de base'); };
  const handler = require('../api/staff-state');
  const lire = async (entetes = {}) => { const res = fausseReponse(); await handler(requeteJson('GET', `/api/staff-state?date=${JOUR}&centerId=libramont`, undefined, entetes), res); return res; };
  applyCenterOverrides(new Map([['libramont', {}]]));
  const sans = await lire();
  applyCenterOverrides(new Map([['libramont', { ouverturesExceptionnelles: [{ date: JOUR, open: '08:00', close: '24:00', motif: 'Proximus', par: 'Rachel', le: '2030-01-01T00:00:00.000Z' }] }]]));
  const avec = await lire();
  const pareil = await lire({ 'if-none-match': avec.entetes.etag });
  const ancien = await lire({ 'if-none-match': sans.entetes.etag });
  const ligne = avec.corps && avec.corps.ouvertures && avec.corps.ouvertures[0];
  return liste(
    [sans.corps && Array.isArray(sans.corps.ouvertures) && sans.corps.ouvertures.length === 0 && sans.corps.revision === 'r1', 'sans ouverture, la reponse et la revision ne changent pas', JSON.stringify(sans.corps).slice(0, 200)],
    [ligne && ligne.date === JOUR && ligne.open === '08:00' && ligne.motif === 'Proximus', 'la console recoit la liste', JSON.stringify(ligne)],
    [ligne && !('par' in ligne) && !('le' in ligne), 'la liste ne dit que ce que la console affiche', JSON.stringify(ligne)],
    [avec.entetes.etag !== sans.entetes.etag, 'changer une heure change la revision', String(avec.entetes.etag)],
    [pareil.statusCode === 304 && ancien.statusCode === 200, 'un poste a jour recoit 304, un poste en retard la nouvelle liste', `${pareil.statusCode} ${ancien.statusCode}`],
  );
}

async function verifierConfigurationGenerale() {
  purger();
  const auth = require('../lib/staff-auth');
  const db = require('../lib/database');
  const etat = { config: { ouverturesExceptionnelles: [{ date: JOUR, open: '08:00', close: '24:00' }] }, ecritures: 0 };
  const pool = fauxPool(etat);
  db.getPool = () => pool;
  auth.requireStaffPermission = async () => ({ ...responsable, permissions: ['settings.manage', 'reservations.create'] });
  const ops = require('../api/ops');
  const appeler = async (corps) => { const res = fausseReponse(); await ops(requeteJson('POST', '/api/ops?centerId=libramont', corps), res); return res; };
  const sauve = await appeler({ action: 'saveCenterConfig', centerId: 'libramont', config: { ouverturesExceptionnelles: [] } });
  const garde = etat.config.ouverturesExceptionnelles;
  const force = await appeler({ action: 'saveCenterConfig', centerId: 'libramont', config: { ouverturesExceptionnelles: [{ date: '2031-01-07', open: '01:00', close: '02:00' }] } });
  const garde2 = etat.config.ouverturesExceptionnelles;
  auth.requireStaffPermission = async () => ({ ...etudiant });
  purger();
  const auth2 = require('../lib/staff-auth');
  const db2 = require('../lib/database');
  db2.getPool = () => pool;
  auth2.requireStaffPermission = async () => ({ ...etudiant });
  const ops2 = require('../api/ops');
  const refus = fausseReponse();
  const avantRefus = JSON.stringify(etat.config.ouverturesExceptionnelles);
  await ops2(requeteJson('POST', '/api/ops?centerId=libramont', { action: 'ouvertureExceptionnelle', centerId: 'libramont', date: JOUR, open: '06:00', close: '24:00' }), refus);
  return liste(
    [sauve.corps && sauve.corps.ok === true && Array.isArray(garde) && garde.length === 1, 'un enregistrement general ne peut pas l effacer', JSON.stringify(sauve.corps || {}).slice(0, 200)],
    [force.corps && force.corps.ok === true && garde2.length === 1 && garde2[0].date === JOUR, 'un enregistrement general ne peut pas l ecrire', JSON.stringify(garde2)],
    [ops.getRequiredOpsPermission('POST', 'ouvertureExceptionnelle') === 'reservations.create', 'la porte demande le droit de reserver', String(ops.getRequiredOpsPermission('POST', 'ouvertureExceptionnelle'))],
    [refus.statusCode === 403 && refus.corps && refus.corps.code === 'ouverture_refusee' && JSON.stringify(etat.config.ouverturesExceptionnelles) === avantRefus, 'la route refuse un role sans « forcer », avec son code', `${refus.statusCode} ${JSON.stringify(refus.corps)}`],
  );
}

// ---------------------------------------------------------------------------
function avecMutation(fichier, ancre, mute, travail) {
  const cible = path.join(ROOT, fichier);
  const base = Module._extensions['.js'];
  const brut = fs.readFileSync(cible, 'utf8').replace(/\r\n/g, '\n');
  if (brut.split(ancre).length !== 2) throw new Error(`ANCRE ${fichier} : ${ancre.slice(0, 70)}`);
  Module._extensions['.js'] = function extension(module, filename) {
    if (path.resolve(filename) === cible) { module._compile(brut.split(ancre).join(mute), filename); return; }
    base(module, filename);
  };
  purger();
  return Promise.resolve().then(travail).finally(() => { Module._extensions['.js'] = base; purger(); });
}

const CONTRE_EPREUVES = [
  { fichier: 'lib/booking-config.js', ancre: "  if (contexte && contexte.equipe === true) {", mute: "  if (true) {", label: 'sans la porte de l equipe, le public verrait l exception', verifier: verifierContexte },
  { fichier: 'lib/booking-config.js', ancre: "  if (contexte && contexte.equipe === true) {", mute: "  if (true) {", label: 'sans la porte de l equipe, le vrai moteur placerait pour le public', verifier: verifierMoteur },
  { fichier: 'lib/booking-config.js', ancre: "    if (exception) return exception;", mute: "", label: 'sans l exception, le comptoir ne pourrait rien placer', verifier: verifierMoteur },
  { fichier: 'api/staff-reservations.js', ancre: "module.exports = (req, res) => require('../lib/booking-config').pourLEquipe(() => traiter(req, res));", mute: "module.exports = traiter;", label: 'sans l enveloppe, la creation serait refusee au comptoir', verifier: verifierPortes },
  { fichier: 'api/staff-state.js', ancre: "module.exports = (req, res) => require('../lib/booking-config').pourLEquipe(() => traiter(req, res));", mute: "module.exports = traiter;", label: 'sans l enveloppe, le planning garderait la journee habituelle', verifier: verifierPortes },
  { fichier: 'api/staff-state.js', ancre: "    if (ouvertures.length && snapshot.revision) {", mute: "    if (false) {", label: 'sans la revision, les autres postes ne verraient rien', verifier: verifierEtat },
  { fichier: 'lib/ouverture-exceptionnelle.js', ancre: "  exigerOuverture(session);", mute: "", label: 'sans le droit, tout le monde changerait les horaires', verifier: verifierPorte },
  { fichier: 'lib/ouverture-exceptionnelle.js', ancre: "    controlerLaPlage(reservations, { open: timeToNum(horaire.open), close: timeToNum(horaire.close) });", mute: "", label: 'sans le controle, une plage cacherait un groupe', verifier: verifierPorte },
  { fichier: 'lib/ouverture-exceptionnelle.js', ancre: "    controlerLaPlage(reservations, getSchedule(date, center));", mute: "", label: 'sans le controle, revenir aux horaires cacherait un groupe', verifier: verifierPorte },
  { fichier: 'lib/ouverture-exceptionnelle.js', ancre: "  if (!dateReelle(date)) throw refus('ouverture_date', 'Cette date n’existe pas.', 400);", mute: "", label: 'sans la date reelle, le 31 fevrier passerait', verifier: verifierPorte },
  { fichier: 'api/ops.js', ancre: "  if ((action === 'delayImpact' || action === 'delayApply') && !options.horairesEquipe) {", mute: "  if (false) {", label: 'sans la porte, un retard refuserait de passer 22:00 un jour ouvert jusqu a minuit', verifier: verifierPortes },
  { fichier: 'api/ops.js', ancre: "sansOuvertures(sansGrillesTarif(sansCatalogueSurMesure(body.config || {})))", mute: "sansGrillesTarif(sansCatalogueSurMesure(body.config || {}))", label: 'sans le retrait, l enregistrement general ecrirait la liste', verifier: verifierConfigurationGenerale },
];

async function main() {
  section('A. LE MOTEUR NE LA LIT QUE POUR L EQUIPE');
  rapporter(await verifierContexte());
  section('B. DES LIGNES PROPRES');
  rapporter(verifierNormalisation());
  section('C. LA PORTE D ECRITURE');
  rapporter(await verifierPorte());
  section('D. LES PORTES DU COMPTOIR');
  rapporter(await verifierPortes());
  section('E. LE VRAI MOTEUR');
  rapporter(await verifierMoteur());
  section('F. LA LISTE ARRIVE A LA CONSOLE');
  rapporter(await verifierEtat());
  section('G. L ENREGISTREMENT GENERAL DU CENTRE');
  rapporter(await verifierConfigurationGenerale());
  section('H. CONTRE-EPREUVES');
  for (const m of CONTRE_EPREUVES) {
    // eslint-disable-next-line no-await-in-loop
    const lignes = await avecMutation(m.fichier, m.ancre, m.mute, m.verifier);
    ok(rouge(lignes), `${m.label} : ce gate ROUGIRAIT`);
  }
  purger();
  ok(!rouge(await verifierContexte()), 'code restaure : le moteur repond de nouveau juste');
  console.log(`\n${echecs === 0 ? 'ouverture-exceptionnelle-check: ALL OK' : `ouverture-exceptionnelle-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
