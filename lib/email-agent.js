// Agent email : le « second brain » qui lit les mails reçus, dit ce que veut
// le client et propose une réponse prête à envoyer.
//
// Hiérarchie de coût (NORTHSTAR) : règles/mots-clés d'abord (gratuit, toujours
// disponibles), IA via lib/llm-client (Claude Haiku prioritaire) quand une clé
// existe. GROUNDING DUR : la réponse ne contient jamais un chiffre absent du
// brain ou du mail (même garde-fou que polishIdeaWithAi) : sinon on retombe
// sur le template FAQ.
//
// Le brain = ops-knowledge/email-brain/(faq.md, rules.md) + voix marketing +
// config RÉELLE du centre (horaires/activités via getCenter) + les dernières
// leçons apprises (table email_agent_memory : corrections du staff).
// Toutes les fonctions à effets acceptent `deps` injectables → testables sans
// base (cf. scripts/email-agent-check.js).

const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { getCenter } = require('./ops-knowledge');
// Le vrai client d un mail recu (formulaire du site, Reply-To) : 2026-09-17.
const { adresseDuClient } = require('./email-contact');
const { callLlmJson, llmProvider } = require('./llm-client');
const { normalizeClientKey } = require('./ops-communications');
const { simulationSqlExclusion } = require('./simulation-filter');
// LES REGLES D ECRITURE, LES MEMES QUE CELLES DES MAILS DU CENTRE. L agent et
// les gabarits ecrivent au meme client : deux doctrines auraient diverge, et
// c est le client qui aurait lu la difference. scripts/ecriture-client-check.js
// juge les gabarits avec ce fichier, et verifie que ce prompt le lit aussi.
const { consignesPourLAgent } = require('./client-writing');

const EMAIL_BRAIN_DIR = path.join(__dirname, '..', 'ops-knowledge', 'email-brain');

const INTENT_LABELS = {
  reservation: 'Réservation',
  annulation: 'Annulation / report',
  anniversaire: 'Anniversaire',
  prix: 'Prix & tarifs',
  horaires: 'Horaires',
  reclamation: 'Réclamation',
  // PAS UNE DEMANDE DE CLIENT : candidature, fournisseur, demarchage,
  // hameconnage. Sans ce sujet, ces messages tombaient dans « reservation »
  // ou « autre », donc dans un argumentaire de reservation.
  hors_sujet: 'Pas une demande client',
  autre: 'Autre',
};
const INTENTS = Object.keys(INTENT_LABELS);
// Les lecons (corrections du staff) que le prompt recoit : les plus proches du
// mail traite parmi les plus recentes. Toutes sont GARDEES (2026-09-24) : la
// table ne purge plus au-dela de 200, seul le prompt est borne.
const LECONS_DANS_LE_PROMPT = 12;
const LECONS_CANDIDATES = 300;

function defaultDeps() {
  const { getPool } = require('./database');
  // `reel` : la vraie base du processus (la table des faits n y est assuree
  // qu une fois), par opposition aux doubles des gates.
  return { query: (text, params) => getPool().query(text, params), reel: true };
}

function firstNameOf(name = '') {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function readBrainFile(name) {
  try {
    return fs.readFileSync(path.join(EMAIL_BRAIN_DIR, name), 'utf8');
  } catch (error) {
    return '';
  }
}

function readVoiceFile() {
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'ops-knowledge', 'marketing-brain', 'voice.md'), 'utf8');
  } catch (error) {
    return '';
  }
}

// Le NOM du centre qui parle : c'est lui qui remplace {{centre}} dans la FAQ
// fichier, les regles et la signature par defaut. Le fichier email-brain est
// NEUTRE depuis la purge de marque : aucun nom de client en dur, le texte
// servi a un centre porte toujours SON nom.
function centerNameOf(centerId) {
  try {
    return String(getCenter(centerId).name || '').trim();
  } catch (error) {
    return '';
  }
}

function fillCentre(text, centerName) {
  return String(text || '').replace(/\{\{\s*centre\s*\}\}/gi, String(centerName || '').trim() || 'votre centre');
}

function defaultSignature(centerName) {
  const name = String(centerName || '').trim();
  return name ? `L'équipe ${name}` : "L'équipe du centre";
}

