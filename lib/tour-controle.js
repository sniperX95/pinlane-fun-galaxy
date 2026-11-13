// LA TOUR DE CONTROLE (Ansar, 2026-11-05 : « un endroit ou jpeux voir toutes les
// reservations [...] avec tout info si ya eu des bugs [...] un gros outils de check
// [...] dont moi seul aura acces »).
//
// Ce module LIT, il ne change rien. Trois lectures, derriere platform.admin
// (api/ops.js) :
//   lireTour             : toutes les reservations de tous les centres, ce qui ne va
//                          pas, l etat de chaque garde ;
//   lireDossierTour      : un dossier en entier, ses mails et son histoire ;
//   lireProblemes        : ce qui ne va pas, partage avec la garde.
//
// Et une tache, lancerGarde, toutes les quinze minutes (api/cron.js) : elle compare
// ce qui ne va pas a ce qu elle a deja dit, et ne parle que quand ca change. La sonde
// (workers/sonde-prod) surveille cette garde de dehors ; la garde surveille la sonde.
//
// CHAQUE LECTURE EST ISOLEE : une section en panne se dit (« mails : illisible ») et
// ne couche pas le reste de la page, le jour ou on en a justement besoin.
'use strict';

const { canalBranche, envoyerTelegram, groupeBranche, lireSujets, destination } = require('./garde-alertes');
const T = require('./alertes-texte');
const { normalizeCenterConfig } = require('./center-config');
const { destinatairesSecours } = require('./secours-mails');
const { simulationSqlExclusion, fabricatedSqlPredicate, demonstrationEmailPattern } = require('./simulation-filter');
const { ordreDe: ordreDesEcrans } = require('./formulaire-etapes');

// Les centres dont on garde les portes. Les autres fiches (centres de demonstration,
// clients a venir) restent lisibles dans la liste et ne sonnent pas.
// LUS EN BASE DEPUIS LE 2026-11-13 : un centre actif est garde, sauf si sa fiche le refuse
// (settings.garde === false, une fiche de demonstration) ; un nouveau client est garde des qu il
// passe actif, sans toucher au code. Cette liste n est plus que le repli quand les centres ne se
// lisent pas.
const CENTRES_GARDES = ['libramont', 'gembloux'];
const gardeEnBase = (l) => l.status === 'active' && !(l.settings && l.settings.garde === false);
let gardesDuPassage = null;
const gardesActuels = () => gardesDuPassage || new Set(CENTRES_GARDES);
const estCentreGarde = (id) => gardesActuels().has(id);

// Ce qui doit tourner, a quelle cadence, et a partir de quand c est un probleme.
// `alerte: false` : visible ici, sans message. Une panne de l agent marketing ne
// touche aucun client.
const TACHES = [
  { id: 'garde', nom: 'La surveillance du quart d’heure', role: 'compare ce qui ne va pas à ce qu’elle a déjà dit, toutes les 15 min', retardMin: 45, alerte: true, effet: 'Plus rien ne surveille les mails, les réservations ratées ni le secours.' },
  { id: 'sonde', nom: 'La surveillance extérieure du site', role: 'essaie les deux centres de dehors toutes les 5 minutes, hébergée ailleurs que le site', retardMin: 45, alerte: true, effet: 'Si le site tombe, personne ne te préviendra.' },
  { id: 'secours', nom: 'Le planning de secours', role: 'envoie la feuille à 8 h, 13 h et 17 h, ses changements, et demain à 23 h 30', retardMin: 45, alerte: true, effet: 'Si Pinlane tombe, l’équipe n’aura pas de feuille à jour pour accueillir les clients.' },
  { id: 'dispatch-communications', nom: 'L’envoi des mails en attente', role: 'reprend toutes les 3 h les mails qui n’ont pas pu partir', retardMin: 240, alerte: true, effet: 'Les mails qui n’ont pas pu partir du premier coup ne sont plus renvoyés.' },
  { id: 'ops-jobs', nom: 'Le travail programmé du matin', role: 'les suivis après visite, les absences à noter, le plan marketing, et libère les blocages expirés', retardMin: 1560, alerte: true, effet: 'Les mails de suivi après la visite et le plan marketing de la semaine ne se préparent plus.' },
  { id: 'sauvegarde', nom: 'La sauvegarde de la nuit', role: 'envoie toutes les données, chiffrées, par mail', retardMin: 1560, alerte: true, effet: 'Sans elle, une panne grave ferait perdre des réservations.' },
  { id: 'agent-orchestrator', nom: 'Les agents marketing', role: 'ne touche aucun client', retardMin: 1560, alerte: false, effet: 'Aucun client n’est touché.' },
];

