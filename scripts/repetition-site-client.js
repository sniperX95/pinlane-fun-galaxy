// REPETITION AVANT DE TOUCHER AU SITE D UN CLIENT.
//
// Pourquoi ce script existe. Poser notre formulaire sur le site d un client,
// c est intervenir dans SA production : le formulaire qui lui amene ses
// clients. Un gate qui monte une fausse page prouve que NOTRE code se comporte
// bien ; il ne dit rien de la page REELLE, avec son theme, ses scripts, sa mise
// en page et ses surprises. Ce script comble exactement cet ecart : il rejoue la
// vraie page, telle qu elle est servie aujourd hui, avec le bloc pose a
// l endroit exact ou l installation le mettra.
//
// CE QUI EST REEL ICI :
//   - le HTML de la page du client, telecharge a l instant ;
//   - son CSS, son JavaScript, ses images, charges depuis SON domaine ;
//   - son Gravity Forms, avec le script d initialisation qui rappelle le
//     formulaire a l ecran APRES nous ;
//   - notre embed.js SERVI EN PRODUCTION, pas la copie locale ;
//   - le parcours Pinlane de production dans le cadre ;
//   - l origine de la page : le navigateur se croit VRAIMENT sur le site du
//     client, donc la politique frame-ancestors est evaluee pour de bon.
//
// CE QUI EST SIMULE, ET RIEN D AUTRE :
//   - la reponse de la page elle-meme, remplacee par la meme page plus le bloc.
//     Le serveur du client ne recoit que des lectures, comme un visiteur.
//   - pour la derniere epreuve seulement, l etat de l interrupteur, force a
//     « coupe » pour verifier le retour en arriere sans toucher a la vraie
//     fiche du centre.
//
// CE QUE CE SCRIPT NE PEUT PAS DIRE : si WordPress laissera le script dans le
// champ HTML de Gravity Forms. Ca se joue cote serveur du client, avec les
// droits de son compte, et ca ne se decouvre qu en enregistrant. Si le script
// est retire, il ne se passe RIEN : leur formulaire reste, aucun degat.
//
// Usage : node scripts/repetition-site-client.js
//         node scripts/repetition-site-client.js --centre=gembloux
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SORTIE = path.resolve(__dirname, '..', 'qa-artifacts', 'repetition-site-client');

// LE CATALOGUE DES SITES REPETES. Un site, c est ce qu il faut savoir pour poser
// le bloc chez lui, et rien de plus.
const SITES = {
  libramont: {
    page: 'https://fungalaxy.be/contact/',
    cookie: { name: 'guest_selection', value: 'Libramont', domain: 'fungalaxy.be', path: '/' },
    // CE QU ON MASQUE : le bloc degrade ENTIER (illustration, texte, cadre neon
    // et formulaire). Movsar, le 2026-09-07 : « il faut que ca remplace vraiment
    // tout le bloc bleu turquoise neon ».
    masque: '.booking__container',
    // CE QUE LE SITE REMONTRE TOUT SEUL, plus bas dans l arbre : Gravity Forms
    // reaffiche SON enveloppe a l initialisation de sa logique conditionnelle.
    // Masquer un ANCETRE bat cette tentative, et c est ce qui se verifie.
    revele: '#gform_wrapper_4',
    bloc: '.booking .container',
    marqueurDuCentre: 'gform_wrapper_4',
    centre: 'libramont',
  },
  gembloux: {
    page: 'https://fungalaxy.be/contact/',
    cookie: { name: 'guest_selection', value: 'Gembloux', domain: 'fungalaxy.be', path: '/' },
    masque: '.booking__container',
    revele: '#gform_wrapper_1',
    bloc: '.booking .container',
    marqueurDuCentre: 'gform_wrapper_1',
    centre: 'gembloux',
  },
};

const choisi = (process.argv.find((a) => a.startsWith('--centre=')) || '--centre=libramont').split('=')[1];
const SITE = SITES[choisi];
if (!SITE) {
  console.error('FAIL  centre inconnu : ' + choisi + '. Connus : ' + Object.keys(SITES).join(', '));
  process.exit(1);
}

let failures = 0;
function ok(cond, label, detail) {
  console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '  ' + detail : ''));
  if (!cond) failures += 1;
  return cond;
}

// LE BLOC, ECRIT UNE SEULE FOIS. C est celui que l on collera dans le champ
// HTML : si cette chaine change, la repetition et l installation divergent.
function blocAColler(site) {
  return '<script src="https://app.pinlane.be/embed.js" data-center="' + site.centre
    + '" data-target="' + site.bloc + '" data-fallback="' + site.masque + '"></' + 'script>';
}

