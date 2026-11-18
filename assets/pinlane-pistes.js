/* ============================================================================
   QUELLE PISTE POUR UN GROUPE, QUAND PINLANE CHOISIT (2026-11-18)
   ----------------------------------------------------------------------------
   POURQUOI CE FICHIER EXISTE. Vosk (Fun Galaxy), via Ansar, le 18/11 : « pas
   tout le temps faire en sorte que l'algo pousse la resa du bowling tout le
   temps sur la piste numero 1 ». Puis Ansar : « quand c auto ça prend celle qui
   est la plus opti et pas juste tout le temps la 1 quand c libre quoi sinon
   elle sera juste tout le temps utiliser tu vois genre equilibrer ».
   Trois copies de la regle (lib/ops-engine.js, lib/database.js, la console
   assets/app-main.js) finissaient toutes sur « la premiere piste libre » : la
   piste 1 tournait toute la journee, la 8 jamais. Une capture du 18/11 sur une
   journee de test : 6 groupes sur 10 sur la piste 1, aucun sur les pistes 4 a 8.

   LA REGLE, UNE SEULE FOIS, ICI. Le serveur la lit par require (le moteur et
   lib/database.js), la console par window.PinlanePistes : pour la meme journee,
   le comptoir montre la piste que le serveur gardera.

   Parmi les pistes libres sur la fenetre (chaque appelant les compte comme
   avant : occupees, maintenance, blocage), dans cet ordre :
     1. ce qu un groupe exige, comme avant : un groupe de 2 prend une paire
        entiere (1-2, 3-4...) ; un groupe plus grand prend des pistes cote a
        cote (le moins d ecart possible) ;
     2. l equilibre : on ecarte ce qui a deja servi une heure de plus que la
        piste libre la moins utilisee de la journee (minutes deja reservees) ;
     3. parmi ce qui reste, ce qui garde les paires entieres pour les groupes
        suivants : une piste seule complete une paire deja entamee, un groupe
        evite de laisser une piste seule dans une paire. Cette preference
        passe APRES l equilibre : avant, des groupes d une piste decales d une
        demi-heure s empilaient tous sur la meme paire ;
     4. la moins utilisee de la journee ;
     5. a egalite (le matin, tout est vide) : un tour qui avance d une piste
        chaque jour, pour que le premier groupe du jour ne tombe pas toujours
        sur la 1. Le meme jour donne toujours le meme ordre.
   Jamais de hasard : la meme journee donne la meme piste, au comptoir comme
   au serveur. Le serveur ne lit que la journee demandee (aucune requete en
   plus) : l equilibre sur plusieurs jours vient du tour quotidien.

   Le choix manuel du comptoir (piste cliquee, pistes a la main) et les pistes
   qu une reservation modifiee garde passent AVANT cette regle, chez chaque
   appelant : elle ne decide que quand Pinlane choisit.

   Double vie : global navigateur (window.PinlanePistes) et module CommonJS,
   comme assets/pinlane-monnaie.js.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PinlanePistes = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // L ecart d usage au-dela duquel une piste cede sa place a une moins utilisee,
  // meme pour completer une paire : une partie d une heure, la reservation type.
  const ECART_TOLERE_MINUTES = 60;

  // Les paires d un centre : 1-2, 3-4... Une derniere piste impaire reste seule.
  function paires(nombreDePistes) {
    const total = Math.trunc(Number(nombreDePistes));
    const sortie = [];
    if (!Number.isFinite(total)) return sortie;
    for (let piste = 1; piste + 1 <= total; piste += 2) sortie.push([piste, piste + 1]);
    return sortie;
  }

  // Le numero du jour (jours depuis le 1er janvier 1970), lu dans « AAAA-MM-JJ ».
  // Sans date lisible : 0.
  function numeroDuJour(dateISO) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateISO || ''));
    if (!m) return 0;
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isFinite(t) ? Math.floor(t / 86400000) : 0;
  }

  // La piste par laquelle le tour commence ce jour-la : elle avance d une piste
  // chaque jour (et non d une paire : sur des journees calmes, une seule
  // reservation par jour passerait sinon toujours par les pistes impaires).
  function premierePisteDuJour(dateISO, nombreDePistes) {
    const total = Math.max(1, Math.trunc(Number(nombreDePistes)) || 1);
    return 1 + (numeroDuJour(dateISO) % total);
  }

  // Les minutes deja reservees par piste, depuis des fenetres { lanes, minutes }.
  function usageDesPistes(fenetres) {
    const usage = {};
    (Array.isArray(fenetres) ? fenetres : []).forEach((fenetre) => {
      const minutes = Math.round(Number(fenetre && fenetre.minutes) || 0);
      if (minutes <= 0) return;
      const pistes = [...new Set((Array.isArray(fenetre.lanes) ? fenetre.lanes : []).map(Number))]
        .filter((piste) => Number.isInteger(piste) && piste > 0);
      pistes.forEach((piste) => { usage[piste] = (usage[piste] || 0) + minutes; });
    });
    return usage;
  }

  function comparerCles(a, b) {
    for (let k = 0; k < a.length; k += 1) if (a[k] !== b[k]) return a[k] - b[k];
    return 0;
  }

  // LES GROUPES QUI GARDENT UNE GRAINE : elle, plus chaque suite des pistes
  // libres qui lui manquent, dans l ordre des numeros (comme les candidats sans
  // graine). Il y en a toujours un : la graine est libre et il reste assez de
  // pistes libres pour la completer.
  function autourDeLaGraine(graine, libres, nombre) {
    const reste = libres.filter((piste) => !graine.includes(piste));
    const manque = nombre - graine.length;
    const groupes = [];
    for (let i = 0; i + manque <= reste.length; i += 1) groupes.push([...graine, ...reste.slice(i, i + manque)].sort((a, b) => a - b));
    return groupes;
  }

  // options : libres (les pistes libres sur la fenetre), nombre (les pistes
  // voulues), pistes (le nombre de pistes du centre), usage (minutes par piste
  // sur la journee, usageDesPistes), date (« AAAA-MM-JJ »), coteACote (faux :
  // le centre renonce a garder un groupe cote a cote, reglage preferAdjacentLanes),
  // graine (les pistes que le groupe garde : celles qu une reservation modifiee
  // a deja, une piste touchee au comptoir).
  // Rend les pistes choisies (triees), [] pour zero piste, null s il en manque.
  function choisirPistes(options) {
    const o = options || {};
    const nombre = Math.trunc(Number(o.nombre)) || 0;
    if (nombre <= 0) return [];
    const libres = [...new Set((Array.isArray(o.libres) ? o.libres : []).map(Number))]
      .filter((piste) => Number.isInteger(piste) && piste > 0)
      .sort((a, b) => a - b);
    if (libres.length < nombre) return null;
    // LA GRAINE (2026-11-18, Ansar : « quand on passe 5j a 8j partout faut que ça
    // change les pistes »). Le groupe qui grandit garde ses pistes encore libres
    // et la regle ne choisit que celles qui manquent (avant : « la premiere
    // libre » apres elles, une copie de plus de la regle dans la console). Plus
    // de graine que de pistes voulues : la regle choisit celles qui restent,
    // parmi elles. Une piste de la graine qui n est pas libre ne compte pas.
    const graine = [...new Set((Array.isArray(o.graine) ? o.graine : []).map(Number))]
      .filter((piste) => libres.includes(piste))
      .sort((a, b) => a - b);
    if (graine.length >= nombre) return choisirPistes({ ...o, libres: graine, graine: [] });
    const total = Math.max(Math.trunc(Number(o.pistes)) || 0, libres[libres.length - 1]);
    const estLibre = new Set(libres);
    const voisine = new Map();
    paires(total).forEach(([a, b]) => { voisine.set(a, b); voisine.set(b, a); });
    const premiere = premierePisteDuJour(o.date, total);
    const rang = (piste) => (piste - premiere + total) % total;
    const usage = o.usage || {};
    const charge = (piste) => Math.max(0, Number(usage[piste]) || 0);
    const somme = (groupe) => groupe.reduce((s, piste) => s + charge(piste), 0);

    // Un centre sans « pistes voisines » : les moins utilisees, ou qu elles
    // soient (apres la graine).
    if (o.coteACote === false && nombre > 1) {
      return [...graine, ...libres.filter((piste) => !graine.includes(piste))
        .sort((a, b) => charge(a) - charge(b) || rang(a) - rang(b))
        .slice(0, nombre - graine.length)]
        .sort((a, b) => a - b);
    }

    // Une piste dont la voisine de paire est prise (reservation, panne,
    // blocage) : la prendre garde une paire entiere ailleurs. Une piste sans
    // paire (la derniere d un centre impair) ne compte pas comme telle, sinon
    // elle tournerait pour chaque groupe d une piste.
    const entamee = (piste) => voisine.has(piste) && !estLibre.has(voisine.get(piste));
    // Les paires qu un groupe coupe en laissant l autre piste seule et libre.
    const orphelines = (groupe) => groupe.filter((piste) => voisine.has(piste)
      && estLibre.has(voisine.get(piste)) && !groupe.includes(voisine.get(piste))).length;
    const paireEntiere = (groupe) => groupe.length === 2 && voisine.get(groupe[0]) === groupe[1];

    // Les candidats : chaque suite de `nombre` pistes libres consecutives dans
    // la liste (un bloc cote a cote quand il n y a pas de trou). Avec une
    // graine : elle, plus chaque suite de celles qui manquent ; les memes cles
    // les departagent.
    const candidats = [];
    for (let i = 0; i + nombre <= libres.length; i += 1) candidats.push(libres.slice(i, i + nombre));
    if (graine.length) candidats.splice(0, candidats.length, ...autourDeLaGraine(graine, libres, nombre));
    // 1. Ce que le groupe exige : une paire entiere pour 2, le bloc le plus serre.
    const exige = (groupe) => [nombre === 2 && !paireEntiere(groupe) ? 1 : 0, groupe[groupe.length - 1] - groupe[0]];
    const meilleureExigence = candidats.map(exige).reduce((a, b) => (comparerCles(b, a) < 0 ? b : a));
    const tenables = candidats.filter((groupe) => comparerCles(exige(groupe), meilleureExigence) === 0);
    // 2. L equilibre, mesure par piste (un groupe de 3 compte sa moyenne).
    const moyenne = (groupe) => somme(groupe) / groupe.length;
    const moinsUtilisee = Math.min(...tenables.map(moyenne));
    const cle = (groupe) => [
      moyenne(groupe) - moinsUtilisee >= ECART_TOLERE_MINUTES ? 1 : 0,
      // 3. Garder les paires entieres pour les groupes suivants.
      nombre === 1 ? (entamee(groupe[0]) ? 0 : 1) : orphelines(groupe),
      // 4. La moins utilisee, puis 5. le tour du jour.
      somme(groupe),
      Math.min(...groupe.map(rang)),
      rang(groupe[0]),
    ];
    let meilleur = null;
    let meilleureCle = null;
    tenables.forEach((groupe) => {
      const c = cle(groupe);
      if (!meilleur || comparerCles(c, meilleureCle) < 0) { meilleur = groupe; meilleureCle = c; }
    });
    return [...meilleur];
  }

  return {
    ECART_TOLERE_MINUTES,
    paires,
    numeroDuJour,
    premierePisteDuJour,
    usageDesPistes,
    choisirPistes,
  };
}));
