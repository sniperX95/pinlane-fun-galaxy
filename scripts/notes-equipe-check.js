// LES NOTES DE L EQUIPE ET LE MOT DU CLIENT (2026-10-01).
//
// Movsar : « j ai fait une reservation en mettant une note et rien ne s est
// affiche » puis « mets une option pour ajouter une note cote staff, une note
// du staff en interne, visible en bien ». La colonne `notes` porte desormais
// trois choses : le mot ecrit avec la reservation (le client en ligne, le
// comptoir au telephone), les traces du moteur (`[ops:...]`, retard,
// decalage) et les notes de l equipe (`[equipe] {"t","par","le"}`).
//
// Ce gate prouve, sans navigateur ni base :
//   [A] le serveur et la console lisent la MEME ligne d equipe (meme marqueur,
//       meme forme) ;
//   [B] le mot du client ne contient jamais une note d equipe ni une trace du
//       moteur ;
//   [C] la fiche montre le mot du client en grand, les notes de l equipe, et
//       le champ pour en ajouter une ; la carte porte la plus recente. Le texte
//       d une note se lit seul, aucun nom colle apres ; qui l a ecrite et quand
//       se lisent dans sa bulle (2026-11-18, Marius, manager de Gembloux :
//       « enlève le truc juste après, staff bar gembloux ») ;
//   [D] le serveur prend l auteur dans la SESSION, jamais dans le corps, et
//       la note s ecrit sous verrou (select ... for update) ;
//   [E] le nom Bowling / Laser Game de la fiche mene au planning de la
//       ressource, sans cocher l activite.
// Contre-epreuve : node scripts/notes-equipe-check.js --mutate rejoue le
// gate sur des sources degradees ; chaque mutation doit le faire rougir.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCES = {
  app: fs.readFileSync(path.join(ROOT, 'assets', 'app-main.js'), 'utf8'),
  core: fs.readFileSync(path.join(ROOT, 'assets', 'booking-core.js'), 'utf8'),
  db: fs.readFileSync(path.join(ROOT, 'lib', 'database.js'), 'utf8'),
  api: fs.readFileSync(path.join(ROOT, 'api', 'staff-reservations.js'), 'utf8'),
};
// Les sources Windows et leurs contre-épreuves gardent la même forme logique.
Object.keys(SOURCES).forEach((key) => { SOURCES[key] = SOURCES[key].replace(/\r\n/g, '\n'); });

// Une fonction du source, accolades comptees (les gabarits ${...} sont
// equilibres).
function extraire(src, nom) {
  const debut = src.indexOf(`function ${nom}(`);
  if (debut < 0) throw new Error(`fonction absente : ${nom}`);
  let i = src.indexOf('{', src.indexOf(')', debut));
  let profondeur = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') profondeur += 1;
    else if (src[i] === '}') { profondeur -= 1; if (profondeur === 0) break; }
  }
  return src.slice(debut, i + 1);
}
function constante(src, nom) {
  const m = src.match(new RegExp(`const ${nom} = [^;]+;`));
  if (!m) throw new Error(`constante absente : ${nom}`);
  return m[0];
}

