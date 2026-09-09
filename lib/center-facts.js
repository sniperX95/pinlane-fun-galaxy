// La fiche de faits d'un centre : tout ce que le registre sait dire, chaque
// fait accompagné de sa preuve (combien d'observations, sur quelle fenêtre,
// combien de mois, et la dérivation pour rejouer le calcul à la main).
//
// POURQUOI CE MODULE EXISTE
// Relevé du 2026-09-09 : pour écrire une idée, le modèle recevait UN seul
// chiffre (le champ dataBasis de deriveIdeaCandidates : une température, ou
// des millimètres de pluie) plus une phrase déjà rédigée, avec interdiction
// d'ajouter quoi que ce soit. Sur le chemin des questions, lib/marketing-ask.js
// plafonne à MAX_FACTS = 5, et aucun de ces cinq faits ne parle d'argent, de
// clients, de formules ni du catalogue. Quatre des cinq familles d'idées ne
// regardent que la météo et le calendrier, deux choses que le gérant a déjà.
// Le registre, lui, porte 30 colonnes par réservation et personne ne les lit.
//
// La fiche est PURE : elle prend des lignes et rend des faits. Le chargeur DB
// vit en bas du fichier et n'ajoute aucune règle.
const { fait, elire, distributionSuspecte, N_POUR_ELIRE } = require('./center-guards');
// La liste des statuts actifs vient du produit, elle ne se redéfinit pas ici.
// Première version : une liste écrite à la main qui contenait 'confirmed',
// 'completed' et 'seated' (trois statuts qui n'existent nulle part en base) et
// qui OUBLIAIT 'paid', le plus courant (301 lignes, 51 435 EUR au relevé du
// 2026-09-09). La fiche jetait donc la majorité du registre en silence.
const { ACTIVE_STATUSES } = require('./direction-analytics');

const JOURS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
// Une réservation annulée ne compte pas dans l'activité, mais elle compte dans
// le taux d'annulation : les deux lectures sont distinctes plus bas.
const STATUTS_ACTIFS = ACTIVE_STATUSES;

// Heure et jour LOCAUX du centre. getHours() rendrait l'heure du serveur, qui
// est UTC sur Vercel : en été la Belgique est à UTC+2, donc une commande passée
// à 21h ressortirait à 19h. Un fait dont l'unique usage est de répondre à
// « quand publier » ne peut pas être décalé de deux heures.
// Jumeau privé de getZonedParts (lib/ops-communications.js), non exporté là-bas
// et dont l'import tirerait tout ce module lourd sur le chemin marketing.
const FUSEAU_CENTRE = 'Europe/Brussels';
const FORMAT_ZONE = new Intl.DateTimeFormat('en-GB', {
  timeZone: FUSEAU_CENTRE, weekday: 'short', hour: '2-digit', hour12: false,
});
const JOUR_DEPUIS_ABREGE = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function heureEtJourLocaux(instant) {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const parts = FORMAT_ZONE.formatToParts(date);
  const lu = (type) => (parts.find((p) => p.type === type) || {}).value;
  const heure = Number(lu('hour'));
  const jour = JOUR_DEPUIS_ABREGE[lu('weekday')];
  if (!Number.isFinite(heure) || !Number.isFinite(jour)) return null;
  return { heure, jour };
}

const nombre = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const euros = (v) => Math.round(nombre(v));
const part = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const moisDe = (rows) => [...new Set(rows.map((r) => String(r.date || '').slice(0, 7)).filter(Boolean))];
const bornesDe = (rows) => {
  const dates = rows.map((r) => String(r.date || '')).filter(Boolean).sort();
  return { du: dates[0] || '', au: dates[dates.length - 1] || '' };
};

