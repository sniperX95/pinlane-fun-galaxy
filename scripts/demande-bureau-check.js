'use strict';
// LE BUREAU DES DEMANDES SUR MESURE, COTE SERVEUR (2026-09-29).
//
// Movsar : « les demandes sur mesures doivent bcp plus complete, un systeme
// bcp plus complet avec ia qui repond adapte [...] il doit y avoir toute les
// infos ». Et, depuis le debut du chantier : « aucune fausse info, tout doit
// etre vrai prouvable ». Ce gate tient les deux :
//   [A] l echeance promise au client (24 heures ouvrables) saute les jours
//       fermes et traverse le changement d heure ;
//   [B] l etude pose au moteur la question du formulaire public, ne garde que
//       les heures du moment voulu, et dit « a relancer » sur une panne,
//       jamais « impossible » ;
//   [C] la reponse de l IA est refusee des qu elle cite un chiffre absent des
//       faits, promet, ou dit « nous » ; le brouillon du code prend alors sa
//       place et passe les memes controles ;
//   [D] le suivi : un mail du client arrive apres la reponse remet la demande
//       a traiter ;
//   [E] la file : l echeance court depuis ce qui attend une reponse ;
//   [F] le vrai moteur (sans base) : les heures, les prix et le brouillon
//       tiennent ensemble ;
//   [G] rediger n envoie rien, et chaque action a son droit ;
//   [H] le cerveau du centre change de mandat selon la tache, et de rien
//       d autre.
// [I] casse chaque regle expres : le gate doit rougir.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.RESEND_API_KEY;

// Le moteur lit la journee en base : il la lit vide ici, avant que qui que
// ce soit ne charge api/public-availability.
const database = require('../lib/database');
database.readAvailabilitySnapshot = async (date, centerId) => ({ reservations: [], laneStatuses: {}, blocks: [], date, centerId });

