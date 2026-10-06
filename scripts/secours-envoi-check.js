// LA BOITE DE SECOURS RECOIT LA BONNE JOURNEE AU BON MOMENT, ET JAMAIS EN RAFALE (2026-10-05).
//
// Une journee entiere jouee quart d heure par quart d heure (le rythme du
// cron), sans reseau ni base : une boite factice, une base factice, l horloge
// posee. Ce gate prouve :
//   [A] rien avant 8 h ; la feuille de 8 h part, PDF papier + Excel joints ;
//   [B] sans changement, rien ; une reservation qui change : une version a
//       jour, puis plus rien pendant 15 minutes meme si ca rechange ;
//   [C] 13 h et 17 h partent ; un cron rate entre 16 h et 18 h : UN seul mail
//       a 18 h (pas deux) ;
//   [D] le soir : le classeur du jour et la feuille de demain, une seule fois ;
//   [E] un centre sans boite de secours ne recoit rien ; un centre en panne
//       n empeche pas les autres ; aucune adresse reservee ne recoit rien ;
//   [F] l envoi Resend porte les pieces jointes en base64 ; sans cle, rien ne
//       part et c est dit.
//   Contre-epreuve : sans l ecart de 15 minutes, [B] rougit.
//
// Usage : node scripts/secours-envoi-check.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const se = require(path.join(ROOT, 'lib/secours-envoi.js'));

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

const JOUR = '2026-11-14'; // heure d hiver : Bruxelles = UTC+1
const DEMAIN = '2026-11-15';
const aBruxelles = (hhmm, jour = JOUR) => new Date(`${jour}T${hhmm}:00+01:00`);
const resa = (id, o = {}) => ({ id, centerId: 'libramont', date: JOUR, startTime: '15:00', pax: 8, name: `Groupe ${id}`, phone: '+32470000' + id, email: `g${id}@exemple.be`, status: 'pending', validationStatus: 'confirmed', type: 'formule', formuleId: 'f4', price: 312, lanes: [1, 2], notes: '', updatedAt: '2026-11-10T10:00:00Z', ...o });

function monde(module, { centres }) {
  const base = { [JOUR]: [resa(1), resa(2, { startTime: '17:00', type: 'visite', formuleId: '' })], [DEMAIN]: [resa(9, { date: DEMAIN, startTime: '11:00' })] };
  const etats = {};
  const envois = [];
  const deps = {
    lireEtat: async (id) => etats[id] || {},
    ecrireEtat: async (id, e) => { etats[id] = e; },
    lireJournee: async (id, date) => {
      if (id === 'panne') throw new Error('base injoignable');
      return { reservations: (base[date] || []).map((r) => ({ ...r })), demandes: [] };
    },
    formules: () => ({ f4: 'FORMULE 4' }),
    envoyer: async (mail) => { envois.push(mail); return { id: `m${envois.length}` }; },
  };
  const tic = (hhmm, jour) => module.lancerSecours({ centres, instant: aBruxelles(hhmm, jour), env: {}, deps });
  return { base, etats, envois, tic };
}

const CENTRES = [
  { id: 'libramont', name: 'Fun Galaxy Libramont', secours: { emails: ['secours@fungalaxy.be', 'x@demo.test'] } },
  { id: 'sans', name: 'Sans boite', secours: { emails: [] } },
  { id: 'panne', name: 'En panne', secours: { emails: ['panne@fungalaxy.be'] } },
];

async function journee(module) {
  const m = monde(module, { centres: CENTRES });
  const compte = () => m.envois.filter((e) => e.to.includes('secours@fungalaxy.be')).length;
  const res = {};
  await m.tic('07:45'); res.avant8 = compte();
  const r8 = await m.tic('08:00'); res.a8 = compte(); res.mail8 = m.envois[m.envois.length - 1]; res.r8 = r8;
  await m.tic('08:15'); res.sansChangement = compte();
  m.base[JOUR].push(resa(3, { startTime: '19:00', name: 'Nouveau' }));
  await m.tic('09:00'); res.apresChangement = compte();
  m.base[JOUR][0].pax = 12;
  await m.tic('09:05'); res.rafale = compte();
  await m.tic('09:20'); res.apres15 = compte();
  await m.tic('13:00'); res.a13 = compte();
  // cron rate de 16 h a 18 h
  await m.tic('18:00'); res.a18 = compte(); res.mail18 = m.envois[m.envois.length - 1];
  await m.tic('18:15'); res.a1815 = compte();
  await m.tic('23:30'); res.soir = compte(); res.mailSoir = m.envois[m.envois.length - 1];
  await m.tic('23:45'); res.soir2 = compte();
  res.tous = m.envois;
  return res;
}

