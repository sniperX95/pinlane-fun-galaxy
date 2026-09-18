// L ECRITURE DES TEXTES QUI PARTENT CHEZ UN CLIENT.
//
// Movsar, 2026-09-18, rapportant le retour de Seb sur les mails generes :
//
//   « pas de on, nous / language plus professionnel, moins familier / reponse
//     moins robotisee, plus humaine / pas de promesse, pas de laisser
//     sous-entendu que c est bon / une reponse precise sera donnee dans les
//     24 h ouvrables / parler de modification de prix calcule apres une
//     modification de prix »
//
//   et l exemple mot pour mot : « rien a payer a l avance : ( le fait de mettre
//   souvent des ":" parrait pas humain ) le montant se regle sur place le jour
//   meme, ca sonne super IA, pas humain ».
//
// CE GATE JUGE LES MESSAGES REELLEMENT COMPOSES, pas des chaines sources. Un
// grep sur le fichier aurait rate les phrases assemblees a l execution
// (l ordre des activites, la phrase du laser, les lignes de formule) : ce sont
// justement celles que le client lit. Chaque message passe donc par son
// constructeur public, avec une vraie reservation.
//
// Les regles vivent dans lib/client-writing.js, et le prompt de l agent IA lit
// LE MEME fichier : le gate et l agent ne peuvent pas diverger.
//
// HORS PORTEE, ET C EST VOULU : les messages du STAFF. Le staff lit son mail
// debout entre deux groupes ; il a le droit d ecrire court et technique. Le
// bloc [5] verifie que ces messages existent toujours, pour qu on ne puisse pas
// rendre ce gate vert en transformant un mail client en mail staff.
//
// Lancement : node scripts/ecriture-client-check.js
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'lib/ops-communications.js');

let failures = 0;
function record(label, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` :: ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}
function section(titre) { console.log(`\n--- ${titre}`); }

function charger() {
  Object.keys(require.cache)
    .filter((cle) => cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`))
    .forEach((cle) => { delete require.cache[cle]; });
  return {
    comms: require(path.join(ROOT, 'lib/ops-communications.js')),
    ecriture: require(path.join(ROOT, 'lib/client-writing.js')),
  };
}

// --- LES RESERVATIONS D ESSAI ------------------------------------------------
// Des dossiers complets : sans opsPlan, la confirmation perd l ordre des
// activites, les lignes de formule et la phrase du laser, et le gate jugerait
// un texte plus court que celui qui part vraiment.

function bowling() {
  return {
    id: 101,
    centerId: 'libramont',
    type: 'bowling',
    name: 'Famille Martin',
    email: 'martin@example.org',
    date: '2026-10-10',
    startTime: '15:00',
    pax: 8,
    duration: 1.5,
    price: 96,
    label: 'Bowling',
    opsPlan: {
      arrivalMinutes: 10,
      timeline: [
        { type: 'activity', label: 'Bowling', activityId: 'bowling', resourceType: 'bowling_lane' },
        { type: 'activity', label: 'Arcade', activityId: 'arcade_time' },
      ],
      resourceBlocks: [{ resourceType: 'bowling_lane', startTime: '15:00', players: 8 }],
    },
  };
}

function formule() {
  return {
    id: 102,
    centerId: 'libramont',
    type: 'formule',
    formuleId: null,
    name: 'Anniversaire Lucie',
    email: 'lucie@example.org',
    date: '2026-10-11',
    startTime: '14:00',
    pax: 12,
    duration: 3,
    price: 240,
    label: 'FORMULE 4',
    opsPlan: {
      arrivalMinutes: 15,
      timeline: [
        { type: 'activity', label: 'Bowling', activityId: 'bowling', resourceType: 'bowling_lane' },
        { type: 'activity', label: 'Laser Game', activityId: 'laser_game', resourceType: 'laser_arena' },
        { type: 'activity', label: 'Minigolf Blacklight', activityId: 'minigolf_blacklight' },
        { type: 'activity', label: 'Arcade', activityId: 'arcade_time' },
      ],
      resourceBlocks: [
        { resourceType: 'bowling_lane', startTime: '14:00', players: 12 },
        { resourceType: 'laser_arena', startTime: '15:30', players: 12 },
        { resourceType: 'party_table', startTime: '14:00', players: 12 },
      ],
      laserPassPlan: { remainingGames: 2 },
    },
  };
}

