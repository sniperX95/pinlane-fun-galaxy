// LES JOURS DEMO DE LA PROD EN FIXTURES (2026-10-20, planning global v3).
//
// Les trois journees fictives DEMO de Fun Galaxy Libramont (dossiers 1579 a
// 1640 : mardi 12/01/2027 calme, mercredi 13/01/2027 normal, samedi
// 16/01/2027 pic) relues en base, au format exact de GET /api/staff-state, et
// le centre au format de GET /api/ops?action=centerConfig. Ecrit dans
// scripts/fixtures/planning-v3/ ; les jours vide, ferme et « pire cas » en
// sont derives par scripts/planning-v3-fixtures.js --deriver.
//
// LECTURE SEULE : session en default_transaction_read_only, transaction
// BEGIN READ ONLY, seulement des select, ROLLBACK a la fin. La connexion vient
// de DATABASE_URL_UNPOOLED dans l environnement, jamais affichee ni ecrite.
// Le catalogue public du centre vient de sa route publique (GET), comme la
// console le lit au demarrage.
//   node scripts/planning-v3-export.js --sonde   (compte et verifie, n ecrit rien)
//   node scripts/planning-v3-export.js           (ecrit les trois fixtures)
'use strict';
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { mapReservation } = require('../lib/database');
const { projectCenterRow } = require('../lib/center-scope');
const { normalizeClassification, normalizeAccueil } = require('../lib/center-config');

const CENTRE = 'libramont';
const IDS = [1579, 1640];
const JOURS = [
  { cle: 'calme', date: '2027-01-12', libelle: 'mardi 12/01/2027, calme' },
  { cle: 'normal', date: '2027-01-13', libelle: 'mercredi 13/01/2027, normal' },
  { cle: 'pic', date: '2027-01-16', libelle: 'samedi 16/01/2027, pic' },
];
const DOSSIER = path.join(__dirname, 'fixtures', 'planning-v3');
const META_URL = `https://app.pinlane.be/api/public-booking-meta?centerId=${CENTRE}`;
const SONDE = process.argv.includes('--sonde');

// Ce qu un dossier DEMO a le droit de porter : aucun contact reel. Une
// coordonnee presente est remplacee par une valeur reservee (exemple.test, un
// numero 0400 fictif) meme si la base en porte deja une fictive ; une absente
// reste absente (la console ne montre pas « Appeler » sans numero).
function anonymiser(r, i) {
  const n = String(i + 1).padStart(2, '0');
  const sortie = { ...r, phone: r.phone ? `+32 400 00 00 ${n}` : '', email: r.email ? `demo${n}@exemple.test` : '' };
  if ('clientKey' in sortie) sortie.clientKey = `demo:${r.id}`;
  if ('acquisition' in sortie) sortie.acquisition = null;
  return sortie;
}

const CONTACT = /(\+?\d[\d .\-/]{7,}\d)|([^\s@]+@[^\s@]+\.[a-z]{2,})/i;

