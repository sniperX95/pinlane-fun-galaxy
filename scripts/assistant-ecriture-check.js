#!/usr/bin/env node
'use strict';
// LA REPONSE QUI S ECRIT (2026-11-12, Ansar : « réponse moche nul pas d'effet dans ces messages pas
// d'animation »). Le modele envoie souvent sa reponse entiere en une seconde, et elle tombait d un
// bloc. La page l ecrit maintenant a un rythme qu on suit des yeux : un bloc pose ne se refait plus,
// les mots arrivent en fondu, les blocs neufs entrent, la fin attend que le texte soit ecrit, et a la
// fin chaque chiffre prouve recoit son trait dans l ordre de lecture. Sans mouvement, la reponse
// tombe d un coup. Arreter montre tout de suite le texte deja recu.
//
// La vraie page de la console, servie par planning-v3-fixtures, avec un faux flux de l assistant
// qui envoie toute la reponse d un seul morceau.
// Lancement : node scripts/assistant-ecriture-check.js [--contre-preuves]
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FX = require('./planning-v3-fixtures');
const PORT = Number(process.env.PINLANE_ECRITURE_PORT || 5396);
const NAVIGATEUR = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JS = 'assets/pinlane-assistant.js';
const CSS = 'assets/pinlane-assistant.css';

const MUTATIONS = [
  { nom: 'tout-d-un-coup', rouge: '[A] le texte s ecrit au fil, pas d un bloc', editions: [{ fichier: JS, de: '    if (sansMouvement() || document.hidden) { viderPlume(m); return; }', vers: '    { viderPlume(m); return; }' }] },
  { nom: 'fin-sans-attendre', rouge: '[A] le texte s ecrit au fil, pas d un bloc', editions: [{ fichier: JS, de: '        if (ATTENDENT_LE_TEXTE.test(bloc)) await texteEcrit(m);', vers: '' }] },
  { nom: 'zone-refaite', rouge: '[B] un bloc pose ne se refait pas pendant l ecriture', editions: [{ fichier: JS, de: '    poserTexte(zone, m);', vers: '    poserSiChange(zone, htmlTexte(m));' }] },
  { nom: 'sans-fondu', rouge: '[C] les mots arrivent en fondu et les blocs neufs entrent', editions: [{ fichier: CSS, de: '.ast-r-texte .ast-neuf { animation: astMot 420ms ease-out backwards; }', vers: '' }] },
  { nom: 'sans-trait', rouge: '[D] a la fin, chaque chiffre prouve recoit son trait, dans l ordre de lecture', editions: [{ fichier: CSS, de: '.ast-r.vient-d-ecrire .ast-chiffre { animation: astTrait 460ms var(--c-sortie) calc(140ms + min(var(--n, 0), 24) * 40ms) backwards; }', vers: '' }] },
  { nom: 'mouvement-force', rouge: '[E] sans mouvement, la reponse tombe d un coup, sans fondu', editions: [{ fichier: JS, de: '    if (sansMouvement() || document.hidden) { viderPlume(m); return; }', vers: '    if (document.hidden) { viderPlume(m); return; }' }] },
  { nom: 'arret-sans-texte', rouge: '[F] arreter montre tout de suite le texte deja recu', editions: [{ fichier: JS, de: "    coupure.signal.addEventListener('abort', () => viderPlume(reponse));", vers: '' }] },
  { nom: 'hauteur-d-un-coup', rouge: '[G] la reponse grandit en glissant, sans saut de ligne', editions: [{ fichier: JS, de: "    suivreLaHauteur(zone, m.statut === 'cours' && Boolean(m.texte));\n", vers: '' }] },
  { nom: 'hauteur-gardee', rouge: '[G] a la fin, la reponse rend sa hauteur a son contenu', editions: [{ fichier: JS, de: '      if (!s.enCours) lacherLaHauteur(zone, s);', vers: '' }] },
];

