// LE CALENDRIER DU CENTRE : SON PAYS ET SA REGION (2026-11-17, avant-lancement D5).
//
// Les feries belges et les conges scolaires de la Federation Wallonie-Bruxelles s imposaient a tout centre : un
// centre francais voyait le 21 juillet et pas le 14, et ses horaires de vacances comme ses formules « pas en
// vacances » suivaient l ecole belge. Chaque centre choisit maintenant son calendrier (holidaySettings.calendar,
// page Etablissement, lib/booking-config listeDesCalendriers). Sans choix : la Federation, comme avant.
//
// [A] FUN GALAXY NE VOIT RIEN CHANGER. Le moteur rend, jour par jour sur quatre ans, exactement ce que rendait la
//     version d avant (recopiee ici depuis 6e0a893), sans choix, avec « BE-FR » ou avec un code inconnu ; le
//     calendrier que lit la page de reservation de Libramont aussi ; le navigateur aussi ; la configuration
//     normalisee ne gagne aucune cle.
// [B] LES FERIES de chaque calendrier, aux dates des sources officielles (citees dans lib/booking-config.js).
// [C] LES CONGES SCOLAIRES lus chez OpenHolidays (reponses reelles en fixtures) : le bon groupe, la bonne
//     subdivision, l ecole francophone en Valais, les marqueurs d un jour ecartes, deux ecoles d un canton
//     fondues en une periode.
// [D] LA RELECTURE de chaque calendrier : sa question a l API, son cache de 24 h, son repli, son delai, sans
//     jamais toucher aux conges de la Federation. L assistant et l agent des mails relisent celui d un centre
//     d ailleurs avant de juger ses jours, et ne font aucun appel de plus pour la Federation.
// [E] UN CENTRE FRANCAIS DANS LE MOTEUR : ses feries, ses conges, ses horaires de vacances, ses formules « pas en
//     vacances », le calendrier de sa page de reservation, et ce que l agent des mails en dit (des conges pas
//     encore publies ne font pas une annee sans vacances).
// [F] LE NAVIGATEUR (assets/booking-core.js) : il applique le calendrier envoye par le serveur, et jamais celui de
//     la Belgique a un autre centre, meme quand le serveur ne l a pas envoye ; ce que la page de reservation et la
//     page Etablissement recoivent.
// [G] LA CONFIGURATION ET LA CONSOLE : le code se garde a l enregistrement (et survit a un geste qui ne change
//     que « Passer tout seul aux horaires de vacances »), la page Etablissement montre le choix, l envoie, dit
//     jusqu ou les conges sont connus, et son annee montre les feries du centre.
//
// Sans reseau ni base. Les contre-preuves chargent le code mute en memoire : aucun fichier n est ecrit.
// Lancement : node scripts/feries-par-pays-check.js [--contre-preuves]

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
process.env.PINLANE_CALENDAR_SYNC = 'off';
['DATABASE_URL', 'POSTGRES_URL'].forEach((cle) => { delete process.env[cle]; });

const MUTATIONS = {
  'federation-perd-ses-conges': { f: 'lib/booking-config.js', de: '  if (!CALENDRIERS.has(code) || code === CALENDRIER_PAR_DEFAUT) return getWalloniaSchoolHoliday(dateStr);', vers: '  if (!CALENDRIERS.has(code)) return getWalloniaSchoolHoliday(dateStr);', lettre: 'A' },
  'quatorze-juillet-oublie': { f: 'lib/booking-config.js', de: "    ['07-14', 'Fête nationale'], ['08-15', 'Assomption'], ['11-01', 'Toussaint'], ['11-11', 'Armistice 1918'],", vers: "    ['08-15', 'Assomption'], ['11-01', 'Toussaint'], ['11-11', 'Armistice 1918'],", lettre: 'B' },
  'jeune-genevois-un-jour-trop-tot': { f: 'lib/booking-config.js', de: "[dimancheDuMois(an, 9, 1, 4), 'Jeûne genevois']", vers: "[dimancheDuMois(an, 9, 1, 3), 'Jeûne genevois']", lettre: 'B' },
  'neuchatel-2-janvier-toujours': { f: 'lib/booking-config.js', de: "siLundi(an, '01-02', 'Lendemain du Nouvel An')", vers: "['01-02', 'Lendemain du Nouvel An']", lettre: 'B' },
  'valais-toutes-les-ecoles': { f: 'lib/booking-config.js', de: ", commentaire: /franco/i } }],", vers: ' } }],', lettre: 'C' },
  'marqueurs-pris-pour-des-conges': { f: 'lib/booking-config.js', de: "    if (entry.type && String(entry.type) !== 'School') return;\n", vers: '', lettre: 'C' },
  'nom-de-marqueur-pris-pour-un-conge': { f: 'lib/booking-config.js', de: "    if (/^(debut|début|fin)\\b/i.test(texte.trim())) return;\n    const { label, kind } = libelleScolaire(texte);", vers: '    const { label, kind } = libelleScolaire(texte);', lettre: 'C' },
  'ecoles-pas-fondues': { f: 'lib/booking-config.js', de: '    if (derniere && periode.start <= derniere.end) {', vers: '    if (false && derniere && periode.start <= derniere.end) {', lettre: 'C' },
  'relecture-toujours-la-federation': { f: 'lib/booking-config.js', de: '  if (cle === CALENDRIER_PAR_DEFAUT) return refreshWalloniaSchoolHolidays({ fetchImpl, timeoutMs, now });', vers: '  return refreshWalloniaSchoolHolidays({ fetchImpl, timeoutMs, now });', lettre: 'D' },
  'assistant-relit-aussi-la-federation': { f: 'lib/booking-config.js', de: "  if (code === CALENDRIER_PAR_DEFAUT) return { ok: true, cached: true, count: 0, reason: 'federation' };\n", vers: '', lettre: 'D' },
  'assistant-ne-relit-pas': { f: 'lib/assistant-gestes-centre.js', de: '        await relireCalendrierHorsFederation({ holidaySettings: reglage });\n', vers: '', lettre: 'D' },
  'moteur-ignore-le-centre': { f: 'lib/booking-config.js', de: '  const calendrier = calendrierDuCentre(center);\n  const schoolHoliday', vers: '  const calendrier = CALENDRIER_PAR_DEFAUT;\n  const schoolHoliday', lettre: 'E' },
  'agent-promet-une-annee-sans-vacances': { f: 'lib/center-facts.js', de: ".pop() || (horsFederation ? depart : '');", vers: ".pop() || '';", lettre: 'E' },
  'navigateur-garde-la-belgique': { f: 'assets/booking-core.js', de: 'function getPublicHoliday(dateStr) {\n  if (!getCenterHolidayCalendarCode()) return getBelgianPublicHoliday(dateStr);', vers: 'function getPublicHoliday(dateStr) {\n  return getBelgianPublicHoliday(dateStr);', lettre: 'F' },
  'navigateur-retombe-sur-la-belgique': { f: 'assets/booking-core.js', de: "  return code && code !== 'BE-FR' ? code : '';", vers: "  return code && code !== 'BE-FR' && centerScheduleConfig?.holidayCalendar ? code : '';", lettre: 'F' },
  'page-de-reservation-sans-calendrier': { f: 'api/public-booking-meta.js', de: '  return center && calendrierDuCentre(center) !== CALENDRIER_PAR_DEFAUT ? { holidayCalendar: calendrierPourLeClient(center) } : {};', vers: '  return {};', lettre: 'F' },
  'etablissement-sans-calendrier': { f: 'lib/booking-config.js', de: '  return liste.map((centre) => (calendrierDuCentre(centre) !== CALENDRIER_PAR_DEFAUT ? { ...centre, holidayCalendar: calendrierPourLeClient(centre) } : centre));', vers: '  return liste;', lettre: 'F' },
  'calendrier-perdu-a-l-enregistrement': { f: 'lib/center-config.js', de: '    ...(calendar ? { calendar } : {}),\n', vers: '', lettre: 'G' },
  'code-inconnu-garde': { f: 'lib/booking-config.js', de: "  return CALENDRIERS.has(code) ? code : '';\n}", vers: '  return code;\n}', lettre: 'G' },
  'console-n-envoie-pas-le-choix': { f: 'assets/app-main.js', de: "      ...(document.getElementById('estab-holiday-calendar') ? { calendar: document.getElementById('estab-holiday-calendar').value } : {}),\n", vers: '', lettre: 'G' },
  'console-apercu-belge': { f: 'assets/app-main.js', de: '  const ferie = getPublicHoliday(iso);', vers: '  const ferie = getBelgianPublicHoliday(iso);', lettre: 'G' },
  'console-oublie-la-liste': { f: 'assets/app-main.js', de: '      calendriers: Array.isArray(response.calendriersDeVacances) ? response.calendriersDeVacances : []\n', vers: '      calendriers: []\n', lettre: 'G' },
  'ops-ne-branche-pas-le-calendrier': { f: 'api/ops.js', de: 'const avecCalendrier = await calendriers.centresAvecCalendrier(centers);', vers: 'const avecCalendrier = centers;', lettre: 'G' },
};
const MUTATION = (process.argv.find((a) => a.startsWith('--mutation=')) || '').slice('--mutation='.length);
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`mutation inconnue : ${MUTATION}`); process.exit(2); }

