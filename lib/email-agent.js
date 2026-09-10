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
const { getCenter } = require('./ops-knowledge');
const { callLlmJson, llmProvider } = require('./llm-client');
const { normalizeClientKey } = require('./ops-communications');
const { simulationSqlExclusion } = require('./simulation-filter');

const EMAIL_BRAIN_DIR = path.join(__dirname, '..', 'ops-knowledge', 'email-brain');

const INTENT_LABELS = {
  reservation: 'Réservation',
  annulation: 'Annulation / report',
  anniversaire: 'Anniversaire',
  prix: 'Prix & tarifs',
  horaires: 'Horaires',
  reclamation: 'Réclamation',
  autre: 'Autre',
};
const INTENTS = Object.keys(INTENT_LABELS);
const MEMORY_CAP_PER_CENTER = 200;

function defaultDeps() {
  const { getPool } = require('./database');
  return { query: (text, params) => getPool().query(text, params) };
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
      + 'Ne les chiffre jamais, propose de confirmer par retour.');
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
async function prixDuCentre(centerId = 'libramont', deps = defaultDeps(), aujourdhui = '') {
  const { agendaDuCentre, prixReservables, formuleAvecSesRessources } = require('./center-facts');
  const { loadAvailabilityBlocks } = require('./availability-blocks');
  const { joursSansPisteDisponible } = require('./database');
  const { getEffectiveFormules, refreshFormuleOverrides } = require('./booking-config');
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
  try {
    catalogue = getEffectiveFormules(centerId).map(formuleAvecSesRessources);
    prix = prixReservables(catalogue, centre, agenda, blocs, joursSansPiste);
  } catch (error) { prix = []; }
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
      + `${conditions.length ? ` | conditions : ${conditions.join(' · ')}` : ''}`;
  });
  return [
    `Tarifs releves le ${jour} pour CE centre, sur les ${agenda.length} prochains jours. `
    + 'Tu peux les citer tels quels, AVEC leur condition. Tu ne calcules JAMAIS un '
    + 'total pour un groupe et tu n additionnes rien : seul le tunnel de reservation '
    + 'fait un total. Un tarif absent de cette liste n existe pas : propose de le '
    + 'confirmer par retour au lieu de l inventer. Ce qu une formule COMPREND est '
    + 'la liste du site : cite-la telle quelle, n y ajoute aucune activite et n en '
    + 'retire aucune.',
    ...lignes,
  ].join('\n');
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
    lines.push('Coordonnées : NON RENSEIGNÉES pour ce centre. N invente ni adresse, ni téléphone, ni email, ni parking, et n en emprunte à aucun autre centre : propose au client qu on le rappelle.');
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
    lines.push(`Conditions d'accès : NON RENSEIGNÉES pour ce centre. N annonce jamais un âge minimum, une taille minimum ni une durée de partie, et ne les déduis d aucun autre centre : propose de confirmer par retour.`);
  }
  return lines.join('\n');
}

async function getAgentLessons(centerId = 'libramont', deps = defaultDeps(), limit = 12) {
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

  await deps.query(
    `insert into center_automation_settings (center_id, settings, updated_at)
     values ($1, jsonb_build_object('email_brain', $2::jsonb), now())
     on conflict (center_id)
     do update set settings = center_automation_settings.settings || jsonb_build_object('email_brain', $2::jsonb), updated_at = now();`,
    [centerId, JSON.stringify(next)],
  );
  return next;
}

// CE QUE L EQUIPE A APPRIS A L AGENT.
//
// Range a part de la FAQ : la FAQ est une reponse TYPE par sujet connu (une
// liste fermee, editable ligne a ligne dans la console), ici ce sont des FAITS
// arbitraires que personne n avait prevus, ajoutes au fil des vraies questions
// des clients. Les melanger aurait force soit a ouvrir la liste des sujets (et
// casser le « reinitialiser au modele »), soit a ecraser la meme entree a
// chaque nouvelle question.
//
// Le plafond existe pour que le prompt ne grossisse pas sans fin : au-dela, ce
// sont les faits les plus anciens qui sortent, parce qu un centre qui change
// d avis le dit avec un fait plus recent.
const APPRIS_MAX = 80;
const APPRIS_LIMITS = { question: 200, reponse: 600 };

