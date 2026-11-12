'use strict';
// LES GESTES DES RESERVATIONS, DES CLIENTS, DES DEMANDES ET DU PLANNING (lot 3 de « tout faire », 2026-11-11).
// Le contrat d un geste et les aides (erreur, trouver, nombre, booleen, euros, coupe, rempli, DEMANDE_*) :
// lib/assistant-gestes.js. gestes(aides) rend { nom: geste } ; lecteurs ajoute des lectures injectables.
//
// CE QUE CE LOT TIENT, EN PLUS DU CONTRAT :
//  - un dossier se relit a chaque passage (carte puis clic) et appartient a CE centre : un numero d un
//    autre centre se refuse comme un numero inconnu (dossierDuCentre) ;
//  - un geste sur une reservation part avec la version lue au clic (baseUpdatedAt) : un poste qui a
//    ecrit entre-temps fait refuser l ecriture (409), rien ne s ecrase ;
//  - un mail, une relance ou un SMS part avec une cle de tentative posee sur la carte (figer) : deux
//    clics, un seul envoi (le serveur ne renvoie rien a une cle deja vue, lib/database.js
//    createCommunication) ; son destinataire et son texte entier se lisent sur la carte, et une adresse
//    ou un numero qui a change entre la carte et le clic arrete l envoi ;
//  - la reservation d une demande reserve la proposition que le client a recue, celle que la carte a
//    montree ; un plan de retard applique celui que la carte a montre : ce qui a bouge entre-temps
//    arrete le clic.
//
// PAS ICI, ET POURQUOI : la note CRM (clientNotes) double note_client et sa cle est le telephone du
// client.

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEURE_RX = /^([01]\d|2[0-3]):[0-5]\d$/;
const NUMERO_MAX = 2147483647;

