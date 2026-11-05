'use strict';
// LE FORMULAIRE DANS LA LANGUE DES HEURES (Ansar, 2026-11-05 : « ameliorer lesthetique et la facilite et la rapidite [...] un peu
// comme ta ameliorer pour les heures [...] prcq ca fait trop ia les autres »). Banc local, vrai code, base en memoire, rien ne part
// en ligne. Ce gate touche pour de vrai (page.tap, page.click) et lit ce qui se voit :
//   - les raccourcis : un toucher sur un jour, un toucher sur un groupe courant, le calendrier et le compteur restent la ;
//   - les rangees : la vraie photo chargee (naturalWidth), aucun pictogramme, le plein violet quand c est choisi ;
//   - le plat : ni filet, ni grand arrondi, ni pictogramme de decor sur les blocs ;
//   - la vitesse : l ecran suivant se touche vite, plus aucune entree en cascade ; aucune police demandee a un autre serveur ;
//   - rien ne deborde, de 320 a 1280 px, aux deux centres.
// Contre-preuve : `--mutate` rejoue tout sur la feuille d avant cette passe, servie a la place de la vraie, et compte ce qui rougit.
const fs = require('fs');
const path = require('path');
const { chargerReglages, creerServeur } = require('./banc/banc-complet.js');
const { lancer, attendre } = require('./banc/banc.js');
const PORT = Number(process.env.PINLANE_VISUEL_PORT || 4421);
const BASE = `http://127.0.0.1:${PORT}`;
const MUTER = process.argv.includes('--mutate');
const VIOLET = 'rgb(148, 66, 146)';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0; let oks = 0; const rouges = [];
function ok(c, nom, detail) {
  if (c) { oks += 1; if (!MUTER) console.log(`ok    ${nom}${detail ? `  ${detail}` : ''}`); return; }
  echecs += 1; rouges.push(nom);
  console.log(`FAIL  ${nom}${detail ? `  ${detail}` : ''}`);
}
const FEUILLE = fs.readFileSync(path.join(__dirname, '..', 'assets', 'fungalaxy-booking.css'), 'utf8').replace(/\r\n/g, '\n');
const REPERE = FEUILLE.indexOf('/* =============================================================================\n   TOUT LE FORMULAIRE DANS LA LANGUE DES HEURES');

async function ouvrir(b, centre, w, h = 844) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 700, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(9000);
  page.__erreurs = []; page.__polices = [];
  page.on('pageerror', (e) => page.__erreurs.push(String(e.message || e)));
  page.on('request', (r) => { if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) page.__polices.push(r.url()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  if (MUTER) await page.route(/fungalaxy-booking\.css/, (r) => r.fulfill({ contentType: 'text/css', body: FEUILLE.slice(0, REPERE) }));
  await page.goto(`${BASE}/fungalaxy/${centre}`, { waitUntil: 'networkidle', timeout: 45000 });
  await attendre(page, () => document.body.classList.contains('is-ready') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
  return { ctx, page, toucher: (sel) => (w < 700 ? page.tap(sel) : page.click(sel)) };
}
const deborde = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const plat = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length).map((e) => { const c = getComputedStyle(e); return { rayon: parseFloat(c.borderTopLeftRadius), filet: parseFloat(c.borderTopWidth) > 0 && c.borderTopColor !== 'rgba(0, 0, 0, 0)' }; }), sel);
const tousPlats = async (page, sel, nom, rayon = 6) => {
  const l = await plat(page, sel);
  ok(l.length > 0 && l.every((x) => x.rayon <= rayon && !x.filet), `${nom} : un bloc plat, ni filet ni grand arrondi`, JSON.stringify(l[0] || 'absent'));
};
const decors = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(`${s} svg`)].filter((e) => e.getClientRects().length && !e.closest('.fg-info-btn, .fg-btn, .fg-recall__toggle, .fg-plus__voir')).length, sel);

