'use strict';
// LE BUREAU DES DEMANDES, BRANCHE SUR LE CENTRE (2026-09-29).
//
// lib/demande-bureau porte les regles, pures : l echeance, l etude, la
// reponse, le suivi. Ce module leur donne le centre : son calendrier (grille,
// vacances, fermetures posees), le moteur de reservation (la disponibilite
// publique appelee en interne), le planning du jour, le client connu, le
// cerveau mail du centre et le modele. Chaque dependance s injecte : les gates
// jouent le bureau entier sans base, sans reseau et sans modele.

const bureau = require('./demande-bureau');

function dependancesParDefaut() {
  const { getPool, readStaffState } = require('./database');
  const { getCenter, refreshCenterOverrides } = require('./ops-knowledge');
  const { getSchedule } = require('./booking-config');
  const { loadAvailabilityBlocks, isCenterClosedAt, isLaneBlockedAt } = require('./availability-blocks');
  const { disponibiliteInterne } = require('./disponibilite-interne');
  const { callLlmJson } = require('./llm-client');
  const { jourDuCentre } = require('./center-facts');
  const emailAgent = require('./email-agent');
  return {
    rafraichir: async () => { try { await refreshCenterOverrides(getPool()); } catch (error) { /* socle du depot */ } },
    centre: (id) => { try { return getCenter(id) || null; } catch (error) { return null; } },
    fermetures: async (id) => { try { return await loadAvailabilityBlocks(getPool(), id); } catch (error) { return []; } },
    getSchedule,
    isCenterClosedAt,
    isLaneBlockedAt,
    disponibilite: (params) => disponibiliteInterne(params),
    planning: (date, id) => readStaffState(date, id),
    // Le dernier mail RECU de chaque adresse, pour toute la file en une
    // requete. L ingestion range un mail entrant sous l adresse du client
    // (recipient), comme le fil de la console le lit.
    messagesDuClient: async (id, emails) => {
      const lus = await getPool().query(
        `select lower(recipient) as email, max(created_at) as dernier
           from communications
          where center_id = $1 and direction = 'inbound' and coalesce(channel, '') = 'email'
            and lower(coalesce(recipient, '')) = any($2::text[])
          group by lower(recipient);`,
        [id, emails],
      );
      return new Map((lus.rows || []).map((r) => [String(r.email || ''), r.dernier ? new Date(r.dernier).toISOString() : null]));
    },
    aujourdhui: () => { const j = jourDuCentre(); return j ? j.date : new Date().toISOString().slice(0, 10); },
    client: (email, id, aujourdhui) => emailAgent.matchClient(email, id, undefined, aujourdhui, { detail: true }),
    conversation: (email, id) => emailAgent.conversationAvecLeClient(email, id),
    cerveau: (id, texte) => emailAgent.buildEmailBrain(id, undefined, Date.now(), { tache: 'demande-sur-mesure', texte }),
    llm: (options) => callLlmJson(options),
  };
}

async function calendrierDuCentre(centerId, deps) {
  const center = deps.centre(centerId);
  const blocks = await deps.fermetures(centerId);
  const jourOuvre = bureau.jourOuvreDuCentre({ center, blocks, getSchedule: deps.getSchedule, isCenterClosedAt: deps.isCenterClosedAt });
  return {
    center,
    nom: (center && center.name) || '',
    blocks,
    jourOuvre,
    jourDe: (iso) => ({ ouvert: jourOuvre(iso), schedule: deps.getSchedule(iso, center) }),
  };
}

const adresseDe = (item) => String((item && item.email) || '').trim().toLowerCase();

// La file de la console : chaque demande avec son suivi et, tant qu elle est
// a traiter, son echeance. Un calendrier et une lecture des mails recus par
// centre, pour toute la liste.
//
// L echeance court depuis ce qui attend une reponse : la demande, ou le
// dernier mail du client quand il a ecrit apres la reponse de l equipe.
async function enrichirDemandes(demandes = [], deps = dependancesParDefaut()) {
  await deps.rafraichir();
  const calendriers = new Map();
  const adresses = new Map();
  for (const item of demandes) {
    const id = item.centerId || 'libramont';
    if (!calendriers.has(id)) calendriers.set(id, await calendrierDuCentre(id, deps).catch(() => null));
    if (!adresses.has(id)) adresses.set(id, new Set());
    if (adresseDe(item)) adresses.get(id).add(adresseDe(item));
  }
  const recus = new Map();
  for (const [id, emails] of adresses) {
    let lus = new Map();
    // Une panne de cette lecture laisse la file sans « le client a repondu »,
    // jamais sans file.
    if (emails.size && typeof deps.messagesDuClient === 'function') {
      try { lus = await deps.messagesDuClient(id, [...emails]); } catch (error) { lus = new Map(); }
    }
    recus.set(id, lus);
  }
  return demandes.map((item) => {
    const id = item.centerId || 'libramont';
    const cal = calendriers.get(id);
    const suivi = bureau.resumeDuSuivi(item, { dernierMessageClient: (recus.get(id) || new Map()).get(adresseDe(item)) || null });
    return {
      ...item,
      echeance: cal && suivi.etape === 'a-traiter'
        ? bureau.echeanceDeReponse(suivi.messageClient || item.createdAt, { jourOuvre: cal.jourOuvre })
        : null,
      suivi,
    };
  });
}

