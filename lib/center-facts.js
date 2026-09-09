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
// Indice 0 vide : les mois arrivent en '01'..'12' depuis la date, on indexe
// donc directement par leur numero sans decalage a retenir.
const MOIS_FR = ['', 'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
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
  return function poser(id, libelle, valeur, { n = 0, rows = null, genre = 'estimation', source = '', periode = '' } = {}) {
    const fenetre = rows && rows.length ? { ...bornesDe(rows), mois: moisDe(rows) } : defaut;
    fiche[id] = fait({ id, libelle, valeur, n, genre, source, periode, ...fenetre });
  };
}

// ── LA FICHE ────────────────────────────────────────────────────────────────
// `reservations` : lignes du registre, DÉJÀ débarrassées des lignes fabriquées
// par l'appelant (cf. chargerFicheDuRegistre). `formules` : le catalogue, pour
// voir ce qui ne se vend pas : invisible autrement, puisqu'une formule sans
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
      { n: meilleur.elu.n, rows: meilleur.elu.rows, periode: 'jour_semaine', source: `groupe par jour de semaine, minimum ${N_POUR_ELIRE} observations` });
    poser('jour_creux', 'jour de semaine le plus creux',
      `${JOURS_FR[pire.elu.jour]} : ${pire.elu.n} reservations, ${euros(pire.elu.ca)} EUR`,
      { n: pire.elu.n, rows: pire.elu.rows, periode: 'jour_semaine', source: `groupe par jour de semaine, minimum ${N_POUR_ELIRE} observations` });
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
      { n: heureSuspecte.suspecte ? 0 : avecCreation.length, rows: avecCreation, periode: 'heure_jour', source: 'heure de created_at' });

    const jourSuspect = distributionSuspecte(parJourCommande);
    const topJour = Object.entries(parJourCommande).sort((a, b) => b[1] - a[1])[0];
    poser('jour_de_commande', 'jour ou les clients passent commande',
      jourSuspect.suspecte
        ? `inexploitable : ${jourSuspect.motif.replace(`"${jourSuspect.seauDominant}"`, JOURS_FR[jourSuspect.seauDominant])}`
        : `${JOURS_FR[topJour[0]]} (${topJour[1]})`,
      { n: jourSuspect.suspecte ? 0 : avecCreation.length, rows: avecCreation, periode: 'jour_semaine', source: 'jour de created_at' });

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

  // ── CRENEAU DE VENUE ──────────────────────────────────────────────────────
  // La fiche savait a quelle heure les clients COMMANDENT. Elle ne savait pas a
  // quelle heure ils VIENNENT, alors que c'est la seule des deux qui remplit une
  // piste. Trou trouve en listant ce que la fiche ignorait encore.
  const parCreneau = {};
  vivantes.forEach((r) => {
    const heure = String(r.start_time || '').slice(0, 2);
    if (!/^[0-9]{2}$/.test(heure)) return;
    (parCreneau[heure] = parCreneau[heure] || []).push(r);
  });
  const creneauxClasses = Object.entries(parCreneau).map(([heure, rows]) => ({
    heure, rows, n: rows.length, ca: rows.reduce((s, r) => s + nombre(r.price), 0),
  }));
  // Meme garde que pour les heures de commande : une masse ecrasee sur un seul
  // creneau est un fait sur le script qui a cree la donnee, pas sur les clients.
  const creneauxSuspects = distributionSuspecte(
    Object.fromEntries(creneauxClasses.map((c) => [c.heure, c.n])),
  );
  if (creneauxSuspects.suspecte) {
    poser('creneau_artefact', 'heures d arrivee inexploitables',
      creneauxSuspects.motif,
      { n: vivantes.length, rows: vivantes, genre: 'denombrement', source: 'part du creneau dominant dans start_time' });
  } else {
    const creneauPlein = elire(creneauxClasses, (c) => c.n);
    const creneauVide = elire(creneauxClasses, (c) => -c.n);
    if (creneauPlein.elu && creneauVide.elu && creneauPlein.elu.heure !== creneauVide.elu.heure) {
      poser('creneau_fort', 'heure d arrivee la plus demandee',
        `${creneauPlein.elu.heure} h : ${creneauPlein.elu.n} reservations, ${euros(creneauPlein.elu.ca)} EUR`,
        { n: creneauPlein.elu.n, rows: creneauPlein.elu.rows, periode: 'heure_jour', source: `groupe par heure de start_time, minimum ${N_POUR_ELIRE} observations` });
      poser('creneau_creux', 'heure d arrivee la moins demandee',
        `${creneauVide.elu.heure} h : ${creneauVide.elu.n} reservations, ${euros(creneauVide.elu.ca)} EUR`,
        { n: creneauVide.elu.n, rows: creneauVide.elu.rows, periode: 'heure_jour', source: `groupe par heure de start_time, minimum ${N_POUR_ELIRE} observations` });
    }
    if (creneauxClasses.length) {
      const heures = creneauxClasses.map((c) => c.heure).sort();
      poser('amplitude_horaire', 'plage horaire reellement utilisee',
        `de ${heures[0]} h a ${heures[heures.length - 1]} h`,
        { n: vivantes.length, rows: vivantes, genre: 'denombrement', source: 'heure minimale et maximale observees dans start_time' });
    }
  }

  // ── SAISON ────────────────────────────────────────────────────────────────
  // Un fait COMPARATIF porte la fenetre de la COMPARAISON, pas celle du
  // vainqueur. « juillet est ton meilleur mois » ne se juge que face aux autres
  // mois : lui donner les bornes des seuls juillets (deux annees, donc deux mois
  // distincts) lui interdirait a jamais de porter une affirmation saisonniere,
  // alors que c'est exactement ce qu'il est.
  // Pour le jour de la semaine la question ne se posait pas : chaque semaine a
  // un mardi, donc la fenetre des mardis egale celle du registre. Elle apparait
  // ici pour la premiere fois.
  const parMoisDeLAnnee = {};
  vivantes.forEach((r) => {
    const mois = String(r.date || '').slice(5, 7);
    if (!/^[0-9]{2}$/.test(mois)) return;
    (parMoisDeLAnnee[mois] = parMoisDeLAnnee[mois] || []).push(r);
  });
  const moisClasses = Object.entries(parMoisDeLAnnee).map(([mois, rows]) => ({
    mois, rows, n: rows.length, ca: rows.reduce((s, r) => s + nombre(r.price), 0),
  }));
  const moisPlein = elire(moisClasses, (m) => m.ca);
  const moisVide = elire(moisClasses, (m) => -m.ca);
  if (moisPlein.elu && moisVide.elu && moisPlein.elu.mois !== moisVide.elu.mois) {
    poser('mois_fort', 'mois de l annee le plus rentable',
      `${MOIS_FR[Number(moisPlein.elu.mois)]} : ${moisPlein.elu.n} reservations, ${euros(moisPlein.elu.ca)} EUR`,
      { n: moisPlein.elu.n, rows: vivantes, periode: 'mois_annee', source: `chiffre par mois de l annee, minimum ${N_POUR_ELIRE} observations, compare sur tout le registre` });
    poser('mois_creux', 'mois de l annee le moins rentable',
      `${MOIS_FR[Number(moisVide.elu.mois)]} : ${moisVide.elu.n} reservations, ${euros(moisVide.elu.ca)} EUR`,
      { n: moisVide.elu.n, rows: vivantes, periode: 'mois_annee', source: `chiffre par mois de l annee, minimum ${N_POUR_ELIRE} observations, compare sur tout le registre` });
  }

  // ── TAILLE DES GROUPES ────────────────────────────────────────────────────
  // La question de Movsar en toutes lettres : « les formules anniversaire sont a
  // 6 personnes minimum, est-ce que 8 serait plus rentable ? ». La fiche ne
  // repond pas, et c'est voulu : elle POSE la matiere, et
  // conseilDeRegleCommerciale interdit d'en tirer un changement de regle. Le
  // gerant decide, avec les chiffres sous les yeux.
  // Les bornes des tranches (6, 9, 10, 15, 16) deviennent des nombres citables :
  // c'est correct, elles font partie de l'enonce du fait (« 12 reservations
  // entre 6 et 9 personnes »), pas d'une invention du modele.
  const SEAUX_TAILLE = [
    { cle: 'moins de 6', test: (p) => p < 6 },
    { cle: '6 a 9', test: (p) => p >= 6 && p <= 9 },
    { cle: '10 a 15', test: (p) => p >= 10 && p <= 15 },
    { cle: '16 et plus', test: (p) => p >= 16 },
  ];
  const tailles = vivantes.map((r) => nombre(r.pax)).filter((p) => p > 0);
  if (tailles.length) {
    const repartition = SEAUX_TAILLE.map((seau) => {
      const rows = vivantes.filter((r) => nombre(r.pax) > 0 && seau.test(nombre(r.pax)));
      const caSeau = rows.reduce((s, r) => s + nombre(r.price), 0);
      return `${seau.cle} : ${rows.length} reservations (${part(rows.length, vivantes.length)} %), ${euros(caSeau)} EUR`;
    });
    poser('groupes_par_taille', 'repartition des reservations par taille de groupe',
      repartition.join(' | '),
      { n: vivantes.length, rows: vivantes, genre: 'denombrement', source: 'comptage des pax par tranche sur les reservations actives' });
    const triees = tailles.slice().sort((a, b) => a - b);
    poser('taille_mediane', 'taille de groupe mediane', triees[Math.floor(triees.length / 2)], {
      n: tailles.length, rows: vivantes, source: 'valeur centrale des pax des reservations actives, triees',
    });
  }

  // Le minimum de personnes est declare AU CATALOGUE, formule par formule. Ce
  // que la fiche dit : combien de reservations tombent sous ce minimum. Ce
  // qu'elle ne dira jamais : quel minimum il faudrait.
  const minParFormule = new Map(
    catalogue.filter((f) => nombre(f.min_pax) > 0).map((f) => [f.id, nombre(f.min_pax)]),
  );
  if (minParFormule.size) {
    const concernees = vivantes.filter((r) => minParFormule.has(r.formule_id));
    if (concernees.length) {
      const sous = concernees.filter((r) => nombre(r.pax) < minParFormule.get(r.formule_id));
      poser('sous_le_minimum_de_la_formule', 'reservations en dessous du minimum de leur formule',
        `${sous.length} sur ${concernees.length} (${part(sous.length, concernees.length)} %)`,
        {
          n: concernees.length, rows: concernees, genre: 'denombrement',
          source: 'pax compare au min_pax de la formule vendue, reservations actives',
        });
    }
  }

  // ── OCCASION ──────────────────────────────────────────────────────────────
  const avecOccasion = vivantes.filter((r) => String(r.occasion || '').trim());
  poser('occasions_renseignees', 'reservations dont l occasion est connue',
    `${avecOccasion.length} sur ${vivantes.length} (${part(avecOccasion.length, vivantes.length)} %)`,
    { n: vivantes.length, rows: vivantes, genre: 'denombrement', source: 'champ occasion non vide' });
  if (avecOccasion.length) {
    const parOccasion = {};
    avecOccasion.forEach((r) => {
      const cle = String(r.occasion).trim().toLowerCase();
      (parOccasion[cle] = parOccasion[cle] || []).push(r);
    });
    const occasionsClassees = Object.entries(parOccasion).map(([cle, rows]) => ({
      cle, rows, n: rows.length, ca: rows.reduce((s, r) => s + nombre(r.price), 0),
    }));
    const dominante = elire(occasionsClassees, (o) => o.n);
    if (dominante.elu) {
      poser('occasion_dominante', 'occasion la plus frequente',
        `${dominante.elu.cle} : ${dominante.elu.n} reservations, ${euros(dominante.elu.ca)} EUR`,
        { n: dominante.elu.n, rows: dominante.elu.rows, source: `groupe par occasion, minimum ${N_POUR_ELIRE} observations` });
    }
  }

  // ── CANAL ─────────────────────────────────────────────────────────────────
  const enLigne = vivantes.filter((r) => String(r.channel || '') === 'public');
  poser('part_reservee_en_ligne', 'part des reservations prises par le client lui-meme',
    `${enLigne.length} sur ${vivantes.length} (${part(enLigne.length, vivantes.length)} %)`,
    { n: vivantes.length, rows: vivantes, genre: 'denombrement', source: 'channel public contre tous les autres canaux' });

  // ── SEMAINE CONTRE WEEK-END ───────────────────────────────────────────────
  const weekEnd = vivantes.filter((r) => {
    const jour = new Date(`${r.date}T00:00:00Z`).getUTCDay();
    return jour === 0 || jour === 6;
  });
  if (ca) {
    poser('part_week_end', 'part du chiffre faite le samedi et le dimanche',
      `${part(weekEnd.reduce((s, r) => s + nombre(r.price), 0), ca)} % du chiffre pour `
      + `${part(weekEnd.length, vivantes.length)} % des reservations`,
      { n: vivantes.length, rows: vivantes, source: 'chiffre du samedi plus dimanche divise par le chiffre total' });
  }

  // ── TENDANCE ──────────────────────────────────────────────────────────────
  // Un etat ne dit pas un sens. « 120 reservations » ne repond pas a la seule
  // question que se pose un gerant le matin : ca monte ou ca descend ?
  // DEUX tendances, pas une. La FREQUENTATION se lit sur la date de venue, la
  // DEMANDE sur la date de commande. Elles divergent des que les clients
  // reservent a l'avance, et c'est la demande qui dit si le marketing marche :
  // une bonne semaine de ventes pour des dates de juillet ne se voit nulle part
  // dans la frequentation avant juillet.
  const ancreTendance = aujourdhui || bornesDe(vivantes).au;
  const jourZero = Date.parse(`${ancreTendance}T00:00:00Z`);
  if (Number.isFinite(jourZero)) {
    const FENETRE_MS = 90 * 86400000;
    const instantDe = (r, champ) => Date.parse(champ === 'date' ? `${r.date}T00:00:00Z` : String(r.created_at || ''));
    const entre = (champ, debut, fin) => vivantes.filter((r) => {
      const t = instantDe(r, champ);
      return Number.isFinite(t) && t > debut && t <= fin;
    });
    [['frequentation', 'date'], ['demande', 'created_at']].forEach(([nom, champ]) => {
      const recent = entre(champ, jourZero - FENETRE_MS, jourZero);
      const precedent = entre(champ, jourZero - 2 * FENETRE_MS, jourZero - FENETRE_MS);
      // Deux fenetres vides ne font pas une stabilite : elles font une absence de
      // mesure. Sans ce seuil, un centre a l'arret afficherait « stable », ce qui
      // est le mensonge le plus tranquille qu'une fiche puisse produire.
      if (recent.length < N_POUR_ELIRE || precedent.length < N_POUR_ELIRE) return;
      const caRecent = recent.reduce((s, r) => s + nombre(r.price), 0);
      const caPrecedent = precedent.reduce((s, r) => s + nombre(r.price), 0);
      const evolution = caPrecedent
        ? `${part(caRecent - caPrecedent, caPrecedent) >= 0 ? 'plus' : 'moins'} `
          + `${Math.abs(part(caRecent - caPrecedent, caPrecedent))} % de chiffre`
        : 'aucun chiffre sur la periode precedente, evolution non calculable';
      poser(`tendance_${nom}_90j`, `evolution de la ${nom} sur 90 jours`,
        `${recent.length} reservations et ${euros(caRecent)} EUR, contre ${precedent.length} et `
        + `${euros(caPrecedent)} EUR sur les 90 jours precedents : ${evolution}`,
        {
          n: recent.length + precedent.length,
          rows: recent.concat(precedent),
          periode: 'fenetre_glissante',
          source: `${champ} dans les 90 jours avant ${ancreTendance}, compare aux 90 jours d avant`,
        });
    });
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

// ── L'HORIZON : ce qui ARRIVE, a cote de ce qui S'EST PASSE ─────────────────
// La meteo, les conges et les evenements locaux etaient QUATRE des cinq
// familles d'idees, chacune avec sa phrase ecrite d'avance. Ils deviennent des
// faits comme les autres : le modele les voit a cote du registre et decide
// lui-meme s'ils meritent d'etre dits.
//
// Ce sont des DENOMBREMENTS : « il fera 30 degres lundi » se constate, ca ne
// s'estime pas. Consequence voulue de la couche « nature » : un tel fait porte
// un constat, mais JAMAIS un levier a lui seul (il n'a ni volume ni saisons).
// Recommander une action a cause de la meteo exige donc de citer AUSSI un fait
// du registre qui prouve que la meteo bouge vraiment la frequentation de CE
// centre. C'est exactement ce qui manquait : l'agent affirmait « 26 degres,
// rare par ici » sans avoir jamais regarde son propre historique.
function ajouterHorizon(fiche, { forecast = [], nextHoliday = null, localEvents = [], today = '' } = {}) {
  const enrichie = { ...fiche };
  const poser = poseur(enrichie, { du: today, au: today, mois: today ? [today.slice(0, 7)] : [] });

  const jours = Array.isArray(forecast) ? forecast.filter((j) => j && j.date) : [];
  if (jours.length) {
    const chauds = jours.filter((j) => nombre(j.tmax) >= 28);
    const pluvieux = jours.filter((j) => nombre(j.precipMm) >= 5);
    const fenetre = { du: jours[0].date, au: jours[jours.length - 1].date, mois: moisDe(jours) };
    poser('meteo_a_venir', 'temperatures annoncees sur les prochains jours',
      jours.map((j) => `${j.date} ${Math.round(nombre(j.tmax))} deg`).join(', '),
      { n: jours.length, rows: jours, genre: 'denombrement', source: 'weather_daily_forecast' });
    if (chauds.length) {
      poser('jours_chauds_annonces', 'jours annonces a 28 degres ou plus',
        chauds.map((j) => `${j.date} (${Math.round(nombre(j.tmax))} deg)`).join(', '),
        { n: chauds.length, rows: chauds, genre: 'denombrement', source: 'weather_daily_forecast, tmax >= 28' });
    }
    if (pluvieux.length) {
      poser('jours_pluvieux_annonces', 'jours annonces a 5 mm de pluie ou plus',
        pluvieux.map((j) => `${j.date} (${Math.round(nombre(j.precipMm))} mm)`).join(', '),
        { n: pluvieux.length, rows: pluvieux, genre: 'denombrement', source: 'weather_daily_forecast, precip >= 5' });
    }
    enrichie.meteo_a_venir = fait({ ...enrichie.meteo_a_venir, ...fenetre });
  }

  if (nextHoliday && nextHoliday.from) {
    poser('prochain_conge_scolaire', 'prochain conge scolaire FWB',
      `${nextHoliday.label || 'conge'} du ${nextHoliday.from} au ${nextHoliday.to || nextHoliday.from}`,
      { n: 1, genre: 'denombrement', source: 'calendrier FWB' });
  }

  const evenements = Array.isArray(localEvents) ? localEvents.filter(Boolean) : [];
  if (evenements.length) {
    poser('evenements_locaux', 'evenements locaux a venir',
      evenements.map((e) => `${e.label} (${e.from}${e.to && e.to !== e.from ? ` -> ${e.to}` : ''})`).join(', '),
      { n: evenements.length, genre: 'denombrement', source: 'LOCAL_EVENTS du centre' });
  }

  return enrichie;
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
  ajouterHorizon,
  chargerFicheDuRegistre,
  JOURS_FR,
  STATUTS_ACTIFS,
};
