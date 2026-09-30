// UNE INSTALLATION COMPTEE NE SE VEND PAS DEUX FOIS.
//
// Le catalogue distingue deux familles d activites (lib/activity-catalog.js) :
// les PLANIFIEES (bowling, laser) qui occupent une ressource comptee, et les
// LIBRES que "le centre absorbe". Cette frontiere est juste pour un minigolf ou
// une plaine de jeux : rien ne s y epuise.
//
// Elle est FAUSSE des qu une activite libre declare une DOTATION FINIE. Mesure
// du 2026-08-31 sur la donnee de PROD de Fun Galaxy Libramont :
//
//   duckpin_bowling : planned=false, resourceType=duckpin_lane,
//                     units=2, capacityPerUnit=6, unitIds=["9","10"]
//
// Deux pistes physiques, nommees. Le moteur ne les comptait jamais : six
// groupes de 12 personnes reservaient le meme creneau de 15:00, six fois
// HTTP 201, 12 pistes vendues pour 2 qui existent, et le bloc pose etant
// `soft_capacity`, le planning du samedi n en montrait AUCUNE. Le comptoir
// decouvrait les groupes en trop a leur arrivee. Toutes les autres activites
// libres de ce centre ont units=null : elles restent absorbables, et ce gate
// verifie AUSSI qu on ne les a pas bridees par exces de zele.
//
// Quatre proprietes de comportement, sur les vrais handlers HTTP :
//   A. TEMOIN : le bowling refuse au-dela de ses pistes (la borne existe la ou
//      le moteur connait la ressource).
//   B. SUJET : une activite a dotation finie refuse au-dela de sa dotation,
//      QUEL QUE SOIT L ORDRE DES GROUPES. La revue du 2026-09-04 a montre que
//      le gate ne testait que des ordres HOMOGENES (12 puis 12, ou 6 puis 6),
//      les deux seuls qui survivent a un sous-comptage : un groupe de 12 (deux
//      pistes) suivi d un groupe de 6 (une piste) passait deux fois.
//   C. NON-REGRESSION : une activite SANS dotation (units=null) n est pas
//      bridee, la doctrine "le centre absorbe" reste vraie.
//   D. LA GARDE VAUT POUR TOUTE VISITE, ET ELLE NE REFUSE QUE L IRREALISABLE.
//      Une visite mixte (bowling + duckpin) passe sous la garde ; mais une
//      activite libre n a AUCUNE heure imposee, donc elle n est refusee que si
//      sa dotation est prise pendant TOUTE la fenetre de la visite.
//   E. UN GROUPE DEJA POSE NE TIENT SES UNITES QUE LE TEMPS DE LES JOUER
//      (2026-09-30). Le dossier 1404 de la prod (bowling et laser jusqu a
//      15:25, puis 1 h 30 de duckpin dans une visite comptee jusqu a 19:00)
//      ne ferme plus le duckpin de 13:30 a 19:00 ; mais le groupe qui lui
//      prendrait sa derniere heure et demie est refuse.
//
// LE STORE RANGE CE QUE LA PRODUCTION RANGE. Le faux createReservation poussait
// le payload BRUT, qui porte laneCount ; createReservation passe en production
// par normalizeReservationPayload, dont la liste blanche ne conserve PAS
// laneCount. Le gate mesurait donc une forme que la production ne produit
// jamais, et il restait vert sur un sous-comptage reel. Il normalise desormais
// comme la base.
//
// Puis une CONTRE-EPREUVE PAR MUTATION SERVIE EN MEMOIRE, une par propriete de
// la garde : on prouve que le gate rougit sans elle, et que le disque n a
// jamais ete touche.
//
// Lancement : node scripts/finite-endowment-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OPS = path.join(ROOT, 'lib/reservation-ops.js');
const PORT = Number(process.env.PINLANE_ENDOWMENT_PORT || 4493);
const BASE = `http://127.0.0.1:${PORT}`;

