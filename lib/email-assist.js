'use strict';

// LES AIDES D ECRITURE DES MAILS (2026-11-10, refaites le 2026-11-13). Une seule porte pour toutes les aides IA de
// la page, depuis n importe quel editeur : nouveau message, reponse a un client, modele, mail automatique d une
// sequence, campagne.
//
// UNE CONVERSATION, PAS UN BOUTON (Ansar, 2026-11-12 : « tu vois pas le message de l'IA, tu sais pas corriger direct
// depuis la conv », « les mails sont trop faibles »). L equipe demande un mail, l IA l ecrit et DIT en une phrase ce
// qu elle a fait (`message`), l equipe corrige en une phrase (« plus court », « remets le prix »), et l IA reprend le
// mail ACTUEL avec la conversation sous les yeux (`historique`).
//
// LES MAILS ETAIENT FAIBLES POUR TROIS RAISONS, toutes corrigees ici :
//   1. le modele : le petit modele marketing par defaut. Ici le meilleur (Opus 5.5, effort bas : un mail est court) ;
//   2. les faits : il ne connaissait du centre que son nom et son telephone, donc il ecrivait « les pistes vous
//      attendent ». Il recoit maintenant les memes faits que l agent qui repond aux clients (`faits`, lus par
//      api/ops.js dans lib/email-agent buildEmailBrain) : activites, formules et prix valides par le moteur, jours
//      d ouverture, ce que l equipe a appris a l agent ;
//   3. la doctrine : celle des publications (accroche de 125 signes, emojis). Un mail a la sienne, ci-dessous.
//
// L IA reformule et propose, elle n invente jamais un fait : chaque nombre qu elle ecrit doit exister dans les faits,
// le texte de l equipe ou la conversation (lib/email-verifications controlerLaReponse, le controle de l agent des
// mails), et ses variables {{...}} restent celles du texte. Une reponse qui ne tient pas la regle ne remplace RIEN :
// la porte le dit, le brouillon reste tel quel. Sans cle IA, chaque aide rend ce qu une regle sait faire, et le dit.
const { llmProvider, callLlmJson } = require('./llm-client');
const { analyzeDraft } = require('./email-studio');
// La regle d ecriture de TOUS les textes clients du produit (retour de Seb, 2026-09-18), lue a sa source : la
// consigne ne peut pas s en ecarter.
const { PRONOMS_INTERDITS, TOURNURES_FAMILIERES } = require('./client-writing');

// Le modele des mails ecrits avec l equipe : la qualite d abord, un mail coute quelques centimes et l equipe en
// ecrit quelques-uns par jour. Effort bas : un mail de cent mots ne demande pas une longue reflexion, et l equipe
// attend la reponse. Un refus du classifieur repasse sur le modele de secours du serveur (fallbacks « default »).
const MODELE = 'claude-opus-5-5';
const EFFORT = 'low';
// Sous le maxDuration de api/ops.js (vercel.json : 60 s), lecture des faits comprise.
const DELAI_MS = 45000;
const BUDGET = 'assistant';

