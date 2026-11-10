// LES REGLES DE RESERVATION EN LIGNE D UN CENTRE (2026-11-10, lot 3 de la page Etablissement).
//
// Un centre dit jusqu a quand (la veille, deux jours avant) et combien de temps a l avance son formulaire
// accepte une date. La regle se pose aux deux portes publiques, l affichage des heures et l envoi, et nulle
// part ailleurs : le personnel, reconnu a sa session, garde toutes les heures, et le moteur ne la lit pas
// (une reservation du comptoir passe par le meme plancher que le client, la regle l y aurait enferme aussi).
//
//   [A] le reglage se borne : 0 a 30 jours avant, 1 a 365 jours a l avance, vide = un an
//   [B] l affichage des heures : le visiteur lit le refus et sa raison, le personnel garde ses heures
//   [C] l envoi : la meme date est refusee, avec le meme message
//   [D] sans reglage, rien ne change ; le moteur ne lit pas la regle
//   --mutate : une porte retiree, ou la regle etendue au personnel, fait rougir
//
// Les dates se comptent depuis aujourd hui (aucune horloge figee, aucun jour d ouverture suppose) : un refus se
// reconnait a son message, un passage au fait que ce message n y est pas.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LF = '\n';
const CRLF = '\r\n';

const MUTATIONS = [
  {
    nom: 'l affichage des heures oublie le « au plus tard » du centre',
    fichier: 'api/public-availability.js',
    de: "      if (bookingDateTooSoon(date, reglesEnLigne.minDaysAhead)) {\n        sendJson(res, 200, { ok: true, date, slots: [], message: messageDateTropProche(reglesEnLigne.minDaysAhead) });\n        return;\n      }\n",
    vers: '',
    attendu: ['[B]'],
  },
  {
    nom: 'l envoi oublie le « au plus tard » du centre',
    fichier: 'lib/demande-publique.js',
    de: "  if (bookingDateTooSoon(body && body.date, reglesEnLigne.minDaysAhead)) {\n    return { ok: false, status: 422, message: messageDateTropProche(reglesEnLigne.minDaysAhead) };\n  }\n",
    vers: '',
    attendu: ['[C]'],
  },
  {
    nom: 'la regle tombe aussi sur le personnel',
    fichier: 'api/public-availability.js',
    de: "    if (res.__visiteurAnonyme) {\n      const reglesEnLigne = reglesDeReservation(centerDoc);\n",
    vers: "    if (res) {\n      const reglesEnLigne = reglesDeReservation(centerDoc);\n",
    attendu: ['[B]'],
  },
];

const MUTATION_PREUVE = '[mutation] servie :';
const MUTATION_ACTIVE = Number(process.env.PINLANE_REGLES_MUTATION || 0);
const MUTATION = MUTATION_ACTIVE ? MUTATIONS[MUTATION_ACTIVE - 1] : null;
function muter(contenu, mutation) {
  const texte = contenu.split(CRLF).join(LF);
  if (texte.split(mutation.de).length - 1 !== 1) {
    console.error(`mutation impossible : ancre absente ou multiple dans ${mutation.fichier} : ${mutation.de.slice(0, 70)}`);
    process.exit(2);
  }
  console.log(`${MUTATION_PREUVE} ${mutation.nom}`);
  return texte.split(mutation.de).join(mutation.vers);
}
// La mutation se sert EN MEMOIRE, avant tout require applicatif : aucun fichier n est ecrit.
if (MUTATION) {
  const Module = require('module');
  const compile = Module.prototype._compile;
  const cible = path.resolve(ROOT, MUTATION.fichier);
  Module.prototype._compile = function (contenu, nom) {
    if (path.resolve(nom) === cible) return compile.call(this, muter(contenu, MUTATION), nom);
    return compile.call(this, contenu, nom);
  };
}

