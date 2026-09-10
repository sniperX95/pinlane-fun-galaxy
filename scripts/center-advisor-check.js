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

  // ET LE STATUT PASSE PAR LE MEME CHEMIN. La fonction pure qui pose le fait
  // est prouvee dans center-facts-check ; ici c est le CHARGEUR qui doit aller
  // chercher le statut en base et le lui transmettre. setCenterStatus ecrit
  // dans la colonne ET dans settings.config, donc les deux portent la valeur.
  const ligneCentreFerme = {
    ...ligneDuStaff, status: 'closed',
    settings: { config: { ...configDeLaBase, status: 'closed' } },
  };
  const poolCentreFerme = {
    query: async (sql) => (/from centers/.test(sql) ? { rows: [ligneCentreFerme] } : { rows: [] }),
  };
  const ficheStatutDeLaBase = await chargerVraiment({
    centerId: 'libramont', aujourdhui: '2026-09-10', pool: poolCentreFerme,
  });
  ok('LE POINT : le chargeur lit le statut de la BASE et le pose dans la fiche',
    Boolean(ficheStatutDeLaBase.statut_du_centre)
    && /closed/.test(String(ficheStatutDeLaBase.statut_du_centre.valeur)),
    String(ficheStatutDeLaBase.statut_du_centre && ficheStatutDeLaBase.statut_du_centre.valeur));
  applyCenterOverrides(new Map());
  ok('CONTRE-PREUVE : socle rendu, le centre redevient actif et le fait disparait',
    !(await chargerVraiment({
      centerId: 'libramont', aujourdhui: '2026-09-10',
      pool: { query: async () => ({ rows: [] }) },
    })).statut_du_centre);


  // ── ET LES BLOCAGES D ACTIVITE PASSENT PAR LE MEME CHEMIN ───────────────
  // La fonction pure est prouvee dans center-facts-check. Ici c est le
  // CHARGEUR qui doit lire availability_blocks, croiser avec l agenda et
  // traduire l identifiant en mots interdits. Sans cette assertion, couper la
  // lecture des blocs laisserait tous les gates verts.
  applyCenterOverrides(new Map());
  const blocsDuLaser = [];
  for (let i = 0; i < 14; i += 1) {
    blocsDuLaser.push({
      id: 900 + i, center_id: 'libramont', scope_type: 'activity', scope_ref: 'laser_game',
      recurrence: 'once',
      date: new Date(Date.parse('2026-09-10T00:00:00Z') + i * 86400000).toISOString().slice(0, 10),
      day_of_week: null, date_from: null, date_until: null,
      start_time: null, end_time: null, reason: 'remplacement des gilets', created_by: 'gerant',
    });
  }
  // Le registre doit porter de la MATIERE : sans estimation publiable, le
  // conseiller se tait avant d appeler le modele, et le test du prompt plus
  // bas ne testerait rien du tout.
  const poolAvecBlocage = {
    query: async (sql) => {
      const texte = String(sql);
      if (/from availability_blocks/i.test(texte)) return { rows: blocsDuLaser };
      if (/from reservations/i.test(texte)) return { rows: serie(120) };
      return { rows: [] };
    },
  };
  const ficheLaserBloque = await chargerVraiment({
    centerId: 'libramont', aujourdhui: '2026-09-10', pool: poolAvecBlocage,
  });
  ok('LE POINT : le chargeur lit les blocs en BASE et pose l activite bloquee',
    Boolean(ficheLaserBloque.activites_indisponibles)
    && /Laser Game/.test(String(ficheLaserBloque.activites_indisponibles.valeur)),
    String(ficheLaserBloque.activites_indisponibles
      && ficheLaserBloque.activites_indisponibles.valeur));
  ok('et il traduit l identifiant en mots que la garde sait chercher',
    ((ficheLaserBloque.activites_indisponibles || {}).motsInterdits || []).includes('laser game'),
    JSON.stringify((ficheLaserBloque.activites_indisponibles || {}).motsInterdits));
  ok('CONTRE-PREUVE : sans bloc en base, aucun fait',
    !(await chargerVraiment({
      centerId: 'libramont', aujourdhui: '2026-09-10',
      pool: {
        query: async (sql) => (/from reservations/i.test(String(sql))
          ? { rows: serie(120) } : { rows: [] }),
      },
    })).activites_indisponibles);

  // ── ET LES PRIX SUIVENT LE MEME BLOCAGE ────────────────────────────────
  // Le tunnel refuse une formule dont l arene est fermee toute la journee
  // (mesure du 2026-09-10 : « Le Laser Game est indisponible sur ce
  // creneau. »). La fonction pure sait s en taire ; c est le CHARGEUR qui
  // doit resoudre les ressources de chaque formule et les lui transmettre.
  // Sans cette assertion, retirer ce geste laisserait tous les gates verts,
  // et le centre deviendrait muet sur TOUS ses prix sans un seul rouge.
  //
  // Les noms ne sont pas recopies : ils sont derives du catalogue par la
  // fonction meme que le chargeur utilise.
  const { ressourcesDeLaFormule: ressourcesDuTunnel } = require('../lib/center-facts');
  const { getEffectiveFormules: catalogueDuCentre } = require('../lib/booking-config');
  const nomsAArene = catalogueDuCentre('libramont')
    .filter((formule) => {
      try { return ressourcesDuTunnel(formule).includes('laser_game'); } catch (error) { return true; }
    })
    .map((formule) => String(formule.name || formule.id));
  const prixAnnonces = ['prix_du_catalogue', 'prix_plancher']
    .map((id) => String((ficheLaserBloque[id] || {}).valeur || '')).join(' | ');
  ok('MONTAGE : le catalogue porte des formules a arene', nomsAArene.length > 0,
    JSON.stringify(nomsAArene));
  ok('LE POINT : le chargeur retire les formules dont l arene est fermee',
    !nomsAArene.some((nom) => prixAnnonces.includes(nom)),
    JSON.stringify(nomsAArene.filter((nom) => prixAnnonces.includes(nom))));
  ok('CONTRE-PREUVE : et il annonce quand meme les autres prix',
    Boolean(ficheLaserBloque.prix_du_catalogue)
    && ficheLaserBloque.prix_du_catalogue.audience === 'public',
    'le centre est devenu muet sur ses prix');

  // ── ET LA DEMANDE NON SERVIE PASSE PAR LE MEME CHEMIN ──────────────────
  // La fonction pure et les trois faits sont prouves dans center-facts-check.
  // Ici c est le CHARGEUR qui doit interroger custom_requests, scoper au
  // centre, et ne demander AUCUNE colonne personnelle. Sans cette assertion,
  // couper la requete laisserait tous les gates verts.
  const sqlDesDemandes = [];
  const demandesEnBase = [
    { date: '2026-08-01', pax: 24, occasion: 'entreprise', status: 'new' },
    { date: '2026-08-14', pax: 30, occasion: 'entreprise', status: 'handled' },
  ];
  const poolAvecDemandes = {
    query: async (sql, params) => {
      const texte = String(sql);
      if (/from custom_requests/i.test(texte)) {
        sqlDesDemandes.push({ texte, params });
        return { rows: demandesEnBase };
      }
      if (/from reservations/i.test(texte)) return { rows: serie(120) };
      return { rows: [] };
    },
  };
  const ficheAvecDemandes = await chargerVraiment({
    centerId: 'libramont', aujourdhui: '2026-09-10', pool: poolAvecDemandes,
  });
  ok('MONTAGE : le chargeur a bien interroge custom_requests',
    sqlDesDemandes.length === 1, `${sqlDesDemandes.length} requete(s)`);
  ok('LE POINT : la demande lue en base devient un fait de la fiche',
    Boolean(ficheAvecDemandes.demandes_sur_mesure)
    && ficheAvecDemandes.demandes_sur_mesure.n === 2,
    String(ficheAvecDemandes.demandes_sur_mesure
      && ficheAvecDemandes.demandes_sur_mesure.valeur));
  ok('et l occasion demandee que le registre ne porte pas est nommee',
    Boolean(ficheAvecDemandes.demande_jamais_vendue)
    && /entreprise/.test(String(ficheAvecDemandes.demande_jamais_vendue.valeur)),
    String(ficheAvecDemandes.demande_jamais_vendue
      && ficheAvecDemandes.demande_jamais_vendue.valeur));

  // LA REQUETE ELLE-MEME. Prouver qu une colonne n est PAS demandee ne peut se
  // faire qu en lisant le SQL : une fausse base qui ne la renvoie pas ne
  // prouverait que sa propre discretion.
  const sqlDemande = sqlDesDemandes.length ? sqlDesDemandes[0].texte : '';
  ok('la requete est scopee au centre',
    /center_id\s*=\s*\$1/.test(sqlDemande)
    && (sqlDesDemandes[0] || { params: [] }).params[0] === 'libramont',
    sqlDemande.slice(0, 120));
  // LA LISTE DU SELECT, pas le SQL entier : `email` figure legitimement dans
  // le WHERE, pour ecarter la demonstration. Chercher le mot partout ferait
  // passer ce test pour vert sur une requete qui selectionnerait tout.
  const listeSelect = (sqlDemande.match(/select([\s\S]*?)\bfrom\b/i) || [''])[0];
  ok('MONTAGE : la liste du select a bien ete isolee',
    /\boccasion\b/i.test(listeSelect) && !/custom_requests/i.test(listeSelect),
    listeSelect.slice(0, 160));
  const colonnesInterdites = ['contact_name', 'company', 'phone', 'message', 'email']
    .filter((colonne) => new RegExp(`\\b${colonne}\\b`, 'i').test(listeSelect));
  ok('LE POINT : la requete ne SELECTIONNE aucune colonne personnelle',
    colonnesInterdites.length === 0, JSON.stringify(colonnesInterdites));
  ok('et l email ne sert que dans le WHERE, pour ecarter la demonstration',
    /email/i.test(sqlDemande), sqlDemande.slice(0, 200));

  ok('CONTRE-PREUVE : sans demande en base, aucun fait de demande',
    !(await chargerVraiment({
      centerId: 'libramont', aujourdhui: '2026-09-10',
      pool: {
        query: async (sql) => (/from reservations/i.test(String(sql))
          ? { rows: serie(120) } : { rows: [] }),
      },
    })).demandes_sur_mesure);

  const { joursSansPisteDisponible } = require('../lib/database');
  
  // LA LECTURE D ABORD : une maintenance DATEE ne vaut que dans sa fenetre, et
  // une piste sans ligne est active. Ce sont les regles du tunnel, pas des
  // nouvelles : joursSansPisteDisponible les reprend de resolveLaneStatusForDate.
  const baseDesPistes = (rows) => ({ query: async () => ({ rows }) });
  const huitPistes = (statut, from = null, until = null) => Array.from({ length: 8 }, (inutilise, i) => ({
    lane_number: i + 1, status: statut, maintenance_from: from, maintenance_until: until,
    maintenance_note: '',
  }));
  const JOURS_DES_PISTES = ['2026-09-10', '2026-09-11', '2026-09-12'];
  ok('MONTAGE : sans aucune ligne, toutes les pistes sont actives',
    (await joursSansPisteDisponible(baseDesPistes([]), 'libramont', JOURS_DES_PISTES)).size === 0,
    'une piste sans ligne a ete comptee en panne');
  ok('LE POINT : les huit pistes en maintenance ferment le jour',
    (await joursSansPisteDisponible(baseDesPistes(huitPistes('maintenance')), 'libramont', JOURS_DES_PISTES)).size === 3,
    String((await joursSansPisteDisponible(baseDesPistes(huitPistes('maintenance')), 'libramont', JOURS_DES_PISTES)).size));
  ok('CONTRE-PREUVE : SEPT pistes sur huit ne ferment rien',
    (await joursSansPisteDisponible(
      baseDesPistes(huitPistes('maintenance').slice(0, 7)), 'libramont', JOURS_DES_PISTES)).size === 0,
    'un parc partiellement en panne a ete pris pour un parc a l arret');
  ok('LE POINT : une maintenance DATEE ne vaut que dans sa fenetre',
    (await joursSansPisteDisponible(
      baseDesPistes(huitPistes('maintenance', '2026-09-11', '2026-09-11')), 'libramont', JOURS_DES_PISTES)).size === 1,
    JSON.stringify([...(await joursSansPisteDisponible(
      baseDesPistes(huitPistes('maintenance', '2026-09-11', '2026-09-11')), 'libramont', JOURS_DES_PISTES))]));
  

  // ── ET LE PARC DE PISTES PASSE PAR LE MEME CHEMIN ──────────────────────
  // La fonction pure est prouvee dans center-facts-check. Ici c est le
  // CHARGEUR qui doit lire lane_statuses et transmettre les jours concernes :
  // sans cette assertion, couper la lecture laisserait tous les gates verts.
  const sqlDesPistes = [];
  const parcArrete = Array.from({ length: 8 }, (inutilise, i) => ({
    lane_number: i + 1, status: 'maintenance', maintenance_from: null,
    maintenance_until: null, maintenance_note: 'renovation',
  }));
  const poolParcArrete = {
    query: async (sql) => {
      const texte = String(sql);
      if (/from lane_statuses/i.test(texte)) { sqlDesPistes.push(texte); return { rows: parcArrete }; }
      if (/from reservations/i.test(texte)) return { rows: serie(120) };
      return { rows: [] };
    },
  };
  const ficheParcArrete = await chargerVraiment({
    centerId: 'libramont', aujourdhui: '2026-09-10', pool: poolParcArrete,
  });
  ok('MONTAGE : le chargeur a bien interroge lane_statuses',
    sqlDesPistes.length >= 1, `${sqlDesPistes.length} requete(s)`);
  ok('LE POINT : parc a l arret, le chargeur pose le trou et le nomme',
    Boolean(ficheParcArrete.pistes_toutes_en_maintenance),
    String(ficheParcArrete.pistes_toutes_en_maintenance
      && ficheParcArrete.pistes_toutes_en_maintenance.valeur));
  const nomsAPiste = catalogueDuCentre('libramont')
    .filter((formule) => {
      try { return ressourcesDuTunnel(formule).includes('bowling'); } catch (error) { return true; }
    })
    .map((formule) => String(formule.name || formule.id));
  const prixDuParcArrete = ['prix_du_catalogue', 'prix_plancher']
    .map((id) => String((ficheParcArrete[id] || {}).valeur || '')).join(' | ');
  ok('MONTAGE : le catalogue porte des formules a piste', nomsAPiste.length > 0,
    JSON.stringify(nomsAPiste));
  ok('LE POINT : et il retire les formules qui consomment une piste',
    !nomsAPiste.some((nom) => prixDuParcArrete.includes(nom)),
    JSON.stringify(nomsAPiste.filter((nom) => prixDuParcArrete.includes(nom))));
  ok('CONTRE-PREUVE : parc normal, aucun trou et les formules reviennent',
    !(await chargerVraiment({
      centerId: 'libramont', aujourdhui: '2026-09-10',
      pool: {
        query: async (sql) => (/from reservations/i.test(String(sql))
          ? { rows: serie(120) } : { rows: [] }),
      },
    })).pistes_toutes_en_maintenance);

  // LA GARDE. Le centre A un laser game : le motif doit dire BLOQUE, jamais
  // « absent de ce centre ». Un gerant qui lit le mauvais motif va corriger
  // une configuration qui est juste.
  const identiteLibramont = require('../lib/marketing-agents').buildCenterFacts('libramont');
  const venteDuLaser = {
    titre: 'Une soiree laser game',
    corps: 'Reunis ta bande pour une partie de laser game cette semaine.',
    nature: 'constat', faitsUtilises: [],
  };
  const motifsBloque = motifsDeRejet(venteDuLaser, ficheLaserBloque, LIEU, identiteLibramont);
  ok('LE POINT : vendre une activite bloquee est refuse',
    motifsBloque.some((m) => /activites bloquees sur toute la fenetre/.test(m)),
    JSON.stringify(motifsBloque));
  ok('et le motif ne pretend PAS que le centre n a pas de laser game',
    !motifsBloque.some((m) => /revendications absentes/.test(m)),
    JSON.stringify(motifsBloque));
  ok('CONTRE-PREUVE : sans blocage, le meme texte ne declenche pas ce motif',
    !motifsDeRejet(venteDuLaser, {}, LIEU, identiteLibramont)
      .some((m) => /activites bloquees/.test(m)),
    JSON.stringify(motifsDeRejet(venteDuLaser, {}, LIEU, identiteLibramont)));
  ok('et ce que le centre n a PAS garde son propre motif',
    motifsDeRejet({ ...venteDuLaser, corps: 'Notre cinema ouvre.' }, {}, LIEU, identiteLibramont)
      .some((m) => /revendications absentes/.test(m)),
    'le motif permanent a disparu');

  // LE PROMPT VOIT LA MEME REGLE QUE LA GARDE. C est le point qu aucune
  // lecture ne rattrape : un modele honnete juge sur ce qu on lui donne.
  const promptsVus = [];
  await proposerDepuisLaFiche({
    fiche: ficheLaserBloque, lieu: LIEU, centerFacts: identiteLibramont,
    fetchImpl: async (url, options) => {
      promptsVus.push(String((options && options.body) || ''));
      return {
        ok: true,
        json: async () => ({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify({ titre: 'X', corps: 'Y', nature: 'constat', faitsUtilises: [] }) }],
        }),
      };
    },
  });
  const charge = promptsVus[0] ? JSON.parse(JSON.parse(promptsVus[0]).messages[0].content) : null;
  ok('MONTAGE : le prompt a bien ete construit',
    Boolean(charge && charge.centre), promptsVus[0] ? promptsVus[0].slice(0, 120) : 'aucun appel');
  ok('LE POINT : le modele recoit l interdiction dans aNePasEcrire',
    (charge.centre.aNePasEcrire || []).includes('laser game'),
    JSON.stringify(charge.centre.aNePasEcrire));
  ok('et l activite bloquee SORT de la liste positive',
    !(charge.centre.activites || []).some((n) => /laser/i.test(String(n))),
    JSON.stringify(charge.centre.activites));
  ok('CONTRE-PREUVE : les autres activites du centre restent proposees',
    (charge.centre.activites || []).some((n) => /bowling/i.test(String(n))),
    JSON.stringify(charge.centre.activites));

  // ── LE BLOC SYSTEME NE DECRIT PLUS UN SEUL CENTRE ──────────────────────
  // Les gardes de sortie refusent une revendication fausse ; elles ne voient
  // pas l AMORCE. Trois activites nommees en dur dans la premiere ligne du
  // prompt orientaient le modele sans jamais declencher un refus.
  const enveloppe = promptsVus[0] ? JSON.parse(promptsVus[0]) : null;
  const blocSysteme = enveloppe && Array.isArray(enveloppe.system)
    ? enveloppe.system.map((bloc) => String((bloc && bloc.text) || '')).join('\n')
    : String((enveloppe && enveloppe.system) || '');
  ok('MONTAGE : le bloc systeme a bien ete capture',
    blocSysteme.length > 200 && /REGLES DURES/.test(blocSysteme),
    `${blocSysteme.length} caracteres`);

  // Les noms viennent du CENTRE COURANT, pas d une liste recopiee ici : un
  // gate qui ecrirait « bowling, laser game, arcades » deviendrait faux le
  // jour ou la configuration change.
  const systemeEnMinuscules = blocSysteme.toLowerCase();
  const activitesDuCentre = [
    ...(charge.centre.activites || []),
    ...(charge.centre.aNePasEcrire || []),
  ].map((nom) => String(nom).toLowerCase()).filter((nom) => nom.length > 3);
  ok('MONTAGE : le centre declare bien des activites a chercher',
    activitesDuCentre.length >= 3, JSON.stringify(activitesDuCentre));
  const nommeesEnDur = activitesDuCentre.filter((nom) => systemeEnMinuscules.includes(nom));
  ok('LE POINT : le bloc systeme ne nomme AUCUNE activite',
    nommeesEnDur.length === 0, JSON.stringify(nommeesEnDur));

  // ET IL DIT CE QUE LA FICHE PORTE VRAIMENT. « calculee sur son registre de
  // reservations » etait devenu faux : l offre y entre, et ses faits sont vrais
  // sans une seule vente. C est l etat de ce centre depuis la remise a zero de
  // sa base, donc la phrase decide de ce qu il peut encore dire.
  ok('LE POINT : le bloc systeme annonce l OFFRE a cote du registre',
    /OFFRE/.test(blocSysteme) && /REGISTRE/.test(blocSysteme),
    blocSysteme.slice(0, 200));
  ok('et il dit que les faits d offre valent SANS aucune vente',
    /sans aucune vente/i.test(blocSysteme), blocSysteme.slice(0, 300));
  ok('et que l etat du moment est DEJA applique a ce qu il recoit',
    /deja applique/i.test(blocSysteme)
    && /centre\.activites/.test(blocSysteme) && /aNePasEcrire/.test(blocSysteme),
    blocSysteme.slice(0, 400));

  ok('CONTRE-PREUVE : les activites du centre sont bien passees, dans la CHARGE',
    (charge.centre.activites || []).length >= 3,
    JSON.stringify(charge.centre.activites));

  // ── LA VOIX DE LA MAISON ARRIVE, ET ELLE OBEIT ─────────────────────────
  // voice.md est titre « ton des contenus Fun Galaxy (agent marketing) » et
  // seule la porte EMAIL le lisait : sa destinataire ne l avait jamais vu.
  const cheminDeLaVoix = require('path').join(__dirname, '..', 'ops-knowledge', 'marketing-brain', 'voice.md');
  const voixDuFichier = require('fs').readFileSync(cheminDeLaVoix, 'utf8').replace(/\r\n/g, '\n');
  // Une phrase PRISE DANS LE FICHIER, pas recopiee ici : un gate qui recopie
  // une doctrine ment le jour ou la doctrine change.
  const phraseDeLaVoix = voixDuFichier.split('\n')
    .map((ligne) => ligne.replace(/^[-*>#\s]+/, '').trim())
    .filter((ligne) => ligne.length > 40 && !/^Voice|^Public/.test(ligne))[0];
  ok('MONTAGE : une phrase de la voix a bien ete prelevee du fichier',
    Boolean(phraseDeLaVoix), String(phraseDeLaVoix));

  ok('LE POINT : la porte Idees recoit la voix de la maison',
    blocSysteme.includes(phraseDeLaVoix), blocSysteme.slice(-300));

  // UNE ENTREPRISE, UN TON. Les deux portes lisent le MEME fichier : sans
  // cette assertion, chacune pourrait deriver vers sa propre voix.
  const { buildEmailBrain: cerveauDuMail } = require('../lib/email-agent');
  const cerveauVoix = await cerveauDuMail('libramont', { query: async () => ({ rows: [] }) });
  ok('LE POINT : la porte EMAIL lit exactement la meme phrase',
    cerveauVoix.stable.includes(phraseDeLaVoix),
    'les deux portes de la meme entreprise ecrivent avec deux voix');

  // LA HIERARCHIE. La voix arrive APRES les regles dures, sous l en-tete qui
  // les fait gagner, et la regle dure survit a un fichier qui la contredit
  // (« Emojis : 1-3 max » contre « sans emoji »).
  ok('la voix arrive APRES les regles dures',
    blocSysteme.indexOf('REGLES DURES') < blocSysteme.indexOf(phraseDeLaVoix),
    `regles a ${blocSysteme.indexOf('REGLES DURES')}, voix a ${blocSysteme.indexOf(phraseDeLaVoix)}`);
  ok('et sous l en-tete qui dit que les regles dures gagnent',
    /les regles dures gagnent/.test(blocSysteme)
    && blocSysteme.indexOf('les regles dures gagnent') < blocSysteme.indexOf(phraseDeLaVoix),
    'la voix arrive sans son arbitrage');
  ok('LE POINT : la regle dure sans emoji survit a une voix qui en autorise',
    /sans emoji/.test(blocSysteme) && /moji/.test(voixDuFichier),
    'le montage de la contradiction ne tient plus, ou la regle dure a disparu');

  // ET LA VOIX NE DECRIT AUCUN CENTRE. L assertion « le bloc systeme ne nomme
  // AUCUNE activite » ci-dessus couvre deja le bloc entier ; celle-ci vise le
  // FICHIER, pour que la faute soit nommee la ou elle se corrige.
  const nommesParLaVoix = ['libramont', 'gembloux', 'ciney', 'ardenne', 'luxembourg', 'bowling', 'laser']
    .filter((mot) => voixDuFichier.toLowerCase().includes(mot));
  ok('LE POINT : le fichier de voix ne nomme ni ville, ni region, ni activite',
    nommesParLaVoix.length === 0, JSON.stringify(nommesParLaVoix));

  // ── ET LES PRIX PASSENT PAR LE MEME CHEMIN ──────────────────────────────
  // La fonction pure est prouvee dans center-facts-check. Ici, c est le
  // CHARGEUR qui doit croiser le catalogue du tunnel avec l agenda du centre.
  applyCenterOverrides(new Map());
  const ficheAvecPrix = await chargerVraiment({
    centerId: 'libramont', aujourdhui: '2026-09-10',
    pool: {
      query: async (sql) => (/from reservations/i.test(String(sql))
        ? { rows: serie(120) } : { rows: [] }),
    },
  });
  ok('LE POINT : le chargeur pose le prix plancher du catalogue reel',
    Boolean(ficheAvecPrix.prix_plancher)
    && /EUR par personne/.test(String(ficheAvecPrix.prix_plancher.valeur)),
    String(ficheAvecPrix.prix_plancher && ficheAvecPrix.prix_plancher.valeur));
  ok('et la liste complete porte autant de lignes que le catalogue en vend',
    Number(ficheAvecPrix.prix_du_catalogue.n) > 0
    && Number(ficheAvecPrix.prix_du_catalogue.n) <= Number(ficheAvecPrix.catalogue_actif.valeur),
    `${ficheAvecPrix.prix_du_catalogue.n} prix pour ${ficheAvecPrix.catalogue_actif.valeur} formules`);
  // Le prix doit pouvoir etre ECRIT : la garde des nombres inventes le lit
  // dans la fiche, sinon le modele citerait un prix vrai et le texte serait
  // jete pour nombre intrus.
  const provenanceDuPrix = require('../lib/center-guards')
    .verifierProvenance(String(ficheAvecPrix.prix_plancher.valeur), ficheAvecPrix);
  ok('le prix plancher est un nombre AUTORISE dans un texte',
    provenanceDuPrix.propre, JSON.stringify(provenanceDuPrix.intrus));
  // CONTRE-PREUVE : un centre qui n ouvre aucun jour n a aucun prix a annoncer.
  ok('CONTRE-PREUVE : sans agenda, aucun prix',
    !(await chargerVraiment({
      centerId: 'libramont', aujourdhui: '',
      pool: { query: async (sql) => (/from reservations/i.test(String(sql)) ? { rows: serie(120) } : { rows: [] }) },
    })).prix_du_catalogue);
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

  // ── UN CENTRE QUI N EST PAS DECLARE ACTIF NE CONSEILLE RIEN ───────────────
  // Trois statuts existent : active, planned, closed. Le conseiller n en lisait
  // aucun. Un centre « planned » n ouvre pas encore, un centre « closed » a
  // ferme : dans les deux cas la declaration est immediate, la ou la dormance
  // attend son propre delai de silence.
  console.log('\n[STATUT] le conseiller se tait sur un centre qui n est pas actif');
  let appelsSurPlanned = 0;
  const fichePasActive = {
    ...fiche,
    statut_du_centre: {
      id: 'statut_du_centre', libelle: 'ce centre n est pas declare actif',
      valeur: 'centre declare « planned » : il n ouvre pas encore',
      n: 1, genre: 'denombrement', audience: 'interne', mois: [], du: '', au: '',
      source: 'champ status de la configuration du centre',
    },
  };
  const surPlanned = await proposerDepuisLaFiche({
    fiche: fichePasActive, lieu: LIEU,
    fetchImpl: async () => { appelsSurPlanned += 1; return { ok: false, status: 500, text: async () => '' }; },
  });
  ok('le silence a sa propre cause', surPlanned.silence === 'statut_du_centre', String(surPlanned.silence));
  ok('le motif recopie la declaration', surPlanned.motifs.some((m) => m.includes('planned')),
    JSON.stringify(surPlanned.motifs));
  ok('AUCUN appel au modele', appelsSurPlanned === 0, String(appelsSurPlanned));

  // LE RANG COMPTE. Un centre pas encore ouvert dont le registre dort aussi doit
  // nommer le STATUT : la dormance est une deduction tiree du registre, le
  // statut est une declaration du gerant.
  const pasActiveEtDormante = {
    ...fichePasActive,
    registre_dormant: {
      id: 'registre_dormant', libelle: 'le registre ne bouge plus',
      valeur: 'aucune reservation depuis 240 jours', n: 200, genre: 'denombrement',
      audience: 'interne', mois: [], du: '', au: '', source: 'silence observe',
    },
    centre_ferme: {
      id: 'centre_ferme', libelle: 'le centre n ouvre aucun jour dans la fenetre',
      valeur: 'aucun jour ouvert sur les 14 prochains jours', n: 14, genre: 'denombrement',
      audience: 'interne', mois: [], du: '', au: '', source: 'grille et fermetures',
    },
  };
  const surLesTrois = await proposerDepuisLaFiche({
    fiche: pasActiveEtDormante, lieu: LIEU, fetchImpl: modeleQuiRepond(bonne),
  });
  ok('statut, dormance et fermeture ensemble : c est le STATUT qui est nomme',
    surLesTrois.silence === 'statut_du_centre', String(surLesTrois.silence));

  // CONTRE-PREUVE : la MEME fiche sans le fait de statut parle normalement.
  const surActive = await proposerDepuisLaFiche({ fiche, lieu: LIEU, fetchImpl: modeleQuiRepond(bonne) });
  ok('CONTRE-PREUVE : la meme fiche sans statut rend bien une proposition',
    Boolean(surActive.proposition) && !surActive.silence, JSON.stringify(surActive.motifs));
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

  // ── LES FORMULES DE CE CENTRE, PAS LE CATALOGUE COMMUN ────────────────────
  // La table `formulas` n a pas de center_id : c est le catalogue commun. La
  // couche PAR CENTRE vit dans `formule_overrides`, et la fiche ne l appliquait
  // pas. Une formule desactivee pour un centre ressortait donc « active sans une
  // seule vente », et son min_pax entrait dans la comparaison des minimums, le
  // fait meme qui sert a discuter un changement de regle commerciale.
  console.log('\n[FORMULES] la fiche voit exactement ce que le tunnel vend');
  const { chargerFicheDuRegistre: chargerAvecFormules } = require('../lib/center-facts');
  const { getEffectiveFormules, setFormuleOverrides } = require('../lib/booking-config');

  // Trois lignes en base. Le tunnel, lui, empile le socle FICHIER sous la
  // table : il en vend beaucoup plus. C est tout le defaut du patch 39.
  const catalogueCommun = [
    { id: 'f1', name: 'Anniversaire enfant', min_pax: 6, price_type: 'per_pax', price_value: 22, is_birthday_formula: true, active: true },
    { id: 'f2', name: 'Anniversaire ado', min_pax: 2, price_type: 'per_pax', price_value: 25, is_birthday_formula: true, active: true },
    { id: 'f3', name: 'Teambuilding', min_pax: 10, price_type: 'per_pax', price_value: 35, is_birthday_formula: false, active: true },
  ];
  const ventes = Array.from({ length: 30 }, (unused, i) => ({
    date: `2026-08-0${1 + (i % 9)}`, start_time: '18:00', status: 'paid', pax: 6, price: 132,
    formule_id: 'f1', email: `formule${i}@example.test`, created_at: '2026-07-20T10:00:00Z',
  }));
  const poolCatalogue = (surcouches) => ({
    query: async (sql) => {
      if (/from formule_overrides/.test(sql)) return { rows: surcouches };
      if (/from reservations/.test(sql)) return { rows: ventes };
      if (/from formulas/.test(sql)) return { rows: catalogueCommun };
      return { rows: [] };
    },
  });
  // Ce que le TUNNEL vendrait dans l etat que la fiche vient de charger. On le
  // lit APRES chaque chargement, dans le meme processus : c est exactement
  // l etat que la fiche a utilise.
  const vendables = (centerId) => getEffectiveFormules(centerId).length;

  const sansSurcouche = await chargerAvecFormules({ centerId: 'gembloux', aujourdhui: '2026-09-10', pool: poolCatalogue([]) });
  // MONTAGE, et c est LE montage : sans lui, tout ce qui suit pourrait passer
  // sur un tunnel qui vendrait lui aussi trois formules.
  ok('MONTAGE : le tunnel vend PLUS que ce que la table porte',
    vendables('gembloux') > catalogueCommun.length,
    `${vendables('gembloux')} vendables contre ${catalogueCommun.length} lignes en base`);
  ok('LE POINT : la fiche voit exactement ce que le tunnel vend',
    Number(sansSurcouche.catalogue_actif.valeur) === vendables('gembloux'),
    `fiche ${sansSurcouche.catalogue_actif.valeur} contre tunnel ${vendables('gembloux')}`);
  // Et les lignes de la TABLE sont bien dans le compte : sans ca, la fiche
  // pourrait ne lire que le fichier et l egalite tiendrait quand meme.
  ok('les lignes de la table sont dans le catalogue lu',
    /Anniversaire ado/.test(String(sansSurcouche.minimums_du_catalogue.valeur)),
    String(sansSurcouche.minimums_du_catalogue.valeur).slice(0, 120));
  ok('MONTAGE : le minimum 2 de la table entre dans la comparaison',
    /\b2\b/.test(String(sansSurcouche.comparaison_de_minimums.valeur)),
    String(sansSurcouche.comparaison_de_minimums.valeur));
  const referenceSansSurcouche = Number(sansSurcouche.catalogue_actif.valeur);

  // La formule « Anniversaire ado » est DESACTIVEE pour ce centre.
  const avecSurcouche = await chargerAvecFormules({
    centerId: 'gembloux', aujourdhui: '2026-09-10',
    pool: poolCatalogue([{
      formule_id: 'f2', center_id: 'gembloux', name: null, price_value: null,
      price_old: null, enabled: false, removed: false, sort_index: null,
    }]),
  });
  ok('LE POINT : une formule desactivee sort du catalogue de ce centre',
    Number(avecSurcouche.catalogue_actif.valeur) === referenceSansSurcouche - 1,
    `${avecSurcouche.catalogue_actif.valeur} contre ${referenceSansSurcouche} sans surcouche`);
  ok('et le tunnel dit la meme chose',
    Number(avecSurcouche.catalogue_actif.valeur) === vendables('gembloux'),
    `fiche ${avecSurcouche.catalogue_actif.valeur} contre tunnel ${vendables('gembloux')}`);
  ok('elle n est plus conseillee comme « active sans une seule vente »',
    !/Anniversaire ado/.test(String(avecSurcouche.formules_jamais_vendues.valeur)),
    String(avecSurcouche.formules_jamais_vendues.valeur).slice(0, 120));
  ok('et son minimum sort de la comparaison qui fonde un changement de regle',
    !/\b2\b/.test(String(avecSurcouche.comparaison_de_minimums.valeur)),
    String(avecSurcouche.comparaison_de_minimums.valeur));
  ok('la liste des minimums ne la porte plus non plus',
    !/Anniversaire ado/.test(String(avecSurcouche.minimums_du_catalogue.valeur)),
    String(avecSurcouche.minimums_du_catalogue.valeur).slice(0, 120));

  // UNE FORMULE RETIREE sort aussi, par un autre champ.
  const avecRetrait = await chargerAvecFormules({
    centerId: 'gembloux', aujourdhui: '2026-09-10',
    pool: poolCatalogue([{
      formule_id: 'f3', center_id: 'gembloux', name: null, price_value: null,
      price_old: null, enabled: null, removed: true, sort_index: null,
    }]),
  });
  ok('une formule RETIREE sort aussi du catalogue',
    Number(avecRetrait.catalogue_actif.valeur) === referenceSansSurcouche - 1,
    `${avecRetrait.catalogue_actif.valeur} contre ${referenceSansSurcouche}`);
  ok('et le tunnel ne la vend plus non plus',
    Number(avecRetrait.catalogue_actif.valeur) === vendables('gembloux'),
    `fiche ${avecRetrait.catalogue_actif.valeur} contre tunnel ${vendables('gembloux')}`);

  // LA PRECEDENCE : une ligne « all » desactive partout, une ligne du CENTRE la
  // reactive pour lui. On importe cette regle, on ne la recopie pas.
  const avecPrecedence = await chargerAvecFormules({
    centerId: 'gembloux', aujourdhui: '2026-09-10',
    pool: poolCatalogue([
      { formule_id: 'f2', center_id: 'all', name: null, price_value: null, price_old: null, enabled: false, removed: false, sort_index: null },
      { formule_id: 'f2', center_id: 'gembloux', name: null, price_value: null, price_old: null, enabled: true, removed: false, sort_index: null },
    ]),
  });
  ok('le centre PRIME sur la ligne « all »',
    Number(avecPrecedence.catalogue_actif.valeur) === referenceSansSurcouche,
    `${avecPrecedence.catalogue_actif.valeur} contre ${referenceSansSurcouche}`);

  // CLOISONNEMENT : la surcouche d un centre ne touche pas l autre.
  const surcoucheGembloux = [{
    formule_id: 'f2', center_id: 'gembloux', name: null, price_value: null,
    price_old: null, enabled: false, removed: false, sort_index: null,
  }];
  const chezLibramont = await chargerAvecFormules({
    centerId: 'libramont', aujourdhui: '2026-09-10', pool: poolCatalogue(surcoucheGembloux),
  });
  ok('CLOISONNEMENT : une surcouche de Gembloux ne retire rien a Libramont',
    Number(chezLibramont.catalogue_actif.valeur) === vendables('libramont'),
    `fiche ${chezLibramont.catalogue_actif.valeur} contre tunnel ${vendables('libramont')}`);
  ok('et Libramont garde bien la formule desactivee chez Gembloux',
    /Anniversaire ado/.test(String(chezLibramont.minimums_du_catalogue.valeur)),
    String(chezLibramont.minimums_du_catalogue.valeur).slice(0, 120));

  // CONTRE-PREUVE : sans aucune surcouche, la formule est bien la. Sans elle,
  // on aurait montre un filtre qui coupe, pas un filtre qui lit.
  ok('CONTRE-PREUVE : aucune surcouche, la formule reste au catalogue',
    /Anniversaire ado/.test(String(sansSurcouche.formules_jamais_vendues.valeur)),
    String(sansSurcouche.formules_jamais_vendues.valeur).slice(0, 120));

  // FAIL-SOFT : si la table des surcouches est absente, on garde le catalogue
  // commun plutot que de rendre une fiche vide. La carte est remise a zero
  // AVANT : sans ca, on testerait le dernier etat charge par le scenario
  // precedent, et le gate mesurerait sa propre memoire.
  setFormuleOverrides(new Map());
  const poolSansTable = {
    query: async (sql) => {
      if (/from formule_overrides/.test(sql)) throw new Error('relation formule_overrides does not exist');
      if (/from reservations/.test(sql)) return { rows: ventes };
      if (/from formulas/.test(sql)) return { rows: catalogueCommun };
      return { rows: [] };
    },
  };
  const sansTable = await chargerAvecFormules({ centerId: 'gembloux', aujourdhui: '2026-09-10', pool: poolSansTable });
  ok('FAIL-SOFT : sans la table des surcouches, le catalogue commun tient',
    Number(sansTable.catalogue_actif.valeur) === referenceSansSurcouche,
    `${sansTable.catalogue_actif.valeur} contre ${referenceSansSurcouche}`);
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


  // ── UN CENTRE QUI VIENT D OUVRIR A DE QUOI PARLER ───────────────────────
  // porteDeQuoiParler exigeait une ESTIMATION publique et solide. Ecrite quand
  // la fiche ne portait que le REGISTRE, elle faisait taire un centre actif,
  // ouvert, avec ses horaires et ses prix, au motif « rien a dire sur ce
  // centre ». Le motif etait faux.
  console.log('\n[OUVERTURE] un centre sans historique a de quoi dire');
  const { porteDeQuoiParler: aDeQuoiParler } = require('../lib/center-advisor');

  // LE DEFAUT D ORIGINE, teste EN PREMIER : un comptage du registre ne
  // debloque rien. C est la garde que ce patch doit laisser intacte.
  const uneSeuleVente = ficheDuRegistre({
    reservations: [resa({ date: '2026-08-01' })], formules: [], aujourdhui: '2026-09-10',
  });
  ok('MONTAGE : une seule vente produit bien une fiche',
    Boolean(uneSeuleVente.registre_taille), JSON.stringify(Object.keys(uneSeuleVente).length));
  ok('LE DEFAUT D ORIGINE RESTE FERME : une seule reservation ne debloque rien',
    aDeQuoiParler(uneSeuleVente) === false,
    JSON.stringify(Object.values(uneSeuleVente).filter((f) => f.audience === 'public').map((f) => f.id)));
  ok('et aucun fait de cette fiche ne se declare fait d offre',
    Object.values(uneSeuleVente).every((f) => f.offre === false),
    JSON.stringify(Object.values(uneSeuleVente).filter((f) => f.offre).map((f) => f.id)));

  // LE POINT : un fait d OFFRE seul suffit.
  const offreSeule = {
    jours_ouverts: {
      id: 'jours_ouverts', libelle: 'jours de la semaine ou le centre ouvre',
      valeur: 'mardi 14h - 22h | samedi 10h - Minuit', n: 2, genre: 'denombrement',
      audience: 'public', offre: true, mois: [], du: '', au: '', source: 'grille du centre',
      fragile: false, motifFragilite: '', motsInterdits: [], periode: '',
    },
  };
  ok('LE POINT : un fait d offre seul suffit a avoir de quoi parler',
    aDeQuoiParler(offreSeule) === true);
  ok('CONTRE-PREUVE : le MEME fait sans le drapeau offre ne suffit pas',
    aDeQuoiParler({ jours_ouverts: { ...offreSeule.jours_ouverts, offre: false } }) === false,
    'un denombrement public quelconque debloque la parole');
  ok('CONTRE-PREUVE : un fait d offre INTERNE ne suffit pas non plus',
    aDeQuoiParler({ jours_ouverts: { ...offreSeule.jours_ouverts, audience: 'interne' } }) === false,
    'un fait interne a atteint la porte publique');

  // DE LA VRAIE FICHE JUSQU AU VERDICT. Les assertions ci-dessus partent d un
  // fait ECRIT A LA MAIN : elles prouvent que la garde lit le drapeau, jamais
  // que les faits le portent. Trois mutations restaient vertes sans celle-ci
  // (poser() qui cesse de transmettre le drapeau, jours_ouverts et
  // prix_plancher qui cessent de se declarer). Celle-ci part de la fabrique
  // reelle et finit sur le verdict.
  const ficheReelleSansVente = ficheDuRegistre({
    reservations: [], formules: [], aujourdhui: '2026-09-10',
    agenda: Array.from({ length: 14 }, (unused, i) => ({
      date: new Date(Date.parse('2026-09-10T00:00:00Z') + i * 86400000).toISOString().slice(0, 10),
      ouvert: true, ferme: false, plage: '10h - 22h', raisons: [], coupures: [],
    })),
    prix: [{
      id: 'f6', nom: 'FORMULE 6', prix: 18, unite: 'par personne',
      minimum: 6, jours: 14, surTotal: 14, horaire: '',
    }],
  });
  ok('MONTAGE : la fiche reelle est bien celle d un centre sans une vente',
    Boolean(ficheReelleSansVente.registre_vide),
    JSON.stringify(Object.keys(ficheReelleSansVente)));
  ok('LE POINT DE BOUT EN BOUT : la fabrique pose des faits d offre',
    Object.values(ficheReelleSansVente).filter((f) => f.offre).map((f) => f.id).sort().join(',')
      === 'jours_ouverts,prix_du_catalogue,prix_plancher',
    JSON.stringify(Object.values(ficheReelleSansVente).filter((f) => f.offre).map((f) => f.id)));
  ok('et le verdict suit : ce centre a de quoi parler',
    aDeQuoiParler(ficheReelleSansVente) === true,
    JSON.stringify(Object.values(ficheReelleSansVente)
      .filter((f) => f.audience === 'public').map((f) => `${f.id}:${f.offre}`)));

  // L ANCIENNE REGLE TIENT TOUJOURS : une estimation publique et solide
  // debloque, sans aucun fait d offre.
  ok('l ancienne regle tient : une estimation publique et solide suffit encore',
    aDeQuoiParler(fiche) === true && Object.values(fiche).every((f) => !f.offre),
    JSON.stringify(Object.values(fiche).filter((f) => f.offre).map((f) => f.id)));

  // ET LE CONSEILLER PARLE. Sans cette assertion, la garde serait juste et
  // personne ne s en servirait.
  let appelsSurNeuf = 0;
  const surCentreNeuf = await proposerDepuisLaFiche({
    fiche: {
      ...offreSeule,
      prix_plancher: {
        id: 'prix_plancher', libelle: 'la formule la moins chere sans condition de jour ni d heure',
        valeur: 'FORMULE 6 : 18 EUR par personne, des 6 personnes, reservable les 12 jours ouverts de la fenetre',
        n: 9, genre: 'denombrement', audience: 'public', offre: true, mois: [], du: '', au: '',
        source: 'moteur de reservation', fragile: false, motifFragilite: '', motsInterdits: [], periode: '',
      },
    },
    lieu: LIEU,
    fetchImpl: async (url, options) => {
      appelsSurNeuf += 1;
      return {
        ok: true,
        json: async () => ({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify({
            titre: 'Ouvert du mardi au samedi',
            corps: 'Le centre ouvre le mardi et le samedi, des 18 EUR par personne.',
            nature: 'constat',
            faitsUtilises: ['jours_ouverts', 'prix_plancher'],
          }) }],
        }),
      };
    },
  });
  ok('LE POINT : le conseiller ecrit sur un centre sans une seule reservation',
    Boolean(surCentreNeuf.proposition) && !surCentreNeuf.silence,
    JSON.stringify(surCentreNeuf.motifs));
  ok('et il a bien appele le modele une fois',
    appelsSurNeuf === 1, String(appelsSurNeuf));
  ok('le texte cite des nombres qui viennent de la fiche',
    surCentreNeuf.proposition && /18 EUR/.test(surCentreNeuf.proposition.corps),
    surCentreNeuf.proposition && surCentreNeuf.proposition.corps);

  // CONTRE-PREUVE : la MEME fiche sans le drapeau offre se tait, et le motif
  // nomme les trois manques au lieu de parler d estimation seule.
  let appelsSansOffre = 0;
  const sansOffre = await proposerDepuisLaFiche({
    fiche: { jours_ouverts: { ...offreSeule.jours_ouverts, offre: false } },
    lieu: LIEU,
    fetchImpl: async () => { appelsSansOffre += 1; return { ok: false, status: 500, text: async () => '' }; },
  });
  ok('CONTRE-PREUVE : sans fait d offre, le silence revient',
    sansOffre.silence === 'rien_a_dire', String(sansOffre.silence));
  ok('AUCUN appel au modele dans ce cas',
    appelsSansOffre === 0, String(appelsSansOffre));
  ok('le motif nomme les trois manques, pas seulement l estimation',
    sansOffre.motifs.some((m) => /horaires/.test(m) && /prix/.test(m)),
    JSON.stringify(sansOffre.motifs));
  if (cleSauvee === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = cleSauvee;

  console.log(`\n${failures ? `center-advisor-check: ${failures} ECHEC(S)` : 'center-advisor-check: ALL OK'}`);
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('FAIL  gate interrompu :', (error && error.stack) || error);
  process.exit(1);
});
