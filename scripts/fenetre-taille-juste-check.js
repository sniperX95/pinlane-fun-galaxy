// LA FENETRE A SA VRAIE TAILLE DES LA PREMIERE IMAGE (gate ne le 2026-11-19).
//
// Le mouvement de la console se joue sur des calques a part (assets/pinlane-mouvement.js) :
// la vraie fenetre ne change ni de taille ni de place pendant son entree, seule son opacite
// bouge. Le 19/11, l entree sans origine visible grandissait la fiche de 97 % a 100 % sur la
// vraie boite : une mesure faite pendant ce quart de seconde lisait 38,8 px pour une photo
// de 40, et fiche-simple-check rougissait au telephone sur la machine lente de GitHub.
//
// Ce gate ouvre la fiche et Reserver, sans origine visible (ordinateur et telephone) et
// depuis une ligne du planning (ordinateur, la forme vide vole), lit leur boite DANS LA
// MEME TACHE que l ouverture, puis une fois le mouvement fini : les deux lectures sont les
// memes, au demi-pixel. Il verifie aussi que l entree a bien joue (une mesure sans
// mouvement ne prouverait rien).
//
// --contre-preuves : le module servi avec l ancienne entree (scale 0.97 sur la vraie
// fenetre) doit faire rougir la fiche au telephone.
'use strict';
const F = require('./planning-v3-fixtures');
const { chromium } = require('playwright-core');

const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.PINLANE_FENETRE_TAILLE_PORT || 5262);
const CONTRE = process.argv.includes('--contre-preuves');

const ENTREE_JUSTE = "telephone ? [{ opacity: 0 }, { opacity: 1 }] :";
const ENTREE_ANCIENNE = "telephone ? [{ opacity: 0, transform: 'translateY(8px) scale(0.97)' }, { opacity: 1, transform: 'none' }] :";
// Sur grand ecran la fenetre grandit de 0,98 a 1 (20/11, la fiche « pas fluide » : le gerant) :
// sa boite lue tout de suite differe de 2,5 % au plus. Au telephone elle ne bouge pas, au demi-pixel.
const tolerance = (appareil, b) => (appareil === 'ordinateur' && b ? 0.025 * Math.max(b.w, b.h) : 0.5);

let echecs = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
  if (!cond) echecs += 1;
  return cond;
}

// La boite de la fenetre et de la premiere photo du programme, lues sur place. Le lecteur
// est pose une fois dans la page : appele dans la tache meme de l ouverture.
function poserLecteur() {
  const b = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  window.__lireFenetre = () => ({
    fiche: b(document.querySelector('#posOverlay:not(.hidden) .edit-modal')),
    photo: b(document.querySelector('#posOverlay:not(.hidden) .fx-programme .gc-step .fz-photo')),
    reserver: b(document.querySelector('#quickBookOverlay:not(.hidden) .qb-modal')),
  });
}
const LIRE = () => window.__lireFenetre();

// (la photo se compare a sa TAILLE : dans la fiche, la feuille garde son entree d avant le
// mouvement, .fade-in = pl-enter, qui la monte de 8 px ; sa taille, elle, ne bouge pas)
const taille = (a, b) => (!a || !b ? Infinity : Math.max(Math.abs(a.w - b.w), Math.abs(a.h - b.h)));
const ecart = (a, b) => {
  if (!a || !b) return Infinity;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));
};

async function fermerTout(page) {
  await page.evaluate(() => {
    if (typeof closePos === 'function' && !document.getElementById('posOverlay').classList.contains('hidden')) closePos();
    if (typeof closeQuickBook === 'function' && !document.getElementById('quickBookOverlay').classList.contains('hidden')) closeQuickBook();
  });
  await F.repos(page);
}

// Ouverture par le code, sans rien de touche : l entree « sans origine visible ».
async function sansOrigine(page, quoi) {
  return page.evaluate((quoi) => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (quoi === 'fiche') {
      // (un groupe a venir avec un programme a photos : bowling et billard)
      const r = state.reservations.find((x) => /Famille G.rard/.test(String(x.name || ''))) || state.reservations.find((x) => x.status === 'confirmed');
      openPos(r.id);
    } else openQuickBook();
    const surface = document.querySelector(quoi === 'fiche' ? '#posOverlay .edit-modal' : '#quickBookOverlay .qb-modal');
    const joue = Boolean(surface) && surface.getAnimations().length > 0;
    return { tout_de_suite: window.__lireFenetre(), joue };
  }, quoi);
}