// Une reponse de quatre paragraphes, envoyee d un seul morceau, avec trois chiffres prouves.
const TEXTE = [
  'Le samedi est plein et la semaine reste vide. Deux demandes de groupe attendent une réponse.',
  'Sur les trois derniers mois, il y a 8 réservations pour 1 098 € [S1]. À venir, 13 réservations sont déjà posées pour 2 725 € [S1]. Le mardi et le mercredi n’ont presque rien, alors que le samedi affiche complet à chaque créneau de l’après-midi.',
  'Appelez cette semaine les deux groupes qui attendent, avec un prix par personne et un créneau précis. Le mardi est libre et la place suffit largement pour quarante-cinq élèves le matin.',
  'Gardez le samedi pour les familles et proposez la semaine aux écoles et aux entreprises, c’est là que la place reste.',
].join('\n\n');
const PREUVES = ['1 098 €', '13', '2 725 €'].map((t) => { const d = TEXTE.indexOf(t); return { d, f: d + t.length, t, e: 'lu', s: 'S1', l: 'Réservations, Chiffre' }; });
const SOURCE = { id: 'S1', outil: 'croiser_reservations', titre: 'Réservations par mois', detail: 'Banc.', colonnes: [{ cle: 'mois', nom: 'Mois', type: 'texte' }, { cle: 'reservations', nom: 'Réservations', type: 'entier' }], lignes: [{ mois: '2026-10', reservations: 8 }] };
const VRAI = { sourcesCitees: ['S1'], sourcesInconnues: [], chiffres: 3, chiffresSansSource: [] };
const debut = ['debut', { modele: 'Haiku 5.5', centres: [] }];
const fin = ['fin', { texte: TEXTE, verite: VRAI, preuves: PREUVES, identites: {}, modele: 'claude-haiku-5-5' }];

function transformer(editions) {
  if (!editions.length) return null;
  return (rel, texte) => {
    let t = texte;
    editions.filter((e) => e.fichier === rel).forEach((e) => {
      const brut = t.replace(/\r\n/g, '\n');
      if (brut.split(e.de).length !== 2) throw new Error(`ancre introuvable ou multiple : ${e.de.slice(0, 80)}`);
      t = brut.split(e.de).join(e.vers);
    });
    return t;
  };
}

