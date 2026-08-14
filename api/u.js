// Retrait de la liste marketing. Route PUBLIQUE, sur le modele du lien avis
// (api/r.js) : le jeton (128 bits, empreinte HMAC ou aleatoire, cf.
// lib/marketing-suppression.js) est la SEULE entree. Le centre et l'adresse
// viennent de la ligne STOCKEE de la communication, jamais de la requete :
//   - impossible de desinscrire un tiers en glissant son adresse dans l'URL ;
//   - impossible de tester si une adresse existe (aucune adresse en entree,
//     et un jeton inconnu rend le meme message neutre qu'un jeton mal forme).
//
// GET  /api/u?k=<token>  -> inscrit l'adresse dans la liste (un clic suffit) et
//                           rend la page de confirmation avec un bouton d'annulation.
// POST /api/u?k=<token>  -> deux corps possibles :
//   * List-Unsubscribe=One-Click (RFC 8058) : le bouton natif « Se desabonner »
//     de Gmail/Outlook, declenche par l'en-tete List-Unsubscribe pose sur les
//     mails marketing. Inscrit et rend un 200 minimal.
//   * a=resubscribe : le bouton « Me reinscrire » de la page de confirmation.
//     Retire l'adresse de la liste (retour en arriere).
//
// Le retrait via GET est un choix assume : un clic doit suffire (pas de
// formulaire, pas de connexion). Le risque d'un scanner de messagerie qui
// pre-charge le lien est borne : l'action ne coupe QUE le marketing (jamais un
// transactionnel), et elle est reversible en un clic depuis la page meme. Le
// retour en arriere, lui, est en POST pour qu'aucun scanner ne le declenche
// tout seul.
const {
  resolveUnsubscribeToken,
  suppressEmail,
  removeSuppression,
  renderUnsubscribePage,
} = require('../lib/marketing-suppression');
const { enforceRateLimit } = require('../lib/rate-limit');
const { getCenter } = require('../lib/ops-knowledge');

// Le NOM du centre resolu depuis le jeton : c'est lui qui signe la page de
// confirmation. Inconnu = page neutre, jamais le nom d'un autre client.
function centerNameOf(centerId) {
  try {
    return String(getCenter(centerId).name || '').trim();
  } catch (error) {
    return '';
  }
}

function sendHtml(res, statusCode, html) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(html);
}

// req.destroy() n'emet NI 'end' NI 'error' : une premiere version se contentait
// de detruire la requete, et la promesse ne se resolvait jamais. Sur une route
// PUBLIQUE non authentifiee, chaque POST surdimensionne immobilisait donc une
// invocation jusqu'au delai de la plateforme (mesure : apres 3 s, 0 handler
// termine). On resout explicitement, et on cesse d'accumuler.
async function readRawBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let fini = false;
    const terminer = (valeur) => {
      if (fini) return;
      fini = true;
      resolve(valeur);
    };
    req.on('data', (chunk) => {
      if (fini) return;
      data += chunk;
      if (data.length > 4096) { // un corps de desinscription est minuscule
        terminer('');
        req.destroy();
      }
    });
    req.on('end', () => terminer(data));
    req.on('error', () => terminer(''));
    req.on('aborted', () => terminer(''));
    req.on('close', () => terminer(''));
  });
}

module.exports = async (req, res) => {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST');
    res.end('Method Not Allowed');
    return;
  }

  // Rate-limit sur la route publique (par IP), avant toute lecture DB.
  if (enforceRateLimit(req, res, { scope: 'unsubscribe', limit: 20, windowMs: 60_000 })) {
    // enforceRateLimit a deja ecrit un 429 JSON ; on le laisse tel quel pour le
    // POST natif (RFC 8058) et on n'ecrase pas la reponse.
    return;
  }

  try {
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('k') || '';
    const resolved = await resolveUnsubscribeToken(token);

    // Jeton inconnu ou mal forme : message neutre, aucune adresse, statut 200
    // (on ne distingue pas « jeton faux » de « jeton inexistant » : sinon le
    // code de statut devient un oracle).
    if (!resolved) {
      sendHtml(res, 200, renderUnsubscribePage({ state: 'invalid' }));
      return;
    }

    if (method === 'POST') {
      const raw = await readRawBody(req);
      const params = new URLSearchParams(raw);
      // RFC 8058 : le bouton natif envoie « List-Unsubscribe=One-Click ».
      const oneClick = String(params.get('List-Unsubscribe') || '').trim() === 'One-Click';
      const wantsResubscribe = String(params.get('a') || '').trim() === 'resubscribe';

      if (wantsResubscribe) {
        await removeSuppression({ centerId: resolved.centerId, email: resolved.email });
        sendHtml(res, 200, renderUnsubscribePage({ state: 'restored', email: resolved.email, token, centerName: centerNameOf(resolved.centerId) }));
        return;
      }

      // Tout autre POST resolu (dont le One-Click) vaut retrait.
      await suppressEmail({
        centerId: resolved.centerId,
        email: resolved.email,
        source: 'link',
        reason: oneClick ? 'Bouton natif de la messagerie (one-click)' : 'Retrait via la page',
      });
      // One-Click attend un 200 court, pas une page.
      if (oneClick) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        res.end('OK');
        return;
      }
      sendHtml(res, 200, renderUnsubscribePage({ state: 'removed', email: resolved.email, token, centerName: centerNameOf(resolved.centerId) }));
      return;
    }

    // GET : un clic suffit. On inscrit et on rend la page avec l'annulation.
    await suppressEmail({
      centerId: resolved.centerId,
      email: resolved.email,
      source: 'link',
      reason: 'Lien de retrait du mail',
    });
    sendHtml(res, 200, renderUnsubscribePage({ state: 'removed', email: resolved.email, token, centerName: centerNameOf(resolved.centerId) }));
  } catch (error) {
    // DEUX CAS QUE LE 200 NEUTRE CONFONDAIT, ET C'ETAIT GRAVE.
    // Un jeton inconnu doit rendre 200 avec une page neutre : c'est ce qui
    // empeche d'utiliser le code de statut comme oracle d'enumeration. Ce
    // chemin-la est traite plus haut et reste inchange.
    // Mais une ECRITURE RATEE ne doit JAMAIS rendre 2xx. La RFC 8058 dit qu'un
    // 2xx signifie "desinscription effectuee" : Gmail et Outlook l'affichent
    // comme telle. Le client se croyait retire, rien n'etait enregistre, il
    // continuait de recevoir, et il finissait par cliquer SPAM. C'est le
    // scenario exact que cette fonctionnalite doit empecher.
    // Ici on est FORCEMENT apres la resolution du jeton (le cas non resolu
    // renvoie plus haut), donc toute exception qui arrive ici est une panne
    // serveur : on le dit avec un 503, sans jamais divulguer l'adresse.
    const oneClickPost = String(req.method || '').toUpperCase() === 'POST';
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (oneClickPost) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Temporairement indisponible');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(renderUnsubscribePage({ state: 'error' }));
  }
};