// LA CONTRE-EPREUVE NE TOUCHE JAMAIS LE DEPOT.
// `--mutate` relance ce gate dans un processus fils avec PINLANE_ENDOWMENT_MUTATION
// pose. Le crochet ci-dessous SERT une copie mutee de lib/reservation-ops.js au
// moment du require : le fichier sur le disque n est ni ecrit ni restaure, donc
// une contre-epreuve interrompue ne peut pas laisser le moteur neutralise
// derriere elle. Le crochet est pose AVANT tout require applicatif, sinon le
// module serait deja compile quand il mordrait.
// Les fins de ligne du depot ne sont pas uniformes (lib/reservation-ops.js est
// en CRLF, ce script en LF) : une ancre ecrite en LF ne se trouverait nulle part
// dans un fichier CRLF. On normalise la copie SERVIE, jamais le disque.
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

// UNE MUTATION PAR PROPRIETE DE LA GARDE. Chacune annule un correctif a la
// source et doit faire rougir le gate ; une seule mutation ne protegerait que
// la premiere des trois.
const MUTATIONS = [
  {
    nom: 'la garde de dotation est neutralisee',
    editions: [{
      de: 'const manque = dotationDepassee(',
      vers: 'const manque = false && dotationDepassee(',
    }],
  },
  {
    nom: 'le comptage d unites retombe au « 1 » silencieux (la forme de PRODUCTION ne porte pas laneCount)',
    editions: [{
      de: '  const compte = Number(item && item.laneCount);\n  if (Number.isFinite(compte) && compte > 0) return Math.trunc(compte);',
      vers: '  const compte = Number(item && item.laneCount);\n  if (true) return Number.isFinite(compte) && compte > 0 ? Math.trunc(compte) : 1;',
    }],
  },
  {
    nom: 'chaque partie redevient la fenetre ENTIERE de son dossier au lieu de sa propre duree',
    editions: [{
      de: '  const parTour = Math.max(TRANCHE_MINUTES, Math.ceil(minutes / tours));',
      vers: '  const parTour = Math.max(TRANCHE_MINUTES, Math.ceil(minutes / tours), fenetre.fin - fenetre.debut);',
    }],
  },
  {
    nom: 'l ancienne regle decide : un groupe deja pose tient ses unites toute sa visite',
    editions: [{
      de: '    if (verdict === \'oui\') continue;',
      vers: '    if (verdict === \'oui\' && false) continue;',
    }],
  },
  {
    nom: 'la repartition oublie les groupes deja poses',
    editions: [{
      de: '    const verdict = repartitionPossible([...nouvelles, ...liees], dotation);',
      vers: '    const verdict = repartitionPossible([...nouvelles], dotation);',
    }],
  },
  {
    nom: 'un groupe au bowling ou au laser peut aussi etre sur une piste de duckpin',
    editions: [{
      de: '  const blocs = opsPlan && Array.isArray(opsPlan.resourceBlocks) ? opsPlan.resourceBlocks : [];',
      vers: '  const blocs = [];',
    }],
  },
];
const MUTATION_PREUVE = '[mutation] servie en memoire :';
const MUTATION_ACTIVE = Number(process.env.PINLANE_ENDOWMENT_MUTATION || 0);
if (MUTATION_ACTIVE) {
  const mutation = MUTATIONS[MUTATION_ACTIVE - 1];
  const Module = require('module');
  const compile = Module.prototype._compile;
  Module.prototype._compile = function (contenu, nom) {
    if (path.resolve(nom) === path.resolve(OPS)) {
      let mute = contenu.split(CRLF).join(LF);
      for (const { de, vers } of mutation.editions) {
        if (mute.split(de).length - 1 !== 1) {
          console.error(`mutation impossible : ancre absente ou multiple dans ${OPS} : ${de.slice(0, 70)}`);
          process.exit(1);
        }
        mute = mute.split(de).join(vers);
      }
      console.log(`${MUTATION_PREUVE} ${mutation.nom}`);
      return compile.call(this, mute, nom);
    }
    return compile.call(this, contenu, nom);
  };
}

