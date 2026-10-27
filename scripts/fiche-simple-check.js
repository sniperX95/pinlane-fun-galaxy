// LA FICHE D UN COUP D OEIL (la fiche d une reservation, 2026-10-26).
//
// Movsar, 26/10 : « un truc bcp plus simple moins ia complet avec toutes les
// infos mais super bien positionner [...] on regarde on sait direct prcq celui
// actuel tout est reparti partout avec des repetitions ». La regle : chaque
// information a UNE place.
//   [T1] l en-tete dit d abord, en grand, l heure et les joueurs (Movsar,
//        27/10 : « heure activité joueur plus visible »), puis le jour, le
//        lieu et le numero en texte courant ; aucun libelle ecrit, les
//        libelles restent pour la synthese vocale ;
//   [T2] l occasion et la formule s ecrivent en texte, pas en pastille ;
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
//   [C1] le programme seul a gauche ; a droite, dans l ordre, les notes, le
//        prix, le client ; les notes se lisent sans faire defiler la fiche ;
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
  { nom: 'Famille Renard', etat: 'À clôturer' },
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
    cote: cote ? Array.from(cote.children).map((c) => (c.matches('.gc-notes') ? 'notes' : c.matches('.gc-bill') ? 'prix' : c.matches('.fx-client') ? 'client' : c.matches('.fx-pli') ? 'pli' : c.className)) : [],
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

