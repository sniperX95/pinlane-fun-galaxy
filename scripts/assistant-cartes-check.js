'use strict';
// LA CARTE D UN CHANGEMENT, LES NOUVEAUX GESTES DU MARKETING (2026-11-13). Ansar : « l'ia marketing jtrouve
// quelle a pas assez dacces quelle sait pas faire assez de chose et quelle presente les choses quelle
// modifie vrm pas assez bien dutout ».
//
// Ce que ce banc prouve, sur le vrai code :
//  [N] les gestes de mail rendent le mail ENTIER, avant et apres, de qui et pour qui, avec le public d une
//      campagne (lib/assistant-gestes.js) ; l essai part a la seule adresse de la personne, le renvoi ne
//      relance qu un mail echoue de ce centre et seulement si la personne l a demande ; une carte de geste
//      se garde entiere au serveur (lib/assistant-memoire.js), jamais reduite a une phrase a retenir.
//  [U] la vraie page Marketing (index.html, assets/pinlane-assistant.js et .css) : la carte dit en tete ce qui
//      va se passer ; l ancien barre a cote du nouveau en grand ; un etat en pastilles ; le mail comme Gmail,
//      ses variables en etiquettes, ses changements marques, deux vues ; un long mail se replie ; faite, la
//      carte garde la valeur, l ancienne et l heure ; rouverte depuis le serveur, elle reste une carte de
//      geste ; le panneau du savoir dit le centre d un fait appris ailleurs ; rien ne deborde au telephone.
//
// CONTRE-PREUVES : `--contre-preuves` casse une regle a la fois, en memoire, et exige que son controle rougisse.
// Lancement : node scripts/assistant-cartes-check.js [--contre-preuves]
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_ASSISTANT_CARTES_PORT || 4281);
const NAVIGATEUR = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const GESTES = 'lib/assistant-gestes.js';
const MEM = 'lib/assistant-memoire.js';
const ECRAN = 'assets/pinlane-assistant.js';

const MUTATIONS = [
  { nom: 'public-oublie', rouge: '[N] un brouillon de campagne montre le mail entier, de qui et pour combien de clients', editions: [{ fichier: GESTES, de: "      const pourQui = `${seg.label}${combien != null ? `, ${clientsDits(combien)}` : ''}`;", vers: '      const pourQui = seg.label;' }] },
  { nom: 'apercu-sans-avant', rouge: '[N] un texte de sequence change montre l ancien et le nouveau en entier', editions: [{ fichier: GESTES, de: '    ...(ta !== null && ta !== t ? { texteAvant: ta } : {}),\n', vers: '' }] },
  { nom: 'essai-sans-adresse', rouge: '[N] sans adresse sur le compte, l essai se refuse', editions: [{ fichier: GESTES, de: "      if (!EMAIL_RX.test(adresse)) throw erreur('Votre compte n’a pas d’adresse mail : ajoutez-la dans Réglages pour recevoir un essai.');\n", vers: '' }] },
  { nom: 'renvoi-sans-demande', rouge: '[N] un mail ne se renvoie que si la personne l a demande', editions: [{ fichier: GESTES, de: "    action: 'retryCommunication', permission: 'emails.send', risque: true,", vers: "    action: 'retryCommunication', permission: 'emails.send', risque: false," }] },
  { nom: 'renvoi-d-un-mail-parti', rouge: '[N] seul un mail echoue de ce centre se renvoie', editions: [{ fichier: GESTES, de: "      if (c.status !== 'failed') throw erreur(`Le mail n° ${numero} n’a pas échoué : il n’y a rien à renvoyer.`);\n", vers: '' }] },
  { nom: 'carte-reduite-au-texte', rouge: '[N] le serveur garde la carte d un geste entiere', editions: [{ fichier: MEM, de: '    propositions: Array.isArray(m.propositions) ? m.propositions.slice(0, 3).map(propositionPropre).filter(Boolean) : [],', vers: '    propositions: Array.isArray(m.propositions) ? m.propositions.slice(0, 3).map((p) => ({ texte: texteDe(p && p.texte, FAIT_MAX), etat: texteDe(p && p.etat, 12), id: Number(p && p.id) || 0 })) : [],' }] },
  { nom: 'titre-perdu', rouge: '[U] la carte dit en tete ce qui va se passer', editions: [{ fichier: ECRAN, de: "${titre ? `<p class=\"ast-carte-titre\">${esc(titre)}</p>` : ''}", vers: '' }] },
  { nom: 'valeur-a-plat', rouge: '[U] ce qui change se lit en grand, l ancien barre a cote', editions: [{ fichier: ECRAN, de: "${changes.length ? `<dl class=\"ast-carte-changes\">${changes.map(([k, v]) => htmlChange(k, v)).join('')}</dl>` : ''}", vers: '' }] },
  { nom: 'etat-sans-pastille', rouge: '[U] un etat se lit en pastilles, coupee puis allumee', editions: [{ fichier: ECRAN, de: "    const etat = etatDe(avant) && etatDe(apres);\n    const large = !etat", vers: "    const etat = '';\n    const large = !etat" }] },
  { nom: 'mail-a-plat', rouge: '[U] le mail se lit comme dans Gmail, de qui, pour qui, objet et texte entiers', editions: [{ fichier: ECRAN, de: "      ${mail ? htmlMail(p, i, mail) : ''}\n", vers: '' }] },
  { nom: 'variables-brutes', rouge: '[U] une variable se lit en etiquette, jamais en accolades', editions: [{ fichier: ECRAN, de: "const avecVariables = (h) => h.replace(", vers: "const avecVariables = (h) => h || h.replace(" }] },
  { nom: 'paragraphe-du-retire', rouge: '[U] un mot remplace en fin de phrase ne cree pas de paragraphe', editions: [{ fichier: ECRAN, de: "${suivi ? (mot ? ' ' : '') : esc(blanc)}", vers: '${esc(blanc)}' }] },
  { nom: 'sans-marques', rouge: '[U] ce qui change dans le texte est marque, l ajoute surligne, le retire barre', editions: [{ fichier: ECRAN, de: "    const dTexte = vue === 'changements' && mail.texteAvant !== undefined ? differenceGardee(mail, 'texte') : null;", vers: '    const dTexte = null;' }] },
  { nom: 'vue-figee', rouge: '[U] les deux vues du mail se choisissent', editions: [{ fichier: ECRAN, de: "      if (p) { p.vueMail = n.dataset.vue === 'propre' ? 'propre' : 'changements'; peindreMessage(m); }", vers: '      if (p) { peindreMessage(m); }' }] },
  { nom: 'mail-jamais-replie', rouge: '[U] un long mail se replie et se lit en entier d un clic', editions: [{ fichier: ECRAN, de: "    const long = String(mail.texte || '').split('\\n').length > 14 || String(mail.texte || '').length > 900;", vers: '    const long = false;' }] },
  { nom: 'faite-sans-valeur', rouge: '[U] faite, la carte garde la nouvelle valeur et l ancienne', editions: [{ fichier: ECRAN, de: "        ${changes.length ? `<dl class=\"ast-carte-changes est-fige\">${changes.map(([k, v]) => htmlChangeFait(k, v)).join('')}</dl>` : ''}", vers: '' }] },
  { nom: 'faite-sans-heure', rouge: '[U] faite, la carte dit l heure ou c est fait', editions: [{ fichier: ECRAN, de: '      const quand = heureFaite(p.faitA);', vers: "      const quand = '';" }] },
  { nom: 'ailleurs-modifiable', rouge: '[U] le panneau dit le centre d un fait appris ailleurs, sans le changer d ici', editions: [{ fichier: ECRAN, de: '      if (f.centreId && f.centreId !== centreId()) return ', vers: '      if (false) return ' }] },
];

