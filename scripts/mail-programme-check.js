'use strict';
// LE MAIL DIT LE PROGRAMME QUE LA RESERVATION GARDE, HEURE PAR HEURE.
//
// Movsar, le 14/10 : « les mails sont pas correct et explique mal [...] ça me
// dit juste vos horaires : laser game 14h mais ya les deux parties de laser qui
// ont un horaire choisi et arcade aussi et ça dit que arcade c a votre rythme
// et donc si ils ont choisi de placer certaine heure avec lequipe alors la oui
// ça doit dire a votre rythme ». Mesure du jour : la confirmation lisait le
// PREMIER bloc d arene seulement (la partie 2 disparaissait) et disait « à
// votre rythme » de toute etape libre de la frise, arcades posees comprises.
//
// Ce gate compose de VRAIS plans (lib/reservation-ops prepareReservationOps,
// le moteur sur une journee vide, en memoire : aucune base, rien d envoye),
// puis les mails qui en sortent :
//   [A] Formule 2, parties a 14:00 et 15:00, arcades a 15:30 : la confirmation
//       a une ligne par partie, a l heure du plan, et les arcades a leur heure,
//       jamais « à votre rythme » ; le minigolf, lui, l est ; la fin dite est
//       celle du plan sans la marge de l equipe ; le rappel repete tout ;
//   [B] Formule 2, la partie 2 laissee a l equipe : elle se dit placee sur
//       place, les arcades sans heure se disent « à votre rythme » ;
//   [C] Formule 1, bowling 14:00, arcades 15:00, laser 16:00 : l ordre de la
//       journee, les pistes du bowling ; rien a son rythme, la note ne le dit
//       pas ;
//   [D] une visite (bowling, deux parties de laser, minigolf) : le meme
//       programme, la partie 2 sur place, le minigolf a son rythme, plus de
//       phrase « L ordre prevu » sans heure ;
//   [E] la copie de secours du centre : une etape libre n a pas d heure (« à
//       leur rythme »), la partie laissee a l equipe s y lit ;
//   [F] les regles d ecriture du centre (lib/client-writing) tiennent sur
//       chaque mail compose.
//   --mutate : une regle cassee a la fois, compilee en memoire dans un
//       processus fils : chacune doit faire rougir le gate ; le disque n est
//       jamais ecrit, et on le verifie.
//
// Lancement : node scripts/mail-programme-check.js [--mutate]

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');

// Aucune base, aucun envoi : seuls les NOMS des variables sont lus.
for (const cle of Object.keys(process.env)) {
  if (/(^PG|DATABASE|POSTGRES|RESEND|SECRET|TOKEN|API_KEY|PASSWORD|PASSPHRASE|TWILIO)/i.test(cle)) delete process.env[cle];
}
process.env.PINLANE_CALENDAR_SYNC = 'off';

const ROOT = path.resolve(__dirname, '..');
const DATE = '2026-11-07';
const COMMS = 'lib/ops-communications.js';
const SECOURS = 'lib/secours-mails.js';

