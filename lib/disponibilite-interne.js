'use strict';
// LA DISPONIBILITE PUBLIQUE, APPELEE SANS RESEAU (2026-09-29).
//
// L etude d une demande sur mesure (lib/demande-bureau) pose au moteur la
// question exacte du formulaire public : quelles heures, a quel prix, pour cet
// effectif, ce jour-la. La reponse doit etre LA MEME que celle du formulaire,
// donc elle passe par la meme porte (api/public-availability), jamais par une
// copie de sa logique : deux moteurs finiraient par annoncer deux prix.
//
// Le gestionnaire HTTP recoit une requete en memoire. Sa limite de debit
// compte ces appels sous une cle a part (x-forwarded-for « console-demandes »),
// distincte des visiteurs. Rend toujours { status, json } : une panne du
// moteur devient un statut 500 que l etude sait dire, jamais une exception.

function disponibiliteInterne(params = {}, { handler = null } = {}) {
  const api = handler || require('../api/public-availability');
  const query = new URLSearchParams(Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, String(v)])).toString();
  return new Promise((resolve) => {
    const req = {
      method: 'GET',
      url: `/api/public-availability?${query}`,
      headers: { host: 'interne', 'x-forwarded-for': 'console-demandes' },
      on() {},
      setEncoding() {},
    };
    const res = {
      statusCode: 200,
      setHeader() {},
      getHeader() { return undefined; },
      writeHead(code) { this.statusCode = code; return this; },
      end(body) {
        let json = null;
        try { json = JSON.parse(String(body || '{}')); } catch (error) { json = null; }
        resolve({ status: this.statusCode, json });
      },
    };
    Promise.resolve()
      .then(() => api(req, res))
      .catch(() => resolve({ status: 500, json: null }));
  });
}

module.exports = { disponibiliteInterne };
