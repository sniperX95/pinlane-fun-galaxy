// L ACCUSE D UNE DEMANDE DE GROUPE MONTRE SA CARTE (2026-11-18, avant-lancement C8).
//
// buildCustomRequestAck rendait ses details en paires [libelle, valeur]. La carte du mail (detailRows,
// lib/ops-communications.js) ne lit que des { label, value } et les ecartait toutes : le client ne
// relisait jamais sa demande (groupe, date, participants, activites).
//
// [D] les details de l accuse sont des { label, value }, pour une demande du formulaire de groupe
//     comme pour une ancienne demande (occasion, societe).
// [E] le mail que sendCustomRequestAck poste a Resend (fetch remplace, aucun envoi, aucune base)
//     porte la carte, chaque ligne avec sa valeur echappee, et garde ses deux liens (telephone et
//     adresse du centre). La carte n en ajoute aucun.
// [P] la carte montre des mots du client (organisation, societe, date libre). Une adresse web ou un
//     bouton piege qu il y aurait ecrit ne repart pas dans le mail du centre, sans reste visible, et
//     une ligne qui n etait qu un piege disparait.
//
// Les contre-preuves chargent le code mute en memoire : aucun fichier n est ecrit.
// Lancement : node scripts/accuse-groupe-carte-check.js [--contre-preuves]

'use strict';

const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
['DATABASE_URL', 'POSTGRES_URL', 'RESEND_FROM'].forEach((cle) => { delete process.env[cle]; });

const MUTATIONS = {
  paires: { f: 'lib/ops-communications.js', de: "  ]).filter(Boolean)\n    .map(([label, value]) => ({ label, value: sansBalisage(sansPiege(value)).replace(/[\\s,]+$/, '') }))\n    .filter((detail) => detail.value);\n", vers: '  ]).filter(Boolean);\n', lettre: 'E' },
  'valeur-brute': { f: 'lib/ops-communications.js', de: "({ label, value: sansBalisage(sansPiege(value)).replace(/[\\s,]+$/, '') })", vers: '({ label, value })', lettre: 'P' },
};
const MUTATION = (process.argv.find((a) => a.startsWith('--mutation=')) || '').slice('--mutation='.length);
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`mutation inconnue : ${MUTATION}`); process.exit(2); }
function muter(fichier, texte) {
  const m = MUTATION ? MUTATIONS[MUTATION] : null;
  const t = String(texte).split('\r\n').join('\n');
  if (!m || path.resolve(fichier) !== path.join(ROOT, m.f)) return t;
  if (t.split(m.de).length !== 2) throw new Error(`ANCRE DE MUTATION absente ou multiple (${MUTATION}) dans ${m.f}`);
  return t.split(m.de).join(m.vers);
}
const compiler = Module.prototype._compile;
Module.prototype._compile = function compilerMute(contenu, fichier) {
  return compiler.call(this, muter(fichier, contenu), fichier);
};

let rouges = 0;
let lettre = '';
function section(titre) { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); }
function ok(condition, quoi, detail) {
  if (condition) { console.log(`ok    ${quoi}`); return; }
  rouges += 1;
  console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(detail).slice(0, 400)}` : ''}`);
}

