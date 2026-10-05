// LA BOITE DE SECOURS RECOIT LA JOURNEE, TOUTE SEULE (2026-10-05).
//
// Movsar : « si Pinlane crash il faut qu on ait acces par mail ou par fichier
// rempli complete », « des papiers imprimables exactement comme ca, deja tout
// completes », « des excels super bien faits ». Ce module decide QUAND la
// boite de secours du centre (Etablissement > Regles) recoit quoi :
//
//   - la feuille du jour, PDF papier pre-rempli + classeur Excel, a 8 h, 13 h
//     et 17 h (heure belge) ;
//   - entre deux, une version a jour des que la journee change, au plus une
//     fois par quart d heure (le dernier mail recu est toujours le bon) ;
//   - le soir, apres 23 h 30 : le classeur complet du jour et la feuille de
//     demain, pour ouvrir le matin meme si Pinlane ne repond plus.
//
// L envoi passe DIRECTEMENT par Resend, pieces jointes comprises, hors de la
// file des communications : c est un filet, il ne doit pas dependre de ce
// qu il protege. Ce qui a deja ete envoye se retient dans centers.settings
// (cle secoursEtat), a cote de la config sans la toucher.
//
// Tout est injectable (requete, envoi, horloge) : le gate secours-envoi le
// joue sans reseau ni base.
'use strict';

const crypto = require('crypto');
const { destinatairesSecours, mailFeuilleDuJour } = require('./secours-mails');

const MOMENTS = [{ id: '8h', heure: 8 * 60 }, { id: '13h', heure: 13 * 60 }, { id: '17h', heure: 17 * 60 }];
const SOIR_MINUTES = 23 * 60 + 30;
const ECART_MISE_A_JOUR_MS = 15 * 60 * 1000;
const JOURS_GARDES = 4;

// L heure belge, quelle que soit celle du serveur (Vercel tourne en UTC).
function maintenantBelge(instant = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute), etiquette: `${parts.hour}:${parts.minute}` };
}
function lendemain(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// L empreinte de la journee : ce qui changerait la feuille ou le classeur.
function empreinteJournee(reservations) {
  const lignes = (reservations || [])
    .map((r) => [r.id, r.status, r.validationStatus, r.date, r.startTime, r.pax, r.name, r.phone, r.price, r.paymentMethod, r.formuleId, (r.lanes || []).join('.'), r.notes, r.updatedAt].join('|'))
    .sort();
  return crypto.createHash('sha256').update(lignes.join('\n')).digest('hex').slice(0, 16);
}

// CE QU IL FAUT ENVOYER MAINTENANT, a partir de l etat retenu. Pur.
function decider({ maintenant, etat = {}, empreinte = '', instant = Date.now() }) {
  const jour = (etat && etat[maintenant.date]) || {};
  const momentsFaits = jour.moments || {};
  const actions = [];
  const du = MOMENTS.filter((m) => maintenant.minutes >= m.heure && !momentsFaits[m.id]);
  if (du.length) {
    // Plusieurs moments en retard (cron rate) : un seul mail, au nom du dernier.
    actions.push({ type: 'feuille', moment: du[du.length - 1].id, couvre: du.map((m) => m.id) });
  } else if (Object.keys(momentsFaits).length && jour.empreinte && empreinte && empreinte !== jour.empreinte
    && maintenant.minutes < SOIR_MINUTES
    && (!jour.envoyeA || instant - Date.parse(jour.envoyeA) >= ECART_MISE_A_JOUR_MS)) {
    actions.push({ type: 'feuille', moment: 'mise à jour', couvre: [] });
  }
  if (maintenant.minutes >= SOIR_MINUTES && !jour.soir) actions.push({ type: 'soir' });
  return actions;
}

function retenir(etat, date, patch) {
  const suivant = { ...(etat || {}) };
  suivant[date] = { ...(suivant[date] || {}), ...patch, moments: { ...((suivant[date] || {}).moments || {}), ...(patch.moments || {}) } };
  // Seuls les derniers jours restent : l etat ne grossit jamais.
  for (const d of Object.keys(suivant).sort().slice(0, -JOURS_GARDES)) delete suivant[d];
  return suivant;
}

// L ENVOI, pieces jointes comprises. Aucune cle : rien ne part, et on le dit.
async function envoyerResend({ to, subject, html, text, attachments = [], idempotencyKey = '', fetchImpl = fetch, env = process.env }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return { skipped: true, reason: 'RESEND_API_KEY manquant.' };
  const from = env.RESEND_FROM && /@/.test(env.RESEND_FROM) ? env.RESEND_FROM : 'Pinlane secours <onboarding@resend.dev>';
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    body: JSON.stringify({
      from, to, subject, html, text,
      attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.contenu).toString('base64') })),
    }),
  });
  const corps = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((corps && (corps.message || corps.error)) || `Resend ${response.status}`);
  return { id: corps.id || '' };
}

