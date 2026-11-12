'use strict';
// LA FIN DES MAILS QUE L ASSISTANT LIT (2026-11-12, Ansar : « elle dit quelle trouve pas ensuite elle dit
// que c bien a vous alors que c funement, cetait a lepoque le bien a vous donc elle est pas a jour »).
// L outil sequences_et_modeles rendait le texte d usine des sequences : celui de la confirmation finit par
// « Bien à vous, » alors que la confirmation part avec son propre gabarit, et la signature du centre
// (« Funement vôtre, », l equipe, les coordonnees) n y etait pas. Ce gate tient, sans base ni reseau :
//   A. la lecture rend la signature du centre et, pour chaque mail automatique, sa fin telle que le client
//      la lit, signature comprise, tirees du meme apercu que l editeur des mails : la confirmation finit
//      par « Funement vôtre, » puis l equipe, l anniversaire par son propre « Bien à vous, », que la
//      signature ne double pas ;
//   B. elle lit le design enregistre du centre, pas le catalogue : une autre formule enregistree se lit ;
//   C. une signature coupee sur les mails automatiques se dit coupee, et la fin n a plus de formule ;
//   D. les consignes du modele portent la voix du centre (jamais une faute) et le refus de decrire ce
//      qu aucune lecture ne montre. Presence seulement : le comportement se juge au vrai modele.
// Lancement : node scripts/assistant-fin-des-mails-check.js [--contre-preuves]
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const OUTILS = 'lib/assistant-outils-centre.js';

const MUTATIONS = [
  { nom: 'texte-d-usine', rouge: '[A] la confirmation se lit telle qu elle part, sans le « Bien à vous » de son texte d usine', editions: [{ fichier: OUTILS, de: 'texte_envoye: parti ? texte(nom, parti.texte) : NON_DISPONIBLE,', vers: 'texte_envoye: texte(nom, r.body || d.body),' }] },
  // (un changement de texte ecrit depuis l exemple enverrait « Marie » et le 20 juin a tous les clients)
  { nom: 'modifier-depuis-l-exemple', rouge: '[A] le texte a modifier garde ses variables, jamais le nom ni la date de l exemple', editions: [{ fichier: OUTILS, de: 'texte_a_modifier: texte(nom, r.body || d.body),', vers: "texte_a_modifier: texte(nom, parti ? parti.texte : '')," }] },
  { nom: 'sans-signature', rouge: '[A] la signature du centre : sa formule, qui signe, sa disposition, ou elle se pose', editions: [{ fichier: OUTILS, de: 'modele: { centre: id, signature: signature || NON_DISPONIBLE, gabarit:', vers: 'modele: { centre: id, gabarit:' }] },
  { nom: 'gabarit-par-son-id', rouge: '[B] le gabarit des mails se lit sous son nom de la galerie', editions: [{ fichier: OUTILS, de: "  return { nom: nom(id), mails_automatiques: nom(auto ? auto.id : id) };", vers: "  return { nom: id, mails_automatiques: auto ? auto.id : id };" }] },
  { nom: 'depart-pris-pour-l-envoi', rouge: '[A] une sequence jamais personnalisee se dit partie avec le texte du logiciel', editions: [{ fichier: OUTILS, de: "part_avec: r.body ? 'le texte du centre' : 'le texte du logiciel',", vers: "part_avec: 'le texte du centre'," }] },
  { nom: 'panne-des-modeles', rouge: '[E] sans les modeles, la signature et les sequences se lisent encore', editions: [{ fichier: OUTILS, de: 'ouRien(() => listEmailTemplates({ centerId: id }))', vers: 'listEmailTemplates({ centerId: id })' }] },
  { nom: 'fin-sans-signature', rouge: '[A] la confirmation finit par « Funement vôtre, » puis l equipe', editions: [{ fichier: OUTILS, de: 'return lignesNonVides(mail.envoye || mail.texte)', vers: 'return lignesNonVides(mail.texte)' }] },
  { nom: 'signature-du-catalogue', rouge: '[B] une autre formule enregistree par le centre se lit, et finit ses mails', editions: [{ fichier: OUTILS, de: 'ouRien(() => OC.resolveEmailDesign(id)), mailsTelsQuIlsPartent', vers: "ouRien(() => require('./email-design').getEmailDesignDefaults(require('./ops-knowledge').getCenter(id))), mailsTelsQuIlsPartent" }] },
  { nom: 'voix-retiree', rouge: '[D] les consignes portent la voix du centre et le refus de reconstruire', editions: [{ fichier: 'lib/assistant-agent.js', de: 'Ne les traitez jamais de faute de frappe ni de formule mal saisie,', vers: 'Corrigez-les si elles semblent fautives,' }] },
];

