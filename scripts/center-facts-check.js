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
ok('et il dit que ces lignes-la sont HORS de tout taux d adoption',
  String(avecMemoire.trou_suivi_des_idees.valeur).includes('hors de tout taux d adoption'),
  String(avecMemoire.trou_suivi_des_idees.valeur));
ok('et il compte combien de lignes sont concernees',
  /^[0-9]+ idee/.test(String(avecMemoire.trou_suivi_des_idees.valeur)),
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

// ── LE FAIT DU SOMMEIL ──────────────────────────────────────────────────────
console.log('\n[SOMMEIL] la fiche dit quand elle a cesse de decrire le present');
const AUJOURDHUI = '2026-09-09';
const ilYA = (n) => new Date(Date.parse(`${AUJOURDHUI}T00:00:00Z`) - n * 86400000)
  .toISOString().slice(0, 10);
// 60 commandes tous les 2 jours : un rythme dense, donc un silence de 120
// jours est anormal pour ce centre-la.
const registreArrete = Array.from({ length: 60 }, (unused, i) => resa({
  date: ilYA(120 + (60 - i) * 2),
  created_at: `${ilYA(122 + (60 - i) * 2)}T10:00:00Z`,
  email: `arret${i}@example.test`,
}));
const ficheArretee = ficheDuRegistre({ reservations: registreArrete, formules: [], aujourdhui: AUJOURDHUI });
ok('la fiche porte la derniere activite', Boolean(ficheArretee.derniere_activite),
  ficheArretee.derniere_activite && String(ficheArretee.derniere_activite.valeur));
ok('et elle DIT que le registre ne bouge plus', Boolean(ficheArretee.registre_dormant));
ok('le fait donne le silence ET la reference qui le rend anormal',
  /aucune reservation depuis \d+ jours/.test(String((ficheArretee.registre_dormant || {}).valeur))
  && /plus long silence[^0-9]+\d+ jours/.test(String((ficheArretee.registre_dormant || {}).valeur)),
  String((ficheArretee.registre_dormant || {}).valeur));
ok('les deux restent reserves au gerant : ce n est pas un sujet de publication',
  ficheArretee.derniere_activite.audience === 'interne'
  && ficheArretee.registre_dormant.audience === 'interne');

// CONTRE-PREUVE 1 : le MEME registre, decale pour finir hier. Rien ne dort.
const registreVivant = Array.from({ length: 60 }, (unused, i) => resa({
  date: ilYA(1 + (60 - i) * 2),
  created_at: `${ilYA(3 + (60 - i) * 2)}T10:00:00Z`,
  email: `vivant${i}@example.test`,
}));
const ficheVivante = ficheDuRegistre({ reservations: registreVivant, formules: [], aujourdhui: AUJOURDHUI });
ok('CONTRE-PREUVE : le meme registre, frais, ne declenche rien',
  Boolean(ficheVivante.derniere_activite) && !ficheVivante.registre_dormant,
  ficheVivante.derniere_activite && String(ficheVivante.derniere_activite.valeur));

// CONTRE-PREUVE 2 : sans date du jour, aucun verdict. Une fiche calculee hors
// horloge ne doit pas inventer une dormance ni une fraicheur.
const ficheSansHorloge = ficheDuRegistre({ reservations: registreArrete, formules: [] });
ok('CONTRE-PREUVE : sans date du jour, ni fraicheur ni dormance',
  !ficheSansHorloge.derniere_activite && !ficheSansHorloge.registre_dormant);

// CONTRE-PREUVE 3 : le meme registre arrete, plus UN groupe attendu la semaine
// prochaine. Le centre n est pas mort, et aucune lecture de tendance ne doit
// pouvoir dire le contraire.
const ficheAvecClientAttendu = ficheDuRegistre({
  reservations: [...registreArrete, resa({
    date: ilYA(-7), created_at: `${ilYA(2)}T10:00:00Z`, email: 'groupe@example.test',
  })],
  formules: [], aujourdhui: AUJOURDHUI,
});
ok('CONTRE-PREUVE : un groupe attendu la semaine prochaine reveille le centre',
  !ficheAvecClientAttendu.registre_dormant,
  String((ficheAvecClientAttendu.registre_dormant || {}).valeur));

// Le melange d horloges : si UNE ligne n a pas de date de commande, tout le
// registre se lit a la date de venue. Sinon on compare la commande des unes a
// la venue des autres, et on fabrique des trous qui n ont jamais existe.
const registreSansCommande = registreArrete.map((r, i) => (i === 0 ? { ...r, created_at: null } : r));
const ficheUneSeuleHorloge = ficheDuRegistre({
  reservations: registreSansCommande, formules: [], aujourdhui: AUJOURDHUI,
});
ok('une seule ligne sans date de commande fait basculer TOUT le registre sur la venue',
  String((ficheUneSeuleHorloge.derniere_activite || {}).source).includes('date de venue'),
  String((ficheUneSeuleHorloge.derniere_activite || {}).source));
ok('CONTRE-PREUVE : quand toutes les lignes la portent, c est la commande qui parle',
  String(ficheArretee.derniere_activite.source).includes('date de commande'),
  String(ficheArretee.derniere_activite.source));

// ── UN CENTRE SANS OFFRE DECLAREE LE DIT ────────────────────────────────────
// Mesure du 2026-09-09 sur la vraie configuration : Libramont declare 8
// activites, Gembloux 6, Ciney ZERO. Rien ne le disait. Un agent muet sur
// l offre d un centre ressemblait a un agent sans idees, alors que c est une
// configuration vide.
console.log('\n[IDENTITE] la configuration vide se dit, elle ne se devine pas');

const identiteVide = ajouterIdentite(ficheDuRegistre({ reservations: [], formules: [] }), { centerId: 'test', activities: [] });
ok('aucune activite declaree : la fiche le DIT', Boolean(identiteVide.identite_absente));
ok('et elle dit la consequence : toute mention d une activite sera refusee',
  /toute mention d une activite sera refusee/.test(String((identiteVide.identite_absente || {}).valeur)),
  String((identiteVide.identite_absente || {}).valeur));
ok('le fait reste reserve au gerant : c est un trou de configuration, pas un sujet public',
  (identiteVide.identite_absente || {}).audience === 'interne');

// CONTRE-PREUVE : un centre configure ne porte pas ce fait, et porte la liste.
const identitePleine = ajouterIdentite(ficheDuRegistre({ reservations: [], formules: [] }), { centerId: 'test', activities: ['Bowling', 'Laser game'] });
ok('CONTRE-PREUVE : un centre configure ne declare aucun trou',
  !identitePleine.identite_absente && Boolean(identitePleine.identite_activites));

// ── AUCUNE ACTIVITE N EST SUPPOSEE PRESENTE ─────────────────────────────────
// La table qui traduit une activite en mots interdits mappait golf, karting,
// duckpin, billard... et PAS bowling ni laser game. Ces deux-la etaient donc
// supposees partout : sur un centre qui ne declare rien, « nos pistes de
// bowling » passait alors que « billard » etait refuse. L asymetrie ETAIT le
// trou. On le verifie sur la VRAIE configuration, pas sur un montage.
console.log('\n[IDENTITE] sur la vraie configuration des trois centres');
const { buildCenterFacts: identiteReelle } = require('../lib/marketing-agents');
const interditesDe = (centre) => new Set((identiteReelle(centre) || {}).forbiddenClaims || []);
const declareesDe = (centre) => ((identiteReelle(centre) || {}).activities || []).length;

ok('MONTAGE : Libramont et Gembloux sont configures, un troisieme centre ne l est pas',
  declareesDe('libramont') > 0 && declareesDe('gembloux') > 0 && declareesDe('ciney') === 0,
  `libramont=${declareesDe('libramont')} gembloux=${declareesDe('gembloux')} ciney=${declareesDe('ciney')}`);
ok('un centre qui DECLARE le bowling peut en parler',
  !interditesDe('libramont').has('bowling') && !interditesDe('gembloux').has('bowling'));
ok('un centre qui ne declare RIEN ne peut pas parler de bowling',
  interditesDe('ciney').has('bowling'));
ok('ni de laser game', interditesDe('ciney').has('laser game'));
// CONTRE-PREUVE de symetrie : le billard etait deja verifie, il l est encore.
// Si seul le nouveau mot mordait, la regle serait un cas particulier de plus.
ok('CONTRE-PREUVE : le billard, deja verifie avant, se comporte pareil',
  !interditesDe('libramont').has('billard') && interditesDe('ciney').has('billard'));

// ── UNE DUREE PROMISE EST CELLE QUE LE CENTRE DECLARE ───────────────────────
// Mesure du 2026-09-09 sur la configuration reelle : Libramont declare
// « parties de 20 minutes », « 500 m2 », « a partir de 130 cm ». Ces trois
// chiffres sont DANS la fiche, et rien ne les verifiait : « une session de 90
// minutes » passait alors que « nos 12 pistes » etait deja refuse. Ce n etait
// pas une regle plus faible, c etait une liste incomplete.
console.log('\n[UNITES] duree, surface et taille se verifient comme les pistes');
const identitePourUnites = require('../lib/marketing-agents').buildCenterFacts('libramont');
const { unitesIncoherentes: unitesDuTexte, couplesChiffreUnite: couplesDuTexte } = require('../lib/center-guards');
const ficheAvecUnites = ajouterIdentite(
  ficheDuRegistre({ reservations: serie(60), formules: [], aujourdhui: '2026-07-01' }),
  identitePourUnites,
);

ok('MONTAGE : le centre declare bien une duree de partie',
  /parties de \d+ minutes/.test(String((ficheAvecUnites.identite_laser_game || {}).valeur)),
  String((ficheAvecUnites.identite_laser_game || {}).valeur));
ok('MONTAGE : la duree est LUE comme un couple chiffre + unite',
  couplesDuTexte(ficheAvecUnites.identite_laser_game.valeur).some((c) => c.unite === 'minute'),
  JSON.stringify(couplesDuTexte(ficheAvecUnites.identite_laser_game.valeur)));

[
  ['Notre session de laser dure 90 minutes.', 'minute'],
  ['Le laser, c est 1000 m2 de jeu.', 'm2'],
  ['A partir de 100 cm.', 'cm'],
].forEach(([texte, unite]) => {
  const fautes = unitesDuTexte(texte, ficheAvecUnites);
  ok(`une ${unite} promise que le centre ne declare pas est refusee`,
    fautes.some((f) => f.includes(unite)), JSON.stringify(fautes));
});

// CONTRE-PREUVE : les VRAIES valeurs passent. Une garde qui bloquerait la
// verite rendrait l agent muet sur ce qu il a de plus concret a dire.
[
  'Parties de 20 minutes au laser.',
  '500 m2 de terrain de jeu.',
  'A partir de 130 cm.',
  '8 pistes de bowling.',
].forEach((texte) => {
  ok(`CONTRE-PREUVE : "${texte}" passe`, unitesDuTexte(texte, ficheAvecUnites).length === 0,
    JSON.stringify(unitesDuTexte(texte, ficheAvecUnites)));
});

// CONTRE-PREUVE de portee : les unites volontairement laissees dehors restent
// libres. « 2 ans de reservations » et « 670 jours » sans activite parlent de
// la donnee, pas d une promesse commerciale.
ok('CONTRE-PREUVE : une duree de donnee en annees reste libre',
  unitesDuTexte('Le registre couvre 2 ans de reservations.', ficheAvecUnites).length === 0);
ok('CONTRE-PREUVE : un nombre de jours reste libre',
  unitesDuTexte('Aucune reservation depuis 670 jours.', ficheAvecUnites).length === 0);

// ── UN JOUR OUVERT QUI NE VEND RIEN ────────────────────────────────────────
// parJour vient DES RESERVATIONS : un jour sans reservation n est pas un
// candidat perdant, il n existe pas. jour_creux elit donc le moins rempli
// PARMI CEUX QUI ONT VENDU. Mesure du 2026-09-09 sur la configuration reelle :
// Libramont declare ouvrir le mardi de 14:00 a 22:00 ; sur un registre ou
// aucun mardi n a jamais vendu, la fiche annonçait « jour_creux = dimanche,
// 79 reservations » et ne nommait le mardi dans aucun de ses 51 faits.
console.log('\n[JOUR MUET] un jour d ouverture qui ne vend rien devient visible');

// MONTAGE 1 : la configuration REELLE declare bien le mardi ouvert et le
// lundi ferme. Sans ca, ce gate testerait un centre imaginaire.
const grilleReelle = require('../lib/ops-knowledge').getCenter('libramont').defaultSchedule;
ok('MONTAGE : Libramont declare une vraie grille horaire',
  grilleReelle && typeof grilleReelle === 'object' && grilleReelle.regular
  && typeof grilleReelle.regular['2'] === 'object' && grilleReelle.regular['1'] === null,
  JSON.stringify(grilleReelle && grilleReelle.regular));
const joursOuvertsReels = Object.entries(grilleReelle.regular)
  .filter(([, plage]) => plage && typeof plage === 'object').map(([jour]) => Number(jour));
ok('MONTAGE : six jours ouverts declares, le lundi n en fait pas partie',
  joursOuvertsReels.length === 6 && !joursOuvertsReels.includes(1), JSON.stringify(joursOuvertsReels));

// Un registre qui vend tous les jours ouverts SAUF le mardi. Les volumes
// varient d un jour a l autre : a egalite parfaite il n y a ni meilleur ni
// pire jour, et la contre-preuve sur jour_creux ne testerait rien.
function registreSansMardi(semaines, sansCeJour = 2) {
  const lignes = [];
  let curseur = Date.parse('2026-01-04T00:00:00Z'); // un dimanche
  for (let semaine = 0; semaine < semaines; semaine += 1) {
    joursOuvertsReels.filter((j) => j !== sansCeJour).forEach((jour, rang) => {
      const combien = 1 + ((semaine + rang) % 3);
      for (let k = 0; k < combien; k += 1) {
        const d = new Date(curseur + jour * 86400000);
        lignes.push(resa({
          date: d.toISOString().slice(0, 10),
          email: `muet${semaine}-${rang}-${k}@example.test`,
          created_at: new Date(curseur + jour * 86400000 - 6 * 86400000).toISOString(),
        }));
      }
    });
    curseur += 7 * 86400000;
  }
  return lignes;
}
const lignesMuettes = registreSansMardi(40);

// MONTAGE 2 : le registre ne contient VRAIMENT aucun mardi, et le mardi s est
// VRAIMENT presente 40 fois dans la fenetre. Le denominateur est compte ici a
// la main, independamment du code teste : si les deux comptes divergent, c est
// le code qui a tort, pas le gate.
const mardisDuRegistre = lignesMuettes.filter((r) => new Date(`${r.date}T00:00:00Z`).getUTCDay() === 2).length;
ok('MONTAGE : aucune reservation un mardi dans ce registre', mardisDuRegistre === 0, String(mardisDuRegistre));
const datesTriees = lignesMuettes.map((r) => r.date).sort();
let mardisDeLaFenetre = 0;
for (let t = Date.parse(`${datesTriees[0]}T00:00:00Z`); t <= Date.parse(`${datesTriees[datesTriees.length - 1]}T00:00:00Z`); t += 86400000) {
  if (new Date(t).getUTCDay() === 2) mardisDeLaFenetre += 1;
}
ok('MONTAGE : la fenetre couvre bien 40 mardis', mardisDeLaFenetre === 40, String(mardisDeLaFenetre));

const ficheMuette = ficheDuRegistre({
  reservations: lignesMuettes, formules: [], aujourdhui: '2026-10-15', joursOuverts: joursOuvertsReels,
});
const faitMuet = ficheMuette.jour_ouvert_sans_vente;
ok('le jour ouvert sans vente est POSE', Boolean(faitMuet), JSON.stringify(faitMuet && faitMuet.valeur));
ok('il nomme le mardi', Boolean(faitMuet) && /mardi/.test(String(faitMuet.valeur)));
ok('il porte son denominateur, le meme que le compte independant',
  Boolean(faitMuet) && Number(faitMuet.n) === mardisDeLaFenetre,
  `${faitMuet && faitMuet.n} vs ${mardisDeLaFenetre}`);
ok('il ne nomme PAS le lundi, que le centre declare ferme',
  Boolean(faitMuet) && !/lundi/.test(String(faitMuet.valeur)));
ok('il reste INTERNE : « personne ne vient le mardi » ne se publie pas',
  Boolean(faitMuet) && faitMuet.audience === 'interne', String(faitMuet && faitMuet.audience));

// CE QUE LE CLASSEMENT DISAIT A LA PLACE. Sans cette assertion on ne saurait
// pas si le nouveau fait apporte quelque chose ou repete jour_creux.
ok('CONTRE-PREUVE : jour_creux, lui, elit un jour qui a VENDU',
  Boolean(ficheMuette.jour_creux) && !/mardi/.test(String(ficheMuette.jour_creux.valeur)),
  String(ficheMuette.jour_creux && ficheMuette.jour_creux.valeur));

// FAIL-OPEN : sans horaire declare (Gembloux porte une chaine sentinelle,
// Ciney aussi), aucun fait. On ne constate que ce qu on peut comparer, et on
// n emprunte jamais la grille d un autre centre.
ok('FAIL-OPEN : sans horaire declare, aucun fait',
  !ficheDuRegistre({ reservations: lignesMuettes, formules: [], aujourdhui: '2026-10-15' }).jour_ouvert_sans_vente);

// LA DERIVATION ELLE-MEME, sur les TROIS configurations reelles. C est le
// point ou un centre pourrait heriter de la grille du voisin : Gembloux porte
// litteralement « same_as_libramont_public_schedule », et resoudre cette
// phrase en code donnerait a Gembloux les horaires de Libramont.
const { joursOuvertsDeclares, occurrencesDuJour } = require('../lib/center-facts');
const { getCenter: centreDeclare } = require('../lib/ops-knowledge');
ok('MONTAGE : Gembloux porte bien une CHAINE au lieu d une grille',
  typeof centreDeclare('gembloux').defaultSchedule === 'string',
  JSON.stringify(centreDeclare('gembloux').defaultSchedule));
ok('Libramont : six jours ouverts derives de sa propre grille',
  JSON.stringify((joursOuvertsDeclares(centreDeclare('libramont').defaultSchedule) || []).sort((a, b) => a - b)) === '[0,2,3,4,5,6]',
  JSON.stringify(joursOuvertsDeclares(centreDeclare('libramont').defaultSchedule)));
ok('CLOISONNEMENT : Gembloux n herite d AUCUN jour, malgre le texte qui renvoie a Libramont',
  joursOuvertsDeclares(centreDeclare('gembloux').defaultSchedule) === null);
ok('CLOISONNEMENT : Ciney non plus',
  joursOuvertsDeclares(centreDeclare('ciney').defaultSchedule) === null);
ok('une grille ou tous les jours sont a null ne declare aucune ouverture',
  joursOuvertsDeclares({ regular: { 0: null, 1: null } }) === null);
ok('une grille partielle rend le seul jour pose',
  JSON.stringify(joursOuvertsDeclares({ regular: { 6: { open: '10:00', close: '18:00' } } })) === '[6]');

// LE BORD DE LA FENETRE, teste directement. Une borne exclusive perdrait une
// occurrence quand la fenetre FINIT sur le jour compte. Ce cas ne peut jamais
// se produire a travers le fait : un jour muet n a par definition aucune
// reservation, donc il ne peut pas fermer la fenetre du registre. Trouve par
// mutation : passer `t <= fin` a `t < fin` laissait tout vert.
ok('le denominateur compte les DEUX bornes',
  occurrencesDuJour(2, '2026-01-06', '2026-01-20') === 3,
  String(occurrencesDuJour(2, '2026-01-06', '2026-01-20')));
ok('zero quand le jour ne tombe pas dans la fenetre',
  occurrencesDuJour(2, '2026-01-07', '2026-01-12') === 0,
  String(occurrencesDuJour(2, '2026-01-07', '2026-01-12')));
ok('zero sur une fenetre absurde ou sans date', occurrencesDuJour(2, '2026-02-01', '2026-01-01') === 0
  && occurrencesDuJour(2, '', '2026-01-20') === 0);

// MATURITE : un jour qui ne s est presente que trois fois ne se declare pas
// muet. Sans ce filtre, un registre de deux semaines rendrait cinq jours muets.
const ficheCourte = ficheDuRegistre({
  reservations: registreSansMardi(3), formules: [], aujourdhui: '2026-01-26', joursOuverts: joursOuvertsReels,
});
ok('MATURITE : trois semaines ne suffisent pas a declarer un jour muet',
  !ficheCourte.jour_ouvert_sans_vente,
  String(ficheCourte.jour_ouvert_sans_vente && ficheCourte.jour_ouvert_sans_vente.valeur));

// CONTRE-PREUVE : un centre qui vend TOUS ses jours ouverts ne recoit rien.
// Une garde qui accuserait un centre sain serait pire que le trou comble.
const ficheSaine = ficheDuRegistre({
  reservations: registreSansMardi(40, -1), formules: [], aujourdhui: '2026-10-15', joursOuverts: joursOuvertsReels,
});
ok('CONTRE-PREUVE : un centre qui vend tous ses jours ouverts ne recoit rien',
  !ficheSaine.jour_ouvert_sans_vente,
  String(ficheSaine.jour_ouvert_sans_vente && ficheSaine.jour_ouvert_sans_vente.valeur));

// ── L AGENDA REEL DU CENTRE ────────────────────────────────────────────────
// La fiche ne regardait jamais le calendrier d ouverture : ni les jours forces
// « vacances », ni la grille des vacances scolaires, ni une fermeture posee a
// la main par le staff. Le moteur de RESERVATION lit les trois depuis toujours.
// L agent conseillait donc « publie un rappel pour ton creneau de 18 h » sans
// savoir si le centre ouvrait ce jour-la.
console.log('\n[AGENDA] l agent sait quand le centre ouvre, et quand il ferme');
const { agendaDuCentre } = require('../lib/center-facts');
const { getCenter: centrePourAgenda } = require('../lib/ops-knowledge');
const { normalizeBlockRow } = require('../lib/availability-blocks');
const centreReel = centrePourAgenda('libramont');

// MONTAGE : la configuration REELLE ferme le lundi et ouvre le samedi de 10 h
// a minuit. Sans ca, ce gate decrirait un centre imaginaire.
ok('MONTAGE : le lundi est ferme par la grille', centreReel.defaultSchedule.regular['1'] === null);
ok('MONTAGE : le samedi ouvre a 10 h et ferme a 24 h',
  centreReel.defaultSchedule.regular['6'].open === '10:00'
  && centreReel.defaultSchedule.regular['6'].close === '24:00',
  JSON.stringify(centreReel.defaultSchedule.regular['6']));

const blocDe = (o) => normalizeBlockRow({
  id: 1, center_id: 'libramont', scope_type: 'center', scope_ref: null,
  recurrence: 'once', date: null, day_of_week: null, date_from: null, date_until: null,
  start_time: null, end_time: null, reason: '', created_by: 'staff', ...o,
});

// 2026-09-14 est un lundi. La fenetre couvre donc un lundi ferme par la grille,
// un samedi ouvert, et ce que le staff pose par-dessus.
const agendaSansBloc = agendaDuCentre(centreReel, [], '2026-09-14', 7);
ok('la grille du centre est resolue jour par jour', agendaSansBloc.length === 7);
ok('le lundi est un jour NON OUVERT, pas une fermeture exceptionnelle',
  agendaSansBloc[0].ouvert === false && agendaSansBloc[0].ferme === false,
  JSON.stringify(agendaSansBloc[0]));
ok('le samedi porte sa vraie plage',
  agendaSansBloc[5].ouvert === true && agendaSansBloc[5].plage === '10h - Minuit',
  JSON.stringify(agendaSansBloc[5]));

// UNE FERMETURE PONCTUELLE, et une RECURRENTE avec sa plage horaire.
const blocsDuStaff = [
  blocDe({ id: 1, date: '2026-09-19', reason: 'travaux electriques' }),
  blocDe({
    id: 2, recurrence: 'weekly', day_of_week: 3, date_from: '2026-09-01',
    date_until: '2026-12-31', start_time: '12:00', end_time: '23:00', reason: 'fermeture mercredi',
  }),
];
const agendaAvecBlocs = agendaDuCentre(centreReel, blocsDuStaff, '2026-09-14', 7);
ok('une fermeture ponctuelle ferme le jour, avec sa raison',
  agendaAvecBlocs[5].ferme === true && agendaAvecBlocs[5].raisons.includes('travaux electriques'),
  JSON.stringify(agendaAvecBlocs[5]));
ok('une fermeture recurrente aussi',
  agendaAvecBlocs[2].ferme === true && agendaAvecBlocs[2].raisons.includes('fermeture mercredi'),
  JSON.stringify(agendaAvecBlocs[2]));
ok('CONTRE-PREUVE : les autres jours restent ouverts',
  agendaAvecBlocs[1].ferme === false && agendaAvecBlocs[6].ferme === false,
  JSON.stringify([agendaAvecBlocs[1], agendaAvecBlocs[6]]));

// UNE FERMETURE PARTIELLE NE FERME PAS LA JOURNEE. Deux heures de coupure un
// samedi de 10 h a minuit laissent le centre ouvert : dire « ferme » serait
// aussi faux que de dire « ouvert » un jour de travaux.
const agendaPartiel = agendaDuCentre(centreReel, [
  blocDe({ id: 3, date: '2026-09-19', start_time: '14:00', end_time: '16:00', reason: 'maintenance' }),
], '2026-09-14', 7);
ok('une coupure de deux heures ne ferme pas la journee',
  agendaPartiel[5].ferme === false, JSON.stringify(agendaPartiel[5]));
ok('mais elle est RENDUE : ne pas fermer le jour ne veut pas dire se taire',
  agendaPartiel[5].coupures.length === 1
  && agendaPartiel[5].coupures[0].raison === 'maintenance',
  JSON.stringify(agendaPartiel[5].coupures));
const ficheAvecCoupure = ficheDuRegistre({
  reservations: [], formules: [], aujourdhui: '2026-09-14', agenda: agendaPartiel,
});
ok('et le fait la porte en clair, avec ses heures',
  /coupure de 14 h a 16 h \(maintenance\)/.test(String(ficheAvecCoupure.agenda_ouverture.valeur)),
  String(ficheAvecCoupure.agenda_ouverture.valeur));
ok('CONTRE-PREUVE : une coupure ne fabrique pas une fermeture a venir',
  !ficheAvecCoupure.fermetures_a_venir);

// LES FAITS, SUR UN REGISTRE VIDE. C est precisement la qu on a besoin de
// savoir si le centre ouvre : l agenda parle du CENTRE, pas du registre.
const ficheSansRegistre = ficheDuRegistre({
  reservations: [], formules: [], aujourdhui: '2026-09-14',
  agenda: agendaDuCentre(centreReel, blocsDuStaff, '2026-09-14', 14),
});
ok('MONTAGE : le registre est bien vide', Boolean(ficheSansRegistre.registre_vide));
ok('l agenda est pose malgre un registre vide', Boolean(ficheSansRegistre.agenda_ouverture),
  String(ficheSansRegistre.agenda_ouverture && ficheSansRegistre.agenda_ouverture.valeur));
ok('les fermetures a venir sont nommees avec leur raison',
  Boolean(ficheSansRegistre.fermetures_a_venir)
  && /travaux electriques/.test(String(ficheSansRegistre.fermetures_a_venir.valeur)),
  String(ficheSansRegistre.fermetures_a_venir && ficheSansRegistre.fermetures_a_venir.valeur));
ok('ces faits restent INTERNES : une fermeture se communique par decision du gerant',
  ficheSansRegistre.agenda_ouverture.audience === 'interne'
  && ficheSansRegistre.fermetures_a_venir.audience === 'interne');
ok('CONTRE-PREUVE : le centre n est PAS declare ferme, il ouvre les autres jours',
  !ficheSansRegistre.centre_ferme);

// AUCUN JOUR OUVERT DANS LA FENETRE : fermeture annuelle, travaux, saison.
const fermeturePartout = [0, 1, 2, 3, 4, 5, 6].map((jour) => blocDe({
  id: 10 + jour, recurrence: 'weekly', day_of_week: jour,
  date_from: '2026-09-01', date_until: '2026-12-31', reason: 'fermeture annuelle',
}));
const ficheCentreFerme = ficheDuRegistre({
  reservations: [], formules: [], aujourdhui: '2026-09-14',
  agenda: agendaDuCentre(centreReel, fermeturePartout, '2026-09-14', 14),
});
ok('un centre qui n ouvre aucun jour le dit', Boolean(ficheCentreFerme.centre_ferme),
  String(ficheCentreFerme.centre_ferme && ficheCentreFerme.centre_ferme.valeur));

// FAIL-OPEN : sans agenda, aucun fait. On ne constate que ce qu on peut lire.
const ficheSansAgenda = ficheDuRegistre({ reservations: [], formules: [], aujourdhui: '2026-09-14' });
ok('FAIL-OPEN : sans agenda, aucun fait d ouverture',
  !ficheSansAgenda.agenda_ouverture && !ficheSansAgenda.fermetures_a_venir && !ficheSansAgenda.centre_ferme);
ok('FAIL-OPEN : une date absente ne fabrique pas d agenda',
  agendaDuCentre(centreReel, [], '', 7).length === 0);
ok('FAIL-OPEN : un centre absent non plus', agendaDuCentre(null, [], '2026-09-14', 7).length === 0);

// ── LE STATUT DECLARE DU CENTRE ────────────────────────────────────────────
// Le produit connait trois statuts : active, planned, closed. Le cerveau de
// l agent n en lisait AUCUN. Ciney est declare `planned` aujourd hui : un
// centre qui n ouvre pas encore, et qui recevrait les memes conseils au present
// qu un centre ouvert des que son registre porterait de l histoire.
console.log('\n[STATUT] un centre qui n est pas actif le dit');
ok('MONTAGE : Ciney est bien declare planned dans la configuration reelle',
  require('../lib/ops-knowledge').getCenter('ciney').status === 'planned',
  String(require('../lib/ops-knowledge').getCenter('ciney').status));

ok('un centre actif ne pose aucun fait de statut',
  !ficheDuRegistre({ reservations: [], formules: [], aujourdhui: '2026-09-10', statut: 'active' }).statut_du_centre);
const fichePlanned = ficheDuRegistre({ reservations: [], formules: [], aujourdhui: '2026-09-10', statut: 'planned' });
ok('un centre planned le dit, et dit qu il n ouvre pas ENCORE',
  Boolean(fichePlanned.statut_du_centre) && /n ouvre pas encore/.test(String(fichePlanned.statut_du_centre.valeur)),
  String(fichePlanned.statut_du_centre && fichePlanned.statut_du_centre.valeur));
const ficheClosed = ficheDuRegistre({ reservations: [], formules: [], aujourdhui: '2026-09-10', statut: 'closed' });
ok('un centre closed aussi', Boolean(ficheClosed.statut_du_centre)
  && /closed/.test(String(ficheClosed.statut_du_centre.valeur)),
  String(ficheClosed.statut_du_centre && ficheClosed.statut_du_centre.valeur));
ok('le fait reste INTERNE : le statut d un centre ne se publie pas',
  fichePlanned.statut_du_centre.audience === 'interne');
ok('il est pose MALGRE un registre vide, comme l agenda : il parle du centre',
  Boolean(fichePlanned.registre_vide) && Boolean(fichePlanned.statut_du_centre));

// FAIL-OPEN : sans statut transmis, aucun fait. La fiche ne suppose pas
// qu un centre est ferme parce qu elle ne sait pas.
ok('FAIL-OPEN : sans statut, aucun fait',
  !ficheDuRegistre({ reservations: [], formules: [], aujourdhui: '2026-09-10' }).statut_du_centre);
ok('FAIL-OPEN : un statut vide non plus',
  !ficheDuRegistre({ reservations: [], formules: [], aujourdhui: '2026-09-10', statut: '   ' }).statut_du_centre);

// ── UNE ACTIVITE BLOQUEE TOUTE LA FENETRE NE SE VEND PLUS ──────────────────
// Le gerant bloque « Laser Game » dans la console ops (portee activity, jour
// entier). Le tunnel de reservation repond deja « Laser Game bloque » au
// client. L agent marketing, lui, lisait la liste des activites DECLAREES et
// pouvait ecrire « viens tester notre laser game ce week-end ».
console.log('\n[ACTIVITES] ce que le centre ne peut pas honorer sur la fenetre');
const { activitesIndisponibles } = require('../lib/center-facts');
const { getCenter: centrePourBlocs } = require('../lib/ops-knowledge');
const centreBloc = centrePourBlocs('libramont');

// MONTAGE : sans lui, tout ce qui suit teste un centre qui n a pas de laser.
ok('MONTAGE : Libramont declare bien un laser game',
  centreBloc.activityAvailability.laser_game === true,
  JSON.stringify(centreBloc.activityAvailability));

const agendaTrois = [
  { date: '2026-09-10', ouvert: true, ferme: false },
  { date: '2026-09-11', ouvert: true, ferme: false },
  { date: '2026-09-12', ouvert: true, ferme: false },
  { date: '2026-09-13', ouvert: false, ferme: false },
];
const blocActivite = (date, ref, over = {}) => ({
  id: 1, centerId: 'libramont', scopeType: 'activity', scopeRef: ref,
  recurrence: 'once', date, dayOfWeek: null, dateFrom: null, dateUntil: null,
  startMin: null, endMin: null, reason: 'maintenance', createdBy: 'gerant', ...over,
});
const troisJours = (ref, over = {}) => ['2026-09-10', '2026-09-11', '2026-09-12']
  .map((d) => blocActivite(d, ref, over));

ok('sans aucun bloc, aucune activite n est indisponible',
  activitesIndisponibles(centreBloc, [], agendaTrois).length === 0,
  JSON.stringify(activitesIndisponibles(centreBloc, [], agendaTrois)));
ok('LE POINT : bloquee sur CHAQUE jour ouvert, l activite sort',
  activitesIndisponibles(centreBloc, troisJours('laser_game'), agendaTrois).includes('laser_game'),
  JSON.stringify(activitesIndisponibles(centreBloc, troisJours('laser_game'), agendaTrois)));

// AUCUN SEUIL. Un jour ouvert qui reste, et le centre a toujours son laser :
// le dire resterait vrai, donc on ne l interdit pas.
ok('un seul jour ouvert epargne, et l activite reste vendable',
  !activitesIndisponibles(
    centreBloc, troisJours('laser_game').slice(0, 2), agendaTrois,
  ).includes('laser_game'),
  JSON.stringify(activitesIndisponibles(centreBloc, troisJours('laser_game').slice(0, 2), agendaTrois)));

// UNE PLAGE HORAIRE N EST PAS UNE FERMETURE. isActivityFullyBlockedOn le dit
// deja au tunnel ; la fiche applique le MEME predicat, donc le meme verdict.
ok('un blocage de PLAGE horaire ne retire pas l activite',
  !activitesIndisponibles(
    centreBloc, troisJours('laser_game', { startMin: 840, endMin: 1080 }), agendaTrois,
  ).includes('laser_game'),
  'un blocage partiel a ete traite comme une fermeture');

// Une activite que le centre N A PAS ne devient pas « indisponible » : elle
// est deja interdite en permanence par forbiddenClaims, et la faire
// apparaitre ici ferait croire a une panne.
ok('une activite non declaree ne devient pas indisponible',
  !activitesIndisponibles(centreBloc, troisJours('karting_vr'), agendaTrois).includes('karting_vr'),
  'une activite absente du centre est ressortie comme bloquee');

// Aucun jour ouvert : c est le CENTRE qui est ferme. centre_ferme le dit
// deja, et mieux ; lister toutes les activites ici serait un doublon bruyant.
ok('sans un seul jour ouvert, la liste est vide (c est centre_ferme qui parle)',
  activitesIndisponibles(centreBloc, troisJours('laser_game'),
    agendaTrois.map((j) => ({ ...j, ouvert: false }))).length === 0,
  'une fermeture de centre a produit une liste d activites');

// Un jour FERME (bloc de centre) ne compte pas comme jour ouvert : sinon une
// activite bloquee tous les jours SAUF un jour de fermeture serait declaree
// vendable, alors que ce jour-la personne n entre.
ok('un jour ferme ne sauve pas une activite bloquee partout ailleurs',
  activitesIndisponibles(
    centreBloc, troisJours('laser_game').slice(0, 2),
    [agendaTrois[0], agendaTrois[1], { ...agendaTrois[2], ferme: true }, agendaTrois[3]],
  ).includes('laser_game'),
  'un jour de fermeture a ete compte comme jour de vente');

// ── LE FAIT ────────────────────────────────────────────────────────────────
const ficheBloquee = ficheDuRegistre({
  reservations: [], formules: [], aujourdhui: '2026-09-10',
  activitesBloquees: [{ id: 'laser_game', nom: 'Laser Game', mots: ['laser game', 'lasergame'] }],
});
ok('le fait activites_indisponibles est pose',
  Boolean(ficheBloquee.activites_indisponibles),
  JSON.stringify(Object.keys(ficheBloquee)));
ok('il nomme l activite en clair pour le gerant',
  String(ficheBloquee.activites_indisponibles.valeur) === 'Laser Game',
  String(ficheBloquee.activites_indisponibles.valeur));
ok('il est INTERNE : la liste des pannes ne se publie pas',
  ficheBloquee.activites_indisponibles.audience === 'interne',
  ficheBloquee.activites_indisponibles.audience);
ok('il porte les mots que la garde devra chercher',
  ficheBloquee.activites_indisponibles.motsInterdits.join('|') === 'laser game|lasergame',
  JSON.stringify(ficheBloquee.activites_indisponibles.motsInterdits));
ok('il est pose MALGRE un registre vide : il parle du centre, pas du registre',
  Boolean(ficheBloquee.registre_vide) && Boolean(ficheBloquee.activites_indisponibles));
ok('un fait ordinaire ne porte aucun mot interdit',
  Array.isArray(ficheBloquee.registre_vide.motsInterdits)
  && ficheBloquee.registre_vide.motsInterdits.length === 0,
  JSON.stringify(ficheBloquee.registre_vide.motsInterdits));
ok('FAIL-OPEN : sans liste transmise, aucun fait',
  !ficheDuRegistre({ reservations: [], formules: [], aujourdhui: '2026-09-10' }).activites_indisponibles);

// ── LES PRIX QUE LE CENTRE PEUT REELLEMENT TENIR ──────────────────────────
console.log('\n[PRIX] un prix ne se publie qu avec ce qui le conditionne');
const { prixReservables } = require('../lib/center-facts');
const { getCenter: centrePourPrix } = require('../lib/ops-knowledge');
const centrePrix = centrePourPrix('libramont');

// Quatre jours ouverts, dont UN SEUL jeudi (le 2026-09-10 est un jeudi).
const agendaPrix = [
  { date: '2026-09-10', ouvert: true, ferme: false },
  { date: '2026-09-11', ouvert: true, ferme: false },
  { date: '2026-09-12', ouvert: true, ferme: false },
  { date: '2026-09-13', ouvert: true, ferme: false },
];
ok('MONTAGE : le 2026-09-10 est bien un jeudi',
  new Date('2026-09-10T00:00:00').getDay() === 4,
  String(new Date('2026-09-10T00:00:00').getDay()));

// `ressources: []` sur chacun : ces tarifs isolent UNE condition a la fois
// (unite, jour, heure, minimum), et ne consomment donc ni piste ni arene.
// Une formule qui ne dit pas ce qu elle consomme n est pas publiable depuis
// le patch 47 : l omettre ici testerait une formule qui ne peut pas exister.
const TARIFS = [
  // La moins chere de toutes, mais A LA PISTE : autre unite.
  { id: 'tp', name: 'TARIF PISTE', price: 9, type: 'per_lane', minPax: 1, ressources: [] },
  // La moins chere PAR PERSONNE, mais le JEUDI seulement.
  { id: 'tj', name: 'TARIF JEUDI', price: 12, type: 'per_pax', minPax: 1, validDays: [4], ressources: [] },
  // Moins chere que la suivante, mais AVANT 12 h seulement.
  { id: 'tm', name: 'TARIF MATIN', price: 15, type: 'per_pax', minPax: 1, timeLimit: { max: 12 }, ressources: [] },
  // Celle-ci n a aucune condition : c est elle, le plancher.
  { id: 'tl', name: 'TARIF LIBRE', price: 21, type: 'per_pax', minPax: 6, ressources: [] },
  // Unite inconnue : elle ne doit apparaitre nulle part.
  { id: 'tx', name: 'TARIF INCONNU', price: 5, type: 'per_hour', minPax: 1, ressources: [] },
  // Prix absent : idem.
  { id: 'tz', name: 'TARIF SANS PRIX', price: null, type: 'per_pax', minPax: 1, ressources: [] },
];
const lus = prixReservables(TARIFS, centrePrix, agendaPrix);
const parId = Object.fromEntries(lus.map((p) => [p.id, p]));

ok('une unite de prix INCONNUE exclut la formule',
  !parId.tx, JSON.stringify(lus.map((p) => p.id)));
ok('un prix absent exclut la formule',
  !parId.tz, JSON.stringify(lus.map((p) => p.id)));
ok('LE POINT : une formule sans condition est reservable tous les jours ouverts',
  parId.tl && parId.tl.jours === 4 && parId.tl.surTotal === 4,
  JSON.stringify(parId.tl));
ok('LE POINT : une formule limitee au jeudi ne l est qu un jour sur quatre',
  parId.tj && parId.tj.jours === 1 && parId.tj.surTotal === 4,
  JSON.stringify(parId.tj));
ok('le minimum interroge est celui de la FORMULE, pas 1',
  parId.tl && parId.tl.minimum === 6 && parId.tl.jours === 4,
  'une formule a 6 personnes minimum a ete refusee par son propre minimum');
ok('la fenetre horaire est DITE, pas deduite d un refus',
  parId.tm && parId.tm.horaire === 'avant 12 h', JSON.stringify(parId.tm));
ok('une formule sans fenetre horaire n en annonce aucune',
  parId.tl && parId.tl.horaire === '', JSON.stringify(parId.tl && parId.tl.horaire));
ok('l unite est celle du produit, pas une devinette',
  parId.tp && parId.tp.unite === 'par piste' && parId.tl.unite === 'par personne',
  JSON.stringify([parId.tp && parId.tp.unite, parId.tl && parId.tl.unite]));

// UN BLOCAGE DE FORMULE, jour entier, sur chaque jour ouvert : la formule
// disparait. Meme predicat que la route publique.
const blocsFormule = agendaPrix.map((j, i) => ({
  id: i, centerId: 'libramont', scopeType: 'formula', scopeRef: 'tl',
  recurrence: 'once', date: j.date, dayOfWeek: null, dateFrom: null, dateUntil: null,
  startMin: null, endMin: null, reason: 'suspendue', createdBy: 'gerant',
}));
ok('une formule bloquee tous les jours ouverts sort des prix',
  !prixReservables(TARIFS, centrePrix, agendaPrix, blocsFormule).some((p) => p.id === 'tl'),
  JSON.stringify(prixReservables(TARIFS, centrePrix, agendaPrix, blocsFormule).map((p) => p.id)));
ok('CONTRE-PREUVE : bloquee un seul jour, elle reste, avec un jour de moins',
  (prixReservables(TARIFS, centrePrix, agendaPrix, blocsFormule.slice(0, 1))
    .find((p) => p.id === 'tl') || {}).jours === 3,
  JSON.stringify(prixReservables(TARIFS, centrePrix, agendaPrix, blocsFormule.slice(0, 1))
    .find((p) => p.id === 'tl')));
ok('sans un seul jour ouvert, aucun prix (c est le centre qui est ferme)',
  prixReservables(TARIFS, centrePrix, agendaPrix.map((j) => ({ ...j, ouvert: false }))).length === 0);

// ── LES DEUX FAITS ────────────────────────────────────────────────────────
const fichePrix = ficheDuRegistre({
  reservations: [], formules: [], aujourdhui: '2026-09-10', prix: lus,
});
ok('prix_du_catalogue est pose et PUBLIC : un prix, un client vient le chercher',
  Boolean(fichePrix.prix_du_catalogue) && fichePrix.prix_du_catalogue.audience === 'public',
  fichePrix.prix_du_catalogue && fichePrix.prix_du_catalogue.audience);
ok('il porte la condition de jour de chaque formule',
  /TARIF JEUDI : 12 EUR par personne, sans minimum de personnes, reservable 1 jours sur 4/
    .test(String(fichePrix.prix_du_catalogue.valeur)),
  String(fichePrix.prix_du_catalogue.valeur));
ok('et la fenetre horaire quand il y en a une',
  /TARIF MATIN[^|]*avant 12 h/.test(String(fichePrix.prix_du_catalogue.valeur)),
  String(fichePrix.prix_du_catalogue.valeur));

ok('LE POINT : le plancher ecarte la moins chere quand elle est limitee a un jour',
  !/TARIF JEUDI/.test(String(fichePrix.prix_plancher.valeur)),
  String(fichePrix.prix_plancher.valeur));
ok('il ecarte aussi celle qui n existe que le matin',
  !/TARIF MATIN/.test(String(fichePrix.prix_plancher.valeur)),
  String(fichePrix.prix_plancher.valeur));
ok('il ecarte aussi l autre unite de prix, meme moins chere',
  !/TARIF PISTE/.test(String(fichePrix.prix_plancher.valeur)),
  String(fichePrix.prix_plancher.valeur));
ok('il retient bien la seule formule citable SEULE, sans reserve',
  /TARIF LIBRE : 21 EUR par personne, des 6 personnes/.test(String(fichePrix.prix_plancher.valeur)),
  String(fichePrix.prix_plancher.valeur));

// CONTRE-PREUVE : sans aucune formule inconditionnelle, PAS de plancher. Le
// silence est la bonne reponse ; annoncer la moins chere serait le mensonge.
const sansPlancher = ficheDuRegistre({
  reservations: [], formules: [], aujourdhui: '2026-09-10',
  prix: lus.filter((p) => p.id !== 'tl'),
});
ok('CONTRE-PREUVE : aucune formule sans condition, aucun plancher',
  !sansPlancher.prix_plancher && Boolean(sansPlancher.prix_du_catalogue),
  String(sansPlancher.prix_plancher && sansPlancher.prix_plancher.valeur));
ok('les deux faits sont poses MALGRE un registre vide : un centre sans vente a des prix',
  Boolean(fichePrix.registre_vide) && Boolean(fichePrix.prix_plancher));
ok('FAIL-OPEN : sans prix transmis, aucun fait',
  !ficheDuRegistre({ reservations: [], formules: [], aujourdhui: '2026-09-10' }).prix_du_catalogue);

// ── LES JOURS DE SEMAINE DICIBLES ─────────────────────────────────────────
// L agenda date est INTERNE depuis le patch 34, et pour une bonne raison : une
// fermeture exceptionnelle se communique par une decision du gerant. Le
// pendant public ne dit donc jamais une date : il dit « ouvert le samedi ».
console.log('\n[JOURS] le centre peut enfin DIRE quand il ouvre');
const { joursOuvertsPublics } = require('../lib/center-facts');

// Deux semaines pleines : chaque jour de semaine apparait DEUX fois. C est le
// montage qui rend la regle « toutes les occurrences » testable.
const deuxSemaines = (over = {}) => {
  const lignes = [];
  for (let i = 0; i < 14; i += 1) {
    const date = new Date(Date.parse('2026-09-10T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
    lignes.push({
      date, ouvert: true, ferme: false, plage: '10h - 22h', raisons: [], coupures: [],
      ...(over[date] || {}),
    });
  }
  return lignes;
};
ok('MONTAGE : la fenetre porte deux occurrences de chacun des sept jours',
  deuxSemaines().length === 14 && joursOuvertsPublics(deuxSemaines()).length === 7,
  String(joursOuvertsPublics(deuxSemaines()).length));
ok('l ordre commence au lundi, comme une semaine se lit',
  joursOuvertsPublics(deuxSemaines())[0].nom === 'lundi',
  JSON.stringify(joursOuvertsPublics(deuxSemaines()).map((j) => j.nom)));

// UNE SEULE occurrence fermee, et le jour ne se dit plus. C est le mensonge
// vise : publier « on est ouvert le samedi » la semaine ou l un des deux
// samedis est ferme. Le 2026-09-12 est un samedi, l autre est le 19.
const unSamediFerme = joursOuvertsPublics(
  deuxSemaines({ '2026-09-12': { ferme: true, raisons: ['travaux'] } }),
);
ok('LE POINT : un seul samedi ferme, et le samedi ne se dit plus',
  !unSamediFerme.some((j) => j.nom === 'samedi'),
  JSON.stringify(unSamediFerme.map((j) => j.nom)));
ok('CONTRE-PREUVE : les six autres jours restent dicibles',
  unSamediFerme.length === 6 && unSamediFerme.some((j) => j.nom === 'dimanche'),
  JSON.stringify(unSamediFerme.map((j) => j.nom)));
ok('un jour non ouvert a la grille ne se dit pas non plus',
  !joursOuvertsPublics(deuxSemaines({ '2026-09-14': { ouvert: false, plage: '' } }))
    .some((j) => j.nom === 'lundi'),
  'un lundi ferme a la grille est ressorti comme ouvert');

// L HORAIRE ne s annonce que s il est le MEME partout. Deux samedis a deux
// horaires laissent le jour sans horaire, jamais avec un horaire faux.
const samedisDifferents = joursOuvertsPublics(
  deuxSemaines({ '2026-09-19': { plage: '14h - Minuit' } }),
);
ok('LE POINT : deux horaires differents, le jour se dit SANS horaire',
  (samedisDifferents.find((j) => j.nom === 'samedi') || {}).plage === '',
  JSON.stringify(samedisDifferents.find((j) => j.nom === 'samedi')));
ok('CONTRE-PREUVE : un horaire constant est bien annonce',
  (samedisDifferents.find((j) => j.nom === 'dimanche') || {}).plage === '10h - 22h',
  JSON.stringify(samedisDifferents.find((j) => j.nom === 'dimanche')));
ok('sans agenda, aucun jour',
  joursOuvertsPublics([]).length === 0 && joursOuvertsPublics(null).length === 0);

// ── LE FAIT ───────────────────────────────────────────────────────────────
const ficheJours = ficheDuRegistre({
  reservations: [], formules: [], aujourdhui: '2026-09-10', agenda: deuxSemaines(),
});
ok('jours_ouverts est PUBLIC : c est ce qu un client vient chercher',
  Boolean(ficheJours.jours_ouverts) && ficheJours.jours_ouverts.audience === 'public',
  ficheJours.jours_ouverts && ficheJours.jours_ouverts.audience);
ok('il nomme les jours et leur horaire',
  String(ficheJours.jours_ouverts.valeur).startsWith('lundi 10h - 22h | mardi 10h - 22h'),
  String(ficheJours.jours_ouverts.valeur));
ok('l agenda date, lui, RESTE interne : une fermeture ne se publie pas',
  ficheJours.agenda_ouverture.audience === 'interne',
  ficheJours.agenda_ouverture.audience);
ok('il ne nomme AUCUNE date ni aucune fermeture',
  !/[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(String(ficheJours.jours_ouverts.valeur))
  && !/FERME/.test(String(ficheJours.jours_ouverts.valeur)),
  String(ficheJours.jours_ouverts.valeur));
ok('il est pose MALGRE un registre vide : il parle du centre',
  Boolean(ficheJours.registre_vide) && Boolean(ficheJours.jours_ouverts));
ok('FAIL-OPEN : sans agenda, aucun fait',
  !ficheDuRegistre({ reservations: [], formules: [], aujourdhui: '2026-09-10' }).jours_ouverts);
ok('un centre qui n ouvre aucun jour ne dit aucun jour',
  !ficheDuRegistre({
    reservations: [], formules: [], aujourdhui: '2026-09-10',
    agenda: deuxSemaines().map((j) => ({ ...j, ouvert: false, plage: '' })),
  }).jours_ouverts);

// ── LE SORT DES IDEES, ET SON DENOMINATEUR ────────────────────────────────
// Trois chemins ecrivent 'ignored' : l expiration a dix jours, le bouton
// « Ignorer » du cockpit, et le refus du panneau. Les deux derniers sont des
// DECISIONS ; le premier ne dit rien. Les confondre a deja produit un « 0 %
// d adoption » faux, ecrit a Movsar.
console.log('\n[ADOPTION] un taux ne se calcule que sur ce qui a ete tranche');

const memoire = (payloads) => ajouterMemoire(
  ficheDuRegistre({ reservations: [], formules: [], aujourdhui: '2026-09-10' }),
  payloads.map((p, i) => ({
    title: `Idee ${i}`,
    status: p.status,
    proposed_at: `2026-08-${String(1 + i).padStart(2, '0')}`,
    applied_at: p.status === 'applied' ? `2026-08-${String(2 + i).padStart(2, '0')}` : null,
    measured_at: null,
    result: null,
    payload: p.payload || {},
  })),
);

// DEUX appliquees, UNE refusee par le staff, DEUX jamais ouvertes.
const melangeDesSorts = memoire([
  { status: 'applied' },
  { status: 'applied' },
  { status: 'ignored', payload: { ignoredBy: 'staff' } },
  { status: 'ignored', payload: { ignoredBy: 'expiration' } },
  { status: 'ignored', payload: { ignoredBy: 'expiration' } },
]);
ok('MONTAGE : la memoire compte bien cinq propositions',
  /5 proposees/.test(String(melangeDesSorts.memoire_propositions.valeur)),
  String(melangeDesSorts.memoire_propositions.valeur));
ok('LE POINT : le denominateur EXCLUT les idees jamais ouvertes',
  /sur 3 idees dont le sort est connu/.test(String(melangeDesSorts.taux_adoption.valeur)),
  String(melangeDesSorts.taux_adoption.valeur));
ok('et le taux est celui des idees tranchees, pas de toutes',
  String(melangeDesSorts.taux_adoption.valeur).startsWith('66.7 %'),
  String(melangeDesSorts.taux_adoption.valeur));
ok('les idees jamais ouvertes sont DITES, pas cachees',
  /2 jamais ouvertes \(hors calcul\)/.test(String(melangeDesSorts.taux_adoption.valeur)),
  String(melangeDesSorts.taux_adoption.valeur));
ok('le fait reste INTERNE : un taux d adoption ne se publie pas',
  melangeDesSorts.taux_adoption.audience === 'interne', melangeDesSorts.taux_adoption.audience);

// CONTRE-PREUVE : si les jamais-ouvertes comptaient comme des refus, le taux
// serait de 40 % sur cinq. C est le chiffre faux qu on refuse d ecrire.
ok('CONTRE-PREUVE : le taux n est PAS celui qui compte tout le monde (40 %)',
  !/^40/.test(String(melangeDesSorts.taux_adoption.valeur)),
  String(melangeDesSorts.taux_adoption.valeur));

// AUCUNE idee tranchee : pas de taux du tout. Le silence, pas un zero.
const queDesExpirees = memoire([
  { status: 'ignored', payload: { ignoredBy: 'expiration' } },
  { status: 'ignored', payload: { ignoredBy: 'expiration' } },
]);
ok('aucune idee tranchee : AUCUN taux, jamais un zero',
  !queDesExpirees.taux_adoption,
  String(queDesExpirees.taux_adoption && queDesExpirees.taux_adoption.valeur));

// LE TROU RESTE NOMME tant qu il reste une ligne sans cause.
const avecAncienne = memoire([
  { status: 'applied' },
  { status: 'ignored', payload: { ignoredBy: 'staff' } },
  { status: 'ignored' },
]);
ok('une ligne ignoree sans cause maintient le trou nomme',
  Boolean(avecAncienne.trou_suivi_des_idees)
  && /1 idee a ete ignoree/.test(String(avecAncienne.trou_suivi_des_idees.valeur)),
  String(avecAncienne.trou_suivi_des_idees && avecAncienne.trou_suivi_des_idees.valeur));
ok('et elle n entre PAS dans le denominateur du taux',
  /sur 2 idees dont le sort est connu/.test(String(avecAncienne.taux_adoption.valeur)),
  String(avecAncienne.taux_adoption.valeur));
ok('CONTRE-PREUVE : sans ligne sans cause, le trou se referme tout seul',
  !melangeDesSorts.trou_suivi_des_idees,
  String(melangeDesSorts.trou_suivi_des_idees && melangeDesSorts.trou_suivi_des_idees.valeur));

// Les TROIS ecritures qui signent leur geste sont prouvees par leur
// COMPORTEMENT dans daily-metrics-check : ce gate-ci est synchrone, et un
// grep sur la source serait un test de presence, qui reste vert quand le bloc
// devient INATTEIGNABLE. Ici on prouve la LECTURE, qui se voit dans la
// requete elle-meme.
ok('la memoire va CHERCHER payload en base',
  /result, data_basis, payload/.test(require('fs').readFileSync(require.resolve('../lib/center-facts'), 'utf8')),
  'chargerMemoireDuCentre ne selectionne plus payload');

// ── UN CENTRE N EMPRUNTE PAS L HORAIRE DU VOISIN ──────────────────────────
// getSchedule retombe sur la grille de Libramont pour tout centre dont
// defaultSchedule est un marqueur TEXTE. Le patch 41 ayant rendu les jours
// d ouverture PUBLICS, Gembloux et Ciney annoncaient mot pour mot les horaires
// de Libramont. Le montage tourne sur la configuration REELLE : c est elle qui
// a produit le defaut, une fixture inventee ne l aurait jamais montre.
console.log('\n[EMPRUNT] un horaire non declare ne se deduit d aucun autre centre');
const { getCenter: centrePourHoraire } = require('../lib/ops-knowledge');
const { agendaDuCentre: agendaReel, joursOuvertsDeclares: declaresReel } = require('../lib/center-facts');

// MONTAGE : c est la configuration reelle qui porte les marqueurs texte.
ok('MONTAGE : Libramont porte une vraie grille',
  Array.isArray(declaresReel(centrePourHoraire('libramont').defaultSchedule)),
  JSON.stringify(declaresReel(centrePourHoraire('libramont').defaultSchedule)));
ok('MONTAGE : Gembloux porte un marqueur texte, pas une grille',
  typeof centrePourHoraire('gembloux').defaultSchedule === 'string',
  JSON.stringify(centrePourHoraire('gembloux').defaultSchedule));
ok('MONTAGE : Ciney aussi',
  typeof centrePourHoraire('ciney').defaultSchedule === 'string',
  JSON.stringify(centrePourHoraire('ciney').defaultSchedule));

// MONTAGE DU DEFAUT : sans la garde, getSchedule rend la MEME plage pour les
// trois. Sans cette assertion, le test pourrait passer sur un moteur qui
// refuserait deja, et on ne saurait pas que la garde sert a quelque chose.
const { getSchedule: horaireDuMoteur } = require('../lib/booking-config');
const plagesDuJour = ['libramont', 'gembloux', 'ciney']
  .map((id) => JSON.stringify(horaireDuMoteur('2026-09-12', centrePourHoraire(id))));
ok('MONTAGE : le moteur d horaires, LUI, rend la meme plage aux trois',
  plagesDuJour[0] === plagesDuJour[1] && plagesDuJour[1] === plagesDuJour[2],
  JSON.stringify(plagesDuJour));

// LE POINT : l agenda refuse de se construire sur cet emprunt.
ok('LE POINT : le centre qui a une grille garde son agenda',
  agendaReel(centrePourHoraire('libramont'), [], '2026-09-10').length === 14,
  String(agendaReel(centrePourHoraire('libramont'), [], '2026-09-10').length));
ok('LE POINT : le centre sans grille n a AUCUN agenda',
  agendaReel(centrePourHoraire('gembloux'), [], '2026-09-10').length === 0,
  String(agendaReel(centrePourHoraire('gembloux'), [], '2026-09-10').length));
ok('et celui dont l horaire est « a confirmer » non plus',
  agendaReel(centrePourHoraire('ciney'), [], '2026-09-10').length === 0,
  String(agendaReel(centrePourHoraire('ciney'), [], '2026-09-10').length));

// ET TOUT CE QUI EN DEPEND SE TAIT. C est la vraie portee du correctif : la
// garde est posee a UN endroit et ferme quatre fuites.
const ficheEmpruntee = ficheDuRegistre({
  reservations: [], formules: [], aujourdhui: '2026-09-10',
  joursOuverts: declaresReel(centrePourHoraire('gembloux').defaultSchedule),
  agenda: agendaReel(centrePourHoraire('gembloux'), [], '2026-09-10'),
  prix: [],
});
ok('aucun jour d ouverture publie',
  !ficheEmpruntee.jours_ouverts, String(ficheEmpruntee.jours_ouverts && ficheEmpruntee.jours_ouverts.valeur));
ok('aucun agenda interne non plus',
  !ficheEmpruntee.agenda_ouverture, 'un agenda emprunte reste dans la fiche');
ok('et le centre n est pas declare « ferme » pour autant',
  !ficheEmpruntee.centre_ferme,
  'un centre sans horaire declare a ete pris pour un centre ferme');
ok('AUCUN fait public ne sort de ce centre',
  Object.values(ficheEmpruntee).filter((f) => f.audience === 'public').length === 0,
  JSON.stringify(Object.values(ficheEmpruntee).filter((f) => f.audience === 'public').map((f) => f.id)));

// LE TROU EST NOMME : sans lui, le gerant voit un ecran vide sans la cause.
ok('le trou est nomme au gerant',
  Boolean(ficheEmpruntee.horaires_non_declares)
  && ficheEmpruntee.horaires_non_declares.audience === 'interne',
  String(ficheEmpruntee.horaires_non_declares && ficheEmpruntee.horaires_non_declares.audience));
ok('et il dit que rien ne se deduit d un autre centre',
  /ne se deduisent d aucun autre/.test(String(ficheEmpruntee.horaires_non_declares.valeur)),
  String(ficheEmpruntee.horaires_non_declares.valeur));

// CONTRE-PREUVE : le centre qui a une grille garde tout.
const fichePosee = ficheDuRegistre({
  reservations: [], formules: [], aujourdhui: '2026-09-10',
  joursOuverts: declaresReel(centrePourHoraire('libramont').defaultSchedule),
  agenda: agendaReel(centrePourHoraire('libramont'), [], '2026-09-10'),
});
ok('CONTRE-PREUVE : le centre qui declare ses horaires les publie',
  Boolean(fichePosee.jours_ouverts) && fichePosee.jours_ouverts.audience === 'public',
  String(fichePosee.jours_ouverts && fichePosee.jours_ouverts.valeur));
ok('CONTRE-PREUVE : et le trou ne lui est pas reproche',
  !fichePosee.horaires_non_declares,
  'un centre qui declare ses horaires porte quand meme le trou');

// ── UNE FORMULE NE SE VEND PAS SANS SES RESSOURCES ─────────────────────────
console.log('\n[RESSOURCES] une formule dont la piste ou l arene est fermee ne se publie pas');
const { getCenter: centreDesPrix, getFormula: formuleDuCatalogue } = require('../lib/ops-knowledge');
const { getEffectiveFormules: catalogueDesPrix } = require('../lib/booking-config');
const { countFormulaLaserGames: areneDuTunnel, validateReservationResources: tunnelDeResa } = require('../lib/database');
const { prixReservables: prixDeLaFiche, agendaDuCentre: agendaPourLesPrix,
  ressourcesDeLaFormule, formuleAvecSesRessources } = require('../lib/center-facts');

// MONTAGE : la fenetre reelle, le catalogue reel.
const lieuDesPrix = centreDesPrix('libramont');
const agendaDesPrix = agendaPourLesPrix(lieuDesPrix, [], '2026-09-10');
const joursDesPrix = agendaDesPrix.filter((j) => j.ouvert && !j.ferme).map((j) => j.date);
ok('MONTAGE : la fenetre de Libramont porte des jours ouverts',
  joursDesPrix.length >= 7, String(joursDesPrix.length));
const formulesDesPrix = catalogueDesPrix('libramont').map(formuleAvecSesRessources);
ok('MONTAGE : le catalogue du centre est charge',
  formulesDesPrix.length >= 10, String(formulesDesPrix.length));

// LES RESSOURCES SONT CELLES DU TUNNEL, PAS UNE LISTE ECRITE ICI.
ok('une formule bowling + laser reclame les deux ressources',
  JSON.stringify(ressourcesDeLaFormule({ id: 'f1' })) === '["bowling","laser_game"]',
  JSON.stringify(ressourcesDeLaFormule({ id: 'f1' })));
ok('une formule laser sans piste ne reclame pas le bowling',
  JSON.stringify(ressourcesDeLaFormule({ id: 'f2' })) === '["laser_game"]',
  JSON.stringify(ressourcesDeLaFormule({ id: 'f2' })));
ok('une formule bowling sans laser ne reclame pas l arene',
  JSON.stringify(ressourcesDeLaFormule({ id: 'css' })) === '["bowling"]',
  JSON.stringify(ressourcesDeLaFormule({ id: 'css' })));
ok('une formule table + plaine + arcade ne reclame AUCUNE ressource',
  JSON.stringify(ressourcesDeLaFormule({ id: 'f6' })) === '[]',
  JSON.stringify(ressourcesDeLaFormule({ id: 'f6' })));
ok('et la reponse sur l arene est bien celle du tunnel',
  areneDuTunnel(formuleDuCatalogue('f1')) > 0 && areneDuTunnel(formuleDuCatalogue('f6')) === 0,
  `f1=${areneDuTunnel(formuleDuCatalogue('f1'))} f6=${areneDuTunnel(formuleDuCatalogue('f6'))}`);

// LE DOUTE NE SE PUBLIE PAS. Trois marches, et la derniere est celle qui
// compte : une formule arrivee SANS ressources resolues ne sort pas.
let fantomeAJete = false;
try { ressourcesDeLaFormule({ id: 'formule-fantome' }); } catch (error) { fantomeAJete = true; }
ok('une formule inconnue du catalogue jette au lieu de repondre',
  fantomeAJete, 'ressourcesDeLaFormule a repondu pour une formule inexistante');
ok('et la version qui ne jette pas laisse ses ressources a null',
  formuleAvecSesRessources({ id: 'formule-fantome' }).ressources === null,
  JSON.stringify(formuleAvecSesRessources({ id: 'formule-fantome' }).ressources));
ok('LE POINT : une formule sans ressources resolues n est PAS publiee',
  prixDeLaFiche([{ id: 'formule-fantome', name: 'FANTOME', type: 'per_pax', price: 20, minPax: 1, ressources: null }],
    lieuDesPrix, agendaDesPrix, []).length === 0,
  'une formule dont on ignore les ressources a ete publiee');

// LE CAS QUE getFormula NE JETTE PAS. Une formule CONNUE du catalogue mais
// DESACTIVEE : getFormula rend null, sans jeter, exprès (lib/ops-knowledge :
// « on rend null SANS fallback, sinon la formule soft-deleted ressusciterait
// par le fichier »). C est la SEULE porte vers la branche `!document`, et
// sans elle la garde qui la ferme n est prouvee par rien.
//
// Le crochet est pose sur le MODULE : ressourcesDeLaFormule require
// ops-knowledge paresseusement, donc apres ce remplacement. On prouve
// d abord que le crochet mord, sinon on testerait le vide.
const savoirDuCatalogue = require('../lib/ops-knowledge');
const vraiGetFormula = savoirDuCatalogue.getFormula;
savoirDuCatalogue.getFormula = (id, centre) => (id === 'formule-desactivee' ? null : vraiGetFormula(id, centre));
ok('MONTAGE : le crochet mord, getFormula rend null sans jeter',
  savoirDuCatalogue.getFormula('formule-desactivee') === null, 'le crochet n a pas pris');
let desactiveeAJete = false;
try { ressourcesDeLaFormule({ id: 'formule-desactivee' }); } catch (error) { desactiveeAJete = true; }
ok('LE POINT : une formule DESACTIVEE jette au lieu de passer pour sans ressource',
  desactiveeAJete, 'une formule soft-deleted a ete traitee comme ne consommant rien');
ok('et prixReservables refuse alors de la publier',
  prixDeLaFiche([formuleAvecSesRessources({ id: 'formule-desactivee', name: 'DESACTIVEE',
    type: 'per_pax', price: 20, minPax: 1 })], lieuDesPrix, agendaDesPrix, []).length === 0,
  'une formule desactivee a ete publiee');
savoirDuCatalogue.getFormula = vraiGetFormula;
ok('CONTRE-PREUVE : crochet retire, le catalogue repond de nouveau',
  ressourcesDeLaFormule({ id: 'f1' }).length === 2,
  JSON.stringify(ressourcesDeLaFormule({ id: 'f1' })));

// QUI CONSOMME QUOI, d apres le catalogue lui-meme.
const avecLaser = formulesDesPrix.filter((f) => (f.ressources || []).includes('laser_game')).map((f) => f.id);
const sansLaser = formulesDesPrix.filter((f) => !(f.ressources || []).includes('laser_game')).map((f) => f.id);
ok('MONTAGE : des formules consomment l arene, d autres non',
  avecLaser.length > 0 && sansLaser.length > 0,
  JSON.stringify({ avecLaser, sansLaser }));

// MONTAGE DU DEFAUT : le TUNNEL refuse vraiment. Sans cette assertion, la
// garde pourrait proteger d un danger qui n existe pas, et personne ne le
// saurait. C est aussi elle qui tiendra le jour ou le tunnel changera d avis.
const blocDuJourEntier = (scopeRef) => joursDesPrix.map((date, i) => ({
  id: i + 1, centerId: 'libramont', scopeType: 'activity', scopeRef,
  recurrence: 'once', date, startMin: null, endMin: null, reason: 'gate',
}));
const refusDuTunnel = (scopeRef) => {
  try {
    tunnelDeResa({
      centerId: 'libramont', type: 'formule', formuleId: 'f1', name: 'Gate',
      phone: '0470000000', email: 'gate@example.test', date: joursDesPrix[0],
      startTime: '15:00', pax: 6, channel: 'public', duration: 1, totalDuration: 2,
    }, [], {}, blocDuJourEntier(scopeRef), joursDesPrix[0]);
  } catch (error) { return String(error.message); }
  return '';
};
ok('MONTAGE : le tunnel REFUSE la formule quand l arene est fermee',
  /Laser Game/.test(refusDuTunnel('laser_game')),
  refusDuTunnel('laser_game') || 'le tunnel a accepte');
ok('MONTAGE : et quand la piste est fermee',
  /bowling/i.test(refusDuTunnel('bowling')),
  refusDuTunnel('bowling') || 'le tunnel a accepte');
ok('MONTAGE : mais il ACCEPTE quand une activite LIBRE est fermee',
  refusDuTunnel('arcade_time') === '', refusDuTunnel('arcade_time'));

const prixSansBlocage = prixDeLaFiche(formulesDesPrix, lieuDesPrix, agendaDesPrix, []);
const prixLaserFerme = prixDeLaFiche(formulesDesPrix, lieuDesPrix, agendaDesPrix, blocDuJourEntier('laser_game'));
const prixBowlingFerme = prixDeLaFiche(formulesDesPrix, lieuDesPrix, agendaDesPrix, blocDuJourEntier('bowling'));
const prixArcadeFerme = prixDeLaFiche(formulesDesPrix, lieuDesPrix, agendaDesPrix, blocDuJourEntier('arcade_time'));
ok('MONTAGE : sans blocage, les formules a arene sont bien publiees',
  avecLaser.every((id) => prixSansBlocage.some((p) => p.id === id)),
  JSON.stringify(avecLaser.filter((id) => !prixSansBlocage.some((p) => p.id === id))));

// LE POINT.
ok('LE POINT : arene fermee, AUCUNE formule qui la consomme n est publiee',
  !prixLaserFerme.some((p) => avecLaser.includes(p.id)),
  JSON.stringify(prixLaserFerme.filter((p) => avecLaser.includes(p.id)).map((p) => p.nom)));
const aBesoinDePiste = (id) => (formulesDesPrix.find((f) => f.id === id) || {}).ressources || [];
ok('LE POINT : piste fermee, aucune formule qui la consomme non plus',
  !prixBowlingFerme.some((p) => aBesoinDePiste(p.id).includes('bowling')),
  JSON.stringify(prixBowlingFerme.filter((p) => aBesoinDePiste(p.id).includes('bowling')).map((p) => p.nom)));

// CONTRE-PREUVES. Une garde qui fait tout taire est une panne, pas une garde.
ok('CONTRE-PREUVE : les formules sans arene restent publiees',
  sansLaser.some((id) => prixLaserFerme.some((p) => p.id === id))
  && prixLaserFerme.length > 0 && prixLaserFerme.length < prixSansBlocage.length,
  `${prixLaserFerme.length} publiees sur ${prixSansBlocage.length}`);
ok('CONTRE-PREUVE : une activite LIBRE fermee ne retire RIEN',
  prixArcadeFerme.length === prixSansBlocage.length,
  `${prixArcadeFerme.length} sur ${prixSansBlocage.length} : la garde depasse la regle du tunnel`);

// DE BOUT EN BOUT : ce qu un client lirait. Les faits de prix sont PUBLICS et
// marques `offre` : c est par eux qu un nom de formule sort du programme.
const nomsALaser = formulesDesPrix.filter((f) => avecLaser.includes(f.id)).map((f) => String(f.name || f.id));
const ficheDesPrix = ficheDuRegistre({
  reservations: [], formules: [], aujourdhui: '2026-09-10',
  joursOuverts: null, agenda: agendaDesPrix, prix: prixLaserFerme,
});
const texteDesPrix = ['prix_du_catalogue', 'prix_plancher']
  .map((id) => String((ficheDesPrix[id] || {}).valeur || '')).join(' | ');
ok('DE BOUT EN BOUT : aucun nom de formule a arene dans les faits publics',
  !nomsALaser.some((nom) => texteDesPrix.includes(nom)),
  JSON.stringify(nomsALaser.filter((nom) => texteDesPrix.includes(nom))));
ok('DE BOUT EN BOUT : et le centre a quand meme des prix a annoncer',
  Boolean(ficheDesPrix.prix_du_catalogue)
  && ficheDesPrix.prix_du_catalogue.audience === 'public',
  'le centre est devenu muet sur ses prix');

// ── CE QU ON DEMANDE ET QU ON NE VEND PAS ─────────────────────────────────
console.log('\n[DEMANDE] la demande non servie entre dans la fiche, sans une seule donnee personnelle');
const { demandesSurMesure } = require('../lib/center-facts');
const { OCCASION_VALUES: vocabulaireDuRegistre } = require('../lib/database');

// MONTAGE : le vocabulaire compare est celui que le REGISTRE valide. Les deux
// ecritures y passent (createCustomRequest appelle normalizeReservationOccasion).
ok('MONTAGE : le vocabulaire du registre porte les occasions du formulaire',
  ['anniversaire', 'amis', 'entreprise', 'ecole', 'evg', 'autre'].every((o) => vocabulaireDuRegistre.has(o)),
  JSON.stringify([...vocabulaireDuRegistre]));
ok('MONTAGE : et il n en porte pas d autres',
  !vocabulaireDuRegistre.has('mariage'), 'le montage de la contre-preuve ne tient plus');

const DEMANDES = [
  { date: '2026-08-01', pax: 24, occasion: 'entreprise' },
  { date: '2026-08-14', pax: 30, occasion: 'entreprise' },
  { date: '2026-08-20', pax: 8, occasion: 'anniversaire' },
  { date: '2026-09-05', pax: 12, occasion: 'evg' },
  { date: '2026-09-06', pax: 0, occasion: '' },
];
// Le registre VEND de l anniversaire, et il a vendu un EVG qui a ete ANNULE.
const REGISTRE_DEMANDE = [
  resa({ date: '2026-07-01', occasion: 'anniversaire' }),
  resa({ date: '2026-07-08', occasion: 'evg', status: 'cancelled' }),
];
const lecture = demandesSurMesure(DEMANDES, REGISTRE_DEMANDE);
ok('MONTAGE : les cinq demandes sont lues', lecture && lecture.total === 5, JSON.stringify(lecture && lecture.total));

ok('la taille des groupes demandes est bornee par les demandes reelles',
  lecture.tailleMin === 8 && lecture.tailleMax === 30,
  `${lecture.tailleMin} a ${lecture.tailleMax}`);
ok('une demande sans occasion compte dans le total mais dans aucune occasion',
  lecture.total === 5 && lecture.occasions.reduce((s, c) => s + c.n, 0) === 4,
  JSON.stringify(lecture.occasions.map((c) => `${c.occasion}:${c.n}`)));
ok('les occasions sont classees par nombre de demandes',
  lecture.occasions[0].occasion === 'entreprise' && lecture.occasions[0].n === 2,
  JSON.stringify(lecture.occasions.map((c) => `${c.occasion}:${c.n}`)));

// LE POINT.
ok('LE POINT : une occasion demandee et absente du registre est nommee',
  lecture.jamaisVendues.some((c) => c.occasion === 'entreprise' && c.n === 2),
  JSON.stringify(lecture.jamaisVendues.map((c) => c.occasion)));
ok('CONTRE-PREUVE : une occasion que le registre VEND ne l est pas',
  !lecture.jamaisVendues.some((c) => c.occasion === 'anniversaire'),
  JSON.stringify(lecture.jamaisVendues.map((c) => c.occasion)));
// Une occasion vendue puis ANNULEE a ete vendue une fois : la dire jamais
// vendue serait faux, et le gerant corrigerait une offre qui existe.
ok('LE POINT : une occasion vendue puis ANNULEE compte comme vendue',
  !lecture.jamaisVendues.some((c) => c.occasion === 'evg'),
  JSON.stringify(lecture.jamaisVendues.map((c) => c.occasion)));

// LE VOCABULAIRE FERME PROTEGE DU REPROCHE ABSURDE : une occasion que le
// registre ne PEUT pas porter sort de la comparaison, elle n est pas declaree
// « jamais vendue ». Sans cette regle on reprocherait au centre de ne pas
// vendre une categorie qui n existe pas de son cote.
const horsVocabulaire = demandesSurMesure(
  [...DEMANDES, { date: '2026-09-07', pax: 40, occasion: 'mariage' }], REGISTRE_DEMANDE);
ok('une occasion hors vocabulaire est COMPTEE dans les demandes',
  horsVocabulaire.occasions.some((c) => c.occasion === 'mariage'),
  JSON.stringify(horsVocabulaire.occasions.map((c) => c.occasion)));
ok('LE POINT : mais elle n est JAMAIS declaree jamais vendue',
  !horsVocabulaire.jamaisVendues.some((c) => c.occasion === 'mariage'),
  JSON.stringify(horsVocabulaire.jamaisVendues.map((c) => c.occasion)));

// LES FAITS, DANS LA FICHE.
const ficheDemande = ficheDuRegistre({
  reservations: REGISTRE_DEMANDE, formules: [], aujourdhui: '2026-09-10', demandes: DEMANDES,
});
ok('le fait des demandes est pose et dit combien, et de quelle taille',
  Boolean(ficheDemande.demandes_sur_mesure)
  && /5 demandes, de 8 a 30 personnes/.test(String(ficheDemande.demandes_sur_mesure.valeur)),
  String(ficheDemande.demandes_sur_mesure && ficheDemande.demandes_sur_mesure.valeur));
ok('le fait des occasions demandees est pose',
  Boolean(ficheDemande.occasions_demandees)
  && /entreprise \(2\)/.test(String(ficheDemande.occasions_demandees.valeur)),
  String(ficheDemande.occasions_demandees && ficheDemande.occasions_demandees.valeur));
ok('LE POINT : le fait de la demande jamais vendue nomme l occasion et son compte',
  Boolean(ficheDemande.demande_jamais_vendue)
  && /entreprise : 2 demandes, aucune reservation/.test(String(ficheDemande.demande_jamais_vendue.valeur)),
  String(ficheDemande.demande_jamais_vendue && ficheDemande.demande_jamais_vendue.valeur));
ok('et il ne nomme ni l anniversaire vendu ni l EVG annule',
  !/anniversaire|evg/.test(String(ficheDemande.demande_jamais_vendue.valeur)),
  String(ficheDemande.demande_jamais_vendue.valeur));

// LES TROIS SONT INTERNES. « On nous demande de l entreprise et on n en vend
// pas » se dit au gerant, jamais dans un texte public.
ok('les trois faits de la demande sont INTERNES',
  ['demandes_sur_mesure', 'occasions_demandees', 'demande_jamais_vendue']
    .every((id) => ficheDemande[id] && ficheDemande[id].audience === 'interne'),
  JSON.stringify(['demandes_sur_mesure', 'occasions_demandees', 'demande_jamais_vendue']
    .map((id) => `${id}:${ficheDemande[id] && ficheDemande[id].audience}`)));
ok('et aucun ne se declare fait d OFFRE : ils parlent de ce qui manque',
  ['demandes_sur_mesure', 'occasions_demandees', 'demande_jamais_vendue']
    .every((id) => ficheDemande[id] && ficheDemande[id].offre === false),
  'un fait de demande a ete marque comme une offre publiable');

// LA FENETRE EST CELLE DES DEMANDES, pas celle du registre : sinon un fait de
// cinq semaines emprunterait la maturite de six mois de reservations.
ok('la fenetre du fait est celle des demandes',
  ficheDemande.demandes_sur_mesure.du === '2026-08-01'
  && ficheDemande.demandes_sur_mesure.au === '2026-09-06',
  `${ficheDemande.demandes_sur_mesure.du} -> ${ficheDemande.demandes_sur_mesure.au}`);

// AUCUNE DONNEE PERSONNELLE, MEME FOURNIE. La fiche part vers un modele : ce
// n est pas la requete seule qui doit proteger, la fiche doit etre incapable
// de laisser passer un nom, un email, un telephone ou un message libre.
const AVEC_PERSONNEL = [{
  date: '2026-08-01', pax: 24, occasion: 'entreprise',
  contact_name: 'Jeanne Dupont', company: 'ACME SPRL', email: 'jeanne@acme.test',
  phone: '0470112233', message: 'on veut privatiser pour le CE',
}];
const fichePersonnelle = ficheDuRegistre({ reservations: REGISTRE_DEMANDE, formules: [], aujourdhui: '2026-09-10', demandes: AVEC_PERSONNEL });
const texteEntier = JSON.stringify(fichePersonnelle);
const fuites = ['Jeanne Dupont', 'ACME SPRL', 'jeanne@acme.test', '0470112233', 'privatiser']
  .filter((secret) => texteEntier.includes(secret));
ok('LE POINT : AUCUNE donnee personnelle n atteint la fiche',
  fuites.length === 0, JSON.stringify(fuites));
ok('MONTAGE : et pourtant la demande a bien ete comptee',
  Boolean(fichePersonnelle.demandes_sur_mesure)
  && fichePersonnelle.demandes_sur_mesure.n === 1,
  'la contre-preuve de fuite ne testait rien : la demande n a pas ete lue');

// FAIL-OPEN : sans demande transmise, aucun fait invente.
const ficheSansDemande = ficheDuRegistre({ reservations: REGISTRE_DEMANDE, formules: [], aujourdhui: '2026-09-10' });
ok('FAIL-OPEN : sans demande, aucun des trois faits',
  ['demandes_sur_mesure', 'occasions_demandees', 'demande_jamais_vendue']
    .every((id) => !ficheSansDemande[id]),
  'un fait de demande a ete pose sans demande');

// ── UN PARC DE PISTES A L ARRET EST UNE RESSOURCE FERMEE ───────────────────
console.log('\n[PISTES] un jour sans une seule piste ne vend aucune formule bowling');
// PUIS LE PRIX. On reutilise le catalogue et la fenetre reels du bloc
// [RESSOURCES] : c est la configuration qui a produit le defaut.
const avecPiste = formulesDesPrix.filter((f) => (f.ressources || []).includes('bowling')).map((f) => f.id);
const sansPiste = formulesDesPrix.filter((f) => !(f.ressources || []).includes('bowling')).map((f) => f.id);
ok('MONTAGE : des formules consomment une piste, d autres non',
  avecPiste.length > 0 && sansPiste.length > 0, JSON.stringify({ avecPiste, sansPiste }));

const prixParcArrete = prixDeLaFiche(formulesDesPrix, lieuDesPrix, agendaDesPrix, [], new Set(joursDesPrix));
ok('LE POINT : parc a l arret, AUCUNE formule a piste n est publiee',
  !prixParcArrete.some((p) => avecPiste.includes(p.id)),
  JSON.stringify(prixParcArrete.filter((p) => avecPiste.includes(p.id)).map((p) => p.nom)));
ok('CONTRE-PREUVE : les formules sans piste restent publiees',
  sansPiste.some((id) => prixParcArrete.some((p) => p.id === id))
  && prixParcArrete.length > 0 && prixParcArrete.length < prixSansBlocage.length,
  `${prixParcArrete.length} sur ${prixSansBlocage.length}`);

// UN SEUL JOUR SANS PISTE N EFFACE PAS LA FORMULE : il lui retire un jour.
const prixUnJourSansPiste = prixDeLaFiche(
  formulesDesPrix, lieuDesPrix, agendaDesPrix, [], new Set([joursDesPrix[0]]));
const uneFormuleAPiste = prixUnJourSansPiste.find((p) => avecPiste.includes(p.id));
const memeFormuleSansBlocage = prixSansBlocage.find((p) => p.id === (uneFormuleAPiste || {}).id);
ok('CONTRE-PREUVE : un seul jour sans piste retire un jour, pas la formule',
  Boolean(uneFormuleAPiste) && Boolean(memeFormuleSansBlocage)
  && uneFormuleAPiste.jours === memeFormuleSansBlocage.jours - 1,
  JSON.stringify({ apres: uneFormuleAPiste, avant: memeFormuleSansBlocage }));

// FAIL-OPEN ASSUME : ne pas savoir ne retire rien.
ok('FAIL-OPEN : sans lecture du parc, aucune formule n est retiree',
  prixDeLaFiche(formulesDesPrix, lieuDesPrix, agendaDesPrix, [], null).length === prixSansBlocage.length,
  'le fail-open ne tient plus');

// ET LE TROU EST NOMME, sinon le gerant voit ses prix bowling disparaitre
// sans en connaitre la cause.
const ficheParcArrete = ficheDuRegistre({
  reservations: [], formules: [], aujourdhui: '2026-09-10',
  agenda: agendaDesPrix, prix: prixParcArrete, joursSansPiste: joursDesPrix,
});
ok('le trou des pistes est nomme au gerant',
  Boolean(ficheParcArrete.pistes_toutes_en_maintenance)
  && ficheParcArrete.pistes_toutes_en_maintenance.audience === 'interne',
  String(ficheParcArrete.pistes_toutes_en_maintenance
    && ficheParcArrete.pistes_toutes_en_maintenance.audience));
ok('et il compte les jours concernes',
  new RegExp(`^${joursDesPrix.length} jours ouverts`)
    .test(String(ficheParcArrete.pistes_toutes_en_maintenance.valeur)),
  String(ficheParcArrete.pistes_toutes_en_maintenance.valeur));
ok('CONTRE-PREUVE : sans jour sans piste, aucun fait',
  !ficheDuRegistre({
    reservations: [], formules: [], aujourdhui: '2026-09-10',
    agenda: agendaDesPrix, prix: prixSansBlocage,
  }).pistes_toutes_en_maintenance,
  'un fait de pistes a ete pose sans une seule journee concernee');
console.log(`\n${failures ? `center-facts-check: ${failures} ECHEC(S)` : 'center-facts-check: ALL OK'}`);
process.exit(failures ? 1 : 0);
