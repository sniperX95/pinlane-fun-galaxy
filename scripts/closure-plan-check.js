// Gate : UNE FERMETURE SE JUGE SUR LA VISITE PLANIFIEE (2026-09-10).
//
// La garde finale (assertReservationNotBlocked, lib/database.js) mesurait une
// reservation avec sa duree ESTIMEE : pour une formule, celle que donnent les
// lignes de sa description. Le moteur compose pourtant la visite activite par
// activite, et le plan dit autre chose. Mesure du 2026-09-10 sur Libramont,
// agenda vide, une fermeture d une heure a 18, 19 ou 20 h : CRAZY STUDENT
// STRIKE proposee a 17:00 alors que ses activites finissent a 18:10, FORMULE 2
// refusee a 15:30 alors qu elle finit a 17:40, KIDS FUN DAY refusee des 13:30
// par une fermeture a 18:00 alors que sa periode finit a 17:00, un laser a 40
// en deux vagues propose a 17:30 et fini a 18:25. Et la creation refusait
// ensuite, au dernier clic, ce que le tunnel venait de proposer.
//
// Cinq proprietes de comportement, sur la vraie route et la vraie creation :
//   A. FORME CLOSE. Le moteur ignore les fermetures du centre pour composer :
//      la garde est le seul filtre. Avec une fermeture, la route sert donc
//      EXACTEMENT les creneaux du meme jour sans fermeture, moins ceux dont les
//      activites la chevauchent (demi-ouvert : finir pile au debut passe).
//   B. LA CREATION DIT LA MEME CHOSE. Un creneau servi pres d une fermeture se
//      reserve (prepareReservationOps puis validateReservationResources, la
//      garde de la transaction) ; un creneau retire par elle est refuse.
//   C. SANS PLAN, L ESTIMATION RESTE LE REPLI.
//   D. LA MARGE DE RISQUE N EST PAS DU TEMPS DE VISITE. endTime la contient
//      (5 a 30 min selon le risque) ; le moteur juge deja l heure de fermeture
//      sans elle, et la regle du proprietaire veut qu une visite qui finit pile
//      au debut d une fermeture passe. Si cette decision change, ce gate doit
//      rougir : c est voulu.
//   E. LE COMPTOIR JUGE COMME LE TUNNEL. La creation staff recoit le plan que
//      la console a compose, et normalizeTrustedPlan reecrit son endTime sur la
//      derniere RESSOURCE, sans marge : CRAZY STUDENT STRIKE a 17:00 y finit a
//      « 18:00 » pour des activites jusqu a 18:10. La garde lit donc aussi le
//      dernier pas du plan, et le comptoir rend le verdict de la route.
//
// L horloge est posee au 2026-09-10 : le tunnel ne sert rien a une date passee.
// Aucune base : l agenda que la route lit est celui du scenario.
//
// node scripts/closure-plan-check.js            le gate
// node scripts/closure-plan-check.js --mutate   les contre-epreuves (il doit rougir deux fois)
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const RACINE = path.resolve(__dirname, '..');
const GARDE = path.join(RACINE, 'lib/database.js');

if (process.argv.includes('--mutate')) {
  const { spawnSync } = require('child_process');
  const MUTATIONS = [
    {
      nom: 'la garde revient a l estimation',
      de: 'const planEndMin = plannedVisitEndMinutes(payload, startMin);',
      vers: 'const planEndMin = null;',
    },
    {
      nom: 'la marge de risque compte comme du temps de visite',
      de: '(Number.isFinite(marge) && marge > 0 ? marge : 0)',
      vers: '0',
    },
    {
      nom: 'la garde ne lit plus que endTime, pas le dernier pas du plan',
      de: 'const fins = pas.map((etape) => minutesDe(etape && etape.endTime)).filter((fin) => fin !== null);',
      vers: 'const fins = [];',
    },
  ];
  const source = fs.readFileSync(GARDE, 'utf8');
  let echecs = 0;
  for (const mutation of MUTATIONS) {
    if (source.split(mutation.de).length !== 2) {
      console.error(`mutation impossible : l ancre « ${mutation.de} » n est pas unique dans lib/database.js`);
      process.exit(1);
    }
    let run = null;
    try {
      fs.writeFileSync(GARDE, source.replace(mutation.de, mutation.vers));
      run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
    } finally {
      fs.writeFileSync(GARDE, source);
    }
    if (fs.readFileSync(GARDE, 'utf8') !== source) {
      console.error('lib/database.js N A PAS ETE RESTAURE a l identique : verifier git diff avant tout commit.');
      process.exit(1);
    }
    const rouges = (run.stdout.match(/^FAIL /gm) || []).length;
    if (run.status === 0) {
      echecs += 1;
      console.log(`CONTRE-EPREUVE RATEE : « ${mutation.nom} » laisse le gate vert.`);
    } else {
      console.log(`contre-epreuve OK : « ${mutation.nom} » fait rougir le gate (${rouges} FAIL).`);
      run.stdout.split('\n').filter((ligne) => ligne.startsWith('FAIL ')).slice(0, 4).forEach((ligne) => console.log(`    ${ligne.slice(0, 200)}`));
    }
  }
  console.log('lib/database.js restaure a l identique.');
  process.exit(echecs ? 1 : 0);
}

