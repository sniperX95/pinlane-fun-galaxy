// LA FEUILLE DU JOUR (planning global v4, 2026-10-26), DANS LA CONSOLE.
//
// La console reelle, montee par scripts/planning-v3-fixtures.js sur six
// journees fixes de Fun Galaxy Libramont (calme, normal, pic, vide, ferme,
// pire), l API simulee dans la page (aucun reseau, aucune base), l heure
// figee par page.clock (15:10, 24:20 pour la nuit), un contexte neuf par
// scenario.
//
// L ORACLE n est pas le module teste : ce sont les fonctions de la console
// qui disent ce qu un groupe a reserve (getBowlingWindowsFromReservation,
// getLaserWindowsFromReservation, getStaffFormulaTimedItems), ou il en est
// (getStaffReservationMoments, getStaffTerrainSpan) ; le gate refait seul le
// rangement de la feuille et le compare a ce qu elle ecrit.
//   [F1] une ligne par reservation du jour, dans l ordre de l heure RESERVEE
//        (startTime) puis du nom ; la ligne ecrit cette heure, jamais
//        l accueil conseille 10 min avant (Movsar, 26/10 : « c un conseil on
//        doit pas en faire un truc obligé ») ;
//   [F2] la journee rangee par demi-heure (« met tout par 30 minute ») : un
//        filet franc a la premiere ligne de chaque bloc, une bande un bloc sur
//        deux, une heure repetee ecrite discretement ;
//   [F3] chaque activite dans SA colonne, a SON heure : chaque partie de
//        bowling (et ses pistes), chaque partie de laser, chaque activite a
//        heure d une formule ; les colonnes dans l ordre du papier ;
//   [F4] le nom entier, jamais coupe ; [F5] les personnes et la formule ;
//   [E1] l etat de chaque activite a 15:10 (finie, en cours, a lancer, en
//        retard, a venir) ; [E2] le retard sur la ligne et ses minutes ;
//   [E3] l etat au bout de la ligne et « Arrivé » tant que le groupe est
//        attendu ; la visite finie d un groupe venu, « À encaisser » et son
//        montant (2026-10-27) ;
//   [E4] l etat du centre en tete des colonnes (2026-10-27) : les pistes
//        libres a cette minute, le prochain depart laser du planning laser,
//        les groupes pointes sur une activite ; au telephone, sur une ligne ;
//   [F6] le filet de chaque demi-heure (2026-10-27) : ses groupes et ses
//        personnes, et sous sa colonne le bowling ou le laser plein ;
//   [N1] la barre de l heure entre les heures passees et a venir, la feuille
//        ouverte dessus ; [N2] apres minuit, la soiree de la veille continue ;
//   [G1] « Arrivé » ecrit le pointage, un clic ou Entree ouvre la fiche ;
//   [G2] la recherche (sans accents) et le filtre de statut ; [G3] au
//        planning bowling, chercher grise les autres groupes sans les retirer
//        (une piste prise reste prise) ; [G4] au planning laser, le haut sur
//        une ligne, les groupes pas venus replies sous un bouton qui les
//        compte, la journee entiere a l ecran ;
//   [L1] aucune page plus large que l ecran ; de 1440 a 1920, la feuille du
//        pic sans defilement de cote ; plus etroite, l identite collee a
//        gauche et l etat a droite ; [L2] la feuille se borne a l ecran ;
//        agrandie, elle le prend sans ecraser sa tete ; [L3] au telephone,
//        une carte par groupe ;
//   [J1] centre ferme, journee vide : le bandeau ; [V1] ni degrade, Geist et
//        chiffres tabulaires, rien sous 12 px, la couleur du statut et jamais
//        celle d une activite ; [A1] chaque ligne se lit et s atteint au
//        clavier ;
//   [H1] la minute qui passe ne reecrit pas la feuille (pastille et minutes
//        de retard ecrites en place) et rend ce qu un rendu frais rendrait ;
//   [D1] le focus survit a une reecriture.
// --contre-preuves : chaque regle retiree (en memoire, au texte servi ; le
// disque n est jamais touche) fait rougir sa lettre ; chaque ancre existe une
// fois et une seule.
//   PG_FIXTURES, PG_APPAREILS, PG_MUTATIONS : un sous-ensemble, pour iterer ;
//   PG_BAVARD : les lignes des contre-preuves.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_PLANNING_GLOBAL_PORT || 5191);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PG = 'assets/pinlane-planning-global.js';
const PGC = 'assets/pinlane-planning-global.css';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);

let echecs = 0;
let silence = false;
const rouges = [];
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)}` : ''}`);
  return cond;
}

// ---------------------------------------------------------------------------
// LE SERVEUR : les fichiers du depot, une mutation au plus, en memoire.
// ---------------------------------------------------------------------------
let mutation = null;
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel) t = t.replace(ed.de, () => ed.vers);
  return t;
}

// ---------------------------------------------------------------------------
// DANS LA PAGE : ce que la feuille ecrit, et ce que la console sait.
// ---------------------------------------------------------------------------
function lireFeuille() {
  const box = document.getElementById('globalPlanningBox');
  const wrap = document.getElementById('globalPlanningGridWrap');
  const defile = wrap && wrap.querySelector('.gf-defile');
  const bandeau = wrap && wrap.querySelector('.gf-bandeau');
  const table = defile && defile.querySelector('.gf-t');
  const R = (el) => el.getBoundingClientRect();
  const vu = (el) => Boolean(el) && getComputedStyle(el).display !== 'none' && R(el).width > 0 && R(el).height > 0;
  const tetes = table ? Array.from(table.querySelectorAll('thead th')).map((th) => ({ cle: th.getAttribute('data-gf-cle'), texte: th.textContent.trim(), scope: th.getAttribute('scope'), vide: th.classList.contains('is-vide'), etat: (th.querySelector('.gf-th__etat') || {}).textContent || '', etatVu: vu(th.querySelector('.gf-th__etat')) })) : [];
  const cles = tetes.map((t) => t.cle);
  const lignes = defile ? Array.from(defile.querySelectorAll('tbody > tr')).map((tr) => {
    if (tr.classList.contains('gf-now')) return { now: true, h: (tr.querySelector('.gf-now__h') || {}).textContent || '' };
    if (tr.classList.contains('gf-rien')) return { rien: true, texte: tr.textContent.trim() };
    if (tr.classList.contains('gf-demi')) {
      // (ses cases d activite sont dans l ordre des colonnes de la tete)
      const actives = cles.filter(Boolean);
      const pleins = {};
      tr.querySelectorAll('td.gf-demi__a').forEach((td, i) => { const p = td.querySelector('.gf-demi__plein'); if (p) pleins[actives[i]] = p.textContent; });
      return { demi: true, h: tr.getAttribute('data-gf-demi') || '', texte: ((tr.querySelector('.gf-demi__t') || {}).textContent || '').trim(), pleins, vu: vu(tr) };
    }
    const tds = Array.from(tr.children);
    const nom = tr.querySelector('.gf-nom__t');
    const cases = {};
    tds.forEach((td, i) => {
      if (!td.classList.contains('gf-a')) return;
      cases[cles[i]] = Array.from(td.querySelectorAll('.gf-x')).map((x) => ({ t: (x.querySelector('.gf-x__t b') || {}).textContent || '', d: (x.querySelector('.gf-x__d') || {}).textContent || '', etat: (x.className.match(/is-(fini|encours|avenir|retard|lancer|aplacer)\b/) || [])[1] || '', libre: x.classList.contains('is-libre') }));
    });
    const h = tr.querySelector('td.gf-h');
    const etat = tr.querySelector('td.gf-etat');
    return {
      id: tr.getAttribute('data-gf-id'),
      cls: tr.className,
      tabindex: tr.getAttribute('tabindex'),
      aria: tr.getAttribute('aria-label') || '',
      h: (h.querySelector('b') || {}).textContent || '',
      repete: h.classList.contains('is-repete'),
      retard: (h.querySelector('.gf-h__retard') || {}).textContent || '',
      nom: nom ? nom.textContent : '',
      coupe: nom ? nom.scrollWidth > nom.clientWidth + 1 || nom.scrollHeight > nom.clientHeight + 1 || getComputedStyle(nom).textOverflow === 'ellipsis' : true,
      formule: (tr.querySelector('.gf-formule') || {}).textContent || '',
      pax: (tr.querySelector('td.gf-n b') || {}).textContent || '',
      cases,
      badges: Array.from(etat.querySelectorAll('.gf-b')).map((b) => b.textContent.trim()),
      du: (etat.querySelector('.gf-du') || {}).textContent || '',
      arrive: Boolean(etat.querySelector('[data-gf-arrive]')),
      arriveAria: (etat.querySelector('[data-gf-arrive]') || { getAttribute: () => '' }).getAttribute('aria-label'),
    };
  }) : [];
  const rd = defile ? R(defile) : null;
  const now = defile && defile.querySelector('.gf-now');
  const thead = table && table.querySelector('thead');
  return {
    cles,
    tetes,
    lignes,
    table: table ? { aria: table.getAttribute('aria-label') || '' } : null,
    bandeau: bandeau ? { vu: !bandeau.hidden && vu(bandeau), texte: bandeau.textContent } : null,
    defile: defile ? { vu: vu(defile), sw: defile.scrollWidth, cw: defile.clientWidth, sh: defile.scrollHeight, ch: defile.clientHeight, top: rd.top, bas: rd.bottom, gauche: rd.left, droite: rd.right, st: defile.scrollTop } : null,
    nowY: now ? { haut: R(now).top, bas: R(now).bottom, tete: thead ? R(thead).bottom : rd.top } : null,
    maintenant: defile && defile.querySelector('.gf-maintenant') ? { vu: vu(defile.querySelector('.gf-maintenant')), texte: defile.querySelector('.gf-maintenant').textContent } : null,
    page: { sw: document.scrollingElement.scrollWidth, iw: innerWidth, ih: innerHeight },
    plein: box.classList.contains('expanded'),
    stats: Object.assign({}, window.__gfStats || {}),
  };
}

