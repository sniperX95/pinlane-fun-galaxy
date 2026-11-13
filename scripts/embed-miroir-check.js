// LA COPIE DES RESERVATIONS DANS L ANCIEN FORMULAIRE DU SITE.
//
// POURQUOI CE GATE EXISTE. Ansar, le 13/11 a 3 h : le formulaire Pinlane remplace celui de fungalaxy.be, mais pendant
// l essai chaque reservation doit AUSSI partir par leur formulaire d origine (Gravity Forms), masque dans la page,
// « exactement comme ils ont deja actuellement ... pour voir si tout coincide », et le retour a l ancien formulaire
// doit se faire d un bouton « sans laisser de residu ». La copie part du navigateur du client (embed.js, data-miroir) :
// ce gate la joue sur la VRAIE copie de leurs deux formulaires (scripts/fixtures/fungalaxy-gform, lue en visiteur) et
// lit chaque envoi champ par champ.
//
// RIEN NE PEUT SORTIR. Les adresses du gate sont en .test (jamais resolues) et le navigateur refuse toute adresse
// hors de la machine : une requete que le routage aurait manquee echoue, elle n atteint ni fungalaxy.be ni Pinlane.
//
// LES PROPRIETES :
//   [A] La ligne du site demande la copie : le cadre recoit miroir=1, l ancien formulaire est masque, jamais retire.
//   [B] Une reservation de deux activites fait deux entrees, chacune a son heure et son nombre de joueurs, avec les
//       memes nom, telephone, e-mail, jour et centre ; les champs caches de leur formulaire (anti-spam compris)
//       partent tels que la page les porte, et la liste que leur logique cache (formule) ne part pas.
//   [C] Le formulaire de la page n est pas touche : ses champs restent vides, rien ne s y ajoute.
//   [D] Une formule fait une entree « Une formule » avec la bonne option.
//   [E] Une activite que leur liste ne connait pas ne devient jamais leur premiere option (« Arcades ») : la liste
//       reste vide, le nom se lit a cote du jour, et la copie se dit incomplete.
//   [F] Ce que leur formulaire refuse et une panne de leur site se disent (refuse:17, http-500) : le script de leur
//       page, qui nomme la confirmation et la redirection, ne passe pas pour une confirmation. Une page de
//       remerciement (redirection) compte comme recue.
//   [G] Une reservation ne se recopie qu une fois.
//   [H] Seul le cadre pose par embed.js est ecoute : ni la page elle-meme, ni un autre cadre de la meme origine.
//   [I] Sans data-miroir, rien ne part.
//   [J] Les donnees ne quittent pas le site : un formulaire qui enverrait ailleurs n est pas utilise.
//   [K] Gembloux (formulaire 1, son propre champ du centre) recoit Gembloux et ses propres valeurs.
//   [L] Le bouton de retour rend l ancien formulaire sans residu : plus de cadre, plus de masque, rien d envoye.
//   [M] De bout en bout, avec le vrai formulaire Pinlane : une reservation prise dans le cadre part dans leur
//       formulaire avec ce que le client a tape, et Pinlane apprend que la copie est passee, sans rien de personnel.
//   [N] Sur un autre site que celui de la fiche du centre, le cadre ne donne rien de personnel a la page.
//   [O] Le serveur : une copie ratee d une vraie reservation sonne, en mots simples, sans recopier ce que le
//       navigateur a ecrit ; une copie reussie, une reservation inconnue ou un centre inconnu ne sonnent pas.
//
// --contre-preuves : chaque mutation, servie en memoire, doit faire rougir au moins une propriete.
//
// Usage : node scripts/embed-miroir-check.js [--contre-preuves] [--seul=<mutation>]
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { Readable } = require('stream');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'fungalaxy-gform');
const PORT = Number(process.env.PINLANE_MIROIR_PORT || 4663);
const LOCAL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SITE = 'https://fungalaxy.test';
const AUTRE_SITE = 'https://autre-site.test';
const AILLEURS = 'https://ailleurs.test';
const PINLANE = 'https://pinlane.test';
const CONTRE = process.argv.includes('--contre-preuves');
const SEUL = (process.argv.find((a) => a.startsWith('--seul=')) || '').slice('--seul='.length);
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

let echecs = 0;
let muet = false;
function ok(cond, label, detail = '') {
  if (!muet) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${String(detail).slice(0, 400)}` : ''}`);
  if (!cond) echecs += 1;
  return cond;
}
function section(titre) { if (!muet) console.log(`\n${titre}`); }
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Les sources servies : celles du disque, ou une mutation en memoire.
// ---------------------------------------------------------------------------
const overrides = new Map();
function source(fichier) {
  return overrides.get(fichier) || fs.readFileSync(path.join(ROOT, fichier), 'utf8').split(CRLF).join(LF);
}

