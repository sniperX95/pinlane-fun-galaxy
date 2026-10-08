// QUI VIENT, D OU, POUR QUOI, COMBIEN DE FOIS (2026-10-05).
//
// Movsar : « qui paie quoi, combien, combien de fois ils sont venus, combien
// depense, quelle activite, quelle frequence, le nombre de joueurs pour chaque
// activite, quelle suite d activites, qui revient ». Ce module repond a tout
// cela a partir des reservations (et des blocages en ligne pour l entonnoir),
// sans rien recalculer cote navigateur : la Direction, l export et l agent IA
// lisent les MEMES chiffres.
//
// Regles :
//   - LE client = client_key (migration 0055), sinon la meme cle calculee ici
//     (telephone, sinon e-mail, sinon nom) : une base pas migree marche aussi ;
//   - une reservation compte si elle n est pas annulee ; « payee » = statut
//     paid ;
//   - la provenance vient de acquisition.source. Une reservation saisie au
//     comptoir est « Comptoir / téléphone ». Une reservation en ligne d avant
//     le suivi est « Inconnue (avant le suivi) » : on ne devine pas.
'use strict';

const { reservationActivityEntries } = require('./reservation-activities');
const { excludeSimulationRows } = require('./simulation-filter');

const ACTIFS = new Set(['pending', 'arrived', 'paid']);
const SANS_SUIVI = 'Inconnue (avant le suivi)';
const COMPTOIR = 'Comptoir / téléphone';

const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;

// Ce qui a VRAIMENT ete encaisse (0056) : le montant note a l accueil, sinon
// le prix du dossier. Un dossier non paye n a rien encaisse.
const encaisseDe = (r) => (r.status !== 'paid' ? 0 : (r.amountPaid != null && Number.isFinite(Number(r.amountPaid)) ? Number(r.amountPaid) : Number(r.price) || 0));
// Un groupe pointe absent n est pas venu : il ne compte ni comme visite ni
// comme chiffre, il compte comme absence.
const estAbsent = (r) => Boolean(r.absentAt);
const estVenu = (r) => ACTIFS.has(r.status) && !estAbsent(r);

function cleClient(r) {
  if (r.clientKey) return r.clientKey;
  const tel = String(r.phone || '').replace(/\D/g, '');
  if (tel.length >= 6) return `p:${tel.slice(-9)}`;
  const mail = String(r.email || '').trim().toLowerCase();
  if (mail.includes('@')) return `e:${mail}`;
  const nom = String(r.name || '').trim().toLowerCase();
  return nom ? `n:${nom}` : '';
}

function sourceDe(r) {
  const a = r.acquisition;
  if (a && a.source) return a.source;
  return r.channel === 'public' ? SANS_SUIVI : COMPTOIR;
}

function jours(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// LES ACTIVITES D UNE RESERVATION, dans l ordre ou le groupe les vit :
// les blocs horodates du plan font foi, sinon l ordre de la fiche programme.
// Deux blocs consecutifs de la meme activite (deux parties de laser) = une
// etape « Laser Game ×2 ».
function etapes(r) {
  const blocs = r.opsPlan && Array.isArray(r.opsPlan.resourceBlocks)
    ? r.opsPlan.resourceBlocks.filter((b) => b && b.type === 'activity' && b.activityId)
      .slice().sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0))
    : [];
  const brut = blocs.length
    // joueursReels : une arene privatisee retient toutes les armes dans players.
    ? blocs.map((b) => ({ id: String(b.activityId), nom: b.label || b.activityId, joueurs: Number(b.joueursReels ?? b.players) || 0 }))
    : reservationActivityEntries(r).map((e) => {
      const item = (r.program && Array.isArray(r.program.items) ? r.program.items : []).find((i) => String(i.activityId) === e.id);
      return { id: e.id, nom: e.name, joueurs: Number(item && item.participants) || 0 };
    });
  const out = [];
  for (const e of brut) {
    const der = out[out.length - 1];
    if (der && der.id === e.id) { der.fois += 1; der.joueurs = Math.max(der.joueurs, e.joueurs); } else out.push({ ...e, fois: 1 });
  }
  return out.map((e) => ({ ...e, joueurs: e.joueurs > 0 && e.joueurs <= (r.pax || e.joueurs) ? e.joueurs : (r.pax || 0) }));
}

function grouper(map, cle, init) {
  if (!map.has(cle)) map.set(cle, init());
  return map.get(cle);
}

