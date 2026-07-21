/* ============================================================================
   COCKPIT FONDATEUR : PAGE EQUIPE (categorie PLATEFORME, permission platform.admin)
   ----------------------------------------------------------------------------
   Gere les membres, les roles, les permissions et les codes d'acces sur TOUS
   les centres, depuis le poste du proprietaire plateforme. Rendue dans
   #staffCockpitPage, meme hote que founder-cockpit.js.

   Doctrine identique au reste de la categorie :
   - style Vercel/Linear NEUTRE : monochrome sauf le sens (vert = actif/reussi,
     rouge = desactive/echec, ambre = attente/absent), filets 1px, composants
     pv2- et fck- reutilises, AUCUNE couleur de marque client ;
   - lecture : GET /api/ops?action=founderTeam. Ecritures : POST /api/staff-auth,
     le centre cible voyage dans le body (inter-centres autorise, tout est trace
     au journal d'audit cote serveur) ;
   - le SaaS n'est pas lance : bundle.testData => bandeau d'honnetete ;
   - TOUT l'etat vit hors DOM sur window.PinlaneFounderTeam et survit aux
     reconstructions innerHTML. Les cases de la modale de permissions sont
     derivees d'un Set en memoire, jamais lues dans le DOM : la source de verite
     est l'etat, pas le rendu. Un re-rendu (etat busy) ne perd donc rien ;
   - une permission assignable:false (platform.admin) n'est JAMAIS proposee ni
     cochable, et n'entre JAMAIS dans le corps d'une ecriture (escalade, refusee
     serveur). Les permissions non attribuables qu'un role possede deja sont
     PRESERVEES a l'enregistrement : on ne peut ni en ajouter, ni en retirer ;
   - JAMAIS de balise <header> : en mode console, `body.staff-mode header` ecrase
     tout <header> a hauteur 0. Uniquement div/section.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  const esc = (value) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(value ?? '') : String(value ?? ''));
  const escJs = (value) => (typeof window.escapeJsString === 'function' ? window.escapeJsString(String(value ?? '')) : String(value ?? '').replace(/['"\\]/g, ''));

  // Etat hors DOM : survit aux reconstructions innerHTML.
  const team = {
    loaded: false,
    loading: false,
    error: '',
    data: null,
    filterCenter: 'all',
    busy: '',            // cle de l'action en cours
    reveal: {},          // 'member:<id>' / 'role:<id>' -> { code, needsRegenerate }
    modal: null,         // { kind, ... } ; null = ferme
    modalMounted: false, // garde de premiere apparition de la modale
  };
  window.PinlaneFounderTeam = team;

  let activeRoot = null;

  function getRoot() {
    if (activeRoot && (typeof document.contains !== 'function' || document.contains(activeRoot))) return activeRoot;
    return document.getElementById('staffCockpitPage');
  }

  function toast(message) {
    if (typeof window.showAlert === 'function') window.showAlert(message);
  }

  function userMessage(error, fallback) {
    return (error && (error.userMessage || error.message)) || fallback;
  }

  // ---- Reseau ---------------------------------------------------------------

  async function load(force = false) {
    if (team.loading || (team.loaded && !force)) return;
    team.loading = true;
    team.error = '';
    render();
    try {
      const payload = await window.apiRequest('/api/ops?action=founderTeam');
      team.data = payload || null;
      team.loaded = true;
    } catch (error) {
      const status = Number(error && error.status);
      team.error = (status === 400 || status === 404)
        ? 'Cette vue n\'est pas encore disponible cote serveur. Elle s\'allumera a la prochaine mise en production.'
        : userMessage(error, 'L\'equipe n\'a pas pu se charger. Rechargez dans un instant.');
    } finally {
      team.loading = false;
      render();
    }
  }

  function reload() { team.loaded = false; load(true); }
  window.fteReload = reload;

  // Ecriture staff : POST /api/staff-auth. Le centre cible voyage dans le body.
  // Renvoie le payload (utile pour lire revealedCode) ; laisse remonter l'erreur.
  async function staffWrite(body) {
    return window.apiRequest('/api/staff-auth', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // ---- Selecteurs d'etat ----------------------------------------------------

  function centers() { return (team.data && Array.isArray(team.data.centers)) ? team.data.centers : []; }
  function roles() { return (team.data && Array.isArray(team.data.roles)) ? team.data.roles : []; }
  function members() { return (team.data && Array.isArray(team.data.members)) ? team.data.members : []; }
  function permissionsCatalog() { return (team.data && Array.isArray(team.data.permissionsCatalog)) ? team.data.permissionsCatalog : []; }

  function centerName(id) {
    const found = centers().find((c) => c.id === id);
    return found ? found.name : id;
  }

  function rolesOfCenter(centerId) { return roles().filter((r) => r.centerId === centerId); }
  function roleById(id) { return roles().find((r) => r.id === id) || null; }

  function inFilter(centerId) { return team.filterCenter === 'all' || team.filterCenter === centerId; }

  // Permissions attribuables uniquement (assignable:false = platform.admin :
  // jamais proposee, jamais cochable, jamais envoyee).
  function assignablePermKeys() {
    return new Set(permissionsCatalog().filter((p) => p.assignable !== false).map((p) => p.key));
  }

  // ---- Formateurs -----------------------------------------------------------

  function when(iso) {
    if (!iso) return 'jamais';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'jamais';
    const minutes = Math.round((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return 'a l\'instant';
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;
    const days = Math.round(hours / 24);
    return `il y a ${days} j`;
  }

  function chip(tone, label) { return `<span class="pv2-chip ${tone}">${esc(label)}</span>`; }
  function emptyLine(text) { return `<p class="pv2-quiet fte-empty">${esc(text)}</p>`; }

  function testDataBanner() {
    return `<aside class="fck-testdata" role="note">
      Donnees de TEST : le SaaS n'est pas lance, tout ce qui suit vient des essais internes.
      Aucun membre, role ni code de cette page n'est du reel client.
    </aside>`;
  }

  function panel(title, subtitle, aside, body) {
    return `<section class="pv2-panel">
      <div class="pv2-panel-head has-sub">
        <div><h2>${esc(title)}</h2>${subtitle ? `<p class="pv2-panel-sub">${esc(subtitle)}</p>` : ''}</div>
        ${aside || ''}
      </div>
      <div class="pv2-panel-body">${body}</div>
    </section>`;
  }

  // ---- Filtre par centre ----------------------------------------------------

  function renderFilter() {
    const options = [{ id: 'all', name: 'Tous les centres' }].concat(centers())
      .map((c) => `<option value="${esc(c.id)}" ${team.filterCenter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    return `<section class="pv2-panel"><div class="pv2-panel-body fte-filter">
      <label for="fteCenterFilter">Centre</label>
      <select id="fteCenterFilter" class="pv2-input" onchange="fteSetCenter(this.value)">${options}</select>
      <span class="pv2-quiet">${members().filter((m) => inFilter(m.centerId)).length} membre(s) - ${roles().filter((r) => inFilter(r.centerId)).length} role(s)</span>
    </div></section>`;
  }

  window.fteSetCenter = function (value) {
    team.filterCenter = String(value || 'all');
    render();
  };

  // ---- Membres --------------------------------------------------------------

  function memberStatusIsActive(status) { return String(status) === 'active'; }

  function memberRow(m) {
    // Roles proposables = roles NON verrouilles du centre du membre. Un role
    // systeme verrouille (ex : proprietaire plateforme, porteur de platform.admin)
    // n'est jamais offert : l'attribuer serait une escalade. Si le membre porte
    // deja un role verrouille, il reste visible en option selectionnee mais
    // desactivee, jamais reassignable a la volee.
    const assignableRoles = rolesOfCenter(m.centerId).filter((r) => !r.locked);
    const currentLocked = !assignableRoles.some((r) => r.id === m.roleId);
    const currentOption = currentLocked
      ? `<option value="${esc(m.roleId)}" selected disabled>${esc(m.roleName || 'role verrouille')}</option>`
      : '';
    const roleOptions = currentOption + (assignableRoles.length
      ? assignableRoles.map((r) => `<option value="${esc(r.id)}" ${!currentLocked && r.id === m.roleId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')
      : (currentOption ? '' : `<option value="${esc(m.roleId)}" selected>${esc(m.roleName || 'role')}</option>`));
    const active = memberStatusIsActive(m.status);
    const busyRole = team.busy === `role:${m.id}`;
    const busyStatus = team.busy === `status:${m.id}`;
    const revealKey = `member:${m.id}`;
    const revealed = team.reveal[revealKey];

    const codeCell = revealed
      ? `<div class="fte-reveal">
          <code>${esc(revealed.code)}</code>
          <button type="button" onclick="fteHideReveal('${escJs(revealKey)}')">Masquer</button>
        </div>
        <span class="fte-reveal-warn">Code en clair a l'ecran. Ne le laissez pas affiche.</span>`
      : `${m.hasCode ? chip('', 'code present') : chip('amber', 'pas de code')}
         <button type="button" class="pv2-btn ghost" ${team.busy === `reveal:${m.id}` ? 'disabled' : ''}
           onclick="fteRevealMember('${escJs(m.id)}','${escJs(m.centerId)}')">${team.busy === `reveal:${m.id}` ? 'En cours...' : 'Reveler'}</button>`;

    return `<tr>
      <td><strong>${esc(m.name)}</strong><div class="pv2-cell-sub">${esc(centerName(m.centerId))}</div></td>
      <td><select class="pv2-input fte-role-select" ${busyRole ? 'disabled' : ''}
        aria-label="Role de ${esc(m.name)}"
        onchange="fteChangeRole('${escJs(m.id)}','${escJs(m.centerId)}', this.value)">${roleOptions}</select></td>
      <td><span class="fte-status-cell">
        <button type="button" class="mk-switch ${active ? 'is-on' : ''}" role="switch"
          aria-checked="${active ? 'true' : 'false'}" ${busyStatus ? 'disabled' : ''}
          aria-label="${active ? 'Desactiver' : 'Activer'} ${esc(m.name)}"
          onclick="fteToggleStatus('${escJs(m.id)}','${escJs(m.centerId)}')"><span></span></button>
        <span class="fte-status-txt">${active ? 'actif' : 'desactive'}</span>
      </span></td>
      <td class="pv2-quiet">${esc(when(m.lastLoginAt))}</td>
      <td class="fte-col-action">${codeCell}</td>
    </tr>`;
  }

  function renderMembers() {
    const list = members().filter((m) => inFilter(m.centerId));
    const aside = `<button type="button" class="pv2-btn primary" onclick="fteOpenNewMember()">Nouveau membre</button>`;
    const body = list.length
      ? `<table class="pv2-table fck-table">
          <thead><tr><th>Membre</th><th>Role</th><th>Statut</th><th>Derniere connexion</th><th class="fte-col-action">Code</th></tr></thead>
          <tbody>${list.map(memberRow).join('')}</tbody>
        </table>`
      : emptyLine('Aucun membre pour ce filtre.');
    return panel('Membres', 'Changez le role, activez ou desactivez, revelez le code a la demande. Chaque geste est trace au journal.', aside, body);
  }

  // Change de role : action tracee, centre du membre dans le body.
  window.fteChangeRole = async function (memberId, centerId, roleId) {
    if (!roleId || team.busy) { render(); return; }
    const target = members().find((m) => m.id === memberId);
    if (target && target.roleId === roleId) return;
    team.busy = `role:${memberId}`;
    render();
    try {
      await staffWrite({ action: 'updateMemberRole', centerId, memberId, roleId });
      toast('Role du membre mis a jour.');
      reload();
    } catch (error) {
      toast(userMessage(error, 'Le changement de role n\'a pas ete enregistre.'));
    } finally {
      team.busy = '';
      render();
    }
  };

  window.fteToggleStatus = async function (memberId, centerId) {
    if (team.busy) return;
    team.busy = `status:${memberId}`;
    render();
    try {
      await staffWrite({ action: 'toggleMemberStatus', centerId, memberId });
      toast('Statut du membre bascule.');
      reload();
    } catch (error) {
      toast(userMessage(error, 'La bascule de statut a echoue.'));
    } finally {
      team.busy = '';
      render();
    }
  };

  window.fteRevealMember = async function (memberId, centerId) {
    if (team.busy) return;
    team.busy = `reveal:${memberId}`;
    render();
    try {
      const payload = await staffWrite({ action: 'revealMemberCode', centerId, memberId });
      team.reveal[`member:${memberId}`] = { code: payload.revealedCode, needsRegenerate: Boolean(payload.needsRegenerate) };
    } catch (error) {
      toast(userMessage(error, 'Le code n\'a pas pu etre revele.'));
    } finally {
      team.busy = '';
      render();
    }
  };

  window.fteHideReveal = function (key) {
    delete team.reveal[key];
    render();
  };

  // ---- Roles ----------------------------------------------------------------

  function roleCard(r) {
    const permCount = Array.isArray(r.permissions) ? r.permissions.length : 0;
    const revealKey = `role:${r.id}`;
    const revealed = team.reveal[revealKey];
    const revealBlock = revealed
      ? `<div class="fte-reveal">
          <code>${esc(revealed.code)}</code>
          <button type="button" onclick="fteHideReveal('${escJs(revealKey)}')">Masquer</button>
        </div>
        <span class="fte-reveal-warn">Code en clair a l'ecran. Ne le laissez pas affiche.</span>`
      : '';
    return `<article class="fte-role-card">
      <div class="fck-card-head">
        <div><strong>${esc(r.name)}</strong><div class="pv2-cell-sub">${esc(centerName(r.centerId))}</div></div>
        ${r.locked ? chip('', 'verrouille') : ''}
      </div>
      <div class="fte-role-meta">
        ${chip('', `${r.memberCount || 0} membre${(r.memberCount || 0) > 1 ? 's' : ''}`)}
        ${chip('', `${permCount} permission${permCount > 1 ? 's' : ''}`)}
      </div>
      ${revealBlock}
      <div class="fte-role-actions">
        <button type="button" class="pv2-btn" ${r.locked ? 'disabled title="Role systeme : permissions non modifiables"' : ''}
          onclick="fteOpenRolePerms('${escJs(r.id)}')">Permissions</button>
        <button type="button" class="pv2-btn ghost" ${team.busy === `reveal-role:${r.id}` ? 'disabled' : ''}
          onclick="fteRevealRole('${escJs(r.id)}','${escJs(r.centerId)}')">${team.busy === `reveal-role:${r.id}` ? 'En cours...' : 'Reveler le code'}</button>
        <button type="button" class="pv2-btn ghost" ${team.busy === `regen:${r.id}` ? 'disabled' : ''}
          onclick="fteRegenRole('${escJs(r.id)}','${escJs(r.centerId)}')">${team.busy === `regen:${r.id}` ? 'En cours...' : 'Regenerer'}</button>
      </div>
    </article>`;
  }

  function renderRoles() {
    const list = roles().filter((r) => inFilter(r.centerId));
    const aside = `<button type="button" class="pv2-btn primary" onclick="fteOpenNewRole()">Nouveau role</button>`;
    const body = list.length
      ? `<div class="fte-role-grid">${list.map(roleCard).join('')}</div>`
      : emptyLine('Aucun role pour ce filtre.');
    return panel('Roles et permissions', 'Un role porte un code d\'acces et un jeu de permissions. platform.admin n\'est jamais attribuable.', aside, body);
  }

  window.fteRevealRole = async function (roleId, centerId) {
    if (team.busy) return;
    team.busy = `reveal-role:${roleId}`;
    render();
    try {
      const payload = await staffWrite({ action: 'revealRoleCode', centerId, roleId });
      team.reveal[`role:${roleId}`] = { code: payload.revealedCode, needsRegenerate: Boolean(payload.needsRegenerate) };
    } catch (error) {
      toast(userMessage(error, 'Le code du role n\'a pas pu etre revele.'));
    } finally {
      team.busy = '';
      render();
    }
  };

  window.fteRegenRole = async function (roleId, centerId) {
    if (team.busy) return;
    team.busy = `regen:${roleId}`;
    render();
    try {
      const payload = await staffWrite({ action: 'regenerateRoleCode', centerId, roleId });
      if (payload && payload.newAccessCode) {
        team.reveal[`role:${roleId}`] = { code: payload.newAccessCode, needsRegenerate: false };
      }
      toast('Nouveau code genere pour le role.');
      // On garde le code revele, mais on rafraichit le reste (compteurs).
      team.loaded = false;
      await load(true);
    } catch (error) {
      toast(userMessage(error, 'La regeneration du code a echoue.'));
    } finally {
      team.busy = '';
      render();
    }
  };

  // ---- Modale : permissions d'un role ---------------------------------------

  window.fteOpenRolePerms = function (roleId) {
    const role = roleById(roleId);
    if (!role || role.locked) return;
    const assignable = assignablePermKeys();
    // Cases pre-cochees = permissions attribuables deja portees par le role.
    const checked = new Set((role.permissions || []).filter((k) => assignable.has(k)));
    team.modal = { kind: 'rolePerms', roleId, centerId: role.centerId, name: role.name, checked, busy: false };
    team.modalMounted = false;
    render();
  };

  window.fteTogglePerm = function (key) {
    if (!team.modal || team.modal.kind !== 'rolePerms') return;
    if (!assignablePermKeys().has(key)) return; // non attribuable : jamais basculable
    if (team.modal.checked.has(key)) team.modal.checked.delete(key);
    else team.modal.checked.add(key);
    // Pas de re-rendu : la case native tient l'etat visuel, le Set tient la
    // verite. Un rendu ulterieur derive les cases du Set.
  };

  window.fteSaveRolePerms = async function () {
    const modal = team.modal;
    if (!modal || modal.kind !== 'rolePerms' || modal.busy) return;
    const role = roleById(modal.roleId);
    if (!role) { closeModal(); return; }
    const assignable = assignablePermKeys();
    // Preservation : les permissions NON attribuables que le role possede deja
    // (aucune ne peut etre ajoutee ni retiree par cette UI) + les attribuables
    // cochees. platform.admin n'entre donc jamais, mais n'est pas non plus
    // retiree a tort si un role systeme la portait.
    const preserved = (role.permissions || []).filter((k) => !assignable.has(k));
    const chosen = Array.from(modal.checked).filter((k) => assignable.has(k));
    const permissions = Array.from(new Set([...preserved, ...chosen]));

    modal.busy = true;
    render();
    try {
      await staffWrite({ action: 'updateRolePermissions', centerId: modal.centerId, roleId: modal.roleId, permissions });
      toast('Permissions du role enregistrees.');
      closeModal();
      reload();
    } catch (error) {
      modal.busy = false;
      toast(userMessage(error, 'Les permissions n\'ont pas ete enregistrees.'));
      render();
    }
  };

  function renderPermGroups(checkedSet, keyPrefix) {
    const catalog = permissionsCatalog();
    if (!catalog.length) return emptyLine('Catalogue de permissions indisponible.');
    const groups = [];
    const byGroup = new Map();
    catalog.forEach((p) => {
      const g = p.group || 'Autres';
      if (!byGroup.has(g)) { byGroup.set(g, []); groups.push(g); }
      byGroup.get(g).push(p);
    });
    return groups.map((g) => {
      const rows = byGroup.get(g).map((p) => {
        const locked = p.assignable === false; // platform.admin : grisee, non cochable
        const on = !locked && checkedSet.has(p.key);
        const disabledAttr = locked ? 'disabled' : '';
        const onclick = locked ? '' : `onclick="${keyPrefix}('${escJs(p.key)}')"`;
        return `<label class="fte-perm-row ${on ? 'is-on' : ''} ${locked ? 'is-locked' : ''}" ${onclick}>
          <input type="checkbox" ${on ? 'checked' : ''} ${disabledAttr} tabindex="-1" aria-label="${esc(p.label)}">
          <span class="fte-perm-txt">
            <span class="fte-perm-lbl">${esc(p.label)}${locked ? ' (non attribuable)' : ''}</span>
            <span class="fte-perm-key">${esc(p.key)}</span>
          </span>
        </label>`;
      }).join('');
      return `<div class="fte-perm-group"><h3>${esc(g)}</h3>${rows}</div>`;
    }).join('');
  }

  function renderRolePermsModal() {
    const modal = team.modal;
    const busy = modal.busy;
    return modalShell(
      `Permissions - ${esc(modal.name)}`,
      `Centre : ${esc(centerName(modal.centerId))}. Cochez ce que ce role peut faire. platform.admin est grisee : jamais attribuable.`,
      renderPermGroups(modal.checked, 'fteTogglePerm'),
      `<button type="button" class="pv2-btn ghost" ${busy ? 'disabled' : ''} onclick="fteCloseModal()">Annuler</button>
       <button type="button" class="pv2-btn primary" ${busy ? 'disabled' : ''} onclick="fteSaveRolePerms()">${busy ? 'Enregistrement...' : 'Enregistrer'}</button>`,
    );
  }

  // ---- Modale : nouveau membre ----------------------------------------------

  window.fteOpenNewMember = function () {
    const defaultCenter = team.filterCenter !== 'all' ? team.filterCenter : (centers()[0] && centers()[0].id) || '';
    const centerRoles = rolesOfCenter(defaultCenter);
    team.modal = {
      kind: 'newMember',
      name: '',
      contact: '',
      centerId: defaultCenter,
      roleId: (centerRoles[0] && centerRoles[0].id) || '',
      busy: false,
    };
    team.modalMounted = false;
    render();
  };

  window.fteModalField = function (key, value) {
    if (!team.modal) return;
    team.modal[key] = value;
    if (key === 'centerId') {
      // Le role doit rester coherent avec le centre choisi.
      const centerRoles = rolesOfCenter(value);
      team.modal.roleId = (centerRoles[0] && centerRoles[0].id) || '';
      render(); // re-rendu pour recharger la liste des roles du centre
    }
  };

  window.fteSaveNewMember = async function () {
    const modal = team.modal;
    if (!modal || modal.kind !== 'newMember' || modal.busy) return;
    if (!String(modal.name).trim()) { toast('Le nom du membre est requis.'); return; }
    if (!modal.centerId) { toast('Choisissez un centre.'); return; }
    if (!modal.roleId) { toast('Choisissez un role.'); return; }
    modal.busy = true;
    render();
    try {
      await staffWrite({ action: 'createMember', centerId: modal.centerId, name: modal.name.trim(), contact: modal.contact || '', roleId: modal.roleId });
      toast('Membre cree.');
      closeModal();
      reload();
    } catch (error) {
      modal.busy = false;
      toast(userMessage(error, 'La creation du membre a echoue.'));
      render();
    }
  };

  function renderNewMemberModal() {
    const modal = team.modal;
    const busy = modal.busy;
    const centerOptions = centers().map((c) => `<option value="${esc(c.id)}" ${modal.centerId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const centerRoles = rolesOfCenter(modal.centerId);
    const roleOptions = centerRoles.length
      ? centerRoles.map((r) => `<option value="${esc(r.id)}" ${modal.roleId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')
      : '<option value="">Aucun role sur ce centre</option>';
    const body = `
      <div class="fte-field"><label for="fteMName">Nom</label>
        <input id="fteMName" class="fte-input" type="text" value="${esc(modal.name)}" oninput="fteModalField('name', this.value)" placeholder="Prenom Nom"></div>
      <div class="fte-field"><label for="fteMContact">Contact (optionnel)</label>
        <input id="fteMContact" class="fte-input" type="text" value="${esc(modal.contact)}" oninput="fteModalField('contact', this.value)" placeholder="email ou telephone"></div>
      <div class="fte-field"><label for="fteMCenter">Centre</label>
        <select id="fteMCenter" class="pv2-input" onchange="fteModalField('centerId', this.value)">${centerOptions}</select></div>
      <div class="fte-field"><label for="fteMRole">Role</label>
        <select id="fteMRole" class="pv2-input" ${centerRoles.length ? '' : 'disabled'} onchange="fteModalField('roleId', this.value)">${roleOptions}</select></div>`;
    return modalShell(
      'Nouveau membre',
      'Un code d\'acces sera genere. Le centre cible est trace au journal.',
      body,
      `<button type="button" class="pv2-btn ghost" ${busy ? 'disabled' : ''} onclick="fteCloseModal()">Annuler</button>
       <button type="button" class="pv2-btn primary" ${busy ? 'disabled' : ''} onclick="fteSaveNewMember()">${busy ? 'Creation...' : 'Creer le membre'}</button>`,
    );
  }

  // ---- Modale : nouveau role ------------------------------------------------

  window.fteOpenNewRole = function () {
    const defaultCenter = team.filterCenter !== 'all' ? team.filterCenter : (centers()[0] && centers()[0].id) || '';
    team.modal = { kind: 'newRole', name: '', centerId: defaultCenter, checked: new Set(), busy: false };
    team.modalMounted = false;
    render();
  };

  window.fteToggleNewRolePerm = function (key) {
    if (!team.modal || team.modal.kind !== 'newRole') return;
    if (!assignablePermKeys().has(key)) return;
    if (team.modal.checked.has(key)) team.modal.checked.delete(key);
    else team.modal.checked.add(key);
  };

  window.fteSaveNewRole = async function () {
    const modal = team.modal;
    if (!modal || modal.kind !== 'newRole' || modal.busy) return;
    if (!String(modal.name).trim()) { toast('Le nom du role est requis.'); return; }
    if (!modal.centerId) { toast('Choisissez un centre.'); return; }
    const assignable = assignablePermKeys();
    const permissions = Array.from(modal.checked).filter((k) => assignable.has(k));
    modal.busy = true;
    render();
    try {
      await staffWrite({ action: 'createRole', centerId: modal.centerId, name: modal.name.trim(), permissions });
      toast('Role cree.');
      closeModal();
      reload();
    } catch (error) {
      modal.busy = false;
      toast(userMessage(error, 'La creation du role a echoue.'));
      render();
    }
  };

  function renderNewRoleModal() {
    const modal = team.modal;
    const busy = modal.busy;
    const centerOptions = centers().map((c) => `<option value="${esc(c.id)}" ${modal.centerId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const body = `
      <div class="fte-field"><label for="fteRName">Nom du role</label>
        <input id="fteRName" class="fte-input" type="text" value="${esc(modal.name)}" oninput="fteModalField('name', this.value)" placeholder="ex : Accueil, Bar, Direction"></div>
      <div class="fte-field"><label for="fteRCenter">Centre</label>
        <select id="fteRCenter" class="pv2-input" onchange="fteModalField('centerId', this.value)">${centerOptions}</select></div>
      <div class="fte-field"><label>Permissions</label>${renderPermGroups(modal.checked, 'fteToggleNewRolePerm')}</div>`;
    return modalShell(
      'Nouveau role',
      'platform.admin est grisee : jamais attribuable. Un code d\'acces sera genere.',
      body,
      `<button type="button" class="pv2-btn ghost" ${busy ? 'disabled' : ''} onclick="fteCloseModal()">Annuler</button>
       <button type="button" class="pv2-btn primary" ${busy ? 'disabled' : ''} onclick="fteSaveNewRole()">${busy ? 'Creation...' : 'Creer le role'}</button>`,
    );
  }

  // ---- Enveloppe de modale + fermeture --------------------------------------

  function modalShell(title, sub, body, foot) {
    return `<div class="fte-overlay" onclick="fteOverlayClick(event)">
      <div class="fte-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="fte-modal-head">
          <div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
          <button type="button" class="fte-modal-close" aria-label="Fermer" onclick="fteCloseModal()">&times;</button>
        </div>
        <div class="fte-modal-body">${body}</div>
        <div class="fte-modal-foot">${foot}</div>
      </div>
    </div>`;
  }

  function closeModal() { team.modal = null; team.modalMounted = false; render(); }
  window.fteCloseModal = closeModal;

  // Clic sur le voile (hors panneau) = fermeture. Un clic dans le panneau ne
  // remonte pas jusqu'ici grace au ciblage exact.
  window.fteOverlayClick = function (event) {
    if (event && event.target && event.target.classList && event.target.classList.contains('fte-overlay')) closeModal();
  };

  function renderModal() {
    if (!team.modal) return '';
    if (team.modal.kind === 'rolePerms') return renderRolePermsModal();
    if (team.modal.kind === 'newMember') return renderNewMemberModal();
    if (team.modal.kind === 'newRole') return renderNewRoleModal();
    return '';
  }

  // ---- Rendu ----------------------------------------------------------------

  function render() {
    const root = getRoot();
    if (!root) return;
    if (!team.loaded && !team.loading && !team.error) setTimeout(() => load(), 0);

    const d = team.data || {};
    const generated = d.generatedAt ? when(d.generatedAt) : '';
    // Garde de premiere apparition de la modale : animation posee une seule fois.
    const animClass = team.modal && !team.modalMounted ? ' fte-anim' : '';
    if (team.modal && !team.modalMounted) team.modalMounted = true;

    root.innerHTML = `<div class="pv2-shell fte-shell${animClass}">
      <section class="pv2-bar">
        <div>
          <div class="pv2-bar-crumb"><span class="pv2-live"></span>Plateforme</div>
          <h1>Equipe et acces</h1>
          <p class="pv2-bar-sub">Membres, roles, permissions et codes, sur tous les centres.${generated ? ` - actualise ${esc(generated)}` : ''}</p>
        </div>
        <div class="pv2-bar-actions">
          <button type="button" class="pv2-btn ghost" onclick="fteReload()">Actualiser</button>
        </div>
      </section>

      ${d.testData ? testDataBanner() : ''}

      ${team.error ? `<section class="pv2-panel"><div class="pv2-panel-body">
        <p class="pv2-quiet">${esc(team.error)}</p>
        <button type="button" class="pv2-btn" onclick="fteReload()">Reessayer</button></div></section>` : ''}

      ${team.loading && !team.data ? `<section class="pv2-panel"><div class="pv2-panel-body"><p class="pv2-quiet">Chargement de l'equipe...</p></div></section>` : ''}

      ${team.data ? [
        renderFilter(),
        renderMembers(),
        renderRoles(),
      ].join('') : ''}

      ${renderModal()}
    </div>`;
  }

  // Point d'entree public. Compatible avec le dispatch cockpit : (root) ou ().
  window.renderFounderTeamPage = function (root) {
    if (root && root.nodeType === 1) activeRoot = root;
    render();
  };
})();