// ---------------------------------------------------------------------------
// LES REGLES, par dossier.
// ---------------------------------------------------------------------------
const RX_ARGENT = (f) => new RegExp(`^${f.paye ? 'Encaissé' : 'À encaisser'}\\s*${f.prix.replace(/\s/g, '\\s*')}$`);
function juger(f, label, appareil) {
  const ordi = !['telephone', 'tablette-portrait'].includes(appareil);
  // [T1]
  const chiffres = f.faits.filter((x) => x.ligne === 'chiffres');
  const courants = f.faits.filter((x) => x.ligne === 'faits');
  ok(chiffres.map((x) => x.libelle).join() === 'Horaires,Groupe' && courants.map((x) => x.libelle).join() === 'Date,Ressources,Réservation' && f.faits.every((x) => x.valeur && !x.libVu),
    `[T1] ${label} : l heure et les joueurs d abord, puis le jour, le lieu et le numero, sans libelle ecrit`, f.faits);
  const plusPetitChiffre = Math.min(...chiffres.map((x) => x.px));
  ok(plusPetitChiffre >= 22 && courants.every((x) => x.px <= 15 && x.px < plusPetitChiffre), `[T1] ${label} : l heure et les joueurs en grand (${plusPetitChiffre} px), le reste en texte courant`, f.faits.map((x) => `${x.valeur}:${x.px}`));
  // Une ligne : les deux boites se recouvrent en hauteur (le nombre de joueurs
  // et l heure n ont pas la meme taille, leurs hauts different).
  ok(chiffres.length === 2 && chiffres[1].haut < chiffres[0].bas && chiffres[1].bas > chiffres[0].haut && courants.every((x) => x.haut >= Math.max(...chiffres.map((c) => c.bas)) - 2), `[T1] ${label} : les deux chiffres sur une ligne, les faits courants dessous`, f.faits.map((x) => `${x.valeur}@${x.haut}`));
  if (ordi) ok(new Set(courants.map((x) => x.haut)).size === 1, `[T1] ${label} : les faits courants tiennent sur une ligne`, courants.map((x) => `${x.valeur}@${x.haut}`));
  // [T2]
  ok(f.etiquettes.length > 0 && f.etiquettes.every((e) => (/rgba\([^)]*,\s*0\)$|transparent/.test(e.fond)) && e.pad === '0px'), `[T2] ${label} : l occasion s ecrit en texte, pas en pastille`, f.etiquettes);
  // [E1]
  ok(f.pastille === f.pastilleAttendue, `[E1] ${label} : la pastille de l en-tete dit « ${f.pastilleAttendue} »`, f.pastille);
  ok(f.moment && !f.moment.toLowerCase().includes(f.pastille.toLowerCase()) && f.bandeaux === 0,
    `[E1] ${label} : la ligne d etat ne redit pas « ${f.pastille} », aucun bandeau au-dessus`, { moment: f.moment, bandeaux: f.bandeaux });
  // [E2]
  const attendu = {
    'Sur place': new RegExp(`^Fin prévue à ${f.fin}$`),
    'À clôturer': new RegExp(`^Visite finie à ${f.fin}`),
    'À venir': new RegExp(`^(Arrive dans .+|Attendu maintenant), à ${f.attendu}$`),
    'En retard': new RegExp(`^Attendu à ${f.attendu}, il y a (${f.retard} min|\\d+ h( \\d\\d)?)$`),
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
  // [C1]
  const attenduCote = ['notes', 'prix', 'client'].concat(f.pastille === 'En retard' || (f.retard && f.pastille === 'À vérifier') ? [] : ['pli']);
  ok(f.principal.length === 1 && /fx-programme/.test(f.principal[0]) && JSON.stringify(f.cote) === JSON.stringify(attenduCote),
    `[C1] ${label} : le programme seul a gauche, puis notes, prix, client a droite`, { principal: f.principal, cote: f.cote });
  if (ordi) ok(f.notesHaut !== null && f.notesHaut < f.corpsBas - 40, `[C1] ${label} : les notes se lisent sans faire defiler`, { notes: f.notesHaut, bas: f.corpsBas });
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
  { nom: 'libelles-ecrits', lettre: 'T1', scenarios: ORDI, editions: [{ fichier: JS, de: '<span class="visually-hidden">${libelle} </span>', vers: '<span>${libelle} </span>' }] },
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
  { nom: 'notes-sous-le-programme', lettre: 'C1', scenarios: ORDI, editions: [{ fichier: JS, de: '        </section>\n      </div>\n      <aside class="fx-cote">\n        ${renderGroupeNotes(r)}', vers: '        </section>\n        ${renderGroupeNotes(r)}\n      </div>\n      <aside class="fx-cote">' }] },
  { nom: 'client-non-renseigne', lettre: 'C2', scenarios: ORDI, editions: [{ fichier: JS, de: "!r.phone && !r.email ? 'Ni téléphone ni e-mail'", vers: "!r.phone && !r.email ? 'Non renseigné'" }] },
  { nom: 'etat-en-pastille', lettre: 'V1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .gc-step .gc-step-state { padding: 0; border-radius: 0; background: none;', vers: '.fx-modal .gc-step .gc-step-state { border-radius: 0;' }] },
  { nom: 'libre-redit', lettre: 'V1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .gc-step.is-libre .gc-step-state { display: none; }', vers: '.fx-modal .gc-step.is-libre .gc-step-state { }' }] },
  { nom: 'deborde-au-telephone', lettre: 'L1', scenarios: [{ appareil: 'telephone' }], editions: [{ fichier: CSS, de: '.fx-modal .dossier-fact strong { font-size: 15px; font-weight: 500; line-height: 1.5; white-space: nowrap;', vers: '.fx-modal .dossier-fact strong { font-size: 15px; font-weight: 500; line-height: 1.5; white-space: nowrap; display: inline-block; min-width: 520px;' }] },
  { nom: 'fin-11px', lettre: 'L1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .fx-programme .gc-step-time small { margin-top: 1px; font-size: 13px; }', vers: '.fx-modal .fx-programme .gc-step-time small { margin-top: 1px; font-size: 11px; }' }] },
  { nom: 'detail-11px', lettre: 'L1', scenarios: ORDI, editions: [{ fichier: CSS, de: '.fx-modal .fx-moment-suite { margin: -4px 0 12px; font-size: 13px;', vers: '.fx-modal .fx-moment-suite { margin: -4px 0 12px; font-size: 11px;' }] },
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
if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