if (process.argv.includes('--contre-preuves')) {
  const temoin = spawnSync(process.execPath, [__filename], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  if (temoin.status !== 0) { console.log(`${temoin.stdout || ''}${temoin.stderr || ''}`.split('\n').filter((l) => /ROUGE|Error/.test(l)).join('\n')); console.log('\naccuse-groupe-carte-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte'); process.exit(1); }
  let rates = 0;
  for (const [nom, m] of Object.entries(MUTATIONS)) {
    const r = spawnSync(process.execPath, [__filename, `--mutation=${nom}`], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const mord = r.status === 1 && sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION/.test(sortie);
    if (!mord) rates += 1;
    console.log(`${mord ? 'TUEE ' : 'VIVANTE'} ${nom} (attendu : ROUGE [${m.lettre}], sortie ${r.status})${mord ? '' : `\n${sortie.split('\n').filter((l) => /ROUGE|ANCRE|Error/.test(l)).slice(0, 6).join('\n')}`}`);
  }
  console.log(rates ? `\naccuse-groupe-carte-check --contre-preuves: ${rates} mutation(s) vivante(s)` : '\naccuse-groupe-carte-check --contre-preuves: ALL OK - chaque regle retiree fait rougir sa lettre');
  process.exit(rates ? 1 : 0);
}

const custom = require('../lib/custom-request');
const { listCenterActivities } = require('../lib/activity-catalog');
const { jourDeTest, plusJours } = require('./jour-de-test');
const comms = require('../lib/ops-communications');

// Une demande du formulaire de groupe, normalisee comme le serveur la recoit.
const date = jourDeTest({ jour: 6 });
const contexte = { today: plusJours(date, -7), nowHour: 12, horizonDays: 180, activites: listCenterActivities('libramont'), formules: [],
  jourDe: () => ({ open: true, schedule: { open: 10, close: 23 }, weekday: 6 }) };
const normalisee = custom.normaliserDemande({ groupType: 'entreprise', organisation: 'Acme <b>&</b> Co', participants: 12, companions: 3, moment: 'apres-midi', date,
  activities: [{ id: 'bowling', participants: 12 }, { id: 'laser_game', participants: 10 }], formulas: [] }, contexte);
if (!normalisee.ok) throw new Error(`demande de groupe refusee : ${JSON.stringify(normalisee)}`);
const GROUPE = {
  centerId: 'libramont', id: 4242, email: 'sophie.martin@exemple.be', contactName: 'Sophie Martin', company: '',
  occasion: 'entreprise', requestedDate: custom.libelleQuand(normalisee.demande), pax: 12,
  message: 'Pour un départ à la retraite.', demande: normalisee.demande,
};
const ANCIENNE = { centerId: 'libramont', id: 4243, email: 'paul@exemple.be', contactName: 'Paul', occasion: 'anniversaire', requestedDate: '12 décembre', pax: 20, company: 'Société <i>X</i>' };

section('[D] les details de l accuse sont des { label, value }');
const forme = (details) => Array.isArray(details) && details.length > 0 && details.every((d) => d && !Array.isArray(d) && typeof d.label === 'string' && d.label && typeof d.value === 'string' && d.value);
const groupe = comms.buildCustomRequestAck(GROUPE);
ok(forme(groupe.details), 'une demande du formulaire de groupe', JSON.stringify(groupe.details));
const lu = (details, label) => ((Array.isArray(details) ? details : []).find((d) => d && d.label === label) || {}).value;
ok(lu(groupe.details, 'Groupe') === 'Entreprise, team building, Acme <b>&</b> Co' && lu(groupe.details, 'Participants') === '12 + 3 accompagnants'
  && /Bowling \(12 joueurs\), Laser Game \(10 joueurs\)/.test(lu(groupe.details, 'Activités') || '') && lu(groupe.details, 'Date souhaitée') === GROUPE.requestedDate,
'chaque ligne garde son libelle et sa valeur', JSON.stringify(groupe.details));
const ancienne = comms.buildCustomRequestAck(ANCIENNE);
ok(forme(ancienne.details) && lu(ancienne.details, 'Société') === 'Société <i>X</i>' && lu(ancienne.details, 'Personnes (approx.)') === '20',
  'une ancienne demande (occasion, societe)', JSON.stringify(ancienne.details));

section('[E] le mail poste a Resend porte la carte et garde ses deux liens');
async function mailPoste(demande) {
  const postes = [];
  const fetchAvant = global.fetch;
  const cleAvant = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'cle-de-test-du-gate';
  global.fetch = async (url, init = {}) => {
    if (String(url) !== 'https://api.resend.com/emails') throw new Error(`appel reseau inattendu : ${url}`);
    postes.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ id: `faux-${postes.length}` }) };
  };
  try {
    const resultat = await comms.sendCustomRequestAck(demande);
    return { resultat, postes };
  } finally {
    global.fetch = fetchAvant;
    if (cleAvant === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = cleAvant;
  }
}
const echappe = (texte) => String(texte).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
(async () => {
  for (const [nom, demande, lignes] of [
    ['demande de groupe', GROUPE, ['Groupe', 'Date souhaitée', 'Participants', 'Activités']],
    ['ancienne demande', ANCIENNE, ['Type d\'occasion', 'Date souhaitée', 'Personnes (approx.)', 'Société']],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const { resultat, postes } = await mailPoste(demande);
    const html = postes.length === 1 ? String(postes[0].html || '') : '';
    ok(resultat && resultat.ok === true && postes.length === 1 && postes[0].to === demande.email, `${nom} : un seul mail, au client`, JSON.stringify({ resultat, n: postes.length }));
    const attendu = comms.buildCustomRequestAck(demande).details;
    const cellules = [...html.matchAll(/<td [^>]*width="42%"[^>]*>([^<]*)<\/td>\s*<td [^>]*>([^<]*)<\/td>/g)].map((x) => [x[1], x[2]]);
    ok(cellules.length === lignes.length && lignes.every((label, i) => cellules[i][0] === echappe(label) && cellules[i][1] === echappe(lu(attendu, label))),
      `${nom} : la carte montre chaque ligne, valeur echappee`, JSON.stringify(cellules));
    const debut = html.indexOf('width="42%"');
    const fin = html.lastIndexOf('width="42%"');
    const liens = [...html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((x) => x[1]);
    ok(debut > 0 && !/<a\s/.test(html.slice(debut, html.indexOf('</table>', fin))) && liens.length === 2 && liens.some((h) => /^tel:/.test(h)) && liens.some((h) => /^mailto:libramont@fungalaxy\.be$/.test(h)),
      `${nom} : la carte n ajoute aucun lien, le mail garde ses deux liens`, JSON.stringify(liens));
  }

  section('[P] une adresse web ou un bouton ecrit par le client ne repart pas dans la carte');
  const piegee = custom.normaliserDemande({ groupType: 'entreprise', organisation: 'Acme www.phish.example/promo', participants: 8, moment: 'apres-midi', date,
    activities: [{ id: 'bowling', participants: 8 }], formulas: [] }, contexte);
  if (!piegee.ok) throw new Error(`demande piegee refusee : ${JSON.stringify(piegee)}`);
  const PIEGES = [
    ['organisation', { ...GROUPE, id: 4244, demande: piegee.demande, requestedDate: custom.libelleQuand(piegee.demande), pax: 8 }, { Groupe: 'Entreprise, team building, Acme' }, []],
    ['societe et date libre', { ...ANCIENNE, id: 4245, company: '[Cliquez ici](https://phish.example/x)', requestedDate: 'samedi [[bouton : Payer | https://phish.example/p]]' },
      { 'Date souhaitée': 'samedi' }, ['Société']],
  ];
  for (const [nom, demande, attendus, absentes] of PIEGES) {
    const details = comms.buildCustomRequestAck(demande).details;
    // eslint-disable-next-line no-await-in-loop
    const { postes } = await mailPoste(demande);
    const html = postes.length === 1 ? String(postes[0].html || '') : '';
    ok(Object.entries(attendus).every(([label, valeur]) => lu(details, label) === valeur) && absentes.every((label) => lu(details, label) === undefined),
      `${nom} : la carte garde les mots du client, sans le piege`, JSON.stringify(details));
    ok(html.length > 0 && !/phish|lien retiré|\[\[|\]\(/i.test(html), `${nom} : rien du piege dans le mail poste, aucun reste visible`, (html.match(/.{0,60}(?:phish|lien retiré|\[\[|\]\().{0,60}/i) || [''])[0]);
  }
  console.log(rouges ? `\naccuse-groupe-carte-check: ${rouges} ROUGE(S)` : '\naccuse-groupe-carte-check: ALL OK');
  process.exit(rouges ? 1 : 0);
})().catch((e) => { console.log(`ROUGE [E] exception : ${e && e.stack ? e.stack.slice(0, 600) : e}`); process.exit(1); });
