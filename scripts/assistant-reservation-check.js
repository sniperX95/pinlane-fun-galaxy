'use strict';
// LA RESERVATION CREEE DEPUIS LA CARTE DE L ASSISTANT (2026-11-11, Ansar : « déjà tout complété, on a
// juste à analyser et déployer »). La carte envoie api/ops.js (assistantReservation) ; ce gate joue ce
// clic sur la VRAIE chaine (api/ops.js, lib/assistant-reservation.js, le moteur de la fenetre Reserver,
// lib/database.js), posee sur la base en memoire du banc Reserver (scripts/reserver-banc.js) : zero
// reseau, zero base, rien ne part. Il tient :
//   A. la Direction cree d un clic tout le programme (bowling pour 5, laser 2 parties pour 3), au
//      telephone du client, avec la trace « Préparée avec l’assistant. » et son journal d audit ;
//   B. un role en lecture ne cree rien (403), ni sans telephone (422), ni a une date passee, ni avec un
//      programme faux ;
//   C. un creneau pris entre la proposition et le clic arrete la creation (409) : le plan se refait au clic.
// Lancement : node scripts/assistant-reservation-check.js [--contre-preuves]
const path = require('path');
const B = require('./reserver-banc.js');

const OPS = 'api/ops.js';
const RESA = 'lib/assistant-reservation.js';
// Chaque garde retiree en memoire (le disque n est jamais touche) doit rougir sa ligne.
const MUTATIONS = [
  // La meme garde vit aussi dans l action assistantGeste : l ancre prend la ligne qui suit, propre a celle-ci.
  { nom: 'sans-controle-total', rouge: '[B] un role en lecture ne cree rien (403)', editions: [{ fichier: OPS, de: "    if (!agitAvecLAssistant(options.session)) throw createHttpError('Seules la Direction et le propriétaire font agir l’assistant.', 403, true);\n    const R = require('../lib/assistant-reservation');", vers: "    const R = require('../lib/assistant-reservation');" }] },
  { nom: 'sans-telephone', rouge: '[B] sans telephone, rien ne se cree (422)', editions: [{ fichier: RESA, de: "  if (!telephoneValide(corps.phone)) throw erreur('Le téléphone du client est obligatoire.');", vers: '' }] },
  { nom: 'sans-replan', rouge: '[C] un creneau pris depuis la proposition arrete la creation (409)', editions: [
    { fichier: RESA, de: '  if (!plan.disponible) throw erreur(', vers: '  if (false) throw erreur(' },
    { fichier: RESA, de: '  if (bloquant) throw erreur(', vers: '  if (false) throw erreur(' },
  ] },
  { nom: 'programme-libre', rouge: '[B] un programme faux ne cree rien (422)', editions: [{ fichier: OPS, de: '    const programme = R.programmeDe(lu, joueurs, scopedCenterId);', vers: '    const programme = lu.map((p) => ({ activityId: p.activite, participants: Number(p.participants) || joueurs, ...(p.duree_heures ? { duration: p.duree_heures } : {}), ...(p.parties ? { games: p.parties } : {}) }));' }] },
];

const TEL = '0470 12 34 56';
const PROGRAMME = [{ activityId: 'bowling', participants: 5, duration: 1 }, { activityId: 'laser_game', participants: 3, games: 2 }];
const DIRECTION = () => ({ ...B.sessionDuRole('manager'), role: { id: 'direction', name: 'Direction', locked: true } });

function lireBase() {
  return [...B.base.reservations.values()].map((r) => ({
    id: r.id, nom: r.name, tel: String(r.phone || ''), date: String(r.date).slice(0, 10), debut: String(r.start_time).slice(0, 5), pax: r.pax, type: r.type,
    notes: String(r.notes || ''), canal: r.channel, programme: typeof r.program === 'string' ? JSON.parse(r.program || 'null') : r.program,
    blocs: r.ops_plan && Array.isArray(r.ops_plan.resourceBlocks) ? r.ops_plan.resourceBlocks : [],
  }));
}

