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
const { normalizeCenterConfig } = require('./center-config');
const { destinatairesSecours } = require('./secours-mails');
const { simulationSqlExclusion, fabricatedSqlPredicate, demonstrationEmailPattern } = require('./simulation-filter');
const { ordreDe: ordreDesEcrans } = require('./formulaire-etapes');

// Les centres dont on garde les portes. Les autres fiches (centres de demonstration,
// clients a venir) restent lisibles dans la liste et ne sonnent pas.
const CENTRES_GARDES = ['libramont', 'gembloux'];

// Ce qui doit tourner, a quelle cadence, et a partir de quand c est un probleme.
// `alerte: false` : visible ici, sans message. Une panne de l agent marketing ne
// touche aucun client.
const TACHES = [
  { id: 'garde', nom: 'La garde', role: 'compare ce qui ne va pas à ce qu’elle a déjà dit, toutes les 15 min', retardMin: 45, alerte: true },
  { id: 'sonde', nom: 'La sonde extérieure', role: 'teste les deux centres de dehors, hébergée ailleurs que le site', retardMin: 45, alerte: true },
  { id: 'secours', nom: 'Le planning de secours', role: 'envoie la feuille à 8 h, 13 h et 17 h, ses changements, et demain à 23 h 30', retardMin: 45, alerte: true },
  { id: 'dispatch-communications', nom: 'L’envoi des mails en attente', role: 'reprend toutes les 3 h les mails qui n’ont pas pu partir', retardMin: 240, alerte: true },
  { id: 'ops-jobs', nom: 'Le ménage du matin', role: 'traite les tâches en attente et libère les blocages expirés', retardMin: 1560, alerte: true },
  { id: 'sauvegarde', nom: 'La sauvegarde de la nuit', role: 'envoie toute la base chiffrée par mail', retardMin: 1560, alerte: true },
  { id: 'agent-orchestrator', nom: 'Les agents marketing', role: 'ne touche aucun client', retardMin: 1560, alerte: false },
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
      garde: CENTRES_GARDES.includes(l.id),
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

function constatsDesTaches(taches, maintenant) {
  const out = [];
  for (const t of taches) {
    if (!t.alerte) continue;
    const age = t.dernierOk ? (maintenant - Date.parse(t.dernierOk)) / 60000 : Infinity;
    if (age > t.retardMin) {
      out.push({
        cle: `tache:${t.id}:retard`,
        gravite: 'critique',
        titre: `${t.nom} ne tourne plus`,
        detail: t.dernierOk ? `Dernier passage réussi il y a ${dureeLisible(age)}.` : 'Aucun passage réussi à ce jour.',
      });
    } else if (t.statut === 'failed') {
      out.push({ cle: `tache:${t.id}:echec`, gravite: 'attention', titre: `${t.nom} a échoué à son dernier passage`, detail: t.erreur || 'Sans message.' });
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
    out.push({ cle: `mail:echec:${l.center_id}:${l.n}`, gravite: 'critique', centre: l.center_id, titre: `${pluriel(l.n, 'mail n’est pas parti', 'mails ne sont pas partis')} à ${noms(l.center_id)}`, detail: 'Trois essais ratés, en 48 h. Le client n’a peut-être pas sa confirmation.' });
  }
  const coinces = (await pool.query(
    `select center_id, count(*)::int as n, min(coalesce(scheduled_at, created_at)) as depuis
       from communications
      where status = 'queued' and coalesce(scheduled_at, created_at) < now() - interval '30 minutes'
      group by center_id;`,
  )).rows;
  for (const l of coinces) {
    out.push({ cle: `mail:attente:${l.center_id}`, gravite: 'attention', centre: l.center_id, titre: `${pluriel(l.n, 'mail attend', 'mails attendent')} de partir à ${noms(l.center_id)}`, detail: 'Depuis plus de 30 minutes. Le prochain envoi les reprend, toutes les 3 h.' });
  }
  const rebonds = (await pool.query(
    `select center_id, event_type, count(*)::int as n
       from email_events
      where event_type in ('bounced', 'complained') and occurred_at > now() - interval '48 hours'
      group by center_id, event_type;`,
  )).rows;
  for (const l of rebonds) {
    const mot = l.event_type === 'bounced' ? pluriel(l.n, 'mail est revenu', 'mails sont revenus') : pluriel(l.n, 'client a signalé un mail', 'clients ont signalé un mail');
    out.push({ cle: `mail:${l.event_type}:${l.center_id}:${l.n}`, gravite: 'attention', centre: l.center_id, titre: `${mot} à ${noms(l.center_id)}`, detail: 'En 48 h. C’est le plus souvent une adresse fausse, à rappeler par téléphone.' });
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
    out.push({ cle: `essai:panne:${e.centre}:${e.n}`, gravite: 'critique', centre: e.centre, titre: `${pluriel(e.n, 'réservation a échoué', 'réservations ont échoué')} pour une panne à ${noms(e.centre)}`, detail: 'En 24 h. La demande est partie à la boîte de secours si elle a une adresse.' });
  }
  const parCentre = new Map();
  for (const e of essais.filter((x) => x.action === 'reservation.refusee')) parCentre.set(e.centre, (parCentre.get(e.centre) || 0) + e.n);
  for (const [centre, n] of parCentre) {
    if (n >= SEUIL_REFUS_24H) out.push({ cle: `essai:refus:${centre}`, gravite: 'attention', centre, titre: `${n} réservations refusées à ${noms(centre)} en 24 h`, detail: 'Des clients sont allés jusqu’au bout sans réserver. Le motif est dans la liste des essais.' });
  }
  return out;
}

function constatsDesErreurs(erreurs, noms) {
  const titre = {
    client: (e) => `Le formulaire de ${noms(e.centre)} a planté chez un client`,
    serveur: (e) => `Le serveur a planté (${String(e.page || '').replace(/^serveur:/, '').slice(0, 60)})`,
    console: (e) => `La console de ${noms(e.centre)} a planté`,
  };
  return erreurs.filter((e) => titre[e.origine]).map((e) => ({
    cle: `erreur:${e.origine}:${e.cle}`,
    gravite: e.origine === 'console' ? 'attention' : 'critique',
    centre: e.centre,
    titre: titre[e.origine](e),
    detail: `${String(e.message).slice(0, 140)} (${pluriel(e.n, 'fois', 'fois')}, en 24 h).`,
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
  for (const l of aValider.filter((x) => CENTRES_GARDES.includes(x.center_id) && Number(x.n) > 0)) {
    out.push({ cle: `suivi:a-valider:${l.center_id}`, gravite: 'attention', centre: l.center_id, titre: `${pluriel(Number(l.n), 'réservation en ligne attend', 'réservations en ligne attendent')} la validation de l’équipe à ${noms(l.center_id)}`, detail: 'Depuis plus de 2 h. Le client attend la réponse du centre.' });
  }
  const demandes = (await pool.query(
    `select center_id, count(*)::int as n
       from custom_requests
      where status = 'new' and created_at < now() - interval '24 hours'
      group by center_id;`,
  )).rows;
  for (const l of demandes.filter((x) => CENTRES_GARDES.includes(x.center_id) && Number(x.n) > 0)) {
    out.push({ cle: `suivi:demande:${l.center_id}`, gravite: 'attention', centre: l.center_id, titre: `${pluriel(Number(l.n), 'demande de groupe attend', 'demandes de groupe attendent')} une réponse à ${noms(l.center_id)}`, detail: 'Depuis plus de 24 h. Elle se traite dans la console, page Demandes.' });
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
  const lire = async (nom, sql, params = []) => {
    try {
      return (await pool.query(sql, params)).rows.filter((x) => CENTRES_GARDES.includes(x.center_id) && Number(x.n) > 0);
    } catch (error) {
      console.error(`[tour-controle] intégrité, ${nom} illisible`, String((error && error.message) || error).slice(0, 300));
      illisibles.push(nom);
      return [];
    }
  };
  for (const l of await lire('prix à zéro', `select center_id, count(*)::int as n from reservations where channel = 'public' and status <> 'cancelled' and price <= 0 and created_at > now() - interval '24 hours' and ${simulationSqlExclusion()} group by center_id;`)) {
    out.push({ cle: `integrite:prix-zero:${l.center_id}`, gravite: 'attention', centre: l.center_id, titre: `${pluriel(Number(l.n), 'réservation en ligne est enregistrée', 'réservations en ligne sont enregistrées')} à 0 € à ${noms(l.center_id)}`, detail: 'Créées dans les dernières 24 h. Le prix n’a pas été calculé. À relire dans le planning avant l’arrivée du client.' });
  }
  for (const l of await lire('sans mail', `select r.center_id, count(*)::int as n from reservations r where r.channel = 'public' and r.email <> '' and r.status <> 'cancelled' and r.created_at < now() - interval '20 minutes' and r.created_at > now() - interval '24 hours' and ${simulationSqlExclusion('r')} and not exists (select 1 from communications c where c.reservation_id = r.id and c.channel = 'email' and c.direction = 'outbound') and not exists (select 1 from center_automation_settings s where s.center_id = r.center_id and (s.settings->'confirmation'->>'enabled' = 'false' or s.settings->'request_received'->>'enabled' = 'false')) group by r.center_id;`)) {
    out.push({ cle: `integrite:sans-mail:${l.center_id}`, gravite: 'attention', centre: l.center_id, titre: `${pluriel(Number(l.n), 'réservation en ligne n’a', 'réservations en ligne n’ont')} reçu aucun mail à ${noms(l.center_id)}`, detail: 'Créées depuis plus de 20 minutes, sans mail de confirmation enregistré. Le client ne sait peut-être pas que sa réservation est prise.' });
  }
  for (const l of await lire('double piste', `select a.center_id, count(*)::int as n from reservations a join reservations b on b.center_id = a.center_id and b.date = a.date and b.id > a.id and b.lanes && a.lanes and (b.date + b.start_time) < (a.date + a.start_time) + a.duration * interval '1 hour' and (a.date + a.start_time) < (b.date + b.start_time) + b.duration * interval '1 hour' where a.date >= $1::date and a.status <> 'cancelled' and b.status <> 'cancelled' and a.type = 'bowling' and b.type = 'bowling' and coalesce(a.formule_id, '') = '' and coalesce(b.formule_id, '') = '' and a.validation_status not in ('rejected', 'draft') and b.validation_status not in ('rejected', 'draft') and ${simulationSqlExclusion('a')} and ${simulationSqlExclusion('b')} group by a.center_id;`, [jourBelge()])) {
    out.push({ cle: `integrite:doublon:${l.center_id}`, gravite: 'attention', centre: l.center_id, titre: `${pluriel(Number(l.n), 'double réservation de bowling', 'doubles réservations de bowling')} sur la même piste à ${noms(l.center_id)}`, detail: 'Deux réservations à venir ont la même piste à la même heure. À vérifier dans le planning avant l’arrivée des clients.' });
  }
  const ecrans = ordreDesEcrans('reservation');
  const visites = await lire('formulaire', `select center_id, count(*)::int as n, sum(case when loin >= $2 then 1 else 0 end)::int as valides, sum(case when loin >= $3 then 1 else 0 end)::int as finis from (select center_id, visite, max(array_position($1::text[], etape)) as loin from formulaire_etapes where parcours = 'reservation' and created_at > now() - interval '24 hours' group by center_id, visite) as t group by center_id;`, [ecrans, ecrans.indexOf('recap') + 1, ecrans.length]);
  const arrivees = visites.length ? await lire('réservations en ligne du jour', `select center_id, count(*)::int as n from reservations where channel = 'public' and created_at > now() - interval '24 hours' and ${simulationSqlExclusion()} group by center_id;`) : [];
  const onSait = !illisibles.includes('réservations en ligne du jour');
  for (const v of onSait ? visites : []) {
    if (Number(v.finis) > 0 || arrivees.some((a) => a.center_id === v.center_id)) continue;
    const valides = Number(v.valides) || 0;
    if (valides >= SEUIL_VALIDATIONS_SANS_ENVOI) out.push({ cle: `formulaire:bloque:${v.center_id}`, gravite: Number(v.n) >= SEUIL_VISITES_POUR_SONNER ? 'critique' : 'attention', centre: v.center_id, titre: `Le formulaire de ${noms(v.center_id)} ne laisse sans doute plus réserver : ${valides} visites à la validation, aucun envoi`, detail: 'Depuis 24 heures, aucune réservation en ligne n’est arrivée non plus. À vérifier en réservant sur le site.' });
    else if (Number(v.n) >= SEUIL_VISITES_SANS_ENVOI) out.push({ cle: `formulaire:personne-au-bout:${v.center_id}`, gravite: 'attention', centre: v.center_id, titre: `${Number(v.n)} visites ont commencé le formulaire de ${noms(v.center_id)}, aucune n’est allée au bout`, detail: 'Depuis 24 heures, et aucune réservation en ligne n’est arrivée. Direction, « Où les gens s’arrêtent », dit à quel écran elles partent.' });
  }
  if (illisibles.length) out.push({ cle: 'integrite:illisible', gravite: 'attention', titre: `Un contrôle des réservations ne se lit pas (${illisibles.join(', ')})`, detail: 'Ce contrôle n’est pas fait pour l’instant. Rien ne dit qu’il y a un défaut.' });
  return out;
}

function constatsDesCentres(centres) {
  const out = [];
  for (const c of centres.filter((x) => x.garde)) {
    if (!c.enLigne) out.push({ cle: `centre:ferme:${c.id}`, gravite: 'attention', centre: c.id, titre: `La réservation en ligne est coupée à ${c.nom}`, detail: c.formulaireActif ? 'Le statut du centre n’est pas « actif », et son formulaire refuse tout.' : 'L’ancien formulaire du site est revenu à sa place. Elle se remet depuis cette page.' });
    if (!c.secours.adresses) out.push({ cle: `secours:sans-adresse:${c.id}`, gravite: 'attention', centre: c.id, titre: `${c.nom} n’a aucune adresse de secours`, detail: 'Aucun planning de secours ne part, et une demande reçue pendant une panne serait perdue. À ajouter quand vous voulez.' });
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
  return rows.filter((l) => CENTRES_GARDES.includes(l.center_id)).map((l) => ({
    cle: `base:fabriquees:${l.center_id}:${l.n}`,
    gravite: 'attention',
    centre: l.center_id,
    titre: `${pluriel(l.n, 'réservation d’essai occupe', 'réservations d’essai occupent')} des places à venir à ${noms(l.center_id)}`,
    detail: 'Le planning les compte comme de vraies réservations, et ces créneaux ne se vendent pas.',
  }));
}

const ORDRE = { critique: 0, attention: 1 };
const constatDeLecture = (nom) => ({ cle: `lecture:${nom}`, gravite: 'critique', titre: `La Tour de contrôle n’arrive pas à lire une partie de l’état (${nom})`, detail: 'Cette partie n’est pas vérifiée pour l’instant.' });
async function lireProblemes(pool, { env = process.env, maintenant = Date.now() } = {}) {
  const pannes = [];
  const centres = await section(pannes, 'centres', () => lireCentres(pool, { env }), []);
  const noms = (id) => (centres.find((c) => c.id === id) || { nom: id }).nom;
  const taches = await section(pannes, 'tâches', () => lireTaches(pool), []);
  const erreurs = await section(pannes, 'erreurs', () => lireErreurs(pool), []);
  const essais = await section(pannes, 'essais', () => lireEssais(pool), []);
  const mails = await section(pannes, 'mails', () => constatsDesMails(pool, noms), []);
  const fabriquees = await section(pannes, 'réservations d’essai', () => constatsDesEssaisEnBase(pool, noms), []);
  const suivis = await section(pannes, 'suivis', () => constatsDesSuivis(pool, noms), []);
  const integrite = await section(pannes, 'intégrité', () => constatsDIntegrite(pool, noms), []);
  const problemes = [
    ...constatsDesEssais(essais, noms),
    ...constatsDesErreurs(erreurs, noms),
    ...constatsDesCentres(centres),
    ...mails,
    ...constatsDesTaches(taches, maintenant),
    ...fabriquees,
    ...suivis,
    ...integrite,
    ...(canalBranche(env) ? [] : [{ cle: 'canal:absent', gravite: 'attention', titre: 'Les alertes Telegram de l’application ne sont pas branchées', detail: 'Il manque TELEGRAM_JETON et TELEGRAM_CHAT sur Vercel. La sonde, elle, prévient toujours.' }]),
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

// Le coeur de la garde, sans reseau ni base : elle dit quand ca change, jamais deux fois.
function deciderGarde(precedent, problemes) {
  const actuels = Object.fromEntries(problemes.map((p) => [p.cle, p.titre]));
  const nouveaux = problemes.filter((p) => !precedent[p.cle]);
  const regles = Object.keys(precedent).filter((cle) => !actuels[cle]).map((cle) => precedent[cle]);
  const messages = [];
  if (nouveaux.length) {
    const urgent = nouveaux.some((p) => p.gravite === 'critique');
    messages.push(`${urgent ? 'URGENT Pinlane' : 'À regarder, Pinlane'}\n${nouveaux.map((p) => `${p.titre}. ${p.detail}`).join('\n')}`);
  }
  if (regles.length) messages.push(`Réglé, Pinlane\n${regles.join('\n')}`);
  return { messages, dits: actuels, nouveaux, regles };
}

// LA MISE EN SERVICE DES SUJETS : la premiere fois qu un groupe est branche, chaque sujet
// recoit une ligne qui dit ce qu il recevra. C est aussi la preuve, en prod, que le jeton,
// le groupe et les quatre sujets repondent.
const PRESENTATION_DES_SUJETS = {
  pannes: 'Ici, les pannes, avec la sonnerie : le formulaire, la console ou le serveur qui plantent, une tâche de fond qui échoue, un mail refusé, une réservation ratée. La garde passe toutes les 15 minutes, la sonde toutes les 5. La sécurité aussi : une tentative vers un autre client sonne ; codes faux en série, gestes refusés faute de droit et mails piégés arrivent sans sonnerie.',
  reservations: 'Ici, chaque réservation et chaque demande de groupe, une par message, sans sonnerie. Jamais de nom, de téléphone ni d’e-mail : le dossier s’ouvre dans la Tour de contrôle.',
  modifications: 'Ici, chaque modification faite dans la console (réservation déplacée ou annulée, prix, réglages, accès), regroupées par quart d’heure, sans sonnerie.',
  bilans: 'Ici, le bilan de la veille à 8 h, écrit par le chef de garde, et le lundi ceux de la sonde et de la sécurité.',
};
const signatureDuGroupe = (env) => (groupeBranche(env) ? `${destination('pannes', env).chat_id}:${Object.entries(lireSujets(env)).sort().map(([s, n]) => `${s}=${n}`).join(',')}` : '');

async function lancerGarde({ pool, env = process.env, instant = new Date(), fetcher = fetch, database, llm } = {}) {
  const precedent = await lireDernierEtatGarde(pool);
  const tour = await lireTour(pool, { quand: 'aujourdhui' }, { env, instant, database });
  // La garde tourne puisqu elle s execute : sa propre ligne en retard ne se dit qu au prochain passage de la sonde.
  const problemesGarde = tour.problemes.filter((p) => !p.cle.startsWith('tache:garde:'));
  const { messages, dits, nouveaux, regles } = deciderGarde(precedent.dits, problemesGarde);
  let garde = dits;
  const envois = [];
  for (const texte of messages) {
    // Seul l urgent sonne ; « a regarder » et « regle » arrivent sans bruit.
    const r = await envoyerTelegram(texte, { env, fetcher, sujet: 'pannes', silencieux: !/^URGENT/.test(texte) });
    envois.push(r.ok);
    // Non parti, rien n est retenu : le prochain passage le redit.
    if (!r.ok) garde = precedent.dits;
  }
  const partis = envois.every(Boolean);
  const jour = jourBelge(instant);

  // LE CHEF DE GARDE EXPLIQUE une panne neuve : une explication par passage, huit par jour.
  let explications = precedent.explications.jour === jour ? precedent.explications : { jour, n: 0 };
  const critiques = nouveaux.filter((p) => p.gravite === 'critique');
  if (critiques.length && partis && explications.n < EXPLICATIONS_PAR_JOUR) {
    const { expliquerPanne } = require('./garde-bilan');
    const texte = await expliquerPanne(critiques, { tour, llm });
    if (texte) {
      const r = await envoyerTelegram(`Le chef de garde :\n${texte}`, { env, fetcher, sujet: 'pannes', silencieux: true });
      if (r.ok) explications = { jour, n: explications.n + 1 };
    }
  }

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
    for (const [sujet, texte] of Object.entries(PRESENTATION_DES_SUJETS)) {
      const r = await envoyerTelegram(`Mise en service de la garde Pinlane.\n${texte}`, { env, fetcher, sujet });
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
    ouverts: partis ? nouveaux.map((p) => ({ cle: p.cle, titre: p.titre, gravite: p.gravite })) : [],
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