async function parcours(b, centre, w) {
  const q = `${centre} ${w}`;
  const { ctx, page, toucher } = await ouvrir(b, centre, w);
  // --- Le jour : trois tuiles et le calendrier.
  const tuiles = await page.$$('.fg-jour');
  ok(tuiles.length === 3, `[jour] ${q} : les trois prochains jours ouverts, d un toucher`, String(tuiles.length));
  if (tuiles.length === 3) {
    const cible = await tuiles[1].getAttribute('data-jour');
    const avant = await page.textContent('#dayLabel');
    await toucher(`.fg-jour[data-jour="${cible}"]`);
    await dormir(120);
    const lu = await page.evaluate((c) => ({ on: document.querySelector(`.fg-jour[data-jour="${c}"]`).classList.contains('is-on'), presse: document.querySelector(`.fg-jour[data-jour="${c}"]`).getAttribute('aria-pressed'), fond: getComputedStyle(document.querySelector(`.fg-jour[data-jour="${c}"]`)).backgroundColor, label: document.querySelector('#dayLabel').textContent }), cible);
    ok(lu.on && lu.presse === 'true' && lu.label !== avant, `[jour] ${q} : le toucher choisit ce jour, sa tuile est pleine`, JSON.stringify(lu));
  }
  const autre = await page.evaluate(() => { const r = document.querySelector('#dayBtn').getBoundingClientRect(); const t = document.querySelector('.fg-jour').getBoundingClientRect(); return { memeLigne: Math.abs(r.top - t.top) < 1, h: Math.round(r.height), txt: document.querySelector('#dayBtn').innerText.replace(/\s+/g, ' ').trim() }; });
  ok(autre.memeLigne && autre.h >= 44 && /autre/i.test(autre.txt), `[jour] ${q} : « Autre date » est la quatrieme tuile, assez grande`, JSON.stringify(autre));
  await toucher('#dayBtn');
  await attendre(page, () => !document.querySelector('#dayPop').hidden && document.querySelectorAll('#calGrid .fg-cal__day:not(.is-off)').length > 3, 6000);
  await toucher('#calNext');
  await attendre(page, () => document.querySelectorAll('#calGrid .fg-cal__day:not(.is-off)').length > 3, 6000);
  await page.click('#calGrid .fg-cal__day:not(.is-off)');
  await dormir(200);
  const loin = await page.evaluate(() => ({ plein: document.querySelector('#dayBtn').classList.contains('is-on'), txt: document.querySelector('#dayBtn').innerText.replace(/\s+/g, ' ').trim(), cal: document.querySelector('#dayPop').hidden }));
  ok(loin.plein && !/autre/i.test(loin.txt) && loin.cal, `[jour] ${q} : une date du calendrier se lit sur sa tuile, pleine`, JSON.stringify(loin));
  // --- Le groupe : les tuiles et le compteur disent la meme chose.
  await toucher('.fg-pax[data-pax="8"]');
  await dormir(120);
  const g = await page.evaluate(() => ({ v: document.querySelector('#paxInput').value, on: [...document.querySelectorAll('.fg-pax.is-on')].map((x) => x.dataset.pax).join() }));
  ok(g.v === '8' && g.on === '8', `[groupe] ${q} : un toucher sur 8 pose 8 joueurs`, JSON.stringify(g));
  await toucher('#paxMinus');
  await dormir(120);
  const g2 = await page.evaluate(() => ({ v: document.querySelector('#paxInput').value, on: document.querySelectorAll('.fg-pax.is-on').length }));
  ok(g2.v === '7' && g2.on === 0, `[groupe] ${q} : le compteur reste juste, aucune tuile pleine a 7`, JSON.stringify(g2));
  await toucher('.fg-pax[data-pax="8"]');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.fg-top__cta')).display === 'none'), `[haut] ${q} : plus de bouton « Reserver » qui emmene ailleurs`);
  ok(await deborde(page) <= 0, `[largeur] ${q} : le premier ecran ne deborde pas`, String(await deborde(page)));
  // --- L ecran suivant : pas de cascade, bouton utilisable vite.
  const t0 = Date.now();
  await toucher('#goActivities');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000);
  const delai = Date.now() - t0;
  ok(delai < 450, `[vitesse] ${q} : l ecran suivant est la en moins de 450 ms`, `${delai} ms`);
  const cascade = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.getComputedTiming && a.effect.getComputedTiming().iterations !== Infinity && /fg-word|fg-rise|fg-settle|fg-drift|fg-slide/.test(a.animationName || '')).map((a) => a.animationName));
  ok(cascade.length === 0, `[vitesse] ${q} : plus de mots qui montent ni de cascade`, cascade.join());
  // --- Les rangees.
  await dormir(500);
  const rangs = await page.evaluate(async () => {
    const cartes = [...document.querySelectorAll('#gridAct .fg-grid__item')];
    for (const c of cartes) { c.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 60)); }
    await new Promise((r) => setTimeout(r, 500));
    return { n: cartes.length, pictos: document.querySelectorAll('#gridAct .fg-card__icon').length, photos: cartes.map((c) => { const i = c.querySelector('.fg-card__photo img'); return i ? { w: i.naturalWidth, vu: i.getClientRects().length > 0 } : null; }), police: getComputedStyle(document.querySelector('#gridAct .fg-card__name')).fontFamily };
  });
  ok(rangs.n >= 4 && rangs.pictos === 0, `[activites] ${q} : aucun pictogramme`, `${rangs.n} rangees`);
  ok(rangs.photos.every((p) => p && p.w > 0 && p.vu), `[activites] ${q} : chaque rangee montre sa vraie photo, chargee`, JSON.stringify(rangs.photos.filter((p) => !p || !p.w).length));
  ok(/Anton/.test(rangs.police), `[activites] ${q} : le nom en typo d affiche`, rangs.police);
  await tousPlats(page, '#gridAct .fg-card', `[activites] ${q}`);
  await tousPlats(page, '.fg-tab', `[activites] ${q} onglets`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#gridAct .fg-card[data-activity="bowling"]');
  await dormir(320);
  const on = await page.evaluate(() => { const c = document.querySelector('#gridAct .fg-card[data-activity="bowling"]'); const pill = document.querySelector('#gridAct .fg-grid__item[data-activity="bowling"] .fg-pill'); return { fond: getComputedStyle(c).backgroundColor, coche: c.getAttribute('aria-checked'), pill: pill ? pill.getBoundingClientRect().height : 0, ombre: pill ? getComputedStyle(pill).boxShadow : '' }; });
  ok(on.fond === VIOLET && on.coche === 'true' && on.pill >= 44, `[activites] ${q} : toucher la rangee la choisit, un aplat plein, ses options en tuiles`, JSON.stringify(on));
  ok(await deborde(page) <= 0, `[largeur] ${q} : les activites ne debordent pas`, String(await deborde(page)));
  // --- Les formules : une fois les conditions communes, ce qui se reserve devant.
  await toucher('#tabFor');
  await dormir(500);
  const fam = await page.evaluate(() => { const s = [...document.querySelectorAll('.fg-fam')]; return s.map((x) => { const c = [...x.querySelectorAll('.fg-card--formule')]; const etats = c.map((k) => k.classList.contains('is-refus')); return { titre: x.querySelector('.fg-fam__title').textContent, regles: (x.querySelector('.fg-fam__regles') || { textContent: '' }).textContent, n: c.length, ordre: etats.indexOf(true) < 0 || etats.lastIndexOf(false) < etats.indexOf(true), fete: x.classList.contains('is-fete') && getComputedStyle(x.querySelector('.fg-fam__title'), '::after').backgroundImage.includes('svg'), repete: x.querySelectorAll('.fg-for__rules i').length }; }); });
  const anniv = fam.find((f) => /anniv/i.test(f.titre));
  ok(Boolean(anniv) && anniv.fete && /personnes/.test(anniv.regles), `[formules] ${q} : les conditions et les fanions, une fois, sur le titre`, JSON.stringify(anniv));
  ok(fam.every((f) => f.ordre), `[formules] ${q} : ce qui se reserve ce jour-la passe devant`);
  ok(await page.evaluate(() => [...document.querySelectorAll('.fg-card--formule.has-photo:not(.is-refus) .fg-for__photo')].every((p) => p.getBoundingClientRect().width <= 90)), `[formules] ${q} : la photo a gauche, nette, pas sous un voile`);
  await tousPlats(page, '.fg-card--formule', `[formules] ${q}`);
  ok(await deborde(page) <= 0, `[largeur] ${q} : les formules ne debordent pas`, String(await deborde(page)));
  ok(page.__polices.length === 0, `[vitesse] ${q} : aucune police demandee a un autre serveur`, page.__polices[0] || '');
  ok(await page.evaluate(() => document.fonts.check('600 16px Montserrat') && document.fonts.check('16px Anton')), `[vitesse] ${q} : Montserrat et Anton servies par le centre`);
  ok(page.__erreurs.length === 0, `[erreurs] ${q} : aucune erreur de page`, page.__erreurs[0] || '');
  await ctx.close();
}

