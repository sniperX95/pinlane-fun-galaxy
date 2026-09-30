// Retrait de la liste marketing : jeton, stockage, filtrage a l'envoi, page
// publique de confirmation.
//
// ============================================================================
// POURQUOI CE MODULE EXISTE
// ============================================================================
// Un destinataire qui ne trouve pas comment se desinscrire clique sur SPAM, et
// une plainte abime la reputation du domaine pour TOUS les mails, confirmations
// de reservation comprises. Le lien de retrait n'est donc pas une case
// reglementaire a cocher : c'est une protection de la delivrabilite des
// TRANSACTIONNELS.
//
// ============================================================================
// LA SEPARATION QUI PRIME SUR TOUT
// ============================================================================
// Lien de retrait et en-tete List-Unsubscribe UNIQUEMENT sur les mails
// MARKETING (campagnes, anniversaire J-30, reactivation, sequences
// personnalisees). JAMAIS sur un transactionnel : un lien de desabonnement est
// un signal de mail de masse, le poser sur une confirmation de reservation la
// pousse vers l'onglet Promotions, et n'a aucun sens (on ne se desabonne pas de
// sa propre confirmation). Profil mesure des transactionnels a preserver :
// 0,4 lien par mail, 1 image (le logo), 11,5 Ko.
// Gate : scripts/unsubscribe-separation-check.js, dans les DEUX sens.
//
// ============================================================================
// LE JETON : EMPREINTE DETERMINISTE, STOCKEE A L'ENVOI
// ============================================================================
// Contrainte de securite qui a decide de la forme : la route est PUBLIQUE et
// ne doit JAMAIS accepter une adresse email fournie dans l'URL. Sans cela, la
// route devient (a) un outil pour desinscrire n'importe qui, (b) un oracle
// pour tester quelles adresses existent.
//
// Cette contrainte elimine le montage « payload signe dans l'URL »
// (?u=base64(centre|email)&k=hmac) : le MAC empeche la forge, mais l'adresse
// voyage quand meme en clair dans une URL, donc dans l'historique du
// navigateur, les journaux de proxy et le referrer. On ne peut pas a la fois
// n'avoir aucune identite dans l'URL et resoudre le jeton sans le lire quelque
// part : il faut donc une lecture serveur.
//
// Forme retenue, qui prend le meilleur des deux :
//   token = HMAC-SHA256(UNSUBSCRIBE_SECRET, "v1:<centre>:<email normalise>")
//           tronque a 128 bits (32 hex)
//   stocke a l'enfilement dans communications.payload.unsubToken
//   resolu par egalite exacte, exactement comme le reviewToken du bouton
//   « avis Google » (lib/marketing-roi.js resolveReviewClick), qui est le
//   patron de lien public tracke deja eprouve ici.
//
// Ce que chaque moitie apporte :
//   - DETERMINISTE : la meme adresse chez le meme centre donne toujours le meme
//     lien. Rien a provisionner a l'avance, aucune table de jetons, et re-jouer
//     une campagne ne multiplie pas les jetons vivants pour un meme client.
//   - STOCKE : l'URL ne porte que 32 caracteres opaques. Aucune adresse, aucun
//     centre, rien d'enumerable (128 bits), et la resolution donne le centre
//     depuis la LIGNE STOCKEE, jamais depuis la requete : c'est ce qui scope
//     l'ecriture au bon centre sans faire confiance au client.
//
// SECRET : UNSUBSCRIBE_SECRET. S'il est ABSENT de l'environnement, on ne
// desactive pas le lien (un mail marketing sans porte de sortie est exactement
// le probleme qu'on repare) et on ne retombe surtout pas sur une valeur
// devinable : on tire 128 bits aleatoires par envoi. Le lien reste valide
// puisqu'il est stocke ; il perd seulement sa stabilite entre deux mails.
// Meme comportement si le secret est trop court pour etre serieux (< 32
// caracteres) : un secret faible rendrait les jetons calculables par qui
// connait l'adresse.

const crypto = require('crypto');

