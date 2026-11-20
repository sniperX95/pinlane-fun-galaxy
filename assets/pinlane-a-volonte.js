/* ============================================================================
   CE QU UN ACCES ILLIMITE COMPREND ET GARDE, DIT EN CLAIR (2026-11-19)
   ----------------------------------------------------------------------------
   POURQUOI CE FICHIER EXISTE. Ansar, le 19/11 : « le truc illimité est super
   mal expliqué [...] on capte pas du tout ». Le ticket disait « 15:30 à 18:25,
   pistes 3 et 4, il restera 6 pistes, 20 armes » sans dire ce qui est compris
   ni quand, et rien ne disait que les pistes et les armes sont gardees toute
   la visite (lib/a-volonte.js).

   LA PHRASE, UNE SEULE FOIS, ICI. Le serveur la lit par require (le plan de la
   fenetre Reserver, lib/reserver-fenetre.js), la console par
   window.PinlaneAVolonte (la fiche du dossier, le planning, Modifier) : tous
   lisent le meme plan et disent la meme chose.

   Elle se lit sur le plan du dossier, jamais sur une copie : les pistes que la
   base a finalement attribuees, les heures d un dossier deplace au planning.
     - « À volonté de 15:30 à 18:30 : Bowling, Laser, Minigolf. » (les
       activites que le dossier comprend, et seulement elles)
     - « Bowling, pistes 3 et 4 gardées toute la visite. »
       (en long : « Bowling à volonté, pistes 3 et 4 gardées de 15:30 à 18:30 »)
     - « Laser, 10 armes gardées à chaque départ. »
       (en long : « Laser à volonté, 10 armes gardées à chaque départ de 15:30
       à 18:00 »)
     - une activite jouee une fois a son heure : « Bowling 1 h à 15:30,
       pistes 3 et 4. », « Laser, 1 partie à 16:30. »
   UN SEUL MOT, UNE SEULE FORME (2026-11-20, Ansar : « pour les activités
   illimité on comprend rien, un truc bcp plus simple à comprendre »). Le
   produit s appelle « Accès illimité » partout. Chaque activite a aussi son
   etiquette courte (`etiquettes` : « à volonté », « 1 h à 15:30 », « 1 partie
   à 16:30 ») pour les tuiles de la fenetre Reserver.
   LE CHOIX ACTIVITE PAR ACTIVITE (2026-11-20, le soir) : chaque dossier prend
   les activites qu il veut (lib/formule-comptoir.js, opsPlan.illimite), et la
   phrase ne cite que celles-la : « À volonté de 15:30 à 18:30 : Laser,
   Minigolf, Arcades · Bowling 1 h à 16:00 » (phraseDuChoix).

   Double vie : global navigateur (window.PinlaneAVolonte) et module CommonJS,
   comme assets/pinlane-pistes.js.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PinlaneAVolonte = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function minutesDe(valeur) {
    if (typeof valeur === 'number' && Number.isFinite(valeur)) return valeur > 48 ? Math.round(valeur) : Math.round(valeur * 60);
    const lu = /^(\d{1,2}):(\d{2})/.exec(String(valeur || ''));
    return lu ? Number(lu[1]) * 60 + Number(lu[2]) : null;
  }

  function heureDe(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  // Le debut et la fin d un bloc ou d une etape, en minutes : l heure ecrite d abord.
  function bornes(pas) {
    const debut = minutesDe(pas && pas.startTime) ?? minutesDe(pas && pas.start);
    const fin = minutesDe(pas && pas.endTime) ?? minutesDe(pas && pas.end);
    return { debut, fin };
  }

  function pistesDites(pistes) {
    if (!pistes.length) return 'pistes';
    if (pistes.length === 1) return `piste ${pistes[0]}`;
    return `pistes ${pistes.slice(0, -1).join(', ')} et ${pistes[pistes.length - 1]}`;
  }

  function dureeDite(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const reste = total % 60;
    if (total < 60) return `${total} min`;
    return `${Math.floor(total / 60)} h${reste ? ` ${String(reste).padStart(2, '0')}` : ''}`;
  }

  const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

  // Les blocs d une ressource du plan, gardes a volonte ou joues une fois.
  function blocsDe(plan, ressource, aVolonte) {
    const blocs = plan && Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
    return blocs.filter((bloc) => bloc && bloc.resourceType === ressource && Boolean(bloc.aVolonte) === aVolonte);
  }

  // Le plan garde-t-il quelque chose a volonte ?
  function gardeQuelqueChose(plan) {
    return blocsDe(plan, 'bowling_lane', true).length > 0 || blocsDe(plan, 'laser_arena', true).length > 0;
  }

  // LE NOM D UNE ACTIVITE DANS LA PHRASE, court comme sa tuile : « Laser » pour le Laser Game, le
  // premier mot d un nom de deux mots quand il suffit (« Minigolf »), les deux premiers d un nom plus
  // long (« Fun Run »).
  function nomCourt(id, nom) {
    if (id === 'bowling') return 'Bowling';
    if (id === 'laser_game') return 'Laser';
    const mots = String(nom || id || '').trim().split(/\s+/).filter(Boolean);
    if (mots.length > 2) return mots.slice(0, 2).join(' ');
    return mots.length === 2 && mots[0].length >= 6 ? mots[0] : mots.join(' ');
  }

  // LA PHRASE DU CHOIX (2026-11-20, un gerant : « il faut qu on puisse choisir activité par activité
  // pour l illimité »). Elle ne cite que ce que le dossier comprend, et dit le bowling ou le laser joues
  // une fois a leur heure : « À volonté de 15:30 à 18:30 : Laser, Minigolf, Arcades · Bowling 1 h à
  // 16:00 ». Avant toute heure, « pendant 3 h ». `comprises` : [{ id, nom }] dans l ordre du centre ;
  // `uneFois` : [{ activite, court }].
  function phraseDuChoix({ debut = '', fin = '', minutes = 0, comprises = [], uneFois = [] } = {}) {
    const aHeure = new Set(uneFois.map((u) => u.activite));
    const libres = comprises.filter((a) => a && a.id && !aHeure.has(a.id)).map((a) => nomCourt(a.id, a.nom));
    const quand = debut && fin ? `de ${debut} à ${fin}` : `pendant ${dureeDite(minutes)}`;
    return [libres.length ? `À volonté ${quand} : ${libres.join(', ')}` : '', ...uneFois.map((u) => u.court)].filter(Boolean).join(' · ');
  }

  // Les activites d un plan, quand l appelant ne dit pas ce que le dossier comprend.
  function activitesDuPlan(plan) {
    const vues = new Map();
    [...(Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : []), ...(Array.isArray(plan.timeline) ? plan.timeline : [])].forEach((pas) => {
      if (pas && pas.activityId && !vues.has(pas.activityId)) vues.set(pas.activityId, String(pas.label || '').replace(/\s+à volonté$/, ''));
    });
    return [...vues].map(([id, nom]) => ({ id, nom }));
  }

  // CE QUE L ACCES COMPREND ET GARDE. `plan` : le plan du dossier (opsPlan). Options : `minutes`,
  // la duree vendue (la visite ne finit pas avant) ; `comprises`, les activites que le dossier
  // comprend ([{ id, nom }], son choix), sinon celles du plan. Rend null sans plan lisible.
  // (`toutes` et `nombre` disaient « Tout à volonté » ou « 6 activités à volonté » avant le choix
  // activite par activite : la phrase cite maintenant chacune.)
  function resume(plan, { minutes = 0, comprises = null } = {}) {
    if (!plan || typeof plan !== 'object') return null;
    const blocs = Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
    const etapes = Array.isArray(plan.timeline) ? plan.timeline : [];
    const activites = [...blocs, ...etapes].filter((pas) => pas && pas.activityId);
    const debuts = activites.map((pas) => bornes(pas).debut).filter((m) => m !== null);
    const fins = activites.map((pas) => bornes(pas).fin).filter((m) => m !== null);
    const debut = minutesDe(plan.startTime) ?? (debuts.length ? Math.min(...debuts) : null);
    if (debut === null) return null;
    const fin = Math.max(fins.length ? Math.max(...fins) : debut, debut + Math.max(0, Math.round(Number(minutes) || 0)));
    const gardes = [];
    const pistesGardees = blocsDe(plan, 'bowling_lane', true);
    if (pistesGardees.length) {
      const pistes = [...new Set(pistesGardees.flatMap((bloc) => (Array.isArray(bloc.lanes) ? bloc.lanes : []).map(Number)))].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
      const de = Math.min(...pistesGardees.map((bloc) => bornes(bloc).debut).filter((m) => m !== null));
      const a = Math.max(...pistesGardees.map((bloc) => bornes(bloc).fin).filter((m) => m !== null));
      const gardees = pistes.length > 1 ? 'gardées' : 'gardée';
      gardes.push({
        activite: 'bowling',
        pistes,
        debut: heureDe(de),
        fin: heureDe(a),
        courte: `Bowling, ${pistesDites(pistes)} ${gardees} toute la visite.`,
        longue: `Bowling à volonté, ${pistesDites(pistes)} ${gardees} de ${heureDe(de)} à ${heureDe(a)}`,
        etiquette: 'à volonté',
        precision: pistes.length ? pistesDites(pistes) : '',
      });
    }
    const departs = blocsDe(plan, 'laser_arena', true);
    if (departs.length) {
      const armes = Math.max(...departs.map((bloc) => Number(bloc.players) || 0));
      const heures = departs.map((bloc) => bornes(bloc).debut).filter((m) => m !== null).sort((x, y) => x - y);
      const premier = heureDe(heures[0]);
      const dernier = heureDe(heures[heures.length - 1]);
      gardes.push({
        activite: 'laser_game',
        armes,
        departs: heures.length,
        debut: premier,
        fin: dernier,
        courte: `Laser, ${pluriel(armes, 'arme')} ${armes > 1 ? 'gardées' : 'gardée'} à chaque départ.`,
        longue: `Laser à volonté, ${pluriel(armes, 'arme')} ${armes > 1 ? 'gardées' : 'gardée'} à chaque départ ${heures.length > 1 ? `de ${premier} à ${dernier}` : `à ${premier}`}`,
        etiquette: 'à volonté',
        precision: armes > 0 ? pluriel(armes, 'arme') : '',
      });
    }
    // Ce qui se joue une fois, a son heure.
    const uneFois = [];
    const pistesUneFois = blocsDe(plan, 'bowling_lane', false);
    if (pistesUneFois.length) {
      const de = Math.min(...pistesUneFois.map((bloc) => bornes(bloc).debut).filter((m) => m !== null));
      const duree = pistesUneFois.reduce((total, bloc) => { const b = bornes(bloc); return total + (b.debut !== null && b.fin !== null ? b.fin - b.debut : 0); }, 0);
      const pistes = [...new Set(pistesUneFois.flatMap((bloc) => (Array.isArray(bloc.lanes) ? bloc.lanes : []).map(Number)))].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
      uneFois.push({ activite: 'bowling', debut: heureDe(de), phrase: `Bowling ${dureeDite(duree)} à ${heureDe(de)}${pistes.length ? `, ${pistesDites(pistes)}` : ''}.`, court: `Bowling ${dureeDite(duree)} à ${heureDe(de)}`, etiquette: `${dureeDite(duree)} à ${heureDe(de)}`, precision: pistes.length ? pistesDites(pistes) : '' });
    }
    const lasersUneFois = blocsDe(plan, 'laser_arena', false);
    if (lasersUneFois.length) {
      const parPartie = new Map();
      lasersUneFois.forEach((bloc) => {
        const partie = Math.max(1, Number(bloc.countIndex) || 1);
        const m = bornes(bloc).debut;
        if (m !== null && (!parPartie.has(partie) || m < parPartie.get(partie))) parPartie.set(partie, m);
      });
      const heures = [...parPartie.values()].sort((x, y) => x - y).map(heureDe);
      const quand = heures.length > 1 ? `${heures.slice(0, -1).join(', ')} et ${heures[heures.length - 1]}` : heures[0];
      if (heures.length) uneFois.push({ activite: 'laser_game', debut: heures[0], phrase: `Laser, ${pluriel(heures.length, 'partie')} à ${quand}.`, court: `Laser ${pluriel(heures.length, 'partie')} à ${quand}`, etiquette: `${pluriel(heures.length, 'partie')} à ${quand}`, precision: '' });
    }
    // La phrase ne cite que ce que le dossier comprend ; ce qui se joue une fois s y dit a son heure.
    const liste = Array.isArray(comprises) ? comprises : activitesDuPlan(plan);
    const phrase = phraseDuChoix({ debut: heureDe(debut), fin: heureDe(fin), comprises: liste, uneFois: uneFois.filter((u) => liste.some((a) => a && a.id === u.activite)) });
    // L etiquette de chaque activite garde ou jouee une fois, pour sa photo.
    const etiquettes = {};
    [...gardes, ...uneFois].forEach((ligne) => { etiquettes[ligne.activite] = { etiquette: ligne.etiquette, precision: ligne.precision || '' }; });
    return {
      debut: heureDe(debut),
      fin: heureDe(fin),
      phrase,
      gardes,
      uneFois,
      etiquettes,
      // La phrase, puis ce que les pistes et les armes gardees deviennent.
      texte: [`${phrase}.`, ...gardes.map((g) => g.courte)].join(' '),
    };
  }

  // La phrase longue d un bloc garde, pour la carte du planning (son infobulle et sa lecture vocale).
  function phraseDuBloc(plan, bloc) {
    if (!bloc || !bloc.aVolonte) return '';
    const r = resume(plan);
    const garde = r && r.gardes.find((g) => g.activite === (bloc.resourceType === 'laser_arena' ? 'laser_game' : 'bowling'));
    return garde ? garde.longue : '';
  }

  return { resume, phraseDuBloc, phraseDuChoix, nomCourt, gardeQuelqueChose };
}));