function laserScinde() {
  return {
    id: 103,
    centerId: 'gembloux',
    type: 'laser',
    name: 'Groupe Ecole',
    email: 'ecole@example.org',
    date: '2026-10-12',
    startTime: '10:00',
    pax: 49,
    duration: 1.5,
    price: 490,
    label: 'Laser Game',
    opsPlan: {
      arrivalMinutes: 10,
      timeline: [{ type: 'activity', label: 'Laser Game', activityId: 'laser_game', resourceType: 'laser_arena' }],
      resourceBlocks: [{ resourceType: 'laser_arena', startTime: '10:00', players: 49, groupWaveCount: 3 }],
      laserSharing: {
        splitGroup: true, waveCount: 3, weaponCount: 20, requestedPlayers: 49, playersTotal: 49, mayShare: false, sharedNow: false,
      },
    },
  };
}

const RETARD = {
  delayMinutes: 20,
  previousStartTime: '15:00',
  proposedStartTime: '15:20',
  reason: 'un groupe precedent qui a pris du retard',
};

const CHANGEMENT = {
  shiftMinutes: 20,
  previousStartTime: '15:00',
  newStartTime: '15:20',
  laneChanged: true,
  newLanes: [5, 6],
  previousLanes: [1, 2],
  moves: [],
};

// --- L INVENTAIRE DES TEXTES CLIENTS -----------------------------------------
// Chaque entree : ce que le client lit, et dans quel etat il se trouve.
//   'confirme'    : le creneau est tenu.
//   'a-confirmer' : rien n est acquis, une reponse ferme reste due.
//   'changement'  : la reservation bouge, donc la question du montant se pose.

function proseDe(message) {
  // Ce que le client LIT en prose. Les cartes de details (« Date »,
  // « Participants ») sont des DONNEES : leurs deux-points sont legitimes et ne
  // se comptent pas. L eyebrow (« Reservation confirmee ») est un libelle de
  // deux mots, pas une phrase.
  return [message.subject, message.title, message.body, message.preheader, message.note]
    .filter(Boolean)
    .join('\n');
}

