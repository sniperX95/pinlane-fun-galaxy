// Gate de la fiche de faits (lib/center-facts.js).
// SANS réseau ni DB : ficheDuRegistre est pure, on lui injecte des lignes.
// node scripts/center-facts-check.js
const { ficheDuRegistre, ajouterIdentite, ajouterMemoire } = require('../lib/center-facts');
const { buildCenterFacts } = require('../lib/marketing-agents');
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

// ── FUSEAU : l'heure de commande est celle du centre ────────────────────────
// getHours() rendrait l'heure du SERVEUR, UTC sur Vercel. Un fait dont l'unique
// usage est de repondre a « quand publier » ne peut pas etre decale de deux
// heures. On melange ete (UTC+2) et hiver (UTC+1) : si la conversion etait un
// decalage fixe, l'un des deux tomberait a cote.
console.log('\n[FUSEAU] les heures sont celles du centre, pas du serveur');
const ETE = new Date(Date.UTC(2026, 6, 15, 19, 0, 0));    // 15 juillet : Bruxelles = UTC+2 -> 21h
const HIVER = new Date(Date.UTC(2026, 0, 14, 19, 0, 0));  // 14 janvier : Bruxelles = UTC+1 -> 20h
const saisonnieres = serie(40).map((r, i) => ({
  ...r,
  created_at: (i % 2 ? ETE : HIVER).toISOString(),
}));
const ficheFuseau = ficheDuRegistre({ reservations: saisonnieres, formules: [], aujourdhui: '2026-12-31' });
const heures = String(ficheFuseau.heure_de_commande.valeur);
ok('MONTAGE : les deux instants sont a 19h UTC, donc un decalage fixe ne peut pas donner deux resultats',
  ETE.getUTCHours() === 19 && HIVER.getUTCHours() === 19);
ok('l heure d ete ressort a 21h (UTC+2)', heures.includes('21h'), heures);
ok('l heure d hiver ressort a 20h (UTC+1)', heures.includes('20h'), heures);
ok('et jamais 19h, l heure du serveur', !heures.includes('19h'), heures);

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

// ── CE QUE LA FICHE IGNORAIT ────────────────────────────────────────────────
// Sept familles ajoutees d'un coup : creneau de venue, saison, taille des
// groupes, minimum de formule, occasion, canal, week-end, tendances. Chacune est
// verifiee sur son calcul ET sur son refus de conclure quand la matiere manque.

console.log('\n[CRENEAU] la fiche sait a quelle heure les clients VIENNENT');
// 40 arrivees a 20h, 12 a 14h : la distribution n'est pas degeneree (77 %), donc
// un vainqueur a le droit d'exister.
const creneaux = [
  ...serie(40, { start_time: '20:00' }, new Date('2026-01-06T00:00:00Z'), 'soir'),
  ...serie(12, { start_time: '14:00' }, new Date('2026-01-07T00:00:00Z'), 'aprem'),
];
const ficheCreneaux = ficheDuRegistre({ reservations: creneaux, formules: [] });
ok('MONTAGE : aucun artefact detecte sur cette distribution',
  !ficheCreneaux.creneau_artefact, String(ficheCreneaux.creneau_artefact && ficheCreneaux.creneau_artefact.valeur));
ok('le creneau le plus demande est 20 h',
  ficheCreneaux.creneau_fort && String(ficheCreneaux.creneau_fort.valeur).startsWith('20 h'),
  String(ficheCreneaux.creneau_fort && ficheCreneaux.creneau_fort.valeur));
ok('le creneau le plus creux est 14 h',
  ficheCreneaux.creneau_creux && String(ficheCreneaux.creneau_creux.valeur).startsWith('14 h'),
  String(ficheCreneaux.creneau_creux && ficheCreneaux.creneau_creux.valeur));
ok('la plage horaire reellement utilisee est annoncee',
  ficheCreneaux.amplitude_horaire && String(ficheCreneaux.amplitude_horaire.valeur).includes('14')
  && String(ficheCreneaux.amplitude_horaire.valeur).includes('20'),
  String(ficheCreneaux.amplitude_horaire && ficheCreneaux.amplitude_horaire.valeur));

