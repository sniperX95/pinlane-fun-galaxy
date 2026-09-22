// LE FORMULAIRE FUN GALAXY (fungalaxy.html) FAIT LE MEME PARCOURS QUE LE TUNNEL,
// SUR LES MEMES API, ET CE QU IL AFFICHE VIENT DE CES API.
//
// Le formulaire est une seconde interface au-dessus de public-booking-meta,
// public-availability et public-reservations. Ce gate joue le parcours entier
// dans un navigateur, sur le MEME mock que l ecran regarde a la main
// (scripts/dev-tunnel-server.js : catalogue mocke, disponibilite REELLE sur un
// instantane vide, POST factice qui garde le corps recu), et confronte chaque
// ecran a la reponse d API qui l a produit. Aucun montant, aucune heure n est
// attendu « en dur » : l oracle est relu sur les memes routes, cote Node.
//
// LES PROPRIETES :
//   [A] MONTAGE : la page se charge, le catalogue est lu (le jour propose est un
//       jour d ouverture), le fil des 5 etapes est rendu, la photo est decodee,
//       le poids reste celui d un poste faible (JS+CSS+HTML < 130 Ko bruts,
//       aucune photo 1600 demandee sur un ecran de 1440).
//   [B] ACTIVITES : une carte par activite vendable, prix « des X » egal au
//       minimum de la grille servie, Fun Run desactive au-dela de 5 joueurs,
//       compteur et bouton suivent la selection.
//   [C] HEURES : les puces viennent d anchors.activities[0].times ; retenir une
//       heure compose le plan (arrivee, activites) sur la reponse preferredTimes.
//   [D] CONTACT : un envoi vide marque les 4 champs et la case ; rempli, il
//       passe au recapitulatif.
//   [E] RECAP + ENVOI : le total est LE prix de la reponse de disponibilite ; le
//       POST porte centre, date, heure, groupe, programme et contact, et rien
//       d autre sur la personne ; l ecran final cite le numero rendu.
//   [F] EMBARQUE : embed.js avec data-design="fungalaxy" monte
//       /fungalaxy/<centre>?embed=1 ; dans le cadre, notre bandeau disparait, la
//       hauteur du cadre suit le corps (pinlane:height), chaque etape previent
//       l hote (pinlane:screen), la reservation pousse pinlane_booking dans le
//       dataLayer sans donnee personnelle.
//   [G] TELEPHONE (390 px) : aucun defilement horizontal sur les trois premiers
//       ecrans, le bouton principal tient dans l ecran.
//   [H] MOUVEMENT REDUIT : plus aucune animation.
//
// CONTRE-PREUVE (le gate mord) : FG_QA_CASSE=prix sert un JS dont le prix de
// carte est faux d un euro, FG_QA_CASSE=total un JS dont le total du recap est
// faux d un euro. Chacun doit rendre ce gate ROUGE.
//
// Usage : node scripts/fungalaxy-form-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');
const mock = require('./dev-tunnel-server');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_FG_PORT || 4247);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CASSE = String(process.env.FG_QA_CASSE || '');

