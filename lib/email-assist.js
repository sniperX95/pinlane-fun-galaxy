'use strict';

// LES AIDES D ECRITURE DES MAILS (2026-11-10, Emails & relances refait). Une seule porte pour toutes les aides IA
// de la page, depuis n importe quel editeur : nouveau message, reponse a un client, modele, mail automatique d une
// sequence, campagne. L IA reformule et propose, elle n invente jamais un fait : seuls les faits du centre passes
// ici et le texte de l equipe peuvent apparaitre, et ses variables {{...}} restent celles du texte. Sans cle IA,
// chaque aide rend ce qu une regle sait faire, et le dit.
const { llmProvider, callLlmJson } = require('./llm-client');
const { analyzeDraft } = require('./email-studio');

const INTENTIONS = {
  ecrire: 'Écris le mail à partir de la demande de l\'équipe (brief), prêt à envoyer.',
  ameliorer: 'Améliore le brouillon : plus clair, plus engageant, même sens et mêmes faits.',
  raccourcir: 'Raccourcis le brouillon d\'environ moitié : garde l\'essentiel et l\'action demandée au client.',
  chaleureux: 'Rends le ton plus chaleureux et humain, sans familiarité ni tutoiement.',
  formel: 'Rends le ton plus professionnel et posé, sans raideur.',
  nl: 'Traduis le mail en néerlandais de Belgique, naturel, en gardant le vouvoiement (u).',
  en: 'Traduis le mail en anglais, naturel et poli.',
  objets: 'Propose trois objets de mail différents, de 30 à 60 caractères, fidèles au contenu.',
};
const CONTEXTES = {
  message: 'un message unique envoyé à un client',
  reponse: 'une réponse à un mail reçu d\'un client',
  modele: 'un modèle que l\'équipe réutilisera',
  sequence: 'un mail automatique d\'une séquence, envoyé à beaucoup de clients',
  campagne: 'une campagne envoyée à une liste de clients',
};
const TRANSFORMENT = new Set(['ameliorer', 'raccourcir', 'chaleureux', 'formel', 'nl', 'en']);
const LIMITES = { subject: 300, body: 8000, brief: 1000, recu: 8000 };
const VARIABLE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

function nettoyer(valeur, max) {
  return String(valeur == null ? '' : valeur).replace(/[\u0000-\u0008\u000b-\u001f]+/g, ' ').trim().slice(0, max);
}
function variablesDe(texte) {
  const vues = new Set();
  String(texte || '').replace(VARIABLE, (m, nom) => { vues.add(nom.toLowerCase()); return m; });
  return vues;
}
function phrases(texte) {
  return String(texte || '').split(/(?<=[.!?…])\s+/).map((p) => p.trim()).filter(Boolean);
}
function objetDe(texte) {
  const premiere = (phrases(String(texte || '').replace(VARIABLE, '').trim())[0] || '').replace(/[.!?…]+$/, '').trim();
  if (premiere.length <= 60) return premiere;
  return `${premiere.slice(0, 57).replace(/\s+\S*$/, '')}…`;
}

// Les faits du centre que l IA peut citer : son nom et ses coordonnees publiques, rien d autre.
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
  return { subject, body, objets: [], conseils: conseilsAuVous(analyzeDraft({ subject, body })), note: 'Sans IA, le texte ne se réécrit pas. Voici ce qu\'une relecture conseille.' };
}