let echecs = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `\n      ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return cond;
}
function section(titre) { console.log(`\n[${titre}]`); }
function rapporter(resultats) { resultats.forEach(([cond, label, detail]) => ok(cond, label, detail)); }
const rouge = (resultats) => resultats.some(([cond]) => !cond);

function viderCache() {
  Object.keys(require.cache).forEach((cle) => {
    if (/[\\/]lib[\\/](demande-bureau|demande-bureau-centre)\.js$/.test(cle)) delete require.cache[cle];
  });
}
function charger() {
  viderCache();
  return { B: require('../lib/demande-bureau'), C: require('../lib/demande-bureau-centre') };
}

// ---------------------------------------------------------------------------
// [A] L ECHEANCE
// ---------------------------------------------------------------------------
function verifierEcheance({ B }) {
  const lundiFerme = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay() !== 1;
  // Dimanche 4 octobre 2026, 22:00 a Bruxelles (UTC+2). Deux heures ce
  // dimanche, le lundi ferme ne compte pas, vingt-deux heures le mardi.
  const dimanche = B.echeanceDeReponse('2026-10-04T20:00:00.000Z', { jourOuvre: lundiFerme });
  // Samedi 24 octobre 2026, 12:00 (UTC+2). Le lendemain, 12:00 a Bruxelles
  // se lit en heure d hiver : 11:00 UTC.
  const heureChange = B.echeanceDeReponse('2026-10-24T10:00:00.000Z', { jourOuvre: () => true });
  const ferme = B.echeanceDeReponse('2026-10-04T20:00:00.000Z', { jourOuvre: () => false });
  const invalide = B.echeanceDeReponse('pas une date', { jourOuvre: () => true });
  return [
    [dimanche && dimanche.date === '2026-10-06' && dimanche.heure === '22:00' && dimanche.instant === '2026-10-06T20:00:00.000Z',
      'recue dimanche 22:00, lundi ferme : la reponse est due mardi 22:00 (le lundi ne compte pas)', JSON.stringify(dimanche)],
    [heureChange && heureChange.date === '2026-10-25' && heureChange.heure === '12:00' && heureChange.instant === '2026-10-25T11:00:00.000Z',
      'le changement d heure est traverse : dimanche 25 octobre 12:00 a Bruxelles = 11:00 UTC', JSON.stringify(heureChange)],
    [ferme === null, 'un centre ferme soixante jours de suite ne recoit pas d echeance inventee', JSON.stringify(ferme)],
    [invalide === null, 'une date de creation illisible ne donne pas d echeance', JSON.stringify(invalide)],
  ];
}

function verifierJourOuvre({ B }) {
  const { getCenter } = require('../lib/ops-knowledge');
  const { getSchedule } = require('../lib/booking-config');
  const { isCenterClosedAt } = require('../lib/availability-blocks');
  const center = getCenter('libramont');
  const base = new Date();
  let iso = '';
  for (let n = 7; n < 60 && !iso; n += 1) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + n, 12));
    const candidat = d.toISOString().slice(0, 10);
    if (B.jourOuvreDuCentre({ center, blocks: [], getSchedule, isCenterClosedAt })(candidat)) iso = candidat;
  }
  const jourEntier = { scopeType: 'center', date: iso, startMin: null, endMin: null };
  const deuxHeures = { scopeType: 'center', date: iso, startMin: 14 * 60, endMin: 16 * 60 };
  const ouvert = (blocks) => B.jourOuvreDuCentre({ center, blocks, getSchedule, isCenterClosedAt })(iso);
  return [
    [Boolean(iso), `MONTAGE un jour ouvert de Libramont est trouve dans les 60 jours (${iso || 'aucun'})`],
    [iso && ouvert([jourEntier]) === false, 'une fermeture posee sur la journee entiere rend le jour ferme'],
    [iso && ouvert([deuxHeures]) === true, 'une fermeture de deux heures laisse le jour ouvert'],
  ];
}

// ---------------------------------------------------------------------------
// [B] L ETUDE
// ---------------------------------------------------------------------------
const D1 = '2030-05-15';
const D2 = '2030-05-13';
const AUJOURDHUI = '2030-05-01';

function demandeType(sur = {}) {
  return {
    id: 7, centerId: 'libramont', contactName: 'Ansar Bisultanov', email: 'ansar@example.org', phone: '+32 470 00 00 00',
    pax: 31, status: 'new', message: 'Pique-nique a prevoir.', createdAt: '2030-04-30T08:00:00.000Z',
    payload: { demande: {
      version: 1, groupType: 'ecole', groupTypeLabel: 'École, jeunesse', organisation: 'Athénée de Libramont',
      participants: 31, companions: 3, ages: ['7-12'], flexible: false, date: D1, alternativeDate: D2, period: '',
      moment: 'apres-midi', momentLabel: 'Après-midi',
      formulas: [{ id: 'f3', name: 'Formule 3' }, { id: 'f9', name: 'Happy Laser' }, { id: 'f7', name: 'Formule 7' }],
      activities: [{ id: 'bowling', name: 'Bowling' }, { id: 'laser_game', name: 'Laser Game' }],
      advice: false, budgetPerPerson: 25, contactRole: 'Enseignant', invoice: true, vatNumber: 'BE0123456789',
      ...sur,
    } },
  };
}

function fauxMoteur(journal, { debord = 0 } = {}) {
  return async (params) => {
    journal.push(params);
    if (params.type === 'formule' && params.formuleId === 'f3') {
      return { status: 200, json: { ok: true, price: 868, slots: [{ time: '12:00' }, { time: '14:30' }, { time: '18:30' }] } };
    }
    if (params.type === 'formule' && params.formuleId === 'f9') {
      return { status: 200, json: { ok: true, slots: [], message: 'Cette formule n’est pas proposée ce jour-là.' } };
    }
    if (params.type === 'formule') return { status: 429, json: { ok: false, message: 'Trop de requêtes. Merci de réessayer dans un instant.' } };
    return {
      status: 200,
      json: {
        ok: true,
        price: 544,
        program: { items: [
          { activityId: 'bowling', name: 'Bowling', priceKnown: true, price: 234, duration: 1, laneCount: 6, minutes: 60 },
          { activityId: 'laser_game', name: 'Laser Game', priceKnown: true, price: 310, games: 1, minutes: 40 },
        ] },
        slots: [{
          time: '14:00', visitEndTime: debord ? '22:00' : '16:00',
          ...(debord ? { visitEndsAtClose: true, visitShortfallMinutes: debord } : {}),
          opsPlan: { resourceBlocks: [{ resourceType: 'lane' }, { resourceType: 'laser_arena' }, { resourceType: 'laser_arena' }] },
        }],
        anchors: { activities: [{ activityId: 'bowling', label: 'Bowling', times: [{ time: '14:00', ok: true }, { time: '15:00', ok: false }, { time: '19:00', ok: true }] }] },
      },
    };
  };
}

const jourDe = (iso) => (iso === D1 ? { ouvert: true, schedule: { open: 10, close: 22 } } : { ouvert: false, schedule: null });

async function etudeType(B, sur = {}, options = {}) {
  const journal = [];
  const etude = await B.etudierDemande(demandeType(sur), {
    disponibilite: fauxMoteur(journal, options),
    jourDe,
    occupation: async () => ({ reservations: 2, joueurs: 20 }),
    aujourdhui: options.aujourdhui || AUJOURDHUI,
  });
  return { etude, journal };
}

async function verifierEtude({ B }) {
  const { etude, journal } = await etudeType(B);
  const [j1, j2] = etude.dates;
  const f3 = j1 && j1.formules.find((f) => f.id === 'f3');
  const f9 = j1 && j1.formules.find((f) => f.id === 'f9');
  const f7 = j1 && j1.formules.find((f) => f.id === 'f7');
  const v = j1 && j1.visite;
  const appelF3 = journal.find((p) => p.formuleId === 'f3');
  const appelVisite = journal.find((p) => p.type === 'visite');
  let programme = [];
  try { programme = JSON.parse((appelVisite && appelVisite.program) || '[]').map((a) => a.activityId); } catch (error) { programme = []; }
  const texte = B.etudeEnTexte(etude);
  const points = B.pointsDeLEtude(demandeType(), etude);
  const r = [
    [etude.dates.length === 2 && j1.principale && !j2.principale, 'les deux dates du client sont etudiees, la principale d abord'],
    [j1.ouvert && j1.horaires && j1.horaires.de === '10:00' && j1.horaires.a === '22:00' && j1.fenetre && j1.fenetre.de === 720 && j1.fenetre.a === 1080,
      'le jour ouvert porte ses horaires et la plage de l apres-midi (12:00 a 18:00)', JSON.stringify({ h: j1.horaires, f: j1.fenetre })],
    [appelF3 && appelF3.date === D1 && appelF3.type === 'formule' && Number(appelF3.pax) === 31,
      'le moteur recoit la question du formulaire public : la date, la formule, les 31 joueurs', JSON.stringify(appelF3)],
    [f3 && f3.ok && f3.prix === 868 && f3.parJoueur === 28 && JSON.stringify(f3.heures) === '["12:00","14:30"]',
      'la Formule 3 : 868 € pour le groupe, 28 € par joueur, et SEULEMENT les departs de l apres-midi (18:30 ecarte)', JSON.stringify(f3)],
    [f9 && !f9.ok && !f9.panne && /n’est pas proposée/.test(f9.raison), 'une formule refusee par le moteur garde la raison du moteur', JSON.stringify(f9)],
    [f7 && f7.panne === true && !f7.ok && !/Trop de requêtes/.test(f7.raison), 'un moteur qui repond 429 est une PANNE, pas un refus', JSON.stringify(f7)],
    [/Formule 7 : non étudiée/.test(texte) && !/Formule 7 : impossible/.test(texte), 'les faits disent « non etudiee », jamais « impossible », pour la formule en panne'],
    [points.some((p) => /Étude incomplète le mercredi 15 mai 2030/.test(p)), 'l equipe est prevenue de relancer l etude avant d envoyer', JSON.stringify(points)],
    [JSON.stringify(programme) === '["bowling","laser_game"]' && appelVisite.softReserve === '1',
      'la visite demande le programme des activites choisies', JSON.stringify(appelVisite)],
    [v && v.ok && v.prix === 544 && v.parJoueur === 17.55 && v.prixComplet === true && v.depasse === 0,
      'le programme : 544 € pour le groupe, 17,55 € par joueur', JSON.stringify(v && { prix: v.prix, parJoueur: v.parJoueur })],
    [v && v.lignes.length === 2 && v.lignes[0].detail === '1 h, 6 pistes' && v.lignes[1].detail === '1 partie, en 2 vagues',
      'chaque activite dit son detail : pistes, parties, vagues du laser', JSON.stringify(v && v.lignes)],
    [v && v.proposition && v.proposition.debut === '14:00' && v.proposition.fin === '16:00', 'le depart propose par le moteur et sa fin'],
    [v && JSON.stringify(v.heuresParActivite) === '[{"nom":"Bowling","heures":["14:00"]}]', 'les heures par activite : libres ET dans l apres-midi seulement', JSON.stringify(v && v.heuresParActivite)],
    [j1.occupation && j1.occupation.reservations === 2 && j1.occupation.joueurs === 20, 'le planning du jour est lu'],
    [j2 && !j2.ouvert && journal.every((p) => p.date !== D2), 'l autre date, fermee, est dite fermee sans interroger le moteur'],
    [points.some((p) => /3 accompagnateurs non comptés/.test(p)), 'les 3 accompagnateurs sont signales : ils ne sont pas dans les prix'],
  ];

  const flexible = await etudeType(B, { flexible: true, date: '', alternativeDate: '', period: 'printemps 2030' });
  r.push([/printemps 2030/.test(flexible.etude.sansDate) && flexible.journal.length === 0, 'une date a fixer : rien n est interroge, la periode est dite']);
  const passee = await etudeType(B, {}, { aujourdhui: '2030-06-01' });
  r.push([passee.etude.dates.every((j) => j.passee) && passee.journal.length === 0, 'une date passee n est pas etudiee']);
  return r;
}

async function verifierDebord({ B }) {
  const { etude } = await etudeType(B, { formulas: [] }, { debord: 45 });
  const v = etude.dates[0].visite;
  const brouillon = B.brouillonDuCode(demandeType({ formulas: [] }), etude, { centerName: 'Fun Galaxy Libramont' });
  const points = B.pointsDeLEtude(demandeType({ formulas: [] }), etude);
  return [
    [v && v.depasse === 45, 'un programme qui deborde la fermeture de 45 min est dit comme tel', JSON.stringify(v && v.depasse)],
    [!/Bowling et Laser Game, 544 €/.test(brouillon.corps), 'le brouillon ne propose pas un programme qui ne tient pas dans la journee', brouillon.corps],
    [points.some((p) => /dépasse la fermeture de 45 minutes/.test(p)), 'l equipe voit le debord dans les points a verifier', JSON.stringify(points)],
  ];
}

// ---------------------------------------------------------------------------
// [C] LA REPONSE
// ---------------------------------------------------------------------------
const CERVEAU = {
  stable: 'MANDAT ET REGLES DU CENTRE.',
  context: 'FAITS DU CENTRE : ouvert du mercredi au dimanche.',
  signature: 'L’équipe de Fun Galaxy Libramont',
  centerName: 'Fun Galaxy Libramont',
};

const TEXTE_ANCRE = [
  'Bonjour Ansar,',
  '',
  'Merci pour votre demande pour un groupe de 31 personnes, le mercredi 15 mai 2030 dans l’après-midi.',
  '',
  'La Formule 3 est possible avec un départ à 12:00 ou 14:30, pour 868 € pour le groupe, soit 28 € par joueur.',
  'L’horaire choisi est retenu à votre nom dès votre accord.',
  '',
  'Bien à vous,',
  'L’équipe de Fun Galaxy Libramont',
].join('\n');

function modele(reponses) {
  const appels = [];
  const fn = async (options) => {
    appels.push(options);
    const r = reponses[Math.min(appels.length - 1, reponses.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  };
  fn.appels = appels;
  return fn;
}
const reponseIa = (corps, points = []) => ({ objet: 'Votre venue pour 31 personnes', corps, pointsAVerifier: points, _provider: 'double', _model: 'double' });

async function verifierReponse({ B }) {
  const { etude } = await etudeType(B);
  const item = demandeType();
  const rediger = (llm, brain = CERVEAU) => B.redigerReponse({ item, etude, client: null, conversation: [], brain, llm, nomDuCentre: 'Fun Galaxy Libramont' });
  const secours = B.brouillonDuCode(item, etude, { signature: CERVEAU.signature, centerName: CERVEAU.centerName });

  const llmAncre = modele([reponseIa(TEXTE_ANCRE, ['Vérifier le prix des accompagnateurs.'])]);
  const ancre = await rediger(llmAncre);

  const llmInvente = modele([reponseIa(`${TEXTE_ANCRE}\nUne remise de 15 % est offerte aux écoles.`)]);
  const invente = await rediger(llmInvente);
  let corrections = [];
  try { corrections = JSON.parse(llmInvente.appels[1].user).correctionsDemandees || []; } catch (error) { corrections = []; }

  const llmPromesse = modele([reponseIa(TEXTE_ANCRE.replace('L’horaire choisi est retenu à votre nom dès votre accord.', 'Votre créneau est réservé pour 14:30.')), reponseIa(TEXTE_ANCRE)]);
  const promesse = await rediger(llmPromesse);
  const llmNous = modele([reponseIa(TEXTE_ANCRE.replace('La Formule 3 est possible', 'Nous vous proposons la Formule 3')), reponseIa(TEXTE_ANCRE)]);
  const nous = await rediger(llmNous);

  const llmGratuit = modele([reponseIa([TEXTE_ANCRE, 'Les accompagnateurs entrent gratuitement.'].join('\n')), reponseIa(TEXTE_ANCRE)]);
  const gratuit = await rediger(llmGratuit);
  let correctionsGratuit = [];
  try { correctionsGratuit = JSON.parse(llmGratuit.appels[1].user).correctionsDemandees || []; } catch (error) { correctionsGratuit = []; }
  const llmHeures = modele([reponseIa(TEXTE_ANCRE.replace('à 12:00 ou 14:30', 'à 12h ou 14h30').replace('868 €', '868 euros'))]);
  const heuresFr = await rediger(llmHeures);
  const llmHorsEtude = modele([reponseIa(TEXTE_ANCRE.replace('à 12:00 ou 14:30', 'à 12:00 ou 19h'))]);
  const horsEtude = await rediger(llmHorsEtude);
  const muette = await rediger(modele([null]));
  const leve = await rediger(modele([new Error('delai depasse')]));
  const llmSansCerveau = modele([reponseIa(TEXTE_ANCRE)]);
  const sansCerveau = await rediger(llmSansCerveau, null);

  // Le brouillon du code, sur trois etudes differentes, passe les MEMES
  // controles que l IA.
  const flexible = (await etudeType(B, { flexible: true, date: '', alternativeDate: '', period: 'printemps 2030' })).etude;
  const principaleFermee = (await etudeType(B, { date: D2, alternativeDate: D1 })).etude;
  const brouillons = [
    ['jour ouvert', item, etude],
    ['date a fixer', demandeType({ flexible: true, date: '', alternativeDate: '', period: 'printemps 2030' }), flexible],
    ['jour ferme, autre date ouverte', demandeType({ date: D2, alternativeDate: D1 }), principaleFermee],
  ].map(([nom, it, et]) => {
    const b = B.brouillonDuCode(it, et, { signature: CERVEAU.signature, centerName: CERVEAU.centerName });
    const source = [CERVEAU.stable, CERVEAU.context, B.demandeEnTexte(it), B.etudeEnTexte(et), b.objet, b.corps].join('\n');
    return [nom, b, B.controlerReponse(b, source)];
  });

  return [
    [ancre.source === 'ia' && ancre.controle.ok && llmAncre.appels.length === 1, 'un texte ancre dans les faits est garde tel quel (source IA, un seul appel)', JSON.stringify(ancre.controle)],
    [ancre.pointsAVerifier.includes('Vérifier le prix des accompagnateurs.') && ancre.pointsAVerifier.some((p) => /accompagnateurs non comptés/.test(p)),
      'les points de l IA et ceux de l etude s additionnent', JSON.stringify(ancre.pointsAVerifier)],
    [invente.source === 'code' && invente.raison === 'ia-refusee' && llmInvente.appels.length === 2 && !/15 %/.test(invente.corps),
      'un « 15 % » absent des faits : l IA est corrigee une fois, puis remplacee par le brouillon du code', JSON.stringify({ s: invente.source, r: invente.raison, n: llmInvente.appels.length })],
    [corrections.some((c) => /« 15 % »/.test(c)), 'la seconde tentative recoit la correction qui nomme le chiffre invente', JSON.stringify(corrections)],
    [invente.corps === secours.corps && invente.controle.ok, 'le brouillon de secours est celui du code, et il passe les controles'],
    [promesse.source === 'ia' && llmPromesse.appels.length === 2 && !/est réservé/.test(promesse.corps), 'une promesse (« votre creneau est reserve ») est refusee, la version corrigee est gardee'],
    [nous.source === 'ia' && llmNous.appels.length === 2 && !/Nous vous/.test(nous.corps), 'un « nous » est refuse, la version corrigee est gardee'],
    [gratuit.source === 'ia' && llmGratuit.appels.length === 2 && !/gratuit/i.test(gratuit.corps) && correctionsGratuit.some((c) => /« gratuit »/.test(c)),
      'sans aucun chiffre, « entrent gratuitement » est refuse : aucun fait ne le porte', JSON.stringify(correctionsGratuit)],
    [heuresFr.source === 'ia' && llmHeures.appels.length === 1, '« 12h », « 14h30 » et « 868 euros » sont reconnus comme les heures et le montant de l etude'],
    [horsEtude.source === 'code' && llmHorsEtude.appels.length === 2, 'un depart a 19h, absent de l etude, est refuse'],
    [muette.source === 'code' && muette.raison === 'ia-muette', 'un modele muet laisse la place au brouillon du code'],
    [leve.source === 'code' && leve.raison === 'ia-muette', 'un modele qui leve une erreur aussi, sans erreur a l ecran'],
    [sansCerveau.source === 'code' && sansCerveau.raison === 'ia-absente' && llmSansCerveau.appels.length === 0, 'sans cerveau du centre, le modele n est pas appele'],
    ...brouillons.map(([nom, b, c]) => [c.ok, `brouillon du code (${nom}) : aucun chiffre hors des faits, aucune promesse, aucun « nous »`, JSON.stringify({ c, corps: b.corps })]),
  ];
}

// ---------------------------------------------------------------------------
// [D] LE SUIVI
// ---------------------------------------------------------------------------
function verifierSuivi({ B }) {
  const T0 = '2030-04-30T08:00:00.000Z';
  const T1 = '2030-04-30T15:00:00.000Z';
  const avant = '2030-04-30T12:00:00.000Z';
  const apres = '2030-05-01T09:00:00.000Z';
  const item = (status, payload = {}) => ({ status, createdAt: T0, payload });
  let p = B.ajouterAuSuivi({ demande: { participants: 31 } }, { type: 'note', par: 'Rachel', texte: '  Rappeler le directeur mardi  ' });
  p = B.ajouterAuSuivi(p, { type: 'reponse', par: 'Rachel', objet: 'Votre venue', communicationId: 42, source: 'ia', le: T1 });
  p = B.ajouterAuSuivi(p, { type: 'reponse', par: 'Rachel', objet: 'Relance', communicationId: 43, source: 'inconnue', le: T1 });
  const rejoue = B.ajouterAuSuivi(p, { type: 'reponse', par: 'Rachel', objet: 'Votre venue', communicationId: 42, le: T1 });
  const leve = (fn) => { try { fn(); return null; } catch (error) { return error; } };
  const inconnu = leve(() => B.ajouterAuSuivi({}, { type: 'envoi' }));
  const vide = leve(() => B.ajouterAuSuivi({}, { type: 'note', texte: '   ' }));
  let long = {};
  for (let n = 0; n < 70; n += 1) long = B.ajouterAuSuivi(long, { type: 'statut', statut: `s${n}` });
  const avecReponse = { suivi: { historique: [{ type: 'reponse', le: T1, par: 'Rachel' }] } };
  const e = (it, recu) => B.resumeDuSuivi(it, { dernierMessageClient: recu });
  const clientARepondu = e(item('in_progress', avecReponse), apres);
  const avecResa = B.ajouterAuSuivi(avecReponse, { type: 'reservation', reservationId: 912 });
  return [
    [p.demande && p.demande.participants === 31, 'le suivi s ajoute sans toucher a la demande du client'],
    [p.suivi.notes.length === 1 && p.suivi.notes[0].texte === 'Rappeler le directeur mardi' && p.suivi.notes[0].par === 'Rachel', 'une note garde son texte, nettoye, et son auteur'],
    [p.suivi.historique[0].communicationId === 42 && p.suivi.historique[0].source === 'ia' && !('source' in p.suivi.historique[1]), 'une reponse garde son mail et sa source ; une source inconnue n est pas retenue'],
    [rejoue.suivi.historique.filter((x) => x.type === 'reponse').length === 2, 'un envoi rejoue (le meme mail, meme cle d idempotence) ne se range qu une fois', JSON.stringify(rejoue.suivi.historique.map((x) => x.communicationId))],
    [inconnu && inconnu.statusCode === 400 && vide && vide.statusCode === 400, 'un evenement inconnu ou une note vide sont refuses (400)'],
    [long.suivi.historique.length === 60 && long.suivi.historique[59].statut === 's69', 'l historique est borne aux 60 derniers evenements'],
    [e(item('new'), null).etape === 'a-traiter', 'une demande neuve est a traiter'],
    [e(item('in_progress', avecReponse), null).etape === 'en-attente', 'une reponse partie la met en attente du client'],
    [clientARepondu.etape === 'a-traiter' && clientARepondu.messageClient === apres, 'un mail du client APRES la reponse la remet a traiter', JSON.stringify(clientARepondu)],
    [e(item('in_progress', avecReponse), avant).etape === 'en-attente', 'un mail du client AVANT la reponse ne la remet pas a traiter'],
    [e(item('new'), apres).messageClient === apres, 'un mail du client apres sa demande se signale'],
    [e(item('handled', avecReponse), apres).etape === 'traitee' && e(item('archived'), apres).etape === 'archivee', 'traitee et archivee le restent'],
    [B.resumeDuSuivi(item('handled', avecResa)).reservationId === 912, 'la reservation nee de la demande est retrouvee'],
  ];
}

// ---------------------------------------------------------------------------
// [E] LA FILE
// ---------------------------------------------------------------------------
async function verifierFile({ C }) {
  const T0 = '2026-10-06T08:00:00.000Z';
  const T1 = '2026-10-06T12:00:00.000Z';
  const T2 = '2026-10-07T08:00:00.000Z';
  const reponse = { suivi: { historique: [{ type: 'reponse', le: T1, par: 'Rachel' }] } };
  const demandes = [
    { id: 1, centerId: 'libramont', email: 'Client@Example.org', status: 'in_progress', createdAt: T0, payload: reponse },
    { id: 2, centerId: 'libramont', email: 'b@example.org', status: 'in_progress', createdAt: T0, payload: reponse },
    { id: 3, centerId: 'gembloux', email: 'c@example.org', status: 'new', createdAt: T0, payload: {} },
    { id: 4, centerId: 'libramont', email: '', status: 'new', createdAt: T0, payload: {} },
  ];
  const appels = [];
  const deps = (messagesDuClient) => ({
    rafraichir: async () => {},
    centre: (id) => ({ id, name: id }),
    fermetures: async () => [],
    getSchedule: () => ({ open: 10, close: 22 }),
    isCenterClosedAt: () => false,
    messagesDuClient,
  });
  const file = await C.enrichirDemandes(demandes, deps(async (id, emails) => {
    appels.push([id, emails.slice().sort()]);
    return new Map(id === 'libramont' ? [['client@example.org', T2]] : []);
  }));
  const parId = Object.fromEntries(file.map((d) => [d.id, d]));
  const panne = await C.enrichirDemandes(demandes, deps(async () => { throw new Error('base indisponible'); }));
  return [
    [appels.length === 2 && JSON.stringify(appels.find((a) => a[0] === 'libramont')[1]) === '["b@example.org","client@example.org"]'
      && JSON.stringify(appels.find((a) => a[0] === 'gembloux')[1]) === '["c@example.org"]',
      'une lecture des mails recus par centre, adresses en minuscules, chaque centre ne lit que les siennes', JSON.stringify(appels)],
    [parId[1].suivi.etape === 'a-traiter' && parId[1].suivi.messageClient === T2, 'le client a repondu : la demande revient a traiter'],
    [parId[1].echeance && parId[1].echeance.instant === '2026-10-08T08:00:00.000Z', 'et son echeance court depuis SON mail (24 h apres), pas depuis la demande', JSON.stringify(parId[1].echeance)],
    [parId[2].suivi.etape === 'en-attente' && parId[2].echeance === null, 'en attente du client : pas d echeance pour l equipe'],
    [parId[3].echeance && parId[3].echeance.instant === '2026-10-07T08:00:00.000Z', 'une demande neuve : 24 h apres son arrivee', JSON.stringify(parId[3].echeance)],
    [parId[4].suivi.etape === 'a-traiter', 'une demande sans adresse reste dans la file'],
    [panne.length === 4 && panne.find((d) => d.id === 1).suivi.etape === 'en-attente', 'lecture des mails en panne : la file reste servie, sans « le client a repondu »'],
  ];
}

// ---------------------------------------------------------------------------
// [F] LE VRAI MOTEUR (sans base)
// ---------------------------------------------------------------------------
async function verifierVraiMoteur({ B, C }) {
  const { getCenter } = require('../lib/ops-knowledge');
  const { getSchedule } = require('../lib/booking-config');
  const { isCenterClosedAt } = require('../lib/availability-blocks');
  const { disponibiliteInterne } = require('../lib/disponibilite-interne');
  const { jourDuCentre } = require('../lib/center-facts');
  const aujourdhui = jourDuCentre().date;
  const center = getCenter('libramont');
  const appels = [];
  const deps = {
    rafraichir: async () => {},
    centre: () => center,
    fermetures: async () => [],
    getSchedule,
    isCenterClosedAt,
    disponibilite: (p) => { appels.push(p); return disponibiliteInterne(p); },
    planning: async () => ({ reservations: [] }),
    aujourdhui: () => aujourdhui,
    client: async () => null,
    conversation: async () => [],
    cerveau: async () => null,
    llm: null,
  };
  // Un mercredi a deux semaines au moins, ou le moteur propose la Formule 3.
  let trouve = null;
  for (let n = 14; n < 90 && !trouve; n += 1) {
    const d = new Date(`${aujourdhui}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    if (d.getUTCDay() !== 3) continue;
    const iso = d.toISOString().slice(0, 10);
    const item = demandeType({ date: iso, alternativeDate: '', formulas: [{ id: 'f3', name: 'Formule 3' }] });
    appels.length = 0;
    // eslint-disable-next-line no-await-in-loop
    const r = await C.brouillonDeLaDemande(item, deps);
    const j = r.etude.dates[0];
    if (j && j.ouvert && j.formules[0] && j.formules[0].ok) trouve = { iso, item, r, j, nAppels: appels.length };
  }
  if (!trouve) return [[false, 'MONTAGE le moteur propose la Formule 3 un mercredi dans les trois mois']];
  const { j, r, item } = trouve;
  const fo = j.formules[0];
  const dans = (hm) => { const [h, m] = hm.split(':').map(Number); const t = h * 60 + m; return t >= j.fenetre.de && t < j.fenetre.a; };
  const v = j.visite;
  const somme = v && v.lignes.reduce((s, l) => s + (l.prix || 0), 0);
  const source = [B.demandeEnTexte(item), B.etudeEnTexte(r.etude), r.brouillon.objet, r.brouillon.corps].join('\n');
  return [
    [true, `MONTAGE le moteur etudie le ${trouve.iso} : Formule 3 ${fo.prix} €, ${fo.heures.length} depart(s) dans l apres-midi`],
    [trouve.nAppels === 2, `une question par formule et une pour le programme, pas plus (${trouve.nAppels})`],
    [fo.heures.length > 0 && fo.heures.every(dans), 'chaque depart cite tombe dans l apres-midi demande', JSON.stringify({ h: fo.heures, f: j.fenetre })],
    [fo.parJoueur === Math.round((fo.prix / 31) * 100) / 100, 'le prix par joueur est le prix du groupe divise par les 31 joueurs'],
    [!v || !v.ok || !v.prixComplet || Math.abs(somme - v.prix) < 0.01, 'le total du programme est la somme de ses lignes', JSON.stringify(v && { prix: v.prix, somme })],
    [!v || !v.ok || v.heuresParActivite.every((a) => a.heures.every(dans)), 'les heures par activite restent dans l apres-midi'],
    [r.brouillon.source === 'code' && B.controlerReponse(r.brouillon, source).ok, 'le brouillon ecrit sur le vrai moteur passe les controles', r.brouillon.corps],
  ];
}

