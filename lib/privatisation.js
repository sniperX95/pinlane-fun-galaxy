'use strict';
// PRIVATISER UNE PLAGE (2026-11-18). Marius, manager de Gembloux, au vocal du 18/11 : « est-ce que
// tu as prévu un onglet privatisation ? Genre comme ça je suis sûr que personne ne rajoute de
// réservation à ce moment-là. »
//
// Une privatisation, c est un jour, une plage horaire, tout le centre OU des activites choisies, un
// nom (le client ou l evenement), et eventuellement la reservation du groupe prive. Elle s ecrit en
// blocages de disponibilite (lib/availability-blocks.js, `kind = 'private'`) : la meme table que les
// fermetures, donc les memes gardes partout (formulaire en ligne, comptoir et sa simulation, glisser
// du planning, assistant), et une phrase qui cite le nom et la plage.
//
// Ce module ne decide que ce qui est propre au geste :
//   - lire la demande et la borner (jour a venir, plage lisible, activites du centre, nom) ;
//   - dire quelles reservations sont DEJA sur la plage, avant d enregistrer : rien ne se deplace
//     tout seul, et l ecriture refuse tant que l equipe ne les a pas vues (`reservationsVues`) ;
//   - refuser une privatisation qui en chevauche une autre (meme activite, ou tout le centre) ;
//   - regrouper les blocages d une meme privatisation pour l ecran.
// Le droit de privatiser est juge par api/ops.js (getRequiredOpsPermission), jamais par l ecran.

const AB = require('./availability-blocks');

const NOM_MAX = 120;
const ACTIVITES_MAX = 12;
const JOUR_MINUTES = 24 * 60;

function erreur(message, statut = 400, extra = {}) {
  return Object.assign(new Error(message), { expose: true, statusCode: statut }, extra);
}

function dateReelle(iso) {
  const lu = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!lu) return false;
  const d = new Date(Date.UTC(Number(lu[1]), Number(lu[2]) - 1, Number(lu[3])));
  return d.getUTCFullYear() === Number(lu[1]) && d.getUTCMonth() === Number(lu[2]) - 1 && d.getUTCDate() === Number(lu[3]);
}

function minutesDe(heure) {
  const lu = /^(\d{1,2}):(\d{2})$/.exec(String(heure || '').trim());
  if (!lu || Number(lu[2]) > 59) return null;
  const total = Number(lu[1]) * 60 + Number(lu[2]);
  return total <= JOUR_MINUTES ? total : null;
}

