'use strict';
// LA PRIVATISATION (2026-11-18). Marius, manager de Gembloux : « est-ce que tu as prévu un onglet
// privatisation ? Genre comme ça je suis sûr que personne ne rajoute de réservation à ce moment-là. »
//
// Ce gate joue la VRAIE chaine (api/ops.js, api/staff-reservations.js, api/staff-state.js,
// api/public-reservations.js, api/public-availability.js, le moteur, lib/database.js) sur la base en
// memoire du banc Reserver (scripts/reserver-banc.js), a laquelle il ajoute la table
// availability_blocks : un faux SQL qui OBEIT AU TEXTE (une condition retiree de la requete retire
// son effet). Zero reseau, zero base, rien ne part. Le samedi du banc, ouvert de 10:00 a minuit.
//   [A] LE GESTE : le manager voit les reservations deja sur la plage AVANT d enregistrer, rien ne
//       s ecrit tant qu il ne les a pas vues, puis une seule ecriture pose la privatisation ; la
//       Staff bar est refusee par le serveur ; deux privatisations au meme endroit se refusent ;
//   [B] EN LIGNE : le formulaire ne propose plus les heures privatisees, la confirmation se refuse,
//       et le client ne lit jamais le nom du groupe prive ;
//   [C] AU COMPTOIR : la simulation dit « Privatisé : <nom>, de 18:00 à 22:00 » AVANT « Créer »,
//       l horloge marque l heure, la creation et « Créer quand même » se refusent avec la phrase ;
//   [D] UNE ACTIVITE SEULE (le minigolf, ni bowling ni laser) : elle se refuse partout, et les
//       autres activites restent libres ;
//   [E] LE GLISSER du planning se refuse avec la phrase ;
//   [F] L ASSISTANT se refuse avec la phrase ;
//   [G] « MODIFIER » ne pose pas un dossier dans la privatisation ; celui qui y etait se corrige ;
//   [H] RETIRER : le manager la retire, la Staff bar non, et une fermeture ne part jamais par ce
//       chemin ;
//   [I] SANS PRIVATISATION, RIEN NE CHANGE : disponibilites et plan du comptoir identiques, une
//       fermeture garde sa phrase et ses regles ;
//   [J] LE GROUPE PRIVE : « Réserver pour Dupont » cree son dossier dans la privatisation et l y
//       rattache, il s y deplace librement, un deuxieme dossier ne s y glisse pas ;
//   [K] LE PLANNING : la journee servie aux postes porte la privatisation, et sa revision change.
// --contre-preuves : chaque garde retiree en memoire (le disque n est jamais touche) fait rougir sa
// lettre.
// Lancement : node scripts/privatisation-check.js [--contre-preuves]
const path = require('path');
const { Readable } = require('stream');
const B = require('./reserver-banc.js');
const H = require('./slot-holds-check.js');

