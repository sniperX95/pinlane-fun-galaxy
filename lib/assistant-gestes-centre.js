'use strict';
// LES GESTES DE L ETABLISSEMENT ET DU CATALOGUE (lot 2 de « tout faire », 2026-11-11, Ansar : « il doit
// vraiment être capable de TOUT FAIRE »). Les horaires de la semaine, les jours a part, les fermetures,
// les regles de la reservation en ligne, le statut, le nom et les coordonnees du centre, le formulaire de
// son site, les grilles de prix, le prix des activites, les formules du formulaire, les suggestions, les
// cartes arcades, les supplements, la boite de secours et les formules du comptoir.
//
// Le contrat d un geste et les aides (erreur, trouver, nombre, booleen, euros, coupe, rempli, DEMANDE_*) :
// lib/assistant-gestes.js. gestes(aides) rend { nom: geste } ; lecteurs ajoute des lectures injectables,
// toutes prefixees « centre » pour ne croiser ni celles du lot 1 ni celles des reservations.
//
// LA CONFIGURATION DU CENTRE (saveCenterConfig, lib/center-config.js saveCenterConfigOverride) : la carte
// part de la configuration que montre la page Etablissement, ne change que la cle visee et n envoie que
// la cle du haut qu elle a changee. La sauvegarde fusionne les objets cle par cle mais remplace un tableau
// en entier : un tableau part donc entier, avec le changement pose dedans.
//
// LE CATALOGUE APPARTIENT A LA SOCIETE : une activite ou une formule du catalogue change dans tous les
// centres de la societe (api/ops.js force centerId 'all'), et sa carte le dit.
//
// Jamais ici : l equipe, les roles, les codes d acces, la plateforme, la creation d un centre.

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const deux = (n) => String(n).padStart(2, '0');
const enMinutes = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return h * 60 + (m || 0); };
const enHeure = (minutes) => `${deux(Math.floor(minutes / 60))}:${deux(minutes % 60)}`;
const avecPluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

