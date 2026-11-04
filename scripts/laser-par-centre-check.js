// LE LASER N EST PAS LE MEME D UN CENTRE A L AUTRE (Ansar, 2026-11-04).
//
// [A] UNE SEULE PARTIE A LA FOIS (Libramont) : deux groupes a la meme heure jouent la meme partie, et le
//     plan le dit. Un groupe dont l heure tombe tout pres d une partie la rejoint. Une autre heure qui
//     chevauche est refusee.
// [B] DES PARTIES SEPAREES (Gembloux) : deux groupes jouent en meme temps, chacun sa partie, chacun son
//     heure. Personne ne rejoint personne, rien n est dit partage. Ce qui borne : les armes de l arene,
//     puis le nombre de parties qui tournent ensemble.
// [C] LA BASE TIENT LA MEME REGLE, sous son verrou : c est le dernier mot avant d ecrire.
// [D] LE MAIL DIT LA VERITE DU CENTRE : « partagee » a Libramont, « sa propre partie » a Gembloux.
// [E] LE KIDS FUN DAY SE VEND A GEMBLOUX sans sa plaine de jeux, et la Formule 6, qui n a pas de sens sans
//     elle, y reste absente. A Libramont, rien ne change.
//
// Le vrai moteur, la vraie regle de la base, le vrai gabarit de mail : sans reseau ni base.
// Lancement : node scripts/laser-par-centre-check.js [--contre-preuves]

const path = require('path');
const { spawnSync } = require('child_process');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const MUTATIONS = [
  { nom: 'aucun centre n a de parties separees', lettre: '[B]', fichier: 'lib/laser-parties.js', de: 'return Number(center && center.resources && center.resources.laser && center.resources.laser.parallelLaunches) > 1;', vers: 'return false;' },
  { nom: 'tous les centres ont des parties separees', lettre: '[A]', fichier: 'lib/laser-parties.js', de: 'return Number(center && center.resources && center.resources.laser && center.resources.laser.parallelLaunches) > 1;', vers: 'return true;' },
  { nom: 'a Gembloux, le plan se dit encore partage', lettre: '[B]', fichier: 'lib/ops-engine.js', de: 'block.sharedSession = !separees && armesPrises > 0;', vers: 'block.sharedSession = armesPrises > 0;' },
  { nom: 'a Gembloux, deux groupes a la meme heure comptent pour une seule partie', lettre: '[B]', fichier: 'lib/laser-parties.js', de: 'if (separees) return voisins.length + 1;', vers: '' },
  { nom: 'la base compte encore une seule partie', lettre: '[C]', fichier: 'lib/database.js', de: 'partiesEnJeu({ separees: partiesSeparees(center), voisins: overlapping, start: candidate.start, end: candidate.end })', vers: 'partiesEnJeu({ separees: false, voisins: overlapping, start: candidate.start, end: candidate.end })' },
  { nom: 'le mail de Gembloux parle encore de partie completee', lettre: '[D]', fichier: 'lib/ops-communications.js', de: "if (sharing?.partiesSeparees || partiesSeparees(centerOrNull(reservation.centerId))) {", vers: 'if (false) {' },
  { nom: 'le Kids Fun Day garde sa plaine de jeux a Gembloux', lettre: '[E]', fichier: 'lib/formula-choice.js', de: "if (!formula || typeof formula !== 'object' || formula.orderPolicy !== 'open_window') return formula;", vers: 'return formula;' },
  { nom: 'toute formule perd l etape que le centre n a pas', lettre: '[E]', fichier: 'lib/formula-choice.js', de: "if (!formula || typeof formula !== 'object' || formula.orderPolicy !== 'open_window') return formula;", vers: "if (!formula || typeof formula !== 'object') return formula;" },
];

// La contre-preuve : le source mute au chargement, rien n est ecrit sur le disque.
if (process.env.LASER_PAR_CENTRE_CASSE) {
  const mut = JSON.parse(process.env.LASER_PAR_CENTRE_CASSE);
  const cible = path.join(ROOT, mut.fichier);
  const compiler = Module.prototype._compile;
  let mordue = false;
  Module.prototype._compile = function (contenu, nom) {
    if (nom === cible) {
      const source = contenu.split('\r\n').join('\n');
      if (source.split(mut.de).length !== 2) { console.log(`ANCRE ${mut.nom}`); process.exit(3); }
      mordue = true;
      return compiler.call(this, source.split(mut.de).join(mut.vers), nom);
    }
    return compiler.call(this, contenu, nom);
  };
  process.on('exit', () => { if (!mordue) console.log(`FICHIER NON CHARGE ${mut.fichier}`); });
}

for (const nom of Object.keys(process.env)) if (/(^PG|DATABASE|POSTGRES|RESEND|SECRET|API_KEY|PASSWORD|PASSPHRASE)/i.test(nom)) delete process.env[nom];

