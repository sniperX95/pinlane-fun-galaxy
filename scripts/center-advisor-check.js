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
  const fiche = ficheDuRegistre({ reservations: serie(120), formules: [], aujourdhui: '2028-06-01' });
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
  const idEte = Object.keys(ficheEte).find((id) => ficheEte[id].genre === 'estimation'
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
