// UNE REMISE « EN PLUS » S AJOUTE A UNE VISITE (2026-11-18, avant-lancement B6).
//
// Une offre du centre (lib/upsell-offers.js, kind 'add') remise une activite libre ajoutee a une
// visite. La carte qui la propose n existe qu a cote d une activite a heure fixe
// (lib/booking-complements.js buildVisitComplements). Le serveur, lui, accordait la remise a toute
// ligne qui portait `upsell` : une demande en ligne forgee avec le Fun Run seul payait 27,50 au lieu
// de 55, sans la visite qui justifie la remise.
//
// [P] LE CANAL PUBLIC (lib/reservation-request.js, la vraie normalisation d une reservation en ligne,
//     et normalizeProgram comme l appelle api/public-availability.js) : sans activite a heure fixe,
//     l offre seule ou avec des activites libres paie le tarif du catalogue, sans remise enregistree.
//     Avec le bowling, la remise de la carte reste accordee.
// [S] LE COMPTOIR garde la main : l equipe peut encore poser l offre sur une activite seule.
//
// Une offre inventee est posee en memoire sur Libramont (applyCenterOverrides) : aucune base, aucun
// reseau. Les contre-preuves chargent le code mute en memoire : aucun fichier n est ecrit.
// Lancement : node scripts/remise-sans-visite-check.js [--contre-preuves]

'use strict';

const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
['DATABASE_URL', 'POSTGRES_URL'].forEach((cle) => { delete process.env[cle]; });

const MUTATIONS = {
  'remise-sans-visite': { f: 'lib/visit-program.js', de: '    if (raw?.upsell && remiseEnPlus) {\n', vers: '    if (raw?.upsell) {\n', lettre: 'P' },
  'activite-libre-suffit': { f: 'lib/visit-program.js', de: "|| '').trim()) || {}).planned === true);\n", vers: "|| '').trim()) || {}).id !== undefined);\n", lettre: 'P' },
  'comptoir-aussi': { f: 'lib/visit-program.js', de: '  const remiseEnPlus = !publicBooking || toArray(input)', vers: '  const remiseEnPlus = toArray(input)', lettre: 'S' },
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
  if (temoin.status !== 0) { console.log(`${temoin.stdout || ''}${temoin.stderr || ''}`.split('\n').filter((l) => /ROUGE|Error/.test(l)).join('\n')); console.log('\nremise-sans-visite-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte'); process.exit(1); }
  let rates = 0;
  for (const [nom, m] of Object.entries(MUTATIONS)) {
    const r = spawnSync(process.execPath, [__filename, `--mutation=${nom}`], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const mord = r.status === 1 && sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION/.test(sortie);
    if (!mord) rates += 1;
    console.log(`${mord ? 'TUEE ' : 'VIVANTE'} ${nom} (attendu : ROUGE [${m.lettre}], sortie ${r.status})${mord ? '' : `\n${sortie.split('\n').filter((l) => /ROUGE|ANCRE|Error/.test(l)).slice(0, 6).join('\n')}`}`);
  }
  console.log(rates ? `\nremise-sans-visite-check --contre-preuves: ${rates} mutation(s) vivante(s)` : '\nremise-sans-visite-check --contre-preuves: ALL OK - chaque regle retiree fait rougir sa lettre');
  process.exit(rates ? 1 : 0);
}

const { applyCenterOverrides } = require('../lib/ops-knowledge');
const { normalizeReservationRequest } = require('../lib/reservation-request');
const { normalizeProgram } = require('../lib/visit-program');
const { jourDeTest } = require('./jour-de-test');

const SAMEDI = jourDeTest({ jour: 6 });
// Le Fun Run de 30 min a moitie prix, ajoute a une visite : 55 au catalogue pour 4 joueurs, 27,50 remise.
const OFFRE = { id: 'run', activityId: 'fun_run', enabled: true, kind: 'add', minParticipants: 1, maxParticipants: 20, options: { minutes: 30 }, discount: { mode: 'percent', value: 50 } };
applyCenterOverrides(new Map([['libramont', { upsellOffers: { enabled: true, offers: [OFFRE] } }]]));
const RUN = { activityId: 'fun_run', participants: 4, minutes: 30 };
const AVEC_OFFRE = { ...RUN, upsell: { offerId: 'run', participants: 4 } };
const corps = (program) => ({ centerId: 'libramont', type: 'visite', date: SAMEDI, startTime: '14:00', pax: 4, name: 'QA', phone: '0400000000', email: 'qa@exemple.be', program });
const ligne = (request, id) => request.program.items.find((i) => i.activityId === id) || {};
const resume = (request) => JSON.stringify({ prix: request.price, lignes: request.program.items.map((i) => [i.activityId, i.price, i.upsell ? i.upsell.discountAmount : null]) });
const enLigne = (program) => normalizeReservationRequest(corps(program), { channel: 'public', requireEmail: true });

section('[P] le canal public : sans activite a heure fixe, pas de remise en plus');
const catalogue = enLigne([RUN]);
ok(ligne(catalogue, 'fun_run').price === 55, 'temoin : le Fun Run de 30 min seul vaut 55 au catalogue pour 4', resume(catalogue));
const seul = enLigne([AVEC_OFFRE]);
ok(ligne(seul, 'fun_run').price === 55 && !ligne(seul, 'fun_run').upsell && seul.price === 55,
  'l offre seule paie le tarif du catalogue, sans remise enregistree', resume(seul));
const libres = enLigne([{ activityId: 'minigolf_blacklight', participants: 4 }, AVEC_OFFRE]);
ok(ligne(libres, 'fun_run').price === 55 && !ligne(libres, 'fun_run').upsell,
  'avec une autre activite libre seulement, toujours le tarif du catalogue', resume(libres));
const visite = enLigne([{ activityId: 'bowling', participants: 4, duration: 1 }, AVEC_OFFRE]);
ok(ligne(visite, 'fun_run').price === 27.5 && ligne(visite, 'fun_run').upsell && ligne(visite, 'fun_run').upsell.discountAmount === 27.5,
  'avec le bowling, la remise de la carte reste accordee', resume(visite));
const dispo = (lignes) => normalizeProgram(lignes, { centerId: 'libramont', pax: 4, dateStr: SAMEDI, publicBooking: true });
const dispoSeul = dispo([AVEC_OFFRE]);
const dispoVisite = dispo([{ activityId: 'bowling', participants: 4, duration: 1 }, AVEC_OFFRE]);
ok(dispoSeul.price === 55 && !dispoSeul.items[0].upsell && dispoVisite.items.find((i) => i.activityId === 'fun_run').price === 27.5,
  'les horaires en ligne annoncent le meme prix', JSON.stringify({ seul: dispoSeul.price, visite: dispoVisite.price }));

section('[S] le comptoir garde la main');
const comptoir = normalizeReservationRequest(corps([AVEC_OFFRE]), { channel: 'staff' });
ok(ligne(comptoir, 'fun_run').price === 27.5 && ligne(comptoir, 'fun_run').upsell,
  'l equipe peut poser l offre sur une activite seule', resume(comptoir));

applyCenterOverrides(new Map());
console.log(rouges ? `\nremise-sans-visite-check: ${rouges} ROUGE(S)` : '\nremise-sans-visite-check: ALL OK');
process.exit(rouges ? 1 : 0);
