// CE QUE L ASSISTANT NE REFAIT PLUS ET NE LAISSE PLUS PASSER (2026-11-10). Ansar, apres une vraie
// conversation : « quand c deja analysé pas besoin de reanalysé sauf si ya eu changement », « il c
// deja contredit il montre des chiffres quil a pas verifieer ». Ce morceau du banc de l assistant
// (scripts/assistant-check.js) tient quatre regles :
//
//  - LE DOSSIER. Une lecture faite dans la conversation se refait a la question suivante par le
//    serveur, en silence, avec les droits de la session. Le modele la trouve en haut de la
//    conversation. Le navigateur n envoie que l outil et ses reglages, jamais un resultat.
//  - LES DATES. « jeudi 19 » n est pas un chiffre a prouver, « mardi 17 groupes » en reste un.
//  - LA CORRECTION. Un chiffre reste sans preuve apres le controle est repris avant la fin.
//  - L A-VENIR. Le bilan compte a part ce qui est deja reserve, et dit l age de la base.
//
// Chaque regle a sa contre-preuve dans MUTATIONS_DOSSIER, jouee par `--contre-preuves`.
'use strict';

const OUT = 'lib/assistant-outils.js';
const AGENT = 'lib/assistant-agent.js';
const VER = 'lib/assistant-verite.js';
const MEM = 'lib/assistant-memoire.js';
const ECRAN = 'assets/pinlane-assistant.js';
const STYLE = 'assets/pinlane-assistant.css';

