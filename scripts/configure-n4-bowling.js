// CONFIGURATION DU CENTRE N4 BOWLING (Marche-en-Famenne), 2026-08-20.
//
// Ce script fait ce que la console ferait, en appelant EXACTEMENT les memes
// fonctions (lib/center-config, lib/catalog-store). Il ne fabrique aucune ligne
// a la main : la forme des donnees est donc identique a celle d'un centre
// configure aux ecrans. Il est IDEMPOTENT : le relancer ne cree pas de doublon.
//
// POURQUOI UN SCRIPT PLUTOT QUE LES ECRANS
// Les codes d'acces staff vivent dans les variables Vercel chiffrees et ne sont
// pas recuperables depuis cette machine. Le script vaut aussi documentation :
// il dit noir sur blanc d'ou vient chaque chiffre.
//
// LA SOURCE DE CHAQUE CHIFFRE : le site vitrine de N4 (depot local
// C:\Users\movsa\dev\n4-bowling), pages bowling.html, jeux.html, karabox.html,
// anniversaires.html et infos.html. Aucun montant n'est invente ici.
//
// LE CHOIX STRUCTURANT : CHAQUE CENTRE A SON PROPRE SYSTEME.
// N4 vend le bowling PAR PERSONNE ET PAR PARTIE, avec un prix qui depend du
// jour. Fun Galaxy vend PAR PISTE ET PAR DUREE (39 EUR l'heure la piste). Ces
// deux modeles coexistent desormais dans le meme produit, chacun chez lui :
// `resources.bowling.pricing` est une DONNEE DE CENTRE, absente chez Fun
// Galaxy, donc sa grille ne bouge pas d'un centime. Verrouille par
// `npm run test:bowling-per-game`.
//
// Une premiere version de ce script contournait le probleme en exprimant les
// tarifs de N4 en FORMULES et en retirant le bowling de la vente a la carte.
// Ce n'etait pas ce que N4 fait : Movsar a demande le vrai systeme. Le
// contournement est retire ici, et les formules ne portent plus que ce qui EST
// une offre groupee (promotions, anniversaire, ecoles, Kara Box).
//
// Lancement : node scripts/configure-n4-bowling.js [--dry]

const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

const { getPool } = require('../lib/database');
const { saveCenterConfigOverride } = require('../lib/center-config');
const catalogStore = require('../lib/catalog-store');

const CENTER_ID = 'n4-bowling';
const CLIENT_ID = 'n4-bowling';
const DRY = process.argv.includes('--dry');

// ── Horaires (infos.html du site) ───────────────────────────────────────────
// 0 = dimanche .. 6 = samedi.
//
// LES NUITS QUI DEBORDENT SUR LE LENDEMAIN. N4 ferme a 1 h le vendredi et a 2 h
// le samedi. Ces heures s'ecrivent 25:00 et 26:00 : la soiree du samedi
// APPARTIENT au samedi, pour le staff comme pour le planning, meme quand elle
// finit dimanche matin. C'est la notation standard en loisirs, et le client,
// lui, lit une heure de montre (01:00) : la conversion est un habillage
// d'affichage, jamais un changement de donnee. Le normaliseur accepte
// desormais jusqu'a 30:00 et refuse une fermeture anterieure a l'ouverture.
const REGULAR = {
  0: { open: '12:00', close: '23:00' }, // dimanche
  1: null,                              // lundi ferme
  2: null,                              // mardi ferme
  3: { open: '12:00', close: '23:00' }, // mercredi
  4: { open: '15:00', close: '23:00' }, // jeudi
  5: { open: '15:00', close: '25:00' }, // vendredi, jusqu'a 1 h du matin
  6: { open: '12:00', close: '26:00' }, // samedi, jusqu'a 2 h du matin
};
const HOLIDAY = {
  0: { open: '11:00', close: '23:00' },
  1: { open: '11:00', close: '23:00' },
  2: { open: '11:00', close: '23:00' },
  3: { open: '11:00', close: '23:00' },
  4: { open: '11:00', close: '23:00' },
  5: { open: '11:00', close: '25:00' }, // 1 h du matin
  6: { open: '11:00', close: '26:00' }, // 2 h du matin
};