// ---------------------------------------------------------------------------
// Le site du centre : sa section de reservation et SON formulaire, avec la ligne collee dans un champ HTML du
// formulaire, comme Ansar la pose.
// ---------------------------------------------------------------------------
const S = {};
const POSTS = [];
const AILLEURS_VUS = [];
const BALISES = [];
function remettre(scenario = {}) {
  Object.keys(S).forEach((k) => delete S[k]);
  Object.assign(S, { gform: 4, centre: 'libramont', design: 'fungalaxy', miroir: '#gform_4', reponse: 'ok', actif: true, vraiCadre: false, intrus: false, actionAilleurs: false }, scenario);
  POSTS.length = 0;
  AILLEURS_VUS.length = 0;
  BALISES.length = 0;
}
function formulaire(n) {
  return fs.readFileSync(path.join(FIXTURES, `form-${n}.html`), 'utf8').replace(/^<!--[\s\S]*?-->\s*/, '');
}
function caches(n) {
  const f = formulaire(n);
  const lire = (nom) => ((new RegExp(`name='${nom}' value='([^']*)'`).exec(f) || [])[1] || '').split('&amp;').join('&');
  return { state: lire(`state_${n}`), ajax: lire('gform_ajax') };
}
function ligneDuSite() {
  return `<script src="${PINLANE}/embed.js" data-center="${S.centre}"${S.design ? ` data-design="${S.design}"` : ''} data-target="#booking .container" data-fallback="#booking .heading, #booking .booking__container" data-track="datalayer"${S.miroir ? ` data-miroir="${S.miroir}"` : ''}></script>`;
}
function pageSite() {
  const n = S.gform;
  let form = formulaire(n).split(`id='gform_wrapper_${n}' style='display:none'`).join(`id='gform_wrapper_${n}'`);
  if (S.actionAilleurs) form = form.replace(/action='[^']*'/, () => `action='${AILLEURS}/collecte/'`);
  const champHtml = `<div id="field_${n}_99" class="gfield gfield--type-html gfield_html gfield_html_formatted gfield_no_follows_desc field_sublabel_below gfield--no-description field_description_below gfield_visibility_visible">${ligneDuSite()}</div>`;
  const avecLigne = form.replace(/(<div id='gform_fields_\d+'[^>]*>)/, (debut) => debut + champHtml);
  if (avecLigne === form) throw new Error('champ HTML non pose : la liste des champs du formulaire a change');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fun Galaxy</title></head><body>
<header style="height:64px"></header>
<section class="booking section" id="booking"><div class="container">
<div class="heading"><h2 class="heading__title title--bordered">Réservez en moins d'une minute</h2></div>
<div class="booking__container"><div class="booking__content"><div class="booking__text"><p>Bonjour, je vais vous guider dans votre réservation</p></div></div>
<div class="booking__form">${avecLigne}</div></div>
</div></section>
${S.intrus ? `<iframe id="intrus" src="${PINLANE}/intrus" style="width:10px;height:10px"></iframe>` : ''}
<script>
window.__messages = [];
addEventListener('message', function (e) {
  if (!e.data || typeof e.data.type !== 'string') return;
  window.__messages.push({ type: e.data.type, origine: e.origin, reservationId: e.data.detail && e.data.detail.reservationId, cles: Object.keys(e.data).join(',') });
});
</script>
</body></html>`;
}

// Ce que repond Gravity Forms (une soumission « iframe », celle que leur page fait) : sa confirmation, son formulaire
// renvoye avec une erreur sur le telephone ET le script de leur page (qui nomme #gform_confirmation_wrapper_N et
// gformRedirect(){ sans etre une confirmation), une redirection vers une page de remerciement, ou une panne.
function reponseGravity(n) {
  const enveloppe = (corps) => `<!DOCTYPE html><html><head><meta charset='UTF-8' /></head><body class='GF_AJAX_POSTBACK'>${corps}</body></html>`;
  if (S.reponse === 'panne') return { status: 500, body: '<html><body>Erreur du serveur</body></html>' };
  if (S.reponse === 'redirection') return { status: 200, body: enveloppe(`<script type="text/javascript"> function gformRedirect(){document.location.href='${SITE}/merci/';}</script>`) };
  if (S.reponse === 'refus') {
    const form = formulaire(n).replace(new RegExp(`(id="field_${n}_17" class=")`), (debut) => `${debut}gfield_error `);
    const script = `<script>jQuery('#gform_ajax_frame_${n}').on('load',function(){var contents = jQuery(this).contents().find('*').html();var is_confirmation = jQuery(this).contents().find('#gform_confirmation_wrapper_${n}').length > 0;var is_redirect = contents.indexOf('gformRedirect(){') >= 0;});</script>`;
    return { status: 200, body: enveloppe(form + script) };
  }
  return { status: 200, body: enveloppe(`<div id='gform_confirmation_wrapper_${n}' class='gform_confirmation_wrapper '><div id='gform_confirmation_message_${n}' class='gform_confirmation_message_${n} gform_confirmation_message'>Merci, votre demande est bien envoyée.</div></div>`) };
}

function lireMultipart(type, corps) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type || '');
  if (!m) return null;
  const borne = `--${m[1] || m[2]}`;
  const champs = [];
  for (const morceau of corps.toString('utf8').split(borne).slice(1)) {
    if (morceau.startsWith('--')) break;
    const coupe = morceau.indexOf(CRLF + CRLF);
    if (coupe < 0) continue;
    const nom = (/name="([^"]*)"/.exec(morceau.slice(0, coupe)) || [])[1];
    if (nom === undefined) continue;
    champs.push([nom, morceau.slice(coupe + 4).replace(/\r\n$/, '')]);
  }
  return champs;
}
const valeurs = (post, nom) => (post && post.champs ? post.champs.filter((c) => c[0] === nom).map((c) => c[1]) : []);
const valeur = (post, nom) => valeurs(post, nom)[0];
const present = (post, nom) => valeurs(post, nom).length > 0;

// Le faux cadre Pinlane : il envoie a la page ce qu on lui dit d envoyer et garde ce qu elle lui repond.
const FAUX_CADRE = `<!doctype html><html><head><meta charset="utf-8"></head><body><p>Cadre Pinlane</p><script>
window.__faits = [];
addEventListener('message', function (e) { if (e.data && e.data.type === 'pinlane:miroir-fait') window.__faits.push({ d: e.data, origine: e.origin, duParent: e.source === window.parent }); });
window.__envoyer = function (m) { window.parent.postMessage(m, '*'); };
</script></body></html>`;