const INTENTIONS = {
  ecrire: 'Écris le mail que demande l\'équipe, prêt à envoyer.',
  corriger: 'Reprends le mail actuel et applique la demande de l\'équipe. Change ce qu\'elle demande, garde le reste tel quel.',
  adapter: 'Reprends ce mail et adapte-le à ce centre avec ses vrais faits (ses activités, ses formules et leurs prix, ses jours d\'ouverture) quand ils servent le mail. Garde son intention et sa longueur.',
  ameliorer: 'Améliore le mail : plus clair, plus concret, plus envie de venir. Même intention, mêmes faits.',
  raccourcir: 'Raccourcis le mail d\'environ moitié. Garde la raison du mail et l\'action demandée au client.',
  chaleureux: 'Rends le ton plus chaleureux et humain, sans familiarité ni tutoiement.',
  formel: 'Rends le ton plus professionnel et posé, sans raideur.',
  nl: 'Traduis le mail en néerlandais de Belgique, naturel, en vouvoyant (u). Ton message à l\'équipe reste en français.',
  en: 'Traduis le mail en anglais, naturel et poli. Ton message à l\'équipe reste en français.',
  objets: 'Propose trois objets de mail différents, de 30 à 55 signes, fidèles au contenu. Le texte ne change pas.',
};
// Ce que chaque geste dit quand l IA ne rend pas de message (jamais vide a l ecran).
const MESSAGE_PAR_DEFAUT = {
  ecrire: 'Voici le mail.', corriger: 'C\'est changé.', adapter: 'J\'ai adapté le mail à votre centre.', ameliorer: 'J\'ai amélioré le mail.',
  raccourcir: 'J\'ai raccourci le mail.', chaleureux: 'J\'ai rendu le ton plus chaleureux.', formel: 'J\'ai rendu le ton plus professionnel.',
  nl: 'J\'ai traduit le mail en néerlandais.', en: 'J\'ai traduit le mail en anglais.', objets: 'Voici trois objets.',
};
const CONTEXTES = {
  message: 'un message unique envoyé à un client',
  reponse: 'une réponse à un mail reçu d\'un client',
  modele: 'un modèle que l\'équipe réutilisera',
  sequence: 'un mail automatique d\'une séquence, envoyé à beaucoup de clients',
  campagne: 'une campagne envoyée à une liste de clients',
};
const CONTEXTE_DIT = {
  message: 'Ce mail part à un seul client, écrit par une personne de l\'équipe.',
  reponse: 'C\'est la réponse au mail d\'un client (mail_du_client). Réponds précisément à ce qu\'il demande, sans rien promettre que les faits ne permettent.',
  modele: 'C\'est un modèle que l\'équipe réutilisera pour beaucoup de clients : rien de propre à un seul client, à part {{prenom}}.',
  sequence: 'C\'est un mail automatique envoyé à beaucoup de clients au bon moment. Il reste sobre, sans aucun mot de promotion.',
  campagne: 'C\'est une campagne envoyée à une liste de clients. Elle peut porter une offre quand les faits ou l\'équipe la donnent. Sa ligne de désinscription s\'ajoute toute seule.',
};
// Le geste porte sur le texte qui est la : il garde ses variables (une correction libre peut en retirer une, si
// l equipe le demande).
const TRANSFORMENT = new Set(['ameliorer', 'raccourcir', 'chaleureux', 'formel', 'nl', 'en', 'adapter']);
// Ecrire ou corriger a partir d une phrase : l IA peut saluer avec {{prenom}} et nommer le centre avec {{centre}}.
const ECRIVENT = new Set(['ecrire', 'corriger', 'adapter', 'ameliorer', 'chaleureux', 'formel']);
const LIMITES = { subject: 300, body: 8000, brief: 1000, recu: 8000, faits: 14000, tour: 600, tours: 10, message: 600 };
const VARIABLE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
// Ce qui envoie un mail en promotions ou en spam, ou sonne faux, quand l equipe ne l a pas ecrit elle-meme.
const MOTS_INTERDITS = /\b(gratuit|gratuite|gratuits|gratuites|promo|offre exceptionnelle|urgent|derni[eè]re chance|cliquez ici|n['’]h[ée]sitez pas|n['’]attendez plus|ne manquez pas|inoubliable)\b/i;