// ── LE TARIF DU BOWLING DE N4 (bowling.html : « Par personne et par partie ») ─
// Mercredi et jeudi : 1re partie 6,00 EUR, 2e 5,00 EUR  -> cumul 6 puis 11
// Vendredi a dimanche : 1re 7,00 EUR, 2e 6,00 EUR        -> cumul 7 puis 13
// `prices` porte le CUMUL par personne, parce que c'est ce que le client paie.
// Sa longueur borne ce qui se vend en ligne : le site ne publie que la 1re et
// la 2e partie, donc on n'en vend pas trois sans que N4 l'ait decide.
// Lundi et mardi n'ont aucun palier : le centre est ferme.
const BOWLING_PRICING = {
  mode: 'per_game_per_person',
  minutesPerGame: 60,
  tiers: [
    { days: [3, 4], prices: [6, 11] },
    { days: [5, 6, 0], prices: [7, 13] },
  ],
};

// ── Ce que N4 possede, et ce qu'il ne possede pas ───────────────────────────
// Le bowling se vend A LA CARTE, aux parties, au vrai tarif de N4. Tout le
// reste du catalogue plateforme est explicitement a false : N4 n'a ni laser
// game, ni minigolf, ni plaine de jeux, ni golf o'Clock, ni duckpin, ni fun
// run. Ses billards et son arcade existent mais ne se reservent pas (« sans
// reservation, on s'installe des qu'une table est libre » ; l'arcade fonctionne
// a la piece). La Kara Box, elle, se reserve : par formule, pas a la carte.
const ACTIVITY_AVAILABILITY = {
  bowling: true,
  laser_game: false,
  minigolf_blacklight: false,
  golf_oclock: false,
  playground: false,
  duckpin_bowling: false,
  fun_run: false,
  billards: false,
  arcade_time: false,
};

// LA KARA BOX EST UNE RESSOURCE COMPTEE, et c'est de la DONNEE, pas du code.
//
// CORRECTION D'UNE ERREUR QUE J'AI DITE : j'ai ecrit que le moteur ne comptait
// que trois ressources et qu'une salle de karaoke ne pouvait donc pas etre
// protegee du double-booking. C'est FAUX. `lib/declared-resources.js` existe
// depuis le chantier padel : un centre DECLARE ses installations dans sa config
// (`resources.declared`), et `lib/ops-engine.js` les alloue comme les pistes
// (parc, unites requises, remise en etat, blocs de conflit). Aucune migration,
// aucun deploiement, l'ecran Etablissement suffit.
//
// La Kara Box est donc declaree ici comme une installation a UNE unite : deux
// groupes ne peuvent plus prendre la meme heure. `humanValidation: 'required'`
// reste, mais par choix commercial (l'equipe cale la playlist et la duree avec
// le groupe), plus par defaut technique.
//
// Et comme la declaration vit dans la config DU CENTRE, elle n'existe que chez
// N4 : chaque entreprise est une planete a part, y compris pour ses murs.
const KARA_BOX_RESOURCE = {
  id: 'kara-box',
  name: 'Kara Box',
  units: 1,              // une seule salle
  capacityPerUnit: 30,   // un groupe entier tient dedans
  cleanupMinutes: 15,    // remise en etat entre deux groupes
  allowGroupMixing: false, // salle PRIVATIVE : jamais deux groupes ensemble
};

// L'activite du catalogue qui pointe vers cette installation. Son resourceType
// EST l'identifiant de la ressource declaree : c'est ce qui branche le
// catalogue sur le moteur.
// L'identifiant porte un TIRET, pas un tiret bas : les activites du socle ont
// des tirets bas (laser_game, party_table) mais le validateur de creation ne
// les accepte pas. On suit la regle du produit plutot que l'habitude du socle.
const KARA_BOX_ACTIVITY = {
  id: 'kara-box',
  name: 'Kara Box',
  resourceType: KARA_BOX_RESOURCE.id,
  bookable: false,
  priceType: 'per_pax',
  priceValue: null,
  priceUnit: 'par personne',
};

