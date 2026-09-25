'use strict';
// voix-pro-check : LA CONSOLE VOUVOIE LE GERANT.
//
// Decision d harmonisation du chantier polish (2026-09-02) : « vouvoiement
// partout ». Mesure du 2026-09-25 avant correction : 110 chaines tutoyaient
// encore le gerant (« Pose ta question », « Ton meilleur jour », « Colle le
// texte du post », « TOUS TES centres »), pendant que l agent strategiste,
// l agent des mails et la demo le vouvoyaient deja. Deux voix pour un meme
// produit, et la plus familiere sur l ecran d un directeur de centre.
// Les legendes proposees aux CLIENTS du centre suivent la doctrine de marque
// (lib/fungalaxy-brand.js : vouvoiement par defaut, c est le parent qui
// reserve) : « Reserve ta piste » y contrevenait.
//
// Ce que le gate lit : TOUS les litteraux de chaine (guillemets, gabarits sur
// plusieurs lignes) des fichiers que voit un centre, plus le texte des pages
// HTML de la console et de la demo. Cote serveur, les phrases que le gerant
// lit (brief, radar, faits, conseils) et les legendes proposees aux clients ;
// les CONSIGNES donnees aux modeles (tableaux stableSystem, rappel, regles),
// qui s adressent au modele et non au gerant, sont ecartees.
//
// Meme lecture, deuxieme faute : les mots ecrits SANS leurs accents (« Role
// supprime. », « Cette annee », « Periode precedente »), 92 phrases le
// 2026-09-25, a cote de phrases accentuees sur le meme ecran. Le dictionnaire
// ne garde que des mots qui n existent pas sans accent en francais ; un
// litteral compare a un texte normalise (includes, ===) et une requete SQL ne
// sont pas du texte lu.
//
// Les outils du fondateur (founder-*.js) suivent la meme voix depuis le
// 2026-09-25 : ils melangeaient « tu » et « vous » (« Réessaye » a cote de
// « Réessayez ») et 290 lignes avaient perdu des accents. ops-console.js
// n est pas qu au fondateur : app-main le charge pour la page Emails,
// l accueil et les reglages, et son onglet Activite s affiche a la Direction
// d un centre.
//
//   node scripts/voix-pro-check.js                 le gate
//   node scripts/voix-pro-check.js --contre-preuves   chaque mutation doit rougir
const fs = require('fs');
const path = require('path');

const ROOT = process.env.VOIX_ROOT || path.resolve(__dirname, '..');
const CONTRE = process.argv.includes('--contre-preuves');

const CLIENT = [
  'assets/staff-pages-v2.js', 'assets/app-main.js', 'assets/admin-console.js', 'assets/admin-mail.js',
  'assets/admin-data.js', 'assets/email-thread.js', 'assets/pinlane-analytics-board.js', 'assets/booking-core.js',
  'assets/staff-menu.js', 'assets/staff-auth-session.js', 'assets/ops-live.js', 'assets/ops-progress.js',
  'assets/pinlane-daterange.js', 'assets/boot-view.js', 'assets/fungalaxy-booking.js', 'assets/pinlane-landing.js',
  'assets/ops-console.js', 'assets/founder-cockpit.js', 'assets/founder-centres.js', 'assets/founder-clients-platform.js',
  'assets/founder-tarifs.js', 'assets/founder-team.js',
  'demo/demo.js',
];
const HTML = ['index.html', 'demo/index.html'];
const SERVEUR = ['lib/marketing-brief.js', 'lib/center-metrics.js', 'lib/marketing-brain.js', 'lib/marketing-ask.js'];

