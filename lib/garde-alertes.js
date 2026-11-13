// LE CANAL DE GARDE (2026-11-05).
//
// Ansar veut etre prevenu tout de suite, et le mail n est pas un canal de panne
// (workers/sonde-prod/sonde.mjs, journal 182). Le meme bot Telegram que la sonde,
// cette fois depuis l application : elle seule sait qu un client vient de rater sa
// reservation. La sonde, elle, reste dehors et voit l application tomber.
//
// Trois regles :
//   - aucune donnee personnelle ne part : ni nom, ni telephone, ni e-mail. Le detail
//     se lit dans la Tour de controle ;
//   - ne jamais lever et ne jamais attendre longtemps : ce message accompagne une
//     demande de client qui a deja ses propres soucis ;
//   - sans canal, rien ne part et la Tour de controle le dit.
//
// LES SUJETS (2026-11-06, Ansar : « Pannes (tout de suite), Reservations (une par
// message), Modifications (groupees par quart d heure), Bilans »). Un groupe Telegram a
// sujets : TELEGRAM_GROUPE (son identifiant) et TELEGRAM_SUJETS
// (« pannes:2,reservations:3,modifications:4,bilans:5 »). Sans groupe, tout part dans la
// conversation d Ansar avec le bot, comme avant. Seules les pannes sonnent : un samedi a
// 40 reservations, la vraie panne ne se perd pas entre deux reservations. Un groupe qui
// refuse (bot retire, sujet supprime) ne perd rien : le message repart dans la
// conversation, avec une ligne qui le dit.
'use strict';

const DELAI_MS = 4000;
const FENETRE_MS = 10 * 60_000;
const TAILLE_MAX = 3500;
const SUJETS = ['pannes', 'reservations', 'modifications', 'bilans'];
const SONNENT = new Set(['pannes']);

const net = (v) => String(v === undefined || v === null ? '' : v).trim();
const canalBranche = (env = process.env) => Boolean(net(env.TELEGRAM_JETON) && net(env.TELEGRAM_CHAT));

function lireSujets(env = process.env) {
  const out = {};
  for (const morceau of net(env.TELEGRAM_SUJETS).split(',')) {
    const m = morceau.trim().match(/^([a-z]+)\s*[:=]\s*(\d{1,12})$/);
    if (m && SUJETS.includes(m[1])) out[m[1]] = Number(m[2]);
  }
  return out;
}

// Ou part un message de ce sujet : le groupe et son sujet, sinon la conversation.
function destination(sujet, env = process.env) {
  const groupe = net(env.TELEGRAM_GROUPE);
  const fil = lireSujets(env)[sujet];
  if (/^-\d{5,20}$/.test(groupe) && fil) return { chat_id: groupe, message_thread_id: fil, groupe: true };
  return { chat_id: net(env.TELEGRAM_CHAT), groupe: false };
}
const groupeBranche = (env = process.env) => destination('pannes', env).groupe;

// Un long texte (le bilan du matin) part en plusieurs messages, coupes entre deux lignes.
function decouper(texte, max = TAILLE_MAX) {
  const t = String(texte);
  if (t.length <= max) return [t];
  const morceaux = [];
  let courant = '';
  for (const brute of t.split('\n')) {
    const ligne = brute.length > max ? brute.slice(0, max) : brute;
    if (courant && courant.length + 1 + ligne.length > max) {
      morceaux.push(courant);
      courant = ligne;
    } else {
      courant = courant ? `${courant}\n${ligne}` : ligne;
    }
  }
  if (courant) morceaux.push(courant);
  return morceaux;
}

