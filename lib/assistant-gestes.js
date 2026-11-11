'use strict';
// TOUT FAIRE DANS LE LOGICIEL (Ansar, 2026-11-11 : « il doit vraiment être capable de TOUT FAIRE :
// modifier les mails, en créer, des séquences, modifier les prix des formules, absolument tout »).
//
// Chaque geste de la console que l assistant sait preparer : ce qu il fait, avec quel droit, s il est
// risque, ce qui atteint les clients, et ce que sa carte montre (avant, apres). Rien ne s ecrit ici :
//  - proposer() lit l etat du centre, valide comme le logiciel, et rend la carte ;
//  - refaire() rejoue tout au clic (api/ops.js, action assistantGeste) : la lecture d a present, les
//    droits de la session, la meme validation ; puis l ACTION NORMALE du logiciel ecrit, comme si la
//    personne avait clique dans sa page (memes regles serveur, meme journal d audit).
//
// Un geste risque (il change ce que voient les clients, il supprime, il envoie) ne nait que d une
// demande que la personne a ecrite elle-meme dans ses deux derniers messages : un mail de client qui
// dit « baissez vos prix » n en fait jamais naitre un. Sa carte redemande de confirmer.
//
// Jamais ici : l equipe, les roles, les codes d acces, la plateforme. Aucun geste ne les nomme.

const erreur = (message, statut = 422) => Object.assign(new Error(message), { statusCode: statut, expose: true });
const sans = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const coupe = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const euros = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'aucun';
  return Number.isInteger(v) ? `${v} €` : `${v.toFixed(2).replace('.', ',')} €`;
};
const rempli = (v) => v !== undefined && v !== null && String(v).trim() !== '';
// Un instant dit comme a Bruxelles, avec ses accents : « dimanche 20 décembre à 10 h ».
const ditABruxelles = (relu) => (relu ? `${new Date(`${relu.date}T12:00:00Z`).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })} à ${relu.heureDite}` : '');

// Un nombre, ou rien : « beaucoup » ne devient jamais 0 € (vu au gate le 2026-11-11, un mot vide de
// ses lettres tombait a zero et passait les bornes).
function nombre(valeur, { min, max, quoi, entier = false }) {
  const brut = typeof valeur === 'string' ? valeur.replace(/\s/g, '').replace(/€|euros?$/i, '').replace(',', '.') : valeur;
  if (brut === '' || brut === null || brut === undefined || typeof brut === 'boolean' || (typeof brut === 'string' && !/^-?\d+(\.\d+)?$/.test(brut))) throw erreur(`${quoi} doit être un nombre.`);
  const v = Number(brut);
  if (!Number.isFinite(v)) throw erreur(`${quoi} doit être un nombre.`);
  if (entier && !Number.isInteger(v)) throw erreur(`${quoi} doit être un nombre entier.`);
  if (v < min || v > max) throw erreur(`${quoi} doit être entre ${min} et ${max}.`);
  return Math.round(v * 100) / 100;
}

function booleen(valeur, quoi) {
  if (valeur === true || valeur === false) return valeur;
  const t = sans(valeur);
  if (['oui', 'true', 'vrai', 'on', 'active', 'allume', '1'].includes(t)) return true;
  if (['non', 'false', 'faux', 'off', 'coupe', 'desactive', 'eteint', '0'].includes(t)) return false;
  throw erreur(`Dites oui ou non pour ${quoi}.`);
}

// Retrouve un objet par son identifiant, son nom exact, puis un nom qui le contient. Plusieurs ou
// aucun : le refus nomme ce qui existe, l assistant se corrige au tour suivant.
function trouver(liste, saisie, { quoi, nom = (x) => x.name, id = (x) => x.id }) {
  const cle = sans(saisie);
  const choix = (l) => l.slice(0, 12).map((x) => `« ${nom(x)} » (${id(x)})`).join(', ');
  if (!cle) throw erreur(`Dites ${quoi}.${liste.length ? ` Dans ce centre : ${choix(liste)}.` : ''}`);
  const parId = liste.find((x) => sans(id(x)) === cle);
  if (parId) return parId;
  const exacts = liste.filter((x) => sans(nom(x)) === cle);
  if (exacts.length === 1) return exacts[0];
  const proches = liste.filter((x) => { const n = sans(nom(x)); return n && (n.includes(cle) || cle.includes(n)); });
  if (proches.length === 1) return proches[0];
  if (proches.length > 1) throw erreur(`Plusieurs correspondent à « ${coupe(saisie, 60)} » : ${choix(proches)}. Donnez son identifiant.`);
  throw erreur(`Rien ne s’appelle « ${coupe(saisie, 60)} ».${liste.length ? ` Dans ce centre : ${choix(liste)}.` : ' Ce centre n’en a aucun.'}`);
}

// ── Ce que les gestes lisent (injectable : le gate y pose les siens, rien ne part en base) ────────
const LECTEURS = {
  async catalogue(centre) {
    const { getPool } = require('./database');
    const { buildClientCatalog } = require('./catalog-overrides');
    try { await require('./catalog-store').refreshCatalog(getPool()); } catch (e) { /* socle fichier */ }
    try { await require('./center-config').refreshCenterOverrides(getPool()); } catch (e) { /* socle fichier */ }
    const c = await buildClientCatalog(getPool(), centre);
    return (c && Array.isArray(c.formulas) ? c.formulas : []).filter((f) => !(f.effective && f.effective.removed));
  },
  async sequencesAuto(centre) {
    const OC = require('./ops-communications');
    return { reglages: await OC.getAutomationSettings(centre), defauts: OC.getAutomationDefaults() };
  },
  async sequencesPerso(centre) {
    return require('./ops-communications').listCustomSequences(centre);
  },
  async modeles(centre) {
    return require('./database').listEmailTemplates({ centerId: centre });
  },
  async campagnes(centre) {
    return require('./database').listCampaigns({ centerId: centre, limit: 50 });
  },
  async audience(centre, segment) {
    const { readAdminRangeState } = require('./database');
    const { buildCampaignAudience } = require('./campaigns');
    const today = new Date().toISOString().slice(0, 10);
    const history = (await readAdminRangeState('2023-01-01', today, centre)).reservations;
    return buildCampaignAudience({ history, segment, today }).length;
  },
};

