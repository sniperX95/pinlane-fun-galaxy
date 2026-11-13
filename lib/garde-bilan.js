// LE CHEF DE GARDE (2026-11-06, Ansar : « un gros recap super complet de litteralement
// TOUT, que ce soit tous les agents, tous les problemes, toutes les resolutions, tout ce
// qui s est passe dans les centres actifs, genre CA »).
//
// Chaque matin a 8 h, un bilan de la veille dans le sujet Bilans. Les chiffres sont
// comptes par le code, ici, et le chiffre d affaires suit la regle de la page Direction
// (lib/direction-analytics.js : une seule source pour un meme chiffre). Claude les
// met en mots simples. Un controle relit son texte : un seul nombre absent des faits,
// et c est le texte des regles qui part, avec une ligne qui le dit. Sans cle, sans
// budget, sans reponse : le texte des regles, toujours. Le silence ne prouve rien : ce
// message dit aussi que la garde est vivante.
//
// Une IA qui surveille en continu coute cher et peut inventer ou rater une panne sans
// rien dire : celle-ci ne surveille rien, elle redige ce que les postes ont deja compte,
// et explique une panne quand un poste vient de sonner.
'use strict';

const { buildDirectionAnalytics } = require('./direction-analytics');
const { isFabricatedReservation, simulationSqlExclusion } = require('./simulation-filter');
const { classer } = require('./garde-journal');
const { euros, jourLisible } = require('./garde-annonces');
const T = require('./alertes-texte');

const FUSEAU = 'Europe/Brussels';
const MODELE = () => process.env.GARDE_MODELE || 'claude-sonnet-5-5';

