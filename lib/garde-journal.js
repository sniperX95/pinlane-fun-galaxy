// LE JOURNAL RELU PAR LA GARDE (2026-11-06, Ansar : « chaque modification faite
// (reservation deplacee ou annulee, prix, reglages) », « groupees par quart d heure »).
//
// Toutes les 15 minutes, la garde relit le journal d audit depuis son dernier passage :
//   - une reservation ou une demande dont l annonce n est pas partie (Telegram en panne,
//     journal ecrit sans elle) s annonce, marquee « en retard » ;
//   - chaque modification faite part dans le sujet Modifications, un message par quart
//     d heure, range par centre, avec l heure et l auteur.
//
// Le journal note tout, y compris l ordinaire d une journee (arrivees, encaissements,
// notes, etapes d activite). Ceux-la ne font pas une ligne chacun : ils se comptent en
// bas du message, et un quart d heure qui n a que de l ordinaire ne dit rien. Une action
// que la garde ne connait pas fait une ligne a son nom : rien ne disparait en silence.
//
// Le curseur (le dernier numero de ligne lu) n avance que si tout est parti. Les lignes
// de la derniere minute attendent le passage suivant : une ecriture encore en cours ne
// se saute pas.
'use strict';

const { envoyerTelegram } = require('./garde-alertes');
const { euros, jourLisible, lienDeLaDemande, nomDuCentre, texteDemande, texteReservation } = require('./garde-annonces');

const FUSEAU = 'Europe/Brussels';
const LIMITE_LIGNES = 400;
const LIGNES_MAX_MESSAGE = 60;

const heure = (instant) => new Intl.DateTimeFormat('fr-BE', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(instant));

// Rien a dire, meme en compte : ce n est pas un changement de Pinlane.
const IGNOREES = new Set(['login', 'logout', 'parcours', 'accessDenied', 'logClientError', 'activityLog', 'markCommunicationRead', 'claimInboundEmail', 'releaseInboundEmail']);

// L ordinaire d une journee, compte en bas du message.
const COMPTES = {
  arrivee: ['arrivée notée', 'arrivées notées'],
  encaisse: ['encaissement noté', 'encaissements notés'],
  paiement: ['moyen de paiement noté', 'moyens de paiement notés'],
  etape: ['étape d’activité', 'étapes d’activité'],
  note: ['note d’équipe', 'notes d’équipe'],
  noteClient: ['note client', 'notes client'],
  noteDemande: ['note sur une demande', 'notes sur des demandes'],
  plan: ['plan recalculé', 'plans recalculés'],
};

const PHRASES = {
  saveCenterConfig: 'réglages du centre enregistrés',
  saveSurMesure: 'prix et règles du sur mesure enregistrés',
  saveGrillesTarif: 'grilles de prix enregistrées',
  saveCenter: 'fiche du centre enregistrée',
  setCenterStatus: 'statut du centre changé',
  setEmbedState: 'formulaire en ligne coupé ou remis',
  saveAvailabilityBlock: 'fermeture ou blocage posé',
  deleteAvailabilityBlock: 'fermeture ou blocage retiré',
  automationSettings: 'envois automatiques réglés',
  emailDesign: 'modèle de mail changé',
  sendCampaign: 'campagne de mails envoyée',
  ecrireDepartsEpingles: 'départs épinglés changés',
  updateLaneStatus: 'état d’une piste changé',
  saveFormuleOverride: 'formule changée',
  resetFormuleOverride: 'formule remise comme à l’origine',
  saveClientFormuleOverride: 'formule changée',
  createFormula: 'formule créée',
  updateFormula: 'formule changée',
  setFormulaSteps: 'étapes d’une formule changées',
  deleteFormula: 'formule retirée',
  createActivity: 'activité créée',
  updateActivity: 'activité changée',
  deleteActivity: 'activité retirée',
  createRole: 'rôle créé',
  renameRole: 'rôle renommé',
  deleteRole: 'rôle supprimé',
  updateRolePermissions: 'droits d’un rôle changés',
  setRolePreset: 'modèle de droits appliqué à un rôle',
  regenerateRoleCode: 'code d’accès régénéré',
  revealRoleCode: 'code d’accès affiché',
  revealMemberCode: 'code d’un membre affiché',
  createMember: 'membre créé',
  updateMemberRole: 'rôle d’un membre changé',
  toggleMemberStatus: 'membre bloqué ou débloqué',
  deleteMember: 'membre supprimé',
  renameMember: 'nom d’une personne changé',
  setMemberBlocked: 'personne bloquée ou débloquée',
  regenerateMemberCode: 'nouveau code donné à une personne',
  setMemberCenter: 'accès d’une personne à un centre changé',
  supprimerPersonne: 'personne supprimée de tous ses centres',
  createClient: 'client créé',
  updateClientStatus: 'statut d’un client changé',
  setClientBilling: 'facturation d’un client changée',
  addClientCenter: 'centre ajouté à un client',
  deleteCenter: 'centre supprimé',
  deleteClient: 'client supprimé',
  clientMessageSend: 'message envoyé au client',
  retryCommunication: 'mail relancé à la main',
  customRequestDraft: 'réponse préparée pour une demande de groupe',
  customRequestStatus: 'demande de groupe mise à jour',
  requeueOpsJob: 'tâche relancée à la main',
};

