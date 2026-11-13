// LES VEILLES DU 2026-11-13 (Ansar : « beaucoup plus d’alertes et bien poussé absolument partout »).
// La surveillance du quart d heure (lib/tour-controle.js, lireProblemes) disait ce qui PLANTE et ce
// qui est ENREGISTRE de travers. Ces veilles regardent ce que personne ne voyait :
//   - une personne de l equipe qui annule ou supprime beaucoup de reservations d un coup ;
//   - un centre ou les reservations en ligne s arretent, alors qu il en arrive d habitude a cette heure ;
//   - une caisse d IA qui approche ou atteint son plafond du mois (lib/llm-budget.js) ;
//   - des travaux programmes (ops_jobs) qui ont echoue pour de bon ;
//   - un centre ouvert en ligne sans aucun jour reservable sur les sept jours a venir ;
//   - des mails de clients restes sans reponse depuis plus de 24 h (email_threads).
// Tout arrive sans sonnerie : aucune n est une panne qui bloque un client a coup sur, la sonnerie
// reste aux pannes. Une veille qui ne se lit pas se tait et le dit au journal du serveur : elle ne
// fabrique jamais un faux probleme. Les requetes ne citent que des colonnes du schema
// (scripts/tour-controle-check.js les y confronte) ; ce qui se calcule mieux en JavaScript (le meme
// jour de la semaine, les plafonds) se calcule ici. Les gestes d Ansar lui-meme (platform-owner)
// ne comptent pas : il sait ce qu il fait.
'use strict';

const T = require('./alertes-texte');
const { simulationSqlExclusion } = require('./simulation-filter');

