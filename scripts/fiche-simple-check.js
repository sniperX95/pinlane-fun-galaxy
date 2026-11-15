// LA FICHE D UN COUP D OEIL (la fiche d une reservation, 2026-10-26).
//
// Movsar, 26/10 : « un truc bcp plus simple moins ia complet avec toutes les
// infos mais super bien positionner [...] on regarde on sait direct prcq celui
// actuel tout est reparti partout avec des repetitions ». La regle : chaque
// information a UNE place.
//   [T1] l en-tete tient en deux lignes (Ansar, 15/11 : « trop long [...] faut
//        tout one shot ») : le nom, sa pastille, puis le jour, le lieu et le
//        numero en texte courant ; dessous, en grand, l heure, les joueurs
//        (Movsar, 27/10 : « heure activité joueur plus visible ») et la
//        formule ; aucun libelle ecrit, ils restent pour la synthese vocale ;
//   [U1] (Ansar, 15/11 : « en plein rush on veut la rapidité ») sur un
//        ordinateur, la fiche d un groupe se lit sans faire defiler : le corps
//        ne deborde pas, une activite tient sur une ligne de 48 px au plus ;
//   [T2] l occasion s ecrit en texte, pas en pastille ;
//   [T3] la formule du catalogue en grand, ou « À la carte » (Ansar, 14/11 :
//        « savoir si c une formule ou pas ») ; l occasion ne la redit pas ;
//   [E1] la phrase du moment (sur la ligne de l arrivee, ou dans le bandeau
//        d une demande a verifier) ne redit pas la pastille de l en-tete, le
//        titre de la ligne d arrivee non plus ;
//   [E2] elle dit ce que la pastille ne dit pas : l heure de fin, l heure
//        d arrivee, le retard en minutes, la raison d une demande a verifier ;
//   [E3] le retard et la demande a verifier se lisent en couleur, « Appeler »
//        a cote quand le dossier a un numero ;
//   [A1] l argent se dit UNE fois, en tete de la caisse (« À encaisser
//        118 € », « Encaissé 390 € ») ; ses lignes ne le redisent pas ;
//   [A2] aucune ligne « Total » : le montant en grand est le total. Une
//        addition d une seule ligne ne redit pas son montant ; plusieurs
//        lignes gardent chacune le leur, le prix par joueur sous le montant ;
//   [C1] (2026-11-15, Ansar : « plein d info dispersée partout [...] refait
//        tout de zero ») deux colonnes de blocs : a gauche les notes puis le
//        programme, a droite la caisse, le client et le pli Historique ; ce
//        qui bloque (demande a verifier, absence) en bandeau au-dessus ; les
//        notes se lisent sans faire defiler ;
//   [P1] (Ansar, 15/11 : « pouvoir cocher toutes les choses ») le programme se
//        coche de haut en bas : la ligne de l arrivee d abord, son rond coche
//        quand le groupe est pointe, puis chaque activite avec une vraie case
//        vide (jamais une icone dedans) et sa photo ou son icone ;
//   [P2] « Payé · Carte » et « Payé · Espèces » vivent dans la caisse, sous
//        le montant ;
//   [G1] (Ansar, 14/11 : « pour des etudiants jeunes il faut un truc simple
//        rapide et complet [...] le retard [...] la note [...] modifier
//        rapidement ») dans l en-tete, donc toujours a l ecran, « Retard »,
//        « Note pour l’équipe » et « Message au client », EN TEXTE SEUL (Ansar,
//        15/11, sur la rangee de boutons encadres a pictogramme : « on dirait
//        ia ») : ni bord ni pictogramme ; « Annuler la réservation », qui
//        n est pas un geste de rush, au bas de la colonne de droite, a
//        l ecran sans faire defiler ; le bouton dit « Retard », rouge quand la pastille
//        dit « En retard » (il ne la redit pas, jamais de minutes) ; il ouvre
//        ses minutes
//        en tete du corps, la note ouvre son champ le curseur dedans, toucher
//        les joueurs ouvre « Modifier » sur leur nombre ;
//   [C2] le client sans libelle : un numero, une adresse, ou une seule ligne
//        pour ce qui manque, avec « Ajouter » quand le numero manque (il ouvre
//        Modifier sur le telephone) ;
//   [V1] l etat d une activite se lit en mot colore, pas en pastille ;
//        « À leur rythme » ne redit pas « Libre » ;
//   [L1] la fiche tient dans l ecran, du grand ecran au telephone, sans
//        defilement de cote ni texte sous 12 px ;
//   [J1] aucune erreur JS.
// La console reelle, montee par scripts/planning-v3-fixtures.js sur la journee
// « pic » de Fun Galaxy Libramont a 15:10 (aucun reseau, aucune base). Les
// oracles sont les fonctions de la console qui disent l etat d un groupe
// (getStaffDashboardStatusMeta, getStaffReservationMoments) et son prix
// (price, formatMoneyCentimes).
// --contre-preuves : chaque regle retiree (en memoire, au texte servi ; le
// disque n est jamais touche) fait rougir sa lettre ; chaque ancre existe une
// fois et une seule.
//   FS_MUTATIONS : un sous-ensemble ; FS_BAVARD : les lignes des contre-preuves.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_FICHE_SIMPLE_PORT || 5193);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JS = 'assets/app-main.js';
const CSS = 'assets/pinlane-staff.css';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);

let echecs = 0;
let silence = false;
const rouges = [];
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)}` : ''}`);
  return cond;
}

