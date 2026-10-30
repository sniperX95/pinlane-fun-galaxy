'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const admin = fs.readFileSync(path.join(root, 'assets/admin-console.js'), 'utf8');
const data = fs.readFileSync(path.join(root, 'assets/admin-data.js'), 'utf8');
const context = { console, Number, String, Math, Array, Object };
vm.createContext(context);
vm.runInContext(admin.slice(admin.indexOf('function getAdminProgramExportText('), admin.indexOf('function buildAdminExcelXml(')), context);
const row = { pax: 20, program: { items: [
  {activityId:'bowling',name:'Bowling',participants:7,duration:1,priceKnown:true,price:39},
  {activityId:'arcade_time',name:'Arcades',participants:3,cards:2,duration:0.5,durationEstimated:true,priceKnown:true,price:50,arcadeOffer:{mode:'credit',price:25,credits:25,bonusCredits:10,totalCredits:35}},
  {activityId:'minigolf_blacklight',name:'Minigolf',participants:4,priceKnown:false},
] } };
const text = context.getAdminProgramExportText(row);
assert.match(text, /Bowling : 7 joueurs/);
assert.match(text, /Arcades : 3 joueurs · 2 cartes/);
assert.match(text, /25 crédits \+ 10 bonus par carte \(35 crédits\)/);
assert.match(text, /25 EUR par carte · 50 EUR/);
assert.match(text, /Minigolf : 4 joueurs · Tarif à l’accueil/);
assert.doesNotMatch(text, /0\.5 h|30 min/);
const free = context.getAdminProgramExportText({pax:1,program:{items:[{name:'Arcades',participants:1,cards:1,priceKnown:true,price:0,arcadeOffer:{mode:'time',price:0,minutes:60}}]}});
assert.match(free, /60 min par carte/);
assert.match(free, /0 EUR par carte · 0 EUR/);
assert.match(admin, /'Détail des activités'/);
assert.match(admin, /getAdminProgramExportText\(reservation\)/);
assert.match(data, /'Détail des activités'/);
assert.match(data, /getAdminProgramExportText\(r\)/);
assert.match(admin, /window\.players \|\| reservation\.program/);
context.dhState = { analytics: { startDate:'2026-10-03', endDate:'2026-10-03' } };
context.document = { getElementById: () => null };
context.window = { PinlaneApiClient: { collectAdminRange: async () => ({ reservations:[row] }) } };
context.apiRequest = () => { throw Error('Network forbidden'); };
context.dhCenterId = () => 'libramont';
context.dhCsvNumber = n => String(n).replace('.', ',');
context.dhCsvCell = s => '"' + String(s ?? '').replaceAll('"', '""') + '"';
let downloaded = '';
context.dhDownload = (name, csv) => { downloaded = csv; };
vm.runInContext(data.slice(data.indexOf('async function dhExportCsv('), data.indexOf('// Rapport imprimable')), context);
context.dhExportCsv('reservations-brutes').then(() => {
  assert.match(downloaded, /Détail des activités/);
  assert.match(downloaded, /Arcades : 3 joueurs · 2 cartes/);
  assert.match(downloaded, /25 crédits \+ 10 bonus/);
  assert.doesNotMatch(downloaded, /undefined|null/);
  console.log('Arcades exports: 17 assertions OK (actual CSV, players, cards, credits, zero, unknown, Excel wiring).');
}).catch(error => { console.error(error); process.exit(1); });