function mock(rel, exports) {
  const resolu = require.resolve(path.join(ROOT, rel));
  require.cache[resolu] = { id: resolu, filename: resolu, loaded: true, exports };
}
// Le limiteur garde un etat par IP : ce gate tire des rafales, ce n est pas lui
// qu on teste, et un autre gate le couvre.
mock('lib/rate-limit', {
  enforceRateLimit: () => false,
  checkRateLimit: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }),
  getClientIp: () => 'gate',
});

const database = require(path.join(ROOT, 'lib/database'));

// La base est remplacee par une liste en memoire, mais les HANDLERS sont les
// vrais : c est le chemin de decision qu on mesure, pas le stockage.
const STORE = [];
let nextId = 1;
database.readStaffState = async (date, centerId = 'libramont') => ({
  date, centerId, laneStatuses: {}, blocks: [],
  reservations: STORE.filter((r) => r.date === date && (r.centerId || 'libramont') === centerId),
});
database.readAvailabilitySnapshot = database.readStaffState;
database.createOpsEvent = async () => ({});
// LE MEME PASSAGE QU EN PRODUCTION. api/public-reservations appelle
// createReservation, qui normalise par normalizeReservationPayload avant
// d ecrire : la liste blanche de normalizeReservationProgram ne conserve pas
// laneCount. Pousser le payload BRUT rangeait un programme que la base ne
// produit jamais, et le gate restait vert sur un sous-comptage reel.
database.createReservation = async (payload) => {
  const range = database.normalizeReservationPayload({ ...payload }, {});
  const row = {
    ...range,
    id: nextId += 1,
    date: payload.date,
    centerId: payload.centerId,
    status: range.status || 'pending',
  };
  STORE.push(row);
  return row;
};
const rops = require(path.join(ROOT, 'lib/reservation-ops'));
rops.afterReservationCreated = async () => ({ communications: [], warnings: [] });

const availability = require(path.join(ROOT, 'api/public-availability.js'));
const reservationsApi = require(path.join(ROOT, 'api/public-reservations.js'));
const { listCenterActivities } = require(path.join(ROOT, 'lib/activity-catalog'));
const { normalizeReservationRequest } = require(path.join(ROOT, 'lib/reservation-request'));

