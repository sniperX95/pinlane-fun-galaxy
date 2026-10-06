// LA CONFIRMATION PART DANS LA REQUETE, ET LA FILE NE SE BOUCHE PLUS.
//
// POURQUOI CE GATE EXISTE (2026-09-05, veille d ouverture Fun Galaxy). Lu dans
// la base de production : AUCUNE confirmation de reservation n etait partie
// depuis des jours. Deux causes, chacune suffisante :
//
//   1. Le worker Railway n existe plus (deploiements REMOVED depuis le 23
//      juillet). Seul le cron Vercel dispatche, toutes les trois heures. La
//      reservation publique ENFILAIT sa confirmation et attendait ce passage,
//      alors que l ecran de fin promet « le mail arrive dans quelques minutes ».
//
//   2. La fournee du cron (50 lignes) etait remplie de 159 lignes du jeu de
//      demonstration (adresses en @demo.fungalaxy.test) : une adresse reservee
//      (RFC 2606) etait bien refusee, mais REMISE EN FILE avec un nouveau
//      nextRetryAt, donc rejouee a chaque passage, pour toujours. Les sept
//      vraies lignes n atteignaient jamais leur tour.
//
// LES QUATRE PROPRIETES :
//
//   [A] UNE ADRESSE RESERVEE EST ANNULEE, PAS REJOUEE. Apres un passage du
//       dispatcher, la ligne porte le statut `cancelled`, aucun appel reseau
//       n a eu lieu, et elle ne reviendra plus dans une fournee.
//
//   [B] UNE ADRESSE ROUTABLE PART VRAIMENT. Meme passage : un appel reseau
//       exactement, au bon destinataire, depuis l expediteur configure, et la
//       ligne passe en `sent` avec l identifiant du fournisseur.
//
//   [E] LA REPONSE DU CLIENT ARRIVE CHEZ SON CENTRE. Le pied de page promet
//       « repondez simplement a ce message, il arrive directement chez nous ».
//       L en-tete reply_to porte donc l adresse PUBLIQUE du centre (celle du
//       site et du mail), pas l adresse d ENVOI : rien ne garantit qu une boite
//       existe derriere celle-ci, et un client de Gembloux n ecrit pas a
//       Libramont. Un centre qui n en declare pas retombe sur les replis
//       d avant, sans empecher l envoi.
//
//   [G] UNE ADRESSE DE RETOUR PAR CENTRE RAMENE LA CONVERSATION DANS PINLANE.
//       Reglage CENTER_REPLY_TO : quand un centre declare une adresse de
//       reception, c est elle qui porte les reponses, donc le fil revient dans
//       l outil. Non declaree, on garde l adresse publique du centre : la
//       reponse arrive dans SA boite, comme avant. Un centre ne prend jamais le
//       reglage d un autre, et un reglage illisible ne casse aucun envoi.
//
//   [C] CREER UN DOSSIER DECLENCHE L ENVOI DE SES LIGNES DUES. Le hook de
//       creation appelle le dispatcher pour CE dossier (reservationId), une
//       fois, et un echec du dispatcher ne fait pas echouer la creation : il
//       remonte en avertissement.
//
//   [H] UNE REPONSE A UN MAIL RECU PART AVEC SES EN-TETES DE FIL (2026-09-16).
//       Le payload d une reponse porte inReplyTo et references (poses par
//       sendDirectEmail) : l appel au fournisseur les transmet en en-tetes
//       In-Reply-To et References, c est ce qui range notre reponse dans la
//       conversation du client. Sans eux, aucun bloc headers n est envoye.
//
// CONTRE-EPREUVES PAR MUTATION, compilees en memoire (crochet sur
// Module.prototype._compile, disque jamais touche) : sans la regle d annulation,
// [A] retombe en `queued` ; sans l appel du hook, [C] ne voit aucun dispatch ;
// sans l adresse du centre, [E] repart vers l adresse d envoi.
//
// Usage : node scripts/dispatch-immediate-check.js
'use strict';
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// LE MONDE SIMULE : la base est une liste en memoire, le reseau une sonde.
// Les stubs sont poses AVANT tout require applicatif : ops-communications lie
// ses fonctions de base par destructuration au chargement.
// ---------------------------------------------------------------------------
process.env.RESEND_API_KEY = 'gate-fake-key';
process.env.RESEND_FROM = 'contact@pinlane.be';
delete process.env.RESEND_REPLY_TO;

