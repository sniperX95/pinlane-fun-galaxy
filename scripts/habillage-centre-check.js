// LA PAGE DE RESERVATION D UN CENTRE NE MONTRE QUE CE CENTRE (2026-11-17, avant-lancement D1).
//
// fungalaxy.html portait le premier client en dur : le titre de l onglet, le logo et son lien vers
// fungalaxy.be, le violet et la sarcelle, « Carte Fun Galaxy ». Un autre centre les aurait montres.
// La page est maintenant neutre, et l habillage est une donnee du centre, calculee a un seul endroit
// (lib/habillage-formulaire.js), servie par /api/public-booking-meta (center.habillage) et posee par
// assets/fungalaxy-habillage.js avant le premier affichage.
//
// [A] LA REGLE, sans navigateur. Fun Galaxy garde exactement son titre, sa carte, son logo et ses sept
//     couleurs. Un centre sans marque declaree recoit du neutre et jamais le mot « Fun Galaxy ». Les
//     couleurs calculees restent lisibles (du blanc sur l accent, l encre sur le fond, un texte sombre
//     sur la seconde couleur), meme pour un accent jaune clair. Les teintes reglees a la main passent
//     la normalisation, et survivent a une config enregistree en base qui ne les connait pas. La page,
//     le script et la feuille ne nomment plus aucun centre. La feuille porte les couleurs neutres que
//     la regle calcule. Les instantanes du depot sont a jour. Les deux lectures du centre de l adresse
//     (fungalaxy-habillage.js, fungalaxy-booking.js) rendent la meme chose.
// [B] UN AUTRE CENTRE, dans un navigateur. Avant la reponse du serveur : page neutre, aucun logo,
//     aucune requete vers le logo de Fun Galaxy. Apres : son titre, son logo sur une plaque claire, son
//     lien, ses couleurs jusque sur le bouton, « Carte » a son nom, et plus une seule mention de Fun
//     Galaxy dans la page. A la seconde visite, tout est pose avant la reponse (memoire du navigateur).
// [C] FUN GALAXY, dans un navigateur. Avant la reponse du serveur, la page est deja la sienne (son
//     instantane) : logo, titre, couleurs. Apres, rien n a bouge.
// [D] UN CENTRE QUI N A RIEN DECLARE : neutre, sans logo, son nom dans l onglet, bouton lisible.
// [E] L ADRESSE NUE N APPARTIENT A PERSONNE (D3). /reserver sans centre ouvrait Libramont depuis le 10/11 ; elle
//     sert la demonstration Pinlane, des la premiere image, et le catalogue demande est celui de la
//     demonstration. /fungalaxy sans centre reste Libramont. Une ligne d installation sans centre ne monte
//     aucun formulaire, avec ou sans data-design, et le dit dans la console du navigateur.
//
// Tout tourne sur le banc local (scripts/dev-tunnel-server.js) : aucune base, aucun reseau sortant.
// Les contre-preuves servent le code mute en memoire : aucun fichier n est ecrit.
// Lancement : node scripts/habillage-centre-check.js [--contre-preuves]

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_HABILLAGE_PORT || 4397);
const BASE = `http://127.0.0.1:${PORT}`;
const NAVIGATEUR = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// ---------- les mutations (contre-preuves), appliquees en memoire ----------
const MUTATIONS = {
  'titre-en-dur': { f: 'fungalaxy.html', de: '<title>Réserver en ligne</title>', vers: '<title>Réserver chez Fun Galaxy</title>', lettre: 'A' },
  'logo-en-dur': { f: 'fungalaxy.html', de: '<a class="fg-top__brand" hidden><img class="fg-top__logo" alt=""></a>', vers: '<a href="https://fungalaxy.be/" class="fg-top__brand"><img class="fg-top__logo" src="/assets/brand/logo-fun-galaxy.svg" alt="Fun Galaxy"></a>', lettre: 'B' },
  'carte-en-dur': { f: 'assets/fungalaxy-booking.js', de: "titre: carteDeJeu(), choisie: ar.mode,", vers: "titre: 'Carte Fun Galaxy', choisie: ar.mode,", lettre: 'B' },
  'couleurs-en-dur': { f: 'assets/fungalaxy-booking.css', de: '  --fg-purple: #0070f3;', vers: '  --fg-purple: #944292;', lettre: 'D' },
  'reponse-non-posee': { f: 'assets/fungalaxy-booking.js', de: 'if (window.PinlaneHabillage) window.PinlaneHabillage.appliquer(habillage);', vers: '', lettre: 'B' },
  'instantane-ignore': { f: 'assets/fungalaxy-habillage.js', de: "else if (CENTRE !== 'centre-inconnu') doc.write(", vers: 'else if (false) doc.write(', lettre: 'C' },
  'memoire-ignoree': { f: 'assets/fungalaxy-habillage.js', de: "if (garde) poser(garde, 'memoire');", vers: "if (false) poser(garde, 'memoire');", lettre: 'B' },
  'couleurs-non-posees': { f: 'assets/fungalaxy-habillage.js', de: '    poserCouleurs(h.couleurs);\n', vers: '', lettre: 'B' },
  'serveur-sans-couleurs': { f: 'lib/habillage-formulaire.js', de: '    couleurs: couleursDuFormulaire(c.branding),', vers: '    couleurs: null,', lettre: 'A' },
  'contraste-non-garanti': { f: 'lib/habillage-formulaire.js', de: 'const accent = jusquA(jusquA(accentDeclare, NOIR, 4.5, BLANC), BLANC, 3, FOND);', vers: 'const accent = accentDeclare;', lettre: 'A' },
  'cadre-photo-vide': { f: 'assets/fungalaxy-booking.js', de: "    body.classList.toggle('fg-sans-photos', !pool.length);\n", vers: '', lettre: 'D' },
  'marque-du-voisin': { f: 'lib/habillage-formulaire.js', de: "    carte: marque ? `Carte ${marque}` : 'Carte de jeu',", vers: "    carte: 'Carte Fun Galaxy',", lettre: 'A' },
  'teintes-reglees-jetees': { f: 'lib/center-config.js', de: '...(formulaire ? { formulaire } : {}), ', vers: '', lettre: 'A' },
  'centre-de-l-adresse-different': { f: 'assets/fungalaxy-habillage.js', de: "return SLUG_RX.test(brut) ? brut : 'centre-inconnu';", vers: "return SLUG_RX.test(brut) ? brut : 'libramont';", lettre: 'A' },
  'adresse-nue-au-premier-client': { f: 'assets/fungalaxy-booking.js', de: "    if (!brut) return /^\\/fungalaxy\\/?$/i.test(window.location.pathname) ? 'libramont' : 'demo';", vers: "    if (!brut) return 'libramont';", lettre: 'E' },
  'ligne-sans-centre-montee': { f: 'embed.js', de: '  if (!center) {', vers: "  if ((script.getAttribute('data-design') || '').toLowerCase() === 'fungalaxy' && !center) {", lettre: 'E' },
};
const MUTATION = (process.argv.find((a) => a.startsWith('--mutation=')) || '').slice('--mutation='.length);
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`mutation inconnue : ${MUTATION}`); process.exit(2); }

