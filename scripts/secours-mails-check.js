// LES MAILS DE SECOURS DISENT TOUT, ET PARTENT LA OU IL FAUT (2026-10-05).
//
// Movsar : « toutes les reservations, absolument toutes les infos doivent
// etre stockees au-dela du site », « si Pinlane crash il faut qu on ait acces
// par mail », « toutes les demandes sur mesure doivent etre expliquees et
// envoyees par mail aussi pour rien oublier ». Un mail de secours qui oublie le
// telephone, les notes ou l heure d un bloc ne sert a rien le jour ou il sert.
//
// CE QUE CE GATE PROUVE (fonctions pures, aucune base, aucun envoi) :
//   [A] une copie de reservation porte CHAQUE champ utile a l accueil : nom,
//       telephone, e-mail, date, heure, personnes, offre, pistes, programme
//       heure par heure, prix et tarif de reference, statut, validation,
//       paiement, notes, reference, canal ; les notes d equipe internes
//       ([equipe] ...) n en sortent pas ;
//   [B] une modification dit ce qui a change (avant → apres) ;
//   [C] une demande sur mesure porte le contact, le groupe, les ages, les
//       dates, chaque activite avec ses joueurs, le conseil, le budget, la TVA
//       et le message entier ;
//   [D] la feuille du jour compte les reservations actives et les liste par
//       heure ; la panne dit « À SAISIR » et ce qu il faut faire ;
//   [E] le HTML echappe tout ce que le client a tape (aucune balise ne passe) ;
//       la version texte existe et contient les memes faits ;
//   [F] les destinataires : la boite du centre puis la variable, jamais une
//       adresse reservee (.test, .example...), jamais un doublon, jamais une
//       adresse mal formee.
//
// Usage : node scripts/secours-mails-check.js
'use strict';

const path = require('path');
const m = require(path.join(__dirname, '..', 'lib', 'secours-mails.js'));

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

const resa = {
  id: 9123, centerId: 'libramont', name: 'Famille <b>Dupont</b>', phone: '+32 470 12 34 56', email: 'dupont@exemple.be',
  date: '2026-10-17', startTime: '15:30', pax: 8, type: 'formule', formuleId: 'f4', label: 'FORMULE 4',
  lanes: [3, 4], price: 280, basePrice: 312, status: 'confirmed', validationStatus: 'confirmed', paymentMethod: '', channel: 'public',
  notes: 'Gâteau apporté par les parents\n[equipe] {"t":"client difficile","par":"Seb","le":"2026-10-01T10:00:00Z"}',
  occasion: 'anniversaire', companions: 2, extras: [{ name: 'Pizza × 6', price: 48 }],
  opsPlan: { arrivalTime: '15:20', timeline: [
    { type: 'activity', activityId: 'bowling', label: 'Bowling', startTime: '15:30', endTime: '16:30', requiredLanes: 2, players: 8 },
    { type: 'activity', activityId: 'laser_game', label: 'Laser Game', startTime: '17:00', endTime: '17:25', players: 8, groupWaveIndex: 1, groupWaveCount: 2 },
  ] },
  createdAt: '2026-10-05T08:00:00Z',
};
const centre = { name: 'Fun Galaxy Libramont', secours: { emails: ['Secours@FunGalaxy.be', 'secours@fungalaxy.be', 'x@demo.test', 'pas-une-adresse'] } };
const noms = { nomActivite: (id) => ({ bowling: 'Bowling', laser_game: 'Laser Game' }[id] || id), nomFormule: () => 'FORMULE 4' };

console.log('[A] une reservation entiere');
const a = m.mailCopieReservation(resa, { centre, evenement: 'nouvelle', ...noms });
const faits = ['+32 470 12 34 56', 'dupont@exemple.be', 'samedi 17 octobre 2026', '15:30', '15:20', 'FORMULE 4', '3, 4', '15:30 → 16:30', 'Bowling · 2 pistes · 8 joueurs', '17:00 → 17:25', 'vague 1/2', '280 €', 'tarif de référence 312 €', 'Pizza × 6', 'Confirmée', 'Gâteau apporté par les parents', '#9123', 'En ligne (formulaire)', 'Fun Galaxy Libramont'];
const manquants = faits.filter((f) => !a.html.includes(f.replace(/</g, '&lt;')));
ok(!manquants.length, '[A] la copie porte chaque champ utile a l accueil', manquants.join(' | '));
ok(!/client difficile/.test(a.html) && !/client difficile/.test(a.text), '[A] une note d equipe interne ne sort pas dans la copie');
ok(/^\[Secours\] Nouvelle réservation · sam\. 17\/10 15:30 · /.test(a.subject), '[A] l objet dit quoi, quand et qui', a.subject);

console.log('[B] une modification');
const b = m.mailCopieReservation({ ...resa, pax: 10, startTime: '16:00' }, { centre, evenement: 'modifiee', avant: resa, par: 'Movsar', ...noms });
ok(/Ce qui a changé/.test(b.html) && b.html.includes('8 → 10') && b.html.includes('15:30 → 16:00'), '[B] ce qui a change se lit avant → apres');
ok(b.html.includes('Movsar'), '[B] qui a modifie');

console.log('[C] une demande sur mesure');
const lead = { id: 77, centerId: 'libramont', contactName: 'Claire', company: 'Athénée', phone: '+32 470 99 88 77', email: 'claire@exemple.be', requestedDate: 'mercredi 14 octobre 2026, après-midi', pax: 42, message: 'Deux classes. <script>alert(1)</script> Allergie arachides.',
  payload: { demande: { groupTypeLabel: 'École, jeunesse', participants: 42, companions: 4, ages: ['7-12'], momentLabel: 'Après-midi', alternativeDate: '2026-10-21', activities: [{ id: 'bowling', name: 'Bowling', participants: 42, duration: 1 }, { id: 'laser_game', name: 'Laser Game', participants: 30, games: 2 }], advice: true, budgetPerPerson: 15, invoice: true, vatNumber: 'BE0123.456.789' } } };