const ROWS = [];
const database = require(path.join(ROOT, 'lib/database'));
database.listDueCommunications = async ({ limit = 25, centerId = '', reservationId = null } = {}) => ROWS
  .filter((r) => r.status === 'queued')
  .filter((r) => !centerId || r.centerId === centerId)
  .filter((r) => !reservationId || Number(r.reservationId) === Number(reservationId))
  .slice(0, limit)
  .map((r) => ({ ...r }));
database.updateCommunicationStatus = async (id, patch = {}) => {
  const row = ROWS.find((r) => r.id === id);
  if (!row) throw new Error(`ligne ${id} inconnue`);
  if (patch.status) row.status = patch.status;
  if (patch.lastError !== undefined) row.lastError = patch.lastError;
  if (patch.incrementAttempts) row.attempts = Number(row.attempts || 0) + Number(patch.incrementAttempts);
  if (patch.nextRetryAt !== undefined) row.nextRetryAt = patch.nextRetryAt;
  if (patch.providerMessageId !== undefined) row.providerMessageId = patch.providerMessageId;
  return { ...row };
};
database.createOpsEvent = async () => ({});

const APPELS = [];
global.fetch = async (url, options = {}) => {
  let corps = null;
  try { corps = JSON.parse(options.body || '{}'); } catch (error) { corps = null; }
  APPELS.push({ url: String(url), corps });
  return { ok: true, status: 200, json: async () => ({ id: `msg_${APPELS.length}` }), text: async () => '' };
};

function mock(rel, exports) {
  const resolu = require.resolve(path.join(ROOT, rel));
  require.cache[resolu] = { id: resolu, filename: resolu, loaded: true, exports };
}