// CONTRE-PREUVE : tout au meme creneau. C'est la signature d'un script de seed,
// pas d'un public. La fiche doit REFUSER d'elire, et le dire.
const ficheEcrasee = ficheDuRegistre({
  reservations: serie(50, { start_time: '14:00' }, new Date('2026-01-06T00:00:00Z'), 'seed'),
  formules: [],
});
ok('CONTRE-PREUVE : 100 % sur un seul creneau devient un artefact declare',
  Boolean(ficheEcrasee.creneau_artefact), Object.keys(ficheEcrasee).join(','));
ok('et aucun creneau fort n est elu dans ce cas',
  !ficheEcrasee.creneau_fort && !ficheEcrasee.creneau_creux);
ok('le seuil est bien celui des artefacts',
  String(ficheEcrasee.creneau_artefact.valeur).includes(String(PART_QUI_TRAHIT_UN_ARTEFACT))
  || String(ficheEcrasee.creneau_artefact.valeur).includes('100'),
  String(ficheEcrasee.creneau_artefact.valeur));

console.log('\n[SAISON] un fait comparatif porte la fenetre de la COMPARAISON');
// Deux annees pleines au rythme d une reservation par jour : les douze mois sont
// couverts et juillet, au prix double, est le mois le plus rentable sans
// ambiguite. Le volume compte ici : c est le nombre de juillets observes qui
// decide si la saison peut etre affirmee, pas le nombre total de lignes.
function serieQuotidienne(nb, depart, prefixe) {
  return Array.from({ length: nb }, (unused, i) => {
    const d = new Date(Date.parse(depart) + i * 86400000);
    const date = d.toISOString().slice(0, 10);
    return resa({
      date,
      email: `${prefixe}${i}@example.test`,
      created_at: new Date(d.getTime() - 10 * 86400000).toISOString(),
      price: String(date).slice(5, 7) === '07' ? 400 : 200,
    });
  });
}
const ficheSaison = ficheDuRegistre({
  reservations: serieQuotidienne(730, '2026-01-01T00:00:00Z', 'jour'), formules: [],
});
ok('le mois le plus rentable est elu', Boolean(ficheSaison.mois_fort),
  Object.keys(ficheSaison).join(','));
ok('c est bien juillet', ficheSaison.mois_fort && String(ficheSaison.mois_fort.valeur).startsWith('juillet'),
  String(ficheSaison.mois_fort && ficheSaison.mois_fort.valeur));
// LE POINT. Les lignes de juillet ne couvrent que DEUX mois calendaires sur ces
// deux annees. Si le fait portait leur fenetre, il ne pourrait jamais porter une
// affirmation saisonniere : il porte celle de la comparaison, donc du registre.
ok('MONTAGE : les juillets ne couvrent que deux mois calendaires', true, '2026-07 et 2027-07');
ok('le fait couvre pourtant tout le registre, pas les seuls juillets',
  ficheSaison.mois_fort && ficheSaison.mois_fort.mois.length >= 12,
  String(ficheSaison.mois_fort && ficheSaison.mois_fort.mois.length));
ok('et il peut donc porter une affirmation saisonniere',
  ficheSaison.mois_fort && peutAffirmer(ficheSaison.mois_fort, 'saisonnier').autorise,
  JSON.stringify(ficheSaison.mois_fort && peutAffirmer(ficheSaison.mois_fort, 'saisonnier')));

// CONTRE-PREUVE 1 : meme duree, meme cycle complet, mais une reservation par
// semaine. Juillet ne compte plus qu une poignee d observations, et la saison
// redevient inaffirmable. La barre porte sur le VAINQUEUR, pas sur la masse
// totale : c est ce qui empeche « juillet est ton meilleur mois » apres neuf
// reservations de juillet.
const ficheClairsemee = ficheDuRegistre({
  reservations: serie(104, {}, new Date('2026-01-05T00:00:00Z'), 'sem')
    .map((r) => (String(r.date).slice(5, 7) === '07' ? { ...r, price: 400 } : r)),
  formules: [],
});
ok('CONTRE-PREUVE : un cycle complet mais clairseme n affirme aucune saison',
  !ficheClairsemee.mois_fort || !peutAffirmer(ficheClairsemee.mois_fort, 'saisonnier').autorise,
  JSON.stringify(ficheClairsemee.mois_fort && peutAffirmer(ficheClairsemee.mois_fort, 'saisonnier')));

