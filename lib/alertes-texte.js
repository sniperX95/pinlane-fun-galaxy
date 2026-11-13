// LES ALERTES EN FRANCAIS SIMPLE (2026-11-13, Ansar : « retravaille toutes les alertes que je
// reçois [...] c'est pas clair, j'comprends rien, faut français simple et tout clair »).
//
// Un seul gabarit pour tout ce qui part sur Telegram, ecrit pour un patron qui n est pas
// technicien :
//   ligne 1 : ce qui se passe, avec le centre, en mots de tous les jours ;
//   ligne 2 : ce que ca change pour les clients ou pour l equipe ;
//   ligne 3 : « Ce que tu fais : ... », ou « Rien à faire : ... » quand ca se regle seul ou
//             quand c est a l equipe de le faire ;
//   ligne 4, si elle sert : le texte d un lien vers la bonne page de la console (l adresse
//             part dans le lien Telegram, jamais dans le texte).
// Un probleme regle : « Réglé : <la meme chose au passe>, depuis HH:MM. ».
//
// controlerTexte est le controle du gate test:alertes-lisibles (scripts/alertes-lisibles-check.js) :
// un mot technique, un identifiant interne, un nom de fichier, une empreinte, un tiret long, une
// apostrophe droite, un emoji, une donnee personnelle, un message sans sa ligne « ce que tu fais »
// ou trop long. Il ne bloque jamais un envoi en prod : une alerte part toujours.
'use strict';

const FUSEAU = 'Europe/Brussels';

const heureBelge = (instant = Date.now()) => new Intl.DateTimeFormat('fr-BE', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(instant));

function adresseDeLaConsole(env = process.env) {
  return String(env.PUBLIC_APP_URL || 'https://app.pinlane.be').trim().replace(/\/$/, '');
}

// Les pages de la console ou une alerte mene. Le proprietaire voit tous les centres depuis la
// Tour de controle et la page des plantages ; une reservation et une demande s ouvrent par leur lien.
// Les textes reprennent les noms du menu de la console (assets/staff-menu.js).
const PAGES = {
  tour: { chemin: '/#/staff/cockpit-tour', texte: 'Ouvrir la Tour de contrôle' },
  plantages: { chemin: '/#/staff/cockpit-incidents', texte: 'Ouvrir les Incidents' },
  demandes: { chemin: '/#/staff/requests', texte: 'Ouvrir les Demandes sur mesure' },
  mails: { chemin: '/#/staff/emails', texte: 'Ouvrir les Mails' },
  planning: { chemin: '/#/staff/planning', texte: 'Ouvrir le planning' },
  reservations: { chemin: '/#/staff/reservations', texte: 'Ouvrir les Réservations' },
  equipe: { chemin: '/#/staff/users', texte: 'Ouvrir Équipe & accès' },
  secours: { chemin: '/#/staff/secours', texte: 'Ouvrir la page Secours' },
  horaires: { chemin: '/#/staff/establishment', texte: 'Ouvrir Établissement' },
  ia: { chemin: '/#/staff/cockpit-agents', texte: 'Ouvrir Agents IA' },
};
function lienVers(page, env = process.env) {
  const p = PAGES[page];
  return p ? { texte: p.texte, url: `${adresseDeLaConsole(env)}${p.chemin}` } : null;
}