// LE NUMERO D UNE RESERVATION S OUVRE D UN TOUCHER (2026-11-06, Ansar : « chaque
// numero encore affiche mene quelque part »). « Réservation n° 1734 »,
// « réservation n° 903 », « dont le n° 1701 » : le numero devient un lien vers
// la console (/?resa=1734), qui ouvre la reservation, meme dans l autre centre.
// Le texte reste du texte brut : une entite text_link par lien, calculee sur le
// morceau qui part (decoupe et ligne du repli comprises), en unites UTF-16 comme
// Telegram les compte, et comme JavaScript indexe ses chaines. `liens` ajoute
// un texte a ouvrir : « À traiter dans la console » d une demande de groupe.
const NUMERO_DE_RESERVATION = /(?<=(?:[Rr]éservation|dont le) )n° (\d{1,12})/g;
// L adresse de la console vit avec le gabarit des alertes (lib/alertes-texte.js) : la ligne
// « Ouvrir ... » d une alerte mene a la meme console que le numero d une reservation.
const { adresseDeLaConsole, PAGES } = require('./alertes-texte');
function entitesDesLiens(texte, { env = process.env, liens = [] } = {}) {
  const t = String(texte);
  const base = adresseDeLaConsole(env);
  const trouves = [];
  for (const m of t.matchAll(NUMERO_DE_RESERVATION)) trouves.push({ type: 'text_link', offset: m.index, length: m[0].length, url: `${base}/?resa=${m[1]}` });
  // Un message de plusieurs alertes porte la meme ligne « Ouvrir la Tour de contrôle » plusieurs
  // fois : chaque occurrence s ouvre.
  const vus = new Set();
  for (const lien of Array.isArray(liens) ? liens : []) {
    if (!lien || !lien.texte || !/^https?:\/\//.test(String(lien.url || '')) || vus.has(lien.texte)) continue;
    vus.add(lien.texte);
    for (let i = t.indexOf(lien.texte); i >= 0; i = t.indexOf(lien.texte, i + lien.texte.length)) trouves.push({ type: 'text_link', offset: i, length: lien.texte.length, url: String(lien.url) });
  }
  trouves.sort((a, b) => a.offset - b.offset);
  const entites = [];
  for (const e of trouves) {
    const avant = entites[entites.length - 1];
    if (!avant || e.offset >= avant.offset + avant.length) entites.push(e);
  }
  return entites;
}

async function posterUn(texte, dest, silencieux, { env, fetcher, delaiMs, liens = [] }) {
  const api = env.TELEGRAM_API || 'https://api.telegram.org';
  const corps = { chat_id: dest.chat_id, text: texte, disable_web_page_preview: true };
  const entites = entitesDesLiens(texte, { env, liens });
  if (entites.length) corps.entities = entites;
  if (dest.message_thread_id) corps.message_thread_id = dest.message_thread_id;
  if (silencieux) corps.disable_notification = true;
  try {
    const reponse = await fetcher(`${api}/bot${net(env.TELEGRAM_JETON)}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(delaiMs),
    });
    if (reponse.body && reponse.body.cancel) await reponse.body.cancel().catch(() => {});
    if (reponse.ok) return { ok: true };
    // 400 et 403 : le chat ou le sujet n existe plus, ou le bot n y est plus. Pas une panne de reseau.
    return { ok: false, raison: `Telegram ${reponse.status}`, refus: reponse.status === 400 || reponse.status === 403 };
  } catch (error) {
    return { ok: false, raison: error && error.name === 'TimeoutError' ? 'délai dépassé' : 'injoignable' };
  }
}

async function envoyerTelegram(texte, { sujet = 'pannes', silencieux = null, env = process.env, fetcher = fetch, delaiMs = DELAI_MS, liens = [] } = {}) {
  if (!canalBranche(env)) return { ok: false, raison: 'canal absent' };
  const s = SUJETS.includes(sujet) ? sujet : 'pannes';
  const dest = destination(s, env);
  const calme = silencieux === null ? !SONNENT.has(s) : Boolean(silencieux);
  let repli = false;
  for (const morceau of decouper(texte)) {
    const r = await posterUn(morceau, dest, calme, { env, fetcher, delaiMs, liens });
    if (r.ok) continue;
    if (!dest.groupe || !r.refus) return r;
    const secours = await posterUn(`(Le groupe Pinlane refuse ce message, sujet ${s} : il arrive ici.)\n${morceau}`, { chat_id: net(env.TELEGRAM_CHAT), groupe: false }, calme, { env, fetcher, delaiMs, liens });
    if (!secours.ok) return secours;
    repli = true;
  }
  return repli ? { ok: true, repli: true } : { ok: true };
}

// Une tempete de pannes ne fait pas une tempete de messages : une alerte par sujet
// et par fenetre, sur chaque instance. La memoire suffit : si la base tombe, c est
// justement elle qu on ne peut plus lire.
const dits = new Map();
function dejaDit(cle, fenetreMs, maintenant) {
  for (const [c, fin] of dits) if (fin <= maintenant) dits.delete(c);
  if (dits.has(cle)) return true;
  dits.set(cle, maintenant + fenetreMs);
  return false;
}

// Et des pannes toutes differentes (un fichier casse fait planter dix etapes) ne font
// pas cinquante messages : au-dela de 12 alertes en 10 minutes sur une instance, une
// seule ligne le dit, et la suite se lit dans la Tour de controle.
const RAFALE_MS = 10 * 60_000;
const RAFALE_MAX = 12;
// DEUX COMPTEURS DE RAFALE (passe securite du 2026-11-08). Ce que n importe qui peut
// declencher sans compte (un « plantage » envoye par un navigateur) a son propre compteur :
// avant, douze faux plantages faisaient taire dix minutes TOUTES les alertes de
// l instance, vraies pannes du serveur comprises.
const rafales = { serveur: { debut: 0, n: 0, dite: false }, public: { debut: 0, n: 0, dite: false } };

// Les deux messages de rafale, au gabarit des alertes (lib/alertes-texte.js).
function texteRafale(origine, env = process.env) {
  const { bloc, faire, lienVers, rienAFaire } = require('./alertes-texte');
  return origine === 'public'
    ? bloc({ quoi: 'Pinlane : beaucoup d’erreurs signalées d’un coup par des navigateurs de clients', effet: 'Les suivantes ne t’arrivent plus pendant 10 minutes. Les vraies pannes, elles, arrivent toujours', action: rienAFaire('elles restent toutes listées dans la page des plantages.'), lien: lienVers('plantages', env) })
    : bloc({ quoi: 'Pinlane : beaucoup de problèmes signalés d’un coup', effet: 'Pour ne pas te noyer, les messages suivants sont en pause pendant 10 minutes', action: faire('regarde la liste complète dans la Tour de contrôle.'), lien: lienVers('tour', env) });
}

// `urgent` : true fait sonner (seul le sujet Pannes sonne), false arrive sans sonnerie ; sans lui,
// la regle d avant (`silencieux`, sinon le sujet decide). `liens` : les lignes « Ouvrir ... ».
async function alerter(cle, texte, { fenetreMs = FENETRE_MS, maintenant = Date.now(), env = process.env, fetcher = fetch, sujet = 'pannes', silencieux = null, urgent = null, liens = [], origine = 'serveur' } = {}) {
  if (dejaDit(cle, fenetreMs, maintenant)) return { ok: true, deja: true };
  const rafale = rafales[origine === 'public' ? 'public' : 'serveur'];
  if (maintenant - rafale.debut > RAFALE_MS) Object.assign(rafale, { debut: maintenant, n: 0, dite: false });
  rafale.n += 1;
  if (rafale.n > RAFALE_MAX) {
    if (rafale.dite) return { ok: true, rafale: true };
    rafale.dite = true;
    const m = texteRafale(origine, env);
    const r = await envoyerTelegram(m.texte, { env, fetcher, sujet: 'pannes', silencieux: origine === 'public', liens: m.liens });
    return { ...r, rafale: true };
  }
  const calme = urgent === true ? false : urgent === false ? true : silencieux;
  const r = await envoyerTelegram(texte, { env, fetcher, sujet, silencieux: calme, liens });
  if (!r.ok) {
    // Un message perdu se redit au prochain incident, et la cause se lit dans les journaux.
    dits.delete(cle);
    console.error('[garde] alerte non partie', r.raison);
  }
  return r;
}

const oublierLesAlertes = () => {
  dits.clear();
  for (const r of Object.values(rafales)) Object.assign(r, { debut: 0, n: 0, dite: false });
};

module.exports = { PAGES, SUJETS, adresseDeLaConsole, alerter, canalBranche, decouper, destination, entitesDesLiens, envoyerTelegram, groupeBranche, lireSujets, oublierLesAlertes, texteRafale };