// Date.parse accepte le 31 fevrier : une date se reconstruit.
function dateReelle(iso) {
  const texte = String(iso == null ? '' : iso).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texte)) return false;
  const d = new Date(`${texte}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texte;
}
const dateDite = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const jourCourt = (iso) => String(iso || '').slice(5, 10).split('-').reverse().join('/');
const jourDe = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
function plusJours(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Une heure du centre : 24:00 vaut minuit, au-dela c est la nuit qui deborde sur le lendemain (25:00 = 1 h).
function heureDite(hhmm) {
  const m = enMinutes(hhmm);
  if (m === 1440) return 'minuit';
  return m > 1440 ? `${enHeure(m - 1440)} le lendemain` : hhmm;
}
const plageDite = (p) => (p && p.open ? `${p.open} à ${heureDite(p.close)}` : 'fermé');
const memePlage = (a, b) => (!a && !b) || Boolean(a && b && a.open === b.open && a.close === b.close);

// ── Ce que ces gestes lisent (injectable : le gate y pose les siens, rien ne part en base) ─────────
const lecteurs = {
  // La configuration du centre comme la page Etablissement la montre (lib/center-scope.js, projectCenterRow) :
  // sa ligne en base, son statut de colonne (il fait foi), sa configuration bornee sur le fichier socle.
  // null : le centre n a pas de ligne, aucune sauvegarde n y trouverait de quoi ecrire.
  async centreReglages(centre) {
    const { getPool } = require('./database');
    const CC = require('./center-config');
    const ligne = (await CC.loadCenterRecords(getPool())).find((l) => l && l.id === centre);
    if (!ligne) return null;
    const config = CC.normalizeCenterConfig(ligne.config, ligne.id);
    return { id: ligne.id, nom: ligne.name, statut: ligne.status || config.status, fuseau: ligne.timezone || config.timezone, config };
  },
  async centreAujourdhui() {
    const jour = require('./center-facts').jourDuCentre();
    return jour ? jour.date : new Date().toISOString().slice(0, 10);
  },
  // Les reservations qui tiennent leurs places, du jour debut au jour fin (simulations ecartees).
  async centreReservations(centre, debut, fin) {
    const { readAdminRangeState } = require('./database');
    const { tientSesPlaces } = require('./places-tenues');
    const lu = await readAdminRangeState(debut, fin, centre);
    return ((lu && lu.reservations) || []).filter((r) => tientSesPlaces(r) && r.validationStatus !== 'rejected');
  },
  async centreFermetures(centre) {
    const { getPool } = require('./database');
    return require('./availability-blocks').listAvailabilityBlocks(getPool(), centre);
  },
  // Les activites du catalogue de la societe, comme l editeur de Tarifs & formules les lit.
  async centreActivites(centre) {
    const { getPool } = require('./database');
    try { await require('./catalog-store').refreshCatalog(getPool()); } catch (e) { /* socle fichier */ }
    const c = await require('./catalog-overrides').buildClientCatalog(getPool(), centre);
    return c && Array.isArray(c.activities) ? c.activities : [];
  },
  // Les activites que CE centre vend : celles qu une fermeture peut viser.
  async centreActivitesVendues(centre) {
    const { getPool } = require('./database');
    try { await require('./ops-knowledge').refreshCenterOverrides(getPool()); } catch (e) { /* socle fichier */ }
    return require('./activity-catalog').listCenterActivities(centre).map((a) => ({ id: a.id, name: a.name }));
  },
};

// Les mots de la personne qui font naitre un geste risque, geste par geste. Chaque mot se prend en debut
// de mot (\b) : « beaucoup » ne coupe rien, « bonsoir » ne change pas d horaire, « vendredi » ne vend
// rien, « visite » n est pas le site, « client » n est pas un lien, « activité » n allume rien.
const DEMANDE_HORAIRES = /\bhoraires?\b|\bheures?\b|\bouv(r|ert)|\bferm|\bminuit|\bmatin|\bsoir|\d\s*h\b|\d\s*h\s*\d/i;
const DEMANDE_JOUR_A_PART = /\bvacanc|\bcong[ée]|\bf[ée]ri|\bnorma(l|le|ux)\b|\bhabitu|\bcalendrier|\bscolaire/i;
const DEMANDE_VACANCES_AUTO = /\bvacanc|\bf[ée]ri|\bcong[ée]|\bcalendrier|\bscolaire/i;
const DEMANDE_REGLES_EN_LIGNE = /\bd[ée]lai|\bavance|\bhorizon|\bveille|\bderni[eè]r|\bjours? avant|\bjour m[êe]me|\bplus t[ôo]t|\bplus tard|\blimit/i;
const DEMANDE_FERMETURE = /\bferm|\bbloqu|\bcoup|indisponib|privatis|\btravaux|maintenance|\bpanne/i;
const DEMANDE_ROUVRIR = /\brouvr|\br[ée]ouvr|\bretir|\bsupprim|\benl[eè]v|\bannul|\bd[ée]bloqu/i;
const DEMANDE_RETIRER_HORAIRES = /\bretir|\benl[eè]v|\bsupprim|\bannul|\bhabitu|\bnorma(l|le|ux)\b|\bremet|\brevenir|\bplus besoin/i;
const DEMANDE_OFFRE = /\bformule|\boffres?\b|\bcoch|\bd[ée]coch|\bpropos[eé]|\bretir|\bmasqu|\bcach|\bremet|\baffich/i;
const DEMANDE_STATUT = /\bstatut|\barchiv|\bpr[ée]vu|\bouv(r|ert)|\bferm|\brouvr|\br[ée]ouvr|\bcoup|\barr[eê]t|\bactive[rz]?\b|\bd[ée]sactiv/i;
const DEMANDE_FORMULAIRE_SITE = /\bformulaire|\bsite|\bwidget|\bancien|\bcoup|\bremet|\br[ée]activ|\bd[ée]sactiv/i;
const DEMANDE_COORDONNEES = /\badresse|\bt[ée]l[ée]phone|\bt[ée]l\b|\bgsm\b|\bparking|\bsite|\blogo|\bcoordonn|\bliens?\b|\burl\b/i;
const DEMANDE_NOM_CENTRE = /\bnoms?\b|\brenomm|\bs[’']appel|\bintitul/i;
const DEMANDE_SUGGESTIONS = /\bsuggest|\boffres?\b|\bremise|\br[ée]duc|\bpromo|\bcoup|\ballum|\bd[ée]sactiv|\bactive[rz]?\b|%|€|\beuro/i;
const DEMANDE_CARTES = /\bprix|\btarif|€|\beuro|\bco[uû]t|\bcartes?\b|\barcade|\bpropos[eé]|\bretir|\bremet|\bvend(?!redi)/i;
const DEMANDE_SUPPLEMENTS = /\bprix|\btarif|€|\beuro|\bco[uû]t|suppl[ée]ment|\barticle|\bpropos[eé]|\bmasqu|\bcach|\bretir|\bremet/i;
const DEMANDE_SEUIL = /\bseuil|sur[ -]mesure|\bgros groupes?|\bgroupes? de\b|\bpartir de \d|\bpersonnes? (et|ou) plus|\bplus de \d+ personnes|\bd[eè]s \d/i;
const DEMANDE_SECOURS = /\bsecours|\bcopies?\b|\bsauvegard|\bbo[iî]te|\bdouble\b/i;
const DEMANDE_COMPTOIR = /\bcomptoir|\baffich|\bmontr|\bcach|\bmasqu|\bpropos[eé]|\ben ligne|\bvisible|\bpubli/i;

// Les grilles de prix d un centre (lib/booking-config.js grillesEffectives) : la cle de chaque case est
// celle que saveGrillesTarif attend (lib/center-config.js CASES_DES_GRILLES).
const GRILLES = {
  bowling: { nom: 'Bowling', unite: 'prix de la piste', options: 'durationOptions', cle: (o) => String(o.value) },
  laser: { nom: 'Laser Game', unite: 'prix par personne', options: 'laserOptions', cle: (o) => String(o.games) },
  funRun: { nom: 'Fun Run', unite: 'prix de la session', options: 'funRunOptions', cle: (o) => String(o.minutes) },
};
const STATUTS = { active: 'ouvert à la réservation', planned: 'prévu, pas encore ouvert', closed: 'archivé' };

function gestes(aides) {
  const { erreur, sans, coupe, euros, rempli, nombre, booleen, trouver, DEMANDE_PRIX, DEMANDE_SUPPRIMER } = aides;
  const nomFormule = (f) => (f.effective && f.effective.name) || f.name || f.id;

  // Le centre tel que la page Etablissement le montre ; sans ligne en base, rien ne s y enregistre.
  async function reglages(ctx) {
    const r = await ctx.lire('centreReglages');
    if (!r) throw erreur('Ce centre n’a pas encore de fiche enregistrée : ses réglages se changent dans la page Établissement.', 404);
    return r;
  }

  // Un prix change aussi avec le droit « Tarifs » (api/ops.js, touchePrix ; passe securite du 2026-11-08).
  function exigerTarifs(ctx, quoi) {
    if (!require('./staff-auth').sessionHasPermission(ctx.session, 'pricing.manage')) throw erreur(`Le rôle de cette personne ne permet pas ce geste : changer ${quoi} demande aussi le droit « Tarifs ».`, 403);
  }

  async function dateAVenir(ctx, saisie, quoi = 'la date') {
    const date = String(saisie == null ? '' : saisie).trim();
    if (!dateReelle(date)) throw erreur(`Donnez ${quoi} au format AAAA-MM-JJ, une date qui existe.`);
    if (date < await ctx.lire('centreAujourdhui')) throw erreur('Cette date est passée.');
    return date;
  }

  function jourDeLaSemaine(saisie) {
    const cle = sans(saisie);
    const mots = cle.split(' ').map((m) => m.replace(/s$/, ''));
    const i = /^[0-6]$/.test(cle) ? Number(cle) : JOURS.findIndex((j) => mots.includes(j) || (cle.length >= 3 && j.startsWith(cle)));
    if (i < 0) throw erreur('Dites le jour : lundi, mardi, mercredi, jeudi, vendredi, samedi ou dimanche.');
    return i;
  }

  function heureLue(saisie, quoi) {
    const t = String(saisie == null ? '' : saisie).trim().toLowerCase().replace(/\s+/g, '');
    if (t === 'minuit') return '24:00';
    if (t === 'midi') return '12:00';
    const m = /^(\d{1,2})(?:[:h.](\d{2})?)?h?$/.exec(t);
    if (!m) throw erreur(`${quoi} se donne en heures et minutes, par exemple 14:00.`);
    const h = Number(m[1]);
    const mn = Number(m[2] || 0);
    if (h > 24 || mn > 59 || (h === 24 && mn > 0)) throw erreur(`${quoi} n’est pas une heure de la journée.`);
    return `${deux(h)}:${deux(mn)}`;
  }

  function plageLue(ouverture, fermeture) {
    const open = heureLue(ouverture, 'L’ouverture');
    if (open === '24:00') throw erreur('L’ouverture se donne entre 00:00 et 23:59.');
    let close = heureLue(fermeture, 'La fermeture');
    // Une fermeture avant l ouverture, jusqu a 06:00, est celle du lendemain : 00:00 devient 24:00, 01:30
    // devient 25:30 (assets/app-main.js, ebApresMinuit et ebLendemain ; lib/center-config.js TIME_PATTERN).
    if (enMinutes(close) <= enMinutes(open) && enMinutes(close) <= 360) close = enHeure(enMinutes(close) + 1440);
    const plage = require('./center-config').normalizeDaySchedule({ open, close });
    if (!plage) throw erreur('La fermeture doit venir après l’ouverture. Après minuit, elle compte pour le lendemain, jusqu’à 06:00.');
    return plage;
  }

  // Les dossiers qui sortent d une plage (null : jour ferme, ils sortent tous), avec la marge de fin du
  // logiciel (lib/ouverture-exceptionnelle.js, controlerLaPlage).
  function horsDesHeures(reservations, plage) {
    const { etendueDuDossier } = require('./ouverture-exceptionnelle');
    const { timeToNum } = require('./booking-config');
    return reservations.filter((r) => {
      const e = etendueDuDossier(r);
      if (!e) return false;
      if (!plage) return true;
      return e.debut < timeToNum(plage.open) || e.fin > timeToNum(plage.close) + 0.25;
    });
  }
  const listeDite = (reservations) => `${reservations.slice(0, 3).map((x) => `${jourCourt(x.date)} à ${String(x.startTime || '').slice(0, 5)}`).join(', ')}${reservations.length > 3 ? '…' : ''}`;

  // Une fermeture deja posee, dite comme la page Etablissement : quand, quoi, quelles heures, pourquoi.
  function fermetureDite(b, noms = {}) {
    const quand = b.recurrence === 'weekly'
      ? `chaque ${JOURS[Number(b.dayOfWeek)] || 'semaine'}${b.dateFrom ? ` du ${b.dateFrom}` : ''}${b.dateUntil ? ` au ${b.dateUntil}` : ''}`
      : String(b.date || '');
    const vise = b.scopeType === 'center' ? 'tout le centre'
      : b.scopeType === 'lane' ? `piste ${b.scopeRef}`
        : b.scopeType === 'activity' ? ((noms.activites && noms.activites.get(b.scopeRef)) || b.scopeRef)
          : `formule ${(noms.formules && noms.formules.get(b.scopeRef)) || b.scopeRef}`;
    const heures = b.startMin == null && b.endMin == null ? 'toute la journée' : `de ${enHeure(b.startMin == null ? 0 : b.startMin)} à ${heureDite(enHeure(b.endMin == null ? 1440 : b.endMin))}`;
    return `${quand}, ${vise}, ${heures}${b.reason ? ` (${coupe(b.reason, 60)})` : ''}`;
  }

  // Un dossier est-il dans ce que la fermeture ferme ? Le jour, les heures, puis la piste, l activite
  // ou la formule qu elle vise (memes lectures que le planning, lib/availability-slots.js).
  function chevauche(debutH, finH, startMin, endMin) {
    if (startMin == null && endMin == null) return true;
    return debutH * 60 < (endMin == null ? 1440 : endMin) && (startMin == null ? 0 : startMin) < finH * 60;
  }
  function dossierTouche(r, b) {
    if (b.scopeType === 'lane') {
      return require('./availability-slots').laneWindowsFromReservation(r).some((f) => (f.lanes || []).map(Number).includes(Number(b.scopeRef)) && chevauche(Number(f.start), Number(f.start) + Number(f.duration), b.startMin, b.endMin));
    }
    const e = require('./ouverture-exceptionnelle').etendueDuDossier(r);
    if (!e || !chevauche(e.debut, e.fin, b.startMin, b.endMin)) return false;
    if (b.scopeType === 'activity') return require('./reservation-activities').reservationActivityEntries(r).some((x) => x.id === b.scopeRef);
    if (b.scopeType === 'formula') return String(r.formuleId || '') === b.scopeRef;
    return true;
  }

  function remiseLue(saisie) {
    const t = String(saisie == null ? '' : saisie).toLowerCase().trim();
    if (/^(aucune?|pas de remise|sans remise|sans|0)$/.test(sans(t))) return { mode: 'none', value: 0 };
    const m = /(\d+(?:[.,]\d+)?)/.exec(t);
    if (m && /%|pour ?cent/.test(t)) return { mode: 'percent', value: nombre(m[1], { min: 0, max: 100, quoi: 'La remise' }) };
    if (m && /€|eur/.test(t)) return { mode: /par (personne|participant|joueur|enfant)/.test(t) ? 'fixed_per_participant' : 'fixed_total', value: nombre(m[1], { min: 0, max: 10000, quoi: 'La remise' }) };
    throw erreur('Dites la remise : « 10 % », « 5 € par personne », « 20 € » ou « aucune ».');
  }
  const remiseDite = (d) => (!d || d.mode === 'none' ? 'aucune' : d.mode === 'percent' ? `${d.value} %` : d.mode === 'fixed_per_participant' ? `${euros(d.value)} par personne` : `${euros(d.value)} sur le total`);

  // La boite de secours : les bornes de lib/center-config.js normalizeSecours (adresse lisible, jamais un
  // domaine reserve, 200 caracteres et 5 adresses au plus).
  function adresseDeSecours(saisie) {
    const a = String(saisie == null ? '' : saisie).trim().toLowerCase();
    if (!a || a.length > 200 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(a) || /@[^@]*\.(test|invalid|example|localhost)$/i.test(a)) throw erreur(`« ${coupe(saisie, 80)} » n’est pas une adresse e-mail utilisable.`);
    return a;
  }

  return {
    // ── Horaires et jours du centre (page Établissement) ──
    horaires_de_la_semaine: {
      domaine: 'Établissement', titre: 'Horaires de la semaine', verbe: 'Enregistrer les horaires', cours: 'Enregistrement…', confirmer: 'Oui, changer les horaires',
      quoi: 'change les heures d’un jour de la semaine, toutes les semaines, ou ferme ce jour-là ; vacances oui change les horaires des vacances. Pour un seul jour précis : horaires_du_jour (proposer_un_geste) ou fermeture_programmee',
      parametres: { jour: 'lundi, mardi… ou dimanche', ouverture: 'HH:MM', fermeture: 'HH:MM ; après minuit, jusqu’à 06:00, elle compte pour le lendemain', ferme: 'oui pour fermer ce jour-là chaque semaine', vacances: 'facultatif : oui pour les horaires des vacances' },
      action: 'saveCenterConfig', permission: 'settings.manage', risque: true, demande: DEMANDE_HORAIRES,
      async preparer(p, ctx) {
        const r = await reglages(ctx);
        const vacances = rempli(p.vacances) ? booleen(p.vacances, 'les vacances') : false;
        const bloc = vacances ? 'holiday' : 'regular';
        const horaires = r.config.defaultSchedule && typeof r.config.defaultSchedule === 'object' ? r.config.defaultSchedule[bloc] : null;
        // Une semaine qui n est pas posee en entier (« same_as_libramont_public_schedule », jours absents) :
        // les autres jours ne se devinent pas.
        if (!horaires || JOURS.some((j, i) => !(String(i) in horaires))) throw erreur(`Les horaires ${vacances ? 'de vacances ' : ''}de ce centre ne sont pas posés pour toute la semaine : posez-les d’abord dans la page Établissement, un jour pourra ensuite changer d’ici.`);
        const jour = jourDeLaSemaine(p.jour);
        const ferme = rempli(p.ferme) ? booleen(p.ferme, 'la fermeture') : false;
        const nouvelle = ferme ? null : plageLue(p.ouverture, p.fermeture);
        const avant = horaires[String(jour)] || null;
        const nomJour = `${JOURS[jour]}${vacances ? ' de vacances' : ''}`;
        if (memePlage(avant, nouvelle)) throw erreur(`Le ${nomJour} est déjà ${avant ? `ouvert de ${plageDite(avant)}` : 'fermé'}.`);
        const semaine = { ...horaires, [String(jour)]: nouvelle };
        // Les dossiers a venir de ce jour-la (90 jours) qui tomberaient hors des nouvelles heures. Un jour
        // aux horaires a part (ouverturesExceptionnelles) garde les siens pour l equipe : ses dossiers restent dedans.
        const aujourdhui = await ctx.lire('centreAujourdhui');
        const { isHolidayScheduleDate, ouvertureExceptionnelle } = require('./booking-config');
        const concernes = (await ctx.lire('centreReservations', aujourdhui, plusJours(aujourdhui, 90)))
          .filter((x) => x.date >= aujourdhui && jourDe(x.date) === jour && isHolidayScheduleDate(x.date, { holidaySettings: r.config.holidaySettings }) === vacances && !ouvertureExceptionnelle(x.date, r.config));
        const dehors = horsDesHeures(concernes, nouvelle);
        return {
          corps: { config: { defaultSchedule: { [bloc]: semaine } } },
          texte: nouvelle ? `Ouvrir le ${nomJour} de ${plageDite(nouvelle)}, chaque semaine.` : `Fermer le ${nomJour}, chaque semaine.`,
          lignes: [{ libelle: 'Jour', valeur: `le ${nomJour}, chaque semaine` }, { libelle: 'Horaires', avant: plageDite(avant), apres: plageDite(nouvelle) }],
          clients: `Le formulaire en ligne propose tout de suite ces heures le ${nomJour}. Les réservations déjà prises ne bougent pas.`,
          alerte: dehors.length ? `${avecPluriel(dehors.length, 'réservation à venir tombe', 'réservations à venir tombent')} hors de ces heures (${listeDite(dehors)}) : elles ne bougent pas toutes seules, prévenez ces clients ou déplacez-les.` : null,
          fait: `Le ${nomJour} est maintenant ${nouvelle ? `ouvert de ${plageDite(nouvelle)}` : 'fermé'}.`,
        };
      },
    },

    forcer_jour_vacances_ou_normal: {
      domaine: 'Établissement', titre: 'Jour à part', verbe: 'Enregistrer ce jour', cours: 'Enregistrement…', confirmer: 'Oui, appliquer à ce jour',
      quoi: 'force un jour précis aux horaires de vacances ou aux horaires normaux, ou le rend au calendrier (vacances scolaires et jours fériés)',
      parametres: { date: 'AAAA-MM-JJ', mode: 'vacances, normal, ou calendrier pour retirer ce qui était forcé' },
      action: 'saveCenterConfig', permission: 'settings.manage', risque: true, demande: DEMANDE_JOUR_A_PART,
      async preparer(p, ctx) {
        const r = await reglages(ctx);
        const date = await dateAVenir(ctx, p.date);
        const cle = sans(p.mode);
        const mode = /vacanc|conge|ferie/.test(cle) ? 'holiday' : /normal|habituel|ordinaire/.test(cle) ? 'normal' : /calendrier|retir|enlev|automat|aucun/.test(cle) ? null : undefined;
        if (mode === undefined) throw erreur('Dites le mode : vacances, normal, ou calendrier pour revenir au calendrier.');
        const reglage = r.config.holidaySettings || {};
        const liste = Array.isArray(reglage.overrides) ? reglage.overrides : [];
        const avant = (liste.find((o) => o.date === date) || {}).mode || null;
        if (avant === mode) throw erreur(mode ? `Le ${dateDite(date)} est déjà forcé aux horaires ${mode === 'holiday' ? 'de vacances' : 'normaux'}.` : `Le ${dateDite(date)} suit déjà le calendrier.`);
        const suite = liste.filter((o) => o.date !== date).concat(mode ? [{ date, mode }] : []).sort((a, b) => (a.date < b.date ? -1 : 1));
        // Au-dela de 200, la sauvegarde jetterait les jours en trop sans le dire (lib/center-config.js, MAX_HOLIDAY_OVERRIDES).
        if (suite.length > 200) throw erreur('Ce centre a déjà 200 jours à part, le maximum : retirez-en un dans la page Établissement d’abord.');
        const { getHolidayContext, getSchedule, numToTime } = require('./booking-config');
        const centreLu = (overrides) => ({ defaultSchedule: r.config.defaultSchedule, holidaySettings: { ...reglage, overrides } });
        const regimeDit = (overrides) => {
          const c = getHolidayContext(date, centreLu(overrides));
          if (c.override === 'holiday') return 'forcé aux horaires de vacances';
          if (c.override === 'normal') return 'forcé aux horaires normaux';
          return c.active ? `selon le calendrier : ${c.label || 'vacances'}, horaires de vacances` : 'selon le calendrier : horaires normaux';
        };
        const heuresDites = (s) => (s ? s.label : 'fermé');
        const apres = getSchedule(date, centreLu(suite));
        const dehors = horsDesHeures(await ctx.lire('centreReservations', date, date), apres && { open: numToTime(apres.open), close: numToTime(apres.close) });
        return {
          corps: { config: { holidaySettings: { overrides: suite } } },
          texte: mode ? `Mettre le ${dateDite(date)} aux horaires ${mode === 'holiday' ? 'de vacances' : 'normaux'}.` : `Rendre le ${dateDite(date)} au calendrier.`,
          lignes: [{ libelle: 'Jour', valeur: dateDite(date) }, { libelle: 'Ce jour-là', avant: regimeDit(liste), apres: regimeDit(suite) }, { libelle: 'Horaires', avant: heuresDites(getSchedule(date, centreLu(liste))), apres: heuresDites(apres) }],
          clients: 'Le formulaire en ligne applique tout de suite ce régime ce jour-là, horaires et formules hors vacances compris. Les réservations déjà prises ne bougent pas.',
          alerte: dehors.length ? `${avecPluriel(dehors.length, 'réservation tombe', 'réservations tombent')} hors de ces horaires (${listeDite(dehors)}) : elles ne bougent pas toutes seules.` : null,
          fait: `Le ${dateDite(date)} est enregistré.`,
        };
      },
    },

    vacances_automatiques: {
      domaine: 'Établissement', titre: 'Horaires de vacances automatiques', verbe: 'Appliquer', cours: 'Enregistrement…', confirmer: 'Oui, appliquer',
      quoi: 'allume ou coupe le passage automatique aux horaires de vacances pendant les vacances scolaires et les jours fériés (les jours forcés à part ne bougent pas)',
      parametres: { actif: 'oui pour l’allumer, non pour le couper' },
      action: 'saveCenterConfig', permission: 'settings.manage', risque: true, demande: DEMANDE_VACANCES_AUTO,
      async preparer(p, ctx) {
        const r = await reglages(ctx);
        const actif = booleen(p.actif, 'les vacances automatiques');
        const avant = !(r.config.holidaySettings && r.config.holidaySettings.enabled === false);
        if (avant === actif) throw erreur(`Le passage automatique aux horaires de vacances est déjà ${actif ? 'allumé' : 'coupé'}.`);
        return {
          corps: { config: { holidaySettings: { enabled: actif } } },
          texte: `${actif ? 'Allumer' : 'Couper'} le passage automatique aux horaires de vacances.`,
          lignes: [{ libelle: 'Vacances scolaires et jours fériés', avant: avant ? 'horaires de vacances' : 'horaires normaux', apres: actif ? 'horaires de vacances' : 'horaires normaux' }],
          clients: actif ? 'Le formulaire en ligne suit tout de suite les horaires de vacances pendant les vacances et les jours fériés.' : 'Le formulaire en ligne garde tout de suite les horaires normaux pendant les vacances et les jours fériés, sauf les jours forcés à part.',
          fait: `Le passage automatique aux horaires de vacances est ${actif ? 'allumé' : 'coupé'}.`,
        };
      },
    },

    regler_reservation_en_ligne: {
      domaine: 'Établissement', titre: 'Règles de la réservation en ligne', verbe: 'Enregistrer les règles', cours: 'Enregistrement…', confirmer: 'Oui, appliquer ces règles',
      quoi: 'règle jusqu’à quand un client réserve en ligne avant sa date (délai) et combien de temps à l’avance au plus tôt (horizon). Le comptoir n’est pas limité',
      parametres: { delai_jours: 'facultatif : 0 jusqu’au dernier moment, 1 la veille au plus tard… jusqu’à 30', horizon_jours: 'facultatif : de 1 à 365 jours à l’avance, ou « un an »' },
      action: 'saveCenterConfig', permission: 'settings.manage', risque: true, demande: DEMANDE_REGLES_EN_LIGNE,
      async preparer(p, ctx) {
        const r = await reglages(ctx);
        if (!rempli(p.delai_jours) && !rempli(p.horizon_jours)) throw erreur('Dites ce qui change : le délai, l’horizon, ou les deux.');
        const actuelles = { minDaysAhead: 0, horizonDays: null, ...(r.config.bookingRules || {}) };
        const suite = { ...actuelles };
        // Les bornes de la sauvegarde (lib/center-config.js normalizeBookingRules) : 0 a 30, et 1 a 365 ou un an.
        if (rempli(p.delai_jours)) suite.minDaysAhead = nombre(p.delai_jours, { min: 0, max: 30, quoi: 'Le délai', entier: true });
        if (rempli(p.horizon_jours)) suite.horizonDays = /\ban\b|aucun|sans|illimit|defaut/.test(sans(p.horizon_jours)) ? null : nombre(p.horizon_jours, { min: 1, max: 365, quoi: 'L’horizon', entier: true });
        if (suite.minDaysAhead === actuelles.minDaysAhead && suite.horizonDays === actuelles.horizonDays) throw erreur('Ce sont déjà les règles du centre.');
        if (suite.minDaysAhead >= (suite.horizonDays == null ? 365 : suite.horizonDays)) throw erreur('Le délai doit rester plus court que l’horizon : sinon plus aucune date ne se réserve en ligne.');
        const delaiDit = (n) => (n === 0 ? 'jusqu’au dernier moment' : n === 1 ? 'la veille au plus tard' : `${n} jours avant, au plus tard`);
        const horizonDit = (n) => (n == null ? 'jusqu’à un an à l’avance' : `jusqu’à ${n} jour${n > 1 ? 's' : ''} à l’avance`);
        return {
          corps: { config: { bookingRules: suite } },
          texte: `Régler la réservation en ligne : ${delaiDit(suite.minDaysAhead)}, ${horizonDit(suite.horizonDays)}.`,
          lignes: [{ libelle: 'Réserver au plus tard', avant: delaiDit(actuelles.minDaysAhead), apres: delaiDit(suite.minDaysAhead) }, { libelle: 'Réserver au plus tôt', avant: horizonDit(actuelles.horizonDays), apres: horizonDit(suite.horizonDays) }],
          clients: 'Le formulaire en ligne applique tout de suite ces règles. Les réservations déjà prises ne bougent pas, et l’équipe réserve toujours au comptoir sans cette limite.',
          fait: 'Les règles de la réservation en ligne sont enregistrées.',
        };
      },
    },

    fermeture_programmee: {
      domaine: 'Établissement', titre: 'Fermeture programmée', verbe: 'Fermer', cours: 'Fermeture…', confirmer: 'Oui, fermer',
      quoi: 'ferme tout le centre, une piste, une activité ou une formule, un jour précis (date) ou chaque semaine (chaque), toute la journée ou de debut à fin. Une carte ferme un seul jour : pour plusieurs jours, une carte par jour ; au-delà de trois jours, la page Établissement ferme une plage d’un coup',
      parametres: { date: 'AAAA-MM-JJ, pour un jour précis', chaque: 'pour chaque semaine : le jour, par exemple lundi', du: 'facultatif avec chaque : AAAA-MM-JJ, le premier jour', au: 'facultatif avec chaque : AAAA-MM-JJ, le dernier jour', piste: 'facultatif : le numéro de la piste à fermer', activite: 'facultatif : le nom de l’activité à fermer', formule: 'facultatif : le nom de la formule à fermer', debut: 'facultatif : HH:MM, avec fin', fin: 'facultatif : HH:MM, avec debut, 24:00 au plus', motif: 'facultatif, quelques mots' },
      action: 'saveAvailabilityBlock', permission: 'settings.manage', risque: true, demande: DEMANDE_FERMETURE,
      async preparer(p, ctx) {
        const r = await reglages(ctx);
        const aujourdhui = await ctx.lire('centreAujourdhui');
        if (['piste', 'activite', 'formule'].filter((k) => rempli(p[k])).length > 1) throw erreur('Une fermeture vise tout le centre, ou une seule piste, une seule activité ou une seule formule.');
        let scopeType = 'center';
        let scopeRef = null;
        let vise = 'tout le centre';
        if (rempli(p.piste)) {
          const pistes = Number(r.config.resources && r.config.resources.bowling && r.config.resources.bowling.laneCount) || 0;
          if (!pistes) throw erreur('Ce centre n’a pas de pistes.');
          const n = nombre(p.piste, { min: 1, max: pistes, quoi: 'Le numéro de piste', entier: true });
          scopeType = 'lane'; scopeRef = String(n); vise = `la piste ${n}`;
        } else if (rempli(p.activite)) {
          const a = trouver(await ctx.lire('centreActivitesVendues'), p.activite, { quoi: 'l’activité' });
          scopeType = 'activity'; scopeRef = a.id; vise = `« ${a.name} »`;
        } else if (rempli(p.formule)) {
          const f = trouver(await ctx.lire('catalogue'), p.formule, { quoi: 'la formule', nom: nomFormule });
          scopeType = 'formula'; scopeRef = f.id; vise = `la formule « ${nomFormule(f)} »`;
        }
        const corps = { scopeType, ...(scopeRef ? { scopeRef } : {}) };
        if (rempli(p.date) && rempli(p.chaque)) throw erreur('Un jour précis (date) ou chaque semaine (chaque), pas les deux.');
        let quand;
        if (rempli(p.chaque)) {
          corps.recurrence = 'weekly';
          corps.dayOfWeek = jourDeLaSemaine(p.chaque);
          if (rempli(p.du)) corps.dateFrom = await dateAVenir(ctx, p.du, 'le premier jour');
          if (rempli(p.au)) corps.dateUntil = await dateAVenir(ctx, p.au, 'le dernier jour');
          if (corps.dateFrom && corps.dateUntil && corps.dateUntil < corps.dateFrom) throw erreur('Le dernier jour vient avant le premier.');
          quand = `chaque ${JOURS[corps.dayOfWeek]}${corps.dateFrom ? `, du ${dateDite(corps.dateFrom)}` : ''}${corps.dateUntil ? ` au ${dateDite(corps.dateUntil)}` : ''}`;
        } else {
          if (rempli(p.du) || rempli(p.au)) throw erreur('Une carte ferme un seul jour : donnez date, une carte par jour, ou chaque pour une fermeture de chaque semaine.');
          corps.recurrence = 'once';
          corps.date = await dateAVenir(ctx, p.date);
          quand = `le ${dateDite(corps.date)}`;
        }
        if (rempli(p.debut) !== rempli(p.fin)) throw erreur('Donnez le début ET la fin, ou rien pour toute la journée.');
        if (rempli(p.debut)) {
          corps.startTime = heureLue(p.debut, 'Le début');
          corps.endTime = heureLue(p.fin, 'La fin');
          if (!(enMinutes(corps.endTime) > enMinutes(corps.startTime))) throw erreur('La fin doit venir après le début, le même jour (24:00 au plus).');
        }
        if (rempli(p.motif)) corps.reason = coupe(String(p.motif).replace(/[<>]/g, ''), 200);
        // La validation du logiciel, telle quelle (lib/availability-blocks.js normalizeBlockInput) : la carte
        // ne promet rien que la sauvegarde refuserait.
        require('./availability-blocks').normalizeBlockInput({ ...corps, centerId: ctx.centre });
        const bloc = { ...corps, scopeRef: scopeRef || null, startMin: corps.startTime ? enMinutes(corps.startTime) : null, endMin: corps.endTime ? enMinutes(corps.endTime) : null };
        const memeQuand = (b) => (corps.recurrence === 'once' ? b.recurrence !== 'weekly' && b.date === corps.date : b.recurrence === 'weekly' && Number(b.dayOfWeek) === corps.dayOfWeek && (b.dateFrom || null) === (corps.dateFrom || null) && (b.dateUntil || null) === (corps.dateUntil || null));
        const deja = (await ctx.lire('centreFermetures')).find((b) => b.scopeType === scopeType && String(b.scopeRef || '') === String(scopeRef || '') && memeQuand(b) && b.startMin === bloc.startMin && b.endMin === bloc.endMin);
        if (deja) throw erreur(`C’est déjà fermé : ${fermetureDite(deja)}.`);
        // Ce qui est deja reserve sur ce que la fermeture ferme (un jour, ou 180 jours de semaines) : elle
        // n annule rien, la carte le dit.
        const debut = corps.recurrence === 'once' ? corps.date : (corps.dateFrom && corps.dateFrom > aujourdhui ? corps.dateFrom : aujourdhui);
        const finLue = corps.recurrence === 'once' ? corps.date : (corps.dateUntil && corps.dateUntil < plusJours(aujourdhui, 180) ? corps.dateUntil : plusJours(aujourdhui, 180));
        const touches = debut <= finLue ? (await ctx.lire('centreReservations', debut, finLue)).filter((x) => (corps.recurrence === 'once' ? x.date === corps.date : jourDe(x.date) === corps.dayOfWeek) && dossierTouche(x, bloc)) : [];
        const heures = corps.startTime ? `de ${corps.startTime} à ${heureDite(corps.endTime)}` : 'toute la journée';
        return {
          corps,
          texte: `Fermer ${vise} ${quand}, ${heures}.`,
          lignes: [
            { libelle: 'Ce qui ferme', valeur: vise.charAt(0).toUpperCase() + vise.slice(1) },
            { libelle: 'Quand', valeur: quand },
            { libelle: 'Heures', valeur: heures },
            ...(corps.reason ? [{ libelle: 'Motif', valeur: corps.reason }] : []),
            { libelle: 'Réservation en ligne', avant: 'ouverte', apres: 'fermée' },
            { libelle: 'Déjà réservé', valeur: touches.length ? `${avecPluriel(touches.length, 'réservation', 'réservations')} (${listeDite(touches)})` : 'aucune réservation' },
          ],
          clients: 'Tout de suite, le formulaire en ligne ne propose plus ce qui ferme. Les réservations déjà prises ne sont pas annulées.',
          alerte: touches.length ? `${avecPluriel(touches.length, 'réservation est déjà prise', 'réservations sont déjà prises')} sur ce qui ferme (${listeDite(touches)}) : la fermeture ne les annule pas. Prévenez ces clients ou déplacez-les.` : null,
          fait: `C’est fermé : ${vise}, ${quand}, ${heures}.`,
        };
      },
    },

    supprimer_fermeture: {
      domaine: 'Établissement', titre: 'Fermeture retirée', verbe: 'Retirer la fermeture', cours: 'Retrait…', confirmer: 'Oui, rouvrir',
      quoi: 'retire une fermeture programmée : ce qu’elle fermait se réserve de nouveau',
      parametres: { fermeture: 'sa date AAAA-MM-JJ, ou ce qu’elle ferme (« chaque lundi », « piste 3 »), comme horaires_et_fermetures la montre' },
      action: 'deleteAvailabilityBlock', permission: 'settings.manage', risque: true, demande: DEMANDE_ROUVRIR,
      async preparer(p, ctx) {
        const blocs = await ctx.lire('centreFermetures');
        if (!blocs.length) throw erreur('Ce centre n’a aucune fermeture programmée.');
        const noms = {};
        if (blocs.some((b) => b.scopeType === 'activity')) noms.activites = new Map((await ctx.lire('centreActivitesVendues')).map((a) => [a.id, a.name]));
        if (blocs.some((b) => b.scopeType === 'formula')) noms.formules = new Map((await ctx.lire('catalogue')).map((f) => [f.id, nomFormule(f)]));
        const decrits = blocs.map((b) => ({ ...b, dit: fermetureDite(b, noms) }));
        const b = trouver(decrits, p.fermeture, { quoi: 'la fermeture', nom: (x) => x.dit, id: (x) => String(x.id) });
        return {
          corps: { id: b.id },
          texte: `Retirer la fermeture : ${b.dit}.`,
          lignes: [{ libelle: 'Fermeture', valeur: b.dit }, { libelle: 'Cette fermeture', avant: 'en place', apres: 'retirée' }],
          clients: 'Le formulaire en ligne propose de nouveau ce qu’elle fermait, tout de suite, si rien d’autre ne le ferme.',
          fait: `La fermeture est retirée : ${b.dit}.`,
        };
      },
    },

    retirer_horaires_du_jour: {
      domaine: 'Établissement', titre: 'Horaires du jour retirés', verbe: 'Revenir aux horaires habituels', cours: 'Enregistrement…', confirmer: 'Oui, revenir aux horaires habituels',
      quoi: 'retire les horaires à part posés pour un jour précis (horaires_du_jour de proposer_un_geste) : l’équipe retrouve ce jour-là les horaires habituels',
      parametres: { date: 'AAAA-MM-JJ' },
      action: 'ouvertureExceptionnelle', permission: 'reservations.create', risque: true, demande: DEMANDE_RETIRER_HORAIRES,
      async preparer(p, ctx) {
        // Le niveau « forcer » que la sauvegarde exige (lib/ouverture-exceptionnelle.js poserOuverture).
        require('./droits-reservation').exigerOuverture(ctx.session);
        const r = await reglages(ctx);
        const date = await dateAVenir(ctx, p.date);
        const ligne = (r.config.ouverturesExceptionnelles || []).find((x) => x.date === date);
        if (!ligne) throw erreur(`Le ${dateDite(date)} n’a pas d’horaires à part : il suit déjà les horaires habituels.`);
        const habituel = require('./booking-config').getSchedule(date, { defaultSchedule: r.config.defaultSchedule, holidaySettings: r.config.holidaySettings });
        // Le refus du logiciel, tel quel : un groupe hors des horaires habituels empeche d y revenir.
        try {
          require('./ouverture-exceptionnelle').controlerLaPlage(await ctx.lire('centreReservations', date, date), habituel);
        } catch (e) {
          throw erreur(e.message, 409);
        }
        return {
          corps: { date, retirer: true },
          texte: `Rendre au ${dateDite(date)} ses horaires habituels.`,
          lignes: [{ libelle: 'Jour', valeur: dateDite(date) }, { libelle: 'Horaires de l’équipe', avant: `${plageDite(ligne)}${ligne.motif ? ` (${coupe(ligne.motif, 60)})` : ''}`, apres: habituel ? `${habituel.label}, les horaires habituels` : 'fermé, comme d’habitude' }],
          clients: null,
          fait: `Le ${dateDite(date)} suit de nouveau les horaires habituels.`,
        };
      },
    },

    // ── Le centre lui-même ──
    regler_seuil_demande_sur_mesure: {
      domaine: 'Établissement', titre: 'Demande sur mesure obligatoire', verbe: 'Enregistrer le seuil', cours: 'Enregistrement…', confirmer: 'Oui, appliquer ce seuil',
      quoi: 'règle à partir de combien de personnes un groupe ne réserve plus en ligne et envoie une demande sur mesure, ou « jamais »',
      parametres: { a_partir_de: 'de 2 à 240 personnes, ou « jamais »' },
      action: 'saveCenterConfig', permission: 'settings.manage', risque: true, demande: DEMANDE_SEUIL,
      async preparer(p, ctx) {
        const r = await reglages(ctx);
        const avant = r.config.customRequest ? r.config.customRequest.fromPax : null;
        // Les bornes de la sauvegarde (lib/center-config.js normalizeCustomRequest) : 2 a 240, ou jamais.
        const seuil = /jamais|aucun|sans|personne/.test(sans(p.a_partir_de)) ? null : nombre(p.a_partir_de, { min: 2, max: 240, quoi: 'Le seuil', entier: true });
        if (seuil === avant) throw erreur(seuil == null ? 'Aucun groupe n’est déjà envoyé vers la demande sur mesure.' : `Le seuil est déjà de ${seuil} personnes.`);
        const dit = (n) => (n == null ? 'jamais' : `dès ${n} personnes`);
        return {
          corps: { config: { customRequest: { fromPax: seuil } } },
          texte: seuil == null ? 'Laisser tous les groupes réserver en ligne.' : `Envoyer les groupes de ${seuil} personnes et plus vers la demande sur mesure.`,
          lignes: [{ libelle: 'Demande sur mesure obligatoire', avant: dit(avant), apres: dit(seuil) }],
          clients: seuil == null ? 'Tout de suite, tous les groupes réservent de nouveau en ligne.' : `Tout de suite, un groupe de ${seuil} personnes ou plus ne réserve plus en ligne : le formulaire l’envoie vers la demande sur mesure.`,
          fait: `La demande sur mesure est obligatoire ${dit(seuil)}.`,
        };
      },
    },

    regler_retard_accueil: {
      domaine: 'Établissement', titre: 'Retard à l’accueil', verbe: 'Enregistrer', cours: 'Enregistrement…',
      quoi: 'règle après combien de minutes sans arrivée pointée un groupe passe « En retard » dans la console',
      parametres: { minutes: 'de 0 à 60' },
      action: 'saveCenterConfig', permission: 'settings.manage', risque: false,
      async preparer(p, ctx) {
        const r = await reglages(ctx);
        const avant = Number(r.config.accueil && r.config.accueil.lateThresholdMinutes);
        // Les bornes de la sauvegarde (lib/center-config.js normalizeAccueil) : 0 a 60 minutes.
        const minutes = nombre(p.minutes, { min: 0, max: 60, quoi: 'Le nombre de minutes', entier: true });
        if (minutes === avant) throw erreur(`Un groupe passe déjà « En retard » après ${minutes} minutes.`);
        const dit = (n) => (n === 0 ? 'dès la minute pile' : `après ${n} minute${n > 1 ? 's' : ''}`);
        return {
          corps: { config: { accueil: { lateThresholdMinutes: minutes } } },
          texte: `Passer un groupe « En retard » ${dit(minutes)}.`,
          lignes: [{ libelle: 'En retard', avant: dit(avant), apres: dit(minutes) }],
          clients: null,
          fait: `Un groupe passe maintenant « En retard » ${dit(minutes)}.`,
        };
      },
    },

    changer_statut_centre: {
      domaine: 'Établissement', titre: 'Statut du centre', verbe: 'Changer le statut', cours: 'Enregistrement…', confirmer: 'Oui, changer le statut', danger: true,
      quoi: 'change le statut du centre : ouvert (il prend les réservations en ligne), prévu ou archivé (ses réservations en ligne se coupent)',
      parametres: { statut: 'ouvert, prévu ou archivé' },
      action: 'setCenterStatus', permission: 'settings.manage', risque: true, demande: DEMANDE_STATUT,
      async preparer(p, ctx) {
        const r = await reglages(ctx);
        const cle = sans(p.statut);
        const statut = /archiv|closed|definiti/.test(cle) ? 'closed' : /prevu|planned|prepar|pas encore|bientot/.test(cle) ? 'planned' : /ouvert|actif|active|rouvr|reouvr/.test(cle) ? 'active' : '';
        if (!statut) throw erreur('Dites le statut : ouvert, prévu ou archivé.');
        if (statut === r.statut) throw erreur(`Le centre est déjà ${STATUTS[statut]}.`);
        const coupee = statut !== 'active';
        let alerte = null;
        if (coupee) {
          const aujourdhui = await ctx.lire('centreAujourdhui');
          const aVenir = await ctx.lire('centreReservations', aujourdhui, plusJours(aujourdhui, 365));
          if (aVenir.length) alerte = `${avecPluriel(aVenir.length, 'réservation à venir reste prise', 'réservations à venir restent prises')} : le statut ne les annule pas. Prévenez ces clients.`;
        }
        return {
          corps: { status: statut },
          texte: `Passer ${r.nom || 'le centre'} en « ${STATUTS[statut]} ».`,
          lignes: [{ libelle: 'Centre', valeur: r.nom || r.id }, { libelle: 'Statut', avant: STATUTS[r.statut] || r.statut, apres: STATUTS[statut] }, { libelle: 'Réservation en ligne', avant: r.statut === 'active' ? 'ouverte' : 'coupée', apres: coupee ? 'coupée' : 'ouverte' }],
          clients: coupee ? 'Tout de suite, le formulaire en ligne de ce centre refuse les nouvelles réservations.' : 'Tout de suite, le formulaire en ligne de ce centre prend de nouveau les réservations.',
          alerte,
          fait: `${r.nom || 'Le centre'} est maintenant ${STATUTS[statut]}.`,
        };
      },
    },

    renommer_centre: {
      domaine: 'Établissement', titre: 'Nom du centre', verbe: 'Renommer', cours: 'Enregistrement…', confirmer: 'Oui, renommer le centre',
      quoi: 'change le nom de ce centre, tel que les clients et l’équipe le lisent (jamais un nouveau centre)',
      parametres: { nom: 'le nouveau nom, 120 caractères au plus' },
      action: 'saveCenter', permission: 'settings.manage', risque: true, demande: DEMANDE_NOM_CENTRE,
      async preparer(p, ctx) {
        const r = await reglages(ctx);
        const nom = String(p.nom == null ? '' : p.nom).replace(/\s+/g, ' ').trim();
        // Les bornes de la sauvegarde (lib/center-config.js upsertCenter : 1 a 120 caracteres), sans balise.
        if (!nom || nom.length > 120) throw erreur('Donnez un nom de 1 à 120 caractères.');
        if (/[<>]/.test(nom)) throw erreur('Le nom ne peut pas contenir < ou >.');
        if (nom === r.nom) throw erreur(`Le centre s’appelle déjà « ${r.nom} ».`);
        return {
          // Le statut et le fuseau repartent tels qu ils sont : upsertCenter remettrait sinon « ouvert » et
          // Bruxelles, et renommer un centre prevu l ouvrirait a la reservation en ligne.
          corps: { center: { id: r.id, name: nom, status: r.statut, timezone: r.fuseau } },
          texte: `Renommer le centre « ${r.nom} » en « ${nom} ».`,
          lignes: [{ libelle: 'Nom du centre', avant: r.nom || r.id, apres: nom }],
          clients: 'Les clients lisent le nouveau nom tout de suite, sur le formulaire en ligne et dans les mails.',
          fait: `Le centre s’appelle maintenant « ${nom} ».`,
        };
      },
    },

    coordonnees_du_centre: {
      domaine: 'Établissement', titre: 'Coordonnées du centre', verbe: 'Enregistrer', cours: 'Enregistrement…', confirmer: 'Oui, enregistrer',
      quoi: 'change ce que les clients lisent du centre : adresse, téléphone, parking, adresse du site, logo (le mail du centre ne se change pas ici)',
      parametres: { adresse: 'facultatif, 200 caractères au plus', telephone: 'facultatif : chiffres, espaces et + ( ) . / -', parking: 'facultatif, 60 caractères au plus', site: 'facultatif : l’adresse entière du site, en https://', logo: 'facultatif : l’adresse https:// du logo', logo_sur_fond_sombre: 'facultatif : oui si le logo est clair et demande un fond sombre' },
      action: 'saveCenterConfig', permission: 'settings.manage', risque: true, demande: DEMANDE_COORDONNEES,
      async preparer(p, ctx) {
        const CC = require('./center-config');
        const r = await reglages(ctx);
        const demandes = ['adresse', 'telephone', 'parking', 'site', 'logo', 'logo_sur_fond_sombre'].filter((k) => rempli(p[k]));
        if (!demandes.length) throw erreur('Dites ce qui change : adresse, téléphone, parking, site ou logo.');
        const config = {};
        const lignes = [];
        const infos = r.config.publicInfo || {};
        [['adresse', 'address', 'Adresse'], ['telephone', 'phone', 'Téléphone'], ['parking', 'parking', 'Parking']].forEach(([param, cle, libelle]) => {
          if (!rempli(p[param])) return;
          // La validation stricte de la sauvegarde (lib/center-config.js normalizePublicInfo).
          const lu = CC.normalizePublicInfo({ [cle]: String(p[param]) }, { strict: true })[cle];
          if (!lu) throw erreur(`${libelle} : donnez une valeur.`);
          if ((infos[cle] || '') === lu) return;
          config.publicInfo = { ...(config.publicInfo || {}), [cle]: lu };
          lignes.push({ libelle, avant: infos[cle] || 'aucun', apres: lu });
        });
        const identite = r.config.identity || {};
        if (rempli(p.site)) {
          const lu = CC.normalizeIdentity({ siteUrl: String(p.site).trim() });
          if (!lu || !lu.siteUrl) throw erreur('L’adresse du site s’écrit en entier, avec https://, 300 caractères au plus.');
          if (lu.siteUrl !== identite.siteUrl) {
            config.identity = { ...(config.identity || {}), siteUrl: lu.siteUrl };
            lignes.push({ libelle: 'Site', avant: identite.siteUrl || 'aucun', apres: lu.siteUrl });
          }
        }
        if (rempli(p.logo)) {
          const lu = CC.normalizeIdentity({ logoUrl: String(p.logo).trim() });
          if (!lu || !lu.logoUrl) throw erreur('Le logo se donne par son adresse https://, 300 caractères au plus.');
          if (lu.logoUrl !== identite.logoUrl) {
            config.identity = { ...(config.identity || {}), logoUrl: lu.logoUrl };
            lignes.push({ libelle: 'Logo', avant: identite.logoUrl || 'aucun', apres: lu.logoUrl });
          }
        }
        if (rempli(p.logo_sur_fond_sombre)) {
          const sombre = booleen(p.logo_sur_fond_sombre, 'le fond du logo');
          if (sombre !== Boolean(identite.logoOnDark)) {
            config.identity = { ...(config.identity || {}), logoOnDark: sombre };
            lignes.push({ libelle: 'Fond du logo', avant: identite.logoOnDark ? 'sombre' : 'clair', apres: sombre ? 'sombre' : 'clair' });
          }
        }
        if (!lignes.length) throw erreur('Ce sont déjà les coordonnées du centre.');
        return {
          corps: { config },
          texte: `Changer ${lignes.map((l) => l.libelle.toLowerCase()).join(', ')} du centre.`,
          lignes,
          clients: 'Les clients lisent ces coordonnées tout de suite, sur le formulaire en ligne et dans les mails.',
          fait: 'Les coordonnées du centre sont enregistrées.',
        };
      },
    },

    couper_ou_remettre_formulaire_site: {
      domaine: 'Établissement', titre: 'Formulaire du site du centre', verbe: 'Appliquer', cours: 'Enregistrement…', confirmer: 'Oui, appliquer sur le site',
      quoi: 'coupe le formulaire Pinlane installé sur le site du centre et rend l’ancien formulaire du site, ou remet le formulaire Pinlane',
      parametres: { actif: 'oui pour le formulaire Pinlane sur le site, non pour rendre l’ancien formulaire' },
      action: 'setEmbedState', permission: 'settings.manage', risque: true, demande: DEMANDE_FORMULAIRE_SITE,
      async preparer(p, ctx) {
        const r = await reglages(ctx);
        const actif = booleen(p.actif, 'le formulaire du site');
        const avant = !(r.config.embed && r.config.embed.actif === false);
        if (avant === actif) throw erreur(actif ? 'Le site du centre montre déjà le formulaire Pinlane.' : 'Le site du centre montre déjà son ancien formulaire.');
        const dit = (on) => (on ? 'le formulaire Pinlane' : 'l’ancien formulaire du site');
        return {
          corps: { actif },
          texte: actif ? 'Remettre le formulaire Pinlane sur le site du centre.' : 'Couper le formulaire Pinlane et rendre l’ancien formulaire du site.',
          lignes: [{ libelle: 'Sur le site du centre', avant: dit(avant), apres: dit(actif) }],
          clients: `Les visiteurs du site du centre voient ${dit(actif)} dans la minute.`,
          fait: actif ? 'Le formulaire Pinlane est de retour sur le site du centre.' : 'Le site du centre a retrouvé son ancien formulaire.',
        };
      },
    },

    boite_de_secours: {
      domaine: 'Établissement', titre: 'Boîte de secours', verbe: 'Enregistrer', cours: 'Enregistrement…', confirmer: 'Oui, enregistrer',
      quoi: 'ajoute ou retire une adresse de la boîte de secours, qui reçoit la copie complète de chaque réservation, demande et feuille du jour (5 adresses au plus). L’adresse à ajouter doit être écrite par la personne elle-même',
      parametres: { ajouter: 'facultatif : l’adresse e-mail à ajouter', retirer: 'facultatif : l’adresse e-mail à retirer' },
      action: 'saveCenterConfig', permission: 'settings.manage', risque: true, demande: DEMANDE_SECOURS,
      async preparer(p, ctx) {
        const r = await reglages(ctx);
        const avant = (r.config.secours && Array.isArray(r.config.secours.emails)) ? r.config.secours.emails : [];
        let suite = [...avant];
        if (!rempli(p.ajouter) && !rempli(p.retirer)) throw erreur('Dites l’adresse à ajouter ou à retirer.');
        if (rempli(p.ajouter)) {
          const a = adresseDeSecours(p.ajouter);
          // Les copies portent les donnees des clients : une adresse ne nait que des mots de la personne,
          // jamais d un mail ou d une note qui la donnerait (au clic, la personne la relit sur sa carte).
          const dits = (ctx.messagesPersonne || []).slice(-2).map((t) => String(t || '').toLowerCase());
          if (dits.length && !dits.some((t) => t.includes(a))) throw erreur('Cette adresse doit être écrite par la personne elle-même dans son message.', 403);
          if (suite.includes(a)) throw erreur(`${a} reçoit déjà les copies de secours.`);
          if (suite.length >= 5) throw erreur('La boîte de secours a déjà 5 adresses, le maximum : retirez-en une d’abord.');
          suite.push(a);
        }
        if (rempli(p.retirer)) {
          const a = String(p.retirer).trim().toLowerCase();
          if (!suite.includes(a)) throw erreur(`${coupe(p.retirer, 80)} n’est pas dans la boîte de secours.${avant.length ? ` Elle compte : ${avant.join(', ')}.` : ' Elle est vide.'}`);
          suite = suite.filter((x) => x !== a);
        }
        return {
          // La boite se remplace en bloc a la sauvegarde (lib/center-config.js REMPLACES_EN_BLOC) : elle part entiere.
          corps: { config: { secours: { emails: suite } } },
          texte: 'Changer les adresses de la boîte de secours.',
          lignes: [{ libelle: 'Boîte de secours', avant: avant.join(', ') || 'vide', apres: suite.join(', ') || 'vide' }],
          clients: null,
          alerte: rempli(p.ajouter) ? 'Chaque réservation, demande et feuille du jour partira en copie complète vers cette adresse, coordonnées des clients comprises : vérifiez qu’elle est bien à vous.' : null,
          fait: 'La boîte de secours est enregistrée.',
        };
      },
    },

    // ── Prix et formules du centre ──
    modifier_grilles_prix_centre: {
      domaine: 'Prix', titre: 'Grille de prix du centre', verbe: 'Publier le nouveau prix', cours: 'Publication…', confirmer: 'Oui, publier ce prix',
      quoi: 'change une case de la grille de prix de ce centre : le bowling à la durée (prix de la piste), le laser à la partie (par personne) ou le Fun Run à la durée',
      parametres: { grille: 'bowling, laser ou fun run', case: 'la case, comme catalogue_et_tarifs la nomme : « 1 heure », « 2 parties », « 30 min »', prix: 'le nouveau prix en euros, plus de 0 et 1000 au plus' },
      action: 'saveGrillesTarif', permission: 'pricing.manage', risque: true, demande: DEMANDE_PRIX,
      async preparer(p, ctx) {
        const r = await reglages(ctx);
        const cle = sans(p.grille);
        const nomGrille = /bowl|piste/.test(cle) ? 'bowling' : /laser/.test(cle) ? 'laser' : /fun|run/.test(cle) ? 'funRun' : '';
        if (!nomGrille) throw erreur('Dites la grille : bowling, laser ou fun run.');
        const g = GRILLES[nomGrille];
        // Un centre qui vend son bowling a la partie n a pas de grille a la duree (resources.bowling.pricing).
        if (nomGrille === 'bowling' && r.config.resources && r.config.resources.bowling && r.config.resources.bowling.pricing) throw erreur('Ce centre vend son bowling à la partie : ce prix se change dans Tarifs & formules.');
        const options = require('./booking-config').grillesEffectives(r.config.grillesTarif)[g.options];
        const o = trouver(options.map((x) => ({ ...x, id: g.cle(x), name: x.label })), p.case, { quoi: `la case de la grille ${g.nom}` });
        // Les bornes du logiciel (lib/booking-config.js prixDeGrille) : plus de 0 €, 1000 € au plus.
        const prix = nombre(p.prix, { min: 0, max: 1000, quoi: 'Le prix' });
        if (!(prix > 0)) throw erreur('Un prix de grille est de plus de 0 € : une case à 0 € serait refusée au client.');
        if (prix === Number(o.price)) throw erreur(`${g.nom}, ${o.label} est déjà à ${euros(prix)}.`);
        return {
          corps: { grilles: { [nomGrille]: { [o.id]: prix } } },
          texte: `Passer ${g.nom}, ${o.label} à ${euros(prix)}.`,
          lignes: [{ libelle: 'Grille', valeur: `${g.nom} (${g.unite})` }, { libelle: o.label, avant: euros(o.price), apres: euros(prix) }],
          clients: 'Le nouveau prix se voit tout de suite sur le formulaire en ligne de ce centre. Les réservations déjà prises gardent leur prix.',
          fait: `${g.nom}, ${o.label} est maintenant à ${euros(prix)}.`,
        };
      },
    },

    modifier_prix_activite: {
      domaine: 'Prix', titre: 'Prix d’une activité', verbe: 'Publier le nouveau prix', cours: 'Publication…', confirmer: 'Oui, publier dans tous vos centres',
      quoi: 'change le prix d’une activité du catalogue (minigolf, arcades…) : le catalogue appartient à la société, le prix change dans TOUS ses centres. Le bowling et le laser se vendent à la grille : modifier_grilles_prix_centre',
      parametres: { activite: 'son nom, lu dans catalogue_et_tarifs', prix: 'le nouveau prix en euros, de 0 à 1000' },
      action: 'updateActivity', permission: 'settings.manage', risque: true, demande: DEMANDE_PRIX,
      async preparer(p, ctx) {
        exigerTarifs(ctx, 'le prix d’une activité');
        const a = trouver(await ctx.lire('centreActivites'), p.activite, { quoi: 'l’activité' });
        if (a.priceType === 'grid_bowling' || a.priceType === 'grid_laser') throw erreur(`« ${a.name} » se vend à la grille du centre : changez la case avec modifier_grilles_prix_centre.`);
        if (a.priceType === 'on_site' || a.priceValue == null) throw erreur(`« ${a.name} » se règle sur place, sans prix en ligne : son type de tarif se change dans Tarifs & formules.`);
        // La borne de l editeur d activites (assets/staff-pages-v2.js aevSetPrice : 0 a 1000 €), plus
        // stricte que celle de la base (lib/catalog-store.js validateActivityPrice : 100 000 €).
        const prix = nombre(p.prix, { min: 0, max: 1000, quoi: 'Le prix' });
        if (prix === Number(a.priceValue)) throw erreur(`« ${a.name} » est déjà à ${euros(prix)}.`);
        const unite = a.priceUnit ? ` ${a.priceUnit}` : '';
        return {
          corps: { id: a.id, patch: { priceValue: prix } },
          texte: `Passer « ${a.name} » à ${euros(prix)}${unite}, dans tous vos centres.`,
          lignes: [{ libelle: 'Activité', valeur: a.name }, { libelle: `Prix${unite}`, avant: euros(a.priceValue), apres: euros(prix) }, { libelle: 'Où', valeur: 'dans tous vos centres, car le catalogue appartient à la société' }],
          clients: 'Le nouveau prix se voit tout de suite sur le formulaire en ligne, dans tous vos centres. Les réservations déjà prises gardent leur prix.',
          fait: `« ${a.name} » est maintenant à ${euros(prix)}, dans tous vos centres.`,
        };
      },
    },

    afficher_masquer_formule_formulaire: {
      domaine: 'Prix', titre: 'Formule dans Offres & formules', verbe: 'Appliquer', cours: 'Enregistrement…', confirmer: 'Oui, appliquer',
      quoi: 'coche ou décoche une formule dans la page Établissement › Offres & formules : décochée, elle ne se réserve plus en ligne dans ce centre. Autre interrupteur que formule_en_vente (Tarifs & formules) : la carte dit si celui-là la cache encore',
      parametres: { formule: 'son nom, lu dans catalogue_et_tarifs', proposee: 'oui pour la cocher, non pour la décocher' },
      action: 'saveCenterConfig', permission: 'settings.manage', risque: true, demande: DEMANDE_OFFRE,
      async preparer(p, ctx) {
        const f = trouver(await ctx.lire('catalogue'), p.formule, { quoi: 'la formule', nom: nomFormule });
        // Une cle hors de ce motif serait jetee sans un mot a la sauvegarde (lib/center-config.js normalizeOfferAvailability).
        if (!/^[a-z0-9_-]{1,40}$/i.test(String(f.id))) throw erreur(`« ${nomFormule(f)} » ne se règle pas dans Offres & formules : utilisez formule_en_vente.`);
        const r = await reglages(ctx);
        const voulue = booleen(p.proposee, 'la formule');
        const avant = (r.config.offerAvailability || {})[f.id] !== false;
        if (avant === voulue) throw erreur(`« ${nomFormule(f)} » est déjà ${voulue ? 'cochée' : 'décochée'} dans Offres & formules.`);
        const enVente = !(f.effective && f.effective.enabled === false);
        const coche = (on) => (on ? 'cochée' : 'décochée');
        return {
          corps: { config: { offerAvailability: { [f.id]: voulue } } },
          texte: `${voulue ? 'Cocher' : 'Décocher'} « ${nomFormule(f)} » dans Offres & formules.`,
          lignes: [{ libelle: 'Formule', valeur: nomFormule(f) }, { libelle: 'Offres & formules', avant: coche(avant), apres: coche(voulue) }, { libelle: 'Réservable en ligne', avant: avant && enVente ? 'oui' : 'non', apres: voulue && enVente ? 'oui' : 'non' }],
          clients: voulue ? (enVente ? 'Les clients la retrouvent tout de suite sur le formulaire en ligne.' : null) : 'Tout de suite, elle ne se réserve plus en ligne dans ce centre. Les réservations déjà prises ne bougent pas.',
          alerte: voulue && !enVente ? 'Elle reste retirée de la vente dans Tarifs & formules : remettez-la en vente aussi pour que les clients la voient.' : null,
          fait: `« ${nomFormule(f)} » est ${coche(voulue)} dans Offres & formules.`,
        };
      },
    },

    retirer_formule: {
      domaine: 'Prix', titre: 'Formule retirée du catalogue', verbe: 'Retirer du catalogue', cours: 'Retrait…', confirmer: 'Oui, retirer de tous vos centres', danger: true,
      quoi: 'retire une formule du catalogue de la société : elle disparaît du formulaire de TOUS ses centres. Pour la retirer de ce centre seulement : formule_en_vente',
      parametres: { formule: 'son nom, lu dans catalogue_et_tarifs' },
      action: 'deleteFormula', permission: 'settings.manage', risque: true, demande: DEMANDE_SUPPRIMER,
      async preparer(p, ctx) {
        const f = trouver(await ctx.lire('catalogue'), p.formule, { quoi: 'la formule', nom: nomFormule });
        if (require('./formule-comptoir').centreDeLaFormule(f.id)) throw erreur(`« ${nomFormule(f)} » est une formule gardée au comptoir : retirez-la avec retirer_formule_du_comptoir.`);
        return {
          corps: { id: f.id },
          texte: `Retirer « ${nomFormule(f)} » du catalogue, dans tous vos centres.`,
          lignes: [{ libelle: 'Formule', valeur: nomFormule(f) }, { libelle: 'Catalogue', avant: 'dans tous vos centres', apres: 'retirée de tous vos centres' }],
          clients: 'Tout de suite, elle disparaît du formulaire en ligne de tous vos centres. Les réservations déjà prises gardent leur formule.',
          alerte: 'Elle quitte le catalogue de la société, pas seulement ce centre.',
          fait: `« ${nomFormule(f)} » est retirée du catalogue.`,
        };
      },
    },

    formule_du_comptoir_en_ligne: {
      domaine: 'Prix', titre: 'Formule du comptoir en ligne', verbe: 'Appliquer', cours: 'Enregistrement…', confirmer: 'Oui, appliquer',
      quoi: 'montre aux clients en ligne une formule gardée au comptoir de ce centre, ou la remet au comptoir seulement',
      parametres: { formule: 'son nom, lu dans catalogue_et_tarifs', en_ligne: 'oui pour la montrer aux clients, non pour la garder au comptoir' },
      action: 'afficherFormuleSurMesure', permission: 'pricing.manage', risque: true, demande: DEMANDE_COMPTOIR,
      async preparer(p, ctx) {
        const FC = require('./formule-comptoir');
        const gardees = (await ctx.lire('catalogue')).filter((x) => FC.estFormuleDuCentre(x.id, ctx.centre));
        if (!gardees.length) throw erreur('Ce centre n’a aucune formule gardée au comptoir.');
        const f = trouver(gardees, p.formule, { quoi: 'la formule du comptoir', nom: nomFormule });
        const voulue = booleen(p.en_ligne, 'la formule');
        const lu = (f.effective && f.effective.humanValidation) || (f.base && f.base.humanValidation) || null;
        const avant = lu !== FC.MODE_COMPTOIR;
        if (avant === voulue) throw erreur(`« ${nomFormule(f)} » est déjà ${voulue ? 'montrée aux clients en ligne' : 'au comptoir seulement'}.`);
        const dit = (on) => (on ? 'au comptoir et en ligne' : 'au comptoir seulement');
        return {
          corps: { id: f.id, clients: voulue },
          texte: voulue ? `Montrer « ${nomFormule(f)} » aux clients en ligne.` : `Garder « ${nomFormule(f)} » au comptoir seulement.`,
          lignes: [{ libelle: 'Formule', valeur: nomFormule(f) }, { libelle: 'Où elle se vend', avant: dit(avant), apres: dit(voulue) }],
          clients: voulue ? 'Les clients la voient tout de suite sur le formulaire en ligne.' : 'Tout de suite, elle quitte le formulaire en ligne. Les réservations déjà prises ne bougent pas.',
          fait: `« ${nomFormule(f)} » se vend maintenant ${dit(voulue)}.`,
        };
      },
    },

    retirer_formule_du_comptoir: {
      domaine: 'Prix', titre: 'Formule du comptoir retirée', verbe: 'Retirer la formule', cours: 'Retrait…', confirmer: 'Oui, retirer', danger: true,
      quoi: 'retire une formule gardée au comptoir de ce centre',
      parametres: { formule: 'son nom, lu dans catalogue_et_tarifs' },
      action: 'retirerFormuleSurMesure', permission: 'pricing.manage', risque: true, demande: DEMANDE_SUPPRIMER,
      async preparer(p, ctx) {
        const FC = require('./formule-comptoir');
        const gardees = (await ctx.lire('catalogue')).filter((x) => FC.estFormuleDuCentre(x.id, ctx.centre));
        if (!gardees.length) throw erreur('Ce centre n’a aucune formule gardée au comptoir.');
        const f = trouver(gardees, p.formule, { quoi: 'la formule du comptoir', nom: nomFormule });
        const auComptoir = ((f.effective && f.effective.humanValidation) || (f.base && f.base.humanValidation) || null) === FC.MODE_COMPTOIR;
        return {
          corps: { id: f.id },
          texte: `Retirer la formule du comptoir « ${nomFormule(f)} ».`,
          lignes: [{ libelle: 'Formule', valeur: nomFormule(f) }, { libelle: 'Au comptoir', avant: 'proposée', apres: 'retirée' }],
          clients: auComptoir ? null : 'Elle quitte aussi le formulaire en ligne, tout de suite.',
          alerte: 'Les réservations déjà prises gardent leur formule ; pour la revendre, il faudra la refaire au comptoir.',
          fait: `« ${nomFormule(f)} » est retirée.`,
        };
      },
    },

    modifier_offres_suggestions: {
      domaine: 'Prix', titre: 'Suggestions de fin de réservation', verbe: 'Appliquer', cours: 'Enregistrement…', confirmer: 'Oui, appliquer',
      quoi: 'allume ou coupe une suggestion proposée en fin de réservation en ligne (ou toutes), ou change sa remise',
      parametres: { offre: 'facultatif : son titre, lu dans catalogue_et_tarifs (offres de fin de réservation) ; sans offre, toutes les suggestions', active: 'facultatif : oui ou non', remise: 'facultatif, pour une offre : « 10 % », « 5 € par personne », « 20 € » ou « aucune »' },
      action: 'saveCenterConfig', permission: 'settings.manage', risque: true, demande: DEMANDE_SUGGESTIONS,
      async preparer(p, ctx) {
        // Les suggestions portent des remises : le droit « Tarifs » en plus de celui des reglages, que le
        // serveur ne demande pas pour saveCenterConfig.
        exigerTarifs(ctx, 'les remises des suggestions');
        const r = await reglages(ctx);
        const actuelles = r.config.upsellOffers;
        if (!actuelles) throw erreur('Ce centre n’a pas encore réglé ses suggestions : le moteur propose les siennes. Réglez-les d’abord dans la page Établissement.');
        const suite = { ...actuelles, offers: actuelles.offers.map((o) => ({ ...o })) };
        const lignes = [];
        let alerte = null;
        if (!rempli(p.offre)) {
          if (rempli(p.remise)) throw erreur('Une remise se pose sur une offre : dites laquelle.');
          const active = booleen(p.active, 'les suggestions');
          if (active === actuelles.enabled) throw erreur(`Les suggestions sont déjà ${active ? 'allumées' : 'coupées'}.`);
          suite.enabled = active;
          lignes.push({ libelle: 'Suggestions', avant: actuelles.enabled ? 'allumées' : 'coupées', apres: active ? 'allumées' : 'coupées' });
        } else {
          const o = trouver(suite.offers, p.offre, { quoi: 'l’offre', nom: (x) => x.title || x.id });
          lignes.push({ libelle: 'Offre', valeur: o.title || o.id });
          if (rempli(p.active)) {
            const active = booleen(p.active, 'l’offre');
            if (active !== o.enabled) { lignes.push({ libelle: 'État', avant: o.enabled ? 'allumée' : 'coupée', apres: active ? 'allumée' : 'coupée' }); o.enabled = active; }
          }
          if (rempli(p.remise)) {
            const remise = remiseLue(p.remise);
            if (remise.mode !== o.discount.mode || remise.value !== o.discount.value) { lignes.push({ libelle: 'Remise', avant: remiseDite(o.discount), apres: remiseDite(remise) }); o.discount = remise; }
          }
          if (lignes.length === 1) throw erreur(rempli(p.active) || rempli(p.remise) ? 'Cette offre est déjà ainsi.' : 'Dites ce qui change : active, remise, ou les deux.');
          if (o.enabled && !suite.enabled) alerte = 'Les suggestions sont coupées pour tout le centre : allumez-les aussi pour que celle-ci se voie.';
        }
        // La validation stricte de la sauvegarde (lib/upsell-offers.js normalizeUpsellOffers).
        require('./upsell-offers').normalizeUpsellOffers(suite, { strict: true });
        return {
          // Le tableau des offres part entier : la sauvegarde remplace un tableau en bloc.
          corps: { config: { upsellOffers: suite } },
          texte: `Changer les suggestions de fin de réservation : ${lignes.filter((l) => l.apres !== undefined).map((l) => `${l.libelle.toLowerCase()} ${l.apres}`).join(', ')}.`,
          lignes,
          clients: 'Les clients le voient tout de suite en fin de réservation en ligne. Les réservations déjà prises ne bougent pas.',
          alerte,
          fait: 'Les suggestions sont enregistrées.',
        };
      },
    },

    modifier_cartes_arcade: {
      domaine: 'Prix', titre: 'Cartes arcades', verbe: 'Publier', cours: 'Publication…', confirmer: 'Oui, publier',
      quoi: 'change le prix d’une carte arcades vendue en ligne (au temps ou à crédits), ou la propose ou la retire',
      parametres: { carte: 'son nom, lu dans catalogue_et_tarifs : « 30 minutes à volonté », « 25 crédits plus 10 offerts »', prix: 'facultatif : le nouveau prix en euros, 10 000 au plus', proposee: 'facultatif : oui ou non' },
      action: 'saveCenterConfig', permission: 'settings.manage', risque: true, demande: DEMANDE_CARTES,
      async preparer(p, ctx) {
        exigerTarifs(ctx, 'le prix des cartes arcades');
        const r = await reglages(ctx);
        const cartes = r.config.activityOffers && r.config.activityOffers.arcade_time;
        if (!cartes) throw erreur('Ce centre ne vend pas de cartes arcades en ligne.');
        const suite = { ...cartes, timeOffers: cartes.timeOffers.map((o) => ({ ...o })), creditOffers: cartes.creditOffers.map((o) => ({ ...o })) };
        const nomCarte = (o) => (o.minutes != null ? `${o.minutes} minutes à volonté` : `${o.credits} crédits${o.bonusCredits ? ` plus ${o.bonusCredits} offerts` : ''}`);
        const c = trouver([...suite.timeOffers, ...suite.creditOffers], p.carte, { quoi: 'la carte', nom: nomCarte });
        const lignes = [{ libelle: 'Carte', valeur: nomCarte(c) }];
        if (rempli(p.prix)) {
          // La borne du logiciel (lib/arcade-offers.js : un prix de 0 a 10 000 €).
          const prix = nombre(p.prix, { min: 0, max: 10000, quoi: 'Le prix' });
          if (prix !== c.price) { lignes.push({ libelle: 'Prix de la carte', avant: euros(c.price), apres: euros(prix) }); c.price = prix; }
        }
        if (rempli(p.proposee)) {
          const on = booleen(p.proposee, 'la carte');
          if (on !== c.enabled) { lignes.push({ libelle: 'En vente', avant: c.enabled ? 'oui' : 'non', apres: on ? 'oui' : 'non' }); c.enabled = on; }
        }
        if (lignes.length === 1) throw erreur(rempli(p.prix) || rempli(p.proposee) ? 'Cette carte est déjà ainsi.' : 'Dites ce qui change : le prix, ou si elle est proposée.');
        // La validation stricte de la sauvegarde (lib/arcade-offers.js normalizeArcadeOffers).
        require('./arcade-offers').normalizeArcadeOffers(suite, { centerId: ctx.centre, strict: true });
        return {
          // Les deux listes de cartes repartent entieres : la sauvegarde remplace un tableau en bloc.
          corps: { config: { activityOffers: { arcade_time: suite } } },
          texte: `Changer la carte arcades « ${nomCarte(c)} ».`,
          lignes,
          clients: 'Les clients le voient tout de suite sur le formulaire en ligne. Les réservations déjà prises gardent leur prix.',
          alerte: c.enabled && !suite.enabled ? 'Les cartes arcades sont coupées pour tout le centre : celle-ci ne se verra pas en ligne.' : null,
          fait: `La carte « ${nomCarte(c)} » est enregistrée.`,
        };
      },
    },

    modifier_catalogue_supplements: {
      domaine: 'Prix', titre: 'Supplément du catalogue sur mesure', verbe: 'Enregistrer', cours: 'Enregistrement…', confirmer: 'Oui, enregistrer',
      quoi: 'change le prix d’un supplément que l’équipe ajoute à un dossier (pizza, cruche, gâteau…), ou le propose ou le masque',
      parametres: { article: 'son nom, lu dans catalogue_et_tarifs (suppléments)', prix: 'facultatif : le prix en euros, 0 pour un prix à saisir au comptoir', propose: 'facultatif : oui ou non' },
      action: 'saveSurMesure', permission: 'pricing.manage', risque: true, demande: DEMANDE_SUPPLEMENTS,
      async preparer(p, ctx) {
        const CC = require('./center-config');
        const r = await reglages(ctx);
        const actuel = r.config.surMesure || CC.catalogueSurMesureParDefaut();
        const suite = { categories: actuel.categories.map((c) => ({ ...c })), articles: actuel.articles.map((a) => ({ ...a })) };
        const a = trouver(suite.articles, p.article, { quoi: 'le supplément', nom: (x) => x.nom });
        const lignes = [{ libelle: 'Supplément', valeur: a.nom }];
        const prixDit = (n) => (Number(n) === 0 ? 'prix à saisir' : euros(n));
        if (rempli(p.prix)) {
          // Les bornes de la sauvegarde (lib/center-config.js normalizeSurMesure : 0 a 100 000 €).
          const prix = nombre(p.prix, { min: 0, max: 100000, quoi: 'Le prix' });
          if (prix !== a.prix) { lignes.push({ libelle: 'Prix', avant: prixDit(a.prix), apres: prixDit(prix) }); a.prix = prix; }
        }
        if (rempli(p.propose)) {
          const on = booleen(p.propose, 'le supplément');
          if (on !== (a.actif !== false)) { lignes.push({ libelle: 'Proposé', avant: a.actif !== false ? 'oui' : 'non', apres: on ? 'oui' : 'non' }); a.actif = on; }
        }
        if (lignes.length === 1) throw erreur(rempli(p.prix) || rempli(p.propose) ? 'Ce supplément est déjà ainsi.' : 'Dites ce qui change : le prix, ou s’il est proposé.');
        CC.normalizeSurMesure(suite, { strict: true });
        return {
          // Le catalogue se remplace en bloc a la sauvegarde (lib/center-config.js REMPLACES_EN_BLOC) : il part entier.
          corps: { surMesure: suite },
          texte: `Changer le supplément « ${a.nom} ».`,
          lignes,
          clients: 'Le changement vaut tout de suite pour les suppléments que l’équipe ajoute aux dossiers.',
          fait: `Le supplément « ${a.nom} » est enregistré.`,
        };
      },
    },
  };
}

module.exports = { lecteurs, gestes, __test: { dateReelle, heureDite, plageDite } };