// OU UNE PANNE INTERNE S EST PRODUITE, EN MOTS DE TOUS LES JOURS. Une panne du code s enregistre
// sous le nom de son point d entree (lib/garde-serveur.js) : Ansar lit le geste qui a rate.
const LIEUX = {
  'api/ops': 'dans la console',
  'api/staff-reservations': 'en enregistrant une réservation au comptoir',
  'api/staff-reservations:lot': 'en changeant plusieurs réservations d’un coup',
  'api/staff-auth': 'à la connexion de l’équipe',
  'api/staff-state': 'en affichant le planning',
  'api/admin-range': 'en affichant le planning de plusieurs jours',
  'api/staff-customer-notes': 'en enregistrant une note sur un client',
  'api/u': 'quand un client se désinscrit des mails',
  'api/public-availability': 'en cherchant les heures libres du formulaire en ligne',
  'api/public-booking-meta': 'en ouvrant le formulaire en ligne',
  'api/public-reservations': 'en enregistrant une réservation en ligne',
  'api/pilot-lead': 'sur la demande de démonstration du site de Pinlane',
  'api/inbound-email': 'à l’arrivée des mails des clients',
  'api/assistant': 'dans l’assistant',
};
const TACHES_LISIBLES = {
  'dispatch-communications': 'pendant l’envoi des mails en attente',
  'ops-jobs': 'pendant le travail programmé du matin',
  secours: 'pendant l’envoi du planning de secours',
  sauvegarde: 'pendant la sauvegarde de la nuit',
  'agent-orchestrator': 'pendant le passage des agents marketing',
  garde: 'pendant la surveillance du quart d’heure',
};
function lieuLisible(surface) {
  const s = String(surface || '').replace(/^serveur:/, '');
  if (LIEUX[s]) return LIEUX[s];
  const tache = s.match(/^api\/cron:(.+)$/);
  if (tache) return TACHES_LISIBLES[tache[1]] || 'pendant une tâche automatique';
  return 'dans Pinlane';
}

// La cause d une panne, en une phrase, sans le message technique (qui reste dans les Incidents).
function causeLisible(message) {
  const m = String(message || '');
  if (/data transfer quota|compute time quota|exceeded the (?:data transfer|compute)/i.test(m)) return 'Les données de Pinlane ont atteint la limite de leur abonnement.';
  if (/quota|rate limit|too many requests|\b429\b|budget/i.test(m)) return 'Un service extérieur a atteint sa limite pour l’instant.';
  if (/read-only|25006/i.test(m)) return 'Les données de Pinlane se lisent mais ne s’enregistrent plus.';
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|timeout|terminated|too many (?:clients|connections)|57P0\d|53300/i.test(m)) return 'Les données de Pinlane n’ont pas répondu à temps.';
  if (/does not exist|column|relation|syntax error|42P01|42703|42601|is not a function|is not defined|Cannot read/i.test(m)) return 'Un défaut dans le code de Pinlane.';
  if (/Telegram|Resend|fetch failed|socket hang up|5\d\d/i.test(m)) return 'Un service extérieur n’a pas répondu.';
  return 'Cause pas encore connue.';
}

// La page de la console ou une erreur s est produite, par son nom dans le menu.
const PAGES_DU_MENU = {
  dashboard: 'Tableau de bord', planning: 'Planning', reservations: 'Réservations', formules: 'Formules', arrivals: 'Terrain',
  clients: 'Clients', requests: 'Demandes sur mesure', groups: 'Groupes', contacts: 'Contacts', lanes: 'Pistes bowling',
  prices: 'Tarifs & formules', lasergame: 'Laser Game', emails: 'Mails', campaigns: 'Marketing', establishment: 'Établissement',
  secours: 'Secours', users: 'Équipe & accès', settings: 'Réglages',
};
function pageLisible(page) {
  const p = String(page || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (PAGES_DU_MENU[p]) return PAGES_DU_MENU[p];
  return /^cockpit/.test(p) ? 'Plateforme' : '';
}

const phrase = (t) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const x = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?…:]$/.test(x) ? x : `${x}.`;
};
// La ligne d action garde la casse de l appelant (« Ce que tu fais : appelle Gembloux. ») et finit par un point.
const fin = (t) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return /[.!?…]$/.test(s) ? s : `${s}.`; };
const faire = (t) => `Ce que tu fais : ${fin(t)}`;
const rienAFaire = (t) => `Rien à faire : ${fin(t)}`;

// Un bloc du gabarit. `quoi` porte deja le centre (« Gembloux : ... »). `action` est une ligne
// faite par faire() ou rienAFaire(). Rend { texte, liens }.
function bloc({ quoi, effet = '', action, lien = null }) {
  const lignes = [phrase(quoi), phrase(effet), action || '', lien && lien.texte ? lien.texte : ''].filter(Boolean);
  return { texte: lignes.join('\n'), liens: lien && lien.texte && lien.url ? [lien] : [] };
}

