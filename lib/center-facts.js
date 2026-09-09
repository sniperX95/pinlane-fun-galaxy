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
const {
  fait, elire, elireRobuste, distributionSuspecte, sommeilDuRegistre, N_POUR_ELIRE,
} = require('./center-guards');
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

// Le meme candidat prive de sa plus grosse reservation. Sert a savoir si un
// classement tient debout sans sa meilleure ligne (voir elireRobuste).
// Rend null quand il ne reste rien a retirer : un candidat a une seule ligne
// n a pas de version affaiblie, et repondre 'vide' serait une reponse a une
// autre question.
const sansSaPlusGrosseLigne = (candidat) => {
  const rows = Array.isArray(candidat && candidat.rows) ? candidat.rows : [];
  if (rows.length < 2) return null;
  let plusGrosse = 0;
  for (let i = 1; i < rows.length; i += 1) {
    if (nombre(rows[i].price) > nombre(rows[plusGrosse].price)) plusGrosse = i;
  }
  const restant = rows.filter((_, i) => i !== plusGrosse);
  return {
    ...candidat,
    rows: restant,
    n: restant.length,
    ca: restant.reduce((somme, r) => somme + nombre(r.price), 0),
  };
};
const AFFAIBLIR = { affaiblir: sansSaPlusGrosseLigne };
const moisDe = (rows) => [...new Set(rows.map((r) => String(r.date || '').slice(0, 7)).filter(Boolean))];
const bornesDe = (rows) => {
  const dates = rows.map((r) => String(r.date || '')).filter(Boolean).sort();
  return { du: dates[0] || '', au: dates[dates.length - 1] || '' };
};

// Un fait calculé sur un sous-ensemble porte LES bornes de ce sous-ensemble,
// jamais celles du registre entier : sinon il emprunte une maturité qu'il n'a
// pas, et un fait de deux semaines passerait pour un fait de six mois.
function poseur(fiche, defaut) {
  return function poser(id, libelle, valeur, {
    n = 0, rows = null, genre = 'estimation', source = '', periode = '', audience = 'interne',
    fragile = false, motifFragilite = '',
  } = {}) {
    const fenetre = rows && rows.length ? { ...bornesDe(rows), mois: moisDe(rows) } : defaut;
    fiche[id] = fait({
      id, libelle, valeur, n, genre, source, periode, audience, fragile, motifFragilite, ...fenetre,
    });
  };
}


