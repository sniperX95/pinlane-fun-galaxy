// LES ORBES DE REFLEXION DE L'AGENT, EN VANILLA.
//
// Movsar, 2026-08-14 : « ameliore toutes les animations de l'IA, faut que ce
// soit vraiment super quali, diversifie les animations », puis « utilise le
// plus possible du contenu de thinking-orbs ».
//
// CE QUI EST REPRIS TEL QUEL : tout le moteur de dessin, c'est-a-dire la
// totalite de ce qui fait l'animation. `assets/vendor/thinking-orbs-engine.js`
// est le fichier `dist/engine.es.js` du paquet npm `thinking-orbs` 0.3.1
// (Jakub Antalik, licence MIT, copie dans `vendor/thinking-orbs-LICENSE.txt`),
// repris SANS AUCUNE MODIFICATION. Il porte les neuf etats, leurs presets de
// vitesse et de densite, la projection 3D et le rendu en arcs de canvas 2D.
//
// CE QUI EST ECRIT ICI, ET SEULEMENT CA : le pont. Le paquet ne s'installe pas
// dans Pinlane, parce qu'il expose ses etats a travers un COMPOSANT REACT
// (peer dependency react >= 18) et que cette application est en JavaScript
// vanilla, sans etape de build. Mais son moteur, lui, n'importe rien du tout :
// verifie, zero `import`, zero occurrence de « react ». Le composant React ne
// fait que trois choses autour de lui, et ce fichier les refait en vanilla :
//   1. dimensionner le canvas au ratio de pixels de l'ecran ;
//   2. appeler le dessin dans une boucle d'animation ;
//   3. arreter cette boucle quand personne ne regarde.
//
// Le point 3 n'est pas un detail de performance, c'est ce qui rend l'animation
// acceptable derriere un comptoir : une boucle d'animation qui tourne sur un
// ecran masque ou hors du champ visible chauffe la machine pour rien. On suit
// donc l'observateur d'intersection ET la visibilite de l'onglet, exactement
// comme le composant d'origine.
//
// `prefers-reduced-motion` : une seule image fixe, prise a un instant choisi
// pour que la figure soit lisible. L'etat reste visible, il ne bouge plus.

