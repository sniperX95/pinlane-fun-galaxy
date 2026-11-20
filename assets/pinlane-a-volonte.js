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
     - « Tout à volonté de 15:30 à 18:30. » (« 6 activités à volonté de 15:30
       à 18:30. » quand le gerant en a decoche)
     - « Bowling, pistes 3 et 4 gardées toute la visite. »
       (en long : « Bowling à volonté, pistes 3 et 4 gardées de 15:30 à 18:30 »)
     - « Laser, 10 armes gardées à chaque départ. »
       (en long : « Laser à volonté, 10 armes gardées à chaque départ de 15:30
       à 18:00 »)
     - une activite jouee une fois a son heure : « Bowling 1 h à 15:30,
       pistes 3 et 4. », « Laser, 1 partie à 16:30. »
   UN SEUL MOT, UNE SEULE FORME (2026-11-20, Ansar : « pour les activités
   illimité on comprend rien, un truc bcp plus simple à comprendre »). Le
   produit s appelle « Accès illimité » partout ; sa phrase commence toujours
   par « Tout à volonté », puis dit ce qui est garde ou joue une fois, sans
   deux-points au milieu. Chaque activite a aussi son etiquette courte
   (`etiquettes` : « à volonté », « 1 h à 15:30 », « 1 partie à 16:30 ») pour
   les photos de la fenetre Reserver.

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

  // CE QUE L ACCES COMPREND ET GARDE. `plan` : le plan du dossier (opsPlan). Options : `minutes`,
  // la duree vendue (la visite ne finit pas avant) ; `toutes`, le dossier comprend toutes les
  // activites du centre. Rend null sans plan lisible.
  // `nombre` : combien d activites le dossier comprend, quand ce ne sont pas toutes celles du centre.
  function resume(plan, { minutes = 0, toutes = true, nombre = 0 } = {}) {
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
      uneFois.push({ activite: 'bowling', debut: heureDe(de), phrase: `Bowling ${dureeDite(duree)} à ${heureDe(de)}${pistes.length ? `, ${pistesDites(pistes)}` : ''}.`, etiquette: `${dureeDite(duree)} à ${heureDe(de)}`, precision: pistes.length ? pistesDites(pistes) : '' });
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
      if (heures.length) uneFois.push({ activite: 'laser_game', debut: heures[0], phrase: `Laser, ${pluriel(heures.length, 'partie')} à ${quand}.`, etiquette: `${pluriel(heures.length, 'partie')} à ${quand}`, precision: '' });
    }
    // (ce qui se joue une fois suit la phrase : elle n a plus a dire « sauf »)
    const phrase = `${tete({ toutes, nombre })} de ${heureDe(debut)} à ${heureDe(fin)}.`;
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
      texte: [phrase, ...gardes.map((g) => g.courte), ...uneFois.map((u) => u.phrase)].join(' '),
    };
  }

  // LE DEBUT DE LA PHRASE, le meme avant toute heure (« Tout à volonté pendant 3 h ») et sur un plan
  // (« Tout à volonté de 15:30 à 18:30 ») : toutes les activites du centre, sinon combien.
  function tete({ toutes = true, nombre = 0 } = {}) {
    if (toutes !== false) return 'Tout à volonté';
    const n = Math.max(0, Math.trunc(Number(nombre) || 0));
    return n > 0 ? `${pluriel(n, 'activité')} à volonté` : 'Les activités comprises à volonté';
  }

  // La phrase longue d un bloc garde, pour la carte du planning (son infobulle et sa lecture vocale).
  function phraseDuBloc(plan, bloc) {
    if (!bloc || !bloc.aVolonte) return '';
    const r = resume(plan);
    const garde = r && r.gardes.find((g) => g.activite === (bloc.resourceType === 'laser_arena' ? 'laser_game' : 'bowling'));
    return garde ? garde.longue : '';
  }

  return { resume, phraseDuBloc, gardeQuelqueChose, tete };
}));