// ── Les mots du logiciel (assets/staff-pages-v2.js, MAIL_INVENTORY) ─────────────────────────────
const SEQUENCES_AUTO = {
  request_received: 'Accusé de réception',
  confirmation: 'Confirmation de réservation',
  reminder_48h: 'Rappel avant la venue',
  post_visit: 'Merci post-visite',
  birthday_j30: '30 jours avant l’anniversaire',
  reactivation: 'Réactiver les clients dormants',
};
const CATEGORIES_MODELE = { marketing: 'Marketing', promotion: 'Promotion', information: 'Information', serieux: 'Sérieux', relance: 'Relance' };

function sequenceAuto(saisie) {
  const liste = Object.entries(SEQUENCES_AUTO).map(([id, name]) => ({ id, name }));
  return trouver(liste, saisie, { quoi: 'la séquence automatique' });
}

function nomFormule(f) { return (f.effective && f.effective.name) || f.name || f.id; }
function unitePrix(f) { return f.priceType === 'per_lane' ? 'Prix par piste' : 'Prix par personne'; }
function formuleDuCentre(formules, saisie) { return trouver(formules, saisie, { quoi: 'la formule', nom: nomFormule }); }

function textePlusCourt(t) { return coupe(t, 220) || 'vide'; }

function quandSequence(trigger = {}, limites = {}) {
  const t = (limites.triggers || {})[trigger.type] || {};
  const jours = Number(trigger.days);
  const semaine = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  if (trigger.type === 'after_visit') return `${jours} jour${jours > 1 ? 's' : ''} après une visite`;
  if (trigger.type === 'before_visit') return `${jours} jour${jours > 1 ? 's' : ''} avant une venue prévue`;
  if (trigger.type === 'inactive') return `après ${jours} jours sans venir`;
  if (trigger.type === 'weekly') return `chaque ${semaine[Number(trigger.weekday)] || 'semaine'}`;
  if (trigger.type === 'monthly') return `chaque mois, le ${Number(trigger.monthday) || 1}`;
  return t.label || String(trigger.type || '');
}

function declencheurDe(p, actuel = {}) {
  const type = rempli(p.declencheur) ? String(p.declencheur).trim() : actuel.type;
  const trigger = { type };
  const jours = rempli(p.jours) ? p.jours : actuel.days;
  const semaine = rempli(p.jour_semaine) ? p.jour_semaine : actuel.weekday;
  const mois = rempli(p.jour_mois) ? p.jour_mois : actuel.monthday;
  if (jours !== undefined) trigger.days = Number(jours);
  if (semaine !== undefined) trigger.weekday = Number(semaine);
  if (mois !== undefined) trigger.monthday = Number(mois);
  return trigger;
}

// ── Les gestes ──────────────────────────────────────────────────────────────────────────────────
// Chaque geste : action (l action d api/ops.js qui ecrit), permission (le droit que la page Equipe
// donne pour le faire soi-meme), risque (bool ou fonction), demande (les mots que la personne a dits
// pour un geste risque), parametres (ce que l assistant donne), preparer (lit, valide, rend la carte
// et le corps exact de l action).
const DEMANDE_PRIX = /prix|tarif|€|euro|co[uû]t|cher|augment|baiss|promo|r[ée]duc|remise|barr/i;
const DEMANDE_MAIL = /mail|message|texte|s[ée]quence|rappel|confirmation|relance|objet|merci|anniversaire|accus|r[ée]activ|dormant|envoi/i;
const DEMANDE_MARCHE = /activ|allum|coup|arr[eê]t|stop|lanc|met|remet|ouvr|ferm|d[ée]marr|suspend|pause/i;
const DEMANDE_SUPPRIMER = /supprim|efface|retir|enl[eè]v|archiv|vire|jette|plus besoin/i;
const DEMANDE_ENVOI = /envo|lanc|programm|part|exp[ée]di|campagne/i;

