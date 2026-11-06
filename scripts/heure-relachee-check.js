#!/usr/bin/env node
// UNE HEURE PROPOSEE QUI LAISSERAIT UNE VRAIE ATTENTE N EST PLUS RETENUE (2026-11-06, chasse du soir sur le banc ;
// Ansar : « des propositions pas logiques sur les horaires »).
//
// Le cas : Gembloux, mercredi 18/11 (12:00-22:00), 25 personnes, Bowling + Laser Game. Le client pose le bowling a
// 20:30 puis a 21:00. Avant, le laser propose pour le bowling de 20:30 (19:30 et 20:00) restait la, un trou admis
// jusqu a 60 min : les 25 attendaient 35 min, et la page le disait (« 35 min d’attente avant le bowling »).
//   [A] bowling 20:30 : le laser juste avant, moins d une demi-heure de trou, aucun conseil d attente.
//   [B] bowling 21:00 : pareil, le laser a suivi (au-dela d une demi-heure, l heure proposee se recolle).
//   [C] avec un minigolf libre, bowling 21:00 : le laser suit aussi ; ce qui ne tient plus avant la fermeture se dit,
//       avec une arrivee ou tout tient (« Arriver à … »), jamais en silence.
// Banc local (scripts/banc/banc-complet.js) : la vraie page et les vrais gestionnaires, base en memoire, reglages des
// centres lus en GET, rien ne part en ligne en ecriture.
// Contre-epreuve : --mutate sert la page avec l ancien seuil (60 min) et exige que [B] rougisse.
'use strict';
process.env.TZ = 'Europe/Brussels';
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chargerReglages, creerServeur } = require('./banc/banc-complet');
const { lancer, ouvrir, etat, poser } = require('./banc/banc');
const MUTER = process.argv.includes('--mutate');
const PORT = Number(process.env.PORT_HEURE_RELACHEE || 4467);
const JS = 'assets/fungalaxy-booking.js';
const MUTATIONS = [
  { nom: 'ancien seuil de 60 min', fichier: JS, de: '  var ECART_RETENU = 30;', vers: '  var ECART_RETENU = 60;', mord: '[B]' },
];
const min = (h) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(h || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
let mutation = null;
let rouges = [];
let oks = 0;
function ok(cond, nom, detail) {
  if (cond) { oks += 1; if (!MUTER) console.log(`ok    ${nom}`); return; }
  rouges.push(nom);
  if (!MUTER) console.log(`FAIL  ${nom}${detail ? `  ${detail}` : ''}`);
}
// La derniere reponse de la route des disponibilites que la page a lue, et son premier creneau.
function suivre(page) {
  const lues = [];
  page.on('response', async (r) => {
    if (r.url().indexOf('/api/public-availability?') < 0 || /[?&](arrivals|arcades|type=durees)/.test(r.url())) return;
    try { lues.push(await r.json()); } catch (e) { /* reponse sans corps */ }
  });
  return () => { const j = lues[lues.length - 1] || {}; return { j, s: (j.slots || [])[0] || {} }; };
}
function trouAvantBowling(s) {
  const tl = (s.opsPlan && s.opsPlan.timeline) || [];
  const bowling = tl.find((x) => x.activityId === 'bowling');
  const lasers = tl.filter((x) => x.activityId === 'laser_game' && x.endTime && bowling && min(x.endTime) <= min(bowling.startTime));
  if (!bowling || !lasers.length) return { trou: NaN, bowling: bowling && bowling.startTime, lasers: lasers.map((x) => x.startTime) };
  return { trou: min(bowling.startTime) - Math.max(...lasers.map((x) => min(x.endTime))), bowling: bowling.startTime, lasers: lasers.map((x) => x.startTime) };
}
async function cas(b, activities, poses) {
  const { page } = await ouvrir(b, { base: `http://127.0.0.1:${PORT}`, centre: 'gembloux', date: '2026-11-18', pax: 25, activities, w: 390, h: 844 });
  const lire = suivre(page);
  const vus = [];
  for (const h of poses) {
    await poser(page, 'bowling', h);
    const e = await etat(page);
    vus.push({ h, e, ...lire() });
  }
  await page.context().close();
  return vus;
}

(async () => {
  for (const m of MUTATIONS) {
    const src = fs.readFileSync(path.join(ROOT, m.fichier), 'utf8').replace(/\r\n/g, '\n');
    if (src.split(m.de).length !== 2) { console.error(`heure-relachee-check : l ancre de « ${m.nom} » n est plus dans ${m.fichier}`); process.exit(2); }
  }
  await chargerReglages();
  const banc = creerServeur();
  const passer = banc.listeners('request')[0];
  const serveur = http.createServer((rq, rs) => {
    if (mutation && rq.url.split('?')[0] === '/' + mutation.fichier) {
      const src = fs.readFileSync(path.join(ROOT, mutation.fichier), 'utf8').replace(/\r\n/g, '\n');
      rs.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      rs.end(src.replace(mutation.de, () => mutation.vers));
      return;
    }
    passer(rq, rs);
  });
  await new Promise((r) => serveur.listen(PORT, r));
  const b = await lancer();
  const jouer = async () => {
    const [a, bb] = await cas(b, ['bowling', 'laser_game'], ['20:30', '21:00']);
    const tA = trouAvantBowling(a.s);
    ok(tA.bowling === '20:30' && tA.trou >= 0 && tA.trou < 30 && !a.e.conseil.some((c) => /d’attente avant/.test(c)),
      '[A] bowling a 20:30 : le laser juste avant, moins d une demi-heure de trou, aucun conseil d attente', JSON.stringify({ ...tA, conseil: a.e.conseil }));
    const tB = trouAvantBowling(bb.s);
    ok(tB.bowling === '21:00' && tB.trou >= 0 && tB.trou < 30 && !bb.e.conseil.some((c) => /d’attente avant/.test(c)),
      '[B] bowling passe a 21:00 : le laser le suit, aucune attente de 30 min ou plus', JSON.stringify({ ...tB, conseil: bb.e.conseil }));
    const [, c] = await cas(b, ['bowling', 'laser_game', 'minigolf_blacklight'], ['20:30', '21:00']);
    const tC = trouAvantBowling(c.s);
    const manque = Number(c.s.visitShortfallMinutes) > 0;
    const dit = c.e.conseil.some((x) => /ne tiendr/i.test(x) && /Arriver à \d{1,2}:\d{2}/.test(x));
    ok(tC.bowling === '21:00' && tC.trou >= 0 && tC.trou < 30 && (!manque || dit),
      '[C] avec un minigolf libre, bowling a 21:00 : le laser suit aussi ; ce qui ne tient plus se dit, avec une arrivee ou tout tient',
      JSON.stringify({ ...tC, manque: c.s.visitShortfallMinutes, conseil: c.e.conseil }));
  };
  let code = 0;
  try {
    if (!MUTER) {
      await jouer();
      console.log(`heure-relachee-check: ${rouges.length ? `${rouges.length} ROUGE(S)` : 'ALL OK'}, ${oks} ok`);
      code = rouges.length ? 1 : 0;
    } else {
      for (const m of MUTATIONS) {
        mutation = m; rouges = []; oks = 0;
        await jouer();
        const mord = rouges.some((r) => r.startsWith(m.mord));
        console.log(`contre-epreuve « ${m.nom} » : ${mord ? 'mord' : 'NE MORD PAS'} (${rouges.join(' ; ') || 'aucun rouge'})`);
        if (!mord) code = 1;
      }
      mutation = null;
    }
  } finally {
    await b.close();
    serveur.close();
    banc.close();
  }
  process.exit(code);
})().catch((e) => { console.error(e); process.exit(1); });
