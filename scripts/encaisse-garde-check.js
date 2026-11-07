// LA GARDE DE L ENCAISSE, JOUEE SUR LE VRAI HANDLER (2026-11-03).
//
// Noter 40 € encaisses sur un dossier a 60 €, c est baisser son prix par la
// porte voisine. Avant ce lot, noterEncaisseOuAbsence (lib/database.js)
// acceptait tout montant sous le prix avec une raison, sans regarder le niveau
// « prix » du role : un Staff bar, qui n a pas le droit d ajuster un prix, le
// faisait d un geste d accueil. jugerEncaisse (lib/droits-reservation.js) juge
// desormais ce montant comme un prix (jugerEcart), sans bloquer ce qui ne
// baisse rien.
//
// Ce gate monte le vrai api/staff-reservations.js et la vraie lib/database.js
// sur la base en memoire du banc (scripts/reserver-banc.js), avec les roles
// livres (Staff bar : prix non, Manager : 20 %, Direction : sans limite), et lit
// ce qui est REELLEMENT ecrit en base :
//   [A] les niveaux : sous le prix refuse au niveau non, plafond de 20 %, sans
//       limite ; le prix, la marge de 50 centimes, un montant au-dessus et le
//       retour au prix passent ; sans raison, la phrase du formulaire.
//   [B] la reference : base + extras, le cumul avec un prix deja baisse, un prix
//       au-dessus de la reference, un dossier sans reference.
//   [C] les gestes voisins : l absence, un dossier non paye, un montant faux,
//       deux postes, la trace du journal (montant, prix, raison).
//   [D] la console : la phrase qui previent un role au niveau prix non.
//
// --contre-preuves : chaque garde retiree en memoire (le disque n est jamais
// touche), la ligne qui la prouve doit rougir.
//
// Zero reseau, zero base, rien ne part.
// Lancement : node scripts/encaisse-garde-check.js [--contre-preuves]
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('./reserver-banc.js');

const ROOT = B.ROOT;
const URL_RESA = '/api/staff-reservations';

// ---------------------------------------------------------------------------
// Les deux ecritures du geste (noterEncaisseOuAbsence), sur la vue de la
// transaction du client, comme les ecritures du banc.
// ---------------------------------------------------------------------------
const DATES = ['created_at', 'updated_at', 'expires_at', 'released_at', 'paid_at', 'absent_at'];
const copieLigne = (row) => JSON.parse(JSON.stringify(row), (k, v) => (DATES.includes(k) && v ? new Date(v) : v));
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryDuBanc = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const tx = this && this.tx && !this.tx.abandonnee ? this.tx : null;
  const lire = (id) => (tx && tx.reservations.get(Number(id))) || B.base.reservations.get(Number(id));
  const ecrire = (avant, champs) => {
    const precedent = avant.updated_at ? new Date(avant.updated_at).getTime() : 0;
    const row = { ...avant, ...champs, updated_at: new Date(Math.max(Date.now(), precedent + 1)) };
    if (tx) tx.reservations.set(row.id, row); else B.base.reservations.set(row.id, row);
    return { rows: [copieLigne(row)], rowCount: 1 };
  };
  if (s === 'update reservations set amount_paid = $2, discount_reason = $3, updated_at = now() where id = $1 returning *;') {
    const avant = lire(params[0]);
    return avant ? ecrire(avant, { amount_paid: params[1], discount_reason: params[2] }) : { rows: [], rowCount: 0 };
  }
  if (s === 'update reservations set absent_at = case when $2 then now() else null end, updated_at = now() where id = $1 returning *;') {
    const avant = lire(params[0]);
    return avant ? ecrire(avant, { absent_at: params[1] ? new Date() : null }) : { rows: [], rowCount: 0 };
  }
  return queryDuBanc.call(this, sql, params);
};