function muter(fichier, contenu) {
  const m = MUTATION ? MUTATIONS[MUTATION] : null;
  const t = String(contenu).split('\r\n').join('\n');
  if (!m || path.resolve(fichier) !== path.join(ROOT, m.f)) return t;
  if (t.split(m.de).length !== 2) throw new Error(`ANCRE DE MUTATION absente ou multiple (${MUTATION}) dans ${m.f}`);
  return t.split(m.de).join(m.vers);
}
const compiler = Module.prototype._compile;
Module.prototype._compile = function compilerMute(contenu, fichier) {
  const m = MUTATION ? MUTATIONS[MUTATION] : null;
  if (m && path.resolve(fichier) === path.join(ROOT, m.f)) return compiler.call(this, muter(fichier, contenu), fichier);
  return compiler.call(this, contenu, fichier);
};
// Les fichiers du navigateur et les cablages se lisent comme texte : la mutation s y applique de la meme facon.
const source = (relatif) => muter(path.join(ROOT, relatif), fs.readFileSync(path.join(ROOT, relatif), 'utf8'));

let rouges = 0;
let lettre = '';
function section(titre) { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); }
function ok(condition, quoi, detail) {
  if (condition) { console.log(`ok    ${quoi}`); return; }
  rouges += 1;
  console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(detail).slice(0, 400)}` : ''}`);
}

