const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../assets/app-main.js'), 'utf8');
function extract(name, next) {
  return source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${next}(`));
}
const reservation = { id: 1, pax: 6, opsPlan: { arene: 'seuls' } };
const context = vm.createContext({
  lpEtat: { choisi: { id: 1, unitKey: '1.1', date: '2026-10-10', centre: 'test' } },
  state: { currentDate: '2026-10-10' },
  getCurrentStaffCenterId: () => 'test',
  laserUnitInfo: () => ({ countIndex: 1, waveIndex: 1, waveCount: 1, players: 6 }),
  laserBlockUnitKey: () => '1.1',
  lpArene: w => Number(w.players),
  lpGroupe: w => Number(w.joueursReels || w.players),
});
vm.runInContext(extract('lpCibleDecalage', 'lpChoisiValide') + extract('lpChoisiValide', 'lpNomUnite'), context);
const model = { capacite: 30, resas: [reservation], fenetres: [], attente: [{ reservation, unitKey: '1.1', players: 6 }] };
let chosen = context.lpChoisiValide(model);
assert.equal(chosen.prive, true, 'unplaced private group keeps its saved arena choice');
assert.equal(chosen.arene, 30, 'preview reserves all weapons');
assert.equal(chosen.groupe, 6, 'actual group remains six players');
reservation.opsPlan.arene = 'auto';
chosen = context.lpChoisiValide(model);
assert.equal(chosen.prive, false);
assert.equal(chosen.arene, 6, 'shared groups still reserve only their weapons');

const missed = { reservation, start: 15, end: 15 + 25 / 60, players: 6 };
const other = { reservation: { id: 2 }, start: 15.9, end: 16.4, players: 6 };
const row = (t, windows = []) => ({ t, ici: [], holds: [], chevauche: windows, ferme: null, hors: false });
const delayModel = { capacite: 30, lancements: 1, maintenant: 15.5, bloc: 25 / 60, departs: [row(16, [other]), row(16.5)] };
assert.equal(context.lpCibleDecalage(delayModel, reservation, [missed], 15), 16.5, 'skip overlapping second launch despite spare weapons');
delayModel.lancements = 2;
assert.equal(context.lpCibleDecalage(delayModel, reservation, [missed], 15), 16, 'allow configured parallel launches');
other.arene = 'seuls';
assert.equal(context.lpCibleDecalage(delayModel, reservation, [missed], 15), 16.5, 'existing private session blocks other groups');
delete other.arene;
missed.arene = 'seuls';
missed.players = 30;
assert.equal(context.lpCibleDecalage(delayModel, reservation, [missed], 15), 16.5, 'private delayed group requires empty arena');
delayModel.departs = [row(16, [other])];
assert.equal(context.lpCibleDecalage(delayModel, reservation, [missed], 15), null, 'no false suggestion when every departure conflicts');
// La preference de masque ne doit pas faire disparaitre la grille du lendemain
// ou d un autre centre. Le faux modele couvre aussi une journee finie et vide.
const dayState = { currentDate: '2026-10-10' };
let dayCenter = 'test';
const dayContext = vm.createContext({
  state: dayState,
  getCurrentStaffCenterId: () => dayCenter,
  lpPluriel: (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`,
  lpRangDepart: (_modele, d) => `<div class="row" data-time="${d.t}"></div>`,
});
vm.runInContext(source.match(/^const lpEtat = .*;$/m)[0] + extract('lpJourneeHtml', 'lpFileHtml'), dayContext);
assert.equal(vm.runInContext('lpEtat.joues', dayContext), true, 'past hours start expanded');
const dayModel = { aujourdHui: true, maintenant: 23, prochain: null, departs: [
  { t: 10, joue: true, ici: [] }, { t: 10.5, joue: true, ici: [{}] },
] };
let dayHtml = dayContext.lpJourneeHtml(dayModel, null);
assert.match(dayHtml, /data-time="10"/, 'empty past opening slot is present by default');
assert.match(dayHtml, /data-time="10.5"/, 'occupied past slot is present by default');
vm.runInContext('lpEtat.joues = false', dayContext);
dayHtml = dayContext.lpJourneeHtml(dayModel, null);
assert.doesNotMatch(dayHtml, /class="row"/, 'manual hide applies to current day');
assert.match(dayHtml, /Les départs passés sont masqués/, 'hidden departures are not called an empty day');
dayState.currentDate = '2026-10-11';
assert.match(dayContext.lpJourneeHtml(dayModel, null), /data-time="10"/, 'new day restores all hours');
vm.runInContext('lpEtat.joues = false', dayContext);
dayCenter = 'other';
assert.match(dayContext.lpJourneeHtml(dayModel, null), /data-time="10"/, 'new centre restores all hours');
assert.match(dayContext.lpJourneeHtml({ ...dayModel, aujourdHui: false }, null), /data-time="10"/, 'other dates keep their full grid');
console.log('planning-laser-review-check: private pending preview, delay launch and full-day grid checks OK');
