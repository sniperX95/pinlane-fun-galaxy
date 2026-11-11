// L ASSISTANT DU CENTRE, POUR LE NAVIGATEUR (2026-11-08). Une question entre, la reponse sort au
// fil de l eau (text/event-stream) : les etapes, les sources, le texte, puis le bilan de verite.
const { readJson, sendError, sendJson, setCors } = require('../lib/http');
const { listCentersForSession } = require('../lib/center-scope');
const { requireStaffPermission, sessionHasPermission } = require('../lib/staff-auth');
const { actorFromSession, newRequestId, writeAuditLog } = require('../lib/audit-log');
const { isBudgetExhausted } = require('../lib/llm-budget');
const { getPool } = require('../lib/database');
const { creerContexte, PERMISSIONS_PAGE, sourcesDuCompte, voitLesClients } = require('../lib/assistant-outils');
const { bilan, MODELES, MODELE_PAR_DEFAUT, POSTE, repondre } = require('../lib/assistant-agent');
const memoire = require('../lib/assistant-memoire');

const MESSAGES_MAX = 40;
const QUESTION_MAX = 6000;
const CONVERSATION_MAX = 60000;
const CORPS_MAX_OCTETS = 2 * 1024 * 1024;
const QUESTIONS_PAR_FENETRE = 30;
const FENETRE_MS = 10 * 60 * 1000;
const recentes = new Map();

function tropDeQuestions(cle) {
  const maintenant = Date.now();
  const gardees = (recentes.get(cle) || []).filter((t) => maintenant - t < FENETRE_MS);
  if (gardees.length >= QUESTIONS_PAR_FENETRE) {
    recentes.set(cle, gardees);
    return true;
  }
  gardees.push(maintenant);
  recentes.set(cle, gardees);
  return false;
}

// Une conversation ne vient que du navigateur de ce gerant : on la borne, on ne lui fait pas
// confiance pour le perimetre (les droits se lisent sur la session). Les renvois [S3] d une
// ancienne reponse sont retires : chaque question a ses propres sources, S3 n y designe plus rien.
function messagesValides(brut) {
  if (!Array.isArray(brut) || !brut.length) return null;
  const propres = brut.slice(-MESSAGES_MAX)
    .map((m) => {
      const role = m && m.role === 'assistant' ? 'assistant' : 'user';
      const contenu = String((m && m.content) || '');
      return { role, content: role === 'assistant' ? contenu.replace(/\s*\[[SGF]\d+\]/g, '') : contenu };
    })
    .filter((m) => m.content.trim());
  if (!propres.length || propres[propres.length - 1].role !== 'user') return null;
  if (propres[propres.length - 1].content.length > QUESTION_MAX) return null;
  const gardes = [];
  let taille = 0;
  for (let i = propres.length - 1; i >= 0; i -= 1) {
    taille += propres[i].content.length;
    if (taille > CONVERSATION_MAX && gardes.length) break;
    gardes.unshift(propres[i]);
  }
  while (gardes.length && gardes[0].role !== 'user') gardes.shift();
  return gardes.length ? gardes : null;
}

// Les lectures deja faites dans la conversation : le navigateur ne renvoie que l outil et ses
// reglages. Rien de ce qu il envoie n est cru sur parole : le serveur refait chaque lecture avec les
// droits de la session (lib/assistant-agent.js), un outil que ce compte n a pas est ecarte la-bas.
const DOSSIER_LECTURES_MAX = 24;
function dossierValide(brut) {
  if (!Array.isArray(brut)) return [];
  const vues = new Set();
  const gardees = [];
  for (const l of brut.slice(-DOSSIER_LECTURES_MAX * 2)) {
    if (!l || typeof l !== 'object' || typeof l.outil !== 'string' || !/^[a-z_]{2,40}$/.test(l.outil)) continue;
    const entree = l.entree && typeof l.entree === 'object' && !Array.isArray(l.entree) ? l.entree : {};
    let cle = '';
    try { cle = `${l.outil} ${JSON.stringify(entree)}`; } catch (erreur) { continue; }
    if (cle.length > 2100 || vues.has(cle)) continue;
    vues.add(cle);
    gardees.push({ outil: l.outil, entree, empreinte: typeof l.empreinte === 'string' ? l.empreinte.slice(0, 16) : '' });
  }
  return gardees.slice(-DOSSIER_LECTURES_MAX);
}

