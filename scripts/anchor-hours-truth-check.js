// UNE HEURE PROPOSEE EST UNE HEURE RESERVABLE.
//
// Movsar, 2026-08-31 : « il y a plein de bugs de temps [...] il faut autoriser
// les activites qui finissent a la fermeture pile, parce que la on se retrouve
// avec plein d horaires impossibles ». Mesure du meme jour, sur le samedi :
// apres avoir retenu le bowling a 10:00, le composeur proposait toujours les
// memes 28 heures de laser - dont 10:00 et 10:30, qui tombent DANS la partie de
// bowling. Le client cliquait, et le serveur repondait « Bowling (10:00-11:00)
// et Laser Game (10:00) se chevauchent ». 2 paires affichees sur 28 finissaient
// en refus.
//
// Ce gate verifie deux proprietes de COMPORTEMENT sur le vrai moteur :
//
//   A. LA FERMETURE EST UNE BORNE, PAS UN MUR. Une activite qui finit PILE a
//      l heure de fermeture est proposee (bowling d une heure jusqu a 23:00
//      quand le centre ferme a minuit).
//   B. AUCUNE HEURE MENTEUSE. Toute heure encore affichee APRES un premier
//      choix doit etre acceptee par la validation. On epingle chaque heure de
//      la premiere ancre, on relit la liste de la seconde telle que le client
//      la verrait, et on essaie les paires : zero refus attendu.
//
// Puis une CONTRE-EPREUVE par mutation : on retire le filtre du moteur, on
// prouve que le gate rougit, et on restaure par edition inverse.
//
// Lancement : node scripts/anchor-hours-truth-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ENGINE = path.join(ROOT, 'lib/ops-engine.js');
const PORT = Number(process.env.PINLANE_ANCHOR_TRUTH_PORT || 4489);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Le limiteur reel garde un etat par IP : ce gate fait des centaines de
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
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(new Error(`reponse illisible : ${body.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

const PROGRAMME_DUO = [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1 }];
const PROGRAMME_SOLO = [{ activityId: 'bowling', duration: 1 }];
const minutes = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));

function params(extra = {}) {
  const p = new URLSearchParams({ date: DATE, type: 'visite', pax: '4', centerId: 'libramont' });
  Object.entries(extra).forEach(([cle, valeur]) => p.set(cle, typeof valeur === 'string' ? valeur : JSON.stringify(valeur)));
  return p.toString();
}

function ancres(payload) {
  return (payload && payload.anchors && Array.isArray(payload.anchors.activities)) ? payload.anchors.activities : [];
}

async function main() {
  const server = await serve();
  try {
    console.log(`[date] samedi de reference : ${DATE}`);

    // --- A. La fermeture est une borne, pas un mur -------------------------
    const solo = await get('/api/public-availability?' + params({ program: PROGRAMME_SOLO }));
    // C est la LISTE D ANCRES qui porte toutes les heures proposees : pour une
    // visite a une seule activite, `slots` ne contient que le plan par defaut.
    const ancreSolo = ancres(solo)[0];
    const heuresSolo = ancreSolo ? ancreSolo.times.map((x) => x.time) : (solo.slots || []).map((s) => s.time);
    ok(heuresSolo.length > 0, `des heures sont proposees pour une heure de bowling (${heuresSolo.length})`);
    const derniere = heuresSolo[heuresSolo.length - 1];
    // Le samedi ferme a minuit chez ce centre : une partie d une heure lancee a
    // 23:00 finit PILE a la fermeture, elle doit exister.
    ok(derniere === '23:00', `la derniere heure finit pile a la fermeture (derniere proposee : ${derniere}, attendu 23:00)`);

    // --- B. Aucune heure menteuse ------------------------------------------
    const duo = await get('/api/public-availability?' + params({ program: PROGRAMME_DUO }));
    const listes = ancres(duo);
    if (!ok(listes.length >= 2, `le composeur propose deux ancres (${listes.length})`)) {
      throw new Error('sans deux ancres, la propriete B n a pas de sujet');
    }
    const premiere = listes.find((a) => a.activityId === 'bowling') || listes[0];
    const seconde = listes.find((a) => a.activityId !== premiere.activityId);

    let paires = 0;
    let refus = 0;
    const exemples = [];
    let retreci = 0;
    for (const item of premiere.times) {
      const t = item.time;
      const apres = await get('/api/public-availability?' + params({ program: PROGRAMME_DUO, preferredTimes: { [premiere.activityId]: t } }));
      const suite = ancres(apres).find((a) => a.activityId === seconde.activityId);
      const restantes = suite ? suite.times.map((x) => x.time) : [];
      if (restantes.length < seconde.times.length) retreci += 1;
      // AUCUNE heure encore affichee ne doit mordre sur celle qu on vient de
      // retenir : c est la propriete, verifiee sur la liste telle que le
      // client la voit.
      const fin = minutes(t) + Number(premiere.durationMinutes || 60);
      const menteuses = restantes.filter((u) => minutes(u) < fin && minutes(u) + Number(seconde.durationMinutes || 0) > minutes(t));
      if (menteuses.length) {
        refus += menteuses.length;
        if (exemples.length < 5) exemples.push(`${premiere.label} ${t} laisse encore ${seconde.label} ${menteuses.join(', ')}`);
      }
      paires += restantes.length;
    }
    ok(refus === 0, `aucune heure proposee ne chevauche le choix deja fait (${refus} sur ${paires} restantes)${exemples.length ? ` - ${exemples.join(' | ')}` : ''}`);
    ok(retreci === premiere.times.length,
      `chaque choix retire vraiment ce qu il occupe dans l autre liste (${retreci} choix sur ${premiere.times.length} retrecissent la liste)`);

    // Et la validation confirme : on essaie un echantillon de paires encore
    // affichees, aucune ne doit etre refusee.
    let testees = 0;
    let rejetees = 0;
    const refusVus = [];
    const pas = Math.max(1, Math.floor(premiere.times.length / 6));
    for (let i = 0; i < premiere.times.length; i += pas) {
      const t = premiere.times[i].time;
      const apres = await get('/api/public-availability?' + params({ program: PROGRAMME_DUO, preferredTimes: { [premiere.activityId]: t } }));
      const suite = ancres(apres).find((a) => a.activityId === seconde.activityId);
      const restantes = suite ? suite.times.map((x) => x.time) : [];
      const pasU = Math.max(1, Math.floor(restantes.length / 5));
      for (let j = 0; j < restantes.length; j += pasU) {
        const u = restantes[j];
        const final = await get('/api/public-availability?' + params({
          program: PROGRAMME_DUO,
          preferredTimes: { [premiere.activityId]: t, [seconde.activityId]: u },
        }));
        testees += 1;
        if (!Array.isArray(final.slots) || !final.slots.length) {
          rejetees += 1;
          if (refusVus.length < 5) refusVus.push(`${t} + ${u} : ${final.message || 'aucun creneau'}`);
        }
      }
    }
    ok(testees > 0, `des paires affichees sont essayees (${testees})`);
    ok(rejetees === 0, `aucune paire affichee n est refusee a la validation (${rejetees} sur ${testees})${refusVus.length ? ` - ${refusVus.join(' | ')}` : ''}`);
  } finally {
    server.close();
  }

  if (failures) {
    console.error(`\nanchor-hours-truth-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nanchor-hours-truth-check: ALL OK (fermeture atteignable, aucune heure menteuse apres un premier choix)');
}

// Contre-epreuve : `node scripts/anchor-hours-truth-check.js --mutate` retire le
// filtre du moteur, relance le gate et attend un ECHEC, puis restaure.
if (process.argv.includes('--mutate')) {
  const source = fs.readFileSync(ENGINE, 'utf8');
  const marqueur = '      if (retenues.some((prise) => prise.activityId !== anchor.activityId';
  if (!source.includes(marqueur)) {
    console.error('mutation impossible : le filtre attendu est introuvable dans lib/ops-engine.js');
    process.exit(1);
  }
  const mute = source.replace(marqueur, '      if (false && retenues.some((prise) => prise.activityId !== anchor.activityId');
  fs.writeFileSync(ENGINE, mute);
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
  fs.writeFileSync(ENGINE, source);
  console.log(run.stdout || '');
  if (run.status === 0) {
    console.error('CONTRE-EPREUVE RATEE : le gate reste vert sans le filtre.');
    process.exit(1);
  }
  console.log('contre-epreuve OK : sans le filtre, le gate rougit ; moteur restaure a l identique.');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