(function () {
  'use strict';

  const ETATS = new Set(['working', 'searching', 'solving', 'listening', 'connecting', 'weaving', 'composing', 'breathing', 'shaping']);
  const instances = new WeakMap();
  let moteur = null;
  let chargement = null;

  // Le moteur est un module ES : il se charge par import dynamique, une seule
  // fois, et l'application continue de tourner s'il echoue (une animation
  // absente n'a jamais empeche personne de servir un client).
  function chargerMoteur() {
    if (moteur) return Promise.resolve(moteur);
    if (chargement) return chargement;
    chargement = import('./vendor/thinking-orbs-engine.js')
      .then((mod) => { moteur = mod; return mod; })
      .catch(() => null);
    return chargement;
  }

  function reduitLeMouvement() {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Le theme suit celui de l'application : `data-theme` est pose sur <html> des
  // la premiere ligne du document, et l'utilisateur peut le basculer en cours
  // de session, d'ou l'observateur.
  function estSombre() {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark') return true;
    if (attr === 'light') return false;
    return typeof matchMedia === 'undefined' || matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function animer(canvas) {
    const precedent = instances.get(canvas);
    if (precedent) precedent.stop();

    const etat = ETATS.has(canvas.dataset.orbState) ? canvas.dataset.orbState : 'working';
    const taille = Number(canvas.dataset.orbSize) === 64 ? 64 : 20;
    const vitesseUtilisateur = Number(canvas.dataset.orbSpeed) || 1;

    const ratio = Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
    canvas.width = Math.round(taille * ratio);
    canvas.height = Math.round(taille * ratio);
    canvas.style.width = `${taille}px`;
    canvas.style.height = `${taille}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { mode, speed, opts } = moteur.resolvePreset(etat, taille);
    const dessiner = moteur.MODE_DRAWS[mode];
    const vitesse = speed * vitesseUtilisateur;
    let sombre = estSombre();

    const image = (t) => {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, taille, taille);
      dessiner(ctx, taille, t, sombre, opts);
    };

    if (reduitLeMouvement()) {
      image(0.6);
      instances.set(canvas, { stop() {} });
      return;
    }

    let raf = 0;
    let tourne = false;
    let visible = true;

    const boucle = () => {
      image((performance.now() / 1000) * vitesse);
      if (tourne) raf = requestAnimationFrame(boucle);
    };
    const demarrer = () => { if (!tourne) { tourne = true; raf = requestAnimationFrame(boucle); } };
    const arreter = () => { tourne = false; cancelAnimationFrame(raf); };

    image((performance.now() / 1000) * vitesse);

    const observateur = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(([entree]) => {
        visible = entree.isIntersecting;
        if (visible && document.visibilityState !== 'hidden') demarrer();
        else arreter();
      })
      : null;
    if (observateur) observateur.observe(canvas);
    else demarrer();

    const surVisibilite = () => {
      if (document.visibilityState === 'hidden') arreter();
      else if (visible) demarrer();
    };
    document.addEventListener('visibilitychange', surVisibilite);

    const surTheme = new MutationObserver(() => {
      const suivant = estSombre();
      if (suivant !== sombre) { sombre = suivant; image((performance.now() / 1000) * vitesse); }
    });
    surTheme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    instances.set(canvas, {
      stop() {
        arreter();
        if (observateur) observateur.disconnect();
        surTheme.disconnect();
        document.removeEventListener('visibilitychange', surVisibilite);
        instances.delete(canvas);
      },
    });
  }

  // LA CONSOLE REDESSINE SES ECRANS PAR `innerHTML` : un canvas anime peut donc
  // disparaitre du document a tout moment, et un nouveau apparaitre sans que
  // personne ne previenne. On balaie donc apres chaque rendu au lieu de compter
  // sur l'appelant : c'est la seule facon de ne jamais laisser une boucle
  // tourner sur un canvas detache.
  function monterLesOrbes(racine = document) {
    const canvases = racine.querySelectorAll('canvas[data-orb-state]:not([data-orb-monte])');
    if (!canvases.length) return;
    chargerMoteur().then((mod) => {
      if (!mod) return;
      canvases.forEach((canvas) => {
        if (!canvas.isConnected) return;
        canvas.dataset.orbMonte = '1';
        animer(canvas);
      });
    });
  }

  const observateurDom = new MutationObserver(() => { monterLesOrbes(); monterLesProgressions(); });
  if (document.body) observateurDom.observe(document.body, { childList: true, subtree: true });
  else document.addEventListener('DOMContentLoaded', () => {
    observateurDom.observe(document.body, { childList: true, subtree: true });
    monterLesOrbes();
    monterLesProgressions();
  });

  // UNE ATTENTE QUI DURE DOIT MONTRER UNE PROGRESSION, PAS UNE POSE.
  // Movsar : « la reponse doit etre du style thinking-orbs, plus visible et
  // beaucoup plus diversifie, un truc quali ou on voit l evolution ». Une seule
  // orbe qui tourne pendant huit secondes dit « ca charge » ; elle ne dit pas
  // qu on avance. Un element porteur de `data-orb-steps` enchaine donc les
  // etapes du travail REEL de l agent, chacune avec son etat d orbe et son
  // libelle, et une barre qui se remplit dit ou on en est.
  // Les etapes ne sont pas decoratives : elles nomment ce que le cycle fait
  // vraiment (lire les donnees, croiser, rediger, verifier). Inventer une
  // progression qui ne correspond a rien serait mentir avec une animation.
  const progressions = new WeakMap();

  function demarrerProgression(hote) {
    if (progressions.has(hote)) return;
    let etapes;
    try { etapes = JSON.parse(hote.dataset.orbSteps || '[]'); } catch (e) { etapes = []; }
    if (!Array.isArray(etapes) || !etapes.length) return;

    const canvas = hote.querySelector('canvas[data-orb-state]');
    const libelle = hote.querySelector('[data-orb-step-label]');
    const barre = hote.querySelector('[data-orb-step-bar]');
    let index = 0;

    const appliquer = () => {
      const etape = etapes[index];
      if (!etape) return;
      if (libelle) libelle.textContent = etape.label || '';
      if (barre) barre.style.width = `${Math.round(((index + 1) / etapes.length) * 100)}%`;
      if (canvas && ETATS.has(etape.state) && canvas.dataset.orbState !== etape.state) {
        canvas.dataset.orbState = etape.state;
        // Le moteur lit l'etat au montage : on relance l'animation sur le neuf.
        if (moteur) animer(canvas);
      }
    };

    appliquer();
    // La derniere etape ne tourne pas en boucle : elle RESTE. Repartir a zero
    // ferait croire que le travail recommence, et un gerant qui voit une barre
    // se vider conclut que ca a echoue.
    const minuteur = window.setInterval(() => {
      if (index >= etapes.length - 1) { window.clearInterval(minuteur); return; }
      index += 1;
      appliquer();
    }, Math.max(700, Number(hote.dataset.orbStepMs) || 1600));

    progressions.set(hote, minuteur);
  }

  function monterLesProgressions(racine = document) {
    racine.querySelectorAll('[data-orb-steps]').forEach((hote) => {
      if (!hote.isConnected) return;
      chargerMoteur().then((mod) => { if (mod) demarrerProgression(hote); });
    });
  }

  const monterTout = (racine) => { monterLesOrbes(racine); monterLesProgressions(racine); };

  window.PinlaneOrbs = { monter: monterTout, etats: [...ETATS] };
  monterTout();
})();
