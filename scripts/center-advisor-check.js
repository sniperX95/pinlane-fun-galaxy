// Gate du conseil sans gabarit (lib/center-advisor.js).
// Le modèle est SIMULÉ : on lui fait dire exactement ce qu'on veut, et on
// vérifie que les garde-fous acceptent ou jettent. Aucun réseau, aucune DB.
// node scripts/center-advisor-check.js
const { proposerDepuisLaFiche, faitsUtiles, motifsDeRejet, NATURES_PROPOSABLES } = require('../lib/center-advisor');
const { ficheDuRegistre } = require('../lib/center-facts');

let failures = 0;
function ok(label, condition, detail = '') {
  if (condition) {
    console.log(`ok    ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${label}${detail ? `  ${detail}` : ''}`);
}

// Le modèle simulé : il rend ce qu'on lui dicte, sans jamais sortir sur le réseau.
function modeleQuiRepond(objet) {
  return async () => ({
    ok: true,
    json: async () => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(objet) }],
    }),
  });
}

const LIEU = { nom: 'Fun Galaxy Libramont', ville: 'Libramont' };

function resa(over = {}) {
  return {
    date: '2026-07-04', start_time: '14:00', status: 'paid', channel: 'public',
    pax: 8, price: 200, base_price: 200, formule_id: 'f1',
    email: 'client@example.test', name: 'Client',
    created_at: '2026-06-20T17:30:00.000Z', payment_method: 'Comptoir',
    occasion: 'amis', ...over,
  };
}
function serie(nb, over = {}, depart = new Date('2026-01-05T00:00:00Z')) {
  return Array.from({ length: nb }, (unused, i) => {
    const d = new Date(depart.getTime() + i * 7 * 86400000);
    return resa({
      date: d.toISOString().slice(0, 10),
      email: `client${i}@example.test`,
      created_at: new Date(d.getTime() - 9 * 86400000 + (i % 5) * 3600000).toISOString(),
      ...over,
    });
  });
}