if (process.argv.includes('--contre-preuves')) {
  const temoin = spawnSync(process.execPath, [__filename], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
  if (temoin.status !== 0) { console.log(`${temoin.stdout || ''}${temoin.stderr || ''}`.split('\n').filter((l) => /ROUGE|Error/.test(l)).join('\n')); console.log('\nferies-par-pays-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte'); process.exit(1); }
  let rates = 0;
  for (const [nom, m] of Object.entries(MUTATIONS)) {
    const r = spawnSync(process.execPath, [__filename, `--mutation=${nom}`], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const mord = r.status === 1 && sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION/.test(sortie);
    if (!mord) rates += 1;
    console.log(`${mord ? 'TUEE ' : 'VIVANTE'} ${nom} (attendu : ROUGE [${m.lettre}], sortie ${r.status})${mord ? '' : `\n${sortie.split('\n').filter((l) => /ROUGE|ANCRE|Error/.test(l)).slice(0, 6).join('\n')}`}`);
  }
  console.log(rates ? `\nferies-par-pays-check --contre-preuves: ${rates} mutation(s) vivante(s)` : '\nferies-par-pays-check --contre-preuves: ALL OK - chaque regle retiree fait rougir sa lettre');
  process.exit(rates ? 1 : 0);
}

const cfg = require('../lib/booking-config');
const { normalizeCenterConfig, mergeCenterConfig } = require('../lib/center-config');
const { getCenter } = require('../lib/ops-knowledge');
const meta = require('../api/public-booking-meta.js');
const faits = require('../lib/center-facts');

// Les tirets longs, ecrits par leur code : le gate test:no-em-dash refuse le caractere lui-meme.
const TIRETS_LONGS = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
const fixture = (nom) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', nom), 'utf8'));
const AUJOURDHUI = cfg.todayStr();
const AN = Number(AUJOURDHUI.slice(0, 4)) + 1; // l an prochain : toujours devant, quel que soit le jour du gate
const LIBRAMONT = getCenter('libramont');
const avecCalendrier = (centre, code) => ({ ...centre, holidaySettings: { ...(centre.holidaySettings || {}), calendar: code } });
const FRANCAIS = { ...avecCalendrier(LIBRAMONT, 'FR-B'), id: 'bowling-lille', name: 'Bowling de Lille' };
function jours(debut, fin) {
  const out = [];
  const d = new Date(`${debut}T12:00:00Z`);
  while (d.toISOString().slice(0, 10) <= fin) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

// --- LA REFERENCE D AVANT, recopiee de lib/booking-config.js a 6e0a893 -----------------------------------------
function paquesAvant(year) {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100; const d = Math.floor(b / 4); const e = b % 4;
  const f = Math.floor((b + 8) / 25); const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
function feriesBelgesAvant(year) {
  const p = paquesAvant(year);
  const decale = (n) => { const x = new Date(p); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(5, 10); };
  return new Map([['01-01', "Jour de l'An"], [decale(1), 'Lundi de Paques'], ['05-01', 'Fete du Travail'], [decale(39), 'Ascension'], [decale(50), 'Lundi de Pentecote'], ['07-21', 'Fete nationale'], ['08-15', 'Assomption'], ['11-01', 'Toussaint'], ['11-11', 'Armistice'], ['12-25', 'Noel']].map(([j, l]) => [`${year}-${j}`, l]));
}
function contexteAvant(dateStr, center) {
  const schoolHoliday = cfg.getWalloniaSchoolHolidays().find((r) => dateStr >= r.start && dateStr <= r.end) || null;
  const publicHoliday = feriesBelgesAvant(Number(dateStr.slice(0, 4))).get(dateStr) || null;
  const autoDetected = Boolean(schoolHoliday || publicHoliday);
  const settings = center && typeof center === 'object' ? center.holidaySettings : null;
  const overrides = settings && Array.isArray(settings.overrides) ? settings.overrides : [];
  const trouve = settings && typeof settings === 'object' ? overrides.find((item) => item && item.date === dateStr && (item.mode === 'holiday' || item.mode === 'normal')) : null;
  const override = trouve ? trouve.mode : null;
  const autoApplyEnabled = !settings || settings.enabled !== false;
  const active = override === 'holiday' || (override !== 'normal' && autoApplyEnabled && autoDetected);
  let periodType = null;
  if (active) {
    if (publicHoliday) periodType = 'public';
    else if (schoolHoliday) periodType = schoolHoliday.kind === 'summer' ? 'school_summer' : 'school_short';
    else periodType = 'manual';
  }
  return { active, periodType, override, autoDetected, autoApplyEnabled, schoolHoliday, publicHoliday, label: publicHoliday || (schoolHoliday ? schoolHoliday.label : '') || (override === 'holiday' ? 'Jour special (manuel)' : '') };
}

// --- LE NAVIGATEUR : assets/booking-core.js dans un bac a sable, et des fonctions de la console ------------------
function navigateur() {
  const bac = {
    window: {}, document: { addEventListener() {}, getElementById: () => null },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout, clearTimeout, escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  };
  bac.globalThis = bac;
  vm.createContext(bac);
  vm.runInContext(source('assets/booking-core.js'), bac, { timeout: 20000 });
  return bac;
}
function fonctionDeLaConsole(texte, nom) {
  const debut = texte.search(new RegExp(`\\n(async )?function ${nom}\\(`));
  if (debut === -1) throw new Error(`fonction absente de la console : ${nom}`);
  const fin = texte.indexOf('\n}\n', debut + 1);
  return texte.slice(debut + 1, fin + 2);
}

(async () => {
  section('[A] FUN GALAXY NE VOIT RIEN CHANGER');
  {
    const variantes = {
      'sans centre': null,
      'Libramont tel quel': LIBRAMONT,
      'reglage sans calendrier': { holidaySettings: { enabled: true, overrides: [{ date: '2026-12-24', mode: 'holiday' }, { date: '2027-07-21', mode: 'normal' }], formulaBlockedPeriods: ['public'] } },
      'calendrier BE-FR ecrit': avecCalendrier(LIBRAMONT, 'BE-FR'),
      'calendrier inconnu': avecCalendrier(LIBRAMONT, 'XX-ZZ'),
      'centre en pause des vacances': { holidaySettings: { enabled: false, calendar: 'be-fr' } },
    };
    const dates = jours('2025-01-01', '2028-12-31');
    for (const [nom, centre] of Object.entries(variantes)) {
      const ecarts = dates.filter((d) => JSON.stringify(cfg.getHolidayContext(d, centre)) !== JSON.stringify(contexteAvant(d, centre)));
      ok(ecarts.length === 0, `le moteur rend la meme chose qu avant, jour par jour sur quatre ans (${nom}, ${dates.length} jours)`, ecarts.slice(0, 3).map((d) => `${d} ${JSON.stringify(cfg.getHolidayContext(d, centre))} au lieu de ${JSON.stringify(contexteAvant(d, centre))}`).join(' | '));
    }
    ok(dates.filter((d) => cfg.isFormulaBlockedDate(d, LIBRAMONT) !== Boolean(contexteAvant(d, LIBRAMONT).active && ['public', 'school_short', 'manual'].includes(contexteAvant(d, LIBRAMONT).periodType))).length === 0, 'les formules « pas en vacances » de Libramont sont bloquees les memes jours qu avant');
    const page = meta.__test.buildCalendar([], 400, LIBRAMONT, 'libramont');
    const ecartsPage = page.filter((j) => { const c = contexteAvant(j.date, LIBRAMONT); return JSON.stringify(j.holiday) !== JSON.stringify(c.active ? { type: c.periodType, label: c.label } : null); });
    ok(page.length === 400 && ecartsPage.length === 0, 'la page de reservation de Libramont lit les memes periodes qu avant, sur 400 jours', ecartsPage.slice(0, 3).map((j) => `${j.date} ${JSON.stringify(j.holiday)}`).join(' | '));
    ok(JSON.stringify(meta.__test.calendrierPourLaPage(LIBRAMONT)) === '{}', 'la page de reservation de Libramont ne recoit aucune cle de plus');
    const n1 = normalizeCenterConfig({}, 'bowling-test').holidaySettings;
    const n2 = normalizeCenterConfig({ holidaySettings: { enabled: false, overrides: [], formulaBlockedPeriods: ['public'] } }, 'bowling-test').holidaySettings;
    ok(JSON.stringify(n1) === JSON.stringify({ enabled: true, overrides: [], formulaBlockedPeriods: ['public', 'school_short', 'manual'] }) && Object.keys(n2).join(',') === 'enabled,overrides,formulaBlockedPeriods', 'une configuration sans calendrier se normalise comme avant, sans cle de plus', `${JSON.stringify(n1)} ${JSON.stringify(n2)}`);
    const nav = navigateur();
    const navAvant = (date) => {
      const ecole = nav.getWalloniaSchoolHoliday(date);
      const ferie = nav.getBelgianPublicHoliday(date);
      return JSON.stringify([Boolean(ecole || ferie), ferie, ecole && ecole.start]);
    };
    for (const [nom, config] of [['sans configuration', null], ['configuration de Libramont', { holidaySettings: LIBRAMONT.holidaySettings }], ['calendrier BE-FR ecrit', { holidaySettings: { enabled: true, calendar: 'BE-FR' } }]]) {
      nav.setCenterScheduleConfig(config);
      const ecarts = jours('2025-09-01', '2027-12-31').filter((d) => { const c = nav.getSpecialOpeningContext(d); return JSON.stringify([c.autoDetected, c.publicHoliday, c.schoolHoliday && c.schoolHoliday.start]) !== navAvant(d); });
      ok(ecarts.length === 0, `le navigateur lit les memes feries et conges qu avant (${nom})`, ecarts.slice(0, 3).join(', '));
    }
  }

  section('[B] LES FERIES DE CHAQUE CALENDRIER');
  {
    const attendus = [
      ['FR-B', '2027-07-14', 'Fête nationale'], ['FR-B', '2027-07-21', null], ['FR-B', '2027-05-08', 'Victoire 1945'], ['FR-A', '2027-11-11', 'Armistice 1918'],
      ['FR-C', '2030-04-22', 'Lundi de Pâques'], ['FR-B', '2027-03-26', null], ['FR-B-AM', '2027-03-26', 'Vendredi saint'], ['FR-B-AM', '2027-12-26', 'Saint-Étienne'], ['FR-B', '2027-12-26', null],
      ['LU', '2027-06-23', 'Fête nationale'], ['LU', '2027-05-09', 'Journée de l’Europe'], ['LU', '2027-12-26', 'Saint-Étienne'], ['LU', '2027-07-21', null],
      ['BE-NL', '2027-07-21', 'Fete nationale'], ['BE-DE', '2027-11-11', 'Armistice'],
      ['CH-GE', '2027-09-09', 'Jeûne genevois'], ['CH-GE', '2026-09-10', 'Jeûne genevois'], ['CH-GE', '2027-12-31', 'Restauration de la République'], ['CH-GE', '2027-08-01', 'Fête nationale'], ['CH-GE', '2027-05-01', null],
      ['CH-VD', '2026-09-21', 'Lundi du Jeûne fédéral'], ['CH-VD', '2028-09-18', 'Lundi du Jeûne fédéral'], ['CH-VD', '2027-01-02', '2 janvier'], ['CH-VD', '2027-12-31', null],
      ['CH-NE', '2023-01-02', 'Lendemain du Nouvel An'], ['CH-NE', '2027-01-02', null], ['CH-NE', '2022-12-26', 'Lendemain de Noël'], ['CH-NE', '2027-12-26', null], ['CH-NE', '2027-03-01', 'Instauration de la République'], ['CH-NE', '2027-03-29', null],
      ['CH-JU', '2027-06-23', 'Commémoration du plébiscite'], ['CH-JU', '2027-05-27', 'Fête-Dieu'], ['CH-JU', '2027-01-02', '2 janvier'],
      ['CH-VS', '2027-03-19', 'Saint-Joseph'], ['CH-VS', '2027-03-29', null], ['CH-VS', '2027-12-08', 'Immaculée Conception'],
      ['CH-FR-C', '2027-12-08', 'Immaculée Conception'], ['CH-FR-R', '2027-12-08', null], ['CH-FR-R', '2027-12-26', 'Saint-Étienne'], ['CH-FR-C', '2027-12-26', null],
    ];
    const rates = attendus.filter(([code, date, label]) => cfg.getPublicHolidayFor(code, date) !== label);
    ok(rates.length === 0, `${attendus.length} dates de sources officielles, chacune dans son calendrier`, rates.map(([c, d, l]) => `${c} ${d} : ${cfg.getPublicHolidayFor(c, d)} au lieu de ${l}`).join(' | '));
    const liste = cfg.listeDesCalendriers();
    ok(liste.length >= 15 && ['BE-FR', 'BE-NL', 'BE-DE', 'FR-A', 'FR-B', 'FR-C', 'LU', 'CH-GE', 'CH-VD', 'CH-VS', 'CH-NE', 'CH-JU'].every((code) => liste.some((c) => c.code === code)), 'la liste proposee couvre la Belgique (trois communautes), la France (zones A, B, C), le Luxembourg et les cantons romands', liste.map((c) => c.code).join(', '));
    const suisses = liste.filter((c) => c.code.startsWith('CH-'));
    ok(suisses.every((c) => [2027, 2028, 2029].every((an) => cfg.getPublicHolidayFor(c.code, `${an}-08-01`) === 'Fête nationale' && cfg.getPublicHolidayFor(c.code, `${an}-12-25`) === 'Noël')), 'chaque canton a le 1er aout (seul ferie federal) et Noel, chaque annee');
    const tirets = liste.filter((c) => TIRETS_LONGS.test(c.libelle) || Object.values(cfg.calendrierPourLeClient({ holidaySettings: { calendar: c.code } }, { depuis: '2027-01-01', jours: 365 }).feries).some((l) => TIRETS_LONGS.test(l)));
    ok(tirets.length === 0, 'aucun libelle ne porte de tiret long');
  }

  section('[C] LES CONGES SCOLAIRES LUS (reponses reelles d OpenHolidays)');
  {
    const fr = cfg.periodesScolairesDe(fixture('openholidays-fr-zb-school-2026.json'), 'FR-B');
    const trouve = (liste, debut, fin) => liste.find((p) => p.start === debut && p.end === fin);
    ok(Boolean(trouve(fr, '2027-04-18', '2027-05-02')) && trouve(fr, '2027-04-18', '2027-05-02').kind === 'short' && Boolean(trouve(fr, '2026-07-05', '2026-08-31')) && trouve(fr, '2026-07-05', '2026-08-31').kind === 'summer', 'France zone B : printemps 2027 en petit conge, ete 2026 en grandes vacances', JSON.stringify(fr.slice(-4)));
    ok(!fr.some((p) => p.start === '2027-07-03' && p.end === '2027-07-03'), 'le marqueur « Fin des cours » n est pas une periode');
    const vs = cfg.periodesScolairesDe(fixture('openholidays-ch-vs-school-2026.json'), 'CH-VS');
    ok(Boolean(trouve(vs, '2026-10-15', '2026-10-25')) && !vs.some((p) => p.start === '2026-10-10') && Boolean(trouve(vs, '2026-12-24', '2027-01-10')), 'Valais romand : les periodes de l ecole francophone, pas celles du Haut-Valais', JSON.stringify(vs.map((p) => `${p.start}>${p.end}`)));
    const fri = cfg.periodesScolairesDe(fixture('openholidays-ch-fr-school-2026.json'), 'CH-FR-C');
    const etes = fri.filter((p) => p.start >= '2026-06-01' && p.start <= '2026-08-31');
    ok(etes.length === 1 && etes[0].start === '2026-07-04' && etes[0].end === '2026-08-26' && etes[0].kind === 'summer', 'Fribourg : deux ecoles qui se chevauchent l ete font une seule periode', JSON.stringify(etes));
    ok(fri.some((p) => p.label === 'Vacances de sport') && fri.some((p) => p.label === 'Vacances d’été'), 'les noms courts des cantons (« Sport », « Été ») deviennent une phrase', fri.map((p) => p.label).join(', '));
    const lu = cfg.periodesScolairesDe(fixture('openholidays-lu-school-2026.json'), 'LU');
    ok(Boolean(trouve(lu, '2027-07-16', '2027-09-14')) && trouve(lu, '2027-07-16', '2027-09-14').kind === 'summer' && Boolean(trouve(lu, '2027-05-29', '2027-06-06')), 'Luxembourg : les conges du pays entier, ete jusqu a la mi-septembre');
    const be = fixture('openholidays-be-school-2025-2027.json');
    const nl = cfg.periodesScolairesDe(be, 'BE-NL');
    const de = cfg.periodesScolairesDe(be, 'BE-DE');
    ok(Boolean(trouve(nl, '2026-11-02', '2026-11-08')) && !nl.some((p) => p.start === '2026-10-19'), 'Communaute flamande : son conge d automne, pas celui de la Federation');
    ok(Boolean(trouve(de, '2025-11-15', '2025-11-15')) && !de.some((p) => p.start === '2026-10-19'), 'Communaute germanophone : son jour de fete (un seul jour) compte, la Federation n entre pas');
    ok(JSON.stringify(cfg.parseOpenHolidaysSchoolEntries(fixture('openholidays-be-school-2026.json')).map((p) => p.start)) === JSON.stringify(['2026-07-04', '2026-10-19', '2026-12-21', '2027-02-22', '2027-04-26']), 'la lecture de la Federation reste celle d avant');
    // Les deux gardes des marqueurs, chacune seule : un jour d un autre type qu un conge, quel que soit son nom ; un
    // nom de marqueur (la forme reelle du groupe de la Federation, posee dans un autre calendrier).
    const autreType = { startDate: '2027-06-30', endDate: '2027-06-30', type: 'EndOfLessons', name: [{ language: 'FR', text: 'Dernier jour de classe' }], nationwide: true };
    ok(cfg.periodesScolairesDe([autreType], 'LU').length === 0, 'un jour d un autre type qu un conge n est pas une periode, quel que soit son nom');
    const debutReel = be.find((e) => /^D[ée]but/.test(String(((e.name || [])[0] || {}).text || '')));
    const debutAilleurs = debutReel ? { ...debutReel, groups: [{ code: 'BE-NL' }] } : null;
    ok(Boolean(debutAilleurs) && cfg.periodesScolairesDe([debutAilleurs], 'BE-NL').length === 0, 'un marqueur « Debut des vacances » n est pas une periode', JSON.stringify(debutAilleurs));
  }

  section('[D] LA RELECTURE DE CHAQUE CALENDRIER');
  {
    delete process.env.PINLANE_CALENDAR_SYNC;
    const avantFederation = JSON.stringify(cfg.getWalloniaSchoolHolidays());
    const urls = [];
    const repond = (donnees) => async (url) => { urls.push(String(url)); return { ok: true, status: 200, json: async () => donnees }; };
    const r1 = await cfg.refreshSchoolHolidays('FR-B', { fetchImpl: repond(fixture('openholidays-fr-zb-school-2026.json')), now: 5000 });
    ok(r1.ok && !r1.cached && r1.count > 5, 'une lecture reussie garde les periodes du calendrier', JSON.stringify(r1));
    ok(/countryIsoCode=FR/.test(urls[0] || '') && /subdivisionCode=FR-ZB/.test(urls[0] || ''), 'la question posee est celle de la zone B', urls[0]);
    ok(Boolean(cfg.getSchoolHolidayFor('FR-B', '2027-04-20')) && cfg.etatDuCalendrier('FR-B').connuJusquau === '2027-05-09', 'la date lue est connue, et le calendrier sait jusqu ou', JSON.stringify(cfg.etatDuCalendrier('FR-B')));
    ok(JSON.stringify(cfg.getWalloniaSchoolHolidays()) === avantFederation && !cfg.getSchoolHolidayFor('BE-FR', '2027-04-20'), 'les conges de la Federation n ont pas bouge');
    const r2 = await cfg.refreshSchoolHolidays('FR-B', { fetchImpl: async () => { throw new Error('ne doit pas etre appele'); }, now: 5000 + 3600 * 1000 });
    ok(r2.ok && r2.cached, 'dans les 24 h, aucun nouvel appel', JSON.stringify(r2));
    const r3 = await cfg.refreshSchoolHolidays('FR-B', { fetchImpl: async () => { throw new Error('panne'); }, now: 5000 + 25 * 3600 * 1000 });
    ok(!r3.ok && r3.reason === 'panne' && Boolean(cfg.getSchoolHolidayFor('FR-B', '2027-04-20')), 'une panne ne retire rien', JSON.stringify(r3));
    const r4 = await cfg.refreshSchoolHolidays('FR-B', { fetchImpl: async () => ({ ok: false, status: 503, json: async () => [] }), now: 5000 + 27 * 3600 * 1000 });
    ok(!r4.ok && /HTTP 503/.test(r4.reason), 'un statut d erreur est un echec nomme', JSON.stringify(r4));
    const trace = { abandonne: false };
    const lent = (url, options) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ ok: true, status: 200, json: async () => [] }), 400);
      if (options && options.signal) options.signal.addEventListener('abort', () => { clearTimeout(timer); trace.abandonne = true; reject(new Error('abandonne')); });
    });
    const r5 = await cfg.refreshSchoolHolidays('CH-GE', { fetchImpl: lent, timeoutMs: 60, now: 9000 });
    ok(!r5.ok && trace.abandonne, 'un site trop lent est abandonne au delai borne', JSON.stringify(r5));
    urls.length = 0;
    const r6 = await cfg.refreshSchoolHolidaysFor(avecCalendrier(LIBRAMONT, 'CH-VS'), { fetchImpl: repond(fixture('openholidays-ch-vs-school-2026.json')), now: 9000 });
    ok(r6.ok && /countryIsoCode=CH/.test(urls[0] || '') && /subdivisionCode=CH-VS/.test(urls[0] || ''), 'le calendrier relu est celui DU centre', urls[0]);
    urls.length = 0;
    await cfg.refreshSchoolHolidaysFor(LIBRAMONT, { fetchImpl: repond([]), now: 9000 });
    ok(/countryIsoCode=BE/.test(urls[0] || '') && !/subdivisionCode/.test(urls[0] || ''), 'un centre sans choix relit la Federation, par sa fonction d avant', urls[0]);
    urls.length = 0;
    const r8 = await cfg.relireCalendrierHorsFederation(LIBRAMONT, { fetchImpl: repond([]), now: 20000 });
    ok(urls.length === 0 && r8.reason === 'federation', 'l assistant et l agent des mails ne font aucun appel de plus pour un centre de la Federation', JSON.stringify(r8));
    const r9 = await cfg.relireCalendrierHorsFederation(avecCalendrier(LIBRAMONT, 'LU'), { fetchImpl: repond(fixture('openholidays-lu-school-2026.json')), now: 20000 });
    ok(r9.ok && /countryIsoCode=LU/.test(urls[0] || '') && Boolean(cfg.getSchoolHolidayFor('LU', '2027-02-10')), 'pour un centre d ailleurs, ils relisent son calendrier avant de juger ses jours', urls[0]);
    const relecteurs = { 'lib/email-agent.js': 1, 'lib/assistant-gestes-centre.js': 2 };
    const absents = Object.entries(relecteurs).filter(([f, n]) => (source(f).match(/relireCalendrierHorsFederation\(/g) || []).length < n);
    ok(absents.length === 0, 'l agent des mails et les deux gestes de l assistant qui jugent des jours de vacances relisent le calendrier', absents.map(([f]) => f).join(', '));
    process.env.PINLANE_CALENDAR_SYNC = 'off';
    const r7 = await cfg.refreshSchoolHolidays('LU', { fetchImpl: async () => { throw new Error('ne doit pas etre appele'); }, now: 9000 });
    ok(!r7.ok && r7.reason === 'desactive', 'PINLANE_CALENDAR_SYNC=off coupe tout appel', JSON.stringify(r7));
    cfg.__setWalloniaFetchedForTests([]);
    ['FR-B', 'CH-VS', 'CH-GE', 'LU'].forEach((code) => cfg.__setSchoolHolidaysForTests(code, []));
  }

  section('[E] UN CENTRE FRANCAIS DANS LE MOTEUR');
  {
    const printemps = { start: `${AN}-04-18`, end: `${AN}-05-02`, label: 'Vacances de printemps', kind: 'short' };
    cfg.__setSchoolHolidaysForTests('FR-B', [printemps, { start: `${AN}-07-04`, end: `${AN}-08-31`, label: 'Vacances d’été', kind: 'summer' }]);
    const c14 = cfg.getHolidayContext(`${AN}-07-14`, FRANCAIS);
    ok(c14.active && c14.periodType === 'public' && c14.label === 'Fête nationale', 'le 14 juillet est son ferie', JSON.stringify(c14));
    ok(!cfg.getHolidayContext(`${AN}-07-21`, FRANCAIS).active || cfg.getHolidayContext(`${AN}-07-21`, FRANCAIS).periodType !== 'public', 'le 21 juillet n est pas son ferie', JSON.stringify(cfg.getHolidayContext(`${AN}-07-21`, FRANCAIS)));
    const mardi = `${AN}-04-20`;
    ok(cfg.getHolidayContext(mardi, FRANCAIS).periodType === 'school_short', 'ses conges de printemps sont des petits conges', JSON.stringify(cfg.getHolidayContext(mardi, FRANCAIS)));
    ok(cfg.isFormulaBlockedDate(mardi, FRANCAIS) === true && cfg.isFormulaBlockedDate(`${AN}-07-21`, FRANCAIS) === false, 'ses formules « pas en vacances » suivent son calendrier : bloquees a son printemps, libres le 21 juillet');
    const jourDeSemaine = String(new Date(`${mardi}T12:00:00Z`).getUTCDay());
    const horaires = { regular: { [jourDeSemaine]: null }, holiday: { [jourDeSemaine]: { open: '10:00', close: '22:00' } } };
    const ouvert = cfg.getSchedule(mardi, { ...FRANCAIS, defaultSchedule: horaires });
    const fermeAilleurs = cfg.getSchedule(mardi, { ...LIBRAMONT, defaultSchedule: horaires });
    ok(Boolean(ouvert) && ouvert.open === 10 && (fermeAilleurs === null || cfg.getHolidayContext(mardi, LIBRAMONT).active), 'ses horaires de vacances s appliquent pendant SES conges', `${JSON.stringify(ouvert)} / ${JSON.stringify(fermeAilleurs)}`);
    const page = meta.__test.buildCalendar([], 31, FRANCAIS, 'bowling-lille', `${AN}-07-01`);
    const jour = (d) => page.find((j) => j.date === d) || {};
    ok(JSON.stringify(jour(`${AN}-07-14`).holiday) === JSON.stringify({ type: 'public', label: 'Fête nationale' }) && (jour(`${AN}-07-21`).holiday || {}).type !== 'public', 'sa page de reservation marque le 14 juillet, pas le 21', `${JSON.stringify(jour(`${AN}-07-14`).holiday)} ${JSON.stringify(jour(`${AN}-07-21`).holiday)}`);
    const lu = faits.periodesSpeciales(FRANCAIS, `${AN}-01-01`, 365);
    ok(lu && lu.periodes.some((p) => p.debut === `${AN}-07-14` && p.type === 'public') && !lu.periodes.some((p) => p.debut === `${AN}-07-21` && p.type === 'public') && lu.finDuCalendrier === `${AN}-08-31`, 'l agent des mails lit ses periodes, et sait jusqu ou ses conges sont connus', lu && `${lu.finDuCalendrier} ${lu.periodes.slice(0, 4).map((p) => p.debut + ' ' + p.libelle).join(', ')}`);
    cfg.__setSchoolHolidaysForTests('FR-B', []);
    const rien = faits.periodesSpeciales(FRANCAIS, `${AN}-01-01`, 365);
    ok(rien && rien.finDuCalendrier === `${AN}-01-01`, 'sans conges publies, l agent sait qu ils ne sont pas connus (pas une annee sans vacances)', rien && rien.finDuCalendrier);
    ok(faits.periodesSpeciales(LIBRAMONT, AUJOURDHUI, 365).finDuCalendrier === cfg.walloniaSchoolHolidayCoverage(), 'pour Libramont, la fin du calendrier reste celle de la table de la Federation');
  }

  section('[F] LE NAVIGATEUR');
  {
    cfg.__setSchoolHolidaysForTests('FR-B', [{ start: `${AN}-04-18`, end: `${AN}-05-02`, label: 'Vacances de printemps', kind: 'short' }]);
    const envoye = cfg.calendrierPourLeClient(FRANCAIS, { depuis: `${AN}-01-01`, jours: 364 });
    ok(envoye.code === 'FR-B' && envoye.feries[`${AN}-07-14`] === 'Fête nationale' && !envoye.feries[`${AN}-07-21`] && envoye.conges.length === 1 && envoye.connuJusquau === `${AN}-05-02`, 'le serveur envoie ses feries, ses conges et jusqu ou ils sont connus', JSON.stringify(envoye).slice(0, 300));
    const nav = navigateur();
    nav.setCenterScheduleConfig({ holidaySettings: { enabled: true, calendar: 'FR-B' }, holidayCalendar: envoye });
    const n14 = nav.getSpecialOpeningContext(`${AN}-07-14`);
    ok(n14.active && n14.periodType === 'public' && n14.label === 'Fête nationale' && !nav.getSpecialOpeningContext(`${AN}-07-21`).active, 'le navigateur applique son calendrier : le 14 juillet, pas le 21', JSON.stringify(n14));
    ok(nav.getSpecialOpeningContext(`${AN}-04-20`).periodType === 'school_short' && nav.isFormulaBlockedDate(`${AN}-04-20`) === true, 'ses conges et ses formules bloquees aussi');
    nav.setCenterScheduleConfig({ holidaySettings: { enabled: true, calendar: 'FR-B' } });
    ok(!nav.getSpecialOpeningContext(`${AN}-07-21`).active && !nav.getSpecialOpeningContext(`${AN}-10-26`).active, 'sans le calendrier du serveur, le navigateur n applique PAS la Belgique a ce centre');
    nav.setCenterScheduleConfig({ holidaySettings: { enabled: true, calendar: 'FR-B' }, holidayCalendar: { ...envoye, code: 'LU' } });
    ok(!nav.getSpecialOpeningContext(`${AN}-07-14`).active, 'un calendrier envoye pour un autre code est ignore');
    nav.setCenterScheduleConfig({ holidaySettings: { enabled: true } });
    ok(nav.getSpecialOpeningContext(`${AN}-07-21`).active, 'un centre sans choix garde la Belgique dans le navigateur');
    const pageFr = meta.__test.calendrierPourLaPage(FRANCAIS);
    ok(pageFr.holidayCalendar && pageFr.holidayCalendar.code === 'FR-B' && Object.values(pageFr.holidayCalendar.feries).includes('Fête nationale'), 'sa page de reservation recoit son calendrier', JSON.stringify(Object.keys(pageFr)));
    const centres = await cfg.centresAvecCalendrier([LIBRAMONT, FRANCAIS]);
    ok(centres[0] === LIBRAMONT && !('holidayCalendar' in centres[0]) && centres[1].holidayCalendar && centres[1].holidayCalendar.code === 'FR-B', 'la page Etablissement : Libramont part tel quel, le centre francais avec son calendrier');
    cfg.__setSchoolHolidaysForTests('FR-B', []);
  }

  section('[G] LA CONFIGURATION ET LA CONSOLE');
  {
    const n = (calendar) => normalizeCenterConfig({ holidaySettings: { enabled: true, calendar } }, 'bowling-test').holidaySettings;
    ok(n('fr-b').calendar === 'FR-B' && n('CH-VS').calendar === 'CH-VS', 'un code connu se garde (majuscules)', JSON.stringify(n('fr-b')));
    ok(!('calendar' in n('XX-ZZ')) && !('calendar' in n(42)) && !('calendar' in n('')), 'un code inconnu ne se garde pas (Federation)', JSON.stringify(n('XX-ZZ')));
    const stocke = normalizeCenterConfig({ holidaySettings: { enabled: true, calendar: 'CH-GE', overrides: [] } }, 'bowling-test');
    const apresGeste = normalizeCenterConfig(mergeCenterConfig(stocke, { holidaySettings: { enabled: false } }), 'bowling-test').holidaySettings;
    ok(apresGeste.calendar === 'CH-GE' && apresGeste.enabled === false, 'un geste qui ne change que « Passer tout seul aux horaires de vacances » garde le calendrier', JSON.stringify(apresGeste));
    const ops = source('api/ops.js');
    const bloc = ops.slice(ops.indexOf("if (action === 'centerConfig') {"), ops.indexOf("if (action === 'surMesureCatalogue') {"));
    ok(/const avecCalendrier = await calendriers\.centresAvecCalendrier\(centers\);/.test(bloc) && /avecMiseEnRoute\(avecCalendrier\)/.test(bloc) && /calendriersDeVacances: calendriers\.listeDesCalendriers\(\)/.test(bloc), 'la lecture de la page Etablissement envoie le calendrier des centres et la liste proposee');
    const app = source('assets/app-main.js');
    const nav = navigateur();
    ['ebE', 'ebR', 'ebIso', 'ebLibelleCalendrier', 'ebAideCalendrier', 'ebChoixCalendrierHtml', 'ebApresMinuit', 'ebLendemain', 'ebFermeDit', 'ebStatutDuJour', 'loadStaffCenterConfig'].forEach((nom) => vm.runInContext(fonctionDeLaConsole(app, nom), nav));
    vm.runInContext('var establishmentHolidayOverridesDraft = []; function getAvailabilityBlocksForDate() { return []; } var state = { view: "autre" }; var staffCenterConfigCache = { loaded: false, loading: false, error: "", centers: [], activities: [] }; var API_ENDPOINTS = { ops: "/api/ops" }; function canUseStaffPermission() { return true; } function getCurrentStaffCenterId() { return "bowling-lille"; }', nav);
    const liste = cfg.listeDesCalendriers();
    nav.__reponse = { ok: true, centers: [{ ...FRANCAIS, holidayCalendar: cfg.calendrierPourLeClient(FRANCAIS) }], activities: [], calendriersDeVacances: liste };
    vm.runInContext('function apiRequest() { return Promise.resolve(__reponse); }', nav);
    await vm.runInContext('loadStaffCenterConfig(true)', nav);
    const cache = vm.runInContext('staffCenterConfigCache', nav);
    ok(Array.isArray(cache.calendriers) && cache.calendriers.length === liste.length, 'la console garde la liste des calendriers recue du serveur', JSON.stringify(cache.calendriers && cache.calendriers.length));
    const pousse = nav.getCenterHolidayCalendar();
    ok(Boolean(pousse) && pousse.code === 'FR-B' && JSON.stringify(pousse.feries) === JSON.stringify(nav.__reponse.centers[0].holidayCalendar.feries), 'la console pousse le centre et son calendrier dans le navigateur', JSON.stringify(pousse && pousse.code));
    const c = (code, etat) => ({ calendrier: code, calendriers: liste, etatCalendrier: etat });
    nav.__c = c('FR-B', { code: 'FR-B', connuJusquau: `${AN}-05-02` });
    const html = vm.runInContext('ebChoixCalendrierHtml(__c)', nav);
    ok(/<select id="estab-holiday-calendar"/.test(html) && /<optgroup label="France">/.test(html) && /<optgroup label="Suisse">/.test(html) && /<option value="FR-B" selected>France, zone B<\/option>/.test(html) && (html.match(/ selected>/g) || []).length === 1, 'la page Etablissement montre le choix, groupe par pays, avec le calendrier du centre choisi', html.slice(0, 300));
    ok(new RegExp(`publiés jusqu’au 2 mai ${AN}`).test(html), 'elle dit jusqu ou les conges sont connus', html.match(/<small>.*?<\/small>/) && html.match(/<small>.*?<\/small>/)[0]);
    nav.__c = c('CH-VD', { code: 'CH-VD', connuJusquau: '' });
    ok(/ne sont pas encore publiés/.test(vm.runInContext('ebAideCalendrier(__c)', nav)), 'des conges inconnus se disent inconnus');
    nav.__c = c('CH-VD', { code: 'CH-VD', connuJusquau: '2020-08-31' });
    ok(/ne sont pas encore publiés/.test(vm.runInContext('ebAideCalendrier(__c)', nav)), 'des conges publies pour une annee finie ne comptent pas');
    nav.__c = c('BE-FR', null);
    ok(/<option value="BE-FR" selected>Belgique, Fédération Wallonie-Bruxelles<\/option>/.test(vm.runInContext('ebChoixCalendrierHtml(__c)', nav)), 'un centre sans choix voit la Federation choisie');
    nav.setCenterScheduleConfig({ holidaySettings: { enabled: true, calendar: 'FR-B' }, holidayCalendar: cfg.calendrierPourLeClient(FRANCAIS, { depuis: `${AN}-01-01`, jours: 364 }) });
    const vu14 = vm.runInContext(`ebStatutDuJour('${AN}-07-14')`, nav);
    const vu21 = vm.runInContext(`ebStatutDuJour('${AN}-07-21')`, nav);
    ok(vu14.ferie === 'Fête nationale' && vu14.vacances === true && !vu21.ferie, 'l annee de la page montre les feries DU centre (le 14 juillet, pas le 21)', `${JSON.stringify(vu14.ferie)} ${JSON.stringify(vu21.ferie)}`);
    nav.setCenterScheduleConfig({ holidaySettings: { enabled: true } });
    ok(vm.runInContext(`ebStatutDuJour('${AN}-07-21')`, nav).ferie === 'Fête nationale', 'et pour un centre de la Federation, le 21 juillet comme avant');
    const debut = app.indexOf("    holidaySettings: {\n      enabled: !!document.getElementById('estab-holiday-enabled')?.checked,");
    const fin = app.indexOf('\n    },', debut);
    ok(debut > 0 && fin > debut, 'MONTAGE : le bloc des vacances de l enregistrement est trouve');
    const enregistre = (avecSelect) => {
      const bac = { establishmentHolidayOverridesDraft: [], formulaBlockedPeriods: ['public'], document: { getElementById: (id) => (id === 'estab-holiday-calendar' ? (avecSelect ? { value: 'FR-B' } : null) : (id === 'estab-holiday-enabled' ? { checked: true } : null)) } };
      vm.createContext(bac);
      return vm.runInContext(`({${app.slice(debut, fin + 6)}})`, bac).holidaySettings;
    };
    ok(enregistre(true).calendar === 'FR-B' && !('calendar' in enregistre(false)), 'Enregistrer envoie le calendrier choisi, et rien quand la page ne l a pas montre', `${JSON.stringify(enregistre(true))} ${JSON.stringify(enregistre(false))}`);
  }

  console.log(`\nferies-par-pays-check: ${rouges ? `${rouges} ROUGE(S)` : 'ALL OK'}`);
  process.exit(rouges ? 1 : 0);
})().catch((error) => { console.error(error && error.stack || error); process.exit(1); });