// Les champs d une reservation qui disent quelque chose a Ansar. Le reste du plan
// (opsPlan, risque, revision) suit ces changements et ne se redit pas.
const CHAMPS_LUS = {
  program: 'programme', formuleId: 'formule', formulaId: 'formule', label: 'formule', type: 'formule',
  name: 'coordonnées', phone: 'coordonnées', email: 'coordonnées', notes: 'notes', lanes: 'pistes',
  extras: 'suppléments', occasion: 'occasion', duration: 'durée', totalDuration: 'durée',
  validationStatus: 'validation', amountPaid: 'encaissé', discountReason: 'remise', paymentMethod: 'moyen de paiement',
  absentAt: 'absence', channel: 'canal',
};
const CHAMPS_DITS = new Set(['date', 'startTime', 'pax', 'price', 'status']);

const apres = (champ) => (champ && typeof champ === 'object' ? champ.after : undefined);
const avant = (champ) => (champ && typeof champ === 'object' ? champ.before : undefined);
const hh = (v) => String(v || '').slice(0, 5);

function dossierDe(l) {
  const d = l.dossier || {};
  const jour = d.date || apres(l.champs.date) || avant(l.champs.date) || '';
  const h = d.startTime || apres(l.champs.startTime) || avant(l.champs.startTime) || '';
  const quand = jour ? ` (${jourLisible(jour)}${h ? ` ${hh(h)}` : ''})` : '';
  return `réservation n° ${l.entity_id}${quand}`;
}

function decrireModification(l) {
  const c = l.champs || {};
  const morceaux = [];
  const statut = apres(c.status);
  if (statut === 'cancelled') morceaux.push('annulée');
  else if (avant(c.status) === 'cancelled' && statut) morceaux.push('rétablie');
  if (c.date || c.startTime) {
    const jourAvant = avant(c.date) || (l.dossier && l.dossier.date) || '';
    const jourApres = apres(c.date) || (l.dossier && l.dossier.date) || '';
    const hAvant = avant(c.startTime) || (l.dossier && l.dossier.startTime) || '';
    const hApres = apres(c.startTime) || (l.dossier && l.dossier.startTime) || '';
    morceaux.push(jourAvant === jourApres
      ? `déplacée de ${hh(hAvant)} à ${hh(hApres)}`
      : `déplacée du ${jourLisible(jourAvant)} ${hh(hAvant)} au ${jourLisible(jourApres)} ${hh(hApres)}`.replace(/\s+/g, ' ').trim());
  }
  if (c.pax) morceaux.push(`passe de ${Number(avant(c.pax)) || 0} à ${Number(apres(c.pax)) || 0} personnes`);
  if (c.price) morceaux.push(`prix de ${euros(avant(c.price)) || '?'} à ${euros(apres(c.price)) || '?'}`);
  const autres = [...new Set((l.cles || []).filter((k) => !CHAMPS_DITS.has(k)).map((k) => CHAMPS_LUS[k]).filter(Boolean))];
  if (autres.length) morceaux.push(`${autres.length > 1 ? 'changements' : 'changement'} : ${autres.join(', ')}`);
  return morceaux.join(', ');
}