const FUSEAU = 'Europe/Brussels';
const HEURE_MS = 60 * 60_000;
const JOUR_MS = 24 * HEURE_MS;
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
const jourBelge = (instant) => new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU }).format(new Date(instant));
const heureBelge = (instant) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: FUSEAU, hour: '2-digit', hour12: false }).format(new Date(instant)));
const usd = (n) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} $`;

async function lire(nom, lecture) {
  try {
    return await lecture();
  } catch (error) {
    console.error(`[garde-veilles] ${nom} illisible`, String((error && error.message) || error).slice(0, 200));
    return null;
  }
}

// 1. Cinq annulations ou suppressions ou plus par la meme personne en 30 minutes. Un evenement :
// il se dit une fois, et ne devient pas « Réglé » quand la demi-heure passe.
const SEUIL_ANNULATIONS = 5;
async function annulationsEnMasse(pool, { noms, estGarde, constat }) {
  const rows = await lire('annulations', async () => (await pool.query(`select center_id, coalesce(nullif(actor_label, ''), 'quelqu’un') as qui, count(*)::int as n from audit_log where outcome = 'success' and occurred_at > now() - interval '30 minutes' and (action in ('annulerReservation', 'deleteReservation') or (action = 'setReservationStatus' and changes->'status'->>'after' = 'cancelled')) and coalesce(actor_member_id, '') not like '%:platform-owner%' group by center_id, qui;`)).rows);
  return (rows || []).filter((l) => estGarde(l.center_id) && Number(l.n) >= SEUIL_ANNULATIONS).map((l) => constat({
    cle: `veille:annulations:${l.center_id}:${String(l.qui).slice(0, 40)}`,
    gravite: 'attention',
    centre: l.center_id,
    n: Number(l.n),
    evenement: true,
    quoi: `${noms(l.center_id)} : ${l.qui} a annulé ou supprimé ${l.n} réservations en 30 minutes`,
    effet: 'C’est inhabituel : un grand nettoyage voulu, ou une erreur de manipulation.',
    action: T.faire(`demande à ${l.qui} si c’était voulu ; le détail est dans le fil Modifications.`),
    lien: 'reservations',
  }));
}

// 2. Plus aucune reservation en ligne depuis 3 h, alors que les quatre memes jours de la semaine
// en ont recu au moins douze sur la meme plage (trois par semaine en moyenne). Entre 11 h et 22 h
// seulement : la plage de 3 h reste dans la journee, quand les clients reservent.
const PLAGE_MS = 3 * HEURE_MS;
const SEUIL_HABITUEL = 12;
async function reservationsEnLigneArretees(pool, { noms, estGarde, centres, constat, maintenant }) {
  const heure = heureBelge(maintenant);
  if (heure < 11 || heure >= 22) return [];
  const rows = await lire('réservations en ligne', async () => (await pool.query(`select center_id, created_at from reservations where channel = 'public' and created_at > now() - interval '29 days' and ${simulationSqlExclusion()} limit 5000;`)).rows);
  if (!rows) return [];
  const enLigne = new Set(centres.filter((c) => c.enLigne).map((c) => c.id));
  const parCentre = new Map();
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    const c = parCentre.get(r.center_id) || { recentes: 0, habituelles: 0 };
    if (t > maintenant - PLAGE_MS && t <= maintenant) c.recentes += 1;
    for (let semaine = 1; semaine <= 4; semaine += 1) {
      const fin = maintenant - semaine * 7 * JOUR_MS;
      if (t > fin - PLAGE_MS && t <= fin) c.habituelles += 1;
    }
    parCentre.set(r.center_id, c);
  }
  return [...parCentre.entries()].filter(([id, c]) => estGarde(id) && enLigne.has(id) && c.recentes === 0 && c.habituelles >= SEUIL_HABITUEL).map(([id, c]) => constat({
    cle: `veille:en-ligne-arretee:${id}`,
    gravite: 'attention',
    centre: id,
    quoi: `${noms(id)} : aucune réservation en ligne depuis 3 h`,
    effet: `D’habitude, il en arrive environ ${Math.round(c.habituelles / 4)} sur ces 3 h le même jour de la semaine. Le formulaire marche peut-être mal, ou c’est un jour calme.`,
    action: T.faire(`essaie de réserver sur le site de ${noms(id)} pour vérifier.`),
    passe: `à ${noms(id)}, les réservations en ligne s’étaient arrêtées`,
  }));
}

// 3. Les caisses d IA (lib/llm-budget.js, PLAFONDS) : a 80 % du plafond, puis au plafond. Une seule
// cle par caisse ; `n` porte le palier (1, puis 4) pour que le plafond atteint se redise une fois.
const CAISSES = [['commun', 'des agents marketing'], ['mails', 'de l’aide aux mails'], ['assistant', 'de l’assistant de la console'], ['garde', 'du bilan du matin']];
async function budgetsIA(pool, { constat, maintenant }) {
  const mois = new Date(maintenant).toISOString().slice(0, 7);
  const cleDe = (poste) => (poste === 'commun' ? mois : `${mois}:${poste}`);
  const rows = await lire('dépense IA', async () => (await pool.query('select month, cost_usd::float as cout from llm_spend where month = any($1::text[]);', [CAISSES.map(([p]) => cleDe(p))])).rows);
  if (!rows) return [];
  const { monthlyBudgetUsd } = require('./llm-budget');
  const out = [];
  for (const [poste, nom] of CAISSES) {
    const cout = Number((rows.find((r) => r.month === cleDe(poste)) || {}).cout) || 0;
    const plafond = monthlyBudgetUsd(poste);
    if (!(plafond > 0) || cout < 0.8 * plafond) continue;
    const plein = cout >= plafond;
    out.push(constat({
      cle: `veille:budget-ia:${poste}`,
      gravite: 'attention',
      n: plein ? 4 : 1,
      quoi: `Pinlane : la dépense IA ${nom} ${plein ? 'a atteint' : 'approche'} son plafond du mois`,
      effet: `${usd(cout)} dépensés sur ${usd(plafond)}. ${plein ? 'Cette IA ne répond plus jusqu’au 1er du mois prochain.' : 'Au plafond, cette IA ne répondra plus jusqu’au 1er du mois prochain.'}`,
      action: plein ? T.faire('si tu en as besoin avant, fais relever ce plafond dans les réglages de Vercel.') : T.rienAFaire('un autre message te le dira si le plafond est atteint.'),
      lien: 'ia',
      passe: `la dépense IA ${nom} approchait son plafond du mois`,
    }));
  }
  return out;
}

// 4. Les travaux programmes (ops_jobs) passes en echec, apres tous leurs essais, dans les 24 h.
async function travauxRates(pool, { noms, estGarde, constat }) {
  const rows = await lire('travaux programmés', async () => (await pool.query("select center_id, count(*)::int as n from ops_jobs where status = 'failed' and updated_at > now() - interval '24 hours' group by center_id;")).rows);
  return (rows || []).filter((l) => estGarde(l.center_id) && Number(l.n) > 0).map((l) => constat({
    cle: `veille:travaux-rates:${l.center_id}`,
    gravite: 'attention',
    centre: l.center_id,
    n: Number(l.n),
    quoi: `${noms(l.center_id)} : ${pluriel(Number(l.n), 'travail programmé a échoué', 'travaux programmés ont échoué')} en 24 h, après tous leurs essais`,
    effet: 'Ce sont des mails de suivi, des rappels ou des préparations faites en fond : ils ne se referont pas seuls.',
    action: T.faire('demande une réparation, le détail technique est gardé dans la Tour de contrôle.'),
    passe: `à ${noms(l.center_id)}, des travaux programmés avaient échoué`,
  }));
}

// 5. Un centre ouvert en ligne sans aucun jour reservable sur les sept jours a venir : ses horaires
// (lib/booking-config.js, getSchedule, avec le reglage de la console) ferment chaque jour. Le
// reglage se relit en base une fois par passage ; s il ne se lit pas, le fichier fait foi, et les
// jours y sont ouverts : la veille se tait.
async function sansJourReservable(pool, { centres, constat, maintenant }) {
  const ouverts = centres.filter((c) => c.garde && c.enLigne);
  if (!ouverts.length) return [];
  try { await require('./ops-knowledge').refreshCenterOverrides(pool, { force: true }); } catch (error) { /* socle fichier */ }
  const { getSchedule } = require('./booking-config');
  const { getCenter } = require('./ops-knowledge');
  const jours = Array.from({ length: 7 }, (_, i) => jourBelge(maintenant + i * JOUR_MS));
  return ouverts.filter((c) => {
    const centre = getCenter(c.id);
    return centre && centre.id === c.id && jours.every((j) => !getSchedule(j, centre));
  }).map((c) => constat({
    cle: `veille:sans-jour:${c.id}`,
    gravite: 'attention',
    centre: c.id,
    quoi: `${c.nom} : aucun jour n’est ouvert à la réservation sur les 7 prochains jours`,
    effet: 'Le formulaire en ligne ne propose aucune heure : les clients ne peuvent pas réserver.',
    action: T.faire(`vérifie les horaires de ${c.nom} dans Établissement.`),
    lien: 'horaires',
    passe: `${c.nom} n’avait aucun jour ouvert sur les 7 jours suivants`,
  }));
}

// 6. Les mails de clients sans reponse depuis plus de 24 h (le dernier mot est au client), sur les
// 14 derniers jours : un vieux fil jamais classe ne revient pas tous les jours.
async function mailsSansReponse(pool, { noms, estGarde, constat }) {
  const rows = await lire('mails sans réponse', async () => (await pool.query("select center_id, count(*)::int as n from email_threads where status = 'open' and last_inbound_at < now() - interval '24 hours' and last_inbound_at > now() - interval '14 days' and (last_outbound_at is null or last_outbound_at < last_inbound_at) group by center_id;")).rows);
  return (rows || []).filter((l) => estGarde(l.center_id) && Number(l.n) > 0).map((l) => constat({
    cle: `veille:mails-sans-reponse:${l.center_id}`,
    gravite: 'attention',
    centre: l.center_id,
    n: Number(l.n),
    quoi: `${noms(l.center_id)} : ${pluriel(Number(l.n), 'mail de client attend', 'mails de clients attendent')} une réponse depuis plus de 24 h`,
    effet: 'Sans réponse, le client risque de réserver ailleurs.',
    action: T.faire(`préviens l’équipe de ${noms(l.center_id)}, les mails sont dans la page Mails.`),
    lien: 'mails',
    passe: `à ${noms(l.center_id)}, des mails de clients attendaient une réponse`,
  }));
}

async function constatsDesVeilles(pool, { noms, estGarde, centres = [], constat, maintenant = Date.now() }) {
  const ctx = { noms, estGarde, centres, constat, maintenant };
  const parts = [
    await annulationsEnMasse(pool, ctx),
    await reservationsEnLigneArretees(pool, ctx),
    await budgetsIA(pool, ctx),
    await travauxRates(pool, ctx),
    await sansJourReservable(pool, ctx),
    await mailsSansReponse(pool, ctx),
  ];
  return parts.flat();
}

module.exports = { CAISSES, SEUIL_ANNULATIONS, SEUIL_HABITUEL, constatsDesVeilles };
