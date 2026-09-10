// Gate : L AGENT DIT CE QUE LE TUNNEL PROPOSE (patch 72e).
//
// L agent qui repond aux clients annonce trois choses que seul le tunnel de
// reservation sait vraiment : quels jours une formule se reserve, combien de
// temps elle dure, et jusqu a quelle heure on peut encore arriver aujourd hui.
// Ce gate les confronte a la ROUTE PUBLIQUE ELLE-MEME, en process : pas de
// reseau, pas de base. Le limiteur est neutralise, et l agenda du jour que la
// route lit est celui du scenario (aucune reservation, les blocages poses ici).
//
// L HORLOGE EST POSEE sur chaque instant mesure. Le moteur ne retire les heures
// passees que de SON aujourd hui : c est lui qu on veut juger, pas l heure a
// laquelle la suite tourne.
// node scripts/agent-tunnel-check.js
const path = require('path');
const http = require('http');

const RACINE = path.resolve(__dirname, '..');

const DateDeLaMachine = Date;
let decalage = DateDeLaMachine.parse('2026-09-10T10:00:00Z') - DateDeLaMachine.now();
class DateDuGate extends DateDeLaMachine {
  constructor(...args) {
    if (args.length) super(...args);
    else super(DateDeLaMachine.now() + decalage);
  }

  static now() { return DateDeLaMachine.now() + decalage; }
}
global.Date = DateDuGate;
const poserLHorloge = (iso) => { decalage = DateDeLaMachine.parse(iso) - DateDeLaMachine.now(); };

let failures = 0;
function ok(label, condition, detail = '') {
  if (condition) {
    console.log(`ok    ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${label}${detail ? `  ${String(detail).slice(0, 400)}` : ''}`);
}

// Les mocks d infrastructure AVANT tout require applicatif : la route prend
// ses fonctions de base a son chargement.
const limiteur = require.resolve(path.join(RACINE, 'lib/rate-limit'));
require.cache[limiteur] = {
  id: limiteur,
  filename: limiteur,
  loaded: true,
  exports: {
    enforceRateLimit: () => false,
    checkRateLimit: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }),
    getClientIp: () => 'gate',
  },
};
const { resolveBlocksForDate } = require('../lib/availability-blocks');
let blocsDuScenario = [];
const base = require('../lib/database');
base.readAvailabilitySnapshot = async (date, centerId) => ({
  date, centerId, reservations: [], laneStatuses: {}, blocks: resolveBlocksForDate(blocsDuScenario, date),
});
const route = require('../api/public-availability.js');
const moteur = require('../lib/booking-config');
const { getCenter, publicBookingBlockReason } = require('../lib/ops-knowledge');
const {
  agendaDuCentre, agendaDesPrix, arriveesDAujourdhui, formuleAvecSesRessources, prixReservables,
} = require('../lib/center-facts');
const { buildEmailBrain, plagesDesHeures } = require('../lib/email-agent');

const minutesDe = (debut, fin) => Math.round((moteur.timeToNum(fin) - moteur.timeToNum(debut)) * 60);

