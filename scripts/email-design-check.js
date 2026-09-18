// LE DESIGN DES MAILS D UN CENTRE : GABARITS, ACCENT, SIGNATURE (2026-09-16).
//
// POURQUOI CE GATE EXISTE. Movsar veut un modele de mail modifiable, avec
// pre-gabarits, et une signature pro (logo reel, coordonnees) au choix, pour
// TOUS les mails. Le danger d une telle fonction est double : inventer une
// donnee (un telephone plausible, un logo qui n existe pas) et laisser passer
// du HTML ou une URL hostile dans un mail signe du domaine du centre. Ce gate
// prouve, sur le VRAI code (lib/email-design, lib/ops-communications) :
//
//   [A] les defauts n inventent RIEN : sans catalogue, aucun telephone, aucune
//       adresse, aucun logo, aucun reseau ; avec le catalogue, ses valeurs ;
//   [B] les quatre gabarits rendent un HTML de mail complet (tables, styles en
//       ligne, largeur 600, pas de <script>), chacun avec sa marque propre ;
//   [C] l accent est applique (couleur du centre, couleur perso, encre), et
//       l ambre d une alerte staff n est jamais repeint aux couleurs du client ;
//   [D] la signature suit sa PORTEE (manuel, sequences, campagnes) et son
//       interrupteur maitre ;
//   [E] la personne ne signe qu un envoi MANUEL ; une sequence signe de l equipe ;
//   [F] les champs du gerant sont echappes (<img onerror> inerte) et les URL
//       hostiles refusees ;
//   [G] l apercu EST le chemin d envoi : meme HTML pour un apercu de composeur
//       et pour l envoi, meme HTML pour l apercu du design et celui des sequences ;
//   [H] le test part au membre de session, jamais a une adresse de la requete ;
//   [I] enregistrer le design n ecrase ni les sequences personnalisees ni le
//       cerveau de l agent (une cle du jsonb, pas le blob) ;
//   [J] la cloture textuelle « À très vite, L'équipe X » n est pas signee deux
//       fois, et le pied ne repete pas une coordonnee que la signature porte.
//
// CONTRE-EPREUVES par mutation compilee en memoire (disque jamais touche).
//
// Usage : node scripts/email-design-check.js
'use strict';
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';
process.env.PUBLIC_APP_URL = 'https://app.pinlane.be';
delete process.env.PUBLIC_APP_ORIGIN;
process.env.UNSUBSCRIBE_SECRET = 'gate-design-secret-0123456789abcdef0123456789abcdef';
delete process.env.RESEND_API_KEY;

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// LA BASE EN MEMOIRE : les reglages du centre (un jsonb par centre). L ecriture
// OBEIT AU TEXTE : une fusion `||` garde les autres cles, un `set settings = $2`
// les efface, comme le ferait le moteur.
// ---------------------------------------------------------------------------
const REGLAGES = new Map();
const ECRITURES = [];
function reset() {
  REGLAGES.clear();
  REGLAGES.set('libramont', {
    custom_sequences: [{ id: 'cs_gate', name: 'Relance J+7', enabled: true, trigger: { type: 'after_visit', days: 7 }, subject: 'On se revoit ?', body: 'Bonjour {{prenom}}', cap: 10 }],
    email_brain: { signature: 'La team FG', faq: {}, extra: 'Parking gratuit' },
  });
  ECRITURES.length = 0;
}
async function requete(texte, params = []) {
  const sql = String(texte).replace(/\s+/g, ' ').trim();
  const p = params || [];
  if (/^select settings from center_automation_settings where center_id = \$1/i.test(sql)) {
    return { rows: REGLAGES.has(p[0]) ? [{ settings: JSON.parse(JSON.stringify(REGLAGES.get(p[0]))) }] : [], rowCount: 0 };
  }
  if (/^insert into center_automation_settings/i.test(sql)) {
    ECRITURES.push(sql);
    const nouveau = JSON.parse(p[1]);
    const actuel = REGLAGES.get(p[0]) || null;
    if (!actuel) REGLAGES.set(p[0], { email_design: nouveau });
    else if (/set settings = coalesce\(center_automation_settings\.settings, '\{\}'::jsonb\) \|\| jsonb_build_object\('email_design', \$2::jsonb\)/.test(sql)) REGLAGES.set(p[0], { ...actuel, email_design: nouveau });
    else if (/set settings = jsonb_build_object\('email_design', \$2::jsonb\)/.test(sql)) REGLAGES.set(p[0], { email_design: nouveau });
    else REGLAGES.set(p[0], nouveau);
    return { rows: [], rowCount: 1 };
  }
  if (/from email_identities/i.test(sql)) return { rows: [], rowCount: 0 };
  if (/from marketing_suppressions/i.test(sql)) return { rows: [], rowCount: 0 };
  if (/occasion = 'anniversaire'/.test(sql)) return { rows: [{ id: 1, name: 'Famille Kessler', phone: '+32470111007', email: 'kessler@exemple.be', date: ANNIVERSAIRE }], rowCount: 1 };
  if (/template_id = 'birthday_j30'/.test(sql)) return { rows: [], rowCount: 0 };
  return { rows: [], rowCount: 0 };
}
const iso = (offsetDays) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offsetDays); return d.toISOString().slice(0, 10); };
const ANNIVERSAIRE = iso(-335);