const GESTES = {
  // ── Prix et formules ──
  prix_formule: {
    domaine: 'Prix', titre: 'Prix d’une formule', verbe: 'Publier le nouveau prix', cours: 'Publication…', confirmer: 'Oui, publier ce prix',
    quoi: 'change le prix d’une formule de ce centre, et son prix barré si on le donne',
    parametres: { formule: 'son nom, lu dans catalogue_et_tarifs', prix: 'le nouveau prix en euros', ancien_prix: 'facultatif : le prix barré à afficher à côté, 0 pour l’enlever' },
    action: 'saveClientFormuleOverride', permission: 'pricing.manage', risque: true, demande: DEMANDE_PRIX,
    async preparer(p, ctx) {
      const f = formuleDuCentre(await ctx.lire('catalogue'), p.formule);
      const prix = nombre(p.prix, { min: 0, max: 1000, quoi: 'Le prix' });
      const patch = { priceValue: prix };
      const lignes = [{ libelle: 'Formule', valeur: nomFormule(f) }, { libelle: unitePrix(f), avant: euros(f.effective.priceValue), apres: euros(prix) }];
      if (rempli(p.ancien_prix)) {
        patch.priceOld = nombre(p.ancien_prix, { min: 0, max: 1000, quoi: 'Le prix barré' });
        lignes.push({ libelle: 'Prix barré', avant: f.effective.priceOld ? euros(f.effective.priceOld) : 'aucun', apres: patch.priceOld ? euros(patch.priceOld) : 'aucun' });
      }
      if (prix === Number(f.effective.priceValue) && patch.priceOld === undefined) throw erreur(`${nomFormule(f)} est déjà à ${euros(prix)}.`);
      return {
        corps: { formuleId: f.id, patch },
        texte: `Passer « ${nomFormule(f)} » à ${euros(prix)}${f.priceType === 'per_lane' ? ' par piste' : ' par personne'}.`,
        lignes,
        clients: 'Le nouveau prix se voit tout de suite sur le formulaire en ligne. Les réservations déjà prises gardent leur prix.',
        fait: `« ${nomFormule(f)} » est maintenant à ${euros(prix)}.`,
      };
    },
  },
  formule_en_vente: {
    domaine: 'Prix', titre: 'Formule en vente', verbe: 'Appliquer', cours: 'Enregistrement…', confirmer: 'Oui, appliquer',
    quoi: 'met une formule en vente sur le formulaire en ligne, ou l’en retire',
    parametres: { formule: 'son nom, lu dans catalogue_et_tarifs', en_vente: 'oui pour la proposer aux clients, non pour la retirer' },
    action: 'saveClientFormuleOverride', permission: 'pricing.manage', risque: true, demande: /vente|vend|retir|masqu|cach|d[ée]sactiv|r[ée]activ|remet|propos|formulaire|plus|enl[eè]v/i,
    async preparer(p, ctx) {
      const f = formuleDuCentre(await ctx.lire('catalogue'), p.formule);
      const enVente = booleen(p.en_vente, 'la mise en vente');
      const avant = f.effective.enabled !== false;
      if (avant === enVente) throw erreur(`« ${nomFormule(f)} » est déjà ${enVente ? 'en vente' : 'retirée de la vente'}.`);
      return {
        corps: { formuleId: f.id, patch: { enabled: enVente } },
        texte: `${enVente ? 'Remettre en vente' : 'Retirer de la vente'} « ${nomFormule(f)} ».`,
        lignes: [{ libelle: 'Formule', valeur: nomFormule(f) }, { libelle: 'Sur le formulaire', avant: avant ? 'en vente' : 'retirée', apres: enVente ? 'en vente' : 'retirée' }],
        clients: enVente ? 'Les clients la voient tout de suite sur le formulaire en ligne.' : 'Elle disparaît tout de suite du formulaire en ligne. Les réservations déjà prises ne bougent pas.',
        fait: `« ${nomFormule(f)} » est ${enVente ? 'en vente' : 'retirée de la vente'}.`,
      };
    },
  },
  renommer_formule: {
    domaine: 'Prix', titre: 'Nom d’une formule', verbe: 'Renommer', cours: 'Enregistrement…', confirmer: 'Oui, renommer',
    quoi: 'change le nom d’une formule tel que les clients le lisent',
    parametres: { formule: 'son nom actuel, lu dans catalogue_et_tarifs', nom: 'le nouveau nom, 80 caractères au plus' },
    action: 'saveClientFormuleOverride', permission: 'pricing.manage', risque: true, demande: /nom|renomm|appel|intitul|titre/i,
    async preparer(p, ctx) {
      const f = formuleDuCentre(await ctx.lire('catalogue'), p.formule);
      const nom = String(p.nom || '').replace(/\s+/g, ' ').trim();
      if (!nom || nom.length > 80) throw erreur('Donnez un nouveau nom de 1 à 80 caractères.');
      if (sans(nom) === sans(nomFormule(f))) throw erreur('C’est déjà son nom.');
      return {
        corps: { formuleId: f.id, patch: { name: nom } },
        texte: `Renommer « ${nomFormule(f)} » en « ${nom} ».`,
        lignes: [{ libelle: 'Nom', avant: nomFormule(f), apres: nom }],
        clients: 'Le nouveau nom se voit tout de suite sur le formulaire en ligne.',
        fait: `La formule s’appelle maintenant « ${nom} ».`,
      };
    },
  },
  retablir_formule: {
    domaine: 'Prix', titre: 'Formule rétablie', verbe: 'Rétablir', cours: 'Rétablissement…', confirmer: 'Oui, rétablir',
    quoi: 'efface ce que ce centre a changé sur une formule (prix, nom, mise en vente) : elle redevient celle du catalogue',
    parametres: { formule: 'son nom, lu dans catalogue_et_tarifs' },
    action: 'resetClientFormuleOverride', permission: 'pricing.manage', risque: true, demande: /r[ée]tabl|d[ée]faut|origin|annul|revenir|remet/i,
    async preparer(p, ctx) {
      const f = formuleDuCentre(await ctx.lire('catalogue'), p.formule);
      if (!f.centerOverride) throw erreur(`« ${nomFormule(f)} » n’a rien de changé dans ce centre : elle est déjà celle du catalogue.`);
      const lignes = [{ libelle: 'Formule', valeur: nomFormule(f) }];
      if (f.centerOverride.priceValue != null) lignes.push({ libelle: unitePrix(f), avant: euros(f.effective.priceValue), apres: euros(f.base && f.base.priceValue) });
      if (f.centerOverride.name != null) lignes.push({ libelle: 'Nom', avant: nomFormule(f), apres: f.name });
      if (f.centerOverride.enabled != null) lignes.push({ libelle: 'Sur le formulaire', avant: f.effective.enabled === false ? 'retirée' : 'en vente', apres: 'en vente' });
      return {
        corps: { formuleId: f.id },
        texte: `Rétablir « ${nomFormule(f)} » comme dans le catalogue.`,
        lignes,
        clients: 'Le formulaire en ligne montre tout de suite la formule rétablie.',
        fait: `« ${f.name || nomFormule(f)} » est rétablie.`,
      };
    },
  },

  // ── Séquences automatiques (Emails & relances › Séquences) ──
  sequence_auto_texte: {
    domaine: 'Mails', titre: 'Texte d’une séquence automatique', verbe: 'Enregistrer le texte', cours: 'Enregistrement…', confirmer: 'Oui, enregistrer',
    quoi: 'change l’objet, le texte, le moment ou le plafond d’un mail automatique (accusé de réception, confirmation, rappel, merci, anniversaire, réactivation)',
    parametres: { sequence: 'son nom, par exemple « Rappel avant la venue »', objet: 'facultatif, le nouvel objet', texte: 'facultatif, le nouveau texte entier, avec les variables {{…}} permises', jours: 'facultatif, le nombre de jours du moment d’envoi', plafond: 'facultatif, réactivation seulement : le nombre d’envois par passage' },
    action: 'automationSettings', permission: ['settings.manage', 'emails.send'], risque: true, demande: DEMANDE_MAIL,
    async preparer(p, ctx) {
      const s = sequenceAuto(p.sequence);
      const { reglages, defauts } = await ctx.lire('sequencesAuto');
      const actuel = { ...(defauts[s.id] || {}), ...(reglages[s.id] || {}) };
      const def = defauts[s.id] || {};
      const corps = { key: s.id };
      const lignes = [{ libelle: 'Séquence', valeur: s.name }];
      if (rempli(p.objet) || rempli(p.texte)) {
        const { validateAutomationDraft } = require('./ops-communications');
        const valide = validateAutomationDraft(s.id, { subject: p.objet, body: p.texte });
        if (rempli(p.objet)) { corps.subject = valide.subject; lignes.push({ libelle: 'Objet', avant: coupe(actuel.subject, 140) || 'celui du logiciel', apres: valide.subject }); }
        if (rempli(p.texte)) { corps.body = valide.body; lignes.push({ libelle: 'Texte', avant: textePlusCourt(actuel.body), apres: textePlusCourt(valide.body), long: valide.body }); }
      }
      if (rempli(p.jours)) {
        const [min, max] = Array.isArray(def.offsetRange) ? def.offsetRange : [0, 60];
        corps.offsetDays = nombre(p.jours, { min, max, quoi: 'Le nombre de jours', entier: true });
        lignes.push({ libelle: 'Jours', avant: String(actuel.offsetDays ?? 'aucun'), apres: String(corps.offsetDays) });
      }
      if (rempli(p.plafond)) {
        if (!Array.isArray(def.capRange)) throw erreur(`« ${s.name} » n’a pas de plafond d’envois.`);
        corps.cap = nombre(p.plafond, { min: def.capRange[0], max: def.capRange[1], quoi: 'Le plafond', entier: true });
        lignes.push({ libelle: 'Envois par passage', avant: String(actuel.cap ?? 'aucun'), apres: String(corps.cap) });
      }
      if (lignes.length === 1) throw erreur('Dites ce qui change : objet, texte, jours ou plafond.');
      return {
        corps,
        texte: `Changer « ${s.name} ».`,
        lignes,
        clients: 'Les prochains mails de cette séquence partiront avec ce texte. Ceux déjà partis ne changent pas.',
        fait: `« ${s.name} » est enregistrée.`,
      };
    },
  },
  sequence_auto_marche: {
    domaine: 'Mails', titre: 'Séquence automatique allumée ou coupée', verbe: 'Appliquer', cours: 'Enregistrement…', confirmer: 'Oui, appliquer',
    quoi: 'allume ou coupe un mail automatique',
    parametres: { sequence: 'son nom, par exemple « Réactiver les clients dormants »', active: 'oui pour l’allumer, non pour la couper' },
    action: 'automationSettings', permission: ['settings.manage', 'emails.send'], risque: true, demande: DEMANDE_MARCHE,
    async preparer(p, ctx) {
      const s = sequenceAuto(p.sequence);
      const active = booleen(p.active, 'la séquence');
      const { reglages, defauts } = await ctx.lire('sequencesAuto');
      const avant = (reglages[s.id] && typeof reglages[s.id].enabled === 'boolean') ? reglages[s.id].enabled : Boolean(defauts[s.id] && defauts[s.id].enabled);
      if (avant === active) throw erreur(`« ${s.name} » est déjà ${active ? 'allumée' : 'coupée'}.`);
      return {
        corps: { key: s.id, enabled: active },
        texte: `${active ? 'Allumer' : 'Couper'} « ${s.name} ».`,
        lignes: [{ libelle: 'Séquence', valeur: s.name }, { libelle: 'État', avant: avant ? 'allumée' : 'coupée', apres: active ? 'allumée' : 'coupée' }],
        clients: active ? 'Les mails de cette séquence repartent vers les clients dès le prochain passage.' : 'Plus aucun mail de cette séquence ne part vers les clients.',
        fait: `« ${s.name} » est ${active ? 'allumée' : 'coupée'}.`,
      };
    },
  },
  sequence_auto_reinitialiser: {
    domaine: 'Mails', titre: 'Séquence automatique remise par défaut', verbe: 'Remettre le texte du logiciel', cours: 'Remise…', confirmer: 'Oui, remettre par défaut',
    quoi: 'efface le texte personnalisé d’un mail automatique et remet celui du logiciel (l’état allumé ou coupé ne bouge pas)',
    parametres: { sequence: 'son nom' },
    action: 'automationSettings', permission: ['settings.manage', 'emails.send'], risque: true, demande: /r[ée]initialis|d[ée]faut|origin|logiciel|remet|revenir/i,
    async preparer(p, ctx) {
      const s = sequenceAuto(p.sequence);
      const { reglages, defauts } = await ctx.lire('sequencesAuto');
      const actuel = reglages[s.id] || {};
      const def = defauts[s.id] || {};
      return {
        corps: { key: s.id, reset: true },
        texte: `Remettre « ${s.name} » comme le logiciel l’écrit.`,
        lignes: [{ libelle: 'Séquence', valeur: s.name }, { libelle: 'Objet', avant: coupe(actuel.subject, 140) || 'celui du logiciel', apres: coupe(def.subject, 140) || 'celui du logiciel' }, { libelle: 'Texte', avant: textePlusCourt(actuel.body || def.body), apres: textePlusCourt(def.body) }],
        clients: 'Les prochains mails de cette séquence repartent avec le texte du logiciel.',
        fait: `« ${s.name} » a retrouvé le texte du logiciel.`,
      };
    },
  },

  // ── Séquences créées par le centre ──
  sequence_creer: {
    domaine: 'Mails', titre: 'Nouvelle séquence de mails', verbe: 'Créer la séquence (coupée)', cours: 'Création…',
    quoi: 'crée une séquence de relance : elle naît COUPÉE, rien ne part avant qu’on l’allume avec sequence_marche',
    parametres: { nom: 'son nom, 60 caractères au plus', declencheur: 'after_visit (X jours après une visite), before_visit (X jours avant une venue), inactive (après X jours sans venir), weekly (chaque semaine) ou monthly (chaque mois)', jours: 'pour after_visit (1 à 90), before_visit (1 à 60) ou inactive (30 à 365)', jour_semaine: 'pour weekly : 0 dimanche à 6 samedi', jour_mois: 'pour monthly : 1 à 28', segment: 'pour weekly et monthly : all, dormant, loyal ou birthdays', objet: 'l’objet', texte: 'le texte entier, avec {{prenom}} et {{centre}}', plafond: 'facultatif, envois par passage (1 à 100, 20 par défaut)' },
    action: 'customSequences', permission: ['settings.manage', 'emails.send'], risque: false,
    async preparer(p, ctx) {
      const { validateCustomSequence, CUSTOM_SEQUENCE_LIMITS } = require('./ops-communications');
      const existantes = await ctx.lire('sequencesPerso');
      if (existantes.length >= CUSTOM_SEQUENCE_LIMITS.maxSequences) throw erreur(`Ce centre a déjà ${CUSTOM_SEQUENCE_LIMITS.maxSequences} séquences, le maximum : supprimez-en une d’abord.`);
      const sequence = validateCustomSequence({ name: p.nom, trigger: declencheurDe(p), segment: p.segment, subject: p.objet, body: p.texte, cap: rempli(p.plafond) ? Number(p.plafond) : undefined, enabled: false });
      return {
        corps: { sequence: { ...sequence, enabled: false } },
        texte: `Créer la séquence « ${sequence.name} », coupée.`,
        lignes: [{ libelle: 'Nom', valeur: sequence.name }, { libelle: 'Quand', valeur: quandSequence(sequence.trigger, CUSTOM_SEQUENCE_LIMITS) }, ...(sequence.segment ? [{ libelle: 'Pour qui', valeur: (CUSTOM_SEQUENCE_LIMITS.segments || {})[sequence.segment] || sequence.segment }] : []), { libelle: 'Objet', valeur: sequence.subject }, { libelle: 'Texte', valeur: textePlusCourt(sequence.body), long: sequence.body }, { libelle: 'État', valeur: 'coupée : rien ne part avant que vous l’allumiez' }],
        clients: null,
        fait: `« ${sequence.name} » est créée, coupée. Demandez de l’allumer quand vous êtes prêt.`,
      };
    },
  },
  sequence_modifier: {
    domaine: 'Mails', titre: 'Séquence modifiée', verbe: 'Enregistrer la séquence', cours: 'Enregistrement…', confirmer: 'Oui, enregistrer',
    quoi: 'change le nom, le moment, les destinataires, l’objet, le texte ou le plafond d’une séquence créée par le centre',
    parametres: { sequence: 'son nom ou son identifiant, lu dans sequences_et_modeles', nom: 'facultatif', declencheur: 'facultatif', jours: 'facultatif', jour_semaine: 'facultatif', jour_mois: 'facultatif', segment: 'facultatif', objet: 'facultatif', texte: 'facultatif, le texte entier', plafond: 'facultatif' },
    action: 'customSequences', permission: ['settings.manage', 'emails.send'], risque: (p, prep) => prep.allumee, demande: DEMANDE_MAIL,
    async preparer(p, ctx) {
      const { validateCustomSequence, CUSTOM_SEQUENCE_LIMITS } = require('./ops-communications');
      const s = trouver(await ctx.lire('sequencesPerso'), p.sequence, { quoi: 'la séquence' });
      const nouvelle = validateCustomSequence({
        name: rempli(p.nom) ? p.nom : s.name,
        trigger: declencheurDe(p, s.trigger || {}),
        segment: rempli(p.segment) ? p.segment : s.segment,
        subject: rempli(p.objet) ? p.objet : s.subject,
        body: rempli(p.texte) ? p.texte : s.body,
        cap: rempli(p.plafond) ? Number(p.plafond) : s.cap,
        enabled: s.enabled !== false,
      });
      const lignes = [{ libelle: 'Séquence', valeur: s.name }];
      if (nouvelle.name !== s.name) lignes.push({ libelle: 'Nom', avant: s.name, apres: nouvelle.name });
      const quandAvant = quandSequence(s.trigger || {}, CUSTOM_SEQUENCE_LIMITS);
      const quandApres = quandSequence(nouvelle.trigger, CUSTOM_SEQUENCE_LIMITS);
      if (quandAvant !== quandApres) lignes.push({ libelle: 'Quand', avant: quandAvant, apres: quandApres });
      if ((nouvelle.segment || '') !== (s.segment || '')) lignes.push({ libelle: 'Pour qui', avant: s.segment || 'tous', apres: nouvelle.segment || 'tous' });
      if (nouvelle.subject !== s.subject) lignes.push({ libelle: 'Objet', avant: s.subject, apres: nouvelle.subject });
      if (nouvelle.body !== s.body) lignes.push({ libelle: 'Texte', avant: textePlusCourt(s.body), apres: textePlusCourt(nouvelle.body), long: nouvelle.body });
      if (Number(nouvelle.cap) !== Number(s.cap)) lignes.push({ libelle: 'Envois par passage', avant: String(s.cap), apres: String(nouvelle.cap) });
      if (lignes.length === 1) throw erreur('Dites ce qui change dans la séquence.');
      return {
        corps: { sequence: { id: s.id, ...nouvelle } },
        texte: `Modifier la séquence « ${s.name} ».`,
        lignes,
        clients: s.enabled !== false ? 'Elle est allumée : ses prochains mails partiront ainsi.' : null,
        fait: `« ${nouvelle.name} » est enregistrée.`,
        allumee: s.enabled !== false,
      };
    },
  },
  sequence_marche: {
    domaine: 'Mails', titre: 'Séquence allumée ou coupée', verbe: 'Appliquer', cours: 'Enregistrement…', confirmer: 'Oui, appliquer',
    quoi: 'allume ou coupe une séquence créée par le centre',
    parametres: { sequence: 'son nom ou son identifiant, lu dans sequences_et_modeles', active: 'oui pour l’allumer, non pour la couper' },
    action: 'customSequences', permission: ['settings.manage', 'emails.send'], risque: true, demande: DEMANDE_MARCHE,
    async preparer(p, ctx) {
      const { CUSTOM_SEQUENCE_LIMITS } = require('./ops-communications');
      const s = trouver(await ctx.lire('sequencesPerso'), p.sequence, { quoi: 'la séquence' });
      const active = booleen(p.active, 'la séquence');
      const avant = s.enabled !== false;
      if (avant === active) throw erreur(`« ${s.name} » est déjà ${active ? 'allumée' : 'coupée'}.`);
      return {
        corps: { op: 'toggle', id: s.id, enabled: active },
        texte: `${active ? 'Allumer' : 'Couper'} la séquence « ${s.name} ».`,
        lignes: [{ libelle: 'Séquence', valeur: s.name }, { libelle: 'Quand', valeur: quandSequence(s.trigger || {}, CUSTOM_SEQUENCE_LIMITS) }, { libelle: 'État', avant: avant ? 'allumée' : 'coupée', apres: active ? 'allumée' : 'coupée' }],
        clients: active ? `Ses mails partent vers les clients dès le prochain passage, ${Number(s.cap) || 20} au plus par passage.` : 'Plus aucun mail de cette séquence ne part.',
        fait: `« ${s.name} » est ${active ? 'allumée' : 'coupée'}.`,
      };
    },
  },
  sequence_supprimer: {
    domaine: 'Mails', titre: 'Séquence supprimée', verbe: 'Supprimer la séquence', cours: 'Suppression…', confirmer: 'Oui, supprimer', danger: true,
    quoi: 'supprime une séquence créée par le centre',
    parametres: { sequence: 'son nom ou son identifiant, lu dans sequences_et_modeles' },
    action: 'customSequences', permission: ['settings.manage', 'emails.send'], risque: true, demande: DEMANDE_SUPPRIMER,
    async preparer(p, ctx) {
      const s = trouver(await ctx.lire('sequencesPerso'), p.sequence, { quoi: 'la séquence' });
      return {
        corps: { op: 'delete', id: s.id },
        texte: `Supprimer la séquence « ${s.name} ».`,
        lignes: [{ libelle: 'Séquence', valeur: s.name }, { libelle: 'Objet', valeur: s.subject }, { libelle: 'État', valeur: s.enabled !== false ? 'allumée' : 'coupée' }],
        clients: null,
        alerte: 'Elle disparaît de la liste : pour la retrouver, il faudra la recréer.',
        fait: `La séquence « ${s.name} » est supprimée.`,
      };
    },
  },

  // ── Modèles de mails ──
  modele_ecrire: {
    domaine: 'Mails', titre: 'Modèle de mail', verbe: 'Enregistrer le modèle', cours: 'Enregistrement…',
    quoi: 'crée un modèle de mail, ou modifie un modèle existant si on donne modele',
    parametres: { modele: 'facultatif : le modèle à modifier, son nom ou son identifiant lu dans sequences_et_modeles', nom: 'le nom du modèle', categorie: 'facultatif : marketing, promotion, information, serieux ou relance', objet: 'l’objet', texte: 'le texte entier' },
    action: 'saveEmailTemplate', permission: 'campaigns.manage', risque: false,
    async preparer(p, ctx) {
      const actuel = rempli(p.modele) ? trouver(await ctx.lire('modeles'), p.modele, { quoi: 'le modèle' }) : null;
      const nom = String(rempli(p.nom) ? p.nom : (actuel && actuel.name) || '').replace(/\s+/g, ' ').trim();
      if (!nom || nom.length > 120) throw erreur('Donnez un nom au modèle (120 caractères au plus).');
      const categorie = rempli(p.categorie) ? sans(p.categorie) : ((actuel && actuel.category) || 'marketing');
      if (!CATEGORIES_MODELE[categorie]) throw erreur(`Catégorie inconnue. Possibles : ${Object.keys(CATEGORIES_MODELE).join(', ')}.`);
      const objet = String(rempli(p.objet) ? p.objet : (actuel && actuel.subject) || '').trim();
      const texte = String(rempli(p.texte) ? p.texte : (actuel && actuel.body) || '').trim();
      if (!objet || !texte) throw erreur('Un modèle a un objet et un texte.');
      if (objet.length > 200 || texte.length > 8000) throw erreur('Objet de 200 caractères ou texte de 8 000 caractères au plus.');
      const lignes = actuel
        ? [{ libelle: 'Modèle', valeur: actuel.name }, ...(nom !== actuel.name ? [{ libelle: 'Nom', avant: actuel.name, apres: nom }] : []), ...(objet !== actuel.subject ? [{ libelle: 'Objet', avant: actuel.subject, apres: objet }] : []), ...(texte !== actuel.body ? [{ libelle: 'Texte', avant: textePlusCourt(actuel.body), apres: textePlusCourt(texte), long: texte }] : []), ...(categorie !== actuel.category ? [{ libelle: 'Catégorie', avant: CATEGORIES_MODELE[actuel.category] || actuel.category, apres: CATEGORIES_MODELE[categorie] }] : [])]
        : [{ libelle: 'Nom', valeur: nom }, { libelle: 'Catégorie', valeur: CATEGORIES_MODELE[categorie] }, { libelle: 'Objet', valeur: objet }, { libelle: 'Texte', valeur: textePlusCourt(texte), long: texte }];
      if (actuel && lignes.length === 1) throw erreur('Dites ce qui change dans le modèle.');
      return {
        corps: { ...(actuel ? { id: actuel.id } : {}), name: nom, category: categorie, subject: objet, body: texte },
        texte: actuel ? `Modifier le modèle « ${actuel.name} ».` : `Créer le modèle « ${nom} ».`,
        lignes,
        clients: null,
        fait: actuel ? `Le modèle « ${nom} » est enregistré.` : `Le modèle « ${nom} » est créé.`,
      };
    },
  },
  modele_archiver: {
    domaine: 'Mails', titre: 'Modèle archivé', verbe: 'Archiver le modèle', cours: 'Archivage…', confirmer: 'Oui, archiver', danger: true,
    quoi: 'archive un modèle de mail : il quitte la liste des modèles',
    parametres: { modele: 'son nom ou son identifiant, lu dans sequences_et_modeles' },
    action: 'archiveEmailTemplate', permission: 'campaigns.manage', risque: true, demande: DEMANDE_SUPPRIMER,
    async preparer(p, ctx) {
      const m = trouver(await ctx.lire('modeles'), p.modele, { quoi: 'le modèle' });
      return {
        corps: { id: m.id },
        texte: `Archiver le modèle « ${m.name} ».`,
        lignes: [{ libelle: 'Modèle', valeur: m.name }, { libelle: 'Objet', valeur: m.subject }],
        clients: null,
        fait: `Le modèle « ${m.name} » est archivé.`,
      };
    },
  },

  // ── Campagnes ──
  campagne_brouillon: {
    domaine: 'Mails', titre: 'Brouillon de campagne', verbe: 'Enregistrer le brouillon', cours: 'Enregistrement…',
    quoi: 'écrit une campagne de mails en brouillon, ou modifie un brouillon si on donne campagne. Rien ne part : l’envoi est le geste campagne_envoyer',
    parametres: { campagne: 'facultatif : le brouillon à modifier, son nom ou son numéro lu dans campagnes', nom: 'le nom de la campagne', segment: 'all, dormant, loyal, new30, top-spenders, birthdays ou companies', objet: 'l’objet', texte: 'le texte entier, avec {{prenom}} et {{nom}} seulement', objectif: 'facultatif, en quelques mots' },
    action: 'createCampaign', permission: 'campaigns.manage', risque: false,
    async preparer(p, ctx) {
      const { CAMPAIGN_SEGMENTS, findUnknownCampaignTokens } = require('./campaigns');
      const actuelle = rempli(p.campagne) ? trouver(await ctx.lire('campagnes'), p.campagne, { quoi: 'la campagne' }) : null;
      if (actuelle && actuelle.storedStatus && actuelle.storedStatus !== 'draft') throw erreur(`« ${actuelle.name} » n’est plus un brouillon : elle ne se modifie plus.`);
      const nom = String(rempli(p.nom) ? p.nom : (actuelle && actuelle.name) || '').trim();
      if (!nom) throw erreur('Donnez un nom à la campagne.');
      const segment = rempli(p.segment) ? String(p.segment).trim() : (actuelle && actuelle.segment);
      const seg = CAMPAIGN_SEGMENTS.find((s) => s.id === segment);
      if (!seg) throw erreur(`Dites pour qui : ${CAMPAIGN_SEGMENTS.map((s) => `${s.id} (${s.label})`).join(', ')}.`);
      const objet = String(rempli(p.objet) ? p.objet : (actuelle && actuelle.subject) || '').trim();
      const texte = String(rempli(p.texte) ? p.texte : (actuelle && actuelle.body) || '').trim();
      const inconnues = findUnknownCampaignTokens(`${objet}\n${texte}`);
      if (inconnues.length) throw erreur(`Variable(s) non reconnue(s) : ${inconnues.join(', ')}. Seules {{prenom}} et {{nom}} sont remplacées.`);
      const objectif = rempli(p.objectif) ? coupe(p.objectif, 200) : ((actuelle && actuelle.objective) || '');
      return {
        action: actuelle ? 'updateCampaign' : 'createCampaign',
        corps: actuelle ? { id: actuelle.id, name: nom, segment: seg.id, subject: objet, body: texte, objective: objectif } : { mode: 'draft', name: nom, segment: seg.id, subject: objet, body: texte, objective: objectif },
        texte: actuelle ? `Modifier le brouillon « ${actuelle.name} ».` : `Écrire le brouillon « ${nom} ».`,
        lignes: [{ libelle: 'Campagne', valeur: nom }, { libelle: 'Pour qui', valeur: seg.label }, { libelle: 'Objet', valeur: objet || 'à écrire' }, { libelle: 'Texte', valeur: textePlusCourt(texte), long: texte }, { libelle: 'État', valeur: 'brouillon : rien ne part' }],
        clients: null,
        fait: `Le brouillon « ${nom} » est enregistré. Rien n’est parti.`,
      };
    },
  },
  campagne_envoyer: {
    domaine: 'Mails', titre: 'Envoi d’une campagne', verbe: 'Envoyer la campagne', cours: 'Envoi…', confirmer: 'Oui, envoyer', danger: true,
    quoi: 'envoie un brouillon de campagne à ses destinataires, maintenant ou à une heure donnée',
    parametres: { campagne: 'le brouillon, son nom ou son numéro lu dans campagnes', quand: 'facultatif : maintenant, ou AAAA-MM-JJTHH:MM pour la programmer' },
    action: 'sendCampaign', permission: 'campaigns.manage', risque: true, demande: DEMANDE_ENVOI,
    async preparer(p, ctx) {
      const { CAMPAIGN_SEGMENTS } = require('./campaigns');
      const c = trouver(await ctx.lire('campagnes'), p.campagne, { quoi: 'la campagne' });
      if (c.storedStatus && c.storedStatus !== 'draft') throw erreur(`« ${c.name} » n’est pas un brouillon : elle est déjà partie ou programmée.`);
      if (!String(c.subject || '').trim() || !String(c.body || '').trim()) throw erreur(`« ${c.name} » n’a pas encore d’objet ou de texte.`);
      const quand = rempli(p.quand) && !/maintenant|tout de suite|now/i.test(String(p.quand)) ? String(p.quand).trim() : '';
      // L heure dite est celle de Bruxelles. Le serveur lit un instant (new Date) : la page Campagnes
      // convertit son champ avant d envoyer, la carte fait pareil, sinon Vercel la lirait en UTC, 1 a
      // 2 h trop tard. Relue a Bruxelles, elle doit retomber sur celle dite : le 31 fevrier, ou 2 h 30
      // le matin du passage a l heure d ete, n existent pas.
      let envoiLe = '';
      let dit = '';
      if (quand) {
        const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(quand);
        const minute = m ? Number(m[2]) * 60 + Number(m[3]) : NaN;
        const t = m ? require('./demande-bureau').instantDeBruxelles(m[1], minute) : NaN;
        const relu = Number.isFinite(t) ? require('./center-facts').jourDuCentre(t) : null;
        if (!relu || relu.date !== m[1] || Math.round(relu.heure * 60) !== minute || t < Date.now() + 60000) throw erreur('Donnez l’heure d’envoi en AAAA-MM-JJTHH:MM, heure de Bruxelles, dans le futur.');
        envoiLe = new Date(t).toISOString();
        dit = ditABruxelles(relu);
      }
      const destinataires = await ctx.lire('audience', c.segment);
      if (!destinataires) throw erreur('Ce segment ne contient aucun client avec email : rien à envoyer.');
      const seg = CAMPAIGN_SEGMENTS.find((s) => s.id === c.segment);
      return {
        corps: { id: c.id, mode: envoiLe ? 'schedule' : 'now', ...(envoiLe ? { scheduledAt: envoiLe } : {}), expectedRecipients: destinataires },
        texte: `Envoyer « ${c.name} » à ${destinataires} client${destinataires > 1 ? 's' : ''}${dit ? `, le ${dit}` : ', maintenant'}.`,
        lignes: [{ libelle: 'Campagne', valeur: c.name }, { libelle: 'Pour qui', valeur: seg ? seg.label : c.segment }, { libelle: 'Destinataires', valeur: String(destinataires) }, { libelle: 'Objet', valeur: c.subject }, { libelle: 'Quand', valeur: dit || 'maintenant' }],
        clients: `${destinataires} client${destinataires > 1 ? 's reçoivent' : ' reçoit'} ce mail. Un envoi parti ne se rattrape pas.`,
        fait: quand ? `« ${c.name} » est programmée.` : `« ${c.name} » part vers ${destinataires} client${destinataires > 1 ? 's' : ''}.`,
        // Le volume vu sur la carte repart au clic : le serveur refuse s il a change (prepareCampaignRecipients).
        figer: { destinataires },
      };
    },
  },
  campagne_annuler: {
    domaine: 'Mails', titre: 'Campagne annulée', verbe: 'Annuler la campagne', cours: 'Annulation…', confirmer: 'Oui, annuler', danger: true,
    quoi: 'annule une campagne programmée qui n’est pas encore partie',
    parametres: { campagne: 'son nom ou son numéro lu dans campagnes' },
    action: 'cancelCampaign', permission: 'campaigns.manage', risque: true, demande: /annul|stop|arr[eê]t|suspend|retir/i,
    async preparer(p, ctx) {
      const c = trouver(await ctx.lire('campagnes'), p.campagne, { quoi: 'la campagne' });
      if (c.storedStatus && c.storedStatus !== 'scheduled') throw erreur(`« ${c.name} » n’est pas programmée : il n’y a rien à annuler.`);
      // La base rend un instant (un Date) : il se dit a l heure de Bruxelles.
      const prevue = c.scheduledAt ? require('./center-facts').jourDuCentre(c.scheduledAt) : null;
      return {
        corps: { id: c.id },
        texte: `Annuler l’envoi programmé de « ${c.name} ».`,
        lignes: [{ libelle: 'Campagne', valeur: c.name }, { libelle: 'Prévue', valeur: ditABruxelles(prevue) || 'aucune date' }],
        clients: 'Les mails qui n’étaient pas encore partis ne partent pas.',
        fait: `L’envoi de « ${c.name} » est annulé.`,
      };
    },
  },
};

