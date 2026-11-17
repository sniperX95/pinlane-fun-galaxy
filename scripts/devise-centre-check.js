// LA MONNAIE D UN CENTRE (2026-11-17, avant-lancement D6 : « pas de devise, € en dur, aucun champ » ;
// Ansar : « règle tout ça »). Un centre suisse vend en francs suisses de bout en bout ; un centre en euros
// ne voit rien changer.
//
// [A] LA LISTE BLANCHE, A UN SEUL ENDROIT (assets/pinlane-monnaie.js), ET SON REPLI. Un code connu passe
//     (en minuscules aussi), tout le reste redevient l euro. La config du centre garde CHF et ne porte
//     AUCUNE cle pour l euro (la config d un centre en euros reste celle d avant). Changer la monnaie demande
//     le droit Tarifs, comme un prix. Les refus de prix d un centre suisse disent CHF.
// [B] L EURO N A PAS BOUGE D UN OCTET. Chaque ecriture de montant touchee rend, pour un centre en euros,
//     exactement ce que rendait le code d avant (6e0a893) : mails, copies de secours, historique, note de
//     prix, demande sur mesure, cartes de suggestion, alerte, feuille de secours, gestes de l assistant,
//     config du centre, et cote pages : le formulaire, la console, les graphiques. Les sorties d avant vivent
//     dans scripts/devise-centre-euro.json (--capturer=<racine> les releve sur une autre copie du depot).
// [C] UN CENTRE SUISSE VOIT CHF, JAMAIS € : le mail de confirmation et ses details, la copie de secours,
//     l historique et la note de prix du dossier, la demande sur mesure et sa lecture des montants, les
//     cartes de suggestion, l alerte, la feuille, les gestes de l assistant et la ligne de son contexte.
// [D] LA META PUBLIQUE DONNE LA MONNAIE A LA PAGE DE RESERVATION (le vrai handler, sans base), et la page
//     l ecrit : ses prix, les nombres mis en avant, l unite qui ne se separe pas de son nombre.
// [E] LA CONSOLE : le choix « Monnaie des prix » de la page Etablissement (la liste blanche, la valeur
//     relue et envoyee avec la fiche), et les montants du centre ouvert (planning, fiche, graphiques).
//
// Tout est simule, sans base ni reseau. Les contre-preuves chargent le code mute en memoire (serveur par
// Module._compile, pages par la lecture de leur source) : aucun fichier n est ecrit.
// Lancement : node scripts/devise-centre-check.js [--contre-preuves] [--capturer=<racine>]

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const { spawnSync } = require('child_process');

const ICI = path.resolve(__dirname, '..');
const CAPTURE = (process.argv.find((a) => a.startsWith('--capturer=')) || '').slice('--capturer='.length);
const ROOT = CAPTURE ? path.resolve(CAPTURE) : ICI;
['DATABASE_URL', 'POSTGRES_URL'].forEach((cle) => { delete process.env[cle]; });