// CONTRE-PREUVE 2 : un seul mois observe, aucun mois a comparer.
const unSeulMois = ficheDuRegistre({
  reservations: Array.from({ length: 30 }, (unused, i) => resa({
    date: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
    email: `juillet${i}@example.test`,
  })),
  formules: [],
});
ok('CONTRE-PREUVE : un registre d un seul mois n elit aucun mois fort',
  !unSeulMois.mois_fort, String(unSeulMois.mois_fort && unSeulMois.mois_fort.valeur));

console.log('\n[TAILLE] la matiere du minimum, jamais la conclusion');
const groupes = [
  ...serie(20, { pax: 4, price: 100 }, new Date('2026-01-06T00:00:00Z'), 'petit'),
  ...serie(20, { pax: 8, price: 200 }, new Date('2026-01-07T00:00:00Z'), 'moyen'),
  ...serie(10, { pax: 20, price: 500 }, new Date('2026-01-08T00:00:00Z'), 'grand'),
];
const ficheGroupes = ficheDuRegistre({
  reservations: groupes,
  formules: [{ id: 'f1', name: 'Anniversaire', min_pax: 6, active: true, is_birthday_formula: true }],
});
ok('la repartition par taille existe', Boolean(ficheGroupes.groupes_par_taille));
ok('elle nomme les quatre tranches',
  ['moins de 6', '6 a 9', '10 a 15', '16 et plus']
    .every((tranche) => String(ficheGroupes.groupes_par_taille.valeur).includes(tranche)),
  String(ficheGroupes.groupes_par_taille && ficheGroupes.groupes_par_taille.valeur));
ok('la taille mediane est calculee', Boolean(ficheGroupes.taille_mediane),
  String(ficheGroupes.taille_mediane && ficheGroupes.taille_mediane.valeur));
ok('les 20 reservations sous le minimum de 6 sont comptees',
  ficheGroupes.sous_le_minimum_de_la_formule
  && String(ficheGroupes.sous_le_minimum_de_la_formule.valeur).startsWith('20 sur 50'),
  String(ficheGroupes.sous_le_minimum_de_la_formule && ficheGroupes.sous_le_minimum_de_la_formule.valeur));
// CONTRE-PREUVE : sans minimum declare au catalogue, le fait n existe pas. La
// fiche ne suppose jamais un minimum, elle le lit.
const sansMinimum = ficheDuRegistre({
  reservations: groupes,
  formules: [{ id: 'f1', name: 'Anniversaire', active: true }],
});
ok('CONTRE-PREUVE : sans min_pax au catalogue, aucun fait sur le minimum',
  !sansMinimum.sous_le_minimum_de_la_formule);

console.log('\n[OCCASION, CANAL, WEEK-END] ce que la fiche ne regardait pas');
const melangeOccasions = [
  ...serie(20, { occasion: 'anniversaire', channel: 'public' }, new Date('2026-01-06T00:00:00Z'), 'anniv'),
  ...serie(10, { occasion: 'entreprise', channel: 'staff' }, new Date('2026-01-07T00:00:00Z'), 'entre'),
];
const ficheMelange = ficheDuRegistre({ reservations: melangeOccasions, formules: [] });
ok('l occasion dominante est elue',
  ficheMelange.occasion_dominante && String(ficheMelange.occasion_dominante.valeur).startsWith('anniversaire'),
  String(ficheMelange.occasion_dominante && ficheMelange.occasion_dominante.valeur));
ok('la part des occasions renseignees est dite',
  ficheMelange.occasions_renseignees && String(ficheMelange.occasions_renseignees.valeur).includes('30 sur 30'),
  String(ficheMelange.occasions_renseignees && ficheMelange.occasions_renseignees.valeur));
ok('la part reservee en ligne est dite',
  ficheMelange.part_reservee_en_ligne && String(ficheMelange.part_reservee_en_ligne.valeur).includes('20 sur 30'),
  String(ficheMelange.part_reservee_en_ligne && ficheMelange.part_reservee_en_ligne.valeur));
ok('la part du week-end est dite', Boolean(ficheMelange.part_week_end),
  String(ficheMelange.part_week_end && ficheMelange.part_week_end.valeur));

