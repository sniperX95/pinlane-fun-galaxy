'use strict';
// « FACTURÉ » COMME MOYEN DE PAIEMENT, ET LE PRIX TVAC OU HTVA A RESERVER (2026-11-24).
//
// Le gerant (Ansar), le 24/11 : « comme moyen de paiement ça serait bien de mettre facturé et ça ouvre une pop up
// vraiment pro pour compléter toutes les infos » ; « pour le tva htva y a pas quand on fait une resa » ; puis, devant
// la fiche : « quand on est ici on sait pas mettre confirmé, arrivé ou payé, genre confirmé on sait pas ».
// Un dossier « Facturé » n est pas paye : son statut ne bouge pas, rien ne s encaisse, il dit « À facturer » et garde
// la societe, sa TVA (belge controlee au modulo 97, ou d un autre pays de l UE), l adresse, l e-mail, le contact et la
// reference, dans une ligne de note d equipe `type: 'facture'` que le serveur seul ecrit (assets/pinlane-facturation.js,
// pas de migration). Ce gate joue la VRAIE console (scripts/planning-v3-fixtures.js, un mardi calme a Libramont), le
// VRAI handler api/staff-reservations.js et le vrai moteur (scripts/reserver-banc.js, base en memoire), en vrais
// gestes, et lit le dossier en base.
//   [S] LE SERVEUR : la regle de la TVA (BE0123456749 passe, BE0123456789 non, l ancien belge a 9 chiffres, un numero
//       d un autre pays), les champs obligatoires ; PATCH { facturation } : 422 sur un champ faux (rien ne s ecrit),
//       403 sans le droit d encaisser, 200 sinon, le statut et le moyen intacts, une seule ligne, `null` la retire ;
//       une ligne `facture` forgee dans les notes d un PATCH perd ses champs ; a la creation (POST) la ligne nait, ou
//       le refus ; l export Excel dit « Facturé » dans le moyen et la facture dans les notes.
//   [R] RESERVER, « FACTURÉ » : le ticket a Payé carte, Payé espèces et Facturé (demain : seul Facturé se touche) ; la
//       fenetre s ouvre sur le premier champ vide, deja remplie du nom ; Echap la ferme et rend le focus ; un numero de
//       TVA faux se dit sous son champ ; Entree avec des champs vides dit combien et ne cree rien ; remplie, Entree cree
//       le dossier, confirme, pas paye, sa facture en note.
//   [T] RESERVER, TVAC OU HTVA : « Prix TVAC | HTVA », TVAC par defaut ; HTVA dit le total et le prix par joueur hors
//       TVA au taux des activites ; un total tape HTVA (100) s enregistre TVA comprise (106).
//   [D] UNE DEMANDE DE GROUPE : la societe et la TVA preremplissent la fenetre (le focus sur la rue), et le reglage
//       « Les groupes seulement » ouvre le ticket en HTVA ; sans societe, il reste en TVAC.
//   [F] LA FICHE ET LE PLANNING : le statut se lit d un coup d oeil (« Confirmé », « Arrivé · Facturé ») et son bouton
//       ouvre la liste du menu des lignes du planning (Confirmé, Arrivé, Payé carte, Payé espèces, Facturé) ; Echap ne
//       ferme que la liste ; « Facturé » de la caisse ouvre la fenetre, le dossier dit « À facturer » et sa facture,
//       reste confirme ; Arrivé depuis le statut ; la ligne du planning dit « à facturer », son menu a Facturé ; la
//       facture se modifie (une ligne) ; Payé carte ensuite : paye, la facture garde son nom ; Confirmé de nouveau.
//   [P] AU TELEPHONE : la fenetre monte du bas, pleine largeur, ses champs et ses boutons au doigt.
//   [*] Zero erreur JavaScript.
//
// CONTRE-PREUVES : `--contre-preuves` rejoue le gate sur du code casse expres, une mutation a la fois, en memoire (la
// console par le serveur de fichiers, le serveur par le crochet de compilation du banc), UN navigateur a la fois, et
// exige que chacune rougisse sa lettre. `--seul=F` ne joue qu une lettre ; `--captures` pose les ecrans dans
// captures-facture/ (jamais commite), 900 px de large au plus.
// Lancement : node scripts/facturation-check.js [--contre-preuves] [--seul=R] [--captures]
// Zero reseau sortant, zero vraie base : rien ne part.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

delete process.env.RESEND_API_KEY;
delete process.env.POSTGRES_URL;
process.env.DATABASE_URL = 'postgres://gate:gate@127.0.0.1:1/gate';
process.env.PINLANE_CALENDAR_SYNC = 'off';
const fetchOrigine = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url && url.url ? url.url : url);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u)) throw new Error(`gate : appel sortant refuse vers ${u.slice(0, 80)}`);
  return fetchOrigine(url, init);
};

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_FACTURATION_PORT || 7771);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CAPTURES = path.join(ROOT, 'captures-facture');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };
const SEUL = typeof argument('seul') === 'string' ? argument('seul') : '';
const joue = (lettre) => !SEUL || SEUL.split(',').includes(lettre);
const lf = (t) => String(t).split('\r\n').join('\n');

const APP = 'assets/app-main.js';
const PG = 'assets/pinlane-planning-global.js';
const REGLE = 'assets/pinlane-facturation.js';
const API = 'api/staff-reservations.js';
const BASE = 'lib/database.js';
const EXPORT = 'lib/export-excel.js';
const CSS = 'assets/pinlane-staff.css';

