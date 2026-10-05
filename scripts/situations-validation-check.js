// L EQUIPE N EST DERANGEE QUE POUR UN VRAI PROBLEME, ET CE QUI LA DERANGE SE REGLE (2026-10-05).
//
// Movsar : la validation ne doit plus dependre d une etiquette de formule mais
// d une situation reelle, pour toute reservation, « le moins possible », avec
// une intensite reglable. Ce gate prouve, sur des plans tels que le moteur les
// compose (formes relevees sur de vraies reservations du banc) :
//   [A] chaque situation se detecte sur son fait, et pas sans lui : aucune
//       place sure, bowling a 7, arene partagee presque pleine (et PAS un
//       groupe seul qui remplit sa propre session), depassement de la
//       fermeture (y compris apres minuit), laser partage, enchainement serre
//       pour un gros groupe (et pas pour un petit) ;
//   [B] chaque detection dit OU : l heure et le chiffre ;
//   [C] les niveaux : minimal ne derange personne (l impossible est refuse au
//       client, jamais envoye a l equipe), normal ajoute
//       la capacite poussee au bout et la fermeture, prudent ajoute le partage
//       et l enchainement ; un interrupteur allume ou eteint une situation ;
//       « impossible » n est jamais une situation a valider ;
//   [D] le reglage avance par formule : « toujours » valide meme sans
//       situation, « si laser partage » n allume le partage que pour elle ;
//   [E] un reglage illisible retombe sur minimal, sans planter ;
//   [F] l ecran Etablissement (miroir dans app-main.js) dit et allume la meme
//       chose que le serveur ;
//   [G] le reglage du centre survit a l enregistrement, et un interrupteur
//       rendu au niveau se defait vraiment (remplacement en bloc).
//
// Usage : node scripts/situations-validation-check.js
'use strict';

const path = require('path');
const sv = require(path.join(__dirname, '..', 'lib', 'situations-validation.js'));

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}
const ids = (liste) => liste.map((s) => s.id).sort().join(',');
const bloc = (o) => ({ type: 'activity', critical: true, ...o });
const SAMEDI = { open: 10, close: 24 };

// Plans types, relevés sur le banc réel (formes de lib/ops-engine).
const PLANS = {
  sain: { ok: true, conflicts: [], resourceBlocks: [bloc({ activityId: 'bowling', resourceType: 'bowling_lane', lanes: [1, 2], players: 12, start: 900, end: 960, startTime: '15:00', endTime: '16:00' })] },
  impossible: { ok: false, reason: 'Aucune piste libre à 15:00.', conflicts: [] },
  bloquant: { ok: true, conflicts: [{ severity: 'blocking', label: 'Piste 3 déjà prise' }], resourceBlocks: [] },
  bowling7: { ok: true, conflicts: [], resourceBlocks: [bloc({ activityId: 'bowling', resourceType: 'bowling_lane', lanes: [1, 2], players: 13, start: 900, end: 960, startTime: '15:00', endTime: '16:00' })] },
  arenePleinePartagee: { ok: true, conflicts: [], resourceBlocks: [bloc({ activityId: 'laser_game', resourceType: 'laser_arena', players: 8, playersBefore: 19, sharedSession: true, remainingWeapons: 3, start: 900, end: 925, startTime: '15:00', endTime: '15:25' })] },
  areneSeule: { ok: true, conflicts: [], resourceBlocks: [bloc({ activityId: 'laser_game', resourceType: 'laser_arena', players: 30, playersBefore: 0, sharedSession: false, remainingWeapons: 0, start: 900, end: 925, startTime: '15:00', endTime: '15:25' })] },
  partage: { ok: true, conflicts: [], resourceBlocks: [bloc({ activityId: 'laser_game', resourceType: 'laser_arena', players: 8, playersBefore: 10, sharedSession: true, remainingWeapons: 12, start: 900, end: 925, startTime: '15:00', endTime: '15:25' })] },
  tard: { ok: true, conflicts: [], resourceBlocks: [bloc({ activityId: 'bowling', resourceType: 'bowling_lane', lanes: [1], players: 4, start: 1410, end: 1470, startTime: '23:30', endTime: '24:30' })] },
  minuit: { ok: true, conflicts: [], resourceBlocks: [bloc({ activityId: 'bowling', resourceType: 'bowling_lane', lanes: [1], players: 4, startTime: '23:40', endTime: '00:20' })] },
  serre: { ok: true, conflicts: [], resourceBlocks: [
    bloc({ activityId: 'bowling', resourceType: 'bowling_lane', lanes: [1, 2, 3], players: 18, start: 900, end: 960, startTime: '15:00', endTime: '16:00' }),
    bloc({ activityId: 'laser_game', resourceType: 'laser_arena', players: 18, playersBefore: 0, remainingWeapons: 12, start: 962, end: 987, startTime: '16:02', endTime: '16:27' }),
  ] },
};