let mutation = null;
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel) t = t.replace(ed.de, () => ed.vers);
  return t;
}

// Les dossiers de la journee « pic », un par etat. Pirotte recoit un numero
// et une adresse, et perd sa note : la fiche d un client joignable, sans note.
const DOSSIERS = [
  { nom: 'Anniversaire Noah', etat: 'Sur place', paye: true },
  { nom: 'Anniversaire Arthur', etat: 'Sur place' },
  { nom: 'Famille Pirotte', etat: 'En retard', contact: { phone: '0471 23 45 67', email: 'famille.pirotte@exemple.be', notes: '' } },
  { nom: 'Club de foot', etat: 'À vérifier' },
  { nom: 'Famille Renard', etat: 'En retard' },
  { nom: 'Famille Henrard', etat: 'À venir' },
];

// ---------------------------------------------------------------------------
// DANS LA PAGE : ce que la fiche ecrit, et ce que la console sait du dossier.
// ---------------------------------------------------------------------------
function lireFiche({ nom, contact }) {
  const r = state.reservations.find((x) => String(x.name || '').includes(nom));
  if (!r) return { absent: nom };
  if (contact) Object.assign(r, contact);
  if (typeof closePos === 'function') closePos();
  openPos(r.id);
  const m = document.querySelector('#posOverlay .edit-modal');
  const corps = m.querySelector('.edit-modal-body');
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const R = (el) => el.getBoundingClientRect();
  const cs = (el) => getComputedStyle(el);
  const transparent = (v) => !v || v === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(v);
  // Un fait : son libelle (lu par la synthese vocale), sa valeur, sa ligne
  // (les chiffres en grand ou les faits courants) et sa taille, celle de son
  // nombre quand il en a un (« 10 » joueurs).
  const faits = Array.from(m.querySelectorAll('.fx-chiffres .dossier-fact, .dossier-facts .dossier-fact')).map((f) => {
    const lib = f.querySelector('span');
    const val = f.querySelector('strong');
    const chiffre = f.querySelector('.fx-nombre') || val;
    return { libelle: txt(lib), valeur: txt(val), libVu: Boolean(lib) && R(lib).width > 1 && R(lib).height > 1 && cs(lib).clip !== 'rect(0px, 0px, 0px, 0px)', haut: Math.round(R(val).top), bas: Math.round(R(val).bottom), ligne: f.closest('.fx-chiffres') ? 'chiffres' : 'faits', px: parseFloat(cs(chiffre).fontSize) };
  });
  // La phrase du moment : celle du bandeau d une demande a verifier, sinon
  // celle de la ligne d arrivee.
  const moment = m.querySelector('.fz-bandeau .fx-moment') || m.querySelector('.fz-arrivee .fx-moment');
  const span = moment && moment.querySelector(':scope > span');
  const arrivee = m.querySelector('.fz-arrivee');
  const tete = m.querySelector('.dossier-head');
  const teteR = R(tete);
  const vuEnTete = (el) => { const b = R(el); return b.width > 0 && b.height > 0 && b.top >= teteR.top - 1 && b.bottom <= Math.min(innerHeight, teteR.bottom) + 1 && b.left >= 0 && b.right <= innerWidth; };
  const sonde = document.createElement('span');
  m.appendChild(sonde);
  const couleur = (v) => { sonde.style.color = `var(${v})`; return cs(sonde).color; };
  const danger = couleur('--danger');
  const warning = couleur('--warning');
  sonde.remove();
  const meta = getStaffDashboardStatusMeta(r);
  const mo = getStaffReservationMoments([r], r.date || state.currentDate).get(String(r.id)) || null;
  const cote = m.querySelector('.fx-cote');
  const principal = m.querySelector('.fx-principal');
  const notes = m.querySelector('.gc-notes');
  const feuille = corps.querySelector('.fx');
  const corpsR = R(corps);
  const formuleCatalogue = r.formuleId ? ((resolveDisplayFormule(r.formuleId) || {}).name || '') : '';
  const textes = [];
  const marche = document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
  for (let n = marche.nextNode(); n; n = marche.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || !el || !el.getClientRects().length || el.closest('.visually-hidden, details:not([open]) > :not(summary)')) continue;
    textes.push({ t: n.textContent.trim().slice(0, 30), px: parseFloat(cs(el).fontSize) });
  }
  const ligne = (el) => (el ? txt(el) : '');
  return {
    id: r.id,
    nom: r.name,
    paye: r.status === 'paid',
    prix: formatMoneyCentimes(Number(r.price) || 0),
    pastille: txt(m.querySelector('.dossier-head .dossier-status')),
    pastilleAttendue: meta.label,
    faits,
    etiquettes: Array.from(m.querySelectorAll('.fx-etiquette')).map((e) => ({ t: txt(e), fond: cs(e).backgroundColor, pad: cs(e).paddingLeft })),
    moment: [ligne(moment), ligne(m.querySelector('.fz-arrivee-texte b'))].join(' '),
    momentPhrase: ligne(span),
    momentCouleur: span ? cs(span).color : '',
    momentTon: moment ? (moment.className.match(/is-(retard|verifier)/) || [''])[0] : '',
    danger,
    warning,
    appel: Boolean(m.querySelector('.fz-bandeau a.fx-appel[href^="tel:"], .fz-arrivee a.fx-appel[href^="tel:"]')),
    retard: mo && mo.late ? Math.max(1, Math.round((mo.now - mo.item.start) * 60)) : 0,
    attendu: mo && mo.item ? formatClockDisplay(mo.item.start) : '',
    fin: mo && mo.item ? formatClockDisplay(mo.item.end) : '',
    telephone: Boolean(r.phone),
    argent: ligne(m.querySelector('.fz-caisse .pos-act-money')),
    corps: txt(corps),
    caisse: ligne(m.querySelector('.fz-caisse')),
    addition: ligne(m.querySelector('.gc-bill-lines')),
    unite: ligne(m.querySelector('.fz-caisse .gc-bill-unit')),
    payer: Array.from(m.querySelectorAll('.fz-caisse .pos-act-money ~ .fz-payer .res-status-btn')).map((b) => txt(b)),
    arrivee: arrivee ? {
      coche: Boolean(arrivee.querySelector('.fz-rond.is-on')),
      avantLesActivites: Boolean(arrivee.nextElementSibling && arrivee.nextElementSibling.matches('.gc-steps')) || !m.querySelector('.fx-programme .gc-steps'),
      touchable: Boolean(arrivee.querySelector('button.fz-arrivee-ligne')),
    } : null,
    pointe: r.status === 'arrived' || r.status === 'paid',
    cases: Array.from(m.querySelectorAll('.fx-programme .gc-step')).map((li) => {
      const c = li.querySelector('.gc-check');
      const v = li.querySelector('.fz-photo');
      return { premiere: Boolean(c) && li.firstElementChild === c, rond: c ? Math.round(R(c).width) : 0, vide: Boolean(c) && (c.classList.contains('is-on') || !c.querySelector('svg, .gc-check-icon')), visuel: Boolean(v) && R(v).width >= 40 && (v.classList.contains('is-icone') ? Boolean(v.querySelector('svg')) : /url\(/.test(cs(v).backgroundImage)) };
    }),
    lignesAddition: Array.from(m.querySelectorAll('.gc-bill-lines > div')).map((d) => txt(d)),
    total: ligne(m.querySelector('.gc-bill-total')),
    principal: principal ? Array.from(principal.children).map((c) => (c.matches('.gc-notes') ? 'notes' : c.matches('.fx-programme') ? 'programme' : c.className)) : [],
    cote: cote ? Array.from(cote.children).map((c) => (c.matches('.gc-notes') ? 'notes' : c.matches('.fz-caisse') ? 'caisse' : c.matches('.fx-client') ? 'client' : c.matches('.fx-historique') ? 'historique' : c.matches('.fz-fin') ? 'annuler' : c.matches('.fx-pli') ? 'pli' : c.className)) : [],
    ordre: feuille ? Array.from(feuille.children).map((c) => (c.matches('.fz-bandeau') ? 'bandeau' : c.matches('.gc-notes') ? 'notes' : c.matches('.fx-colonnes') ? 'colonnes' : c.matches('.pos-absent') ? 'absent' : c.matches('.fx-retard') ? 'retard' : c.className)) : [],
    attenduNotes: Boolean(String(r.notes || '').trim()),
    formuleCatalogue,
    outils: Array.from(m.querySelectorAll('.dossier-head .fx-outils .fx-outil')).map((b) => ({ t: txt(b), vu: vuEnTete(b), rouge: b.classList.contains('is-retard'), nu: parseFloat(getComputedStyle(b).borderTopWidth) === 0 && Array.from(b.querySelectorAll('svg')).every((g) => g.getBoundingClientRect().width === 0) })),
    annuler: Array.from(m.querySelectorAll('.fx-cote .fz-fin .fx-annuler')).map((b) => ({ t: txt(b), vu: R(b).height > 0 && R(b).bottom <= innerHeight && R(b).top >= R(corps).top - 1 && R(b).bottom <= R(corps).bottom + 1 })),
    annulerEnTete: m.querySelectorAll('.dossier-head .fx-annuler').length,
    notesHaut: notes ? Math.round(R(notes).top) : null,
    corpsBas: Math.round(R(corps).bottom),
    client: ligne(m.querySelector('.fx-client')),
    vides: Array.from(m.querySelectorAll('.fx-client .fx-vide')).map((e) => txt(e.querySelector(':scope > span') || e)),
    ajouter: Array.from(m.querySelectorAll('.fx-client .fx-vide .fz-ajouter-contact')).map((e) => txt(e)),
    hauteurs: Array.from(m.querySelectorAll('.fx-programme .gc-step')).map((li) => Math.round(R(li).height)),
    defile: { sh: corps.scrollHeight, ch: corps.clientHeight },
    liens: Array.from(m.querySelectorAll('.fx-client .fx-contact a')).map((a) => a.getAttribute('href').split(':')[0]),
    icones: m.querySelectorAll('.fx-client .fx-contact li > svg').length,
    etats: Array.from(m.querySelectorAll('.gc-step .gc-step-state')).filter((e) => e.getClientRects().length).map((e) => ({ t: txt(e), fond: cs(e).backgroundColor, pad: cs(e).paddingLeft })),
    libresVus: Array.from(m.querySelectorAll('.gc-step.is-libre .gc-step-state')).filter((e) => e.getClientRects().length).length,
    deborde: { sw: m.scrollWidth, cw: m.clientWidth, csw: corps.scrollWidth, ccw: corps.clientWidth, page: document.scrollingElement.scrollWidth, iw: innerWidth },
    modal: { bas: Math.round(R(m).bottom), droite: Math.round(R(m).right), ih: innerHeight },
    petits: textes.filter((x) => x.px < 12),
    transparent: transparent('x'),
  };
}