// ---------------------------------------------------------------------------
// [G] REDIGER N ENVOIE RIEN, ET CHAQUE ACTION A SON DROIT
// ---------------------------------------------------------------------------
function verifierAucunEnvoi() {
  const ops = fs.readFileSync(path.join(ROOT, 'api', 'ops.js'), 'utf8');
  const debut = ops.indexOf("if (action === 'customRequestDraft') {");
  const bloc = debut >= 0 ? ops.slice(debut, ops.indexOf('return;', debut)) : '';
  const etude = ops.slice(ops.indexOf("if (action === 'customRequestStudy') {"), ops.indexOf('return;', ops.indexOf("if (action === 'customRequestStudy') {")));
  return [
    [bloc.length > 0, 'MONTAGE l action customRequestDraft existe'],
    [!/sendDirectEmail|sendEmail|sendMail|enqueue|createCommunication|resend|appendCustomRequestSuivi|updateCustomRequestStatus/i.test(bloc), 'rediger le brouillon n envoie rien et n ecrit rien', bloc.slice(0, 400)],
    [/getCustomRequest\(body\.id, \{ centerId: scopedCenterId \}\)/.test(bloc), 'le brouillon ne lit que les demandes du centre de la session'],
    [/getCustomRequest\(url\.searchParams\.get\('id'\), \{ centerId: centerScope\(centerId\) \}\)/.test(etude), 'l etude ne lit que les demandes du centre de la session'],
    [/if \(action === 'customRequestDraft'\) return 'emails\.send';/.test(ops), 'rediger une reponse demande le droit d envoyer des mails'],
    [/if \(action === 'customRequestStudy'\) return \['clients\.view', 'reservations\.view', 'dashboard\.view'\];/.test(ops), 'l etude demande le meme droit que la file'],
    [/if \(action === 'customRequestNote'\) return \['clients\.view', 'reservations\.edit', 'dashboard\.view'\];/.test(ops), 'une note demande le meme droit qu un changement de statut'],
  ];
}