const FUSEAU = 'Europe/Brussels';
const jourBelge = (instant = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU }).format(instant);
const heureBelge = (instant = new Date()) => new Intl.DateTimeFormat('fr-BE', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit', hour12: false }).format(instant);
const iso = (v) => (v ? new Date(v).toISOString() : '');
const nomCourt = (centre) => {
  const nom = String((centre && centre.name) || (centre && centre.id) || '').trim();
  const fin = nom.split(/\s+/).pop() || '';
  return centre && fin.toLowerCase() === String(centre.id || '').toLowerCase() ? fin : nom;
};
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

// Une section qui casse se dit au lieu de coucher les autres.
async function section(pannes, nom, lire, repli) {
  try {
    return await lire();
  } catch (error) {
    console.error(`[tour-controle] ${nom} illisible`, String((error && error.message) || error).slice(0, 300));
    pannes.push(nom);
    return repli;
  }
}

async function lireCentres(pool, { env = process.env } = {}) {
  const { rows } = await pool.query("select id, name, status, settings from centers where status in ('active', 'planned') order by name;");
  return rows.map((l) => {
    const settings = l.settings || {};
    const config = normalizeCenterConfig(settings.config || {}, l.id);
    const etat = settings.secoursEtat && typeof settings.secoursEtat === 'object' ? settings.secoursEtat : {};
    const envois = Object.values(etat).map((j) => j && j.envoyeA).filter(Boolean).sort();
    return {
      id: l.id,
      nom: nomCourt({ id: l.id, name: l.name }),
      status: l.status,
      garde: gardeEnBase(l),
      formulaireActif: !config.embed || config.embed.actif !== false,
      enLigne: l.status === 'active' && (!config.embed || config.embed.actif !== false),
      secours: { adresses: destinatairesSecours({ secours: config.secours }, env).length, derniere: envois.pop() || '' },
    };
  });
}

async function lireTaches(pool) {
  const ids = TACHES.map((t) => t.id);
  const derniers = (await pool.query(
    `select distinct on (task_name) task_name, status, started_at, finished_at, error
       from ops_worker_runs
      where task_name = any($1::text[]) and started_at > now() - interval '30 days'
      order by task_name, started_at desc;`,
    [ids],
  )).rows;
  const reussis = (await pool.query(
    `select task_name, max(finished_at) as dernier_ok
       from ops_worker_runs
      where task_name = any($1::text[]) and status = 'ok'
      group by task_name;`,
    [ids],
  )).rows;
  return TACHES.map((t) => {
    const d = derniers.find((l) => l.task_name === t.id);
    const r = reussis.find((l) => l.task_name === t.id);
    return { ...t, statut: d ? d.status : '', dernier: d ? iso(d.finished_at || d.started_at) : '', dernierOk: r ? iso(r.dernier_ok) : '', erreur: d && d.status === 'failed' ? String(d.error || '').slice(0, 200) : '' };
  });
}

// Un constat de la garde, au gabarit des alertes (lib/alertes-texte.js) : ce qui se passe avec le
// centre (`quoi`), ce que ca change (`effet`), ce que fait Ansar (`action`), la page qui s ouvre
// (`lien`), et la meme chose au passe pour « Réglé » (`passe`). `titre` et `detail` en derivent,
// pour la Tour de controle, le bilan du matin et le veilleur de reparation.
// `instant` : le probleme est deja dit au moment ou il arrive, par la route qui le voit (un plantage, un
// mail revenu, une reservation ratee, un passage de tache rate). La garde ne le redit pas ; elle le
// redit seulement s il s aggrave.
// `evenement` : quelque chose qui s est passe (des annulations en masse) et ne se « règle » pas ; il
// se dit une fois, se redit s il s aggrave, et n a jamais de ligne « Réglé ».
function constat({ cle, gravite, centre = '', n, quoi, effet = '', action, lien = 'tour', passe = '', instant = false, evenement = false }) {
  const titre = T.phrase(quoi).replace(/[.]$/, '');
  const suite = T.phrase(effet);
  return { cle, gravite, ...(centre ? { centre } : {}), ...(Number.isFinite(n) ? { n } : {}), ...(instant ? { instant: true } : {}), ...(evenement ? { evenement: true } : {}), titre, detail: [suite, action].filter(Boolean).join(' '), quoi: titre, effet: suite, action, lien, passe: passe || titre };
}
// Ce qu Ansar ne repare pas lui-meme.
const REPARER = T.faire('demande une réparation, le détail technique est gardé dans la Tour de contrôle.');
const REPARER_INCIDENTS = T.faire('demande une réparation, le détail technique est gardé dans les Incidents.');
const minuscule = (t) => `${String(t).charAt(0).toLowerCase()}${String(t).slice(1)}`;

function constatsDesTaches(taches, maintenant) {
  const out = [];
  for (const t of taches) {
    if (!t.alerte) continue;
    const age = t.dernierOk ? (maintenant - Date.parse(t.dernierOk)) / 60000 : Infinity;
    if (age > t.retardMin) {
      out.push(constat({ cle: `tache:${t.id}:retard`, gravite: 'critique', quoi: `Pinlane : ${minuscule(t.nom)} est en retard`, effet: `${t.dernierOk ? `Dernière fois réussie il y a ${dureeLisible(age)}.` : 'Jamais réussie à ce jour.'} ${t.effet || ''}`, action: REPARER, passe: `${minuscule(t.nom)} était en retard` }));
    } else if (t.statut === 'failed') {
      out.push(constat({ cle: `tache:${t.id}:echec`, gravite: 'attention', instant: true, quoi: `Pinlane : ${minuscule(t.nom)} a raté son dernier passage`, effet: `${T.causeLisible(t.erreur)} Un nouvel essai se fait au passage suivant.`, action: T.rienAFaire('si le retard dure, un autre message te le dira.'), passe: `${minuscule(t.nom)} avait raté un passage` }));
    }
  }
  return out;
}

function dureeLisible(minutes) {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 2880) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} jours`;
}

async function constatsDesMails(pool, noms) {
  const out = [];
  const echecs = (await pool.query(
    `select center_id, count(*)::int as n, max(created_at) as dernier
       from communications
      where status = 'failed' and channel = 'email' and created_at > now() - interval '48 hours'
        and coalesce(last_error, '') not like 'Adresse en erreur%'
      group by center_id;`,
  )).rows;
  for (const l of echecs) {
    const n = Number(l.n);
    out.push(constat({ cle: `mail:echec:${l.center_id}`, gravite: 'critique', centre: l.center_id, n, quoi: `${noms(l.center_id)} : ${pluriel(n, 'mail n’a pas pu partir', 'mails n’ont pas pu partir')} en 48 h`, effet: n > 1 ? 'Ces clients n’ont peut-être pas leur confirmation.' : 'Ce client n’a peut-être pas sa confirmation.', action: T.faire(`demande à l’équipe de ${noms(l.center_id)} d’appeler, les réservations sont dans la Tour de contrôle.`), passe: `à ${noms(l.center_id)}, des mails ne partaient pas` }));
  }
  const coinces = (await pool.query(
    `select center_id, count(*)::int as n, min(coalesce(scheduled_at, created_at)) as depuis
       from communications
      where status = 'queued' and coalesce(scheduled_at, created_at) < now() - interval '30 minutes'
      group by center_id;`,
  )).rows;
  for (const l of coinces) {
    const n = Number(l.n);
    out.push(constat({ cle: `mail:attente:${l.center_id}`, gravite: 'attention', centre: l.center_id, n, quoi: `${noms(l.center_id)} : ${pluriel(n, 'mail attend', 'mails attendent')} de partir depuis plus de 30 minutes`, effet: 'Le prochain envoi automatique les reprend, au plus tard dans 3 h.', action: T.rienAFaire('ils partent seuls au prochain envoi.'), passe: `à ${noms(l.center_id)}, des mails attendaient de partir` }));
  }
  const rebonds = (await pool.query(
    `select center_id, event_type, count(*)::int as n
       from email_events
      where event_type in ('bounced', 'complained') and occurred_at > now() - interval '48 hours'
      group by center_id, event_type;`,
  )).rows;
  for (const l of rebonds) {
    const n = Number(l.n);
    const nom = noms(l.center_id);
    out.push(l.event_type === 'bounced'
      ? constat({ cle: `mail:${l.event_type}:${l.center_id}`, gravite: 'attention', instant: true, centre: l.center_id, n, quoi: `${nom} : ${pluriel(n, 'mail est revenu', 'mails sont revenus')} en 48 h`, effet: 'L’adresse du client est sans doute fausse : il n’a pas reçu le mail.', action: T.faire(`demande à l’équipe de ${nom} d’appeler, le numéro est dans le dossier.`), passe: `à ${nom}, des mails revenaient` })
      : constat({ cle: `mail:${l.event_type}:${l.center_id}`, gravite: 'attention', instant: true, centre: l.center_id, n, quoi: `${nom} : ${pluriel(n, 'client a classé un mail', 'clients ont classé un mail')} en indésirable en 48 h`, effet: 'Ils ne recevront plus d’offres du centre.', action: T.rienAFaire('c’est leur choix, ils sont retirés des envois.'), passe: `à ${nom}, des clients classaient un mail en indésirable` }));
  }
  return out;
}

// D ou vient un plantage : le navigateur d un client (formulaire), la console d un
// centre, ou le serveur lui-meme (lib/garde-serveur.js, depuis le 2026-11-06).
async function lireErreurs(pool) {
  const { rows } = await pool.query(
    `select center_id, stack_hash, max(message) as message, max(page) as page, count(*)::int as n,
            count(distinct member_id)::int as personnes, max(occurred_at) as dernier,
            case when member_id like 'public:%' then 'client' when member_id like 'serveur:%' then 'serveur' else 'console' end as origine
       from client_errors
      where occurred_at > now() - interval '24 hours' and resolved_at is null
      group by center_id, stack_hash, origine
      order by max(occurred_at) desc
      limit 30;`,
  );
  return rows.map((l) => ({ centre: l.center_id, cle: l.stack_hash, message: l.message, page: l.page, n: l.n, origine: l.origine, chezLeClient: l.origine === 'client', dernier: iso(l.dernier) }));
}

async function lireEssais(pool) {
  const { rows } = await pool.query(
    `select center_id, action, coalesce(denied_reason, '') as raison, count(*)::int as n, max(occurred_at) as dernier
       from audit_log
      where actor_kind = 'public' and entity_type = 'formulaire' and occurred_at > now() - interval '24 hours'
      group by center_id, action, coalesce(denied_reason, '')
      order by max(occurred_at) desc
      limit 40;`,
  );
  return rows.map((l) => ({ centre: l.center_id, action: l.action, raison: l.raison, n: l.n, dernier: iso(l.dernier) }));
}

// Seuil au dela duquel des refus ordinaires deviennent un signal : des clients qui
// repartent sans reservation, ou un reglage qui ferme ce qu il ne devrait pas.
const SEUIL_REFUS_24H = 15;

function constatsDesEssais(essais, noms) {
  const out = [];
  for (const e of essais.filter((x) => x.action === 'reservation.panne')) {
    out.push(constat({ cle: `essai:panne:${e.centre}`, gravite: 'critique', instant: true, centre: e.centre, n: e.n, quoi: `${noms(e.centre)} : ${pluriel(e.n, 'réservation en ligne a échoué', 'réservations en ligne ont échoué')} à cause d’une panne, en 24 h`, effet: 'Les clients ont vu un message d’erreur. Si le centre a une adresse de secours, leur demande y est partie.', action: T.faire(`vérifie avec l’équipe de ${noms(e.centre)} que ces demandes ont bien été saisies.`), passe: `à ${noms(e.centre)}, des réservations en ligne échouaient à cause d’une panne` }));
  }
  const parCentre = new Map();
  for (const e of essais.filter((x) => x.action === 'reservation.refusee')) parCentre.set(e.centre, (parCentre.get(e.centre) || 0) + e.n);
  for (const [centre, n] of parCentre) {
    if (n >= SEUIL_REFUS_24H) out.push(constat({ cle: `essai:refus:${centre}`, gravite: 'attention', centre, n, quoi: `${noms(centre)} : ${n} réservations en ligne refusées en 24 h`, effet: 'Des clients sont allés jusqu’au bout sans pouvoir réserver.', action: T.faire('regarde les motifs dans la Tour de contrôle : horaires déjà pris, ou une règle trop stricte.'), passe: `à ${noms(centre)}, beaucoup de réservations en ligne étaient refusées` }));
  }
  return out;
}

function constatsDesErreurs(erreurs, noms) {
  const fois = (e) => `Vu ${pluriel(e.n, 'fois', 'fois')} en 24 h.`;
  const qui = (e) => (e.centre && e.centre !== 'plateforme' ? noms(e.centre) : 'Pinlane');
  const page = (e) => { const p = T.pageLisible(e.page); return p ? `, page ${p}` : ''; };
  const textes = {
    client: (e) => ({ quoi: `${qui(e)} : le formulaire en ligne a eu une erreur chez un client`, effet: `${fois(e)} Ce client a peut-être abandonné sa réservation.`, action: T.faire('réserve toi-même sur le site pour vérifier que tout passe.'), passe: `à ${qui(e)}, le formulaire en ligne avait une erreur` }),
    serveur: (e) => ({ quoi: `${qui(e)} : une panne s’est produite ${T.lieuLisible(e.page)}`, effet: `${fois(e)} ${T.causeLisible(e.message)}`, action: REPARER_INCIDENTS, passe: `${qui(e) === 'Pinlane' ? '' : `à ${qui(e)}, `}une panne s’était produite ${T.lieuLisible(e.page)}` }),
    console: (e) => ({ quoi: `${qui(e)} : la console a eu une erreur${page(e)}`, effet: `${fois(e)} La page s’est peut-être figée pour la personne qui l’utilisait.`, action: T.rienAFaire('recharger la page suffit en général. Si ça revient, demande une réparation.'), passe: `à ${qui(e)}, la console avait une erreur` }),
  };
  return erreurs.filter((e) => textes[e.origine]).map((e) => constat({
    cle: `erreur:${e.origine}:${e.cle}`,
    instant: true,
    gravite: e.origine === 'console' ? 'attention' : 'critique',
    centre: e.centre,
    n: e.n,
    lien: 'plantages',
    ...textes[e.origine](e),
  }));
}

// LES SUIVIS (2026-11-06) : ce qui attend une reponse du centre. Une reservation a
// valider depuis plus de 2 h, une demande de groupe sans reponse depuis plus de 24 h.
// A regarder, sans sonnerie : la nuit, attendre est normal.
// Les reservations en ligne seulement : c est la que le client attend. Au comptoir,
// « a verifier » est pose par la personne qui force un dossier, elle le voit deja ; et
// les jours demo de Libramont en prod (reservations 1579 a 1640, journal 674) en
// portent six, qui auraient dit chaque jour qu un client attend.
async function constatsDesSuivis(pool, noms) {
  const out = [];
  const aValider = (await pool.query(
    `select center_id, count(*)::int as n
       from reservations
      where validation_status = 'staff_review' and status = 'pending' and channel = 'public' and date >= $1::date
        and created_at < now() - interval '2 hours' and ${simulationSqlExclusion()}
      group by center_id;`,
    [jourBelge()],
  )).rows;
  for (const l of aValider.filter((x) => estCentreGarde(x.center_id) && Number(x.n) > 0)) {
    const n = Number(l.n);
    out.push(constat({ cle: `suivi:a-valider:${l.center_id}`, gravite: 'attention', centre: l.center_id, n, quoi: `${noms(l.center_id)} : ${pluriel(n, 'réservation en ligne attend', 'réservations en ligne attendent')} la validation de l’équipe depuis plus de 2 h`, effet: n > 1 ? 'Ces clients attendent la réponse du centre.' : 'Ce client attend la réponse du centre.', action: T.faire(`préviens l’équipe de ${noms(l.center_id)} de valider dans la console.`), passe: `à ${noms(l.center_id)}, des réservations en ligne attendaient la validation` }));
  }
  const demandes = (await pool.query(
    `select center_id, count(*)::int as n
       from custom_requests
      where status = 'new' and created_at < now() - interval '24 hours'
      group by center_id;`,
  )).rows;
  for (const l of demandes.filter((x) => estCentreGarde(x.center_id) && Number(x.n) > 0)) {
    const n = Number(l.n);
    out.push(constat({ cle: `suivi:demande:${l.center_id}`, gravite: 'attention', centre: l.center_id, n, quoi: `${noms(l.center_id)} : ${pluriel(n, 'demande de groupe attend', 'demandes de groupe attendent')} une réponse depuis plus de 24 h`, effet: 'Le groupe risque de réserver ailleurs.', action: T.faire(`préviens l’équipe de ${noms(l.center_id)}, la demande est dans Demandes sur mesure.`), lien: 'demandes', passe: `à ${noms(l.center_id)}, des demandes de groupe attendaient une réponse` }));
  }
  return out;
}

// LES CHASSEURS D INTEGRITE (2026-11-09, Ansar : « des gardes absolument partout »).
// Les postes d avant disent ce qui PLANTE. Ceux-ci cherchent ce qui est ENREGISTRE de
// travers et que personne ne voit : une reservation en ligne a 0 euro, une reservation
// en ligne sans aucun mail au client, deux reservations de bowling sur la meme piste a
// la meme heure. Tout se dit sans sonnerie : ce sont des choses a relire, pas des pannes.
// Une requete qui echoue ici ne doit JAMAIS sonner en URGENT (une lecture qui leve
// devient un constat critique dans lireProblemes) : chaque controle a son propre filet,
// et un controle illisible se dit une fois, calmement.
// Chaque requete tient sur UNE ligne : le faux pool du gate la reconnait a son texte.
// Le mail : la ligne s ecrit dans la demande de reservation elle-meme, 20 minutes sont
// larges. Un centre qui a coupe « confirmation » ou « demande recue » dans Emails n en
// ecrit pas, et ce n est pas un defaut : il sort du controle.
// La piste : bowling seul, sans formule (une formule porte ses propres fenetres de piste).
// LE FORMULAIRE NE LAISSE PLUS RESERVER (2026-11-10, Ansar : « des gardes [...] a la recherche de
// tout [...] casse »). Depuis le suivi des ecrans (lib/formulaire-etapes.js), on sait combien de
// visites arrivent a l ecran de validation. Dix visites a la validation en 24 heures et pas un
// seul envoi, alors qu aucune reservation en ligne n est arrivee : le bouton final ne marche
// sans doute plus, et ca SONNE. Trente visites commencees et aucune au bout : a regarder, sans
// sonnerie. Une reservation en ligne arrivee dans la meme fenetre prouve que le formulaire
// marche : rien ne se dit. Si cette lecture-la echoue, on ne sait pas : rien ne se dit non plus.
// LES DEUX SEUILS SONT POSES AVANT TOUTE VRAIE VISITE (le suivi date du 10/11) : a regler quand
// une semaine de chiffres existe, dans Direction, « Où les gens s arretent ».
const SEUIL_VALIDATIONS_SANS_ENVOI = 10;
const SEUIL_VISITES_SANS_ENVOI = 30;
// Un jour d essais (l equipe parcourt le formulaire sans envoyer) ne doit pas sonner : la sonnerie
// attend un vrai passage, cinquante visites en 24 heures. En dessous, la meme phrase se dit sans sonnerie.
const SEUIL_VISITES_POUR_SONNER = 50;
async function constatsDIntegrite(pool, noms) {
  const out = [];
  const illisibles = [];
  // Le reglage des centres fait dans la console (arene, horaires), pas celui du fichier : la
  // garde tourne seule (api/cron.js) et ne rechauffait pas la connaissance des centres. Une
  // fois par passage, au premier chasseur qui en a besoin, fail-soft, comme les autres taches
  // planifiees (lib/cron-tasks.js, rechaufferLaConnaissance).
  let centresFrais = false;
  const rafraichirLesCentres = async () => {
    if (centresFrais) return;
    centresFrais = true;
    try { await require('./ops-knowledge').refreshCenterOverrides(pool, { force: true }); } catch (error) { /* socle fichier */ }
  };
  const lire = async (nom, sql, params = []) => {
    try {
      return (await pool.query(sql, params)).rows.filter((x) => estCentreGarde(x.center_id) && Number(x.n) > 0);
    } catch (error) {
      console.error(`[tour-controle] intégrité, ${nom} illisible`, String((error && error.message) || error).slice(0, 300));
      illisibles.push(nom);
      return [];
    }
  };
  for (const l of await lire('prix à zéro', `select center_id, count(*)::int as n from reservations where channel = 'public' and status <> 'cancelled' and price <= 0 and created_at > now() - interval '24 hours' and ${simulationSqlExclusion()} group by center_id;`)) {
    out.push(constat({ cle: `integrite:prix-zero:${l.center_id}`, gravite: 'attention', centre: l.center_id, n: Number(l.n), quoi: `${noms(l.center_id)} : ${pluriel(Number(l.n), 'réservation en ligne est enregistrée', 'réservations en ligne sont enregistrées')} à 0 €`, effet: `${Number(l.n) > 1 ? 'Créées' : 'Créée'} dans les dernières 24 h : le prix n’a pas été calculé, le centre risque de ne pas faire payer.`, action: T.faire(`demande à l’équipe de ${noms(l.center_id)} de corriger le prix dans le planning avant l’arrivée du client.`), passe: `à ${noms(l.center_id)}, des réservations en ligne étaient à 0 €` }));
  }
  for (const l of await lire('sans mail', `select r.center_id, count(*)::int as n from reservations r where r.channel = 'public' and r.email <> '' and r.status <> 'cancelled' and r.created_at < now() - interval '20 minutes' and r.created_at > now() - interval '24 hours' and ${simulationSqlExclusion('r')} and not exists (select 1 from communications c where c.reservation_id = r.id and c.channel = 'email' and c.direction = 'outbound') and not exists (select 1 from center_automation_settings s where s.center_id = r.center_id and (s.settings->'confirmation'->>'enabled' = 'false' or s.settings->'request_received'->>'enabled' = 'false')) group by r.center_id;`)) {
    out.push(constat({ cle: `integrite:sans-mail:${l.center_id}`, gravite: 'attention', centre: l.center_id, n: Number(l.n), quoi: `${noms(l.center_id)} : ${pluriel(Number(l.n), 'réservation en ligne n’a', 'réservations en ligne n’ont')} reçu aucun mail`, effet: `${Number(l.n) > 1 ? 'Créées' : 'Créée'} depuis plus de 20 minutes, sans mail de confirmation : le client ne sait peut-être pas que sa réservation est prise.`, action: T.faire(`demande à l’équipe de ${noms(l.center_id)} d’appeler pour confirmer.`), passe: `à ${noms(l.center_id)}, des réservations en ligne n’avaient reçu aucun mail` }));
  }
  for (const l of await lire('double piste', `select a.center_id, count(*)::int as n from reservations a join reservations b on b.center_id = a.center_id and b.date = a.date and b.id > a.id and b.lanes && a.lanes and (b.date + b.start_time) < (a.date + a.start_time) + a.duration * interval '1 hour' and (a.date + a.start_time) < (b.date + b.start_time) + b.duration * interval '1 hour' where a.date >= $1::date and a.status <> 'cancelled' and b.status <> 'cancelled' and a.type = 'bowling' and b.type = 'bowling' and coalesce(a.formule_id, '') = '' and coalesce(b.formule_id, '') = '' and a.validation_status not in ('rejected', 'draft') and b.validation_status not in ('rejected', 'draft') and ${simulationSqlExclusion('a')} and ${simulationSqlExclusion('b')} group by a.center_id;`, [jourBelge()])) {
    out.push(constat({ cle: `integrite:doublon:${l.center_id}`, gravite: 'attention', centre: l.center_id, n: Number(l.n), quoi: `${noms(l.center_id)} : ${pluriel(Number(l.n), 'double réservation de bowling', 'doubles réservations de bowling')} sur la même piste`, effet: 'Deux groupes à venir ont la même piste à la même heure.', action: T.faire(`demande à l’équipe de ${noms(l.center_id)} de déplacer un des groupes dans le planning avant leur arrivée.`), passe: `à ${noms(l.center_id)}, deux groupes avaient la même piste` }));
  }
  // LE LASER TROP PLEIN (2026-11-10). Le chasseur du dessus ne voit que les pistes de bowling.
  // L arene laser se remplit par ses armes et par les parties qui tournent ensemble (une seule
  // a Libramont, trois a Gembloux) : le moteur refuse le groupe de trop au moment de reserver,
  // mais ce qui est DEJA enregistre n etait relu par personne. Meme regle que le refus
  // (lib/ops-engine.js, surchargesLaser), sur les quatorze jours a venir, avec le reglage de
  // CHAQUE centre. Ni nom ni contact : la lecture ne prend que ce qui place un groupe dans l arene.
  let laser = [];
  try {
    laser = (await pool.query(`select id, center_id, date, start_time, duration, type, pax, formule_id, ops_plan, lanes, status from reservations where status <> 'cancelled' and date >= $1::date and date < $1::date + 14 and (type in ('laser', 'formule') or ops_plan::text like '%laser_arena%') and ${simulationSqlExclusion()};`, [jourBelge()])).rows.filter((x) => estCentreGarde(x.center_id));
  } catch (error) {
    console.error('[tour-controle] intégrité, laser illisible', String((error && error.message) || error).slice(0, 300));
    illisibles.push('laser');
  }
  try {
    if (laser.length) {
      const { mapReservation } = require('./database');
      const { surchargesLaser } = require('./ops-engine');
      const { getCenter } = require('./ops-knowledge');
      await rafraichirLesCentres();
      const parJour = new Map();
      for (const ligne of laser) {
        const r = mapReservation(ligne);
        const cle = `${r.centerId}|${r.date}`;
        if (!parJour.has(cle)) parJour.set(cle, []);
        parJour.get(cle).push(r);
      }
      const parCentre = new Map();
      for (const [cle, liste] of parJour) {
        const [centre, date] = cle.split('|');
        for (const s of surchargesLaser(liste, getCenter(centre))) {
          if (!parCentre.has(centre)) parCentre.set(centre, []);
          parCentre.get(centre).push({ date, ...s });
        }
      }
      for (const [centre, trop] of parCentre) {
        trop.sort((a, b) => `${a.date} ${a.heure}`.localeCompare(`${b.date} ${b.heure}`));
        const dit = (t) => `le ${t.date.slice(8, 10)}/${t.date.slice(5, 7)} à ${t.heure}, ${t.joueurs > t.armes ? `${t.joueurs} joueurs pour ${t.armes} armes` : `${t.parties} parties en même temps pour ${t.partiesMax}`}`;
        out.push(constat({ cle: `integrite:laser:${centre}`, gravite: 'attention', centre, n: trop.length, quoi: `${noms(centre)} : ${pluriel(trop.length, 'départ laser dépasse', 'départs laser dépassent')} ce que l’arène peut prendre`, effet: `Dans les 14 prochains jours : ${trop.slice(0, 3).map(dit).join(' ; ')}${trop.length > 3 ? ' ; et d’autres' : ''}.`, action: T.faire(`demande à l’équipe de ${noms(centre)} de déplacer un groupe dans le planning.`), passe: `à ${noms(centre)}, des départs laser dépassaient ce que l’arène peut prendre` }));
      }
    }
  } catch (error) {
    console.error('[tour-controle] intégrité, laser, calcul illisible', String((error && error.message) || error).slice(0, 300));
    illisibles.push('laser, calcul');
  }
  // LA RESERVATION EN LIGNE SUR UNE FERMETURE (2026-11-10). Poser une fermeture, bloquer une
  // piste, une activite ou une formule (api/ops.js, saveAvailabilityBlock) ne regarde pas les
  // reservations deja prises. Le tunnel refuse ensuite ce creneau, mais le client qui l avait
  // reserve AVANT n est prevenu par personne : il viendra. Memes predicats que le tunnel
  // (lib/availability-blocks.js), sur toute la visite, pas seulement son depart. Les
  // reservations prises au comptoir ne comptent pas : une soiree privatisee pose justement une
  // fermeture autour d un groupe que l equipe a inscrit elle-meme.
  let fermetures = [];
  let enLigneAVenir = [];
  try {
    enLigneAVenir = (await pool.query(`select id, center_id, date, start_time, duration, total_duration, type, formule_id, lanes from reservations where channel = 'public' and status <> 'cancelled' and date >= $1::date and date < $1::date + 14 and ${simulationSqlExclusion()};`, [jourBelge()])).rows.filter((x) => estCentreGarde(x.center_id));
    if (enLigneAVenir.length) fermetures = (await pool.query(`select id, center_id, scope_type, scope_ref, recurrence, date, day_of_week, date_from, date_until, start_time, end_time, reason, created_by from availability_blocks where center_id = any($1::text[]);`, [[...gardesActuels()]])).rows;
  } catch (error) {
    console.error('[tour-controle] intégrité, fermetures illisibles', String((error && error.message) || error).slice(0, 300));
    illisibles.push('réservations en ligne à venir');
  }
  try {
    if (enLigneAVenir.length) {
      const AB = require('./availability-blocks');
      const { mapReservation } = require('./database');
      const blocsDe = new Map();
      for (const b of fermetures.map(AB.normalizeBlockRow)) {
        if (!blocsDe.has(b.centerId)) blocsDe.set(b.centerId, []);
        blocsDe.get(b.centerId).push(b);
      }
      const parCentre = new Map();
      for (const r of enLigneAVenir.map(mapReservation)) {
        const blocs = blocsDe.get(r.centerId) || [];
        const s = AB.timeToMinutes(r.startTime);
        if (s === null || !blocs.length) continue;
        const e = s + Math.round(Math.max(Number(r.totalDuration) || 0, Number(r.duration) || 0, 0.25) * 60);
        let pourquoi = '';
        if (AB.isCenterClosedDuring(blocs, r.date, s, e)) pourquoi = 'centre fermé';
        for (const piste of r.lanes) if (!pourquoi && AB.isLaneBlockedAt(blocs, r.date, piste, s, e)) pourquoi = `piste ${piste} bloquée`;
        const activite = r.type === 'laser' ? 'laser_game' : r.type === 'bowling' ? 'bowling' : '';
        if (!pourquoi && activite && AB.isActivityBlockedAt(blocs, r.date, activite, s, e)) pourquoi = `${r.type === 'laser' ? 'laser' : 'bowling'} bloqué`;
        if (!pourquoi && r.formuleId && AB.isFormulaBlockedOn(blocs, r.date, r.formuleId, s, e)) pourquoi = 'formule bloquée';
        if (!pourquoi) continue;
        if (!parCentre.has(r.centerId)) parCentre.set(r.centerId, []);
        parCentre.get(r.centerId).push({ date: r.date, heure: r.startTime, pourquoi });
      }
      for (const [centre, touchees] of parCentre) {
        touchees.sort((a, b) => `${a.date} ${a.heure}`.localeCompare(`${b.date} ${b.heure}`));
        const dit = (t) => `le ${t.date.slice(8, 10)}/${t.date.slice(5, 7)} à ${t.heure}, ${t.pourquoi}`;
        out.push(constat({ cle: `integrite:fermeture:${centre}`, gravite: 'attention', centre, n: touchees.length, quoi: `${noms(centre)} : ${pluriel(touchees.length, 'réservation en ligne tombe', 'réservations en ligne tombent')} sur une fermeture`, effet: `Dans les 14 prochains jours : ${touchees.slice(0, 3).map(dit).join(' ; ')}${touchees.length > 3 ? ' ; et d’autres' : ''}. Le client n’en sait rien.`, action: T.faire(`demande à l’équipe de ${noms(centre)} d’appeler ces clients ou de les déplacer.`), passe: `à ${noms(centre)}, des réservations en ligne tombaient sur une fermeture` }));
      }
    }
  } catch (error) {
    console.error('[tour-controle] intégrité, fermetures, calcul illisible', String((error && error.message) || error).slice(0, 300));
    illisibles.push('fermetures, calcul');
  }
  // LA RESERVATION EN LIGNE HORS DES HORAIRES (2026-11-10). Un gerant qui change ses horaires (un
  // jour ferme de plus, une ouverture plus tard) ne voit pas les reservations deja prises ce
  // jour-la, et le client n en sait rien. Memes horaires que le tunnel (getSchedule), lus avec
  // les ouvertures exceptionnelles de l equipe (pourLEquipe) : un groupe que l equipe a deplace
  // sur une ouverture exceptionnelle n est pas hors horaires. Seuls les cas sans doute se
  // disent : jour ferme, arrivee avant l ouverture, arrivee a la fermeture ou apres. La fin de
  // la visite ne se juge pas ici, elle depend des formules et de leurs marges.
  try {
    if (enLigneAVenir.length) {
      const { getSchedule, pourLEquipe } = require('./booking-config');
      const { mapReservation } = require('./database');
      const { getCenter } = require('./ops-knowledge');
      const AB = require('./availability-blocks');
      await rafraichirLesCentres();
      const hh = (v) => { const m = Math.round(Number(v) * 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
      const parCentre = new Map();
      for (const r of enLigneAVenir.map(mapReservation)) {
        const s = AB.timeToMinutes(r.startTime);
        if (s === null) continue;
        const h = pourLEquipe(() => getSchedule(r.date, getCenter(r.centerId)));
        let pourquoi = '';
        if (!h) pourquoi = 'le centre est fermé ce jour-là';
        else if (s < Math.round(Number(h.open) * 60)) pourquoi = `le centre ouvre à ${hh(h.open)}`;
        else if (s >= Math.round(Number(h.close) * 60)) pourquoi = `le centre ferme à ${hh(h.close)}`;
        if (!pourquoi) continue;
        if (!parCentre.has(r.centerId)) parCentre.set(r.centerId, []);
        parCentre.get(r.centerId).push({ date: r.date, heure: r.startTime, pourquoi });
      }
      for (const [centre, hors] of parCentre) {
        hors.sort((a, b) => `${a.date} ${a.heure}`.localeCompare(`${b.date} ${b.heure}`));
        const dit = (t) => `le ${t.date.slice(8, 10)}/${t.date.slice(5, 7)} à ${t.heure}, ${t.pourquoi}`;
        out.push(constat({ cle: `integrite:horaires:${centre}`, gravite: 'attention', centre, n: hors.length, quoi: `${noms(centre)} : ${pluriel(hors.length, 'réservation en ligne tombe', 'réservations en ligne tombent')} hors des horaires`, effet: `Dans les 14 prochains jours : ${hors.slice(0, 3).map(dit).join(' ; ')}${hors.length > 3 ? ' ; et d’autres' : ''}. Les horaires ont sans doute changé après la réservation.`, action: T.faire(`demande à l’équipe de ${noms(centre)} d’appeler ces clients ou de les déplacer.`), passe: `à ${noms(centre)}, des réservations en ligne tombaient hors des horaires` }));
      }
    }
  } catch (error) {
    console.error('[tour-controle] intégrité, horaires, calcul illisible', String((error && error.message) || error).slice(0, 300));
    illisibles.push('horaires, calcul');
  }
  const ecrans = ordreDesEcrans('reservation');
  const visites = await lire('formulaire', `select center_id, count(*)::int as n, sum(case when loin >= $2 then 1 else 0 end)::int as valides, sum(case when loin >= $3 then 1 else 0 end)::int as finis from (select center_id, visite, max(array_position($1::text[], etape)) as loin from formulaire_etapes where parcours = 'reservation' and created_at > now() - interval '24 hours' group by center_id, visite) as t group by center_id;`, [ecrans, ecrans.indexOf('recap') + 1, ecrans.length]);
  const arrivees = visites.length ? await lire('réservations en ligne du jour', `select center_id, count(*)::int as n from reservations where channel = 'public' and created_at > now() - interval '24 hours' and ${simulationSqlExclusion()} group by center_id;`) : [];
  const onSait = !illisibles.includes('réservations en ligne du jour');
  for (const v of onSait ? visites : []) {
    if (Number(v.finis) > 0 || arrivees.some((a) => a.center_id === v.center_id)) continue;
    const valides = Number(v.valides) || 0;
    if (valides >= SEUIL_VALIDATIONS_SANS_ENVOI) out.push(constat({ cle: `formulaire:bloque:${v.center_id}`, gravite: Number(v.n) >= SEUIL_VISITES_POUR_SONNER ? 'critique' : 'attention', centre: v.center_id, n: valides, quoi: `${noms(v.center_id)} : le formulaire en ligne ne laisse sans doute plus réserver`, effet: `En 24 heures, ${valides} visites ont atteint la dernière étape, et aucune réservation en ligne n’est arrivée.`, action: T.faire('réserve toi-même sur le site pour vérifier.'), passe: `à ${noms(v.center_id)}, le formulaire en ligne ne laissait plus réserver` }));
    else if (Number(v.n) >= SEUIL_VISITES_SANS_ENVOI) out.push(constat({ cle: `formulaire:personne-au-bout:${v.center_id}`, gravite: 'attention', centre: v.center_id, n: Number(v.n), quoi: `${noms(v.center_id)} : ${Number(v.n)} visites ont commencé le formulaire en ligne, aucune n’est allée au bout`, effet: 'Depuis 24 heures, aucune réservation en ligne n’est arrivée.', action: T.faire('regarde dans Direction, « Où les gens s’arrêtent », à quel écran ils partent.'), passe: `à ${noms(v.center_id)}, les visites du formulaire en ligne n’allaient pas au bout` }));
  }
  if (illisibles.length) out.push(constat({ cle: 'integrite:illisible', gravite: 'attention', quoi: `Pinlane : un contrôle des réservations n’a pas pu se faire (${illisibles.join(', ')})`, effet: 'Il est sauté pour l’instant, rien ne dit qu’il y a un défaut.', action: T.rienAFaire('il réessaie dans 15 minutes.'), passe: 'un contrôle des réservations ne se faisait pas' }));
  return out;
}

function constatsDesCentres(centres) {
  const out = [];
  for (const c of centres.filter((x) => x.garde)) {
    if (!c.enLigne) out.push(constat({ cle: `centre:ferme:${c.id}`, gravite: 'attention', centre: c.id, quoi: `${c.nom} : la réservation en ligne est coupée`, effet: c.formulaireActif ? 'Le centre n’est pas en statut actif : son formulaire refuse toutes les réservations.' : 'L’ancien formulaire du site a repris sa place.', action: T.faire('si ce n’est pas voulu, remets-la depuis la Tour de contrôle.'), passe: `à ${c.nom}, la réservation en ligne était coupée` }));
    if (!c.secours.adresses) out.push(constat({ cle: `secours:sans-adresse:${c.id}`, gravite: 'attention', centre: c.id, quoi: `${c.nom} : aucune adresse de secours`, effet: 'Si Pinlane tombe, l’équipe ne reçoit pas de planning de secours, et une demande reçue pendant la panne serait perdue.', action: T.faire('ajoute une adresse dans la page Secours quand tu veux.'), lien: 'secours', passe: `${c.nom} n’avait aucune adresse de secours` }));
  }
  return out;
}

async function constatsDesEssaisEnBase(pool, noms) {
  const { rows } = await pool.query(
    `select center_id, count(*)::int as n, min(date) as premier
       from reservations
      where ${fabricatedSqlPredicate(1)} and date >= $2::date and status <> 'cancelled'
      group by center_id;`,
    [demonstrationEmailPattern(), jourBelge()],
  );
  return rows.filter((l) => estCentreGarde(l.center_id)).map((l) => constat({
    cle: `base:fabriquees:${l.center_id}`,
    gravite: 'attention',
    centre: l.center_id,
    n: Number(l.n),
    quoi: `${noms(l.center_id)} : ${pluriel(Number(l.n), 'réservation d’essai occupe', 'réservations d’essai occupent')} des places à venir`,
    effet: 'Le planning les compte comme de vraies réservations : ces créneaux ne se vendent pas.',
    action: T.faire('supprime-les du planning si ce sont des essais.'),
    passe: `à ${noms(l.center_id)}, des réservations d’essai occupaient des places`,
  }));
}

const ORDRE = { critique: 0, attention: 1 };
// Sans sonnerie (2026-11-13) : une partie illisible rend la surveillance aveugle sur elle, elle ne bloque
// ni un client ni l equipe. Si toute la base tombe, la surveillance du quart d heure sonne (api/cron.js).
const constatDeLecture = (nom) => constat({ cle: `lecture:${nom}`, gravite: 'attention', quoi: `Pinlane : la Tour de contrôle n’arrive pas à lire une partie de l’état (${nom})`, effet: 'Cette partie n’est pas vérifiée pour l’instant.', action: T.rienAFaire('si ça dure plus d’une heure, demande une réparation.'), passe: `la Tour de contrôle n’arrivait pas à lire une partie de l’état (${nom})` });
async function lireProblemes(pool, { env = process.env, maintenant = Date.now() } = {}) {
  const pannes = [];
  const centres = await section(pannes, 'centres', () => lireCentres(pool, { env }), []);
  // Les centres gardes de ce passage, lus en base ; sans lecture, la liste ecrite fait foi.
  gardesDuPassage = centres.length ? new Set(centres.filter((c) => c.garde).map((c) => c.id)) : null;
  const noms = (id) => (centres.find((c) => c.id === id) || { nom: id }).nom;
  const taches = await section(pannes, 'tâches', () => lireTaches(pool), []);
  const erreurs = await section(pannes, 'erreurs', () => lireErreurs(pool), []);
  const essais = await section(pannes, 'essais', () => lireEssais(pool), []);
  const mails = await section(pannes, 'mails', () => constatsDesMails(pool, noms), []);
  const fabriquees = await section(pannes, 'réservations d’essai', () => constatsDesEssaisEnBase(pool, noms), []);
  const suivis = await section(pannes, 'suivis', () => constatsDesSuivis(pool, noms), []);
  const integrite = await section(pannes, 'intégrité', () => constatsDIntegrite(pool, noms), []);
  const veilles = await section(pannes, 'veilles', () => require('./garde-veilles').constatsDesVeilles(pool, { noms, estGarde: estCentreGarde, centres, constat, maintenant }), []);
  const problemes = [
    ...constatsDesEssais(essais, noms),
    ...constatsDesErreurs(erreurs, noms),
    ...constatsDesCentres(centres),
    ...mails,
    ...constatsDesTaches(taches, maintenant),
    ...fabriquees,
    ...suivis,
    ...integrite,
    ...veilles,
    ...(canalBranche(env) ? [] : [constat({ cle: 'canal:absent', gravite: 'attention', quoi: 'Pinlane : les alertes de l’application ne sont pas branchées sur Telegram', effet: 'Tu ne reçois que les messages de la surveillance extérieure du site.', action: T.faire('ajoute le jeton et la conversation Telegram dans les réglages de l’hébergeur du site.'), passe: 'les alertes de l’application n’étaient pas branchées sur Telegram' })]),
    ...pannes.map(constatDeLecture),
  ].sort((a, b) => ORDRE[a.gravite] - ORDRE[b.gravite]);
  return { problemes, centres, taches, erreurs, essais };
}

const CANAUX = new Set(['public', 'staff']);
const STATUTS = new Set(['pending', 'arrived', 'paid', 'cancelled']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LIMITE = 300;

// Les filtres viennent de l adresse : rien n entre dans la requete que par un parametre,
// et ce qui n est pas reconnu est ignore. Pas de recherche par nom ici : un nom dans une
// adresse finit dans les journaux de Vercel. La recherche se fait dans la page.
function construireFiltres(filtres = {}, instant = new Date()) {
  const params = [];
  const where = [simulationSqlExclusion()];
  const poser = (v) => { params.push(v); return `$${params.length}`; };
  const centre = String(filtres.centre || '').trim().toLowerCase();
  if (/^[a-z0-9-]{1,40}$/.test(centre) && centre !== 'all') where.push(`center_id = ${poser(centre)}`);
  if (CANAUX.has(filtres.canal)) where.push(`channel = ${poser(filtres.canal)}`);
  if (STATUTS.has(filtres.statut)) where.push(`status = ${poser(filtres.statut)}`);
  if (filtres.validation === 'staff_review') where.push("validation_status = 'staff_review'");
  if (DATE.test(String(filtres.visite || ''))) {
    where.push(`date = ${poser(filtres.visite)}::date`);
  } else {
    if (filtres.quand === 'avenir') {
      where.push(`date >= ${poser(jourBelge(instant))}::date`);
    } else if (filtres.quand !== 'tout') {
      const jours = { aujourdhui: 0, '7j': 6, '30j': 29 }[filtres.quand];
      const debut = new Date(instant.getTime() - (jours === undefined ? 6 : jours) * 86400000);
      where.push(`(created_at at time zone '${FUSEAU}')::date >= ${poser(jourBelge(debut))}::date`);
    }
  }
  return { where: where.join(' and '), params };
}

const EMAIL_DEMO = /@demo\.fungalaxy\.test$/i;
function resumerProgramme(r) {
  const items = r.program && Array.isArray(r.program.items) ? r.program.items : [];
  if (r.type === 'formule' || r.formuleId) return r.label || r.formuleId;
  if (items.length) return items.map((i) => i.name || i.activityId).filter(Boolean).join(', ');
  return r.label || r.type;
}

async function lireReservations(pool, filtres, { instant = new Date(), mapReservation }) {
  const { where, params } = construireFiltres(filtres, instant);
  params.push(LIMITE);
  const { rows } = await pool.query(
    `select *, count(*) over ()::int as total_filtre from reservations where ${where} order by created_at desc limit $${params.length};`,
    params,
  );
  const reservations = rows.map(mapReservation);
  const ids = reservations.map((r) => r.id);
  let mails = [];
  if (ids.length) {
    mails = (await pool.query(
      `select reservation_id, status, count(*)::int as n from communications
        where reservation_id = any($1::bigint[]) and channel = 'email' and direction = 'outbound'
        group by reservation_id, status;`,
      [ids],
    )).rows;
  }
  return {
    total: rows.length ? Number(rows[0].total_filtre) : 0,
    limite: LIMITE,
    lignes: reservations.map((r) => {
      const lesSiens = mails.filter((m) => Number(m.reservation_id) === r.id);
      const compte = (s) => lesSiens.filter((m) => m.status === s).reduce((t, m) => t + m.n, 0);
      return {
        id: r.id,
        centre: r.centerId,
        recuLe: iso(r.createdAt),
        canal: r.channel,
        statut: r.status,
        aValider: r.validationStatus === 'staff_review',
        date: r.date,
        heure: r.startTime,
        offre: resumerProgramme(r),
        joueurs: r.pax,
        prix: r.price,
        nom: r.name,
        telephone: r.phone,
        email: r.email,
        fabriquee: EMAIL_DEMO.test(r.email || ''),
        mails: { envoyes: compte('sent') + compte('delivered'), attente: compte('queued'), echecs: compte('failed') },
      };
    }),
  };
}

async function lireTour(pool, filtres = {}, { env = process.env, instant = new Date(), database } = {}) {
  const db = database || require('./database');
  const maintenant = instant.getTime();
  const etat = await lireProblemes(pool, { env, maintenant });
  const pannes = [];
  const liste = await section(pannes, 'réservations', () => lireReservations(pool, filtres, { instant, mapReservation: db.mapReservation }), { total: 0, limite: LIMITE, lignes: [] });
  const jour = jourBelge(instant);
  const chiffres = await section(pannes, 'chiffres du jour', async () => (await pool.query(
    `select center_id,
            count(*) filter (where (created_at at time zone '${FUSEAU}')::date = $1::date)::int as recues,
            count(*) filter (where (created_at at time zone '${FUSEAU}')::date = $1::date and channel = 'public')::int as en_ligne,
            count(*) filter (where date = $1::date and status <> 'cancelled')::int as visites,
            coalesce(sum(pax) filter (where date = $1::date and status <> 'cancelled'), 0)::int as joueurs,
            count(*) filter (where validation_status = 'staff_review' and status = 'pending' and date >= $1::date)::int as a_valider
       from reservations
      where ${simulationSqlExclusion()} and (date >= $1::date or created_at > now() - interval '2 days')
      group by center_id;`,
    [jour],
  )).rows, []);
  const acces = await section(pannes, 'accès', async () => (await pool.query(
    `select m.id, m.center_id, m.name, m.status, m.last_seen
       from staff_members m
      where m.role_id = 'platform-owner' and m.status = 'active' and m.last_seen is not null
      order by m.last_seen desc
      limit 12;`,
  )).rows.map((m) => ({ nom: m.name, centre: m.center_id, vuLe: iso(m.last_seen) })), []);
  const parCentre = (id) => chiffres.find((c) => c.center_id === id) || {};
  return {
    ok: true,
    generatedAt: instant.toISOString(),
    jour,
    canal: canalBranche(env),
    problemes: [...etat.problemes, ...pannes.map(constatDeLecture)],
    centres: etat.centres.map((c) => {
      const p = parCentre(c.id);
      return { ...c, recues: Number(p.recues) || 0, enLigneAujourdhui: Number(p.en_ligne) || 0, visites: Number(p.visites) || 0, joueurs: Number(p.joueurs) || 0, aValider: Number(p.a_valider) || 0 };
    }),
    taches: etat.taches.map(({ retardMin, alerte, ...t }) => ({ ...t, enRetard: !t.dernierOk || (maintenant - Date.parse(t.dernierOk)) / 60000 > retardMin, suivie: alerte })),
    erreurs: etat.erreurs,
    essais: etat.essais,
    reservations: liste,
    acces,
  };
}

async function lireDossierTour(pool, id, { database } = {}) {
  const db = database || require('./database');
  const numero = Number(id);
  if (!Number.isInteger(numero) || numero < 1) return null;
  // sim-unfiltered: le dossier s ouvre par son numero, depuis une ligne deja filtree ; il montre ce qu on a touche.
  const ligne = (await pool.query('select * from reservations where id = $1 limit 1;', [numero])).rows[0];
  if (!ligne) return null;
  const r = db.mapReservation(ligne);
  const mails = (await pool.query(
    `select c.id, c.template_id, c.channel, c.recipient, c.subject, c.status, c.attempts, c.last_error, c.scheduled_at, c.sent_at, c.created_at,
            coalesce((select array_agg(e.event_type order by e.occurred_at) from email_events e where e.communication_id = c.id), '{}') as evenements
       from communications c
      where c.reservation_id = $1
      order by c.created_at, c.id;`,
    [numero],
  )).rows.map((m) => ({
    id: Number(m.id),
    modele: m.template_id || '',
    canal: m.channel,
    a: m.recipient,
    objet: m.subject,
    statut: m.status,
    essais: Number(m.attempts) || 0,
    erreur: m.last_error || '',
    prevuLe: iso(m.scheduled_at),
    envoyeLe: iso(m.sent_at),
    creeLe: iso(m.created_at),
    evenements: Array.isArray(m.evenements) ? m.evenements : [],
  }));
  let histoire = [];
  try {
    histoire = await require('./historique-dossier').lireHistoriqueDossier({ centerId: r.centerId, reservationId: numero });
  } catch (error) {
    histoire = [];
  }
  const plan = r.opsPlan || {};
  return {
    ok: true,
    reservation: r,
    mails,
    histoire,
    plan: {
      avertissement: r.planWarning || plan.planWarning || '',
      conflits: Array.isArray(plan.conflicts) ? plan.conflicts.map((c) => ({ gravite: c.severity || '', texte: c.label || c.message || '' })) : [],
      etapes: Array.isArray(plan.timeline) ? plan.timeline.map((b) => ({ debut: b.startTime || b.start || '', fin: b.endTime || b.end || '', quoi: b.activityName || b.label || b.activityId || '' })) : [],
      validation: plan.validation ? { niveau: plan.validation.niveau || '', raison: plan.validation.raison || '' } : null,
    },
  };
}

// LE BILAN DU MATIN (2026-11-06, il etait a 22 h depuis le 2026-11-05) : le chef de
// garde ecrit la veille entiere a 8 h (lib/garde-bilan.js). Le silence ne prouve rien :
// ce message dit aussi que la garde est vivante. Pas parti avant 11 h, il saute le jour :
// un bilan de la veille l apres-midi ne sert plus, et la sonde dit deja une garde morte.
const HEURE_BILAN = '08:00';
const FIN_BILAN = '11:00';
const EXPLICATIONS_PAR_JOUR = 8;

async function lireDernierEtatGarde(pool) {
  const ligne = (await pool.query("select result from ops_worker_runs where task_name = 'garde' and status = 'ok' order by started_at desc limit 1;")).rows[0];
  const r = (ligne && ligne.result) || {};
  return {
    dits: r.dits && typeof r.dits === 'object' ? r.dits : {},
    bilanDu: r.bilanDu || '',
    curseurAudit: Number.isFinite(Number(r.curseurAudit)) && r.curseurAudit !== null && r.curseurAudit !== undefined ? Number(r.curseurAudit) : null,
    miseEnService: r.miseEnService || '',
    explications: r.explications && typeof r.explications === 'object' ? r.explications : { jour: '', n: 0 },
    // La garde de securite (lib/garde-securite.js, 2026-11-08) : son curseur sur les refus
    // du journal, et le lundi de son dernier bilan.
    curseurRefus: Number.isFinite(Number(r.curseurRefus)) && r.curseurRefus !== null && r.curseurRefus !== undefined ? Number(r.curseurRefus) : null,
    bilanSecuriteDu: r.bilanSecuriteDu || '',
  };
}

// Ce que la garde retient d un probleme dit : son titre, sa phrase au passe pour « Réglé », le nombre
// qu elle a dit (n), et s il se dit a l instant ailleurs.
const retenu = (p, n) => ({ titre: p.titre, passe: p.passe || p.titre, ...(Number.isFinite(n) ? { n } : {}), ...(p.instant ? { instant: true } : {}), ...(p.evenement ? { evenement: true } : {}) });

// DES CLES SANS NOMBRE (2026-11-13, Ansar : « quand je fais des modifs je reçois des alertes genre 5-10
// après »). Une cle portait le nombre du moment (mail:echec:gembloux:3) : chaque nombre qui bougeait
// faisait un « nouveau » probleme ET un « Réglé » pour l ancien, a chaque passage. La cle est stable ;
// une cle d avant se relit sans son nombre, pour que la mise en ligne ne redise pas tout.
const AVEC_NOMBRE = /^((?:mail:(?:echec|bounced|complained)|essai:panne|base:fabriquees):[^:]+):\d+$/;
const cleStable = (cle) => { const m = String(cle).match(AVEC_NOMBRE); return m ? m[1] : String(cle); };
function relirePrecedent(brut) {
  const out = {};
  for (const [cle, v] of Object.entries(brut || {})) {
    const c = cleStable(cle);
    if (!out[c]) out[c] = v && typeof v === 'object' ? v : { titre: String(v || ''), ancien: true };
  }
  return out;
}
// Ce qui se dit deja a l instant, y compris dans un etat retenu avant le 2026-11-13.
const DIT_A_L_INSTANT = /^(?:erreur:|essai:panne:|mail:(?:bounced|complained):|tache:[^:]+:echec$)/;
const ditALInstant = (cle, v) => Boolean(v && v.instant) || DIT_A_L_INSTANT.test(cle);
// Une vraie aggravation : le nombre a au moins double depuis qu il a ete dit, et de trois au moins.
const aggrave = (n, nDit) => Number.isFinite(n) && Number.isFinite(nDit) && n >= Math.max(2 * nDit, nDit + 3);
// Avant le gabarit du 2026-11-13, la garde ne retenait que le titre : une valeur de ce temps-la
// se redit telle quelle, sauf si elle porte un mot technique d avant.
function passeDe(v) {
  if (v && typeof v === 'object') return String(v.passe || v.titre || '');
  const titre = String(v || '');
  return /serveur|api\/|plantage|ops-jobs|sonde|chef de garde/i.test(titre) ? 'un problème signalé plus tôt' : titre;
}
const blocDuConstat = (p, env) => T.bloc({ quoi: p.quoi || p.titre, effet: p.effet || '', action: p.action || T.faire('regarde dans la Tour de contrôle.'), lien: T.lienVers(p.lien || 'tour', env) });

// Le coeur de la garde, sans reseau ni base : elle dit quand ca change, jamais deux fois. Un seul
// message porte les problemes neufs (l urgent d abord, et il sonne s il y en a un), un autre ce qui
// est regle. Chaque message rend son texte, ses liens et s il sonne.
function deciderGarde(precedentBrut, problemes, { env = process.env, instant = Date.now() } = {}) {
  const precedent = relirePrecedent(precedentBrut);
  const neufs = problemes.filter((p) => !precedent[p.cle]);
  // Un nombre qui bouge ne redit rien ; une vraie aggravation se redit, avec son nouveau nombre.
  const aggraves = problemes.filter((p) => precedent[p.cle] && aggrave(p.n, precedent[p.cle].n));
  const nouveaux = [...neufs.filter((p) => !p.instant), ...aggraves];
  const redits = new Set([...neufs, ...aggraves].map((p) => p.cle));
  const actuels = Object.fromEntries(problemes.map((p) => [p.cle, retenu(p, redits.has(p.cle) || !Number.isFinite((precedent[p.cle] || {}).n) ? p.n : precedent[p.cle].n)]));
  // « Réglé » ne part que quand le probleme disparait, et pas pour ce qui se dit a l instant : un
  // plantage qui sort de la fenetre de 24 h n est pas « réglé ».
  const regles = Object.keys(precedent).filter((cle) => !actuels[cle] && !ditALInstant(cle, precedent[cle]) && !(precedent[cle] && precedent[cle].evenement)).map((cle) => passeDe(precedent[cle]));
  const messages = [];
  if (nouveaux.length) {
    const ordre = [...nouveaux].sort((a, b) => ORDRE[a.gravite] - ORDRE[b.gravite]);
    messages.push({ ...T.assembler(ordre.map((p) => blocDuConstat(p, env))), urgent: ordre[0].gravite === 'critique', genre: 'alerte' });
  }
  if (regles.length) messages.push({ texte: regles.map((p) => T.regle(p, instant)).join('\n'), liens: [], urgent: false, genre: 'regle' });
  return { messages, dits: actuels, nouveaux, neufs, regles };
}

// LA MISE EN SERVICE DES SUJETS : la premiere fois qu un groupe est branche, chaque sujet
// recoit une ligne qui dit ce qu il recevra. C est aussi la preuve, en prod, que le jeton,
// le groupe et les quatre sujets repondent.
const PRESENTATION_DES_SUJETS = {
  pannes: ['Pinlane : ce fil reçoit les problèmes.', 'Seul ce qui touche des clients ou l’équipe fait sonner ton téléphone, le reste arrive sans bruit. La sécurité aussi : une tentative d’ouvrir les données d’un autre client sonne. Chaque message dit ce qui se passe et ce que tu fais.', 'Rien à faire : ce message dit juste que le fil marche.'],
  reservations: ['Pinlane : ce fil reçoit chaque réservation et chaque demande de groupe.', 'Une par message, sans sonnerie, sans nom ni téléphone ni e-mail : le dossier s’ouvre d’un toucher.', 'Rien à faire : ce message dit juste que le fil marche.'],
  modifications: ['Pinlane : ce fil reçoit les changements faits par l’équipe dans la console.', 'Réservations déplacées ou annulées, prix, réglages, accès, regroupés par quart d’heure, sans sonnerie. Tes propres changements n’y sont pas.', 'Rien à faire : ce message dit juste que le fil marche.'],
  bilans: ['Pinlane : ce fil reçoit les bilans.', 'Le bilan de la veille chaque matin à 8 h, et le lundi celui de la semaine, sécurité comprise.', 'Rien à faire : ce message dit juste que le fil marche.'],
};

const signatureDuGroupe = (env) => (groupeBranche(env) ? `${destination('pannes', env).chat_id}:${Object.entries(lireSujets(env)).sort().map(([s, n]) => `${s}=${n}`).join(',')}` : '');

async function lancerGarde({ pool, env = process.env, instant = new Date(), fetcher = fetch, database, llm } = {}) {
  const precedent = await lireDernierEtatGarde(pool);
  const tour = await lireTour(pool, { quand: 'aujourdhui' }, { env, instant, database });
  // La garde tourne puisqu elle s execute : sa propre ligne en retard ne se dit qu au prochain passage de la sonde.
  const problemesGarde = tour.problemes.filter((p) => !p.cle.startsWith('tache:garde:'));
  const { messages, dits, neufs, regles } = deciderGarde(precedent.dits, problemesGarde, { env, instant: instant.getTime() });
  let garde = dits;
  const envois = [];
  for (const m of messages) {
    // Seul l urgent sonne ; « a regarder » et « réglé » arrivent sans bruit.
    const r = await envoyerTelegram(m.texte, { env, fetcher, sujet: 'pannes', silencieux: !m.urgent, liens: m.liens });
    envois.push(r.ok);
    // Non parti, rien n est retenu : le prochain passage le redit.
    if (!r.ok) garde = precedent.dits;
  }
  const partis = envois.every(Boolean);
  const jour = jourBelge(instant);
  // L EXPLICATION D UNE PANNE PAR L IA EST RETIREE (2026-11-13) : chaque alerte dit maintenant
  // elle-meme ce qui casse, qui est touche et quoi faire ; un second message la doublait.
  const explications = precedent.explications;

  // LE JOURNAL : les annonces en retard et les modifications du quart d heure.
  let journal = { curseur: precedent.curseurAudit, annonces: 0, modifications: 0 };
  try {
    journal = await require('./garde-journal').relireLeJournal(pool, precedent.curseurAudit, { env, fetcher, database });
  } catch (error) {
    console.error('[garde] journal illisible', String((error && error.message) || error).slice(0, 200));
  }

  // LA GARDE DE SECURITE (2026-11-08) : les refus du quart d heure, analyses, et le lundi
  // le bilan de la semaine. Une lecture qui echoue ne fait pas tomber la garde.
  const nomsDesCentres = (id) => require('./garde-annonces').nomDuCentre(id);
  const signature = signatureDuGroupe(env);
  const securite = { curseur: precedent.curseurRefus, messages: 0, bilan: precedent.bilanSecuriteDu };
  try {
    const gardeSecurite = require('./garde-securite');
    // Un groupe deja en service n a pas lu sa presentation : elle se dit une fois, dans Bilans.
    const annoncer = Boolean(signature) && precedent.miseEnService === signature;
    const r = await gardeSecurite.relireLesRefus(pool, precedent.curseurRefus, { env, fetcher, noms: nomsDesCentres, maintenant: instant.getTime(), annoncer });
    securite.curseur = r.curseur;
    securite.messages = r.messages;
    const b = await gardeSecurite.bilanSecuriteSiLundi(pool, precedent.bilanSecuriteDu, { instant, env, fetcher, noms: nomsDesCentres });
    securite.bilan = b.semaine;
  } catch (error) {
    console.error('[garde] securite illisible', String((error && error.message) || error).slice(0, 200));
  }

  // LA MISE EN SERVICE des sujets, une fois par groupe.
  let miseEnService = precedent.miseEnService;
  if (signature && miseEnService !== signature) {
    let tous = true;
    for (const [sujet, lignes] of Object.entries(PRESENTATION_DES_SUJETS)) {
      const r = await envoyerTelegram(lignes.join('\n'), { env, fetcher, sujet });
      tous = tous && r.ok && !r.repli;
    }
    if (tous) miseEnService = signature;
  }

  // LE BILAN DU MATIN.
  let bilanDu = precedent.bilanDu;
  let bilanPar = '';
  const heure = heureBelge(instant);
  if (heure >= HEURE_BILAN && heure < FIN_BILAN && bilanDu !== jour) {
    const { bilanDuMatin } = require('./garde-bilan');
    const bilan = await bilanDuMatin(pool, { tour, instant, llm, database });
    const r = await envoyerTelegram(bilan.texte, { env, fetcher, sujet: 'bilans' });
    if (r.ok) {
      bilanDu = jour;
      bilanPar = bilan.par;
    }
  }
  return {
    ok: true,
    problemes: tour.problemes.length,
    // LES ALERTES QUI SONNENT, EN CLAIR (2026-11-10, Ansar : une alerte importante lance une
    // session de reparation sur son PC). Un veilleur local relit cette ligne. `dits` ne garde que
    // les titres : la gravite se perdait. Rien n entre ici de plus que dans le message Telegram.
    critiques: problemesGarde.filter((p) => p.gravite === 'critique').map((p) => ({ cle: p.cle, centre: p.centre || '', titre: p.titre, detail: p.detail || '' })),
    dits: garde,
    bilanDu,
    ...(bilanPar ? { bilanPar } : {}),
    canal: canalBranche(env),
    envois,
    curseurAudit: journal.curseur,
    annonces: journal.annonces,
    modifications: journal.modifications,
    // Ce qui s est ouvert et regle a ce passage : le bilan du matin relit les 24 h.
    ouverts: partis ? neufs.map((p) => ({ cle: p.cle, titre: p.titre, gravite: p.gravite })) : [],
    regles: partis ? regles : [],
    explications,
    miseEnService,
    curseurRefus: securite.curseur,
    alertesSecurite: securite.messages,
    bilanSecuriteDu: securite.bilan,
  };
}

// CE QUE LA SONDE DEMANDE EN PASSANT (/api/healthz).
async function derniereGardeReussie(pool) {
  const r = await pool.query("select max(finished_at) as le from ops_worker_runs where task_name = 'garde' and status = 'ok';");
  return r.rows[0] && r.rows[0].le ? new Date(r.rows[0].le).toISOString() : null;
}

// LA BASE ECRIT-ELLE ENCORE ? Un quota Neon depasse la laisse lire : le site repond, les
// creneaux s affichent, et aucune reservation ne s enregistre. Une ligne ecrite puis
// annulee : rien ne reste, et c est la seule facon de le savoir avant un client.
async function essaiEcriture(pool) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("insert into ops_worker_runs (worker_name, task_name, status) values ('sonde', 'essai-ecriture', 'ok');");
    await client.query('rollback');
    return true;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return false;
  } finally {
    client.release();
  }
}

// La garde surveille aussi la sonde : son passage se note, au plus une ligne par 5 minutes.
async function noterPassageSonde(pool) {
  await pool.query(
    `insert into ops_worker_runs (worker_name, task_name, status, finished_at)
     select 'sonde', 'sonde', 'ok', now()
      where not exists (select 1 from ops_worker_runs where task_name = 'sonde' and started_at > now() - interval '5 minutes');`,
  );
}

module.exports = {
  CENTRES_GARDES,
  estCentreGarde,
  constat,
  blocDuConstat,
  derniereGardeReussie,
  essaiEcriture,
  noterPassageSonde,
  TACHES,
  construireFiltres,
  deciderGarde,
  lancerGarde,
  lireDossierTour,
  lireProblemes,
  lireTour,
};