// LES GESTES JOUES (2026-11-14) : toucher « Retard », « Note pour l’équipe »
// et les joueurs, comme au comptoir.
async function jouerGestes({ nom }) {
  const r = state.reservations.find((x) => String(x.name || '').includes(nom));
  if (!r) return { absent: nom };
  if (typeof closePos === 'function') closePos();
  openPos(r.id);
  const q = (s) => document.querySelector(`#posOverlay ${s}`);
  const attendre = () => new Promise((fin) => setTimeout(fin, 150));
  const actif = () => (document.activeElement ? document.activeElement.id : '');
  const g = { id: r.id };
  q('.fx-outil-retard').click();
  await attendre();
  const p = q(`#fxRetard${r.id}`);
  g.retard = {
    ouvert: Boolean(p),
    expanded: q('.fx-outil-retard').getAttribute('aria-expanded'),
    enTeteDuCorps: Boolean(p && p.parentElement.matches('.fx') && !p.previousElementSibling),
    minutes: p ? Array.from(p.querySelectorAll('.delay-chip:not(.delay-chip-now):not(.delay-chip-run)')).map((b) => b.textContent.trim()) : [],
    autre: Boolean(p && p.querySelector('#delayCustomMinutes')),
  };
  q('.fx-outil-retard').click();
  await attendre();
  g.retard.referme = !q(`#fxRetard${r.id}`);
  q('.gc-note-ouvrir').click();
  await attendre();
  g.note = { focus: actif(), dansLesNotes: Boolean(q(`.fx-principal > .gc-notes:first-child #gcNoteEquipe${r.id}`)) };
  fermerNoteEquipe(r.id);
  await attendre();
  g.note.rendu = Boolean(document.activeElement && document.activeElement.matches('.gc-note-ouvrir'));
  q('.fx-joueurs.fx-fait-modif').click();
  await attendre();
  g.joueurs = { onglet: state.activeTab, focus: actif() };
  state.editState = null;
  ouvrirOngletFiche('details');
  closePos();
  return g;
}

