// LE TEMPS DES ACTIVITES LIBRES COMPTE DANS LA VISITE (entretien Seb, 2026-09-17).
//
// Movsar, capture a l appui : « jai pris bowling 1h et mini golf qui dure entre
// 30-60 minutes et la ca me dit que cest possible pour ajd alors que la
// totalite dure donc 2heure [...] sa propose au calme larrive a 20h30 donc
// sortie a 21h30 pas de temps pour golf et ca pour bcp de chose cest un gros
// probleme ».
//
// MESURE AVANT CORRECTIF (sonde du 2026-09-17, moteur reel, jeudi, centre ouvert
// 14:00-22:00, bowling 1 h + minigolf 45 min) :
//   - derniere heure d arrivee OK : 21:00, IDENTIQUE avec et sans le minigolf ;
//   - refus a 21:30 : « Fin apres 22:00 », calcule sur le bowling SEUL ;
//   - creneau propose 14:00 : fin annoncee 15:05 alors que la visite dure 1 h 45.
//
// LA REGLE. Une activite libre (minigolf, arcades, billards, plaine de jeux) ne
// prend AUCUNE ressource : elle ne doit peser sur aucune capacite. Mais elle
// prend du TEMPS, et le centre ferme. Le chemin de la visite 100 % libre le
// faisait deja (api/public-availability.js : `value <= schedule.close -
// visitHours`) ; le chemin ANCRE, lui, ignorait ces minutes. Meme produit, deux
// verites : c est le defaut.
//
// Ce gate prouve les deux cotes : la reserve mord quand il y a des activites
// libres, et RIEN ne change sans elles.
//
// LES TROUS ABSORBENT LE LIBRE (2026-09-22). Quand deux activites a creneau
// laissent un trou entre elles, le minigolf s y joue : la reserve ne se compte
// que pour ce qui ne tient pas dans ce trou. Sans cela, un laser a 14:00 et un
// bowling a 21:00 se refusaient « faute de temps pour le minigolf » alors que
// sept heures etaient libres. Section [5], avec sa contre-epreuve.
//
// Lancement : node scripts/visit-free-time-check.js
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const fs = require('fs');

const API = path.join(ROOT, 'api/public-availability.js');
const CENTER_ID = 'libramont';
const PAX = 6;
const GRILLE = 30; // PROGRAM_GRID_MINUTES

let failures = 0;
function record(label, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` :: ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}
function section(title) { console.log(`\n--- ${title}`); }

// Jeudi prochain, dans le fuseau du CENTRE : un jour ouvert qui ferme a 22:00.
function prochainJeudi() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 4);
  return c.toISOString().slice(0, 10);
}
const DATE = prochainJeudi();

// Chargement NEUF de l api (et de tout le repo) avec une base neutralisee :
// la contre-epreuve mute le fichier sur le disque, il faut le relire.
function chargerApi() {
  Object.keys(require.cache)
    .filter((cle) => cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`))
    .forEach((cle) => { delete require.cache[cle]; });
  const database = require(path.join(ROOT, 'lib/database.js'));
  database.readAvailabilitySnapshot = async () => ({ reservations: [], laneStatuses: {}, blocks: [], date: DATE, centerId: CENTER_ID });
  return require(API);
}

function appel(api, params) {
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', url: `/api/public-availability?${params.toString()}`, headers: { host: '127.0.0.1' }, on() {}, setEncoding() {} };
    const res = {
      statusCode: 0,
      setHeader() {},
      writeHead(code) { this.statusCode = code; },
      end(body) {
        try { resolve({ statusCode: this.statusCode, body: JSON.parse(String(body || '{}')) }); } catch (error) { reject(new Error(`reponse illisible : ${String(body).slice(0, 200)}`)); }
      },
    };
    api(req, res).catch(reject);
  });
}

function disponibilite(api, programme, poses) {
  const params = new URLSearchParams({
    centerId: CENTER_ID, date: DATE, type: 'visite', pax: String(PAX), program: JSON.stringify(programme),
  });
  if (poses && poses.preferredTimes) params.set('preferredTimes', JSON.stringify(poses.preferredTimes));
  if (poses && poses.laserGameTimes) params.set('laserGameTimes', JSON.stringify(poses.laserGameTimes));
  return appel(api, params);
}