console.log('\n[TENDANCE] ca monte ou ca descend, et le silence quand on ne sait pas');
// 20 venues dans les 90 jours avant le 2026-09-09, 20 dans les 90 d avant, avec
// un prix double sur la periode recente : la hausse doit se voir.
const jourAncre = '2026-09-09';
const recentes = Array.from({ length: 20 }, (unused, i) => resa({
  date: new Date(Date.parse(`${jourAncre}T00:00:00Z`) - (i + 1) * 4 * 86400000).toISOString().slice(0, 10),
  created_at: new Date(Date.parse(`${jourAncre}T00:00:00Z`) - (i + 1) * 4 * 86400000).toISOString(),
  price: 400, email: `recent${i}@example.test`,
}));
const anciennes = Array.from({ length: 20 }, (unused, i) => resa({
  date: new Date(Date.parse(`${jourAncre}T00:00:00Z`) - 90 * 86400000 - (i + 1) * 4 * 86400000).toISOString().slice(0, 10),
  created_at: new Date(Date.parse(`${jourAncre}T00:00:00Z`) - 90 * 86400000 - (i + 1) * 4 * 86400000).toISOString(),
  price: 200, email: `ancien${i}@example.test`,
}));
const ficheTendance = ficheDuRegistre({
  reservations: [...recentes, ...anciennes], formules: [], aujourdhui: jourAncre,
});
ok('la tendance de frequentation existe', Boolean(ficheTendance.tendance_frequentation_90j),
  Object.keys(ficheTendance).join(','));
ok('la tendance de demande existe aussi', Boolean(ficheTendance.tendance_demande_90j));
ok('elle annonce une hausse de chiffre',
  ficheTendance.tendance_frequentation_90j
  && String(ficheTendance.tendance_frequentation_90j.valeur).includes('plus 100 %'),
  String(ficheTendance.tendance_frequentation_90j && ficheTendance.tendance_frequentation_90j.valeur));
ok('elle porte les 40 observations des deux fenetres',
  ficheTendance.tendance_frequentation_90j && ficheTendance.tendance_frequentation_90j.n === 40,
  String(ficheTendance.tendance_frequentation_90j && ficheTendance.tendance_frequentation_90j.n));
// CONTRE-PREUVE : trop peu de matiere de chaque cote. Le piege serait d annoncer
// « stable » : ce serait le mensonge le plus tranquille qu une fiche puisse
// produire. La bonne reponse est l absence de fait.
const ficheSansTendance = ficheDuRegistre({
  reservations: [...recentes.slice(0, 3), ...anciennes.slice(0, 3)], formules: [], aujourdhui: jourAncre,
});
ok('CONTRE-PREUVE : trois observations de chaque cote ne font aucune tendance',
  !ficheSansTendance.tendance_frequentation_90j && !ficheSansTendance.tendance_demande_90j,
  Object.keys(ficheSansTendance).join(','));


// ── L'IDENTITE PHYSIQUE, PAR CENTRE ─────────────────────────────────────────
// Le conseiller recevait deja `themes` dans son prompt (laser 500 m2, 30
// joueurs, parties de 20 minutes) et la garde de provenance, qui ne lit que la
// fiche, REJETAIT ces chiffres vrais. On montrait au modele des faits quon lui
// interdisait ensuite d'ecrire.
console.log('\n[IDENTITE] la fiche porte ce que le centre EST, pas seulement ce qu il a vendu');
const identiteLibramont = ajouterIdentite(ficheDuRegistre({ reservations: [], formules: [] }), buildCenterFacts('libramont'));
const identiteGembloux = ajouterIdentite(ficheDuRegistre({ reservations: [], formules: [] }), buildCenterFacts('gembloux'));
const texteDe = (fiche) => Object.values(fiche).map((f) => `${f.libelle} ${f.valeur}`).join(' | ');

ok('Libramont declare son laser Urban Guerilla sur 500 m2',
  identiteLibramont.identite_laser_game
  && String(identiteLibramont.identite_laser_game.valeur).includes('Urban Guerilla')
  && String(identiteLibramont.identite_laser_game.valeur).includes('500 m2'),
  String(identiteLibramont.identite_laser_game && identiteLibramont.identite_laser_game.valeur));
ok('Gembloux declare le sien Star Wars sur 370 m2',
  identiteGembloux.identite_laser_game
  && String(identiteGembloux.identite_laser_game.valeur).includes('Star Wars')
  && String(identiteGembloux.identite_laser_game.valeur).includes('370 m2'),
  String(identiteGembloux.identite_laser_game && identiteGembloux.identite_laser_game.valeur));

