// LES ALERTES SE LISENT (2026-11-13, Ansar : « retravaille toutes les alertes que je reçois [...]
// c'est pas clair, j'comprends rien, faut français simple et tout clair »).
//
// Chaque type de message part ici par le VRAI code, jusqu a un faux Telegram en HTTP local (le
// meme envoi qu en prod, liens compris), puis passe le controle du gabarit (lib/alertes-texte.js,
// controlerTexte) : aucun mot technique ni identifiant interne, une ligne « Ce que tu fais » ou
// « Rien à faire », pas trop long, ni tiret long, ni apostrophe droite, ni emoji, ni donnee
// personnelle. Puis les contre-preuves : le code d avant, compile en memoire, doit rougir.
//
//   [G] le gabarit lui-meme et ses liens ;
//   [I] les textes d avant sont refuses (les exemples d Ansar du 13/11) ;
//   [R] la rafale ;
//   [X] les contre-preuves.
// Lancement : node scripts/alertes-lisibles-check.js   (port : PINLANE_ALERTES_PORT, 5307 par defaut)
'use strict';

for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES|RESEND|TWILIO|TELEGRAM|PINLANE_SECOURS|ANTHROPIC|OPENAI|OPENROUTER|KIMI|MOONSHOT|LLM_|GARDE_|INBOUND_EMAIL|CRON_SECRET|PUBLIC_APP_URL)/i.test(nom)) delete process.env[nom];
process.env.DATABASE_URL = 'postgres://banc/banc';

const http = require('http');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_ALERTES_PORT || 5307);
const LF = '\n';
const PERSONNEL = /Jean|Dupont|0471|example\.be|jean@/;

let total = 0;
let echecs = 0;
function ok(condition, message, detail) {
  total += 1;
  if (condition) { console.log(`ok    ${message}`); return; }
  echecs += 1;
  console.log(`FAIL  ${message}${detail === undefined ? '' : `  ${(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700)}`}`);
}

// Les mutations, compilees en memoire : le disque n est jamais ecrit.
let mutations = [];
const compileAvant = Module.prototype._compile;
Module.prototype._compile = function (contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const edits = mutations.filter((e) => e.fichier === rel);
  if (!edits.length) return compileAvant.call(this, contenu, nom);
  let mute = contenu.split('\r\n').join(LF);
  for (const { de, vers } of edits) {
    if (mute.split(de).length !== 2) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 80)}`);
    mute = mute.split(de).join(vers);
  }
  return compileAvant.call(this, mute, nom);
};
const charger = (rel) => require(path.join(ROOT, rel));
function purger() {
  for (const cle of Object.keys(require.cache)) if (cle.startsWith(path.join(ROOT, 'lib')) || cle.startsWith(path.join(ROOT, 'api'))) delete require.cache[cle];
}

// Le faux Telegram : un vrai serveur HTTP local, qui note chaque message.
const TG = [];
const serveur = http.createServer((req, res) => {
  let brut = '';
  req.on('data', (m) => { brut += m; });
  req.on('end', () => {
    try { TG.push(JSON.parse(brut)); } catch (error) { TG.push({ text: '', illisible: true }); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
});
const brancher = () => {
  process.env.TELEGRAM_API = `http://127.0.0.1:${PORT}`;
  process.env.TELEGRAM_JETON = 'banc';
  process.env.TELEGRAM_CHAT = '42';
};
for (const nom of ['error', 'warn']) { const o = console[nom]; console[nom] = (...a) => { if (!/\[garde\]|\[chef-de-garde\]|\[tour-controle\]|ECRITURE PERDUE|TRACE PERDUE|\[client-errors\]|\[audit\]/.test(String(a[0]))) o(...a); }; }

// Un message passe-t-il le gabarit ? Rend les fautes, vides si oui.
const fautesDe = (texte, genre) => charger('lib/alertes-texte.js').controlerTexte(texte, { genre });
function lisible(texte, genre, nom) {
  const f = fautesDe(texte, genre);
  ok(f.length === 0, `${nom} : se lit`, f.length ? `${f.join(' | ')}  >>  ${texte}` : undefined);
  ok(!PERSONNEL.test(texte), `${nom} : aucune donnee personnelle`, texte);
  return f.length === 0;
}