const brut = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
function lf(f) {
  let t = brut(f);
  const m = MUTATION ? MUTATIONS[MUTATION] : null;
  if (m && m.f === f) {
    if (t.split(m.de).length !== 2) throw new Error(`ANCRE DE MUTATION absente ou multiple (${MUTATION}) dans ${f}`);
    t = t.split(m.de).join(m.vers);
  }
  return t;
}
// Le code du serveur se charge mute lui aussi, sans toucher au disque.
const compiler = Module.prototype._compile;
Module.prototype._compile = function compilerMute(contenu, fichier) {
  const m = MUTATION ? MUTATIONS[MUTATION] : null;
  if (m && path.resolve(fichier) === path.join(ROOT, m.f)) {
    const t = String(contenu).split('\r\n').join('\n');
    if (t.split(m.de).length !== 2) throw new Error(`ANCRE DE MUTATION absente ou multiple (${MUTATION}) dans ${m.f}`);
    return compiler.call(this, t.split(m.de).join(m.vers), fichier);
  }
  return compiler.call(this, contenu, fichier);
};

let rouges = 0;
let lettre = '';
function section(titre) { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); }
function ok(condition, quoi, detail) {
  if (condition) { console.log(`ok    ${quoi}`); return; }
  rouges += 1;
  console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(detail).slice(0, 300)}` : ''}`);
}

// ---------- les contre-preuves ----------
if (process.argv.includes('--contre-preuves')) {
  // Une contre-preuve ne vaut que si le gate est vert sans elle.
  const temoin = spawnSync(process.execPath, [__filename], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PINLANE_HABILLAGE_PORT: String(PORT + 1) }, timeout: 240000 });
  if (temoin.status !== 0) {
    console.log(`${temoin.stdout || ''}${temoin.stderr || ''}`.split('\n').filter((l) => /ROUGE|Error/.test(l)).join('\n'));
    console.log('\nhabillage-centre-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte');
    process.exit(1);
  }
  let rates = 0;
  for (const [nom, m] of Object.entries(MUTATIONS)) {
    const r = spawnSync(process.execPath, [__filename, `--mutation=${nom}`], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PINLANE_HABILLAGE_PORT: String(PORT + 1) }, timeout: 240000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const mord = r.status === 1 && sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION/.test(sortie);
    if (!mord) rates += 1;
    console.log(`${mord ? 'TUEE ' : 'VIVANTE'} ${nom} (attendu : ROUGE [${m.lettre}], sortie ${r.status})${mord ? '' : `\n${sortie.split('\n').filter((l) => /ROUGE|ANCRE|Error/.test(l)).slice(0, 6).join('\n')}`}`);
  }
  console.log(rates ? `\nhabillage-centre-check --contre-preuves: ${rates} mutation(s) vivante(s)` : '\nhabillage-centre-check --contre-preuves: ALL OK - chaque regle retiree fait rougir sa lettre');
  process.exit(rates ? 1 : 0);
}