const CONTRE = process.argv.includes('--contre-preuves');
const JOUR = B.JOUR;
const AUTRE_JOUR = (() => { const d = new Date(`${JOUR}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();
const NOM = 'Anniversaire Dupont';
const PHRASE = `Privatisé : ${NOM}, de 18:00 à 22:00.`;

// La table availability_blocks, en memoire, qui obeit au texte de la requete (scripts/privatisation-banc.js).
const PB = require('./privatisation-banc.js');
const { table, poserBlocs, pause } = PB;

// ---------------------------------------------------------------------------
// Les appels.
// ---------------------------------------------------------------------------
const MANAGER = () => B.sessionDuRole('manager', { nom: 'Marius' });
const STAFF_BAR = () => B.sessionDuRole('staff-bar', { nom: 'Lou' });
const DIRECTION = () => ({ ...B.sessionDuRole('manager', { nom: 'Ansar' }), role: { id: 'direction', name: 'Direction', locked: true } });
const URL_RESA = '/api/staff-reservations';
const BOWLING = (heure, extra = {}) => B.corpsStaff({ type: 'bowling', pax: 4, startTime: heure, duration: 1, totalDuration: 1, lanes: [], laneCount: 1, ...extra });
const MINIGOLF = (heure, extra = {}) => B.corpsStaff({ type: 'visite', pax: 4, startTime: heure, program: [{ activityId: 'minigolf_blacklight', participants: 4 }], ...extra });
let ipSuivante = 40;
async function publicGet(handler, url) {
  ipSuivante += 1;
  const ip = `10.40.${Math.floor(ipSuivante / 250)}.${ipSuivante % 250}`;
  const req = Readable.from([]);
  req.method = 'GET';
  req.url = url;
  req.headers = { host: 'localhost', 'x-forwarded-for': ip };
  req.socket = { remoteAddress: ip };
  const res = { statusCode: 200, entetes: {}, corps: '', req, setHeader(k, v) { this.entetes[k.toLowerCase()] = v; }, getHeader(k) { return this.entetes[k.toLowerCase()]; }, end(b) { this.corps = String(b || ''); } };
  await handler(req, res);
  let json = {};
  try { json = JSON.parse(res.corps); } catch (e) { json = {}; }
  return { statut: res.statusCode, json };
}
const heuresDuTunnel = async (S, query) => ((await publicGet(S.dispo, `/api/public-availability?${query}`)).json.slots || []).map((slot) => slot.time);
const enBase = () => [...B.base.reservations.values()];
const nouvelles = (avant) => enBase().filter((r) => !avant.has(r.id));
const ids = () => new Set(enBase().map((r) => r.id));
const privees = () => table.lignes.filter((l) => l.kind === 'private');

async function verifier(editions = []) {
  const echecs = [];
  const ok = (cond, nom, detail = '') => {
    if (!cond) echecs.push(nom);
    if (!editions.length) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${nom}${cond || detail === '' ? '' : `  ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400)}`}`);
  };
  const titre = (t) => { if (!editions.length) console.log(`\n${t}`); };
  table.lignes = [];
  table.version += 1;
  B.semer([B.ligne(901, { start_time: '19:00', lanes: [3], name: 'Famille Leroy', pax: 4 })]);
  const m = B.monter({ session: MANAGER(), mutations: editions });
  const ops = require(path.join(B.ROOT, 'api/ops.js'));
  const staffState = require(path.join(B.ROOT, 'api/staff-state.js'));
  const S = m.S;
  const appelerOps = (corps) => B.appeler(ops, 'POST', '/api/ops', { centerId: 'libramont', ...corps });
  const privatiser = (corps) => appelerOps({ action: 'privatiser', date: JOUR, startTime: '18:00', endTime: '22:00', toutLeCentre: true, nom: NOM, ...corps });
  const simuler = async (corps) => (await m.appeler('POST', URL_RESA, { ...corps, dryRun: true })).json;

  // Avant tout : un dossier de 15:00 cree au comptoir (il servira au glisser et a « Modifier »).
  const cree = await m.appeler('POST', URL_RESA, BOWLING('15:00', { name: 'Famille Martin', phone: '0470333444' }));
  const martin = cree.json.reservation || {};
  ok(cree.statut === 201 && martin.id, 'socle : un bowling cree au comptoir a 15:00', `${cree.statut} ${cree.json.message || ''}`);

  // Sans aucune privatisation : ce que le tunnel et le comptoir disent (pour [I]).
  const tunnelSans = await heuresDuTunnel(S, `centerId=libramont&date=${AUTRE_JOUR}&pax=4&type=bowling&duration=1`);
  const planSans = (await simuler(BOWLING('19:00', { date: AUTRE_JOUR }))).plan;

  titre('[A] le geste : voir ce qui est deja la, puis une seule ecriture');
  const apercu = await privatiser({ aBlanc: true });
  const listees = (apercu.json.reservations || []).map((r) => r.id);
  ok(apercu.statut === 200 && listees.includes(901) && !privees().length && (apercu.json.reservations || []).some((r) => r.nom === 'Famille Leroy' && r.debut === '19:00'),
    '[A] les reservations deja sur la plage sont listees avant d enregistrer (Famille Leroy, 19:00)', apercu.json);
  ok(!listees.includes(martin.id), '[A] un dossier hors de la plage (15:00) n est pas liste', listees);
  const sansVoir = await privatiser({});
  ok(sansVoir.statut === 409 && sansVoir.json.code === 'reservations_sur_la_plage' && /Famille Leroy/.test(sansVoir.json.message || '') && !privees().length,
    '[A] sans les avoir vues, rien ne s ecrit (409, le nom du dossier dit)', `${sansVoir.statut} ${sansVoir.json.message || ''}`);
  m.changerSession(STAFF_BAR());
  const barre = await privatiser({ reservationsVues: [901] });
  ok(barre.statut === 403 && !privees().length, '[A] la Staff bar est refusee par le serveur (403), rien d ecrit', `${barre.statut} ${barre.json.message || ''}`);
  m.changerSession(MANAGER());
  const pose = await privatiser({ reservationsVues: [901] });
  const lignes = privees();
  ok(pose.statut === 200 && lignes.length === 1 && lignes[0].scope_type === 'center' && lignes[0].reason === NOM && lignes[0].start_time === '18:00' && lignes[0].end_time === '22:00' && lignes[0].date === JOUR,
    '[A] vues, la privatisation s ecrit : tout le centre, 18:00 a 22:00, au nom donne', { statut: pose.statut, message: pose.json.message, lignes });
  const doublon = await privatiser({ toutLeCentre: false, activites: ['laser_game'], startTime: '19:00', endTime: '21:00', nom: 'Autre groupe' });
  ok(doublon.statut === 409 && /Déjà privatisé : Anniversaire Dupont, de 18:00 à 22:00/.test(doublon.json.message || '') && privees().length === 1,
    '[A] une deuxieme privatisation au meme endroit se refuse et dit laquelle', `${doublon.statut} ${doublon.json.message || ''}`);
  const idCentre = Number(lignes[0] && lignes[0].id);

  titre('[B] en ligne');
  const tunnel = await heuresDuTunnel(S, `centerId=libramont&date=${JOUR}&pax=4&type=bowling&duration=1`);
  ok(tunnel.includes('17:00') && tunnel.includes('22:00') && !tunnel.some((h) => h > '17:00' && h < '22:00'),
    '[B] le formulaire ne propose aucune heure qui touche 18:00-22:00 (17:00 et 22:00 restent)', tunnel.join(','));
  const avantEnLigne = ids();
  const enLigne = await H.confirmer(S, H.avecContact(H.BOWLING('19:00'), 7));
  ok(enLigne.statut >= 400 && /privatisé de 18:00 à 22:00/.test(enLigne.json.message || '') && !nouvelles(avantEnLigne).length,
    '[B] la confirmation en ligne a 19:00 se refuse : « privatisé de 18:00 à 22:00 »', `${enLigne.statut} ${enLigne.json.message || ''}`);
  ok(!/Dupont/.test(JSON.stringify(enLigne.json)), '[B] le client en ligne ne lit jamais le nom du groupe prive', enLigne.json.message || '');

  titre('[C] au comptoir');
  const sim = await simuler(BOWLING('19:00'));
  ok(sim.plan && sim.plan.disponible === false && sim.plan.refus === PHRASE && sim.plan.fermeture && sim.plan.fermeture.type === 'privatisation',
    '[C] la simulation dit la phrase avant « Créer »', sim.plan ? { disponible: sim.plan.disponible, refus: sim.plan.refus, fermeture: sim.plan.fermeture } : sim);
  const horloge = await m.appeler('POST', URL_RESA, { ...BOWLING('17:00'), dryRun: true, candidats: ['17:00', '19:00'] });
  const h19 = (horloge.json.candidats || []).find((c) => c.heure === '19:00') || {};
  const h17 = (horloge.json.candidats || []).find((c) => c.heure === '17:00') || {};
  ok(h19.statut === 'ko' && h19.court === 'privatisé' && h19.raison === PHRASE && h17.statut === 'ok',
    '[C] l horloge marque 19:00 « privatisé », 17:00 reste ok', { h17: h17.statut, h19 });
  const avantComptoir = ids();
  const creation = await m.appeler('POST', URL_RESA, BOWLING('19:00', { name: 'Intrus', phone: '0470222333' }));
  ok(creation.statut === 409 && creation.json.message === PHRASE && !nouvelles(avantComptoir).length,
    '[C] la creation au comptoir refuse, avec la phrase', `${creation.statut} ${creation.json.message || ''}`);
  const force = await m.appeler('POST', URL_RESA, BOWLING('19:00', { name: 'Intrus', phone: '0470222333', forcer: true }));
  ok(force.statut >= 400 && force.json.message === PHRASE && !nouvelles(avantComptoir).length,
    '[C] « Créer quand même » ne contourne pas la privatisation', `${force.statut} ${force.json.message || ''}`);

  titre('[D] une activite seule : le minigolf');
  const ecole = await appelerOps({ action: 'privatiser', date: JOUR, startTime: '12:00', endTime: '14:00', activites: ['minigolf_blacklight'], nom: 'Sortie école' });
  const idMinigolf = (ecole.json.privatisation && ecole.json.privatisation.ids) || [];
  ok(ecole.statut === 200 && idMinigolf.length === 1 && privees().some((l) => l.scope_type === 'activity' && l.scope_ref === 'minigolf_blacklight'),
    '[D] le minigolf seul se privatise, de 12:00 a 14:00', `${ecole.statut} ${ecole.json.message || ''}`);
  const simMinigolf = await simuler(MINIGOLF('12:30'));
  ok(simMinigolf.plan && simMinigolf.plan.disponible === false && simMinigolf.plan.refus === 'Privatisé : Sortie école, de 12:00 à 14:00 (Minigolf Blacklight).',
    '[D] la simulation du comptoir refuse le minigolf a 12:30, avec la phrase', simMinigolf.plan ? simMinigolf.plan.refus : simMinigolf);
  const avantMinigolf = ids();
  const creeMinigolf = await m.appeler('POST', URL_RESA, MINIGOLF('12:30', { name: 'Golfeurs', phone: '0470555666' }));
  ok(creeMinigolf.statut === 409 && /Privatisé : Sortie école/.test(creeMinigolf.json.message || '') && !nouvelles(avantMinigolf).length,
    '[D] la creation du minigolf a 12:30 se refuse', `${creeMinigolf.statut} ${creeMinigolf.json.message || ''}`);
  const simBowling = await simuler(BOWLING('12:30'));
  const creeBowling = await m.appeler('POST', URL_RESA, BOWLING('12:30', { name: 'Bowlers', phone: '0470666777' }));
  ok(simBowling.plan && simBowling.plan.disponible === true && creeBowling.statut === 201,
    '[D] le bowling a 12:30 reste libre : seule l activite choisie est privatisee', { sim: simBowling.plan && simBowling.plan.disponible, creation: creeBowling.statut, message: creeBowling.json.message });
  const tunnelMinigolf = await heuresDuTunnel(S, `centerId=libramont&date=${JOUR}&pax=4&type=visite&program=${encodeURIComponent(JSON.stringify({ items: [{ activityId: 'minigolf_blacklight' }] }))}`);
  ok(!tunnelMinigolf.includes('12:30') && !tunnelMinigolf.includes('13:00') && tunnelMinigolf.includes('15:00'),
    '[D] le formulaire en ligne ne propose pas le minigolf pendant sa privatisation (15:00 reste)', tunnelMinigolf.join(','));
  const avantMinigolfEnLigne = ids();
  const minigolfEnLigne = await H.confirmer(S, H.avecContact(H.visite('12:30', [{ activityId: 'minigolf_blacklight', sansHeure: true }]), 8));
  ok(minigolfEnLigne.statut >= 400 && /Minigolf Blacklight : privatisé de 12:00 à 14:00/.test(minigolfEnLigne.json.message || '') && !/école/.test(minigolfEnLigne.json.message || '') && !nouvelles(avantMinigolfEnLigne).length,
    '[D] la confirmation en ligne du minigolf se refuse, sans le nom', `${minigolfEnLigne.statut} ${minigolfEnLigne.json.message || ''}`);

  titre('[E] le glisser du planning');
  const avantGlisser = enBase().find((r) => r.id === martin.id) || {};
  const glisser = await m.appeler('PATCH', URL_RESA, { id: martin.id, centerId: 'libramont', baseUpdatedAt: new Date(avantGlisser.updated_at).toISOString(), activityMove: { activityId: 'bowling', startTime: '19:00', lanes: avantGlisser.lanes } });
  const apresGlisser = enBase().find((r) => r.id === martin.id) || {};
  ok(glisser.statut === 409 && glisser.json.message === PHRASE && apresGlisser.start_time === avantGlisser.start_time,
    '[E] glisser un bowling a 19:00 se refuse, avec la phrase, et rien ne bouge', `${glisser.statut} ${glisser.json.message || ''}`);

  titre('[F] l assistant');
  m.changerSession(DIRECTION());
  const avantAssistant = ids();
  const assistant = await appelerOps({ action: 'assistantReservation', date: JOUR, startTime: '19:00', pax: 4, programme: [{ activityId: 'bowling', participants: 4, duration: 1 }], name: 'Par l assistant', phone: '0470 12 34 56' });
  ok(assistant.statut === 409 && /Privatisé : Anniversaire Dupont, de 18:00 à 22:00/.test(assistant.json.message || '') && !nouvelles(avantAssistant).length,
    '[F] l assistant se refuse a 19:00, avec la phrase', `${assistant.statut} ${assistant.json.message || ''}`);
  m.changerSession(MANAGER());

  titre('[G] Modifier');
  const avantModif = enBase().find((r) => r.id === martin.id) || {};
  let refusModif = null;
  try { await S.db.updateReservation({ id: martin.id, startTime: '19:00', baseUpdatedAt: new Date(avantModif.updated_at).toISOString() }); } catch (error) { refusModif = error; }
  ok(refusModif && refusModif.message === PHRASE && (enBase().find((r) => r.id === martin.id) || {}).start_time === avantModif.start_time,
    '[G] « Modifier » ne pose pas un dossier dans la privatisation', refusModif ? refusModif.message : 'accepte');
  const leroy = enBase().find((r) => r.id === 901) || {};
  let corrige = null;
  try { corrige = await S.db.updateReservation({ id: 901, name: 'Famille Leroy-Martin', baseUpdatedAt: new Date(leroy.updated_at).toISOString() }); } catch (error) { corrige = error; }
  ok(corrige && corrige.name === 'Famille Leroy-Martin', '[G] le dossier deja sur la plage se corrige (son nom)', corrige && corrige.message);

  titre('[J] le groupe prive');
  const simGroupe = await simuler(BOWLING('19:00', { privatisation: idCentre }));
  ok(simGroupe.plan && simGroupe.plan.disponible === true && simGroupe.plan.pourPrivatisation && simGroupe.plan.pourPrivatisation.nom === NOM,
    '[J] « Réserver pour Anniversaire Dupont » : la simulation tient', simGroupe.plan ? { disponible: simGroupe.plan.disponible, refus: simGroupe.plan.refus, pour: simGroupe.plan.pourPrivatisation } : simGroupe);
  const creeGroupe = await m.appeler('POST', URL_RESA, BOWLING('19:00', { privatisation: idCentre, name: 'Dupont', phone: '0470888999' }));
  const dupont = creeGroupe.json.reservation || {};
  ok(creeGroupe.statut === 201 && dupont.id && Number((table.lignes.find((l) => Number(l.id) === idCentre) || {}).reservation_id) === Number(dupont.id),
    '[J] le dossier du groupe se cree dans sa privatisation et s y rattache', `${creeGroupe.statut} ${creeGroupe.json.message || ''}`);
  // (le lien s est ecrit dans la transaction de la creation : le cache des blocages le voit a la lecture suivante)
  await pause(40);
  const ligneDupont = enBase().find((r) => r.id === dupont.id) || {};
  const deplace = await m.appeler('PATCH', URL_RESA, { id: dupont.id, centerId: 'libramont', baseUpdatedAt: new Date(ligneDupont.updated_at).toISOString(), activityMove: { activityId: 'bowling', startTime: '20:00', lanes: ligneDupont.lanes } });
  ok(deplace.statut === 200 && (enBase().find((r) => r.id === dupont.id) || {}).ops_plan && JSON.stringify((enBase().find((r) => r.id === dupont.id) || {}).ops_plan).includes('"20:00"'),
    '[J] la reservation du groupe se deplace dans sa privatisation', `${deplace.statut} ${deplace.json.message || ''}`);
  const avantSecond = ids();
  const simSecond = await simuler(BOWLING('19:00', { privatisation: idCentre }));
  const second = await m.appeler('POST', URL_RESA, BOWLING('19:00', { privatisation: idCentre, name: 'Resquilleur', phone: '0470999000' }));
  ok(simSecond.plan && simSecond.plan.disponible === false && simSecond.plan.refus === PHRASE && second.statut === 409 && second.json.message === PHRASE && !nouvelles(avantSecond).length,
    '[J] un deuxieme dossier ne se glisse pas dans une privatisation deja rattachee', { simulation: simSecond.plan && simSecond.plan.refus, statut: second.statut, message: second.json.message });

  titre('[K] le planning de chaque poste');
  const etat = await B.appeler(staffState, 'GET', `/api/staff-state?date=${JOUR}&centerId=libramont`);
  const blocsServis = Array.isArray(etat.json.blocks) ? etat.json.blocks : [];
  ok(etat.statut === 200 && blocsServis.some((b) => b.kind === 'private' && b.reason === NOM && b.scopeType === 'center' && b.startMin === 18 * 60 && b.endMin === 22 * 60) && !blocsServis.some((b) => 'createdBy' in b),
    '[K] la journee servie aux postes porte la privatisation (nom, plage, portee), sans qui l a posee', blocsServis);
  const revisionAvant = etat.json.revision;
  await appelerOps({ action: 'privatiser', date: JOUR, startTime: '10:00', endTime: '11:00', activites: ['billards'], nom: 'Tournoi' });
  const etatApres = await B.appeler(staffState, 'GET', `/api/staff-state?date=${JOUR}&centerId=libramont`);
  ok(revisionAvant && etatApres.json.revision && etatApres.json.revision !== revisionAvant, '[K] une privatisation posee change la revision : les autres postes la voient', { avant: revisionAvant, apres: etatApres.json.revision });

  titre('[H] retirer');
  m.changerSession(STAFF_BAR());
  const retraitBarre = await appelerOps({ action: 'retirerPrivatisation', ids: idMinigolf });
  ok(retraitBarre.statut === 403 && privees().some((l) => l.scope_ref === 'minigolf_blacklight'), '[H] la Staff bar ne retire pas une privatisation (403)', `${retraitBarre.statut}`);
  m.changerSession(MANAGER());
  const retrait = await appelerOps({ action: 'retirerPrivatisation', ids: idMinigolf });
  const simApres = await simuler(MINIGOLF('12:30'));
  ok(retrait.statut === 200 && retrait.json.removed === 1 && !privees().some((l) => l.scope_ref === 'minigolf_blacklight') && simApres.plan && simApres.plan.disponible === true,
    '[H] le manager retire la privatisation du minigolf, 12:30 redevient possible', { statut: retrait.statut, json: retrait.json, disponible: simApres.plan && simApres.plan.disponible });
  await poserBlocs([{ id: 990, scope_type: 'lane', scope_ref: '8', date: JOUR, start_time: '10:00', end_time: '12:00', reason: 'Courroie' }]);
  const retraitFermeture = await appelerOps({ action: 'retirerPrivatisation', ids: [990] });
  ok(retraitFermeture.statut === 404 && table.lignes.some((l) => Number(l.id) === 990), '[H] une fermeture ne se retire jamais par ce chemin', `${retraitFermeture.statut} ${retraitFermeture.json.message || ''}`);

  titre('[I] sans privatisation, rien ne change');
  const tunnelAvec = await heuresDuTunnel(S, `centerId=libramont&date=${AUTRE_JOUR}&pax=4&type=bowling&duration=1`);
  const planAvec = (await simuler(BOWLING('19:00', { date: AUTRE_JOUR }))).plan;
  ok(tunnelSans.length > 0 && JSON.stringify(tunnelAvec) === JSON.stringify(tunnelSans), '[I] un jour sans privatisation : le formulaire propose exactement les memes heures', { sans: tunnelSans.length, avec: tunnelAvec.length });
  ok(planSans && JSON.stringify(planAvec) === JSON.stringify(planSans), '[I] un jour sans privatisation : le plan du comptoir est identique', { sans: planSans && planSans.disponible, avec: planAvec && planAvec.disponible });
  await poserBlocs([
    { id: 991, scope_type: 'center', scope_ref: null, date: AUTRE_JOUR, start_time: '14:00', end_time: '16:00', reason: 'Travaux' },
    { id: 992, scope_type: 'activity', scope_ref: 'minigolf_blacklight', date: AUTRE_JOUR, start_time: '17:00', end_time: '19:00', reason: 'Entretien' },
  ]);
  const avantFermeture = ids();
  const fermeCentre = await m.appeler('POST', URL_RESA, BOWLING('14:30', { date: AUTRE_JOUR, name: 'Client', phone: '0470121212' }));
  ok(fermeCentre.statut >= 400 && fermeCentre.json.message === 'Le centre est fermé sur ce créneau.' && !nouvelles(avantFermeture).length,
    '[I] une fermeture du centre garde sa phrase', `${fermeCentre.statut} ${fermeCentre.json.message || ''}`);
  const fermeActivite = await m.appeler('POST', URL_RESA, MINIGOLF('17:30', { date: AUTRE_JOUR, name: 'Client', phone: '0470131313' }));
  ok(fermeActivite.statut === 201, '[I] une fermeture d activite garde sa regle d avant (la privatisation seule ferme toutes les activites)', `${fermeActivite.statut} ${fermeActivite.json.message || ''}`);

  titre('[L] modifier une privatisation, et la liste de celles a venir (2026-11-20)');
  // La soiree Lambert, posee puis modifiee : en une ecriture, l ancienne part et la nouvelle se pose.
  const surLe = (corps) => privatiser({ date: AUTRE_JOUR, toutLeCentre: true, nom: 'Soirée Lambert', ...corps });
  const vuesDe = async (corps) => ((await surLe({ ...corps, aBlanc: true })).json.reservations || []).map((r) => r.id);
  const lambert = () => privees().filter((l) => l.date === AUTRE_JOUR && l.reason === 'Soirée Lambert');
  const premiere = await surLe({ startTime: '20:00', endTime: '22:00', reservationsVues: await vuesDe({ startTime: '20:00', endTime: '22:00' }) });
  const idsAvant = lambert().map((l) => Number(l.id));
  ok(premiere.statut === 200 && idsAvant.length === 1, '[L] socle : la soirée Lambert posée de 20:00 à 22:00', `${premiere.statut} ${premiere.json.message || ''}`);
  // Elle chevauche sa propre plage : sa modification ne se gene pas elle-meme.
  const modif = await surLe({ startTime: '19:30', endTime: '23:00', remplace: idsAvant, reservationsVues: await vuesDe({ startTime: '19:30', endTime: '23:00', remplace: idsAvant }) });
  const apresModif = lambert();
  ok(modif.statut === 200 && apresModif.length === 1 && /^19:30/.test(String(apresModif[0].start_time)) && /^23:00/.test(String(apresModif[0].end_time)) && !apresModif.some((l) => idsAvant.includes(Number(l.id))),
    '[L] modifier : la privatisation passe à 19:30-23:00, l ancienne est partie, une seule reste', { statut: modif.statut, message: modif.json.message, lignes: apresModif });
  const perimee = await surLe({ startTime: '18:00', endTime: '23:00', remplace: idsAvant, reservationsVues: await vuesDe({ startTime: '18:00', endTime: '23:00', remplace: idsAvant }) });
  const apresPerimee = lambert();
  ok(perimee.statut === 409 && perimee.json.code === 'privatisation_changee' && apresPerimee.length === 1 && /^19:30/.test(String(apresPerimee[0].start_time)),
    '[L] une modification d une privatisation qui a deja change ne s ecrit pas (409), rien ne bouge', { statut: perimee.statut, json: perimee.json, lignes: apresPerimee });
  // Retiree sur un autre poste, puis « modifiee » ici : rien ne la recree.
  const idsModifies = apresModif.map((l) => Number(l.id));
  await appelerOps({ action: 'retirerPrivatisation', ids: idsModifies });
  const fantome = await surLe({ startTime: '20:00', endTime: '21:00', remplace: idsModifies, reservationsVues: await vuesDe({ startTime: '20:00', endTime: '21:00', remplace: idsModifies }) });
  ok(fantome.statut === 409 && fantome.json.code === 'privatisation_changee' && lambert().length === 0,
    '[L] modifier une privatisation retiree entre-temps ne la recree pas (409), rien ne s ecrit', { statut: fantome.statut, json: fantome.json, lignes: lambert() });
  await surLe({ startTime: '19:30', endTime: '23:00', reservationsVues: await vuesDe({ startTime: '19:30', endTime: '23:00' }) });
  const liste = await appelerOps({ action: 'listerPrivatisations' });
  const lues = Array.isArray(liste.json.privatisations) ? liste.json.privatisations : [];
  ok(liste.statut === 200 && lues.some((p) => p.nom === 'Soirée Lambert' && p.date === AUTRE_JOUR && p.startTime === '19:30' && p.endTime === '23:00' && p.toutLeCentre),
    '[L] la liste des privatisations à venir porte la soirée Lambert modifiée', lues);
  ok(liste.statut === 200 && !lues.some((p) => /Travaux|Entretien|Courroie/.test(p.nom)), '[L] la liste ne montre que des privatisations, jamais une fermeture', lues);
  m.changerSession(STAFF_BAR());
  const listeBarre = await appelerOps({ action: 'listerPrivatisations' });
  ok(listeBarre.statut === 403, '[L] la Staff bar ne lit pas la liste des privatisations (403)', `${listeBarre.statut}`);
  m.changerSession(MANAGER());

  return echecs;
}