async function scenario(navigateur, appareil, port, { seulementFicheTelephone = false } = {}) {
  const { ctx, page, erreurs } = await F.monter(navigateur, { fixture: 'pic', appareil, theme: 'light', heure: '15:10', port });
  const res = [];
  try {
    await page.evaluate(poserLecteur);
    for (const quoi of seulementFicheTelephone ? ['fiche'] : ['fiche', 'reserver']) {
      const a = await sansOrigine(page, quoi);
      await F.repos(page, 500);
      const b = await page.evaluate(LIRE);
      res.push({ nom: `${appareil}, ${quoi} sans origine visible`, joue: a.joue, ecart: ecart(a.tout_de_suite[quoi], b[quoi]), photo: quoi === 'fiche' ? taille(a.tout_de_suite.photo, b.photo) : 0, avant: a.tout_de_suite[quoi], apres: b[quoi] });
      await fermerTout(page);
    }
    if (appareil === 'ordinateur' && !seulementFicheTelephone) {
      // Depuis une ligne du planning, au vrai clic : la forme vide vole de la ligne a la fiche.
      await page.evaluate(() => { state.staffMenuPage = 'planning'; state.staffResourceView = 'all'; renderStaff(); });
      await F.repos(page, 600);
      const cible = await page.evaluate(() => {
        const vue = window.innerHeight;
        for (const tr of document.querySelectorAll('.gf-t tr.gf-r:not(.gf-retenue)')) {
          const td = tr.querySelector('td.gf-a.is-vide');
          if (!td) continue;
          const r = td.getBoundingClientRect();
          if (r.top > 140 && r.bottom < vue - 40 && r.width > 10) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        return null;
      });
      if (!ok(Boolean(cible), 'ordinateur : une case vide du planning est a l ecran pour ouvrir la fiche')) return { res, erreurs };
      await page.mouse.click(cible.x, cible.y);
      const a = await page.evaluate(() => ({ l: window.__lireFenetre(), vol: document.querySelector('#posOverlay .edit-modal').getAnimations().length > 0 }));
      await F.repos(page, 600);
      const b = await page.evaluate(LIRE);
      res.push({ nom: 'ordinateur, fiche ouverte depuis sa ligne', joue: a.vol, ecart: ecart(a.l.fiche, b.fiche), photo: 0, avant: a.l.fiche, apres: b.fiche });
      await fermerTout(page);
    }
  } finally {
    await ctx.close();
  }
  return { res, erreurs };
}

async function main() {
  const navigateur = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    if (!CONTRE) {
      const serveur = await F.servir({ port: PORT });
      try {
        for (const appareil of ['ordinateur', 'telephone']) {
          console.log(`\n[${appareil.toUpperCase()}]`);
          const { res, erreurs } = await scenario(navigateur, appareil, PORT);
          for (const r of res) {
            ok(r.joue, `${r.nom} : l entree a bien joue (sinon la mesure ne prouverait rien)`);
            ok(r.ecart <= tolerance(appareil, r.apres), `${r.nom} : la fenetre a sa vraie boite des la premiere image (ecart ${Number.isFinite(r.ecart) ? r.ecart.toFixed(2) : 'aucune boite'} px)`, { avant: r.avant, apres: r.apres });
            if (r.nom.includes('fiche') && r.nom.includes('sans origine')) ok(r.photo <= tolerance(appareil, { w: 40, h: 40 }), `${r.nom} : la photo de l activite a sa vraie taille tout de suite (ecart ${Number.isFinite(r.photo) ? r.photo.toFixed(2) : 'aucune photo'} px)`);
          }
          ok(erreurs.length === 0, `${appareil} : aucune erreur JavaScript`, erreurs.slice(0, 2));
        }
      } finally { serveur.close(); }
    } else {
      console.log('\n[CONTRE-PREUVE] l ancienne entree, la vraie fenetre grandit de 97 % a 100 %');
      let ancre = false;
      const transformer = (rel, texte) => {
        if (rel !== 'assets/pinlane-mouvement.js') return texte;
        if (texte.includes(ENTREE_JUSTE)) ancre = true;
        return texte.split(ENTREE_JUSTE).join(ENTREE_ANCIENNE);
      };
      const serveur = await F.servir({ port: PORT + 1, transformer });
      try {
        const { res } = await scenario(navigateur, 'telephone', PORT + 1, { seulementFicheTelephone: true });
        if (!ok(ancre, 'contre-preuve : l entree juste est trouvee dans le module (sinon la mutation ne prouverait rien)')) return;
        const r = res[0];
        ok(Boolean(r) && r.joue && (r.ecart > 0.5 || r.photo > 0.5), `contre-preuve : avec l ancienne entree, la boite lue tout de suite differe (ecart ${r ? r.ecart.toFixed(2) : '?'} px, photo ${r ? r.photo.toFixed(2) : '?'} px) : le gate ROUGIRAIT`);
      } finally { serveur.close(); }
    }
  } finally {
    await navigateur.close();
  }
  console.log(`\nfenetre-taille-juste-check${CONTRE ? ' --contre-preuves' : ''} : ${echecs ? echecs + ' FAIL' : 'tout vert'}`);
  process.exit(echecs ? 1 : 0);
}

main().catch((e) => { console.error('ECHEC', e); process.exit(1); });
