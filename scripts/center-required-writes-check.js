// UNE ECRITURE QUI NE NOMME PAS SON CENTRE EST REFUSEE, JAMAIS RANGEE CHEZ
// 'LIBRAMONT' EN SILENCE.
//
// Mesure du 2026-09-01 (sondes executees + refutation independante) :
//   - un POST public de reservation SANS centerId etait ecrit chez Libramont :
//     pistes et capacite du centre consommees pour un dossier destine ailleurs
//     (Gembloux est deja actif en prod : le multi-centre n'est pas theorique) ;
//   - la demande sur-mesure (lead) faisait pareil, sans meme verifier que le
//     centre existe (aucune cle etrangere en schema) ;
//   - le POST staff rangeait chez 'libramont' QUEL QUE SOIT le centre
//     authentifie : le centre de session n'etait jamais transmis, et la
//     barriere inter-clients ne voyait rien (requestedCenterId vide).
// Le tunnel, lui, envoie TOUJOURS un centerId (prouve par execution, pire cas
// mesure = 'libramont' explicite) : refuser ne casse aucun parcours reel.
//
// Quatre proprietes :
//   A. MONTAGE : avec un centre nomme, tout passe ; le canal staff transmet le
//      centre de SESSION via options.centerId. Prouve que le gate mesure.
//   B. LE BACKSTOP : normalizeReservationRequest sans aucun centre JETTE une
//      erreur 422 explicite (plus aucun repli 'libramont').
//   C. LE HANDLER PUBLIC (api/public-reservations) repond 422 « Centre
//      manquant » a un POST sans centre, AVANT tout travail ; avec un centre,
//      il ne rend jamais ce message.
//   D. LA DEMANDE SUR-MESURE (api/public-booking-meta, kind=custom-request)
//      pareil.
//
// Contre-epreuves par mutation : repli 'libramont' remis dans la lib -> B
// rougit ; 422 retire du handler public (avec le repli remis) -> C rougit ;
// 422 retire de la demande sur-mesure -> D rougit. Restauration a l'identique.
//
// Lancement : node scripts/center-required-writes-check.js
'use strict';
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
const RR = path.join(ROOT, 'lib', 'reservation-request.js');
const PUB = path.join(ROOT, 'api', 'public-reservations.js');
const META = path.join(ROOT, 'api', 'public-booking-meta.js');

let failures = 0;
function ok(condition, message) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}`);
  if (!condition) failures += 1;
  return condition;
}

function fakeReq(body, url) {
  const payload = Buffer.from(JSON.stringify(body));
  const req = Readable.from([payload]);
  req.method = 'POST';
  req.url = url;
  req.headers = { host: 'localhost', 'content-type': 'application/json', 'content-length': String(payload.length) };
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function fakeRes() {
  return {
    statusCode: 0, body: '', headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(code) { this.statusCode = code; return this; },
    end(chunk) { this.body += chunk == null ? '' : String(chunk); this.done = true; },
  };
}

async function main() {
  const { normalizeReservationRequest } = require(RR);
  const base = {
    name: 'QA Centre', phone: '0470000000', email: 'qa@example.com',
    date: '2026-09-12', startTime: '14:00', type: 'bowling', pax: 4, duration: 1,
  };

  // --- A. MONTAGE -----------------------------------------------------------
  const nomme = normalizeReservationRequest({ ...base, centerId: 'libramont' }, { channel: 'public', requireEmail: true });
  ok(nomme.centerId === 'libramont', `montage : un centre nomme voyage tel quel (${nomme.centerId})`);
  const session = normalizeReservationRequest({ ...base }, { channel: 'staff', centerId: 'gembloux' });
  ok(session.centerId === 'gembloux',
    `montage : le canal staff transmet le centre de SESSION via options (${session.centerId})`);

  // --- B. LE BACKSTOP -------------------------------------------------------
  let jete = null;
  try { normalizeReservationRequest({ ...base }, { channel: 'public' }); }
  catch (error) { jete = error; }
  ok(Boolean(jete) && Number(jete.statusCode) === 422 && /Centre manquant/.test(jete.message),
    `backstop : sans centre, la lib jette 422 « Centre manquant » (${jete ? `${jete.statusCode} ${jete.message}` : 'AUCUNE erreur, repli silencieux'})`);

  // --- C. LE HANDLER PUBLIC -------------------------------------------------
  const handlerPub = require(PUB);
  const resSans = fakeRes();
  await handlerPub(fakeReq({ ...base }, '/api/public-reservations'), resSans);
  ok(resSans.statusCode === 422 && /Centre manquant/.test(resSans.body),
    `public-reservations sans centre : 422 « Centre manquant » (recu ${resSans.statusCode} ${resSans.body.slice(0, 90)})`);
  const resAvec = fakeRes();
  await handlerPub(fakeReq({ ...base, centerId: 'libramont' }, '/api/public-reservations'), resAvec);
  ok(!/Centre manquant/.test(resAvec.body),
    `public-reservations avec centre : jamais « Centre manquant » (recu ${resAvec.statusCode})`);

  // --- D. LA DEMANDE SUR-MESURE ---------------------------------------------
  const handlerMeta = require(META);
  const lead = { kind: 'custom-request', contactName: 'QA Centre', email: 'qa@example.com', message: 'Anniversaire 12 enfants, besoin d un devis.' };
  const leadSans = fakeRes();
  await handlerMeta(fakeReq({ ...lead }, '/api/public-booking-meta'), leadSans);
  ok(leadSans.statusCode === 422 && /Centre manquant/.test(leadSans.body),
    `custom-request sans centre : 422 « Centre manquant » (recu ${leadSans.statusCode} ${leadSans.body.slice(0, 90)})`);
  const leadAvec = fakeRes();
  await handlerMeta(fakeReq({ ...lead, centerId: 'libramont' }, '/api/public-booking-meta'), leadAvec);
  ok(!/Centre manquant/.test(leadAvec.body),
    `custom-request avec centre : jamais « Centre manquant » (recu ${leadAvec.statusCode})`);

  if (failures) {
    console.error(`\ncenter-required-writes-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\ncenter-required-writes-check: ALL OK (chaque ecriture nomme son centre, plus de repli silencieux)');
  process.exit(0);
}

