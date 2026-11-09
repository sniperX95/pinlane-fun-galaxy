// CE QUE L ASSISTANT GARDE (2026-11-09). Ansar : « chaque role chaque personne a ses propre
// conversation avec l ia c pas commun avec le centre ». Deux memoires, deux regles opposees :
//
//  - LES CONVERSATIONS SONT A UNE PERSONNE. Ni un collegue, ni la direction, ni un droit de la
//    plateforme ne les ouvre : chaque requete porte la liste des lignes staff de cette personne et
//    rien d autre. Une meme personne a une ligne par centre (meme code d acces), elle retrouve les
//    siennes partout. La porte commune d un role (`libramont:role:accueil`) n a pas de jumelle.
//
//  - CE QUE L IA APPREND EST AU CENTRE. Un fait appris sert tout de suite a toute l equipe du
//    centre. Il ne s ecrit que depuis une action de la page, donc d un geste humain : aucun outil
//    du modele ne touche cette table, et le texte d un fait repasse par le modele comme une
//    donnee bornee, jamais comme une consigne.
//
// Tables absentes (migration 0059 pas encore jouee) : le SQLSTATE le dit, pas le texte d erreur.
'use strict';

const TABLE_ABSENTE = '42P01';
const tableAbsente = (erreur) => Boolean(erreur && erreur.code === TABLE_ABSENTE);

const ID_CONVERSATION = /^[a-z0-9_-]{6,48}$/i;
const TITRE_MAX = 120;
const MESSAGES_MAX = 80;
const LIGNES_PAR_SOURCE = 60;
const ETAPES_MAX = 24;
const CONVERSATION_OCTETS_MAX = 1500000;
const REPRISE_MAX = 60;
const CONVERSATIONS_LUES = 200;

const FAIT_MIN = 3;
const FAIT_MAX = 500;
const FAITS_LUS = 200;
const FAITS_DANS_LE_CONTEXTE = 40;
const CONTEXTE_CARACTERES_MAX = 6000;
const ORIGINES = new Set(['panneau', 'proposition', 'correction']);

const refus = (message, statusCode = 400) => Object.assign(new Error(message), { expose: true, statusCode });
const texteDe = (valeur, max) => String(valeur == null ? '' : valeur).slice(0, max);
const nettoyer = (valeur) => String(valeur == null ? '' : valeur).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();

// ---- La personne ------------------------------------------------------------------
// Toutes les lignes staff de la personne connectee : la sienne, plus celles qui partagent son code
// d acces dans les autres centres. Meme definition que trouverJumelle (lib/staff-auth.js).
async function idsDeLaPersonne(q, session) {
  const id = String((session && session.member && session.member.id) || '').trim();
  if (!id) throw refus('Compte introuvable.', 403);
  const lus = await q(
    `
      select m.id
        from staff_members s
        join staff_members m on m.access_code_hash = s.access_code_hash
       where s.id = $1
         and m.status <> 'blocked'
         and s.id <> (s.center_id || ':role:' || s.role_id)
         and m.id <> (m.center_id || ':role:' || m.role_id);
    `,
    [id],
  );
  return [...new Set([id, ...((lus && lus.rows) || []).map((r) => r.id)])];
}

// ---- Les conversations --------------------------------------------------------------
function sourcePropre(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    id: texteDe(s.id, 12), outil: texteDe(s.outil, 40), titre: texteDe(s.titre, 200), detail: texteDe(s.detail, 400),
    colonnes: Array.isArray(s.colonnes) ? s.colonnes.slice(0, 16).map((c) => ({ cle: texteDe(c && c.cle, 40), nom: texteDe(c && c.nom, 60), type: texteDe(c && c.type, 12) })) : [],
    lignes: Array.isArray(s.lignes) ? s.lignes.slice(0, LIGNES_PAR_SOURCE) : [],
    ouvrables: Boolean(s.ouvrables), lien: s.lien && typeof s.lien === 'object' ? { page: texteDe(s.lien.page, 24) } : null,
    coupe: Boolean(s.coupe || (Array.isArray(s.lignes) && s.lignes.length > LIGNES_PAR_SOURCE)),
  };
}