function nettoyer(valeur, max) {
  return String(valeur == null ? '' : valeur).replace(/[\u0000-\u0008\u000b-\u001f]+/g, ' ').trim().slice(0, max);
}
// Le message de l IA a l equipe, borne a la fin d une phrase : jamais une question coupee en deux a l ecran.
function messageBorne(texte, max = LIMITES.message) {
  const t = nettoyer(texte, 4000).replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const coupe = t.slice(0, max);
  const fin = Math.max(coupe.lastIndexOf('. '), coupe.lastIndexOf('? '), coupe.lastIndexOf('! '));
  return fin > max / 3 ? coupe.slice(0, fin + 1) : `${coupe.replace(/\s+\S*$/, '')}…`;
}
// Jamais de tiret long : c est la marque d un texte ecrit par une IA (doctrine du produit, gate no-em-dash).
function sansTiretsLongs(texte) {
  return String(texte || '').replace(/[ \t]*[\u2013\u2014][ \t]*/g, ', ').replace(/, ,/g, ',');
}
function variablesDe(texte) {
  const vues = new Set();
  String(texte || '').replace(VARIABLE, (m, nom) => { vues.add(nom.toLowerCase()); return m; });
  return vues;
}
function phrases(texte) {
  return String(texte || '').split(/(?<=[.!?…])\s+/).map((p) => p.trim()).filter(Boolean);
}
// L objet tire du texte : sa premiere vraie phrase, jamais la salutation (« Bonjour {{prenom}}, » donnait l objet
// « Bonjour , »), sur une seule ligne.
function objetDe(texte) {
  const lignes = String(texte || '').replace(VARIABLE, '').split(/\n+/).map((l) => l.trim())
    .filter((l) => l && !/^(bonjour|bonsoir|hello|cher|chère|madame|monsieur)\b[^.!?…]{0,40}$/i.test(l));
  const premiere = (phrases(lignes.join(' '))[0] || '').replace(/[.!?…]+$/, '').trim();
  if (premiere.length <= 60) return premiere;
  return `${premiere.slice(0, 57).replace(/\s+\S*$/, '')}…`;
}

// Les faits du centre toujours connus, meme sans base : son nom et ses coordonnees publiques.
function faitsDuCentre(center) {
  const c = center && typeof center === 'object' ? center : {};
  const info = c.publicInfo && typeof c.publicInfo === 'object' ? c.publicInfo : {};
  const identite = c.identity && typeof c.identity === 'object' ? c.identity : {};
  const faits = { nom: nettoyer(c.name || 'votre centre', 120) };
  if (typeof info.address === 'string' && info.address.trim()) faits.adresse = nettoyer(info.address, 200);
  if (typeof info.phone === 'string' && info.phone.trim()) faits.telephone = nettoyer(info.phone, 40);
  if (typeof info.parking === 'string' && info.parking.trim()) faits.parking = nettoyer(info.parking, 120);
  if (typeof identite.siteUrl === 'string' && /^https:\/\//.test(identite.siteUrl)) faits.site = nettoyer(identite.siteUrl, 300);
  return faits;
}

// La signature s ajoute-t-elle sous ce mail ? La meme regle que l envoi (ops-communications habillageDe) : la
// portee du design du centre. Un mail ecrit a la main signe la personne, une sequence l equipe ; une campagne
// n est signee que si le centre l a voulu.
function signatureAjouteePour(design, contexte) {
  const d = design && typeof design === 'object' ? design : null;
  if (!d) return true;
  if (d.signature && typeof d.signature === 'object' && d.signature.enabled === false) return false;
  const portee = { sequence: 'sequences', campagne: 'campaigns' }[contexte] || 'manual';
  const scope = d.signatureScope && typeof d.signatureScope === 'object' ? d.signatureScope : {};
  return scope[portee] === true;
}

// Les jours qui viennent, ecrits comme un mail les ecrit : « samedi 15 novembre » est un fait du calendrier, pas
// un chiffre invente. Ils entrent dans la source du controle des nombres, pas dans le prompt.
function calendrierProche(instant = Date.now(), jours = 75) {
  const fmt = new Intl.DateTimeFormat('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' });
  const court = new Intl.DateTimeFormat('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Brussels' });
  const lignes = [];
  for (let i = 0; i < jours; i += 1) {
    const d = new Date(instant + i * 86400000);
    lignes.push(`${fmt.format(d)} ${court.format(d)}`);
  }
  return lignes.join('\n');
}

