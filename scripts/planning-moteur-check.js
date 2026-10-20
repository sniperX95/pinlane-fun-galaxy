// LE MOTEUR DU PLANNING GLOBAL, SOUS NODE (spec planning global v3, 15.2).
//
// assets/pinlane-planning-moteur.js est un calcul pur : une journee en donnees
// simples, un ecran, une regle de mesure des textes, et il rend le plan de la
// grille. Ce gate le fait tourner sans navigateur, avec un mesureur a largeurs
// fixes (7 px par caractere, 3 px l espace), sur les entrees que la console
// construit pour les six journees (scripts/fixtures/planning-v3/entree-*.json,
// reecrites par `node scripts/planning-v3-fixtures.js instantanes` ; le gate
// du navigateur verifie qu elles n ont pas vieilli) :
//   [M1] purete et determinisme : ni document, ni window, ni heure ; deux
//        calculs, deux plans identiques et la meme cle ;
//   [M2] la somme des colonnes vaut la largeur au pixel, chaque colonne
//        utilisee tient son plancher, les pistes sont egales ;
//   [M3] l ordre des phases : personne au-dessus de son essentiel tant
//        qu une colonne utilisee est dessous ; les colonnes vides attendent le
//        confort des autres ;
//   [M4] l echelle des noms de la spec (9.3), forme par forme ;
//   [M5] l unicite sur la journee pire : ni « Max. », ni « Jul. », ni
//        « Coll. » pour Collard ; Famille Martin (8) et (12) ;
//   [M6] le prefixe du jour (« DÉMO · »), et rien sans prefixe partage ;
//   [M7] 2 000 boites tirees d une graine fixe : la composition tient a la
//        coupure gloutonne recalculee ici, dans L lignes, avec une forme de
//        l echelle ; rien quand L = 0 ;
//   [M8] la geometrie ne depend pas de l heure ;
//   [M9] les parties laser : 2 min d ecart, les vagues fusionnees, A = max
//        des arenes, un petit groupe garde son essentiel.
//   --contre-preuves : chaque regle retiree (en memoire, au texte du module ;
//   le disque n est jamais touche) fait rougir sa lettre, et chaque ancre
//   existe une fois et une seule.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const util = require('util');
const FX = require('./planning-v3-fixtures');

const SOURCE = path.join(__dirname, '..', 'assets', 'pinlane-planning-moteur.js');

let echecs = 0;
let silence = false;
const rouges = [];
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}` : ''}`);
  return cond;
}

// Le moteur, charge depuis son texte dans un contexte neuf : ni document, ni
// window. (Une contre-preuve le charge modifie.)
function charger(texte) {
  const bac = { module: { exports: {} } };
  vm.runInNewContext(texte, bac, { filename: 'pinlane-planning-moteur.js' });
  return bac.module.exports;
}

// LE MESUREUR FIXE : 7 px par caractere, 3 px l espace (quelle que soit la police).
function FIXE(police, texte) { let w = 0; for (const c of String(texte)) w += c === ' ' ? 3 : 7; return w; }
const largeurFixe = (t) => FIXE('', t);
// (les objets du moteur viennent d un autre contexte : on compare leur JSON)
const memes = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Les ecrans du tableau 12 de la spec (largeur des colonnes, sans les heures).
const WD_ECRANS = [1522, 1868, 1079, 1388, 926, 1232, 869, 980, 698, 724];
const ENTREES = Object.fromEntries(FX.FIXTURES.map((f) => [f, FX.lireEntree(f)]));
function preparer(entree, Wd, H, extra = {}) {
  const e = JSON.parse(JSON.stringify(entree));
  Object.assign(e, extra);
  e.mesure = FIXE;
  const fenetre = extra.largeurFenetre || 1440;
  e.ecran = { W: Wd + (fenetre < 1200 ? 44 : 48), H, largeurFenetre: fenetre, toucher: false, plein: false, panneau: false, ecran: false };
  return e;
}
const tol = 4;

