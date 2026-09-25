'use strict';
// LES CACHES MODULE SE VERIFIENT CONTRE LA BASE (2026-09-25).
//
// Le constat : catalog-store (catalogue), ops-knowledge (configuration des
// centres), booking-config (prix des formules par centre) et availability-blocks
// (blocages) gardent leur lecture 30 s dans la memoire de CHAQUE fonction
// Vercel. Une ecriture passe par api/ops et ne rafraichit que la memoire de
// api/ops : public-availability, public-booking-meta, staff-state et
// staff-reservations servaient l ancien etat jusqu a 30 s. Le tunnel client
// pouvait proposer une formule que le gerant venait de retirer, a l ancien prix,
// et un deuxieme poste qui relisait sa page recevait la version d avant.
//
// La regle : dans son delai, un cache n est garde que si l empreinte de ses
// tables n a pas bouge. L empreinte tient en une requete minuscule, des md5 sur
// les identifiants et le `xmin` des lignes (le numero de la transaction qui a
// ecrit la ligne : il change a chaque ecriture, quelle que soit la colonne).
// Une meme lecture sert les quatre caches ; elle est partagee 25 ms, le temps
// que les trois ou quatre rafraichissements d une meme requete HTTP (qui se
// suivent en quelques millisecondes) n en paient qu une.
//
// Deux interdits :
//   - jamais sur un client de transaction (un objet qui a `release`) : une
//     lecture qui echouerait dans une transaction la rendrait inutilisable ;
//   - jamais d exception : une empreinte illisible rend null, et le cache
//     retombe sur son delai d avant (fail-soft, comme ses propres lectures).
const MEMO_MS = 25;

// Le commentaire en tete sert aux faux pools des gates : ils reconnaissent la
// requete sans en recopier le texte.
const SQL_EMPREINTES = `select /* empreintes-caches */
  (select md5(coalesce(string_agg(c.id || ':' || c.xmin::text, ',' order by c.id), ''))
     from centers c) as centres,
  (select md5(coalesce(string_agg(o.formule_id || ':' || o.center_id || ':' || o.xmin::text, ',' order by o.formule_id, o.center_id), ''))
     from formule_overrides o) as surcharges,
  md5(concat_ws('|',
    (select string_agg(f.id || ':' || f.owner_client_id || ':' || f.xmin::text, ',' order by f.id, f.owner_client_id) from formulas f),
    (select string_agg(s.id::text || ':' || s.xmin::text, ',' order by s.id) from formula_steps s),
    (select string_agg(a.id || ':' || a.center_id || ':' || a.owner_client_id || ':' || a.xmin::text, ',' order by a.id, a.center_id, a.owner_client_id) from activities a),
    (select string_agg(c.id || ':' || coalesce(c.client_id, ''), ',' order by c.id) from centers c)
  )) as catalogue,
  coalesce((
    select json_object_agg(b.center_id, b.empreinte)
      from (
        select center_id, md5(string_agg(id::text || ':' || xmin::text, ',' order by id)) as empreinte
          from availability_blocks
         group by center_id
      ) b
  ), '{}'::json) as blocages;`;

const memos = new WeakMap();

function interrogeable(pool) {
  return Boolean(pool && typeof pool.query === 'function' && typeof pool.release !== 'function');
}

// Les quatre empreintes, ou null si on ne peut pas les lire. `frais` ignore la
// lecture partagee : c est ce qu on lit AVANT de recharger un cache, pour ne
// jamais ranger une empreinte plus recente que les donnees qu elle couvre.
function lireEmpreintes(pool, { frais = false } = {}) {
  if (!interrogeable(pool)) return Promise.resolve(null);
  const maintenant = Date.now();
  const memo = memos.get(pool);
  if (!frais && memo && maintenant - memo.at < MEMO_MS) return memo.promesse;
  const promesse = Promise.resolve()
    .then(() => pool.query(SQL_EMPREINTES))
    .then((resultat) => {
      const ligne = resultat && Array.isArray(resultat.rows) ? resultat.rows[0] : null;
      return ligne && typeof ligne === 'object' ? ligne : null;
    }, () => null);
  memos.set(pool, { at: maintenant, promesse });
  return promesse;
}

// Une empreinte de domaine (centres, surcharges, catalogue), ou null.
async function empreinteDe(pool, domaine, options) {
  const ligne = await lireEmpreintes(pool, options);
  const valeur = ligne ? ligne[domaine] : null;
  return typeof valeur === 'string' && valeur ? valeur : null;
}

// L empreinte des blocages d UN centre. Un centre sans blocage n a pas de cle :
// il vaut 'vide', ce qui reste une empreinte connue (et qui changera au premier
// blocage pose).
async function empreinteBlocages(pool, centerId, options) {
  const ligne = await lireEmpreintes(pool, options);
  if (!ligne || !ligne.blocages || typeof ligne.blocages !== 'object') return null;
  const valeur = ligne.blocages[String(centerId || '')];
  return typeof valeur === 'string' && valeur ? valeur : 'vide';
}

module.exports = {
  SQL_EMPREINTES,
  MEMO_MS,
  lireEmpreintes,
  empreinteDe,
  empreinteBlocages,
};