console.log('[A] chaque situation sur son fait');
const d = (nom, extra = {}) => sv.detecterSituations({ plan: PLANS[nom], schedule: SAMEDI, pax: extra.pax || 8, request: extra.request || {} });
ok(ids(d('sain', { pax: 12 })) === '', '[A] un plan sain ne declenche rien', ids(d('sain', { pax: 12 })));
ok(ids(d('impossible')) === 'impossible', '[A] aucun plan : impossible');
ok(ids(d('bloquant')) === 'impossible', '[A] conflit bloquant : impossible');
ok(ids(d('bowling7', { pax: 13 })) === 'bowling_secours', '[A] 13 joueurs sur 2 pistes : bowling en secours', ids(d('bowling7', { pax: 13 })));
ok(ids(d('sain', { request: { emergencyWarning: '7 joueurs sur la piste 4' } })) === 'bowling_secours', '[A] l avertissement du moteur suffit');
ok(ids(d('arenePleinePartagee')) === 'laser_partage,laser_plein', '[A] arene partagee avec 3 armes restantes : pleine ET partagee', ids(d('arenePleinePartagee')));
ok(ids(d('areneSeule', { pax: 30 })) === '', '[A] un groupe seul qui remplit sa session : rien', ids(d('areneSeule', { pax: 30 })));
ok(ids(d('partage')) === 'laser_partage', '[A] partage avec 12 armes restantes : partage seulement');
ok(ids(d('tard', { pax: 4 })) === 'apres_fermeture', '[A] fin a 0:30 pour minuit : depasse la fermeture');
ok(ids(d('minuit', { pax: 4 })) === 'apres_fermeture', '[A] un bloc qui passe minuit (23:40 → 00:20) est vu');
ok(ids(d('serre', { pax: 18 })) === 'enchainement_serre', '[A] 2 min entre bowling et laser pour 18 : serre', ids(d('serre', { pax: 18 })));
ok(ids(d('serre', { pax: 8 })) === '', '[A] le meme ecart pour 8 personnes : rien');

console.log('[B] chaque detection dit ou');
const vu = (nom, id, extra) => (d(nom, extra).find((s) => s.id === id) || {}).detail || '';
ok(/il reste 3 armes à 15:00/.test(vu('arenePleinePartagee', 'laser_plein')), '[B] armes restantes et heure', vu('arenePleinePartagee', 'laser_plein'));
ok(/10 joueurs d’un autre groupe à 15:00/.test(vu('partage', 'laser_partage')), '[B] joueurs de l autre groupe et heure', vu('partage', 'laser_partage'));
ok(/fin à 00:30, fermeture à 00:00/.test(vu('tard', 'apres_fermeture', { pax: 4 })), '[B] fin et fermeture', vu('tard', 'apres_fermeture', { pax: 4 }));
ok(/13 joueurs sur 2 pistes à 15:00/.test(vu('bowling7', 'bowling_secours', { pax: 13 })), '[B] joueurs, pistes, heure', vu('bowling7', 'bowling_secours', { pax: 13 }));
ok(/Aucune piste libre/.test(vu('impossible', 'impossible')), '[B] l impossible dit la raison du moteur');

