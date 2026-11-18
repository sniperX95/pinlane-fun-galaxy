// LE PLAFOND DES CONVERSATIONS DE L ASSISTANT GARDEES PAR UNE PERSONNE (2026-11-18, avant-lancement C3).
//
// Chaque conversation enregistree etait bornee (80 messages, 1,5 Mo), leur nombre non : une personne,
// ou un script avec sa session, remplissait la base sans limite. Une personne garde maintenant ses 200
// plus recentes (celles que la liste de la console montre deja), dans 30 Mo en base au plus. Les plus
// anciennes partent, chez elle seulement, a chaque enregistrement et a chaque reprise de l appareil.
// La console n a rien a changer : la liste lue reste celle des 200 plus recentes.
//
// [G] LE NOMBRE (lib/assistant-memoire.js, sauverConversation) : a 200, une nouvelle fait partir la plus
//     ancienne, ses lignes de tous les centres comptent ensemble, celles d un collegue ne bougent pas, et
//     reenregistrer une conversation deja gardee ne fait rien partir.
// [P] LE POIDS : au-dela de 30 Mo en base, les plus anciennes partent.
// [R] LA REPRISE DE L APPAREIL (reprendreConversations) : le meme plafond tient apres la reprise.
// [E] UN ECHEC DU MENAGE ne casse pas l enregistrement.
//
// Sans base : la table est tenue en memoire par un double qui lit la portee et l ordre de la requete.
// Les contre-preuves chargent le code mute en memoire : aucun fichier n est ecrit.
// Lancement : node scripts/conversations-plafond-check.js [--contre-preuves]

'use strict';

const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MEM = 'lib/assistant-memoire.js';
const MUTATIONS = {
  'sans-plafond-a-l-enregistrement': { f: MEM, de: '  await elaguer(q, ids, c.id);\n', vers: '', lettre: 'G' },
  'compte-aussi-les-collegues': { f: MEM, de: '         where member_id = any($1::text[])\n         order by updated_at desc, id desc;', vers: '         order by updated_at desc, id desc;', lettre: 'G' },
  'la-plus-recente-part': { f: MEM, de: '         order by updated_at desc, id desc;', vers: '         order by updated_at asc, id asc;', lettre: 'G' },
  'poids-ignore': { f: MEM, de: '(rang >= CONVERSATIONS_GARDEES || poids > OCTETS_GARDES)', vers: '(rang >= CONVERSATIONS_GARDEES)', lettre: 'P' },
  'sans-plafond-a-la-reprise': { f: MEM, de: '  if (reprises.length) await elaguer(q, ids);\n', vers: '', lettre: 'R' },
  'echec-du-menage-remonte': { f: MEM, de: '    return parties.length;\n  } catch (erreur) {\n    return 0;\n  }\n', vers: '    return parties.length;\n  } finally {\n    // rien\n  }\n', lettre: 'E' },
};
const MUTATION = (process.argv.find((a) => a.startsWith('--mutation=')) || '').slice('--mutation='.length);
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`mutation inconnue : ${MUTATION}`); process.exit(2); }
function muter(fichier, texte) {
  const m = MUTATION ? MUTATIONS[MUTATION] : null;
  const t = String(texte).split('\r\n').join('\n');
  if (!m || path.resolve(fichier) !== path.join(ROOT, m.f)) return t;
  if (t.split(m.de).length !== 2) throw new Error(`ANCRE DE MUTATION absente ou multiple (${MUTATION}) dans ${m.f}`);
  return t.split(m.de).join(m.vers);
}
const compiler = Module.prototype._compile;
Module.prototype._compile = function compilerMute(contenu, fichier) {
  return compiler.call(this, muter(fichier, contenu), fichier);
};

let rouges = 0;
let lettre = '';
function section(titre) { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); }
function ok(condition, quoi, detail) {
  if (condition) { console.log(`ok    ${quoi}`); return; }
  rouges += 1;
  console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(detail).slice(0, 300)}` : ''}`);
}

