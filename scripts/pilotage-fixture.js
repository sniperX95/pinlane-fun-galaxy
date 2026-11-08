// LE BANC DU DASHBOARD (2026-11-08) : un historique de reservations qui ne change jamais,
// passe dans le VRAI calcul du serveur (reponseDashboard, lib/direction-analytics.js). Un banc
// qui servirait des chiffres ecrits a la main prouverait seulement qu on sait les afficher.
//
// Le navigateur demande, le code du serveur repond en Node :
//   const { lecteur, historique } = require('./pilotage-fixture');
//   await page.exposeFunction('__fixtureLecture', lecteur({ history, center }));
// (planning-v3-fixtures.js consulte window.__fixtureLecture avant ses reponses par defaut)
'use strict';

const { reponseDashboard, heuresDePiste } = require('../lib/direction-analytics');

function ajouterJours(jour, n) {
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function hasard(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Combien de groupes un centre recoit, par jour de la semaine (dimanche = 0).
const GROUPES = [15, 0, 3, 8, 4, 12, 22];
const FORMULES = [
  { id: 'banc-kids', label: 'Kids Fun Day', parPersonne: 22 },
  { id: 'banc-anniv', label: 'Anniversaire Galaxy', parPersonne: 19.5 },
  { id: 'banc-team', label: 'Team Building', parPersonne: 34 },
];
const OCCASIONS = ['anniversaire', 'anniversaire', 'amis', 'entreprise', 'ecole', 'evg'];

// L heure d arrivee : l apres-midi le week-end, la soiree en semaine.
function heureDArrivee(tirage, jourSemaine, ouverture, fermeture) {
  const creneaux = [];
  for (let h = ouverture; h <= fermeture - 2; h += 1) {
    let poids = 1;
    if (jourSemaine === 0 || jourSemaine === 6) poids = h >= 14 && h <= 17 ? 6 : (h >= 19 && h <= 20 ? 4 : 1.5);
    else if (jourSemaine === 3) poids = h >= 14 && h <= 16 ? 5 : (h >= 19 ? 3 : 1);
    else poids = h >= 18 && h <= 20 ? 6 : 1;
    creneaux.push({ h, poids });
  }
  let reste = tirage() * creneaux.reduce((s, c) => s + c.poids, 0);
  for (const c of creneaux) {
    reste -= c.poids;
    if (reste <= 0) return c.h;
  }
  return creneaux[creneaux.length - 1].h;
}

// `jour` est la date de la fixture : le passe est paye, l avenir attend. Les reservations du
// jour de la fixture remplacent celles du generateur : un meme jour dit le meme chiffre.
function historique({ jour, center, duJour = [], avant = 150, apres = 13, graine = 20261108 }) {
  const tirage = hasard(graine);
  const lignes = [];
  let id = 500000;
  for (let n = -avant; n <= apres; n += 1) {
    const date = ajouterJours(jour, n);
    if (date === jour) continue;
    const js = new Date(`${date}T00:00:00Z`).getUTCDay();
    const horaire = center.defaultSchedule.regular[String(js)];
    if (!horaire) continue;
    const ouverture = Number(horaire.open.slice(0, 2));
    const fermeture = Number(horaire.close.slice(0, 2));
    // La saison monte doucement ; les 28 derniers jours marchent mieux que les 28 d avant.
    const saison = 1 + (avant + n) / (avant * 4) + (n > -28 ? 0.14 : 0);
    const volume = n > 0
      ? Math.round(GROUPES[js] * saison * Math.max(0.15, 0.95 - n * 0.06))
      : Math.round(GROUPES[js] * saison * (0.78 + tirage() * 0.44));
    for (let i = 0; i < volume; i += 1) {
      id += 1;
      const heure = heureDArrivee(tirage, js, ouverture, fermeture);
      const genre = tirage();
      const client = Math.floor(Math.pow(tirage(), 1.7) * 1400) + 100;
      const passe = n < 0;
      const issue = tirage();
      const paiement = tirage();
      let ligne;
      if (genre < 0.5) {
        const pax = 3 + Math.floor(tirage() * 8);
        const pistes = pax > 6 ? [1, 2] : [1];
        const duree = tirage() < 0.3 ? 2 : 1;
        ligne = { type: 'bowling', pax, lanes: pistes, duration: duree, price: Math.round(pax * duree * 8.5) };
      } else if (genre < 0.74) {
        const pax = 5 + Math.floor(tirage() * 10);
        ligne = { type: 'laser', pax, lanes: [], duration: 0.5, price: pax * 10 };
      } else if (genre < 0.9) {
        const f = FORMULES[Math.floor(tirage() * FORMULES.length)];
        const pax = 8 + Math.floor(tirage() * 8);
        ligne = { type: 'formule', formuleId: f.id, label: f.label, pax, lanes: [1, 2], duration: 2, price: Math.round(pax * f.parPersonne) };
      } else {
        const pax = 2 + Math.floor(tirage() * 6);
        ligne = { type: 'visite', pax, lanes: [], duration: 1, price: pax * 8, program: { items: [{ activityId: 'minigolf', name: 'Mini-golf', participants: pax }] } };
      }
      lignes.push({
        id,
        name: `Client ${client}`,
        phone: `0470${String(client).padStart(6, '0')}`,
        email: '',
        date,
        startTime: `${String(heure).padStart(2, '0')}:${tirage() < 0.5 ? '00' : '30'}`,
        status: !passe ? 'pending' : (issue < 0.05 ? 'cancelled' : 'paid'),
        absentAt: passe && issue >= 0.05 && issue < 0.075 ? `${date}T20:00:00.000Z` : null,
        channel: tirage() < 0.57 ? 'public' : 'staff',
        paymentMethod: paiement < 0.68 ? 'Carte' : (paiement < 0.93 ? 'Espèces' : ''),
        occasion: tirage() < 0.4 ? OCCASIONS[Math.floor(tirage() * OCCASIONS.length)] : '',
        centerId: 'libramont',
        ...ligne,
      });
    }
  }
  return lignes.concat(duJour).sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Ce que /api/staff-state?days= sert (route inchangee par ce lot, recalculee ici).
function serieDesJours(history, fin, nb) {
  const jours = [];
  for (let n = nb - 1; n >= 0; n -= 1) {
    const date = ajouterJours(fin, -n);
    const lignes = history.filter((r) => r.date === date && r.status !== 'cancelled' && !r.absentAt);
    jours.push({
      date,
      reservations: lignes.length,
      players: lignes.reduce((s, r) => s + r.pax, 0),
      revenue: lignes.reduce((s, r) => s + r.price, 0),
      collected: lignes.filter((r) => r.status === 'paid').reduce((s, r) => s + r.price, 0),
      laneHours: lignes.reduce((s, r) => s + heuresDePiste(r), 0),
    });
  }
  return jours;
}

// Le serveur du banc : une lecture du navigateur, ou null (la fixture repond alors).
function lecteur({ history, center, voitLesMontants = true, journal = null }) {
  return (chemin) => {
    const u = new URL(chemin, 'http://banc');
    if (journal) journal.push(chemin);
    if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'dashboardAnalytics') {
      const endDate = u.searchParams.get('endDate');
      return {
        ok: true,
        centerId: 'libramont',
        ...reponseDashboard({
          history: history.filter((r) => r.date <= endDate),
          startDate: u.searchParams.get('startDate'),
          endDate,
          compareStart: u.searchParams.get('compareStart') || '',
          compareEnd: u.searchParams.get('compareEnd') || '',
          center,
          voitLesMontants,
        }),
      };
    }
    if (u.pathname === '/api/staff-state' && Number(u.searchParams.get('days')) > 0) {
      const fin = u.searchParams.get('date');
      return { ok: true, centerId: 'libramont', endDate: fin, days: serieDesJours(history, fin, Number(u.searchParams.get('days'))) };
    }
    return null;
  };
}

module.exports = { historique, lecteur, serieDesJours, ajouterJours };