// LES MUTATIONS : une regle retiree a la fois. `lettre` : le scenario qui doit rougir. `serveur` : le code passe par le
// crochet de compilation du banc, sinon la console le recoit du serveur de fichiers.
const MUTATIONS = [
  // [S] le chiffre de controle oublie ; le droit d encaisser oublie ; une ligne forgee gardee telle quelle ; l export muet.
  { nom: 'tva-sans-controle', lettre: 'S', serveur: true, fichier: REGLE, de: "      if (!controleBelge(numero)) return { ok: false, message: 'Ce numéro de TVA n’existe pas : un chiffre est faux. Vérifiez-le avec le client.' };\n", vers: '' },
  { nom: 'facture-sans-droit', lettre: 'S', serveur: true, fichier: API, de: "        const factureSession = await requireStaffPermission(req, res, 'payments.markPaid', { centerId: requestedCenterId });\n        if (!factureSession) return;\n", vers: '' },
  { nom: 'ligne-forgee-gardee', lettre: 'S', serveur: true, fichier: BASE, de: '    return NOTE_EQUIPE_TAG + JSON.stringify({ t: texte, par: signataire, le });', vers: '    return propre;' },
  { nom: 'export-sans-facture', lettre: 'S', serveur: true, fichier: EXPORT, de: "(FACTURATION.dossierAFacturer(r) ? 'Facturé' : '')", vers: "''" },
  { nom: 'creation-sans-facture', lettre: 'S', serveur: true, fichier: 'lib/reserver-fenetre.js', de: '    corps.notes = F.notesAvecFacture(', vers: '    corps.notesIgnorees = F.notesAvecFacture(' },
  // [R] la facturation qui ne part pas avec la creation ; « Facturé » qui encaisse ; la TVA fausse muette a l ecran ;
  // le focus sur le premier champ, rempli ou non.
  { nom: 'facture-pas-envoyee', lettre: 'R', fichier: APP, de: '        }), ...(facturation ? { facturation } : {}) })', vers: '        }) })' },
  { nom: 'facture-encaisse', lettre: 'R', fichier: APP, de: '      s.factureAEnvoyer = f;\n      saveQuickBook();', vers: "      s.factureAEnvoyer = f;\n      s.payNow = 'Carte Bancaire';\n      saveQuickBook();" },
  { nom: 'erreur-tva-muette', lettre: 'R', fichier: APP, de: "    if (msg) { msg.textContent = erreur; msg.hidden = !erreur; }", vers: '' },
  { nom: 'vides-sans-message', lettre: 'R', fichier: APP, de: "    if (bandeau) { bandeau.textContent = nombre > 1 ? `${nombre} champs sont à compléter.` : 'Un champ est à compléter.'; bandeau.hidden = false; }", vers: '' },
  // [T] le hors TVA qui ne se lit pas ; un total tape HTVA enregistre tel quel.
  { nom: 'total-htva-pas-lu', lettre: 'T', fichier: APP, de: '  return tva ? tva.htva : Number(total) || 0;\n}', vers: '  return Number(total) || 0;\n}' },
  { nom: 'htva-tape-non-converti', lettre: 'T', fichier: APP, de: 'oninput="onQuickCustomPriceInput(rvTvacDuTape(this.value)); rsMajTicket()"', vers: 'oninput="onQuickCustomPriceInput(this.value); rsMajTicket()"' },
  // [D] la societe d une demande qui ne fait pas un groupe ; le focus qui ignore ce qui est deja rempli.
  { nom: 'societe-pas-un-groupe', lettre: 'D', fichier: APP, de: '  return Boolean(s.facturationSaisie || (s.factureConnue && s.factureConnue.societe));', vers: '  return false;' },
  { nom: 'focus-sur-le-premier', lettre: 'D', fichier: APP, de: "containStaffDialog(hote, '.fa-fenetre', `#faChamp-${premier}`,", vers: "containStaffDialog(hote, '.fa-fenetre', '#faChamp-societe'," },
  // [F] la fiche sans sa rangee de statut, sans le bloc de la facture ; le planning qui veut encaisser ; le menu sans Facturé.
  { nom: 'fiche-sans-statut', lettre: 'F', fichier: APP, de: "    ${bandeauBloquant ? '' : ficheStatut(r)}\n", vers: '' },
  { nom: 'fiche-sans-facture', lettre: 'F', fichier: APP, de: '      ${ficheFacture(r, droits)}\n', vers: '' },
  { nom: 'planning-encaisse', lettre: 'F', fichier: PG, de: "    } else if (typeof dossierAFacturer === 'function' && dossierAFacturer(r)) {", vers: '    } else if (false) {' },
  { nom: 'echap-ferme-la-fiche', lettre: 'F', fichier: APP, de: "    e.stopImmediatePropagation();\n    window.removeEventListener('keydown', echap, true);", vers: "    window.removeEventListener('keydown', echap, true);" },
  { nom: 'menu-sans-facture', lettre: 'F', fichier: APP, de: "    choix.push({ valeur: 'facture', mot: MOYEN_FACTURE, actuel: dossierAFacturer(r), fenetre: true });\n", vers: '' },
  // [P] la fenetre qui garde sa largeur d ordinateur au telephone.
  { nom: 'telephone-largeur-fixe', lettre: 'P', fichier: CSS, de: '  .fa-fenetre { width: 100%; max-height: 94dvh; border-radius: 14px 14px 0 0; }\n', vers: '  .fa-fenetre { width: 300px; }\n' },
];

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : un fil par mutation, l un apres l autre (un seul navigateur a la fois sur la machine).
// ---------------------------------------------------------------------------
function lancer(args, port) {
  return new Promise((ok) => {
    const fil = spawn(process.execPath, [__filename, ...args], { cwd: ROOT, env: { ...process.env, PINLANE_FACTURATION_PORT: String(port) } });
    let sortie = '';
    fil.stdout.on('data', (d) => { sortie += d; });
    fil.stderr.on('data', (d) => { sortie += d; });
    const garde = setTimeout(() => fil.kill(), 600000);
    fil.on('close', (code) => { clearTimeout(garde); ok({ code, sortie }); });
  });
}

if (argument('contre-preuves')) {
  (async () => {
    // (`--seul=S` avec les contre-preuves : le temoin et les mutations de ces lettres seulement)
    const temoin = await lancer(SEUL ? [`--seul=${SEUL}`] : [], PORT);
    if (temoin.code !== 0) {
      console.log(temoin.sortie.split('\n').filter((l) => /ROUGE|Error|erreur/.test(l)).slice(0, 12).join('\n'));
      console.log('\nfacturation-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte');
      process.exit(1);
    }
    const voulues = typeof argument('contre-preuves') === 'string' ? argument('contre-preuves').split(',') : null;
    const file = MUTATIONS.filter((m) => (!voulues || voulues.includes(m.nom)) && joue(m.lettre));
    let rates = 0;
    for (const m of file) {
      // eslint-disable-next-line no-await-in-loop
      const r = await lancer([`--mutation=${m.nom}`, `--seul=${m.lettre}`], PORT + 1);
      const mord = r.code === 1 && r.sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION|ancre absente/.test(r.sortie);
      if (!mord) rates += 1;
      console.log(`${mord ? 'TUEE   ' : 'VIVANTE'} ${m.nom} (attendu : ROUGE [${m.lettre}], sortie ${r.code})${mord ? '' : `\n${r.sortie.split('\n').filter((l) => /ROUGE|ANCRE|ancre|Error/.test(l)).slice(0, 6).join('\n')}`}`);
    }
    console.log(rates
      ? `\nfacturation-check --contre-preuves: ${rates} mutation(s) vivante(s)`
      : `\nfacturation-check --contre-preuves: ALL OK - ${file.length} mutations, chaque regle retiree fait rougir sa lettre`);
    process.exit(rates ? 1 : 0);
  })();
} else {
  principal().catch((error) => { console.error(error); process.exit(1); });
}