// ── Les formules du socle plateforme, retirees pour N4 ──────────────────────
// Ce sont les offres de Fun Galaxy (laser, minigolf, anniversaires ancres sur
// des activites que N4 n'a pas). Le retrait est SCOPE a l'entreprise n4-bowling
// depuis la migration 0042 : Fun Galaxy ne perd rien.
const PLATFORM_FORMULAS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'bts', 'mm', 'css', 'kfd', 'hlg', 'ffm'];

// ── LES DEUX VALEURS QUE LE SITE NE DONNE PAS ───────────────────────────────
// 1. La duree d'une partie de bowling. Le site parle de « parties », jamais de
//    minutes. Elle decide combien de temps une piste est bloquee, donc combien
//    de reservations tiennent dans une soiree.
// 2. La duree d'une session Kara Box. Le site dit « salle privative pour toute
//    la duree », sans chiffre.
// Les deux sont des HYPOTHESES DE TRAVAIL, pas des faits. A CONFIRMER AUPRES DE
// N4, puis changer ici et relancer le script.
const MINUTES_PAR_PARTIE = 60;
const MINUTES_KARA_BOX = 60;

const bowlingStep = (parties) => ({
  activityId: 'bowling',
  count: 1,
  durationMinutes: MINUTES_PAR_PARTIE * parties,
  label: parties === 1 ? '1 partie de bowling' : `${parties} parties de bowling`,
  critical: true,
});

// ── LES OFFRES GROUPEES DE N4 ───────────────────────────────────────────────
// Le bowling simple n'est PLUS une formule : il se vend a la carte, aux
// parties, au tarif du centre. Ne restent ici que les offres qui sont vraiment
// des offres : deux promotions a fenetre horaire, l'anniversaire enfants, le
// tarif ecoles et la Kara Box.
const FORMULAS = [
  {
    id: 'n4-jeudi-fou',
    name: 'Jeudi fou : 1 partie achetee, 1 offerte',
    family: 'Promotions',
    minPax: 1,
    priceType: 'per_pax',
    priceValue: 6,
    validDays: [4],
    timeLimitMinMinutes: 15 * 60,
    timeLimitMaxMinutes: 18 * 60,
    notDuringHolidays: true,
    best: true,
    descriptionLines: ['2 parties pour le prix d une', 'De 15h a 18h', 'Hors conges scolaires et jours feries'],
    steps: [bowlingStep(2)],
  },
  {
    id: 'n4-vendredi-malin',
    name: 'Vendredi malin : 1 partie achetee, 1 offerte',
    family: 'Promotions',
    minPax: 1,
    priceType: 'per_pax',
    priceValue: 7,
    validDays: [5],
    timeLimitMinMinutes: 15 * 60,
    timeLimitMaxMinutes: 18 * 60,
    notDuringHolidays: true,
    best: true,
    descriptionLines: ['2 parties pour le prix d une', 'De 15h a 18h', 'Hors conges scolaires et jours feries'],
    steps: [bowlingStep(2)],
  },
  {
    // anniversaires.html : « Mercredi et samedi, de 13h a 15h », 14,00 EUR par
    // enfant, minimum 8 enfants payants, l'anniversaire est invite. Deux heures :
    // mascotte, eau grenadine a volonte, un soft, parties de bowling, gateau.
    id: 'n4-anniversaire-enfants',
    name: 'Anniversaire enfants',
    family: 'Formules anniversaires',
    minPax: 8,
    priceType: 'per_pax',
    priceValue: 14,
    validDays: [3, 6],
    timeLimitMinMinutes: 13 * 60,
    timeLimitMaxMinutes: 15 * 60,
    isBirthdayFormula: true,
    humanValidation: 'recommended',
    descriptionLines: [
      'Deux heures, rien a preparer',
      'Animation par une mascotte',
      'Eau grenadine a volonte et un soft au choix',
      'Parties de bowling, chaussures comprises',
      'Gateau d anniversaire en fin de seance',
      'Minimum 8 enfants payants, l anniversaire est invite',
    ],
    steps: [
      bowlingStep(1),
      {
        activityId: 'party_table',
        count: 1,
        durationMinutes: 60,
        label: 'Table d anniversaire, gouter et gateau',
        critical: true,
      },
    ],
  },
  {
    // anniversaires.html : « En semaine avant 18h », la partie a 3,50 EUR par
    // personne. Le site dit « a organiser par telephone » ; l'offre est mise en
    // ligne a la demande de Movsar, avec confirmation par l'equipe.
    id: 'n4-ecoles-institutions',
    name: 'Ecoles et institutions',
    family: 'Groupes',
    minPax: 10,
    priceType: 'per_pax',
    priceValue: 3.5,
    validDays: [1, 2, 3, 4, 5],
    timeLimitMaxMinutes: 18 * 60,
    humanValidation: 'required',
    descriptionLines: [
      'La partie a 3,50 EUR par personne',
      'En semaine, avant 18h',
      'Chaussures comprises',
      'L equipe confirme la date avec vous',
    ],
    steps: [bowlingStep(1)],
  },
  {
    // karabox.html : 10,00 EUR par personne, des 6 personnes.
    id: 'n4-kara-box',
    name: 'Kara Box, karaoke prive',
    family: 'Groupes',
    minPax: 6,
    priceType: 'per_pax',
    priceValue: 10,
    humanValidation: 'required',
    descriptionLines: [
      'Salle fermee rien que pour votre groupe',
      'Banquettes, jeux de lumiere, catalogue Karafun',
      'Des 6 personnes',
      'L equipe confirme le creneau avec vous',
    ],
    steps: [{
      activityId: 'kara-box',
      count: 1,
      durationMinutes: MINUTES_KARA_BOX,
      label: 'Kara Box',
      critical: true,
    }],
  },
  {
    // anniversaires.html : « Mercredi apres-midi 7,50 EUR ».
    id: 'n4-kara-box-mercredi',
    name: 'Kara Box, mercredi apres-midi',
    family: 'Groupes',
    minPax: 6,
    priceType: 'per_pax',
    priceValue: 7.5,
    validDays: [3],
    timeLimitMaxMinutes: 18 * 60,
    humanValidation: 'required',
    descriptionLines: [
      'Le meme karaoke prive, 7,50 EUR par personne',
      'Le mercredi apres-midi seulement',
      'Des 6 personnes',
      'L equipe confirme le creneau avec vous',
    ],
    steps: [{
      activityId: 'kara-box',
      count: 1,
      durationMinutes: MINUTES_KARA_BOX,
      label: 'Kara Box',
      critical: true,
    }],
  },
];