const DateDeLaMachine = Date;
const decalage = DateDeLaMachine.parse('2026-09-10T10:00:00Z') - DateDeLaMachine.now();
class DateDuGate extends DateDeLaMachine {
  constructor(...args) {
    if (args.length) super(...args);
    else super(DateDeLaMachine.now() + decalage);
  }

  static now() { return DateDeLaMachine.now() + decalage; }
}
global.Date = DateDuGate;

let failures = 0;
function ok(label, condition, detail = '') {
  if (condition) {
    console.log(`ok    ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${label}${detail ? `  ${String(detail).slice(0, 400)}` : ''}`);
}

// Les doubles d infrastructure AVANT tout require applicatif : la route prend
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
let BLOCS = [];
const lireLAgenda = async (date, centerId) => ({
  date, centerId, reservations: [], laneStatuses: {}, blocks: resolveBlocksForDate(BLOCS, date),
});
const base = require('../lib/database');
base.readAvailabilitySnapshot = lireLAgenda;
base.readStaffState = lireLAgenda;
const route = require('../api/public-availability.js');
const moteur = require('../lib/booking-config');
const { prepareReservationOps } = require('../lib/reservation-ops');
const { normalizeReservationRequest } = require('../lib/reservation-request');

const CENTRE = 'libramont';
const minutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};
const fermeture = (date, debut) => ({ scopeType: 'center', recurrence: 'once', date, startMin: debut, endMin: debut + 60 });
const cle = (s) => JSON.stringify([s.time, s.opsPlan && s.opsPlan.endTime, (s.lanes || []).join(','), s.opsPlan && s.opsPlan.firstLaserTime]);
// Les activites d un creneau : de son heure a la fin de son plan, marge de
// risque retiree, jamais avant son dernier pas ; jamais moins que la duree
// reservee (piste, parties).
function activites(s, corps) {
  const debut = minutes(s.time);
  const reservee = Math.round(Math.max(Number(corps.duration || 0), 0) * 60);
  const pas = [...(s.opsPlan.timeline || []), ...(s.opsPlan.resourceBlocks || [])]
    .filter((etape) => /^\d{1,2}:\d{2}$/.test(String((etape && etape.endTime) || '')))
    .map((etape) => minutes(etape.endTime));
  const fin = Math.max(minutes(s.opsPlan.endTime) - Math.max(0, Number(s.opsPlan.bufferMinutes) || 0), ...pas);
  return [debut, Math.max(fin, debut + reservee)];
}
const chevauche = ([debut, fin], bloc) => debut < bloc.endMin && bloc.startMin < fin;

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
      // Sans setEncoding, un « é » coupe entre deux paquets devient deux
      // caracteres de remplacement.
      reponse.setEncoding('utf8');
      let corps = '';
      reponse.on('data', (morceau) => { corps += morceau; });
      reponse.on('end', () => { try { resoudre(JSON.parse(corps)); } catch (error) { rejeter(error); } });
    }).on('error', rejeter);
  });
  // LA CREATION PUBLIQUE d un creneau servi : le corps que le tunnel envoie
  // (ancres figees, duree estimee cote client), la preparation du serveur, puis
  // la garde de la transaction de createReservation.
  // canal 'staff' : le comptoir envoie le plan que sa console a compose, et le
  // serveur le reprend tel quel (plan de confiance) au lieu de replanifier.
  const reserver = async (params, corps, s, canal = 'public') => {
    const formule = params.formuleId ? moteur.getEffectiveFormules(CENTRE).find((f) => f.id === params.formuleId) : null;
    const ancres = (s.opsPlan && s.opsPlan.anchorPlan && s.opsPlan.anchorPlan.times) || {};
    const body = {
      centerId: CENTRE,
      date: params.date,
      startTime: s.time,
      type: params.type,
      formuleId: params.formuleId || '',
      pax: Number(params.pax),
      duration: Number(corps.duration),
      totalDuration: formule ? moteur.getFormuleTotalDuration(formule) : Number(corps.totalDuration),
      lanes: s.lanes || [],
      laneCount: corps.laneCount,
      requiresLanes: corps.requiresLanes,
      laserGames: params.laserGames ? Number(params.laserGames) : 0,
      preference: {
        preferredTimes: { bowling: ancres.bowling || '', laser_game: ancres.laser_game || '' },
        laserGameTimes: (s.opsPlan && s.opsPlan.anchorPlan && s.opsPlan.anchorPlan.laserGameTimes) || [],
        activityOrder: [],
        arrivalConfidence: 'normal',
      },
      pauseMinutes: 0,
      opsPlan: s.opsPlan || null,
      ...(params.type === 'visite' ? { program: corps.program } : {}),
      name: 'Gate fermeture',
      phone: '+32470000000',
      email: 'gate@exemple.be',
      status: 'pending',
      channel: canal,
    };
    try {
      const demande = canal === 'staff'
        ? normalizeReservationRequest(body, { channel: 'staff', centerId: CENTRE })
        : normalizeReservationRequest(body, { channel: 'public', requireEmail: true });
      const ops = await prepareReservationOps(demande, canal, { readState: lireLAgenda });
      if (ops.blockOnlineConfirmation) return `409 ${ops.planWarning || ''}`;
      const agenda = await lireLAgenda(params.date, CENTRE);
      base.validateReservationResources({ ...demande, ...ops, channel: canal }, [], {}, agenda.blocks, params.date);
      return 'acceptee';
    } catch (error) {
      return `refusee : ${error.message}`;
    }
  };

  const formules = moteur.getEffectiveFormules(CENTRE);
  const DATES = ['2026-09-12', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'];
  const DEBUTS = [15 * 60, 17 * 60 + 30, 18 * 60, 19 * 60, 20 * 60];
  const demandes = [
    ...formules.map((f) => ({ type: 'formule', formuleId: f.id, pax: String(Number(f.minPax) > 0 ? Number(f.minPax) : 1) })),
    { type: 'laser', laserGames: '1', pax: '40' },
    { type: 'laser', laserGames: '2', pax: '6' },
    { type: 'visite', pax: '4', program: JSON.stringify([{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1 }]) },
  ];

  // ── A. FORME CLOSE ─────────────────────────────────────────────────────
  console.log('[A] avec une fermeture, la route sert le meme jour moins ce que la fermeture touche');
  let cas = 0;
  let ecarts = 0;
  let retires = 0;
  let debordaientParLEstimation = 0;
  let refusesParLEstimation = 0;
  let margeSeule = 0;
  const premierEcart = [];
  const aReserver = [];
  for (const date of DATES) {
    for (const params of demandes) {
      BLOCS = [];
      const sans = await lireLaRoute({ centerId: CENTRE, date, ...params });
      for (const debut of DEBUTS) {
        const bloc = fermeture(date, debut);
        BLOCS = [bloc];
        const avec = await lireLaRoute({ centerId: CENTRE, date, ...params });
        const tous = sans.slots || [];
        const estimee = params.type === 'visite' ? 0 : Math.round(Math.max(Number(sans.totalDuration || 0), 0) * 60);
        const reservee = Math.round(Math.max(Number(sans.duration || 0), 0) * 60);
        const attendus = tous.filter((s) => !chevauche(activites(s, sans), bloc));
        const lus = avec.slots || [];
        cas += 1;
        retires += tous.length - attendus.length;
        tous.forEach((s) => {
          const parLEstimation = [minutes(s.time), minutes(s.time) + Math.max(estimee, reservee)];
          const parLePlan = chevauche(activites(s, sans), bloc);
          if (parLePlan && !chevauche(parLEstimation, bloc)) debordaientParLEstimation += 1;
          if (!parLePlan && chevauche(parLEstimation, bloc)) refusesParLEstimation += 1;
          if (!parLePlan && minutes(s.opsPlan.endTime) > bloc.startMin && minutes(s.time) < bloc.endMin) margeSeule += 1;
          // Ce que la route a VRAIMENT fait de ce creneau avec la fermeture :
          // la creation est jugee dessus, pas sur ce qu elle aurait du faire.
          if (date === '2026-09-15' && debut === 18 * 60) {
            aReserver.push({ params: { ...params, date }, corps: sans, s, servi: lus.some((l) => cle(l) === cle(s)) });
          }
        });
        if (JSON.stringify(attendus.map(cle)) !== JSON.stringify(lus.map(cle))) {
          ecarts += 1;
          if (premierEcart.length < 3) {
            const manquants = attendus.filter((s) => !lus.some((l) => cle(l) === cle(s))).map((s) => s.time);
            const enTrop = lus.filter((l) => !attendus.some((s) => cle(s) === cle(l))).map((s) => s.time);
            premierEcart.push(`${date} ${params.type} ${params.formuleId || params.laserGames || ''} fermeture ${debut / 60}h : manquants ${manquants.join(',') || '-'} ; en trop ${enTrop.join(',') || '-'}`);
          }
        }
      }
    }
  }
  ok('MONTAGE : des plans PLUS LONGS que l estimation touchent une fermeture que l estimation ne voit pas',
    debordaientParLEstimation > 0, `${debordaientParLEstimation} cas`);
  ok('MONTAGE : des plans PLUS COURTS que l estimation tiennent la ou l estimation touche la fermeture',
    refusesParLEstimation > 0, `${refusesParLEstimation} cas`);
  ok('MONTAGE : des creneaux dont seule la marge de risque touche la fermeture',
    margeSeule > 0, `${margeSeule} cas`);
  ok(`FORME CLOSE sur ${cas} journees : chaque fermeture retire exactement les creneaux dont les activites la touchent (${retires} retires)`,
    ecarts === 0 && retires > 0, premierEcart.join(' | '));

  // ── B. LA CREATION ─────────────────────────────────────────────────────
  console.log('[B] la creation publique dit la meme chose que le tunnel');
  // L agenda de la creation est celui des creneaux juges : la fermeture de
  // 18:00 le 15, pas la derniere que la boucle du dessus a posee.
  BLOCS = [fermeture('2026-09-15', 18 * 60)];
  const pres = aReserver.filter(({ s, corps }) => {
    const [debut, fin] = activites(s, corps);
    return debut < 19 * 60 && fin > 16 * 60 + 30;
  });
  const acceptes = [];
  const refusesAToRt = [];
  const refusesBien = [];
  const passesAToRt = [];
  for (const cas of pres) {
    const verdict = await reserver(cas.params, cas.corps, cas.s);
    const etiquette = `${cas.params.type} ${cas.params.formuleId || `${cas.params.laserGames || ''}p`} ${cas.s.time}`;
    if (cas.servi) (verdict === 'acceptee' ? acceptes : refusesAToRt).push(`${etiquette} (${verdict})`);
    else (verdict === 'refusee : Le centre est fermé sur ce créneau.' ? refusesBien : passesAToRt).push(`${etiquette} (${verdict})`);
  }
  ok('MONTAGE : la creation est jugee sur des creneaux servis ET retires autour de la fermeture',
    acceptes.length + refusesAToRt.length > 3 && refusesBien.length + passesAToRt.length > 0,
    `${acceptes.length + refusesAToRt.length} servis, ${refusesBien.length + passesAToRt.length} retires`);
  ok(`chaque creneau que la route sert pres de la fermeture se reserve (${acceptes.length})`, refusesAToRt.length === 0, refusesAToRt.join(' ; '));
  ok(`chaque creneau que la fermeture retire est refuse par la creation, avec son motif (${refusesBien.length})`, passesAToRt.length === 0, passesAToRt.join(' ; '));

  // ── C. SANS PLAN, L ESTIMATION ─────────────────────────────────────────
  console.log('[C] sans plan, la garde retombe sur l estimation');
  const date = '2026-09-15';
  const bloc = fermeture(date, 18 * 60);
  const garde = (formule, heure, plan) => {
    try {
      base.validateReservationResources({
        centerId: CENTRE,
        channel: 'public',
        name: 'Gate',
        phone: '+32470000000',
        date,
        startTime: heure,
        duration: moteur.getFormuleLaneDuration(formule),
        totalDuration: moteur.getFormuleTotalDuration(formule),
        lanes: [],
        laneCount: 0,
        pax: Number(formule.minPax) || 1,
        type: 'formule',
        formuleId: formule.id,
        opsPlan: plan,
      }, [], {}, resolveBlocksForDate([bloc], date), date);
      return 'acceptee';
    } catch (error) {
      return `refusee : ${error.message}`;
    }
  };
  const f2 = formules.find((f) => f.id === 'f2');
  const css = formules.find((f) => f.id === 'css');
  ok('MONTAGE : FORMULE 2 et CRAZY STUDENT STRIKE sont au catalogue de Libramont', Boolean(f2 && css));
  if (f2 && css) {
    ok('MONTAGE : FORMULE 2 est estimee a 3 h, CRAZY STUDENT STRIKE a 1 h',
      moteur.getFormuleTotalDuration(f2) === 3 && moteur.getFormuleTotalDuration(css) === 1);
    // Un plan court (2 h 10 d activites) et un plan long (1 h 10) : ceux que
    // le moteur compose pour ces deux formules.
    const planCourt = { startTime: '15:30', endTime: '17:50', bufferMinutes: 10 };
    const planLong = { startTime: '17:00', endTime: '18:15', bufferMinutes: 5 };
    ok('FORMULE 2 a 15:30 SANS plan : l estimation (18:30) touche la fermeture de 18:00, refusee',
      garde(f2, '15:30', null).startsWith('refusee'), garde(f2, '15:30', null));
    ok('FORMULE 2 a 15:30 AVEC son plan (activites jusqu a 17:40) : acceptee',
      garde(f2, '15:30', planCourt) === 'acceptee', garde(f2, '15:30', planCourt));
    ok('CRAZY STUDENT STRIKE a 17:00 SANS plan : l estimation (18:00) finit pile, acceptee',
      garde(css, '17:00', null) === 'acceptee', garde(css, '17:00', null));
    ok('CRAZY STUDENT STRIKE a 17:00 AVEC son plan (activites jusqu a 18:10) : refusee',
      garde(css, '17:00', planLong).startsWith('refusee'), garde(css, '17:00', planLong));
    ok('un plan qui finit avant de commencer ne vaut rien : retour a l estimation',
      garde(f2, '15:30', { endTime: '15:00', bufferMinutes: 0 }).startsWith('refusee'));
  }

  // ── D. LA MARGE DE RISQUE ──────────────────────────────────────────────
  console.log('[D] la marge de risque ne compte pas comme du temps de visite');
  const margeServie = aReserver.find(({ s, corps, servi }) => servi
    && minutes(s.opsPlan.endTime) > 18 * 60 && activites(s, corps)[1] <= 18 * 60);
  ok('un creneau dont seule la marge depasse 18:00 est servi avec la fermeture de 18:00',
    Boolean(margeServie), margeServie ? '' : 'aucun');
  if (margeServie) {
    const verdict = await reserver(margeServie.params, margeServie.corps, margeServie.s);
    ok(`et il se reserve : ${margeServie.params.formuleId || margeServie.params.type} ${margeServie.s.time}, activites jusqu a ${Math.floor(activites(margeServie.s, margeServie.corps)[1] / 60)}:${String(activites(margeServie.s, margeServie.corps)[1] % 60).padStart(2, '0')}, fin affichee ${margeServie.s.opsPlan.endTime}`,
      verdict === 'acceptee', verdict);
  }

  // ── E. LE COMPTOIR ─────────────────────────────────────────────────────
  console.log('[E] la creation staff, avec le plan de la console, rend le verdict de la route');
  const auComptoir = aReserver.filter(({ params, s, corps }) => params.type === 'formule' && (() => {
    const [debut, fin] = activites(s, corps);
    return debut < 19 * 60 && fin > 16 * 60 + 30;
  })());
  const reecrits = auComptoir.filter(({ s }) => {
    const ressources = (s.opsPlan.resourceBlocks || []).map((b) => b.endTime).filter(Boolean).sort();
    const pas = (s.opsPlan.timeline || []).map((t) => t.endTime).filter(Boolean).sort();
    return ressources.length && pas.length && ressources[ressources.length - 1] < pas[pas.length - 1];
  });
  ok('MONTAGE : des plans dont la derniere ressource finit avant le dernier pas (le endTime que le comptoir recoit)',
    reecrits.length > 0, `${reecrits.length} sur ${auComptoir.length}`);
  const ecartsComptoir = [];
  for (const cas of auComptoir) {
    const verdict = await reserver(cas.params, cas.corps, cas.s, 'staff');
    const attendu = cas.servi ? 'acceptee' : 'refusee : Le centre est fermé sur ce créneau.';
    if (verdict !== attendu) ecartsComptoir.push(`${cas.params.formuleId} ${cas.s.time} route ${cas.servi ? 'sert' : 'retire'}, comptoir ${verdict}`);
  }
  ok(`sur ${auComptoir.length} creneaux autour de la fermeture, le comptoir accepte ce que la route sert et refuse ce qu elle retire`,
    auComptoir.length > 3 && ecartsComptoir.length === 0, ecartsComptoir.join(' ; '));

  serveur.close();
  console.log(`\n${failures ? `closure-plan-check: ${failures} ECHEC(S)` : 'closure-plan-check: ALL OK (la fermeture se juge sur la visite planifiee, l estimation reste le repli)'}`);
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
