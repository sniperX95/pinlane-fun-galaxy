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
const JEUX = [
  { nom: '0-etat-actuel', axes: null },
  { nom: '1-sombre-neon', axes: { theme: 'dark', radius: 'round', backdrop: 'aurora', cards: 'neon', buttons: 'neon' } },
  { nom: '2-sombre-sobre', axes: { theme: 'dark', radius: 'round', backdrop: 'tint', cards: 'line', buttons: 'neon' } },
];

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
  const bloc = '<script src="https://app.pinlane.be/embed.js" data-center="' + site.centre
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
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
      // eslint-disable-next-line no-await-in-loop
      await ctx.addCookies([SITE.cookie]);
      // eslint-disable-next-line no-await-in-loop
      const page = await ctx.newPage();
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
        await cible.screenshot({ path: path.join(SORTIE, SITE.centre + '-' + jeu.nom + '.png') });
      } catch (error) {
        // eslint-disable-next-line no-await-in-loop
        await page.screenshot({ path: path.join(SORTIE, SITE.centre + '-' + jeu.nom + '.png'), fullPage: true });
      }
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
