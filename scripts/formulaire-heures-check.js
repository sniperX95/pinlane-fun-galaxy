'use strict';
// =============================================================================
// LES HEURES COMPLETES QUE LES GENS VOULAIENT (2026-11-10)
// -----------------------------------------------------------------------------
// Ansar : « samedi 15 h demandé 40 fois, complet ». Dans le formulaire public,
// une heure complete reste affichee et se touche. Ce toucher part au serveur
// (POST /api/public-booking-meta { kind: 'heures-pleines' }), la page Donnees
// de la console dit quel jour et quelle heure reviennent le plus.
//   [A] ce qui entre : un jour qui existe et tombe dans la fenetre, une heure
//       qui en est une, une activite ou une formule de CE centre, une fois
//       chacune, huit au plus ; un centre ou une visite mal formes refusent
//       tout ; rien de personnel ne peut entrer ;
//   [B] l ecriture : une requete parametree, un doublon refuse par la base,
//       sans base rien ne s ecrit, une base en panne ou une table pas encore
//       creee ne cassent jamais le formulaire, une adresse est freinee ;
//   [C] le formulaire : seule l heure ou l on lit « complet » part, une fois
//       par visite, avec la bonne piste (activite, arrivee, formule) ; ce
//       qu il envoie est accepte tel quel par le vrai lecteur ; la table, son
//       registre, son retour et son cloisonnement suivent la regle ;
//   [D] la lecture : toujours un seul centre, le jour VOULU, un classement
//       refait ici, des noms pris au catalogue ; une table absente donne un
//       tableau vide ; la console ecrit ce que le serveur a compte ;
//   [E] contre-epreuves : chaque regle retiree, ce gate ROUGIT. Elles jouent
//       sur une COPIE de la regle dans le dossier temporaire : aucun fichier
//       du depot n est modifie, un autre gate ne lit jamais une regle cassee.
// AUCUNE BASE : un faux pool garde les requetes. Le toucher reel dans un
// navigateur (une heure complete part une fois, une heure fermee jamais) est
// tenu par test:complet-explique [B], le banc ou des heures sont vraiment
// completes, et ses trois contre-preuves (--mutate).
// LES DATES : la regle se juge avec un « aujourd hui » fixe (aucun rouge de
// calendrier) ; seule la route, qui lit la vraie date, recoit un jour calcule.
// =============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
const ROOT = path.join(__dirname, '..');
const REGLE = path.join(ROOT, 'lib', 'formulaire-heures.js');

let echecs = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return Boolean(cond);
}
function section(t) { console.log(`\n--- ${t}`); }
function purger() {
  Object.keys(require.cache).filter((k) => k.startsWith(ROOT) && !k.includes(`${path.sep}node_modules${path.sep}`)).forEach((k) => { delete require.cache[k]; });
}
const lf = (fichier) => fs.readFileSync(path.join(ROOT, fichier), 'utf8').replace(/\r\n/g, '\n');

// La route, avec un faux pool : il garde chaque requete. `erreur` : le code que la base rend
// a l ECRITURE des heures (les lectures du catalogue, elles, repondent vide).
const ECRITURE = /insert into formulaire_heures_pleines/i;
function charger({ erreur = '', sansBase = false } = {}) {
  purger();
  const database = require(path.join(ROOT, 'lib/database.js'));
  const requetes = [];
  database.getPool = () => (sansBase ? null : {
    query: async (sql, valeurs) => {
      requetes.push({ sql: String(sql), valeurs });
      if (erreur && ECRITURE.test(String(sql))) { const e = new Error('panne'); e.code = erreur; throw e; }
      return { rows: [], rowCount: 0 };
    },
  });
  return { api: require(path.join(ROOT, 'api/public-booking-meta.js')), requetes };
}
function poster(api, body, ip = '203.0.113.7') {
  return new Promise((resolve, reject) => {
    const texte = JSON.stringify(body);
    // Le corps se lit comme le vrai serveur le donne : par paquets (for await).
    const req = {
      method: 'POST', url: '/api/public-booking-meta', headers: { host: '127.0.0.1', 'content-type': 'application/json', 'x-forwarded-for': ip },
      socket: { remoteAddress: ip },
      async *[Symbol.asyncIterator]() { yield Buffer.from(texte.slice(0, 7)); yield Buffer.from(texte.slice(7)); },
    };
    const res = {
      statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(c) { this.statusCode = c; },
      end(b) { let j = null; try { j = JSON.parse(String(b || '{}')); } catch (e) { j = null; } resolve({ status: this.statusCode, json: j }); },
    };
    Promise.resolve(api(req, res)).catch(reject);
  });
}