// L INJECTION SE FAIT LA OU LE CHAMP HTML ATTERRIRA : dans la liste des champs
// du formulaire, en premiere position. Poser le script ailleurs (avant le
// formulaire, ou en fin de page) repeterait une installation que personne ne
// fera jamais.
function poserLeBloc(html, site) {
  // Gravity Forms a rendu ses champs en <ul> puis en <div> selon les versions :
  // on vise la CLASSE, pas la balise.
  const marqueur = /<(ul|div)[^>]*class=('[^']*gform_fields[^']*'|"[^"]*gform_fields[^"]*")[^>]*>/;
  const trouve = html.match(marqueur);
  if (!trouve) return { html: html, pose: false };
  const enveloppe = trouve[1] === 'ul' ? 'li' : 'div';
  const li = '<' + enveloppe + ' class="gfield gfield--type-html">' + blocAColler(site) + '</' + enveloppe + '>';
  const at = trouve.index + trouve[0].length;
  return { html: html.slice(0, at) + li + html.slice(at), pose: true };
}

// CE QU ON LIT SUR LA PAGE. Une seule lecture, pour que toutes les assertions
// parlent du meme instant.
const LIRE = function (args) {
  const anc = document.querySelector(args.masque);
  const rev = document.querySelector(args.revele);
  const conteneur = document.querySelector(args.bloc);
  const cadreDedans = conteneur ? conteneur.querySelector('iframe[src*="/reserver"]') : null;
  const cadreOu = document.querySelector('iframe[src*="/reserver"]');
  const st = anc ? window.getComputedStyle(anc) : null;
  const r = cadreDedans ? cadreDedans.getBoundingClientRect() : null;
  const rc = conteneur ? conteneur.getBoundingClientRect() : null;
  const formulairesVisibles = Array.prototype.slice.call(document.querySelectorAll('form')).filter(function (f) {
    const s = window.getComputedStyle(f);
    return s.display !== 'none' && s.visibility !== 'hidden' && f.getBoundingClientRect().height > 40;
  }).length;
  return {
    ancienPresent: Boolean(anc),
    ancienStyleEnLigne: anc ? (anc.style.display || '') : '',
    ancienAffichage: st ? st.display : '',
    ancienVisible: Boolean(anc) && st.display !== 'none' && anc.offsetParent !== null,
    // L element que le site remontre : son style EN LIGNE dit ce que le site a
    // TENTE, sa hauteur rendue dit ce que le visiteur voit vraiment.
    revelePresent: Boolean(rev),
    releveStyleEnLigne: rev ? (rev.style.display || '') : '',
    releveHauteurRendue: rev ? Math.round(rev.getBoundingClientRect().height) : -1,
    releveVisible: Boolean(rev) && rev.offsetParent !== null && rev.getBoundingClientRect().height > 40,
    cadreDansLeBloc: Boolean(cadreDedans),
    cadreQuelquePart: Boolean(cadreOu),
    cadreParent: cadreOu && cadreOu.parentNode ? (cadreOu.parentNode.className || cadreOu.parentNode.tagName) : '',
    cadreLargeur: r ? Math.round(r.width) : 0,
    cadreHauteur: r ? Math.round(r.height) : 0,
    blocLargeur: rc ? Math.round(rc.width) : 0,
    debordementPage: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    formulairesVisibles: formulairesVisibles,
    hauteursAnnoncees: (window.__PINLANE_HAUTEURS__ || []).slice(),
    plancherRelache: cadreDedans ? window.getComputedStyle(cadreDedans).minHeight : '',
  };
};