const jourBelge = (instant) => new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU }).format(instant);
function decaler(jour, n) {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// L instant ou il est minuit a Bruxelles ce jour-la, heure d ete comprise.
function minuitBelge(jour) {
  const base = Date.parse(`${jour}T00:00:00Z`);
  const lire = new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  for (const h of [-1, -2, 0, -3, 1]) {
    const t = base + h * 3600_000;
    const p = Object.fromEntries(lire.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    if (`${p.year}-${p.month}-${p.day}` === jour && Number(p.hour) % 24 === 0 && Number(p.minute) === 0) return new Date(t).toISOString();
  }
  return new Date(base - 3600_000).toISOString();
}
const moment = (v) => (v ? new Intl.DateTimeFormat('fr-BE', { timeZone: FUSEAU, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v)).replace(',', ' à') : '');
const arrondi = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

async function section(illisibles, nom, lire, repli) {
  try {
    return await lire();
  } catch (error) {
    console.error(`[chef-de-garde] ${nom} illisible`, String((error && error.message) || error).slice(0, 200));
    illisibles.push(nom);
    return repli;
  }
}

function centreDeLaConsole(id) {
  try {
    return require('./ops-knowledge').getCenter(id);
  } catch (error) {
    return { id };
  }
}

function totaux(history, debut, fin, id) {
  try {
    const t = buildDirectionAnalytics({ history, startDate: debut, endDate: fin, center: centreDeLaConsole(id) }).totals;
    return { reservations: t.reservations, personnes: t.pax, ca: arrondi(t.revenue), encaisse: arrondi(t.collected), payees: t.paid, annulees: t.cancelled };
  } catch (error) {
    // La regle de la page Direction, reecrite au plus court si son module casse.
    const lignes = history.filter((r) => r.date >= debut && r.date <= fin);
    const actives = lignes.filter((r) => ['pending', 'arrived', 'paid'].includes(r.status) && !r.absentAt);
    return {
      reservations: actives.length,
      personnes: actives.reduce((s, r) => s + (Number(r.pax) || 0), 0),
      ca: arrondi(actives.reduce((s, r) => s + (Number(r.price) || 0), 0)),
      encaisse: arrondi(actives.filter((r) => r.status === 'paid').reduce((s, r) => s + (r.amountPaid != null ? Number(r.amountPaid) : Number(r.price) || 0), 0)),
      payees: actives.filter((r) => r.status === 'paid').length,
      annulees: lignes.filter((r) => r.status === 'cancelled').length,
    };
  }
}

const CATEGORIES = {
  annulees: (l, c) => c.ligne && / annulée$/.test(c.ligne),
  deplacees: (l, c) => c.ligne && (/déplacée|une activité déplacée|retard de/.test(c.ligne)),
  prix: (l, c) => c.ligne && /prix de|remise/.test(c.ligne),
  acces: (l) => /Role|Member|regenerateRoleCode|revealRoleCode/.test(l.action),
  reglages: (l, c) => c.ligne && /^(save|set|reset|create|update|delete|automation|emailDesign|ecrire|sendCampaign|addClient)/.test(l.action) && !/Reservation|Role|Member/.test(l.action),
};

async function faitsDuBilan(pool, { instant = new Date(), centres = [], taches = [], problemes = [], database } = {}) {
  const db = database || require('./database');
  const aujourdhui = jourBelge(instant);
  const hier = decaler(aujourdhui, -1);
  const moisDebut = `${hier.slice(0, 8)}01`;
  const debut = minuitBelge(hier);
  const fin = minuitBelge(aujourdhui);
  const illisibles = [];
  // Les centres gardes seulement (lib/tour-controle.js, lus en base) : une fiche de demonstration n a pas de bilan.
  const actifs = centres.filter((c) => c.status === 'active' && c.garde !== false);
  const ids = actifs.map((c) => c.id);

  const history = await section(illisibles, 'réservations', async () => (await pool.query(
    `select * from reservations where center_id = any($1::text[]) and date >= $2::date and date <= $3::date and ${simulationSqlExclusion()};`,
    [ids, moisDebut, aujourdhui],
  )).rows.map(db.mapReservation).filter((r) => !isFabricatedReservation(r)), []);

  const recues = await section(illisibles, 'réservations reçues', async () => (await pool.query(
    `select * from reservations where center_id = any($1::text[]) and created_at >= $2::timestamptz and created_at < $3::timestamptz and ${simulationSqlExclusion()};`,
    [ids, debut, fin],
  )).rows.map(db.mapReservation).filter((r) => !isFabricatedReservation(r)), []);

  const demandes = await section(illisibles, 'demandes de groupe', async () => (await pool.query(
    `select center_id,
            count(*) filter (where created_at >= $1::timestamptz and created_at < $2::timestamptz)::int as recues,
            coalesce(sum(pax) filter (where created_at >= $1::timestamptz and created_at < $2::timestamptz), 0)::int as personnes,
            count(*) filter (where status = 'new')::int as en_attente
       from custom_requests group by center_id;`,
    [debut, fin],
  )).rows, []);

  const lignesJournal = await section(illisibles, 'modifications', () => require('./garde-journal').lireLignes(pool, { depuis: debut, jusqua: fin, limite: 5000 }), []);

  const mails = await section(illisibles, 'mails', async () => (await pool.query(
    `select center_id,
            count(*) filter (where sent_at >= $1::timestamptz and sent_at < $2::timestamptz)::int as envoyes,
            count(*) filter (where sent_at >= $1::timestamptz and sent_at < $2::timestamptz and status = 'delivered')::int as remis,
            count(*) filter (where status = 'failed' and created_at >= $1::timestamptz and created_at < $2::timestamptz)::int as echecs,
            count(*) filter (where status in ('queued', 'processing'))::int as en_attente
       from communications
      where channel = 'email' and direction = 'outbound' and created_at > $1::timestamptz - interval '60 days'
      group by center_id;`,
    [debut, fin],
  )).rows, []);

  const evenements = await section(illisibles, 'rebonds et plaintes', async () => (await pool.query(
    `select center_id, event_type, count(*)::int as n from email_events
      where occurred_at >= $1::timestamptz and occurred_at < $2::timestamptz and event_type in ('bounced', 'complained', 'delivery_delayed', 'failed')
      group by center_id, event_type;`,
    [debut, fin],
  )).rows, []);

  const erreurs = await section(illisibles, 'plantages', async () => (await pool.query(
    `select center_id, case when member_id like 'public:%' then 'formulaire' when member_id like 'serveur:%' then 'serveur' else 'console' end as origine,
            count(*)::int as n, count(distinct stack_hash)::int as distincts
       from client_errors where occurred_at >= $1::timestamptz and occurred_at < $2::timestamptz
      group by center_id, origine;`,
    [debut, fin],
  )).rows, []);

  const essais = await section(illisibles, 'essais ratés', async () => (await pool.query(
    `select center_id, action, count(*)::int as n from audit_log
      where actor_kind = 'public' and entity_type = 'formulaire' and occurred_at >= $1::timestamptz and occurred_at < $2::timestamptz
      group by center_id, action;`,
    [debut, fin],
  )).rows, []);

  const passages = await section(illisibles, 'tâches de fond', async () => (await pool.query(
    `select task_name, count(*) filter (where status = 'ok')::int as ok, count(*) filter (where status = 'failed')::int as echecs,
            (array_agg(error order by started_at desc) filter (where status = 'failed'))[1] as derniere_erreur
       from ops_worker_runs where started_at >= $1::timestamptz and started_at < $2::timestamptz
      group by task_name;`,
    [debut, fin],
  )).rows, []);

  const sauvegarde = await section(illisibles, 'sauvegarde', async () => (await pool.query(
    "select result, finished_at from ops_worker_runs where task_name = 'sauvegarde' and status = 'ok' order by started_at desc limit 1;",
  )).rows[0] || null, null);

  const historique = await section(illisibles, 'problèmes des 24 h', async () => (await pool.query(
    "select result, started_at from ops_worker_runs where task_name = 'garde' and status = 'ok' and started_at > $1::timestamptz - interval '24 hours' order by started_at;",
    [instant.toISOString()],
  )).rows, []);

  const depense = await section(illisibles, 'dépense IA', async () => (await pool.query(
    'select month, cost_usd::float as cout, calls from llm_spend where month = any($1::text[]);',
    [[aujourdhui.slice(0, 7), `${aujourdhui.slice(0, 7)}:garde`]],
  )).rows, []);

  const deCentre = (lignes, id) => lignes.filter((l) => l.center_id === id);
  const nombre = (v) => Number(v) || 0;
  const faitsCentres = actifs.map((c) => {
    const h = history.filter((r) => r.centerId === c.id);
    const recuesC = recues.filter((r) => r.centerId === c.id);
    const d = deCentre(demandes, c.id)[0] || {};
    const m = deCentre(mails, c.id)[0] || {};
    const ev = (t) => deCentre(evenements, c.id).filter((e) => e.event_type === t).reduce((s, e) => s + nombre(e.n), 0);
    const err = (o) => deCentre(erreurs, c.id).filter((e) => e.origine === o).reduce((s, e) => s + nombre(e.n), 0);
    const ess = (a) => deCentre(essais, c.id).filter((e) => e.action === a).reduce((s, e) => s + nombre(e.n), 0);
    const modifs = { annulees: 0, deplacees: 0, prix: 0, reglages: 0, acces: 0, autres: 0, arrivees: 0, encaissements: 0 };
    for (const l of lignesJournal.filter((x) => x.center_id === c.id)) {
      const cl = classer(l);
      if (cl.creation || cl.rien) continue;
      if (cl.compte === 'arrivee') modifs.arrivees += 1;
      else if (cl.compte === 'encaisse') modifs.encaissements += 1;
      if (!cl.ligne) continue;
      const cat = Object.keys(CATEGORIES).find((k) => CATEGORIES[k](l, cl));
      modifs[cat || 'autres'] += 1;
    }
    const aujourd = totaux(h, aujourdhui, aujourdhui, c.id);
    return {
      centre: c.nom,
      recuesHier: {
        total: recuesC.length,
        enLigne: recuesC.filter((r) => r.channel === 'public').length,
        auComptoir: recuesC.filter((r) => r.channel !== 'public').length,
        montantReserve: arrondi(recuesC.filter((r) => r.status !== 'cancelled').reduce((s, r) => s + (Number(r.price) || 0), 0)),
        dejaAnnulees: recuesC.filter((r) => r.status === 'cancelled').length,
      },
      visitesHier: { ...totaux(h, hier, hier, c.id), absentes: h.filter((r) => r.date === hier && r.absentAt).length },
      moisEnCours: totaux(h, moisDebut, hier, c.id),
      aujourdhui: { ...aujourd, aValider: h.filter((r) => r.date >= aujourdhui && r.validationStatus === 'staff_review' && r.status === 'pending').length },
      demandesDeGroupe: { recuesHier: nombre(d.recues), personnes: nombre(d.personnes), enAttente: nombre(d.en_attente) },
      modificationsHier: modifs,
      mailsHier: { envoyes: nombre(m.envoyes), remis: nombre(m.remis), echecs: nombre(m.echecs), revenus: ev('bounced'), indesirables: ev('complained'), retardes: ev('delivery_delayed'), enAttenteMaintenant: nombre(m.en_attente) },
      plantagesHier: { formulaire: err('formulaire'), console: err('console'), serveur: err('serveur') },
      essaisRatesHier: { pannes: ess('reservation.panne'), refus: ess('reservation.refusee') },
    };
  });

  const nomsTaches = Object.fromEntries(taches.map((t) => [t.id, t.nom]));
  const agents = [...taches.map((t) => t.id), 'daily-metrics', 'automation-sequences'].filter((v, i, a) => a.indexOf(v) === i).map((id) => {
    const p = passages.find((x) => x.task_name === id) || {};
    const t = taches.find((x) => x.id === id) || {};
    return {
      agent: nomsTaches[id] || ({ 'daily-metrics': 'Les chiffres du jour', 'automation-sequences': 'Les relances automatiques' })[id] || id,
      passagesHier: nombre(p.ok),
      echecsHier: nombre(p.echecs),
      dernierPassageReussi: moment(t.dernierOk),
      // La cause en mots simples, jamais le message technique recopie (2026-11-13).
      derniereErreur: p.derniere_erreur ? T.causeLisible(String(p.derniere_erreur)) : '',
    };
  });

  const ouverts = new Map();
  const regles = new Map();
  for (const run of historique) {
    const r = run.result || {};
    for (const o of Array.isArray(r.ouverts) ? r.ouverts : []) if (o && o.titre) ouverts.set(o.cle || o.titre, `${o.titre} (${moment(run.started_at)})`);
    for (const t of Array.isArray(r.regles) ? r.regles : []) if (t) regles.set(t, `${t} (${moment(run.started_at)})`);
  }
  const sauv = sauvegarde && sauvegarde.result ? sauvegarde.result : {};
  const cout = (cle) => arrondi((depense.find((x) => x.month === cle) || {}).cout);
  return {
    bilanDu: jourLisible(hier),
    hier,
    aujourdhui,
    moisDebut,
    centres: faitsCentres,
    agents,
    sauvegarde: sauvegarde ? { faiteLe: moment(sauvegarde.finished_at), lignes: nombre(sauv.lignes), tables: nombre(sauv.tables) } : null,
    problemes: {
      ouvertsEn24h: [...ouverts.values()],
      reglesEn24h: [...regles.values()],
      encoreOuverts: problemes.map((p) => `${p.titre}${p.gravite === 'critique' ? ' (urgent)' : ''}`),
    },
    depenseIA: { agentsMarketingDuMois: cout(aujourdhui.slice(0, 7)), plafondAgents: Number(process.env.LLM_MONTHLY_BUDGET_USD) || 5, bilanDuMois: cout(`${aujourdhui.slice(0, 7)}:garde`), plafondBilan: Number(process.env.LLM_GARDE_BUDGET_USD) || 2 },
    illisibles,
  };
}

// LE TEXTE DES REGLES (refait le 2026-11-13, Ansar : « c’est pas clair, j’comprends rien ») : court, le
// plus important d abord. Ce qu Ansar fait, ce que les equipes ont a faire, les problemes, puis chaque
// centre en deux a quatre lignes, puis le fond (taches, sauvegarde, IA). Un compte a zero ne s ecrit
// pas, sauf quand il dit que tout va bien. Le detail reste dans la console et dans Modifications.
// C est lui qui part quand le texte de l IA est refuse.
const TROIS_AU_PLUS = 3;
const liste = (l) => `${l.slice(0, TROIS_AU_PLUS).join(' ; ')}${l.length > TROIS_AU_PLUS ? ` ; et ${l.length - TROIS_AU_PLUS} autres` : ''}`;
const minuscule = (t) => String(t || '').charAt(0).toLowerCase() + String(t || '').slice(1);
// Un titre retenu par une version d avant (« Panne du serveur, api/ops ») ne se recopie pas.
const titreLisible = (titre) => (T.motInterdit(titre) ? 'un problème signalé plus tôt' : titre);
const fois = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
function bilanEnRegles(f) {
  const out = [`Pinlane : bilan du ${f.bilanDu}.`];
  const ouverts = f.problemes.encoreOuverts.map(titreLisible);
  const urgents = ouverts.filter((p) => /\(urgent\)$/.test(p)).length;
  out.push(urgents
    ? `Ce que tu fais : regarde ${urgents > 1 ? `les ${urgents} problèmes urgents` : 'le problème urgent'} dans la Tour de contrôle.`
    : 'Rien à faire : aucun problème urgent ce matin.');
  const equipes = f.centres.map((c) => {
    const t = [];
    if (c.aujourdhui.aValider) t.push(`valider ${pluriel(c.aujourdhui.aValider, 'réservation', 'réservations')}`);
    if (c.demandesDeGroupe.enAttente) t.push(`répondre à ${pluriel(c.demandesDeGroupe.enAttente, 'demande de groupe', 'demandes de groupe')}`);
    if (c.mailsHier.revenus) t.push(`appeler ${pluriel(c.mailsHier.revenus, 'client', 'clients')} dont le mail est revenu`);
    return t.length ? `${c.centre} doit ${t.join(', ')}` : '';
  }).filter(Boolean);
  if (equipes.length) out.push(`Pour les équipes : ${equipes.join(' ; ')}.`);
  if (ouverts.length) out.push(`Encore ouverts : ${liste(ouverts)}.`);
  const apparus = f.problemes.ouvertsEn24h.map(titreLisible);
  const regles = f.problemes.reglesEn24h.map(titreLisible);
  if (apparus.length) out.push(`Apparus en 24 h : ${liste(apparus)}.`);
  if (regles.length) out.push(`Réglés en 24 h : ${liste(regles)}.`);

  for (const c of f.centres) {
    const r = c.recuesHier;
    const v = c.visitesHier;
    const a = c.aujourdhui;
    const mo = c.moisEnCours;
    const d = c.demandesDeGroupe;
    const ml = c.mailsHier;
    const p = c.plantagesHier;
    const e = c.essaisRatesHier;
    out.push('');
    if (!r.total && !v.reservations && !a.reservations && !d.recuesHier) {
      out.push(`${c.centre} : rien hier, rien de prévu aujourd’hui. Le mois : ${euros(mo.ca)}.`);
      continue;
    }
    const groupes = d.recuesHier ? pluriel(d.recuesHier, 'demande de groupe', 'demandes de groupe') : '';
    out.push(r.total
      ? `${c.centre} : ${pluriel(r.total, 'réservation reçue', 'réservations reçues')} hier (${r.enLigne} en ligne, ${r.auComptoir} au comptoir), ${euros(r.montantReserve)}${r.dejaAnnulees ? `, ${fois(r.dejaAnnulees, 'déjà annulée')}` : ''}${groupes ? `, et ${groupes}` : ''}.`
      : `${c.centre} : aucune réservation reçue hier${groupes ? `, ${groupes}` : ''}.`);
    const pasVenus = [v.annulees ? fois(v.annulees, 'annulée') : '', v.absentes ? fois(v.absentes, 'absente') : ''].filter(Boolean);
    out.push(v.reservations
      ? `Visites d’hier : ${pluriel(v.reservations, 'réservation', 'réservations')}, ${pluriel(v.personnes, 'personne', 'personnes')}, ${euros(v.ca)}, encaissé ${euros(v.encaisse)}${pasVenus.length ? ` ; ${pasVenus.join(', ')}` : ''}.`
      : 'Visites d’hier : aucune.');
    out.push(`${a.reservations ? `Aujourd’hui : ${pluriel(a.reservations, 'réservation', 'réservations')}, ${pluriel(a.personnes, 'personne', 'personnes')}, ${euros(a.ca)} prévus.` : 'Aujourd’hui : rien de prévu.'} Le mois : ${euros(mo.ca)}, encaissé ${euros(mo.encaisse)}.`);
    const soucis = [
      ml.echecs ? pluriel(ml.echecs, 'mail pas parti', 'mails pas partis') : '',
      ml.revenus ? pluriel(ml.revenus, 'mail revenu', 'mails revenus') : '',
      ml.indesirables ? `${pluriel(ml.indesirables, 'mail classé', 'mails classés')} indésirable${ml.indesirables > 1 ? 's' : ''}` : '',
      p.formulaire ? pluriel(p.formulaire, 'erreur au formulaire', 'erreurs au formulaire') : '',
      p.console ? pluriel(p.console, 'erreur dans la console', 'erreurs dans la console') : '',
      p.serveur ? pluriel(p.serveur, 'panne interne', 'pannes internes') : '',
      e.pannes ? pluriel(e.pannes, 'réservation en ligne ratée sur une panne', 'réservations en ligne ratées sur une panne') : '',
      e.refus ? pluriel(e.refus, 'réservation en ligne refusée', 'réservations en ligne refusées') : '',
    ].filter(Boolean);
    if (soucis.length) out.push(`À surveiller : ${soucis.join(', ')}.`);
  }

  out.push('');
  const ratees = f.agents.filter((a) => a.echecsHier > 0);
  out.push(ratees.length
    ? `Tâches de fond : ${ratees.map((a) => `${minuscule(a.agent)} a raté ${a.echecsHier} fois hier${a.derniereErreur ? ` (${minuscule(a.derniereErreur).replace(/\.$/, '')})` : ''}`).join(' ; ')}.`
    : 'Tâches de fond : toutes ont tourné hier.');
  const ia = f.depenseIA;
  const usd = (n) => `${String(n).replace('.', ',')} $`;
  out.push(`${f.sauvegarde ? `Sauvegarde faite le ${f.sauvegarde.faiteLe}` : 'Pas de sauvegarde trouvée cette nuit'}. Dépense IA du mois : ${usd(ia.agentsMarketingDuMois)} sur ${usd(ia.plafondAgents)} pour les agents marketing, ${usd(ia.bilanDuMois)} sur ${usd(ia.plafondBilan)} pour ce bilan.`);
  if (f.illisibles.length) out.push(`Pas lu ce matin : ${f.illisibles.join(', ')}.`);
  return out.join('\n');
}

// Tous les nombres d un texte, ecrits a la francaise ou non, ramenes a une meme forme.
function nombres(texte) {
  const out = [];
  for (const m of String(texte).matchAll(/\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g)) {
    const v = Number(m[0].replace(/[   ]/g, '').replace(',', '.'));
    if (Number.isFinite(v)) out.push(String(Math.round(v * 100) / 100));
  }
  return out;
}

function nombresDesFaits(faits) {
  const permis = new Set();
  const visiter = (v) => {
    if (typeof v === 'number') permis.add(String(Math.round(v * 100) / 100));
    else if (typeof v === 'string') for (const n of nombres(v)) permis.add(n);
    else if (Array.isArray(v)) v.forEach(visiter);
    else if (v && typeof v === 'object') Object.values(v).forEach(visiter);
  };
  visiter(faits);
  return permis;
}

// Le texte de l IA passe s il ne cite que des nombres des faits, sans tiret long ni
// mise en forme. Rend { ok, texte, inconnus }.
function relireTexteIA(texte, faits, { consigne = '' } = {}) {
  const propre = String(texte || '')
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    .replace(/\*\*|__/g, '')
    .replace(/^#+\s*/gm, '')
    .trim();
  // Les nombres de la consigne elle-meme (« 24 heures ») sont permis. La consigne n en porte
  // pas d autre : une liste numerotee y laisserait passer un faux compte de 1 a 7.
  const permis = nombresDesFaits(faits);
  for (const n of nombres(consigne)) permis.add(n);
  const inconnus = [...new Set(nombres(propre).filter((n) => !permis.has(n)))];
  return { ok: Boolean(propre) && inconnus.length === 0, texte: propre, inconnus };
}

const CONSIGNE_BILAN = [
  'Tu écris le bilan du matin de Pinlane, le logiciel de réservation des centres de loisirs Fun Galaxy, pour Ansar, le fondateur.',
  'Tu pars des FAITS que le code a comptés (JSON dans le message). Ansar n’est pas informaticien : il veut savoir en une minute si tout va bien et ce qu’il doit faire.',
  'Règles absolues :',
  '- Français simple, phrases courtes, tutoiement. Aucun mot technique ni anglais, aucun message d’erreur recopié, aucun nom de code.',
  '- N’écris AUCUN nombre absent des faits : pas de total, pas de pourcentage, pas de moyenne, pas d’estimation. Recopie les nombres tels quels. Écris les montants avec deux décimales après une virgule, une espace entre les milliers, suivis de « € ».',
  '- N’invente aucune cause. Si les faits ne disent pas pourquoi, dis seulement ce qui s’est passé.',
  '- Jamais de tiret long ni de tiret moyen, pas d’astérisque, pas de dièse, pas d’emoji, pas de titre en majuscules.',
  '- Ne commence pas par un titre ni par une date : le code ajoute la première ligne.',
  '- Les champs payees, annulees et absentes comptent des réservations, pas des personnes (absente : le groupe n’est pas venu).',
  '- La dépense IA (depenseIA) est en dollars : écris « $ », jamais « € ».',
  '- Vingt lignes au plus, chacune courte.',
  'Ordre, le plus important d’abord :',
  'Première ligne : « Ce que tu fais : … » s’il y a un problème urgent (un titre de encoreOuverts qui finit par « (urgent) »), sinon « Rien à faire : … » en une phrase.',
  'Puis, s’il y en a, ce que chaque équipe a à faire : réservations à valider, demandes de groupe en attente, clients à appeler dont le mail est revenu.',
  'Puis les problèmes encore ouverts, apparus ou réglés, en une ou deux lignes.',
  'Puis chaque centre, en commençant la ligne par son nom suivi de « : », en deux ou trois lignes : reçues hier, visites d’hier et leur chiffre d’affaires, aujourd’hui. Un centre sans activité tient en une ligne.',
  'Enfin une ou deux lignes : les tâches de fond qui ont raté (sinon, qu’elles ont toutes tourné), la sauvegarde, la dépense IA.',
  'Si la liste « illisibles » n’est pas vide, termine par une ligne qui dit ce qui n’a pas pu être lu.',
].join('\n');

async function rediger(consigne, faits, { llm, maxTokens }) {
  const appeler = llm || require('./llm-client').callLlm;
  const r = await appeler({
    system: consigne,
    user: JSON.stringify(faits),
    maxTokens,
    timeoutMs: 50_000,
    usage: 'garde',
    budget: 'garde',
    model: MODELE(),
    effort: 'low',
  });
  return r && r.text ? r.text : '';
}

// Rend le texte a envoyer, toujours, et comment il a ete ecrit. Le texte de l IA ne part que s il ne cite
// que des nombres des faits, nomme chaque centre et passe le gabarit des alertes (lib/alertes-texte.js,
// genre « bilan ») ; sinon le texte des regles part, sans note pour Ansar : la raison va au journal du
// serveur (2026-11-13 : « (Écrit par les règles ce matin : … ») ne lui disait rien d utile).
async function bilanDuMatin(pool, { tour, instant = new Date(), llm, database } = {}) {
  const faits = await faitsDuBilan(pool, { instant, centres: tour.centres || [], taches: tour.taches || [], problemes: tour.problemes || [], database });
  const regles = bilanEnRegles(faits);
  let brut = '';
  try {
    brut = await rediger(CONSIGNE_BILAN, faits, { llm, maxTokens: 8000 });
  } catch (error) {
    brut = '';
  }
  if (!brut) return { texte: regles, par: 'regles', raison: 'muet', faits };
  const relu = relireTexteIA(brut, faits, { consigne: CONSIGNE_BILAN });
  const texte = `Pinlane : bilan du ${faits.bilanDu}.\n${relu.texte}`;
  const centresCites = faits.centres.every((c) => relu.texte.toLowerCase().includes(String(c.centre).toLowerCase()));
  const fautes = T.controlerTexte(texte, { genre: 'bilan' });
  if (!relu.ok || !centresCites || relu.texte.length < 200 || fautes.length) {
    const raison = !relu.ok ? 'nombre' : !centresCites ? 'centre' : fautes.length ? 'gabarit' : 'court';
    console.error('[bilan-du-matin] texte de l IA refuse', JSON.stringify({ raison, inconnus: relu.inconnus.slice(0, 10), fautes: fautes.slice(0, 5), longueur: relu.texte.length }));
    return { texte: regles, par: 'regles', raison, faits, refuse: relu.inconnus };
  }
  return { texte, par: 'ia', faits };
}

module.exports = { bilanDuMatin, bilanEnRegles, faitsDuBilan, minuitBelge, nombres, relireTexteIA, CONSIGNE_BILAN };