// Longueur minimale d'un secret qu'on accepte de considerer comme un secret.
// En dessous, l'empreinte serait reconstructible par force brute par qui
// connait le couple (centre, adresse) : on prefere l'aleatoire assume.
const MIN_SECRET_LENGTH = 32;

const TOKEN_RX = /^[0-9a-f]{32}$/;
// 'form' (2026-09-30) : la case « Je ne souhaite pas recevoir les offres »
// cochee a la reservation en ligne (migration 0050).
const SOURCES = ['link', 'staff', 'complaint', 'form'];

function defaultDeps() {
  const { getPool, withTransaction } = require('./database');
  return {
    query: (text, params) => getPool().query(text, params),
    transaction: (run) => withTransaction((client) => run({ query: client.query.bind(client) })),
  };
}

// Same definition at withdrawal and conditional dispatch, including old rows
// created before unsubscribe tokens were introduced. Service emails stay out.
function marketingCommunicationSql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `(${prefix}channel = 'email' and ${prefix}direction = 'outbound' and (
    coalesce(${prefix}payload->>'unsubToken', '') <> ''
    or coalesce(${prefix}template_id, '') in ('birthday_j30', 'reactivation')
    or left(coalesce(${prefix}template_id, ''), 9) = 'campaign_'
    or left(coalesce(${prefix}template_id, ''), 7) = 'custom_'
  ))`;
}

