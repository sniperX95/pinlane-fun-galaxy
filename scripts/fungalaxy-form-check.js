// LE FORMULAIRE FUN GALAXY (fungalaxy.html) FAIT LE MEME PARCOURS QUE LE TUNNEL,
// SUR LES MEMES API, ET CE QU IL AFFICHE VIENT DE CES API.
//
// Le formulaire est une seconde interface au-dessus de public-booking-meta,
// public-availability et public-reservations. Ce gate joue le parcours entier
// dans un navigateur, sur le MEME mock que l ecran regarde a la main
// (scripts/dev-tunnel-server.js : catalogue mocke, calendrier REEL de la
// Wallonie sur la table servie, disponibilite REELLE sur un instantane vide,
// POST factice qui garde le corps recu), et confronte chaque ecran a la
// reponse d API qui l a produit. Aucun montant, aucune heure, aucun jour ferie
// n est attendu « en dur » : l oracle est relu sur les memes routes, cote Node.
//
// LES PROPRIETES :
//   [A] MONTAGE : la page se charge, le catalogue est lu (le jour propose est un
//       jour d ouverture), le fil des 5 etapes est rendu, la photo est decodee,
//       le poids reste celui d un poste faible (JS+CSS+HTML < 150 Ko bruts,
//       aucune photo 1600 demandee sur un ecran de 1440), le « ? » du titre ne
//       part jamais seul sur sa ligne.
//   [A2] CALENDRIER : la liste des jours EST center.calendar (45 jours) : un
//       jour ferme est desactive avec son motif, un jour ouvert porte ses
//       heures, un ferie ou un conge scolaire porte son etiquette ; un lundi de
//       conge scolaire est OUVERT (horaire ferie) quand le calendrier le dit.
//   [A3] EMPILEMENT : la liste des jours ouverte passe DEVANT le compteur de
//       personnes et le bouton (le defaut vu par Movsar le 2026-09-22) ; dans
//       une colonne etroite, seul le libelle de l etape en cours reste.
//   [B] ACTIVITES : une carte par activite vendable, prix « des X » egal au
//       minimum de la grille servie, Fun Run desactive au-dela de 5 joueurs ;
//       une carte cochee montre ses options (duree, parties) et son prix exact,
//       et l option choisie part dans le programme.
//   [C] HEURES : UNE PISTE PAR ACTIVITE PLANIFIEE (anchors.activities), TOUTES
//       les heures du jour, celles refusees visibles avec la raison du moteur ;
//       sans heure posee, la proposition et le plan sont ceux du serveur ; poser
//       une heure de bowling recalcule la piste du laser et le plan comme la
//       route preferredTimes ; deux parties de laser se posent sur deux heures
//       (laserGameTimes) ; « laisser l equipe placer » efface la pose.
//   [D] CONTACT : un envoi vide marque les 4 champs et la case ; rempli, il
//       passe au recapitulatif.
//   [E] RECAP + ENVOI : le total est LE prix de la reponse de disponibilite ; le
//       POST porte centre, date, heure, groupe, programme (avec l option
//       choisie), les heures posees et le contact, et rien d autre sur la
//       personne ; l ecran final cite le numero rendu.
//   [F] EMBARQUE : embed.js avec data-design="fungalaxy" monte
//       /fungalaxy/<centre>?embed=1 ; dans le cadre, notre bandeau disparait, la
//       hauteur du cadre suit le corps (pinlane:height), chaque etape previent
//       l hote (pinlane:screen), la reservation pousse pinlane_booking dans le
//       dataLayer sans donnee personnelle.
//   [G] TELEPHONE (390 px) : aucun defilement horizontal sur les trois premiers
//       ecrans, le bouton principal tient dans l ecran.
//   [H] MOUVEMENT REDUIT : plus aucune animation, rideau et halos compris.
//
// CONTRE-PREUVE (le gate mord) : FG_QA_CASSE=prix sert un JS dont le prix de
// carte est faux d un euro, FG_QA_CASSE=total un JS dont le total du recap est
// faux d un euro, FG_QA_CASSE=raison un JS qui perd la raison des heures
// refusees, FG_QA_CASSE=calendrier un JS qui laisse cliquer les jours fermes.
// Chacun doit rendre ce gate ROUGE.
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
// Les libelles du calendrier sont servis sans accent ; l ecran les accentue.
// On compare sans accent ni apostrophe typographique : le SENS, pas la police.
function plat(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim(); }
function horaire(sch) { return sch && sch.label ? String(sch.label).replace('Minuit', 'minuit') : 'Fermé'; }
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

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
      const avant = js;
      if (CASSE === 'prix') js = js.replace("'Dès ' + euros(mini)", "'Dès ' + euros(1 + mini)");
      if (CASSE === 'total') js = js.replace('data-total="\' + prix + \'"', 'data-total="\' + (prix + 1) + \'"');
      if (CASSE === 'raison') js = js.replace('data-reason="\' + esc(t.reason || \'\') + \'"', 'data-reason=""');
      if (CASSE === 'calendrier') js = js.replace("(j.ouvert ? '' : 'disabled')", "''");
      if (js === avant) { console.error(`fungalaxy-form-check: la mutation ${CASSE} n a rien touche (le code a change ?)`); process.exit(2); }
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
// La ligne du plan telle que l ecran doit l ecrire, relue sur la reponse.
function lignePlan(reponse) {
  const slot = (reponse.slots || [])[0];
  if (!slot) return null;
  const plan = slot.opsPlan || {};
  const vus = new Set();
  const blocs = (plan.resourceBlocks || []).filter((b) => (b.type === 'activity' || b.activityId) && !vus.has(`${b.activityId}@${b.startTime}`) && vus.add(`${b.activityId}@${b.startTime}`));
  return { arrivee: plan.arrivalTime || '', blocs: blocs.map((b) => ({ id: b.activityId, t: b.startTime })), fin: slot.visitEndTime || '', prix: Number(reponse.price), time: slot.time, opsPlan: plan };
}
async function lireEcranPlan(page) {
  return page.evaluate(() => {
    const p = document.querySelector('#planZone .fg-plan');
    return p ? { texte: p.textContent.replace(/\s+/g, ' ').trim(), prix: ((p.querySelector('.fg-plan__price') || {}).textContent || '').trim(), garder: !document.querySelector('#goContact').disabled } : null;
  });
}
function planCorrespond(ecran, oracle) {
  if (!ecran || !oracle) return false;
  if (oracle.arrivee && ecran.texte.indexOf(`Arrivée ${oracle.arrivee}`) !== 0) return false;
  if (!oracle.blocs.every((b) => ecran.texte.indexOf(b.t) >= 0)) return false;
  if (oracle.fin && ecran.texte.indexOf(`Fin vers ${oracle.fin}`) < 0) return false;
  return ecran.prix === euros(oracle.prix);
}
async function lirePistes(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#hourZone .fg-track')).map((t) => ({
    id: t.dataset.activity,
    count: Number(t.dataset.count) || 1,
    chips: Array.from(t.querySelectorAll('.fg-chip')).map((c) => ({ t: c.dataset.time, ok: c.dataset.ok === 'true', reason: c.dataset.reason || '', mot: (c.querySelector('small') || {}).textContent || '', on: c.classList.contains('is-on'), proposed: c.classList.contains('is-proposed'), titre: c.getAttribute('title') || '' })),
    reset: Boolean(t.querySelector('[data-reset]')),
  })));
}

