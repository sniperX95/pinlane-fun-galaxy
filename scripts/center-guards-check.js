// Gate des garde-fous de l'agent marketing (lib/center-guards.js).
// SANS réseau ni DB : le module est pur, le gate l'est aussi. Les chiffres
// utilisés viennent d'un relevé de production du 2026-09-09 sur Libramont et
// sont figés ici comme montage, pas lus en base.
// node scripts/center-guards-check.js
const {
  fait,
  maturite,
  peutAffirmer,
  reformulerEnHypothese,
  elire,
  distributionSuspecte,
  nombresDe,
  verifierProvenance,
  conseilDeRegleCommerciale,
  unitesIncoherentes,
  NATURES,
  N_POUR_ELIRE,
} = require('../lib/center-guards');

let failures = 0;
function ok(label, condition, detail = '') {
  if (condition) {
    console.log(`ok    ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${label}${detail ? `  ${detail}` : ''}`);
}

// ── MONTAGE : le relevé de production ───────────────────────────────────────
// 192 réservations sur les 8 formules anniversaire actives (toutes min_pax 6),
// du 2026-06-28 au 2026-11-10, mais concentrées sur 5 mois : aucun hiver.
// 32 d'entre elles sont sous 8 personnes, pour 5607 EUR.
const MOIS_OBSERVES = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-11'];
const anniv = fait({
  id: 'anniv_volume',
  libelle: 'reservations sur les formules anniversaire actives',
  valeur: 192,
  n: 192,
  du: '2026-06-28',
  au: '2026-11-10',
  mois: MOIS_OBSERVES,
  source: 'reservations jointes a formulas where is_birthday_formula',
});
const sous8 = fait({
  id: 'anniv_sous_8',
  libelle: 'reservations anniversaire a moins de 8 personnes',
  valeur: '32 reservations, 5607 EUR',
  n: 32,
  du: '2026-06-28',
  au: '2026-11-10',
  mois: MOIS_OBSERVES,
  source: 'meme requete, filtre pax < 8',
});
const fiche = { anniv_volume: anniv, anniv_sous_8: sous8 };

console.log('[MONTAGE] le releve de production sert de situation');
ok('le fait anniversaire porte bien 192 observations sur 5 mois',
  anniv.n === 192 && anniv.mois.length === 5, JSON.stringify(maturite(anniv)));

// ── MATURITÉ : nourri ne veut pas dire saisonnier ───────────────────────────
console.log('\n[MATURITE] le volume et la saison sont deux questions distinctes');
const m = maturite(anniv);
ok(`192 observations sont jugees « ${m.volume} »`, m.volume === 'dense', JSON.stringify(m));
ok(`5 mois sont juges « ${m.saison} », pas un cycle`, m.saison === 'partiel', JSON.stringify(m));
ok('un constat est autorise sur ce fait', peutAffirmer(anniv, 'constat').autorise);
ok('une affirmation SAISONNIERE est refusee : aucun hiver observe',
  peutAffirmer(anniv, 'saisonnier').autorise === false,
  JSON.stringify(peutAffirmer(anniv, 'saisonnier')));
// Compter n'est pas estimer. « 32 reservations sont sous 8 personnes » est
// vrai quel que soit l'echantillon ; « le mardi est ton jour creux » generalise
// depuis 22 observations et doit etre bloque.
console.log('\n[GENRE] compter n est pas estimer');
ok('un DENOMBREMENT a 32 observations porte un constat : compter ne demande aucune puissance',
  peutAffirmer(sous8, 'constat').autorise === true, JSON.stringify(peutAffirmer(sous8, 'constat')));
const jourCreux = fait({
  id: 'jour_creux',
  libelle: 'jour de semaine le plus creux',
  valeur: 'mardi : 22 resas',
  n: 22,
  du: '2026-07-01',
  au: '2026-08-31',
  mois: ['2026-07', '2026-08'],
  genre: 'estimation',
  source: 'group by jour de semaine',
});
ok('une ESTIMATION a 22 observations est refusee',
  peutAffirmer(jourCreux, 'constat').autorise === false, JSON.stringify(peutAffirmer(jourCreux, 'constat')));
ok('MONTAGE : les deux faits ont un n voisin (32 et 22), seul le genre les separe',
  Math.abs(sous8.n - jourCreux.n) <= 10);
const memeFaitDenombre = fait({ ...jourCreux, genre: 'denombrement' });
ok('CONTRE-PREUVE : le meme fait declare denombrement passerait, donc le genre mord',
  peutAffirmer(memeFaitDenombre, 'constat').autorise === true);
ok('un genre inconnu retombe sur ESTIMATION, le cas prudent',
  fait({ id: 'x', valeur: 1, n: 1, genre: 'nimporte quoi' }).genre === 'estimation');
// Le genre lève la barre du CONSTAT, jamais celle du GESTE : recommander une
// action s'appuie sur un comportement observé, et un comptage n'en est pas un.
const compteMince = fait({ ...jourCreux, genre: 'denombrement' });
ok('MONTAGE : ce denombrement est bien juge anecdote et ponctuel',
  maturite(compteMince).volume === 'anecdote' && maturite(compteMince).saison === 'ponctuel',
  JSON.stringify(maturite(compteMince)));
ok('il porte un constat (c est un comptage)', peutAffirmer(compteMince, 'constat').autorise === true);
ok('mais il ne suffit PAS pour recommander un geste : le genre ne baisse que la barre du constat',
  peutAffirmer(compteMince, 'levier_reversible').autorise === false,
  JSON.stringify(peutAffirmer(compteMince, 'levier_reversible')));
ok('le fait anniversaire, lui, autorise un geste (dense et sur 5 mois)',
  peutAffirmer(anniv, 'levier_reversible').autorise === true);

// ── NATURE : un changement de règle ne se conclut jamais ────────────────────
console.log('\n[NATURE] le changement de regle commerciale reste hors de portee');
ok('« passe le minimum de 6 a 8 » est refuse comme conclusion',
  peutAffirmer(anniv, 'regle_commerciale').autorise === false);

// La preuve que ce n'est PAS un seuil d'échantillon déguisé : un fait géant,
// dense et couvrant trois cycles complets, reste refusé.
const geant = fait({
  id: 'geant',
  libelle: 'le meme fait avec 10000 observations sur 3 ans',
  // Il compare des mois : c'est ce qui lui donne le droit de parler de saison.
  periode: 'mois_annee',
  valeur: 10000,
  n: 10000,
  du: '2023-01-01',
  au: '2026-12-31',
  mois: Array.from({ length: 36 }, (unused, i) => {
    const annee = 2023 + Math.floor(i / 12);
    return `${annee}-${String((i % 12) + 1).padStart(2, '0')}`;
  }),
});
const mGeant = maturite(geant);
ok('MONTAGE : ce fait geant est bien dense et cycle_complet (sinon le refus ne prouverait rien)',
  mGeant.volume === 'dense' && mGeant.saison === 'cycle_complet', JSON.stringify(mGeant));
ok('il porte un constat ET une affirmation saisonniere',
  peutAffirmer(geant, 'constat').autorise && peutAffirmer(geant, 'saisonnier').autorise);
ok('et POURTANT le changement de regle reste refuse : impossibilite de nature, pas manque de donnees',
  peutAffirmer(geant, 'regle_commerciale').autorise === false);

// ── LES BARRES SONT ORDONNEES ───────────────────────────────────────────────
// Une affirmation plus forte ne peut pas exiger moins qu une plus faible.
// Releve en instrumentant le handler de l agent marketing : sur un registre
// riche, la barre saisonniere passait sur 20 faits quand le constat n en
// passait que 18. Deux faits trop minces pour etre simplement ENONCES pouvaient
// donc porter une conclusion sur l annee. Chaque barre etait defendable seule,
// c est leur ORDRE qui etait faux.
console.log('\n[ORDRE] une affirmation plus forte n exige jamais moins');
const echantillon = [
  // Les trois declarent une periode mensuelle : ce bloc mesure l'ORDRE des
  // barres de maturite, pas la barre de periode, qui est testee plus bas.
  // dense et cyclique
  fait({ id: 'a', valeur: 1, n: 500, periode: 'mois_annee', mois: MOIS_OBSERVES.concat(['2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07']), genre: 'estimation' }),
  // cyclique mais MINCE : le cas qui passait saisonnier sans passer constat
  fait({ id: 'b', valeur: 1, n: 4, periode: 'mois_annee', mois: MOIS_OBSERVES.concat(['2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07']), genre: 'estimation' }),
  // dense mais sur un seul ete
  fait({ id: 'c', valeur: 1, n: 500, periode: 'mois_annee', mois: ['2026-07', '2026-08'], genre: 'estimation' }),
];
ok('MONTAGE : l echantillon contient bien un fait cyclique ET mince',
  echantillon.some((f) => maturite(f).saison === 'cycle_complet' && maturite(f).volume === 'anecdote'));
const compte = (nature) => echantillon.filter((f) => peutAffirmer(f, nature).autorise).length;
ok(`saisonnier (${compte('saisonnier')}) ne depasse jamais constat (${compte('constat')})`,
  compte('saisonnier') <= compte('constat'));
ok('le fait cyclique MAIS mince est refuse en saisonnier',
  peutAffirmer(echantillon[1], 'saisonnier').autorise === false,
  JSON.stringify(peutAffirmer(echantillon[1], 'saisonnier')));
ok('MONTAGE : il couvre pourtant bien un cycle complet',
  maturite(echantillon[1]).saison === 'cycle_complet');
ok('CONTRE-PREUVE : le meme fait devenu dense passe en saisonnier',
  peutAffirmer(fait({ ...echantillon[1], n: 500 }), 'saisonnier').autorise === true);

// ── LE REFUS RESTE UTILE ────────────────────────────────────────────────────

// ── UNE RECURRENCE EXIGE UN FAIT QUI A UN RYTHME ────────────────────────────
// Mesure qui a declenche cette barre : sur un registre simule de 18 mois, 37
// faits sur 39 pouvaient porter « saisonnier », dont le panier moyen, le taux
// d'annulation et le trou de donnees de paiement. Les deux premieres
// conditions ne parlent que de la QUANTITE de donnee ; aucune ne demandait si
// le fait compare quoi que ce soit de cyclique.
console.log('\n[PERIODE] une recurrence exige un fait qui a un rythme');
const DIX_NEUF_MOIS = Array.from({ length: 19 }, (unused, i) => {
  const annee = 2026 + Math.floor((i + 2) / 12);
  return `${annee}-${String(((i + 2) % 12) + 1).padStart(2, '0')}`;
});
const agregat = fait({
  id: 'panier_moyen',
  libelle: 'panier moyen',
  valeur: '174 EUR',
  n: 1880,
  mois: DIX_NEUF_MOIS,
  genre: 'estimation',
});
ok('MONTAGE : cet agregat est dense et couvre un cycle complet',
  maturite(agregat).volume === 'dense' && maturite(agregat).saison === 'cycle_complet',
  JSON.stringify(maturite(agregat)));
ok('il porte bien un constat', peutAffirmer(agregat, 'constat').autorise === true);
ok('mais AUCUNE affirmation saisonniere : un panier moyen ne compare aucun cycle',
  peutAffirmer(agregat, 'saisonnier').autorise === false,
  JSON.stringify(peutAffirmer(agregat, 'saisonnier')));
ok('CONTRE-PREUVE : le meme fait declare mensuel passe en saisonnier',
  peutAffirmer(fait({ ...agregat, periode: 'mois_annee' }), 'saisonnier').autorise === true);
ok('un jour de semaine et une heure de journee ouvrent aussi la recurrence',
  peutAffirmer(fait({ ...agregat, periode: 'jour_semaine' }), 'saisonnier').autorise === true
  && peutAffirmer(fait({ ...agregat, periode: 'heure_jour' }), 'saisonnier').autorise === true);
// Une tendance a 90 jours compare deux periodes qui ne reviennent pas : un
// mouvement, pas un rythme. La confondre avec une saison serait exactement la
// conclusion trop rapide que tout ce module cherche a empecher.
ok('une fenetre glissante n ouvre PAS la recurrence',
  peutAffirmer(fait({ ...agregat, periode: 'fenetre_glissante' }), 'saisonnier').autorise === false);
ok('une periode inventee vaut absence de periode',
  fait({ ...agregat, periode: 'phase_lunaire' }).periode === '',
  fait({ ...agregat, periode: 'phase_lunaire' }).periode);
console.log('\n[HYPOTHESE] un refus n est pas un silence');
const hypo = reformulerEnHypothese({
  sujet: 'porter le minimum des formules anniversaire de 6 a 8 personnes',
  populationARisque: '32 reservations sous 8 personnes',
  chiffreARisque: '5607 EUR',
  comparaisonDisponible: 'la formule « Anniversaire enfants » est deja a min_pax 8 : la comparer sur 6 mois tranche sans rien changer',
});
ok('la sortie est marquee hypothese a tester', hypo.statut === 'hypothese' && hypo.aTester === true);
ok('elle chiffre la population a risque', String(hypo.populationARisque).includes('32'));
ok('elle chiffre l argent a risque', String(hypo.chiffreARisque).includes('5607'));
ok('elle propose la comparaison deja disponible au catalogue', Boolean(hypo.comparaisonDisponible));

// ── ÉLECTION : pas de champion sur une vente ────────────────────────────────
console.log('\n[ELECTION] un classement refuse d elire sous le seuil');
const candidats = [
  { nom: 'FUN FRIDAY MADNESS', n: 1, panier: 450 },
  { nom: 'FORMULE 4', n: 19, panier: 421 },
];
const scrutin = elire(candidats, (c) => c.panier);
ok('MONTAGE : le candidat a 1 vente a bien le MEILLEUR score (sinon l ecart ne prouverait rien)',
  candidats[0].panier > candidats[1].panier);
ok('il n est pas elu malgre ce meilleur score',
  scrutin.elu && scrutin.elu.nom === 'FORMULE 4', JSON.stringify(scrutin.elu));
ok('les candidats ecartes sont comptes', scrutin.ecartes === 1, String(scrutin.ecartes));
const desert = elire([{ nom: 'FUN FRIDAY MADNESS', n: 1, panier: 450 }], (c) => c.panier);
ok('sans candidat eligible il n y a PAS de vainqueur', desert.elu === null, JSON.stringify(desert));
ok('et le refus dit combien d observations manquaient',
  String(desert.motif || '').includes(String(N_POUR_ELIRE)), desert.motif);

// ── ARTEFACT : une masse sur un seul seau ───────────────────────────────────
console.log('\n[ARTEFACT] une distribution degeneree n est pas un comportement');
// Relevé réel : 226 des 253 réservations actives créées à 0h00 par le seed.
const heuresSeed = { 0: 226, 13: 4, 19: 8, 21: 15 };
const suspect = distributionSuspecte(heuresSeed);
ok('226 commandes sur 253 a 0h sont vues comme fabriquees', suspect.suspecte === true, JSON.stringify(suspect));
ok('le motif nomme la part et le seau', suspect.part === 89.3 && suspect.motif.includes('"0"'), suspect.motif);
const soiree = { 17: 40, 18: 35, 19: 30, 20: 25 };
ok('une vraie soiree etalee passe sans alerte',
  distributionSuspecte(soiree).suspecte === false, JSON.stringify(distributionSuspecte(soiree)));
// Ce qui autorise le jugement est le VOLUME, pas le nombre de seaux. Douze
// reservations toutes a 19h peuvent etre un vrai creneau ; quarante lignes
// horodatees a la meme seconde par un seed ne le sont pas. La premiere version
// sortait des qu'il n'y avait qu'un seul seau, donc laissait passer le cas le
// plus degenere possible : le gate de la fiche l'a montre.
ok('12 commandes toutes a 19h ne suffisent pas pour crier a l artefact',
  distributionSuspecte({ 19: 12 }).suspecte === false, JSON.stringify(distributionSuspecte({ 19: 12 })));
ok('mais 40 commandes toutes a la meme heure, si : un seul seau a 100 %',
  distributionSuspecte({ 0: 40 }).suspecte === true, JSON.stringify(distributionSuspecte({ 0: 40 })));
ok('MONTAGE : les deux cas ont bien UN seul seau, seul le volume les separe',
  Object.keys({ 19: 12 }).length === 1 && Object.keys({ 0: 40 }).length === 1);

// ── PROVENANCE : aucun nombre inventé ───────────────────────────────────────
console.log('\n[PROVENANCE] tout nombre ecrit doit exister dans la fiche');
const vrai = 'Sur 192 reservations anniversaire, 32 sont sous 8 personnes, soit 5607 EUR.';
ok('un texte qui ne cite que des faits de la fiche passe',
  verifierProvenance(vrai, fiche).propre, JSON.stringify(verifierProvenance(vrai, fiche).intrus));

const invente = 'Sur 192 reservations, tu perdrais 42 % de marge en restant a 6.';
const sale = verifierProvenance(invente, fiche);
ok('un pourcentage invente est attrape', sale.propre === false && sale.intrus.includes('42'), JSON.stringify(sale.intrus));

// Le piège qui rendrait la garde inutilisable : un montant formaté à la
// française contient une espace fine insécable. Le couper ferait rejeter un
// texte VRAI, on débrancherait la garde, et il n'y aurait plus de garde.
const formate = `Ces reservations pesent ${(5607).toLocaleString('fr-FR')} EUR.`;
const lu = nombresDe(formate).map((x) => x.valeur);
ok('MONTAGE : le montant formate contient bien un separateur invisible',
  formate !== 'Ces reservations pesent 5607 EUR.', JSON.stringify(formate));
ok('il est lu comme UN seul nombre, pas deux', lu.length === 1 && lu[0] === 5607, JSON.stringify(lu));
ok('et le texte passe la provenance', verifierProvenance(formate, fiche).propre,
  JSON.stringify(verifierProvenance(formate, fiche).intrus));

const presque = 'Ces reservations pesent 5608 EUR.';
ok('un montant faux de 1 EUR est REFUSE : aucune tolerance sur une valeur fausse',
  verifierProvenance(presque, fiche).propre === false,
  JSON.stringify(verifierProvenance(presque, fiche).intrus));

// ── CONTRE-PREUVES PAR MUTATION ─────────────────────────────────────────────
// Une garde qu'on n'a pas vue mordre n'est pas une garde.

// ── LA GARDE QUI LIT LE TEXTE, PAS L'ETIQUETTE ──────────────────────────────
// Le cas nomme par Movsar : « il voit que les formules anniversaire sont a 6
// personnes minimum, il constate que 8 serait plus rentable, il ne faut pas
// qu'il dise ca apres 10 reservations ». Le modele ne declarera jamais
// « regle_commerciale » : cette nature n'est pas dans la liste qu'il peut
// choisir. Il ecrira le conseil sous l'etiquette « levier_reversible », et la
// nature declaree ne l'arretera pas.
console.log('\n[REGLE COMMERCIALE] un conseil de changement est vu dans le texte');
const CONSEILS_INTERDITS = [
  'Il faudrait passer le minimum anniversaire a 8 personnes.',
  'Je recommande d augmenter le prix du samedi soir.',
  'On peut supprimer la formule qui ne se vend pas.',
  'Revoyez les horaires du dimanche matin.',
  'Instaurez un acompte pour les groupes.',
];
CONSEILS_INTERDITS.forEach((texte) => {
  const verdict = conseilDeRegleCommerciale(texte);
  ok(`rejete : ${texte}`, verdict.detecte === true, JSON.stringify(verdict.extraits));
});

// Le prix d'une garde lexicale, c'est le faux positif. Ces phrases DECRIVENT,
// ou visent un objectif qui ne touche a aucune regle : elles doivent passer,
// sinon l'agent devient muet sur sa propre activite et on debranche la garde.
console.log('\n[REGLE COMMERCIALE] ce qui decrit ou vise un objectif passe');
const CONSEILS_LEGITIMES = [
  'La frequentation baisse le mardi.',
  'Le panier moyen augmente en juillet.',
  'Objectif : augmenter la notoriete locale.',
  '32 reservations sont sous 8 personnes.',
  'Le prix moyen est de 25 EUR par personne.',
];
CONSEILS_LEGITIMES.forEach((texte) => {
  const verdict = conseilDeRegleCommerciale(texte);
  ok(`passe : ${texte}`, verdict.detecte === false, JSON.stringify(verdict.extraits));
});

// ── UN CHIFFRE COLLE A UNE UNITE ────────────────────────────────────────────
// Trou mesure : « nos 7 pistes de bowling » passait la garde de provenance,
// parce que 7 existe ailleurs dans la fiche (« laser des 7 ans »). Le centre
// en a 8. La provenance dit quun nombre EXISTE ; elle ne peut pas dire quil
// est au bon endroit.
console.log('\n[UNITES] un chiffre se verifie contre SON unite');
const ficheUnites = {
  identite_bowling: fait({ id: 'identite_bowling', libelle: 'bowling', valeur: '8 pistes, 450 m2, 6 joueurs maximum par piste', n: 3, genre: 'denombrement' }),
  identite_duckpin: fait({ id: 'identite_duckpin', libelle: 'duckpin', valeur: '2 pistes, 40 m2', n: 2, genre: 'denombrement' }),
  identite_minigolf: fait({ id: 'identite_minigolf', libelle: 'minigolf', valeur: '300 m2, 12 trous', n: 2, genre: 'denombrement' }),
  identite_laser: fait({ id: 'identite_laser', libelle: 'laser', valeur: '500 m2, 30 joueurs maximum, des 7 ans', n: 3, genre: 'denombrement' }),
};

const UNITES_ATTENDUES = [
  ['Nos 8 pistes de bowling.', false],
  ['Nos 2 pistes de duckpin.', false],
  ['Le laser accueille 30 joueurs.', false],
  ['Le minigolf a 12 trous.', false],
  ['Nos 7 pistes de bowling.', true],
  ['Le laser accueille 45 joueurs.', true],
  ['Le minigolf a 18 trous.', true],
];
UNITES_ATTENDUES.forEach(([texte, doitTomber]) => {
  const fautes = unitesIncoherentes(texte, ficheUnites);
  ok(`${doitTomber ? 'rejete' : 'passe '} : ${texte}`,
    (fautes.length > 0) === doitTomber, JSON.stringify(fautes));
});

// La garde ne contraint QUE ce que la fiche declare. Inventer une contrainte
// sur ce qu'on ne connait pas produirait des refus aveugles : le centre ne dit
// rien de ses tables, donc un nombre de tables ne se juge pas ici.
ok('une unite absente de la fiche ne contraint rien',
  unitesIncoherentes('Nos 9 tables de billard.', ficheUnites).length === 0);
ok('un mot qui n est pas une unite verifiable ne declenche rien',
  unitesIncoherentes('Une soiree pour 40 personnes.', ficheUnites).length === 0);

// LE COUT ASSUME, ecrit pour qu il ne surprenne personne : une somme vraie est
// refusee. Le centre a 8 pistes de bowling et 2 de duckpin, donc « 10 pistes au
// total » tombe. Refuser une phrase vraie coute une phrase ; accepter
// « 7 pistes » coute un client devant un comptoir.
ok('COUT ASSUME : une somme legitime tombe aussi',
  unitesIncoherentes('On a 10 pistes au total.', ficheUnites).length > 0);

// CONTRE-PREUVE : sur une fiche qui ne declare aucune unite, plus rien ne
// tombe. Si ce test restait rouge, la garde mordrait sur autre chose que la
// declaration du centre.
ok('CONTRE-PREUVE : fiche sans unite declaree, plus aucun refus',
  unitesIncoherentes('Nos 7 pistes de bowling.', {}).length === 0);
console.log('\n[CONTRE-PREUVES] chaque garde est montree en train de mordre');

const natureSansRefus = { exige: () => true };
ok('garde « regle commerciale » debranchee : le refus disparait',
  peutAffirmer(anniv, 'regle_commerciale').autorise === false
  && natureSansRefus.exige(maturite(anniv)) === true);
ok('MONTAGE : la vraie regle refuse bien par construction',
  NATURES.regle_commerciale.exige(maturite(geant)) === false);

const sansSeuil = elire(candidats, (c) => c.panier, { minN: 0 });
ok('seuil d election neutralise : la formule a 1 vente REMONTE en tete',
  sansSeuil.elu && sansSeuil.elu.nom === 'FUN FRIDAY MADNESS', JSON.stringify(sansSeuil.elu));

const ficheVide = {};
const sansFiche = verifierProvenance(vrai, ficheVide);
ok('fiche videe : le texte VRAI devient intrus, donc la provenance mordait',
  sansFiche.propre === false && sansFiche.intrus.length > 0, JSON.stringify(sansFiche.intrus));


// La conjonction verbe + objet : retirer l'un des deux doit suffire a laisser
// passer, sinon la garde ne mesure qu'un seul des deux termes.
ok('sans verbe de changement, la meme phrase passe',
  conseilDeRegleCommerciale('Le minimum anniversaire est a 6 personnes.').detecte === false);
ok('sans objet de regle, la meme phrase passe',
  conseilDeRegleCommerciale('Il faudrait passer a une communication plus locale.').detecte === false);
ok('MONTAGE : les deux ensemble tombent bien',
  conseilDeRegleCommerciale('Il faudrait passer le minimum a 8.').detecte === true);

// Les deux defauts que j'ai ecrits avant de les corriger, verrouilles ici :
// (1) normaliser avant de decouper efface le point, donc tout le texte devient
// une seule phrase et un verbe rencontre un objet qu'il n'a jamais croise ;
// (2) comparer sans borne d'espace fait matcher « passer » dans « depasser ».
// Si l'une de ces deux lignes repasse a true, le defaut est revenu.
ok('CONTRE-PREUVE decoupage : verbe et objet dans DEUX phrases ne comptent pas',
  conseilDeRegleCommerciale('Le prix est stable. Il faudrait changer la communication.').detecte === false);
ok('CONTRE-PREUVE bornes : depasser ne vaut pas passer',
  conseilDeRegleCommerciale('Il faut depasser les formules classiques du secteur.').detecte === false);
console.log(`\n${failures ? `center-guards-check: ${failures} ECHEC(S)` : 'center-guards-check: ALL OK'}`);
process.exit(failures ? 1 : 0);
