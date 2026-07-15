// Redirection trackée des liens d'email (bouton « Laissez-nous un avis
// Google » du mail post-visite). GET /api/r?k=<token 32 hex>.
//
// Sécurité : le token (128 bits aléatoires, généré à l'envoi) est la seule
// entrée ; la destination vient du payload STOCKÉ de la communication, jamais
// de la requête → pas d'open redirect, pas d'énumération. Marque le premier
// clic (payload.reviewClickAt) puis 302.
const { resolveReviewClick } = require('../lib/marketing-roi');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end('Method Not Allowed');
    return;
  }
  try {
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const target = await resolveReviewClick(url.searchParams.get('k') || '');
    if (!target) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Lien expiré ou inconnu.');
      return;
    }
    res.statusCode = 302;
    res.setHeader('Location', target.url);
    res.setHeader('Cache-Control', 'no-store');
    res.end();
  } catch (error) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Lien expiré ou inconnu.');
  }
};