(async () => {
  const r = await journee(se);
  console.log('[A] le matin');
  ok(r.avant8 === 0, '[A] rien avant 8 h');
  ok(r.a8 === 1, '[A] la feuille de 8 h part', `${r.a8}`);
  const pj = (r.mail8 && r.mail8.attachments) || [];
  const pdf = pj.find((a) => /\.pdf$/.test(a.filename));
  const xlsx = pj.find((a) => /\.xlsx$/.test(a.filename));
  ok(pdf && Buffer.from(pdf.contenu).slice(0, 5).toString() === '%PDF-' && pdf.filename === `feuille-libramont-${JOUR}.pdf`, '[A] la feuille papier est jointe (PDF)', pdf && pdf.filename);
  ok(xlsx && Buffer.from(xlsx.contenu).slice(0, 2).toString() === 'PK', '[A] le classeur Excel est joint', xlsx && xlsx.filename);
  ok(r.mail8 && /\[Secours\] Feuille du /.test(r.mail8.subject) && /8h/.test(r.mail8.subject), '[A] l objet dit feuille et moment', r.mail8 && r.mail8.subject);
  ok(r.mail8 && JSON.stringify(r.mail8.to) === '["secours@fungalaxy.be"]', '[A] seule la vraie adresse recoit (pas x@demo.test)', JSON.stringify(r.mail8 && r.mail8.to));
  console.log('[B] les changements');
  ok(r.sansChangement === 1, '[B] sans changement, rien');
  ok(r.apresChangement === 2, '[B] une reservation ajoutee : une version a jour');
  ok(r.rafale === 2, '[B] un autre changement 5 min apres : rien (15 min d ecart)');
  ok(r.apres15 === 3, '[B] 20 min apres : la version a jour part');
  console.log('[C] 13 h, 17 h, cron rate');
  ok(r.a13 === 4, '[C] 13 h part');
  ok(r.a18 === 5 && /17h/.test(r.mail18.subject), '[C] cron rate de 16 h a 18 h : un seul mail, celui de 17 h', r.mail18 && r.mail18.subject);
  ok(r.a1815 === 5, '[C] rien de plus ensuite');
  console.log('[D] le soir');
  ok(r.soir === 6 && /pour demain/.test(r.mailSoir.subject), '[D] le soir : la feuille de demain', r.mailSoir && r.mailSoir.subject);
  ok(r.mailSoir && r.mailSoir.attachments.some((a) => a.filename === `feuille-libramont-${DEMAIN}.pdf`) && r.mailSoir.attachments.some((a) => a.filename === `reservations-libramont-${JOUR}.xlsx`), '[D] avec le classeur du jour et la feuille de demain');
  ok(r.soir2 === 6, '[D] une seule fois');
  console.log('[E] les centres');
  ok(!r.tous.some((e) => e.to.includes('panne@fungalaxy.be')) && r.r8.resultats.some((x) => x.centre === 'panne' && /injoignable/.test(x.erreur || '')), '[E] un centre en panne est signale, les autres partent quand meme');
  ok(r.r8.resultats.some((x) => x.centre === 'sans' && x.ignore), '[E] un centre sans boite de secours ne recoit rien');
  console.log('[F] l envoi Resend');
  let requete = null;
  const fauxFetch = async (url, init) => { requete = { url, init }; return { ok: true, json: async () => ({ id: 're_1' }) }; };
  const envoi = await se.envoyerResend({ to: ['a@b.be'], subject: 's', html: 'h', text: 't', attachments: [{ filename: 'f.pdf', contenu: Buffer.from('%PDF-1.4') }], idempotencyKey: 'k', fetchImpl: fauxFetch, env: { RESEND_API_KEY: 'cle' } });
  const corps = requete ? JSON.parse(requete.init.body) : {};
  ok(envoi.id === 're_1' && corps.attachments && corps.attachments[0].content === Buffer.from('%PDF-1.4').toString('base64') && requete.init.headers['Idempotency-Key'] === 'k', '[F] pieces jointes en base64, cle d idempotence');
  const sansCle = await se.envoyerResend({ to: ['a@b.be'], subject: 's', html: 'h', text: 't', fetchImpl: fauxFetch, env: {} });
  ok(sansCle.skipped === true && /RESEND_API_KEY/.test(sansCle.reason), '[F] sans cle : rien ne part, et c est dit');

  console.log('[G] la copie de chaque reservation');
  const copies = [];
  const envoyerCopie = async (m) => { copies.push(m); return { id: 'c1' }; };
  const centreCopie = { id: 'libramont', name: 'Fun Galaxy Libramont', secours: { emails: ['secours@fungalaxy.be'] } };
  const c1 = await se.copieSecours(resa(5, { name: 'Copie' }), { centre: centreCopie, envoyer: envoyerCopie, env: {} });
  ok(c1.id === 'c1' && copies[0] && /\[Secours\] Nouvelle réservation/.test(copies[0].subject) && /\+32470000 ?5|\+324700005/.test(copies[0].html), '[G] une copie complete part a la boite de secours', copies[0] && copies[0].subject);
  const c2 = await se.copieSecours(resa(5), { centre: { ...centreCopie, secours: { emails: [] } }, envoyer: envoyerCopie, env: {} });
  ok(c2.ignore && copies.length === 1, '[G] sans boite de secours : rien');
  const c3 = await se.copieSecours(resa(5), { centre: centreCopie, envoyer: async () => { throw new Error('Resend 500'); }, env: {} });
  ok(c3.erreur === 'Resend 500', '[G] un envoi qui echoue ne leve pas : la reservation n echoue jamais pour sa copie');

  console.log('[H] la base tombe pendant que le client confirme');
  const parti = [];
  const envoyerPanne = async (m) => { parti.push(m); return { id: 'p1' }; };
  const demandePanne = { centerId: 'libramont', name: 'Julie', phone: '+32471000222', email: 'julie@exemple.be', date: JOUR, startTime: '15:00', pax: 8, formuleId: 'f4', quotedPrice: 312 };
  ok(await se.transmettreEnPanne(demandePanne, { envoyer: envoyerPanne, env: { PINLANE_SECOURS_EMAILS: 'secours@fungalaxy.be' } }) === true && /À SAISIR/.test(parti[0].subject), '[H] la demande entiere part, marquee « À SAISIR »', parti[0] && parti[0].subject);
  ok(await se.transmettreEnPanne({ ...demandePanne, name: '' }, { envoyer: envoyerPanne, env: { PINLANE_SECOURS_EMAILS: 'secours@fungalaxy.be' } }) === false, '[H] sans nom : on ne pretend pas avoir transmis');
  ok(await se.transmettreEnPanne(demandePanne, { envoyer: envoyerPanne, env: {} }) === false, '[H] sans boite de secours : on ne pretend pas avoir transmis');
  ok(await se.transmettreEnPanne(demandePanne, { envoyer: async () => ({ skipped: true }), env: { PINLANE_SECOURS_EMAILS: 'secours@fungalaxy.be' } }) === false, '[H] un envoi saute (pas de cle) : on ne pretend pas avoir transmis');
  const { prepareReservationOps } = require(path.join(ROOT, 'lib/reservation-ops.js'));
  let leve = null;
  try { await prepareReservationOps({ centerId: 'libramont', date: JOUR, startTime: '15:00', pax: 8, type: 'formule', formuleId: 'f4', name: 'x', phone: '+32470000000' }, 'public', { readState: async () => { throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }); } }); } catch (e) { leve = e; }
  ok(leve && leve.code === 'ECONNREFUSED', '[H] une base injoignable remonte (plus deguisee en « aucun creneau »)');
  const autre = await prepareReservationOps({ centerId: 'libramont', date: JOUR, startTime: '15:00', pax: 8, type: 'formule', formuleId: 'f4', name: 'x', phone: '+32470000000' }, 'public', { readState: async () => { throw new Error('Plan impossible'); } });
  ok(autre.blockOnlineConfirmation === true, '[H] une autre erreur reste un creneau impossible (comportement d avant)');

  console.log('[contre-épreuve]');
  const source = fs.readFileSync(path.join(ROOT, 'lib/secours-envoi.js'), 'utf8');
  const ancre = 'const ECART_MISE_A_JOUR_MS = 15 * 60 * 1000;';
  if (source.split(ancre).length !== 2) ok(false, '[contre-épreuve] ancre absente');
  else {
    const f = path.join(os.tmpdir(), `secours-envoi-mute-${process.pid}.js`);
    // Chemin en barres obliques : sous Windows, les « \ » colles dans une
    // chaine JS deviennent des echappements et le require ne trouve plus rien.
    fs.writeFileSync(f, source.replace(ancre, 'const ECART_MISE_A_JOUR_MS = 0;').split("require('./").join(`require('${ROOT.split(path.sep).join('/')}/lib/`));
    const mute = require(f);
    fs.unlinkSync(f);
    const rm = await journee(mute);
    ok(rm.rafale === 3, '[contre-épreuve] sans l ecart de 15 min, [B] rougit (rafale envoyee)', `${rm.rafale}`);
  }

  console.log('');
  console.log(failures ? `secours-envoi-check: ${failures} FAIL` : 'secours-envoi-check: ALL OK (8 h, 13 h, 17 h, mises a jour espacees, soir, pieces jointes, centres isoles)');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