// Les conseils de relecture (lib/email-studio), dits au « vous » comme le reste de la console.
const AU_VOUS = [[/^Ajoute /, 'Ajoutez '], [/: vise /g, ': visez '], [/mixe la casse/, 'mélangez les majuscules et les minuscules'], [/: ajoute /g, ': ajoutez '], [/: termine /g, ': terminez '], [/: reformule /g, ': reformulez '], [/: coupe /g, ': coupez '], [/, aère /g, ', aérez '], [/Relis /, 'Relisez '], [/Continue /, 'Continuez ']];
function conseilsAuVous(conseils) {
  return conseils.map((c) => AU_VOUS.reduce((t, [motif, par]) => t.replace(motif, par), c));
}

// Ce qu une regle sait faire sans IA, et la phrase qui le dit.
function sansIa({ intention, contexte, subject, body, brief, faits }) {
  if (intention === 'ecrire') {
    const demande = brief ? phrases(brief.replace(/\s+/g, ' ')).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') : 'Merci pour votre message';
    const fin = /[.!?…]$/.test(demande) ? '' : '.';
    const salut = contexte === 'reponse' ? 'Bonjour,' : 'Bonjour {{prenom}},';
    return {
      subject: objetDe(brief) || subject,
      body: `${salut}\n\n${demande}${fin}\n\nÀ bientôt,\nL'équipe de ${faits.nom}`,
      objets: [],
      conseils: [],
      note: 'Sans IA, votre demande est posée telle quelle dans un mail simple. Relisez-le avant l\'envoi.',
    };
  }
  if (intention === 'raccourcir') {
    const court = body.split(/\n\s*\n/).map((p) => {
      const ph = phrases(p.replace(/\s*\n\s*/g, ' '));
      return ph.slice(0, Math.max(1, Math.ceil(ph.length / 2))).join(' ');
    }).filter(Boolean).join('\n\n');
    return { subject, body: court || body, objets: [], conseils: [], note: 'Sans IA, chaque paragraphe garde sa première moitié. Relisez la fin du mail.' };
  }
  if (intention === 'objets') {
    const objet = objetDe(subject || body || brief);
    return { subject, body, objets: objet ? [objet] : [], conseils: [], note: 'Sans IA, un seul objet, tiré de votre texte.' };
  }
  if (intention === 'nl' || intention === 'en') {
    return { subject, body, objets: [], conseils: [], note: 'La traduction demande l\'IA, qui n\'est pas branchée pour ce centre.' };
  }
  if (intention === 'corriger' || intention === 'adapter') {
    return { subject, body, objets: [], conseils: [], note: 'Sans IA, je ne sais pas réécrire votre mail. Il reste tel quel, modifiez-le directement dans le texte.' };
  }
  return { subject, body, objets: [], conseils: conseilsAuVous(analyzeDraft({ subject, body })), note: 'Sans IA, le texte ne se réécrit pas. Voici ce qu\'une relecture conseille.' };
}

// La conversation lue et bornee : les derniers tours, l equipe et l aide, rien d autre.
function lireHistorique(brut) {
  const tours = (Array.isArray(brut) ? brut : [])
    .map((t) => ({ qui: t && t.qui === 'aide' ? 'aide' : 'equipe', texte: nettoyer(t && t.texte, LIMITES.tour) }))
    .filter((t) => t.texte);
  return tours.slice(-LIMITES.tours);
}

