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
  // Le cas Clement (2026-11-12) : chaque morceau du clic retire a son tour doit rougir sa ligne.
  { nom: 'groupes-perdus-au-clic', rouge: '[D] le laser en deux sessions, 10 puis 14 joueurs, dans l ordre dit', editions: [{ fichier: OPS, de: ', participants: p && p.participants, groupes: p && p.groupes }));', vers: ', participants: p && p.participants }));' }] },
  { nom: 'groupes-ignores-du-moteur', rouge: '[D] le laser en deux sessions, 10 puis 14 joueurs, dans l ordre dit', editions: [{ fichier: 'lib/ops-engine.js', de: '  return valides ? groupes.flatMap((n) => splitGroupIntoWaves(Number(n), armes)) : splitGroupIntoWaves(total, armes);', vers: '  return splitGroupIntoWaves(total, armes);' }] },
  { nom: 'supplements-perdus', rouge: '[D] le supplement relu au catalogue, son prix du catalogue', editions: [{ fichier: OPS, de: '    const supplements = Array.isArray(body.supplements) && body.supplements.length ?', vers: '    const supplements = false ?' }] },
  { nom: 'prix-convenu-perdu', rouge: '[D] le forfait facture, le prix habituel garde en reference, la raison au dossier', editions: [{ fichier: OPS, de: '    const prixNegocie = R.prixNegocieDe(body.prix, body.raisonPrix);', vers: '    const prixNegocie = null;' }] },
  { nom: 'groupes-en-ligne', rouge: '[D] les groupes du laser se posent au comptoir, jamais par une demande en ligne', editions: [{ fichier: 'lib/visit-program.js', de: "        if (publicBooking) throw rejectOption('Les groupes du laser se règlent avec le centre.');", vers: '' }] },
  { nom: 'note-perdue', rouge: '[D] la note pour l equipe au dossier, sous la trace de l assistant', editions: [{ fichier: OPS, de: "t: ['Préparée avec l’assistant.', note].filter(Boolean).join(' ') })}`;", vers: "t: 'Préparée avec l’assistant.' })}`;" }] },
  // (la note de l assistant retombee dans le mot du client : le planning la disait « Note du client »)
  { nom: 'note-au-client', rouge: '[D] la note pour l equipe au dossier, sous la trace de l assistant', editions: [{ fichier: OPS, de: 'telephone: body.phone, notes: noteEquipe });', vers: 'telephone: body.phone, notes: JSON.parse(noteEquipe.slice(9)).t });' }] },
];

// La colonne `notes` d un dossier : les notes d equipe (lignes « [equipe] {json} », signees par le
// serveur) et le mot du client (tout le reste), que la console affiche « Note du client ».
const notesEquipe = (texte) => String(texte || '').split('\n').filter((l) => l.startsWith('[equipe] ')).map((l) => { try { return JSON.parse(l.slice(9)); } catch (e) { return {}; } });
const motDuClient = (texte) => String(texte || '').split('\n').filter((l) => l.trim() && !l.startsWith('[equipe] ')).join('\n');

const TEL = '0470 12 34 56';
const PROGRAMME = [{ activityId: 'bowling', participants: 5, duration: 1 }, { activityId: 'laser_game', participants: 3, games: 2 }];
const DIRECTION = () => ({ ...B.sessionDuRole('manager'), role: { id: 'direction', name: 'Direction', locked: true } });

