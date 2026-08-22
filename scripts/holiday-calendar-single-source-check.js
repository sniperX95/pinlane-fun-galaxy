// LE GATE DU CALENDRIER SCOLAIRE (2026-08-22).
//
// CE QUI A ETE MESURE le 2026-08-22 : DEUX tables de conges scolaires FWB
// vivaient cote a cote et se contredisaient sur CHAQUE periode.
//
//   periode          lib/booking-config.js     lib/center-metrics.js
//   automne 2026     19/10 -> 01/11            19/10 -> 30/10
//   hiver 26-27      21/12 -> 03/01            21/12 -> 01/01
//   detente 2027     22/02 -> 07/03            22/02 -> 05/03
//   printemps 2027   26/04 -> 09/05            26/04 -> 07/05
//   ete 2026         04/07 -> 23/08            03/07 -> 23/08
//
// La premiere decide des HORAIRES DE VACANCES et du blocage des formules
// « noHolidays » dans le tunnel de reservation. La seconde alimente les
// metriques et l agent marketing. Un jour pouvait donc etre « en vacances »
// pour la campagne du matin et « hors vacances » pour le moteur de reservation
// du meme apres-midi, precisement sur les jours de bord, ceux ou le trafic
// bascule. Un fait chiffre n a qu UNE source d autorite.
//
// CE QUE CE GATE VERROUILLE : les deux tables decrivent exactement les memes
// intervalles. Contre-epreuve par mutation de la source : on redonne a
// center-metrics une table a lui et on exige que la divergence soit vue.
//
// Sortie 0 quand tout est vert. Sortie 1 sinon.
// Lancement : node scripts/holiday-calendar-single-source-check.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const METRICS = path.join(ROOT, 'lib', 'center-metrics.js');
const BOOKING = path.join(ROOT, 'lib', 'booking-config.js');

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`);
}
function section(title) { console.log(`\n${title}`); }

function freshRequire(file) {
  delete require.cache[require.resolve(file)];
  return require(file);
}
function loadTables() {
  delete require.cache[require.resolve(BOOKING)];
  delete require.cache[require.resolve(METRICS)];
  const booking = require(BOOKING);
  const metrics = require(METRICS);
  return {
    reference: (booking.WALLONIA_SCHOOL_HOLIDAYS || []).map(p => `${p.start}..${p.end}`),
    derived: (metrics.SCHOOL_HOLIDAYS_FWB || []).map(p => `${p.from}..${p.to}`),
    metricsRaw: metrics.SCHOOL_HOLIDAYS_FWB || [],
  };
}

let failed = 0;
const metricsOriginal = fs.readFileSync(METRICS, 'utf8');

try {
  section('[1] Les deux calendriers decrivent les MEMES intervalles');
  const { reference, derived, metricsRaw } = loadTables();

  record('booking-config expose sa table de conges', reference.length > 0, `${reference.length} periode(s)`);
  record('center-metrics expose sa table de conges', derived.length > 0, `${derived.length} periode(s)`);
  record(
    'meme nombre de periodes',
    reference.length === derived.length,
    `reference ${reference.length} / metriques ${derived.length}`,
  );

  const missing = reference.filter(r => !derived.includes(r));
  const extra = derived.filter(d => !reference.includes(d));
  record(
    'aucune periode du moteur de reservation ne manque aux metriques',
    missing.length === 0,
    missing.join(' | ') || 'aucune',
  );
  record(
    'les metriques n inventent aucune periode',
    extra.length === 0,
    extra.join(' | ') || 'aucune',
  );

  // Les libelles restent lisibles cote metriques (ils partent dans les briefs
  // marketing) : accents conserves, ete date.
  // « detente » contient « ete » : filtrer sur ce fragment attrapait le conge de
  // Carnaval et faisait rougir une assertion saine. On ancre le libelle.
  // Pas de \b apres « ete » : en JS il est ASCII, et il n existe aucune frontiere
  // de mot entre « é » et l espace qui suit. La liste ressortait vide, donc verte
  // pour de mauvaises raisons.
  const summer = metricsRaw.filter(p => /^vacances d'(e|é)t(e|é)/i.test(p.label || ''));
  record(
    'les libelles d ete restent dates (ils sortent dans les briefs)',
    summer.length > 0 && summer.every(p => /\d{4}/.test(p.label)),
    summer.map(p => p.label).join(' | ') || 'aucun',
  );

  section('[2] CONTRE-EPREUVE : une table propre a center-metrics est detectee');
  {
    const anchor = 'const SCHOOL_HOLIDAYS_FWB = WALLONIA_SCHOOL_HOLIDAYS.map';
    const occurrences = metricsOriginal.split(anchor).length - 1;
    if (occurrences !== 1) throw new Error(`ancre de mutation introuvable ou ambigue (${occurrences})`);
    try {
      fs.writeFileSync(METRICS, metricsOriginal.replace(
        anchor,
        "const SCHOOL_HOLIDAYS_FWB = [{ from: '2026-10-19', to: '2026-10-30', label: 'Conge decale' }].concat([]).map(p => p).concat([]).slice(0, 1).map",
      ));
      const broken = loadTables();
      const brokenMissing = broken.reference.filter(r => !broken.derived.includes(r));
      record(
        'avec une table propre : la divergence est vue, ce gate ROUGIRAIT',
        brokenMissing.length > 0 || broken.reference.length !== broken.derived.length,
        `reference ${broken.reference.length} / metriques ${broken.derived.length}`,
      );
    } finally {
      fs.writeFileSync(METRICS, metricsOriginal); // ECRITURE INVERSE exacte
      loadTables();
    }
    record('center-metrics.js est restaure a l identique', fs.readFileSync(METRICS, 'utf8') === metricsOriginal);
  }
} catch (error) {
  console.error('\nERREUR DU GATE:', error && (error.stack || error.message || error));
  failed = 1;
}

const red = checks.filter(c => !c.ok).length;
console.log(`\n${red || failed ? 'ECHEC' : 'ALL OK'} : ${checks.length - red}/${checks.length} verifications`);
process.exit(red || failed ? 1 : 0);
