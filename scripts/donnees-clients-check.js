// LES DONNEES CLIENTS DISENT VRAI (2026-10-05).
//   [A] l enchainement suit l HEURE de la visite (pas l ordre de saisie), deux
//       parties de suite = « ×2 », les joueurs par activite sont justes ;
//   [B] LE client : un meme telephone ecrit de deux facons = un client ; ses
//       visites, sa depense, le temps entre deux visites, sa premiere source ;
//   [C] la provenance : la source stockee, « Comptoir / téléphone » pour une
//       saisie console, « Inconnue » pour une reservation en ligne d avant le
//       suivi ; une annulee ne compte pas ;
//   [D] l entonnoir (creneaux retenus, confirmes, partis) et les demandes sur
//       mesure devenues reservation ;
//   [E] l Excel sort, une feuille par question ; une base sans slot_holds ni
//       custom_requests se lit quand meme ;
//   [G] l agent IA marketing recoit tout, sans nom ni contact, et le
//       controle anti-invention reconnait ses chiffres ;
//   [F] base reelle (PINLANE_TEST_DATABASE_URL) : tout se lit en moins de 2 s.
//   Contre-epreuve : sans le tri par heure, [A] rougit.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { analyserDonnees } = require(path.join(ROOT, 'lib/donnees-clients.js'));
const { classeurDonnees, lireDonnees } = require(path.join(ROOT, 'lib/donnees-api.js'));
let failures = 0;
function ok(c, l, d = '') { console.log(`${c ? 'ok  ' : 'FAIL'}  ${l}${d ? `  ${d}` : ''}`); if (!c) failures += 1; }

const bloc = (activityId, label, start, players) => ({ type: 'activity', activityId, label, start, players });
const resa = (o) => ({ status: 'paid', channel: 'public', pax: 8, price: 100, startTime: '14:00', ...o });
const google = { source: 'Google Ads', dernier: { utm_campaign: 'anniv', source: 'Google Ads', landing: 'https://fungalaxy.be/libramont/anniversaire' }, appareil: 'mobile' };
const history = [
  // Saisie : bowling puis laser. Vecu : laser a 14h, bowling a 15h.
  resa({ id: 1, date: '2026-09-10', name: 'Julie', phone: '+32 470 12 34 56', price: 260, acquisition: google,
    program: { items: [{ activityId: 'bowling', name: 'Bowling', participants: 8 }, { activityId: 'laser_game', name: 'Laser Game', participants: 6 }] },
    opsPlan: { resourceBlocks: [bloc('bowling', 'Bowling', 900, 8), bloc('laser_game', 'Laser Game', 840, 6), bloc('laser_game', 'Laser Game', 870, 6)] } }),
  resa({ id: 2, date: '2026-09-24', name: 'Julie M.', phone: '0470/12.34.56', price: 140, channel: 'staff', type: 'bowling' }),
  resa({ id: 3, date: '2026-09-15', name: 'Marc', phone: '+32 478 00 00 01', price: 90, type: 'laser', program: { items: [{ activityId: 'laser_game', name: 'Laser Game', participants: 4 }] }, pax: 4 }),
  resa({ id: 4, date: '2026-09-16', name: 'Annulé', phone: '+32 478 00 00 02', status: 'cancelled', acquisition: google }),
  resa({ id: 5, date: '2026-08-01', name: 'Julie', phone: '+32470123456', price: 50, type: 'bowling', channel: 'staff' }),
];
const holds = [
  { date: '2026-09-10', payload: { acquisition: google }, reservation_id: 1, release_reason: 'converted' },
  { date: '2026-09-10', payload: { acquisition: google }, reservation_id: null, release_reason: 'released' },
  { date: '2026-09-12', payload: {}, reservation_id: null, release_reason: 'expired' },
];
const demandes = [
  { createdAt: '2026-09-11T10:00:00Z', status: 'handled', payload: { suivi: { historique: [{ type: 'reservation', reservationId: 2 }] } } },
  { createdAt: '2026-09-12T10:00:00Z', status: 'new', payload: {} },
];
const a = analyserDonnees({ history, holds, demandes, startDate: '2026-09-01', endDate: '2026-09-30', aujourdhui: '2026-09-30' });

