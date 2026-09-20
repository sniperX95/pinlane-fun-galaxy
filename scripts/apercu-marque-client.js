// VOIR LE STYLE D UN CENTRE AVANT DE L ENREGISTRER.
//
// Les axes de style (theme, angles, fond, panneaux, boutons) se choisissent
// dans la fiche du centre, et ils changent ce que voient SES clients. Les
// choisir au catalogue, c est choisir sur des mots : « halo a votre couleur »
// ne dit pas a quoi ressemble un halo sur une page noire.
//
// Ce script rend le parcours embarque sur la VRAIE page du client, avec les
// axes demandes, et rend une capture par jeu. Rien n est enregistre : la fiche
// du centre n est pas touchee, le serveur du client ne recoit que des lectures.
// C est l apercu qu on regarde AVANT d aller cliquer dans la console.
//
// Usage :
//   node scripts/apercu-marque-client.js
//   node scripts/apercu-marque-client.js --centre=gembloux
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const SORTIE = path.join(ROOT, 'qa-artifacts', 'apercu-marque-client');
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const origineArg = process.argv.find((a) => a.startsWith('--origin='));
const APP_ORIGIN = (origineArg ? origineArg.split('=').slice(1).join('=') : 'https://app.pinlane.be').replace(/\/$/, '');
const EMBED_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(APP_ORIGIN)
  ? 'https://app.pinlane.be'
  : APP_ORIGIN;
const viewportArg = process.argv.find((a) => a.startsWith('--viewport='));
const VIEWPORT_WIDTH = Math.max(320, Number(viewportArg ? viewportArg.split('=')[1] : 1440) || 1440);
const SHOT_SUFFIX = VIEWPORT_WIDTH < 700 ? '-mobile' : '';

// Le meme catalogue que la repetition : un site, c est sa page, son cookie de
// centre, le bloc qu on masque et celui ou l on monte.
const SITES = {
  libramont: {
    page: 'https://fungalaxy.be/contact/',
    cookie: { name: 'guest_selection', value: 'Libramont', domain: 'fungalaxy.be', path: '/' },
    masque: '.booking__container',
    bloc: '.booking .container',
    section: '.booking.section, section.booking',
    centre: 'libramont',
  },
  gembloux: {
    page: 'https://fungalaxy.be/contact/',
    cookie: { name: 'guest_selection', value: 'Gembloux', domain: 'fungalaxy.be', path: '/' },
    masque: '.booking__container',
    bloc: '.booking .container',
    section: '.booking.section, section.booking',
    centre: 'gembloux',
  },
};

// Les jeux d axes compares. Le premier est l etat ACTUEL de la fiche : sans lui,
// on regarde une proposition sans savoir de quoi on part.
const JEUX_COMPLETS = [
  { nom: '0-etat-actuel', axes: null },
  { nom: '1-sombre-neon', axes: { theme: 'dark', radius: 'round', backdrop: 'aurora', cards: 'neon', buttons: 'neon' } },
  { nom: '2-sombre-sobre', axes: { theme: 'dark', radius: 'round', backdrop: 'tint', cards: 'line', buttons: 'neon' } },
];
const JEUX = EMBED_ORIGIN !== APP_ORIGIN ? JEUX_COMPLETS.slice(0, 1) : JEUX_COMPLETS;

const choisi = (process.argv.find((a) => a.startsWith('--centre=')) || '--centre=libramont').split('=')[1];
const SITE = SITES[choisi];
if (!SITE) {
  console.error('centre inconnu : ' + choisi + '. Connus : ' + Object.keys(SITES).join(', '));
  process.exit(1);
}

function poserLeBloc(html, site) {
  const marqueur = /<(ul|div)[^>]*class=('[^']*gform_fields[^']*'|"[^"]*gform_fields[^"]*")[^>]*>/;
  const t = html.match(marqueur);
  if (!t) return null;
  const enveloppe = t[1] === 'ul' ? 'li' : 'div';
  const bloc = '<script src="' + EMBED_ORIGIN + '/embed.js" data-center="' + site.centre
    + '" data-target="' + site.bloc + '" data-fallback="' + site.masque + '"></' + 'script>';
  const at = t.index + t[0].length;
  return html.slice(0, at) + '<' + enveloppe + ' class="gfield gfield--type-html">' + bloc + '</' + enveloppe + '>' + html.slice(at);
}