// ---------------------------------------------------------------------------
// Les dossiers et les gestes.
// ---------------------------------------------------------------------------
const STAFF_BAR = () => B.sessionDuRole('staff-bar', { nom: 'Julie' });
const MANAGER = () => B.sessionDuRole('manager', { nom: 'Rachel' });
const DIRECTION = () => B.sessionDuRole('direction', { nom: 'Movsar' });

// Un dossier paye, avec les colonnes 0056 (sans elles la base repond 409).
const paye = (id, champs = {}) => B.ligne(id, { status: 'paid', payment_method: 'Carte', base_price: 60, price: 60, amount_paid: null, discount_reason: null, absent_at: null, paid_at: new Date(), ...champs });
const enBase = (id) => B.base.reservations.get(Number(id));
const montantEnBase = (id) => { const r = enBase(id); return r.amount_paid == null ? null : Number(r.amount_paid); };
const version = (id) => new Date(enBase(id).updated_at).toISOString();

function verdicts() {
  const liste = [];
  const v = (cond, label, detail = '') => { liste.push({ ok: Boolean(cond), label, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); return Boolean(cond); };
  return { liste, v };
}

function monter(mutations) {
  const m = B.monter({ mutations, session: STAFF_BAR() });
  // Un geste, joue par une session, sur la version en base.
  m.geste = async (s, id, champs) => {
    m.changerSession(s);
    const r = await m.appeler('PATCH', URL_RESA, { id, centerId: 'libramont', baseUpdatedAt: version(id), ...champs });
    return { statut: r.statut, code: r.json.code || '', message: r.json.message || '', json: r.json };
  };
  m.encaisser = (s, id, montant, raison = '') => m.geste(s, id, { encaissement: { montant, raison } });
  m.tracesDe = (action) => m.journal.audits.filter((a) => a.action === action);
  return m;
}
const dire = (x) => `${x.statut} ${x.code} ${x.message}`.trim();

// ---------------------------------------------------------------------------
// [A] LES NIVEAUX.
// ---------------------------------------------------------------------------
async function groupeNiveaux(mutations = []) {
  const { liste, v } = verdicts();
  B.semer([paye(1)]);
  const m = monter(mutations);

  let x = await m.encaisser(STAFF_BAR(), 1, 40, 'geste commercial');
  v(x.statut === 403 && x.code === 'prix_niveau_insuffisant' && montantEnBase(1) === null && !m.tracesDe('noterEncaisse').length,
    '[A] Staff bar (prix non) : 40 € encaisses sur 60 € refuses, 403 au contrat, rien en base ni au journal', dire(x));
  x = await m.encaisser(STAFF_BAR(), 1, 40, '');
  v(x.statut === 403 && x.code === 'prix_niveau_insuffisant' && montantEnBase(1) === null,
    '[A] Staff bar sans raison : le niveau parle d abord, 403', dire(x));
  x = await m.encaisser(STAFF_BAR(), 1, 60);
  v(x.statut === 200 && montantEnBase(1) === null, '[A] Staff bar encaisse le prix : passe, rien a noter', dire(x));
  x = await m.encaisser(STAFF_BAR(), 1, 59.6, 'monnaie');
  v(x.statut === 200 && montantEnBase(1) === 59.6, '[A] Staff bar a 40 centimes sous le prix : la marge de 50 centimes passe', dire(x));
  x = await m.encaisser(STAFF_BAR(), 1, 75, 'boissons reglees au comptoir');
  v(x.statut === 200 && montantEnBase(1) === 75, '[A] Staff bar encaisse plus que le prix : un supplement passe sans niveau', dire(x));

  // Un montant plus bas pose par la Direction, puis corrige au prix par le bar.
  x = await m.encaisser(DIRECTION(), 1, 30, 'deux joueurs absents');
  v(x.statut === 200 && montantEnBase(1) === 30 && enBase(1).discount_reason === 'deux joueurs absents', '[A] Direction (sans limite) : 30 € sur 60 € avec sa raison', dire(x));
  x = await m.encaisser(STAFF_BAR(), 1, 60);
  v(x.statut === 200 && montantEnBase(1) === null, '[A] Staff bar remet le montant au prix : la correction passe', dire(x));

  x = await m.encaisser(MANAGER(), 1, 48, 'geste fidelite');
  v(x.statut === 200 && montantEnBase(1) === 48, '[A] Manager (20 %) : 48 € sur 60 €, au plafond, passe', dire(x));
  x = await m.encaisser(MANAGER(), 1, 47.99, 'geste fidelite');
  v(x.statut === 403 && x.code === 'prix_niveau_insuffisant' && /20 %/.test(x.message) && /12 €/.test(x.message) && montantEnBase(1) === 48,
    '[A] Manager : un centime sous le plafond, refuse, le message dit 20 % et 12 €', dire(x));
  x = await m.encaisser(MANAGER(), 1, 50, '');
  v(x.statut === 422 && /Dites pourquoi le montant diffère du prix/.test(x.message) && !/Indiquez la raison/.test(x.message) && montantEnBase(1) === 48,
    '[A] Manager sans raison : la phrase du formulaire, la meme qu au-dessus du prix, rien n est ecrit', dire(x));
  x = await m.encaisser(DIRECTION(), 1, 10, 'invitation du gerant');
  v(x.statut === 200 && montantEnBase(1) === 10, '[A] Direction : 10 € sur 60 € avec sa raison', dire(x));
  return liste;
}

// ---------------------------------------------------------------------------
// [B] LA REFERENCE.
// ---------------------------------------------------------------------------
async function groupeReference(mutations = []) {
  const { liste, v } = verdicts();
  B.semer([
    paye(2, { base_price: 60, price: 50 }),
    paye(3, { base_price: 60, price: 70 }),
    paye(4, { base_price: 0, price: 100 }),
    paye(5, { base_price: 50, price: 70, extras: [{ name: 'Pizza Margherita × 2', price: 20 }] }),
  ]);
  const m = monter(mutations);
  let x = await m.encaisser(MANAGER(), 2, 45, 'geste');
  v(x.statut === 403 && montantEnBase(2) === null, '[B] prix deja baisse a 50 € sur 60 € : 45 € fait 25 % de la reference, le Manager est refuse', dire(x));
  x = await m.encaisser(MANAGER(), 2, 49, 'geste');
  v(x.statut === 200 && montantEnBase(2) === 49, '[B] le meme dossier, 49 € : 18 % de la reference, passe', dire(x));
  x = await m.encaisser(MANAGER(), 3, 65, 'geste');
  v(x.statut === 200 && montantEnBase(3) === 65, '[B] prix au-dessus de la reference (70 € sur 60 €) : 65 € reste a 8 % de la reference, passe', dire(x));
  x = await m.encaisser(MANAGER(), 4, 80, 'geste');
  v(x.statut === 200 && montantEnBase(4) === 80, '[B] dossier sans reference : mesure a son prix, 80 € sur 100 € passe a 20 %', dire(x));
  x = await m.encaisser(MANAGER(), 4, 79, 'geste');
  v(x.statut === 403 && montantEnBase(4) === 80, '[B] dossier sans reference : 79 € sur 100 € refuse', dire(x));
  x = await m.encaisser(MANAGER(), 5, 56, 'geste');
  v(x.statut === 200 && montantEnBase(5) === 56, '[B] les extras comptent : reference 70 € (50 + pizzas), 56 € passe a 20 %', dire(x));
  x = await m.encaisser(MANAGER(), 5, 55, 'geste');
  v(x.statut === 403 && montantEnBase(5) === 56, '[B] les extras comptent : 55 € refuse, 21 % de 70 €', dire(x));
  return liste;
}

// ---------------------------------------------------------------------------
// [C] LES GESTES VOISINS.
// ---------------------------------------------------------------------------
async function groupeVoisins(mutations = []) {
  const { liste, v } = verdicts();
  B.semer([
    paye(6),
    B.ligne(7, { status: 'pending', base_price: 60, price: 60, amount_paid: null, discount_reason: null, absent_at: null }),
  ]);
  const m = monter(mutations);
  let x = await m.geste(STAFF_BAR(), 7, { absent: true });
  v(x.statut === 200 && enBase(7).absent_at instanceof Date, '[C] l absence ne touche pas au prix : Staff bar la note', dire(x));
  const absence = m.tracesDe('noterAbsence')[0];
  v(absence && absence.context && absence.context.absent === true, '[C] la trace de l absence dit « absent »', absence && absence.context);
  x = await m.geste(STAFF_BAR(), 7, { absent: false });
  const retrait = m.tracesDe('noterAbsence')[1];
  v(x.statut === 200 && enBase(7).absent_at === null && retrait && retrait.context.absent === false, '[C] retirer l absence : la trace dit le retrait', dire(x));
  x = await m.encaisser(STAFF_BAR(), 7, 40, 'geste');
  v(x.statut === 422 && /dossier payé/.test(x.message) && x.code === '', '[C] un dossier non paye : la base repond avec sa phrase, pas un refus de droit', dire(x));
  x = await m.encaisser(STAFF_BAR(), 6, -5, 'geste');
  v(x.statut === 422 && /Montant encaissé invalide/.test(x.message), '[C] un montant negatif : la phrase de la base', dire(x));
  m.changerSession(MANAGER());
  const perime = await m.appeler('PATCH', URL_RESA, { id: 6, centerId: 'libramont', baseUpdatedAt: new Date(Date.parse(version(6)) - 60000).toISOString(), encaissement: { montant: 50, raison: 'geste' } });
  v(perime.statut === 409 && montantEnBase(6) === null, '[C] deux postes : une version perimee n ecrit rien', `${perime.statut} ${perime.json.message || ''}`);
  x = await m.encaisser(MANAGER(), 6, 50, 'joueur en moins');
  const trace = m.tracesDe('noterEncaisse').pop();
  v(x.statut === 200 && trace && trace.context && JSON.stringify(trace.context.encaisse) === JSON.stringify({ montant: 50, prix: 60, raison: 'joueur en moins' }),
    '[C] la trace de l encaisse porte le montant, le prix et la raison', trace && trace.context && trace.context.encaisse);
  x = await m.encaisser(MANAGER(), 6, 60);
  const auPrix = m.tracesDe('noterEncaisse').pop();
  v(x.statut === 200 && auPrix && auPrix.context.encaisse && auPrix.context.encaisse.montant === 60 && auPrix.context.encaisse.raison === '',
    '[C] revenir au prix : la trace dit le prix encaisse', auPrix && auPrix.context && auPrix.context.encaisse);
  return liste;
}

// ---------------------------------------------------------------------------
// [D] LA CONSOLE : la phrase sous « Enregistrer », le vrai source joue dans un bac.
// ---------------------------------------------------------------------------
function fonctionDuSource(src, nom) {
  const debut = src.indexOf(`function ${nom}(`);
  if (debut < 0) throw new Error(`fonction absente : ${nom}`);
  let i = src.indexOf('{', src.indexOf(')', debut));
  let profondeur = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') profondeur += 1;
    else if (src[i] === '}') { profondeur -= 1; if (profondeur === 0) break; }
  }
  return src.slice(src.lastIndexOf('\n', debut) + 1, i + 1);
}

