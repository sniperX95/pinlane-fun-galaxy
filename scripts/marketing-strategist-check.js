// Tests du Stratège (Phase 4). Purs : calendrier déterministe + garde-fou
// d'ancrage. Aucune DB, aucun réseau, aucune date « maintenant ».
const s = require('../lib/marketing-strategist');

let failures = 0;
function ok(cond, label, detail) {
  if (cond) { console.log(`ok    ${label}`); return; }
  failures += 1;
  console.log(`FAIL  ${label}`);
  if (detail) console.log(`      ${detail}`);
}

const TODAY = '2026-07-16'; // un jeudi

console.log('[CALENDRIER] la maille est le lundi, c\'est la maille de décision du gérant');
ok(s.mondayOf('2026-07-16') === '2026-07-13', 'jeudi -> lundi de sa semaine');
ok(s.mondayOf('2026-07-13') === '2026-07-13', 'lundi -> lui-même');
// Le dimanche est le piège classique : getUTCDay() rend 0, un décalage naïf
// enverrait sur le lundi SUIVANT au lieu du précédent.
ok(s.mondayOf('2026-07-19') === '2026-07-13', 'dimanche -> lundi PRÉCÉDENT (piège du jour 0)');
ok(s.addDays('2026-12-31', 1) === '2027-01-01', 'passage d\'année');
ok(s.addDays('2026-02-28', 1) === '2026-03-01', 'fin de février (2026 non bissextile)');

console.log('\n[HORIZON] 8 semaines contiguës, sans trou ni chevauchement');
const h = s.buildPlanHorizon('libramont', { today: TODAY, weeks: 8 });
ok(h.length === 8, '8 semaines');
ok(h[0].from === '2026-07-13' && h[0].to === '2026-07-19', 'semaine 1 = lundi -> dimanche');
let contigu = true;
for (let i = 1; i < h.length; i += 1) if (s.addDays(h[i - 1].to, 1) !== h[i].from) contigu = false;
ok(contigu, 'les semaines s\'enchaînent sans trou');
ok(s.buildPlanHorizon('libramont', { today: TODAY, weeks: 999 }).length === s.MAX_HORIZON_WEEKS,
  'horizon plafonné (un plan à 999 semaines est du bruit, pas une stratégie)');

console.log('\n[PAR CENTRE] les deux centres n\'ont PAS le même calendrier');
const hg = s.buildPlanHorizon('gembloux', { today: TODAY, weeks: 8 });
const foireL = h.some((w) => w.calendarFacts.some((f) => /Foire de Libramont/.test(f.label)));
const foireG = hg.some((w) => w.calendarFacts.some((f) => /Foire de Libramont/.test(f.label)));
ok(foireL, 'la Foire de Libramont apparaît chez Libramont');
ok(!foireG, 'la Foire de Libramont N\'apparaît PAS chez Gembloux (événement local, pas de groupe)');

console.log('\n[HONNÊTETÉ] une semaine sans ancre est dite telle quelle');
const ctx = { centerId: 'libramont', city: 'Libramont', activities: ['Bowling'], patterns: [], solidPatterns: [], hasMeasuredEvidence: false };
const plan = s.composeDeterministicPlan(h, ctx);
const routine = plan.find((w) => w.confiance === 'routine');
ok(Boolean(routine), 'les semaines sans fait daté sortent en « routine »');
ok(routine && /Aucun evenement ni conge date/.test(routine.pourquoi),
  'et le « pourquoi » le dit franchement au lieu d\'inventer un prétexte');
ok(plan.every((w) => ['mesure', 'calendrier', 'routine'].includes(w.confiance)), 'chaque semaine porte sa confiance');
ok(s.weekConfidence({ hasAnchor: true }, []) === 'calendrier', 'un fait daté porte la semaine');
ok(s.weekConfidence({ hasAnchor: false }, []) === 'routine', 'rien de daté, rien de mesuré -> routine');
ok(s.weekConfidence({ hasAnchor: false }, [{ n: 5, confidence: 'solide' }]) === 'mesure',
  'un pattern mesuré prime sur le calendrier (le mesuré est le posterior)');
ok(s.weekConfidence({ hasAnchor: false }, [{ n: 1, confidence: 'exploratoire' }]) === 'routine',
  'un pattern à n=1 exploratoire ne vaut PAS une mesure');

console.log('\n[GARDE-FOU] le modèle ne crée aucun fait');
// La leçon du 2026-07-16 : un plan a l'air autoritaire. S'il invente un
// événement, le gérant le croit et publie dessus.
const faux = [
  { index: 1, from: h[0].from, to: h[0].to, objectif: 'ok', faits: [{ label: 'Salon du jeu à Namur' }] },
  { index: 2, from: h[1].from, to: h[1].to, objectif: 'ok', faits: [{ label: 'Foire de Libramont' }] },
  { index: 3, from: '2026-01-01', to: '2026-01-07', objectif: 'ok', faits: [] },
  { index: 99, from: h[0].from, to: h[0].to, objectif: 'ok', faits: [] },
];
const v = s.verifyPlanGrounding(faux, h);
ok(v.kept.length === 1 && v.kept[0].index === 2, 'seule la semaine ancrée survit');
ok(v.rejected.some((r) => r.index === 1 && /invente/.test(r.motif)), 'événement inventé -> rejeté');
ok(v.rejected.some((r) => r.index === 3 && /dates modifiees/.test(r.motif)), 'dates réécrites -> rejeté');
ok(v.rejected.some((r) => r.index === 99 && /hors horizon/.test(r.motif)), 'semaine hors horizon -> rejetée');

// Le piège subtil : un label RÉEL mais déplacé dans la mauvaise semaine. La
// Foire existe, mais pas en semaine 5. C'est une invention quand même.
const deplace = [{ index: 5, from: h[4].from, to: h[4].to, objectif: 'ok', faits: [{ label: 'Foire de Libramont' }] }];
const vd = s.verifyPlanGrounding(deplace, h);
ok(vd.kept.length === 0 && /invente/.test((vd.rejected[0] || {}).motif || ''),
  'un fait réel déplacé dans une autre semaine est aussi une invention');

// Un plan honnête doit survivre à son propre garde-fou, sinon il est inutile.
ok(s.verifyPlanGrounding(plan, h).kept.length === plan.length,
  'le plan déterministe passe intégralement son propre garde-fou');

console.log('\n[TYPOGRAPHIE]');
const texte = plan.map((w) => `${w.objectif} ${w.pourquoi} ${w.actions.join(' ')}`).join('\n');
ok(!new RegExp('[\\u2014\\u2013]').test(texte), 'aucun tiret cadratin dans le plan déterministe');

console.log(`\nmarketing-strategist-check: ${failures ? `${failures} FAIL` : 'ALL OK'}`);
process.exit(failures ? 1 : 0);
