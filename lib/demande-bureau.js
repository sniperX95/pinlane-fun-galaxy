'use strict';
// LE BUREAU DES DEMANDES SUR MESURE (console, 2026-09-29).
//
// Movsar, capture de sa propre demande de test a l appui : « les demandes sur
// mesures doivent bcp plus complete, un systeme bcp plus complet avec ia qui
// repond adapte [...] il doit y avoir toute les infos et ça doit etre bcp plus
// simple pour les utilisateurs a gerer ». La page n affichait que la date, le
// nombre et les coordonnees : tout ce que le client avait rempli (type de
// groupe, ages, moment, formules, activites, budget, facture) dormait en base.
//
// Ce module porte trois choses, chacune avec UNE source de verite :
//   1. L ECHEANCE. Le client a lu « reponse sous 24 heures ouvrables ». Les
//      heures des jours ou le centre est ferme ne comptent pas : c est le
//      calendrier du centre (grille, vacances, fermetures posees) qui decide.
//   2. L ETUDE. Ce que le moteur de reservation dit de la demande, a la date et
//      au moment voulus, pour l effectif du groupe : les formules choisies, la
//      visite des activites choisies, leurs prix et leurs heures de depart. La
//      porte est celle du formulaire public (la disponibilite publique),
//      appelee en interne par l appelant : aucun second moteur.
//   3. LA REPONSE. L IA redige a partir de la demande et de l etude. Chaque
//      chiffre de son texte doit exister dans les faits qu elle a recus, et le
//      texte doit passer la doctrine d ecriture client (lib/client-writing) :
//      rien n est reserve tant que le client n a pas dit oui. Sinon, un
//      brouillon ecrit par le code a partir des memes faits prend sa place, et
//      la console le dit. L IA n envoie rien : l equipe relit et envoie.
//
// Et le SUIVI : qui a pris la demande en charge, quelles reponses sont
// parties, quelle reservation en est nee, les notes de l equipe. Il vit dans
// custom_requests.payload.suivi (jsonb) : aucune migration, et la demande
// garde son histoire avec elle.

const surMesure = require('./custom-request');
const { verifierEcritureClient } = require('./client-writing');
const { jourDuCentre } = require('./center-facts');

const HEURES_PROMISES = 24;
const MAX_FORMULES_ETUDIEES = 3;
const MAX_HEURES_CITEES = 6;
const MAX_EVENEMENTS = 60;
const MAX_NOTES = 40;