// faq.md → { intent: { subject, body } }. Format : sections `## intent:xxx`,
// première ligne `Objet : …`, le reste = corps.
function parseFaqSections(faqMd = '') {
  const sections = {};
  const parts = String(faqMd).split(/^## intent:([a-z_]+)\s*$/m);
  for (let index = 1; index < parts.length - 1; index += 2) {
    const intent = parts[index];
    const lines = String(parts[index + 1] || '').trim().split('\n');
    let subject = '';
    if (/^Objet\s*:/i.test(lines[0] || '')) {
      subject = lines.shift().replace(/^Objet\s*:\s*/i, '').trim();
    }
    sections[intent] = { subject, body: lines.join('\n').trim() };
  }
  return sections;
}

const DAY_LABELS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

function scheduleLine(slot) {
  if (!slot || !slot.open) return 'fermé';
  const fmt = (time) => String(time).replace(':00', 'h').replace(':', 'h');
  const close = slot.close === '24:00' ? 'minuit' : fmt(slot.close);
  return `${fmt(slot.open)} à ${close}`;
}

// Faits RÉELS du centre pour le prompt : horaires 7 j + activités disponibles.
// Dérivés de la config (getCenter fusionne les overrides DB) : jamais inventés.
// Les libelles d activite servent a DEUX endroits : les faits durables du
// centre et l etat du jour. Une seule table, au niveau du module.
//
// Uniquement les activites du catalogue que des centres proposent reellement.
// axe_throwing, darts, free_roaming_vr et karting_vr ont ete retires le
// 2026-07-16 : aucun centre ne les propose. Les nommer ici, meme pour les
// interdire, revenait a apprendre au modele qu ils existent chez nous.
const ACTIVITY_LABELS = {
  bowling: 'bowling',
  laser_game: 'laser game',
  minigolf_blacklight: 'minigolf blacklight',
  golf_oclock: "Golf O'Clock",
  arcade_time: 'arcades',
  playground: 'plaine de jeux',
  duckpin_bowling: 'duckpin bowling',
  billards: 'billards',
  fun_run: 'fun run',
};

// Des dates ISO triees, en plages lisibles : quatorze dates a la file sont
// du bruit, « 2026-09-12 -> 2026-09-20 » se lit. Pure, testable seule.
function plagesDeDates(dates) {
  const triees = [...new Set((dates || []).map((d) => String(d).slice(0, 10)).filter(Boolean))].sort();
  const plages = [];
  triees.forEach((date) => {
    const derniere = plages[plages.length - 1];
    const veille = derniere
      ? new Date(Date.parse(`${derniere.fin}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
      : null;
    if (derniere && veille === date) derniere.fin = date;
    else plages.push({ debut: date, fin: date });
  });
  return plages.map((p) => (p.debut === p.fin ? p.debut : `${p.debut} -> ${p.fin}`));
}

// L ETAT REEL DU CENTRE SUR LA FENETRE, en une chaine destinee au modele.
// Vide quand tout est normal : sans fermeture ni blocage, le prompt ne bouge
// pas d un caractere.
//
// Les DATES et pas un verdict global : l agent marketing ecrit un texte qui
// vaut pour la quinzaine, un email repond a une question sur UN jour. « Le
// laser est indisponible les 12 et 13 » est la seule forme qui permette de
// repondre juste a « laser game samedi ? ».
//
// La RAISON de la fermeture ne sort pas : le gerant ecrit « travaux » ou
// « fete privee » pour son equipe, pas pour la boite mail du client.
async function etatDuCentre(centerId = 'libramont', deps = defaultDeps(), aujourdhui = '') {
  const { agendaDuCentre, minutesEnHeure } = require('./center-facts');
  const { loadAvailabilityBlocks, isActivityFullyBlockedOn,
    resolveBlocksForDate } = require('./availability-blocks');
  const jour = String(aujourdhui || new Date().toISOString()).slice(0, 10);
  let centre = null;
  let blocs = [];
  try {
    centre = getCenter(centerId);
    blocs = await loadAvailabilityBlocks(deps, centerId, { force: true }).catch(() => []);
  } catch (error) {
    return '';
  }
  const agenda = agendaDuCentre(centre, blocs, jour);
  if (!agenda.length) return '';
  const lignes = [];
  // FERMETURES. Deux questions distinctes, et l ordre compte :
  //
  //   FAUT-IL en parler ? Seulement s il existe au moins une fermeture
  //   EXCEPTIONNELLE. Sans elle il n y a pas de nouvelle, et lister les lundis
  //   de tous les centres ajouterait du bruit a chaque reponse.
  //
  //   QUOI dire alors ? TOUS les jours ou le centre n ouvre pas, y compris les
  //   jours deja fermes a la grille. Premiere version : les fermetures
  //   exceptionnelles seules, ce qui donnait « 12 -> 13, 15 -> 20 » parce que
  //   le 14 est un lundi. Exact, et un lecteur en deduit qu on ouvre le 14.
  //   La liste complete rend une plage continue, « 12 -> 20 », et evite au
  //   modele d avoir a recouper deux sources pour une seule question.
  const exceptionnelles = agenda.filter((j) => j.ouvert && j.ferme);
  if (exceptionnelles.length) {
    const fermes = agenda.filter((j) => !j.ouvert || j.ferme).map((j) => j.date);
    lignes.push(`Le centre N OUVRE PAS : ${plagesDeDates(fermes).join(', ')}. `
      + 'Ne propose aucun creneau ces jours-la, dis-le clairement et sans en donner la raison.');
  }
  // COUPURES DU CENTRE : quelques heures, pas la journee. agendaDuCentre les
  // calcule depuis toujours ; elles etaient jetees ici. Un jour deja annonce
  // comme ferme n en recoit pas en plus : les jours fermes sont hors de
  // cette liste par construction.
  //
  // Regroupees PAR PLAGE : « de 14 h a 16 h » pendant dix jours fait une
  // ligne, pas dix.
  const parPlage = (paires) => {
    const table = new Map();
    paires.forEach(({ plage, date }) => {
      if (!table.has(plage)) table.set(plage, []);
      table.get(plage).push(date);
    });
    return [...table.entries()];
  };
  const plageDite = (debut, fin) => `de ${minutesEnHeure(debut, 'debut')} a ${minutesEnHeure(fin, 'fin')}`;
  const coupuresDuCentre = [];
  agenda.filter((j) => j.ouvert && !j.ferme).forEach((j) => {
    (j.coupures || []).forEach((coupure) => {
      coupuresDuCentre.push({ plage: plageDite(coupure.debut, coupure.fin), date: j.date });
    });
  });
  parPlage(coupuresDuCentre).forEach(([plage, dates]) => {
    lignes.push(`Le centre est FERME ${plage}, ${plagesDeDates(dates).join(', ')}. `
      + 'Ne propose aucun creneau sur cette plage ces jours-la, et n en donne pas la raison.');
  });

  // ACTIVITES : bloquees toute la journee, avec LEURS dates. On ne regarde
  // que les jours ou le centre ouvre : dire qu une activite est fermee un
  // jour ou le centre l est aussi n apprend rien et brouille la reponse.
  const ouvrants = agenda.filter((j) => j.ouvert && !j.ferme).map((j) => j.date);
  const declarees = (centre && centre.activityAvailability) || {};
  Object.keys(declarees).filter((id) => declarees[id] && ACTIVITY_LABELS[id]).forEach((id) => {
    const bloques = ouvrants.filter((date) => isActivityFullyBlockedOn(blocs, date, id));
    if (!bloques.length) return;
    lignes.push(`${ACTIVITY_LABELS[id]} : INDISPONIBLE ${plagesDeDates(bloques).join(', ')}. `
      + 'Ne le promets jamais pour ces dates.');
  });

  // COUPURES D UNE ACTIVITE : quelques heures, pas la journee. Celles-ci n
  // etaient calculees NULLE PART : isActivityFullyBlockedOn ne repond que
  // sur la journee entiere, par construction. Un jour deja annonce comme
  // entierement indisponible est retire : deux phrases dont l une contredit
  // l autre font trancher le modele au hasard.
  Object.keys(declarees).filter((id) => declarees[id] && ACTIVITY_LABELS[id]).forEach((id) => {
    const coupures = [];
    ouvrants.filter((date) => !isActivityFullyBlockedOn(blocs, date, id)).forEach((date) => {
      resolveBlocksForDate(blocs, date)
        .filter((bloc) => bloc && bloc.scopeType === 'activity' && String(bloc.scopeRef) === id
          && !(bloc.startMin === null && bloc.endMin === null))
        .forEach((bloc) => {
          coupures.push({ plage: plageDite(bloc.startMin, bloc.endMin), date });
        });
    });
    parPlage(coupures).forEach(([plage, dates]) => {
      lignes.push(`${ACTIVITY_LABELS[id]} : INDISPONIBLE ${plage}, ${plagesDeDates(dates).join(', ')}. `
        + 'Ne le promets jamais sur cette plage ces jours-la.');
    });
  });
  if (!lignes.length) return '';
  return [
    `Etat releve le ${jour}, sur les ${agenda.length} prochains jours SEULEMENT : `
    + 'au-dela de cette fenetre tu ne sais rien, propose de confirmer par retour.',
    ...lignes,
  ].join('\n');
}

// LES PRIX A L UNITE, TELS QUE LE TUNNEL LES FACTURE.
//
// Deux branches et une seule, les memes que getBasePrice : la grille AUX
// PARTIES que le centre declare, sinon la grille par piste du moteur. Un
// centre qui pose la sienne annonce la sienne, sans une ligne de plus ici.
//
// Une duree ne se dit pas comme une heure de la journee : « 1.5 » vaut « 1 h
// 30 » de jeu, pas « une heure et demie du matin ». D ou un formateur local,
// et non minutesEnHeure, qui repond a l autre question.
// LE PRIX D UNE PARTIE : cette porte LIT le calcul, elle ne le refait pas.
// Il vit dans center-facts, avec les autres faits du centre, parce que la
// porte publique en a besoin aussi. Deux calculs d un meme prix finissent
// par diverger, et c est le client qui paie la difference.
function prixALaCarte(centerId = 'libramont', aujourdhui = '') {
  const { prixUnitaires } = require('./center-facts');
  let center = null;
  try { center = getCenter(centerId); } catch (error) { return ''; }
  let unitaires = null;
  try { unitaires = prixUnitaires(center, aujourdhui); } catch (error) { return ''; }
  const lignes = [];

  if (unitaires.bowling) {
    // UNE GRILLE AUX PARTIES PEUT CHANGER SELON LE JOUR : on le DIT, sinon
    // le modele donne le tarif de mardi pour un samedi.
    const entete = unitaires.bowling.tarifDuJour
      ? 'Bowling (tarif du jour, il peut changer selon le jour : pour une autre date, propose de confirmer par retour)'
      : 'Bowling';
    lignes.push(`${entete} : ${unitaires.bowling.options.join(' · ')}.`);
  }

  if (unitaires.laser) lignes.push(`Laser Game : ${unitaires.laser.options.join(' · ')}.`);

  if (!lignes.length) return '';

  // LES AUTRES ACTIVITES SONT NOMMEES, PAS TUES. Le moteur ne calcule aucun
  // prix a l unite pour elles ; se taire laisserait le modele deviner, les
  // nommer lui donne la seule reponse vraie, « je confirme par retour ».
  const sansTarif = (unitaires.sansTarif || [])
    .filter((id) => ACTIVITY_LABELS[id]).map((id) => ACTIVITY_LABELS[id]);
  if (sansTarif.length) {
    lignes.push(`Aucun prix a l unite n existe dans le systeme pour : ${sansTarif.join(', ')}. `
      + `Ne les chiffre jamais de toi-meme ; si l equipe t a appris leur prix (bloc « ${BLOC_APPRIS} »), donne celui-la, sinon propose de confirmer par retour.`);
  }
  return lignes.join('\n');
}

// LES PRIX QUE CE CENTRE PEUT TENIR, aujourd hui, valides un par un par le
// moteur de reservation. Meme fonction que la porte publique
// (center-facts.prixReservables) : une seule regle, deux portes. Un prix
// annonce par mail et refuse par le tunnel serait pire que pas de prix.
//
// La liste est VIDE quand le centre n a pas de grille horaire posee : sans
// agenda il n y a aucun jour ou soumettre la formule au moteur, donc rien
// a affirmer. C est ce qui garde Gembloux et Ciney silencieux sur les prix.
async function prixDuCentre(centerId = 'libramont', deps = defaultDeps(), aujourdhui = '', heure = null) {
  const {
    agendaDuCentre, agendaDesPrix, arriveesDAujourdhui, prixReservables, formuleAvecSesRessources,
  } = require('./center-facts');
  const { loadAvailabilityBlocks } = require('./availability-blocks');
  const { joursSansPisteDisponible } = require('./database');
  const { getEffectiveFormules, refreshFormuleOverrides, todayStr } = require('./booking-config');
  const { refreshCatalog } = require('./catalog-store');
  const jour = String(aujourdhui || new Date().toISOString()).slice(0, 10);
  let centre = null;
  let blocs = [];
  try {
    centre = getCenter(centerId);
    blocs = await loadAvailabilityBlocks(deps, centerId, { force: true }).catch(() => []);
    // Force, pour la meme raison que la configuration : un prix change il y a
    // dix secondes est un prix change, et celui-ci part vers un client.
    await refreshCatalog(deps, { force: true });
    await refreshFormuleOverrides(deps, { force: true });
  } catch (error) { return ''; }
  const agenda = agendaDuCentre(centre, blocs, jour);
  if (!agenda.length) return '';
  // LE PARC DE PISTES, comme a la porte publique : un tarif annonce par mail
  // et refuse par le tunnel est pire qu un tarif non donne, parce que le
  // client a la reponse ecrite sous les yeux quand sa reservation echoue.
  // FAIL-OPEN, meme raison qu ailleurs : sans lecture on ne retire rien.
  let joursSansPiste = null;
  try {
    joursSansPiste = await joursSansPisteDisponible(deps, centerId,
      agenda.filter((j) => j.ouvert && !j.ferme).map((j) => j.date));
  } catch (error) { joursSansPiste = null; }
  let prix = [];
  // LE CATALOGUE EFFECTIF, garde sous la main. C est lui qui porte ce que la
  // formule CONTIENT et ses conditions ecrites, et c est le MEME objet que
  // celui dont le prix vient d etre valide : aller les rechercher ailleurs
  // ouvrirait la porte a deux verites pour une seule formule.
  let catalogue = [];
  // LES JOURS QUE LE TUNNEL JUGE EN ENTIER : a partir de demain. Aujourd hui
  // a sa propre ligne, heure par heure.
  const agendaPrix = agendaDesPrix(agenda, jour);
  let duJour = [];
  try {
    catalogue = getEffectiveFormules(centerId).map(formuleAvecSesRessources);
    prix = prixReservables(catalogue, centre, agendaPrix, blocs, joursSansPiste);
    // AUJOURD HUI, quand l appelant dit l heure ET que c est le jour du
    // moteur : le tunnel ne retire les heures passees que de SON aujourd hui.
    // Un autre jour, pas de ligne plutot qu une ligne fausse.
    if (heure !== null && heure !== undefined && Number.isFinite(Number(heure)) && jour === todayStr()) {
      duJour = arriveesDAujourdhui(catalogue, centre, jour, blocs, joursSansPiste);
    }
  } catch (error) { prix = []; duJour = []; }
  if (!prix.length) return '';
  const documentDe = new Map(catalogue.map((formule) => [String(formule && formule.id), formule]));
  // MOT POUR MOT COMME SUR LE SITE. desc est la liste que le client lit dans
  // le tunnel, notes ses conditions ecrites. Reecrire l une ou l autre ferait
  // dire a l agent une chose et au site une autre.
  const listeDe = (valeur) => (Array.isArray(valeur) ? valeur : [])
    .map((ligne) => String(ligne || '').trim()).filter(Boolean);
  const lignes = prix.map((p) => {
    const document = documentDe.get(String(p.id)) || {};
    const comprend = listeDe(document.desc);
    const conditions = listeDe(document.notes);
    return `${p.nom} : ${p.prix} EUR ${p.unite}, `
      + `${p.minimum > 1 ? `des ${p.minimum} personnes` : 'sans minimum de personnes'}`
      + `${p.jours === p.surTotal ? '' : `, ${p.jours} jours sur ${p.surTotal} seulement`}`
      + `${p.horaire ? `, ${p.horaire}` : ''}`
      + `${comprend.length ? ` | comprend : ${comprend.join(' · ')}` : ''}`
      // COMBIEN DE TEMPS CA PREND, entre ce que la formule comprend et ses
      // conditions : c est l ordre dans lequel la question se pose quand on
      // organise un anniversaire.
      + `${tempsDuTunnel(p, document) ? ` | ${tempsDuTunnel(p, document)}` : ''}`
      + `${conditions.length ? ` | conditions : ${conditions.join(' · ')}` : ''}`
      // CE QUE LE CLIENT RECOIT APRES AVOIR RESERVE : la reponse de reference
      // promet « confirme tout de suite », ce qui est faux de trois formules.
      + `${confirmationDeLaFormule(p.id) ? ` | confirmation : ${confirmationDeLaFormule(p.id)}` : ''}`;
  });
  return [
    `Tarifs releves le ${jour} pour CE centre, sur les ${agendaPrix.length} jours a partir de demain. `
    + 'Tu peux les citer tels quels, AVEC leur condition. Tu ne calcules JAMAIS un '
    + 'total pour un groupe et tu n additionnes rien : seul le tunnel de reservation '
    + 'fait un total. Un tarif absent de cette liste n existe pas : propose de le '
    + 'confirmer par retour au lieu de l inventer. Ce qu une formule COMPREND est '
    + 'la liste du site : cite-la telle quelle, n y ajoute aucune activite et n en '
    + 'retire aucune.',
    ...lignes,
    ligneDuJour(duJour, heure),
  ].filter(Boolean).join('\n');
}

// AUJOURD HUI, QUAND ON SAIT L HEURE. « On peut venir cet apres-midi ? » se
// repond ici : pour chaque formule, les heures d arrivee que le tunnel propose
// ENCORE, et celles qui ne se reservent plus aujourd hui. Les heures sont
// celles de proposedArrivals, heures passees deja retirees par le moteur :
// rien ici ne les recalcule. Une liste a trous (une fermeture ponctuelle au
// milieu) se dit en plages, jamais d une premiere a une derniere heure qui
// enjamberait le trou.
function ligneDuJour(duJour, heure) {
  if (heure === null || heure === undefined || !Number.isFinite(Number(heure))) return '';
  if (!Array.isArray(duJour) || !duJour.length) return '';
  const { heureDite } = require('./center-facts');
  const enTete = `AUJOURD HUI, il est ${heureDite(Number(heure))} : `;
  const possibles = duJour.filter((f) => f.heures.length).map((f) => `${f.nom} ${plagesDesHeures(f.heures)}`);
  const plusPossibles = duJour.filter((f) => !f.heures.length).map((f) => f.nom);
  if (!possibles.length) return `${enTete}plus aucune formule ne se reserve aujourd hui.`;
  return `${enTete}arrivee encore possible pour ${possibles.join(' · ')}`
    + `${plusPossibles.length ? ` ; plus possible aujourd hui : ${plusPossibles.join(' · ')}` : ''}`
    + '. Sous reserve de place : seul le tunnel confirme un creneau. La reponse part apres validation par '
    + 'l equipe : donne l heure limite d arrivee, jamais « tout de suite ».';
}

// DES HEURES EN PLAGES, comme on les dit : « de 16 h a 18 h 30 et de 20 h a
// 21 h 30 », « a 19 h » pour une seule. Deux heures se suivent quand une
// demi-heure les separe : c est le pas du tunnel pour un depart de formule.
function plagesDesHeures(heures) {
  const { heureDite } = require('./center-facts');
  const { timeToNum } = require('./booking-config');
  const valeurs = [...new Set((Array.isArray(heures) ? heures : []).map(timeToNum))]
    .filter(Number.isFinite).sort((a, b) => a - b);
  const plages = [];
  valeurs.forEach((v) => {
    const derniere = plages[plages.length - 1];
    if (derniere && Math.abs(v - derniere.fin - 0.5) < 1e-6) derniere.fin = v;
    else plages.push({ debut: v, fin: v });
  });
  return plages
    .map((p) => (p.debut === p.fin ? `a ${heureDite(p.debut)}` : `de ${heureDite(p.debut)} a ${heureDite(p.fin)}`))
    .join(' et ');
}

function buildCenterFacts(centerId = 'libramont') {
  let center = null;
  try {
    center = getCenter(centerId);
  } catch (error) {
    return `Centre : ${centerId}.`;
  }
  const lines = [`Centre : ${center.name}.`];

  // OU NOUS SOMMES, ET COMMENT ON NOUS JOINT. Ces quatre champs sont ceux
  // que le centre publie deja sur le site ; ils vivaient dans la config sans
  // jamais atteindre la porte email.
  //
  // AUCUN REPLI : une coordonnee absente ne se remplace pas par celle d un
  // voisin. Donner l adresse de Libramont a un client de Gembloux l enverrait
  // a cent trente kilometres.
  //
  // ET UN REFUS EXPLICITE, contrairement a la capacite : une adresse est
  // exactement ce qu un modele fabrique quand on la lui demande et qu il ne
  // l a pas. Meme doctrine que les horaires non renseignes ci-dessous.
  const info = (center && center.publicInfo) || {};
  const texteDe = (cle) => String(info[cle] || '').trim();
  const coordonnees = [
    ['address', 'Adresse'], ['phone', 'Téléphone'], ['email', 'Email'], ['parking', 'Parking'],
  ].filter(([cle]) => texteDe(cle)).map(([cle, etiquette]) => `${etiquette} : ${texteDe(cle)}.`);
  if (coordonnees.length) {
    lines.push(`Coordonnées de CE centre (n'en invente aucune, n'en emprunte aucune à un autre centre) : ${coordonnees.join(' ')}`);
  } else {
    lines.push(`Coordonnées : NON RENSEIGNÉES pour ce centre. N invente ni adresse, ni téléphone, ni email, ni parking, et n en emprunte à aucun autre centre : propose au client qu on le rappelle. Seule exception : ce que l équipe t a appris (bloc « ${BLOC_APPRIS} »), vrai, à dire.`);
  }

  // LE MOYEN D AGIR. La voix de la maison demande de terminer par un lien, et
  // le cerveau n en contenait AUCUN : la doctrine reclamait donc au modele une
  // chose qu il ne pouvait que fabriquer, et un lien faux envoye a un client
  // est pire que pas de lien.
  //
  // On donne les adresses DECLAREES avec leur intitule declare. On ne
  // rebaptise rien « reservation » : aucun champ ne declare une page de
  // reservation, et appeler « reserver » une page qui ne reserve pas serait
  // l invention qu on ferme ici.
  const identite = (center && center.identity) || {};
  const estUneAdresseWeb = (valeur) => /^https?:\/\//i.test(String(valeur || '').trim());
  const adressesWeb = [];
  // logoUrl est un chemin relatif (« ./assets/... ») : il n a aucun sens dans
  // un mail, et le filtre http(s) le retire tout seul.
  if (estUneAdresseWeb(identite.siteUrl)) adressesWeb.push(`Site : ${String(identite.siteUrl).trim()}.`);
  (Array.isArray(identite.siteLinks) ? identite.siteLinks : []).forEach((lien) => {
    const libelle = String((lien && lien.label) || '').trim();
    const adresse = String((lien && lien.url) || '').trim();
    if (libelle && estUneAdresseWeb(adresse)) adressesWeb.push(`${libelle} : ${adresse}.`);
  });
  if (adressesWeb.length) {
    lines.push(`Liens officiels déclarés par CE centre (n'en invente aucun, n'en devine aucun, ne raccourcis ni ne modifie une adresse, et n'appelle pas « réservation » une page qui ne le dit pas) : ${adressesWeb.join(' ')}`);
  } else {
    lines.push('Liens : AUCUN lien officiel n est déclaré pour ce centre. N écris jamais une adresse web, même plausible : invite le client à répondre à ce mail.');
  }
  // `defaultSchedule` peut etre une CHAINE sentinelle
  // (« same_as_libramont_public_schedule », « to_confirm ») que center-config
  // conserve telle quelle. `?.regular` valait alors undefined, `|| {}` une
  // grille vide, et les sept jours sortaient « fermé » vers le modele qui
  // repond aux clients. Le test est le meme que celui du cockpit du fondateur
  // (« un marqueur texte n'est PAS un horaire pose ») : une seule doctrine.
  const grille = center.defaultSchedule && typeof center.defaultSchedule === 'object'
    && center.defaultSchedule.regular && typeof center.defaultSchedule.regular === 'object'
    ? center.defaultSchedule.regular
    : null;
  const horairePose = Boolean(grille
    && Object.values(grille).some((day) => day && typeof day === 'object'));
  const ordered = [1, 2, 3, 4, 5, 6, 0];
  if (horairePose) {
    // On n annonce que les jours effectivement declares. Un jour absent de la
    // grille ne devient pas « fermé » : il ne devient rien.
    const declares = ordered.filter((day) => grille[String(day)] !== undefined || grille[day] !== undefined);
    lines.push(`Horaires habituels : ${declares.map((day) => `${DAY_LABELS[day]} ${scheduleLine(grille[String(day)] !== undefined ? grille[String(day)] : grille[day])}`).join(' · ')}.`);
  } else {
    // Le silence ne suffit pas : un modele comble un vide. On lui INTERDIT
    // d annoncer une ouverture ou une fermeture, et on lui donne la sortie.
    const tel = String((center.publicInfo || {}).phone || '').trim();
    lines.push(`Horaires habituels : NON RENSEIGNÉS pour ce centre. N annonce jamais une ouverture, une fermeture ni une plage horaire, et ne les déduis d aucun autre centre : ${
      tel ? `invite le client à appeler le ${tel}` : 'invite le client à nous appeler'}.`);
  }
  const holiday = grille && center.defaultSchedule.holiday && typeof center.defaultSchedule.holiday === 'object'
    ? center.defaultSchedule.holiday
    : null;
  // Les deux creneaux cites doivent EXISTER : sans ca la phrase disait
  // « ouvert tous les jours (fermé en semaine) », qui se contredit elle-meme.
  const semaine = holiday && (holiday['1'] || holiday[1]);
  const weekEnd = holiday && (holiday['5'] || holiday[5]);
  if (semaine && typeof semaine === 'object' && weekEnd && typeof weekEnd === 'object') {
    lines.push(`Congés scolaires : ouvert tous les jours (${scheduleLine(semaine)} en semaine, ${scheduleLine(weekEnd)} vendredi/samedi).`);
  }
  const availability = center.activityAvailability || {};
  // Uniquement les activites du catalogue que des centres proposent reellement.
  // axe_throwing, darts, free_roaming_vr et karting_vr ont ete retires le
  // 2026-07-16 : aucun centre ne les propose. Les nommer ici, meme pour
  // les interdire, revenait a apprendre au modele qu'ils existent chez nous.
  const available = Object.entries(availability)
    .filter(([, ok]) => ok)
    .map(([key]) => ACTIVITY_LABELS[key] || key.replace(/_/g, ' '));
  if (available.length) lines.push(`Activités disponibles : ${available.join(', ')}.`);
  // On ne liste comme « non proposee » qu'une activite qui existe VRAIMENT
  // ailleurs (un client peut demander une activite vue dans un centre voisin).
  // Une activite absente d'ACTIVITY_LABELS n'existe nulle part : la nommer,
  // meme pour l'interdire, apprendrait au modele qu'elle existe (c'est ainsi
  // qu'un post de prod a promis du Karting VR le 15/07). Ce qui n'existe pas
  // ne se mentionne pas.
  const unavailable = Object.entries(availability)
    .filter(([key, ok]) => !ok && ACTIVITY_LABELS[key])
    .map(([key]) => ACTIVITY_LABELS[key]);
  if (unavailable.length) lines.push(`Proposé dans l'autre centre mais PAS ici (ne jamais le promettre pour ce centre) : ${unavailable.join(', ')}.`);
  // LE REFUS DE PRIX N EST PLUS ICI. Il dependait de rien et contredisait le
  // bloc TARIFS que buildEmailBrain pose maintenant quand le centre en a. Un
  // modele qui lit « ne jamais donner un prix » et une liste de prix dans le
  // meme message tranche au hasard. La regle vit desormais la ou les deux cas
  // sont connus : des prix, ou un refus, jamais les deux.
  lines.push('Formules anniversaire : à partir de 6 enfants.');

  // CE QUE LE LIEU PEUT ACCUEILLIR. « On est 40, c est jouable ? » est une des
  // questions les plus frequentes, et cette porte n avait aucun chiffre : la
  // porte marketing les a depuis toujours.
  //
  // AUCUN REPLI : une valeur non declaree ne produit AUCUNE ligne. Le moteur,
  // lui, retombe sur 8 pistes et 30 armes quand rien n est pose, et ce sont
  // celles de Libramont : les servir a un autre centre serait la fuite que les
  // patches 46 et 52b ont fermee ailleurs.
  const nombreSur = (valeur) => (Number.isFinite(Number(valeur)) && Number(valeur) > 0 ? Number(valeur) : 0);
  const ressources = (center && center.resources) || {};
  const capacites = [];
  const pistes = nombreSur(ressources.bowling && ressources.bowling.laneCount);
  const parPiste = nombreSur(ressources.bowling && ressources.bowling.normalCapacityPerLane);
  if (pistes) {
    capacites.push(`Bowling : ${pistes} piste${pistes > 1 ? 's' : ''}`
      + `${parPiste ? `, ${parPiste} joueurs par piste au confort` : ''}.`);
  }
  const joueursLaser = nombreSur(ressources.laser && ressources.laser.maxPlayers)
    || nombreSur(ressources.laser && ressources.laser.weaponCount);
  const lancements = nombreSur(ressources.laser && ressources.laser.parallelLaunches);
  if (joueursLaser) {
    capacites.push(`Laser Game : ${joueursLaser} joueurs par session`
      + `${lancements > 1 ? `, jusqu'à ${lancements} sessions en parallèle` : lancements === 1 ? ', une session à la fois' : ''}.`);
  }
  if (ressources.laser && ressources.laser.requiresCompleteGroupBeforeLaunch === true) {
    capacites.push('Une session de Laser Game part avec le groupe complet : les retardataires attendent la suivante.');
  }
  // La phrase de garde n arrive qu AVEC le bloc : sans capacite declaree, pas
  // de bloc, donc pas de garde qui ne garde rien.
  if (capacites.length) {
    lines.push(`Capacité du lieu (ce n'est PAS une disponibilité : ne promets jamais qu'un créneau est libre, propose de le confirmer) : ${capacites.join(' ')}`);
  }

  // QUI PEUT ENTRER, ET POUR COMBIEN DE TEMPS. « Mon fils a 5 ans, il peut
  // faire du laser ? » se repondait jusqu ici avec la seule liste des
  // activites disponibles, donc par « oui ». La reponse est NON : 7 ans et
  // 130 cm, et ce sont des chiffres du centre, pas du moteur.
  //
  // Une activite THEMEE mais non declaree disponible ne sort pas : ce serait
  // promettre un Golf O Clock a un centre qui n en a pas.
  const themes = (center && center.activityThemes) || {};
  const conditions = Object.keys(themes)
    .filter((cle) => availability[cle] === true && ACTIVITY_LABELS[cle])
    .map((cle) => {
      const theme = themes[cle] || {};
      const bouts = [];
      const univers = String(theme.theme || '').trim();
      if (univers) bouts.push(`univers ${univers}`);
      const age = nombreSur(theme.minAge);
      const tranche = String(theme.ageRange || '').trim();
      if (age) bouts.push(`à partir de ${age} ans`);
      else if (tranche) bouts.push(`de ${tranche}`);
      const taille = nombreSur(theme.minHeightCm);
      if (taille) bouts.push(`taille minimum ${taille} cm`);
      const duree = nombreSur(theme.gameMinutes);
      if (duree) bouts.push(`une partie dure ${duree} minutes`);
      return bouts.length ? `${ACTIVITY_LABELS[cle]} : ${bouts.join(', ')}.` : '';
    })
    .filter(Boolean);
  // Le refus est EXPLICITE quand il n y a rien, contrairement a la capacite
  // ci-dessus : se taire sur une capacite ne promet rien, se taire sur un age
  // minimum laisse le modele en inventer un.
  if (conditions.length) {
    lines.push(`Conditions d'accès déclarées par CE centre (âge, taille, durée : ce sont les règles de la maison, dis-les telles quelles et n'en invente aucune) :\n${conditions.map((ligne) => `- ${ligne}`).join('\n')}`);
  } else {
    lines.push(`Conditions d'accès : NON RENSEIGNÉES pour ce centre. N annonce jamais un âge minimum, une taille minimum ni une durée de partie, et ne les déduis d aucun autre centre : propose de confirmer par retour. Seule exception : ce que l équipe t a appris (bloc « ${BLOC_APPRIS} »), vrai, à dire.`);
  }
  return lines.join('\n');
}

async function getAgentLessons(centerId = 'libramont', deps = defaultDeps(), limit = LECONS_DANS_LE_PROMPT) {
  try {
    const result = await deps.query(
      `select intent, question_excerpt, learned_reply
       from email_agent_memory
       where center_id = $1
       order by created_at desc
       limit $2;`,
      [centerId, limit],
    );
    return result.rows || [];
  } catch (error) {
    return [];
  }
}

/* ── « Ce que l'agent sait » : overrides ÉDITABLES par le gérant ────────────
   Stockés dans center_automation_settings.settings.email_brain (jsonb, pas de
   migration) : { faq: { <intent>: { subject, body } }, signature, extra }.
   Priorité : override gérant > fichier email-brain. ── */

const BRAIN_LIMITS = { subject: 140, body: 2000, extra: 3000, signature: 120 };

async function getEmailBrainOverrides(centerId = 'libramont', deps = defaultDeps()) {
  try {
    const result = await deps.query(
      'select settings from center_automation_settings where center_id = $1 limit 1;',
      [centerId],
    );
    const settings = result.rows?.[0]?.settings || {};
    const brain = settings.email_brain || {};
    return {
      faq: brain.faq && typeof brain.faq === 'object' ? brain.faq : {},
      signature: typeof brain.signature === 'string' ? brain.signature : '',
      extra: typeof brain.extra === 'string' ? brain.extra : '',
    };
  } catch (error) {
    return { faq: {}, signature: '', extra: '' };
  }
}

// Les défauts visibles par l'UI (placeholders + reset) : FAQ fichier parsée,
// {{centre}} rempli avec le nom du centre demandé (neutre sans centre).
function getEmailBrainDefaults(centerId = '') {
  const centerName = centerId ? centerNameOf(centerId) : '';
  const faq = parseFaqSections(readBrainFile('faq.md'));
  const filled = {};
  for (const [intent, entry] of Object.entries(faq)) {
    filled[intent] = { subject: fillCentre(entry.subject, centerName), body: fillCentre(entry.body, centerName) };
  }
  return {
    intents: INTENT_LABELS,
    faq: filled,
    signature: defaultSignature(centerName),
  };
}

// Patch validé du brain : {faq:{intent:{subject,body}|null}, signature?, extra?}.
// null sur un intent → reset au fichier. Champs absents → inchangés.
async function saveEmailBrainOverrides(centerId, patch = {}, deps = defaultDeps()) {
  const current = await getEmailBrainOverrides(centerId, deps);
  const next = { faq: { ...current.faq }, signature: current.signature, extra: current.extra };

  if (patch.faq && typeof patch.faq === 'object') {
    for (const [intent, value] of Object.entries(patch.faq)) {
      if (!INTENTS.includes(intent)) { const e = new Error(`Sujet inconnu : ${intent}.`); e.expose = true; throw e; }
      if (value === null) { delete next.faq[intent]; continue; }
      const subject = String(value?.subject || '').trim();
      const body = String(value?.body || '').trim();
      if (!body) { const e = new Error(`La réponse « ${INTENT_LABELS[intent]} » est vide : utilisez Réinitialiser pour revenir au modèle.`); e.expose = true; throw e; }
      if (subject.length > BRAIN_LIMITS.subject) { const e = new Error(`Objet trop long (${BRAIN_LIMITS.subject} caractères max).`); e.expose = true; throw e; }
      if (body.length > BRAIN_LIMITS.body) { const e = new Error(`Réponse trop longue (${BRAIN_LIMITS.body} caractères max).`); e.expose = true; throw e; }
      next.faq[intent] = { subject, body };
    }
  }
  if (patch.signature !== undefined) {
    const signature = String(patch.signature || '').trim();
    if (signature.length > BRAIN_LIMITS.signature) { const e = new Error(`Signature trop longue (${BRAIN_LIMITS.signature} caractères max).`); e.expose = true; throw e; }
    next.signature = signature;
  }
  if (patch.extra !== undefined) {
    const extra = String(patch.extra || '').trim();
    if (extra.length > BRAIN_LIMITS.extra) { const e = new Error(`Texte trop long (${BRAIN_LIMITS.extra} caractères max).`); e.expose = true; throw e; }
    next.extra = extra;
  }

  // FUSION AU SECOND NIVEAU (2026-09-24). L ancienne ecriture remplacait tout
  // `email_brain` par { faq, signature, extra } : ce qu il contenait d autre
  // (les faits appris, jusqu a ce qu ils aient leur table) disparaissait a
  // chaque enregistrement de la signature ou d une reponse type, sans rien
  // dire.
  await deps.query(
    `insert into center_automation_settings (center_id, settings, updated_at)
     values ($1, jsonb_build_object('email_brain', $2::jsonb), now())
     on conflict (center_id)
     do update set settings =
       coalesce(center_automation_settings.settings, '{}'::jsonb)
       || jsonb_build_object('email_brain', coalesce(center_automation_settings.settings->'email_brain', '{}'::jsonb) || $2::jsonb),
       updated_at = now();`,
    [centerId, JSON.stringify(next)],
  );
  return next;
}

// CE QUE L EQUIPE A APPRIS A L AGENT : SA MEMOIRE.
//
// Rangee a part de la FAQ : la FAQ est une reponse TYPE par sujet connu (une
// liste fermee, editable ligne a ligne dans la console), ici ce sont des FAITS
// que personne n avait prevus, ajoutes au fil des vraies questions des
// clients, ou appris d office par l equipe.
//
// UNE TABLE A ELLE, PAR CENTRE, SANS PLAFOND (Movsar, 2026-09-24 : « faut
// vraiment un gros systeme ou il apprend, ou tout est stocke »). Avant, les
// faits vivaient dans le JSON des reglages (email_brain.appris), plafonnes a
// 80 (les plus anciens sortaient sans rien dire), et l enregistrement de
// « Ce que l agent ecrit » reecrivait email_brain SANS eux. Ici :
//   - chaque fait est une ligne de SON centre, jamais lue pour un autre :
//     chaque centre a son agent ;
//   - reposer la meme question remplace la reponse, l ancienne reste dans
//     `versions` ;
//   - « Oublier » retire le fait de la memoire active sans l effacer ;
//   - les faits du JSON d avant sont importes une fois, a la premiere lecture ;
//   - si la table est inaccessible, l agent lit l ancien JSON : il repond
//     avec ce qu il savait plutot que pas du tout.
// Le prompt, lui, reste borne : au-dela de FAITS_BUDGET caracteres, l agent
// recoit les faits les plus proches du mail qu il traite (choisirFaits).
const APPRIS_LIMITS = { question: 300, reponse: 2000 };
// LE BLOC QUE L EQUIPE REMPLIT, et ce qu il vaut (2026-09-25). Movsar apprend
// a l agent les tarifs des arcades ; la reponse refaite dit encore « il
// n existe pas de tarif a l unite dans notre systeme ». Le fait etait bien
// dans le prompt, mais une phrase ecrite par NOUS disait plus bas « aucun prix
// a l unite pour les arcades, ne les chiffre jamais », et le modele l a
// suivie. Chaque « on ne sait pas » du prompt cede donc a ce bloc ; seul un
// tarif valide par le moteur le bat s il le contredit.
const BLOC_APPRIS = "CE QUE L'ÉQUIPE M'A APPRIS";
const CONSIGNE_APPRIS = 'Des faits VRAIS sur ce centre, donnés par son équipe : sers-t en pour répondre, chiffres compris, avec tes mots et une orthographe propre. '
  + 'Ils comblent ce que le système ne sait pas : ils priment sur tout « aucun prix », « non renseigné » ou « confirme par retour » écrit ailleurs dans ce prompt. '
  + 'Seul un tarif validé par le moteur de réservation les bat, s il les contredit. '
  + 'La question posée dit d où vient le fait ; la réponse de l équipe dit ce qui est vrai. '
  + 'Chaque fait a un identifiant [F…] : mets dans faitsUtilises ceux dont ta réponse se sert.';
const FAITS_BUDGET = 24000;
let tableFaitsPrete = false;
const tablesFaitsDesDoubles = new WeakSet();

function cleDuFait(question) {
  return String(question || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function assurerTableFaits(deps) {
  if (deps.reel ? tableFaitsPrete : tablesFaitsDesDoubles.has(deps)) return;
  await deps.query(`/* agent_facts:schema */
    create table if not exists agent_facts (
      id bigserial primary key,
      center_id text not null,
      cle text not null,
      question text not null,
      reponse text not null,
      par text not null default '',
      source_communication_id bigint,
      resolues integer not null default 0,
      versions jsonb not null default '[]'::jsonb,
      oublie_le timestamptz,
      oublie_par text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index if not exists agent_facts_centre_cle on agent_facts (center_id, cle);
    create index if not exists agent_facts_centre_actifs on agent_facts (center_id, updated_at desc) where oublie_le is null;`);
  if (deps.reel) tableFaitsPrete = true; else tablesFaitsDesDoubles.add(deps);
}

// L ancien stockage, lu tel quel : pour l import, et en repli.
async function lireFaitsDuJson(centerId, deps) {
  try {
    const result = await deps.query(
      'select settings from center_automation_settings where center_id = $1 limit 1;',
      [centerId],
    );
    const brain = (result.rows?.[0]?.settings || {}).email_brain || {};
    return Array.isArray(brain.appris) ? brain.appris : [];
  } catch (error) {
    return [];
  }
}

// UNE FOIS PAR CENTRE : les faits de l ancien JSON entrent dans la table, a
// leur date. Un centre qui a deja une ligne (meme oubliee) n est plus importe :
// un fait oublie ne revient jamais par l import.
async function importerFaitsDuJson(centerId, deps) {
  const deja = await deps.query('/* agent_facts:existe */ select 1 from agent_facts where center_id = $1 limit 1;', [centerId]);
  if (deja.rows && deja.rows.length) return 0;
  let importes = 0;
  for (const f of await lireFaitsDuJson(centerId, deps)) {
    const q = String((f && f.question) || '').trim().slice(0, APPRIS_LIMITS.question);
    const r = String((f && f.reponse) || '').trim().slice(0, APPRIS_LIMITS.reponse);
    if (!q || !r) continue;
    const le = f && f.le && Number.isFinite(Date.parse(f.le)) ? new Date(f.le).toISOString() : null;
    const res = await deps.query(
      `/* agent_facts:importer */ insert into agent_facts (center_id, cle, question, reponse, par, created_at, updated_at)
       values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()), coalesce($6::timestamptz, now()))
       on conflict (center_id, cle) do nothing;`,
      [centerId, cleDuFait(q), q, r, String((f && f.par) || '').slice(0, 60), le],
    );
    importes += Number(res.rowCount) || 0;
  }
  return importes;
}

function ligneFait(row) {
  return {
    id: Number(row.id),
    question: String(row.question || ''),
    reponse: String(row.reponse || ''),
    par: String(row.par || ''),
    le: row.created_at ? new Date(row.created_at).toISOString() : '',
    modifie: row.updated_at ? new Date(row.updated_at).toISOString() : '',
    resolues: Number(row.resolues) || 0,
    versions: Number(row.versions) || 0,
  };
}

// La memoire ACTIVE d un centre, la plus recente d abord.
async function getFaitsAppris(centerId = 'libramont', deps = defaultDeps()) {
  try {
    await assurerTableFaits(deps);
    await importerFaitsDuJson(centerId, deps);
    const result = await deps.query(
      `/* agent_facts:actifs */ select id, question, reponse, par, resolues, jsonb_array_length(versions) as versions, created_at, updated_at
       from agent_facts where center_id = $1 and oublie_le is null
       order by updated_at desc, id desc;`,
      [centerId],
    );
    return (result.rows || []).map(ligneFait);
  } catch (error) {
    return (await lireFaitsDuJson(centerId, deps))
      .filter((f) => f && String(f.question || '').trim() && String(f.reponse || '').trim());
  }
}

function valider(question, reponse) {
  const q = String(question || '').trim().replace(/\s+/g, ' ');
  const r = String(reponse || '').trim();
  if (!q) { const e = new Error('La question est vide.'); e.expose = true; throw e; }
  if (q.length > APPRIS_LIMITS.question) { const e = new Error(`Question trop longue (${APPRIS_LIMITS.question} caractères max).`); e.expose = true; throw e; }
  if (!r) { const e = new Error('La réponse est vide : c’est elle que l’agent va retenir.'); e.expose = true; throw e; }
  if (r.length > APPRIS_LIMITS.reponse) { const e = new Error(`Réponse trop longue (${APPRIS_LIMITS.reponse} caractères max).`); e.expose = true; throw e; }
  return { q, r };
}

// APPRENDRE : une ligne neuve, ou la meme question reposee qui remplace sa
// reponse (l ancienne part dans `versions`, et un fait oublie revient).
async function apprendreUnFait(centerId, { question = '', reponse = '', par = '', communicationId = null } = {}, deps = defaultDeps()) {
  const { q, r } = valider(question, reponse);
  await assurerTableFaits(deps);
  await importerFaitsDuJson(centerId, deps);
  const source = Number.isInteger(Number(communicationId)) && Number(communicationId) > 0 ? Number(communicationId) : null;
  const result = await deps.query(
    `/* agent_facts:apprendre */ insert into agent_facts (center_id, cle, question, reponse, par, source_communication_id)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (center_id, cle) do update set
       versions = case when agent_facts.reponse is distinct from excluded.reponse
         then agent_facts.versions || jsonb_build_array(jsonb_build_object('reponse', agent_facts.reponse, 'par', agent_facts.par, 'le', agent_facts.updated_at))
         else agent_facts.versions end,
       question = excluded.question,
       reponse = excluded.reponse,
       par = excluded.par,
       source_communication_id = coalesce(excluded.source_communication_id, agent_facts.source_communication_id),
       oublie_le = null,
       oublie_par = '',
       updated_at = now()
     returning id, question, reponse, par, resolues, jsonb_array_length(versions) as versions, created_at, updated_at;`,
    [centerId, cleDuFait(q), q, r, String(par || '').slice(0, 60), source],
  );
  return result.rows && result.rows[0] ? ligneFait(result.rows[0]) : null;
}

// CORRIGER un fait : sa reponse change, l ancienne reste dans `versions`.
async function modifierUnFait(centerId, { id, reponse = '', par = '' } = {}, deps = defaultDeps()) {
  const cible = Number(id);
  if (!Number.isInteger(cible) || cible <= 0) { const e = new Error('Quel fait faut-il corriger ?'); e.expose = true; throw e; }
  const r = String(reponse || '').trim();
  valider('x', r);
  await assurerTableFaits(deps);
  const result = await deps.query(
    `/* agent_facts:modifier */ update agent_facts set
       versions = case when reponse is distinct from $3
         then versions || jsonb_build_array(jsonb_build_object('reponse', reponse, 'par', par, 'le', updated_at))
         else versions end,
       reponse = $3, par = $4, updated_at = now()
     where center_id = $1 and id = $2 and oublie_le is null
     returning id, question, reponse, par, resolues, jsonb_array_length(versions) as versions, created_at, updated_at;`,
    [centerId, cible, r, String(par || '').slice(0, 60)],
  );
  return result.rows && result.rows[0] ? ligneFait(result.rows[0]) : null;
}

// OUBLIER : le fait sort de la memoire active, la ligne reste (qui, quand).
// Par son id, ou par sa question (les appels d avant la table).
async function oublierUnFait(centerId, { id = null, question = '', par = '' } = {}, deps = defaultDeps()) {
  await assurerTableFaits(deps);
  await importerFaitsDuJson(centerId, deps);
  const parId = Number.isInteger(Number(id)) && Number(id) > 0;
  const result = await deps.query(
    `/* agent_facts:oublier */ update agent_facts set oublie_le = now(), oublie_par = $3
     where center_id = $1 and oublie_le is null and ${parId ? 'id = $2' : 'cle = $2'};`,
    [centerId, parId ? Number(id) : cleDuFait(question), String(par || '').slice(0, 60)],
  );
  return Number(result.rowCount) || 0;
}

// Combien de questions de clients un fait a resolues.
async function compterResolutions(centerId, id, n, deps = defaultDeps()) {
  const cible = Number(id);
  const combien = Math.max(0, Math.round(Number(n) || 0));
  if (!Number.isInteger(cible) || cible <= 0 || !combien) return;
  await assurerTableFaits(deps);
  await deps.query('/* agent_facts:resolues */ update agent_facts set resolues = resolues + $3 where center_id = $1 and id = $2;', [centerId, cible, combien]);
}

// LES MOTS QUI PORTENT LE SENS d un texte : minuscules, sans accents, sans les
// petits mots du francais. Sert a choisir les faits d un mail, et les
// questions qu un fait peut resoudre.
const MOTS_VIDES = new Set('les des une un le la de du et ou en au aux a est sont pour par pas sur dans avec sans que qui quoi quel quelle quels quelles est-ce ce cet cette ces se sa son ses leur leurs vous nous il elle ils elles on je tu mon ma mes ton ta tes votre vos notre nos y ne plus peut peuvent faut fait faire etre avoir bien tres aussi comme mais donc car si oui non bonjour merci'.split(' '));
// Chaque mot est ramene a sa racine (le s ou le x du pluriel retire, cinq
// lettres au plus) : « tarifs » et « tarif », « arcades » et « arcade »,
// « cartes » et « carte » se reconnaissent. Retirer « es » separait ces deux
// derniers (« cart » contre « carte »).
function racine(mot) { const r = mot.replace(/[sx]$/, ''); return r.length > 5 ? r.slice(0, 5) : r; }
function motsCles(texte) {
  return new Set(String(texte || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter((m) => m.length > 2 && !MOTS_VIDES.has(m)).map(racine));
}
function communs(a, b) { let n = 0; a.forEach((m) => { if (b.has(m)) n += 1; }); return n; }

// LES FAITS QUI ENTRENT DANS LE PROMPT : tous tant qu ils tiennent dans le
// budget ; au-dela, les plus proches du mail traite, puis les plus recents,
// dans l ordre de la memoire.
function choisirFaits(faits = [], texte = '', budget = FAITS_BUDGET) {
  const taille = (f) => String((f && f.question) || '').length + String((f && f.reponse) || '').length + 12;
  if (faits.reduce((s, f) => s + taille(f), 0) <= budget) return faits;
  const mots = motsCles(texte);
  const notes = faits.map((f, i) => ({ f, i, score: communs(mots, motsCles(`${f.question} ${f.reponse}`)) }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const choisis = [];
  let place = budget;
  notes.forEach((n) => { const t = taille(n.f); if (t <= place) { choisis.push(n); place -= t; } });
  return choisis.sort((a, b) => a.i - b.i).map((n) => n.f);
}

// LES QUESTIONS QU UN FAIT PEUT RESOUDRE : celles qui partagent au moins deux
// racines avec lui, les plus proches d abord. Ce n est qu un tri des
// candidates : c est l agent, en relisant chaque mail avec ce fait, qui dit si
// la question est resolue.
function questionsProches(fait, questions = [], max = 3) {
  const motsFait = motsCles(`${(fait && fait.question) || ''} ${(fait && fait.reponse) || ''}`);
  return questions
    .map((q, i) => { const m = motsCles(q.question); const n = communs(m, motsFait); return { q, i, n, part: m.size ? n / m.size : 0 }; })
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n || b.part - a.part || a.i - b.i)
    .slice(0, Math.max(0, max))
    .map((x) => x.q);
}

// LES LECONS DU PROMPT : parmi les plus recentes, celles qui partagent le plus
// de mots avec le mail traite ; a egalite, les plus recentes. Rendues dans
// l ordre de la memoire (la plus recente d abord). Sans texte, les plus
// recentes, comme avant.
function choisirLecons(lecons = [], texte = '', n = LECONS_DANS_LE_PROMPT) {
  const mots = motsCles(texte);
  return lecons
    .map((l, i) => ({ l, i, score: mots.size ? communs(mots, motsCles(`${l.question_excerpt || ''} ${l.learned_reply || ''}`)) : 0 }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, Math.max(0, n))
    .sort((a, b) => a.i - b.i)
    .map((x) => x.l);
}

// Chaque fait porte son identifiant ([F12]) quand il en a un : la reponse dit
// ceux dont elle se sert (faitsUtilises), et c est ce qui prouve qu un fait a
// servi. La question de l agent vient avec sa premisse (« le tarif n existe
// pas dans le systeme... ») : elle est nommee pour ce qu elle est.
function renderFaitsAppris(appris = []) {
  return appris
    .map((f) => `${f && Number(f.id) > 0 ? `[F${Number(f.id)}] ` : ''}Question posée : ${String(f && f.question || '').slice(0, APPRIS_LIMITS.question)}\nRéponse de l équipe : ${String(f && f.reponse || '').slice(0, APPRIS_LIMITS.reponse)}`)
    .join('\n\n');
}

// Les faits appris que la reponse dit utiliser, gardes seulement s ils sont
// dans CE cerveau : un identifiant invente ne compte pas.
function idsFaitsUtilises(liste, appris = []) {
  const connus = new Set((appris || []).filter((f) => Number(f && f.id) > 0).map((f) => `F${Number(f.id)}`));
  const propres = (Array.isArray(liste) ? liste : []).map((x) => String(x || '').trim().toUpperCase().replace(/^\[|\]$/g, ''));
  return [...new Set(propres.filter((x) => connus.has(x)))];
}

// UNE QUESTION N EST RESOLUE PAR UN FAIT QUE SI LA REPONSE S EN SERT
// (2026-09-25). La relecture marquait resolue toute question que l agent ne
// reposait plus : un mail sur la plaine de jeux est passe « resolu » par le
// fait des arcades, avec une reponse generique qui ne s en servait pas.
function resoluParLeFait(analyse, factId) {
  return Boolean(analyse) && !String(analyse.question || '').trim()
    && Array.isArray(analyse.faitsUtilises) && analyse.faitsUtilises.includes(`F${Number(factId)}`);
}

function renderFaqSections(faq = {}) {
  return Object.entries(faq)
    .map(([intent, section]) => `## intent:${intent}\nObjet : ${section.subject || ''}\n${section.body || ''}`)
    .join('\n\n');
}



// ── LES PERIODES SPECIALES, DITES AU CLIENT ──────────────────────────────
// « Non valable durant les vacances scolaires et jours feries » est le texte
// des conditions, ecrit par le centre. Le MOTEUR, lui, ne bloque pas les
// grandes vacances. L agent citait le texte et refusait une vente que le
// tunnel accepte : ce bloc PRIME sur la phrase, et donne les dates.
function periodeDite(periode, moisFr) {
  const dit = (iso) => `${Number(iso.slice(8, 10))} ${moisFr[Number(iso.slice(5, 7))] || iso.slice(5, 7)}`;
  const anneeDebut = periode.debut.slice(0, 4);
  const anneeFin = periode.fin.slice(0, 4);
  if (periode.debut === periode.fin) return `${periode.libelle} le ${dit(periode.debut)} ${anneeDebut}`;
  if (anneeDebut === anneeFin && periode.debut.slice(5, 7) === periode.fin.slice(5, 7)) {
    return `${periode.libelle} du ${Number(periode.debut.slice(8, 10))} au ${dit(periode.fin)} ${anneeFin}`;
  }
  if (anneeDebut === anneeFin) return `${periode.libelle} du ${dit(periode.debut)} au ${dit(periode.fin)} ${anneeFin}`;
  return `${periode.libelle} du ${dit(periode.debut)} ${anneeDebut} au ${dit(periode.fin)} ${anneeFin}`;
}

function periodesDuCentre(centerId, aujourdhui = '', declareUnHoraireDeVacances = false) {
  let lu = null;
  let moisFr = [];
  try {
    const faits = require('./center-facts');
    const { getCenter } = require('./ops-knowledge');
    moisFr = faits.MOIS_FR || [];
    lu = faits.periodesSpeciales(getCenter(centerId), aujourdhui);
  } catch (error) {
    return '';
  }
  if (!lu || !Array.isArray(lu.periodes)) return '';
  const bloquees = lu.periodes.filter((p) => p.bloqueLesFormules);
  const ouvertes = lu.periodes.filter((p) => !p.bloqueLesFormules);
  const lignes = [];
  if (bloquees.length) {
    lignes.push(`Formules marquees « non valable vacances et jours feries » : REFUSEES par le moteur sur ces periodes, et sur elles seules. ${bloquees.map((p) => periodeDite(p, moisFr)).join(' · ')}.`);
  }
  if (ouvertes.length) {
    lignes.push(`ET DISPONIBLES sur ces periodes-la, malgre le mot « vacances » de leurs conditions : ${ouvertes.map((p) => periodeDite(p, moisFr)).join(' · ')}.`);
  }
  // LA MEME LISTE SERT DEUX FOIS, et ce n est pas une approximation : le
  // predicat qui decide quel horaire s applique (isHolidayScheduleDate) est
  // celui sur lequel ces periodes sont construites. Mesure sur 365 jours :
  // 110 jours en horaire de vacances, zero ecart.
  //
  // SANS LA LIGNE « Conges scolaires » dans les faits du centre, la phrase
  // pointerait vers rien : elle ne s ecrit pas.
  if (lignes.length && declareUnHoraireDeVacances) {
    lignes.splice(bloquees.length ? 1 : 0, 0, 'Ces memes periodes sont celles ou l horaire « Conges scolaires » s applique, a la place des horaires habituels : pour une date qui y tombe, c est cet horaire-la qui vaut.');
  }
  if (!lignes.length) return '';
  if (lu.finDuCalendrier) {
    const fin = lu.finDuCalendrier;
    const finDite = `${Number(fin.slice(8, 10))} ${moisFr[Number(fin.slice(5, 7))] || fin.slice(5, 7)} ${fin.slice(0, 4)}`;
    lignes.push(`Au-dela du ${finDite}, le calendrier scolaire n est pas connu : ne dis rien des vacances a une date posterieure, propose de la confirmer par retour.`);
  }
  return lignes.join('\n');
}


// ── COMBIEN DE TEMPS DURE UNE FORMULE ? ──────────────────────────────────
// Ce que le TUNNEL planifie, pas ce que les lignes de la formule estiment.
// Le patch 71 lisait getFormuleTotalDuration en la croyant « celle qui
// decide » : elle ne decide que de l heure limite d arrivee. La visite, le
// moteur des formules la compose activite par activite, et il la planifie
// autrement. Mesure du 2026-09-10 sur Libramont : FORMULE 2 dure 2 h 20 dans
// le tunnel quand ses lignes disent 3 h, FORMULE 5 1 h 45 contre 2 h 30,
// FORMULE 7 2 h 13 contre 3 h. La duree vient donc des plans que le tunnel
// propose (prixReservables, champ duree), et elle se dit a cinq minutes
// pres : c est une duree d apres-midi, pas un horaire de train.
function dureeDite(heures) {
  const total = Math.round(Number(heures) * 60);
  if (!Number.isFinite(total) || total <= 0) return '';
  const h = Math.floor(total / 60);
  const min = total % 60;
  if (!h) return `${min} min`;
  return min ? `${h} h ${String(min).padStart(2, '0')}` : `${h} h`;
}

// UNE FENETRE OUVERTE N A PAS DE DUREE, elle a une REGLE. Pour MATIN MALIN et
// KIDS FUN DAY la visite dure jusqu a la fin de la periode, quelle que soit
// l heure d arrivee, et l arrivee se choisit jusqu a une demi-heure avant la
// fin : les plans du tunnel vont de 30 min a 5 h selon l heure, et c est ce
// que dit cette phrase. La plage elle-meme est deja sur la ligne.
const FENETRE_OUVERTE = 'fenetre ouverte : on arrive quand on veut dans cette plage, jusqu a une demi-heure avant la fin, et on reste jusqu a la fin';

function tempsDuTunnel(prix, document) {
  if (String((document && document.orderPolicy) || '') === 'open_window') return FENETRE_OUVERTE;
  const duree = prix && prix.duree;
  if (!duree) return '';
  const aCinqMinutes = (minutes) => (Math.round(Number(minutes) / 5) * 5) / 60;
  const courte = dureeDite(aCinqMinutes(duree.min));
  const longue = dureeDite(aCinqMinutes(duree.max));
  if (!courte || !longue) return '';
  return courte === longue
    ? `dure environ ${courte}`
    : `dure de ${courte} a ${longue} selon l heure d arrivee`;
}
// ── UNE FORMULE EST-ELLE CONFIRMEE TOUT DE SUITE ? ───────────────────────
// La question a une reponse dans le produit : planningDecisionFor, la fonction
// que le tunnel utilise pour decider si une demande part en validation. On la
// lui pose deux fois, arene laser libre puis arene laser prise, et on lit ce
// qu elle rend. Recopier la regle ici en ferait une seconde, qui divergerait.
//
// SEULES LES EXCEPTIONS S ECRIVENT : annoncer « confirmation immediate » sur
// onze lignes de tarif sur quatorze serait du bruit, et le bruit se lit moins
// bien que le silence.
const ARENE_LIBRE = { conflicts: [], laserSharing: null, resourceBlocks: [] };
const ARENE_PRISE = { conflicts: [], laserSharing: { sharedNow: true }, resourceBlocks: [] };

// LE MODE SE LIT LA OU LE MOTEUR LE LIT. Le catalogue EFFECTIF (celui des
// prix et des contenus) ne porte PAS humanValidation, il est filtre en amont.
// Le document du produit, lui, le porte, et c est exactement l objet que
// ops-engine consulte pour decider. Lire ailleurs inventerait une seconde
// verite pour une seule formule.
function confirmationDeLaFormule(formuleId) {
  let document = null;
  try { document = require('./ops-knowledge').getFormula(String(formuleId || '')); } catch (error) { return ''; }
  const mode = String((document && document.humanValidation) || '').trim();
  if (!mode) return '';
  let decide = null;
  try { decide = require('./validation-policy').planningDecisionFor; } catch (error) { return ''; }
  if (typeof decide !== 'function') return '';
  let libre = false;
  let prise = false;
  try {
    libre = Boolean(decide({ ok: true, validationMode: mode, recommended: ARENE_LIBRE }).requiresHumanReview);
    prise = Boolean(decide({ ok: true, validationMode: mode, recommended: ARENE_PRISE }).requiresHumanReview);
  } catch (error) {
    return '';
  }
  if (libre && prise) return 'l equipe valide cette formule avant de la confirmer : elle n est JAMAIS confirmee immediatement';
  if (prise) return 'confirmee immediatement SAUF si l arene laser est deja prise sur le creneau, auquel cas l equipe valide d abord';
  return '';
}
// ── UN CENTRE QUI NE PREND PAS DE RESERVATION N EN PROMET PAS ─────────────
// Le paragraphe qui invite a reserver en ligne disparait, et le refus du
// moteur prend SA PLACE, au meme endroit du texte : mis a la fin il se lirait
// comme une precision apres l invitation, mis au debut il repondrait avant
// meme la formule de politesse.
//
// AU PARAGRAPHE, PAS A LA PHRASE : ces textes sont ecrits en paragraphes, et
// une coupe a la phrase laisse des morceaux qui ne s enchainent plus.
//
// RIEN N EST AJOUTE QUAND RIEN N A ETE RETIRE : un texte qui ne promettait pas
// la reservation en ligne n a pas menti, et une reclamation n a pas besoin
// qu on lui parle du tunnel.
const INVITE_A_RESERVER_EN_LIGNE = /en ligne|page de r[eé]servation/i;

function sansPromesseEnLigne(corps = '', refus = '') {
  const texte = String(corps || '');
  if (!refus || !texte) return texte;
  const fin = texte.includes('\r\n') ? '\r\n' : '\n';
  const paragraphes = texte.split(/\r?\n\s*\r?\n/);
  const premierFautif = paragraphes.findIndex((p) => INVITE_A_RESERVER_EN_LIGNE.test(p));
  if (premierFautif === -1) return texte;
  const gardes = [];
  paragraphes.forEach((paragraphe, index) => {
    if (index === premierFautif) { gardes.push(String(refus)); return; }
    if (INVITE_A_RESERVER_EN_LIGNE.test(paragraphe)) return;
    gardes.push(paragraphe);
  });
  return gardes.join(`${fin}${fin}`);
}
// Le brain complet : bloc STABLE (règles + voix + FAQ fusionnée, change
// seulement quand le gérant édite → prompt caching Anthropic par centre) +
// bloc CONTEXTE (faits centre + leçons apprises, hors du préfixe caché).
async function buildEmailBrain(centerId = 'libramont', deps = defaultDeps(), instant = Date.now(), options = {}) {
  // LA CONFIGURATION D ABORD. getCenter rend le socle du DEPOT tant que
  // personne n a rafraichi dans ce processus : les horaires annonces au client
  // etaient donc ceux du fichier, pas ceux que le staff a poses en base. Meme
  // correctif que sur l autre porte de l agent (patch 33), et il doit passer
  // AVANT buildCenterFacts, qui lit la grille.
  try {
    const { refreshCenterOverrides } = require('./ops-knowledge');
    await refreshCenterOverrides(deps, { force: true });
  } catch (error) {
    // Socle du depot : mieux qu une exception sur le chemin d une reponse.
  }
  const centerName = centerNameOf(centerId);
  const rules = fillCentre(readBrainFile('rules.md'), centerName);
  const voice = readVoiceFile();
  // UNE SEULE HORLOGE. Les trois blocs qui datent quelque chose calculaient
  // chacun leur « aujourd hui » : deux appels qui se croisent a minuit
  // pouvaient parler de deux jours differents dans le meme message.
  //
  // Et c est le jour DU CENTRE, pas celui d UTC : a 23 h 30 UTC on est deja
  // demain a Bruxelles.
  const { jourDuCentre } = require('./center-facts');
  // L INSTANT, maintenant par defaut : la production ne le passe jamais. Il
  // existe pour que le cerveau se mesure sur un calendrier CONNU, et non a
  // l heure de la machine qui fait tourner la suite.
  const leJour = jourDuCentre(instant);
  const dateDuJour = leJour ? leJour.date : '';
  const [toutesLesLecons, overrides, tousLesFaits, etat, tarifs] = await Promise.all([
    getAgentLessons(centerId, deps, LECONS_CANDIDATES),
    getEmailBrainOverrides(centerId, deps),
    getFaitsAppris(centerId, deps),
    etatDuCentre(centerId, deps, dateDuJour).catch(() => ''),
    prixDuCentre(centerId, deps, dateDuJour, leJour ? leJour.heure : null).catch(() => ''),
  ]);
  // Sans I/O : la configuration vient d etre rafraichie pour les deux appels
  // ci-dessus, et les grilles du moteur sont des constantes du depot.
  // Tout ce que l equipe a appris, dans la limite du budget : au-dela, les
  // faits les plus proches du mail traite (options.texte).
  const appris = choisirFaits(tousLesFaits, options.texte || '');
  // Les corrections du staff les plus proches du mail, pas seulement les douze
  // dernieres : une correction sur les anniversaires sert a un mail
  // d anniversaire, meme si dix mails de prix sont passes depuis.
  const lessons = choisirLecons(toutesLesLecons, options.texte || '');
  let aLaCarte = '';
  try { aLaCarte = prixALaCarte(centerId, dateDuJour); } catch (error) { aLaCarte = ''; }
  const faitsDuCentre = buildCenterFacts(centerId);
  const periodes = periodesDuCentre(centerId, dateDuJour, /Cong[ée]s scolaires/.test(faitsDuCentre));

  // CE CENTRE PREND-IL DES RESERVATIONS EN LIGNE ? La question a deja une
  // reponse dans le produit : le tunnel public refuse un centre declare
  // `planned` ou `closed`, avec une phrase precise. On la reprend telle
  // quelle : deux formulations pour un meme refus finiraient par diverger.
  let refusDeReservation = '';
  try {
    refusDeReservation = String(require('./ops-knowledge').publicBookingBlockReason(centerId) || '');
  } catch (error) {
    refusDeReservation = '';
  }

  // FAQ effective : ce que le gérant a écrit gagne sur le fichier. {{centre}}
  // est rempli avec le nom de CE centre, dans le fichier comme dans le texte
  // du gérant.
  const merged = { ...parseFaqSections(readBrainFile('faq.md')), ...overrides.faq };
  const faq = {};
  for (const [intent, entry] of Object.entries(merged)) {
    faq[intent] = {
      subject: fillCentre(entry.subject, centerName),
      body: sansPromesseEnLigne(fillCentre(entry.body, centerName), refusDeReservation),
    };
  }
  const faqRendered = renderFaqSections(faq);
  // La signature effective : celle du gérant, sinon le nom du centre. Elle est
  // TOUJOURS annoncée au modèle : aucune signature n'est laissée à son
  // imagination, et jamais celle d'un autre client.
  const signature = String(overrides.signature || '').trim() || defaultSignature(centerName);

  const stable = [
    'Tu es l\'assistant email du centre de loisirs. Tu analyses un email reçu et tu proposes une réponse prête à envoyer, que le staff valide.',
    'INTERDIT d\'affirmer une disponibilité (« on a de la place », « c\'est libre ») : seul le staff vérifie le planning, propose toujours de confirmer le créneau, sans le garantir.',
    'INTERDIT d\'annoncer un prix, une promotion ou une activité qui ne figure pas dans les faits fournis.',
    'Réponds uniquement en JSON conforme au schéma.',
    // AVANT les regles du gerant et la voix du centre, qui peuvent les
    // preciser mais pas les contredire : ce bloc est la doctrine d ecriture du
    // produit, verifiee par un gate sur les mails reellement composes.
    `\n${consignesPourLAgent()}`,
    rules ? `\n--- RÈGLES ---\n${rules}` : '',
    `\nSignature à utiliser dans chaque réponse : ${signature}`,
    voice ? `\n--- VOIX ---\n${voice}` : '',
    faqRendered ? `\n--- RÉPONSES DE RÉFÉRENCE ---\n${faqRendered}` : '',
    // Dans le bloc STABLE, avec les regles : ce sont des faits durables sur le
    // centre, pas du contexte du jour. Ils changent quand l equipe apprend
    // quelque chose a l agent, c est-a-dire rarement.
    appris.length ? `\n--- ${BLOC_APPRIS} ---\n${CONSIGNE_APPRIS}\n\n${renderFaitsAppris(appris)}` : '',
    overrides.extra ? `\n--- CONSIGNES DU GÉRANT (prioritaires) ---\n${overrides.extra}` : '',
  ].filter(Boolean).join('\n');

  const lessonLines = lessons.map((lesson) => [
    `Question type (${INTENT_LABELS[lesson.intent] || lesson.intent}) : ${String(lesson.question_excerpt || '').slice(0, 200)}`,
    `Réponse validée par le staff : ${String(lesson.learned_reply || '').slice(0, 400)}`,
  ].join('\n'));

  const context = [
    // EN PREMIER, PARCE QUE TOUT LE RESTE S Y ACCROCHE. « Samedi », « demain »,
    // « le 20 » ne veulent rien dire sans ce jour-la, et un modele sans ancre
    // les resout avec sa memoire d entrainement, qui est dans le passe.
    leJour
      ? `--- LE JOUR ---\nNous sommes le ${leJour.enToutesLettres} (${leJour.date}), il est ${leJour.heureDite}, heure de Belgique.\n`
        + 'Toute date que le client evoque (« samedi », « demain », « la semaine prochaine », « le 20 ») se calcule a partir de ce jour, jamais de ta memoire. '
        + 'Si tu cites une date, ecris-la en toutes lettres pour que le staff la verifie d un coup d oeil.'
        // L HEURE NE POINTE VERS LA LIGNE DU JOUR QUE SI ELLE EXISTE : un centre
        // sans tarif publiable n en a pas.
        + (String(tarifs || '').includes('AUJOURD HUI, il est ') ? ' L heure compte pour une demande du JOUR MEME : la ligne AUJOURD HUI des tarifs dit, formule par formule, jusqu a quelle heure on peut encore arriver.' : '')
      : '',
    // JUSTE APRES LE JOUR, AVANT TOUT LE RESTE : ce qui suit decrit un centre
    // qui ne prend pas de reservation, et chaque fait doit se lire avec ca en
    // tete. Le texte est celui que le tunnel renvoie au visiteur, mot pour mot.
    refusDeReservation
      ? `--- CE CENTRE NE PREND PAS DE RESERVATION EN LIGNE ---\n${refusDeReservation}\n`
        + 'Ce n est pas une supposition : le moteur de reservation renvoie exactement cette phrase a qui essaie de reserver. '
        + 'N invite JAMAIS a reserver en ligne, ne donne aucun creneau, ne confirme aucune date et ne promets aucune venue. '
        + 'Dis-le simplement, propose de transmettre la demande au staff, et reste chaleureux.'
      : '',
    `--- FAITS DU CENTRE ---\n${faitsDuCentre}`,
    // DANS LE CONTEXTE, pas dans le bloc stable : cet etat change tous les
    // jours, la ou les regles et la voix changent rarement. Et il est annonce
    // comme PRIMANT sur les horaires habituels : un modele qui lit deux
    // affirmations contraires sans hierarchie tranche au hasard.
    etat ? `\n--- ETAT DU CENTRE (PRIME sur les horaires habituels ci-dessus) ---\n${etat}` : '',
    // DES PRIX, OU UN REFUS, JAMAIS LES DEUX. Les prix sont valides un par un
    // par le moteur de reservation ; sans grille horaire posee il n y en a
    // aucun, et le refus reprend mot pour mot celui qui vivait dans le bloc
    // stable. Un nombre invente par le modele est de toute facon jete par
    // hasUngroundedNumbers, et la reponse n est envoyee que par un humain.
    // DEUX BLOCS POSSIBLES, UN SEUL REFUS. Les formules dependent d une
    // grille horaire posee ; les prix a l unite, non, parce qu une piste
    // coute le meme prix qu on connaisse ou pas les heures d ouverture. Un
    // centre peut donc avoir l un, l autre, les deux, ou rien. Le refus ne
    // reprend la main que quand il n y a RIEN : le poser a cote d une liste
    // de prix ferait trancher le modele au hasard.
    ...(() => {
      const blocs = [
        tarifs ? `\n--- TARIFS DE CE CENTRE (valides par le moteur de reservation) ---\n${tarifs}` : '',
        aLaCarte ? `\n--- PRIX A L UNITE DE CE CENTRE (ce que le tunnel facture hors formule) ---\n${aLaCarte}` : '',
      ].filter(Boolean);
      // LES PERIODES QUALIFIENT LES FORMULES, ET RIEN D AUTRE. Un centre qui
      // n annonce que des prix a l unite (Gembloux, faute de grille horaire)
      // n a aucune formule a qualifier : lui servir « les formules marquees non
      // valable vacances sont refusees » lui inventerait des formules.
      if (blocs.length) {
        return tarifs && periodes
          ? [...blocs, `\n--- PERIODES SPECIALES DE L ANNEE QUI VIENT (PRIME sur le texte des conditions ci-dessus) ---\n${periodes}`]
          : blocs;
      }
      return [`\n--- TARIFS ---\nAucun tarif n est disponible pour ce centre : ne donne jamais un prix de toi-meme ; si l equipe t a appris un prix (bloc « ${BLOC_APPRIS} »), donne celui-la, sinon propose de le confirmer par retour.`];
    })(),
    lessonLines.length ? `\n--- LEÇONS APPRISES (corrections du staff, à imiter) ---\n${lessonLines.join('\n\n')}` : '',
  ].filter(Boolean).join('\n');

  return { stable, context, faq, lessons, overrides, appris, signature, centerName };
}

// Croisement CRM : l'expéditeur est-il un client connu ? (nom, visites,
// dernière venue). Best-effort : jamais bloquant.
async function matchClient(from = '', centerId = 'libramont', deps = defaultDeps(), aujourdhui = '') {
  const email = String(from || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  try {
    const result = await deps.query(
      `select name, phone, email, date::text as date, to_char(start_time, 'HH24:MI') as heure,
              pax, label
       from reservations
       where center_id = $1
         and lower(coalesce(email, '')) = $2
         and status != 'cancelled'
         and ${simulationSqlExclusion()}
       order by date desc
       limit 20;`,
      [centerId, email],
    );
    const rows = result.rows || [];
    if (!rows.length) return null;
    // PASSE ET FUTUR NE SONT PAS LA MEME CHOSE. « order by date desc » rend
    // la reservation la plus RECENTE, qui peut etre a venir : la servir comme
    // « derniere visite » fait ecrire au modele « lors de votre derniere
    // visite du 20 septembre » pour une visite qui n a pas eu lieu.
    //
    // Le jour vient de l horloge du cerveau, pas d un new Date() de plus :
    // deux blocs du meme message doivent classer la meme reservation du meme
    // cote.
    const jour = String(aujourdhui || new Date().toISOString()).slice(0, 10);
    const lignes = rows.map((row) => ({
      date: String(row.date || '').slice(0, 10),
      heure: String(row.heure || '').slice(0, 5),
      pax: Number(row.pax) > 0 ? Number(row.pax) : 0,
      label: String(row.label || '').trim(),
    })).filter((ligne) => ligne.date);
    const passees = lignes.filter((ligne) => ligne.date < jour);
    const aVenir = lignes.filter((ligne) => ligne.date >= jour)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return {
      clientKey: normalizeClientKey({ phone: rows[0].phone, email }),
      clientName: rows[0].name || '',
      visits: passees.length,
      lastVisit: passees.length ? passees[0].date : '',
      reservationsAVenir: aVenir.length,
      prochaineReservation: aVenir.length ? {
        date: aVenir[0].date,
        heure: aVenir[0].heure,
        personnes: aVenir[0].pax,
        intitule: aVenir[0].label,
      } : null,
    };
  } catch (error) {
    return null;
  }
}


// ── LA CONVERSATION EN COURS ───────────────────────────────────────────────
// Les derniers echanges avec CE client, sur CE centre, du plus ancien au plus
// recent. C est ce qui rend « oui parfait, on prend » lisible.
//
// LIMITES ASSUMEES : six messages, 400 caracteres chacun. Une conversation de
// loisirs tient dans six messages ; au-dela, ce qui compte a ete redit. Et un
// mail de deux pages colle dans le prompt coute plus qu il n apprend.
const CONVERSATION_MESSAGES = 6;
const CONVERSATION_CARACTERES = 400;

async function conversationAvecLeClient(from = '', centerId = 'libramont', deps = defaultDeps(), messageEnCours = '') {
  const email = String(from || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return [];
  try {
    const result = await deps.query(
      `select direction, subject, body, status, template_id,
              to_char(created_at, 'YYYY-MM-DD') as jour
       from communications
       where center_id = $1
         and lower(coalesce(recipient, '')) = $2
         and coalesce(channel, '') = 'email'
         and (
           direction = 'inbound'
           -- UN BROUILLON N EST PAS UNE PAROLE DONNEE : seul ce qui est
           -- REELLEMENT parti compte comme « ce que le centre a dit ».
           or (direction = 'outbound' and status in ('sent', 'delivered'))
         )
       order by id desc
       limit 24;`,
      [centerId, email],
    );
    const rows = result.rows || [];
    if (!rows.length) return [];
    const { separerCitation } = require('../assets/email-thread.js');
    const nu = (texte) => String(texte || '').replace(/\s+/g, ' ').trim();
    const enCours = nu(messageEnCours);
    const messages = rows.map((row) => {
      const entrant = String(row.direction || '') === 'inbound';
      // MEME COUPE QU A L INGESTION : le corps stocke porte la citation
      // entiere, donc chaque message contient tous les precedents.
      const brut = entrant ? (separerCitation(row.body).message || row.body || '') : (row.body || '');
      const texte = nu(brut);
      // UNE RELANCE AUTOMATIQUE N EST PAS UNE REPONSE. Les envois composes
      // par un humain dans le studio portent un template studio_* ; tout le
      // reste est parti tout seul (rappel, anniversaire, reactivation). Les
      // confondre ferait lire au modele une conversation la ou il n y a eu
      // qu un mailing.
      const automatique = !entrant && !String(row.template_id || '').startsWith('studio_');
      return {
        jour: String(row.jour || ''),
        qui: entrant ? 'le client' : (automatique ? 'nous (message automatique)' : 'nous'),
        objet: String(row.subject || '').trim().slice(0, 120),
        texte: texte.slice(0, CONVERSATION_CARACTERES),
        complet: texte,
      };
    })
      // LE MESSAGE QU ON EST EN TRAIN DE LIRE N EST PAS UN ANTECEDENT. Il ne
      // l est pas a l ingestion (l analyse precede l ecriture), il l est si
      // on rejoue l analyse sur un message deja range.
      .filter((message) => message.texte && message.complet !== enCours)
      .slice(0, CONVERSATION_MESSAGES)
      .reverse();
    return messages.map(({ complet, ...reste }) => reste);
  } catch (error) {
    return [];
  }
}
// Garde-fou anti-invention : tout nombre de la réponse doit exister dans le
// brain, le mail d'origine ou la fiche client (pattern polishIdeaWithAi).
function hasUngroundedNumbers(text = '', allowedSource = '') {
  const numbers = String(text).match(/\d+(?:[.,]\d+)?/g) || [];
  for (const number of numbers) {
    const canonical = number.replace(',', '.');
    if (!allowedSource.includes(number) && !allowedSource.includes(canonical)) return true;
  }
  return false;
}

function applyPrenom(text = '', clientName = '') {
  const prenom = firstNameOf(clientName);
  return String(text)
    .replace(/\{\{\s*pr[eé]nom\s*\}\}/gi, prenom)
    .replace(/Bonjour\s*,/g, 'Bonjour,');
}


// ── CE MESSAGE VIENT-IL D UN CLIENT ? ────────────────────────────────────
// Quatre familles, et des signaux ETROITS : ce sont des mots qu un client
// n ecrit pas. « facture » seul ne suffit pas, un client en demande une ;
// « notre facture » est la phrase de celui qui l envoie. « emploi » ou
// « recrutement » ne se glissent pas dans une demande d anniversaire.
//
// UN FAUX POSITIF COUTE PLUS CHER QU UN FAUX NEGATIF : un vrai client range
// ici recoit un accuse de reception au lieu d une reponse, et personne ne le
// rappelle. Un demarcheur range dans « autre » ne coute qu un brouillon jete.
// La liste reste donc courte, et le gate prouve les deux sens.
const SIGNAUX_HORS_SUJET = [
  // Candidature : le mot « disponible » d un CV tombait dans « reservation ».
  /candidatur|curriculum vitae|\bcv\b|lettre de motivation|je postule|recrutement|offre d ?emploi|votre equipe recrute/,
  // Demarchage : agences de visibilite, referencement, prospection sortante.
  /referencement naturel|référencement naturel|backlink|netlinking|\bseo\b|notre agence (?:peut|propose|accompagne)|prospection commerciale|augmenter votre visibilite|augmenter votre visibilité/,
  // Fournisseur : celui qui ENVOIE une facture, pas celui qui en demande une.
  /notre facture|bon de commande|rappel de paiement|echeance de paiement|échéance de paiement|facture ci-jointe|veuillez trouver ci-joint notre/,
  // Hameconnage : les phrases qui ne viennent jamais d un client de bowling.
  /compte sera suspendu|verifier votre compte|vérifier votre compte|verify your account|cliquez ici pour|coordonnees bancaires|coordonnées bancaires|identifiants bancaires/,
];

function estHorsSujet(texte = '') {
  return SIGNAUX_HORS_SUJET.some((signal) => signal.test(texte));
}
// Analyse DÉTERMINISTE (mots-clés FR) : le mode qui tourne sans clé IA, et le
// filet de sécurité quand l'IA échoue ou invente.
function analyzeByRules({ subject = '', body = '', faq = {}, client = null, signature = '' }) {
  const haystack = `${subject}\n${body}`.toLowerCase();
  let intent = 'autre';
  // EN PREMIER, ET C EST TOUT L INTERET : « disponible immediatement » d un CV
  // tombait dans « reservation », « facture » dans « prix ». Teste apres, ce
  // sujet n aurait jamais rien attrape.
  if (estHorsSujet(haystack)) intent = 'hors_sujet';
  else if (/annul|report|décal|decal/.test(haystack)) intent = 'annulation';
  else if (/plainte|déçu|decu|mécontent|mecontent|rembours|réclamation|reclamation|problème|probleme|incident|inadmissible/.test(haystack)) intent = 'reclamation';
  else if (/anniv/.test(haystack)) intent = 'anniversaire';
  else if (/prix|tarif|combien|coût|cout|devis/.test(haystack)) intent = 'prix';
  else if (/horaire|ouvert|ouverture|fermé|ferme[zr]?\b|quelle heure/.test(haystack)) intent = 'horaires';
  else if (/réserv|reserv|dispo|créneau|creneau|place pour|venir à|venir a/.test(haystack)) intent = 'reservation';

  const firstSentence = String(body).trim().split(/(?<=[.!?])\s+|\n/)[0] || String(subject).trim();
  const summary = firstSentence.length > 140 ? `${firstSentence.slice(0, 137)}…` : firstSentence;

  // CE QUE L AGENT NE SAIT PAS, IL LE DIT.
  //
  // « Autre » n est pas une categorie, c est un aveu : le message ne rentre dans
  // aucun sujet connu, et la reponse proposee sera forcement une pirouette du
  // genre « appelez-nous ». Mesure du 2026-09-06 sur un vrai mail : « est-ce que
  // je peux amener mon propre gateau ? » a produit exactement ca, parce que
  // personne n a jamais dit a l agent si le centre l autorise.
  //
  // Plutot que de laisser cette pirouette partir en silence, l agent formule la
  // QUESTION qu il aurait fallu lui repondre. Le staff y repond une fois, et il
  // le sait pour tous les messages suivants.
  // ET AUCUNE QUESTION : « autre » demande au staff ce qu il aurait fallu
  // repondre, et cette reponse devient un fait appris de l agent. Un mail de
  // demarchage ou de hameconnage n a rien a apprendre a personne.
  const question = intent === 'autre' ? String(summary || '').trim() : '';
  const fallbackSignature = String(signature || '').trim() || defaultSignature('');
  const template = faq[intent] || faq.autre || { subject: 'Bien reçu, on vous répond vite', body: `Bonjour,\n\nMerci pour votre message, on revient vers vous rapidement.\n\n${fallbackSignature}` };
  return {
    intent,
    intentLabel: INTENT_LABELS[intent],
    summary: summary || 'Message reçu.',
    urgency: ['reclamation', 'annulation'].includes(intent) ? 'haute' : 'normale',
    question,
    reply: {
      subject: applyPrenom(template.subject, client?.clientName || ''),
      body: applyPrenom(template.body, client?.clientName || ''),
    },
    provider: 'rules',
  };
}

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: INTENTS },
    summary: { type: 'string' },
    urgency: { type: 'string', enum: ['haute', 'normale'] },
    // La question que l agent aurait besoin de faire poser au staff. Vide quand
    // il sait repondre : c est le cas courant, et une question inventee a chaque
    // mail rendrait la section d apprentissage illisible.
    question: { type: 'string' },
    // Les identifiants [F…] des faits appris dont la reponse se sert. C est ce
    // qui dit qu un fait a servi, et donc qu une question est resolue par lui.
    faitsUtilises: { type: 'array', items: { type: 'string' } },
    reply: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['subject', 'body'],
    },
  },
  required: ['intent', 'summary', 'urgency', 'question', 'faitsUtilises', 'reply'],
};

// Analyse complète d'un email reçu → { intent, intentLabel, summary, urgency,
// reply{subject, body}, clientKey?, clientName?, provider }.
async function analyzeEmail({
  from = '',
  subject = '',
  body = '',
  centerId = 'libramont',
  deps = defaultDeps(),
  fetchImpl = fetch,
  // Le fait que l equipe vient d apprendre en repondant a la question de CE
  // mail ({ id, question, reponse }) : la relecture le recoit en toutes
  // lettres, avec la consigne de s en servir.
  faitDuMail = null,
} = {}) {
  // LA MEME HORLOGE QUE LE CERVEAU : passe et futur se decident sur le jour
  // du centre, pas sur celui d UTC ni sur un new Date() de plus.
  const jourDeLAnalyse = require('./center-facts').jourDuCentre();
  const client = await matchClient(from, centerId, deps, jourDeLAnalyse ? jourDeLAnalyse.date : '');
  const conversation = await conversationAvecLeClient(from, centerId, deps, body);
  const brain = await buildEmailBrain(centerId, deps, Date.now(), { texte: `${subject}\n${body}` });
  const rulesAnalysis = analyzeByRules({ subject, body, faq: brain.faq, client, signature: brain.signature });
  // Ce que le MODELE voit du client : tout sauf la cle CRM, qui vaut son
  // numero de telephone et ne lui sert a rien.
  const ficheClientPourLeModele = client
    ? (({ clientKey, ...reste }) => reste)(client)
    : 'inconnu';

  let analysis = rulesAnalysis;
  // LE MODELE PEUT AJOUTER CE SUJET, PAS LE RETIRER. Les signaux sont etroits
  // et a haute confiance : un modele qui les contredirait rendrait un
  // argumentaire commercial a un hameconneur. Et on ne paie pas pour ca.
  if (llmProvider() && rulesAnalysis.intent !== 'hors_sujet') {
    const ai = await callLlmJson({
      stableSystem: brain.stable,
      system: brain.context,
      user: JSON.stringify({
        emailRecu: { from, subject, body: String(body).slice(0, 6000) },
        client: ficheClientPourLeModele,
        // SANS CETTE LEGENDE, `visits` et `lastVisit` se lisent de travers : ce
        // sont des visites DEJA EUES, et prochaineReservation est une
        // reservation DEJA POSEE, qu il ne faut ni reproposer ni modifier.
        legendeClient: client ? {
          visits: 'nombre de visites DEJA EUES, les reservations a venir n y sont pas comptees',
          lastVisit: 'date de la derniere visite PASSEE, vide si le client n est encore jamais venu',
          prochaineReservation: 'reservation DEJA POSEE et a venir : rappelle-la si c est utile, ne la repropose pas, ne la modifie pas toi-meme, et ne promets aucun changement sans le staff',
        } : undefined,
        // SANS CE BLOC, un message de cinq mots se lit tout seul. « Oui
        // parfait, on prend » ne veut rien dire hors de ce qui a ete dit.
        ...(conversation.length ? {
          conversation,
          legendeConversation: 'les echanges DEJA eus avec ce client sur ce centre, du plus ANCIEN au plus RECENT. « le client » = ce qu il a ecrit. « nous » = une reponse REELLEMENT envoyee par quelqu un du centre. « nous (message automatique) » = une relance ou une confirmation partie toute seule, que personne n a ecrite pour lui : elle n engage que ce qu elle dit, et ne prouve pas qu on a discute. Un message court se lit a la lumiere de ces echanges, jamais tout seul. Ce qui n y figure pas n a pas ete promis : ne le confirme pas.',
        } : {}),
        ...(faitDuMail && Number(faitDuMail.id) > 0 ? {
          faitQueLEquipeVientDApprendre: {
            id: `F${Number(faitDuMail.id)}`,
            questionPosee: String(faitDuMail.question || '').slice(0, APPRIS_LIMITS.question),
            reponseDeLEquipe: String(faitDuMail.reponse || '').slice(0, APPRIS_LIMITS.reponse),
            consigne: 'L equipe vient de repondre a la question que CE mail t a fait poser : ta reponse s en sert, avec tes mots, et cite son identifiant dans faitsUtilises.',
          },
        } : {}),
        attendu: `intent (ce que veut le client ; « hors_sujet » si le message ne vient PAS d un client : candidature, fournisseur, demarchage, hameconnage, auquel cas ne propose ni tarif, ni creneau, ni argumentaire, juste un accuse de reception neutre), summary (1 phrase FR), urgency, reply prête à envoyer (vous doux, signature ${brain.signature}), et question : SI et seulement si il te manque un fait sur ce centre pour répondre précisément, écris la question à poser au staff (une phrase, exemple « Le centre autorise-t-il d'apporter sa propre nourriture ? »). Si tu peux répondre avec les faits fournis, question = "". Et faitsUtilises : les identifiants [F…] des faits appris par l équipe dont ta réponse se sert ([] si aucun).`,
      }),
      schema: ANALYSIS_SCHEMA,
      schemaName: 'email_analysis',
      maxTokens: 700,
      timeoutMs: 12000,
      fetchImpl,
    });
    if (ai && INTENTS.includes(ai.intent) && ai.reply && ai.reply.subject && ai.reply.body) {
      // LA MEME VUE que celle envoyee au modele : autoriser un nombre qu il n a
      // jamais recu reviendrait a lui permettre de citer ce qu il a devine.
      // LA CONVERSATION EST UNE SOURCE AUTORISEE, et c est le seul choix
      // tenable : sans elle, un agent a qui le centre vient d ecrire « le 27 a
      // 14 h » ne peut pas repeter « le 27 a 14 h ». Chaque nombre qui s y
      // trouve a ete ecrit soit par le client, soit par un humain du centre
      // qui a valide un envoi. Aucun ne vient du modele.
      const allowed = `${brain.stable}\n${brain.context}\n${subject}\n${body}\n${JSON.stringify(ficheClientPourLeModele)}\n${JSON.stringify(conversation)}\n${faitDuMail ? String(faitDuMail.reponse || '') : ''}`;
      const grounded = !hasUngroundedNumbers(`${ai.reply.subject}\n${ai.reply.body}`, allowed);
      if (grounded) {
        analysis = {
          intent: ai.intent,
          intentLabel: INTENT_LABELS[ai.intent],
          summary: String(ai.summary || rulesAnalysis.summary).slice(0, 200),
          urgency: ai.urgency === 'haute' ? 'haute' : 'normale',
          reply: { subject: String(ai.reply.subject), body: String(ai.reply.body) },
          // La question du modele prime sur celle des regles : il a lu les faits
          // du centre, il sait mieux ce qui lui a manque.
          question: String(ai.question || '').trim().slice(0, 200),
          faitsUtilises: idsFaitsUtilises(ai.faitsUtilises, faitDuMail ? [...brain.appris, faitDuMail] : brain.appris),
          provider: ai._provider || 'anthropic',
        };
      }
    }
  }

  if (client) {
    analysis.clientKey = client.clientKey;
    analysis.clientName = client.clientName;
  }
  analysis.analyzedAt = new Date().toISOString();
  return analysis;
}

// Ingestion d'un email reçu (webhook Resend ou collage manuel) : idempotent,
// stocké dans communications direction='inbound' AVEC son analyse.
async function ingestInboundEmail({
  centerId = 'libramont',
  from = '',
  fromName = '',
  subject = '',
  body = '',
  receivedAt = null,
  to = '',
  routage = '',
  provider = '',
  providerEmailId = '',
  requestId = '',
  // En-tetes RFC 5322 du mail recu (0047) : c est avec eux que la reponse d un
  // client retrouve le fil de NOTRE message. Vides sur un collage manuel.
  messageId = '',
  inReplyTo = '',
  references = '',
  // Reply-To du mail recu (2026-09-17) : l adresse a laquelle l expediteur
  // demande qu on reponde (un formulaire y met souvent le client).
  replyTo = '',
  deps = defaultDeps(),
  fetchImpl = fetch,
} = {}) {
  const { createCommunication } = require('./database');
  const enqueue = deps.enqueue || createCommunication;
  const sender = String(from || '').trim();
  const text = String(body || '').trim();
  if (!sender || !text) {
    const error = new Error('Email entrant invalide : expéditeur et contenu requis.');
    error.expose = true;
    throw error;
  }

  // L'identite du mail survit aux nouvelles livraisons du webhook et a leur
  // horodatage. Le centre ET le fournisseur font partie de son espace de noms.
  const source = String(provider || '').trim().toLowerCase();
  const emailId = String(providerEmailId || '').trim();
  const hasProviderIdentity = Boolean(source && emailId);
  // Sans identite de requete, un collage est une nouvelle ingestion. Si une
  // requete manuelle reutilise son ID avec un AUTRE contenu, la cle change :
  // l'upsert de communications ne doit jamais ecraser le premier corps.
  const manualRequestId = hasProviderIdentity ? '' : (String(requestId || '').trim() || randomUUID());
  const identity = hasProviderIdentity
    ? [centerId, 'provider', source, emailId]
    : [centerId, 'manual', manualRequestId, sender.toLowerCase(), String(subject || '').trim(), text];
  const idempotencyKey = `inbound:v2:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;

  try {
    const existing = await deps.query(
      `select id from communications
       where center_id = $1 and direction = 'inbound' and idempotency_key = $2
       limit 1;`,
      [centerId, idempotencyKey],
    );
    if (existing.rows.length) {
      return { communication: { id: existing.rows[0].id }, analysis: null, deduped: true };
    }
  } catch (error) { /* dédup best-effort : on ingère quand même */ }

  // L AGENT LIT CE QUE LA PERSONNE A ECRIT, PAS CE QUE SON LOGICIEL A RECOPIE.
  // Sur une reponse de deux mots, la citation represente 99 % du texte : sans
  // cette separation, l agent resume la conversation precedente et repond a
  // cote, avec l aplomb de quelqu un qui a tout lu. Le texte COMPLET reste
  // stocke (rien n est perdu, l ecran peut deplier la citation) ; seule
  // l analyse porte sur le message.
  const { separerCitation } = require('../assets/email-thread.js');
  const messageSeul = separerCitation(text).message || text;
  const analysis = await analyzeEmail({ from: sender, subject, body: messageSeul, centerId, deps, fetchImpl });
  // LE VRAI CLIENT (2026-09-17, lib/email-contact.js). Un mail du formulaire
  // du site a pour expediteur une adresse du centre ; le client est ecrit dans
  // le mail. La conversation, la reponse et l historique portent SON adresse ;
  // l expediteur technique reste dans payload.from et payload.relais.
  let adressePubliqueDuCentre = '';
  try {
    adressePubliqueDuCentre = String((getCenter(centerId).publicInfo || {}).email || '');
  } catch (error) {
    adressePubliqueDuCentre = '';
  }
  const contact = adresseDuClient({ from: sender, fromName, replyTo, text, to, centerEmail: adressePubliqueDuCentre });
  const relaye = contact.source !== 'expediteur' && Boolean(contact.email);
  // Le nom d affichage d un relais est celui du site, jamais celui du client.
  if (fromName && !analysis.clientName && !relaye) analysis.clientName = fromName;
  const contactName = relaye ? String(contact.name || analysis.clientName || '').trim() : String(fromName || '').trim();

  const communication = await enqueue({
    centerId,
    reservationId: null,
    channel: 'email',
    direction: 'inbound',
    templateId: 'inbound_email',
    recipient: relaye ? contact.email : sender,
    subject: String(subject || '').trim(),
    body: text,
    status: 'received',
    scheduledAt: null,
    idempotencyKey,
    // Colonnes 0047 ET payload : les colonnes servent a retrouver le fil par
    // index, le payload reste lisible tel quel par l ecran.
    messageId: String(messageId || '').trim(),
    inReplyTo: String(inReplyTo || '').trim(),
    references: String(references || '').trim(),
    payload: {
      textBody: text,
      inbound: true,
      from: sender,
      fromName: fromName || '',
      replyTo: String(Array.isArray(replyTo) ? replyTo.join(', ') : (replyTo || '')).slice(0, 300),
      ...(relaye ? { clientEmail: contact.email, contactName, contactSource: contact.source, relais: contact.relais } : {}),
      messageId: String(messageId || '').trim(),
      inReplyTo: String(inReplyTo || '').trim(),
      references: String(references || '').trim(),
      // L adresse qui a recu le mail et la facon dont le centre a ete decide
      // (destinataire, parametre, defaut). Sans elles, un mail mal classe ne se
      // distingue en rien d un mail bien classe, et personne ne peut le prouver.
      to: String(to || ''),
      routage: String(routage || ''),
      provider: hasProviderIdentity ? source : '',
      providerEmailId: hasProviderIdentity ? emailId : '',
      requestId: manualRequestId,
      receivedAt: receivedAt || new Date().toISOString(),
      analysis,
    },
  });

  return { communication, analysis, deduped: false };
}

// Apprentissage implicite : le staff a modifié la réponse proposée avant envoi
// → la version corrigée devient une leçon (réinjectée dans le brain).
function significantDiff(original = '', sent = '') {
  const a = String(original || '').replace(/\s+/g, ' ').trim();
  const b = String(sent || '').replace(/\s+/g, ' ').trim();
  if (a === b) return false;
  const maxLength = Math.max(a.length, b.length, 1);
  const lengthDelta = Math.abs(a.length - b.length);
  let positionDiffs = 0;
  const minLength = Math.min(a.length, b.length);
  for (let index = 0; index < minLength; index += 1) {
    if (a[index] !== b[index]) positionDiffs += 1;
  }
  return (lengthDelta + positionDiffs) / maxLength > 0.15;
}

async function recordAgentLesson({
  centerId = 'libramont',
  intent = 'autre',
  questionExcerpt = '',
  original = { subject: '', body: '' },
  sent = { subject: '', body: '' },
  deps = defaultDeps(),
} = {}) {
  const subjectChanged = String(original.subject || '').trim() !== String(sent.subject || '').trim();
  const bodyChanged = significantDiff(original.body, sent.body);
  if (!subjectChanged && !bodyChanged) return { recorded: false };

  const learnedReply = [String(sent.subject || '').trim(), String(sent.body || '').trim()]
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000);
  if (!learnedReply) return { recorded: false };

  try {
    await deps.query(
      `insert into email_agent_memory (center_id, intent, question_excerpt, learned_reply)
       values ($1, $2, $3, $4);`,
      [centerId, INTENTS.includes(intent) ? intent : 'autre', String(questionExcerpt || '').slice(0, 300), learnedReply],
    );
    // PLUS DE PURGE (2026-09-24, Movsar : « un gros systeme ou il apprend, ou
    // tout est stocke »). Au-dela de 200, les plus anciennes lecons etaient
    // effacees, sans trace. Elles restent ; c est le prompt qui choisit les
    // plus proches du mail (choisirLecons).
  } catch (error) {
    return { recorded: false };
  }
  return { recorded: true };
}

// Combien de reponses l equipe a corrigees avant de les envoyer, pour ce
// centre : chacune est une lecon que l agent garde. 0 si la table manque.
async function compterLecons(centerId = 'libramont', deps = defaultDeps()) {
  try {
    const result = await deps.query('select count(*)::int as n from email_agent_memory where center_id = $1;', [centerId]);
    return Number(result.rows && result.rows[0] && result.rows[0].n) || 0;
  } catch (error) {
    return 0;
  }
}

module.exports = {
  INTENT_LABELS,
  buildEmailBrain,
  periodesDuCentre,
  tempsDuTunnel,
  ligneDuJour,
  plagesDesHeures,
  buildCenterFacts,
  etatDuCentre,
  prixDuCentre,
  prixALaCarte,
  plagesDeDates,
  parseFaqSections,
  analyzeByRules,
  analyzeEmail,
  ingestInboundEmail,
  recordAgentLesson,
  getAgentLessons,
  compterLecons,
  choisirFaits,
  getEmailBrainOverrides,
  getEmailBrainDefaults,
  saveEmailBrainOverrides,
  getFaitsAppris,
  apprendreUnFait,
  modifierUnFait,
  oublierUnFait,
  compterResolutions,
  questionsProches,
  resoluParLeFait,
  APPRIS_LIMITS,
  __test: { hasUngroundedNumbers, significantDiff, matchClient, renderFaitsAppris, choisirFaits, choisirLecons, motsCles, idsFaitsUtilises, FAITS_BUDGET, LECONS_DANS_LE_PROMPT, BLOC_APPRIS },
};
