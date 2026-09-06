// LA CONSOLE SE MET A JOUR TOUTE SEULE, ET NE COUTE RIEN QUAND RIEN NE BOUGE.
//
// Ce que ce gate mesure, et pourquoi.
//
// La page Emails se chargeait UNE fois. Un mail arrive apres coup n existait pas
// a l ecran tant que personne ne rechargeait a la main. Le vrai danger n est pas
// le confort : deux personnes sur la meme boite pouvaient repondre au meme
// message, chacune persuadee d etre seule, parce que la reponse de l une
// n apparaissait jamais chez l autre.
//
// La reponse est un POULS : une empreinte minuscule lue souvent, et un
// rechargement complet SEULEMENT quand elle change. Tout le risque est donc
// dans la decision « faut-il recharger ? ». C est elle qu on mesure ici, avec
// une horloge controlee : aucune attente reelle, aucun reseau, des verdicts
// deterministes.
//
// LES SEPT PROPRIETES :
//
//   [A] LA PREMIERE LECTURE NE RECHARGE PAS. La page vient d etre chargee : la
//       recharger aussitot serait un aller-retour complet pour rien, a chaque
//       ouverture de la page, pour chaque personne.
//
//   [B] UNE EMPREINTE STABLE NE RECHARGE JAMAIS. C est la raison d etre du
//       pouls : sans cette garde, on aurait remplace « jamais de mise a jour »
//       par « toute la console rechargee toutes les quatre secondes ».
//
//   [C] UNE EMPREINTE QUI CHANGE RECHARGE UNE FOIS, PUIS SE TAIT. Une fois, pas
//       zero (sinon rien ne se met a jour) et pas indefiniment (sinon la
//       console se recharge en boucle apres le moindre mail).
//
//   [D] UN ONGLET CACHE NE CONSOMME RIEN, ET LE RETOUR EST IMMEDIAT. Une
//       console ouverte dans un onglet oublie ne doit pas interroger le serveur
//       toute la journee ; mais au moment ou quelqu un revient dessus, l ecran
//       doit etre juste sans attendre le prochain tour.
//
//   [E] UNE ERREUR RESEAU RECULE, N EXPLOSE PAS, ET SE RATTRAPE. Une coupure
//       espace les tentatives au lieu de marteler ; des qu une lecture repasse,
//       la cadence normale revient. Une exception qui s echappe ici tuerait la
//       boucle en silence, et la page redeviendrait figee sans que personne ne
//       le sache.
//
//   [F] UN CHANGEMENT DE CENTRE REPART SUR UNE NOUVELLE BASE. Deux centres ont
//       deux empreintes sans rapport : les comparer ferait croire a un
//       changement et rechargerait les donnees du centre qu on vient de
//       quitter.
//
//   [G] JAMAIS DEUX LECTURES EN VOL. Une lecture lente ne doit pas se faire
//       doubler par la suivante : ce serait le debut d une avalanche, juste
//       quand le serveur va deja mal.
//
// CONTRE-EPREUVES PAR MUTATION, compilees en memoire (crochet sur
// Module.prototype._compile, le disque n est jamais touche).
//
// Usage : node scripts/ops-live-check.js
'use strict';
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);
const CIBLE = 'assets/ops-live.js';

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// LE MODULE MESURE, mutable en memoire.
// ---------------------------------------------------------------------------
let mutations = [];
const compileOrigine = Module.prototype._compile;
Module.prototype._compile = function (contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const editions = mutations.filter((e) => e.fichier === rel);
  if (!editions.length) return compileOrigine.call(this, contenu, nom);
  let mute = contenu.split(CRLF).join(LF);
  for (const { de, vers } of editions) {
    if (mute.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 70)}`);
    mute = mute.split(de).join(vers);
  }
  return compileOrigine.call(this, mute, nom);
};

function chargerModule() {
  delete require.cache[require.resolve(path.join(ROOT, CIBLE))];
  return require(path.join(ROOT, CIBLE));
}

// ---------------------------------------------------------------------------
// UN BANC D ESSAI : horloge controlee, onglet controle, serveur controle.
// Rien n attend reellement ; « avancer d un tour » veut dire « executer le
// prochain rendez-vous programme », ce qui rend chaque verdict reproductible.
// ---------------------------------------------------------------------------
function banc({ empreintes = [], estActive = () => true, centres = null } = {}) {
  const journal = { lectures: [], rechargements: 0, erreurs: 0 };
  const rendezVous = [];
  let identifiant = 0;
  let index = 0;
  let onglet = { cache: false };
  const ecouteurs = [];
  let enAttente = null; // resout une lecture a la main quand on veut la ralentir

  const doc = {
    get hidden() { return onglet.cache; },
    addEventListener(type, fn) { ecouteurs.push({ type, fn }); },
    removeEventListener(type, fn) {
      const i = ecouteurs.findIndex((e) => e.type === type && e.fn === fn);
      if (i >= 0) ecouteurs.splice(i, 1);
    },
  };

  function emettre(type) {
    ecouteurs.filter((e) => e.type === type).forEach((e) => e.fn());
  }

  const { creerSynchroLive } = chargerModule();
  const synchro = creerSynchroLive({
    doc,
    estActive,
    centreActuel: () => (centres ? centres() : 'libramont'),
    lire: async (centre) => {
      journal.lectures.push(centre);
      if (enAttente) {
        // Lecture volontairement lente : elle ne rend la main que sur ordre.
        await new Promise((resolve) => { enAttente.debloquer = resolve; });
      }
      const valeur = empreintes[Math.min(index, empreintes.length - 1)];
      index += 1;
      if (valeur instanceof Error) throw valeur;
      return { ok: true, empreinte: valeur };
    },
    recharger: async () => { journal.rechargements += 1; },
    surErreur: () => { journal.erreurs += 1; },
    setTimeoutImpl: (fn, ms) => {
      identifiant += 1;
      rendezVous.push({ id: identifiant, fn, ms });
      return identifiant;
    },
    clearTimeoutImpl: (id) => {
      const i = rendezVous.findIndex((r) => r.id === id);
      if (i >= 0) rendezVous.splice(i, 1);
    },
  });

  // Laisse les promesses deja lancees se terminer avant de mesurer.
  async function respirer(tours = 6) {
    for (let i = 0; i < tours; i += 1) await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }

  return {
    journal,
    synchro,
    doc,
    get prochaineAttente() { return rendezVous.length ? rendezVous[rendezVous.length - 1].ms : null; },
    get rendezVousEnAttente() { return rendezVous.length; },
    async demarrer() { synchro.demarrer(); await respirer(); },
    async tour() {
      const prochain = rendezVous.shift();
      if (!prochain) return false;
      prochain.fn();
      await respirer();
      return true;
    },
    async tours(n) { for (let i = 0; i < n; i += 1) await this.tour(); },
    async cacher() { onglet.cache = true; emettre('visibilitychange'); await respirer(); },
    async montrer() { onglet.cache = false; emettre('visibilitychange'); await respirer(); },
    ralentirLaProchaineLecture() { enAttente = {}; return enAttente; },
    async liberer(attente) {
      enAttente = null;
      if (attente && attente.debloquer) attente.debloquer();
      await respirer();
    },
    arreter() { synchro.arreter(); },
  };
}

(async () => {
  // =====================================================================
  console.log('[A] la premiere lecture ne recharge pas');
  // =====================================================================
  const a = banc({ empreintes: ['e1', 'e1', 'e1'] });
  await a.demarrer();
  ok(a.journal.lectures.length === 1, '[A] la boucle lit des le demarrage, sans attendre un premier delai', `${a.journal.lectures.length} lecture(s)`);
  ok(a.journal.rechargements === 0, '[A] et elle ne recharge PAS : la page vient d etre chargee', `${a.journal.rechargements} rechargement(s)`);
  a.arreter();

  // =====================================================================
  console.log('\n[B] une empreinte stable ne recharge jamais');
  // =====================================================================
  const b = banc({ empreintes: ['stable', 'stable', 'stable', 'stable', 'stable', 'stable'] });
  await b.demarrer();
  await b.tours(4);
  ok(b.journal.lectures.length === 5, '[B] la boucle continue de lire tour apres tour', `${b.journal.lectures.length} lecture(s)`);
  ok(b.journal.rechargements === 0, '[B] et ne recharge jamais tant que rien ne bouge (c est tout l interet du pouls)', `${b.journal.rechargements} rechargement(s)`);
  b.arreter();

  // =====================================================================
  console.log('\n[C] une empreinte qui change recharge une fois, puis se tait');
  // =====================================================================
  const c = banc({ empreintes: ['avant', 'avant', 'APRES', 'APRES', 'APRES'] });
  await c.demarrer();
  await c.tour();
  ok(c.journal.rechargements === 0, '[C] rien n a bouge : rien ne se recharge', `${c.journal.rechargements}`);
  await c.tour();
  ok(c.journal.rechargements === 1, '[C] l empreinte change : la console se recharge, sans que personne n ait touche a rien', `${c.journal.rechargements}`);
  await c.tours(2);
  ok(c.journal.rechargements === 1, '[C] et elle ne se recharge PAS en boucle ensuite', `${c.journal.rechargements}`);
  c.arreter();

  // =====================================================================
  console.log('\n[D] un onglet cache ne consomme rien, le retour est immediat');
  // =====================================================================
  const d = banc({ empreintes: ['x', 'x', 'x', 'x', 'x'] });
  await d.demarrer();
  const lecturesAvant = d.journal.lectures.length;
  await d.cacher();
  await d.tours(3);
  ok(d.journal.lectures.length === lecturesAvant, '[D] onglet cache : AUCUNE lecture, meme apres plusieurs tours', `${d.journal.lectures.length - lecturesAvant} lecture(s) de trop`);
  ok(d.rendezVousEnAttente > 0, '[D] mais la boucle reste armee : elle n est pas morte, elle attend');
  await d.montrer();
  ok(d.journal.lectures.length === lecturesAvant + 1, '[D] retour sur l onglet : lecture IMMEDIATE, sans attendre le prochain tour', `${d.journal.lectures.length - lecturesAvant} lecture(s)`);
  d.arreter();

  // =====================================================================
  console.log('\n[E] une erreur reseau recule, n explose pas, et se rattrape');
  // =====================================================================
  const e = banc({ empreintes: ['ok1', new Error('reseau coupe'), new Error('reseau coupe'), 'ok2', 'ok2'] });
  await e.demarrer();
  const cadenceDeBase = e.prochaineAttente;
  await e.tour();
  const apresUneErreur = e.prochaineAttente;
  ok(e.journal.erreurs === 1, '[E] l erreur est vue, pas avalee', `${e.journal.erreurs}`);
  ok(apresUneErreur > cadenceDeBase, '[E] et la prochaine tentative est ESPACEE au lieu de marteler', `${cadenceDeBase} ms puis ${apresUneErreur} ms`);
  await e.tour();
  ok(e.prochaineAttente > apresUneErreur, '[E] deux erreurs de suite : le recul continue', `${e.prochaineAttente} ms`);
  await e.tour();
  ok(e.prochaineAttente === cadenceDeBase, '[E] des qu une lecture repasse, la cadence normale revient', `${e.prochaineAttente} ms`);
  ok(e.rendezVousEnAttente > 0, '[E] et la boucle est toujours vivante apres les erreurs');
  e.arreter();

  // =====================================================================
  console.log('\n[F] un changement de centre repart sur une nouvelle base');
  // =====================================================================
  let centre = 'libramont';
  const f = banc({ empreintes: ['empreinte-libramont', 'empreinte-gembloux', 'empreinte-gembloux'], centres: () => centre });
  await f.demarrer();
  centre = 'gembloux';
  await f.tour();
  ok(f.journal.rechargements === 0, '[F] changer de centre ne recharge pas : l empreinte de l autre centre n est pas un changement', `${f.journal.rechargements}`);
  ok(f.journal.lectures[1] === 'gembloux', '[F] et le pouls suit bien le centre affiche', f.journal.lectures[1]);
  f.arreter();

  // =====================================================================
  console.log('\n[G] jamais deux lectures en vol');
  // =====================================================================
  // Le seul chemin qui peut vraiment doubler une lecture est le retour sur
  // l onglet : il appelle la lecture DIRECTEMENT, sans attendre le tour suivant.
  // Sans monter cette situation-la, le controle serait vert sans avoir rien
  // sollicite (la boucle normale est sequentielle par construction).
  const g = banc({ empreintes: ['lent', 'lent', 'lent', 'lent'] });
  const attente = g.ralentirLaProchaineLecture();
  await g.demarrer();
  ok(g.journal.lectures.length === 1 && g.synchro.enVol,
    '[G] une lecture est partie et n est pas revenue (la situation est bien montee)',
    `${g.journal.lectures.length} lecture(s), en vol : ${g.synchro.enVol}`);
  await g.cacher();
  await g.montrer();
  ok(g.journal.lectures.length === 1,
    '[G] un retour sur l onglet pendant une lecture lente n en lance pas une seconde',
    `${g.journal.lectures.length} lecture(s)`);
  await g.liberer(attente);
  await g.tour();
  ok(g.journal.lectures.length === 2, '[G] et des qu elle revient, la boucle reprend normalement', `${g.journal.lectures.length} lecture(s)`);
  g.arreter();

  // =====================================================================
  console.log('\n[MUTATION] le gate sait-il rougir ?');
  // =====================================================================
  const contreEpreuves = [
    {
      nom: 'la comparaison d empreinte est retiree',
      de: '        } else if (nouvelle !== empreinte) {',
      vers: '        } else if (true) {',
      rejouer: async () => {
        const m = banc({ empreintes: ['stable', 'stable', 'stable', 'stable'] });
        await m.demarrer();
        await m.tours(2);
        const total = m.journal.rechargements;
        m.arreter();
        return total;
      },
      attendu: (total) => total === 0,
      libelle: 'la console entiere se rechargerait toutes les quatre secondes, sans que rien n ait bouge',
    },
    {
      nom: 'la regle de nouvelle base est retiree',
      de: '        } else if (empreinte === null || centreMemorise !== centre) {',
      vers: '        } else if (false) {',
      rejouer: async () => {
        const m = banc({ empreintes: ['e1', 'e1'] });
        await m.demarrer();
        const total = m.journal.rechargements;
        m.arreter();
        return total;
      },
      attendu: (total) => total === 0,
      libelle: 'chaque ouverture de la page declencherait un rechargement complet immediat',
    },
    {
      nom: 'la garde de l onglet cache est retiree',
      de: '      if (cache() || !estActive()) { replanifier(); return; }',
      vers: '      if (!estActive()) { replanifier(); return; }',
      rejouer: async () => {
        const m = banc({ empreintes: ['x', 'x', 'x', 'x'] });
        await m.demarrer();
        const avant = m.journal.lectures.length;
        await m.cacher();
        await m.tours(2);
        const total = m.journal.lectures.length - avant;
        m.arreter();
        return total;
      },
      attendu: (total) => total === 0,
      libelle: 'un onglet oublie interrogerait le serveur toute la journee',
    },
    {
      nom: 'la garde « une seule lecture en vol » est retiree',
      de: '      if (enVol) { replanifier(); return; }',
      vers: '      if (false) { replanifier(); return; }',
      rejouer: async () => {
        const m = banc({ empreintes: ['lent', 'lent', 'lent', 'lent'] });
        const a2 = m.ralentirLaProchaineLecture();
        await m.demarrer();
        await m.cacher();
        await m.montrer();
        const total = m.journal.lectures.length;
        await m.liberer(a2);
        m.arreter();
        return total;
      },
      attendu: (total) => total === 1,
      libelle: 'un serveur lent recevrait une avalanche de lectures empilees',
    },
  ];

  for (const contre of contreEpreuves) {
    mutations = [{ fichier: CIBLE, de: contre.de, vers: contre.vers }];
    let verdict = false;
    let mesure = '';
    try {
      const r = await contre.rejouer();
      mesure = String(r);
      // Le gate ROUGIRAIT si, mute, le code ne respecte plus la propriete.
      verdict = !contre.attendu(r);
    } catch (error) {
      verdict = false;
      mesure = `exception : ${error.message}`;
    }
    mutations = [];
    ok(verdict, `[mutation] « ${contre.nom} » : ${contre.libelle} (le gate ROUGIRAIT)`, mesure);
  }
  ok(mutations.length === 0, '[mutation] aucune mutation ne survit');

  console.log(failures ? `\n${failures} controle(s) en echec.` : '\nTous les controles passent.');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});