function jugerGestes(g, label) {
  ok(g.retard.ouvert && g.retard.expanded === 'true' && g.retard.enTeteDuCorps && g.retard.minutes.join() === '+5 min,+10 min,+15 min,+20 min,+30 min' && g.retard.autre && g.retard.referme,
    `[G1] ${label} : « Retard » ouvre ses minutes en tete du corps, puis se referme`, g.retard);
  ok(g.note.focus === `gcNoteEquipe${g.id}` && g.note.dansLesNotes && g.note.rendu,
    `[G1] ${label} : « Note pour l’équipe » ouvre son champ en tete des notes, le curseur dedans, et le rend au bouton`, g.note);
  ok(g.joueurs.onglet === 'modifier' && g.joueurs.focus === 'editPaxInput',
    `[G1] ${label} : toucher les joueurs ouvre « Modifier » sur leur nombre`, g.joueurs);
}

// ---------------------------------------------------------------------------
// LES REGLES, par dossier.
// ---------------------------------------------------------------------------
const RX_ARGENT = (f) => new RegExp(`^${f.paye ? 'Encaissé' : 'À encaisser'}\\s*${f.prix.replace(/\s/g, '\\s*')}$`);
function juger(f, label, appareil) {
  const ordi = !['telephone', 'tablette-portrait'].includes(appareil);
  // [T1]
  const chiffres = f.faits.filter((x) => x.ligne === 'chiffres');
  const courants = f.faits.filter((x) => x.ligne === 'faits');
  ok(chiffres.map((x) => x.libelle).join() === 'Horaires,Groupe,Formule' && courants.map((x) => x.libelle).join() === 'Date,Ressources,Réservation' && f.faits.every((x) => x.valeur && !x.libVu),
    `[T1] ${label} : l heure, les joueurs et la formule d abord, puis le jour, le lieu et le numero, sans libelle ecrit`, f.faits);
  const plusPetitChiffre = Math.min(...chiffres.map((x) => x.px));
  ok(plusPetitChiffre >= 22 && courants.every((x) => x.px <= 15 && x.px < plusPetitChiffre), `[T1] ${label} : l heure et les joueurs en grand (${plusPetitChiffre} px), le reste en texte courant`, f.faits.map((x) => `${x.valeur}:${x.px}`));
  // Une ligne : les deux boites se recouvrent en hauteur (le nombre de joueurs
  // et l heure n ont pas la meme taille, leurs hauts different).
  // Au telephone, la formule peut passer a la ligne sous l heure et les joueurs.
  const memeLigne = (a, b) => Boolean(a && b) && b.haut < a.bas && b.bas > a.haut;
  ok(chiffres.length === 3 && memeLigne(chiffres[0], chiffres[1]) && (!ordi || memeLigne(chiffres[0], chiffres[2])) && courants.every((x) => x.bas <= Math.min(...chiffres.map((c) => c.haut)) + 2), `[T1] ${label} : les faits courants sur la ligne du nom, puis l heure et les joueurs sur une ligne${ordi ? ', la formule a cote' : ''}`, f.faits.map((x) => `${x.valeur}@${x.haut}`));
  if (ordi) ok(new Set(courants.map((x) => x.haut)).size === 1, `[T1] ${label} : les faits courants tiennent sur une ligne`, courants.map((x) => `${x.valeur}@${x.haut}`));
  // [T2]
  ok(f.etiquettes.every((e) => (/rgba\([^)]*,\s*0\)$|transparent/.test(e.fond)) && e.pad === '0px'), `[T2] ${label} : l occasion s ecrit en texte, pas en pastille`, f.etiquettes);
  // [T3]
  const formuleVue = chiffres[2] ? chiffres[2].valeur : '';
  ok(formuleVue === (f.formuleCatalogue || 'À la carte') && (!f.formuleCatalogue || f.etiquettes.every((e) => !e.t.includes(f.formuleCatalogue))),
    `[T3] ${label} : ${f.formuleCatalogue ? `la formule « ${f.formuleCatalogue} » en grand, l occasion ne la redit pas` : '« À la carte » en grand'}`, { vue: formuleVue, catalogue: f.formuleCatalogue, etiquettes: f.etiquettes.map((e) => e.t) });
  // [E1]
  ok(f.pastille === f.pastilleAttendue, `[E1] ${label} : la pastille de l en-tete dit « ${f.pastilleAttendue} »`, f.pastille);
  ok(f.momentPhrase && !f.moment.toLowerCase().includes(f.pastille.toLowerCase()),
    `[E1] ${label} : ni la phrase du moment ni la ligne d arrivee ne redisent « ${f.pastille} »`, { moment: f.moment });
  // [E2]
  const attendu = {
    'Sur place': new RegExp(`^Fin prévue à ${f.fin}$`),
    'À clôturer': new RegExp(`^Visite finie à ${f.fin}`),
    'À venir': new RegExp(`^(Arrive dans .+|Attendu maintenant), à ${f.attendu}$`),
    'En retard': new RegExp(`^Attendu à ${f.attendu}, (il y a (${f.retard} min|\\d+ h( \\d\\d)?)|jamais pointé)$`),
    'À vérifier': /Pas encore confirmée au client\./,
  }[f.pastille];
  ok(attendu && attendu.test(f.momentPhrase), `[E2] ${label} : la ligne d etat dit ce que la pastille ne dit pas`, { phrase: f.momentPhrase, retard: f.retard, attendu: f.attendu, fin: f.fin });
  // [E3]
  if (f.pastille === 'En retard' || f.pastille === 'À vérifier') {
    const couleur = f.pastille === 'En retard' ? f.danger : f.warning;
    ok(f.momentCouleur === couleur && f.momentTon, `[E3] ${label} : la phrase se lit en ${f.pastille === 'En retard' ? 'rouge' : 'ambre'}`, { lu: f.momentCouleur, attendu: couleur });
    ok(f.appel === f.telephone, `[E3] ${label} : « Appeler » a cote ${f.telephone ? 'du numero' : '(aucun numero, aucun bouton)'}`, { appel: f.appel, telephone: f.telephone });
  } else ok(!f.momentTon && !f.appel, `[E3] ${label} : ni couleur d alerte ni « Appeler » hors retard`, { ton: f.momentTon, appel: f.appel });
  // [A1]
  const mots = (f.corps.match(/À encaisser|Encaissé|Payé(?! ·)/g) || []).length;
  ok(RX_ARGENT(f).test(f.argent) && mots === 1 && !/À encaisser|Encaissé|Payé/.test(f.addition),
    `[A1] ${label} : l argent une fois, en tete de la caisse (« ${f.argent} »), ses lignes ne le redisent pas`, { argent: f.argent, fois: mots, addition: f.addition });
  // [A2]
  const montant = f.prix.replace(/\s/g, '');
  const fois = (f.caisse.replace(/\s/g, '').split(montant).length - 1);
  if (f.lignesAddition.length <= 1) {
    ok(!f.total && fois === 1, `[A2] ${label} : une ligne au plus, le montant une seule fois dans la caisse (${montant} ${fois} fois), pas de total`, f.caisse);
  } else {
    ok(!f.total && !/Total/.test(f.addition) && /par (joueur|personne présente)/.test(f.unite), `[A2] ${label} : plusieurs lignes sans ligne « Total », le prix par joueur sous le montant`, { addition: f.addition, unite: f.unite });
  }
  // [C1] (le pli Historique ferme la colonne, 2026-11-03 : la session de la
  // fixture, Direction, a le niveau « historique » ; la demande a verifier a
  // son bandeau au-dessus des colonnes)
  ok(JSON.stringify(f.ordre) === JSON.stringify((f.pastille === 'À vérifier' ? ['bandeau'] : []).concat(['colonnes']))
    && JSON.stringify(f.principal) === JSON.stringify((f.attenduNotes ? ['notes'] : []).concat(['programme'])) && JSON.stringify(f.cote) === JSON.stringify(['caisse', 'client', 'historique', 'annuler']),
    `[C1] ${label} : ${f.pastille === 'À vérifier' ? 'le bandeau, puis ' : ''}a gauche ${f.attenduNotes ? 'les notes et ' : ''}le programme, a droite la caisse, le client, l historique, puis Annuler`, { ordre: f.ordre, principal: f.principal, cote: f.cote });
  if (ordi && f.attenduNotes) ok(f.notesHaut !== null && f.notesHaut < f.corpsBas - 40, `[C1] ${label} : les notes se lisent sans faire defiler`, { notes: f.notesHaut, bas: f.corpsBas });
  // [P1]
  ok(f.arrivee && f.arrivee.avantLesActivites && f.arrivee.coche === f.pointe && f.arrivee.touchable === !f.paye,
    `[P1] ${label} : la ligne de l arrivee en tete du programme, ${f.pointe ? 'cochee' : 'a cocher'}${f.paye ? ', figee une fois paye' : ''}`, f.arrivee);
  ok(f.cases.length > 0 && f.cases.every((c) => c.premiere && c.rond >= 22 && c.vide && c.visuel),
    `[P1] ${label} : chaque activite a sa case en tete de rangee (vide tant qu elle n est pas faite) et sa photo ou son icone`, f.cases.filter((c) => !(c.premiere && c.rond >= 22 && c.vide && c.visuel)).slice(0, 3));
  // [U1] (les six dossiers de la fixture ont cinq activites au plus)
  if (ordi) ok(f.defile.sh <= f.defile.ch + 1 && f.hauteurs.every((h) => h <= 48),
    `[U1] ${label} : tout se lit sans faire defiler, une ligne de 48 px au plus par activite`, { ...f.defile, hauteurs: f.hauteurs });
  // [P2]
  ok(JSON.stringify(f.payer) === JSON.stringify(['Payé · Carte', 'Payé · Espèces']), `[P2] ${label} : « Payé · Carte » et « Payé · Espèces » dans la caisse, sous le montant`, f.payer);
  // [G1]
  ok(JSON.stringify(f.outils.map((o) => o.t)) === JSON.stringify(['Retard', 'Note pour l’équipe', 'Message au client'])
    && f.outils.every((o) => o.vu && o.nu) && f.outils.every((o, i) => o.rouge === (i === 0 && f.pastille === 'En retard')),
    `[G1] ${label} : « Retard », la note et le message dans l en-tete, en texte seul (ni bord ni pictogramme), toujours a l ecran, le retard rouge seulement en retard`, f.outils);
  ok(f.annulerEnTete === 0 && f.annuler.length === 1 && f.annuler[0].t === 'Annuler la réservation' && (!ordi || f.annuler[0].vu),
    `[G1] ${label} : « Annuler la réservation » au bas de la colonne de droite${ordi ? ', a l ecran sans faire defiler' : ''}, plus dans l en-tete`, { annuler: f.annuler, enTete: f.annulerEnTete });
  // [C2]
  const joignable = f.liens.length > 0;
  ok(!/non renseign/i.test(f.client) && (joignable
    ? f.liens.join() === 'tel,mailto' && f.icones === 2 && f.vides.length === 0
    : f.vides.join() === 'Ni téléphone ni e-mail' && f.ajouter.join() === 'Ajouter'),
  `[C2] ${label} : le client sans libelle, ${joignable ? 'un numero et une adresse' : 'une seule ligne pour ce qui manque, « Ajouter » a cote'}`, { client: f.client, liens: f.liens, vides: f.vides, ajouter: f.ajouter });
  // [V1]
  ok(f.etats.every((e) => /rgba\([^)]*,\s*0\)$|transparent/.test(e.fond) && e.pad === '0px') && f.libresVus === 0,
    `[V1] ${label} : l etat des activites en mot colore, « À leur rythme » tu`, { etats: f.etats.slice(0, 3), libres: f.libresVus });
  // [L1]
  ok(f.deborde.sw <= f.deborde.cw + 1 && f.deborde.csw <= f.deborde.ccw + 1 && f.deborde.page <= f.deborde.iw && f.modal.bas <= f.modal.ih && f.modal.droite <= f.deborde.iw,
    `[L1] ${label} : la fiche tient dans l ecran, sans defilement de cote`, { ...f.deborde, ...f.modal });
  ok(f.petits.length === 0, `[L1] ${label} : aucun texte sous 12 px`, f.petits.slice(0, 4));
}