async function main() {
  const srv = await serveur();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const meta = mock.metaPayload('', 45);
  const calendrier = meta.center.calendar;
  const PROGRAMME = [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 2 }];
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
    const premierOuvert = calendrier.find((d) => d.open);
    ok(Boolean(premierOuvert) && jour === await page.evaluate((d) => { const p = d.split('-').map(Number); const x = new Date(p[0], p[1] - 1, p[2]); const J = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'], M = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']; const s = J[x.getDay()] + ' ' + x.getDate() + ' ' + M[x.getMonth()]; return s.charAt(0).toUpperCase() + s.slice(1); }, premierOuvert.date),
      '[A] le jour propose est le PREMIER jour ouvert du calendrier servi', `${jour} / ${premierOuvert && premierOuvert.date}`);
    const montage = await page.evaluate(() => {
      const scene = document.querySelector('.fg-scene.is-active');
      const img = scene.querySelector('.fg-art img');
      return {
        scene: scene && scene.dataset.scene,
        etapes: scene.querySelectorAll('[data-steps] .fg-steps__item').length,
        active: scene.querySelector('[data-steps] .fg-steps__item.is-active .lbl') ? scene.querySelector('[data-steps] .fg-steps__item.is-active .lbl').textContent.trim() : '',
        photo: Boolean(img && img.complete && img.naturalWidth > 0),
        pax: document.querySelector('#paxOut').textContent.trim(),
        mots: Array.from(scene.querySelectorAll('.fg-title .w > span')).map((s) => s.textContent),
        halos: document.querySelectorAll('.fg-glow i').length,
      };
    });
    ok(montage.scene === 'date' && montage.etapes === 5 && montage.active === 'Date & groupe', '[A] le fil des 5 etapes est rendu, etape 1 active', JSON.stringify({ scene: montage.scene, etapes: montage.etapes, active: montage.active }));
    ok(montage.photo, '[A] la photo de l ecran est decodee');
    ok(montage.pax === '4 personnes', '[A] le groupe demarre a 4 personnes', montage.pax);
    ok(montage.mots.length >= 2 && !montage.mots.some((m) => /^[?!]$/.test(m.trim())) && /\u00a0\?$/.test(montage.mots[montage.mots.length - 1]), '[A] le titre est decoupe mot a mot, le « ? » reste colle a son mot (espace insecable)', JSON.stringify(montage.mots));
    ok(await attendre(page, () => getComputedStyle(document.querySelector('.fg-curtain')).visibility === 'hidden', 3000) && montage.halos === 2, '[A] le rideau d ouverture finit invisible (au plus 3 s), deux halos en place', JSON.stringify({ halos: montage.halos }));
    const poids = ['assets/fungalaxy-booking.js', 'assets/fungalaxy-booking.css', 'fungalaxy.html']
      .reduce((s, f) => s + fs.statSync(path.join(ROOT, f)).size, 0);
    ok(poids < 150 * 1024, '[A] JS + CSS + HTML bruts sous 150 Ko', `${Math.round(poids / 1024)} Ko`);
    ok(!demandes.some((u) => /-1600\.webp/.test(u)), '[A] aucune photo 1600 px demandee sur un ecran de 1440', demandes.filter((u) => /webp/.test(u)).map((u) => u.split('/').pop()).join(', '));
    ok(demandes.filter((u) => /\.webp/.test(u)).length <= 2, '[A] au plus deux photos chargees au depart (l ecran et le suivant)');
    ok(demandes.some((u) => /public-booking-meta\?.*calendar=45/.test(u)), '[A] le catalogue est demande AVEC le calendrier (calendar=45)');

    // =====================================================================
    console.log('');
    console.log('[A2] CALENDRIER SERVI = LISTE DES JOURS');
    // =====================================================================
    await page.click('#dayBtn');
    ok(await attendre(page, () => !document.querySelector('#dayList').hidden && document.querySelectorAll('#dayList .fg-day__opt').length === 45, 3000), '[A2] la liste des jours s ouvre : 45 jours, comme le calendrier servi');
    const lignes = await page.evaluate(() => Array.from(document.querySelectorAll('#dayList .fg-day__opt')).map((b) => ({ date: b.dataset.date, off: b.disabled, texte: b.textContent.replace(/\s+/g, ' ').trim(), heures: (b.querySelector('small') || {}).textContent || '', tag: (b.querySelector('.fg-tag') || {}).textContent || '' })));
    ok(await page.evaluate(() => document.querySelectorAll('#dayList .fg-day__month').length >= 2), '[A2] les mois separent la liste (au moins deux en 45 jours)');
    let ecarts = [];
    calendrier.forEach((d, i) => {
      const l = lignes[i] || {};
      if (l.date !== d.date) ecarts.push(`${d.date}: date ${l.date}`);
      if (l.off !== !d.open) ecarts.push(`${d.date}: off=${l.off} open=${d.open}`);
      const attendu = d.open ? horaire(d.schedule) : (d.closedLabel || 'Fermé');
      if (plat(l.heures) !== plat(attendu)) ecarts.push(`${d.date}: « ${l.heures} » vs « ${attendu} »`);
      const tagAttendu = d.holiday ? (d.holiday.type === 'public' ? `Férié · ${d.holiday.label}` : d.holiday.label) : '';
      if (plat(l.tag) !== plat(tagAttendu)) ecarts.push(`${d.date}: etiquette « ${l.tag} » vs « ${tagAttendu} »`);
    });
    ok(ecarts.length === 0, '[A2] chaque ligne = son jour du calendrier (ouvert/ferme, heures ou motif, etiquette ferie/conge)', ecarts.slice(0, 4).join(' ; ') || `${calendrier.length} jours conformes`);
    const fermes = calendrier.filter((d) => !d.open);
    ok(fermes.length > 0 && fermes.every((d) => (lignes.find((l) => l.date === d.date) || {}).off === true), '[A2] les jours fermes sont desactives', `${fermes.length} fermes : ${fermes.map((d) => d.date).join(', ')}`);
    const lundiConge = calendrier.find((d) => d.weekday === 1 && d.open && d.holiday);
    if (lundiConge) {
      const l = lignes.find((x) => x.date === lundiConge.date) || {};
      ok(l.off === false && plat(l.heures) === plat(horaire(lundiConge.schedule)) && plat(l.tag) === plat(lundiConge.holiday.label), '[A2] un LUNDI de conge scolaire est ouvert, avec l horaire ferie et son etiquette', `${lundiConge.date} « ${l.texte} »`);
      await page.click(`#dayList .fg-day__opt[data-date="${lundiConge.date}"]`);
      const indice = await page.evaluate(() => document.querySelector('#dayHint').textContent.replace(/\s+/g, ' ').trim());
      ok(plat(indice) === plat(`Ouvert ${horaire(lundiConge.schedule)} · ${lundiConge.holiday.label}`), '[A2] sous le champ, l indice dit l horaire et la periode du jour choisi', indice);
      await page.click('#dayBtn');
      await attendre(page, () => !document.querySelector('#dayList').hidden, 2000);
    } else {
      console.log('    (aucun lundi de conge scolaire dans les 45 jours : propriete non exercee aujourd hui)');
    }
    const ferie = calendrier.find((d) => d.holiday && d.holiday.type === 'public');
    ok(!ferie || plat((lignes.find((l) => l.date === ferie.date) || {}).tag) === plat(`Férié · ${ferie.holiday.label}`), '[A2] un jour ferie porte « Férié · <nom> »', ferie ? `${ferie.date} ${ferie.holiday.label}` : 'aucun ferie dans les 45 jours');
    // Le jour du mock (prochain samedi) est choisi dans la liste : c est le
    // jour que l oracle interroge plus bas, et le selecteur est ainsi exerce.
    await page.click(`#dayList .fg-day__opt[data-date="${mock.DATE}"]`);
    ok(await attendre(page, () => document.querySelector('#dayList').hidden && /^Samedi \d{1,2} /.test(document.querySelector('#dayLabel').textContent.trim()), 3000), '[A2] le samedi du mock est retenu et la liste se referme', await page.evaluate(() => document.querySelector('#dayLabel').textContent.trim()));
    // Le groupe passe a 6 : au-dela des 5 joueurs du Fun Run.
    await page.click('#paxPlus'); await page.click('#paxPlus');
    ok(await attendre(page, () => document.querySelector('#paxOut').textContent.trim() === '6 personnes', 3000), '[A2] le compteur suit : 6 personnes');

    // =====================================================================
    console.log('');
    console.log('[A3] EMPILEMENT DE LA LISTE, LIBELLES DES ETAPES (colonne etroite)');
    // =====================================================================
    const etroit = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    const pageEtroite = await etroit.newPage();
    await pageEtroite.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(pageEtroite, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour' && !document.querySelector('.fg-scene.is-entering'), 15000), '[A3] page chargee a 1000 px');
    await dormir(900); // fin des cascades d entree
    const colonne = await pageEtroite.evaluate(() => {
      const day = document.querySelector('#dayBtn').getBoundingClientRect();
      const pax = document.querySelector('#paxValue').getBoundingClientRect();
      const lbls = Array.from(document.querySelectorAll('.fg-scene.is-active .fg-steps__item')).map((li) => ({ active: li.classList.contains('is-active'), visible: getComputedStyle(li.querySelector('.lbl')).display !== 'none' }));
      return { empiles: pax.top > day.bottom, largeurSteps: Math.round(document.querySelector('.fg-scene.is-active .fg-steps').getBoundingClientRect().width), lbls };
    });
    ok(colonne.empiles, '[A3] a 1000 px, le compteur est SOUS le champ du jour (la configuration du bug)', JSON.stringify({ largeurSteps: colonne.largeurSteps }));
    ok(colonne.largeurSteps <= 500 && colonne.lbls.filter((l) => l.active).every((l) => l.visible) && colonne.lbls.filter((l) => !l.active).every((l) => !l.visible), '[A3] fil des etapes sous 500 px : seul le libelle de l etape en cours reste (aucun chevauchement)', JSON.stringify(colonne.lbls));
    await pageEtroite.click('#dayBtn');
    ok(await attendre(pageEtroite, () => !document.querySelector('#dayList').hidden, 2000), '[A3] la liste s ouvre');
    await dormir(350);
    const dessus = await pageEtroite.evaluate(() => {
      const pax = document.querySelector('#paxValue').getBoundingClientRect();
      const btn = document.querySelector('#goActivities').getBoundingClientRect();
      const liste = document.querySelector('#dayList').getBoundingClientRect();
      const au = (r) => { const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el ? (el.closest('#dayList') ? 'liste' : (el.id || el.className || el.tagName)) : 'rien'; };
      return { surPax: au(pax), surBouton: liste.bottom > btn.top ? au(btn) : 'liste au-dessus du bouton', zChamp: getComputedStyle(document.querySelector('#dayBtn').closest('.fg-field')).zIndex };
    });
    ok(dessus.surPax === 'liste' && (dessus.surBouton === 'liste' || dessus.surBouton === 'liste au-dessus du bouton'), '[A3] la liste ouverte est DEVANT le compteur et le bouton (plus derriere)', JSON.stringify(dessus));
    await etroit.close();

    // =====================================================================
    console.log('');
    console.log('[B] ACTIVITES');
    // =====================================================================
    await page.click('#goActivities');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000), '[B] l ecran des activites est actif, transition finie');
    const fil = await page.evaluate(() => ({ largeur: Math.round(document.querySelector('.fg-scene.is-active .fg-steps').getBoundingClientRect().width), visibles: Array.from(document.querySelectorAll('.fg-scene.is-active .fg-steps__item .lbl')).filter((l) => getComputedStyle(l).display !== 'none').length }));
    ok(fil.largeur > 500 && fil.visibles === 5, '[B] sur une scene pleine largeur a 1440 px, le fil est large et ses cinq libelles sont visibles', JSON.stringify(fil));
    const cartes = await page.evaluate(() => Array.from(document.querySelectorAll('#gridAct .fg-card')).map((c) => ({ id: c.dataset.activity, prix: c.querySelector('.fg-card__price').textContent.trim(), off: c.classList.contains('is-off') && c.getAttribute('aria-disabled') === 'true', options: Array.from(c.closest('li').querySelectorAll('.fg-opt')).map((o) => o.textContent.replace(/\s+/g, ' ').trim()), optionsVisibles: c.closest('li').querySelector('.fg-opts') ? getComputedStyle(c.closest('li').querySelector('.fg-opts')).display !== 'none' : false })));
    ok(cartes.length === mock.ACTIVITIES.length, '[B] une carte par activite vendable', `${cartes.length}/${mock.ACTIVITIES.length}`);
    const minPiste = Math.min(...meta.durationOptions.map((o) => Number(o.price)));
    const minLaser = Math.min(...meta.laserOptions.map((o) => Number(o.price)));
    const minFunRun = Math.min(...meta.funRunOptions.map((o) => Number(o.price)));
    ok(minPiste === Math.min(...Object.values(meta.bowlingPrices).map(Number)), '[B] la grille des durees et la grille des prix piste disent le meme minimum');
    const carte = (id) => cartes.find((c) => c.id === id) || {};
    ok(carte('bowling').prix === `Dès ${euros(minPiste)} / piste`, '[B] bowling : « des » = minimum de la grille servie', carte('bowling').prix);
    ok(carte('laser_game').prix === `Dès ${euros(minLaser)} / personne`, '[B] laser : « des » = minimum des parties servies', carte('laser_game').prix);
    ok(carte('fun_run').prix === `Dès ${euros(minFunRun)} / session · 5 joueurs max.`, '[B] fun run : « des » = minimum des sessions servies', carte('fun_run').prix);
    ok(carte('minigolf_blacklight').prix === 'Dès 10 € / personne · 12 niveaux', '[B] minigolf : tarif saisi par le centre, avec sa note', carte('minigolf_blacklight').prix);
    ok(carte('arcade_time').prix === 'Tarif sur place', '[B] arcades : sans tarif saisi, « Tarif sur place », jamais un chiffre', carte('arcade_time').prix);
    ok(carte('fun_run').off === true && carte('bowling').off === false, '[B] Fun Run desactive a 6 joueurs (5 max), le bowling non');
    ok(carte('bowling').options.length === meta.durationOptions.length && carte('laser_game').options.length === meta.laserOptions.length && carte('minigolf_blacklight').options.length === 0, '[B] les options d une carte sont la grille servie (durees, parties), rien pour un tarif simple', `${carte('bowling').options.length} durees, ${carte('laser_game').options.length} parties`);
    ok(!carte('bowling').optionsVisibles, '[B] les options restent cachees tant que la carte n est pas cochee');
    ok(await page.evaluate(() => document.querySelector('#goHours').disabled), '[B] sans selection, « Continuer » est inactif');
    await page.click('#gridAct .fg-card[data-activity="bowling"]');
    await page.click('#gridAct .fg-card[data-activity="laser_game"]');
    ok(await attendre(page, () => document.querySelector('#actCount').textContent.replace(/\s+/g, ' ').trim() === '2 activités sélectionnées', 3000), '[B] le compteur dit « 2 activités sélectionnées »');
    ok(await page.evaluate(() => document.querySelectorAll('#gridAct .fg-card.is-on[aria-checked="true"]').length === 2 && !document.querySelector('#goHours').disabled), '[B] deux cartes cochees, « Continuer » actif');
    const uneHeure = meta.durationOptions.find((o) => Number(o.value) === 1);
    ok(await page.evaluate((attendu) => { const li = document.querySelector('#gridAct li[data-activity="bowling"]'); return getComputedStyle(li.querySelector('.fg-opts')).display !== 'none' && li.querySelector('.fg-opt.is-on[data-valeur="1"]') !== null && li.querySelector('.fg-card__price').textContent.trim() === attendu; }, `${euros(uneHeure.price)} / piste`), '[B] cochee, la carte bowling montre ses durees, « 1 heure » retenue, et son prix exact', `${euros(uneHeure.price)} / piste`);
    const deuxParties = meta.laserOptions.find((o) => Number(o.games) === 2);
    await page.click('#gridAct li[data-activity="laser_game"] .fg-opt[data-valeur="2"]');
    ok(await attendre(page, (attendu) => document.querySelector('#gridAct li[data-activity="laser_game"] .fg-card__price').textContent.trim() === attendu, 3000, `${euros(deuxParties.price)} / personne`), '[B] choisir « 2 parties » met le prix de la grille sur la carte', `${euros(deuxParties.price)} / personne`);

    // =====================================================================
    console.log('');
    console.log('[C] HEURES : UNE PISTE PAR ACTIVITE, TOUTES LES HEURES, LES RAISONS');
    // =====================================================================
    await page.click('#goHours');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active'), 5000), '[C] l ecran des heures est actif');
    ok(await attendre(page, () => document.querySelectorAll('#hourZone .fg-track .fg-chip').length > 0 && document.querySelector('#planZone .fg-plan'), 25000), '[C] les pistes et le plan sont rendus (disponibilite reelle, instantane vide)');
    const sousTitre = await page.evaluate(() => document.querySelector('#hourSub').textContent.replace(/\s+/g, ' ').trim());
    const jourMock = calendrier.find((d) => d.date === mock.DATE);
    ok(/6 personnes · Bowling \+ Laser Game/.test(sousTitre) && (!jourMock || plat(sousTitre).indexOf(plat(`Ouvert ${horaire(jourMock.schedule)}`)) >= 0), '[C] le sous-titre reprend groupe, activites et l horaire du jour', sousTitre);
    // L oracle : la meme route, cote Node, sans heure posee.
    const q = new URLSearchParams({ centerId: 'libramont', date: mock.DATE, type: 'visite', pax: '6', program: JSON.stringify(PROGRAMME) });
    const grille = await lireJson(`${BASE_URL}/api/public-availability?${q}`);
    const ancres = (grille.anchors && grille.anchors.activities) || [];
    const defauts = (grille.anchors && grille.anchors.defaultTimes) || {};
    let pistes = await lirePistes(page);
    ok(ancres.length === 2 && pistes.length === ancres.length && pistes.map((p) => p.id).join(',') === ancres.map((a) => a.activityId).join(','), '[C] une piste par activite planifiee, dans l ordre du serveur', `${pistes.map((p) => p.id).join(', ')} / ${ancres.map((a) => a.activityId).join(', ')}`);
    ecarts = [];
    ancres.forEach((a, i) => {
      const p = pistes[i] || { chips: [] };
      if (p.chips.length !== a.times.length) ecarts.push(`${a.activityId}: ${p.chips.length} puces pour ${a.times.length} heures`);
      a.times.forEach((t, k) => {
        const c = p.chips[k] || {};
        if (c.t !== t.time) ecarts.push(`${a.activityId} ${t.time}: puce ${c.t}`);
        const okT = t.ok !== false;
        if (c.ok !== okT) ecarts.push(`${a.activityId} ${t.time}: ok=${c.ok} attendu ${okT}`);
        if (!okT && (c.reason !== (t.reason || '') || c.titre !== (t.reason || 'Indisponible') || !c.mot)) ecarts.push(`${a.activityId} ${t.time}: raison « ${c.reason} » / titre « ${c.titre} » / mot « ${c.mot} » vs « ${t.reason} »`);
      });
      if (p.count !== Math.max(1, Number(a.count) || 1)) ecarts.push(`${a.activityId}: count ${p.count} vs ${a.count}`);
    });
    ok(ecarts.length === 0, '[C] TOUTES les heures de chaque piste, dans l ordre, refusees ou non comme le serveur, avec SA raison', ecarts.slice(0, 4).join(' ; ') || `${ancres.map((a) => `${a.activityId} ${a.times.length} h (${a.times.filter((t) => t.ok === false).length} refusees)`).join(', ')}`);
    ok(ancres.some((a) => a.times.some((t) => t.ok === false)), '[C] au moins une heure refusee existe ce jour-la (sinon la propriete des raisons n est pas exercee)');
    ok(pistes.every((p, i) => p.chips.filter((c) => c.proposed).map((c) => c.t).join(',') === (defauts[ancres[i].activityId] || '')), '[C] sans heure posee, chaque piste marque « propose » l heure par defaut du serveur', JSON.stringify(defauts));
    ok(pistes.every((p) => !p.chips.some((c) => c.on) && !p.reset), '[C] sans heure posee, aucune puce active, aucun « laisser l equipe placer »');
    const oracle0 = lignePlan(grille);
    let ecran = await lireEcranPlan(page);
    ok(planCorrespond(ecran, oracle0) && ecran.garder, '[C] le plan affiche est celui de la reponse sans heure posee (arrivee, blocs, fin, prix) et « Garder » est actif', `${ecran && ecran.texte}`);
    ok(await page.evaluate(() => document.querySelector('#keepLabel').textContent.trim() === 'Garder ces horaires'), '[C] le bouton dit « Garder ces horaires »');
    // POSER UNE HEURE DE BOWLING : la 3e heure possible, differente du defaut.
    const bowling = ancres.find((a) => a.activityId === 'bowling');
    const heuresOk = bowling.times.filter((t) => t.ok !== false).map((t) => t.time);
    const choix = heuresOk.find((t) => t !== defauts.bowling && heuresOk.indexOf(t) >= 2) || heuresOk[heuresOk.length - 1];
    await page.click(`#hourZone .fg-track[data-activity="bowling"] .fg-chip[data-time="${choix}"]`);
    ok(await attendre(page, (t) => { const c = document.querySelector(`#hourZone .fg-track[data-activity="bowling"] .fg-chip[data-time="${t}"]`); return c && c.classList.contains('is-on') && document.querySelector('#planZone .fg-plan') && !document.querySelector('#planZone .fg-loading'); }, 25000, choix), '[C] poser une heure de bowling la marque et recompose le plan', choix);
    const pref = { bowling: choix };
    q.set('preferredTimes', JSON.stringify(pref));
    const avecBowling = await lireJson(`${BASE_URL}/api/public-availability?${q}`);
    const oracle1 = lignePlan(avecBowling);
    ecran = await lireEcranPlan(page);
    ok(planCorrespond(ecran, oracle1), '[C] le plan affiche est celui de la route preferredTimes={bowling}', `${ecran && ecran.texte} / oracle ${JSON.stringify(oracle1 && { a: oracle1.arrivee, b: oracle1.blocs, f: oracle1.fin })}`);
    pistes = await lirePistes(page);
    const laserOracle = (avecBowling.anchors.activities || []).find((a) => a.activityId === 'laser_game');
    const laserEcran = pistes.find((p) => p.id === 'laser_game');
    ok(Boolean(laserOracle) && laserEcran.chips.map((c) => `${c.t}${c.ok ? '' : '!'}`).join(',') === laserOracle.times.map((t) => `${t.time}${t.ok === false ? '!' : ''}`).join(','), '[C] la piste du laser est recalculee autour de l heure de bowling posee (memes refus que le serveur)', `${laserEcran.chips.filter((c) => !c.ok).length} refusees cote ecran, ${laserOracle ? laserOracle.times.filter((t) => t.ok === false).length : '?'} cote serveur`);
    ok(laserEcran.chips.filter((c) => c.proposed).map((c) => c.t).join(',') === (avecBowling.anchors.defaultTimes.laser_game || ''), '[C] le laser propose l heure que le serveur a composee autour du bowling', avecBowling.anchors.defaultTimes.laser_game);
    ok(pistes.find((p) => p.id === 'bowling').reset && !laserEcran.reset, '[C] « laisser l equipe placer » n apparait que sur la piste posee');
    ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('fg-chip') && document.activeElement.classList.contains('is-on')), '[C] apres le re-rendu, la puce posee garde le focus (clavier)');
    // LIRE UNE RAISON : une heure refusee, touchee, l explique.
    const refusee = laserEcran.chips.find((c) => !c.ok) || pistes.find((p) => p.id === 'bowling').chips.find((c) => !c.ok);
    const pisteRefusee = laserEcran.chips.some((c) => !c.ok) ? 'laser_game' : 'bowling';
    ok(Boolean(refusee), '[C] une heure refusee existe apres la pose (la piste du laser chevauche le bowling)', refusee ? `${pisteRefusee} ${refusee.t} « ${refusee.reason} »` : 'aucune');
    if (refusee) {
      await page.click(`#hourZone .fg-track[data-activity="${pisteRefusee}"] .fg-chip[data-time="${refusee.t}"]`);
      const why = await page.evaluate((id) => { const w = document.querySelector(`#hourZone .fg-track[data-activity="${id}"] .fg-why`); return { hidden: w.hidden, texte: w.textContent.replace(/\s+/g, ' ').trim(), asked: document.querySelectorAll('.fg-chip.is-asked').length }; }, pisteRefusee);
      ok(!why.hidden && why.texte === `${refusee.t} : ${refusee.reason}` && why.asked === 1, '[C] toucher une heure refusee affiche « <heure> : <raison du moteur> », mot pour mot', why.texte);
      ok(await page.evaluate((t) => { const c = document.querySelector(`#hourZone .fg-track[data-activity="bowling"] .fg-chip[data-time="${t}"]`); return c && c.classList.contains('is-on'); }, choix), '[C] et ne change rien a l heure posee');
    }
    // DEUX PARTIES DE LASER SUR DEUX HEURES.
    const laserOk = laserEcran.chips.filter((c) => c.ok).map((c) => c.t);
    const l1 = laserOk[Math.min(2, laserOk.length - 1)];
    const l2 = laserOk.find((t) => t > l1 && laserOk.indexOf(t) >= laserOk.indexOf(l1) + 2) || laserOk[laserOk.length - 1];
    await page.click(`#hourZone .fg-track[data-activity="laser_game"] .fg-chip[data-time="${l1}"]`);
    ok(await attendre(page, (t) => { const c = document.querySelector(`#hourZone .fg-track[data-activity="laser_game"] .fg-chip[data-time="${t}"]`); return c && c.classList.contains('is-on') && document.querySelector('#planZone .fg-plan') && !document.querySelector('#planZone .fg-loading'); }, 25000, l1), '[C] premiere partie de laser posee', l1);
    await page.click(`#hourZone .fg-track[data-activity="laser_game"] .fg-chip[data-time="${l2}"]`);
    ok(await attendre(page, (t) => { const on = Array.from(document.querySelectorAll('#hourZone .fg-track[data-activity="laser_game"] .fg-chip.is-on')).map((c) => c.dataset.time); return on.length === 2 && on.indexOf(t) >= 0 && document.querySelector('#planZone .fg-plan') && !document.querySelector('#planZone .fg-loading'); }, 25000, l2), '[C] deuxieme partie posee : deux puces actives sur la piste du laser', `${l1}, ${l2}`);
    q.set('preferredTimes', JSON.stringify({ bowling: choix, laser_game: l1 }));
    q.set('laserGameTimes', JSON.stringify([l1, l2]));
    const avecLaser = await lireJson(`${BASE_URL}/api/public-availability?${q}`);
    const oracle2 = lignePlan(avecLaser);
    ecran = await lireEcranPlan(page);
    ok(Boolean(oracle2) && planCorrespond(ecran, oracle2) && oracle2.blocs.filter((b) => b.id === 'laser_game').length === 2, '[C] le plan est celui de la route preferredTimes + laserGameTimes, avec DEUX blocs de laser', `${ecran && ecran.texte}`);
    // LAISSER L EQUIPE PLACER LE LASER : la pose s efface, la proposition revient.
    await page.click('#hourZone [data-reset="laser_game"]');
    ok(await attendre(page, () => !document.querySelector('#hourZone .fg-track[data-activity="laser_game"] .fg-chip.is-on') && document.querySelector('#hourZone .fg-track[data-activity="laser_game"] .fg-chip.is-proposed') && document.querySelector('#planZone .fg-plan') && !document.querySelector('#planZone .fg-loading'), 25000), '[C] « laisser l equipe placer » efface les parties posees et remet la proposition');
    q.delete('laserGameTimes');
    q.set('preferredTimes', JSON.stringify(pref));
    const retenu = await lireJson(`${BASE_URL}/api/public-availability?${q}`);
    const oracleFinal = lignePlan(retenu);
    ecran = await lireEcranPlan(page);
    ok(planCorrespond(ecran, oracleFinal) && ecran.garder, '[C] le plan revient a celui de preferredTimes={bowling} et « Garder » est actif', `${ecran && ecran.texte}`);
    ok(Number(retenu.price) > 0 && ecran.prix === euros(retenu.price), '[C] le prix de la ligne est le prix de la reponse', `${ecran.prix} vs ${retenu.price}`);

    // =====================================================================
    console.log('');
    console.log('[D] CONTACT');
    // =====================================================================
    await page.click('#goContact');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 5000), '[D] l ecran du contact est actif');
    const rappel = await page.evaluate(() => document.querySelector('#recallLine').textContent.replace(/\s+/g, ' ').trim());
    ok(rappel.indexOf('6 personnes') >= 0 && rappel.indexOf(oracleFinal.arrivee ? `arrivée ${oracleFinal.arrivee}` : oracleFinal.time) >= 0, '[D] le rappel porte groupe et heure d arrivee du plan', rappel);
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
      items: Array.from(document.querySelectorAll('.fg-recap__item')).map((n) => ({ nom: n.querySelector('.fg-recap__name').textContent.trim(), detail: (n.querySelector('.fg-recap__detail') || {}).textContent || '', aside: n.querySelector('.fg-recap__aside').textContent.replace(/\s+/g, ' ').trim() })),
      lignes: Array.from(document.querySelectorAll('.fg-recap__row')).map((n) => n.textContent.replace(/\s+/g, ' ').trim()),
      tag: (document.querySelector('#recap .fg-tag') || {}).textContent || '',
    }));
    ok(recap.total === Number(retenu.price), '[E] le total du recap EST le prix de la reponse de disponibilite', `${recap.total} vs ${retenu.price}`);
    ok(await attendre(page, (attendu) => document.querySelector('#totalAmount').textContent.trim() === attendu, 3000, euros(retenu.price)), '[E] le compteur finit exactement sur le montant', euros(retenu.price));
    // « Paiement<br>sur place » : le saut de ligne ne laisse aucune espace dans textContent.
    ok(/Paiement\s*sur place/.test(recap.paiement), '[E] « Paiement sur place » est annonce', recap.paiement);
    ok(recap.items.map((i) => i.nom).join(' + ') === 'Bowling + Laser Game' && /2 parties/.test(recap.items[1].detail), '[E] les deux activites sont listees, le laser avec ses 2 parties', JSON.stringify(recap.items));
    ok(recap.items.every((it, i) => it.aside.indexOf(`Début${oracleFinal.blocs.find((b) => b.id === (i === 0 ? 'bowling' : 'laser_game')).t}`) >= 0), '[E] chaque activite porte l heure de debut du plan serveur', recap.items.map((i) => i.aside).join(' | '));
    ok(recap.lignes[0] && recap.lignes[0].indexOf(String(Number(mock.DATE.slice(8, 10)))) >= 0 && recap.lignes[1] === '6 personnes', '[E] date et groupe en tete', recap.lignes.join(' | '));
    ok(plat(recap.tag) === plat(jourMock && jourMock.holiday ? jourMock.holiday.label : ''), '[E] l etiquette ferie/conge du jour n apparait que si le calendrier la porte', recap.tag || 'aucune, comme le calendrier');
    await page.click('#confirmBtn');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="fin"].is-active'), 10000), '[E] la confirmation mene a l ecran final');
    const corps = mock.dernierePose.body || {};
    const fin = await page.evaluate(() => document.querySelector('#finBody').textContent.replace(/\s+/g, ' ').trim());
    ok(new RegExp(`Réservation n° ${corps.__id || '\\d+'}`).test(fin) && fin.indexOf('qa@example.com') >= 0, '[E] l ecran final cite le numero rendu et l adresse', fin.slice(0, 120));
    ok(await page.evaluate(() => document.querySelectorAll('#finBurst i').length === 14), '[E] la gerbe d etincelles est posee (14 points)');
    ok(corps.centerId === 'libramont' && corps.type === 'visite' && corps.date === mock.DATE && corps.pax === 6, '[E] le POST porte centre, type visite, date, groupe', JSON.stringify({ centerId: corps.centerId, type: corps.type, date: corps.date, pax: corps.pax }));
    ok(Array.isArray(corps.program) && corps.program.map((p) => p.activityId).join(',') === 'bowling,laser_game' && corps.program[0].duration === 1 && corps.program[1].games === 2, '[E] le programme envoye est celui choisi (bowling 1 h, laser 2 parties)', JSON.stringify(corps.program));
    const heuresPlan = (oracleFinal.opsPlan.anchorPlan && oracleFinal.opsPlan.anchorPlan.times) || {};
    ok(corps.startTime === oracleFinal.time && corps.preference && corps.preference.preferredTimes && corps.preference.preferredTimes.bowling === choix && corps.preference.preferredTimes.laser_game === heuresPlan.laser_game && Array.isArray(corps.preference.laserGameTimes) && corps.preference.laserGameTimes.length === 0, '[E] heure du creneau, heure posee et heure composee par le serveur voyagent avec la demande ; aucune partie posee apres l effacement', `${corps.startTime} / ${JSON.stringify(corps.preference && corps.preference.preferredTimes)} / parties ${JSON.stringify(corps.preference && corps.preference.laserGameTimes)}`);
    ok(corps.opsPlan && JSON.stringify(corps.opsPlan.resourceBlocks) === JSON.stringify(oracleFinal.opsPlan.resourceBlocks), '[E] le plan envoye est celui de la reponse retenue');
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
    const bandeau = await f.evaluate(() => { const t = document.querySelector('.fg-top'); const r = t.getBoundingClientRect(); return { h: Math.round(r.height), d: getComputedStyle(t).display, rideau: getComputedStyle(document.querySelector('.fg-curtain')).display }; });
    ok(bandeau.h === 0 && bandeau.d === 'none' && bandeau.rideau === 'none', '[F] notre bandeau (logo, « Reserver ») et le rideau sont absents chez le client', JSON.stringify(bandeau));
    const accord = async () => {
      const dedans = await f.evaluate(() => Math.max(document.body.scrollHeight, document.body.offsetHeight));
      const dehors = await pageHote.evaluate(() => parseInt(document.querySelector('.bloc iframe').style.height, 10));
      return { dedans, dehors, ecart: Math.abs(dedans - dehors) };
    };
    let a = await accord();
    ok(a.ecart <= 8, '[F] la hauteur du cadre suit le corps du formulaire (ecart <= 8 px)', JSON.stringify(a));
    await f.click('#goActivities');
    ok(await attendre(pageHote, () => window.__ecrans > 0, 5000), '[F] changer d ecran previent l hote (pinlane:screen)');
    ok(await (async () => {
      // La hauteur se remesure apres la transition (600 ms au plus).
      const butoir = Date.now() + 4000;
      while (Date.now() < butoir) { a = await accord(); if (a.ecart <= 8 && await f.evaluate(() => !document.querySelector('.fg-scene.is-entering'))) return true; await dormir(120); }
      return false;
    })(), '[F] apres le changement d ecran, le cadre a la hauteur du nouvel ecran', JSON.stringify(a));
    // Le parcours entier depuis le cadre : bowling seul, 4 personnes.
    await f.click('#gridAct .fg-card[data-activity="bowling"]');
    await f.click('#goHours');
    ok(await attendre(f, () => document.querySelectorAll('#hourZone .fg-track').length === 1 && document.querySelectorAll('#hourZone .fg-chip:not(.is-off)').length > 0, 25000), '[F] une seule piste (bowling seul) se charge dans le cadre');
    ok(await attendre(f, () => !document.querySelector('#goContact').disabled, 25000), '[F] le plan par defaut du serveur active « Garder » sans rien poser');
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
    await pageTel.click('#dayBtn');
    ok(await attendre(pageTel, () => !document.querySelector('#dayList').hidden && document.querySelector('#dayList').getBoundingClientRect().right <= document.documentElement.clientWidth, 3000), '[G] ecran 1 : la liste des jours tient dans l ecran');
    await pageTel.click(`#dayList .fg-day__opt[data-date="${mock.DATE}"]`);
    await pageTel.click('#goActivities');
    ok(await attendre(pageTel, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000), '[G] ecran 2 atteint');
    m = await mesure();
    ok(m.deborde <= 1 && m.btnDedans, '[G] ecran 2 : aucun defilement horizontal, bouton dans l ecran', JSON.stringify(m));
    await pageTel.click('#gridAct .fg-card[data-activity="bowling"]');
    await pageTel.click('#gridAct .fg-card[data-activity="laser_game"]');
    await pageTel.click('#goHours');
    // La mesure attend la fin du glissement d ecran : pendant la transition,
    // la scene entrante est decalee de 48 px et compte dans scrollWidth.
    ok(await attendre(pageTel, () => document.querySelectorAll('#hourZone .fg-track').length === 2 && document.querySelector('#planZone .fg-plan') && !document.querySelector('.fg-scene.is-entering'), 25000), '[G] ecran 3 : les deux pistes et le plan se chargent, transition finie');
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
    const anims = await pageCalme.evaluate(() => Array.from(document.querySelectorAll('.fg-scene.is-active .fg-title .w > span, .fg-scene.is-active .fg-art img, .fg-scene.is-active .fg-rise, .fg-curtain, .fg-glow i')).map((el) => getComputedStyle(el).animationName).filter((n) => n && n !== 'none'));
    ok(anims.length === 0, '[H] avec prefers-reduced-motion, plus aucune animation (rideau et halos compris)', anims.join(', ') || 'aucune');
    ok(await pageCalme.evaluate(() => getComputedStyle(document.querySelector('.fg-curtain')).visibility === 'hidden'), '[H] sans animation, le rideau n existe pas (invisible par defaut)');
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