(async () => {
  const cleSauvee = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'cle-de-mesure';

  // 120 réservations étalées sur ~28 mois : assez pour que des faits portent.
  const fiche = ficheDuRegistre({ reservations: serie(120), formules: [], aujourdhui: '2028-04-20' });
  const utiles = faitsUtiles(fiche);

  console.log('[MONTAGE] la fiche porte de quoi parler');
  ok('la fiche contient des faits', Object.keys(fiche).length >= 10, String(Object.keys(fiche).length));
  ok('au moins un fait peut porter une affirmation proposable', utiles.length > 0, String(utiles.length));
  ok('chaque fait utile annonce ce qu il peut porter',
    utiles.every((f) => Array.isArray(f.peutPorter) && f.peutPorter.length > 0));
  ok('aucun fait ne propose « regle_commerciale »',
    utiles.every((f) => !f.peutPorter.includes('regle_commerciale')));

  const idConstat = (utiles.find((f) => f.peutPorter.includes('constat')) || {}).id;
  ok('MONTAGE : un fait porteur de constat existe', Boolean(idConstat), idConstat);
  const valeurCitable = String(fiche[idConstat].valeur).match(/[0-9]+/);
  const nombreVrai = valeurCitable ? valeurCitable[0] : '';

  // ── ACCEPTATION ───────────────────────────────────────────────────────────
  console.log('\n[ACCEPTE] une proposition ancree passe');
  const bonne = {
    titre: 'Ce que dit ton registre',
    corps: `Sur ton registre, ${fiche[idConstat].libelle} vaut ${nombreVrai}.`,
    nature: 'constat',
    faitsUtilises: [idConstat],
  };
  const acceptee = await proposerDepuisLaFiche({ fiche, lieu: LIEU, fetchImpl: modeleQuiRepond(bonne) });
  ok('la proposition est retenue', Boolean(acceptee.proposition), JSON.stringify(acceptee.motifs));
  ok('elle garde les faits cites',
    acceptee.proposition && acceptee.proposition.faitsUtilises.includes(idConstat));


  // ── LE MODELE QUI MENT SUR LA NATURE ──────────────────────────────────────
  // Le cas de Movsar, monte de facon a ce qu AUCUNE autre garde ne puisse le
  // rejeter : le nombre utilise est pris DANS la fiche, donc la provenance est
  // propre, et la nature declaree est « levier_reversible », qui est permise.
  // Seule la lecture du texte peut l arreter. Si ce test passe au vert sans la
  // garde, c est qu une autre garde faisait le travail par accident.
  console.log('\n[REGLE COMMERCIALE] la nature declaree ne sauve pas le conseil');
  const { nombresAutorises, verifierProvenance: provenance } = require('../lib/center-guards');
  const autorises = [...nombresAutorises(fiche)].filter((n) => Number.isInteger(n) && n > 1 && n < 100);
  ok('MONTAGE : la fiche contient un entier citable', autorises.length > 0, String(autorises.length));
  const corpsMenteur = `Il faudrait passer le minimum des formules a ${autorises[0]} personnes.`;
  ok('MONTAGE : ce corps est propre pour la provenance',
    provenance(corpsMenteur, fiche).propre === true, JSON.stringify(provenance(corpsMenteur, fiche).intrus));
  const menteur = await proposerDepuisLaFiche({
    fiche,
    lieu: LIEU,
    fetchImpl: modeleQuiRepond({
      titre: 'Une piste pour les groupes',
      corps: corpsMenteur,
      nature: 'levier_reversible',
      faitsUtilises: [idConstat],
    }),
  });
  ok('le conseil de changer le minimum est jete', menteur.proposition === null,
    JSON.stringify(menteur.motifs));
  ok('et le motif nomme la regle commerciale, pas un nombre invente',
    menteur.motifs.some((m) => m.includes('regle commerciale')), JSON.stringify(menteur.motifs));

  // CONTRE-EPREUVE : le meme fait, decrit au lieu d etre transforme en consigne,
  // doit passer. Sinon la garde interdit de PARLER du minimum, pas de le changer.
  const descriptif = await proposerDepuisLaFiche({
    fiche,
    lieu: LIEU,
    fetchImpl: modeleQuiRepond({
      titre: 'Ce que dit ton registre',
      corps: `Les groupes de ${autorises[0]} personnes reviennent souvent le week-end.`,
      nature: 'constat',
      faitsUtilises: [idConstat],
    }),
  });
  ok('CONTRE-EPREUVE : decrire le meme nombre reste autorise',
    Boolean(descriptif.proposition), JSON.stringify(descriptif.motifs));

  // ── LES CHIFFRES DU CENTRE PASSENT ENFIN LA PROVENANCE ────────────────────
  // Avant l'identite dans la fiche, le modele voyait « laser 500 m2, 30
  // joueurs » dans son prompt et se faisait jeter s il les ecrivait. Le seul
  // comportement possible etait de se taire sur ce que le centre vend.
  console.log('\n[IDENTITE] ce que le centre EST devient citable');
  const { ajouterIdentite } = require('../lib/center-facts');
  // buildCenterFacts est deja importe plus bas dans ce gate : on le prend
  // sous un autre nom plutot que de le redeclarer dans la meme portee.
  const { buildCenterFacts: identiteDuCentre } = require('../lib/marketing-agents');
  const identiteL = identiteDuCentre('libramont');
  const ficheAvecIdentite = ajouterIdentite(fiche, identiteL);
  ok('MONTAGE : la fiche enrichie porte le laser du centre',
    Boolean(ficheAvecIdentite.identite_laser_game),
    Object.keys(ficheAvecIdentite).filter((k) => k.startsWith('identite_')).join(','));

  const corpsIdentite = `Notre laser game fait 500 m2 sur 2 etages et accueille 30 joueurs.`;
  const avecIdentite = await proposerDepuisLaFiche({
    fiche: ficheAvecIdentite,
    lieu: LIEU,
    centerFacts: identiteL,
    fetchImpl: modeleQuiRepond({ titre: 'Notre laser', corps: corpsIdentite, nature: 'constat', faitsUtilises: [idConstat] }),
  });
  ok('une proposition qui cite le laser du centre est acceptee',
    Boolean(avecIdentite.proposition), JSON.stringify(avecIdentite.motifs));

  // CONTRE-PREUVE : la MEME phrase sur la fiche SANS identite est rejetee. Sans
  // ca, l'assertion ci-dessus ne prouverait pas que c'est l'identite qui
  // autorise ces chiffres.
  const sansIdentite = await proposerDepuisLaFiche({
    fiche,
    lieu: LIEU,
    centerFacts: identiteL,
    fetchImpl: modeleQuiRepond({ titre: 'Notre laser', corps: corpsIdentite, nature: 'constat', faitsUtilises: [idConstat] }),
  });
  ok('CONTRE-EPREUVE : sans l identite dans la fiche, la meme phrase est jetee',
    sansIdentite.proposition === null, JSON.stringify(sansIdentite.motifs));

  // Et l'identite du VOISIN reste interdite, evidemment.
  const laserDuVoisin = await proposerDepuisLaFiche({
    fiche: ficheAvecIdentite,
    lieu: LIEU,
    centerFacts: identiteL,
    fetchImpl: modeleQuiRepond({ titre: 'Notre laser', corps: 'Notre laser fait 370 m2.', nature: 'constat', faitsUtilises: [idConstat] }),
  });
  ok('les 370 m2 de Gembloux restent refuses sur Libramont',
    laserDuVoisin.proposition === null, JSON.stringify(laserDuVoisin.motifs));

  // ── LE CONSEILLER NE SE REPETE PAS ────────────────────────────────────────
  console.log('\n[REPETITION] une idee deja partie ne repart pas');
  const dejaSorti = [{
    title: 'Ce que dit ton registre',
    proposed_at: '2028-05-20T10:00:00.000Z',
    data_basis: [{ factId: idConstat }],
  }];
  const rabache = await proposerDepuisLaFiche({
    fiche,
    lieu: LIEU,
    historique: dejaSorti,
    aujourdhui: '2028-04-20',
    fetchImpl: modeleQuiRepond(bonne),
  });
  ok('la meme proposition, deja partie, est jetee',
    rabache.proposition === null, JSON.stringify(rabache.motifs));
  ok('et le motif dit que c est du deja-dit',
    rabache.motifs.some((m) => m.includes('deja dit')), JSON.stringify(rabache.motifs));

  // CONTRE-EPREUVE : la MEME proposition sans historique passe. C'est ce qui
  // prouve que c'est bien la memoire qui l'arrete, et rien d'autre.
  const neuve = await proposerDepuisLaFiche({
    fiche,
    lieu: LIEU,
    historique: [],
    aujourdhui: '2028-04-20',
    fetchImpl: modeleQuiRepond(bonne),
  });
  ok('CONTRE-EPREUVE : sans historique, la meme proposition passe',
    Boolean(neuve.proposition), JSON.stringify(neuve.motifs));

  // ── LE POST NE PARLE PAS D'ARGENT ─────────────────────────────────────────
  console.log('\n[AUDIENCE] un post client ne sort ni le chiffre ni les sujets internes');
  const idInterne = Object.keys(fiche).find((id) => fiche[id].audience !== 'public');
  ok('MONTAGE : la fiche contient bien un fait reserve au gerant',
    Boolean(idInterne), idInterne);

  const citeInterne = await proposerDepuisLaFiche({
    fiche,
    lieu: LIEU,
    fetchImpl: modeleQuiRepond({ titre: 'Une idee', corps: 'Voila une idee simple.', nature: 'constat', faitsUtilises: [idInterne] }),
  });
  ok('citer un fait reserve au gerant comme source est refuse',
    citeInterne.proposition === null, JSON.stringify(citeInterne.motifs));
  ok('et le motif dit que ce fait n est pas publiable',
    citeInterne.motifs.some((m) => m.includes('non publiables')), JSON.stringify(citeInterne.motifs));

  // Le nombre du chiffre d affaires, ecrit sans citer le fait : la garde de
  // provenance le laisserait passer, puisqu il existe dans la fiche.
  const montant = String(fiche.ca_total && fiche.ca_total.valeur).match(/[0-9]+/);
  ok('MONTAGE : la fiche porte bien un chiffre d affaires', Boolean(montant), String(montant));
  const sortLeChiffre = await proposerDepuisLaFiche({
    fiche,
    lieu: LIEU,
    fetchImpl: modeleQuiRepond({
      titre: 'Merci a vous',
      corps: `Cette annee represente ${montant[0]} chez nous.`,
      nature: 'constat',
      faitsUtilises: [idConstat],
    }),
  });
  ok('ecrire le chiffre d affaires dans un post est refuse',
    sortLeChiffre.proposition === null, JSON.stringify(sortLeChiffre.motifs));
  ok('et le motif nomme un chiffre reserve au gerant',
    sortLeChiffre.motifs.some((m) => m.includes('reserves au gerant')), JSON.stringify(sortLeChiffre.motifs));

  // Le modele ne voit meme pas ces faits : confort, pas garde, mais mesurable.
  const espionAudience = [];
  const espion = async (url, options) => {
    espionAudience.push(String((options && options.body) || ''));
    return {
      ok: true,
      json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(bonne) }] }),
    };
  };
  await proposerDepuisLaFiche({ fiche, lieu: LIEU, fetchImpl: espion });
  ok('le chiffre d affaires n arrive meme pas dans le prompt',
    espionAudience.length === 1 && !espionAudience[0].includes(String(montant[0])),
    espionAudience[0] ? espionAudience[0].slice(0, 120) : 'aucune requete');

  // ── UN REFUS N EST PAS UN SILENCE ─────────────────────────────────────────
  // reformulerEnHypothese existait, etait exportee, avait son gate, et n etait
  // appelee NULLE PART. Le refus produisait donc du vide : l'agent voyait
  // quelque chose et n'en disait rien. Il rend maintenant une PISTE, qui est une
  // question a trancher, jamais une conclusion.
  console.log('\n[PISTE] le refus d une regle commerciale ouvre une question');
  const ficheCatalogue = ficheDuRegistre({
    reservations: serie(120),
    formules: [
      { id: 'f1', name: 'Anniversaire Kids', min_pax: 6, active: true },
      { id: 'f2', name: 'Sortie Scolaire', min_pax: 15, active: true },
    ],
    aujourdhui: '2028-04-20',
  });
  const idPublie = Object.keys(ficheCatalogue).find((id) => ficheCatalogue[id].audience === 'public');
  ok('MONTAGE : cette fiche porte un fait publiable et un catalogue a deux minimums',
    Boolean(idPublie) && Boolean(ficheCatalogue.comparaison_de_minimums),
    String(idPublie));

  const refusAvecPiste = await proposerDepuisLaFiche({
    fiche: ficheCatalogue,
    lieu: LIEU,
    fetchImpl: modeleQuiRepond({
      titre: 'Le minimum des anniversaires',
      corps: 'Il faudrait passer le minimum des formules a 8 personnes.',
      nature: 'levier_reversible',
      faitsUtilises: [idPublie],
    }),
  });
  ok('la proposition reste jetee', refusAvecPiste.proposition === null);
  ok('mais une piste est rendue', Boolean(refusAvecPiste.piste), JSON.stringify(refusAvecPiste.motifs));
  ok('elle est marquee hypothese a tester',
    refusAvecPiste.piste.statut === 'hypothese' && refusAvecPiste.piste.aTester === true);
  ok('elle porte la population concernee, tiree de la fiche',
    Boolean(refusAvecPiste.piste.populationARisque), JSON.stringify(refusAvecPiste.piste));
  // LE POINT : la reponse est deja dans le registre. Deux minimums coexistent au
  // catalogue, donc la question se tranche en lisant, sans changer aucune regle.
  ok('et elle dit que la comparaison existe DEJA, sans rien changer',
    String(refusAvecPiste.piste.comparaisonDisponible).startsWith('oui'),
    String(refusAvecPiste.piste.comparaisonDisponible));

  // CONTRE-PREUVE : un refus pour une AUTRE raison ne rend aucune piste. Sinon
  // la piste serait un decor accroche a tous les refus.
  const refusOrdinaire = await proposerDepuisLaFiche({
    fiche: ficheCatalogue,
    lieu: LIEU,
    fetchImpl: modeleQuiRepond({
      titre: 'Un chiffre invente', corps: 'Nos clients notent 4,73 sur cinq.',
      nature: 'constat', faitsUtilises: [idPublie],
    }),
  });
  ok('CONTRE-PREUVE : un refus ordinaire ne rend aucune piste',
    refusOrdinaire.proposition === null && !refusOrdinaire.piste,
    JSON.stringify(refusOrdinaire.motifs));

  // ── CHAQUE SILENCE DIT SA CAUSE ───────────────────────────────────────────
  // callLlm rend null dans trois situations qui n ont rien a voir : aucun
  // fournisseur, plafond de budget, appel echoue. Le conseiller les ecrasait
  // toutes en « le modele n a rien rendu », alors que le mode Demander les
  // distingue depuis toujours. Un silence sans cause ressemble a « ce centre n a
  // rien a dire », et ca peut etre une cle absente : deux situations opposees,
  // le meme ecran vide.
  console.log('\n[SILENCE] un ecran vide dit pourquoi il est vide');

  // Sans AUCUNE cle : la cause est la configuration, pas la matiere. Et rien
  // n'est appele, donc rien n'est depense.
  const CLES = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY', 'OPENROUTER_API_KEY'];
  const clesSauvees = {};
  CLES.forEach((cle) => { clesSauvees[cle] = process.env[cle]; delete process.env[cle]; });
  let appelsSansCle = 0;
  const compteurSansCle = async () => { appelsSansCle += 1; return { ok: false, status: 500, text: async () => '' }; };
  const sansModele = await proposerDepuisLaFiche({ fiche, lieu: LIEU, fetchImpl: compteurSansCle });
  ok('sans fournisseur : la cause est nommee',
    sansModele.silence === 'sans_modele', String(sansModele.silence));
  ok('et le motif dit que c est la cle, pas la matiere',
    sansModele.motifs.some((m) => m.includes('c est la cle')), JSON.stringify(sansModele.motifs));
  ok('AUCUN appel n est tente : rien ne se depense pour rien', appelsSansCle === 0, String(appelsSansCle));
  CLES.forEach((cle) => { if (clesSauvees[cle] !== undefined) process.env[cle] = clesSauvees[cle]; });
  process.env.ANTHROPIC_API_KEY = 'cle-de-mesure';

  // Registre sans matiere : la cause est la donnee, et c'est un silence sain.
  const ficheSansMatiere = ficheDuRegistre({ reservations: [], formules: [] });
  const rienADire = await proposerDepuisLaFiche({ fiche: ficheSansMatiere, lieu: LIEU, fetchImpl: modeleQuiRepond(bonne) });
  ok('registre vide : la cause est la matiere',
    rienADire.silence === 'rien_a_dire', String(rienADire.silence));

  // Modele injoignable : la cause est le fournisseur, pas nous.
  const modeleMuet = await proposerDepuisLaFiche({
    fiche, lieu: LIEU,
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'boom' }),
  });
  ok('modele injoignable : la cause est l echec d appel',
    modeleMuet.silence === 'echec', String(modeleMuet.silence));

  // Sortie refusee par les gardes : la cause est ce que le modele a ecrit.
  const sortieJetee = await proposerDepuisLaFiche({
    fiche, lieu: LIEU,
    fetchImpl: modeleQuiRepond({ titre: 'X', corps: 'Nos clients notent 4,73 sur cinq.', nature: 'constat', faitsUtilises: [idConstat] }),
  });
  ok('sortie refusee : la cause est la sortie elle-meme',
    sortieJetee.silence === 'sortie_jetee', String(sortieJetee.silence));

  // Les quatre causes sont DISTINCTES : si deux se confondaient, nommer la
  // cause ne servirait a rien.
  const causes = [sansModele.silence, rienADire.silence, modeleMuet.silence, sortieJetee.silence];
  ok('les quatre causes sont distinctes', new Set(causes).size === 4, causes.join(','));

  // CONTRE-EPREUVE : la meme fiche, avec une cle et un modele qui repond bien,
  // rend une proposition et AUCUN silence. Sans ca, on n'aurait montre qu'un
  // conseiller qui refuse toujours.
  const parle = await proposerDepuisLaFiche({ fiche, lieu: LIEU, fetchImpl: modeleQuiRepond(bonne) });
  ok('CONTRE-EPREUVE : avec une cle et une bonne sortie, il parle et ne dit aucun silence',
    Boolean(parle.proposition) && !parle.silence, JSON.stringify(parle.motifs));

  // Le plafond de budget. Le crochet se pose sur l OBJET module AVANT de
  // recharger le conseiller : il capture isBudgetExhausted par destructuration
  // au chargement, donc reassigner l'export apres coup ne changerait rien.
  const budget = require('../lib/llm-budget');
  const budgetReel = budget.isBudgetExhausted;
  budget.isBudgetExhausted = () => true;
  delete require.cache[require.resolve('../lib/center-advisor')];
  const conseillerSousPlafond = require('../lib/center-advisor').proposerDepuisLaFiche;
  let appelsSousPlafond = 0;
  const auPlafond = await conseillerSousPlafond({
    fiche, lieu: LIEU,
    fetchImpl: async () => { appelsSousPlafond += 1; return { ok: false, status: 500, text: async () => '' }; },
  });
  ok('plafond de budget atteint : la cause est le budget',
    auPlafond.silence === 'budget', String(auPlafond.silence));
  ok('et aucun appel n est tente non plus', appelsSousPlafond === 0, String(appelsSousPlafond));
  budget.isBudgetExhausted = budgetReel;
  delete require.cache[require.resolve('../lib/center-advisor')];

  // ── LE CYCLE PERSISTE LA PISTE, SANS CONTENU A COLLER ─────────────────────
  // Une piste que personne ne persiste est une question posee dans le vide. Et
  // son contenu pret a coller DOIT rester nul, sinon la console la rend comme
  // un texte a publier.
  //
  // Premiere version de ce bloc : trois expressions regulieres sur le SOURCE de
  // center-metrics. Mutation faite sur ce gate : `if (rendu.piste)` remplace par
  // `if (false)`. La piste n etait plus jamais ecrite, et le gate restait VERT,
  // parce que /rendu\.piste/ matche encore le corps du bloc devenu mort. Un test
  // qui verifie une PRESENCE au lieu d un EFFET est un faux vert.
  //
  // On appelle donc le vrai cycle. La seule chose simulee est la frontiere de
  // base (getPool) : insertIdeaIfNew, sa requete de dedoublonnage et son INSERT
  // sont les vrais. Le crochet se pose sur l OBJET module avant tout require
  // applicatif, parce que center-metrics destructure getPool a son chargement :
  // reassigner l export apres coup ne changerait rien.
  console.log('\n[CABLAGE] la piste est ECRITE comme piste, jamais comme post');

  const requetes = [];
  const faussePool = {
    query: async (sql, params) => {
      requetes.push({ sql: String(sql), params: params || [] });
      return { rows: [] };
    },
  };
  const baseDeDonnees = require('../lib/database');
  const vraiGetPool = baseDeDonnees.getPool;
  baseDeDonnees.getPool = () => faussePool;

  // Le conseiller rend une piste et aucune proposition : exactement ce que
  // produit un refus de regle commerciale.
  const conseiller = require('../lib/center-advisor');
  const vraiConseiller = conseiller.proposerDepuisLaFiche;
  const pisteRendue = {
    sujet: 'le minimum des anniversaires',
    populationARisque: '42 sur 500 (8.4 %)',
    chiffreARisque: '51304 EUR',
    comparaisonDisponible: 'oui : 2 et 6 personnes coexistent deja au catalogue',
  };

  // La fiche et la memoire viennent de la base : on les court-circuite pour que
  // le test porte sur le CABLAGE de la piste, et sur rien d'autre.
  const faitsDuRegistre = require('../lib/center-facts');
  const vraiChargerFiche = faitsDuRegistre.chargerFicheDuRegistre;
  const vraiChargerMemoire = faitsDuRegistre.chargerMemoireDuCentre;
  faitsDuRegistre.chargerFicheDuRegistre = async () => ({});
  faitsDuRegistre.chargerMemoireDuCentre = async () => [];
  const adn = require('../lib/marketing-dna');
  const vraiAdn = adn.buildDnaBlock;
  adn.buildDnaBlock = async () => '';

  delete require.cache[require.resolve('../lib/center-metrics')];
  const cycle = require('../lib/center-metrics');

  const bundleMinimal = {
    today: '2026-09-09', forecast7: [], weatherHistory: [], localEvents: [],
    nextSchoolHoliday: null, facts: [],
  };
  const insertsDePiste = () => requetes.filter(
    (r) => /insert into marketing_insights/.test(r.sql) && r.params[1] === 'piste',
  );

  conseiller.proposerDepuisLaFiche = async () => ({
    proposition: null, motifs: ['regle commerciale'], piste: pisteRendue,
  });
  const avecPiste = await cycle.runDataIdeasCycle({ centerId: 'libramont', bundle: bundleMinimal });
  ok('MONTAGE : le conseil remonte bien une piste',
    Boolean(avecPiste.conseil && avecPiste.conseil.piste), JSON.stringify(avecPiste.conseil));
  const ecrite = insertsDePiste()[0];
  ok('LE POINT : une ligne est ECRITE en base avec le genre piste',
    Boolean(ecrite), `${requetes.length} requete(s), aucune de genre piste`);
  ok('son titre annonce une question a trancher',
    Boolean(ecrite) && String(ecrite.params[2]).startsWith('A trancher : le minimum'),
    ecrite && String(ecrite.params[2]));
  ok('son corps porte la population, l argent et la comparaison deja possible',
    Boolean(ecrite) && String(ecrite.params[3]).includes('42 sur 500')
    && String(ecrite.params[3]).includes('51304')
    && String(ecrite.params[3]).includes('coexistent deja au catalogue'),
    ecrite && String(ecrite.params[3]));
  ok('et AUCUN contenu pret a coller : elle ne se publie pas',
    Boolean(ecrite) && ecrite.params[5] === null, ecrite && JSON.stringify(ecrite.params[5]));
  ok('ni canal de publication', Boolean(ecrite) && ecrite.params[4] === null,
    ecrite && JSON.stringify(ecrite.params[4]));

  // CONTRE-PREUVE : le meme cycle, sans piste rendue, n'ecrit rien de tel. Sans
  // elle, un INSERT inconditionnel passerait le test precedent.
  requetes.length = 0;
  conseiller.proposerDepuisLaFiche = async () => ({
    proposition: null, motifs: ['rien a dire'], piste: null,
  });
  await cycle.runDataIdeasCycle({ centerId: 'libramont', bundle: bundleMinimal });
  ok('CONTRE-PREUVE : sans piste rendue, aucune ligne de genre piste',
    insertsDePiste().length === 0, `${insertsDePiste().length} ecriture(s)`);

  // ── LA QUESTION QUI PART SANS MODELE ─────────────────────────────────────
  // Le point qui compte aujourd hui : aucune cle de modele ne semble posee en
  // production. Un classement trop serre est calcule dans la FICHE, donc cette
  // question-la se pose quand meme. C est la seule chose que l agent peut encore
  // livrer quand il ne peut ecrire aucun texte.
  requetes.length = 0;
  faitsDuRegistre.chargerFicheDuRegistre = async () => ({
    mois_fort: {
      id: 'mois_fort',
      libelle: 'mois de l annee le plus rentable',
      valeur: 'mars : 190 reservations (classement fragile : sans sa plus grosse reservation, le vainqueur change)',
      n: 190,
      audience: 'public',
      fragile: true,
      motifFragilite: 'classement decide par une seule reservation',
    },
  });
  let appelsSansModele = 0;
  conseiller.proposerDepuisLaFiche = async () => {
    appelsSansModele += 1;
    return { proposition: null, motifs: ['aucun fournisseur de modele disponible'], silence: 'sans_modele', piste: null };
  };
  await cycle.runDataIdeasCycle({ centerId: 'libramont', bundle: bundleMinimal });
  const question = insertsDePiste()[0];
  ok('MONTAGE : le conseiller n a rendu AUCUNE piste de son cote',
    appelsSansModele === 1, String(appelsSansModele));
  ok('LE POINT : une question est quand meme ECRITE, sans un seul texte de modele',
    Boolean(question), `${requetes.length} requete(s)`);
  ok('son titre porte le classement concerne',
    Boolean(question) && /mois de l annee le plus rentable/.test(String(question.params[2])),
    question && String(question.params[2]));
  ok('son corps recopie la valeur du fait et la regle qui l a rendu fragile',
    Boolean(question) && String(question.params[3]).includes('mars : 190 reservations')
    && /retirer la plus grosse reservation/.test(String(question.params[3])),
    question && String(question.params[3]));
  ok('et elle ne se publie pas : aucun contenu, aucun canal',
    Boolean(question) && question.params[5] === null && question.params[4] === null);

  // ET ELLE SURVIT A UN CONSEILLER QUI PLANTE. C est ce qui verrouille l ORDRE :
  // posee apres l appel au modele, elle disparaitrait a la premiere exception,
  // avalee par le try/catch du cycle. Posee avant, elle est deja en base.
  requetes.length = 0;
  conseiller.proposerDepuisLaFiche = async () => { throw new Error('modele injoignable'); };
  await cycle.runDataIdeasCycle({ centerId: 'libramont', bundle: bundleMinimal });
  ok('la question survit a un conseiller qui leve une exception',
    insertsDePiste().length === 1, `${insertsDePiste().length} ecriture(s)`);

  // CONTRE-PREUVE : sur une fiche SANS classement fragile, rien n est ecrit.
  requetes.length = 0;
  faitsDuRegistre.chargerFicheDuRegistre = async () => ({
    mois_fort: {
      id: 'mois_fort', libelle: 'mois de l annee le plus rentable',
      valeur: 'juillet : 190 reservations', n: 190, audience: 'public', fragile: false,
    },
  });
  await cycle.runDataIdeasCycle({ centerId: 'libramont', bundle: bundleMinimal });
  ok('CONTRE-PREUVE : un classement solide n ouvre aucune question',
    insertsDePiste().length === 0, `${insertsDePiste().length} ecriture(s)`);


  // ── LE JOUR OUVERT QUI NE VEND RIEN, JUSQU EN BASE ────────────────────────
  // Le fait est INTERNE : la porte Idees ne voit que le public, donc sans ce
  // cablage il serait calcule correctement et n arriverait nulle part. C est
  // le motif deja paye trois fois dans ce projet, un tuyau sans robinet.
  requetes.length = 0;
  faitsDuRegistre.chargerFicheDuRegistre = async () => ({
    jour_ouvert_sans_vente: {
      id: 'jour_ouvert_sans_vente',
      libelle: 'jours d ouverture sans aucune reservation',
      valeur: 'mardi (40 fois dans la fenetre, aucune reservation)',
      n: 40, audience: 'interne', genre: 'denombrement',
    },
  });
  let appelsSurJourMuet = 0;
  conseiller.proposerDepuisLaFiche = async () => {
    appelsSurJourMuet += 1;
    return { proposition: null, motifs: ['rien a dire'], piste: null };
  };
  await cycle.runDataIdeasCycle({ centerId: 'libramont', bundle: bundleMinimal });
  const jourMuet = insertsDePiste()[0];
  ok('MONTAGE : le conseiller n a rendu AUCUNE piste de son cote',
    appelsSurJourMuet === 1, String(appelsSurJourMuet));
  ok('LE POINT : le jour muet arrive EN BASE comme question a trancher',
    Boolean(jourMuet), `${requetes.length} requete(s)`);
  ok('son titre nomme le jour et ne porte aucun compteur',
    Boolean(jourMuet) && String(jourMuet.params[2]) === 'A trancher : mardi : le centre ouvre et ne vend rien',
    jourMuet && String(jourMuet.params[2]));
  ok('son corps porte le denominateur ET la valeur du fait recopiee',
    Boolean(jourMuet) && String(jourMuet.params[3]).includes('40 journees d ouverture')
    && String(jourMuet.params[3]).includes('mardi (40 fois dans la fenetre, aucune reservation)'),
    jourMuet && String(jourMuet.params[3]));
  ok('elle ne se publie pas : « personne ne vient le mardi » n est pas un post',
    Boolean(jourMuet) && jourMuet.params[5] === null && jourMuet.params[4] === null);

  // ELLE SURVIT AU CONSEILLER, comme la question de fragilite : posee apres
  // l appel au modele, elle serait avalee par le try/catch du cycle.
  requetes.length = 0;
  conseiller.proposerDepuisLaFiche = async () => { throw new Error('modele injoignable'); };
  await cycle.runDataIdeasCycle({ centerId: 'libramont', bundle: bundleMinimal });
  ok('elle survit a un conseiller qui leve une exception',
    insertsDePiste().length === 1, `${insertsDePiste().length} ecriture(s)`);

  // CONTRE-PREUVE : sur un centre qui vend tous ses jours ouverts, le fait
  // n existe pas et rien n est ecrit. Sans elle, un INSERT inconditionnel
  // passerait tout ce qui precede.
  requetes.length = 0;
  faitsDuRegistre.chargerFicheDuRegistre = async () => ({
    jour_fort: {
      id: 'jour_fort', libelle: 'jour de semaine le plus rempli',
      valeur: 'samedi : 190 reservations', n: 190, audience: 'public', fragile: false,
    },
  });
  conseiller.proposerDepuisLaFiche = async () => ({
    proposition: null, motifs: ['rien a dire'], piste: null,
  });
  await cycle.runDataIdeasCycle({ centerId: 'libramont', bundle: bundleMinimal });
  ok('CONTRE-PREUVE : sans jour muet, aucune question n est ecrite',
    insertsDePiste().length === 0, `${insertsDePiste().length} ecriture(s)`);
  // Tout est rendu : les gates suivants doivent voir les vrais modules.
  baseDeDonnees.getPool = vraiGetPool;
  conseiller.proposerDepuisLaFiche = vraiConseiller;
  faitsDuRegistre.chargerFicheDuRegistre = vraiChargerFiche;
  faitsDuRegistre.chargerMemoireDuCentre = vraiChargerMemoire;
  adn.buildDnaBlock = vraiAdn;
  delete require.cache[require.resolve('../lib/center-metrics')];


  // ── L AGENT SAIT CE QUE LE STAFF A CHANGE, SANS QU ON LUI DISE ────────────
  // `getCenter` rend le socle du DEPOT tant que personne n a appele
  // refreshCenterOverrides dans ce processus. La configuration VRAIE, celle que
  // le staff modifie dans l application, vit dans `centers.settings.config` en
  // base. Le cron rafraichissait avant son cycle, la route manuelle non : ce que
  // l agent savait dependait de qui l appelait. Et deux portes sur trois lisaient
  // l identite AVANT de charger la fiche, donc avant tout rafraichissement.
  console.log('\n[CONNAISSANCE] la config changee en base atteint l agent');
  const {
    connaissanceDuCentre, chargerFicheDuRegistre: chargerVraiment, joursOuvertsDeclares,
  } = require('../lib/center-facts');
  const { applyCenterOverrides, getCenter: centreCourant } = require('../lib/ops-knowledge');

  // MONTAGE : le socle du DEPOT dit 8 pistes et un lundi ferme.
  ok('MONTAGE : le depot declare 8 pistes', centreCourant('libramont').resources.bowling.laneCount === 8,
    String(centreCourant('libramont').resources.bowling.laneCount));
  ok('MONTAGE : le depot declare le lundi ferme',
    centreCourant('libramont').defaultSchedule.regular['1'] === null);

  // LA BASE dit autre chose : 4 pistes, et le lundi OUVERT de 9 h a 23 h. C est
  // exactement le geste du gerant : « demain j ouvre le lundi ».
  const configDeLaBase = JSON.parse(JSON.stringify(centreCourant('libramont')));
  configDeLaBase.resources.bowling.laneCount = 4;
  configDeLaBase.defaultSchedule.regular['1'] = { open: '09:00', close: '23:00' };
  const ligneDuStaff = {
    id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active',
    timezone: 'Europe/Brussels', settings: { config: configDeLaBase },
  };
  const poolDuStaff = {
    query: async (sql) => (/from centers/.test(sql) ? { rows: [ligneDuStaff] } : { rows: [] }),
  };

  // 1. LA FICHE SEULE rafraichit. Testee AVANT l identite : si connaissance
  //    DuCentre passait en premier, ce serait ELLE qui aurait rafraichi, et
  //    retirer le rafraichissement de la fiche laisserait ce gate vert.
  const ficheApresChangement = await chargerVraiment({ centerId: 'libramont', aujourdhui: '2026-09-09', pool: poolDuStaff });
  ok('MONTAGE : la fiche est bien chargee', Boolean(ficheApresChangement && ficheApresChangement.registre_taille));
  ok('LE POINT : la fiche seule suffit a faire entrer le lundi ouvert',
    (joursOuvertsDeclares(centreCourant('libramont').defaultSchedule) || []).includes(1),
    JSON.stringify(joursOuvertsDeclares(centreCourant('libramont').defaultSchedule)));

  // 2. L IDENTITE SEULE rafraichit aussi. On rend le socle avant, sinon on
  //    lirait ce que la fiche vient de charger.
  applyCenterOverrides(new Map());
  ok('MONTAGE : socle rendu, le depot redit 8 pistes',
    centreCourant('libramont').resources.bowling.laneCount === 8);
  const identiteFraiche = await connaissanceDuCentre('libramont', poolDuStaff);
  ok('LE POINT : l identite seule lit les 4 pistes de la BASE',
    identiteFraiche.laneCount === 4, String(identiteFraiche.laneCount));

  // 3. ET LA PORTE « IDEES » LA DEMANDE VRAIMENT. Les deux points precedents
  //    prouvent que la fonction lit la base ; celui-ci prouve que le cycle
  //    l appelle. Sans lui, la fonction serait juste et personne ne s en
  //    servirait : c est le motif deja paye quatre fois dans ce projet.
  applyCenterOverrides(new Map());
  baseDeDonnees.getPool = () => poolDuStaff;
  faitsDuRegistre.chargerFicheDuRegistre = vraiChargerFiche;
  let identiteVueParLeConseiller = null;
  conseiller.proposerDepuisLaFiche = async (entree) => {
    identiteVueParLeConseiller = entree && entree.centerFacts;
    return { proposition: null, motifs: ['rien a dire'], piste: null };
  };
  delete require.cache[require.resolve('../lib/center-metrics')];
  const cycleFrais = require('../lib/center-metrics');
  await cycleFrais.runDataIdeasCycle({ centerId: 'libramont', bundle: bundleMinimal });
  ok('LE POINT : la porte Idees passe au conseiller l identite de la BASE',
    Boolean(identiteVueParLeConseiller) && identiteVueParLeConseiller.laneCount === 4,
    String(identiteVueParLeConseiller && identiteVueParLeConseiller.laneCount));

  // 4. LES DEUX AUTRES PORTES passent par la meme fonction. Controle
  //    STRUCTUREL assume : la FRAICHEUR est prouvee au-dessus par le
  //    comportement, ce qui reste ici est « chaque porte y passe », qui est une
  //    propriete de cablage. Un harnais de bout en bout pour ces deux portes
  //    n existe pas encore dans leurs gates ; tant qu il n existe pas, ce
  //    controle vaut mieux que rien et le dit.
  const lireLaSource = (relatif) => require('fs').readFileSync(
    require('path').join(__dirname, '..', relatif), 'utf8');
  const sourceAsk = lireLaSource('lib/marketing-ask.js');
  const sourceBrief = lireLaSource('lib/marketing-brief.js');
  ok('la porte Demander demande la connaissance fraiche',
    /connaissanceDuCentre\(/.test(sourceAsk));
  ok('la cause du silence aussi', /connaissanceDuCentre\(/.test(sourceBrief));

  // Tout est rendu une seconde fois : les gates suivants doivent voir les
  // vrais modules et le socle du depot.
  applyCenterOverrides(new Map());
  baseDeDonnees.getPool = vraiGetPool;
  conseiller.proposerDepuisLaFiche = vraiConseiller;
  faitsDuRegistre.chargerFicheDuRegistre = vraiChargerFiche;
  delete require.cache[require.resolve('../lib/center-metrics')];
  ok('CONTRE-PREUVE : socle rendu, le depot redit 8 pistes',
    centreCourant('libramont').resources.bowling.laneCount === 8,
    String(centreCourant('libramont').resources.bowling.laneCount));
  ok('CONTRE-PREUVE : et le lundi redevient ferme',
    centreCourant('libramont').defaultSchedule.regular['1'] === null);
  // ── UN REGISTRE ENDORMI NE CONSEILLE RIEN ─────────────────────────────────
  // Les faits restent vrais au passe et le mode Demander y repond toujours. Ce
  // qui devient impossible, c est le geste au present.

  // ── UN CENTRE QUI N OUVRE PAS NE CONSEILLE RIEN ───────────────────────────
  // Meme raisonnement que la dormance, autre cause : le registre peut etre
  // plein et vivant, si le centre n ouvre aucun jour de la fenetre (fermeture
  // annuelle, travaux, saison), « viens ce soir » est faux.
  console.log('\n[FERMETURE] le conseiller se tait sur un centre qui n ouvre pas');
  let appelsSurFerme = 0;
  const ficheFermee = {
    ...fiche,
    centre_ferme: {
      id: 'centre_ferme', libelle: 'le centre n ouvre aucun jour dans la fenetre',
      valeur: 'aucun jour ouvert sur les 14 prochains jours',
      n: 14, genre: 'denombrement', audience: 'interne', mois: [], du: '', au: '',
      source: 'grille du centre et fermetures declarees',
    },
  };
  const surFerme = await proposerDepuisLaFiche({
    fiche: ficheFermee, lieu: LIEU,
    fetchImpl: async () => { appelsSurFerme += 1; return { ok: false, status: 500, text: async () => '' }; },
  });
  ok('le silence a sa propre cause', surFerme.silence === 'centre_ferme', String(surFerme.silence));
  ok('le motif recopie le fait', surFerme.motifs.some((m) => m.includes('aucun jour ouvert')),
    JSON.stringify(surFerme.motifs));
  ok('AUCUN appel au modele : on ne paie pas pour conseiller un centre ferme',
    appelsSurFerme === 0, String(appelsSurFerme));

  // CONTRE-PREUVE : la MEME fiche sans le fait parle normalement. Sans elle,
  // on aurait seulement montre un conseiller qui refuse toujours.
  const surOuvert = await proposerDepuisLaFiche({ fiche, lieu: LIEU, fetchImpl: modeleQuiRepond(bonne) });
  ok('CONTRE-PREUVE : la meme fiche sans fermeture rend bien une proposition',
    Boolean(surOuvert.proposition) && !surOuvert.silence, JSON.stringify(surOuvert.motifs));

  // La fermeture passe AVANT la cause globale, comme la dormance : une cle
  // absente est la meme pour les trois centres, la fermeture parle de CELUI-ci.
  const clesRangees = {};
  ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY', 'OPENROUTER_API_KEY']
    .forEach((cle) => { clesRangees[cle] = process.env[cle]; delete process.env[cle]; });
  const sansCleEtFerme = await proposerDepuisLaFiche({ fiche: ficheFermee, lieu: LIEU, fetchImpl: modeleQuiRepond(bonne) });
  ok('sans cle ET ferme : c est la fermeture qui est nommee, pas la cle',
    sansCleEtFerme.silence === 'centre_ferme', String(sansCleEtFerme.silence));
  Object.entries(clesRangees).forEach(([cle, valeur]) => {
    if (valeur !== undefined) process.env[cle] = valeur;
  });
  console.log('\n[SOMMEIL] le conseiller se tait sur un centre qui ne vend plus');
  let appelsSurDormant = 0;
  const ficheDormante = {
    ...fiche,
    registre_dormant: {
      id: 'registre_dormant', libelle: 'le registre ne bouge plus',
      valeur: 'aucune reservation depuis 240 jours, alors que le plus long silence deja connu de ce centre est de 21 jours',
      n: 200, genre: 'denombrement', audience: 'interne', mois: [], du: '', au: '', source: 'silence observe',
    },
  };
  const surDormant = await proposerDepuisLaFiche({
    fiche: ficheDormante, lieu: LIEU,
    fetchImpl: async () => { appelsSurDormant += 1; return { ok: false, status: 500, text: async () => '' }; },
  });
  ok('le silence a sa propre cause', surDormant.silence === 'registre_dormant', String(surDormant.silence));
  ok('le motif porte le nombre de jours, pas une formule vague',
    surDormant.motifs.some((m) => m.includes('240 jours')), JSON.stringify(surDormant.motifs));
  ok('AUCUN appel au modele : on ne paie pas pour conseiller un centre arrete',
    appelsSurDormant === 0, String(appelsSurDormant));

  // CONTRE-PREUVE : la MEME fiche sans le fait de dormance parle normalement.
  // Sans elle, on aurait seulement montre un conseiller qui refuse toujours.
  const surVivant = await proposerDepuisLaFiche({ fiche, lieu: LIEU, fetchImpl: modeleQuiRepond(bonne) });
  ok('CONTRE-PREUVE : la meme fiche sans dormance rend bien une proposition',
    Boolean(surVivant.proposition) && !surVivant.silence, JSON.stringify(surVivant.motifs));

  // La dormance passe AVANT la cause globale (cle absente) : une cle manquante
  // est la meme pour les trois centres, la dormance parle de CELUI-ci.
  const clesSauvegardees = {};
  ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY', 'OPENROUTER_API_KEY']
    .forEach((cle) => { clesSauvegardees[cle] = process.env[cle]; delete process.env[cle]; });
  const sansCleEtDormant = await proposerDepuisLaFiche({ fiche: ficheDormante, lieu: LIEU, fetchImpl: modeleQuiRepond(bonne) });
  ok('sans cle ET endormi : c est la dormance qui est nommee, pas la cle',
    sansCleEtDormant.silence === 'registre_dormant', String(sansCleEtDormant.silence));
  Object.entries(clesSauvegardees).forEach(([cle, valeur]) => {
    if (valeur !== undefined) process.env[cle] = valeur;
  });
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'cle-de-mesure';

  // ── UN CLASSEMENT TROP SERRE NE S AFFIRME PAS ICI NON PLUS ────────────────
  // Le fait fragile n arrive meme pas dans les faits utiles (faitsUtiles filtre
  // sur peutAffirmer), mais rien n empeche le modele de nommer un mois de
  // lui-meme. Les deux portes portent la meme regle, c est tout l objet.
  console.log('\n[FRAGILITE] la porte Idees refuse le meme superlatif');
  const ficheAvecServe = {
    ...fiche,
    mois_fort: {
      id: 'mois_fort', libelle: 'mois de l annee le plus rentable',
      valeur: 'mars : 190 reservations (classement fragile : sans sa plus grosse reservation, le vainqueur change)',
      n: 190, du: '', au: '', mois: [], genre: 'estimation', periode: 'mois_annee',
      audience: 'public', source: 'chiffre par mois', fragile: true,
      motifFragilite: 'classement decide par une seule reservation',
    },
  };
  const proposeServe = await proposerDepuisLaFiche({
    fiche: ficheAvecServe, lieu: LIEU,
    fetchImpl: modeleQuiRepond({ titre: 'Mars', corps: 'Mars est ton meilleur mois : viens en profiter.', nature: 'constat', faitsUtilises: [idConstat] }),
  });
  ok('la proposition qui affirme un classement trop serre est jetee',
    proposeServe.proposition === null, JSON.stringify(proposeServe.motifs));
  ok('et le motif dit pourquoi',
    proposeServe.motifs.some((m) => m.includes('classement trop serre')), JSON.stringify(proposeServe.motifs));

  // CONTRE-PREUVE : le MEME texte sur la meme fiche, classement non fragile,
  // passe. Sans elle, on aurait montre un conseiller qui refuse ce texte-la,
  // pas une garde qui reagit a la fragilite.
  // Le jumeau en argent du montage porte la MEME etiquette et il est fragile
  // lui aussi : le rendre solide fait partie de la contre-preuve, sinon on
  // testerait « un des deux est solide », pas « le classement tient ».
  const ficheSolide = { ...ficheAvecServe };
  Object.keys(ficheSolide).forEach((cle) => {
    if (ficheSolide[cle] && ficheSolide[cle].fragile) {
      ficheSolide[cle] = { ...ficheSolide[cle], fragile: false, motifFragilite: '' };
    }
  });
  ok('MONTAGE : plus aucun fait fragile dans la fiche de contre-preuve',
    Object.values(ficheSolide).every((f) => !f || !f.fragile));
  const proposeSolide = await proposerDepuisLaFiche({
    fiche: ficheSolide, lieu: LIEU,
    fetchImpl: modeleQuiRepond({ titre: 'Mars', corps: 'Mars est ton meilleur mois : viens en profiter.', nature: 'constat', faitsUtilises: [idConstat] }),
  });
  ok('CONTRE-PREUVE : le meme texte passe quand le classement tient',
    !proposeSolide.motifs.some((m) => m.includes('classement trop serre')),
    JSON.stringify(proposeSolide.motifs));
  // ── REJETS ────────────────────────────────────────────────────────────────
  console.log('\n[REJETE] chaque garde jette ce qu elle doit jeter');

  const chiffreInvente = await proposerDepuisLaFiche({
    fiche, lieu: LIEU,
    fetchImpl: modeleQuiRepond({ ...bonne, corps: `${bonne.corps} Tu gagnerais 37 % de marge.` }),
  });
  ok('un pourcentage absent de la fiche fait jeter le texte',
    chiffreInvente.proposition === null
    && chiffreInvente.motifs.some((m) => m.includes('37')), JSON.stringify(chiffreInvente.motifs));

  const faitFantome = await proposerDepuisLaFiche({
    fiche, lieu: LIEU,
    fetchImpl: modeleQuiRepond({ ...bonne, faitsUtilises: ['fait_qui_n_existe_pas'] }),
  });
  ok('un identifiant de fait inconnu fait jeter le texte',
    faitFantome.proposition === null
    && faitFantome.motifs.some((m) => m.includes('fait_qui_n_existe_pas')), JSON.stringify(faitFantome.motifs));

  const sansSource = await proposerDepuisLaFiche({
    fiche, lieu: LIEU, fetchImpl: modeleQuiRepond({ ...bonne, faitsUtilises: [] }),
  });
  ok('une proposition sans aucun fait cite est jetee',
    sansSource.proposition === null
    && sansSource.motifs.some((m) => m.includes('aucun fait cite')), JSON.stringify(sansSource.motifs));

  const lieuInvente = await proposerDepuisLaFiche({
    fiche, lieu: LIEU,
    fetchImpl: modeleQuiRepond({ ...bonne, corps: `${bonne.corps} On en parle a Namur aussi.` }),
  });
  ok('un lieu qui n est pas le centre fait jeter le texte',
    lieuInvente.proposition === null
    && lieuInvente.motifs.some((m) => m.includes('Namur')), JSON.stringify(lieuInvente.motifs));

  const corpsVide = await proposerDepuisLaFiche({
    fiche, lieu: LIEU, fetchImpl: modeleQuiRepond({ ...bonne, corps: '   ' }),
  });
  ok('un corps vide est jete', corpsVide.proposition === null, JSON.stringify(corpsVide.motifs));

  // ── NATURE : le maillon faible decide ─────────────────────────────────────
  console.log('\n[NATURE] la nature revendiquee doit etre portee par CHAQUE fait cite');
  // Fiche d'un centre observe sur un seul ete : nourrie, mais sans hiver.
  const ficheEte = ficheDuRegistre({
    reservations: serie(60, {}, new Date('2026-06-01T00:00:00Z')).map((r, i) => ({
      ...r,
      // 60 reservations reparties sur juin, juillet et aout uniquement
      date: new Date(Date.UTC(2026, 5 + (i % 3), 1 + (i % 28))).toISOString().slice(0, 10),
    })),
    formules: [],
    aujourdhui: '2026-12-31',
  });
  // Le temoin doit etre PUBLIABLE et assez nourri pour porter un constat, en
  // plus de ne couvrir qu une partie de l annee. Un fait interne serait rejete
  // pour une autre raison, un fait trop mince aussi, et la contre-preuve ne
  // prouverait plus que c est la NATURE qui a bloque. On encode donc les trois.
  const idEte = Object.keys(ficheEte).find((id) => ficheEte[id].genre === 'estimation'
    && ficheEte[id].audience === 'public'
    && require('../lib/center-guards').peutAffirmer(ficheEte[id], 'constat').autorise
    && ficheEte[id].mois.length > 0 && ficheEte[id].mois.length < 12);
  ok('MONTAGE : cette fiche est nourrie mais ne couvre pas une annee',
    Boolean(idEte) && ficheEte[idEte].mois.length === 3, idEte ? String(ficheEte[idEte].mois) : 'aucun');
  ok('MONTAGE : ce fait porte quand meme un constat (sinon le refus viendrait du volume)',
    idEte && require('../lib/center-guards').peutAffirmer(ficheEte[idEte], 'constat').autorise);
  const saisonAbusive = await proposerDepuisLaFiche({
    fiche: ficheEte,
    lieu: LIEU,
    fetchImpl: modeleQuiRepond({
      titre: 'Ta saison', corps: 'Ton activite suit les saisons.',
      nature: 'saisonnier', faitsUtilises: [idEte],
    }),
  });
  ok('revendiquer « saisonnier » sans avoir vu l hiver est refuse',
    saisonAbusive.proposition === null
    && saisonAbusive.motifs.some((m) => m.includes('saisonnier')), JSON.stringify(saisonAbusive.motifs));
  const memeFaitEnConstat = await proposerDepuisLaFiche({
    fiche: ficheEte,
    lieu: LIEU,
    fetchImpl: modeleQuiRepond({
      titre: 'Ton ete', corps: 'Voila ce que dit ton registre.',
      nature: 'constat', faitsUtilises: [idEte],
    }),
  });
  ok('CONTRE-PREUVE : le MEME fait passe en « constat », donc c est bien la nature qui a bloque',
    Boolean(memeFaitEnConstat.proposition), JSON.stringify(memeFaitEnConstat.motifs));

  const natureInterdite = motifsDeRejet(
    { ...bonne, nature: 'regle_commerciale' }, fiche, LIEU,
  );
  ok('« regle_commerciale » n est pas une nature proposable',
    natureInterdite.some((m) => m.includes('non proposable')), JSON.stringify(natureInterdite));
  ok('elle est absente de la liste des natures proposables',
    !NATURES_PROPOSABLES.includes('regle_commerciale'));

  // ── UNE FICHE MUETTE NE SE COMMENTE PAS ───────────────────────────────────
  console.log('\n[SILENCE] une fiche qui ne porte rien ne declenche aucun appel');
  const ficheMaigre = ficheDuRegistre({ reservations: [resa()], formules: [] });
  let appels = 0;
  const compteur = async () => { appels += 1; throw new Error('le modele ne doit pas etre appele'); };
  const muette = await proposerDepuisLaFiche({ fiche: ficheMaigre, lieu: LIEU, fetchImpl: compteur });
  ok('aucune proposition n est produite', muette.proposition === null, JSON.stringify(muette.motifs));
  ok('et le modele n a PAS ete appele (pas de depense pour du vide)', appels === 0, String(appels));

  // ── CONTRE-PREUVES ────────────────────────────────────────────────────────
  console.log('\n[CONTRE-PREUVES] les gardes mordent, et n en font pas trop');
  const memeTexteFicheVide = motifsDeRejet(bonne, {}, LIEU);
  ok('fiche videe : la proposition ACCEPTEE devient refusee, donc les gardes mordaient',
    memeTexteFicheVide.length > 0, JSON.stringify(memeTexteFicheVide));
  const sansNombre = await proposerDepuisLaFiche({
    fiche, lieu: LIEU,
    fetchImpl: modeleQuiRepond({ ...bonne, corps: 'Ton registre est plus riche que ce que tu crois.' }),
  });
  ok('un texte sans aucun nombre passe la provenance (elle ne bloque pas tout)',
    Boolean(sansNombre.proposition), JSON.stringify(sansNombre.motifs));
  const villeDuCentre = await proposerDepuisLaFiche({
    fiche, lieu: LIEU,
    fetchImpl: modeleQuiRepond({ ...bonne, corps: `${bonne.corps} A Libramont, c est ce qui ressort.` }),
  });
  ok('citer la ville DU CENTRE est accepte (sinon le refus de Namur ne prouverait rien)',
    Boolean(villeDuCentre.proposition), JSON.stringify(villeDuCentre.motifs));

  // ── UN CENTRE N ECRIT PAS L ACTIVITE D UN AUTRE ───────────────────────────
  // La crainte exprimee par Movsar : « il va sortir des infos d un autre
  // centre ». Le garde-fou des nombres ne couvre PAS ce cas, « venez au Golf
  // o'Clock » ne contient aucun chiffre. C est la liste forbiddenClaims de
  // buildCenterFacts qui le rattrape, et elle est calculee depuis les activites
  // reelles du centre.
  console.log('\n[CENTRE] une activite que ce centre n a pas est refusee');
  const { buildCenterFacts } = require('../lib/marketing-agents');
  const LIBRAMONT = buildCenterFacts('libramont');
  const GEMBLOUX = buildCenterFacts('gembloux');
  const dit = (texte) => ({ titre: 'Ton centre', corps: texte, nature: 'constat', faitsUtilises: [idConstat] });

  ok('MONTAGE : Gembloux propose bien le Golf o Clock',
    (GEMBLOUX.activities || []).some((a) => /golf o.?clock/i.test(a)), JSON.stringify(GEMBLOUX.activities));
  ok('MONTAGE : Libramont ne le propose PAS',
    !(LIBRAMONT.activities || []).some((a) => /golf o.?clock/i.test(a)), JSON.stringify(LIBRAMONT.activities));
  ok('MONTAGE : et sa liste de mots interdits le contient',
    (LIBRAMONT.forbiddenClaims || []).some((c) => /golf o.?clock/i.test(c)),
    JSON.stringify((LIBRAMONT.forbiddenClaims || []).filter((c) => /golf o.?clock/i.test(c))));

  const texteGolf = 'Pense a mettre en avant ton Golf o Clock ce mois-ci.';
  const surLibramont = await proposerDepuisLaFiche({
    fiche, lieu: LIEU, centerFacts: LIBRAMONT, fetchImpl: modeleQuiRepond(dit(texteGolf)),
  });
  ok('le texte est REFUSE pour Libramont',
    surLibramont.proposition === null
    && surLibramont.motifs.some((m) => /golf|revendications/i.test(m)), JSON.stringify(surLibramont.motifs));

  const surGembloux = await proposerDepuisLaFiche({
    fiche,
    lieu: { nom: 'Fun Galaxy Gembloux', ville: 'Gembloux' },
    centerFacts: GEMBLOUX,
    fetchImpl: modeleQuiRepond(dit(texteGolf)),
  });
  ok('CONTRE-PREUVE : le MEME texte passe pour Gembloux, qui a bien cette activite',
    Boolean(surGembloux.proposition), JSON.stringify(surGembloux.motifs));

  // « Golf o Clock » est aussi un nom propre : DEUX gardes independantes le
  // rattrapent, ce qui est une bonne nouvelle mais empeche d isoler celle des
  // activites. On la prouve donc seule avec un mot INTERDIT QUI N EST PAS UN NOM
  // PROPRE : « cinema », commun et en minuscules, invisible pour la garde des
  // noms propres.
  const communInterdit = await proposerDepuisLaFiche({
    fiche, lieu: LIEU, centerFacts: LIBRAMONT,
    fetchImpl: modeleQuiRepond(dit('On peut aussi pousser le cinema du centre.')),
  });
  ok('un mot interdit COMMUN (cinema) est refuse quand l identite est fournie',
    communInterdit.proposition === null
    && communInterdit.motifs.some((m) => /cinema/i.test(m)), JSON.stringify(communInterdit.motifs));
  const memeTexteSansIdentite = await proposerDepuisLaFiche({
    fiche, lieu: LIEU,
    fetchImpl: modeleQuiRepond(dit('On peut aussi pousser le cinema du centre.')),
  });
  ok('CONTRE-PREUVE : le MEME texte passe sans identite, donc c est bien elle qui l arrete',
    Boolean(memeTexteSansIdentite.proposition), JSON.stringify(memeTexteSansIdentite.motifs));

  const accentue = await proposerDepuisLaFiche({
    fiche, lieu: LIEU, centerFacts: LIBRAMONT,
    fetchImpl: modeleQuiRepond(dit('Notre CINÉMA vous attend.')),
  });
  ok('la casse et les accents ne font pas passer le mot au travers',
    accentue.proposition === null && accentue.motifs.some((m) => /cinema/i.test(m)),
    JSON.stringify(accentue.motifs));
  // Le tiret doit rester EN DERNIER dans la classe de caracteres qui aplatit la
  // ponctuation. Place au milieu, il forme une plage avec ses voisins : [accent grave, tiret, tiret demi-cadratin]
  // couvre de U+0060 a U+2013, donc presque tout l alphabet, et TOUT devient
  // une revendication interdite. Bug introduit et attrape ici en une minute.
  const { revendicationsInterdites } = require('../lib/center-advisor');
  const listeTest = { forbiddenClaims: ['cinema', 'escape game'] };
  ok('un texte ordinaire ne declenche AUCUNE revendication interdite',
    revendicationsInterdites('Une soiree bowling entre amis, simple et efficace.', listeTest).length === 0,
    JSON.stringify(revendicationsInterdites('Une soiree bowling entre amis, simple et efficace.', listeTest)));
  ok('la garde reste selective : elle ne matche que ce qui est vraiment interdit',
    revendicationsInterdites('cinema', listeTest).length === 1
    && revendicationsInterdites('bowling', listeTest).length === 0);

  const ponctue = await proposerDepuisLaFiche({
    fiche, lieu: LIEU, centerFacts: LIBRAMONT,
    fetchImpl: modeleQuiRepond(dit('Le escape-game du centre marche bien.')),
  });
  ok('la ponctuation non plus : « escape-game » est attrape alors que la liste dit « escape game »',
    ponctue.proposition === null && ponctue.motifs.some((m) => /escape/i.test(m)),
    JSON.stringify(ponctue.motifs));

  // ── AUCUN GABARIT NE PEUT ATTEINDRE LA SORTIE ─────────────────────────────
  // C'est LA contrainte : plus une seule phrase preecrite. On inspecte le corps
  // reel de runDataIdeasCycle plutot que de faire confiance a un commentaire.
  console.log('\n[SANS GABARIT] le cycle ne publie plus de texte preecrit');
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'center-metrics.js'), 'utf8');
  const debut = source.indexOf('async function runDataIdeasCycle');
  ok('MONTAGE : runDataIdeasCycle est bien localisee', debut > 0, String(debut));
  const suivante = source.indexOf('\nfunction computeInsightMeasurement', debut);
  const corps = source.slice(debut, suivante > debut ? suivante : debut + 6000);
  ok('MONTAGE : le corps inspecte est substantiel', corps.length > 800, String(corps.length));
  ok('le cycle appelle bien proposerDepuisLaFiche', corps.includes('proposerDepuisLaFiche'), 'absent');
  ok('il construit la fiche complete du registre', corps.includes('chargerFicheDuRegistre'), 'absent');
  ok('le texte publie vient de la proposition, pas d un gabarit',
    corps.includes('readyContent: rendu.proposition.corps'), 'la source du texte publie a change');
  ok('candidate.readyContent (le gabarit) n est plus publie',
    !/readyContent:\s*(?:polished|candidate\.readyContent)/.test(corps)
    && !corps.includes('polishIdeaWithAi('), 'un gabarit peut encore sortir');
  // Le branchement de l identite doit exister EN PRODUCTION, pas seulement dans
  // ce gate : sans lui, la garde des revendications interdites ne recoit aucune
  // liste et laisse tout passer.
  ok('le cycle passe l identite COMPLETE du centre, pas seulement son nom',
    /centerFacts:\s*lieu/.test(corps), 'centerFacts absent du cycle de production');

  if (cleSauvee === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = cleSauvee;

  console.log(`\n${failures ? `center-advisor-check: ${failures} ECHEC(S)` : 'center-advisor-check: ALL OK'}`);
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('FAIL  gate interrompu :', (error && error.stack) || error);
  process.exit(1);
});