(async () => {
  const serveur = await new Promise((resoudre) => {
    const s = http.createServer(async (requete, reponse) => {
      try { await route(requete, reponse); } catch (error) { reponse.writeHead(500); reponse.end(JSON.stringify({ message: String(error.message) })); }
    });
    s.listen(0, '127.0.0.1', () => resoudre(s));
  });
  const port = serveur.address().port;
  const lireLaRoute = (params) => new Promise((resoudre, rejeter) => {
    http.get(`http://127.0.0.1:${port}/api/public-availability?${new URLSearchParams(params)}`, (reponse) => {
      // Sans setEncoding, chaque paquet est decode seul : un « é » coupe entre
      // deux paquets devient deux caracteres de remplacement.
      reponse.setEncoding('utf8');
      let corps = '';
      reponse.on('data', (morceau) => { corps += morceau; });
      reponse.on('end', () => { try { resoudre(JSON.parse(corps)); } catch (error) { rejeter(error); } });
    }).on('error', rejeter);
  });
  // CE QUE LE TUNNEL SERT a un groupe de la taille minimale de la formule.
  const creneaux = async (centerId, date, formule) => {
    const minimum = Number(formule.minPax) > 0 ? Number(formule.minPax) : 1;
    const corps = await lireLaRoute({ date, type: 'formule', formuleId: formule.id, pax: String(minimum), centerId });
    return (corps.slots || []).map((slot) => ({ time: slot.time, endTime: (slot.opsPlan && slot.opsPlan.endTime) || '' }));
  };
  // Une arrivee par heure, dans l ordre de la route : c est ce qu un client choisit.
  const heuresDe = (liste) => [...new Set(liste.map((a) => a.time))];

  // CE QUE LA ROUTE DIT D UN CATALOGUE sur des jours : les jours ou elle sert au
  // moins un creneau, et la duree de ses plans, la plus courte et la plus longue.
  const verdictDeLaRoute = async (centerId, formules, jours) => {
    const verdict = new Map();
    for (const formule of formules) {
      let joursServis = 0;
      const minutes = [];
      for (const date of jours) {
        const liste = await creneaux(centerId, date, formule);
        if (liste.length) joursServis += 1;
        liste.forEach((a) => minutes.push(minutesDe(a.time, a.endTime)));
      }
      verdict.set(formule.id, {
        jours: joursServis,
        duree: minutes.length ? { min: Math.min(...minutes), max: Math.max(...minutes) } : null,
      });
    }
    return verdict;
  };
  const comparer = (prix, verdict) => {
    const ecarts = [];
    verdict.forEach((attendu, id) => {
      const lu = prix.find((p) => String(p.id) === String(id));
      if (!attendu.jours) {
        if (lu) ecarts.push(`${id} publiee (${lu.jours} j) alors que la route ne la sert jamais`);
        return;
      }
      if (!lu) { ecarts.push(`${id} absente alors que la route la sert ${attendu.jours} j`); return; }
      if (lu.jours !== attendu.jours) ecarts.push(`${id} ${lu.jours} j / route ${attendu.jours} j`);
      if (JSON.stringify(lu.duree) !== JSON.stringify(attendu.duree)) ecarts.push(`${id} duree ${JSON.stringify(lu.duree)} / route ${JSON.stringify(attendu.duree)}`);
    });
    return ecarts;
  };

  // ── LES JOURS ET LA DUREE ─────────────────────────────────────────────
  console.log('[JOURS] quels jours une formule se reserve, et combien de temps elle dure');
  const libramont = getCenter('libramont');
  const catalogue = moteur.getEffectiveFormules('libramont').map(formuleAvecSesRessources);
  const agenda = agendaDuCentre(libramont, [], '2026-09-10');
  const agendaPrix = agendaDesPrix(agenda, '2026-09-10');
  const joursPrix = agendaPrix.filter((j) => j.ouvert && !j.ferme).map((j) => j.date);
  ok('MONTAGE : la fenetre des prix commence demain et porte des jours ouverts',
    joursPrix.length >= 7 && joursPrix[0] > '2026-09-10', joursPrix.join(' '));
  const prix = prixReservables(catalogue, libramont, agendaPrix);
  const verdict = await verdictDeLaRoute('libramont', catalogue, joursPrix);
  ok('MONTAGE : la route sert des formules certains jours et pas d autres',
    [...verdict.values()].some((v) => v.jours === joursPrix.length) && [...verdict.values()].some((v) => v.jours > 0 && v.jours < joursPrix.length),
    [...verdict].map(([id, v]) => `${id}:${v.jours}`).join(' '));
  const lignes = catalogue.filter((f) => f.orderPolicy !== 'open_window')
    .filter((f) => verdict.get(f.id).duree && verdict.get(f.id).duree.min !== Math.round(moteur.getFormuleTotalDuration(f) * 60));
  ok('MONTAGE : pour plusieurs formules, la route planifie une autre duree que les lignes de la formule',
    lignes.length >= 3,
    lignes.map((f) => `${f.id} route ${verdict.get(f.id).duree.min} min / lignes ${moteur.getFormuleTotalDuration(f) * 60} min`).join(', '));
  const ecartsLibramont = comparer(prix, verdict);
  ok('LE POINT : pour CHAQUE formule, l agent compte les jours ou la route sert un creneau, et la duree de SES plans',
    ecartsLibramont.length === 0, ecartsLibramont.join(' ; '));

  // ── AVEC DES BLOCAGES ─────────────────────────────────────────────────
  // Une privatisation le samedi soir, une formule suspendue deux heures, l arene
  // fermee une heure, et une piste en panne tout le jeudi : la garde finale de
  // la route retire des creneaux au milieu d une journee, pas des jours entiers.
  const SAMEDI = joursPrix.find((date) => new DateDeLaMachine(`${date}T12:00:00Z`).getUTCDay() === 6);
  const JEUDI = joursPrix.find((date) => new DateDeLaMachine(`${date}T12:00:00Z`).getUTCDay() === 4);
  const blocage = (id, over) => ({
    id, centerId: 'libramont', recurrence: 'once', dayOfWeek: null, dateFrom: null, dateUntil: null, reason: 'gate', createdBy: 'gate', ...over,
  });
  const FORMULE_1 = catalogue.find((f) => f.id === 'f1');
  const sansBlocage = heuresDe(await creneaux('libramont', SAMEDI, FORMULE_1));
  blocsDuScenario = [
    blocage(1, { scopeType: 'center', scopeRef: null, date: SAMEDI, startMin: 20 * 60 + 30, endMin: 21 * 60 }),
    blocage(2, { scopeType: 'formula', scopeRef: 'f6', date: SAMEDI, startMin: 15 * 60, endMin: 17 * 60 }),
    blocage(3, { scopeType: 'activity', scopeRef: 'laser_game', date: SAMEDI, startMin: 16 * 60, endMin: 17 * 60 }),
    blocage(4, { scopeType: 'lane', scopeRef: '2', date: JEUDI, startMin: null, endMin: null }),
  ];
  const prixBloques = prixReservables(catalogue, libramont, agendaPrix, blocsDuScenario);
  const verdictBloque = await verdictDeLaRoute('libramont', catalogue, joursPrix);
  const avecBlocage = heuresDe(await creneaux('libramont', SAMEDI, FORMULE_1));
  ok('MONTAGE : les blocages retirent a la route des creneaux de ce samedi, sans lui retirer le jour',
    Boolean(SAMEDI) && Boolean(JEUDI) && avecBlocage.length > 0 && avecBlocage.length < sansBlocage.length
      && avecBlocage.every((heure) => sansBlocage.includes(heure)),
    `${SAMEDI} : ${sansBlocage.length} heures sans blocage, ${avecBlocage.length} avec (${avecBlocage.join(' ')})`);
  const ecartsBloques = comparer(prixBloques, verdictBloque);
  ok('LE POINT : avec des blocages, l agent compte encore exactement ce que la route sert',
    ecartsBloques.length === 0, ecartsBloques.join(' ; '));

  // ── AUJOURD HUI, HEURE PAR HEURE ──────────────────────────────────────
  console.log('\n[AUJOURD HUI] les heures que la route sert encore, a l instant ou on le demande');
  const INSTANTS = [
    ['samedi 10 h 05', `${SAMEDI}T08:05:00Z`],
    ['samedi 15 h 20', `${SAMEDI}T13:20:00Z`],
    ['samedi 22 h', `${SAMEDI}T20:00:00Z`],
    ['jeudi 14 h 10', `${JEUDI}T12:10:00Z`],
  ];
  const deps = { query: async () => ({ rows: [] }) };
  for (const [nom, instant] of INSTANTS) {
    poserLHorloge(instant);
    const jour = moteur.todayStr();
    const duJour = arriveesDAujourdhui(catalogue, libramont, jour, blocsDuScenario);
    const ecarts = [];
    let servies = 0;
    for (const formule of catalogue) {
      const attendues = heuresDe(await creneaux('libramont', jour, formule));
      if (attendues.length) servies += 1;
      const lues = (duJour.find((f) => f.id === formule.id) || { heures: null }).heures;
      if (JSON.stringify(lues) !== JSON.stringify(attendues)) ecarts.push(`${formule.id} agent ${JSON.stringify(lues)} / route ${JSON.stringify(attendues)}`);
    }
    ok(`LE POINT : ${nom}, l agent lit formule par formule les heures que la route sert (${servies} formule(s) encore servies)`,
      ecarts.length === 0, ecarts.join(' ; '));
  }

  // DE BOUT EN BOUT : la ligne que le modele recoit. Samedi 15 h 20, avec la
  // privatisation de 20 h 30 a 21 h : les heures se disent en plages, sans
  // enjamber le trou.
  poserLHorloge(`${SAMEDI}T13:20:00Z`);
  const depsBloques = {
    query: async (sql) => (/from availability_blocks/i.test(String(sql))
      ? {
        rows: blocsDuScenario.map((b) => ({
          id: b.id, center_id: 'libramont', scope_type: b.scopeType, scope_ref: b.scopeRef, recurrence: 'once',
          date: b.date, day_of_week: null, date_from: null, date_until: null,
          start_time: b.startMin === null ? null : moteur.numToTime(b.startMin / 60),
          end_time: b.endMin === null ? null : moteur.numToTime(b.endMin / 60),
          reason: 'gate', created_by: 'gate',
        })),
      }
      : { rows: [] }),
  };
  const cerveau = await buildEmailBrain('libramont', depsBloques, DateDeLaMachine.parse(`${SAMEDI}T13:20:00Z`));
  const ligne = cerveau.context.split('\n').find((l) => l.startsWith('AUJOURD HUI')) || '';
  const partie = (debut) => (ligne.split(' ; ').find((p) => p.includes(debut)) || '');
  const ecartsLigne = [];
  const f1Samedi = heuresDe(await creneaux('libramont', SAMEDI, catalogue.find((f) => f.id === 'f1')));
  for (const formule of catalogue) {
    const attendues = heuresDe(await creneaux('libramont', SAMEDI, formule));
    const nomDit = String(formule.name || formule.id);
    if (attendues.length && !partie('arrivee encore possible pour').includes(`${nomDit} ${plagesDesHeures(attendues)}`)) ecartsLigne.push(`${formule.id} attendu « ${plagesDesHeures(attendues)} »`);
    if (!attendues.length && !partie('plus possible aujourd hui').includes(nomDit)) ecartsLigne.push(`${formule.id} devrait etre dite plus possible`);
  }
  ok('MONTAGE : ce samedi a 15 h 20, la privatisation coupe en deux les heures que la route sert pour FORMULE 1',
    plagesDesHeures(f1Samedi).includes(' et '), `${f1Samedi.join(' ')} -> ${plagesDesHeures(f1Samedi)}`);
  ok('LE POINT : la ligne du jour dit, formule par formule, les plages que la route sert',
    ligne.startsWith('AUJOURD HUI, il est 15 h 20 :') && ecartsLigne.length === 0,
    `${ecartsLigne.join(' ; ')} || ${ligne.slice(0, 300)}`);
  ok('LE POINT : et une plage coupee par la privatisation se dit en deux, jamais d un bout a l autre',
    new RegExp(`FORMULE 1 ${plagesDesHeures(f1Samedi)}`).test(ligne) && / et de /.test(partie('arrivee encore possible pour')),
    ligne.slice(0, 200));
  blocsDuScenario = [];

  // ── DES CENTRES OU LE TUNNEL REFUSE CE QUE LA FENETRE LAISSE ──────────
  console.log('\n[CENTRES] ce que la fenetre laisse passer et que le tunnel refuse');
  poserLHorloge('2026-09-10T10:00:00Z');
  for (const centerId of ['gembloux', 'ciney']) {
    const centre = getCenter(centerId);
    // La grille que le moteur leur applique : aucune n est declaree, et
    // l agenda du centre est vide pour cette raison. On pose ici les jours que
    // le moteur ouvre, pour que la fenetre ait quelque chose a proposer.
    const agendaDuMoteur = joursPrix.map((date) => ({ date, ouvert: Boolean(moteur.getSchedule(date, centre)), ferme: false }));
    const joursDuMoteur = agendaDuMoteur.filter((j) => j.ouvert).map((j) => j.date);
    const sonCatalogue = moteur.getEffectiveFormules(centerId).map(formuleAvecSesRessources);
    const sesPrix = prixReservables(sonCatalogue, centre, agendaDuMoteur);
    const sansTunnel = prixReservables(sonCatalogue, centre, agendaDuMoteur, [], null, () => [{ time: '14:00', endTime: '16:00' }]);
    const sonVerdict = await verdictDeLaRoute(centerId, sonCatalogue, joursDuMoteur);
    const refusees = sonCatalogue.filter((f) => sonVerdict.get(f.id).jours === 0).map((f) => f.id);
    ok(`MONTAGE : ${centerId}, la fenetre laisse passer des formules que la route ne sert jamais`,
      refusees.length > 0 && refusees.every((id) => sansTunnel.some((p) => p.id === id)),
      `${refusees.join(',') || 'aucune'}${publicBookingBlockReason(centerId) ? ` ; centre ferme a la reservation : ${publicBookingBlockReason(centerId)}` : ''}`);
    const ecarts = comparer(sesPrix, sonVerdict);
    ok(`LE POINT : ${centerId}, l agent ne publie que ce que la route sert`, ecarts.length === 0, ecarts.join(' ; '));
  }

  serveur.close();
  console.log(`\n${failures ? `agent-tunnel-check: ${failures} ECHEC(S)` : 'agent-tunnel-check: ALL OK'}`);
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('agent-tunnel-check CRASH:', error && (error.stack || error.message));
  process.exit(1);
});