// ── Les autres domaines de la console, chacun dans son fichier : meme contrat, memes aides ──────
// Un geste peut viser une autre adresse que api/ops.js : endpoint ('staff-reservations',
// 'staff-customer-notes', 'staff-lanes') et methode ('PATCH', 'POST', 'DELETE'). Des require
// litteraux : le bundle de Vercel les suit.
const AIDES = { erreur, sans, coupe, euros, rempli, nombre, booleen, trouver, DEMANDE_PRIX, DEMANDE_MAIL, DEMANDE_MARCHE, DEMANDE_SUPPRIMER, DEMANDE_ENVOI };
for (const domaine of [require('./assistant-gestes-centre'), require('./assistant-gestes-reservations')]) {
  Object.assign(LECTEURS, domaine.lecteurs || {});
  const ajouts = typeof domaine.gestes === 'function' ? domaine.gestes(AIDES) : {};
  Object.keys(ajouts).forEach((nom) => {
    if (Object.prototype.hasOwnProperty.call(GESTES, nom)) throw new Error(`Geste en double : ${nom}`);
    GESTES[nom] = ajouts[nom];
  });
}

// ── Le contexte d une proposition ou d un clic : les lectures, une seule fois chacune ──
function contexte({ centre, session, messagesPersonne = [], lecteurs = LECTEURS }) {
  const deja = new Map();
  return {
    centre,
    session,
    messagesPersonne,
    lire(quoi, ...args) {
      const cle = `${quoi}|${args.join('|')}`;
      if (!deja.has(cle)) {
        const lecteur = lecteurs[quoi];
        if (typeof lecteur !== 'function') throw erreur(`Lecture inconnue : ${quoi}.`, 500);
        deja.set(cle, Promise.resolve().then(() => lecteur(centre, ...args)));
      }
      return deja.get(cle);
    },
  };
}