// ---------------------------------------------------------------------------
// [H] LE CERVEAU DU CENTRE : le mandat change, rien d autre
// ---------------------------------------------------------------------------
async function verifierCerveau() {
  const agent = require('../lib/email-agent');
  const deps = { query: async () => ({ rows: [] }), reel: false };
  const instant = Date.parse('2026-10-01T10:00:00Z');
  const defaut = await agent.buildEmailBrain('libramont', deps, instant);
  const bureau = await agent.buildEmailBrain('libramont', deps, instant, { tache: 'demande-sur-mesure', texte: '31 joueurs' });
  const lignesA = String(defaut.stable || '').split('\n');
  const lignesB = String(bureau.stable || '').split('\n');
  return [
    [/^Tu es l'assistant email du centre de loisirs\./.test(lignesA[0]) && /INTERDIT d'affirmer une disponibilité/.test(lignesA[1]), 'par defaut : l agent des emails, qui n affirme jamais une place'],
    [/^Tu es l'assistant de l'équipe du centre de loisirs\./.test(lignesB[0]) && /INTERDIT d'écrire qu'il est réservé, bloqué, confirmé ou garanti/.test(lignesB[1]), 'pour une demande : l assistant qui propose l etude, sans jamais la promettre'],
    [lignesA.slice(4).join('\n') === lignesB.slice(4).join('\n') && lignesA.length > 8, 'tout le reste du cerveau (doctrine, regles, voix) est identique'],
    [defaut.signature === bureau.signature && Boolean(defaut.signature), 'la meme signature du centre'],
  ];
}