if (process.argv.includes('--mutate')) {
  const { spawnSync } = require('child_process');
  const sources = new Map([[RR, fs.readFileSync(RR, 'utf8')], [PUB, fs.readFileSync(PUB, 'utf8')], [META, fs.readFileSync(META, 'utf8')]]);
  const restaure = () => { for (const [file, source] of sources) fs.writeFileSync(file, source); };
  const applique = (file, marqueur, remplacement, nom) => {
    const source = sources.get(file);
    if (!source.includes(marqueur)) { console.error(`mutation impossible (${nom}) : marqueur introuvable`); restaure(); process.exit(1); }
    fs.writeFileSync(file, source.replace(marqueur, remplacement));
  };
  let rate = 0;
  const run = () => spawnSync(process.execPath, [__filename], { encoding: 'utf8' });

  const REPLI = "centerId: normalizeText(input.centerId || input.center_id, options.centerId || '') || '',";
  const REPLI_MUTE = "centerId: normalizeText(input.centerId || input.center_id, options.centerId || 'libramont') || 'libramont',";

  // m1 : le repli revient dans la lib -> B rougit.
  applique(RR, REPLI, REPLI_MUTE, 'repli lib');
  if (run().status === 0) { console.error('CONTRE-EPREUVE 1 RATEE : repli lib remis, gate vert.'); rate += 1; } else console.log('contre-epreuve 1 OK : le repli lib remis fait rougir le gate.');
  restaure();

  // m2 : 422 retire du handler public + repli lib remis -> C rougit.
  applique(RR, REPLI, REPLI_MUTE, 'repli lib (m2)');
  applique(PUB, "if (!String((body && (body.centerId || body.center_id)) || '').trim()) {", 'if (false) {', '422 public');
  if (run().status === 0) { console.error('CONTRE-EPREUVE 2 RATEE : 422 public retire, gate vert.'); rate += 1; } else console.log('contre-epreuve 2 OK : retirer le 422 public fait rougir le gate.');
  restaure();

  // m3 : 422 retire de la demande sur-mesure -> D rougit.
  applique(META, "  if (!centerId) {", '  if (false) {', '422 custom-request');
  if (run().status === 0) { console.error('CONTRE-EPREUVE 3 RATEE : 422 custom-request retire, gate vert.'); rate += 1; } else console.log('contre-epreuve 3 OK : retirer le 422 custom-request fait rougir le gate.');
  restaure();

  process.exit(rate ? 1 : 0);
} else {
  main().catch((error) => { console.error('center-required-writes-check: exception', error); process.exit(1); });
}