async function groupeConsole(mutations = []) {
  const { liste, v } = verdicts();
  const vm = require('vm');
  let src = fs.readFileSync(path.join(ROOT, 'assets/app-main.js'), 'utf8').replace(/\r\n/g, '\n');
  for (const mutation of mutations.filter((mu) => mu.fichier === 'assets/app-main.js')) {
    if (src.split(mutation.de).length !== 2) throw new Error(`ancre absente ou multiple dans assets/app-main.js : ${mutation.de.slice(0, 70)}`);
    src = src.replace(mutation.de, mutation.vers);
  }
  // peutGeste (2026-11-07) : la table des gestes de l ecran, ici avec tous les
  // droits comme canUseStaffPermission ; seul le niveau de prix varie.
  const bac = { niveau: 'non', canUseStaffPermission: () => true, peutGeste: () => true, prixDossierConnu: () => true, escapeHtml: String };
  bac.niveauStaff = (cle) => (cle === 'prix' ? bac.niveau : 'oui');
  vm.createContext(bac);
  vm.runInContext(`${fonctionDuSource(src, 'renderGroupeEncaisseAbsence')}\nthis.rendre = renderGroupeEncaisseAbsence;`, bac);
  const dossier = { id: 6, status: 'paid', price: 60, amountPaid: null, discountReason: '' };
  const note = (html) => /class="pos-encaisse-note"/.test(html) && /droit d’ajuster un prix/.test(html);
  v(note(bac.rendre(dossier)), '[D] niveau prix non : la fiche previent avant l envoi (encaisser moins demande le droit d ajuster un prix)');
  bac.niveau = '20';
  v(!note(bac.rendre(dossier)) && /noterEncaisse\(6, event\)/.test(bac.rendre(dossier)), '[D] niveau 20 % : le formulaire, sans la phrase');
  bac.niveau = 'libre';
  v(!note(bac.rendre(dossier)), '[D] sans limite : sans la phrase');
  const phrase = (/<p class="pos-encaisse-note">([^<]*)<\/p>/.exec(src) || [])[1] || '';
  v(phrase && !/[\u2013\u2014]/.test(phrase), '[D] la phrase ne porte ni tiret cadratin ni demi-cadratin', phrase);
  return liste;
}