async function getFaitsAppris(centerId = 'libramont', deps = defaultDeps()) {
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

async function apprendreUnFait(centerId, { question = '', reponse = '', par = '' } = {}, deps = defaultDeps()) {
  const q = String(question || '').trim().slice(0, APPRIS_LIMITS.question);
  const r = String(reponse || '').trim();
  if (!q) { const e = new Error('La question est vide.'); e.expose = true; throw e; }
  if (!r) { const e = new Error('La réponse est vide : c’est elle que l’agent va retenir.'); e.expose = true; throw e; }
  if (r.length > APPRIS_LIMITS.reponse) {
    const e = new Error(`Réponse trop longue (${APPRIS_LIMITS.reponse} caractères max) : l’agent retient mieux une phrase courte.`);
    e.expose = true;
    throw e;
  }
  const actuels = await getFaitsAppris(centerId, deps);
  // Une meme question reposee remplace l ancienne reponse au lieu de s empiler :
  // sinon l agent lirait deux faits contradictoires et choisirait au hasard.
  const cle = q.toLowerCase();
  const sansDoublon = actuels.filter((f) => String(f && f.question || '').toLowerCase() !== cle);
  const suivants = [{ question: q, reponse: r, par: String(par || '').slice(0, 60), le: new Date().toISOString() }]
    .concat(sansDoublon)
    .slice(0, APPRIS_MAX);
  // FUSION A DEUX NIVEAUX, PAS jsonb_set. Mesure du 2026-09-06 : jsonb_set ne
  // cree que le DERNIER element du chemin. Sur un centre dont `settings` n avait
  // pas encore de cle `email_brain`, l ecriture ne faisait rien du tout, sans
  // erreur : la fonction renvoyait la liste a jour, la base restait vide, et
  // l agent n apprenait rien. On fusionne donc explicitement les deux niveaux,
  // en preservant ce que `email_brain` contient deja (faq, signature,
  // consignes).
  await deps.query(
    `insert into center_automation_settings (center_id, settings, updated_at)
     values ($1, jsonb_build_object('email_brain', jsonb_build_object('appris', $2::jsonb)), now())
     on conflict (center_id)
     do update set settings =
       coalesce(center_automation_settings.settings, '{}'::jsonb)
       || jsonb_build_object(
            'email_brain',
            coalesce(center_automation_settings.settings->'email_brain', '{}'::jsonb)
            || jsonb_build_object('appris', $2::jsonb)
          ),
       updated_at = now();`,
    [centerId, JSON.stringify(suivants)],
  );
  return suivants;
}

function renderFaitsAppris(appris = []) {
  return appris
    .map((f) => `Q : ${String(f && f.question || '').slice(0, APPRIS_LIMITS.question)}\nR : ${String(f && f.reponse || '').slice(0, APPRIS_LIMITS.reponse)}`)
    .join('\n\n');
}

function renderFaqSections(faq = {}) {
  return Object.entries(faq)
    .map(([intent, section]) => `## intent:${intent}\nObjet : ${section.subject || ''}\n${section.body || ''}`)
    .join('\n\n');
}

// Le brain complet : bloc STABLE (règles + voix + FAQ fusionnée, change
// seulement quand le gérant édite → prompt caching Anthropic par centre) +
// bloc CONTEXTE (faits centre + leçons apprises, hors du préfixe caché).
async function buildEmailBrain(centerId = 'libramont', deps = defaultDeps()) {
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
  const leJour = jourDuCentre();
  const dateDuJour = leJour ? leJour.date : '';
  const [lessons, overrides, appris, etat, tarifs] = await Promise.all([
    getAgentLessons(centerId, deps),
    getEmailBrainOverrides(centerId, deps),
    getFaitsAppris(centerId, deps),
    etatDuCentre(centerId, deps, dateDuJour).catch(() => ''),
    prixDuCentre(centerId, deps, dateDuJour).catch(() => ''),
  ]);
  // Sans I/O : la configuration vient d etre rafraichie pour les deux appels
  // ci-dessus, et les grilles du moteur sont des constantes du depot.
  let aLaCarte = '';
  try { aLaCarte = prixALaCarte(centerId, dateDuJour); } catch (error) { aLaCarte = ''; }

  // FAQ effective : ce que le gérant a écrit gagne sur le fichier. {{centre}}
  // est rempli avec le nom de CE centre, dans le fichier comme dans le texte
  // du gérant.
  const merged = { ...parseFaqSections(readBrainFile('faq.md')), ...overrides.faq };
  const faq = {};
  for (const [intent, entry] of Object.entries(merged)) {
    faq[intent] = { subject: fillCentre(entry.subject, centerName), body: fillCentre(entry.body, centerName) };
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
    rules ? `\n--- RÈGLES ---\n${rules}` : '',
    `\nSignature à utiliser dans chaque réponse : ${signature}`,
    voice ? `\n--- VOIX ---\n${voice}` : '',
    faqRendered ? `\n--- RÉPONSES DE RÉFÉRENCE ---\n${faqRendered}` : '',
    // Dans le bloc STABLE, avec les regles : ce sont des faits durables sur le
    // centre, pas du contexte du jour. Ils changent quand l equipe apprend
    // quelque chose a l agent, c est-a-dire rarement.
    appris.length ? `\n--- CE QUE L'ÉQUIPE M'A APPRIS (fais-en des faits, ne les recopie pas mot pour mot) ---\n${renderFaitsAppris(appris)}` : '',
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
      ? `--- LE JOUR ---\nNous sommes le ${leJour.enToutesLettres} (${leJour.date}), heure de Belgique.\n`
        + 'Toute date que le client evoque (« samedi », « demain », « la semaine prochaine », « le 20 ») se calcule a partir de ce jour, jamais de ta memoire. '
        + 'Si tu cites une date, ecris-la en toutes lettres pour que le staff la verifie d un coup d oeil.'
      : '',
    `--- FAITS DU CENTRE ---\n${buildCenterFacts(centerId)}`,
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
      if (blocs.length) return blocs;
      return ['\n--- TARIFS ---\nAucun tarif n est disponible pour ce centre : ne donne jamais un prix, propose de le confirmer par retour.'];
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

// Analyse DÉTERMINISTE (mots-clés FR) : le mode qui tourne sans clé IA, et le
// filet de sécurité quand l'IA échoue ou invente.
function analyzeByRules({ subject = '', body = '', faq = {}, client = null, signature = '' }) {
  const haystack = `${subject}\n${body}`.toLowerCase();
  let intent = 'autre';
  if (/annul|report|décal|decal/.test(haystack)) intent = 'annulation';
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
  required: ['intent', 'summary', 'urgency', 'question', 'reply'],
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
} = {}) {
  // LA MEME HORLOGE QUE LE CERVEAU : passe et futur se decident sur le jour
  // du centre, pas sur celui d UTC ni sur un new Date() de plus.
  const jourDeLAnalyse = require('./center-facts').jourDuCentre();
  const client = await matchClient(from, centerId, deps, jourDeLAnalyse ? jourDeLAnalyse.date : '');
  const conversation = await conversationAvecLeClient(from, centerId, deps, body);
  const brain = await buildEmailBrain(centerId, deps);
  const rulesAnalysis = analyzeByRules({ subject, body, faq: brain.faq, client, signature: brain.signature });
  // Ce que le MODELE voit du client : tout sauf la cle CRM, qui vaut son
  // numero de telephone et ne lui sert a rien.
  const ficheClientPourLeModele = client
    ? (({ clientKey, ...reste }) => reste)(client)
    : 'inconnu';

  let analysis = rulesAnalysis;
  if (llmProvider()) {
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
        attendu: `intent (ce que veut le client), summary (1 phrase FR), urgency, reply prête à envoyer (vous doux, signature ${brain.signature}), et question : SI et seulement si il te manque un fait sur ce centre pour répondre précisément, écris la question à poser au staff (une phrase, exemple « Le centre autorise-t-il d'apporter sa propre nourriture ? »). Si tu peux répondre avec les faits fournis, question = "".`,
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
      const allowed = `${brain.stable}\n${brain.context}\n${subject}\n${body}\n${JSON.stringify(ficheClientPourLeModele)}\n${JSON.stringify(conversation)}`;
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

  const minuteKey = String(receivedAt || new Date().toISOString()).slice(0, 16);
  const subjectKey = String(subject || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
  const idempotencyKey = `inbound:${centerId}:${sender.toLowerCase()}:${minuteKey}:${subjectKey}`;

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
  if (fromName && !analysis.clientName) analysis.clientName = fromName;

  const communication = await enqueue({
    centerId,
    reservationId: null,
    channel: 'email',
    direction: 'inbound',
    templateId: 'inbound_email',
    recipient: sender,
    subject: String(subject || '').trim(),
    body: text,
    status: 'received',
    scheduledAt: null,
    idempotencyKey,
    payload: {
      textBody: text,
      inbound: true,
      from: sender,
      fromName: fromName || '',
      // L adresse qui a recu le mail et la facon dont le centre a ete decide
      // (destinataire, parametre, defaut). Sans elles, un mail mal classe ne se
      // distingue en rien d un mail bien classe, et personne ne peut le prouver.
      to: String(to || ''),
      routage: String(routage || ''),
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
    await deps.query(
      `delete from email_agent_memory
       where center_id = $1
         and id not in (
           select id from email_agent_memory
           where center_id = $1
           order by created_at desc
           limit ${MEMORY_CAP_PER_CENTER}
         );`,
      [centerId],
    );
  } catch (error) {
    return { recorded: false };
  }
  return { recorded: true };
}

module.exports = {
  INTENT_LABELS,
  buildEmailBrain,
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
  getEmailBrainOverrides,
  getEmailBrainDefaults,
  saveEmailBrainOverrides,
  getFaitsAppris,
  apprendreUnFait,
  __test: { hasUngroundedNumbers, significantDiff, matchClient, renderFaitsAppris },
};