// La reponse de l IA ne passe que si elle tient la regle. Rend la raison du refus, ou '' quand elle passe : aucun
// texte vide, les variables du texte gardees, aucune variable nouvelle (sauf {{prenom}} et {{centre}} quand l IA
// ecrit), un texte raccourci plus court que l autre, aucun nombre ni contact hors des faits, aucun mot de spam
// que l equipe n a pas ecrit.
function refusDeLaReponse({ intention, contexte, subject, body, brief, recu, faits, historique, center }, rep, deps = {}) {
  if (!rep || typeof rep !== 'object') return 'L\'IA n\'a pas répondu à temps. Votre texte n\'a pas changé, réessayez dans un instant.';
  const permisesEnPlus = ECRIVENT.has(intention) ? ['prenom', 'centre'] : [];
  if (intention === 'objets') {
    const objets = Array.isArray(rep.objets) ? rep.objets.map((o) => nettoyer(o, 120)).filter((o) => o.length >= 8) : [];
    if (new Set(objets).size < 3) return 'L\'IA n\'a pas trouvé trois objets différents. Réessayez dans un instant.';
    const permises = new Set([...variablesDe(subject), ...variablesDe(body), 'prenom']);
    if (!objets.every((o) => [...variablesDe(o)].every((v) => permises.has(v)))) return 'Un objet proposé utilisait une variable qui n\'existe pas. Rien n\'a changé.';
    return '';
  }
  const corps = nettoyer(rep.body, LIMITES.body + 2000);
  if (!corps || !nettoyer(rep.subject, LIMITES.subject)) return 'L\'IA a rendu un mail vide. Votre texte n\'a pas changé.';
  const avant = new Set([...variablesDe(subject), ...variablesDe(body), ...variablesDe(brief)]);
  // {{centre}} peut partir avec la ligne « L'équipe {{centre}} » : la signature du centre la remplace (mesure du
  // 2026-11-13, « Adapter à mon centre » refuse sur le modele de Pinlane pour cette seule ligne). Les autres
  // variables portent une donnee du client ou de sa reservation, elles restent.
  if (TRANSFORMENT.has(intention)) {
    const perdues = [...variablesDe(body)].filter((v) => v !== 'centre' && !variablesDe(corps).has(v));
    if (perdues.length) return `L'IA a perdu ${perdues.map((v) => `{{${v}}}`).join(', ')}. Votre texte n'a pas changé.`;
  }
  const permises = new Set([...avant, ...permisesEnPlus]);
  const inventees = [...variablesDe(`${rep.subject} ${corps}`)].filter((v) => !permises.has(v));
  if (inventees.length) return `L'IA a inventé ${inventees.map((v) => `{{${v}}}`).join(', ')}, qui ne se remplirait pas. Votre texte n'a pas changé.`;
  if (intention === 'raccourcir' && corps.length >= body.length) return 'Le texte proposé n\'était pas plus court. Votre texte n\'a pas changé.';
  const ecritParLEquipe = `${subject}\n${body}\n${brief}`;
  const spam = `${rep.subject}\n${corps}`.match(MOTS_INTERDITS);
  if (spam && !MOTS_INTERDITS.test(ecritParLEquipe) && contexte !== 'campagne') {
    return `L'IA a écrit « ${spam[0]} », un mot qui envoie les mails en promotions ou en spam. Votre texte n'a pas changé, réessayez.`;
  }
  // CHAQUE NOMBRE A SA SOURCE. Le meme controle que l agent qui repond aux clients : un prix, une heure, un
  // telephone ou une adresse que ni les faits, ni l equipe, ni le calendrier ne donnent, et le mail ne passe pas.
  const verifier = deps.controlerLaReponse || require('./email-verifications').controlerLaReponse;
  const fiche = faitsDuCentre(center);
  const source = [faits, ecritParLEquipe, recu, historique.map((t) => t.texte).join('\n'), Object.values(fiche).join('\n'), deps.calendrier || calendrierProche()].join('\n');
  const controle = verifier(`${rep.subject}\n${corps}`, source);
  if (controle && controle.ok === false) {
    const cite = [...(controle.nombres || []), ...(controle.contacts || [])].slice(0, 3).join(', ');
    return `L'IA citait ${cite ? `« ${cite} »` : 'un chiffre'}, absent des infos du centre et de votre demande. Votre texte n'a pas changé. Donnez ce chiffre dans votre demande si c'est le bon.`;
  }
  return '';
}

// Le texte de l ancien controle (true quand la reponse passe), garde pour les appelants qui n ont besoin que du oui.
function reponseTenue(demande, rep, deps) {
  return !refusDeLaReponse({ historique: [], faits: '', recu: '', ...demande }, rep, deps);
}

