(function () {
  const PLATFORM_MARK_SRC = './assets/brand/pinlane-mark.svg';
  const COLLAPSE_KEY = 'fgx:staff-menu-collapsed';
  const GROUPS_KEY = 'fgx:staff-menu-groups';
  // Logo de marque personnalisable : choix MVP ASSUME, persistance localStorage
  // UNIQUEMENT (device-local, non synchronise entre machines/navigateurs).
  // Une version synchronisee serveur (par centre) est un follow-up.
  const BRAND_LOGO_KEY = 'fgx:staff-brand-logo';
  const MAX_BRAND_LOGO_BYTES = 512 * 1024;
  // Duree de sortie des popovers : DOIT couvrir l'animation CSS fgx-menu-pop-out
  // (--dur-fast = 120ms) avant le retrait du DOM.
  const POPOVER_EXIT_MS = 140;
  const DEFAULT_OPEN_GROUPS = { planning: false, field: false, activities: false };
  const GROUP_DEFAULT_TARGETS = {
    planning: 'planning',
    field: 'arrivals',
    activities: 'prices'
  };
  // Le nom et la signature de la marque sont DESSINES dans le lockup : les
  // retaper en police d'interface donnait un « Pinlane » en casse mixte a cote
  // d'un logo en capitales trackees, et repetait la baseline du logo en
  // sous-titre. Ne reste ici que ce qui n'est pas dans l'image.
  const PLATFORM_BRAND = {
    name: 'Pinlane',
    accountRole: 'Accès complet'
  };
  // Variante SIGNEE : le lockup porte « console du centre » en capitales
  // dessinees. Lisible a partir de 32 px de hauteur totale, pose a 40.
  const PLATFORM_LOCKUP_SRC = './assets/brand/pinlane-logo-signe.svg';
  const FALLBACK_CENTERS = [
    {
      id: 'libramont',
      name: 'Fun Galaxy Libramont',
      label: 'Fun Galaxy Centre',
      meta: '8 pistes · 30 armes laser · 1 lancement',
      status: 'Actif'
    },
    {
      id: 'gembloux',
      name: 'Fun Galaxy Gembloux',
      label: 'Fun Galaxy Gembloux',
      meta: '8 pistes · 30 armes laser · 3 lancements',
      status: 'Actif'
    },
    {
      id: 'ciney',
      name: 'Fun Galaxy Ciney',
      label: 'Fun Galaxy Ciney',
      meta: 'Centre à finaliser',
      status: 'Prévu'
    }
  ];
  let menuDocumentEventsBound = false;
  let menuGroupOpenState = null;

  const icons = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/></svg>',
    planning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
    reservations: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v5h5M10 13h6M10 17h4"/></svg>',
    sessions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>',
    arrivals: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/><path d="m15 8 4 4-4 4"/></svg>',
    events: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="14" height="15" rx="2"/><path d="M8 3v4M16 3v4M8 11h8M8 15h5"/></svg>',
    clients: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.7-3.5 2.8-5.4 5.5-5.4s4.8 1.9 5.5 5.4"/><path d="M16 10a2.5 2.5 0 1 0 0-5M17 14c1.8.4 3 2 3.5 5"/></svg>',
    groups: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3.5 19c.5-3.2 2.2-5 4.5-5s4 1.8 4.5 5M11.5 19c.5-3.2 2.2-5 4.5-5s4 1.8 4.5 5"/></svg>',
    contacts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10M7 12h6M7 17h4"/><rect x="4" y="4" width="16" height="16" rx="2"/></svg>',
    lanes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h14v5H5zM5 15h14v5H5z"/><path d="M7 9v6M17 9v6"/></svg>',
    prices: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5h16v3M6 8h12v11H6z"/><path d="M9 12h6M9 15h4"/></svg>',
    laser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/><path d="M4.5 19.5 7 17M17 7l2.5-2.5"/></svg>',
    offers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11V5h6l10 10-6 6z"/><circle cx="8" cy="9" r="1.4"/></svg>',
    emails: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="2"/><path d="m5 8 7 5 7-5"/></svg>',
    campaigns: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 14h3l8 4V6l-8 4H5z"/><path d="M8 14v5M18 10l3-2M18 14l3 2"/></svg>',
    establishment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16M6 20V8l6-4 6 4v12"/><path d="M10 20v-6h4v6M8 10h2M14 10h2"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3.4 2.7-5.2 5.5-5.2s4.9 1.8 5.5 5.2"/><path d="M16 11h4M18 9v4"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.9-1.1L14.3 3h-4.6l-.3 2.9A7 7 0 0 0 7.5 7L5.1 6 3.1 9.4l2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.1l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.9 1.1l.3 2.9h4.6l.3-2.9a7 7 0 0 0 1.9-1.1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1.1Z"/></svg>',
    center: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 7v10l8 4 8-4V7z"/><path d="M12 21V11M4 7l8 4 8-4"/></svg>',
    panel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M9.5 5v14"/></svg>',
    kebab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5.6" r="0.6"/><circle cx="12" cy="12" r="0.6"/><circle cx="12" cy="18.4" r="0.6"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5Z"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9" r="1.6"/><path d="m5 18 5-5 3 3 2.5-2.5L20 18"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10a8 8 0 1 1 2.3 6.5"/><path d="M4 5v5h5"/></svg>',
    store: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h16l-1-4H5L4 9Z"/><path d="M5 9v10h14V9M9 19v-5h6v5"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="m15 8 4 4-4 4M19 12H10"/></svg>'
  };

  const menuSections = [
    {
      title: 'Journée',
      items: [
        { key: 'dashboard', label: "Vue d'ensemble", icon: 'dashboard' },
        {
          key: 'planning',
          label: 'Planning',
          icon: 'planning',
          children: [
            { key: 'bowling', label: 'Bowling', resource: 'bowling' },
            { key: 'laser', label: 'Laser Game', resource: 'laser' },
            { key: 'complete', label: 'Toutes', resource: 'all' }
          ]
        },
        { key: 'reservations', label: 'Réservations', icon: 'reservations' },
        { key: 'formules', label: 'Formules', icon: 'events' },
        {
          key: 'field',
          label: 'Terrain',
          icon: 'sessions',
          children: [
            { key: 'arrivals', label: 'Arrivées' },
            { key: 'sessions', label: 'En cours' },
            { key: 'events', label: 'Événements' }
          ]
        }
      ]
    },
    {
      title: 'Clients & marketing',
      items: [
        // badge = FONCTION : menuSections est une const évaluée une seule fois,
        // une valeur figée resterait bloquée sur le compte du premier rendu.
        { key: 'clients', label: 'Clients', icon: 'clients', badge: () => (typeof window.getStaffNewCustomRequestCount === 'function' ? (window.getStaffNewCustomRequestCount() || '') : '') },
        { key: 'emails', label: 'Emails & relances', icon: 'emails' },
        { key: 'campaigns', label: 'Marketing', icon: 'campaigns' }
      ]
    },
    {
      title: 'Administration',
      items: [
        {
          key: 'activities',
          label: 'Activités & tarifs',
          icon: 'prices',
          children: [
            { key: 'prices', label: 'Tarifs & formules' },
            { key: 'lanes', label: 'Pistes bowling' },
            { key: 'laserGame', label: 'Laser Game' }
          ]
        },
        { key: 'users', label: 'Équipe & accès', icon: 'users' },
        { key: 'establishment', label: 'Établissement', icon: 'establishment' }
      ]
    },
    {
      // Groupe PLATEFORME : visible uniquement pour les porteurs de
      // platform.admin (le filtrage par permission ci-dessous retire l'entrée
      // du DOM pour tous les autres ; le serveur reste l'autorité).
      title: 'Plateforme',
      items: [
        { key: 'cockpit-clients-platform', label: 'Clients Pinlane', icon: 'clients' },
        { key: 'cockpit', label: 'Cockpit', icon: 'dashboard' },
        { key: 'cockpit-centres', label: 'Centres', icon: 'establishment' },
        { key: 'cockpit-agents', label: 'Agents IA', icon: 'campaigns' },
        { key: 'cockpit-ia', label: 'Apprentissage IA', icon: 'campaigns' },
        { key: 'cockpit-incidents', label: 'Incidents', icon: 'sessions' },
        { key: 'cockpit-journal', label: 'Journal', icon: 'reservations' }
      ]
    }
  ];

  // --- Masquage des entrées non autorisées selon le rôle de la session --------
  // Une entrée que le rôle n'a pas le droit d'ouvrir est RETIRÉE du DOM (pas
  // affichée désactivée). Le serveur reste l'autorité : ce filtrage ne fait que
  // cacher côté UI ce qui est déjà refusé côté serveur.
  function menuKeyToPage(key) {
    if (key === 'bowling' || key === 'laser' || key === 'complete') return 'planning';
    if (key === 'field' || key === 'activities') return null; // conteneurs : gérés par leurs enfants
    return key;
  }

  function menuKeyVisible(key) {
    const page = menuKeyToPage(key);
    if (!page) return true;
    if (typeof canUseStaffPage === 'function') return canUseStaffPage(page);
    return true;
  }

  function filterMenuItem(item) {
    if (item.children) {
      const children = item.children.filter(child => menuKeyVisible(child.key));
      if (!children.length) return null;
      return Object.assign({}, item, { children });
    }
    return menuKeyVisible(item.key) ? item : null;
  }

  function visibleMenuSections() {
    return menuSections
      .map(section => {
        const items = section.items.map(filterMenuItem).filter(Boolean);
        return items.length ? Object.assign({}, section, { items }) : null;
      })
      .filter(Boolean);
  }

  // Implémentation officielle (app-main.js, globale, chargée avant ce script) ;
  // repli identique quand le module est chargé seul (tests vm).
  const escapeHtml = (typeof window !== 'undefined' && typeof window.escapeHtml === 'function')
    ? window.escapeHtml
    : function escapeHtml(value = '') {
      return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char]));
    };

  function prefersReducedMenuMotion() {
    try {
      return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (error) {
      return false;
    }
  }

  // --- Logo de marque changeable (device-local, voir BRAND_LOGO_KEY) ---------
  function readBrandLogo() {
    try {
      const stored = localStorage.getItem(BRAND_LOGO_KEY);
      // Seule une data-URI image est acceptee : tout autre contenu est ignore.
      if (typeof stored === 'string' && stored.startsWith('data:image/')) return stored;
    } catch (error) {}
    return null;
  }

  function hasCustomBrandLogo() {
    return readBrandLogo() !== null;
  }

  function getBrandLogoSrc() {
    return readBrandLogo() || PLATFORM_MARK_SRC;
  }

  function notifyMenu(message) {
    if (typeof toast === 'function') toast(message);
  }

  function storeBrandLogo(dataUri) {
    try {
      localStorage.setItem(BRAND_LOGO_KEY, dataUri);
    } catch (error) {
      notifyMenu('Impossible d\'enregistrer le logo (stockage local plein).');
      return;
    }
    renderMenu();
    notifyMenu('Logo mis à jour sur cet appareil.');
  }

  function resetBrandLogo() {
    try {
      localStorage.removeItem(BRAND_LOGO_KEY);
    } catch (error) {}
    renderMenu();
    notifyMenu('Logo Pinlane restauré.');
  }

  // Ouvre un selecteur de fichier image, valide type + poids (512 Ko max),
  // lit en data-URI et persiste en localStorage (device-local, choix MVP).
  function promptBrandLogo() {
    if (typeof document === 'undefined' || typeof FileReader === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (input.parentNode) input.parentNode.removeChild(input);
      if (!file) return;
      if (!/^image\//.test(file.type || '')) {
        notifyMenu('Fichier refusé : choisissez une image.');
        return;
      }
      if (file.size > MAX_BRAND_LOGO_BYTES) {
        notifyMenu('Image trop lourde : 512 Ko maximum.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUri = String(reader.result || '');
        if (!dataUri.startsWith('data:image/')) {
          notifyMenu('Lecture de l\'image impossible.');
          return;
        }
        storeBrandLogo(dataUri);
      };
      reader.onerror = () => notifyMenu('Lecture de l\'image impossible.');
      reader.readAsDataURL(file);
    }, { once: true });
    if (document.body) document.body.appendChild(input);
    input.click();
  }

  function getInitials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return 'PL';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  }

  function getMenuCenters() {
    try {
      if (typeof getAdminCenters === 'function') {
        const centers = getAdminCenters();
        if (Array.isArray(centers) && centers.length) {
          return centers.map(center => ({
            id: center.id || center.slug || 'libramont',
            // Repli NEUTRE : un centre sans nom affiche son id, jamais le nom
            // d'un autre client.
            name: center.name || center.label || center.id || 'Centre',
            label: center.shortName || center.label || center.name || center.id || 'Centre',
            meta: center.meta || center.summary || `${Number(center.resources?.bowling?.laneCount || center.bowlingLanes || 8)} pistes · ${Number(center.resources?.laser?.weaponCount || center.laserGuns || 30)} armes laser`,
            status: center.status === 'planned' ? 'Prévu' : (center.status === 'closed' ? 'Archivé' : 'Actif'),
            // clientId/clientName : sert au GROUPEMENT par client cote proprietaire.
            // Un client n'a qu'un seul clientId dans sa liste (deja scopee serveur),
            // donc son switcher reste une liste plate.
            clientId: center.clientId || null,
            clientName: center.clientName || null
          }));
        }
      }
    } catch (error) {
      console.warn('[staff-menu] centres fallback', error);
    }
    // Repli ultime : SEULEMENT le centre courant de la session, jamais la liste
    // codee en dur des centres Fun Galaxy (un autre tenant ne doit pas les voir
    // meme en flash avant la reponse scopee serveur).
    return FALLBACK_CENTERS.filter(center => center.id === getSelectedCenterId());
  }

  function getSelectedCenterId() {
    try {
      if (typeof state !== 'undefined' && state.adminCenterId) {
        return state.adminCenterId;
      }
    } catch (error) {
      return 'libramont';
    }
    return 'libramont';
  }

  function getSelectedCenter() {
    const centers = getMenuCenters();
    const selectedId = getSelectedCenterId();
    return centers.find(center => center.id === selectedId)
      || centers[0]
      || FALLBACK_CENTERS.find(center => center.id === selectedId)
      || { id: selectedId, name: 'Centre actuel', label: 'Centre actuel', status: 'Actif' };
  }

  function centerDisplayName(center = getSelectedCenter()) {
    return center?.name || center?.label || 'Centre actuel';
  }
  // Expose au reste de la console : c'est la SEULE source du nom lisible du
  // centre courant (le composeur email s'en sert pour la variable {{centre}}).
  window.staffCenterDisplayName = () => centerDisplayName();

  function getCurrentSession() {
    try {
      const current = typeof state !== 'undefined' ? state.staffAuthSession : null;
      if (typeof normalizeStaffSession === 'function') {
        return normalizeStaffSession(current) || null;
      }
      return current && typeof current === 'object' ? current : null;
    } catch (error) {
      return null;
    }
  }

  function getRoleLabel() {
    const session = getCurrentSession();
    if (session?.role?.locked) return PLATFORM_BRAND.accountRole;
    return session?.role?.name || PLATFORM_BRAND.accountRole;
  }

  function getAccessSummary() {
    const session = getCurrentSession();
    if (!session) return 'Session locale';
    if (session.role?.locked) return 'Accès complet';
    const count = Array.isArray(session.permissions) ? session.permissions.length : 0;
    return `${count} permission${count > 1 ? 's' : ''}`;
  }

  function getThemeSummary() {
    try {
      return typeof state !== 'undefined' && state.staffTheme === 'light'
        ? 'Mode clair actif'
        : 'Mode sombre actif';
    } catch (error) {
      return 'Basculer clair / sombre';
    }
  }

  function readCollapsed() {
    if (typeof state !== 'undefined') return !!state.staffMenuCollapsed;
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch (error) {
      return false;
    }
  }

  function persistCollapsed(collapsed) {
    if (typeof state !== 'undefined') {
      state.staffMenuCollapsed = !!collapsed;
      try {
        if (typeof save === 'function') save();
      } catch (error) {}
    }
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch (error) {}
  }

  function readMenuGroupState() {
    if (menuGroupOpenState) return menuGroupOpenState;
    try {
      const raw = localStorage.getItem(GROUPS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      menuGroupOpenState = { ...DEFAULT_OPEN_GROUPS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    } catch (error) {
      menuGroupOpenState = { ...DEFAULT_OPEN_GROUPS };
    }
    return menuGroupOpenState;
  }

  function persistMenuGroupState(next) {
    menuGroupOpenState = { ...DEFAULT_OPEN_GROUPS, ...(next || {}) };
    try {
      localStorage.setItem(GROUPS_KEY, JSON.stringify(menuGroupOpenState));
    } catch (error) {}
  }

  function isMenuGroupOpen(key) {
    return !!readMenuGroupState()[key];
  }

  function setMenuGroupOpen(key, open) {
    if (!key) return;
    persistMenuGroupState({ ...readMenuGroupState(), [key]: !!open });
  }

  function getMenuGroupDefaultTarget(key) {
    return GROUP_DEFAULT_TARGETS[key] || key;
  }

  function getMenuSubnavId(key) {
    return `fgx-menu-subnav-${String(key || 'group').replace(/[^a-z0-9_-]/gi, '-')}`;
  }

  function nextMenuFrame(callback) {
    const frame = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : fn => setTimeout(fn, 16);
    frame(callback);
  }

  function setSubnavMaxHeight(subnav, value) {
    if (!subnav) return;
    subnav.style.setProperty('max-height', value, 'important');
  }

  function measureMenuSubnavHeight(subnav) {
    if (!subnav) return 0;
    const previousMaxHeight = subnav.style.getPropertyValue('max-height');
    const previousPriority = subnav.style.getPropertyPriority('max-height');
    setSubnavMaxHeight(subnav, 'none');
    const height = Math.ceil(subnav.scrollHeight || 0);
    if (previousMaxHeight) {
      subnav.style.setProperty('max-height', previousMaxHeight, previousPriority || '');
    } else {
      subnav.style.removeProperty('max-height');
    }
    return height;
  }

  function getSubnavRenderedHeight(subnav) {
    if (!subnav) return 0;
    const rect = typeof subnav.getBoundingClientRect === 'function'
      ? subnav.getBoundingClientRect()
      : null;
    return Math.ceil(rect?.height || subnav.offsetHeight || subnav.scrollHeight || 0);
  }

  function applyMenuGroupOpen(button, open, options = {}) {
    if (!button) return;
    const group = button.closest('.fgx-menu-group');
    const subnav = group?.querySelector('.fgx-menu-subnav');
    const wasOpen = button.getAttribute('aria-expanded') === 'true';
    const animate = options.animate !== false;
    const startHeight = subnav && wasOpen ? getSubnavRenderedHeight(subnav) : 0;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    group?.classList.toggle('is-open', open);
    group?.classList.toggle('is-collapsed', !open);
    if (subnav) {
      if (!open && subnav.contains(document.activeElement)) button.focus();
      subnav.setAttribute('aria-hidden', open ? 'false' : 'true');
      subnav.dataset.state = open ? 'open' : 'closed';
      if (open) {
        if (animate && !wasOpen) setSubnavMaxHeight(subnav, '0px');
        nextMenuFrame(() => {
          setSubnavMaxHeight(subnav, `${measureMenuSubnavHeight(subnav)}px`);
        });
      } else {
        if (animate && wasOpen) {
          setSubnavMaxHeight(subnav, `${startHeight}px`);
          subnav.getBoundingClientRect();
        }
        nextMenuFrame(() => setSubnavMaxHeight(subnav, '0px'));
      }
      const canFocusSubitems = open && !readCollapsed();
      subnav.querySelectorAll('.fgx-menu-subitem').forEach(item => {
        item.tabIndex = canFocusSubitems ? 0 : -1;
      });
    }
  }

  function applyMenuCollapsed() {
    const collapsed = readCollapsed();
    document.body.classList.toggle('staff-menu-collapsed', collapsed);
    const root = document.querySelector('[data-staff-menu-root]');
    if (!root) return;
    root.classList.toggle('is-collapsed', collapsed);
    const button = root.querySelector('[data-fgx-menu-collapse]');
    if (button) {
      button.setAttribute('aria-label', collapsed ? 'Ouvrir le menu' : 'R\u00e9duire le menu');
      button.setAttribute('title', collapsed ? 'Ouvrir le menu' : 'R\u00e9duire le menu');
      button.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
    }
  }

  function toggleMenuCollapsed() {
    persistCollapsed(!readCollapsed());
    applyMenuCollapsed();
    syncStaffMenuState();
  }

  function sectionMarkup(section) {
    return `
      <section class="fgx-menu-section">
        <div class="fgx-menu-section-title">${escapeHtml(section.title)}</div>
        ${section.items.map(itemMarkup).join('')}
      </section>
    `;
  }

  function itemMarkup(item) {
    if (item.children) {
      const open = isMenuGroupOpen(item.key);
      const subnavId = getMenuSubnavId(item.key);
      const children = item.children.map(child => `
        <button type="button" class="fgx-menu-subitem" title="${escapeHtml(child.label)}" data-fgx-menu-key="${escapeHtml(child.key)}" tabindex="${open ? '0' : '-1'}"${child.resource ? ` data-ops-resource="${escapeHtml(child.resource)}"` : ''}>
          <span class="fgx-menu-subitem-mark" aria-hidden="true"></span>
          <span class="fgx-menu-label">${escapeHtml(child.label)}</span>
        </button>
      `).join('');
      return `
        <div class="fgx-menu-group ${open ? 'is-open' : 'is-collapsed'}" data-fgx-group="${escapeHtml(item.key)}">
          <button type="button" class="fgx-menu-item fgx-menu-item-parent" title="${escapeHtml(item.label)}" data-fgx-menu-toggle="${escapeHtml(item.key)}" aria-expanded="${open ? 'true' : 'false'}" aria-controls="${subnavId}">
            <span class="fgx-menu-icon">${icons[item.icon] || ''}</span>
            <span class="fgx-menu-label">${escapeHtml(item.label)}</span>
            <span class="fgx-menu-chevron" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M6 4l4 4-4 4"/></svg></span>
          </button>
          <div id="${subnavId}" class="fgx-menu-subnav" aria-hidden="${open ? 'false' : 'true'}" data-state="${open ? 'open' : 'closed'}">${children}</div>
        </div>
      `;
    }

    const badge = typeof item.badge === 'function' ? item.badge() : (item.badge || '');
    const badgeCount = Number(badge) || 0;
    // Le titre porte le chiffre : le badge visuel est masqué menu replié et sous
    // 1100 px, le title reste lisible au survol et pour un lecteur d'écran.
    const itemTitle = badgeCount
      ? `${item.label}, ${badgeCount} nouvelle${badgeCount > 1 ? 's' : ''} demande${badgeCount > 1 ? 's' : ''}`
      : item.label;
    return `
      <button type="button" class="fgx-menu-item" title="${escapeHtml(itemTitle)}" data-fgx-menu-key="${escapeHtml(item.key)}">
        <span class="fgx-menu-icon">${icons[item.icon] || ''}${badge ? '<span class="fgx-menu-dot" aria-hidden="true"></span>' : ''}</span>
        <span class="fgx-menu-label">${escapeHtml(item.label)}</span>
        ${badge ? `<span class="fgx-menu-badge">${escapeHtml(String(badge))}</span>` : ''}
      </button>
    `;
  }

  function closeMenuPopover(options = {}) {
    const root = document.querySelector('[data-staff-menu-root]');
    if (!root) return;
    // Sortie animee (fade + retombee vers l'ancre) puis retrait du DOM.
    // prefers-reduced-motion ou options.immediate : retrait immediat.
    const immediate = options.immediate === true || prefersReducedMenuMotion();
    root.querySelectorAll('.fgx-menu-popover').forEach(popover => {
      if (immediate) {
        popover.remove();
        return;
      }
      if (popover.dataset.closing === '1') return;
      popover.dataset.closing = '1';
      popover.classList.add('is-closing');
      popover.setAttribute('aria-hidden', 'true');
      setTimeout(() => {
        if (popover.isConnected) popover.remove();
      }, POPOVER_EXIT_MS);
    });
    root.querySelectorAll('[data-fgx-center-menu][aria-expanded="true"], [data-fgx-account-menu][aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  }

  function positionPopover(popover, anchor, kind) {
    if (!popover || !anchor) return;
    if (kind === 'account') {
      popover.style.top = 'auto';
      popover.style.bottom = '76px';
      return;
    }
    const root = document.querySelector('[data-staff-menu-root]');
    const maxTop = Math.max(12, (root?.clientHeight || window.innerHeight) - 360);
    const top = Math.min(maxTop, Math.max(12, anchor.offsetTop + anchor.offsetHeight + 8));
    popover.style.top = `${top}px`;
    popover.style.bottom = 'auto';
  }

  function openMenuPopover(kind, anchor, html) {
    const root = document.querySelector('[data-staff-menu-root]');
    if (!root || !anchor) return;
    // Un popover deja en cours de fermeture ne compte pas comme "ouvert" :
    // sans ce filtre, rouvrir pendant la sortie animee serait refuse.
    const alreadyOpen = root.querySelector(`.fgx-menu-popover[data-popover-kind="${kind}"]:not(.is-closing)`);
    closeMenuPopover();
    if (alreadyOpen) return;
    // Jamais deux popovers superposes : ceux en sortie sont retires tout de
    // suite quand un nouveau s'ouvre (l'animation de sortie ne joue que quand
    // rien ne la remplace).
    root.querySelectorAll('.fgx-menu-popover').forEach(popover => popover.remove());
    const popover = document.createElement('div');
    popover.className = `fgx-menu-popover ${kind}`;
    popover.dataset.popoverKind = kind;
    popover.setAttribute('role', 'menu');
    popover.innerHTML = html;
    root.appendChild(popover);
    anchor.setAttribute('aria-expanded', 'true');
    positionPopover(popover, anchor, kind);
  }

  // Groupe les centres par client. Pour un CLIENT, la liste (deja scopee
  // serveur) ne couvre qu'un client -> un seul groupe -> liste plate. Pour le
  // PROPRIETAIRE, plusieurs clients -> groupes avec en-tete client. Orphelins
  // (sans client) en fin.
  function groupMenuCentersByClient(centers) {
    const groups = new Map();
    centers.forEach(center => {
      const key = center.clientId || '';
      if (!groups.has(key)) groups.set(key, { clientName: center.clientName || null, centers: [] });
      groups.get(key).centers.push(center);
    });
    return [...groups.values()].sort((a, b) => {
      if (!a.clientName && b.clientName) return 1;
      if (a.clientName && !b.clientName) return -1;
      return String(a.clientName || '').localeCompare(String(b.clientName || ''), 'fr');
    });
  }

  function centerOptionMarkup(center, selectedId) {
    const isActive = center.id === selectedId;
    return `
        <button type="button" class="fgx-menu-option fgx-center-option${isActive ? ' is-active' : ''}" data-fgx-center-option="${escapeHtml(center.id)}" role="menuitem">
          <span>
            <strong>${escapeHtml(centerDisplayName(center))}</strong>
            <small>${escapeHtml(center.meta || '')}</small>
          </span>
          <em>${escapeHtml(center.status || 'Actif')}</em>
        </button>
      `;
  }

  function toggleCenterMenu(anchor) {
    const selectedId = getSelectedCenterId();
    // Sans la permission centers.switch, le rôle ne voit que son centre courant
    // (aucun autre centre à sélectionner) : on n'affiche pas d'action interdite.
    const canSwitch = typeof canUseStaffPermission !== 'function' || canUseStaffPermission('centers.switch');
    const canDirection = typeof canUseStaffPermission !== 'function' || canUseStaffPermission('direction.view');
    const centers = canSwitch ? getMenuCenters() : getMenuCenters().filter(center => center.id === selectedId);
    const groups = groupMenuCentersByClient(centers);
    // Groupement par client seulement quand la liste couvre PLUSIEURS clients
    // (vue proprietaire). Un client garde une liste plate.
    const options = groups.length > 1
      ? groups.map(group => `
        <div class="fgx-center-group-head" role="presentation">${escapeHtml(group.clientName || 'Sans client')}</div>
        ${group.centers.map(center => centerOptionMarkup(center, selectedId)).join('')}
      `).join('')
      : centers.map(center => centerOptionMarkup(center, selectedId)).join('');
    openMenuPopover('center', anchor, `
      <div class="fgx-menu-popover-title">${canSwitch ? 'Changer de centre' : 'Centre'}</div>
      <div class="fgx-menu-options">${options}</div>
      ${canDirection ? `<button type="button" class="fgx-menu-option fgx-center-option muted" data-fgx-menu-action="direction" role="menuitem">
        <span>
          <strong>Direction multi-centres</strong>
          <small>Comparer les centres et exports</small>
        </span>
      </button>` : ''}
    `);
  }

  function toggleAccountMenu(anchor) {
    const center = getSelectedCenter();
    const displayName = centerDisplayName(center);
    const roleLabel = getRoleLabel();
    const accessSummary = getAccessSummary();
    const themeSummary = getThemeSummary();
    const canOpen = key => (typeof canUseStaffPage === 'function' ? canUseStaffPage(key) : true);
    const isLight = document.body.classList.contains('staff-light');
    // Le sous-titre de la carte evite la redondance role/acces (souvent egaux
    // pour un role verrouille).
    const cardMeta = accessSummary && accessSummary !== roleLabel
      ? `${roleLabel} · ${accessSummary}`
      : roleLabel;
    openMenuPopover('account', anchor, `
      <div class="fgx-account-card" role="presentation">
        <span class="fgx-account-card-avatar" aria-hidden="true">${escapeHtml(getInitials(displayName))}</span>
        <span class="fgx-account-card-copy">
          <strong>${escapeHtml(displayName)}</strong>
          <small>${escapeHtml(cardMeta)}</small>
        </span>
      </div>
      ${canOpen('users') ? `<button type="button" class="fgx-menu-option compact" data-fgx-menu-action="users" role="menuitem" title="Codes, rôles et permissions">
        <span class="fgx-menu-option-icon">${icons.users}</span>
        <span><strong>Équipe & accès</strong></span>
      </button>` : ''}
      ${canOpen('establishment') ? `<button type="button" class="fgx-menu-option compact" data-fgx-menu-action="establishment" role="menuitem" title="Centre, horaires et capacité">
        <span class="fgx-menu-option-icon">${icons.establishment}</span>
        <span><strong>Établissement</strong></span>
      </button>` : ''}
      ${canOpen('settings') ? `<button type="button" class="fgx-menu-option compact" data-fgx-menu-action="settings" role="menuitem" title="Poste staff et exports">
        <span class="fgx-menu-option-icon">${icons.settings}</span>
        <span><strong>Pr&eacute;f&eacute;rences</strong></span>
      </button>` : ''}
      <button type="button" class="fgx-menu-option compact" data-fgx-menu-action="logo" role="menuitem" title="Image, 512 Ko max · propre à cet appareil">
        <span class="fgx-menu-option-icon">${icons.image}</span>
        <span><strong>Changer le logo</strong></span>
      </button>
      ${hasCustomBrandLogo() ? `<button type="button" class="fgx-menu-option compact" data-fgx-menu-action="logo-reset" role="menuitem" title="Revenir à la marque Pinlane">
        <span class="fgx-menu-option-icon">${icons.reset}</span>
        <span><strong>Réinitialiser le logo</strong></span>
      </button>` : ''}
      <div class="fgx-menu-divider" role="presentation"></div>
      <div class="fgx-menu-theme-row" role="presentation" title="${escapeHtml(themeSummary)}">
        <span class="fgx-menu-theme-label">Thème</span>
        <span class="fgx-menu-theme-seg" role="group" aria-label="Choisir le thème">
          <button type="button" class="fgx-menu-theme-btn${isLight ? ' is-active' : ''}" data-fgx-menu-action="theme" data-fgx-theme-value="light" role="menuitemradio" aria-checked="${isLight ? 'true' : 'false'}">${icons.sun}<span>Clair</span></button>
          <button type="button" class="fgx-menu-theme-btn${isLight ? '' : ' is-active'}" data-fgx-menu-action="theme" data-fgx-theme-value="dark" role="menuitemradio" aria-checked="${isLight ? 'false' : 'true'}">${icons.moon}<span>Sombre</span></button>
        </span>
      </div>
      <div class="fgx-menu-divider" role="presentation"></div>
      <button type="button" class="fgx-menu-option compact" data-fgx-menu-action="client" role="menuitem" title="Site de r&eacute;servation public">
        <span class="fgx-menu-option-icon">${icons.store}</span>
        <span><strong>Espace client</strong></span>
      </button>
      <button type="button" class="fgx-menu-option compact danger" data-fgx-menu-action="logout" role="menuitem" title="Fermer la session staff">
        <span class="fgx-menu-option-icon">${icons.logout}</span>
        <span><strong>D&eacute;connexion</strong></span>
      </button>
    `);
  }

  function selectMenuCenter(centerId) {
    const center = getMenuCenters().find(item => item.id === centerId);
    if (!center) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('centers.switch')) {
      if (typeof toast === 'function') toast('Changement de centre réservé à la direction.');
      closeMenuPopover();
      return;
    }
    const previousId = getSelectedCenterId();
    closeMenuPopover();
    if (centerId === previousId) return;
    try {
      if (typeof state !== 'undefined') {
        state.adminCenterId = centerId;
        // La page Etablissement suit le centre actif du switcher.
        state.establishmentCenterId = centerId;
        // Force la re-lecture des droits/config pour le nouveau centre.
        state.staffAccessControl = null;
      }
      if (typeof save === 'function') {
        save();
      }
    } catch (error) {
      console.warn('[staff-menu] center save failed', error);
    }
    // On RESTE dans la vue courante : changer de centre ne doit pas ejecter
    // l'utilisateur vers la Direction (ancien bug : tout centre != libramont
    // forcait setView('admin')). On rafraichit seulement les donnees du centre.
    const applyActiveView = () => {
      // Re-affirme le centre CIBLE apres le re-auth : storeStaffAuthSession
      // (app-main) reecrit state.adminCenterId avec le centre de la session
      // renvoyee par le serveur, ce qui annulait le changement en vue staff
      // (la vue admin, elle, etait deja re-imposee par setAdminCenter). Le choix
      // explicite de l'utilisateur doit gagner.
      if (typeof state !== 'undefined') {
        state.adminCenterId = centerId;
        state.establishmentCenterId = centerId;
      }
      if (typeof state !== 'undefined' && state.view === 'admin') {
        if (typeof setAdminCenter === 'function') setAdminCenter(centerId);
        else if (typeof openAdminCenter === 'function') openAdminCenter(centerId);
      } else {
        if (typeof loadStaffCenterConfig === 'function') loadStaffCenterConfig(true);
        // Le poll staff-state est scope par centerId : sans refetch force, la vue
        // garde les reservations de l'ancien centre. On recharge la date courante
        // pour le nouveau centre (revisionKey inclut centerId -> jamais un 304).
        if (typeof syncDateReservations === 'function' && typeof state !== 'undefined' && state.currentDate) {
          syncDateReservations(state.currentDate, { silent: true });
        }
        if (typeof renderStaff === 'function' && typeof state !== 'undefined' && state.view === 'staff') renderStaff();
      }
      renderMenu();
    };
    if (typeof loadStaffAuthSession === 'function') {
      loadStaffAuthSession({ silent: true }).then(applyActiveView).catch(applyActiveView);
    } else {
      applyActiveView();
    }
    renderMenu();
  }

  function handleMenuAction(action, trigger) {
    if (action === 'theme') {
      // Toggle segmente : un segment porte data-fgx-theme-value (choix
      // explicite), sinon on bascule. Le popover RESTE ouvert : les segments
      // sont synchronises en place pour un vrai comportement de switch.
      const requested = trigger && trigger.dataset ? trigger.dataset.fgxThemeValue : '';
      const nextTheme = requested === 'light' || requested === 'dark'
        ? requested
        : (document.body.classList.contains('staff-light') ? 'dark' : 'light');
      if (typeof setStaffTheme === 'function') {
        setStaffTheme(nextTheme);
      } else {
        document.body.classList.toggle('staff-light', nextTheme === 'light');
      }
      document.querySelectorAll('.fgx-menu-popover[data-popover-kind="account"] [data-fgx-theme-value]').forEach(button => {
        const active = button.dataset.fgxThemeValue === nextTheme;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-checked', active ? 'true' : 'false');
      });
      return;
    }
    if (action === 'logo') {
      closeMenuPopover();
      promptBrandLogo();
      return;
    }
    if (action === 'logo-reset') {
      closeMenuPopover();
      resetBrandLogo();
      return;
    }
    closeMenuPopover();
    if (action === 'center') {
      const anchor = document.querySelector('[data-fgx-center-menu]');
      if (anchor) toggleCenterMenu(anchor);
      return;
    }
    if (action === 'direction') {
      if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('direction.view')) {
        if (typeof toast === 'function') toast('Accès direction non autorisé pour ce rôle.');
        return;
      }
      if (typeof setView === 'function') setView('admin');
      return;
    }
    if (action === 'client') {
      if (typeof setView === 'function') setView('client');
      return;
    }
    if (action === 'users' || action === 'settings' || action === 'establishment') {
      navigateMenu(action);
      return;
    }
    if (action === 'logout') {
      if (typeof logout === 'function') logout();
    }
  }

  function renderMenu() {
    const root = document.querySelector('[data-staff-menu-root]');
    if (!root) return;
    const center = getSelectedCenter();
    const displayName = centerDisplayName(center);
    const roleLabel = getRoleLabel();
    root.innerHTML = `
      <div class="fgx-menu-top">
        <button type="button" class="fgx-menu-brand${hasCustomBrandLogo() ? ' est-perso' : ''}" data-fgx-menu-key="dashboard" title="Tableau de bord Pinlane">
          <span class="fgx-menu-logo-frame${hasCustomBrandLogo() ? ' is-custom' : ''}">
            <img class="fgx-menu-logo" src="${escapeHtml(getBrandLogoSrc())}" alt="" aria-hidden="true">
          </span>
          <img class="fgx-menu-lockup" src="${escapeHtml(PLATFORM_LOCKUP_SRC)}" alt="${escapeHtml(PLATFORM_BRAND.name)}, console du centre" width="143" height="32">
          <span class="fgx-menu-brand-copy">
            <strong>${escapeHtml(PLATFORM_BRAND.name)}</strong>
          </span>
        </button>
        <button type="button" class="fgx-menu-collapse" data-fgx-menu-collapse aria-label="R\u00e9duire le menu" title="R\u00e9duire le menu">${icons.panel}</button>
      </div>

      <button type="button" class="fgx-menu-center" data-fgx-center-menu aria-haspopup="menu" aria-expanded="false" title="Changer de centre">
        <span class="fgx-center-dot">${icons.center}</span>
        <span class="fgx-menu-label">${escapeHtml(displayName)}</span>
        <span class="fgx-menu-chevron" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M6 4l4 4-4 4"/></svg></span>
      </button>

      <nav class="fgx-menu-nav" aria-label="Navigation op\u00e9rationnelle">
        ${visibleMenuSections().map(sectionMarkup).join('')}
      </nav>

      <button type="button" class="fgx-menu-account" data-fgx-account-menu aria-haspopup="menu" aria-expanded="false" title="Options du compte">
        <span class="fgx-menu-avatar">${escapeHtml(getInitials(displayName))}<span class="fgx-menu-avatar-dot" aria-hidden="true"></span></span>
        <span class="fgx-menu-account-copy">
          <strong>${escapeHtml(displayName)}</strong>
          <small>${escapeHtml(roleLabel)}</small>
        </span>
        <span class="fgx-menu-more" aria-hidden="true">${icons.kebab}</span>
      </button>
    `;

    if (!root.dataset.fgxMenuBound) {
      root.addEventListener('click', handleMenuClick);
      root.addEventListener('keydown', event => {
        const interactive = event.target.closest('[data-fgx-menu-key], [data-fgx-menu-toggle], [data-fgx-menu-collapse], [data-fgx-center-menu], [data-fgx-account-menu], [data-fgx-center-option], [data-fgx-menu-action]');
        if ((event.key === 'Enter' || event.key === ' ') && interactive) {
          event.preventDefault();
          handleMenuClick(event);
        }
      });
      root.dataset.fgxMenuBound = '1';
    }
    if (!menuDocumentEventsBound) {
      menuDocumentEventsBound = true;
      document.addEventListener('click', event => {
        const menuRoot = document.querySelector('[data-staff-menu-root]');
        if (!menuRoot || menuRoot.contains(event.target)) return;
        closeMenuPopover();
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeMenuPopover();
      });
    }

    applyMenuCollapsed();
    syncStaffMenuState();
  }

  function setMenuPage(key) {
    if (typeof state !== 'undefined') state.staffMenuPage = key;
    try {
      if (typeof setStaffRouteHash === 'function') setStaffRouteHash(key);
    } catch (error) {}
    try {
      if (typeof save === 'function') save();
    } catch (error) {}
  }

  function handleMenuClick(event) {
    const collapse = event.target.closest('[data-fgx-menu-collapse]');
    if (collapse) {
      event.preventDefault();
      event.stopPropagation();
      toggleMenuCollapsed();
      return;
    }

    const centerMenu = event.target.closest('[data-fgx-center-menu]');
    if (centerMenu) {
      event.preventDefault();
      toggleCenterMenu(centerMenu);
      return;
    }

    const accountMenu = event.target.closest('[data-fgx-account-menu]');
    if (accountMenu) {
      event.preventDefault();
      toggleAccountMenu(accountMenu);
      return;
    }

    const centerOption = event.target.closest('[data-fgx-center-option]');
    if (centerOption) {
      event.preventDefault();
      event.stopPropagation();
      selectMenuCenter(centerOption.dataset.fgxCenterOption);
      return;
    }

    const menuAction = event.target.closest('[data-fgx-menu-action]');
    if (menuAction) {
      event.preventDefault();
      event.stopPropagation();
      handleMenuAction(menuAction.dataset.fgxMenuAction, menuAction);
      return;
    }

    const groupToggle = event.target.closest('[data-fgx-menu-toggle]');
    if (groupToggle) {
      event.preventDefault();
      event.stopPropagation();
      closeMenuPopover();
      const key = groupToggle.dataset.fgxMenuToggle;
      if (readCollapsed()) {
        navigateMenuGroup(key);
        return;
      }
      const nextOpen = groupToggle.getAttribute('aria-expanded') !== 'true';
      setMenuGroupOpen(key, nextOpen);
      applyMenuGroupOpen(groupToggle, nextOpen, { animate: true });
      return;
    }

    const target = event.target.closest('[data-fgx-menu-key]');
    if (!target) return;
    event.stopPropagation();
    closeMenuPopover();
    const key = target.dataset.fgxMenuKey;
    const resource = target.dataset.opsResource;
    if (resource) {
      setMenuGroupOpen('planning', true);
      if (typeof canUseStaffPage === 'function' && !canUseStaffPage('planning')) {
        if (typeof toast === 'function') toast('Accès planning non autorisé.');
        return;
      }
      setMenuPage('planning');
      if (typeof setView === 'function') setView('staff');
      if (typeof setStaffResourceView === 'function') setStaffResourceView(resource);
      else if (typeof setStaffRouteHash === 'function') setStaffRouteHash('planning', resource);
      syncStaffMenuState();
      return;
    }
    navigateMenu(key);
  }

  function navigateMenuGroup(key) {
    if (!key) return;
    setMenuGroupOpen(key, true);
    navigateMenu(getMenuGroupDefaultTarget(key));
    syncStaffMenuState();
  }

  function navigateMenu(key) {
    if (key === 'field') {
      navigateMenu('arrivals');
      return;
    }
    if (key === 'activities') {
      navigateMenu('prices');
      return;
    }
    const permissionKey = key === 'bowling' || key === 'laser' || key === 'complete' ? 'planning' : key;
    if (typeof canUseStaffPage === 'function' && !canUseStaffPage(permissionKey)) {
      if (typeof toast === 'function') toast('Accès non autorisé pour ce rôle.');
      syncStaffMenuState();
      return;
    }
    if (['arrivals', 'sessions', 'events'].includes(key)) setMenuGroupOpen('field', true);
    if (['prices', 'lanes', 'laserGame'].includes(key)) setMenuGroupOpen('activities', true);
    setMenuPage(key);
    if (key === 'dashboard') {
      if (typeof setView === 'function') setView('staff');
      return;
    }
    if (key === 'planning') {
      setMenuGroupOpen('planning', true);
      if (typeof setView === 'function') setView('staff');
      if (typeof setStaffResourceView === 'function') {
        const current = typeof state !== 'undefined' ? state.staffResourceView || 'bowling' : 'bowling';
        setStaffResourceView(current);
      }
      return;
    }
    if (key === 'reservations') {
      if (typeof setView === 'function') setView('staff');
      if (typeof setStaffStatusFilter === 'function') setStaffStatusFilter('all');
      if (typeof renderStaff === 'function') renderStaff();
      return;
    }
    if (key === 'formules') {
      setMenuPage('formules');
      if (typeof setView === 'function') setView('staff');
      if (typeof renderStaff === 'function') renderStaff();
      return;
    }
    if (key === 'sessions') {
      setMenuPage('sessions');
      if (typeof setView === 'function') setView('staff');
      if (typeof state !== 'undefined') state.staffStatusFilter = 'open';
      if (typeof renderStaff === 'function') renderStaff();
      return;
    }
    if (key === 'arrivals') {
      setMenuPage('arrivals');
      if (typeof setView === 'function') setView('staff');
      if (typeof state !== 'undefined') state.staffStatusFilter = 'arrived';
      if (typeof renderStaff === 'function') renderStaff();
      return;
    }
    if (key === 'events') {
      setMenuPage('events');
      if (typeof state !== 'undefined') {
        state.staffReservationActivityFilter = 'event';
        state.staffReservationsSelectedDate = state.currentDate || state.staffReservationsSelectedDate;
      }
      if (typeof setView === 'function') setView('staff');
      if (typeof renderStaff === 'function') renderStaff();
      return;
    }
    if (key === 'clients') {
      if (typeof state !== 'undefined') {
        state.staffClientSegment = 'all';
      }
      if (typeof setView === 'function') setView('staff');
      if (typeof renderStaff === 'function') renderStaff();
      return;
    }
    if (key === 'groups' || key === 'contacts') {
      setMenuPage(key);
      if (typeof state !== 'undefined') {
        state.staffClientSegment = key === 'groups' ? 'groups' : 'all';
      }
      if (typeof setView === 'function') setView('staff');
      if (typeof renderStaff === 'function') renderStaff();
      return;
    }
    if (key === 'emails') {
      setMenuPage('emails');
      if (typeof setView === 'function') setView('staff');
      if (typeof renderStaff === 'function') renderStaff();
      if (typeof requestOpsAdminLoad === 'function') requestOpsAdminLoad(false);
      else if (typeof loadOpsAdmin === 'function') loadOpsAdmin(false);
      return;
    }
    if (key === 'campaigns') {
      setMenuPage('campaigns');
      if (typeof setView === 'function') setView('staff');
      if (typeof renderStaff === 'function') renderStaff();
      return;
    }
    if (key === 'laserGame') {
      setMenuPage('laserGame');
      if (typeof setView === 'function') setView('staff');
      if (typeof state !== 'undefined') state.staffResourceView = 'laser';
      if (typeof renderStaff === 'function') renderStaff();
      return;
    }
    if (key === 'prices') {
      setMenuPage('prices');
      if (typeof setView === 'function') setView('staff');
      if (typeof renderStaff === 'function') renderStaff();
      return;
    }
    if (key === 'establishment') {
      setMenuPage('establishment');
      if (typeof setView === 'function') setView('staff');
      if (typeof renderStaff === 'function') renderStaff();
      return;
    }
    if (key === 'lanes') {
      setMenuPage('lanes');
      if (typeof setView === 'function') setView('staff');
      if (typeof state !== 'undefined') state.staffResourceView = 'bowling';
      if (typeof renderStaff === 'function') renderStaff();
      return;
    }
    if (key === 'users' || key === 'settings') {
      setMenuPage(key);
      if (typeof setView === 'function') setView('staff');
      if (typeof renderStaff === 'function') renderStaff();
      return;
    }
    // Categorie PLATEFORME (cockpit fondateur + ses 3 pages) : ce sont des pages
    // de la vue STAFF (renderStaffFounderCockpitPage). Sans ce cas, elles
    // tombaient dans le fallback ci-dessous et ouvraient la Direction (vue
    // admin) : le menu surlignait Cockpit mais l'ecran montrait le poste
    // d'observation. La vue Direction ne s'atteint QUE par le menu compte
    // (action "direction"), jamais par une entree de la barre laterale.
    if (['cockpit', 'cockpit-clients-platform', 'cockpit-centres', 'cockpit-agents', 'cockpit-incidents', 'cockpit-clients', 'cockpit-journal', 'cockpit-ia'].includes(key)) {
      setMenuPage(key);
      if (typeof setView === 'function') setView('staff');
      if (typeof renderStaff === 'function') renderStaff();
      return;
    }
    // Fallback DEFENSIF : une entree de menu non reconnue reste dans la vue
    // staff. Aucune cle legitime de la barre laterale n'ouvre la vue admin
    // (c'est le role du menu compte) : basculer en admin sur une cle inconnue
    // etait le piege qui cassait la categorie Plateforme.
    setMenuPage(key);
    if (typeof setView === 'function') setView('staff');
    if (typeof renderStaff === 'function') renderStaff();
  }

  function syncStaffMenuState() {
    const root = document.querySelector('[data-staff-menu-root]');
    if (!root) return;
    applyMenuCollapsed();

    const view = typeof state !== 'undefined' ? state.view : 'client';
    const resource = typeof getStaffResourceView === 'function'
      ? getStaffResourceView()
      : (typeof state !== 'undefined' ? state.staffResourceView || 'bowling' : 'bowling');
    const page = typeof state !== 'undefined' ? state.staffMenuPage || 'planning' : 'planning';

    const dashboardActive = view === 'staff' && page === 'dashboard';
    const planningActive = view === 'staff' && page === 'planning' && ['all', 'bowling', 'laser'].includes(resource);
    const fieldActive = view === 'staff' && ['arrivals', 'sessions', 'events'].includes(page);
    const activitiesActive = view === 'staff' && ['prices', 'lanes', 'laserGame'].includes(page);
    const directStaffPages = [
      'reservations',
      'sessions',
      'arrivals',
      'events',
      'clients',
      'groups',
      'contacts',
      'lanes',
      'prices',
      'laserGame',
      'emails',
      'campaigns',
      'establishment',
      'users',
      'settings'
    ];
    const directStaffPageActive = view === 'staff' && directStaffPages.includes(page);

    root.querySelectorAll('[data-fgx-menu-key]').forEach(item => item.classList.remove('active'));
    root.querySelectorAll('[data-fgx-menu-toggle]').forEach(item => item.classList.remove('active'));
    root.querySelectorAll('[data-ops-resource]').forEach(item => {
      item.classList.toggle('active', planningActive && item.dataset.opsResource === resource);
    });

    // Scope .fgx-menu-nav : la marque porte aussi data-fgx-menu-key="dashboard"
    // et interceptait la classe active a la place de l'item de nav.
    root.querySelector('.fgx-menu-nav [data-fgx-menu-key="dashboard"]')?.classList.toggle('active', dashboardActive);
    root.querySelector('[data-fgx-menu-toggle="planning"]')?.classList.toggle('active', planningActive);
    root.querySelector('[data-fgx-menu-toggle="field"]')?.classList.toggle('active', fieldActive);
    root.querySelector('[data-fgx-menu-toggle="activities"]')?.classList.toggle('active', activitiesActive);
    root.querySelector('[data-fgx-group="planning"]')?.classList.toggle('active', planningActive);
    root.querySelector('[data-fgx-group="field"]')?.classList.toggle('active', fieldActive);
    root.querySelector('[data-fgx-group="activities"]')?.classList.toggle('active', activitiesActive);
    root.querySelectorAll('[data-fgx-menu-toggle]').forEach(button => {
      applyMenuGroupOpen(button, isMenuGroupOpen(button.dataset.fgxMenuToggle), { animate: false });
    });

    if (directStaffPageActive) {
      root.querySelector(`.fgx-menu-nav [data-fgx-menu-key="${page}"]`)?.classList.add('active');
    }
    if (view === 'admin') {
      const adminKey = page && root.querySelector(`.fgx-menu-nav [data-fgx-menu-key="${page}"]`) ? page : 'dashboard';
      root.querySelector(`.fgx-menu-nav [data-fgx-menu-key="${adminKey}"]`)?.classList.add('active');
    }
  }

  window.syncStaffMenuState = syncStaffMenuState;
  window.renderStaffMenu = renderMenu;
  window.FGX_STAFF_MENU = menuSections;
  // Exposé pour diagnostics/tests : sections filtrées selon les permissions de
  // la session (entrées interdites retirées, pas seulement désactivées).
  window.FGX_STAFF_VISIBLE_SECTIONS = visibleMenuSections;
  window.FGX_STAFF_MENU_GROUP_TARGETS = GROUP_DEFAULT_TARGETS;
  window.toggleStaffMenuCollapsed = toggleMenuCollapsed;
  window.setStaffMenuCollapsed = collapsed => {
    persistCollapsed(!!collapsed);
    applyMenuCollapsed();
    syncStaffMenuState();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderMenu, { once: true });
  } else {
    renderMenu();
  }
})();
