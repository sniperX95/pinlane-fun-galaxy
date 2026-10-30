#!/usr/bin/env node
'use strict';
// =============================================================================
// LA DEMANDE SUR MESURE
// -----------------------------------------------------------------------------
// Movsar, 2026-09-28 : « une section super clean super belle et pro pour
// demande sur mesure, pour les ecoles, ou quoi, et tout groupe superieur a 30,
// donc a partir de 31, tout groupe sera redirige vers une demande sur mesure
// ... ca sera gere directement par notre equipe ... une reponse max 24h
// ouvrable et ils peuvent pas reserver le jour meme prcq faut au moins 24h »,
// puis « il doit avoir son propre truc avec toutes formules dispo, si non
// pourquoi, choix des activites, un truc super complet ».
//
// LES REGLES ONT UNE SOURCE : lib/custom-request.js (le serveur), recopiee
// dans le formulaire sous les memes noms. Le seuil est une DONNEE du centre
// (customRequest.fromPax, reglee dans Etablissement).
//   [A] le formulaire tranche comme le serveur : moments du jour, 24 heures,
//       verdict de chaque formule et de chaque activite, sur une grille ;
//   [B] le serveur : une demande complete s enregistre, chaque manque est
//       refuse avec le champ a corriger, l ancienne fenetre marche encore ;
//       AUCUN e-mail ne part (accuse neutralise, aucune cle d envoi) ;
//   [C] la reservation en ligne refuse un groupe au seuil, et c est la
//       donnee du centre qui decide ;
//   [D] le catalogue public dit le seuil, les formules qu un centre ne peut
//       pas faire, les ages des activites ;
//   [E] le formulaire : le premier ecran oriente ; la demande vit dans un
//       module CHARGE A LA DEMANDE (rien de telecharge a 30 personnes,
//       precharge a 31, une panne du reseau dite en clair) ; un centre sans
//       seuil reserve en ligne jusqu a 240 ; les cinq ecrans de la demande,
//       leurs photos, les raisons des refus, l autre date, l envoi reel
//       (valide par le vrai gestionnaire, rien ecrit), l ecran final, le
//       telephone ;
//   [F] la console : le dossier de la demande dit tout, et Etablissement regle
//       le seuil ;
//   [G] contre-epreuves : chaque regle retiree, ce gate ROUGIT.
// =============================================================================
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const { Readable } = require('stream');

// AUCUN ENVOI, AUCUNE BASE : ce gate ne doit jamais ecrire a une vraie
// personne ni lire la production. Les cles sont retirees avant tout chargement.
delete process.env.RESEND_API_KEY;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.PINLANE_CALENDAR_SYNC = 'off';

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PINLANE_SUR_MESURE_PORT || 4391);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

let echecs = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return Boolean(cond);
}
function section(titre) { console.log(`\n[${titre}]`); }
function viderCache() { Object.keys(require.cache).forEach((cle) => { delete require.cache[cle]; }); }
async function attendre(page, fn, ms, arg) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (error) { return Boolean(await page.evaluate(fn, arg).catch(() => false)); }
}

// Le jour du centre (Bruxelles), et l instant ou il est `heure` h a Bruxelles.
function jourBruxelles(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function plusJours(jour, n) {
  const [y, m, d] = jour.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function instantBruxelles(jour, heure) {
  const [y, m, d] = jour.split('-').map(Number);
  for (let decalage = -3; decalage <= 3; decalage += 1) {
    const t = new Date(Date.UTC(y, m - 1, d, heure - decalage, 0, 0));
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(t);
    const lire = (k) => (parts.find((p) => p.type === k) || {}).value;
    if (`${lire('year')}-${lire('month')}-${lire('day')}` === jour && Number(lire('hour')) % 24 === heure) return t;
  }
  throw new Error(`instant introuvable pour ${jour} ${heure}h`);
}

// ---------------------------------------------------------------------------
// Le serveur, charge avec ses deux sorties neutralisees : l ecriture de la
// demande (gardee en memoire) et l accuse de reception (jamais envoye).
// ---------------------------------------------------------------------------
function chargerServeur() {
  viderCache();
  const database = require('../lib/database');
  const communications = require('../lib/ops-communications');
  const trace = { lignes: [], accuses: [] };
  database.createCustomRequest = async (input) => { trace.lignes.push(JSON.parse(JSON.stringify(input))); return { id: trace.lignes.length, ...input }; };
  communications.sendCustomRequestAck = async (r) => { trace.accuses.push(r); return { skipped: true, reason: 'gate : aucun envoi' }; };
  const meta = require('../api/public-booking-meta');
  const reservations = require('../api/public-reservations');
  const regles = require('../lib/custom-request');
  const opsKnowledge = require('../lib/ops-knowledge');
  const bookingConfig = require('../lib/booking-config');
  const catalogue = require('../lib/activity-catalog');
  return { meta, reservations, regles, opsKnowledge, bookingConfig, catalogue, trace };
}
let ip = 0;
function appel(handler, methode, url, corps) {
  const seaux = globalThis.__pinlaneRateBuckets;
  if (seaux) seaux.clear();
  return new Promise((resolve) => {
    const req = Readable.from(corps === undefined ? [] : [Buffer.from(JSON.stringify(corps))]);
    ip += 1;
    req.method = methode; req.url = url;
    req.headers = { host: 'localhost', 'content-type': 'application/json', 'x-forwarded-for': `10.9.${Math.floor(ip / 250)}.${ip % 250}` };
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      getHeader(k) { return this.headers[k.toLowerCase()]; },
      writeHead(c, h) { this.statusCode = c; if (h) Object.assign(this.headers, h); },
      end(txt) { let j = null; try { j = txt ? JSON.parse(String(txt)) : null; } catch (e) { j = null; } resolve({ status: this.statusCode, json: j }); },
    };
    Promise.resolve(handler(req, res)).catch((error) => resolve({ status: 599, json: { message: error.message } }));
  });
}

// ---------------------------------------------------------------------------
// [A] LE FORMULAIRE TRANCHE COMME LE SERVEUR
// Les fonctions du formulaire sont extraites de assets/fungalaxy-booking.js et
// nourries par SA chaine (entreeJour -> absorberCalendrier -> jourInfo), pas
// par le calendrier brut : c est ce que le client a vraiment sous les yeux.
// ---------------------------------------------------------------------------
// Une fonction, a toute indentation : de sa ligne `function nom(` a la
// premiere accolade fermante posee a la meme indentation.
function extraireFonction(source, nom) {
  const m = new RegExp(`\\n( *)function ${nom}\\(`).exec(source);
  if (!m) return '';
  const debut = m.index + 1;
  const retrait = m[1];
  const finLigne = source.indexOf('\n', debut);
  const ligne = source.slice(debut, finLigne);
  if (/\}\s*$/.test(ligne) && (ligne.match(/\{/g) || []).length === (ligne.match(/\}/g) || []).length) return ligne.trim();
  const fin = source.indexOf(`\n${retrait}}\n`, debut);
  return fin < 0 ? '' : source.slice(debut, fin + retrait.length + 2);
}
// Une declaration `var nom = {` ou `var nom = [`, jusqu a sa fermeture posee
// a la meme indentation ; `var nom = ...;` sur une ligne sinon.
function extraireVar(source, nom) {
  const m = new RegExp(`\\n( *)var ${nom} = (.)`).exec(source);
  if (!m) return '';
  const debut = m.index + 1;
  const retrait = m[1];
  if (m[2] !== '{' && m[2] !== '[') return source.slice(debut, source.indexOf('\n', debut)).trim();
  const fin = source.indexOf(`\n${retrait}${m[2] === '{' ? '}' : ']'};\n`, debut);
  return fin < 0 ? '' : source.slice(debut, fin + retrait.length + 3);
}
// Le formulaire et son module : les outils (calendrier, heures, jours) sont
// dans assets/fungalaxy-booking.js, les regles de la demande dans
// assets/fungalaxy-sur-mesure.js, charge a la demande.
function chargerFormulaire(sourceFormulaire, sourceModule) {
  const src = sourceFormulaire.replace(/\r\n/g, '\n');
  const mod = sourceModule.replace(/\r\n/g, '\n');
  const OUTILS = ['iso', 'deIso', 'heureRonde', 'joursLisibles', 'plageLisible', 'entreeJour', 'absorberCalendrier', 'jourInfo'];
  const REGLES = ['momentDef', 'joursEntre', 'momentsDuJour', 'verdictMoment', 'agesCroisent', 'agesSousLeMinimum', 'plageAges', 'verdictFormuleSurMesure', 'verdictActiviteSurMesure'];
  const morceaux = OUTILS.map((nom) => ({ nom, code: extraireFonction(src, nom) }))
    .concat(REGLES.map((nom) => ({ nom, code: extraireFonction(mod, nom) })));
  const blocs = [
    (src.match(/^ {2}var JOURS_SEM = .*$/m) || [''])[0],
    extraireVar(mod, 'SM_AGES'),
    extraireVar(mod, 'SM_MOMENTS'),
    extraireVar(mod, 'SM_DELAI'),
  ];
  const bac = { jours: {}, accentuer: (s) => s, horaireLabel: () => '', Math, Number, String, Date, JSON, Array, Object, isFinite, isNaN };
  bac.globalThis = bac;
  vm.createContext(bac);
  blocs.filter(Boolean).forEach((code) => vm.runInContext(code, bac));
  morceaux.filter((m) => m.code).forEach((m) => vm.runInContext(m.code, bac, { filename: `fungalaxy-booking.js:${m.nom}` }));
  return { bac, manquantes: morceaux.filter((m) => !m.code).map((m) => m.nom).concat(blocs.some((b) => !b) ? ['constantes'] : []) };
}