function versionDe(valeur) {
  const ms = valeur instanceof Date ? valeur.getTime() : Date.parse(String(valeur || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function dateReelle(texte) {
  const t = String(texte || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return '';
  const d = new Date(`${t}T12:00:00Z`);
  // Une date se valide en la reconstruisant : Date.parse accepte un 31 fevrier.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t ? t : '';
}

function jourDit(iso) {
  try { return new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); } catch (e) { return String(iso || ''); }
}

const minutesDe = (h) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(h || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
const heureDe = (r) => String((r && r.startTime) || '').slice(0, 5);
const aujourdhui = () => ((require('./center-facts').jourDuCentre() || {}).date) || new Date().toISOString().slice(0, 10);
const nomDeSession = (session) => String((session && session.member && (session.member.name || session.member.displayName)) || '').slice(0, 80);
const empreinteDe = (valeur) => require('crypto').createHash('sha256').update(JSON.stringify(valeur)).digest('hex').slice(0, 16);
const sujetSansPrefixe = (s) => String(s || '').replace(/^(\s*(re|tr|fwd?)\s*:\s*)+/i, '').trim();

const STATUTS = { pending: 'Confirmé', arrived: 'Arrivé', paid: 'Payé', cancelled: 'Annulé' };
const CHOIX_STATUT = [{ id: 'pending', name: 'Confirmé' }, { id: 'arrived', name: 'Arrivé' }, { id: 'paid', name: 'Payé' }];
const MOYENS = [{ id: 'Carte', name: 'Carte' }, { id: 'Espèces', name: 'Espèces' }, { id: 'Carte Bancaire', name: 'Carte Bancaire' }, { id: 'Comptoir', name: 'Comptoir' }];
const SOURCES_DE_RETRAIT = { link: 'par le lien de désinscription d’un mail', complaint: 'par une plainte', form: 'en cochant la case du formulaire de réservation', staff: 'par l’équipe' };
const STATUTS_FIL = { open: 'ouverte', answered: 'répondue', closed: 'terminée' };
// Les motifs d une relance de la page Clients (lib/ops-communications.js, RELANCE_REASONS).
const MOTIFS_RELANCE = [{ id: 'birthday', name: 'Anniversaire' }, { id: 'dormant', name: 'Client dormant' }, { id: 'custom', name: 'Autre' }];
const RAISONS_RETARD = ['late_customer', 'incomplete_group', 'bar_queue', 'bowling_bug', 'laser_bug', 'briefing_delay', 'group_slow'];
// Les bornes de l agent des mails (lib/email-agent.js, BRAIN_LIMITS, non exportees).
const LIMITES_AGENT = { objet: 140, texte: 2000 };

// UNE DEMANDE SE LIT EN TETE DE MOT (revue du lot 2, 2026-11-12) : « merci beaucoup » contenait
// « coup », « permet » contenait « met », « vendredi » contenait « vend », « parties » contenait
// « part ». Une racine ne compte qu au debut d un mot. Un mot qui nomme seulement la chose (« prix »,
// « campagne », « anniversaire », « merci », « plus ») ne dit pas qu on veut agir : les racines sont
// des verbes, avec leurs terminaisons quand le meme debut fait aussi un nom (« modifie » ouvre,
// « modifications » non).
const mots = (...racines) => new RegExp(`(?<!\\p{L})(?:${racines.join('|')})`, 'iu');
const verbe = (racine, fins = 'e|es|ez|er|ons') => `${racine}(?:${fins})(?!\\p{L})`;
const METTRE = 'met(?:s|tez|tre|tons)?(?!\\p{L})';
const REMETTRE = 'remet(?:s|tez|tre|tons)?(?!\\p{L})';
const PASSER = verbe('pass', 'e|ez|er');
const CHANGER = verbe('chang', 'e|es|ez|er|eons|é|ée');
const MODIFIER = verbe('modifi', 'e|es|ez|er|ons|é|ée');
const RETIRER = verbe('retir');
const ENLEVER = verbe('enl[eè]v');
const AJOUTER = verbe('r?ajout');
const REMPLACER = verbe('remplac', 'e|es|ez|er|ons|é|ée');
const CORRIGER = verbe('corrig', 'e|es|ez|er|eons|é|ée');
const PAYER = 'pa(?:y|i)(?:e|es|ent|é|ée|és|ées|er|ez|ons|ement)?(?!\\p{L})';
const REGLER = verbe('r[ée]gl', 'é|ée|és|ées|er|ez|ons');
const ENCAISSER = verbe('encaiss', 'e|es|ez|er|ons|é|ée');
const CONFIRMER = verbe('confirm', 'e|es|ez|er|ons|é|ée');
const VALIDER = verbe('valid', 'e|es|ez|er|ons|é|ée');
const ACCEPTER = verbe('accept', 'e|es|ez|er|ons|é|ée');
const ECRIRE = '[ée]cri(?:s|t|re|vez|vons)(?!\\p{L})';
const ENVOYER = `${verbe('envoi', 'e|es|ent')}|${verbe('envoy', 'er|ez|ons|é|ée')}`;
const PREVENIR = `pr[ée]vien|${verbe('pr[ée]ven', 'ir|ez|ons')}`;
const SUPPRIMER = mots(verbe('supprim'), verbe('effac'), RETIRER, ENLEVER, verbe('archiv'), verbe('vir', 'e|es|ez|er'), verbe('jet', 'te|tes|tez|er'), 'plus\\s+besoin');

// ── Ce que les gestes lisent (injectable : le gate y pose les siens, rien ne part en base) ────────
const lecteurs = {
  // Le dossier tel que la base le garde, quel que soit son centre : le geste juge le centre lui-meme.
  async dossierResa(centre, numero) {
    return require('./database').getReservationById(Number(numero));
  },
  async demandeSurMesure(centre, numero) {
    try { return await require('./database').getCustomRequest(Number(numero), { centerId: centre }); } catch (e) { if (e && e.statusCode === 404) return null; throw e; }
  },
  // La simulation de la fenetre Reserver, comme customRequestBook sans confirme : rien ne se cree.
  async simulationDemande(centre, numero, proposition, session) {
    const item = await require('./database').getCustomRequest(Number(numero), { centerId: centre });
    const { reserverLaDemande } = require('./demande-bureau-centre');
    return require('./booking-config').pourLEquipe(() => reserverLaDemande(item, undefined, { proposition, session, simuler: true }));
  },
  async filDeMails(centre, numero) {
    const { getPool } = require('./database');
    return require('./email-threads').chargerFil((text, params) => getPool().query(text, params), { centerId: centre, threadId: Number(numero) });
  },
  async expediteursMails(centre) {
    return require('./database').listEmailIdentities({ centerId: centre });
  },
  async listeSuppression(centre) {
    return (await require('./marketing-suppression').listSuppressions(centre, { limit: 1000 })).entries || [];
  },
  async designDesMails(centre) {
    return require('./ops-communications').resolveEmailDesign(centre);
  },
  async cerveauAgentMails(centre) {
    const EA = require('./email-agent');
    return { reglages: await EA.getEmailBrainOverrides(centre), defauts: EA.getEmailBrainDefaults(centre) };
  },
  async registreSuppressions(centre) {
    return require('./database').listArchivedReservations({ centerId: centre, includeRestored: false, limit: 200 });
  },
  async etatDesPistes(centre) {
    const db = require('./database');
    const OK = require('./ops-knowledge');
    try { await OK.refreshCenterOverrides(db.getPool()); } catch (e) { /* socle fichier */ }
    let nombre = 0;
    try { nombre = Number(((OK.getCenter(centre) || {}).resources || {}).bowling.laneCount) || 0; } catch (e) { nombre = 0; }
    const s = await db.readStaffState(aujourdhui(), centre);
    return { nombre, statuts: s.laneStatuses || {}, maintenance: s.laneMaintenance || {}, reservations: s.reservations || [] };
  },
  // Le plan de retard tel que delayApply le recalculera : la journee lue maintenant, blocages compris,
  // avec les horaires de l equipe.
  async impactDuRetard(centre, numero, minutes, raison) {
    const db = require('./database');
    return require('./booking-config').pourLEquipe(async () => {
      const r = await db.getReservationById(Number(numero));
      if (!r) return null;
      const s = await db.readStaffState(r.date, r.centerId || 'libramont', { avecBlocages: true });
      return require('./ops-engine').computeDelayImpact({ centerId: r.centerId || 'libramont', date: r.date, reservationId: Number(numero), delayMinutes: minutes, reasonId: raison }, { reservations: s.reservations, laneStatuses: s.laneStatuses });
    });
  },
  // LE RETARD APPLIQUE A UN DOSSIER : l incident que delayApply ecrit (ops_delay_incidents), le dernier
  // de ce centre pour cette reservation. La console le tient de la reponse de delayApply ; la carte le
  // relit ici, a chaque passage.
  async retardApplique(centre, numero) {
    const db = require('./database');
    const lu = await db.getPool().query(
      "select id from ops_delay_incidents where center_id = $1 and reservation_id = $2 and status = 'applied' order by coalesce(applied_at, created_at) desc, id desc limit 1;",
      [String(centre), Number(numero)],
    );
    return lu.rows[0] ? db.getDelayIncidentById(lu.rows[0].id) : null;
  },
  // Les clients deja prevenus de cet incident : delayNotify enfile un mail par dossier a la cle
  // delaychange:<incident>:<reservation>:<canal> (lib/ops-communications.js).
  async prevenusDuRetard(centre, incident) {
    const lu = await require('./database').getPool().query(
      'select reservation_id, status from communications where center_id = $1 and idempotency_key like $2;',
      [String(centre), `delaychange:${Number(incident)}:%`],
    );
    return lu.rows.map((x) => ({ reservationId: Number(x.reservation_id), statut: String(x.status || '') }));
  },
  // Ce dont la fiche a besoin pour dessiner le programme d un groupe (lib/programme-a-cocher.js) : les
  // postes de l arene du centre (ils decoupent les vagues) et son catalogue de formules, comptoir compris.
  async reglagesDuProgramme(centre) {
    const db = require('./database');
    const OK = require('./ops-knowledge');
    const BC = require('./booking-config');
    try { await OK.refreshCenterOverrides(db.getPool()); } catch (e) { /* socle fichier */ }
    try { await BC.refreshFormuleOverrides(db.getPool()); } catch (e) { /* socle fichier */ }
    const laser = ((OK.getCenter(centre) || {}).resources || {}).laser || {};
    return BC.pourLEquipe(() => ({ postes: Number(laser.weaponCount) || null, formules: BC.getEffectiveFormules(centre, { comptoir: true }) }));
  },
  // Les bilans de la page Direction (direction_reports), ceux de ce centre.
  async bilansDirection(centre) {
    return require('./database').listDirectionReports({ centerId: centre, limit: 100 });
  },
  // LE DEPLACEMENT D UNE ACTIVITE, JUGE COMME LA FICHE LE JUGERA (api/staff-reservations.js,
  // activityMove) : le dossier relu, le plan refait pour cette seule activite (buildActivityMove :
  // horaires, formule, chevauchement dans le dossier), puis les pistes et l arene contre la journee
  // lue maintenant, blocages compris (validateActivityMoveResources). Rien ne s ecrit.
  async apercuDuDeplacement(centre, numero, mouvement) {
    const db = require('./database');
    const BC = require('./booking-config');
    try { await require('./ops-knowledge').refreshCenterOverrides(db.getPool()); } catch (e) { /* socle fichier */ }
    try { await BC.refreshFormuleOverrides(db.getPool()); } catch (e) { /* prix fichier */ }
    try { await require('./catalog-store').refreshCatalog(db.getPool()); } catch (e) { /* catalogue fichier */ }
    return BC.pourLEquipe(async () => {
      const r = await db.getReservationById(Number(numero));
      if (!r || String(r.centerId || 'libramont') !== String(centre)) return null;
      const move = JSON.parse(String(mouvement));
      const candidat = require('./reservation-activity-move').buildActivityMove(r, move);
      const s = await db.readStaffState(r.date, r.centerId || 'libramont', { avecBlocages: true });
      try {
        db.validateActivityMoveResources(candidat, move, (s.reservations || []).filter((x) => Number(x.id) !== Number(r.id)), s.laneStatuses || {}, s.blocks || [], r.date);
      } catch (e) { if (!e.statusCode) e.statusCode = 409; throw e; }
      return candidat;
    });
  },
};

function gestes(A) {
  const { erreur, sans, coupe, euros, rempli, nombre, booleen, trouver } = A;

  const numeroDe = (saisie, quoi) => nombre(saisie, { min: 1, max: NUMERO_MAX, quoi, entier: true });
  const texteNet = (v) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const ligneNette = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const personnes = (n) => `${n} personne${n > 1 ? 's' : ''}`;
  const dossierDit = (r) => `n° ${r.id}${r.name ? ` de ${coupe(r.name, 60)}` : ''}, le ${jourDit(r.date)} à ${heureDe(r)}`;
  const ligneDossier = (r) => ({ libelle: 'Réservation', valeur: `n° ${r.id}${r.name ? `, ${coupe(r.name, 60)}` : ''}, ${jourDit(r.date)} à ${heureDe(r)}, ${personnes(Number(r.pax) || 0)}` });
  const etatDit = (r) => (r.absentAt && !['arrived', 'paid', 'cancelled'].includes(r.status) ? 'Pas venu' : (r.validationStatus === 'staff_review' && r.status !== 'cancelled' ? 'À vérifier' : (STATUTS[r.status] || r.status)));

  function exigerAussi(ctx, droit, phrase) {
    if (!require('./staff-auth').sessionHasPermission(ctx.session, droit)) throw erreur(phrase, 403);
  }

  // UN DOSSIER DE CE CENTRE, relu maintenant. Un numero d un autre centre se refuse comme un numero
  // inconnu : rien ne dit qu il existe ailleurs. Sa version est celle que l ecriture portera.
  async function dossierDuCentre(ctx, saisie) {
    const numero = numeroDe(saisie, 'Le numéro de la réservation');
    const r = await ctx.lire('dossierResa', numero);
    if (!r || Number(r.id) !== numero || String(r.centerId || 'libramont') !== String(ctx.centre)) {
      throw erreur(`La réservation n° ${numero} n’existe pas dans ce centre. Lisez son numéro dans lister_reservations, planning_du_jour ou fiche_client.`, 404);
    }
    const version = versionDe(r.updatedAt);
    if (!version) throw erreur(`La réservation n° ${numero} n’a pas de version lisible : rechargez-la avant d’agir.`, 409);
    return { ...r, version };
  }

  async function demandeDuCentre(ctx, saisie) {
    const numero = numeroDe(saisie, 'Le numéro de la demande');
    const d = await ctx.lire('demandeSurMesure', numero);
    if (!d || Number(d.id) !== numero || String(d.centerId || 'libramont') !== String(ctx.centre)) throw erreur(`La demande n° ${numero} n’existe pas dans ce centre. Lisez son numéro dans demandes_sur_mesure.`, 404);
    return d;
  }

  async function filDuCentre(ctx, saisie) {
    const numero = numeroDe(saisie, 'Le numéro de la conversation');
    const fil = await ctx.lire('filDeMails', numero);
    if (!fil || !fil.thread || Number(fil.thread.id) !== numero || String(fil.thread.centerId || '') !== String(ctx.centre)) throw erreur(`La conversation n° ${numero} n’existe pas dans ce centre. Lisez son numéro (fil) dans mails_clients.`, 404);
    return fil;
  }

  function adresseDe(saisie) {
    const email = String(saisie == null ? '' : saisie).trim().toLowerCase();
    if (!EMAIL_RX.test(email) || email.length > 200) throw erreur('Donnez une adresse mail valide.');
    return email;
  }

  // LA CLE DE LA TENTATIVE NAIT SUR LA CARTE ET REVIENT AU CLIC (relance, SMS) : deux clics, un envoi.
  const tentativeDe = (p) => (/^assistant-[0-9a-f-]{36}$/.test(String(p.tentative || '')) ? String(p.tentative) : `assistant-${require('crypto').randomUUID()}`);

  const quiDemande = (d) => [d.contactName, d.company].filter(Boolean).map((x) => coupe(x, 60)).join(', ') || `n° ${d.id}`;
  // La proposition telle que la console l envoie (rqChoixPourLeServeur, assets/app-main.js).
  const pourLeServeur = (c) => ({ date: c.date, type: c.type, ref: c.ref, heure: c.heure, fin: c.fin, nom: c.nom, prix: c.prix, joueurs: c.joueurs, formule: c.formule, activites: c.activites, plus: c.plus, prixLibre: c.prixLibre, extras: Array.isArray(c.extras) ? c.extras : [] });

  return {
    // ── Le dossier d une reservation (api/staff-reservations.js : la fiche) ──
    statut_reservation: {
      domaine: 'Réservations', titre: 'Statut d’une réservation', verbe: 'Changer le statut', cours: 'Enregistrement…', confirmer: 'Oui, changer le statut',
      quoi: 'pointe une réservation Confirmé, Arrivé ou Payé (avec le moyen de paiement) ; annuler reste annuler_reservation',
      parametres: { reservation: 'son numéro, lu dans lister_reservations, planning_du_jour ou fiche_client', statut: 'confirme, arrive ou paye', moyen: 'pour paye : Carte, Espèces, Carte Bancaire ou Comptoir' },
      action: 'setReservationStatus', endpoint: 'staff-reservations', methode: 'PATCH', permission: ['reservations.status', 'reservations.edit'],
      risque: (p, prep) => prep.argent, demande: mots(PAYER, REGLER, ENCAISSER, verbe('arriv', 'e|es|ent|é|ée|és|ées|er|ez'), CONFIRMER, verbe('point', 'e|es|ez|er|ons|é|ée'), REMETTRE, PASSER, verbe('annul'), 'tromp'),
      async preparer(p, ctx) {
        const r = await dossierDuCentre(ctx, p.reservation);
        if (/annul|cancel/.test(sans(p.statut))) throw erreur('Annuler une réservation, c’est le geste annuler_reservation de proposer_un_geste.');
        const voulu = trouver(CHOIX_STATUT, p.statut, { quoi: 'le statut : confirme, arrive ou paye' });
        if (r.status === 'cancelled') throw erreur(`La réservation n° ${r.id} est annulée : pour la remettre au planning, c’est retablir_reservation_annulee.`);
        const corps = { id: r.id, baseUpdatedAt: r.version, status: voulu.id };
        const lignes = [ligneDossier(r), { libelle: 'Statut', avant: etatDit(r), apres: voulu.name }];
        if (voulu.id === 'paid') {
          exigerAussi(ctx, 'payments.markPaid', 'Le rôle de cette personne ne permet pas d’encaisser.');
          const moyen = trouver(MOYENS, p.moyen, { quoi: 'le moyen de paiement : Carte, Espèces, Carte Bancaire ou Comptoir' });
          if (r.status === 'paid' && r.paymentMethod === moyen.id) throw erreur(`La réservation n° ${r.id} est déjà payée, par ${moyen.name}.`);
          corps.paymentMethod = moyen.id;
          lignes.push({ libelle: 'Paiement', avant: r.paymentMethod || 'aucun', apres: moyen.name }, { libelle: 'Prix', valeur: euros(r.price) });
        } else if (r.status === voulu.id) {
          throw erreur(`La réservation n° ${r.id} est déjà « ${voulu.name} ».`);
        }
        const alertes = [];
        if (r.status === 'paid' && voulu.id !== 'paid') alertes.push('Le dossier ne compte plus comme payé : son montant sort de la caisse du jour.');
        if (r.absentAt && voulu.id !== 'pending') alertes.push('Le groupe était noté pas venu : ses places lui reviennent si personne ne les a prises, sinon le logiciel refuse.');
        return {
          corps,
          texte: `Passer la réservation ${dossierDit(r)} à « ${voulu.name} »${corps.paymentMethod ? `, par ${corps.paymentMethod}` : ''}.`,
          lignes,
          clients: null,
          alerte: alertes.join(' ') || null,
          fait: `La réservation n° ${r.id} passe à « ${voulu.name} ».`,
          argent: voulu.id === 'paid' || r.status === 'paid',
        };
      },
    },

    noter_pas_venu: {
      domaine: 'Réservations', titre: 'Groupe pas venu', verbe: 'Appliquer', cours: 'Enregistrement…', confirmer: 'Oui, noter pas venu',
      quoi: 'note qu’un groupe n’est pas venu, une fois son heure passée (ses places sont rendues), ou retire cette absence',
      parametres: { reservation: 'son numéro, lu dans lister_reservations, planning_du_jour ou fiche_client', absent: 'oui pour noter le groupe absent (par défaut), non pour retirer l’absence' },
      action: 'noterAbsence', endpoint: 'staff-reservations', methode: 'PATCH', permission: ['reservations.status', 'reservations.edit'],
      risque: (p, prep) => prep.absent, demande: mots('(?:pas|jamais)\\s+(?:[ée]t[ée]\\s+)?(?:venu|arriv)', 'absent', 'no.?show', 'pas\\s+l[aà](?!\\p{L})', 'lapin', RETIRER, ENLEVER, 'tromp'),
      async preparer(p, ctx) {
        const r = await dossierDuCentre(ctx, p.reservation);
        if (!Object.prototype.hasOwnProperty.call(r, 'absentAt')) throw erreur('La base de ce centre ne sait pas encore noter une absence.', 409);
        const absent = rempli(p.absent) ? booleen(p.absent, 'l’absence') : true;
        if (absent) {
          if (r.absentAt) throw erreur(`Le groupe de la réservation n° ${r.id} est déjà noté pas venu.`);
          if (['arrived', 'paid', 'cancelled'].includes(r.status)) throw erreur(`La réservation n° ${r.id} est « ${STATUTS[r.status]} » : un groupe arrivé, payé ou annulé ne se note pas absent.`);
          const j = require('./center-facts').jourDuCentre() || {};
          const passee = r.date < j.date || (r.date === j.date && Number(j.heure) * 60 >= minutesDe(r.startTime));
          if (!passee) throw erreur(`L’heure du groupe n’est pas encore passée (${jourDit(r.date)} à ${heureDe(r)}) : il peut encore arriver.`);
        } else if (!r.absentAt) {
          throw erreur(`Le groupe de la réservation n° ${r.id} n’est pas noté pas venu.`);
        }
        return {
          corps: { id: r.id, baseUpdatedAt: r.version, absent },
          texte: absent ? `Noter que le groupe de la réservation ${dossierDit(r)} n’est pas venu.` : `Retirer l’absence de la réservation ${dossierDit(r)}.`,
          lignes: [ligneDossier(r), { libelle: 'Groupe', avant: absent ? 'attendu' : 'pas venu', apres: absent ? 'pas venu' : 'attendu' }],
          clients: null,
          alerte: absent ? 'Le groupe sort des visites et du chiffre, et ses places sont rendues : le comptoir et le formulaire en ligne peuvent les revendre.' : 'Ses places lui reviennent si personne ne les a prises entre-temps ; sinon le logiciel refuse et dit qui les a.',
          fait: absent ? `Le groupe de la réservation n° ${r.id} est noté pas venu.` : `L’absence de la réservation n° ${r.id} est retirée.`,
          absent,
        };
      },
    },

    note_equipe_reservation: {
      domaine: 'Réservations', titre: 'Note d’équipe sur une réservation', verbe: 'Ajouter la note', cours: 'Enregistrement…',
      quoi: 'ajoute une note pour l’équipe sur une réservation (ce que le comptoir doit savoir), signée de votre nom ; le client ne la voit pas',
      parametres: { reservation: 'son numéro, lu dans lister_reservations, planning_du_jour ou fiche_client', texte: 'la note, 500 caractères au plus' },
      action: 'ajouterNoteEquipe', endpoint: 'staff-reservations', methode: 'PATCH', permission: ['reservations.status', 'reservations.edit'], risque: false,
      async preparer(p, ctx) {
        const r = await dossierDuCentre(ctx, p.reservation);
        const texte = texteNet(p.texte);
        if (texte.length < 2) throw erreur('La note est vide.');
        if (texte.length > 500) throw erreur('Une note d’équipe fait 500 caractères au plus.');
        // La limite du serveur (lib/database.js, NOTE_EQUIPE_MAX) : 30 notes par dossier.
        if (String(r.notes || '').split('\n').filter((l) => l.startsWith('[equipe] ')).length >= 30) throw erreur('Ce dossier a déjà 30 notes d’équipe : retirez-en une dans sa fiche avant d’en ajouter.');
        return {
          corps: { id: r.id, noteEquipe: { ajout: texte } },
          texte: `Ajouter une note d’équipe à la réservation ${dossierDit(r)}.`,
          lignes: [ligneDossier(r), { libelle: 'Note', valeur: coupe(texte, 220), long: texte }, { libelle: 'Signée', valeur: nomDeSession(ctx.session) || 'Équipe' }],
          clients: null,
          fait: `La note est ajoutée à la réservation n° ${r.id}.`,
        };
      },
    },

    encaisser: {
      domaine: 'Réservations', titre: 'Montant encaissé', verbe: 'Enregistrer le montant', cours: 'Enregistrement…', confirmer: 'Oui, enregistrer ce montant',
      quoi: 'note le montant réellement encaissé sur une réservation payée (remise, geste, joueur en moins), avec sa raison',
      parametres: { reservation: 'son numéro, lu dans lister_reservations, planning_du_jour ou fiche_client', montant: 'le montant encaissé, en euros', raison: 'pourquoi il diffère du prix, 200 caractères au plus (obligatoire s’il diffère)' },
      action: 'noterEncaisse', endpoint: 'staff-reservations', methode: 'PATCH', permission: 'payments.markPaid', risque: true,
      demande: mots(ENCAISSER, PAYER, REGLER, verbe('rembours', 'e|es|ez|er|ons|é|ée'), verbe('offr', 'e|es|ez|ir|ons'), 'offert', 'ristourn', 'remise\\s+de\\s+\\d', 'fai(?:s|tes)[-\\s](?:lui|leur)\\s+(?:une\\s+)?(?:remise|r[ée]duction|ristourne|geste)', verbe('r[ée]dui', 's|t|re|sez')),
      async preparer(p, ctx) {
        const r = await dossierDuCentre(ctx, p.reservation);
        exigerAussi(ctx, ['reservations.status', 'reservations.edit'], 'Le rôle de cette personne ne permet pas de changer un dossier.');
        if (!Object.prototype.hasOwnProperty.call(r, 'amountPaid')) throw erreur('La base de ce centre ne sait pas encore noter le montant encaissé.', 409);
        if (r.status !== 'paid') throw erreur(`La réservation n° ${r.id} n’est pas payée : passez-la d’abord à Payé avec statut_reservation.`);
        const montant = nombre(p.montant, { min: 0, max: 100000, quoi: 'Le montant encaissé' });
        const prix = Number(r.price) || 0;
        const egal = Math.round(montant * 100) === Math.round(prix * 100);
        const raison = ligneNette(p.raison);
        if (raison.length > 200) throw erreur('La raison fait 200 caractères au plus.');
        if (!egal && !raison) throw erreur('Dites pourquoi le montant diffère du prix (remise, geste, joueur en moins…).');
        const avant = r.amountPaid != null ? Number(r.amountPaid) : prix;
        if (Math.round(avant * 100) === Math.round(montant * 100) && (egal || raison === String(r.discountReason || ''))) throw erreur(`La réservation n° ${r.id} est déjà notée à ${euros(montant)} encaissés.`);
        return {
          corps: { id: r.id, baseUpdatedAt: r.version, encaissement: { montant, raison } },
          texte: `Noter ${euros(montant)} encaissés sur la réservation ${dossierDit(r)}.`,
          lignes: [ligneDossier(r), { libelle: 'Prix du dossier', valeur: euros(prix) }, { libelle: 'Encaissé', avant: euros(avant), apres: euros(montant) }, ...(egal ? [] : [{ libelle: 'Raison', valeur: raison }])],
          clients: null,
          alerte: montant < prix ? `${euros(Math.round((prix - montant) * 100) / 100)} de moins que le prix : le chiffre du jour le compte ainsi.` : null,
          fait: `${euros(montant)} encaissés sont notés sur la réservation n° ${r.id}.`,
        };
      },
    },

    valider_reservation_en_attente: {
      domaine: 'Réservations', titre: 'Réservation validée', verbe: 'Valider la réservation', cours: 'Validation…', confirmer: 'Oui, valider',
      quoi: 'valide une réservation restée « À vérifier » (demande en ligne à contrôler) : elle devient confirmée',
      parametres: { reservation: 'son numéro, lu dans lister_reservations, planning_du_jour ou fiche_client' },
      action: 'updateReservation', endpoint: 'staff-reservations', methode: 'PATCH', permission: 'reservations.edit', risque: true,
      demande: mots(VALIDER, CONFIRMER, ACCEPTER, 'ok(?!\\p{L})', 'd.accord'),
      async preparer(p, ctx) {
        const r = await dossierDuCentre(ctx, p.reservation);
        if (r.status === 'cancelled') throw erreur(`La réservation n° ${r.id} est annulée : elle ne se valide plus.`);
        if ((r.validationStatus || 'confirmed') === 'confirmed') throw erreur(`La réservation n° ${r.id} est déjà validée.`);
        if (r.date < aujourdhui()) exigerAussi(ctx, 'planning.past', 'Cette réservation est passée : la valider demande le droit de changer un jour passé.');
        return {
          corps: { id: r.id, baseUpdatedAt: r.version, validationStatus: 'confirmed', skipReplan: true },
          texte: `Valider la réservation ${dossierDit(r)}.`,
          lignes: [ligneDossier(r), { libelle: 'État', avant: 'À vérifier', apres: 'Confirmé' }],
          clients: r.email ? `${r.email} reçoit le mail de confirmation de la réservation, si la séquence « Confirmation de réservation » est allumée.` : 'Ce client n’a pas d’adresse mail : aucun mail ne part.',
          fait: `La réservation n° ${r.id} est validée.`,
        };
      },
    },

    retablir_reservation_annulee: {
      domaine: 'Réservations', titre: 'Réservation rétablie', verbe: 'Rétablir la réservation', cours: 'Rétablissement…', confirmer: 'Oui, rétablir',
      quoi: 'remet au planning une réservation à venir qui avait été annulée, à son heure et sur ses pistes si elles sont encore libres',
      parametres: { reservation: 'son numéro, lu dans lister_reservations ou fiche_client' },
      action: 'setReservationStatus', endpoint: 'staff-reservations', methode: 'PATCH', permission: 'reservations.cancel', risque: true,
      demande: mots('r[ée]tabli', REMETTRE, verbe('restaur'), verbe('r[ée]activ'), 'revenir', 'reprend', 'd[ée]sannul'),
      async preparer(p, ctx) {
        const r = await dossierDuCentre(ctx, p.reservation);
        exigerAussi(ctx, ['reservations.status', 'reservations.edit'], 'Le rôle de cette personne ne permet pas de changer un dossier.');
        if (r.status !== 'cancelled') throw erreur(`La réservation n° ${r.id} n’est pas annulée.`);
        if (r.date < aujourdhui()) throw erreur(`La réservation n° ${r.id} est passée : elle ne se rétablit plus.`);
        return {
          corps: { id: r.id, baseUpdatedAt: r.version, status: 'pending' },
          texte: `Rétablir la réservation ${dossierDit(r)}.`,
          lignes: [ligneDossier(r), { libelle: 'Statut', avant: 'Annulé', apres: 'Confirmé' }, { libelle: 'Pistes', valeur: (r.lanes || []).length ? (r.lanes || []).join(', ') : 'aucune' }],
          clients: r.email ? 'Ses mails automatiques repartent comme pour une réservation confirmée : le client reçoit le rappel avant sa venue.' : null,
          alerte: 'Si sa piste ou sa place a été reprise entre-temps, le logiciel refuse et dit par qui : placez alors le groupe avec Modifier.',
          fait: `La réservation n° ${r.id} est de nouveau au planning.`,
        };
      },
    },

    modifier_reservation: {
      domaine: 'Réservations', titre: 'Réservation modifiée', verbe: 'Enregistrer', cours: 'Enregistrement…', confirmer: 'Oui, enregistrer',
      quoi: 'change le jour, l’heure, le nom, le téléphone, l’e-mail ou le prix d’une réservation (le planning se refait au clic) ; les joueurs et les activités se changent dans sa fiche',
      parametres: { reservation: 'son numéro, lu dans lister_reservations, planning_du_jour ou fiche_client', date: 'facultatif, AAAA-MM-JJ', heure: 'facultatif, HH:MM', nom: 'facultatif', telephone: 'facultatif', email: 'facultatif', prix: 'facultatif, le prix total en euros', raison_prix: 'obligatoire si le prix change : pourquoi (geste commercial, erreur de saisie…)' },
      action: 'updateReservation', endpoint: 'staff-reservations', methode: 'PATCH', permission: 'reservations.edit', risque: true,
      demande: mots(MODIFIER, CHANGER, verbe('d[ée]plac', 'e|es|ez|er|ons|é|ée'), verbe('report'), verbe('avanc'), verbe('recul'), verbe('d[ée]cal', 'e|es|ez|er|ons|é|ée'), METTRE, PASSER, CORRIGER, REMPLACER, AJOUTER, ENLEVER, RETIRER, 'ser(?:a|ont)\\s+(?:finalement\\s+|plut[oô]t\\s+)?\\d', 'au\\s+lieu\\s+de', 'plus\\s+t(?:[oô]t|ard)'),
      async preparer(p, ctx) {
        const r = await dossierDuCentre(ctx, p.reservation);
        if (r.status === 'cancelled') throw erreur(`La réservation n° ${r.id} est annulée : rétablissez-la d’abord avec retablir_reservation_annulee.`);
        const jour = aujourdhui();
        if (r.date < jour) exigerAussi(ctx, 'planning.past', 'Cette réservation est passée : la changer demande le droit de changer un jour passé.');
        const corps = { id: r.id, baseUpdatedAt: r.version };
        const lignes = [ligneDossier(r)];
        if (rempli(p.date)) {
          const d = dateReelle(p.date);
          if (!d) throw erreur('La date se donne en AAAA-MM-JJ.');
          if (d < jour) throw erreur('Une réservation ne se déplace pas dans le passé.');
          if (d !== r.date) { corps.date = d; lignes.push({ libelle: 'Jour', avant: jourDit(r.date), apres: jourDit(d) }); }
        }
        if (rempli(p.heure)) {
          const h = String(p.heure).trim();
          if (!HEURE_RX.test(h)) throw erreur('L’heure se donne en HH:MM.');
          if (h !== heureDe(r)) { corps.startTime = h; lignes.push({ libelle: 'Heure', avant: heureDe(r), apres: h }); }
        }
        if (rempli(p.nom)) {
          const nom = ligneNette(p.nom);
          if (nom.length > 120) throw erreur('Le nom fait 120 caractères au plus.');
          if (nom !== String(r.name || '')) { corps.name = nom; lignes.push({ libelle: 'Nom', avant: r.name || 'aucun', apres: nom }); }
        }
        if (rempli(p.telephone)) {
          const T = require('./telephone-du-client');
          if (!T.telephoneValide(p.telephone)) throw erreur('Ce numéro de téléphone n’est pas valide.');
          const tel = T.telephoneMisEnForme(p.telephone);
          if (T.chiffresDuTelephone(tel) !== T.chiffresDuTelephone(r.phone)) { corps.phone = tel; lignes.push({ libelle: 'Téléphone', avant: r.phone || 'aucun', apres: tel }); }
        }
        if (rempli(p.email)) {
          const email = adresseDe(p.email);
          if (email !== String(r.email || '').trim().toLowerCase()) { corps.email = email; lignes.push({ libelle: 'E-mail', avant: r.email || 'aucun', apres: email }); }
        }
        if (rempli(p.prix)) {
          const prix = nombre(p.prix, { min: 0, max: 100000, quoi: 'Le prix' });
          if (Math.round(prix * 100) !== Math.round((Number(r.price) || 0) * 100)) {
            const raison = ligneNette(p.raison_prix);
            if (!raison) throw erreur('Dites pourquoi le prix change (geste commercial, erreur de saisie…) : la raison s’écrit dans la note du dossier.');
            if (raison.length > 200) throw erreur('La raison du prix fait 200 caractères au plus.');
            corps.price = prix;
            corps.prixRaison = raison;
            lignes.push({ libelle: 'Prix', avant: euros(r.price), apres: euros(prix) }, { libelle: 'Raison du prix', valeur: raison });
          }
        }
        if (lignes.length === 1) throw erreur('Dites ce qui change : jour, heure, nom, téléphone, e-mail ou prix, différent de ce que le dossier porte.');
        // UN AUTRE JOUR SE RECOMPTE AU TARIF DE CE JOUR (api/staff-reservations.js : seul un dossier qui
        // reste sur sa journee garde ses montants). Un prix pose dans le meme geste n en sortirait pas.
        if (corps.date && corps.price !== undefined) throw erreur('Changez d’abord le jour, puis le prix : le prix se recompte avec le jour.');
        const bouge = Boolean(corps.date || corps.startTime);
        const clients = [bouge ? 'Le rappel avant la venue repartira avec le nouveau créneau. Le client n’est pas prévenu autrement : écrivez-lui avec ecrire_ou_repondre_mail.' : '', corps.email ? 'Les prochains mails automatiques partiront à la nouvelle adresse.' : ''].filter(Boolean).join(' ');
        const alertes = [bouge ? 'Le planning se refait au clic : si le nouveau créneau ne tient pas (pistes, laser), le logiciel refuse et rien ne change.' : '', corps.date ? 'Le prix peut changer avec le jour : le logiciel le recompte au tarif du nouveau jour.' : ''].filter(Boolean);
        return {
          corps,
          texte: `Modifier la réservation ${dossierDit(r)}.`,
          lignes,
          clients: clients || null,
          alerte: alertes.join(' ') || null,
          fait: `La réservation n° ${r.id} est modifiée.`,
        };
      },
    },

    supprimer_reservation: {
      domaine: 'Réservations', titre: 'Réservation supprimée', verbe: 'Supprimer la réservation', cours: 'Suppression…', confirmer: 'Oui, supprimer', danger: true,
      quoi: 'supprime une réservation créée par erreur ou en double (une copie reste au registre des suppressions) ; un client qui ne vient plus s’annule avec annuler_reservation',
      parametres: { reservation: 'son numéro, lu dans lister_reservations, planning_du_jour ou fiche_client', raison: 'pourquoi, 500 caractères au plus' },
      action: 'deleteReservation', endpoint: 'staff-reservations', methode: 'DELETE', permission: 'reservations.cancel', risque: true, demande: SUPPRIMER,
      async preparer(p, ctx) {
        const r = await dossierDuCentre(ctx, p.reservation);
        if (r.date < aujourdhui()) exigerAussi(ctx, 'planning.past', 'Cette réservation est passée : la supprimer demande le droit de changer un jour passé.');
        const raison = ligneNette(p.raison);
        if (raison.length > 500) throw erreur('La raison fait 500 caractères au plus.');
        const dite = raison || 'Supprimée avec l’assistant';
        return {
          corps: { id: r.id, reason: dite },
          texte: `Supprimer la réservation ${dossierDit(r)}.`,
          lignes: [ligneDossier(r), { libelle: 'Statut', valeur: etatDit(r) }, { libelle: 'Prix', valeur: euros(r.price) }, { libelle: 'Raison', valeur: dite }],
          clients: 'Ses mails automatiques en attente (rappel…) sont annulés. Le client n’est pas prévenu.',
          alerte: `La réservation quitte le planning et les listes${r.status === 'paid' ? ', et son montant payé sort du chiffre' : ''}. Une copie reste au registre des suppressions : elle peut revenir avec restaurer_reservation_supprimee.`,
          fait: `La réservation n° ${r.id} est supprimée. Sa copie reste au registre des suppressions.`,
        };
      },
    },

    restaurer_reservation_supprimee: {
      domaine: 'Réservations', titre: 'Réservation restaurée', verbe: 'Restaurer la réservation', cours: 'Restauration…', confirmer: 'Oui, restaurer',
      quoi: 'remet au planning une réservation supprimée, avec son numéro d’origine, si son créneau est encore libre',
      parametres: { reservation: 'le numéro qu’elle avait, ou celui de sa copie au registre des suppressions' },
      action: 'restoreReservation', permission: 'reservations.cancel', risque: true,
      demande: mots(verbe('restaur'), 'r[ée]cup[eéè]r', REMETTRE, 'revenir', 'reviens', 'ressort', 'r[ée]tabli'),
      async preparer(p, ctx) {
        const numero = numeroDe(p.reservation, 'Le numéro de la réservation');
        const liste = ((await ctx.lire('registreSuppressions')) || []).filter((a) => a && !a.restoredAt && String(a.centerId || '') === String(ctx.centre));
        const a = liste.find((x) => Number(x.reservationId) === numero) || liste.find((x) => Number(x.id) === numero);
        if (!a) throw erreur(`Aucune réservation supprimée n° ${numero} n’attend dans le registre de ce centre.`, 404);
        const r = a.reservation || {};
        return {
          corps: { archiveId: a.id, force: false },
          texte: `Restaurer la réservation n° ${a.reservationId}${r.name ? ` de ${coupe(r.name, 60)}` : ''}.`,
          lignes: [{ libelle: 'Réservation', valeur: `n° ${a.reservationId}${r.name ? `, ${coupe(r.name, 60)}` : ''}${r.date ? `, ${jourDit(r.date)} à ${heureDe(r)}` : ''}${r.pax ? `, ${personnes(Number(r.pax))}` : ''}` }, { libelle: 'Supprimée', valeur: `${a.archivedBy ? `par ${coupe(a.archivedBy, 60)}` : 'par l’équipe'}${a.reason ? ` : ${coupe(a.reason, 120)}` : ''}` }, { libelle: 'Statut', valeur: STATUTS[r.status] || 'Confirmé' }],
          clients: 'Le client n’est pas prévenu.',
          alerte: 'Si son créneau a été repris entre-temps, le logiciel refuse : libérez-le, ou recréez la réservation à une autre heure.',
          fait: `La réservation n° ${a.reservationId} est revenue au planning.`,
        };
      },
    },

    // ── Les demandes sur mesure ──
    noter_demande: {
      domaine: 'Demandes', titre: 'Note sur une demande', verbe: 'Ajouter la note', cours: 'Enregistrement…',
      quoi: 'ajoute une note d’équipe sur une demande sur mesure (ce qu’un collègue doit savoir) ; le client ne la voit pas',
      parametres: { demande: 'son numéro, lu dans demandes_sur_mesure', texte: 'la note, 1 500 caractères au plus' },
      action: 'customRequestNote', permission: ['clients.view', 'reservations.edit'], risque: false,
      async preparer(p, ctx) {
        const d = await demandeDuCentre(ctx, p.demande);
        const texte = texteNet(p.texte);
        if (texte.length < 2) throw erreur('La note est vide.');
        if (texte.length > 1500) throw erreur('Une note de demande fait 1 500 caractères au plus.');
        return {
          corps: { id: d.id, texte },
          texte: `Ajouter une note à la demande de ${quiDemande(d)}.`,
          lignes: [{ libelle: 'Demande', valeur: `n° ${d.id}, ${quiDemande(d)}` }, { libelle: 'Note', valeur: coupe(texte, 220), long: texte }, { libelle: 'Signée', valeur: nomDeSession(ctx.session) || 'Équipe' }],
          clients: null,
          fait: `La note est ajoutée à la demande n° ${d.id}.`,
        };
      },
    },

    reserver_la_demande: {
      domaine: 'Demandes', titre: 'Réservation d’une demande', verbe: 'Créer la réservation', cours: 'Création…', confirmer: 'Oui, créer la réservation',
      quoi: 'crée la réservation d’une demande sur mesure telle que la dernière proposition envoyée au client (quand il a dit oui) ; le planning est vérifié tout de suite',
      parametres: { demande: 'son numéro, lu dans demandes_sur_mesure' },
      action: 'customRequestBook', permission: 'reservations.create', risque: true,
      demande: mots(verbe('r[ée]serv'), 'cr[ée]e[sz]?(?!\\p{L})', 'cr[ée]er(?!\\p{L})', CONFIRMER, VALIDER, verbe('bloqu'), ACCEPTER, 'oui(?!\\p{L})', 'd.accord', 'ok(?!\\p{L})'),
      async preparer(p, ctx) {
        const d = await demandeDuCentre(ctx, p.demande);
        const suivi = require('./demande-bureau').resumeDuSuivi(d);
        if (suivi.reservationId) throw erreur(`La demande n° ${d.id} a déjà sa réservation (n° ${suivi.reservationId}).`, 409);
        const envoyee = suivi.proposition;
        if (!envoyee) throw erreur('Aucune proposition n’est partie au client pour cette demande : répondez-lui d’abord, ou préparez la réservation avec proposer_un_geste « reservation ».');
        if (envoyee.type !== 'libre' || !(Number(envoyee.joueurs) > 0)) throw erreur('La proposition envoyée ne porte pas un programme complet : préparez la réservation avec proposer_un_geste « reservation ».');
        const proposition = pourLeServeur(envoyee);
        // CE QUE LA CARTE A MONTRE, ET RIEN D AUTRE : une autre proposition partie entre-temps arrete le clic.
        const empreinte = empreinteDe(proposition);
        if (rempli(p.proposition_vue) && String(p.proposition_vue) !== empreinte) throw erreur('La proposition de cette demande a changé depuis la carte : redemandez la réservation pour relire la nouvelle.', 409);
        const sim = await ctx.lire('simulationDemande', d.id, proposition, ctx.session);
        const resume = (sim && sim.resume) || {};
        if (resume.refus) throw erreur(resume.refus, 403);
        if (Array.isArray(resume.conflits) && resume.conflits.length) throw erreur(`Ce créneau n’est plus libre : ${resume.conflits[0]}`, 409);
        const email = String(resume.email || d.email || '').trim();
        const extras = Array.isArray(resume.extras) ? resume.extras.filter((x) => x && x.nom).map((x) => `${coupe(x.nom, 40)} × ${Number(x.quantite) || 1}`) : [];
        const prix = resume.prix != null ? resume.prix : envoyee.prix;
        return {
          corps: { id: d.id, proposition, confirme: true },
          texte: `Créer la réservation de la demande de ${quiDemande(d)} : ${jourDit(proposition.date)} à ${proposition.heure}, ${personnes(Number(proposition.joueurs))}.`,
          lignes: [
            { libelle: 'Demande', valeur: `n° ${d.id}, ${quiDemande(d)}` },
            { libelle: 'Quand', valeur: `${jourDit(proposition.date)}, ${resume.fin ? `de ${proposition.heure} à ${resume.fin}` : `à ${proposition.heure}`}` },
            { libelle: 'Programme', valeur: `${coupe(resume.nom || proposition.nom || 'le programme', 120)}, ${personnes(Number(proposition.joueurs))}` },
            ...(Array.isArray(resume.pistes) && resume.pistes.length ? [{ libelle: 'Pistes', valeur: resume.pistes.join(', ') }] : []),
            ...(extras.length ? [{ libelle: 'Avec', valeur: extras.join(', ') }] : []),
            { libelle: 'Prix', valeur: prix != null ? euros(prix) : 'à confirmer' },
          ],
          clients: email ? `${email} reçoit le mail de confirmation de la réservation.` : 'Ce client n’a pas d’adresse mail : aucun mail ne part.',
          fait: `La réservation de la demande n° ${d.id} est créée.`,
          figer: { proposition_vue: empreinte },
        };
      },
    },

    // ── Les mails d un client ──
    ecrire_ou_repondre_mail: {
      domaine: 'Mails', titre: 'Mail à un client', verbe: 'Envoyer le mail', cours: 'Envoi…', confirmer: 'Oui, envoyer', danger: true,
      quoi: 'envoie tout de suite un mail : au client d’une réservation, en réponse dans une conversation, ou à une adresse ; la carte montre le destinataire et le texte entier',
      parametres: { reservation: 'facultatif : le numéro d’une réservation, le mail part à son client', conversation: 'facultatif : le numéro (fil) d’une conversation lue dans mails_clients, pour y répondre', a: 'facultatif : une adresse, seulement sans réservation ni conversation', nom: 'facultatif, avec a : le nom du destinataire', objet: 'l’objet (facultatif pour une réponse : « Re: » et le sujet)', texte: 'le texte entier, écrit comme le centre parle, sans variable {{…}}' },
      action: 'sendDirectEmail', permission: 'emails.send', risque: true,
      demande: mots(ECRIRE, 'r[ée]pond', ENVOYER, PREVENIR, 'dis.lui', 'dites.lui', 'demande.lui', verbe('contact'), 'transmet'),
      async preparer(p, ctx) {
        const voies = ['reservation', 'conversation', 'a'].filter((k) => rempli(p[k]));
        if (voies.length !== 1) throw erreur('Dites à qui écrire : une réservation, une conversation ou une adresse, une seule des trois.');
        let to = '';
        let nom = '';
        let reponseA = null;
        let fil = null;
        let objetDeReponse = '';
        if (voies[0] === 'reservation') {
          const r = await dossierDuCentre(ctx, p.reservation);
          to = String(r.email || '').trim().toLowerCase();
          nom = String(r.name || '');
          if (!to) throw erreur(`La réservation n° ${r.id} n’a pas d’adresse mail : appelez le client.`);
        } else if (voies[0] === 'conversation') {
          const lu = await filDuCentre(ctx, p.conversation);
          fil = lu.thread;
          to = String((lu.contact && lu.contact.email) || fil.contactEmail || '').trim().toLowerCase();
          nom = String((lu.contact && lu.contact.name) || fil.contactName || '');
          const entrant = [...(Array.isArray(lu.messages) ? lu.messages : [])].reverse().find((m) => m && m.direction === 'inbound');
          reponseA = entrant ? Number(entrant.id) : null;
          objetDeReponse = sujetSansPrefixe(fil.subject) ? `Re: ${sujetSansPrefixe(fil.subject)}` : '';
        } else {
          to = adresseDe(p.a);
          nom = ligneNette(p.nom).slice(0, 120);
        }
        if (!EMAIL_RX.test(to) || to.length > 200) throw erreur('L’adresse du destinataire n’est pas valide.');
        // L ADRESSE VUE SUR LA CARTE EST CELLE QUI RECOIT : changee entre-temps, l envoi s arrete.
        if (rempli(p.destinataire) && String(p.destinataire).trim().toLowerCase() !== to) throw erreur('L’adresse du client a changé depuis la carte : redemandez le mail pour relire la nouvelle.', 409);
        const objet = rempli(p.objet) ? ligneNette(p.objet) : objetDeReponse;
        if (!objet) throw erreur('Donnez un objet au mail.');
        if (objet.length > 200) throw erreur('L’objet fait 200 caractères au plus.');
        const texte = String(p.texte == null ? '' : p.texte).replace(/\r\n?/g, '\n').trim();
        if (!texte) throw erreur('Le mail est vide.');
        if (texte.length > 20000) throw erreur('Le mail fait 20 000 caractères au plus.');
        if (/\{\{|\}\}/.test(`${objet}\n${texte}`)) throw erreur('Écrivez le mail tel que le client le lira, sans variable {{…}} : le prénom, la date et l’heure en toutes lettres.');
        // LA CLE DE LA TENTATIVE NAIT SUR LA CARTE ET REVIENT AU CLIC : deux clics, un seul mail
        // (lib/ops-communications.js, sendDirectEmail ; la file refuse une seconde ligne a cette cle).
        const tentative = /^assistant-[0-9a-f-]{36}$/.test(String(p.tentative || '')) ? String(p.tentative) : `assistant-${require('crypto').randomUUID()}`;
        const de = ((await ctx.lire('expediteursMails')) || []).find((x) => x && x.isDefault) || null;
        return {
          corps: { to, name: nom, subject: objet, body: texte, identityId: de ? de.id : null, category: 'direct', ...(reponseA ? { replyToCommunicationId: reponseA } : {}), ...(fil ? { threadId: fil.id } : {}), attemptId: tentative },
          texte: `Envoyer un mail à ${nom ? coupe(nom, 60) : to}.`,
          lignes: [
            { libelle: 'À', valeur: nom ? `${coupe(nom, 60)} <${to}>` : to },
            ...(de ? [{ libelle: 'De', valeur: `${coupe(de.label, 60)} <${de.email}>` }] : []),
            ...(fil ? [{ libelle: 'En réponse à', valeur: coupe(fil.subject || `la conversation n° ${fil.id}`, 120) }] : []),
            { libelle: 'Objet', valeur: objet },
            { libelle: 'Texte', valeur: coupe(texte, 220), long: texte },
          ],
          clients: `${to} reçoit ce mail tout de suite. Un mail parti ne se rattrape pas.`,
          fait: `Le mail à ${nom ? coupe(nom, 60) : to} est parti.`,
          figer: { tentative, destinataire: to },
        };
      },
    },

    // ── Le client : la relance de la page Clients, le SMS de la fiche ──
    // Les deux partent avec une cle de tentative posee sur la carte (tentativeDe) : le serveur ne
    // renvoie rien a une cle deja vue (sendClientRelance, sendClientMessage, createCommunication).
    relancer_client: {
      domaine: 'Clients', titre: 'Relance d’un client', verbe: 'Envoyer la relance', cours: 'Envoi…', confirmer: 'Oui, envoyer la relance', danger: true,
      quoi: 'envoie tout de suite une relance au client d’une réservation (le bouton Relancer de la page Clients) : un mail pour qu’il revienne, compté dans le retour des relances ; la carte montre le destinataire et le texte entier',
      parametres: { reservation: 'le numéro d’une de ses réservations, lu dans fiche_client', motif: 'facultatif : anniversaire, dormant ou autre (par défaut)', objet: 'l’objet, 200 caractères au plus', texte: 'le texte entier, écrit comme le centre parle, sans variable {{…}}' },
      action: 'sendClientRelance', permission: 'emails.send', risque: true,
      demande: mots(verbe('relanc', 'e|ez|er|ons'), verbe('r[ée]activ'), ECRIRE, ENVOYER, PREVENIR, verbe('contact'), 'dis.lui', 'dites.lui'),
      async preparer(p, ctx) {
        const r = await dossierDuCentre(ctx, p.reservation);
        const to = String(r.email || '').trim().toLowerCase();
        if (!to) throw erreur(`La réservation n° ${r.id} n’a pas d’adresse mail : appelez le client.`);
        if (!EMAIL_RX.test(to) || to.length > 200) throw erreur('L’adresse du client n’est pas valide.');
        // L ADRESSE VUE SUR LA CARTE EST CELLE QUI RECOIT : changee entre-temps, la relance s arrete.
        const vue = rempli(p.destinataire) ? String(p.destinataire).trim().toLowerCase() : to;
        if (vue !== to) throw erreur('L’adresse du client a changé depuis la carte : redemandez la relance pour relire la nouvelle.', 409);
        const motif = rempli(p.motif) ? trouver(MOTIFS_RELANCE, p.motif, { quoi: 'le motif : anniversaire, dormant ou autre' }) : MOTIFS_RELANCE[MOTIFS_RELANCE.length - 1];
        const objet = ligneNette(p.objet);
        if (!objet) throw erreur('Donnez un objet à la relance.');
        if (objet.length > 200) throw erreur('L’objet fait 200 caractères au plus.');
        const texte = String(p.texte == null ? '' : p.texte).replace(/\r\n?/g, '\n').trim();
        if (!texte) throw erreur('La relance est vide.');
        if (texte.length > 20000) throw erreur('La relance fait 20 000 caractères au plus.');
        // Le filet de la page Clients (pv2FillVars) : une relance ne part jamais avec une variable.
        if (/\{\{|\}\}/.test(`${objet}\n${texte}`)) throw erreur('Écrivez la relance telle que le client la lira, sans variable {{…}} : son prénom en toutes lettres.');
        const tentative = tentativeDe(p);
        const retire = ((await ctx.lire('listeSuppression')) || []).find((e) => e && String(e.email || '').toLowerCase() === to);
        const nom = String(r.name || '');
        return {
          corps: { email: to, name: nom, phone: String(r.phone || ''), reason: motif.id, subject: objet, body: texte, attemptId: tentative },
          texte: `Relancer ${nom ? coupe(nom, 60) : to} par mail.`,
          lignes: [
            { libelle: 'À', valeur: nom ? `${coupe(nom, 60)} <${to}>` : to },
            { libelle: 'Motif', valeur: motif.name },
            { libelle: 'Objet', valeur: objet },
            { libelle: 'Texte', long: texte, valeur: coupe(texte, 220) },
          ],
          clients: `${to} reçoit cette relance tout de suite. Un mail parti ne se rattrape pas.`,
          alerte: retire ? `Ce client s’est retiré des mails marketing ${SOURCES_DE_RETRAIT[retire.source] || 'par l’équipe'} : une relance en est un, ne l’envoyez que s’il vous l’a redemandé.` : null,
          fait: `La relance à ${nom ? coupe(nom, 60) : to} est partie.`,
          figer: { tentative, destinataire: to },
        };
      },
    },

    sms_client: {
      domaine: 'Réservations', titre: 'SMS au client', verbe: 'Envoyer le SMS', cours: 'Envoi…', confirmer: 'Oui, envoyer le SMS', danger: true,
      quoi: 'envoie tout de suite un SMS au client d’une réservation (les messages de sa fiche) ; la carte montre le numéro et le texte entier. Un mail passe par ecrire_ou_repondre_mail',
      parametres: { reservation: 'son numéro, lu dans lister_reservations, planning_du_jour ou fiche_client', texte: 'le SMS entier, 480 caractères au plus, sans variable {{…}}' },
      action: 'clientMessageSend', permission: 'emails.send', risque: true,
      demande: mots(ENVOYER, ECRIRE, PREVENIR, verbe('textot'), verbe('contact'), 'dis.lui', 'dites.lui', 'demande.lui'),
      async preparer(p, ctx) {
        const OC = require('./ops-communications');
        const r = await dossierDuCentre(ctx, p.reservation);
        // Le canal de la fiche (CLIENT_MESSAGE_CHANNELS) : sans compte SMS, la fiche le grise.
        const canal = (OC.listClientMessageChannels(r) || []).find((c) => c && c.id === 'sms');
        if (!canal || !canal.available) throw erreur('Le SMS n’est pas encore activé pour ce centre (il demande un compte SMS) : écrivez-lui un mail avec ecrire_ou_repondre_mail, ou appelez-le.', 409);
        const numero = OC.normalizePhoneForSms(r.phone || '');
        if (!numero) throw erreur(`La réservation n° ${r.id} n’a pas de numéro de téléphone.`);
        // LE NUMERO VU SUR LA CARTE EST CELUI QUI RECOIT.
        if (rempli(p.destinataire) && String(p.destinataire).trim() !== numero) throw erreur('Le numéro du client a changé depuis la carte : redemandez le SMS pour relire le nouveau.', 409);
        const texte = String(p.texte == null ? '' : p.texte).replace(/\r\n?/g, '\n').trim();
        if (!texte) throw erreur('Le SMS est vide.');
        const max = Number(canal.maxLength) || 480;
        if (texte.length > max) throw erreur(`Un SMS fait ${max} caractères au plus, celui-ci en fait ${texte.length}.`);
        if (/\{\{|\}\}/.test(texte)) throw erreur('Écrivez le SMS tel que le client le lira, sans variable {{…}}.');
        const tentative = tentativeDe(p);
        const nom = String(r.name || '');
        return {
          corps: { reservationId: r.id, channel: 'sms', templateId: 'custom', subject: '', body: texte, attemptId: tentative },
          texte: `Envoyer un SMS à ${nom ? coupe(nom, 60) : numero}.`,
          lignes: [ligneDossier(r), { libelle: 'À', valeur: nom ? `${coupe(nom, 60)}, ${numero}` : numero }, { libelle: 'SMS', valeur: coupe(texte, 220), long: texte }, { libelle: 'Longueur', valeur: `${texte.length} caractères, ${Math.max(1, Math.ceil(texte.length / 160))} SMS` }],
          clients: `${numero} reçoit ce SMS tout de suite. Un SMS parti ne se rattrape pas.`,
          fait: `Le SMS à ${nom ? coupe(nom, 60) : numero} est parti.`,
          figer: { tentative, destinataire: numero },
        };
      },
    },

    terminer_rouvrir_conversation: {
      domaine: 'Mails', titre: 'Conversation terminée ou rouverte', verbe: 'Appliquer', cours: 'Enregistrement…',
      quoi: 'termine une conversation de la boîte des mails (elle sort de « À répondre »), ou la rouvre',
      parametres: { conversation: 'son numéro (fil), lu dans mails_clients', statut: 'terminee ou ouverte' },
      action: 'setThreadStatus', permission: 'emails.send', risque: false,
      async preparer(p, ctx) {
        const { thread } = await filDuCentre(ctx, p.conversation);
        const mot = sans(p.statut);
        const voulu = /termin|ferm|clo|fini|archiv|regl/.test(mot) ? 'closed' : (/ouv|activ|reprend/.test(mot) ? 'open' : '');
        if (!voulu) throw erreur('Dites terminee ou ouverte.');
        if (thread.status === voulu) throw erreur(`La conversation n° ${thread.id} est déjà ${STATUTS_FIL[voulu]}.`);
        return {
          corps: { threadId: thread.id, status: voulu },
          texte: `${voulu === 'closed' ? 'Terminer' : 'Rouvrir'} la conversation « ${coupe(thread.subject || `n° ${thread.id}`, 80)} ».`,
          lignes: [{ libelle: 'Conversation', valeur: `n° ${thread.id}, ${coupe(thread.contactName || thread.contactEmail || '', 60)} : ${coupe(thread.subject || '', 80)}` }, { libelle: 'État', avant: STATUTS_FIL[thread.status] || thread.status, apres: STATUTS_FIL[voulu] }],
          clients: null,
          fait: `La conversation n° ${thread.id} est ${STATUTS_FIL[voulu]}.`,
        };
      },
    },

    exclure_adresse_mails: {
      domaine: 'Mails', titre: 'Adresse retirée des mails marketing', verbe: 'Retirer l’adresse', cours: 'Enregistrement…',
      quoi: 'retire une adresse des mails marketing du centre (campagnes, relances, séquences), quand le client le demande ; les mails de réservation partent toujours',
      parametres: { email: 'l’adresse', raison: 'facultatif, par exemple « demandé au téléphone »' },
      action: 'suppressionAdd', permission: ['campaigns.manage', 'emails.send'], risque: false,
      async preparer(p, ctx) {
        const email = adresseDe(p.email);
        if (((await ctx.lire('listeSuppression')) || []).some((e) => e && String(e.email || '').toLowerCase() === email)) throw erreur(`${email} est déjà retirée des mails marketing.`);
        const raison = ligneNette(p.raison);
        if (raison.length > 500) throw erreur('La raison fait 500 caractères au plus.');
        return {
          corps: { email, reason: raison },
          texte: `Retirer ${email} des mails marketing.`,
          lignes: [{ libelle: 'Adresse', valeur: email }, ...(raison ? [{ libelle: 'Raison', valeur: raison }] : [])],
          clients: 'Cette adresse ne reçoit plus aucun mail marketing : les mails en attente vers elle sont annulés. Ses confirmations et rappels de réservation partent toujours.',
          fait: `${email} ne reçoit plus les mails marketing.`,
        };
      },
    },

    reinscrire_adresse_mails: {
      domaine: 'Mails', titre: 'Adresse réinscrite aux mails marketing', verbe: 'Réinscrire l’adresse', cours: 'Enregistrement…', confirmer: 'Oui, réinscrire', danger: true,
      quoi: 'remet une adresse retirée dans les mails marketing, seulement quand le client l’a redemandé lui-même',
      parametres: { email: 'l’adresse, lue dans la liste des adresses retirées' },
      action: 'suppressionRemove', permission: ['campaigns.manage', 'emails.send'], risque: true,
      demande: mots('r[ée]inscri', AJOUTER, 'r[ée]abonn', 'remet(?:s|tez|tre|tons)?\\s.{0,30}(?:liste|mail|newsletter)', 'recevoir\\s+(?:de|[àa])\\s+nouveau'),
      async preparer(p, ctx) {
        const email = adresseDe(p.email);
        const e = ((await ctx.lire('listeSuppression')) || []).find((x) => x && String(x.email || '').toLowerCase() === email);
        if (!e) throw erreur(`${email} n’est pas dans la liste des adresses retirées.`);
        const parLeClient = e.source !== 'staff';
        return {
          corps: { email },
          texte: `Réinscrire ${email} aux mails marketing.`,
          lignes: [{ libelle: 'Adresse', valeur: email }, { libelle: 'Retirée', valeur: `${SOURCES_DE_RETRAIT[e.source] || 'par l’équipe'}${e.reason ? ` : ${coupe(e.reason, 120)}` : ''}` }],
          clients: 'Cette adresse recevra de nouveau les campagnes, les relances et les séquences du centre.',
          alerte: parLeClient ? 'Ce client s’est retiré lui-même : le réinscrire n’est permis que s’il vous l’a redemandé, et vous devez pouvoir le prouver.' : null,
          fait: `${email} reçoit de nouveau les mails marketing.`,
        };
      },
    },

    // ── Les reglages des mails ──
    apparence_des_mails: {
      domaine: 'Mails', titre: 'Apparence des mails', verbe: 'Enregistrer l’apparence', cours: 'Enregistrement…', confirmer: 'Oui, enregistrer',
      quoi: 'change l’apparence des mails du centre : le gabarit, la couleur, la formule de fin et la signature (équipe, téléphone, e-mail, site, adresse), la mention de pied de page',
      parametres: { gabarit: 'facultatif : simple, classique, epure, carte ou contraste', couleur: 'facultatif : encre (sobre), centre (sa couleur) ou #rrggbb', formule: 'facultatif, la formule de fin, 80 caractères au plus', signature: 'facultatif : oui pour signer les mails, non pour ne plus signer', equipe: 'facultatif, le nom d’équipe de la signature', telephone: 'facultatif', email: 'facultatif', site: 'facultatif, une adresse https', adresse: 'facultatif', mention: 'facultatif, la mention de pied de page, 300 caractères au plus' },
      action: 'emailDesign', permission: ['settings.manage', 'emails.send'], risque: true,
      demande: mots(CHANGER, MODIFIER, METTRE, PASSER, ENLEVER, RETIRER, AJOUTER, REMPLACER, verbe('sign'), verbe('utilis'), verbe('pren', 'ds|dre|ez|ons'), 'r[ée]initialis', REMETTRE),
      async preparer(p, ctx) {
        const ED = require('./email-design');
        let centre = null;
        try { centre = require('./ops-knowledge').getCenter(ctx.centre); } catch (e) { centre = null; }
        const actuel = (await ctx.lire('designDesMails')) || ED.getEmailDesignDefaults(centre);
        const suivant = JSON.parse(JSON.stringify(actuel));
        suivant.signature = suivant.signature || {};
        suivant.footer = suivant.footer || {};
        const lignes = [];
        const dit = (v) => (v === true ? 'oui' : (v === false ? 'non' : (String(v == null ? '' : v).trim() || 'vide')));
        const changer = (libelle, avant, apres, poser) => {
          if (String(avant == null ? '' : avant) === String(apres == null ? '' : apres)) return;
          lignes.push({ libelle, avant: dit(avant), apres: dit(apres) });
          poser(apres);
        };
        if (rempli(p.gabarit)) {
          const g = trouver(ED.EMAIL_DESIGN_PRESETS.map((x) => ({ id: x.id, name: x.label })), p.gabarit, { quoi: 'le gabarit : simple, classique, epure, carte ou contraste' });
          const nomDe = (id) => ((ED.EMAIL_DESIGN_PRESETS.find((x) => x.id === id) || {}).label || id);
          changer('Gabarit', nomDe(actuel.preset), g.name, () => { suivant.preset = g.id; });
        }
        if (rempli(p.couleur)) {
          const c = String(p.couleur).trim().toLowerCase();
          const accent = /^#[0-9a-f]{6}$/.test(c) ? { mode: 'perso', hex: c } : (/encre|noir|sobre|aucune|neutre/.test(sans(c)) ? { mode: 'encre', hex: '' } : (/centre|marque/.test(sans(c)) ? { mode: 'centre', hex: '' } : null));
          if (!accent) throw erreur('La couleur : encre (sobre), centre (la couleur du centre) ou une couleur au format #rrggbb.');
          const ditAccent = (a) => (a && a.mode === 'perso' ? a.hex : (a && a.mode === 'centre' ? 'la couleur du centre' : 'encre'));
          changer('Couleur', ditAccent(actuel.accent), ditAccent(accent), () => { suivant.accent = accent; });
        }
        const sig = actuel.signature || {};
        if (rempli(p.signature)) { const v = booleen(p.signature, 'la signature'); changer('Signature', sig.enabled !== false, v, () => { suivant.signature.enabled = v; }); }
        [['formule', 'closing', 'Formule de fin'], ['equipe', 'teamLabel', 'Nom d’équipe'], ['telephone', 'phone', 'Téléphone'], ['email', 'email', 'E-mail de la signature'], ['site', 'website', 'Site'], ['adresse', 'address', 'Adresse']].forEach(([cle, champ, libelle]) => {
          if (rempli(p[cle])) { const v = ligneNette(p[cle]); changer(libelle, sig[champ], v, () => { suivant.signature[champ] = v; }); }
        });
        if (rempli(p.mention)) { const v = ligneNette(p.mention); changer('Mention de pied de page', (actuel.footer || {}).mention, v, () => { suivant.footer.mention = v; }); }
        if (!lignes.length) throw erreur('Dites ce qui change : gabarit, couleur, formule de fin, signature, nom d’équipe, téléphone, e-mail, site, adresse ou mention, différent de l’apparence actuelle.');
        // La regle de l enregistrement (lib/email-design.js, validateEmailDesign), sur l objet entier :
        // la page envoie l apparence complete, le serveur la revalide de meme.
        ED.validateEmailDesign(suivant, centre);
        return {
          corps: { design: suivant },
          texte: 'Changer l’apparence des mails du centre.',
          lignes,
          clients: 'Les prochains mails du centre (confirmations, rappels, réponses, campagnes) partent avec cette apparence.',
          fait: 'L’apparence des mails est enregistrée.',
        };
      },
    },

    reponse_type_agent: {
      domaine: 'Mails', titre: 'Réponse type de l’agent des mails', verbe: 'Enregistrer la réponse', cours: 'Enregistrement…', confirmer: 'Oui, enregistrer',
      quoi: 'change la réponse type que l’agent des mails prépare sur un sujet, ou la remet comme le logiciel l’écrit',
      parametres: { sujet: 'reservation, annulation, anniversaire, prix, horaires, reclamation, hors_sujet ou autre', objet: 'facultatif, l’objet, 140 caractères au plus', texte: 'le texte entier de la réponse, 2 000 caractères au plus', reinitialiser: 'oui pour remettre la réponse du logiciel' },
      action: 'emailBrain', permission: ['settings.manage', 'emails.send'], risque: true,
      demande: mots(CHANGER, MODIFIER, 'r[ée]initialis', REMETTRE, 'r[ée][ée]cri', REMPLACER, CORRIGER, METTRE, 'revenir', 'reviens'),
      async preparer(p, ctx) {
        const { INTENT_LABELS } = require('./email-agent');
        const s = trouver(Object.entries(INTENT_LABELS).map(([id, name]) => ({ id, name })), p.sujet, { quoi: 'le sujet' });
        const { reglages = {}, defauts = {} } = (await ctx.lire('cerveauAgentMails')) || {};
        const actuel = (reglages.faq || {})[s.id] || null;
        const logiciel = (defauts.faq || {})[s.id] || {};
        if (rempli(p.reinitialiser) && booleen(p.reinitialiser, 'la remise par défaut')) {
          if (!actuel) throw erreur(`La réponse « ${s.name} » est déjà celle du logiciel.`);
          return {
            corps: { faq: { [s.id]: null } },
            texte: `Remettre la réponse type « ${s.name} » comme le logiciel l’écrit.`,
            lignes: [{ libelle: 'Sujet', valeur: s.name }, { libelle: 'Texte', avant: coupe(actuel.body, 220), apres: coupe(logiciel.body, 220) || 'celui du logiciel', ...(logiciel.body ? { long: logiciel.body } : {}) }],
            clients: 'Les prochaines réponses que l’agent prépare sur ce sujet repartent du texte du logiciel.',
            fait: `La réponse « ${s.name} » a retrouvé le texte du logiciel.`,
          };
        }
        const texte = String(p.texte == null ? '' : p.texte).replace(/\r\n?/g, '\n').trim();
        if (!texte) throw erreur('Donnez le texte entier de la réponse.');
        if (texte.length > LIMITES_AGENT.texte) throw erreur(`La réponse fait ${LIMITES_AGENT.texte} caractères au plus.`);
        const objet = rempli(p.objet) ? ligneNette(p.objet) : String((actuel && actuel.subject) || logiciel.subject || '').trim();
        if (objet.length > LIMITES_AGENT.objet) throw erreur(`L’objet fait ${LIMITES_AGENT.objet} caractères au plus.`);
        const avant = actuel || logiciel;
        if (texte === String(avant.body || '').trim() && objet === String(avant.subject || '').trim()) throw erreur(`La réponse « ${s.name} » dit déjà cela.`);
        return {
          corps: { faq: { [s.id]: { subject: objet, body: texte } } },
          texte: `Changer la réponse type « ${s.name} » de l’agent des mails.`,
          lignes: [{ libelle: 'Sujet', valeur: s.name }, ...(objet !== String(avant.subject || '').trim() ? [{ libelle: 'Objet', avant: avant.subject || 'aucun', apres: objet || 'aucun' }] : []), { libelle: 'Texte', avant: coupe(avant.body, 220) || 'vide', apres: coupe(texte, 220), long: texte }],
          clients: 'Les prochaines réponses que l’agent prépare sur ce sujet partent de ce texte.',
          fait: `La réponse « ${s.name} » est enregistrée.`,
        };
      },
    },

    expediteur_mails: {
      domaine: 'Mails', titre: 'Adresse d’expédition', verbe: 'Enregistrer l’adresse', cours: 'Enregistrement…', confirmer: 'Oui, enregistrer',
      quoi: 'ajoute une adresse d’expédition des mails du centre, ou change le nom, l’adresse ou le choix par défaut d’une adresse existante ; le domaine doit déjà être vérifié par Pinlane',
      parametres: { expediteur: 'facultatif : l’adresse à changer, son nom ou son e-mail', nom: 'le nom affiché, par exemple « Fun Galaxy Libramont »', email: 'l’adresse', par_defaut: 'facultatif : oui pour en faire l’adresse par défaut' },
      action: 'saveEmailIdentity', permission: 'settings.manage', risque: (p, prep) => prep.parDefaut, demande: mots(METTRE, PASSER, CHANGER, MODIFIER, verbe('utilis'), verbe('choisi', 's|r|ssez'), verbe('pren', 'ds|dre|ez|ons'), AJOUTER, 'part(?:e|ent|ir|es)?(?!\\p{L})', ENVOYER),
      async preparer(p, ctx) {
        const liste = (await ctx.lire('expediteursMails')) || [];
        const actuel = rempli(p.expediteur) ? trouver(liste, p.expediteur, { quoi: 'l’adresse d’expédition', nom: (x) => `${x.label} <${x.email}>` }) : null;
        const label = rempli(p.nom) ? ligneNette(p.nom) : String((actuel && actuel.label) || '');
        if (!label || label.length > 120) throw erreur('Donnez le nom affiché de l’adresse, 120 caractères au plus.');
        const email = rempli(p.email) ? adresseDe(p.email) : String((actuel && actuel.email) || '').toLowerCase();
        if (!email) throw erreur('Donnez l’adresse.');
        const parDefaut = rempli(p.par_defaut) ? booleen(p.par_defaut, 'l’adresse par défaut') : Boolean(actuel && actuel.isDefault);
        if (liste.some((x) => x && String(x.email).toLowerCase() === email && (!actuel || x.id !== actuel.id))) throw erreur(`${email} est déjà une adresse d’expédition de ce centre.`);
        if (actuel && label === actuel.label && email === String(actuel.email).toLowerCase() && parDefaut === Boolean(actuel.isDefault)) throw erreur('Cette adresse porte déjà ce nom et ce choix.');
        const lignes = actuel
          ? [{ libelle: 'Adresse', valeur: `${actuel.label} <${actuel.email}>` }, ...(label !== actuel.label ? [{ libelle: 'Nom', avant: actuel.label, apres: label }] : []), ...(email !== String(actuel.email).toLowerCase() ? [{ libelle: 'E-mail', avant: actuel.email, apres: email }] : []), ...(parDefaut !== Boolean(actuel.isDefault) ? [{ libelle: 'Par défaut', avant: actuel.isDefault ? 'oui' : 'non', apres: parDefaut ? 'oui' : 'non' }] : [])]
          : [{ libelle: 'Nom', valeur: label }, { libelle: 'E-mail', valeur: email }, { libelle: 'Par défaut', valeur: parDefaut ? 'oui' : 'non' }];
        return {
          corps: { ...(actuel ? { id: actuel.id } : {}), label, email, isDefault: parDefaut },
          texte: actuel ? `Changer l’adresse d’expédition ${actuel.email}.` : `Ajouter l’adresse d’expédition ${email}.`,
          lignes,
          clients: parDefaut ? `Les mails écrits par l’équipe partiront de ${label} <${email}>.` : null,
          alerte: 'Le domaine de l’adresse doit déjà être vérifié par Pinlane pour ce centre, sinon le logiciel refuse.',
          fait: actuel ? 'L’adresse d’expédition est enregistrée.' : `${email} est ajoutée aux adresses d’expédition.`,
          parDefaut: parDefaut || Boolean(actuel && actuel.isDefault),
        };
      },
    },

    supprimer_expediteur_mails: {
      domaine: 'Mails', titre: 'Adresse d’expédition supprimée', verbe: 'Supprimer l’adresse', cours: 'Suppression…', confirmer: 'Oui, supprimer', danger: true,
      quoi: 'supprime une adresse d’expédition des mails du centre',
      parametres: { expediteur: 'son nom ou son e-mail' },
      action: 'deleteEmailIdentity', permission: 'settings.manage', risque: true, demande: SUPPRIMER,
      async preparer(p, ctx) {
        const x = trouver((await ctx.lire('expediteursMails')) || [], p.expediteur, { quoi: 'l’adresse d’expédition', nom: (i) => `${i.label} <${i.email}>` });
        return {
          corps: { id: x.id },
          texte: `Supprimer l’adresse d’expédition ${x.email}.`,
          lignes: [{ libelle: 'Adresse', valeur: `${x.label} <${x.email}>` }, { libelle: 'Par défaut', valeur: x.isDefault ? 'oui' : 'non' }],
          clients: x.isDefault ? 'C’est l’adresse par défaut : les mails de l’équipe partiront de l’adresse de la plateforme, au nom du centre, tant qu’aucune autre n’est par défaut.' : null,
          fait: `L’adresse ${x.email} est supprimée.`,
        };
      },
    },

    // ── Le planning ──
    piste_en_maintenance: {
      domaine: 'Planning', titre: 'Piste en maintenance', verbe: 'Appliquer', cours: 'Enregistrement…', confirmer: 'Oui, appliquer',
      quoi: 'met une piste de bowling en maintenance, tout de suite ou sur des dates, ou la rouvre',
      parametres: { piste: 'son numéro', etat: 'maintenance ou ouverte', du: 'facultatif, AAAA-MM-JJ (vide : dès maintenant)', au: 'facultatif, AAAA-MM-JJ (vide : jusqu’à la réouverture)', motif: 'facultatif, visible par l’équipe, 120 caractères au plus' },
      action: 'updateLaneStatus', endpoint: 'staff-lanes', methode: 'PATCH', permission: ['planning.drag', 'settings.manage'],
      risque: (p, prep) => prep.ferme, demande: mots(verbe('ferm'), verbe('bloqu'), METTRE, PASSER, 'condamn', 'coup(?:e|es|ez|er|ons)?(?!\\p{L})', verbe('arr[eê]t')),
      async preparer(p, ctx) {
        const etat = (await ctx.lire('etatDesPistes')) || {};
        const total = Number(etat.nombre) || 0;
        if (!total) throw erreur('Ce centre n’a pas de pistes de bowling dans son catalogue.');
        const piste = nombre(p.piste, { min: 1, max: total, quoi: 'Le numéro de la piste', entier: true });
        const mot = sans(p.etat);
        const ferme = /ouv|activ|remet|liber|reprend/.test(mot) ? false : (/mainten|ferm|bloq|panne|hors|repar/.test(mot) ? true : null);
        if (ferme === null) throw erreur('Dites maintenance ou ouverte.');
        const actuelle = (etat.maintenance || {})[piste] || null;
        const fenetre = (m) => `${m.from ? `du ${jourDit(m.from)}` : 'dès maintenant'}${m.until ? ` au ${jourDit(m.until)}` : ', sans fin'}`;
        if (!ferme) {
          if (!actuelle) throw erreur(`La piste ${piste} est déjà ouverte.`);
          return {
            corps: { lane: piste, status: 'active' },
            texte: `Rouvrir la piste ${piste}.`,
            lignes: [{ libelle: 'Piste', valeur: String(piste) }, { libelle: 'État', avant: `en maintenance ${fenetre(actuelle)}`, apres: 'ouverte' }],
            clients: 'La piste se vend de nouveau sur le formulaire en ligne.',
            fait: `La piste ${piste} est ouverte.`,
            ferme: false,
          };
        }
        const jour = aujourdhui();
        const du = rempli(p.du) ? dateReelle(p.du) : '';
        const au = rempli(p.au) ? dateReelle(p.au) : '';
        if ((rempli(p.du) && !du) || (rempli(p.au) && !au)) throw erreur('Les dates se donnent en AAAA-MM-JJ.');
        if (du && au && au < du) throw erreur('La fin de la maintenance précède son début.');
        if (au && au < jour) throw erreur('La fin de la maintenance est déjà passée.');
        const motif = ligneNette(p.motif);
        if (motif.length > 120) throw erreur('Le motif fait 120 caractères au plus.');
        if (actuelle && (actuelle.from || '') === du && (actuelle.until || '') === au && (actuelle.note || '') === motif) throw erreur(`La piste ${piste} est déjà en maintenance ${fenetre(actuelle)}.`);
        const voulue = { from: du, until: au };
        const toucheAujourdhui = (!du || du <= jour) && (!au || au >= jour);
        const dossiers = (etat.reservations || []).filter((r) => r && r.status !== 'cancelled' && (r.lanes || []).map(Number).includes(piste));
        return {
          corps: { lane: piste, status: 'maintenance', maintenanceFrom: du, maintenanceUntil: au, note: motif },
          texte: `Mettre la piste ${piste} en maintenance ${fenetre(voulue)}.`,
          lignes: [{ libelle: 'Piste', valeur: String(piste) }, { libelle: 'État', avant: actuelle ? `en maintenance ${fenetre(actuelle)}` : 'ouverte', apres: `en maintenance ${fenetre(voulue)}` }, ...(motif ? [{ libelle: 'Motif', valeur: motif }] : [])],
          clients: 'La piste ne se vend plus sur le formulaire en ligne pendant ces dates.',
          alerte: toucheAujourdhui && dossiers.length
            ? `${dossiers.length} réservation${dossiers.length > 1 ? 's' : ''} d’aujourd’hui ${dossiers.length > 1 ? 'sont' : 'est'} sur cette piste (${dossiers.slice(0, 4).map(heureDe).join(', ')}) : elles ne bougent pas toutes seules, placez-les ailleurs au planning.`
            : 'Les réservations déjà placées sur cette piste ne bougent pas toutes seules : regardez le planning des jours concernés.',
          fait: `La piste ${piste} est en maintenance ${fenetre(voulue)}.`,
          ferme: true,
        };
      },
    },

    decaler_pour_retard: {
      domaine: 'Planning', titre: 'Retard d’un groupe', verbe: 'Décaler le groupe', cours: 'Décalage…', confirmer: 'Oui, décaler',
      quoi: 'décale aujourd’hui un groupe en retard du nombre de minutes dit, avec le plan du logiciel pour les groupes qu’il gêne ; aucun mail ne part',
      parametres: { reservation: 'son numéro, lu dans planning_du_jour ou lister_reservations', minutes: 'le retard, de 1 à 240 minutes', raison: `facultatif : ${RAISONS_RETARD.join(', ')} (late_customer, client en retard, par défaut)` },
      action: 'delayApply', permission: ['reservations.edit', 'planning.drag'], risque: true,
      demande: mots(verbe('d[ée]cal', 'e|es|ez|er|ons|é|ée'), verbe('recul'), 'repouss', verbe('retard', 'e|es|ez|er|ent|ons'), 'en\\s+retard', '\\d+\\s*(?:min(?:ute)?s?|mn)\\s+de\\s+retard'),
      async preparer(p, ctx) {
        const r = await dossierDuCentre(ctx, p.reservation);
        if (r.status === 'cancelled') throw erreur(`La réservation n° ${r.id} est annulée.`);
        if (r.absentAt && !['arrived', 'paid'].includes(r.status)) throw erreur(`Le groupe de la réservation n° ${r.id} est noté pas venu : il n’a pas de retard à décaler.`);
        if (r.date !== aujourdhui()) throw erreur(`Un retard se décale le jour même : la réservation n° ${r.id} est le ${jourDit(r.date)}. Pour changer son heure, c’est modifier_reservation.`);
        const minutes = nombre(p.minutes, { min: 1, max: 240, quoi: 'Le retard en minutes', entier: true });
        const raison = rempli(p.raison) ? String(p.raison).trim() : 'late_customer';
        if (!RAISONS_RETARD.includes(raison)) throw erreur(`Raison inconnue. Possibles : ${RAISONS_RETARD.join(', ')}.`);
        let impact = null;
        try { impact = await ctx.lire('impactDuRetard', r.id, minutes, raison); } catch (e) { impact = null; }
        if (!impact) throw erreur(`Le plan de retard ne se calcule pas pour la réservation n° ${r.id} maintenant : regardez le planning du jour.`, 409);
        // LE PLAN QUE LA CARTE MONTRE EST CELUI QUI S APPLIQUE : sa strategie et ses deplacements reviennent
        // au clic ; un planning qui a bouge entre-temps arrete le geste au lieu d en appliquer un autre.
        const strategies = Array.isArray(impact.strategies) ? impact.strategies : [];
        const strategie = rempli(p.strategie)
          ? strategies.find((s) => s && s.id === String(p.strategie) && s.feasible)
          : strategies.find((s) => s && s.id === impact.recommendedStrategyId && s.feasible);
        if (!strategie) throw erreur(rempli(p.strategie) ? 'Le planning a changé depuis la carte : ce plan de retard ne passe plus. Redemandez-le.' : 'Aucun plan ne tient ce retard sans rien casser : décalez le groupe à la main au planning.', 409);
        const deplacements = (strategie.changes || []).map((c) => ({ id: Number(c.reservationId), de: c.previousStartTime || '', a: c.newStartTime || '', pistes: (c.newLanes || []).map(Number) }));
        const empreinte = empreinteDe(deplacements);
        if (rempli(p.plan_vu) && String(p.plan_vu) !== empreinte) throw erreur('Le planning a changé depuis la carte : le plan de retard n’est plus le même. Redemandez-le pour relire le nouveau.', 409);
        const autres = (strategie.changes || []).filter((c) => Number(c.reservationId) !== r.id);
        const pistesDites = (l) => (Array.isArray(l) && l.length ? `pistes ${l.join(', ')}` : '');
        const reste = autres.length - 7;
        return {
          corps: { reservationId: r.id, delayMinutes: impact.delayMinutes, reasonId: raison, strategyId: strategie.id },
          texte: `Décaler la réservation ${dossierDit(r)} de ${impact.delayMinutes} minutes.`,
          lignes: [
            ligneDossier(r),
            { libelle: 'Retard', valeur: `${impact.delayMinutes} min, ${coupe(impact.reason || 'retard', 60)}` },
            { libelle: 'Heure', avant: impact.previousStartTime || heureDe(r), apres: impact.proposedStartTime || '' },
            { libelle: 'Plan', valeur: coupe(strategie.label || strategie.id, 80) },
            ...autres.slice(0, 7).map((c) => ({ libelle: coupe(c.name || `Réservation n° ${c.reservationId}`, 40), avant: [c.previousStartTime, pistesDites(c.previousLanes)].filter(Boolean).join(', '), apres: [c.newStartTime, pistesDites(c.newLanes)].filter(Boolean).join(', ') })),
          ],
          clients: 'Aucun mail ne part au clic : prévenir les clients se fait ensuite, avec prevenir_clients_du_retard. Le rappel avant la venue, s’il n’est pas encore parti, repart avec la nouvelle heure.',
          alerte: [...(strategie.warnings || []).map((w) => coupe(w, 160)), ...(reste > 0 ? [`Et ${reste} autre${reste > 1 ? 's' : ''} groupe${reste > 1 ? 's' : ''} décalé${reste > 1 ? 's' : ''}.`] : [])].join(' ') || null,
          fait: `La réservation n° ${r.id} est décalée de ${impact.delayMinutes} minutes${autres.length ? `, avec ${autres.length} autre${autres.length > 1 ? 's' : ''} groupe${autres.length > 1 ? 's' : ''}` : ''}.`,
          figer: { strategie: strategie.id, plan_vu: empreinte },
        };
      },
    },

    // L ETAPE « PREVENIR LES CLIENTS » DU RETARD (delayNotify) : l incident que le decalage a ecrit, et
    // chaque client qu il a deplace, avec le texte que la console pre-remplit (buildDelayChangeMessage).
    // Le mail doit dire vrai au moment ou il part : un dossier dont l heure ou la piste a bouge depuis
    // le retard, un client deja prevenu ou sans adresse, sortent de l envoi, et la carte le dit.
    prevenir_clients_du_retard: {
      domaine: 'Planning', titre: 'Clients prévenus du retard', verbe: 'Envoyer les mails', cours: 'Envoi…', confirmer: 'Oui, prévenir ces clients', danger: true,
      quoi: 'après decaler_pour_retard, prévient par mail les clients que ce retard a déplacés (l’étape « Prévenir les clients » du retard) ; la carte montre, client par client, l’adresse et le texte entier',
      parametres: { reservation: 'le numéro de la réservation décalée par le retard, lu dans planning_du_jour', clients: 'facultatif : les numéros des réservations à prévenir, parmi celles que le retard a déplacées (toutes par défaut)' },
      action: 'delayNotify', permission: ['emails.send', 'reservations.edit'], risque: true,
      demande: mots(PREVENIR, ECRIRE, ENVOYER, verbe('avert', 'is|issez|ir'), verbe('inform'), 'dis.leur', 'dites.leur', verbe('contact')),
      async preparer(p, ctx) {
        const r = await dossierDuCentre(ctx, p.reservation);
        const incident = await ctx.lire('retardApplique', r.id);
        if (!incident || Number(incident.reservationId) !== r.id || String(incident.centerId || '') !== String(ctx.centre)) throw erreur(`Aucun retard appliqué n’est noté sur la réservation n° ${r.id} : décalez d’abord le groupe avec decaler_pour_retard.`, 404);
        // LE RETARD QUE LA CARTE A MONTRE EST CELUI QUI PREVIENT : un autre retard pose entre-temps arrete le clic.
        if (rempli(p.incident) && Number(p.incident) !== Number(incident.id)) throw erreur('Un autre retard a été appliqué depuis la carte : redemandez pour relire qui prévenir.', 409);
        const changements = (Array.isArray(incident.impact && incident.impact.changes) ? incident.impact.changes : []).filter((c) => c && Number(c.reservationId) > 0);
        const deplaces = changements.map((c) => Number(c.reservationId));
        let voulus = null;
        if (rempli(p.clients)) {
          voulus = (Array.isArray(p.clients) ? p.clients : String(p.clients).split(/[\s,;]+/)).filter(rempli).map((x) => numeroDe(x, 'Le numéro d’une réservation à prévenir'));
          const horsDuRetard = voulus.filter((id) => !deplaces.includes(id));
          if (horsDuRetard.length) throw erreur(`La réservation n° ${horsDuRetard[0]} n’a pas été déplacée par ce retard. Déplacées : ${deplaces.map((id) => `n° ${id}`).join(', ')}.`);
        }
        const deja = new Map(((await ctx.lire('prevenusDuRetard', incident.id)) || []).map((x) => [Number(x.reservationId), x.statut]));
        const pistesDe = (l) => (Array.isArray(l) ? l : []).map(Number).sort((a, b) => a - b).join(', ');
        const OC = require('./ops-communications');
        const envois = [];
        const ecartes = [];
        for (const c of changements) {
          const id = Number(c.reservationId);
          if (voulus && !voulus.includes(id)) continue;
          // eslint-disable-next-line no-await-in-loop
          const d = await ctx.lire('dossierResa', id);
          const nom = coupe((d && d.name) || c.name || `Réservation n° ${id}`, 60);
          if (!d || Number(d.id) !== id || String(d.centerId || 'libramont') !== String(ctx.centre)) { ecartes.push(`${nom}, la réservation n’existe plus`); continue; }
          if (d.status === 'cancelled') { ecartes.push(`${nom}, annulée depuis`); continue; }
          const email = String(d.email || '').trim();
          if (!EMAIL_RX.test(email)) { ecartes.push(`${nom}, sans adresse mail : appelez le client`); continue; }
          if (['queued', 'processing', 'sent', 'delivered'].includes(deja.get(id))) { ecartes.push(`${nom}, déjà prévenu de ce retard`); continue; }
          if (c.newStartTime && heureDe(d) !== String(c.newStartTime).slice(0, 5)) { ecartes.push(`${nom}, son heure a changé depuis le retard (${heureDe(d)}) : écrivez-lui avec ecrire_ou_repondre_mail`); continue; }
          if (c.laneChanged && pistesDe(d.lanes) !== pistesDe(c.newLanes)) { ecartes.push(`${nom}, sa piste a changé depuis le retard : écrivez-lui avec ecrire_ou_repondre_mail`); continue; }
          const m = OC.buildDelayChangeMessage({ reservation: d, change: c, channel: 'email' });
          envois.push({ reservationId: id, nom, email, subject: String(m.subject || ''), body: String(m.body || '') });
        }
        if (!envois.length) throw erreur(`Personne à prévenir pour ce retard${ecartes.length ? ` : ${ecartes.join(' ; ')}` : ''}.`, 409);
        // CE QUE LA CARTE A MONTRE EST CE QUI PART : un texte ou une adresse qui a change arrete le clic.
        const empreinte = empreinteDe(envois.map((e) => [e.reservationId, e.email, e.subject, e.body]));
        if (rempli(p.envoi_vu) && String(p.envoi_vu) !== empreinte) throw erreur('Ce que les clients recevraient a changé depuis la carte : redemandez pour relire les nouveaux textes.', 409);
        const n = envois.length;
        return {
          corps: { incidentId: incident.id, reservationIds: envois.map((e) => e.reservationId), channels: ['email'], messages: envois.map((e) => ({ reservationId: e.reservationId, subject: e.subject, body: e.body })) },
          texte: `Prévenir ${n} client${n > 1 ? 's' : ''} du retard de la réservation ${dossierDit(r)}.`,
          lignes: [
            ligneDossier(r),
            { libelle: 'Retard', valeur: `${Number(incident.delayMinutes) || 0} min${incident.reason ? `, ${coupe(incident.reason, 60)}` : ''}${incident.previousStartTime && incident.proposedStartTime ? `, de ${String(incident.previousStartTime).slice(0, 5)} à ${String(incident.proposedStartTime).slice(0, 5)}` : ''}` },
            ...envois.map((e) => ({ libelle: e.nom, valeur: `${e.email} : « ${coupe(e.subject, 100)} »`, long: `${e.subject}\n\n${e.body}` })),
          ],
          clients: `${n > 1 ? `Ces ${n} clients reçoivent chacun leur` : 'Ce client reçoit son'} mail tout de suite. Un mail parti ne se rattrape pas.`,
          alerte: ecartes.length ? `Pas prévenus : ${ecartes.join(' ; ')}.` : null,
          fait: `${n} client${n > 1 ? 's sont prévenus' : ' est prévenu'} du retard.`,
          figer: { incident: incident.id, envoi_vu: empreinte },
        };
      },
    },

    retirer_retard: {
      domaine: 'Planning', titre: 'Retard retiré', verbe: 'Appliquer', cours: 'Enregistrement…', confirmer: 'Oui, appliquer',
      quoi: 'sur une réservation décalée par un retard : retire seulement le badge de retard, ou annule le retard et remet le groupe (et ceux qu’il avait poussés) à leur heure d’origine',
      parametres: { reservation: 'son numéro, lu dans planning_du_jour ou lister_reservations', remettre: 'oui pour annuler le retard et remettre l’heure d’origine, non pour retirer seulement le badge (par défaut)' },
      action: 'delayClear', permission: ['reservations.edit', 'planning.drag'], risque: (p, prep) => prep.remettre,
      demande: mots(REMETTRE, verbe('annul'), RETIRER, ENLEVER, 'revenir', 'reviens', verbe('replac'), 'rem[eè]ne', 'ramen'),
      async preparer(p, ctx) {
        const r = await dossierDuCentre(ctx, p.reservation);
        const drapeau = r.opsPlan && typeof r.opsPlan === 'object' ? r.opsPlan.delayFlag : null;
        if (!drapeau || drapeau.cleared) throw erreur(`La réservation n° ${r.id} n’a pas de retard en cours.`);
        const remettre = rempli(p.remettre) ? booleen(p.remettre, 'la remise à l’heure d’origine') : false;
        const origine = drapeau.origin && drapeau.origin.startTime ? String(drapeau.origin.startTime).slice(0, 5) : '';
        return {
          action: remettre ? 'delayRevert' : 'delayClear',
          corps: { reservationId: r.id },
          texte: remettre ? `Annuler le retard de la réservation ${dossierDit(r)}.` : `Retirer le badge de retard de la réservation ${dossierDit(r)}.`,
          lignes: [
            ligneDossier(r),
            { libelle: 'Retard', valeur: `${Number(drapeau.minutes) || 0} min${drapeau.from && drapeau.to ? `, de ${drapeau.from} à ${drapeau.to}` : ''}` },
            remettre ? { libelle: 'Heure', avant: heureDe(r), apres: origine || 'inchangée : l’heure d’origine n’a pas été gardée' } : { libelle: 'Badge', avant: 'affiché', apres: 'retiré, l’heure ne bouge pas' },
          ],
          clients: null,
          alerte: remettre ? 'Les groupes que ce retard avait poussés reviennent aussi à leur place. Si un créneau a été repris entre-temps, le logiciel refuse.' : null,
          fait: remettre ? `Le retard de la réservation n° ${r.id} est annulé.` : `Le badge de retard de la réservation n° ${r.id} est retiré.`,
          remettre,
        };
      },
    },

    // LA CASE D UNE ACTIVITE DU PROGRAMME (toggleFormulaActivity) : le serveur lit le programme comme
    // la fiche le dessine (lib/programme-a-cocher.js) et ne coche qu une de ses cles, jamais une cle
    // dite par le modele. Une coche par carte, comme la fiche l envoie : le serveur pose ou retire CETTE
    // cle sur ce qui est en base, sans version, pour qu une coche d un autre poste ne se perde pas.
    cocher_activite_faite: {
      domaine: 'Planning', titre: 'Activité cochée', verbe: 'Enregistrer', cours: 'Enregistrement…', confirmer: 'Oui, enregistrer',
      quoi: 'coche une activité du programme d’un groupe comme faite, ou la décoche, comme sa case dans la fiche ; une carte par activité',
      parametres: { reservation: 'son numéro, lu dans planning_du_jour ou lister_reservations', activite: 'l’activité comme la fiche la nomme : bowling, laser, minigolf, arcades, boissons…', partie: 'facultatif : la partie ou le groupe (1, 2…) quand l’activité revient plusieurs fois', groupe: 'facultatif : la vague d’une partie de laser jouée en plusieurs groupes', fait: 'oui pour cocher (par défaut), non pour décocher' },
      endpoint: 'staff-reservations', methode: 'PATCH', permission: ['reservations.status', 'reservations.edit'], risque: false,
      async preparer(p, ctx) {
        const r = await dossierDuCentre(ctx, p.reservation);
        if (r.status === 'cancelled') throw erreur(`La réservation n° ${r.id} est annulée : son programme ne se coche plus.`);
        const P = require('./programme-a-cocher');
        const etapes = P.etapesACocher(r, await ctx.lire('reglagesDuProgramme'));
        const quand = (e) => (e.start !== null && e.start !== undefined ? `à ${P.heureTexte(e.start)}` : e.aPlacer ? 'heure à placer' : 'à leur rythme');
        const dite = (e) => `${e.nom}${e.parties > 1 ? ` (groupe ${e.partie}/${e.parties})` : ''}${e.activityId === 'laser_game' && e.partie ? ` (partie ${e.partie}${e.groupes ? `, groupe ${e.groupe}/${e.groupes}` : ''})` : ''}, ${quand(e)}`;
        const liste = (l) => l.map(dite).join(' ; ');
        if (!etapes.length) throw erreur(`Le programme de la réservation n° ${r.id} n’a aucune activité à cocher.`);
        const q = sans(p.activite);
        if (!q) throw erreur(`Dites quelle activité cocher. Au programme : ${liste(etapes)}.`);
        // Le nom exact d abord (« bowling » n est pas le duckpin), puis un mot de la personne dans le nom
        // ou le libelle de l etape (« les cruches » : « 2 cruches boissons »).
        const noms = (e) => [sans(e.nom), sans(e.activityId), sans(e.libelle)].filter(Boolean);
        const termes = q.split(' ').filter((t) => t.length >= 4);
        const exactes = etapes.filter((e) => noms(e).includes(q));
        let choisies = exactes.length ? exactes : etapes.filter((e) => noms(e).some((n) => n.includes(q) || q.includes(n) || termes.some((t) => n.includes(t))));
        if (!choisies.length) throw erreur(`« ${coupe(p.activite, 40)} » n’est pas au programme de la réservation n° ${r.id}. Au programme : ${liste(etapes)}.`);
        if (rempli(p.partie)) {
          const n = nombre(p.partie, { min: 1, max: 99, quoi: 'La partie', entier: true });
          choisies = choisies.filter((e) => Number(e.partie) === n);
        }
        if (rempli(p.groupe)) {
          const g = nombre(p.groupe, { min: 1, max: 99, quoi: 'Le groupe', entier: true });
          choisies = choisies.filter((e) => Number(e.groupe) === g);
        }
        if (!choisies.length) throw erreur(`Cette partie n’est pas au programme de la réservation n° ${r.id}. Au programme : ${liste(etapes)}.`);
        // LA CLE DE LA CARTE EST CELLE DU CLIC : un programme qui a bouge entre-temps arrete le geste.
        if (rempli(p.cle)) {
          choisies = choisies.filter((e) => e.cle === String(p.cle));
          if (!choisies.length) throw erreur('Le programme de ce groupe a changé depuis la carte : redemandez pour relire ses activités.', 409);
        }
        const cles = [...new Set(choisies.map((e) => e.cle))];
        if (cles.length > 1) throw erreur(`${choisies[0].nom} revient ${choisies.length} fois au programme de la réservation n° ${r.id} : dites laquelle (la partie, ou le groupe). ${liste(choisies)}.`);
        const e = choisies[0];
        const voulu = rempli(p.fait) ? booleen(p.fait, 'cocher ou décocher') : true;
        if (e.fait === voulu) throw erreur(voulu ? `${dite(e)} : déjà cochée.` : `${dite(e)} : pas cochée.`);
        const par = nomDeSession(ctx.session) || 'Staff';
        const restantes = etapes.filter((x) => !x.fait && x.cle !== e.cle).length;
        return {
          corps: { id: r.id, activityToggle: { key: e.cle, done: voulu, doneAt: voulu ? new Date().toISOString() : '', by: voulu ? par : '' } },
          texte: `${voulu ? 'Cocher' : 'Décocher'} ${e.nom} de la réservation ${dossierDit(r)}.`,
          lignes: [
            ligneDossier(r),
            { libelle: 'Activité', valeur: dite(e) },
            { libelle: 'État', avant: e.fait ? 'faite' : 'à faire', apres: voulu ? `faite, par ${par}` : 'à faire' },
          ],
          clients: null,
          alerte: null,
          fait: `${e.nom} est ${voulu ? 'cochée' : 'décochée'} sur la réservation n° ${r.id}.${voulu && restantes ? ` Il reste ${restantes} activité${restantes > 1 ? 's' : ''} à cocher.` : ''}`,
          figer: { cle: e.cle },
        };
      },
    },

    // LE GLISSER DU PLANNING (activityMove) : le bowling d un groupe a une autre heure ou sur d autres
    // pistes, une partie de laser a une autre heure, ou rendue « à placer ». Le corps se refait ici a
    // partir du dossier relu, dans la forme que la console envoie, et la carte le juge comme la fiche
    // le jugera (apercuDuDeplacement) : un creneau qui ne tient pas se refuse sur la carte, pas au clic.
    deplacer_activite: {
      domaine: 'Planning', titre: 'Activité déplacée', verbe: 'Déplacer', cours: 'Déplacement…', confirmer: 'Oui, déplacer',
      quoi: 'déplace au planning le bowling d’un groupe (son heure, ses pistes) ou une partie de laser (son heure), ou retire une partie du planning pour la remettre à placer, comme le glisser du planning ; le reste du programme ne bouge pas',
      parametres: { reservation: 'son numéro, lu dans planning_du_jour ou lister_reservations', activite: 'bowling ou laser', heure: 'la nouvelle heure de début, HH:MM (le bowling à l’heure pleine ou à la demie)', pistes: 'facultatif, bowling : les pistes de destination, autant que le groupe en a (par défaut les siennes)', partie: 'facultatif, laser : la partie (1 par défaut)', groupe: 'facultatif, laser : la vague d’une partie jouée en plusieurs groupes (1 par défaut)', retirer: 'facultatif, laser : oui pour retirer la partie du planning, elle redevient à placer' },
      endpoint: 'staff-reservations', methode: 'PATCH', permission: ['planning.drag', 'reservations.edit'], risque: true,
      demande: mots(verbe('d[ée]plac', 'e|es|ez|er|ons|é|ée'), verbe('plac', 'e|es|ez|er|ons|é|ée'), METTRE, REMETTRE, PASSER, CHANGER, verbe('avanc'), verbe('recul'), verbe('d[ée]cal', 'e|es|ez|er|ons|é|ée'), verbe('boug', 'e|es|ez|er|eons'), verbe('report'), RETIRER, ENLEVER),
      async preparer(p, ctx) {
        const r = await dossierDuCentre(ctx, p.reservation);
        if (r.status === 'cancelled') throw erreur(`La réservation n° ${r.id} est annulée : son programme ne se déplace plus.`);
        const q = sans(p.activite);
        const activite = /bowling/.test(q) && !/duckpin/.test(q) ? 'bowling' : /laser/.test(q) ? 'laser_game' : '';
        if (!activite) throw erreur('Seuls le bowling et le laser se déplacent au planning. Pour l’heure d’arrivée du groupe, c’est modifier_reservation.');
        // Le droit du planning de cette ressource, comme la fiche (passe securite du 2026-11-08).
        exigerAussi(ctx, activite === 'laser_game' ? 'planning.laser' : 'planning.bowling', 'Ce planning ne fait pas partie du rôle de cette personne.');
        if (r.date < aujourdhui()) exigerAussi(ctx, 'planning.past', 'Cette réservation est passée : la déplacer demande le droit de changer un jour passé.');
        const P = require('./programme-a-cocher');
        const etapes = P.etapesACocher(r, await ctx.lire('reglagesDuProgramme'));
        const retirer = rempli(p.retirer) ? booleen(p.retirer, 'le retrait de la partie') : false;
        if (retirer && activite !== 'laser_game') throw erreur('Seule une partie de laser se retire du planning : le bowling se déplace.');
        const heure = retirer ? '' : String(p.heure == null ? '' : p.heure).trim();
        if (!retirer && !HEURE_RX.test(heure)) throw erreur('La nouvelle heure se donne en HH:MM.');
        const blocs = Array.isArray(r.opsPlan && r.opsPlan.resourceBlocks) ? r.opsPlan.resourceBlocks : [];
        const heureDuBloc = (b) => (b && b.startTime ? String(b.startTime).slice(0, 5) : (Number.isFinite(Number(b && b.start)) ? P.heureTexte(Number(b.start) > 48 ? Number(b.start) / 60 : Number(b.start)) : ''));
        let move;
        let lignes;
        let avantVu;
        let unite = '';
        if (activite === 'bowling') {
          const avant = etapes.filter((e) => e.activityId === 'bowling');
          if (!avant.length) throw erreur(`La réservation n° ${r.id} n’a pas de bowling au planning.`);
          const actuelles = [...new Set(avant.flatMap((e) => e.pistes || []))].sort((a, b) => a - b);
          let pistes = actuelles;
          if (rempli(p.pistes)) {
            pistes = (Array.isArray(p.pistes) ? p.pistes : (String(p.pistes).match(/\d+/g) || [])).filter(rempli).map((x) => nombre(x, { min: 1, max: 99, quoi: 'Une piste', entier: true }));
            if (!pistes.length) throw erreur('Les pistes se donnent par leur numéro : 1, 2…');
            if (new Set(pistes).size !== pistes.length) throw erreur('Une piste est donnée deux fois.');
            if (pistes.length !== actuelles.length) throw erreur(`Le groupe joue sur ${actuelles.length} piste${actuelles.length > 1 ? 's' : ''} (${actuelles.join(', ')}) : donnez ${actuelles.length} piste${actuelles.length > 1 ? 's' : ''} de destination, ou aucune pour garder les siennes.`);
          }
          move = { activityId: 'bowling', startTime: heure, lanes: pistes };
          avantVu = empreinteDe(blocs.filter((b) => b && b.resourceType === 'bowling_lane').map((b) => [heureDuBloc(b), b.endTime || b.end || '', b.lanes || []]).concat([[r.startTime, (r.lanes || []).join(',')]]));
          lignes = (candidat) => {
            const apres = (candidat.opsPlan.resourceBlocks || []).filter((b) => b.resourceType === 'bowling_lane').sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
            const dit = (h, l) => `${h}${l && l.length ? `, piste${l.length > 1 ? 's' : ''} ${l.join(', ')}` : ''}`;
            return [{ libelle: 'Bowling', avant: avant.map((e) => dit(P.heureTexte(e.start), e.pistes)).join(' ; '), apres: apres.map((b) => dit(String(b.startTime).slice(0, 5), b.lanes)).join(' ; ') }];
          };
        } else {
          const partie = rempli(p.partie) ? nombre(p.partie, { min: 1, max: 99, quoi: 'La partie', entier: true }) : 1;
          const groupe = rempli(p.groupe) ? nombre(p.groupe, { min: 1, max: 99, quoi: 'Le groupe', entier: true }) : 1;
          unite = `${partie}.${groupe}`;
          const cle = (b) => `${Number(b.countIndex || 1)}.${Number(b.groupWaveIndex || 1)}`;
          const posee = etapes.find((e) => e.activityId === 'laser_game' && !e.aPlacer && Number(e.partie) === partie && Number(e.groupe || 1) === groupe);
          const avant = posee && posee.start != null ? `${P.heureTexte(posee.start)}${posee.estimee ? ' (estimée, sans plan)' : ''}` : 'à placer';
          move = retirer ? { activityId: 'laser_game', unitKey: unite, unplace: true } : { activityId: 'laser_game', unitKey: unite, startTime: heure };
          avantVu = empreinteDe(blocs.filter((b) => b && b.resourceType === 'laser_arena' && cle(b) === unite).map((b) => [heureDuBloc(b), b.endTime || b.end || '']).concat([[avant]]));
          lignes = (candidat) => {
            const bloc = (candidat.opsPlan.resourceBlocks || []).find((b) => b.resourceType === 'laser_arena' && cle(b) === unite);
            return [{ libelle: `Laser, partie ${partie}${groupe > 1 || (bloc && Number(bloc.groupWaveCount) > 1) ? `, groupe ${groupe}` : ''}`, avant, apres: retirer ? 'à placer' : (bloc ? `${String(bloc.startTime).slice(0, 5)} à ${String(bloc.endTime).slice(0, 5)}` : heure) }];
          };
        }
        // CE QUE LA CARTE A MONTRE EST CE QUI BOUGE : l activite deplacee entre-temps arrete le clic.
        if (rempli(p.avant_vu) && String(p.avant_vu) !== avantVu) throw erreur('Cette activité a déjà bougé depuis la carte : redemandez pour relire où elle est.', 409);
        let candidat;
        try {
          candidat = await ctx.lire('apercuDuDeplacement', r.id, JSON.stringify(move));
        } catch (e) {
          if (e && e.expose && e.message) throw erreur(e.message, e.statusCode === 409 ? 409 : 422);
          throw e;
        }
        if (!candidat || !candidat.opsPlan) throw erreur(`La réservation n° ${r.id} n’existe pas dans ce centre.`, 404);
        const nom = activite === 'bowling' ? 'le bowling' : `la partie ${unite.split('.')[0]} du laser`;
        return {
          corps: { id: r.id, baseUpdatedAt: r.version, activityMove: move },
          texte: retirer ? `Retirer du planning ${nom} de la réservation ${dossierDit(r)}.` : `Déplacer ${nom} de la réservation ${dossierDit(r)} à ${heure}.`,
          lignes: [ligneDossier(r), ...lignes(candidat), { libelle: 'Le reste du programme', valeur: 'ne bouge pas' }],
          clients: r.email ? 'Aucun mail ne part au clic. Le rappel avant la venue, s’il n’est pas encore parti, portera le nouveau programme ; pour prévenir le client maintenant, c’est ecrire_ou_repondre_mail.' : null,
          alerte: retirer ? 'La partie quitte le planning : elle attend son heure dans les parties à placer.' : null,
          fait: retirer ? `${nom.charAt(0).toUpperCase()}${nom.slice(1)} de la réservation n° ${r.id} est à placer.` : `${nom.charAt(0).toUpperCase()}${nom.slice(1)} de la réservation n° ${r.id} est déplacé${activite === 'bowling' ? '' : 'e'} à ${heure}.`,
          figer: { avant_vu: avantVu },
        };
      },
    },

    // LES BILANS DE LA PAGE DIRECTION (generateDirectionReport, saveDirectionReport). La periode est
    // celle que l action calculera (periodeDuBilan, lib/direction-analytics.js). UN BILAN MODIFIE A LA
    // MAIN NE SE REGENERE PAS : la carte le refuse, et le serveur le refuse encore sous l ecriture
    // (keepEdited), si quelqu un le modifie entre la carte et le clic. Le bouton de la page, lui,
    // remplace comme avant.
    generer_bilan_direction: {
      domaine: 'Direction', titre: 'Bilan de la direction', verbe: 'Générer le bilan', cours: 'Génération…', confirmer: 'Oui, générer',
      quoi: 'génère le bilan de la semaine ou du mois passé (ou d’une période dite) à partir des données réelles, comme le bouton de la page Direction ; un bilan modifié à la main ne se régénère pas',
      parametres: { periode: 'semaine (par défaut) ou mois', date: 'facultatif, AAAA-MM-JJ : un jour de la semaine ou du mois voulu (sinon la dernière semaine, ou le dernier mois, complet)' },
      action: 'generateDirectionReport', permission: 'direction.view', risque: false,
      async preparer(p, ctx) {
        const type = genreDeBilan(p.periode);
        const date = rempli(p.date) ? dateReelle(p.date) : '';
        if (rempli(p.date) && !date) throw erreur('La date se donne en AAAA-MM-JJ.');
        const per = require('./direction-analytics').periodeDuBilan({ periodType: type, periodStart: date });
        const dite = periodeDite(per);
        if (per.periodStart > new Date().toISOString().slice(0, 10)) throw erreur(`La période ${dite} n’a pas commencé : son bilan ne compterait rien.`);
        const existant = ((await ctx.lire('bilansDirection')) || []).find((b) => b && b.periodType === per.periodType && b.periodStart === per.periodStart);
        if (existant && existant.editedAt) throw erreur(`Le bilan ${dite} a été modifié par ${existant.editedBy || 'la direction'} le ${jourDit(versionDe(existant.editedAt).slice(0, 10))} : le régénérer effacerait ces changements. Pour le changer, c’est modifier_bilan_direction.`, 409);
        const enCours = per.periodEnd >= new Date().toISOString().slice(0, 10);
        return {
          corps: { periodType: per.periodType, periodStart: per.periodStart, keepEdited: true },
          texte: `Générer le bilan ${dite}.`,
          lignes: [
            { libelle: 'Période', valeur: dite },
            { libelle: 'Bilan', avant: existant ? `généré le ${jourDit(versionDe(existant.generatedAt).slice(0, 10))}` : 'aucun', apres: 'une nouvelle version, à partir des données réelles' },
          ],
          clients: null,
          alerte: [existant ? 'La version générée de cette période est remplacée.' : '', enCours ? 'La période n’est pas finie : le bilan ne compte que ce qui est déjà passé.' : ''].filter(Boolean).join(' ') || null,
          fait: `Le bilan ${dite} est généré. Il se relit et se modifie dans la page Direction.`,
        };
      },
    },

    modifier_bilan_direction: {
      domaine: 'Direction', titre: 'Bilan modifié', verbe: 'Enregistrer', cours: 'Enregistrement…', confirmer: 'Oui, enregistrer',
      quoi: 'remplace le texte d’un bilan de la page Direction (son bouton Modifier) ; le nouveau texte part en entier, tel que la carte le montre',
      parametres: { periode: 'semaine ou mois', date: 'facultatif, AAAA-MM-JJ : un jour de la période du bilan (sinon le dernier bilan de ce genre)', texte: 'le nouveau texte entier du bilan, en markdown', titre: 'facultatif, le nouveau titre' },
      action: 'saveDirectionReport', permission: 'direction.view', risque: false,
      async preparer(p, ctx) {
        const tous = ((await ctx.lire('bilansDirection')) || []).filter((b) => b && b.id);
        let b = null;
        if (rempli(p.bilan)) {
          b = tous.find((x) => Number(x.id) === Number(p.bilan)) || null;
          if (!b) throw erreur('Ce bilan n’existe plus dans ce centre : redemandez pour relire les bilans.', 409);
        } else {
          const type = genreDeBilan(p.periode);
          const date = rempli(p.date) ? dateReelle(p.date) : '';
          if (rempli(p.date) && !date) throw erreur('La date se donne en AAAA-MM-JJ.');
          const siens = tous.filter((x) => x.periodType === type).sort((x, y) => (x.periodStart < y.periodStart ? 1 : -1));
          b = date ? siens.find((x) => x.periodStart <= date && date <= x.periodEnd) : siens[0];
          if (!b) throw erreur(`Aucun bilan ${type === 'month' ? 'du mois' : 'de la semaine'}${date ? ` du ${jourDit(date)}` : ''} dans ce centre : générez-le d’abord avec generer_bilan_direction.`, 404);
        }
        // Le texte part tel qu il est ecrit, comme l editeur de la page : seules les fins de ligne s alignent.
        const texte = String(p.texte == null ? '' : p.texte).replace(/\r\n?/g, '\n').trim();
        if (!texte) throw erreur('Le texte du bilan ne peut pas être vide.');
        const titre = rempli(p.titre) ? ligneNette(p.titre) : '';
        if (texte === String(b.bodyMd || '').trim() && (!titre || titre === b.title)) throw erreur('Ce texte est déjà celui du bilan.');
        // CE QUE LA CARTE A REMPLACE EST CE QUI SE REMPLACE : un bilan modifie entre-temps arrete le clic.
        const vu = empreinteDe([b.id, b.bodyMd, b.title, versionDe(b.editedAt), versionDe(b.generatedAt)]);
        if (rempli(p.bilan_vu) && String(p.bilan_vu) !== vu) throw erreur('Ce bilan a changé depuis la carte : redemandez pour relire sa dernière version.', 409);
        const dite = periodeDite(b);
        return {
          corps: { id: Number(b.id), bodyMd: texte, ...(titre ? { title: titre } : {}) },
          texte: `Modifier le bilan ${dite}.`,
          lignes: [
            { libelle: 'Bilan', valeur: `${coupe(b.title || 'Bilan', 120)}, ${dite}` },
            ...(titre ? [{ libelle: 'Titre', avant: b.title || 'aucun', apres: titre }] : []),
            { libelle: 'Texte d’avant', valeur: coupe(b.bodyMd, 220), long: String(b.bodyMd || '') },
            { libelle: 'Nouveau texte', valeur: coupe(texte, 220), long: texte },
          ],
          clients: null,
          alerte: b.editedAt ? `Il remplace la version modifiée par ${b.editedBy || 'la direction'} le ${jourDit(versionDe(b.editedAt).slice(0, 10))}.` : null,
          fait: `Le bilan ${dite} est enregistré.`,
          figer: { bilan: Number(b.id), bilan_vu: vu },
        };
      },
    },
  };
}

// Le genre d un bilan, dans les mots de la personne : la semaine par defaut.
function genreDeBilan(saisie) {
  const t = String(saisie == null ? '' : saisie).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!t.trim() || /semaine|week|hebdo/.test(t)) return 'week';
  if (/mois|month|mensuel/.test(t)) return 'month';
  const e = new Error('Un bilan est de la semaine ou du mois.');
  throw Object.assign(e, { statusCode: 422, expose: true });
}
function periodeDite(b) {
  return b.periodType === 'month' ? `du mois de ${new Date(`${b.periodStart}T12:00:00Z`).toLocaleDateString('fr-BE', { month: 'long', year: 'numeric', timeZone: 'UTC' })}` : `de la semaine du ${jourDit(b.periodStart)} au ${jourDit(b.periodEnd)}`;
}

// L outil de lecture a ouvrir avant un geste de ces domaines (lib/assistant-gestes.js, LIRE_AVANT).
const lireAvant = { Clients: 'fiche_client, clients', Direction: 'bilans_direction' };

module.exports = { lecteurs, gestes, lireAvant, __test: { versionDe, dateReelle, empreinteDe } };