function analyserDonnees({ history = [], holds = [], demandes = [], startDate, endDate, aujourdhui = '' } = {}) {
  const tout = excludeSimulationRows(history);
  const fenetre = tout.filter((r) => r.date >= startDate && r.date <= endDate);
  const actives = fenetre.filter(estVenu);
  const absents = fenetre.filter((r) => ACTIFS.has(r.status) && estAbsent(r));
  const annulees = fenetre.filter((r) => r.status === 'cancelled');

  // ── LES CLIENTS, sur TOUT l historique (la fidelite ne se lit pas sur 30 jours).
  const clients = new Map();
  const absencesEnAttente = new Map();
  for (const r of tout) {
    if (!ACTIFS.has(r.status)) continue;
    const cle = cleClient(r);
    if (cle && estAbsent(r)) { const c0 = clients.get(cle); if (c0) c0.absences += 1; else absencesEnAttente.set(cle, (absencesEnAttente.get(cle) || 0) + 1); continue; }
    if (!cle) continue;
    const c = grouper(clients, cle, () => ({ cle, nom: r.name, telephone: r.phone || '', email: r.email || '', dates: [], depense: 0, paye: 0, joueurs: 0, activites: new Map(), sources: [], dansFenetre: 0, depenseFenetre: 0, absences: absencesEnAttente.get(cle) || 0 }));
    c.dates.push(r.date);
    c.depense += Number(r.price) || 0;
    c.paye += encaisseDe(r);
    c.joueurs = Math.max(c.joueurs, Number(r.pax) || 0);
    if (r.date >= c.derniereDate || !c.derniereDate) { c.derniereDate = r.date; c.nom = r.name || c.nom; c.telephone = r.phone || c.telephone; c.email = r.email || c.email; }
    for (const e of etapes(r)) c.activites.set(e.nom, (c.activites.get(e.nom) || 0) + 1);
    c.sources.push({ date: r.date, source: sourceDe(r) });
    if (r.date >= startDate && r.date <= endDate) { c.dansFenetre += 1; c.depenseFenetre += Number(r.price) || 0; }
  }
  const fiches = [...clients.values()].map((c) => {
    const dates = c.dates.slice().sort();
    const ecarts = dates.slice(1).map((d, i) => jours(dates[i], d)).filter((n) => n > 0);
    const sources = c.sources.slice().sort((a, b) => a.date.localeCompare(b.date));
    const favorite = [...c.activites.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      cle: c.cle,
      nom: c.nom,
      telephone: c.telephone,
      email: c.email,
      visites: dates.length,
      depense: r2(c.depense),
      paye: r2(c.paye),
      absences: c.absences,
      panierMoyen: r2(c.depense / dates.length),
      premiereVisite: dates[0],
      derniereVisite: dates[dates.length - 1],
      joursEntreVisites: ecarts.length ? Math.round(ecarts.reduce((s, n) => s + n, 0) / ecarts.length) : null,
      // Une reservation a venir n est pas « il y a -4 jours » : vide.
      joursDepuisDerniere: aujourdhui && dates[dates.length - 1] <= aujourdhui ? jours(dates[dates.length - 1], aujourdhui) : null,
      activiteFavorite: favorite ? favorite[0] : '',
      activites: Object.fromEntries(c.activites),
      groupeMax: c.joueurs,
      sourcePremiere: sources[0] ? sources[0].source : '',
      sourceDerniere: sources.length ? sources[sources.length - 1].source : '',
      visitesPeriode: c.dansFenetre,
      depensePeriode: r2(c.depenseFenetre),
    };
  }).sort((a, b) => b.depense - a.depense || b.visites - a.visites);

  const venusPeriode = fiches.filter((f) => f.visitesPeriode > 0);
  const nouveaux = venusPeriode.filter((f) => f.premiereVisite >= startDate);
  const revenus = venusPeriode.filter((f) => f.premiereVisite < startDate || f.visitesPeriode > 1);
  const repartition = [1, 2, 3, 4].map((n) => ({
    visites: n === 4 ? '4 et plus' : String(n),
    clients: fiches.filter((f) => (n === 4 ? f.visites >= 4 : f.visites === n)).length,
  }));
  const deuxiemes = fiches.filter((f) => f.visites > 1).map((f) => f.joursEntreVisites).filter((n) => n != null);
  const caFideles = fiches.filter((f) => f.visites > 1).reduce((s, f) => s + f.depense, 0);
  const caTotal = fiches.reduce((s, f) => s + f.depense, 0);

  // ── PROVENANCE, sur la fenetre.
  const parSource = new Map();
  const parCampagne = new Map();
  const parAppareil = new Map();
  const parPage = new Map();
  const premiereParCle = new Map(fiches.map((f) => [f.cle, f.premiereVisite]));
  for (const r of actives) {
    const s = grouper(parSource, sourceDe(r), () => ({ source: sourceDe(r), reservations: 0, chiffre: 0, encaisse: 0, joueurs: 0, nouveauxClients: 0 }));
    s.reservations += 1; s.chiffre += Number(r.price) || 0; s.joueurs += Number(r.pax) || 0;
    s.encaisse += encaisseDe(r);
    if (premiereParCle.get(cleClient(r)) === r.date) s.nouveauxClients += 1;
    const d = r.acquisition && r.acquisition.dernier ? r.acquisition.dernier : null;
    if (d && d.utm_campaign) {
      const k = `${sourceDe(r)} · ${d.utm_campaign}`;
      const c = grouper(parCampagne, k, () => ({ campagne: d.utm_campaign, source: sourceDe(r), reservations: 0, chiffre: 0 }));
      c.reservations += 1; c.chiffre += Number(r.price) || 0;
    }
    if (r.acquisition && r.acquisition.appareil) {
      const a = grouper(parAppareil, r.acquisition.appareil, () => ({ appareil: r.acquisition.appareil, reservations: 0, chiffre: 0 }));
      a.reservations += 1; a.chiffre += Number(r.price) || 0;
    }
    const page = d && (d.hote || d.landing);
    if (page) {
      let chemin = page;
      try { const u = new URL(page); chemin = `${u.hostname.replace(/^www\./, '')}${u.pathname}`; } catch (e) { /* garde tel quel */ }
      const p = grouper(parPage, chemin, () => ({ page: chemin, reservations: 0, chiffre: 0 }));
      p.reservations += 1; p.chiffre += Number(r.price) || 0;
    }
  }
  // Les absences par source : une campagne qui amene des groupes qui ne
  // viennent pas coute plus qu elle ne rapporte.
  for (const r of absents) {
    const s = grouper(parSource, sourceDe(r), () => ({ source: sourceDe(r), reservations: 0, chiffre: 0, encaisse: 0, joueurs: 0, nouveauxClients: 0 }));
    s.absences = (s.absences || 0) + 1;
  }
  const finSource = (s) => ({ absences: 0, ...s, chiffre: r2(s.chiffre), encaisse: r2(s.encaisse), panierMoyen: s.reservations ? r2(s.chiffre / s.reservations) : 0 });

  // ── ENTONNOIR EN LIGNE : un client qui choisit un creneau le retient dix
  // minutes (slot_holds) ; il confirme, ou il part. Par source.
  const entonnoir = new Map();
  for (const h of holds) {
    if (!h || h.date < startDate || h.date > endDate) continue;
    const a = h.payload && h.payload.acquisition;
    const src = a && a.source ? a.source : SANS_SUIVI;
    const e = grouper(entonnoir, src, () => ({ source: src, creneauxRetenus: 0, confirmes: 0 }));
    e.creneauxRetenus += 1;
    if (h.reservation_id || h.release_reason === 'converted') e.confirmes += 1;
  }

  // ── ACTIVITES : combien de fois demandee, combien de joueurs, le chiffre.
  const parActivite = new Map();
  const suites = new Map();
  const tailles = new Map();
  for (const r of actives) {
    const et = etapes(r);
    for (const e of et) {
      const a = grouper(parActivite, e.nom, () => ({ activite: e.nom, reservations: 0, parties: 0, joueurs: 0, groupes: [] }));
      a.reservations += 1; a.parties += e.fois; a.joueurs += e.joueurs; a.groupes.push(e.joueurs);
    }
    if (et.length) {
      const k = et.map((e) => (e.fois > 1 ? `${e.nom} ×${e.fois}` : e.nom)).join(' → ');
      const s = grouper(suites, k, () => ({ suite: k, etapes: et.length, reservations: 0, chiffre: 0, joueurs: 0 }));
      s.reservations += 1; s.chiffre += Number(r.price) || 0; s.joueurs += Number(r.pax) || 0;
    }
    const pax = Number(r.pax) || 0;
    const t = pax <= 2 ? '1-2' : pax <= 5 ? '3-5' : pax <= 10 ? '6-10' : pax <= 20 ? '11-20' : '21 et plus';
    const g = grouper(tailles, t, () => ({ groupe: t, reservations: 0, chiffre: 0 }));
    g.reservations += 1; g.chiffre += Number(r.price) || 0;
  }
  const activites = [...parActivite.values()].map((a) => {
    const tri = a.groupes.slice().sort((x, y) => x - y);
    return {
      activite: a.activite,
      reservations: a.reservations,
      parties: a.parties,
      joueurs: a.joueurs,
      joueursMoyen: a.reservations ? r1(a.joueurs / a.reservations) : 0,
      joueursMedian: tri.length ? tri[Math.floor(tri.length / 2)] : 0,
      groupeMin: tri[0] || 0,
      groupeMax: tri[tri.length - 1] || 0,
    };
  }).sort((a, b) => b.reservations - a.reservations || b.joueurs - a.joueurs);

  // ── DEMANDES SUR MESURE : combien, combien converties en reservation.
  const demandesFenetre = demandes.filter((d) => {
    const jour = String(d.createdAt || d.created_at || '').slice(0, 10);
    return jour >= startDate && jour <= endDate;
  });
  const parStatut = {};
  for (const d of demandesFenetre) parStatut[d.status || 'nouvelle'] = (parStatut[d.status || 'nouvelle'] || 0) + 1;
  // Une demande « convertie » = son suivi porte la reservation qui en est nee.
  const converties = demandesFenetre.filter((d) => {
    const suivi = d.payload && d.payload.suivi && Array.isArray(d.payload.suivi.historique) ? d.payload.suivi.historique : [];
    return suivi.some((e) => e && e.type === 'reservation' && Number(e.reservationId) > 0);
  }).length;

  const chiffre = actives.reduce((s, r) => s + (Number(r.price) || 0), 0);
  return {
    startDate,
    endDate,
    totaux: {
      reservations: actives.length,
      annulees: annulees.length,
      chiffre: r2(chiffre),
      encaisse: r2(actives.reduce((s, r) => s + encaisseDe(r), 0)),
      // Ce qui n a pas ete encaisse sur des dossiers payes (remises, gestes).
      remises: r2(actives.filter((r) => r.status === 'paid' && r.amountPaid != null).reduce((s, r) => s + Math.max(0, (Number(r.price) || 0) - Number(r.amountPaid)), 0)),
      absences: absents.length,
      tauxAbsence: (actives.length + absents.length) ? r1((absents.length / (actives.length + absents.length)) * 100) : 0,
      panierMoyen: actives.length ? r2(chiffre / actives.length) : 0,
      joueurs: actives.reduce((s, r) => s + (Number(r.pax) || 0), 0),
      clientsPeriode: venusPeriode.length,
      nouveauxClients: nouveaux.length,
      clientsRevenus: revenus.length,
      reservationsAvecSource: actives.filter((r) => r.acquisition && r.acquisition.source).length,
    },
    fidelite: {
      clientsConnus: fiches.length,
      repartition,
      tauxRetour: fiches.length ? r1((fiches.filter((f) => f.visites > 1).length / fiches.length) * 100) : 0,
      joursMoyensEntreVisites: deuxiemes.length ? Math.round(deuxiemes.reduce((s, n) => s + n, 0) / deuxiemes.length) : null,
      partChiffreFideles: caTotal ? r1((caFideles / caTotal) * 100) : 0,
      depenseMoyenneParClient: fiches.length ? r2(caTotal / fiches.length) : 0,
    },
    sources: [...parSource.values()].map(finSource).sort((a, b) => b.reservations - a.reservations || b.chiffre - a.chiffre),
    campagnes: [...parCampagne.values()].map((c) => ({ ...c, chiffre: r2(c.chiffre) })).sort((a, b) => b.reservations - a.reservations),
    appareils: [...parAppareil.values()].map((c) => ({ ...c, chiffre: r2(c.chiffre) })).sort((a, b) => b.reservations - a.reservations),
    pages: [...parPage.values()].map((c) => ({ ...c, chiffre: r2(c.chiffre) })).sort((a, b) => b.reservations - a.reservations).slice(0, 30),
    entonnoir: [...entonnoir.values()].map((e) => ({ ...e, abandons: e.creneauxRetenus - e.confirmes, tauxConfirmation: e.creneauxRetenus ? r1((e.confirmes / e.creneauxRetenus) * 100) : 0 })).sort((a, b) => b.creneauxRetenus - a.creneauxRetenus),
    activites,
    suites: [...suites.values()].map((s) => ({ ...s, chiffre: r2(s.chiffre), panierMoyen: r2(s.chiffre / s.reservations) })).sort((a, b) => b.reservations - a.reservations || b.chiffre - a.chiffre).slice(0, 40),
    tailles: ['1-2', '3-5', '6-10', '11-20', '21 et plus'].map((t) => tailles.get(t) || { groupe: t, reservations: 0, chiffre: 0 }).map((g) => ({ ...g, chiffre: r2(g.chiffre) })),
    demandes: { recues: demandesFenetre.length, converties, tauxConversion: demandesFenetre.length ? r1((converties / demandesFenetre.length) * 100) : 0, parStatut },
    clients: fiches,
  };
}

module.exports = { analyserDonnees, etapes, cleClient, sourceDe, SANS_SUIVI, COMPTOIR };