// ---------------------------------------------------------------------------
// [G] Le gabarit et ses liens.
// ---------------------------------------------------------------------------
async function preuvesGabarit() {
  const t = charger('lib/alertes-texte.js');
  const b = t.bloc({ quoi: 'Gembloux : le formulaire en ligne ne s’ouvre plus', effet: 'Les clients ne peuvent plus réserver en ligne', action: t.faire('réserve toi-même sur le site pour vérifier.'), lien: t.lienVers('tour') });
  ok(b.texte === 'Gembloux : le formulaire en ligne ne s’ouvre plus.\nLes clients ne peuvent plus réserver en ligne.\nCe que tu fais : réserve toi-même sur le site pour vérifier.\nOuvrir la Tour de contrôle', '[G] un bloc : ce qui se passe, ce que ca change, ce que tu fais, le lien', b.texte);
  lisible(b.texte, 'alerte', '[G] le bloc du gabarit');
  ok(b.liens.length === 1 && b.liens[0].url === 'https://app.pinlane.be/#/staff/cockpit-tour', '[G] le lien mene a la Tour de controle', b.liens);
  const r = t.regle('à Gembloux, le formulaire en ligne ne s’ouvrait plus', Date.parse('2026-11-14T13:05:00Z'));
  ok(r === 'Réglé : à Gembloux, le formulaire en ligne ne s’ouvrait plus, depuis 14:05.', '[G] « Réglé » : la meme chose au passe, et depuis quand', r);
  lisible(r, 'regle', '[G] la ligne « Réglé »');
  const deux = t.assembler([b, t.bloc({ quoi: 'Libramont : 2 mails n’ont pas pu partir', effet: 'Ces clients n’ont peut-être pas leur confirmation', action: t.faire('regarde les mails.'), lien: t.lienVers('tour') })]);
  const { entitesDesLiens } = charger('lib/garde-alertes.js');
  const entites = entitesDesLiens(deux.texte, { liens: deux.liens });
  ok(entites.length === 2 && entites.every((e) => e.url.endsWith('/#/staff/cockpit-tour') && deux.texte.substr(e.offset, e.length) === 'Ouvrir la Tour de contrôle'), '[G] deux alertes dans un message : chaque ligne « Ouvrir » s ouvre', entites);
  lisible(deux.texte, 'alerte', '[G] deux alertes dans un message');
}

// ---------------------------------------------------------------------------
// [I] Les textes d avant sont refuses.
// ---------------------------------------------------------------------------
const AVANT = [
  ['une panne du serveur d avant', 'URGENT Pinlane\nPanne du serveur, api/ops (libramont).\nECONNREFUSED connect ECONNREFUSED 10.0.0.1:5432\nLe détail est dans la Tour de contrôle.'],
  ['une console plantee d avant', 'URGENT Pinlane\nLa console de Gembloux a planté chez Seb, page planning (plantage abc123). Le détail est dans la Tour de contrôle.'],
  ['une tache d avant', 'URGENT Pinlane\nops-jobs ne tourne plus. Dernier passage réussi il y a 2 h.'],
  ['une action inconnue d avant', 'Modifications, 14:03 à 14:10\nGembloux\n14:03 Seb : action « saveEmailTemplate » (la garde ne la connaît pas encore)'],
  ['l explication d avant', 'Le chef de garde :\nUn mail de Gembloux n’est pas parti.'],
  ['une erreur technique recopiee', 'Gembloux : la console ne répond plus.\nTypeError: Cannot read properties of undefined (reading \'id\') at app-main.js:10\nCe que tu fais : recharge la page.'],
  ['un message sans ligne d action', 'Gembloux : 2 mails n’ont pas pu partir.\nLes clients n’ont peut-être pas leur confirmation.'],
  ['un message trop long', `Gembloux : le formulaire ne s’ouvre plus.\n${'Les clients ne peuvent plus réserver. '.repeat(20)}\nCe que tu fais : vérifie.`],
];
function preuvesAvant() {
  for (const [nom, texte] of AVANT) {
    const f = fautesDe(texte, /^Modifications/.test(texte) ? 'releve' : 'alerte');
    ok(f.length > 0, `[I] ${nom} : refusee`, f.length ? f.join(' | ') : texte);
  }
}

