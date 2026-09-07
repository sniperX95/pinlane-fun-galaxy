// LA SALLE D ESSAI : la page du client, chez soi, pour de vrai.
//
// A quoi ca sert. Une capture montre un ecran fige ; elle ne dit pas ce que ca
// fait quand on clique. Ce serveur monte la VRAIE page du client sur
// http://localhost, avec le parcours Pinlane dedans, et on peut s en servir
// comme un visiteur : choisir une date, une activite, aller au bout.
//
// CE QUI EST REEL : leur HTML, leur CSS, leur JavaScript, leur mise en page ;
// le parcours servi depuis CE DEPOT (donc les modifications non deployees sont
// visibles) ; le catalogue, les creneaux et les tarifs, proxifies depuis la
// production.
//
// CE QUI NE L EST PAS : rien n est publie chez le client, son WordPress n est
// pas touche, et son serveur ne recoit qu une lecture de page au demarrage.
// Les axes de style sont injectes dans la reponse : la fiche du centre reste
// exactement ce qu elle est tant que personne ne va cliquer dans la console.
//
// ATTENTION, ET C EST ECRIT AUSSI DANS LA PAGE : les appels partent en
// PRODUCTION. Aller au bout du parcours cree une VRAIE reservation dans
// Pinlane. C est voulu (un parcours ne se prouve qu a son acte final), mais ca
// se sait avant de cliquer, pas apres.
//
// Usage :
//   npm run salle-essai
//   npm run salle-essai -- --centre=gembloux --port=4245
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AMONT = 'https://app.pinlane.be';

const SITES = {
  libramont: {
    page: 'https://fungalaxy.be/contact/',
    cookie: 'guest_selection=Libramont',
    masque: '.booking__container',
    bloc: '.booking .container',
    centre: 'libramont',
  },
  gembloux: {
    page: 'https://fungalaxy.be/contact/',
    cookie: 'guest_selection=Gembloux',
    masque: '.booking__container',
    bloc: '.booking .container',
    centre: 'gembloux',
  },
};

// Les styles proposes dans la barre. 'actuel' n injecte RIEN : c est la fiche
// du centre telle qu elle est aujourd hui, le point de comparaison.
const STYLES = {
  actuel: null,
  neon: { theme: 'dark', radius: 'round', backdrop: 'aurora', cards: 'neon', buttons: 'neon' },
  sobre: { theme: 'dark', radius: 'round', backdrop: 'tint', cards: 'line', buttons: 'neon' },
  clair: { theme: 'light', radius: 'round', backdrop: 'aurora', cards: 'neon', buttons: 'neon' },
};

const arg = (nom, defaut) => {
  const trouve = process.argv.find((a) => a.startsWith('--' + nom + '='));
  return trouve ? trouve.split('=')[1] : defaut;
};

const CENTRE = arg('centre', 'libramont');
const PORT = Number(arg('port', 4245));
const SITE = SITES[CENTRE];
if (!SITE) {
  console.error('centre inconnu : ' + CENTRE + '. Connus : ' + Object.keys(SITES).join(', '));
  process.exit(1);
}
const BASE = 'http://localhost:' + PORT;

// La barre d essai. Elle est VOLONTAIREMENT voyante : on ne doit jamais croire
// qu on regarde le site en ligne, et surtout pas oublier que le bouton du bout
// cree une vraie reservation.
function barre(styleActif) {
  const lien = (cle, libelle) => '<a href="/?style=' + cle + '"' + (cle === styleActif ? ' class="on"' : '') + '>' + libelle + '</a>';
  return `<div id="pinlane-essai">
    <strong>SALLE D ESSAI LOCALE</strong>
    <span>page reelle de ${SITE.page.replace('https://', '')} &middot; centre <b>${SITE.centre}</b> &middot; rien n est publie</span>
    <nav>${lien('actuel', 'Fiche actuelle')}${lien('neon', 'Sombre neon')}${lien('sobre', 'Sombre sobre')}${lien('clair', 'Clair neon')}</nav>
    <em>Les appels partent en production : aller au bout cree une VRAIE reservation.</em>
  </div>
  <style>
    #pinlane-essai { position: fixed; z-index: 2147483647; left: 0; right: 0; bottom: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding: 8px 14px; background: #111; color: #fff; font: 12px/1.4 system-ui, sans-serif; border-top: 2px solid #67baac; }
    #pinlane-essai strong { letter-spacing: .08em; color: #67baac; }
    #pinlane-essai span { opacity: .75; }
    #pinlane-essai nav { display: flex; gap: 6px; margin-left: auto; }
    #pinlane-essai a { color: #fff; text-decoration: none; border: 1px solid #444; border-radius: 999px; padding: 3px 10px; }
    #pinlane-essai a.on { background: #944292; border-color: #944292; }
    #pinlane-essai em { flex: 1 1 100%; color: #ffb4b4; font-style: normal; }
    body { padding-bottom: 74px !important; }
  </style>`;
}