function appliquer(texte, editions) {
  let t = texte.replace(/\r\n/g, '\n');
  editions.forEach((e) => {
    if (t.split(e.de).length !== 2) throw new Error(`ancre introuvable ou multiple : ${e.de.slice(0, 90)}`);
    t = t.split(e.de).join(e.vers);
  });
  return t;
}
function sourceMutee(rel, editions) {
  const miennes = editions.filter((e) => e.fichier === rel);
  return miennes.length ? appliquer(fs.readFileSync(path.join(ROOT, rel), 'utf8'), miennes) : null;
}
// Un module mute se compile en memoire, sous son vrai nom : rien ne s ecrit sur le disque, et ses
// propres require (lib/assistant-gestes-centre.js...) se resolvent comme en vrai.
function charger(rel, editions) {
  const fichier = path.join(ROOT, rel);
  const mute = sourceMutee(rel, editions);
  if (mute === null) return require(fichier);
  const m = new Module(fichier, module);
  m.filename = fichier;
  m.paths = Module._nodeModulePaths(path.dirname(fichier));
  m._compile(mute, fichier);
  return m.exports;
}

// ---------------------------------------------------------------------------------------------------
// Des donnees fabriquees : aucun vrai client, aucune vraie adresse.
const ANCIEN_RAPPEL = 'Bonjour {{prenom}},\n\nNous vous attendons demain à {{heure}} chez {{centre}}.\nPensez à arriver 10 minutes avant.\n\nÀ demain !';
const NOUVEAU_RAPPEL = 'Bonjour {{prenom}},\n\nNous vous attendons demain à {{heure}} chez {{centre}}.\nPensez à arriver 15 minutes avant, chaussettes aux pieds.\n\nÀ demain !';
const LONG = ['Bonjour {{prenom}},', '', 'Ça fait un moment que nous ne vous avons pas vu. Les pistes de bowling vous attendent, et le laser game a de nouvelles armes.', '', ...Array.from({ length: 16 }, (_, i) => `Ligne ${i + 1} du mail, avec ce qu’il faut dire aux clients qui ne sont plus venus depuis longtemps.`), '', 'À très vite !'].join('\n');
const SESSION = (sur = {}) => ({ centerId: 'libramont', authorizedCenterId: 'libramont', permissions: [], role: { locked: true, name: 'Direction' }, member: { id: 'm1', name: 'Gérant', contact: 'gerant@centre.test' }, ...sur });
const LECTEURS = {
  catalogue: async () => [{ id: 'anniv', name: 'Anniversaire', priceType: 'per_person', effective: { name: 'Anniversaire', priceValue: 18.5, priceOld: null, enabled: true }, centerOverride: null, base: { priceValue: 18.5 } }],
  campagnes: async () => [{ id: 12, name: 'Retour en semaine', segment: 'dormant', subject: 'On vous attend en semaine', body: 'Bonjour {{prenom}},\nRevenez nous voir en semaine.', storedStatus: 'draft', objective: '' }],
  audience: async () => 291,
  expediteursMails: async () => [{ id: 1, isDefault: true, label: 'Fun Galaxy Libramont', email: 'libramont@centre.test' }],
  sequencesAuto: async () => ({ reglages: { reminder_48h: { subject: 'Votre venue de demain', body: ANCIEN_RAPPEL }, reactivation: { enabled: false } }, defauts: { reminder_48h: { enabled: true, subject: 'Rappel avant votre venue', body: ANCIEN_RAPPEL, offsetRange: [1, 7] }, reactivation: { enabled: false, subject: 'On vous attend', body: 'Bonjour {{prenom}}' } } }),
  sequencesPerso: async () => [{ id: 'seq-1', name: 'Merci du dimanche', trigger: { type: 'after_visit', days: 2 }, segment: '', subject: 'Merci {{prenom}}', body: 'Bonjour {{prenom}},\nMerci pour votre visite chez {{centre}}.', cap: 20, enabled: false }],
  communication: async (centre, numero) => ({
    41: { id: 41, status: 'failed', channel: 'email', recipient: 'paul@exemple.be', subject: 'Votre réservation', body: '<p>Bonjour Paul</p>', payload: { textBody: 'Bonjour Paul,\nVotre réservation est confirmée.' }, last_error: 'Adresse refusée par le serveur du client' },
    42: { id: 42, status: 'sent', channel: 'email', recipient: 'paul@exemple.be', subject: 'Votre réservation', body: '', payload: {}, last_error: '' },
  }[Number(numero)] || null),
};