async function main() {
  fs.mkdirSync(SORTIE, { recursive: true });
  console.log('Repetition sur ' + SITE.page + ' (centre ' + SITE.centre + ')');
  console.log('Bloc pose : ' + blocAColler(SITE));
  console.log('');

  const reponse = await fetch(SITE.page, { headers: { Cookie: SITE.cookie.name + '=' + SITE.cookie.value } });
  ok(reponse.ok, '[0] la page du client repond', 'HTTP ' + reponse.status);
  const brut = await reponse.text();
  ok(brut.indexOf(SITE.marqueurDuCentre) !== -1,
    '[0] et elle sert bien le formulaire de ce centre', SITE.marqueurDuCentre);

  const pose = poserLeBloc(brut, SITE);
  if (!ok(pose.pose, '[0] MONTAGE : le bloc a ete pose dans la liste des champs du formulaire')) {
    process.exit(1);
  }

  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const errs = [];

  async function ouvrir(options) {
    const o = options || {};
    const context = await browser.newContext({
      viewport: { width: o.largeur || 1440, height: o.hauteur || 1000 },
    });
    await context.addCookies([SITE.cookie]);
    const page = await context.newPage();
    page.on('pageerror', function (e) { errs.push('PAGEERROR: ' + e.message); });
    // ON ECOUTE CE QUE LE PARCOURS ANNONCE. La hauteur du cadre ne se juge pas
    // a un nombre de pixels arbitraire : elle se juge en comparant ce que le
    // parcours a ANNONCE et ce que le cadre a APPLIQUE. Sans ce releve, un
    // cadre fige au plancher passerait pour un cadre bien dimensionne.
    await page.addInitScript(function () {
      window.__PINLANE_HAUTEURS__ = [];
      window.addEventListener('message', function (e) {
        var d = e && e.data;
        if (d && d.type === 'pinlane:height') window.__PINLANE_HAUTEURS__.push(Number(d.height));
      });
    });
    // La page elle-meme est remplacee ; TOUT LE RESTE part sur le reseau reel.
    // Le navigateur se croit sur le site du client : meme origine, memes
    // cookies, et la politique frame-ancestors de app.pinlane.be est evaluee
    // pour de vrai, pas contournee.
    await page.route(SITE.page, function (route) {
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: pose.html,
      });
    });
    if (o.interrupteurCoupe) {
      await page.route('**/api/public-booking-meta**', function (route) {
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ ok: true, center: SITE.centre, actif: false }),
        });
      });
    }
    await page.goto(SITE.page, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(5000);
    return { context: context, page: page };
  }

  // ON CAPTURE LA SECTION DE RESERVATION, pas le haut de la page : c est le
  // seul endroit ou il y a quelque chose a juger, et une capture du hero ne
  // prouverait rien a personne.
  async function capturerLaSection(page, nom) {
    const cible = page.locator('.booking.section, section.booking').first();
    try {
      await cible.scrollIntoViewIfNeeded({ timeout: 5000 });
      await page.waitForTimeout(400);
      await cible.screenshot({ path: path.join(SORTIE, nom) });
    } catch (error) {
      await page.screenshot({ path: path.join(SORTIE, nom), fullPage: true });
    }
  }

  try {
    // =====================================================================
    console.log('');
    console.log('[A] UN SEUL FORMULAIRE, ET C EST LE NOTRE');
    // =====================================================================
    const s1 = await ouvrir({});
    const vu = await s1.page.evaluate(LIRE, { masque: SITE.masque, revele: SITE.revele, bloc: SITE.bloc });
    ok(vu.cadreDansLeBloc,
      '[A] le parcours Pinlane est monte dans ' + SITE.bloc, 'parent ' + vu.cadreParent);
    ok(vu.ancienPresent && !vu.ancienVisible,
      '[A] et le bloc d origine est toujours dans la page, mais invisible',
      'present=' + vu.ancienPresent + ' affichage=' + vu.ancienAffichage);
    ok(vu.formulairesVisibles === 0,
      '[A] aucun formulaire du site ne reste a l ecran a cote du notre',
      vu.formulairesVisibles + ' formulaire(s) visible(s)');

    // =====================================================================
    console.log('');
    console.log('[B] LEUR PROPRE SCRIPT NE PEUT PAS LE REMONTRER');
    // =====================================================================
    // MONTAGE : Gravity Forms a REELLEMENT tente de reafficher le formulaire.
    // Sans cette assertion, un vert ne prouverait que l absence de tentative.
    // ON NE SE CONTENTE PAS D ESPERER QUE LE SITE ESSAIE : ON LE FAIT ESSAYER.
    //
    // Gravity Forms reaffiche son enveloppe par jQuery('#gform_wrapper_N').show()
    // quand il initialise sa logique conditionnelle. Selon la version, le
    // moment et l etat de la page, il le fait ou ne le fait pas : un gate qui
    // ATTEND cette tentative rendrait un vert le jour ou elle n a simplement pas
    // eu lieu, ce qui ne prouverait rien. On rejoue donc le geste nous-memes,
    // exactement comme jQuery le fait (style en ligne display:block), et on
    // regarde ce que le visiteur verrait. C est la version adverse de la meme
    // question, et elle a une reponse tous les jours.
    const forceLeSite = await s1.page.evaluate(function (sel) {
      const el = document.querySelector(sel);
      if (!el) return { pose: false };
      el.style.display = 'block';
      return { pose: true, styleEnLigne: el.style.display };
    }, SITE.revele);
    await s1.page.waitForTimeout(300);
    const apresForce = await s1.page.evaluate(LIRE, { masque: SITE.masque, revele: SITE.revele, bloc: SITE.bloc });
    ok(forceLeSite.pose && apresForce.releveStyleEnLigne === 'block',
      '[B] MONTAGE : le site remet SON formulaire en display:block, comme Gravity Forms le fait',
      'style en ligne « ' + (apresForce.releveStyleEnLigne || '(vide)') + ' »');
    ok(apresForce.releveHauteurRendue === 0 && apresForce.releveVisible === false,
      '[B] et rien n en apparait : masquer l ANCETRE bat la tentative du site',
      'hauteur rendue ' + apresForce.releveHauteurRendue + 'px');
    ok(apresForce.cadreDansLeBloc === true,
      '[B] et notre parcours, lui, est toujours la');

    // =====================================================================
    console.log('');
    console.log('[C] LA MISE EN PAGE DU CLIENT N EST PAS CASSEE');
    // =====================================================================
    ok(vu.debordementPage <= 2,
      '[C] la page ne deborde pas horizontalement', vu.debordementPage + 'px');
    ok(vu.cadreLargeur > 0 && vu.cadreLargeur <= vu.blocLargeur + 2,
      '[C] le cadre tient dans le bloc du client',
      'cadre ' + vu.cadreLargeur + 'px, bloc ' + vu.blocLargeur + 'px');
    // LA HAUTEUR SE JUGE CONTRE CE QUE LE PARCOURS A ANNONCE, pas contre un
    // nombre de pixels choisi d avance. Un ecran de parcours peut tres bien
    // etre PLUS COURT que le plancher de 480px : le plancher n existe que pour
    // eviter un saut de mise en page AVANT la premiere annonce, et descendre en
    // dessous une fois la vraie hauteur connue est le comportement voulu, pas
    // un defaut. Ce qui se verifie, c est que le cadre OBEIT.
    const derniereAnnonce = vu.hauteursAnnoncees.length
      ? vu.hauteursAnnoncees[vu.hauteursAnnoncees.length - 1]
      : null;
    ok(vu.hauteursAnnoncees.length > 0,
      '[C] MONTAGE : le parcours a annonce sa hauteur au site',
      vu.hauteursAnnoncees.length + ' annonce(s) : ' + vu.hauteursAnnoncees.join(', '));
    ok(derniereAnnonce !== null && Math.abs(vu.cadreHauteur - Math.ceil(derniereAnnonce)) <= 1,
      '[C] et le cadre a pris exactement cette hauteur, sans ascenseur interieur',
      'annonce ' + derniereAnnonce + 'px, rendu ' + vu.cadreHauteur + 'px');
    ok(vu.plancherRelache === '0px',
      '[C] le plancher de depart a ete relache : pas de bande blanche sous un ecran court',
      'min-height ' + vu.plancherRelache);
    await capturerLaSection(s1.page, SITE.centre + '-1440.png');
    await s1.context.close();

    // =====================================================================
    console.log('');
    console.log('[D] SUR TELEPHONE AUSSI');
    // =====================================================================
    const s2 = await ouvrir({ largeur: 390, hauteur: 844 });
    const surMobile = await s2.page.evaluate(LIRE, { masque: SITE.masque, revele: SITE.revele, bloc: SITE.bloc });
    ok(surMobile.cadreDansLeBloc && surMobile.ancienAffichage === 'none',
      '[D] meme resultat a 390px : un seul formulaire, le notre');
    ok(surMobile.debordementPage <= 2,
      '[D] et rien ne deborde sur le cote', surMobile.debordementPage + 'px');
    await capturerLaSection(s2.page, SITE.centre + '-390.png');
    await s2.context.close();

    // =====================================================================
    console.log('');
    console.log('[E] L INTERRUPTEUR REND LEUR FORMULAIRE, SUR LEUR VRAIE PAGE');
    // =====================================================================
    const s3 = await ouvrir({ interrupteurCoupe: true });
    const coupe = await s3.page.evaluate(LIRE, { masque: SITE.masque, revele: SITE.revele, bloc: SITE.bloc });
    ok(coupe.cadreQuelquePart === false,
      '[E] coupe : le cadre Pinlane a disparu de la page');
    ok(coupe.ancienVisible === true,
      '[E] et le formulaire du client est de retour a l ecran', 'affichage ' + coupe.ancienAffichage);
    ok(coupe.formulairesVisibles >= 1 && coupe.releveVisible === true,
      '[E] il est reellement utilisable, pas seulement present dans le code',
      coupe.formulairesVisibles + ' formulaire(s) visible(s), enveloppe ' + coupe.releveHauteurRendue + 'px');
    await capturerLaSection(s3.page, SITE.centre + '-coupe.png');
    await s3.context.close();

    if (errs.length) {
      console.log('');
      console.log('Erreurs de page (informatif : le site du client en a deja sans nous) :');
      console.log(errs.slice(0, 5).join('\n'));
    }
    console.log('');
    console.log('Captures : ' + SORTIE);
    console.log(failures ? failures + ' controle(s) en echec.' : 'repetition-site-client: ALL OK');
  } finally {
    await browser.close();
  }
  process.exit(failures ? 1 : 0);
}

main().catch(function (error) {
  console.error('FAIL  repetition interrompue :', (error && error.stack) || error);
  process.exit(1);
});