function nomFichier(prefixe, centreId, date, extension) {
  return `${prefixe}-${centreId}-${date}.${extension}`;
}

// UN CENTRE, MAINTENANT. deps : lireJournee(centreId, date) -> { reservations,
// demandes }, lireEtat(centreId), ecrireEtat(centreId, etat), envoyer(mail).
async function traiterCentre(centre, deps, { instant = new Date(), env = process.env } = {}) {
  const destinataires = destinatairesSecours(centre, env);
  if (!destinataires.length) return { centre: centre.id, ignore: 'aucune adresse de secours' };
  const maintenant = maintenantBelge(instant);
  const etat = (await deps.lireEtat(centre.id)) || {};
  const journee = await deps.lireJournee(centre.id, maintenant.date);
  const empreinte = empreinteJournee(journee.reservations);
  const actions = decider({ maintenant, etat, empreinte, instant: instant.getTime() });
  if (!actions.length) return { centre: centre.id, rien: true };

  const { construireFeuilleSecours } = require('./feuille-secours');
  const { construireClasseurJour } = require('./export-excel');
  const formules = deps.formules ? deps.formules(centre.id) : {};
  let nouvelEtat = etat;
  const faits = [];
  for (const action of actions) {
    if (action.type === 'feuille') {
      const pdf = construireFeuilleSecours(journee.reservations, { date: maintenant.date, centreNom: centre.name, formules, imprimeLe: instant });
      const xlsx = construireClasseurJour(journee.reservations, { date: maintenant.date, centreNom: centre.name, formules, demandesSurMesure: journee.demandes || [], genereLe: instant });
      const mail = mailFeuilleDuJour({ date: maintenant.date, centre, reservations: journee.reservations, moment: action.moment, aJour: maintenant.etiquette });
      await deps.envoyer({
        to: destinataires, subject: mail.subject, html: mail.html, text: mail.text,
        attachments: [
          { filename: nomFichier('feuille', centre.id, maintenant.date, 'pdf'), contenu: pdf },
          { filename: nomFichier('reservations', centre.id, maintenant.date, 'xlsx'), contenu: xlsx },
        ],
        idempotencyKey: `secours:${centre.id}:${maintenant.date}:${action.moment}:${empreinte}`,
      });
      const moments = Object.fromEntries((action.couvre.length ? action.couvre : []).map((id) => [id, instant.toISOString()]));
      nouvelEtat = retenir(nouvelEtat, maintenant.date, { moments, empreinte, envoyeA: instant.toISOString() });
      faits.push(`feuille ${action.moment}`);
    }
    if (action.type === 'soir') {
      const demain = lendemain(maintenant.date);
      const journeeDemain = await deps.lireJournee(centre.id, demain);
      const xlsx = construireClasseurJour(journee.reservations, { date: maintenant.date, centreNom: centre.name, formules, demandesSurMesure: journee.demandes || [], genereLe: instant });
      const pdfDemain = construireFeuilleSecours(journeeDemain.reservations, { date: demain, centreNom: centre.name, formules, imprimeLe: instant });
      const mail = mailFeuilleDuJour({ date: demain, centre, reservations: journeeDemain.reservations, moment: 'pour demain', aJour: maintenant.etiquette });
      await deps.envoyer({
        to: destinataires, subject: mail.subject, html: mail.html, text: mail.text,
        attachments: [
          { filename: nomFichier('feuille', centre.id, demain, 'pdf'), contenu: pdfDemain },
          { filename: nomFichier('reservations', centre.id, maintenant.date, 'xlsx'), contenu: xlsx },
        ],
        idempotencyKey: `secours:${centre.id}:${maintenant.date}:soir`,
      });
      nouvelEtat = retenir(nouvelEtat, maintenant.date, { soir: instant.toISOString() });
      faits.push('soir');
    }
  }
  await deps.ecrireEtat(centre.id, nouvelEtat);
  return { centre: centre.id, faits };
}