// Plusieurs blocs dans un message : separes par une ligne vide, chacun avec ses liens.
function assembler(blocs) {
  const liste = blocs.filter((b) => b && b.texte);
  return { texte: liste.map((b) => b.texte).join('\n\n'), liens: liste.flatMap((b) => b.liens || []) };
}

// « Réglé : <la meme chose au passe>, depuis HH:MM. »
function regle(passe, instant = Date.now()) {
  const p = String(passe || '').replace(/\s+/g, ' ').trim().replace(/[.]$/, '');
  return `Réglé : ${p}, depuis ${heureBelge(instant)}.`;
}

// ---------------------------------------------------------------------------
// LE CONTROLE (gate test:alertes-lisibles)
// ---------------------------------------------------------------------------

const INTERDITS = [
  [/\bserveurs?\b/i, 'serveur'],
  [/\broutes?\b/i, 'route'],
  [/\bapi\b/i, 'api'],
  [/\bcrons?\b/i, 'cron'],
  [/\bwebhooks?\b/i, 'webhook'],
  [/\bsondes?\b/i, 'sonde'],
  [/\bops[-_ ]?jobs?\b/i, 'ops-jobs'],
  [/\bdispatch/i, 'dispatch'],
  [/\bplantage\s+(?:[0-9a-f]{3,}|sans empreinte)\b/i, 'plantage <code>'],
  [/\bempreintes?\b/i, 'empreinte'],
  [/\b[A-Z][A-Za-z]*Error\b/, 'TypeError'],
  [/\btime-?outs?\b/i, 'timeout'],
  [/\bchef de garde\b/i, 'chef de garde'],
  [/\bbase de données\b/i, 'base de données'],
  [/\bSQL(?:STATE)?\b/, 'SQL'],
  [/\bE[A-Z]{4,}\b/, 'code d’erreur du système'],
  [/\b(?:HTTP|erreur|code|statut|status)\s*[1-5]\d\d\b/i, 'code HTTP'],
  [/\b(?:Resend|Neon|Postgres|Railway|Cloudflare|JSON|null|undefined|stack|payload|token|bot)\b/i, 'nom technique'],
  [/\b(?:failed|queued|pending|bounced|complained|delivered|processing)\b/i, 'mot anglais du code'],
  [/\b[\w-]+\.(?:js|mjs|cjs|json|sql|html|css|ts)\b/i, 'nom de fichier'],
  [/(?:^|[\s(])\/?[a-z][a-z-]*\/[a-z][a-z-]+/i, 'chemin'],
  [/https?:\/\//i, 'adresse en clair'],
  [/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/, 'identifiant interne'],
  [/\b[a-z]+_[a-z0-9_]+\b/, 'identifiant interne'],
  [/\b[a-z]+[A-Z][A-Za-z]+\b/, 'identifiant interne'],
  [/\b[a-z]{3,}\.[a-z][a-zA-Z]{2,}\b/, 'droit ou identifiant interne'],
  [/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{6,}\b/i, 'empreinte'],
  [/\b(?:URGENT|PANNE|RETOUR|SAUVEGARDE|GARDE)\s+Pinlane\b/, 'ancien en-tête'],
];
const PERSONNEL = [
  [/@/, 'adresse e-mail'],
  [/(?:\+\d{2}\s?\d|\b0\d{2,3}[\s.]?\d{2})[\d\s.]{5,}/, 'numéro de téléphone'],
];
const LIGNE_ACTION = /^(?:Ce que tu fais|Rien à faire) : \S/;
const LIGNE_QUOI = /^[^:\n]{2,60} : \S.*[.!?…]$/;

// Les limites, par genre de message.
const LIMITES = {
  alerte: { lignesParBloc: 4, caracteresParBloc: 520, caracteresParLigne: 280, total: 3500 },
  annonce: { lignesParBloc: 5, caracteresParBloc: 400, caracteresParLigne: 200, total: 600 },
  regle: { caracteresParLigne: 280, total: 3500 },
  releve: { caracteresParLigne: 240, total: 3500 },
  bilan: { lignes: 32, caracteresParLigne: 320, total: 2600 },
  presentation: { lignes: 4, caracteresParLigne: 420, total: 900 },
};

// Rend la liste des fautes, vide si le texte passe. `genre` : alerte, annonce, regle, releve,
// bilan, presentation. Un message de plusieurs blocs se juge bloc par bloc.
function controlerTexte(texte, { genre = 'alerte' } = {}) {
  const t = String(texte || '');
  const fautes = [];
  const lim = LIMITES[genre] || LIMITES.alerte;
  if (!t.trim()) return ['message vide'];
  for (const [motif, nom] of [...INTERDITS, ...PERSONNEL]) {
    const m = t.match(motif);
    if (m) fautes.push(`${nom} (« ${m[0].trim().slice(0, 40)} »)`);
  }
  if (new RegExp('[\\u2013\\u2014]').test(t)) fautes.push('tiret long');
  if (/'/.test(t)) fautes.push('apostrophe droite');
  if (/\p{Extended_Pictographic}/u.test(t)) fautes.push('emoji');
  if (t.length > lim.total) fautes.push(`trop long (${t.length} caractères, ${lim.total} au plus)`);
  const lignes = t.split('\n');
  const longue = lignes.find((l) => l.length > lim.caracteresParLigne);
  if (longue) fautes.push(`ligne trop longue (${longue.length} caractères) : « ${longue.slice(0, 50)}… »`);
  if (genre === 'alerte' || genre === 'annonce') {
    for (const b of t.split(/\n\s*\n/)) {
      const ls = b.split('\n').filter((l) => l.trim());
      if (!ls.length) continue;
      if (ls.length > lim.lignesParBloc) fautes.push(`bloc de ${ls.length} lignes (${lim.lignesParBloc} au plus) : « ${ls[0].slice(0, 50)} »`);
      if (b.length > lim.caracteresParBloc) fautes.push(`bloc trop long (${b.length} caractères) : « ${ls[0].slice(0, 50)} »`);
      if (!LIGNE_QUOI.test(ls[0])) fautes.push(`première ligne sans « Centre : ce qui se passe. » : « ${ls[0].slice(0, 60)} »`);
      const actions = ls.filter((l) => LIGNE_ACTION.test(l));
      if (actions.length !== 1) fautes.push(`${actions.length ? 'plusieurs lignes' : 'aucune ligne'} « Ce que tu fais » ou « Rien à faire » : « ${ls[0].slice(0, 50)} »`);
      else if (ls.indexOf(actions[0]) > 2) fautes.push(`la ligne « ce que tu fais » arrive trop tard : « ${ls[0].slice(0, 50)} »`);
    }
  } else if (genre === 'regle') {
    for (const l of lignes.filter((x) => x.trim())) if (!/^Réglé : \S.*, depuis \d{2}:\d{2}\.$/.test(l)) fautes.push(`ligne de « Réglé » mal formée : « ${l.slice(0, 60)} »`);
  } else {
    if (lim.lignes && lignes.length > lim.lignes) fautes.push(`${lignes.length} lignes (${lim.lignes} au plus)`);
    if (!lignes.some((l) => LIGNE_ACTION.test(l))) fautes.push('aucune ligne « Ce que tu fais » ou « Rien à faire »');
  }
  return fautes;
}

// Le premier mot interdit d un texte, ou null : pour qui recoit un titre ecrit ailleurs (un probleme
// retenu par une version d avant) et doit le taire plutot que le recopier.
function motInterdit(texte) {
  const t = String(texte || '');
  const trouve = [...INTERDITS, ...PERSONNEL].find(([motif]) => motif.test(t));
  return trouve ? trouve[1] : null;
}

module.exports = { PAGES, adresseDeLaConsole, assembler, bloc, causeLisible, controlerTexte, faire, heureBelge, lienVers, lieuLisible, motInterdit, pageLisible, phrase, regle, rienAFaire };