function etapePropre(e) {
  if (!e || typeof e !== 'object') return null;
  if (e.note) return { note: true, libelle: texteDe(e.libelle, 240) };
  return {
    id: texteDe(e.id, 60), libelle: texteDe(e.libelle, 240), etat: texteDe(e.etat, 12), source: texteDe(e.source, 12),
    nomSource: texteDe(e.nomSource, 40), cleSource: texteDe(e.cleSource, 24), phrase: texteDe(e.phrase, 240), periode: texteDe(e.periode, 80), centre: texteDe(e.centre, 80),
    lues: Number(e.lues) || 0, total: Number(e.total) || 0, trouve: texteDe(e.trouve, 200), duree: Number(e.duree) || 0, unite: texteDe(e.unite, 30),
    extraits: Array.isArray(e.extraits) ? e.extraits.slice(0, 8).map((x) => ({ t: texteDe(x && x.t, 40), d: texteDe(x && x.d, 200) })) : [],
  };
}

function messagePropre(m) {
  if (!m || typeof m !== 'object') return null;
  if (m.role === 'user') return { role: 'user', texte: texteDe(m.texte, 6000) };
  if (m.role !== 'assistant') return null;
  return {
    role: 'assistant', id: texteDe(m.id, 48), texte: texteDe(m.texte, 40000), statut: texteDe(m.statut, 12), modele: texteDe(m.modele, 40), erreur: texteDe(m.erreur, 300),
    sources: Array.isArray(m.sources) ? m.sources.slice(0, 40).map(sourcePropre).filter(Boolean) : [],
    graphiques: Array.isArray(m.graphiques) ? m.graphiques.slice(0, 10) : [],
    etapes: Array.isArray(m.etapes) ? m.etapes.slice(0, ETAPES_MAX).map(etapePropre).filter(Boolean) : [],
    verite: m.verite && typeof m.verite === 'object' ? m.verite : null,
    propositions: Array.isArray(m.propositions) ? m.propositions.slice(0, 3).map((p) => ({ texte: texteDe(p && p.texte, FAIT_MAX), etat: texteDe(p && p.etat, 12), id: Number(p && p.id) || 0 })) : [],
    corrige: Boolean(m.corrige),
    faitsCites: Array.isArray(m.faitsCites) ? m.faitsCites.slice(0, 40).map((x) => ({ id: Number(x && x.id) || 0, texte: texteDe(x && x.texte, FAIT_MAX) })) : [],
  };
}

// Une conversation vient du navigateur de cette personne : bornee en taille, jamais de confiance
// sur le proprietaire ni sur le centre, qui se lisent cote serveur.
function conversationValide(brut) {
  const id = String((brut && brut.id) || '');
  if (!ID_CONVERSATION.test(id)) throw refus('Conversation invalide.');
  const messages = Array.isArray(brut.messages) ? brut.messages.slice(-MESSAGES_MAX).map(messagePropre).filter(Boolean) : [];
  if (!messages.length) throw refus('Conversation vide.');
  const json = JSON.stringify(messages);
  if (Buffer.byteLength(json, 'utf8') > CONVERSATION_OCTETS_MAX) throw refus('Cette conversation est trop longue. Commencez-en une nouvelle.', 413);
  return { id, titre: nettoyer(brut.titre).slice(0, TITRE_MAX) || 'Nouvelle conversation', modele: texteDe(brut.modele, 12) || 'haiku', messages, json };
}

const enMs = (valeur) => {
  const t = new Date(valeur).getTime();
  return Number.isFinite(t) ? t : 0;
};
const resume = (r) => ({ id: r.id, titre: r.titre, centerId: r.center_id, modele: r.modele, messages: Number(r.nb_messages) || 0, maj: enMs(r.updated_at) });

async function listerConversations(q, ids) {
  const lus = await q(
    `
      select id, center_id, titre, modele, nb_messages, updated_at
        from assistant_conversations
       where member_id = any($1::text[])
       order by updated_at desc
       limit $2;
    `,
    [ids, CONVERSATIONS_LUES],
  );
  return lus.rows.map(resume);
}

async function lireConversation(q, ids, id) {
  if (!ID_CONVERSATION.test(String(id || ''))) throw refus('Conversation introuvable.', 404);
  const lus = await q(
    `
      select id, center_id, titre, modele, nb_messages, updated_at, messages
        from assistant_conversations
       where id = $1 and member_id = any($2::text[])
       limit 1;
    `,
    [id, ids],
  );
  const ligne = lus.rows[0];
  if (!ligne) throw refus('Conversation introuvable.', 404);
  return { ...resume(ligne), messages: Array.isArray(ligne.messages) ? ligne.messages : [] };
}

