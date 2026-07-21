// Gate des capacites de decision Direction : ISOLATION de la comparaison (un
// directeur ne compare QUE les centres de son client) et exactitude des clients
// DORMANTS. Dependances lourdes (readAdminRangeState, getCenter) remplacees par
// des fixtures via require.cache.
'use strict';
const Module = require('module');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const resolve = (p) => require.resolve(path.join(ROOT, p));

const END = '2026-07-21';
function daysAgo(n) { const d = new Date(`${END}T00:00:00`); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

// Reservations de fixture PAR CENTRE.
const RES = {
  libramont: [
    // Client dormant : 3 visites, derniere il y a 200 j (habitue parti).
    { name: 'Habitue Parti', phone: '111', status: 'paid', price: 60, date: daysAgo(400), occasion: 'anniversaire', channel: 'public', utm_source: 'facebook' },
    { name: 'Habitue Parti', phone: '111', status: 'paid', price: 60, date: daysAgo(300), occasion: 'anniversaire', channel: 'public' },
    { name: 'Habitue Parti', phone: '111', status: 'paid', price: 60, date: daysAgo(200), occasion: 'anniversaire', channel: 'public' },
    // Recurrent recent : 2 visites, derniere il y a 10 j (PAS dormant). Dans la fenetre.
    { name: 'Fidele Recent', phone: '333', status: 'paid', price: 80, date: daysAgo(40), occasion: 'entreprise', channel: 'staff' },
    { name: 'Fidele Recent', phone: '333', status: 'paid', price: 90, date: daysAgo(10), occasion: 'entreprise', channel: 'public', utm_source: 'facebook' },
    // Nouveau de la periode : 1 visite il y a 5 j.
    { name: 'Nouveau', phone: '222', status: 'confirmed', price: 50, date: daysAgo(5), occasion: 'anniversaire', channel: 'public', utm_source: 'google' },
  ],
  gembloux: [
    { name: 'X', phone: '999', status: 'paid', price: 30, date: daysAgo(3) },
  ],
  ciney: [],
  'lac-centre': [
    { name: 'Autre Client', phone: '777', status: 'paid', price: 999, date: daysAgo(2) },
  ],
};

function stub(relPath, exportsObj) {
  const id = resolve(relPath);
  const m = new Module(id); m.filename = id; m.loaded = true; m.exports = exportsObj;
  require.cache[id] = m;
}
stub('lib/database.js', {
  readAdminRangeState: async (_start, _end, centerId) => ({ reservations: (RES[centerId] || []).slice() }),
});
stub('lib/ops-knowledge.js', {
  getCenter: (id) => ({ id, name: id, resources: { bowling: { laneCount: 8, normalCapacityPerLane: 6 } } }),
});

// Faux pool : isolation par client. libramont -> client 'fungalaxy' (3 centres),
// jamais lac-centre (client 'bowling-du-lac').
const pool = {
  async query(sql, params) {
    const s = String(sql);
    if (/select client_id from centers where id/i.test(s)) return { rowCount: 1, rows: [{ client_id: params[0] === 'lac-centre' ? 'bowling-du-lac' : 'fungalaxy' }] };
    if (/where client_id = \$1/i.test(s)) {
      if (params[0] === 'fungalaxy') return { rows: [{ id: 'libramont', name: 'Fun Galaxy Libramont' }, { id: 'gembloux', name: 'Fun Galaxy Gembloux' }, { id: 'ciney', name: 'Fun Galaxy Ciney' }] };
      return { rows: [{ id: 'lac-centre', name: 'Bowling du Lac Centre' }] };
    }
    if (/where id = \$1;/i.test(s)) return { rows: [{ id: params[0], name: params[0] }] };
    return { rows: [] };
  },
};

const { buildDirectionComparison, buildDirectionRetention, buildDirectionAudience } = require(resolve('lib/direction-insights.js'));

const checks = []; let passed = 0;
function ok(n, c, d) { checks.push({ n, c: !!c }); console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? ' :: ' + d : ''}`); if (c) passed += 1; }

(async () => {
  console.log('\n[A] Comparaison : ISOLATION par client (le nerf de la guerre)');
  const cmp = await buildDirectionComparison(pool, 'libramont', daysAgo(29), END);
  const ids = cmp.centers.map((c) => c.id);
  ok('les 3 centres du client sont compares', ['libramont', 'gembloux', 'ciney'].every((id) => ids.includes(id)), ids.join(','));
  ok('AUCUN centre d un autre client (lac-centre absent)', !ids.includes('lac-centre'));
  ok('le centre courant est marque', cmp.centers.find((c) => c.id === 'libramont').isCurrent === true);
  ok('chaque centre porte ses totals (CA, resas)', cmp.centers.every((c) => c.error || (typeof c.revenue === 'number' && typeof c.reservations === 'number')));

  console.log('\n[B] Isolation inverse : un directeur d un AUTRE client ne voit que le sien');
  const cmp2 = await buildDirectionComparison(pool, 'lac-centre', daysAgo(29), END);
  const ids2 = cmp2.centers.map((c) => c.id);
  ok('client B ne voit que lac-centre', ids2.length === 1 && ids2[0] === 'lac-centre', ids2.join(','));
  ok('client B ne voit PAS les centres de Fun Galaxy', !ids2.some((id) => ['libramont', 'gembloux', 'ciney'].includes(id)));

  console.log('\n[C] Retention : dormants = habitues partis, pas les recents');
  const ret = await buildDirectionRetention('libramont', daysAgo(29), END, { lapsedSinceDays: 60 });
  const lapsedNames = ret.lapsed.map((c) => c.name);
  ok('l habitue parti (3 visites, 200 j) est dormant', lapsedNames.includes('Habitue Parti'), lapsedNames.join(','));
  ok('le fidele recent (10 j) N EST PAS dormant', !lapsedNames.includes('Fidele Recent'));
  ok('le nouveau (1 visite) N EST PAS dormant', !lapsedNames.includes('Nouveau'));
  ok('le dormant montre son nombre de visites', (ret.lapsed.find((c) => c.name === 'Habitue Parti') || {}).visits === 3);
  ok('segment expose new/returning/panier', ret.segment && typeof ret.segment.avgBasketNew === 'number' && typeof ret.segment.avgBasketReturning === 'number');
  ok('testData present (SaaS non lance)', ret.testData === true);

  console.log('\n[D] Contre-preuve par MUTATION : un dormant recent NE doit PAS sortir');
  // Si on abaisse le seuil a 5 j, le fidele recent (10 j) devient dormant : la
  // logique de seuil est bien active (pas un filtre en dur).
  const retLoose = await buildDirectionRetention('libramont', daysAgo(29), END, { lapsedSinceDays: 5 });
  ok('seuil 5 j : le fidele recent (10 j) devient dormant', retLoose.lapsed.map((c) => c.name).includes('Fidele Recent'));

  console.log('\n[E] Provenance & public : occasions/canaux calcules, demographie honnete');
  const aud = await buildDirectionAudience('libramont', daysAgo(29), END);
  // Fenetre = 29 derniers jours : Fidele Recent (10 j, entreprise, public+utm google? non facebook), Nouveau (5 j, anniversaire, google). Fidele Recent 40 j est HORS fenetre.
  const occKeys = aud.occasions.map((o) => o.key);
  ok('occasions calculees sur la fenetre', occKeys.includes('anniversaire') && occKeys.includes('entreprise'), occKeys.join(','));
  const anniv = aud.occasions.find((o) => o.key === 'anniversaire');
  ok('l occasion porte compte + CA + part', anniv && typeof anniv.revenue === 'number' && typeof anniv.share === 'number' && anniv.count >= 1);
  ok('canaux calcules (en ligne / staff)', aud.channels.some((c) => c.key === 'public') || aud.channels.some((c) => c.key === 'staff'));
  ok('sources marketing calculees quand utm present', aud.hasSource === true && aud.sources.some((s) => ['google', 'facebook'].includes(s.key)), JSON.stringify(aud.sources.map((s) => s.key)));
  ok('demographie HONNETE : marquee non connectee (Google Analytics)', aud.demographicsConnected === false && aud.demographicsSource === 'google-analytics');
  ok('aucune donnee demographique inventee', !('age' in aud) && !('gender' in aud) && !('sexe' in aud));

  const failed = checks.filter((c) => !c.c);
  console.log(`\ndirection-insights-check: ${passed}/${checks.length} verts.`);
  if (failed.length) { console.error(`direction-insights-check: ECHEC (${failed.length}).`); process.exit(1); }
  console.log('direction-insights-check: ALL OK (comparaison isolee par client, dormants exacts et pilotes par le seuil)');
  process.exit(0);
})().catch((e) => { console.error('direction-insights-check: exception', e && e.stack || e); process.exit(1); });