function aujourdhuiBruxelles() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Le navigateur ne recoit que les noms des clients qui figurent dans cette reponse.
function identitesUtiles(ctx, texte) {
  const lu = `${texte} ${JSON.stringify(ctx.sources.map((s) => s.lignes))}`;
  return Object.fromEntries(Object.entries(ctx.identites).filter(([code, nom]) => lu.includes(code) || lu.includes(nom)));
}

async function centresDuClient(session, centreOuvert) {
  const lus = await listCentersForSession(getPool(), session).catch(() => []);
  const tous = (Array.isArray(lus) ? lus : []).filter((c) => c && c.id && c.id !== 'all');
  const ouvert = tous.find((c) => c.id === centreOuvert);
  // Un compte plateforme voit tous les centres : la conversation reste chez le client du centre ouvert.
  const memeClient = ouvert && ouvert.clientId ? tous.filter((c) => c.clientId === ouvert.clientId) : tous;
  const centres = memeClient.slice(0, 20).map((c) => ({ id: c.id, name: c.name || c.id }));
  if (!centres.some((c) => c.id === centreOuvert)) centres.unshift({ id: centreOuvert, name: centreOuvert });
  return centres;
}

// ---- Les conversations de la personne et ce que le centre a appris ------------------------------
const requeteBase = (texte, parametres) => getPool().query(texte, parametres);

const journal = (session, action, entityId, context = {}) => writeAuditLog({
  centerId: session.authorizedCenterId,
  ...actorFromSession(session),
  surface: 'api/assistant.js',
  action,
  method: 'POST',
  entityType: 'assistant_fait',
  entityId: String(entityId || ''),
  outcome: 'success',
  changes: {},
  context,
  requestId: newRequestId(),
}).catch(() => {});

function centrePrecis(session, res) {
  const centre = session.authorizedCenterId;
  if (!centre || centre === 'all') {
    sendError(res, 422, 'Choisissez un centre.');
    return '';
  }
  return centre;
}

// Le centre d une conversation reprise de l appareil passe par la meme porte que le reste.
async function centresPermis(req, centres) {
  const muet = { statusCode: 200, setHeader() {}, getHeader() {}, end() {}, write() {} };
  const permis = new Set();
  for (const centre of [...new Set(centres.filter(Boolean))].slice(0, 12)) {
    // eslint-disable-next-line no-await-in-loop
    const s = await requireStaffPermission(req, muet, PERMISSIONS_PAGE, { centerId: centre }).catch(() => null);
    if (s) permis.add(centre);
  }
  return permis;
}