// La demande lue et bornee, ou le refus a dire.
function lireDemande(entree = {}) {
  const intention = String(entree.intention || '');
  if (!INTENTIONS[intention]) return { ok: false, message: 'Cette aide n\'existe pas.' };
  const contexte = CONTEXTES[entree.contexte] ? entree.contexte : 'message';
  const subject = nettoyer(entree.subject, LIMITES.subject);
  const body = nettoyer(entree.body, LIMITES.body);
  const brief = nettoyer(entree.brief, LIMITES.brief);
  const recu = nettoyer(entree.recu, LIMITES.recu);
  if (intention === 'ecrire' && !brief && !recu) return { ok: false, message: 'Dites en quelques mots ce que le mail doit dire.' };
  if (intention === 'corriger' && !brief) return { ok: false, message: 'Dites en quelques mots ce qu\'il faut changer.' };
  if (intention !== 'ecrire' && !body && !(intention === 'objets' && (subject || brief))) return { ok: false, message: 'Écrivez d\'abord le texte du mail.' };
  return {
    ok: true,
    demande: {
      intention, contexte, subject, body, brief, recu,
      historique: lireHistorique(entree.historique),
      faits: nettoyer(entree.faits, LIMITES.faits),
      signatureAjoutee: entree.signatureAjoutee !== false,
      center: entree.center || null,
      nom: faitsDuCentre(entree.center).nom,
    },
  };
}