console.log('[A] activites et enchainements');
const suite = a.suites.find((s) => s.reservations === 1 && s.etapes === 2);
ok(suite && suite.suite === 'Laser Game ×2 → Bowling', '[A] l enchainement suit l heure : laser (deux parties) puis bowling', suite && suite.suite);
const laser = a.activites.find((x) => x.activite === 'Laser Game');
ok(laser && laser.reservations === 2 && laser.parties === 3 && laser.joueurs === 10, '[A] laser : 2 reservations, 3 parties, 10 joueurs', JSON.stringify(laser));
ok(laser && laser.groupeMin === 4 && laser.groupeMax === 6, '[A] laser : plus petit groupe 4, plus grand 6');

console.log('[B] le client');
const julie = a.clients.find((c) => c.cle === 'p:470123456');
ok(julie && julie.visites === 3, '[B] trois ecritures du meme numero : un seul client, trois visites', julie && julie.visites);
ok(julie && julie.depense === 450 && julie.panierMoyen === 150, '[B] sa depense (450) et son panier (150)');
ok(julie && julie.premiereVisite === '2026-08-01' && julie.joursEntreVisites === 27, '[B] premiere visite et temps moyen entre deux visites (40 et 14 jours : 27)', julie && `${julie.premiereVisite} ${julie.joursEntreVisites}`);
ok(julie && julie.sourcePremiere === 'Comptoir / téléphone' && julie.sourceDerniere === 'Comptoir / téléphone', '[B] sa premiere et sa derniere source');
ok(a.fidelite.clientsConnus === 2 && a.fidelite.repartition[0].clients === 1 && a.fidelite.repartition[2].clients === 1, '[B] repartition : un client venu une fois, un venu trois fois');
ok(a.totaux.clientsPeriode === 2 && a.totaux.nouveauxClients === 1 && a.totaux.clientsRevenus === 1, '[B] sur la periode : un nouveau, un revenu');

console.log('[C] la provenance');
const src = Object.fromEntries(a.sources.map((s) => [s.source, s]));
ok(src['Google Ads'] && src['Google Ads'].reservations === 1 && src['Google Ads'].chiffre === 260, '[C] Google Ads : 1 reservation, 260 (l annulee ne compte pas)');
ok(src['Comptoir / téléphone'] && src['Comptoir / téléphone'].reservations === 1, '[C] la saisie console : Comptoir / téléphone');
ok(src['Inconnue (avant le suivi)'] && src['Inconnue (avant le suivi)'].reservations === 1 && src['Inconnue (avant le suivi)'].nouveauxClients === 1, '[C] en ligne sans suivi : Inconnue, compte comme nouveau client');
ok(a.campagnes.length === 1 && a.campagnes[0].campagne === 'anniv' && a.appareils[0].appareil === 'mobile', '[C] la campagne et l appareil');
ok(a.pages[0] && a.pages[0].page === 'fungalaxy.be/libramont/anniversaire', '[C] la page d entree, sans parametres');

console.log('[D] entonnoir et demandes');
const g = a.entonnoir.find((e) => e.source === 'Google Ads');
ok(g && g.creneauxRetenus === 2 && g.confirmes === 1 && g.abandons === 1 && g.tauxConfirmation === 50, '[D] Google Ads : 2 creneaux retenus, 1 confirme, 1 parti', JSON.stringify(g));
ok(a.demandes.recues === 2 && a.demandes.converties === 1, '[D] demandes sur mesure : 2 recues, 1 devenue reservation');

console.log('[E] export et base incomplete');
const xlsx = classeurDonnees(a, { centerId: 'libramont' });
const { lireZip } = require(path.join(ROOT, 'lib/xlsx-writer.js'));
const entrees = lireZip(xlsx);
ok(entrees.length > 0 && entrees.every((e) => e.crcOk), '[E] un vrai classeur (zip intact)');
const workbook = (entrees.find((e) => e.nom === 'xl/workbook.xml') || { donnees: Buffer.from('') }).donnees.toString('utf8');
const chaines = (entrees.find((e) => e.nom === 'xl/sharedStrings.xml') || { donnees: Buffer.from('') }).donnees.toString('utf8');
ok(['Clients', 'Provenance', 'Entonnoir en ligne', 'Activités', 'Enchaînements'].every((n) => workbook.includes(`name="${n}"`)), '[E] une feuille par question');
ok(chaines.includes('Laser Game ×2 → Bowling') && chaines.includes('Julie M.'), '[E] les vraies lignes y sont (enchainement, client)');