// Chaque garde retiree en memoire doit rougir sa lettre.
const DB = 'lib/database.js';
const MUTATIONS = [
  { nom: 'garde-de-creation', rouge: '[C] la creation au comptoir refuse, avec la phrase', editions: [{ fichier: DB, de: '  if (groupe && groupe.length) blocks = sansLaPrivatisationDuGroupe(blocks, { ids: groupe });\n  assertReservationNotBlocked(payload, blocks, payload.date);', vers: '  if (groupe && groupe.length) blocks = sansLaPrivatisationDuGroupe(blocks, { ids: groupe });' }] },
  { nom: 'simulation-aveugle', rouge: '[C] la simulation dit la phrase avant « Créer »', editions: [{ fichier: 'lib/reserver-fenetre.js', de: '  const fermeture = conflitDeFermeture(dossier, snapshot, request.date, groupe);', vers: '  const fermeture = null;' }] },
  { nom: 'horloge-sans-mot', rouge: '[C] l horloge marque 19:00 « privatisé », 17:00 reste ok', editions: [{ fichier: 'lib/reserver-simulation.js', de: "const CONFLITS_BLOQUANTS = new Set(['plan', 'arene', 'fermeture']);", vers: "const CONFLITS_BLOQUANTS = new Set(['plan', 'arene']);" }] },
  { nom: 'bowling-et-laser-seulement', rouge: '[D] la creation du minigolf a 12:30 se refuse', editions: [{ fichier: DB, de: '  const privees = opposables.filter(estPrivatisation);', vers: '  const privees = [];' }] },
  { nom: 'tunnel-libre-aveugle', rouge: '[D] le formulaire en ligne ne propose pas le minigolf pendant sa privatisation (15:00 reste)', editions: [{ fichier: 'api/public-availability.js', de: '        if (program.items.some((item) => estPrivatisation(blocageDActivite(snapshot.blocks || [], date, item.activityId, startMin, endMin)))) continue;', vers: '' }] },
  { nom: 'glisser-sans-centre', rouge: '[E] glisser un bowling a 19:00 se refuse, avec la phrase, et rien ne bouge', editions: [{ fichier: DB, de: '    if (!isCenterClosedDuring(blocks, effectiveDate, startMin, endMin)) return;', vers: '    return;' }] },
  { nom: 'assistant-aveugle', rouge: '[F] l assistant se refuse a 19:00, avec la phrase', editions: [
    { fichier: DB, de: '  if (groupe && groupe.length) blocks = sansLaPrivatisationDuGroupe(blocks, { ids: groupe });\n  assertReservationNotBlocked(payload, blocks, payload.date);', vers: '  if (groupe && groupe.length) blocks = sansLaPrivatisationDuGroupe(blocks, { ids: groupe });' },
    { fichier: 'lib/reserver-fenetre.js', de: '  const fermeture = conflitDeFermeture(dossier, snapshot, request.date, groupe);', vers: '  const fermeture = null;' },
  ] },
  { nom: 'modifier-sans-garde', rouge: '[G] « Modifier » ne pose pas un dossier dans la privatisation', editions: [{ fichier: DB, de: '    if (privatisations.length) {', vers: '    if (false) {' }] },
  { nom: 'droit-elargi', rouge: '[A] la Staff bar est refusee par le serveur (403), rien d ecrit', editions: [{ fichier: 'api/ops.js', de: "if (['privatiser', 'retirerPrivatisation', 'listerPrivatisations'].includes(action)) return ['reservations.edit', 'settings.manage'];", vers: "if (['privatiser', 'retirerPrivatisation', 'listerPrivatisations'].includes(action)) return ['reservations.view'];" }] },
  { nom: 'modifier-garde-l-ancienne', rouge: '[L] modifier : la privatisation passe à 19:30-23:00, l ancienne est partie, une seule reste', editions: [{ fichier: 'lib/privatisation.js', de: '        const partis = await AB.retirerPrivatisationDans(client, { centerId, ids: p.remplace });', vers: '        const partis = p.remplace.length;' }] },
  { nom: 'modifier-se-gene', rouge: '[L] modifier : la privatisation passe à 19:30-23:00, l ancienne est partie, une seule reste', editions: [{ fichier: 'lib/privatisation.js', de: '  const autres = p.remplace.length ? blocsDuJour.filter((bloc) => !p.remplace.includes(Number(bloc && bloc.id))) : blocsDuJour;', vers: '  const autres = blocsDuJour;' }] },
  { nom: 'modifier-perimee-sans-sa-raison', rouge: '[L] une modification d une privatisation qui a deja change ne s ecrit pas (409), rien ne bouge', editions: [{ fichier: 'lib/privatisation.js', de: '    if (!p.remplace.every((id) => encore.has(id))) {', vers: '    if (false) {' }] },
  // Deux gardes tiennent ce cas (la lecture avant, puis le retrait compte sous verrou) : les deux partent.
  { nom: 'modifier-recree-une-retiree', rouge: '[L] modifier une privatisation retiree entre-temps ne la recree pas (409), rien ne s ecrit', editions: [
    { fichier: 'lib/privatisation.js', de: '    if (!p.remplace.every((id) => encore.has(id))) {', vers: '    if (false) {' },
    { fichier: 'lib/privatisation.js', de: '        if (partis !== p.remplace.length) {', vers: '        if (false) {' },
  ] },
  // Deux filtres tiennent ce cas (la lecture, puis le regroupement par jour) : les deux partent.
  { nom: 'liste-avec-fermetures', rouge: '[L] la liste ne montre que des privatisations, jamais une fermeture', editions: [
    { fichier: 'lib/availability-blocks.js', de: ".filter((bloc) => bloc.kind === 'private' && bloc.recurrence === 'once' && bloc.date && bloc.date >= depuis);", vers: ".filter((bloc) => bloc.recurrence === 'once' && bloc.date && bloc.date >= depuis);" },
    { fichier: 'lib/privatisation.js', de: '.filter(AB.estPrivatisation).forEach((bloc) => {', vers: '.forEach((bloc) => {' },
  ] },
  { nom: 'ecrit-sans-voir', rouge: '[A] sans les avoir vues, rien ne s ecrit (409, le nom du dossier dit)', editions: [{ fichier: 'lib/privatisation.js', de: '  const nonVues = (liste) => liste.filter((r) => !r.duGroupe && !p.reservationsVues.includes(r.id));', vers: '  const nonVues = () => [];' }] },
  { nom: 'nom-en-ligne', rouge: '[B] le client en ligne ne lit jamais le nom du groupe prive', editions: [{ fichier: 'lib/availability-blocks.js', de: "  if (canal === 'public') {", vers: '  if (false) {' }] },
  // (le glisser, validateActivityMoveResources : son commentaire tient l ancre unique, la meme ligne vit
  // aussi dans placesDuDeplacement depuis d6f6eb9, et une ancre double desarmait cette contre-preuve)
  { nom: 'groupe-bloque-par-sa-privatisation', rouge: '[J] la reservation du groupe se deplace dans sa privatisation', editions: [{ fichier: DB, de: '  // blocages sont retires, les autres restent opposables.\n  const blocks = sansLaPrivatisationDuGroupe(listeDesBlocages, { reservationId: payload.id });', vers: '  // blocages sont retires, les autres restent opposables.\n  const blocks = listeDesBlocages;' }] },
  // Deux gardes tiennent ce cas (le groupe encore libre, et le blocage encore sans reservation) : les deux partent.
  { nom: 'deuxieme-dossier-rattache', rouge: '[J] un deuxieme dossier ne se glisse pas dans une privatisation deja rattachee', editions: [
    { fichier: 'lib/privatisation.js', de: '  return privatisationsDuJour(blocsDuJour, date).find((groupe) => groupe.ids.includes(voulu) && !groupe.reservationId) || null;', vers: '  return privatisationsDuJour(blocsDuJour, date).find((groupe) => groupe.ids.includes(voulu)) || null;' },
    { fichier: 'lib/availability-blocks.js', de: '(rattaches.has(Number(block.id)) && !block.reservationId)', vers: 'rattaches.has(Number(block.id))' },
  ] },
  { nom: 'retire-une-fermeture', rouge: '[H] une fermeture ne se retire jamais par ce chemin', editions: [{ fichier: 'lib/availability-blocks.js', de: "and kind = 'private'\n      returning id;", vers: '\n      returning id;' }] },
  { nom: 'planning-sans-fermetures', rouge: '[K] la journee servie aux postes porte la privatisation (nom, plage, portee), sans qui l a posee', editions: [{ fichier: 'api/staff-state.js', de: 'avecAbsents: true, avecFermetures: true });', vers: 'avecAbsents: true });' }] },
  { nom: 'revision-aveugle', rouge: '[K] une privatisation posee change la revision : les autres postes la voient', editions: [{ fichier: DB, de: '    const revision = fermetures && fermetures.length\n', vers: '    const revision = false\n' }] },
  { nom: 'fermeture-jugee-comme-privatisation', rouge: '[I] une fermeture d activite garde sa regle d avant (la privatisation seule ferme toutes les activites)', editions: [{ fichier: DB, de: '  const privees = opposables.filter(estPrivatisation);', vers: '  const privees = opposables;' }] },
];