// Le centre et le proprietaire d une conversation existante ne changent jamais, et une conversation
// d un autre proprietaire ne se recouvre pas : la mise a jour porte elle-meme la condition.
async function sauverConversation(q, ids, membre, centerId, brut) {
  const c = conversationValide(brut);
  const lus = await q(
    `
      insert into assistant_conversations (id, member_id, center_id, titre, modele, messages, nb_messages)
      values ($1, $2, $3, $4, $5, $6::jsonb, $7)
      on conflict (id) do update
        set titre = excluded.titre, modele = excluded.modele, messages = excluded.messages,
            nb_messages = excluded.nb_messages, updated_at = now()
        where assistant_conversations.member_id = any($8::text[])
      returning id, center_id, titre, modele, nb_messages, updated_at;
    `,
    [c.id, membre, centerId, c.titre, c.modele, c.json, c.messages.length, ids],
  );
  if (!lus.rows.length) throw refus('Conversation introuvable.', 404);
  return resume(lus.rows[0]);
}

async function supprimerConversation(q, ids, id) {
  if (!ID_CONVERSATION.test(String(id || ''))) throw refus('Conversation introuvable.', 404);
  const lus = await q('delete from assistant_conversations where id = $1 and member_id = any($2::text[]) returning id;', [id, ids]);
  if (!lus.rows.length) throw refus('Conversation introuvable.', 404);
  return { id };
}

// La reprise de ce qui etait sur l appareil : ajout seul, ce qui existe deja n est pas recouvert.
async function reprendreConversations(q, ids, membre, centerId, liste) {
  const reprises = [];
  for (const brut of (Array.isArray(liste) ? liste : []).slice(0, REPRISE_MAX)) {
    let c;
    try { c = conversationValide(brut); } catch (erreur) { continue; }
    const lus = await q(
      `
        insert into assistant_conversations (id, member_id, center_id, titre, modele, messages, nb_messages, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6::jsonb, $7, to_timestamp($8 / 1000.0), to_timestamp($8 / 1000.0))
        on conflict (id) do nothing
        returning id;
      `,
      [c.id, membre, String(brut.centerId || centerId), c.titre, c.modele, c.json, c.messages.length, Number(brut.maj) || Date.now()],
    );
    if (lus.rows.length) reprises.push(c.id);
  }
  return reprises;
}

// ---- Ce que l IA a appris ------------------------------------------------------------
function faitValide(brut) {
  const texte = nettoyer(brut).replace(/\s+/g, ' ');
  if (texte.length < FAIT_MIN) throw refus('Écrivez ce que l’IA doit retenir.');
  if (texte.length > FAIT_MAX) throw refus(`Un fait tient en ${FAIT_MAX} caractères au plus.`);
  return texte;
}

const fait = (r) => ({
  id: Number(r.id), texte: r.texte, origine: r.origine, contexte: r.contexte || '',
  par: r.appris_par_nom || '', le: enMs(r.created_at), modifiePar: r.modifie_par_nom || '', modifieLe: enMs(r.modifie_le),
});

async function listerFaits(q, centerId) {
  const lus = await q(
    `
      select id, texte, origine, contexte, appris_par_nom, modifie_par_nom, modifie_le, created_at
        from assistant_faits
       where center_id = $1 and retire_le is null
       order by created_at desc
       limit $2;
    `,
    [centerId, FAITS_LUS],
  );
  return lus.rows.map(fait);
}

// Ce qui entre dans le contexte du modele : borne en nombre et en caracteres, les plus recents d abord.
function faitsBornes(faits) {
  const gardes = [];
  let taille = 0;
  for (const f of faits) {
    if (gardes.length >= FAITS_DANS_LE_CONTEXTE) break;
    const coute = f.texte.length + 8;
    if (taille + coute > CONTEXTE_CARACTERES_MAX) break;
    taille += coute;
    gardes.push({ id: f.id, texte: f.texte });
  }
  return { faits: gardes, ecartes: faits.length - gardes.length };
}