const enHeure = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// Une piste fermee ce jour-la (maintenance, blocage pose dans Etablissement) se dessine et se
// compte comme une piste prise : le moteur ne la propose pas non plus.
function pistesFermees(date, { pistes, laneStatuses, blocks, schedule, isLaneBlockedAt }) {
  const sortie = [];
  const ouverture = Math.round(Number(schedule && schedule.open) * 60);
  const fermeture = Math.round(Number(schedule && schedule.close) * 60);
  if (!Number.isFinite(ouverture) || !Number.isFinite(fermeture) || fermeture <= ouverture) return sortie;
  for (let piste = 1; piste <= pistes; piste += 1) {
    let debut = null;
    for (let m = ouverture; m <= fermeture; m += 15) {
      const fermee = m < fermeture && ((laneStatuses && laneStatuses[piste] === 'maintenance')
        || (typeof isLaneBlockedAt === 'function' && isLaneBlockedAt(blocks || [], date, piste, m, m + 15)));
      if (fermee && debut === null) debut = m;
      if (!fermee && debut !== null) {
        sortie.push({ r: 'bowling_lane', d: enHeure(debut), f: enHeure(m), pistes: [piste], libelle: 'Piste fermée', joueurs: 0 });
        debut = null;
      }
    }
  }
  return sortie;
}

// CE QUI EST DEJA PREVU CE JOUR-LA, bloc par bloc : ce que le planning du centre montre, sans les
// noms des clients. Une reservation ancienne sans plan garde ses pistes (laneWindowsFromReservation).
function blocsDuJour(resas) {
  const { laneWindowsFromReservation } = require('./availability-slots');
  const sortie = [];
  resas.forEach((r) => {
    const libelle = String(r.label || '').slice(0, 60);
    const joueurs = Number(r.pax) || 0;
    if (r.startTime) {
      laneWindowsFromReservation(r).forEach((f) => {
        if (!(Number(f.duration) > 0) || !f.lanes.length || !Number.isFinite(Number(f.start))) return;
        const debut = Math.round(Number(f.start) * 60);
        sortie.push({ r: 'bowling_lane', d: enHeure(debut), f: enHeure(debut + Math.round(Number(f.duration) * 60)), pistes: f.lanes.map(Number), libelle, joueurs });
      });
    }
    ((r.opsPlan && r.opsPlan.resourceBlocks) || []).forEach((b) => {
      if (!b || !b.resourceType || b.resourceType === 'bowling_lane' || b.resourceType === 'party_table' || !b.startTime || !b.endTime) return;
      sortie.push({ r: String(b.resourceType), nom: String(b.label || ''), d: String(b.startTime).slice(0, 5), f: String(b.endTime).slice(0, 5), libelle, joueurs: Number(b.players) || joueurs });
    });
  });
  return sortie;
}

async function occupationDuJour(date, centerId, deps, cal = null) {
  const etat = await deps.planning(date, centerId);
  const resas = ((etat && etat.reservations) || []).filter((r) => r && r.status !== 'cancelled' && r.status !== 'rejected');
  const center = cal && cal.center;
  const ressources = (center && center.resources) || {};
  const pistes = Number(ressources.bowling && ressources.bowling.laneCount) || 0;
  const armes = Number(ressources.laser && ressources.laser.weaponCount) || 0;
  const schedule = cal && typeof deps.getSchedule === 'function' ? deps.getSchedule(date, center) : null;
  return {
    reservations: resas.length,
    joueurs: resas.reduce((s, r) => s + (Number(r.pax) || 0), 0),
    capacites: { pistes, armes },
    blocs: [
      ...blocsDuJour(resas),
      ...pistesFermees(date, { pistes, laneStatuses: etat && etat.laneStatuses, blocks: cal && cal.blocks, schedule, isLaneBlockedAt: deps.isLaneBlockedAt }),
    ],
  };
}

async function etudeDeLaDemande(item, deps = dependancesParDefaut()) {
  const centerId = item.centerId || 'libramont';
  await deps.rafraichir();
  const cal = await calendrierDuCentre(centerId, deps);
  const aujourdhui = deps.aujourdhui();
  const etude = await bureau.etudierDemande(item, {
    disponibilite: (params) => deps.disponibilite({ centerId, ...params }),
    jourDe: cal.jourDe,
    occupation: (date) => occupationDuJour(date, centerId, deps, cal),
    aujourdhui,
  });
  let client = null;
  if (item.email) { try { client = await deps.client(item.email, centerId, aujourdhui); } catch (error) { client = null; } }
  return { etude, client, nomDuCentre: cal.nom };
}

// Le brouillon de reponse : l etude a jour, le cerveau du centre, le modele,
// puis les controles. Rien n est envoye ici.
async function brouillonDeLaDemande(item, deps = dependancesParDefaut(), { choix = null, sansIA = false } = {}) {
  const centerId = item.centerId || 'libramont';
  const { etude, client, nomDuCentre } = await etudeDeLaDemande(item, deps);
  // Une heure choisie : le mail ne parle que d elle. Si elle ne tient plus, rien ne s ecrit.
  const etudeDuMail = choix ? bureau.etudeDuChoix(etude, choix) : etude;
  if (choix && !etudeDuMail) return { brouillon: null, etude, client, choixPerime: true };
  const [brain, conversation] = await Promise.all([
    Promise.resolve().then(() => deps.cerveau(centerId, bureau.demandeEnTexte(item))).catch(() => null),
    item.email ? Promise.resolve().then(() => deps.conversation(item.email, centerId)).catch(() => []) : [],
  ]);
  const brouillon = await bureau.redigerReponse({ item, etude: etudeDuMail, client, conversation, brain, llm: sansIA ? null : deps.llm, nomDuCentre });
  return { brouillon, etude, client };
}

module.exports = {
  dependancesParDefaut,
  enrichirDemandes,
  etudeDeLaDemande,
  brouillonDeLaDemande,
};