function purger() {
  Object.keys(require.cache).forEach((cle) => { if (cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`)) delete require.cache[cle]; });
}

function armer(editions) {
  const parFichier = new Map();
  editions.forEach((e) => {
    const cible = path.normalize(path.join(ROOT, e.fichier));
    if (!parFichier.has(cible)) parFichier.set(cible, []);
    parFichier.get(cible).push(e);
  });
  const origine = Module._extensions['.js'];
  Module._extensions['.js'] = function charger(m, f) {
    const liste = parFichier.get(path.normalize(f));
    if (!liste) { origine(m, f); return; }
    let texte = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    liste.forEach((e) => {
      if (texte.split(e.de).length !== 2) throw new Error(`ancre introuvable ou multiple : ${e.de.slice(0, 80)}`);
      texte = texte.split(e.de).join(e.vers);
    });
    m._compile(texte, f);
  };
  return () => { Module._extensions['.js'] = origine; };
}

const DIRECTION = { permissions: ['emails.view', 'campaigns.manage', 'settings.manage', 'clients.view', 'pricing.manage', 'reservations.view'], role: { locked: true, name: 'Direction' }, authorizedCenterId: 'libramont', centerId: 'libramont', member: { id: 'm-dir', name: 'Seb' } };

async function verifier(editions = []) {
  const echecs = [];
  const ok = (cond, nom, detail = '') => {
    if (!cond) echecs.push(nom);
    if (!editions.length) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${nom}${cond || !detail ? '' : `  ${String(detail).slice(0, 400)}`}`);
  };
  purger();
  const restaurer = armer(editions);
  try {
    process.env.PINLANE_CALENDAR_SYNC = 'off';
    // La base du banc : les reglages des mails d un centre, rien d autre.
    const reglages = new Map();
    const db = require(path.join(ROOT, 'lib/database.js'));
    const interroger = async (sql, params = []) => {
      if (/from center_automation_settings/.test(String(sql))) {
        const s = reglages.get(String(params[0]));
        return { rows: s ? [{ settings: s }] : [], rowCount: s ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    };
    db.getPool = () => ({ query: interroger, connect: async () => ({ query: interroger, release() {} }) });
    db.listEmailTemplates = async () => [];
    const OC = require(path.join(ROOT, 'lib/ops-communications.js'));
    const outils = require(path.join(ROOT, 'lib/assistant-outils.js'));
    const lire = async () => {
      OC.__test.invaliderCacheDesign();
      const ctx = outils.creerContexte({ req: {}, session: DIRECTION, centres: [{ id: 'libramont', name: 'Fun Galaxy Libramont' }], aujourdhui: '2026-11-12', messagesPersonne: ['la signature met Funement vôtre, ça se suit bien ?'] });
      ctx.portes.set('libramont', DIRECTION);
      const r = await outils.executer(ctx, 'sequences_et_modeles', { centre: 'libramont' });
      const texte = typeof r.contenu === 'string' ? r.contenu : JSON.stringify(r.contenu || {});
      return JSON.parse(texte.slice(texte.indexOf('{')));
    };
    const seq = (m, nom) => (m.sequences_automatiques || []).find((s) => s.nom === nom) || {};
    const finit = (s, attendu) => Array.isArray(s.fin_lue_par_le_client) && JSON.stringify(s.fin_lue_par_le_client.slice(-attendu.length)) === JSON.stringify(attendu);

    if (!editions.length) console.log('\n[A] la signature et la fin des mails, tels qu ils partent');
    const usine = await lire();
    const sig = usine.signature || {};
    ok(sig.formule === 'Funement vôtre,' && sig.qui_signe === 'L\'équipe Fun Galaxy Libramont' && sig.disposition === 'Affiche' && sig.posee_sur && sig.posee_sur.mails_automatiques === 'oui',
      '[A] la signature du centre : sa formule, qui signe, sa disposition, ou elle se pose', JSON.stringify(sig));
    const confirmation = seq(usine, 'Confirmation de réservation');
    ok(confirmation.signee === 'oui' && /Fun Galaxy Libramont/.test(String(confirmation.texte_envoye || '')) && !/Bien à vous/.test(String(confirmation.texte_envoye || '')) && !/Bien à vous/.test(JSON.stringify(confirmation.fin_lue_par_le_client || [])),
      '[A] la confirmation se lit telle qu elle part, sans le « Bien à vous » de son texte d usine', JSON.stringify({ texte: String(confirmation.texte_envoye || '').slice(-120), fin: confirmation.fin_lue_par_le_client }));
    const aModifier = (usine.sequences_automatiques || []).map((s) => String(s.texte_a_modifier || ''));
    ok(aModifier.length === 6 && aModifier.every((t) => /\{\{[a-z_]+\}\}/.test(t) && !/Marie|20 juin/.test(t)) && /exemple/.test(String(usine.exemple || '')),
      '[A] le texte a modifier garde ses variables, jamais le nom ni la date de l exemple', JSON.stringify(aModifier.map((t) => t.slice(0, 60))));
    // (le texte de depart de l editeur n est pas ce que lit le client ; depuis le 12/11 il finit
    // comme lui, sans « Bien à vous, » qui faisait tomber la signature : email-signature-check [O])
    ok(confirmation.part_avec === 'le texte du logiciel' && !/Bien à vous/.test(String(confirmation.texte_a_modifier || '')) &&/texte de départ de l’éditeur/.test(String(usine.exemple || '')),
      '[A] une sequence jamais personnalisee se dit partie avec le texte du logiciel', JSON.stringify({ part_avec: confirmation.part_avec, exemple: String(usine.exemple || '').slice(-200) }));
    ok(finit(confirmation, ['Funement vôtre,', 'L\'équipe Fun Galaxy Libramont']),
      '[A] la confirmation finit par « Funement vôtre, » puis l equipe', JSON.stringify(confirmation.fin_lue_par_le_client));
    const anniversaire = seq(usine, '30 jours avant l’anniversaire');
    ok(finit(anniversaire, ['Bien à vous,', 'L\'équipe Fun Galaxy Libramont']) && !JSON.stringify(anniversaire.fin_lue_par_le_client).includes('Funement'),
      '[A] l anniversaire finit par son propre « Bien à vous, », que la signature ne double pas', JSON.stringify(anniversaire.fin_lue_par_le_client));

    if (!editions.length) console.log('\n[B] le design enregistre du centre');
    reglages.set('libramont', { email_design: { signature: { closing: 'On vous garde une piste !' } } });
    const autre = await lire();
    ok((autre.signature || {}).formule === 'On vous garde une piste !' && finit(seq(autre, 'Confirmation de réservation'), ['On vous garde une piste !', 'L\'équipe Fun Galaxy Libramont']),
      '[B] une autre formule enregistree par le centre se lit, et finit ses mails', JSON.stringify({ formule: (autre.signature || {}).formule, fin: seq(autre, 'Confirmation de réservation').fin_lue_par_le_client }));

    // (« Grand jour » et pas « Affiche » : la galerie d Apparence, 2026-11-12 ; un grand format de campagne
    // laisse aux mails automatiques le repli de la boite principale)
    reglages.set('libramont', { email_design: { preset: 'affiche' } });
    const grandJour = await lire();
    reglages.set('libramont', { email_design: { preset: 'vitrine' } });
    const vitrine = await lire();
    ok((usine.gabarit || {}).nom === 'Mail simple' && (grandJour.gabarit || {}).nom === 'Grand jour' && (vitrine.gabarit || {}).nom === 'Vitrine' && (vitrine.gabarit || {}).mails_automatiques !== 'Vitrine' && Boolean((vitrine.gabarit || {}).mails_automatiques),
      '[B] le gabarit des mails se lit sous son nom de la galerie', JSON.stringify({ usine: usine.gabarit, grandJour: grandJour.gabarit, vitrine: vitrine.gabarit }));

    if (!editions.length) console.log('\n[C] une signature coupee sur les mails automatiques');
    reglages.set('libramont', { email_design: { signatureScope: { manual: true, sequences: false, campaigns: false } } });
    const coupee = await lire();
    const sansSig = seq(coupee, 'Confirmation de réservation');
    ok((coupee.signature || {}).posee_sur && coupee.signature.posee_sur.mails_automatiques === 'non' && sansSig.signee === 'non' && !JSON.stringify(sansSig.fin_lue_par_le_client || []).includes('Funement'),
      '[C] la signature coupee se dit coupee, et la fin n a plus sa formule', JSON.stringify({ posee: (coupee.signature || {}).posee_sur, signee: sansSig.signee, fin: sansSig.fin_lue_par_le_client }));
    reglages.clear();

    if (!editions.length) console.log('\n[E] une lecture des modeles qui echoue');
    // (le banc de l assistant n a pas de base : les modeles y echouaient, et toute la lecture tombait avec eux)
    const modelesDUsine = db.listEmailTemplates;
    db.listEmailTemplates = async () => { throw new Error('base injoignable'); };
    const enPanne = await lire().finally(() => { db.listEmailTemplates = modelesDUsine; });
    ok(!enPanne.erreur && (enPanne.signature || {}).formule === 'Funement vôtre,' && finit(seq(enPanne, 'Confirmation de réservation'), ['Funement vôtre,', 'L\'équipe Fun Galaxy Libramont']) && enPanne.modeles === 'non disponible',
      '[E] sans les modeles, la signature et les sequences se lisent encore', JSON.stringify(enPanne).slice(0, 300));

    if (!editions.length) console.log('\n[D] les consignes du modele');
    // (les consignes que le modele recoit : SYSTEME, celui du module charge, mute ou non)
    const lu = String(require(path.join(ROOT, 'lib/assistant-agent.js')).SYSTEME || '');
    ok(/<voix_du_centre>[\s\S]*Ne les traitez jamais de faute de frappe ni de formule mal saisie[\s\S]*fin_lue_par_le_client[\s\S]*<\/voix_du_centre>/.test(lu) && /Ne reconstruisez jamais une chose à partir d'une autre qui lui ressemble\./.test(lu),
      '[D] les consignes portent la voix du centre et le refus de reconstruire');
  } finally {
    restaurer();
    purger();
  }
  return echecs;
}

(async () => {
  if (process.argv.includes('--contre-preuves')) {
    let mordent = 0;
    for (const m of MUTATIONS) {
      // eslint-disable-next-line no-await-in-loop
      const echecs = await verifier(m.editions).catch((e) => [`exception ${e.message}`]);
      const mord = echecs.includes(m.rouge);
      if (mord) mordent += 1;
      console.log(`${mord ? 'ok  ' : 'FAIL'}  contre-preuve ${m.nom} : rougit « ${m.rouge} »${mord ? '' : `  (rouges : ${echecs.join(' | ') || 'aucun'})`}`);
    }
    console.log(`\nassistant-fin-des-mails --contre-preuves: ${mordent}/${MUTATIONS.length} mordent`);
    process.exit(mordent === MUTATIONS.length ? 0 : 1);
  }
  const echecs = await verifier([]);
  if (echecs.length) { console.error(`\nassistant-fin-des-mails-check: ${echecs.length} FAIL`); process.exit(1); }
  console.log('\nassistant-fin-des-mails-check: ALL OK (la signature et la fin des mails telles qu elles partent, le design enregistre, la signature coupee, la voix du centre)');
})().catch((e) => { console.error('ERREUR', e && e.stack ? e.stack.slice(0, 1200) : e); process.exit(1); });