// LA CONSIGNE STABLE : la meme pour tous les appels d un centre et d un editeur (cache de prefixe). Ce qui change
// a chaque appel (les faits du jour, la conversation, le mail) part dans le message, apres.
function consigneSysteme({ nom, contexte, signatureAjoutee }) {
  return [
    '<mandat>',
    `Tu écris les mails de l'équipe de ${nom}, un centre de loisirs en Belgique. Ton seul objectif : un mail qui donne envie au client de venir ou de répondre, et qui lui dit exactement quoi faire. Tu es jugé sur ce que le client fera en le lisant, pas sur la beauté des phrases.`,
    'Tu travailles avec l\'équipe dans une conversation. Elle te demande un mail, tu l\'écris. Elle te demande un changement, tu le fais. Tu n\'es pas un béni-oui-oui : si une demande donnerait un mauvais mail (un mot qui envoie en spam, une promesse que les faits ne permettent pas, un prix qui n\'existe pas), tu écris le meilleur mail possible sans ce défaut et tu le dis franchement dans ton message.',
    '</mandat>',
    '',
    '<faits>',
    'Tu n\'écris QUE ce que disent les faits du centre, le texte de l\'équipe, sa demande ou la conversation. Une activité, un prix, une durée, un horaire, une date, une promotion ou une disponibilité qui n\'y figure pas n\'existe pas : tu ne l\'écris jamais, même si c\'est courant ailleurs. Un prix se cite avec sa condition (par personne, dès 6 enfants, en semaine). Tu ne calcules jamais un prix.',
    'Il te manque une information que seule l\'équipe connaît (la date d\'une offre, un montant) : écris le mail sans elle et demande-la dans ton message. Ne laisse ni crochets ni trous dans le mail.',
    'Les variables entre doubles accolades ({{prenom}}, {{centre}}, {{date}}) se remplissent toutes seules à l\'envoi. Garde celles du texte telles quelles. Tu peux ajouter {{prenom}} pour saluer et {{centre}} pour nommer le centre. N\'en crée aucune autre.',
    '</faits>',
    '',
    '<ecriture>',
    CONTEXTE_DIT[contexte] || CONTEXTE_DIT.message,
    'L\'objet fait 30 à 55 signes. Il dit au client ce qui le concerne ou ce qu\'il y gagne, avec un mot concret (une activité, un moment, un prix des faits). Pas de point d\'exclamation, pas de mot entier en majuscules, pas d\'emoji.',
    'Salue le client (« Bonjour {{prenom}}, »). La phrase suivante donne la raison du mail, sans préambule, jamais « J\'espère que vous allez bien ».',
    'Un mail porte une idée et une action. Il finit sur cette action, dite simplement : répondre à ce mail, réserver en ligne, appeler le centre.',
    'Court : 50 à 120 mots pour un mail, 30 à 90 pour une réponse à un client. Des paragraphes d\'une à trois phrases, séparés par une ligne vide.',
    'Concret : les vraies activités du centre et ses vrais chiffres, quand ils servent la demande. « 18 € par enfant, dès 6 enfants » vaut mieux que « un prix doux ».',
    'Le ton est celui du gérant qui écrit à un client qu\'il connaît : chaleureux, simple, jamais publicitaire. Tu vouvoies toujours le client.',
    `Jamais ${PRONOMS_INTERDITS.map((r) => r.nom).join(' ni ')}, même accroché au verbe (« dites-nous », « appelez-nous »). Nomme le centre ou l'équipe (« L'équipe de {{centre}} vous propose… », « Toute l'équipe serait contente de vous revoir »), ou adresse-toi directement au client (« Répondez à ce mail », « Appelez le centre »). C'est la règle de tous les mails du centre.`,
    `Aucune tournure familière, notamment ${TOURNURES_FAMILIERES.map((r) => r.nom).join(', ')}.`,
    'Des phrases entières, un fait par phrase. Pas de liste à puces, pas de deux-points au milieu d\'une phrase, pas d\'énumération à la place d\'une phrase, pas de phrase finale en formule toute faite.',
    'Jamais de tiret long : une virgule ou un point à la place.',
    'Mots interdits, parce qu\'ils envoient le mail en promotions ou en spam ou qu\'ils sonnent faux : gratuit, promo, offre exceptionnelle, urgent, dernière chance, cliquez ici, n\'hésitez pas, n\'attendez plus, ne manquez pas, inoubliable, magique, incroyable, plongez, venez découvrir.',
    signatureAjoutee
      ? 'La signature du centre (formule de fin, équipe ou personne, coordonnées) s\'ajoute toute seule sous le texte. Termine donc sur l\'action, sans formule de politesse ni signature.'
      : 'Aucune signature ne s\'ajoute sous ce mail. Termine par une formule courte, puis « L\'équipe {{centre}} » sur la ligne suivante.',
    '</ecriture>',
    '',
    '<conversation>',
    'La conversation montre ce que l\'équipe t\'a déjà demandé et ce que tu as répondu. Une demande comme « encore plus court » ou « remets le prix » se lit avec elle. Quand on te demande de changer le mail, change ce qui est demandé et garde le reste mot pour mot.',
    '</conversation>',
    '',
    '<reponse>',
    'Rends un JSON. subject : l\'objet. body : le texte du mail, en texte simple, avec des sauts de ligne. message : à l\'équipe, en français, deux phrases courtes au plus (40 mots), au vous, qui disent ce que tu as fait et les faits que tu as utilisés, ou la question qu\'il te reste. objets : trois objets différents seulement quand on te les demande, sinon une liste vide.',
    'Exemple de message : « J\'ai raccourci le mail et gardé le prix du pack anniversaire, 18 € par enfant. »',
    '</reponse>',
    '',
    '<rappel>',
    'Rien hors des faits. Les variables gardées. Un mail court, une seule action, le client vouvoyé, jamais « nous » ni « on ». Aucun tiret long.',
    '</rappel>',
  ].join('\n');
}

