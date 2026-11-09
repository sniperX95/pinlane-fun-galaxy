// LES COORDONNEES DU CENTRE (2026-11-09). Adresse, telephone et parking se
// lisent dans les mails, sur le formulaire et chez l assistant ; la page
// Etablissement les corrige maintenant. Ce gate tient la chaine serveur, sans
// base et sans reseau :
//   - ce qui entre est nettoye (pas de balise, pas de saut de ligne, une
//     longueur bornee), un telephone qui n en est pas un est refuse avec sa
//     raison quand le gerant enregistre (strict), ignore ailleurs ;
//   - une case videe efface la valeur du fichier socle, une case absente la
//     garde ;
//   - le mail du centre ne se change pas par la : il route le courrier entrant
//     et le domaine d envoi ;
//   - la page recoit les coordonnees et le mail (projection de la session).
// Contre-preuves : chaque regle est retiree d une copie du source chargee en
// memoire (rien ne s ecrit sur le disque), et le gate doit rougir.
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');

function charger(fichier, mutation) {
  const chemin = path.join(ROOT, fichier);
  let source = fs.readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n');
  if (mutation) {
    const [de, vers] = mutation;
    const n = source.split(de).length - 1;
    if (n !== 1) throw new Error(`ancre de mutation ${n} fois dans ${fichier} : ${de.slice(0, 60)}`);
    source = source.replace(de, vers);
  }
  const copie = new Module(chemin, module);
  copie.filename = chemin;
  copie.paths = Module._nodeModulePaths(path.dirname(chemin));
  copie._compile(source, chemin);
  return copie.exports;
}

function fauxPool(config) {
  const pool = { ecrit: null };
  pool.query = async (sql, params) => {
    if (/select settings from centers/.test(sql)) return { rowCount: 1, rows: [{ settings: { config } }] };
    if (/select status from centers/.test(sql)) return { rowCount: 1, rows: [{ status: 'active' }] };
    if (/update centers/.test(sql)) { pool.ecrit = JSON.parse(params[1]); return { rowCount: 1 }; }
    return { rowCount: 0, rows: [] };
  };
  return pool;
}