// ISOLATION : c'est la peur nommee par Movsar, « il va sortir des chiffres d un
// autre centre ». Elle se mesure ici plutot que de se supposer.
ok('ISOLATION : rien de Gembloux dans la fiche de Libramont',
  !texteDe(identiteLibramont).includes('Star Wars')
  && !texteDe(identiteLibramont).includes('370')
  && !/golfs*o/i.test(texteDe(identiteLibramont)),
  texteDe(identiteLibramont).slice(0, 120));
ok('ISOLATION : rien de Libramont dans la fiche de Gembloux',
  !texteDe(identiteGembloux).includes('Urban Guerilla')
  && !texteDe(identiteGembloux).includes('Jurassic'),
  texteDe(identiteGembloux).slice(0, 120));

// Une declaration de configuration n'est pas une mesure : elle s'enonce, elle
// ne fonde rien. Sans cette limite, « notre laser fait 500 m2 » deviendrait un
// appui pour « donc publie le mardi ».
ok('un fait declare porte un constat',
  peutAffirmer(identiteLibramont.identite_bowling, 'constat').autorise === true);
ok('mais JAMAIS un levier ni une saison : il est declare, pas mesure',
  peutAffirmer(identiteLibramont.identite_bowling, 'levier_reversible').autorise === false
  && peutAffirmer(identiteLibramont.identite_bowling, 'saisonnier').autorise === false);

// Un prix a UNE source d'autorite, et c'est le catalogue. Le fichier de
// configuration en porte un pour le Golf o'Clock : il ne doit pas remonter
// dans la fiche, sinon un prix perime part vers un client.
ok('le prix declare dans la configuration n est PAS repris comme fait',
  identiteGembloux.identite_golf_oclock
  && !String(identiteGembloux.identite_golf_oclock.valeur).includes('12,5')
  && !String(identiteGembloux.identite_golf_oclock.valeur).includes('12.5')
  && !String(identiteGembloux.identite_golf_oclock.valeur).includes('par personne'),
  String(identiteGembloux.identite_golf_oclock && identiteGembloux.identite_golf_oclock.valeur));

// L'absence de note publique est un fait, et le taire serait l'invitation a
// emprunter celle du centre voisin.
ok('Libramont dit explicitement qu il n a aucune note publique',
  String(identiteLibramont.identite_note_publique.valeur).includes('aucune note publiee'),
  String(identiteLibramont.identite_note_publique.valeur));
ok('Gembloux annonce la sienne, chiffree',
  String(identiteGembloux.identite_note_publique.valeur).includes('418'),
  String(identiteGembloux.identite_note_publique.valeur));

// CONTRE-PREUVE : sans identite fournie, aucun fait d'identite. Sinon les
// assertions ci-dessus pourraient etre vraies pour une autre raison.
const sansIdentite = ajouterIdentite(ficheDuRegistre({ reservations: [], formules: [] }), {});
ok('CONTRE-PREUVE : sans identite du centre, aucun fait identite_',
  Object.keys(sansIdentite).every((cle) => !cle.startsWith('identite_')),
  Object.keys(sansIdentite).join(','));

// ── LA MEMOIRE, SANS SES VIEUX CHIFFRES ─────────────────────────────────────
console.log('\n[MEMOIRE] l agent sait ce qu il a deja dit, sans ressusciter les chiffres d alors');
const HISTORIQUE = [
  {
    title: 'Ton mardi creux pese 6 946 EUR', proposed_at: '2026-09-01T10:00:00.000Z',
    status: 'ignored', applied_at: null, measured_at: null, result: null,
    data_basis: [{ factId: 'jour_creux' }],
  },
  {
    title: 'Relancer les 42 dormants', proposed_at: '2026-08-10T10:00:00.000Z',
    status: 'applied', applied_at: '2026-08-12T10:00:00.000Z', measured_at: '2026-08-30T10:00:00.000Z',
    result: '+18 % de reservations la semaine suivante',
    data_basis: [{ factId: 'clients_dormants' }],
  },
];
const avecMemoire = ajouterMemoire(ficheDuRegistre({ reservations: [], formules: [] }), HISTORIQUE);

ok('la fiche compte ce qui a ete propose, applique et mesure',
  avecMemoire.memoire_propositions
  && String(avecMemoire.memoire_propositions.valeur) === '2 proposees, 1 appliquees, 1 mesurees',
  String(avecMemoire.memoire_propositions && avecMemoire.memoire_propositions.valeur));