// ---------------------------------------------------------------------------
// LES CONTRE-EPREUVES
// ---------------------------------------------------------------------------
const MUTATIONS = [
  { nom: 'seule la premiere partie de laser sort', fichier: COMMS,
    de: '    if (!b || !b.startTime || !RESSOURCES_A_HEURE.includes(b.resourceType)) return;',
    vers: "    if (!b || !b.startTime || !RESSOURCES_A_HEURE.includes(b.resourceType) || (b.resourceType === 'laser_arena' && Number(b.countIndex) > 1)) return;" },
  { nom: 'les arcades posees perdent leur heure', fichier: COMMS,
    de: '    if (!e || e.type !== \'activity\' || e.flexible !== false || !e.startTime || !e.activityId) return;',
    vers: '    if (true) return;' },
  { nom: 'les arcades posees se disent « à votre rythme »', fichier: COMMS,
    de: "    if (!e || e.type !== 'activity' || !e.activityId || e.flexible === false || e.activityId === 'service_drinks') return;",
    vers: "    if (!e || e.type !== 'activity' || !e.activityId || e.activityId === 'service_drinks') return;" },
  { nom: 'la partie laissee a l equipe ne se dit plus', fichier: COMMS,
    de: "    sansHeure.push(`${nomLaser}, partie${plusieurs ? 's' : ''} ${listeFr(enAttente.map(String))} sur ${totalLaser}, placée${plusieurs ? 's' : ''} sur place avec l'équipe selon l'affluence`);",
    vers: '    void nomLaser; void plusieurs;' },
  { nom: 'la fin dite garde la marge de l equipe', fichier: COMMS,
    de: 'heureDuPlan(Math.max(0, finPlan - Math.max(0, Math.round(Number(plan.bufferMinutes) || 0))))',
    vers: 'heureDuPlan(Math.max(0, finPlan))' },
  { nom: 'le rappel ne repete plus le programme', fichier: COMMS,
    de: '        // 15:00 : il arrive a 14:50 et repart avant son laser.\n        ...programme,\n',
    vers: '        // 15:00 : il arrive a 14:50 et repart avant son laser.\n' },
  { nom: 'la note dit « à votre rythme » sans rien a son rythme', fichier: COMMS,
    de: "${programme.some((l) => /à votre rythme/.test(l)) ? ', le reste se vit à votre rythme' : ''}",
    vers: ", le reste se vit à votre rythme" },
  { nom: 'une visite reprend la phrase de l ordre sans heure', fichier: COMMS,
    de: "  const opsPlanSentence = programme.length ? '' : buildOpsPlanSentence(reservation);",
    vers: '  const opsPlanSentence = buildOpsPlanSentence(reservation);' },
  { nom: 'la copie de secours donne une heure aux etapes libres', fichier: SECOURS,
    de: "      if (b.flexible === true) return { heure: '', quoi: `${quoi} · à leur rythme` };",
    vers: '' },
  { nom: 'la copie de secours tait la partie laissee a l equipe', fichier: SECOURS,
    de: '    if (reste.length) lignes.push(',
    vers: '    if (false) lignes.push(' },
];
const MUTATION_PREUVE = '[mutation] servie :';
const MUTATION = Number(process.env.PINLANE_MAIL_PROGRAMME_MUTATION || 0) ? MUTATIONS[Number(process.env.PINLANE_MAIL_PROGRAMME_MUTATION) - 1] : null;
if (MUTATION) {
  const compile = Module.prototype._compile;
  const cible = path.resolve(ROOT, MUTATION.fichier);
  Module.prototype._compile = function compilerAvecMutation(contenu, nom) {
    if (path.resolve(nom) !== cible) return compile.call(this, contenu, nom);
    const texte = contenu.split('\r\n').join('\n');
    if (texte.split(MUTATION.de).length - 1 !== 1) {
      console.error(`mutation impossible : ancre absente ou multiple dans ${MUTATION.fichier} : ${MUTATION.de.slice(0, 70)}`);
      process.exit(2);
    }
    console.log(`${MUTATION_PREUVE} ${MUTATION.nom}`);
    return compile.call(this, texte.split(MUTATION.de).join(MUTATION.vers), nom);
  };
}

