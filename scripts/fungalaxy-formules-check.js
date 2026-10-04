#!/usr/bin/env node
'use strict';
// =============================================================================
// FORMULES DU FORMULAIRE FUN GALAXY : LE MEME VERDICT QUE LA RESERVATION
// -----------------------------------------------------------------------------
// Demande de Movsar (2026-09-23) : « les formules sont super mal faites, c est
// moche, c est pas bien range, et ya pas les contraintes d indisponibilite des
// formules visibles ».
//
// LE DEFAUT MESURE AVANT : sur un SAMEDI, le formulaire proposait FUN FRIDAY
// MADNESS (vendredi seulement), CRAZY STUDENT STRIKE (mardi), KIDS FUN DAY
// (mercredi), HAPPY LASER AND GAME (jeudi) et BACK TO SCHOOL (mardi, mercredi,
// jeudi, dimanche, de 18h a 22h) comme si elles etaient reservables. Le client
// en choisissait une, puis tombait sur un ecran d heures vide : c est
// api/public-availability qui refusait, tout au bout, sans jamais le dire.
// Aucune des contraintes du catalogue (groupe minimum, jours, plage horaire,
// vacances scolaires) n etait affichee nulle part.
//
// CE QUE CE GATE PROUVE
//   [A] le verdict du formulaire = celui de getFormuleAvailability, la fonction
//       qui accepte ou refuse la VRAIE reservation, sur une grille complete
//       (chaque formule x chaque jour de la semaine x plusieurs groupes). Le
//       calendrier passe par la CHAINE du formulaire (absorberCalendrier,
//       entreeJour, jourInfo), pas brut : jusqu au 2026-09-28 ce gate donnait
//       le calendrier du serveur a la regle, alors que le formulaire, lui, en
//       jetait le verdict des vacances et des blocages ; il restait vert
//       pendant que la FORMULE 1 se proposait en conge d automne ;
//   [B] les contraintes affichees sont celles du catalogue, ni plus ni moins ;
//   [C] le calendrier servi porte le verdict des vacances (formulaHolidayOff)
//       et il vaut isFormulaBlockedDate, jamais une devinette sur le type de
//       periode ;
//   [D] quatre contre-epreuves par mutation : sans chacune de ces regles, ce
//       gate ROUGIT.
// =============================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const FORMULAIRE = path.join(ROOT, 'assets/fungalaxy-booking.js');

let failures = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return Boolean(cond);
}
function section(titre) { console.log(`\n[${titre}]`); }

// Les fonctions du formulaire, prises DANS son fichier : c est le code servi
// qui repond, jamais une copie de sa logique ecrite ici. Vide = renommee, et
// le gate le dit au lieu de passer en silence.
function extraire(source, nom) {
  const debut = source.indexOf(`\n  function ${nom}(`);
  if (debut === -1) return '';
  // Une fonction ecrite sur une ligne s arrete a sa ligne.
  const finLigne = source.indexOf('\n', debut + 1);
  const ligne = source.slice(debut + 1, finLigne);
  if (/\}\s*$/.test(ligne) && (ligne.match(/\{/g) || []).length === (ligne.match(/\}/g) || []).length) return ligne;
  const fin = source.indexOf('\n  }\n', debut + 1);
  return fin === -1 ? '' : source.slice(debut + 1, fin + 4);
}

function chargerRegleDuFormulaire(jours, state) {
  const source = fs.readFileSync(FORMULAIRE, 'utf8').replace(/\r\n/g, '\n');
  const noms = ['verdictFormule', 'cleDisponibilitesFormules', 'jourSemaine', 'joursLisibles', 'reglesFormule', 'plageLisible', 'heureRonde', 'entreeJour', 'absorberCalendrier', 'jourInfo'];
  const morceaux = noms.map((nom) => ({ nom, code: extraire(source, nom) }));
  const manquantes = morceaux.filter((m) => !m.code).map((m) => m.nom);
  const ligneJours = (source.match(/^ {2}var JOURS_SEM = .*$/m) || [''])[0];
  // Le calendrier du formulaire se remplit comme en vrai : les entrees
  // servies passent par absorberCalendrier et entreeJour ; jourInfo les relit.
  const bac = {
    state,
    CENTER:'libramont', disponibilitesFormules:{},
    jours: {},
    accentuer: (s) => s,
    horaireLabel: () => '',
    Math, Number, String, Date, JSON, Array,
  };
  bac.globalThis = bac;
  vm.createContext(bac);
  vm.runInContext(ligneJours, bac, { filename: 'fungalaxy-booking.js:JOURS_SEM' });
  morceaux.filter((m) => m.code).forEach((m) => vm.runInContext(m.code, bac, { filename: `fungalaxy-booking.js:${m.nom}` }));
  if (!manquantes.length) vm.runInContext(`absorberCalendrier(${JSON.stringify(Object.values(jours))})`, bac, { filename: 'gate:calendrier' });
  return { bac, manquantes, joursSem: ligneJours };
}

