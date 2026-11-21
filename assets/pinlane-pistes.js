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

   COTE A COTE D ABORD (2026-11-21, le gerant de Fun Galaxy : « ça ne met plus
   des pistes ensemble quand c'est des groupes qui ont plusieurs personnes [...]
   ça ne les met plus côte à côte »). La graine (les pistes qu un dossier modifie
   a deja, « Ils sont N », une piste ajoutee par la fenetre) passait AVANT : un
   groupe qui grandissait gardait sa piste 4 et prenait la 6, les pistes 3 et 5
   prises, alors que 1-2 et 7-8 etaient libres. Avec l equilibre, les groupes
   d une piste ne s empilent plus sur les premieres pistes : la voisine d une
   piste est plus souvent prise, et le groupe s eparpillait. Maintenant un groupe
   de N pistes recoit N pistes qui se suivent ; la graine n est gardee que si un
   bloc cote a cote la contient ; l equilibre choisit QUEL bloc. Seules les
   pistes choisies a la main (`fermes`) restent toujours, comme le staff les a
   touchees. Aucun bloc libre a cette heure : le partage qui laisse le moins de
   trous, et pistesSeparees le dit au staff (« pistes 3 et 6 : aucune paire cote
   a cote n est libre »).

   Parmi les pistes libres sur la fenetre (chaque appelant les compte comme
   avant : occupees, maintenance, blocage), dans cet ordre :
     1. ce qu un groupe exige : des pistes cote a cote (le moins de trous
        possible), puis les pistes de sa graine gardees, puis, pour un groupe
        de 2, une paire entiere (1-2, 3-4...) ;
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
  // TROP DE GRAINE (2026-11-19, le groupe qui baisse) : chaque suite de `nombre`
  // pistes de la graine ; les memes cles les departagent, sur toutes les pistes
  // libres de la journee (une piste rendue qui laisse sa voisine seule compte).
  function autourDeLaGraine(graine, libres, nombre) {
    if (graine.length >= nombre) {
      const blocs = [];
      for (let i = 0; i + nombre <= graine.length; i += 1) blocs.push(graine.slice(i, i + nombre));
      return blocs;
    }
    const reste = libres.filter((piste) => !graine.includes(piste));
    const manque = nombre - graine.length;
    const groupes = [];
    for (let i = 0; i + manque <= reste.length; i += 1) groupes.push([...graine, ...reste.slice(i, i + manque)].sort((a, b) => a - b));
    return groupes;
  }

  // Des numeros qui se suivent : 3-4-5, jamais 3-5.
  function seSuivent(pistes) {
    return pistes.every((piste, i) => i === 0 || piste === pistes[i - 1] + 1);
  }

  // Les pistes qui manquent entre la premiere et la derniere d un groupe trie
  // (0 : cote a cote).
  function trous(groupe) {
    return groupe.length ? groupe[groupe.length - 1] - groupe[0] - (groupe.length - 1) : 0;
  }

  // Des numeros de piste lus d une liste : entiers positifs, sans doublon.
  function lirePistes(liste) {
    return [...new Set((Array.isArray(liste) ? liste : []).map(Number))]
      .filter((piste) => Number.isInteger(piste) && piste > 0);
  }

  // Les blocs de `nombre` pistes libres qui se suivent, dans l ordre des numeros.
  function blocsCoteACote(libres, nombre) {
    const triees = lirePistes(libres).sort((a, b) => a - b);
    const blocs = [];
    for (let i = 0; i + nombre <= triees.length; i += 1) {
      const groupe = triees.slice(i, i + nombre);
      if (seSuivent(groupe)) blocs.push(groupe);
    }
    return blocs;
  }

  // « 3 et 6 », « 2, 4 et 7 ».
  function enumerer(pistes) {
    return pistes.length > 2 ? `${pistes.slice(0, -1).join(', ')} et ${pistes[pistes.length - 1]}` : pistes.join(' et ');
  }

  // LE PARTAGE SE DIT (2026-11-21). Des pistes qui ne se suivent pas, en une
  // phrase pour le staff : « pistes 3 et 6 : aucune paire côte à côte n’est
  // libre ». Rien quand elles se suivent, ni quand un bloc cote a cote etait
  // libre sans piste choisie a la main (le staff a pose ces pistes lui-meme),
  // ni quand toutes l ont ete.
  // options : pistes (celles du groupe), libres (les pistes libres sur la
  // fenetre, celles du groupe comprises), fermes (celles choisies a la main).
  function pistesSeparees(options) {
    const o = options || {};
    const pistes = lirePistes(o.pistes).sort((a, b) => a - b);
    if (pistes.length < 2 || seSuivent(pistes)) return '';
    const libres = lirePistes([...(Array.isArray(o.libres) ? o.libres : []), ...pistes]);
    const liste = enumerer(pistes);
    if (!blocsCoteACote(libres, pistes.length).length) {
      return pistes.length === 2
        ? `pistes ${liste} : aucune paire côte à côte n’est libre`
        : `pistes ${liste} : aucun bloc de ${pistes.length} pistes côte à côte n’est libre`;
    }
    const fermes = lirePistes(o.fermes).filter((piste) => pistes.includes(piste)).sort((a, b) => a - b);
    if (!fermes.length || fermes.length === pistes.length) return '';
    const bloc = pistes.length === 2 ? 'aucune paire côte à côte' : `aucun bloc de ${pistes.length} pistes côte à côte`;
    return fermes.length > 1
      ? `pistes ${liste} : ${bloc} ne passe par les pistes ${enumerer(fermes)}, choisies à la main`
      : `pistes ${liste} : ${bloc} ne passe par la piste ${fermes[0]}, choisie à la main`;
  }

  // options : libres (les pistes libres sur la fenetre), nombre (les pistes
  // voulues), pistes (le nombre de pistes du centre), usage (minutes par piste
  // sur la journee, usageDesPistes), date (« AAAA-MM-JJ »), coteACote (faux :
  // le centre renonce a garder un groupe cote a cote, reglage preferAdjacentLanes),
  // graine (les pistes que le groupe a deja : celles d une reservation modifiee,
  // celles que la fenetre a ajoutees ; gardees si un bloc cote a cote les
  // contient), fermes (les pistes choisies a la main par le staff : toujours
  // gardees).
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
    // de graine que de pistes voulues (un groupe qui baisse, 2026-11-19) : la
    // regle choisit le meilleur bloc parmi elles, juge sur toutes les pistes
    // libres. Une piste de la graine qui n est pas libre ne compte pas.
    // LES PISTES CHOISIES A LA MAIN (2026-11-21) : toujours gardees, la regle ne
    // choisit que celles qui manquent. Elles font partie de la graine.
    const fermes = lirePistes(o.fermes).filter((piste) => libres.includes(piste)).sort((a, b) => a - b);
    const graine = lirePistes([...fermes, ...(Array.isArray(o.graine) ? o.graine : [])])
      .filter((piste) => libres.includes(piste))
      .sort((a, b) => a - b);
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
      if (graine.length >= nombre) {
        return [...fermes, ...graine.filter((piste) => !fermes.includes(piste)).sort((a, b) => charge(a) - charge(b) || rang(a) - rang(b))]
          .slice(0, nombre).sort((a, b) => a - b);
      }
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
    // la liste (un bloc cote a cote quand il n y a pas de trou), plus, avec une
    // graine, elle et chaque suite de celles qui manquent (avant le 21/11,
    // seulement celles-la : le groupe qui grandissait s eparpillait autour de sa
    // piste). Un groupe qui baisse choisit parmi les siennes. Tous gardent les
    // pistes choisies a la main.
    let candidats = [];
    const base = fermes.length >= nombre ? fermes : graine;
    if (base.length >= nombre) {
      candidats = autourDeLaGraine(base, libres, nombre).filter((groupe) => base === fermes || fermes.every((piste) => groupe.includes(piste)));
      if (!candidats.length) candidats = [[...fermes, ...graine.filter((piste) => !fermes.includes(piste))].slice(0, nombre).sort((a, b) => a - b)];
    } else {
      for (let i = 0; i + nombre <= libres.length; i += 1) candidats.push(libres.slice(i, i + nombre));
      if (graine.length) candidats.push(...autourDeLaGraine(graine, libres, nombre));
      if (fermes.length && fermes.length < graine.length) candidats.push(...autourDeLaGraine(fermes, libres, nombre));
      candidats = candidats.filter((groupe) => fermes.every((piste) => groupe.includes(piste)));
    }
    const garde = (groupe) => groupe.filter((piste) => graine.includes(piste)).length;
    // 1. Ce que le groupe exige : cote a cote (le moins de trous), puis les
    // pistes de sa graine, puis une paire entiere pour 2.
    const exige = (groupe) => [trous(groupe), -garde(groupe), nombre === 2 && !paireEntiere(groupe) ? 1 : 0];
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
    seSuivent,
    blocsCoteACote,
    pistesSeparees,
    paires,
    numeroDuJour,
    premierePisteDuJour,
    usageDesPistes,
    choisirPistes,
  };
}));
