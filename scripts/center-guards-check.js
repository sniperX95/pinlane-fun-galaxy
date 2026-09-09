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

// ── LE REFUS RESTE UTILE ────────────────────────────────────────────────────
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
ok('un seul seau connu ne declenche rien : il n y a pas de distribution a juger',
  distributionSuspecte({ 19: 12 }).suspecte === false);

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

console.log(`\n${failures ? `center-guards-check: ${failures} ECHEC(S)` : 'center-guards-check: ALL OK'}`);
process.exit(failures ? 1 : 0);