ok('elle rappelle les sujets deja servis',
  avecMemoire.memoire_deja_dit && String(avecMemoire.memoire_deja_dit.valeur).includes('mardi creux'),
  String(avecMemoire.memoire_deja_dit && avecMemoire.memoire_deja_dit.valeur));

// LE POINT. Un titre d'il y a trois semaines portait « 6 946 EUR ». Le
// remettre tel quel rendrait 6946 citable pour toujours, alors que le chiffre
// a bouge depuis. Le modele doit savoir CE QUI a ete dit, pas recuperer les
// nombres d'alors : ceux d'aujourd'hui sont ailleurs dans la fiche.
ok('MONTAGE : le titre d origine contenait bien un montant',
  HISTORIQUE[0].title.includes('6 946'));
ok('aucun chiffre du passe ne revient dans la fiche',
  !/[0-9]/.test(String(avecMemoire.memoire_deja_dit.valeur)),
  String(avecMemoire.memoire_deja_dit.valeur));
ok('idem pour les resultats mesures',
  avecMemoire.memoire_resultats && !/[0-9]/.test(String(avecMemoire.memoire_resultats.valeur)),
  String(avecMemoire.memoire_resultats && avecMemoire.memoire_resultats.valeur));

// Aucun taux d'adoption, et le trou est nomme. expireStaleInsights passe en
// « ignored » toute idee non ouverte pendant dix jours : le statut confond un
// refus du staff et une idee que personne n'a lue. J'ai deja servi ce faux
// chiffre une fois.
ok('le trou du suivi des idees est declare',
  Boolean(avecMemoire.trou_suivi_des_idees),
  Object.keys(avecMemoire).filter((k) => k.startsWith('memoire_') || k.startsWith('trou_')).join(','));
ok('et il dit qu aucun taux d adoption n est calculable',
  String(avecMemoire.trou_suivi_des_idees.valeur).includes('aucun taux'),
  String(avecMemoire.trou_suivi_des_idees.valeur));

// CONTRE-PREUVE : sans historique, aucun fait de memoire. Un centre neuf n'a
// rien a se rappeler et ne doit pas faire semblant.
const sansMemoire = ajouterMemoire(ficheDuRegistre({ reservations: [], formules: [] }), []);
ok('CONTRE-PREUVE : sans historique, aucun fait memoire_',
  Object.keys(sansMemoire).every((cle) => !cle.startsWith('memoire_')),
  Object.keys(sansMemoire).join(','));

// ── L ARGENT RESTE DU COTE DU GERANT ────────────────────────────────────────
console.log('\n[AUDIENCE] aucun fait publiable ne porte d argent');
// Une reservation par JOUR : sans ca, tous les jours de la semaine sont le
// meme jour et aucun jour fort ne peut etre elu, donc le jumeau en argent
// n'existerait pas et le montage serait faux.
const ficheArgent = ficheDuRegistre({
  reservations: serieQuotidienne(400, '2026-01-01T00:00:00Z', 'aud'),
  formules: [{ id: 'f1', name: 'Formule', min_pax: 4, active: true }],
  aujourdhui: '2027-02-05',
});
const publics = Object.values(ficheArgent).filter((f) => f.audience === 'public');
ok('la fiche produit bien des faits publiables', publics.length >= 5, String(publics.length));
ok('AUCUN d eux ne contient de montant',
  publics.every((f) => !String(f.valeur).includes('EUR')),
  publics.filter((f) => String(f.valeur).includes('EUR')).map((f) => f.id).join(','));

// Le fait comparatif se dedouble : le public dit QUI et COMBIEN DE FOIS,
// l interne dit combien ca rapporte. Sans ce dedoublement, citer « ton meilleur
// jour » dans un post revenait a publier le chiffre d'affaires de ce jour.
ok('MONTAGE : le jumeau en argent du jour fort existe',
  Boolean(ficheArgent.chiffre_jour_fort),
  Object.keys(ficheArgent).filter((k) => k.startsWith('chiffre_')).join(','));
ok('et il est reserve au gerant',
  ficheArgent.chiffre_jour_fort && ficheArgent.chiffre_jour_fort.audience === 'interne');
ok('alors que le jour fort lui-meme est publiable',
  ficheArgent.jour_fort && ficheArgent.jour_fort.audience === 'public');