(async () => {
  const fauxPool = {
    async query(sql) {
      if (/from (slot_holds|custom_requests)/.test(sql)) throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
      return { rows: [] };
    },
  };
  try {
    const vide = await lireDonnees(fauxPool, { centerId: 'libramont', startDate: '2026-09-01', endDate: '2026-09-30' });
    ok(vide.ok && vide.entonnoir.length === 0 && vide.demandes.recues === 0, '[E] base sans slot_holds ni custom_requests : se lit, vide');
  } catch (error) { ok(false, '[E] base incomplete', error.message); }
  const enPanne = { async query() { throw Object.assign(new Error('connexion perdue'), { code: '57P01' }); } };
  let leve = false;
  try { await lireDonnees(enPanne, { centerId: 'libramont' }); } catch (e) { leve = true; }
  ok(leve, '[E] une vraie panne n est pas maquillee en « aucune donnee »');

  console.log('[G] l agent IA marketing');
  const { buildAskDossier, checkAnswerGrounding } = require(path.join(ROOT, 'lib/marketing-ask.js'));
  const dossier = buildAskDossier({ donnees: a });
  const dc = dossier.donneesClients;
  ok(Boolean(dc) && dc.sources.length === a.sources.length && dc.enchainements[0] && dc.activites.length === a.activites.length, '[G] le dossier de l agent porte les sources, les activites, les enchainements');
  const brut = JSON.stringify(dossier);
  ok(!/Julie|Marc|470|478/.test(brut), '[G] aucun nom ni telephone dans le dossier de l agent');
  const juste = checkAnswerGrounding('Google Ads vous a rapporte 260 € sur la periode, avec un taux de confirmation de 50 %.', { dossier });
  ok(!juste.blocked, '[G] une reponse qui recopie les chiffres passe le controle', juste.reasons.join(' | '));
  const inventee = checkAnswerGrounding('Google Ads vous a rapporte 990 € sur la periode.', { dossier });
  ok(inventee.blocked, '[G] un montant invente est refuse');
  ok(!buildAskDossier({}).donneesClients, '[G] sans donnees, pas de cle vide');

  const url = process.env.PINLANE_TEST_DATABASE_URL;
  if (!url) console.log('[F] base reelle : PINLANE_TEST_DATABASE_URL absente, saute\nGATE-SAUTE-PARTIE [F] base reelle (PINLANE_TEST_DATABASE_URL absente)');
  else if (!/localhost|127\.0\.0\.1|host=\//.test(url)) ok(false, '[F] base reelle refusee : pas locale');
  else {
    const { Pool } = require(path.join(ROOT, 'node_modules/pg'));
    const pool = new Pool({ connectionString: url });
    try {
      const t = Date.now();
      const d = await lireDonnees(pool, { centerId: 'libramont', startDate: '2020-01-01', endDate: '2030-12-31' });
      const ms = Date.now() - t;
      ok(d.ok && Array.isArray(d.clients) && Array.isArray(d.sources) && ms < 2000, `[F] base reelle : ${d.totaux.reservations} reservations, ${d.clients.length} clients, lus en ${ms} ms`);
    } catch (error) { ok(false, '[F] base reelle', error.message); }
    await pool.end();
  }

  const source = fs.readFileSync(path.join(ROOT, 'lib/donnees-clients.js'), 'utf8');
  const ancre = '.slice().sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0))';
  if (source.split(ancre).length !== 2) ok(false, '[contre-épreuve] ancre absente');
  else {
    const f = path.join(path.dirname(require.resolve(path.join(ROOT, 'lib/donnees-clients.js'))), `.donnees-mute-${process.pid}.js`);
    fs.writeFileSync(f, source.replace(ancre, ''));
    try {
      const m = require(f);
      const b = m.analyserDonnees({ history, startDate: '2026-09-01', endDate: '2026-09-30' });
      ok(!b.suites.some((s) => s.suite === 'Laser Game ×2 → Bowling'), '[contre-épreuve] sans le tri par heure, [A] rougit');
    } finally { fs.unlinkSync(f); }
  }
  console.log('');
  console.log(failures ? `donnees-clients-check: ${failures} FAIL` : 'donnees-clients-check: ALL OK (enchainements, clients, provenance, entonnoir, export)');
  process.exit(failures ? 1 : 0);
})();
