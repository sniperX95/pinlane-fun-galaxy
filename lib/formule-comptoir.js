// LES FORMULES FAITES AU COMPTOIR (2026-11-05, Ansar : « pouvoir faire formule custom temporaire
// et choisir si on veut garder cette formule genre sauvegarder et choisir si afficher pour les
// clients sur reservation ou pas »).
//
// TEMPORAIRE : un nom et un prix sur UN dossier (program.formuleSurMesure). Rien au catalogue.
//
// GARDEE : une vraie ligne du catalogue (lib/catalog-store.js createFormula), donc le moteur, le
// planning et Tarifs & formules la lisent comme les autres. Le catalogue appartient a la societe,
// mais les centres sont dissocies : elle n existe que pour le centre qui l a faite, et son
// identifiant le dit, sm-<centre>--<nom>. Aucune migration.
//
// AU COMPTOIR SEULEMENT : human_validation vaut 'comptoir'. Le formulaire, la disponibilite
// publique et l agent ne la voient pas (getEffectiveFormules, lib/booking-config.js) ; le moteur
// lit ce mode comme le mode par defaut (modeValidationFormule, lib/validation-policy.js).
'use strict';

const PREFIXE = 'sm-';
const SEPARATEUR = '--';
const MODE_COMPTOIR = 'comptoir';
const FAMILLE = 'Formules sur mesure';
const NOM_MAX = 80;
const PRIX_MAX = 1000;
const LIGNES_MAX = 30;
const DUREE_SERVICE_MINUTES = 5;

// Le centre d une formule gardee, '' pour toute autre formule.
function centreDeLaFormule(id) {
  const texte = String(id ?? '');
  if (!texte.startsWith(PREFIXE)) return '';
  const fin = texte.indexOf(SEPARATEUR, PREFIXE.length);
  return fin > PREFIXE.length ? texte.slice(PREFIXE.length, fin) : '';
}

const estFormuleDuCentre = (id, centerId) => Boolean(centerId) && centreDeLaFormule(id) === String(centerId);
const prefixeDuCentre = (centerId) => `${PREFIXE}${String(centerId)}${SEPARATEUR}`;