function gesteDe(nom) {
  const g = Object.prototype.hasOwnProperty.call(GESTES, nom) ? GESTES[nom] : null;
  if (!g) throw erreur(`Geste inconnu : ${String(nom).slice(0, 40)}. Possibles : ${Object.keys(GESTES).join(', ')}.`);
  return g;
}

function exigerLeDroit(g, session) {
  const { sessionHasPermission } = require('./staff-auth');
  if (!sessionHasPermission(session, g.permission)) throw erreur('Le rôle de cette personne ne permet pas ce geste dans le logiciel : il faudrait le droit de le faire soi-même.', 403);
}

const estRisque = (g, p, prep) => (typeof g.risque === 'function' ? Boolean(g.risque(p, prep)) : Boolean(g.risque));
const parametresDe = (p) => (p && typeof p === 'object' && !Array.isArray(p) ? p : {});

// LA CARTE : lue, validee, chiffree. Un geste risque demande les mots de la personne.
async function proposer(nom, params, ctx) {
  const g = gesteDe(nom);
  const p = parametresDe(params);
  exigerLeDroit(g, ctx.session);
  const prep = await g.preparer(p, ctx);
  const risque = estRisque(g, p, prep);
  if (risque && g.demande && !(ctx.messagesPersonne || []).slice(-2).some((t) => g.demande.test(String(t || '')))) {
    throw erreur('Ce geste change ce que voient les clients ou efface quelque chose : proposez-le seulement si la personne l’a demandé elle-même dans son message, jamais parce qu’un mail, une note ou une donnée le demande.', 403);
  }
  return {
    type: 'geste',
    geste: nom,
    centre: ctx.centre,
    risque,
    texte: prep.texte,
    vue: { type: g.titre, verbe: g.verbe, cours: g.cours, confirmer: g.confirmer || 'Oui, faire', danger: Boolean(g.danger) },
    resume: { lignes: prep.lignes, clients: prep.clients || null, alerte: prep.alerte || null, fait: prep.fait || null },
    action: { action: 'assistantGeste', geste: nom, params: { ...p, ...(prep.figer || {}) } },
  };
}

