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
//       moteur, et chaque note d equipe est rendue avec son auteur ;
//   [C] la fiche montre le mot du client en grand, les notes de l equipe, et
//       le champ pour en ajouter une ; la carte porte la plus recente ;
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
  db: fs.readFileSync(path.join(ROOT, 'lib', 'database.js'), 'utf8'),
  api: fs.readFileSync(path.join(ROOT, 'api', 'staff-reservations.js'), 'utf8'),
};

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
      'const notesEquipeBrouillons = new Map();',
      'const notesEquipeOuvertes = new Set();',
      ...['lireNoteEquipeLigne', 'getReservationNotesEquipe', 'getReservationNoteText', 'getReservationNoteParts',
        'hasReservationNote', 'getReservationDelayFlag', 'getReservationNoteTitre', 'formatNoteEquipeQuand', 'renderGroupeNotes', 'getGroupeEncadres'].map((n) => extraire(sources.app, n)),
    ].join('\n');
    const bac = {
      escapeHtml: (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
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
    vm.runInContext(`${code}\nthis.api = { NOTE_EQUIPE_TAG, lireNoteEquipeLigne, getReservationNotesEquipe, getReservationNoteText, getReservationNoteParts, hasReservationNote, renderGroupeNotes, getGroupeEncadres };`, bac);
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
  c((fiche.match(/class="gc-note-equipe"/g) || []).length === 2 && /Léa · /.test(fiche) && /Sam · /.test(fiche), '[C] chaque note d equipe porte son auteur et son heure');
  c(/onclick="ouvrirNoteEquipe\(7, event\)"[^>]*>[\s\S]*?Note pour l’équipe<\/button>/.test(fiche) && !/<textarea/.test(fiche), '[C] champ replie : la fiche ne porte qu un bouton « Note pour l’équipe »');
  vm.runInContext('notesEquipeOuvertes.add(7)', bacCote);
  const ouverte = cote.renderGroupeNotes(dossier);
  c(/<textarea id="gcNoteEquipe7"[^>]*placeholder="Note pour l’équipe : le client ne la voit pas"/.test(ouverte) && /onclick="ajouterNoteEquipe\(7, event\)"/.test(ouverte), '[C] ouvert, le champ et le bouton pour ajouter la note');
  c(cote.renderGroupeNotes({ id: 9, channel: 'public', status: 'confirmed', notes: '' }).includes('is-vide') && !/Notes<\/div>/.test(cote.renderGroupeNotes({ id: 9, channel: 'public', status: 'confirmed', notes: '' })), '[C] une fiche sans note ne porte ni titre ni texte vide');
  c(!/\[equipe\]|\[ops:/.test(fiche), '[C] aucun marqueur interne ne s affiche');
  const comptoir = cote.renderGroupeNotes({ id: 8, channel: 'staff', status: 'confirmed', notes: 'Paie en deux fois' });
  c(/class="gc-note-titre">Note<\/b>/.test(comptoir) && !/Mot du client/.test(comptoir), '[C] un dossier pris au comptoir ne dit pas « Mot du client »');
  const encadres = cote.getGroupeEncadres(dossier);
  const equipe = encadres.find((e) => e.ton === 'equipe');
  c(equipe && equipe.titre === 'Note équipe · 2' && /Table près de la fenêtre \(Sam\)/.test(equipe.texte), '[C] la carte porte la note la plus recente et le nombre de notes', JSON.stringify(equipe));
  c(encadres.some((e) => e.ton === 'note' && e.titre === 'Mot du client' && e.texte === 'Gâteau à mettre au frais'), '[C] la carte porte le mot du client, titre compris');

  // [D] LE SERVEUR
  const route = (sources.api.match(/if \(patchIsNoteEquipeOnly\(body\)\) \{[\s\S]*?\n      \}\n/) || [''])[0];
  c(Boolean(route), '[D] le PATCH a une route dediee aux notes d equipe');
  c(/par: \(membre && \(membre\.name/.test(route) && !/geste\.par|body\.par/.test(route), '[D] l auteur vient de la session, jamais du corps de la requete');
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
  const montrer = extraire(sources.app, 'montrerAuPlanning');
  c(/data-laser-res-id/.test(montrer) && /data-booking-res-id/.test(montrer) && /data-laser-res-id="\$\{reservation\.id\}" class="laser-group-card/.test(sources.app), '[E] les blocs des deux plannings portent le numero du dossier');
  return resultats;
}

const MUTATIONS = [
  { nom: 'le mot du client garde les notes d equipe', cible: 'app', de: ".filter(ligne => !lireNoteEquipeLigne(ligne))\n    .join('\\n')", vers: ".join('\\n')" },
  { nom: 'les traces du moteur restent dans le mot du client', cible: 'app', de: "mot: lignes.filter(ligne => !/^\\s*\\[ops:/.test(ligne))", vers: 'mot: lignes.filter(ligne => true)' },
  { nom: 'le serveur prend l auteur dans le corps', cible: 'api', de: "par: (membre && (membre.name || membre.displayName)) || 'Équipe',", vers: "par: geste.par || 'Équipe'," },
  { nom: 'la note s ecrit sans verrou', cible: 'db', de: "select notes from reservations where id = $1 and center_id = $2 for update;", vers: 'select notes from reservations where id = $1 and center_id = $2;' },
  { nom: 'la fiche ne montre plus l auteur', cible: 'app', de: '${escapeHtml([n.par, formatNoteEquipeQuand(n.le)].filter(Boolean).join(\' · \'))}', vers: '${escapeHtml(formatNoteEquipeQuand(n.le))}' },
  { nom: 'le lien du planning coche aussi la ligne', cible: 'app', de: "function voirAuPlanning(reservationId, ressource, ev) {\n  if (ev) ev.stopPropagation();", vers: 'function voirAuPlanning(reservationId, ressource, ev) {' },
  { nom: 'le serveur change de marqueur', cible: 'db', de: "const NOTE_EQUIPE_TAG = '[equipe] ';", vers: "const NOTE_EQUIPE_TAG = '[staff] ';" },
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
