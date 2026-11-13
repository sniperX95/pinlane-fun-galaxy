// LES DEMANDES SUR MESURE, DANS LA CONSOLE (v5, le bureau des groupes, 2026-11-13).
//
// Ansar : « refaire tout la categorie demande sur mesure du logiciel ». Une boite de reception : la
// liste a gauche, la demande ouverte a droite, ce que le client demande d un cote et ce que Pinlane a
// prepare de l autre. Ce gate pilote la VRAIE page par de vrais clics, sur le banc des demandes
// (scripts/demandes-banc.js : le contrat du serveur, le flux de POST /api/assistant en mode demande) :
//   [A] la liste : l ordre de l heure promise, les onglets, la plus pressee ouverte sur grand ecran,
//       une preparation enregistree qui ne relance pas Pinlane ;
//   [B] la demande dit tout ce que le client a rempli, son client connu, ses seuls mails ;
//   [C] Pinlane a l ouverture : un seul appel en mode demande, ses lectures, la reservation et le mail,
//       rien ne part sans le clic ;
//   [D] une consigne : demandeId et la consigne partent, l ancien et le nouveau se voient ;
//   [E] deux consignes : la seconde remplace la premiere, meme quand la premiere repond en retard ;
//   [F] « Envoyer la proposition » : customRequestId et la reservation partent avec le mail ;
//   [G] reserver ce qui a ete propose : la simulation, puis la creation au seul clic ;
//   [H] « Modifier dans Réserver » reprend l heure, le programme et le prix convenu ;
//   [I] le planning du jour et le client en fenetre, sans changer d adresse ni de page, Echap ferme ;
//   [J] aucun appel ne pose un statut que la base refuse ;
//   [K] telephone et tablette : la liste d abord, rien ne deborde ;
//   [M] l echeance suit l heure, sans repeindre la page ;
//   [N] l alerte du tableau de bord liste ce qui attend l equipe ;
//   [O] une preparation perimee repart toute seule, une demande sans formulaire attend la consigne,
//       les terminees disent comment elles ont fini, sans suite et rouvrir ;
//   [P] Pinlane indisponible : la page le dit, les gestes restent a la main ;
//   [Q] un role sans droit d envoi ne lance pas Pinlane ;
//   [R] noter, classer, retenir : rien ne se fait sans le clic ;
//   [L] contre-epreuves : le code casse expres fait rougir le gate.
// Les captures vont dans artifacts/demandes-console/.
// PINLANE_SANS_CONTRE_PREUVES=1 : [L] verifie seulement que chaque coupure se monte encore.
// PINLANE_CONTRE_PREUVES_SEULES="morceau|autre" : ne rejoue que ces coupures.
'use strict';
const SANS_CONTRE_PREUVES = process.env.PINLANE_SANS_CONTRE_PREUVES === '1';
const SEULES = String(process.env.PINLANE_CONTRE_PREUVES_SEULES || '').split('|').filter(Boolean);
const fs = require('fs');
const p = require('path');
const { chromium } = require('playwright-core');
const { creerBanc, datesDuBanc } = require('./demandes-banc.js');

const ROOT = p.resolve(__dirname, '..');
const EDGE = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = p.join(ROOT, 'artifacts', 'demandes-console');
const APP = p.join(ROOT, 'assets', 'app-main.js');

let echecs = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `\n      ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return cond;
}
function section(titre) { console.log(`\n[${titre}]`); }

// La coupure en cours (contre-epreuves) : le banc la pose sur le fichier servi, le depot n est jamais touche.
let mutation = null;

async function ouvrir(browser, { largeur = 1440, hauteur = 900, theme = 'light', horloge = false, avant = null, menu = true } = {}) {
  const banc = creerBanc({ mutation: () => mutation });
  if (avant) avant(banc);
  await banc.ecouter();
  const ctx = await browser.newContext({ viewport: { width: largeur, height: hauteur } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  if (horloge) await page.clock.install({ time: new Date() });
  await page.goto(`${banc.url}/?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.openStaffMenuPage === 'function', null, { timeout: 20000 });
  await page.evaluate((t) => { window.setView('staff'); if (typeof setStaffTheme === 'function') setStaffTheme(t); }, theme);
  await page.waitForTimeout(700);
  // La page Demandes, par son entree du menu : un vrai clic.
  if (menu) await page.click('.fgx-menu-nav [data-fgx-menu-key="requests"]', { timeout: 10000 });
  else await page.evaluate(() => window.openStaffMenuPage('requests'));
  await page.waitForSelector('.bdg-l', { timeout: 10000 });
  return { banc, ctx, page, erreurs, fermer: async () => { await ctx.close(); await banc.fermer(); } };
}

const texte = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.innerText.replace(/\s+/g, ' ').trim() : ''; }, sel);
const ligne = (id) => `.bdg-l[data-item-id="${id}"]`;
const appels = (banc, action) => banc.etat.appels.filter((a) => a.action === action && a.m === 'POST');
// Pinlane a fini : le mail est la et le geste principal se touche.
const prete = (page, ms = 12000) => page.waitForFunction(() => document.querySelector('.bdg-pin .bdg-mailc') && !document.querySelector('.bdg-pin .bdg-lu-l.is-cours') && !document.querySelector('.bdg-pin-pied .bdg-p[disabled]') && !/refait la réponse avec|lit la demande et prépare/.test((document.querySelector('.bdg-pin-dit') || {}).textContent || ''), null, { timeout: ms });
const pinTexte = (page) => texte(page, '.bdg-pin');
const pied = (page) => page.evaluate(() => [...document.querySelectorAll('.bdg-pin-pied button')].map((b) => ({ t: b.textContent.trim(), p: b.classList.contains('bdg-p'), off: b.disabled })));
const ongletActif = (page) => page.evaluate(() => ((document.querySelector('.bdg-onglet[aria-selected="true"]') || {}).innerText || '').replace(/\s+/g, ' ').trim());
const ouverte = (page) => page.evaluate(() => (document.querySelector('.bdg-lecture[data-request-id]') || { dataset: {} }).dataset.requestId || '');
const envoyerConsigne = async (page, id, mot) => { await page.fill(`#bdgC-${id}`, mot); await page.press(`#bdgC-${id}`, 'Enter'); };
const panne = (error) => String((error && error.message) || error).split('\n')[0];