async function main() {
  fs.mkdirSync(SORTIE, { recursive: true });
  const brut = await (await fetch(SITE.page, { headers: { Cookie: SITE.cookie.name + '=' + SITE.cookie.value } })).text();
  const html = poserLeBloc(brut, SITE);
  if (!html) { console.error('bloc de champs Gravity Forms introuvable sur ' + SITE.page); process.exit(1); }

  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    for (const jeu of JEUX) {
      // eslint-disable-next-line no-await-in-loop
      const ctx = await browser.newContext({ viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_WIDTH < 700 ? 844 : 1100 } });
      // eslint-disable-next-line no-await-in-loop
      await ctx.addCookies([SITE.cookie]);
      // eslint-disable-next-line no-await-in-loop
      const page = await ctx.newPage();
      if (EMBED_ORIGIN !== APP_ORIGIN) {
        // La page client est en HTTPS : un script HTTP local serait bloque
        // avant meme que Playwright puisse l observer. On conserve donc les
        // URL publiques dans le document, puis on sert leur contenu depuis le
        // serveur local. L apercu montre le code courant sans mixed content.
        // eslint-disable-next-line no-await-in-loop
        await page.route('https://app.pinlane.be/**', async (route) => {
          const publicUrl = new URL(route.request().url());
          const localUrl = APP_ORIGIN + publicUrl.pathname + publicUrl.search;
          const response = await route.fetch({ url: localUrl });
          return route.fulfill({ response });
        });
      }
      // eslint-disable-next-line no-await-in-loop
      await page.route(SITE.page, (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: html }));
      if (jeu.axes) {
        // Les axes sont injectes DANS LA REPONSE, pas enregistres : la fiche du
        // centre reste exactement ce qu elle est.
        // eslint-disable-next-line no-await-in-loop
        await page.route('**/api/public-booking-meta**', async (route) => {
          const rep = await route.fetch();
          let corps;
          try { corps = await rep.json(); } catch (error) { return route.fulfill({ response: rep }); }
          // Le meme chemin sert DEUX reponses : le catalogue du centre (center est
          // un objet) et l etat de l interrupteur (center est une chaine). Ecrire
          // dans la seconde faisait planter l apercu.
          if (corps && corps.center && typeof corps.center === 'object') {
            corps.center.branding = Object.assign({}, corps.center.branding || {}, jeu.axes);
          }
          return route.fulfill({ status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify(corps) });
        });
      }
      // eslint-disable-next-line no-await-in-loop
      await page.goto(SITE.page, { waitUntil: 'load', timeout: 60000 });
      const cookieAccept = page.locator('#wt-cli-accept-btn');
      if (await cookieAccept.isVisible().catch(() => false)) await cookieAccept.click();
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(6500);
      const cadre = page.frames().find((f) => f !== page.mainFrame());
      // eslint-disable-next-line no-await-in-loop
      const lu = cadre ? await cadre.evaluate(() => {
        const r = document.documentElement;
        return {
          theme: r.getAttribute('data-theme') || '(suit l appareil)',
          panneaux: r.getAttribute('data-tunnel-cards') || '(defaut)',
          fond: r.getAttribute('data-tunnel-backdrop') || '(defaut)',
          glow: getComputedStyle(r).getPropertyValue('--tenant-glow').trim() || '(aucune 2e couleur)',
        };
      }) : { theme: 'PAS DE CADRE' };
      console.log(jeu.nom + ' : ' + Object.entries(lu).map(([k, v]) => k + '=' + v).join('  '));
      const cible = page.locator(SITE.section).first();
      try {
        // eslint-disable-next-line no-await-in-loop
        await cible.scrollIntoViewIfNeeded({ timeout: 5000 });
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(400);
        // eslint-disable-next-line no-await-in-loop
        await cible.screenshot({ path: path.join(SORTIE, SITE.centre + '-' + jeu.nom + SHOT_SUFFIX + '.png') });
      } catch (error) {
        // eslint-disable-next-line no-await-in-loop
        await page.screenshot({ path: path.join(SORTIE, SITE.centre + '-' + jeu.nom + SHOT_SUFFIX + '.png'), fullPage: true });
      }
      if (EMBED_ORIGIN !== APP_ORIGIN && jeu.nom === '0-etat-actuel' && cadre) {
        const shot = async (name) => {
          await page.waitForTimeout(450);
          await cible.screenshot({ path: path.join(SORTIE, SITE.centre + '-parcours-' + name + SHOT_SUFFIX + '.png') });
        };
        await cadre.locator('#fDate').fill('2026-09-22');
        await cadre.evaluate(() => document.activeElement?.blur());
        await page.waitForTimeout(1000);
        await shot('1-venue');
        await cadre.locator('#btnVenueContinue').click();
        await page.waitForTimeout(500);
        const bowling = cadre.locator(".activity-card[data-activity='bowling'] .activity-toggle");
        if (await bowling.count() && (await bowling.getAttribute('aria-pressed')) !== 'true') await bowling.click();
        await shot('2-activite');
        await cadre.locator('#btnStep1').click();
        await page.waitForTimeout(800);
        console.log('apres activite : etape=' + await cadre.evaluate(() => String(window.state?.step || ''))
          + ' alerte=' + await cadre.locator('#alertBox').innerText().catch(() => ''));
        await shot('3-apres-activite');
        await cadre.locator('#btnStep1').click();
        await cadre.locator('#slotList .slot-card:not([disabled])').first().waitFor({ state: 'visible', timeout: 20000 });
        await shot('3-horaire');
        await cadre.locator('#slotList .slot-card:not([disabled])').first().click();
        await page.waitForTimeout(900);
        if (!(await cadre.locator('#fName').isVisible())) await cadre.evaluate(() => goStep(3));
        await cadre.locator('#fName').waitFor({ state: 'visible', timeout: 10000 });
        await cadre.locator('#fName').fill('Marie Dupont');
        await cadre.locator('#fPhone').fill('+32 470 00 00 00');
        await cadre.locator('#fEmail').fill('marie@example.com');
        await shot('4-coordonnees');
        await cadre.getByRole('button', { name: 'Voir le récapitulatif' }).click();
        await cadre.locator('#recapList').waitFor({ state: 'visible', timeout: 10000 });
        await shot('5-recapitulatif');
        await cadre.evaluate(() => {
          document.getElementById('successName').textContent = 'Marie';
          document.getElementById('successDetails').textContent = 'Votre demande est confirmée. Un récapitulatif vient de partir par email.';
          goStep(5);
        });
        await shot('6-confirmation');
      }
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      // eslint-disable-next-line no-await-in-loop
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log('');
  console.log('Captures : ' + SORTIE);
  console.log('Rien n a ete enregistre : la fiche du centre est inchangee.');
}

main().catch((error) => {
  console.error('apercu interrompu :', (error && error.stack) || error);
  process.exit(1);
});