function lireOracle() {
  /* global todaysReservations, getStaffReservationMoments, getStaffTerrainSpan, getBowlingWindowsFromReservation, getLaserWindowsFromReservation, getStaffFormulaTimedItems, getGroupeProgramme, groupeAJoue, isReservationAwaitingReview, resolveDisplayFormule, currentTimeDecimal, state, todayStr, availabilityBlocksCache, getPlanningWindow, getAvailabilityLaneCount, getBlocagesEnLigne, getBowlingBlockWindows, lpModele, prixDossierConnu, formatMoneyCentimes */
  const res = todaysReservations();
  const moments = getStaffReservationMoments(res);
  // LES PISTES, refaites ici depuis ce qui les prend (reservations, horaires
  // retenus en ligne, blocages), sans passer par les fonctions que la feuille
  // appelle : une piste en maintenance n est pas ouverte, une piste est libre
  // sur [a, b) si rien ne la prend dans cet intervalle.
  const cfg = getPlanningWindow(state.currentDate);
  const pistes = availabilityBlocksCache.loaded && !cfg.closed && getAvailabilityLaneCount() ? (() => {
    const fenetres = [];
    const poser = (src) => src.forEach((it) => getBowlingWindowsFromReservation(it).forEach((w) => (w.lanes || []).forEach((l) => fenetres.push({ l: Number(l), s: Number(w.start), e: Number(w.end) }))));
    poser(res);
    poser(getBlocagesEnLigne(state.currentDate));
    Object.entries(getBowlingBlockWindows(state.currentDate, cfg.open, cfg.close)).forEach(([l, fs]) => fs.forEach((f) => fenetres.push({ l: Number(l), s: Number(f.startH), e: Number(f.endH) })));
    const ouvertes = [];
    for (let l = 1; l <= getAvailabilityLaneCount(); l += 1) if (state.laneStatuses[l] !== 'maintenance') ouvertes.push(l);
    const libresSur = (a, b) => ouvertes.filter((l) => !fenetres.some((f) => f.l === l && f.s < b && f.e > a)).length;
    const now = currentTimeDecimal();
    return {
      ouvertes: ouvertes.length,
      libresMaintenant: state.currentDate === todayStr() && now >= cfg.open && now < cfg.close ? ouvertes.filter((l) => !fenetres.some((f) => f.l === l && f.s <= now && f.e > now)).length : null,
      // (chaque demi-heure de la journee, indexee par b * 2)
      libresParDemi: Array.from({ length: 56 }, (_, i) => libresSur(i / 2, i / 2 + 0.5)),
    };
  })() : null;
  const lp = typeof lpModele === 'function' ? lpModele() : null;
  return {
    jour: state.currentDate,
    aujourdHui: state.currentDate === todayStr(),
    maintenant: currentTimeDecimal(),
    pistes,
    laser: lp ? { capacite: lp.capacite, prochain: lp.prochain ? { t: lp.prochain.t, places: Number(lp.prochain.places) || 0 } : null, departs: lp.departs.map((d) => ({ t: d.t, occupe: d.occupe, places: d.places })) } : null,
    groupes: res.map((r) => {
      const mo = moments.get(String(r.id)) || {};
      const f = r.formuleId && typeof resolveDisplayFormule === 'function' ? resolveDisplayFormule(r.formuleId) : null;
      return {
        id: String(r.id),
        nom: r.name || 'Client',
        pax: Number(r.pax) || 0,
        startTime: r.startTime || '',
        accueil: (r.opsPlan && r.opsPlan.arrivalTime) || '',
        status: r.status,
        absent: Boolean(r.absentAt) && r.status !== 'paid',
        aValider: typeof isReservationAwaitingReview === 'function' && isReservationAwaitingReview(r),
        etat: mo.etat || 'upcoming',
        late: Boolean(mo.late),
        span: getStaffTerrainSpan(r),
        present: r.status === 'arrived' || r.status === 'paid' || (typeof groupeAJoue === 'function' && groupeAJoue(r)),
        // (l argent du dossier, quand la visite d un groupe venu est finie)
        du: r.status !== 'paid' && r.status !== 'cancelled' && (r.status === 'arrived' || (typeof groupeAJoue === 'function' && groupeAJoue(r))) && prixDossierConnu(r) ? formatMoneyCentimes(r.price) : '',
        formule: r.formuleId || r.type === 'formule' ? String((f && f.name) || r.label || 'Formule').trim() : '',
        surMesure: r.type === 'custom' || r.surMesure === true,
        bowling: getBowlingWindowsFromReservation(r).map((w) => ({ start: w.start, end: w.end, pistes: (w.lanes || []).filter(Number.isFinite) })),
        laser: getLaserWindowsFromReservation(r).map((w) => ({ start: w.start, end: w.end })),
        aPlacer: getGroupeProgramme(r).filter((e) => e.aPlacer).length,
        faits: getGroupeProgramme(r).filter((e) => e.fait && e.start != null).map((e) => ({ id: e.activityId, start: e.start })),
        timed: getStaffFormulaTimedItems(r).map((it) => ({ id: it.activityId, start: it.start, end: it.end })),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// LE RANGEMENT DU PAPIER, refait par le gate.
// ---------------------------------------------------------------------------
const COLONNE = { bowling: 'bowling', duckpin_bowling: 'duckpin', laser_game: 'laser', fun_run: 'funrun', arcade_time: 'arcades', arcade_credit: 'arcades', minigolf_blacklight: 'minigolf', golf_oclock: 'oclock', playground: 'plaine', billards: 'billard' };
const ORDRE_PAPIER = ['bowling', 'duckpin', 'laser', 'funrun', 'arcades', 'minigolf', 'oclock', 'plaine', 'billard'];
const colonneDe = (id) => COLONNE[id] || `a-${id}`;
const p2 = (n) => String(n).padStart(2, '0');
function hhmm(t) { const m = Math.round(t * 60); return `${p2(Math.floor(m / 60) % 24)}:${p2(m % 60)}`; }
function minutesDe(h) { const m = /^(\d{1,2}):(\d{2})/.exec(String(h || '')); return m ? Number(m[1]) + Number(m[2]) / 60 : null; }
function pistes(liste) {
  const l = [...new Set(liste)].sort((a, b) => a - b);
  const m = [];
  l.forEach((p) => { const d = m[m.length - 1]; if (d && p === d[1] + 1) d[1] = p; else m.push([p, p]); });
  return m.map((x) => (x[0] === x[1] ? String(x[0]) : `${x[0]}-${x[1]}`)).join(', ');
}
function retardCourt(n) { return n < 60 ? `+${n} min` : `+${Math.floor(n / 60)}h${p2(n % 60)}`; }
function heureDe(g) { const d = minutesDe(g.startTime); return d == null ? g.span.start : d; }

// L etat attendu d une activite a heure (la regle de la feuille, redite).
function etatAttendu(g, w, colonne, maintenant) {
  if (g.etat === 'done' || g.etat === 'absent' || g.etat === 'closing') return 'fini';
  if (g.faits.some((f) => colonneDe(f.id) === colonne && Math.abs(f.start - w.start) < 0.02)) return 'fini';
  if (w.end <= maintenant + 1e-6) return 'fini';
  if (w.start <= maintenant + 1e-6) return g.present ? 'encours' : g.late ? 'retard' : 'avenir';
  if (g.present && w.start - maintenant <= 5 / 60 + 1e-6) return 'lancer';
  return 'avenir';
}

// ---------------------------------------------------------------------------
// LES SCENARIOS
// ---------------------------------------------------------------------------
const ici = (s) => `${s.fixture} ${s.appareil}${s.theme === 'light' ? ' clair' : ''}${s.plein ? ' agrandie' : ''}${s.heure ? ' ' + s.heure : ''}`;
async function monter(browser, s) {
  return FX.monter(browser, { fixture: s.fixture, appareil: s.appareil, theme: s.theme || 'dark', plein: Boolean(s.plein), heure: s.heure || '', port: PORT });
}
async function sansErreur(erreurs, label) { ok(erreurs.length === 0, `[A1] ${label} : aucune erreur JS`, erreurs.slice(0, 3)); }

// LA STRUCTURE, sur chaque ecran.
async function structure(page, s, label) {
  const f = await page.evaluate(lireFeuille);
  const o = await page.evaluate(lireOracle);
  const groupes = f.lignes.filter((l) => l.id);
  const parId = new Map(o.groupes.map((g) => [g.id, g]));
  const telephone = FX.APPAREILS[s.appareil].viewport.width < 640;

  // [F1] une ligne par reservation, l ordre et l heure du papier
  const attendus = o.groupes.slice().sort((a, b) => heureDe(a) - heureDe(b) || a.nom.localeCompare(b.nom, 'fr'));
  ok(groupes.length === attendus.length && groupes.every((l, i) => l.id === attendus[i].id), `[F1] ${label} : une ligne par reservation, dans l ordre de l heure reservee puis du nom`, { lignes: groupes.length, attendues: attendus.length, premier: groupes.findIndex((l, i) => !attendus[i] || l.id !== attendus[i].id) });
  const heuresFausses = groupes.filter((l) => l.h !== hhmm(heureDe(parId.get(l.id))));
  ok(heuresFausses.length === 0, `[F1] ${label} : chaque ligne ecrit l heure reservee`, heuresFausses.slice(0, 3).map((l) => ({ nom: l.nom, ecrit: l.h, reservee: parId.get(l.id).startTime })));
  const conseil = o.groupes.filter((g) => g.accueil && g.accueil !== g.startTime);
  ok(conseil.length > 0 && conseil.every((g) => groupes.find((l) => l.id === g.id).h === hhmm(heureDe(g))), `[F1] ${label} : l accueil conseille 10 min avant n est jamais l heure de la ligne (${conseil.length} groupes concernes)`);

  // [F2] la demi-heure
  let bloc = null; let bande = false; let avant = null;
  const fautesBloc = [];
  groupes.forEach((l) => {
    const t = heureDe(parId.get(l.id));
    const b = Math.floor(t * 2 + 1e-6);
    const nouveau = b !== bloc;
    if (nouveau && bloc !== null) bande = !bande;
    bloc = b;
    const repete = avant !== null && Math.abs(avant - t) < 1 / 120 && !l.retard;
    avant = t;
    if (/\bis-bloc\b/.test(l.cls) !== nouveau || /\bis-bande\b/.test(l.cls) !== bande || l.repete !== repete) fautesBloc.push({ nom: l.nom, h: l.h, cls: l.cls, repete: l.repete });
  });
  ok(fautesBloc.length === 0, `[F2] ${label} : un filet a chaque demi-heure, une bande un bloc sur deux, l heure repetee discrete`, fautesBloc.slice(0, 3));

  // [F6] le filet de chaque demi-heure : juste avant la premiere ligne du
  // bloc, ses groupes et ses personnes ; sous Bowling « complet » quand
  // aucune piste ouverte n est libre de toute la demi-heure ; sous Laser le
  // pire depart de la demi-heure, plein ou en trop.
  const blocs = new Map();
  groupes.forEach((l) => { const g = parId.get(l.id); const b = Math.floor(heureDe(g) * 2 + 1e-6) / 2; const c = blocs.get(b) || { n: 0, pers: 0 }; c.n += 1; c.pers += g.pax; blocs.set(b, c); });
  const demis = f.lignes.filter((x) => x.demi);
  const fautesDemi = demis.length === blocs.size ? [] : [{ demis: demis.length, blocs: blocs.size }];
  let blocVu = null;
  f.lignes.forEach((x, i) => {
    if (!x.id) return;
    const b = Math.floor(heureDe(parId.get(x.id)) * 2 + 1e-6) / 2;
    if (b === blocVu) return;
    blocVu = b;
    const d = f.lignes[i - 1];
    const c = blocs.get(b);
    const texte = `${c.n} ${c.n > 1 ? 'groupes' : 'groupe'} · ${c.pers} pers.`;
    const pleins = {};
    if (o.pistes && o.pistes.ouvertes && f.cles.includes('bowling') && o.pistes.libresParDemi[b * 2] === 0) pleins.bowling = 'complet';
    if (o.laser && f.cles.includes('laser')) {
      const pire = o.laser.departs.filter((dp) => dp.t >= b - 1e-6 && dp.t < b + 0.5 - 1e-6 && dp.occupe > 0).sort((a, z) => a.places - z.places)[0];
      if (pire && pire.places <= 0) pleins.laser = pire.places < 0 ? `${-pire.places} de trop` : 'complet';
    }
    if (!d || !d.demi || d.h !== hhmm(b) || d.texte !== texte || JSON.stringify(d.pleins) !== JSON.stringify(pleins) || !d.vu) fautesDemi.push({ h: hhmm(b), ecrit: d && d.demi ? { h: d.h, texte: d.texte, pleins: d.pleins, vu: d.vu } : null, attendu: { texte, pleins } });
  });
  ok(fautesDemi.length === 0 && (s.fixture !== 'pic' || demis.some((d) => Object.keys(d.pleins).length)), `[F6] ${label} : un filet en tete de chaque demi-heure, ses groupes et ses personnes, le bowling ou le laser plein sous sa colonne`, fautesDemi.slice(0, 3));

  // [F3] les colonnes du papier, chaque activite a son heure
  const actives = f.cles.filter(Boolean);
  const papier = actives.filter((c) => !c.startsWith('a-'));
  ok(papier.every((c, i) => i === 0 || ORDRE_PAPIER.indexOf(papier[i - 1]) < ORDRE_PAPIER.indexOf(c)) && actives.slice(papier.length).every((c) => c.startsWith('a-')), `[F3] ${label} : les colonnes dans l ordre du papier, les activites hors papier apres`, actives);
  const fautesCase = [];
  for (const l of groupes) {
    const g = parId.get(l.id);
    const t = heureDe(g);
    const bowling = (l.cases.bowling || []);
    const attenduB = g.bowling.slice().sort((a, b) => a.start - b.start);
    if (bowling.length !== attenduB.length || attenduB.some((w, i) => bowling[i].t !== hhmm(w.start) || !bowling[i].d.startsWith(w.pistes.length ? `P${pistes(w.pistes)}` : 'pistes ?'))) fautesCase.push({ nom: l.nom, col: 'bowling', ecrit: bowling.map((x) => x.t + ' ' + x.d), attendu: attenduB.map((w) => hhmm(w.start) + ' P' + pistes(w.pistes)) });
    const laser = (l.cases.laser || []).filter((x) => x.etat !== 'aplacer').map((x) => x.t);
    const attenduL = [...new Set(g.laser.map((w) => Math.round(w.start * 60)))].sort((a, b) => a - b).map((m) => hhmm(m / 60));
    if (laser.join() !== attenduL.join() || (l.cases.laser || []).filter((x) => x.etat === 'aplacer').length !== g.aPlacer) fautesCase.push({ nom: l.nom, col: 'laser', ecrit: laser, attendu: attenduL, aPlacer: g.aPlacer });
    for (const it of g.timed) {
      if (['bowling', 'laser_game', 'service_drinks', 'arcade_credit', 'party_table'].includes(it.id)) continue;
      const col = colonneDe(it.id);
      const chips = l.cases[col] || [];
      const desLeDebut = it.id === 'playground' && Math.abs(it.start - t) <= 0.25 + 1e-6;
      if (desLeDebut ? !chips.some((x) => /enf\.$/.test(x.t)) : !chips.some((x) => x.t === hhmm(it.start))) fautesCase.push({ nom: l.nom, col, ecrit: chips.map((x) => x.t), attendu: hhmm(it.start) });
    }
  }
  ok(fautesCase.length === 0, `[F3] ${label} : chaque bowling (et ses pistes), chaque partie de laser, chaque activite a heure dans sa colonne, a son heure`, fautesCase.slice(0, 3));

  // [F4] le nom entier ; [F5] les personnes et la formule
  const coupes = groupes.filter((l) => l.nom !== parId.get(l.id).nom || l.coupe);
  ok(coupes.length === 0, `[F4] ${label} : chaque nom est ecrit entier, jamais coupe`, coupes.slice(0, 3).map((l) => l.nom));
  if (!telephone) {
    const formules = groupes.filter((l) => {
      const g = parId.get(l.id);
      const n = /^formule\s*(\d+)$/i.exec(g.formule);
      const attendu = g.formule ? (n ? `F${n[1]}` : g.formule) : g.surMesure ? 'Sur mesure' : '';
      return Number(l.pax) !== g.pax || l.formule.toLowerCase() !== attendu.toLowerCase();
    });
    ok(formules.length === 0, `[F5] ${label} : les personnes et la formule (F4 pour « FORMULE 4 »)`, formules.slice(0, 3).map((l) => ({ nom: l.nom, pax: l.pax, formule: l.formule })));
  }

  // [E1] [E2] [E3] l etat, a l heure figee du jour meme
  if (!s.heure || s.heure === '15:10') {
    const fautesEtat = [];
    for (const l of groupes) {
      const g = parId.get(l.id);
      const verifier = (col, w, chip) => { const e = etatAttendu(g, w, col, o.maintenant); if (!chip || chip.etat !== e) fautesEtat.push({ nom: l.nom, col, h: hhmm(w.start), ecrit: chip && chip.etat, attendu: e }); };
      g.bowling.forEach((w) => verifier('bowling', w, (l.cases.bowling || []).find((x) => x.t === hhmm(w.start))));
      const parties = new Map();
      g.laser.forEach((w) => { const k = Math.round(w.start * 60); const p = parties.get(k); if (p) p.end = Math.max(p.end, w.end); else parties.set(k, { start: w.start, end: w.end }); });
      parties.forEach((w) => verifier('laser', w, (l.cases.laser || []).find((x) => x.t === hhmm(w.start))));
      g.timed.filter((it) => !['bowling', 'laser_game', 'service_drinks', 'arcade_credit', 'party_table', 'playground'].includes(it.id)).forEach((it) => {
        const w = { start: it.start, end: Math.max(it.end, it.start + 0.25) };
        verifier(colonneDe(it.id), w, (l.cases[colonneDe(it.id)] || []).find((x) => x.t === hhmm(it.start) && !x.libre));
      });
    }
    ok(fautesEtat.length === 0, `[E1] ${label} : chaque activite a heure dit ou elle en est a ${hhmm(o.maintenant)} (finie, en cours, a lancer, en retard, a venir)`, fautesEtat.slice(0, 4));
    const fautesRetard = groupes.filter((l) => {
      const g = parId.get(l.id);
      const attendu = g.late ? retardCourt(Math.max(1, Math.round((o.maintenant - g.span.start) * 60))) : '';
      return /\bis-retard\b/.test(l.cls) !== g.late || l.retard !== attendu;
    });
    ok(fautesRetard.length === 0 && (s.fixture !== 'pic' || groupes.some((l) => l.retard)), `[E2] ${label} : chaque groupe en retard le dit sous son heure, avec ses minutes`, fautesRetard.slice(0, 3).map((l) => ({ nom: l.nom, retard: l.retard, cls: l.cls })));
    const fautesEtatLigne = groupes.filter((l) => {
      const g = parId.get(l.id);
      const statut = g.etat === 'absent' || g.absent ? 'Pas venu' : g.status === 'paid' ? 'Payé' : g.status === 'arrived' ? 'Arrivé' : '';
      const peut = g.etat === 'upcoming' && !['paid', 'arrived'].includes(g.status) && !g.absent;
      return (statut ? l.badges[0] !== statut : l.badges.some((b) => /^(Pas venu|Payé|Arrivé)$/.test(b)))
        || l.badges.includes('À valider') !== g.aValider
        || l.badges.includes('À clôturer') !== (g.etat === 'closing' && !g.du)
        || l.badges.includes('À encaisser') !== (g.etat === 'closing' && Boolean(g.du))
        || l.du !== (g.etat === 'closing' ? g.du : '')
        || (g.etat === 'closing' && g.du && !l.aria.includes(`à encaisser ${g.du}`))
        || l.arrive !== peut
        || (peut && l.arriveAria !== `Pointer ${g.nom} arrivé`);
    });
    ok(fautesEtatLigne.length === 0 && (s.fixture !== 'pic' || (groupes.some((l) => l.arrive) && groupes.some((l) => l.du))), `[E3] ${label} : le statut, « À valider », « À clôturer » ou « À encaisser » et son montant, « Arrivé » tant que le groupe est attendu`, fautesEtatLigne.slice(0, 3).map((l) => ({ nom: l.nom, badges: l.badges, du: l.du, attendu: parId.get(l.id).du, arrive: l.arrive })));

    // [E4] l etat du centre en tete des colonnes, a cette minute
    const attenduEtat = {};
    if (o.pistes && o.pistes.libresMaintenant != null) { const n = o.pistes.libresMaintenant; attenduEtat.bowling = n ? `${n} ${n > 1 ? 'libres' : 'libre'}` : 'complet'; }
    if (o.laser && o.laser.prochain) { const p = o.laser.prochain; attenduEtat.laser = `${hhmm(p.t)}${p.places > 0 ? ` · ${p.places} ${p.places > 1 ? 'places' : 'place'}` : ' complet'}`; }
    const surPlace = new Map();
    o.groupes.forEach((g) => {
      if (!g.present || g.etat === 'done' || g.etat === 'absent') return;
      g.timed.filter((it) => !['bowling', 'laser_game', 'service_drinks', 'arcade_credit', 'party_table', 'playground'].includes(it.id)).forEach((it) => {
        if (it.start > o.maintenant + 1e-6 || it.end <= o.maintenant + 1e-6) return;
        const col = colonneDe(it.id);
        if (!surPlace.has(col)) surPlace.set(col, new Set());
        surPlace.get(col).add(g.id);
      });
    });
    surPlace.forEach((ids, col) => { if (!attenduEtat[col]) attenduEtat[col] = `${ids.size} ${ids.size > 1 ? 'groupes' : 'groupe'}`; });
    const fautesTete = f.tetes.filter((t) => t.cle && t.cle !== 'plaine' && t.etat !== (attenduEtat[t.cle] || '')).map((t) => ({ cle: t.cle, ecrit: t.etat, attendu: attenduEtat[t.cle] || '' }));
    const plaine = f.tetes.find((t) => t.cle === 'plaine');
    if (plaine && plaine.etat && !/^\d+ enf\.$/.test(plaine.etat)) fautesTete.push({ cle: 'plaine', ecrit: plaine.etat });
    const tetesVues = telephone || f.tetes.filter((t) => t.etat).every((t) => t.etatVu);
    const ligne = telephone
      ? Boolean(f.maintenant && f.maintenant.vu) && ['bowling', 'laser'].every((c) => !attenduEtat[c] || f.maintenant.texte.includes(`${c === 'bowling' ? 'Bowling' : 'Laser'} ${attenduEtat[c]}`))
      : !f.maintenant || !f.maintenant.vu;
    ok(fautesTete.length === 0 && tetesVues && ligne && (s.fixture !== 'pic' || Boolean(attenduEtat.bowling && attenduEtat.laser)), `[E4] ${label} : l etat du centre en tete des colonnes (pistes libres, prochain depart laser, groupes sur l activite)${telephone ? ', sur une ligne au-dessus des cartes' : ''}`, { fautesTete: fautesTete.slice(0, 4), tetesVues, ligne, maintenant: f.maintenant, attendu: attenduEtat });

    // [N1] la barre de l heure, la feuille ouverte dessus
    const idx = f.lignes.findIndex((l) => l.now);
    const avantNow = f.lignes.slice(0, idx).filter((l) => l.id);
    const apresNow = f.lignes.slice(idx + 1).filter((l) => l.id);
    ok(f.lignes.filter((l) => l.now).length === 1 && f.lignes[idx].h === hhmm(o.maintenant) && avantNow.every((l) => heureDe(parId.get(l.id)) <= o.maintenant + 1e-6) && apresNow.every((l) => heureDe(parId.get(l.id)) > o.maintenant), `[N1] ${label} : une barre de l heure, ${hhmm(o.maintenant)}, entre les heures passees et a venir`, { idx, h: idx >= 0 ? f.lignes[idx].h : null });
    if (!telephone && f.defile.sh > f.defile.ch + 40 && avantNow.length > 2) {
      const visible = f.nowY && f.nowY.haut >= f.nowY.tete - 1 && f.nowY.bas <= f.defile.bas + 1;
      ok(visible && f.defile.st > 0, `[N1] ${label} : la feuille s ouvre sur l heure qu il est (barre visible sous la tete)`, { nowY: f.nowY, defile: f.defile });
    }
  }

  // [L1] la largeur
  ok(f.page.sw <= f.page.iw, `[L1] ${label} : la page n est pas plus large que l ecran`, f.page);
  if (s.fixture === 'pic' && ['grand', 'ordinateur'].includes(s.appareil)) ok(f.defile.sw <= f.defile.cw + 1, `[L1] ${label} : la feuille tient en largeur, sans defilement de cote`, f.defile);
  if (!telephone && f.defile.sw > f.defile.cw + 1) {
    // (l heure se lit au bout du defilement, l etat a son debut : la ou elles
    // seraient sorties de la vue sans etre collees)
    const colle = await page.evaluate(() => {
      const d = document.querySelector('#globalPlanningGridWrap .gf-defile');
      const tr = d.querySelector('tbody tr.gf-r');
      const rd = d.getBoundingClientRect();
      d.scrollLeft = 0;
      const droite = Math.round(rd.left + d.clientWidth - tr.querySelector('td.gf-etat').getBoundingClientRect().right);
      d.scrollLeft = d.scrollWidth;
      const gauche = Math.round(tr.querySelector('td.gf-h').getBoundingClientRect().left - rd.left);
      d.scrollLeft = 0;
      return { gauche, droite };
    });
    ok(Math.abs(colle.gauche) <= 1 && Math.abs(colle.droite) <= 1, `[L1] ${label} : defilee de cote, l heure reste collee a gauche et l etat a droite`, colle);
  }
  // [L2] la hauteur
  if (!telephone) {
    if (s.plein) {
      const p = await page.evaluate(() => { const b = document.getElementById('globalPlanningBox').getBoundingClientRect(); const h = document.querySelector('#globalPlanningBox .planning-head').getBoundingClientRect(); return { bas: b.bottom, tete: h.height, ih: innerHeight }; });
      ok(f.plein && p.bas <= p.ih + 1 && p.tete >= 40 && f.defile.ch >= 200, `[L2] ${label} : agrandie, la feuille prend l ecran sans ecraser sa tete`, { ...p, ch: f.defile.ch });
    } else {
      const p = await page.evaluate(() => { window.scrollTo(0, 0); const d = document.querySelector('#globalPlanningGridWrap .gf-defile').getBoundingClientRect(); return { haut: d.top, bas: d.bottom, ih: innerHeight }; });
      const borne = p.haut > p.ih / 2 ? p.bas - p.haut <= p.ih : p.bas <= p.ih + 1;
      ok(borne && f.defile.ch >= Math.min(320, f.defile.sh) && (f.defile.sh <= f.defile.ch + 1 || f.defile.sh > f.defile.ch), `[L2] ${label} : la feuille se borne a l ecran et defile en elle-meme`, { ...p, ch: f.defile.ch, sh: f.defile.sh });
    }
  }
  // [L3] au telephone, une carte par groupe
  if (telephone) {
    const c = await page.evaluate(() => {
      const tr = document.querySelector('#globalPlanningGridWrap tbody tr.gf-r');
      const cs = (el) => getComputedStyle(el);
      const a = tr.querySelector('td.gf-a:not(.is-vide)');
      return { grille: cs(tr).display, tete: cs(document.querySelector('#globalPlanningGridWrap thead')).display, formule: cs(tr.querySelector('td.gf-f')).display, pax: cs(tr.querySelector('td.gf-n')).display, meta: tr.querySelector('.gf-nom__meta').textContent, metaVu: cs(tr.querySelector('.gf-nom__meta')).display, avant: a ? getComputedStyle(a, '::before').content : '', titre: a ? a.getAttribute('data-gf-titre') : '' };
    });
    ok(c.grille === 'grid' && c.tete === 'none' && c.formule === 'none' && c.pax === 'none' && c.metaVu !== 'none' && /\d+ pers\./.test(c.meta) && c.avant === `"${c.titre}"`, `[L3] ${label} : une carte par groupe, les personnes et la formule sous le nom, chaque activite nommee`, c);
  }

  // [V1] ni degrade, la police, rien sous 12 px, la couleur du statut
  const v = await page.evaluate(() => {
    const box = document.getElementById('globalPlanningBox');
    const tous = Array.from(box.querySelectorAll('.gf *'));
    const degrades = tous.filter((el) => getComputedStyle(el).backgroundImage !== 'none').map((el) => el.className).slice(0, 3);
    const petits = [];
    // (la feuille et sa legende ; la bascule du plein ecran est commune aux trois plannings)
    for (const racine of [box.querySelector('.gf'), box.querySelector('.gf-legende')].filter(Boolean)) {
    const marcheur = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT);
    while (marcheur.nextNode()) {
      const n = marcheur.currentNode;
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      const taille = parseFloat(getComputedStyle(el).fontSize);
      if (taille < 12 - 1e-6) petits.push(`${el.className || el.tagName} ${taille}px « ${n.textContent.trim().slice(0, 20)} »`);
    }
    }
    const t = box.querySelector('.gf-t');
    const css = t ? getComputedStyle(t) : null;
    // (deux activites a venir d une meme ligne : le meme fond, quelle que soit l activite)
    const teintes = [];
    box.querySelectorAll('tr.gf-r').forEach((tr) => {
      const fonds = new Map();
      tr.querySelectorAll('td.gf-a').forEach((td) => {
        const x = td.querySelector('.gf-x.is-avenir:not(.is-libre):not(.is-credit)');
        if (x) fonds.set(td.getAttribute('data-gf-titre'), getComputedStyle(x).backgroundColor);
      });
      if (new Set(fonds.values()).size > 1) teintes.push([tr.getAttribute('data-gf-id'), Object.fromEntries(fonds)]);
    });
    return { degrades, petits: petits.slice(0, 4), police: css ? css.fontFamily : '', chiffres: css ? css.fontVariantNumeric : '', teintes: teintes.slice(0, 2) };
  });
  ok(v.degrades.length === 0 && /geist/i.test(v.police) && !/mono/i.test(v.police) && /tabular-nums/.test(v.chiffres), `[V1] ${label} : ni degrade, Geist (pas Mono), chiffres tabulaires`, v);
  ok(v.petits.length === 0, `[V1] ${label} : aucun texte sous 12 px`, v.petits);
  ok(v.teintes.length === 0, `[V1] ${label} : la couleur est celle du statut, jamais celle d une activite`, v.teintes);

  // [A1] chaque ligne se lit et s atteint au clavier
  const aria = groupes.filter((l) => l.tabindex !== '0' || !l.aria.startsWith(`${l.h}, ${parId.get(l.id).nom}, `));
  ok(aria.length === 0 && f.table && f.table.aria && f.tetes.every((t) => t.scope === 'col'), `[A1] ${label} : chaque ligne s atteint au clavier et se lit d une traite (heure, nom, ...) ; les tetes sont des en-tetes`, aria.slice(0, 2).map((l) => l.aria.slice(0, 80)));
}

// [N2] APRES MINUIT
async function nuit(page, s, label) {
  const f = await page.evaluate(lireFeuille);
  const groupes = f.lignes.filter((l) => l.id);
  const idx = f.lignes.findIndex((l) => l.now);
  const n = FX.lireFixture(s.fixture).staffState.reservations.length;
  const nocturne = groupes.find((l) => /Nocturne des étudiants/.test(l.nom));
  const minuit = groupes.find((l) => /Laser de minuit/.test(l.nom));
  const soir = groupes.find((l) => l.h === '21:00' && (l.cases.bowling || []).length);
  ok(groupes.length === n && idx === f.lignes.length - 1 && f.lignes[idx].h === '00:20', `[N2] ${label} : la soiree de la veille reste, la barre de 00:20 sous sa derniere ligne`, { groupes: groupes.length, n, idx, h: idx >= 0 ? f.lignes[idx].h : null });
  ok(nocturne && /\bis-retard\b/.test(nocturne.cls) && nocturne.retard === '+50 min' && nocturne.cases.bowling[0].etat === 'retard', `[N2] ${label} : la nocturne de 23:30 est en retard de 50 min, son bowling n est pas fini`, nocturne && { retard: nocturne.retard, bowling: nocturne.cases.bowling });
  ok(minuit && minuit.cases.laser.map((x) => `${x.t}:${x.etat}`).join() === '23:30:fini,00:00:retard', `[N2] ${label} : le laser de minuit, 23:30 fini, 00:00 en retard`, minuit && minuit.cases.laser);
  ok(soir && soir.cases.bowling.every((x) => x.etat === 'fini'), `[N2] ${label} : le bowling de 21:00 est fini`, soir && soir.cases.bowling);
}

// [J1] centre ferme, journee vide
async function sansGroupe(page, s, label) {
  const f = await page.evaluate(lireFeuille);
  const attendu = s.fixture === 'ferme' ? /^Centre fermé ce jour-là/ : /^Aucune réservation ce jour-là$/;
  ok(f.bandeau && f.bandeau.vu && attendu.test(f.bandeau.texte) && f.lignes.length === 0 && !f.defile.vu, `[J1] ${label} : le bandeau « ${s.fixture === 'ferme' ? 'Centre fermé ce jour-là' : 'Aucune réservation ce jour-là'} », aucune ligne`, { bandeau: f.bandeau, lignes: f.lignes.length });
}

// [G1] [G2] [H1] [D1] LES GESTES, au pic a 1440
async function gestes(browser) {
  const s = { fixture: 'pic', appareil: 'ordinateur' };
  const label = ici(s);
  const { ctx, page, erreurs } = await monter(browser, s);
  try {
    // [H1] la minute qui passe
    const avant = await page.evaluate(() => {
      const d = document.querySelector('#globalPlanningGridWrap .gf-defile');
      window.__ecritures0 = window.__gfStats.ecritures;
      window.__ligne0 = d.querySelector('tr.gf-r');
      return { retards: Array.from(d.querySelectorAll('[data-gf-retard]')).map((n) => n.textContent) };
    });
    await page.clock.setFixedTime(FX.instant(FX.lireFixture('pic').staffState.date, '15:11'));
    await page.evaluate(() => tickHorlogeStaff());
    await FX.repos(page, 150);
    const apres = await page.evaluate(() => {
      const wrap = document.getElementById('globalPlanningGridWrap');
      const d = wrap.querySelector('.gf-defile');
      const r = { ecritures: window.__gfStats.ecritures - window.__ecritures0, memeLigne: d.querySelector('tr.gf-r') === window.__ligne0, pastille: d.querySelector('.gf-now__h').textContent, retards: Array.from(d.querySelectorAll('[data-gf-retard]')).map((n) => n.textContent), html: d.innerHTML };
      wrap._gfHtml = null;
      window.renderGlobalPlanning(wrap);
      r.frais = d.innerHTML;
      return r;
    });
    const plusUne = (t) => { const m = /^\+(?:(\d+) min|(\d+)h(\d{2}))$/.exec(t); const n = m ? (m[1] ? Number(m[1]) : Number(m[2]) * 60 + Number(m[3])) : NaN; return retardCourt(n + 1); };
    ok(apres.ecritures === 0 && apres.memeLigne && apres.pastille === '15:11' && avant.retards.length > 0 && apres.retards.join() === avant.retards.map(plusUne).join(), `[H1] ${label} : la minute ne reecrit pas la feuille ; la pastille et les minutes de retard avancent en place`, { ecritures: apres.ecritures, memeLigne: apres.memeLigne, pastille: apres.pastille, avant: avant.retards.slice(0, 3), apres: apres.retards.slice(0, 3) });
    ok(apres.html === apres.frais, `[H1] ${label} : la feuille apres la minute est celle d un rendu frais a la meme heure`);

    // [D1] le focus survit a une reecriture (un autre groupe change de statut)
    const d1 = await page.evaluate(() => {
      const d = document.querySelector('#globalPlanningGridWrap .gf-defile');
      const cible = d.querySelectorAll('tr.gf-r')[3];
      cible.focus();
      const id = cible.getAttribute('data-gf-id');
      const autre = state.reservations.find((r) => String(r.id) !== id && r.status === 'pending');
      autre.status = 'arrived';
      const e0 = window.__gfStats.ecritures;
      renderGlobalPlanningSurface();
      return { id, reecrit: window.__gfStats.ecritures > e0, focus: document.activeElement && document.activeElement.getAttribute('data-gf-id'), neuf: document.activeElement !== cible };
    });
    ok(d1.reecrit && d1.neuf && d1.focus === d1.id, `[D1] ${label} : apres une reecriture, le focus est sur la meme ligne`, d1);

    // [G1] « Arrivé » ecrit le pointage
    const id = await page.evaluate(() => { const b = document.querySelector('#globalPlanningGridWrap tr.is-retard [data-gf-arrive]'); return b && b.getAttribute('data-gf-arrive'); });
    await page.locator(`#globalPlanningGridWrap [data-gf-arrive="${id}"]`).click();
    await FX.repos(page, 600);
    const g1 = await page.evaluate((id) => {
      const tr = document.querySelector(`#globalPlanningGridWrap tr[data-gf-id="${id}"]`);
      return { patchs: window.__FIXTURE__.patchs.filter((p) => p.status === 'arrived').map((p) => String(p.id)), cls: tr && tr.className, bouton: Boolean(tr && tr.querySelector('[data-gf-arrive]')), fiche: !document.getElementById('posOverlay').classList.contains('hidden'), focus: Boolean(tr && tr.contains(document.activeElement)) };
    }, id);
    ok(id && g1.patchs.join() === id && /\bt-arr\b/.test(g1.cls) && !g1.bouton && !g1.fiche && g1.focus, `[G1] ${label} : « Arrivé » ecrit le pointage, la ligne passe a l ambre, la fiche ne s ouvre pas, le focus reste sur la ligne`, { id, ...g1 });

    // [G1] un clic sur la ligne ouvre la fiche ; Entree aussi
    const autre = await page.evaluate(() => Array.from(document.querySelectorAll('#globalPlanningGridWrap tr.gf-r')).map((tr) => tr.getAttribute('data-gf-id'))[6]);
    await page.locator(`#globalPlanningGridWrap tr[data-gf-id="${autre}"] .gf-nom__t`).click();
    await FX.repos(page, 400);
    const clic = await page.evaluate(() => ({ fiche: !document.getElementById('posOverlay').classList.contains('hidden'), id: state.selectedRes && String(state.selectedRes.id) }));
    await page.evaluate(() => closePos());
    await FX.repos(page, 300);
    const troisieme = await page.evaluate(() => { const tr = document.querySelectorAll('#globalPlanningGridWrap tr.gf-r')[9]; tr.focus(); return tr.getAttribute('data-gf-id'); });
    await page.keyboard.press('Enter');
    await FX.repos(page, 400);
    const entree = await page.evaluate(() => ({ fiche: !document.getElementById('posOverlay').classList.contains('hidden'), id: state.selectedRes && String(state.selectedRes.id) }));
    await page.evaluate(() => closePos());
    ok(clic.fiche && clic.id === autre && entree.fiche && entree.id === troisieme, `[G1] ${label} : un clic sur la ligne ouvre la fiche du groupe, Entree aussi`, { clic, entree, autre, troisieme });

    // [G2] la recherche, sans accents ; le filtre de statut
    const chercher = (q) => page.evaluate((q) => { applyStaffSearch(q, { immediate: true }); return Array.from(document.querySelectorAll('#globalPlanningGridWrap tr.gf-r .gf-nom__t')).map((n) => n.textContent).concat(Array.from(document.querySelectorAll('#globalPlanningGridWrap tr.gf-rien')).map((n) => '#rien ' + n.textContent.trim())); }, q);
    // [L2] chercher ne change pas la hauteur de la feuille : la liste du
    // dessous ne bouge pas (rush-status, 2026-10-26)
    const hauteur = () => page.evaluate(() => ({ feuille: Math.round(document.querySelector('#globalPlanningGridWrap .gf-defile').getBoundingClientRect().height), liste: Math.round(document.getElementById('staffTableBox').getBoundingClientRect().top + window.scrollY) }));
    const h0 = await hauteur();
    const noah = await chercher('noah');
    const h1 = await hauteur();
    ok(h1.feuille === h0.feuille && h1.liste === h0.liste, `[L2] ${label} : chercher ne change pas la hauteur de la feuille, la liste du dessous ne bouge pas`, { avant: h0, apres: h1 });
    const gerard = await chercher('gerard');
    const rien = await chercher('zzzz');
    await chercher('');
    ok(noah.length >= 1 && noah.every((n) => /noah/i.test(n)) && gerard.length >= 1 && gerard.every((n) => /Gérard/.test(n)) && rien.length === 1 && rien[0] === '#rien Aucun groupe ne correspond à cette recherche.', `[G2] ${label} : la recherche trouve « noah », « gerard » (Gérard), et le dit quand rien ne correspond`, { noah, gerard, rien });
    const filtre = await page.evaluate(() => {
      setStaffStatusFilter('late');
      const lignes = Array.from(document.querySelectorAll('#globalPlanningGridWrap tr.gf-r')).map((tr) => tr.getAttribute('data-gf-id'));
      const attendus = filterReservationsForStaff(todaysReservations(), 'late').map((r) => String(r.id));
      setStaffStatusFilter('all');
      return { lignes, attendus };
    });
    ok(filtre.lignes.length > 0 && filtre.lignes.slice().sort().join() === filtre.attendus.slice().sort().join(), `[G2] ${label} : le filtre « En retard » ne garde que les groupes en retard`, filtre);

    // [G3] le planning bowling : chercher grise les autres groupes, sans les
    // retirer de la grille ; la piste d un groupe qui ne correspond pas reste
    // prise, sa case ne se propose pas a la reservation (2026-10-27)
    await page.evaluate(() => { location.hash = '#/staff/planning/bowling'; });
    await FX.repos(page, 900);
    const cartes = () => page.evaluate(() => Array.from(document.querySelectorAll('.booking[data-booking-res-id]')).map((b) => ({ id: b.getAttribute('data-booking-res-id'), piste: b.getAttribute('data-booking-lane'), debut: b.getAttribute('data-booking-start'), grise: b.classList.contains('is-grise'), opacite: Number(getComputedStyle(b).opacity) })));
    const sans = await cartes();
    const retenus = await page.evaluate(() => { applyStaffSearch('noah', { immediate: true }); return getPlanningVisibleReservations('bowling').map((r) => String(r.id)); });
    await FX.repos(page, 200);
    const avec = await cartes();
    const noms = await page.evaluate(() => Object.fromEntries(todaysReservations().map((r) => [String(r.id), r.name || ''])));
    await page.evaluate(() => applyStaffSearch('', { immediate: true }));
    const place = (c) => `${c.id}@${c.piste}@${c.debut}`;
    const g3 = {
      sans: sans.length,
      avec: avec.length,
      memesPistes: sans.length > 0 && sans.map(place).sort().join() === avec.map(place).sort().join(),
      trouves: avec.filter((c) => !c.grise).map((c) => noms[c.id]),
      gris: avec.filter((c) => c.grise).length,
      bonGris: avec.every((c) => c.grise === !retenus.includes(c.id)),
      lisibles: avec.filter((c) => c.grise).every((c) => c.opacite > 0.2 && c.opacite < 0.6),
    };
    ok(g3.memesPistes && g3.gris > 0 && g3.trouves.length > 0 && g3.trouves.every((n) => /noah/i.test(n)) && g3.bonGris && g3.lisibles, `[G3] ${label} : chercher dans le planning bowling grise les autres groupes sans les retirer, chaque piste prise reste prise`, g3);

    // [G4] le planning laser refait (2026-10-27, Movsar : « le haut prend
    // toute la place ») : le haut tient sur une ligne et montre chaque groupe
    // du prochain depart entier ; les groupes pas venus se replient sous un
    // bouton qui les compte, s ouvrent un par ligne sans action coupee, et la
    // journee tient toujours a l ecran.
    await page.evaluate(() => { location.hash = '#/staff/planning/laser'; });
    await FX.repos(page, 900);
    const g4 = await page.evaluate(() => {
      const R = (el) => el.getBoundingClientRect();
      const lp = document.getElementById('laserPlanningGridWrap');
      const synthese = lp.querySelector('.lp-synthese');
      const prochain = lp.querySelector('.lp-prochain');
      const bouton = lp.querySelector('.lp-journee__h .lp-retards');
      if (!synthese || !prochain || !bouton) return { manque: { synthese: Boolean(synthese), prochain: Boolean(prochain), bouton: Boolean(bouton) } };
      const zone = prochain.querySelector('.lp-groupes');
      const z = zone ? R(zone) : null;
      const groupes = zone ? Array.from(zone.querySelectorAll('.lp-groupe')).map((g) => { const r = R(g); return r.left >= z.left - 1 && r.right <= z.right + 1; }) : [];
      return { haut: Math.round(R(synthese).height), groupes, bouton: bouton.textContent.replace(/\s+/g, ' ').trim(), ferme: bouton.getAttribute('aria-expanded') === 'false', alertes: lp.querySelectorAll('.lp-alerte').length };
    });
    ok(!g4.manque && g4.haut <= 60 && g4.groupes.length >= 2 && g4.groupes.every(Boolean), `[G4] ${label} : au planning laser, le haut tient sur une ligne, chaque groupe du prochain depart entier, son « Ils sont là » compris`, g4);
    if (!g4.manque) await page.click('#laserPlanningGridWrap .lp-journee__h .lp-retards');
    await FX.repos(page, 600);
    const g4b = await page.evaluate(() => {
      const R = (el) => el.getBoundingClientRect();
      const lp = document.getElementById('laserPlanningGridWrap');
      const alertes = Array.from(lp.querySelectorAll('.lp-alertes .lp-alerte'));
      const coupees = Array.from(lp.querySelectorAll('.lp-alertes button')).filter((b) => {
        const r = R(b);
        if (r.left < 0 || r.right > innerWidth) return true;
        for (let e = b.parentElement; e; e = e.parentElement) {
          if (/auto|scroll|hidden|clip/.test(getComputedStyle(e).overflowX)) { const c = R(e); if (r.left < c.left - 1 || r.right > c.right + 1) return true; }
        }
        return false;
      }).map((b) => b.textContent.trim());
      const decaler = Array.from(lp.querySelectorAll('.lp-alerte .lp-btn--rouge')).map((b) => Math.round(R(b).right));
      const rangs = Array.from(lp.querySelectorAll('.lp-dep'));
      const dernier = rangs.length ? R(rangs[rangs.length - 1]).bottom : Infinity;
      return { lignes: alertes.map((a) => Math.round(R(a).height)), coupees, decaler, defile: lp.scrollHeight > lp.clientHeight + 1, tient: dernier <= innerHeight + 1 };
    });
    const compte = Number((/^(\d+) groupes? pas venus?$/.exec(g4.bouton || '') || [])[1]);
    ok(!g4.manque && g4.ferme && g4.alertes === 0 && compte >= 2 && g4b.lignes.length === compte && g4b.lignes.every((h) => h <= 46) && g4b.coupees.length === 0 && new Set(g4b.decaler).size === 1 && !g4b.defile && g4b.tient, `[G4] ${label} : les groupes pas venus se replient sous un bouton qui les compte ; ouverts, un par ligne, aucune action coupee, la journee tient a l ecran`, { ...g4, ...g4b });
    await sansErreur(erreurs, label + ' gestes');
  } finally { await ctx.close(); }
}

// LA MATRICE
const S = (fixture, appareil, extra = {}) => ({ fixture, appareil, ...extra });
const SCENARIOS = [
  ...['grand', 'ordinateur', 'portable', 'tablette', 'tablette-portrait', 'telephone'].map((a) => S('pic', a)),
  S('pic', 'grand', { theme: 'light' }), S('pic', 'telephone', { theme: 'light' }),
  S('pic', 'grand', { plein: true }), S('pic', 'ordinateur', { plein: true }),
  ...['grand', 'ordinateur', 'tablette', 'telephone'].map((a) => S('pire', a)),
  S('pire', 'ordinateur', { heure: '24:20', nuit: true }),
  S('calme', 'ordinateur'), S('normal', 'ordinateur'), S('normal', 'portable', { theme: 'light' }),
  S('vide', 'ordinateur', { sansGroupe: true }), S('ferme', 'ordinateur', { sansGroupe: true }),
];
async function scenario(browser, s) {
  const label = ici(s);
  const { ctx, page, erreurs } = await monter(browser, s);
  try {
    if (s.sansGroupe) await sansGroupe(page, s, label);
    else if (s.nuit) await nuit(page, s, label);
    else await structure(page, s, label);
    await sansErreur(erreurs, label);
  } finally { await ctx.close(); }
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const PIC = S('pic', 'ordinateur');
const MUTATIONS = [
  { nom: 'heure-de-l-accueil', lettre: 'F1', scenarios: [PIC], editions: [{ fichier: PG, de: '    var d = gpMinutesDe(r.startTime);\n    return d == null ? span.start : d;', vers: '    var d = gpMinutesDe((r.opsPlan || {}).arrivalTime || r.startTime);\n    return d == null ? span.start : d;' }] },
  { nom: 'ordre-par-nom', lettre: 'F1', scenarios: [PIC], editions: [{ fichier: PG, de: '    groupes.sort(function (a, b) { return a.heure - b.heure ||', vers: '    groupes.sort(function (a, b) { return 0 ||' }] },
  { nom: 'blocs-d-une-heure', lettre: 'F2', scenarios: [PIC], editions: [{ fichier: PG, de: '    var b = Math.floor(heure * 2 + 1e-6) / 2;', vers: '    var b = Math.floor(heure + 1e-6);' }] },
  { nom: 'laser-chez-le-bowling', lettre: 'F3', scenarios: [PIC], editions: [{ fichier: PG, de: "        poser('laser_game', e);", vers: "        poser('bowling', e);" }] },
  { nom: 'heure-decalee', lettre: 'F3', scenarios: [PIC], editions: [{ fichier: PG, de: "      t = desLeDebut ? '' : (e.libre ? '≈ ' : '') + gpHeure(debut);", vers: "      t = desLeDebut ? '' : (e.libre ? '≈ ' : '') + gpHeure(debut + 0.5);" }] },
  { nom: 'nom-coupe', lettre: 'F4', scenarios: [S('pire', 'ordinateur')], editions: [{ fichier: PGC, de: '.gf-nom__t { display: block; min-width: 150px; max-width: 260px;', vers: '.gf-nom__t { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 150px; max-width: 160px;' }] },
  { nom: 'personnes-plus-une', lettre: 'F5', scenarios: [PIC], editions: [{ fichier: PG, de: "'\"><b>' + pax + '</b>'", vers: "'\"><b>' + (pax + 1) + '</b>'" }] },
  { nom: 'fini-une-heure-trop-tard', lettre: 'E1', scenarios: [PIC], editions: [{ fichier: PG, de: "    if (fin <= m.maintenant + 1e-6) return 'fini';", vers: "    if (fin <= m.maintenant - 1) return 'fini';" }] },
  { nom: 'retard-muet', lettre: 'E2', scenarios: [PIC], editions: [{ fichier: PG, de: "(g.retard ? ' is-retard' : '')", vers: "''" }] },
  { nom: 'jamais-arrive', lettre: 'E3', scenarios: [PIC], editions: [{ fichier: PG, de: "    if (!m.aujourdHui || g.etat !== 'upcoming'", vers: "    if (true || g.etat !== 'upcoming'" }] },
  { nom: 'argent-muet', lettre: 'E3', scenarios: [PIC], editions: [{ fichier: PG, de: "    if (r.status === 'paid' || r.status === 'cancelled') return '';", vers: "    return '';" }] },
  { nom: 'etat-centre-muet', lettre: 'E4', scenarios: [PIC], editions: [{ fichier: PG, de: "        + (et ? '<span class=\"gf-th__etat'", vers: "        + (false ? '<span class=\"gf-th__etat'" }] },
  { nom: 'pistes-libres-fausses', lettre: 'E4', scenarios: [PIC], editions: [{ fichier: PG, de: '      var n = libres.libres.length;', vers: '      var n = libres.libres.length + 1;' }] },
  { nom: 'etat-cache-au-telephone', lettre: 'E4', scenarios: [S('pic', 'telephone')], editions: [{ fichier: PGC, de: '  .gf-maintenant { display: flex;', vers: '  .gf-maintenant { display: none;' }] },
  { nom: 'demi-absente', lettre: 'F6', scenarios: [PIC], editions: [{ fichier: PG, de: '      if (nouveauBloc) corps += gfDemi(m, b, parBloc.get(b), bande);', vers: '' }] },
  { nom: 'demi-compte-faux', lettre: 'F6', scenarios: [PIC], editions: [{ fichier: PG, de: '      c.groupes += 1;', vers: '      c.groupes += 2;' }] },
  { nom: 'charge-muette', lettre: 'F6', scenarios: [PIC], editions: [{ fichier: PG, de: "      if (col.nature === 'bowling' && occupation) {", vers: '      if (false) {' }] },
  { nom: 'barre-en-bas', lettre: 'N1', scenarios: [PIC], editions: [{ fichier: PG, de: '      if (!nowPose && g.heure > m.maintenant + 1e-6) {', vers: '      if (false) {' }] },
  { nom: 'ouverte-en-haut', lettre: 'N1', scenarios: [PIC], editions: [{ fichier: PG, de: '      gfAllerAMaintenant(wrap, false);\n    }', vers: '    }' }] },
  { nom: 'nuit-sans-24h', lettre: 'N2', scenarios: [S('pire', 'ordinateur', { heure: '24:20', nuit: true })], editions: [{ fichier: PG, de: '    var maintenant = jour === auj ? currentTimeDecimal() : nuit ? 24 + currentTimeDecimal() : null;', vers: '    var maintenant = jour === auj ? currentTimeDecimal() : nuit ? currentTimeDecimal() : null;' }] },
  { nom: 'arrive-sans-effet', lettre: 'G1', gestes: true, editions: [{ fichier: PG, de: "      if (arrive) { setReservationStatusDirect(arrive.getAttribute('data-gf-arrive'), 'arrived', e); return; }", vers: '      if (arrive) return;' }] },
  { nom: 'ligne-muette', lettre: 'G1', gestes: true, editions: [{ fichier: PG, de: "      if (ligne && typeof openPos === 'function') openPos(Number(ligne.getAttribute('data-gf-id')));\n    });", vers: '    });' }] },
  { nom: 'recherche-ignoree', lettre: 'G2', gestes: true, editions: [{ fichier: PG, de: '    if (!q) return true;', vers: '    return true;' }] },
  { nom: 'recherche-bowling-cache', lettre: 'G3', gestes: true, editions: [{ fichier: 'assets/app-main.js', de: "  const res = todaysReservations().filter(r => reservationMatchesStaffResource(r, 'bowling') && getBowlingWindowsFromReservation(r).length > 0);", vers: "  const res = getPlanningVisibleReservations('bowling').filter(r => getBowlingWindowsFromReservation(r).length > 0);" }] },
  { nom: 'grise-pleine', lettre: 'G3', gestes: true, editions: [{ fichier: 'assets/pinlane-staff.css', de: '.booking.is-grise { opacity: .35; }', vers: '.booking.is-grise { opacity: 1; }' }] },
  // Les pas venus s ouvrent d entree : la liste repousse la journee.
  { nom: 'retards-ouverts', lettre: 'G4', gestes: true, editions: [{ fichier: 'assets/app-main.js', de: '    lpEtat.retardsOuverts = false;', vers: '    lpEtat.retardsOuverts = true;' }] },
  // La bande du haut peut passer a la ligne : les groupes du prochain depart
  // tombent sous l heure.
  { nom: 'haut-sur-deux-lignes', lettre: 'G4', gestes: true, editions: [{ fichier: 'assets/pinlane-staff.css', de: '  .lp-compact .lp-prochain { flex-wrap: nowrap; }', vers: '' }] },
  { nom: 'trop-large', lettre: 'L1', scenarios: [PIC], editions: [{ fichier: PGC, de: '.gf-nom__t { display: block; min-width: 150px;', vers: '.gf-nom__t { display: block; min-width: 420px;' }] },
  { nom: 'etat-pas-colle', lettre: 'L1', scenarios: [S('pic', 'tablette')], editions: [{ fichier: PGC, de: '.gf-t :is(td.gf-etat, th.gf-th--etat) { position: sticky;', vers: '.gf-t :is(td.gf-etat, th.gf-th--etat) { position: relative;' }] },
  { nom: 'sous-l-ecran', lettre: 'L2', scenarios: [PIC], editions: [{ fichier: PG, de: '  var GF_BAS = 16;', vers: '  var GF_BAS = -400;' }] },
  { nom: 'hauteur-des-lignes', lettre: 'L2', gestes: true, editions: [{ fichier: PG, de: '    if (defile.style.height !== valeur) defile.style.height = valeur;', vers: '    if (defile.style.maxHeight !== valeur) defile.style.maxHeight = valeur;' }] },
  { nom: 'tableau-au-telephone', lettre: 'L3', scenarios: [S('pic', 'telephone')], editions: [{ fichier: PGC, de: '  .gf-r { display: grid;', vers: '  .gf-r { display: table-row;' }] },
  { nom: 'bandeau-cache', lettre: 'J1', scenarios: [S('ferme', 'ordinateur', { sansGroupe: true })], editions: [{ fichier: PG, de: '    bandeau.hidden = !texte;', vers: '    bandeau.hidden = true;' }] },
  { nom: 'detail-10px', lettre: 'V1', scenarios: [PIC], editions: [{ fichier: PGC, de: '.gf-x__d { font-size: 12px;', vers: '.gf-x__d { font-size: 10px;' }] },
  { nom: 'degrade', lettre: 'V1', scenarios: [PIC], editions: [{ fichier: PGC, de: '.gf-x__t {', vers: '.gf-x { background-image: linear-gradient(#fff0, #0001); }\n.gf-x__t {' }] },
  { nom: 'couleur-par-activite', lettre: 'V1', scenarios: [PIC], editions: [{ fichier: PGC, de: '.gf-x__t {', vers: '.gf-a[data-gf-titre="Minigolf"] .gf-x { background: #8a2be2; }\n.gf-a[data-gf-titre="Arcades"] .gf-x { background: #2b8a3e; }\n.gf-x__t {' }] },
  { nom: 'ligne-sans-aria', lettre: 'A1', scenarios: [PIC], editions: [{ fichier: PG, de: "'\" tabindex=\"0\" data-gf-id=\"' + gpEsc(g.id) + '\" aria-label=\"' + gpEsc(gfAria(g, m)) + '\">'", vers: "'\" tabindex=\"0\" data-gf-id=\"' + gpEsc(g.id) + '\">'" }] },
  { nom: 'pastille-dans-le-html', lettre: 'H1', gestes: true, editions: [{ fichier: PG, de: '<span class="gf-now__h" data-gf-maintenant></span>', vers: "<span class=\"gf-now__h\" data-gf-maintenant>' + gpEsc(gpHeure(m.maintenant)) + '</span>" }] },
  { nom: 'focus-perdu', lettre: 'D1', gestes: true, editions: [{ fichier: PG, de: '      if (focus) gfRendreFocus(defile, focus);', vers: '' }] },
];

async function main() {
  const serveur = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      const fixtures = liste(process.env.PG_FIXTURES);
      const appareils = liste(process.env.PG_APPAREILS);
      for (const s of SCENARIOS.filter((x) => (!fixtures || fixtures.includes(x.fixture)) && (!appareils || appareils.includes(x.appareil)))) await scenario(browser, s);
      if (!fixtures || fixtures.includes('pic')) await gestes(browser);
    } else {
      console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.PG_MUTATIONS || liste(process.env.PG_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.PG_BAVARD;
        try {
          if (m.gestes) await gestes(browser);
          else for (const s of m.scenarios) await scenario(browser, s);
        } catch (e) { rouges.push(`[${m.lettre}] crash ${e.message}`); }
        silence = false;
        mutation = null;
        const vus = rouges.slice(garde);
        rouges.length = garde;
        echecs = avant;
        ok(vus.some((l) => l.startsWith(`[${m.lettre}]`)), `[K] mutation ${m.nom} : [${m.lettre}] rougit`, vus.slice(0, 3).join(' ; ') || 'rien n a rougi');
      }
    }
  } finally {
    await browser.close();
    serveur.close();
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nplanning-global-check: FAIL ${echecs}`); process.exitCode = 1; return; }
  console.log(`\nplanning-global-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