const c = m.mailCopieDemandeSurMesure(lead, { centre });
const faitsC = ['Claire', 'Athénée', '+32 470 99 88 77', 'claire@exemple.be', 'École, jeunesse', '42', '7 à 12 ans', 'mercredi 21 octobre 2026', 'Bowling · 42 joueurs · 1 h', 'Laser Game · 30 joueurs · 2 parties', 'l’avis de l’équipe', '15 €', 'BE0123.456.789', 'Allergie arachides', 'Demande #77'];
const manquantsC = faitsC.filter((f) => !c.html.includes(f));
ok(!manquantsC.length, '[C] la demande porte tout ce que le client a rempli', manquantsC.join(' | '));

console.log('[D] la feuille et la panne');
const jour = [resa, { ...resa, id: 2, name: 'Annulé', status: 'cancelled', startTime: '10:00' }, { ...resa, id: 3, name: 'Matin', startTime: '10:30', pax: 4, validationStatus: 'staff_review' }];
const d = m.mailFeuilleDuJour({ date: '2026-10-17', centre, reservations: jour, moment: '13 h' });
ok(/2 réservations · 12 pers\./.test(d.subject), '[D] la feuille compte les reservations actives (annulee exclue)', d.subject);
ok(d.html.indexOf('10:30') < d.html.indexOf('15:30') && !d.html.includes('Annulé'), '[D] la liste est triee par heure, sans l annulee');
const p = m.mailReservationPendantPanne({ centerId: 'libramont', name: 'Julie', phone: '+32 471', email: 'j@e.be', date: '2026-10-10', startTime: '15:00', pax: 8, formuleId: 'f4', quotedPrice: 312 }, { centre, erreur: 'connect ECONNREFUSED', ...noms });
ok(/À SAISIR/.test(p.subject) && /n’a pas pu enregistrer/.test(p.html) && p.html.includes('312 €'), '[D] la panne dit « À SAISIR », ce qu il faut faire et le montant montre au client');

console.log('[E] echappement et texte');
ok(!/<b>Dupont<\/b>/.test(a.html) && a.html.includes('Famille &lt;b&gt;Dupont&lt;/b&gt;'), '[E] le nom tape par le client est echappe');
ok(!/<script>/.test(c.html) && c.html.includes('&lt;script&gt;'), '[E] le message du client est echappe');
ok(a.text.includes('+32 470 12 34 56') && a.text.includes('15:30 → 16:30') && c.text.includes('BE0123.456.789'), '[E] la version texte porte les memes faits');

console.log('[F] destinataires');
const dest = m.destinatairesSecours(centre, { PINLANE_SECOURS_EMAILS: 'ansarbis2.0@gmail.com; secours@fungalaxy.be, y@x.example' });
ok(JSON.stringify(dest) === JSON.stringify(['secours@fungalaxy.be', 'ansarbis2.0@gmail.com']), '[F] centre puis variable, sans doublon, sans adresse reservee ni mal formee', JSON.stringify(dest));
ok(m.destinatairesSecours(null, {}).length === 0, '[F] sans reglage, personne (aucune adresse inventee)');

// CONTRE-EPREUVES : le module servi casse expres, une mutation a la fois, et
// la mesure correspondante doit rougir (sinon elle ne mesure rien).
console.log('[contre-épreuves]');
const fs = require('fs');
const os = require('os');
const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'secours-mails.js'), 'utf8');
function muter(de, vers) {
  if (source.split(de).length !== 2) throw new Error('ancre absente ou multiple : ' + de.slice(0, 60));
  const fichier = path.join(os.tmpdir(), `secours-mails-mute-${process.pid}-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(fichier, source.replace(de, vers).split("require('./").join(`require('${path.join(__dirname, '..', 'lib')}/`));
  try { return require(fichier); } finally { fs.unlinkSync(fichier); }
}
const sansTel = muter("['Téléphone', r.phone], ['E-mail', r.email], ['Occasion', r.occasion], ['Accompagnants'", "['E-mail', r.email], ['Occasion', r.occasion], ['Accompagnants'");
ok(!sansTel.mailCopieReservation(resa, { centre, ...noms }).html.includes('+32 470 12 34 56'), '[contre-épreuve] sans la ligne Téléphone, [A] rougit');
const sansEchappement = muter("const esc = (v) => String(v == null ? '' : v).replace(/[&<>\"']/g", "const esc = (v) => String(v == null ? '' : v).replace(/[]/g");
ok(/<b>Dupont<\/b>/.test(sansEchappement.mailCopieReservation(resa, { centre, ...noms }).html), '[contre-épreuve] sans echappement, [E] rougit');
const sansFiltre = muter('if (!a || !ADRESSE.test(a) || NON_ROUTABLE.test(a) || vus.has(a)) continue;', 'if (!a) continue;');
ok(sansFiltre.destinatairesSecours(centre, {}).includes('x@demo.test'), '[contre-épreuve] sans filtre, [F] rougit');

console.log('');
console.log(failures ? `secours-mails-check: ${failures} FAIL` : 'secours-mails-check: ALL OK (copies completes, demandes expliquees, feuille, panne, echappement, destinataires)');
process.exit(failures ? 1 : 0);