function verifierRegles(S) {
  section('A. LE FORMULAIRE TRANCHE COMME LE SERVEUR');
  const { bac, manquantes } = chargerFormulaire(fs.readFileSync(path.join(ROOT, 'assets/fungalaxy-booking.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'assets/fungalaxy-sur-mesure.js'), 'utf8'));
  if (!ok(manquantes.length === 0, 'MONTAGE le formulaire porte ses regles (sinon ce gate ne prouve rien)', manquantes.join(', '))) return;
  const { __test } = S.meta;
  const aujourdHui = jourBruxelles();
  let cas = 0;
  const ecarts = [];
  const vus = { jours: new Set(), heures: 0, refusFormule: new Set(), notes: 0, refusActivite: new Set(), moments: new Set() };
  for (const centreId of ['libramont', 'gembloux']) {
    const centre = S.opsKnowledge.getCenter(centreId);
    const calendrier = __test.buildCalendar([], 90, centre, centreId, '');
    bac.jours = {};
    vm.runInContext(`jours = {}; absorberCalendrier(${JSON.stringify(calendrier)});`, bac);
    const formules = S.meta.__test.formulesPubliques(centreId, centre);
    const activites = S.meta.__test.activitesPubliques(centreId, centre);
    const ouverts = calendrier.filter((j) => j.open);
    // Les fonctions du formulaire, appelees directement (objets simples).
    const F = {
      jourInfo: vm.runInContext('jourInfo', bac),
      momentsDuJour: vm.runInContext('momentsDuJour', bac),
      verdictMoment: vm.runInContext('verdictMoment', bac),
      verdictFormule: vm.runInContext('verdictFormuleSurMesure', bac),
      verdictActivite: vm.runInContext('verdictActiviteSurMesure', bac),
    };
    // 1. Les moments de chaque jour ouvert.
    for (const j of ouverts) {
      cas += 1;
      const serveur = JSON.stringify(S.regles.momentsDuJour(j.schedule));
      const client = JSON.stringify(F.momentsDuJour(F.jourInfo(j.date).schedule));
      if (serveur !== client) ecarts.push(`${centreId} ${j.date} moments serveur=${serveur} formulaire=${client}`);
      vus.jours.add(`${j.schedule.open}-${j.schedule.close}`);
    }
    // 2. La regle des 24 heures : les quatre prochains jours ouverts, a toute
    //    heure, et le premier jour qui ouvre trop tard pour un matin (en
    //    vacances scolaires, les quatre prochains ouvrent tous tot : sans lui,
    //    « ouvre à » n etait jamais rencontre, 2026-10-28).
    const HEURES = [0, 7.5, 9, 10, 11.75, 12, 13.5, 14, 16, 17.99, 18, 20, 23.5];
    const tard = ouverts.find((j) => { const m = S.regles.momentsDuJour(j.schedule); return m && !m.matin.ok; });
    const joursRegle = ouverts.slice(0, 4).concat(tard && !ouverts.slice(0, 4).includes(tard) ? [tard] : []);
    for (const j of joursRegle) {
      for (const nowHour of HEURES) {
        for (const moment of Object.keys(S.regles.MOMENTS)) {
          cas += 1;
          const o = { date: j.date, moment, today: aujourdHui, nowHour, schedule: j.schedule };
          const serveur = JSON.stringify(S.regles.verdictMoment(o));
          const client = JSON.stringify(F.verdictMoment({ ...o, schedule: F.jourInfo(j.date).schedule }));
          if (serveur !== client) ecarts.push(`${centreId} ${j.date} ${nowHour}h ${moment} serveur=${serveur} formulaire=${client}`);
          if (!JSON.parse(serveur).ok) vus.moments.add(JSON.parse(serveur).raison);
          vus.heures += 1;
        }
      }
    }
    // 3. Chaque formule et chaque activite, jour par jour, moment, ages, groupe.
    const AGES = [[], ['moins7'], ['adultes'], ['7-12', 'adultes'], ['13-17']];
    const GROUPES = [4, 31, 60];
    for (const j of calendrier.slice(0, 45)) {
      for (const moment of Object.keys(S.regles.MOMENTS)) {
        for (const ages of AGES) {
          for (const participants of GROUPES) {
            const ctxServeur = { jour: j, moment, participants, ages };
            for (const f of formules) {
              cas += 1;
              const serveur = JSON.stringify(S.regles.verdictFormuleSurMesure(f, ctxServeur));
              const client = JSON.stringify(F.verdictFormule(f, { jour: F.jourInfo(j.date), moment, participants, ages }));
              if (serveur !== client) ecarts.push(`${centreId} ${f.id} ${j.date} ${moment} ${ages.join('+') || '-'} ${participants}p serveur=${serveur} formulaire=${client}`);
              const v = JSON.parse(serveur);
              if (!v.ok) vus.refusFormule.add(v.raison.replace(/[0-9]+/g, 'N'));
              if (v.note) vus.notes += 1;
            }
            for (const a of activites) {
              cas += 1;
              const serveur = JSON.stringify(S.regles.verdictActiviteSurMesure(a, ctxServeur));
              const client = JSON.stringify(F.verdictActivite(a, { jour: F.jourInfo(j.date), participants, ages }));
              if (serveur !== client) ecarts.push(`${centreId} ${a.id} ${j.date} ${ages.join('+') || '-'} ${participants}p serveur=${serveur} formulaire=${client}`);
              const v = JSON.parse(serveur);
              if (!v.ok) vus.refusActivite.add(v.raison);
              if (v.note) vus.notes += 1;
            }
          }
        }
      }
    }
  }
  ok(ecarts.length === 0, `sur ${cas} cas (2 centres, 90 jours, 5 moments, 13 heures, 5 ages, 3 groupes), le formulaire rend le verdict du serveur`, ecarts.slice(0, 3).join(' ; '));
  ok(vus.jours.size >= 2, 'MONTAGE la grille traverse des horaires differents', [...vus.jours].join(' | '));
  const raisonsFormules = [...vus.refusFormule].join(' | ');
  ok(/Seulement le mercredi/.test(raisonsFormules) && /vacances scolaires/.test(raisonsFormules) && /Seulement avant Nh/.test(raisonsFormules) && /pas proposée dans ce centre/.test(raisonsFormules) && /au moins N personnes/.test(raisonsFormules),
    'MONTAGE la grille rencontre chaque raison de refus d une formule (jour, vacances, plage horaire, centre, groupe)', raisonsFormules);
  ok([...vus.moments].some((r) => /Moins de 24 h/.test(r)) && [...vus.moments].some((r) => /ouvre à/.test(r)),
    'MONTAGE la grille rencontre la regle des 24 heures et un centre qui ouvre tard', [...vus.moments].join(' | '));
  ok(vus.notes > 0, 'MONTAGE la grille rencontre des precautions d age', `${vus.notes} notes`);

  // La regle des 24 heures, dite en clair (serveur).
  const demain = plusJours(aujourdHui, 1);
  const horaire = { open: 10, close: 22 };
  const v = (moment, nowHour, date = demain) => S.regles.verdictMoment({ date, moment, today: aujourdHui, nowHour, schedule: horaire });
  ok(!v('matin', 15).ok && /24 h/.test(v('matin', 15).raison), 'demain matin, demande a 15h : refuse, moins de 24 h', JSON.stringify(v('matin', 15)));
  ok(v('soiree', 15).ok, 'demain soir, demande a 15h : accepte (27 h)', JSON.stringify(v('soiree', 15)));
  ok(v('matin', 9.5).ok, 'demain matin 10h, demande a 9h30 : accepte (24 h 30)', JSON.stringify(v('matin', 9.5)));
  ok(!v('indifferent', 23).ok, 'demain, demande a 23h : plus aucun moment a 24 h', JSON.stringify(v('indifferent', 23)));
  ok(v('matin', 23, plusJours(aujourdHui, 2)).ok, 'apres-demain matin, demande a 23h : accepte', JSON.stringify(v('matin', 23, plusJours(aujourdHui, 2))));
}

// ---------------------------------------------------------------------------
// [B] LE SERVEUR
// ---------------------------------------------------------------------------
function prochain(jour, wd, apres) {
  for (let i = apres; i < apres + 21; i += 1) {
    const s = plusJours(jour, i);
    const [y, m, d] = s.split('-').map(Number);
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === wd) return s;
  }
  return '';
}
const CORPS = { kind: 'custom-request', centerId: 'libramont', contactName: 'Gate Sur Mesure', email: 'gate@example.test', phone: '0471000000', message: '' };
function details(extra) {
  return {
    groupType: 'ecole', organisation: 'École du gate', participants: 45, companions: 4, ages: ['7-12', 'adultes'], flexible: false,
    date: '', moment: 'apres-midi', activities: ['bowling', 'laser_game'], formulas: ['f4'], advice: false, budgetPerPerson: 25,
    contactRole: 'Institutrice', invoice: true, vatNumber: 'be 0123.456.789', ...extra,
  };
}
async function reglesServeur(S) {
  const aujourdHui = S.bookingConfig.todayStr();
  // Un samedi hors vacances et hors ferie, a plus de deux jours.
  const centre = S.opsKnowledge.getCenter('libramont');
  let samedi = prochain(aujourdHui, 6, 3);
  for (let k = 0; k < 10 && S.bookingConfig.isFormulaBlockedDate(samedi, centre); k += 1) samedi = prochain(samedi, 6, 1);
  // Un lundi ou le centre est FERME : pendant les vacances scolaires il ouvre
  // tous les jours, et le lundi 19 octobre 2026 (conge d automne) ne se
  // refusait plus pour « fermé » mais pour la formule (rouge du 2026-10-13).
  let lundi = prochain(aujourdHui, 1, 2);
  for (let k = 0; k < 10 && S.bookingConfig.getSchedule(lundi, centre); k += 1) lundi = prochain(lundi, 1, 1);
  S.trace.lignes.length = 0; S.trace.accuses.length = 0;
  const post = (corps) => appel(S.meta, 'POST', '/api/custom-request', corps);
  const r = {};
  r.samedi = samedi;
  r.complete = await post({ ...CORPS, details: details({ date: samedi }) });
  r.ligne = S.trace.lignes[S.trace.lignes.length - 1] || null;
  r.accuses = S.trace.accuses.length;
  r.accuse = S.trace.accuses[0] || null;
  r.jourMeme = await post({ ...CORPS, details: details({ date: aujourdHui }) });
  r.sansOrganisation = await post({ ...CORPS, details: details({ date: samedi, organisation: '' }) });
  r.sansType = await post({ ...CORPS, details: details({ date: samedi, groupType: '' }) });
  r.kfdSamedi = await post({ ...CORPS, details: details({ date: samedi, formulas: ['kfd'] }) });
  r.matinMalinSoir = await post({ ...CORPS, details: details({ date: samedi, formulas: ['mm'], moment: 'soiree' }) });
  r.sansEnvie = await post({ ...CORPS, details: details({ date: samedi, activities: [], formulas: [], advice: false }) });
  r.conseilSeul = await post({ ...CORPS, details: details({ date: samedi, activities: [], formulas: [], advice: true }) });
  r.activiteInconnue = await post({ ...CORPS, details: details({ date: samedi, activities: ['karting_lunaire'] }) });
  r.ferme = await post({ ...CORPS, details: details({ date: lundi }) });
  r.memeDate = await post({ ...CORPS, details: details({ date: samedi, alternativeDate: samedi }) });
  // L autre date suit la regle de la premiere, au meme moment : un jour qui
  // ouvre l apres-midi n a pas de matin ; un jour ouvert l apres-midi convient.
  const calendrier = S.meta.__test.buildCalendar([], 60, centre, 'libramont', '');
  const sansMatin = calendrier.find((j) => j.open && j.date > plusJours(aujourdHui, 2) && j.date !== samedi && !S.regles.momentsDuJour(j.schedule).matin.ok);
  const apresSamedi = calendrier.find((j) => j.open && j.date > samedi && S.regles.momentsDuJour(j.schedule)['apres-midi'].ok);
  r.sansMatin = sansMatin ? sansMatin.date : '';
  r.apresSamedi = apresSamedi ? apresSamedi.date : '';
  r.autreSansMatin = await post({ ...CORPS, details: details({ date: samedi, moment: 'matin', formulas: [], alternativeDate: r.sansMatin }) });
  r.autreOk = await post({ ...CORPS, details: details({ date: samedi, alternativeDate: r.apresSamedi }) });
  r.ligneAutre = S.trace.lignes[S.trace.lignes.length - 1] || null;
  r.flexibleVide = await post({ ...CORPS, details: details({ flexible: true, period: '' }) });
  r.flexible = await post({ ...CORPS, details: details({ flexible: true, period: 'un mercredi de novembre', moment: 'indifferent' }) });
  r.ligneFlexible = S.trace.lignes[S.trace.lignes.length - 1] || null;
  r.ancienne = await post({ ...CORPS, message: 'Nous sommes 40, un samedi de novembre.' });
  r.ancienneVide = await post({ ...CORPS });
  r.demo = await post({ ...CORPS, centerId: 'demo', details: details({ date: samedi }) });
  r.lignes = S.trace.lignes.length;
  r.accusesTotal = S.trace.accuses.length;
  return r;
}
function verifierServeur(r) {
  section('B. LE SERVEUR');
  const d = r.ligne && r.ligne.payload && r.ligne.payload.demande;
  ok(r.complete.status === 201 && r.complete.json && r.complete.json.ok === true, 'une demande complete s enregistre (201)', JSON.stringify(r.complete.json));
  ok(Boolean(r.ligne) && /^samedi \d{1,2} [a-zéû]+ 20\d\d, après-midi$/.test(r.ligne.requestedDate) && r.ligne.pax === 45 && r.ligne.occasion === 'ecole' && r.ligne.company === 'École du gate',
    'la ligne dit la date en clair, le groupe, l occasion et l organisation', r.ligne ? JSON.stringify({ q: r.ligne.requestedDate, pax: r.ligne.pax, o: r.ligne.occasion, c: r.ligne.company }) : 'aucune');
  ok(Boolean(d) && d.companions === 4 && d.ages.join() === '7-12,adultes' && d.moment === 'apres-midi' && d.date === r.samedi
    && d.activities.map((a) => a.name).join() === 'Bowling,Laser Game' && d.formulas.map((f) => f.name).join() === 'FORMULE 4'
    && d.invoice === true && d.vatNumber === 'BE 0123.456.789' && d.budgetPerPerson === 25 && d.contactRole === 'Institutrice',
  'la demande structuree est gardee, noms des activites et formules compris', d ? JSON.stringify(d).slice(0, 220) : 'aucune');
  ok(r.accuses >= 1 && r.accuse && r.accuse.demande && r.complete.json.acknowledgementSent === false,
    'l accuse de reception est compose avec la demande, et rien ne part (neutralise ici)', `accuses=${r.accuses}`);
  const refus = (x, champ, motif) => x.status === 422 && x.json && x.json.field === champ && motif.test(x.json.message || '');
  ok(refus(r.jourMeme, 'date', /jour même/), 'le jour meme est refuse : au moins 24 heures', JSON.stringify(r.jourMeme.json));
  ok(refus(r.sansOrganisation, 'organisation', /nom de l’école/), 'une ecole sans nom est refusee', JSON.stringify(r.sansOrganisation.json));
  ok(refus(r.sansType, 'groupType', /type de groupe/), 'un groupe sans type est refuse', JSON.stringify(r.sansType.json));
  ok(refus(r.kfdSamedi, 'formulas', /KIDS FUN DAY : Seulement le mercredi/), 'le Kids Fun Day un samedi est refuse, avec sa raison', JSON.stringify(r.kfdSamedi.json));
  ok(refus(r.matinMalinSoir, 'formulas', /MATIN MALIN : Seulement avant 12h/), 'le Matin Malin en soiree est refuse, avec sa raison', JSON.stringify(r.matinMalinSoir.json));
  ok(refus(r.sansEnvie, 'activities', /au moins une activité/), 'une demande sans envie est refusee', JSON.stringify(r.sansEnvie.json));
  ok(r.conseilSeul.status === 201, 'demander conseil suffit (sans activite ni formule)', JSON.stringify(r.conseilSeul.json));
  ok(refus(r.activiteInconnue, 'activities', /plus proposée/), 'une activite que le centre ne vend pas est refusee', JSON.stringify(r.activiteInconnue.json));
  ok(refus(r.ferme, 'date', /fermé/), 'un jour de fermeture est refuse', JSON.stringify(r.ferme.json));
  ok(refus(r.memeDate, 'alternativeDate', /autre date/), 'l autre date ne peut pas etre la meme', JSON.stringify(r.memeDate.json));
  ok(Boolean(r.sansMatin) && refus(r.autreSansMatin, 'alternativeDate', /^Autre date \(matin\) : Le centre ouvre à \d{1,2}h(\d\d)? ce jour-là\.$/),
    'une autre date qui ouvre l apres-midi ne convient pas a un matin, et le dit', `${r.sansMatin} ${JSON.stringify(r.autreSansMatin.json)}`);
  const autre = r.ligneAutre && r.ligneAutre.payload && r.ligneAutre.payload.demande;
  const { libelleDate } = require('../lib/custom-request');
  ok(r.autreOk.status === 201 && Boolean(autre) && autre.alternativeDate === r.apresSamedi && r.ligneAutre.requestedDate.endsWith(`(ou ${libelleDate(r.apresSamedi)})`),
    'une autre date qui convient est gardee, et dite en clair avec la premiere', r.ligneAutre ? r.ligneAutre.requestedDate : JSON.stringify(r.autreOk.json));
  ok(refus(r.flexibleVide, 'period', /période/), 'une date a fixer demande la periode envisagee', JSON.stringify(r.flexibleVide.json));
  ok(r.flexible.status === 201 && r.ligneFlexible && r.ligneFlexible.requestedDate === 'À fixer : un mercredi de novembre', 'une date a fixer s enregistre avec sa periode', r.ligneFlexible ? r.ligneFlexible.requestedDate : '');
  ok(r.ancienne.status === 201 && r.ancienneVide.status === 400, 'l ancienne fenetre marche encore : message libre accepte, message vide refuse', `${r.ancienne.status} / ${r.ancienneVide.status}`);
  ok(r.demo.status === 422, 'le centre de demonstration n enregistre rien', JSON.stringify(r.demo.json));
  ok(!process.env.RESEND_API_KEY, 'aucune cle d envoi dans ce processus : aucun e-mail ne peut partir');
}

// ---------------------------------------------------------------------------
// [C] LA RESERVATION EN LIGNE ET LE SEUIL
// ---------------------------------------------------------------------------
async function reglesGarde(S) {
  const post = (corps) => appel(S.reservations, 'POST', '/api/public-reservations', corps);
  const base = { centerId: 'libramont', date: plusJours(S.bookingConfig.todayStr(), 6), startTime: '15:00', name: 'Gate', email: 'gate@example.test', phone: '0471000000', type: 'visite', program: [{ activityId: 'bowling', duration: 1 }] };
  const est = (x) => x.status === 422 && x.json && x.json.code === 'custom_request_required';
  const r = {};
  r.a31 = await post({ ...base, pax: 31 });
  r.a30 = await post({ ...base, pax: 30 });
  r.enfants = await post({ ...base, pax: 25, companions: 6 });
  r.gembloux = await post({ ...base, centerId: 'gembloux', pax: 31 });
  S.opsKnowledge.applyCenterRecords([{ id: 'libramont', config: { customRequest: { fromPax: null } } }]);
  r.sansSeuil = await post({ ...base, pax: 60 });
  S.opsKnowledge.applyCenterRecords([{ id: 'libramont', config: { customRequest: { fromPax: 40 } } }]);
  r.a39 = await post({ ...base, pax: 39 });
  r.a40 = await post({ ...base, pax: 40 });
  S.opsKnowledge.applyCenterRecords([]);
  return { r, est };
}
function verifierGarde({ r, est }) {
  section('C. LA RESERVATION EN LIGNE ET LE SEUIL');
  ok(est(r.a31) && r.a31.json.fromPax === 31 && /31 personnes/.test(r.a31.json.message) && /24 heures ouvrables/.test(r.a31.json.message),
    '31 personnes : la reservation en ligne est refusee, la demande sur mesure est nommee', JSON.stringify(r.a31.json));
  ok(!est(r.a30), '30 personnes : la garde laisse passer', `HTTP ${r.a30.status}`);
  ok(est(r.enfants), '25 enfants + 6 accompagnants = 31 personnes : refuse (tout le monde compte)', JSON.stringify(r.enfants.json));
  ok(est(r.gembloux), 'Gembloux, meme regle', JSON.stringify(r.gembloux.json));
  ok(!est(r.sansSeuil), 'LA DONNEE DECIDE : un centre sans seuil laisse reserver 60 personnes en ligne', `HTTP ${r.sansSeuil.status}`);
  ok(!est(r.a39) && est(r.a40) && r.a40.json.fromPax === 40, 'un seuil regle a 40 : 39 passe, 40 est refuse', `${r.a39.status} / ${JSON.stringify(r.a40.json)}`);
}

// ---------------------------------------------------------------------------
// [D] LE CATALOGUE PUBLIC
// ---------------------------------------------------------------------------
async function reglesCatalogue(S) {
  const get = (centre) => appel(S.meta, 'GET', `/api/public-booking-meta?centerId=${centre}`);
  const lib = await get('libramont');
  const gem = await get('gembloux');
  S.opsKnowledge.applyCenterRecords([{ id: 'libramont', config: { customRequest: { fromPax: 40 } } }]);
  const regle = await get('libramont');
  S.opsKnowledge.applyCenterRecords([]);
  // LA DONNEE DE PROD, relue le 2026-09-29 (lecture seule) : les deux centres
  // ont les boissons et le credit d arcade a false dans Etablissement (ils
  // ne se vendent pas seuls), Gembloux la plaine et les tables de fete aussi.
  S.opsKnowledge.applyCenterRecords([
    { id: 'libramont', config: { activityAvailability: PROD_LIBRAMONT } },
    { id: 'gembloux', config: { activityAvailability: PROD_GEMBLOUX } },
  ]);
  const libProd = await get('libramont');
  const gemProd = await get('gembloux');
  S.opsKnowledge.applyCenterRecords([]);
  return { lib: lib.json, gem: gem.json, regle: regle.json, libProd: libProd.json, gemProd: gemProd.json };
}
const PROD_LIBRAMONT = { darts: true, bowling: true, fun_run: true, billards: true, karting_vr: false, laser_game: true, playground: true, arcade_time: true, golf_oclock: false, party_table: true, axe_throwing: false, arcade_credit: false, service_drinks: false, duckpin_bowling: true, free_roaming_vr: false, minigolf_blacklight: true };
const PROD_GEMBLOUX = { darts: false, bowling: true, fun_run: false, billards: true, karting_vr: false, laser_game: true, playground: false, arcade_time: true, golf_oclock: true, party_table: false, axe_throwing: false, arcade_credit: false, service_drinks: false, duckpin_bowling: false, free_roaming_vr: false, minigolf_blacklight: true };
function verifierCatalogue(r) {
  section('D. LE CATALOGUE PUBLIC');
  ok(r.lib && r.lib.center && r.lib.center.customRequest && r.lib.center.customRequest.fromPax === 31, 'Libramont : demande sur mesure des 31 personnes', JSON.stringify(r.lib && r.lib.center && r.lib.center.customRequest));
  ok(r.regle && r.regle.center.customRequest.fromPax === 40, 'le seuil regle dans la console est celui que le formulaire lit (40)', JSON.stringify(r.regle && r.regle.center.customRequest));
  const f = (j, id) => ((j && j.formules) || []).find((x) => x.id === id) || {};
  ok(['f6', 'f7', 'f8'].every((id) => (f(r.gem, id).missingActivityIds || []).includes('playground')), 'Gembloux : les formules 6 a 8 disent la plaine de jeux qui leur manque', ['f6', 'f7', 'f8'].map((id) => `${id}:${JSON.stringify(f(r.gem, id).missingActivityIds || null)}`).join(' '));
  ok(((r.lib && r.lib.formules) || []).every((x) => !x.missingActivityIds), 'Libramont : aucune formule ne manque de rien');
  const retirees = (j) => ((j && j.formules) || []).filter((x) => x.missingActivityIds);
  const dire = (l) => l.map((x) => `${x.id}:${x.missingActivityIds.join('+')}`).join(' ') || 'aucune';
  const libP = retirees(r.libProd), gemP = retirees(r.gemProd);
  ok(((r.libProd && r.libProd.formules) || []).length >= 8 && libP.length === 0,
    'DONNEE DE PROD : a Libramont, boissons et credit d arcade coupes a la carte ne retirent aucune formule (ce sont des services du bar)', dire(libP));
  ok(['f6', 'f7', 'f8'].every((id) => { const x = gemP.find((y) => y.id === id); return x && x.missingActivityIds.includes('playground') && x.missingActivityIds.includes('party_table'); })
    && gemP.every((x) => x.missingActivityIds.every((id) => PROD_GEMBLOUX[id] === false && id !== 'service_drinks' && id !== 'arcade_credit'))
    && !gemP.some((x) => ['f1', 'f2', 'f3', 'f4', 'f5'].includes(x.id)),
    'DONNEE DE PROD : a Gembloux, seules la plaine de jeux et les tables de fete retirent des formules (6 a 8), jamais un service du bar', dire(gemP));
  const laser = ((r.lib && r.lib.activities) || []).find((a) => a.id === 'laser_game') || {};
  const plaine = ((r.lib && r.lib.activities) || []).find((a) => a.id === 'playground') || {};
  ok(laser.minAge === 7 && laser.minHeightCm === 130 && plaine.ageRange === '4 à 12 ans', 'les faits d age du centre sont servis (laser des 7 ans et 1,30 m, plaine 4 a 12 ans)', JSON.stringify({ laser: [laser.minAge, laser.minHeightCm], plaine: plaine.ageRange }));
}

// ---------------------------------------------------------------------------
// [E] LE FORMULAIRE
// ---------------------------------------------------------------------------
// Une contre-epreuve du formulaire : { fichier, de, vers }, servie en memoire
// a la place du fichier (le disque n est jamais touche).
let tunnelCasse = null;
function sourceServie(fichier) {
  return fs.readFileSync(path.join(ROOT, 'assets', fichier), 'utf8').replace(/\r\n/g, '\n');
}
function serveur(mock) {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (tunnelCasse && url.pathname === `/assets/${tunnelCasse.fichier}`) {
      res.writeHead(200, { 'Content-Type': /\.css$/.test(tunnelCasse.fichier) ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(sourceServie(tunnelCasse.fichier).split(tunnelCasse.de).join(tunnelCasse.vers));
      return;
    }
    base.emit('request', req, res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}
async function poserGroupe(page, n) {
  await page.fill('#paxInput', String(n));
  await page.dispatchEvent('#paxInput', 'input');
  await page.locator('#paxInput').blur();
}
// LE PREMIER ECRAN, ET LE MODULE CHARGE A LA DEMANDE : a 30 personnes, rien
// de la demande n est telecharge ; a 31, elle se charge avant le clic.
// LA SOBRIETE, lue dans la page une fois la demande chargee (Movsar,
// 2026-09-29 : l encart du grand groupe en degrade « fait trop IA »). Un
// degrade n existe que comme voile d une photo : sur le ::before ou le ::after
// d un hote qui porte son <img>. Un motif (repeating-) n est pas un degrade.
// Lue sur les REGLES des deux feuilles, pas sur les seuls elements a l ecran.
function sobriete() {
  const lire = (feuilles) => {
    const fautes = [], voiles = [];
    const parcourir = (liste) => Array.from(liste).forEach((r) => {
      if (r.cssRules && !r.style) { parcourir(r.cssRules); return; }
      if (!r.style || !r.selectorText) return;
      if (!/(^|[^-])(linear|radial|conic)-gradient\(/.test(r.style.getPropertyValue('background-image') || '')) return;
      r.selectorText.split(',').map((s) => s.trim()).forEach((sel) => {
        const m = /^(.*[^:])::?(before|after)$/.exec(sel);
        const hotes = m ? Array.from(document.querySelectorAll(m[1])) : [];
        if (m && hotes.length && hotes.every((h) => h.querySelector('img'))) voiles.push(sel); else fautes.push(sel);
      });
    });
    feuilles.forEach((f) => { try { parcourir(f.cssRules); } catch (e) { fautes.push(`feuille illisible ${f.href || ''}`); } });
    return { fautes, voiles };
  };
  const feuilles = Array.from(document.styleSheets).filter((f) => /\/assets\/fungalaxy-(booking|sur-mesure)\.css/.test(f.href || ''));
  const essai = new CSSStyleSheet();
  essai.replaceSync('.fg-btn { background-image: linear-gradient(red, blue); } .fg-art::after { background: linear-gradient(90deg, #000, transparent); } .fg-chip { background: repeating-linear-gradient(135deg, red 0 6px, blue 6px 12px); } .fg-sm-seuil::before { background: linear-gradient(red, blue); }');
  const encart = getComputedStyle(document.getElementById('smSeuil'));
  const icone = getComputedStyle(document.querySelector('#smSeuil .fg-sm-seuil__icon'));
  return {
    feuilles: feuilles.map((f) => f.href.replace(/^.*\/assets\//, '').replace(/\?.*$/, '')).sort(),
    ...lire(feuilles),
    preuve: lire([essai]),
    encart: { image: encart.backgroundImage, fond: encart.backgroundColor, champ: getComputedStyle(document.querySelector('.fg-stepper')).backgroundColor, iconeFond: icone.backgroundColor, iconeImage: icone.backgroundImage, iconeBord: icone.borderTopWidth },
  };
}
async function premierEcran(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const demandes = [];
  page.on('request', (q) => { if (/fungalaxy-sur-mesure\.(js|css)/.test(q.url())) demandes.push(q.url().replace(BASE_URL, '')); });
  try {
    await page.goto(`${BASE_URL}/fungalaxy/libramont?v=sur-mesure`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body.is-ready', { timeout: 20000 });
    const lire = () => page.evaluate(() => ({
      bouton: document.getElementById('goActivitiesLabel').textContent.trim(),
      encart: !document.getElementById('smSeuil').hidden,
      texte: document.getElementById('smSeuilTexte').textContent,
      porte: !document.getElementById('smDoor').hidden,
      ecrans: document.querySelectorAll('.fg-scene[data-scene^="sm-"]').length,
      module: typeof window.FGSurMesure,
    }));
    await poserGroupe(page, 30);
    await page.waitForTimeout(400);
    const a30 = await lire();
    a30.demandes = demandes.slice();
    await poserGroupe(page, 31);
    await attendre(page, () => typeof window.FGSurMesure === 'function', 5000);
    const a31 = await lire();
    a31.demandes = demandes.slice();
    a31.sobre = await page.evaluate(sobriete);
    return { a30, a31 };
  } finally { await ctx.close(); }
}
// UN CENTRE SANS SEUIL (catalogue servi sans fromPax) : 240 personnes se
// reservent en ligne, rien de la demande n est charge, et au plafond la phrase
// dit la borne en ligne et le numero du centre.
async function sansSeuil(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const demandes = [];
  page.on('request', (q) => { if (/fungalaxy-sur-mesure\./.test(q.url())) demandes.push(q.url()); });
  try {
    await page.route('**/api/public-booking-meta*', async (route) => {
      const reponse = await route.fetch();
      const j = await reponse.json();
      if (j && j.center) j.center.customRequest = { fromPax: null };
      await route.fulfill({ response: reponse, json: j });
    });
    await page.goto(`${BASE_URL}/fungalaxy/libramont?v=sur-mesure-sans-seuil`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body.is-ready', { timeout: 20000 });
    await page.fill('#paxInput', '999');
    await page.press('#paxInput', 'Enter');
    await attendre(page, () => document.querySelector('#paxInput').value === '240', 3000);
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const h = document.querySelector('#paxHint'); const a = h.querySelector('a[href^="tel:"]');
      return { texte: h.textContent.replace(/\s+/g, ' ').trim(), tel: a ? a.getAttribute('href') : '', encart: !document.getElementById('smSeuil').hidden, bouton: document.getElementById('goActivitiesLabel').textContent.trim(), porte: !document.getElementById('smDoor').hidden };
    });
    r.demandes = demandes.slice();
    return r;
  } finally { await ctx.close(); }
}
function verifierSansSeuil(r) {
  section('E5. UN CENTRE SANS SEUIL');
  ok(!r.encart && r.bouton === 'Choisir mes activités' && r.porte, 'LA DONNEE DECIDE : sans seuil, 240 personnes se reservent en ligne, la porte des groupes organises reste offerte', JSON.stringify({ e: r.encart, b: r.bouton, p: r.porte }));
  ok(/En ligne, 240 personnes au maximum\./.test(r.texte) && /^tel:\+?\d{8,}$/.test(r.tel), 'au plafond : la borne en ligne et le numero du centre a toucher', `« ${r.texte} » ${r.tel}`);
  ok(r.demandes.length === 0, 'et rien de la demande n est telecharge', r.demandes.join(', '));
}

// LA PANNE DU MODULE : le reseau le refuse, le clic le dit en clair et reste
// sur le premier ecran ; le reseau revenu, le clic suivant ouvre la demande.
async function panneModule(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const r = { erreurs: [] };
  page.on('pageerror', (e) => r.erreurs.push(e.message));
  try {
    await page.route('**/fungalaxy-sur-mesure.js*', (route) => route.abort());
    await page.goto(`${BASE_URL}/fungalaxy/libramont?v=sur-mesure-panne`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body.is-ready', { timeout: 20000 });
    await poserGroupe(page, 40);
    await page.waitForTimeout(300);
    await page.click('#goActivities');
    await attendre(page, () => !document.getElementById('fgAlert').hidden, 5000);
    r.alerte = await page.evaluate(() => ({ texte: document.getElementById('fgAlert').textContent, scene: document.querySelector('.fg-scene.is-active').dataset.scene, occupe: document.getElementById('goActivities').classList.contains('is-busy') }));
    await page.unroute('**/fungalaxy-sur-mesure.js*');
    await page.click('#goActivities');
    r.reprise = await attendre(page, () => document.querySelector('.fg-scene[data-scene="sm-groupe"].is-active') !== null, 8000);
    r.feuilles = await page.evaluate(() => document.querySelectorAll('link[href*="fungalaxy-sur-mesure.css"]').length);
    return r;
  } finally { await ctx.close(); }
}
async function parcours(browser, mock, { largeur = 1440, hauteur = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: hauteur } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  const r = { erreurs, debordements: [] };
  try {
    // L horloge du centre : la veille du jour vise, 15 h a Bruxelles. Demain
    // matin est alors a moins de 24 heures, demain soir a plus.
    const aujourdHui = jourBruxelles();
    const dates = mock.metaPayload('', 90).center.calendar;
    const ouverts = dates.filter((j) => j.open && j.date > aujourdHui);
    // Le jour vise se choisit a ses proprietes, pas a son rang : ouvert tot et
    // tard, une formule possible le soir pour ce groupe (le parcours en
    // choisit une) et le Kids Fun Day refuse (le parcours lit sa raison). En
    // vacances scolaires, le premier jour ouvert n avait aucune formule
    // possible le soir et le parcours rougissait (2026-10-28).
    const reglesSM = require('../lib/custom-request');
    const formulesSM = require('../lib/booking-config').getEffectiveFormules('libramont');
    const verdictSoir = (f, j) => reglesSM.verdictFormuleSurMesure(f, { jour: j, moment: 'soiree', participants: 31, ages: ['moins7', '7-12'] });
    const convient = (j) => j.schedule.open <= 10 && j.schedule.close >= 21
      && formulesSM.some((f) => verdictSoir(f, j).ok)
      && formulesSM.some((f) => f.id === 'kfd' && !verdictSoir(f, j).ok);
    const cible = ouverts.find(convient) || ouverts.find((j) => j.schedule.open <= 10 && j.schedule.close >= 21) || ouverts[0];
    const veille = plusJours(cible.date, -1);
    await page.clock.setFixedTime(instantBruxelles(veille, 15));
    await page.goto(`${BASE_URL}/fungalaxy/libramont?v=sur-mesure-${largeur}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body.is-ready', { timeout: 20000 });
    const deborde = async (ecran) => {
      const x = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (x > 1) r.debordements.push(`${ecran}:${x}px`);
    };
    await poserGroupe(page, 31);
    await page.click('#goActivities');
    r.groupe = await attendre(page, () => document.querySelector('.fg-scene[data-scene="sm-groupe"].is-active') !== null, 8000);
    await page.waitForTimeout(700);
    r.etapes = await page.evaluate(() => Array.from(document.querySelectorAll('.fg-scene.is-active .fg-steps__item .lbl')).map((x) => x.textContent.trim()));
    r.parcours = await page.evaluate(() => document.body.dataset.parcours);
    r.paxPrerempli = await page.inputValue('#smPax');
    // Les photos de la demande : le tirage du formulaire, jamais la meme d un
    // ecran a son voisin sur le chemin de la demande.
    r.photos = await page.evaluate(() => ['date', 'sm-groupe', 'sm-date', 'sm-envies', 'sm-contact', 'sm-recap', 'fin'].map((id) => {
      const img = document.querySelector(`.fg-scene[data-scene="${id}"] .fg-art img`);
      return img ? img.dataset.photo || '' : '';
    }));
    await deborde('groupe');
    await page.click('#smGoDate');
    r.erreurType = await page.textContent('#eSmType');
    await page.click('.fg-occasion[data-type="ecole"]');
    r.labelOrg = await page.textContent('#lSmOrg');
    await page.click('#smGoDate');
    r.erreurOrg = await page.textContent('#eSmOrg');
    await page.fill('#smOrg', 'École communale du gate');
    await page.click('.fg-sm-chip[data-age="moins7"]');
    await page.click('.fg-sm-chip[data-age="7-12"]');
    await page.click('#smCompPlus');
    await page.click('#smCompPlus');
    await page.click('#smGoDate');
    r.date = await attendre(page, () => document.querySelector('.fg-scene[data-scene="sm-date"].is-active') !== null, 8000);
    await page.waitForTimeout(700);
    // Ce qui est cache l est A L ECRAN (style calcule), pas seulement marque :
    // `.fg-field` pose display: grid, qui l emportait sur l attribut hidden.
    const affiche = (id) => page.evaluate((x) => getComputedStyle(document.getElementById(x)).display !== 'none', id);
    r.periodeAvant = await affiche('smPeriodWrap');
    await page.check('#smFlexible', { force: true });
    await page.waitForTimeout(150);
    r.periodeFlexible = await affiche('smPeriodWrap');
    r.datesFlexible = await affiche('smDates');
    await page.uncheck('#smFlexible', { force: true });
    await page.waitForTimeout(150);
    r.periodeApres = await affiche('smPeriodWrap');
    await deborde('date');
    // Le calendrier s ouvre sous le champ de la demande, aujourd hui (la
    // veille) grise avec sa raison.
    await page.click('#smDateBtn');
    await page.waitForSelector('#dayPop:not([hidden])', { timeout: 5000 });
    await attendre(page, (d) => { const b = document.querySelector(`.fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, cible.date);
    r.calendrier = await page.evaluate((o) => {
      const pop = document.getElementById('dayPop');
      const btn = document.getElementById('smDateBtn');
      const veille = document.querySelector(`.fg-cal__day[data-date="${o.veille}"]`);
      const jour = document.querySelector(`.fg-cal__day[data-date="${o.cible}"]`);
      return {
        sousLeChamp: pop.parentNode === btn.closest('.fg-day') || pop.classList.contains('is-fenetre'),
        veilleGrise: Boolean(veille && veille.disabled), veilleTitre: veille ? veille.title : '',
        cibleOuverte: Boolean(jour && !jour.disabled),
      };
    }, { veille, cible: cible.date });
    await page.click(`.fg-cal__day[data-date="${cible.date}"]`);
    await page.waitForTimeout(300);
    r.labelDate = await page.textContent('#smDateLabel');
    r.moments = await page.evaluate(() => Array.from(document.querySelectorAll('.fg-sm-moment')).map((b) => ({ id: b.dataset.moment, refus: b.classList.contains('is-refus'), petit: b.querySelector('small').textContent })));
    await page.click('.fg-sm-moment[data-moment="matin"]');
    r.pourquoi = await page.textContent('#smMomentWhy');
    r.matinCoche = await page.evaluate(() => document.querySelector('.fg-sm-moment[data-moment="matin"]').getAttribute('aria-checked'));
    // Un jour qui ouvre tard : le matin dit pourquoi il n existe pas.
    const tardif = ouverts.find((j) => j.schedule.open >= 11 && j.date > cible.date);
    if (tardif) {
      await page.click('#smDateBtn');
      await page.waitForSelector('#dayPop:not([hidden])', { timeout: 5000 });
      const [y, m] = tardif.date.split('-').map(Number);
      for (let k = 0; k < 4; k += 1) {
        const vu = await page.evaluate(() => document.getElementById('calTitle').textContent);
        if (new RegExp(String(y)).test(vu) && (await page.$(`.fg-cal__day[data-date="${tardif.date}"]`))) break;
        await page.click('#calNext');
        await page.waitForTimeout(250);
      }
      await attendre(page, (d) => { const b = document.querySelector(`.fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, tardif.date);
      await page.click(`.fg-cal__day[data-date="${tardif.date}"]`);
      await page.waitForTimeout(300);
      r.tardif = { date: tardif.date, open: tardif.schedule.open, matin: await page.evaluate(() => { const b = document.querySelector('.fg-sm-moment[data-moment="matin"]'); return { refus: b.classList.contains('is-refus'), petit: b.querySelector('small').textContent }; }) };
      // Retour au jour vise.
      await page.click('#smDateBtn');
      await page.waitForSelector('#dayPop:not([hidden])', { timeout: 5000 });
      for (let k = 0; k < 4 && !(await page.$(`.fg-cal__day[data-date="${cible.date}"]`)); k += 1) { await page.click('#calPrev'); await page.waitForTimeout(250); }
      await page.click(`.fg-cal__day[data-date="${cible.date}"]`);
      await page.waitForTimeout(300);
    }
    await page.click('.fg-sm-moment[data-moment="soiree"]');
    r.soireeCochee = await page.evaluate(() => document.querySelector('.fg-sm-moment[data-moment="soiree"]').getAttribute('aria-checked'));
    await page.click('#smGoEnvies');
    r.envies = await attendre(page, () => document.querySelector('.fg-scene[data-scene="sm-envies"].is-active') !== null, 8000);
    await page.waitForTimeout(700);
    await deborde('envies');
    r.sousTitre = await page.textContent('#smEnviesSub');
    r.cartes = await page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('#smGridAct .fg-card')).map((c) => [c.dataset.sm, {
      cap: '', note: '', refus: c.classList.contains('is-refus'),
    }])));
    for (const id of Object.keys(r.cartes)) {
      if (r.cartes[id].refus) continue;
      await page.click('#smGridAct .fg-card[data-sm="' + id + '"]');
      await page.click('#smGridAct [data-sm-activity="' + id + '"] [data-activity-info]');
      const info = await page.locator('.fg-info-text').textContent();
      r.cartes[id].cap = info; r.cartes[id].note = info;
      await page.keyboard.press('Escape');
      // Depuis le 2026-10-05 (journaux 377 et 379), toucher une carte cochee ouvre
      // ses reglages ; on la retire par sa case, comme le visiteur.
      await page.click('#smGridAct [data-sm-activity="' + id + '"] [data-activity-toggle]');
    }
    r.continuerAvant = await page.evaluate(() => document.getElementById('smGoContact').disabled);
    await page.click('#smGridAct .fg-card[data-sm="bowling"]');
    await page.click('#smGridAct .fg-card[data-sm="laser_game"]');
    await page.click('#smTabFor');
    await page.waitForTimeout(250);
    await deborde('formules');
    r.formules = await page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('#smGridFor .fg-card')).map((c) => [c.dataset.sm, {
      refus: c.classList.contains('is-refus'), raison: (c.querySelector('.fg-for__off') || {}).textContent || '', note: (c.querySelector('.fg-sm-note') || {}).textContent || '',
    }])));
    // Une formule refusee : on lit sa raison, rien ne se coche.
    await page.click('#smGridFor .fg-card[data-sm="kfd"]');
    r.kfdCochee = await page.evaluate(() => document.querySelector('#smGridFor .fg-card[data-sm="kfd"]').getAttribute('aria-checked'));
    const possible = Object.entries(r.formules).find(([, v]) => !v.refus);
    r.formuleChoisie = possible ? possible[0] : '';
    if (possible) await page.click(`#smGridFor .fg-card[data-sm="${possible[0]}"]`);
    r.compteur = await page.textContent('#smCount');
    r.badges = await page.evaluate(() => [document.getElementById('smTabActN').textContent, document.getElementById('smTabForN').textContent]);
    await page.click('#smAdvice');
    await page.fill('#smBudget', '22');
    await page.dispatchEvent('#smBudget', 'input');
    await page.click('#smGoContact');
    r.contact = await attendre(page, () => document.querySelector('.fg-scene[data-scene="sm-contact"].is-active') !== null, 8000);
    await page.waitForTimeout(700);
    await deborde('contact');
    r.facture = await page.evaluate(() => ({ visible: !document.getElementById('smInvoiceWrap').hidden, label: document.getElementById('smInvoiceLabel').textContent }));
    await page.click('#smGoRecap');
    r.erreursContact = await page.evaluate(() => ['eSmPrenom', 'eSmNom', 'eSmEmail', 'eSmTel', 'eSmConsent'].map((id) => document.getElementById(id).textContent).filter(Boolean).length);
    await page.fill('#smPrenom', 'Camille');
    await page.fill('#smNom', 'Gate');
    await page.fill('#smRole', 'Institutrice');
    await page.fill('#smEmail', 'camille@example.test');
    await page.fill('#smTel', '0471 12 34 56');
    r.tvaAvant = await page.evaluate(() => getComputedStyle(document.getElementById('smVatWrap')).display !== 'none');
    await page.check('#smInvoice', { force: true });
    r.tvaApres = await page.evaluate(() => getComputedStyle(document.getElementById('smVatWrap')).display !== 'none');
    await page.fill('#smVat', 'BE 0123.456.789');
    await page.fill('#smMessage', 'Pique-nique a prevoir, bus a 16h.');
    await page.check('#smConsent', { force: true });
    await page.click('#smGoRecap');
    r.recap = await attendre(page, () => document.querySelector('.fg-scene[data-scene="sm-recap"].is-active') !== null, 8000);
    await page.waitForTimeout(700);
    await deborde('recap');
    r.recapTexte = await page.textContent('#smRecap');
    r.blocs = await page.evaluate(() => document.querySelectorAll('#smRecap .fg-sm-recap__block').length);
    mock.dernierePose.demande = null;
    await page.click('#smSend');
    r.fin = await attendre(page, () => document.querySelector('.fg-scene[data-scene="fin"].is-active') !== null, 10000);
    await page.waitForTimeout(700);
    r.finTitre = await page.textContent('#t-fin');
    r.finTexte = await page.textContent('#finBody');
    r.envoyee = mock.dernierePose.demande;
    r.cible = cible;
    return r;
  } finally { await ctx.close(); }
}
function verifierPremierEcran(p) {
  section('E1. LE PREMIER ECRAN ORIENTE');
  ok(p.a30.bouton === 'Choisir mes activités' && !p.a30.encart && p.a30.porte, '30 personnes : on reserve en ligne, la porte des groupes organises reste offerte', JSON.stringify(p.a30));
  ok(p.a31.bouton === 'Préparer ma demande sur mesure' && p.a31.encart && /31 personnes/.test(p.a31.texte) && /24 heures ouvrables/.test(p.a31.texte) && !p.a31.porte,
    '31 personnes : le bouton ouvre la demande, l encart dit pourquoi et le delai', JSON.stringify(p.a31));
  ok(p.a30.demandes.length === 0 && p.a30.ecrans === 0 && p.a30.module === 'undefined',
    'A LA DEMANDE : a 30 personnes, rien de la demande n est telecharge (ni script, ni feuille, ni ecran)', JSON.stringify({ d: p.a30.demandes, e: p.a30.ecrans, m: p.a30.module }));
  ok(p.a31.demandes.some((u) => /fungalaxy-sur-mesure\.js\?v=/.test(u)) && p.a31.demandes.some((u) => /fungalaxy-sur-mesure\.css\?v=/.test(u)) && p.a31.module === 'function' && p.a31.ecrans === 5,
    'a 31, la demande se charge avant le clic (script et feuille versionnes), ses cinq ecrans entrent dans la page', JSON.stringify({ d: p.a31.demandes, e: p.a31.ecrans, m: p.a31.module }));
  const s = p.a31.sobre;
  ok(s.preuve.fautes.join(' ') === '.fg-btn .fg-sm-seuil::before' && s.preuve.voiles.join(' ') === '.fg-art::after',
    'contre-preuve : le lecteur refuse un degrade sur un bouton et sur un ::before sans photo, laisse passer le voile d une photo et un motif hachure', JSON.stringify(s.preuve));
  ok(s.feuilles.join(' ') === 'fungalaxy-booking.css fungalaxy-sur-mesure.css' && s.voiles.length >= 5 && s.fautes.length === 0,
    'aucun degrade decoratif dans les deux feuilles, demande comprise : chaque degrade est le voile d une photo', JSON.stringify({ feuilles: s.feuilles, voiles: s.voiles.length, fautes: s.fautes }));
  ok(s.encart.image === 'none' && s.encart.fond === s.encart.champ && s.encart.fond !== 'rgba(0, 0, 0, 0)' && s.encart.iconeFond === 'rgba(0, 0, 0, 0)' && s.encart.iconeImage === 'none' && s.encart.iconeBord === '0px',
    'l encart du grand groupe est un aplat (le fond des champs), son icone sans pastille', JSON.stringify(s.encart));
}
function verifierPanne(r) {
  section('E0. LE MODULE EN PANNE');
  ok(r.erreurs.length === 0, 'aucune erreur dans la page', r.erreurs.join(' | '));
  ok(r.alerte && /ne s’est pas chargée/.test(r.alerte.texte) && /réessayez/.test(r.alerte.texte) && r.alerte.scene === 'date' && !r.alerte.occupe,
    'le reseau refuse la demande : le clic le dit en clair, reste au premier ecran, le bouton ne reste pas en attente', JSON.stringify(r.alerte));
  ok(r.reprise && r.feuilles === 1, 'le reseau revenu, le clic suivant ouvre la demande, sans charger deux fois la feuille arrivee', `ouverte=${r.reprise} feuilles=${r.feuilles}`);
}
function verifierParcours(r, etiquette) {
  section(`E2. LE PARCOURS SUR MESURE (${etiquette})`);
  ok(r.erreurs.length === 0, 'aucune erreur dans la page', r.erreurs.join(' | '));
  ok(r.groupe && r.parcours === 'sur-mesure' && r.etapes.join('|') === 'Votre groupe|Date|Envies|Coordonnées|Envoi',
    'la demande a son propre fil d etapes', r.etapes.join('|'));
  ok(r.paxPrerempli === '31', 'le groupe du premier ecran passe a la demande', r.paxPrerempli);
  const ph = r.photos || [];
  ok(ph.length === 7 && ph.every(Boolean) && ph.every((p, i) => i === 0 || p !== ph[i - 1]),
    'chaque ecran de la demande a sa photo du centre, jamais celle de l ecran voisin (premier ecran et ecran final compris)', ph.join(' > '));
  ok(/type de groupe/.test(r.erreurType) && /école/i.test(r.labelOrg) && /nom de l’école/.test(r.erreurOrg), 'le type puis le nom de l ecole sont demandes, avec leur raison', `${r.erreurType} / ${r.labelOrg} / ${r.erreurOrg}`);
  ok(r.date && r.calendrier.sousLeChamp && r.calendrier.veilleGrise && /Pas le jour même/.test(r.calendrier.veilleTitre) && r.calendrier.cibleOuverte,
    'le calendrier s ouvre sur la demande : aujourd hui grise (pas le jour meme), le lendemain ouvert', JSON.stringify(r.calendrier));
  const m = Object.fromEntries(r.moments.map((x) => [x.id, x]));
  ok(m.matin && m.matin.refus && /24 h/.test(m.matin.petit) && m.soiree && !m.soiree.refus,
    'demain, a 15h la veille : le matin est refuse (moins de 24 h), la soiree reste possible', JSON.stringify(r.moments));
  ok(/Matin : Moins de 24 h/.test(r.pourquoi) && r.matinCoche === 'false', 'toucher le matin dit pourquoi, et ne le coche pas', `${r.pourquoi} / ${r.matinCoche}`);
  if (r.tardif) ok(r.tardif.matin.refus && /ouvre à/.test(r.tardif.matin.petit), `un jour qui ouvre a ${r.tardif.open}h : le matin dit que le centre ouvre plus tard`, JSON.stringify(r.tardif));
  ok(r.periodeAvant === false && r.periodeFlexible === true && r.datesFlexible === false && r.periodeApres === false,
    'A L ECRAN : la periode n apparait qu une fois la date dite « pas encore fixee », qui cache alors les dates', JSON.stringify({ avant: r.periodeAvant, flexible: r.periodeFlexible, dates: r.datesFlexible, apres: r.periodeApres }));
  ok(r.tvaAvant === false && r.tvaApres === true, 'A L ECRAN : le numero de TVA n apparait qu avec la facture', `${r.tvaAvant} -> ${r.tvaApres}`);
  ok(r.soireeCochee === 'true', 'la soiree se choisit');
  ok(r.envies && /31 joueurs et 2 accompagnateurs/.test(r.sousTitre) && /soirée/.test(r.sousTitre), 'les envies rappellent le groupe, la date et le moment', r.sousTitre);
  ok(/8 pistes, 6 joueurs par piste : tout le groupe en même temps/.test((r.cartes.bowling || {}).cap || ''), 'bowling : 8 pistes de 6, le groupe joue en meme temps', (r.cartes.bowling || {}).cap);
  ok(/30 joueurs par partie : vos 31 joueurs se relaient en 2 groupes/.test((r.cartes.laser_game || {}).cap || ''), 'laser : 30 par partie, 31 se relaient en 2 groupes', (r.cartes.laser_game || {}).cap);
  ok(/2 pistes, 6 joueurs par piste : vos 31 joueurs se relaient en 3 groupes/.test((r.cartes.duckpin_bowling || {}).cap || ''), 'duckpin : 2 pistes de 6, 31 joueurs en 3 groupes', (r.cartes.duckpin_bowling || {}).cap);
  ok(/Dès 7 ans et 1,30 m : les plus jeunes ne pourront pas jouer/.test((r.cartes.laser_game || {}).note || ''), 'des moins de 7 ans dans le groupe : le laser le dit (des 7 ans et 1,30 m)', (r.cartes.laser_game || {}).note);
  ok(r.continuerAvant === true, 'rien de coche : on ne continue pas');
  const regles = require('../lib/custom-request');
  const formules = require('../lib/booking-config').getEffectiveFormules('libramont');
  const ecartsF = formules.map((f) => {
    const attendu = regles.verdictFormuleSurMesure(f, { jour: r.cible, moment: 'soiree', participants: 31, ages: ['moins7', '7-12'] });
    const vu = r.formules[f.id];
    if (!vu) return `${f.id} absente`;
    if (vu.refus !== !attendu.ok || (vu.raison.trim() !== (attendu.raison || '')) || (vu.note.trim() !== (attendu.note || ''))) return `${f.id} ecran=${JSON.stringify(vu)} serveur=${JSON.stringify(attendu)}`;
    return '';
  }).filter(Boolean);
  ok(ecartsF.length === 0 && Object.values(r.formules).some((v) => v.refus), `les ${formules.length} formules disent a l ecran le verdict du serveur (raison exacte des refus)`, ecartsF.slice(0, 3).join(' ; '));
  ok(r.formules.mm && r.formules.mm.refus, 'le Matin Malin en soiree est refuse, avec sa raison', JSON.stringify(r.formules.mm));
  ok(r.kfdCochee === 'false', 'une formule refusee se touche pour lire sa raison, sans se cocher');
  ok(Boolean(r.formuleChoisie) && /2 activités et 1 formule/.test(r.compteur) && r.badges.join() === '2,1', 'le compteur et les onglets disent ce qui est choisi', `${r.compteur} / ${r.badges.join()}`);
  ok(r.contact && r.facture.visible && /École communale du gate/.test(r.facture.label), 'une ecole peut demander une facture a son nom', JSON.stringify(r.facture));
  ok(r.erreursContact === 5, 'les coordonnees vides sont refusees champ par champ', `${r.erreursContact} erreurs`);
  const recapLisible = r.recapTexte.replace(/\s+/g, ' ');
  ok(r.recap && r.blocs === 4 && /École communale du gate/.test(recapLisible)
    && recapLisible.includes('Bowling (31 joueurs · 1 heure) : 234 €')
    && recapLisible.includes('Laser Game (31 joueurs · 1 partie) : 310 €')
    && recapLisible.includes('Estimation des activités : 544 €') && /Institutrice/.test(recapLisible),
    'la relecture reprend le groupe, la date, les envies avec leurs effectifs, options et montants et les coordonnees', recapLisible.slice(0, 300));
  ok(r.fin && /Demande\s*envoyée/.test(r.finTitre) && /24 heures ouvrables/.test(r.finTexte) && /Rien n’est encore réservé/.test(r.finTexte), 'l ecran final dit le delai de reponse et que rien n est reserve', r.finTexte.slice(0, 200));
  const d = r.envoyee && r.envoyee.payload && r.envoyee.payload.demande;
  ok(Boolean(d) && d.participants === 31 && d.companions === 2 && d.date === r.cible.date && d.moment === 'soiree' && d.organisation === 'École communale du gate'
    && d.activities.map((a) => a.id).join() === 'bowling,laser_game'
    && d.activities.every(a => a.participants === 31) && d.activities[0].duration === 1 && d.activities[1].games === 1 && d.formulas.length === 1 && d.advice === true && d.budgetPerPerson === 22 && d.invoice === true && d.contactRole === 'Institutrice',
  'le VRAI gestionnaire a valide et garde ce que l ecran a montre (rien d ecrit, rien d envoye)', d ? JSON.stringify(d).slice(0, 240) : 'aucune demande recue');
  ok(r.debordements.length === 0, 'aucun ecran de la demande ne deborde en largeur', r.debordements.join(' '));
}

async function porteEtPerime(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const r = {};
  try {
    await page.goto(`${BASE_URL}/fungalaxy/libramont?v=sur-mesure-porte`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body.is-ready', { timeout: 20000 });
    await poserGroupe(page, 12);
    await page.click('#smDoorBtn');
    r.porte = await attendre(page, () => document.querySelector('.fg-scene[data-scene="sm-groupe"].is-active') !== null, 8000);
    r.pax = await page.inputValue('#smPax');
    await page.waitForTimeout(600);
    await page.click('.fg-scene.is-active [data-back]');
    r.retour = await attendre(page, () => document.querySelector('.fg-scene[data-scene="date"].is-active') !== null, 8000);
    await page.waitForTimeout(600);
    r.etapes = await page.evaluate(() => Array.from(document.querySelectorAll('.fg-scene.is-active .fg-steps__item .lbl')).map((x) => x.textContent.trim()).join('|'));
    await page.click('#goActivities');
    r.reservation = await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') !== null, 8000);
    return r;
  } finally { await ctx.close(); }
}
// Choisit un jour dans le calendrier ouvert par `bouton`, en allant au bon mois.
async function choisirJour(page, bouton, date) {
  await page.click(bouton);
  await page.waitForSelector('#dayPop:not([hidden])', { timeout: 5000 });
  for (let k = 0; k < 8 && !(await page.$(`.fg-cal__day[data-date="${date}"]`)); k += 1) {
    const mois = await page.evaluate(() => { const b = document.querySelector('.fg-cal__day[data-date]'); return b ? b.dataset.date.slice(0, 7) : ''; });
    await page.click(mois > date.slice(0, 7) ? '#calPrev' : '#calNext');
    await page.waitForTimeout(250);
  }
  await attendre(page, (d) => { const b = document.querySelector(`.fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, date);
  await page.click(`.fg-cal__day[data-date="${date}"]`);
  await page.waitForTimeout(300);
}

// L AUTRE DATE, A L ECRAN. Meme horloge que le parcours : la veille du jour
// vise, 15 h a Bruxelles. Un jour lointain le matin, puis une autre date qui
// ouvre l apres-midi (pas de matin), puis une autre date a moins de 24 heures.
async function autreDate(browser, mock) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const r = { erreurs: [] };
  page.on('pageerror', (e) => r.erreurs.push(e.message));
  try {
    const aujourdHui = jourBruxelles();
    const ouverts = mock.metaPayload('', 90).center.calendar.filter((j) => j.open && j.date > aujourdHui);
    const cible = ouverts.find((j) => j.schedule.open <= 10 && j.schedule.close >= 21) || ouverts[0];
    const loin = ouverts.find((j) => j.schedule.open <= 10 && j.date > plusJours(cible.date, 2));
    const tardif = ouverts.find((j) => j.schedule.open >= 11 && j.date > cible.date);
    r.montage = Boolean(loin && tardif);
    if (!r.montage) return r;
    r.dates = { cible: cible.date, loin: loin.date, tardif: tardif.date, ouvre: tardif.schedule.open };
    await page.clock.setFixedTime(instantBruxelles(plusJours(cible.date, -1), 15));
    await page.goto(`${BASE_URL}/fungalaxy/libramont?v=sur-mesure-autre`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body.is-ready', { timeout: 20000 });
    await poserGroupe(page, 40);
    await page.click('#goActivities');
    await attendre(page, () => document.querySelector('.fg-scene[data-scene="sm-groupe"].is-active') !== null, 8000);
    await page.waitForTimeout(600);
    await page.click('.fg-occasion[data-type="amis"]');
    r.orgAmis = await page.evaluate(() => getComputedStyle(document.getElementById('smOrgWrap')).display !== 'none');
    await page.click('#smGoDate');
    await attendre(page, () => document.querySelector('.fg-scene[data-scene="sm-date"].is-active') !== null, 8000);
    await page.waitForTimeout(600);
    await choisirJour(page, '#smDateBtn', loin.date);
    await page.click('.fg-sm-moment[data-moment="matin"]');
    r.matin = await page.evaluate(() => document.querySelector('.fg-sm-moment[data-moment="matin"]').getAttribute('aria-checked'));
    await choisirJour(page, '#smDate2Btn', tardif.date);
    r.tardif = (await page.textContent('#eSmDate2')).trim();
    await choisirJour(page, '#smDate2Btn', cible.date);
    r.demain = (await page.textContent('#eSmDate2')).trim();
    await page.click('#smGoEnvies');
    await page.waitForTimeout(400);
    r.bloque = await page.evaluate(() => ({ scene: document.querySelector('.fg-scene.is-active').dataset.scene, focus: document.activeElement ? document.activeElement.id : '' }));
    // L ecran est passe : la suite n a plus d objet (contre-epreuve).
    if (r.bloque.scene !== 'sm-date') return r;
    // Un moment qui convient aux deux dates leve le refus ; retirer l autre
    // date aussi.
    await page.click('.fg-sm-moment[data-moment="soiree"]');
    r.soiree = (await page.textContent('#eSmDate2')).trim();
    await page.click('.fg-sm-moment[data-moment="matin"]');
    r.encore = (await page.textContent('#eSmDate2')).trim();
    await page.click('#smDate2Clear');
    r.retiree = (await page.textContent('#eSmDate2')).trim();
    return r;
  } finally { await ctx.close(); }
}
function verifierAutreDate(r) {
  section('E4. L AUTRE DATE SUIT LA REGLE DE LA PREMIERE');
  if (!ok(r.montage, 'MONTAGE le calendrier offre un jour lointain qui ouvre le matin et un jour qui ouvre l apres-midi', JSON.stringify(r.dates || {}))) return;
  ok(r.erreurs.length === 0, 'aucune erreur dans la page', r.erreurs.join(' | '));
  ok(r.matin === 'true', 'MONTAGE un jour lointain : le matin se choisit', r.matin);
  ok(r.orgAmis === false, 'A L ECRAN : un groupe d amis ne se voit demander aucun nom d organisation', String(r.orgAmis));
  ok(/^Autre date \(matin\) : Le centre ouvre à \d{1,2}h(\d\d)? ce jour-là\.$/.test(r.tardif), `une autre date qui ouvre a ${r.dates.ouvre}h : pas de matin, dit sous l autre date`, r.tardif);
  ok(r.demain === 'Autre date (matin) : Moins de 24 h d’ici là.', 'une autre date a moins de 24 heures : refusee, dit sous l autre date', r.demain);
  ok(r.bloque.scene === 'sm-date' && r.bloque.focus === 'smDate2Btn', 'l ecran ne continue pas, le focus va a l autre date', JSON.stringify(r.bloque));
  ok(r.soiree === '' && r.encore !== '' && r.retiree === '', 'un moment qui convient aux deux dates leve le refus, le matin le ramene, retirer l autre date le leve', `${r.soiree} / ${r.encore} / ${r.retiree}`);
}

function verifierPorte(r) {
  section('E3. LA PORTE DES GROUPES ORGANISES');
  ok(r.porte && r.pax === '12', 'une ecole de 12 ouvre la demande par la porte, son groupe prerempli', `pax=${r.pax}`);
  ok(r.retour && r.etapes === 'Date & groupe|Activités|Horaires|Coordonnées|Validation', 'Retour ramene au premier ecran, avec le fil de la reservation', r.etapes);
  ok(r.reservation, 'sous le seuil, la reservation en ligne reste le chemin normal');
}

// ---------------------------------------------------------------------------
// [F] LA CONSOLE
// ---------------------------------------------------------------------------
function demandeConsole() {
  return {
    id: 77, centerId: 'libramont', contactName: 'Camille Gate', company: 'École communale du gate', email: 'camille@example.test', phone: '0471 12 34 56',
    requestedDate: 'samedi 21 novembre 2026, soirée', pax: 31, occasion: 'ecole', message: 'Pique-nique a prevoir.', source: 'client', status: 'new', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    payload: { demande: {
      version: 1, groupType: 'ecole', groupTypeLabel: 'École, jeunesse', organisation: 'École communale du gate', participants: 31, companions: 2, ages: ['moins7', '7-12'],
      flexible: false, date: '2026-11-21', alternativeDate: '', period: '', moment: 'soiree', momentLabel: 'Soirée',
      activities: [{ id: 'bowling', name: 'Bowling' }, { id: 'laser_game', name: 'Laser Game' }], formulas: [{ id: 'f4', name: 'FORMULE 4' }], advice: true, budgetPerPerson: 22,
      contactRole: 'Institutrice', invoice: true, vatNumber: 'BE 0123.456.789',
    } },
  };
}
async function console_(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const { normalizeCenterConfig } = require('../lib/center-config');
  const config = normalizeCenterConfig({}, 'libramont');
  const CONFIG = { ok: true, centers: [{ id: 'libramont', name: 'Fun Galaxy Libramont', ...config, clientId: null, clientName: null }], activities: [] };
  await page.addInitScript(({ expiresAt, CONFIG, DEMANDE }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'settings.manage', 'direction.view', 'centers.switch', 'reservations.edit'];
    const session = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: 'qa-fixe' } });
    const natif = window.fetch.bind(window);
    window.__ENVOIS__ = [];
    window.fetch = async (input, init = {}) => {
      const u = new URL(typeof input === 'string' ? input : (input && input.url) || '', window.location.origin);
      const methode = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: {}, centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/ops' && methode === 'POST') { window.__ENVOIS__.push(JSON.parse(init.body || '{}')); return J({ ok: true }); }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'centerConfig') return J(CONFIG);
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'customRequests') return J({ ok: true, centerId: 'libramont', customRequests: [DEMANDE] });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {}, blocks: [] });
      return natif(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session));
  }, { expiresAt, CONFIG, DEMANDE: demandeConsole() });
  try {
    await page.goto(`${BASE_URL}/?v=sur-mesure-console`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.openStaffCustomRequest === 'function', null, { timeout: 20000 });
    await page.evaluate(() => { setView('staff'); });
    await page.evaluate(async () => { await loadStaffCustomRequests(true); });
    await page.waitForTimeout(300);
    const carte = await page.evaluate(() => { const d = document.createElement('div'); d.innerHTML = renderStaffCustomRequestCard(getStaffCustomRequestItems()[0]); return d.textContent.replace(/\s+/g, ' ').trim(); });
    // Une demande s ouvre dans SON dossier, sur la page des demandes (la fiche
    // en surimpression est retiree le 2026-09-29 : deux rendus, et une reponse
    // envoyee depuis la fiche ne se rangeait pas dans le suivi).
    await page.evaluate(() => openStaffCustomRequest(77));
    await page.waitForSelector('.req-detail[data-request-id="77"]', { timeout: 8000 });
    const fiche = await page.evaluate(() => document.querySelector('.req-detail[data-request-id="77"]').innerText.replace(/\s+/g, ' ').trim());
    // Etablissement : le seuil se lit et se regle.
    await page.evaluate(() => { state.staffMenuPage = 'establishment'; state.establishmentTab = 'offres'; state.establishmentEditing = false; save(); setView('staff'); });
    await page.waitForSelector('.estab-tabs button', { state: 'visible', timeout: 20000 });
    await page.evaluate(() => { startEstablishmentEdit(); setEstablishmentTab('offres'); });
    await page.waitForSelector('#estab-customRequestFromPax', { state: 'attached', timeout: 10000 });
    const champ = await page.inputValue('#estab-customRequestFromPax');
    const envoye = await page.evaluate(async () => {
      document.getElementById('estab-customRequestFromPax').value = '25';
      window.__ENVOIS__ = [];
      await submitCenterConfig('libramont');
      const a = window.__ENVOIS__.find((b) => b.action === 'saveCenterConfig');
      await startEstablishmentEdit(); setEstablishmentTab('offres');
      document.getElementById('estab-customRequestFromPax').value = '';
      window.__ENVOIS__ = [];
      await submitCenterConfig('libramont');
      const b = window.__ENVOIS__.find((x) => x.action === 'saveCenterConfig');
      return { a: a ? a.config.customRequest : null, b: b ? b.config.customRequest : null };
    });
    return { carte, fiche, champ, envoye, erreurs };
  } finally { await ctx.close(); }
}
function verifierConsole(r) {
  section('F. LA CONSOLE');
  ok(r.erreurs.length === 0, 'MONTAGE la console s ouvre sans erreur', r.erreurs.join(' | '));
  ok(/École communale du gate/.test(r.carte) && /31 joueurs \+ 2 accompagnateurs/.test(r.carte) && /2 activités, 1 formule, conseil demandé/.test(r.carte), 'la carte de la liste dit le groupe et les envies', r.carte);
  ok(/La demande/.test(r.fiche) && /31 joueurs \+ 2 accompagnateurs/.test(r.fiche) && /Moins de 7 ans, 7 à 12 ans/.test(r.fiche) && /Soirée/.test(r.fiche)
    && /Bowling/.test(r.fiche) && /Laser Game/.test(r.fiche) && /FORMULE 4/.test(r.fiche) && /Conseil demandé/.test(r.fiche)
    && /22 € par personne/.test(r.fiche) && /Au nom de École communale du gate/.test(r.fiche) && /BE 0123\.456\.789/.test(r.fiche) && /Institutrice/.test(r.fiche) && /Pique-nique/.test(r.fiche),
  'le dossier dit tout : groupe, ages, moment, envies, budget, facture, fonction, le mot du client', r.fiche.slice(0, 260));
  ok(r.champ === '31', 'Etablissement montre le seuil du centre (31)', r.champ);
  ok(r.envoye && r.envoye.a && r.envoye.a.fromPax === 25 && r.envoye.b && r.envoye.b.fromPax === null, 'le seuil se regle (25), et se retire (vide = jamais)', JSON.stringify(r.envoye));
  if (r.envoye && r.envoye.b) {
    const { normalizeCenterConfig } = require('../lib/center-config');
    const { mergeCenterConfig, customRequestFromPax } = require('../lib/center-config');
    const garde = normalizeCenterConfig({ customRequest: r.envoye.b }, 'libramont');
    const socle = require('../ops-knowledge/centers.json').centers.find((c) => c.id === 'libramont');
    ok(customRequestFromPax(mergeCenterConfig(socle, garde)) === null, 'vide, garde par le serveur, il prime sur le fichier socle : plus aucune demande obligatoire');
  }
}

// ---------------------------------------------------------------------------
// [G] CONTRE-EPREUVES
// ---------------------------------------------------------------------------
async function contreEpreuves(browser, mock) {
  section('G. CONTRE-EPREUVES');
  const MUTATIONS = [
    {
      fichier: 'lib/custom-request.js',
      ancre: 'const DELAI_MIN_HEURES = 24;',
      mute: 'const DELAI_MIN_HEURES = 0;',
      label: 'sans les 24 heures, demain matin se demande a 15h',
      rouge: async () => { const S = chargerServeur(); return S.regles.verdictMoment({ date: plusJours(jourBruxelles(), 1), moment: 'matin', today: jourBruxelles(), nowHour: 15, schedule: { open: 10, close: 22 } }).ok; },
    },
    {
      fichier: 'lib/custom-request.js',
      ancre: "    if (!v.ok) return refus(`${f.name} : ${v.raison}`, 'formulas');",
      mute: '',
      label: 'sans le verdict des formules, le Kids Fun Day passe un samedi',
      rouge: async () => { const r = await reglesServeur(chargerServeur()); return r.kfdSamedi.status === 201; },
    },
    {
      fichier: 'lib/custom-request.js',
      ancre: "      if (!vAlt.ok) return refus(`Autre date (${MOMENTS[moment].label.toLowerCase()}) : ${vAlt.raison}`, 'alternativeDate');",
      mute: '',
      label: 'sans la regle de l autre date, un matin se demande en second choix un jour qui ouvre l apres-midi',
      rouge: async () => { const r = await reglesServeur(chargerServeur()); return r.autreSansMatin.status === 201; },
    },
    {
      fichier: 'lib/demande-publique.js',
      ancre: '  if (seuilSurMesure && effectif >= seuilSurMesure) {',
      mute: '  if (false) {',
      label: 'sans la garde, 31 personnes reservent en ligne',
      rouge: async () => { const g = await reglesGarde(chargerServeur()); return !g.est(g.r.a31); },
    },
    {
      fichier: 'lib/demande-publique.js',
      ancre: "    + Math.max(0, Math.trunc(Number(body && body.companions) || 0));",
      mute: '    + 0;',
      label: 'sans les accompagnants, 25 enfants + 6 adultes passent en ligne',
      rouge: async () => { const g = await reglesGarde(chargerServeur()); return !g.est(g.r.enfants); },
    },
    {
      fichier: 'api/public-booking-meta.js',
      ancre: '  return [...ids].filter((id) => availability[id] === false);',
      mute: '  return [];',
      label: 'sans les activites manquantes, Gembloux propose une plaine de jeux qu il n a pas',
      rouge: async () => { const c = await reglesCatalogue(chargerServeur()); return !((c.gem.formules || []).find((f) => f.id === 'f6') || {}).missingActivityIds; },
    },
    {
      fichier: 'api/public-booking-meta.js',
      ancre: '    .filter((step) => step && step.activityId && !estUnService(step))',
      mute: '    .filter((step) => step && step.activityId)',
      label: 'sans l exception des services du bar, la donnee de prod vide l onglet Formules de Libramont',
      rouge: async () => { const c = await reglesCatalogue(chargerServeur()); return (c.libProd.formules || []).some((f) => f.missingActivityIds); },
    },
  ];
  for (const m of MUTATIONS) {
    const chemin = path.join(ROOT, m.fichier);
    const original = fs.readFileSync(chemin, 'utf8');
    const ancre = original.indexOf('\r\n') >= 0 ? m.ancre : m.ancre.replace(/\r\n/g, '\n');
    const compte = original.split(ancre).length - 1;
    if (!ok(compte === 1, `contre-epreuve montable : « ${ancre.trim().slice(0, 60)}… » une seule fois dans ${m.fichier}`, `${compte} occurrence(s)`)) continue;
    let rouge = false;
    const extension = path.extname(chemin), loader = require.extensions[extension];
    const mutated = original.split(ancre).join(m.mute);
    // La contre-preuve compile uniquement dans ce processus, sans mutation disque.
    require.extensions[extension] = (module, filename) => {
      if (filename !== chemin) return loader(module, filename);
      if (extension === '.json') module.exports = JSON.parse(mutated);
      else module._compile(mutated, filename);
    };
    try {
      viderCache();
      rouge = await m.rouge();
    } catch (error) {
      rouge = true;
    } finally {
      require.extensions[extension] = loader;
      viderCache();
    }
    ok(rouge, `${m.label} : ce gate ROUGIRAIT`);
    ok(fs.readFileSync(chemin, 'utf8') === original, `${m.fichier} restaure a l identique`);
  }
  const montable = (c, quoi) => ok(sourceServie(c.fichier).split(c.de).length === 2, `contre-epreuve montable : ${quoi} une seule fois dans ${c.fichier}`);
  // Le formulaire : sans le seuil, 31 personnes partent vers les activites.
  tunnelCasse = { fichier: 'fungalaxy-booking.js', de: '  function grandGroupe() { var s = seuilSurMesure(); return Boolean(s && state.pax >= s); }', vers: '  function grandGroupe() { return false; }' };
  if (montable(tunnelCasse, 'grandGroupe')) {
    const p = await premierEcran(browser);
    ok(p.a31.bouton === 'Choisir mes activités' && !p.a31.encart, 'sans le seuil, 31 personnes partent en reservation en ligne : ce gate ROUGIRAIT', JSON.stringify(p.a31));
  }
  // Le formulaire : la demande chargee des l ouverture de la page (ce que le
  // chargement a la demande evite) se voit a 30 personnes.
  tunnelCasse = { fichier: 'fungalaxy-booking.js', de: '  function prechargerSurMesure() { chargerSurMesure().catch(function () {}); }', vers: '  function prechargerSurMesure() { chargerSurMesure().catch(function () {}); }\n  setTimeout(prechargerSurMesure, 0);' };
  if (montable(tunnelCasse, 'prechargerSurMesure')) {
    const p = await premierEcran(browser);
    ok(p.a30.demandes.length > 0 || p.a30.module !== 'undefined', 'la demande chargee au demarrage se voit a 30 personnes : ce gate ROUGIRAIT', JSON.stringify({ d: p.a30.demandes, m: p.a30.module }));
  }
  // La feuille de la demande : sans la regle des champs caches, le nom
  // d organisation reste a l ecran pour un groupe d amis.
  tunnelCasse = { fichier: 'fungalaxy-sur-mesure.css', de: '.fg-field[hidden] { display: none; }', vers: '' };
  if (montable(tunnelCasse, 'la regle des champs caches')) {
    const a = await autreDate(browser, mock);
    ok(a.orgAmis === true, 'sans la regle, le nom d organisation reste affiche pour des amis : ce gate ROUGIRAIT', String(a.orgAmis));
  }
  // Le module : sans le miroir de l autre date, rien ne se dit sous elle.
  tunnelCasse = { fichier: 'fungalaxy-sur-mesure.js', de: '    function verdictAltSm() {\n', vers: "    function verdictAltSm() { return { ok: true, raison: '' };\n" };
  if (montable(tunnelCasse, 'verdictAltSm')) {
    const a = await autreDate(browser, mock);
    ok(a.montage && a.tardif === '' && a.demain === '' && a.bloque && a.bloque.scene !== 'sm-date', 'sans le miroir, l autre date passe sans un mot : ce gate ROUGIRAIT', JSON.stringify({ t: a.tardif, d: a.demain, b: a.bloque }));
  }
  tunnelCasse = null;
  // Code restaure : le serveur redit la verite.
  const S = chargerServeur();
  const apres = await reglesServeur(S);
  const g = await reglesGarde(S);
  ok(apres.kfdSamedi.status === 422 && g.est(g.r.a31) && g.est(g.r.enfants), 'code restaure : les refus sont revenus');
}

async function main() {
  const S = chargerServeur();
  verifierRegles(S);
  verifierServeur(await reglesServeur(S));
  verifierGarde(await reglesGarde(S));
  verifierCatalogue(await reglesCatalogue(S));

  viderCache();
  const mock = require('./dev-tunnel-server');
  const { chromium } = require('playwright-core');
  const srv = await serveur(mock);
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    verifierPremierEcran(await premierEcran(browser));
    verifierSansSeuil(await sansSeuil(browser));
    verifierPanne(await panneModule(browser));
    verifierParcours(await parcours(browser, mock), 'bureau');
    verifierParcours(await parcours(browser, mock, { largeur: 390, hauteur: 844 }), 'telephone');
    verifierAutreDate(await autreDate(browser, mock));
    verifierPorte(await porteEtPerime(browser));
    verifierConsole(await console_(browser));
    await contreEpreuves(browser, mock);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${echecs === 0 ? 'sur-mesure-check: ALL OK' : `sur-mesure-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
