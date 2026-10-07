// LES PISTES DU BOWLING SE VOIENT LA OU LE CLIENT CHOISIT (Movsar,
// 2026-10-01 : « au-dela de 6 joueurs pour le bowling c est une autre piste
// en plus payee, prix par temps et par piste, 6 joueurs max par piste ; faut
// que ce soit visible quand ils choisissent les horaires, pour comprendre
// quand ils sont plus de 6 pourquoi c est plus cher »).
//
//   [A] la carte du bowling et l ecran des heures disent les pistes et le
//       prix (« 3 pistes × 39 € = 117 € »), pour 1, 6, 7, 14 et 24 joueurs ;
//       le nombre de pistes est celui que le serveur facture
//       (getBilledLaneCount) et le total est celui du recapitulatif.
//   [B] sur telephone, plus de legende des heures (le programme pas a pas se
//       lit seul, Movsar 2026-10-07 : « pas bcp de texte ») et le bloc du
//       laser tient en peu de texte.
//
// Lancement : node scripts/bowling-pistes-visibles-check.js
'use strict';
const { getBilledLaneCount, BOWLING_PRICES } = require('../lib/booking-config');

let fautes = 0;
function ok(cond, nom, detail) {
  if (cond) console.log('ok    ' + nom);
  else { fautes += 1; console.log('FAIL  ' + nom + (detail ? '  ' + detail : '')); }
}

async function main() {
  const PORT = Number(process.env.PINLANE_PISTES_PORT || 4483);
  const BASE = 'http://127.0.0.1:' + PORT;
  const mock = require('./dev-tunnel-server');
  const { chromium } = require('playwright-core');
  const centre = require('../ops-knowledge/centers.json').centers.find((c) => c.id === 'libramont');
  const bowling = centre.resources.bowling;
  const server = mock.createServer({ port: PORT });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  const prixPiste = Number(BOWLING_PRICES[1] || BOWLING_PRICES['1']);
  const euros = (n) => n.toLocaleString('fr-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
  try {
    for (const [pax, largeur] of [[1, 390], [6, 390], [7, 390], [14, 390], [24, 1280]]) {
      const page = await browser.newPage({ viewport: { width: largeur, height: 900 } });
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(String((e && e.message) || e)));
      await page.goto(BASE + '/fungalaxy/libramont');
      await page.click('#dayBtn');
      for (let i = 0; i < 4; i += 1) {
        if (await page.evaluate((d) => Boolean(document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`)), mock.DATE)) break;
        await page.click('#calNext');
      }
      await page.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
      await page.fill('#paxInput', String(pax));
      await page.click('#goActivities');
      for (const id of ['bowling', 'laser_game']) await page.click(`#gridAct .fg-card[data-activity="${id}"]`);
      const carte = await page.evaluate(() => ((document.querySelector('#gridAct li[data-activity="bowling"] .fg-card__rot') || {}).textContent || '').trim());
      await page.click('#gridAct li[data-activity="bowling"] [data-activity-info]');
      const information = await page.locator('.fg-info-text').textContent();
      await page.keyboard.press('Escape');
      await page.click('#goHours');
      await page.waitForSelector('.fg-track[data-activity="bowling"]', { timeout: 20000 });
      await page.waitForTimeout(800);
      // Le laser se lit dans SA ligne du programme, ouverte comme le client
      // l ouvre (pas a pas, 2026-10-07) : repliee, sa note ne s affiche pas.
      const ligneLaser = page.locator('#hourZone .fg-etape[data-activity="laser_game"]:not(.is-open) .fg-etape__tete').first();
      if (await ligneLaser.count()) { await ligneLaser.click(); await page.waitForTimeout(700); }
      const heures = await page.evaluate(() => {
        const t = document.querySelector('.fg-track[data-activity="bowling"]');
        const lignes = Array.from(document.querySelectorAll('.fg-visit__prices *')).map((n) => n.textContent.replace(/\s+/g, ' ').trim());
        return {
          detail: (t.querySelector('.fg-track__detail') || {}).textContent || '',
          note: ((t.querySelector('.fg-track__lanes') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
          prixBowling: lignes.filter((l) => /^Bowling/.test(l)).join(' | '),
          legende: String((document.querySelector('.fg-legend') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
          programme: document.querySelectorAll('#hourZone .fg-etape[data-cle]').length,
          laser: String((document.querySelector('.fg-track[data-activity="laser_game"] .fg-track__share') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
        };
      });
      const pistes = getBilledLaneCount('bowling', pax, null, { laneCount: bowling.laneCount, normalCapacityPerLane: bowling.maxPlayersPerLane || 6 });
      const total = euros(prixPiste * pistes);
      const parPiste = bowling.maxPlayersPerLane || 6;
      if (pistes < 2) {
        ok(carte === `1 heure · 1 piste × ${euros(prixPiste)} = ${total}` && information.includes(`${parPiste} joueurs par piste en confort`) && information.includes('jusqu’à 7 joueurs par piste'), `[A] ${pax} joueur(s), carte : calcul court, confort et secours dans le popup`, carte);
        ok(heures.note === `${parPiste} joueurs par piste : ${pax} joueurs = 1 piste × ${euros(prixPiste)} = ${total}.` && / · 1 piste$/.test(heures.detail), `[A] ${pax} joueur(s), heures : « 1 piste », calcul exact`, JSON.stringify(heures));
      } else {
        ok(carte === `1 heure · ${pistes} pistes × ${euros(prixPiste)} = ${total}` && information.includes(`${parPiste} joueurs par piste en confort : ${pistes} pistes × ${euros(prixPiste)} = ${total}`) && information.includes('jusqu’à 7 joueurs par piste'), `[A] ${pax} joueurs, carte : calcul court, confort, secours et calcul dans le popup`, carte);
        ok(heures.detail.endsWith(` · ${pistes} pistes`), `[A] ${pax} joueurs, en-tete des heures : ${pistes} pistes`, heures.detail);
        ok(heures.note.indexOf(`${parPiste} joueurs par piste : ${pax} joueurs = ${pistes} pistes × ${euros(prixPiste)} = ${total}`) === 0,
          `[A] ${pax} joueurs, ecran des heures : le calcul du prix des pistes`, heures.note);
        ok(heures.prixBowling.indexOf(total) >= 0, `[A] ${pax} joueurs, le recapitulatif facture le meme total (${total})`, heures.prixBowling);
      }
      if (largeur < 680 && pax >= 2) {
        ok(heures.legende === '' && heures.programme > 0, `[B] ${pax} joueur(s), telephone : plus de legende, le programme pas a pas se lit seul`, JSON.stringify({ legende: heures.legende, lignes: heures.programme }));
        ok(heures.laser.length > 0 && heures.laser.length <= 130, `[B] ${pax} joueur(s), telephone : le bloc du laser tient en 130 caracteres`, `${heures.laser.length} « ${heures.laser} »`);
      }
      ok(erreurs.length === 0, `[A] ${pax} joueur(s) : aucune erreur de page`, erreurs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fautes ? `\nbowling-pistes-visibles-check: ${fautes} defaut(s).` : '\nbowling-pistes-visibles-check: ALL OK (pistes et prix du bowling visibles a la carte et aux heures, sans legende et laser court sur telephone)');
  process.exit(fautes ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