function messageUtilisateur({ intention, contexte, subject, body, brief, recu, faits, historique, nom }) {
  const bloc = (balise, texte) => (texte ? `<${balise}>\n${texte}\n</${balise}>` : '');
  const conversation = historique.map((t) => `${t.qui === 'aide' ? 'Toi' : 'L\'équipe'} : ${t.texte}`).join('\n');
  const mail = subject || body ? `Objet : ${subject || '(pas encore d\'objet)'}\nTexte :\n${body || '(pas encore de texte)'}` : '';
  const tache = [
    INTENTIONS[intention],
    brief ? `Demande de l'équipe : « ${brief} »` : '',
    contexte === 'reponse' && !brief ? 'Écris la réponse au mail du client.' : '',
  ].filter(Boolean).join('\n');
  return [
    bloc('faits_du_centre', faits || `Nom du centre : ${nom}. Aucun autre fait n'est disponible : n'écris ni prix, ni horaire, ni activité précise.`),
    bloc('conversation', conversation),
    bloc('mail_du_client', recu),
    bloc('mail_actuel', mail),
    bloc('tache', tache),
  ].filter(Boolean).join('\n\n');
}

// Sans IA, tout de suite : ce que sert aussi le serveur de developpement (scripts/dev-console-server.js).
function aideSansIa(entree = {}) {
  const lu = lireDemande(entree);
  if (!lu.ok) return lu;
  const rendu = sansIa({ ...lu.demande, faits: faitsDuCentre(lu.demande.center) });
  return { ok: true, mode: 'regles', intention: lu.demande.intention, ...rendu, message: rendu.note };
}

async function aiderAEcrire(entree = {}, deps = {}) {
  const lu = lireDemande(entree);
  if (!lu.ok) return lu;
  const demande = lu.demande;
  const { intention, subject, body } = demande;
  // Une donnee de client (le mail qu il a ecrit, son prenom) ne va que chez Anthropic : usage 'mails'.
  if (!llmProvider('mails')) return aideSansIa(entree);
  // LA CAISSE DE L ASSISTANT DU GERANT (lib/llm-budget, plafond LLM_ASSISTANT_BUDGET_USD) : l aide a l ecriture
  // est une conversation du gerant, comme l assistant Marketing. Jamais la caisse des mails des clients, qu une
  // semaine d ecriture viderait. Caisse vide : on le dit, rien ne change.
  if (require('./llm-budget').isBudgetExhausted(BUDGET)) {
    return { ok: false, refus: true, message: 'Le budget IA du mois est atteint. Votre texte n\'a pas changé, vous pouvez l\'écrire directement.' };
  }

  const rep = await callLlmJson({
    stableSystem: consigneSysteme(demande),
    user: messageUtilisateur(demande),
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subject: { type: 'string' }, body: { type: 'string' }, message: { type: 'string' }, objets: { type: 'array', items: { type: 'string' } },
      },
      required: ['subject', 'body', 'message', 'objets'],
    },
    schemaName: 'email_assist',
    model: MODELE,
    effort: EFFORT,
    fallbacks: 'default',
    maxTokens: 4000,
    timeoutMs: DELAI_MS,
    usage: 'mails',
    budget: BUDGET,
  });
  const propre = rep && typeof rep === 'object'
    ? { ...rep, subject: sansTiretsLongs(rep.subject), body: sansTiretsLongs(rep.body), objets: Array.isArray(rep.objets) ? rep.objets.map(sansTiretsLongs) : [] }
    : rep;
  const refus = refusDeLaReponse(demande, propre, deps);
  if (refus) return { ok: false, refus: true, message: refus };
  const message = messageBorne(sansTiretsLongs(propre.message)) || MESSAGE_PAR_DEFAUT[intention];
  if (intention === 'objets') {
    return { ok: true, mode: 'ia', intention, subject, body, objets: propre.objets.map((o) => nettoyer(o, 120)).slice(0, 3), conseils: [], note: '', message };
  }
  return { ok: true, mode: 'ia', intention, subject: nettoyer(propre.subject, LIMITES.subject), body: nettoyer(propre.body, LIMITES.body + 2000), objets: [], conseils: [], note: '', message };
}

module.exports = {
  aiderAEcrire, aideSansIa, INTENTIONS, CONTEXTES, MODELE, faitsDuCentre, reponseTenue, refusDeLaReponse,
  signatureAjouteePour, calendrierProche, consigneSysteme, messageUtilisateur, sansTiretsLongs,
};