let mock = null;
async function brancher(ctx) {
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    let url;
    try { url = new URL(req.url()); } catch (error) { return route.abort(); }
    if (url.origin === SITE || url.origin === AUTRE_SITE) {
      if (req.method() === 'POST') {
        POSTS.push({ url: req.url(), origine: url.origin, type: req.headers()['content-type'] || '', champs: lireMultipart(req.headers()['content-type'], req.postDataBuffer() || Buffer.alloc(0)) });
        const r = reponseGravity(S.gform);
        return route.fulfill({ status: r.status, contentType: 'text/html; charset=UTF-8', body: r.body });
      }
      if (/^\/activites\//.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageSite() });
      return route.fulfill({ status: 404, body: '' });
    }
    if (url.origin === AILLEURS) { AILLEURS_VUS.push(`${req.method()} ${req.url()}`); return route.fulfill({ status: 200, body: 'ok' }); }
    if (url.origin !== PINLANE) return route.abort();
    if (url.pathname === '/embed.js') return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: source('embed.js') });
    if (url.pathname === '/api/public-booking-meta' && url.searchParams.has('embedState')) {
      return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ ok: true, center: url.searchParams.get('center'), actif: S.actif }) });
    }
    if (url.pathname === '/api/public-booking-meta' && req.method() === 'POST') {
      let corps = null;
      try { corps = JSON.parse(req.postData() || ''); } catch (error) { corps = null; }
      if (corps && corps.kind === 'miroir') {
        BALISES.push({ corps, brut: req.postData() || '' });
        return route.fulfill({ status: 202, contentType: 'application/json; charset=utf-8', body: '{"ok":true}' });
      }
    }
    if (!S.vraiCadre) {
      if (/^\/fungalaxy\//.test(url.pathname) || url.pathname === '/reserver' || url.pathname === '/intrus') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FAUX_CADRE });
      return route.abort();
    }
    if (url.pathname === '/assets/fungalaxy-booking.js' || url.pathname === '/assets/fungalaxy-miroir.js') {
      return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: source(url.pathname.slice(1)) });
    }
    const rep = await route.fetch({ url: LOCAL + url.pathname + url.search });
    // La fiche du centre nomme son site : ici, le site du gate.
    if (url.pathname === '/api/public-booking-meta' && req.method() === 'GET') {
      let j = null;
      try { j = await rep.json(); } catch (error) { j = null; }
      if (j && j.center && typeof j.center === 'object') {
        j.center.identity = Object.assign({}, j.center.identity, { siteUrl: SITE });
        return route.fulfill({ response: rep, json: j });
      }
    }
    return route.fulfill({ response: rep });
  });
}