let failures = 0;
function ok(condition, message, detail) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}${detail !== undefined && detail !== '' ? `  ${detail}` : ''}`);
  if (!condition) failures += 1;
  return Boolean(condition);
}
function section(titre) { console.log(`\n${titre}`); }

// ---------------------------------------------------------------------------
// LE MOTEUR EN MEMOIRE, SUR UNE JOURNEE VIDE
// ---------------------------------------------------------------------------
function charger() {
  const database = require(path.join(ROOT, 'lib/database.js'));
  const lire = async (date, centerId) => ({ date, centerId, laneStatuses: {}, reservations: [], blocks: [] });
  database.readAvailabilitySnapshot = lire;
  database.readStaffState = async (date, centerId) => ({ date, centerId, laneStatuses: {}, reservations: [] });
  database.createOpsEvent = async () => ({});
  database.readUpsellSlotHold = async () => null;
  database.readMatchingSlotHold = async () => null;
  return {
    lire,
    rops: require(path.join(ROOT, 'lib/reservation-ops.js')),
    comms: require(path.join(ROOT, COMMS)),
    secours: require(path.join(ROOT, SECOURS)),
    ecriture: require(path.join(ROOT, 'lib/client-writing.js')),
    bookingConfig: require(path.join(ROOT, 'lib/booking-config.js')),
  };
}
async function dossier(H, corps) {
  const ops = await H.rops.prepareReservationOps({ ...corps }, 'public', { readState: H.lire, readBlocks: async () => [] });
  return { id: 7001, ...corps, ...ops, startTime: ops.startTime || corps.startTime, opsPlan: ops.opsPlan || null, price: 300, validationStatus: 'confirmed', refus: ops.planRefusal || '' };
}
function formule(H, formuleId, heure, preference) {
  const f = H.bookingConfig.FORMULES.find((x) => x.id === formuleId);
  return {
    centerId: 'libramont', date: DATE, startTime: heure, type: 'formule', formuleId, pax: 10,
    duration: Number(H.bookingConfig.getFormuleLaneDuration(f)) || 1, totalDuration: Number(H.bookingConfig.getFormuleTotalDuration(f)) || 1,
    name: 'Client Programme', email: 'programme@example.test', phone: '+32470000000', label: f ? f.name : formuleId, preference,
    ...(preference.arcadeTime ? { arcadeTime: preference.arcadeTime } : {}),
  };
}
const mail = (H, res, templateId) => H.comms.buildMessage({ reservation: res, templateId, channel: 'email' });
const corpsDe = (m) => String((m && m.body) || '');
// Les sessions d une partie, lues dans le plan : son debut, sa fin.
function partiesDuPlan(plan, ressource) {
  const parIndex = new Map();
  ((plan && plan.resourceBlocks) || []).filter((b) => b && b.resourceType === ressource && b.startTime).forEach((b) => {
    const k = Number(b.countIndex) || 1;
    const p = parIndex.get(k) || { index: k, debut: b.startTime, fin: b.endTime || '' };
    if (b.startTime < p.debut) p.debut = b.startTime;
    if (String(b.endTime || '') > p.fin) p.fin = String(b.endTime || '');
    parIndex.set(k, p);
  });
  return [...parIndex.values()].sort((a, b) => a.index - b.index);
}
const etapeDe = (plan, id) => ((plan && plan.timeline) || []).find((e) => e && e.activityId === id) || null;
const moins = (heure, minutes) => { const [h, m] = String(heure).split(':').map(Number); const t = h * 60 + m - minutes; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const proseDe = (m) => [m.subject, m.title, m.body, m.preheader, m.note].filter(Boolean).join('\n');

async function main() {
  const H = charger();
  const composes = [];

  section('[A] FORMULE 2 : DEUX PARTIES A LEUR HEURE, LES ARCADES A LA LEUR');
  const a = await dossier(H, formule(H, 'f2', '14:00', { preferredTimes: { laser_game: '14:00' }, laserGameTimes: ['14:00', '15:00'], laserPlacement: 'scheduled', arcadeTime: '15:30' }));
  const planA = a.opsPlan || {};
  const lasersA = partiesDuPlan(planA, 'laser_arena');
  const arcA = etapeDe(planA, 'arcade_time') || {};
  ok(!a.refus && lasersA.length === 2 && arcA.flexible === false && arcA.startTime === '15:30',
    `MONTAGE le plan garde les deux parties (${lasersA.map((p) => p.debut).join(', ')}) et les arcades posees a 15:30`, a.refus || JSON.stringify(arcA));
  const confA = mail(H, a, 'confirmation');
  const rapA = mail(H, a, 'reminder_48h');
  composes.push(['A confirmation', confA], ['A rappel', rapA]);
  const lignesA = lasersA.map((p) => `- ${p.debut} à ${p.fin}, Laser Game, partie ${p.index} sur 2`);
  ok(lignesA.every((l) => corpsDe(confA).includes(l)), 'la confirmation a une ligne par partie, a l heure du plan', `${lignesA.join(' / ')} || ${corpsDe(confA).replace(/\n/g, ' / ').slice(0, 400)}`);
  const arcLigne = `- ${arcA.startTime} à ${arcA.endTime}, Arcades`;
  ok(corpsDe(confA).split('\n').includes(arcLigne) && !/Arcades[^\n]*à votre rythme/.test(corpsDe(confA)),
    `les arcades posees ont leur heure (${arcLigne.slice(2)}), jamais « à votre rythme »`);
  ok(/- Minigolf Blacklight, à votre rythme/.test(corpsDe(confA)), 'le minigolf, sans heure, se vit a votre rythme');
  const finA = moins(planA.endTime, Math.max(0, Number(planA.bufferMinutes) || 0));
  ok(corpsDe(confA).includes(`Fin estimée vers ${finA}, à titre indicatif et sans heure de départ imposée.`), `la fin dite est celle du plan sans la marge de l equipe (${planA.endTime} - ${planA.bufferMinutes} min = ${finA}), une estimation et pas une heure de depart`);
  ok([...lignesA, arcLigne].every((l) => corpsDe(rapA).includes(l)), 'le rappel J-2 repete le programme entier', corpsDe(rapA).replace(/\n/g, ' / ').slice(0, 300));
  ok(/le reste se vit à votre rythme/.test(String(confA.note || '')), 'la note dit le rythme quand une activite s y vit', confA.note);

  section('[B] FORMULE 2 : LA PARTIE 2 LAISSEE A L EQUIPE');
  const b = await dossier(H, formule(H, 'f2', '14:00', { preferredTimes: { laser_game: '14:00' }, laserGameTimes: ['14:00'], laserPlacement: 'scheduled' }));
  const confB = mail(H, b, 'confirmation');
  composes.push(['B confirmation', confB]);
  ok(!b.refus && partiesDuPlan(b.opsPlan, 'laser_arena').length === 1, 'MONTAGE le plan ne pose que la partie 1', b.refus);
  ok(corpsDe(confB).includes("- Laser Game, partie 2 sur 2, placée sur place avec l'équipe selon l'affluence"), 'la partie 2 se dit placee sur place avec l equipe', corpsDe(confB).replace(/\n/g, ' / ').slice(0, 400));
  ok(/- Arcades, 30 min, à votre rythme/.test(corpsDe(confB)), 'les arcades sans heure se disent a votre rythme, avec leurs minutes');

  section('[C] FORMULE 1 : L ORDRE DE LA JOURNEE');
  const c = await dossier(H, formule(H, 'f1', '14:00', { preferredTimes: { bowling: '14:00', laser_game: '16:00' }, laserGameTimes: ['16:00'], laserPlacement: 'scheduled', arcadeTime: '15:00' }));
  const confC = mail(H, c, 'confirmation');
  composes.push(['C confirmation', confC]);
  const puces = corpsDe(confC).split('\n').filter((l) => /^- \d\d:\d\d/.test(l));
  const bowlingC = ((c.opsPlan && c.opsPlan.resourceBlocks) || []).find((x) => x.resourceType === 'bowling_lane') || {};
  ok(!c.refus && puces.length === 3 && /Bowling/.test(puces[0]) && /Arcades/.test(puces[1]) && /Laser Game/.test(puces[2]), 'bowling, arcades, laser : dans l ordre de la journee', puces.join(' / '));
  ok(Number(bowlingC.requiredLanes) > 0 && puces[0].includes(`${bowlingC.requiredLanes} piste`), `le bowling dit ses pistes (${bowlingC.requiredLanes})`, puces[0]);
  ok(!/à votre rythme/.test(corpsDe(confC)) && !/à votre rythme/.test(String(confC.note || '')), 'rien ne se vit a son rythme : ni le corps ni la note ne le disent', confC.note);

  section('[D] UNE VISITE A LA CARTE');
  const d = await dossier(H, {
    centerId: 'libramont', date: DATE, startTime: '14:00', type: 'visite', pax: 10, duration: 1, totalDuration: 1,
    program: [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 2 }, { activityId: 'minigolf_blacklight' }],
    name: 'Client Programme', email: 'programme@example.test', phone: '+32470000000', label: 'Visite',
    preference: { preferredTimes: { bowling: '14:00', laser_game: '15:30' }, laserGameTimes: [], laserPlacement: 'scheduled' },
  });
  const confD = mail(H, d, 'confirmation');
  composes.push(['D confirmation', confD]);
  const lasersD = partiesDuPlan(d.opsPlan, 'laser_arena');
  ok(!d.refus && lasersD.length === 1, 'MONTAGE la visite pose le bowling et la partie 1', d.refus);
  ok(corpsDe(confD).includes(`- ${lasersD[0] && lasersD[0].debut} à ${lasersD[0] && lasersD[0].fin}, Laser Game, partie 1 sur 2`)
    && corpsDe(confD).includes("- Laser Game, partie 2 sur 2, placée sur place avec l'équipe selon l'affluence")
    && /- Minigolf Blacklight, à votre rythme/.test(corpsDe(confD)) && !/L’ordre prévu/.test(corpsDe(confD)),
  'la visite a le meme programme : partie 1 a l heure, partie 2 sur place, minigolf a son rythme, plus de phrase d ordre sans heure', corpsDe(confD).replace(/\n/g, ' / ').slice(0, 400));

  section('[E] LA COPIE DE SECOURS DU CENTRE');
  const copieA = H.secours.mailCopieReservation(a, { evenement: 'nouvelle' });
  const copieB = H.secours.mailCopieReservation(b, { evenement: 'nouvelle' });
  ok(/Minigolf Blacklight · à leur rythme/.test(copieA.text) && !/Minigolf Blacklight[^\n]*→/.test(copieA.text) && /15:30 → 16:00/.test(copieA.text),
    'une etape libre n a pas d heure (« à leur rythme »), les arcades posees gardent la leur', copieA.text.split('\n').filter((l) => /Minigolf|Arcades/.test(l)).join(' / '));
  ok(/partie 2 sur 2 · à placer sur place/.test(copieB.text), 'la partie laissee a l equipe s y lit', copieB.text.split('\n').filter((l) => /Laser/.test(l)).join(' / '));

  section('[F] LES REGLES D ECRITURE DU CENTRE');
  const fautes = composes.flatMap(([nom, m]) => H.ecriture.verifierEcritureClient(proseDe(m), { etat: 'confirme' }).map((e) => `${nom} : ${e.quoi} (${e.extrait})`));
  ok(composes.length === 5 && fautes.length === 0, `chaque mail compose tient les regles (${composes.length} mails)`, fautes.slice(0, 3).join(' | '));
  const tirets = composes.filter(([, m]) => /[\u2013\u2014]/.test(proseDe(m))).map(([nom]) => nom);
  ok(tirets.length === 0, 'aucun tiret cadratin ni demi-cadratin', tirets.join(', '));

  if (failures) {
    console.error(`\nmail-programme-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nmail-programme-check: ALL OK (chaque partie a son heure, les arcades posees a la leur, « à votre rythme » pour ce qui n en a pas, dans la confirmation, le rappel et la copie du centre)');
  process.exit(0);
}