function lireBase() {
  return [...B.base.reservations.values()].map((r) => ({
    id: r.id, nom: r.name, tel: String(r.phone || ''), date: String(r.date).slice(0, 10), debut: String(r.start_time).slice(0, 5), pax: r.pax, type: r.type,
    notes: String(r.notes || ''), canal: r.channel, programme: typeof r.program === 'string' ? JSON.parse(r.program || 'null') : r.program,
    blocs: r.ops_plan && Array.isArray(r.ops_plan.resourceBlocks) ? r.ops_plan.resourceBlocks : [],
    prix: Number(r.price), reference: Number(r.base_price), extras: (typeof r.extras === 'string' ? JSON.parse(r.extras || '[]') : r.extras) || [],
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
  ok(/470123456$/.test(cree.tel.replace(/\D/g, '')) && cree.nom === 'Famille Assistant' && notesEquipe(cree.notes).some((n) => n.t === 'Préparée avec l’assistant.' && n.par && n.le) && motDuClient(cree.notes) === '' && cree.canal === 'staff',
    '[A] au telephone et au nom du client, la trace de l assistant en note d equipe signee, rien au mot du client', JSON.stringify({ tel: cree.tel, nom: cree.nom, notes: cree.notes, canal: cree.canal }));
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

  // LE CAS CLEMENT (2026-11-12, Ansar : « faut ajouter ça prcq c super utile ») : 24 personnes, 1 h de
  // bowling, le laser en deux sessions (« une partie avec 10 joueurs et une autre avec 14 »), trois
  // assiettes apéro, 30 € par personne. Le meme clic cree tout : l arene prend les groupes dans l ordre
  // dit, le supplement est relu au catalogue, le forfait est facture contre la reference du programme.
  if (!editions.length) console.log('\n[D] le cas Clement : le laser en deux sessions, un supplement, un forfait');
  B.semer([]);
  const clement = monter(DIRECTION());
  const rc = await clement.cliquer({ startTime: '14:00', pax: 24, name: 'Clement',
    programme: [{ activityId: 'bowling', participants: 24, duration: 1 }, { activityId: 'laser_game', participants: 24, games: 1, groupes: [10, 14] }],
    supplements: [{ article: 'assiette-apero', quantite: 3 }], prix: 720, raisonPrix: 'forfait 30 € par personne', note: 'Assiette apéro après le bowling.' });
  const dc = lireBase().find((x) => x.id === (rc.json.reservation || {}).id) || { blocs: [], extras: [] };
  const itemsC = (dc.programme && (Array.isArray(dc.programme) ? dc.programme : dc.programme.items)) || [];
  const laserC = itemsC.find((x) => x && x.activityId === 'laser_game') || {};
  const sessions = dc.blocs.filter((b) => b && b.activityId === 'laser_game').map((b) => [b.startTime, b.players]);
  ok(rc.statut === 201 && JSON.stringify(laserC.groupes) === '[10,14]' && Number(laserC.participants) === 24 && JSON.stringify(sessions) === '[["15:00",10],["15:30",14]]',
    '[D] le laser en deux sessions, 10 puis 14 joueurs, dans l ordre dit', `${rc.statut} ${JSON.stringify({ groupes: laserC.groupes, sessions, message: rc.json.message })}`);
  const assiette = dc.extras.find((x) => x && x.articleId === 'assiette-apero') || {};
  ok(dc.extras.length === 1 && Number(assiette.qte) === 3 && Number(assiette.prixUnitaire) === 19 && Number(assiette.price) === 57,
    '[D] le supplement relu au catalogue, son prix du catalogue', JSON.stringify(dc.extras));
  ok(dc.prix === 720 && dc.reference > 0 && dc.reference !== 720 && /Prix \d+ € → 720 €, forfait 30 € par personne/.test(dc.notes),
    '[D] le forfait facture, le prix habituel garde en reference, la raison au dossier', JSON.stringify({ prix: dc.prix, reference: dc.reference, notes: dc.notes }));
  ok(notesEquipe(dc.notes).some((n) => n.t === 'Préparée avec l’assistant. Assiette apéro après le bowling.' && n.par && n.le) && motDuClient(dc.notes) === '',
    '[D] la note pour l equipe au dossier, sous la trace de l assistant', dc.notes);
  // Sans groupes, le laser d un groupe qui tient dans l arene reste une seule session, comme avant.
  B.semer([]);
  const sansGroupes = await monter(DIRECTION()).cliquer({ startTime: '14:00', pax: 24, programme: [{ activityId: 'bowling', participants: 24, duration: 1 }, { activityId: 'laser_game', participants: 24, games: 1 }] });
  const ds = lireBase().find((x) => x.id === (sansGroupes.json.reservation || {}).id) || { blocs: [] };
  const seules = ds.blocs.filter((b) => b && b.activityId === 'laser_game').map((b) => [b.startTime, b.players]);
  ok(sansGroupes.statut === 201 && JSON.stringify(seules) === '[["15:00",24]]', '[D] sans groupes, le laser du groupe reste une seule session', JSON.stringify(seules));
  // Des groupes qui ne font pas les joueurs de la ligne, un supplement hors catalogue, un forfait sans raison : refuses.
  B.semer([]);
  const mauvais = monter(DIRECTION());
  const refusD = await Promise.all([
    mauvais.cliquer({ pax: 24, programme: [{ activityId: 'laser_game', participants: 24, games: 1, groupes: [10, 10] }] }),
    mauvais.cliquer({ pax: 24, programme: [{ activityId: 'bowling', participants: 24, duration: 1, groupes: [10, 14] }] }),
    mauvais.cliquer({ pax: 5, supplements: [{ article: 'caviar' }] }),
    mauvais.cliquer({ pax: 5, prix: 50 }),
  ]);
  ok(refusD.every((x) => x.statut === 422) && lireBase().length === 0, '[D] des groupes faux, un supplement hors catalogue ou un forfait sans raison ne creent rien (422)', JSON.stringify(refusD.map((x) => [x.statut, x.json.message])));
  // Les groupes ne passent que par l equipe : une demande en ligne forgee prendrait l arene plusieurs fois pour une partie.
  const VP = require(path.join(B.ROOT, 'lib/visit-program.js'));
  const ligneLaser = [{ activityId: 'laser_game', participants: 24, games: 1, groupes: [10, 14] }];
  let enLigne = '';
  try { VP.normalizeProgram(ligneLaser, { centerId: 'libramont', pax: 24, publicBooking: true }); enLigne = 'accepte'; } catch (e) { enLigne = e.message; }
  const auComptoir = VP.normalizeProgram(ligneLaser, { centerId: 'libramont', pax: 24, staff: true }).items[0] || {};
  ok(/se règlent avec le centre/.test(enLigne) && JSON.stringify(auComptoir.groupes) === '[10,14]', '[D] les groupes du laser se posent au comptoir, jamais par une demande en ligne', JSON.stringify({ enLigne, auComptoir: auComptoir.groupes }));
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