const MUTATIONS = {
  'liste-blanche-ignoree': { f: 'lib/center-config.js', de: '  if (devise !== monnaie.DEFAUT) config.currency = devise;\n', vers: '', lettre: 'A' },
  'repli-casse': { f: 'assets/pinlane-monnaie.js', de: "    return Object.prototype.hasOwnProperty.call(DEVISES, code) ? code : DEFAUT;\n  }\n\n  function estConnue", vers: "    return code || DEFAUT;\n  }\n\n  function estConnue", lettre: 'A' },
  'monnaie-sans-droit-tarifs': { f: 'lib/center-config.js', de: '  return JSON.stringify(devise === monnaie.DEFAUT ? { remises, cartes } : { remises, cartes, devise });', vers: '  return JSON.stringify({ remises, cartes });', lettre: 'A' },
  'euro-espace-ordinaire': { f: 'lib/ops-communications.js', de: "  const NBSP = '\\u00A0';\n  const text = Number.isInteger(rounded)", vers: "  const NBSP = ' ';\n  const text = Number.isInteger(rounded)", lettre: 'B' },
  'euro-decolle': { f: 'assets/pinlane-monnaie.js', de: "    return s === '€' ? s : ` ${s}`;", vers: '    return ` ${s}`;', lettre: 'B' },
  'mail-en-euros': { f: 'lib/ops-communications.js', de: '  return `${text}${NBSP}${monnaie.signe(devise)}`;', vers: '  return `${text}${NBSP}${monnaie.signe()}`;', lettre: 'C' },
  'historique-en-euros': { f: 'lib/historique-dossier.js', de: '  const dev = devise || deviseDesEtats(b, a);', vers: "  const dev = devise || '';", lettre: 'C' },
  'assistant-sans-monnaie': { f: 'lib/assistant-gestes.js', de: '  const prep = await monnaie.avecDevise(monnaie.deviseDuCentre(ctx.centre), () => g.preparer(p, ctx));\n  const risque', vers: '  const prep = await g.preparer(p, ctx);\n  const risque', lettre: 'C' },
  'meta-sans-monnaie': { f: 'api/public-booking-meta.js', de: '        ...(monnaie.devise(center.currency) !== monnaie.DEFAUT ? { currency: monnaie.devise(center.currency) } : {}),\n', vers: '', lettre: 'D' },
  'formulaire-en-euros': { f: 'assets/fungalaxy-booking.js', de: "maximumFractionDigits: 2 }) + ' ' + signeMonnaie(); }", vers: "maximumFractionDigits: 2 }) + ' €'; }", lettre: 'D' },
  'console-sans-choix': { f: 'assets/app-main.js', de: "  if (!select || !window.PinlaneMonnaie) return undefined;\n  return window.PinlaneMonnaie.devise(select.value);", vers: "  if (!select || !window.PinlaneMonnaie) return undefined;\n  return undefined;", lettre: 'E' },
  'console-en-euros': { f: 'assets/booking-core.js', de: "  return m ? m.signe(code) : (code === 'EUR' ? '€' : code);", vers: "  return '€';", lettre: 'E' },
};
const MUTATION = (process.argv.find((a) => a.startsWith('--mutation=')) || '').slice('--mutation='.length);
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`mutation inconnue : ${MUTATION}`); process.exit(2); }
function muter(relatif, contenu) {
  const m = MUTATION ? MUTATIONS[MUTATION] : null;
  if (!m || m.f !== relatif) return contenu;
  const t = String(contenu).split('\r\n').join('\n');
  if (t.split(m.de).length !== 2) throw new Error(`ANCRE DE MUTATION absente ou multiple (${MUTATION}) dans ${m.f}`);
  return t.split(m.de).join(m.vers);
}
const compiler = Module.prototype._compile;
Module.prototype._compile = function compilerMute(contenu, fichier) {
  const rel = path.relative(ROOT, fichier).split(path.sep).join('/');
  return compiler.call(this, muter(rel, contenu), fichier);
};
const lireSource = (rel) => muter(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const exiger = (rel) => require(path.join(ROOT, rel));

let rouges = 0;
let lettre = '';
function section(titre) { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); }
function ok(condition, quoi, detail) {
  if (condition) { console.log(`ok    ${quoi}`); return; }
  rouges += 1;
  console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(detail).slice(0, 400)}` : ''}`);
}