async function cartesDuRegistre(editions) {
  const G = charger(GESTES, editions);
  const ctx = (messagesPersonne = [], session = SESSION()) => G.contexte({ centre: 'libramont', session, messagesPersonne, lecteurs: LECTEURS });
  const tenter = async (f) => { try { return { carte: await f() }; } catch (e) { return { erreur: e }; } };
  return {
    G,
    ctx,
    tenter,
    brouillon: await G.proposer('campagne_brouillon', { nom: 'Retour des dormants', segment: 'dormant', objet: 'Ça fait un moment, {{prenom}}', texte: LONG }, ctx()),
    modifie: await G.proposer('campagne_brouillon', { campagne: '12', texte: 'Bonjour {{prenom}},\nRevenez nous voir en semaine, le bowling est à moitié prix.' }, ctx()),
    sequence: await G.proposer('sequence_auto_texte', { sequence: 'Rappel avant la venue', texte: NOUVEAU_RAPPEL }, ctx(['Change le texte du rappel'])),
    envoi: await G.proposer('campagne_envoyer', { campagne: '12' }, ctx(['Envoie la campagne'])),
    prix: await G.proposer('prix_formule', { formule: 'Anniversaire', prix: 20 }, ctx(['Passe l’anniversaire à 20 euros'])),
    etat: await G.proposer('sequence_auto_marche', { sequence: 'Réactiver les clients dormants', active: 'oui' }, ctx(['Allume la réactivation'])),
  };
}