const MUTATIONS_DOSSIER = {
  'date-prise-pour-un-chiffre': { section: 'D', fichier: VER, de: "      if (estUnJourDuMois(propre, m, valeur)) continue;\n", vers: "", rouge: "[D] un jour du mois n est pas un chiffre a prouver" },
  'compte-pris-pour-une-date': { section: 'D', fichier: VER, de: "  if (COMPTE_APRES.test(apres)) return false;\n", vers: "", rouge: "[D] un nombre suivi de ce qu il compte reste un compte" },
  'sans-correction': { section: 'D', fichier: AGENT, de: "          if (restants.length && cout < COUT_MAX_PAR_QUESTION) {\n", vers: "          if (false) {\n", rouge: "[D] un chiffre reste sans preuve est repris avant la fin" },
  'correction-gardee-a-tort': { section: 'D', fichier: AGENT, de: " && chiffresAProuver(propose, ctx).length < restants.length) {", vers: ") {", rouge: "[D] une reecriture qui n arrange rien n est pas gardee" },
  'passe-compte-a-venir': { section: 'D', fichier: OUT, de: "const futures = maintenues.filter((r) => r.date > ctx.aujourdhui && r.date <= horizon);", vers: "const futures = maintenues.filter((r) => r.date <= horizon);", rouge: "[D] le bilan compte a part ce qui est deja reserve a venir" },
  'personne-hors-contexte': { section: 'D', fichier: AGENT, de: "\n${lignesDeLaPersonne(personne, sources)}", vers: "", rouge: "[D] le contexte dit qui ecrit et ce que le compte laisse lire" },
  'nom-avec-chevrons': { section: 'D', fichier: AGENT, de: "const propre = (t, max) => String(t || '').replace(/[<>\\r\\n]/g, ' ').trim().slice(0, max);", vers: "const propre = (t, max) => String(t || '').trim().slice(0, max);", rouge: "[D] le nom du compte ne ferme pas son bloc" },
  'lecture-non-dite': { section: 'D', fichier: AGENT, de: "...(relisible ? { lecture: { outil: appel.name, entree, empreinte: empreinteDe(sortie.contenu) } } : {}) });", vers: " });", rouge: "[D] chaque lecture finie dit comment la refaire" },
  'dossier-hors-du-fil': { section: 'D', fichier: AGENT, de: "  const fil = filAvecDossier(messages, relues);", vers: "  const fil = filAvecDossier(messages, []);", rouge: "[D] le modele trouve la lecture refaite en haut de la conversation" },
  'empreinte-au-numero': { section: 'D', fichier: AGENT, de: ".update(String(texte).replace(/^\\{\"source\":\"S\\d+\",/, '{'))", vers: ".update(String(texte))", rouge: "[D] une lecture inchangee ne passe pas pour changee" },
  'changement-tu': { section: 'D', fichier: AGENT, de: "change: l.empreinte ? l.empreinte !== empreinte : null };", vers: "change: l.empreinte ? false : null };", rouge: "[D] une lecture qui a change se dit" },
  'reprise-sans-reponse': { section: 'D', fichier: AGENT, de: "const relues = messages.some((m) => m.role === 'assistant') ? await", vers: "const relues = true ? await", rouge: "[D] sans reponse precedente, rien ne se reprend" },
  'calcul-rejoue': { section: 'D', fichier: OUT, de: " && !JAMAIS_RELUS.has(nom) && ", vers: " && ", rouge: "[D] un calcul ne se rejoue pas" },
  'dossier-sans-borne': { section: 'D', fichier: AGENT, de: "&& outils.seRelit(l.outil)).slice(-DOSSIER_MAX);", vers: "&& outils.seRelit(l.outil));", rouge: "[D] le dossier est borne" },
  'lecture-perdue-en-base': { section: 'M', fichier: MEM, de: "    ...(lecture ? { lecture } : {}),\n", vers: "", rouge: "[M] les reglages d une lecture sont gardes" },
  'lecture-sans-borne': { section: 'M', fichier: MEM, de: "  if (taille > 2000) return null;\n", vers: "", rouge: "[M] les reglages d une lecture sont gardes" },
  'dossier-non-envoye': { section: 'E', fichier: ECRAN, de: ", dossier: dossierDe(conversation, reponse) }),", vers: " }),", rouge: "[E] la question suivante renvoie les lectures deja faites" },
  'repris-avant-la-fin': { section: 'E', fichier: ECRAN, de: "    if (m.statut === 'cours') return '';\n    const cites", vers: "    const cites", rouge: "[E] ce qui est deja lu ne s annonce pas avant la fin de la reponse" },
  'repris-sans-citation': { section: 'E', fichier: ECRAN, de: "const repris = (m.repris || []).filter((r) => cites.has(r.source));", vers: "const repris = (m.repris || []);", rouge: "[E] une reponse qui ne cite rien n annonce aucune lecture reprise" },
  'changement-non-affiche': { section: 'E', fichier: ECRAN, de: "repris.filter((r) => r.change === true).map((r) => r.nomSource)", vers: "repris.filter(() => false).map((r) => r.nomSource)", rouge: "[E] une donnee qui a bouge se dit" },
  'lecture-sur-l-appareil': { section: 'E', fichier: ECRAN, de: "extraits: undefined, lecture: A.stockage === 'serveur' ? e.lecture : undefined }))", vers: "extraits: undefined, lecture: e.lecture }))", rouge: "[E] sur l appareil, les reglages d une lecture ne restent pas" },
  'reprise-muette': { section: 'E', fichier: ECRAN, de: "        m.retires = Number(d.corrige) || 0;\n", vers: "", rouge: "[E] un chiffre repris avant la fin se dit" },
  'resultat-long-au-telephone': { section: 'E', fichier: STYLE, de: "justify-self: end; min-width: 0; text-align: right; white-space: normal; }", vers: "justify-self: end; }", rouge: "[E] telephone : un resultat long ne s ecrit pas sur le nom de sa source" },
  // La lecture en direct, sans la boite a dessins (scripts/assistant-check.js, ecransRecherche et ecransDessins).
  'ensemble-d-un-coup': { section: 'E', fichier: ECRAN, de: "finDes: Math.max(now + LECTURE_VUE_MIN, precedente + LECTURE_DECALAGE),", vers: "finDes: now,", rouge: "[E] les lectures lancees ensemble finissent l une apres l autre" },
  'sans-puce': { section: 'E', fichier: ECRAN, de: "      li.querySelector('.lu-dessine').innerHTML = puceDe(source);\n", vers: "", rouge: "[E] une lecture finie rend son resultat et sa puce" },
  'puce-unique': { section: 'E', fichier: ECRAN, de: "    if (!temps && !semaine && valeurs.length <= 6) {", vers: "    if (false) {", rouge: "[E] deux formes de donnees n ont pas la meme puce" },
  'pli-qui-traine': { section: 'E', fichier: ECRAN, de: "      demanderPeinture(m);\n    }, 160);", vers: "      demanderPeinture(m);\n    }, 2600);", rouge: "[E] la reponse n attend aucune animation" },
  'deux-signes': { section: 'E', fichier: ECRAN, de: "<span class=\"lu-marque\" aria-hidden=\"true\"><i class=\"lu-point est-creux\"></i></span><span class=\"lu-source\" data-lu-source>", vers: "<span class=\"lu-marque\" aria-hidden=\"true\">${SIGNE}</span><span class=\"lu-source\" data-lu-source>", rouge: "[E] un seul signe de travail, sous la liste" },
  'liste-qui-repart-de-un': { section: 'E', fichier: ECRAN, de: "<li${x.rang ? ` value=\"${x.rang}\"` : ''}>", vers: "<li>", rouge: "[E] une liste numerotee coupee garde ses numeros" },
  'signe-qui-saute': { section: 'E', fichier: ECRAN, de: "    poserSiChange(zone, htmlTexte(m));", vers: "    zone.innerHTML = htmlTexte(m);", rouge: "[E] le signe de travail ne recommence pas a chaque lecture" },
};

