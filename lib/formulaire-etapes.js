'use strict';
// OU LES GENS S ARRETENT DANS LE FORMULAIRE (2026-11-09, Ansar : « sur le formulaire voir
// ou les gens s arretent »).
//
// Le formulaire public envoie chaque ecran atteint, une fois par visite, avec un identifiant
// tire au hasard pour cette seule visite : aucun nom, aucun mail, aucun telephone, aucun
// cookie. La console lit l ecran LE PLUS LOIN atteint par chaque visite : c est la que la
// personne s est arretee. Un retour en arriere ou un ecran saute ne faussent donc rien.
//
// UNE SEULE LISTE DES ECRANS, ICI, dans l ordre du parcours. Le formulaire (SCENES et
// SCENES_SM, assets/fungalaxy-booking.js) et la table (database/formulaire-etapes-schema.sql)
// la recopient : test:formulaire-etapes rougit des qu une des trois s ecarte. Les noms sont
// ceux que le client lit dans le fil d etapes du formulaire.
const PARCOURS_FORMULAIRE = [
  {
    parcours: 'reservation',
    nom: 'Réservation',
    etapes: [
      { etape: 'date', nom: 'Date et groupe' },
      { etape: 'activites', nom: 'Activités' },
      { etape: 'heures', nom: 'Horaires' },
      { etape: 'contact', nom: 'Coordonnées' },
      { etape: 'recap', nom: 'Validation' },
      { etape: 'fin', nom: 'Réservation envoyée' },
    ],
  },
  {
    parcours: 'sur-mesure',
    nom: 'Demande sur mesure',
    etapes: [
      { etape: 'sm-groupe', nom: 'Le groupe' },
      { etape: 'sm-date', nom: 'Date' },
      { etape: 'sm-envies', nom: 'Envies' },
      { etape: 'sm-contact', nom: 'Coordonnées' },
      { etape: 'sm-recap', nom: 'Envoi' },
      { etape: 'fin', nom: 'Demande envoyée' },
    ],
  },
];
// Douze ecrans existent en tout : un envoi n en porte jamais plus.
const MAX_ETAPES_PAR_ENVOI = 12;

function texte(valeur, max) {
  return typeof valeur === 'string' ? valeur.trim().slice(0, max) : '';
}
function ordreDe(parcours) {
  const p = PARCOURS_FORMULAIRE.find((x) => x.parcours === parcours);
  return p ? p.etapes.map((e) => e.etape) : [];
}

// CE QUI ENTRE, ET RIEN D AUTRE. La route est publique : un centre ou une visite mal formes
// refusent tout l envoi, un ecran inconnu est jete, un ecran redit ne compte qu une fois, et
// seuls le parcours et l ecran sont gardes. Rien de personnel ne peut y entrer.
function etapesRecues(body) {
  const centerId = texte(body && body.centerId, 60);
  const visite = texte(body && body.visite, 40);
  if (!/^[a-z0-9_-]{1,60}$/.test(centerId) || !/^[a-z0-9]{16,40}$/i.test(visite) || !Array.isArray(body.etapes)) return null;
  const vues = new Set();
  const lignes = [];
  for (const e of body.etapes.slice(0, MAX_ETAPES_PAR_ENVOI)) {
    const parcours = texte(e && e.parcours, 20);
    const etape = texte(e && e.etape, 20);
    if (!ordreDe(parcours).includes(etape)) continue;
    const cle = `${parcours}:${etape}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    lignes.push({ parcours, etape });
  }
  return lignes.length ? { centerId, visite, lignes } : null;
}

// L ECRITURE : une requete parametree, jamais de texte du client dans le SQL. Un ecran deja
// compte pour cette visite ne s ecrit pas deux fois (index unique de la table).
async function ecrireEtapes(pool, envoi) {
  const valeurs = [];
  const lignesSql = envoi.lignes.map((l, i) => {
    const b = i * 4;
    valeurs.push(envoi.centerId, envoi.visite, l.parcours, l.etape);
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`;
  });
  await pool.query(`insert into formulaire_etapes (center_id, visite, parcours, etape) values ${lignesSql.join(', ')} on conflict do nothing`, valeurs);
}

// LA LECTURE : pour chaque visite de la periode, le rang de l ecran le plus loin atteint,
// puis le nombre de visites par rang. L ordre des ecrans part d ici en parametre : la base
// n en garde aucune copie. Toujours un seul centre ($1).
const SQL_LECTURE = `select parcours, loin, count(*)::int as visites from (
  select parcours, visite, max(array_position(case when parcours = 'sur-mesure' then $5::text[] else $4::text[] end, etape)) as loin
  from formulaire_etapes
  where center_id = $1 and created_at >= $2::date and created_at < ($3::date + 1)
  group by parcours, visite
) t where loin is not null group by parcours, loin;`;
function requeteLecture({ centerId, debut, fin }) {
  return { sql: SQL_LECTURE, params: [centerId, debut, fin, ordreDe('reservation'), ordreDe('sur-mesure')] };
}

const r1 = (n) => Math.round(n * 10) / 10;

// L ENTONNOIR, PAR PARCOURS. `arrives` : les visites qui ont atteint cet ecran. `arretes` :
// celles qui n ont jamais ete plus loin (elles sont parties ici). Le dernier ecran est
// l arrivee : personne ne s y « arrete ». Une ligne que la base rendrait hors de la liste
// (rang inconnu, nombre negatif) est ignoree, jamais devinee.
function entonnoirFormulaire(lignes = []) {
  return PARCOURS_FORMULAIRE.map((p) => {
    const parRang = new Map();
    for (const l of Array.isArray(lignes) ? lignes : []) {
      if (!l || l.parcours !== p.parcours) continue;
      const rang = Number(l.loin);
      const n = Number(l.visites);
      if (!Number.isInteger(rang) || rang < 1 || rang > p.etapes.length || !Number.isInteger(n) || n <= 0) continue;
      parRang.set(rang, (parRang.get(rang) || 0) + n);
    }
    const visites = [...parRang.values()].reduce((a, b) => a + b, 0);
    let reste = visites;
    const etapes = p.etapes.map((e, i) => {
      const arrives = reste;
      const dernier = i === p.etapes.length - 1;
      const ici = parRang.get(i + 1) || 0;
      reste -= ici;
      return {
        etape: e.etape,
        nom: e.nom,
        arrives,
        arretes: dernier ? 0 : ici,
        dernier,
        partDuDepart: visites ? r1((arrives / visites) * 100) : 0,
      };
    });
    return { parcours: p.parcours, nom: p.nom, visites, abouties: etapes[etapes.length - 1].arrives, etapes };
  });
}

module.exports = { PARCOURS_FORMULAIRE, MAX_ETAPES_PAR_ENVOI, ordreDe, etapesRecues, ecrireEtapes, requeteLecture, entonnoirFormulaire };