// Un fait calculé sur un sous-ensemble porte LES bornes de ce sous-ensemble,
// jamais celles du registre entier : sinon il emprunte une maturité qu'il n'a
// pas, et un fait de deux semaines passerait pour un fait de six mois.
function poseur(fiche, defaut) {
  return function poser(id, libelle, valeur, { n = 0, rows = null, genre = 'estimation', source = '' } = {}) {
    const fenetre = rows && rows.length ? { ...bornesDe(rows), mois: moisDe(rows) } : defaut;
    fiche[id] = fait({ id, libelle, valeur, n, genre, source, ...fenetre });
  };
}

// ── LA FICHE ────────────────────────────────────────────────────────────────
// `reservations` : lignes du registre, DÉJÀ débarrassées des lignes fabriquées
// par l'appelant (cf. chargerFicheDuRegistre). `formules` : le catalogue, pour
// voir ce qui ne se vend pas — invisible autrement, puisqu'une formule sans
// vente n'apparaît dans aucun regroupement sur les réservations.
function ficheDuRegistre({ reservations = [], formules = [], aujourdhui = '' } = {}) {
  const toutes = Array.isArray(reservations) ? reservations : [];
  const vivantes = toutes.filter((r) => STATUTS_ACTIFS.has(String(r.status)));
  const fiche = {};
  const global = { ...bornesDe(toutes), mois: moisDe(toutes) };
  const poser = poseur(fiche, global);

  poser('registre_taille', 'lignes du registre retenues', toutes.length, {
    n: toutes.length, rows: toutes, genre: 'denombrement', source: 'reservations du centre, lignes fabriquees exclues',
  });

  // Un registre vide n'est pas un centre calme : c'est une absence de matière.
  // Le dire explicitement évite que l'agent commente le néant.
  if (!vivantes.length) {
    poser('registre_vide', 'aucune reservation exploitable',
      'le registre ne contient aucune reservation active : rien ne peut etre affirme sur ce centre',
      { n: 0, genre: 'denombrement', source: 'aucun statut actif' });
    return fiche;
  }

  // ── VOLUME ET ARGENT ──────────────────────────────────────────────────────
  const ca = vivantes.reduce((s, r) => s + nombre(r.price), 0);
  const paxTotal = vivantes.reduce((s, r) => s + nombre(r.pax), 0);
  poser('resa_actives', 'reservations actives', vivantes.length, {
    n: vivantes.length, rows: vivantes, genre: 'denombrement', source: 'statut actif',
  });
  poser('ca_total', 'chiffre d affaires', `${euros(ca)} EUR`, {
    n: vivantes.length, rows: vivantes, genre: 'denombrement', source: 'somme des price',
  });
  poser('panier_moyen', 'panier moyen', `${euros(ca / vivantes.length)} EUR`, {
    n: vivantes.length, rows: vivantes, source: 'ca divise par le nombre de reservations',
  });
  poser('pax_total', 'personnes accueillies', paxTotal, {
    n: vivantes.length, rows: vivantes, genre: 'denombrement', source: 'somme des pax',
  });
  if (paxTotal) {
    poser('ca_par_personne', 'chiffre par personne', `${euros(ca / paxTotal)} EUR`, {
      n: vivantes.length, rows: vivantes, source: 'ca divise par le nombre de personnes',
    });
    poser('pax_moyen', 'personnes par reservation',
      Math.round((paxTotal / vivantes.length) * 10) / 10, {
        n: vivantes.length, rows: vivantes, source: 'pax divise par le nombre de reservations',
      });
  }

  // ── JOURS DE VENUE ────────────────────────────────────────────────────────
  const parJour = {};
  vivantes.forEach((r) => {
    const jour = new Date(`${r.date}T00:00:00Z`).getUTCDay();
    if (!Number.isFinite(jour)) return;
    (parJour[jour] = parJour[jour] || []).push(r);
  });
  const joursClasses = Object.entries(parJour)
    .map(([jour, rows]) => ({ jour: Number(jour), rows, n: rows.length, ca: rows.reduce((s, r) => s + nombre(r.price), 0) }));
  // Un pire jour ne veut rien dire sans meilleur jour : les deux s'élisent, et
  // s'il n'y a pas assez de matière il n'y a pas de verdict.
  const meilleur = elire(joursClasses, (j) => j.n);
  const pire = elire(joursClasses, (j) => -j.n);
  if (meilleur.elu && pire.elu && meilleur.elu.jour !== pire.elu.jour) {
    poser('jour_fort', 'jour de semaine le plus rempli',
      `${JOURS_FR[meilleur.elu.jour]} : ${meilleur.elu.n} reservations, ${euros(meilleur.elu.ca)} EUR`,
      { n: meilleur.elu.n, rows: meilleur.elu.rows, source: `groupe par jour de semaine, minimum ${N_POUR_ELIRE} observations` });
    poser('jour_creux', 'jour de semaine le plus creux',
      `${JOURS_FR[pire.elu.jour]} : ${pire.elu.n} reservations, ${euros(pire.elu.ca)} EUR`,
      { n: pire.elu.n, rows: pire.elu.rows, source: `groupe par jour de semaine, minimum ${N_POUR_ELIRE} observations` });
  }

  // ── QUAND LES CLIENTS COMMANDENT ──────────────────────────────────────────
  // Calculé nulle part aujourd'hui, et c'est pourtant la seule donnée qui
  // réponde à « quand publier ». L'agent répète « poste 2-3 jours avant »
  // parce que c'est écrit en dur dans un gabarit, jamais parce qu'il a regardé.
  const avecCreation = vivantes.filter((r) => r.created_at);
  if (avecCreation.length) {
    const parHeure = {};
    const parJourCommande = {};
    avecCreation.forEach((r) => {
      const local = heureEtJourLocaux(r.created_at);
      if (!local) return;
      parHeure[local.heure] = (parHeure[local.heure] || 0) + 1;
      parJourCommande[local.jour] = (parJourCommande[local.jour] || 0) + 1;
    });
    // Une masse écrasée sur un seul seau ne parle pas des clients : elle parle
    // de la fabrication de la donnée. Le fait porte ce constat au lieu de le
    // cacher, sinon l'agent conseille de publier à minuit.
    const heureSuspecte = distributionSuspecte(parHeure);
    const topHeures = Object.entries(parHeure).sort((a, b) => b[1] - a[1]).slice(0, 3);
    poser('heure_de_commande', 'heures ou les clients passent commande',
      heureSuspecte.suspecte
        ? `inexploitable : ${heureSuspecte.motif}`
        : topHeures.map(([h, n]) => `${h}h (${n})`).join(', '),
      { n: heureSuspecte.suspecte ? 0 : avecCreation.length, rows: avecCreation, source: 'heure de created_at' });

    const jourSuspect = distributionSuspecte(parJourCommande);
    const topJour = Object.entries(parJourCommande).sort((a, b) => b[1] - a[1])[0];
    poser('jour_de_commande', 'jour ou les clients passent commande',
      jourSuspect.suspecte
        ? `inexploitable : ${jourSuspect.motif.replace(`"${jourSuspect.seauDominant}"`, JOURS_FR[jourSuspect.seauDominant])}`
        : `${JOURS_FR[topJour[0]]} (${topJour[1]})`,
      { n: jourSuspect.suspecte ? 0 : avecCreation.length, rows: avecCreation, source: 'jour de created_at' });

    const delais = avecCreation
      .map((r) => Math.round((new Date(r.date) - new Date(r.created_at)) / 86400000))
      .filter((d) => d >= 0)
      .sort((a, b) => a - b);
    if (delais.length) {
      poser('anticipation_mediane', 'jours entre la commande et la venue',
        `${delais[Math.floor(delais.length / 2)]} jours`,
        { n: delais.length, rows: avecCreation, source: 'mediane de date moins created_at' });
      poser('part_derniere_minute', 'part commandee a moins de 48 heures',
        `${part(delais.filter((d) => d <= 2).length, delais.length)} %`,
        { n: delais.length, rows: avecCreation, source: 'delai inferieur ou egal a 2 jours' });
    }
  }

  // ── LE CATALOGUE, Y COMPRIS CE QUI DORT ───────────────────────────────────
  const catalogue = Array.isArray(formules) ? formules : [];
  const actives = catalogue.filter((f) => f.active);
  if (actives.length) {
    const vendues = new Set(vivantes.map((r) => r.formule_id).filter(Boolean));
    const dormantes = actives.filter((f) => !vendues.has(f.id));
    poser('catalogue_actif', 'formules actives au catalogue', actives.length, {
      n: actives.length, rows: vivantes, genre: 'denombrement', source: 'table formulas, active vrai',
    });
    poser('formules_jamais_vendues', 'formules actives sans une seule vente',
      dormantes.length
        ? `${dormantes.length} : ${dormantes.map((f) => f.name).filter(Boolean).join(', ')}`
        : 'aucune',
      {
        n: dormantes.length, rows: vivantes, genre: 'denombrement',
        source: 'catalogue actif moins les formule_id vus dans le registre',
      });
  }

  const parFormule = {};
  vivantes.forEach((r) => {
    const cle = r.formule_id || r.type || 'sans formule';
    (parFormule[cle] = parFormule[cle] || []).push(r);
  });
  const formulesClassees = Object.entries(parFormule).map(([cle, rows]) => ({
    cle,
    rows,
    n: rows.length,
    ca: rows.reduce((s, r) => s + nombre(r.price), 0),
    nom: (catalogue.find((f) => f.id === cle) || {}).name || cle,
  }));
  const locomotive = elire(formulesClassees, (f) => f.n);
  if (locomotive.elu) {
    poser('formule_locomotive', 'formule la plus vendue',
      `${locomotive.elu.nom} : ${locomotive.elu.n} ventes, ${euros(locomotive.elu.ca)} EUR, `
      + `${part(locomotive.elu.ca, ca)} % du chiffre`,
      { n: locomotive.elu.n, rows: locomotive.elu.rows, source: 'groupe par formule, classe par nombre de ventes' });
  }
  const rentable = elire(formulesClassees, (f) => f.ca / f.n);
  if (rentable.elu) {
    poser('formule_meilleur_panier', 'formule au panier le plus eleve',
      `${rentable.elu.nom} : ${euros(rentable.elu.ca / rentable.elu.n)} EUR par reservation`
      + (rentable.ecartes ? ` (${rentable.ecartes} formules trop peu vendues ecartees du classement)` : ''),
      { n: rentable.elu.n, rows: rentable.elu.rows, source: `panier moyen par formule, minimum ${N_POUR_ELIRE} ventes` });
  } else if (formulesClassees.length) {
    poser('formule_meilleur_panier', 'formule au panier le plus eleve',
      `pas de vainqueur : ${rentable.motif}`,
      { n: 0, rows: vivantes, genre: 'denombrement', source: 'classement refuse faute de volume' });
  }

  // ── CLIENTS ───────────────────────────────────────────────────────────────
  const parClient = new Map();
  vivantes.forEach((r) => {
    const cle = String(r.email || r.name || '').toLowerCase().trim();
    if (!cle) return;
    const profil = parClient.get(cle) || { rows: [] };
    profil.rows.push(r);
    parClient.set(cle, profil);
  });
  const clients = [...parClient.values()];
  if (clients.length) {
    const fideles = clients.filter((p) => p.rows.length > 1);
    poser('clients_uniques', 'clients distincts', clients.length, {
      n: clients.length, rows: vivantes, genre: 'denombrement', source: 'cle email sinon nom',
    });
    poser('taux_retour', 'part des clients revenus au moins deux fois',
      `${part(fideles.length, clients.length)} %`,
      { n: clients.length, rows: vivantes, source: 'clients ayant plus d une reservation' });

    if (aujourdhui) {
      const dormants = clients.filter((p) => {
        const dernier = p.rows.map((r) => r.date).sort().pop();
        return (new Date(aujourdhui) - new Date(dernier)) / 86400000 > 90;
      });
      const caDormants = dormants.reduce((s, p) => s + p.rows.reduce((x, r) => x + nombre(r.price), 0), 0);
      poser('clients_dormants', 'clients sans visite depuis plus de 90 jours',
        `${dormants.length} clients, ${euros(caDormants)} EUR deja depenses`,
        {
          n: dormants.length, rows: vivantes, genre: 'denombrement',
          source: 'derniere visite anterieure a 90 jours avant la date du jour',
        });
    }
  }

  // ── ANNULATIONS ───────────────────────────────────────────────────────────
  const annulees = toutes.filter((r) => String(r.status) === 'cancelled');
  poser('taux_annulation', 'part des reservations annulees',
    `${part(annulees.length, toutes.length)} %`,
    { n: toutes.length, rows: toutes, source: 'statut cancelled sur le total' });
  if (annulees.length) {
    poser('argent_annule', 'chiffre perdu en annulations',
      `${euros(annulees.reduce((s, r) => s + nombre(r.price), 0))} EUR`,
      { n: annulees.length, rows: annulees, genre: 'denombrement', source: 'somme des price annules' });
  }

  // ── CE QUE LE REGISTRE NE SAIT PAS ────────────────────────────────────────
  // Un agent qui ignore les trous de sa propre donnée conclut sur du vide. Il
  // doit savoir ce qu'il ne sait pas, et le dire avant qu'on le lui demande.
  [
    ['trou_email', 'reservations sans adresse email', 'email'],
    ['trou_paiement', 'reservations sans moyen de paiement', 'payment_method'],
    ['trou_occasion', 'reservations sans occasion declaree', 'occasion'],
  ].forEach(([id, libelle, champ]) => {
    const manquants = vivantes.filter((r) => !String(r[champ] || '').trim()).length;
    poser(id, libelle, `${manquants} sur ${vivantes.length} (${part(manquants, vivantes.length)} %)`, {
      n: vivantes.length, rows: vivantes, genre: 'denombrement', source: `champ ${champ} vide`,
    });
  });

  return fiche;
}

