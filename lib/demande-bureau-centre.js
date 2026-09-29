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
  const { loadAvailabilityBlocks, isCenterClosedAt } = require('./availability-blocks');
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
    client: (email, id, aujourdhui) => emailAgent.matchClient(email, id, undefined, aujourdhui),
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

async function occupationDuJour(date, centerId, deps) {
  const etat = await deps.planning(date, centerId);
  const resas = ((etat && etat.reservations) || []).filter((r) => r && r.status !== 'cancelled' && r.status !== 'rejected');
  return { reservations: resas.length, joueurs: resas.reduce((s, r) => s + (Number(r.pax) || 0), 0) };
}

async function etudeDeLaDemande(item, deps = dependancesParDefaut()) {
  const centerId = item.centerId || 'libramont';
  await deps.rafraichir();
  const cal = await calendrierDuCentre(centerId, deps);
  const aujourdhui = deps.aujourdhui();
  const etude = await bureau.etudierDemande(item, {
    disponibilite: (params) => deps.disponibilite({ centerId, ...params }),
    jourDe: cal.jourDe,
    occupation: (date) => occupationDuJour(date, centerId, deps),
    aujourdhui,
  });
  let client = null;
  if (item.email) { try { client = await deps.client(item.email, centerId, aujourdhui); } catch (error) { client = null; } }
  return { etude, client, nomDuCentre: cal.nom };
}

// Le brouillon de reponse : l etude a jour, le cerveau du centre, le modele,
// puis les controles. Rien n est envoye ici.
async function brouillonDeLaDemande(item, deps = dependancesParDefaut()) {
  const centerId = item.centerId || 'libramont';
  const { etude, client, nomDuCentre } = await etudeDeLaDemande(item, deps);
  const [brain, conversation] = await Promise.all([
    Promise.resolve().then(() => deps.cerveau(centerId, bureau.demandeEnTexte(item))).catch(() => null),
    item.email ? Promise.resolve().then(() => deps.conversation(item.email, centerId)).catch(() => []) : [],
  ]);
  const brouillon = await bureau.redigerReponse({ item, etude, client, conversation, brain, llm: deps.llm, nomDuCentre });
  return { brouillon, etude, client };
}

module.exports = {
  dependancesParDefaut,
  enrichirDemandes,
  etudeDeLaDemande,
  brouillonDeLaDemande,
};