// ---------------------------------------------------------------------------
const VERIFS = {
  M1(Mo, texte) {
    // (le texte du module, commentaires retires : ni document, ni heure, ni
    // hasard ; window seulement pour s exporter)
    const code = texte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const interdits = ['document', 'Date', 'Math.random', 'performance', 'localStorage', 'setTimeout', 'requestAnimationFrame'].filter((m) => new RegExp('\\b' + m.replace('.', '\\.') + '\\b').test(code));
    const fenetres = (code.match(/\bwindow\b/g) || []).length;
    ok(interdits.length === 0 && fenetres === 3, '[M1] le moteur ne lit ni document, ni l heure, ni le hasard ; window seulement pour s exporter', { interdits, fenetres });
    for (const f of ['pic', 'pire', 'calme']) {
      const a = Mo.ghPlan(preparer(ENTREES[f], 1078, 588));
      const b = Mo.ghPlan(preparer(ENTREES[f], 1078, 588));
      const c = Mo.ghPlan(preparer(ENTREES[f], 1078, 588), { mesures: new Map() });
      ok(util.isDeepStrictEqual(a, b) && util.isDeepStrictEqual(a, c) && a.cle === b.cle && a.cle === c.cle, `[M1] ${f} : deux calculs de la meme entree, le meme plan et la meme cle`, { cleA: a.cle, cleB: b.cle, cleC: c.cle });
    }
  },
  M2(Mo) {
    const larges = [];
    for (let w = 600; w <= 1900; w += 100) larges.push(w);
    const toutes = larges.concat(WD_ECRANS);
    for (const f of FX.FIXTURES) {
      for (const H of [588, 784]) {
        const cache = { mesures: new Map() };
        const fautes = [];
        for (const Wd of toutes) {
          const p = Mo.ghPlan(preparer(ENTREES[f], Wd, H), cache);
          const somme = p.colonnes.reduce((a, c) => a + c.w, 0);
          const planchers = p.colonnes.reduce((a, c) => a + c.plancher, 0);
          if (somme !== Wd) fautes.push(`${Wd} : somme ${somme}`);
          if (planchers <= Wd) p.colonnes.filter((c) => !c.vide && c.w < c.plancher).forEach((c) => fautes.push(`${Wd} : ${c.cle} ${c.w} < plancher ${c.plancher}`));
          const bo = p.colonnes.find((c) => c.nature === 'bowling');
          if (bo) {
            const ws = bo.pistes.map((x) => x.w);
            const dern = ws[ws.length - 1];
            if (!ws.slice(0, -1).every((x) => x === ws[0]) || dern < ws[0] || dern > ws[0] + 1 || bo.w !== ws.reduce((a, x) => a + x, 0)) fautes.push(`${Wd} : pistes ${ws.join(',')}`);
          }
        }
        ok(fautes.length === 0, `[M2] ${f} H${H} : la somme vaut la largeur, les planchers tiennent, les pistes sont egales (${toutes.length} largeurs)`, fautes.slice(0, 4));
      }
    }
  },
  M3(Mo) {
    for (const f of FX.FIXTURES) {
      const cache = { mesures: new Map() };
      const fautes = [];
      for (let Wd = 600; Wd <= 2400; Wd += 50) {
        const p = Mo.ghPlan(preparer(ENTREES[f], Wd, 588), cache);
        const utilisees = p.colonnes.filter((c) => !c.vide && c.poids > 0);
        const sousEss = utilisees.filter((c) => c.w < c.essentiel - tol);
        if (sousEss.length) p.colonnes.filter((c) => c.w > c.essentiel + tol).forEach((c) => fautes.push(`${Wd} : ${c.cle} ${c.w} > essentiel ${c.essentiel} quand ${sousEss[0].cle} ${sousEss[0].w} < ${sousEss[0].essentiel}`));
        const sousConf = p.colonnes.filter((c) => !c.vide && c.w < c.confort - tol);
        if (sousConf.length) p.colonnes.filter((c) => c.vide && c.w > c.plancher + tol).forEach((c) => fautes.push(`${Wd} : vide ${c.cle} ${c.w} > ${c.plancher} quand ${sousConf[0].cle} est sous son confort`));
      }
      ok(fautes.length === 0, `[M3] ${f} : aucune colonne au-dessus de son essentiel tant qu une autre est dessous, les vides attendent le confort`, fautes.slice(0, 3));
    }
  },
  M4(Mo) {
    // Les exemples de 9.3 : l echelle brute, que le test filtre par la meme
    // regle (une forme gardee est 10 % plus etroite que la precedente gardee).
    const EXEMPLES = [
      ['Famille Dubois', ['Famille Dubois', 'Fam. Dubois', 'Dubois', 'Dub.']],
      ['Anniversaire Lina (12 ans)', ['Anniversaire Lina (12 ans)', 'Anniversaire Lina', 'Anniv. Lina', 'Lina']],
      ['Collègues de bureau', ['Collègues de bureau', 'Coll. de bureau', 'Coll. bureau', 'Bureau']],
      ['Club de foot U12', ['Club de foot U12', 'Foot U12', 'Foot']],
      ['Collègues du CPAS de Libramont-Chevigny', ['Collègues du CPAS de Libramont-Chevigny', 'Coll. du CPAS de Libramont-Chevigny', 'Coll. du CPAS…', 'Coll. CPAS', 'CPAS']],
      ['Séminaire annuel Ardennes Logistique & Transports Internationaux SA', ['Séminaire annuel Ardennes Logistique & Transports Internationaux SA', 'Sémin. annuel Ardennes Logistique & Transports Internationaux SA', 'Sémin. annuel Ardennes Logistique…', 'Sémin. Ardennes Logistique', 'Ardennes Logistique', 'Ardennes', 'Ard.']],
      ['Anniversaire de Marie-Charlotte Vanderstraeten-Delacroix et de ses cousins de Neufchâteau (10 ans)', ['Anniversaire de Marie-Charlotte Vanderstraeten-Delacroix et de ses cousins de Neufchâteau (10 ans)', 'Anniversaire de Marie-Charlotte Vanderstraeten-Delacroix et de ses cousins de Neufchâteau', 'Anniv. de Marie-Charlotte Vanderstraeten-Delacroix et de ses cousins de Neufchâteau', 'Anniv. de Marie-Charlotte Vanderstraeten-Delacroix…', 'Anniv. Marie-Charlotte Vanderstraeten-Delacroix', 'Marie-Charlotte Vanderstraeten-Delacroix', 'Marie-Charlotte', 'Marie-C.']],
      ['Enterrement de vie de garçon de Romain-Alexandre et ses témoins', ['Enterrement de vie de garçon de Romain-Alexandre et ses témoins', 'EVG de Romain-Alexandre et ses témoins', 'EVG de Romain-Alexandre…', 'EVG Romain-Alexandre', 'Romain-Alexandre', 'Romain-A.']],
      ['Laser de minuit', ['Laser de minuit', 'Minuit']],
      ['Jean-Christophe', ['Jean-Christophe', 'Jean-C.']],
      ['Li', ['Li']], ['Al', ['Al']], ['Ky', ['Ky']],
    ];
    const garder = (liste) => { const g = []; liste.forEach((t) => { const w = largeurFixe(t); if (g.length && w > 0.9 * g[g.length - 1].w + 1e-9) return; g.push({ t, w }); }); return g.map((x) => x.t); };
    for (const [nom, brute] of EXEMPLES) {
      const vu = Mo.ghFormes(nom, { largeur: largeurFixe }).map((f) => f.t);
      ok(memes(vu, garder(brute)), `[M4] « ${nom.slice(0, 40)} » donne son echelle`, { attendu: garder(brute), vu });
    }
    // Les regles, sur tous les noms des six journees : des mots entiers du nom
    // (dictionnaire applique) ou une abreviation finie par « . », « … »
    // seulement apres un mot entier, jamais le prefixe du jour.
    const fautes = [];
    for (const f of FX.FIXTURES) {
      const groupes = ENTREES[f].groupes;
      const prefixe = Mo.ghPrefixe(groupes.map((g) => g.nom));
      for (const g of groupes) {
        const brut = Mo.ghFormesBrutes(g.nom, prefixe).formes;
        const n1 = brut[0].t;
        const n3 = (brut.find((x) => x.n === 3) || brut.find((x) => x.n === 2) || brut[0]).t;
        // (« d'Ethan » se lit « d' » + « Ethan », comme le moteur)
        const motsN1 = [].concat(...[n1, n3].join(' ').split(' ').map((m) => { const x = /^([dDlL]['’])(.+)$/.exec(m); return x ? [m, x[2]] : [m]; }));
        const mots = new Set(motsN1.map((m) => Mo.cleTexte(m)));
        for (const forme of Mo.ghFormes(g.nom, { prefixe, largeur: largeurFixe })) {
          const t = forme.t;
          if (prefixe && t.indexOf(prefixe) === 0) fautes.push(`${t} : commence par le prefixe`);
          const corps = t.endsWith('…') ? t.slice(0, -1) : t;
          if (t.endsWith('…') && !(n3.startsWith(corps + ' ') || n1.startsWith(corps + ' '))) fautes.push(`${t} : « … » apres un mot coupe`);
          corps.split(' ').forEach((m) => {
            if (mots.has(Mo.cleTexte(m))) return;
            if (/\.$/.test(m) && motsN1.some((x) => Mo.cleTexte(x).startsWith(Mo.cleTexte(m.slice(0, -1))) && x.length > m.length - 1)) return;
            fautes.push(`${t} : « ${m} » n est ni un mot du nom ni une abreviation`);
          });
        }
      }
    }
    ok(fautes.length === 0, '[M4] chaque forme est faite de mots entiers du nom ou d une abreviation, sans prefixe du jour', fautes.slice(0, 4));
  },
  M5(Mo) {
    const groupes = ENTREES.pire.groupes;
    const M = Mo.mesureur(FIXE);
    const noms = Mo.ghNoms(groupes, '650 13px', M);
    const porteurs = new Map();
    const toutes = [];
    noms.parId.forEach((e, id) => e.formes.forEach((f) => { const k = Mo.cleTexte(f.t); toutes.push(f.t); if (!porteurs.has(k)) porteurs.set(k, new Set()); porteurs.get(k).add(id); }));
    const partagees = Array.from(porteurs.entries()).filter(([k, s]) => k && s.size > 1).map(([k]) => k);
    ok(partagees.length === 0, '[M5] pire : aucune forme non vide partagee par deux groupes', partagees.slice(0, 5));
    const collard = groupes.find((g) => /Collard/.test(g.nom));
    ok(collard && !toutes.includes('Max.') && !toutes.includes('Jul.') && !noms.parId.get(collard.id).formes.some((f) => f.t === 'Coll.'), '[M5] pire : ni « Max. », ni « Jul. », ni « Coll. » pour Collard', toutes.filter((t) => /^(Max|Jul|Coll)\.$/.test(t)));
    ok(toutes.includes('Famille Martin (8)') && toutes.includes('Famille Martin (12)'), '[M5] pire : « Famille Martin (8) » et « Famille Martin (12) »', toutes.filter((t) => /Martin/.test(t)));
  },
  M6(Mo) {
    ok(Mo.ghPrefixe(ENTREES.pic.groupes.map((g) => g.nom)) === 'DÉMO · ' && Mo.ghPrefixe(ENTREES.pire.groupes.map((g) => g.nom)) === 'DÉMO · ', '[M6] pic et pire : « DÉMO · » est le prefixe du jour');
    ok(Mo.ghPrefixe(['Famille Dubois', 'Amis de Clara', 'Anniversaire Noah (10 ans)', 'Couple Renard', 'Scouts de Bastogne']) === '', '[M6] une journee sans prefixe partage : rien');
    const quarante = ['Anniversaire · Noah', 'Anniversaire · Lina', 'Anniversaire · Hugo', 'Anniversaire · Zoé', 'Famille Dubois', 'Amis de Clara', 'Couple Renard', 'Famille Petit', 'Scouts de Bastogne', 'Équipe de volley'];
    ok(Mo.ghPrefixe(quarante) === '', '[M6] « Anniversaire · » sur 40 % des groupes : rien', Mo.ghPrefixe(quarante));
  },
  M7(Mo) {
    // Un tirage deterministe (LCG), 2 000 boites.
    let graine = 20261020;
    const hasard = () => { graine = (Math.imul(graine, 1664525) + 1013904223) >>> 0; return graine / 4294967296; };
    const pris = (liste) => liste[Math.floor(hasard() * liste.length)];
    const nomsPool = [].concat(...FX.FIXTURES.map((f) => ENTREES[f].groupes.map((g) => g.nom.replace(/^DÉMO · /, '')))).concat(['Li', 'Bo', 'Famille Martin', 'Collègues du CPAS de Libramont-Chevigny']);
    const TAGS = [{ code: 'retard', v: 12 }, { code: 'retard', v: 104 }, { code: 'valider' }, { code: 'cloturer' }, { code: 'absent' }, { code: 'aplacer' }, { code: 'conflit', v: 'P3' }, { code: 'piste' }];
    const M = Mo.mesureur(FIXE);
    const fautes = [];
    let composees = 0;
    for (let i = 0; i < 2000; i += 1) {
      const nom = pris(nomsPool);
      const formes = Mo.ghFormes(nom, { largeur: largeurFixe }).map((f) => ({ t: f.t }));
      const heure = hasard() < 0.2 ? null : pris([{ t: '15:30', aligne: true }, { t: '15:40', aligne: false }, { t: '≈ 16:05', aligne: false }]);
      const tags = []; const n = Math.floor(hasard() * 3); for (let k = 0; k < n; k += 1) tags.push(pris(TAGS));
      const carte = { heure, arrivee: hasard() < 0.15, formes, distinctive: Math.floor(hasard() * formes.length), tags, pictos: Math.floor(hasard() * 3), detail: pris([[], ['P3-4'], ['×2 tables']]), detailBowling: hasard() < 0.4, infos: pris([[], ['F4'], ['F4', '8 cr.', '2 cruches']]) };
      const typo = Mo.ghTypo(pris([13, 18, 22, 30]));
      const tw = 1 + Math.floor(hasard() * 220);
      const L = Math.floor(hasard() * 6);
      const r = Mo.ghComposer(carte, { tw, L }, typo, M);
      if (L === 0) { if (r) fautes.push(`#${i} L=0 mais compose`); continue; }
      if (!r) continue;
      composees += 1;
      // Les largeurs, recalculees ici.
      const largeur = (u) => {
        if (u.k === 'nom' || u.k === 'h' || u.k === 'bas') return FIXE('', u.t) + 1;
        if (u.k === 'pictos') return u.n * 13 + (u.n - 1) * 3 + 1;
        if (u.k === 'tag') {
          const def = Mo.TAGS[u.code];
          const v = u.code === 'retard' ? '9'.repeat(Math.max(2, String(u.v).length)) : u.v;
          return FIXE('', u.forme === 'court' ? def.court(v) : def.long(v)) + (u.forme === 'court' ? 8 : 10) + 1;
        }
        return NaN;
      };
      const sep = (u) => (u.k === 'nom' && !u.mot ? 0 : 3);
      const lignes = r.lignes;
      const total = lignes.length + (r.bas ? 1 : 0);
      if (total > L) fautes.push(`#${i} ${total} lignes pour L=${L}`);
      lignes.forEach((l, li) => { const w = l.reduce((a, u, j) => a + largeur(u) + (j ? sep(u) : 0), 0); if (!(w <= tw + 1e-9)) fautes.push(`#${i} ligne ${li} ${w} > ${tw}`); });
      if (r.bas && !(largeur({ k: 'bas', t: r.bas.t }) <= tw + 1e-9)) fautes.push(`#${i} detail trop large`);
      // La coupure gloutonne, refaite ici.
      const suite = [].concat(...lignes);
      const refaites = [];
      let cur = [], larg = 0;
      suite.forEach((u) => {
        const w = largeur(u);
        if (!cur.length) { cur = [u]; larg = w; return; }
        if (larg + sep(u) + w <= tw + 1e-9) { cur.push(u); larg += sep(u) + w; return; }
        refaites.push(cur); cur = [u]; larg = w;
      });
      if (cur.length) refaites.push(cur);
      if (!memes(refaites.map((l) => l.length), lignes.map((l) => l.length))) fautes.push(`#${i} coupure non gloutonne`);
      // Le nom ecrit est une forme de l echelle.
      let ecrit = '';
      suite.filter((u) => u.k === 'nom').forEach((u, j) => { ecrit += (j && u.mot ? ' ' : '') + u.t; });
      if (r.forme < 0 || ecrit !== formes[r.forme].t) fautes.push(`#${i} « ${ecrit} » n est pas la forme ${r.forme}`);
    }
    ok(fautes.length === 0 && composees > 500, `[M7] 2 000 boites : chaque composition tient a la coupure gloutonne, dans L lignes, avec une forme de l echelle (${composees} composees)`, fautes.slice(0, 4));
  },
  M8(Mo) {
    for (const f of ['calme', 'normal', 'pic', 'pire']) {
      const formes = [10, 15 + 10 / 60, 22].map((h) => {
        const p = Mo.ghPlan(preparer(ENTREES[f], 1078, 588, { maintenant: h }));
        return { colonnes: p.colonnes.map((c) => [c.cle, c.x, c.w]), rects: p.elements.map((el) => [el.k, el.cle, el.x, el.y, el.w, el.h]) };
      });
      ok(memes(formes[0], formes[1]) && memes(formes[1], formes[2]), `[M8] ${f} : a 10:00, 15:10 et 22:00, les memes colonnes et les memes rectangles`);
    }
  },
  M9(Mo) {
    const e = (id, groupe, debut, fin, joueurs, arene) => ({ id, groupe, debut, fin, joueurs, arene: arene == null ? joueurs : arene });
    const vagues = Mo.ghParties([e('a', 'A', 16, 16 + 25 / 60, 10, 14), e('b', 'B', 16, 16 + 5 / 60, 4, 14)]);
    ok(vagues.length === 1 && Math.abs(vagues[0].fin - (16 + 25 / 60)) < 1e-9, '[M9] les vagues fusionnees qui finissent 20 min apres l autre groupe restent dans la partie de leur lancement', vagues.map((p) => [p.debut, p.fin, p.entrees.length]));
    ok(Mo.ghParties([e('a', 'A', 15.5, 15.9, 8), e('b', 'B', 15.5 + 1 / 60, 15.9, 6)]).length === 1 && Mo.ghParties([e('a', 'A', 15.5, 15.9, 8), e('b', 'B', 15.5 + 5 / 60, 15.9, 6)]).length === 2, '[M9] 15:30 et 15:31 font une partie, 15:30 et 15:35 deux');
    ok(Mo.ghParties([e('a', 'A', 19, 19.4, 8, 12), e('b', 'B', 19, 19.4, 12, 20)])[0].armes === 20, '[M9] les armes d une partie : le maximum des arenes');
    // Dans le plan : la journee normale, un groupe de 4 a 16:00 pour 5 min a
    // cote des vagues d Ethan (la variante « vagues » de la console).
    const normal = JSON.parse(JSON.stringify(ENTREES.normal));
    const ethan = normal.groupes.find((g) => /Ethan/.test(g.nom));
    const s16 = normal.seances.find((s) => s.groupe === ethan.id && s.colonne === 'laser' && Math.abs(s.debut - 16) < 1e-6);
    normal.groupes.push({ id: 'lou', nom: 'DÉMO · Amis de Lou', statut: 'conf', personnes: 4, etat: 'upcoming', retard: false, depuis: 16, absent: false, parti: false, valider: false, aPlacer: false, pictos: 0, pictosHtml: '', infos: [], heure: '16:00', debut: 16 });
    normal.seances.push({ id: 'lou|laser|0', groupe: 'lou', colonne: 'laser', debut: 16, fin: 16 + 5 / 60, libre: false, journee: false, fait: false, activite: 'laser_game', n: 0, joueurs: 4, arene: 14, partie: 1, parties: 1 });
    s16.arene = 14;
    const p = Mo.ghPlan(preparer(normal, 1388, 700));
    const parties16 = p.elements.filter((el) => el.k === 'partie' && Math.abs(el.debut - 16) < 1e-6);
    ok(parties16.length === 1 && parties16[0].segs.length === 2 && parties16[0].armes === 14, '[M9] dans le plan : un seul bloc a 16:00, deux segments, 14 armes', parties16.map((x) => [x.cle, x.segs, x.armes]));
    // Un groupe de 8 armes dans une partie de 30 garde son essentiel.
    const pic = Mo.ghPlan(preparer(ENTREES.pic, 1868, 924));
    const laser = pic.colonnes.find((c) => c.nature === 'laser');
    const p19 = pic.elements.find((el) => el.k === 'partie' && Math.abs(el.debut - 19) < 1e-6);
    const nathan = pic.elements.find((el) => el.k === 'seg' && el.partie === (p19 && p19.cle) && el.armes === 8);
    ok(laser.w >= laser.essentiel && p19 && p19.armes === 30 && nathan && nathan.w >= nathan.ess, '[M9] pic, 19:00 : le groupe de 8 armes d une partie de 30 garde son essentiel', nathan ? { w: nathan.w, ess: nathan.ess, laser: [laser.w, laser.essentiel] } : 'pas de segment de 8 armes');
  },
};

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  { nom: 'compteur-de-module', lettre: 'M1', editions: [
    { de: '  var ORIGINE = 8;\n', vers: '  var ORIGINE = 8;\n  var COMPTEUR_M1 = 0;\n' },
    { de: '    var largeurColonnes = placer(colonnes, rep);\n', vers: '    rep.largeurs[rep.largeurs.length - 1] += (COMPTEUR_M1++) % 2;\n    var largeurColonnes = placer(colonnes, rep);\n' }] },
  { nom: 'sans-arrondi', lettre: 'M2', editions: [{ de: '    if (D > 0) {\n      if (ordre.length)', vers: '    if (false) {\n      if (ordre.length)' }] },
  { nom: 'confort-avant-essentiel', lettre: 'M3', editions: [{ de: "      R = remplirVers(besoins, alloc, poids, 'court', R);\n", vers: "      R = remplirVers(besoins, alloc, poids, 'confort', R);\n      R = remplirVers(besoins, alloc, poids, 'court', R);\n" }] },
  { nom: 'cle-sans-point', lettre: 'M4', editions: [{ de: "    if (l4 && VOYELLES.indexOf(l4) < 0) return t.slice(0, 4) + '.';", vers: '    if (l4 && VOYELLES.indexOf(l4) < 0) return t.slice(0, 3);' }] },
  { nom: 'sans-unicite', lettre: 'M5', editions: [{ de: '    ghUnicite(echelles, largeur).forEach(function (e) { parId.set(e.id, e); });', vers: '    echelles.forEach(function (e) { e.distinctive = 0; parId.set(e.id, e); });' }] },
  { nom: 'prefixe-sans-seuil', lettre: 'M6', editions: [{ de: '  var SEUIL_PREFIXE = 0.6;', vers: '  var SEUIL_PREFIXE = 0;' }] },
  { nom: 'une-ligne-de-trop', lettre: 'M7', editions: [{ de: '      var lignes = casser(tete, tw, L - 1);', vers: '      var lignes = casser(tete, tw, L);' }, { de: '    var l2 = casser(bas ? tete.concat([bas]) : tete, tw, L);', vers: '    var l2 = casser(bas ? tete.concat([bas]) : tete, tw, L + 1);' }] },
  { nom: 'poids-en-cours', lettre: 'M8', editions: [{ de: '    var poids = poidsColonnes(colonnes, besoins);', vers: '    var poids = poidsColonnes(colonnes, besoins).map(function (x, i) { return x + (colonnes[i].seances.some(function (s) { return entree.maintenant != null && s.debut <= entree.maintenant && s.fin > entree.maintenant; }) ? 2 : 0); });' }] },
  { nom: 'partie-meme-fin', lettre: 'M9', editions: [{ de: '      if (p && e.debut <= p.debut + ECART_PARTIE + 1e-6) p.entrees.push(e);', vers: '      if (p && Math.abs(e.debut - p.debut) < 1e-9 && Math.abs(e.fin - p.entrees[0].fin) < 1e-9) p.entrees.push(e);' }] },
  { nom: 'barre-proportionnelle', lettre: 'M9', editions: [{ de: '    var w = segs.map(function (s) { return connu ? Math.max(s.ess, s.joueurs / C * Bu) : s.ess; });', vers: '    var w = segs.map(function (s) { return connu ? s.joueurs / C * Bu : s.ess; });' }] },
];

function main() {
  const texte = fs.readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');
  if (!process.argv.includes('--contre-preuves')) {
    const Mo = charger(texte);
    for (const [lettre, f] of Object.entries(VERIFS)) {
      try { f(Mo, texte); } catch (e) { ok(false, `[${lettre}] crash`, e.stack.split('\n').slice(0, 3).join(' | ')); }
    }
  } else {
    console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
    for (const m of MUTATIONS) {
      let mute = texte;
      const ancres = m.editions.map((ed) => mute.split(ed.de).length - 1);
      m.editions.forEach((ed) => { mute = mute.replace(ed.de, () => ed.vers); });
      if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois`, ancres)) continue;
      const avant = echecs;
      const garde = rouges.length;
      silence = true;
      try { VERIFS[m.lettre](charger(mute), mute); } catch (e) { rouges.push(`[${m.lettre}] crash ${e.message}`); }
      silence = false;
      const vus = rouges.slice(garde);
      rouges.length = garde;
      echecs = avant;
      ok(vus.some((l) => l.startsWith(`[${m.lettre}]`)), `[K] mutation ${m.nom} : [${m.lettre}] rougit`, vus.slice(0, 2).join(' ; ') || 'rien n a rougi');
    }
  }
  if (echecs) { console.error(`\nplanning-moteur-check: FAIL ${echecs}`); process.exitCode = 1; return; }
  console.log(`\nplanning-moteur-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
}
main();