function texteSur(valeur, max) {
  return String(valeur ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function refusDeSaisie(message) {
  return Object.assign(new Error(message), { statusCode: 422, expose: true });
}

// Ce que le dossier garde de sa formule temporaire : un nom, et son prix par joueur s il en a un
// (le prix suit alors le groupe, prixQuiSuit). null : pas de formule.
function normaliserFormuleSurMesure(valeur) {
  if (!valeur || typeof valeur !== 'object') return null;
  const nom = texteSur(valeur.nom, NOM_MAX);
  if (!nom) return null;
  const brut = valeur.prixParPersonne;
  const prix = brut === null || brut === undefined || brut === '' ? NaN : Number(brut);
  return { nom, ...(Number.isFinite(prix) && prix >= 0 && prix <= PRIX_MAX ? { prixParPersonne: Math.round(prix * 100) / 100 } : {}) };
}

// Une ligne du ticket, dite comme sur la carte : « Crêpe au sucre par personne », « Pizza × 2 ».
function ligneDite(ligne) {
  const nom = texteSur(ligne && ligne.nom, 80);
  if (!nom) return '';
  const qte = Math.trunc(Number(ligne.qte) || 1);
  return ligne.parPersonne === true ? `${nom} par personne` : qte > 1 ? `${nom} × ${qte}` : nom;
}

// Une activite, dans les mots du catalogue (« 1h de Bowling », « 2 parties Laser Game »).
function activiteDite(activite) {
  const id = String(activite.id);
  if (id === 'bowling') {
    const minutes = Math.trunc(Number(activite.minutes) || 60);
    const reste = minutes % 60;
    return minutes < 60 ? `${minutes} min de Bowling` : `${Math.floor(minutes / 60)}h${reste ? String(reste).padStart(2, '0') : ''} de Bowling`;
  }
  if (id === 'laser_game') {
    const parties = Math.max(1, Math.trunc(Number(activite.parties) || 1));
    return `${parties} partie${parties > 1 ? 's' : ''} Laser Game`;
  }
  if (id === 'minigolf_blacklight') return '1 partie Minigolf';
  if (id === 'arcade_time') return '30 min arcades';
  if (id === 'playground') return 'Plaine de jeux';
  return texteSur(activite.nom, 80);
}

// L ACCES ILLIMITE (2026-11-18, Marius, manager de Gembloux : « un petit team building qui vient,
// ils ont acces a toutes les activites, et donc je ne sais pas choisir ca, je suis oblige de
// choisir chaque activite »). Une formule gardee du centre qui comprend TOUTES ses activites, lues
// au catalogue du centre par le serveur (jamais la liste du navigateur), avec un prix par joueur
// et une duree de visite. Le bowling (1 h) et le laser (1 partie) restent des etapes a heure,
// critiques : le moteur leur pose une heure et retient pistes et arene comme pour toute formule,
// jamais une fenetre ouverte (orderPolicy 'open_window', qui ne retient rien). Les autres se
// jouent a volonte : elles se partagent le reste de la visite, pour que le plan dure ce qui a ete
// vendu. orderPolicy 'illimite' le dit au catalogue ; le moteur ne lit que 'open_window', il la
// planifie donc comme les autres formules.
const ORDRE_ILLIMITE = 'illimite';
const DUREE_ILLIMITEE = Object.freeze({ min: 60, max: 720, pas: 30, defaut: 180 });
const BOWLING_ILLIMITE_MINUTES = 60;
const LASER_ILLIMITE_MINUTES = 30;
const LIBRE_MINIMUM_MINUTES = 5;
const A_HEURE = ['bowling', 'laser_game'];

// TOUT A VOLONTE, BOWLING ET LASER COMPRIS (2026-11-19, Ansar : « pour illimité on peut choisir
// absolument toutes les activités en illimité, on peut choisir quoi et tout »). Pour le bowling et
// le laser, le gerant choisit : a volonte (le groupe garde ses pistes toute la visite, ses armes a
// chaque depart laser, lib/a-volonte.js) ou une fois, a l heure reservee (la formule du 18/11).
// Le choix vit dans orderPolicy, la seule colonne texte de la formule que rien d autre ne lit :
// « illimite » (une fois, inchange), « illimite:bowling », « illimite:laser_game » ou
// « illimite:bowling,laser_game ». Aucune migration ; une formule illimitee deja creee garde
// « illimite » et se joue exactement comme avant.
function estOrdreIllimite(ordre) {
  const texte = String(ordre == null ? '' : ordre);
  return texte === ORDRE_ILLIMITE || texte.startsWith(`${ORDRE_ILLIMITE}:`);
}

// Les activites a volonte lues dans l ordre, dans l ordre du produit (bowling, puis laser).
function aVolonteDeLOrdre(ordre) {
  const texte = String(ordre == null ? '' : ordre);
  if (!texte.startsWith(`${ORDRE_ILLIMITE}:`)) return [];
  const voulues = new Set(texte.slice(ORDRE_ILLIMITE.length + 1).split(',').map((id) => id.trim()));
  return A_HEURE.filter((id) => voulues.has(id));
}

function ordreIllimite(aVolonte) {
  const liste = A_HEURE.filter((id) => (Array.isArray(aVolonte) ? aVolonte : []).includes(id));
  return liste.length ? `${ORDRE_ILLIMITE}:${liste.join(',')}` : ORDRE_ILLIMITE;
}

// Ce qu une formule (document du moteur ou carte du catalogue) garde a volonte : les activites que
// son ordre nomme ET que ses etapes portent encore (une formule adaptee sans laser ne garde pas
// l arene).
function activitesAVolonte(formula) {
  if (!formula || typeof formula !== 'object') return [];
  const steps = Array.isArray(formula.steps) ? formula.steps : [];
  return aVolonteDeLOrdre(formula.orderPolicy).filter((id) => steps.some((step) => step && String(step.activityId) === id));
}

// Les activites que le gerant a cochees, relues au catalogue du centre (jamais la liste du
// navigateur telle quelle : un identifiant inconnu du centre est ignore). Sans liste (la fenetre
// du 18/11 n en envoyait pas), tout le catalogue, comme avant.
function activitesCochees(brut, activitesDuCentre) {
  const vendables = (Array.isArray(activitesDuCentre) ? activitesDuCentre : []).filter((a) => a && a.id);
  if (!Array.isArray(brut)) return vendables;
  const voulues = new Set(brut.map((x) => String(x && typeof x === 'object' ? x.id : x).trim()).filter(Boolean));
  return vendables.filter((a) => voulues.has(String(a.id)));
}

// Le choix « a volonte » du bowling et du laser : { bowling: true, laser_game: false } ou une liste.
// Absent : une fois, a l heure reservee (la fenetre du 18/11 n en envoyait pas).
function aVolonteChoisi(brut) {
  if (Array.isArray(brut)) return A_HEURE.filter((id) => brut.map(String).includes(id));
  if (brut && typeof brut === 'object') return A_HEURE.filter((id) => brut[id] === true);
  return [];
}

function dureeIllimiteeLue(brut) {
  const minutes = brut === null || brut === undefined || brut === '' ? DUREE_ILLIMITEE.defaut : Math.trunc(Number(brut));
  if (!Number.isFinite(minutes) || minutes < DUREE_ILLIMITEE.min || minutes > DUREE_ILLIMITEE.max || minutes % DUREE_ILLIMITEE.pas !== 0) {
    throw refusDeSaisie('La durée de la visite va de 1 h à 12 h, par demi-heure.');
  }
  return minutes;
}

function dureeDite(minutes) {
  const reste = minutes % 60;
  return `${Math.floor(minutes / 60)} h${reste ? ` ${String(reste).padStart(2, '0')}` : ''}`;
}

// Les etapes d un acces illimite, dans l ordre du catalogue du centre.
function etapesIllimitees(activitesDuCentre, dureeMinutes) {
  const vendables = (Array.isArray(activitesDuCentre) ? activitesDuCentre : []).filter((a) => a && a.id);
  const bowling = vendables.some((a) => String(a.id) === 'bowling');
  const laser = vendables.some((a) => String(a.id) === 'laser_game');
  const libres = vendables.filter((a) => !A_HEURE.includes(String(a.id)));
  const steps = [];
  if (bowling) steps.push({ activityId: 'bowling', count: 1, durationMinutes: BOWLING_ILLIMITE_MINUTES, critical: true });
  if (laser) steps.push({ activityId: 'laser_game', count: 1, critical: true });
  if (libres.length) {
    const reste = Math.max(libres.length * LIBRE_MINIMUM_MINUTES, dureeMinutes - (bowling ? BOWLING_ILLIMITE_MINUTES : 0) - (laser ? LASER_ILLIMITE_MINUTES : 0));
    const part = Math.floor(reste / libres.length);
    const surplus = reste - part * libres.length;
    libres.forEach((a, rang) => steps.push({ activityId: String(a.id), count: 1, durationMinutes: part + (rang < surplus ? 1 : 0), label: `${texteSur(a.name || a.id, 60)} à volonté` }));
  }
  return steps;
}

// La duree d une visite illimitee, relue sur ses etapes (celles qu etapesIllimitees a ecrites).
function dureeIllimitee(steps) {
  return (Array.isArray(steps) ? steps : []).reduce((total, step) => {
    if (!step || !step.activityId) return total;
    if (step.activityId === 'laser_game') return total + LASER_ILLIMITE_MINUTES * Math.max(1, Math.trunc(Number(step.count) || 1));
    return total + Math.max(0, Math.trunc(Number(step.durationMinutes) || 0));
  }, 0);
}

// LE CHOIX DE CHAQUE RESERVATION (2026-11-20, un gerant : « il faut qu on puisse choisir activité par
// activité pour l illimité, genre quelle activité en illimité » ; la demande vient de Marius, manager
// de Gembloux). La formule dit ce que l acces peut comprendre et ce qu il garde d office ; chaque dossier
// choisit, parmi ses activites, celles que le groupe prend, et pour le bowling et le laser « à volonté »
// (garde toute la visite, lib/a-volonte.js) ou « 1 fois » (a son heure). Le choix vit dans le plan du
// dossier, comme la variante d une formule (lib/formula-choice.js) : opsPlan.illimite =
// { formuleId, activites, aVolonte }. Aucune migration. Un dossier sans choix se joue sur sa formule,
// exactement comme avant ; un choix egal a la formule rend la formule elle-meme.

// Les activites d une formule (document du moteur), une fois chacune, dans l ordre de ses etapes.
function activitesDeLaFormule(formula) {
  const steps = formula && Array.isArray(formula.steps) ? formula.steps : [];
  return [...new Set(steps.filter((step) => step && step.activityId).map((step) => String(step.activityId)))];
}

// Ce qui peut se choisir : les activites de la formule que le centre vend encore.
function activitesChoisissables(formula, activitesDuCentre) {
  const centre = new Set((Array.isArray(activitesDuCentre) ? activitesDuCentre : []).filter((a) => a && a.id).map((a) => String(a.id)));
  return activitesDeLaFormule(formula).filter((id) => centre.has(id));
}

// Le choix ecrit d une seule facon : les activites dans l ordre de la formule, le bowling puis le laser.
function choixRange(activites, aVolonte, formula) {
  const ordre = activitesDeLaFormule(formula);
  return {
    activites: ordre.filter((id) => activites.includes(id)),
    aVolonte: A_HEURE.filter((id) => aVolonte.includes(id) && activites.includes(id)),
  };
}

// LE CHOIX ENVOYE PAR LE COMPTOIR, relu contre la formule ET le catalogue du centre, jamais cru tel quel :
// une activite que la formule ne comprend pas, ou que le centre ne vend pas, refuse la demande (422), comme
// un « à volonté » sur autre chose que le bowling ou le laser compris. null sans choix.
function choixIllimiteLu(brut, { formula, activitesDuCentre = [] } = {}) {
  if (brut === undefined || brut === null) return null;
  if (typeof brut !== 'object' || Array.isArray(brut)) throw refusDeSaisie('Le choix de l’accès illimité est illisible.');
  const voulues = Array.isArray(brut.activites) ? brut.activites : null;
  if (!voulues || !voulues.length || voulues.length > 40) throw refusDeSaisie('Gardez au moins une activité dans l’accès illimité.');
  const ids = [...new Set(voulues.map((id) => (typeof id === 'string' || typeof id === 'number' ? String(id).trim() : '')))];
  const permises = new Set(activitesChoisissables(formula, activitesDuCentre));
  const hors = ids.find((id) => !permises.has(id));
  if (hors !== undefined) throw refusDeSaisie(`${texteSur(hors, 40) || 'Une activité'} ne fait pas partie de cet accès illimité.`);
  const brutVolonte = brut.aVolonte === undefined || brut.aVolonte === null ? [] : brut.aVolonte;
  if (!Array.isArray(brutVolonte) || brutVolonte.length > 10) throw refusDeSaisie('Le choix « à volonté » de l’accès illimité est illisible.');
  const aVolonte = [...new Set(brutVolonte.map((id) => String(id).trim()))];
  if (aVolonte.some((id) => !A_HEURE.includes(id) || !ids.includes(id))) throw refusDeSaisie('Seuls le bowling et le laser compris se gardent toute la visite.');
  return choixRange(ids, aVolonte, formula);
}

// LE CHOIX QUE LE PLAN D UN DOSSIER GARDE, relu sur sa formule seulement (un dossier passe a un autre
// acces ne lui donne pas le sien) et sans refus : ce que la formule ou le centre ne vend plus tombe, et
// rien ne reste quand tout est tombe (le dossier se joue alors sur sa formule).
function choixIllimiteGarde(garde, { formula, activitesDuCentre = [] } = {}) {
  if (!garde || typeof garde !== 'object' || !formula || String(garde.formuleId || '') !== String(formula.id || '')) return null;
  const permises = new Set(activitesChoisissables(formula, activitesDuCentre));
  const activites = (Array.isArray(garde.activites) ? garde.activites : []).map(String).filter((id) => permises.has(id));
  if (!activites.length) return null;
  return choixRange(activites, (Array.isArray(garde.aVolonte) ? garde.aVolonte : []).map(String), formula);
}

// LE CHOIX QUE GARDE UN DOSSIER ENREGISTRE, pour une modification qui n en envoie pas : relu sur la
// formule qu il garde (`formuleId`, celle d apres la modification) et sur ce que le centre vend
// aujourd hui. null quand il n en a pas, ou plus. (Charges a l appel : ops-knowledge lit ce module.)
function choixDuDossierEnregistre(dossier, { formuleId = '', centerId = '' } = {}) {
  const garde = dossier && dossier.opsPlan && typeof dossier.opsPlan === 'object' ? dossier.opsPlan.illimite : null;
  if (!garde || !formuleId || !centerId || String(garde.formuleId || '') !== String(formuleId)) return null;
  let formula = null;
  try {
    formula = require('./ops-knowledge').getFormula(String(formuleId), String(centerId));
  } catch (error) {
    formula = null;
  }
  if (!formula || !estOrdreIllimite(formula.orderPolicy)) return null;
  const choix = choixIllimiteGarde(garde, { formula, activitesDuCentre: require('./activity-catalog').listCenterActivities(String(centerId)) });
  return choix ? { formuleId: String(formuleId), ...choix } : null;
}

// Ce que le plan d un dossier garde du choix, et la formule sur laquelle il a ete fait.
function empreinteDuChoix(choix, formuleId) {
  return choix ? { formuleId: String(formuleId || ''), activites: choix.activites.slice(), aVolonte: choix.aVolonte.slice() } : null;
}

// Deux choix pareils ont la meme cle (l ordre ne compte pas).
function cleDuChoix(choix) {
  if (!choix || typeof choix !== 'object') return '';
  const liste = (valeur) => (Array.isArray(valeur) ? valeur.map(String).sort().join(',') : '');
  return `${liste(choix.activites)}|${liste(choix.aVolonte)}`;
}

// LE CHOIX QU UN DOSSIER PORTE pour sa formule : celui de son plan (ecrit par le serveur), sinon celui de
// la demande deja relue (normalizeReservationRequest), avant que le plan existe. null sans choix : le
// dossier se joue alors sur sa formule, comme avant. Le lecteur unique de formuleDuDossier
// (lib/formula-choice.js), des pistes a tenir (lib/database.js) et de la phrase (lib/reserver-fenetre.js).
function choixQueLeDossierPorte(dossier, formuleId = dossier && (dossier.formuleId || dossier.formulaId)) {
  const id = String(formuleId || '');
  if (!dossier || typeof dossier !== 'object' || !id) return null;
  const plan = dossier.opsPlan && typeof dossier.opsPlan === 'object' ? dossier.opsPlan : null;
  return [plan && plan.illimite, dossier.illimite]
    .find((choix) => choix && typeof choix === 'object' && Array.isArray(choix.activites) && String(choix.formuleId || '') === id) || null;
}

// LA FORMULE JOUEE AVEC LE CHOIX, pour le moteur : les etapes des activites retirees partent, celles du
// libre se partagent toujours la duree vendue (le plan dure ce qui a ete vendu, etapesIllimitees), et
// l ordre dit ce qui est garde a volonte (garderPourLaVisite le lit). Sans choix, ou pour un choix egal a
// la formule, la MEME instance : rien ne change, au caractere pres.
function formuleSelonLeChoix(formula, choix) {
  if (!formula || typeof formula !== 'object' || !choix || !Array.isArray(choix.activites) || !estOrdreIllimite(formula.orderPolicy)) return formula;
  const voulues = new Set(choix.activites.map(String));
  const etapes = Array.isArray(formula.steps) ? formula.steps : [];
  const gardees = etapes.filter((step) => !step || !step.activityId || voulues.has(String(step.activityId)));
  const ordre = ordreIllimite(choix.aVolonte);
  if (gardees.length === etapes.length && ordre === String(formula.orderPolicy)) return formula;
  const libres = gardees.filter((step) => step && step.activityId && !A_HEURE.includes(String(step.activityId)));
  let steps = gardees;
  if (libres.length && gardees.length !== etapes.length) {
    const aHeure = dureeIllimitee(gardees.filter((step) => !libres.includes(step)));
    const reste = Math.max(libres.length * LIBRE_MINIMUM_MINUTES, dureeIllimitee(etapes) - aHeure);
    const part = Math.floor(reste / libres.length);
    const surplus = reste - part * libres.length;
    steps = gardees.map((step) => {
      const rang = libres.indexOf(step);
      return rang < 0 ? step : { ...step, durationMinutes: part + (rang < surplus ? 1 : 0) };
    });
  }
  return { ...formula, steps, orderPolicy: ordre };
}

// Ce que la carte dit d un acces illimite : le mot que la console et le formulaire mettent en
// tete (« Toutes les activités illimitées »), ce qui est garde a volonte, ce qui se joue a heure,
// le reste, la duree. `aVolonte` : le bowling et le laser gardes toute la visite. `toutes` : le
// gerant n a decoche aucune activite du centre.
function lignesIllimitees(activitesDuCentre, dureeMinutes, { aVolonte = [], toutes = true } = {}) {
  const vendables = (Array.isArray(activitesDuCentre) ? activitesDuCentre : []).filter((a) => a && a.id);
  const nom = (a) => texteSur(a.name || a.id, 60);
  const porte = (id) => vendables.some((a) => String(a.id) === id);
  const gardees = [
    porte('bowling') && aVolonte.includes('bowling') ? 'Bowling à volonté, pistes gardées toute la visite' : '',
    porte('laser_game') && aVolonte.includes('laser_game') ? 'Laser Game à volonté, armes gardées à chaque départ' : '',
  ].filter(Boolean);
  const aHeure = [
    porte('bowling') && !aVolonte.includes('bowling') ? 'Bowling 1 h' : '',
    porte('laser_game') && !aVolonte.includes('laser_game') ? '1 partie de Laser Game' : '',
  ].filter(Boolean);
  const libres = vendables.filter((a) => !A_HEURE.includes(String(a.id))).map(nom);
  return [
    toutes ? 'Toutes les activités illimitées' : `Activités illimitées : ${vendables.map(nom).join(', ')}`,
    ...gardees,
    aHeure.length ? `${aHeure.join(' et ')}, à l’heure réservée` : '',
    libres.length ? `À volonté : ${libres.join(', ')}` : '',
    `${dureeDite(dureeMinutes)} sur place`,
  ].filter(Boolean);
}

// Ce qui se change apres coup, dans Tarifs & formules.
function champsDeFormule(corps = {}) {
  const name = texteSur(corps.nom, NOM_MAX);
  if (!name) throw refusDeSaisie('Donnez un nom à la formule.');
  const brut = corps.prixParPersonne;
  const priceValue = brut === null || brut === undefined || brut === '' ? NaN : Number(brut);
  if (!Number.isFinite(priceValue) || priceValue < 0 || priceValue > PRIX_MAX) throw refusDeSaisie(`Indiquez un prix par joueur entre 0 et ${PRIX_MAX} ${require('./monnaie').signe(require('./monnaie').deviseEnCours())}.`);
  const minPax = Math.trunc(Number(corps.minPax) || 1);
  if (minPax < 1 || minPax > 240) throw refusDeSaisie('Le nombre de joueurs minimum va de 1 à 240.');
  return { name, minPax, priceValue: Math.round(priceValue * 100) / 100 };
}

// La formule telle que createFormula la veut, depuis ce que la fenetre envoie. Les bornes du
// catalogue (activite connue, prix, nom) restent celles de lib/catalog-store.js.
// `activitesDuCentre` : le catalogue vendable du centre (lib/activity-catalog.js
// listCenterActivities), lu par le serveur. Un acces illimite (corps.illimite) en garde les
// activites cochees (corps.activites, relues contre lui ; toutes sans liste) et le choix « a
// volonte » du bowling et du laser (corps.aVolonte).
function formuleDepuisLeComptoir(corps = {}, { activitesDuCentre = [] } = {}) {
  if (corps.illimite === true) {
    const champs = champsDeFormule(corps);
    const duree = dureeIllimiteeLue(corps.dureeMinutes);
    const vendables = (Array.isArray(activitesDuCentre) ? activitesDuCentre : []).filter((a) => a && a.id);
    if (!vendables.length) throw refusDeSaisie('Ce centre n’a encore aucune activité à vendre.');
    const choisies = activitesCochees(corps.activites, vendables);
    if (!choisies.length) throw refusDeSaisie('Cochez au moins une activité de la formule.');
    const steps = etapesIllimitees(choisies, duree);
    const aVolonte = aVolonteChoisi(corps.aVolonte).filter((id) => choisies.some((a) => String(a.id) === id));
    return {
      ...champs,
      family: FAMILLE,
      priceType: 'per_pax',
      descriptionLines: lignesIllimitees(choisies, duree, { aVolonte, toutes: choisies.length === vendables.length }),
      steps,
      orderPolicy: ordreIllimite(aVolonte),
      humanValidation: corps.clients === true ? null : MODE_COMPTOIR,
    };
  }
  const champs = champsDeFormule(corps);
  const activites = (Array.isArray(corps.activites) ? corps.activites : []).slice(0, 12).filter((a) => a && a.id);
  if (!activites.length) throw refusDeSaisie('Une formule comprend au moins une activité.');
  const steps = activites.map((a) => {
    const id = String(a.id);
    if (id === 'bowling') return { activityId: id, count: 1, durationMinutes: Math.trunc(Number(a.minutes) || 60), critical: true };
    if (id === 'laser_game') return { activityId: id, count: Math.max(1, Math.trunc(Number(a.parties) || 1)), critical: true };
    const minutes = Math.trunc(Number(a.minutes) || 0);
    return { activityId: id, count: 1, ...(minutes > 0 ? { durationMinutes: minutes } : {}) };
  });
  // Ce qui se mange et se boit part en une seule etape de service : son libelle se lit la ou le
  // planning et les mails disent deja « 2 cruches boissons ».
  const compris = (Array.isArray(corps.lignes) ? corps.lignes : []).slice(0, LIGNES_MAX).map(ligneDite).filter(Boolean);
  if (compris.length) steps.push({ activityId: 'service_drinks', count: 1, label: compris.join(', ').slice(0, 200), resourceType: 'bar_service', durationMinutes: DUREE_SERVICE_MINUTES });
  const descriptionLines = [...activites.map(activiteDite).filter(Boolean), ...compris];
  return {
    ...champs,
    family: FAMILLE,
    priceType: 'per_pax',
    descriptionLines,
    steps,
    humanValidation: corps.clients === true ? null : MODE_COMPTOIR,
  };
}

module.exports = {
  DUREE_ILLIMITEE,
  FAMILLE,
  LASER_ILLIMITE_MINUTES,
  MODE_COMPTOIR,
  ORDRE_ILLIMITE,
  aVolonteDeLOrdre,
  activitesAVolonte,
  activitesChoisissables,
  centreDeLaFormule,
  champsDeFormule,
  choixDuDossierEnregistre,
  choixIllimiteGarde,
  choixIllimiteLu,
  choixQueLeDossierPorte,
  cleDuChoix,
  dureeIllimitee,
  empreinteDuChoix,
  estFormuleDuCentre,
  estOrdreIllimite,
  formuleDepuisLeComptoir,
  formuleSelonLeChoix,
  normaliserFormuleSurMesure,
  ordreIllimite,
  prefixeDuCentre,
};
