// UN GROUPE TROP GRAND POUR LES PISTES JOUE EN PLUSIEURS SERVICES.
//
// Movsar, 2026-09-18 : « oui ils peuvent scinder le groupe pour jouer au
// bowling donc faut bosser et la aussi des gardes fou pour des possibilite
// impossible comme trop tard ou quoi et tout bien explique ».
//
// AVANT : `getRequiredLaneCount` rendait `ceil(joueurs / confort)` et, quand ce
// nombre depassait le parc sans tenir a la capacite de secours, le
// planificateur REFUSAIT. A Libramont (8 pistes, 6 en confort, 7 en secours),
// 57 joueurs et plus lisaient « Aucune combinaison disponible ce jour-la ».
// C est aussi la cause de l etape 6 du chantier, le groupe de 70 sans issue.
//
// CE QUI EST TENU ICI, sur la VRAIE porte publique, base neutralisee :
//   [1] le montage : la capacite du centre, et le seuil qu elle donne ;
//   [2] JUSQU AU SEUIL, RIEN NE CHANGE : un seul service, les memes pistes,
//       la meme derniere heure de depart. C est la propriete qui borne le
//       risque de tout ce chantier ;
//   [3] au-dela, le groupe joue en services equilibres, chacun tenant sur le
//       parc, et le plan pose UN BLOC PAR SERVICE, nomme « groupe i/N » ;
//   [4] LE GARDE-FOU : la derniere heure de depart recule d autant de fois la
//       duree qu il y a de services, et ce qui ne rentre plus le DIT
//       (« Fin apres minuit ») ;
//   [5] le prix est la somme des pistes de chaque service, et il ne double
//       pas : 70 joueurs coutent ce que 70 joueurs auraient coute sur un parc
//       assez grand ;
//   [6] contre-epreuve par mutation : sans la scission, 70 joueurs n ont plus
//       aucune heure.
//
// Lancement : node scripts/bowling-scission-check.js
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function record(label, condition, detail = '') {
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` :: ${detail}` : ''}`);
  if (!condition) failures += 1;
  return condition;
}
function section(titre) { console.log(`\n--- ${titre}`); }

function prochainSamedi() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 6);
  return c.toISOString().slice(0, 10);
}
const DATE = prochainSamedi();

// La base est neutralisee AVANT que l API ne soit chargee : aucune lecture, et
// la journee est vide. `getPool` jette, donc toute tentative d aller en base se
// verrait au lieu de passer en silence.
const database = require(path.join(ROOT, 'lib/database'));
database.readAvailabilitySnapshot = async () => ({ reservations: [], laneStatuses: {}, blocks: [], date: DATE, centerId: 'libramont' });
let appelsBase = 0;
database.getPool = () => { appelsBase += 1; throw new Error('ce gate ne touche pas la base'); };

let apiCourante = require(path.join(ROOT, 'api/public-availability.js'));
const { getCenter } = require(path.join(ROOT, 'lib/ops-knowledge.js'));
const {
  getBilledLaneCount, getRequiredLaneCount, splitGroupIntoBowlingServices, BOWLING_PRICES,
} = require(path.join(ROOT, 'lib/booking-config.js'));

function appeler(query) {
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', url: `/api/public-availability?${query}`, headers: { host: '127.0.0.1' } };
    let corps = '';
    const res = {
      statusCode: 200,
      setHeader() {},
      writeHead(code) { this.statusCode = code; },
      end(chunk) { corps += chunk || ''; resolve({ statusCode: this.statusCode, corps }); },
    };
    apiCourante(req, res).catch(reject);
  });
}

async function visite(pax, dureeHeures = 1) {
  const programme = encodeURIComponent(JSON.stringify({ items: [{ activityId: 'bowling', duration: dureeHeures }] }));
  const { corps } = await appeler(`centerId=libramont&date=${DATE}&pax=${pax}&type=visite&program=${programme}`);
  let data = {};
  try { data = JSON.parse(corps); } catch (error) { data = {}; }
  const creneau = (data.slots || []).find((c) => c && c.ok !== false) || null;
  const ancre = ((data.anchors || {}).activities || []).find((a) => a.activityId === 'bowling') || null;
  const heures = ancre ? (ancre.times || []) : [];
  const libres = heures.filter((t) => t.ok !== false).map((t) => t.time);
  const blocs = creneau && creneau.opsPlan && Array.isArray(creneau.opsPlan.timeline)
    ? creneau.opsPlan.timeline.filter((b) => b.activityId === 'bowling')
    : [];
  return {
    data,
    creneau,
    libres,
    derniereLibre: libres[libres.length - 1] || '',
    refusFinaux: heures.filter((t) => t.ok === false).slice(-1).map((t) => t.reason || ''),
    blocs,
    totalMinutes: creneau && creneau.opsPlan ? Number(creneau.opsPlan.totalMinutes) || 0 : 0,
    prix: Number(data.price) || 0,
  };
}

async function main() {
  // ====================================================================== [1]
  section('[1] Le montage : la capacite du centre, et le seuil qu elle donne');
  const bowling = getCenter('libramont').resources.bowling;
  const confort = bowling.laneCount * bowling.normalCapacityPerLane;
  const secours = bowling.laneCount * bowling.emergencyCapacityPerLane;
  record('la configuration du centre porte les trois nombres',
    bowling.laneCount > 0 && bowling.normalCapacityPerLane > 0 && bowling.emergencyCapacityPerLane > 0,
    JSON.stringify({ pistes: bowling.laneCount, confort: bowling.normalCapacityPerLane, secours: bowling.emergencyCapacityPerLane }));
  record('le seuil de scission est celui du REFUS, pas celui du confort',
    splitGroupIntoBowlingServices(secours, bowling).length === 1
      && splitGroupIntoBowlingServices(secours + 1, bowling).length > 1,
    JSON.stringify({ confort, secours, a_secours: splitGroupIntoBowlingServices(secours, bowling), au_dela: splitGroupIntoBowlingServices(secours + 1, bowling) }));

  // ====================================================================== [2]
  section('[2] Jusqu au seuil, RIEN ne change');
  // La propriete qui borne le risque : tout groupe que le centre savait deja
  // recevoir garde exactement le meme plan, le meme prix et les memes heures.
  const inchanges = [];
  for (const pax of [12, 30, confort, secours - 1, secours]) {
    const v = await visite(pax);
    const attenduPistes = getRequiredLaneCount('bowling', pax, '', bowling);
    inchanges.push({
      pax,
      services: splitGroupIntoBowlingServices(pax, bowling).length,
      blocs: v.blocs.length,
      minutes: v.totalMinutes,
      derniere: v.derniereLibre,
      pistes: v.blocs[0] ? v.blocs[0].requiredLanes : null,
      attenduPistes,
      prixOk: v.prix === (BOWLING_PRICES[1] || 0) * attenduPistes,
    });
  }
  record('un seul service, un seul bloc, une seule duree, et les pistes d avant',
    inchanges.every((x) => x.services === 1 && x.blocs === 1 && x.minutes === 60 && x.pistes === x.attenduPistes),
    JSON.stringify(inchanges));
  record('et la derniere heure de depart ne bouge pas',
    new Set(inchanges.map((x) => x.derniere)).size === 1,
    JSON.stringify(inchanges.map((x) => `${x.pax}:${x.derniere}`)));
  const prixInchange = inchanges.every((x) => x.prixOk);
  record('le prix reste celui de la grille par piste', prixInchange, JSON.stringify(inchanges.map((x) => `${x.pax}:${x.attenduPistes}p`)));

  // ====================================================================== [3]
  section('[3] Au-dela, le groupe joue en services equilibres');
  const grand = secours + 13; // 69 a Libramont : deux services
  const v70 = await visite(grand);
  const services = splitGroupIntoBowlingServices(grand, bowling);
  record('montage : ce groupe se scinde bien', services.length >= 2, JSON.stringify({ pax: grand, services }));
  record('les services sont EQUILIBRES et tiennent chacun sur le parc',
    Math.max(...services) - Math.min(...services) <= 1
      && services.every((n) => getRequiredLaneCount('bowling', n, '', bowling) <= bowling.laneCount),
    JSON.stringify(services.map((n) => `${n}j -> ${getRequiredLaneCount('bowling', n, '', bowling)}p`)));
  record('le plan pose UN BLOC PAR SERVICE, et chacun dure une seule fois la duree',
    v70.blocs.length === services.length && v70.blocs.every((b) => (b.end - b.start) === 60),
    JSON.stringify(v70.blocs.map((b) => `${b.startTime}-${b.endTime} ${b.players}j ${b.requiredLanes}p`)));
  record('et chaque bloc se NOMME, pour que le staff sache qui joue',
    v70.blocs.every((b, i) => String(b.label || '').includes(`groupe ${i + 1}/${services.length}`)),
    JSON.stringify(v70.blocs.map((b) => b.label)));
  record('les blocs s enchainent sans trou et sans chevauchement',
    v70.blocs.every((b, i) => i === 0 || b.start === v70.blocs[i - 1].end),
    JSON.stringify(v70.blocs.map((b) => `${b.startTime}-${b.endTime}`)));
  record('la visite dure autant de fois la duree qu il y a de services',
    v70.totalMinutes === 60 * services.length, `${v70.totalMinutes} min pour ${services.length} service(s)`);

  // ====================================================================== [4]
  section('[4] Le garde-fou : ce qui ne rentre plus avant la fermeture le DIT');
  const petite = await visite(12);
  record('montage : le petit groupe a bien une derniere heure', Boolean(petite.derniereLibre), petite.derniereLibre);
  const reculMinutes = (Number(petite.derniereLibre.slice(0, 2)) * 60 + Number(petite.derniereLibre.slice(3)))
    - (Number(v70.derniereLibre.slice(0, 2)) * 60 + Number(v70.derniereLibre.slice(3)));
  record('la derniere heure de depart recule d une duree par service supplementaire',
    reculMinutes === 60 * (services.length - 1),
    JSON.stringify({ petit: petite.derniereLibre, grand: v70.derniereLibre, recul: reculMinutes }));
  record('et l heure qui ne rentre plus dit POURQUOI',
    v70.refusFinaux.length > 0 && /fin apr/i.test(v70.refusFinaux[0]),
    JSON.stringify(v70.refusFinaux));

  // ====================================================================== [5]
  section('[5] Le prix : la somme des services, et il ne double pas');
  const facture = getBilledLaneCount('bowling', grand, '', bowling);
  record('le prix annonce est celui des pistes facturees',
    v70.prix === (BOWLING_PRICES[1] || 0) * facture,
    JSON.stringify({ prix: v70.prix, pistes: facture, grille: BOWLING_PRICES[1] }));
  // Le point que Movsar doit pouvoir verifier : scinder coute du TEMPS, pas de
  // l argent en plus. La reference est ce que ce groupe couterait sur un parc
  // assez grand pour le recevoir d un coup.
  const surUnParcAssezGrand = Math.ceil(grand / bowling.normalCapacityPerLane);
  record('scinder ne coute pas plus cher que jouer d un coup sur un grand parc',
    facture <= surUnParcAssezGrand + 1,
    JSON.stringify({ facture, surUnParcAssezGrand }));

  // ====================================================================== [6]
  section('[6] Contre-epreuve par mutation : ce gate sait-il rougir ?');
  // ON MUTE LE FICHIER, PAS L OBJET. lib/ops-engine.js DESTRUCTURE la fonction
  // au require : la remplacer sur le module de configuration ne change rien a
  // la liaison qu il garde, et la contre-epreuve se serait tue (mesure : 25
  // heures libres et 2 blocs, donc le mutant se comportait comme le vrai).
  // On vide donc le cache de tout ce qui porte la regle sur ce chemin.
  const CONFIG = path.join(ROOT, 'lib/booking-config.js');
  const MODULES = [
    'lib/booking-config.js', 'lib/ops-engine.js', 'lib/availability-slots.js',
    'lib/booking-complements.js', 'lib/ops-agents.js', 'lib/visit-program.js',
    'api/public-availability.js',
  ];
  const rechargerTout = () => {
    MODULES.forEach((m) => { delete require.cache[require.resolve(path.join(ROOT, m))]; });
    return require(path.join(ROOT, 'api/public-availability.js'));
  };
  const avantConfig = fs.readFileSync(CONFIG, 'utf8');
  try {
    const ancre = '  if (players <= secours) return [players];';
    if (avantConfig.split(ancre).length - 1 !== 1) throw new Error('ancre de la scission introuvable');
    fs.writeFileSync(CONFIG, avantConfig.split(ancre).join('  return [players];'));
    apiCourante = rechargerTout();
    const mute = await visite(grand);
    record('sans la scission, ce groupe n a plus AUCUNE heure : ce gate ROUGIRAIT',
      mute.libres.length === 0 && mute.blocs.length === 0,
      JSON.stringify({ heures: mute.libres.length, blocs: mute.blocs.length }));
  } catch (error) {
    record('contre-epreuve montable', false, error.message);
  } finally {
    fs.writeFileSync(CONFIG, avantConfig);
    apiCourante = rechargerTout();
  }
  record('lib/booking-config.js restaure a l identique', fs.readFileSync(CONFIG, 'utf8') === avantConfig);
  const revenu = await visite(grand);
  record('et le groupe retrouve ses heures et ses services',
    revenu.libres.length > 0 && revenu.blocs.length === services.length,
    JSON.stringify({ heures: revenu.libres.length, blocs: revenu.blocs.length }));

  console.log(`\n${failures === 0 ? 'BOWLING SCISSION OK' : `BOWLING SCISSION : ${failures} echec(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('ECHEC', e && (e.stack || e.message || e)); process.exit(1); });