// Une ligne du journal devient : une ligne de message, un compte, ou rien.
function classer(l) {
  if (IGNOREES.has(l.action)) return { rien: true };
  const c = l.champs || {};
  switch (l.action) {
    case 'createReservation':
    case 'createCustomRequest':
      return { creation: true };
    case 'updateReservation': {
      const texte = decrireModification(l);
      return texte ? { ligne: `${dossierDe(l)} ${texte}` } : { compte: 'plan' };
    }
    case 'setReservationStatus': {
      const statut = apres(c.status);
      if (statut === 'cancelled') return { ligne: `${dossierDe(l)} annulée` };
      if (avant(c.status) === 'cancelled' && statut) return { ligne: `${dossierDe(l)} rétablie` };
      if (statut === 'arrived') return { compte: 'arrivee' };
      if (statut === 'paid') return { compte: 'encaisse' };
      return { compte: 'paiement' };
    }
    case 'noterEncaisse': {
      const remise = apres(c.discountReason);
      if (remise) return { ligne: `${dossierDe(l)} encaissée avec une remise (${String(remise).replace(/\s+/g, ' ').slice(0, 40)})${apres(c.amountPaid) !== undefined ? `, ${euros(apres(c.amountPaid))}` : ''}` };
      return { compte: 'encaisse' };
    }
    case 'noterAbsence':
      return { ligne: `${dossierDe(l)} ${apres(c.absentAt) ? 'notée absente' : 'absence retirée'}` };
    case 'deleteReservation':
      return { ligne: `${dossierDe(l)} supprimée` };
    case 'restoreReservation':
      return { ligne: `${dossierDe(l)} restaurée` };
    case 'moveReservationActivity':
      return { ligne: `${dossierDe(l)} : une activité déplacée` };
    case 'delayApply': {
      const n = Array.isArray(l.dossiers) ? l.dossiers.length : 0;
      return { ligne: `retard de ${Number(l.retard) || 0} min appliqué${n ? ` (${n} réservation${n > 1 ? 's' : ''}, dont le n° ${l.entity_id})` : ''}` };
    }
    case 'delayRevert':
      return { ligne: `retard annulé, ${dossierDe(l)}` };
    case 'delayClear':
      return { ligne: `retard retiré, ${dossierDe(l)}` };
    case 'setReservationActivityProgress':
      return { compte: 'etape' };
    case 'ajouterNoteEquipe':
    case 'modifierNoteEquipe':
    case 'retirerNoteEquipe':
      return { compte: 'note' };
    case 'saveCustomerNote':
      return { compte: 'noteClient' };
    case 'customRequestNote':
      return { compte: 'noteDemande' };
    default:
      break;
  }
  if (/FormuleSurMesure$/.test(l.action)) return { ligne: 'formule sur mesure changée' };
  const phrase = PHRASES[l.action];
  if (phrase) {
    // Un identifiant fait de chiffres ne mene nulle part (une campagne, un blocage,
    // une demande) : il ne s ecrit plus. Un mot (une formule, un role) dit quoi.
    const quoi = l.entity_id && !/^\d+$/.test(String(l.entity_id)) && !['center', 'ops_action'].includes(l.entity_type) ? ` (${String(l.entity_id).slice(0, 40)})` : '';
    if (l.entity_type === 'custom_request') return { ligne: phrase };
    return { ligne: `${phrase}${quoi}` };
  }
  return { ligne: `action « ${String(l.action).slice(0, 60)} » (la garde ne la connaît pas encore)` };
}

const auteur = (l) => String(l.actor_label || (l.actor_kind === 'public' ? 'client' : 'quelqu’un')).replace(/\s+/g, ' ').trim().slice(0, 40);

function messageModifications(lignes) {
  const avecLigne = [];
  const comptes = {};
  for (const l of lignes) {
    const c = classer(l);
    if (c.ligne) avecLigne.push({ l, texte: c.ligne });
    else if (c.compte) comptes[c.compte] = (comptes[c.compte] || 0) + 1;
  }
  if (!avecLigne.length) return null;
  const debut = heure(avecLigne[0].l.occurred_at);
  const fin = heure(avecLigne[avecLigne.length - 1].l.occurred_at);
  const parCentre = new Map();
  for (const x of avecLigne.slice(0, LIGNES_MAX_MESSAGE)) {
    const centre = x.l.center_id === 'all' ? 'Plateforme' : nomDuCentre(x.l.center_id);
    if (!parCentre.has(centre)) parCentre.set(centre, []);
    parCentre.get(centre).push(`${heure(x.l.occurred_at)} ${auteur(x.l)} : ${x.texte}`);
  }
  const corps = [`Modifications, ${debut === fin ? debut : `${debut} à ${fin}`}`];
  for (const [centre, ls] of parCentre) corps.push(centre, ...ls);
  if (avecLigne.length > LIGNES_MAX_MESSAGE) corps.push(`Et ${avecLigne.length - LIGNES_MAX_MESSAGE} autres, dans la Tour de contrôle.`);
  const aussi = Object.entries(comptes).map(([k, n]) => `${n} ${COMPTES[k][n > 1 ? 1 : 0]}`);
  if (aussi.length) corps.push(`Aussi : ${aussi.join(', ')}.`);
  return corps.join('\n');
}

const COLONNES = `a.id, a.center_id, a.occurred_at, a.actor_kind, coalesce(a.actor_label, '') as actor_label,
       a.action, coalesce(a.entity_type, '') as entity_type, coalesce(a.entity_id, '') as entity_id,
       coalesce(a.context->>'annonce', '') as annonce,
       a.context->'delayMinutes' as retard, a.context->'dossiers' as dossiers,
       jsonb_build_object('date', a.changes->'date', 'startTime', a.changes->'startTime', 'pax', a.changes->'pax',
         'price', a.changes->'price', 'status', a.changes->'status', 'amountPaid', a.changes->'amountPaid',
         'discountReason', a.changes->'discountReason', 'absentAt', a.changes->'absentAt') as champs,
       coalesce((select array_agg(k) from jsonb_object_keys(case when jsonb_typeof(a.changes) = 'object' then a.changes else '{}'::jsonb end) k), '{}') as cles,
       jsonb_build_object(
         'date', coalesce(a.context->'registre'->'apres'->>'date', a.context->'registre'->'avant'->>'date'),
         'startTime', coalesce(a.context->'registre'->'apres'->>'startTime', a.context->'registre'->'avant'->>'startTime')) as dossier`;