console.log('[C] les niveaux et les interrupteurs');
const dec = (nom, reglage, extra) => sv.decisionValidation({ detectees: d(nom, extra), reglage });
ok(!dec('impossible', { niveau: 'prudent' }).requise && dec('impossible', { niveau: 'prudent' }).impossible, '[C] l impossible ne derange personne, meme en prudent : il est refuse (marque impossible)');
ok(!dec('bowling7', { niveau: 'minimal' }, { pax: 13 }).requise && dec('bowling7', { niveau: 'minimal' }, { pax: 13 }).aSurveiller.length === 1, '[C] minimal : bowling a 7 ne derange pas, mais reste « a surveiller »');
ok(dec('bowling7', { niveau: 'normal' }, { pax: 13 }).requise, '[C] normal : bowling a 7 derange');
ok(dec('tard', { niveau: 'normal' }, { pax: 4 }).requise, '[C] normal : depasser la fermeture derange');
ok(!dec('partage', { niveau: 'normal' }).requise, '[C] normal : un laser partage ne derange pas');
ok(dec('partage', { niveau: 'prudent' }).requise, '[C] prudent : un laser partage derange');
ok(dec('partage', { niveau: 'minimal', situations: { laser_partage: true } }).requise, '[C] interrupteur allume : le partage derange meme en minimal');
ok(!dec('bowling7', { niveau: 'prudent', situations: { bowling_secours: false } }, { pax: 13 }).requise, '[C] interrupteur eteint : le bowling a 7 ne derange plus meme en prudent');
ok(!dec('impossible', { niveau: 'minimal', situations: { impossible: true } }).requise, '[C] « impossible » ne s allume pas comme une situation a valider');
ok(!dec('bowling7', { niveau: 'minimal' }, { pax: 13 }).requise && !dec('partage', { niveau: 'minimal' }).requise, '[C] minimal : personne n est derange');
const decision = dec('bowling7', { niveau: 'normal' }, { pax: 13 });
ok(decision.declencheurs[0] && decision.declencheurs[0].mot === 'Bowling en capacité de secours', '[C] la decision nomme sa raison en mots', JSON.stringify(decision.declencheurs));

console.log('[D] le reglage avance par formule');
ok(sv.decisionValidation({ detectees: [], reglage: { niveau: 'minimal' }, modeFormule: 'required' }).requise, '[D] « toujours » valide meme sans situation');
ok(sv.decisionValidation({ detectees: d('partage'), reglage: { niveau: 'minimal' }, modeFormule: 'required_when_laser_busy' }).requise, '[D] « si laser partage » allume le partage pour elle');
ok(!sv.decisionValidation({ detectees: d('bowling7', { pax: 13 }), reglage: { niveau: 'minimal' }, modeFormule: 'required_when_laser_busy' }).requise, '[D] « si laser partage » n allume pas le reste');

console.log('[E] reglages illisibles');
ok(sv.normaliserReglage({ niveau: 'extreme', situations: { inconnue: true, bowling_secours: 'oui' } }).niveau === 'minimal', '[E] niveau inconnu : minimal');
ok(JSON.stringify(sv.normaliserReglage({ situations: { inconnue: true, bowling_secours: 'oui' } }).situations) === '{}', '[E] interrupteurs inconnus ou non booleens ignores');
ok(sv.normaliserReglage(null).niveau === 'minimal' && sv.normaliserReglage([]).niveau === 'minimal', '[E] rien ou n importe quoi : minimal');
ok(sv.SITUATIONS.every((s) => s.mot && s.explication && s.exemple), '[E] chaque situation porte un nom, une explication et un exemple pour l ecran');