let failures = 0;
function ok(condition, message) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}`);
  if (!condition) failures += 1;
  return condition;
}

function serve() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, BASE);
      if (url.pathname === '/api/public-availability') return void await availability(req, res);
      if (url.pathname === '/api/public-reservations') return void await reservationsApi(req, res);
      res.writeHead(404);
      res.end('non');
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: String((error && error.message) || error) }));
    }
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

function post(payload) {
  const data = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE}/api/public-reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': data.length },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (error) { resolve({ status: res.statusCode, body: { brut: body.slice(0, 200) } }); }
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

// Un samedi STRICTEMENT futur : le meme jour, la borne "depart passe" du moteur
// raboterait la journee et fausserait les comptes.
function nextSaturday() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 6);
  return c.toISOString().slice(0, 10);
}
const DATE = nextSaturday();
const CENTRE = 'libramont';
const HEURE = '15:00';
const PAS_MINUTES = 60;

function decalerHeure(heure, minutes) {
  const [h, m] = String(heure).split(':').map(Number);
  const total = (h * 60 + m) + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
const HEURE_SUIVANTE = decalerHeure(HEURE, PAS_MINUTES);

// `ligne` : ce que la ligne de l activite demande en plus (les tables choisies
// des billards). Absente, la ligne est celle d avant, a l identique.
function corps(activityId, pax, index, heure = HEURE, ligne = null) {
  return {
    name: `Groupe ${index}`,
    phone: '+32470000000',
    email: `groupe${index}@exemple.be`,
    date: DATE,
    startTime: heure,
    duration: 1,
    totalDuration: 1,
    pax,
    type: 'visite',
    program: [{ activityId, duration: 1, ...(ligne || {}) }],
    centerId: CENTRE,
    channel: 'public',
  };
}

// LE MEME DOSSIER, AVEC UN PROGRAMME DE PLUSIEURS LIGNES.
// C est cette forme qui bascule l aiguillage de prepareReservationOps : des qu une
// activite PLANIFIEE (bowling, laser) entre dans le programme, buildProgramFormula
// rend une formule, isFreeVisit tombe a false, et la visite part chez planningAgent
// au lieu de buildFreeVisitPlanResult.
function corpsProgramme(program, pax, index, heure = HEURE) {
  return { ...corps(program[0].activityId, pax, index, heure), program };
}

function message(reponse) {
  return String(((reponse && reponse.body) || {}).message || '').slice(0, 70);
}

// QUI PREND QUOI (2026-09-30). La garde repartit les parties dans les visites :
// un groupe de 5 au Fun Run joue UNE session de 15 min dans une visite que le
// serveur compte 30 min, un second groupe de 5 joue l autre quart d heure, et
// l accepter est JUSTE. Un groupe ne « prend » donc des unites que s il les
// occupe pendant TOUTE sa visite : le plus petit multiple de la capacite dont
// le programme remplit la fenetre que le serveur lui compte (10 joueurs au Fun
// Run, 2 sessions en 30 min ; 12 au duckpin, 1 h). La fenetre se lit sur le
// vrai normalizeReservationRequest, jamais sur une copie de sa regle.
function groupesDe(activite) {
  const capacite = Number(activite.capacityPerUnit) || 0;
  const remplit = (pax) => {
    const demande = normalizeReservationRequest(corps(activite.id, pax, 0), { channel: 'public' });
    const ligne = demande.program && demande.program.items && demande.program.items[0];
    return Number(ligne && ligne.minutes) >= Math.round(Number(demande.totalDuration) * 60);
  };
  const prendre = (unites) => {
    if (!(capacite > 0)) return { pax: 4, ligne: { units: unites } };
    for (let tours = 1; tours <= 8; tours += 1) {
      if (remplit(capacite * unites * tours)) return { pax: capacite * unites * tours, ligne: null };
    }
    throw new Error(`montage : aucun groupe ne remplit sa visite sur ${activite.id}`);
  };
  // LE PLAFOND D UNE RESERVATION EN LIGNE (Movsar, 2026-09-30 : « jusqu a 5
  // max de table ») : sous la dotation, le plus gros dossier public prend le
  // plafond, et le reste de la dotation se prend dans un second dossier.
  const unites = Math.trunc(Number(activite.units));
  const plafond = Math.trunc(Number(activite.maxUnitsPerBooking) || 0);
  const parDossier = !(capacite > 0) && plafond > 0 && plafond < unites ? plafond : unites;
  return {
    tout: prendre(parDossier), // le plus gros dossier en ligne, toute la visite
    parDossier,
    reste: parDossier < unites ? prendre(unites - parDossier) : null, // le reste de la dotation
    une: prendre(1), // une unite, toute la visite
    // Le plus petit groupe qui se puisse : une unite, un seul tour.
    petit: capacite > 0 ? { pax: capacite, ligne: null } : { pax: 4, ligne: { units: 1 } },
  };
}

// Combien de dossiers le serveur accepte-t-il d affilee sur la meme heure ?
async function combienPassent(activityId, pax, plafondEssais, ligne = null) {
  STORE.length = 0;
  let acceptes = 0;
  let premierRefus = '';
  for (let i = 1; i <= plafondEssais; i += 1) {
    const r = await post(corps(activityId, pax, i, HEURE, ligne));
    if (r.status >= 200 && r.status < 300) acceptes += 1;
    else { premierRefus = `${i}e refuse (${r.status}) ${String((r.body || {}).message || '').slice(0, 60)}`; break; }
  }
  return { acceptes, premierRefus };
}

async function main() {
  const server = await serve();
  try {
    console.log(`[date] samedi de reference : ${DATE}`);
    const catalogue = listCenterActivities(CENTRE);
    const parId = new Map(catalogue.map((a) => [a.id, a]));

    // --- A. TEMOIN : la borne existe la ou le moteur connait la ressource ----
    // 12 joueurs = 2 pistes par dossier, 8 pistes au centre : le 5e doit tomber.
    const temoin = await combienPassent('bowling', 12, 7);
    ok(temoin.acceptes === 4 && Boolean(temoin.premierRefus),
      `temoin bowling : 4 dossiers de 2 pistes passent sur 8 pistes, le 5e est refuse (${temoin.acceptes} passes, ${temoin.premierRefus || 'AUCUN REFUS'})`);

    // --- B. SUJET : une dotation finie doit se compter ----------------------
    const finies = catalogue.filter((a) => !a.planned && Number(a.units) > 0);
    ok(finies.length > 0, `au moins une activite libre declare une dotation finie (${finies.map((a) => `${a.id}:${a.units}`).join(', ') || 'aucune'})`);
    for (const activite of finies) {
      // DEUX FACONS DE PRENDRE DES UNITES (2026-09-28). Une activite a capacite
      // par unite (duckpin : 6 joueurs par piste) prend ses unites selon le
      // groupe ; une activite dont le client CHOISIT ses unites (billards, sans
      // regle de joueurs : Movsar, « tu dois permettre de choisir combien de
      // tables ils veulent ») les demande dans sa ligne, quel que soit le groupe.
      const { tout, parDossier, reste, une, petit } = groupesDe(activite);
      const quoi = reste ? `${parDossier} unites (le plafond en ligne)` : `les ${activite.units} unites`;
      const essai = await combienPassent(activite.id, tout.pax, 6, tout.ligne);
      ok(essai.acceptes === 1 && Boolean(essai.premierRefus),
        `${activite.id} (dotation ${activite.units}) : un groupe qui prend ${quoi} pendant toute sa visite passe, le suivant est refuse (${essai.acceptes} passes, ${essai.premierRefus || 'AUCUN REFUS SUR 6'})`);
      // Et des groupes d une unite tiennent ensemble : la borne compte des UNITES, pas des dossiers.
      const moitie = await combienPassent(activite.id, une.pax, 6, une.ligne);
      ok(moitie.acceptes === Number(activite.units),
        `${activite.id} : ${activite.units} groupes d une unite tiennent ensemble (${moitie.acceptes} passes, attendu ${activite.units})`);

      // ORDRE HETEROGENE. Les deux essais ci-dessus sont HOMOGENES (12 puis 12,
      // 6 puis 6) : ce sont les deux seuls ordres qu un sous-comptage laisse
      // juste, parce qu ils comparent des dossiers de meme taille. Un gros
      // groupe SUIVI d un petit est le cas qui a survecu a la premiere version
      // du lot - trois pistes vendues pour deux, deux fois HTTP 201.
      // Le second est le PLUS PETIT groupe possible (une unite, un seul tour) :
      // la ou un groupe occupe tout pendant toute la visite, meme lui ne tient.
      STORE.length = 0;
      const gros = await post(corps(activite.id, tout.pax, 80, HEURE, tout.ligne));
      const complement = reste ? await post(corps(activite.id, reste.pax, 82, HEURE, reste.ligne)) : { status: 201 };
      ok(gros.status >= 200 && gros.status < 300 && complement.status >= 200 && complement.status < 300,
        reste
          ? `montage : deux dossiers prennent les ${activite.units} unites de ${activite.id}, ${parDossier} puis ${activite.units - parDossier} (HTTP ${gros.status} puis ${complement.status} ${message(complement)})`
          : `montage : un groupe prend les ${activite.units} unites de ${activite.id} (HTTP ${gros.status})`);
      const apres = await post(corps(activite.id, petit.pax, 81, HEURE, petit.ligne));
      ok(apres.status === 409,
        `ordre heterogene : apres le groupe qui prend tout, le plus petit groupe (${petit.pax} joueurs) est refuse (HTTP ${apres.status} ${message(apres)})`);
    }

    // --- C. NON-REGRESSION : sans dotation, le centre absorbe ---------------
    const absorbables = catalogue.filter((a) => !a.planned && !(Number(a.units) > 0));
    ok(absorbables.length > 0, `des activites restent absorbables (${absorbables.map((a) => a.id).join(', ')})`);
    for (const activite of absorbables.slice(0, 3)) {
      const essai = await combienPassent(activite.id, 4, 5);
      ok(essai.acceptes === 5,
        `${activite.id} sans dotation n est pas bridee (${essai.acceptes} dossiers sur 5${essai.premierRefus ? ` - ${essai.premierRefus}` : ''})`);
    }

    // --- D. LA GARDE VAUT POUR TOUTE VISITE, ET ELLE NE REFUSE QUE
    //        L IRREALISABLE ------------------------------------------------
    //
    // Defaut mesure le 2026-09-04 : dotationDepassee etait appelee DEPUIS
    // buildFreeVisitPlanResult, et prepareReservationOps ne traverse ce chemin
    // que si le programme ne contient AUCUNE activite planifiee. Une visite
    // « bowling 1h + duckpin 1h » part chez planningAgent, qui ne connait que
    // les pistes de bowling et les arenes : la dotation du duckpin n etait
    // jamais comptee, et les 2 pistes de Libramont se revendaient a l infini.
    //
    // MAIS UNE ACTIVITE LIBRE N A AUCUNE HEURE IMPOSEE. La visite mixte dure
    // deux heures ; saturer la premiere seulement ne monte PAS la situation
    // qu on pretend tester, parce que ce groupe-la peut jouer son duckpin
    // pendant la seconde heure. Le montage sature donc TOUTE la fenetre, et le
    // temoin qui suit prouve qu une saturation PARTIELLE laisse passer.
    for (const activite of finies) {
      // Le montage pose des groupes qui occupent une unite pendant TOUTE leur
      // visite ; les sondes et la visite mixte sont le plus petit groupe.
      const { une, petit } = groupesDe(activite);
      const parUnite = petit.pax;
      const dotation = Math.trunc(Number(activite.units));
      const absorbable = absorbables[0];
      const visiteMixte = [
        { activityId: 'bowling', duration: 1 },
        { activityId: activite.id, duration: 1 },
      ];

      // MONTAGE ASSERTE D ABORD : sans dotation reellement saturee sur TOUTE la
      // fenetre, tout ce qui suit serait vert pour rien.
      //
      // Poser un dossier a l heure et un a l heure suivante suffisait tant que
      // la ligne de l activite durait une heure (le duckpin). Le Fun Run, entre
      // dans cette liste le 2026-09-23 avec sa session de 5 places, tient en
      // 30 minutes : deux dossiers laissaient deux trous de 30 min dans la
      // fenetre, la visite mixte s y placait, et le moteur avait RAISON de
      // l accepter. Le montage sature donc au PAS DE PLACEMENT du moteur
      // (30 min), de l heure jusqu au bout de la fenetre de deux heures.
      STORE.length = 0;
      const departs = [];
      for (let t = 0; t <= PAS_MINUTES * 2; t += 30) departs.push(decalerHeure(HEURE, t));
      // On pose ce qui PEUT l etre a chaque marque de 30 min. Un refus ici ne
      // dit pas que le montage rate : il dit que la marque est deja couverte
      // par un dossier plus long (une piste de duckpin prise pour une heure
      // couvre deux marques). Ce qui compte est asserte juste apres, et c est
      // la vraie propriete : il ne reste de place NULLE PART dans la fenetre.
      let poses = 0;
      for (const heure of departs) {
        for (let i = 1; i <= dotation; i += 1) {
          const r = await post(corps(activite.id, une.pax, `${heure}-${i}`, heure, une.ligne));
          if (r.status >= 200 && r.status < 300) poses += 1;
        }
      }
      ok(poses >= dotation, `montage : ${poses} dossier(s) poses sur ${activite.id} entre ${departs[0]} et ${departs[departs.length - 1]}`);
      const marquesLibres = [];
      for (const heure of departs) {
        const sonde = await post(corps(activite.id, petit.pax, `sat-${heure}`, heure, petit.ligne));
        if (sonde.status !== 409) marquesLibres.push(`${heure} -> HTTP ${sonde.status}`);
      }
      ok(marquesLibres.length === 0,
        `montage : la dotation de ${activite.id} est saturee aux ${departs.length} marques de la fenetre, un dossier de plus est refuse partout`,
        marquesLibres.join(' ; '));

      // SUJET : la MEME demande, avec du bowling en plus. Le refus doit tenir,
      // parce qu il n existe AUCUNE place dans la fenetre de cette visite.
      const melange = await post(corpsProgramme(visiteMixte, parUnite, 91));
      ok(melange.status === 409,
        `bowling + ${activite.id} sur une dotation saturee pendant toute la visite est refuse (HTTP ${melange.status} ${message(melange)})`);

      // TEMOIN NEGATIF 1 : LE MOTEUR NE REFUSE QUE L IRREALISABLE. Meme visite
      // mixte, mais la dotation n est prise que sur la PREMIERE heure : ce
      // groupe-la peut jouer son duckpin pendant la seconde, donc il passe.
      // Sans ce temoin, la propriete ci-dessus se satisferait en refusant toute
      // visite mixte des qu une seule minute est prise.
      STORE.length = 0;
      let posesPartiels = 0;
      for (let i = 1; i <= dotation; i += 1) {
        const r = await post(corps(activite.id, une.pax, `partiel-${i}`, HEURE, une.ligne));
        if (r.status >= 200 && r.status < 300) posesPartiels += 1;
      }
      ok(posesPartiels === dotation,
        `montage : ${dotation} dossier(s) posent ${activite.id} a ${HEURE} seulement (${posesPartiels}/${dotation})`);
      const reportable = await post(corpsProgramme(visiteMixte, parUnite, 93));
      ok(reportable.status >= 200 && reportable.status < 300,
        `temoin : bowling + ${activite.id} passe quand la dotation se libere pendant la visite (HTTP ${reportable.status} ${message(reportable)})`);

      // TEMOIN NEGATIF 2, meme fixture : une activite SANS dotation declaree
      // (units null) reste acceptee dans la meme forme a deux lignes.
      const libre = await post(corpsProgramme([
        { activityId: 'bowling', duration: 1 },
        { activityId: absorbable.id, duration: 1 },
      ], parUnite, 92));
      ok(libre.status >= 200 && libre.status < 300,
        `temoin negatif : bowling + ${absorbable.id} (units null) reste accepte (HTTP ${libre.status} ${message(libre)})`);
    }

    // --- E. UN GROUPE DEJA POSE NE TIENT SES UNITES QUE LE TEMPS DE LES
    //        JOUER (2026-09-30) ---------------------------------------------
    // Le dossier 1404 de la prod, recopie sans ses coordonnees : 10 joueurs a
    // 13:30, bowling pistes 7-8 jusqu a 14:30, laser jusqu a 15:25, puis
    // billard, plaine et 1 h 30 de duckpin sur les 2 pistes, visite comptee
    // jusqu a 19:00. L ancienne regle lui laissait les 2 pistes de 13:30 a
    // 19:00 : un groupe de 12 ne jouait plus au duckpin de l apres-midi.
    STORE.length = 0;
    const blocDuGroupe = (resourceType, activityId, startTime, endTime) => ({
      type: 'activity', resourceType, activityId, startTime, endTime, players: 10, groupPlayers: 10, groupWaveCount: 1,
    });
    STORE.push({
      ...database.normalizeReservationPayload({
        name: 'Groupe 1404', phone: '+32470000000', email: 'groupe1404@exemple.be',
        date: DATE, startTime: '13:30', duration: 1, totalDuration: 5.5, pax: 10, type: 'bowling', centerId: CENTRE,
        program: { items: [
          { activityId: 'bowling', planned: true, minutes: 60, duration: 1 },
          { activityId: 'laser_game', planned: true, minutes: 60, duration: 1, games: 2 },
          { activityId: 'billards', planned: false, minutes: 60, units: 1, hours: 1, sessions: 1 },
          { activityId: 'playground', planned: false, minutes: 60, sessions: 1 },
          { activityId: 'duckpin_bowling', planned: false, minutes: 90, duration: 1.5, units: 2, sessions: 1 },
        ] },
        opsPlan: { startTime: '13:30', endTime: '15:40', resourceBlocks: [
          blocDuGroupe('bowling_lane', 'bowling', '13:30', '14:30'),
          blocDuGroupe('laser_arena', 'laser_game', '14:30', '14:55'),
          blocDuGroupe('laser_arena', 'laser_game', '15:00', '15:25'),
        ] },
      }, {}),
      id: 1404, date: DATE, centerId: CENTRE, status: 'pending',
    });
    // L ORDRE COMPTE : le groupe de 17:30 arrive AVANT celui de 14:00. Le 1404
    // ne peut jouer son duckpin qu apres son laser (15:25) ; si le moteur
    // l imaginait sur la piste pendant son bowling, 13:30-15:00 lui suffirait
    // et le groupe de 17:30 passerait a tort.
    const douze = (heure, index) => post(corps('duckpin_bowling', 12, index, heure));
    const suite = [await douze('15:30', 1412), await douze('16:30', 1413)];
    ok(suite.every((r) => r.status === 201),
      `deux groupes de 12 a 15:30 et 16:30 passent : le 1404 garde 17:30-19:00 pour son duckpin (${suite.map((r) => r.status).join(', ')})`);
    const derniere = await douze('17:30', 1414);
    ok(derniere.status === 409,
      `un troisieme a 17:30 est refuse : le 1404, au bowling puis au laser jusqu a 15:25, n aurait plus 1 h 30 de duckpin pendant sa visite (HTTP ${derniere.status} ${message(derniere)})`);
    const quatorze = await douze('14:00', 1411);
    ok(quatorze.status === 201,
      `un groupe de 12 joue ses 2 pistes de duckpin a 14:00, pendant que le 1404 est au bowling et au laser (HTTP ${quatorze.status} ${message(quatorze)})`);
  } finally {
    server.close();
  }

  if (failures) {
    console.error(`\nfinite-endowment-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nfinite-endowment-check: ALL OK (dotation finie comptee, activites absorbables intactes)');
}