// La reponse de l IA ne passe que si elle tient la regle : aucun texte vide, les variables du texte gardees, aucune
// variable nouvelle (sauf {{prenom}} pour saluer, quand l IA ecrit), et un texte raccourci plus court que l autre.
function reponseTenue({ intention, subject, body, brief }, rep) {
  if (!rep || typeof rep !== 'object') return false;
  if (intention === 'objets') {
    const objets = Array.isArray(rep.objets) ? rep.objets.map((o) => nettoyer(o, 120)).filter((o) => o.length >= 8) : [];
    if (new Set(objets).size < 3) return false;
    const permises = new Set([...variablesDe(subject), ...variablesDe(body), 'prenom']);
    return objets.every((o) => [...variablesDe(o)].every((v) => permises.has(v)));
  }
  const corps = nettoyer(rep.body, LIMITES.body + 2000);
  if (!corps || !nettoyer(rep.subject, LIMITES.subject)) return false;
  const avant = new Set([...variablesDe(subject), ...variablesDe(body), ...variablesDe(brief)]);
  if (TRANSFORMENT.has(intention) && [...variablesDe(body)].some((v) => !variablesDe(corps).has(v))) return false;
  const permises = new Set([...avant, ...(intention === 'ecrire' ? ['prenom'] : [])]);
  if ([...variablesDe(`${rep.subject} ${corps}`)].some((v) => !permises.has(v))) return false;
  if (intention === 'raccourcir' && corps.length >= body.length) return false;
  return true;
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
  if (intention !== 'ecrire' && !body && !(intention === 'objets' && (subject || brief))) return { ok: false, message: 'Écrivez d\'abord le texte du mail.' };
  return { ok: true, demande: { intention, contexte, subject, body, brief, recu, faits: faitsDuCentre(entree.center) } };
}

// Sans IA, tout de suite : ce que sert aussi le serveur de developpement (scripts/dev-console-server.js).
function aideSansIa(entree = {}) {
  const lu = lireDemande(entree);
  if (!lu.ok) return lu;
  return { ok: true, mode: 'regles', intention: lu.demande.intention, ...sansIa(lu.demande) };
}

async function aiderAEcrire(entree = {}) {
  const lu = lireDemande(entree);
  if (!lu.ok) return lu;
  const demande = lu.demande;
  const { intention, contexte, subject, body, brief, recu, faits } = demande;

  if (llmProvider()) {
    const { COPY_SYSTEM_CORE, channelPlaybook, COPY_FINAL_REMINDER } = require('./copy-playbook');
    const langue = intention === 'nl' ? 'néerlandais' : intention === 'en' ? 'anglais' : 'français';
    const rep = await callLlmJson({
      stableSystem: [
        `Tu aides l'équipe de ${faits.nom} (centre de loisirs, Belgique) à écrire ses mails aux clients.`,
        `Le texte est ${CONTEXTES[contexte]}.`,
        INTENTIONS[intention],
        'INTERDIT : inventer un prix, une date, une heure, une promotion, une activité, une disponibilité ou un chiffre qui ne figure ni dans les faits du centre ni dans le texte fourni. Les faits du centre sont les seuls que tu peux citer.',
        `Conserve les variables {{...}} telles quelles et n'en crée aucune nouvelle${intention === 'ecrire' ? ', sauf {{prenom}} pour saluer le client' : ''}.`,
        'Vouvoie le client. Phrases courtes, un fait par phrase, aucune formule creuse.',
        `Langue du mail : ${langue}.`,
        COPY_SYSTEM_CORE,
        channelPlaybook('email'),
        'Réponds UNIQUEMENT en JSON conforme au schéma : subject, body en texte simple avec sauts de ligne, objets (trois objets pour l\'intention objets, sinon une liste vide).',
      ].join('\n\n'),
      user: JSON.stringify({ demande: brief, mailRecu: recu, objet: subject, texte: body, faitsDuCentre: faits, rappel: COPY_FINAL_REMINDER }),
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { subject: { type: 'string' }, body: { type: 'string' }, objets: { type: 'array', items: { type: 'string' } } },
        required: ['subject', 'body', 'objets'],
      },
      schemaName: 'email_assist',
      maxTokens: 1400,
      timeoutMs: 16000,
      openaiModel: process.env.OPENAI_DIRECTION_MODEL || 'gpt-4o-mini',
    });
    if (reponseTenue(demande, rep)) {
      if (intention === 'objets') {
        return { ok: true, mode: 'ia', intention, subject, body, objets: rep.objets.map((o) => nettoyer(o, 120)).slice(0, 3), conseils: [], note: '' };
      }
      return { ok: true, mode: 'ia', intention, subject: nettoyer(rep.subject, LIMITES.subject), body: nettoyer(rep.body, LIMITES.body + 2000), objets: [], conseils: [], note: '' };
    }
  }
  return { ok: true, mode: 'regles', intention, ...sansIa(demande) };
}

module.exports = { aiderAEcrire, aideSansIa, INTENTIONS, CONTEXTES, faitsDuCentre, reponseTenue };
