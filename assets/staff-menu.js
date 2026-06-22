(function () {
  const PLATFORM_MARK_SRC = './assets/brand/pinlane-source.png';
  const COLLAPSE_KEY = 'fgx:staff-menu-collapsed';
  const PLATFORM_BRAND = {
    name: 'Pinlane',
    subtitle: 'Venue Operating System',
    accountRole: 'Propriétaire plateforme'
  };
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

  const icons = {
    dashboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/></svg>',
    planning: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
    reservations: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v5h5M10 13h6M10 17h4"/></svg>',
    sessions: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>',
    arrivals: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/><path d="m15 8 4 4-4 4"/></svg>',
    events: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="15" rx="2"/><path d="M8 3v4M16 3v4M8 11h8M8 15h5"/></svg>',
    clients: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.7-3.5 2.8-5.4 5.5-5.4s4.8 1.9 5.5 5.4"/><path d="M16 10a2.5 2.5 0 1 0 0-5M17 14c1.8.4 3 2 3.5 5"/></svg>',
    groups: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3.5 19c.5-3.2 2.2-5 4.5-5s4 1.8 4.5 5M11.5 19c.5-3.2 2.2-5 4.5-5s4 1.8 4.5 5"/></svg>',
    contacts: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10M7 12h6M7 17h4"/><rect x="4" y="4" width="16" height="16" rx="2"/></svg>',
    lanes: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v5H5zM5 15h14v5H5z"/><path d="M7 9v6M17 9v6"/></svg>',
    prices: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5h16v3M6 8h12v11H6z"/><path d="M9 12h6M9 15h4"/></svg>',
    laser: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/><path d="M4.5 19.5 7 17M17 7l2.5-2.5"/></svg>',
    offers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11V5h6l10 10-6 6z"/><circle cx="8" cy="9" r="1.4"/></svg>',
    emails: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="2"/><path d="m5 8 7 5 7-5"/></svg>',
    campaigns: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 14h3l8 4V6l-8 4H5z"/><path d="M8 14v5M18 10l3-2M18 14l3 2"/></svg>',
    establishment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M6 20V8l6-4 6 4v12"/><path d="M10 20v-6h4v6M8 10h2M14 10h2"/></svg>',
    users: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3.4 2.7-5.2 5.5-5.2s4.9 1.8 5.5 5.2"/><path d="M16 11h4M18 9v4"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.9-1.1L14.3 3h-4.6l-.3 2.9A7 7 0 0 0 7.5 7L5.1 6 3.1 9.4l2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.1l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.9 1.1l.3 2.9h4.6l.3-2.9a7 7 0 0 0 1.9-1.1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1.1Z"/></svg>',
    center: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 7v10l8 4 8-4V7z"/><path d="M12 21V11M4 7l8 4 8-4"/></svg>'
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
            { key: 'complete', label: 'Complet', resource: 'all' }
          ]
        },
        { key: 'reservations', label: 'Réservations', icon: 'reservations' },
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
        { key: 'clients', label: 'Clients', icon: 'clients' },
        { key: 'groups', label: 'Groupes & anniversaires', icon: 'groups' },
        { key: 'emails', label: 'Emails & relances', icon: 'emails' },
        { key: 'campaigns', label: 'Campagnes', icon: 'campaigns' }
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
            { key: 'laserGame', label: 'Laser Game' },
            { key: 'offers', label: 'Offres & cartes' }
          ]
        },
        { key: 'users', label: 'Équipe & accès', icon: 'users' },
        { key: 'establishment', label: 'Établissement', icon: 'establishment' }
      ]
    }
  ];

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getMenuCenters() {
    try {
      if (typeof getAdminCenters === 'function') {
        const centers = getAdminCenters();
        if (Array.isArray(centers) && centers.length) {
          return centers.map(center => ({
            id: center.id || center.slug || 'libramont',
            name: center.name || center.label || 'Fun Galaxy Centre',
            label: center.shortName || center.label || center.name || 'Fun Galaxy Centre',
            meta: center.meta || center.summary || `${center.bowlingLanes || 8} pistes · ${center.laserGuns || 30} armes laser`,
            status: center.status === 'planned' ? 'Prévu' : 'Actif'
          }));
        }
      }
    } catch (error) {
      console.warn('[staff-menu] centres fallback', error);
    }
    return FALLBACK_CENTERS;
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
    return centers.find(center => center.id === getSelectedCenterId()) || centers[0] || FALLBACK_CENTERS[0];
  }

  function centerDisplayName(center = getSelectedCenter()) {
    return center?.name || center?.label || 'Fun Galaxy Centre';
  }

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
    }
  }

  function toggleMenuCollapsed() {
    persistCollapsed(!readCollapsed());
    applyMenuCollapsed();
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
      const children = item.children.map(child => `
        <button type="button" class="fgx-menu-subitem" title="${escapeHtml(child.label)}" data-fgx-menu-key="${escapeHtml(child.key)}"${child.resource ? ` data-ops-resource="${escapeHtml(child.resource)}"` : ''}>
          <span class="fgx-menu-subitem-mark" aria-hidden="true"></span>
          <span class="fgx-menu-label">${escapeHtml(child.label)}</span>
        </button>
      `).join('');
      return `
        <div class="fgx-menu-group" data-fgx-group="${escapeHtml(item.key)}">
          <button type="button" class="fgx-menu-item fgx-menu-item-parent" title="${escapeHtml(item.label)}" data-fgx-menu-key="${escapeHtml(item.key)}">
            <span class="fgx-menu-icon">${icons[item.icon] || ''}</span>
            <span class="fgx-menu-label">${escapeHtml(item.label)}</span>
            <span class="fgx-menu-chevron" aria-hidden="true"></span>
          </button>
          <div class="fgx-menu-subnav">${children}</div>
        </div>
      `;
    }

    return `
      <button type="button" class="fgx-menu-item" title="${escapeHtml(item.label)}" data-fgx-menu-key="${escapeHtml(item.key)}">
        <span class="fgx-menu-icon">${icons[item.icon] || ''}</span>
        <span class="fgx-menu-label">${escapeHtml(item.label)}</span>
        ${item.badge ? `<span class="fgx-menu-badge">${escapeHtml(item.badge)}</span>` : ''}
      </button>
    `;
  }

  function closeMenuPopover() {
    const root = document.querySelector('[data-staff-menu-root]');
    if (!root) return;
    root.querySelectorAll('.fgx-menu-popover').forEach(popover => popover.remove());
    root.querySelectorAll('[aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
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
    const alreadyOpen = root.querySelector(`.fgx-menu-popover[data-popover-kind="${kind}"]`);
    closeMenuPopover();
    if (alreadyOpen) return;
    const popover = document.createElement('div');
    popover.className = `fgx-menu-popover ${kind}`;
    popover.dataset.popoverKind = kind;
    popover.setAttribute('role', 'menu');
    popover.innerHTML = html;
    root.appendChild(popover);
    anchor.setAttribute('aria-expanded', 'true');
    positionPopover(popover, anchor, kind);
  }

  function toggleCenterMenu(anchor) {
    const selectedId = getSelectedCenterId();
    const options = getMenuCenters().map(center => {
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
    }).join('');
    openMenuPopover('center', anchor, `
      <div class="fgx-menu-popover-title">Changer de centre</div>
      <div class="fgx-menu-options">${options}</div>
      <button type="button" class="fgx-menu-option fgx-center-option muted" data-fgx-menu-action="direction" role="menuitem">
        <span>
          <strong>Direction multi-centres</strong>
          <small>Comparer les centres et exports</small>
        </span>
      </button>
    `);
  }

  function toggleAccountMenu(anchor) {
    const center = getSelectedCenter();
    const displayName = centerDisplayName(center);
    const roleLabel = getRoleLabel();
    const accessSummary = getAccessSummary();
    const themeSummary = getThemeSummary();
    openMenuPopover('account', anchor, `
      <div class="fgx-account-summary" role="presentation">
        <span>Session active</span>
        <strong>${escapeHtml(displayName)}</strong>
        <small>${escapeHtml(roleLabel)} · ${escapeHtml(accessSummary)}</small>
      </div>
      <div class="fgx-menu-popover-title">Actions rapides</div>
      <button type="button" class="fgx-menu-option" data-fgx-menu-action="center" role="menuitem">
        <span class="fgx-menu-option-icon">${icons.center}</span>
        <span>
          <strong>Changer de centre</strong>
          <small>Libramont, Gembloux ou Ciney</small>
        </span>
      </button>
      <button type="button" class="fgx-menu-option" data-fgx-menu-action="direction" role="menuitem">
        <span class="fgx-menu-option-icon">${icons.dashboard}</span>
        <span>
          <strong>Direction</strong>
          <small>Vue multi-centres</small>
        </span>
      </button>
      <button type="button" class="fgx-menu-option" data-fgx-menu-action="users" role="menuitem">
        <span class="fgx-menu-option-icon">${icons.users}</span>
        <span>
          <strong>Équipe & accès</strong>
          <small>Codes, rôles et permissions</small>
        </span>
      </button>
      <button type="button" class="fgx-menu-option" data-fgx-menu-action="establishment" role="menuitem">
        <span class="fgx-menu-option-icon">${icons.establishment}</span>
        <span>
          <strong>Établissement</strong>
          <small>Centre, horaires et capacité</small>
        </span>
      </button>
      <button type="button" class="fgx-menu-option" data-fgx-menu-action="theme" role="menuitem">
        <span class="fgx-menu-option-icon">${icons.settings}</span>
        <span>
          <strong>Changer de thème</strong>
          <small>${escapeHtml(themeSummary)}</small>
        </span>
      </button>
      <button type="button" class="fgx-menu-option danger" data-fgx-menu-action="logout" role="menuitem">
        <span class="fgx-menu-option-icon">${icons.arrivals}</span>
        <span>
          <strong>D&eacute;connexion</strong>
          <small>Fermer la session staff</small>
        </span>
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
    try {
      if (typeof state !== 'undefined') {
        state.adminCenterId = centerId;
        state.staffAccessControl = null;
      }
      if (typeof save === 'function') {
        save();
      }
    } catch (error) {
      console.warn('[staff-menu] center save failed', error);
    }
    closeMenuPopover();
    if (typeof loadStaffAuthSession === 'function') {
      loadStaffAuthSession({ silent: true }).then(() => {
        if (typeof renderStaff === 'function' && typeof state !== 'undefined' && state.view === 'staff') renderStaff();
        renderMenu();
      });
    }
    if (centerId !== 'libramont') {
      if (typeof setView === 'function') setView('admin');
      if (typeof setAdminCenter === 'function') setAdminCenter(centerId);
    } else if (typeof renderStaff === 'function' && typeof state !== 'undefined' && state.view === 'staff') {
      renderStaff();
    }
    renderMenu();
  }

  function handleMenuAction(action) {
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
    if (action === 'users' || action === 'settings' || action === 'establishment') {
      navigateMenu(action);
      return;
    }
    if (action === 'theme') {
      const nextTheme = document.body.classList.contains('staff-light') ? 'dark' : 'light';
      if (typeof setStaffTheme === 'function') {
        setStaffTheme(nextTheme);
      } else {
        document.body.classList.toggle('staff-light', nextTheme === 'light');
      }
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
        <button type="button" class="fgx-menu-brand" data-fgx-menu-key="dashboard" title="Dashboard Pinlane">
          <span class="fgx-menu-logo-frame">
            <img class="fgx-menu-logo" src="${PLATFORM_MARK_SRC}" alt="" aria-hidden="true">
          </span>
          <span class="fgx-menu-brand-copy">
            <strong>${escapeHtml(PLATFORM_BRAND.name)}</strong>
            <small>${escapeHtml(PLATFORM_BRAND.subtitle)}</small>
          </span>
        </button>
        <button type="button" class="fgx-menu-collapse" data-fgx-menu-collapse aria-label="R\u00e9duire le menu" title="R\u00e9duire le menu"></button>
      </div>

      <button type="button" class="fgx-menu-center" data-fgx-center-menu aria-haspopup="menu" aria-expanded="false" title="Changer de centre">
        <span class="fgx-center-dot">${icons.center}</span>
        <span class="fgx-menu-label">${escapeHtml(displayName)}</span>
        <span class="fgx-menu-chevron" aria-hidden="true"></span>
      </button>

      <nav class="fgx-menu-nav" aria-label="Navigation op\u00e9rationnelle">
        ${menuSections.map(sectionMarkup).join('')}
      </nav>

      <button type="button" class="fgx-menu-account" data-fgx-account-menu aria-haspopup="menu" aria-expanded="false" title="Options du compte">
        <span class="fgx-menu-avatar">FG</span>
        <span class="fgx-menu-account-copy">
          <strong>${escapeHtml(displayName)}</strong>
          <small>${escapeHtml(roleLabel)}</small>
        </span>
        <span class="fgx-menu-more" aria-hidden="true">...</span>
      </button>
    `;

    if (!root.dataset.fgxMenuBound) {
      root.addEventListener('click', handleMenuClick);
      root.addEventListener('keydown', event => {
        const interactive = event.target.closest('[data-fgx-menu-key], [data-fgx-menu-collapse], [data-fgx-center-menu], [data-fgx-account-menu], [data-fgx-center-option], [data-fgx-menu-action]');
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
      handleMenuAction(menuAction.dataset.fgxMenuAction);
      return;
    }

    const target = event.target.closest('[data-fgx-menu-key]');
    if (!target) return;
    event.stopPropagation();
    closeMenuPopover();
    const key = target.dataset.fgxMenuKey;
    const resource = target.dataset.opsResource;
    if (resource) {
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
    setMenuPage(key);
    if (key === 'dashboard') {
      if (typeof setView === 'function') setView('staff');
      return;
    }
    if (key === 'planning') {
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
      if (typeof loadOpsAdmin === 'function') loadOpsAdmin(false);
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
    if (key === 'offers') {
      setMenuPage('offers');
      if (typeof setView === 'function') setView('staff');
      if (typeof renderStaff === 'function') renderStaff();
      return;
    }
    if (key === 'users' || key === 'settings') {
      setMenuPage(key);
      if (typeof setView === 'function') setView('staff');
      if (typeof renderStaff === 'function') renderStaff();
      return;
    }
    if (typeof setView === 'function') setView('admin');
    if (typeof setAdminTab === 'function') setAdminTab('overview');
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
    const activitiesActive = view === 'staff' && ['prices', 'lanes', 'laserGame', 'offers'].includes(page);
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
      'offers',
      'emails',
      'campaigns',
      'establishment',
      'users',
      'settings'
    ];
    const directStaffPageActive = view === 'staff' && directStaffPages.includes(page);

    root.querySelectorAll('[data-fgx-menu-key]').forEach(item => item.classList.remove('active'));
    root.querySelectorAll('[data-ops-resource]').forEach(item => {
      item.classList.toggle('active', planningActive && item.dataset.opsResource === resource);
    });

    root.querySelector('[data-fgx-menu-key="dashboard"]')?.classList.toggle('active', dashboardActive);
    root.querySelector('[data-fgx-menu-key="planning"]')?.classList.toggle('active', planningActive);
    root.querySelector('[data-fgx-group="planning"]')?.classList.toggle('active', planningActive);
    root.querySelector('[data-fgx-group="field"]')?.classList.toggle('active', fieldActive);
    root.querySelector('[data-fgx-group="activities"]')?.classList.toggle('active', activitiesActive);

    if (directStaffPageActive) {
      root.querySelector(`[data-fgx-menu-key="${page}"]`)?.classList.add('active');
    }
    if (view === 'admin') {
      const adminKey = page && root.querySelector(`[data-fgx-menu-key="${page}"]`) ? page : 'dashboard';
      root.querySelector(`[data-fgx-menu-key="${adminKey}"]`)?.classList.add('active');
    }
  }

  window.syncStaffMenuState = syncStaffMenuState;
  window.FGX_STAFF_MENU = menuSections;
  window.toggleStaffMenuCollapsed = toggleMenuCollapsed;
  window.setStaffMenuCollapsed = collapsed => {
    persistCollapsed(!!collapsed);
    applyMenuCollapsed();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderMenu, { once: true });
  } else {
    renderMenu();
  }
})();
