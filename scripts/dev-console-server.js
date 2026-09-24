#!/usr/bin/env node
'use strict';
/* ============================================================================
   SERVEUR DE DEVELOPPEMENT DE LA CONSOLE (spec emails v4 §5.5)

   Sert la console (fichiers statiques du depot) sur 127.0.0.1:4260 avec une
   session staff simulee et un /api/ops repondu par des FIXTURES conformes aux
   contrats §3.7 : trois conversations (messages recus et envoyes, lectures,
   evenements du fournisseur, prise de main), une dizaine d envoyes d origines
   variees, les sequences, le design des mails, les identites, les questions
   de l agent. Aucun reseau, aucune base, aucun secret.

   Usage : node scripts/dev-console-server.js [--port=4260] [--reel]
   Puis ouvrir http://127.0.0.1:4260/#/staff/emails/apercu

   POURQUOI des fixtures et pas la vraie base : la verification visuelle et
   les gates UI doivent tourner sans Postgres ni fournisseur de mail, avec un
   jeu de donnees STABLE d une capture a l autre. Le mode --reel (le vrai
   api/ops.js sur une base en memoire) a sa couture ci-dessous, pas encore
   branchee : le serveur le dit au lieu de faire semblant.
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARGS = process.argv.slice(2);
const argument = (nom, defaut) => {
  const brut = ARGS.find((a) => a.startsWith(`--${nom}=`));
  return brut ? brut.slice(nom.length + 3) : defaut;
};
const PORT = Number(argument('port', process.env.PINLANE_DEV_PORT || 4260));
const HOST = '127.0.0.1';
const MODE = ARGS.includes('--reel') ? 'reel' : 'fixtures';
const CENTER_ID = 'libramont';
const AUTH_KEY = 'funGalaxy_auth_v1';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
};

/* ── LA SESSION SIMULEE (meme mecanisme que les gates UI : localStorage +
   /api/staff-auth qui la confirme) ────────────────────────────────────── */
const PERMISSIONS = ['dashboard.view', 'planning.view', 'reservations.view', 'reservations.create', 'clients.view', 'clients.edit',
  'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents', 'settings.manage', 'direction.view', 'exports.download'];
const MOI = { id: 'dev-moi', name: 'Camille Dev', roleId: 'direction', role: 'Direction', contact: 'camille@dev.local' };
function sessionSimulee() {
  return {
    token: 'dev-console', cookieBacked: false, centerId: CENTER_ID,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    member: { id: MOI.id, name: MOI.name, roleId: MOI.roleId },
    role: { id: 'direction', name: 'Direction', locked: true },
    permissions: PERMISSIONS,
  };
}
function accessControlSimule() {
  const maintenant = new Date().toISOString();
  return {
    selectedRoleId: 'direction', selectedMemberId: MOI.id,
    roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: maintenant, locked: true, permissions: PERMISSIONS }],
    members: [{ id: MOI.id, name: MOI.name, contact: MOI.contact, roleId: 'direction', status: 'active', code: 'X', lastSeen: maintenant }],
    events: [], permissions: PERMISSIONS,
  };
}

/* ── OUTILS ─────────────────────────────────────────────────────────────── */
const ilYA = (ms) => new Date(Date.now() - ms).toISOString();
const dans = (ms) => new Date(Date.now() + ms).toISOString();
const H = 3600 * 1000;
const J = 24 * H;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (value) => JSON.parse(JSON.stringify(value));
const sujetSansPrefixe = (sujet) => String(sujet || '').replace(/^\s*(?:(?:re|r[ée]|fwd?|tr)\s*:\s*)+/i, '').trim();

// Le texte d un message sans sa citation (miroir simplifie de
// lib/email-threads.js : la regle complete vit dans assets/email-thread.js).
function separerLeMessage(texte) {
  const lignes = String(texte || '').replace(/\r\n/g, '\n').split('\n');
  const coupe = lignes.findIndex((l, i) => /^\s*>/.test(l) || (/a\s*(?:écrit|ecrit)\s*:\s*$/i.test(l) && i > 0));
  if (coupe < 0) return { message: lignes.join('\n').trim(), historique: '' };
  let debut = coupe;
  // La ligne « Le dim. 6 sept., X a écrit : » peut etre coupee en deux lignes.
  if (debut > 0 && /^Le\s.+/.test(lignes[debut - 1]) && !/\S/.test(lignes[debut - 2] || '')) debut -= 1;
  return { message: lignes.slice(0, debut).join('\n').trim(), historique: lignes.slice(debut).join('\n').trim() };
}
const extrait = (texte, longueur = 160) => {
  const propre = String(texte || '').replace(/\s+/g, ' ').trim();
  return propre.length > longueur ? `${propre.slice(0, longueur - 1)}…` : propre;
};

/* ── LE CENTRE (miroir de ops-knowledge/centers.json pour libramont) ─────── */
const CENTRE = {
  id: CENTER_ID,
  name: 'Fun Galaxy Libramont',
  publicInfo: { address: 'L\'Alienau, 100, 6800 Libramont', city: 'Libramont', phone: '0491/30.16.67', email: 'libramont@fungalaxy.be' },
  branding: { emailLogo: '/assets/brand/logo-fun-galaxy-email-clair.png', emailLogoDark: '/assets/brand/logo-fun-galaxy-email.png', accent: '#944292', accentStrong: '#7d2478' },
};
// L origine de la console SERVIE : les mails rendus y referencent les logos
// en URL absolue (comme en production). Elle suit le Host de chaque requete :
// le gate UI monte ce meme serveur sur un autre port, et un logo qui
// pointerait sur 4260 pendant que la page tourne ailleurs serait un lien mort
// (erreur console, image absente dans l apercu).
let ORIGINE_APP = `http://${HOST}:${PORT}`;
const logoAbsolu = (chemin) => (chemin ? `${ORIGINE_APP}${chemin}` : '');