async function agir(req, res, body, session) {
  const action = String(body.action);
  const q = requeteBase;
  try {
    switch (action) {
      case 'conversations': {
        const ids = await memoire.idsDeLaPersonne(q, session);
        sendJson(res, 200, { ok: true, stockage: 'serveur', conversations: await memoire.listerConversations(q, ids) });
        return;
      }
      case 'conversation': {
        const ids = await memoire.idsDeLaPersonne(q, session);
        sendJson(res, 200, { ok: true, conversation: await memoire.lireConversation(q, ids, body.id) });
        return;
      }
      case 'sauver': {
        const centre = centrePrecis(session, res);
        if (!centre) return;
        const ids = await memoire.idsDeLaPersonne(q, session);
        sendJson(res, 200, { ok: true, conversation: await memoire.sauverConversation(q, ids, session.member.id, centre, body.conversation) });
        return;
      }
      case 'supprimer': {
        const ids = await memoire.idsDeLaPersonne(q, session);
        sendJson(res, 200, { ok: true, ...(await memoire.supprimerConversation(q, ids, body.id)) });
        return;
      }
      case 'reprendre': {
        const centre = centrePrecis(session, res);
        if (!centre) return;
        const liste = Array.isArray(body.conversations) ? body.conversations : [];
        const permis = await centresPermis(req, liste.map((c) => c && c.centerId));
        const ids = await memoire.idsDeLaPersonne(q, session);
        sendJson(res, 200, { ok: true, reprises: await memoire.reprendreConversations(q, ids, session.member.id, centre, liste.filter((c) => c && (!c.centerId || permis.has(c.centerId)))) });
        return;
      }
      case 'savoir': {
        const centre = centrePrecis(session, res);
        if (!centre) return;
        try {
          sendJson(res, 200, { ok: true, disponible: true, faits: await memoire.listerFaits(q, centre) });
        } catch (erreur) {
          if (!memoire.tableAbsente(erreur)) throw erreur;
          sendJson(res, 200, { ok: true, disponible: false, faits: [] });
        }
        return;
      }
      case 'savoir.ajouter': {
        const centre = centrePrecis(session, res);
        if (!centre) return;
        const fait = await memoire.ajouterFait(q, { centerId: centre, texte: body.texte, origine: body.origine, contexte: body.contexte, session });
        journal(session, 'assistantFaitAjoute', fait.id, { origine: fait.origine });
        sendJson(res, 200, { ok: true, fait });
        return;
      }
      case 'savoir.modifier': {
        const centre = centrePrecis(session, res);
        if (!centre) return;
        const fait = await memoire.modifierFait(q, { centerId: centre, id: body.id, texte: body.texte, session });
        journal(session, 'assistantFaitModifie', fait.id);
        sendJson(res, 200, { ok: true, fait });
        return;
      }
      case 'savoir.retirer': {
        const centre = centrePrecis(session, res);
        if (!centre) return;
        const retire = await memoire.retirerFait(q, { centerId: centre, id: body.id, session });
        journal(session, 'assistantFaitRetire', retire.id);
        sendJson(res, 200, { ok: true, ...retire });
        return;
      }
      default:
        sendError(res, 400, 'Action inconnue.');
    }
  } catch (erreur) {
    // Table absente : le geste attend la migration, la page reste utilisable sur l appareil.
    if (memoire.tableAbsente(erreur)) {
      if (action.startsWith('savoir')) sendError(res, 503, "L'apprentissage attend la mise à jour de la base.");
      else sendJson(res, 200, { ok: true, stockage: 'appareil' });
      return;
    }
    if (erreur && erreur.expose) { sendError(res, erreur.statusCode || 400, erreur.message); return; }
    throw erreur;
  }
}