// Les formules d'une PREMIERE version de ce script, quand le bowling ne pouvait
// pas se vendre aux parties. Elles font desormais double emploi avec la vente a
// la carte : on les retire de la portee de N4.
const OBSOLETE_FORMULAS = [
  'n4-1-partie-semaine',
  'n4-2-parties-semaine',
  'n4-1-partie-weekend',
  'n4-2-parties-weekend',
];

async function main() {
  const pool = getPool();
  const done = [];

  console.log(DRY ? '[REPETITION] rien ne sera ecrit\n' : '[ECRITURE] configuration de N4 Bowling\n');

  // ── 1. La config du centre ────────────────────────────────────────────────
  console.log('[1] Etablissement : pistes, capacite, horaires, tarif, activites');
  const patch = {
    resources: {
      bowling: {
        laneCount: 8,
        normalCapacityPerLane: 12,
        emergencyCapacityPerLane: 12,
        preferAdjacentLanes: true,
        pricing: BOWLING_PRICING,
      },
      laser: null,
      // Les installations propres a N4 : le moteur les compte comme les pistes.
      declared: [KARA_BOX_RESOURCE],
    },
    defaultSchedule: { regular: REGULAR, holiday: HOLIDAY },
    activityAvailability: ACTIVITY_AVAILABILITY,
    offerAvailability: Object.fromEntries(PLATFORM_FORMULAS.map((id) => [id, false])),
    classification: { birthdayFormulaIds: ['n4-anniversaire-enfants'] },
  };
  if (!DRY) await saveCenterConfigOverride(pool, CENTER_ID, patch);
  done.push('config centre');
  console.log('    8 pistes, 12 joueurs par piste, vendredi jusqu a 1 h, samedi jusqu a 2 h');
  console.log('    bowling vendu AUX PARTIES : 6/11 EUR mer-jeu, 7/13 EUR ven-dim, par personne');

  // ── 2. La Kara Box, activite propre a N4 ─────────────────────────────────
  console.log('\n[2] Kara Box : activite creee dans la portee de N4 seul');
  if (!DRY) {
    const exists = await pool.query(
      `select 1 from activities where id = $1 and owner_client_id = $2 limit 1;`,
      [KARA_BOX_ACTIVITY.id, CLIENT_ID],
    ).catch(() => ({ rowCount: 0 }));
    if (exists.rowCount) {
      await catalogStore.updateActivity(pool, {
        ...KARA_BOX_ACTIVITY, centerId: 'all', ownerClientId: CLIENT_ID,
      });
    } else {
      await catalogStore.createActivity(pool, {
        ...KARA_BOX_ACTIVITY, centerId: 'all', ownerClientId: CLIENT_ID,
      });
    }
  }
  done.push('activite kara_box');
  console.log('    aucun autre client ne la voit');

  // ── 3. Le bowling redevient vendable a la carte chez N4 ──────────────────
  // Une version precedente l'avait retire de la vente unitaire, faute de
  // pouvoir exprimer son tarif. Le tarif existe : on remet la vente.
  console.log('\n[3] Bowling remis en vente « a la carte » pour N4');
  if (!DRY) {
    await catalogStore.updateActivity(pool, {
      id: 'bowling', centerId: 'all', ownerClientId: CLIENT_ID, bookable: true,
    });
  }
  done.push('bowling vendable');

  // ── 4. Les formules de Fun Galaxy, retirees du catalogue de N4 ───────────
  console.log('\n[4] Retrait des formules qui ne sont pas a N4, dans SA portee');
  for (const id of [...PLATFORM_FORMULAS, ...OBSOLETE_FORMULAS]) {
    if (!DRY) {
      await catalogStore.deleteFormula(pool, { id, ownerClientId: CLIENT_ID }).catch((error) => {
        // Une formule jamais creee n'a rien a retirer : ce n'est pas un echec.
        if (!/inconnue/i.test(error && error.message ? error.message : '')) throw error;
      });
    }
    process.stdout.write(`    ${id}`);
  }
  console.log('\n    Fun Galaxy ne perd rien : chaque retrait est ecrit dans la portee n4-bowling');
  done.push(`${PLATFORM_FORMULAS.length + OBSOLETE_FORMULAS.length} formules retirees`);

  // ── 5. Les offres groupees de N4 ────────────────────────────────────────
  console.log('\n[5] Offres groupees de N4');
  const existing = new Set();
  try {
    const rows = await pool.query(`select id from formulas where owner_client_id = $1;`, [CLIENT_ID]);
    (rows.rows || []).forEach((row) => existing.add(row.id));
  } catch (error) {
    // Base pre-0042 : aucune formule N4 ne peut exister.
  }
  for (const formula of FORMULAS) {
    if (existing.has(formula.id)) {
      if (!DRY) {
        await catalogStore.updateFormula(pool, { ...formula, ownerClientId: CLIENT_ID });
        await catalogStore.setFormulaSteps(pool, { id: formula.id, steps: formula.steps, ownerClientId: CLIENT_ID });
      }
      console.log(`    mise a jour  ${formula.id.padEnd(26)} ${formula.priceValue} EUR / personne`);
    } else {
      if (!DRY) await catalogStore.createFormula(pool, { ...formula, ownerClientId: CLIENT_ID });
      console.log(`    creee        ${formula.id.padEnd(26)} ${formula.priceValue} EUR / personne`);
    }
  }
  done.push(`${FORMULAS.length} offres N4`);

  await pool.end();
  console.log(`\n${DRY ? 'REPETITION TERMINEE' : 'CONFIGURATION ECRITE'} : ${done.join(', ')}.`);
  console.log('Le centre reste au statut « planned » : le passer a « active » est une decision de mise en ligne.');
}

main().catch((error) => {
  console.error('\nECHEC :', error && error.message ? error.message : error);
  process.exit(1);
});