async function ouvrir(browser, { site = SITE, chemin = '/activites/bowling/' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await brancher(ctx);
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.goto(`${site}${chemin}`, { waitUntil: 'domcontentloaded' });
  const el = await page.waitForSelector('#booking .container > iframe[title="Reservation en ligne"]', { timeout: 10000 }).catch(() => null);
  const cadre = el ? await el.contentFrame() : null;
  const src = el ? await el.getAttribute('src') : '';
  return { ctx, page, cadre, src, erreurs };
}

const CLIENT = { nom: 'Marie Essai', telephone: '+32 470 00 00 00', email: 'marie.essai@example.com' };
function ligne(type, extra) {
  return { type, nom: CLIENT.nom, telephone: CLIENT.telephone, email: CLIENT.email, centre: 'Fun Galaxy Libramont', centreId: 'libramont', jour: 'Samedi 21/11/2026', ...extra };
}
async function copier(h, message, { attendre = true } = {}) {
  await h.cadre.waitForFunction(() => typeof window.__envoyer === 'function', null, { timeout: 10000 });
  const avant = await h.cadre.evaluate(() => window.__faits.length);
  await h.cadre.evaluate((m) => window.__envoyer(m), message);
  if (!attendre) { await dormir(1500); return null; }
  const arrive = await h.cadre.waitForFunction((n) => window.__faits.length > n, avant, { timeout: 15000 }).then(() => true).catch(() => false);
  const faits = await h.cadre.evaluate(() => window.__faits.slice());
  return arrive ? faits[faits.length - 1] : null;
}
// L etat du formulaire de la page : chaque champ, coche ou valeur, et le nombre d elements.
const etatDuFormulaire = (page, n) => page.evaluate((id) => {
  const f = document.getElementById(id);
  return f ? { champs: Array.from(f.elements).map((e) => `${e.name}=${e.type === 'radio' || e.type === 'checkbox' ? e.checked : (e.name === 'ak_js' ? '(heure)' : e.value)}`), noeuds: f.querySelectorAll('*').length } : null;
}, `gform_${n}`);

// ===========================================================================
// LE SITE : la page du centre, son formulaire, et un faux cadre qui lui envoie des reservations.
// ===========================================================================
async function proprietesSite(browser) {
  const fixture4 = caches(4);
  section('[A] la ligne du site demande la copie');
  remettre();
  let h = await ouvrir(browser);
  ok(/\/fungalaxy\/libramont\?embed=1/.test(h.src) && /[?&]miroir=1(&|$)/.test(h.src), '[A] le cadre recoit miroir=1', h.src);
  const montage = await h.page.evaluate(() => ({
    masque: getComputedStyle(document.querySelector('#booking .booking__container')).display === 'none' && getComputedStyle(document.querySelector('#booking .heading')).display === 'none',
    formulaire: Boolean(document.getElementById('gform_4')),
  }));
  ok(montage.masque && montage.formulaire, '[A] leur formulaire est masque, et toujours dans la page', JSON.stringify(montage));

  section('[B] deux activites, deux entrees, chacune a son heure');
  const avant = await etatDuFormulaire(h.page, 4);
  const fait = await copier(h, { type: 'pinlane:miroir', id: '4301', lignes: [
    ligne('activite', { activite: 'Bowling', activiteId: 'bowling', heure: '14:00', participants: 8 }),
    ligne('activite', { activite: 'Laser Game', activiteId: 'laser_game', heure: '15:10', participants: 6 }),
  ] });
  ok(POSTS.length === 2, '[B] deux envois a leur formulaire', `${POSTS.length}`);
  ok(POSTS.every((p) => p.url === `${SITE}/activites/bowling/` && /^multipart\/form-data/.test(p.type) && Array.isArray(p.champs)), '[B] a l adresse de leur formulaire, comme leur page l envoie (multipart)', POSTS.map((p) => p.url).join(' '));
  const [b1, b2] = POSTS;
  const attendu1 = { input_5: CLIENT.nom, input_39: 'Libramont', input_37: 'Une activité', input_34: 'bowling', input_36: 'Samedi 21/11/2026', input_38: '8', input_17: CLIENT.telephone, input_18: CLIENT.email };
  const ecarts1 = Object.keys(attendu1).filter((k) => valeur(b1, k) !== attendu1[k]);
  ok(!ecarts1.length, '[B] la premiere entree : nom, centre, « Une activité », Bowling, jour, 8 joueurs, telephone, e-mail', ecarts1.map((k) => `${k}=${valeur(b1, k)}`).join(' '));
  ok(valeurs(b1, 'input_26[]').join(':') === '14:00', '[B] la premiere a 14:00 (heures et minutes)', valeurs(b1, 'input_26[]').join(':'));
  ok(valeur(b2, 'input_34') === 'laser-game' && valeur(b2, 'input_38') === '6' && valeurs(b2, 'input_26[]').join(':') === '15:10', '[B] la seconde : Laser Game, 6 joueurs, 15:10', `${valeur(b2, 'input_34')} ${valeur(b2, 'input_38')} ${valeurs(b2, 'input_26[]').join(':')}`);
  ok(POSTS.every((p) => !present(p, 'input_30')), '[B] la liste des formules (cachee par leur logique) ne part pas : sa premiere option ne se lit pas dans l entree');
  ok(POSTS.every((p) => valeur(p, 'is_submit_4') === '1' && valeur(p, 'gform_submit') === '4' && valeur(p, 'state_4') === fixture4.state && valeur(p, 'gform_ajax') === fixture4.ajax
    && valeur(p, 'gform_target_page_number_4') === '0' && valeur(p, 'gform_source_page_number_4') === '1'), '[B] leurs champs caches partent tels que la page les porte (envoi, etat, ajax, page)');
  ok(POSTS.every((p) => present(p, 'ak_hp_textarea') && valeur(p, 'ak_hp_textarea') === '' && /^\d{13}$/.test(valeur(p, 'ak_js') || '')), '[B] et leur anti-spam aussi : le pot de miel vide, l heure d arrivee sur la page', POSTS.map((p) => valeur(p, 'ak_js')).join(' '));
  ok(Boolean(fait) && fait.duParent && fait.origine === SITE && fait.d.ok === true && fait.d.envoyees === 2 && fait.d.lignes === 2 && fait.d.raison === '', '[B] le cadre apprend que les deux entrees sont passees', JSON.stringify(fait));

  section('[C] le formulaire de la page n est pas touche');
  const apres = await etatDuFormulaire(h.page, 4);
  ok(Boolean(avant) && JSON.stringify(avant) === JSON.stringify(apres), '[C] ses champs et ses elements sont les memes avant et apres la copie', JSON.stringify(apres && apres.champs.filter((c) => !/=(|false|0|1|Libramont|arcades|1652)$/.test(c) && !/^(state|gform|is_submit|ak_)/.test(c))));

  section('[G] une reservation ne se recopie qu une fois');
  await copier(h, { type: 'pinlane:miroir', id: '4301', lignes: [ligne('activite', { activite: 'Bowling', activiteId: 'bowling', heure: '14:00', participants: 8 })] }, { attendre: false });
  ok(POSTS.length === 2, '[G] le meme numero renvoye ne part pas une deuxieme fois', `${POSTS.length} envois`);

  section('[D] une formule');
  POSTS.length = 0;
  const faitF = await copier(h, { type: 'pinlane:miroir', id: '4302', lignes: [ligne('formule', { formule: 'FORMULE 1', formuleId: 'f1', heure: '18:30', participants: 12 })] });
  const f1 = POSTS[0];
  ok(POSTS.length === 1 && valeur(f1, 'input_37') === 'Une formule' && valeur(f1, 'input_30') === '1654' && !present(f1, 'input_34') && valeurs(f1, 'input_26[]').join(':') === '18:30' && valeur(f1, 'input_38') === '12',
    '[D] une entree « Une formule », Formule 1 (1654), 18:30, 12 personnes, sans la liste des activites', f1 ? `${valeur(f1, 'input_37')} ${valeur(f1, 'input_30')} ${present(f1, 'input_34')}` : 'aucun envoi');
  ok(Boolean(faitF) && faitF.d.ok === true, '[D] et passee', JSON.stringify(faitF && faitF.d));

  section('[E] une activite absente de leur liste');
  POSTS.length = 0;
  const faitE = await copier(h, { type: 'pinlane:miroir', id: '4303', lignes: [ligne('activite', { activite: 'Lancer de hache', activiteId: 'axe_throwing', heure: '16:00', participants: 4 })] });
  const e1 = POSTS[0];
  ok(POSTS.length === 1 && present(e1, 'input_34') && valeur(e1, 'input_34') === '', '[E] la liste des activites part vide, jamais « Arcades » (leur premiere option)', e1 ? `input_34=${valeur(e1, 'input_34')}` : 'aucun envoi');
  ok(e1 && valeur(e1, 'input_36') === 'Samedi 21/11/2026 · Lancer de hache', '[E] le nom de l activite se lit a cote du jour', e1 && valeur(e1, 'input_36'));
  ok(Boolean(faitE) && faitE.d.ok === false && faitE.d.raison === 'activite-inconnue' && faitE.d.envoyees === 1, '[E] la copie se dit incomplete (activite-inconnue), mais envoyee', JSON.stringify(faitE && faitE.d));

  section('[F] refus, panne, page de remerciement');
  POSTS.length = 0;
  S.reponse = 'refus';
  const faitR = await copier(h, { type: 'pinlane:miroir', id: '4304', lignes: [ligne('activite', { activite: 'Bowling', activiteId: 'bowling', heure: '14:00', participants: 8 })] });
  ok(Boolean(faitR) && faitR.d.ok === false && faitR.d.raison === 'refuse:17' && faitR.d.envoyees === 0, '[F] leur formulaire renvoye avec une erreur sur le telephone : refuse:17, et le script de leur page ne passe pas pour une confirmation', JSON.stringify(faitR && faitR.d));
  S.reponse = 'panne';
  const faitP = await copier(h, { type: 'pinlane:miroir', id: '4305', lignes: [ligne('activite', { activite: 'Bowling', activiteId: 'bowling', heure: '14:00', participants: 8 })] });
  ok(Boolean(faitP) && faitP.d.ok === false && faitP.d.raison === 'http-500', '[F] une panne de leur site : http-500', JSON.stringify(faitP && faitP.d));
  S.reponse = 'redirection';
  const faitM = await copier(h, { type: 'pinlane:miroir', id: '4306', lignes: [ligne('activite', { activite: 'Bowling', activiteId: 'bowling', heure: '14:00', participants: 8 })] });
  ok(Boolean(faitM) && faitM.d.ok === true && faitM.d.envoyees === 1, '[F] une page de remerciement (redirection) compte comme recue', JSON.stringify(faitM && faitM.d));
  ok(h.erreurs.length === 0, '[B-G] aucune erreur JavaScript sur la page du site', h.erreurs.slice(0, 2).join(' | '));
  await h.ctx.close();

  section('[H] seul le cadre pose par embed.js est ecoute');
  remettre({ intrus: true });
  h = await ouvrir(browser);
  const intrus = h.page.frames().find((fr) => /\/intrus$/.test(fr.url()));
  await intrus.waitForFunction(() => typeof window.__envoyer === 'function', null, { timeout: 10000 });
  await intrus.evaluate((m) => window.__envoyer(m), { type: 'pinlane:miroir', id: '4401', lignes: [ligne('activite', { activite: 'Bowling', activiteId: 'bowling', heure: '14:00', participants: 8 })] });
  await h.page.evaluate((m) => window.postMessage(m, '*'), { type: 'pinlane:miroir', id: '4402', lignes: [ligne('activite', { activite: 'Bowling', activiteId: 'bowling', heure: '14:00', participants: 8 })] });
  await dormir(1500);
  ok(POSTS.length === 0, '[H] un autre cadre de la meme origine et la page elle-meme n envoient rien', `${POSTS.length} envois`);
  await copier(h, { type: 'pinlane:miroir', id: '4403', lignes: [ligne('activite', { activite: 'Bowling', activiteId: 'bowling', heure: '14:00', participants: 8 })] });
  ok(POSTS.length === 1, '[H] le cadre d embed.js, lui, est entendu (le silence d avant n etait pas une panne du montage)', `${POSTS.length} envois`);
  await h.ctx.close();

  section('[I] sans data-miroir, rien ne part');
  remettre({ miroir: '' });
  h = await ouvrir(browser);
  ok(Boolean(h.src) && !/miroir=/.test(h.src), '[I] le cadre ne recoit pas miroir=1', h.src);
  await copier(h, { type: 'pinlane:miroir', id: '4501', lignes: [ligne('activite', { activite: 'Bowling', activiteId: 'bowling', heure: '14:00', participants: 8 })] }, { attendre: false });
  ok(POSTS.length === 0, '[I] une reservation annoncee par le cadre ne part pas', `${POSTS.length} envois`);
  await h.ctx.close();
  // data-miroir sur le parcours standard (sans data-design="fungalaxy") : seul le formulaire aux couleurs du centre
  // sait envoyer la copie, la ligne ne la demande donc pas, et la page n ecoute rien.
  remettre({ design: '' });
  h = await ouvrir(browser);
  ok(/\/reserver\?embed=1/.test(h.src) && !/miroir=/.test(h.src), '[I] data-miroir sur le parcours standard : le cadre ne recoit pas miroir=1', h.src);
  await copier(h, { type: 'pinlane:miroir', id: '4502', lignes: [ligne('activite', { activite: 'Bowling', activiteId: 'bowling', heure: '14:00', participants: 8 })] }, { attendre: false });
  ok(POSTS.length === 0, '[I] et une reservation annoncee par ce cadre ne part pas', `${POSTS.length} envois`);
  await h.ctx.close();

  section('[J] les donnees ne quittent pas le site');
  remettre({ actionAilleurs: true });
  h = await ouvrir(browser);
  const faitJ = await copier(h, { type: 'pinlane:miroir', id: '4601', lignes: [ligne('activite', { activite: 'Bowling', activiteId: 'bowling', heure: '14:00', participants: 8 })] });
  ok(AILLEURS_VUS.length === 0 && POSTS.length === 0, '[J] un formulaire qui enverrait sur une autre adresse n est pas utilise', AILLEURS_VUS.join(' '));
  ok(Boolean(faitJ) && faitJ.d.raison === 'formulaire-absent', '[J] et la copie se dit ratee (formulaire-absent)', JSON.stringify(faitJ && faitJ.d));
  await h.ctx.close();

  section('[K] Gembloux, formulaire 1');
  remettre({ gform: 1, centre: 'gembloux', miroir: '#gform_1' });
  const fixture1 = caches(1);
  h = await ouvrir(browser, { chemin: '/activites/bowling-gembloux/' });
  ok(/\/fungalaxy\/gembloux\?embed=1/.test(h.src), '[K] le cadre de Gembloux', h.src);
  const faitK = await copier(h, { type: 'pinlane:miroir', id: '4701', lignes: [
    ligne('activite', { centre: 'Fun Galaxy Gembloux', centreId: 'gembloux', activite: 'Bowling', activiteId: 'bowling', heure: '20:00', participants: 5 }),
    ligne('activite', { centre: 'Fun Galaxy Gembloux', centreId: 'gembloux', activite: 'Billards', activiteId: 'billards', heure: '21:00', participants: 4 }),
  ] });
  const [g1, g2] = POSTS;
  ok(POSTS.length === 2 && POSTS.every((p) => valeur(p, 'input_40') === 'Gembloux' && !present(p, 'input_39') && valeur(p, 'is_submit_1') === '1' && valeur(p, 'gform_submit') === '1' && valeur(p, 'state_1') === fixture1.state),
    '[K] deux entrees au centre Gembloux (son champ 40), avec les champs caches du formulaire 1', POSTS.map((p) => `${valeur(p, 'input_40')}/${valeur(p, 'gform_submit')}`).join(' '));
  ok(valeur(g1, 'input_34') === 'bowling-gembloux' && valeur(g2, 'input_34') === 'billard-gembloux', '[K] avec les valeurs de leur liste de Gembloux (bowling-gembloux, billard-gembloux)', `${valeur(g1, 'input_34')} ${valeur(g2, 'input_34')}`);
  ok(Boolean(faitK) && faitK.d.ok === true && faitK.d.envoyees === 2, '[K] et passees', JSON.stringify(faitK && faitK.d));
  await h.ctx.close();

  section('[L] le bouton de retour : l ancien formulaire, sans residu');
  remettre({ actif: false });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await brancher(ctx);
  const page = await ctx.newPage();
  await page.goto(`${SITE}/activites/bowling/`, { waitUntil: 'domcontentloaded' });
  const rendu = await page.waitForFunction(() => !document.querySelector('iframe[title="Reservation en ligne"]') && getComputedStyle(document.querySelector('#booking .booking__container')).display !== 'none', null, { timeout: 8000 }).then(() => true).catch(() => false);
  const residu = await page.evaluate(() => ({
    cadres: document.querySelectorAll('iframe[title="Reservation en ligne"]').length,
    masques: document.querySelectorAll('style[data-pinlane]').length,
    noscript: document.querySelectorAll('#booking .container > noscript').length,
    titre: getComputedStyle(document.querySelector('#booking .heading')).display !== 'none',
    formulaire: getComputedStyle(document.getElementById('gform_wrapper_4')).display !== 'none' && document.getElementById('gform_4').offsetParent !== null,
  }));
  ok(rendu && residu.cadres === 0 && residu.masques === 0 && residu.noscript === 0, '[L] plus de cadre, plus de masque, rien de pose par nous dans la section', JSON.stringify(residu));
  ok(residu.titre && residu.formulaire, '[L] leur titre et leur formulaire sont visibles', JSON.stringify(residu));
  const etatL = await etatDuFormulaire(page, 4);
  ok(Boolean(etatL) && etatL.champs.filter((c) => /^input_(5|36|38|17|18|26\[\])=/.test(c)).every((c) => /=$/.test(c)), '[L] leurs champs sont vides, comme ils les ont faits', JSON.stringify(etatL && etatL.champs.slice(0, 4)));
  ok(POSTS.length === 0, '[L] rien n a ete envoye a leur formulaire', `${POSTS.length}`);
  await ctx.close();
}

// ===========================================================================
// DE BOUT EN BOUT : le vrai formulaire Pinlane dans le cadre, une vraie reservation.
// ===========================================================================
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function jourAttendu(iso) {
  const [a, m, j] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  return `${cap(JOURS[d.getUTCDay()])} ${String(j).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;
}
async function attendre(cible, fn, ms, arg) {
  try { await cible.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch (error) {
    return Boolean(await cible.evaluate(fn, arg).catch(() => false));
  }
}
async function allerAuMois(f, dateStr) {
  const [y, mo] = dateStr.split('-').map(Number);
  const cible = `${cap(MOIS[mo - 1])} ${y}`;
  for (let k = 0; k < 16; k += 1) {
    const titre = await f.evaluate(() => document.querySelector('#calTitle').textContent.trim());
    if (titre === cible) break;
    const [nom, an] = titre.split(' ');
    const courant = Number(an) * 12 + MOIS.indexOf(nom.toLowerCase());
    await f.click(y * 12 + (mo - 1) > courant ? '#calNext' : '#calPrev');
    await attendre(f, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, titre);
  }
  return attendre(f, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, dateStr);
}
async function reserverUnBowling(h) {
  const f = h.cadre;
  await f.waitForSelector('body.is-ready', { timeout: 30000 });
  await f.click('#dayBtn');
  await allerAuMois(f, mock.DATE);
  await f.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
  await attendre(f, () => document.querySelector('#dayPop').hidden, 3000);
  await f.click('#goActivities');
  await f.click('#gridAct .fg-card[data-activity="bowling"]');
  await f.click('#goHours');
  await attendre(f, () => !document.querySelector('#goContact').disabled, 25000);
  await f.click('#goContact');
  await f.fill('#cPrenom', 'Test'); await f.fill('#cNom', 'Copie'); await f.fill('#cEmail', 'copie@example.com'); await f.fill('#cTel', '0491301667');
  await f.click('#occasions .fg-occasion[data-occasion="anniversaire"]');
  await f.check('#cConsent');
  await f.click('#goRecap');
  if (!await attendre(f, () => document.querySelector('.fg-scene[data-scene="recap"].is-active'), 8000)) {
    const ou = await f.evaluate(() => ({ scene: (document.querySelector('.fg-scene.is-active') || {}).getAttribute && document.querySelector('.fg-scene.is-active').getAttribute('data-scene'), erreurs: Array.from(document.querySelectorAll('.fg-error, [role="alert"]')).map((e) => e.textContent.trim()).filter(Boolean).slice(0, 3) }));
    throw new Error(`recapitulatif non atteint : ${JSON.stringify(ou)}`);
  }
  await attendre(f, () => { const v = document.querySelector('#vitrine'); return !v || !v.hasAttribute('data-attendue'); }, 5000);
  if (await f.evaluate(() => { const v = document.querySelector('#vitrine'); return Boolean(v && !v.hidden); })) {
    await f.click('#vitrine .fg-vitrine__non');
    await attendre(f, () => document.querySelector('#vitrine').hidden, 3000);
  }
  mock.dernierePose.body = null;
  await f.click('#confirmBtn');
  return attendre(h.page, () => (window.__messages || []).some((m) => m.type === 'pinlane:booking'), 15000);
}
async function proprietesBoutEnBout(browser) {
  section('[M] de bout en bout, le vrai formulaire Pinlane');
  remettre({ vraiCadre: true });
  let h = await ouvrir(browser);
  const reserve = await reserverUnBowling(h);
  ok(reserve, '[M] la reservation est confirmee dans le cadre (pinlane:booking recu par la page)');
  await attendre(h.page, () => true, 10);
  for (let k = 0; k < 100 && !(POSTS.length && BALISES.length); k += 1) await dormir(100);
  const corps = mock.dernierePose.body || {};
  const messages = await h.page.evaluate(() => window.__messages.slice());
  const numero = (messages.find((m) => m.type === 'pinlane:booking') || {}).reservationId;
  const blocs = ((corps.opsPlan || {}).resourceBlocks || []).filter((b) => b && b.activityId === 'bowling' && b.startTime).map((b) => String(b.startTime)).sort();
  const heure = blocs[0] || String(corps.startTime || '');
  const p = POSTS[0];
  ok(POSTS.length === 1 && Boolean(p.champs), '[M] une entree part dans leur formulaire', `${POSTS.length}`);
  const attendu = { input_5: corps.name, input_17: corps.phone, input_18: corps.email, input_37: 'Une activité', input_34: 'bowling', input_39: 'Libramont', input_36: corps.date ? jourAttendu(corps.date) : '?', input_38: String(corps.pax) };
  const ecarts = Object.keys(attendu).filter((k) => valeur(p, k) !== attendu[k]);
  ok(Boolean(corps.name) && !ecarts.length, '[M] avec ce que le client a tape et ce qu il a reserve : nom, telephone, e-mail, Bowling, Libramont, jour, joueurs', ecarts.map((k) => `${k}=${valeur(p, k)} (attendu ${attendu[k]})`).join(' '));
  ok(valeurs(p, 'input_26[]').map((v, i) => (i ? v : v.padStart(2, '0'))).join(':') === heure, '[M] a l heure du bowling dans le plan rendu', `${valeurs(p, 'input_26[]').join(':')} attendu ${heure}`);
  const balise = BALISES[0];
  ok(BALISES.length === 1 && balise.corps.ok === true && balise.corps.reservationId === Number(numero) && balise.corps.centerId === 'libramont' && balise.corps.envoyees === 1,
    '[M] Pinlane apprend que la copie de CETTE reservation est passee', JSON.stringify(balise && balise.corps));
  ok(Boolean(balise) && ['Test Copie', 'copie@example.com', '0491301667', corps.phone].every((x) => x && balise.brut.indexOf(x) < 0), '[M] et ce signal ne porte rien de personnel');
  ok(messages.filter((m) => m.type === 'pinlane:miroir').length === 1, '[M] la page a recu la reservation une seule fois', messages.map((m) => m.type).join(','));
  ok(h.erreurs.length === 0, '[M] aucune erreur JavaScript sur la page du site', h.erreurs.slice(0, 2).join(' | '));
  await h.ctx.close();

  section('[N] sur un autre site que celui du centre');
  remettre({ vraiCadre: true });
  h = await ouvrir(browser, { site: AUTRE_SITE });
  const reserveN = await reserverUnBowling(h);
  ok(reserveN, '[N] la reservation est confirmee dans le cadre');
  for (let k = 0; k < 60 && !BALISES.length; k += 1) await dormir(100);
  const messagesN = await h.page.evaluate(() => window.__messages.slice());
  ok(!messagesN.some((m) => m.type === 'pinlane:miroir') && POSTS.length === 0, '[N] la page d un autre site ne recoit rien de personnel, rien ne part', messagesN.map((m) => m.type).join(','));
  ok(BALISES.length === 1 && BALISES[0].corps.ok === false && BALISES[0].corps.raison === 'autre-site', '[N] et Pinlane sait que la copie n a pas eu lieu (autre-site)', JSON.stringify(BALISES[0] && BALISES[0].corps));
  await h.ctx.close();
}

// ===========================================================================
// LE SERVEUR : le vrai handler, sans base ni Telegram.
// ===========================================================================
async function proprietesServeur() {
  section('[O] le serveur');
  const database = require(path.join(ROOT, 'lib/database'));
  const rateLimit = require(path.join(ROOT, 'lib/rate-limit'));
  const gardeAlertes = require(path.join(ROOT, 'lib/garde-alertes'));
  const avant = { getPool: database.getPool, enforceRateLimit: rateLimit.enforceRateLimit, alerter: gardeAlertes.alerter };
  const requetes = [];
  const alertes = [];
  database.getPool = () => ({ query: async (sql, params) => { requetes.push(params); return { rowCount: params[0] === 'libramont' && Number(params[1]) === 4301 ? 1 : 0, rows: [] }; } });
  rateLimit.enforceRateLimit = () => false;
  gardeAlertes.alerter = async (cle, texte, options) => { alertes.push({ cle, texte, options }); return { ok: true }; };
  const fichier = path.join(ROOT, 'api/public-booking-meta.js');
  const m = new Module(fichier, module);
  m.filename = fichier;
  m.paths = Module._nodeModulePaths(path.dirname(fichier));
  const infos = console.info;
  console.info = () => {};
  try {
    m._compile(source('api/public-booking-meta.js'), fichier);
    const handler = m.exports;
    const appeler = async (corps) => {
      const brut = Buffer.from(JSON.stringify(corps));
      const req = Readable.from([brut]);
      Object.assign(req, { method: 'POST', url: '/api/public-booking-meta', headers: { host: 'pinlane.test', 'content-type': 'application/json', 'content-length': String(brut.length) }, socket: { remoteAddress: '203.0.113.9' }, connection: { remoteAddress: '203.0.113.9' } });
      const res = { statusCode: 200, headers: {}, headersSent: false, setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; }, getHeader(k) { return this.headers[String(k).toLowerCase()]; }, writeHead(s) { this.statusCode = s; return this; }, end(b) { this.corps = String(b || ''); this.headersSent = true; } };
      await handler(req, res);
      return res;
    };
    const reussie = await appeler({ kind: 'miroir', centerId: 'libramont', reservationId: 4301, ok: true, raison: '', lignes: 2, envoyees: 2 });
    ok(reussie.statusCode === 202 && alertes.length === 0 && requetes.some((p) => p[0] === 'libramont' && Number(p[1]) === 4301), '[O] une copie reussie d une vraie reservation : lue, 202, aucune alerte', `${reussie.statusCode} ${alertes.length}`);
    const ratee = await appeler({ kind: 'miroir', centerId: 'libramont', reservationId: 4301, ok: false, raison: 'refuse:17;<b>pirate</b> http://x.test', lignes: 2, envoyees: 1 });
    const texte = (alertes[0] || {}).texte || '';
    ok(ratee.statusCode === 202 && alertes.length === 1 && /n°4301/.test(texte) && /a refusé l’envoi/.test(texte) && /1 entrée recopiée sur 2/.test(texte), '[O] une copie ratee sonne : le numero, ce qui s est passe en mots simples, combien d entrees', texte);
    ok(!/pirate|<b>|http:\/\/x|r\u00e9pondu une erreur/.test(texte) && !/[\u2013\u2014]/.test(texte), '[O] sans rien recopier de ce que le navigateur a ecrit (une adresse glissee ne se lit pas comme une raison), sans tiret long', texte);
    await appeler({ kind: 'miroir', centerId: 'libramont', reservationId: 4999, ok: false, raison: 'refuse:17', lignes: 1, envoyees: 0 });
    await appeler({ kind: 'miroir', centerId: 'centre-inconnu', reservationId: 4301, ok: false, raison: 'reseau', lignes: 1, envoyees: 0 });
    ok(alertes.length === 1, '[O] une reservation inconnue ou un centre inconnu ne sonnent pas', `${alertes.length} alertes`);
  } finally {
    console.info = infos;
    Object.assign(database, { getPool: avant.getPool });
    rateLimit.enforceRateLimit = avant.enforceRateLimit;
    gardeAlertes.alerter = avant.alerter;
  }
}

// ===========================================================================
// LES CONTRE-EPREUVES : chacune doit faire rougir au moins une propriete.
// ===========================================================================
const MUTATIONS = [
  { nom: 'source-non-verifiee', partie: 'site', fichier: 'embed.js', de: 'if (event.source !== frame.contentWindow) return;', vers: '' },
  { nom: 'recopiee-deux-fois', partie: 'site', fichier: 'embed.js', de: 'recopiees[id] = true;', vers: 'recopiees[id] = false;' },
  { nom: 'liste-cachee-envoyee', partie: 'site', fichier: 'embed.js', de: 'if (cachee) donnees.delete(cachee.name);', vers: '' },
  { nom: 'premiere-option', partie: 'site', fichier: 'embed.js', de: "|| (seuleSiUnique && options.length === 1 ? options[0].value : '');", vers: "|| (options.length ? options[0].value : '');" },
  { nom: 'confirmation-naive', partie: 'site', fichier: 'embed.js', de: "if (/id=['\"]gform_confirmation_(?:wrapper|message)_\\d+['\"]/.test(html) || ", vers: 'if (/gform_confirmation_/.test(html) || ' },
  { nom: 'envoi-ailleurs', partie: 'site', fichier: 'embed.js', de: 'if (adresse && adresse.origin === window.location.origin) cible = adresse.href;', vers: 'if (adresse) cible = adresse.href;' },
  { nom: 'sans-demande', partie: 'site', fichier: 'embed.js', de: 'if (!miroirDemande || !/^\\d{1,12}$/.test(id) || recopiees[id]) return;', vers: 'if (!/^\\d{1,12}$/.test(id) || recopiees[id]) return;' },
  { nom: 'masque-laisse', partie: 'site', fichier: 'embed.js', de: 'if (masque && masque.parentNode) masque.parentNode.removeChild(masque);', vers: '' },
  { nom: 'formulaire-touche', partie: 'site', fichier: 'embed.js', de: 'var donnees = new FormData(form);', vers: "var donnees = new FormData(form); if (champs.nom) form.querySelector('[name=\"' + champs.nom + '\"]').value = ligne.nom;" },
  { nom: 'autre-site-servi', partie: 'cadre', fichier: 'assets/fungalaxy-miroir.js', de: "if (!siteDuCentre(parentOrigin)) { signaler({ id: id, ok: false, raison: 'autre-site' }); return; }", vers: '' },
  { nom: 'jamais-appelee', partie: 'cadre', fichier: 'assets/fungalaxy-booking.js', de: 'if (MIROIR) recopierDansLAncienFormulaire(r, { date: dateRes, heure: heureRes, pax: paxRes });', vers: '' },
  { nom: 'resultat-perdu', partie: 'cadre', fichier: 'assets/fungalaxy-miroir.js', de: "if (d.type !== 'pinlane:miroir-fait' || !attendu || String(d.id) !== attendu.id) return;", vers: 'return;' },
  { nom: 'reservation-non-verifiee', partie: 'serveur', fichier: 'api/public-booking-meta.js', de: 'if (!r.rowCount) { sendJson(res, 202, { ok: true }); return; }', vers: '' },
  { nom: 'raison-recopiee', partie: 'serveur', fichier: 'api/public-booking-meta.js', de: "const pourquoi = (raisons.length ? raisons : ['reponse-inconnue']).map((cle) => RAISONS_MIROIR[cle]).join(' ; ');", vers: "const pourquoi = String(body.raison || '');" },
  { nom: 'succes-qui-sonne', partie: 'serveur', fichier: 'api/public-booking-meta.js', de: 'if (!reussie) {', vers: 'if (true) {' },
];

async function jouer(browser, parties) {
  if (parties.includes('site')) await proprietesSite(browser);
  if (parties.includes('cadre')) await proprietesBoutEnBout(browser);
  if (parties.includes('serveur')) await proprietesServeur();
}

async function main() {
  mock = require('./dev-tunnel-server');
  const srv = mock.createServer({ port: PORT });
  await new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(PORT, '127.0.0.1', resolve); });
  // Hors de la machine, aucune adresse ne se resout : rien ne peut atteindre un vrai site.
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'] });
  let code = 0;
  try {
    if (!CONTRE) {
      const parties = (process.argv.find((a) => a.startsWith('--parties=')) || '--parties=site,cadre,serveur').slice('--parties='.length).split(',');
      await jouer(browser, parties);
      console.log(echecs ? `\n${echecs} echec(s).` : '\nToutes les proprietes de la copie tiennent.');
      code = echecs ? 1 : 0;
    } else {
      const jouees = MUTATIONS.filter((mu) => !SEUL || mu.nom === SEUL);
      let sourdes = 0;
      for (const mu of jouees) {
        const brut = source(mu.fichier);
        const n = brut.split(mu.de).length - 1;
        if (n !== 1) throw new Error(`contre-epreuve ${mu.nom} non montable : ancre presente ${n} fois dans ${mu.fichier}`);
        overrides.set(mu.fichier, brut.split(mu.de).join(mu.vers));
        echecs = 0;
        muet = true;
        try { await jouer(browser, [mu.partie]); } catch (error) { echecs += 1; } finally { muet = false; overrides.clear(); }
        console.log(`${echecs ? 'mord' : 'NE MORD PAS'}  ${mu.nom} (${mu.partie}, ${echecs} propriete(s) rouge(s))`);
        if (!echecs) sourdes += 1;
      }
      console.log(sourdes ? `\n${sourdes} contre-epreuve(s) sans effet.` : `\nLes ${jouees.length} contre-epreuves mordent.`);
      code = sourdes ? 1 : 0;
    }
  } finally {
    await browser.close().catch(() => {});
    srv.close();
  }
  process.exit(code);
}

main().catch((error) => { console.error(error); process.exit(1); });