// ---------------------------------------------------------------------------
// 1. L ECHEANCE
// ---------------------------------------------------------------------------
function lendemain(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function hhmm(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// L instant ou il est `minute` a Bruxelles le jour `iso`. Deux decalages
// possibles (heure d hiver, heure d ete) : on garde celui qui retombe sur
// l heure demandee.
function instantDeBruxelles(iso, minute) {
  const [y, m, d] = iso.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d) + minute * 60000;
  for (const decalage of [60, 120]) {
    const t = base - decalage * 60000;
    const local = jourDuCentre(t);
    if (local && local.date === iso && Math.round(local.heure * 60) === minute) return t;
  }
  return base - 60 * 60000;
}

// `jourOuvre(iso)` : le centre est-il ouvert ce jour-la ? Rend
// { date, heure, instant } en heure de Bruxelles, ou null quand soixante jours
// de suite sont fermes (on n invente pas une echeance).
function echeanceDeReponse(creeLe, { jourOuvre, heures = HEURES_PROMISES } = {}) {
  const t0 = new Date(creeLe).getTime();
  if (!Number.isFinite(t0) || typeof jourOuvre !== 'function') return null;
  const debut = jourDuCentre(t0);
  if (!debut) return null;
  let date = debut.date;
  let minute = Math.round(debut.heure * 60);
  let reste = Math.round(heures * 60);
  for (let n = 0; n < 60 && reste > 0; n += 1) {
    if (jourOuvre(date)) {
      const dispo = 1440 - minute;
      if (reste <= dispo) { minute += reste; reste = 0; break; }
      reste -= dispo;
    }
    date = lendemain(date);
    minute = 0;
  }
  if (reste > 0) return null;
  if (minute >= 1440) { date = lendemain(date); minute -= 1440; }
  return { date, heure: hhmm(minute), instant: new Date(instantDeBruxelles(date, minute)).toISOString() };
}

// Le calendrier du centre, comme le formulaire public le lit : une grille ce
// jour-la, et au moins une demi-heure qu aucune fermeture ne couvre.
function jourOuvreDuCentre({ center, blocks = [], getSchedule, isCenterClosedAt }) {
  return (iso) => {
    const schedule = getSchedule(iso, center);
    if (!schedule) return false;
    for (let v = Number(schedule.open); v < Number(schedule.close); v += 0.5) {
      if (!isCenterClosedAt(blocks, iso, Math.round(v * 60))) return true;
    }
    return false;
  };
}

// ---------------------------------------------------------------------------
// 2. L ETUDE
// ---------------------------------------------------------------------------
function demandeDe(item) {
  const d = item && item.payload && item.payload.demande;
  return d && typeof d === 'object' ? d : null;
}

function euros(n) {
  const v = Math.round(Number(n) * 100) / 100;
  return Number.isInteger(v) ? `${v} €` : `${v.toFixed(2).replace('.', ',')} €`;
}

function versMinutes(hm) {
  const [h, m] = String(hm || '').split(':').map(Number);
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

// La plage du moment voulu ce jour-la, en minutes ; toute la journee pour
// « peu importe » ou quand le moment n existe pas ce jour-la (l etude le dit).
function fenetreDuMoment(moment, schedule) {
  const jour = surMesure.momentsDuJour(schedule);
  if (!jour) return null;
  const m = jour[moment] || jour.indifferent;
  const plage = m && m.ok ? m : jour.indifferent;
  return { de: Math.round(plage.start * 60), a: Math.round(plage.end * 60), existe: Boolean(m && m.ok), raison: (m && m.raison) || '' };
}

// UNE PANNE N EST PAS UN REFUS. Le moteur repond 429 quand la console l a trop
// sollicite dans la minute, 5xx quand il tombe : l etude dit alors « a
// relancer », jamais « impossible ». Un « impossible » ecrit sur une panne
// ferait refuser au client une date ou il y a de la place.
const PANNE_DU_MOTEUR = 'Le moteur de réservation n’a pas répondu, relancez l’étude.';
function enPanne(r) {
  return !r || !r.json || r.status === 429 || Number(r.status) >= 500;
}

function dansLaFenetre(hm, fenetre) {
  const t = versMinutes(hm);
  return !fenetre || (t >= fenetre.de && t < fenetre.a);
}

function detailDeLigne(item, vagues) {
  const morceaux = [];
  if (Number(item.duration) > 0 && item.activityId === 'bowling') morceaux.push(`${String(item.duration).replace('.', ',')} h`);
  if (Number(item.laneCount) > 0) morceaux.push(`${item.laneCount} piste${item.laneCount > 1 ? 's' : ''}`);
  if (Number(item.games) > 0) morceaux.push(`${item.games} partie${item.games > 1 ? 's' : ''}`);
  if (vagues > 1) morceaux.push(`en ${vagues} vagues`);
  if (!morceaux.length && Number(item.minutes) > 0) morceaux.push(`${item.minutes} min`);
  return morceaux.join(', ');
}

// `disponibilite(params)` : la disponibilite publique, rendue { status, json }.
// `jourDe(iso)` : { ouvert, schedule } du calendrier du centre.
// `occupation(iso)` : { reservations, joueurs } deja prevus ce jour-la.
async function etudierDemande(item, { disponibilite, jourDe, occupation = null, aujourdhui = '' } = {}) {
  const d = demandeDe(item);
  const participants = d ? Number(d.participants) || 0 : Number(item && item.pax) || 0;
  const moment = d && surMesure.MOMENTS[d.moment] ? d.moment : 'indifferent';
  const etude = {
    participants,
    moment,
    momentLabel: surMesure.MOMENTS[moment].label,
    dates: [],
    sansDate: '',
  };
  if (!d) { etude.sansDate = 'Demande envoyée sans le formulaire détaillé : aucune date à étudier.'; return etude; }
  if (d.flexible) { etude.sansDate = `Date à fixer avec le client (période envisagée : ${d.period}).`; return etude; }
  const dates = [d.date, d.alternativeDate].filter(Boolean);
  for (const date of dates) {
    const jour = {
      date,
      libelle: surMesure.libelleDate(date),
      principale: date === d.date,
      passee: Boolean(aujourdhui) && date < aujourdhui,
      ouvert: false,
      horaires: null,
      fenetre: null,
      formules: [],
      visite: null,
      occupation: null,
    };
    etude.dates.push(jour);
    if (jour.passee) continue;
    const cal = jourDe(date) || {};
    jour.ouvert = Boolean(cal.ouvert);
    if (!jour.ouvert || !cal.schedule) continue;
    jour.horaires = { de: hhmm(Number(cal.schedule.open) * 60), a: hhmm(Number(cal.schedule.close) * 60) };
    jour.fenetre = fenetreDuMoment(moment, cal.schedule);

    for (const f of (Array.isArray(d.formulas) ? d.formulas : []).slice(0, MAX_FORMULES_ETUDIEES)) {
      const r = await disponibilite({ date, type: 'formule', formuleId: f.id, pax: participants });
      const j = (r && r.json) || {};
      const heures = (Array.isArray(j.slots) ? j.slots : []).filter((s) => s && s.time && s.ok !== false).map((s) => s.time);
      const dedans = heures.filter((t) => dansLaFenetre(t, jour.fenetre));
      const prix = Number(j.price) > 0 ? Number(j.price) : null;
      const panne = enPanne(r);
      jour.formules.push({
        id: f.id,
        nom: f.name,
        panne,
        ok: !panne && r.status === 200 && j.ok !== false && heures.length > 0,
        prix,
        parJoueur: prix && participants ? Math.round((prix / participants) * 100) / 100 : null,
        heures: dedans.slice(0, MAX_HEURES_CITEES),
        heuresAilleurs: dedans.length ? [] : heures.slice(0, MAX_HEURES_CITEES),
        raison: panne ? PANNE_DU_MOTEUR : heures.length ? '' : (String(j.message || '').trim() || 'Aucun départ possible ce jour-là.'),
      });
    }

    const activites = Array.isArray(d.activities) ? d.activities : [];
    if (activites.length) {
      const r = await disponibilite({ date, type: 'visite', pax: participants, program: JSON.stringify(activites.map((a) => ({ activityId: a.id }))), softReserve: '1' });
      const j = (r && r.json) || {};
      const slot = (Array.isArray(j.slots) ? j.slots : []).find((s) => s && s.time && s.ok !== false) || null;
      const blocs = (slot && slot.opsPlan && Array.isArray(slot.opsPlan.resourceBlocks)) ? slot.opsPlan.resourceBlocks : [];
      const lignes = ((j.program && Array.isArray(j.program.items)) ? j.program.items : []).map((it) => {
        const vagues = it.activityId === 'laser_game' ? blocs.filter((b) => b.resourceType === 'laser_arena').length : 0;
        return {
          nom: it.name || it.activityId,
          prix: it.priceKnown === true && Number(it.price) >= 0 ? Number(it.price) : null,
          detail: detailDeLigne(it, vagues),
        };
      });
      const ancres = (j.anchors && Array.isArray(j.anchors.activities)) ? j.anchors.activities : [];
      const prixComplet = lignes.length > 0 && lignes.every((l) => l.prix !== null);
      const prixVisite = Number(j.price) > 0 ? Number(j.price) : null;
      const panne = enPanne(r);
      jour.visite = {
        panne,
        ok: !panne && r.status === 200 && j.ok !== false && Boolean(slot),
        prix: prixVisite,
        parJoueur: prixVisite && participants ? Math.round((prixVisite / participants) * 100) / 100 : null,
        prixComplet,
        lignes,
        proposition: slot ? { debut: slot.time, fin: slot.visitEndTime || '' } : null,
        // En mode souple le moteur accepte un programme qui deborde la
        // fermeture et arrete la fin affichee a la fermeture : le debord se
        // dit a part, sinon « fin vers 22:00 » cacherait une heure qui manque.
        depasse: slot && slot.visitEndsAtClose ? Math.max(0, Math.round(Number(slot.visitShortfallMinutes) || 0)) : 0,
        heuresParActivite: ancres.map((a) => ({
          nom: a.label || a.activityId,
          heures: (Array.isArray(a.times) ? a.times : []).filter((t) => t && t.ok && dansLaFenetre(t.time, jour.fenetre)).map((t) => t.time).slice(0, MAX_HEURES_CITEES),
        })).filter((a) => a.heures.length),
        raison: panne ? PANNE_DU_MOTEUR : slot ? '' : (String(j.message || '').trim() || 'Aucun départ possible pour ce programme ce jour-là.'),
      };
    }

    if (typeof occupation === 'function') {
      try { jour.occupation = await occupation(date); } catch (error) { jour.occupation = null; }
    }
  }
  return etude;
}

// ---------------------------------------------------------------------------
// LES FAITS, EN MOTS : ce que l IA recoit, et ce contre quoi son texte est
// verifie. Un seul texte pour les deux : autoriser un chiffre que le modele
// n a jamais recu reviendrait a le laisser citer ce qu il a devine.
// ---------------------------------------------------------------------------
function joindre(liste) {
  const l = liste.filter(Boolean);
  if (l.length <= 1) return l.join('');
  return `${l.slice(0, -1).join(', ')} et ${l[l.length - 1]}`;
}

function demandeEnTexte(item) {
  const d = demandeDe(item);
  const lignes = [`Contact : ${item.contactName || 'inconnu'}${d && d.contactRole ? ` (${d.contactRole})` : ''}.`];
  if (!d) {
    lignes.push(`Demande libre${item.company ? ` pour ${item.company}` : ''}${Number(item.pax) > 0 ? `, ${item.pax} personnes` : ''}${item.requestedDate ? `, souhait : ${item.requestedDate}` : ''}.`);
    if (item.message) lignes.push(`Message du client : « ${String(item.message).slice(0, 1500)} »`);
    return lignes.join('\n');
  }
  const ages = (Array.isArray(d.ages) ? d.ages : []).map((k) => (surMesure.AGES[k] || {}).label).filter(Boolean);
  lignes.push(`Groupe : ${d.groupTypeLabel || d.groupType}${d.organisation ? `, ${d.organisation}` : ''}.`);
  lignes.push(`Effectif : ${d.participants} joueurs${Number(d.companions) > 0 ? ` et ${d.companions} accompagnateurs qui ne jouent pas` : ''}${ages.length ? ` ; âges : ${ages.join(', ').toLowerCase()}` : ''}.`);
  if (d.flexible) lignes.push(`Date : à fixer, période envisagée : ${d.period} ; moment : ${String(d.momentLabel || '').toLowerCase()}.`);
  else lignes.push(`Date souhaitée : ${surMesure.libelleDate(d.date)}${d.alternativeDate ? ` (ou ${surMesure.libelleDate(d.alternativeDate)})` : ''} ; moment : ${String(d.momentLabel || '').toLowerCase()}.`);
  const envies = [
    ...(Array.isArray(d.formulas) ? d.formulas : []).map((f) => laFormule(f.name)),
    ...(Array.isArray(d.activities) ? d.activities : []).map((a) => a.name),
  ];
  if (envies.length) lignes.push(`Envies : ${joindre(envies)}.`);
  if (d.advice) lignes.push('Le client demande que l’équipe lui propose un programme.');
  if (Number(d.budgetPerPerson) > 0) lignes.push(`Budget indicatif : ${d.budgetPerPerson} € par personne, soit ${euros(d.budgetPerPerson * d.participants)} pour ${d.participants} joueurs.`);
  if (d.invoice) lignes.push(`Facture demandée au nom de ${d.organisation || 'l’organisation'}${d.vatNumber ? ` (TVA ${d.vatNumber})` : ''}.`);
  if (item.message) lignes.push(`Message du client : « ${String(item.message).slice(0, 1500)} »`);
  return lignes.join('\n');
}

function etudeEnTexte(etude) {
  const lignes = [`Étude du moteur de réservation, pour ${etude.participants} joueurs (les accompagnateurs ne sont pas comptés dans les prix) :`];
  if (etude.sansDate) { lignes.push(`- ${etude.sansDate}`); return lignes.join('\n'); }
  for (const jour of etude.dates) {
    const tete = `- ${jour.libelle}${jour.principale ? '' : ' (autre date proposée par le client)'}`;
    if (jour.passee) { lignes.push(`${tete} : date déjà passée.`); continue; }
    if (!jour.ouvert) { lignes.push(`${tete} : le centre est fermé ce jour-là.`); continue; }
    const f = jour.fenetre;
    lignes.push(`${tete} : centre ouvert de ${jour.horaires.de} à ${jour.horaires.a}. Moment demandé : ${etude.momentLabel.toLowerCase()}${f ? `, de ${hhmm(f.de)} à ${hhmm(f.a)}` : ''}${f && !f.existe && f.raison ? ` (${f.raison})` : ''}.`);
    for (const fo of jour.formules) {
      if (fo.panne) { lignes.push(`  - ${laFormuleMaj(fo.nom)} : non étudiée, le moteur de réservation n’a pas répondu.`); continue; }
      if (!fo.ok) { lignes.push(`  - ${laFormuleMaj(fo.nom)} : impossible ce jour-là (${fo.raison}).`); continue; }
      const prix = fo.prix ? `${euros(fo.prix)} pour le groupe${fo.parJoueur ? `, soit ${euros(fo.parJoueur)} par joueur` : ''}` : 'prix à confirmer';
      const heures = fo.heures.length
        ? `départs possibles ${etude.momentLabel.toLowerCase() === 'peu importe' ? '' : 'dans ce moment '}à ${joindre(fo.heures)}`
        : `aucun départ dans ce moment, départs possibles ce jour-là à ${joindre(fo.heuresAilleurs)}`;
      lignes.push(`  - ${laFormuleMaj(fo.nom)} : ${prix} ; ${heures}.`);
    }
    if (jour.visite) {
      const v = jour.visite;
      if (v.panne) lignes.push('  - Programme des activités choisies : non étudié, le moteur de réservation n’a pas répondu.');
      else if (!v.ok) lignes.push(`  - Programme des activités choisies : impossible ce jour-là (${v.raison}).`);
      else {
        const detail = v.lignes.map((l) => `${l.nom}${l.detail ? ` (${l.detail})` : ''} ${l.prix !== null ? euros(l.prix) : 'prix à confirmer sur place'}`).join(' ; ');
        lignes.push(`  - Programme des activités choisies : ${v.prix ? `${euros(v.prix)} pour le groupe${v.parJoueur ? `, soit ${euros(v.parJoueur)} par joueur` : ''}${v.prixComplet ? '' : ', hors activités au prix à confirmer'}` : 'prix à confirmer'}. Détail : ${detail}.`);
        if (v.proposition) lignes.push(`    Départ proposé par le moteur à ${v.proposition.debut}${v.proposition.fin ? `, fin vers ${v.proposition.fin}` : ''}.`);
        if (v.depasse) lignes.push(`    Ce programme dépasse la fermeture de ${v.depasse} minutes : il ne tient pas en entier ce jour-là.`);
        v.heuresParActivite.forEach((a) => lignes.push(`    ${a.nom} possible à ${joindre(a.heures)}.`));
      }
    }
    if (jour.occupation) lignes.push(`  - Déjà prévu ce jour-là : ${jour.occupation.reservations} réservation${jour.occupation.reservations > 1 ? 's' : ''}, ${jour.occupation.joueurs} joueurs.`);
  }
  return lignes.join('\n');
}

// ---------------------------------------------------------------------------
// 3. LA REPONSE
// ---------------------------------------------------------------------------
const SCHEMA_REPONSE = {
  type: 'object',
  properties: {
    objet: { type: 'string' },
    corps: { type: 'string' },
    pointsAVerifier: { type: 'array', items: { type: 'string' } },
  },
  required: ['objet', 'corps', 'pointsAVerifier'],
  additionalProperties: false,
};

// « Formule 3 » se dit tel quel ; « Happy Laser » se dit « la formule Happy
// Laser ». Sans ce garde, le brouillon ecrivait « la formule Formule 3 ».
function joindreOu(liste) {
  const l = liste.filter(Boolean);
  if (l.length <= 1) return l.join('');
  return `${l.slice(0, -1).join(', ')} ou ${l[l.length - 1]}`;
}

function laFormule(nom) {
  const n = String(nom || '').trim();
  return /^formule\b/i.test(n) ? `la ${n}` : `la formule ${n}`;
}
function laFormuleMaj(nom) {
  const t = laFormule(nom);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const MOMENT_EN_PHRASE = { matin: 'dans la matinée', 'apres-midi': 'dans l’après-midi', soiree: 'en soirée', journee: 'pour toute la journée', indifferent: '' };

function prenomDe(nom) {
  return String(nom || '').trim().split(/\s+/)[0] || '';
}

// La meilleure proposition d un jour : les formules possibles d abord (le
// client les a choisies), le programme des activites ensuite.
function propositionsDuJour(jour) {
  const out = [];
  for (const fo of jour.formules) {
    if (!fo.ok || !fo.heures.length) continue;
    out.push(`- ${laFormuleMaj(fo.nom)}, ${fo.prix ? `${euros(fo.prix)} pour le groupe` : 'au prix à confirmer'}, avec un départ possible à ${joindreOu(fo.heures.slice(0, 3))}.`);
  }
  const v = jour.visite;
  if (v && v.ok && v.proposition && !v.depasse) {
    const noms = joindre(v.lignes.map((l) => l.nom));
    out.push(`- ${noms}, ${v.prix ? `${euros(v.prix)} pour le groupe${v.prixComplet ? '' : ` (sans ${joindre(v.lignes.filter((l) => l.prix === null).map((l) => l.nom))}, prix à l’accueil)`}` : 'au prix à confirmer'}, avec un départ à ${v.proposition.debut}${v.proposition.fin ? ` et une fin vers ${v.proposition.fin}` : ''}.`);
  }
  return out;
}

function etudeIncomplete(jour) {
  return Boolean(jour && (jour.formules.some((fo) => fo.panne) || (jour.visite && jour.visite.panne)));
}

// LE BROUILLON DU CODE : la reponse quand l IA ne repond pas, ou quand son
// texte ne passe pas les controles. Ecrit a partir des MEMES faits, et tenu
// aux memes regles (le gate le passe au meme controle que l IA).
function brouillonDuCode(item, etude, { signature = '', centerName = '' } = {}) {
  const d = demandeDe(item);
  const prenom = prenomDe(item.contactName);
  const quand = d && !d.flexible && d.date ? `, le ${surMesure.libelleDate(d.date)}` : '';
  const moment = d && !d.flexible && d.date && MOMENT_EN_PHRASE[etude.moment] ? ` ${MOMENT_EN_PHRASE[etude.moment]}` : '';
  const groupe = etude.participants ? ` pour ${etude.participants} personnes` : '';
  const corps = [`Bonjour${prenom ? ` ${prenom}` : ''},`, '', `Merci pour votre demande pour un groupe de ${etude.participants || 'plusieurs'} personnes${quand}${moment}.`];
  const principal = etude.dates.find((j) => j.principale) || etude.dates[0] || null;
  const autre = etude.dates.find((j) => !j.principale) || null;
  const questions = [];
  if (etude.sansDate) {
    corps.push('', 'Pour préparer une proposition précise, l’équipe a besoin de la date de votre venue et de l’heure d’arrivée souhaitée.');
  } else if (principal && !principal.ouvert && !principal.passee) {
    corps.push('', `Le centre est fermé le ${principal.libelle}.`);
    const offres = autre && autre.ouvert ? propositionsDuJour(autre) : [];
    if (offres.length) corps.push(`Le ${autre.libelle}, date que vous avez aussi proposée, l’équipe peut vous proposer ceci.`, ...offres);
    else questions.push('une autre date qui vous conviendrait');
  } else if (principal && principal.ouvert) {
    const offres = propositionsDuJour(principal);
    if (offres.length) {
      corps.push('', 'Voici ce que l’équipe peut vous proposer ce jour-là.', ...offres);
      const budget = d && Number(d.budgetPerPerson) > 0 ? Number(d.budgetPerPerson) : 0;
      const parJoueur = [
        ...principal.formules.filter((fo) => fo.ok && fo.heures.length && fo.parJoueur).map((fo) => `${euros(fo.parJoueur)} par joueur pour ${laFormule(fo.nom)}`),
        ...(principal.visite && principal.visite.ok && principal.visite.parJoueur ? [`${euros(principal.visite.parJoueur)} par joueur pour le programme d’activités`] : []),
      ];
      if (budget && parJoueur.length) corps.push('', `Pour votre budget indicatif de ${euros(budget)} par personne, cela représente ${joindre(parJoueur)}.`);
      corps.push('', 'Les montants sont calculés pour vos joueurs et se règlent sur place. L’horaire choisi est retenu à votre nom dès votre accord.');
      if (autre && !autre.ouvert && !autre.passee) corps.push(`Le ${autre.libelle}, date que vous proposiez aussi, le centre est fermé.`);
    }
    else if (etudeIncomplete(principal)) {
      corps.push('', `L’équipe vérifie les disponibilités du ${principal.libelle} pour votre groupe et revient vers vous avec une proposition précise.`);
    }
    else {
      corps.push('', `Les activités demandées n’ont plus de départ possible le ${principal.libelle} pour un groupe de cette taille.`);
      const offresAutre = autre && autre.ouvert ? propositionsDuJour(autre) : [];
      if (offresAutre.length) corps.push(`Le ${autre.libelle}, l’équipe peut vous proposer ceci.`, ...offresAutre);
      else questions.push('une autre date ou un autre moment de la journée');
    }
  }
  if (d && d.advice && !(d.formulas || []).length && !(d.activities || []).length) questions.push('les activités qui vous tentent le plus, pour composer le programme');
  if (questions.length) corps.push('', `Pour finaliser, merci de préciser ${joindre(questions)}.`);
  corps.push('', 'Bien à vous,', signature || centerName || 'L’équipe du centre');
  return {
    objet: `Votre venue${groupe}${centerName ? ` chez ${centerName}` : ''}`,
    corps: corps.join('\n'),
  };
}

// CE QUE L EQUIPE VERIFIE AVANT D ENVOYER, calcule : ce que l etude ne tranche
// pas. S ajoute aux points de l IA, jamais a leur place.
function pointsDeLEtude(item, etude) {
  const d = demandeDe(item);
  const points = [];
  if (d && Number(d.companions) > 0) points.push(`${d.companions} accompagnateur${d.companions > 1 ? 's' : ''} non compté${d.companions > 1 ? 's' : ''} dans les prix : à préciser au client si le centre leur facture quelque chose.`);
  etude.dates.forEach((jour) => {
    const aConfirmer = jour.visite && jour.visite.ok ? jour.visite.lignes.filter((l) => l.prix === null).map((l) => l.nom) : [];
    if (aConfirmer.length) points.push(`Prix à confirmer le ${jour.libelle} : ${aConfirmer.join(', ')}.`);
  });
  etude.dates.forEach((jour) => {
    if (jour.visite && jour.visite.ok && jour.visite.depasse) points.push(`Le programme d’activités dépasse la fermeture de ${jour.visite.depasse} minutes le ${jour.libelle} : à raccourcir avant de le proposer.`);
    if (etudeIncomplete(jour)) points.push(`Étude incomplète le ${jour.libelle} : le moteur n’a pas répondu, relancez l’étude avant d’envoyer.`);
  });
  if (etude.sansDate) points.push(etude.sansDate);
  return points;
}

// LES CHIFFRES D UN TEXTE, PAR NATURE. Comparer des nombres nus laissait
// passer « une remise de 15 % » des que la demande tombait un 15 mai : le « 15 »
// de la date autorisait le pourcentage. Un montant se compare aux montants des
// faits, une heure aux heures, un pourcentage aux pourcentages ; seul un
// nombre nu (un effectif, un jour du mois) se compare a tous les nombres.
// Une heure s ecrit « 14:30 », « 14h30 » ou « 14h » ; « 1 h » ou « 1h30 » sont
// des durees (aucun centre n accueille un groupe a une heure du matin).
function pad2(n) { return String(n).padStart(2, '0'); }
function lireChiffres(texte) {
  const montants = [];
  const pourcents = [];
  const heures = [];
  const valeur = (n) => Number(String(n).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
  const reste = String(texte || '')
    .replace(/(\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(?:€|euros?\b|EUR\b)/gi, (m, e, d) => { montants.push(valeur(d ? `${e}.${d}` : e)); return ' '; })
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:%|pour\s?cent\b)/gi, (m, n) => { pourcents.push(valeur(n)); return ' '; })
    .replace(/\b(\d{1,2})\s*(?::|h)\s*(\d{2})\b/gi, (m, h, mn) => { if (Number(h) >= 7 && Number(h) <= 24) { heures.push(`${pad2(h)}:${mn}`); return ' '; } return m; })
    .replace(/\b(\d{1,2})\s?h\b/gi, (m, h) => { if (Number(h) >= 7 && Number(h) <= 24) { heures.push(`${pad2(h)}:00`); return ' '; } return m; });
  return { montants, pourcents, heures, nombres: reste.match(/\d+(?:[.,]\d+)?/g) || [] };
}

function nombresNonAncres(texte, source) {
  const t = lireChiffres(texte);
  const f = lireChiffres(source);
  const nus = new Set(String(source || '').match(/\d+(?:[.,]\d+)?/g) || []);
  const proche = (liste, v) => liste.some((x) => Math.abs(x - v) < 0.005);
  const fautifs = [
    ...t.montants.filter((v) => !proche(f.montants, v)).map((v) => `${String(v).replace('.', ',')} €`),
    ...t.pourcents.filter((v) => !proche(f.pourcents, v)).map((v) => `${String(v).replace('.', ',')} %`),
    ...t.heures.filter((h) => !f.heures.includes(h)),
    ...t.nombres.filter((n) => !nus.has(n) && !nus.has(n.replace(',', '.'))),
  ];
  return [...new Set(fautifs)];
}

// LES MOTS QUI VALENT UN PRIX. « Les accompagnateurs entrent gratuitement »
// ne porte aucun chiffre et promet pourtant de l argent : un mot de gratuite
// ou de remise n est permis que si les faits du centre le portent deja.
const MOTS_QUI_VALENT_UN_PRIX = [
  ['gratuit', /\bgratuit(?:e|s|es|ement)?\b/i],
  ['offert', /\bofferte?s?\b/i],
  ['remise', /\bremises?\b/i],
  ['réduction', /\bréductions?\b/i],
  ['ristourne', /\bristournes?\b/i],
  ['cadeau', /\bcadeaux?\b/i],
];
function motsNonAncres(texte, source) {
  const faits = String(source || '').toLowerCase();
  return MOTS_QUI_VALENT_UN_PRIX
    .filter(([racine, motif]) => motif.test(String(texte || '')) && !faits.includes(racine))
    .map(([racine]) => racine);
}

// Les controles d une reponse : un chiffre ou un mot qui vaut un prix que les
// faits ne contiennent pas, et la doctrine d ecriture client (rien n est
// promis).
function controlerReponse({ objet = '', corps = '' }, sourceAutorisee) {
  const texte = `${objet}\n${corps}`;
  const chiffres = nombresNonAncres(texte, sourceAutorisee);
  const mots = motsNonAncres(texte, sourceAutorisee);
  const ecriture = verifierEcritureClient(texte, { etat: 'sans-promesse' });
  return { ok: !chiffres.length && !mots.length && !ecriture.length, chiffres, mots, ecriture };
}

const sansCadratin = (t) => String(t || '').replace(/[\u2014\u2013]/g, '-');

// LA CONSIGNE DE LA TACHE, en tete du message (le cerveau du centre porte
// deja la doctrine d ecriture, la voix, les regles et la signature). Le
// rappel final redit les non-negociables en fin de message.
const CONSIGNE_DE_LA_TACHE = [
  'TACHE : rediger la reponse de l equipe a cette demande sur mesure. OBJECTIF : que le groupe puisse dire oui en un seul echange.',
  '- Commence par remercier et rappeler la demande en une phrase (effectif, date, moment).',
  '- Propose une ou deux options tirees de l ETUDE, telles quelles : formule ou programme, prix pour le groupe, heure de depart. Si la date n est pas possible, dis-le franchement et propose ce que l ETUDE rend possible (l autre date du client, un autre moment).',
  '- Si le client a donne un budget, situe la proposition par rapport a lui, avec les chiffres fournis.',
  '- Ne pose que les questions qui manquent vraiment pour finaliser (au plus deux).',
  '- Dis que l horaire est retenu des l accord du client : jamais « reserve », « bloque », « confirme » ni « garanti ».',
  '- pointsAVerifier : ce que l equipe doit verifier avant d envoyer (un prix « a confirmer », une date non etudiee), en phrases courtes. Liste vide si rien.',
].join('\n');

const RAPPEL_FINAL = [
  'RAPPEL AVANT D ECRIRE :',
  '1. Chaque chiffre (prix, heure, date, effectif) vient de DEMANDE, ETUDE ou des tarifs du centre. Aucun calcul de ton cru.',
  '2. Aucune promesse : le client n a encore rien accepte.',
  '3. Jamais « on », « nous », « notre » ni « nos » : nomme l equipe ou le centre.',
  '4. Au plus une tournure « ... : ... » dans tout le message. Aucun tiret cadratin, aucun emoji.',
].join('\n');

// `llm(options)` : callLlmJson (lib/llm-client) ou un double en test.
// `brain` : buildEmailBrain(centerId, deps, instant, { tache: 'demande-sur-mesure' }).
async function redigerReponse({ item, etude, client = null, conversation = [], brain, llm, nomDuCentre = '' }) {
  const faitsDemande = demandeEnTexte(item);
  const faitsEtude = etudeEnTexte(etude);
  const secours = brouillonDuCode(item, etude, { signature: brain && brain.signature, centerName: (brain && brain.centerName) || nomDuCentre });
  const ficheClient = client ? (({ clientKey, ...reste }) => reste)(client) : null;
  const source = [brain ? brain.stable : '', brain ? brain.context : '', faitsDemande, faitsEtude, JSON.stringify(ficheClient || {}), JSON.stringify(conversation || [])].join('\n');
  const pointsCalcules = pointsDeLEtude(item, etude);
  const repli = (raison, alertes = []) => ({
    source: 'code',
    raison,
    objet: secours.objet,
    corps: secours.corps,
    pointsAVerifier: [...alertes, ...pointsCalcules],
    controle: controlerReponse(secours, `${source}\n${secours.objet}\n${secours.corps}`),
  });
  if (!brain || typeof llm !== 'function') return repli('ia-absente');

  let retours = [];
  for (let essai = 0; essai < 2; essai += 1) {
    const user = JSON.stringify({
      tache: CONSIGNE_DE_LA_TACHE,
      DEMANDE: faitsDemande,
      ETUDE: faitsEtude,
      client: ficheClient || 'inconnu',
      ...(ficheClient ? { legendeClient: 'visits = visites DEJA EUES ; prochaineReservation = une reservation DEJA POSEE, a ne pas reproposer.' } : {}),
      ...(conversation && conversation.length ? { conversation, legendeConversation: 'les echanges deja eus avec ce client, du plus ancien au plus recent ; ce qui n y figure pas n a pas ete promis.' } : {}),
      ...(retours.length ? { correctionsDemandees: retours } : {}),
      signature: brain.signature,
      rappel: RAPPEL_FINAL,
    });
    // Un modele qui leve (reseau, delai) se tait : le brouillon du code prend
    // la place, jamais une erreur a l ecran.
    let ai = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      ai = await llm({
        stableSystem: brain.stable,
        system: brain.context,
        user,
        schema: SCHEMA_REPONSE,
        schemaName: 'reponse_demande_sur_mesure',
        maxTokens: 900,
        timeoutMs: 25000,
      });
    } catch (error) { ai = null; }
    if (!ai || typeof ai.corps !== 'string' || !ai.corps.trim()) return repli('ia-muette');
    const reponse = { objet: sansCadratin(ai.objet || secours.objet).slice(0, 200), corps: sansCadratin(ai.corps).slice(0, 5000) };
    const controle = controlerReponse(reponse, source);
    if (controle.ok) {
      return {
        source: 'ia',
        raison: '',
        objet: reponse.objet,
        corps: reponse.corps,
        pointsAVerifier: [...(Array.isArray(ai.pointsAVerifier) ? ai.pointsAVerifier : []).map((p) => sansCadratin(p).slice(0, 200)).filter(Boolean).slice(0, 4), ...pointsCalcules],
        controle,
        provider: ai._provider || '',
        model: ai._model || '',
      };
    }
    retours = [
      ...controle.chiffres.map((n) => `Le chiffre « ${n} » n est dans aucun fait fourni : retire-le ou remplace-le par un chiffre de DEMANDE ou ETUDE.`),
      ...controle.mots.map((m) => `Le mot « ${m} » annonce un avantage qu aucun fait fourni ne porte : retire-le.`),
      ...controle.ecriture.map((e) => `${e.quoi} (« ${e.extrait} ») : ${e.remede}.`),
    ].slice(0, 8);
  }
  return repli('ia-refusee', ['Le texte de l’IA ne passait pas les contrôles (chiffre hors des faits ou promesse) : brouillon rédigé à partir de l’étude.']);
}

// ---------------------------------------------------------------------------
// 4. LE SUIVI (payload.suivi)
// ---------------------------------------------------------------------------
const TYPES_EVENEMENT = new Set(['prise-en-charge', 'reponse', 'statut', 'reservation', 'note']);

// Rend le payload avec l evenement ajoute. Pur : l ecriture en base se fait
// dans une transaction, autour de cette fonction.
function ajouterAuSuivi(payload, evenement) {
  const base = payload && typeof payload === 'object' ? payload : {};
  const suivi = base.suivi && typeof base.suivi === 'object' ? base.suivi : {};
  const e = evenement && typeof evenement === 'object' ? evenement : {};
  if (!TYPES_EVENEMENT.has(e.type)) throw Object.assign(new Error('Évènement de suivi inconnu.'), { statusCode: 400, expose: true });
  const propre = {
    type: e.type,
    le: new Date(e.le || Date.now()).toISOString(),
    par: String(e.par || '').slice(0, 120),
  };
  if (e.type === 'note') {
    const texte = String(e.texte || '').replace(/\s+\n/g, '\n').trim().slice(0, 1500);
    if (!texte) throw Object.assign(new Error('Note vide.'), { statusCode: 400, expose: true });
    const notes = Array.isArray(suivi.notes) ? suivi.notes : [];
    return { ...base, suivi: { ...suivi, notes: [...notes, { ...propre, texte }].slice(-MAX_NOTES) } };
  }
  if (e.type === 'reponse') { propre.objet = String(e.objet || '').slice(0, 200); if (Number(e.communicationId) > 0) propre.communicationId = Number(e.communicationId); if (e.source === 'ia' || e.source === 'code') propre.source = e.source; }
  if (e.type === 'statut') propre.statut = String(e.statut || '').slice(0, 20);
  if (e.type === 'reservation' && Number(e.reservationId) > 0) propre.reservationId = Number(e.reservationId);
  // Son jour : la console ouvre le planning de ce jour quand la fiche n est
  // pas chargee sur le poste.
  if (e.type === 'reservation' && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || ''))) propre.date = String(e.date);
  const historique = Array.isArray(suivi.historique) ? suivi.historique : [];
  // Un envoi rejoue (meme cle d idempotence) rend le MEME mail
  // (lib/database.js, createCommunication) : il ne se range qu une fois.
  if (propre.communicationId && historique.some((x) => x && x.type === 'reponse' && Number(x.communicationId) === propre.communicationId)) return base;
  return { ...base, suivi: { ...suivi, historique: [...historique, propre].slice(-MAX_EVENEMENTS) } };
}