class FakePool {
  async query(texte, params) { return requete(texte, params); }
  async connect() { return { query: (texte, params) => requete(texte, params), release() {} }; }
  on() {}
  async end() {}
}
const pgResolu = require.resolve('pg', { paths: [ROOT] });
require.cache[pgResolu] = { id: pgResolu, filename: pgResolu, loaded: true, exports: { Pool: FakePool } };
global.fetch = async () => { throw new Error('reseau interdit dans ce gate'); };

// ---------------------------------------------------------------------------
// MUTATIONS COMPILEES EN MEMOIRE.
// ---------------------------------------------------------------------------
const MUTABLES = ['lib/email-design.js', 'lib/ops-communications.js'];
let mutations = [];
const compileOrigine = Module.prototype._compile;
Module.prototype._compile = function compileMute(contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const editions = mutations.filter((e) => e.fichier === rel);
  if (!editions.length) return compileOrigine.call(this, contenu, nom);
  let mute = contenu.split(CRLF).join(LF);
  for (const { de, vers } of editions) {
    if (mute.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 80)}`);
    mute = mute.split(de).join(vers);
  }
  return compileOrigine.call(this, mute, nom);
};
function charger() {
  for (const rel of MUTABLES) delete require.cache[require.resolve(path.join(ROOT, rel))];
  return { design: require(path.join(ROOT, 'lib/email-design.js')), comms: require(path.join(ROOT, 'lib/ops-communications.js')) };
}

const deps = { query: requete };
const { getCenter } = require(path.join(ROOT, 'lib/ops-knowledge.js'));
const LIBRAMONT = getCenter('libramont');
const KEVIN = { id: 'libramont:kevin', name: 'Kevin Dupont', role: 'Direction', contact: 'kevin@fungalaxy.be' };
const liens = (html) => (String(html).match(/<a\s/gi) || []).length;
const images = (html) => (String(html).match(/<img\s/gi) || []).length;
const CENTRE_NU = { id: 'nu', name: 'Centre Nu', publicInfo: {}, branding: {} };

async function rendu(m, { design, portee = 'manual', person = null, body = 'Bonjour Marie,\n\nVoici la reponse.', accent, action = null } = {}) {
  return m.comms.emailShell({
    title: 'Objet de test', body, preheader: 'Apercu', center: LIBRAMONT, accent, action,
    design, signature: { enabled: Boolean(design.signatureScope[portee]), person },
  });
}

(async () => {
  reset();
  let m = charger();

  // =====================================================================
  console.log('[A] les defauts n inventent rien');
  // =====================================================================
  const defautsNus = m.design.getEmailDesignDefaults(CENTRE_NU);
  ok(defautsNus.signature.phone === '' && defautsNus.signature.email === '' && defautsNus.signature.address === '' && defautsNus.signature.logoUrl === '' && defautsNus.signature.website === ''
    && Object.values(defautsNus.signature.socials).every((v) => v === '') && defautsNus.header.logoUrl === '',
    '[A] un centre sans catalogue : aucun telephone, email, adresse, logo, site ni reseau');
  const defautsLibramont = m.design.getEmailDesignDefaults(LIBRAMONT);
  ok(defautsLibramont.signature.phone === LIBRAMONT.publicInfo.phone && defautsLibramont.signature.email === LIBRAMONT.publicInfo.email && /6800 Libramont/.test(defautsLibramont.signature.address)
    && defautsLibramont.signature.logoUrl === 'https://app.pinlane.be/assets/brand/logo-fun-galaxy-email-clair.png' && defautsLibramont.signature.website === '',
    '[A] Libramont : ses coordonnees du catalogue, son logo declare rendu absolu, et toujours aucun site ni reseau invente', JSON.stringify({ phone: defautsLibramont.signature.phone, logo: defautsLibramont.signature.logoUrl }));
  const htmlNu = m.comms.emailShell({ title: 'T', body: 'Bonjour', preheader: 'p', center: CENTRE_NU, design: defautsNus, signature: { enabled: true, person: null } });
  ok(liens(htmlNu) === 0 && images(htmlNu) === 0 && /L&#39;équipe Centre Nu/.test(htmlNu),
    '[A] signe par defaut chez un centre sans catalogue : « L équipe Centre Nu », zero lien, zero image');
  const inconnu = await m.comms.resolveEmailDesign('centre-qui-n-existe-pas', deps);
  ok(inconnu.signature.phone === '' && inconnu.signature.logoUrl === '' && inconnu.preset === 'simple', '[A] un centre inconnu du catalogue recoit des defauts vides (gabarit Mail simple), jamais ceux de Libramont');
  const resoluLibramont = await m.comms.resolveEmailDesign('libramont', deps);
  ok(resoluLibramont.signature.phone === LIBRAMONT.publicInfo.phone && resoluLibramont.signatureScope.manual === true && resoluLibramont.signatureScope.campaigns === false,
    '[A] resolveEmailDesign sans design enregistre = les defauts du centre (manuel et sequences signes, campagnes non)');

  // =====================================================================
  console.log('\n[B] les cinq gabarits rendent un mail complet');
  // =====================================================================
  const presets = m.comms.EMAIL_DESIGN_PRESETS.map((x) => x.id);
  ok(presets.join(',') === 'simple,classique,epure,carte,contraste', '[B] montage : cinq gabarits declares, Mail simple en tete', presets.join(','));
  const rendus = {};
  for (const preset of presets) {
    const design = { ...defautsLibramont, preset, header: { ...defautsLibramont.header, mode: 'logo' } };
    const html = await rendu(m, { design, portee: 'manual', person: KEVIN });
    rendus[preset] = html;
    ok(/^<!doctype html>/i.test(html) && (preset === 'simple' ? /<table role="presentation" width="100%"/.test(html) && /font-size:14px;line-height:1.5;/.test(html) && !/font-size:16px/.test(html) : /<table role="presentation" width="600"/.test(html)) && !/<script/i.test(html) && /style="/.test(html) && /Voici la reponse/.test(html)
      // Mail simple (2026-09-17) : le sujet reste dans l objet du mail, jamais en
      // titre dans le corps, et pas de pied de marque ; les autres le gardent.
      && (preset === 'simple' ? !/<h1/i.test(html) && !/Une question \?/.test(html) : /Objet de test/.test(html)),
      `[B] ${preset} : HTML complet en tables, styles en ligne, sans script${preset === 'simple' ? ', pleine largeur, texte 14 px, sans titre repete ni pied de marque' : ', largeur 600, titre en tete'}`);
  }
  ok(/border-top:4px solid #17151F/.test(rendus.carte) && !/border-top:4px solid/.test(rendus.classique), '[B] carte : une barre de 4 px en haut de carte ; classique : aucune');
  ok(!/border:1px solid #E6E6EB;border-radius:12px/.test(rendus.epure) && /border-bottom:1px solid #EFEFF3;font-family/.test(rendus.epure), '[B] epure : pas de carte bordee, un filet fin sous le titre');
  ok(/bgcolor="#17151F"/.test(rendus.contraste) && /logo-fun-galaxy-email\.png/.test(rendus.contraste) && !/bgcolor="#17151F"/.test(rendus.classique),
    '[B] contraste : bandeau sombre avec le logo BLANC declare par le centre');
  const contrasteSansLogoBlanc = m.comms.emailShell({ title: 'T', body: 'B', preheader: 'p', center: { ...CENTRE_NU, name: 'Sans Logo' }, design: { ...defautsNus, preset: 'contraste', header: { mode: 'logo', logoUrl: '', logoWidth: 140 } }, signature: { enabled: false } });
  ok(/bgcolor="#17151F"/.test(contrasteSansLogoBlanc) && /Sans Logo/.test(contrasteSansLogoBlanc) && images(contrasteSansLogoBlanc) === 0,
    '[B] contraste sans logo blanc declare : le nom en blanc, aucune image inventee');
  const enTeteAucun = await rendu(m, { design: { ...defautsLibramont, header: { ...defautsLibramont.header, mode: 'aucun' }, signature: { ...defautsLibramont.signature, logoUrl: '' } } });
  ok(images(enTeteAucun) === 0 && !/padding:18px 28px;border-bottom:1px solid #EFEFF3/.test(enTeteAucun), '[B] en-tete « aucun » : ni nom ni logo en tete de carte');

  // =====================================================================
  console.log('\n[C] l accent');
  // =====================================================================
  const BOUTON = { label: 'Réserver', href: 'https://app.pinlane.be/r' };
  const accentCentre = await rendu(m, { design: { ...defautsLibramont, preset: 'carte', accent: { mode: 'centre', hex: '' } }, action: BOUTON });
  ok(/border-top:4px solid #944292/.test(accentCentre) && /bgcolor="#944292"/.test(accentCentre), '[C] accent « centre » : la couleur du catalogue peint la barre et le bouton');
  const accentPerso = await rendu(m, { design: { ...defautsLibramont, preset: 'carte', accent: { mode: 'perso', hex: '#123456' } } });
  ok(/#123456/.test(accentPerso) && !/#944292/.test(accentPerso), '[C] accent « perso » : la couleur validee, et pas celle du centre');
  const accentEncre = await rendu(m, { design: { ...defautsLibramont, preset: 'carte', accent: { mode: 'encre', hex: '' } } });
  ok(!/#944292/.test(accentEncre) && !/#123456/.test(accentEncre), '[C] accent « encre » : aucune couleur de client');
  const alerte = await rendu(m, { design: { ...defautsLibramont, preset: 'carte', accent: { mode: 'centre', hex: '' } }, accent: '#8A4B08', body: 'Alerte', action: { label: 'Ouvrir', href: 'https://app.pinlane.be/direction.html' } });
  ok(/bgcolor="#8A4B08"/.test(alerte) && !/bgcolor="#944292"/.test(alerte), '[C] contraste : l ambre d une alerte staff n est pas repeint aux couleurs du client');
  const accentSansCatalogue = m.design.accentEffectif({ accent: { mode: 'centre' } }, CENTRE_NU, '#17151F');
  ok(accentSansCatalogue === '#17151F', '[C] « centre » sans couleur au catalogue retombe sur l encre');

  // =====================================================================
  console.log('\n[D][E] la portee de la signature, et qui signe');
  // =====================================================================
  const sig = (html) => /À très bientôt,/.test(html);
  const scope = { manual: true, sequences: false, campaigns: false };
  ok(sig(await rendu(m, { design: { ...defautsLibramont, signatureScope: scope }, portee: 'manual' })) && !sig(await rendu(m, { design: { ...defautsLibramont, signatureScope: scope }, portee: 'sequences' })) && !sig(await rendu(m, { design: { ...defautsLibramont, signatureScope: scope }, portee: 'campaigns' })),
    '[D] portee { manual: true, sequences: false, campaigns: false } : signe le manuel seulement');
  const maitre = { ...defautsLibramont, signature: { ...defautsLibramont.signature, enabled: false } };
  ok(!sig(await rendu(m, { design: maitre, portee: 'manual' })), '[D] interrupteur maitre coupe : aucune signature, meme sur la portee manuelle');
  const manuel = await rendu(m, { design: defautsLibramont, portee: 'manual', person: KEVIN });
  ok(/<strong>Kevin Dupont<\/strong>/.test(manuel) && /Direction · Fun Galaxy Libramont/.test(manuel), '[E] un envoi manuel signe de la personne, avec son role et son centre');
  const apercuSequence = await m.comms.buildAutomationPreview('libramont', 'confirmation', {}, deps);
  ok(sig(apercuSequence.html) && /L&#39;équipe Fun Galaxy Libramont/.test(apercuSequence.html) && !/Kevin/.test(apercuSequence.html),
    '[E] une sequence signe de l equipe, jamais d une personne');
  ok(/tel:0491301667/.test(manuel) && /mailto:libramont@fungalaxy\.be/.test(manuel) && /6800 Libramont/.test(manuel) && liens(manuel) === 2 && images(manuel) === 1,
    '[E] la signature porte telephone (tel:), email (mailto:), adresse et le logo : 2 liens, 1 image', `liens=${liens(manuel)} images=${images(manuel)}`);
  const reseaux = { ...defautsLibramont, signature: { ...defautsLibramont.signature, socials: { facebook: 'https://www.facebook.com/fungalaxy', instagram: 'https://instagram.com/fungalaxy', tiktok: '', linkedin: '' }, website: 'https://www.fungalaxy.be' } };
  const avecReseaux = await rendu(m, { design: reseaux, portee: 'manual' });
  ok(/>Facebook<\/a> · <a [^>]+>Instagram<\/a>/.test(avecReseaux) && /fungalaxy\.be<\/a>/.test(avecReseaux) && !/TikTok/.test(avecReseaux) && images(avecReseaux) === 1,
    '[E] reseaux et site : des liens TEXTE, seuls ceux renseignes, aucune icone image');
  const ligne = await rendu(m, { design: { ...defautsLibramont, signature: { ...defautsLibramont.signature, layout: 'ligne' } }, portee: 'manual' });
  ok(images(ligne) === 0 && /L&#39;équipe Fun Galaxy Libramont<\/strong> · <a/.test(ligne), '[E] disposition « ligne » : compacte, sans logo');

  // =====================================================================
  console.log('\n[F] echappement et URL hostiles');
  // =====================================================================
  const hostile = { ...defautsLibramont, signature: { ...defautsLibramont.signature, teamLabel: '<img src=x onerror=alert(1)>', closing: 'Bien à vous</p><script>alert(2)</script>' } };
  // Sans personne, c est le nom d equipe qui signe ; avec, c est le signataire.
  const echappeEquipe = await rendu(m, { design: hostile, portee: 'manual' });
  const echappePersonne = await rendu(m, { design: hostile, portee: 'manual', person: { name: '<b onmouseover=x>Kevin</b>', role: 'Direction' } });
  ok(!/<img src=x/.test(echappeEquipe) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(echappeEquipe) && !/<script/.test(echappeEquipe) && /&lt;script&gt;/.test(echappeEquipe)
    && !/<b onmouseover/.test(echappePersonne) && /&lt;b onmouseover=x&gt;Kevin/.test(echappePersonne) && !/<script/.test(echappePersonne),
    '[F] nom d equipe, formule et signataire hostiles rendus inertes');
  const erreurs = [];
  for (const [libelle, brouillon] of [
    ['logo javascript:', { signature: { logoUrl: 'javascript:alert(1)' } }],
    ['logo http', { header: { logoUrl: 'http://exemple.be/logo.png' } }],
    ['couleur invalide', { accent: { mode: 'perso', hex: 'rouge' } }],
    ['reseau sur un autre domaine', { signature: { socials: { facebook: 'https://evil.example/fungalaxy' } } }],
    ['site en http', { signature: { website: 'http://fungalaxy.be' } }],
    ['gabarit inconnu', { preset: 'neon' }],
    ['formule trop longue', { signature: { closing: 'x'.repeat(81) } }],
    ['largeur de logo hors bornes', { signature: { logoWidth: 900 } }],
  ]) {
    try { m.design.validateEmailDesign(brouillon, LIBRAMONT); erreurs.push(`${libelle} : ACCEPTE`); } catch (error) { if (!(error.expose === true && error.statusCode === 400 && /[a-zé]/i.test(error.message))) erreurs.push(`${libelle} : erreur non exposable`); }
  }
  ok(erreurs.length === 0, '[F] huit brouillons hostiles ou invalides refuses, chacun avec une erreur FR exposable', erreurs.join(' | '));
  const valide = m.design.validateEmailDesign({ accent: { mode: 'perso', hex: '#AABBCC' }, signature: { logoUrl: '/assets/brand/logo-fun-galaxy-email-clair.png', socials: { instagram: 'https://www.instagram.com/fungalaxy/' } } }, LIBRAMONT);
  ok(valide.accent.hex === '#aabbcc' && valide.signature.logoUrl === 'https://app.pinlane.be/assets/brand/logo-fun-galaxy-email-clair.png' && valide.signature.socials.instagram === 'https://www.instagram.com/fungalaxy/',
    '[F] contraste : une couleur majuscule est normalisee, un chemin du depot devient absolu, un reseau sur le bon domaine passe');

  // =====================================================================
  console.log('\n[G] l apercu est le chemin d envoi');
  // =====================================================================
  const enfiles = [];
  const depsEnvoi = { query: requete, enqueue: async (row) => { enfiles.push(row); return { id: 0 }; } };
  const apercuComposeur = await m.comms.buildDirectEmailPreview({ centerId: 'libramont', subject: 'Votre question', body: 'Bonjour Marie,\n\nOui c est possible.', member: KEVIN }, deps);
  await m.comms.sendDirectEmail({ centerId: 'libramont', to: 'marie@exemple.be', subject: 'Votre question', body: 'Bonjour Marie,\n\nOui c est possible.', attemptId: 'gate-design-apercu', member: KEVIN }, depsEnvoi);
  ok(enfiles.length === 1 && enfiles[0].body === apercuComposeur.html && /Kevin Dupont/.test(enfiles[0].body) && enfiles[0].payload.signature === true,
    '[G] apercu du composeur == HTML enfile par sendDirectEmail (signature du membre comprise)');
  const sansSignature = await m.comms.sendDirectEmail({ centerId: 'libramont', to: 'marie@exemple.be', subject: 'Sans', body: 'Bonjour.', attemptId: 'gate-design-sans', member: KEVIN, signature: false }, depsEnvoi);
  ok(!sig(enfiles[1].body) && enfiles[1].payload.signature === false && sansSignature.communication, '[G] la case « Ajouter la signature » decochee : aucune signature sur cet envoi');
  const apercuDesign = await m.comms.buildDesignPreview({ centerId: 'libramont', design: null, sample: 'confirmation', member: KEVIN }, deps);
  ok(apercuDesign.html === apercuSequence.html && apercuDesign.subject === apercuSequence.subject,
    '[G] apercu « confirmation » du design == apercu de la sequence confirmation (meme builder, meme gabarit)');
  const apercuReponse = await m.comms.buildDesignPreview({ centerId: 'libramont', design: { ...defautsLibramont, preset: 'contraste' }, sample: 'reponse', member: KEVIN }, deps);
  const apercuCampagne = await m.comms.buildDesignPreview({ centerId: 'libramont', design: { ...defautsLibramont, signatureScope: { manual: true, sequences: true, campaigns: true } }, sample: 'campagne', member: KEVIN }, deps);
  ok(/bgcolor="#17151F"/.test(apercuReponse.html) && /Kevin Dupont/.test(apercuReponse.html) && /\/api\/u\?k=apercu/.test(apercuCampagne.html) && sig(apercuCampagne.html) && !/Kevin/.test(apercuCampagne.html),
    '[G] apercu « reponse » : le brouillon (contraste) et la personne ; « campagne » : ligne de retrait inerte, signature d equipe');
  const brouillonInvalide = await (async () => { try { await m.comms.buildDesignPreview({ centerId: 'libramont', design: { preset: 'neon' }, sample: 'reponse' }, deps); return null; } catch (error) { return error; } })();
  ok(brouillonInvalide && brouillonInvalide.expose === true, '[G] un brouillon invalide fait une erreur exposable, pas un apercu trompeur');

  // =====================================================================
  console.log('\n[H] le test part au membre de session');
  // =====================================================================
  const testsEnfiles = [];
  const resultatTest = await m.comms.sendDesignTest(
    { centerId: 'libramont', member: { id: 'libramont:gerante', contact: 'gerante@fungalaxy.be', name: 'Gerante' }, design: { ...defautsLibramont, to: 'attaquant@mauvais.example', recipient: 'attaquant@mauvais.example' }, sample: 'reponse' },
    { deps, enqueue: async (row) => { testsEnfiles.push(row); return { id: 7 }; }, dispatch: async () => ({ results: [{ id: 7, status: 'sent' }] }) },
  );
  ok(testsEnfiles.length === 1 && testsEnfiles[0].recipient === 'gerante@fungalaxy.be' && resultatTest.recipient === 'gerante@fungalaxy.be' && resultatTest.status === 'sent',
    '[H] le test part au contact de la session', JSON.stringify({ recipient: testsEnfiles[0] && testsEnfiles[0].recipient }));
  ok(!JSON.stringify(testsEnfiles[0]).includes('attaquant@mauvais.example') && testsEnfiles[0].templateId === 'test_design' && testsEnfiles[0].payload.test === true,
    '[H] aucune adresse de la requete dans le mail enfile, template test_design');
  const sansContact = await (async () => { try { await m.comms.sendDesignTest({ centerId: 'libramont', member: { contact: '' }, design: null }, { deps }); return null; } catch (error) { return error; } })();
  ok(sansContact && sansContact.expose === true, '[H] un compte sans adresse recoit un refus explicite');
  const testPerso = [];
  const seq = { name: 'Relance J+7', trigger: { type: 'before_visit', days: 3 }, subject: 'À {{date}}, {{prenom}} !', body: 'Bonjour {{prenom}}, rendez-vous le {{date}} à {{heure}} chez {{centre}}.', cap: 5 };
  const apercuPerso = await m.comms.buildCustomSequencePreview({ centerId: 'libramont', sequence: seq, deps });
  await m.comms.sendCustomSequenceTest({ centerId: 'libramont', member: { id: 'x', contact: 'gerante@fungalaxy.be' }, sequence: seq }, { deps, enqueue: async (row) => { testPerso.push(row); return { id: 8 }; }, dispatch: async () => ({ results: [] }) });
  ok(/Bonjour Marie, rendez-vous le \d{4}-\d{2}-\d{2} à 15:00 chez Fun Galaxy Libramont/.test(apercuPerso.html) && /\/api\/u\?k=apercu/.test(apercuPerso.html) && !/\{\{/.test(apercuPerso.html) && sig(apercuPerso.html),
    '[H] apercu d une sequence personnalisee : variables resolues avec un client d exemple, retrait inerte, signature d equipe');
  ok(testPerso.length === 1 && testPerso[0].recipient === 'gerante@fungalaxy.be' && testPerso[0].body === apercuPerso.html && testPerso[0].templateId === 'test_custom',
    '[H] le test de sequence personnalisee part au membre, avec exactement le HTML de l apercu');

  // =====================================================================
  console.log('\n[I] enregistrer le design n ecrase rien d autre');
  // =====================================================================
  reset();
  const enregistre = await m.comms.saveEmailDesign('libramont', { preset: 'carte', accent: { mode: 'centre' }, signature: { closing: 'Bien à vous,' } }, { member: KEVIN }, deps);
  const apres = REGLAGES.get('libramont');
  ok(enregistre.preset === 'carte' && enregistre.signature.closing === 'Bien à vous,' && enregistre.updatedBy === 'Kevin Dupont' && apres.email_design.preset === 'carte',
    '[I] le design est enregistre sous settings.email_design, avec son auteur');
  ok(Array.isArray(apres.custom_sequences) && apres.custom_sequences[0].id === 'cs_gate' && apres.email_brain && apres.email_brain.signature === 'La team FG',
    '[I] custom_sequences et email_brain sont INTACTS apres l ecriture');
  ok(ECRITURES.length === 1 && /jsonb_build_object\('email_design'/.test(ECRITURES[0]) && !/set settings = \$2/.test(ECRITURES[0]), '[I] l ecriture ne porte qu une cle du jsonb, jamais le blob');
  const relu = await m.comms.resolveEmailDesign('libramont', deps);
  ok(relu.preset === 'carte' && relu.signature.closing === 'Bien à vous,' && relu.signature.phone === LIBRAMONT.publicInfo.phone,
    '[I] relu : le design enregistre fusionne sur les defauts du centre (coordonnees du catalogue conservees)');
  let refus = null;
  try { await m.comms.saveEmailDesign('libramont', { accent: { mode: 'perso', hex: 'bleu' } }, { member: KEVIN }, deps); } catch (error) { refus = error; }
  ok(refus && refus.expose === true && ECRITURES.length === 1, '[I] un brouillon invalide n ecrit rien');
  REGLAGES.set('libramont', { ...REGLAGES.get('libramont'), email_design: { preset: 'neon', signature: { logoUrl: 'javascript:x' } } });
  const indulgent = await m.comms.resolveEmailDesign('libramont', deps);
  ok(indulgent.preset === 'simple' && indulgent.signature.logoUrl === defautsLibramont.signature.logoUrl, '[I] un design en base devenu invalide retombe sur les defauts (aucun envoi bloque)');
  const paquet = await m.comms.getEmailDesignBundle('libramont', deps);
  ok(paquet.presets.length === 5 && paquet.logos.length === 2 && paquet.center.id === 'libramont' && paquet.defaults.signature.phone === LIBRAMONT.publicInfo.phone && paquet.stored && paquet.stored.preset === 'neon',
    '[I] le paquet de la page Apparence : gabarits, logos declares, centre, defauts, brut enregistre');
  const paquetNu = await m.comms.getEmailDesignBundle('centre-qui-n-existe-pas', deps);
  ok(paquetNu.logos.length === 0 && paquetNu.center.name === '', '[I] un centre sans logo au catalogue n en propose aucun');
  // L ADRESSE DE REPONSE que la page Expediteurs affiche est celle que les mails
  // donnent vraiment (2026-09-17) : la boite du centre sans reglage de retour,
  // l adresse de reception de Pinlane quand CENTER_REPLY_TO la pose.
  const retourAvant = process.env.CENTER_REPLY_TO;
  delete process.env.CENTER_REPLY_TO;
  const reponseBoite = (await m.comms.getEmailDesignBundle('libramont', deps)).reponse || {};
  process.env.CENTER_REPLY_TO = JSON.stringify({ libramont: 'libramont@inbound.pinlane.be' });
  const reponsePinlane = (await m.comms.getEmailDesignBundle('libramont', deps)).reponse || {};
  if (retourAvant === undefined) delete process.env.CENTER_REPLY_TO; else process.env.CENTER_REPLY_TO = retourAvant;
  ok(Boolean(paquet.center.publicInfo.email) && reponseBoite.adresse === paquet.center.publicInfo.email && reponseBoite.versPinlane === false
    && reponsePinlane.adresse === 'libramont@inbound.pinlane.be' && reponsePinlane.versPinlane === true,
    '[I] le paquet dit l adresse de reponse REELLE : la boite du centre sans reglage, l adresse de reception de Pinlane avec', JSON.stringify({ reponseBoite, reponsePinlane }));

  // =====================================================================
  console.log('\n[J] pas de double signature, pas de double coordonnee');
  // =====================================================================
  reset();
  const sweep = [];
  await m.comms.runBirthdayJ30Sweep('libramont', { query: requete, enqueue: async (row) => { sweep.push(row); return { id: 1 }; } }, { today: iso(0) });
  const anniversaire = sweep[0] || {};
  const equipe = (html) => (String(html).match(/L&#39;équipe Fun Galaxy Libramont/g) || []).length;
  // LA CLOTURE SE LIT DANS LE MESSAGE, elle ne se recopie pas ici. Ce controle
  // affirmait « À très vite, » en dur : le jour ou la formule de politesse a
  // change (regles d ecriture client, 2026-09-18), il a rougi sur un texte
  // parfaitement sain, alors que la regle qu il defend (ne pas signer deux
  // fois) n avait pas bouge. La cloture est desormais DERIVEE du gabarit, et
  // c est son retrait qui est verifie, pas son libelle.
  const modeleAnniv = m.comms.buildBirthdayJ30Message({ name: 'Lucie', partyDateFr: '12 octobre 2025', centerName: 'Fun Galaxy Libramont' });
  const lignesAnniv = String(modeleAnniv.body).split('\n').map((ligne) => ligne.trim()).filter(Boolean);
  const cloture = lignesAnniv[lignesAnniv.length - 2] || '';
  ok(/,$/.test(cloture) && cloture.length <= 60,
    `[J] montage : le gabarit anniversaire finit bien par une cloture textuelle (« ${cloture} »)`);
  ok(sweep.length === 1 && equipe(anniversaire.body) === 1
    && String(anniversaire.payload.textBody).includes(cloture)
    && !String(anniversaire.body).includes(`${cloture}</p>`),
    `[J] anniversaire : UNE seule « L équipe Fun Galaxy Libramont » dans le HTML (la signature), la cloture « ${cloture} » retiree ; l alternative texte reste entiere`);
  ok(/\/api\/u\?k=[0-9a-f]{32}/.test(anniversaire.body) && anniversaire.payload.unsubToken, '[J] contraste : le lien de retrait marketing est toujours la');
  // Le pied de marque n existe que hors Mail simple : ces deux regles se testent sur Classique.
  const dedup = await rendu(m, { design: { ...defautsLibramont, preset: 'classique' }, portee: 'manual' });
  ok((dedup.match(/0491\/30\.16\.67/g) || []).length === 1 && !/Tel\. 0491/.test(dedup) && (dedup.match(/6800 Libramont/g) || []).length === 1,
    '[J] le pied ne repete pas le telephone ni l adresse que la signature porte');
  const sansTelSignature = await rendu(m, { design: { ...defautsLibramont, preset: 'classique', signature: { ...defautsLibramont.signature, phone: '' } }, portee: 'manual' });
  ok(/Tel\. 0491\/30\.16\.67/.test(sansTelSignature), '[J] telephone retire de la signature : le pied le garde (interrupteur de pied allume)');
  const piedCoupe = await rendu(m, { design: { ...defautsLibramont, footer: { adresse: false, telephone: false, email: false, mention: 'TVA BE 0123.456.789' }, signature: { ...defautsLibramont.signature, enabled: false } }, portee: 'manual' });
  ok(!/6800 Libramont/.test(piedCoupe) && !/Tel\./.test(piedCoupe) && /TVA BE 0123\.456\.789/.test(piedCoupe), '[J] interrupteurs de pied coupes et mention libre : le pied obeit');
  const sansDesign = m.comms.emailShell({ title: 'T', body: 'Bonjour\n\nÀ très vite,\nL\'équipe Fun Galaxy Libramont', preheader: 'p', center: LIBRAMONT });
  ok(/À très vite,/.test(sansDesign) && liens(sansDesign) === 0 && images(sansDesign) === 0 && /Tel\. 0491/.test(sansDesign),
    '[J] contraste : sans design, le gabarit historique ne change pas (cloture gardee, pied complet, zero lien)');

  // =====================================================================
  console.log('\n[mutation] contre-epreuves (le gate ROUGIRAIT sans chaque garde)');
  // =====================================================================
  const contreEpreuves = [
    {
      nom: 'le nom d equipe n est plus echappe',
      fichier: 'lib/ops-communications.js',
      de: '    identite.push(`<strong>${escapeHtml(equipe)}</strong>`);',
      vers: '    identite.push(`<strong>${equipe}</strong>`);',
      rejouer: async (mm) => rendu(mm, { design: hostile, portee: 'manual' }),
      rouge: (html) => /<img src=x/.test(html),
    },
    {
      nom: 'la portee de signature n est plus respectee',
      fichier: 'lib/ops-communications.js',
      de: '  return { design, signature: { enabled: scope[portee] === true, person: person || null } };',
      vers: '  return { design, signature: { enabled: true, person: person || null } };',
      rejouer: async (mm) => { const captes = []; await mm.comms.enqueueCampaign({ centerId: 'libramont', campaignId: 9, recipients: [{ email: 'c@exemple.be', name: 'C' }], subject: 's', body: 'b', scheduledAt: iso(1), personalize: (t) => t, deps: { query: requete }, enqueue: async (row) => { captes.push(row); return { id: 1 }; } }); return captes[0].body; },
      rouge: (html) => sig(html),
    },
    {
      nom: 'une sequence signe d une personne',
      fichier: 'lib/ops-communications.js',
      de: "  const habillage = habillageDe(await resolveEmailDesign(centerId, deps), 'sequences');\n\n  let message;",
      vers: "  const habillage = habillageDe(await resolveEmailDesign(centerId, deps), 'sequences', { name: 'Kevin Dupont', role: 'Direction' });\n\n  let message;",
      rejouer: async (mm) => (await mm.comms.buildAutomationPreview('libramont', 'confirmation', {}, deps)).html,
      rouge: (html) => /Kevin Dupont/.test(html),
    },
    {
      nom: 'l enregistrement ecrit le blob entier',
      fichier: 'lib/ops-communications.js',
      de: "       set settings = coalesce(center_automation_settings.settings, '{}'::jsonb) || jsonb_build_object('email_design', $2::jsonb),",
      vers: "       set settings = jsonb_build_object('email_design', $2::jsonb),",
      rejouer: async (mm) => { reset(); await mm.comms.saveEmailDesign('libramont', { preset: 'carte' }, { member: KEVIN }, deps); return REGLAGES.get('libramont'); },
      rouge: (reglages) => !Array.isArray(reglages.custom_sequences) || !reglages.email_brain,
    },
    {
      nom: 'le test du design part a l adresse de la requete',
      fichier: 'lib/ops-communications.js',
      de: "    templateId: 'test_design',\n    recipient,",
      vers: "    templateId: 'test_design',\n    recipient: (design && design.to) || recipient,",
      rejouer: async (mm) => { const captes = []; await mm.comms.sendDesignTest({ centerId: 'libramont', member: { contact: 'gerante@fungalaxy.be' }, design: { ...defautsLibramont, to: 'attaquant@mauvais.example' }, sample: 'reponse' }, { deps, enqueue: async (row) => { captes.push(row); return { id: 1 }; }, dispatch: async () => ({ results: [] }) }); return captes[0].recipient; },
      rouge: (recipient) => recipient !== 'gerante@fungalaxy.be',
    },
    {
      nom: 'une URL de logo hostile est acceptee',
      fichier: 'lib/email-design.js',
      de: "    if (!url) return probleme(`${libelle} : seule une adresse https (ou une image du site) est acceptée.`, repli);",
      vers: '    if (false) return probleme(`${libelle} : seule une adresse https (ou une image du site) est acceptée.`, repli);',
      rejouer: async (mm) => { try { mm.design.validateEmailDesign({ signature: { logoUrl: 'javascript:alert(1)' } }, LIBRAMONT); return 'accepte'; } catch (error) { return 'refuse'; } },
      rouge: (r) => r === 'accepte',
    },
    {
      nom: 'la couleur perso n est plus appliquee',
      fichier: 'lib/email-design.js',
      de: "  if (accent.mode === 'perso' && HEX_RX.test(String(accent.hex || ''))) return String(accent.hex);",
      vers: "  if (accent.mode === 'perso' && HEX_RX.test(String(accent.hex || ''))) return encre;",
      rejouer: async (mm) => rendu(mm, { design: { ...defautsLibramont, preset: 'carte', accent: { mode: 'perso', hex: '#123456' } } }),
      rouge: (html) => !/#123456/.test(html),
    },
    {
      nom: 'l interrupteur maitre de la signature est ignore',
      fichier: 'lib/ops-communications.js',
      de: '  const avecSignature = Boolean(gabarit && signature && signature.enabled && gabarit.signature && gabarit.signature.enabled !== false);',
      vers: '  const avecSignature = Boolean(gabarit && signature && signature.enabled);',
      rejouer: async (mm) => rendu(mm, { design: maitre, portee: 'manual' }),
      rouge: (html) => sig(html),
    },
    {
      nom: 'la cloture textuelle est signee deux fois',
      fichier: 'lib/ops-communications.js',
      de: '  const corps = signatureHtml ? retirerClotureEnDouble(body, center) : body;',
      vers: '  const corps = body;',
      rejouer: async (mm) => { const captes = []; await mm.comms.runBirthdayJ30Sweep('libramont', { query: requete, enqueue: async (row) => { captes.push(row); return { id: 1 }; } }, { today: iso(0) }); return captes[0].body; },
      rouge: (html) => equipe(html) !== 1,
    },
  ];
  for (const c of contreEpreuves) {
    let verdict = false;
    try {
      mutations = [{ fichier: c.fichier, de: c.de, vers: c.vers }];
      const mm = charger();
      verdict = c.rouge(await c.rejouer(mm));
    } catch (erreur) {
      verdict = false;
      console.log(`      (contre-epreuve impossible : ${erreur.message})`);
    } finally {
      mutations = [];
    }
    ok(verdict, `[mutation] « ${c.nom} » (le gate ROUGIRAIT)`);
  }
  m = charger();
  ok(mutations.length === 0, '[mutation] aucune mutation ne survit');

  console.log(failures ? `\n${failures} controle(s) en echec.` : '\nALL OK');
  process.exit(failures ? 1 : 0);
})().catch((erreur) => {
  console.error('FAIL  gate interrompu :', (erreur && erreur.stack) || erreur);
  process.exit(1);
});