async function verifier(editions = []) {
  const echecs = [];
  const ok = (cond, nom, detail = '') => {
    if (!cond) echecs.push(nom);
    if (!editions.length) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${nom}${cond || !detail ? '' : `  ${String(detail).slice(0, 400)}`}`);
  };
  const { chromium } = require('playwright-core');
  const sse = (type, d) => `event: ${type}\ndata: ${JSON.stringify(d)}\n\n`;
  const flux = { scenario: null };
  const serveurFlux = http.createServer((req, res) => {
    let brut = '';
    req.on('data', (c) => { brut += c; });
    req.on('end', async () => {
      const corps = JSON.parse(brut || '{}');
      if (corps.action) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(corps.action === 'conversations' ? { ok: true, stockage: 'appareil' } : corps.action === 'savoir' ? { ok: true, disponible: false, faits: [] } : { ok: false }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const item of flux.scenario) {
        if (item.attendre) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => res.on('close', r));
          return;
        }
        // (des evenements ecrits ensemble arrivent dans le meme paquet)
        res.write(item.ensemble ? item.ensemble.map((x) => sse(x[0], x[1])).join('') : sse(item[0], item[1]));
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 15));
      }
      res.end();
    });
  });
  await new Promise((r) => serveurFlux.listen(PORT + 1, '127.0.0.1', r));
  const serveur = await FX.servir({ port: PORT, transformer: transformer(editions) });
  const browser = await chromium.launch({ executablePath: NAVIGATEUR, headless: true });
  const monter = async (mouvementReduit = false) => {
    const m = await FX.monter(browser, { fixture: 'normal', appareil: 'ordinateur', theme: 'light', port: PORT, heure: '15:10', mouvementReduit });
    await m.page.route('**/api/assistant', (route) => route.continue({ url: `http://127.0.0.1:${PORT + 1}/` }));
    await m.page.evaluate(() => { location.hash = '#/staff/campaigns'; });
    await m.page.waitForSelector('[data-ast-champ]', { timeout: 20000 });
    await FX.repos(m.page, 700);
    return m;
  };
  // Chaque image, ce que montre la derniere reponse.
  const suivre = (page) => page.evaluate(() => {
    window.__ech = [];
    window.__premier = null;
    window.__stop = false;
    const tick = () => {
      const a = [...document.querySelectorAll('.ast-r')].pop();
      const z = a && a.querySelector('[data-ast-texte]');
      if (z) {
        const p = z.querySelector(':scope > p:not(.ast-pense)');
        if (p && !window.__premier) window.__premier = p;
        const neufs = [...z.querySelectorAll('.ast-neuf')];
        window.__ech.push({
          t: performance.now(),
          n: z.querySelector('.ast-pense') ? 0 : z.textContent.replace(/\s+/g, ' ').trim().length,
          pied: Boolean(a.querySelector('.ast-pied')),
          meme: p ? p === window.__premier : null,
          neufs: neufs.length,
          fondu: neufs.some((x) => x.getAnimations().some((an) => an.animationName === 'astMot')),
          entree: [...z.querySelectorAll('.ast-bloc-neuf')].some((x) => x.getAnimations().some((an) => an.animationName === 'astBloc')),
          h: z.getBoundingClientRect().height,
          // La hauteur que le texte ecrit occupe vraiment (ce que la zone vise).
          vise: (() => {
            const dernier = z.lastElementChild;
            if (!dernier) return 0;
            const marge = parseFloat(getComputedStyle(dernier).marginBottom) || 0;
            return Math.max(0, dernier.getBoundingClientRect().bottom + marge - z.getBoundingClientRect().top);
          })(),
        });
      }
      if (!window.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const demander = async (page, question) => {
    await page.locator('[data-ast-champ]').fill(question);
    await page.locator('[data-ast-champ]').press('Enter');
  };
  try {
    if (!editions.length) console.log('\n[A-D] une reponse envoyee d un seul morceau');
    const { page, erreurs } = await monter();
    flux.scenario = [debut, ['source', SOURCE], ['texte', { delta: TEXTE }], fin];
    await suivre(page);
    await demander(page, 'Ça va comment le centre ?');
    await page.waitForFunction(() => document.querySelectorAll('.ast-pied').length >= 1, null, { timeout: 15000 });
    await FX.repos(page, 1600);
    const ech = await page.evaluate(() => { window.__stop = true; return window.__ech; });
    const avecTexte = ech.filter((e) => e.n > 0);
    const nFin = avecTexte.length ? avecTexte[avecTexte.length - 1].n : 0;
    const ecriture = avecTexte.filter((e) => !e.pied);
    const longueurs = [...new Set(ecriture.map((e) => e.n))];
    const premierPied = ech.find((e) => e.pied);
    ok(nFin > 500 && ecriture.length && ecriture[0].n < nFin * 0.5 && longueurs.length >= 5 && longueurs.every((n, i) => i === 0 || n > longueurs[i - 1]) && Boolean(premierPied) && premierPied.n >= nFin * 0.97,
      '[A] le texte s ecrit au fil, pas d un bloc', JSON.stringify({ nFin, premier: ecriture[0] && ecriture[0].n, etapes: longueurs.length, auPied: premierPied && premierPied.n }));
    const duree = ecriture.length ? ecriture[ecriture.length - 1].t - ecriture[0].t : 0;
    ok(duree > 250 && duree < 2600, '[A] l ecriture suit le texte sans le faire attendre', `${Math.round(duree)} ms`);
    ok(ecriture.length > 0 && ecriture.every((e) => e.meme === true), '[B] un bloc pose ne se refait pas pendant l ecriture', JSON.stringify(ecriture.map((e) => e.meme).slice(0, 40)));
    ok(ecriture.some((e) => e.fondu) && ecriture.some((e) => e.entree), '[C] les mots arrivent en fondu et les blocs neufs entrent', JSON.stringify({ fondu: ecriture.filter((e) => e.fondu).length, entree: ecriture.filter((e) => e.entree).length, neufs: Math.max(0, ...ecriture.map((e) => e.neufs)) }));
    const traits = await page.evaluate(() => [...[...document.querySelectorAll('.ast-r')].pop().querySelectorAll('.ast-chiffre')].map((b) => ({ t: b.textContent, nom: getComputedStyle(b).animationName, delai: parseFloat(getComputedStyle(b).animationDelay) })));
    ok(traits.length === 3 && traits.every((x) => x.nom === 'astTrait') && traits.every((x, i) => i === 0 || x.delai > traits[i - 1].delai),
      '[D] a la fin, chaque chiffre prouve recoit son trait, dans l ordre de lecture', JSON.stringify(traits));
    // [G] (2026-11-13, Ansar : « le texte apparait en bas, c est pas fluide, ca cree des petits
    // sauts ») : quand une ligne s ajoute, la reponse n y saute pas d un coup, elle y glisse sur
    // plusieurs images. Mesure qui ne depend pas de la vitesse de la machine : la part du chemin
    // restant faite en UNE image. D un coup, c est 100 % ; en glissant, au plus 51 % (le pas d une
    // image est plafonne a 50 ms). En pixels, une machine lente faisait 12,4 px par image sur
    // GitHub contre 5 ici, sans saut pour autant.
    const hauteurs = ecriture.map((e) => e.h);
    const parts = ecriture.slice(1).map((e, i) => {
      const ecart = e.vise - ecriture[i].h;
      return ecart >= 6 ? (e.h - ecriture[i].h) / ecart : null;
    }).filter((x) => x !== null);
    const plusGrandePart = Math.max(0, ...parts);
    const plusGrandSaut = Math.max(0, ...hauteurs.slice(1).map((h, i) => h - hauteurs[i]));
    const mesureG = { plusGrandePart: Math.round(plusGrandePart * 100) / 100, lignesAjoutees: parts.length, plusGrandSaut: Math.round(plusGrandSaut * 10) / 10, depart: Math.round(hauteurs[0] || 0), arrivee: Math.round(hauteurs[hauteurs.length - 1] || 0), images: hauteurs.length };
    if (!editions.length) console.log(`      mesure [G] ${JSON.stringify(mesureG)}`);
    ok(hauteurs.length > 10 && hauteurs[hauteurs.length - 1] - hauteurs[0] > 60 && parts.length >= 3 && plusGrandePart <= 0.65,
      '[G] la reponse grandit en glissant, sans saut de ligne', JSON.stringify(mesureG));
    const rendue = await page.evaluate(() => { const z = [...document.querySelectorAll('.ast-r')].pop().querySelector('[data-ast-texte]'); return { h: z.style.height, o: z.style.overflow }; });
    ok(rendue.h === '' && rendue.o === '', '[G] a la fin, la reponse rend sa hauteur a son contenu', JSON.stringify(rendue));
    ok(!erreurs.length, '[A-D] aucune erreur JavaScript', erreurs.join(' | '));
    await page.context().close();

    if (!editions.length) console.log('\n[E] sans mouvement');
    const calme = await monter(true);
    flux.scenario = [debut, ['source', SOURCE], ['texte', { delta: TEXTE }], fin];
    await suivre(calme.page);
    await demander(calme.page, 'Et sans mouvement ?');
    await calme.page.waitForFunction(() => document.querySelectorAll('.ast-pied').length >= 1, null, { timeout: 15000 });
    await FX.repos(calme.page, 400);
    const ech2 = await calme.page.evaluate(() => { window.__stop = true; return window.__ech; });
    const avec2 = ech2.filter((e) => e.n > 0);
    const nFin2 = avec2.length ? avec2[avec2.length - 1].n : 0;
    ok(avec2.length && avec2[0].n >= nFin2 * 0.97 && ech2.every((e) => !e.neufs), '[E] sans mouvement, la reponse tombe d un coup, sans fondu', JSON.stringify({ premier: avec2[0] && avec2[0].n, nFin2, neufs: Math.max(0, ...ech2.map((e) => e.neufs)) }));
    await calme.page.context().close();

    if (!editions.length) console.log('\n[F] arreter pendant l ecriture');
    const arret = await monter();
    // (un texte long, pour que l ecriture soit loin d etre finie au moment du clic)
    flux.scenario = [debut, { ensemble: [['texte', { delta: [TEXTE, TEXTE, TEXTE, TEXTE].join('\n\n') }], ['verification', {}]] }, { attendre: true }];
    await suivre(arret.page);
    await demander(arret.page, 'Une longue réponse ?');
    await arret.page.waitForFunction(() => { const z = [...document.querySelectorAll('.ast-r')].pop().querySelector('[data-ast-texte]'); return z && !z.querySelector('.ast-pense') && z.textContent.trim().length > 40; }, null, { timeout: 15000 });
    const avantClic = await arret.page.evaluate(() => [...document.querySelectorAll('.ast-r')].pop().querySelector('[data-ast-texte]').textContent.length);
    await arret.page.evaluate(() => document.querySelector('[data-ast-envoi]').click());
    // (une vraie pause : FX.repos attend la fin des animations, donc celle de l ecriture)
    await arret.page.waitForTimeout(150);
    const apres200 = await arret.page.evaluate(() => { const a = [...document.querySelectorAll('.ast-r')].pop(); return { n: a.querySelector('[data-ast-texte]').textContent.length, arrete: /Réponse arrêtée/.test(a.textContent) }; });
    await FX.repos(arret.page, 1600);
    const stable = await arret.page.evaluate(() => [...document.querySelectorAll('.ast-r')].pop().querySelector('[data-ast-texte]').textContent.length);
    ok(avantClic < stable * 0.3 && apres200.n === stable && apres200.arrete, '[F] arreter montre tout de suite le texte deja recu', JSON.stringify({ avantClic, apres200, stable }));
    await arret.page.context().close();
  } finally {
    await browser.close();
    await new Promise((r) => serveur.close(r));
    await new Promise((r) => serveurFlux.close(r));
  }
  return echecs;
}

(async () => {
  if (process.argv.includes('--contre-preuves')) {
    let mordent = 0;
    for (const m of MUTATIONS) {
      // eslint-disable-next-line no-await-in-loop
      const echecs = await verifier(m.editions).catch((e) => [`exception ${e.message}`]);
      const mord = echecs.includes(m.rouge);
      if (mord) mordent += 1;
      console.log(`${mord ? 'ok  ' : 'FAIL'}  contre-preuve ${m.nom} : rougit « ${m.rouge} »${mord ? '' : `  (rouges : ${echecs.join(' | ') || 'aucun'})`}`);
    }
    console.log(`\nassistant-ecriture --contre-preuves: ${mordent}/${MUTATIONS.length} mordent`);
    process.exit(mordent === MUTATIONS.length ? 0 : 1);
  }
  const echecs = await verifier([]);
  if (echecs.length) { console.error(`\nassistant-ecriture-check: ${echecs.length} FAIL`); process.exit(1); }
  console.log('\nassistant-ecriture-check: ALL OK (le texte s ecrit au fil, les blocs poses ne bougent plus, les mots en fondu, le trait des chiffres, sans mouvement d un coup, l arret immediat)');
})().catch((e) => { console.error('ERREUR', e && e.stack ? e.stack.slice(0, 1200) : e); process.exit(1); });
