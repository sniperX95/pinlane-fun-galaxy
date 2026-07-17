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
ok(routine && /Aucun événement ni congé daté/.test(routine.pourquoi),
  'et le « pourquoi » le dit franchement au lieu d\'inventer un prétexte');
ok(plan.every((w) => ['mesure', 'calendrier', 'routine'].includes(w.confiance)), 'chaque semaine porte sa confiance');
ok(s.weekConfidence({ hasAnchor: true, calendarFacts: [] }, []) === 'calendrier', 'un fait daté porte la semaine');
ok(s.weekConfidence({ hasAnchor: false, calendarFacts: [] }, []) === 'routine', 'rien de daté, rien de mesuré -> routine');

// Défaut B de l'audit : un pattern ne parle QUE du contexte qu'il mesure. Sans
// scope, UN pattern qualifiant faisait passer les 8 semaines en « mesure ».
const semaineVacances = { hasAnchor: true, calendarFacts: [{ type: 'conge_scolaire', label: 'Vacances d\'été' }] };
const semaineNue = { hasAnchor: false, calendarFacts: [] };
const patternVacances = { n: 4, confidence: 'signal', trigger: 'school_holiday' };
ok(s.weekConfidence(semaineVacances, [patternVacances]) === 'mesure',
  'un pattern school_holiday rend « mesure » LA semaine qui a un congé scolaire');
ok(s.weekConfidence(semaineNue, [patternVacances]) === 'routine',
  'le MÊME pattern ne dit RIEN d\'une semaine sans congé (le scope, défaut B)');
ok(s.weekConfidence(semaineVacances, [{ n: 4, confidence: 'signal', trigger: 'local_event' }]) === 'calendrier',
  'un pattern local_event ne couvre pas une semaine sans événement local');
ok(s.weekConfidence(semaineVacances, [{ n: 9, confidence: 'solide', trigger: 'rain_forecast' }]) === 'calendrier',
  'la météo ne porte pas à 8 semaines : rain_forecast ne rend aucune semaine « mesure »');
ok(s.weekConfidence(semaineVacances, [{ n: 1, confidence: 'exploratoire', trigger: 'school_holiday' }]) === 'calendrier',
  'un pattern à n=1 exploratoire ne vaut PAS une mesure, même bien scopé');

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

console.log('\n[GARDE-FOU A] la forme que la PROD produit : faits déclarés par le modèle');
// Défaut A de l'audit : l'ancien test alimentait `faits` à la main APRÈS que le
// code l'avait écrasé, une forme que la prod ne produisait jamais. Ici, les
// semaines sont exactement ce que le schéma PLAN_SCHEMA autorise le modèle à
// rendre : c'est CE chemin qui doit rejeter.
const modelShaped = [
  { index: 1, from: h[0].from, to: h[0].to, objectif: 'ok', pourquoi: 'ok', actions: ['a'], faits: [{ label: 'Salon du jeu à Namur' }] },
  { index: 2, from: h[1].from, to: h[1].to, objectif: 'ok', pourquoi: 'ok', actions: ['a'], faits: [] },
];
const vm2 = s.verifyPlanGrounding(modelShaped, h);
ok(vm2.rejected.some((r) => r.index === 1 && /invente/.test(r.motif)),
  'un fait déclaré par le modèle et absent de l\'horizon est rejeté (branche vivante)');
ok(vm2.kept.some((w) => w.index === 2), 'une semaine à faits vides et texte propre survit');
ok(vm2.kept.every((w) => Array.isArray(w.faits) && w.faits === h[w.index - 1].calendarFacts),
  'après vérification, les faits gardés sont la version déterministe canonique');

console.log('\n[GARDE-FOU A] le texte libre est scanné (pourquoi/objectif/actions)');
// Le champ où le modèle écrit en langue naturelle est celui où une invention
// fait le plus de dégâts. Un label RÉEL de l'horizon cité dans une semaine qui
// ne le porte pas est rejeté, même si `faits` est propre.
const foireWeek = h.find((w) => w.calendarFacts.some((f) => /Foire de Libramont/.test(f.label)));
ok(Boolean(foireWeek), 'échantillon non vide : la Foire de Libramont est dans l\'horizon de test');
const sansFoire = h.find((w) => !w.calendarFacts.some((f) => /Foire de Libramont/.test(f.label)));
ok(Boolean(sansFoire), 'échantillon non vide : une semaine sans la Foire existe');
const texteDeplace = [{
  index: sansFoire.index, from: sansFoire.from, to: sansFoire.to,
  objectif: 'ok', pourquoi: 'Profitez du passage de la Foire de Libramont pour remplir la semaine.',
  actions: ['a'], faits: [],
}];
const vt = s.verifyPlanGrounding(texteDeplace, h);
ok(vt.kept.length === 0 && /deplace dans le texte/.test((vt.rejected[0] || {}).motif || ''),
  'un fait réel cité dans le TEXTE d\'une autre semaine est rejeté');