(async () => {
  console.log(`privatisation-check : samedi ${JOUR}, Libramont, ouvert de 10:00 a minuit`);
  const nominal = await verifier([]);
  if (nominal.length) {
    console.error(`\nprivatisation-check: ${nominal.length} FAIL`);
    process.exit(1);
  }
  if (!CONTRE) {
    console.log('\nprivatisation-check: ALL OK (geste, en ligne, comptoir et simulation, minigolf, glisser, assistant, Modifier, retrait, sans privatisation rien ne change, groupe prive, planning)');
    process.exit(0);
  }
  console.log('\n--contre-preuves : chaque garde retiree en memoire doit rougir sa lettre');
  let rate = 0;
  // PRIV_MUTATIONS=nom1,nom2 : un sous-ensemble, pour iterer.
  const voulues = String(process.env.PRIV_MUTATIONS || '').split(',').map((x) => x.trim()).filter(Boolean);
  for (const mutation of MUTATIONS.filter((m) => !voulues.length || voulues.includes(m.nom))) {
    let rouges = [];
    try {
      rouges = await verifier(mutation.editions);
    } catch (error) {
      rouges = /ancre absente/.test(String(error && error.message)) ? ['ANCRE'] : [mutation.rouge];
      if (rouges[0] === 'ANCRE') console.error(`  ancre : ${error.message}`);
    }
    const bon = rouges.includes(mutation.rouge);
    console.log(`${bon ? 'ok  ' : 'FAIL'}  contre-preuve « ${mutation.nom} » : ${bon ? 'rougit' : 'RESTE VERTE'} ${mutation.rouge}${bon ? '' : `  (rouges : ${rouges.join(' | ') || 'aucun'})`}`);
    if (!bon) rate += 1;
  }
  if (rate) {
    console.error(`\nprivatisation-check: ${rate} contre-preuve(s) sans effet`);
    process.exit(1);
  }
  console.log(`\nprivatisation-check: ALL OK, ${MUTATIONS.length} contre-preuves rougissent chacune leur lettre`);
  process.exit(0);
})().catch((error) => {
  console.error('privatisation-check: exception', error && (error.stack || error));
  process.exit(1);
});