// [F] L ECRAN DIT LA MEME CHOSE QUE LE SERVEUR. L ecran Etablissement porte un
// miroir des situations et des niveaux (assets/app-main.js) : un mot change
// d un seul cote, et le gerant regle une chose qui n est pas celle qui tourne.
console.log('[F] miroir de l ecran');
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const appMain = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-main.js'), 'utf8');
function litteral(source, debut, fin) {
  const i = source.indexOf(debut);
  const j = i < 0 ? -1 : source.indexOf(fin, i + debut.length);
  return i < 0 || j < 0 ? null : source.slice(i + debut.length, j + fin.length);
}
const projeter = (liste) => liste.map((s) => ({ id: s.id, toujours: Boolean(s.toujours), mot: s.mot, explication: s.explication, exemple: s.exemple }));
const casReglages = [null, { niveau: 'normal' }, { niveau: 'prudent', situations: { bowling_secours: false } }, { niveau: 'minimal', situations: { laser_partage: true, impossible: false } }, { niveau: 'extreme' }];
// Ce que l ecran dit et allume, lu dans la source servie.
function comparerEcran(source) {
  const texteSituations = litteral(source, 'const VALIDATION_SITUATIONS = ', '\n];');
  const texteNiveaux = litteral(source, 'const VALIDATION_NIVEAUX = ', '\n};');
  const texteReglage = litteral(source, 'function validationReglageDe(center) {', '\n}');
  const situations = texteSituations ? vm.runInNewContext(`(${texteSituations.replace(/\];$/, ']')})`) : null;
  const niveaux = texteNiveaux ? vm.runInNewContext(`(${texteNiveaux.replace(/\};$/, '}')})`) : null;
  // La lecture « l equipe est appelee pour » de l ecran suit la meme regle.
  const reglage = texteReglage && niveaux
    ? vm.runInNewContext(`(function () { const VALIDATION_NIVEAUX = ${JSON.stringify(niveaux)}; return function (center) {${texteReglage}; })()`)
    : null;
  return {
    situations: Array.isArray(situations) && JSON.stringify(projeter(situations)) === JSON.stringify(projeter(sv.SITUATIONS)),
    niveaux: Boolean(niveaux) && JSON.stringify(niveaux) === JSON.stringify(sv.NIVEAUX),
    lecture: Boolean(reglage) && casReglages.every((r) => [...reglage({ validationEquipe: r }).actives].sort().join() === [...sv.situationsActives(r)].sort().join()),
  };
}
const ecran = comparerEcran(appMain);
ok(ecran.situations, '[F] les situations de l ecran sont celles du serveur (ids, ordre, mots, explications, exemples)');
ok(ecran.niveaux, '[F] les niveaux de l ecran sont ceux du serveur');
ok(ecran.lecture, '[F] l ecran et le serveur allument les memes situations pour chaque reglage');

// [G] LE REGLAGE SURVIT A L ENREGISTREMENT, ET SE DEFAIT. Base simulee : la
// fonction d enregistrement reelle, seule la base est remplacee.
console.log('[G] enregistrement du reglage');
const cc = require(path.join(__dirname, '..', 'lib', 'center-config.js'));
function fauxPool(config) {
  const etat = { config };
  return {
    etat,
    async query(sql, params) {
      if (/^\s*select settings from centers/i.test(sql)) return { rowCount: 1, rows: [{ settings: { config: etat.config } }] };
      if (/^\s*update centers/i.test(sql)) { etat.config = JSON.parse(params[1]); return { rowCount: 1 }; }
      throw new Error(`requete inattendue : ${sql.trim().slice(0, 60)}`);
    },
  };
}
async function sectionG(module, prefixe = '') {
  const pool = fauxPool({});
  await module.saveCenterConfigOverride(pool, 'libramont', { validationEquipe: { niveau: 'minimal', situations: { laser_partage: true } }, secours: { emails: ['a@fungalaxy.be', 'b@fungalaxy.be'] } });
  const pose = pool.etat.config.validationEquipe;
  await module.saveCenterConfigOverride(pool, 'libramont', { validationEquipe: { niveau: 'minimal', situations: {} }, secours: { emails: ['b@fungalaxy.be'] } });
  const defait = pool.etat.config.validationEquipe;
  await module.saveCenterConfigOverride(pool, 'libramont', { accueil: { lateThresholdMinutes: 7 } });
  const autre = pool.etat.config;
  return { pose, defait, secours: autre.secours, garde: autre.validationEquipe, accueil: autre.accueil };
}
const normalise = cc.normalizeCenterConfig({ validationEquipe: { niveau: 'prudent', situations: { bowling_secours: false, inconnue: true } }, secours: { emails: 'A@FunGalaxy.be; a@fungalaxy.be, x@demo.test, pas-une-adresse' } }, 'libramont');
ok(JSON.stringify(normalise.validationEquipe) === '{"niveau":"prudent","situations":{"bowling_secours":false}}', '[G] la config bornee garde le niveau et les interrupteurs connus', JSON.stringify(normalise.validationEquipe));
ok(JSON.stringify(normalise.secours) === '{"emails":["a@fungalaxy.be"]}', '[G] la boite de secours : minuscules, sans doublon, sans adresse reservee ni mal formee', JSON.stringify(normalise.secours));
const parDefaut = cc.normalizeCenterConfig({}, 'gembloux');
ok(parDefaut.validationEquipe.niveau === 'minimal' && JSON.stringify(parDefaut.secours) === '{"emails":[]}', '[G] un centre jamais regle : minimal, aucune adresse');