// ── CHARGEUR ────────────────────────────────────────────────────────────────
// Lecteur ANALYTIQUE : l'exclusion des lignes fabriquées s'applique ici, et
// jamais aux lecteurs de capacité (cf. la règle d'emploi de
// lib/simulation-filter.js). Le prédicat existe déjà et attrape les DEUX
// marqueurs : les channels de simulation et le domaine du jeu de
// démonstration. Sans lui, la fiche compte 517 lignes fabriquées comme des
// clients, et un envoi de campagne part vers autant d'adresses inexistantes.
async function chargerFicheDuRegistre({ centerId = 'libramont', aujourdhui = '', pool } = {}) {
  const { getPool } = require('./database');
  const { fabricatedSqlPredicate, demonstrationEmailPattern } = require('./simulation-filter');
  const client = pool || getPool();
  const reservations = await client.query(
    `
      select date::text as date, start_time, duration, lanes, pax, status, channel,
             base_price, price, type, formule_id, label, extras, occasion, email, name,
             created_at, payment_method
        from reservations
       where center_id = $1
         and not ${fabricatedSqlPredicate(2)};
    `,
    [centerId, demonstrationEmailPattern()],
  );
  const formules = await client.query(
    'select id, name, min_pax, price_type, price_value, is_birthday_formula, active from formulas;',
  );
  return ficheDuRegistre({
    reservations: reservations.rows,
    formules: formules.rows,
    aujourdhui,
  });
}

module.exports = {
  ficheDuRegistre,
  chargerFicheDuRegistre,
  JOURS_FR,
  STATUTS_ACTIFS,
};