const DESIGN_PRESETS = [
  { id: 'classique', label: 'Classique', description: 'Carte blanche à filet fin sur fond gris, nom du centre en tête. Le gabarit historique.' },
  { id: 'epure', label: 'Épuré', description: 'Pas de carte : fond blanc, grandes marges, un filet fin sous le titre.' },
  { id: 'carte', label: 'Carte', description: 'La carte classique avec une barre de couleur en haut.' },
  { id: 'contraste', label: 'Contraste', description: 'Bandeau d\'en-tête sombre avec le nom ou le logo blanc du centre.' },
];
function designParDefaut() {
  return {
    preset: 'classique',
    accent: { mode: 'encre', hex: '' },
    header: { mode: 'nom', logoUrl: '', logoWidth: 140 },
    footer: { adresse: true, telephone: true, email: true, mention: '' },
    signature: {
      enabled: true, closing: 'À très bientôt,', teamLabel: '', role: '',
      phone: CENTRE.publicInfo.phone, email: CENTRE.publicInfo.email, website: '', address: CENTRE.publicInfo.address,
      logoUrl: logoAbsolu(CENTRE.branding.emailLogo), logoWidth: 120,
      socials: { facebook: '', instagram: '', tiktok: '', linkedin: '' }, layout: 'carte',
    },
    signatureScope: { manual: true, sequences: true, campaigns: false },
    updatedAt: null, updatedBy: '',
  };
}
function fusionnerDesign(brut) {
  const base = designParDefaut();
  const s = brut && typeof brut === 'object' ? brut : {};
  const objet = (a, b) => ({ ...a, ...(b && typeof b === 'object' ? b : {}) });
  return {
    ...base, ...s,
    accent: objet(base.accent, s.accent), header: objet(base.header, s.header), footer: objet(base.footer, s.footer),
    signature: { ...objet(base.signature, s.signature), socials: objet(base.signature.socials, s.signature && s.signature.socials) },
    signatureScope: objet(base.signatureScope, s.signatureScope),
  };
}
// Validation minimale, messages en francais exposables (miroir de §4.3).
function validerDesign(brut) {
  const d = fusionnerDesign(brut);
  const erreur = (m) => { const e = new Error(m); e.status = 400; throw e; };
  if (!DESIGN_PRESETS.some((p) => p.id === d.preset)) erreur('Gabarit inconnu.');
  if (!['encre', 'centre', 'perso'].includes(d.accent.mode)) erreur('Mode de couleur inconnu.');
  if (d.accent.mode === 'perso' && !/^#[0-9a-f]{6}$/i.test(String(d.accent.hex || ''))) erreur('La couleur personnalisée doit être un code hexadécimal à 6 chiffres (ex. #7d2478).');
  if (!['nom', 'logo', 'logo-nom', 'aucun'].includes(d.header.mode)) erreur('Mode d\'en-tête inconnu.');
  const largeur = (v, nom) => { const n = Number(v); if (!Number.isFinite(n) || n < 60 || n > 300) erreur(`${nom} : largeur du logo entre 60 et 300 px.`); return n; };
  d.header.logoWidth = largeur(d.header.logoWidth, 'En-tête');
  d.signature.logoWidth = largeur(d.signature.logoWidth, 'Signature');
  const url = (v, nom) => { const s = String(v || '').trim(); if (s && !/^https:\/\//i.test(s) && !s.startsWith('/assets/') && !s.startsWith(`${ORIGINE_APP}/assets/`)) erreur(`${nom} : adresse https attendue.`); return s; };
  d.header.logoUrl = url(d.header.logoUrl, 'Logo d\'en-tête');
  d.signature.logoUrl = url(d.signature.logoUrl, 'Logo de signature');
  d.signature.website = url(d.signature.website, 'Site web');
  for (const [reseau, domaine] of [['facebook', 'facebook.com'], ['instagram', 'instagram.com'], ['tiktok', 'tiktok.com'], ['linkedin', 'linkedin.com']]) {
    const v = String(d.signature.socials[reseau] || '').trim();
    if (v && !new RegExp(`^https://(?:[a-z0-9-]+\\.)*${domaine.replace('.', '\\.')}/`, 'i').test(v)) erreur(`${reseau} : lien https vers ${domaine} attendu.`);
  }
  if (String(d.signature.closing || '').length > 80) erreur('Formule de fin : 80 caractères maximum.');
  if (String(d.footer.mention || '').length > 300) erreur('Mention : 300 caractères maximum.');
  d.accent.hex = String(d.accent.hex || '').toLowerCase();
  return d;
}

/* ── RENDU D UN MAIL (fixture) : tables, styles en ligne, 600 px ─────────
   Miroir volontairement simple d emailShell : le gabarit, l accent, l en-tete,
   la signature et le pied changent VRAIMENT avec le design, pour que l apercu
   vivant montre quelque chose de vrai a l ecran. ── */
function accentEffectif(design) {
  if (design.accent.mode === 'centre') return CENTRE.branding.accent;
  if (design.accent.mode === 'perso' && /^#[0-9a-f]{6}$/i.test(design.accent.hex || '')) return design.accent.hex;
  return '#111111';
}
function paragraphes(texte) {
  return String(texte || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map((bloc) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1a1a1a">${escapeHtml(bloc).replace(/\n/g, '<br>')}</p>`).join('');
}
function signatureHtml(design, person) {
  const s = design.signature;
  if (!s.enabled) return '';
  const lignes = [];
  const qui = person && person.name ? `${escapeHtml(person.name)}${person.role ? `, ${escapeHtml(person.role)}` : ''}` : escapeHtml(s.teamLabel || `L'équipe ${CENTRE.name}`);
  lignes.push(`<div style="font-weight:600;color:#111">${qui}</div>`);
  if (!person && s.role) lignes.push(`<div style="color:#555">${escapeHtml(s.role)}</div>`);
  if (s.phone) lignes.push(`<div><a href="tel:${escapeHtml(s.phone)}" style="color:#111;text-decoration:none">${escapeHtml(s.phone)}</a></div>`);
  if (s.email) lignes.push(`<div><a href="mailto:${escapeHtml(s.email)}" style="color:#111">${escapeHtml(s.email)}</a></div>`);
  if (s.website) lignes.push(`<div><a href="${escapeHtml(s.website)}" style="color:#111">${escapeHtml(s.website.replace(/^https?:\/\//, ''))}</a></div>`);
  if (s.address) lignes.push(`<div style="color:#555">${escapeHtml(s.address)}</div>`);
  const reseaux = Object.entries(s.socials || {}).filter(([, v]) => v).map(([k, v]) => `<a href="${escapeHtml(v)}" style="color:#111">${k.charAt(0).toUpperCase() + k.slice(1)}</a>`);
  if (reseaux.length) lignes.push(`<div style="margin-top:4px">${reseaux.join(' · ')}</div>`);
  const texte = `<div style="font-size:13px;line-height:1.6">${s.closing ? `<div style="margin-bottom:6px;color:#333">${escapeHtml(s.closing)}</div>` : ''}${lignes.join('')}</div>`;
  const logo = s.logoUrl ? `<img src="${escapeHtml(s.logoUrl)}" width="${Number(s.logoWidth) || 120}" alt="${escapeHtml(CENTRE.name)}" style="display:block;max-width:100%;height:auto">` : '';
  if (s.layout === 'ligne' || !logo) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;border-top:1px solid #e6e6e6"><tr><td style="padding-top:14px">${logo ? `<div style="margin-bottom:8px">${logo}</div>` : ''}${texte}</td></tr></table>`;
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;border-top:1px solid #e6e6e6"><tr><td width="${(Number(s.logoWidth) || 120) + 16}" valign="top" style="padding:14px 16px 0 0">${logo}</td><td valign="top" style="padding-top:14px">${texte}</td></tr></table>`;
}
function rendreMail({ design, subject, body, person = null, signature = true, retrait = false }) {
  const d = fusionnerDesign(design);
  const accent = accentEffectif(d);
  const logoClair = d.header.logoUrl || logoAbsolu(CENTRE.branding.emailLogo);
  const logoSombre = logoAbsolu(CENTRE.branding.emailLogoDark) || logoClair;
  const largeur = Number(d.header.logoWidth) || 140;
  const nom = escapeHtml(CENTRE.name);
  const enTete = (sombre) => {
    const logo = sombre ? logoSombre : logoClair;
    const couleur = sombre ? '#ffffff' : accent;
    if (d.header.mode === 'aucun') return '';
    if (d.header.mode === 'logo' && logo) return `<img src="${escapeHtml(logo)}" width="${largeur}" alt="${nom}" style="display:block;height:auto">`;
    if (d.header.mode === 'logo-nom' && logo) return `<img src="${escapeHtml(logo)}" width="${largeur}" alt="" style="display:block;height:auto;margin-bottom:8px"><div style="font-size:14px;font-weight:600;color:${couleur}">${nom}</div>`;
    return `<div style="font-size:18px;font-weight:700;letter-spacing:.01em;color:${couleur}">${nom}</div>`;
  };
  const pied = [];
  if (d.footer.adresse && CENTRE.publicInfo.address) pied.push(escapeHtml(CENTRE.publicInfo.address));
  if (d.footer.telephone && CENTRE.publicInfo.phone) pied.push(escapeHtml(CENTRE.publicInfo.phone));
  if (d.footer.email && CENTRE.publicInfo.email) pied.push(escapeHtml(CENTRE.publicInfo.email));
  const piedHtml = `<div style="font-size:12px;line-height:1.6;color:#777">${pied.join(' · ')}${d.footer.mention ? `<div style="margin-top:6px">${escapeHtml(d.footer.mention)}</div>` : ''}${retrait ? '<div style="margin-top:6px"><span style="color:#777;text-decoration:underline">Ne plus recevoir ces messages</span></div>' : ''}</div>`;
  const corps = `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:${d.preset === 'epure' ? '#111' : accent}">${escapeHtml(subject)}</h1>${paragraphes(body)}${signature ? signatureHtml(d, person) : ''}`;
  const fond = d.preset === 'epure' ? '#ffffff' : '#f2f2f2';
  let carte;
  if (d.preset === 'epure') {
    carte = `<td style="padding:36px 40px;background:#ffffff"><div style="padding-bottom:16px;margin-bottom:22px;border-bottom:1px solid #e3e3e3">${enTete(false)}</div>${corps}<div style="margin-top:28px">${piedHtml}</div></td>`;
  } else if (d.preset === 'contraste') {
    carte = `<td style="background:#ffffff;border:1px solid #e3e3e3;border-radius:12px;overflow:hidden"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="#111111" style="background:#111111;padding:22px 32px">${enTete(true)}</td></tr><tr><td style="padding:28px 32px">${corps}</td></tr><tr><td style="padding:0 32px 24px">${piedHtml}</td></tr></table></td>`;
  } else {
    const barre = d.preset === 'carte' ? `<tr><td bgcolor="${accent}" style="background:${accent};height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>` : '';
    carte = `<td style="background:#ffffff;border:1px solid #e3e3e3;border-radius:12px;overflow:hidden"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${barre}<tr><td style="padding:24px 32px 0">${enTete(false)}</td></tr><tr><td style="padding:22px 32px 8px">${corps}</td></tr><tr><td style="padding:8px 32px 24px">${piedHtml}</td></tr></table></td>`;
  }
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${fond};font-family:Helvetica,Arial,sans-serif;color:#1a1a1a"><!-- FIXTURE dev-console-server : rendu de demonstration, pas emailShell -->
<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(subject)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${fond}" style="background:${fond}"><tr><td align="center" style="padding:${d.preset === 'epure' ? '0' : '28px 12px'}">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%"><tr>${carte}</tr></table>
</td></tr></table></body></html>`;
}
function remplirVariables(texte, vars) {
  return String(texte || '').replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (m, k) => (vars[k.toLowerCase()] !== undefined ? vars[k.toLowerCase()] : m));
}
const CLIENT_EXEMPLE = { prenom: 'Marie', nom: 'Marie Dupont', centre: CENTRE.name, date: 'samedi 20 septembre', heure: '14:00', formule: 'Bowling 2 parties', pax: '8', offre: 'une partie offerte' };

/* ── LES FIXTURES ────────────────────────────────────────────────────────── */
// `origine` : l adresse a laquelle la console est servie. Les mails des
// fixtures sont rendus UNE fois, a la construction, avec des logos en URL
// absolue : un gate qui monte ce serveur sur un autre port la passe ici,
// sinon ces mails pointeraient sur le port par defaut.
function creerRepondeurFixtures({ origine = ORIGINE_APP } = {}) {
  ORIGINE_APP = origine;
  const MEMBRES = {
    sophie: { memberId: 'm-sophie', memberName: 'Sophie Martin', memberRole: 'Direction' },
    kevin: { memberId: 'm-kevin', memberName: 'Kevin Dubois', memberRole: 'Manager' },
    moi: { memberId: MOI.id, memberName: MOI.name, memberRole: MOI.role },
  };
  const etat = {
    design: null,
    prochainId: 100,
    threads: [],
    comms: [],
    reads: {},      // communicationId -> [lecture]
    events: {},     // communicationId -> [evenement]
    claims: {},     // communicationId -> prise
    questions: [],
    // La memoire de l agent, au format du serveur (lib/email-agent.js ligneFait).
    appris: [{ id: 1, question: 'Le parking est-il gratuit ?', reponse: 'Oui, gratuit derrière le bâtiment, entrée par la rue latérale.', par: 'Sophie Martin', le: ilYA(20 * J), resolues: 1, versions: 0 }],
    prochainFait: 2,
    settings: {
      request_received: { enabled: true }, confirmation: { enabled: true }, reminder_48h: { enabled: true, offsetDays: 2 },
      post_visit: { enabled: true, reviewUrl: 'https://g.page/r/fun-galaxy-libramont/review' }, birthday_j30: { enabled: true, subject: 'Un anniversaire à fêter chez nous, {{prenom}} ?' }, reactivation: { enabled: false },
    },
    sequences: [{ id: 'cs_1', name: 'Relance une semaine après', enabled: true, trigger: { type: 'after_visit', days: 7 }, segment: 'all', subject: 'On se revoit, {{prenom}} ?', body: 'Bonjour {{prenom}},\n\nUne semaine déjà depuis votre venue chez {{centre}}. Les pistes vous attendent : réservez en ligne, ça prend une minute.\n\nÀ bientôt,\nL\'équipe {{centre}}', cap: 20 }],
    brain: { overrides: { faq: {}, signature: '', extra: 'Le parking est gratuit derrière le bâtiment.' } },
    templates: [{ id: 7, label: 'Offre rentrée', category: 'promotion', subject: 'La rentrée chez {{centre}} : {{offre}}', body: 'Bonjour {{prenom}},\n\nPour la rentrée, on vous a préparé {{offre}}.\n\nRéservez en ligne quand vous voulez.\n\nL\'équipe {{centre}}' }],
    identities: [{ id: 1, label: 'Fun Galaxy Libramont', email: 'libramont@fungalaxy.be', isDefault: true }, { id: 2, label: 'Direction', email: 'direction@fungalaxy.be', isDefault: false }],
    suppressions: [{ email: 'nepasderanger@exemple.be', source: 'link', reason: '', createdAt: ilYA(10 * J) }],
    campaigns: [{ id: 7, name: 'Soirée bowling entre amis', objective: 'Remplir les soirées de semaine', segment: 'all', subject: 'Une soirée bowling entre amis ?', body: 'Bonjour {{prenom}},\n\nLes soirées rallongent : réservez une piste entre amis.', status: 'sent', scheduledAt: null, recipientCount: 120, sent: 118, failed: 2, queued: 0, opens: 0, clicks: 0, createdAt: ilYA(2 * J) }],
    prochaineCampagne: 8,
  };
  const AUTOMATION_DEFAULTS = {
    request_received: { enabled: true, subject: 'On a bien reçu votre demande', body: 'Bonjour {{prenom}},\n\nVotre demande du {{date}} à {{heure}} est bien arrivée. On vous confirme très vite.\n\nL\'équipe {{centre}}', variables: ['prenom', 'date', 'heure', 'formule', 'pax', 'centre'] },
    confirmation: { enabled: true, subject: 'C\'est confirmé : on vous attend le {{date}}', body: 'Bonjour {{prenom}},\n\nVotre réservation {{formule}} du {{date}} à {{heure}} pour {{pax}} joueurs est confirmée. Arrivez 10 minutes avant.\n\nÀ bientôt,\nL\'équipe {{centre}}', variables: ['prenom', 'date', 'heure', 'formule', 'pax', 'centre'] },
    reminder_48h: { enabled: true, subject: 'Rappel : on vous attend le {{date}}', body: 'Bonjour {{prenom}},\n\nPetit rappel : votre {{formule}} est prévue le {{date}} à {{heure}}.\n\nL\'équipe {{centre}}', offsetDays: 2, variables: ['prenom', 'date', 'heure', 'formule', 'pax', 'centre'] },
    post_visit: { enabled: true, subject: 'Merci de votre visite, {{prenom}}', body: 'Bonjour {{prenom}},\n\nMerci d\'être venu chez {{centre}}. Un avis nous aide énormément, ça prend trente secondes.\n\nÀ bientôt,\nL\'équipe {{centre}}', offsetDays: 1, variables: ['prenom', 'centre'] },
    birthday_j30: { enabled: true, subject: 'L\'anniversaire approche, {{prenom}}', body: 'Bonjour {{prenom}},\n\nL\'anniversaire fêté chez nous revient bientôt. On vous re-réserve la fête ?\n\nL\'équipe {{centre}}', offsetDays: 30, variables: ['prenom', 'centre'] },
    reactivation: { enabled: false, subject: 'Ça fait un moment, {{prenom}}', body: 'Bonjour {{prenom}},\n\nBowling, laser game et arcades vous attendent. Réservez en ligne, ça prend une minute.\n\nL\'équipe {{centre}}', cap: 20, variables: ['prenom', 'centre'] },
  };
  const AUTOMATION_STATS = { request_received: { sent30d: 37, failed30d: 2 }, confirmation: { sent30d: 42, failed30d: 1 }, reminder_48h: { sent30d: 31, failed30d: 0 }, post_visit: { sent30d: 28, failed30d: 2 }, birthday_j30: { sent30d: 4, failed30d: 1 }, reactivation: { sent30d: 0, failed30d: 0 } };
  const LIBELLES = { request_received: 'Demande reçue', confirmation: 'Confirmation', reminder_48h: 'Rappel avant la venue', post_visit_followup: 'Merci post-visite', birthday_j30: '30 jours avant l\'anniversaire', reactivation: 'Réactiver les clients dormants', staff_review_request: 'Réservation à valider', delay_update: 'Changement d\'horaire' };
  const SEQUENCE_TEMPLATE_IDS = { request_received: ['request_received'], confirmation: ['confirmation'], reminder_48h: ['reminder_48h'], post_visit: ['post_visit_followup'], birthday_j30: ['birthday_j30'], reactivation: ['reactivation'] };

  const designEffectif = () => fusionnerDesign(etat.design);
  const texteMessage = (c) => String((c.payload && c.payload.textBody) || c.textBody || '');

  function ajouterComm(c) {
    const id = c.id || etat.prochainId++;
    const comm = {
      id, centerId: CENTER_ID, channel: 'email', direction: 'outbound', status: 'sent', templateId: '', recipient: '', subject: '', body: '',
      createdAt: ilYA(H), scheduledAt: null, sentAt: null, attempts: 1, lastError: '', payload: {},
      threadId: null, messageId: `<${id}@pinlane.dev>`, inReplyTo: '', references: '',
      deliveredAt: null, openedAt: null, openCount: 0, clickedAt: null, clickCount: 0, bouncedAt: null, complainedAt: null,
      ...c, id,
    };
    if (comm.direction === 'outbound' && !comm.body && comm.textBody) {
      comm.body = rendreMail({ design: designEffectif(), subject: comm.subject, body: comm.textBody, person: comm.payload && comm.payload.sentBy ? { name: comm.payload.sentBy.memberName, role: comm.payload.sentBy.memberRole } : null, signature: !(comm.payload && comm.payload.test) });
    }
    if (comm.direction === 'outbound') { comm.payload = { textBody: comm.textBody || '', ...comm.payload }; }
    delete comm.textBody;
    etat.comms.push(comm);
    return comm;
  }
  function ajouterFil(t) {
    const fil = {
      id: t.id, centerId: CENTER_ID, contactEmail: '', contactName: '', subject: '', status: 'open', origin: 'inbound', rootCommunicationId: null,
      messageCount: 0, inboundCount: 0, outboundCount: 0, firstMessageAt: null, lastMessageAt: null, lastInboundAt: null, lastOutboundAt: null,
      createdAt: ilYA(J), updatedAt: ilYA(H), ...t,
    };
    etat.threads.push(fil);
    return fil;
  }
  function evenement(id, type, occurredAt, data = {}) {
    if (!etat.events[id]) etat.events[id] = [];
    etat.events[id].push({ type, occurredAt, data });
  }
  function lecture(id, membre, quand, readCount = 1) {
    if (!etat.reads[id]) etat.reads[id] = [];
    etat.reads[id].push({ ...membre, firstReadAt: quand, lastReadAt: quand, readCount });
  }
  // Recalcule les compteurs et dates d un fil a partir de ses messages : la
  // fixture reste coherente apres une reponse envoyee depuis la console.
  function recalculerFil(fil) {
    const messages = etat.comms.filter((c) => c.threadId === fil.id).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const entrants = messages.filter((c) => c.direction === 'inbound');
    const sortants = messages.filter((c) => c.direction !== 'inbound');
    fil.messageCount = messages.length;
    fil.inboundCount = entrants.length;
    fil.outboundCount = sortants.length;
    fil.firstMessageAt = messages[0] ? messages[0].createdAt : fil.createdAt;
    fil.lastMessageAt = messages.length ? messages[messages.length - 1].createdAt : fil.createdAt;
    fil.lastInboundAt = entrants.length ? entrants[entrants.length - 1].createdAt : null;
    fil.lastOutboundAt = sortants.length ? (sortants[sortants.length - 1].sentAt || sortants[sortants.length - 1].createdAt) : null;
    fil.rootCommunicationId = messages[0] ? messages[0].id : null;
    fil.updatedAt = new Date().toISOString();
  }

  /* Trois conversations, une dizaine d envoyes, des evenements et des lectures. */
  const fil901 = ajouterFil({ id: 901, contactEmail: 'ansarbis2.0@gmail.com', contactName: 'Ansar Bis', subject: 'C\'est confirmé : on vous attend mardi 8 septembre', status: 'open', origin: 'outbound', createdAt: ilYA(2 * J) });
  ajouterComm({ id: 41, threadId: 901, templateId: 'confirmation', recipient: 'ansarbis2.0@gmail.com', subject: 'C\'est confirmé : on vous attend mardi 8 septembre', createdAt: ilYA(2 * J), sentAt: ilYA(2 * J - 5000), status: 'delivered', deliveredAt: ilYA(2 * J - 40000), openedAt: ilYA(2 * J - 25 * 60000), openCount: 1, payload: { reservationId: 5123 }, textBody: 'Bonjour Ansar,\n\nVotre réservation Bowling du mardi 8 septembre à 16:00 pour 6 joueurs est confirmée. Arrivez 10 minutes avant.\n\nÀ bientôt,\nL\'équipe Fun Galaxy Libramont' });
  evenement(41, 'sent', ilYA(2 * J - 5000)); evenement(41, 'delivered', ilYA(2 * J - 40000)); evenement(41, 'opened', ilYA(2 * J - 25 * 60000), { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mail' });
  ajouterComm({ id: 42, threadId: 901, direction: 'inbound', status: 'received', templateId: null, recipient: 'ansarbis2.0@gmail.com', subject: 'Re: C\'est confirmé : on vous attend mardi 8 septembre', createdAt: ilYA(3 * H), inReplyTo: '<41@pinlane.dev>', references: '<41@pinlane.dev>', payload: {
    from: 'ansarbis2.0@gmail.com', fromName: 'Ansar Bis', receivedAt: ilYA(3 * H),
    textBody: 'Bonjour, est-ce que je peux amener mon propre gâteau ?\n\nLe dim. 6 sept. 2026 à 20:54, Fun Galaxy Libramont <libramont@fungalaxy.be> a\nécrit :\n\n> Bowling\n>\n> Fun Galaxy Libramont\n>\n> Réservation confirmée\n> On vous attend mardi 8 septembre\n>\n> Rendez-vous à 16:00. Arrivez 10 minutes avant.',
    analysis: { intent: 'autre', intentLabel: 'Autre', summary: 'Le client demande s\'il peut apporter son propre gâteau.', urgency: 'normale', provider: 'rules', clientName: 'Ansar', question: 'Le centre autorise-t-il d\'apporter son propre gâteau ?', reply: { subject: 'Re: C\'est confirmé : on vous attend mardi 8 septembre', body: 'Bonjour Ansar,\n\nMerci pour votre message. Je vérifie ce point avec l\'équipe et je vous réponds très vite.\n\nÀ mardi,' } },
  } });
  lecture(42, MEMBRES.sophie, ilYA(2 * H));
  etat.questions.push({ communicationId: 42, question: 'Le centre autorise-t-il d\'apporter son propre gâteau ?', mailDe: 'ansarbis2.0@gmail.com', mailSujet: 'Re: C\'est confirmé : on vous attend mardi 8 septembre', recuLe: ilYA(3 * H) });

  const fil902 = ajouterFil({ id: 902, contactEmail: 'marie@exemple.be', contactName: 'Marie Dupont', subject: 'Anniversaire pour mon fils', status: 'answered', origin: 'inbound', createdAt: ilYA(J + 2 * H) });
  ajouterComm({ id: 43, threadId: 902, direction: 'inbound', status: 'received', templateId: null, recipient: 'marie@exemple.be', subject: 'Anniversaire pour mon fils', createdAt: ilYA(J + 2 * H), payload: {
    from: 'marie@exemple.be', fromName: 'Marie Dupont', receivedAt: ilYA(J + 2 * H),
    textBody: 'Bonjour,\n\nJe voudrais organiser un anniversaire pour mon fils de 8 ans, vous avez de la place samedi après-midi ? Nous serions 8 enfants.\n\nMerci,\nMarie',
    analysis: { intent: 'anniversaire', intentLabel: 'Anniversaire', summary: 'Veut organiser un anniversaire (8 ans, 8 enfants) et demande la disponibilité de samedi après-midi.', urgency: 'normale', provider: 'rules', clientName: 'Marie', reply: { subject: 'Re: Anniversaire pour mon fils', body: 'Bonjour Marie,\n\nAvec plaisir ! Samedi 14 h est libre pour 8 enfants : bowling, table décorée et boissons comprises.\n\nDites-moi si l\'heure vous convient, je bloque la piste.' } },
    replyCommunicationId: 44, repliedAt: ilYA(J + 90 * 60000),
  } });
  lecture(43, MEMBRES.kevin, ilYA(J + 100 * 60000)); lecture(43, MEMBRES.moi, ilYA(20 * H), 2);
  ajouterComm({ id: 44, threadId: 902, templateId: 'direct_reply', recipient: 'marie@exemple.be', subject: 'Re: Anniversaire pour mon fils', createdAt: ilYA(J + 90 * 60000), sentAt: ilYA(J + 90 * 60000), status: 'delivered', deliveredAt: ilYA(J + 89 * 60000), openedAt: ilYA(J + 60 * 60000), openCount: 2, clickedAt: ilYA(J + 58 * 60000), clickCount: 1, inReplyTo: '<43@pinlane.dev>', payload: { direct: true, sentBy: MEMBRES.kevin, replyToCommunicationId: 43 }, textBody: 'Bonjour Marie,\n\nAvec plaisir ! Samedi 14 h est libre pour 8 enfants : bowling, table décorée et boissons comprises.\n\nDites-moi si l\'heure vous convient, je bloque la piste.\n\nKevin' });
  evenement(44, 'sent', ilYA(J + 90 * 60000)); evenement(44, 'delivered', ilYA(J + 89 * 60000)); evenement(44, 'opened', ilYA(J + 60 * 60000), { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Gmail' }); evenement(44, 'clicked', ilYA(J + 58 * 60000), { link: `${ORIGINE_APP}/reserver` }); evenement(44, 'opened', ilYA(21 * H), { userAgent: 'Mozilla/5.0 (Android 14) Gmail' });
  ajouterComm({ id: 45, threadId: 902, direction: 'inbound', status: 'received', templateId: null, recipient: 'marie@exemple.be', subject: 'Re: Anniversaire pour mon fils', createdAt: ilYA(20 * H), inReplyTo: '<44@pinlane.dev>', references: '<43@pinlane.dev> <44@pinlane.dev>', payload: {
    from: 'marie@exemple.be', fromName: 'Marie Dupont', receivedAt: ilYA(20 * H),
    textBody: 'Parfait, merci ! 14 h nous va très bien, on sera bien 8 enfants.\n\nLe lun. 15 sept. 2026 à 10:12, Fun Galaxy Libramont <libramont@fungalaxy.be> a écrit :\n> Avec plaisir ! Samedi 14 h est libre pour 8 enfants.',
    analysis: { intent: 'reservation', intentLabel: 'Réservation', summary: 'Confirme samedi 14 h pour 8 enfants.', urgency: 'normale', provider: 'rules', clientName: 'Marie', reply: { subject: 'Re: Anniversaire pour mon fils', body: 'Merci Marie, c\'est noté : samedi 14 h, 8 enfants.' } },
    replyCommunicationId: 46, repliedAt: ilYA(19 * H),
  } });
  lecture(45, MEMBRES.kevin, ilYA(19 * H + 20 * 60000));
  ajouterComm({ id: 46, threadId: 902, templateId: 'direct_reply', recipient: 'marie@exemple.be', subject: 'Re: Anniversaire pour mon fils', createdAt: ilYA(19 * H), sentAt: ilYA(19 * H), status: 'delivered', deliveredAt: ilYA(19 * H - 12000), inReplyTo: '<45@pinlane.dev>', payload: { direct: true, sentBy: MEMBRES.kevin, replyToCommunicationId: 45 }, textBody: 'Merci Marie, c\'est noté : samedi 14 h, 8 enfants. La table sera prête à votre arrivée.\n\nÀ samedi,\nKevin' });
  evenement(46, 'sent', ilYA(19 * H)); evenement(46, 'delivered', ilYA(19 * H - 12000));

  const fil903 = ajouterFil({ id: 903, contactEmail: 'lucas@exemple.be', contactName: 'Lucas Petit', subject: 'Devis pour 25 élèves un mardi', status: 'closed', origin: 'inbound', createdAt: ilYA(5 * J) });
  ajouterComm({ id: 47, threadId: 903, direction: 'inbound', status: 'received', templateId: null, recipient: 'lucas@exemple.be', subject: 'Devis pour 25 élèves un mardi', createdAt: ilYA(5 * J), payload: {
    from: 'lucas@exemple.be', fromName: 'Lucas Petit', receivedAt: ilYA(5 * J),
    textBody: 'Bonjour,\n\nJe suis instituteur à Neufchâteau. Combien coûterait une sortie bowling pour 25 élèves un mardi matin en octobre ? Merci de me répondre rapidement, je dois boucler le budget cette semaine.\n\nLucas Petit',
    analysis: { intent: 'prix', intentLabel: 'Prix', summary: 'Demande un devis pour 25 élèves un mardi matin en octobre, réponse urgente pour boucler un budget.', urgency: 'haute', provider: 'rules', clientName: 'Lucas', reply: { subject: 'Re: Devis pour 25 élèves un mardi', body: 'Bonjour Lucas,\n\nVoici notre proposition pour 25 élèves un mardi matin : …' } },
    replyCommunicationId: 48, repliedAt: ilYA(5 * J - 2 * H),
  } });
  lecture(47, MEMBRES.sophie, ilYA(5 * J - H));
  ajouterComm({ id: 48, threadId: 903, templateId: 'direct_reply', recipient: 'lucas@exemple.be', subject: 'Re: Devis pour 25 élèves un mardi', createdAt: ilYA(5 * J - 2 * H), sentAt: ilYA(5 * J - 2 * H), status: 'delivered', deliveredAt: ilYA(5 * J - 2 * H + 15000), inReplyTo: '<47@pinlane.dev>', payload: { direct: true, sentBy: MEMBRES.sophie, replyToCommunicationId: 47 }, textBody: 'Bonjour Lucas,\n\nPour 25 élèves un mardi matin en octobre, nous proposons 2 parties de bowling par enfant avec les chaussures, soit 9 € par élève, accompagnants gratuits.\n\nDites-moi la date envisagée, je vous réserve les pistes.\n\nSophie' });
  evenement(48, 'sent', ilYA(5 * J - 2 * H)); evenement(48, 'delivered', ilYA(5 * J - 2 * H + 15000));

  ajouterFil({ id: 904, contactEmail: 'lucas@exemple.be', contactName: 'Lucas Petit', subject: 'Sortie scolaire de juin', status: 'open', origin: 'inbound', createdAt: ilYA(6 * H) });
  ajouterComm({ id: 49, threadId: 904, direction: 'inbound', status: 'received', templateId: null, recipient: 'lucas@exemple.be', subject: 'Sortie scolaire de juin', createdAt: ilYA(6 * H), payload: {
    from: 'lucas@exemple.be', fromName: 'Lucas Petit', receivedAt: ilYA(6 * H),
    textBody: 'Bonjour,\n\nNouvelle demande, autre classe : est-ce qu\'un vendredi de juin est possible pour 30 élèves, laser game cette fois ?\n\nLucas',
    analysis: { intent: 'reservation', intentLabel: 'Réservation', summary: 'Demande un vendredi de juin pour 30 élèves en laser game.', urgency: 'normale', provider: 'rules', clientName: 'Lucas', reply: { subject: 'Re: Sortie scolaire de juin', body: 'Bonjour Lucas,\n\nOui, les vendredis de juin sont ouverts aux groupes scolaires : le laser game accueille 30 élèves en deux équipes.' } },
  } });

  // La file des envoyes hors conversation : origines et statuts varies.
  ajouterComm({ id: 51, templateId: 'confirmation', recipient: 'claire@exemple.be', subject: 'C\'est confirmé : on vous attend samedi 20 septembre', createdAt: ilYA(6 * H), sentAt: ilYA(6 * H), status: 'delivered', deliveredAt: ilYA(6 * H - 9000), openedAt: ilYA(5 * H), openCount: 1, payload: { reservationId: 5140 }, textBody: 'Bonjour Claire,\n\nVotre réservation Bowling du samedi 20 septembre à 14:00 pour 8 joueurs est confirmée.\n\nL\'équipe Fun Galaxy Libramont' });
  evenement(51, 'delivered', ilYA(6 * H - 9000)); evenement(51, 'opened', ilYA(5 * H), { userAgent: 'Apple Mail' });
  ajouterComm({ id: 52, templateId: 'reminder_48h', recipient: 'paul@exemple.be', subject: 'Rappel : on vous attend jeudi', createdAt: ilYA(H), scheduledAt: dans(2 * H), status: 'queued', attempts: 0, sentAt: null, payload: { reservationId: 5131 }, textBody: 'Bonjour Paul,\n\nPetit rappel : votre partie est prévue jeudi à 19:00.' });
  ajouterComm({ id: 53, templateId: 'birthday_j30', recipient: 'nina@exemple.be', subject: 'L\'anniversaire approche 🎂', createdAt: ilYA(J), status: 'failed', attempts: 2, sentAt: null, lastError: 'You can only send testing emails to your own email address (proprio@example.com). To send emails to other recipients, please verify a domain at resend.com/domains', payload: {}, textBody: 'Bonjour Nina,\n\nL\'anniversaire fêté chez nous revient bientôt.' });
  ajouterComm({ id: 54, templateId: 'campaign_7', recipient: 'jules@exemple.be', subject: 'Une soirée bowling entre amis ?', createdAt: ilYA(2 * J), sentAt: ilYA(2 * J), status: 'delivered', deliveredAt: ilYA(2 * J - 20000), payload: { campaignId: 7 }, textBody: 'Bonjour Jules,\n\nLes soirées rallongent : réservez une piste entre amis.' });
  ajouterComm({ id: 55, templateId: 'test_confirmation', recipient: MOI.contact, subject: '[TEST] C\'est confirmé : on vous attend le samedi 20 septembre', createdAt: ilYA(3 * J), sentAt: ilYA(3 * J), status: 'sent', payload: { test: true, sentBy: MEMBRES.moi }, textBody: 'Bonjour Marie,\n\nVotre réservation Bowling 2 parties du samedi 20 septembre à 14:00 est confirmée.' });
  ajouterComm({ id: 56, templateId: 'reactivation', recipient: 'amina@exemple.be', subject: 'Ça fait un moment, Amina', createdAt: ilYA(4 * J), sentAt: ilYA(4 * J), status: 'delivered', deliveredAt: ilYA(4 * J - 30000), openedAt: ilYA(4 * J - 3 * H), openCount: 1, payload: {}, textBody: 'Bonjour Amina,\n\nBowling, laser game et arcades vous attendent.' });
  evenement(56, 'delivered', ilYA(4 * J - 30000)); evenement(56, 'opened', ilYA(4 * J - 3 * H), { userAgent: 'Outlook' });
  ajouterComm({ id: 57, templateId: 'staff_review_request', recipient: 'equipe@fungalaxy.be', subject: 'Réservation à valider : groupe de 14 le vendredi 26', createdAt: ilYA(8 * H), sentAt: ilYA(8 * H), status: 'sent', payload: { reservationId: 5150 }, textBody: 'Un groupe de 14 joueurs demande le vendredi 26 à 20:00 : aucun créneau automatique n\'est assez sûr.' });
  ajouterComm({ id: 58, templateId: 'post_visit_followup', recipient: 'theo@exemple.be', subject: 'Merci de votre visite, Théo', createdAt: ilYA(3 * J), sentAt: ilYA(3 * J), status: 'delivered', deliveredAt: ilYA(3 * J - 8000), openedAt: ilYA(3 * J - 2 * H), openCount: 1, clickedAt: ilYA(3 * J - 2 * H + 40000), clickCount: 1, payload: { reviewUrl: 'https://g.page/r/fun-galaxy-libramont/review' }, textBody: 'Bonjour Théo,\n\nMerci d\'être venu chez Fun Galaxy Libramont. Un avis nous aide énormément.' });
  evenement(58, 'delivered', ilYA(3 * J - 8000)); evenement(58, 'opened', ilYA(3 * J - 2 * H)); evenement(58, 'clicked', ilYA(3 * J - 2 * H + 40000), { link: 'https://g.page/r/fun-galaxy-libramont/review' });
  ajouterComm({ id: 59, templateId: 'request_received', recipient: 'sami@exemple.be', subject: 'On a bien reçu votre demande', createdAt: ilYA(30 * 60000), sentAt: ilYA(30 * 60000), status: 'sent', payload: { reservationId: 5151 }, textBody: 'Bonjour Sami,\n\nVotre demande du vendredi 26 à 20:00 est bien arrivée.' });
  ajouterComm({ id: 60, templateId: 'direct_message', recipient: 'claire@exemple.be', subject: 'Votre table décorée est prête', createdAt: ilYA(2 * H), sentAt: ilYA(2 * H), status: 'sent', payload: { direct: true, sentBy: MEMBRES.sophie }, textBody: 'Bonjour Claire,\n\nPetit mot pour vous dire que la table décorée sera prête à 13 h 45 samedi.\n\nSophie' });
  etat.threads.forEach(recalculerFil);
  etat.prochainId = 100;

  /* Les vues §3.7 : fils, messages, compteurs. */
  const prisesVivantes = () => Object.values(etat.claims).filter((p) => new Date(p.expiresAt).getTime() > Date.now());
  const priseSur = (id) => prisesVivantes().find((p) => Number(p.communicationId) === Number(id)) || null;
  const messagesDuFil = (fil) => etat.comms.filter((c) => c.threadId === fil.id).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || a.id - b.id);
  const origineDe = (c) => {
    if (c.direction === 'inbound' || c.status === 'received') return 'inbound';
    const p = c.payload || {};
    const drapeau = (v) => v === true || v === 'true';
    if (drapeau(p.test)) return 'test';
    if (p.campaignId) return 'campagne';
    if (drapeau(p.direct) || drapeau(p.directEmail) || drapeau(p.relance) || drapeau(p.clientMessage)) return 'manuel';
    return 'auto';
  };
  function filDeListe(fil) {
    const messages = messagesDuFil(fil);
    const dernier = messages[messages.length - 1] || null;
    const entrant = [...messages].reverse().find((c) => c.direction === 'inbound') || null;
    const reponse = entrant ? messages.find((c) => c.direction !== 'inbound' && new Date(c.createdAt) > new Date(entrant.createdAt)) : [...messages].reverse().find((c) => c.direction !== 'inbound');
    const analyse = entrant && entrant.payload && entrant.payload.analysis ? entrant.payload.analysis : null;
    const lecteurs = entrant ? (etat.reads[entrant.id] || []).map((l) => ({ memberId: l.memberId, memberName: l.memberName, memberRole: l.memberRole, lastReadAt: l.lastReadAt })) : [];
    const sentBy = reponse && reponse.payload && reponse.payload.sentBy ? reponse.payload.sentBy : null;
    return {
      ...fil,
      lastDirection: dernier ? (dernier.direction === 'inbound' ? 'inbound' : 'outbound') : fil.origin,
      snippet: dernier ? extrait(separerLeMessage(texteMessage(dernier)).message) : '',
      lastInboundId: entrant ? entrant.id : null,
      luParMoi: lecteurs.some((l) => l.memberId === MOI.id),
      lecteurs,
      prise: entrant ? priseSur(entrant.id) : null,
      intention: analyse ? String(analyse.intent || '') : '',
      question: Boolean(analyse && analyse.question && !analyse.questionRepondue),
      reponduPar: sentBy ? { memberName: sentBy.memberName, memberRole: sentBy.memberRole, at: reponse.sentAt || reponse.createdAt } : null,
    };
  }
  function messageDuFil(c) {
    const p = c.payload || {};
    const texte = texteMessage(c);
    const parts = separerLeMessage(texte);
    const origine = origineDe(c);
    return {
      id: c.id, direction: c.direction === 'inbound' ? 'inbound' : 'outbound', subject: c.subject, body: c.body, textBody: texte,
      message: parts.message, historique: parts.historique, createdAt: c.createdAt, sentAt: c.sentAt, receivedAt: p.receivedAt || null,
      status: c.status, templateId: c.templateId || '', origine, sequenceLabel: origine === 'auto' ? (LIBELLES[c.templateId] || '') : '',
      sentBy: p.sentBy || null, fromEmail: String(p.fromEmail || p.from || ''), fromLabel: String(p.fromLabel || p.fromName || ''), recipient: c.recipient,
      providerMessageId: c.providerMessageId || '', messageId: c.messageId, inReplyTo: c.inReplyTo,
      suivi: { deliveredAt: c.deliveredAt, openedAt: c.openedAt, openCount: c.openCount, clickedAt: c.clickedAt, clickCount: c.clickCount, bouncedAt: c.bouncedAt, complainedAt: c.complainedAt, lastError: c.lastError || '' },
      evenements: etat.events[c.id] || [], lectures: etat.reads[c.id] || [], prise: priseSur(c.id),
      analysis: c.direction === 'inbound' && p.analysis ? p.analysis : null, reservationId: p.reservationId || null, errorReason: c.lastError || '', threadId: c.threadId,
    };
  }
  function listerFils({ filtre, q, limit, offset }) {
    // « tous » vaut la chaine vide : un `||` la remplacerait par « open ».
    const FILTRES = { 'a-repondre': 'open', repondus: 'answered', termines: 'closed', tous: '' };
    const statut = Object.prototype.hasOwnProperty.call(FILTRES, filtre) ? FILTRES[filtre] : 'open';
    const mots = String(q || '').trim().toLowerCase();
    let fils = etat.threads.filter((f) => !statut || f.status === statut);
    if (mots) fils = fils.filter((f) => `${f.contactName} ${f.contactEmail} ${f.subject}`.toLowerCase().includes(mots));
    fils.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    const total = fils.length;
    return { threads: fils.slice(offset, offset + limit).map(filDeListe), total };
  }
  function chargerFil(id) {
    const fil = etat.threads.find((f) => String(f.id) === String(id));
    if (!fil) return null;
    const autres = etat.threads.filter((f) => f.id !== fil.id && f.contactEmail === fil.contactEmail).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    return {
      thread: clone(fil), messages: messagesDuFil(fil).map(messageDuFil),
      contact: { email: fil.contactEmail, name: fil.contactName, autresFils: autres.map((a) => ({ id: a.id, subject: a.subject, status: a.status, lastMessageAt: a.lastMessageAt, messageCount: a.messageCount })), nbFils: autres.length + 1 },
    };
  }
  function compteurs() {
    const depuis7 = Date.now() - 7 * J;
    const sortants = etat.comms.filter((c) => c.direction !== 'inbound');
    const ouverts = etat.threads.filter((f) => f.status === 'open');
    const tousEvenements = Object.values(etat.events).flat();
    return {
      aRepondre: ouverts.length,
      plusAncienneAttenteAt: ouverts.map((f) => f.lastInboundAt).filter(Boolean).sort()[0] || null,
      recus7j: etat.comms.filter((c) => c.direction === 'inbound' && new Date(c.createdAt).getTime() > depuis7).length,
      envoyes7j: sortants.filter((c) => ['sent', 'delivered'].includes(c.status) && new Date(c.sentAt || c.createdAt).getTime() > depuis7).length,
      remis7j: sortants.filter((c) => c.deliveredAt && new Date(c.deliveredAt).getTime() > depuis7).length,
      ouverts7j: sortants.filter((c) => c.openedAt && new Date(c.openedAt).getTime() > depuis7).length,
      echecs7j: sortants.filter((c) => c.status === 'failed' && new Date(c.createdAt).getTime() > depuis7).length,
      enAttente: sortants.filter((c) => ['queued', 'processing'].includes(c.status)).length,
      programmes24h: sortants.filter((c) => c.status === 'queued' && c.scheduledAt && new Date(c.scheduledAt).getTime() > Date.now() && new Date(c.scheduledAt).getTime() <= Date.now() + J).length,
      questions: etat.questions.length,
      suivi: { evenementsRecus30j: tousEvenements.length > 0, ouverturesObservees: tousEvenements.some((e) => e.type === 'opened'), clicsObserves: tousEvenements.some((e) => e.type === 'clicked') },
    };
  }
  function suiviAgent() {
    const depuis = Date.now() - 7 * J;
    return {
      faits: etat.appris.length,
      questions: etat.questions.length,
      resolues: etat.appris.reduce((n, f) => n + (Number(f.resolues) || 0), 0),
      semaine: etat.appris.filter((f) => new Date(f.le).getTime() >= depuis).length,
      corrections: 0,
    };
  }
  function vueGlobale() {
    const statParTemplate = (ids) => {
      const lignes = etat.comms.filter((c) => c.direction !== 'inbound' && ids.includes(c.templateId));
      return { sent30d: lignes.filter((c) => ['sent', 'delivered'].includes(c.status)).length, failed30d: lignes.filter((c) => c.status === 'failed').length, lastSentAt: lignes.map((c) => c.sentAt).filter(Boolean).sort().pop() || null };
    };
    const sequences = Object.keys(AUTOMATION_DEFAULTS).map((key) => ({
      key, label: LIBELLES[SEQUENCE_TEMPLATE_IDS[key][0]] || key, custom: false,
      enabled: etat.settings[key] ? etat.settings[key].enabled !== false : true,
      sent30d: AUTOMATION_STATS[key].sent30d, failed30d: AUTOMATION_STATS[key].failed30d, lastSentAt: statParTemplate(SEQUENCE_TEMPLATE_IDS[key]).lastSentAt,
    }));
    for (const s of etat.sequences) sequences.push({ key: String(s.id), label: s.name, custom: true, enabled: s.enabled !== false, ...statParTemplate([`custom_${s.id}`]) });
    return { centerId: CENTER_ID, ...compteurs(), sequences, aJourA: new Date().toISOString() };
  }
  function listerEnvoyes({ origine, statut, q, limit }) {
    let lignes = etat.comms.filter((c) => c.direction !== 'inbound');
    if (origine && origine !== 'tous') lignes = lignes.filter((c) => origineDe(c) === origine);
    const filtres = { attente: (c) => ['queued', 'processing'].includes(c.status), envoyes: (c) => ['sent', 'delivered'].includes(c.status), remis: (c) => Boolean(c.deliveredAt), ouverts: (c) => Boolean(c.openedAt), echecs: (c) => c.status === 'failed', 'a-valider': (c) => c.templateId === 'staff_review_request' };
    if (filtres[statut]) lignes = lignes.filter(filtres[statut]);
    const mots = String(q || '').trim().toLowerCase();
    if (mots) lignes = lignes.filter((c) => `${c.subject} ${c.recipient}`.toLowerCase().includes(mots));
    lignes.sort((a, b) => new Date(b.sentAt || b.createdAt) - new Date(a.sentAt || a.createdAt));
    return {
      messages: lignes.slice(0, limit).map((c) => ({ ...clone(c), origine: origineDe(c), sequenceLabel: LIBELLES[c.templateId] || '', sentBy: (c.payload && c.payload.sentBy) || null, suivi: messageDuFil(c).suivi, aRecuUneReponse: Boolean(c.threadId && etat.comms.some((x) => x.direction === 'inbound' && x.threadId === c.threadId && new Date(x.createdAt) > new Date(c.sentAt || c.createdAt))) })),
      total: lignes.length,
    };
  }
  function analyserTexte(from, subject, body) {
    const t = `${subject} ${body}`.toLowerCase();
    const intent = /anniv/.test(t) ? 'anniversaire' : /annul|report/.test(t) ? 'annulation' : /prix|tarif|combien|devis/.test(t) ? 'prix' : /horaire|ouvert|ferm/.test(t) ? 'horaires' : /réclam|reclam|déçu|plainte/.test(t) ? 'reclamation' : /réserv|reserv|place|dispo/.test(t) ? 'reservation' : 'autre';
    const labels = { reservation: 'Réservation', annulation: 'Annulation', anniversaire: 'Anniversaire', prix: 'Prix', horaires: 'Horaires', reclamation: 'Réclamation', autre: 'Autre' };
    const prenom = String(from || '').split('@')[0].split(/[._-]/)[0];
    const clientName = prenom ? prenom.charAt(0).toUpperCase() + prenom.slice(1) : '';
    return { intent, intentLabel: labels[intent], summary: extrait(body, 120), urgency: /urgent|vite|rapidement/.test(t) ? 'haute' : 'normale', provider: 'rules', clientName, reply: { subject: `Re: ${sujetSansPrefixe(subject) || 'votre message'}`, body: `Bonjour${clientName ? ` ${clientName}` : ''},\n\nMerci pour votre message. Voici ce que je peux vous proposer : …\n\nÀ bientôt,` } };
  }

  /* Le repondeur : GET puis POST. Retourne { status, payload } ou null. */
  function repondreGet(action, params) {
    switch (action) {
      case 'menuCenters': return { centers: [{ id: CENTER_ID, name: CENTRE.name, shortName: 'Libramont', status: 'active' }], owner: false };
      case 'communications': return { communications: clone(etat.comms).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) };
      case 'emailSamples': return { samples: [] };
      case 'suggestions': return { suggestions: [] };
      case 'events': return { events: [] };
      case 'agentStack': return { agentStack: null, activations: [], orchestration: {} };
      case 'emailClaims': return { claims: prisesVivantes() };
      case 'pulse': return { empreinte: `fixtures-${etat.comms.length}-${etat.threads.length}` };
      case 'agentQuestions': return { questions: clone(etat.questions), appris: clone(etat.appris), suivi: suiviAgent() };
      case 'emailStudio': return { templates: clone(etat.templates), identities: clone(etat.identities), channel: { resendConfigured: true, aiConfigured: false } };
      case 'automationSettings': return { settings: clone(etat.settings), defaults: clone(AUTOMATION_DEFAULTS), stats: clone(AUTOMATION_STATS) };
      case 'customSequences': return { sequences: clone(etat.sequences), limits: { maxSequences: 10, cap: [1, 100], triggers: { after_visit: { label: 'X jours après une visite', days: [1, 90], variables: ['prenom', 'centre'] }, before_visit: { label: 'X jours avant une venue prévue', days: [1, 60], variables: ['prenom', 'centre', 'date', 'heure', 'formule', 'pax'] }, inactive: { label: 'Clients plus vus depuis X jours', days: [30, 365], variables: ['prenom', 'centre'] }, weekly: { label: 'Chaque semaine, un jour fixe', variables: ['prenom', 'centre'] }, monthly: { label: 'Chaque mois, un jour fixe', variables: ['prenom', 'centre'] } }, segments: { all: 'Tous les clients avec email', dormant: 'Dormants (+90 jours)', loyal: 'Fidèles', birthdays: 'Clients anniversaire' } } };
      case 'emailBrain': return { overrides: clone(etat.brain.overrides), defaults: { intents: { reservation: 'Réservation', annulation: 'Annulation / report', anniversaire: 'Anniversaire', prix: 'Prix & tarifs', horaires: 'Horaires', reclamation: 'Réclamation', autre: 'Autre' }, faq: { horaires: { subject: 'Nos horaires', body: 'Nous sommes ouverts du mercredi au dimanche, de 14 h à 22 h.' }, prix: { subject: 'Nos tarifs', body: 'Une partie de bowling coûte 7 € par personne, chaussures comprises.' } }, signature: 'L\'équipe Fun Galaxy' } };
      case 'suppressions': return { entries: clone(etat.suppressions), total: etat.suppressions.length };
      case 'listCampaigns': return { campaigns: clone(etat.campaigns), segments: [{ id: 'all', label: 'Tous les clients avec email' }, { id: 'dormant', label: 'Dormants (+90 jours)' }, { id: 'loyal', label: 'Fidèles' }, { id: 'birthdays', label: 'Clients anniversaire' }], channel: { resendConfigured: true } };
      case 'campaignAudience': {
        const tailles = { all: 120, dormant: 34, loyal: 51, birthdays: 12 };
        const n = tailles[params.get('segment')] || 0;
        return { count: n, sample: [{ name: 'Marie Dupont', email: 'marie@exemple.be' }, { name: 'Lucas Petit', email: 'lucas@exemple.be' }].slice(0, Math.min(2, n)), recipients: params.get('full') === '1' ? [{ name: 'Marie Dupont', email: 'marie@exemple.be', visits: 4, revenue: 96, lastDate: '2026-09-01' }] : undefined };
      }
      case 'emailOverview': return vueGlobale();
      case 'emailThreads': return listerFils({ filtre: params.get('filtre') || 'a-repondre', q: params.get('q') || '', limit: Math.min(Math.max(Number(params.get('limit') || 50), 1), 200), offset: Math.max(Number(params.get('offset') || 0), 0) });
      case 'emailThread': {
        const fil = chargerFil(params.get('id'));
        if (!fil) return { status: 404, payload: { ok: false, message: 'Conversation introuvable.' } };
        return fil;
      }
      case 'emailSent': return listerEnvoyes({ origine: params.get('origine') || 'tous', statut: params.get('statut') || 'tous', q: params.get('q') || '', limit: Number(params.get('limit') || 100) });
      case 'emailDesign': return { design: designEffectif(), stored: etat.design ? clone(etat.design) : null, defaults: designParDefaut(), presets: clone(DESIGN_PRESETS), reponse: { adresse: CENTRE.publicInfo.email, versPinlane: false }, center: clone(CENTRE), logos: [{ label: 'Logo du centre (fond clair)', url: logoAbsolu(CENTRE.branding.emailLogo) }, { label: 'Logo du centre (fond sombre)', url: logoAbsolu(CENTRE.branding.emailLogoDark) }] };
      default: return { ok: true };
    }
  }
  function repondrePost(body) {
    const action = String(body.action || '');
    const personne = { name: MOI.name, role: MOI.role };
    switch (action) {
      case 'claimInboundEmail': {
        const id = Number(body.communicationId);
        etat.claims[id] = { communicationId: id, centerId: CENTER_ID, ...MEMBRES.moi, claimedAt: etat.claims[id] ? etat.claims[id].claimedAt : new Date().toISOString(), expiresAt: dans(3 * 60000) };
        return { claim: etat.claims[id] };
      }
      case 'releaseInboundEmail': delete etat.claims[Number(body.communicationId)]; return { released: true };
      case 'markCommunicationRead': {
        let marques = 0;
        for (const id of Array.isArray(body.communicationIds) ? body.communicationIds : []) {
          const comm = etat.comms.find((c) => Number(c.id) === Number(id));
          if (!comm) continue;
          const liste = etat.reads[comm.id] || (etat.reads[comm.id] = []);
          const mienne = liste.find((l) => l.memberId === MOI.id);
          const maintenant = new Date().toISOString();
          if (mienne) { mienne.lastReadAt = maintenant; mienne.readCount += 1; } else liste.push({ ...MEMBRES.moi, firstReadAt: maintenant, lastReadAt: maintenant, readCount: 1 });
          marques += 1;
        }
        return { marques };
      }
      case 'setThreadStatus': {
        const fil = etat.threads.find((f) => String(f.id) === String(body.threadId));
        if (!fil) return { status: 404, payload: { ok: false, message: 'Conversation introuvable.' } };
        if (!['open', 'answered', 'closed'].includes(body.status)) return { status: 400, payload: { ok: false, message: 'Statut inconnu.' } };
        fil.status = body.status; fil.updatedAt = new Date().toISOString();
        return { thread: clone(fil) };
      }
      case 'sendDirectEmail': {
        const reponseA = body.replyToCommunicationId ? etat.comms.find((c) => Number(c.id) === Number(body.replyToCommunicationId)) : null;
        let fil = body.threadId ? etat.threads.find((f) => String(f.id) === String(body.threadId)) : (reponseA ? etat.threads.find((f) => f.id === reponseA.threadId) : null);
        if (!fil) {
          fil = ajouterFil({ id: 900 + etat.prochainId, contactEmail: String(body.to || '').toLowerCase(), contactName: String(body.name || ''), subject: sujetSansPrefixe(body.subject), status: 'answered', origin: 'outbound', createdAt: new Date().toISOString() });
        }
        const comm = ajouterComm({
          threadId: fil.id, templateId: reponseA ? 'direct_reply' : 'direct_message', recipient: String(body.to || ''), subject: String(body.subject || ''),
          createdAt: new Date().toISOString(), sentAt: body.scheduledAt ? null : new Date().toISOString(), scheduledAt: body.scheduledAt || null, status: body.scheduledAt ? 'queued' : 'sent',
          inReplyTo: reponseA ? reponseA.messageId : '', payload: { direct: true, sentBy: MEMBRES.moi, replyToCommunicationId: reponseA ? reponseA.id : null, signature: Boolean(body.signature), signatoryName: body.signatoryName || '', signatoryRole: body.signatoryRole || '' },
          textBody: String(body.body || ''),
        });
        comm.body = rendreMail({ design: designEffectif(), subject: comm.subject, body: body.body, person: body.signature ? { name: body.signatoryName || MOI.name, role: body.signatoryRole || MOI.role } : null, signature: Boolean(body.signature) });
        if (reponseA) { reponseA.payload.replyCommunicationId = comm.id; reponseA.payload.repliedAt = new Date().toISOString(); }
        fil.status = 'answered';
        recalculerFil(fil);
        delete etat.claims[reponseA ? reponseA.id : 0];
        return { communication: { id: comm.id, status: comm.status } };
      }
      case 'analyzeInboundEmail': {
        const analysis = analyserTexte(body.from, body.subject || 'Mail collé', body.body);
        if (!body.store) return { analysis };
        const fil = ajouterFil({ id: 900 + etat.prochainId, contactEmail: String(body.from || '').toLowerCase(), contactName: analysis.clientName, subject: sujetSansPrefixe(body.subject || 'Mail collé'), status: 'open', origin: 'inbound', createdAt: new Date().toISOString() });
        const comm = ajouterComm({ threadId: fil.id, direction: 'inbound', status: 'received', templateId: null, recipient: String(body.from || ''), subject: body.subject || 'Mail collé', createdAt: new Date().toISOString(), payload: { from: body.from, fromName: analysis.clientName, receivedAt: new Date().toISOString(), textBody: String(body.body || ''), analysis } });
        recalculerFil(fil);
        return { communication: { id: comm.id }, analysis };
      }
      case 'directEmailPreview': {
        const subject = remplirVariables(body.subject || 'Aperçu', CLIENT_EXEMPLE);
        return { subject, html: rendreMail({ design: designEffectif(), subject, body: remplirVariables(body.body || '', CLIENT_EXEMPLE), person: body.signature ? { name: body.signatoryName || MOI.name, role: body.signatoryRole || MOI.role } : null, signature: body.signature !== false && designEffectif().signatureScope.manual }) };
      }
      case 'automationPreview': {
        const def = AUTOMATION_DEFAULTS[body.key] || { subject: 'Aperçu', body: '' };
        const reglage = etat.settings[body.key] || {};
        const subject = remplirVariables(body.subject || reglage.subject || def.subject, CLIENT_EXEMPLE);
        return { subject, html: rendreMail({ design: designEffectif(), subject, body: remplirVariables(body.body || reglage.body || def.body, CLIENT_EXEMPLE), signature: designEffectif().signatureScope.sequences }), textBody: remplirVariables(body.body || reglage.body || def.body, CLIENT_EXEMPLE) };
      }
      case 'customSequencePreview': {
        const s = body.sequence || {};
        const subject = remplirVariables(s.subject || 'Aperçu de la séquence', CLIENT_EXEMPLE);
        return { subject, html: rendreMail({ design: designEffectif(), subject, body: remplirVariables(s.body || '', CLIENT_EXEMPLE), signature: designEffectif().signatureScope.sequences }) };
      }
      case 'emailDesignPreview': {
        const design = body.design ? validerDesign(body.design) : designEffectif();
        const sample = ['confirmation', 'reponse', 'campagne'].includes(body.sample) ? body.sample : 'confirmation';
        if (sample === 'confirmation') {
          const subject = remplirVariables(AUTOMATION_DEFAULTS.confirmation.subject, CLIENT_EXEMPLE);
          return { sample, subject, html: rendreMail({ design, subject, body: remplirVariables(AUTOMATION_DEFAULTS.confirmation.body, CLIENT_EXEMPLE), signature: design.signatureScope.sequences }) };
        }
        if (sample === 'reponse') {
          const subject = 'Re: Votre demande pour samedi';
          return { sample, subject, html: rendreMail({ design, subject, body: 'Bonjour Marie,\n\nMerci pour votre message. Oui, il reste de la place samedi : je vous propose 15 h, le temps de vous installer et de lancer tout le groupe ensemble.\nDites-moi si cela vous convient, et je bloque le créneau à votre nom.', person: personne, signature: design.signatureScope.manual }) };
        }
        const subject = 'Une soirée bowling entre amis ?';
        return { sample, subject, html: rendreMail({ design, subject, body: 'Bonjour Marie,\n\nLes soirées rallongent : c\'est le moment de réserver une piste entre amis ou en famille. Réservez en ligne, on s\'occupe du reste.', signature: design.signatureScope.campaigns, retrait: true }) };
      }
      case 'emailDesign': {
        const design = validerDesign(body.design || {});
        design.updatedAt = new Date().toISOString();
        design.updatedBy = MOI.name;
        etat.design = design;
        return { design: clone(design) };
      }
      case 'sendDesignTest': case 'sendAutomationTest': case 'sendCustomSequenceTest': return { status: 'sent', recipient: MOI.contact, error: '' };
      case 'automationSettings': {
        const cle = body.key;
        if (!AUTOMATION_DEFAULTS[cle]) return { status: 400, payload: { ok: false, message: 'Séquence inconnue.' } };
        if (body.reset) etat.settings[cle] = { enabled: !!(etat.settings[cle] && etat.settings[cle].enabled) };
        else {
          etat.settings[cle] = etat.settings[cle] || {};
          if ('enabled' in body) etat.settings[cle].enabled = !!body.enabled;
          for (const champ of ['subject', 'body', 'reviewUrl']) if (body[champ] !== undefined) etat.settings[cle][champ] = String(body[champ]);
          for (const champ of ['offsetDays', 'cap']) if (body[champ] !== undefined) etat.settings[cle][champ] = Number(body[champ]);
        }
        return { settings: clone(etat.settings), defaults: clone(AUTOMATION_DEFAULTS), stats: clone(AUTOMATION_STATS) };
      }
      case 'customSequences': {
        if (body.op === 'delete') etat.sequences = etat.sequences.filter((s) => s.id !== body.id);
        else if (body.op === 'toggle') { const s = etat.sequences.find((x) => x.id === body.id); if (s) s.enabled = !!body.enabled; }
        else if (body.sequence) {
          const s = { ...body.sequence };
          if (!String(s.name || '').trim()) return { status: 400, payload: { ok: false, message: 'Donnez un nom à la séquence.' } };
          const existante = s.id ? etat.sequences.find((x) => x.id === s.id) : null;
          if (existante) Object.assign(existante, s); else { s.id = `cs_${Date.now().toString(36)}`; s.enabled = s.enabled !== false; etat.sequences.push(s); }
        }
        return { sequences: clone(etat.sequences) };
      }
      case 'emailBrain': {
        const faq = { ...etat.brain.overrides.faq };
        for (const [intent, valeur] of Object.entries(body.faq || {})) { if (valeur === null) delete faq[intent]; else faq[intent] = valeur; }
        etat.brain.overrides = { faq, signature: String(body.signature || ''), extra: String(body.extra || '') };
        return { overrides: clone(etat.brain.overrides) };
      }
      case 'saveEmailTemplate': {
        const t = body.id ? etat.templates.find((x) => String(x.id) === String(body.id)) : null;
        if (t) Object.assign(t, { label: body.name, category: body.category, subject: body.subject, body: body.body });
        else etat.templates.push({ id: etat.prochainId++, label: body.name, category: body.category || 'marketing', subject: body.subject || '', body: body.body || '' });
        return { template: { id: t ? t.id : etat.templates[etat.templates.length - 1].id } };
      }
      case 'archiveEmailTemplate': etat.templates = etat.templates.filter((t) => String(t.id) !== String(body.id)); return { archived: true };
      case 'saveEmailIdentity': {
        if (body.isDefault) etat.identities.forEach((i) => { i.isDefault = false; });
        const i = body.id ? etat.identities.find((x) => String(x.id) === String(body.id)) : null;
        if (i) Object.assign(i, { label: body.label, email: body.email, isDefault: !!body.isDefault });
        else etat.identities.push({ id: etat.prochainId++, label: body.label || body.email, email: body.email, isDefault: !!body.isDefault || etat.identities.length === 0 });
        return { identity: { id: i ? i.id : etat.identities[etat.identities.length - 1].id } };
      }
      case 'deleteEmailIdentity': etat.identities = etat.identities.filter((i) => String(i.id) !== String(body.id)); return { deleted: true };
      case 'retryCommunication': {
        const c = etat.comms.find((x) => Number(x.id) === Number(body.id));
        if (c) { c.status = 'sent'; c.lastError = ''; c.sentAt = new Date().toISOString(); c.attempts = (c.attempts || 0) + 1; }
        return { id: body.id, status: 'sent', error: '' };
      }
      case 'suppressionAdd': etat.suppressions.unshift({ email: String(body.email || '').toLowerCase(), source: 'staff', reason: String(body.reason || ''), createdAt: new Date().toISOString() }); return { added: true };
      case 'suppressionRemove': etat.suppressions = etat.suppressions.filter((e) => e.email !== String(body.email || '').toLowerCase()); return { removed: true };
      // L apprentissage, au contrat du serveur (api/ops.js) : le fait, la
      // reponse proposee avant et apres, les questions proches a relire.
      case 'answerAgentQuestion': {
        const q = etat.questions.find((x) => Number(x.communicationId) === Number(body.communicationId));
        etat.questions = etat.questions.filter((x) => Number(x.communicationId) !== Number(body.communicationId));
        const fait = { id: etat.prochainFait++, question: q ? q.question : 'Question', reponse: String(body.reponse || ''), par: MOI.name, le: new Date().toISOString(), resolues: 1, versions: 0 };
        etat.appris.unshift(fait);
        const comm = etat.comms.find((c) => Number(c.id) === Number(body.communicationId));
        const avant = comm && comm.payload && comm.payload.analysis && comm.payload.analysis.reply ? clone(comm.payload.analysis.reply) : null;
        const apres = avant ? { subject: avant.subject, body: `${avant.body.split('\n')[0]}\n\n${fait.reponse}` } : null;
        if (comm && comm.payload && comm.payload.analysis) { comm.payload.analysis.questionRepondue = true; if (apres) comm.payload.analysis.reply = apres; }
        return { fait, appris: clone(etat.appris), reanalyse: Boolean(apres), avant, apres, utilise: apres ? true : null, proches: [] };
      }
      case 'agentApplyFact': return { resultats: [], resolues: 0 };
      case 'teachAgentFact': {
        const fait = { id: etat.prochainFait++, question: String(body.question || ''), reponse: String(body.reponse || ''), par: MOI.name, le: new Date().toISOString(), resolues: 0, versions: 0 };
        etat.appris.unshift(fait);
        return { fait, appris: clone(etat.appris), proches: [] };
      }
      case 'editAgentFact': {
        const f = etat.appris.find((x) => Number(x.id) === Number(body.id));
        if (f) { f.reponse = String(body.reponse || ''); f.versions += 1; }
        return { fait: clone(f || null), appris: clone(etat.appris) };
      }
      case 'forgetAgentFact': etat.appris = etat.appris.filter((f) => (Number(body.id) > 0 ? Number(f.id) !== Number(body.id) : f.question !== body.question)); return { appris: clone(etat.appris) };
      case 'improveEmailWithAi': return { mode: 'regles', tips: ['Objet un peu court : visez 30 à 60 caractères.', 'Terminez par une question : elle appelle une réponse.'], subject: body.subject, body: body.body };
      case 'createCampaign': {
        const c = { id: etat.prochaineCampagne++, name: body.name, objective: body.objective || '', segment: body.segment, subject: body.subject, body: body.body, status: body.mode === 'draft' ? 'draft' : body.mode === 'schedule' ? 'scheduled' : 'sending', scheduledAt: body.scheduledAt || null, recipientCount: 34, sent: 0, failed: 0, queued: body.mode === 'draft' ? 0 : 34, opens: 0, clicks: 0, createdAt: new Date().toISOString() };
        etat.campaigns.unshift(c);
        return { campaign: c, queued: c.queued, resendConfigured: true };
      }
      case 'updateCampaign': { const c = etat.campaigns.find((x) => x.id === body.id); if (c) Object.assign(c, { name: body.name, objective: body.objective, segment: body.segment, subject: body.subject, body: body.body }); return { campaign: c || null }; }
      case 'sendCampaign': { const c = etat.campaigns.find((x) => x.id === body.id); if (c) { c.status = body.mode === 'schedule' ? 'scheduled' : 'sending'; c.queued = c.recipientCount; } return { campaign: c || null, queued: c ? c.queued : 0, resendConfigured: true }; }
      case 'cancelCampaign': { const c = etat.campaigns.find((x) => x.id === body.id); if (c) { c.status = 'cancelled'; c.queued = 0; } return { campaign: c || null, cancelledCommunications: 0 }; }
      default: return { ok: true };
    }
  }

  return {
    repondre(method, url, body) {
      if (url.pathname !== '/api/ops') return null;
      const reponse = method === 'POST' ? repondrePost(body || {}) : repondreGet(url.searchParams.get('action') || '', url.searchParams);
      if (reponse && reponse.status && reponse.payload) return reponse;
      return { status: 200, payload: { ok: true, ...reponse } };
    },
  };
}

/* ── LA COUTURE DU MODE REEL ────────────────────────────────────────────── */
function creerRepondeurReel() {
  // Prevu par la spec §5.5 : le VRAI api/ops.js monte sur une base en memoire
  // (meme stub `pg` dans require.cache que scripts/email-tenant-isolation-check.js),
  // semee des memes donnees. Pas encore branche : on le dit, on ne fait pas
  // semblant de servir la vraie API.
  throw new Error('Mode --reel non branché : il faut monter api/ops.js sur une base en mémoire (stub pg de scripts/email-tenant-isolation-check.js). Lancez sans --reel pour les fixtures.');
}

/* ── LE SERVEUR HTTP ────────────────────────────────────────────────────── */
function lireCorps(req) {
  return new Promise((resolve) => {
    let brut = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { brut += chunk; if (brut.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(brut ? JSON.parse(brut) : {}); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function envoyerJson(res, status, payload) {
  const corps = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ETag: `dev-${Date.now()}` });
  res.end(corps);
}
// index.html recoit un script qui pose la session dans localStorage AVANT
// app-main.js : c est exactement ce que les gates font avec addInitScript.
function indexAvecSession() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const script = `<script data-dev-console-session>(function(){try{var k=${JSON.stringify(AUTH_KEY)};if(!localStorage.getItem(k))localStorage.setItem(k,${JSON.stringify(JSON.stringify(sessionSimulee()))});var v='funGalaxy_v4';if(!localStorage.getItem(v))localStorage.setItem(v,JSON.stringify({view:'staff',staffMenuPage:'emails'}));}catch(e){}})();</script>`;
  const point = html.indexOf('<head>');
  return point >= 0 ? `${html.slice(0, point + 6)}\n${script}${html.slice(point + 6)}` : `${script}${html}`;
}
function servirStatique(req, res, url) {
  let chemin = decodeURIComponent(url.pathname);
  if (chemin === '/' || chemin === '/index.html') {
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    res.end(indexAvecSession());
    return;
  }
  const fichier = path.normalize(path.join(ROOT, chemin));
  if (!fichier.startsWith(ROOT) || fichier.includes(`${path.sep}node_modules${path.sep}`) || /[\\/]\.(git|env)/.test(fichier)) { res.writeHead(403); res.end('Interdit'); return; }
  fs.readFile(fichier, (err, contenu) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Introuvable'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fichier).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(contenu);
  });
}
function creerServeur(repondeur) {
  return http.createServer(async (req, res) => {
    if (req.headers.host) ORIGINE_APP = `http://${req.headers.host}`;
    const url = new URL(req.url, ORIGINE_APP);
    const method = String(req.method || 'GET').toUpperCase();
    if (!url.pathname.startsWith('/api/')) { servirStatique(req, res, url); return; }
    const body = method === 'POST' || method === 'PUT' || method === 'PATCH' ? await lireCorps(req) : {};
    try {
      if (url.pathname === '/api/staff-auth') { envoyerJson(res, 200, { ok: true, authenticated: true, session: sessionSimulee(), accessControl: accessControlSimule() }); return; }
      if (url.pathname === '/api/staff-state') { envoyerJson(res, 200, { ok: true, revision: 'dev', reservations: [], laneStatuses: Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {}), centerId: CENTER_ID }); return; }
      if (url.pathname === '/api/admin-range') { envoyerJson(res, 200, { ok: true, reservations: [], emails: [], agentEvents: [], centerId: CENTER_ID }); return; }
      if (url.pathname === '/api/marketing-agents') { envoyerJson(res, 200, { ok: true, centers: [], updatedAt: new Date().toISOString() }); return; }
      if (url.pathname === '/api/simulation') { envoyerJson(res, 200, { ok: true, status: 'idle', simulation: null }); return; }
      if (url.pathname === '/api/public-booking-meta') {
        envoyerJson(res, 200, { ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: { id: CENTER_ID, name: CENTRE.name, status: 'active', contact: CENTRE.publicInfo, branding: CENTRE.branding, defaultSchedule: { regular: {}, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
        return;
      }
      const reponse = repondeur.repondre(method, url, body);
      if (reponse) { envoyerJson(res, reponse.status, reponse.payload); return; }
      envoyerJson(res, 200, { ok: true });
    } catch (error) {
      envoyerJson(res, error.status || 500, { ok: false, message: error.message || 'Erreur du serveur de développement.' });
    }
  });
}

function demarrer() {
  const repondeur = MODE === 'reel' ? creerRepondeurReel() : creerRepondeurFixtures({ origine: `http://${HOST}:${PORT}` });
  const serveur = creerServeur(repondeur);
  return new Promise((resolve, reject) => {
    serveur.once('error', reject);
    serveur.listen(PORT, HOST, () => resolve(serveur));
  });
}

if (require.main === module) {
  demarrer().then(() => {
    console.log(`Console de dev (${MODE}) : http://${HOST}:${PORT}/#/staff/emails/apercu`);
    console.log('Session simulee : Camille Dev (Direction) sur le centre libramont. Ctrl+C pour arreter.');
  }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { demarrer, creerRepondeurFixtures, creerServeur, rendreMail, PORT, HOST, CENTER_ID, sessionSimulee, MOI };