function poserLeBloc(html) {
  const marqueur = /<(ul|div)[^>]*class=('[^']*gform_fields[^']*'|"[^"]*gform_fields[^"]*")[^>]*>/;
  const t = html.match(marqueur);
  if (!t) return null;
  const enveloppe = t[1] === 'ul' ? 'li' : 'div';
  // Le script pointe sur CE serveur : c est ce qui permet de voir le parcours
  // du depot, y compris ce qui n est pas encore deploye.
  const bloc = '<script src="' + BASE + '/embed.js" data-center="' + SITE.centre
    + '" data-target="' + SITE.bloc + '" data-fallback="' + SITE.masque + '"></' + 'script>';
  const at = t.index + t[0].length;
  return html.slice(0, at) + '<' + enveloppe + ' class="gfield gfield--type-html">' + bloc + '</' + enveloppe + '>' + html.slice(at);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.mp4': 'video/mp4',
};

async function main() {
  console.log('Lecture de ' + SITE.page + ' ...');
  const brut = await (await fetch(SITE.page, { headers: { Cookie: SITE.cookie } })).text();
  const pageClient = poserLeBloc(brut);
  if (!pageClient) {
    console.error('Bloc de champs Gravity Forms introuvable : la page du client a change de structure.');
    process.exit(1);
  }

  const serveur = http.createServer(async (req, res) => {
    const url = new URL(req.url, BASE);

    // 1. LA PAGE DU CLIENT, avec la barre d essai.
    if (url.pathname === '/' || url.pathname === '/index' || url.pathname === '/contact') {
      const style = STYLES[url.searchParams.get('style')] !== undefined ? url.searchParams.get('style') : 'neon';
      const corps = pageClient.replace('</body>', barre(style) + '</body>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': 'pinlane_essai_style=' + style + '; Path=/; SameSite=Lax' });
      res.end(corps);
      return;
    }

    // 2. LES APPELS D API : proxifies vers la production, et le catalogue recoit
    //    les axes de style choisis dans la barre. Rien n est enregistre.
    if (url.pathname.startsWith('/api/')) {
      const styleCookie = /pinlane_essai_style=([a-z]+)/.exec(req.headers.cookie || '');
      const axes = STYLES[(styleCookie && styleCookie[1]) || 'neon'] || null;
      const cible = AMONT + url.pathname + url.search;
      const morceaux = [];
      req.on('data', (c) => morceaux.push(c));
      req.on('end', async () => {
        try {
          const amont = await fetch(cible, {
            method: req.method,
            headers: { 'content-type': req.headers['content-type'] || 'application/json', accept: 'application/json' },
            body: /^(GET|HEAD)$/.test(req.method) ? undefined : Buffer.concat(morceaux),
          });
          const texte = await amont.text();
          let sortie = texte;
          if (axes && url.pathname === '/api/public-booking-meta') {
            try {
              const corps = JSON.parse(texte);
              // Deux reponses vivent sur ce chemin : le catalogue (center est un
              // objet) et l etat de l interrupteur (center est une chaine). On
              // n ecrit que dans le catalogue.
              if (corps && corps.center && typeof corps.center === 'object') {
                corps.center.branding = Object.assign({}, corps.center.branding || {}, axes);
                sortie = JSON.stringify(corps);
              }
            } catch (error) { /* pas du JSON : on relaie tel quel */ }
          }
          res.writeHead(amont.status, { 'Content-Type': amont.headers.get('content-type') || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(sortie);
        } catch (error) {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'amont injoignable : ' + (error && error.message) }));
        }
      });
      return;
    }

    // 3. LE DEPOT : le parcours, ses styles, ses images. C est ce qui rend
    //    visible ce qui n est pas encore deploye.
    let p = decodeURIComponent(url.pathname);
    if (p === '/reserver' || p.startsWith('/reserver/')) p = '/index.html';
    const fichier = path.resolve(path.join(ROOT, p));
    if (!fichier.startsWith(path.resolve(ROOT))) { res.writeHead(403); res.end(); return; }
    fs.readFile(fichier, (err, contenu) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('introuvable : ' + p); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fichier).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(contenu);
    });
  });

  serveur.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('  Salle d essai ouverte : ' + BASE + '/');
    console.log('');
    console.log('  Styles :  ' + Object.keys(STYLES).map((s) => BASE + '/?style=' + s).join('\n            '));
    console.log('');
    console.log('  Ce que tu vois : la vraie page de ' + SITE.page.replace('https://', '') + ', centre ' + SITE.centre + ',');
    console.log('  avec le parcours servi par CE depot (donc le non-deploye est visible).');
    console.log('  Rien n est publie. Leur WordPress n est pas touche.');
    console.log('');
    console.log('  ATTENTION : les appels partent en production. Aller au bout du parcours');
    console.log('  cree une VRAIE reservation dans Pinlane, a annuler ensuite dans la console.');
    console.log('');
    console.log('  Ctrl+C pour fermer.');
  });
}

main().catch((error) => {
  console.error('salle d essai interrompue :', (error && error.stack) || error);
  process.exit(1);
});
