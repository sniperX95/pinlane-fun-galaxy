(function () {
  'use strict';
  const entries = new Map(), scopes = new Map(), editors = new Map(), pending = new Set();
  const endpoint = '/api/staff-customer-notes';
  const esc = value => escapeHtml(String(value == null ? '' : value));
  const center = row => String(row.centerId || row.center_id || getCurrentStaffCenterId());
  const key = row => center(row) + ':' + row.id;
  const signature = row => String(row.phone || '') + '|' + String(row.email || '');
  const canEdit = () => canUseStaffPermission('clients.edit');
  const canRead = row => state.view === 'staff' && canUseStaffPermission('reservations.view') && center(row) === String(getCurrentStaffCenterId());
  function editor(row) {
    const value = editors.get(key(row));
    if (value?.kind === 'client' && (!canRead(row) || !canEdit() || value.signature !== signature(row))) {
      editors.delete(key(row)); return null;
    }
    return value;
  }
  function entry(row) {
    const k = key(row), value = entries.get(k);
    if (value && value.signature === signature(row)) return value;
    const next = { signature: signature(row), generation: 0, loaded: false, loading: false, eligible: false, note: null, at: 0, error: '' };
    entries.set(k, next); return next;
  }
  function redraw() {
    if (state.view !== 'staff') return;
    if (state.selectedRes) renderPos();
    if (typeof renderStaffData === 'function') renderStaffData();
  }
  function adopt(row, data) {
    const e = entry(row);
    Object.assign(e, data, { loaded: true, loading: false, error: '', at: Date.now(), signature: signature(row) });
    return e;
  }
  async function ensure(row, force) {
    if (!row || !canRead(row) || pending.has(key(row))) return;
    const e = entry(row), s = signature(row);
    if (e.loading || (!force && Date.now() - e.at < 30000)) return;
    e.loading = true;
    const generation = ++e.generation;
    try {
      const data = await apiRequest(endpoint + '?centerId=' + encodeURIComponent(center(row)) + '&reservationId=' + encodeURIComponent(row.id));
      if (e.generation === generation && signature(row) === s && entries.get(key(row)) === e && canRead(row)) adopt(row, data);
    } catch (error) { if (e.generation === generation) { e.error = error.message || 'Note client indisponible.'; e.at = Date.now(); } }
    finally { if (e.generation === generation) e.loading = false; redraw(); }
  }
  async function prefetch(rows) {
    if (state.view !== 'staff' || !canUseStaffPermission('reservations.view')) return;
    const selected = (rows || []).filter(r => Number(r.id) > 0 && canRead(r) && !pending.has(key(r)) && !entry(r).loading && Date.now() - entry(r).at >= 30000);
    for (let start = 0; start < selected.length; start += 200) {
      const batch = selected.slice(start, start + 200), snapshots = batch.map(r => [r, entry(r), signature(r), ++entry(r).generation]);
      snapshots.forEach(([, e]) => { e.loading = true; });
      try {
        const data = await apiRequest(endpoint + '?centerId=' + encodeURIComponent(center(batch[0])) + '&reservationIds=' + batch.map(r => Number(r.id)).join(','));
        snapshots.forEach(([r, e, s, generation]) => {
          if (e.generation === generation && entries.get(key(r)) === e && signature(r) === s && canRead(r)) {
            const value = data.notesByReservationId && data.notesByReservationId[String(r.id)];
            if (value) adopt(r, value); else Object.assign(e, { at: Date.now(), error: 'Note client indisponible.' });
          }
        });
      } catch (error) { snapshots.forEach(([, e,, generation]) => { if (e.generation === generation) { e.error = error.message || 'Note client indisponible.'; e.at = Date.now(); } }); }
      finally { snapshots.forEach(([, e,, generation]) => { if (e.generation === generation) e.loading = false; }); }
    }
    if (selected.length) redraw();
  }
  function text(row) { return canRead(row) && entry(row).loaded ? String(entry(row).note?.body || '').trim() : ''; }
  function canNoteReservation(row) { return row.status !== 'cancelled' && (canUseStaffPermission('reservations.status') || canUseStaffPermission('reservations.edit')); }
  function scope(row) { return canNoteReservation(row) ? (scopes.get(key(row)) || 'reservation') : 'client'; }
  function setScope(id, value) {
    const row = findStaffReservationById(id); if (!row) return;
    if (value === 'client' && !canEdit()) return;
    scopes.set(key(row), value === 'client' ? 'client' : 'reservation');
    ensure(row); renderPos(); document.getElementById('gcNoteEquipe' + id)?.focus();
  }
  function scopeHtml(row) {
    const s = scope(row), editing = editors.get(key(row));
    if (editing?.kind === 'reservation') return '<p class="staff-note-scope-caption">Cette réservation · modification</p>';
    return `<fieldset class="staff-note-scope"><legend>Cette note concerne</legend>
      <label><input type="radio" name="noteScope${Number(row.id)}" value="reservation" ${s === 'reservation' ? 'checked' : ''} ${canNoteReservation(row) ? '' : 'disabled'} onchange="PinlaneStaffNotes.setScope(${Number(row.id)},this.value)"><span>Cette réservation</span></label>
      <label><input type="radio" name="noteScope${Number(row.id)}" value="client" ${s === 'client' ? 'checked' : ''} ${canEdit() ? '' : 'disabled'} onchange="PinlaneStaffNotes.setScope(${Number(row.id)},this.value)"><span>Ce client</span></label>
      </fieldset><p class="staff-note-scope-caption">${s === 'client' ? 'Note interne conservée sur les prochaines réservations de ce client. Elle complète sa note existante.' : 'Note interne visible sur cette réservation uniquement.'}${canEdit() ? '' : ' L’accès aux notes client nécessite une autorisation.'}</p>`;
  }
  function render(row) {
    const e = entry(row), id = Number(row.id), edit = editor(row);
    if (!canRead(row)) return '';
    queueMicrotask(() => ensure(row));
    if (edit?.kind === 'client') return `<div class="staff-client-note-editor"><label for="staffClientNote${id}">Note client · interne</label>
      <textarea id="staffClientNote${id}" class="gc-note-champ" rows="4" maxlength="4000" data-pl-focus="fiche.client-note.${id}" oninput="PinlaneStaffNotes.setDraft(${id},this.value)">${esc(edit.draft)}</textarea>
      <p class="staff-note-scope-caption">Reste sur les prochaines réservations de ce client, dans ce centre.</p>
      ${edit.error ? `<p class="staff-note-error" role="alert">${esc(edit.error)}</p>` : ''}
      <div class="staff-note-actions"><button type="button" class="gc-note-ok" ${pending.has(key(row)) ? 'disabled aria-busy="true"' : ''} onclick="PinlaneStaffNotes.saveClient(${id})">${pending.has(key(row)) ? 'Enregistrement…' : 'Enregistrer'}</button><button type="button" class="gc-note-retirer" onclick="PinlaneStaffNotes.cancelEdit(${id})">Annuler</button></div></div>`;
    const body = text(row);
    if (body) return `<div class="staff-client-note"><div class="staff-client-note-head"><b>Note client</b><span>Interne · permanente</span>${canEdit() ? `<button type="button" class="gc-note-retirer" onclick="PinlaneStaffNotes.editClient(${id},event)">Modifier</button>` : ''}</div><p>${esc(body)}</p><small class="gc-note-meta">${esc([e.note?.updatedBy, e.note?.updatedAt && formatNoteEquipeQuand(e.note.updatedAt)].filter(Boolean).join(' · '))}</small></div>`;
    if (e.error) return `<div class="staff-note-load-error" role="status">Note client indisponible.<button type="button" class="gc-note-retirer" onclick="PinlaneStaffNotes.reload(${id})">Réessayer</button></div>`;
    if (scope(row) === 'client' && !e.loaded) return '<p class="staff-note-scope-caption" role="status">Chargement de la note client…</p>';
    if (scope(row) === 'client' && e.loaded && !e.eligible) return '<p class="staff-note-error" role="status">' + esc(e.conflict ? e.message : 'Ajoutez un téléphone ou un e-mail au client avant de conserver une note permanente.') + '</p>';
    return '';
  }
  function editClient(id, event) {
    event?.stopPropagation(); const row = findStaffReservationById(id); if (!row || !canEdit()) return;
    const e = entry(row); if (!e.loaded || !e.eligible) { ensure(row, true); return; }
    editors.set(key(row), { kind: 'client', signature: signature(row), draft: String(e.note?.body || ''), baseUpdatedAt: e.note?.updatedAt || null, clientKey: e.clientKey, error: '' });
    renderPos(); document.getElementById('staffClientNote' + id)?.focus();
  }
  function setDraft(id, value) { const row = findStaffReservationById(id), edit = row && editors.get(key(row)); if (edit) edit.draft = value; }
  function cancelEdit(id) { const row = findStaffReservationById(id); if (!row) return; editors.delete(key(row)); renderPos(); }
  async function persist(row, body, original) {
    const k = key(row); if (pending.has(k)) return false;
    const snapshot = signature(row), originalEntry = entry(row);
    originalEntry.generation++; originalEntry.loading = false;
    pending.add(k); renderPos();
    try {
      const payload = await apiRequest(endpoint, { method: 'PATCH', body: JSON.stringify({ centerId: center(row), reservationId: Number(row.id), body, clientKey: original.clientKey, baseUpdatedAt: original.baseUpdatedAt }) });
      if (!payload.ok || !payload.note) throw new Error('La note n’a pas été confirmée. Réessayez.');
      // Invalidate sibling bookings: they share the existing client record, not a copied note.
      for (const [otherKey, e] of entries) if (otherKey.startsWith(center(row) + ':') && e.clientKey === original.clientKey) { e.generation++; e.loading = false; e.at = 0; e.note = payload.note; e.loaded = true; }
      if (signature(row) === snapshot && entries.get(k) === originalEntry) adopt(row, { eligible: true, clientKey: original.clientKey, note: payload.note });
      editors.delete(k); return true;
    } catch (error) {
      const fresh = error.payload?.note;
      if (error.status === 409 && fresh && signature(row) === snapshot && entries.get(k) === originalEntry) adopt(row, { eligible: true, clientKey: original.clientKey, note: fresh });
      const edit = editors.get(k); if (edit) edit.error = error.message || 'Note non enregistrée. Votre texte est conservé.';
      toast(error.message || 'Note non enregistrée. Votre texte est conservé.'); return false;
    } finally { pending.delete(k); redraw(); }
  }
  async function saveClient(id) {
    const row = findStaffReservationById(id), edit = row && editor(row);
    if (!row || !edit || edit.kind !== 'client' || !canEdit()) return false;
    return persist(row, edit.draft.trim(), edit);
  }
  async function addClient(id, value) {
    const row = findStaffReservationById(id); if (!row || !canEdit()) return false;
    await ensure(row); const e = entry(row);
    if (!e.loaded || !e.eligible || e.error) { toast(e.error || (e.conflict && e.message) || 'Un téléphone ou un e-mail est nécessaire pour conserver une note client.'); return false; }
    const body = [String(e.note?.body || '').trim(), value.trim()].filter(Boolean).join('\n\n');
    return persist(row, body, { clientKey: e.clientKey, baseUpdatedAt: e.note?.updatedAt || null });
  }
  function editReservation(id, le, event) {
    event?.stopPropagation(); const row = findStaffReservationById(id), note = row && getReservationNotesEquipe(row).find(n => n.le === le); if (!note) return;
    editors.set(key(row), { kind: 'reservation', le, baseText: note.t });
    scopes.set(key(row), 'reservation'); notesEquipeBrouillons.set(Number(id), note.t); ouvrirNoteEquipe(id);
  }
  function reservationEdit(row) { const value = editors.get(key(row)); return value?.kind === 'reservation' ? value : null; }
  function reload(id) { const row = findStaffReservationById(id); if (row) return ensure(row, true); }
  function invalidate() { for (const e of entries.values()) e.at = 0; }
  window.PinlaneStaffNotes = { text, render, prefetch, ensure, scope, scopeHtml, setScope, addClient, editClient, setDraft, cancelEdit, saveClient, editReservation, reservationEdit, reload, invalidate, busy: row => pending.has(key(row)) };
})();