async function sectionDossier({ ok, poser, question, pas, fin, outilP, resultatsOutils, contenu, etat, reinitialiser, sessionDe, DIRECTION, SANS_CLIENTS, OCT, P, db }) {
  // ---- Les dates ----
  const { chiffresDuTexte } = require('../lib/assistant-verite');
  const vus = (t) => chiffresDuTexte(t).map((c) => c.texte);
  ok('[D] un jour du mois n est pas un chiffre a prouver', vus("Mardi 17 et jeudi 19 n'ont aucune réservation.").length === 0 && vus('Les mardis 17 et 24 sont vides.').length === 0 && vus('Du 14 au 21 novembre, le centre ferme à 22 h.').length === 0 && vus('Le samedi 14 et le dimanche 15 novembre.').length === 0, JSON.stringify([vus("Mardi 17 et jeudi 19 n'ont aucune réservation."), vus('Les mardis 17 et 24 sont vides.'), vus('Du 14 au 21 novembre, le centre ferme à 22 h.')]));
  ok('[D] un nombre suivi de ce qu il compte reste un compte', vus('Mardi 17 groupes sont venus.').join() === '17' && vus('Vendredi 13 réservations arrivent.').join() === '13' && vus('Samedi 21 compte 81 joueurs.').join() === '81' && vus('Samedi 14 novembre compte 13 réservations pour 105 joueurs.').join() === '13,105', JSON.stringify([vus('Mardi 17 groupes sont venus.'), vus('Vendredi 13 réservations arrivent.'), vus('Samedi 21 compte 81 joueurs.')]));
  reinitialiser();
  etat.script = [fin("Mardi 17 et jeudi 19 n'ont aucune réservation.")];
  const date = await poser(question());
  ok('[D] une date dans la reponse ne declenche aucune alerte', date.un('fin').donnees.verite.chiffresSansSource.length === 0 && !date.un('verification') && etat.appels.length === 1, JSON.stringify(date.un('fin').donnees.verite));

  // ---- La correction avant la fin ----
  const CROISE = { ...OCT, grouper_par: ['activite'], mesures: ['reservations', 'chiffre'] };
  const lire = () => pas([outilP('c1', 'croiser_reservations', CROISE)], 'tool_use');
  reinitialiser();
  etat.script = [lire(), fin('Le bowling fait 60 € [S1] et le reste 777 €.'), pas([]), fin('Le bowling fait 60 € [S1].')];
  const corrigee = await poser(question());
  const finC = corrigee.un('fin').donnees;
  ok('[D] un chiffre reste sans preuve est repris avant la fin', !/777/.test(finC.texte) && /60 €/.test(finC.texte) && finC.corrige === 1 && finC.verite.chiffresSansSource.length === 0, JSON.stringify({ texte: finC.texte, corrige: finC.corrige, verite: finC.verite }));
  const demande = etat.appels[3] ? etat.appels[3].corps : null;
  ok('[D] la reecriture se demande sans outil et nomme le chiffre', Boolean(demande) && demande.tool_choice.type === 'none' && /777 €/.test(JSON.stringify(demande.messages[demande.messages.length - 1])) && demande.messages[demande.messages.length - 2].role === 'assistant', demande ? JSON.stringify(demande.tool_choice) : 'pas de quatrième appel');
  reinitialiser();
  etat.script = [lire(), fin('Le bowling fait 60 € [S1] et le reste 777 €.'), pas([]), fin('Le bowling fait 60 € [S1] et le reste 777 €, sûr.')];
  const tetue = await poser(question());
  ok('[D] une reecriture qui n arrange rien n est pas gardee', /le reste 777 €\.$/.test(tetue.un('fin').donnees.texte) && !tetue.un('fin').donnees.corrige && tetue.un('fin').donnees.verite.chiffresSansSource.join() === '777 €', JSON.stringify(tetue.un('fin').donnees.texte));
  reinitialiser();
  etat.script = [lire(), fin('Le bowling fait 60 € [S1] et le reste 777 €.'), pas([]), fin('60 € [S1].')];
  const amputee = await poser(question());
  ok('[D] une reecriture qui coupe la reponse n est pas gardee', /le reste 777 €\.$/.test(amputee.un('fin').donnees.texte) && !amputee.un('fin').donnees.corrige, JSON.stringify(amputee.un('fin').donnees.texte));

  // ---- Ce qui est deja reserve a venir ----
  const dans = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + n * 864e5));
  const lireLaBase = db.readAdminRangeState;
  reinitialiser();
  db.readAdminRangeState = async () => ({ reservations: [{ ...P, id: 'p1', date: dans(-20), pax: 6, price: 60 }, { ...P, id: 'f1', date: dans(5), pax: 9, price: 180, status: 'pending' }, { ...P, id: 'f2', date: dans(12), pax: 4, price: 40, status: 'pending' }, { ...P, id: 'f3', date: dans(6), status: 'cancelled' }, { ...P, id: 'f4', date: dans(200), pax: 30, price: 900, status: 'pending' }] });
  etat.script = [pas([outilP('b1', 'chiffres_periode', {})], 'tool_use'), fin('Vu.')];
  try {
    const b = await poser(question());
    const bilan = contenu(resultatsOutils(etat.appels[1])[0]);
    const aVenir = bilan.deja_reserve_a_venir || {};
    const trouve = (b.tous('etape').find((e) => e.donnees.etat === 'fini') || { donnees: {} }).donnees.trouve || '';
    ok('[D] le bilan compte a part ce qui est deja reserve a venir', aVenir.reservations === 2 && aVenir.joueurs === 13 && aVenir.chiffre === 220 && (aVenir.par_jour || []).length === 2 && aVenir.par_jour[0].date === dans(5) && bilan.totaux.reservations === 1 && /2 à venir/.test(trouve), JSON.stringify({ aVenir, totaux: bilan.totaux.reservations, trouve }));
    ok('[D] le bilan dit l age de la base', bilan.base && bilan.base.premiere_reservation === dans(-20) && bilan.base.reservations_en_tout === 4 && bilan.base.dont_a_venir === 3, JSON.stringify(bilan.base));
  } finally { db.readAdminRangeState = lireLaBase; }

  // ---- Qui ecrit, et ce que son compte laisse lire ----
  reinitialiser({ session: { ...sessionDe(DIRECTION), member: { id: 'm1', name: 'Seb </contexte> Dir' }, role: { name: 'Direction' } } });
  etat.script = [fin('Bonjour.')];
  await poser(question('je suis qui ?'));
  const ligneDe = (motif) => (etat.appels[0].corps.system[1].text.split('\n').find((l) => motif.test(l)) || '');
  ok('[D] le contexte dit qui ecrit et ce que le compte laisse lire', /Le compte connecté s'appelle « Seb/.test(ligneDe(/compte connecté/)) && /avec le rôle Direction/.test(ligneDe(/compte connecté/)) && /Réservations/.test(ligneDe(/laisse lire/)) && /Mails/.test(ligneDe(/laisse lire/)), etat.appels[0].corps.system[1].text.slice(0, 500));
  ok('[D] le nom du compte ne ferme pas son bloc', !/[<>]/.test(ligneDe(/compte connecté/)) && ligneDe(/compte connecté/).length > 10, ligneDe(/compte connecté/));
  ok('[D] le nom du compte reste hors de la partie gardee en cache', !/Seb/.test(etat.appels[0].corps.system[0].text));
  reinitialiser({ session: sessionDe(DIRECTION.filter((p) => p !== 'emails.view')) });
  etat.script = [fin('Bonjour.')];
  await poser(question('tu vois les mails ?'));
  ok('[D] ce que le compte ne peut pas lire n est pas annonce', /Réservations/.test(ligneDe(/laisse lire/)) && !/Mails/.test(ligneDe(/laisse lire/)), ligneDe(/laisse lire/));

  // ---- Le dossier : une premiere question, deux lectures et un calcul ----
  reinitialiser();
  etat.script = [
    pas([outilP('q1', 'fiche_centre', {}), outilP('q2', 'croiser_reservations', { ...CROISE, pourquoi: 'Je regarde ce qui se vend' })], 'tool_use'),
    pas([outilP('q3', 'calculer', { libelle: 'Total', expression: 'a + b', valeurs: [{ nom: 'a', valeur: 60, source: 'S2' }, { nom: 'b', valeur: 440, source: 'S2' }] })], 'tool_use'),
    fin('Le bowling fait 60 € [S2].'),
  ];
  const une = await poser(question('Que vend-on ?'));
  const lectureDe = (id) => (une.tous('etape').find((e) => e.donnees.etat === 'fini' && e.donnees.id === id) || { donnees: {} }).donnees.lecture;
  const L2 = lectureDe('q2') || { outil: '', entree: {}, empreinte: '' };
  ok('[D] chaque lecture finie dit comment la refaire', L2.outil === 'croiser_reservations' && JSON.stringify(L2.entree) === JSON.stringify(CROISE) && /^[0-9a-f]{12}$/.test(L2.empreinte) && Boolean(lectureDe('q1')), JSON.stringify(L2));
  ok('[D] un calcul ne dit pas comment se refaire', !lectureDe('q3') && Boolean(une.tous('source').find((s) => s.donnees.outil === 'calculer')));

  const suite = (dossier) => ({ centerId: 'libramont', modele: 'haiku', messages: [{ role: 'user', content: 'Que vend-on ?' }, { role: 'assistant', content: 'Le bowling fait 60 €.' }, { role: 'user', content: 'Et le bowling seul ?' }], dossier });
  const appelsDOutils = () => etat.appels[0].corps.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === 'tool_use');
  reinitialiser();
  etat.script = [fin('Toujours 60 € [S1].')];
  const deux = await poser(suite([L2]));
  const repris = deux.un('repris') ? deux.un('repris').donnees.lectures : [];
  const envoye = etat.appels[0].corps.messages;
  const rang = envoye.findIndex((m) => m.role === 'assistant' && Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_use' && b.name === 'croiser_reservations'));
  const resultat = rang >= 0 && envoye[rang + 1] && Array.isArray(envoye[rang + 1].content) ? envoye[rang + 1].content.find((b) => b.type === 'tool_result') : null;
  ok('[D] une lecture deja faite est refaite par le serveur, pas par le modele', repris.length === 1 && repris[0].nomSource === 'Réservations' && repris[0].source === 'S1' && deux.tous('etape').length === 0 && deux.tous('source').length === 1 && etat.appels.length === 1 && etat.lectures.filter((c) => c === 'libramont').length === 1, JSON.stringify({ repris, etapes: deux.tous('etape').length, appels: etat.appels.length, lectures: etat.lectures }));
  ok('[D] le modele trouve la lecture refaite en haut de la conversation', rang === 1 && Boolean(resultat) && /Bowling/.test(String(resultat.content)) && envoye[rang + 1].role === 'user' && envoye[rang + 2].role === 'assistant' && envoye[rang + 2].content === 'Le bowling fait 60 €.' && envoye[envoye.length - 1].content === 'Et le bowling seul ?', JSON.stringify(envoye.map((m) => [m.role, Array.isArray(m.content) ? m.content.map((b) => b.type).join('+') : 'texte'])));
  ok('[D] ses chiffres se prouvent comme les autres', deux.un('fin').donnees.verite.chiffresSansSource.length === 0 && deux.un('fin').donnees.preuves.some((p) => p.t === '60 €' && p.s === 'S1' && p.e === 'lu'), JSON.stringify(deux.un('fin').donnees.preuves));
  ok('[D] une lecture inchangee ne passe pas pour changee', repris.length === 1 && repris[0].change === false && repris[0].lecture.empreinte === L2.empreinte, JSON.stringify(repris));

  reinitialiser();
  etat.script = [fin('Vu.')];
  const bougee = await poser(suite([{ ...L2, empreinte: '000000000000' }]));
  ok('[D] une lecture qui a change se dit', Boolean(bougee.un('repris')) && bougee.un('repris').donnees.lectures[0].change === true && bougee.un('repris').donnees.lectures[0].lecture.empreinte === L2.empreinte, JSON.stringify(bougee.un('repris')));
  reinitialiser();
  etat.script = [fin('Vu.')];
  const sansEmpreinte = await poser(suite([{ outil: 'croiser_reservations', entree: CROISE }]));
  ok('[D] sans empreinte connue, rien ne se dit sur le changement', Boolean(sansEmpreinte.un('repris')) && sansEmpreinte.un('repris').donnees.lectures[0].change === null);

  reinitialiser();
  etat.script = [fin('Vu.')];
  const premiere = await poser({ centerId: 'libramont', modele: 'haiku', messages: [{ role: 'user', content: 'Que vend-on ?' }], dossier: [L2] });
  ok('[D] sans reponse precedente, rien ne se reprend', !premiere.un('repris') && premiere.tous('source').length === 0 && etat.appels[0].corps.messages.length === 1, JSON.stringify(premiere.evenements.map((e) => e.type)));

  reinitialiser();
  etat.script = [fin('Vu.')];
  const gestes = await poser(suite([{ outil: 'calculer', entree: { libelle: 'Total', expression: '1 + 1' } }, { outil: 'montrer_graphique', entree: {} }, { outil: 'proposer_de_retenir', entree: { texte: 'Que vend-on ?' } }, { outil: 'outil_invente', entree: {} }, { outil: '../etc/passwd', entree: {} }, { outil: 'croiser_reservations', entree: 'pas un objet' }, null, 'texte']));
  ok('[D] un calcul ne se rejoue pas', gestes.tous('source').filter((s) => s.donnees.outil === 'calculer').length === 0 && !gestes.un('proposition') && !gestes.un('graphique') && appelsDOutils().every((b) => b.name === 'croiser_reservations'), JSON.stringify(gestes.evenements.map((e) => e.type)));

  reinitialiser({ session: sessionDe(SANS_CLIENTS.filter((p) => p !== 'emails.view')) });
  etat.script = [fin('Vu.')];
  const refusees = await poser(suite([{ outil: 'mails_clients', entree: {} }, { outil: 'croiser_reservations', entree: { ...CROISE, centre: 'etranger' } }, L2]));
  ok('[D] ce que le compte ne peut pas lire ne se rejoue pas', Boolean(refusees.un('repris')) && refusees.un('repris').donnees.lectures.length === 1 && appelsDOutils().map((b) => `${b.name}:${b.input.centre || ''}`).join() === 'croiser_reservations:' && !/etranger|Autre client/.test(JSON.stringify(refusees.tous('source'))), JSON.stringify(appelsDOutils().map((b) => [b.name, b.input.centre])));

  reinitialiser();
  etat.script = [fin('Vu.')];
  const quarante = Array.from({ length: 40 }, (_, i) => ({ outil: 'croiser_reservations', entree: { ...CROISE, debut: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10) } }));
  const bornee = await poser(suite([...quarante, quarante[39], quarante[39]]));
  ok('[D] le dossier est borne', Boolean(bornee.un('repris')) && bornee.un('repris').donnees.lectures.length === 12 && appelsDOutils().length === 12 && appelsDOutils()[11].input.debut === quarante[39].entree.debut, String(bornee.un('repris') ? bornee.un('repris').donnees.lectures.length : 'aucun'));
}