// Contre-epreuve : `--mutate` relance le gate une fois PAR MUTATION, servie EN
// MEMOIRE, et attend un ECHEC a chaque fois. Rien n est ecrit sur le disque, et
// on le verifie.
if (process.argv.includes('--mutate')) {
  const avant = fs.readFileSync(OPS, 'utf8');
  const normalise = avant.split(CRLF).join(LF);
  MUTATIONS.forEach((mutation, index) => {
    mutation.editions.forEach(({ de }) => {
      const occurrences = normalise.split(de).length - 1;
      if (occurrences !== 1) {
        console.error(`mutation ${index + 1} impossible : ancre attendue 1 fois dans lib/reservation-ops.js, trouvee ${occurrences} : ${de.slice(0, 70)}`);
        process.exit(1);
      }
    });
  });
  const { spawnSync } = require('child_process');
  MUTATIONS.forEach((mutation, index) => {
    const run = spawnSync(process.execPath, [__filename], {
      encoding: 'utf8',
      env: { ...process.env, PINLANE_ENDOWMENT_MUTATION: String(index + 1) },
    });
    console.log(run.stdout || '');
    // Le crochet a-t-il MORDU ? Sans cette preuve, un fils qui echoue pour une
    // toute autre raison (port pris, module absent) se lirait comme une
    // contre-epreuve reussie.
    if (!String(run.stdout || '').includes(`${MUTATION_PREUVE} ${mutation.nom}`)) {
      console.error(`CONTRE-EPREUVE RATEE (${mutation.nom}) : le crochet n a pas servi la copie mutee.`);
      process.exit(1);
    }
    if (run.status === 0) {
      console.error(`CONTRE-EPREUVE RATEE : le gate reste vert alors que ${mutation.nom}.`);
      process.exit(1);
    }
    console.log(`contre-epreuve OK : le gate rougit quand ${mutation.nom}.`);
  });
  if (fs.readFileSync(OPS, 'utf8') !== avant) {
    console.error('CONTRE-EPREUVE RATEE : lib/reservation-ops.js a ete ecrit sur le disque.');
    process.exit(1);
  }
  console.log(`contre-epreuve OK : ${MUTATIONS.length} mutations, et lib/reservation-ops.js n a jamais ete ecrit.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
