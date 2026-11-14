// LA FICHE D UN COUP D OEIL (la fiche d une reservation, 2026-10-26).
//
// Movsar, 26/10 : « un truc bcp plus simple moins ia complet avec toutes les
// infos mais super bien positionner [...] on regarde on sait direct prcq celui
// actuel tout est reparti partout avec des repetitions ». La regle : chaque
// information a UNE place.
//   [T1] l en-tete dit d abord, en grand, l heure, les joueurs (Movsar,
//        27/10 : « heure activité joueur plus visible ») et la formule, puis
//        le jour, le lieu et le numero en texte courant ; aucun libelle ecrit,
//        les libelles restent pour la synthese vocale ;
//   [T2] l occasion s ecrit en texte, pas en pastille ;
//   [T3] la formule du catalogue en grand, ou « À la carte » (Ansar, 14/11 :
//        « savoir si c une formule ou pas ») ; l occasion ne la redit pas ;
//   [E1] la ligne d etat ne redit pas la pastille de l en-tete, et aucun
//        bandeau ne la redit au-dessus ;
//   [E2] elle dit ce que la pastille ne dit pas : l heure de fin, l heure
//        d arrivee, le retard en minutes, la raison d une demande a verifier ;
//   [E3] le retard et la demande a verifier se lisent en couleur, « Appeler »
//        a cote quand le dossier a un numero ;
//   [A1] l argent se dit UNE fois, sur la ligne d etat (« À encaisser 118 € »,
//        « Encaissé 390 € ») ; l addition ne le redit pas ;
//   [A2] une addition d une ligne n ecrit pas son total une deuxieme fois ;
//        plusieurs lignes ont leur total et le prix par joueur ;
//   [C1] (2026-11-14) l etat et ses gestes, puis les notes sur toute la
//        largeur, puis le programme seul a gauche et, a droite, le prix, le
//        client et le pli Historique ; les notes se lisent sans faire defiler ;
//   [G1] (Ansar, 14/11 : « pour des etudiants jeunes il faut un truc simple
//        rapide et complet [...] le retard [...] la note [...] modifier
//        rapidement ») sous les etats, « Retard », « Note pour l’équipe »,
//        « Message au client » et « Annuler la réservation » se touchent sans
//        faire defiler ; le retard est rouge quand la pastille dit « En
//        retard », jamais de minutes dans son libelle ; il ouvre ses minutes
//        juste dessous, la note ouvre son champ le curseur dedans, toucher les
//        joueurs ouvre « Modifier » sur leur nombre ;
//   [C2] le client sans libelle : un numero, une adresse, ou une seule ligne
//        pour ce qui manque ;
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
  const moment = m.querySelector('.fx-act .fx-moment');
  const span = moment && moment.querySelector(':scope > span');
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
  const vuSansDefiler = (el) => { const b = R(el); return b.width > 0 && b.top >= Math.max(0, corpsR.top) - 1 && b.bottom <= Math.min(innerHeight, corpsR.bottom) + 1; };
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
    moment: ligne(moment),
    momentPhrase: ligne(span),
    momentCouleur: span ? cs(span).color : '',
    momentTon: moment ? (moment.className.match(/is-(retard|verifier)/) || [''])[0] : '',
    danger,
    warning,
    appel: Boolean(moment && moment.querySelector('a.fx-appel[href^="tel:"]')),
    retard: mo && mo.late ? Math.max(1, Math.round((mo.now - mo.item.start) * 60)) : 0,
    attendu: mo && mo.item ? formatClockDisplay(mo.item.start) : '',
    fin: mo && mo.item ? formatClockDisplay(mo.item.end) : '',
    telephone: Boolean(r.phone),
    bandeaux: m.querySelectorAll('.fx-bandeau').length,
    argent: ligne(m.querySelector('.fx-act .pos-act-money')),
    corps: txt(corps),
    addition: ligne(m.querySelector('.gc-bill')),
    lignesAddition: Array.from(m.querySelectorAll('.gc-bill-lines > div')).map((d) => txt(d)),
    total: ligne(m.querySelector('.gc-bill-total')),
    principal: principal ? Array.from(principal.children).map((c) => c.className) : [],
    cote: cote ? Array.from(cote.children).map((c) => (c.matches('.gc-notes') ? 'notes' : c.matches('.gc-bill') ? 'prix' : c.matches('.fx-client') ? 'client' : c.matches('.fx-historique') ? 'historique' : c.matches('.fx-pli') ? 'pli' : c.className)) : [],
    ordre: feuille ? Array.from(feuille.children).map((c) => (c.matches('.fx-act') ? 'etat' : c.matches('.gc-notes') ? 'notes' : c.matches('.fx-colonnes') ? 'colonnes' : c.matches('.pos-absent') ? 'pas-venu' : c.className)) : [],
    attenduNotes: Boolean(String(r.notes || '').trim()),
    formuleCatalogue,
    outils: Array.from(m.querySelectorAll('.fx-act .fx-outils .fx-outil')).map((b) => ({ t: txt(b), vu: vuSansDefiler(b), rouge: b.classList.contains('is-retard') })),
    notesHaut: notes ? Math.round(R(notes).top) : null,
    corpsBas: Math.round(R(corps).bottom),
    client: ligne(m.querySelector('.fx-client')),
    vides: Array.from(m.querySelectorAll('.fx-client .fx-vide')).map((e) => txt(e)),
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
    apresLaRangee: Boolean(p && p.previousElementSibling && p.previousElementSibling.matches('.fx-outils')),
    minutes: p ? Array.from(p.querySelectorAll('.delay-chip:not(.delay-chip-now):not(.delay-chip-run)')).map((b) => b.textContent.trim()) : [],
    autre: Boolean(p && p.querySelector('#delayCustomMinutes')),
  };
  q('.fx-outil-retard').click();
  await attendre();
  g.retard.referme = !q(`#fxRetard${r.id}`);
  q('.gc-note-ouvrir').click();
  await attendre();
  g.note = { focus: actif(), dansLesNotes: Boolean(q(`.fx > .gc-notes #gcNoteEquipe${r.id}`)) };
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
  ok(g.retard.ouvert && g.retard.expanded === 'true' && g.retard.apresLaRangee && g.retard.minutes.join() === '+5 min,+10 min,+15 min,+20 min,+30 min' && g.retard.autre && g.retard.referme,
    `[G1] ${label} : « Retard » ouvre ses minutes juste sous la rangee, puis se referme`, g.retard);
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
  ok(chiffres.length === 3 && memeLigne(chiffres[0], chiffres[1]) && (!ordi || memeLigne(chiffres[0], chiffres[2])) && courants.every((x) => x.haut >= Math.max(...chiffres.map((c) => c.bas)) - 2), `[T1] ${label} : l heure et les joueurs sur une ligne${ordi ? ', la formule a cote' : ''}, les faits courants dessous`, f.faits.map((x) => `${x.valeur}@${x.haut}`));
  if (ordi) ok(new Set(courants.map((x) => x.haut)).size === 1, `[T1] ${label} : les faits courants tiennent sur une ligne`, courants.map((x) => `${x.valeur}@${x.haut}`));
  // [T2]
  ok(f.etiquettes.every((e) => (/rgba\([^)]*,\s*0\)$|transparent/.test(e.fond)) && e.pad === '0px'), `[T2] ${label} : l occasion s ecrit en texte, pas en pastille`, f.etiquettes);
  // [T3]
  const formuleVue = chiffres[2] ? chiffres[2].valeur : '';
  ok(formuleVue === (f.formuleCatalogue || 'À la carte') && (!f.formuleCatalogue || f.etiquettes.every((e) => !e.t.includes(f.formuleCatalogue))),
    `[T3] ${label} : ${f.formuleCatalogue ? `la formule « ${f.formuleCatalogue} » en grand, l occasion ne la redit pas` : '« À la carte » en grand'}`, { vue: formuleVue, catalogue: f.formuleCatalogue, etiquettes: f.etiquettes.map((e) => e.t) });
  // [E1]
  ok(f.pastille === f.pastilleAttendue, `[E1] ${label} : la pastille de l en-tete dit « ${f.pastilleAttendue} »`, f.pastille);
  ok(f.moment && !f.moment.toLowerCase().includes(f.pastille.toLowerCase()) && f.bandeaux === 0,
    `[E1] ${label} : la ligne d etat ne redit pas « ${f.pastille} », aucun bandeau au-dessus`, { moment: f.moment, bandeaux: f.bandeaux });
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
    `[A1] ${label} : l argent une fois, sur la ligne d etat (« ${f.argent} »), l addition ne le redit pas`, { argent: f.argent, fois: mots, addition: f.addition });
  // [A2]
  if (f.lignesAddition.length === 1) {
    const montant = f.prix.replace(/\s/g, '');
    const fois = (f.addition.replace(/\s/g, '').split(montant).length - 1);
    ok(!f.total && fois === 1, `[A2] ${label} : une ligne, pas de total redit (${montant} ${fois} fois)`, f.addition);
  } else {
    ok(new RegExp(`^Total\\s*${f.prix.replace(/\s/g, '\\s*')}`).test(f.total) && /par (joueur|personne présente)/.test(f.total), `[A2] ${label} : plusieurs lignes, leur total et le prix par joueur`, f.total);
  }
  // [C1] (le pli Historique ferme la colonne, 2026-11-03 : la session de la
  // fixture, Direction, a le niveau « historique » ; « Pas venu » se lit
  // juste sous l etat quand le groupe est en retard sur son heure)
  const sansPasVenu = f.ordre.filter((x) => x !== 'pas-venu');
  const placePasVenu = f.ordre.indexOf('pas-venu');
  ok(JSON.stringify(sansPasVenu) === JSON.stringify(['etat'].concat(f.attenduNotes ? ['notes'] : [], ['colonnes'])) && (placePasVenu === -1 || placePasVenu === 1)
    && f.principal.length === 1 && /fx-programme/.test(f.principal[0]) && JSON.stringify(f.cote) === JSON.stringify(['prix', 'client', 'historique']),
    `[C1] ${label} : l etat et ses gestes, ${f.attenduNotes ? 'les notes sur toute la largeur, ' : ''}puis le programme seul a gauche et le prix, le client, l historique a droite`, { ordre: f.ordre, principal: f.principal, cote: f.cote });
  if (ordi && f.attenduNotes) ok(f.notesHaut !== null && f.notesHaut < f.corpsBas - 40, `[C1] ${label} : les notes se lisent sans faire defiler`, { notes: f.notesHaut, bas: f.corpsBas });
  // [G1]
  const retardAttendu = f.pastille === 'En retard' ? 'En retard' : 'Retard';
  ok(JSON.stringify(f.outils.map((o) => o.t)) === JSON.stringify([retardAttendu, 'Note pour l’équipe', 'Message au client', 'Annuler la réservation'])
    && f.outils.every((o) => o.vu) && f.outils.every((o, i) => o.rouge === (i === 0 && f.pastille === 'En retard')),
    `[G1] ${label} : « ${retardAttendu} », la note, le message et Annuler se touchent sans faire defiler, le retard rouge seulement en retard`, f.outils);
  // [C2]
  const joignable = f.liens.length > 0;
  ok(!/non renseign/i.test(f.client) && (joignable
    ? f.liens.join() === 'tel,mailto' && f.icones === 2 && f.vides.length === 0
    : f.vides.join() === 'Ni téléphone ni e-mail'),
  `[C2] ${label} : le client sans libelle, ${joignable ? 'un numero et une adresse' : 'une seule ligne pour ce qui manque'}`, { client: f.client, liens: f.liens, vides: f.vides });
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
  { nom: 'chiffres-petits', lettre: 'T1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .fx-chiffres .dossier-fact strong { font-size: 26px;', vers: '.fx-modal .fx-chiffres .dossier-fact strong { font-size: 15px;' }] },
  { nom: 'faits-empiles', lettre: 'T1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .dossier-fact { display: inline; }', vers: '.fx-modal .dossier-fact { display: grid; }' }] },
  { nom: 'occasion-en-pastille', lettre: 'T2', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .fx-etiquette { display: inline; padding: 0; border-radius: 0; background: none;', vers: '.fx-modal .fx-etiquette { display: inline; border-radius: 0;' }] },
  { nom: 'pastille-redite', lettre: 'E1', scenarios: ORDI, editions: [{ fichier: JS, de: "      : `Fin prévue à ${formatClockDisplay(span.end)}`;", vers: "      : `Sur place, fin prévue à ${formatClockDisplay(span.end)}`;" }] },
  { nom: 'bandeau-revenu', lettre: 'E1', scenarios: ORDI, editions: [{ fichier: JS, de: '  return `<section class="pos-act fx-act" aria-label="État du dossier">', vers: '  return `${ton ? \'<div class="fx-bandeau"><p>Attention</p></div>\' : \'\'}<section class="pos-act fx-act" aria-label="État du dossier">' }] },
  { nom: 'retard-sans-minutes', lettre: 'E2', scenarios: ORDI, editions: [{ fichier: JS, de: '  if (moment && moment.late) return `Attendu à ${formatClockDisplay(moment.item.start)}, il y a ${formatStaffTerrainDelay(moment.now - moment.item.start)}`;', vers: "  if (moment && moment.late) return 'Pas encore arrivé';" }] },
  { nom: 'retard-sans-couleur', lettre: 'E3', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .fx-moment.is-retard > span { color: var(--danger); }', vers: '.fx-modal .fx-moment.is-retard > span { }' }] },
  { nom: 'appel-perdu', lettre: 'E3', scenarios: ORDI, editions: [{ fichier: JS, de: "${ton ? ficheAppeler(r) : ''}</p>", vers: '</p>' }] },
  { nom: 'paye-dans-l-addition', lettre: 'A1', scenarios: ORDI, editions: [{ fichier: JS, de: "    ${seule ? (unite ? `<p class=\"gc-bill-unit\">", vers: "    <span>${r.status === 'paid' ? 'Payé' : 'À encaisser'}</span>${seule ? (unite ? `<p class=\"gc-bill-unit\">" }] },
  { nom: 'encaisse-deux-fois', lettre: 'A1', scenarios: ORDI, editions: [{ fichier: JS, de: '      <details class="pos-encaisse-corriger">', vers: '      <span class="pos-encaisse-ligne">Encaissé ${escapeHtml(formatMoneyCentimes(montant))}</span><details class="pos-encaisse-corriger">' }] },
  { nom: 'total-d-une-ligne', lettre: 'A2', scenarios: ORDI, editions: [{ fichier: JS, de: '  const seule = lignes.length === 1 &&', vers: '  const seule = false &&' }] },
  { nom: 'notes-dans-la-colonne', lettre: 'C1', scenarios: ORDI, editions: [
    { fichier: JS, de: "    ${aTrancher ? pasVenu : ''}\n    ${renderGroupeNotes(r)}\n    <div class=\"fx-colonnes\">", vers: "    ${aTrancher ? pasVenu : ''}\n    <div class=\"fx-colonnes\">" },
    { fichier: JS, de: '      <aside class="fx-cote">\n        ${renderGroupeAddition(r)}', vers: '      <aside class="fx-cote">\n        ${renderGroupeNotes(r)}\n        ${renderGroupeAddition(r)}' }] },
  { nom: 'gestes-absents', lettre: 'G1', scenarios: ORDI, editions: [{ fichier: JS, de: '      ${ficheOutils(r, droits)}\n', vers: '' }] },
  { nom: 'retard-avec-minutes', lettre: 'G1', scenarios: ORDI, editions: [{ fichier: JS, de: "${enRetard ? 'En retard' : 'Retard'}</button>", vers: "${enRetard ? 'En retard de 15 min' : 'Retard'}</button>" }] },
  { nom: 'retard-rouge-partout', lettre: 'G1', scenarios: ORDI, editions: [{ fichier: JS, de: "const enRetard = getStaffDashboardStatusMeta(r).className === 'late';", vers: 'const enRetard = true;' }] },
  { nom: 'retard-qui-ne-s-ouvre-pas', lettre: 'G1', scenarios: ORDI, editions: [{ fichier: JS, de: '  if (plisRetardOuverts.has(n)) plisRetardOuverts.delete(n); else plisRetardOuverts.add(n);', vers: '' }] },
  { nom: 'note-sans-curseur', lettre: 'G1', scenarios: ORDI, editions: [{ fichier: JS, de: '  const champ = document.getElementById(`gcNoteEquipe${id}`);\n  if (champ) champ.focus();', vers: '  const champ = document.getElementById(`gcNoteEquipe${id}`);' }] },
  { nom: 'joueurs-sans-geste', lettre: 'G1', scenarios: ORDI, editions: [{ fichier: JS, de: "const FICHE_CHAMPS_MODIFIABLES = { heure: 'editStartInput', joueurs: 'editPaxInput' };", vers: "const FICHE_CHAMPS_MODIFIABLES = { heure: 'editStartInput' };" }] },
  { nom: 'client-non-renseigne', lettre: 'C2', scenarios: ORDI, editions: [{ fichier: JS, de: "!r.phone && !r.email ? 'Ni téléphone ni e-mail'", vers: "!r.phone && !r.email ? 'Non renseigné'" }] },
  { nom: 'etat-en-pastille', lettre: 'V1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .gc-step .gc-step-state { padding: 0; border-radius: 0; background: none;', vers: '.fx-modal .gc-step .gc-step-state { border-radius: 0;' }] },
  { nom: 'libre-redit', lettre: 'V1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .gc-step.is-libre .gc-step-state { display: none; }', vers: '.fx-modal .gc-step.is-libre .gc-step-state { }' }] },
  { nom: 'deborde-au-telephone', lettre: 'L1', scenarios: [{ appareil: 'telephone' }], editions: [{ fichier: CSS, de: '.fx-modal .dossier-fact strong { font-size: 15px; font-weight: 500; line-height: 1.5; white-space: nowrap;', vers: '.fx-modal .dossier-fact strong { font-size: 15px; font-weight: 500; line-height: 1.5; white-space: nowrap; display: inline-block; min-width: 520px;' }] },
  { nom: 'fin-11px', lettre: 'L1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .fx-programme .gc-step-time small { margin-top: 1px; font-size: 13px; }', vers: '.fx-modal .fx-programme .gc-step-time small { margin-top: 1px; font-size: 11px; }' }] },
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