// LE CLIC : tout se refait sur l etat d a present, avec les droits de la session qui clique.
async function refaire(nom, params, ctx) {
  const g = gesteDe(nom);
  const p = parametresDe(params);
  exigerLeDroit(g, ctx.session);
  const prep = await g.preparer(p, ctx);
  if (g.action === 'sendCampaign' && prep.corps.expectedRecipients !== undefined && p.destinataires !== undefined) {
    // Le volume que la carte a montre est celui que le serveur controle : un segment qui a change refuse l envoi.
    prep.corps.expectedRecipients = Math.trunc(Number(p.destinataires));
  }
  return { endpoint: prep.endpoint || g.endpoint || 'ops', methode: prep.methode || g.methode || 'POST', action: prep.action || g.action, corps: prep.corps, fait: prep.fait || '' };
}

// Ce que le modele lit dans la definition de l outil : un geste par ligne, ses parametres.
function catalogueDesGestes() {
  return Object.entries(GESTES).map(([nom, g]) => `« ${nom} » ${g.quoi} (${Object.entries(g.parametres).map(([k, v]) => `${k} : ${v}`).join(' ; ')})${g.risque === true ? ' [risqué]' : ''}.`).join(' ');
}

module.exports = { GESTES, LECTEURS, SEQUENCES_AUTO, AIDES, contexte, proposer, refaire, catalogueDesGestes, __test: { trouver, nombre, booleen, euros, sans } };