// Les lignes faites par une personne (staff ou client), reussies.
async function lireLignes(pool, { apresId = null, depuis = null, jusqua = null, limite = LIMITE_LIGNES } = {}) {
  const params = [];
  const where = ["a.outcome = 'success'", "a.actor_kind in ('staff', 'public')"];
  const poser = (v) => { params.push(v); return `$${params.length}`; };
  if (apresId !== null) where.push(`a.id > ${poser(apresId)}`, "a.occurred_at < now() - interval '1 minute'");
  if (depuis) where.push(`a.occurred_at >= ${poser(depuis)}::timestamptz`);
  if (jusqua) where.push(`a.occurred_at < ${poser(jusqua)}::timestamptz`);
  params.push(limite);
  const { rows } = await pool.query(`select ${COLONNES} from audit_log a where ${where.join(' and ')} order by a.id limit $${params.length};`, params);
  return rows.map((r) => ({ ...r, id: Number(r.id), champs: r.champs || {}, dossier: r.dossier || {}, cles: Array.isArray(r.cles) ? r.cles : [] }));
}

async function rattraperAnnonce(pool, l, { env, fetcher, database }) {
  if (['ok', 'essai'].includes(l.annonce)) return { ok: true, rien: true };
  const numero = Number(l.entity_id);
  if (!Number.isInteger(numero) || numero < 1) return { ok: true, rien: true };
  if (l.action === 'createReservation') {
    const db = database || require('./database');
    const { simulationSqlExclusion, isFabricatedReservation } = require('./simulation-filter');
    const ligne = (await pool.query(`select * from reservations where id = $1 and ${simulationSqlExclusion()} limit 1;`, [numero])).rows[0];
    if (!ligne) return { ok: true, rien: true };
    const r = db.mapReservation(ligne);
    if (isFabricatedReservation(r)) return { ok: true, rien: true };
    const par = l.actor_kind === 'staff' ? l.actor_label : '';
    return envoyerTelegram(texteReservation(r, { par, retard: true }), { sujet: 'reservations', env, fetcher });
  }
  const d = (await pool.query('select id, center_id, pax, occasion, requested_date from custom_requests where id = $1 limit 1;', [numero])).rows[0];
  if (!d) return { ok: true, rien: true };
  const demande = { id: Number(d.id), centerId: d.center_id || l.center_id, pax: d.pax, occasion: d.occasion, requestedDate: d.requested_date };
  return envoyerTelegram(texteDemande(demande, { retard: true }), { sujet: 'reservations', env, fetcher, liens: lienDeLaDemande(demande, env) });
}

// Un passage de la garde sur le journal. Rend le nouveau curseur, ou l ancien si un
// message n est pas parti.
async function relireLeJournal(pool, curseur, { env = process.env, fetcher = fetch, database } = {}) {
  if (curseur === null || curseur === undefined || !Number.isFinite(Number(curseur))) {
    // Premier passage : on part de maintenant, l historique ne se rejoue pas.
    const { rows } = await pool.query('select coalesce(max(id), 0)::bigint as dernier from audit_log;');
    return { curseur: Number(rows[0] && rows[0].dernier) || 0, annonces: 0, modifications: 0, envois: [] };
  }
  const lignes = await lireLignes(pool, { apresId: Number(curseur) });
  if (!lignes.length) return { curseur: Number(curseur), annonces: 0, modifications: 0, envois: [] };
  const envois = [];
  let annonces = 0;
  for (const l of lignes.filter((x) => x.action === 'createReservation' || x.action === 'createCustomRequest')) {
    const r = await rattraperAnnonce(pool, l, { env, fetcher, database });
    if (!r.rien) {
      envois.push(r.ok);
      if (r.ok) annonces += 1;
    }
  }
  const texte = messageModifications(lignes);
  let modifications = 0;
  if (texte) {
    const r = await envoyerTelegram(texte, { sujet: 'modifications', env, fetcher });
    envois.push(r.ok);
    if (r.ok) modifications = lignes.filter((l) => classer(l).ligne).length;
  }
  const dernier = lignes[lignes.length - 1].id;
  return { curseur: envois.every(Boolean) ? dernier : Number(curseur), annonces, modifications, envois };
}

module.exports = { classer, decrireModification, lireLignes, messageModifications, relireLeJournal, COMPTES };