// ---------------------------------------------------------------------------
// LES GROUPES ET LEURS CONTRE-PREUVES.
// ---------------------------------------------------------------------------
const GROUPES = { groupeNiveaux, groupeReference, groupeVoisins, groupeConsole };
const API = 'api/staff-reservations.js';
const DROITS = 'lib/droits-reservation.js';

const CONTRE_PREUVES = [
  { nom: 'la garde retiree du handler', groupe: 'groupeNiveaux', attendu: /Staff bar \(prix non\) : 40 €/, fichier: API, de: '          jugerEncaisse({ session, current, encaissement: body.encaissement });\n', vers: '' },
  { nom: 'tout refus avale', groupe: 'groupeNiveaux', attendu: /Staff bar \(prix non\) : 40 €/, fichier: DROITS, de: "    if (error.code !== 'prix_raison_requise') throw error;\n", vers: '' },
  { nom: 'la raison jugee avant la base', groupe: 'groupeNiveaux', attendu: /Manager sans raison : la phrase du formulaire/, fichier: DROITS, de: "    if (error.code !== 'prix_raison_requise') throw error;\n", vers: '    throw error;\n' },
  { nom: 'un montant au-dessus juge comme une baisse', groupe: 'groupeNiveaux', attendu: /un supplement passe sans niveau/, fichier: DROITS, de: '  if (centimes(prix) - centimes(montant) <= TOLERANCE_CENTIMES) return;', vers: '  if (Math.abs(centimes(prix) - centimes(montant)) <= TOLERANCE_CENTIMES && centimes(montant) <= centimes(prix)) return;' },
  { nom: 'la marge de 50 centimes retiree', groupe: 'groupeNiveaux', attendu: /la marge de 50 centimes passe/, fichier: DROITS, de: '  if (centimes(prix) - centimes(montant) <= TOLERANCE_CENTIMES) return;', vers: '  if (centimes(prix) - centimes(montant) <= 0) return;' },
  { nom: 'le plafond lu sur le prix au lieu de la reference', groupe: 'groupeReference', attendu: /45 € fait 25 % de la reference/, fichier: DROITS, de: 'reference: reference > 0 ? reference : prix, raison: encaissement.raison', vers: 'reference: prix, raison: encaissement.raison' },
  { nom: 'un dossier sans reference ferme a tous', groupe: 'groupeReference', attendu: /80 € sur 100 € passe/, fichier: DROITS, de: 'reference: reference > 0 ? reference : prix, raison: encaissement.raison', vers: 'reference, raison: encaissement.raison' },
  { nom: 'les extras oublies dans la reference', groupe: 'groupeReference', attendu: /55 € refuse, 21 %/, fichier: DROITS, de: 'const reference = Math.max(0, euros(centimes(current.basePrice) + centimes(totalExtrasComptoir(current.extras))));\n  try {', vers: 'const reference = Math.max(0, euros(centimes(current.basePrice)));\n  try {' },
  { nom: 'un dossier non paye juge comme un prix', groupe: 'groupeVoisins', attendu: /un dossier non paye : la base repond avec sa phrase/, fichier: DROITS, de: "if (!encaissement || typeof encaissement !== 'object' || !current || current.status !== 'paid') return;", vers: "if (!encaissement || typeof encaissement !== 'object' || !current) return;" },
  { nom: 'la trace sans l encaisse', groupe: 'groupeVoisins', attendu: /la trace de l encaisse porte le montant/, fichier: API, de: "          ? { encaisse: { montant: reservation.amountPaid ?? reservation.price, prix: reservation.price, raison: reservation.discountReason || '' } }\n", vers: '          ? {}\n' },
  { nom: 'la trace sans l absence', groupe: 'groupeVoisins', attendu: /la trace de l absence dit « absent »/, fichier: API, de: '          : { absent: Boolean(reservation.absentAt) };', vers: '          : {};' },
  { nom: 'la phrase montree a tous', groupe: 'groupeConsole', attendu: /niveau 20 % : le formulaire, sans la phrase/, fichier: 'assets/app-main.js', de: "${typeof niveauStaff === 'function' && niveauStaff('prix') === 'non' ? '<p class=\"pos-encaisse-note\">", vers: "${true ? '<p class=\"pos-encaisse-note\">" },
  { nom: 'la phrase retiree', groupe: 'groupeConsole', attendu: /niveau prix non : la fiche previent/, fichier: 'assets/app-main.js', de: "${typeof niveauStaff === 'function' && niveauStaff('prix') === 'non' ? '<p class=\"pos-encaisse-note\">", vers: "${false ? '<p class=\"pos-encaisse-note\">" },
];