if (process.argv.includes('--contre-preuves')) {
  const temoin = spawnSync(process.execPath, [__filename], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  if (temoin.status !== 0) { console.log(`${temoin.stdout || ''}${temoin.stderr || ''}`.split('\n').filter((l) => /ROUGE|Error/.test(l)).join('\n')); console.log('\nconversations-plafond-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte'); process.exit(1); }
  let rates = 0;
  for (const [nom, m] of Object.entries(MUTATIONS)) {
    const r = spawnSync(process.execPath, [__filename, `--mutation=${nom}`], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const mord = r.status === 1 && sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION/.test(sortie);
    if (!mord) rates += 1;
    console.log(`${mord ? 'TUEE ' : 'VIVANTE'} ${nom} (attendu : ROUGE [${m.lettre}], sortie ${r.status})${mord ? '' : `\n${sortie.split('\n').filter((l) => /ROUGE|ANCRE|Error/.test(l)).slice(0, 6).join('\n')}`}`);
  }
  console.log(rates ? `\nconversations-plafond-check --contre-preuves: ${rates} mutation(s) vivante(s)` : '\nconversations-plafond-check --contre-preuves: ALL OK - chaque regle retiree fait rougir sa lettre');
  process.exit(rates ? 1 : 0);
}

const M = require('../lib/assistant-memoire');

// ── La table, sans la base ──
// Le poids d une ligne est celui de son JSON ; une ligne semee peut en declarer un plus lourd.
function fausseBase() {
  const conv = new Map();
  const etat = { horloge: Date.parse('2026-06-01T00:00:00Z'), panneDuMenage: false };
  const resume = (c) => ({ id: c.id, center_id: c.center_id, titre: c.titre, modele: c.modele, nb_messages: c.nb_messages, updated_at: new Date(c.updated_at) });
  const q = async (texte, params = []) => {
    const t = String(texte).replace(/\s+/g, ' ').trim();
    if (t.startsWith('insert into assistant_conversations')) {
      const existe = conv.get(params[0]);
      const reprise = /on conflict \(id\) do nothing/.test(t);
      if (existe && reprise) return { rows: [] };
      if (existe) {
        if (!params[7].includes(existe.member_id)) return { rows: [] };
        etat.horloge += 1000;
        Object.assign(existe, { titre: params[3], modele: params[4], messages: params[5], nb_messages: params[6], updated_at: etat.horloge, taille: Buffer.byteLength(params[5]) });
        return { rows: [resume(existe)] };
      }
      if (!reprise) etat.horloge += 1000;
      const ligne = { id: params[0], member_id: params[1], center_id: params[2], titre: params[3], modele: params[4], messages: params[5], nb_messages: params[6], updated_at: reprise ? Number(params[7]) : etat.horloge, taille: Buffer.byteLength(params[5]) };
      conv.set(ligne.id, ligne);
      return { rows: [resume(ligne)] };
    }
    if (t.startsWith('select id, pg_column_size(messages) as taille from assistant_conversations')) {
      if (etat.panneDuMenage) throw new Error('connexion perdue');
      const portee = /where member_id = any\(\$1::text\[\]\)/.test(t);
      const lignes = [...conv.values()].filter((c) => !portee || params[0].includes(c.member_id));
      lignes.sort((a, b) => (a.updated_at - b.updated_at) || (a.id < b.id ? -1 : 1));
      if (/order by updated_at desc, id desc/.test(t)) lignes.reverse();
      return { rows: lignes.map((c) => ({ id: c.id, taille: c.taille })) };
    }
    if (t.startsWith('delete from assistant_conversations')) {
      const portee = /member_id = any\(\$1::text\[\]\)/.test(t);
      const ids = Array.isArray(params[1]) ? params[1] : [params[0]];
      const parties = [];
      for (const id of ids) {
        const c = conv.get(id);
        if (c && (!portee || params[0].includes(c.member_id))) { conv.delete(id); parties.push({ id }); }
      }
      return { rows: parties };
    }
    return { rows: [] };
  };
  // Des conversations deja la, de la plus ancienne a la plus recente.
  const semer = (membre, n, { prefixe = 'conv-p', centre = 'libramont', depuis = Date.parse('2026-01-01T00:00:00Z'), taille = 300 } = {}) => {
    for (let i = 0; i < n; i += 1) {
      const id = `${prefixe}-${String(i).padStart(3, '0')}`;
      conv.set(id, { id, member_id: typeof membre === 'function' ? membre(i) : membre, center_id: centre, titre: 'Ancienne', modele: 'haiku', messages: '[]', nb_messages: 2, updated_at: depuis + i * 60000, taille });
    }
  };
  return { conv, etat, q, semer };
}
const CONV = (id) => ({ id, titre: 'Une question', modele: 'haiku', messages: [{ role: 'user', texte: 'Combien de reservations samedi ?' }, { role: 'assistant', id: 'a1', texte: 'Douze.', statut: 'fini', sources: [], graphiques: [], etapes: [] }] });
const PERSONNE = ['lib:m1', 'gem:m1'];
const COLLEGUE = ['lib:m2'];
const de = (b, ids) => [...b.conv.values()].filter((c) => ids.includes(c.member_id));

async function principal() {
  section('[G] LE NOMBRE (sauverConversation)');
  let b = fausseBase();
  // 200 conversations a elle, sur ses deux centres, puis 5 d un collegue, plus recentes que les siennes.
  b.semer((i) => (i % 3 ? 'lib:m1' : 'gem:m1'), 200);
  b.semer('lib:m2', 5, { prefixe: 'conv-c', depuis: Date.parse('2026-05-01T00:00:00Z') });
  const sauvee = await M.sauverConversation(b.q, PERSONNE, 'lib:m1', 'libramont', CONV('nouvelle01'));
  const siennes = de(b, PERSONNE);
  ok(sauvee && sauvee.id === 'nouvelle01' && siennes.length === 200 && !b.conv.has('conv-p-000') && b.conv.has('conv-p-001') && b.conv.has('nouvelle01'),
    'a 200, une nouvelle conversation fait partir la plus ancienne, les deux centres de la personne comptent ensemble', JSON.stringify({ siennes: siennes.length, plusAncienne: b.conv.has('conv-p-000'), suivante: b.conv.has('conv-p-001') }));
  ok(de(b, COLLEGUE).length === 5, 'les conversations d un collegue ne bougent pas', de(b, COLLEGUE).length);
  await M.sauverConversation(b.q, PERSONNE, 'lib:m1', 'libramont', { ...CONV('nouvelle01'), titre: 'Suite' });
  ok(de(b, PERSONNE).length === 200 && b.conv.has('conv-p-001'), 'reenregistrer une conversation deja gardee ne fait rien partir', JSON.stringify({ siennes: de(b, PERSONNE).length, suivante: b.conv.has('conv-p-001') }));

  section('[P] LE POIDS (30 Mo en base au plus)');
  b = fausseBase();
  const lourde = Math.floor(1.4 * 1024 * 1024);
  b.semer('lib:m1', 25, { taille: lourde });
  await M.sauverConversation(b.q, PERSONNE, 'lib:m1', 'libramont', CONV('legere01'));
  const gardees = de(b, PERSONNE);
  const poids = gardees.reduce((s, c) => s + c.taille, 0);
  ok(gardees.length === 22 && poids <= 30 * 1024 * 1024 && b.conv.has('legere01') && !b.conv.has('conv-p-003') && b.conv.has('conv-p-004'),
    'au-dela de 30 Mo, les plus anciennes partent et la nouvelle reste', JSON.stringify({ gardees: gardees.length, mo: Math.round(poids / 1048576 * 10) / 10 }));

  section('[R] LA REPRISE DE L APPAREIL (reprendreConversations)');
  b = fausseBase();
  b.semer('lib:m1', 200);
  const maintenant = Date.parse('2026-05-20T00:00:00Z');
  const reprises = await M.reprendreConversations(b.q, PERSONNE, 'lib:m1', 'libramont', ['appareil01', 'appareil02', 'appareil03'].map((id, i) => ({ ...CONV(id), centerId: 'libramont', maj: maintenant + i })));
  ok(reprises.length === 3 && de(b, PERSONNE).length === 200 && ['appareil01', 'appareil02', 'appareil03'].every((id) => b.conv.has(id)) && !b.conv.has('conv-p-002') && b.conv.has('conv-p-003'),
    'apres la reprise, la personne garde toujours 200 conversations, les plus recentes', JSON.stringify({ reprises: reprises.length, siennes: de(b, PERSONNE).length }));

  section('[E] UN ECHEC DU MENAGE');
  b = fausseBase();
  b.semer('lib:m1', 3);
  b.etat.panneDuMenage = true;
  let erreur = null;
  const malgre = await M.sauverConversation(b.q, PERSONNE, 'lib:m1', 'libramont', CONV('malgre01')).catch((e) => { erreur = e; return null; });
  ok(!erreur && malgre && b.conv.has('malgre01'), 'la conversation s enregistre quand meme, le suivant refait le compte', erreur && erreur.message);

  console.log(rouges ? `\nconversations-plafond-check: ${rouges} ROUGE(S)` : '\nconversations-plafond-check: ALL OK');
  process.exit(rouges ? 1 : 0);
}

principal().catch((e) => {
  console.error(`conversations-plafond-check: Error ${e && e.stack}`);
  process.exit(1);
});