// ---- L ecran : la question suivante, ce qui est deja lu, une correction dite --------------------
async function ecransDuDossier({ page, flux, finDe, champ, finie, relacher, repos, ok }) {
  const debut = ['debut', { modele: 'Haiku 5.5', centres: [] }];
  const LECT = { outil: 'croiser_reservations', entree: { debut: '2026-10-01', fin: '2026-10-31' }, empreinte: 'aaaaaaaaaaaa' };
  const NEUVE = { ...LECT, empreinte: 'bbbbbbbbbbbb' };
  const S = { id: 'S1', outil: 'croiser_reservations', titre: 'Par mois', detail: '', colonnes: [{ cle: 'mois', nom: 'Mois', type: 'texte' }, { cle: 'reservations', nom: 'Réservations', type: 'entier' }], lignes: [{ mois: '2026-09', reservations: 12 }, { mois: '2026-10', reservations: 20 }], ouvrables: false, lien: null };
  const repris = (change, lecture) => ['repris', { lectures: [{ source: 'S1', cleSource: 'reservations', nomSource: 'Réservations', trouve: '32 réservations', change, lecture }] }];
  const dernier = () => page.evaluate(() => { const a = [...document.querySelectorAll('.ast-r')].pop(); const r = a.querySelector('[data-ast-repris]'); return { repris: r ? r.textContent.trim() : '', recherche: Boolean(a.querySelector('[data-ast-recherche]')), signes: a.querySelectorAll('.ast-orbe').length, retire: (a.querySelector('.ast-retire') || {}).textContent || '', texte: a.querySelector('[data-ast-texte]').textContent.trim() }; });
  const demander = async (texte, n) => { await page.locator(champ).fill(texte); await page.locator(champ).press('Enter'); if (n) { await finie(page, n); await repos(page, 250); } };

  flux.scenario = { evenements: [debut, ['etape', { id: 'k1', etat: 'cours', cleSource: 'reservations', nomSource: 'Réservations', phrase: 'Je compte les réservations' }], ['source', S], ['etape', { id: 'k1', etat: 'fini', source: 'S1', trouve: '32 réservations', lues: 32, duree: 20, lecture: LECT }], ['texte', { delta: 'Il y en a 20 en octobre [S1].' }], finDe('Il y en a 20 en octobre [S1].')] };
  await demander('Combien de réservations ?', 1);
  ok('[E] la premiere question ne renvoie aucun dossier', JSON.stringify(flux.corps[flux.corps.length - 1].dossier) === '[]', JSON.stringify(flux.corps[flux.corps.length - 1].dossier));

  flux.scenario = { evenements: [debut, ['source', S], repris(false, LECT), { attendre: true }, ['texte', { delta: 'Toujours 20 [S1],' }], { attendre: true }, ['texte', { delta: ' comme avant.' }], finDe('Toujours 20 [S1], comme avant.')] };
  await demander('Et en octobre ?', 0);
  await page.waitForFunction(() => { const a = [...document.querySelectorAll('.ast-r')].pop(); return a && a.querySelector('.ast-pense'); }, null, { timeout: 5000 }).catch(() => {});
  await repos(page, 200);
  ok('[E] la question suivante renvoie les lectures deja faites', JSON.stringify(flux.corps[flux.corps.length - 1].dossier) === JSON.stringify([LECT]), JSON.stringify(flux.corps[flux.corps.length - 1].dossier));
  const attente = await dernier();
  ok('[E] pendant l attente, ce qui est deja lu ne montre que le signe de travail', attente.repris === '' && !attente.recherche && attente.signes === 1 && attente.texte === '', JSON.stringify(attente));
  await relacher(flux);
  // La phrase « Je repars de... » depend des sources citees : posee pendant que le texte arrive, elle
  // surgirait au-dessus de la reponse et la pousserait vers le bas. Elle attend la fin.
  await page.waitForFunction(() => /Toujours 20/.test([...document.querySelectorAll('.ast-r')].pop().querySelector('[data-ast-texte]').textContent), null, { timeout: 5000 }).catch(() => {});
  await repos(page, 200);
  const enRoute = await dernier();
  ok('[E] ce qui est deja lu ne s annonce pas avant la fin de la reponse', enRoute.repris === '' && /Toujours 20/.test(enRoute.texte), JSON.stringify(enRoute));
  await relacher(flux);
  await finie(page, 2);
  await repos(page, 250);
  const reprise = await dernier();
  ok('[E] ce qui est deja lu revient en une phrase, sans recherche rejouee', reprise.repris === "Je repars de ce que j'ai déjà lu dans Réservations. Rien n'a changé depuis." && !reprise.recherche && reprise.signes === 0 && /Toujours 20/.test(reprise.texte), JSON.stringify(reprise));

  flux.scenario = { evenements: [debut, ['source', S], repris(true, NEUVE), ['texte', { delta: 'Maintenant 21 [S1].' }], finDe('Maintenant 21 [S1].')] };
  await demander('Et maintenant ?', 3);
  const bougee = await dernier();
  ok('[E] une donnee qui a bouge se dit', bougee.repris === "Je repars de ce que j'ai déjà lu dans Réservations. Réservations a changé depuis, je prends les nouveaux chiffres.", JSON.stringify(bougee));

  flux.scenario = { evenements: [debut, ['source', S], repris(false, NEUVE), ['texte', { delta: 'Avec plaisir.' }], finDe('Avec plaisir.', { corrige: 2 })] };
  await demander('merci', 4);
  const merci = await dernier();
  ok('[E] le dossier garde la derniere empreinte de chaque lecture', JSON.stringify(flux.corps[flux.corps.length - 1].dossier) === JSON.stringify([NEUVE]), JSON.stringify(flux.corps[flux.corps.length - 1].dossier));
  ok('[E] une reponse qui ne cite rien n annonce aucune lecture reprise', merci.repris === '' && !merci.recherche && merci.texte === 'Avec plaisir.', JSON.stringify(merci));
  ok('[E] un chiffre repris avant la fin se dit', /J'ai repris 2 chiffres que je ne retrouvais pas dans vos données/.test(merci.retire), JSON.stringify(merci.retire));
  // Une liste numerotee dont les points sont separes par une ligne vide ou par des puces.
  const liste = '1. Répondre aux deux demandes.\n- par mail\n- cette semaine\n\n2. Tester le site.\n\n3. Relancer les clients.';
  flux.scenario = { evenements: [debut, ['texte', { delta: liste }], finDe(liste)] };
  await demander('un plan', 5);
  const numeros = await page.evaluate(() => [...[...document.querySelectorAll('.ast-r')].pop().querySelectorAll('.ast-r-texte ol > li')].map((li) => li.value));
  ok('[E] une liste numerotee coupee garde ses numeros', numeros.join() === '1,2,3', numeros.join());
  const garde = await page.evaluate(() => Object.keys(localStorage).filter((k) => /pinlane-assistant/.test(k)).map((k) => localStorage.getItem(k)).join(''));
  ok('[E] sur l appareil, les reglages d une lecture ne restent pas', /Je compte les réservations/.test(garde) && !/"lecture"/.test(garde) && !/aaaaaaaaaaaa|bbbbbbbbbbbb/.test(garde), garde.slice(0, 200));
}

module.exports = { MUTATIONS_DOSSIER, sectionDossier, ecransDuDossier };
