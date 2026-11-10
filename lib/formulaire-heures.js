'use strict';
// LES HEURES COMPLETES QUE LES GENS VOULAIENT (2026-11-10, Ansar : « des data absolument
// partout », puis son oui pour cette table : « samedi 15 h demandé 40 fois, complet »).
//
// Dans le formulaire public, une heure complete reste affichee et se touche : sa raison
// s eclaire. Ce toucher est une demande que le centre n a pas pu servir. Le formulaire
// l envoie une fois par visite pour un meme jour, une meme heure et une meme activite, avec
// l identifiant tire au hasard de la visite : aucun nom, aucun mail, aucun telephone, aucun
// cookie. La console lit, sur la periode, quel jour de la semaine et quelle heure reviennent.
//
// CE QUI EST COMPTE, ET RIEN D AUTRE : un toucher sur une heure ou le client lisait
// « complet ». Une heure fermee, passee ou trop tardive n y entre pas, et une heure complete
// que personne ne touche non plus. C est donc un PLANCHER de la demande, jamais son total.
//
// Rien ne prouve au serveur que l heure etait vraiment complete : c est le navigateur qui le
// dit. Ce sont des statistiques, jamais une verite du planning. Aucune regle, aucun prix,
// aucune alerte ne doit en dependre.

// Huit heures touchees par envoi au plus : au-dela, ce n est plus quelqu un qui cherche.
const MAX_HEURES_PAR_ENVOI = 8;
// Le formulaire ne reserve pas au-dela de quelques mois : plus loin, la date est fausse.
const HORIZON_JOURS = 550;
// Ce que la console lit au plus. Le tableau n en montre qu une partie, l Excel donne tout.
const MAX_LIGNES_LUES = 200;
// Deux « activites » qui n en sont pas : l heure d arrivee d une visite, l heure d une formule.
const QUOI_ARRIVEE = 'arrivee';
const QUOI_FORMULE = 'formule';
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const HEURE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function texte(valeur, max) {
  return typeof valeur === 'string' ? valeur.trim().slice(0, max) : '';
}

// UNE DATE SE RECONSTRUIT : `Date.parse('2027-02-31')` repond le 3 mars. Elle doit aussi
// tomber entre hier (un visiteur de l autre cote de minuit) et l horizon du formulaire.
function jourValide(jour, aujourdHui) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(jour);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== jour) return false;
  const base = Date.parse(`${aujourdHui}T00:00:00Z`);
  if (Number.isNaN(base)) return false;
  const ecart = Math.round((d.getTime() - base) / 86_400_000);
  return ecart >= -1 && ecart <= HORIZON_JOURS;
}

// L ENVELOPPE : le centre, la visite, une liste. Mal formee, tout l envoi est refuse.
function enveloppeRecue(body) {
  const centerId = texte(body && body.centerId, 60);
  const visite = texte(body && body.visite, 40);
  if (!/^[a-z0-9_-]{1,60}$/.test(centerId) || !/^[a-z0-9]{16,40}$/i.test(visite) || !Array.isArray(body.heures)) return null;
  return { centerId, visite };
}

// CE QUI ENTRE, ET RIEN D AUTRE. La route est publique : une heure n est gardee que si son
// jour existe et tombe dans la fenetre, si son heure est une heure, et si son activite ou sa
// formule est de CE centre (`activites`, `formules` : ses identifiants, donnes par l appelant).
// Aucun texte libre n est garde : rien de personnel ne peut y entrer.
function heuresRecues(body, { activites = [], formules = [], aujourdHui = new Date().toISOString().slice(0, 10) } = {}) {
  const enveloppe = enveloppeRecue(body);
  if (!enveloppe) return null;
  const connues = new Set([...activites].map(String));
  const offertes = new Set([...formules].map(String));
  const vues = new Set();
  const lignes = [];
  for (const h of body.heures.slice(0, MAX_HEURES_PAR_ENVOI)) {
    const jour = texte(h && h.jour, 10);
    const heure = texte(h && h.heure, 5);
    const activite = texte(h && h.activite, 60);
    const formule = texte(h && h.formule, 60);
    if (!jourValide(jour, aujourdHui) || !HEURE.test(heure)) continue;
    if (activite !== QUOI_ARRIVEE && activite !== QUOI_FORMULE && !connues.has(activite)) continue;
    if (formule && !offertes.has(formule)) continue;
    if (activite === QUOI_FORMULE && !formule) continue;
    const cle = `${jour}|${heure}|${activite}|${formule}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    const n = Number(h.joueurs);
    lignes.push({ jour, heure, activite, formule, joueurs: Number.isInteger(n) && n >= 1 && n <= 500 ? n : null });
  }
  return { ...enveloppe, lignes };
}

// L ECRITURE : une requete parametree, jamais de texte du client dans le SQL. La meme heure
// touchee deux fois dans la meme visite ne s ecrit qu une fois (index unique de la table).
async function ecrireHeures(pool, envoi) {
  if (!envoi || !envoi.lignes.length) return;
  const valeurs = [];
  const lignesSql = envoi.lignes.map((l, i) => {
    const b = i * 7;
    valeurs.push(envoi.centerId, envoi.visite, l.jour, l.heure, l.activite, l.formule, l.joueurs);
    return `($${b + 1}, $${b + 2}, $${b + 3}::date, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
  });
  await pool.query(`insert into formulaire_heures_pleines (center_id, visite, jour, heure, activite, formule, joueurs) values ${lignesSql.join(', ')} on conflict do nothing`, valeurs);
}