// Le jargon interne qui n a rien a faire sur l ecran d un gerant.
const JARGON = [
  { motif: /verdicts?\s+causa/i, nom: '« verdicts causaux »' },
  // Le vocabulaire du fournisseur d envoi et de l equipe technique (Emails &
  // relances, 2026-09-25) : le gerant lit « remise confirmée », « À vérifier ».
  { motif: /accusés?\s+(du\s+fournisseur|de\s+remise)/i, nom: '« accusé du fournisseur »' },
  { motif: /en\s+attente\s+d['’]\s*événement/i, nom: '« en attente d’événement »' },
  { motif: /ligne\s+DNS/i, nom: '« ligne DNS »' },
  { motif: /ciblage\s+réel/i, nom: '« ciblage réel »' },
  { motif: /Validation\s+staff/i, nom: '« Validation staff »' },
  // Le separateur de la console est « · » (decision d harmonisation du
  // 2026-09-02) : « • » en installait une seconde famille dans les memes ecrans.
  { motif: / • /, nom: 'separateur « • » (la console separe par « · »)' },
];

// ── Lecture des litteraux ────────────────────────────────────────────────────
// Un petit lecteur de JS suffit : chaines, gabarits et leurs ${...} imbriques,
// commentaires et regex sautes. Chaque litteral garde sa ligne et les 400
// caracteres de code qui le precedent (pour reconnaitre une consigne de modele).
function litteraux(src) {
  const out = [];
  let i = 0;
  let ligne = 1;
  const n = src.length;
  let dernier = '';
  const avance = (c) => { if (c === '\n') ligne += 1; };
  const regexPossible = () => {
    if (!dernier) return true;
    if (/[(,=:[!&|?{};+\-*%<>~^]/.test(dernier.slice(-1))) return true;
    return /^(return|typeof|case|in|of|delete|void|throw|new|else|do)$/.test(dernier);
  };
  function lireChaine(q) {
    const debut = ligne;
    const avant = src.slice(Math.max(0, i - 400), i);
    let s = '';
    i += 1;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { s += src[i + 1] === '\n' ? '' : src[i + 1]; avance(src[i + 1]); i += 2; continue; }
      if (c === q) { i += 1; break; }
      avance(c);
      s += c;
      i += 1;
    }
    out.push({ ligne: debut, texte: s, avant });
  }
  function lireGabarit() {
    const debut = ligne;
    const avant = src.slice(Math.max(0, i - 400), i);
    let s = '';
    i += 1;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { s += src[i + 1]; avance(src[i + 1]); i += 2; continue; }
      if (c === '`') { i += 1; break; }
      if (c === '$' && src[i + 1] === '{') { s += ' \u0000 '; i += 2; lireCode(true); continue; }
      avance(c);
      s += c;
      i += 1;
    }
    out.push({ ligne: debut, texte: s, avant });
  }
  function lireCode(dansGabarit) {
    let profondeur = 0;
    while (i < n) {
      const c = src[i];
      if (c === '\n') { ligne += 1; i += 1; continue; }
      if (/\s/.test(c)) { i += 1; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
      if (c === '/' && src[i + 1] === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { avance(src[i]); i += 1; }
        i += 2;
        continue;
      }
      if (c === '\'' || c === '"') { lireChaine(c); dernier = 'x'; continue; }
      if (c === '`') { lireGabarit(); dernier = 'x'; continue; }
      if (c === '/' && regexPossible()) {
        i += 1;
        let classe = false;
        while (i < n) {
          const r = src[i];
          if (r === '\\') { i += 2; continue; }
          if (r === '[') classe = true;
          else if (r === ']') classe = false;
          else if (r === '/' && !classe) { i += 1; break; }
          else if (r === '\n') { ligne += 1; break; }
          i += 1;
        }
        while (i < n && /[a-z]/i.test(src[i])) i += 1;
        dernier = 'x';
        continue;
      }
      if (c === '{') profondeur += 1;
      if (c === '}') {
        if (dansGabarit && profondeur === 0) { i += 1; return; }
        profondeur -= 1;
      }
      if (/[A-Za-z_$0-9]/.test(c)) {
        let m = '';
        while (i < n && /[A-Za-z_$0-9]/.test(src[i])) { m += src[i]; i += 1; }
        dernier = m;
        continue;
      }
      dernier = c;
      i += 1;
    }
  }
  lireCode(false);
  return out;
}

// Le texte visible d une page HTML : scripts et styles retires, balises
// remplacees par une frontiere de phrase.
function texteHtml(src) {
  const sans = src
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const out = [];
  let ligne = 1;
  sans.split('\n').forEach((l) => {
    const attributs = [...l.matchAll(/\b(?:title|placeholder|aria-label|alt)="([^"]*)"/g)].map((m) => m[1]);
    const texte = l.replace(/<[^>]*>/g, ' | ');
    [texte, ...attributs].forEach((t) => { if (/\p{L}/u.test(t)) out.push({ ligne, texte: t, avant: '' }); });
    ligne += 1;
  });
  return out;
}

// ── Les marqueurs de tutoiement ──────────────────────────────────────────────
const MOTS = /(^|[^\p{L}\p{N}_'’-])(tu|toi|ta|tes|te)(?=$|[^\p{L}\p{N}_'’])/iu;
// « ton » est aussi un nom (le ton d un message) : seul le possessif compte.
// Apres « de », c est presque toujours le possessif (« de ton centre »).
const TON = /(^|[^\p{L}\p{N}_'’-])(?<!\b(?:le|un|du|au|même|bon|quel|son|leur|votre|notre|ce)\s)(ton)(?=\s+\p{L})/iu;
const ELISION = /(^|[^\p{L}])t['’](a|as|es|en|y|attend|attendent|inqui|aide|explique|envoie|propose|montre)/iu;
const TRAIT = /-(toi|te)\b/iu;
// Imperatif a pronom : « Retire-la », « Ajoute-en ». Le radical finit par e ou
// s ; « -ons » (nous) et « -ez » (vous) ne sont pas du tutoiement.
const TRAIT_IMPERATIF = /(^|[^\p{L}])\p{L}{2,}[es](?<!ons)(?<!ites)-(la|le|les|moi|lui|en|y)(?![\p{L}-])/u;
const IMPERATIF_SUR = /(^|[.:!?«(|]\s*)(Choisis|Remplis|Saisis|Définis|Écris|Décris|Réessaie|Reessaie|Rafraîchis|Réponds|Prends|Attends|Reviens|Viens|Fais|Mets|Dis|Vois|Essaie|Relis|Réfléchis)(?=[\s,.!:-]|$)/u;
const IMPERATIF_AMBIGU = /(^|[.:!?«(|]\s*)(Coche|Décoche|Retire|Glisse|Déplace|Appuie|Touche|Complète|Corrige|Associe|Survole|Ajoute|Colle|Pose|Recharge|Laisse|Ajuste|Enregistre|Envoie|Clique|Regarde|Vérifie|Ouvre|Lance|Tape|Change|Coupe|Garde|Passe|Sélectionne|Selectionne|Copie|Donne|Indique|Précise|Utilise|Active|Désactive|Renseigne|Importe|Exporte|Crée|Cree|Supprime|Modifie|Valide|Connecte|Branche|Demande|Note|Pense|Relance|Réserve|Reserve|Profite|Joue|Rejoins|Découvre|Teste|Publie|Poste|Écoute)(\s+(?:(?:le|la|les|un|une|au|aux|ici|ce|cet|cette|ces|tes|ta|ton|à|a|avant|maintenant|plutôt|quand)(?=\s|$|[,.;:!?])|l['’]\p{L}|d['’]abord))/u;

function tutoie(texte) {
  const propre = String(texte).replace(/<[^>]*>/g, ' | ').replace(/&[a-z]+;/g, ' ').replace(/\u0000/g, ' ');
  const raisons = [];
  for (const [re, k] of [[MOTS, 2], [TON, 2], [ELISION, 0], [TRAIT, 0], [TRAIT_IMPERATIF, 0], [IMPERATIF_SUR, 2], [IMPERATIF_AMBIGU, 0]]) {
    const m = propre.match(re);
    if (m) raisons.push(m[k].trim());
  }
  return raisons.length ? { raisons, propre: propre.replace(/\s+/g, ' ').trim() } : null;
}

// Une consigne donnee a un modele (elle s adresse au modele, pas au gerant) :
// dans un tableau stableSystem / outputRules, dans un rappel, ecrite comme une
// regle (« Tu es… », « RÈGLE ABSOLUE… ») ou portant sur le format de sortie
// (« Réponds uniquement en JSON… »).
const CLE_CONSIGNE = /\b(stableSystem|system|systemPrompt|rappel|outputRules|guidance|instructions|consignes)\s*:\s*(\[[^\]]*)?$/;
function estConsigne(l) {
  if (/^\s*(Tu|TU|Ta|TA)\b/.test(l.texte)) return true;
  if (/\bJSON\b|\bsch[ée]ma\b/.test(l.texte)) return true;
  if (/\b[A-ZÀ-Ý]{4,}\b/.test(l.texte.replace(/\b(EUR|JSON|HTML|URL|SMS|API|CSV|TOUS|VOUS|VOS)\b/g, ''))) return true;
  return CLE_CONSIGNE.test(l.avant.replace(/\s+/g, ' ').trim());
}

// ── Les accents ──────────────────────────────────────────────────────────────
// Mesure du 2026-09-25 : 92 phrases lues sans leurs accents (« Role supprime. »,
// « Cette annee », « Periode precedente », « Donnees clients momentanement
// indisponibles »), a cote de phrases accentuees sur le meme ecran. Ces mots
// n existent pas sans accent en francais : ecrits sans, c est une faute.
const SANS_ACCENT = [
  'acces', 'activite', 'activites', 'apres', 'categorie', 'categories', 'creer', 'creee', 'creees', 'deja',
  'donnee', 'donnees', 'ecran', 'ecrans', 'ecrire', 'equipe', 'etat', 'etats', 'etre', 'evenement',
  'evenements', 'fenetre', 'generer', 'journee', 'journees', 'modele', 'modeles', 'numero', 'numeros', 'parametres',
  'passee', 'periode', 'periodes', 'premiere', 'reessaie', 'reessayer', 'reessayez', 'regle', 'regles', 'reglage', 'reglages',
  'reservation', 'reservations', 'role', 'roles', 'systeme', 'telecharger', 'telephone', 'tres', 'verifier', 'deconnexion', 'etape',
  'etapes', 'annee', 'annees', 'recu', 'recus', 'envoye', 'envoyes', 'envoyee', 'derniere', 'dernieres', 'precedente',
  'reussi', 'echec', 'echecs', 'echoue', 'resultat', 'resultats', 'desactiver', 'annulee', 'annulees', 'modifiee',
  'enregistree', 'supprimee', 'refusee', 'validee', 'arrivee', 'payee', 'confirmee', 'confirmees', 'mis a jour',
  'mise a jour', 'mises a jour', 'a venir', 'a partir', 'aujourd hui', 'reinitialiser', 'caracteres', 'cochee',
  'frequentation', 'strategie', 'reseau', 'reseaux', 'societe', 'deplacer', 'deplacement', 'debut', 'duree', 'durees',
  'epuise', 'epuisee', 'generee', 'generees', 'eteint', 'etait', 'etaient', 'fermee', 'fermees', 'disponibilite',
  'disponibilites', 'capacite', 'capacites', 'priorite', 'securite', 'identite', 'qualite', 'quantite', 'prevu', 'prevus',
  'prevue', 'prevues', 'deroule', 'reelle', 'reelles', 'terminee', 'terminees', 'illimitee', 'illimitees', 'rafraichir',
  'rafraichissement', 'momentanement', 'definitive', 'definitif', 'reassignez', 'proprietaire', 'limitee', 'limitees',
  'prix barre', 'deja venus', 'cumules', 'cumulees', 'selectionnee', 'selectionnees', 'bloquee', 'bloquees', 'debloquer',
  'reouvrir', 'reouverture', 'decochee', 'recapitulatif', 'reponse', 'reponses', 'repondre',
];
const RE_SANS_ACCENT = new RegExp(`(^|[^\\p{L}'’])(${SANS_ACCENT.map((m) => m.replace(/ /g, '\\s+')).join('|')})(?=$|[^\\p{L}'’])`, 'iu');
// Un litteral COMPARE a un texte normalise sans accents (includes, ===) est un
// motif de recherche, pas une phrase lue : booking-core cherche « toutes les
// activites illimitees » dans une description passee par normalize('NFD').
const COMPARAISON = /(?:includes|indexOf|startsWith|endsWith|test|match|search)\(\s*$|[!=]==?\s*$/;
function sansAccent(l) {
  if (COMPARAISON.test(l.avant.replace(/\s+$/, ''))) return null;
  // Une requete SQL nomme ses tables (« from reservations ») : pas du texte lu.
  if (/^\s*(select|insert|update|delete|with)\s/i.test(l.texte)) return null;
  const t = String(l.texte)
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/\b(?!title|placeholder|aria-label|alt)[\w-]+="[^"]*"/g, ' ')
    .replace(/<[^>]*>/g, ' | ')
    .replace(/<[a-z][^>]*$/i, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\u0000/g, ' ');
  // Une cle, un selecteur, un identifiant ne sont pas du texte lu.
  if (!/\p{L}{2,}\s+\p{L}{2,}/u.test(t)) return null;
  const m = t.match(RE_SANS_ACCENT);
  return m ? { mot: m[2], propre: t.replace(/\s+/g, ' ').trim() } : null;
}

// Les faits et les motifs de refus de marketing-ask.js vont au modele et aux
// journaux, jamais a l ecran du gerant, et les gates les lisent tels quels
// (« regle commerciale », « classement trop serre ») : le tutoiement y est
// cherche, pas les accents.
const SANS_RELEVE_ACCENTS = new Set(['lib/marketing-ask.js']);

function scanner(rel, src, { serveur = false } = {}) {
  const propre = src.replace(/\r\n/g, '\n');
  const liste = rel.endsWith('.html') ? texteHtml(propre) : litteraux(propre);
  const hits = [];
  for (const l of liste) {
    if (serveur && estConsigne(l)) continue;
    const t = tutoie(l.texte);
    const jargon = JARGON.find((j) => j.motif.test(l.texte));
    const accent = SANS_RELEVE_ACCENTS.has(rel) ? null : sansAccent(l);
    if (accent) hits.push(`${rel}:${l.ligne} [sans accent : ${accent.mot}] ${accent.propre.slice(0, 160)}`);
    if (!t && !jargon) continue;
    const affiche = (t ? t.propre : l.texte).replace(/\s+/g, ' ').trim();
    // Une cle ou un selecteur n est pas du texte lu.
    if (t && !jargon && !/\p{L}{2,}\s+\p{L}{2,}/u.test(affiche) && affiche.length < 12) continue;
    hits.push(`${rel}:${l.ligne} [${t ? t.raisons.join(',') : jargon.nom}] ${affiche.slice(0, 160)}`);
  }
  return hits;
}

function lire(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function tout(sources) {
  const hits = [];
  for (const rel of CLIENT) hits.push(...scanner(rel, sources[rel]));
  for (const rel of HTML) hits.push(...scanner(rel, sources[rel]));
  for (const rel of SERVEUR) hits.push(...scanner(rel, sources[rel], { serveur: true }));
  return hits;
}

const sources = {};
for (const rel of [...CLIENT, ...HTML, ...SERVEUR]) sources[rel] = lire(rel);

let echecs = 0;
const ok = (cond, label, detail = '') => {
  if (cond) console.log(`  ok   ${label}`);
  else { echecs += 1; console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`); }
};

if (!CONTRE) {
  console.log('voix-pro-check : la console vouvoie le gerant');
  // Le lecteur lit vraiment les litteraux : il doit retrouver des phrases
  // connues, sinon un « zero tutoiement » ne prouverait rien.
  const temoins = [
    ['assets/staff-pages-v2.js', 'Posez votre question en quelques mots.'],
    ['assets/app-main.js', 'Retirez-la avec la croix.'],
    ['lib/marketing-brief.js', 'je garde un œil sur vos réservations'],
    ['assets/app-main.js', 'Rôle supprimé.'],
    ['assets/pinlane-daterange.js', 'Cette année'],
    ['index.html', 'Changer de planning sans quitter le plein écran'],
    ['assets/founder-tarifs.js', 'Indiquez un prix per-pax entre 0 et 1000 EUR.'],
    ['assets/ops-console.js', 'Lancez une simulation avant de valider.'],
  ];
  for (const [rel, phrase] of temoins) {
    const lus = (rel.endsWith('.html') ? texteHtml(sources[rel]) : litteraux(sources[rel].replace(/\r\n/g, '\n'))).map((l) => l.texte);
    ok(lus.some((t) => t.includes(phrase)), `MONTAGE : le lecteur retrouve « ${phrase} » dans ${rel}`);
  }
  const hits = tout(sources);
  ok(hits.length === 0, `aucune chaine ne tutoie le gerant, ne parle jargon ni ne perd ses accents (${hits.length} trouvee(s))`, hits.slice(0, 25).join('\n       '));
  console.log(echecs ? `voix-pro-check : ${echecs} echec(s)` : 'voix-pro-check: ALL OK');
  process.exit(echecs ? 1 : 0);
}

// ── Contre-preuves : chaque mutation remet une faute, le gate doit la voir ───
console.log('voix-pro-check --contre-preuves');
const MUTATIONS = [
  { nom: 'un toast tutoie de nouveau', fichier: 'assets/staff-pages-v2.js', de: "toast('Posez votre question en quelques mots.')", vers: "toast('Pose ta question en quelques mots.')" },
  { nom: 'un imperatif singulier revient', fichier: 'assets/staff-pages-v2.js', de: "toast('Collez le texte du mail reçu.')", vers: "toast('Colle le texte du mail reçu.')" },
  { nom: 'un imperatif a pronom revient', fichier: 'assets/app-main.js', de: 'Retirez-la avec la croix.', vers: 'Retire-la avec la croix.' },
  { nom: 'un possessif dans un gabarit multiligne', fichier: 'assets/staff-pages-v2.js', de: '<h3>Ce que je sais de votre centre</h3>', vers: '<h3>Ce que je sais de ton centre</h3>' },
  { nom: 'une phrase du brief serveur tutoie', fichier: 'lib/marketing-brief.js', de: 'je garde un œil sur vos réservations', vers: 'je garde un œil sur tes réservations' },
  { nom: 'une legende client tutoie', fichier: 'lib/marketing-brain.js', de: 'Réservez votre créneau : 30 secondes.', vers: 'Réserve ton créneau : 30 secondes.' },
  { nom: 'le jargon revient', fichier: 'assets/staff-pages-v2.js', de: '${b.dataDays || 0} j sur 90</em>', vers: '${b.dataDays || 0} j de données, verdicts causaux vers 90 j</em>' },
  { nom: 'une page HTML tutoie', fichier: 'index.html', de: 'Réservation rapide', vers: 'Ta réservation rapide', toutes: true },
  { nom: 'un toast perd ses accents', fichier: 'assets/app-main.js', de: "'Rôle supprimé.'", vers: "'Role supprime.'" },
  { nom: 'un libelle de periode perd ses accents', fichier: 'assets/pinlane-daterange.js', de: "label: 'Cette année'", vers: "label: 'Cette annee'" },
  { nom: 'un aria-label de la page perd ses accents', fichier: 'index.html', de: 'sans quitter le plein écran', vers: 'sans quitter le plein ecran', toutes: true },
  { nom: 'une phrase de silence du brief perd ses accents', fichier: 'lib/marketing-brief.js', de: 'aucune réservation exploitable', vers: 'aucune reservation exploitable' },
  { nom: 'le vocabulaire du fournisseur revient', fichier: 'assets/staff-pages-v2.js', de: '<strong>Remise confirmée</strong>', vers: '<strong>Remise (accusés du fournisseur)</strong>' },
  { nom: 'l etiquette technique de validation revient', fichier: 'assets/admin-console.js', de: "    staff_review: 'À vérifier',", vers: "    staff_review: 'Validation staff'," },
  { nom: 'un separateur « • » revient', fichier: 'assets/booking-core.js', de: '${players} joueurs · ${waveCount} sessions', vers: '${players} joueurs • ${waveCount} sessions' },
  { nom: 'un outil du fondateur tutoie de nouveau', fichier: 'assets/founder-tarifs.js', de: "'Indiquez un prix per-pax entre 0 et 1000 EUR.'", vers: "'Indique un prix per-pax entre 0 et 1000 EUR.'" },
  { nom: 'un outil du fondateur perd ses accents', fichier: 'assets/founder-team.js', de: "toast('Rôle créé.')", vers: "toast('Role cree.')" },
  { nom: 'ops-console tutoie de nouveau', fichier: 'assets/ops-console.js', de: "toast('Lancez une simulation avant de valider.')", vers: "toast('Lance une simulation avant de valider.')" },
  { nom: 'ops-console reprend « Validation staff »', fichier: 'assets/ops-console.js', de: '<span class="ops-pill">À vérifier</span>', vers: '<span class="ops-pill">Validation staff</span>' },
];
let mordent = 0;
for (const m of MUTATIONS) {
  const src = sources[m.fichier];
  const lf = src.replace(/\r\n/g, '\n');
  const n = lf.split(m.de).length - 1;
  if (n < 1 || (!m.toutes && n !== 1)) {
    console.log(`  FAIL contre-epreuve DESARMEE : « ${m.nom} » (ancre trouvee ${n} fois dans ${m.fichier})`);
    echecs += 1;
    continue;
  }
  const mutees = { ...sources, [m.fichier]: m.toutes ? lf.split(m.de).join(m.vers) : lf.replace(m.de, m.vers) };
  const hits = tout(mutees);
  if (hits.length > 0) { mordent += 1; console.log(`  ok   « ${m.nom} » : le gate rougit (${hits[0]})`); }
  else { echecs += 1; console.log(`  FAIL « ${m.nom} » : la mutation passe inapercue`); }
}
console.log(`voix-pro-check --contre-preuves: ${mordent}/${MUTATIONS.length} mordent`);
process.exit(echecs ? 1 : 0);
