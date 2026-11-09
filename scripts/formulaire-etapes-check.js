#!/usr/bin/env node
'use strict';
// =============================================================================
// OU LES GENS S ARRETENT DANS LE FORMULAIRE (2026-11-09)
// -----------------------------------------------------------------------------
// Ansar : « sur le formulaire voir ou les gens s arretent ». Le formulaire
// public envoie chaque ecran atteint (POST /api/public-booking-meta
// { kind: 'etapes' }), la console lit ou chaque visite s est arretee.
//   [A] ce qui entre : les ecrans connus de leur parcours, une fois chacun,
//       douze au plus ; un centre ou une visite mal formes refusent tout ;
//       rien de personnel ne peut entrer ;
//   [B] l ecriture : une requete parametree, un doublon refuse par la base,
//       sans base rien ne s ecrit, une base en panne ou une table pas encore
//       creee ne cassent jamais le formulaire, une adresse est freinee ;
//   [C] une seule liste des ecrans : la regle (lib/formulaire-etapes.js), le
//       formulaire et la table disent la meme chose ; la migration 0060 est
//       au registre avec son retour ; aucune colonne personnelle, aucun
//       cookie ; le formulaire appelle bien le compteur a chaque ecran ;
//   [D] la lecture : toujours un seul centre, l ecran le plus loin par
//       visite, un entonnoir qui se recompose ; une table absente donne un
//       tableau vide ; la console ecrit ce que le serveur a compte ;
//   [E] contre-epreuves : chaque regle retiree, ce gate ROUGIT. Elles jouent
//       sur une COPIE de la regle dans le dossier temporaire : aucun fichier
//       du depot n est modifie, un autre gate ne lit jamais une regle cassee.
// AUCUNE BASE : un faux pool garde les requetes. Le parcours reel dans un
// navigateur (chaque ecran part une fois, dans l ordre) est tenu par
// test:fungalaxy-form [E] et sa contre-preuve FG_QA_CASSE=etapes.
// =============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
const ROOT = path.join(__dirname, '..');
const REGLE = path.join(ROOT, 'lib', 'formulaire-etapes.js');

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