const H = require('../lib/habillage-formulaire');
const CC = require('../lib/center-config');
const CENTRES = require('../ops-knowledge/centers.json').centers;
const duFichier = (id) => { const c = CENTRES.find((x) => x.id === id); return { id: c.id, name: c.name, city: c.publicInfo && c.publicInfo.city, identity: c.identity, branding: c.branding }; };

// Les sept couleurs que le formulaire de Fun Galaxy portait en dur avant le 17/11 : elles ne bougent pas.
const FUN_GALAXY = { accent: '#944292', accentVif: '#b04fb0', accentEncre: '#d98ad4', accentTitre: '#c25ec2', second: '#67baac', secondEncre: '#8fd6c9', secondSombre: '#3f8c84' };
const ATLAS = { id: 'atlas-namur', name: 'Bowling Atlas Namur', city: 'Namur', identity: { logoUrl: '/assets/brand/pinlane-logo.svg', siteUrl: 'https://bowling-atlas.example' }, branding: { accent: '#e4572e', glow: '#ffd166' } };
const SANS_RIEN = { id: 'salle-test', name: 'Salle Test', city: '', identity: null, branding: null };
// Ce qu un visiteur peut lire ou suivre : le nom, le site, le logo. Les noms techniques des fichiers
// (fungalaxy-booking.js) datent du premier client et ne se voient pas a l ecran.
const MARQUE_FG = /fun[\s-]galaxy|fungalaxy\.be/i;
const rvbDe = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const canauxDe = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');

