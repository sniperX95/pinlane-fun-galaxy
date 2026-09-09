// Gate de la fiche de faits (lib/center-facts.js).
// SANS réseau ni DB : ficheDuRegistre est pure, on lui injecte des lignes.
// node scripts/center-facts-check.js
const { ficheDuRegistre } = require('../lib/center-facts');
const { maturite, peutAffirmer, N_POUR_ELIRE, PART_QUI_TRAHIT_UN_ARTEFACT } = require('../lib/center-guards');

let failures = 0;
function ok(label, condition, detail = '') {
  if (condition) {
    console.log(`ok    ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${label}${detail ? `  ${detail}` : ''}`);
}

// Fabrique de lignes : tout est explicite, rien n'est aléatoire.
function resa(over = {}) {
  return {
    date: '2026-07-04',
    start_time: '14:00',
    status: 'paid',
    channel: 'public',
    pax: 8,
    price: 200,
    base_price: 200,
    formule_id: 'f1',
    email: 'client@example.test',
    name: 'Client',
    created_at: '2026-06-20T19:30:00.000Z',
    payment_method: 'Comptoir',
    occasion: 'anniversaire',
    ...over,
  };
}
// Étale des réservations sur des dates réelles pour donner du volume ET des mois.
function serie(nb, over = {}, depart = new Date('2026-03-02T00:00:00Z'), prefixe = 'client') {
  return Array.from({ length: nb }, (unused, i) => {
    const d = new Date(depart.getTime() + i * 7 * 86400000);
    return resa({
      date: d.toISOString().slice(0, 10),
      email: `${prefixe}${i}@example.test`,
      created_at: new Date(d.getTime() - 10 * 86400000).toISOString(),
      ...over,
    });
  });
}

// ── UN REGISTRE VIDE NE SE COMMENTE PAS ─────────────────────────────────────
console.log('[VIDE] un registre sans matiere le dit, au lieu de commenter le neant');
const vide = ficheDuRegistre({ reservations: [], formules: [] });
ok('la fiche annonce un registre vide', Boolean(vide.registre_vide), Object.keys(vide).join(','));
ok('elle ne produit aucun taux ni moyenne', !vide.panier_moyen && !vide.taux_retour, Object.keys(vide).join(','));
const queDesAnnulees = ficheDuRegistre({ reservations: [resa({ status: 'cancelled' })], formules: [] });
ok('un registre fait uniquement d annulations est vide aussi',
  Boolean(queDesAnnulees.registre_vide), Object.keys(queDesAnnulees).join(','));

// ── LES STATUTS VIENNENT DU PRODUIT, PAS D'UNE LISTE ECRITE A LA MAIN ───────
// Defaut reel de la premiere version : STATUTS_ACTIFS etait ecrit a la main et
// contenait 'confirmed', 'completed' et 'seated' (aucun n'existe en base) tout
// en OUBLIANT 'paid', le statut le plus courant (301 lignes, 51 435 EUR au
// releve du 2026-09-09). La fiche jetait la majorite du registre en silence, et
// aucun test ne rougissait.
console.log('\n[STATUTS] la fiche compte les memes reservations que le reste du produit');
const { ACTIVE_STATUSES } = require('../lib/direction-analytics');
const { STATUTS_ACTIFS } = require('../lib/center-facts');
ok('la fiche partage la liste de statuts du produit, elle n en redefinit pas une',
  STATUTS_ACTIFS === ACTIVE_STATUSES, `${[...STATUTS_ACTIFS]} contre ${[...ACTIVE_STATUSES]}`);
[...ACTIVE_STATUSES].forEach((statut) => {
  const uneSeule = ficheDuRegistre({ reservations: [resa({ status: statut })], formules: [] });
  ok(`une reservation « ${statut} » est comptee comme active`,
    !uneSeule.registre_vide && uneSeule.resa_actives.valeur === 1,
    Object.keys(uneSeule).join(','));
});
const inventee = ficheDuRegistre({ reservations: [resa({ status: 'confirmed' })], formules: [] });
ok('un statut qui n existe pas en base ne cree pas d activite fantome',
  Boolean(inventee.registre_vide), Object.keys(inventee).join(','));

// ── GENRE : compter n'est pas estimer ───────────────────────────────────────
console.log('\n[GENRE] les comptages et les taux ne portent pas la meme etiquette');
const base = ficheDuRegistre({ reservations: serie(40), formules: [], aujourdhui: '2026-12-31' });
ok('le nombre de reservations est un denombrement', base.resa_actives.genre === 'denombrement');
ok('le chiffre d affaires est un denombrement', base.ca_total.genre === 'denombrement');
ok('le panier moyen est une estimation', base.panier_moyen.genre === 'estimation');
ok('le taux de retour est une estimation', base.taux_retour.genre === 'estimation');

// ── CHAQUE FAIT PORTE SA PROPRE FENÊTRE ─────────────────────────────────────
// Sans ça, un fait calculé sur deux semaines emprunte la maturité du registre
// entier et passe pour un fait de six mois.
console.log('\n[FENETRE] un fait calcule sur un sous-ensemble ne prend pas la fenetre globale');
const melange = [
  ...serie(30, { formule_id: 'f1' }),
  ...serie(9, { formule_id: 'f2', price: 900 }, new Date('2026-08-03T00:00:00Z')),
];
const avecSousEnsemble = ficheDuRegistre({ reservations: melange, formules: [], aujourdhui: '2026-12-31' });
ok('MONTAGE : le registre global couvre plus de mois que le sous-ensemble f2',
  maturite(avecSousEnsemble.resa_actives).mois > 2, JSON.stringify(maturite(avecSousEnsemble.resa_actives)));
const gagnante = avecSousEnsemble.formule_meilleur_panier;
ok('la formule elue au meilleur panier est bien f2 (900 EUR)',
  String(gagnante.valeur).includes('900'), String(gagnante.valeur));
ok('et elle porte SA fenetre, plus courte que celle du registre',
  gagnante.mois.length < avecSousEnsemble.resa_actives.mois.length,
  `${gagnante.mois.length} mois contre ${avecSousEnsemble.resa_actives.mois.length}`);

// ── ÉLECTION : pas de jour fort sans volume ─────────────────────────────────
console.log('\n[ELECTION] aucun jour n est elu sans assez d observations');
// 7 réservations un lundi, 6 un samedi : personne n'atteint le seuil.
const maigre = [
  ...Array.from({ length: 7 }, (u, i) => resa({ date: `2026-07-0${i + 6}`, email: `a${i}@x.test` })),
];
const ficheMaigre = ficheDuRegistre({ reservations: maigre, formules: [], aujourdhui: '2026-12-31' });
ok(`aucun jour ne compte ${N_POUR_ELIRE} observations, donc aucun jour fort n existe`,
  !ficheMaigre.jour_fort && !ficheMaigre.jour_creux, Object.keys(ficheMaigre).join(','));

// Même situation avec du volume : le verdict apparaît.
const lundis = Array.from({ length: 12 }, (u, i) => resa({
  date: new Date(Date.UTC(2026, 2, 2) + i * 7 * 86400000).toISOString().slice(0, 10),
  email: `l${i}@x.test`,
}));
const samedis = Array.from({ length: 9 }, (u, i) => resa({
  date: new Date(Date.UTC(2026, 2, 7) + i * 7 * 86400000).toISOString().slice(0, 10),
  email: `s${i}@x.test`,
}));
const ficheDense = ficheDuRegistre({ reservations: [...lundis, ...samedis], formules: [], aujourdhui: '2026-12-31' });
ok('avec 12 lundis et 9 samedis, le jour fort apparait',
  Boolean(ficheDense.jour_fort), Object.keys(ficheDense).join(','));
ok('et c est bien le lundi', String(ficheDense.jour_fort.valeur).startsWith('lundi'), String(ficheDense.jour_fort.valeur));
ok('le jour creux existe aussi et differe du jour fort',
  Boolean(ficheDense.jour_creux) && String(ficheDense.jour_creux.valeur).startsWith('samedi'),
  String(ficheDense.jour_creux && ficheDense.jour_creux.valeur));

// ── ARTEFACT : une commande a la meme heure pour tous ───────────────────────
console.log('\n[ARTEFACT] une donnee horodatee d un coup est declaree inexploitable');
const seedees = serie(40).map((r) => ({ ...r, created_at: '2026-01-01T00:00:00.000Z' }));
const ficheSeed = ficheDuRegistre({ reservations: seedees, formules: [], aujourdhui: '2026-12-31' });
ok(`MONTAGE : 100 % des lignes partagent la meme heure, au-dessus du seuil de ${PART_QUI_TRAHIT_UN_ARTEFACT} %`,
  seedees.every((r) => r.created_at === seedees[0].created_at));
ok('l heure de commande est declaree inexploitable',
  String(ficheSeed.heure_de_commande.valeur).startsWith('inexploitable'),
  String(ficheSeed.heure_de_commande.valeur));
ok('son n est remis a zero, donc elle ne porte aucun constat',
  ficheSeed.heure_de_commande.n === 0 && peutAffirmer(ficheSeed.heure_de_commande, 'constat').autorise === false);
// Contre-preuve : des heures etalees passent, donc la garde mordait.
const etalees = serie(40).map((r, i) => ({
  ...r,
  created_at: new Date(Date.UTC(2026, 5, 20, 14 + (i % 6))).toISOString(),
}));
const ficheEtalee = ficheDuRegistre({ reservations: etalees, formules: [], aujourdhui: '2026-12-31' });
ok('CONTRE-PREUVE : des heures etalees ne sont PAS declarees inexploitables',
  !String(ficheEtalee.heure_de_commande.valeur).startsWith('inexploitable'),
  String(ficheEtalee.heure_de_commande.valeur));

// ── LE CATALOGUE QUI DORT ───────────────────────────────────────────────────
// Invisible autrement : une formule sans vente n'apparait dans aucun
// regroupement sur les reservations.
console.log('\n[CATALOGUE] une formule sans une seule vente reste visible');
const catalogue = [
  { id: 'f1', name: 'Bowling Classique', active: true },
  { id: 'f2', name: 'MATIN MALIN', active: true },
  { id: 'f3', name: 'Formule retiree', active: false },
];
const ficheCatalogue = ficheDuRegistre({ reservations: serie(40, { formule_id: 'f1' }), formules: catalogue, aujourdhui: '2026-12-31' });
ok('le catalogue actif compte 2 formules, pas 3 (la retiree est ignoree)',
  ficheCatalogue.catalogue_actif.valeur === 2, String(ficheCatalogue.catalogue_actif.valeur));
ok('MATIN MALIN est signalee comme jamais vendue',
  String(ficheCatalogue.formules_jamais_vendues.valeur).includes('MATIN MALIN'),
  String(ficheCatalogue.formules_jamais_vendues.valeur));
ok('la formule retiree n y figure pas',
  !String(ficheCatalogue.formules_jamais_vendues.valeur).includes('retiree'),
  String(ficheCatalogue.formules_jamais_vendues.valeur));
const toutVendu = ficheDuRegistre({
  reservations: [...serie(20, { formule_id: 'f1' }), ...serie(20, { formule_id: 'f2' }, new Date('2026-04-06T00:00:00Z'))],
  formules: catalogue,
  aujourdhui: '2026-12-31',
});
ok('CONTRE-PREUVE : quand tout se vend, le fait dit « aucune »',
  toutVendu.formules_jamais_vendues.valeur === 'aucune', String(toutVendu.formules_jamais_vendues.valeur));

// ── CE QUE LE REGISTRE NE SAIT PAS ──────────────────────────────────────────
console.log('\n[TROUS] l agent connait les trous de sa propre donnee');
const troues = serie(40).map((r, i) => (i < 30 ? { ...r, payment_method: '' } : r));
const ficheTrouee = ficheDuRegistre({ reservations: troues, formules: [], aujourdhui: '2026-12-31' });
ok('le trou de paiement est chiffre en nombre et en part',
  String(ficheTrouee.trou_paiement.valeur).includes('30 sur 40')
  && String(ficheTrouee.trou_paiement.valeur).includes('75 %'),
  String(ficheTrouee.trou_paiement.valeur));

// ── CLIENTS DORMANTS ────────────────────────────────────────────────────────
console.log('\n[DORMANTS] la relance vise ceux qui ne sont pas revenus');
const anciens = serie(10, {}, new Date('2026-01-05T00:00:00Z'), 'ancien');
const recents = serie(30, {}, new Date('2026-08-03T00:00:00Z'), 'recent');
const ficheDormants = ficheDuRegistre({
  reservations: [...anciens, ...recents], formules: [], aujourdhui: '2026-09-09',
});
ok('les clients de janvier sont comptes comme dormants',
  Number(String(ficheDormants.clients_dormants.valeur).split(' ')[0]) >= 10,
  String(ficheDormants.clients_dormants.valeur));
const sansDate = ficheDuRegistre({ reservations: [...anciens, ...recents], formules: [] });
ok('CONTRE-PREUVE : sans date du jour, aucun dormant n est affirme',
  !sansDate.clients_dormants, Object.keys(sansDate).join(','));

console.log(`\n${failures ? `center-facts-check: ${failures} ECHEC(S)` : 'center-facts-check: ALL OK'}`);
process.exit(failures ? 1 : 0);