function verifier() {
  const fautes = [];
  const ok = (cond, label, detail = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`); if (!cond) fautes.push(label); };
  const knowledge = require(path.join(ROOT, 'lib/ops-knowledge'));
  const { planLaser } = require(path.join(ROOT, 'lib/ops-engine'));
  const database = require(path.join(ROOT, 'lib/database'));
  const comm = require(path.join(ROOT, 'lib/ops-communications'));
  const { formuleDuCentre } = require(path.join(ROOT, 'lib/formula-choice'));

  // Les horaires et l arene tels que la prod les sert le jour du lancement.
  const heures = { regular: { 0: { open: '10:00', close: '22:00' }, 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: { 0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' }, 2: { open: '10:00', close: '22:00' }, 3: { open: '10:00', close: '22:00' }, 4: { open: '10:00', close: '22:00' }, 5: { open: '10:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } } };
  knowledge.applyCenterOverrides(new Map([['gembloux', { defaultSchedule: heures, resources: { laser: { weaponCount: 20, parallelLaunches: 6, canSplitGroupsCleanly: true, requiresCompleteGroupBeforeLaunch: false } } }]]));

  const JOUR = '2026-11-21';
  let id = 100;
  const dossier = (centerId, pax, plan) => ({ id: id += 1, date: JOUR, centerId, status: 'confirmed', type: 'laser', pax, startTime: plan.startTime, duration: 0.5, games: 1, opsPlan: plan });
  const laser = (centerId, pax, startTime, reservations = []) => planLaser({ centerId, date: JOUR, pax, games: 1, startTime, requestedStartTime: startTime, channel: 'staff' }, { reservations, laneStatuses: {}, blocks: [] }).recommended;
  const bloc = (plan) => (plan && plan.resourceBlocks || []).find((b) => b.resourceType === 'laser_arena') || {};
  const blocages = (plan) => (plan && plan.conflicts || []).filter((c) => c.severity === 'blocking');

  // [A] Libramont
  const a1 = laser('libramont', 10, '15:00');
  const ra1 = dossier('libramont', 10, a1);
  const a2 = laser('libramont', 8, '15:00', [ra1]);
  ok(bloc(a2).startTime === '15:00' && bloc(a2).sharedSession === true && a2.laserSharing.sharedNow === true && Number(bloc(a2).playersTotal) === 18, '[A] Libramont : deux groupes a la meme heure jouent la meme partie, et le plan le dit', JSON.stringify({ d: bloc(a2).startTime, partage: bloc(a2).sharedSession, total: bloc(a2).playersTotal }));
  ok(blocages(a2).length === 0, '[A] Libramont : elle passe, il reste des armes');
  ok(a1.laserSharing.mayShare === true, '[A] Libramont : une partie a moitie vide peut etre completee');
  const a3 = laser('libramont', 25, '15:00', [ra1]);
  ok(blocages(a3).length > 0 && /il reste 20 places/.test(blocages(a3)[0].message || ''), '[A] Libramont : au-dela des 30 armes, le refus dit ce qui reste', blocages(a3)[0] && blocages(a3)[0].message);
  const a4 = laser('libramont', 8, '15:30', [ra1]);
  ok(bloc(a4).startTime === '15:30' && blocages(a4).length === 0 && bloc(a4).sharedSession === false, '[A] Libramont : a la partie suivante, l arene est de nouveau libre', JSON.stringify({ d: bloc(a4).startTime, b: blocages(a4).length }));

  // [B] Gembloux
  const b1 = laser('gembloux', 6, '15:00');
  const rb1 = dossier('gembloux', 6, b1);
  const b2 = laser('gembloux', 8, '15:00', [rb1]);
  const rb2 = dossier('gembloux', 8, b2);
  ok(bloc(b2).startTime === '15:00' && blocages(b2).length === 0, '[B] Gembloux : deux groupes jouent en meme temps', JSON.stringify({ d: bloc(b2).startTime, b: blocages(b2).length }));
  ok(bloc(b2).sharedSession === false && Number(bloc(b2).playersBefore) === 0 && b2.laserSharing.sharedNow === false && b2.laserSharing.mayShare === false, '[B] Gembloux : rien n est dit partage', JSON.stringify(b2.laserSharing));
  ok(Number(bloc(b2).playersTotal) === 14 && Number(bloc(b2).remainingWeapons) === 6, '[B] Gembloux : les armes des autres comptent, 14 sur 20', JSON.stringify({ total: bloc(b2).playersTotal, reste: bloc(b2).remainingWeapons }));
  const b3 = laser('gembloux', 8, '15:00', [rb1, rb2]);
  ok(blocages(b3).length > 0 && /il reste 6 places sur 20/.test(blocages(b3)[0].message || ''), '[B] Gembloux : au-dela des 20 armes, le refus dit ce qui reste', blocages(b3)[0] && blocages(b3)[0].message);
  const b4 = laser('gembloux', 4, '15:30', [rb1, rb2]);
  ok(bloc(b4).startTime === '15:30' && blocages(b4).length === 0 && Number(bloc(b4).playersTotal) === 4, '[B] Gembloux : a l heure suivante, l arene est de nouveau libre', JSON.stringify({ d: bloc(b4).startTime, b: blocages(b4).length }));
  const six = [];
  for (let k = 0; k < 6; k += 1) six.push(dossier('gembloux', 2, laser('gembloux', 2, '18:00', six.slice())));
  const b5 = laser('gembloux', 2, '18:00', six);
  ok(blocages(b5).length > 0 && /6 parties tournent/.test(blocages(b5)[0].message || ''), '[B] Gembloux : six parties tournent, la septieme attend meme s il reste des armes', blocages(b5)[0] && blocages(b5)[0].message);

  // [C] La regle de la base
  const garde = database.ensureLaserCapacity;
  ok(typeof garde === 'function', '[C] la garde de la base est accessible');
  const passe = (payload, existantes) => { try { garde(payload, existantes, [], JOUR); return ''; } catch (error) { return String(error.message); } };
  ok(passe({ ...dossier('gembloux', 8, b2) }, [rb1]) === '', '[C] Gembloux : la base accepte deux groupes en meme temps');
  ok(/complet/i.test(passe({ ...dossier('gembloux', 2, b5) }, six)), '[C] Gembloux : la base refuse la septieme partie', passe({ ...dossier('gembloux', 2, b5) }, six));
  ok(/complet/i.test(passe({ ...dossier('gembloux', 8, b3) }, [rb1, rb2])), '[C] Gembloux : la base refuse au-dela des 20 armes');
  ok(passe({ ...dossier('libramont', 8, a2) }, [ra1]) === '', '[C] Libramont : la base accepte deux groupes dans la meme partie');
  const a5 = { ...a1, resourceBlocks: a1.resourceBlocks.map((b) => ({ ...b, start: b.start + 15, end: b.end + 15, startTime: '15:15', endTime: '15:40', players: 4 })) };
  ok(/complet/i.test(passe({ ...dossier('libramont', 4, a5) }, [ra1])), '[C] Libramont : la base refuse une deuxieme partie qui chevauche la premiere');

  // [D] Le mail
  const mail = (centerId, plan, pax) => String(comm.buildMessage({ reservation: { ...dossier(centerId, pax, plan), name: 'Essai', email: 'qa@example.com', phone: '0470000000', validationStatus: 'confirmed' }, templateId: 'confirmation', channel: 'email' }).body);
  const mg = mail('gembloux', b2, 8);
  const ml = mail('libramont', a2, 8);
  ok(/sa propre partie/.test(mg) && !/complétée|partagé/.test(mg), '[D] Gembloux : le mail dit que le groupe a sa propre partie', (mg.match(/[^.\n]*Laser Game[^.\n]*\./g) || []).join(' | '));
  ok(/partagé|complétée/.test(ml) && !/sa propre partie/.test(ml), '[D] Libramont : le mail previent que la partie peut etre partagee', (ml.match(/[^.\n]*Laser Game[^.\n]*\./g) || []).join(' | '));

  // [E] Les formules
  const etapes = (f, c) => (formuleDuCentre(knowledge.getFormula(f), knowledge.getCenter(c)).steps || []).map((s) => s.activityId);
  ok(!etapes('kfd', 'gembloux').includes('playground') && etapes('kfd', 'gembloux').includes('arcade_time'), '[E] Gembloux : le Kids Fun Day perd la plaine de jeux, il garde le reste', etapes('kfd', 'gembloux').join('+'));
  ok(etapes('kfd', 'libramont').includes('playground'), '[E] Libramont : le Kids Fun Day garde sa plaine de jeux', etapes('kfd', 'libramont').join('+'));
  ok(etapes('f6', 'gembloux').includes('playground'), '[E] Gembloux : la Formule 6 ne perd rien, c est sa plaine de jeux qui la tient absente', etapes('f6', 'gembloux').join('+'));
  ok(etapes('mm', 'gembloux').includes('laser_game') && etapes('mm', 'gembloux').includes('arcade_time'), '[E] Gembloux : le Matin Malin est entier', etapes('mm', 'gembloux').join('+'));
  return fautes;
}

if (process.argv.includes('--contre-preuves')) {
  let code = 0;
  for (const mut of MUTATIONS) {
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, LASER_PAR_CENTRE_CASSE: JSON.stringify(mut) }, encoding: 'utf8', timeout: 120000 });
    const rouges = String(r.stdout || '').split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.slice(6));
    const mord = rouges.some((l) => l.startsWith(mut.lettre));
    console.log(`${mord ? 'OK  ' : 'FAIL'}  contre-preuve : ${mut.nom} : ${rouges.length} rouge(s), ${rouges[0] || String(r.stdout || r.stderr).slice(0, 160)}`);
    if (!mord) code = 1;
  }
  process.exit(code);
} else {
  let fautes;
  try { fautes = verifier(); } catch (error) { console.log(`FAIL  [Z] exception : ${error && error.stack}`); fautes = ['exception']; }
  console.log(fautes.length ? `laser-par-centre-check : ${fautes.length} defaut(s).` : 'laser-par-centre-check : ALL OK');
  process.exit(fautes.length ? 1 : 0);
}