// ---------------------------------------------------------------------------
// [R] La rafale, par le vrai alerter, jusqu au faux Telegram.
// ---------------------------------------------------------------------------
async function messagesDeRafale() {
  const a = charger('lib/garde-alertes.js');
  a.oublierLesAlertes();
  TG.length = 0;
  const t0 = Date.parse('2026-11-14T12:00:00Z');
  for (let i = 0; i < 14; i += 1) await a.alerter(`cle-${i}`, `Gembloux : essai ${i}.\nRien.\nRien à faire : essai.`, { maintenant: t0 + i * 1000 });
  for (let i = 0; i < 14; i += 1) await a.alerter(`public-${i}`, `Gembloux : essai public ${i}.\nRien.\nRien à faire : essai.`, { maintenant: t0 + i * 1000, origine: 'public', urgent: false });
  a.oublierLesAlertes();
  return { serveur: TG[12] || { text: '' }, public: TG[25] || { text: '' } };
}
async function preuvesRafale() {
  const { serveur, public: pub } = await messagesDeRafale();
  lisible(serveur.text, 'alerte', '[R] la rafale des pannes');
  lisible(pub.text, 'alerte', '[R] la rafale des navigateurs');
  ok(!serveur.disable_notification && pub.disable_notification === true, '[R] la rafale des pannes sonne, celle des navigateurs non', { serveur: serveur.disable_notification, public: pub.disable_notification });
  ok((serveur.entities || []).some((e) => e.type === 'text_link' && /cockpit-tour$/.test(e.url)) && (pub.entities || []).some((e) => /cockpit-incidents$/.test(e.url)), '[R] chacune mene a sa page de la console', { serveur: serveur.entities, public: pub.entities });
}

// ---------------------------------------------------------------------------
// [X] Les contre-preuves : le code d avant doit rougir.
// ---------------------------------------------------------------------------
async function contrePreuves() {
  const rouge = async (nom, edits, rejouer) => {
    mutations = edits;
    purger();
    let tient;
    try { tient = await rejouer(); } catch (error) { tient = false; }
    mutations = [];
    purger();
    ok(tient === false, `[X] ${nom} : rougit`);
  };
  await rouge('le controle qui laisse passer un mot technique', [{ fichier: 'lib/alertes-texte.js', de: "  [/\\bserveurs?\\b/i, 'serveur'],\n", vers: '' }], async () => fautesDe('Pinlane : le serveur ne répond plus.\nLes clients attendent.\nCe que tu fais : attends.', 'alerte').length > 0);
  await rouge('le controle qui oublie la ligne d action', [{ fichier: 'lib/alertes-texte.js', de: "      if (actions.length !== 1) fautes.push(", vers: "      if (false) fautes.push(" }], async () => fautesDe('Gembloux : 2 mails n’ont pas pu partir.\nLes clients attendent.', 'alerte').length > 0);
  await rouge('la rafale d avant', [{ fichier: 'lib/garde-alertes.js', de: "    const m = texteRafale(origine, env);", vers: "    const m = { texte: 'URGENT Pinlane\\nTrop d’alertes d’un coup : les suivantes ne partent plus pendant 10 minutes. Tout est dans la Tour de contrôle.', liens: [] };" }], async () => fautesDe((await messagesDeRafale()).serveur.text, 'alerte').length === 0);
  await rouge('un lien qui ne s ouvre qu une fois', [{ fichier: 'lib/garde-alertes.js', de: "    for (let i = t.indexOf(lien.texte); i >= 0; i = t.indexOf(lien.texte, i + lien.texte.length)) trouves.push(", vers: "    for (let i = t.indexOf(lien.texte); i >= 0; i = -1) trouves.push(" }], async () => {
    const t = charger('lib/alertes-texte.js');
    const b = t.bloc({ quoi: 'Gembloux : essai', action: t.faire('rien'), lien: t.lienVers('tour') });
    const deux = t.assembler([b, b]);
    return charger('lib/garde-alertes.js').entitesDesLiens(deux.texte, { liens: deux.liens }).length === 2;
  });
}

(async () => {
  await new Promise((resolve, reject) => { serveur.once('error', reject); serveur.listen(PORT, '127.0.0.1', resolve); });
  brancher();
  try {
    await preuvesGabarit();
    preuvesAvant();
    await preuvesRafale();
    await contrePreuves();
  } finally {
    serveur.close();
  }
  console.log(`\nalertes-lisibles-check: ${echecs ? `${echecs} ECHEC(S) sur ${total}` : `ALL OK (${total})`}`);
  process.exit(echecs ? 1 : 0);
})().catch((error) => {
  console.error('alertes-lisibles-check: PLANTAGE', error && (error.stack || error));
  process.exit(1);
});