(async () => {
  const g = await sectionG(cc);
  ok(g.pose && g.pose.situations.laser_partage === true, '[G] un interrupteur allume est enregistre');
  ok(g.defait && JSON.stringify(g.defait.situations) === '{}', '[G] un interrupteur rendu au niveau est bien defait (pas garde par la fusion)', JSON.stringify(g.defait));
  ok(JSON.stringify(g.secours) === '{"emails":["b@fungalaxy.be"]}', '[G] une adresse retiree de la boite de secours disparait', JSON.stringify(g.secours));
  ok(g.garde && g.garde.niveau === 'minimal' && g.accueil.lateThresholdMinutes === 7, '[G] enregistrer autre chose ne touche pas au reglage');

  // CONTRE-EPREUVES : le module servi casse expres, une mutation a la fois.
  console.log('[contre-épreuves]');
  const racine = path.join(__dirname, '..');
  function muter(fichierSource, de, vers) {
    const source = fs.readFileSync(path.join(racine, 'lib', fichierSource), 'utf8');
    if (source.split(de).length !== 2) { ok(false, `[contre-épreuve] ancre absente ou multiple dans ${fichierSource}`); return null; }
    const f = path.join(os.tmpdir(), `situations-mute-${process.pid}-${Math.random().toString(36).slice(2)}.js`);
    fs.writeFileSync(f, source.replace(de, vers).split("require('../").join(`require('${racine}/`).split("require('./").join(`require('${racine}/lib/`));
    try { return require(f); } finally { fs.unlinkSync(f); }
  }
  // Un moteur qui confondrait « seule » et « partagee » ferait deranger
  // l equipe pour chaque grosse session laser.
  const sansGarde = muter('situations-validation.js', 'if (avecAutres && Number.isFinite(restantes) && restantes <= ARMES_RESTANTES_MAX)', 'if (Number.isFinite(restantes) && restantes <= ARMES_RESTANTES_MAX)');
  if (sansGarde) ok(ids(sansGarde.detecterSituations({ plan: PLANS.areneSeule, schedule: SAMEDI, pax: 30 })) === 'laser_plein', '[contre-épreuve] sans la garde « partagee », [A] rougit sur le groupe seul');
  // La fusion cle par cle revenue : l interrupteur ne se defait plus.
  const fusion = muter('center-config.js', 'if (isPlainObject(patch) && isPlainObject(patch[cle])) mergedInput[cle] = patch[cle];', '');
  if (fusion) {
    const gm = await sectionG(fusion);
    ok(gm.defait && gm.defait.situations.laser_partage === true, '[contre-épreuve] sans le remplacement en bloc, [G] rougit (l interrupteur reste allume)', JSON.stringify(gm.defait));
  }
  // L ecran derive d un seul cote, une mutation a la fois : [F] rougit.
  const deriveMot = comparerEcran(appMain.replace("mot: 'Enchaînement serré'", "mot: 'Enchaînement rapide'"));
  ok(!deriveMot.situations, '[contre-épreuve] un mot change cote ecran, [F] rougit');
  const deriveNiveau = comparerEcran(appMain.replace("situations: ['bowling_secours', 'laser_plein', 'apres_fermeture'] },", "situations: ['bowling_secours', 'apres_fermeture'] },"));
  ok(!deriveNiveau.niveaux && !deriveNiveau.lecture, '[contre-épreuve] « normal » sans l arene pleine cote ecran, [F] rougit');
  const deriveLecture = comparerEcran(appMain.replace("if (on) actives.add(id); else actives.delete(id);", "if (on) actives.add(id);"));
  ok(!deriveLecture.lecture, '[contre-épreuve] l ecran qui n eteint plus un interrupteur, [F] rougit');

  console.log('');
  console.log(failures ? `situations-validation-check: ${failures} FAIL` : 'situations-validation-check: ALL OK (faits detectes et dits, niveaux, interrupteurs, reglage par formule, reglages illisibles, miroir ecran, enregistrement)');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });

