// UNE HEURE PROPOSEE EST UNE HEURE RESERVABLE, ET UNE HEURE IMPOSSIBLE DIT
// POURQUOI.
//
// Movsar, 2026-08-31 : « il y a plein de bugs de temps [...] il faut autoriser
// les activites qui finissent a la fermeture pile, parce que la on se retrouve
// avec plein d horaires impossibles ». Mesure du meme jour, sur le samedi :
// apres avoir retenu le bowling a 10:00, le composeur proposait toujours les
// memes 28 heures de laser - dont 10:00 et 10:30, qui tombent DANS la partie de
// bowling. Le client cliquait, et le serveur repondait « Bowling (10:00-11:00)
// et Laser Game (10:00) se chevauchent ».
//
// Brief du 2026-09-02 : le composeur RETIRAIT les heures qui ne passaient pas,
// sans dire pourquoi, en jugeant chaque activite seule (les parties 2 et 3 du
// laser n occupaient aucune place, la fermeture se jugeait sur l activite et
// pas sur la visite). Depuis le 2026-09-03 la grille rend TOUTES les heures de
// la journee, chacune avec le verdict de la visite ENTIERE ({ ok, code,
// reason }), calcule par la meme porte que la validation.
//
// Ce gate verifie cinq proprietes de COMPORTEMENT sur le vrai moteur (l API en
// processus, snapshot vide) :
//
//   A. LA FERMETURE EST UNE BORNE, PAS UN MUR. Une activite qui finit PILE a
//      l heure de fermeture est reservable (bowling d une heure a 23:00 quand
//      le centre ferme a minuit) ; l heure suivante existe encore dans la
//      grille, impossible et motivee.
//   B. RIEN N EST CACHE, ET RIEN NE MENT. Apres un premier choix, la seconde
//      liste garde le meme nombre d heures ; celles qui mordent sur le choix
//      sont impossibles et le NOMMENT ; aucune heure possible ne le chevauche.
//   C. LE VERDICT DE LA GRILLE EST CELUI DE LA VALIDATION. Sur un echantillon
//      de paires, une heure possible est acceptee et une heure impossible est
//      refusee par la validation complete.
//   D. LES PARTIES DE LASER OCCUPENT LEUR PLACE. Deux parties posees a 20:00 et
//      20:30 rendent impossibles les bowlings 19:30, 20:00 et 20:30, en les
//      nommant ; 19:00 (fin 20:00) et 21:00 restent possibles.
//   E. L HEURE RETENUE RESTE POSSIBLE DANS SA PROPRE LISTE : elle ne se refuse
//      jamais elle-meme.
//   F. UNE HEURE QUI REMPLACE LA SIENNE NOMME LE VRAI OBSTACLE (2026-09-23).
//      49 personnes (le laser joue en deux groupes), bowling retenu a 12:30,
//      laser d UNE partie retenu a 13:30. Reposer le laser a 13:00 est
//      impossible a cause du BOWLING (13:00-13:55 mord sur 12:30-13:30). Le
//      moteur disait « Chevauche Laser Game 13:30 » : la partie que 13:00
//      REMPLACE. Le formulaire en faisait un « decale » sur lui-meme, et le
//      clic menait a une combinaison refusee. Aucune heure de la liste du
//      laser ne doit donc accuser le laser, et 13:00 doit accuser le bowling.
//      Contre-epreuve dediee : `--mutate-raison` remet l ancienne ligne.
//
// Puis une CONTRE-EPREUVE par mutation : on fait ignorer le verdict au moteur
// (toute heure devient possible), on prouve que le gate rougit, et on restaure
// par edition inverse.
//
// Lancement : node scripts/anchor-hours-truth-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ENGINE = path.join(ROOT, 'lib/ops-engine.js');
const PORT = Number(process.env.PINLANE_ANCHOR_TRUTH_PORT || 4489);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Le limiteur reel garde un etat par IP : ce gate fait des dizaines de
// requetes en rafale et se ferait refouler par lui ("Trop de requetes"), ce
// qui ressemblerait a un refus metier. On le neutralise AVANT tout require
// applicatif (motif de scripts/client-tarifs-check.js) : ce n est pas lui
// qu on teste ici, un autre gate le couvre deja.
function mockModule(relPath, exports) {
  const resolu = require.resolve(relPath);
  require.cache[resolu] = { id: resolu, filename: resolu, loaded: true, exports };
}
mockModule('../lib/rate-limit', {
  enforceRateLimit: () => false,
  checkRateLimit: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }),
  getClientIp: () => 'gate',
});

const database = require('../lib/database');

// Un samedi STRICTEMENT futur : le meme jour, la borne « depart passe » du
// moteur raboterait le debut de journee et fausserait les comptes.
function nextSaturday() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 6);
  return c.toISOString().slice(0, 10);
}
const DATE = nextSaturday();

database.readAvailabilitySnapshot = async () => ({ reservations: [], laneStatuses: {}, blocks: [], date: DATE, centerId: 'libramont' });
const availability = require('../api/public-availability.js');

let failures = 0;
function ok(condition, message) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}`);
  if (!condition) failures += 1;
  return condition;
}

function serve() {
  const server = http.createServer(async (req, res) => {
    try {
      await availability(req, res);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: String(error && error.message) }));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function get(chemin) {
  return new Promise((resolve, reject) => {
    http.get(BASE_URL + chemin, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(new Error(`reponse illisible : ${body.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

const PROGRAMME_DUO = [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1 }];
const PROGRAMME_DUO_2_PARTIES = [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 2 }];
const PROGRAMME_SOLO = [{ activityId: 'bowling', duration: 1 }];
const minutes = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));
const chevauche = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

function params(extra = {}) {
  const p = new URLSearchParams({ date: DATE, type: 'visite', pax: '4', centerId: 'libramont' });
  Object.entries(extra).forEach(([cle, valeur]) => p.set(cle, typeof valeur === 'string' ? valeur : JSON.stringify(valeur)));
  return p.toString();
}

function ancres(payload) {
  return (payload && payload.anchors && Array.isArray(payload.anchors.activities)) ? payload.anchors.activities : [];
}
const possibles = (ancre) => (ancre ? ancre.times.filter((x) => x.ok !== false) : []);
const impossibles = (ancre) => (ancre ? ancre.times.filter((x) => x.ok === false) : []);
const heures = (items) => items.map((x) => x.time);
// Une entree de grille est bien formee : une heure, et si elle est impossible,
// un code et une raison courte (lisible sur un telephone : pas un paragraphe).
const bienFormee = (x) => /^\d{2}:\d{2}$/.test(String(x.time))
  && (x.ok !== false || (typeof x.code === 'string' && x.code && typeof x.reason === 'string' && x.reason.length > 0 && x.reason.length <= 60));