// Le reste du parcours, jusqu a la confirmation, une fois par centre.
async function jusquAuBout(b, centre, w) {
  const q = `${centre} ${w}`;
  const { ctx, page, toucher } = await ouvrir(b, centre, w);
  await toucher('#dayBtn');
  await attendre(page, () => !document.querySelector('#dayPop').hidden && document.querySelectorAll('#calGrid .fg-cal__day:not(.is-off)').length > 3, 6000);
  await toucher('#calNext');
  await attendre(page, () => document.querySelectorAll('#calGrid .fg-cal__day:not(.is-off)').length > 3, 6000);
  await page.click('#calGrid .fg-cal__day:not(.is-off)');
  await dormir(200);
  await toucher('#goActivities');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000);
  await page.click('#gridAct .fg-card[data-activity="bowling"]');
  await dormir(300);
  await toucher('#goHours');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('#hourZone').classList.contains('is-busy') && document.querySelector('#planZone .fg-visit, #planZone .fg-notice'), 20000);
  await dormir(400);
  await toucher('#goContact');
  await attendre(page, () => { const v = document.querySelector('#vitrine'); return (v && !v.hidden) || document.querySelector('.fg-scene[data-scene="contact"].is-active'); }, 12000);
  // --- Les coordonnees.
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 12000);
  await page.mouse.move(1, 1);
  await dormir(300);
  await tousPlats(page, '#contactForm .fg-input:not(:focus)', `[coordonnees] ${q} champs`);
  await tousPlats(page, '.fg-occasion', `[coordonnees] ${q} occasions`);
  await tousPlats(page, '.fg-scene[data-scene="contact"] .fg-hold', `[coordonnees] ${q} horaires gardes`);
  await tousPlats(page, '.fg-recall', `[coordonnees] ${q} rappel`);
  ok(await decors(page, '#contactForm .fg-occasions') === 0, `[coordonnees] ${q} : les occasions sans pictogramme`);
  const noms = await page.evaluate(() => { const a = document.querySelector('#cPrenom').getBoundingClientRect(); const b2 = document.querySelector('#cNom').getBoundingClientRect(); const m = document.querySelector('#cEmail').getBoundingClientRect(); return { memeLigne: Math.abs(a.top - b2.top) < 1, bord: Math.abs(b2.right - m.right) < 1, l: Math.round(a.width) }; });
  ok(noms.memeLigne && noms.bord && noms.l >= 120, `[coordonnees] ${q} : prenom et nom sur une ligne, a la largeur du reste`, JSON.stringify(noms));
  ok(await deborde(page) <= 0, `[largeur] ${q} : les coordonnees ne debordent pas`, String(await deborde(page)));
  // Une erreur reste visible : le filet rouge revient sur le champ refuse.
  await page.click('#goRecap');
  await dormir(300);
  const err = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('#cPrenom')); return { couleur: c.borderTopColor, msg: document.querySelector('#ePrenom').textContent }; });
  ok(err.couleur !== 'rgba(0, 0, 0, 0)' && /pr.nom/i.test(err.msg), `[coordonnees] ${q} : un champ refuse se voit`, JSON.stringify(err));
  await page.fill('#cPrenom', 'Essai'); await page.fill('#cNom', 'Banc'); await page.fill('#cEmail', 'qa@example.com'); await page.fill('#cTel', '0470000000');
  await page.click('.fg-occasion[data-occasion="amis"]');
  await page.click('#consentWrap');
  await page.click('#goRecap');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="recap"].is-active') && !document.querySelector('.fg-scene.is-entering'), 12000);
  await dormir(500);
  await attendre(page, () => { const v = document.querySelector('#vitrine'); return !v || !v.hasAttribute('data-attendue'); }, 4000);
  // --- La fenetre des offres.
  if (await page.evaluate(() => { const v = document.querySelector('#vitrine'); return Boolean(v && !v.hidden); })) {
    await tousPlats(page, '.fg-vitrine__panneau', `[offres] ${q} fenetre`);
    await tousPlats(page, '.fg-vitrine__carte', `[offres] ${q} cartes`);
    ok(await page.evaluate(() => [...document.querySelectorAll('.fg-vitrine__nom svg, .fg-vitrine__raison svg')].every((s) => !s.getClientRects().length)), `[offres] ${q} : aucun pictogramme a cote des noms`);
    await page.click('#vitrine .fg-vitrine__non');
    await dormir(300);
  }
  // --- Le recapitulatif.
  await tousPlats(page, '#recap', `[recap] ${q}`);
  ok(await decors(page, '#recap') === 0, `[recap] ${q} : aucun pictogramme`, String(await decors(page, '#recap')));
  const prog = await page.evaluate(() => { const h = document.querySelector('#recap .fg-recap__aside b'); const n = document.querySelector('#recap .fg-recap__name'); const p = document.querySelector('#recap .fg-total__amount'); const a = h.getBoundingClientRect(); const b2 = n.getBoundingClientRect(); return { aGauche: a.right <= b2.left, memeHaut: Math.abs(a.top - b2.top) < 6, heure: getComputedStyle(h).fontFamily, total: getComputedStyle(p).fontFamily, seps: [...document.querySelectorAll('#recap .fg-recap__sep')].filter((s) => parseFloat(getComputedStyle(s).borderTopWidth) > 0 || getComputedStyle(s).backgroundColor !== 'rgba(0, 0, 0, 0)').length }; });
  ok(prog.aGauche && prog.memeHaut && /Anton/.test(prog.heure) && /Anton/.test(prog.total) && prog.seps === 0, `[recap] ${q} : un programme, l heure a gauche, sans trait entre les lignes`, JSON.stringify(prog));
  ok(await page.evaluate(() => { const s = document.querySelector('.fg-confirm__note'); const r = s.getBoundingClientRect(); return r.height > 0 && document.querySelector('#recap .fg-total__pay').getClientRects().length === 0; }), `[recap] ${q} : le paiement sur place se dit une fois`);
  ok(await deborde(page) <= 0, `[largeur] ${q} : le recapitulatif ne deborde pas`, String(await deborde(page)));
  // --- La confirmation, sur le banc (base en memoire, aucun envoi).
  await page.click('#confirmBtn');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="fin"].is-active'), 15000);
  await dormir(400);
  await tousPlats(page, '.fg-done__ticket', `[fin] ${q}`);
  const fin = await page.evaluate(() => ({ confettis: document.querySelectorAll('#finBurst i').length, pictos: [...document.querySelectorAll('.fg-done__row svg')].filter((s) => s.getClientRects().length).length, gauche: getComputedStyle(document.querySelector('.fg-scene[data-scene="fin"] .fg-title')).textAlign }));
  ok(fin.confettis === 0 && fin.pictos === 0 && fin.gauche !== 'center', `[fin] ${q} : ni confettis ni pictogrammes, a gauche comme le reste`, JSON.stringify(fin));
  ok(await deborde(page) <= 0, `[largeur] ${q} : la confirmation ne deborde pas`, String(await deborde(page)));
  ok(page.__erreurs.length === 0, `[erreurs] ${q} : aucune erreur sur tout le parcours`, page.__erreurs[0] || '');
  await ctx.close();
}

