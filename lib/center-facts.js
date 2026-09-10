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
    fragile = false, motifFragilite = '', motsInterdits = [], offre = false,
  } = {}) {
    const fenetre = rows && rows.length ? { ...bornesDe(rows), mois: moisDe(rows) } : defaut;
    fiche[id] = fait({
      id, libelle, valeur, n, genre, source, periode, audience, fragile, motifFragilite,
      motsInterdits, offre, ...fenetre,
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

// Une minute de la journee rendue lisible : 840 devient « 14 h ». Une borne
// absente veut dire « depuis l ouverture » ou « jusqu a la fermeture », et le
// dire vaut mieux que de rendre un tiret vide.
function minutesEnHeure(minutes, bord = 'debut') {
  if (minutes === null || minutes === undefined) {
    return bord === 'debut' ? "l ouverture" : 'la fermeture';
  }
  const heures = Math.floor(Number(minutes) / 60);
  const reste = Number(minutes) % 60;
  return reste ? `${heures} h ${String(reste).padStart(2, '0')}` : `${heures} h`;
}

// L AGENDA REEL DES PROCHAINS JOURS : ce que le centre ouvre vraiment, ce qu
// il ferme, et pourquoi. Trois sources que la fiche ignorait et que le moteur
// de reservation lit depuis toujours : la grille du staff, la grille des
// vacances avec les jours forces (getSchedule les resout ensemble), et les
// blocs de disponibilite poses a la main (« ferme samedi de 14 h a 18 h,
// travaux »).
//
// On appelle les MEMES fonctions que la reservation : deux resolutions d un
// horaire finiraient par diverger, et c est l agent qui aurait tort.
//
// Pur : recoit une configuration, des blocs deja charges et une date. Ne va
// rien chercher, donc se rejoue a la main.
//
// FERME VEUT DIRE : TOUTE la plage d ouverture est couverte. On n utilise donc
// PAS isCenterClosedDuring, qui repond a une autre question, « une fermeture
// chevauche-t-elle cette fenetre » : la bonne pour refuser UNE reservation, la
// mauvaise pour dire qu un jour est ferme. Deux heures de coupure un samedi de
// 10 h a minuit fermaient la journee entiere. Une coupure partielle est une
// information reelle : elle est rendue a part, pas confondue avec une
// fermeture.
function agendaDuCentre(centre, blocs, aujourdhui, jours = 14) {
  const { getSchedule } = require('./booking-config');
  const { resolveBlocksForDate } = require('./availability-blocks');
  const MINUTES_DU_JOUR = 24 * 60;
  const depart = Date.parse(`${String(aujourdhui || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(depart) || !centre) return [];
  // UN MARQUEUR TEXTE N EST PAS UN HORAIRE POSE, et getSchedule ne le sait
  // pas : il retombe sur la grille de Libramont pour tout centre dont
  // defaultSchedule vaut « same_as_libramont_public_schedule » ou
  // « to_confirm ». Sans ce test, Gembloux et Ciney annoncaient mot pour mot
  // les horaires de Libramont, et le patch 41 les a rendus PUBLIABLES.
  //
  // Le test n est pas recopie : joursOuvertsDeclares repond deja a cette
  // question exacte, et l agent EMAIL comme le cockpit du fondateur portent
  // la meme doctrine depuis le patch 29. Une seule regle, trois portes.
  //
  // Un agenda vide fait taire tout ce qui en depend : les jours dicibles, les
  // fermetures, les activites indisponibles et les prix. C est voulu :
  // « reservable les 12 jours ouverts » compte sur un calendrier emprunte.
  if (!joursOuvertsDeclares(centre.defaultSchedule)) return [];
  const lignes = [];
  for (let i = 0; i < jours; i += 1) {
    const date = new Date(depart + i * 86400000).toISOString().slice(0, 10);
    const plage = getSchedule(date, centre);
    if (!plage) {
      // Jour non ouvert par la grille : ce n est pas une fermeture
      // exceptionnelle, c est le rythme normal du centre.
      lignes.push({ date, ouvert: false, ferme: false, plage: '', raisons: [], coupures: [] });
      continue;
    }
    // getSchedule rend des HEURES, les blocs portent des MINUTES.
    const ouvertureMin = plage.open * 60;
    const fermetureMin = plage.close * 60;
    const blocsDuJour = resolveBlocksForDate(blocs, date)
      .filter((bloc) => bloc && bloc.scopeType === 'center');
    const couvreToutLeJour = (bloc) => {
      const debut = bloc.startMin === null || bloc.startMin === undefined ? 0 : bloc.startMin;
      const fin = bloc.endMin === null || bloc.endMin === undefined ? MINUTES_DU_JOUR : bloc.endMin;
      return debut <= ouvertureMin && fin >= fermetureMin;
    };
    const fermants = blocsDuJour.filter(couvreToutLeJour);
    const nomDuBloc = (bloc) => String(bloc.reason || '').trim();
    lignes.push({
      date,
      ouvert: true,
      ferme: fermants.length > 0,
      plage: plage.label,
      raisons: [...new Set(fermants.map(nomDuBloc).filter(Boolean))],
      // Une coupure de deux heures n est pas une fermeture, et ce n est pas
      // rien non plus : le gerant doit la voir sans qu on lui dise « ferme ».
      coupures: blocsDuJour.filter((bloc) => !couvreToutLeJour(bloc)).map((bloc) => ({
        debut: bloc.startMin,
        fin: bloc.endMin,
        raison: nomDuBloc(bloc),
      })),
    });
  }
  return lignes;
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
// ── CE QUE LE CENTRE NE PEUT PAS HONORER SUR LA FENETRE ─────────────────────
// `forbiddenClaims` dit ce que ce centre n a JAMAIS (il n a pas de cinema).
// Ceci dit ce qu il n a pas EN CE MOMENT (le laser est bloque jusqu au 20).
// Deux intentions differentes, donc deux sources : melanger les deux ferait
// d une panne de quinze jours une propriete du centre.
//
// Le predicat n est PAS recopie. isActivityFullyBlockedOn est celui que le
// tunnel de reservation applique pour repondre « ferme ce jour » au client :
// si l agent en avait une copie, un jour l une des deux dirait oui et l autre
// non, et c est le client qui paierait l ecart.
//
// TOUS les jours ouverts, et pas un seuil : une activite bloquee deux jours
// sur quatorze existe toujours, et le centre a le droit d en parler.
function activitesIndisponibles(centre, blocs, agenda) {
  const { isActivityFullyBlockedOn } = require('./availability-blocks');
  const declarees = (centre && centre.activityAvailability) || {};
  const jours = (Array.isArray(agenda) ? agenda : []).filter((j) => j && j.ouvert && !j.ferme);
  // Aucun jour ouvert : c est le centre qui est ferme, pas une activite.
  // centre_ferme dit deja cela, et mieux.
  if (!jours.length) return [];
  return Object.keys(declarees)
    .filter((id) => declarees[id])
    .filter((id) => jours.every((j) => isActivityFullyBlockedOn(blocs, j.date, id)))
    .sort();
}

// ── LES JOURS DE SEMAINE OU LE CENTRE OUVRE, DICIBLES ───────────────────────
// Le pendant PUBLIC et STRUCTUREL de l agenda date, qui reste interne. Ici,
// aucune date, aucune fermeture, aucune raison : « ouvert le samedi de 10h a
// Minuit » est une propriete du centre, « ferme le 19 septembre » est une
// decision du gerant et elle reste a lui.
//
// TOUTES les occurrences, et pas la majorite : un seul samedi ferme dans la
// fenetre et le samedi ne se dit plus, parce que « on est ouvert le samedi »
// serait faux une fois sur deux. La regle se repare seule quand la fermeture
// sort de la fenetre.
//
// Le libelle horaire n est pas recompose : c est celui que getSchedule rend et
// que le site affiche. Deux occurrences aux horaires differents laissent le
// jour sans horaire plutot qu avec un horaire faux.
const NOMS_DE_JOUR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function joursOuvertsPublics(agenda) {
  const parJour = new Map();
  (Array.isArray(agenda) ? agenda : []).forEach((ligne) => {
    if (!ligne || !ligne.date) return;
    const horodatage = Date.parse(`${String(ligne.date).slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(horodatage)) return;
    const jour = new Date(horodatage).getUTCDay();
    if (!parJour.has(jour)) parJour.set(jour, []);
    parJour.get(jour).push(ligne);
  });
  return [...parJour.entries()]
    // Lundi en tete : c est l ordre dans lequel un client lit une semaine.
    .sort((a, b) => ((a[0] + 6) % 7) - ((b[0] + 6) % 7))
    .filter(([, lignes]) => lignes.every((l) => l.ouvert && !l.ferme))
    .map(([jour, lignes]) => {
      const plages = [...new Set(lignes.map((l) => String(l.plage || '')).filter(Boolean))];
      return { jour, nom: NOMS_DE_JOUR[jour], plage: plages.length === 1 ? plages[0] : '' };
    });
}

// ── LES PRIX QUE LE CENTRE PEUT REELLEMENT TENIR ────────────────────────────
// Une unite de prix inconnue n a pas de libelle : la formule sort des faits de
// prix au lieu d etre annoncee dans une unite devinee. Deux unites existent
// dans la donnee reelle, et lib/booking-complements.js dit deja qu elles ne se
// comparent pas entre elles.
const UNITES_DE_PRIX = { per_pax: 'par personne', per_lane: 'par piste' };

// La fenetre horaire d une formule, en clair. timeLimit est en HEURES pleines
// dans cette donnee (min: 18, max: 22), pas en minutes : on le lit tel quel.
// Rend la chaine vide quand la formule n a aucune borne, et c est ce vide qui
// autorise le prix plancher a la retenir.
function fenetreHoraire(limite) {
  const debut = limite && Number.isFinite(Number(limite.min)) ? Number(limite.min) : null;
  const fin = limite && Number.isFinite(Number(limite.max)) ? Number(limite.max) : null;
  if (debut !== null && fin !== null) return `de ${debut} h a ${fin} h`;
  if (debut !== null) return `a partir de ${debut} h`;
  if (fin !== null) return `avant ${fin} h`;
  return '';
}

// ── CE QU ON DEMANDE ET QU ON NE VEND PAS ──────────────────────────────────
// custom_requests est remplie par le formulaire « demande sur mesure » du site
// public : quelqu un qui n a pas trouve son compte dans le catalogue prend la
// peine d ecrire. C est la SEULE source du produit qui porte la demande NON
// SERVIE ; le registre, le catalogue et l agenda ne decrivent que ce qui a ete
// vendu, donc aucun d eux ne peut dire ce qui a manque.
//
// AUCUNE DONNEE PERSONNELLE N ARRIVE ICI. Le nom, la societe, l email, le
// telephone et le message libre ne sont pas selectionnes par la requete : la
// fiche part vers un modele, et un modele ne doit jamais voir de quoi
// identifier quelqu un.
//
// « JAMAIS VENDUE » se compte sur TOUTES les reservations, pas seulement les
// vivantes : une occasion vendue puis annulee A ete vendue une fois, et la
// dire jamais vendue serait faux.
//
// La comparaison n a de sens que parce que les deux colonnes portent le meme
// vocabulaire ferme : createCustomRequest normalise l occasion par
// normalizeReservationOccasion, la fonction meme qui valide celle d une
// reservation. On interroge OCCASION_VALUES plutot que d en recopier la liste,
// et une occasion que le registre ne PEUT pas porter sort de la comparaison au
// lieu d etre declaree jamais vendue.
function demandesSurMesure(demandes, reservations) {
  const { OCCASION_VALUES } = require('./database');
  const lignes = (Array.isArray(demandes) ? demandes : []).filter(Boolean);
  if (!lignes.length) return null;
  const tailles = lignes.map((d) => Number(d.pax)).filter((n) => Number.isFinite(n) && n > 0);
  const parOccasion = new Map();
  lignes.forEach((demande) => {
    const occasion = String((demande && demande.occasion) || '').trim().toLowerCase();
    if (!occasion) return;
    if (!parOccasion.has(occasion)) parOccasion.set(occasion, []);
    parOccasion.get(occasion).push(demande);
  });
  const vendues = new Set((Array.isArray(reservations) ? reservations : [])
    .map((r) => String((r && r.occasion) || '').trim().toLowerCase())
    .filter(Boolean));
  const classees = [...parOccasion.entries()]
    .map(([occasion, rows]) => ({ occasion, n: rows.length, rows }))
    .sort((a, b) => b.n - a.n || a.occasion.localeCompare(b.occasion));
  return {
    lignes,
    total: lignes.length,
    tailleMin: tailles.length ? Math.min(...tailles) : 0,
    tailleMax: tailles.length ? Math.max(...tailles) : 0,
    occasions: classees,
    jamaisVendues: classees.filter((c) => OCCASION_VALUES.has(c.occasion) && !vendues.has(c.occasion)),
  };
}

// Les RESSOURCES qu une formule consomme, c est-a-dire les activites dont la
// fermeture empeche la reservation d aboutir. Il y en a deux, et ce sont les
// deux que le tunnel verifie : la piste de bowling et l arene laser.
//
// Les autres etapes (arcade, plaine de jeu, table, boissons) ne reservent
// aucune ressource et le tunnel les laisse passer, meme fermees toute la
// journee. Les compter ici ferait taire l agent sur des formules reellement
// reservables : on echangerait un mensonge contre une perte.
//
// AUCUN des deux tests n est recopie. reservationNeedsLanes est la fonction
// que lib/database appelle pour la branche formule, countFormulaLaserGames
// celle que formulaFallbackLaserBlocks interroge avant ensureLaserCapacity.
// Une regle, deux portes.
//
// JETTE quand la formule n a pas de document au catalogue : inconnue, ou
// connue mais desactivee (getFormula rend null). L appelant en fait un refus
// de publier.
function ressourcesDeLaFormule(formule) {
  const { reservationNeedsLanes } = require('./booking-config');
  const { countFormulaLaserGames } = require('./database');
  const { getFormula } = require('./ops-knowledge');
  const id = String((formule && formule.id) || '');
  const document = getFormula(id);
  if (!document) throw new Error(`formule sans document au catalogue : ${id}`);
  const ressources = [];
  if (reservationNeedsLanes('formule', id)) ressources.push('bowling');
  if (countFormulaLaserGames(document) > 0) ressources.push('laser_game');
  return ressources;
}

// La meme, en version qui ne jette pas : elle POSE le resultat sur une copie
// de la formule. Une resolution qui echoue laisse `ressources` a null, et
// prixReservables refuse alors de publier la formule.
function formuleAvecSesRessources(formule) {
  try {
    return { ...formule, ressources: ressourcesDeLaFormule(formule) };
  } catch (error) {
    return { ...formule, ressources: null };
  }
}

// Sur combien de jours ouverts de la fenetre chaque formule est-elle vraiment
// reservable, et a quel prix ?
//
// AUCUNE condition n est recomposee en francais ici. On interroge le MOTEUR :
// getFormuleAvailability est la fonction qui accepte ou refuse une vraie
// reservation (jours valides, fenetre horaire, vacances scolaires, minimum de
// personnes, offre desactivee pour ce centre), et isFormulaFullyBlockedOn est
// le predicat que la route publique applique juste a cote. Reecrire ces regles
// ici en produirait une deuxieme version, et c est le client qui paierait
// l ecart le jour ou les deux divergeraient.
//
// On demande au minimum de personnes DE LA FORMULE : c est la configuration la
// plus favorable, donc la seule qui reponde a « peut-elle etre vendue ce
// jour-la ». Un groupe plus petit se verra refuser, et le fait le dit en
// portant le minimum.
function prixReservables(formules, centre, agenda, blocs = [], joursSansPiste = null) {
  const { getFormuleAvailability } = require('./booking-config');
  const { isFormulaFullyBlockedOn, isActivityFullyBlockedOn } = require('./availability-blocks');
  const jours = (Array.isArray(agenda) ? agenda : [])
    .filter((j) => j && j.ouvert && !j.ferme)
    .map((j) => j.date);
  if (!jours.length) return [];
  return (Array.isArray(formules) ? formules : [])
    .map((formule) => {
      const unite = UNITES_DE_PRIX[String(formule && formule.type)];
      const prix = Number(formule && formule.price);
      if (!unite || !Number.isFinite(prix) || prix <= 0) return null;
      const minimum = Number(formule.minPax) > 0 ? Number(formule.minPax) : 1;
      // SES RESSOURCES, posees par l appelant au bord du catalogue. Une
      // formule qui n en porte pas n est pas publiee : ne pas savoir ce
      // qu elle consomme, c est ne pas savoir si elle est reservable.
      const ressources = formule.ressources;
      if (!Array.isArray(ressources)) return null;
      const ouverts = jours.filter((date) => {
        if (isFormulaFullyBlockedOn(blocs, date, formule.id)) return false;
        // Une piste ou une arene fermee le jour entier : le tunnel refuse la
        // reservation, donc ce jour ne compte pas comme reservable.
        if (ressources.some((activite) => isActivityFullyBlockedOn(blocs, date, activite))) return false;
        // MEME REFUS, AUTRE CHEMIN : le parc de pistes entierement en
        // maintenance ce jour-la. Le tunnel repond « Aucune piste disponible »,
        // et l activite bowling n est pas bloquee pour autant : c est une
        // panne de RESSOURCE, pas une fermeture d activite.
        if (joursSansPiste && joursSansPiste.has(date)
          && ressources.includes('bowling')) return false;
        return getFormuleAvailability(formule, date, minimum, '', centre).ok;
      });
      if (!ouverts.length) return null;
      return {
        id: formule.id,
        nom: String(formule.name || formule.id),
        prix,
        unite,
        minimum,
        jours: ouverts.length,
        surTotal: jours.length,
        // LA FENETRE HORAIRE, lue telle quelle dans le champ que le moteur
        // applique. Sans elle, « reservable les 12 jours ouverts » serait vrai
        // et cacherait « avant 12 h » : une formule du matin passerait pour une
        // formule de tous les instants. Le moteur ne tranche l heure que si on
        // lui en donne une, et une fiche parle de JOURS : c est donc ici que la
        // condition doit etre DITE, pas deduite d un refus.
        horaire: fenetreHoraire(formule.timeLimit),
      };
    })
    .filter(Boolean);
}

function ficheDuRegistre({
  reservations = [], formules = [], aujourdhui = '', joursOuverts = null, agenda = null,
  statut = '', activitesBloquees = [], prix = [], demandes = [], joursSansPiste = [],
} = {}) {
  const toutes = Array.isArray(reservations) ? reservations : [];
  const vivantes = toutes.filter((r) => STATUTS_ACTIFS.has(String(r.status)));
  const fiche = {};
  const global = { ...bornesDe(toutes), mois: moisDe(toutes) };
  const poser = poseur(fiche, global);

  poser('registre_taille', 'lignes du registre retenues', toutes.length, {
    n: toutes.length, rows: toutes, genre: 'denombrement', source: 'reservations du centre, lignes fabriquees exclues',
  });

  // ── LE STATUT DECLARE DU CENTRE ─────────────────────────────────────────
  // Trois valeurs existent dans le produit : active, planned, closed. Aucune
  // n arrivait au cerveau de l agent. Un centre « planned » n ouvre pas encore
  // et un centre « closed » a ferme : dans les deux cas, aucun geste au present
  // ne les concerne, et ce n est pas une deduction, c est une declaration du
  // gerant. La dormance finit par attraper le second, apres son propre delai ;
  // la declaration est immediate.
  //
  // Avant le registre vide, comme l agenda : ca parle du CENTRE.
  const statutLu = String(statut || '').trim().toLowerCase();
  if (statutLu && statutLu !== 'active') {
    poser('statut_du_centre', 'ce centre n est pas declare actif',
      statutLu === 'planned'
        ? 'centre declare « planned » : il n ouvre pas encore'
        : `centre declare « ${statutLu} »`,
      {
        n: 1, genre: 'denombrement', audience: 'interne',
        source: 'champ status de la configuration du centre',
      });
  }

  // ── L HORAIRE N EST PAS DECLARE ─────────────────────────────────────────
  // La configuration porte un marqueur texte la ou une grille est attendue.
  // Sans ce fait, l agent se tait sur les horaires ET sur les prix, et le
  // gerant ne voit qu un ecran vide sans en connaitre la cause. Interne : ce
  // n est pas une information client, c est une configuration a poser.
  if (joursOuverts === null && aujourdhui) {
    poser('horaires_non_declares', 'ce centre n a pas de grille horaire posee',
      'la configuration porte un marqueur texte au lieu d une grille : aucun jour '
      + 'd ouverture, aucune fermeture et aucun prix ne peuvent etre affirmes pour ce '
      + 'centre, et ils ne se deduisent d aucun autre',
      {
        n: 0, genre: 'denombrement', audience: 'interne',
        source: 'defaultSchedule du centre : marqueur texte, pas de grille reguliere',
      });
  }

  // ── CE QUE LE CENTRE OUVRE DANS LES JOURS QUI VIENNENT ──────────────────
  // Sans ca, l agent conseille un geste au present sans savoir si le centre
  // ouvre. Interne : un agenda est une information de pilotage, et une
  // fermeture exceptionnelle se communique par une decision du gerant, pas par
  // une phrase generee.
  const agendaLu = Array.isArray(agenda) ? agenda.filter((j) => j && j.date) : [];
  if (agendaLu.length) {
    const ouvrants = agendaLu.filter((j) => j.ouvert && !j.ferme);
    const fermetures = agendaLu.filter((j) => j.ouvert && j.ferme);
    poser('agenda_ouverture', 'ce que le centre ouvre dans les jours qui viennent',
      agendaLu.slice(0, 7).map((j) => {
        if (!j.ouvert) return `${j.date} : jour non ouvert`;
        if (j.ferme) return `${j.date} : FERME${j.raisons.length ? ` (${j.raisons.join(', ')})` : ''}`;
        const coupures = (j.coupures || [])
          .map((c) => `coupure de ${minutesEnHeure(c.debut, 'debut')} a ${minutesEnHeure(c.fin, 'fin')}`
            + (c.raison ? ` (${c.raison})` : ''))
          .join(', ');
        return `${j.date} : ${j.plage}${coupures ? `, ${coupures}` : ''}`;
      }).join(' | '),
      {
        n: agendaLu.length, genre: 'denombrement', audience: 'interne',
        source: 'grille du centre resolue jour par jour (reguliere, vacances, jours forces) croisee avec les fermetures declarees',
      });
    // LE PENDANT PUBLIC. Pose a cote de l agenda, jamais a sa place : l un dit
    // au gerant ce qui se passe le 19, l autre dit au client qu on ouvre le
    // samedi. Deux questions, deux audiences, deux faits.
    const dicibles = joursOuvertsPublics(agendaLu);
    if (dicibles.length) {
      poser('jours_ouverts', 'jours de la semaine ou le centre ouvre',
        dicibles.map((j) => `${j.nom}${j.plage ? ` ${j.plage}` : ''}`).join(' | '),
        {
          n: dicibles.length, genre: 'denombrement', audience: 'public', offre: true,
          source: 'jours de semaine dont TOUTES les occurrences de la fenetre sont ouvertes et non fermees, horaire annonce seulement s il est le meme partout',
        });
    }
    if (fermetures.length) {
      poser('fermetures_a_venir', 'jours d ouverture fermes exceptionnellement',
        fermetures.map((j) => `${j.date}${j.raisons.length ? ` (${j.raisons.join(', ')})` : ''}`).join(', '),
        {
          n: fermetures.length, genre: 'denombrement', audience: 'interne',
          source: 'blocs de disponibilite de portee centre couvrant toute la plage du jour',
        });
    }
    // AUCUN JOUR OUVERT DANS LA FENETRE. Ce n est pas un centre calme, c est un
    // centre qui ne recoit personne : le conseil au present devient faux, comme
    // sur un registre endormi.
    if (!ouvrants.length) {
      poser('centre_ferme', 'le centre n ouvre aucun jour dans la fenetre',
        `aucun jour ouvert sur les ${agendaLu.length} prochains jours`,
        {
          n: agendaLu.length, genre: 'denombrement', audience: 'interne',
          source: 'grille du centre et fermetures declarees, jour par jour',
        });
    }
  }

  // ── CE QUI EST DECLARE MAIS INDISPONIBLE ────────────────────────────────
  // Interne : la liste des pannes ne se publie pas. Elle sert a deux choses,
  // et a deux seulement : le gerant qui interroge son agent la voit, et la
  // garde lexicale l applique par motsInterdits.
  const bloquees = (Array.isArray(activitesBloquees) ? activitesBloquees : [])
    .filter((a) => a && a.nom);
  if (bloquees.length) {
    poser('activites_indisponibles', 'activites du centre bloquees sur toute la fenetre',
      bloquees.map((a) => a.nom).join(', '),
      {
        n: bloquees.length, genre: 'denombrement', audience: 'interne',
        source: 'blocs de disponibilite de portee activite couvrant le jour entier, sur chaque jour ouvert de la fenetre',
        motsInterdits: bloquees.flatMap((a) => (Array.isArray(a.mots) ? a.mots : [])),
      });
  }

  // ── AUCUNE PISTE DISPONIBLE ─────────────────────────────────────────────
  // INTERNE. Sans ce fait, un gerant voit ses prix bowling disparaitre sans
  // en connaitre la cause, exactement comme pour l horaire non declare.
  if (joursSansPiste && joursSansPiste.length && aujourdhui) {
    poser('pistes_toutes_en_maintenance', 'jours ouverts sans une seule piste disponible',
      `${joursSansPiste.length} jour${joursSansPiste.length > 1 ? 's' : ''} ouvert${joursSansPiste.length > 1 ? 's' : ''} `
      + 'ou toutes les pistes sont en maintenance : aucune formule avec bowling n y est '
      + 'reservable, et aucune n est annoncee pour ces jours-la',
      {
        n: joursSansPiste.length, genre: 'denombrement', audience: 'interne',
        source: 'lane_statuses du centre, statut maintenance couvrant la date, sur chaque jour ouvert de la fenetre',
      });
  }

  // ── LES PRIX QUE LE CENTRE PEUT TENIR ───────────────────────────────────
  // PUBLIC, contrairement a l agenda et aux pannes : un prix est ce qu un
  // client vient chercher, et chaque ligne porte ce qui la conditionne.
  const prixLus = (Array.isArray(prix) ? prix : []).filter((p) => p && p.nom && p.unite);
  if (prixLus.length) {
    poser('prix_du_catalogue', 'prix des formules reservables, avec ce qui les conditionne',
      prixLus
        .map((p) => `${p.nom} : ${p.prix} EUR ${p.unite}, ${p.minimum > 1 ? `des ${p.minimum} personnes` : 'sans minimum de personnes'}, `
          + `reservable ${p.jours === p.surTotal ? `les ${p.surTotal} jours ouverts` : `${p.jours} jours sur ${p.surTotal}`}`
          + `${p.horaire ? `, ${p.horaire}` : ''}`)
        .join(' | '),
      {
        n: prixLus.length, genre: 'denombrement', audience: 'public', offre: true,
        source: 'catalogue effectif du centre, chaque jour ouvert de la fenetre soumis au moteur de reservation (jours valides, plage horaire, vacances, minimum de personnes, blocages)',
      });

    // LE PLANCHER, et il est SEVERE. Trois conditions, chacune payee par un
    // mensonge qu elle empeche :
    //   par personne  : deux unites de prix ne se comparent pas, et « des
    //                   55 EUR » pour un tarif a la piste n a aucun sens ;
    //   tous les jours : sans quoi le plancher attrapait l offre du jeudi a
    //                   20 EUR et la vendait comme un tarif permanent ;
    //   aucune fenetre horaire : « des 25 EUR par personne » serait vrai et
    //                   tairait « avant 12 h ». Une formule du matin passerait
    //                   pour une formule de tous les instants.
    // C est un fait qui doit pouvoir etre cite SEUL, sans aucune reserve.
    const sansCondition = prixLus
      .filter((p) => p.unite === 'par personne' && p.jours === p.surTotal && !p.horaire)
      .sort((a, b) => a.prix - b.prix);
    if (sansCondition.length) {
      const moinsChere = sansCondition[0];
      poser('prix_plancher', 'la formule la moins chere sans condition de jour ni d heure',
        `${moinsChere.nom} : ${moinsChere.prix} EUR par personne, ${moinsChere.minimum > 1 ? `des ${moinsChere.minimum} personnes` : 'sans minimum de personnes'}, `
        + `reservable les ${moinsChere.surTotal} jours ouverts de la fenetre`,
        {
          n: sansCondition.length, genre: 'denombrement', audience: 'public', offre: true,
          source: 'la moins chere des formules par personne, sans fenetre horaire, que le moteur accepte sur CHAQUE jour ouvert de la fenetre',
        });
    }
  }

  // ── LA DEMANDE QUE LE CATALOGUE N A PAS SERVIE ──────────────────────────
  // INTERNE, les trois. Un prix se dit a un client ; « on nous demande de
  // l entreprise et on n en vend pas » se dit au gerant. La porte « Demander »
  // recoit tout le registre et les verra ; la porte « Idees », qui ecrit vers
  // le public, ne les verra jamais.
  const demande = demandesSurMesure(demandes, toutes);
  if (demande) {
    poser('demandes_sur_mesure', 'demandes envoyees par le formulaire sur mesure',
      `${demande.total} demande${demande.total > 1 ? 's' : ''}`
      + `${demande.tailleMax ? `, de ${demande.tailleMin} a ${demande.tailleMax} personnes` : ''}`,
      {
        n: demande.total, rows: demande.lignes, genre: 'denombrement', audience: 'interne',
        source: 'custom_requests de ce centre, hors lignes de demonstration ; aucune colonne personnelle n est lue',
      });
    if (demande.occasions.length) {
      poser('occasions_demandees', 'occasions citees dans les demandes sur mesure',
        demande.occasions.map((c) => `${c.occasion} (${c.n})`).join(', '),
        {
          n: demande.total, rows: demande.lignes, genre: 'denombrement', audience: 'interne',
          source: 'occasion declaree sur la demande, vocabulaire ferme normalise a l ecriture',
        });
    }
    // LE FAIT QUI VAUT LE DETOUR : une occasion demandee que le registre ne
    // porte NULLE PART. C est la seule chose du dossier qui parle de ce que le
    // centre rate, et elle ne se deduit d aucune autre source.
    if (demande.jamaisVendues.length) {
      poser('demande_jamais_vendue', 'occasions demandees qu aucune reservation ne porte',
        demande.jamaisVendues.map((c) => `${c.occasion} : ${c.n} demande${c.n > 1 ? 's' : ''}, aucune reservation`).join(' | '),
        {
          n: demande.jamaisVendues.reduce((somme, c) => somme + c.n, 0),
          rows: demande.jamaisVendues.flatMap((c) => c.rows),
          genre: 'denombrement', audience: 'interne',
          source: 'occasions des demandes sur mesure absentes de la colonne occasion du registre de CE centre, toutes reservations confondues, annulees comprises ; comparaison limitee aux occasions qu une reservation peut porter',
        });
    }
  }

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
      n: actives.length, rows: vivantes, genre: 'denombrement', audience: 'public',
      source: 'catalogue effectif de ce centre : socle du produit, ligne de la table formulas, puis surcouche formule_overrides',
    });
    poser('formules_jamais_vendues', 'formules actives sans une seule vente',
      dormantes.length
        ? `${dormantes.length} : ${dormantes.map((f) => f.name).filter(Boolean).join(', ')}`
        : 'aucune',
      {
        n: dormantes.length, rows: vivantes, genre: 'denombrement',
        source: 'catalogue effectif de ce centre : socle du produit, ligne de la table formulas, puis surcouche formule_overrides, moins les formule_id vus dans le registre',
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
        source: 'minimum de personnes de chaque formule du catalogue effectif de ce centre : socle du produit, ligne de la table formulas, puis surcouche formule_overrides' });
    poser('comparaison_de_minimums', 'un minimum se compare-t-il deja sans rien changer',
      distincts.length > 1
        ? `oui : ${distincts.join(' et ')} personnes coexistent deja au catalogue, la comparaison se lit dans le registre`
        : 'non : toutes les formules partagent le meme minimum, aucun point de comparaison n existe aujourd hui',
      { n: distincts.length, rows: vivantes, genre: 'denombrement',
        source: 'minimums distincts du catalogue effectif de ce centre : socle du produit, ligne de la table formulas, puis surcouche formule_overrides' });
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

  // ── LE SORT DES IDEES, QUAND IL EST CONNU ─────────────────────────────
  // Trois chemins ecrivent 'ignored' et deux sont des DECISIONS du staff.
  // Depuis le patch 45 chacun signe son geste dans payload.ignoredBy. Le taux
  // ne se calcule QUE sur les lignes qui portent une cause : celles d avant ne
  // sont pas comptees, elles sont comptees A PART. Publier un taux sur un
  // denominateur inconnu est exactement l erreur deja commise une fois, et
  // ecrite a Movsar.
  const pluriel = (n) => (n > 1 ? 's' : '');
  const causeDe = (l) => String((l.payload && l.payload.ignoredBy) || '');
  const refusees = lignes.filter((l) => causeDe(l) === 'staff');
  const jamaisLues = lignes.filter((l) => causeDe(l) === 'expiration');
  const sansCause = lignes.filter((l) => String(l.status) === 'ignored' && !causeDe(l));
  const tranchees = appliquees.length + refusees.length;
  if (tranchees) {
    poser('taux_adoption', 'part des idees que le staff a retenues, quand il a tranche',
      `${part(appliquees.length, tranchees)} % : ${appliquees.length} appliquee${pluriel(appliquees.length)} et `
      + `${refusees.length} refusee${pluriel(refusees.length)} sur ${tranchees} idee${pluriel(tranchees)} dont le sort est connu`
      + `${jamaisLues.length ? `, ${jamaisLues.length} jamais ouverte${pluriel(jamaisLues.length)} (hors calcul)` : ''}`,
      {
        n: tranchees, genre: 'estimation',
        source: 'idees appliquees, contre idees refusees par un geste du staff (payload.ignoredBy). '
          + 'Les idees jamais ouvertes sont exclues du denominateur : elles ne sont pas un refus',
      });
  }

  // LE TROU RESTE NOMME tant qu il reste des lignes sans cause, c est-a-dire
  // anterieures au patch 45. Il se referme seul quand la fenetre de 120 jours
  // les a depassees : personne n a a s en occuper.
  if (sansCause.length) {
    poser('trou_suivi_des_idees', 'ce qu on ne sait PAS du sort des idees',
      `${sansCause.length} idee${pluriel(sansCause.length)} ${sansCause.length > 1 ? 'ont' : 'a'} ete `
      + `ignoree${pluriel(sansCause.length)} sans que la cause soit enregistree : `
      + 'anterieure a l enregistrement de la cause, et donc hors de tout taux d adoption',
      { n: sansCause.length, genre: 'denombrement', source: 'lignes ignored sans payload.ignoredBy' });
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
  // LA DEMANDE QUE LE CATALOGUE N A PAS SERVIE. La requete ne SELECTIONNE
  // aucune colonne personnelle : le nom, la societe, le telephone et le
  // message restent en base, et l email n apparait que dans le WHERE, pour
  // ecarter les lignes de demonstration, comme pour le registre.
  //
  // Pas de filtre sur `source` : une demande enregistree par le staff pour un
  // client reste une demande. Aujourd hui le formulaire public est le seul
  // ecrivain, et filtrer ne ferait que perdre en silence les futurs.
  //
  // Table absente (migration non jouee) : le centre perd ce fait, pas sa fiche.
  let demandes = [];
  try {
    const lues = await client.query(
      `
        select created_at::date::text as date, pax, occasion, status
          from custom_requests
         where center_id = $1
           and lower(coalesce(email, '')) not like $2
         order by created_at desc
         limit 300;
      `,
      [centerId, demonstrationEmailPattern()],
    );
    demandes = (lues && lues.rows) || [];
  } catch (error) {
    demandes = [];
  }
  // L HORAIRE DECLARE DE CE CENTRE, et de lui seul. La lecture vit dans
  // joursOuvertsDeclares, pure et verifiable sans base ; ici on se contente
  // de lui passer ce que la configuration porte. Un centre introuvable ne
  // fait pas tomber la fiche : il perd seulement ce fait.
  let joursOuverts = null;
  let statut = '';
  try {
    const { getCenter } = require('./ops-knowledge');
    const declaration = getCenter(centerId);
    joursOuverts = joursOuvertsDeclares(declaration.defaultSchedule);
    statut = String(declaration.status || '');
  } catch (error) {
    joursOuverts = null;
  }
  // LES FERMETURES DECLAREES. Meme lecture que la reservation, forcee pour la
  // meme raison que la configuration : un centre ferme demain doit se savoir
  // aujourd hui, pas dans trente secondes. Fail-soft : sans blocs, l agenda se
  // construit quand meme sur la seule grille.
  let agenda = null;
  let activitesBloquees = [];
  // Portee elargie : les blocs servent a l agenda, aux activites bloquees ET
  // aux prix. UNE seule lecture, sinon trois faits decrivent trois centres.
  let blocs = [];
  try {
    const { getCenter } = require('./ops-knowledge');
    const { loadAvailabilityBlocks } = require('./availability-blocks');
    blocs = await loadAvailabilityBlocks(client, centerId, { force: true }).catch(() => []);
    const declaration = getCenter(centerId);
    agenda = agendaDuCentre(declaration, blocs, aujourdhui);
    // MEME lecture de blocs que l agenda, volontairement : deux lectures
    // separees a trente secondes d intervalle decriraient deux centres.
    const { getActivityName, CLAIM_WORDS_BY_ACTIVITY } = require('./marketing-agents');
    activitesBloquees = activitesIndisponibles(declaration, blocs, agenda).map((id) => ({
      id,
      nom: getActivityName(id) || id,
      mots: CLAIM_WORDS_BY_ACTIVITY[id] || [],
    }));
  } catch (error) {
    agenda = null;
    activitesBloquees = [];
    blocs = [];
  }
  // LE CATALOGUE DE CE CENTRE, LU PAR LA MEME PORTE QUE LE TUNNEL.
  // Mesure du 2026-09-10 : sur une table `formulas` vide, le tunnel vendait
  // 14 formules de 18 a 55 EUR et la fiche n en voyait AUCUNE. La requete SQL
  // brute ne lisait qu une des trois couches du catalogue : elle manquait le
  // socle FICHIER (ops-knowledge/formulas.json), qui est ce que le tunnel
  // affiche tant que la table ne dit rien. Et la table n est peuplee que par
  // un script de backfill manuel : ce que l agent savait de l offre dependait
  // de savoir si quelqu un l avait lance.
  //
  // getEffectiveFormules empile les trois couches et exclut deja les formules
  // retirees ou desactivees pour ce centre. La surcouche que la fiche appliquait
  // elle-meme disparait donc : c etait une deuxieme implementation de la meme
  // regle, et deux implementations d une precedence finissent par diverger.
  let formulesDuCentre = [];
  let prix = [];
  // Les jours ouverts ou le parc de pistes est entierement a l arret. `null`
  // veut dire « pas su » et ne retire rien : c est le fail-open assume.
  let joursSansPiste = null;
  try {
    const { refreshCatalog } = require('./catalog-store');
    const { getEffectiveFormules, refreshFormuleOverrides } = require('./booking-config');
    // LES DEUX rafraichissements, et pas un seul. getEffectiveFormules lit
    // deux etats en memoire : celui de catalog-store (socle + table) et la
    // carte FORMULE_OVERRIDES de booking-config (la couche par centre). C est
    // ce que fait chaque route publique avant de servir le tunnel. N en
    // appeler qu un rendait la couche par centre silencieusement vide, et une
    // formule desactivee pour un centre revenait dans sa fiche.
    // Force, pour la meme raison que la configuration et les fermetures : un
    // prix change il y a dix secondes est un prix change.
    await refreshCatalog(client, { force: true });
    await refreshFormuleOverrides(client, { force: true });
    // Tout ce que rend cette liste est vendable AUJOURD HUI par ce centre :
    // `active` vaut donc vrai par construction, ce n est pas une supposition.
    const vendables = getEffectiveFormules(centerId);
    // LES PRIX, sur la MEME liste que le catalogue et le MEME agenda : trois
    // faits qui parlent du meme instant du meme centre.
    try {
      const { getCenter } = require('./ops-knowledge');
      // LE PARC DE PISTES, sur les seuls jours ouverts de la fenetre. Une seule
      // lecture pour toute la fenetre. FAIL-OPEN volontaire : sans lecture on ne
      // retire rien, comme pour les blocages de disponibilite. Un parc
      // ENTIEREMENT a l arret est exceptionnel, alors qu un incident de lecture
      // ferait taire tout le catalogue bowling d un centre qui tourne.
      try {
        const { joursSansPisteDisponible } = require('./database');
        joursSansPiste = await joursSansPisteDisponible(client, centerId,
          (agenda || []).filter((j) => j && j.ouvert && !j.ferme).map((j) => j.date));
      } catch (error) {
        joursSansPiste = null;
      }
      // Les ressources se resolvent ICI, une fois, juste apres refreshCatalog :
      // c est le seul endroit qui sait de quel centre on parle et qui a deja le
      // catalogue chaud. prixReservables reste ainsi pure, et une formule dont
      // la resolution echoue arrive sans ressources : elle ne sera pas publiee.
      prix = prixReservables(
        vendables.map(formuleAvecSesRessources), getCenter(centerId), agenda, blocs, joursSansPiste);
    } catch (error) {
      prix = [];
    }
    formulesDuCentre = vendables.map((formule) => ({
      id: formule.id,
      name: formule.name,
      min_pax: formule.minPax,
      price_type: formule.type,
      price_value: formule.price,
      active: true,
    }));
  } catch (error) {
    // getEffectiveFormules porte deja son propre repli sur le socle fichier :
    // arriver ici veut dire que le module lui-meme est casse, et une liste
    // vide est alors plus honnete qu un catalogue devine.
    formulesDuCentre = [];
    prix = [];
  }
  return ficheDuRegistre({
    reservations: reservations.rows,
    demandes,
    joursSansPiste: joursSansPiste ? [...joursSansPiste] : [],
    formules: formulesDuCentre,
    aujourdhui,
    joursOuverts,
    agenda,
    statut,
    activitesBloquees,
    prix,
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
             measured_at::text as measured_at, result, data_basis, payload
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
  agendaDuCentre,
  // Exporte pour la porte email : elle annonce les memes coupures au
  // client. Deux formateurs d heure finiraient par ne pas dire la meme.
  minutesEnHeure,
  joursOuvertsPublics,
  connaissanceDuCentre,
  joursOuvertsDeclares,
  activitesIndisponibles,
  prixReservables,
  demandesSurMesure,
  ressourcesDeLaFormule,
  formuleAvecSesRessources,
  occurrencesDuJour,
  ajouterHorizon,
  ajouterIdentite,
  ajouterMemoire,
  chargerMemoireDuCentre,
  chargerFicheDuRegistre,
  JOURS_FR,
  STATUTS_ACTIFS,
};