const textePropre = [{
  index: foireWeek.index, from: foireWeek.from, to: foireWeek.to,
  objectif: 'ok', pourquoi: 'La Foire de Libramont amène du monde en ville.',
  actions: ['a'], faits: [{ label: 'Foire de Libramont' }],
}];
ok(s.verifyPlanGrounding(textePropre, h).kept.length === 1,
  'le même texte dans LA semaine qui porte le fait passe');

console.log('\n[TYPOGRAPHIE]');
const texte = plan.map((w) => `${w.objectif} ${w.pourquoi} ${w.actions.join(' ')}`).join('\n');
ok(!new RegExp('[\\u2014\\u2013]').test(texte), 'aucun tiret cadratin dans le plan déterministe');
ok(texte.length > 200, 'échantillon non vide : le plan déterministe a du texte à contrôler');

console.log('\n[PROGRESSION] les étapes annoncées sont les phases réellement exécutées');
(async () => {
  const baseDeps = {
    listMarketingPatterns: async () => [],
    buildCenterFacts: () => ({ city: 'Libramont', activities: ['Bowling'] }),
  };

  // Sans clé IA : calendrier + mesures, jamais d'étape modèle (elle n'a pas lieu).
  {
    const steps = [];
    const { plan: p } = await s.generateMarketingPlan('libramont', { today: TODAY, persist: false, onStep: (l) => steps.push(l) }, { ...baseDeps, llmProvider: () => null });
    ok(p.weeks.length === 8, 'échantillon non vide : le plan sans IA a 8 semaines');
    ok(steps.length === 2, `sans IA : exactement 2 étapes réelles (obtenu ${steps.length})`);
    ok(/calendrier des 8 prochaines semaines/.test(steps[0] || ''), 'étape 1 = calendrier');
    ok(/rien d'assez solide/.test(steps[1] || ''), 'étape 2 dit honnêtement qu\'aucune mesure ne porte');
    ok(!steps.some((l) => /modele/.test(l)), 'aucune étape « modèle » n\'est inventée sans clé IA');
  }

  // Avec IA propre : rédaction + vérification, pas de rejet annoncé.
  {
    const steps = [];
    const aiWeeks = (idx) => s.buildPlanHorizon('libramont', { today: TODAY, weeks: 8 }).map((w) => ({
      index: w.index, from: w.from, to: w.to, objectif: `obj ${w.index}`, pourquoi: 'ok', actions: ['a'], faits: [],
    }));
    const { plan: p } = await s.generateMarketingPlan('libramont', { today: TODAY, persist: false, onStep: (l) => steps.push(l) }, {
      ...baseDeps,
      llmProvider: () => 'anthropic',
      callLlmJson: async () => ({ weeks: aiWeeks() }),
    });
    ok(p.mode === 'ai', 'plan en mode ai');
    ok(steps.some((l) => /rédiger le plan par le modèle/.test(l)), 'étape « je fais rédiger »');
    ok(steps.some((l) => /rien inventé/.test(l)), 'étape « je vérifie que le modèle n\'a rien inventé »');
    ok(!steps.some((l) => /rejete/.test(l)), 'aucun rejet annoncé quand rien n\'est rejeté');
  }

  // Avec IA qui triche : le rejet est annoncé comme étape réelle.
  {
    const steps = [];
    const cheating = s.buildPlanHorizon('libramont', { today: TODAY, weeks: 8 }).map((w) => ({
      index: w.index, from: w.from, to: w.to, objectif: `obj ${w.index}`, pourquoi: 'ok', actions: ['a'],
      faits: w.index === 3 ? [{ label: 'Salon inventé de toutes pièces' }] : [],
    }));
    const { plan: p } = await s.generateMarketingPlan('libramont', { today: TODAY, persist: false, onStep: (l) => steps.push(l) }, {
      ...baseDeps,
      llmProvider: () => 'anthropic',
      callLlmJson: async () => ({ weeks: cheating }),
    });
    ok(p.context.semainesRejetees === 1, `le garde-fou rejette la semaine qui invente (obtenu ${p.context.semainesRejetees})`);
    ok(steps.some((l) => /J'ai rejeté 1 semaine/.test(l)), 'le rejet est annoncé dans la progression');
    ok(p.weeks.length === 8, 'le gérant garde 8 semaines : la version calendrier remplace');
  }

  // onStep qui explose : la génération survit (la progression n'est jamais bloquante).
  {
    const { plan: p } = await s.generateMarketingPlan('libramont', { today: TODAY, persist: false, onStep: () => { throw new Error('boom'); } }, { ...baseDeps, llmProvider: () => null });
    ok(p.weeks.length === 8, 'un onStep qui jette ne casse jamais la génération');
  }

  // persist : l'enregistrement est une étape réelle.
  {
    const steps = [];
    await s.generateMarketingPlan('libramont', { today: TODAY, persist: true, onStep: (l) => steps.push(l) }, {
      ...baseDeps,
      llmProvider: () => null,
      query: async () => ({ rows: [{ id: 1 }] }),
    });
    ok(steps.some((l) => /J'enregistre le plan/.test(l)), 'l\'enregistrement est annoncé');
  }

  console.log(`\nmarketing-strategist-check: ${failures ? `${failures} FAIL` : 'ALL OK'}`);
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('FAIL ', error.message);
  process.exit(1);
});