// Un fait comparatif porte deux choses de nature differente : QUI gagne et
// combien de fois, qui se dit a un client, et COMBIEN CA RAPPORTE, qui ne se
// dit qu au gerant. Les melanger dans une seule valeur rendait le fait
// inutilisable pour un post : citer « ton meilleur jour » revenait a publier le
// chiffre d affaires de ce jour.
// La fenetre est celle de la COMPARAISON, pas celle du vainqueur, quand les
// deux different : les lignes de juillet ne couvrent que deux mois calendaires
// sur deux ans, et leur donner cette fenetre interdirait a jamais a « juillet
// est ton meilleur mois » de porter une affirmation saisonniere. Decision
// prise trois commits plus tot, que ce helper avait annulee sans le vouloir.
function poserComparatif(poser, id, libelle, {
  etiquette, n, ca, rows, fenetre, source, periode, election,
}) {
  const bornes = fenetre && fenetre.length ? fenetre : rows;
  // La fragilite se DIT dans la valeur en plus de voyager dans le fait. Le
  // gerant qui ouvre le dossier voit le classement ET la raison pour laquelle
  // l agent n en fera rien ; sans la phrase, un fait present mais jamais
  // repris ressemble a un bug.
  const fragile = Boolean(election && election.fragile);
  const motifFragilite = fragile ? election.motifFragilite : '';
  const reserve = fragile ? ' (classement fragile : sans sa plus grosse reservation, le vainqueur change)' : '';
  poser(id, libelle, `${etiquette} : ${n} reservations${reserve}`, {
    n, rows: bornes, source, periode, audience: 'public', fragile, motifFragilite,
  });
  poser(`chiffre_${id}`, `${libelle}, en argent`, `${etiquette} : ${euros(ca)} EUR${reserve}`, {
    n, rows: bornes, source, periode, audience: 'interne', fragile, motifFragilite,
  });
}
// ── LA FICHE ────────────────────────────────────────────────────────────────
// `reservations` : lignes du registre, DÉJÀ débarrassées des lignes fabriquées
// par l'appelant (cf. chargerFicheDuRegistre). `formules` : le catalogue, pour
// voir ce qui ne se vend pas : invisible autrement, puisqu'une formule sans
// vente n'apparaît dans aucun regroupement sur les réservations.
// Combien de fois ce jour de semaine s est-il presente entre deux dates ?
// C est LE DENOMINATEUR du constat : « aucune reservation le mardi » ne veut
// rien dire sans « sur combien de mardis ». Boucle plutot qu arithmetique
// modulaire : elle se relit et se verifie a la main, et un registre de dix
// ans coute 3 650 tours une fois par fiche.
function occurrencesDuJour(jour, du, au) {
  const debut = Date.parse(`${String(du || '').slice(0, 10)}T00:00:00Z`);
  const fin = Date.parse(`${String(au || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin < debut) return 0;
  let compte = 0;
  for (let t = debut; t <= fin; t += 86400000) {
    if (new Date(t).getUTCDay() === jour) compte += 1;
  }
  return compte;
}

// LES JOURS QUE LA CONFIGURATION DECLARE OUVERTS, avec la doctrine deja
// ecrite dans le cockpit du fondateur : « un marqueur texte n'est PAS un
// horaire pose ». Gembloux porte « same_as_libramont_public_schedule » et
// Ciney « to_confirm » : ce sont des notes pour un humain, pas des grilles.
// Rend null quand rien n est exploitable, JAMAIS la grille d un voisin.
// Pure et exportee pour etre verifiable sans base : le chargeur DB se
// contente de lui passer ce que la configuration porte.
function joursOuvertsDeclares(declare) {
  const grille = declare && typeof declare === 'object'
    && declare.regular && typeof declare.regular === 'object'
    ? declare.regular
    : null;
  if (!grille) return null;
  const jours = Object.entries(grille)
    .filter(([, plage]) => plage && typeof plage === 'object')
    .map(([jour]) => Number(jour))
    .filter((jour) => Number.isInteger(jour) && jour >= 0 && jour <= 6);
  return jours.length ? jours : null;
}

// `joursOuverts` est la liste rendue par joursOuvertsDeclares. Il vaut null
// quand rien n est declare, et la fiche reste alors muette sur le sujet : la
// fonction ne devine pas un horaire, et n en emprunte pas un a un autre centre.
function ficheDuRegistre({ reservations = [], formules = [], aujourdhui = '', joursOuverts = null } = {}) {
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

  // ── SIGNE DE VIE ──────────────────────────────────────────────────────────
  // AVANT tout le reste, parce que ca conditionne la lecture de tout le reste.
  //
  // UNE SEULE HORLOGE, choisie une fois. La date de COMMANDE est le vrai signe
  // de vie : une reservation continue d arriver pendant une fermeture
  // saisonniere. Mais on ne la prend que si TOUTES les lignes actives la
  // portent : melanger la date de commande des unes et la date de venue des
  // autres compare deux horloges differentes et fabrique des trous qui n ont
  // jamais existe. Si une seule ligne manque a l appel, on lit tout le registre
  // a la date de venue.
  const toutesCommandees = vivantes.every((r) => r.created_at);
  const jalonsDeVie = vivantes.map((r) => (toutesCommandees ? r.created_at : r.date));
  // Le veto : des clients sont attendus. Le centre ne dort pas, quoi que dise
  // le rythme des commandes.
  const aVenir = aujourdhui
    ? vivantes.filter((r) => String(r.date || '') > String(aujourdhui).slice(0, 10)).length
    : 0;
  const sommeil = sommeilDuRegistre(jalonsDeVie, aujourdhui, { reservationsAVenir: aVenir });
  if (sommeil.mesurable) {
    poser('derniere_activite', 'derniere reservation prise',
      `le ${sommeil.dernier}, il y a ${sommeil.jours} jour(s)`,
      {
        n: vivantes.length, rows: vivantes, genre: 'denombrement', audience: 'interne',
        source: toutesCommandees
          ? 'date de commande la plus recente'
          : 'date de venue la plus recente (toutes les lignes ne portent pas de date de commande)',
      });
    if (sommeil.dormant) {
      // Le fait dit le silence ACTUEL et la reference qui le rend anormal :
      // le gerant doit pouvoir juger le verdict, pas seulement le subir.
      poser('registre_dormant', 'le registre ne bouge plus',
        `aucune reservation depuis ${sommeil.jours} jours, alors que le plus long silence `
        + `deja connu de ce centre est de ${sommeil.plusLongSilence} jours : rien de ce qui suit `
        + 'ne decrit la situation actuelle',
        {
          n: vivantes.length, rows: vivantes, genre: 'denombrement', audience: 'interne',
          source: 'silence actuel superieur au plus long silence observe, plancher de 14 jours',
        });
    }
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
    n: vivantes.length, rows: vivantes, genre: 'denombrement', audience: 'public', source: 'somme des pax',
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
  const meilleur = elireRobuste(joursClasses, (j) => j.n, AFFAIBLIR);
  const pire = elireRobuste(joursClasses, (j) => -j.n, AFFAIBLIR);
  if (meilleur.elu && pire.elu && meilleur.elu.jour !== pire.elu.jour) {
    poserComparatif(poser, 'jour_fort', 'jour de semaine le plus rempli', {
      etiquette: JOURS_FR[meilleur.elu.jour], n: meilleur.elu.n, ca: meilleur.elu.ca, rows: meilleur.elu.rows,
      periode: 'jour_semaine', election: meilleur,
      source: `groupe par jour de semaine, minimum ${N_POUR_ELIRE} observations`,
    });
    poserComparatif(poser, 'jour_creux', 'jour de semaine le plus creux', {
      etiquette: JOURS_FR[pire.elu.jour], n: pire.elu.n, ca: pire.elu.ca, rows: pire.elu.rows,
      periode: 'jour_semaine', election: pire,
      source: `groupe par jour de semaine, minimum ${N_POUR_ELIRE} observations`,
    });
  }

  // ── UN JOUR OUVERT QUI NE VEND RIEN ─────────────────────────────────────
  // parJour vient DES RESERVATIONS : un jour sans reservation n est pas un
  // candidat perdant, il n existe pas. jour_creux elit donc le moins rempli
  // PARMI CEUX QUI ONT VENDU. Mesure du 2026-09-09 : sur un registre ou le
  // mardi (declare ouvert 14:00-22:00) n a jamais recu une reservation, la
  // fiche annonce « jour_creux = dimanche, 79 reservations » et ne nomme le
  // mardi nulle part. L absence ne se classe pas, donc elle disparait.
  const ouverts = Array.isArray(joursOuverts)
    ? [...new Set(joursOuverts.map(Number))].filter((j) => Number.isInteger(j) && j >= 0 && j <= 6)
    : [];
  if (ouverts.length && vivantes.length) {
    const fenetre = bornesDe(vivantes);
    const muets = ouverts
      .filter((j) => !(parJour[j] || []).length)
      .map((j) => ({ jour: j, fois: occurrencesDuJour(j, fenetre.du, fenetre.au) }))
      // MATURITE : sans ce filtre, un registre de deux semaines declarerait
      // muets cinq jours sur six.
      .filter((x) => x.fois >= N_POUR_ELIRE)
      .sort((a, b) => b.fois - a.fois);
    if (muets.length) {
      poser('jour_ouvert_sans_vente', 'jours d ouverture sans aucune reservation',
        muets.map((x) => `${JOURS_FR[x.jour]} (${x.fois} fois dans la fenetre, aucune reservation)`).join(', '),
        {
          n: muets.reduce((somme, x) => somme + x.fois, 0), rows: vivantes,
          genre: 'denombrement', audience: 'interne',
          source: 'jours declares ouverts dans la configuration, croises avec les jours de venue du registre',
        });
    }
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
      n: actives.length, rows: vivantes, genre: 'denombrement', audience: 'public', source: 'table formulas, active vrai',
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
  const locomotive = elireRobuste(formulesClassees, (f) => f.n, AFFAIBLIR);
  if (locomotive.elu) {
    poserComparatif(poser, 'formule_locomotive', 'formule la plus vendue', {
      etiquette: locomotive.elu.nom, n: locomotive.elu.n, ca: locomotive.elu.ca,
      rows: locomotive.elu.rows, election: locomotive,
      source: 'groupe par formule, classe par nombre de ventes',
    });
  }
  const rentable = elireRobuste(formulesClassees, (f) => f.ca / f.n, AFFAIBLIR);
  if (rentable.elu) {
    poser('formule_meilleur_panier', 'formule au panier le plus eleve',
      `${rentable.elu.nom} : ${euros(rentable.elu.ca / rentable.elu.n)} EUR par reservation`
      + (rentable.ecartes ? ` (${rentable.ecartes} formules trop peu vendues ecartees du classement)` : '')
      + (rentable.fragile ? ' (classement fragile : sans sa plus grosse reservation, le vainqueur change)' : ''),
      {
        n: rentable.elu.n,
        rows: rentable.elu.rows,
        source: `panier moyen par formule, minimum ${N_POUR_ELIRE} ventes`,
        fragile: rentable.fragile,
        motifFragilite: rentable.motifFragilite,
      });
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
    const creneauPlein = elireRobuste(creneauxClasses, (c) => c.n, AFFAIBLIR);
    const creneauVide = elireRobuste(creneauxClasses, (c) => -c.n, AFFAIBLIR);
    if (creneauPlein.elu && creneauVide.elu && creneauPlein.elu.heure !== creneauVide.elu.heure) {
      poserComparatif(poser, 'creneau_fort', 'heure d arrivee la plus demandee', {
        etiquette: `${creneauPlein.elu.heure} h`, n: creneauPlein.elu.n, ca: creneauPlein.elu.ca, rows: creneauPlein.elu.rows,
        periode: 'heure_jour', election: creneauPlein,
        source: `groupe par heure de start_time, minimum ${N_POUR_ELIRE} observations`,
      });
      poserComparatif(poser, 'creneau_creux', 'heure d arrivee la moins demandee', {
        etiquette: `${creneauVide.elu.heure} h`, n: creneauVide.elu.n, ca: creneauVide.elu.ca, rows: creneauVide.elu.rows,
        periode: 'heure_jour', election: creneauVide,
        source: `groupe par heure de start_time, minimum ${N_POUR_ELIRE} observations`,
      });
    }
    if (creneauxClasses.length) {
      const heures = creneauxClasses.map((c) => c.heure).sort();
      poser('amplitude_horaire', 'plage horaire reellement utilisee',
        `de ${heures[0]} h a ${heures[heures.length - 1]} h`,
        { n: vivantes.length, rows: vivantes, genre: 'denombrement', audience: 'public', source: 'heure minimale et maximale observees dans start_time' });
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
  const moisPlein = elireRobuste(moisClasses, (m) => m.ca, AFFAIBLIR);
  const moisVide = elireRobuste(moisClasses, (m) => -m.ca, AFFAIBLIR);
  if (moisPlein.elu && moisVide.elu && moisPlein.elu.mois !== moisVide.elu.mois) {
    poserComparatif(poser, 'mois_fort', 'mois de l annee le plus rentable', {
      etiquette: MOIS_FR[Number(moisPlein.elu.mois)], n: moisPlein.elu.n, ca: moisPlein.elu.ca, rows: moisPlein.elu.rows,
      fenetre: vivantes, election: moisPlein,
      periode: 'mois_annee',
      source: `chiffre par mois de l annee, minimum ${N_POUR_ELIRE} observations`,
    });
    poserComparatif(poser, 'mois_creux', 'mois de l annee le moins rentable', {
      etiquette: MOIS_FR[Number(moisVide.elu.mois)], n: moisVide.elu.n, ca: moisVide.elu.ca, rows: moisVide.elu.rows,
      fenetre: vivantes, election: moisVide,
      periode: 'mois_annee',
      source: `chiffre par mois de l annee, minimum ${N_POUR_ELIRE} observations`,
    });
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
      return `${seau.cle} : ${rows.length} reservations (${part(rows.length, vivantes.length)} %)`;
    });
    poser('groupes_par_taille', 'repartition des reservations par taille de groupe',
      repartition.join(' | '),
      { n: vivantes.length, rows: vivantes, genre: 'denombrement', audience: 'public', source: 'comptage des pax par tranche sur les reservations actives' });
    const triees = tailles.slice().sort((a, b) => a - b);
    poser('taille_mediane', 'taille de groupe mediane', triees[Math.floor(triees.length / 2)], {
      n: tailles.length, rows: vivantes, audience: 'public', source: 'valeur centrale des pax des reservations actives, triees',
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


  // Les minimums declares, formule par formule. Ce fait ne sert pas a conclure
  // (aucun historique ne peut valider un changement de regle) : il sert a voir
  // si la comparaison EXISTE DEJA. Quand deux formules vivent avec deux
  // minimums differents, la question « 6 ou 8 » se tranche en lisant le
  // registre, sans rien changer et sans rien risquer. C est la seule reponse
  // honnete a la question de Movsar.
  const minimumsDeclares = catalogue
    .filter((f) => f.active && nombre(f.min_pax) > 0)
    .map((f) => ({ nom: f.name || f.id, min: nombre(f.min_pax) }));
  if (minimumsDeclares.length) {
    const distincts = [...new Set(minimumsDeclares.map((f) => f.min))].sort((a, b) => a - b);
    poser('minimums_du_catalogue', 'minimum de personnes declare par formule',
      `${minimumsDeclares.map((f) => `${f.nom} : ${f.min}`).join(' | ')}`,
      { n: minimumsDeclares.length, rows: vivantes, genre: 'denombrement',
        source: 'champ min_pax des formules actives' });
    poser('comparaison_de_minimums', 'un minimum se compare-t-il deja sans rien changer',
      distincts.length > 1
        ? `oui : ${distincts.join(' et ')} personnes coexistent deja au catalogue, la comparaison se lit dans le registre`
        : 'non : toutes les formules partagent le meme minimum, aucun point de comparaison n existe aujourd hui',
      { n: distincts.length, rows: vivantes, genre: 'denombrement',
        source: 'minimums distincts parmi les formules actives' });
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
    const dominante = elireRobuste(occasionsClassees, (o) => o.n, AFFAIBLIR);
    if (dominante.elu) {
      poserComparatif(poser, 'occasion_dominante', 'occasion la plus frequente', {
        etiquette: dominante.elu.cle, n: dominante.elu.n, ca: dominante.elu.ca, rows: dominante.elu.rows, election: dominante,
        source: `groupe par occasion, minimum ${N_POUR_ELIRE} observations`,
      });
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
      { n: clients.length, rows: vivantes, audience: 'public', source: 'clients ayant plus d une reservation' });

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

// ── L'IDENTITE PHYSIQUE DU CENTRE ───────────────────────────────────────────
// Defaut mesure, et il etait de mon fait. Le conseiller recoit deja `themes`
// dans son prompt (laser « Urban Guerilla », 500 m2 sur 2 etages, 30 joueurs,
// parties de 20 minutes). La garde de provenance, elle, ne lit que la fiche :
// elle REJETAIT donc « notre laser fait 500 m2 sur 2 etages », qui est vrai.
// On montrait au modele des chiffres qu'on lui interdisait ensuite d'ecrire, et
// il ne restait qu'a se taire sur ce que le centre vend.
//
// Ces faits ne sont pas MESURES, ils sont DECLARES : aucune fenetre, aucune
// observation. Genre denombrement, donc affirmables tels quels ; volume
// anecdote et aucune periode, donc ils ne porteront jamais un levier ni une
// saison. « Notre laser fait 500 m2 » est permis, « notre laser fait 500 m2
// donc publie le mardi » ne l'est pas.
//
// Et c'est par construction du materiau PROPRE a chaque centre : Libramont a
// « Urban Guerilla » sur 500 m2 avec 30 equipements et un seul lancement a la
// fois, Gembloux a « Star Wars » sur 370 m2 avec 20 equipements et trois
// lancements en parallele. Deux fiches, deux realites, aucun melange possible.
const LIBELLES_IDENTITE = {
  theme: (v) => `theme ${v}`,
  weapon: (v) => `equipement ${v}`,
  surfaceM2: (v) => `${v} m2`,
  floors: (v) => `${v} etages`,
  levels: (v) => `${v} niveaux`,
  holes: (v) => `${v} trous`,
  lanes: (v) => `${v} pistes`,
  tables: (v) => `${v} tables`,
  machines: (v) => `${v}`,
  maxPlayers: (v) => `${v} joueurs maximum`,
  maxPlayersPerLane: (v) => `${v} joueurs maximum par piste`,
  maxChildren: (v) => `${v} enfants maximum`,
  minAge: (v) => `des ${v} ans`,
  minHeightCm: (v) => `a partir de ${v} cm`,
  gameMinutes: (v) => `parties de ${v} minutes`,
  ageRange: (v) => `pour les ${v}`,
  access: (v) => `${v}`,
  type: (v) => `${v}`,
};
// pricePerPerson est volontairement absent. Un prix a UNE source d'autorite, et
// c'est le catalogue (table formulas), pas ce fichier de configuration. Publier
// un prix perime vers un client coute plus cher que de ne pas le citer.

function ajouterIdentite(fiche, centerFacts = {}) {
  const enrichie = { ...fiche };
  if (!centerFacts || !centerFacts.centerId) return enrichie;
  const poser = poseur(enrichie, { du: '', au: '', mois: [] });
  const SOURCE = 'configuration declaree du centre, pas une mesure';

  const activites = Array.isArray(centerFacts.activities) ? centerFacts.activities : [];
  // UN CENTRE SANS OFFRE DECLAREE. Ce n est pas un centre sans activite, c est
  // un centre dont personne n a rempli la configuration : mesure du
  // 2026-09-09, Ciney declare 0 activite quand Libramont en declare 8. Toute
  // mention d une activite sera refusee par la garde des revendications, et
  // sans ce fait le gerant verrait un agent muet sans jamais savoir pourquoi.
  if (!activites.length) {
    poser('identite_absente', 'aucune activite declaree pour ce centre',
      'la configuration de ce centre ne declare aucune activite : l agent ne peut rien affirmer de son offre, et toute mention d une activite sera refusee',
      { n: 0, genre: 'denombrement', audience: 'interne', source: 'liste des activites declarees dans la configuration du centre' });
  }
  if (activites.length) {
    poser('identite_activites', 'activites reellement proposees par ce centre',
      activites.join(', '),
      { n: activites.length, genre: 'denombrement', audience: 'public', source: SOURCE });
  }

  Object.entries(centerFacts.themes || {}).forEach(([cle, detail]) => {
    if (!detail || typeof detail !== 'object') return;
    const morceaux = Object.entries(detail)
      .filter(([champ]) => LIBELLES_IDENTITE[champ])
      .map(([champ, valeur]) => LIBELLES_IDENTITE[champ](valeur));
    if (!morceaux.length) return;
    poser(`identite_${cle}`, `ce que ce centre propose en ${String(cle).split('_').join(' ')}`,
      morceaux.join(', '),
      { n: morceaux.length, genre: 'denombrement', audience: 'public', source: SOURCE });
  });

  if (Number(centerFacts.weaponCount) > 0) {
    poser('identite_equipements_laser', 'equipements de laser game disponibles',
      `${centerFacts.weaponCount} equipements, ${Number(centerFacts.parallelLaunches) || 1} lancement(s) en parallele`,
      { n: 1, genre: 'denombrement', audience: 'public', source: SOURCE });
  }

  // La note publique est le cas ou l'absence compte autant que la presence :
  // Libramont n'a aucune note publiee, et la tentation serait d'emprunter celle
  // de Gembloux. Le dire explicitement vaut mieux que de laisser un trou que
  // quelqu'un comblera.
  const note = Number(centerFacts.googleRating);
  const avis = Number(centerFacts.googleReviews);
  poser('identite_note_publique', 'note publique de CE centre',
    note > 0 && avis > 0
      ? `${String(note).split('.').join(',')} sur ${avis} avis`
      : 'aucune note publiee pour ce centre : ne jamais reprendre celle d un autre',
    { n: avis > 0 ? avis : 0, genre: 'denombrement', audience: 'public', source: SOURCE });

  return enrichie;
}

// ── LA MEMOIRE DU CENTRE ────────────────────────────────────────────────────
// L'agent ne savait pas ce qu'il avait deja dit. Il pouvait donc proposer la
// meme chose indefiniment, ce qui est exactement le reproche de depart : « c'est
// tout le temps les memes phrases, les memes analyses ». Un second cerveau sans
// memoire n'est pas un cerveau.
//
// DEUX PRECAUTIONS, et elles ne sont pas decoratives.
//
// 1. Les textes du passe sont rendus SANS LEURS CHIFFRES. Une idee d'il y a
//    trois semaines disait « ton mardi creux pese 6 946 EUR ». La remettre telle
//    quelle dans la fiche rendrait 6946 citable pour toujours, alors que le
//    chiffre a bouge depuis. Le modele a besoin de savoir CE QUI a ete dit,
//    jamais de recuperer les nombres d'alors : ceux d'aujourd'hui sont ailleurs
//    dans la fiche, recalcules a chaque cycle.
//
// 2. Aucun taux d'adoption n'est publie, et c'est delibere. expireStaleInsights
//    passe en « ignored » toute idee vieille de dix jours que personne n'a
//    ouverte : le statut confond « le staff a refuse » et « personne n'a
//    regarde ». Publier « 0 % d'adoption » serait donc faux. Je l'ai deja ecrit
//    une fois, a Movsar, et c'etait faux pour cette raison exacte. Le trou est
//    nomme a la place du chiffre.
const TITRES_RAPPELES = 8;

function sansChiffres(texte) {
  return String(texte || '')
    .replace(/[0-9]+/g, '...')
    .replace(/(\.\.\.[\s.,]*)+/g, '... ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ajouterMemoire(fiche, historique = []) {
  const enrichie = { ...fiche };
  const lignes = (Array.isArray(historique) ? historique : []).filter(Boolean);
  if (!lignes.length) return enrichie;

  const dates = lignes.map((l) => String(l.proposed_at || '').slice(0, 10)).filter(Boolean).sort();
  const poser = poseur(enrichie, {
    du: dates[0] || '',
    au: dates[dates.length - 1] || '',
    mois: [...new Set(dates.map((d) => d.slice(0, 7)))],
  });

  const appliquees = lignes.filter((l) => l.applied_at);
  const mesurees = lignes.filter((l) => l.measured_at && l.result);

  poser('memoire_propositions', 'idees deja proposees a ce centre',
    `${lignes.length} proposees, ${appliquees.length} appliquees, ${mesurees.length} mesurees`,
    { n: lignes.length, genre: 'denombrement', source: 'marketing_insights de CE centre uniquement' });

  const recents = lignes.slice(0, TITRES_RAPPELES).map((l) => sansChiffres(l.title)).filter(Boolean);
  if (recents.length) {
    poser('memoire_deja_dit', 'sujets deja proposes, a ne pas resservir',
      recents.join(' | '),
      { n: recents.length, genre: 'denombrement', source: 'titres des dernieres idees, chiffres retires' });
  }

  if (mesurees.length) {
    poser('memoire_resultats', 'ce qui a ete applique, et ce que ca a donne',
      mesurees.slice(0, TITRES_RAPPELES)
        .map((l) => `${sansChiffres(l.title)} : ${sansChiffres(l.result)}`).join(' | '),
      { n: mesurees.length, genre: 'denombrement', source: 'idees portant applied_at et result' });
  }

  poser('trou_suivi_des_idees', 'ce qu on ne sait PAS du sort des idees',
    'une idee non ouverte pendant dix jours passe automatiquement en ignoree : le statut '
    + 'ne distingue pas un refus du staff d une idee que personne n a lue, donc aucun taux '
    + 'd adoption n est calculable',
    { n: lignes.length, genre: 'denombrement', source: 'expireStaleInsights ecrit le meme statut dans les deux cas' });

  return enrichie;
}

// ── CHARGEUR ────────────────────────────────────────────────────────────────
// Lecteur ANALYTIQUE : l'exclusion des lignes fabriquées s'applique ici, et
// jamais aux lecteurs de capacité (cf. la règle d'emploi de
// lib/simulation-filter.js). Le prédicat existe déjà et attrape les DEUX
// marqueurs : les channels de simulation et le domaine du jeu de
// démonstration. Sans lui, la fiche compte 517 lignes fabriquées comme des
// clients, et un envoi de campagne part vers autant d'adresses inexistantes.
// LA CONNAISSANCE DU CENTRE, RAFRAICHIE AVANT D ETRE LUE.
// `getCenter` rend le socle du DEPOT tant que personne n a appele
// refreshCenterOverrides dans ce processus. La configuration VRAIE, celle
// que le staff modifie dans l application, vit dans `centers.settings.config`
// en base : horaires, ressources, activites, statut. Le cron rafraichit avant
// son cycle, la route manuelle non : ce que l agent savait dependait de qui
// l appelait. Et meme rafraichie, l identite etait lue AVANT la fiche dans
// deux portes sur trois.
//
// Une seule fonction rend donc l identite, et elle rafraichit d abord. On ne
// peut plus obtenir l identite sans la mise a jour : ce n est plus un ordre a
// tenir dans trois fichiers, c est la porte d entree.
//
// FORCE, ET C EST VOULU. refreshCenterOverrides porte un TTL de 30 secondes,
// fait pour la RESERVATION, ou la config est relue a chaque requete client.
// Le conseil, lui, tourne quelques fois par jour : economiser une requete n y
// vaut rien, et un cache de trente secondes suffirait a rendre un horaire
// change il y a une minute. Ce que l agent sait doit etre ce que la base dit,
// a cet instant, sans exception a expliquer plus tard.
// Fail-soft : sur erreur le dernier etat connu est garde, et l agent travaille
// sur le socle du depot plutot que de tomber.
async function connaissanceDuCentre(centerId = 'libramont', pool = null) {
  const { buildCenterFacts } = require('./marketing-agents');
  try {
    const { refreshCenterOverrides } = require('./ops-knowledge');
    const { getPool } = require('./database');
    await refreshCenterOverrides(pool || getPool(), { force: true });
  } catch (error) {
    // Socle du depot : mieux qu une exception sur le chemin du conseil.
  }
  return buildCenterFacts(centerId);
}

async function chargerFicheDuRegistre({ centerId = 'libramont', aujourdhui = '', pool } = {}) {
  const { getPool } = require('./database');
  const { fabricatedSqlPredicate, demonstrationEmailPattern } = require('./simulation-filter');
  const client = pool || getPool();
  // La fiche lit elle aussi la configuration (les jours d ouverture) : elle
  // rafraichit donc avant, sans quoi elle lirait un horaire du depot pendant
  // que l identite, elle, serait a jour.
  try {
    const { refreshCenterOverrides } = require('./ops-knowledge');
    await refreshCenterOverrides(client, { force: true });
  } catch (error) {
    // Socle du depot.
  }
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
  // L HORAIRE DECLARE DE CE CENTRE, et de lui seul. La lecture vit dans
  // joursOuvertsDeclares, pure et verifiable sans base ; ici on se contente
  // de lui passer ce que la configuration porte. Un centre introuvable ne
  // fait pas tomber la fiche : il perd seulement ce fait.
  let joursOuverts = null;
  try {
    const { getCenter } = require('./ops-knowledge');
    joursOuverts = joursOuvertsDeclares(getCenter(centerId).defaultSchedule);
  } catch (error) {
    joursOuverts = null;
  }
  return ficheDuRegistre({
    reservations: reservations.rows,
    formules: formules.rows,
    aujourdhui,
    joursOuverts,
  });
}


// La memoire d UN centre, et jamais d un autre : le center_id est dans le
// where, comme pour le registre. Une memoire partagee ferait exactement ce que
// Movsar redoute, sortir les idees d un centre chez le voisin.
async function chargerMemoireDuCentre({ centerId = 'libramont', pool, jours = 120 } = {}) {
  const { getPool } = require('./database');
  const client = pool || getPool();
  const { rows } = await client.query(
    `
      select title, status, proposed_at::text as proposed_at, applied_at::text as applied_at,
             measured_at::text as measured_at, result, data_basis
        from marketing_insights
       where center_id = $1
         and proposed_at > now() - ($2 || ' days')::interval
       order by proposed_at desc
       limit 60;
    `,
    [centerId, String(jours)],
  );
  return rows || [];
}

module.exports = {
  ficheDuRegistre,
  connaissanceDuCentre,
  joursOuvertsDeclares,
  occurrencesDuJour,
  ajouterHorizon,
  ajouterIdentite,
  ajouterMemoire,
  chargerMemoireDuCentre,
  chargerFicheDuRegistre,
  JOURS_FR,
  STATUTS_ACTIFS,
};