async function main() {
  const server = await serve();
  try {
    console.log(`[date] samedi de reference : ${DATE}`);

    // --- A. La fermeture est une borne, pas un mur -------------------------
    const solo = await get('/api/public-availability?' + params({ program: PROGRAMME_SOLO }));
    // C est la LISTE D ANCRES qui porte toutes les heures proposees : pour une
    // visite a une seule activite, `slots` ne contient que le plan par defaut.
    const ancreSolo = ancres(solo)[0];
    ok(Boolean(ancreSolo) && ancreSolo.times.every(bienFormee), 'chaque entree de la grille est une heure, et une heure impossible porte un code et une raison courte');
    const heuresSolo = heures(possibles(ancreSolo));
    ok(heuresSolo.length > 0, `des heures sont reservables pour une heure de bowling (${heuresSolo.length})`);
    const derniere = heuresSolo[heuresSolo.length - 1];
    // Le samedi ferme a minuit chez ce centre : une partie d une heure lancee a
    // 23:00 finit PILE a la fermeture, elle doit etre reservable.
    ok(derniere === '23:00', `la derniere heure reservable finit pile a la fermeture (derniere : ${derniere}, attendu 23:00)`);
    const apresFermeture = ancreSolo ? ancreSolo.times.find((x) => x.time === '23:30') : null;
    ok(Boolean(apresFermeture) && apresFermeture.ok === false && /fin apr|ferm/i.test(apresFermeture.reason || ''),
      `l heure qui deborde (23:30) reste dans la grille, impossible et motivee (${apresFermeture ? `${apresFermeture.code} : ${apresFermeture.reason}` : 'absente'})`);

    // --- B. Rien n est cache, et rien ne ment ------------------------------
    const duo = await get('/api/public-availability?' + params({ program: PROGRAMME_DUO }));
    const listes = ancres(duo);
    if (!ok(listes.length >= 2, `le composeur propose deux ancres (${listes.length})`)) {
      throw new Error('sans deux ancres, la propriete B n a pas de sujet');
    }
    const premiere = listes.find((a) => a.activityId === 'bowling') || listes[0];
    const seconde = listes.find((a) => a.activityId !== premiere.activityId);
    ok(listes.every((a) => a.times.every(bienFormee)), 'les deux listes du duo sont bien formees');

    let cachees = 0;
    let menteuses = 0;
    let muettes = 0;
    let reniees = 0;
    let choix = 0;
    const exemples = [];
    const dureePremiere = Number(premiere.durationMinutes || 60);
    const dureeSeconde = Number(seconde.durationMinutes || 0);
    for (const item of possibles(premiere)) {
      const t = item.time;
      choix += 1;
      const apres = await get('/api/public-availability?' + params({ program: PROGRAMME_DUO, preferredTimes: { [premiere.activityId]: t } }));
      const suite = ancres(apres).find((a) => a.activityId === seconde.activityId);
      const soi = ancres(apres).find((a) => a.activityId === premiere.activityId);
      // Rien n est cache : la liste garde toutes ses heures.
      if (!suite || suite.times.length !== seconde.times.length) cachees += 1;
      // E. L heure retenue reste possible dans sa propre liste.
      const moi = soi ? soi.times.find((x) => x.time === t) : null;
      if (!moi || moi.ok === false) reniees += 1;
      const debut = minutes(t);
      const fin = debut + dureePremiere;
      (suite ? suite.times : []).forEach((u) => {
        const mord = chevauche(debut, fin, minutes(u.time), minutes(u.time) + dureeSeconde);
        if (mord && u.ok !== false) {
          menteuses += 1;
          if (exemples.length < 5) exemples.push(`${premiere.label} ${t} laisse ${seconde.label} ${u.time} possible`);
        }
        // Une heure qui mord est impossible ET nomme ce qu elle chevauche.
        if (mord && u.ok === false && !(String(u.reason || '').includes(premiere.label) && String(u.reason || '').includes(t))) {
          muettes += 1;
          if (exemples.length < 5) exemples.push(`${seconde.label} ${u.time} apres ${premiere.label} ${t} dit « ${u.reason} »`);
        }
      });
    }
    ok(choix > 0, `des premiers choix sont essayes (${choix})`);
    ok(cachees === 0, `aucun premier choix ne cache une heure de l autre liste (${cachees} sur ${choix} listes retrecies)`);
    ok(menteuses === 0, `aucune heure encore possible ne chevauche le choix deja fait (${menteuses} menteuses)${exemples.length ? ` - ${exemples.join(' | ')}` : ''}`);
    ok(muettes === 0, `chaque heure qui chevauche le choix le nomme dans sa raison (${muettes} muettes)`);
    ok(reniees === 0, `l heure retenue reste possible dans sa propre liste (${reniees} reniees sur ${choix})`);

    // --- C. Le verdict de la grille est celui de la validation -------------
    let testees = 0;
    let desaccords = 0;
    const desaccordsVus = [];
    const choixPossibles = possibles(premiere);
    const pas = Math.max(1, Math.floor(choixPossibles.length / 6));
    for (let i = 0; i < choixPossibles.length; i += pas) {
      const t = choixPossibles[i].time;
      const apres = await get('/api/public-availability?' + params({ program: PROGRAMME_DUO, preferredTimes: { [premiere.activityId]: t } }));
      const suite = ancres(apres).find((a) => a.activityId === seconde.activityId);
      const entrees = suite ? suite.times : [];
      const pasU = Math.max(1, Math.floor(entrees.length / 6));
      for (let j = 0; j < entrees.length; j += pasU) {
        const u = entrees[j];
        const final = await get('/api/public-availability?' + params({
          program: PROGRAMME_DUO,
          preferredTimes: { [premiere.activityId]: t, [seconde.activityId]: u.time },
        }));
        testees += 1;
        const acceptee = Array.isArray(final.slots) && final.slots.length > 0;
        if (acceptee !== (u.ok !== false)) {
          desaccords += 1;
          if (desaccordsVus.length < 5) desaccordsVus.push(`${t} + ${u.time} : grille ${u.ok !== false ? 'possible' : `impossible (${u.reason})`}, validation ${acceptee ? 'accepte' : `refuse (${final.message || 'aucun creneau'})`}`);
        }
      }
    }
    ok(testees > 0, `des paires de la grille sont soumises a la validation (${testees})`);
    ok(desaccords === 0, `la grille et la validation rendent le meme verdict (${desaccords} desaccords sur ${testees})${desaccordsVus.length ? ` - ${desaccordsVus.join(' | ')}` : ''}`);

    // --- D. Les parties de laser occupent leur place -----------------------
    const deuxParties = await get('/api/public-availability?' + params({
      program: PROGRAMME_DUO_2_PARTIES,
      preferredTimes: { laser_game: '20:00' },
      laserGameTimes: ['20:00', '20:30'],
    }));
    const bowlingD = ancres(deuxParties).find((a) => a.activityId === 'bowling');
    const verdictD = (heure) => (bowlingD ? bowlingD.times.find((x) => x.time === heure) : null);
    ['19:30', '20:00', '20:30'].forEach((heure) => {
      const v = verdictD(heure);
      ok(Boolean(v) && v.ok === false && /laser/i.test(v.reason || ''),
        `bowling ${heure} est impossible et nomme le laser quand deux parties sont posees a 20:00 et 20:30 (${v ? `${v.ok === false ? 'impossible' : 'possible'} : ${v.reason || ''}` : 'absent'})`);
    });
    ['19:00', '21:00'].forEach((heure) => {
      const v = verdictD(heure);
      ok(Boolean(v) && v.ok !== false, `bowling ${heure} reste possible autour des deux parties (${v ? (v.ok === false ? `impossible : ${v.reason}` : 'possible') : 'absent'})`);
    });

    // --- F. Une heure qui remplace la sienne nomme le vrai obstacle ---------
    const repose = await get('/api/public-availability?' + params({
      pax: '49',
      program: PROGRAMME_DUO,
      preferredTimes: { bowling: '12:30', laser_game: '13:30' },
      laserGameTimes: ['13:30'],
    }));
    const laserF = ancres(repose).find((a) => a.activityId === 'laser_game');
    // Le montage : sans deux groupes de laser, 13:00 ne mordrait pas sur le
    // bowling et la propriete n aurait pas de sujet.
    const plan = ((repose.slots || [])[0] || {}).opsPlan || {};
    const vagues = (plan.resourceBlocks || []).filter((b) => b.activityId === 'laser_game' && Number(b.groupWaveCount) > 1).length;
    ok(vagues === 2, `MONTAGE : a 49 personnes, le laser retenu joue en deux groupes (${vagues} bloc(s) de vague)`);
    const treize = laserF ? laserF.times.find((x) => x.time === '13:00') : null;
    ok(Boolean(treize) && treize.ok === false && treize.conflict && treize.conflict.activityId === 'bowling' && /bowling/i.test(treize.reason || ''),
      `laser 13:00 est impossible a cause du BOWLING, et le dit (${treize ? `${treize.ok === false ? 'impossible' : 'possible'} : ${treize.reason || ''} / conflit ${treize.conflict ? treize.conflict.activityId : 'aucun'}` : 'absent'})`);
    const accusentLeLaser = laserF ? laserF.times.filter((x) => x.ok === false && x.conflict && x.conflict.activityId === 'laser_game') : [];
    ok(accusentLeLaser.length === 0,
      `une partie UNIQUE ne s accuse jamais elle-meme (${accusentLeLaser.length ? accusentLeLaser.map((x) => `${x.time} : ${x.reason}`).join(' | ') : 'aucune heure du laser n accuse le laser'})`);
  } finally {
    server.close();
  }

  if (failures) {
    console.error(`\nanchor-hours-truth-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nanchor-hours-truth-check: ALL OK (fermeture atteignable, rien de cache, chaque heure impossible motivee, grille = validation, parties de laser comptees)');
}

// Contre-epreuve de F : `--mutate-raison` remet la liste des parties AVANT le
// remplacement (la partie sortante reste dans la raison) ; F doit rougir.
if (process.argv.includes('--mutate-raison')) {
  const source = fs.readFileSync(ENGINE, 'utf8');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const avant = ['    if (next.length >= laserCount) next = next.slice(1);', ''].join(eol);
  const ligne = '    partsForReason = next;' + eol;
  const debut = source.indexOf('    let next = parts.filter((minutes) => minutes !== start);' + eol);
  const fin = source.indexOf(ligne, debut);
  if (debut < 0 || fin < 0 || source.indexOf(avant, debut) < 0 || source.indexOf(avant, debut) > fin) {
    console.error('mutation impossible : le bloc des parties du laser a change dans lib/ops-engine.js');
    process.exit(1);
  }
  // On deplace `partsForReason = next;` juste AVANT le `slice`, comme avant.
  const ouvre = '    let next = parts.filter((minutes) => minutes !== start);' + eol;
  const sansLigne = source.slice(0, fin) + source.slice(fin + ligne.length);
  const mute = sansLigne.replace(ouvre, ouvre + ligne);
  if (mute === source) { console.error('mutation sans effet'); process.exit(1); }
  fs.writeFileSync(ENGINE, mute);
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
  fs.writeFileSync(ENGINE, source);
  const sortie = String(run.stdout || '');
  const tombes = sortie.split('\n').filter((l) => /^FAIL/.test(l) && /(BOWLING|elle-meme)/.test(l));
  console.log(tombes.join('\n'));
  if (run.status === 0 || tombes.length === 0) {
    console.error('CONTRE-EPREUVE RATEE : la raison accuse de nouveau la partie remplacee, et F reste verte.');
    process.exit(1);
  }
  console.log(`contre-epreuve OK : ${tombes.length} verdict(s) de F tombe(s) ; moteur restaure a l identique.`);
  process.exit(0);
}

// Contre-epreuve : `node scripts/anchor-hours-truth-check.js --mutate` fait
// ignorer le verdict au moteur (toute heure devient possible), relance le gate
// et attend un ECHEC, puis restaure.
if (process.argv.includes('--mutate')) {
  const source = fs.readFileSync(ENGINE, 'utf8');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  // Le verdict tel que le moteur l ecrit depuis 638d47c (2026-09-17), qui y a
  // ajoute l avertissement et le conflit. L ancienne ligne unique n existait
  // plus : la contre-epreuve s arretait sur « mutation impossible » sans que
  // personne ne la relance.
  // Re-ancree le 2026-10-19 : depuis 69f14ee le refus porte aussi le
  // deplacement de la partie chevauchee (move), sur plusieurs lignes.
  const marqueur = [
    '        entry = verdict.ok',
    '          ? { time, ok: true, ...meta, ...(verdict.warning ? { warning: verdict.warning } : {}) }',
    '          : ko(verdict.code, verdict.reason, {',
    '            ...(verdict.conflict ? { conflict: verdict.conflict } : {}),',
    '            // Le deplacement de la partie chevauchee (voir visitFeasibilityAt).',
    '            ...(verdict.move ? { move: verdict.move } : {}),',
    '          });',
  ].join(eol);
  if (source.split(marqueur).length !== 2) {
    console.error('mutation impossible : la ligne de verdict attendue est introuvable dans lib/ops-engine.js');
    process.exit(1);
  }
  const mute = source.replace(marqueur, '        entry = { time, ok: true, ...meta };');
  fs.writeFileSync(ENGINE, mute);
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
  fs.writeFileSync(ENGINE, source);
  console.log(run.stdout || '');
  if (run.status === 0) {
    console.error('CONTRE-EPREUVE RATEE : le gate reste vert quand le moteur ignore le verdict.');
    process.exit(1);
  }
  console.log('contre-epreuve OK : verdict ignore, le gate rougit ; moteur restaure a l identique.');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