const VISITE = 'a1b2c3d4e5f6a7b8c9d0e1f2';
// La regle se juge un mardi 10 novembre 2026 ; le samedi 21 est dans la fenetre.
const AUJOURDHUI = '2026-11-10';
const SAMEDI = '2026-11-21';
const CATALOGUE = { activites: ['bowling', 'laser_game'], formules: ['f3'], aujourdHui: AUJOURDHUI };
const heure = (h, activite = 'bowling', extra = {}) => ({ jour: SAMEDI, heure: h, activite, formule: '', joueurs: 6, ...extra });
const envoi = (heures, extra = {}) => ({ kind: 'heures-pleines', centerId: 'libramont', visite: VISITE, heures, ...extra });
const dit = (l) => `${l.jour} ${l.heure} ${l.activite}${l.formule ? `/${l.formule}` : ''}`;
// Pour la route seulement : un jour compte depuis la vraie date de Bruxelles.
function dansJours(n) {
  const aujourdhui = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const d = new Date(`${aujourdhui}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Ce que la base rendrait, dans le desordre : samedi 15 h au bowling 40 fois sur 3 samedis, une
// formule et un laser a egalite, une arrivee dont les dates depassent les demandes, une
// activite retiree depuis. Plus trois lignes hors des clous (jour 9, heure 25:00, nombre negatif).
const LIGNES = [
  { jour_semaine: 3, heure: '14:00', activite: 'arrivee', formule: '', demandes: 2, dates: 5, joueurs_moyens: 4 },
  { jour_semaine: 7, heure: '16:30', activite: 'laser_game', formule: '', demandes: 12, dates: 2, joueurs_moyens: null },
  { jour_semaine: 9, heure: '15:00', activite: 'bowling', formule: '', demandes: 7, dates: 1, joueurs_moyens: 4 },
  { jour_semaine: 6, heure: '15:00', activite: 'bowling', formule: '', demandes: 40, dates: 3, joueurs_moyens: 6 },
  { jour_semaine: 5, heure: '25:00', activite: 'bowling', formule: '', demandes: 7, dates: 1, joueurs_moyens: 4 },
  { jour_semaine: 6, heure: '14:00', activite: 'formule', formule: 'f3', demandes: 12, dates: 4, joueurs_moyens: 9 },
  { jour_semaine: 5, heure: '18:00', activite: 'bowling', formule: '', demandes: -3, dates: 1, joueurs_moyens: 4 },
  { jour_semaine: 5, heure: '18:00', activite: 'ancienne_activite', formule: '', demandes: 1, dates: 1, joueurs_moyens: 2 },
];
const NOMS = { nomActivite: (id) => ({ bowling: 'Bowling', laser_game: 'Laser game' }[id] || ''), nomFormule: (id) => ({ f3: 'Anniversaire Pirate' }[id] || '') };

// Les controles de la regle, joues sur la vraie regle puis sur chaque copie cassee.
function controlesDeLaRegle(regle) {
  const r = {};
  const lire = (heures, extra) => regle.heuresRecues(envoi(heures, extra), CATALOGUE);
  const gardees = (heures) => { const x = lire(heures); return x ? x.lignes.map(dit).join(' ; ') : 'refus'; };

  // Ce qui est de CE centre entre, ce qui n en est pas reste dehors.
  r.catalogue = gardees([heure('15:00'), heure('15:00', 'karting'), heure('16:00', 'laser_game'), heure('17:00', 'arrivee')]) === `${SAMEDI} 15:00 bowling ; ${SAMEDI} 16:00 laser_game ; ${SAMEDI} 17:00 arrivee`;
  r.formuleConnue = gardees([heure('14:00', 'formule', { formule: 'f3' }), heure('14:30', 'formule', { formule: 'f99' }), heure('15:00', 'arrivee', { formule: 'f3' }), heure('15:30', 'bowling', { formule: 'inventee' })]) === `${SAMEDI} 14:00 formule/f3 ; ${SAMEDI} 15:00 arrivee/f3`;
  r.formuleSansId = gardees([heure('14:00', 'formule'), heure('15:00')]) === `${SAMEDI} 15:00 bowling`;
  // Une date se reconstruit : le 31 fevrier n existe pas, un texte n est pas une date.
  r.dateVraie = gardees([heure('15:00', 'bowling', { jour: '2027-02-31' }), heure('15:30', 'bowling', { jour: '21/11/2026' }), heure('16:00', 'bowling', { jour: '2026-13-01' }), heure('16:30')]) === `${SAMEDI} 16:30 bowling`;
  // La fenetre : d hier a l horizon du formulaire.
  r.fenetre = gardees([heure('15:00', 'bowling', { jour: '2026-11-09' }), heure('15:30', 'bowling', { jour: '2026-11-08' }), heure('16:00', 'bowling', { jour: '2028-11-21' })]) === '2026-11-09 15:00 bowling';
  r.heure = gardees([heure('25:00'), heure('9:00'), heure('15h'), heure('15:60'), heure('23:59')]) === `${SAMEDI} 23:59 bowling`;
  r.uneFois = gardees([heure('15:00'), heure('15:00'), heure('15:00', 'laser_game'), heure('15:00', 'bowling', { joueurs: 12 })]) === `${SAMEDI} 15:00 bowling ; ${SAMEDI} 15:00 laser_game`;
  // Huit heures au plus : la neuvieme, pourtant valable, n est jamais regardee.
  const dix = ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30'].map((h) => heure(h));
  const plein = lire(dix);
  r.huit = Boolean(plein) && plein.lignes.length === 8 && plein.lignes[7].heure === '13:30';
  const joueurs = lire([heure('15:00', 'bowling', { joueurs: 12 }), heure('15:30', 'bowling', { joueurs: 0 }), heure('16:00', 'bowling', { joueurs: 5000 }), heure('16:30', 'bowling', { joueurs: '8' }), heure('17:00', 'bowling', { joueurs: 2.5 })]);
  r.joueurs = Boolean(joueurs) && joueurs.lignes.map((l) => String(l.joueurs)).join(',') === '12,null,null,8,null';
  const charge = lire([heure('15:00', 'bowling', { email: 'a@exemple.be', nom: 'Dupont', telephone: '0470', message: 'pour l anniversaire de Lea' })], { nom: 'Dupont' });
  r.rienDAutre = Boolean(charge) && charge.lignes.length === 1 && Object.keys(charge.lignes[0]).sort().join(',') === 'activite,formule,heure,joueurs,jour' && Object.keys(charge).sort().join(',') === 'centerId,lignes,visite';
  r.refus = [envoi([heure('15:00')], { centerId: 'LIBRAMONT; drop' }), envoi([heure('15:00')], { visite: 'court' }), envoi('15:00'), envoi(null)].every((b) => regle.heuresRecues(b, CATALOGUE) === null)
    && regle.enveloppeRecue(envoi([heure('15:00')], { visite: 'court' })) === null;
  // Une enveloppe juste dont rien n est garde : pas un refus, une liste vide.
  const rien = lire([heure('15:00', 'karting')]);
  r.vide = Boolean(rien) && rien.centerId === 'libramont' && rien.lignes.length === 0;

  const requetes = [];
  const pool = { query: async (sql, valeurs) => { requetes.push({ sql, valeurs }); return { rows: [] }; } };
  return regle.ecrireHeures(pool, { centerId: 'libramont', visite: VISITE, lignes: [{ jour: SAMEDI, heure: '15:00', activite: 'bowling', formule: '', joueurs: 6 }, { jour: SAMEDI, heure: '14:00', activite: 'formule', formule: 'f3', joueurs: null }] })
    .then(() => regle.ecrireHeures(pool, { centerId: 'libramont', visite: VISITE, lignes: [] }))
    .then(() => {
      const q = requetes[0] || { sql: '', valeurs: [] };
      r.parametree = requetes.length === 1 && /^insert into formulaire_heures_pleines \(center_id, visite, jour, heure, activite, formule, joueurs\) values \(\$1, \$2, \$3::date, \$4, \$5, \$6, \$7\), \(\$8, \$9, \$10::date, \$11, \$12, \$13, \$14\)/.test(q.sql)
        && !q.sql.includes(VISITE) && !q.sql.includes('libramont') && !q.sql.includes(SAMEDI) && !q.sql.includes('bowling')
        && JSON.stringify(q.valeurs) === JSON.stringify(['libramont', VISITE, SAMEDI, '15:00', 'bowling', '', 6, 'libramont', VISITE, SAMEDI, '14:00', 'formule', 'f3', null]);
      r.doublon = / on conflict do nothing$/.test(q.sql);
      const lecture = regle.requeteLectureHeures({ centerId: 'gembloux', debut: '2026-11-01', fin: '2026-11-30' });
      r.unCentre = /where center_id = \$1 and created_at >= \$2::date and created_at < \(\$3::date \+ 1\)/.test(lecture.sql) && JSON.stringify(lecture.params) === JSON.stringify(['gembloux', '2026-11-01', '2026-11-30']);
      r.jourVoulu = /select extract\(isodow from jour\)::int as jour_semaine, heure, activite, formule,/.test(lecture.sql) && /count\(\*\)::int as demandes, count\(distinct jour\)::int as dates/.test(lecture.sql) && /group by 1, 2, 3, 4/.test(lecture.sql) && /limit \d+;$/.test(lecture.sql);
      const classe = regle.heuresDemandees(LIGNES, NOMS);
      r.propre = classe.length === 5 && classe.every((h) => typeof h.jour === 'string' && h.jour.length > 4 && /^\d\d:\d\d$/.test(h.heure) && h.demandes > 0);
      r.ordre = classe.map((h) => `${h.jour} ${h.heure} ${h.demandes}`).join(' ; ') === 'samedi 15:00 40 ; samedi 14:00 12 ; dimanche 16:30 12 ; mercredi 14:00 2 ; vendredi 18:00 1';
      r.noms = classe.map((h) => h.quoi).join(' ; ') === 'Bowling ; Formule Anniversaire Pirate ; Laser game ; Heure d’arrivée ; ancienne_activite'
        && regle.heuresDemandees([{ jour_semaine: 6, heure: '14:00', activite: 'formule', formule: 'f3', demandes: 1, dates: 1, joueurs_moyens: 8 }], { nomActivite: () => '', nomFormule: () => 'FORMULE 3' })[0].quoi === 'FORMULE 3'
        && regle.heuresDemandees([{ jour_semaine: 6, heure: '14:00', activite: 'arrivee', formule: 'f3', demandes: 1, dates: 1, joueurs_moyens: 8 }], NOMS)[0].quoi === 'Heure d’arrivée, Formule Anniversaire Pirate';
      r.dates = classe.find((h) => h.jour === 'mercredi').dates === 2 && classe[0].dates === 3;
      r.groupe = classe[0].joueursMoyens === 6 && classe.find((h) => h.jour === 'dimanche').joueursMoyens === null;
      r.sansLigne = regle.heuresDemandees([]).length === 0 && regle.heuresDemandees(null).length === 0;
      return r;
    });
}

// LE GESTE DU FORMULAIRE, sorti du vrai fichier et joue dans un bac : un faux navigateur garde
// ce qui part. `puce` : l etat et le mot que le formulaire a poses sur l heure.
function bacDuFormulaire(formulaire, { visite = VISITE } = {}) {
  const suivre = /  function suivreHeurePleine\(chip, track\) \{\n[\s\S]*?\n  \}\n/.exec(formulaire);
  const envoyer = /  function envoyerHeuresPleines\(\) \{\n[\s\S]*?\n  \}\n/.exec(formulaire);
  if (!suivre || !envoyer) return null;
  const bac = { envois: [], minuteurs: [] };
  vm.createContext(bac);
  vm.runInContext(`
    var VISITE = ${JSON.stringify(visite)}, CENTER = 'libramont';
    var state = { onglet: 'activites', formuleId: '', date: ${JSON.stringify(SAMEDI)} };
    var groupe = 6;
    function joueursDemandes() { return groupe; }
    function Blob(parts) { this.texte = parts.join(''); }
    var navigator = { sendBeacon: function (url, blob) { envois.push({ url: url, corps: blob.texte }); return true; } };
    function setTimeout(fn) { minuteurs.push(fn); return minuteurs.length; }
    function clearTimeout() {}
    function fetch() { return { catch: function () {} }; }
    var heuresPleinesVues = {}, heuresPleinesFile = [], heuresPleinesMinuteur = 0;
    ${suivre[0]}
    ${envoyer[0]}
  `, bac);
  return bac;
}
const puce = (time, state = 'hard', mot = 'complet') => ({ dataset: { time, state, mot } });
const piste = (activity) => ({ dataset: { activity } });

async function main() {
  const regle = require(REGLE);
  const vrai = await controlesDeLaRegle(regle);

  section('[A] CE QUI ENTRE, ET RIEN D AUTRE');
  ok(vrai.catalogue, 'une activite du centre et l heure d arrivee entrent ; une activite que le centre ne vend pas reste dehors');
  ok(vrai.formuleConnue && vrai.formuleSansId, 'une formule du centre entre avec son identifiant ; une formule inconnue, ou « formule » sans dire laquelle, reste dehors');
  ok(vrai.dateVraie, 'le jour voulu se reconstruit : le 31 fevrier, le mois 13 et une date ecrite autrement sont jetes');
  ok(vrai.fenetre, 'le jour voulu tombe entre hier et l horizon du formulaire : avant-hier et dans deux ans sont jetes');
  ok(vrai.heure, 'l heure est une heure : 25:00, 9:00, 15h et 15:60 sont jetes');
  ok(vrai.uneFois, 'la meme heure de la meme activite redite ne compte qu une fois, meme avec un groupe different');
  ok(vrai.huit, 'un envoi ne garde jamais plus de huit heures');
  ok(vrai.joueurs, 'la taille du groupe est un entier de 1 a 500, sinon elle reste vide');
  ok(vrai.rienDAutre, 'seuls le jour, l heure, l activite, la formule et la taille du groupe sont gardes (ni nom, ni mail, ni telephone, ni message)');
  ok(vrai.refus, 'un centre ou une visite mal formes, une liste absente : tout l envoi est refuse');
  ok(vrai.vide, 'une enveloppe juste dont aucune heure n est gardee : une liste vide, pas un refus');
  const JOUR_ROUTE = dansJours(5);
  const versLaRoute = (heures, extra) => envoi(heures.map((h) => ({ ...h, jour: JOUR_ROUTE })), extra);
  {
    const { api, requetes } = charger();
    const r = await poster(api, versLaRoute([heure('15:00')], { centerId: 'inexistant' }));
    ok(r.status === 404, 'un centre que la plateforme ne connait pas : 404', JSON.stringify(r));
    const mal = await poster(api, versLaRoute([heure('15:00')], { visite: 'court' }));
    ok(mal.status === 400, 'une visite mal formee : 400', JSON.stringify(mal));
    const dehors = await poster(api, versLaRoute([heure('15:00', 'karting'), heure('15:00', 'formule', { formule: 'formule_inventee' })]));
    ok(dehors.status === 202 && !requetes.some((q) => ECRITURE.test(q.sql)), 'une activite et une formule que CE centre ne vend pas : rien ne s ecrit (202)', `${dehors.status}, ${requetes.filter((q) => ECRITURE.test(q.sql)).length} ecriture(s)`);
  }

  section('[B] L ECRITURE');
  ok(vrai.parametree, 'une seule requete, parametree : rien du client dans le texte SQL, et rien du tout quand il n y a aucune heure');
  ok(vrai.doublon, 'une heure deja comptee pour cette visite ne s ecrit pas deux fois (on conflict do nothing)');
  {
    const bon = charger();
    const r = await poster(bon.api, versLaRoute([heure('15:00'), heure('16:00', 'laser_game'), heure('14:00', 'arrivee')]));
    const ecritures = bon.requetes.filter((q) => ECRITURE.test(q.sql));
    ok(r.status === 202 && r.json && r.json.ok === true && ecritures.length === 1 && ecritures[0].valeurs.length === 21 && ecritures[0].valeurs[2] === JOUR_ROUTE && ecritures[0].valeurs[4] === 'bowling',
      'la route ecrit les trois heures en une requete (202), avec le vrai catalogue du centre', `${r.status}, ${ecritures.length} ecriture(s)`);
    ok(bon.requetes.every((q) => ECRITURE.test(q.sql) || !/^\s*(insert|update|delete|alter|drop|truncate)\b/i.test(q.sql)), 'un envoi « heures-pleines » n ecrit nulle part ailleurs (ni reservation, ni demande, ni prospect)',
      bon.requetes.filter((q) => !ECRITURE.test(q.sql) && /^\s*(insert|update|delete)\b/i.test(q.sql)).map((q) => q.sql.slice(0, 40)).join(' | '));
    const sansBase = charger({ sansBase: true });
    const r2 = await poster(sansBase.api, versLaRoute([heure('15:00')]));
    ok(r2.status === 202 && r2.json && r2.json.ok === true && !sansBase.requetes.length, 'sans base : rien ne s ecrit (202)', JSON.stringify(r2));
    // La trace d une panne reste dans les journaux, une table pas encore creee se tait.
    const traces = [];
    const erreurOrigine = console.error;
    console.error = (...a) => { traces.push(a.join(' ')); };
    let r3 = null; let r4 = null;
    try {
      r3 = await poster(charger({ erreur: '57P01' }).api, versLaRoute([heure('15:00')]));
      const apresPanne = traces.filter((t) => /heures-pleines/.test(t)).length;
      r4 = await poster(charger({ erreur: '42P01' }).api, versLaRoute([heure('15:00')]));
      const apresAbsente = traces.filter((t) => /heures-pleines/.test(t)).length;
      ok(r3.status === 202 && r3.json && r3.json.ok === true && apresPanne === 1, 'une base en panne ne casse pas le formulaire (202), et la trace reste dans les journaux', `${r3.status}, ${apresPanne} trace(s)`);
      ok(r4.status === 202 && r4.json && r4.json.ok === true && apresAbsente === apresPanne, 'tant que la table n existe pas (42P01), l envoi est ignore sans bruit (202)', `${r4.status}, ${apresAbsente - apresPanne} trace(s) de plus`);
    } finally { console.error = erreurOrigine; }
    ok(JSON.stringify(r.json) === JSON.stringify(r3.json) && JSON.stringify(r.json) === JSON.stringify(r4.json), 'la reponse est la meme, que la ligne soit ecrite ou non', JSON.stringify([r.json, r3.json, r4.json]));
    const frein = charger();
    let dernier = null;
    for (let k = 0; k < 63; k += 1) dernier = await poster(frein.api, versLaRoute([heure('15:00')]), '198.51.100.9');
    const ecrites = frein.requetes.filter((q) => ECRITURE.test(q.sql)).length;
    ok(dernier && dernier.status === 429 && ecrites === 60, 'au-dela de 60 envois en 10 minutes, une adresse est freinee (429)', `${dernier && dernier.status}, ${ecrites} ecritures`);
  }

  section('[C] LE FORMULAIRE, LA TABLE ET LEURS REGISTRES');
  {
    const formulaire = lf('assets/fungalaxy-booking.js');
    const bac = bacDuFormulaire(formulaire);
    ok(Boolean(bac) && typeof bac.suivreHeurePleine === 'function' && typeof bac.envoyerHeuresPleines === 'function', 'le formulaire a son geste et son envoi');
    if (bac) {
      const partis = () => { bac.envoyerHeuresPleines(); const tout = bac.envois.map((e) => JSON.parse(e.corps)); bac.envois.length = 0; return tout; };
      bac.suivreHeurePleine(puce('15:00'), piste('bowling'));
      bac.suivreHeurePleine(puce('15:00'), piste('bowling'));
      const un = partis();
      ok(un.length === 1 && JSON.stringify(un[0]) === JSON.stringify({ kind: 'heures-pleines', centerId: 'libramont', visite: VISITE, heures: [{ jour: SAMEDI, heure: '15:00', activite: 'bowling', formule: '', joueurs: 6 }] }),
        'une heure « complet » touchee deux fois part une fois : le centre, la visite au hasard, le jour voulu, l heure, l activite, le groupe', JSON.stringify(un));
      bac.suivreHeurePleine(puce('15:00'), piste('bowling'));
      ok(partis().length === 0, 'et ne repart pas plus tard dans la meme visite');
      bac.suivreHeurePleine(puce('16:00', 'hard', 'fermé'), piste('bowling'));
      bac.suivreHeurePleine(puce('16:30', 'hard', 'trop tard'), piste('bowling'));
      bac.suivreHeurePleine(puce('17:00', 'hard', 'partie 2'), piste('laser_game'));
      bac.suivreHeurePleine(puce('17:30', 'wave', 'complet'), piste('laser_game'));
      bac.suivreHeurePleine(puce('18:00', 'soft', 'serré'), piste('bowling'));
      bac.suivreHeurePleine(puce('18:30', 'ok', ''), piste('bowling'));
      ok(partis().length === 0, 'une heure fermee, trop tardive, serree, libre, ou l heure d une de SES parties ne part pas');
      vm.runInContext("state.onglet = 'formules'; state.formuleId = 'f3'; groupe = 9;", bac);
      bac.suivreHeurePleine(puce('14:00'), piste(''));
      bac.suivreHeurePleine(puce('13:30'), piste('arrivee'));
      vm.runInContext("state.onglet = 'activites'; state.formuleId = 'f3'; groupe = 4;", bac);
      bac.suivreHeurePleine(puce('11:00'), piste(''));
      const pistes = partis();
      const lignes = pistes.flatMap((p) => p.heures);
      ok(pistes.length === 1 && lignes.map((l) => `${l.heure} ${l.activite}/${l.formule} ${l.joueurs}`).join(' ; ') === '14:00 formule/f3 9 ; 13:30 arrivee/f3 9 ; 11:00 arrivee/ 4',
        'l heure d une formule dit laquelle, l heure d arrivee d une formule aussi ; hors des formules, une heure sans activite est l heure d arrivee', JSON.stringify(lignes));
      // Ce que le formulaire envoie est accepte TEL QUEL par le vrai lecteur : le contrat tient des deux cotes.
      const recu = regle.heuresRecues({ kind: 'heures-pleines', centerId: 'libramont', visite: VISITE, heures: [...un[0].heures, ...lignes] }, CATALOGUE);
      ok(Boolean(recu) && recu.lignes.length === 4 && JSON.stringify(recu.lignes[0]) === JSON.stringify(un[0].heures[0]), 'ce que le formulaire envoie, le vrai lecteur le garde ligne pour ligne', JSON.stringify(recu && recu.lignes.map(dit)));
      for (let k = 0; k < 10; k += 1) bac.suivreHeurePleine(puce(`0${k}:15`), piste('bowling'));
      const lots = partis();
      ok(lots.length === 2 && lots[0].heures.length === 8 && lots[1].heures.length === 2 && lots.every((p) => Object.keys(p).sort().join(',') === 'centerId,heures,kind,visite'),
        'dix heures touchees partent en deux envois de huit au plus, sans aucun autre champ', lots.map((p) => p.heures.length).join(' + '));
      const anonyme = bacDuFormulaire(formulaire, { visite: '' });
      anonyme.suivreHeurePleine(puce('15:00'), piste('bowling'));
      anonyme.envoyerHeuresPleines();
      ok(anonyme.envois.length === 0, 'sans identifiant de visite (navigateur sans hasard), rien ne part');
    }
    ok(formulaire.split('      suivreHeurePleine(chip, track);\n').length === 2
      && /if \(chip\.dataset\.ok === 'false'\) \{\n[\s\S]{0,600}?chip\.classList\.add\('is-asked'\);\n      suivreHeurePleine\(chip, track\);\n/.test(formulaire),
    'le geste est appele une seule fois, au toucher d une heure qui ne se prend pas');
    ok(/JSON\.stringify\(\{ kind: 'heures-pleines', centerId: CENTER, visite: VISITE, heures: heuresPleinesFile\.splice\(0, 8\) \}\)/.test(formulaire) && regle.MAX_HEURES_PAR_ENVOI === 8, 'l envoi ne porte que le centre, la visite au hasard et huit heures au plus, comme la regle');
    // CE QUI SE LIT « complet » : la liste des raisons du moteur que le formulaire nomme ainsi.
    // Une raison de plus sous ce mot change ce que ce tableau compte : ce controle le rappelle.
    const mots = /var MOTS_DURS = (\{[\s\S]*?\});/.exec(formulaire);
    const complets = mots ? Object.entries(vm.runInNewContext(`(${mots[1]})`)).filter(([, mot]) => mot === 'complet').map(([code]) => code).sort().join(',') : '';
    ok(complets === 'arrival_full,arrival_start,capacity,resource_conflict', 'quatre raisons du moteur se lisent « complet » dans le formulaire : ce sont elles que le tableau compte', complets);
    ok(!/localStorage|sessionStorage|\.cookie\b|indexedDB/.test(formulaire), 'le formulaire public ne pose ni cookie ni stockage');

    const sql = lf('database/formulaire-heures-pleines-schema.sql');
    const sansCommentaires = sql.replace(/--.*$/gm, '');
    const colonnes = (/create table if not exists formulaire_heures_pleines \(([\s\S]*?)\n\);/.exec(sansCommentaires) || ['', ''])[1].split('\n').map((l) => l.trim()).filter((l) => l && !/^(constraint|char_length|and |\)|\()/.test(l)).map((l) => l.split(' ')[0]).join(',');
    ok(colonnes === 'id,center_id,visite,jour,heure,activite,formule,joueurs,created_at', 'la table porte exactement les colonnes que la regle ecrit, plus son rang et sa date', colonnes);
    ok(/create unique index if not exists \w+ on formulaire_heures_pleines \(center_id, visite, jour, heure, activite, formule\);/.test(sql), 'la table refuse deux fois la meme heure pour une visite (index unique)');
    ok(/jour date not null/.test(sql) && sql.includes("check (heure ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')") && /joueurs is null or joueurs between 1 and 500/.test(sql) && /activite <> 'formule' or formule <> ''/.test(sql),
      'la base refuse elle aussi une heure qui n en est pas une, un groupe hors bornes et une formule sans nom');
    ok(/references centers\(id\)/.test(sql) && !/\b(email|mail|phone|telephone|name|nom|ip|adresse|user_agent|message|note)\b/i.test(sansCommentaires), 'la table appartient a un centre et ne prevoit aucune colonne personnelle ni texte libre');
    const registre = lf('scripts/run-db-migrations.js');
    ok(/id: '0061_formulaire_heures_pleines',\n\s*file: 'database\/formulaire-heures-pleines-schema\.sql'/.test(registre) && fs.existsSync(path.join(ROOT, 'database/rollbacks/0061_formulaire_heures_pleines.down.sql'))
      && /drop table if exists formulaire_heures_pleines;/.test(lf('database/rollbacks/0061_formulaire_heures_pleines.down.sql')), 'la migration 0061 est au registre, avec son retour en arriere');
    ok(/'formulaire_heures_pleines'/.test(lf('database/rls-tenant-isolation.sql')), 'la table est dans la liste des donnees de centre a cloisonner');
    const route = lf('api/public-booking-meta.js');
    ok(/if \(body\?\.kind === 'heures-pleines' && url\.pathname\.endsWith\('\/public-booking-meta'\)\) \{\n\s*await handleHeuresPleines\(req, res, body\);/.test(route), 'la route publique aiguille « heures-pleines » vers son traitement');
    // Aucune regle du planning ne lit ces statistiques : c est le navigateur qui les declare.
    const lecteurs = ['lib', 'api'].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`)).filter((f) => /formulaire_heures_pleines|formulaire-heures/.test(lf(f))).sort().join(',');
    ok(lecteurs === 'api/public-booking-meta.js,lib/donnees-api.js,lib/formulaire-heures.js', 'seules la route qui ecrit et la lecture de la page Donnees touchent a ces statistiques : aucune regle du planning n en depend', lecteurs);
  }

  section('[D] LA LECTURE');
  ok(vrai.unCentre, 'la lecture porte toujours sur un seul centre et sur la periode demandee');
  ok(vrai.jourVoulu, 'la lecture regroupe par jour de la semaine VOULU, heure, activite et formule, et compte sur combien de dates');
  ok(vrai.propre && vrai.ordre, 'le classement est refait ici, la plus demandee d abord ; un jour 9, une heure 25:00 et un nombre negatif sont ignores');
  ok(vrai.noms, 'chaque ligne dit en mots ce que la personne voulait, avec les noms du catalogue ; une activite retiree garde son identifiant');
  ok(vrai.dates && vrai.groupe && vrai.sansLigne, 'le nombre de dates ne depasse jamais les demandes ; un groupe moyen inconnu reste vide ; sans ligne, une liste vide');
  {
    purger();
    const { lireDonnees, classeurDonnees } = require(path.join(ROOT, 'lib/donnees-api.js'));
    const nomBowling = (require(path.join(ROOT, 'lib/activity-catalog.js')).listCenterActivities('libramont').find((a) => a.id === 'bowling') || {}).name || '';
    const requetes = [];
    const pool = (absente) => ({ query: async (sql, valeurs) => {
      requetes.push({ sql, valeurs });
      if (/from formulaire_heures_pleines/.test(sql)) { if (absente) { const e = new Error('absente'); e.code = '42P01'; throw e; } return { rows: LIGNES }; }
      return { rows: [] };
    } });
    const d = await lireDonnees(pool(false), { centerId: 'libramont', startDate: '2026-11-01', endDate: '2026-11-30', maintenant: new Date('2026-11-30T12:00:00Z') });
    const lue = requetes.find((q) => /from formulaire_heures_pleines/.test(q.sql));
    ok(Array.isArray(d.heuresPleines) && d.heuresPleines.length === 5 && d.heuresPleines[0].demandes === 40 && d.heuresPleines[0].jour === 'samedi' && Boolean(nomBowling) && d.heuresPleines[0].quoi === nomBowling
      && Boolean(lue) && JSON.stringify(lue.valeurs) === JSON.stringify(['libramont', '2026-11-01', '2026-11-30']),
    'les donnees du centre portent les heures completes voulues, lues sur le centre et la periode demandes, nommees par son catalogue', JSON.stringify(d.heuresPleines && d.heuresPleines[0]));
    ok(Array.isArray(d.formulaire) && d.formulaire.length === 2 && typeof d.totaux === 'object', 'le reste des donnees (entonnoir du formulaire, totaux) est toujours la');
    const sans = await lireDonnees(pool(true), { centerId: 'libramont', startDate: '2026-11-01', endDate: '2026-11-30', maintenant: new Date('2026-11-30T12:00:00Z') });
    ok(sans.ok === true && Array.isArray(sans.heuresPleines) && sans.heuresPleines.length === 0, 'une table pas encore creee : les donnees se lisent quand meme, la liste est vide');
    const classeur = classeurDonnees(d, { centerId: 'libramont', maintenant: new Date('2026-11-30T12:00:00Z') });
    ok(Buffer.isBuffer(classeur) && classeur.length > 2000 && /feuille\('Heures complètes voulues'/.test(lf('lib/donnees-api.js')), 'l Excel se fabrique avec sa feuille « Heures complètes voulues »', `${classeur && classeur.length} octets`);

    // La console ecrit ce que le serveur a compte : la fonction reelle, sortie du fichier.
    const consoleJs = lf('assets/admin-console.js');
    const source = /function dirDonHeuresPleinesHtml\(heures\) \{\n[\s\S]*?\n\}\n/.exec(consoleJs);
    const bac = { tables: [] };
    vm.createContext(bac);
    vm.runInContext(`
      const escapeHtml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const dirDonNum = (n) => String(n);
      function dirDonTable(titre, colonnes, lignes, vide, options) { tables.push({ titre, colonnes, lignes, vide, options }); return ''; }
      ${source ? source[0] : ''}
    `, bac);
    ok(Boolean(source) && typeof bac.dirDonHeuresPleinesHtml === 'function', 'la console a sa fonction d affichage');
    if (source) {
      const classe = regle.heuresDemandees(LIGNES, NOMS);
      bac.dirDonHeuresPleinesHtml(JSON.parse(JSON.stringify(classe)));
      const [t] = bac.tables;
      ok(bac.tables.length === 1 && t.titre === 'Heures complètes que les gens voulaient' && t.colonnes.length === 5 && t.colonnes[0].t === 'Quand' && t.lignes.length === 5
        && t.lignes[0].join('|') === 'samedi 15:00|Bowling|40|3|6' && t.lignes[2].join('|') === 'dimanche 16:30|Laser game|12|2|',
      'une ligne par jour, heure et activite (« samedi 15:00 » d un trait), avec les nombres du serveur ; un groupe moyen inconnu reste vide', JSON.stringify(t && t.lignes));
      ok(/^67 fois sur cette période, quelqu’un a touché une heure marquée « complet » dans le formulaire\. La plus voulue : samedi 15:00, Bowling \(40\)\. C’est un minimum/.test(t.options.note), 'la note dit le total, l heure la plus voulue, et que c est un minimum', t.options.note);
      bac.tables.length = 0;
      bac.dirDonHeuresPleinesHtml(Array.from({ length: 30 }, (_, k) => ({ jour: 'samedi', heure: '15:00', quoi: `Activité ${k}`, demandes: 30 - k, dates: 1, joueursMoyens: null })));
      ok(bac.tables[0].lignes.length === 20, 'le tableau montre vingt lignes au plus (l Excel donne tout)', `${bac.tables[0].lignes.length} lignes`);
      bac.tables.length = 0;
      bac.dirDonHeuresPleinesHtml([]);
      ok(bac.tables.length === 1 && bac.tables[0].lignes.length === 0 && bac.tables[0].options.note === '' && bac.tables[0].vide === 'Personne n’a touché une heure complète sur cette période.', 'sans aucune heure touchee, le tableau le dit au lieu d afficher du vide');
      bac.tables.length = 0;
      bac.dirDonHeuresPleinesHtml([{ jour: 'samedi', heure: '15:00', quoi: '<img src=x onerror=alert(1)>', demandes: 1, dates: 1, joueursMoyens: 2 }]);
      ok(bac.tables[0].lignes[0][1] === '&lt;img src=x onerror=alert(1)>', 'un nom d activite ne s ecrit jamais comme du HTML', bac.tables[0].lignes[0][1]);
    }
    ok(/heuresPleines: liste\(d\.heuresPleines\)\.map\(/.test(consoleJs) && /\$\{dirDonHeuresPleinesHtml\(data\.heuresPleines\)\}/.test(consoleJs), 'une reponse sans ces heures (ancien serveur) ne casse pas la page, et la page affiche le tableau');
  }

  section('[E] CONTRE-EPREUVES (sur une copie de la regle, le depot n est jamais modifie)');
  const original = fs.readFileSync(REGLE, 'utf8').replace(/\r\n/g, '\n');
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'formulaire-heures-'));
  let copies = 0;
  const casser = async (de, vers) => {
    const n = original.split(de).length - 1;
    if (n !== 1) return { erreur: `ancre trouvee ${n} fois` };
    copies += 1;
    // .cjs : un package.json « type module » pose dans le dossier temporaire n y change rien.
    const fichier = path.join(dossier, `regle-${copies}.cjs`);
    fs.writeFileSync(fichier, original.split(de).join(vers));
    return controlesDeLaRegle(require(fichier));
  };
  try {
    const cas = [
      ['sans le catalogue du centre, une activite inventee entre', '    if (activite !== QUOI_ARRIVEE && activite !== QUOI_FORMULE && !connues.has(activite)) continue;\n', '', 'catalogue'],
      ['sans la liste des formules du centre, une formule inventee entre', '    if (formule && !offertes.has(formule)) continue;\n', '', 'formuleConnue'],
      ['si « formule » passait sans dire laquelle, la ligne ne voudrait rien dire', '    if (activite === QUOI_FORMULE && !formule) continue;\n', '', 'formuleSansId'],
      ['sans reconstruire la date, le 31 fevrier entre', ' || d.toISOString().slice(0, 10) !== jour', '', 'dateVraie'],
      ['sans la fenetre, un jour d il y a un an ou dans deux ans entre', '  return ecart >= -1 && ecart <= HORIZON_JOURS;\n', '  return true;\n', 'fenetre'],
      ['sans le controle de l heure, « 25:00 » entre', '    if (!jourValide(jour, aujourdHui) || !HEURE.test(heure)) continue;\n', '    if (!jourValide(jour, aujourdHui)) continue;\n', 'heure'],
      ['sans le tri des redites, la meme heure compte deux fois', '    if (vues.has(cle)) continue;\n', '', 'uneFois'],
      ['sans le plafond, un envoi garde plus de huit heures', 'body.heures.slice(0, MAX_HEURES_PAR_ENVOI)', 'body.heures', 'huit'],
      ['sans les bornes du groupe, « 5000 joueurs » entre', 'joueurs: Number.isInteger(n) && n >= 1 && n <= 500 ? n : null', 'joueurs: n', 'joueurs'],
      ['sans le controle de la visite, une visite mal formee passe', " || !/^[a-z0-9]{16,40}$/i.test(visite)", '', 'refus'],
      ['sans « on conflict do nothing », un doublon ferait echouer tout l envoi', ' on conflict do nothing`', '`', 'doublon'],
      ['sans le centre dans la lecture, un centre lirait les heures des autres', 'where center_id = $1 and created_at', 'where created_at', 'unCentre'],
      ['avec le jour du toucher au lieu du jour voulu, « samedi 15 h » deviendrait « mardi 15 h »', 'select extract(isodow from jour)::int as jour_semaine', 'select extract(isodow from created_at)::int as jour_semaine', 'jourVoulu'],
      ['si un jour de semaine inconnu etait garde, une ligne sans jour s afficherait', ' || js < 1 || js > 7', '', 'propre'],
      ['sans refaire le classement, l ordre serait celui de la base', '  out.sort((a, b) => b.demandes - a.demandes || a.jourSemaine - b.jourSemaine || a.heure.localeCompare(b.heure) || a.quoi.localeCompare(b.quoi));\n', '', 'ordre'],
      ['si « Formule » se redisait ou manquait, le nom serait faux', "/^formule\\b/i.test(nom) ? nom : `Formule ${nom}`", 'nom', 'noms'],
      ['si les dates depassaient les demandes, « 2 demandes sur 5 dates » s afficherait', 'Math.min(dates, n)', 'dates', 'dates'],
    ];
    for (const [phrase, de, vers, cle] of cas) {
      const r = await casser(de, vers);
      ok(r && !r.erreur && r[cle] === false, `${phrase} : ce gate ROUGIRAIT`, r && r.erreur ? r.erreur : `${cle} = ${r && r[cle]}`);
    }
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
  ok(fs.readFileSync(REGLE, 'utf8').replace(/\r\n/g, '\n') === original, 'la regle du depot n a pas ete touchee');

  console.log(`\n${echecs === 0 ? 'formulaire-heures-check: ALL OK' : `formulaire-heures-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
