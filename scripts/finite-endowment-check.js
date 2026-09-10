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
    nom: 'la fenetre comparee redevient celle du DOSSIER entier au lieu de celle de la ligne',
    editions: [
      {
        de: '    const dernierDepart = Math.max(visite.debut, visite.fin - minutes);',
        vers: '    const dernierDepart = visite.debut;',
      },
      {
        de: '      const fin = debut + minutes;',
        vers: '      const fin = Math.max(debut + minutes, visite.fin);',
      },
    ],
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

function corps(activityId, pax, index, heure = HEURE) {
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
    program: [{ activityId, duration: 1 }],
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

// Combien de dossiers le serveur accepte-t-il d affilee sur la meme heure ?
async function combienPassent(activityId, pax, plafondEssais) {
  STORE.length = 0;
  let acceptes = 0;
  let premierRefus = '';
  for (let i = 1; i <= plafondEssais; i += 1) {
    const r = await post(corps(activityId, pax, i));
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
      const parUnite = Math.max(1, Number(activite.capacityPerUnit) || 1);
      const pax = parUnite * Number(activite.units); // un groupe qui prend TOUTE la dotation
      const essai = await combienPassent(activite.id, pax, 6);
      ok(essai.acceptes === 1 && Boolean(essai.premierRefus),
        `${activite.id} (dotation ${activite.units}) : un groupe de ${pax} prend tout, le suivant est refuse (${essai.acceptes} passes, ${essai.premierRefus || 'AUCUN REFUS SUR 6'})`);
      // Et deux demi-groupes tiennent, eux : la borne compte des UNITES, pas des dossiers.
      const moitie = await combienPassent(activite.id, parUnite, 6);
      ok(moitie.acceptes === Number(activite.units),
        `${activite.id} : ${activite.units} groupes d une unite tiennent ensemble (${moitie.acceptes} passes, attendu ${activite.units})`);

      // ORDRE HETEROGENE. Les deux essais ci-dessus sont HOMOGENES (12 puis 12,
      // 6 puis 6) : ce sont les deux seuls ordres qu un sous-comptage laisse
      // juste, parce qu ils comparent des dossiers de meme taille. Un gros
      // groupe SUIVI d un petit est le cas qui a survecu a la premiere version
      // du lot - trois pistes vendues pour deux, deux fois HTTP 201.
      STORE.length = 0;
      const gros = await post(corps(activite.id, pax, 80));
      ok(gros.status >= 200 && gros.status < 300,
        `montage : un groupe de ${pax} prend les ${activite.units} unites de ${activite.id} (HTTP ${gros.status})`);
      const petit = await post(corps(activite.id, parUnite, 81));
      ok(petit.status === 409,
        `ordre heterogene : apres un groupe de ${pax}, un groupe de ${parUnite} est refuse (HTTP ${petit.status} ${message(petit)})`);
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
      const parUnite = Math.max(1, Number(activite.capacityPerUnit) || 1);
      const dotation = Math.trunc(Number(activite.units));
      const absorbable = absorbables[0];
      const visiteMixte = [
        { activityId: 'bowling', duration: 1 },
        { activityId: activite.id, duration: 1 },
      ];

      // MONTAGE ASSERTE D ABORD : sans dotation reellement saturee sur les deux
      // heures, tout ce qui suit serait vert pour rien.
      STORE.length = 0;
      let poses = 0;
      for (const heure of [HEURE, HEURE_SUIVANTE]) {
        for (let i = 1; i <= dotation; i += 1) {
          const r = await post(corps(activite.id, parUnite, `${heure}-${i}`, heure));
          if (r.status >= 200 && r.status < 300) poses += 1;
        }
      }
      ok(poses === dotation * 2,
        `montage : ${dotation * 2} dossier(s) d une unite poses sur ${activite.id} a ${HEURE} et ${HEURE_SUIVANTE} (${poses}/${dotation * 2})`);
      for (const heure of [HEURE, HEURE_SUIVANTE]) {
        const saturation = await post(corps(activite.id, parUnite, `sat-${heure}`, heure));
        ok(saturation.status === 409,
          `montage : la dotation de ${activite.id} est saturee a ${heure}, un dossier de plus est refuse (HTTP ${saturation.status})`);
      }

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
        const r = await post(corps(activite.id, parUnite, `partiel-${i}`));
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