function verifier(sources) {
  const resultats = [];
  const c = (ok, nom, detail = '') => resultats.push({ ok: Boolean(ok), nom, detail });
  let cote;
  let bacCote;
  try {
    const code = [
      constante(sources.app, 'NOTE_EQUIPE_TAG'),
      // « Note pour l’équipe » vit dans la rangee des gestes de la fiche
      // (2026-11-14) : son bouton et les droits qu il partage avec les notes.
      constante(sources.app, 'FICHE_ICONE_NOTE'),
      'const notesEquipeBrouillons = new Map();',
      'const notesEquipeOuvertes = new Set();',
      ...['lireNoteEquipeLigne', 'getReservationNotesEquipe', 'getReservationNoteText', 'getReservationNoteParts',
        'hasReservationNote', 'getReservationDelayFlag', 'retardPousseDe', 'getReservationNoteTitre', 'formatNoteEquipeQuand', 'quandNoteEnPhrase', 'bulleAuteurNote', 'ficheDroitsNotes', 'renderNoteEquipeBouton', 'renderGroupeNotes', 'getReservationValidationTexte', 'nomDeLaFormuleAchetee', 'getGroupeEncadres', 'renderGroupeEncadres',
        // La carte lit les notes ecrites par l equipe et la derniere modification
        // (2026-11-03) ; sans le planning, la regle de repli de notesEquipeEcrites.
        'notesEquipeEcrites', 'essentielDuDossier', 'texteDerniereModif', 'quandDerniereModif'].map((n) => extraire(sources.app, n)),
      // L encadre de la carte nomme la formule avec la variante achetee
      // (nomDeLaFormuleAchetee) : booking-core la lit dans le plan du dossier.
      extraire(sources.core, 'getReservationFormulaChoice'),
    ].join('\n');
    const bac = {
      window: {},
      escapeHtml: (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      escapeJsString: (v) => String(v ?? ''),
      canUseStaffPermission: () => true,
      isReservationAwaitingReview: () => false,
      renderReservationPriceMark: () => '',
      resolveDisplayFormule: () => null,
      getReservationLabel: () => '',
      getReservationOccasion: () => '',
      STAFF_OCCASION_LABELS: {},
      Map, Date, JSON, String, Number, Array, Math,
    };
    vm.createContext(bac);
    bacCote = bac;
    vm.runInContext(`${code}\nthis.api = { NOTE_EQUIPE_TAG, lireNoteEquipeLigne, getReservationNotesEquipe, getReservationNoteText, getReservationNoteParts, hasReservationNote, renderGroupeNotes, renderNoteEquipeBouton, getGroupeEncadres, renderGroupeEncadres };`, bac);
    cote = bac.api;
  } catch (e) {
    c(false, '[0] les fonctions des notes se chargent', e.message);
    return resultats;
  }
  let serveur;
  try {
    const bac = { JSON, String };
    vm.createContext(bac);
    vm.runInContext(`${constante(sources.db, 'NOTE_EQUIPE_TAG')}\n${extraire(sources.db, 'lireNoteEquipe')}\nthis.api = { NOTE_EQUIPE_TAG, lireNoteEquipe };`, bac);
    serveur = bac.api;
  } catch (e) {
    c(false, '[0] la lecture serveur se charge', e.message);
    return resultats;
  }

  // [A] UNE SEULE FORME
  const ligne = '[equipe] {"t":"Client fidèle, offrir une boisson","par":"Léa","le":"2026-10-01T19:00:00.000Z"}';
  c(cote.NOTE_EQUIPE_TAG === serveur.NOTE_EQUIPE_TAG, '[A] la console et le serveur ont le meme marqueur', `${JSON.stringify(cote.NOTE_EQUIPE_TAG)} / ${JSON.stringify(serveur.NOTE_EQUIPE_TAG)}`);
  const lu = cote.lireNoteEquipeLigne(ligne);
  const luServeur = serveur.lireNoteEquipe(ligne);
  c(lu && luServeur && lu.t === luServeur.t && lu.par === 'Léa', '[A] la ligne ecrite par le serveur se lit pareil des deux cotes');
  c(!cote.lireNoteEquipeLigne('[equipe] pas du json') && !cote.lireNoteEquipeLigne('Note : [equipe] {"t":"x"}'), '[A] une ligne mal formee ou un texte client qui cite le marqueur n est pas une note d equipe');

  // [B] LE MOT DU CLIENT RESTE LE SIEN
  const dossier = {
    id: 7, channel: 'public', status: 'confirmed',
    notes: ['Gâteau à mettre au frais', '[ops:retard] Retard signalé 10 min', ligne,
      '[equipe] {"t":"Table près de la fenêtre","par":"Sam","le":"2026-10-01T19:05:00.000Z"}'].join('\n'),
  };
  const parts = cote.getReservationNoteParts(dossier);
  c(parts.mot === 'Gâteau à mettre au frais', '[B] le mot du client ne contient ni note d equipe ni trace du moteur', JSON.stringify(parts.mot));
  c(parts.suivi.length === 1 && parts.suivi[0] === 'Retard signalé 10 min', '[B] la trace du moteur se lit a part, sans son marqueur', JSON.stringify(parts.suivi));
  c(!/\[equipe\]|"par"/.test(cote.getReservationNoteText(dossier)), '[B] le texte de note des autres ecrans ne montre jamais une note d equipe brute', JSON.stringify(cote.getReservationNoteText(dossier)));
  c(cote.getReservationNotesEquipe(dossier).map((n) => n.t).join(' | ') === 'Client fidèle, offrir une boisson | Table près de la fenêtre', '[B] les notes de l equipe se lisent dans l ordre ecrit');
  c(cote.hasReservationNote({ notes: ligne }) && !cote.hasReservationNote({ notes: '' }), '[B] « Avec note » compte un dossier qui n a qu une note d equipe');

  // [C] LA FICHE ET LA CARTE
  const fiche = cote.renderGroupeNotes(dossier);
  c(/class="gc-note-client"[\s\S]*Mot du client[\s\S]*Gâteau à mettre au frais/.test(fiche), '[C] la fiche montre le mot du client sous son titre');
  // LE TEXTE D UNE NOTE SE LIT SEUL (2026-11-18, Marius : « on ne voit pas bien ce qui est
  // marqué en plus ») : chaque note de la fiche, son paragraphe et sa bulle.
  const notesDe = (html) => Array.from(html.matchAll(/<li class="gc-note-equipe">\s*<p(?: title="([^"]*)")?>([\s\S]*?)<\/p>/g)).map((m) => ({ bulle: m[1] || '', texte: m[2] }));
  const lues = notesDe(fiche);
  c(lues.length === 2 && lues[0].texte === 'Client fidèle, offrir une boisson' && lues[1].texte === 'Table près de la fenêtre', '[C] le texte de chaque note d equipe se lit seul, aucun nom colle apres', JSON.stringify(lues));
  c(lues.length === 2 && lues[0].bulle === 'Écrite par Léa le 01/10 à 21:00' && lues[1].bulle === 'Écrite par Sam le 01/10 à 21:05', '[C] la bulle de chaque note dit qui l a ecrite et quand, en une phrase', JSON.stringify(lues));
  const reecrite = notesDe(cote.renderGroupeNotes({ id: 15, channel: 'staff', status: 'confirmed', notes: '[equipe] {"t":"Table près de la fenêtre","par":"Sam","le":"2026-10-01T19:05:00.000Z","modifieLe":"2026-10-01T19:20:00.000Z","modifiePar":"Léa"}' }));
  c(reecrite.length === 1 && reecrite[0].texte === 'Table près de la fenêtre' && reecrite[0].bulle === 'Écrite par Sam le 01/10 à 21:05, modifiée le 01/10 à 21:20 par Léa', '[C] une note reecrite : sa bulle dit aussi quand et par qui', JSON.stringify(reecrite));
  // Le fondateur ne signe rien chez un centre (2026-11-13, lib/fondateur-invisible.js) : sa note dit « l’équipe ».
  const sansSignature = cote.renderGroupeNotes({ id: 14, channel: 'staff', status: 'confirmed', notes: '[equipe] {"t":"Prévenir le client","par":"","le":"2026-10-01T19:10:00.000Z"}' });
  const anonyme = notesDe(sansSignature);
  c(anonyme.length === 1 && anonyme[0].texte === 'Prévenir le client' && anonyme[0].bulle === 'Écrite par l’équipe le 01/10 à 21:10', '[C] une note signee par personne dit « l’équipe » dans sa bulle', sansSignature.slice(0, 240));
  // Le bouton est dans les gestes de l en-tete (2026-11-15) : les notes
  // repliees ne portent ni champ ni bouton. Son libelle est coupe par un
  // span.fz-long cache selon la largeur, on lit donc son texte.
  const boutonNote = cote.renderNoteEquipeBouton(dossier);
  c(/onclick="ouvrirNoteEquipe\(7, event\)"[^>]*>[\s\S]*<\/button>$/.test(boutonNote) && boutonNote.replace(/<[^>]*>/g, '') === 'Note pour l’équipe' && !/<textarea|ouvrirNoteEquipe/.test(fiche), '[C] champ replie : « Note pour l’équipe » est un bouton de la rangee des gestes, les notes ne portent ni champ ni bouton', boutonNote.slice(0, 160));
  vm.runInContext('notesEquipeOuvertes.add(7)', bacCote);
  const ouverte = cote.renderGroupeNotes(dossier);
  c(/<textarea id="gcNoteEquipe7"[^>]*placeholder="Note pour l’équipe : le client ne la voit pas"/.test(ouverte) && /onclick="ajouterNoteEquipe\(7, event\)"/.test(ouverte), '[C] ouvert, le champ et le bouton pour ajouter la note');
  // L ecran suit le serveur (lib/droits-reservation.js, exigerRetraitDeNote) : un
  // role qui ne modifie pas ajoute une note, il ne reecrit pas celles du dossier.
  bacCote.canUseStaffPermission = (droit) => droit !== 'reservations.edit';
  const sansEdit = cote.renderGroupeNotes(dossier);
  bacCote.canUseStaffPermission = () => true;
  const reecrire = /aria-label="(?:Modifier|Retirer) la note/;
  const lectureSansEdit = { avecLeDroit: reecrire.test(ouverte), sansLeDroit: reecrire.test(sansEdit), ajouter: /onclick="ajouterNoteEquipe\(7, event\)"/.test(sansEdit) };
  c(lectureSansEdit.avecLeDroit && !lectureSansEdit.sansLeDroit && lectureSansEdit.ajouter, '[C] sans reservations.edit : ajouter reste, ni Modifier ni Retirer', JSON.stringify(lectureSansEdit));
  c(cote.renderGroupeNotes({ id: 9, channel: 'public', status: 'confirmed', notes: '' }) === '', '[C] une fiche sans note ni champ ouvert ne porte rien, ni titre ni texte vide');
  c(!/\[equipe\]|\[ops:/.test(fiche), '[C] aucun marqueur interne ne s affiche');
  const comptoir = cote.renderGroupeNotes({ id: 8, channel: 'staff', status: 'confirmed', notes: 'Paie en deux fois' });
  c(/class="gc-note-titre">Note<\/b>/.test(comptoir) && !/Mot du client/.test(comptoir), '[C] un dossier pris au comptoir ne dit pas « Mot du client »');
  const encadres = cote.getGroupeEncadres(dossier);
  const equipe = encadres.find((e) => e.ton === 'equipe');
  c(equipe && equipe.titre === 'Note équipe · 2' && equipe.texte === 'Table près de la fenêtre' && equipe.bulle === 'Écrite par Sam le 01/10 à 21:05', '[C] la carte porte la note la plus recente, seule, et le nombre de notes ; qui l a ecrite dans sa bulle', JSON.stringify(equipe));
  const carteHtml = cote.renderGroupeEncadres(dossier);
  c(/<div class="gc-flag tone-equipe" title="Note équipe · 2 : Table près de la fenêtre\nÉcrite par Sam le 01\/10 à 21:05">/.test(carteHtml) && /<span>Table près de la fenêtre<\/span>/.test(carteHtml), '[C] sur la carte, la note se lit seule et sa bulle dit qui l a ecrite', carteHtml.slice(0, 400));
  c(encadres.some((e) => e.ton === 'note' && e.titre === 'Mot du client' && e.texte === 'Gâteau à mettre au frais'), '[C] la carte porte le mot du client, titre compris');
  // LES TRACES DU SERVEUR NE SONT PAS DES NOTES (2026-11-03) : la raison d un prix revu et
  // le compte a l arrivee s ecrivent en note d equipe, mais la carte et « Avec note » ne
  // comptent que ce que l equipe a ecrit.
  const tracePrix = '[equipe] {"t":"Prix 60 € → 40 €, geste commercial","par":"Julie","le":"2026-10-01T19:10:00.000Z","type":"prix","prix":{"de":60,"a":40,"raison":"geste commercial"}}';
  const traceCompte = '[equipe] {"t":"Compte à l’arrivée : 10 → 12","par":"Julie","le":"2026-10-01T19:11:00.000Z","compte":{"de":10,"a":12}}';
  const avecTraces = { id: 11, channel: 'staff', status: 'confirmed', notes: [ligne, tracePrix, traceCompte].join('\n') };
  const equipeTraces = cote.getGroupeEncadres(avecTraces).find((e) => e.ton === 'equipe');
  c(equipeTraces && equipeTraces.titre === 'Note équipe' && equipeTraces.texte === 'Client fidèle, offrir une boisson' && /^Écrite par Léa /.test(equipeTraces.bulle || ''), '[C] la carte ne compte ni la raison d un prix ni le compte a l arrivee', JSON.stringify(equipeTraces));
  const seulementPrix = { id: 12, channel: 'staff', status: 'confirmed', notes: tracePrix };
  c(!cote.hasReservationNote(seulementPrix) && !cote.getGroupeEncadres(seulementPrix).some((e) => e.ton === 'equipe'), '[C] un dossier qui n a qu une raison de prix n est pas « Avec note »');
  const modifie = { id: 13, channel: 'staff', status: 'confirmed', notes: '', opsPlan: { derniereModif: { le: '2026-10-01T13:10:00.000Z', par: 'Rachel', quoi: ['4 → 6 joueurs'] } } };
  const encadreModif = cote.getGroupeEncadres(modifie).find((e) => e.ton === 'modif');
  c(encadreModif && encadreModif.titre === 'Modifié' && /Rachel : 4 → 6 joueurs$/.test(encadreModif.texte), '[C] la carte dit qui a change quoi en dernier', JSON.stringify(encadreModif));

  // [D] LE SERVEUR
  const route = (sources.api.match(/if \(patchIsNoteEquipeOnly\(body\)\) \{[\s\S]*?\n      \}\n/) || [''])[0];
  c(Boolean(route), '[D] le PATCH a une route dediee aux notes d equipe');
  // (nomDeSession, lib/droits-reservation.js : le nom du membre de session, et rien pour le fondateur, 2026-11-13)
  c(/par: nomDeSession\(session\)/.test(route) && !/geste\.par|body\.par/.test(route), '[D] l auteur vient de la session, jamais du corps de la requete');
  c(/writeAuditLog\(/.test(route), '[D] ajouter ou retirer une note est journalise');
  const ecriture = extraire(sources.db, 'noterReservationEquipe');
  c(/for update/.test(ecriture) && /withTransaction/.test(ecriture), '[D] la note s ecrit sous verrou, sur ce qui est en base');
  c(/'notes', 'activityProgress', 'activity_progress', 'activityToggle', 'noteEquipe'\]/.test(sources.api), '[D] noter un dossier demande la meme permission que changer son etat');

  // [E] DU PROGRAMME AU PLANNING
  const etapes = extraire(sources.app, 'renderGroupeEtapes');
  c(/etape\.activityId === 'bowling' \? 'bowling' : etape\.activityId === 'laser_game' \? 'laser'/.test(etapes) && /voirAuPlanning\(/.test(etapes), '[E] Bowling et Laser Game menent a leur planning');
  c(/if \(!options\.coches \|\| !ressource\)/.test(etapes), '[E] le lien n existe que dans la fiche (la carte coche au toucher)');
  const voir = extraire(sources.app, 'voirAuPlanning');
  c(/ev\.stopPropagation\(\)/.test(voir), '[E] suivre le lien ne coche pas l activite de la ligne');
  c(/openStaffPlanningResource\(cible\)/.test(voir) && /montrerAuPlanning\(/.test(voir), '[E] le planning s ouvre et le groupe y est montre');
  // Le planning Laser (maquette E) : chaque groupe d un depart, du prochain
  // depart et de la file porte ses attributs par lpAttrsGroupe ; un groupe
  // deja joue sort du pli avant d etre montre (planning-laser-check [M] le
  // prouve dans le navigateur).
  const montrer = extraire(sources.app, 'montrerAuPlanning');
  const attrs = extraire(sources.app, 'lpAttrsGroupe');
  c(/data-laser-res-id/.test(montrer) && /data-booking-res-id/.test(montrer) && /data-laser-res-id="\$\{id\}"/.test(attrs)
    && /class="lp-g \$\{k\}[^"]*" \$\{lpAttrsGroupe\(id, unitKey/.test(sources.app) && /lpRevelerGroupe\(r\.id\)/.test(voir), '[E] les blocs des deux plannings portent le numero du dossier');
  return resultats;
}

const MUTATIONS = [
  { nom: 'le mot du client garde les notes d equipe', cible: 'app', de: ".filter(ligne => !lireNoteEquipeLigne(ligne))\n    .join('\\n')", vers: ".join('\\n')" },
  { nom: 'les traces du moteur restent dans le mot du client', cible: 'app', de: "mot: lignes.filter(ligne => !/^\\s*\\[ops:/.test(ligne))", vers: 'mot: lignes.filter(ligne => true)' },
  { nom: 'le serveur prend l auteur dans le corps', cible: 'api', de: 'par: nomDeSession(session),', vers: "par: geste.par || 'Équipe'," },
  { nom: 'la note s ecrit sans verrou', cible: 'db', de: "select * from reservations where id = $1 and center_id = $2 for update;", vers: 'select * from reservations where id = $1 and center_id = $2;' },
  { nom: 'une note signee par personne ne dit plus l equipe', cible: 'app', de: "${verbe} par ${n.par || 'l’équipe'}", vers: '${verbe} par ${n.par}' },
  { nom: 'la bulle de la note perd son auteur', cible: 'app', de: '<p title="${escapeHtml(bulleAuteurNote(n))}">${escapeHtml(n.t)}</p>', vers: '<p>${escapeHtml(n.t)}</p>' },
  { nom: 'le nom revient apres le texte de la note', cible: 'app', de: '<p title="${escapeHtml(bulleAuteurNote(n))}">${escapeHtml(n.t)}</p>', vers: '<p title="${escapeHtml(bulleAuteurNote(n))}">${escapeHtml(n.t)} <span class="gc-note-meta">${escapeHtml(n.par || \'L’équipe\')}</span></p>' },
  { nom: 'la bulle oublie la modification', cible: 'app', de: "${modifiee ? `, ${modifiee}` : ''}", vers: '' },
  { nom: 'la carte recolle le nom apres la note', cible: 'app', de: '      texte: derniere.t,\n', vers: '      texte: `${derniere.t} (${derniere.par})`,\n' },
  { nom: 'la bulle de la carte perd son auteur', cible: 'app', de: '      bulle: bulleAuteurNote(derniere),\n', vers: '' },
  { nom: 'le lien du planning coche aussi la ligne', cible: 'app', de: "function voirAuPlanning(reservationId, ressource, ev) {\n  if (ev) ev.stopPropagation();", vers: 'function voirAuPlanning(reservationId, ressource, ev) {' },
  { nom: 'le serveur change de marqueur', cible: 'db', de: "const NOTE_EQUIPE_TAG = '[equipe] ';", vers: "const NOTE_EQUIPE_TAG = '[staff] ';" },
  { nom: 'retirer une note montre sans le droit', cible: 'app', de: "    peutReecrire: peutNoter && (typeof canUseStaffPermission !== 'function' || canUseStaffPermission('reservations.edit')),", vers: '    peutReecrire: peutNoter,' },
  { nom: 'la carte compte les traces du serveur', cible: 'app', de: 'const notesEquipe = aUneNote ? notesEquipeEcrites(r) : [];', vers: 'const notesEquipe = aUneNote ? getReservationNotesEquipe(r) : [];' },
  { nom: '« Avec note » compte une raison de prix', cible: 'app', de: 'notesEquipeEcrites(reservation).length > 0', vers: 'getReservationNotesEquipe(reservation).length > 0' },
  { nom: 'la regle de repli garde les traces', cible: 'app', de: '.filter(n => !n.compte && n.type !== \'prix\')', vers: '.filter(n => true)' },
  { nom: 'la carte ne dit plus qui a modifie', cible: 'app', de: "if (modif) encadres.push({ ton: 'modif', titre: 'Modifié',", vers: "if (false) encadres.push({ ton: 'modif', titre: 'Modifié'," },
];

function afficher(resultats) {
  resultats.forEach((r) => console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.nom}${r.detail ? `  ${r.detail}` : ''}`));
  return resultats.filter((r) => !r.ok).length;
}

if (process.argv.includes('--mutate')) {
  let survivantes = 0;
  MUTATIONS.forEach((m) => {
    if (!SOURCES[m.cible].includes(m.de)) { console.log(`DESARMEE  ${m.nom} (ancre introuvable)`); survivantes += 1; return; }
    const degrade = { ...SOURCES, [m.cible]: SOURCES[m.cible].replace(m.de, m.vers) };
    const rouges = verifier(degrade).filter((r) => !r.ok);
    if (rouges.length) console.log(`rougit    ${m.nom}  (${rouges[0].nom})`);
    else { console.log(`SURVIT    ${m.nom}`); survivantes += 1; }
  });
  console.log(survivantes ? `notes-equipe-check --mutate: ${survivantes} mutation(s) non detectee(s)` : `notes-equipe-check --mutate: ${MUTATIONS.length} mutations, toutes detectees`);
  process.exit(survivantes ? 1 : 0);
} else {
  const echecs = afficher(verifier(SOURCES));
  console.log(echecs ? `notes-equipe-check: ${echecs} FAIL` : 'notes-equipe-check: ALL OK');
  process.exit(echecs ? 1 : 0);
}