async function verifierServeur(editions, ok) {
  const R = await cartesDuRegistre(editions);
  const { G, ctx, tenter } = R;
  const b = R.brouillon.resume.mail || {};
  ok(b.texte === LONG && b.objet === 'Ça fait un moment, {{prenom}}' && b.de === 'Fun Galaxy Libramont <libramont@centre.test>' && b.a === 'Dormants (+90 jours), 291 clients'
    && b.texteAvant === undefined && R.brouillon.resume.lignes.some((l) => l.libelle === 'Pour qui' && /291 clients/.test(l.valeur)),
  '[N] un brouillon de campagne montre le mail entier, de qui et pour combien de clients', JSON.stringify({ a: b.a, de: b.de, long: String(b.texte || '').length }));
  const m = R.modifie.resume.mail || {};
  ok(m.texteAvant === 'Bonjour {{prenom}},\nRevenez nous voir en semaine.' && /moitié prix/.test(m.texte) && m.objetAvant === undefined, '[N] un brouillon modifie garde son ancien texte pour le comparer', JSON.stringify(m));
  const s = R.sequence.resume.mail || {};
  ok(s.texteAvant === ANCIEN_RAPPEL && s.texte === NOUVEAU_RAPPEL && s.a === 'Chaque client, avant sa venue' && s.objet === 'Votre venue de demain', '[N] un texte de sequence change montre l ancien et le nouveau en entier', JSON.stringify(s).slice(0, 300));
  const e = R.envoi.resume.mail || {};
  ok(e.objet === 'On vous attend en semaine' && /Revenez nous voir/.test(e.texte) && /291 clients$/.test(e.a), '[N] l envoi d une campagne montre le mail qui part et a combien de clients', JSON.stringify(e));

  const essai = await tenter(() => G.proposer('essai_mail', { sequence: 'Rappel avant la venue', texte: NOUVEAU_RAPPEL }, ctx(['Envoie-moi un essai'])));
  const refaitEssai = essai.carte ? await G.refaire('essai_mail', essai.carte.action.params, ctx()) : {};
  ok(essai.carte && essai.carte.risque === false && essai.carte.resume.mail.a === 'gerant@centre.test' && /^\[TEST\] /.test(essai.carte.resume.mail.objet) && essai.carte.resume.mail.texteAvant === ANCIEN_RAPPEL
    && refaitEssai.action === 'sendAutomationTest' && refaitEssai.corps.key === 'reminder_48h' && refaitEssai.corps.body === NOUVEAU_RAPPEL && refaitEssai.corps.subject === undefined,
  '[N] l essai part a l adresse de la personne, avec le texte essaye, sans rien enregistrer', JSON.stringify({ carte: essai.carte && essai.carte.resume, erreur: essai.erreur && essai.erreur.message, refaitEssai }).slice(0, 400));
  const sansAdresse = await tenter(() => G.proposer('essai_mail', { sequence: 'Rappel avant la venue' }, ctx([], SESSION({ member: { id: 'm2', name: 'Accueil', contact: '0470 00 00 00' } }))));
  ok(Boolean(sansAdresse.erreur) && /adresse mail/.test(sansAdresse.erreur.message), '[N] sans adresse sur le compte, l essai se refuse', sansAdresse.erreur ? sansAdresse.erreur.message : 'carte rendue');
  const essaiPerso = await tenter(() => G.proposer('essai_mail', { sequence: 'Merci du dimanche' }, ctx()));
  const refaitPerso = essaiPerso.carte ? await G.refaire('essai_mail', essaiPerso.carte.action.params, ctx()) : {};
  ok(refaitPerso.action === 'sendCustomSequenceTest' && refaitPerso.corps.sequence && refaitPerso.corps.sequence.id === 'seq-1' && refaitPerso.corps.sequence.subject === 'Merci {{prenom}}', '[N] l essai d une sequence du centre passe par son test a elle', JSON.stringify(refaitPerso).slice(0, 300));

  const renvoi = await tenter(() => G.proposer('mail_renvoyer', { message: 41 }, ctx(['Renvoie le mail de Paul'])));
  const refaitRenvoi = renvoi.carte ? await G.refaire('mail_renvoyer', renvoi.carte.action.params, ctx()) : {};
  ok(renvoi.carte && renvoi.carte.risque === true && renvoi.carte.resume.mail.texte === 'Bonjour Paul,\nVotre réservation est confirmée.' && renvoi.carte.resume.mail.a === 'paul@exemple.be'
    && refaitRenvoi.action === 'retryCommunication' && JSON.stringify(refaitRenvoi.corps) === '{"id":41}', '[N] un mail echoue se renvoie tel qu il etait, a son destinataire', JSON.stringify({ r: renvoi.carte && renvoi.carte.resume, e: renvoi.erreur && renvoi.erreur.message, refaitRenvoi }).slice(0, 400));
  const sansMots = await tenter(() => G.proposer('mail_renvoyer', { message: 41 }, ctx(['Bonjour, quoi de neuf ?'])));
  ok(Boolean(sansMots.erreur) && sansMots.erreur.statusCode === 403, '[N] un mail ne se renvoie que si la personne l a demande', sansMots.erreur ? sansMots.erreur.message : 'carte rendue');
  const parti = await tenter(() => G.proposer('mail_renvoyer', { message: 42 }, ctx(['Renvoie le mail'])));
  const ailleurs = await tenter(() => G.proposer('mail_renvoyer', { message: 43 }, ctx(['Renvoie le mail'])));
  ok(Boolean(parti.erreur) && /n’a pas échoué/.test(parti.erreur.message) && Boolean(ailleurs.erreur) && ailleurs.erreur.statusCode === 404, '[N] seul un mail echoue de ce centre se renvoie', JSON.stringify({ parti: parti.erreur && parti.erreur.message, ailleurs: ailleurs.erreur && ailleurs.erreur.message }));

  const M = charger(MEM, editions);
  const carte = { ...R.prix, etat: 'fait', faitA: 1763031000000, texte: R.prix.texte };
  const enCours = { ...R.sequence, etat: 'cours' };
  const garde = M.conversationValide({ id: 'conv-cartes-1', titre: 'Prix', messages: [{ role: 'user', texte: 'Passe l’anniversaire à 20 euros' }, { role: 'assistant', id: 'a1', texte: 'Voici.', propositions: [carte, enCours, { texte: 'Le KFD est complet le mercredi', etat: '', id: 0 }] }] });
  const [p0, p1, p2] = garde.messages[1].propositions;
  ok(p0 && p0.type === 'geste' && p0.etat === 'fait' && p0.faitA === 1763031000000 && p0.resume.lignes.some((l) => l.avant === '18,50 €' && l.apres === '20 €') && p0.action.geste === 'prix_formule' && p0.vue.domaine === 'Prix'
    && p1 && p1.type === 'geste' && p1.etat === '' && p1.resume.mail.texteAvant === ANCIEN_RAPPEL && p2 && p2.type === undefined && p2.texte === 'Le KFD est complet le mercredi',
  '[N] le serveur garde la carte d un geste entiere', JSON.stringify(garde.messages[1].propositions).slice(0, 400));
  const enorme = M.conversationValide({ id: 'conv-cartes-2', titre: 'X', messages: [{ role: 'user', texte: 'x' }, { role: 'assistant', id: 'a2', texte: 'y', propositions: [{ ...R.prix, resume: { lignes: [{ libelle: 'Texte', valeur: 'x'.repeat(70000) }] } }] }] });
  ok(JSON.stringify(enorme.messages[1].propositions[0].resume) === '{}', '[N] une carte demesuree se garde sans son contenu', JSON.stringify(enorme.messages[1].propositions[0]).slice(0, 200));
  return R;
}

