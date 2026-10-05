// CE QUE LA PAGE SECOURS DE LA CONSOLE LIT ET TELECHARGE (2026-10-05).
//
// etatSecours : les adresses de la boite de secours, les derniers envois
// (centers.settings.secoursEtat, ecrit par lib/secours-envoi) et le dernier
// passage de la sauvegarde de la nuit (ops_worker_runs). Rien d invente : ce
// qui n a jamais eu lieu revient vide et l ecran dit « jamais ».
// documentSecours : la feuille papier (PDF), la feuille vierge ou le classeur
// Excel d une journee, construits a la demande avec les memes fonctions que
// les envois.
'use strict';

const { normalizeCenterConfig } = require('./center-config');
const { dependancesReelles } = require('./secours-envoi');

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function etatSecours(pool, centerId, { env = process.env } = {}) {
  const ligne = (await pool.query('select settings from centers where id = $1 limit 1', [centerId])).rows[0];
  const settings = (ligne && ligne.settings) || {};
  const emails = normalizeCenterConfig(settings.config || {}, centerId).secours.emails;
  const etat = settings.secoursEtat && typeof settings.secoursEtat === 'object' ? settings.secoursEtat : {};
  const instants = (cle) => Object.values(etat).map((j) => j && j[cle]).filter(Boolean).sort();
  const derniere = instants('envoyeA').pop() || '';
  const soir = instants('soir').pop() || '';
  let sauvegarde = { configuree: Boolean(env.PINLANE_BACKUP_PASSPHRASE && env.PINLANE_BACKUP_EMAILS) };
  try {
    const run = (await pool.query("select status, started_at, finished_at, result, error from ops_worker_runs where task_name = 'sauvegarde' order by started_at desc limit 1")).rows[0];
    if (run) {
      const r = run.result || {};
      const ignoree = Boolean(r.ignore);
      sauvegarde = {
        ...sauvegarde,
        statut: ignoree ? 'ignoree' : run.status,
        le: (run.finished_at || run.started_at) ? new Date(run.finished_at || run.started_at).toISOString() : '',
        detail: r.tables ? `${r.tables} tables, ${Number(r.lignes || 0).toLocaleString('fr-BE')} lignes, ${(Number(r.octets || 0) / 1024 / 1024).toFixed(1).replace('.', ',')} Mo` : (ignoree ? r.ignore : (run.error || '')),
      };
    }
  } catch (error) { /* releve absent : la sauvegarde se dit « jamais » */ }
  return { ok: true, centerId, emails, envois: { derniere, soir }, sauvegarde };
}

async function documentSecours(pool, { centerId, date, kind = 'feuille', vierge = false, centreNom = '' } = {}) {
  if (!DATE.test(String(date || ''))) throw Object.assign(new Error('Date invalide (AAAA-MM-JJ).'), { statusCode: 400, expose: true });
  const deps = dependancesReelles(pool);
  const formules = deps.formules(centerId);
  const nom = centreNom || ((await pool.query('select name from centers where id = $1', [centerId])).rows[0] || {}).name || centerId;
  if (kind === 'excel') {
    const { construireClasseurJour } = require('./export-excel');
    const journee = await deps.lireJournee(centerId, date);
    return {
      contenu: construireClasseurJour(journee.reservations, { date, centreNom: nom, formules, demandesSurMesure: journee.demandes, genereLe: new Date() }),
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      nom: `reservations-${centerId}-${date}.xlsx`,
    };
  }
  const { construireFeuilleSecours } = require('./feuille-secours');
  const journee = vierge ? { reservations: [] } : await deps.lireJournee(centerId, date);
  return {
    contenu: construireFeuilleSecours(journee.reservations, { date, centreNom: nom, formules, imprimeLe: new Date(), vierge }),
    type: 'application/pdf',
    nom: `feuille${vierge ? '-vierge' : ''}-${centerId}-${date}.pdf`,
  };
}

module.exports = { etatSecours, documentSecours };
