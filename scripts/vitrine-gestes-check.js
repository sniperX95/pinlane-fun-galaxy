#!/usr/bin/env node
'use strict';
// =============================================================================
// LES GESTES DE LA FENETRE DES OFFRES, EN STATISTIQUES (2026-10-07)
// -----------------------------------------------------------------------------
// Movsar : « tout repertorie dans les stats, qui a pris les add-on, les
// raisons, etc., pour savoir les raisons qui font le plus prendre un add-on ».
// La route publique POST /api/public-booking-meta { kind: 'vitrine' } :
//   [A] ne garde que les gestes connus (sept), au plus vingt par envoi, les
//       nombres bornes, une raison connue ou rien, un numero de reservation
//       seulement pour « reservee » ; refuse un centre ou une visite
//       mal formes ; aucune donnee personnelle ne peut y entrer ;
//   [B] ecrit en une requete parametree (jamais de texte du client dans le
//       SQL) ; une « reservee » n est gardee que si la reservation existe dans
//       ce centre et vient d etre creee ; sans base, ne fait rien et le dit ;
//       une erreur de base ne casse jamais le formulaire ;
//   [C] la table (migration 0057) et la route connaissent les MEMES gestes,
//       la migration est au registre avec son retour en arriere ;
//   [E] contre-epreuves : chaque garde retiree, ce gate ROUGIT.
// AUCUNE BASE : un faux pool garde les requetes.
// =============================================================================
const fs = require('fs');
const path = require('path');

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
const ROOT = path.join(__dirname, '..');

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
// Le handler, avec un faux pool : il garde chaque requete et rend les
// reservations qu on lui donne pour « reelles ».
function charger(reelles = [], { panne = false, sansBase = false } = {}) {
  purger();
  const database = require(path.join(ROOT, 'lib/database.js'));
  const requetes = [];
  database.getPool = () => (sansBase ? null : {
    query: async (sql, valeurs) => {
      requetes.push({ sql, valeurs });
      if (panne) { const e = new Error('panne'); e.code = '57P01'; throw e; }
      if (/from reservations/i.test(sql)) return { rows: reelles.filter((id) => (valeurs[1] || []).includes(id)).map((id) => ({ id })) };
      return { rows: [], rowCount: 0 };
    },
  });
  const api = require(path.join(ROOT, 'api/public-booking-meta.js'));
  return { api, requetes };
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
const geste = (evenement, extra = {}) => ({ evenement, carte: 'laser:laser_game:2', genre: 'laser', activite: 'laser_game', raison: 'suite', priorite: 60, rang: 0, promo: 20, montant: 48, personnes: 6, ...extra });

async function main() {
  section('[A] CE QUI ENTRE, ET RIEN D AUTRE');
  {
    const { api } = charger();
    const { gestesVitrine } = api.__test;
    const bon = gestesVitrine({ centerId: 'libramont', visite: VISITE, gestes: [geste('vue'), geste('ajout'), geste('inconnu'), geste('vue', { raison: 'pub', rang: 99, promo: 140, montant: -3, priorite: 'x', personnes: 1e9, email: 'a@b.c', nom: 'Dupont', reservation: 77 })] });
    ok(Boolean(bon) && bon.lignes.length === 3 && bon.lignes.map((l) => l.evenement).join(',') === 'vue,ajout,vue', 'un geste inconnu est jete, les autres passent dans l ordre', JSON.stringify(bon && bon.lignes.map((l) => l.evenement)));
    const borne = bon && bon.lignes[2];
    ok(Boolean(borne) && borne.raison === '' && borne.rang === null && borne.promo === null && borne.montant === null && borne.priorite === null && borne.personnes === null && borne.reservationId === null,
      'une raison inconnue devient vide, chaque nombre hors bornes devient nul, un numero de reservation n entre qu avec « reservee »', JSON.stringify(borne));
    ok(Boolean(borne) && Object.keys(borne).sort().join(',') === 'activite,carte,evenement,genre,montant,personnes,priorite,promo,raison,rang,reservationId',
      'aucun autre champ n entre (ni nom, ni mail, ni telephone)', JSON.stringify(Object.keys(borne || {})));
    const vingt = gestesVitrine({ centerId: 'libramont', visite: VISITE, gestes: Array.from({ length: 35 }, () => geste('vue')) });
    ok(vingt && vingt.lignes.length === 20, 'au plus vingt gestes par envoi', String(vingt && vingt.lignes.length));
    const refus = [
      { centerId: 'LIBRAMONT; drop', visite: VISITE, gestes: [geste('vue')] },
      { centerId: 'libramont', visite: 'court', gestes: [geste('vue')] },
      { centerId: 'libramont', visite: VISITE, gestes: 'vue' },
      { centerId: 'libramont', visite: VISITE, gestes: [geste('inconnu')] },
    ].map((b) => gestesVitrine(b));
    ok(refus.every((r) => r === null), 'un centre ou une visite mal formes, ou rien de connu : tout l envoi est refuse', JSON.stringify(refus));
    const r = await poster(api, { kind: 'vitrine', centerId: 'inexistant', visite: VISITE, gestes: [geste('vue')] });
    ok(r.status === 404, 'un centre que la plateforme ne connait pas : 404', JSON.stringify(r));
  }

  section('[B] L ECRITURE');
  {
    const { api, requetes } = charger([4201]);
    const r = await poster(api, { kind: 'vitrine', centerId: 'libramont', visite: VISITE, gestes: [geste('vue'), geste('reservee', { reservation: 4201 }), geste('reservee', { reservation: 9999 })] });
    const insert = requetes.find((q) => /insert into upsell_events/i.test(q.sql));
    ok(r.status === 201 && r.json && r.json.enregistres === 2, 'deux gestes ecrits : la vue, et la « reservee » dont la reservation existe ; l autre est jetee', JSON.stringify(r));
    ok(Boolean(insert) && !insert.sql.includes(VISITE) && !insert.sql.includes('laser_game') && insert.valeurs.length === 26 && insert.valeurs.includes(4201) && !insert.valeurs.includes(9999),
      'une seule requete, parametree : rien du client dans le texte SQL', insert ? insert.sql.slice(0, 120) : 'aucune insertion');
    const verif = requetes.find((q) => /from reservations/i.test(q.sql));
    ok(Boolean(verif) && /center_id = \$1/.test(verif.sql) && /interval '1 hour'/.test(verif.sql) && verif.valeurs[0] === 'libramont',
      'la reservation annoncee se verifie dans CE centre, creee dans l heure', verif ? verif.sql : 'aucune verification');
    const sansBase = charger([], { sansBase: true });
    const r2 = await poster(sansBase.api, { kind: 'vitrine', centerId: 'libramont', visite: VISITE, gestes: [geste('vue')] });
    ok(r2.status === 202 && r2.json && r2.json.enregistres === 0, 'sans base : rien ne s ecrit, la reponse le dit (202)', JSON.stringify(r2));
    const enPanne = charger([], { panne: true });
    const r3 = await poster(enPanne.api, { kind: 'vitrine', centerId: 'libramont', visite: VISITE, gestes: [geste('vue')] });
    ok(r3.status === 202 && r3.json && r3.json.ok === true, 'une base en panne ne casse pas le formulaire (202, la trace reste dans les journaux)', JSON.stringify(r3));
    const autre = charger();
    let dernier = null;
    for (let k = 0; k < 125; k += 1) dernier = await poster(autre.api, { kind: 'vitrine', centerId: 'libramont', visite: VISITE, gestes: [geste('vue')] }, '198.51.100.9');
    ok(dernier && dernier.status === 429, 'au-dela de 120 envois en 10 minutes, une adresse est freinee (429)', JSON.stringify(dernier && dernier.status));
    const lead = await poster(autre.api, { kind: 'vitrine', centerId: 'libramont', visite: VISITE, gestes: [geste('vue')] }, '198.51.100.10');
    ok(lead.status === 201 && autre.requetes.every((q) => !/pilot_leads|custom_requests/i.test(q.sql)), 'un envoi « vitrine » ne tombe jamais dans les prospects ni les demandes sur mesure', JSON.stringify(lead.status));
  }

  section('[C] LA TABLE ET LA ROUTE DISENT LA MEME CHOSE');
  {
    const sql = fs.readFileSync(path.join(ROOT, 'database/upsell-events-schema.sql'), 'utf8');
    const m = /evenement in \(([^)]*)\)/.exec(sql);
    const table = m ? m[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort().join(',') : '';
    const route = /const EVENEMENTS_VITRINE = new Set\(\[([^\]]*)\]\)/.exec(fs.readFileSync(path.join(ROOT, 'api/public-booking-meta.js'), 'utf8'));
    const code = route ? route[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort().join(',') : '';
    ok(table !== '' && table === code, 'la contrainte de la table et la liste de la route nomment les memes sept gestes', `${table} / ${code}`);
    const registre = fs.readFileSync(path.join(ROOT, 'scripts/run-db-migrations.js'), 'utf8');
    ok(/id: '0057_upsell_events',\s*\n\s*file: 'database\/upsell-events-schema\.sql'/.test(registre.replace(/\r\n/g, '\n')) && fs.existsSync(path.join(ROOT, 'database/rollbacks/0057_upsell_events.down.sql')),
      'la migration 0057 est au registre, avec son retour en arriere');
    ok(/references centers\(id\)/.test(sql) && !/\b(email|phone|name|ip)\b/i.test(sql.replace(/--.*$/gm, '')), 'la table appartient a un centre et ne prevoit aucune colonne personnelle');
  }

  section('[E] CONTRE-EPREUVES');
  const fichier = path.join(ROOT, 'api/public-booking-meta.js');
  const original = fs.readFileSync(fichier, 'utf8');
  const muter = async (de, vers, jouer) => {
    const n = original.replace(/\r\n/g, '\n').split(de).length - 1;
    if (n !== 1) return { erreur: `ancre trouvee ${n} fois` };
    try {
      fs.writeFileSync(fichier, original.replace(/\r\n/g, '\n').split(de).join(vers));
      return await jouer();
    } finally {
      fs.writeFileSync(fichier, original);
      purger();
      if (fs.readFileSync(fichier, 'utf8') !== original) throw new Error('public-booking-meta.js non restaure');
    }
  };
  const sansListe = await muter('    if (!EVENEMENTS_VITRINE.has(evenement)) continue;\n', '', async () => {
    const { api } = charger();
    const x = api.__test.gestesVitrine({ centerId: 'libramont', visite: VISITE, gestes: [geste('inconnu')] });
    return Boolean(x && x.lignes.length);
  });
  ok(sansListe === true, 'sans la liste des gestes, un geste inconnu entre : ce gate ROUGIRAIT', JSON.stringify(sansListe));
  const sansVerif = await muter("    const gardees = envoi.lignes.filter((l) => l.evenement !== 'reservee' || reelles.has(l.reservationId));\n", '    const gardees = envoi.lignes;\n', async () => {
    const { api } = charger([]);
    const r = await poster(api, { kind: 'vitrine', centerId: 'libramont', visite: VISITE, gestes: [geste('reservee', { reservation: 9999 })] }, '192.0.2.44');
    return r.status === 201;
  });
  ok(sansVerif === true, 'sans la verification de la reservation, un navigateur fabrique un client : ce gate ROUGIRAIT', JSON.stringify(sansVerif));

  console.log(`\n${echecs === 0 ? 'vitrine-gestes-check: ALL OK' : `vitrine-gestes-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