// Une promesse jamais tenue vide la boucle et Node sort en 0 sans bilan : ce
// silence-la est un rouge (B.sortir sort toujours par process.exit).
process.on('beforeExit', () => {
  console.error('FAIL  encaisse-garde-check s est arrete avant son bilan : une promesse jamais tenue');
  process.exit(1);
});

async function main() {
  const contrePreuves = process.argv.includes('--contre-preuves');
  let echecs = 0;
  if (!contrePreuves) {
    for (const [nom, groupe] of Object.entries(GROUPES)) {
      const liste = await groupe();
      liste.forEach(({ ok, label, detail }) => {
        console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`);
        if (!ok) echecs += 1;
      });
      if (!liste.length) { console.log(`FAIL  ${nom} n a rien verifie`); echecs += 1; }
    }
    B.sortir('encaisse-garde-check', echecs, 'encaisser moins que le prix se juge au niveau prix du role, ce qui ne baisse rien passe.');
    return;
  }
  for (const c of CONTRE_PREUVES) {
    const liste = await GROUPES[c.groupe]([{ fichier: c.fichier, de: c.de, vers: c.vers }]).catch((error) => [{ ok: false, label: `exception : ${error.message}`, detail: '' }]);
    const rouges = liste.filter((x) => !x.ok);
    const mord = rouges.some((x) => c.attendu.test(x.label));
    console.log(`${mord ? 'ok  ' : 'FAIL'}  contre-preuve « ${c.nom} » : ${mord ? 'le gate rougit' : `AUCUN ROUGE ATTENDU (${rouges.length} rouge(s) : ${rouges.slice(0, 2).map((x) => x.label).join(' | ') || 'aucun'})`}`);
    if (!mord) echecs += 1;
  }
  B.sortir('encaisse-garde-check --contre-preuves', echecs, `${CONTRE_PREUVES.length} gardes retirees une a une, chacune fait rougir sa ligne.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