async function principal() {
  const nomMutation = typeof argument('mutation') === 'string' ? argument('mutation') : '';
  const mutation = nomMutation ? MUTATIONS.find((m) => m.nom === nomMutation) : null;
  if (nomMutation && !mutation) { console.error(`mutation inconnue : ${nomMutation}`); process.exit(2); }
  // La console mutee : le texte servi au navigateur. L ancre doit exister une fois, sinon la contre-preuve ne prouverait rien.
  const transformer = (rel, texte) => {
    if (!mutation || mutation.serveur || mutation.fichier !== rel) return texte;
    const t = lf(texte);
    if (t.split(mutation.de).length !== 2) { console.log(`ANCRE DE MUTATION absente ou multiple (${mutation.nom}) dans ${rel}`); process.exit(2); }
    return t.split(mutation.de).join(mutation.vers);
  };
  if (mutation && !mutation.serveur) transformer(mutation.fichier, fs.readFileSync(path.join(ROOT, mutation.fichier), 'utf8'));

  const B = require('./reserver-banc.js');
  const FX = require('./planning-v3-fixtures.js');
  // Ce que le banc ne connait pas : la facturation sous verrou (lib/database.js noterFacturation).
  const DATES = ['created_at', 'updated_at', 'expires_at', 'released_at', 'paid_at', 'absent_at'];
  const copieLigne = (row) => JSON.parse(JSON.stringify(row), (k, v) => (DATES.includes(k) && v ? new Date(v) : v));
  const pg = require(require.resolve('pg', { paths: [ROOT] }));
  const queryDuBanc = pg.Client.prototype.query;
  pg.Client.prototype.query = async function (sql, params = []) {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    const tx = this && this.tx && !this.tx.abandonnee ? this.tx : null;
    const lire = (id) => (tx && tx.reservations.get(Number(id))) || B.base.reservations.get(Number(id));
    if (s === 'select * from reservations where id = $1 and center_id = $2 for update;') {
      const row = lire(params[0]);
      return row && row.center_id === params[1] ? { rows: [copieLigne(row)], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (s === 'update reservations set notes = $3, updated_at = now() where id = $1 and center_id = $2 returning *;') {
      const avant = lire(params[0]);
      if (!avant) return { rows: [], rowCount: 0 };
      const row = { ...avant, notes: params[2], updated_at: new Date(Math.max(Date.now(), new Date(avant.updated_at).getTime() + 1)) };
      if (tx) tx.reservations.set(row.id, row); else B.base.reservations.set(row.id, row);
      return { rows: [copieLigne(row)], rowCount: 1 };
    }
    if (/^update reservations set status = \$2, payment_method = \$3, updated_at = now\(\) where id = \$1 returning \*;?$/.test(s)) {
      const avant = lire(params[0]);
      if (!avant) return { rows: [], rowCount: 0 };
      const row = { ...avant, status: params[1], payment_method: params[2] || null, updated_at: new Date(Math.max(Date.now(), new Date(avant.updated_at).getTime() + 1)) };
      if (params[1] === 'paid' && !avant.paid_at) row.paid_at = new Date();
      if (params[1] !== 'paid') row.paid_at = null;
      if (tx) tx.reservations.set(row.id, row); else B.base.reservations.set(row.id, row);
      return { rows: [copieLigne(row)], rowCount: 1 };
    }
    return queryDuBanc.call(this, sql, params);
  };
  const HORLOGE_SERVEUR = { fichier: 'lib/booking-config.js', de: 'function getBusinessNowParts(date = new Date()) {', vers: 'function getBusinessNowParts(date = new Date(globalThis.__comptoirMaintenant || Date.now())) {' };
  const DIRECTION = B.sessionDuRole('direction', { nom: 'Accueil' });
  const serveur = B.monter({
    mutations: [HORLOGE_SERVEUR, ...(mutation && mutation.serveur ? [{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }] : [])],
    session: DIRECTION,
  });
  const F = require(path.join(ROOT, REGLE));
  FX.APPAREILS.comptoir = FX.APPAREILS.comptoir || { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: 'fr-BE' };
  FX.APPAREILS.mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'fr-BE', isMobile: true, hasTouch: true };

  let rouges = 0;
  let lettre = '';
  const section = (titre) => { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); };
  const ok = (condition, quoi, detail) => {
    if (condition) { console.log(`ok    ${quoi}`); return; }
    rouges += 1;
    console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700)}` : ''}`);
  };

  const FIXTURE = 'calme';
  const HEURE = '15:10';
  const AUJOURD_HUI = FX.lireFixture(FIXTURE).staffState.date;
  const DEMAIN = (() => { const d = new Date(`${AUJOURD_HUI}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
  const TAUX = { activities: 6, food: 12, drinks: 21, arcades: 21 };
  const LAMBERT = { societe: 'Lambert SA', tva: 'BE 0123.456.749', rue: 'Rue de la Gare 12', codePostal: '6800', ville: 'Libramont', pays: 'BE', email: 'compta@lambert.be', contact: 'Julie Lambert', reference: 'PO-2026-118' };
  const ligneDe = (id) => B.base.reservations.get(Number(id)) || B.base.reservations.get(id);
  const version = (id) => new Date(ligneDe(id).updated_at).toISOString();
  const factureDe = (r) => (r ? F.factureDesNotes(r.notes) : null);
  const lignesFacture = (r) => String((r && r.notes) || '').split('\n').filter((l) => F.lireLigne(l)).length;
  const euros = (n) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')}`;
  const corpsLaser = (champs = {}) => ({ phone: '0470111222', email: '', notes: '', occasion: '', date: AUJOURD_HUI, duration: 0.5, totalDuration: 0.5, lanes: [], pax: 8, status: 'pending', type: 'laser', formuleId: '', label: 'Laser Game', laserGames: 1, extras: [], channel: 'staff', requiresLanes: false, centerId: 'libramont', ...champs });

  let browser = null;
  const captures = Boolean(argument('captures'));
  if (captures) fs.mkdirSync(CAPTURES, { recursive: true });
  // Une capture de 900 px de large au plus : la zone demandee, rognee a 900.
  async function capture(page, nom, selecteur) {
    if (!captures) return;
    let clip = null;
    if (selecteur) {
      const r = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; }, selecteur);
      if (r) {
        const vp = page.viewportSize();
        const x = Math.max(0, Math.floor(r.x - 8));
        const y = Math.max(0, Math.floor(r.y - 8));
        clip = { x, y, width: Math.min(900, Math.ceil(r.width + 16), vp.width - x), height: Math.min(Math.ceil(r.height + 16), vp.height - y) };
      }
    }
    if (!clip) { const vp = page.viewportSize(); clip = { x: 0, y: 0, width: Math.min(900, vp.width), height: vp.height }; }
    await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`), clip });
  }

  async function ouvrir({ appareil = 'comptoir', taux = true, reglage = 'jamais' } = {}) {
    globalThis.__comptoirMaintenant = FX.instant(AUJOURD_HUI, HEURE).getTime();
    const m = await FX.monter(browser, {
      fixture: FIXTURE, appareil, theme: 'light', port: PORT, heure: HEURE,
      avantChargement: async (page) => {
        await page.exposeFunction('__fixtureServeur', async (corps) => serveur.appeler('PATCH', '/api/staff-reservations', corps));
        await page.exposeFunction('__vraiAppel', async (methode, url, corps) => serveur.appeler(methode, url, corps));
      },
    });
    const { page } = m;
    page.setDefaultTimeout(12000);
    await page.evaluate(({ taux, reglage }) => {
      const avant = window.fetch;
      window.fetch = async (input, init) => {
        init = init || {};
        const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
        const me = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
        const json = (corps, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
        if (u.pathname === '/api/staff-reservations' && me !== 'PATCH') {
          const corps = init.body ? JSON.parse(init.body) : undefined;
          const rep = await window.__vraiAppel(me, u.pathname + u.search, corps);
          const j = rep.json || {};
          if (me === 'POST' && !(corps && corps.dryRun) && j.reservation) {
            const jour = j.reservation.date;
            (window.__FIXTURE__.jours[jour] = window.__FIXTURE__.jours[jour] || []).push(j.reservation);
          }
          return json(j, rep.statut);
        }
        return avant(input, init);
      };
      // Les taux de TVA du centre et son reglage « Prix hors TVA à l’ouverture », comme la page Etablissement les sert.
      const centre = staffCenterConfigCache && Array.isArray(staffCenterConfigCache.centers) ? staffCenterConfigCache.centers.find((c) => c && c.id === 'libramont') : null;
      if (centre) { if (taux) centre.vatRates = { ...taux }; else delete centre.vatRates; centre.htvaParDefaut = reglage; }
      state.staffTva = taux ? { ...taux } : null;
      state.staffHtvaParDefaut = reglage;
    }, { taux: taux ? TAUX : null, reglage });
    await page.waitForSelector('.btn-new', { timeout: 15000 });
    return { ...m, avant: new Set([...B.base.reservations.keys()]) };
  }
  const texte = (page, sel) => page.evaluate((s) => Array.from(document.querySelectorAll(s)).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '), sel);
  const pret = (page) => page.waitForFunction(() => { const b = document.querySelector('#rvCreer'); return b && b.dataset.pret === '1'; }, null, { timeout: 15000 });
  async function nouveaux(page, avant) {
    for (let i = 0; i < 80; i += 1) {
      const lignes = [...B.base.reservations.entries()].filter(([id]) => !avant.has(id)).map(([, r]) => r);
      if (lignes.length) return lignes;
      await page.waitForTimeout(100);
    }
    return [];
  }
  // Reserver, demain, N joueurs au laser a 14:00.
  async function laserDemain(page, { joueurs = 8, heure = '14:00' } = {}) {
    await page.locator('.btn-new').first().click();
    await page.waitForSelector('#qbPax');
    await page.locator('.qb-modal.rv button', { hasText: /^Demain$/ }).first().click();
    await page.waitForFunction((j) => quickBookState && quickBookState.date === j, DEMAIN);
    await page.locator('#qbPax').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(String(joueurs));
    await page.keyboard.press('Tab');
    await page.waitForFunction((n) => quickBookState && Number(quickBookState.pax) === n, joueurs);
    await page.locator('#rsAjout-laser_game').click();
    await page.waitForSelector('.rs-seance [data-activite="laser_game"][data-heure]');
    await page.locator(`.rs-seance [data-activite="laser_game"][data-heure="${heure}"]`).first().click();
    await pret(page).catch(() => {});
  }
  const fenetre = (page) => page.evaluate(() => {
    const f = document.querySelector('#factureFenetre .fa-fenetre');
    if (!f) return null;
    const v = {};
    f.querySelectorAll('input, select').forEach((c) => { v[c.name] = c.value; });
    const msg = {};
    f.querySelectorAll('.fa-msg').forEach((m) => { if (!m.hidden && m.textContent.trim()) msg[m.id.replace('faErr-', '')] = m.textContent.trim(); });
    return {
      titre: (f.querySelector('#faTitre') || {}).textContent || '',
      focus: document.activeElement ? document.activeElement.id : '',
      valeurs: v,
      messages: msg,
      bandeau: (() => { const b = f.querySelector('#faErreur'); return b && !b.hidden ? b.textContent.trim() : ''; })(),
      aideTva: ((f.querySelector('#faAide-tva') || {}).textContent || '').trim(),
      invalide: Array.from(f.querySelectorAll('[aria-invalid="true"]')).map((c) => c.name),
      groupes: Array.from(f.querySelectorAll('.fa-legende')).map((l) => l.textContent.trim()),
      principal: ((f.querySelector('#faValider') || {}).textContent || '').trim(),
      montant: ((f.querySelector('#faMontant') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      rect: (() => { const b = f.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), bas: Math.round(b.bottom) }; })(),
    };
  });
  async function remplir(page, valeurs) {
    for (const [cle, valeur] of Object.entries(valeurs)) {
      const champ = page.locator(`#faChamp-${cle}`);
      if (cle === 'pays') { await champ.selectOption(valeur); continue; }
      await champ.fill('');
      await champ.type(valeur);
    }
  }
  // La fiche d un dossier, ouverte sur Infos : son statut, la caisse, le bloc de la facture.
  const fiche = (page) => page.evaluate(() => {
    const m = document.querySelector('#posOverlay');
    if (!m) return null;
    const caisse = m.querySelector('.fz-caisse');
    const fact = m.querySelector('.fz-facture');
    return {
      ouverte: Boolean(m.querySelector('.fz-caisse')),
      statut: ((m.querySelector('.fz-statut .fz-statut-mot') || {}).textContent || '').trim(),
      boutonsStatut: m.querySelectorAll('.fz-statut button').length,
      argent: caisse ? ((caisse.querySelector('.pos-act-money') || {}).textContent || '').replace(/\s+/g, ' ').trim() : '',
      payer: caisse ? Array.from(caisse.querySelectorAll('.fz-payer button, .fz-facturer-r button')).map((b) => `${b.textContent.trim()}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`) : [],
      etats: caisse ? Array.from(caisse.querySelectorAll('.gc-sheet-states button')).map((b) => b.textContent.trim()) : [],
      facture: fact ? fact.textContent.replace(/\s+/g, ' ').trim() : '',
    };
  });
  // Le menu du statut de la fiche, ouvert : ses choix (« arrived* » : le statut du dossier).
  const menuDuStatut = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#posOverlay .staff-action-popover [data-statut-choix]')).map((b) => `${b.getAttribute('data-statut-choix')}${b.classList.contains('is-actuel') ? '*' : ''}`));
  async function choisirStatut(page, id, valeur) {
    await page.locator(`#ficheStatut${id}`).click();
    await page.waitForSelector('#posOverlay .staff-action-popover [data-statut-choix]');
    await page.locator(`#posOverlay .staff-action-popover [data-statut-choix="${valeur}"]`).click();
  }
  async function semerDossier(champs = {}) {
    const rep = await serveur.appeler('POST', '/api/staff-reservations', corpsLaser(champs));
    return rep.json && rep.json.reservation;
  }
  async function poserDansLaConsole(page, dossiers) {
    await page.evaluate((liste) => {
      const jour = window.__FIXTURE__.jours[window.__FIXTURE__.jour];
      liste.forEach((d) => { jour.push({ ...d }); state.reservations.push({ ...d }); });
      renderStaff();
    }, dossiers);
  }
  async function ouvrirFiche(page, id) {
    await page.evaluate((i) => { if (typeof closePos === 'function') closePos(); openPos(i); }, id);
    await page.waitForSelector('#posOverlay .fz-caisse', { timeout: 12000 });
    await page.waitForTimeout(300);
  }
  async function attendre(condition, page, tours = 80) {
    for (let i = 0; i < tours; i += 1) {
      if (condition()) return true;
      await page.waitForTimeout(100);
    }
    return false;
  }

  const navigateur = ['R', 'T', 'D', 'F', 'P'].some(joue);
  if (navigateur) {
    const { chromium } = require('playwright-core');
    browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  }
  const http = navigateur ? await FX.servir({ port: PORT, transformer }) : null;
  try {
    // =======================================================================
    if (joue('S')) {
      section('[S] LE SERVEUR : LA REGLE DE LA TVA, LE GESTE « FACTURÉ », LA CREATION ET L EXPORT');
      globalThis.__comptoirMaintenant = FX.instant(AUJOURD_HUI, HEURE).getTime();
      B.semer([]);
      serveur.changerSession(DIRECTION);
      const tva = ['BE0123456749', 'be 0123.456.749', '123.456.749', 'BE0123456789', 'BE2123456749', 'FR12345678901', 'NL123456789B01', 'US123456789', 'BE01234567'].map((t) => { const l = F.lireTva(t); return l.ok ? l.valeur : 'non'; });
      ok(JSON.stringify(tva) === JSON.stringify(['BE0123456749', 'BE0123456749', 'BE0123456749', 'non', 'non', 'FR12345678901', 'NL123456789B01', 'non', 'non']),
        '[S] la TVA : BE 0123.456.749 passe (et l ancien numero a 9 chiffres), BE0123456789 non (le modulo 97), un numero francais ou neerlandais oui, hors UE non', tva);
      const vide = F.lireFacturation({});
      ok(!vide.ok && JSON.stringify(Object.keys(vide.erreurs)) === JSON.stringify(['societe', 'rue', 'codePostal', 'ville', 'email']) && vide.premier === 'societe',
        '[S] obligatoires : la societe, la rue, le code postal, la ville et l e-mail ; la TVA, le contact et la reference sont facultatifs', vide.erreurs);
      const d = await semerDossier({ name: 'Groupe Serveur', startTime: '18:00' });
      ok(Boolean(d && d.id), 'MONTAGE un dossier au laser, aujourd hui a 18:00', d);
      if (d) {
        const id = d.id;
        const patch = (corps) => serveur.appeler('PATCH', '/api/staff-reservations', { id, centerId: 'libramont', baseUpdatedAt: version(id), ...corps });
        const faux = await patch({ facturation: { ...LAMBERT, tva: 'BE0123456789' } });
        ok(faux.statut === 422 && faux.json.champ === 'tva' && /un chiffre est faux/.test(faux.json.message || '') && !factureDe(ligneDe(id)),
          '[S] un numero de TVA faux : 422 sur le champ tva, la phrase simple, rien ne s ecrit', { statut: faux.statut, json: faux.json });
        const sansMail = await patch({ facturation: { ...LAMBERT, email: '' } });
        ok(sansMail.statut === 422 && sansMail.json.champ === 'email', '[S] sans e-mail : 422 sur le champ email', { statut: sansMail.statut, json: sansMail.json });
        const sansDroit = B.sessionDuRole('manager', { nom: 'Accueil' });
        serveur.changerSession({ ...sansDroit, permissions: sansDroit.permissions.filter((p) => p !== 'payments.markPaid') });
        const refus = await patch({ facturation: LAMBERT });
        serveur.changerSession(DIRECTION);
        ok(refus.statut === 403 && !factureDe(ligneDe(id)), '[S] sans le droit d encaisser : 403, rien ne s ecrit', { statut: refus.statut, json: refus.json });
        const bon = await patch({ facturation: LAMBERT });
        const r1 = ligneDe(id);
        const f1 = factureDe(r1);
        ok(bon.statut === 200 && r1.status === 'pending' && !r1.payment_method && !r1.paid_at && f1 && f1.societe === 'Lambert SA' && f1.tva === 'BE0123456749' && f1.codePostal === '6800' && f1.email === 'compta@lambert.be' && f1.par === 'Accueil' && lignesFacture(r1) === 1,
          '[S] « Facturé » : 200, le dossier reste confirme, sans moyen ni date de paiement, sa facture en une ligne signee de la session', { statut: bon.statut, status: r1.status, moyen: r1.payment_method, f1 });
        const encore = await patch({ facturation: { ...LAMBERT, reference: 'PO-2' } });
        ok(encore.statut === 200 && lignesFacture(ligneDe(id)) === 1 && factureDe(ligneDe(id)).reference === 'PO-2', '[S] une facture modifiee remplace l ancienne : une seule ligne', { statut: encore.statut, lignes: lignesFacture(ligneDe(id)) });
        // Une ligne « facture » glissee dans les notes d une modification : resignee sans ses champs, la vraie reste.
        const forge = `${ligneDe(id).notes}\n[equipe] ${JSON.stringify({ t: 'À facturer : Faux SA', type: 'facture', facture: { ...LAMBERT, societe: 'Faux SA' }, par: 'Quelqu un', le: '2020-01-01T00:00:00.000Z' })}`;
        const modif = await patch({ ...corpsLaser({ name: 'Groupe Serveur', startTime: '18:00' }), notes: forge });
        const r2 = ligneDe(id);
        ok(modif.statut === 200 && factureDe(r2) && factureDe(r2).societe === 'Lambert SA' && lignesFacture(r2) === 1,
          '[S] une ligne « facture » forgee dans les notes d une modification perd ses champs : la facture reste celle du serveur', { statut: modif.statut, json: modif.json.error || modif.json.message, facture: factureDe(r2), lignes: lignesFacture(r2) });
        const retire = await patch({ facturation: null });
        ok(retire.statut === 200 && !factureDe(ligneDe(id)) && ligneDe(id).status === 'pending', '[S] `null` retire la facturation', { statut: retire.statut });
        // A la creation.
        const creeFacture = await serveur.appeler('POST', '/api/staff-reservations', { ...corpsLaser({ name: 'Groupe Créé', startTime: '19:00' }), facturation: LAMBERT });
        const c = creeFacture.json && creeFacture.json.reservation;
        const rc = c ? ligneDe(c.id) : null;
        ok(creeFacture.statut === 201 && rc && rc.status === 'pending' && !rc.payment_method && factureDe(rc) && factureDe(rc).societe === 'Lambert SA',
          '[S] a la creation, « Facturé » pose la facture, le dossier reste confirme', { statut: creeFacture.statut, json: creeFacture.json.message, rc: rc && { status: rc.status, notes: rc.notes } });
        const creeFaux = await serveur.appeler('POST', '/api/staff-reservations', { ...corpsLaser({ name: 'Groupe Faux', startTime: '20:00' }), facturation: { ...LAMBERT, tva: 'BE0123456789' } });
        ok(creeFaux.statut === 422 && ![...B.base.reservations.values()].some((x) => x.name === 'Groupe Faux'), '[S] a la creation, une TVA fausse : 422, rien ne se cree', { statut: creeFaux.statut, json: creeFaux.json });
        serveur.changerSession({ ...sansDroit, permissions: sansDroit.permissions.filter((p) => p !== 'payments.markPaid') });
        const creeSansDroit = await serveur.appeler('POST', '/api/staff-reservations', { ...corpsLaser({ name: 'Groupe Sans Droit', startTime: '20:30' }), facturation: LAMBERT });
        serveur.changerSession(DIRECTION);
        ok(creeSansDroit.statut === 403 && ![...B.base.reservations.values()].some((x) => x.name === 'Groupe Sans Droit'), '[S] a la creation, sans le droit d encaisser : 403, rien ne se cree', { statut: creeSansDroit.statut });
        // L export Excel du jour.
        const ex = require(path.join(ROOT, EXPORT));
        const zip = require(path.join(ROOT, 'lib/xlsx-writer.js'));
        const lus = [...B.base.reservations.values()].map((row) => require(path.join(ROOT, BASE)).mapReservation ? require(path.join(ROOT, BASE)).mapReservation(row) : null).filter(Boolean);
        const tout = zip.lireZip(ex.construireClasseurJour(lus, { date: AUJOURD_HUI })).map((e) => e.donnees.toString('utf8')).join('\n');
        ok(/>Facturé</.test(tout) && /Facture : Lambert SA, TVA BE 0123\.456\.749, Rue de la Gare 12, 6800 Libramont, Belgique, compta@lambert\.be/.test(tout),
          '[S] l export Excel : « Facturé » dans le moyen de paiement, la facture entiere dans les notes', tout.match(/Factur[^<]{0,120}/g));
      }
    }

    // =======================================================================
    if (joue('R')) {
      section('[R] RESERVER, « FACTURÉ » : LA FENETRE, SES CHAMPS, PUIS LE DOSSIER « À FACTURER »');
      B.semer([]);
      const { ctx, page, erreurs, avant } = await ouvrir();
      try {
        await laserDemain(page);
        await page.locator('#qbPhone').fill('0470 12 34 56');
        await page.locator('#qbName').fill('Groupe Lambert');
        await page.waitForTimeout(400);
        await pret(page).catch(() => {});
        const pied = await page.evaluate(() => Array.from(document.querySelectorAll('#rvPied .rs-tk-pay button')).map((b) => `${b.textContent.trim()}${b.disabled ? '' : '+'}`));
        ok(JSON.stringify(pied) === JSON.stringify(['Payé carte', 'Payé espèces', 'Facturé+']), '[R] le ticket : Payé carte, Payé espèces, Facturé ; demain, seul Facturé se touche', pied);
        await capture(page, 'ticket-facture', '.qb-modal.rv .rs-tk');
        // Echap ferme sans rien garder, le focus revient a « Facturé ».
        await page.locator('#rvFacturer').click();
        await page.waitForSelector('#factureFenetre .fa-fenetre');
        let w = await fenetre(page);
        ok(w && w.titre === 'Facturer à une société' && w.focus === 'faChamp-societe' && w.valeurs.contact === 'Groupe Lambert' && w.valeurs.pays === 'BE'
          && JSON.stringify(w.groupes) === JSON.stringify(['Société', 'Adresse de facturation', 'Contact', 'Référence']) && w.principal === 'Créer, à facturer' && /TVA comprise/.test(w.montant),
        '[R] la fenetre : quatre groupes, le focus sur la raison sociale, le contact deja rempli, la Belgique, le montant TVA comprise, « Créer, à facturer »', w);
        await capture(page, 'fenetre-vide', '#factureFenetre .fa-fenetre');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('#factureFenetre'));
        const apresEchap = await page.evaluate(() => (document.activeElement || {}).id || '');
        ok(apresEchap === 'rvFacturer' && B_vide(), '[R] Echap ferme la fenetre, rien ne se cree, le focus revient a « Facturé »', apresEchap);
        function B_vide() { return [...B.base.reservations.keys()].every((k) => avant.has(k)); }
        // Un numero de TVA faux, puis Entree avec des champs vides.
        await page.locator('#rvFacturer').click();
        await page.waitForSelector('#factureFenetre .fa-fenetre');
        await page.locator('#faChamp-tva').fill('BE0123456789');
        await page.keyboard.press('Tab');
        w = await fenetre(page);
        ok(/un chiffre est faux/.test(w.messages.tva || '') && w.invalide.includes('tva'), '[R] un numero de TVA faux se dit sous son champ, en mots simples, le champ marque', w.messages);
        await capture(page, 'erreur-tva', '#factureFenetre .fa-fenetre');
        await page.locator('#faChamp-societe').focus();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        w = await fenetre(page);
        ok(w && /^6 champs sont à compléter\.$/.test(w.bandeau) && w.focus === 'faChamp-societe' && w.messages.societe === 'Indiquez le nom de la société.' && w.messages.email && B_vide(),
          '[R] Entree avec des champs vides : « 6 champs sont à compléter », chacun dit ce qui manque, le focus sur le premier, rien ne se cree', w);
        await remplir(page, LAMBERT);
        await page.waitForTimeout(200);
        w = await fenetre(page);
        ok(w.aideTva === 'Numéro valide : BE 0123.456.749' && !Object.keys(w.messages).length, '[R] remplie : « Numéro valide : BE 0123.456.749 », plus aucun message', { aide: w.aideTva, messages: w.messages });
        await capture(page, 'fenetre-remplie', '#factureFenetre .fa-fenetre');
        const prix = await page.evaluate(() => (rvPlanCourant() || {}).prix);
        await page.locator('#faChamp-reference').focus();
        await page.keyboard.press('Enter');
        const [r] = await nouveaux(page, avant);
        await page.waitForTimeout(500);
        const f = factureDe(r);
        const toast = await texte(page, '#toast');
        ok(r && r.date === DEMAIN && r.status === 'pending' && !r.payment_method && !r.paid_at && Number(r.price) === Number(prix) && Number(prix) > 0
          && f && f.societe === 'Lambert SA' && f.tva === 'BE0123456749' && f.rue === 'Rue de la Gare 12' && f.codePostal === '6800' && f.ville === 'Libramont' && f.pays === 'BE' && f.email === 'compta@lambert.be' && f.contact === 'Julie Lambert' && f.reference === 'PO-2026-118',
        '[R] Entree cree le dossier : demain, confirme, ni paye ni moyen, son prix, sa facture complete en note', r && { date: r.date, status: r.status, moyen: r.payment_method, prix: [r.price, prix], f });
        ok(/Réservation créée · à facturer, Lambert SA/.test(toast) && !(await page.$('#factureFenetre')), '[R] la fenetre est fermee, le toast le dit', toast);
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (R)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('T')) {
      section('[T] RESERVER, TVAC OU HTVA : LE TOTAL ET LE PRIX PAR JOUEUR, LUS ET TAPES HORS TVA');
      B.semer([]);
      const { ctx, page, erreurs, avant } = await ouvrir();
      try {
        await laserDemain(page);
        const lirePied = () => page.evaluate(() => ({
          tvac: (document.querySelector('#rvTva-tvac') || {}).ariaPressed || (document.querySelector('#rvTva-tvac') || { getAttribute() { return ''; } }).getAttribute('aria-pressed'),
          htva: (document.querySelector('#rvTva-htva') || { getAttribute() { return ''; } }).getAttribute('aria-pressed'),
          total: ((document.querySelector('#rsL-total') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
          montant: ((document.querySelector('#rvTotalPied') || {}).textContent || '').trim(),
          prix: (rvPlanCourant() || {}).prix,
        }));
        let p = await lirePied();
        const total = Number(p.prix);
        const htva = Math.round((total - Math.round((total - total / 1.06) * 100) / 100) * 100) / 100;
        ok(p.tvac === 'true' && p.htva === 'false' && total > 0 && new RegExp(`^Total.*${euros(total).replace(',00', '(,00)?')} €$`).test(p.total) && !/HTVA/.test(p.total),
          '[T] « Prix TVAC | HTVA » au ticket, TVAC par defaut (le reglage « Jamais »), le total TVA comprise', p);
        await capture(page, 'ticket-tvac', '.qb-modal.rv .rs-tk');
        await page.locator('#rvTva-htva').click();
        await page.waitForFunction(() => /HTVA/.test((document.querySelector('#rsL-total') || {}).textContent || ''));
        p = await lirePied();
        const parJoueur = euros(Math.round((htva / 8) * 100) / 100);
        ok(p.htva === 'true' && p.total.startsWith('Total HTVA') && p.montant.replace(/\s/g, ' ') === `${euros(htva)} €` && p.total.includes(`${parJoueur} € par joueur HTVA`) && p.total.includes(`${euros(total).replace(',00', '')} € TVAC`),
          `[T] HTVA : le total ${euros(htva)} € hors TVA (taux des activites, 6 %), ${parJoueur} € par joueur HTVA, le TVA comprise rappele`, { p, attendu: euros(htva) });
        await capture(page, 'ticket-htva', '.qb-modal.rv .rs-tk');
        // Un total tape hors TVA : 100 HTVA, enregistre a 106 TVAC.
        await page.locator('#rsL-total').click();
        await page.waitForSelector('#qbCustomPrice');
        const etiquettes = await texte(page, '.rs-seance.is-total .rs-champ:has(#qbCustomPrice) > span, .rs-seance.is-total .rs-champ:has(#qbCustomPricePerPerson) > span');
        await page.locator('#qbCustomPrice').fill('100');
        await page.waitForTimeout(250);
        const saisi = await page.evaluate(() => ({ custom: quickBookState.customPrice, ligne: ((document.querySelector('#rsPrixTva') || {}).textContent || '').trim() }));
        ok(etiquettes === 'Total HTVA | Par joueur HTVA' && Number(saisi.custom) === 106, '[T] la page du total : « Total HTVA », « Par joueur HTVA » ; 100 tapes hors TVA gardent 106 TVA comprise', { etiquettes, saisi });
        await page.locator('#rsRaison-0').click();
        await page.locator('#qbPhone').fill('0470 12 34 56');
        await page.waitForTimeout(400);
        await pret(page).catch(() => {});
        await page.locator('#rvCreer').click();
        const [r] = await nouveaux(page, avant);
        ok(r && Number(r.price) === 106 && Number(r.base_price) === total, '[T] le dossier s enregistre TVA comprise : 106 €, la reference au catalogue', r && { prix: r.price, base: r.base_price });
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (T)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('D')) {
      section('[D] UNE DEMANDE DE GROUPE : SA SOCIETE ET SA TVA PREREMPLISSENT, LE REGLAGE « LES GROUPES » OUVRE EN HTVA');
      B.semer([]);
      const { ctx, page, erreurs } = await ouvrir({ reglage: 'groupes' });
      try {
        await page.evaluate((jour) => openQuickBook({ name: 'Mme Dupont', email: 'dupont@ecole.be', date: jour, type: 'laser', pax: 12, facturation: { societe: 'École Saint-Joseph', tva: 'BE0123456749' } }), DEMAIN);
        await page.waitForSelector('.rs-seance [data-activite="laser_game"][data-heure]');
        await page.locator('.rs-seance [data-activite="laser_game"][data-heure="14:00"]').first().click();
        await pret(page).catch(() => {});
        const vu = await page.evaluate(() => (document.querySelector('#rvTva-htva') || { getAttribute() { return ''; } }).getAttribute('aria-pressed'));
        ok(vu === 'true', '[D] une societe connue et le reglage « Les groupes seulement » : le ticket s ouvre en HTVA', vu);
        // (la demande a un e-mail : le contact se lit par mail, sans telephone a remplir)
        if (await page.locator('#qbPhone').count()) await page.locator('#qbPhone').fill('0470 12 34 56');
        await page.waitForTimeout(300);
        await pret(page).catch(() => {});
        await page.locator('#rvFacturer').click();
        await page.waitForSelector('#factureFenetre .fa-fenetre');
        const w = await fenetre(page);
        ok(w && w.valeurs.societe === 'École Saint-Joseph' && w.valeurs.tva === 'BE 0123.456.749' && w.valeurs.contact === 'Mme Dupont' && w.valeurs.email === 'dupont@ecole.be' && w.focus === 'faChamp-rue',
          '[D] la fenetre reprend la societe, la TVA (ecrite comme sur une facture), le nom et l e-mail, et s ouvre sur la rue, le premier champ vide', w);
        await page.keyboard.press('Escape');
        await page.evaluate(() => closeQuickBook());
        await page.waitForTimeout(300);
        await page.evaluate((jour) => openQuickBook({ name: 'Famille Martin', date: jour, type: 'laser', pax: 6 }), DEMAIN);
        await page.waitForSelector('.rs-seance [data-activite="laser_game"][data-heure]');
        await page.locator('.rs-seance [data-activite="laser_game"][data-heure="14:00"]').first().click();
        await pret(page).catch(() => {});
        const vu2 = await page.evaluate(() => (document.querySelector('#rvTva-tvac') || { getAttribute() { return ''; } }).getAttribute('aria-pressed'));
        ok(vu2 === 'true', '[D] sans societe ni groupe, le meme reglage garde le ticket en TVAC', vu2);
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (D)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('F')) {
      section('[F] LA FICHE ET LE PLANNING : LE STATUT D UN COUP D OEIL, « FACTURÉ » DANS LA CAISSE, « À FACTURER » PARTOUT');
      globalThis.__comptoirMaintenant = FX.instant(AUJOURD_HUI, HEURE).getTime();
      B.semer([]);
      serveur.changerSession(DIRECTION);
      const d = await semerDossier({ name: 'Groupe Fiche', startTime: '17:00', email: 'julie@lambert.be' });
      ok(Boolean(d && d.id), 'MONTAGE un dossier au laser, aujourd hui a 17:00', d);
      if (d) {
        const id = d.id;
        const { ctx, page, erreurs } = await ouvrir();
        page.on('dialog', (x) => x.accept().catch(() => {}));
        try {
          await poserDansLaConsole(page, [d]);
          await ouvrirFiche(page, id);
          let fi = await fiche(page);
          ok(fi.statut === 'Confirmé' && fi.boutonsStatut === 1 && JSON.stringify(fi.payer) === JSON.stringify(['Payé · Carte', 'Payé · Espèces', 'Facturé']) && JSON.stringify(fi.etats) === JSON.stringify(['Payé · Carte', 'Payé · Espèces', 'Facturé']) && /^À encaisser/.test(fi.argent),
            '[F] la fiche dit son statut d un coup d oeil (« Confirmé », un seul bouton) ; la caisse a Payé · Carte, Payé · Espèces, puis Facturé', fi);
          await capture(page, 'fiche-avant', '#posOverlay .fx');
          await page.locator(`#ficheStatut${id}`).click();
          await page.waitForSelector('#posOverlay .staff-action-popover [data-statut-choix]');
          const menu0 = await menuDuStatut(page);
          const focus0 = await page.evaluate(() => (document.activeElement && document.activeElement.getAttribute('data-statut-choix')) || '');
          ok(JSON.stringify(menu0) === JSON.stringify(['pending*', 'arrived', 'paid:Carte Bancaire', 'paid:Espèces', 'facture']) && focus0 === 'pending',
            '[F] son bouton ouvre la liste du menu du planning : Confirmé (coche, le focus dessus), Arrivé, Payé carte, Payé espèces, Facturé', { menu0, focus0 });
          await capture(page, 'fiche-statut-menu', '#posOverlay .fx');
          await page.keyboard.press('Escape');
          await page.waitForTimeout(250);
          const apresEchap = await fiche(page);
          const focusEchap = await page.evaluate(() => (document.activeElement || {}).id || '');
          ok(apresEchap && apresEchap.ouverte && !(await page.$('.staff-action-popover')) && focusEchap === `ficheStatut${id}`, '[F] Echap ferme la liste, pas la fiche, et rend le focus au statut', { ouverte: apresEchap && apresEchap.ouverte, focusEchap });
          await page.locator('#posOverlay .fz-facturer').click();
          await page.waitForSelector('#factureFenetre .fa-fenetre');
          let w = await fenetre(page);
          ok(w && w.valeurs.contact === 'Groupe Fiche' && w.valeurs.email === 'julie@lambert.be' && w.focus === 'faChamp-societe' && w.principal === 'Enregistrer, à facturer', '[F] « Facturé » de la caisse ouvre la fenetre, le nom et l e-mail du dossier deja dedans', w);
          await remplir(page, LAMBERT);
          const v0 = version(id);
          await page.locator('#faValider').click();
          await attendre(() => version(id) !== v0, page);
          await page.waitForFunction(() => !document.querySelector('#factureFenetre'));
          await page.waitForTimeout(400);
          const r1 = ligneDe(id);
          fi = await fiche(page);
          ok(r1.status === 'pending' && !r1.payment_method && factureDe(r1) && factureDe(r1).societe === 'Lambert SA', '[F] enregistre : le dossier reste confirme, sans moyen, sa facture en base', { status: r1.status, moyen: r1.payment_method, f: factureDe(r1) });
          ok(/^À facturer/.test(fi.argent) && fi.statut === 'Confirmé · Facturé' && fi.payer.includes('Facturé*')
            && /^À facturer/.test(fi.facture) && fi.facture.includes('Lambert SA, TVA BE 0123.456.749') && fi.facture.includes('Rue de la Gare 12, 6800 Libramont, Belgique') && fi.facture.includes('compta@lambert.be') && fi.facture.includes('PO-2026-118'),
          '[F] la fiche dit « À facturer », son statut « Confirmé · Facturé », Facturé enfonce, et le bloc de la facture : societe, TVA, adresse, e-mail, reference', fi);
          await capture(page, 'fiche-a-facturer', '#posOverlay .fx');
          // Arrivé, depuis le statut de la fiche.
          const v1 = version(id);
          await choisirStatut(page, id, 'arrived');
          await attendre(() => version(id) !== v1, page);
          await page.waitForTimeout(400);
          fi = await fiche(page);
          ok(ligneDe(id).status === 'arrived' && fi.statut === 'Arrivé · Facturé', '[F] Arrivé depuis le statut de la fiche : le dossier est arrive, toujours a facturer', { status: ligneDe(id).status, statut: fi.statut });
          // La facture se modifie : une seule ligne.
          await page.locator('#posOverlay .fz-facture-modifier').click();
          await page.waitForSelector('#factureFenetre .fa-fenetre');
          w = await fenetre(page);
          ok(w.titre === 'Facturation du dossier' && w.valeurs.societe === 'Lambert SA' && w.valeurs.tva === 'BE 0123.456.749' && w.valeurs.reference === 'PO-2026-118' && Boolean(await page.$('#faRetirer')), '[F] « Modifier » rouvre la facture telle qu enregistree, avec « Ne plus facturer »', w);
          await page.locator('#faChamp-reference').fill('PO-2026-200');
          const v2 = version(id);
          await page.keyboard.press('Enter');
          await attendre(() => version(id) !== v2, page);
          await page.waitForTimeout(300);
          ok(lignesFacture(ligneDe(id)) === 1 && factureDe(ligneDe(id)).reference === 'PO-2026-200', '[F] la reference changee : une seule ligne de facture, la nouvelle', { lignes: lignesFacture(ligneDe(id)), f: factureDe(ligneDe(id)) });
          // Le planning : la ligne dit « à facturer », son menu a Facturé.
          await page.evaluate(() => { if (typeof closePos === 'function') closePos(); renderStaff(); });
          await page.waitForSelector(`#globalPlanningGridWrap .gf-r[data-gf-id="${id}"]`, { timeout: 12000 });
          const ligne = await texte(page, `#globalPlanningGridWrap .gf-r[data-gf-id="${id}"] .gf-reste`);
          ok(/à facturer/.test(ligne) && !(await page.$(`#globalPlanningGridWrap .gf-r[data-gf-id="${id}"] [data-gf-encaisser]`)), '[F] la ligne du planning dit « à facturer », sans bouton pour encaisser', ligne);
          await capture(page, 'planning-a-facturer', `#globalPlanningGridWrap .gf-r[data-gf-id="${id}"]`);
          if (captures) {
            const b = await page.evaluate((i) => { const e = document.querySelector(`#globalPlanningGridWrap .gf-r[data-gf-id="${i}"]`); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { y: r.top }; }, id);
            await page.screenshot({ path: path.join(CAPTURES, 'planning-a-facturer.png'), clip: { x: 0, y: Math.max(0, Math.floor(b.y - 120)), width: 900, height: 300 } });
          }
          await page.locator(`#globalPlanningGridWrap [data-gf-statut="${id}"]`).first().click();
          await page.waitForSelector('[data-gf-choix="facture"]');
          const menu = await page.evaluate(() => Array.from(document.querySelectorAll('[data-gf-choix]')).map((b) => `${b.getAttribute('data-gf-choix')}${b.classList.contains('is-actuel') ? '*' : ''}`));
          ok(menu.includes('arrived*') && menu.includes('facture*') && menu.includes('paid:Carte Bancaire') && menu.includes('fiche'), '[F] le menu du statut de la ligne : la meme liste que la fiche, Arrivé et Facturé coches', menu);
          await page.keyboard.press('Escape');
          // Payé carte ensuite : paye, la facture garde son nom.
          await ouvrirFiche(page, id);
          const v3 = version(id);
          await choisirStatut(page, id, 'paid:Carte Bancaire');
          await attendre(() => version(id) !== v3, page);
          await page.waitForTimeout(400);
          fi = await fiche(page);
          ok(ligneDe(id).status === 'paid' && ligneDe(id).payment_method === 'Carte Bancaire' && fi.statut === 'Payé carte' && /^Facture au nom de/.test(fi.facture),
            '[F] Payé carte ensuite : le dossier est paye par carte, son statut le dit, le bloc dit « Facture au nom de »', { status: ligneDe(id).status, moyen: ligneDe(id).payment_method, fi });
          // Confirmé de nouveau, d un paye : la meme regle que le menu du planning (le serveur juge).
          const v4 = version(id);
          await choisirStatut(page, id, 'pending');
          await attendre(() => version(id) !== v4, page);
          await page.waitForTimeout(400);
          fi = await fiche(page);
          ok(ligneDe(id).status === 'pending' && fi.statut === 'Confirmé · Facturé', '[F] « Confirmé » se choisit aussi depuis un dossier paye : il redevient confirme, a facturer', { status: ligneDe(id).status, statut: fi.statut });
          ok(erreurs.length === 0, '[*] zero erreur JavaScript (F)', erreurs.slice(0, 3).join(' | '));
        } finally { await ctx.close(); }
      }
    }

    // =======================================================================
    if (joue('P')) {
      section('[P] AU TELEPHONE : LA FENETRE MONTE DU BAS, PLEINE LARGEUR, AU DOIGT');
      globalThis.__comptoirMaintenant = FX.instant(AUJOURD_HUI, HEURE).getTime();
      B.semer([]);
      const d = await semerDossier({ name: 'Groupe Téléphone', startTime: '17:30' });
      if (d) {
        const { ctx, page, erreurs } = await ouvrir({ appareil: 'mobile' });
        try {
          await poserDansLaConsole(page, [d]);
          await ouvrirFiche(page, d.id);
          await page.locator('#posOverlay .fz-facturer').scrollIntoViewIfNeeded();
          await page.locator('#posOverlay .fz-facturer').click();
          await page.waitForSelector('#factureFenetre .fa-fenetre');
          await page.waitForTimeout(500);
          const w = await fenetre(page);
          const tailles = await page.evaluate(() => ({
            champs: Math.min(...Array.from(document.querySelectorAll('#factureFenetre input, #factureFenetre select')).map((c) => c.getBoundingClientRect().height)),
            boutons: Array.from(document.querySelectorAll('#factureFenetre .fa-pied .rt-bouton')).map((b) => Math.round(b.getBoundingClientRect().width)),
            largeur: document.documentElement.clientWidth,
            deborde: document.querySelector('#factureFenetre .fa-fenetre').scrollWidth > document.querySelector('#factureFenetre .fa-fenetre').clientWidth,
          }));
          ok(w && w.rect.x === 0 && w.rect.w === 390 && w.rect.bas === 844 && tailles.champs >= 44 && tailles.boutons.every((l) => l >= 340) && !tailles.deborde,
            '[P] au telephone : la fenetre fait toute la largeur, posee en bas, des champs de 44 px au moins, les boutons pleine largeur, rien ne deborde', { rect: w && w.rect, tailles });
          await capture(page, 'fenetre-telephone', null);
          ok(erreurs.length === 0, '[*] zero erreur JavaScript (P)', erreurs.slice(0, 3).join(' | '));
        } finally { await ctx.close(); }
      }
    }
  } catch (error) {
    ok(false, `exception : ${error.message}`, String(error.stack || '').split('\n').slice(0, 4).join(' | '));
  } finally {
    if (browser) await browser.close();
    if (http) http.close();
  }

  console.log(rouges
    ? `\nfacturation-check: ${rouges} ROUGE(S)`
    : '\nfacturation-check: ALL OK - « Facturé » ouvre une fenetre de facturation complete et laisse le dossier a facturer, jamais paye ; la fiche dit et change le statut d un toucher ; le ticket de Reserver se lit et se tape TVAC ou HTVA');
  process.exit(rouges ? 1 : 0);
}