const minutes = (texte) => { const [h, m] = String(texte).split(':').map(Number); return h * 60 + m; };
const heure = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const heuresOk = (body) => (body.anchors?.activities?.[0]?.times || []).filter((item) => item.ok !== false).map((item) => item.time);
const refus = (body, time) => (body.anchors?.activities?.[0]?.times || []).find((item) => item.time === time && item.ok === false) || null;

async function main() {
  const api = chargerApi();
  const { listCenterActivities } = require(path.join(ROOT, 'lib/activity-catalog.js'));
  const { DEFAULT_CENTER_CONFIG_BY_ID } = require(path.join(ROOT, 'lib/center-config.js'));

  const catalogue = listCenterActivities(CENTER_ID);
  const bowling = catalogue.find((activity) => activity.id === 'bowling');
  const libre = catalogue.find((activity) => activity.id === 'minigolf_blacklight');
  const jour = new Date(`${DATE}T12:00:00Z`).getUTCDay();
  const horaire = DEFAULT_CENTER_CONFIG_BY_ID[CENTER_ID]?.defaultSchedule?.regular?.[jour] || null;

  section('Montage : la situation de la capture de Movsar existe pour de vrai');
  record('le centre ferme bien a une heure connue ce jour-la', Boolean(horaire && horaire.close), JSON.stringify({ date: DATE, horaire }));
  record('le bowling est une activite PLANIFIEE (elle prend une ressource)', bowling?.planned === true);
  record('le minigolf est une activite LIBRE (aucune ressource)', libre?.planned === false, `planned=${libre?.planned}`);
  const minutesLibre = Number(libre?.defaultMinutes) || 0;
  record('le minigolf dure un temps connu', minutesLibre > 0, `${minutesLibre} min`);

  const fermeture = minutes(horaire.close === '24:00' ? '24:00' : horaire.close);
  const dureeBowling = 60;
  const grille = (limite) => Math.floor(limite / GRILLE) * GRILLE;
  // La regle du proprietaire : une visite qui finit PILE a la fermeture passe.
  const dernierSansLibre = heure(grille(fermeture - dureeBowling));
  const dernierAvecLibre = heure(grille(fermeture - dureeBowling - minutesLibre));

  section('[1] Sans activite libre, RIEN ne change');
  const seul = await disponibilite(api, [{ activityId: 'bowling', duration: 1 }]);
  const okSeul = heuresOk(seul.body);
  record('la grille du bowling seul offre des heures', okSeul.length > 0, `${okSeul.length} heures`);
  record(`la derniere heure offerte est celle que la fermeture autorise (${dernierSansLibre})`, okSeul[okSeul.length - 1] === dernierSansLibre, `derniere=${okSeul[okSeul.length - 1]}`);

  section('[2] Avec une activite libre, son temps compte avant la fermeture');
  const avec = await disponibilite(api, [{ activityId: 'bowling', duration: 1 }, { activityId: libre.id }]);
  const okAvec = heuresOk(avec.body);
  record('la visite reste proposable (on ne vide pas la journee)', okAvec.length > 0, `${okAvec.length} heures`);
  record(`la derniere heure offerte recule a ${dernierAvecLibre}`, okAvec[okAvec.length - 1] === dernierAvecLibre, `derniere=${okAvec[okAvec.length - 1]}`);
  record('l heure qui ne laissait pas le temps du minigolf n est plus offerte', !okAvec.includes(dernierSansLibre), `${dernierSansLibre} offerte=${okAvec.includes(dernierSansLibre)}`);
  const refuse = refus(avec.body, dernierSansLibre);
  record('cette heure porte une raison, pas un silence', Boolean(refuse && refuse.reason), JSON.stringify(refuse));
  record('la raison nomme la fermeture', Boolean(refuse && new RegExp(horaire.close.replace(':', '[h:]')).test(refuse.reason)), refuse?.reason || '');
  record('la raison nomme ce qui ne rentre pas', Boolean(refuse && new RegExp(libre.name.split(' ')[0], 'i').test(refuse.reason)), refuse?.reason || '');

  section('[3] La fin annoncee au client contient les activites libres');
  const creneau = (avec.body.slots || [])[0] || null;
  record('un creneau est propose sans rien demander au client', Boolean(creneau), JSON.stringify(creneau && creneau.time));
  const totalMin = Math.round(Number(avec.body.totalDuration || 0) * 60);
  record('la duree totale annoncee contient le minigolf', totalMin === dureeBowling + minutesLibre, `${totalMin} min`);
  const finVisite = creneau && (creneau.visitEndTime || '');
  record('le creneau porte une fin de VISITE, distincte du plan du staff', Boolean(finVisite), `visitEndTime=${finVisite || 'absente'} planEnd=${creneau?.opsPlan?.endTime || '-'}`);
  if (creneau && finVisite) {
    record('cette fin est bien l arrivee + tout le programme', minutes(finVisite) === minutes(creneau.time) + totalMin, `${creneau.time} + ${totalMin} min = ${heure(minutes(creneau.time) + totalMin)}, annonce ${finVisite}`);
    record('cette fin tient avant la fermeture', minutes(finVisite) <= fermeture, `${finVisite} <= ${horaire.close}`);
  }

  section('[4] Une visite 100 % libre garde son comportement');
  const toutLibre = await disponibilite(api, [{ activityId: libre.id }]);
  const creneaux = toutLibre.body.slots || [];
  record('des heures sont proposees', creneaux.length > 0, `${creneaux.length} creneaux`);
  const dernierLibre = creneaux[creneaux.length - 1];
  record('la derniere arrivee laisse le temps de l activite', Boolean(dernierLibre) && minutes(dernierLibre.opsPlan.endTime) <= fermeture, `${dernierLibre?.time} -> ${dernierLibre?.opsPlan?.endTime}`);

  section('[5] Un trou entre deux activites a creneau absorbe le libre');
  // Bowling 1 h + laser 1 partie + minigolf, le meme jeudi. Le bowling a sa
  // derniere heure possible SANS libre (fermeture - 1 h).
  const TROIS = [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1 }, { activityId: libre.id }];
  const ouverture = minutes(horaire.open);
  const laserTot = heure(Math.ceil(ouverture / GRILLE) * GRILLE);
  const laserColle = heure(minutes(dernierSansLibre) - GRILLE);
  const bowlingTard = dernierSansLibre;
  const heuresBowling = (body) => ((body.anchors?.activities || []).find((a) => a.activityId === 'bowling')?.times || []);
  const loin = await disponibilite(api, TROIS, { preferredTimes: { laser_game: laserTot }, laserGameTimes: [laserTot] });
  const bowlingLoin = heuresBowling(loin.body).find((item) => item.time === bowlingTard) || null;
  record(`laser pose a ${laserTot} : le bowling a ${bowlingTard} est offert (le minigolf tient dans le trou)`, Boolean(bowlingLoin) && bowlingLoin.ok !== false, JSON.stringify(bowlingLoin));
  const planLoin = await disponibilite(api, TROIS, { preferredTimes: { laser_game: laserTot, bowling: bowlingTard }, laserGameTimes: [laserTot] });
  const creneauLoin = (planLoin.body.slots || [])[0] || null;
  record(`et la visite finit avec le bowling (${heure(minutes(bowlingTard) + dureeBowling)}), sans y ajouter le minigolf deja joue`, Boolean(creneauLoin) && creneauLoin.visitEndTime === heure(minutes(bowlingTard) + dureeBowling), `visitEndTime=${creneauLoin && creneauLoin.visitEndTime}`);
  const colle = await disponibilite(api, TROIS, { preferredTimes: { laser_game: laserColle }, laserGameTimes: [laserColle] });
  const bowlingColle = heuresBowling(colle.body).find((item) => item.time === bowlingTard) || null;
  record(`laser pose a ${laserColle} (trou de 5 min) : le bowling a ${bowlingTard} reste refuse, avec la raison du minigolf`, Boolean(bowlingColle) && bowlingColle.ok === false && new RegExp(libre.name.split(' ')[0], 'i').test(bowlingColle.reason || ''), JSON.stringify(bowlingColle));
  const libreSansPose = await disponibilite(api, TROIS);
  const bowlingLibre = heuresBowling(libreSansPose.body).find((item) => item.time === bowlingTard) || null;
  record(`sans rien poser, le bowling a ${bowlingTard} est offert : le moteur place le laser assez tot pour le minigolf`, Boolean(bowlingLibre) && bowlingLibre.ok !== false, JSON.stringify(bowlingLibre));
  const planLibre = await disponibilite(api, TROIS, { preferredTimes: { bowling: bowlingTard } });
  const creneauLibre = (planLibre.body.slots || [])[0] || null;
  const laserPlace = creneauLibre ? (creneauLibre.opsPlan.resourceBlocks || []).find((b) => b.activityId === 'laser_game') : null;
  record('et la proposition qui suit la pose tient avant la fermeture, laser place avant le bowling', Boolean(creneauLibre) && Boolean(laserPlace) && minutes(laserPlace.endTime) <= minutes(bowlingTard) && minutes(creneauLibre.visitEndTime) <= fermeture, `laser ${laserPlace && laserPlace.startTime}, fin ${creneauLibre && creneauLibre.visitEndTime}`);

  section('Contre-epreuve par mutation du code de production');
  const MOTEUR = path.join(ROOT, 'lib/ops-engine.js');
  const moteurOriginal = fs.readFileSync(MOTEUR, 'utf8');
  const ancreTrous = ' - couvert - intersticesDuGroupe(raw.resourceBlocks));';
  const nombreTrous = moteurOriginal.split(ancreTrous).length - 1;
  record('contre-epreuve montable : la reserve du moteur deduit les trous a un seul endroit', nombreTrous === 1, `${nombreTrous} occurrence(s)`);
  if (nombreTrous === 1) {
    try {
      fs.writeFileSync(MOTEUR, moteurOriginal.split(ancreTrous).join(' - couvert);'));
      const apiSansTrous = chargerApi();
      const muteLoin = await disponibilite(apiSansTrous, TROIS, { preferredTimes: { laser_game: laserTot }, laserGameTimes: [laserTot] });
      const muteBowling = heuresBowling(muteLoin.body).find((item) => item.time === bowlingTard) || null;
      record(`sans la deduction des trous, le bowling a ${bowlingTard} se refuse de nouveau : ce gate ROUGIRAIT`, Boolean(muteBowling) && muteBowling.ok === false, JSON.stringify(muteBowling));
    } finally {
      fs.writeFileSync(MOTEUR, moteurOriginal);
    }
  }
  record('lib/ops-engine.js restaure a l identique', fs.readFileSync(MOTEUR, 'utf8') === moteurOriginal);
  const original = fs.readFileSync(API, 'utf8');
  // La reserve part par DEUX chemins : la grille des heures et la combinaison
  // par defaut. La contre-epreuve doit couper les deux, sinon elle ne prouve
  // rien sur celui qu elle laisse en place.
  const ancre = 'reserveMinutes: program.freeMinutes';
  const nombre = original.split(ancre).length - 1;
  record('contre-epreuve montable : la reserve est passee aux deux chemins', nombre === 2, `${nombre} occurrence(s)`);
  if (nombre === 2) {
    try {
      fs.writeFileSync(API, original.split(ancre).join('reserveMinutes: 0'));
      const apiMute = chargerApi();
      const mute = await disponibilite(apiMute, [{ activityId: 'bowling', duration: 1 }, { activityId: libre.id }]);
      const okMute = heuresOk(mute.body);
      record('sans la reserve, l heure trop tardive revient : ce gate ROUGIRAIT', okMute.includes(dernierSansLibre), `derniere=${okMute[okMute.length - 1]}`);
    } finally {
      fs.writeFileSync(API, original);
    }
  }
  record('api/public-availability.js restaure a l identique', fs.readFileSync(API, 'utf8') === original);

  console.log(`\n${failures === 0 ? 'VISIT FREE TIME OK' : `VISIT FREE TIME : ${failures} echec(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error('ECHEC', error); process.exit(1); });