const ici = (s) => `${s.appareil}${s.theme === 'light' ? ' clair' : ''}`;
async function scenario(browser, s) {
  const { ctx, page, erreurs } = await FX.monter(browser, { fixture: 'pic', appareil: s.appareil, theme: s.theme || 'dark', port: PORT });
  try {
    for (const d of DOSSIERS.filter((x) => !s.dossiers || s.dossiers.includes(x.nom))) {
      const f = await page.evaluate(lireFiche, d);
      if (f.absent) { ok(false, `[J1] ${ici(s)} : dossier ${f.absent} introuvable dans la fixture`); continue; }
      ok(f.pastilleAttendue === d.etat, `[J1] ${ici(s)} : prerequis, ${d.nom} est « ${d.etat} » a 15:10`, f.pastilleAttendue);
      juger(f, `${d.nom} ${ici(s)}`, s.appareil);
      await page.evaluate(() => closePos());
    }
    // Les gestes se jouent sur l ordinateur sombre (les contre-preuves aussi).
    if (s.appareil === 'ordinateur' && !s.theme) {
      for (const nom of ['Famille Henrard', 'Famille Renard'].filter((x) => !s.dossiers || s.dossiers.includes(x))) {
        const g = await page.evaluate(jouerGestes, { nom });
        if (g.absent) { ok(false, `[J1] ${ici(s)} : dossier ${g.absent} introuvable dans la fixture`); continue; }
        jugerGestes(g, `${nom} ${ici(s)}`);
      }
    }
    ok(erreurs.length === 0, `[J1] ${ici(s)} : aucune erreur JS`, erreurs.slice(0, 3));
  } finally { await ctx.close(); }
}