// ---------------------------------------------------------------------------
// LES MODULES MUTABLES (meme motif que complements-truth-check).
// ---------------------------------------------------------------------------
const MUTABLES = ['lib/ops-communications.js', 'lib/reservation-ops.js'];
let mutations = [];
const compileOrigine = Module.prototype._compile;
Module.prototype._compile = function (contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const editions = mutations.filter((e) => e.fichier === rel);
  if (!editions.length) return compileOrigine.call(this, contenu, nom);
  let mute = contenu.split(CRLF).join(LF);
  for (const { de, vers } of editions) {
    if (mute.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 70)}`);
    mute = mute.split(de).join(vers);
  }
  return compileOrigine.call(this, mute, nom);
};
function purger() {
  for (const rel of MUTABLES) delete require.cache[require.resolve(path.join(ROOT, rel))];
}

function ligne(id, extra = {}) {
  return {
    id, centerId: 'libramont', reservationId: null, channel: 'email', direction: 'outbound',
    templateId: 'confirmation', recipient: 'client@fungalaxy.be', subject: 'Votre reservation',
    body: '<p>Bonjour</p>', status: 'queued', attempts: 0, maxAttempts: 3, lastError: '',
    nextRetryAt: null, providerMessageId: null, payload: { textBody: 'Bonjour' }, ...extra,
  };
}

// [E] : une ligne par centre, dispatchee, et l en-tete reply_to capture. Le
// payload porte l identite d expediteur exactement comme en production
// (email_identities), donc le repli d avant est bien celui que la mutation
// revelera.
async function passageReplyTo(centerId) {
  purger();
  const comms = require(path.join(ROOT, 'lib/ops-communications'));
  ROWS.length = 0;
  APPELS.length = 0;
  ROWS.push(ligne(10, {
    centerId,
    recipient: 'cliente@exemple.be',
    payload: { textBody: 'Bonjour', fromEmail: 'contact@pinlane.be', fromLabel: 'Fun Galaxy' },
  }));
  await comms.dispatchDueCommunications({ limit: 5 });
  return { corps: (APPELS[0] || {}).corps || null, ligne: ROWS[0] };
}

// [A] et [B] : un passage du dispatcher reel sur deux lignes dues.
async function passageDispatcher() {
  purger();
  const comms = require(path.join(ROOT, 'lib/ops-communications'));
  ROWS.length = 0;
  APPELS.length = 0;
  ROWS.push(ligne(1, { recipient: 'lucas.dubois.1@demo.fungalaxy.test' }));
  ROWS.push(ligne(2, { recipient: 'client@fungalaxy.be' }));
  const resultat = await comms.dispatchDueCommunications({ limit: 50 });
  return { resultat, reservee: ROWS[0], routable: ROWS[1], appels: APPELS.slice() };
}

// [C] : le hook de creation, avec le dispatcher remplace par un espion.
async function passageHook({ dispatcherCasse = false } = {}) {
  purger();
  const reel = require(path.join(ROOT, 'lib/ops-communications'));
  const espion = { appels: [] };
  mock('lib/ops-communications.js', {
    ...reel,
    enqueueReservationCommunications: async () => [{ id: 77 }],
    dispatchDueCommunications: async (args) => {
      espion.appels.push(args);
      if (dispatcherCasse) throw new Error('dispatcher en panne');
      return { ok: true, checked: 1, results: [] };
    },
  });
  mock('lib/ops-jobs.js', { enqueueReservationAutomation: async () => [] });
  delete require.cache[require.resolve(path.join(ROOT, 'lib/reservation-ops.js'))];
  const rops = require(path.join(ROOT, 'lib/reservation-ops'));
  const dossier = { id: 4242, centerId: 'gembloux', formuleId: 'f5', totalDuration: 2, channel: 'public', validationStatus: 'confirmed' };
  const retour = await rops.afterReservationCreated(dossier, {});
  // Les mocks de modules ne survivent pas au scenario suivant.
  delete require.cache[require.resolve(path.join(ROOT, 'lib/ops-communications.js'))];
  delete require.cache[require.resolve(path.join(ROOT, 'lib/ops-jobs.js'))];
  return { espion, retour };
}

(async () => {
  // =====================================================================
  console.log('[A] une adresse reservee est annulee, pas rejouee');
  // =====================================================================
  const p = await passageDispatcher();
  ok(p.resultat && p.resultat.checked === 2, 'montage : le dispatcher a vu les deux lignes dues', `${p.resultat && p.resultat.checked}`);
  ok(p.reservee.status === 'cancelled', 'la ligne vers @demo.fungalaxy.test passe en cancelled', `statut ${p.reservee.status}`);
  ok(!p.appels.some((a) => a.corps && /fungalaxy\.test/.test(String(a.corps.to))), 'aucun appel reseau vers l adresse reservee');
  ok(p.reservee.nextRetryAt === null, 'aucune nouvelle tentative planifiee pour elle', `${p.reservee.nextRetryAt}`);
  const second = await require(path.join(ROOT, 'lib/ops-communications')).dispatchDueCommunications({ limit: 50 });
  ok(second.checked === 0, 'au passage suivant, plus rien n est du : la file est vide', `${second.checked}`);

  // =====================================================================
  console.log('\n[B] une adresse routable part vraiment');
  // =====================================================================
  const versClient = p.appels.filter((a) => a.corps && a.corps.to === 'client@fungalaxy.be');
  ok(versClient.length === 1, 'exactement un appel reseau vers le client', `${versClient.length}`);
  ok(versClient[0] && /contact@pinlane\.be/.test(String(versClient[0].corps.from)) && /</.test(String(versClient[0].corps.from)),
    'l expediteur est contact@pinlane.be avec un nom affiche', versClient[0] ? String(versClient[0].corps.from) : '');
  ok(p.routable.status === 'sent' && p.routable.providerMessageId === 'msg_1', 'la ligne passe en sent avec l identifiant du fournisseur', `${p.routable.status} ${p.routable.providerMessageId}`);

  // =====================================================================
  console.log('\n[C] creer un dossier declenche l envoi de ses lignes dues');
  // =====================================================================
  const h = await passageHook();
  ok(h.espion.appels.length === 1, 'le hook appelle le dispatcher exactement une fois', `${h.espion.appels.length}`);
  const a0 = h.espion.appels[0] || {};
  ok(Number(a0.reservationId) === 4242 && a0.centerId === 'gembloux', 'le dispatch est limite a CE dossier et a SON centre', JSON.stringify(a0));
  ok(Array.isArray(h.retour.warnings) && !h.retour.warnings.some((w) => String(w).startsWith('dispatch:')), 'aucun avertissement quand tout va bien');
  const hc = await passageHook({ dispatcherCasse: true });
  ok(hc.retour && Array.isArray(hc.retour.warnings) && hc.retour.warnings.some((w) => String(w).startsWith('dispatch:')),
    'un dispatcher en panne ne fait pas echouer la creation : avertissement remonte', JSON.stringify(hc.retour && hc.retour.warnings));

  // =====================================================================
  console.log('\n[E] la reponse du client arrive chez SON centre');
  // =====================================================================
  const { getCenter } = require(path.join(ROOT, 'lib/ops-knowledge'));
  const adressePublique = (id) => {
    try { const c = getCenter(id); return String((c && c.publicInfo && c.publicInfo.email) || ''); } catch (error) { return ''; }
  };
  const aLibramont = adressePublique('libramont');
  const aGembloux = adressePublique('gembloux');
  ok(Boolean(aLibramont) && Boolean(aGembloux) && aLibramont !== aGembloux && aLibramont !== 'contact@pinlane.be',
    '[montage] deux centres declarent une adresse publique distincte, et differente de l adresse d envoi',
    `${aLibramont} / ${aGembloux}`);
  const rL = await passageReplyTo('libramont');
  const rG = await passageReplyTo('gembloux');
  ok(Boolean(rL.corps) && rL.corps.reply_to === aLibramont,
    '[E] un client de Libramont qui repond ecrit a Libramont', `reply_to=${rL.corps && rL.corps.reply_to} attendu=${aLibramont}`);
  ok(Boolean(rG.corps) && rG.corps.reply_to === aGembloux,
    '[E] un client de Gembloux ecrit a Gembloux (l adresse suit le centre, ce n est pas une constante)', `reply_to=${rG.corps && rG.corps.reply_to} attendu=${aGembloux}`);
  ok(Boolean(rL.corps) && /contact@pinlane\.be/.test(String(rL.corps.from)) && rL.corps.reply_to !== 'contact@pinlane.be',
    '[E] l adresse d ENVOI reste l expediteur, et la reponse ne lui revient pas', `from=${rL.corps && rL.corps.from}`);
  const rSans = await passageReplyTo('centre-inconnu-du-socle');
  ok(rSans.ligne.status === 'sent',
    '[E] un centre sans adresse publique n empeche pas l envoi (repli d avant, fail-soft)', `statut ${rSans.ligne.status}, reply_to=${rSans.corps && rSans.corps.reply_to}`);

  // =====================================================================
  console.log('\n[G] une adresse de retour par centre ramene la conversation dans Pinlane');
  // =====================================================================
  const RETOURS = JSON.stringify({ libramont: 'libramont@inbound.pinlane.be' });
  process.env.CENTER_REPLY_TO = RETOURS;
  const gL = await passageReplyTo('libramont');
  const gG = await passageReplyTo('gembloux');
  ok(Boolean(gL.corps) && gL.corps.reply_to === 'libramont@inbound.pinlane.be',
    '[G] l adresse de retour declaree PRIME sur l adresse publique du centre', `reply_to=${gL.corps && gL.corps.reply_to}`);
  ok(Boolean(gG.corps) && gG.corps.reply_to === aGembloux,
    '[G] un centre SANS reglage garde son adresse publique (le reglage d un centre ne deborde pas)', `reply_to=${gG.corps && gG.corps.reply_to}`);
  process.env.CENTER_REPLY_TO = '{ ceci n est pas du JSON';
  const gCasse = await passageReplyTo('libramont');
  ok(Boolean(gCasse.corps) && gCasse.corps.reply_to === aLibramont && gCasse.ligne.status === 'sent',
    '[G] un reglage illisible ne casse aucun envoi : on retombe sur l adresse publique', `reply_to=${gCasse.corps && gCasse.corps.reply_to}, statut ${gCasse.ligne.status}`);
  process.env.CENTER_REPLY_TO = JSON.stringify({ libramont: 'pas-une-adresse' });
  const gInvalide = await passageReplyTo('libramont');
  ok(Boolean(gInvalide.corps) && gInvalide.corps.reply_to === aLibramont,
    '[G] une adresse de retour qui n en est pas une est ignoree', `reply_to=${gInvalide.corps && gInvalide.corps.reply_to}`);
  delete process.env.CENTER_REPLY_TO;

  // =====================================================================
  console.log('\n[H] une reponse a un mail recu part avec ses en-tetes de fil');
  // =====================================================================
  const passageFil = async (payload) => {
    purger();
    const comms = require(path.join(ROOT, 'lib/ops-communications'));
    ROWS.length = 0;
    APPELS.length = 0;
    ROWS.push(ligne(20, { templateId: 'manual', recipient: 'cliente@exemple.be', payload: { textBody: 'Bonjour', ...payload } }));
    await comms.dispatchDueCommunications({ limit: 5 });
    return { corps: (APPELS[0] || {}).corps || null, ligne: ROWS[0] };
  };
  const EN_TETES_FIL = { inReplyTo: '<q1@gmail.com>', references: '<conf-1@fungalaxy.be> <q1@gmail.com>' };
  const fil = await passageFil(EN_TETES_FIL);
  const entetesFil = (fil.corps && fil.corps.headers) || {};
  ok(entetesFil['In-Reply-To'] === EN_TETES_FIL.inReplyTo && entetesFil.References === EN_TETES_FIL.references,
    '[H] In-Reply-To et References du payload sont poses sur l appel au fournisseur', JSON.stringify(entetesFil));
  ok(!('List-Unsubscribe' in entetesFil) && fil.ligne.status === 'sent',
    '[H] une reponse ne porte pas de List-Unsubscribe, et elle part', `statut ${fil.ligne.status}`);
  const sansFil = await passageFil({});
  ok(Boolean(sansFil.corps) && !('headers' in sansFil.corps),
    '[H] contraste : sans en-tetes de fil, aucun bloc headers n est envoye');

  // =====================================================================
  console.log('\n[D] contre-epreuves par mutation (compilees en memoire, disque intact)');
  // =====================================================================
  try {
    mutations = [{ fichier: 'lib/ops-communications.js', de: 'if (sendResult.unroutable) {', vers: 'if (false) {' }];
    const m = await passageDispatcher();
    ok(m.reservee.status === 'queued', 'contre-epreuve 1 : sans la regle, la ligne reservee retombe en queued (le gate ROUGIRAIT)', `statut ${m.reservee.status}`);
  } catch (error) {
    ok(false, `contre-epreuve 1 impossible : ${error.message}`);
  } finally { mutations = []; }
  try {
    process.env.CENTER_REPLY_TO = RETOURS;
    mutations = [{ fichier: 'lib/ops-communications.js', de: '    adresseDeRetourDuCentre(communication.centerId),', vers: "    '', // mutation" }];
    const m = await passageReplyTo('libramont');
    ok(Boolean(m.corps) && m.corps.reply_to !== 'libramont@inbound.pinlane.be',
      'contre-epreuve 4 : sans l adresse de retour, la conversation ne revient plus dans Pinlane (le gate ROUGIRAIT)',
      `reply_to=${m.corps && m.corps.reply_to}`);
  } catch (error) {
    ok(false, `contre-epreuve 4 impossible : ${error.message}`);
  } finally { mutations = []; delete process.env.CENTER_REPLY_TO; }
  try {
    mutations = [{ fichier: 'lib/ops-communications.js', de: '    adresseDuCentre(communication.centerId),', vers: "    '', // mutation" }];
    const m = await passageReplyTo('libramont');
    ok(Boolean(m.corps) && m.corps.reply_to !== aLibramont,
      'contre-epreuve 3 : sans l adresse du centre, la reponse repart vers l adresse d envoi (le gate ROUGIRAIT)',
      `reply_to=${m.corps && m.corps.reply_to}`);
  } catch (error) {
    ok(false, `contre-epreuve 3 impossible : ${error.message}`);
  } finally { mutations = []; }
  try {
    // Depuis fa4b739 (2026-10-05) l appel vit dans un Promise.all avec la copie
    // de secours, sans `await` devant : l ancre suit l appel, toujours unique.
    mutations = [{ fichier: 'lib/reservation-ops.js', de: 'dispatchDueCommunications({ limit: 5, centerId:', vers: '(async () => null)({ limit: 5, centerId:' }];
    const m = await passageHook();
    ok(m.espion.appels.length === 0, 'contre-epreuve 2 : sans l appel du hook, aucun dispatch (le gate ROUGIRAIT)', `${m.espion.appels.length}`);
  } catch (error) {
    ok(false, `contre-epreuve 2 impossible : ${error.message}`);
  } finally { mutations = []; }
  try {
    mutations = [{ fichier: 'lib/ops-communications.js', de: "  if (inReplyTo) entetes['In-Reply-To'] = inReplyTo;", vers: '' }];
    const m = await passageFil(EN_TETES_FIL);
    ok(!((m.corps && m.corps.headers) || {})['In-Reply-To'],
      'contre-epreuve 5 : sans la pose de In-Reply-To, la reponse sort du fil du client (le gate ROUGIRAIT)',
      JSON.stringify(m.corps && m.corps.headers));
  } catch (error) {
    ok(false, `contre-epreuve 5 impossible : ${error.message}`);
  } finally { mutations = []; }

  console.log(failures ? `\n${failures} controle(s) en echec.` : '\nTous les controles passent.');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});