function contreEpreuves() {
  const fichiers = [...new Set(MUTATIONS.map((m) => m.fichier))];
  const empreintes = new Map(fichiers.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
  let defauts = 0;
  MUTATIONS.forEach((mutation, index) => {
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, PINLANE_MAIL_PROGRAMME_MUTATION: String(index + 1) }, encoding: 'utf8', timeout: 180000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const servie = sortie.includes(`${MUTATION_PREUVE} ${mutation.nom}`);
    const rouges = sortie.split('\n').filter((l) => l.startsWith('FAIL')).length;
    if (r.status === 2 || !servie) {
      defauts += 1;
      console.error(`contre-epreuve DESARMEE : ${mutation.nom} (${r.status === 2 ? 'ancre introuvable' : 'mutation non servie'})`);
    } else if (r.status !== 1 || !rouges) {
      defauts += 1;
      console.error(`contre-epreuve MUETTE : le gate reste vert quand ${mutation.nom}.`);
    } else {
      console.log(`contre-epreuve OK : le gate rougit quand ${mutation.nom} (${rouges} FAIL).`);
    }
  });
  const touches = [...empreintes].filter(([f, avant]) => fs.readFileSync(path.join(ROOT, f), 'utf8') !== avant);
  if (touches.length) {
    defauts += 1;
    console.error(`un fichier a ete ecrit : ${touches.map(([f]) => f).join(', ')}`);
  }
  if (defauts) {
    console.error(`\nmail-programme-check --mutate: ${defauts} defaut(s).`);
    process.exit(1);
  }
  console.log(`contre-epreuve OK : ${MUTATIONS.length} mutations, et aucun fichier n a ete ecrit.`);
}

if (process.argv.includes('--mutate')) contreEpreuves();
else main().catch((error) => { console.error(error); process.exit(1); });