async function verifier(editions = []) {
  const echecs = [];
  const ok = (cond, nom, detail = '') => {
    if (!cond) echecs.push(nom);
    if (!editions.length) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${nom}${cond || !detail ? '' : `  ${String(detail).slice(0, 300)}`}`);
  };
  const monter = (session) => {
    const monte = B.monter({ session, mutations: editions });
    const ops = require(path.join(B.ROOT, OPS));
    return { monte, cliquer: (corps) => B.appeler(ops, 'POST', '/api/ops', { action: 'assistantReservation', centerId: 'libramont', date: B.JOUR, startTime: '15:00', pax: 5, programme: PROGRAMME, name: 'Famille Assistant', phone: TEL, ...corps }) };
  };

  if (!editions.length) console.log('\n[A] la Direction cree tout le programme d un clic');
  B.semer([]);
  const { monte, cliquer } = monter(DIRECTION());
  const r = await cliquer({});
  const cree = lireBase().find((x) => x.id === (r.json.reservation || {}).id) || {};
  const items = (cree.programme && (Array.isArray(cree.programme) ? cree.programme : cree.programme.items)) || [];
  const ligne = (id) => items.find((x) => x && x.activityId === id) || {};
  ok(r.statut === 201 && r.json.ok === true && cree.id && cree.date === B.JOUR && cree.debut === '15:00' && Number(cree.pax) === 5,
    '[A] la reservation nait au clic, au jour et a l heure de la carte', `${r.statut} ${JSON.stringify(r.json).slice(0, 200)}`);
  ok(Number(ligne('bowling').participants) === 5 && Number(ligne('bowling').duration) === 1 && Number(ligne('laser_game').participants) === 3 && Number(ligne('laser_game').games) === 2,
    '[A] tout le programme : le bowling pour les 5, le laser 2 parties pour 3', JSON.stringify(items).slice(0, 300));
  ok(/470123456$/.test(cree.tel.replace(/\D/g, '')) && cree.nom === 'Famille Assistant' && /Préparée avec l’assistant\./.test(cree.notes) && cree.canal === 'staff',
    '[A] au telephone et au nom du client, avec la trace de l assistant', JSON.stringify({ tel: cree.tel, nom: cree.nom, notes: cree.notes, canal: cree.canal }));
  ok(cree.blocs.some((b) => /bowling/i.test(JSON.stringify(b))) && cree.blocs.some((b) => /laser/i.test(JSON.stringify(b))),
    '[A] le dossier est place au planning : pistes et arene', JSON.stringify(cree.blocs).slice(0, 200));
  ok(monte.journal.audits.some((a) => a && a.action === 'createReservation' && a.surface === 'api/ops.js assistantReservation'),
    '[A] le journal d audit dit que la creation vient de l assistant', JSON.stringify(monte.journal.audits.map((a) => [a.action, a.surface])));

  if (!editions.length) console.log('\n[B] les refus');
  const avant = (liste) => liste.length;
  B.semer([]);
  const lecteur = monter(B.sessionDuRole('manager'));
  const lecture = await lecteur.cliquer({});
  ok(lecture.statut === 403 && /Direction et le propriétaire/.test(String(lecture.json.message || '')) && avant(lireBase()) === 0, '[B] un role en lecture ne cree rien (403)', `${lecture.statut} ${lecture.json.message || ''}`);
  B.semer([]);
  const dir = monter(DIRECTION());
  const sansTel = await dir.cliquer({ phone: '' });
  const court = await dir.cliquer({ phone: '0470 12' });
  ok(sansTel.statut === 422 && court.statut === 422 && /téléphone/.test(String(sansTel.json.message || '')) && avant(lireBase()) === 0, '[B] sans telephone, rien ne se cree (422)', `${sansTel.statut} ${sansTel.json.message || ''} | ${court.statut}`);
  const passe = await dir.cliquer({ date: '2026-01-10' });
  ok(passe.statut === 409 && /passée/.test(String(passe.json.message || '')) && avant(lireBase()) === 0, '[B] une date passee ne cree rien (409)', `${passe.statut} ${passe.json.message || ''}`);
  // Un bowling hors grille (1 h 15) ou donne deux fois ne se rabote pas : il se refuse.
  const faux = await Promise.all([
    dir.cliquer({ programme: [{ activityId: 'laser_game', participants: 9, games: 2 }] }),
    dir.cliquer({ programme: [{ activityId: 'piscine', participants: 5 }] }),
    dir.cliquer({ programme: [] }),
    dir.cliquer({ programme: [{ activityId: 'bowling', participants: 5, duration: 1.25 }] }),
    dir.cliquer({ programme: [{ activityId: 'bowling', participants: 5, duration: 1 }, { activityId: 'bowling', participants: 5, duration: 1 }] }),
  ]);
  ok(faux.every((x) => x.statut === 422) && avant(lireBase()) === 0, '[B] un programme faux ne cree rien (422)', JSON.stringify(faux.map((x) => [x.statut, x.json.message])));

  if (!editions.length) console.log('\n[C] le planning se revoit au clic');
  // Les huit pistes prises a 15:00 entre la proposition et le clic.
  B.semer([1, 2, 3, 4, 5, 6, 7, 8].map((l) => B.ligne(950 + l, { start_time: '15:00', lanes: [l] })));
  const pris = monter(DIRECTION());
  const conflit = await pris.cliquer({});
  const nouvelles = lireBase().filter((x) => x.id < 950 || x.id > 958);
  ok(conflit.statut === 409 && nouvelles.length === 0, '[C] un creneau pris depuis la proposition arrete la creation (409)', `${conflit.statut} ${conflit.json.message || ''} ${nouvelles.length} creee(s)`);
  return echecs;
}

(async () => {
  if (process.argv.includes('--contre-preuves')) {
    let manquees = 0;
    for (const m of MUTATIONS) {
      // eslint-disable-next-line no-await-in-loop
      const echecs = await verifier(m.editions).catch((e) => [`erreur ${e.message}`]);
      const mord = echecs.includes(m.rouge);
      if (!mord) manquees += 1;
      console.log(`${mord ? 'ok  ' : 'FAIL'}  contre-preuve ${m.nom} : ${mord ? `rougit « ${m.rouge} »` : `ne mord pas (${echecs.join(' ; ') || 'tout vert'})`}`);
    }
    console.log(`assistant-reservation-check --contre-preuves: ${MUTATIONS.length - manquees}/${MUTATIONS.length} mordent`);
    process.exit(manquees ? 1 : 0);
  }
  const echecs = await verifier();
  console.log(`\n${echecs.length ? `assistant-reservation-check: ${echecs.length} echec(s)` : 'assistant-reservation-check: ALL OK'}`);
  process.exit(echecs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