function main() {
  const bc = require('../lib/booking-config');
  const { getCenter } = require('../lib/ops-knowledge');
  const { __test } = require('../api/public-booking-meta');
  const CENTRE = 'libramont';
  const centre = getCenter(CENTRE);
  const formules = bc.getEffectiveFormules(CENTRE);

  // Un calendrier REEL sur 400 jours : tous les jours de la semaine, les
  // vacances scolaires wallonnes et les jours feries y passent.
  const calendrier = __test.buildCalendar([], 400, centre, CENTRE, '');
  const jours = {};
  calendrier.forEach((j) => { jours[j.date] = j; });
  const dates = calendrier.map((j) => j.date);

  section('A. LE VERDICT DU FORMULAIRE EST CELUI DE LA RESERVATION');
  ok(formules.length >= 10, `le catalogue de Libramont porte ${formules.length} formules`);
  const state = { date: dates[0], pax: 6 };
  const { bac, manquantes, joursSem } = chargerRegleDuFormulaire(jours, state);
  ok(manquantes.length === 0, 'le formulaire porte bien sa regle et ses libelles (sinon ce gate ne prouve rien)', manquantes.join(', '));
  ok(joursSem.includes('dimanche') && joursSem.includes('samedi'), 'et sa table des jours de la semaine', joursSem.slice(0, 40) + '…');
  if (manquantes.length) { console.log('\nfungalaxy-formules-check: abandon'); process.exit(1); }

  // La grille : 60 jours d affilee (tous les jours de la semaine, des vacances
  // et des feries) x 4 tailles de groupe x toutes les formules.
  const PAX = [1, 4, 6, 12];
  const echantillon = dates.slice(0, 60);
  const ecarts = [];
  let cas = 0;
  for (const date of echantillon) {
    for (const pax of PAX) {
      state.date = date;
      state.pax = pax;
      for (const formule of formules) {
        cas += 1;
        const serveur = bc.getFormuleAvailability(formule, date, pax, '', centre).ok;
        const client = bac.verdictFormule(formule).ok;
        if (serveur !== client) ecarts.push(`${formule.id} ${date} ${pax}p serveur=${serveur} formulaire=${client}`);
      }
    }
  }
  ok(ecarts.length === 0, `meme verdict sur ${cas} cas (60 jours x ${PAX.length} groupes x ${formules.length} formules)`, ecarts.slice(0, 4).join(' ; '));

  // Le defaut d origine, nomme : un samedi, les formules d un autre jour.
  const samedi = echantillon.find((d) => jours[d].weekday === 6 && !jours[d].formulaHolidayOff);
  ok(Boolean(samedi), 'un samedi ordinaire existe dans le calendrier', samedi);
  if (samedi) {
    state.date = samedi;
    state.pax = 6;
    const refusees = formules.filter((f) => !bac.verdictFormule(f).ok).map((f) => f.id);
    ['ffm', 'css', 'kfd', 'hlg', 'bts'].forEach((id) => {
      const f = formules.find((x) => x.id === id);
      if (!f) return;
      const v = bac.verdictFormule(f);
      ok(!v.ok && /se réserve/.test(v.pourquoi), `${samedi} (samedi) : ${f.name} est refusee ET dit pourquoi`, v.pourquoi);
    });
    ok(refusees.length >= 5, `un samedi, ${refusees.length} formules sur ${formules.length} sont refusees et expliquees`, refusees.join(', '));
    const anniv = formules.find((f) => f.id === 'f1');
    ok(bac.verdictFormule(anniv).ok, `et la FORMULE 1 (6 personnes, hors vacances) reste choisissable ce samedi`);
    state.pax = 4;
    const v4 = bac.verdictFormule(anniv);
    ok(!v4.ok && /4/.test(v4.pourquoi) && /6/.test(v4.pourquoi), 'a 4 personnes elle se refuse en nommant les deux nombres', v4.pourquoi);
  }
  // Un jour de vacances scolaires : les formules noHolidays tombent, les
  // autres restent.
  const vacances = echantillon.find((d) => jours[d].formulaHolidayOff);
  if (vacances) {
    state.date = vacances;
    state.pax = 6;
    const f1 = formules.find((f) => f.id === 'f1');
    const libre = formules.find((f) => f.noHolidays !== true && (!f.validDays || f.validDays.includes(jours[vacances].weekday)) && (f.minPax || 1) <= 6);
    ok(!bac.verdictFormule(f1).ok && /vacances/.test(bac.verdictFormule(f1).pourquoi),
      `${vacances} (${jours[vacances].holiday ? jours[vacances].holiday.label : 'periode bloquee'}) : FORMULE 1 refusee pour les vacances`, bac.verdictFormule(f1).pourquoi);
    if (libre) ok(bac.verdictFormule(libre).ok, `et ${libre.name}, qui n exclut pas les vacances, reste choisissable`);
  } else {
    ok(false, 'aucun jour de vacances ou ferie dans les 60 jours : la regle des vacances n est pas prouvee');
  }

  section('B. LES CONTRAINTES AFFICHEES SONT CELLES DU CATALOGUE');
  state.date = samedi || dates[0];
  state.pax = 6;
  const ecartsRegles = [];
  formules.forEach((f) => {
    const chips = bac.reglesFormule(f).join(' | ');
    if (Number(f.minPax) > 1 && !chips.includes(String(f.minPax))) ecartsRegles.push(`${f.id} : minimum ${f.minPax} absent`);
    if (Number(f.minPax) <= 1 && /personnes/.test(chips)) ecartsRegles.push(`${f.id} : minimum invente (${chips})`);
    if (f.validDays && f.validDays.length && f.validDays.length < 7) {
      const noms = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
      f.validDays.forEach((d) => { if (!chips.includes(noms[d])) ecartsRegles.push(`${f.id} : ${noms[d]} absent de « ${chips} »`); });
      noms.forEach((nom, d) => { if (!f.validDays.includes(d) && chips.includes(nom)) ecartsRegles.push(`${f.id} : ${nom} annonce alors que le catalogue ne le vend pas`); });
    }
    if (f.timeLimit && f.timeLimit.max && !chips.includes(String(Math.floor(f.timeLimit.max)) + 'h')) ecartsRegles.push(`${f.id} : fin ${f.timeLimit.max}h absente de « ${chips} »`);
    if (f.timeLimit && f.timeLimit.min && !chips.includes(String(Math.floor(f.timeLimit.min)) + 'h')) ecartsRegles.push(`${f.id} : debut ${f.timeLimit.min}h absent de « ${chips} »`);
    if (f.noHolidays && !/vacances/.test(chips)) ecartsRegles.push(`${f.id} : « hors vacances » absent`);
    if (!f.noHolidays && /vacances/.test(chips)) ecartsRegles.push(`${f.id} : « hors vacances » invente`);
  });
  ok(ecartsRegles.length === 0, `les ${formules.length} formules affichent exactement les contraintes du catalogue`, ecartsRegles.slice(0, 4).join(' ; '));
  const bts = formules.find((f) => f.id === 'bts');
  if (bts) ok(bac.reglesFormule(bts).join(' · ') === 'dès 4 personnes · les mardi, mercredi, jeudi et dimanche · de 18h à 22h · hors vacances et fériés',
    'BACK TO SCHOOL affiche ses quatre contraintes, dans l ordre de la semaine', bac.reglesFormule(bts).join(' · '));

  section('C. LE CALENDRIER SERVI PORTE LE VERDICT DES VACANCES');
  const ecartsCal = [];
  calendrier.forEach((j) => {
    const attendu = bc.isFormulaBlockedDate(j.date, centre);
    if (Boolean(j.formulaHolidayOff) !== Boolean(attendu)) ecartsCal.push(`${j.date} servi=${j.formulaHolidayOff} regle=${attendu}`);
  });
  ok(ecartsCal.length === 0, `formulaHolidayOff = isFormulaBlockedDate sur les ${calendrier.length} jours servis`, ecartsCal.slice(0, 3).join(' ; '));
  const bloques = calendrier.filter((j) => j.formulaHolidayOff).length;
  ok(bloques > 0 && bloques < calendrier.length, `${bloques} jours bloques sur ${calendrier.length} : le drapeau distingue bien les periodes`);

  section('D. CONTRE-EPREUVES PAR MUTATION DU CODE DE PRODUCTION');
  const original = fs.readFileSync(FORMULAIRE, 'utf8');
  const MUTATIONS = [
    {
      ancre: "if (f.validDays && f.validDays.length && f.validDays.indexOf(jourSemaine(state.date)) < 0)",
      mute: "if (false)",
      label: 'sans la regle des jours, FUN FRIDAY MADNESS repasse un samedi',
      verdict: (b, s) => { s.date = samedi; s.pax = 6; return b.verdictFormule(formules.find((f) => f.id === 'ffm')).ok === false; },
    },
    {
      ancre: "if (f.minPax && state.pax < f.minPax)",
      mute: "if (false)",
      label: 'sans la regle du groupe, la FORMULE 1 repasse a 4 personnes',
      verdict: (b, s) => { s.date = samedi; s.pax = 4; return b.verdictFormule(formules.find((f) => f.id === 'f1')).ok === false; },
    },
    {
      ancre: "if (f.noHolidays && j.formulaHolidayOff)",
      mute: "if (false)",
      label: 'sans la regle des vacances, la FORMULE 1 repasse en vacances scolaires',
      verdict: (b, s) => { s.date = vacances; s.pax = 6; return b.verdictFormule(formules.find((f) => f.id === 'f1')).ok === false; },
    },
    {
      // LE CHARGEUR, PAS SEULEMENT LA REGLE : un calendrier du formulaire qui
      // perd le verdict des vacances rend la regle muette, meme intacte.
      ancre: "      formulaHolidayOff: Boolean(entry.formulaHolidayOff),",
      mute: "      formulaHolidayOff: false,",
      label: 'si le calendrier du formulaire perd le verdict des vacances, la FORMULE 1 repasse en conge scolaire',
      verdict: (b, s) => { s.date = vacances; s.pax = 6; return b.verdictFormule(formules.find((f) => f.id === 'f1')).ok === false; },
    },
    {
      ancre: "if (f.minPax > 1) out.push('dès ' + f.minPax + ' personnes');",
      mute: "if (false) out.push('');",
      label: 'sans la contrainte de groupe affichee, la carte ne dit plus « dès 6 personnes »',
      verdict: (b) => /personnes/.test(b.reglesFormule(formules.find((f) => f.id === 'f1')).join(' ')),
    },
  ];
  for (const m of MUTATIONS) {
    const compte = original.split(m.ancre).length - 1;
    if (!ok(compte === 1, `contre-epreuve montable : « ${m.ancre.slice(0, 44)}… » une seule fois`, `${compte} occurrence(s)`)) continue;
    let rouge = false;
    try {
      fs.writeFileSync(FORMULAIRE, original.split(m.ancre).join(m.mute));
      const mute = chargerRegleDuFormulaire(jours, { date: samedi, pax: 6 });
      rouge = mute.manquantes.length === 0 ? m.verdict(mute.bac, mute.bac.state) === false : true;
    } catch (error) {
      rouge = true;
    } finally {
      fs.writeFileSync(FORMULAIRE, original);
    }
    ok(rouge, `${m.label} : ce gate ROUGIRAIT`);
  }
  ok(fs.readFileSync(FORMULAIRE, 'utf8') === original, 'assets/fungalaxy-booking.js restaure a l identique');
  // Code restaure : la regle redit la verite.
  const apres = chargerRegleDuFormulaire(jours, { date: samedi, pax: 6 });
  ok(apres.bac.verdictFormule(formules.find((f) => f.id === 'ffm')).ok === false
    && apres.bac.verdictFormule(formules.find((f) => f.id === 'f1')).ok === true,
    'code restaure : un samedi, FUN FRIDAY MADNESS refusee et FORMULE 1 choisissable');

  console.log(`\n${failures === 0 ? 'fungalaxy-formules-check: ALL OK' : `fungalaxy-formules-check: ${failures} echec(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