module.exports = async (req, res) => {
  setCors(res, 'POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    sendError(res, 405, 'Méthode non autorisée.');
    return;
  }

  let enFlux = false;
  try {
    const body = await readJson(req, { maxBytes: CORPS_MAX_OCTETS });
    const session = await requireStaffPermission(req, res, PERMISSIONS_PAGE, { centerId: body.centerId || '' });
    if (!session) return;
    if (body.action) { await agir(req, res, body, session); return; }
    const centreOuvert = session.authorizedCenterId;
    if (!centreOuvert || centreOuvert === 'all') {
      sendError(res, 422, "Choisissez un centre pour parler à l'assistant.");
      return;
    }
    const messages = messagesValides(body.messages);
    if (!messages) {
      sendError(res, 400, 'Votre message est vide ou trop long.');
      return;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      sendError(res, 503, "L'assistant n'est pas encore branché.");
      return;
    }
    if (isBudgetExhausted(POSTE)) {
      sendError(res, 429, "Le plafond mensuel de l'assistant est atteint.");
      return;
    }
    const membre = (session.member && session.member.id) || 'centre';
    if (tropDeQuestions(`${centreOuvert}:${membre}`)) {
      sendError(res, 429, "Trop de questions d'un coup. Réessayez dans quelques minutes.");
      return;
    }
    const modele = Object.prototype.hasOwnProperty.call(MODELES, body.modele) ? body.modele : MODELE_PAR_DEFAUT;
    const centres = await centresDuClient(session, centreOuvert);
    const ctx = creerContexte({ req, session, centres, aujourdhui: aujourdhuiBruxelles(), messagesPersonne: messages.filter((m) => m.role === 'user').map((m) => m.content) });
    ctx.centreOuvert = centreOuvert;
    // Lu a chaque question : ce qu un collegue vient d apprendre sert tout de suite.
    const savoir = await memoire.faitsPourLeModele(requeteBase, centreOuvert);
    // CE QUE LE CENTRE A APPRIS AILLEURS (2026-11-11, Ansar : « qu elles connaissent tout du centre ») : les
    // faits appris a l agent des mails et les regles retenues dans les demandes sur mesure. Le centre
    // ouvert seulement ; leur numero ne croise jamais celui d un fait de l assistant.
    // Une simple lecture : la fonction de l agent des mails cree sa table et importe un fichier, et l assistant n ecrit jamais.
    const appris = centreOuvert && centreOuvert !== 'all'
      ? ((await requeteBase('select id, question, reponse from agent_facts where center_id = $1 and oublie_le is null order by updated_at desc, id desc limit 30;', [centreOuvert]).catch(() => ({ rows: [] }))).rows || [])
      : [];
    savoir.faits = [...savoir.faits, ...appris.filter((f) => f && f.question && f.reponse).slice(0, 30)
      .map((f) => ({ id: 900000 + Number(f.id || 0), texte: `${String(f.question).slice(0, 160)} : ${String(f.reponse).slice(0, 400)}`, origine: 'equipe' }))];
    ctx.faits = savoir.faits;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    enFlux = true;
    const coupure = new AbortController();
    // Sur res et pas sur req : req se ferme des que le corps est lu.
    res.on('close', () => { if (!res.writableEnded) coupure.abort(); });
    const emettre = (type, donnees) => {
      if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify(donnees)}\n\n`);
    };
    // Un commentaire toutes les 15 s : un fil muet pendant un long calcul ne se fait pas couper.
    const pouls = setInterval(() => { if (!res.writableEnded) res.write(': pouls\n\n'); }, 15000);

    let resultat = null;
    try {
      emettre('debut', { modele: MODELES[modele].nom, centres, sources: sourcesDuCompte(session) });
      const personne = { nom: (session.member && session.member.name) || '', role: (session.role && session.role.name) || '' };
      resultat = await repondre({ modele, messages, ctx, centreOuvert, montants: sessionHasPermission(session, 'payments.view'), clients: voitLesClients(session), personne, sourcesLisibles: sourcesDuCompte(session).map((s) => s.nom), dossier: dossierValide(body.dossier), savoir, emettre, signal: coupure.signal });
      const fin = resultat.refus ? { texte: resultat.texte, verite: null } : bilan(resultat.texte, ctx);
      emettre('fin', { ...fin, identites: identitesUtiles(ctx, fin.texte), modele: resultat.modele, ...(resultat.corrige ? { corrige: resultat.corrige } : {}) });
    } finally {
      clearInterval(pouls);
    }
    // La question elle-meme n entre pas au journal : seul le fait qu elle a ete posee.
    writeAuditLog({
      centerId: centreOuvert,
      ...actorFromSession(session),
      surface: 'api/assistant.js',
      action: 'assistantQuestion',
      method: 'POST',
      entityType: 'assistant',
      entityId: '',
      outcome: 'success',
      changes: {},
      context: { modele, tours: resultat.tours, appelsOutils: resultat.appelsOutils, coutUsd: Math.round(resultat.cout * 10000) / 10000 },
      requestId: newRequestId(),
    }).catch(() => {});
    res.end();
  } catch (error) {
    if (!enFlux) {
      sendError(res, error.statusCode || 500, error.expose ? error.message : "L'assistant est indisponible pour le moment.");
      return;
    }
    if (!res.writableEnded) {
      const interrompu = error && error.name === 'APIUserAbortError';
      if (!interrompu) res.write(`event: erreur\ndata: ${JSON.stringify({ message: error && error.expose ? error.message : "L'assistant a été interrompu. Réessayez." })}\n\n`);
      res.end();
    }
  }
};