// La route, avec un faux pool : il garde chaque requete. `erreur` : le code que la base rend.
function charger({ erreur = '', sansBase = false } = {}) {
  purger();
  const database = require(path.join(ROOT, 'lib/database.js'));
  const requetes = [];
  database.getPool = () => (sansBase ? null : {
    query: async (sql, valeurs) => {
      requetes.push({ sql, valeurs });
      if (erreur) { const e = new Error('panne'); e.code = erreur; throw e; }
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
const ecran = (etape, parcours = 'reservation', extra = {}) => ({ parcours, etape, ...extra });
const envoi = (etapes, extra = {}) => ({ kind: 'etapes', centerId: 'libramont', visite: VISITE, etapes, ...extra });

// Ce que la base rendrait pour 100 visites : 50 parties au premier ecran, 30 aux horaires,
// 20 allees au bout. Plus une ligne hors liste (rang 9) et une autre d un nombre negatif.
const LIGNES = [
  { parcours: 'reservation', loin: 1, visites: 50 }, { parcours: 'reservation', loin: 3, visites: 30 }, { parcours: 'reservation', loin: 6, visites: 20 },
  { parcours: 'reservation', loin: 9, visites: 5 }, { parcours: 'reservation', loin: 2, visites: -4 },
  { parcours: 'sur-mesure', loin: 2, visites: 3 }, { parcours: 'sur-mesure', loin: 6, visites: 1 },
];

// Les controles de la regle, joues sur la vraie regle puis sur chaque copie cassee.
function controlesDeLaRegle(regle) {
  const r = {};
  const recu = regle.etapesRecues(envoi([ecran('date'), ecran('date'), ecran('inconnu'), ecran('date', 'sur-mesure'), ecran('fin', 'ailleurs'), ecran('sm-groupe', 'sur-mesure', { email: 'a@exemple.be', nom: 'Dupont', telephone: '0470' })]));
  r.connus = Boolean(recu) && recu.lignes.map((l) => `${l.parcours}:${l.etape}`).join(' ') === 'reservation:date sur-mesure:sm-groupe';
  r.rienDAutre = Boolean(recu) && recu.lignes.every((l) => Object.keys(l).sort().join(',') === 'etape,parcours') && Object.keys(recu).sort().join(',') === 'centerId,lignes,visite';
  // Douze ecrans existent : un envoi n est lu que sur ses douze premieres lignes, la treizieme
  // (ici un ecran pourtant valable) n est jamais regardee.
  const tous = regle.PARCOURS_FORMULAIRE.flatMap((p) => p.etapes.map((e) => ecran(e.etape, p.parcours)));
  const plein = regle.etapesRecues(envoi(tous));
  const treize = regle.etapesRecues(envoi([...Array.from({ length: 12 }, () => ecran('date')), ecran('activites')]));
  r.douze = tous.length === 12 && Boolean(plein) && plein.lignes.length === 12 && Boolean(treize) && treize.lignes.map((l) => l.etape).join(',') === 'date';
  r.refus = [
    envoi([ecran('date')], { centerId: 'LIBRAMONT; drop' }), envoi([ecran('date')], { visite: 'court' }), envoi('date'), envoi([ecran('inconnu')]), envoi([]),
  ].every((b) => regle.etapesRecues(b) === null);
  const requetes = [];
  const pool = { query: async (sql, valeurs) => { requetes.push({ sql, valeurs }); return { rows: [] }; } };
  return regle.ecrireEtapes(pool, { centerId: 'libramont', visite: VISITE, lignes: [ecran('date'), ecran('activites')] }).then(() => {
    const q = requetes[0] || { sql: '', valeurs: [] };
    r.parametree = requetes.length === 1 && /^insert into formulaire_etapes \(center_id, visite, parcours, etape\) values \(\$1, \$2, \$3, \$4\), \(\$5, \$6, \$7, \$8\)/.test(q.sql)
      && !q.sql.includes(VISITE) && !q.sql.includes('libramont') && q.valeurs.join(',') === `libramont,${VISITE},reservation,date,libramont,${VISITE},reservation,activites`;
    r.doublon = / on conflict do nothing$/.test(q.sql);
    const lecture = regle.requeteLecture({ centerId: 'gembloux', debut: '2026-11-01', fin: '2026-11-30' });
    r.unCentre = /where center_id = \$1 and created_at >= \$2::date and created_at < \(\$3::date \+ 1\)/.test(lecture.sql) && lecture.params[0] === 'gembloux' && lecture.params[1] === '2026-11-01' && lecture.params[2] === '2026-11-30';
    r.ordreEnParametre = JSON.stringify(lecture.params[3]) === JSON.stringify(regle.PARCOURS_FORMULAIRE[0].etapes.map((e) => e.etape))
      && JSON.stringify(lecture.params[4]) === JSON.stringify(regle.PARCOURS_FORMULAIRE[1].etapes.map((e) => e.etape))
      && /max\(array_position\(case when parcours = 'sur-mesure' then \$5::text\[\] else \$4::text\[\] end, etape\)\)/.test(lecture.sql) && /group by parcours, visite/.test(lecture.sql);
    const [resa, sm] = regle.entonnoirFormulaire(LIGNES);
    r.arrives = resa.etapes.map((e) => e.arrives).join(',') === '100,50,50,20,20,20' && resa.visites === 100 && resa.abouties === 20;
    r.arretes = resa.etapes.map((e) => e.arretes).join(',') === '50,0,30,0,0,0';
    r.dernier = resa.etapes.map((e) => (e.dernier ? 1 : 0)).join('') === '000001' && resa.etapes[5].arretes === 0;
    r.recompose = resa.visites === 100 && resa.etapes.reduce((a, e) => a + e.arretes, 0) + resa.abouties === resa.visites && sm.etapes.reduce((a, e) => a + e.arretes, 0) + sm.abouties === sm.visites && sm.visites === 4;
    r.parts = resa.etapes.map((e) => e.partDuDepart).join(',') === '100,50,50,20,20,20' && sm.etapes[2].partDuDepart === 25;
    const vide = regle.entonnoirFormulaire([]);
    r.vide = vide.length === 2 && vide.every((p) => p.visites === 0 && p.abouties === 0 && p.etapes.every((e) => e.arrives === 0 && e.arretes === 0 && e.partDuDepart === 0));
    return r;
  });
}

async function main() {
  const regle = require(REGLE);
  const vrai = await controlesDeLaRegle(regle);

  section('[A] CE QUI ENTRE, ET RIEN D AUTRE');
  ok(vrai.connus, 'un ecran inconnu, un ecran d un autre parcours et un ecran redit sont jetes ; les autres passent dans l ordre');
  ok(vrai.rienDAutre, 'seuls le parcours et l ecran sont gardes (ni nom, ni mail, ni telephone)');
  ok(vrai.douze, 'douze ecrans existent, un envoi n en garde jamais plus');
  ok(vrai.refus, 'un centre ou une visite mal formes, une liste absente ou sans ecran connu : tout l envoi est refuse');
  {
    const { api } = charger();
    const r = await poster(api, envoi([ecran('date')], { centerId: 'inexistant' }));
    ok(r.status === 404, 'un centre que la plateforme ne connait pas : 404', JSON.stringify(r));
    const mal = await poster(api, envoi([ecran('inconnu')]));
    ok(mal.status === 400, 'un envoi sans aucun ecran connu : 400', JSON.stringify(mal));
  }

  section('[B] L ECRITURE');
  ok(vrai.parametree, 'une seule requete, parametree : rien du client dans le texte SQL');
  ok(vrai.doublon, 'un ecran deja compte pour cette visite ne s ecrit pas deux fois (on conflict do nothing)');
  {
    const bon = charger();
    const r = await poster(bon.api, envoi([ecran('date'), ecran('activites')]));
    const insert = bon.requetes.find((q) => /insert into formulaire_etapes/i.test(q.sql));
    ok(r.status === 202 && r.json && r.json.ok === true && Boolean(insert) && insert.valeurs.length === 8 && bon.requetes.length === 1, 'la route ecrit les deux ecrans en une requete (202)', JSON.stringify(r));
    ok(bon.requetes.every((q) => !/pilot_leads|custom_requests|upsell_events|reservations/i.test(q.sql)), 'un envoi « etapes » ne touche ni les prospects, ni les demandes, ni les reservations');
    const sansBase = charger({ sansBase: true });
    const r2 = await poster(sansBase.api, envoi([ecran('date')]));
    ok(r2.status === 202 && r2.json && r2.json.ok === true && !sansBase.requetes.length, 'sans base : rien ne s ecrit (202)', JSON.stringify(r2));
    // La trace d une panne reste dans les journaux, une table pas encore creee se tait.
    const traces = [];
    const erreurOrigine = console.error;
    console.error = (...a) => { traces.push(a.join(' ')); };
    let r3 = null; let r4 = null;
    try {
      r3 = await poster(charger({ erreur: '57P01' }).api, envoi([ecran('date')]));
      const apresPanne = traces.length;
      r4 = await poster(charger({ erreur: '42P01' }).api, envoi([ecran('date')]));
      ok(r3.status === 202 && r3.json && r3.json.ok === true && apresPanne === 1, 'une base en panne ne casse pas le formulaire (202), et la trace reste dans les journaux', `${r3.status}, ${apresPanne} trace(s)`);
      ok(r4.status === 202 && r4.json && r4.json.ok === true && traces.length === apresPanne, 'tant que la table n existe pas (42P01), l envoi est ignore sans bruit (202)', `${r4.status}, ${traces.length - apresPanne} trace(s) de plus`);
    } finally { console.error = erreurOrigine; }
    ok(JSON.stringify(r.json) === JSON.stringify(r3.json) && JSON.stringify(r.json) === JSON.stringify(r4.json), 'la reponse est la meme, que la ligne soit ecrite ou non', JSON.stringify([r.json, r3.json, r4.json]));
    const frein = charger();
    let dernier = null;
    for (let k = 0; k < 125; k += 1) dernier = await poster(frein.api, envoi([ecran('date')]), '198.51.100.9');
    ok(dernier && dernier.status === 429 && frein.requetes.length === 120, 'au-dela de 120 envois en 10 minutes, une adresse est freinee (429)', `${dernier && dernier.status}, ${frein.requetes.length} ecritures`);
  }

  section('[C] UNE SEULE LISTE DES ECRANS');
  {
    const formulaire = lf('assets/fungalaxy-booking.js');
    const tableau = (nom) => { const m = new RegExp(`var ${nom} = \\[([^\\]]*)\\];`).exec(formulaire); return m ? m[1].split(',').map((x) => x.trim().replace(/'/g, '')).join(',') : ''; };
    const ordre = (i) => regle.PARCOURS_FORMULAIRE[i].etapes.map((e) => e.etape).join(',');
    ok(tableau('SCENES') !== '' && tableau('SCENES') === ordre(0), 'le formulaire et la regle nomment les memes ecrans de reservation, dans le meme ordre', `${tableau('SCENES')} / ${ordre(0)}`);
    ok(tableau('SCENES_SM') !== '' && tableau('SCENES_SM') === ordre(1), 'le formulaire et la regle nomment les memes ecrans de la demande sur mesure, dans le meme ordre', `${tableau('SCENES_SM')} / ${ordre(1)}`);
    const sql = lf('database/formulaire-etapes-schema.sql');
    const contrainte = (parcours) => { const m = new RegExp(`parcours = '${parcours}' and etape in \\(([^)]*)\\)`).exec(sql); return m ? m[1].split(',').map((x) => x.trim().replace(/'/g, '')).join(',') : ''; };
    ok(contrainte('reservation') === ordre(0) && contrainte('sur-mesure') === ordre(1), 'la contrainte de la table accepte exactement ces ecrans, par parcours', `${contrainte('reservation')} | ${contrainte('sur-mesure')}`);
    ok(/create unique index if not exists \w+ on formulaire_etapes \(center_id, visite, parcours, etape\);/.test(sql), 'la table refuse deux fois le meme ecran pour une visite (index unique)');
    const sansCommentaires = sql.replace(/--.*$/gm, '');
    ok(/references centers\(id\)/.test(sql) && !/\b(email|mail|phone|telephone|name|nom|ip|adresse|user_agent)\b/i.test(sansCommentaires), 'la table appartient a un centre et ne prevoit aucune colonne personnelle');
    const registre = lf('scripts/run-db-migrations.js');
    ok(/id: '0060_formulaire_etapes',\n\s*file: 'database\/formulaire-etapes-schema\.sql'/.test(registre) && fs.existsSync(path.join(ROOT, 'database/rollbacks/0060_formulaire_etapes.down.sql')),
      'la migration 0060 est au registre, avec son retour en arriere');
    ok(/'formulaire_etapes'/.test(lf('database/rls-tenant-isolation.sql')), 'la table est dans la liste des donnees de centre a cloisonner');
    ok(!/localStorage|sessionStorage|\.cookie\b|indexedDB/.test(formulaire), 'le formulaire public ne pose ni cookie ni stockage');
    ok(formulaire.split('    suivreEtape(sceneCourante);\n').length === 3 && formulaire.split('    suivreEtape(cible);\n').length === 2
      && /suivreEtape\(sceneCourante\);\n[\s\S]{0,400}?sceneCourante = cible;\n    suivreEtape\(cible\);\n/.test(formulaire),
    'changer d ecran compte l ecran quitte puis l ecran atteint ; le premier toucher compte l ecran ouvert');
    ok(/JSON\.stringify\(\{ kind: 'etapes', centerId: CENTER, visite: VISITE, etapes: etapesFile\.splice\(0, 12\) \}\)/.test(formulaire), 'l envoi ne porte que le centre, la visite au hasard et les ecrans');
    const route = lf('api/public-booking-meta.js');
    ok(/if \(body\?\.kind === 'etapes' && url\.pathname\.endsWith\('\/public-booking-meta'\)\) \{\n\s*await handleEtapes\(req, res, body\);/.test(route), 'la route publique aiguille « etapes » vers son traitement');
  }

  section('[D] LA LECTURE');
  ok(vrai.unCentre, 'la lecture porte toujours sur un seul centre et sur la periode demandee');
  ok(vrai.ordreEnParametre, 'la lecture garde, par visite, l ecran le plus loin ; l ordre des ecrans part de la regle en parametre');
  ok(vrai.arrives && vrai.arretes, 'sur 100 visites (50 parties au premier ecran, 30 aux horaires, 20 au bout) : arrives 100, 50, 50, 20, 20, 20 ; partis 50, 0, 30');
  ok(vrai.dernier, 'le dernier ecran est l arrivee : personne ne s y « arrete »');
  ok(vrai.recompose, 'les partis de chaque ecran plus les arrives au bout redonnent le total des visites ; une ligne hors liste est ignoree');
  ok(vrai.parts && vrai.vide, 'la part du depart suit ; sans visite, un tableau de zeros et aucune division');
  {
    purger();
    const { lireDonnees, classeurDonnees } = require(path.join(ROOT, 'lib/donnees-api.js'));
    const requetes = [];
    const pool = (absente) => ({ query: async (sql, valeurs) => {
      requetes.push({ sql, valeurs });
      if (/from formulaire_etapes/.test(sql)) { if (absente) { const e = new Error('absente'); e.code = '42P01'; throw e; } return { rows: LIGNES }; }
      return { rows: [] };
    } });
    const d = await lireDonnees(pool(false), { centerId: 'libramont', startDate: '2026-11-01', endDate: '2026-11-30', maintenant: new Date('2026-11-30T12:00:00Z') });
    const lue = requetes.find((q) => /from formulaire_etapes/.test(q.sql));
    ok(Array.isArray(d.formulaire) && d.formulaire.length === 2 && d.formulaire[0].visites === 100 && d.formulaire[0].abouties === 20 && Boolean(lue) && lue.valeurs[0] === 'libramont' && lue.valeurs[1] === '2026-11-01' && lue.valeurs[2] === '2026-11-30',
      'les donnees du centre portent l entonnoir du formulaire, lu sur le centre et la periode demandes', JSON.stringify(d.formulaire && d.formulaire[0] && { visites: d.formulaire[0].visites, abouties: d.formulaire[0].abouties }));
    const sans = await lireDonnees(pool(true), { centerId: 'libramont', startDate: '2026-11-01', endDate: '2026-11-30', maintenant: new Date('2026-11-30T12:00:00Z') });
    ok(sans.ok === true && sans.formulaire.every((p) => p.visites === 0), 'une table pas encore creee : les donnees se lisent quand meme, le tableau est vide');
    const classeur = classeurDonnees(d, { centerId: 'libramont', maintenant: new Date('2026-11-30T12:00:00Z') });
    ok(Buffer.isBuffer(classeur) && classeur.length > 2000, 'l Excel se fabrique avec sa feuille « Étapes du formulaire »', `${classeur && classeur.length} octets`);
    ok(/feuille\('Étapes du formulaire'/.test(lf('lib/donnees-api.js')), 'la feuille est declaree dans le classeur');

    // La console ecrit ce que le serveur a compte : la fonction reelle, sortie du fichier.
    const consoleJs = lf('assets/admin-console.js');
    const source = /function dirDonFormulaireHtml\(parcours\) \{\n[\s\S]*?\n\}\n/.exec(consoleJs);
    const bac = { tables: [] };
    vm.createContext(bac);
    vm.runInContext(`
      const escapeHtml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const dirDonNum = (n) => String(n);
      const dirDonPct = (n) => n + ' %';
      function dirDonTable(titre, colonnes, lignes, vide, options) { tables.push({ titre, colonnes, lignes, vide, options }); return ''; }
      ${source ? source[0] : ''}
    `, bac);
    ok(Boolean(source) && typeof bac.dirDonFormulaireHtml === 'function', 'la console a sa fonction d affichage');
    if (source) {
      bac.dirDonFormulaireHtml(JSON.parse(JSON.stringify(d.formulaire)));
      const [t, tsm] = bac.tables;
      ok(bac.tables.length === 2 && t.titre === 'Où les gens s’arrêtent : Réservation' && t.lignes.length === 6 && t.lignes[0].join('|') === 'Date et groupe|100|50|100 %' && t.lignes[2].join('|') === 'Horaires|50|30|50 %' && t.lignes[5].join('|') === 'Réservation envoyée|20||20 %',
        'un tableau par parcours, un ecran par ligne, avec les nombres du serveur ; l arrivee n a pas de « partis »', JSON.stringify(t && t.lignes));
      ok(/^Sur 100 visites, 20 sont allées au bout\. L’écran où l’on part le plus : Date et groupe \(50\)\./.test(t.options.note) && /^Sur 4 visites, 1 est allée au bout\./.test(tsm.options.note), 'la note dit le total, combien vont au bout et l ecran ou l on part le plus', t.options.note);
      bac.tables.length = 0;
      bac.dirDonFormulaireHtml(JSON.parse(JSON.stringify(sans.formulaire)));
      ok(bac.tables.length === 2 && bac.tables.every((x) => x.lignes.length === 0 && x.options.note === '' && x.vide === 'Aucune visite comptée sur cette période.'), 'sans visite, le tableau le dit au lieu d afficher des zeros');
    }
    ok(/formulaire: liste\(d\.formulaire\)\.map\(/.test(consoleJs) && /\$\{dirDonFormulaireHtml\(data\.formulaire\)\}/.test(consoleJs), 'une reponse sans entonnoir (ancien serveur) ne casse pas la page, et la page affiche les tableaux');
  }

  section('[E] CONTRE-EPREUVES (sur une copie de la regle, le depot n est jamais modifie)');
  const original = fs.readFileSync(REGLE, 'utf8').replace(/\r\n/g, '\n');
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'formulaire-etapes-'));
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
      ['sans la liste des ecrans, un ecran inconnu entre', '    if (!ordreDe(parcours).includes(etape)) continue;\n', '', 'connus'],
      ['sans le tri des redites, un ecran redit entre deux fois', '    if (vues.has(cle)) continue;\n', '', 'connus'],
      ['sans le plafond, un envoi garde plus de douze lignes', 'body.etapes.slice(0, MAX_ETAPES_PAR_ENVOI)', 'body.etapes', 'douze'],
      ['sans le controle de la visite, une visite mal formee passe', " || !/^[a-z0-9]{16,40}$/i.test(visite)", '', 'refus'],
      ['sans « on conflict do nothing », un doublon ferait echouer tout l envoi', ' on conflict do nothing`', '`', 'doublon'],
      ['sans le centre dans la lecture, un centre lirait les visites des autres', 'where center_id = $1 and created_at', 'where created_at', 'unCentre'],
      ['avec le premier ecran atteint au lieu du plus loin, tout le monde s arrete au debut', '  select parcours, visite, max(array_position(', '  select parcours, visite, min(array_position(', 'ordreEnParametre'],
      ['sans retirer ceux qui sont partis, chaque ecran affiche le total', '      reste -= ici;\n', '', 'arrives'],
      ['si l arrivee comptait des « partis », ceux qui ont reserve passeraient pour des abandons', 'arretes: dernier ? 0 : ici,', 'arretes: ici,', 'dernier'],
      ['si une ligne hors liste etait comptee, le total ne se recomposerait plus', ' || rang > p.etapes.length', '', 'recompose'],
    ];
    for (const [phrase, de, vers, cle] of cas) {
      const r = await casser(de, vers);
      ok(r && !r.erreur && r[cle] === false, `${phrase} : ce gate ROUGIRAIT`, r && r.erreur ? r.erreur : `${cle} = ${r && r[cle]}`);
    }
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
  ok(fs.readFileSync(REGLE, 'utf8').replace(/\r\n/g, '\n') === original, 'la regle du depot n a pas ete touchee');

  console.log(`\n${echecs === 0 ? 'formulaire-etapes-check: ALL OK' : `formulaire-etapes-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