// LA LECTURE : sur la periode ou les gens ont touche (created_at), le jour de la semaine
// VOULU (1 = lundi, 7 = dimanche), l heure, l activite ou la formule. `dates` : sur combien
// de jours differents cette heure a ete voulue (un samedi exceptionnel, ou tous les samedis).
// Toujours un seul centre ($1).
const SQL_LECTURE = `select extract(isodow from jour)::int as jour_semaine, heure, activite, formule,
  count(*)::int as demandes, count(distinct jour)::int as dates, round(avg(joueurs))::int as joueurs_moyens
from formulaire_heures_pleines
where center_id = $1 and created_at >= $2::date and created_at < ($3::date + 1)
group by 1, 2, 3, 4
order by demandes desc, jour_semaine asc, heure asc, activite asc, formule asc
limit ${MAX_LIGNES_LUES};`;
function requeteLectureHeures({ centerId, debut, fin }) {
  return { sql: SQL_LECTURE, params: [centerId, debut, fin] };
}

// CE QUE LA PERSONNE VOULAIT, EN MOTS. Les noms viennent du catalogue du centre, donnes par
// l appelant ; une activite retiree depuis garde son identifiant, jamais un nom devine.
function quoiLisible(activite, formule, { nomActivite, nomFormule }) {
  const nom = formule ? (nomFormule(formule) || formule) : '';
  // Un nom de formule qui dit deja « Formule » (« FORMULE 1 ») ne le redit pas.
  const f = !nom || /^formule\b/i.test(nom) ? nom : `Formule ${nom}`;
  if (activite === QUOI_FORMULE) return f;
  if (activite === QUOI_ARRIVEE) return f ? `Heure d’arrivée, ${f}` : 'Heure d’arrivée';
  const a = nomActivite(activite) || activite;
  return f ? `${a}, ${f}` : a;
}

// LE CLASSEMENT. Une ligne que la base rendrait hors des clous (jour de semaine inconnu,
// heure qui n en est pas une, nombre nul ou negatif) est ignoree, jamais devinee. L ordre est
// refait ici : il ne depend pas de celui de la base.
function heuresDemandees(lignes = [], { nomActivite = () => '', nomFormule = () => '' } = {}) {
  const out = [];
  for (const l of Array.isArray(lignes) ? lignes : []) {
    const js = Number(l && l.jour_semaine);
    const n = Number(l && l.demandes);
    const heure = String((l && l.heure) || '');
    if (!Number.isInteger(js) || js < 1 || js > 7 || !HEURE.test(heure) || !Number.isInteger(n) || n <= 0) continue;
    const activite = String(l.activite || '');
    const formule = String(l.formule || '');
    if (!activite) continue;
    const dates = Number(l.dates);
    const moyenne = Number(l.joueurs_moyens);
    out.push({
      jourSemaine: js,
      jour: JOURS[js - 1],
      heure,
      activite,
      formule,
      quoi: quoiLisible(activite, formule, { nomActivite, nomFormule }),
      demandes: n,
      dates: Number.isInteger(dates) && dates > 0 ? Math.min(dates, n) : 1,
      joueursMoyens: l.joueurs_moyens != null && Number.isInteger(moyenne) && moyenne > 0 ? moyenne : null,
    });
  }
  out.sort((a, b) => b.demandes - a.demandes || a.jourSemaine - b.jourSemaine || a.heure.localeCompare(b.heure) || a.quoi.localeCompare(b.quoi));
  return out;
}

module.exports = {
  MAX_HEURES_PAR_ENVOI, HORIZON_JOURS, MAX_LIGNES_LUES, QUOI_ARRIVEE, QUOI_FORMULE,
  jourValide, enveloppeRecue, heuresRecues, ecrireHeures, requeteLectureHeures, heuresDemandees,
};