// Une colonne pg `date` arrive en Date a minuit LOCAL (dateColToStr de
// lib/database.js) : lue en local, jamais par toISOString.
function jourDe(v) {
  if (!v) return '';
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v).slice(0, 10);
}
// (en CRLF, comme le reste du depot)
function ecrire(nom, objet) {
  fs.writeFileSync(path.join(DOSSIER, nom), JSON.stringify(objet, null, 2).replace(/\n/g, '\r\n') + '\r\n');
  console.log('ecrit', path.relative(process.cwd(), path.join(DOSSIER, nom)));
}

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error('DATABASE_URL_UNPOOLED absent de l environnement.');
  const client = new Client({ connectionString: url, ssl: true, options: '-c default_transaction_read_only=on' });
  await client.connect();
  try {
    await client.query('begin read only');
    const ro = await client.query('show transaction_read_only');
    if (ro.rows[0].transaction_read_only !== 'on') throw new Error('transaction pas en lecture seule');
    console.log('lecture seule :', ro.rows[0].transaction_read_only);

    const bilan = [];
    const sorties = {};
    for (const jour of JOURS) {
      const tous = await client.query(
        `select * from reservations where date = $1 and center_id = $2 and status <> 'cancelled' order by start_time asc, id asc;`,
        [jour.date, CENTRE],
      );
      const horsDemo = tous.rows.filter((row) => Number(row.id) < IDS[0] || Number(row.id) > IDS[1]);
      const demo = tous.rows.filter((row) => Number(row.id) >= IDS[0] && Number(row.id) <= IDS[1]);
      const dossiers = demo.map(mapReservation);
      const noms = dossiers.map((d) => d.name);
      const domaines = [...new Set(dossiers.map((d) => String(d.email || '').split('@')[1] || '(vide)'))];
      const notesAvecContact = dossiers.filter((d) => CONTACT.test(String(d.notes || ''))).map((d) => d.id);
      bilan.push({
        jour: jour.libelle, dossiers: dossiers.length, horsDemo: horsDemo.length,
        ids: dossiers.length ? `${dossiers[0].id}..${dossiers[dossiers.length - 1].id}` : '',
        pax: dossiers.reduce((s, d) => s + (d.pax || 0), 0), ca: Math.round(dossiers.reduce((s, d) => s + (d.price || 0), 0)),
        domainesEmail: domaines, canaux: [...new Set(dossiers.map((d) => d.channel))],
        statuts: dossiers.reduce((acc, d) => { acc[d.status] = (acc[d.status] || 0) + 1; return acc; }, {}),
        notesAvecContact,
        telephones: dossiers.filter((d) => d.phone).length,
        demoPartout: dossiers.every((d) => /^DÉMO · /.test(d.name) && /^\[DEMO-/.test(String(d.notes || ''))),
      });
      sorties[jour.cle] = { jour, dossiers, noms };
    }
    const lanes = await client.query(
      `select lane_number, status, updated_at, maintenance_from, maintenance_until, maintenance_note from lane_statuses where center_id = $1 order by lane_number asc;`,
      [CENTRE],
    );
    const centreRow = await client.query(
      `select c.id, c.name, c.status, c.timezone, c.settings, nullif(c.client_id, '') as client_id from centers c where c.id = $1;`,
      [CENTRE],
    );
    await client.query('rollback');

    console.log(JSON.stringify(bilan, null, 2));
    if (SONDE) {
      for (const cle of Object.keys(sorties)) console.log(cle, ':', sorties[cle].noms.join(' | '));
      console.log('pistes :', lanes.rows.map((l) => `${l.lane_number}:${l.status}`).join(' '));
      return;
    }

    const centre = projectCenterRow(centreRow.rows[0]);
    // Le centre tel que la console le recoit, sans la boite de secours (des
    // adresses) ni le client.
    delete centre.secours;
    centre.clientId = null;
    centre.clientName = null;
    const classification = normalizeClassification(centre.classification);
    const accueil = normalizeAccueil(centre.accueil);
    // Le catalogue public du centre (activites, formules, horaires), la route
    // publique du tunnel, en GET : la console le lit au demarrage. Sans le
    // contact du centre ; la date du jour est celle de la fixture.
    const reponse = await fetch(META_URL, { headers: { accept: 'application/json' } });
    if (!reponse.ok) throw new Error(`public-booking-meta ${reponse.status}`);
    const meta = await reponse.json();
    delete meta.today;
    if (meta.center) meta.center.contact = null;
    fs.mkdirSync(DOSSIER, { recursive: true });
    const lu = new Date().toISOString().slice(0, 10);
    ecrire('centre-libramont.json', { source: `GET /api/ops?action=centerConfig et GET /api/public-booking-meta?centerId=${CENTRE}, lus le ${lu}`, center: centre, publicBookingMeta: meta });
    for (const cle of Object.keys(sorties)) {
      const { jour, dossiers } = sorties[cle];
      const reservations = dossiers.map(anonymiser);
      const fausses = reservations.filter((r) => CONTACT.test(String(r.notes || '')));
      if (fausses.length) throw new Error(`note avec un contact : ${fausses.map((r) => r.id).join(',')}`);
      // (les lectures de mapLaneStatusRows et buildLaneMaintenanceInfo)
      const etat = {
        ok: true,
        date: jour.date,
        centerId: CENTRE,
        reservations,
        holds: [],
        laneStatuses: lanes.rows.reduce((acc, row) => {
          let s = row.status;
          if (s === 'maintenance') {
            const de = jourDe(row.maintenance_from), a = jourDe(row.maintenance_until);
            if ((de && jour.date < de) || (a && jour.date > a)) s = 'active';
          }
          acc[Number(row.lane_number)] = s;
          return acc;
        }, {}),
        laneMaintenance: lanes.rows.filter((row) => row.status === 'maintenance').reduce((acc, row) => {
          acc[Number(row.lane_number)] = { from: jourDe(row.maintenance_from), until: jourDe(row.maintenance_until), note: row.maintenance_note || '' };
          return acc;
        }, {}),
        revision: `fixture:planning-v3:${cle}:${jour.date}`,
        syncedAt: `${jour.date}T08:00:00.000Z`,
        classification,
        accueil,
      };
      ecrire(`jour-${cle}.json`, { fixture: cle, libelle: jour.libelle, heure: '15:10', source: `GET /api/staff-state?date=${jour.date}&centerId=${CENTRE}, dossiers DEMO ${IDS[0]}..${IDS[1]}, coordonnees remplacees`, staffState: etat });
      console.log('  ', reservations.length, 'dossiers');
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error('export :', e.code || '', e.message); process.exitCode = 1; });