// Ce que la console lit d un coup d oeil. `etape` : ou en est la demande, en
// un mot, pour la file.
//
// `dernierMessageClient` : le dernier mail RECU de ce client (instant ISO).
// Une reponse partie met la demande « en attente du client » ; un mail du
// client arrive APRES elle la remet a traiter. Sans ce retour, une demande
// dont le client a repondu dormirait dans l onglet de l attente, et personne
// ne lirait sa reponse.
function resumeDuSuivi(item, { dernierMessageClient = null } = {}) {
  const suivi = (item && item.payload && item.payload.suivi) || {};
  const historique = Array.isArray(suivi.historique) ? suivi.historique : [];
  const dernier = (type) => historique.filter((e) => e.type === type).slice(-1)[0] || null;
  const reponses = historique.filter((e) => e.type === 'reponse');
  const derniereReponse = reponses.slice(-1)[0] || null;
  const reservation = dernier('reservation');
  const statut = item && item.status;
  const repere = new Date((derniereReponse && derniereReponse.le) || (item && item.createdAt) || 0).getTime();
  const recu = dernierMessageClient ? new Date(dernierMessageClient).getTime() : NaN;
  const messageClient = Number.isFinite(recu) && Number.isFinite(repere) && recu > repere ? new Date(recu).toISOString() : null;
  let etape = 'a-traiter';
  if (statut === 'archived') etape = 'archivee';
  else if (statut === 'handled') etape = 'traitee';
  else if (reponses.length && !messageClient) etape = 'en-attente';
  return {
    etape,
    priseEnCharge: dernier('prise-en-charge'),
    reponses: reponses.length,
    derniereReponse,
    messageClient,
    reservationId: reservation ? reservation.reservationId || null : null,
    notes: Array.isArray(suivi.notes) ? suivi.notes : [],
    historique,
  };
}

module.exports = {
  HEURES_PROMISES,
  SCHEMA_REPONSE,
  CONSIGNE_DE_LA_TACHE,
  RAPPEL_FINAL,
  echeanceDeReponse,
  jourOuvreDuCentre,
  instantDeBruxelles,
  etudierDemande,
  demandeEnTexte,
  etudeEnTexte,
  brouillonDuCode,
  pointsDeLEtude,
  controlerReponse,
  lireChiffres,
  redigerReponse,
  ajouterAuSuivi,
  resumeDuSuivi,
};