function heureDe(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function entiers(liste) {
  return [...new Set((Array.isArray(liste) ? liste : []).map((x) => Math.trunc(Number(x))).filter((x) => x > 0))];
}

// LA DEMANDE, LUE ET BORNEE. `activitesDuCentre` : les identifiants que ce centre propose (une
// activite d un autre centre, ou inventee, se refuse avec sa raison).
function lirePrivatisation(body = {}, { aujourdhui = '', activitesDuCentre = [] } = {}) {
  const date = String(body.date || '').trim();
  if (!dateReelle(date)) throw erreur('Choisissez le jour de la privatisation.');
  if (aujourdhui && date < aujourdhui) throw erreur('Ce jour est passé : une privatisation se pose sur un jour à venir.');
  const startMin = minutesDe(body.startTime);
  const endMin = minutesDe(body.endTime);
  if (startMin === null || endMin === null) throw erreur('Choisissez de quelle heure à quelle heure.');
  if (!(endMin > startMin)) throw erreur('L’heure de fin doit venir après l’heure de début.');
  const toutLeCentre = body.toutLeCentre === true;
  const connues = new Set((Array.isArray(activitesDuCentre) ? activitesDuCentre : []).map(String));
  const activites = toutLeCentre ? [] : [...new Set((Array.isArray(body.activites) ? body.activites : []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (activites.length > ACTIVITES_MAX) throw erreur(`${ACTIVITES_MAX} activités au plus.`);
  const inconnue = activites.find((id) => !connues.has(id));
  if (inconnue) throw erreur(`L’activité « ${inconnue.slice(0, 40)} » n’existe pas dans ce centre.`);
  if (!toutLeCentre && !activites.length) throw erreur('Choisissez tout le centre ou au moins une activité.');
  const nom = String(body.nom || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NOM_MAX);
  if (!nom) throw erreur('Donnez le nom du client ou de l’événement.');
  const lie = body.reservationId === undefined || body.reservationId === null || body.reservationId === '' ? null : Math.trunc(Number(body.reservationId));
  if (lie !== null && !(lie > 0)) throw erreur('Réservation du groupe invalide.');
  return {
    date,
    startMin,
    endMin,
    startTime: heureDe(startMin),
    endTime: heureDe(endMin),
    toutLeCentre,
    activites,
    nom,
    reservationId: lie,
    reservationsVues: entiers(body.reservationsVues),
    // (modifier : les blocages de la privatisation d avant, remplaces dans la meme ecriture)
    remplace: entiers(body.remplace).slice(0, 50),
    aBlanc: body.aBlanc === true,
  };
}

// Les blocages qu elle poserait, sous la forme que les gardes lisent : on juge la privatisation
// avec le MEME code que celui qui refusera ensuite les reservations.
function blocagesProposes(p, centerId) {
  const base = {
    id: 0, centerId, recurrence: 'once', date: p.date, dayOfWeek: null, dateFrom: null, dateUntil: null,
    startMin: p.startMin, endMin: p.endMin, reason: p.nom, createdBy: '', kind: 'private', reservationId: p.reservationId,
  };
  return p.toutLeCentre
    ? [{ ...base, scopeType: 'center', scopeRef: null }]
    : p.activites.map((id, index) => ({ ...base, id: -(index + 1), scopeType: 'activity', scopeRef: id }));
}

function seChevauchent(a, b) {
  const debut = (x) => (x.startMin === null ? 0 : x.startMin);
  const fin = (x) => (x.endMin === null ? JOUR_MINUTES : x.endMin);
  if (!(debut(a) < fin(b) && debut(b) < fin(a))) return false;
  return a.scopeType === 'center' || b.scopeType === 'center' || (a.scopeType === 'activity' && b.scopeType === 'activity' && String(a.scopeRef) === String(b.scopeRef));
}

// Une privatisation deja posee qui couvre la meme plage (tout le centre, ou une activite en commun) :
// deux groupes prives au meme endroit, c est une erreur a dire, pas a ecrire.
function privatisationEnTravers(blocsDuJour, proposes, date) {
  const posees = AB.resolveBlocksForDate(Array.isArray(blocsDuJour) ? blocsDuJour : [], date).filter(AB.estPrivatisation);
  for (const propose of proposes) {
    const trouvee = posees.find((bloc) => seChevauchent(bloc, propose));
    if (trouvee) return trouvee;
  }
  return null;
}

// LES RESERVATIONS DEJA SUR LA PLAGE : celles que ces blocages fermeraient, jugees par la garde des
// reservations elle-meme (blocageDuDossier, lib/database.js). La reservation du groupe y figure,
// marquee : sa privatisation ne la bloquera pas.
function reservationsSurLaPlage(reservations, proposes, date, { blocageDuDossier, fenetreDeLaVisite, reservationDuGroupe = null } = {}) {
  return (Array.isArray(reservations) ? reservations : [])
    .filter((r) => r && !r.blocage && String(r.status || '').toLowerCase() !== 'cancelled')
    .map((r) => {
      let ferme = null;
      let fin = '';
      try {
        ferme = blocageDuDossier({ ...r, channel: 'staff' }, proposes, date);
        fin = heureDe(fenetreDeLaVisite(r).endMin);
      } catch (error) {
        ferme = null;
      }
      if (!ferme) return null;
      return {
        id: Number(r.id),
        nom: String(r.name || '').replace(/[<>]/g, '').trim().slice(0, 80) || `Réservation n° ${r.id}`,
        debut: String(r.startTime || '').slice(0, 5),
        fin,
        libelle: String(r.label || '').slice(0, 120),
        joueurs: Number(r.pax) || 0,
        duGroupe: reservationDuGroupe !== null && Number(r.id) === Number(reservationDuGroupe),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.debut.localeCompare(b.debut) || a.id - b.id);
}

// LES PRIVATISATIONS D UN JOUR, une par groupe de blocages poses ensemble (meme nom, meme plage,
// meme reservation) : ce que le planning et Etablissement montrent, et ce que « Retirer » retire.
function privatisationsDuJour(blocsDuJour, date) {
  const groupes = new Map();
  AB.resolveBlocksForDate(Array.isArray(blocsDuJour) ? blocsDuJour : [], date).filter(AB.estPrivatisation).forEach((bloc) => {
    const cle = [bloc.date || date, bloc.startMin, bloc.endMin, bloc.reason, bloc.reservationId || ''].join('|');
    if (!groupes.has(cle)) {
      groupes.set(cle, {
        ids: [], nom: bloc.reason, date: bloc.date || date, startMin: bloc.startMin, endMin: bloc.endMin,
        plage: AB.plageDuBlocage(bloc), toutLeCentre: false, activites: [], reservationId: bloc.reservationId || null,
      });
    }
    const groupe = groupes.get(cle);
    groupe.ids.push(Number(bloc.id));
    if (bloc.scopeType === 'center') groupe.toutLeCentre = true;
    else if (bloc.scopeRef && !groupe.activites.includes(bloc.scopeRef)) groupe.activites.push(String(bloc.scopeRef));
  });
  return [...groupes.values()].sort((a, b) => (a.startMin || 0) - (b.startMin || 0));
}

// LE GROUPE PRIVE QUE L EQUIPE RATTACHE AU DOSSIER QU ELLE CREE (la fenetre Reserver : « Réserver
// pour Dupont »). Un blocage de la privatisation suffit a la designer : ses freres (meme nom, meme
// plage) la suivent. Seulement une privatisation encore sans reservation.
function groupeAPartirDUnBlocage(blocsDuJour, date, id) {
  const voulu = Math.trunc(Number(id));
  if (!(voulu > 0)) return null;
  return privatisationsDuJour(blocsDuJour, date).find((groupe) => groupe.ids.includes(voulu) && !groupe.reservationId) || null;
}

// POSER (ou montrer avant de poser, `aBlanc`). Les dependances viennent de l appelant (api/ops.js) :
// la lecture du jour, la journee sous verrou, les noms d activites, le cache a rechauffer.
async function poserPrivatisation({
  pool, centerId, body, createdBy = '', aujourdhui = '', activitesDuCentre = [], nomDActivite = (id) => id,
  lireLeJour, relireSousVerrou, blocageDuDossier, fenetreDeLaVisite, rafraichir = async () => {},
}) {
  const p = lirePrivatisation(body, { aujourdhui, activitesDuCentre });
  const etat = (await lireLeJour(p.date)) || {};
  const reservations = Array.isArray(etat.reservations) ? etat.reservations : [];
  if (p.reservationId && !reservations.some((r) => Number(r.id) === p.reservationId)) {
    throw erreur('Cette réservation n’est pas sur ce jour dans ce centre.', 422);
  }
  // MODIFIER une privatisation qui n existe plus telle quelle (retiree ou deja modifiee sur un autre
  // poste) : la vraie raison, avant toute autre. La transaction le reverifie sous verrou.
  if (p.remplace.length) {
    const encore = new Set((await AB.listerPrivatisationsAVenir(pool, { centerId, depuis: aujourdhui || '1970-01-01' })).map((bloc) => Number(bloc.id)));
    if (!p.remplace.every((id) => encore.has(id))) {
      throw erreur('Cette privatisation a changé entre-temps sur un autre poste. Rien n’a été modifié : rouvrez-la depuis le planning.', 409, { code: 'privatisation_changee' });
    }
  }
  const proposes = blocagesProposes(p, centerId);
  // (une privatisation qu on modifie ne se gene pas elle-meme : ses anciens blocages sont ecartes)
  const blocsDuJour = Array.isArray(etat.blocks) ? etat.blocks : [];
  const autres = p.remplace.length ? blocsDuJour.filter((bloc) => !p.remplace.includes(Number(bloc && bloc.id))) : blocsDuJour;
  const deja = privatisationEnTravers(autres, proposes, p.date);
  if (deja) {
    throw erreur(`Déjà privatisé : ${deja.reason || 'un autre groupe'}, ${AB.plageDuBlocage(deja)}${deja.scopeType === 'activity' ? ` (${nomDActivite(deja.scopeRef)})` : ''}. Retirez cette privatisation d’abord.`, 409, { code: 'deja_privatise' });
  }
  const dependances = { blocageDuDossier, fenetreDeLaVisite, reservationDuGroupe: p.reservationId };
  const touchees = reservationsSurLaPlage(reservations, proposes, p.date, dependances);
  const resume = {
    date: p.date,
    startTime: p.startTime,
    endTime: p.endTime === '24:00' ? 'minuit' : p.endTime,
    nom: p.nom,
    toutLeCentre: p.toutLeCentre,
    activites: p.activites.map((id) => ({ id, nom: nomDActivite(id) })),
    reservationId: p.reservationId,
    phrase: AB.phraseDuBlocage(proposes[0], { activite: p.toutLeCentre ? '' : p.activites.map(nomDActivite).join(', ') }),
  };
  if (p.aBlanc) return { aBlanc: true, privatisation: resume, reservations: touchees };
  // RIEN NE S ECRIT SANS QUE L EQUIPE AIT VU CE QUI EST DEJA LA. La reservation du groupe ne compte
  // pas : c est elle qu on protege.
  const nonVues = (liste) => liste.filter((r) => !r.duGroupe && !p.reservationsVues.includes(r.id));
  const dire = (liste) => erreur(
    liste.length > 1
      ? `${liste.length} réservations sont déjà sur cette plage. Relisez-les avant de privatiser : rien ne se déplace tout seul.`
      : `${liste[0].nom} est déjà sur cette plage (${liste[0].debut} à ${liste[0].fin}). Relisez avant de privatiser : rien ne se déplace tout seul.`,
    409,
    { code: 'reservations_sur_la_plage', reservations: touchees },
  );
  if (nonVues(touchees).length) throw dire(nonVues(touchees));
  const crees = await AB.insererPrivatisation(pool, {
    centerId,
    date: p.date,
    startTime: p.startTime,
    endTime: p.endTime,
    nom: p.nom,
    portees: proposes.map((bloc) => ({ scopeType: bloc.scopeType, scopeRef: bloc.scopeRef })),
    reservationId: p.reservationId,
    createdBy,
    avant: async (client) => {
      // MODIFIER : l ancienne privatisation part dans la transaction de la nouvelle. Si elle a deja
      // change (retiree, modifiee sur un autre poste), rien ne s ecrit.
      if (p.remplace.length) {
        const partis = await AB.retirerPrivatisationDans(client, { centerId, ids: p.remplace });
        if (partis !== p.remplace.length) {
          throw erreur('Cette privatisation a changé entre-temps sur un autre poste. Rien n’a été modifié : rouvrez-la depuis le planning.', 409, { code: 'privatisation_changee' });
        }
      }
      // Sous le verrou de la journee : une reservation arrivee pendant que l equipe lisait la liste
      // arrete l ecriture, et la liste revient a jour.
      if (typeof relireSousVerrou !== 'function') return;
      const relues = reservationsSurLaPlage(await relireSousVerrou(client, p.date), proposes, p.date, dependances);
      const nouvelles = nonVues(relues);
      if (nouvelles.length) throw Object.assign(dire(nouvelles), { reservations: relues });
    },
  });
  await rafraichir();
  const [groupe] = privatisationsDuJour(crees, p.date);
  return { privatisation: { ...resume, ids: crees.map((bloc) => bloc.id), remplace: p.remplace, plage: groupe ? groupe.plage : '' }, reservations: touchees };
}

// LES PRIVATISATIONS A VENIR (2026-11-20), pour la liste de la console : une ligne par
// privatisation (ses blocages regroupes comme au planning), du jour du centre a la suite.
async function listerPrivatisations({ pool, centerId, aujourdhui, nomDActivite = (id) => id } = {}) {
  const blocs = await AB.listerPrivatisationsAVenir(pool, { centerId, depuis: aujourdhui });
  const parJour = new Map();
  blocs.forEach((bloc) => {
    if (!parJour.has(bloc.date)) parJour.set(bloc.date, []);
    parJour.get(bloc.date).push(bloc);
  });
  const liste = [];
  [...parJour.keys()].sort().forEach((date) => {
    privatisationsDuJour(parJour.get(date), date).forEach((g) => {
      liste.push({
        ids: g.ids,
        date,
        nom: g.nom,
        startTime: heureDe(g.startMin === null ? 0 : g.startMin),
        endTime: g.endMin === null || g.endMin >= JOUR_MINUTES ? '24:00' : heureDe(g.endMin),
        plage: g.plage,
        toutLeCentre: g.toutLeCentre,
        activites: g.activites.map((id) => ({ id, nom: nomDActivite(id) })),
        reservationId: g.reservationId,
      });
    });
  });
  return liste;
}

module.exports = {
  lirePrivatisation,
  blocagesProposes,
  privatisationEnTravers,
  reservationsSurLaPlage,
  privatisationsDuJour,
  groupeAPartirDUnBlocage,
  poserPrivatisation,
  listerPrivatisations,
};