async function epreuves(cc, scope, quiet) {
  const rouges = [];
  const ok = (vrai, id, detail) => {
    if (!quiet) console.log(`${vrai ? 'ok  ' : 'FAIL'}  ${id}${vrai || detail === undefined ? '' : `  [${typeof detail === 'string' ? detail : JSON.stringify(detail)}]`}`);
    if (!vrai) rouges.push(id);
  };
  const refuse = (fn) => { try { fn(); return null; } catch (error) { return error; } };

  const propre = cc.normalizePublicInfo({ address: '  Rue <b>Neuve</b>\n 1,  6800 Libramont ', phone: ' 061/22.33.44 ', parking: 'Gratuit', email: 'pirate@exemple.be', city: 'Ailleurs' });
  ok(propre.address === 'Rue b Neuve /b 1, 6800 Libramont' && !/[<>\n]/.test(propre.address), 'nettoie-balises-et-lignes', propre);
  ok(propre.phone === '061/22.33.44' && propre.parking === 'Gratuit', 'garde-telephone-et-parking', propre);
  ok(!('email' in propre) && !('city' in propre), 'le-mail-ne-se-change-pas-ici', propre);
  ok(cc.normalizePublicInfo({ parking: '' }).parking === '', 'case-videe-gardee-pour-effacer');

  const telephone = refuse(() => cc.normalizePublicInfo({ phone: '0491 abc' }, { strict: true }));
  ok(Boolean(telephone && telephone.expose === true && /Téléphone/.test(telephone.message)), 'telephone-faux-refuse-avec-sa-raison', telephone && telephone.message);
  ok(!('phone' in cc.normalizePublicInfo({ phone: '0491 abc' })), 'telephone-faux-ignore-hors-enregistrement');
  const longue = refuse(() => cc.normalizePublicInfo({ address: 'x'.repeat(201) }, { strict: true }));
  ok(Boolean(longue && longue.expose === true && /Adresse/.test(longue.message)), 'adresse-trop-longue-refusee', longue && longue.message);

  const fusion = cc.normalizeCenterConfig({ publicInfo: { address: 'Rue Neuve 1, 6800 Libramont' } }, 'libramont').publicInfo || {};
  ok(fusion.address === 'Rue Neuve 1, 6800 Libramont' && fusion.phone === '0491/30.16.67' && fusion.parking === 'gratuit', 'nouvelle-adresse-le-reste-du-socle', fusion);
  ok((cc.normalizeCenterConfig({ publicInfo: { parking: '' } }, 'libramont').publicInfo || {}).parking === '', 'parking-efface');

  const pool = fauxPool({});
  await cc.saveCenterConfigOverride(pool, 'libramont', { publicInfo: { address: 'Rue Neuve 1, 6800 Libramont', phone: '061 22 33 44', parking: '' } });
  const ecrit = (pool.ecrit && pool.ecrit.publicInfo) || null;
  ok(Boolean(ecrit) && ecrit.address === 'Rue Neuve 1, 6800 Libramont' && ecrit.phone === '061 22 33 44' && ecrit.parking === '', 'enregistrer-ecrit-les-coordonnees', ecrit);
  const poolFaux = fauxPool({});
  let refusEnregistrement = null;
  try { await cc.saveCenterConfigOverride(poolFaux, 'libramont', { publicInfo: { phone: 'appelez-nous' } }); } catch (error) { refusEnregistrement = error; }
  ok(Boolean(refusEnregistrement && refusEnregistrement.expose === true) && poolFaux.ecrit === null, 'enregistrer-un-faux-telephone-ne-touche-a-rien', refusEnregistrement && refusEnregistrement.message);

  // Ce que les mails et l assistant lisent : le centre du fichier, recouvert de ce qui est enregistre.
  const socle = JSON.parse(JSON.stringify(require(path.join(ROOT, 'ops-knowledge', 'centers.json')).centers.find((c) => c.id === 'libramont')));
  const lu = cc.mergeCenterConfig(socle, cc.normalizeCenterConfig({ publicInfo: { address: 'Rue Neuve 1, 6800 Libramont' } }, 'libramont')).publicInfo || {};
  ok(lu.address === 'Rue Neuve 1, 6800 Libramont' && lu.email === 'libramont@fungalaxy.be', 'les-mails-lisent-la-nouvelle-adresse-et-gardent-le-mail', lu);

  const projete = scope.projectCenterRow({ id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', timezone: 'Europe/Brussels', settings: { config: { publicInfo: { address: 'Rue Neuve 1, 6800 Libramont', email: 'pirate@exemple.be' } } }, client_id: 'fungalaxy', client_name: 'Fun Galaxy' });
  ok(projete.publicInfo && projete.publicInfo.address === 'Rue Neuve 1, 6800 Libramont', 'la-page-recoit-les-coordonnees', projete.publicInfo);
  ok(projete.publicEmail === 'libramont@fungalaxy.be', 'la-page-recoit-le-mail-du-fichier', projete.publicEmail);
  return rouges;
}

const MUTATIONS = [
  { nom: 'les coordonnees ne passent plus la normalisation', fichier: 'lib/center-config.js', de: '    publicInfo: normalizePublicInfo(merged.publicInfo, { strict }),\n', vers: '', attendu: 'nouvelle-adresse-le-reste-du-socle' },
  { nom: 'le telephone n est plus controle', fichier: 'lib/center-config.js', de: "    if (cle === 'phone' && !TELEPHONE_PUBLIC.test(texte)) {", vers: '    if (false) {', attendu: 'telephone-faux-refuse-avec-sa-raison' },
  { nom: 'les balises passent', fichier: 'lib/center-config.js', de: ".replace(/[\\u0000-\\u001f<>]+/g, ' ')", vers: '', attendu: 'nettoie-balises-et-lignes' },
  { nom: 'la page ne recoit plus les coordonnees', fichier: 'lib/center-scope.js', de: '    publicInfo: config.publicInfo || {},\n    publicEmail: publicEmailDuFichier(row.id),\n', vers: '', attendu: 'la-page-recoit-les-coordonnees' },
];

(async () => {
  const cc = charger('lib/center-config.js');
  const scope = charger('lib/center-scope.js');
  console.log('--- passe nominale ---');
  const base = await epreuves(cc, scope, false);
  if (base.length) {
    console.error(`coordonnees-centre-check: ROUGE (${base.join(', ')})`);
    process.exit(1);
  }
  for (const m of MUTATIONS) {
    const muteCc = m.fichier === 'lib/center-config.js' ? charger(m.fichier, [m.de, m.vers]) : cc;
    const muteScope = m.fichier === 'lib/center-scope.js' ? charger(m.fichier, [m.de, m.vers]) : scope;
    let rouges;
    try {
      rouges = await epreuves(muteCc, muteScope, true);
    } catch (error) {
      rouges = [`exception:${error.message}`];
    }
    if (!rouges.includes(m.attendu)) {
      console.error(`coordonnees-centre-check: la contre-preuve « ${m.nom} » devait rougir ${m.attendu} ; rouges : ${rouges.join(', ') || 'aucun'}`);
      process.exit(1);
    }
    console.log(`contre-preuve « ${m.nom} » : ${m.attendu} ROUGE, comme attendu`);
  }
  console.log('coordonnees-centre-check: ALL OK (nettoyage, telephone refuse avec sa raison, case videe qui efface, mail du fichier intouchable, page servie ; 4 contre-preuves en memoire)');
})().catch((error) => { console.error('coordonnees-centre-check: exception', error && (error.stack || error)); process.exit(1); });