let failures = 0;
function ok(condition, message, detail) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}${detail !== undefined && detail !== '' ? `  ${detail}` : ''}`);
  if (!condition) failures += 1;
  return condition;
}
function section(titre) { console.log(`\n${titre}`); }

async function main() {
  const bookingConfig = require('../lib/booking-config');
  const database = require('../lib/database');
  database.readAvailabilitySnapshot = async (date, centerId) => ({ reservations: [], laneStatuses: {}, blocks: [], date, centerId });
  database.readStaffState = database.readAvailabilitySnapshot;
  // Le personnel : une session que la porte reconnait, sans base.
  const staffAuth = require('../lib/staff-auth');
  staffAuth.getStaffSessionFromRequest = async (req) => ((req.headers || {})['x-staff-session'] === 'qa' ? { memberId: 'qa', centerId: 'libramont', roleId: 'direction' } : null);
  const dispo = require('../api/public-availability');
  const { applyCenterOverrides, getCenter } = require('../lib/ops-knowledge');
  const { normalizeCenterConfig } = require('../lib/center-config');
  const { ouvrirDemandePublique } = require('../lib/demande-publique');

  const aujourdhui = bookingConfig.todayStr();
  const dans = (jours) => {
    const [y, m, d] = aujourdhui.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + jours)).toISOString().slice(0, 10);
  };
  const VEILLE = bookingConfig.messageDateTropProche(1);
  const LOIN = bookingConfig.messageDateTropLoin(30);
  const poser = (regles) => applyCenterOverrides(regles ? new Map([['libramont', { bookingRules: regles }]]) : new Map());

  let ip = 0;
  const heures = async (date, { personnel = false } = {}) => {
    ip += 1;
    const adresse = `10.9.${ip % 250}.${1 + (ip % 200)}`;
    const req = {
      method: 'GET',
      url: `/api/public-availability?${new URLSearchParams({ centerId: 'libramont', pax: '6', type: 'bowling', duration: '1', date }).toString()}`,
      headers: { host: 'localhost', 'x-forwarded-for': adresse, ...(personnel ? { 'x-staff-session': 'qa' } : {}) },
      socket: { remoteAddress: adresse },
    };
    const res = { statusCode: 200, headers: {}, body: '' };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.getHeader = (k) => res.headers[k];
    res.writeHead = (code) => { res.statusCode = code; };
    res.end = (b) => { res.body = b === undefined ? '' : String(b); };
    await dispo(req, res);
    try { return JSON.parse(res.body || '{}'); } catch (error) { return {}; }
  };
  const envoi = async (date) => {
    try { return await ouvrirDemandePublique({ centerId: 'libramont', date, pax: 6 }); } catch (error) { return { ok: false, message: `(la porte a laisse passer, la suite demande la base : ${String(error.message).slice(0, 60)})` }; }
  };

  section('[A] Le reglage se borne');
  const regle = (x) => normalizeCenterConfig({ bookingRules: x }, 'libramont').bookingRules;
  ok(JSON.stringify(regle(undefined)) === '{"minDaysAhead":0,"horizonDays":null}', '[A] sans reglage : jusqu au dernier moment, un an a l avance', JSON.stringify(regle(undefined)));
  ok(JSON.stringify(regle({ minDaysAhead: 99, horizonDays: 9999 })) === '{"minDaysAhead":30,"horizonDays":365}', '[A] 99 jours avant et 9999 jours a l avance se bornent a 30 et 365', JSON.stringify(regle({ minDaysAhead: 99, horizonDays: 9999 })));
  ok(JSON.stringify(regle({ minDaysAhead: 'abc', horizonDays: '' })) === '{"minDaysAhead":0,"horizonDays":null}', '[A] une valeur illisible retombe sur le defaut', JSON.stringify(regle({ minDaysAhead: 'abc', horizonDays: '' })));

  section('[B] L affichage des heures');
  poser({ minDaysAhead: 1, horizonDays: 30 });
  ok(JSON.stringify(getCenter('libramont').bookingRules) === '{"minDaysAhead":1,"horizonDays":30}', 'MONTAGE le centre porte la regle : la veille au plus tard, 30 jours a l avance', JSON.stringify(getCenter('libramont').bookingRules));
  const vJour = await heures(aujourdhui);
  ok(vJour.message === VEILLE && Array.isArray(vJour.slots) && vJour.slots.length === 0, '[B] le visiteur, pour aujourd hui : aucune heure, et la raison dite', `${(vJour.slots || []).length} heure(s) ; « ${vJour.message || ''} »`);
  const vDemain = await heures(dans(1));
  ok(vDemain.message !== VEILLE && vDemain.message !== LOIN, '[B] le visiteur, pour demain : la regle ne refuse pas', `« ${vDemain.message || ''} »`);
  const vLoin = await heures(dans(31));
  ok(vLoin.message === LOIN && Array.isArray(vLoin.slots) && vLoin.slots.length === 0, '[B] le visiteur, dans 31 jours : aucune heure, et la raison dite', `« ${vLoin.message || ''} »`);
  const vBord = await heures(dans(30));
  ok(vBord.message !== LOIN, '[B] le visiteur, dans 30 jours pile : encore accepte', `« ${vBord.message || ''} »`);
  const pJour = await heures(aujourdhui, { personnel: true });
  const pLoin = await heures(dans(31), { personnel: true });
  ok(pJour.message !== VEILLE && pLoin.message !== LOIN, '[B] le personnel garde ses heures : ni aujourd hui ni dans 31 jours ne lui sont refuses', `« ${pJour.message || ''} » ; « ${pLoin.message || ''} »`);

  section('[C] L envoi');
  const eJour = await envoi(aujourdhui);
  ok(eJour.ok === false && eJour.status === 422 && eJour.message === VEILLE, '[C] envoyer pour aujourd hui : refuse, avec le message de l affichage', `${eJour.status} « ${eJour.message || ''} »`);
  const eLoin = await envoi(dans(31));
  ok(eLoin.ok === false && eLoin.status === 422 && eLoin.message === LOIN, '[C] envoyer pour dans 31 jours : refuse, avec le message de l affichage', `${eLoin.status} « ${eLoin.message || ''} »`);
  const eDemain = await envoi(dans(1));
  ok(eDemain.message !== VEILLE && eDemain.message !== LOIN, '[C] envoyer pour demain : la regle ne refuse pas', `« ${eDemain.message || ''} »`);

  section('[D] Sans reglage, rien ne change');
  poser(null);
  const sJour = await heures(aujourdhui);
  const sLoin = await heures(dans(31));
  const sEnvoi = await envoi(aujourdhui);
  ok(sJour.message !== VEILLE && sLoin.message !== LOIN && sEnvoi.message !== VEILLE, '[D] un centre qui n a rien regle : aujourd hui et dans 31 jours passent les deux portes', `« ${sJour.message || ''} » ; « ${sLoin.message || ''} » ; « ${sEnvoi.message || ''} »`);
  const moteur = fs.readFileSync(path.join(ROOT, 'lib/ops-engine.js'), 'utf8');
  ok(!/bookingRules|minDaysAhead|reglesDeReservation/.test(moteur), '[D] le moteur ne lit pas la regle : le comptoir, qui passe par lui, n est pas touche');

  if (failures) {
    console.error(`\nregles-reservation-check: ${failures} defaut(s).`);
    // Le code de sortie se pose, le processus finit seul : sous Windows, process.exit() pendant que la base
    // absente referme ses essais coupe le processus avec un code de plantage, et la contre-epreuve ne lit plus 1.
    process.exitCode = 1;
    return;
  }
  console.log('\nregles-reservation-check: ALL OK (la regle du centre tient les deux portes publiques, le personnel et le moteur n en savent rien)');
}

if (process.argv.includes('--mutate')) {
  const empreintes = new Map(MUTATIONS.map((x) => [x.fichier, fs.readFileSync(path.join(ROOT, x.fichier), 'utf8')]));
  let defauts = 0;
  MUTATIONS.forEach((mutation, index) => {
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, PINLANE_REGLES_MUTATION: String(index + 1) }, encoding: 'utf8', timeout: 300000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const servie = sortie.includes(`${MUTATION_PREUVE} ${mutation.nom}`);
    const rougit = r.status === 1 && mutation.attendu.every((lettre) => sortie.split('\n').some((l) => l.startsWith('FAIL') && l.includes(lettre)));
    if (r.status === 2 || !servie) { defauts += 1; console.error(`contre-epreuve DESARMEE : ${mutation.nom} (${r.status === 2 ? 'ancre introuvable' : 'mutation non servie'})`); }
    else if (!rougit) { defauts += 1; console.error(`contre-epreuve MUETTE : le gate reste vert quand ${mutation.nom}.`); }
    else console.log(`contre-epreuve OK : le gate rougit quand ${mutation.nom}.`);
  });
  const touche = [...empreintes].filter(([f, avant]) => fs.readFileSync(path.join(ROOT, f), 'utf8') !== avant);
  if (touche.length) { defauts += 1; console.error(`un fichier a ete ecrit : ${touche.map(([f]) => f).join(', ')}`); }
  if (defauts) { console.error(`\nregles-reservation-check --mutate: ${defauts} defaut(s).`); process.exit(1); }
  console.log(`contre-epreuve OK : ${MUTATIONS.length} mutations, et aucun fichier n a ete ecrit.`);
} else {
  main().catch((error) => { console.error(error); process.exit(1); });
}