// ---------------------------------------------------------------------------
// [J] LE SUIVI EN BASE (faux pg) : une transaction, la ligne verrouillee le
// temps d ecrire, le centre en parametre, et rien d ecrit chez un autre centre.
// ---------------------------------------------------------------------------
function baseFactice() {
  const lignes = [
    { id: 1, center_id: 'libramont', contact_name: 'A', status: 'new', payload: { demande: { participants: 31 } }, created_at: '2026-10-01T08:00:00.000Z' },
    { id: 2, center_id: 'gembloux', contact_name: 'B', status: 'new', payload: {}, created_at: '2026-10-01T08:00:00.000Z' },
  ];
  const journal = [];
  // Le faux moteur obeit au TEXTE : il ne filtre sur le centre que si la
  // requete le demande.
  const filtre = (sql, params, rang) => (new RegExp(`center_id\\s*=\\s*\\$${rang}`).test(sql) ? String(params[rang - 1] || '') : '');
  class FauxPool {
    async query(text, params = []) {
      const sql = String(text).trim();
      journal.push({ sql, params });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/^select (payload|\*) from custom_requests/i.test(sql)) {
        const centre = filtre(sql, params, 2);
        const rows = lignes.filter((l) => l.id === Number(params[0]) && (!centre || l.center_id === centre))
          .map((l) => ({ ...l, payload: JSON.parse(JSON.stringify(l.payload)) }));
        return { rows, rowCount: rows.length };
      }
      if (/^update custom_requests set payload/i.test(sql)) {
        const ligne = lignes.find((l) => l.id === Number(params[0]));
        if (!ligne) return { rows: [], rowCount: 0 };
        ligne.payload = JSON.parse(params[1]);
        return { rows: [{ ...ligne }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    async connect() { return { query: (t, p) => this.query(t, p), release() {} }; }
    async end() {}
  }
  return { lignes, journal, FauxPool };
}

async function verifierSuiviEnBase() {
  const base = baseFactice();
  const pgPath = require.resolve('pg');
  const dbPath = require.resolve('../lib/database');
  const ancienPg = require.cache[pgPath];
  const ancienneDb = require.cache[dbPath];
  const env = { url: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL };
  require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: base.FauxPool } };
  delete require.cache[dbPath];
  process.env.DATABASE_URL = 'postgres://gate:gate@localhost:5432/gate';
  process.env.DATABASE_SSL = 'disable';
  try {
    const db = require('../lib/database');
    const leve = async (fn) => { try { await fn(); return null; } catch (error) { return error; } };
    const note = await db.appendCustomRequestSuivi(1, { type: 'note', par: 'Rachel', texte: 'Rappeler mardi' }, { centerId: 'libramont' });
    const ordre = base.journal.map((j) => (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(j.sql) ? j.sql.toUpperCase() : j.sql.split(' ').slice(0, 2).join(' ')));
    const lecture = base.journal.find((j) => /^select payload/i.test(j.sql));
    base.journal.length = 0;
    const etranger = await leve(() => db.appendCustomRequestSuivi(2, { type: 'note', par: 'Rachel', texte: 'intrus' }, { centerId: 'libramont' }));
    const annule = base.journal.some((j) => /^ROLLBACK$/i.test(j.sql));
    const invalide = await leve(() => db.appendCustomRequestSuivi(1, { type: 'envoi' }, { centerId: 'libramont' }));
    const lu = await db.getCustomRequest(1, { centerId: 'libramont' });
    const luAilleurs = await leve(() => db.getCustomRequest(2, { centerId: 'libramont' }));
    return [
      [note && note.payload && note.payload.suivi && note.payload.suivi.notes[0].texte === 'Rappeler mardi' && note.payload.demande.participants === 31,
        'la note est ecrite dans le suivi, la demande du client intacte'],
      [JSON.stringify(ordre) === JSON.stringify(['BEGIN', 'select payload', 'update custom_requests', 'COMMIT']), 'une transaction : lecture, ecriture, validation', JSON.stringify(ordre)],
      [lecture && /for update/i.test(lecture.sql), 'la ligne est verrouillee le temps d ecrire : deux postes ne s ecrasent pas', lecture && lecture.sql],
      [lecture && lecture.params[1] === 'libramont' && !/libramont/.test(lecture.sql), 'le centre voyage en parametre, jamais dans le texte SQL'],
      [etranger && etranger.statusCode === 404 && etranger.expose === true && annule && JSON.stringify(base.lignes[1].payload) === '{}',
        'la demande d un autre centre : 404, transaction annulee, rien d ecrit'],
      [invalide && invalide.statusCode === 400 && base.lignes[0].payload.suivi.notes.length === 1, 'un evenement inconnu : 400, rien d ecrit'],
      [lu && lu.id === 1 && luAilleurs && luAilleurs.statusCode === 404, 'la lecture d une demande est bornee au centre'],
    ];
  } finally {
    if (ancienPg) require.cache[pgPath] = ancienPg; else delete require.cache[pgPath];
    if (ancienneDb) require.cache[dbPath] = ancienneDb; else delete require.cache[dbPath];
    if (env.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = env.url;
    if (env.ssl === undefined) delete process.env.DATABASE_SSL; else process.env.DATABASE_SSL = env.ssl;
  }
}

// ---------------------------------------------------------------------------
// [I] CONTRE-EPREUVES
// ---------------------------------------------------------------------------
const MUTATIONS = [
  { fichier: 'lib/demande-bureau.js', ancre: '    if (jourOuvre(date)) {', mute: '    if (true) {', label: 'sans le calendrier, le lundi ferme compte dans les 24 heures', verifier: verifierEcheance },
  { fichier: 'lib/demande-bureau.js', ancre: '    const dedans = heures.filter((t) => dansLaFenetre(t, jour.fenetre));', mute: '    const dedans = heures;', label: 'sans la plage du moment, un depart de 18:30 est propose pour l apres-midi', verifier: verifierEtude },
  { fichier: 'lib/demande-bureau.js', ancre: '  return !r || !r.json || r.status === 429 || Number(r.status) >= 500;', mute: '  return false;', label: 'sans la panne, un moteur sature se lit « impossible »', verifier: verifierEtude },
  { fichier: 'lib/demande-bureau.js', ancre: '  if (v && v.ok && v.proposition && !v.depasse) {', mute: '  if (v && v.ok && v.proposition) {', label: 'sans le garde du debord, le brouillon propose un programme qui ne tient pas', verifier: verifierDebord },
  { fichier: 'lib/demande-bureau.js', ancre: '    if (controle.ok) {', mute: '    if (true) {', label: 'sans les controles, le « 15 % » invente part chez le client', verifier: verifierReponse },
  { fichier: 'lib/demande-bureau.js', ancre: "    ...t.pourcents.filter((v) => !proche(f.pourcents, v)).map((v) => `${String(v).replace('.', ',')} %`),", mute: '', label: 'sans la comparaison par nature, le « 15 » de la date autorise « 15 % »', verifier: verifierReponse },
  { fichier: 'lib/demande-bureau.js', ancre: '  const mots = motsNonAncres(texte, sourceAutorisee);', mute: '  const mots = [];', label: 'sans les mots qui valent un prix, « gratuitement » passe', verifier: verifierReponse },
  { fichier: 'lib/demande-bureau.js', ancre: "  if (propre.communicationId && historique.some((x) => x && x.type === 'reponse' && Number(x.communicationId) === propre.communicationId)) return base;", mute: '', label: 'sans le garde du rejeu, un envoi rejoue se range deux fois dans le suivi', verifier: verifierSuivi },
  { fichier: 'lib/demande-bureau.js', ancre: "  else if (reponses.length && !messageClient) etape = 'en-attente';", mute: "  else if (reponses.length) etape = 'en-attente';", label: 'sans le retour, la reponse du client dort dans l attente', verifier: verifierSuivi },
  { fichier: 'lib/demande-bureau-centre.js', ancre: '? bureau.echeanceDeReponse(suivi.messageClient || item.createdAt, { jourOuvre: cal.jourOuvre })', mute: '? bureau.echeanceDeReponse(item.createdAt, { jourOuvre: cal.jourOuvre })', label: 'sans le mail du client, l echeance court depuis la vieille demande', verifier: verifierFile },
  { fichier: 'lib/database.js', ancre: `"select payload from custom_requests where id = $1 and ($2 = '' or center_id = $2) for update;",`, mute: '"select payload from custom_requests where id = $1 for update;",', label: 'sans le centre dans la lecture, une note s ecrit chez un autre centre', verifier: verifierSuiviEnBase },
  { fichier: 'lib/database.js', ancre: `"select payload from custom_requests where id = $1 and ($2 = '' or center_id = $2) for update;",`, mute: `"select payload from custom_requests where id = $1 and ($2 = '' or center_id = $2);",`, label: 'sans le verrou, deux postes qui ecrivent en meme temps s ecrasent', verifier: verifierSuiviEnBase },
];

async function contreEpreuves() {
  for (const m of MUTATIONS) {
    const chemin = path.join(ROOT, m.fichier);
    const original = fs.readFileSync(chemin, 'utf8');
    const compte = original.split(m.ancre).length - 1;
    if (!ok(compte === 1, `contre-epreuve montable : « ${m.ancre.trim().slice(0, 70)} » une seule fois dans ${m.fichier}`, `${compte} occurrence(s)`)) continue;
    let aRougi = false;
    try {
      fs.writeFileSync(chemin, original.split(m.ancre).join(m.mute));
      aRougi = rouge(await m.verifier(charger()));
    } catch (error) {
      aRougi = true;
    } finally {
      fs.writeFileSync(chemin, original);
      viderCache();
    }
    ok(aRougi, `${m.label} : ce gate ROUGIRAIT`);
    ok(fs.readFileSync(chemin, 'utf8') === original, `${m.fichier} restaure a l identique`);
  }
}

async function main() {
  const mods = charger();
  section('A. L ECHEANCE PROMISE AU CLIENT');
  rapporter(verifierEcheance(mods));
  rapporter(verifierJourOuvre(mods));
  section('B. L ETUDE DU MOTEUR');
  rapporter(await verifierEtude(mods));
  rapporter(await verifierDebord(mods));
  section('C. LA REPONSE DE L IA, CONTROLEE');
  rapporter(await verifierReponse(mods));
  section('D. LE SUIVI');
  rapporter(verifierSuivi(mods));
  section('E. LA FILE');
  rapporter(await verifierFile(mods));
  section('F. LE VRAI MOTEUR');
  rapporter(await verifierVraiMoteur(mods));
  section('G. AUCUN ENVOI, UN DROIT PAR ACTION');
  rapporter(verifierAucunEnvoi());
  section('H. LE CERVEAU DU CENTRE');
  rapporter(await verifierCerveau());
  section('J. LE SUIVI EN BASE');
  rapporter(await verifierSuiviEnBase());
  section('I. CONTRE-EPREUVES');
  await contreEpreuves();
  const final = charger();
  ok(!rouge(verifierSuivi(final)) && !rouge(await verifierReponse(final)), 'code restaure : les regles repondent de nouveau juste');
  console.log(`\n${echecs === 0 ? 'demande-bureau-check: ALL OK' : `demande-bureau-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