function inventaire(comms) {
  const mail = (reservation, templateId, channel = 'email') => comms.buildMessage({ reservation, templateId, channel });
  const textes = [];

  const ajouter = (nom, message, etat) => textes.push({ nom, texte: proseDe(message), etat, message });

  ajouter('confirmation, bowling', mail(bowling(), 'confirmation'), 'confirme');
  ajouter('confirmation, formule', mail(formule(), 'confirmation'), 'confirme');
  ajouter('confirmation, laser scinde', mail(laserScinde(), 'confirmation'), 'confirme');
  ajouter('accuse de reception', mail(bowling(), 'request_received'), 'a-confirmer');
  ajouter('rappel J-2, bowling', mail(bowling(), 'reminder_48h'), 'confirme');
  ajouter('rappel J-2, formule', mail(formule(), 'reminder_48h'), 'confirme');

  const retard = { ...bowling(), delayUpdate: RETARD, startTime: '15:20' };
  ajouter('decalage d horaire', mail(retard, 'delay_update'), 'changement');

  ajouter('SMS de rappel', mail(bowling(), 'reminder_day_sms', 'sms'), 'confirme');

  // LE MONTANT SE DIT DANS LE MAIL, PAS DANS LE SMS. Le SMS est un avis de
  // 160 caracteres qui previent ; le mail porte le detail, et c est lui qui
  // doit repondre a la question d argent. Forcer le montant dans le SMS le
  // rendrait moins lisible sans rien apprendre de plus au client.
  ajouter('changement de planning, mail',
    comms.buildDelayChangeMessage({ reservation: bowling(), change: CHANGEMENT, channel: 'email' }), 'changement');
  ajouter('changement de planning, SMS',
    comms.buildDelayChangeMessage({ reservation: bowling(), change: CHANGEMENT, channel: 'sms' }), 'confirme');

  // Les gabarits que le staff envoie a la main depuis une fiche reservation.
  const etatsGabarits = {
    confirmation: 'confirme',
    reminder: 'confirme',
    delay: 'changement',
    reschedule: 'changement',
    cancellation: 'changement',
    thanks: 'confirme',
    practical_info: 'confirme',
    promo: 'confirme',
    custom: 'confirme',
  };
  comms.__test.CLIENT_MESSAGE_TEMPLATES.forEach((gabarit) => {
    const etat = etatsGabarits[gabarit.id] || 'confirme';
    ajouter(`gabarit staff « ${gabarit.label} », mail`,
      comms.buildClientMessage({ reservation: bowling(), templateId: gabarit.id, channel: 'email' }), etat);
    ajouter(`gabarit staff « ${gabarit.label} », SMS`,
      comms.buildClientMessage({ reservation: bowling(), templateId: gabarit.id, channel: 'sms' }),
      etat === 'changement' ? 'confirme' : etat);
  });

  // Les sequences marketing automatiques.
  ajouter('anniversaire J-30',
    comms.buildBirthdayJ30Message({ name: 'Lucie Martin', partyDateFr: '12 octobre 2025', centerName: 'Fun Galaxy Libramont' }), 'confirme');
  ajouter('reactivation',
    comms.buildReactivationMessage({ name: 'Lucie Martin', centerName: 'Fun Galaxy Libramont' }), 'confirme');
  ajouter('merci post-visite, avec lien avis',
    comms.buildPostVisitMessage({ name: 'Lucie Martin', hasReviewLink: true, centerName: 'Fun Galaxy Libramont' }), 'confirme');
  ajouter('merci post-visite, sans lien avis',
    comms.buildPostVisitMessage({ name: 'Lucie Martin', hasReviewLink: false, centerName: 'Fun Galaxy Libramont' }), 'confirme');

  // L accuse d une demande sur mesure : le cas type ou rien ne peut etre
  // tranche tout de suite, donc celui qui doit annoncer les 24 h ouvrables.
  //
  // SANS le message du client. Cet accuse recopie la demande mot pour mot, et
  // ces mots-la sont ceux du CLIENT : lui reprocher son « nous » jugerait le
  // mauvais auteur. Le bloc [7] verifie separement que la citation est bien
  // recopiee telle quelle, pour que cette exclusion ne serve pas a cacher du
  // texte du centre a l interieur de guillemets.
  ajouter('accuse demande sur mesure',
    comms.buildCustomRequestAck({
      centerId: 'libramont',
      contactName: 'Julien Dupont',
      email: 'julien@example.org',
      occasion: 'entreprise',
      requestedDate: '2026-11-20',
      pax: 70,
      company: 'Acme',
    }), 'a-confirmer');

  return textes;
}