function regle() {
  section('[A] LA REGLE : ce que chaque centre montre, calcule a un seul endroit');
  const lib = H.habillageDuFormulaire(duFichier('libramont'));
  const gem = H.habillageDuFormulaire(duFichier('gembloux'));
  ok(lib.titre === 'Réserver à Libramont · Fun Galaxy' && gem.titre === 'Réserver à Gembloux · Fun Galaxy', 'Fun Galaxy garde le titre de ses onglets', `${lib.titre} | ${gem.titre}`);
  ok(lib.carte === 'Carte Fun Galaxy' && gem.carte === 'Carte Fun Galaxy' && H.habillageDuFormulaire(duFichier('ciney')).carte === 'Carte Fun Galaxy', 'Fun Galaxy garde le nom de sa carte de jeu, a Ciney aussi (sans ville saisie, par son identifiant)');
  ok(lib.logo === '/assets/brand/logo-fun-galaxy.svg' && lib.logoSurSombre === true && lib.site === 'https://fungalaxy.be' && lib.logoAlt === 'Fun Galaxy', 'Fun Galaxy garde son logo, sans plaque, et le lien de son site', JSON.stringify([lib.logo, lib.logoSurSombre, lib.site, lib.logoAlt]));
  ok(JSON.stringify(lib.couleurs) === JSON.stringify(FUN_GALAXY) && JSON.stringify(gem.couleurs) === JSON.stringify(FUN_GALAXY), 'Fun Galaxy garde ses sept couleurs, au caractere pres', JSON.stringify(lib.couleurs));

  const atlas = H.habillageDuFormulaire(ATLAS);
  const rien = H.habillageDuFormulaire(SANS_RIEN);
  const demo = H.habillageDuFormulaire(duFichier('demo'));
  ok(atlas.titre === 'Réserver à Namur · Bowling Atlas' && atlas.carte === 'Carte Bowling Atlas' && atlas.logoAlt === 'Bowling Atlas', 'un autre centre porte SON nom dans l onglet et sur sa carte de jeu', `${atlas.titre} | ${atlas.carte}`);
  ok(rien.titre === 'Réserver · Salle Test' && rien.carte === 'Carte de jeu' && rien.couleurs === null && rien.logo === '' && rien.site === '', 'un centre qui n a rien declare : son nom, « Carte de jeu », aucune couleur, aucun logo', JSON.stringify(rien));
  ok(![atlas, rien, demo, H.habillageDuFormulaire({})].some((h) => MARQUE_FG.test(JSON.stringify(h))), 'aucun centre qui n est pas Fun Galaxy ne recoit le nom, le site ou le logo de Fun Galaxy');
  ok(atlas.couleurs && atlas.couleurs.second === '#ffd166' && !Object.values(atlas.couleurs).some((c) => Object.values(FUN_GALAXY).includes(c)), 'ses couleurs viennent de SA marque, aucune de celles de Fun Galaxy', JSON.stringify(atlas.couleurs));

  // Lisible quel que soit l accent declare : du blanc dessus, l encre sur le fond, du sombre sur la seconde.
  const accents = ['#ffe45c', '#f59e0b', '#e4572e', '#0b2a5b', '#111111', '#22c55e', '#ffffff', '#944292'];
  const illisibles = [];
  accents.forEach((accent) => {
    [{ accent }, { accent, glow: '#101010' }, { accent, glow: '#ffd166' }].forEach((marque) => {
      const c = H.couleursDuFormulaire(marque);
      if (!c) { illisibles.push(`${accent} : aucune couleur`); return; }
      const mesures = { 'accent sur fond': H.contraste(c.accent, H.FOND), 'blanc sur accent': H.contraste('#ffffff', c.accent), 'blanc sur accent vif': H.contraste('#ffffff', c.accentVif), 'titre sur fond': H.contraste(c.accentTitre, H.FOND), 'encre sur fond': H.contraste(c.accentEncre, H.FOND), 'sombre sur seconde': H.contraste(H.SUR_SECOND, c.second), 'encre seconde sur fond': H.contraste(c.secondEncre, H.FOND) };
      const mins = { 'accent sur fond': 3, 'blanc sur accent': 4.5, 'blanc sur accent vif': 3, 'titre sur fond': 4.5, 'encre sur fond': 4.5, 'sombre sur seconde': 4.5, 'encre seconde sur fond': 4.5 };
      Object.entries(mesures).forEach(([quoi, v]) => { if (v < mins[quoi] - 0.01) illisibles.push(`${JSON.stringify(marque)} ${quoi} ${v.toFixed(2)}`); });
    });
  });
  ok(!illisibles.length, `les couleurs calculees restent lisibles pour ${accents.length} accents, du jaune clair au noir`, illisibles.slice(0, 4).join(' ; '));
  ok(H.couleursDuFormulaire({ accent: 'rouge' }) === null && H.couleursDuFormulaire({ accent: '#12345' }) === null && H.couleursDuFormulaire(null) === null, 'une couleur mal ecrite ne donne aucun habillage (la page reste neutre)');

  // Les teintes reglees a la main : une donnee du centre, qui survit a une config enregistree en base.
  const marqueFichier = CENTRES.find((c) => c.id === 'libramont').branding;
  const enBase = { accent: '#944292', accentStrong: '#944292', accentSoft: '#f6f0f6', accentContrast: '#ffffff', glow: '#67baac', cards: 'neon', buttons: 'neon', dark: { accent: '#944292', accentStrong: '#a664a4', accentSoft: '#1d121d', accentContrast: '#ededed', glow: '#67baac' } };
  const fusion = CC.normalizeBranding(CC.mergeCenterConfig({ branding: marqueFichier }, { branding: enBase }).branding);
  ok(fusion && fusion.formulaire && JSON.stringify(H.couleursDuFormulaire(fusion)) === JSON.stringify(FUN_GALAXY), 'les teintes reglees de Fun Galaxy passent la normalisation et une config enregistree en base qui ne les connait pas', JSON.stringify(fusion && fusion.formulaire));
  ok(CC.normalizeBranding({ accent: '#112233', formulaire: { accentVif: 'javascript:alert(1)', accentEncre: '#abcdef', autre: '#000000' } }).formulaire.accentVif === undefined && Object.keys(CC.normalizeBranding({ accent: '#112233', formulaire: { accentEncre: '#abcdef', autre: '#000000' } }).formulaire).join() === 'accentEncre', 'une teinte reglee n accepte qu une couleur en hexadecimal, et que les cinq cles connues');

  // La page, le script et la feuille ne nomment plus aucun centre.
  const page = lf('fungalaxy.html');
  const script = lf('assets/fungalaxy-booking.js');
  const feuille = lf('assets/fungalaxy-booking.css');
  const sansCommentairesHtml = page.replace(/<!--[\s\S]*?-->/g, '');
  ok(!MARQUE_FG.test(sansCommentairesHtml) && /<title>Réserver en ligne<\/title>/.test(page), 'la page ne nomme aucun centre : ni titre, ni logo, ni lien', (sansCommentairesHtml.match(MARQUE_FG) || [''])[0]);
  ok(/<script src="\/assets\/fungalaxy-habillage\.js\?v=[0-9a-z]+"><\/script>[\s\S]*<link rel="stylesheet" href="\/assets\/fungalaxy-booking\.css/.test(page) && !/fungalaxy-habillage\.js[^>]*\b(defer|async)\b/.test(page), 'le script de l habillage passe avant la feuille de style, sans attendre');
  const chaines = (script.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) || []).filter((s) => /Fun Galaxy|fungalaxy\.be/.test(s));
  ok(!chaines.length, 'le script du formulaire n ecrit plus « Fun Galaxy » dans aucun texte', chaines.slice(0, 2).join(' '));
  const sansCommentairesCss = feuille.replace(/\/\*[\s\S]*?\*\//g, '');
  const enDur = Object.values(FUN_GALAXY).filter((c) => sansCommentairesCss.toLowerCase().includes(c)).concat(['148, 66, 146', '176, 79, 176', '103, 186, 172', '194, 94, 194', '143, 214, 201'].filter((c) => sansCommentairesCss.includes(c)));
  ok(!enDur.length, 'la feuille du formulaire ne porte plus aucune couleur de Fun Galaxy en dur', enDur.join(' '));
  ok(!/194, 94, 194|#944292|#67baac/i.test(lf('assets/fungalaxy-sur-mesure.css').replace(/\/\*[\s\S]*?\*\//g, '')), 'la feuille de la demande sur mesure non plus');

  // La feuille porte les couleurs neutres que la regle calcule.
  const neutres = H.couleursNeutres();
  const jeton = (nom) => (sansCommentairesCss.match(new RegExp(`\\n\\s*${nom}:\\s*([^;]+);`)) || [])[1];
  const attendus = { '--fg-purple': neutres.accent, '--fg-purple-2': neutres.accentVif, '--fg-purple-ink': neutres.accentEncre, '--fg-purple-em': neutres.accentTitre, '--fg-teal': neutres.second, '--fg-teal-ink': neutres.secondEncre, '--fg-teal-dim': neutres.secondSombre, '--fg-purple-rvb': canauxDe(neutres.accent), '--fg-purple-2-rvb': canauxDe(neutres.accentVif), '--fg-purple-em-rvb': canauxDe(neutres.accentTitre), '--fg-teal-rvb': canauxDe(neutres.second), '--fg-teal-ink-rvb': canauxDe(neutres.secondEncre) };
  const ecartsFeuille = Object.entries(attendus).filter(([nom, v]) => jeton(nom) !== v).map(([nom, v]) => `${nom} ${jeton(nom)} (attendu ${v})`);
  ok(!ecartsFeuille.length && neutres.accent === H.ACCENT_NEUTRE, 'la feuille porte les couleurs neutres de la regle (l accent de la plateforme et ses tons)', ecartsFeuille.join(' ; '));

  // Les instantanes du depot.
  const instantanes = require('./habillage-instantanes');
  const ecarts = instantanes.ecarts();
  ok(!ecarts.length, 'les instantanes des centres du depot sont a jour (node scripts/habillage-instantanes.js)', ecarts.join(' ; '));
  ok(instantanes.instantanes().every((i) => i.id === 'libramont' || i.id === 'gembloux' || i.id === 'ciney' ? /Fun Galaxy/.test(i.contenu) : !MARQUE_FG.test(i.contenu)), 'un instantane ne porte que la marque de son centre');

  // Le centre de l adresse : la meme regle dans les deux scripts.
  const fonction = (source) => (source.match(/function centreDepuisAdresse\(\) \{[\s\S]*?\n  \}/) || [''])[0];
  const lire = (source, adresse) => {
    const u = new URL(adresse, 'https://app.pinlane.be');
    const window = { location: { pathname: u.pathname, search: u.search } };
    const params = new URLSearchParams(u.search);
    const SLUG_RX = /^[a-z][a-z0-9-]{1,40}$/;
    return new Function('window', 'params', 'SLUG_RX', `${fonction(source)}; return centreDepuisAdresse();`)(window, params, SLUG_RX);
  };
  const adresses = ['/reserver', '/reserver/', '/reserver/gembloux', '/fungalaxy/libramont', '/fungalaxy/Gembloux/', '/reserver?center=ciney', '/reserver?centerId=demo&embed=1', '/reserver/atlas-namur', '/reserver/constructor', '/reserver/%3Cscript%3E', '/reserver/a', '/reserver?center=..%2F..', '/reserver/%E0%A4%A', '/fungalaxy'];
  const habillageJs = lf('assets/fungalaxy-habillage.js');
  const divergences = adresses.filter((a) => lire(habillageJs, a) !== lire(script, a)).map((a) => `${a} : ${lire(habillageJs, a)} / ${lire(script, a)}`);
  ok(fonction(habillageJs) && fonction(script) && !divergences.length, `les deux scripts lisent le meme centre dans ${adresses.length} adresses`, divergences.join(' ; '));
  ok(lire(script, '/reserver/%3Cscript%3E') === 'centre-inconnu' && lire(script, '/reserver/atlas-namur') === 'atlas-namur', 'une adresse qui nomme mal son centre ne designe aucun centre');
  ok(lire(habillageJs, '/reserver') === 'demo' && lire(habillageJs, '/reserver?embed=1') === 'demo' && lire(habillageJs, '/fungalaxy') === 'libramont' && lire(habillageJs, '/fungalaxy/') === 'libramont', 'l adresse nue /reserver designe la demonstration, /fungalaxy nu reste Libramont', [lire(habillageJs, '/reserver'), lire(habillageJs, '/fungalaxy')].join(' '));
}

async function navigateur() {
  const { chromium } = require('playwright-core');
  const mock = require('./dev-tunnel-server');
  const server = mock.createServer({ port: PORT });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ headless: true, executablePath: NAVIGATEUR });
  const MIME = { 'fungalaxy.html': 'text/html; charset=utf-8', 'assets/fungalaxy-booking.js': 'text/javascript; charset=utf-8', 'assets/fungalaxy-habillage.js': 'text/javascript; charset=utf-8', 'embed.js': 'text/javascript; charset=utf-8', 'assets/fungalaxy-booking.css': 'text/css; charset=utf-8' };

  // Une page du formulaire, servie par le banc, avec le code (mute ou non) lu en memoire. `centre` :
  // la reponse du serveur decrit ce centre-la, habille par la vraie regle. `porte` retient la reponse
  // du serveur tant qu elle n est pas ouverte : on regarde la page AVANT.
  async function ouvrir(ctx, adresse, centre) {
    const page = await ctx.newPage();
    const vu = { requetes: [], erreurs: [], catalogues: [] };
    let ouvrirLaPorte;
    const porte = new Promise((r) => { ouvrirLaPorte = r; });
    page.on('pageerror', (e) => vu.erreurs.push(e.message));
    page.on('request', (r) => { const u = new URL(r.url()); vu.requetes.push(u.pathname); if (u.pathname === '/api/public-booking-meta' && r.method() === 'GET') vu.catalogues.push(u.searchParams.get('centerId') || ''); });
    await page.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      const fichier = /^\/(?:reserver|fungalaxy)(?:\/[a-z0-9-]+)?\/?$/.test(u.pathname) ? 'fungalaxy.html' : u.pathname.replace(/^\//, '');
      if (MIME[fichier]) return route.fulfill({ status: 200, contentType: MIME[fichier], body: lf(fichier) });
      if (u.pathname === '/api/public-booking-meta' && route.request().method() === 'GET') {
        const reponse = await route.fetch();
        const json = await reponse.json();
        if (centre) {
          // Le centre du test a SES coordonnees : celles du banc sont celles de Libramont.
          json.center = { ...json.center, id: centre.id, name: centre.name, city: centre.city, address: '', contact: { phone: '', email: `bonjour@${centre.id}.example` }, identity: centre.identity, branding: centre.branding, habillage: H.habillageDuFormulaire(centre) };
          json.activities = json.activities.map((a) => (a.id === 'arcade_time' ? { ...a, arcadeOffers: { enabled: true, timeOffers: [{ id: 'demi-heure', minutes: 30, price: 6 }], creditOffers: [{ id: 'vingt', credits: 20, bonusCredits: 5, price: 10 }] } } : a));
        }
        await porte;
        return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(json) });
      }
      return route.continue();
    });
    await page.goto(BASE + adresse, { waitUntil: 'domcontentloaded' });
    const pret = async () => { ouvrirLaPorte(); await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 15000 }); await page.waitForTimeout(250); };
    return { page, vu, pret };
  }
  const etat = (page) => page.evaluate(() => {
    const racine = document.documentElement;
    const style = getComputedStyle(racine);
    const lien = document.querySelector('.fg-top__brand');
    const logo = document.querySelector('.fg-top__logo');
    const bouton = document.querySelector('.fg-scene.is-active .fg-btn');
    const ville = document.querySelector('.fg-top .fg-centre');
    const boite = logo ? logo.getBoundingClientRect() : { width: 0, height: 0 };
    return {
      titre: document.title,
      source: racine.getAttribute('data-habillage') || '',
      accent: style.getPropertyValue('--fg-purple').trim(),
      second: style.getPropertyValue('--fg-teal').trim(),
      canaux: style.getPropertyValue('--fg-purple-rvb').trim(),
      toutes: ['--fg-purple', '--fg-purple-2', '--fg-purple-ink', '--fg-purple-em', '--fg-teal', '--fg-teal-ink', '--fg-teal-dim'].map((n) => style.getPropertyValue(n).trim()).join(','),
      logoVisible: !!(lien && !lien.hidden && getComputedStyle(lien).display !== 'none' && logo && logo.getAttribute('src')),
      logo: logo ? logo.getAttribute('src') || '' : '',
      lien: lien ? lien.getAttribute('href') || '' : '',
      plaque: !!(lien && lien.classList.contains('fg-top__brand--clair')),
      logoBoite: [Math.round(boite.width), Math.round(boite.height)],
      bouton: bouton ? getComputedStyle(bouton).backgroundColor : '',
      boutonTexte: bouton ? getComputedStyle(bouton).color : '',
      fondVille: ville ? getComputedStyle(ville).backgroundColor : '',
      // Le passage ou la page nomme Fun Galaxy, vide s il n y en a pas (commentaires du code exclus).
      // Le cadre de la photo : sa taille a l ecran, et s il porte une image.
      cadrePhoto: (() => { const a = document.querySelector('.fg-scene.is-active .fg-art'); const r = a ? a.getBoundingClientRect() : { width: 0, height: 0 }; const i = a && a.querySelector('img'); return { visible: r.width > 0 && r.height > 0, image: !!(i && (i.getAttribute('src') || i.getAttribute('data-src'))) }; })(),
      marqueFunGalaxy: (document.documentElement.outerHTML.replace(/<!--[\s\S]*?-->/g, '').match(/.{0,60}(?:fun[\s-]galaxy|fungalaxy\.be).{0,40}/i) || [''])[0],
    };
  });

  section('[B] UN AUTRE CENTRE : sa page ne montre que lui');
  const habAtlas = H.habillageDuFormulaire(ATLAS);
  const ctxB = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
  let b = await ouvrir(ctxB, '/reserver/atlas-namur', ATLAS);
  await b.page.waitForTimeout(700);
  let avant = await etat(b.page);
  ok(avant.titre === 'Réserver en ligne' && !avant.logoVisible && avant.accent === H.couleursNeutres().accent && !avant.marqueFunGalaxy, 'avant la reponse du serveur : onglet neutre, aucun logo, couleurs neutres, aucune mention de Fun Galaxy', JSON.stringify(avant));
  ok(b.vu.requetes.includes('/assets/habillage/atlas-namur.js') && !b.vu.erreurs.length, 'un centre sans instantane : la page le demande, ne le trouve pas, et rien ne casse', b.vu.erreurs.join(' | '));
  await b.pret();
  let apres = await etat(b.page);
  ok(apres.titre === 'Réserver à Namur · Bowling Atlas', 'apres : SON titre dans l onglet', apres.titre);
  ok(apres.logoVisible && apres.logo === '/assets/brand/pinlane-logo.svg' && apres.lien === 'https://bowling-atlas.example' && apres.plaque, 'SON logo, sur une plaque claire (il est dessine pour un fond clair), avec SON lien', JSON.stringify([apres.logo, apres.lien, apres.plaque]));
  ok(apres.logoBoite[0] > 96 && apres.logoBoite[0] <= 170 && apres.logoBoite[1] > 10 && apres.logoBoite[1] <= 60, 'un logo tout en longueur s elargit sans depasser 170 px sur 60', apres.logoBoite.join('x'));
  ok(apres.accent === habAtlas.couleurs.accent && apres.second === habAtlas.couleurs.second && apres.canaux === canauxDe(habAtlas.couleurs.accent) && apres.source === 'serveur', 'SES couleurs sont posees sur la page', JSON.stringify([apres.accent, apres.second, apres.canaux, apres.source]));
  ok(apres.bouton === rvbDe(habAtlas.couleurs.accent) && apres.fondVille === rvbDe(habAtlas.couleurs.second), 'jusque sur le bouton et sur l etiquette de la ville', `${apres.bouton} ${apres.fondVille}`);
  ok(!apres.marqueFunGalaxy && !b.vu.requetes.some((r) => /logo-fun-galaxy|^\/assets\/fungalaxy\//.test(r)), 'plus une mention de Fun Galaxy dans la page, aucune requete vers son logo ni ses photos', `${apres.marqueFunGalaxy} ${b.vu.requetes.filter((r) => /logo-fun-galaxy|^\/assets\/fungalaxy\//.test(r)).slice(0, 3).join(' ')}`);
  // La carte de jeu des arcades.
  await b.page.click('.fg-scene.is-active .fg-btn');
  await b.page.waitForTimeout(900);
  const carte = await b.page.evaluate(async () => {
    const carteArcade = [...document.querySelectorAll('#gridAct .fg-grid__item')].find((e) => /arcade/i.test(e.textContent || ''));
    if (!carteArcade) return 'pas de carte Arcades';
    (carteArcade.querySelector('.fg-card') || carteArcade).click();
    await new Promise((r) => setTimeout(r, 900));
    return [...document.querySelectorAll('.fg-scene.is-active *')].filter((e) => !e.children.length).map((e) => (e.textContent || '').trim()).filter((s) => /^Carte\b/.test(s)).join(' | ') || 'aucun intitulé « Carte »';
  });
  ok(/Carte Bowling Atlas/.test(carte) && !/Fun Galaxy/.test(carte), 'la carte de jeu des arcades porte SON nom', carte);
  await b.page.close();
  // Seconde visite, meme navigateur : tout est pose avant la reponse.
  b = await ouvrir(ctxB, '/reserver/atlas-namur', ATLAS);
  await b.page.waitForTimeout(700);
  avant = await etat(b.page);
  ok(avant.source === 'memoire' && avant.titre === 'Réserver à Namur · Bowling Atlas' && avant.accent === habAtlas.couleurs.accent && avant.logoVisible && avant.bouton === rvbDe(habAtlas.couleurs.accent), 'seconde visite : son habillage est pose AVANT la reponse du serveur', JSON.stringify([avant.source, avant.titre, avant.accent, avant.logoVisible]));
  ok(!b.vu.requetes.includes('/assets/habillage/atlas-namur.js'), 'et la page ne redemande pas d instantane');
  await b.pret();
  await ctxB.close();

  section('[C] FUN GALAXY : sa page est la sienne des la premiere image');
  const ctxC = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
  const c = await ouvrir(ctxC, '/fungalaxy/libramont', null);
  await c.page.waitForTimeout(700);
  const cAvant = await etat(c.page);
  ok(cAvant.source === 'instantane' && cAvant.titre === 'Réserver à Libramont · Fun Galaxy' && cAvant.logoVisible && cAvant.logo === '/assets/brand/logo-fun-galaxy.svg' && !cAvant.plaque, 'avant la reponse du serveur : son titre, son logo sans plaque (son instantane)', JSON.stringify([cAvant.source, cAvant.titre, cAvant.logo, cAvant.plaque]));
  ok(cAvant.toutes === Object.values(FUN_GALAXY).join(',') && cAvant.bouton === 'rgb(148, 66, 146)' && cAvant.canaux === '148, 66, 146', 'ses sept couleurs sont deja la, le bouton est violet', `${cAvant.toutes} ${cAvant.bouton}`);
  await c.pret();
  const cApres = await etat(c.page);
  ok(cApres.source === 'serveur' && cApres.titre === cAvant.titre && cApres.toutes === cAvant.toutes && cApres.logo === cAvant.logo && cApres.lien === 'https://fungalaxy.be' && cApres.logoBoite.join('x') === cAvant.logoBoite.join('x') && cApres.logoBoite[0] === 88, 'apres la reponse : rien n a bouge (titre, couleurs, logo de 88 px, lien)', JSON.stringify([cApres.source, cApres.titre, cApres.logoBoite, cApres.lien]));
  ok(cApres.cadrePhoto.visible && cApres.cadrePhoto.image, 'et sa photo est toujours la', JSON.stringify(cApres.cadrePhoto));
  ok(!c.vu.erreurs.length, 'aucune erreur dans la page', c.vu.erreurs.join(' | '));
  await ctxC.close();

  section('[D] UN CENTRE QUI N A RIEN DECLARE : neutre et lisible');
  const ctxD = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const d = await ouvrir(ctxD, '/reserver/salle-test', SANS_RIEN);
  await d.pret();
  const dApres = await etat(d.page);
  const neutres = H.couleursNeutres();
  ok(dApres.titre === 'Réserver · Salle Test' && !dApres.logoVisible && !dApres.marqueFunGalaxy, 'son nom dans l onglet, aucun logo, aucune mention de Fun Galaxy', JSON.stringify([dApres.titre, dApres.logoVisible, dApres.marqueFunGalaxy]));
  ok(dApres.accent === neutres.accent && dApres.bouton === rvbDe(neutres.accent) && dApres.fondVille === rvbDe(neutres.second), 'les couleurs neutres de la plateforme, sur le bouton et sur l etiquette', `${dApres.accent} ${dApres.bouton} ${dApres.fondVille}`);
  ok(dApres.boutonTexte === 'rgb(255, 255, 255)' && H.contraste('#ffffff', neutres.accent) >= 4.5, 'le bouton reste lisible (blanc sur l accent neutre, 4,5 au moins)', `${dApres.boutonTexte} ${H.contraste('#ffffff', neutres.accent).toFixed(2)}`);
  ok(!dApres.cadrePhoto.visible, 'un centre sans photos ne montre pas de cadre vide', JSON.stringify(dApres.cadrePhoto));
  ok(!d.vu.erreurs.length, 'aucune erreur dans la page', d.vu.erreurs.join(' | '));
  await ctxD.close();

  section('[E] L ADRESSE NUE N APPARTIENT A PERSONNE');
  const demo = H.habillageDuFormulaire(duFichier('demo'));
  const ctxE = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
  const nue = await ouvrir(ctxE, '/reserver', null);
  await nue.page.waitForTimeout(700);
  const nueAvant = await etat(nue.page);
  ok(nueAvant.source === 'instantane' && nueAvant.titre === demo.titre && nueAvant.logo === demo.logo && nueAvant.accent === H.couleursNeutres().accent && !nueAvant.marqueFunGalaxy, '/reserver sans centre : la demonstration Pinlane des la premiere image, rien de Fun Galaxy', JSON.stringify([nueAvant.source, nueAvant.titre, nueAvant.logo, nueAvant.accent, nueAvant.marqueFunGalaxy]));
  ok(nue.vu.catalogues.length > 0 && nue.vu.catalogues.every((c) => c === 'demo') && nue.vu.requetes.includes('/assets/habillage/demo.js') && !nue.vu.requetes.some((r) => /logo-fun-galaxy/.test(r)), 'le catalogue demande est celui de la demonstration, jamais celui de Libramont', nue.vu.catalogues.join(','));
  await nue.page.close();
  const nueFg = await ouvrir(ctxE, '/fungalaxy', null);
  await nueFg.page.waitForTimeout(700);
  const nueFgAvant = await etat(nueFg.page);
  ok(nueFgAvant.titre === 'Réserver à Libramont · Fun Galaxy' && nueFg.vu.catalogues.every((c) => c === 'libramont') && nueFg.vu.catalogues.length > 0, '/fungalaxy sans centre reste Libramont', `${nueFgAvant.titre} ${nueFg.vu.catalogues.join(',')}`);
  await nueFg.page.close();
  // Une ligne d installation sans centre et sans data-design.
  const hote = await ctxE.newPage();
  const erreursConsole = [];
  hote.on('console', (m) => { if (m.type() === 'error') erreursConsole.push(m.text()); });
  await hote.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/hote-sans-centre') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Site du centre</title></head><body><form id="ancien">Ancien formulaire</form><div class="pinlane-slot"></div><script src="/embed.js" data-target=".pinlane-slot"></script></body></html>' });
    if (u.pathname === '/embed.js') return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: lf('embed.js') });
    return route.continue();
  });
  await hote.goto(`${BASE}/hote-sans-centre`, { waitUntil: 'load' });
  await hote.waitForTimeout(1500);
  const cadres = await hote.locator('iframe').count();
  ok(cadres === 0 && erreursConsole.some((m) => /data-center/.test(m)), 'une ligne d installation sans centre ne monte aucun formulaire et le dit dans la console, meme sans data-design', `${cadres} cadre(s), console : ${erreursConsole.join(' | ').slice(0, 160)}`);
  await ctxE.close();

  await browser.close();
  server.close();
}

(async () => {
  regle();
  await navigateur();
  console.log(rouges ? `\nhabillage-centre-check: ${rouges} ROUGE(S)` : '\nhabillage-centre-check: ALL OK');
  process.exit(rouges ? 1 : 0);
})().catch((e) => { console.error(`ROUGE [${lettre}] le gate a plante : ${e && e.stack}`); process.exit(1); });