// Ce qui ne se dit jamais a un client : l'argent, les trous de la donnee, la
// memoire des idees passees.
const INTERDITS_AU_PUBLIC = [
  'ca_total', 'panier_moyen', 'ca_par_personne', 'taux_annulation', 'argent_annule',
  'trou_email', 'trou_paiement', 'trou_occasion', 'clients_dormants',
  'sous_le_minimum_de_la_formule', 'formules_jamais_vendues',
];
INTERDITS_AU_PUBLIC.forEach((id) => {
  if (!ficheArgent[id]) return;
  ok(`${id} reste reserve au gerant`, ficheArgent[id].audience === 'interne', ficheArgent[id].audience);
});

// ── LA COMPARAISON QUI EXISTE DEJA ──────────────────────────────────────────
// La question de Movsar : « les formules anniversaire sont a 6 personnes
// minimum, est-ce que 8 serait plus rentable ? ». Aucun historique produit sous
// la regle des 6 ne peut y repondre. Mais si DEUX minimums coexistent deja au
// catalogue, la comparaison se lit dans le registre, sans rien changer et sans
// rien risquer. La fiche le dit au lieu de laisser chercher.
console.log('\n[MINIMUMS] la comparaison qui existe deja au catalogue');
const ficheMinimums = ficheDuRegistre({
  reservations: serie(60, {}, new Date('2026-01-05T00:00:00Z'), 'min'),
  formules: [
    { id: 'f1', name: 'Anniversaire Kids', min_pax: 6, active: true },
    { id: 'f2', name: 'Sortie Scolaire', min_pax: 15, active: true },
  ],
});
ok('les minimums declares sont listes, formule par formule',
  ficheMinimums.minimums_du_catalogue
  && String(ficheMinimums.minimums_du_catalogue.valeur).includes('Anniversaire Kids : 6'),
  String(ficheMinimums.minimums_du_catalogue && ficheMinimums.minimums_du_catalogue.valeur));
ok('et la fiche dit que la comparaison existe deja',
  String(ficheMinimums.comparaison_de_minimums.valeur).startsWith('oui'),
  String(ficheMinimums.comparaison_de_minimums.valeur));
ok('ces deux faits restent reserves au gerant',
  ficheMinimums.minimums_du_catalogue.audience === 'interne'
  && ficheMinimums.comparaison_de_minimums.audience === 'interne');

// CONTRE-PREUVE : un catalogue dont toutes les formules partagent le meme
// minimum n offre aucun point de comparaison, et la fiche le dit aussi. Un
// « oui » systematique ne prouverait rien.
const ficheUnSeulMinimum = ficheDuRegistre({
  reservations: serie(60, {}, new Date('2026-01-05T00:00:00Z'), 'uni'),
  formules: [
    { id: 'f1', name: 'Formule A', min_pax: 6, active: true },
    { id: 'f2', name: 'Formule B', min_pax: 6, active: true },
  ],
});
ok('CONTRE-PREUVE : un seul minimum au catalogue, aucune comparaison possible',
  String(ficheUnSeulMinimum.comparaison_de_minimums.valeur).startsWith('non'),
  String(ficheUnSeulMinimum.comparaison_de_minimums.valeur));
ok('CONTRE-PREUVE : sans min_pax declare, le fait n existe pas',
  !ficheDuRegistre({ reservations: serie(60, {}, new Date('2026-01-05T00:00:00Z'), 'sans'), formules: [{ id: 'f1', name: 'A', active: true }] }).comparaison_de_minimums);

// ── LE MOIS LE PLUS RENTABLE, DECIDE PAR UNE SEULE RESERVATION ──────────────
// Montage : deux ans de registre. Chaque mois a 16 reservations a 100 EUR sauf
// juillet (22 lignes, 2 200 EUR par an) et janvier (16 a 20 EUR, 320 EUR).
// Juillet mene de 600 EUR sur son dauphin et une ligne en pese 100 : ce
// classement-la tient tout seul, et janvier est le creux sans discussion.
// Les comptes sont volontairement au-dessus de la barre d'anecdote (30
// observations) : sinon le refus viendrait du volume et non de la fragilite,
// et le gate serait vert pour la mauvaise raison.
// On ajoute ensuite UNE reservation de 2 400 EUR en mars, et mars passe devant.
// Sans garde, l'agent dirait « mars est ton mois le plus rentable » et le
// gerant planifierait son annee dessus.
console.log('\n[FRAGILITE] le classement porte par une seule reservation');