async function faitsPourLeModele(q, centerId) {
  try {
    return faitsBornes(await listerFaits(q, centerId));
  } catch (erreur) {
    if (tableAbsente(erreur)) return { faits: [], ecartes: 0 };
    throw erreur;
  }
}

async function ajouterFait(q, { centerId, texte, origine, contexte, session }) {
  const propre = faitValide(texte);
  const genre = ORIGINES.has(origine) ? origine : 'panneau';
  const membre = (session && session.member) || {};
  const lus = await q(
    `
      insert into assistant_faits (center_id, texte, origine, contexte, appris_par_id, appris_par_nom)
      values ($1, $2, $3, $4, $5, $6)
      returning id, texte, origine, contexte, appris_par_nom, modifie_par_nom, modifie_le, created_at;
    `,
    [centerId, propre, genre, nettoyer(contexte).slice(0, 300), String(membre.id || ''), nettoyer(membre.name).slice(0, 80)],
  );
  return fait(lus.rows[0]);
}

async function modifierFait(q, { centerId, id, texte, session }) {
  const propre = faitValide(texte);
  const lus = await q(
    `
      update assistant_faits
         set texte = $3, modifie_par_nom = $4, modifie_le = now()
       where id = $1 and center_id = $2 and retire_le is null
       returning id, texte, origine, contexte, appris_par_nom, modifie_par_nom, modifie_le, created_at;
    `,
    [Number(id) || 0, centerId, propre, nettoyer(session && session.member && session.member.name).slice(0, 80)],
  );
  if (!lus.rows.length) throw refus('Ce fait n’existe plus.', 404);
  return fait(lus.rows[0]);
}

// Retire, jamais efface : ce que le centre a cru et qui l a enleve se retrouve.
async function retirerFait(q, { centerId, id, session }) {
  const lus = await q(
    `
      update assistant_faits
         set retire_le = now(), retire_par_nom = $3
       where id = $1 and center_id = $2 and retire_le is null
       returning id;
    `,
    [Number(id) || 0, centerId, nettoyer(session && session.member && session.member.name).slice(0, 80)],
  );
  if (!lus.rows.length) throw refus('Ce fait n’existe plus.', 404);
  return { id: Number(lus.rows[0].id) };
}

// ---- Ce que le modele propose de retenir ----------------------------------------------
// LA GARDE CONTRE L INJECTION. Un mail ou une note de client peut demander au modele de proposer
// quelque chose. Il ne peut proposer que ce que la personne a ecrit elle-meme dans cette
// conversation : la moitie au moins des mots qui comptent doit venir de ses messages. Ce qui vient
// d un client est donc refuse avant meme d arriver a la personne qui clique.
const sansAccents = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const motsQuiComptent = (t) => [...new Set((sansAccents(t).match(/[a-z0-9]+/g) || []).filter((m) => m.length >= 4 && !VIDES.has(m)))];
const VIDES = new Set(['dans', 'pour', 'avec', 'sans', 'tous', 'tout', 'toute', 'toutes', 'cette', 'cela', 'etre', 'avoir', 'sont', 'nous', 'vous', 'leur', 'leurs', 'quand', 'plus', 'moins', 'retiens', 'retenir', 'retenez', 'memorise', 'memorisez', 'souviens', 'souvenez', 'rappelle', 'rappelez', 'note', 'notez', 'apprends', 'apprenez', 'centre']);
const PART_MINIMALE = 0.5;

function propositionVientDeLaPersonne(texte, messagesDeLaPersonne) {
  const mots = motsQuiComptent(texte);
  if (!mots.length) return false;
  const dit = new Set(motsQuiComptent(messagesDeLaPersonne.join(' ')));
  return mots.filter((m) => dit.has(m)).length / mots.length >= PART_MINIMALE;
}

module.exports = {
  tableAbsente, idsDeLaPersonne,
  listerConversations, lireConversation, sauverConversation, supprimerConversation, reprendreConversations, conversationValide,
  listerFaits, faitsPourLeModele, faitsBornes, ajouterFait, modifierFait, retirerFait,
  propositionVientDeLaPersonne, CONVERSATION_OCTETS_MAX, FAIT_MAX, FAITS_DANS_LE_CONTEXTE, CONTEXTE_CARACTERES_MAX,
};