(async () => {
  if (REPERE < 0) { console.error('La passe est absente de la feuille.'); process.exit(1); }
  await chargerReglages();
  const serveur = creerServeur();
  await new Promise((r) => serveur.listen(PORT, r));
  const b = await lancer();
  try {
    for (const centre of ['gembloux', 'libramont']) {
      for (const w of [320, 390, 1280]) await parcours(b, centre, w);
    }
    await jusquAuBout(b, 'gembloux', 390);
    await jusquAuBout(b, 'libramont', 320);
    await jusquAuBout(b, 'gembloux', 1280);
  } catch (e) {
    if (!MUTER) throw e;
    echecs += 1; rouges.push(`le parcours s arrete : ${String(e.message).split('\n')[0]}`);
  }
  await b.close();
  serveur.close();
  if (MUTER) {
    // Sur la feuille d avant, ces gardes-la doivent rougir : sinon elles ne mordent pas.
    // Elle arrete le parcours avant les formules : celles-ci ont leurs contre-preuves dans formules-fete-check.
    const attendus = [/\[jour\]/, /\[groupe\]|\[haut\]/, /\[activites\]/];
    const mordent = attendus.filter((re) => rouges.some((r) => re.test(r))).length;
    console.log(`contre-preuve : ${echecs} rouges sur la feuille d avant, ${mordent}/${attendus.length} familles mordent`);
    process.exit(mordent === attendus.length ? 0 : 1);
  }
  console.log(`formulaire-visuel-check: ${echecs ? `${echecs} ROUGE(S)` : 'ALL OK'}, ${oks} ok`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