// ---------------------------------------------------------------------------------------------------
// [U] la vraie page Marketing, son assistant joue par une reponse fabriquee, ses cartes sorties du vrai registre.
const sse = (evenements) => evenements.map(([type, donnees]) => `event: ${type}\ndata: ${JSON.stringify(donnees)}\n\n`).join('');
const reponse = (texte, cartes) => sse([['debut', { modele: 'Haiku 5.5', centres: [], sources: [] }], ['texte', { delta: texte }], ...cartes.map((c) => ['proposition', c]), ['fin', { texte, verite: { sourcesCitees: [], sourcesInconnues: [], chiffres: 0, chiffresSansSource: [] }, identites: {}, modele: 'claude-haiku-5-5' }]]);

async function verifierPage(editions, ok, R) {
  const { chromium } = require('playwright-core');
  const FX = require('./planning-v3-fixtures');
  const M = require(path.join(ROOT, MEM));
  const mute = sourceMutee(ECRAN, editions);
  const serveur = await FX.servir({ port: PORT, transformer: mute === null ? null : (rel, texte) => (rel === ECRAN ? mute : texte) });
  const browser = await chromium.launch({ executablePath: NAVIGATEUR, headless: true });
  const stockees = new Map();
  const scenarios = [];
  const gestes = [];
  const FAITS = [{ id: 1, texte: 'Le KFD est complet le mercredi', par: 'Gérant', le: Date.parse('2026-11-12T10:00:00Z'), origine: 'panneau' }, { id: 2, texte: 'Le patron c’est Marc et son associé Paul', par: 'Propriétaire plateforme', le: Date.parse('2026-11-13T01:02:00Z'), origine: 'panneau', centre: 'Fun Galaxy Gembloux', centreId: 'gembloux' }];
  const brancher = async (page) => {
    await page.route('**/api/assistant', async (route) => {
      const corps = JSON.parse(route.request().postData() || '{}');
      const json = (x) => route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(x) });
      if (corps.action === 'conversations') return json({ ok: true, stockage: 'serveur', conversations: [...stockees.values()].map((c) => ({ id: c.id, titre: c.titre, centerId: 'libramont', modele: c.modele, messages: c.messages.length, maj: Date.now() })) });
      if (corps.action === 'conversation') { const c = stockees.get(corps.id); return c ? json({ ok: true, conversation: { id: c.id, titre: c.titre, centerId: 'libramont', modele: c.modele, messages: c.messages } }) : route.fulfill({ status: 404, contentType: 'application/json', body: '{"ok":false}' }); }
      // Le vrai tri du serveur (lib/assistant-memoire.js) : ce qui revient est ce que la base garderait.
      if (corps.action === 'sauver') { const c = M.conversationValide(corps.conversation); stockees.set(c.id, c); return json({ ok: true, conversation: { id: c.id } }); }
      if (corps.action === 'savoir') return json({ ok: true, disponible: true, faits: FAITS });
      if (corps.action) return json({ ok: true });
      return route.fulfill({ status: 200, contentType: 'text/event-stream; charset=utf-8', body: scenarios.shift() || reponse('Rien.', []) });
    });
  };
  const monter = async (appareil = 'ordinateur') => {
    const m = await FX.monter(browser, { fixture: 'normal', appareil, theme: 'light', port: PORT, heure: '15:10', avantChargement: brancher });
    await m.page.evaluate(() => { location.hash = '#/staff/campaigns'; });
    await m.page.waitForSelector('[data-ast-champ]', { timeout: 20000 });
    // La fixture repond elle-meme a /api/ops dans la page : le geste se lit la, au moment ou il part.
    await m.page.evaluate(() => {
      const avant = window.fetch;
      window.__gestes = [];
      window.fetch = function (input, init) {
        try {
          const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
          const corps = u.pathname === '/api/ops' && init && typeof init.body === 'string' ? JSON.parse(init.body) : null;
          if (corps && corps.action === 'assistantGeste') window.__gestes.push(corps);
        } catch (e) { /* un corps qui n est pas du JSON n est pas un geste */ }
        return avant.apply(this, arguments);
      };
    });
    await FX.repos(m.page, 400);
    return m;
  };
  // Un bouton qu une regle cassee a fait disparaitre ne fait pas planter le banc : c est le controle qui rougit.
  const cliquer = async (loc) => { if (await loc.count()) await loc.click({ timeout: 4000 }).catch(() => {}); };
  const poser = async (page, q, n) => {
    await page.locator('[data-ast-champ]').fill(q);
    await page.locator('[data-ast-champ]').press('Enter');
    await page.waitForFunction((x) => document.querySelectorAll('.ast-pied').length >= x, n, { timeout: 15000 });
    await FX.repos(page, 250);
  };
  try {
    const { ctx, page, erreurs } = await monter();
    scenarios.push(reponse('Voici les trois changements.', [R.sequence, R.prix, R.etat]));
    await poser(page, 'Change le rappel, passe l’anniversaire à 20 euros et allume la réactivation', 1);

    const tete = await page.evaluate(() => [...document.querySelectorAll('.ast-carte')].map((c) => ({ type: (c.querySelector('.ast-carte-type') || {}).textContent || '', titre: (c.querySelector('.ast-carte-titre') || {}).textContent || '', icone: Boolean(c.querySelector('.ast-carte-icone svg')) })));
    ok(tete.length === 3 && tete[0].titre === 'Changer « Rappel avant la venue ».' && tete[1].titre === 'Passer « Anniversaire » à 20 € par personne.' && tete[0].type === 'Texte d’une séquence automatique' && tete.every((t) => t.icone),
      '[U] la carte dit en tete ce qui va se passer', JSON.stringify(tete));

    const prix = await page.evaluate(() => {
      const c = document.querySelectorAll('.ast-carte')[1];
      const l = c && c.querySelector('.ast-carte-ligne.est-change');
      const t = (sel) => (l && l.querySelector(sel) ? getComputedStyle(l.querySelector(sel)) : null);
      return l ? { avant: l.querySelector('.ast-avant').textContent, apres: l.querySelector('.ast-apres').textContent, barre: t('.ast-avant').textDecorationLine, tailleAvant: parseFloat(t('.ast-avant').fontSize), tailleApres: parseFloat(t('.ast-apres').fontSize), fond: getComputedStyle(l).backgroundColor, formuleRepetee: [...c.querySelectorAll('.ast-carte-ligne')].some((x) => /^Formule/.test(x.textContent.trim())), clients: (c.querySelector('.ast-carte-clients') || {}).textContent || '', icone: Boolean(c.querySelector('.ast-carte-clients svg')) } : null;
    });
    ok(Boolean(prix) && prix.avant === '18,50 €' && prix.apres === '20 €' && /line-through/.test(prix.barre) && prix.tailleApres >= prix.tailleAvant + 2 && !/rgba\(0, 0, 0, 0\)/.test(prix.fond) && !prix.formuleRepetee && /formulaire en ligne/.test(prix.clients) && prix.icone,
      '[U] ce qui change se lit en grand, l ancien barre a cote', JSON.stringify(prix));

    const etat = await page.evaluate(() => {
      const l = document.querySelectorAll('.ast-carte')[2] && document.querySelectorAll('.ast-carte')[2].querySelector('.ast-carte-ligne.est-change.est-etat');
      if (!l) return null;
      const a = l.querySelector('.ast-avant');
      const b = l.querySelector('.ast-apres');
      return { avant: a.textContent, apres: b.textContent, etatAvant: a.dataset.etat, etatApres: b.dataset.etat, pastille: getComputedStyle(b).borderRadius, point: getComputedStyle(b, '::before').backgroundColor, pointAvant: getComputedStyle(a, '::before').backgroundColor, barre: getComputedStyle(a).textDecorationLine };
    });
    ok(Boolean(etat) && etat.avant === 'coupée' && etat.apres === 'allumée' && etat.etatAvant === 'off' && etat.etatApres === 'on' && parseFloat(etat.pastille) >= 10 && etat.point !== etat.pointAvant && !/line-through/.test(etat.barre),
      '[U] un etat se lit en pastilles, coupee puis allumee', JSON.stringify(etat));

    const mail = await page.evaluate(() => {
      const c = document.querySelectorAll('.ast-carte')[0];
      const x = c && c.querySelector('.ast-mail');
      if (!x) return null;
      return {
        qui: [...x.querySelectorAll('.ast-mail-qui p')].map((p) => p.textContent.replace(/\s+/g, ' ').trim()).join(' '), lettre: x.querySelector('.ast-mail-avatar').textContent, objet: x.querySelector('.ast-mail-objet').textContent,
        texte: x.querySelector('.ast-mail-texte').textContent, variables: [...x.querySelectorAll('.ast-mail-texte .ast-var')].map((v) => v.textContent), accolades: /\{\{/.test(x.textContent),
        ins: [...x.querySelectorAll('ins.ast-ins')].map((v) => v.textContent).join(' | '), del: [...x.querySelectorAll('del.ast-del')].map((v) => v.textContent).join(' | '),
        lignesMail: [...c.querySelectorAll('.ast-carte-ligne')].filter((l) => /^(Objet|Texte)/.test(l.textContent.trim())).length,
        vues: [...x.querySelectorAll('[data-ast-mail-vue]')].map((b) => `${b.textContent}:${b.getAttribute('aria-pressed')}`).join(','),
      };
    });
    ok(Boolean(mail) && mail.qui === 'Fun Galaxy Libramont <libramont@centre.test> à Chaque client, avant sa venue' && mail.lettre === 'F' && mail.objet === 'Votre venue de demain' && mail.lignesMail === 0 && /chaussettes aux pieds/.test(mail.texte),
      '[U] le mail se lit comme dans Gmail, de qui, pour qui, objet et texte entiers', JSON.stringify(mail));
    ok(Boolean(mail) && !mail.accolades && JSON.stringify(mail.variables) === JSON.stringify(['prénom', 'heure', 'nom du centre']), '[U] une variable se lit en etiquette, jamais en accolades', JSON.stringify(mail && mail.variables));
    ok(Boolean(mail) && /15/.test(mail.ins) && /chaussettes/.test(mail.ins) && /10/.test(mail.del) && !/Bonjour/.test(mail.ins + mail.del), '[U] ce qui change dans le texte est marque, l ajoute surligne, le retire barre', JSON.stringify({ ins: mail && mail.ins, del: mail && mail.del }));
    // « avant. » devient « avant, chaussettes aux pieds. » : le mot barre ne garde pas son retour a la ligne,
    // sinon l apercu montre un paragraphe que le mail n a pas.
    ok(Boolean(mail) && (mail.texte.match(/\n\n/g) || []).length === (NOUVEAU_RAPPEL.match(/\n\n/g) || []).length && /avant\. avant, chaussettes/.test(mail.texte),
      '[U] un mot remplace en fin de phrase ne cree pas de paragraphe', JSON.stringify(mail && mail.texte));
    await cliquer(page.locator('.ast-carte').first().locator('[data-ast-mail-vue][data-vue="propre"]'));
    await FX.repos(page, 150);
    const propre = await page.evaluate(() => { const x = document.querySelector('.ast-carte .ast-mail'); return x ? { marques: x.querySelectorAll('ins, del').length, vues: [...x.querySelectorAll('[data-ast-mail-vue]')].map((b) => b.getAttribute('aria-pressed')).join(','), dix: /10 minutes/.test(x.querySelector('.ast-mail-texte').textContent) } : null; });
    ok(Boolean(mail) && Boolean(propre) && mail.vues === 'Ce qui change:true,Tel qu’il partira:false' && propre.marques === 0 && propre.vues === 'false,true' && !propre.dix, '[U] les deux vues du mail se choisissent', JSON.stringify({ avant: mail && mail.vues, propre }));

    // Le prix se publie : deux clics, puis la carte faite garde la valeur et l heure.
    await page.locator('[data-ast-prop="1"] [data-ast-geste-oui]').click();
    await FX.repos(page, 150);
    await page.locator('[data-ast-prop="1"] [data-ast-confirme="1"]').click();
    await page.waitForFunction(() => document.querySelector('[data-ast-prop="1"].est-faite'), null, { timeout: 6000 }).catch(() => {});
    gestes.push(...await page.evaluate(() => window.__gestes || []));
    const faite = await page.evaluate(() => {
      const c = document.querySelector('[data-ast-prop="1"].est-faite');
      return c ? { dit: (c.querySelector('.ast-carte-fait') || {}).textContent || '', quand: (c.querySelector('.ast-carte-quand') || {}).textContent || '', apres: (c.querySelector('.ast-carte-changes.est-fige .ast-apres') || {}).textContent || '', avant: (c.querySelector('.ast-avant-dit') || {}).textContent || '' } : null;
    });
    ok(Boolean(faite) && faite.dit === '« Anniversaire » est maintenant à 20 €.' && faite.apres === '20 €' && faite.avant === 'au lieu de 18,50 €' && gestes.length === 1 && gestes[0].geste === 'prix_formule',
      '[U] faite, la carte garde la nouvelle valeur et l ancienne', JSON.stringify({ faite, gestes }));
    ok(Boolean(faite) && faite.quand === 'Fait à 15:10', '[U] faite, la carte dit l heure ou c est fait', JSON.stringify(faite));

    // Un long brouillon : le mail se replie, un clic le deplie.
    scenarios.push(reponse('Voici le brouillon.', [R.brouillon]));
    await poser(page, 'Écris une campagne pour les dormants', 2);
    const lireLong = () => page.evaluate(() => { const x = [...document.querySelectorAll('.ast-mail')].pop(); return x ? { replie: x.classList.contains('est-replie'), haut: x.querySelector('.ast-mail-texte').getBoundingClientRect().height, bouton: (x.querySelector('[data-ast-mail-suite]') || {}).textContent || '', qui: x.querySelector('.ast-mail-qui').textContent, fin: /À très vite/.test(x.querySelector('.ast-mail-texte').textContent) } : null; });
    const replie = await lireLong();
    await cliquer(page.locator('[data-ast-mail-suite]').last());
    await FX.repos(page, 150);
    const deplie = await lireLong();
    ok(Boolean(replie && deplie) && replie.replie && /Lire le mail en entier/.test(replie.bouton) && /291 clients/.test(replie.qui) && !deplie.replie && deplie.haut > replie.haut + 100 && /Replier/.test(deplie.bouton) && deplie.fin,
      '[U] un long mail se replie et se lit en entier d un clic', JSON.stringify({ replie, deplie }));

    // Au telephone, rien ne deborde.
    await page.setViewportSize({ width: 390, height: 844 });
    await FX.repos(page, 300);
    const deborde = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - document.documentElement.clientWidth, cartes: [...document.querySelectorAll('.ast-carte, .ast-mail')].map((c) => c.scrollWidth - c.clientWidth).filter((d) => d > 1).length }));
    ok(deborde.page <= 1 && deborde.cartes === 0, '[U] au telephone, ni la carte ni le mail ne debordent', JSON.stringify(deborde));
    await page.setViewportSize({ width: 1280, height: 900 });

    // Le panneau du savoir : un fait de Gembloux se dit avec son centre et ne se change pas d ici.
    await page.evaluate(() => document.querySelector('[data-ast-savoir]').click());
    await page.waitForSelector('[data-ast-fait-ligne="2"]', { timeout: 5000 }).catch(() => {});
    const panneau = await page.evaluate(() => {
      const ailleurs = document.querySelector('[data-ast-fait-ligne="2"]');
      const ici = document.querySelector('[data-ast-fait-ligne="1"]');
      return { ailleurs: ailleurs ? ailleurs.textContent.replace(/\s+/g, ' ').trim() : '', ailleursModifiable: Boolean(ailleurs && ailleurs.querySelector('[data-ast-fait-modifier], [data-ast-fait-retirer]')), iciModifiable: Boolean(ici && ici.querySelector('[data-ast-fait-modifier]')) };
    });
    ok(/Appris à Fun Galaxy Gembloux/.test(panneau.ailleurs) && !panneau.ailleursModifiable && panneau.iciModifiable, '[U] le panneau dit le centre d un fait appris ailleurs, sans le changer d ici', JSON.stringify(panneau));
    ok(erreurs.length === 0, '[U] la page ne leve aucune erreur JavaScript', erreurs.slice(0, 3).join(' | '));
    await ctx.close();

    // Rouverte depuis le serveur, sur un autre appareil : les cartes restent des cartes de geste.
    const ids = [...stockees.keys()];
    const autre = await monter();
    await autre.page.waitForFunction((id) => Boolean(document.querySelector(`[data-ast-conv="${id}"]`)), ids[0], { timeout: 8000 }).catch(() => {});
    await autre.page.evaluate((id) => { const b = document.querySelector(`[data-ast-conv="${id}"]`); if (b) b.click(); }, ids[0]);
    await autre.page.waitForFunction(() => document.querySelectorAll('.ast-carte').length >= 3, null, { timeout: 8000 }).catch(() => {});
    const rouverte = await autre.page.evaluate(() => ({ cartes: document.querySelectorAll('.ast-carte').length, faite: ((document.querySelector('.ast-carte.est-faite .ast-carte-fait') || {}).textContent || '').replace(/\s+/g, ' ').trim(), quand: (document.querySelector('.ast-carte.est-faite .ast-carte-quand') || {}).textContent || '', aRetenir: document.querySelectorAll('.ast-prop').length, mail: document.querySelectorAll('.ast-carte .ast-mail').length }));
    ok(ids.length === 1 && rouverte.cartes >= 4 && rouverte.aRetenir === 0 && rouverte.faite === '« Anniversaire » est maintenant à 20 €.' && rouverte.quand === 'Fait à 15:10' && rouverte.mail >= 1,
      '[U] rouverte depuis le serveur, la carte reste une carte de geste, jamais un fait a retenir', JSON.stringify({ ids: ids.length, rouverte }));
    ok(autre.erreurs.length === 0, '[U] la conversation rouverte ne leve aucune erreur JavaScript', autre.erreurs.slice(0, 3).join(' | '));
    await autre.ctx.close();
  } finally {
    await browser.close().catch(() => {});
    await new Promise((r) => serveur.close(r));
  }
}