const SCENARIOS = [
  { appareil: 'ordinateur' },
  { appareil: 'grand' },
  { appareil: 'ordinateur', theme: 'light' },
  { appareil: 'tablette' },
  { appareil: 'tablette-portrait' },
  { appareil: 'telephone' },
  { appareil: 'telephone', theme: 'light' },
];

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const ORDI = [{ appareil: 'ordinateur' }];
const MUTATIONS = [
  { nom: 'libelles-ecrits', lettre: 'T1', scenarios: ORDI, editions: [{ fichier: JS, de: '<span class="visually-hidden">${libelle} </span><strong>${valeur}</strong></span>', vers: '<span>${libelle} </span><strong>${valeur}</strong></span>' }] },
  { nom: 'formule-perdue', lettre: 'T3', scenarios: ORDI, editions: [{ fichier: JS, de: "    + fait('Formule', nomFormule ? escapeHtml(nomFormule) : 'À la carte', nomFormule ? 'fx-formule' : 'fx-formule is-carte');", vers: "    + '';" }] },
  { nom: 'formule-redite', lettre: 'T3', scenarios: ORDI, editions: [{ fichier: JS, de: ".map(e => (e.ton === 'occasion' && nomFormule ?", vers: '.map(e => (false ?' }] },
  { nom: 'chiffres-petits', lettre: 'T1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .fx-chiffres .dossier-fact strong { font-family: var(--fz-anton); font-size: 30px;', vers: '.fx-modal .fx-chiffres .dossier-fact strong { font-family: var(--fz-anton); font-size: 15px;' }] },
  { nom: 'faits-empiles', lettre: 'T1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .dossier-fact { display: inline; }', vers: '.fx-modal .dossier-fact { display: grid; }' }] },
  { nom: 'occasion-en-pastille', lettre: 'T2', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .fx-etiquette { display: inline; padding: 0; border-radius: 0; background: none;', vers: '.fx-modal .fx-etiquette { display: inline; padding: 3px 8px; border-radius: 6px; background: var(--subtle);' }] },
  { nom: 'pastille-redite', lettre: 'E1', scenarios: ORDI, editions: [{ fichier: JS, de: "      : `Fin prévue à ${formatClockDisplay(span.end)}`;", vers: "      : `Sur place, fin prévue à ${formatClockDisplay(span.end)}`;" }] },
  { nom: 'arrivee-redit-la-pastille', lettre: 'E1', scenarios: ORDI, editions: [{ fichier: JS, de: "<b>${arrive ? 'Groupe arrivé' : 'Arrivée du groupe'}</b>", vers: "<b>${arrive ? 'Sur place' : 'À venir, en retard'}</b>" }] },
  { nom: 'retard-sans-minutes', lettre: 'E2', scenarios: ORDI, editions: [{ fichier: JS, de: '  if (moment && moment.late) return `Attendu à ${formatClockDisplay(moment.item.start)}, il y a ${formatStaffTerrainDelay(moment.now - moment.item.start)}`;', vers: "  if (moment && moment.late) return 'Pas encore arrivé';" }] },
  { nom: 'retard-sans-couleur', lettre: 'E3', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .fz-arrivee-texte .fx-moment.is-retard { font-weight: 650; color: var(--danger); }', vers: '.fx-modal .fz-arrivee-texte .fx-moment.is-retard { font-weight: 650; }' }] },
  { nom: 'appel-perdu', lettre: 'E3', scenarios: ORDI, editions: [{ fichier: JS, de: "${enRetard ? ficheAppeler(r) : ''}${compte}${pasVenu}</div>`;", vers: '${compte}${pasVenu}</div>`;' }] },
  { nom: 'paye-dans-l-addition', lettre: 'A1', scenarios: ORDI, editions: [{ fichier: JS, de: '<dl class="gc-bill-lines">${addition.lignes.map(', vers: '<dl class="gc-bill-lines"><div><dt>${paid ? \'Payé\' : \'À encaisser\'}</dt><dd></dd></div>${addition.lignes.map(' }] },
  { nom: 'encaisse-deux-fois', lettre: 'A1', scenarios: ORDI, editions: [{ fichier: JS, de: '      <details class="pos-encaisse-corriger">', vers: '      <span class="pos-encaisse-ligne">Encaissé ${escapeHtml(formatMoneyCentimes(montant))}</span><details class="pos-encaisse-corriger">' }] },
  { nom: 'total-d-une-ligne', lettre: 'A2', scenarios: ORDI, editions: [{ fichier: JS, de: '  const seule = lignes.length === 1 &&', vers: '  const seule = false &&' }] },
  { nom: 'notes-dans-la-colonne', lettre: 'C1', scenarios: ORDI, editions: [
    { fichier: JS, de: '      <div class="fx-principal">\n        ${renderGroupeNotes(r)}\n', vers: '      <div class="fx-principal">\n' },
    { fichier: JS, de: '      <aside class="fx-cote">\n        ${ficheCaisse(r, moment, droits)}', vers: '      <aside class="fx-cote">\n        ${renderGroupeNotes(r)}\n        ${ficheCaisse(r, moment, droits)}' }] },
  { nom: 'arrivee-absente', lettre: 'P1', scenarios: ORDI, editions: [{ fichier: JS, de: '      ${ficheArrivee(r, moment, droits)}\n', vers: '' }] },
  { nom: 'case-en-icone', lettre: 'P1', scenarios: ORDI, editions: [{ fichier: JS, de: "${etape.fait ? ACTIVITY_CHECK_SVG : (enFiche ? '' :", vers: "${etape.fait ? ACTIVITY_CHECK_SVG : (false ? '' :" }] },
  { nom: 'photo-perdue', lettre: 'P1', scenarios: ORDI, editions: [{ fichier: JS, de: '      ${ficheVisuelActivite(r, etape)}\n', vers: '' }] },
  { nom: 'payer-hors-de-la-caisse', lettre: 'P2', scenarios: ORDI, editions: [{ fichier: JS, de: '      ${boutons ? `<div class="res-status-row gc-sheet-states fz-payer">${boutons}</div>` : \'\'}\n', vers: '' }] },
  { nom: 'gestes-absents', lettre: 'G1', scenarios: ORDI, editions: [{ fichier: JS, de: "        ${isEdit ? '' : ficheOutils(r, ficheDroits())}\n", vers: '' }] },
  { nom: 'retard-avec-minutes', lettre: 'G1', scenarios: ORDI, editions: [{ fichier: JS, de: '${FICHE_ICONE_HORLOGE}Retard</button>', vers: "${FICHE_ICONE_HORLOGE}${enRetard ? 'En retard de 15 min' : 'Retard'}</button>" }] },
  { nom: 'activite-sur-deux-lignes', lettre: 'U1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .fx-programme .gc-step-what { flex-direction: row; flex-wrap: wrap; align-items: baseline; gap: 0 8px; }', vers: '.fx-modal .fx-programme .gc-step-what { flex-direction: column; padding: 8px 0; }' }] },
  { nom: 'ajouter-perdu', lettre: 'C2', scenarios: ORDI, editions: [{ fichier: JS, de: "onclick=\"modifierDepuisFiche('telephone', event)\">Ajouter</button>", vers: "onclick=\"modifierDepuisFiche('telephone', event)\"></button>" }] },
  { nom: 'gestes-encadres', lettre: 'G1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .fx-outils .fx-outil { min-height: 34px; padding: 0 10px; border: 0; background: none; }', vers: '.fx-modal .fx-outils .fx-outil { min-height: 34px; padding: 0 10px; background: none; }' }] },
  { nom: 'annuler-en-tete', lettre: 'G1', scenarios: ORDI, editions: [{ fichier: JS, de: "  const rangee = boutons.filter(Boolean);\n  if (!rangee.length) return '';\n  return `<div class=\"fx-outils\"", vers: "  const rangee = boutons.concat(ficheAnnuler(r, droits)).filter(Boolean);\n  if (!rangee.length) return '';\n  return `<div class=\"fx-outils\"" }] },
  { nom: 'retard-rouge-partout', lettre: 'G1', scenarios: ORDI, editions: [{ fichier: JS, de: "const enRetard = getStaffDashboardStatusMeta(r).className === 'late';", vers: 'const enRetard = true;' }] },
  { nom: 'retard-qui-ne-s-ouvre-pas', lettre: 'G1', scenarios: ORDI, editions: [{ fichier: JS, de: '  if (plisRetardOuverts.has(n)) plisRetardOuverts.delete(n); else plisRetardOuverts.add(n);', vers: '' }] },
  { nom: 'note-sans-curseur', lettre: 'G1', scenarios: ORDI, editions: [{ fichier: JS, de: '  const champ = document.getElementById(`gcNoteEquipe${id}`);\n  if (champ) champ.focus();', vers: '  const champ = document.getElementById(`gcNoteEquipe${id}`);' }] },
  { nom: 'joueurs-sans-geste', lettre: 'G1', scenarios: ORDI, editions: [{ fichier: JS, de: "const FICHE_CHAMPS_MODIFIABLES = { heure: 'editStartInput', joueurs: 'editPaxInput' };", vers: "const FICHE_CHAMPS_MODIFIABLES = { heure: 'editStartInput' };" }] },
  { nom: 'client-non-renseigne', lettre: 'C2', scenarios: ORDI, editions: [{ fichier: JS, de: "!r.phone && !r.email ? 'Ni téléphone ni e-mail'", vers: "!r.phone && !r.email ? 'Non renseigné'" }] },
  { nom: 'etat-en-pastille', lettre: 'V1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .gc-step .gc-step-state { padding: 0; border-radius: 0; background: none;', vers: '.fx-modal .gc-step .gc-step-state { border-radius: 0;' }] },
  { nom: 'libre-redit', lettre: 'V1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .gc-step.is-libre .gc-step-state { display: none; }', vers: '.fx-modal .gc-step.is-libre .gc-step-state { }' }] },
  { nom: 'deborde-au-telephone', lettre: 'L1', scenarios: [{ appareil: 'telephone' }], editions: [{ fichier: CSS, de: '.fx-modal .dossier-facts .dossier-fact strong { font-size: 13.5px; font-weight: 500; line-height: 1.5; white-space: nowrap;', vers: '.fx-modal .dossier-facts .dossier-fact strong { font-size: 13.5px; font-weight: 500; line-height: 1.5; white-space: nowrap; display: inline-block; min-width: 520px;' }] },
  { nom: 'fin-11px', lettre: 'L1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .fx-programme .gc-step-time small { margin-top: 2px; font-family: var(--font-ui); font-size: 12px;', vers: '.fx-modal .fx-programme .gc-step-time small { margin-top: 2px; font-family: var(--font-ui); font-size: 11px;' }] },
];

async function main() {
  const serveur = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      for (const s of SCENARIOS) await scenario(browser, s);
    } else {
      console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.FS_MUTATIONS || liste(process.env.FS_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.FS_BAVARD;
        try {
          for (const s of m.scenarios) await scenario(browser, s);
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
  if (echecs) { console.error(`\nfiche-simple-check: FAIL ${echecs}`); process.exitCode = 1; return; }
  console.log(`\nfiche-simple-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