function marketingDispatchLock(centerId, email) {
  return `communication-marketing:${normalizeCenterId(centerId)}:${normalizeEmail(email)}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeCenterId(value = '') {
  return String(value || '').trim().toLowerCase();
}

// Base publique de l'app (memes regles que lib/ops-jobs.js pour le lien avis) :
// les liens doivent marcher meme sans variable dediee, et le repli est le
// domaine de la PLATEFORME, jamais celui d'un client.
function publicBaseUrl() {
  return String(process.env.PUBLIC_APP_URL || 'https://app.pinlane.be').replace(/\/$/, '');
}

function usableSecret() {
  const secret = String(process.env.UNSUBSCRIBE_SECRET || '').trim();
  return secret.length >= MIN_SECRET_LENGTH ? secret : '';
}

// Empreinte 128 bits. Deterministe quand le secret est utilisable, aleatoire
// sinon (cf. en-tete : jamais de repli devinable, jamais de lien absent).
function unsubscribeToken(centerId = '', email = '') {
  const secret = usableSecret();
  const center = normalizeCenterId(centerId);
  const address = normalizeEmail(email);
  if (!secret || !center || !address) return crypto.randomBytes(16).toString('hex');
  return crypto
    .createHmac('sha256', secret)
    .update(`v1:${center}:${address}`)
    .digest('hex')
    .slice(0, 32);
}

function unsubscribeUrl(token = '') {
  return `${publicBaseUrl()}/api/u?k=${String(token || '')}`;
}

// Phrase de pied de page des mails MARKETING. Elle dit POURQUOI le client
// recoit ce message (c'est ce qui evite le reflexe SPAM) et ou cliquer.
const UNSUBSCRIBE_SENTENCE = 'Vous recevez ce message parce que vous avez deja reserve chez nous.';
const UNSUBSCRIBE_LABEL = 'Ne plus recevoir nos actualites';

// Tout ce dont un appelant marketing a besoin, en un appel :
// { token, url, line, label, textLine }.
// `textLine` part dans l'alternative texte : un lecteur qui n'affiche pas le
// HTML doit avoir la meme porte de sortie, sinon il ne lui reste que SPAM.
function buildUnsubscribe(centerId = '', email = '') {
  const token = unsubscribeToken(centerId, email);
  const url = unsubscribeUrl(token);
  return {
    token,
    url,
    line: UNSUBSCRIBE_SENTENCE,
    label: UNSUBSCRIBE_LABEL,
    textLine: `${UNSUBSCRIBE_SENTENCE} ${UNSUBSCRIBE_LABEL} : ${url}`,
  };
}

/* ==========================================================================
   FILTRAGE A L'ENVOI
   Le filtre vit au POINT D'ENFILEMENT, pas dans l'interface : une campagne
   relancee par le cron passe par les memes fonctions et filtre donc aussi.
   ========================================================================== */

// -> Set des adresses (normalisees) exclues pour ce centre, parmi celles
// demandees. Une seule requete par lot, servie par l'index unique.
// ERREUR DB : on LEVE, on ne rend PAS un Set vide. Une premiere version faisait
// l'inverse, en argumentant qu'un envoi bloque coutait plus cher qu'une lecture
// ratee. L'asymetrie est en realite dans l'autre sens, et elle est nette :
//   - fail-open : un desinscrit recoit du marketing -> il clique SPAM -> la
//     reputation du domaine est abimee pour TOUS les mails, confirmations de
//     reservation comprises. C'est exactement le dommage que cette
//     fonctionnalite existe pour empecher. Mesure a l'appui : une erreur DB
//     passagere pendant une campagne renvoyait a TOUTE l'audience, desinscrits
//     inclus ("queued 1 skipped 0").
//   - fail-closed : la campagne est retardee le temps de l'incident. Agacant,
//     sans dommage durable, et visible immediatement.
// L'argument "la table n'existe pas tant que 0030 n'est pas jouee" est un
// probleme d'ORDRE DE DEPLOIEMENT (jouer la migration avant le code), pas une
// raison d'affaiblir la garantie pour toujours.
// L'erreur est exposable : l'appelant humain doit comprendre pourquoi son envoi
// ne part pas. Les 4 envois marketing propagent, donc rien ne part.
async function listSuppressedSet(centerId = '', emails = [], deps = defaultDeps()) {
  const center = normalizeCenterId(centerId);
  const wanted = [...new Set((emails || []).map(normalizeEmail).filter(Boolean))];
  if (!center || !wanted.length) return new Set();
  try {
    const result = await deps.query(
      `select lower(email) as email
       from marketing_suppressions
       where center_id = $1 and lower(email) = any($2::text[]);`,
      [center, wanted],
    );
    return new Set((result.rows || []).map((row) => normalizeEmail(row.email)));
  } catch (cause) {
    const error = new Error("Liste de desinscription illisible : aucun envoi marketing n'est parti. Reessayez dans un moment.");
    error.expose = true;
    error.statusCode = 503;
    error.cause = cause;
    throw error;
  }
}

async function isSuppressed(centerId = '', email = '', deps = defaultDeps()) {
  const set = await listSuppressedSet(centerId, [email], deps);
  return set.has(normalizeEmail(email));
}

/* ==========================================================================
   ECRITURES
   ========================================================================== */

// Upsert sur le conflit (centre, adresse en minuscules) : un double clic ne
// cree pas deux lignes et ne deplace pas la date d'origine du retrait.
async function suppressEmail({ centerId, email, source = 'link', reason = '' } = {}, deps = defaultDeps()) {
  const center = normalizeCenterId(centerId);
  const address = normalizeEmail(email);
  const origin = SOURCES.includes(source) ? source : 'link';
  if (!center || !address.includes('@')) {
    const error = new Error('Adresse invalide.');
    error.expose = true;
    error.statusCode = 400;
    throw error;
  }
  const run = async (tx) => {
    // Separate statements are intentional: after waiting on the lock, the
    // decision must use a fresh READ COMMITTED snapshot.
    await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0));', [marketingDispatchLock(center, address)]);
    const result = await tx.query(
      `insert into marketing_suppressions (center_id, email, source, reason)
       values ($1, $2, $3, $4)
       on conflict (center_id, lower(email)) do nothing
       returning id, center_id, email, source, reason, created_at;`,
      [center, address, origin, String(reason || '').slice(0, 500)],
    );
    await tx.query(
      `update communications set status = 'cancelled', locked_at = null,
         next_retry_at = null, last_error = 'marketing_suppressed'
       where center_id = $1 and lower(recipient) = $2
         and status in ('draft', 'queued', 'processing')
         and coalesce(payload->>'dispatchCommittedAt', '') = ''
         and ${marketingCommunicationSql()}
       returning id;`,
      [center, address],
    );
    return result;
  };
  const result = deps.transaction ? await deps.transaction(run) : await run(deps);
  // Aucune ligne rendue = elle existait deja. C'est un succes du point de vue
  // du client (il ne recevra plus rien), pas une erreur a lui montrer.
  return { ok: true, email: address, centerId: center, created: Boolean(result.rowCount) };
}

// Retour en arriere : le client s'est trompe de clic, ou il redemande a
// recevoir depuis la console. Scope centre obligatoire.
async function removeSuppression({ centerId, email } = {}, deps = defaultDeps()) {
  const center = normalizeCenterId(centerId);
  const address = normalizeEmail(email);
  if (!center || !address) {
    const error = new Error('Adresse invalide.');
    error.expose = true;
    error.statusCode = 400;
    throw error;
  }
  const result = await deps.query(
    `delete from marketing_suppressions
     where center_id = $1 and lower(email) = $2
     returning id;`,
    [center, address],
  );
  return { ok: true, email: address, centerId: center, removed: Boolean(result.rowCount) };
}

// LE CHOIX FAIT A LA RESERVATION EN LIGNE (Movsar, 2026-09-30). Appele DANS
// la transaction qui cree la reservation : la reservation et le choix sont
// enregistres ensemble ou pas du tout.
//   refuse : la case cochee -> retrait 'form', le numero de la reservation en
//            raison. Deja retire (par lien, par l equipe...) : rien ne change.
//   sinon  : une nouvelle reservation SANS la case leve un retrait pose par la
//            MEME case (le client l avait sous les yeux et ne l a pas cochee :
//            « s ils refont une reservation et laissent, ca change »). Un
//            retrait par lien, par l equipe ou par plainte ne se leve jamais
//            ainsi : une opposition explicite ne s annule pas par une case
//            laissee vide.
// Les TRANSACTIONNELS (confirmation, rappel, apres la visite) ne lisent jamais
// cette liste : ils partent quel que soit le choix.
async function appliquerChoixDeReservation({ centerId, email, refuse = false, reservationId = null } = {}, deps = defaultDeps()) {
  const center = normalizeCenterId(centerId);
  const address = normalizeEmail(email);
  if (!center || !address.includes('@')) return { ok: false, etat: 'sans-adresse' };
  if (refuse === true) {
    const numero = Number.isFinite(Number(reservationId)) && Number(reservationId) > 0 ? `n° ${Math.trunc(Number(reservationId))}` : 'en ligne';
    const pose = await suppressEmail({ centerId: center, email: address, source: 'form', reason: `Case cochée à la réservation ${numero} (formulaire en ligne).` }, deps);
    return { ok: true, etat: pose.created ? 'refuse' : 'deja-retire' };
  }
  const leve = await deps.query(
    `delete from marketing_suppressions
     where center_id = $1 and lower(email) = $2 and source = 'form'
     returning id;`,
    [center, address],
  );
  return { ok: true, etat: leve.rowCount ? 'leve' : 'inchange' };
}

async function listSuppressions(centerId = '', { limit = 200 } = {}, deps = defaultDeps()) {
  const center = normalizeCenterId(centerId);
  if (!center) return { centerId: center, total: 0, entries: [] };
  try {
    const result = await deps.query(
      `select email, source, reason, created_at
       from marketing_suppressions
       where center_id = $1
       order by created_at desc
       limit $2;`,
      [center, Math.max(1, Math.min(1000, Number(limit) || 200))],
    );
    const entries = (result.rows || []).map((row) => ({
      email: row.email,
      source: row.source,
      reason: row.reason || '',
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ''),
    }));
    return { centerId: center, total: entries.length, entries };
  } catch (error) {
    return { centerId: center, total: 0, entries: [] };
  }
}

/* ==========================================================================
   RESOLUTION DU JETON PUBLIC
   ========================================================================== */

// Le jeton est la SEULE entree. Le centre et l'adresse viennent de la ligne
// STOCKEE, jamais de la requete : c'est ce qui empeche a la fois la
// desinscription d'un tiers et le test d'existence d'une adresse.
// Jeton mal forme -> null sans aucune requete (pas d'oracle de temps de
// reponse sur une forme invalide).
async function resolveUnsubscribeToken(token = '', deps = defaultDeps()) {
  const clean = String(token || '').trim().toLowerCase();
  if (!TOKEN_RX.test(clean)) return null;
  const result = await deps.query(
    `select center_id, recipient
     from communications
     where payload->>'unsubToken' = $1
     order by id desc
     limit 1;`,
    [clean],
  );
  const row = (result.rows || [])[0];
  const centerId = normalizeCenterId(row?.center_id);
  const email = normalizeEmail(row?.recipient);
  if (!centerId || !email) return null;
  return { centerId, email };
}

/* ==========================================================================
   PAGE PUBLIQUE DE CONFIRMATION
   Vue par le CLIENT FINAL d'un centre : le bandeau porte le NOM du centre
   resolu depuis le jeton (jamais une marque ecrite en dur), et disparait
   quand le jeton ne resout aucun centre. Tout ce qui s'affiche passe par
   escapeHtml.
   ========================================================================== */

// Palette NEUTRE : cette page est servie pour n'importe quel centre, la
// couleur de marque d'un client n'y est jamais ecrite (purge 2026-08-15). Le
// bouton « Me reinscrire » repose sur l'encre, comme le bouton des emails.
const PAGE_THEME = {
  black: '#000000',
  paper: '#F1EFF2',
  card: '#FFFFFF',
  ink: '#1A1A1A',
  inkSoft: '#5A5A5A',
  border: '#E2DFE4',
  font: "'Montserrat','Segoe UI',Helvetica,Arial,sans-serif",
};

// state : 'removed' (retrait effectue), 'restored' (retour en arriere fait),
// 'invalid' (jeton inconnu ou mal forme), 'busy' (rate limit).
// L'adresse n'est JAMAIS rendue quand le jeton est invalide : afficher quoi que
// ce soit de nominatif la transformerait la page en oracle d'existence.
function renderUnsubscribePage({ state = 'invalid', email = '', token = '', centerName = '' } = {}) {
  const showsAddress = state === 'removed' || state === 'restored';
  const address = showsAddress ? normalizeEmail(email) : '';
  const safeToken = TOKEN_RX.test(String(token || '')) ? String(token) : '';
  const safeCenterName = String(centerName || '').trim();

  const COPY = {
    removed: {
      title: 'C est fait',
      lead: address
        ? `L adresse ${address} ne recevra plus nos actualites, nos offres ni nos rappels d anniversaire.`
        : 'Cette adresse ne recevra plus nos actualites, nos offres ni nos rappels d anniversaire.',
      note: 'Vous continuerez a recevoir les messages lies a vos reservations : confirmation, rappel avant votre venue, information en cas de changement. Ce sont des messages de service, pas des messages commerciaux.',
    },
    restored: {
      title: 'Vous etes de retour',
      lead: address
        ? `L adresse ${address} recevra de nouveau nos actualites.`
        : 'Cette adresse recevra de nouveau nos actualites.',
      note: 'Vous pouvez vous retirer a nouveau a tout moment depuis le lien present en bas de chacun de nos messages.',
    },
    invalid: {
      title: 'Lien expire ou inconnu',
      lead: 'Ce lien n est plus valide. Aucune modification n a ete effectuee.',
      note: 'Ouvrez le lien present en bas du dernier message que vous avez recu, ou repondez simplement a ce message : quelqu un s en occupe a la main.',
    },
    // ETAT DISTINCT DE 'invalid', ET LA DISTINCTION COMPTE. Le jeton etait bon,
    // c'est NOTRE serveur qui n a pas pu ecrire. Renvoyer "lien expire" ferait
    // porter au client la faute d une panne qui n est pas la sienne, et il
    // n aurait aucune raison de reessayer. Rendu avec un statut 503, jamais 2xx :
    // un 2xx signifie "desinscription effectuee" pour la messagerie.
    error: {
      title: 'Nous n avons pas pu enregistrer votre demande',
      lead: 'Votre lien est valide, mais notre systeme est momentanement indisponible. Rien n a ete modifie.',
      note: 'Reessayez dans quelques minutes en rouvrant ce meme lien. Si cela persiste, repondez simplement au message que vous avez recu : nous vous retirons a la main.',
    },
    busy: {
      title: 'Un instant',
      lead: 'Trop de demandes ont ete recues depuis cette connexion. Aucune modification n a ete effectuee.',
      note: 'Reessayez dans une minute en rouvrant le lien de votre message.',
    },
  };
  const copy = COPY[state] || COPY.invalid;

  // Le retour en arriere est un FORMULAIRE POST, pas un lien.
  // Deux raisons : (1) les scanners de securite des messageries (Safe Links,
  // proxys d'images) suivent les GET tout seuls, un GET d'annulation pourrait
  // donc se declencher sans personne ; (2) la CSP du site autorise
  // form-action 'self', donc rien a assouplir.
  const undo = state === 'removed' && safeToken
    ? `<form method="post" action="/api/u?k=${escapeHtml(safeToken)}" style="margin:26px 0 0;">
         <input type="hidden" name="a" value="resubscribe">
         <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${PAGE_THEME.inkSoft};">Vous avez clique par erreur ?</p>
         <button type="submit" style="display:inline-block;border:0;cursor:pointer;background:${PAGE_THEME.ink};color:#FFFFFF;font-family:${PAGE_THEME.font};font-size:15px;font-weight:700;letter-spacing:0.4px;padding:14px 26px;border-radius:999px;">Me reinscrire</button>
       </form>`
    : '';

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>${escapeHtml(safeCenterName ? `${copy.title} | ${safeCenterName}` : copy.title)}</title>
    <style>
      body { margin:0; padding:0; background:${PAGE_THEME.paper}; font-family:${PAGE_THEME.font}; color:${PAGE_THEME.ink}; -webkit-font-smoothing:antialiased; }
      .wrap { max-width:560px; margin:0 auto; padding:40px 20px 64px; }
      .band { background:${PAGE_THEME.black}; border-radius:16px; padding:26px 20px; text-align:center; }
      .band p { margin:0; font-size:15px; line-height:1.3; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#FFFFFF; }
      .card { background:${PAGE_THEME.card}; border:1px solid ${PAGE_THEME.border}; border-radius:16px; padding:34px 26px; margin-top:22px; }
      h1 { margin:0 0 18px; font-size:26px; line-height:1.15; font-weight:700; text-transform:uppercase; letter-spacing:0; }
      .lead { margin:0 0 16px; font-size:16px; line-height:1.65; }
      .note { margin:0; padding-top:18px; border-top:1px solid ${PAGE_THEME.border}; font-size:14px; line-height:1.65; color:${PAGE_THEME.inkSoft}; }
      @media (max-width:480px) { h1 { font-size:22px; } .wrap { padding:24px 16px 48px; } }
    </style>
  </head>
  <body>
    <div class="wrap">
      ${safeCenterName ? `<div class="band"><p>${escapeHtml(safeCenterName)}</p></div>` : ''}
      <div class="card">
        <h1>${escapeHtml(copy.title)}</h1>
        <p class="lead">${escapeHtml(copy.lead)}</p>
        ${undo}
        <p class="note">${escapeHtml(copy.note)}</p>
      </div>
    </div>
  </body>
</html>`;
}

module.exports = {
  appliquerChoixDeReservation,
  marketingCommunicationSql,
  marketingDispatchLock,
  MIN_SECRET_LENGTH,
  SOURCES,
  UNSUBSCRIBE_SENTENCE,
  UNSUBSCRIBE_LABEL,
  normalizeEmail,
  publicBaseUrl,
  unsubscribeToken,
  unsubscribeUrl,
  buildUnsubscribe,
  listSuppressedSet,
  isSuppressed,
  suppressEmail,
  removeSuppression,
  listSuppressions,
  resolveUnsubscribeToken,
  renderUnsubscribePage,
};