async function verifier(editions = []) {
  const echecs = [];
  const ok = (cond, nom, detail = '') => {
    if (!cond) echecs.push(nom);
    if (!editions.length) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${nom}${cond || !detail ? '' : `  ${String(detail).slice(0, 700)}`}`);
  };
  const touche = (rel) => !editions.length || editions.some((e) => e.fichier === rel);
  const R = await verifierServeur(editions.filter((e) => e.fichier !== ECRAN), ok);
  if (touche(ECRAN) || !editions.length) await verifierPage(editions, ok, R);
  return echecs;
}

(async () => {
  if (process.argv.includes('--contre-preuves')) {
    const seul = (process.argv.find((a) => a.startsWith('--seul=')) || '').slice(7).split(',').filter(Boolean);
    const jouees = seul.length ? MUTATIONS.filter((m) => seul.includes(m.nom)) : MUTATIONS;
    let mordent = 0;
    for (const m of jouees) {
      // eslint-disable-next-line no-await-in-loop
      const echecs = await verifier(m.editions).catch((e) => [`exception ${e.message}`]);
      const mord = echecs.includes(m.rouge);
      if (mord) mordent += 1;
      console.log(`${mord ? 'ok  ' : 'FAIL'}  contre-preuve ${m.nom} : rougit « ${m.rouge} »${mord ? '' : `  (rouges : ${echecs.join(' | ') || 'aucun'})`}`);
    }
    console.log(`\nassistant-cartes --contre-preuves: ${mordent}/${jouees.length} mordent`);
    process.exit(jouees.length && mordent === jouees.length ? 0 : 1);
  }
  const echecs = await verifier([]);
  if (echecs.length) { console.error(`\nassistant-cartes-check: ${echecs.length} FAIL`); process.exit(1); }
  console.log('\nassistant-cartes-check: ALL OK (le mail entier et son public, l essai a soi, le renvoi d un mail echoue, la carte gardee entiere, la phrase en tete, l ancien et le nouveau, les pastilles, le mail comme Gmail, la carte faite et son heure, la carte rouverte, le savoir d un autre centre, le telephone)');
})().catch((e) => { console.error('ERREUR', e && e.stack ? e.stack.slice(0, 1500) : e); process.exit(1); });