// LES DEPENDANCES REELLES : la base de Pinlane et Resend.
function dependancesReelles(pool, { env = process.env } = {}) {
  const db = require('./database');
  return {
    async lireEtat(centreId) {
      const r = await pool.query("select settings -> 'secoursEtat' as etat from centers where id = $1", [centreId]);
      return (r.rows[0] && r.rows[0].etat) || {};
    },
    async ecrireEtat(centreId, etat) {
      await pool.query("update centers set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{secoursEtat}', $2::jsonb, true) where id = $1", [centreId, JSON.stringify(etat)]);
    },
    async lireJournee(centreId, date) {
      const r = await pool.query('select * from reservations where center_id = $1 and date = $2 order by start_time asc, id asc', [centreId, date]);
      const reservations = r.rows.map(db.mapReservation);
      let demandes = [];
      try { demandes = (await db.listCustomRequests({ centerId: centreId, limit: 100 })).filter((d) => String(d.createdAt || '').slice(0, 10) === date || String(d.requestedDate || '').includes(date)); } catch (error) { demandes = []; }
      return { reservations, demandes };
    },
    // Le nom de chaque formule tel que CE centre le vend (surcharges comprises).
    formules(centreId) {
      const { getFormula } = require('./ops-knowledge');
      return new Proxy({}, { get: (_, id) => { try { const f = getFormula(String(id), centreId); return f ? f.name : undefined; } catch (error) { return undefined; } } });
    },
    envoyer: (mail) => envoyerResend({ ...mail, env }),
  };
}

// LE CRON : chaque centre qui a une boite de secours, un a un ; l echec d un
// centre n empeche pas les autres.
async function lancerSecours({ pool, centres, instant = new Date(), env = process.env, deps = null } = {}) {
  const d = deps || dependancesReelles(pool, { env });
  const resultats = [];
  for (const centre of centres) {
    try { resultats.push(await traiterCentre(centre, d, { instant, env })); } catch (error) { resultats.push({ centre: centre.id, erreur: error.message }); }
  }
  return { ok: !resultats.some((r) => r.erreur), resultats };
}

// LA COPIE D UNE RESERVATION, a l instant ou elle nait, change ou s annule.
// Ne leve jamais : la reservation est deja enregistree, une boite de secours
// injoignable ne doit pas la faire echouer ; le motif revient au contexte.
async function copieSecours(reservation, { evenement = 'nouvelle', avant = null, par = '', env = process.env, envoyer = null, centre = null } = {}) {
  try {
    let c = centre;
    if (!c) {
      const { getCenter } = require('./ops-knowledge');
      try { c = getCenter(reservation.centerId || 'libramont'); } catch (error) { c = null; }
    }
    const destinataires = destinatairesSecours(c, env);
    if (!destinataires.length) return { ignore: 'aucune adresse de secours' };
    const { mailCopieReservation } = require('./secours-mails');
    const mail = mailCopieReservation(reservation, { evenement, avant, par, centre: c });
    const cle = crypto.createHash('sha256').update(JSON.stringify([reservation.id, evenement, reservation.updatedAt || '', reservation.status, reservation.startTime, reservation.date, reservation.pax])).digest('hex').slice(0, 16);
    const envoi = envoyer || ((m) => envoyerResend({ ...m, env }));
    return await envoi({ to: destinataires, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: `copie:${reservation.id || 'x'}:${evenement}:${cle}` });
  } catch (error) {
    return { erreur: error.message };
  }
}

// LA COPIE D UNE DEMANDE SUR MESURE, expliquee en entier (contact, groupe,
// activites, budget, message). Meme contrat : ne leve jamais.
async function copieDemandeSecours(lead, { env = process.env, envoyer = null, centre = null } = {}) {
  try {
    let c = centre;
    if (!c) {
      const { getCenter } = require('./ops-knowledge');
      try { c = getCenter(lead.centerId || 'libramont'); } catch (error) { c = null; }
    }
    const destinataires = destinatairesSecours(c, env);
    if (!destinataires.length) return { ignore: 'aucune adresse de secours' };
    const { mailCopieDemandeSurMesure } = require('./secours-mails');
    const mail = mailCopieDemandeSurMesure(lead, { centre: c });
    const envoi = envoyer || ((m) => envoyerResend({ ...m, env }));
    return await envoi({ to: destinataires, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: `demande:${lead.id || crypto.randomUUID()}` });
  } catch (error) {
    return { erreur: error.message };
  }
}

module.exports = {
  copieDemandeSecours,
  copieSecours,
  MOMENTS,
  SOIR_MINUTES,
  decider,
  empreinteJournee,
  envoyerResend,
  lancerSecours,
  maintenantBelge,
  retenir,
  traiterCentre,
};