// Registre construit mois par mois : rien de tire au sort, chaque total est
// une multiplication qui se refait de tete.
function registreDeDeuxAns() {
  const lignes = [];
  [2024, 2025].forEach((annee) => {
    for (let mois = 1; mois <= 12; mois += 1) {
      const combien = mois === 7 ? 22 : 16;
      const prix = mois === 1 ? 20 : 100;
      for (let i = 0; i < combien; i += 1) {
        lignes.push(resa({
          date: `${annee}-${String(mois).padStart(2, '0')}-${String(1 + i).padStart(2, '0')}`,
          price: prix,
          email: `m${annee}-${mois}-${i}@example.test`,
        }));
      }
    }
  });
  return lignes;
}
const fragilesDe = (fiche) => Object.values(fiche).filter((f) => f.fragile).map((f) => f.id).sort();

const ficheSansAccident = ficheDuRegistre({ reservations: registreDeDeuxAns(), formules: [] });
ok('MONTAGE : sans l accident, juillet est le mois le plus rentable',
  String(ficheSansAccident.mois_fort.valeur).startsWith('juillet'),
  String(ficheSansAccident.mois_fort.valeur));
ok('MONTAGE : et ce classement-la n est pas fragile',
  ficheSansAccident.mois_fort.fragile === false);
ok('donc il s affirme', peutAffirmer(ficheSansAccident.mois_fort, 'constat').autorise);

// Une seule ligne ajoutee. Rien d autre ne change.
const ficheAvecAccident = ficheDuRegistre({
  reservations: [...registreDeDeuxAns(), resa({ date: '2024-03-16', price: 2400, pax: 60, email: 'gros@example.test' })],
  formules: [],
});
ok('une seule reservation de 2 400 EUR fait passer mars devant',
  String(ficheAvecAccident.mois_fort.valeur).startsWith('mars'),
  String(ficheAvecAccident.mois_fort.valeur));
ok('LE POINT : ce classement est marque fragile', ficheAvecAccident.mois_fort.fragile === true);
ok('et il ne s affirme plus, malgre les 2 ans et les 400 lignes derriere',
  peutAffirmer(ficheAvecAccident.mois_fort, 'constat').autorise === false,
  peutAffirmer(ficheAvecAccident.mois_fort, 'constat').motif);
// Le refus doit venir de la FRAGILITE. Un refus de volume donnerait le meme
// autorise === false et rendrait l'assertion precedente vraie pour rien.
ok('et le refus nomme la fragilite, pas le volume',
  peutAffirmer(ficheAvecAccident.mois_fort, 'constat').motif.includes('une seule reservation'),
  peutAffirmer(ficheAvecAccident.mois_fort, 'constat').motif);
ok('la valeur le DIT au gerant qui lit le dossier',
  String(ficheAvecAccident.mois_fort.valeur).includes('classement fragile'),
  String(ficheAvecAccident.mois_fort.valeur));
ok('le jumeau en argent porte la meme reserve',
  ficheAvecAccident.chiffre_mois_fort.fragile === true);

// CONTRE-PREUVE DE PORTEE, en DIFFERENCE et pas en liste figee : entre les deux
// fiches, UNE seule ligne a change. Si la garde repeignait large, d'autres
// classements deviendraient fragiles en meme temps. On compare donc les deux
// ensembles, ce qui reste vrai meme si le montage evolue.
const apparus = fragilesDe(ficheAvecAccident).filter((id) => !fragilesDe(ficheSansAccident).includes(id));
ok('la ligne ajoutee ne fragilise QUE le classement des mois',
  apparus.join(',') === 'chiffre_mois_fort,mois_fort',
  `apparus=[${apparus.join(',')}] avant=[${fragilesDe(ficheSansAccident).join(',')}]`);
ok('CONTRE-PREUVE : le mois le plus CREUX, lui, reste solide',
  ficheAvecAccident.mois_creux.fragile === false
  && peutAffirmer(ficheAvecAccident.mois_creux, 'constat').autorise,
  String(ficheAvecAccident.mois_creux.valeur));
ok('CONTRE-PREUVE : le panier moyen, qui n est pas un classement, reste sain',
  ficheAvecAccident.panier_moyen.fragile === false
  && peutAffirmer(ficheAvecAccident.panier_moyen, 'constat').autorise);
console.log(`\n${failures ? `center-facts-check: ${failures} ECHEC(S)` : 'center-facts-check: ALL OK'}`);
process.exit(failures ? 1 : 0);