// [A] [B] [C] [D] [F] [I] LE PARCOURS : la liste, la demande, Pinlane, une consigne, l envoi, les fenetres.
async function parcours(browser, { captures = true } = {}) {
  const o = await ouvrir(browser);
  const { banc, page } = o;
  const r = { erreurs: o.erreurs };
  const capture = (nom) => (captures ? page.screenshot({ path: p.join(SHOTS, nom) }) : null);
  try {
    r.D1 = datesDuBanc(Date.now()).D1;
    await page.waitForSelector('.bdg-lecture[data-request-id]', { timeout: 8000 });
    r.ordre = await page.evaluate(() => [...document.querySelectorAll('.bdg-l')].map((b) => b.dataset.itemId));
    r.onglets = await page.evaluate(() => [...document.querySelectorAll('.bdg-onglet')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()));
    r.depart = await page.evaluate(() => ({ id: (document.querySelector('.bdg-lecture[data-request-id]') || { dataset: {} }).dataset.requestId || '', ligne: (document.querySelector('.bdg-l[aria-current="true"]') || { dataset: {} }).dataset.itemId || '' }));
    r.retard = await texte(page, '.bdg-retard');
    r.actualiser = await page.evaluate(() => /Actualiser/.test(document.getElementById('staffUtilityPage').innerText));
    const pastille = (id) => page.evaluate((s) => { const c = document.querySelector(s); return c ? { t: c.innerText.trim(), cls: c.className } : null; }, `${ligne(id)} .bdg-pill`);
    r.puce802 = await pastille(802);
    r.puce801 = await pastille(801);
    r.ecrit804 = await texte(page, `${ligne(804)} .bdg-l-ecrit`);
    r.ligne801 = await texte(page, ligne(801));
    // 802 a sa preparation, enregistree par un collegue : elle se lit, Pinlane ne repart pas.
    await page.waitForSelector('.bdg-pin .bdg-mailc', { timeout: 8000 });
    await page.waitForTimeout(1200);
    r.relance802 = banc.etat.assistantAppels.length;
    r.prep802 = await pinTexte(page);
    await capture('liste-et-demande.png');

    // [B] [C] 801, ouverte d un clic : Pinlane la lit et prepare, ses lectures s empilent.
    banc.etat.assistant.arret = 7;
    await page.click(ligne(801));
    await page.waitForSelector('.bdg-lecture[data-request-id="801"]', { timeout: 8000 });
    await page.waitForFunction(() => document.querySelectorAll('.bdg-pin .bdg-lu-l').length >= 2, null, { timeout: 8000 });
    r.travail = await page.evaluate(() => {
      const pin = document.querySelector('.bdg-pin');
      return {
        dit: ((pin.querySelector('.bdg-pin-dit') || {}).textContent || '').trim(),
        lectures: [...pin.querySelectorAll('.bdg-lu-l')].map((l) => l.innerText.replace(/\s+/g, ' ').trim()),
        envoyer: [...document.querySelectorAll('.bdg-pin-pied button')].map((b) => ({ t: b.textContent.trim(), off: b.disabled })),
        roue: Boolean(document.querySelector('.bdg [class*="spin"], .bdg [class*="loader"], .bdg [class*="roue"]')),
      };
    });
    await capture('pinlane-travaille.png');
    banc.etat.assistant.arret = null;
    banc.relacher();
    await prete(page);
    await page.waitForTimeout(700);
    r.appelsOuverture = banc.etat.assistantAppels.map((a) => ({ id: a.demandeId, centre: a.centerId, messages: a.messages }));
    r.entete = await page.evaluate(() => {
      const t = document.querySelector('.bdg-tete');
      return {
        nom: (t.querySelector('h2') || {}).textContent || '',
        sous: ((t.querySelector('.bdg-tete-s') || {}).textContent || '').trim(),
        liens: [...t.querySelectorAll('.bdg-tete-c a')].map((a) => a.getAttribute('href')),
        gestes: [...t.querySelectorAll('.bdg-tete-a > *')].map((b) => b.textContent.trim()),
        promis: ((t.querySelector('.bdg-promis') || {}).textContent || '').trim(),
        etat: ((t.querySelector('.bdg-pill') || {}).className || ''),
      };
    });
    r.demande = await texte(page, '.bdg-demande');
    r.envies = await page.evaluate(() => [...document.querySelectorAll('.bdg-envie')].map((e) => ({ n: e.querySelector('.bdg-envie-n').textContent.trim(), t: e.dataset.t, photo: (e.querySelector('img') || { getAttribute: () => '' }).getAttribute('src') || '' })));
    r.message = await texte(page, '.bdg-mot');
    r.client = await texte(page, '.bdg-qui');
    r.venues = await page.evaluate(() => [...document.querySelectorAll('.bdg-qui .bdg-venues li')].map((l) => l.innerText.replace(/\s+/g, ' ').trim()));
    r.photoAilleurs = await page.evaluate(() => bdgPhotoDe('Bowling', 'un-autre-centre'));
    r.photoIci = await page.evaluate(() => bdgPhotoDe('Bowling', 'libramont'));
    r.mots = await page.evaluate(() => document.querySelector('.bdg-lecture').innerText);
    r.mails = await page.evaluate(() => [...document.querySelectorAll('.bdg-mail')].map((m) => ({ titre: m.querySelector('.bdg-mail-t').textContent.trim(), ouvert: Boolean(m.querySelector('.bdg-mail-c')), t: m.innerText.replace(/\s+/g, ' ') })));
    r.resa = await page.evaluate(() => {
      const c = document.querySelector('.bdg-pin .bdg-resa');
      if (!c) return null;
      return {
        t: c.innerText.replace(/\s+/g, ' '),
        gros: [...c.querySelectorAll('.bdg-resa-v .bdg-anton')].map((b) => ({ t: b.textContent.trim(), police: getComputedStyle(b).fontFamily, taille: parseFloat(getComputedStyle(b).fontSize) })),
        lignes: [...c.querySelectorAll('.bdg-resa-ligne')].map((l) => ({ t: l.dataset.t, point: getComputedStyle(l.querySelector('.bdg-pt')).backgroundColor, txt: l.innerText.replace(/\s+/g, ' ') })),
      };
    });
    r.mail = await page.evaluate(() => {
      const c = document.querySelector('.bdg-pin .bdg-mailc');
      const corps = c && c.querySelector('.bdg-mailc-c');
      return c ? { t: c.innerText, coupe: corps.scrollHeight > corps.clientHeight + 1, haut: Math.round(corps.getBoundingClientRect().height) } : null;
    });
    r.verif = await texte(page, '.bdg-pin .bdg-verif');
    r.idees = await page.evaluate(() => [...document.querySelectorAll('.bdg-pin .bdg-idee')].map((b) => b.textContent.trim()));
    r.piedPret = await pied(page);
    r.statutsOuverture = appels(banc, 'customRequestStatus').map((a) => a.corps.status);
    r.envoisAvant = banc.etat.envois.length;
    r.etude807 = banc.etat.appels.filter((a) => a.action === 'customRequestStudy' && a.id === '807').length;
    await capture('pinlane-prete.png');

    // [D] la frappe tient au repeint, puis une idee touchee part comme consigne.
    await page.click('#bdgC-801');
    await page.keyboard.type('plutôt');
    r.frappe = await page.evaluate(async () => { renderStaffUtilityPage(); await new Promise((x) => setTimeout(x, 60)); const c = document.getElementById('bdgC-801'); return { v: c ? c.value : null, focus: document.activeElement === c }; });
    await page.fill('#bdgC-801', '');
    banc.etat.assistant.arret = 9;
    await page.click('.bdg-pin .bdg-idee >> nth=0');
    await page.waitForFunction(() => /refait la réponse avec/.test((document.querySelector('.bdg-pin-dit') || {}).textContent || ''), null, { timeout: 8000 });
    r.pendant = await page.evaluate(() => ({ dit: (document.querySelector('.bdg-pin-dit') || {}).textContent || '', modifier: /Modifier le texte/.test(document.querySelector('.bdg-pin').innerText), champ: Boolean(document.getElementById('bdgC-801')) }));
    banc.etat.assistant.arret = null;
    banc.relacher();
    await page.waitForFunction(() => /Vous avez demandé/.test((document.querySelector('.bdg-pin') || {}).innerText || ''), null, { timeout: 12000 });
    await prete(page);
    await page.waitForTimeout(300);
    r.consigneAppel = banc.etat.assistantAppels[1] || null;
    r.statuts = appels(banc, 'customRequestStatus').map((a) => ({ id: a.corps.id, status: a.corps.status }));
    r.apres = await page.evaluate(() => {
      const pin = document.querySelector('.bdg-pin');
      return {
        t: pin.innerText.replace(/\s+/g, ' '),
        barres: [...pin.querySelectorAll('.bdg-resa .bdg-avant')].map((s) => s.textContent.trim()),
        heure: ((pin.querySelector('.bdg-resa-v .bdg-anton') || {}).textContent || '').trim(),
        neuves: pin.querySelectorAll('.bdg-resa-ligne.is-neuve').length,
        ins: pin.querySelectorAll('.bdg-mailc .bdg-ins').length,
        del: pin.querySelectorAll('.bdg-mailc .bdg-del').length,
      };
    });
    await capture('apres-consigne.png');
    await page.click('.bdg-vues button:has-text("Tel qu’il partira")');
    await page.waitForFunction(() => !document.querySelector('.bdg-pin .bdg-mailc .bdg-ins'), null, { timeout: 4000 }).catch(() => {});
    r.propre = await page.evaluate(() => ({ ins: document.querySelectorAll('.bdg-pin .bdg-mailc .bdg-ins').length, t: (document.querySelector('.bdg-pin .bdg-mailc-c') || {}).textContent || '' }));
    r.suivi = await texte(page, '.bdg-suivi');
    r.envoisApresConsigne = banc.etat.envois.length;

    // [F] Envoyer la proposition : le mail a l ecran, la reservation avec lui, le texte de Pinlane comme original.
    const avantEnvoi = banc.etat.assistantAppels.length;
    r.mailAEnvoyer = await page.evaluate(() => ({ objet: (document.querySelector('.bdg-pin .bdg-mailc-o') || {}).textContent || '', corps: (document.querySelector('.bdg-pin .bdg-mailc-c') || {}).textContent || '' }));
    await page.click('.bdg-pin-pied button:has-text("Envoyer la proposition")');
    await page.waitForFunction(() => /Le client n’a pas encore répondu/.test((document.querySelector('.bdg-pin') || {}).innerText || ''), null, { timeout: 8000 });
    await page.waitForTimeout(400);
    r.envoi = { corps: banc.etat.envois[0] || null, n: banc.etat.envois.length };
    r.apresEnvoi = await page.evaluate(() => ({
      onglet: ((document.querySelector('.bdg-onglet[aria-selected="true"]') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
      ouverte: (document.querySelector('.bdg-lecture[data-request-id]') || { dataset: {} }).dataset.requestId || '',
      pin: document.querySelector('.bdg-pin').innerText.replace(/\s+/g, ' '),
      pied: [...document.querySelectorAll('.bdg-pin-pied button')].map((b) => ({ t: b.textContent.trim(), p: b.classList.contains('bdg-p') })),
      mails: [...document.querySelectorAll('.bdg-mail-t')].map((b) => b.textContent.trim()),
      suivi: document.querySelector('.bdg-suivi').innerText.replace(/\s+/g, ' '),
      toast: ((document.getElementById('toast') || {}).textContent || '').trim(),
    }));
    await capture('proposition-envoyee.png');
    await page.click('.bdg-pin-pied button:has-text("Préparer une autre proposition")');
    await page.waitForTimeout(350);
    r.autre = await page.evaluate(() => ({ champ: Boolean(document.getElementById('bdgC-801')), focus: (document.activeElement || {}).id || '', envoyer: /Envoyer la proposition/.test((document.querySelector('.bdg-pin-pied') || {}).innerText || '') }));
    r.autreAppels = banc.etat.assistantAppels.length - avantEnvoi;

    // [I] le planning du jour, puis le client, en fenetre : ni l adresse ni la page ne changent.
    const adresse = page.url();
    await page.click('.bdg-pin .bdg-voir-jour');
    await page.waitForSelector('.bdg-fen #bdgFenPlanning [data-gf-id]', { timeout: 10000 });
    await page.waitForTimeout(300);
    r.planning = await page.evaluate(() => ({
      titre: (document.getElementById('bdgFenT') || {}).textContent || '',
      groupes: document.querySelectorAll('.bdg-fen [data-gf-id]').length,
      marques: [...document.querySelectorAll('.bdg-fen .gf-nom__m')].map((n) => n.textContent),
      page: state.staffMenuPage,
      dessous: Boolean(document.querySelector('.bdg-lecture[data-request-id="801"]')),
    }));
    r.planning.adresse = page.url() === adresse;
    await capture('planning-du-jour.png');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.bdg-fen'), null, { timeout: 4000 }).catch(() => {});
    r.planningFerme = await page.evaluate(() => ({ ouverte: Boolean(document.querySelector('.bdg-fen')), focus: ((document.activeElement && document.activeElement.textContent) || '').trim() }));
    await page.click('.bdg-qui button:has-text("Voir sa fiche client")');
    await page.waitForSelector('.bdg-fen', { timeout: 4000 }).catch(() => {});
    r.fiche = await page.evaluate(() => ({ t: ((document.querySelector('.bdg-fen') || {}).innerText || '').replace(/\s+/g, ' '), page: state.staffMenuPage, dessous: Boolean(document.querySelector('.bdg-lecture[data-request-id="801"]')) }));
    r.fiche.adresse = page.url() === adresse;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    r.ficheFermee = await page.evaluate(() => !document.querySelector('.bdg-fen'));
  } catch (error) {
    r.panne = panne(error);
  } finally {
    await o.fermer();
  }
  return r;
}

function verifier(r) {
  section('A. LA LISTE');
  if (!ok(!r.panne, 'MONTAGE le parcours va jusqu au bout', r.panne || '')) return;
  ok(JSON.stringify(r.ordre) === JSON.stringify(['802', '801', '804', '807']), 'a traiter : le retard, puis l echeance la plus proche, puis la demande sans echeance', JSON.stringify(r.ordre));
  ok(JSON.stringify(r.onglets) === JSON.stringify(['À traiter 4', 'En attente 1', 'Terminées 2']), 'trois onglets et leurs comptes', JSON.stringify(r.onglets));
  ok(r.depart.id === '802' && r.depart.ligne === '802', 'sur grand ecran, la plus pressee s ouvre a cote de la liste, sa ligne marquee', JSON.stringify(r.depart));
  ok(r.retard === '1 en retard', 'l en-tete de la liste dit le retard, les onglets disent le reste', JSON.stringify(r.retard));
  ok(!r.actualiser, 'pas de bouton Actualiser : la page suit toute seule');
  ok(r.puce802 && r.puce802.t === 'En retard' && /is-late/.test(r.puce802.cls), 'la demande en retard le dit, en pastille rouge', JSON.stringify(r.puce802));
  ok(r.puce801 && /^Reste (1 h 5\d|2 h)$/.test(r.puce801.t) && /is-soon/.test(r.puce801.cls), 'la demande a deux heures de l echeance dit ce qu il reste', JSON.stringify(r.puce801));
  ok(/Le client a répondu/.test(r.ecrit804), 'le client qui a repondu se voit dans la liste', r.ecrit804);
  ok(/^Athénée de Libramont Reste .* Dim\. \d+ \S+ · après-midi · 31 joueurs Bowling, Laser Game, Minigolf Blacklight$/.test(r.ligne801), 'la ligne dit qui, quand, combien et quoi, dans cet ordre', r.ligne801);
  ok(r.relance802 === 0 && /19:00/.test(r.prep802) && /Le mail au client/i.test(r.prep802), 'une preparation enregistree se lit telle quelle : Pinlane ne repart pas', `${r.relance802} appel(s) ; ${r.prep802.slice(0, 120)}`);

  section('B. LA DEMANDE');
  ok(/^Athénée de Libramont$/.test(r.entete.nom.trim()) && /École, jeunesse · Ansar Bisultanov, Enseignant · reçue/.test(r.entete.sous), 'le groupe en grand, son type, qui ecrit, quand la demande est arrivee', JSON.stringify(r.entete));
  ok(r.entete.liens.includes('tel:+32470112233') && r.entete.liens.includes('mailto:ansar@example.org'), 'le telephone et le mail se touchent', JSON.stringify(r.entete.liens));
  ok(JSON.stringify(r.entete.gestes) === JSON.stringify(['Appeler', 'Sans suite']), 'en tete : appeler et classer sans suite, rien d autre', JSON.stringify(r.entete.gestes));
  ok(/^Réponse promise avant \d\d:\d\d, il reste/.test(r.entete.promis), 'l heure promise au client se lit en tete', r.entete.promis);
  ok(/Dimanche \d{1,2} \S+, l’après-midi/.test(r.demande) && /ou le vendredi \d{1,2} \S+/.test(r.demande), 'le jour et le moment, et l autre date', r.demande);
  ok(/31 joueurs de 7 à 12 ans et 3 accompagnateurs/.test(r.demande) && /25 € par personne, soit 775 € pour 31 joueurs/.test(r.demande), 'les joueurs, leurs ages, et le budget par personne', r.demande);
  ok(JSON.stringify(r.envies.map((e) => `${e.t}:${e.n}`)) === JSON.stringify(['1:Bowling', '2:Laser Game', '3:Minigolf Blacklight']) && r.envies.every((e) => /^\/assets\/fungalaxy\/.+-carte\.webp$/.test(e.photo)), 'leurs envies en photos, chacune a sa couleur', JSON.stringify(r.envies));
  ok(/Nous aimerions pique-niquer sur place à midi, avant les activités\. Deux enseignants et un parent accompagnent les élèves\./.test(r.message), 'le message du client est lu en entier', r.message);
  ok(/Facture au nom de Athénée de Libramont, TVA BE0123456789\./.test(r.client), 'la facture et sa TVA', r.client);
  ok(/3 venues, la dernière le/.test(r.client) && /1 240 € au total/.test(r.client), 'le client deja venu est reconnu, avec ce qu il a represente', r.client);
  ok(/1 absence/.test(r.client), 'ses absences se voient', r.client);
  ok(r.venues.length === 3 && /540 €/.test(r.venues[0]), 'ses dernieres venues se lisent, avec leur prix', JSON.stringify(r.venues));
  ok(r.photoAilleurs === '' && /fungalaxy/.test(r.photoIci), 'un autre client ne recoit pas les photos de ce centre', JSON.stringify(r.photoAilleurs));
  ok(!/\bIA\b|intelligence artificielle|\bmoteur\b|\bAPI\b/i.test(r.mots), 'la demande ne parle ni d IA ni de moteur', (r.mots.match(/.{0,30}(\bIA\b|moteur|API).{0,30}/i) || [''])[0]);
  ok(r.mails.length === 1 && r.mails[0].titre === 'Le client a écrit' && r.mails[0].ouvert && /sandwichs/.test(r.mails[0].t), 'seuls les mails de la demande, le dernier mot du client deja ouvert', JSON.stringify(r.mails));
  ok(r.etude807 === 0, 'une demande sans formulaire ne declenche aucune etude');

  section('C. PINLANE A L OUVERTURE');
  ok(/Pinlane lit la demande et prépare la réponse/.test(r.travail.dit) && r.travail.lectures.length >= 2 && /La demande et ses mails/.test(r.travail.lectures[0]) && /31 joueurs/.test(r.travail.lectures[0]), 'pendant qu il travaille, ses lectures s empilent avec leur resultat', JSON.stringify(r.travail));
  ok(!r.travail.roue && r.travail.envoyer.length === 1 && r.travail.envoyer[0].off, 'sans roue qui tourne, et rien ne s envoie pendant ce temps', JSON.stringify(r.travail));
  ok(r.appelsOuverture.length === 1 && r.appelsOuverture[0].id === 801 && r.appelsOuverture[0].centre === 'libramont' && Array.isArray(r.appelsOuverture[0].messages) && r.appelsOuverture[0].messages.length === 0, 'a l ouverture, un seul appel a Pinlane, en mode demande, sans consigne', JSON.stringify(r.appelsOuverture));
  ok(Boolean(r.resa) && /Dimanche \d+ \S+/.test(r.resa.t) && /Dans leur budget\./.test(r.resa.t) && /soit 24 € par joueur/.test(r.resa.t) && /Vérifiée sur le planning/.test(r.resa.t), 'la reservation : le jour, le prix par joueur face au budget, verifiee sur le planning', r.resa && r.resa.t);
  ok(Boolean(r.resa) && JSON.stringify(r.resa.gros.map((g) => g.t)) === JSON.stringify(['14:00', '31', '744 €']) && r.resa.gros.every((g) => /Anton/.test(g.police) && g.taille >= 26), 'l heure, les joueurs et le prix en grand, en Anton', JSON.stringify(r.resa && r.resa.gros));
  ok(Boolean(r.resa) && r.resa.lignes.length === 2 && /Bowling 14:00 à 15:00/.test(r.resa.lignes[0].txt) && /Laser Game 15:00 à 15:40/.test(r.resa.lignes[1].txt) && r.resa.lignes[0].t === '1' && r.resa.lignes[1].t === '2' && r.resa.lignes[0].point !== r.resa.lignes[1].point, 'une ligne par activite, son heure, et un point a la couleur de l envie', JSON.stringify(r.resa && r.resa.lignes));
  ok(Boolean(r.mail) && /Fun Galaxy Libramont/.test(r.mail.t) && /à ansar@example\.org/.test(r.mail.t) && /Votre après-midi du dimanche/.test(r.mail.t) && /pique-nique/.test(r.mail.t) && /Bien à vous/.test(r.mail.t), 'le mail tel que le client le lira : de qui, pour qui, l objet, le texte', r.mail && r.mail.t.slice(0, 200));
  ok(Boolean(r.mail) && !r.mail.coupe && r.mail.haut > 200, 'le mail se lit en entier, pas une ligne sur dix', JSON.stringify(r.mail && { coupe: r.mail.coupe, haut: r.mail.haut }));
  ok(/À vérifier avant d’envoyer/.test(r.verif) && /3 accompagnateurs ne sont pas comptés dans le prix/.test(r.verif), 'ce qu il faut verifier avant d envoyer est affiche', r.verif);
  ok(r.idees.length === 3, 'trois idees a toucher', JSON.stringify(r.idees));
  ok(JSON.stringify(r.piedPret) === JSON.stringify([{ t: 'Réserver sans attendre', p: false, off: false }, { t: 'Envoyer la proposition', p: true, off: false }]), 'un seul bouton plein pour l etape : envoyer la proposition', JSON.stringify(r.piedPret));
  ok(r.statutsOuverture.length === 0, 'ouvrir la demande ne la prend pas en charge', JSON.stringify(r.statutsOuverture));
  ok(r.envoisAvant === 0, 'AUCUN envoi : preparer ne fait partir aucun mail', String(r.envoisAvant));

  section('D. UNE CONSIGNE');
  ok(r.frappe.v === 'plutôt' && r.frappe.focus, 'une consigne en cours de frappe tient au repeint de la page', JSON.stringify(r.frappe));
  ok(Boolean(r.consigneAppel) && r.consigneAppel.demandeId === 801 && JSON.stringify(r.consigneAppel.messages) === JSON.stringify([{ role: 'user', content: 'Plutôt à 15:00' }]), 'une idee touchee part comme consigne : demandeId et la consigne', JSON.stringify(r.consigneAppel && { id: r.consigneAppel.demandeId, m: r.consigneAppel.messages }));
  ok(r.statuts.some((s) => s.id === 801 && s.status === 'in_progress'), 'la premiere consigne prend la demande en charge', JSON.stringify(r.statuts));
  ok(/refait la réponse avec « Plutôt à 15:00 »/.test(r.pendant.dit) && !r.pendant.modifier && r.pendant.champ, 'pendant qu il refait, Pinlane dit ce qu il fait, le mail ne se modifie pas, une autre consigne reste possible', JSON.stringify(r.pendant));
  ok(r.barresOk = (r.apres.barres.includes('14:00') && r.apres.heure === '15:00'), 'apres la consigne : l ancienne heure barree a cote de la nouvelle', JSON.stringify({ barres: r.apres.barres, heure: r.apres.heure }));
  ok(r.apres.neuves === 2 && r.apres.ins > 0 && r.apres.del > 0, 'ce qui change est marque, dans la reservation et dans le mail', JSON.stringify({ neuves: r.apres.neuves, ins: r.apres.ins, del: r.apres.del }));
  ok(/Vous avez demandé « Plutôt à 15:00 »\. J’ai refait la réservation à 15:00/.test(r.apres.t), 'la consigne et ce qu elle a donne, en une ligne au passe', r.apres.t.slice(0, 260));
  ok(r.propre.ins === 0 && /à partir de 15:00/.test(r.propre.t), 'et le mail se relit propre, tel qu il partira', JSON.stringify(r.propre).slice(0, 160));
  ok(/Rachel a demandé à Pinlane « Plutôt à 15:00 »/.test(r.suivi), 'le suivi garde la consigne, pour toute l equipe', r.suivi.slice(0, 300));
  ok(r.envoisApresConsigne === 0, 'toujours aucun envoi sans le clic');

  section('F. ENVOYER LA PROPOSITION');
  const e = r.envoi.corps || {};
  ok(r.envoi.n === 1 && e.action === 'sendDirectEmail' && e.customRequestId === 801 && e.to === 'ansar@example.org' && e.centerId === 'libramont' && typeof e.attemptId === 'string', 'un seul envoi, trace, rattache a la demande (customRequestId)', JSON.stringify({ n: r.envoi.n, action: e.action, id: e.customRequestId, to: e.to }));
  ok(e.subject === r.mailAEnvoyer.objet && e.body === r.mailAEnvoyer.corps && e.draftSource === 'ia' && e.draftOriginal && e.draftOriginal.body === e.body, 'le mail part tel qu il est a l ecran, le texte de Pinlane comme original', JSON.stringify({ s: e.subject, src: e.draftSource }));
  ok(Boolean(e.proposition) && e.proposition.date === r.D1 && e.proposition.startTime === '15:00' && e.proposition.pax === 31 && Array.isArray(e.proposition.programme) && e.proposition.programme.map((x) => x.activityId).join() === 'bowling,laser_game', 'la reservation preparee part avec le mail (proposition)', JSON.stringify(e.proposition));
  ok(/En attente/.test(r.apresEnvoi.onglet) && r.apresEnvoi.ouverte === '801', 'la demande reste ouverte, rangee chez le client', JSON.stringify({ o: r.apresEnvoi.onglet, id: r.apresEnvoi.ouverte }));
  ok(/Proposition envoyée à l’instant par Rachel\. Le client n’a pas encore répondu\./.test(r.apresEnvoi.pin) && /La proposition envoyée/i.test(r.apresEnvoi.pin) && /15:00/.test(r.apresEnvoi.pin), 'Pinlane dit ce qui est parti, et la proposition se relit', r.apresEnvoi.pin.slice(0, 200));
  ok(JSON.stringify(r.apresEnvoi.pied) === JSON.stringify([{ t: 'Préparer une autre proposition', p: false }, { t: 'Réserver ce qui a été proposé', p: true }]), 'le oui du client est le geste principal', JSON.stringify(r.apresEnvoi.pied));
  ok(r.apresEnvoi.mails.some((m) => /^E-mail envoyé par Rachel \(en file\)$/.test(m)), 'le mail parti est dans les mails echanges, dit en file', JSON.stringify(r.apresEnvoi.mails));
  ok(/Proposition envoyée par Rachel/.test(r.apresEnvoi.suivi), 'le suivi dit qui a envoye la proposition', r.apresEnvoi.suivi.slice(-200));
  ok(/^Réponse enregistrée\. Son état d’envoi se lit dans les mails échangés\.$/.test(r.apresEnvoi.toast), 'le message ne pretend pas que le mail est parti', r.apresEnvoi.toast);
  ok(r.autre.champ && r.autre.focus === 'bdgC-801' && r.autre.envoyer && r.autreAppels === 0, '« Préparer une autre proposition » rend la main a Pinlane, la consigne attend, sans nouvel appel', JSON.stringify({ ...r.autre, appels: r.autreAppels }));

  section('I. LES FENETRES');
  ok(Boolean(r.planning) && /^Planning du dimanche \d+ \S+/.test(r.planning.titre) && r.planning.groupes >= 5, 'le planning du jour propose s ouvre en fenetre, avec ses groupes', JSON.stringify(r.planning));
  ok(Boolean(r.planning) && r.planning.marques.includes('Team building'), 'le team building est marque au planning', JSON.stringify(r.planning && r.planning.marques));
  ok(Boolean(r.planning) && r.planning.adresse && r.planning.page === 'requests' && r.planning.dessous, 'ni l adresse ni la page ne changent : la demande reste ouverte dessous', JSON.stringify(r.planning));
  ok(!r.planningFerme.ouverte && /Voir le planning de ce jour/.test(r.planningFerme.focus), 'Echap ferme la fenetre et rend la main au bouton qui l a ouverte', JSON.stringify(r.planningFerme));
  ok(/Ansar Bisultanov/.test(r.fiche.t) && /Venues 3/.test(r.fiche.t) && /Absences 1/.test(r.fiche.t) && r.fiche.adresse && r.fiche.page === 'requests' && r.fiche.dessous && r.ficheFermee, 'le client s ouvre en fenetre, sans quitter la demande, et Echap la ferme', JSON.stringify(r.fiche).slice(0, 220));
  ok(r.erreurs.length === 0, 'zero erreur dans la page sur tout le parcours', r.erreurs.join(' | '));
}

// [E] DEUX CONSIGNES : la seconde coupe la premiere, meme quand la premiere repond en retard.
async function deuxConsignes(browser) {
  const o = await ouvrir(browser);
  const { banc, page } = o;
  const r = { erreurs: o.erreurs };
  try {
    await page.waitForSelector('.bdg-lecture[data-request-id="802"]', { timeout: 8000 });
    await prete(page);
    banc.etat.assistant.lent = 1500;
    await envoyerConsigne(page, 802, 'Plutôt à 15:00');
    await page.waitForFunction(() => document.querySelector('.bdg-pin .bdg-mailc') && /refait la réponse avec « Plutôt à 15:00 »/.test((document.querySelector('.bdg-pin-dit') || {}).textContent || ''), null, { timeout: 8000 });
    await page.waitForTimeout(150);
    await envoyerConsigne(page, 802, 'Garder 19:00 avec un soft');
    await page.waitForFunction(() => /Vous avez demandé « Garder 19:00 avec un soft »/.test((document.querySelector('.bdg-pin') || {}).innerText || ''), null, { timeout: 10000 });
    await page.waitForTimeout(2200);
    r.appels = banc.etat.assistantAppels.map((a) => a.consigne);
    r.final = await page.evaluate(() => ({ heure: ((document.querySelector('.bdg-pin .bdg-resa-v .bdg-anton') || {}).textContent || '').trim(), t: document.querySelector('.bdg-pin').innerText.replace(/\s+/g, ' ') }));
  } catch (error) {
    r.panne = panne(error);
  } finally {
    await o.fermer();
  }
  return r;
}
function verifierDeuxConsignes(r) {
  section('E. DEUX CONSIGNES');
  if (!ok(!r.panne, 'MONTAGE le parcours va au bout', r.panne || '')) return;
  ok(JSON.stringify(r.appels) === JSON.stringify(['Plutôt à 15:00', 'Garder 19:00 avec un soft']), 'deux consignes, deux appels, dans l ordre', JSON.stringify(r.appels));
  ok(r.final.heure === '19:00' && /Soft × 45, un par joueur/.test(r.final.t) && !/Vous avez demandé « Plutôt à 15:00 »/.test(r.final.t), 'la reponse lente de la premiere ne remplace pas la seconde', JSON.stringify(r.final).slice(0, 220));
  ok(r.erreurs.length === 0, 'MONTAGE zero erreur', r.erreurs.join(' | '));
}

// [G] LE OUI DU CLIENT : la proposition partie se reserve, apres la carte qui la relit.
async function reserver(browser) {
  const o = await ouvrir(browser);
  const { banc, page } = o;
  const r = { erreurs: o.erreurs };
  try {
    await page.click('.bdg-onglet:has-text("En attente")');
    await page.waitForSelector('.bdg-lecture[data-request-id="803"]', { timeout: 8000 });
    r.attente = await pinTexte(page);
    r.piedAttente = await pied(page);
    await page.click('.bdg-pin-pied button:has-text("Réserver ce qui a été proposé")');
    await page.waitForFunction(() => /Confirmer la réservation/.test((document.querySelector('.bdg-pin-pied') || {}).innerText || '') && !document.querySelector('.bdg-pin-pied .bdg-p[disabled]'), null, { timeout: 8000 });
    r.carte = { t: await pinTexte(page), pied: await pied(page), appels: appels(banc, 'customRequestBook').map((a) => ({ confirme: a.corps.confirme, id: a.corps.id, centre: a.corps.centerId, reservation: a.corps.reservation, proposition: a.corps.proposition })) };
    await page.click('.bdg-pin-pied button:has-text("Annuler")');
    await page.waitForTimeout(250);
    r.annulee = { carte: /La réservation à créer/i.test(await pinTexte(page)), creees: banc.etat.creees.length };
    await page.click('.bdg-pin-pied button:has-text("Réserver ce qui a été proposé")');
    await page.waitForFunction(() => /Confirmer la réservation/.test((document.querySelector('.bdg-pin-pied') || {}).innerText || '') && !document.querySelector('.bdg-pin-pied .bdg-p[disabled]'), null, { timeout: 8000 });
    await page.click('.bdg-pin-pied button:has-text("Confirmer la réservation")');
    await page.waitForFunction(() => /Réservation n° \d+ créée/.test((document.querySelector('.bdg-pin') || {}).innerText || ''), null, { timeout: 8000 });
    await page.waitForTimeout(300);
    r.faite = { t: await pinTexte(page), pied: await pied(page), onglet: await ongletActif(page), ouverte: await ouverte(page), appels: appels(banc, 'customRequestBook').map((a) => a.corps.confirme), creees: banc.etat.creees.map((x) => ({ id: x.id, date: x.date, heure: x.startTime, pax: x.pax })) };
    await page.click('.bdg-pin-pied button:has-text("Voir la réservation")');
    await page.waitForSelector('#posOverlay:not(.hidden)', { timeout: 8000 });
    r.voir = await page.evaluate(() => ({ t: ((document.getElementById('posOverlay') || {}).innerText || '').replace(/\s+/g, ' ').slice(0, 300), page: state.staffMenuPage }));
  } catch (error) {
    r.panne = panne(error);
  } finally {
    await o.fermer();
  }
  return r;
}
function verifierReserver(r) {
  section('G. RESERVER CE QUI A ETE PROPOSE');
  if (!ok(!r.panne, 'MONTAGE le parcours va au bout', r.panne || '')) return;
  ok(/Proposition envoyée il y a 20 h par Rachel/.test(r.attente) && /La proposition envoyée/i.test(r.attente) && /14:00/.test(r.attente) && /576 €/.test(r.attente), 'la proposition partie se relit, avec ses heures et son prix', r.attente.slice(0, 240));
  ok(JSON.stringify(r.piedAttente) === JSON.stringify([{ t: 'Préparer une autre proposition', p: false, off: false }, { t: 'Réserver ce qui a été proposé', p: true, off: false }]), 'son oui est le geste principal', JSON.stringify(r.piedAttente));
  const a = r.carte.appels;
  ok(a.length === 1 && a[0].confirme === false && a[0].id === 803 && a[0].centre === 'libramont' && a[0].reservation && a[0].reservation.startTime === '14:00' && a[0].reservation.pax === 24, 'le premier toucher demande la simulation, rien n est cree', JSON.stringify(a));
  ok(/La réservation à créer/i.test(r.carte.t) && /Rien n’est créé avant votre clic/.test(r.carte.t) && /La confirmation partira au client par e-mail, à marc@example\.org\./.test(r.carte.t), 'la carte relit ce qui sera cree, et dit ou partira la confirmation', r.carte.t.slice(0, 260));
  ok(JSON.stringify(r.carte.pied.map((b) => `${b.t}${b.p ? ' (plein)' : ''}`)) === JSON.stringify(['Annuler', 'Modifier dans Réserver', 'Confirmer la réservation (plein)']), 'trois gestes : annuler, tout regler dans Reserver, confirmer', JSON.stringify(r.carte.pied));
  ok(!r.annulee.carte && r.annulee.creees === 0, 'annuler referme la carte sans rien creer', JSON.stringify(r.annulee));
  ok(JSON.stringify(r.faite.appels) === JSON.stringify([false, false, true]) && r.faite.creees.length === 1 && r.faite.creees[0].heure === '14:00' && r.faite.creees[0].pax === 24, 'la reservation se cree au seul clic de confirmation, telle que relue', JSON.stringify(r.faite));
  ok(/Réservation n° 9001 créée à l’instant\./.test(r.faite.t) && /La confirmation part au client par e-mail, à marc@example\.org\./.test(r.faite.t), 'la page dit le numero et ou part la confirmation', r.faite.t.slice(0, 200));
  ok(/Terminées/.test(r.faite.onglet) && r.faite.ouverte === '803' && JSON.stringify(r.faite.pied) === JSON.stringify([{ t: 'Voir la réservation', p: true, off: false }]), 'la demande reservee passe dans les terminees, ouverte, et se voit d un bouton', JSON.stringify(r.faite));
  ok(/Marc Lambert/.test(r.voir.t) && r.voir.page === 'requests', 'la reservation s ouvre en fenetre, sur la page des demandes', JSON.stringify(r.voir).slice(0, 200));
  ok(r.erreurs.length === 0, 'MONTAGE zero erreur', r.erreurs.join(' | '));
}

// [H] TOUT REGLER A LA MAIN : un prix de groupe dit a Pinlane, puis la fenetre Reserver.
async function reserverAMain(browser) {
  const o = await ouvrir(browser);
  const { banc, page } = o;
  const r = { erreurs: o.erreurs };
  try {
    r.D1 = datesDuBanc(Date.now()).D1;
    await page.click(ligne(801));
    await prete(page);
    await envoyerConsigne(page, 801, 'Le groupe à 20 € par personne');
    await page.waitForFunction(() => /Vous avez demandé « Le groupe à 20 € par personne »/.test((document.querySelector('.bdg-pin') || {}).innerText || ''), null, { timeout: 10000 });
    await prete(page);
    r.convenu = await pinTexte(page);
    await page.click('.bdg-pin-pied button:has-text("Réserver sans attendre")');
    await page.waitForFunction(() => /Confirmer la réservation/.test((document.querySelector('.bdg-pin-pied') || {}).innerText || '') && !document.querySelector('.bdg-pin-pied .bdg-p[disabled]'), null, { timeout: 8000 });
    r.simulation = { t: await pinTexte(page), appels: appels(banc, 'customRequestBook').map((a) => ({ confirme: a.corps.confirme, prix: a.corps.reservation && a.corps.reservation.prix, raison: a.corps.reservation && a.corps.reservation.raisonPrix })) };
    await page.click('.bdg-pin-pied button:has-text("Modifier dans Réserver")');
    await page.waitForFunction(() => typeof quickBookState !== 'undefined' && quickBookState && quickBookState.sourceRequestId, null, { timeout: 8000 });
    await page.waitForTimeout(300);
    r.resa = await page.evaluate(() => ({ type: quickBookState.type, heure: quickBookState.startTime, bowling: Boolean(quickBookState.visit && quickBookState.visit.bowling && quickBookState.visit.bowling.on), laser: Boolean(quickBookState.visit && quickBookState.visit.laser_game && quickBookState.visit.laser_game.on), pax: quickBookState.pax, date: quickBookState.date, notes: quickBookState.notes, source: quickBookState.sourceRequestId, nom: quickBookState.name, prix: typeof getQuickBookCustomPrice === 'function' ? getQuickBookCustomPrice() : null }));
    r.creees = banc.etat.creees.length;
  } catch (error) {
    r.panne = panne(error);
  } finally {
    await o.fermer();
  }
  return r;
}
function verifierReserverAMain(r) {
  section('H. MODIFIER DANS RESERVER');
  if (!ok(!r.panne, 'MONTAGE le parcours va au bout', r.panne || '')) return;
  ok(/Prix convenu/.test(r.convenu) && /620 €/.test(r.convenu) && /Prix habituel 744 €/.test(r.convenu) && /Prix de groupe accordé par l’équipe/.test(r.convenu), 'un prix de groupe dit a Pinlane : le prix convenu, l habituel barre, sa raison', r.convenu.slice(0, 300));
  ok(r.simulation.appels.length === 1 && r.simulation.appels[0].confirme === false && r.simulation.appels[0].prix === 620 && /620 €/.test(r.simulation.t), 'la simulation part avec le prix convenu', JSON.stringify(r.simulation.appels));
  ok(Boolean(r.resa) && r.resa.source === 801 && r.resa.pax === 31 && r.resa.date === r.D1 && /Ansar/.test(r.resa.nom), 'Reserver s ouvre preremplie : le client, ses joueurs, la date', JSON.stringify(r.resa).slice(0, 200));
  ok(Boolean(r.resa) && r.resa.heure === '14:00' && r.resa.type === 'visite' && r.resa.bowling && r.resa.laser, 'elle reprend l heure et le programme prepares', JSON.stringify(r.resa).slice(0, 200));
  ok(Boolean(r.resa) && Number(r.resa.prix) === 620, 'et le prix convenu', JSON.stringify(r.resa && r.resa.prix));
  ok(Boolean(r.resa) && /Demande sur mesure/.test(r.resa.notes) && /Athénée de Libramont/.test(r.resa.notes) && /prix convenu, Prix de groupe accordé/.test(r.resa.notes), 'la note de la reservation dit d ou elle vient et pourquoi ce prix', r.resa && r.resa.notes);
  ok(r.creees === 0, 'rien n est cree tant que Reserver n a pas enregistre');
  ok(r.erreurs.length === 0, 'MONTAGE zero erreur', r.erreurs.join(' | '));
}

// [R] UN MOT SUFFIT : noter, retenir, classer, rien sans le clic.
async function gestes(browser) {
  const o = await ouvrir(browser);
  const { banc, page } = o;
  const r = { erreurs: o.erreurs };
  try {
    await page.click(ligne(801));
    await prete(page);
    await envoyerConsigne(page, 801, 'note que un enfant est allergique aux arachides');
    await page.waitForFunction(() => /Pinlane propose d’ajouter cette note au suivi/.test((document.querySelector('.bdg-pin') || {}).innerText || ''), null, { timeout: 10000 });
    r.avantNote = { carte: await texte(page, '.bdg-petit-geste'), notes: appels(banc, 'customRequestNote').length };
    await page.click('.bdg-petit-geste button:has-text("Ajouter la note")');
    await page.waitForFunction(() => /Note ajoutée au suivi\./.test((document.querySelector('.bdg-pin') || {}).innerText || ''), null, { timeout: 8000 });
    r.apresNote = { notes: appels(banc, 'customRequestNote').map((a) => a.corps), suivi: await texte(page, '.bdg-suivi') };
    await envoyerConsigne(page, 801, 'toujours un soft par enfant aux anniversaires');
    await page.waitForFunction(() => /Pinlane propose de retenir cette règle/.test((document.querySelector('.bdg-pin') || {}).innerText || ''), null, { timeout: 10000 });
    r.regle = { carte: await texte(page, '.bdg-petit-geste'), appris: appels(banc, 'teachAgentFact').length };
    await page.click('.bdg-petit-geste button:has-text("Retenir")');
    await page.waitForFunction(() => /Pinlane s’en souviendra pour les prochaines demandes/.test((document.querySelector('.bdg-pin') || {}).innerText || ''), null, { timeout: 8000 });
    r.retenu = appels(banc, 'teachAgentFact').map((a) => a.corps);
    await envoyerConsigne(page, 801, 'laisse tomber, ils ont trouvé ailleurs');
    await page.waitForFunction(() => /Pinlane propose de classer cette demande sans suite/.test((document.querySelector('.bdg-pin') || {}).innerText || ''), null, { timeout: 10000 });
    r.avantClasser = { carte: await texte(page, '.bdg-petit-geste'), statuts: appels(banc, 'customRequestStatus').map((a) => a.corps.status) };
    await page.click('.bdg-petit-geste button:has-text("Classer sans suite")');
    await page.waitForFunction(() => /Demande classée sans suite/.test((document.querySelector('.bdg-pin') || {}).innerText || ''), null, { timeout: 8000 });
    r.apresClasser = { statuts: appels(banc, 'customRequestStatus').map((a) => ({ id: a.corps.id, status: a.corps.status, centre: a.corps.centerId })), gestes: await page.evaluate(() => [...document.querySelectorAll('.bdg-tete-a > *')].map((b) => b.textContent.trim())), ouverte: await ouverte(page) };
  } catch (error) {
    r.panne = panne(error);
  } finally {
    await o.fermer();
  }
  return r;
}
function verifierGestes(r) {
  section('R. NOTER, RETENIR, CLASSER SUR UN MOT');
  if (!ok(!r.panne, 'MONTAGE le parcours va au bout', r.panne || '')) return;
  ok(/« Un enfant est allergique aux arachides\. »/.test(r.avantNote.carte) && r.avantNote.notes === 0, '« note que… » propose la note, sans rien ecrire', JSON.stringify(r.avantNote));
  const n = r.apresNote.notes[0] || {};
  ok(r.apresNote.notes.length === 1 && n.texte === 'Un enfant est allergique aux arachides.' && Number(n.id) === 801 && n.centerId === 'libramont' && /Un enfant est allergique aux arachides/.test(r.apresNote.suivi), 'au clic, la note part au serveur, dans le centre ouvert, et s affiche au suivi', JSON.stringify(r.apresNote).slice(0, 300));
  ok(/« Toujours un soft par enfant aux anniversaires\. »/.test(r.regle.carte) && r.regle.appris === 0, 'la regle dite se propose a retenir, sans rien apprendre', JSON.stringify(r.regle));
  ok(r.retenu.length === 1 && r.retenu[0].centerId === 'libramont' && /Toujours un soft par enfant/.test(r.retenu[0].reponse), 'retenir l apprend au centre ouvert, au seul clic', JSON.stringify(r.retenu));
  ok(/Pinlane propose de classer cette demande sans suite/.test(r.avantClasser.carte) && !r.avantClasser.statuts.includes('archived'), '« laisse tomber » propose de classer sans suite, sans rien classer', JSON.stringify(r.avantClasser));
  const a = r.apresClasser.statuts.filter((s) => s.status === 'archived');
  ok(a.length === 1 && Number(a[0].id) === 801 && a[0].centre === 'libramont' && !r.apresClasser.statuts.some((s) => s.status === 'handled') && r.apresClasser.gestes.includes('Rouvrir') && r.apresClasser.ouverte === '801', 'au clic, la demande se classe sans suite (jamais terminee), et propose de se rouvrir', JSON.stringify(r.apresClasser));
  ok(r.erreurs.length === 0, 'MONTAGE zero erreur', r.erreurs.join(' | '));
}

// [P] PINLANE INDISPONIBLE : la page le dit, les gestes restent a la main.
async function indisponible(browser) {
  const o = await ouvrir(browser, { avant: (b) => { b.etat.assistant.mode = 'panne'; } });
  const { banc, page } = o;
  const r = { erreurs: o.erreurs };
  try {
    await page.click(ligne(801));
    await page.waitForFunction(() => /n’est pas disponible pour le moment/.test((document.querySelector('.bdg-pin') || {}).innerText || ''), null, { timeout: 8000 });
    r.panneTexte = await pinTexte(page);
    r.piedPanne = await pied(page);
    await page.click('.bdg-pin-pied button:has-text("Écrire au client")');
    await page.waitForFunction(() => { const c = document.getElementById('reqBody-801'); return c && c.value.length > 20; }, null, { timeout: 8000 });
    r.code = { appel: (appels(banc, 'customRequestDraft')[0] || {}).corps || null, objet: await page.inputValue('#reqSubject-801'), corps: await page.inputValue('#reqBody-801'), envois: banc.etat.envois.length, t: await pinTexte(page) };
    await page.click('.bdg-pin-pied button:has-text("Annuler")');
    await page.waitForTimeout(250);
    banc.etat.assistant.mode = 'ok';
    await page.click('.bdg-pin button:has-text("Réessayer avec Pinlane")');
    await prete(page);
    r.reessai = { appels: banc.etat.assistantAppels.length, t: await pinTexte(page) };
    banc.etat.assistant.mode = 'panne';
    await envoyerConsigne(page, 801, 'Plutôt à 15:00');
    await page.waitForFunction(() => /n’est pas disponible pour le moment/.test((document.querySelector('.bdg-pin') || {}).innerText || ''), null, { timeout: 8000 });
    r.panneApres = await pinTexte(page);
  } catch (error) {
    r.panne = panne(error);
  } finally {
    await o.fermer();
  }
  return r;
}
function verifierIndisponible(r) {
  section('P. PINLANE INDISPONIBLE');
  if (!ok(!r.panne, 'MONTAGE le parcours va au bout', r.panne || '')) return;
  ok(/Pinlane n’est pas disponible pour le moment\. Les gestes restent à la main\./.test(r.panneTexte) && !/503|erreur|error/i.test(r.panneTexte), 'Pinlane absent : la page le dit en une phrase, sans code', r.panneTexte);
  ok(JSON.stringify(r.piedPanne.map((b) => `${b.t}${b.p ? ' (plein)' : ''}`)) === JSON.stringify(['Créer la réservation', 'Écrire au client (plein)']), 'les gestes restent a la main : reserver, ecrire', JSON.stringify(r.piedPanne));
  ok(Boolean(r.code.appel) && r.code.appel.sansIA === true && r.code.appel.id === 801 && /Le dimanche \d+ \S+, l’équipe peut vous accueillir à 14:00/.test(r.code.corps) && r.code.envois === 0, 'le mail du code s ecrit, sans IA, et rien ne part', JSON.stringify(r.code).slice(0, 260));
  ok(r.reessai.appels === 2 && /Le mail au client/i.test(r.reessai.t), '« Réessayer avec Pinlane » le relance, et la preparation arrive', JSON.stringify(r.reessai).slice(0, 160));
  ok(/Pinlane n’est pas disponible pour le moment\./.test(r.panneApres) && /La réservation/i.test(r.panneApres) && /Le mail au client/i.test(r.panneApres) && /Réessayer/.test(r.panneApres), 'Pinlane en panne apres une preparation : elle reste, la panne se dit au-dessus', r.panneApres.slice(0, 260));
}

// [Q] UN ROLE SANS DROIT D ENVOI : Pinlane ne prepare pas pour lui.
async function sansDroit(browser) {
  const o = await ouvrir(browser, { avant: (b) => { b.etat.role = 'accueil'; } });
  const { banc, page } = o;
  const r = { erreurs: o.erreurs };
  try {
    await page.click(ligne(801));
    await page.waitForSelector('.bdg-lecture[data-request-id="801"]', { timeout: 8000 });
    await page.waitForTimeout(900);
    r.t = await pinTexte(page);
    r.pied = await pied(page);
    r.appels = banc.etat.assistantAppels.length;
    r.budget = await texte(page, '.bdg-demande');
  } catch (error) {
    r.panne = panne(error);
  } finally {
    await o.fermer();
  }
  return r;
}
function verifierSansDroit(r) {
  section('Q. UN ROLE SANS DROIT D ENVOI');
  if (!ok(!r.panne, 'MONTAGE le parcours va au bout', r.panne || '')) return;
  ok(/Votre rôle ne permet pas d’écrire aux clients\./.test(r.t) && r.appels === 0, 'Pinlane ne prepare pas pour un role qui n ecrit pas aux clients, et le dit', JSON.stringify({ t: r.t, appels: r.appels }));
  ok(JSON.stringify(r.pied) === JSON.stringify([{ t: 'Créer la réservation', p: true, off: false }]), 'reserver reste son geste', JSON.stringify(r.pied));
  ok(!/···|€/.test(r.budget), 'un role qui ne voit pas les montants ne voit pas leur budget', r.budget);
  ok(r.erreurs.length === 0, 'MONTAGE zero erreur', r.erreurs.join(' | '));
}

// [O] LES AUTRES ETAPES : perimee, sans formulaire, terminees, sans suite et rouvrir, l onglet qui suit.
async function etapes(browser) {
  const o = await ouvrir(browser);
  const { banc, page } = o;
  const r = { erreurs: o.erreurs };
  try {
    banc.etat.assistant.arret = 4;
    await page.click(ligne(804));
    await page.waitForFunction(() => /Le client a écrit depuis la dernière préparation/.test((document.querySelector('.bdg-pin-dit') || {}).textContent || ''), null, { timeout: 8000 });
    r.perimeeDit = await texte(page, '.bdg-pin-dit');
    banc.etat.assistant.arret = null;
    banc.relacher();
    await prete(page);
    r.perimee = { appels: banc.etat.assistantAppels.map((a) => ({ id: a.demandeId, messages: a.messages })), t: await pinTexte(page) };
    const avant = banc.etat.assistantAppels.length;
    await page.click(ligne(807));
    await page.waitForSelector('.bdg-lecture[data-request-id="807"]', { timeout: 8000 });
    await page.waitForTimeout(900);
    r.sansForm = { t: await pinTexte(page), demande: await texte(page, '.bdg-demande'), appels: banc.etat.assistantAppels.length - avant, etude: banc.etat.appels.filter((a) => a.action === 'customRequestStudy' && a.id === '807').length, pied: await pied(page) };
    await page.click('.bdg-onglet:has-text("Terminées")');
    await page.waitForSelector('.bdg-lecture[data-request-id="805"]', { timeout: 8000 });
    r.terminee = { t: await pinTexte(page), puce: await texte(page, `${ligne(805)} .bdg-pill`), pied: await pied(page) };
    await page.click(ligne(806));
    await page.waitForSelector('.bdg-lecture[data-request-id="806"]', { timeout: 8000 });
    r.classee = { t: await pinTexte(page), puce: await texte(page, `${ligne(806)} .bdg-pill`), gestes: await page.evaluate(() => [...document.querySelectorAll('.bdg-tete-a > *')].map((b) => b.textContent.trim())) };
    // Sans suite puis rouvrir, sur 801.
    await page.click('.bdg-onglet:has-text("À traiter")');
    await page.click(ligne(801));
    await prete(page);
    await page.click('.bdg-tete-a button:has-text("Sans suite")');
    await page.waitForFunction(() => /Demande classée sans suite/.test((document.querySelector('.bdg-pin') || {}).innerText || ''), null, { timeout: 8000 });
    r.sansSuite = { statuts: appels(banc, 'customRequestStatus').map((a) => a.corps.status), ouverte: await ouverte(page), onglet: await ongletActif(page), t: await pinTexte(page), pied: await pied(page), gestes: await page.evaluate(() => [...document.querySelectorAll('.bdg-tete-a > *')].map((b) => b.textContent.trim())) };
    await page.click('.bdg-tete-a button:has-text("Rouvrir")');
    await page.waitForFunction(() => /À traiter/.test(((document.querySelector('.bdg-onglet[aria-selected="true"]') || {}).innerText || '')), null, { timeout: 8000 });
    await page.waitForTimeout(300);
    r.rouvert = { statuts: appels(banc, 'customRequestStatus').map((a) => a.corps.status), ouverte: await ouverte(page), t: await pinTexte(page) };
    // Une demande ouverte depuis une alerte avant que la file soit lue : la liste montre son onglet.
    await page.evaluate(async () => {
      staffCustomRequestsCache = { key: '', loading: false, loaded: false, error: '', items: [], loadedAt: 0 };
      openStaffRequestsPage(806);
      await loadStaffCustomRequests(true);
    });
    await page.waitForSelector('.bdg-lecture[data-request-id="806"]', { timeout: 8000 });
    r.ongletSuit = { onglet: await ongletActif(page), ligne: await page.evaluate(() => Boolean(document.querySelector('.bdg-l[data-item-id="806"][aria-current="true"]'))) };
    // Aucune demande : la liste et la place de la demande le disent.
    banc.etat.leads.splice(0);
    await page.evaluate(async () => { await loadStaffCustomRequests(true); });
    await page.waitForSelector('.bdg-lecture.is-vide', { timeout: 8000 });
    r.vide = { liste: await texte(page, '.bdg-liste-d'), place: await texte(page, '.bdg-lecture.is-vide'), onglets: await page.evaluate(() => [...document.querySelectorAll('.bdg-onglet')].map((b) => b.innerText.replace(/\s+/g, ' ').trim())) };
  } catch (error) {
    r.panne = panne(error);
  } finally {
    await o.fermer();
  }
  return r;
}
function verifierEtapes(r) {
  section('O. LES AUTRES ETAPES');
  if (!ok(!r.panne, 'MONTAGE le parcours va au bout', r.panne || '')) return;
  ok(/Le client a écrit depuis la dernière préparation\. Pinlane relit la demande et refait la réponse\./.test(r.perimeeDit) && r.perimee.appels.length === 1 && r.perimee.appels[0].id === 804 && r.perimee.appels[0].messages.length === 0, 'le client a ecrit depuis la preparation : Pinlane la refait tout seul, et le dit', JSON.stringify(r.perimee.appels));
  ok(/Cette demande n’a pas de formulaire détaillé\. Dites à Pinlane ce qu’il faut proposer/.test(r.sansForm.t) && /Dites à Pinlane ce qu’il faut proposer/.test(r.sansForm.t) && r.sansForm.appels === 0, 'la demande sans formulaire dit ce qu elle a, et Pinlane attend qu on lui dise quoi proposer', JSON.stringify(r.sansForm).slice(0, 300));
  ok(/5 novembre/.test(r.sansForm.demande) && /42 personnes/.test(r.sansForm.demande) && /ancienne fenêtre du site/.test(r.sansForm.demande) && r.sansForm.etude === 0, 'elle dit ce que le client a ecrit, sans etude', r.sansForm.demande);
  ok(JSON.stringify(r.sansForm.pied.map((b) => b.t)) === JSON.stringify(['Créer la réservation', 'Écrire au client']), 'et ses gestes a la main', JSON.stringify(r.sansForm.pied));
  ok(/Réservation n° 912 créée/.test(r.terminee.t) && r.terminee.puce === 'Réservée' && r.terminee.pied.some((b) => b.t === 'Voir la réservation'), 'une terminee dit sa reservation, et l ouvre', JSON.stringify(r.terminee).slice(0, 200));
  ok(/Demande classée sans suite il y a \d+ jours par Rachel/.test(r.classee.t) && r.classee.puce === 'Sans suite' && JSON.stringify(r.classee.gestes) === JSON.stringify(['Rouvrir']), 'une demande sans suite ne propose plus rien, elle se rouvre', JSON.stringify(r.classee));
  ok(r.sansSuite.statuts.includes('archived') && !r.sansSuite.statuts.includes('handled') && r.sansSuite.ouverte === '801' && /Terminées/.test(r.sansSuite.onglet) && r.sansSuite.pied.length === 0, 'sans suite : la demande est classee, reste ouverte et le dit', JSON.stringify(r.sansSuite).slice(0, 300));
  ok(r.rouvert.statuts.slice(-1)[0] === 'in_progress' && r.rouvert.ouverte === '801' && /Le mail au client/i.test(r.rouvert.t), 'rouvrir la remet au travail, avec sa preparation', JSON.stringify(r.rouvert).slice(0, 200));
  ok(/Terminées/.test(r.ongletSuit.onglet) && r.ongletSuit.ligne, 'ouverte avant que la file soit lue, la demande amene la liste a son onglet', JSON.stringify(r.ongletSuit));
  ok(Boolean(r.vide) && r.vide.liste === 'Aucune demande sur mesure pour le moment.' && /Aucune demande pour le moment/.test(r.vide.place) && JSON.stringify(r.vide.onglets) === JSON.stringify(['À traiter 0', 'En attente 0', 'Terminées 0']), 'aucune demande : la liste et la place de la demande le disent', JSON.stringify(r.vide));
  ok(r.erreurs.length === 0, 'MONTAGE zero erreur', r.erreurs.join(' | '));
}

// [K] TELEPHONE ET TABLETTE : la liste d abord, la demande seule ensuite, rien ne deborde.
async function petitsEcrans(browser) {
  const r = {};
  for (const [nom, largeur, hauteur] of [['tel', 390, 844], ['tablette', 1024, 1366]]) {
    const o = await ouvrir(browser, { largeur, hauteur, menu: false });
    const { page } = o;
    const m = { erreurs: o.erreurs };
    try {
      await page.waitForTimeout(800);
      m.liste = await page.evaluate(() => ({ lecture: Boolean(document.querySelector('.bdg-lecture') && document.querySelector('.bdg-lecture').getBoundingClientRect().height > 0), lignes: document.querySelectorAll('.bdg-l').length, large: document.scrollingElement.scrollWidth, vue: window.innerWidth }));
      await page.click(ligne(801));
      await prete(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      m.demande = await page.evaluate(() => {
        const piedB = document.querySelector('.bdg-pin-pied');
        const b = piedB ? piedB.getBoundingClientRect() : null;
        const liste = document.querySelector('.bdg-liste-c');
        return {
          liste: Boolean(liste && liste.getBoundingClientRect().height > 0),
          retour: Boolean(document.querySelector('.bdg-retour') && document.querySelector('.bdg-retour').getBoundingClientRect().height > 0),
          large: document.scrollingElement.scrollWidth, vue: window.innerWidth, haut: window.innerHeight,
          pied: b ? { haut: Math.round(b.top), bas: Math.round(b.bottom) } : null,
        };
      });
      await page.click('.bdg-retour');
      await page.waitForTimeout(400);
      m.retour = await page.evaluate(() => ({ lignes: document.querySelectorAll('.bdg-l').length, lecture: Boolean(document.querySelector('.bdg-lecture') && document.querySelector('.bdg-lecture').getBoundingClientRect().height > 0) }));
    } catch (error) {
      m.panne = panne(error);
    } finally {
      await o.fermer();
    }
    r[nom] = m;
  }
  return r;
}
function verifierPetitsEcrans(r) {
  section('K. TELEPHONE ET TABLETTE');
  for (const [nom, m] of Object.entries(r)) {
    if (!ok(!m.panne, `MONTAGE ${nom} : le parcours va au bout`, m.panne || '')) continue;
    ok(m.liste.lignes === 4 && !m.liste.lecture, `${nom} : la page s ouvre sur la liste, rien ne s ouvre tout seul`, JSON.stringify(m.liste));
    ok(!m.demande.liste && m.demande.retour, `${nom} : la demande prend l ecran, un lien ramene a la liste`, JSON.stringify(m.demande));
    ok(m.liste.large <= m.liste.vue && m.demande.large <= m.demande.vue, `${nom} : rien ne deborde (liste ${m.liste.large}, demande ${m.demande.large}, pour ${m.demande.vue})`);
    ok(Boolean(m.demande.pied) && m.demande.pied.bas <= m.demande.haut + 1 && m.demande.pied.haut >= 0, `${nom} : le geste de l etape est a l ecran sans defiler`, JSON.stringify(m.demande.pied));
    ok(m.retour.lignes === 4 && !m.retour.lecture, `${nom} : le retour rend la liste`, JSON.stringify(m.retour));
    ok(m.erreurs.length === 0, `${nom} : zero erreur`, m.erreurs.join(' | '));
  }
}

// [M] L ECHEANCE SUIT L HEURE : la page compte les minutes sans se repeindre.
async function horloge(browser) {
  const o = await ouvrir(browser, { horloge: true });
  const { page } = o;
  const r = { erreurs: o.erreurs };
  const lire = () => page.evaluate(() => {
    const puce = document.querySelector('.bdg-l[data-item-id="801"] .bdg-pill');
    const promis = document.querySelector('.bdg-promis');
    return {
      puce: puce ? { t: puce.innerText.trim(), cls: puce.className } : null,
      promis: promis ? promis.innerText.replace(/\s+/g, ' ').trim() : '',
      retard: ((document.querySelector('.bdg-retard') || {}).textContent || '').trim(),
      ouverte: (document.querySelector('.bdg-lecture[data-request-id]') || { dataset: {} }).dataset.requestId || '',
      marque: Boolean(document.querySelector('.bdg[data-qa-marque]')),
    };
  });
  try {
    await page.waitForSelector('.bdg-pin .bdg-mailc', { timeout: 8000 });
    await page.evaluate(() => document.querySelector('.bdg').setAttribute('data-qa-marque', '1'));
    r.avant = await lire();
    await page.clock.fastForward('10:00');
    await page.waitForTimeout(400);
    r.dixMinutes = await lire();
    await page.click(ligne(801));
    await prete(page);
    await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('.bdg').setAttribute('data-qa-marque', '1'));
    r.ficheAvant = await lire();
    await page.clock.fastForward('10:00');
    await page.waitForTimeout(400);
    r.ficheApres = await lire();
    await page.clock.fastForward('01:45:00');
    await page.waitForTimeout(700);
    r.echue = await lire();
  } catch (error) {
    r.panne = panne(error);
  } finally {
    await o.fermer();
  }
  return r;
}
function verifierHorloge(h) {
  section('M. L ECHEANCE SUIT L HEURE');
  if (!ok(!h.panne && h.avant && h.dixMinutes && h.echue, 'MONTAGE l horloge de la page se pilote', h.panne || '')) return;
  ok(h.erreurs.length === 0, 'MONTAGE zero erreur sous horloge pilotee', h.erreurs.join(' | '));
  ok(h.avant.puce && /^Reste (1 h 5\d|2 h)$/.test(h.avant.puce.t), 'au depart : environ deux heures', JSON.stringify(h.avant.puce));
  ok(h.dixMinutes.puce && h.avant.puce && h.dixMinutes.puce.t !== h.avant.puce.t && /^Reste 1 h [45]\d$/.test(h.dixMinutes.puce.t), 'dix minutes plus tard, la liste a compte dix minutes', `${h.avant.puce && h.avant.puce.t} -> ${h.dixMinutes.puce && h.dixMinutes.puce.t}`);
  ok(h.dixMinutes.marque, 'sans repeindre la page', JSON.stringify(h.dixMinutes.marque));
  ok(/il reste 1 h [34]\d/.test(h.ficheApres.promis), 'la demande ouverte aussi compte les minutes', h.ficheApres.promis);
  ok(h.ficheApres.marque && h.ficheApres.ouverte === '801', 'sans la repeindre : ses mails et Pinlane restent en place', JSON.stringify({ m: h.ficheApres.marque, o: h.ficheApres.ouverte }));
  ok(/dépassée de \d+ min/.test(h.echue.promis) && h.echue.ouverte === '801', 'l heure passee, la demande dit de combien et reste ouverte', h.echue.promis);
  ok(h.echue.puce && h.echue.puce.t === 'En retard' && /is-late/.test(h.echue.puce.cls), 'dans la liste, la ligne passe en retard, en rouge', JSON.stringify(h.echue.puce));
  ok(h.echue.retard === '2 en retard', 'l en-tete compte le nouveau retard', JSON.stringify(h.echue.retard));
}

// [N] L ALERTE DU TABLEAU DE BORD : ce qui attend l equipe.
async function alerte(browser) {
  const o = await ouvrir(browser);
  const { page } = o;
  const r = { erreurs: o.erreurs };
  try {
    await page.evaluate(() => window.openStaffDashboardDetail('alerts', 'lead'));
    await page.waitForSelector('.alert-lead', { timeout: 8000 });
    await page.waitForTimeout(300);
    r.titre = await texte(page, '.alert-lead');
    r.lignes = await page.evaluate(() => [...document.querySelectorAll('.alert-lead .dashboard-detail-row.lead')].map((l) => ({ id: l.getAttribute('data-item-id') || '', t: l.innerText.replace(/\s+/g, ' ').trim() })));
  } catch (error) {
    r.panne = panne(error);
  } finally {
    await o.fermer();
  }
  return r;
}
function verifierAlerte(a) {
  section('N. L ALERTE DU TABLEAU DE BORD');
  if (!ok(!a.panne && Array.isArray(a.lignes), 'MONTAGE l alerte s ouvre', a.panne || '')) return;
  ok(a.erreurs.length === 0, 'MONTAGE zero erreur', a.erreurs.join(' | '));
  const ids = a.lignes.map((l) => l.id);
  ok(JSON.stringify(ids) === JSON.stringify(['802', '801', '804', '807']), 'elle liste ce qui attend l equipe, dans l ordre de l heure promise', JSON.stringify(ids));
  ok(!ids.includes('803'), 'pas la demande qui attend le client');
  ok(/4 demandes sur mesure à traiter/.test(a.titre), 'son titre dit le meme chiffre', a.titre.slice(0, 120));
  ok(/En retard/.test((a.lignes[0] || {}).t || '') && /Reste/.test((a.lignes[1] || {}).t || ''), 'chaque ligne dit son heure promise', JSON.stringify(a.lignes.slice(0, 2)));
  ok(/Athénée de Libramont/.test((a.lignes[1] || {}).t || '') && /31 pers\./.test((a.lignes[1] || {}).t || ''), 'et le groupe du formulaire : organisation, joueurs', (a.lignes[1] || {}).t || '');
}

// [J] Aucun appel ne pose un statut que la base refuse.
function statutsInvalides(source) {
  const valides = new Set(['new', 'in_progress', 'handled', 'archived']);
  return [...source.matchAll(/setStaffCustomRequestStatus\(\s*[^,()]+,\s*(['"])([^'"]*)\1/g)].map((m) => m[2]).filter((s) => !valides.has(s));
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  try {
    verifier(await parcours(browser));
    verifierDeuxConsignes(await deuxConsignes(browser));
    verifierReserver(await reserver(browser));
    verifierReserverAMain(await reserverAMain(browser));
    verifierGestes(await gestes(browser));
    verifierIndisponible(await indisponible(browser));
    verifierSansDroit(await sansDroit(browser));
    verifierEtapes(await etapes(browser));
    verifierPetitsEcrans(await petitsEcrans(browser));
    verifierHorloge(await horloge(browser));
    verifierAlerte(await alerte(browser));

    section('J. UN STATUT QUE LA BASE ACCEPTE');
    const brut = fs.readFileSync(APP, 'utf8');
    const source = brut.replace(/\r\n/g, '\n');
    const nb = [...source.matchAll(/setStaffCustomRequestStatus\(/g)].length;
    ok(nb >= 6 && statutsInvalides(source).length === 0, `chaque appel pose un statut de la base (${nb} appels lus)`, JSON.stringify(statutsInvalides(source)));
    ok(/setStaffCustomRequestStatus\(demandeOrigine, 'handled', \{[\s\S]{0,80}reservationId: payload\.reservation/.test(source), 'la reservation creee depuis une demande la classe traitee, reservation liee');

    section('L. CONTRE-EPREUVES');
    const lireLf = (rel) => fs.readFileSync(p.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
    const montable = (de, fichier) => ok((fichier ? lireLf(fichier) : source).split(de).length === 2, `contre-epreuve montable : « ${de.trim().slice(0, 70)} »`);
    const CSS = 'assets/pinlane-staff.css';
    const essais = [
      { de: '  if (avant.coupure) avant.coupure.abort();\n', vers: '', aussi: { de: '  const v = bdgVivant[key];\n  if (!v || v.rang !== rang) return;\n  switch (type) {', vers: '  const v = bdgVivant[key];\n  if (!v) return;\n  switch (type) {' }, label: 'sans la coupure ni le rang, la reponse lente de la premiere consigne remplacerait la seconde', run: deuxConsignes, rouge: (r) => Boolean(r.final) && r.final.heure === '15:00' },
      { de: '  return !p || p.perimee === true;\n}', vers: '  return true;\n}', label: 'sans la preparation enregistree, Pinlane repartirait a chaque ouverture', rouge: (r) => r.relance802 > 0 },
      { de: "  if (bdgDoitPreparer(item)) bdgLancer(item.id, '');\n", vers: '', label: 'sans le lancement a l ouverture, Pinlane ne preparerait rien', rouge: (r) => Boolean(r.panne) || !(r.appelsOuverture && r.appelsOuverture.length) },
      { de: "messages: texte ? [{ role: 'user', content: texte }] : [] }),", vers: 'messages: [] }),', label: 'sans la consigne dans l appel, Pinlane referait la meme chose', rouge: (r) => Boolean(r.panne) || !(r.consigneAppel && JSON.stringify(r.consigneAppel.messages) === JSON.stringify([{ role: 'user', content: 'Plutôt à 15:00' }])) },
      { de: 'demandeId: Number(item.id), ', vers: '', label: 'sans demandeId, Pinlane ne saurait pas quelle demande preparer', rouge: (r) => Boolean(r.panne) || !(r.appelsOuverture && r.appelsOuverture.length === 1 && r.appelsOuverture[0].id === 801) },
      { de: '...quoi, confirme }),', vers: '...quoi, confirme: true }),', label: 'sans la simulation, le premier clic creerait la reservation sans la relire', run: reserver, rouge: (r) => Boolean(r.panne) || (Boolean(r.carte) && r.carte.appels.some((a) => a.confirme === true)) },
      { de: '        ...(reply.proposition ? { proposition: reply.proposition } : {}),\n', vers: '', label: 'sans la proposition au mail, le oui du client ne retrouverait rien', rouge: (r) => Boolean(r.envoi && r.envoi.corps) && !r.envoi.corps.proposition },
      { de: '        customRequestId: item.id,\n', vers: '', label: 'sans customRequestId, la reponse ne se rangerait pas dans la demande', rouge: (r) => Boolean(r.panne) || (Boolean(r.envoi && r.envoi.corps) && r.envoi.corps.customRequestId !== 801) },
      { de: 'delete staffRequestReplyState[key];\n  bdgRepeindre(key, true);\n}', vers: 'delete staffRequestReplyState[key];\n  bdgRepeindre(key, true);\n  bdgEnvoyer(key);\n}', label: 'un mail parti tout seul a la fin de la preparation', rouge: (r) => r.envoisAvant > 0 || Boolean(r.panne) },
      { de: 'async function openStaffRequestDay(iso) {\n  if (!staffRequestDateOf(iso)) return;\n', vers: "async function openStaffRequestDay(iso) {\n  if (!staffRequestDateOf(iso)) return;\n  state.currentDate = iso; openStaffMenuPage('planning'); return;\n", label: 'sans la fenetre, le planning du jour ferait quitter la demande', rouge: (r) => Boolean(r.panne) || !(r.planning && r.planning.page === 'requests') },
      { de: 'function openStaffRequestClient(id) {\n', vers: "function openStaffRequestClient(id) {\n  state.staffClientQuery = String(id); openStaffMenuPage('clients'); return;\n", label: 'sans la fenetre, la fiche client ferait quitter la demande', rouge: (r) => Boolean(r.panne) || !(r.fiche && r.fiche.page === 'requests' && /Venues 3/.test(r.fiche.t)) },
      { de: "'input:not([type=\"hidden\"]), textarea, #bdgFenX', smFenetreFermer, { fondInerte: false });", vers: "'input:not([type=\"hidden\"]), textarea, #bdgFenX', () => {}, { fondInerte: false });", label: 'sans Echap, la fenetre resterait ouverte', rouge: (r) => Boolean(r.panne) || Boolean(r.planningFerme && r.planningFerme.ouverte) },
      { de: '      if (da && db && da.t !== db.t) return da.t - db.t;', vers: '      if (da && db && da.t !== db.t) return 0;', label: 'sans l ordre de l echeance, le retard n est plus en tete', rouge: (r) => Array.isArray(r.ordre) && r.ordre[0] !== '802' },
      { de: "  if (reste <= 0) return { tone: 'late',", vers: "  if (false) return { tone: 'late',", label: 'sans le retard, une echeance depassee ne se voit plus', rouge: (r) => !(r.puce802 && r.puce802.t === 'En retard') },
      { de: '  // Demandes sur mesure : le compte a rebours de la reponse promise.\n  tickStaffRequestDues();\n', vers: '', label: 'sans le tic de la minute, le compte a rebours reste fige', run: horloge, rouge: (r) => Boolean(r.dixMinutes && r.dixMinutes.puce && r.avant && r.avant.puce) && r.dixMinutes.puce.t === r.avant.puce.t },
      { de: "  if (board.getAttribute('data-due-tones') !== staffRequestDueToneKey()) { renderStaffUtilityPage(); return; }\n", vers: '', label: 'sans le repeint au changement de ton, l en-tete ne compte pas le nouveau retard', run: horloge, rouge: (r) => Boolean(r.echue) && r.echue.retard !== '2 en retard' },
      { de: '(thread.messages || []).filter(message => !debut || staffRequestTime(quandMail(message)) >= debut)', vers: '(thread.messages || [])', label: 'sans la coupe, les vieux mails reviennent dans la demande', rouge: (r) => Array.isArray(r.mails) && r.mails.length !== 1 },
      { de: "(BDG_PHOTOS[String(centerId || '')] || [])", vers: "(BDG_PHOTOS[String(centerId || '')] || BDG_PHOTOS.libramont)", label: 'sans la garde, un autre client recevrait les photos de ce centre', rouge: (r) => typeof r.photoAilleurs === 'string' && r.photoAilleurs !== '' },
      { de: "setStaffCustomRequestStatus(${jid}, 'archived', { suivre: true })\">Sans suite", vers: "setStaffCustomRequestStatus(${jid}, 'handled', { suivre: true })\">Sans suite", label: 'sans suite ne doit pas classer la demande en terminee', run: etapes, rouge: (r) => Boolean(r.panne) || !(r.sansSuite && r.sansSuite.statuts.includes('archived')) },
      { de: 'onclick="bdgGesteFait(${jid}, ${i})"', vers: 'onclick="bdgGesteNon(${jid}, ${i})"', label: 'sans le geste au clic, la note dite ne partirait pas', run: gestes, rouge: (r) => Boolean(r.panne) || !(r.apresNote && r.apresNote.notes.length === 1) },
      { de: "body: JSON.stringify({ action: 'customRequestNote', id, texte: g.note, centerId: getActiveOpsCenterId() }),", vers: "body: JSON.stringify({ action: 'customRequestNote', id, texte: g.note }),", label: 'sans le centre ouvert, la note partirait sans son centre', run: gestes, rouge: (r) => Boolean(r.panne) || !(r.apresNote && r.apresNote.notes[0] && r.apresNote.notes[0].centerId === 'libramont') },
      { de: "body: JSON.stringify({ action: 'teachAgentFact',", vers: "body: JSON.stringify({ action: 'oublierAgentFact',", label: 'sans l apprentissage, retenir ne retiendrait rien', run: gestes, rouge: (r) => Boolean(r.panne) || !(r.retenu && r.retenu.length === 1) },
      { de: "  v.saisie = String(valeur || '');\n", vers: '', label: 'sans la frappe gardee, un repeint effacerait la consigne en cours', rouge: (r) => Boolean(r.panne) || !(r.frappe && r.frappe.v === 'plutôt') },
      { de: "  if (texte && item.status === 'new' && bdgPeutClasser()) setStaffCustomRequestStatus(item.id, 'in_progress', { silencieux: true, suivre: true });\n", vers: '', label: 'sans la prise en charge, une consigne laisserait la demande nouvelle', rouge: (r) => Boolean(r.panne) || !(r.statuts && r.statuts.some((s) => s.id === 801 && s.status === 'in_progress')) },
      { de: "  if (prixRetenu && typeof onQuickCustomPriceInput === 'function') onQuickCustomPriceInput(prixRetenu);\n", vers: '', label: 'sans le prix pose, Reserver reprendrait le prix du catalogue', run: reserverAMain, rouge: (r) => Boolean(r.panne) || Number(r.resa && r.resa.prix) !== 620 },
      { de: '    ...(heureRetenue ? { startTime: heureRetenue, heureSouhaitee: true } : {}),\n', vers: '', label: 'sans l heure, Reserver ne reprend pas la reservation preparee', run: reserverAMain, rouge: (r) => Boolean(r.panne) || (r.resa && r.resa.heure !== '14:00') },
      { de: '  return bdgGrandEcran() ? getStaffRequestRows()[0] || null : null;', vers: '  return getStaffRequestRows()[0] || null;', label: 'sans la liste d abord, une demande s ouvrirait toute seule sur telephone', run: petitsEcrans, rouge: (r) => Boolean(r.tel && r.tel.liste && r.tel.liste.lecture) || Boolean(r.tel && r.tel.panne) },
      { de: '  return bdgGrandEcran() ? getStaffRequestRows()[0] || null : null;', vers: '  return null;', label: 'sans l ouverture de la plus pressee, le grand ecran resterait vide a cote de la liste', rouge: (r) => Boolean(r.panne) || !(r.depart && r.depart.id === '802') },
      { de: '  if (ouverte && staffRequestSegmentOf(ouverte) !== getStaffRequestSegment()) state.staffRequestSegment = staffRequestSegmentOf(ouverte);\n', vers: '', label: 'sans l onglet qui suit, la demande ouverte d une alerte resterait sous un autre onglet', run: etapes, rouge: (r) => Boolean(r.panne) || !(r.ongletSuit && /Terminées/.test(r.ongletSuit.onglet)) },
      { de: "    return envoyee.forme === 'reservation' ? { reservation: envoyee.valeur } : { proposition: envoyee.valeur };", vers: '    return null;', label: 'sans la proposition partie, son oui ouvrirait Reserver vide au lieu de la relire', run: reserver, rouge: (r) => Boolean(r.panne) || !(r.carte && r.carte.appels.length) },
      { de: "      ? `<button type=\"button\" class=\"bdg-p\" onclick=\"bdgReserver(${jid}, 'envoyee')\">", vers: "      ? `<button type=\"button\" class=\"bdg-b\" onclick=\"bdgReserver(${jid}, 'envoyee')\">", label: 'sans le bouton plein, le oui du client ne serait plus le geste principal', run: reserver, rouge: (r) => Boolean(r.panne) || !(r.piedAttente && r.piedAttente.some((b) => b.p)) },
      { de: "  const vieux = (nouveau, ancien) => (ra && ancien != null", vers: "  const vieux = (nouveau, ancien) => (false && ancien != null", label: 'sans l ancienne valeur, une consigne changerait l heure sans le montrer', rouge: (r) => Boolean(r.panne) || !(r.apres && r.apres.barres.includes('14:00')) },
      { fichier: CSS, de: '.bdg-resa-v .bdg-anton { font-size: 30px; }', vers: '.bdg-resa-v .bdg-anton { font-size: 13px; }', label: 'l heure et le prix ramenes a la taille du texte', rouge: (r) => Boolean(r.panne) || !(r.resa && r.resa.gros.every((g) => g.taille >= 26)) },
      { fichier: CSS, de: '.bdg-mailc-c { font-size: 14px;', vers: '.bdg-mailc-c { max-height: 60px; overflow: hidden; font-size: 14px;', label: 'le mail coupe a trois lignes', rouge: (r) => Boolean(r.panne) || !(r.mail && !r.mail.coupe) },
    ];
    if (SANS_CONTRE_PREUVES) console.log(`GATE-SAUTE-PARTIE contre-epreuves : ${essais.length} coupures montables mais pas rejouees`);
    for (const e of essais) {
      if (!montable(e.de, e.fichier) || (e.aussi && !montable(e.aussi.de))) continue;
      if (SANS_CONTRE_PREUVES) continue;
      if (SEULES.length && !SEULES.some((s) => e.label.includes(s))) continue;
      mutation = { de: e.de, vers: e.vers, fichier: e.fichier };
      if (e.aussi) {
        // Deux coupures dans le meme fichier : la seconde s applique sur la premiere.
        const une = source.split(e.de).join(e.vers);
        mutation = { de: source, vers: une.split(e.aussi.de).join(e.aussi.vers) };
      }
      let r = null;
      try {
        r = await (e.run ? e.run(browser) : parcours(browser, { captures: false }));
      } finally {
        mutation = null;
      }
      ok(Boolean(r) && e.rouge(r), `${e.label} : ce gate ROUGIRAIT`, r && r.panne ? `parcours arrete : ${r.panne}` : '');
    }
    const casse = source.replace("setStaffCustomRequestStatus(demandeOrigine, 'handled', {", 'setStaffCustomRequestStatus(demandeOrigine, "done", {');
    ok(casse !== source && statutsInvalides(casse).includes('done'), 'avec le « done » d avant, la regle des statuts rougit');
    ok(fs.readFileSync(APP, 'utf8') === brut, 'app-main.js du depot intact : les coupures ne vivaient que dans le banc');
  } finally {
    await browser.close();
  }
  console.log(`\n${echecs === 0 ? 'demandes-console-check: ALL OK' : `demandes-console-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