// --- LES BROUILLONS DE LA CONSOLE --------------------------------------------
// Les modeles pre-remplis que le gerant et le staff envoient depuis la console.
// Ils vivent dans les fichiers servis au navigateur, donc `require` ne peut pas
// les charger : le tableau litteral est EXTRAIT par son ancre puis EVALUE, ce
// qui donne les vraies chaines, fonctions de gabarit comprises. Un tableau
// renomme ou deplace fait echouer l extraction au lieu de vider le jugement.
function tableauLitteral(source, ancre) {
  const debut = source.indexOf(ancre);
  if (debut < 0) throw new Error(`ancre introuvable : ${ancre}`);
  const ouvrante = source.indexOf('[', debut);
  let profondeur = 0;
  let dansChaine = '';
  let echappe = false;
  for (let i = ouvrante; i < source.length; i += 1) {
    const c = source[i];
    if (dansChaine) {
      if (echappe) echappe = false;
      else if (c === '\\') echappe = true;
      else if (c === dansChaine) dansChaine = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { dansChaine = c; continue; }
    if (c === '[') profondeur += 1;
    else if (c === ']') {
      profondeur -= 1;
      if (profondeur === 0) {
        // eslint-disable-next-line no-eval
        return eval(`(${source.slice(ouvrante, i + 1)})`);
      }
    }
  }
  throw new Error(`tableau non termine : ${ancre}`);
}

const CTX_DEMANDE = { centre: 'Fun Galaxy Libramont', prenom: 'Julien', groupe: ' pour 70 personnes', quand: ' du 20 novembre' };

function brouillonsDeLaConsole() {
  const lire = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const textes = [];
  const valeur = (v, ctx) => (typeof v === 'function' ? v(ctx) : String(v || ''));

  tableauLitteral(lire('assets/app-main.js'), 'const STAFF_REQUEST_PRESETS = ').forEach((modele) => {
    textes.push({
      nom: `console, reponse a une demande « ${modele.label} »`,
      texte: `${valeur(modele.subject, CTX_DEMANDE)}\n${valeur(modele.body, CTX_DEMANDE)}`,
      // Le staff repond a une demande sur mesure : RIEN n est acquis tant que
      // le client n a pas dit oui, donc aucune promesse. Mais pas de delai
      // ferme a annoncer ici : ce brouillon EST la reponse, ecrite par un
      // humain qui a regarde le planning. Le delai est du a celui qui ne peut
      // PAS trancher (accuse automatique, agent IA bloque).
      etat: 'sans-promesse',
    });
  });

  [['assets/admin-mail.js', 'const MS_STARTERS = ', 'modele de campagne'],
    ['assets/staff-pages-v2.js', 'const PV2_STARTERS = ', 'modele de campagne']]
    .forEach(([rel, ancre, genre]) => {
      tableauLitteral(lire(rel), ancre).forEach((modele) => {
        textes.push({
          nom: `console, ${genre} « ${modele.name} » (${path.basename(rel)})`,
          texte: `${valeur(modele.subject)}\n${valeur(modele.body)}`,
          etat: 'confirme',
        });
      });
    });

  tableauLitteral(lire('assets/staff-pages-v2.js'), 'const PV2_RELANCES = ').forEach((modele) => {
    textes.push({
      nom: `console, relance de fiche client « ${modele.kind} »`,
      texte: `${valeur(modele.subject)}\n${valeur(modele.body, { firstName: 'Lucie', centreName: 'Fun Galaxy Libramont' })}`,
      etat: 'confirme',
    });
  });

  return textes;
}

function juger(ecriture, textes) {
  const fautifs = [];
  textes.forEach((entree) => {
    const ecarts = ecriture.verifierEcritureClient(entree.texte, { etat: entree.etat });
    if (ecarts.length) fautifs.push({ ...entree, ecarts });
  });
  return fautifs;
}

function main() {
  const { comms, ecriture } = charger();

  section('Montage : chaque texte client se compose vraiment');
  const brouillons = brouillonsDeLaConsole();
  record('les brouillons de la console sont extraits et evalues',
    brouillons.length >= 18, `${brouillons.length} modeles`);
  const textes = inventaire(comms).concat(brouillons);
  record('l inventaire couvre les textes clients', textes.length >= 30, `${textes.length} textes`);
  // « Message vierge » est VIDE PAR CONSTRUCTION : c est la feuille blanche que
  // le staff remplit lui-meme. Elle est nommee ici, pas filtree par un seuil,
  // pour qu un autre texte qui se viderait un jour ressorte quand meme.
  const vides = textes.filter((t) => !t.nom.startsWith('gabarit staff « Message vierge »')
    && String(t.texte || '').trim().length < 30);
  record('aucun texte vide ou tronque (sinon le gate jugerait du silence)',
    vides.length === 0, vides.map((t) => t.nom).join(', '));

  section('[1] Ce que le client lit respecte les regles d ecriture');
  const fautifs = juger(ecriture, textes);
  fautifs.forEach((entree) => {
    entree.ecarts.forEach((ecart) => {
      console.log(`     · ${entree.nom} [${ecart.regle}] ${ecart.quoi}`);
      if (ecart.extrait) console.log(`       « ${ecart.extrait} »`);
      if (ecart.remede) console.log(`       remede : ${ecart.remede}`);
    });
  });
  record('aucun ecart d ecriture sur les textes clients',
    fautifs.length === 0,
    `${fautifs.length} texte(s) fautif(s) sur ${textes.length}`);

  section('[2] Une demande non tranchee annonce un delai ferme');
  [['accuse de reception', comms.buildMessage({ reservation: bowling(), templateId: 'request_received', channel: 'email' })],
    ['accuse demande sur mesure', comms.buildCustomRequestAck({ contactName: 'Julien', email: 'j@example.org' })]]
    .forEach(([nom, message]) => {
      const texte = proseDe(message);
      record(`${nom} : « ${ecriture.DELAI_REPONSE} » est ecrit`, ecriture.MOTIF_DELAI.test(texte));
      record(`${nom} : et rien n y est annonce comme confirme`,
        !/est confirmée?\b|c[’']est (bon|confirmé)/i.test(texte));
    });

  section('[3] Un changement dit ce qu il advient du montant');
  [['decalage d horaire', comms.buildMessage({ reservation: { ...bowling(), delayUpdate: RETARD }, templateId: 'delay_update', channel: 'email' })],
    ['changement de planning', comms.buildDelayChangeMessage({ reservation: bowling(), change: CHANGEMENT, channel: 'email' })]]
    .forEach(([nom, message]) => {
      record(`${nom} : le montant est nomme`, ecriture.MOTIF_MONTANT.test(proseDe(message)), '');
    });

  section('[4] Le tic des deux-points a disparu de la prose');
  ['confirmation', 'reminder_48h', 'request_received'].forEach((templateId) => {
    [['bowling', bowling()], ['formule', formule()], ['laser scinde', laserScinde()]].forEach(([quoi, reservation]) => {
      const corps = String(comms.buildMessage({ reservation, templateId, channel: 'email' }).body || '');
      const lignes = corps.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > ecriture.LIGNE_DE_PROSE);
      const compte = lignes.reduce((total, ligne) => total + (ligne.match(/\s:\s/g) || []).length, 0);
      record(`${templateId} / ${quoi} : au plus ${ecriture.DEUX_POINTS_MAX} « ... : ... »`,
        compte <= ecriture.DEUX_POINTS_MAX, `${compte}`);
    });
  });

  section('[5] Les messages STAFF existent toujours, et restent hors portee');
  // Sans ce bloc, on pourrait rendre le gate vert en faisant passer un mail
  // client pour un mail staff : le texte disparaitrait du jugement au lieu
  // d etre corrige.
  ['staff_review_request', 'staff_alert', 'delay_staff_attention'].forEach((templateId) => {
    const message = comms.buildMessage({
      reservation: { ...bowling(), delayUpdate: { ...RETARD, nextAction: 'Prevenir le groupe suivant.' } },
      templateId,
      channel: 'email',
    });
    record(`${templateId} se compose et vise le staff`,
      String(message.body || '').length > 40 && /cockpit|staff|equipe|terrain|valider|trancher/i.test(`${message.body} ${message.action?.label || ''} ${message.eyebrow || ''}`),
      String(message.subject || '').slice(0, 70));
  });

  section('[6] L agent IA recoit LES MEMES regles, derivees du meme fichier');
  const consignes = ecriture.consignesPourLAgent();
  record('les consignes nomment le pronom « on »', /« on »/.test(consignes));
  record('les consignes nomment le delai ferme', consignes.includes(ecriture.DELAI_REPONSE));
  record('les consignes nomment le montant recalcule', /montant recalcule/i.test(consignes));
  record('les consignes nomment le tic des deux-points', /« \.\.\. : \.\.\. »/.test(consignes));
  const agent = fs.readFileSync(path.join(ROOT, 'lib/email-agent.js'), 'utf8');
  record('et l agent email les injecte dans son prompt',
    /consignesPourLAgent\(\)/.test(agent) && /require\(['"]\.\/client-writing['"]\)/.test(agent));

  section('[7] Les mots du CLIENT sont recopies, et restent les siens');
  // L accuse sur mesure cite la demande mot pour mot. Cette citation est
  // exclue du jugement (le centre n ecrit pas a la place du client) : ce bloc
  // verifie donc qu elle est bien une CITATION, recopiee telle quelle, et pas
  // une porte ouverte pour glisser du texte du centre entre guillemets.
  const motsDuClient = 'Nous cherchons une privatisation pour 70 personnes.';
  const avecCitation = comms.buildCustomRequestAck({
    centerId: 'libramont', contactName: 'Julien', email: 'j@example.org', message: motsDuClient,
  });
  record('la demande du client est recopiee mot pour mot', String(avecCitation.body).includes(motsDuClient));
  const sansCitation = comms.buildCustomRequestAck({ centerId: 'libramont', contactName: 'Julien', email: 'j@example.org' });
  const ajoute = String(avecCitation.body).replace(String(sansCitation.body).split('\n')[0], '').length
    - String(sansCitation.body).length;
  record('et la citation n ajoute QUE ces mots-la (rien du centre ne s y cache)',
    ajoute <= motsDuClient.length + 40, `${ajoute} caracteres ajoutes pour ${motsDuClient.length} cites`);
  record('la version sans citation reste irreprochable',
    ecriture.verifierEcritureClient(proseDe(sansCitation), { etat: 'a-confirmer' }).length === 0);

  section('Contre-epreuve par mutation : ce gate sait-il rougir ?');
  const original = fs.readFileSync(SOURCE, 'utf8');
  // On REMET dans la source la phrase que Seb a montree du doigt, exactement la
  // ou elle vivait : le corps de la confirmation. Le gate doit alors rougir sur
  // le message COMPOSE, pas sur une chaine qu on lui tend.
  //
  // LA MUTATION REMET L ANCIEN TEXTE EN ENTIER, pas une ligne. Une seule ligne
  // ne ramenait qu UN deux-points, et un seul est permis : la regle serait
  // restee muette, et on aurait conclu qu elle ne mord pas. Le retour en
  // arriere qu on veut simuler, c est celui du mail complet.
  const retours = [
    [
      `"Le montant se règle sur place le jour même, aucun paiement n'est demandé à l'avance.",`,
      `"Rien à payer d'avance : le montant se règle sur place le jour même.",\n      "Il ne vous reste plus qu'à venir.",`,
    ],
    [
      '`Votre réservation est confirmée chez ${center.name}, à votre nom.`,',
      "`C'est officiel : votre réservation est confirmée chez ${center.name}, à votre nom.`,",
    ],
  ];
  try {
    const fdl = original.includes('\r\n') ? '\r\n' : '\n';
    let mutant = original;
    retours.forEach(([ancre, ancien]) => {
      if (mutant.split(ancre).length - 1 !== 1) throw new Error(`ancre introuvable : ${ancre.slice(0, 50)}`);
      mutant = mutant.split(ancre).join(ancien.split('\n').join(fdl));
    });
    fs.writeFileSync(SOURCE, mutant);

    const mute = charger();
    const regresse = proseDe(mute.comms.buildMessage({
      reservation: bowling(), templateId: 'confirmation', channel: 'email',
    }));
    record('la mutation est bien en place dans le message compose',
      /Rien à payer/.test(regresse) && /Il ne vous reste plus qu/.test(regresse) && /C'est officiel/.test(regresse));

    const ecarts = mute.ecriture.verifierEcritureClient(regresse, { etat: 'confirme' });
    const regles = new Set(ecarts.map((e) => e.regle));
    record('le juge voit les tournures familieres revenues', regles.has('familier'),
      ecarts.filter((e) => e.regle === 'familier').map((e) => e.quoi).join(', '));
    record('le juge voit le tic des deux-points revenu', regles.has('deux-points'),
      ecarts.filter((e) => e.regle === 'deux-points').map((e) => e.quoi).join(', '));
    record('DONC UN RETOUR A L ANCIEN TEXTE RENDRAIT CE GATE ROUGE', ecarts.length >= 3, `${ecarts.length} ecarts`);

    // Et l inverse : une promesse dans un message que rien ne confirme.
    const promesse = 'Bonjour Julien,\nVotre demande est bien reçue, votre créneau est bloqué et votre réservation est confirmée.';
    const surPromesse = mute.ecriture.verifierEcritureClient(promesse, { etat: 'a-confirmer' });
    record('une promesse dans un accuse de reception est vue',
      surPromesse.some((e) => e.regle === 'promesse') && surPromesse.some((e) => e.regle === 'delai'),
      surPromesse.map((e) => e.regle).join(', '));
  } catch (error) {
    record('contre-epreuve montable', false, error.message);
  } finally {
    fs.writeFileSync(SOURCE, original);
  }
  record('ops-communications.js restaure a l identique', fs.readFileSync(SOURCE, 'utf8') === original);

  console.log(`\n${failures === 0 ? 'ECRITURE CLIENT OK' : `ECRITURE CLIENT : ${failures} echec(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