if (process.argv.includes('--contre-preuves')) {
  const temoin = spawnSync(process.execPath, [__filename], { cwd: ICI, encoding: 'utf8', timeout: 180000 });
  if (temoin.status !== 0) { console.log(`${temoin.stdout || ''}${temoin.stderr || ''}`.split('\n').filter((l) => /ROUGE|Error/.test(l)).join('\n')); console.log('\ndevise-centre-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte'); process.exit(1); }
  let rates = 0;
  for (const [nom, m] of Object.entries(MUTATIONS)) {
    const r = spawnSync(process.execPath, [__filename, `--mutation=${nom}`], { cwd: ICI, encoding: 'utf8', timeout: 180000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const mord = r.status === 1 && sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION/.test(sortie);
    if (!mord) rates += 1;
    console.log(`${mord ? 'TUEE ' : 'VIVANTE'} ${nom} (attendu : ROUGE [${m.lettre}], sortie ${r.status})${mord ? '' : `\n${sortie.split('\n').filter((l) => /ROUGE|ANCRE|Error/.test(l)).slice(0, 6).join('\n')}`}`);
  }
  console.log(rates ? `\ndevise-centre-check --contre-preuves: ${rates} mutation(s) vivante(s)` : '\ndevise-centre-check --contre-preuves: ALL OK - chaque regle retiree fait rougir sa lettre');
  process.exit(rates ? 1 : 0);
}

// ---------- les dossiers d essai ----------
const LIBRAMONT = 'libramont';
const GENEVE = 'bowling-geneve';
const INSTANT = '2026-11-17T10:00:00.000Z';
const resa = (centerId) => ({
  id: 4242, centerId, name: 'Lea Dupont', email: 'lea@example.test', date: '2026-12-05', startTime: '15:00', pax: 8,
  type: 'formule', formuleId: 'f1', label: 'FORMULE 1', price: 117.5, basePrice: 130, quotedPrice: 117.5,
  program: { items: [{ activityId: 'bowling', name: 'Bowling', participants: 8, price: 78, priceKnown: true }] },
  extras: [{ name: 'Gâteau', price: 12.5 }],
});
const demande = (centerId) => ({
  id: 77, centerId, contactName: 'Lea Dupont', createdAt: INSTANT,
  payload: { demande: { budgetPerPerson: 25, participants: 10, groupType: 'entreprise', date: '2026-12-05' } },
});

// ---------- les sorties : les memes appels sur l ancien code et sur le nouveau ----------
function sortiesServeur(centerId) {
  const S = {};
  const essayer = (cle, fn) => { try { S[cle] = fn(); } catch (error) { S[cle] = `ERREUR ${error.message}`; } };
  const oc = exiger('lib/ops-communications.js');
  ['confirmation', 'reminder'].forEach((t) => essayer(`mail.${t}`, () => {
    const m = oc.buildMessage({ reservation: resa(centerId), templateId: t, channel: 'email' });
    return JSON.stringify({ subject: m.subject, body: m.body, preheader: m.preheader, details: m.details, note: m.note });
  }));
  const bc = exiger('lib/booking-complements.js');
  const devise = centerId === GENEVE ? 'CHF' : undefined;
  essayer('complements.montant', () => `${bc.formatComplementAmount(30.1, 7, devise)} | ${bc.formatComplementAmount(12, 1, devise)}`);
  essayer('complements.carte', () => bc.construireCarte({ id: 'f2', kind: 'formule', name: 'F2', pax: 4, deltaTotal: 12.5, devise }).amountLabel);
  const sm = exiger('lib/secours-mails.js');
  const centre = { name: centerId === GENEVE ? 'Bowling Genève' : 'Fun Galaxy Libramont' };
  essayer('secours.copie', () => JSON.stringify(sm.mailCopieReservation(resa(centerId), { centre, instant: INSTANT })));
  essayer('secours.demande', () => JSON.stringify(sm.mailCopieDemandeSurMesure(demande(centerId), { centre, instant: INSTANT })));
  essayer('secours.panne', () => JSON.stringify(sm.mailReservationPendantPanne(resa(centerId), { centre, erreur: 'base', instant: INSTANT })));
  const hd = exiger('lib/historique-dossier.js');
  essayer('historique', () => JSON.stringify(hd.phrasesDuChangement(
    { price: 20, centerId, extras: [{ name: 'Gâteau', price: 5 }] },
    { price: 30.5, centerId, extras: [{ name: 'Gâteau', price: 7.5 }, { name: 'Pizza', price: 12 }] })));
  const fs2 = exiger('lib/feuille-secours.js');
  essayer('feuille', () => `${fs2.prixTexte({ price: 45, basePrice: 50, centerId })} | ${fs2.prixTexte({ price: 45.5, centerId })}`);
  const db = exiger('lib/demande-bureau.js');
  essayer('bureau.demande', () => db.demandeEnTexte(demande(centerId)));
  const ga = exiger('lib/garde-annonces.js');
  essayer('garde.euros', () => `${ga.euros(1234.5, devise)} | ${ga.euros(0, devise)}`);
  const base = exiger('lib/database.js');
  essayer('note.prix', () => base.notesAvecPrix('', { de: 20, a: 30.5, raison: 'geste commercial', par: 'Ansar', ...(devise ? { devise } : {}), maintenant: new Date(INSTANT) }));
  const ag = exiger('lib/assistant-gestes.js');
  essayer('assistant.euros', () => `${ag.__test.euros(25.5)} | ${ag.__test.euros(25)} | ${ag.__test.nombre('30€', { min: 0, max: 100, quoi: 'x' })}`);
  if (centerId === LIBRAMONT) {
    const cc = exiger('lib/center-config.js');
    essayer('config.libramont', () => JSON.stringify(cc.normalizeCenterConfig({}, LIBRAMONT)));
  }
  return S;
}

// Une fonction de page, prise dans SA source (accolades equilibrees), pour l evaluer dans un bac a sable.
function fonctionDe(source, nom) {
  const m = new RegExp(`(^|\\n)[ \\t]*function ${nom}\\(`).exec(source);
  if (!m) return '';
  const debut = m.index + m[1].length;
  let i = source.indexOf('{', source.indexOf(')', debut));
  let profondeur = 0;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') profondeur += 1;
    else if (source[i] === '}') { profondeur -= 1; if (profondeur === 0) return source.slice(debut, i + 1); }
  }
  return '';
}

function bacDeConsole(config) {
  const bac = { console: { log() {}, warn() {}, error() {} }, document: { addEventListener() {}, getElementById: () => null }, localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout };
  bac.window = bac;
  bac.globalThis = bac;
  vm.createContext(bac);
  if (fs.existsSync(path.join(ROOT, 'assets/pinlane-monnaie.js'))) vm.runInContext(lireSource('assets/pinlane-monnaie.js'), bac);
  vm.runInContext(lireSource('assets/booking-core.js'), bac);
  if (config && typeof bac.setCenterScheduleConfig === 'function') bac.setCenterScheduleConfig(config);
  const app = lireSource('assets/app-main.js');
  const charts = lireSource('assets/pinlane-charts.js');
  const pages = lireSource('assets/staff-pages-v2.js');
  const morceaux = [
    'function montantsMasques() { return false; }',
    'function escapeHtml(s) { return String(s); }',
    ...['formatMoneyCentimes', 'formatMoney', 'formatMoneyShort', 'staffRequestEuro', 'establishmentCurrencyFieldHtml', 'collectEstablishmentCurrency'].map((n) => fonctionDe(app, n)),
    fonctionDe(pages, 'tfEuros'),
    (charts.match(/var INT_FMT = [^;]*;/) || [''])[0],
    (charts.match(/var NBSP_FINE = '[^']*';/) || [''])[0],
    ...['groupInt', 'signeDuFormat', 'formatValue', 'formatTick'].map((n) => fonctionDe(charts, n)),
  ];
  vm.runInContext(morceaux.filter(Boolean).join('\n'), bac);
  return bac;
}

function sortiesConsole(config) {
  const bac = bacDeConsole(config);
  const appel = (expr) => { try { return String(vm.runInContext(expr, bac)); } catch (error) { return `ERREUR ${error.message}`; } };
  return {
    'console.formatMontant': appel("[formatMontant(25.5), formatMontant(1234), formatMontant(0)].join(' | ')"),
    'console.formatMoney': appel("[formatMoneyCentimes(25.5), formatMoneyCentimes(12), formatMoney(1234.4), formatMoneyShort(2500), formatMoneyShort(250)].join(' | ')"),
    'console.staffRequestEuro': appel("[staffRequestEuro(25.5), staffRequestEuro(1200)].join(' | ')"),
    'console.tarifs': appel("[tfEuros(25.5), tfEuros(7)].join(' | ')"),
    'console.graphiques': appel("[formatValue(1234.4, 'euro'), formatValue(25.5, 'euro2'), formatTick(2500, 'euro'), formatTick(120, 'euro')].join(' | ')"),
  };
}

function bacDuFormulaire(meta) {
  const bac = { window: null, console: { log() {} } };
  bac.window = bac;
  bac.globalThis = bac;
  vm.createContext(bac);
  if (fs.existsSync(path.join(ROOT, 'assets/pinlane-monnaie.js'))) vm.runInContext(lireSource('assets/pinlane-monnaie.js'), bac);
  const src = lireSource('assets/fungalaxy-booking.js');
  const unites = (src.match(/var UNITES = [^\n]*;/) || [''])[0];
  const fonctions = ['deviseMonnaie', 'signeMonnaie', 'motifSignes', 'euros', 'esc', 'montantsEnAvant'].map((n) => fonctionDe(src, n));
  vm.runInContext(`var meta = ${JSON.stringify(meta)};\n${fonctions.filter(Boolean).join('\n')}\n${unites}`, bac);
  return bac;
}

// `signe` : celui du texte d essai, comme le centre l ecrirait dans ses propres phrases.
function sortiesFormulaire(meta, signe = '€') {
  const bac = bacDuFormulaire(meta);
  const appel = (expr) => { try { return String(vm.runInContext(expr, bac)); } catch (error) { return `ERREUR ${error.message}`; } };
  return {
    'formulaire.euros': appel("[euros(25.5), euros(1234), euros(18)].join(' | ')"),
    'formulaire.enAvant': appel(`montantsEnAvant('Dès 18 ${signe} par personne, 1 200,50 ${signe} pour le groupe')`),
    // Le nombre reste colle a son unite : le meme collage que la page (NOMBRE_UNITE), lu sur un texte et pas
    // sur la liste elle-meme, qui a grandi expres pour reconnaitre le franc.
    'formulaire.unites': appel(`'18 ${signe} et 2 pistes'.replace(new RegExp('(\\\\d) (?=(?:' + UNITES + ')(?![A-Za-zÀ-ÿ]))', 'g'), '$1_')`),
  };
}

function sortiesEuro() {
  return { ...sortiesServeur(LIBRAMONT), ...sortiesConsole(null), ...sortiesFormulaire(null) };
}

if (CAPTURE) {
  process.stdout.write(`${JSON.stringify(sortiesEuro(), null, 1)}\n`);
  process.exit(0);
}

(async () => {
  const monnaie = exiger('lib/monnaie.js');
  const cc = exiger('lib/center-config.js');
  const K = exiger('lib/ops-knowledge.js');
  // Le centre suisse tel que la base le rendrait (refreshCenterOverrides), ne dans la console.
  K.applyCenterRecords([{ id: GENEVE, name: 'Bowling Genève', status: 'active', timezone: 'Europe/Zurich', config: { currency: 'CHF' } }]);

  section('[A] LA LISTE BLANCHE, A UN SEUL ENDROIT, ET SON REPLI');
  {
    const page = require(path.join(ROOT, 'assets/pinlane-monnaie.js'));
    ok(monnaie.CODES.join(',') === 'EUR,CHF' && page.CODES === monnaie.CODES, 'la liste blanche est celle du fichier partage, lue telle quelle par le serveur', monnaie.CODES);
    ok(monnaie.devise('chf') === 'CHF' && monnaie.devise(' CHF ') === 'CHF', 'un code connu passe, ecrit en minuscules ou avec des espaces');
    ok(['XYZ', '', null, undefined, 'usd', 42].every((v) => monnaie.devise(v) === 'EUR'), 'tout le reste redevient l euro (vide, inconnu, mal forme)');
    ok(monnaie.signe('EUR') === '€' && monnaie.signeColle('EUR') === '€' && monnaie.signe('CHF') === 'CHF' && monnaie.signeColle('CHF') === ' CHF', 'l euro reste colle ou espace comme avant, un code de lettres prend son espace');
    const chf = cc.normalizeCenterConfig({ currency: 'chf' }, GENEVE);
    const euro = cc.normalizeCenterConfig({ currency: 'EUR' }, GENEVE);
    const inconnu = cc.normalizeCenterConfig({ currency: 'XYZ' }, GENEVE);
    ok(chf.currency === 'CHF' && !('currency' in euro) && !('currency' in inconnu), 'la config du centre garde CHF, et ne porte aucune cle pour l euro ou un code inconnu', JSON.stringify({ chf: chf.currency, euro: euro.currency, inconnu: inconnu.currency }));
    ok(K.getCenter(GENEVE).currency === 'CHF' && monnaie.deviseDuCentre(GENEVE) === 'CHF' && monnaie.deviseDuCentre(LIBRAMONT) === 'EUR' && monnaie.deviseDuCentre('inconnu') === 'EUR', 'le serveur lit la monnaie du centre dans sa config fusionnee, l euro pour un centre inconnu');
    // Le droit Tarifs : une base en memoire, la vraie fonction d enregistrement.
    const pool = (config) => ({ ecrit: null, async query(sql, params) { if (/^\s*update centers/i.test(sql)) { this.ecrit = params; return { rowCount: 1, rows: [] }; } if (/select status from centers/.test(sql)) return { rowCount: 1, rows: [{ status: 'active' }] }; return { rowCount: 1, rows: [{ settings: { config } }] }; } });
    let refus = null;
    try { await cc.saveCenterConfigOverride(pool({}), GENEVE, { currency: 'CHF' }, { prixPermis: false }); } catch (error) { refus = error; }
    const memeMonnaie = pool({});
    let passe = true;
    try { await cc.saveCenterConfigOverride(memeMonnaie, GENEVE, { currency: 'EUR', accueil: { lateThresholdMinutes: 7 } }, { prixPermis: false }); } catch (error) { passe = false; }
    ok(refus && refus.statusCode === 403 && /Tarifs/.test(refus.message) && passe && memeMonnaie.ecrit, 'changer la monnaie demande le droit Tarifs ; enregistrer la fiche sans la changer passe', refus && refus.message);
    let refusGrille = '';
    try { cc.normalizeCenterConfig({ currency: 'CHF', grillesTarif: { bowling: { 1: 5000 } } }, GENEVE, { strict: true }); } catch (error) { refusGrille = error.message; }
    let refusRemise = '';
    try { cc.normalizeCenterConfig({ currency: 'CHF', upsellOffers: { enabled: true, offers: [{ id: 'a', activityId: 'laser_game', enabled: true, kind: 'add', minParticipants: 1, maxParticipants: 10, discount: { mode: 'fixed_total', value: 99999 } }] } }, GENEVE, { strict: true }); } catch (error) { refusRemise = error.message; }
    ok(/CHF/.test(refusGrille) && !/€/.test(refusGrille) && /CHF/.test(refusRemise) && !/€/.test(refusRemise), 'les refus de prix d un centre suisse disent CHF', `${refusGrille} | ${refusRemise}`);
  }

  section('[B] L EURO N A PAS BOUGE D UN OCTET : les sorties d un centre en euros, comparees a celles d avant (6e0a893)');
  {
    const attendu = JSON.parse(fs.readFileSync(path.join(ICI, 'scripts/devise-centre-euro.json'), 'utf8'));
    const vu = sortiesEuro();
    const cles = Object.keys(attendu);
    ok(cles.length >= 20 && cles.every((c) => !/^ERREUR/.test(String(attendu[c]))), `${cles.length} sorties relevees sur l ancien code, aucune en erreur`);
    for (const c of cles) ok(vu[c] === attendu[c], `${c} : identique`, `\navant : ${JSON.stringify(attendu[c]).slice(0, 180)}\napres : ${JSON.stringify(vu[c]).slice(0, 180)}`);
  }

  section('[C] UN CENTRE SUISSE VOIT CHF, JAMAIS €');
  {
    const S = sortiesServeur(GENEVE);
    for (const [cle, valeur] of Object.entries(S)) {
      if (cle === 'assistant.euros') continue;
      ok(/CHF/.test(valeur) && !/€/.test(valeur) && !/^ERREUR/.test(valeur), `${cle} : CHF, aucun €`, valeur.slice(0, 200));
    }
    const mail = JSON.parse(S['mail.confirmation']);
    const montant = (mail.details || []).find((d) => d.label === 'Montant estimé');
    ok(montant && montant.value === '117,50\u00a0CHF', 'le mail de confirmation dit « 117,50 CHF », avec l espace insecable de l euro', montant && JSON.stringify(montant.value));
    const db = exiger('lib/demande-bureau.js');
    ok(JSON.stringify(db.lireChiffres('Budget 25 CHF, puis 1 200,50 francs et 30 € de plus').montants) === '[25,1200.5,30]', 'la demande sur mesure lit un montant en francs comme en euros (sinon un prix invente passerait)');
    const ag = exiger('lib/assistant-gestes.js');
    const dansUnGeste = await monnaie.avecDevise(monnaie.deviseDuCentre(GENEVE), async () => { await Promise.resolve(); return ag.__test.euros(25.5); });
    ok(dansUnGeste === '25,50 CHF' && ag.__test.euros(25.5) === '25,50 €', 'un geste de l assistant chiffre dans la monnaie de son centre, et seulement pendant son travail', `${dansUnGeste} | ${ag.__test.euros(25.5)}`);
    // Le geste reel : proposer pose la monnaie du centre vise, meme hors de toute requete.
    const G = exiger('lib/assistant-gestes.js');
    const nomGeste = Object.keys(G.GESTES).find((n) => G.GESTES[n].permission === undefined) || Object.keys(G.GESTES)[0];
    const sauve = G.GESTES[nomGeste];
    let vuDansLeGeste = '';
    G.GESTES[nomGeste] = { ...sauve, permission: 'dashboard.view', preparer: async () => { await Promise.resolve(); vuDansLeGeste = ag.__test.euros(10); return { texte: 'x', lignes: [] }; }, demande: null, risque: false };
    try { await G.proposer(nomGeste, {}, { centre: GENEVE, session: { authorizedCenterId: GENEVE, role: { permissions: ['dashboard.view'] }, permissions: ['dashboard.view'], member: { id: 1 } } }); } catch (error) { vuDansLeGeste = vuDansLeGeste || `ERREUR ${error.message}`; }
    G.GESTES[nomGeste] = sauve;
    ok(vuDansLeGeste === '10 CHF', 'proposer pose la monnaie du centre que vise le geste', vuDansLeGeste);
    const agent = lireSource('lib/assistant-agent.js');
    const ditLaMonnaie = new Function('require', `${fonctionDe(agent, 'ditLaMonnaie')}; return ditLaMonnaie;`)((m) => exiger(`lib/${m.replace('./', '')}.js`));
    ok(/francs suisses \(CHF\)/.test(ditLaMonnaie(GENEVE)) && ditLaMonnaie(LIBRAMONT) === '', 'le contexte de l assistant dit la monnaie d un centre suisse, et rien de plus pour un centre en euros', ditLaMonnaie(GENEVE));
  }

  section('[D] LA META PUBLIQUE DONNE LA MONNAIE A LA PAGE DE RESERVATION, ET LA PAGE L ECRIT');
  {
    const database = exiger('lib/database.js');
    database.readAvailabilitySnapshot = async (date, centerId) => ({ reservations: [], laneStatuses: {}, blocks: [], date, centerId });
    const meta = exiger('api/public-booking-meta.js');
    let ip = 0;
    const appel = async (centerId) => {
      ip += 1;
      const req = { method: 'GET', url: `/api/public-booking-meta?centerId=${centerId}`, headers: { host: 'localhost', 'x-forwarded-for': `10.9.0.${ip}` }, socket: { remoteAddress: `10.9.0.${ip}` } };
      const res = { statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; }, writeHead(c) { this.statusCode = c; }, end(b) { this.body = b === undefined ? '' : String(b); } };
      await meta(req, res);
      try { return JSON.parse(res.body || '{}'); } catch (error) { return {}; }
    };
    const geneve = await appel(GENEVE);
    const libramont = await appel(LIBRAMONT);
    ok(geneve.center && geneve.center.currency === 'CHF', 'la meta d un centre suisse porte sa monnaie', JSON.stringify(geneve.center || geneve).slice(0, 200));
    ok(libramont.center && !('currency' in libramont.center), 'la meta d un centre en euros reste celle d avant : aucune cle', JSON.stringify(Object.keys(libramont.center || {})));
    const F = sortiesFormulaire({ center: { currency: 'CHF' } }, 'CHF');
    ok(F['formulaire.euros'] === '25,50 CHF | 1\u202f234 CHF | 18 CHF' || (/CHF/.test(F['formulaire.euros']) && !/€/.test(F['formulaire.euros'])), 'le formulaire ecrit ses prix en CHF', F['formulaire.euros']);
    ok(F['formulaire.enAvant'].includes('<b class="fg-info-num">18 CHF</b>') || F['formulaire.enAvant'].includes('18 CHF</b>'), 'les montants mis en avant reconnaissent le franc', F['formulaire.enAvant']);
    ok(F['formulaire.unites'] === '18_CHF et 2_pistes', 'l unite CHF ne se separe pas de son nombre', F['formulaire.unites']);
  }

  section('[E] LA CONSOLE : le choix « Monnaie des prix » et les montants du centre ouvert');
  {
    const bac = bacDeConsole({ currency: 'CHF' });
    const champ = vm.runInContext("establishmentCurrencyFieldHtml({ currency: 'CHF' })", bac);
    const options = (champ.match(/<option value="([A-Z]{3})"/g) || []).map((o) => o.slice(-4, -1));
    ok(options.join(',') === monnaie.CODES.join(',') && /<option value="CHF" selected>/.test(champ) && /Monnaie des prix/.test(champ), 'la page Etablissement propose la liste blanche, la monnaie du centre choisie', champ.slice(0, 200));
    bac.document.getElementById = (id) => (id === 'estab-currency' ? { value: 'chf' } : null);
    const lu = vm.runInContext('collectEstablishmentCurrency()', bac);
    bac.document.getElementById = (id) => (id === 'estab-currency' ? { value: 'GBP' } : null);
    const inconnu = vm.runInContext('collectEstablishmentCurrency()', bac);
    ok(lu === 'CHF' && inconnu === 'EUR', 'la valeur choisie est relue par la liste blanche (un code inconnu redevient l euro)', `${lu} | ${inconnu}`);
    const app = lireSource('assets/app-main.js');
    ok(/const currency = collectEstablishmentCurrency\(\);\s*if \(currency !== undefined\) config\.currency = currency;/.test(app), 'elle part avec la fiche du centre (saveCenterConfig)');
    const C = sortiesConsole({ currency: 'CHF' });
    for (const [cle, valeur] of Object.entries(C)) ok(/CHF/.test(valeur) && !/€/.test(valeur) && !/ERREUR/.test(valeur), `${cle} : CHF, aucun €`, valeur);
    const sansMonnaie = sortiesConsole({});
    ok(Object.values(sansMonnaie).every((v) => /€/.test(v) && !/CHF/.test(v)), 'un centre ouvert sans monnaie reste en euros');
  }

  console.log(rouges ? `\ndevise-centre-check: ${rouges} rouge(s)` : '\ndevise-centre-check: ALL OK');
  process.exit(rouges ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