let failures = 0;
function ok(cond, label, detail) {
  console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '  ' + detail : ''));
  if (!cond) failures += 1;
  return Boolean(cond);
}
// Une attente BORNEE qui rend false a l echeance : jamais un vert par defaut.
async function attendre(page, fn, ms, arg) {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch (error) { return false; }
}
function euros(n) {
  return (Math.round(Number(n) * 100) / 100).toLocaleString('fr-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
}

const HOST_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;font-family:sans-serif;background:#111}header.site{height:56px;background:#1b1b2f}main{padding:12px}</style>
</head><body>
<header class="site"></header>
<main><h1 style="color:#fff">Reservez</h1><div class="bloc"></div></main>
<script>
window.__hauteurs = []; window.__ecrans = 0;
window.addEventListener('message', function (e) { var d = e.data || {}; if (d.type === 'pinlane:height') window.__hauteurs.push(d.height); if (d.type === 'pinlane:screen') window.__ecrans += 1; });
</script>
<script src="${BASE_URL}/embed.js" data-center="libramont" data-design="fungalaxy" data-target=".bloc" data-track="datalayer"></script>
</body></html>`;

// Le serveur du gate : la page hote en plus, et la contre-preuve (un JS servi
// casse expres) quand FG_QA_CASSE le demande. Tout le reste est le mock partage.
function serveur() {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/host.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(HOST_HTML); return; }
    if (CASSE && url.pathname === '/assets/fungalaxy-booking.js') {
      let js = fs.readFileSync(path.join(ROOT, 'assets', 'fungalaxy-booking.js'), 'utf8');
      if (CASSE === 'prix') js = js.replace("'Dès ' + euros(Math.min.apply(null, vals))", "'Dès ' + euros(1 + Math.min.apply(null, vals))");
      if (CASSE === 'total') js = js.replace('data-total="\' + prix + \'"', 'data-total="\' + (prix + 1) + \'"');
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(js);
      return;
    }
    base.emit('request', req, res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

async function lireJson(url) {
  const r = await fetch(url);
  return r.json();
}

async function main() {
  const srv = await serveur();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const meta = mock.metaPayload('');
  const PROGRAMME = [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1 }];
  try {
    // =====================================================================
    console.log('[A] MONTAGE, POIDS');
    // =====================================================================
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const demandes = [];
    page.on('request', (r) => demandes.push(r.url()));
    await page.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(page, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000),
      '[A] le catalogue est lu : un jour est propose');
    const jour = await page.evaluate(() => document.querySelector('#dayLabel').textContent.trim());
    ok(/^(Dimanche|Mardi|Mercredi|Jeudi|Vendredi|Samedi) \d{1,2} /.test(jour), '[A] le jour propose est un jour d ouverture (jamais lundi)', jour);
    const montage = await page.evaluate(() => {
      const scene = document.querySelector('.fg-scene.is-active');
      const img = scene.querySelector('.fg-art img');
      return {
        scene: scene && scene.dataset.scene,
        etapes: scene.querySelectorAll('[data-steps] .fg-steps__item').length,
        active: scene.querySelector('[data-steps] .fg-steps__item.is-active .lbl') ? scene.querySelector('[data-steps] .fg-steps__item.is-active .lbl').textContent.trim() : '',
        photo: Boolean(img && img.complete && img.naturalWidth > 0),
        pax: document.querySelector('#paxOut').textContent.trim(),
        mots: scene.querySelectorAll('.fg-title .w > span').length,
      };
    });
    ok(montage.scene === 'date' && montage.etapes === 5 && montage.active === 'Date & groupe', '[A] le fil des 5 etapes est rendu, etape 1 active', JSON.stringify(montage));
    ok(montage.photo, '[A] la photo de l ecran est decodee');
    ok(montage.pax === '4 personnes', '[A] le groupe demarre a 4 personnes', montage.pax);
    ok(montage.mots >= 2, '[A] le titre est decoupe mot a mot pour l animation', String(montage.mots));
    const poids = ['assets/fungalaxy-booking.js', 'assets/fungalaxy-booking.css', 'fungalaxy.html']
      .reduce((s, f) => s + fs.statSync(path.join(ROOT, f)).size, 0);
    ok(poids < 130 * 1024, '[A] JS + CSS + HTML bruts sous 130 Ko', `${Math.round(poids / 1024)} Ko`);
    ok(!demandes.some((u) => /-1600\.webp/.test(u)), '[A] aucune photo 1600 px demandee sur un ecran de 1440', demandes.filter((u) => /webp/.test(u)).map((u) => u.split('/').pop()).join(', '));
    ok(demandes.filter((u) => /\.webp/.test(u)).length <= 2, '[A] au plus deux photos chargees au depart (l ecran et le suivant)');

    // Le jour du mock (prochain samedi) est choisi dans la liste : c est le
    // jour que l oracle interroge plus bas, et le selecteur est ainsi exerce.
    await page.click('#dayBtn');
    ok(await attendre(page, () => !document.querySelector('#dayList').hidden && document.querySelectorAll('#dayList .fg-day__opt').length === 28, 3000), '[A] la liste des jours s ouvre : 28 jours');
    ok(await page.evaluate(() => Array.from(document.querySelectorAll('#dayList .fg-day__opt')).filter((b) => /^Lundi/.test(b.textContent)).every((b) => b.disabled)), '[A] les lundis (fermes) sont desactives');
    await page.click(`#dayList .fg-day__opt[data-date="${mock.DATE}"]`);
    ok(await attendre(page, (d) => document.querySelector('#dayList').hidden && /^Samedi \d{1,2} /.test(document.querySelector('#dayLabel').textContent.trim()), 3000, mock.DATE), '[A] le samedi du mock est retenu et la liste se referme', await page.evaluate(() => document.querySelector('#dayLabel').textContent.trim()));
    // Le groupe passe a 6 : au-dela des 5 joueurs du Fun Run.
    await page.click('#paxPlus'); await page.click('#paxPlus');
    ok(await attendre(page, () => document.querySelector('#paxOut').textContent.trim() === '6 personnes', 3000), '[A] le compteur suit : 6 personnes');

    // =====================================================================
    console.log('');
    console.log('[B] ACTIVITES');
    // =====================================================================
    await page.click('#goActivities');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000), '[B] l ecran des activites est actif, transition finie');
    const cartes = await page.evaluate(() => Array.from(document.querySelectorAll('#gridAct .fg-card')).map((c) => ({ id: c.dataset.activity, prix: c.querySelector('.fg-card__price').textContent.trim(), off: c.disabled })));
    ok(cartes.length === mock.ACTIVITIES.length, '[B] une carte par activite vendable', `${cartes.length}/${mock.ACTIVITIES.length}`);
    const minPiste = Math.min(...Object.values(meta.bowlingPrices).map(Number));
    const minLaser = Math.min(...meta.laserOptions.map((o) => Number(o.price)));
    const minFunRun = Math.min(...meta.funRunOptions.map((o) => Number(o.price)));
    const carte = (id) => cartes.find((c) => c.id === id) || {};
    ok(carte('bowling').prix === `Dès ${euros(minPiste)} / piste`, '[B] bowling : « des » = minimum de la grille servie', carte('bowling').prix);
    ok(carte('laser_game').prix === `Dès ${euros(minLaser)} / personne`, '[B] laser : « des » = minimum des parties servies', carte('laser_game').prix);
    ok(carte('fun_run').prix === `Dès ${euros(minFunRun)} / session · 5 joueurs max.`, '[B] fun run : « des » = minimum des sessions servies', carte('fun_run').prix);
    ok(carte('minigolf_blacklight').prix === 'Dès 10 € / personne · 12 niveaux', '[B] minigolf : tarif saisi par le centre, avec sa note', carte('minigolf_blacklight').prix);
    ok(carte('arcade_time').prix === 'Tarif sur place', '[B] arcades : sans tarif saisi, « Tarif sur place », jamais un chiffre', carte('arcade_time').prix);
    ok(carte('fun_run').off === true && carte('bowling').off === false, '[B] Fun Run desactive a 6 joueurs (5 max), le bowling non');
    ok(await page.evaluate(() => document.querySelector('#goHours').disabled), '[B] sans selection, « Continuer » est inactif');
    await page.click('#gridAct .fg-card[data-activity="bowling"]');
    await page.click('#gridAct .fg-card[data-activity="laser_game"]');
    ok(await attendre(page, () => document.querySelector('#actCount').textContent.replace(/\s+/g, ' ').trim() === '2 activités sélectionnées', 3000), '[B] le compteur dit « 2 activités sélectionnées »');
    ok(await page.evaluate(() => document.querySelectorAll('#gridAct .fg-card.is-on[aria-pressed="true"]').length === 2 && !document.querySelector('#goHours').disabled), '[B] deux cartes cochees, « Continuer » actif');

    // =====================================================================
    console.log('');
    console.log('[C] HEURES');
    // =====================================================================
    await page.click('#goHours');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active'), 5000), '[C] l ecran des heures est actif');
    ok(await attendre(page, () => document.querySelectorAll('#hourZone .fg-chip').length > 0, 20000), '[C] des puces d heure sont rendues (disponibilite reelle, instantane vide)');
    const sousTitre = await page.evaluate(() => document.querySelector('#hourSub').textContent.replace(/\s+/g, ' ').trim());
    ok(/6 personnes · Bowling \+ Laser Game$/.test(sousTitre), '[C] le sous-titre reprend groupe et activites', sousTitre);
    // L oracle : la meme route, cote Node.
    const q = new URLSearchParams({ centerId: 'libramont', date: mock.DATE, type: 'visite', pax: '6', program: JSON.stringify(PROGRAMME) });
    const grille = await lireJson(`${BASE_URL}/api/public-availability?${q}`);
    const ancre = grille.anchors && grille.anchors.activities && grille.anchors.activities[0];
    const heuresOk = ancre ? ancre.times.filter((t) => t.ok !== false).map((t) => t.time) : [];
    const puces = await page.evaluate(() => Array.from(document.querySelectorAll('#hourZone .fg-chip')).map((c) => ({ t: c.dataset.time, off: c.disabled })));
    ok(Boolean(ancre) && puces.length === ancre.times.length, '[C] une puce par heure de anchors.activities[0].times', `${puces.length} puces, ${ancre ? ancre.times.length : 0} heures (${ancre ? ancre.activityId : 'aucune ancre'})`);
    ok(puces.filter((p) => !p.off).map((p) => p.t).join(',') === heuresOk.join(','), '[C] les puces actives sont exactement les heures ok', `${puces.filter((p) => !p.off).length} actives`);
    const choix = heuresOk[0] || '';
    ok(Boolean(choix), '[C] au moins une heure est possible ce jour-la', choix);
    await page.click(`#hourZone .fg-chip[data-time="${choix}"]`);
    ok(await attendre(page, () => document.querySelector('#planZone .fg-plan') && !document.querySelector('#goContact').disabled, 20000), '[C] retenir une heure compose le plan et active « Garder »');
    const plan = await page.evaluate(() => ({ texte: document.querySelector('#planZone .fg-plan').textContent.replace(/\s+/g, ' ').trim(), garder: document.querySelector('#keepTime').textContent.trim(), prix: (document.querySelector('.fg-plan__price') || {}).textContent || '' }));
    const pref = {}; pref[ancre.activityId] = choix;
    q.set('preferredTimes', JSON.stringify(pref));
    const retenu = await lireJson(`${BASE_URL}/api/public-availability?${q}`);
    const slot = (retenu.slots || [])[0] || {};
    const opsPlan = slot.opsPlan || {};
    ok(plan.garder === choix, '[C] le bouton dit « Garder <heure retenue> »', plan.garder);
    ok(/Bowling/.test(plan.texte) && /Laser Game/.test(plan.texte), '[C] le plan nomme les deux activites', plan.texte);
    ok(!opsPlan.arrivalTime || plan.texte.indexOf(`Arrivée ${opsPlan.arrivalTime}`) === 0, '[C] l arrivee affichee est celle du plan serveur', `${opsPlan.arrivalTime || 'aucune'}`);
    const blocs = (opsPlan.resourceBlocks || []).filter((b) => b.type === 'activity');
    ok(blocs.length >= 2 && blocs.every((b) => plan.texte.indexOf(b.startTime) >= 0), '[C] chaque heure de bloc du plan serveur est dans la ligne', blocs.map((b) => `${b.activityId} ${b.startTime}`).join(', '));
    ok(Number(retenu.price) > 0 && plan.prix.trim() === euros(retenu.price), '[C] le prix de la ligne est le prix de la reponse', `${plan.prix.trim()} vs ${retenu.price}`);

    // =====================================================================
    console.log('');
    console.log('[D] CONTACT');
    // =====================================================================
    await page.click('#goContact');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 5000), '[D] l ecran du contact est actif');
    const rappel = await page.evaluate(() => document.querySelector('#recallLine').textContent.replace(/\s+/g, ' ').trim());
    ok(rappel.indexOf('6 personnes') >= 0 && rappel.indexOf(choix) >= 0, '[D] le rappel porte groupe et heure', rappel);
    await page.click('#goRecap');
    ok(await attendre(page, () => document.querySelectorAll('.fg-field.is-invalid').length === 4 && document.querySelector('#consentWrap').classList.contains('is-invalid'), 3000), '[D] un envoi vide marque les 4 champs et la case');
    ok(await page.evaluate(() => Boolean(document.querySelector('.fg-scene[data-scene="contact"].is-active'))), '[D] et reste sur l ecran du contact');
    await page.fill('#cPrenom', 'Test'); await page.fill('#cNom', 'Pinlane'); await page.fill('#cEmail', 'qa@example.com'); await page.fill('#cTel', '0491 30 16 67');
    await page.check('#cConsent');
    await page.click('#goRecap');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="recap"].is-active'), 5000), '[D] rempli, il passe au recapitulatif');

    // =====================================================================
    console.log('');
    console.log('[E] RECAP ET ENVOI');
    // =====================================================================
    const recap = await page.evaluate(() => ({
      total: Number(document.querySelector('#totalAmount').dataset.total),
      paiement: document.querySelector('.fg-total__pay').textContent.replace(/\s+/g, ' ').trim(),
      items: Array.from(document.querySelectorAll('.fg-recap__item .fg-recap__name')).map((n) => n.textContent.trim()),
      lignes: Array.from(document.querySelectorAll('.fg-recap__row')).map((n) => n.textContent.replace(/\s+/g, ' ').trim()),
    }));
    ok(recap.total === Number(retenu.price), '[E] le total du recap EST le prix de la reponse de disponibilite', `${recap.total} vs ${retenu.price}`);
    ok(await attendre(page, (attendu) => document.querySelector('#totalAmount').textContent.trim() === attendu, 3000, euros(retenu.price)), '[E] le compteur finit exactement sur le montant', euros(retenu.price));
    // « Paiement<br>sur place » : le saut de ligne ne laisse aucune espace dans textContent.
    ok(/Paiement\s*sur place/.test(recap.paiement), '[E] « Paiement sur place » est annonce', recap.paiement);
    ok(recap.items.join(' + ') === 'Bowling + Laser Game', '[E] les deux activites sont listees', recap.items.join(' + '));
    ok(recap.lignes[0] && recap.lignes[0].indexOf(String(Number(mock.DATE.slice(8, 10)))) >= 0 && recap.lignes[1] === '6 personnes', '[E] date et groupe en tete', recap.lignes.join(' | '));
    await page.click('#confirmBtn');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="fin"].is-active'), 10000), '[E] la confirmation mene a l ecran final');
    const corps = mock.dernierePose.body || {};
    const fin = await page.evaluate(() => document.querySelector('#finBody').textContent.replace(/\s+/g, ' ').trim());
    ok(new RegExp(`Réservation n° ${corps.__id || '\\d+'}`).test(fin) && fin.indexOf('qa@example.com') >= 0, '[E] l ecran final cite le numero rendu et l adresse', fin.slice(0, 120));
    ok(corps.centerId === 'libramont' && corps.type === 'visite' && corps.date === mock.DATE && corps.pax === 6, '[E] le POST porte centre, type visite, date, groupe', JSON.stringify({ centerId: corps.centerId, type: corps.type, date: corps.date, pax: corps.pax }));
    ok(Array.isArray(corps.program) && corps.program.map((p) => p.activityId).join(',') === 'bowling,laser_game' && corps.program[0].duration === 1 && corps.program[1].games === 1, '[E] le programme envoye est celui choisi (bowling 1 h, laser 1 partie)', JSON.stringify(corps.program));
    ok(corps.startTime === choix && corps.preference && corps.preference.preferredTimes && corps.preference.preferredTimes[ancre.activityId] === choix, '[E] heure retenue et preference d ancre voyagent avec la demande', `${corps.startTime} / ${JSON.stringify(corps.preference && corps.preference.preferredTimes)}`);
    ok(corps.name === 'Test Pinlane' && corps.email === 'qa@example.com' && corps.phone === '0491 30 16 67', '[E] le contact part tel que saisi');
    ok(!('consent' in corps) && !('cConsent' in corps), '[E] la case « j accepte » ne cree aucun champ d API inexistant');
    await ctx.close();

    // =====================================================================
    console.log('');
    console.log('[F] EMBARQUE PAR embed.js');
    // =====================================================================
    const hote = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageHote = await hote.newPage();
    await pageHote.goto(`${BASE_URL}/host.html`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(pageHote, () => document.querySelector('.bloc iframe[title="Reservation en ligne"]'), 5000), '[F] embed.js monte un cadre dans le bloc du site');
    const src = await pageHote.evaluate(() => document.querySelector('.bloc iframe').src);
    ok(src.indexOf(`${BASE_URL}/fungalaxy/libramont?embed=1`) === 0, '[F] le cadre vise /fungalaxy/libramont?embed=1', src);
    ok(/[?&]fond=/.test(src), '[F] la couleur du site voyage dans l adresse (fond=)');
    const cadre = () => pageHote.frames().find((f) => f.url().indexOf('/fungalaxy/libramont?embed=1') >= 0);
    ok(await attendre(pageHote, () => window.__hauteurs.length > 0 && parseInt(document.querySelector('.bloc iframe').style.height, 10) > 300, 8000), '[F] le cadre recoit sa hauteur (pinlane:height)');
    const f = cadre();
    ok(Boolean(f) && await f.evaluate(() => document.body.classList.contains('is-embed')), '[F] dans le cadre, le formulaire se sait embarque');
    const bandeau = await f.evaluate(() => { const t = document.querySelector('.fg-top'); const r = t.getBoundingClientRect(); return { h: Math.round(r.height), d: getComputedStyle(t).display }; });
    ok(bandeau.h === 0 && bandeau.d === 'none', '[F] notre bandeau (logo, « Reserver ») est invisible chez le client', JSON.stringify(bandeau));
    const accord = async () => {
      const dedans = await f.evaluate(() => Math.max(document.body.scrollHeight, document.body.offsetHeight));
      const dehors = await pageHote.evaluate(() => parseInt(document.querySelector('.bloc iframe').style.height, 10));
      return { dedans, dehors, ecart: Math.abs(dedans - dehors) };
    };
    let a = await accord();
    ok(a.ecart <= 8, '[F] la hauteur du cadre suit le corps du formulaire (ecart <= 8 px)', JSON.stringify(a));
    await f.click('#goActivities');
    ok(await attendre(pageHote, () => window.__ecrans > 0, 5000), '[F] changer d ecran previent l hote (pinlane:screen)');
    ok(await attendre(pageHote, () => document.querySelector('.bloc iframe').contentWindow && true, 1000) && await (async () => {
      // La hauteur se remesure apres la transition (600 ms au plus).
      const butoir = Date.now() + 4000;
      while (Date.now() < butoir) { a = await accord(); if (a.ecart <= 8 && await f.evaluate(() => !document.querySelector('.fg-scene.is-entering'))) return true; await new Promise((r) => setTimeout(r, 120)); }
      return false;
    })(), '[F] apres le changement d ecran, le cadre a la hauteur du nouvel ecran', JSON.stringify(a));
    // Le parcours entier depuis le cadre : bowling seul, 4 personnes.
    await f.click('#gridAct .fg-card[data-activity="bowling"]');
    await f.click('#goHours');
    ok(await attendre(f, () => document.querySelectorAll('#hourZone .fg-chip:not([disabled])').length > 0, 20000), '[F] les heures se chargent dans le cadre');
    await f.click('#hourZone .fg-chip:not([disabled])');
    ok(await attendre(f, () => !document.querySelector('#goContact').disabled, 20000), '[F] une heure est retenue dans le cadre');
    await f.click('#goContact');
    await f.fill('#cPrenom', 'Test'); await f.fill('#cNom', 'Cadre'); await f.fill('#cEmail', 'cadre@example.com'); await f.fill('#cTel', '0491301667');
    await f.check('#cConsent');
    await f.click('#goRecap');
    ok(await attendre(f, () => document.querySelector('.fg-scene[data-scene="recap"].is-active'), 5000), '[F] recap atteint dans le cadre');
    await f.click('#confirmBtn');
    ok(await attendre(pageHote, () => Array.isArray(window.dataLayer) && window.dataLayer.some((e) => e.event === 'pinlane_booking'), 10000), '[F] la reservation pousse pinlane_booking dans le dataLayer de l hote');
    const signal = await pageHote.evaluate(() => (window.dataLayer.find((e) => e.event === 'pinlane_booking') || {}).pinlane || {});
    ok(Number(signal.reservationId) > 0 && signal.center === 'libramont' && signal.currency === 'EUR' && signal.status === 'confirmed', '[F] le signal porte numero, centre, devise, statut', JSON.stringify(signal));
    ok(!('email' in signal) && !('name' in signal) && !('phone' in signal) && JSON.stringify(signal).indexOf('example.com') < 0, '[F] et aucune donnee personnelle');
    await hote.close();

    // =====================================================================
    console.log('');
    console.log('[G] TELEPHONE 390 px');
    // =====================================================================
    const tel = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pageTel = await tel.newPage();
    await pageTel.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(pageTel, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000), '[G] le catalogue est lu');
    const mesure = () => pageTel.evaluate(() => {
      const b = document.querySelector('.fg-scene.is-active .fg-btn:not(.fg-btn--ghost)');
      const r = b ? b.getBoundingClientRect() : { left: -1, right: 9999 };
      return { deborde: document.documentElement.scrollWidth - document.documentElement.clientWidth, btnDedans: r.left >= 0 && r.right <= document.documentElement.clientWidth, art: Math.round((document.querySelector('.fg-scene.is-active .fg-art') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height) };
    });
    let m = await mesure();
    ok(m.deborde <= 1 && m.btnDedans, '[G] ecran 1 : aucun defilement horizontal, bouton dans l ecran', JSON.stringify(m));
    ok(m.art > 0 && m.art <= 260, '[G] ecran 1 : la photo devient un bandeau (<= 260 px)', `${m.art}px`);
    await pageTel.click('#goActivities');
    ok(await attendre(pageTel, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000), '[G] ecran 2 atteint');
    m = await mesure();
    ok(m.deborde <= 1 && m.btnDedans, '[G] ecran 2 : aucun defilement horizontal, bouton dans l ecran', JSON.stringify(m));
    await pageTel.click('#gridAct .fg-card[data-activity="bowling"]');
    await pageTel.click('#goHours');
    // La mesure attend la fin du glissement d ecran : pendant la transition,
    // la scene entrante est decalee de 48 px et compte dans scrollWidth.
    ok(await attendre(pageTel, () => document.querySelectorAll('#hourZone .fg-chip').length > 0 && !document.querySelector('.fg-scene.is-entering'), 20000), '[G] ecran 3 : les heures se chargent, transition finie');
    m = await mesure();
    ok(m.deborde <= 1 && m.btnDedans, '[G] ecran 3 : aucun defilement horizontal, bouton dans l ecran', JSON.stringify(m));
    await tel.close();

    // =====================================================================
    console.log('');
    console.log('[H] MOUVEMENT REDUIT');
    // =====================================================================
    const calme = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const pageCalme = await calme.newPage();
    await pageCalme.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    const anims = await pageCalme.evaluate(() => Array.from(document.querySelectorAll('.fg-scene.is-active .fg-title .w > span, .fg-scene.is-active .fg-art img, .fg-scene.is-active .fg-rise')).map((el) => getComputedStyle(el).animationName).filter((n) => n && n !== 'none'));
    ok(anims.length === 0, '[H] avec prefers-reduced-motion, plus aucune animation', anims.join(', ') || 'aucune');
    await calme.close();
  } finally {
    await browser.close();
    srv.close();
  }
  console.log('');
  if (failures) { console.error(`fungalaxy-form-check: ${failures} verification(s) en echec.`); process.exit(1); }
  console.log('fungalaxy-form-check: ALL OK');
}

main().catch((error) => { console.error(error && error.stack || error); process.exit(1); });
