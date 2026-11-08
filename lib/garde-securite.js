// LA GARDE DE SECURITE (2026-11-08).
//
// Ansar, le 07/11 : « plus de garde, plus de sécurité, plus d'info envoyée,
// répertoriée et analysée, et envoyée à mon Telegram ». Le journal d audit notait
// deja chaque refus (codes faux, gestes refuses faute de droit, tentatives vers un
// autre centre ou un autre client, codes d acces qu on tente de lire sans le droit),
// et personne ne les lisait : la garde du quart d heure ne relit que les gestes
// reussis (lib/garde-journal.js). Ce poste relit les refus, et ne dit que ce qui
// compte, deja analyse :
//   - une tentative vers le centre d un AUTRE client sonne (URGENT) : la console ne
//     la fait jamais, c est un appel fabrique a la main, ou un defaut a corriger ;
//   - des codes faux en serie, une personne entree apres plusieurs codes faux, une
//     rafale de gestes refuses a la meme personne, un code d acces qu on tente de
//     lire sans le droit : « A regarder », sans sonnerie ;
//   - un mail de client qui donne des ordres a l IA, ou qui cite le numero de
//     reservation d un autre client : « A regarder », au moment ou il arrive.
// Et le lundi a 8 h, dans Bilans, le bilan securite de la semaine : connexions,
// codes faux, refus, acces changes, mails suspects, sauvegardes, passages de la
// garde, avec un verdict. Tout est compte par le code, aucun modele n ecrit ce
// bilan : un chiffre de securite ne s invente pas.
//
// Aucune donnee personnelle de client ne part (regle du canal, lib/garde-alertes.js).
// Le nom d un membre de l equipe part, comme dans Modifications. L adresse IP d un
// appareil ne part jamais : seulement « le meme appareil ».
'use strict';

const { alerter, envoyerTelegram } = require('./garde-alertes');

// Un code d acces vaut 64 bits tires au hasard (createAccessCode) : il ne se devine
// pas. Le serveur bloque un appareil apres 8 codes faux en 15 minutes
// (LOGIN_MAX_FAILURES, lib/staff-auth.js). Ces seuils disent quand quelqu un essaie.
const SEUILS = {
  codesFauxAppareil: 5, // le meme appareil, sur un passage de la garde
  codesFauxTotal: 12, // tous appareils confondus, sur un passage
  entreApresCodesFaux: 5, // codes faux du meme appareil dans l heure avant une connexion reussie
  refusMemePersonne: 5, // gestes refuses a la meme personne, sur un passage
  autreCentreMemePersonne: 3, // tentatives vers un centre que la personne n a pas
};
const UNE_HEURE_MS = 60 * 60_000;
const LIMITE_LIGNES = 2000;

const MOTIFS = {
  codeFaux: '401_bad_code',
  sansSession: '401_no_session',
  droit: '403_permission',
  autreCentre: '403_center_scope',
  autreClient: '403_cross_client',
  autreSite: '403_autre_site',
};

// Les gestes sur l equipe et les codes (api/staff-auth.js) : ce que le bilan appelle
// « acces changes ». Leur detail part deja dans Modifications.
const GESTES_ACCES = {
  createMember: 'personne ajoutée',
  supprimerPersonne: 'personne retirée',
  deleteMember: 'personne retirée',
  renameMember: 'personne renommée',
  setMemberBlocked: 'personne bloquée ou débloquée',
  toggleMemberStatus: 'personne bloquée ou débloquée',
  updateMemberRole: 'rôle d’une personne changé',
  setMemberCenter: 'centre donné ou retiré',
  createRole: 'rôle créé',
  deleteRole: 'rôle supprimé',
  renameRole: 'rôle renommé',
  setRolePreset: 'modèle de rôle appliqué',
  updateRolePermissions: 'droits d’un rôle changés',
  regenerateRoleCode: 'code de rôle changé',
  regenerateMemberCode: 'code personnel changé',
};
const LECTURES_DE_CODE = new Set(['revealRoleCode', 'revealMemberCode']);

const nomParDefaut = (id) => {
  const s = String(id || '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'un centre';
};
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
const droitsLisibles = (ligne) => {
  const brut = ligne.droit || ligne.entity_id || '';
  return String(brut).split('|').filter(Boolean).slice(0, 3).join(', ');
};

// ---------------------------------------------------------------------------
// LECTURE
// ---------------------------------------------------------------------------

const COLONNES = `a.id, a.center_id, a.occurred_at, a.actor_kind,
       coalesce(a.actor_label, '') as actor_label,
       coalesce(a.actor_member_id, '') as actor_member_id,
       coalesce(a.actor_role_id, '') as actor_role_id,
       a.action, a.outcome, coalesce(a.denied_reason, '') as denied_reason,
       coalesce(a.entity_id, '') as entity_id,
       coalesce(a.context->>'empreinte', '') as empreinte,
       coalesce(a.context->>'centreDemande', '') as centre_demande,
       coalesce(a.context->>'permissionManquante', '') as droit`;

function normaliserLigne(r) {
  return { ...r, id: Number(r.id), occurred_at: r.occurred_at ? new Date(r.occurred_at).toISOString() : '' };
}

// Les refus et les connexions reussies, apres un curseur (le passage du quart d heure).
async function lireRefusApres(pool, curseur, { limite = LIMITE_LIGNES } = {}) {
  const { rows } = await pool.query(
    `select ${COLONNES} from audit_log a
      where a.id > $1 and (a.outcome = 'denied' or (a.action = 'login' and a.outcome = 'success'))
      order by a.id limit $2;`,
    [Number(curseur) || 0, limite],
  );
  return rows.map(normaliserLigne);
}

// Les codes faux de l heure qui precede, pour juger une connexion reussie.
async function lireCodesFauxRecents(pool, depuisIso) {
  const { rows } = await pool.query(
    `select coalesce(a.context->>'empreinte', '') as empreinte, count(*)::int as n
       from audit_log a
      where a.outcome = 'denied' and a.action = 'login' and a.occurred_at >= $1::timestamptz
      group by 1;`,
    [depuisIso],
  );
  return Object.fromEntries(rows.map((r) => [r.empreinte, Number(r.n) || 0]));
}

// ---------------------------------------------------------------------------
// ANALYSE (pure : ni base ni reseau)
// ---------------------------------------------------------------------------

// Ce qui merite un message, a partir des lignes d un passage. `codesFauxRecents` :
// empreinte -> nombre de codes faux dans l heure (lu en base), pour juger une
// connexion reussie apres une serie de codes faux.
function constatsSecurite(lignes, { noms = nomParDefaut, codesFauxRecents = {}, seuils = SEUILS } = {}) {
  const constats = [];
  const refus = lignes.filter((l) => l.outcome === 'denied');

  // 1. Le centre d un autre client : jamais un geste de la console.
  const autreClient = refus.filter((l) => l.denied_reason === MOTIFS.autreClient);
  if (autreClient.length) {
    const qui = [...new Set(autreClient.map((l) => `${l.actor_label || 'quelqu’un'} (${noms(l.center_id)})`))].slice(0, 3);
    constats.push({
      cle: `securite:autre-client:${autreClient[0].id}`,
      urgent: true,
      texte: `${pluriel(autreClient.length, 'tentative', 'tentatives')} d’ouvrir les données d’un centre d’un autre client, par ${qui.join(', ')}. Refusé par le serveur, rien n’a été lu. La console ne fait jamais ce geste : c’est un appel fabriqué à la main, ou un défaut à corriger. Le détail est dans le Journal d’Équipe & accès.`,
    });
  }

  // 2. Les codes faux.
  const codesFaux = refus.filter((l) => l.action === 'login' && l.denied_reason === MOTIFS.codeFaux);
  if (codesFaux.length) {
    const parAppareil = new Map();
    for (const l of codesFaux) {
      const k = `${l.center_id}|${l.empreinte}`;
      parAppareil.set(k, (parAppareil.get(k) || 0) + 1);
    }
    const insistants = [...parAppareil.entries()].filter(([, n]) => n >= seuils.codesFauxAppareil);
    if (insistants.length || codesFaux.length >= seuils.codesFauxTotal) {
      const centres = [...new Set(codesFaux.map((l) => noms(l.center_id)))];
      const max = Math.max(...parAppareil.values());
      const bloque = max >= 8;
      constats.push({
        cle: `securite:codes-faux:${codesFaux[codesFaux.length - 1].id}`,
        urgent: false,
        texte: `${pluriel(codesFaux.length, 'code faux', 'codes faux')} en 15 minutes (${centres.join(', ')}), depuis ${pluriel(parAppareil.size, 'appareil', 'appareils')} ; le plus insistant : ${max} essais${bloque ? ', il est bloqué 15 minutes' : ''}. Un code d’accès ne se devine pas en essayant au hasard. Si ce n’est pas quelqu’un de l’équipe qui se trompe de code, rien d’autre à faire.`,
      });
    }
  }

  // 3. Une personne entree apres une serie de codes faux depuis le meme appareil.
  for (const l of lignes.filter((x) => x.action === 'login' && x.outcome === 'success' && x.empreinte)) {
    const n = Number(codesFauxRecents[l.empreinte]) || 0;
    if (n < seuils.entreApresCodesFaux) continue;
    constats.push({
      cle: `securite:entre-apres-codes-faux:${l.id}`,
      urgent: false,
      texte: `${l.actor_label || 'Quelqu’un'} est entré à ${noms(l.center_id)} après ${n} codes faux depuis le même appareil dans l’heure. C’est le plus souvent une faute de frappe. Si ce n’est pas cette personne, change son code tout de suite dans Équipe & accès.`,
    });
  }

  // 4. Des gestes refuses en rafale a la meme personne.
  const parPersonne = new Map();
  for (const l of refus.filter((x) => x.actor_kind === 'staff' && (x.denied_reason === MOTIFS.droit || x.denied_reason === MOTIFS.autreCentre))) {
    const k = l.actor_member_id || l.actor_label;
    if (!k) continue;
    if (!parPersonne.has(k)) parPersonne.set(k, []);
    parPersonne.get(k).push(l);
  }
  for (const [k, liste] of parPersonne) {
    const droit = liste.filter((l) => l.denied_reason === MOTIFS.droit);
    const autreCentre = liste.filter((l) => l.denied_reason === MOTIFS.autreCentre);
    if (droit.length < seuils.refusMemePersonne && autreCentre.length < seuils.autreCentreMemePersonne) continue;
    const l0 = liste[0];
    const morceaux = [];
    if (droit.length) morceaux.push(`${pluriel(droit.length, 'geste refusé', 'gestes refusés')} faute de droit (${[...new Set(droit.map(droitsLisibles))].slice(0, 3).join(' ; ')})`);
    if (autreCentre.length) morceaux.push(`${pluriel(autreCentre.length, 'essai', 'essais')} d’ouvrir un centre que son rôle n’a pas (${[...new Set(autreCentre.map((l) => noms(l.centre_demande)))].join(', ')})`);
    constats.push({
      cle: `securite:refus:${k}:${liste[liste.length - 1].id}`,
      urgent: false,
      texte: `${l0.actor_label || 'Une personne de l’équipe'} (${noms(l0.center_id)}) : ${morceaux.join(', et ')}, en 15 minutes. Soit un bouton de la console montre un geste que son rôle n’a pas (à corriger chez nous), soit quelqu’un essaie à la main.`,
    });
  }

  // 5. Un code d acces qu on tente de lire ou de changer sans le droit.
  for (const l of refus.filter((x) => x.droit === 'security.codes')) {
    constats.push({
      cle: `securite:code-refuse:${l.id}`,
      urgent: false,
      texte: `${l.actor_label || 'Quelqu’un'} (${noms(l.center_id)}) a voulu afficher ou changer un code d’accès sans en avoir le droit. Refusé.`,
    });
  }
  return constats;
}

function messageSecurite(constats) {
  if (!constats.length) return [];
  const urgents = constats.filter((c) => c.urgent);
  const calmes = constats.filter((c) => !c.urgent);
  const out = [];
  if (urgents.length) out.push({ urgent: true, cle: urgents.map((c) => c.cle).join('+'), texte: `URGENT Pinlane, sécurité\n${urgents.map((c) => c.texte).join('\n')}` });
  if (calmes.length) out.push({ urgent: false, cle: calmes.map((c) => c.cle).join('+'), texte: `À regarder, Pinlane, sécurité\n${calmes.map((c) => c.texte).join('\n')}` });
  return out;
}

// ---------------------------------------------------------------------------
// LE PASSAGE DU QUART D HEURE
// ---------------------------------------------------------------------------

// Ajoutee a un groupe deja en service (la prod du 2026-11-08), la garde de securite se
// presente une fois dans Bilans : c est la preuve, en prod, que le code tourne et que
// Telegram le recoit. Un groupe neuf la presente avec ses sujets (lib/tour-controle.js).
const MISE_EN_SERVICE = 'Mise en service de la garde de sécurité Pinlane.\nToutes les 15 minutes, elle relit les refus que le journal note : codes faux, gestes refusés faute de droit, tentatives vers un autre centre ou un autre client, codes d’accès qu’on tente de lire sans le droit. Elle surveille aussi les mails de clients qui donnent des ordres à l’IA et l’entrée des mails. Ce qui compte arrive dans Pannes, sans sonnerie ; seule une tentative vers un autre client, ou l’entrée des mails coupée, sonne. Chaque lundi à 8 h, le bilan sécurité de la semaine arrive ici.';

// Rend le nouveau curseur, ou l ancien si un message n est pas parti (il sera redit).
async function relireLesRefus(pool, curseur, { env = process.env, fetcher = fetch, noms = nomParDefaut, maintenant = Date.now(), annoncer = false } = {}) {
  if (curseur === null || curseur === undefined || !Number.isFinite(Number(curseur))) {
    // Premier passage : on part de maintenant, l historique ne se rejoue pas. La mise en
    // service se dit si on le demande ; non partie, elle se redit au passage suivant.
    const { rows } = await pool.query('select coalesce(max(id), 0)::bigint as dernier from audit_log;');
    const dernier = Number(rows[0] && rows[0].dernier) || 0;
    if (!annoncer) return { curseur: dernier, messages: 0, envois: [] };
    const r = await envoyerTelegram(MISE_EN_SERVICE, { env, fetcher, sujet: 'bilans' });
    return { curseur: r.ok ? dernier : null, messages: r.ok ? 1 : 0, envois: [r.ok], miseEnService: true };
  }
  const lignes = await lireRefusApres(pool, curseur);
  if (!lignes.length) return { curseur: Number(curseur), messages: 0, envois: [] };
  const reussies = lignes.some((l) => l.action === 'login' && l.outcome === 'success' && l.empreinte);
  const codesFauxRecents = reussies ? await lireCodesFauxRecents(pool, new Date(maintenant - UNE_HEURE_MS).toISOString()) : {};
  const messages = messageSecurite(constatsSecurite(lignes, { noms, codesFauxRecents }));
  const envois = [];
  for (const m of messages) {
    const r = await envoyerTelegram(m.texte, { env, fetcher, sujet: 'pannes', silencieux: !m.urgent });
    envois.push(r.ok);
  }
  const dernier = lignes[lignes.length - 1].id;
  return { curseur: envois.every(Boolean) ? dernier : Number(curseur), messages: envois.filter(Boolean).length, envois };
}

// ---------------------------------------------------------------------------
// LE MAIL SUSPECT, au moment ou il arrive (lib/email-agent.js, ingestInboundEmail)
// ---------------------------------------------------------------------------

async function signalerMailSuspect({ centerId = '', securite = {}, noms = nomParDefaut, env = process.env, fetcher = fetch, maintenant = Date.now() } = {}) {
  const morceaux = [];
  if (securite.consigneCachee) morceaux.push('il contient des consignes adressées à l’IA (du type « ignore tes instructions »). L’IA ne les a pas suivies');
  if (securite.numeroAutreClient) morceaux.push('il cite le numéro de réservation d’un autre client. L’IA n’en a rien dit');
  if (!morceaux.length) return { ok: true, rien: true };
  const centre = noms(centerId);
  const texte = `À regarder, Pinlane, sécurité\nUn mail reçu à ${centre} : ${morceaux.join(' ; ')}. La réponse proposée attend ta relecture dans Emails, marquée urgente. Ne l’envoie qu’après l’avoir lue.`;
  // Une vague de mails pieges ne fait pas une vague de messages : un par centre et
  // par demi-heure ; le bilan du lundi les compte tous.
  const cle = `securite:mail:${centerId}:${securite.consigneCachee ? 'consigne' : ''}${securite.numeroAutreClient ? 'numero' : ''}`;
  return alerter(cle, texte, { fenetreMs: 30 * 60_000, maintenant, env, fetcher, sujet: 'pannes', silencieux: true });
}

// ---------------------------------------------------------------------------
// LE WEBHOOK DES MAILS QUI REFUSE UN ENVOI (api/inbound-email.js)
// ---------------------------------------------------------------------------

// Un message par heure au plus. Signe par le fournisseur mais faux : c est presque
// toujours le secret du webhook qui ne correspond plus, et alors plus AUCUN mail de
// client n arrive dans la console : ca sonne. Sans signature : quelqu un essaie, sans
// sonnerie.
// La cle maitresse ouverte pendant une panne : un seul message, qui sonne.
async function signalerSessionDeSecours({ env = process.env, fetcher = fetch, maintenant = Date.now() } = {}) {
  const texte = 'URGENT Pinlane, sécurité\nUne session de secours du propriétaire vient d’être ouverte : la base ne répondait plus et le code du propriétaire a été donné. Si ce n’est pas toi, change PLATFORM_OWNER_CODE et STAFF_AUTH_SECRET sur Vercel.';
  return alerter('securite:session-secours', texte, { fenetreMs: 10 * 60_000, maintenant, env, fetcher, sujet: 'pannes' });
}

async function signalerWebhookRefuse({ signeParLeFournisseur = false, env = process.env, fetcher = fetch, maintenant = Date.now() } = {}) {
  const texte = signeParLeFournisseur
    ? 'URGENT Pinlane, sécurité\nUn mail de client envoyé par Resend a été refusé : sa signature ne correspond plus au secret du webhook. Tant que ce n’est pas réglé, AUCUN mail de client n’arrive dans la console. À vérifier : la variable RESEND_WEBHOOK_SECRET sur Vercel et le secret du webhook chez Resend.'
    : 'À regarder, Pinlane, sécurité\nUn envoi sans signature valide a été refusé à l’entrée des mails de clients. Quelqu’un essaie peut-être de fabriquer de faux mails. Rien n’a été enregistré.';
  return alerter(`securite:webhook:${signeParLeFournisseur ? 'signe' : 'anonyme'}`, texte, { fenetreMs: 60 * 60_000, maintenant, env, fetcher, sujet: 'pannes', silencieux: !signeParLeFournisseur });
}

// ---------------------------------------------------------------------------
// LE BILAN SECURITE DU LUNDI
// ---------------------------------------------------------------------------

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const jourLisible = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`;
};
const heureBelge = (instant) => new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }).format(new Date(instant)).replace(':', ' h ');
const jourBelge = (instant) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date(instant));

// La semaine qui vient de finir : du lundi 00:00 au lundi 00:00 (heure de Bruxelles),
// le lundi du bilan exclu. `debut` et `fin` en jours belges.
function semaineEcoulee(instant = new Date()) {
  const aujourdhui = jourBelge(instant);
  const d = new Date(`${aujourdhui}T12:00:00Z`);
  const decalage = (d.getUTCDay() + 6) % 7; // 0 le lundi
  const lundi = new Date(d.getTime() - decalage * 86400000);
  const debut = new Date(lundi.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const fin = new Date(lundi.getTime() - 86400000).toISOString().slice(0, 10);
  return { debut, fin, lundi: lundi.toISOString().slice(0, 10) };
}

// Les chiffres de la semaine, lus en base. Chaque lecture qui echoue laisse sa ligne
// a null : le bilan le dit, il ne met jamais un zero a la place d un « je ne sais pas ».
async function lireSemaine(pool, { debut, lundi }) {
  const de = `${debut}T00:00:00`;
  const a = `${lundi}T00:00:00`;
  const fenetre = "a.occurred_at >= ($1::timestamp at time zone 'Europe/Brussels') and a.occurred_at < ($2::timestamp at time zone 'Europe/Brussels')";
  const lire = async (sql, params = [de, a]) => {
    try { return (await pool.query(sql, params)).rows; } catch (error) {
      console.error('[garde-securite] lecture du bilan', String((error && error.message) || error).slice(0, 200));
      return null;
    }
  };
  const [connexions, codesFaux, refus, acces, lecturesDeCode, mails, taches] = await Promise.all([
    lire(`select a.center_id, coalesce(r.name, a.actor_role_id, '') as role, count(*)::int as n
            from audit_log a left join staff_roles r on r.center_id = a.center_id and r.id = a.actor_role_id
           where ${fenetre} and a.action = 'login' and a.outcome = 'success'
           group by 1, 2;`),
    lire(`select a.center_id, coalesce(a.context->>'empreinte', '') as empreinte, count(*)::int as n
            from audit_log a
           where ${fenetre} and a.action = 'login' and a.outcome = 'denied'
           group by 1, 2;`),
    lire(`select a.denied_reason, count(*)::int as n
            from audit_log a
           where ${fenetre} and a.outcome = 'denied' and a.action <> 'login'
           group by 1;`),
    lire(`select a.action, count(*)::int as n
            from audit_log a
           where ${fenetre} and a.outcome = 'success' and a.surface = 'api/staff-auth.js'
           group by 1;`),
    lire(`select coalesce(a.actor_label, '') as qui, count(*)::int as n
            from audit_log a
           where ${fenetre} and a.outcome = 'success' and a.action in ('revealRoleCode', 'revealMemberCode')
           group by 1;`),
    lire(`select count(*) filter (where (c.payload->'analysis'->'securite'->>'consigneCachee') = 'true')::int as consignes,
                 count(*) filter (where (c.payload->'analysis'->'securite'->>'numeroAutreClient') = 'true')::int as numeros,
                 count(*)::int as recus
            from communications c
           where c.direction = 'inbound' and c.channel = 'email'
             and c.created_at >= ($1::timestamp at time zone 'Europe/Brussels') and c.created_at < ($2::timestamp at time zone 'Europe/Brussels');`),
    lire(`select task_name, status, count(*)::int as n, max(started_at) as dernier
            from ops_worker_runs
           where task_name in ('sauvegarde', 'garde')
             and started_at >= ($1::timestamp at time zone 'Europe/Brussels') and started_at < ($2::timestamp at time zone 'Europe/Brussels')
           group by 1, 2;`),
  ]);
  return { connexions, codesFaux, refus, acces, lecturesDeCode, mails: mails && mails[0] ? mails[0] : mails, taches };
}

// Le texte du bilan, et son verdict. Pure : les chiffres viennent de lireSemaine.
function texteBilanSecurite(s, { debut, fin, noms = nomParDefaut } = {}) {
  const lignes = [`Bilan sécurité de la semaine, du ${jourLisible(debut)} au ${jourLisible(fin)}`];
  const aRegarder = [];
  const inconnu = 'je n’ai pas pu le lire';
  const total = (rows) => (rows || []).reduce((t, r) => t + (Number(r.n) || 0), 0);

  // Connexions.
  if (s.connexions === null) lignes.push(`Connexions : ${inconnu}.`);
  else {
    const n = total(s.connexions);
    const parCentre = new Map();
    const parRole = new Map();
    for (const r of s.connexions) {
      parCentre.set(noms(r.center_id), (parCentre.get(noms(r.center_id)) || 0) + r.n);
      const role = r.role || 'sans rôle';
      parRole.set(role, (parRole.get(role) || 0) + r.n);
    }
    const detail = n ? ` (${[...parCentre].map(([c, k]) => `${c} ${k}`).join(', ')}). Par rôle : ${[...parRole].sort((x, y) => y[1] - x[1]).map(([r, k]) => `${r} ${k}`).join(', ')}` : '';
    lignes.push(`Connexions réussies : ${n}${detail}.`);
  }

  // Codes faux.
  if (s.codesFaux === null) lignes.push(`Codes faux : ${inconnu}.`);
  else {
    const n = total(s.codesFaux);
    const appareils = new Set(s.codesFaux.map((r) => `${r.center_id}|${r.empreinte}`)).size;
    const max = s.codesFaux.reduce((m, r) => Math.max(m, Number(r.n) || 0), 0);
    lignes.push(n ? `Codes faux : ${n}, depuis ${pluriel(appareils, 'appareil', 'appareils')} ; le plus insistant : ${max} essais${max >= 8 ? ' (bloqué au 8e)' : ''}.` : 'Codes faux : aucun.');
    if (max >= 8) aRegarder.push(`un appareil a essayé ${max} codes faux`);
  }

  // Refus.
  if (s.refus === null) lignes.push(`Gestes refusés : ${inconnu}.`);
  else {
    const par = Object.fromEntries(s.refus.map((r) => [r.denied_reason, Number(r.n) || 0]));
    const droit = par[MOTIFS.droit] || 0;
    const autreCentre = par[MOTIFS.autreCentre] || 0;
    const autreClient = par[MOTIFS.autreClient] || 0;
    const sansSession = par[MOTIFS.sansSession] || 0;
    lignes.push(`Gestes refusés : ${droit} faute de droit, ${autreCentre} vers un centre que le rôle n’a pas, ${autreClient} vers un autre client. Et ${sansSession} demandes sans connexion (une console restée ouverte après la fin de sa session, ou un robot), toutes refusées.`);
    if (autreClient) aRegarder.push(`${pluriel(autreClient, 'tentative', 'tentatives')} vers un autre client`);
    if (autreCentre >= 10) aRegarder.push(`${autreCentre} essais vers un centre non autorisé`);
  }

  // Acces changes.
  if (s.acces === null) lignes.push(`Accès changés : ${inconnu}.`);
  else {
    const changes = s.acces.filter((r) => GESTES_ACCES[r.action]);
    const parPhrase = new Map();
    for (const r of changes) parPhrase.set(GESTES_ACCES[r.action], (parPhrase.get(GESTES_ACCES[r.action]) || 0) + r.n);
    lignes.push(parPhrase.size ? `Accès changés : ${[...parPhrase].map(([p, k]) => `${k} ${p}`).join(', ')}. Le détail est passé dans Modifications.` : 'Accès changés : aucun.');
  }
  if (Array.isArray(s.lecturesDeCode) && s.lecturesDeCode.length) {
    lignes.push(`Codes d’accès affichés : ${s.lecturesDeCode.map((r) => `${r.qui || 'quelqu’un'} ${r.n}`).join(', ')}.`);
  }

  // Mails.
  if (s.mails === null || s.mails === undefined) lignes.push(`Mails de clients : ${inconnu}.`);
  else {
    const consignes = Number(s.mails.consignes) || 0;
    const numeros = Number(s.mails.numeros) || 0;
    lignes.push(`Mails de clients : ${Number(s.mails.recus) || 0} reçus, ${consignes} avec des consignes adressées à l’IA, ${numeros} citant le numéro d’un autre client.`);
    if (consignes) aRegarder.push(`${pluriel(consignes, 'mail piégé', 'mails piégés')} pour l’IA`);
  }

  // Sauvegardes et garde.
  if (s.taches === null) lignes.push(`Sauvegardes : ${inconnu}.`);
  else {
    const t = (nom, statut) => s.taches.filter((r) => r.task_name === nom && (!statut || r.status === statut));
    const sauvOk = total(t('sauvegarde', 'ok'));
    const derniere = t('sauvegarde', 'ok').reduce((m, r) => (r.dernier && (!m || new Date(r.dernier) > m) ? new Date(r.dernier) : m), null);
    lignes.push(`Sauvegardes de la nuit : ${sauvOk} sur 7${derniere ? `, la dernière le ${jourLisible(jourBelge(derniere))} à ${heureBelge(derniere)}` : ''}.`);
    if (sauvOk < 7) aRegarder.push(`${7 - sauvOk} ${7 - sauvOk > 1 ? 'nuits' : 'nuit'} sans sauvegarde`);
    const gardeOk = total(t('garde', 'ok'));
    const gardeKo = total(t('garde')) - gardeOk;
    lignes.push(`Garde : ${gardeOk} passages réussis sur 672 attendus${gardeKo ? `, ${gardeKo} ratés` : ''}.`);
    if (gardeOk < 600) aRegarder.push('la garde a manqué des passages');
  }

  lignes.splice(1, 0, aRegarder.length ? `Verdict : à regarder, ${aRegarder.join(' ; ')}.` : 'Verdict : rien d’anormal.');
  return { texte: lignes.join('\n'), verdict: aRegarder.length ? 'a-regarder' : 'rien' };
}

// Le lundi entre 8 h et 11 h, une fois par semaine. Rend la semaine envoyee, ou
// l ancienne si rien n est parti (le passage suivant reessaie).
const HEURE_BILAN = '08:00';
const FIN_BILAN = '11:00';
const heureCourte = (instant) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(instant));

async function bilanSecuriteSiLundi(pool, dejaEnvoye, { instant = new Date(), env = process.env, fetcher = fetch, noms = nomParDefaut } = {}) {
  const semaine = semaineEcoulee(instant);
  const heure = heureCourte(instant);
  if (jourBelge(instant) !== semaine.lundi || heure < HEURE_BILAN || heure >= FIN_BILAN || dejaEnvoye === semaine.lundi) {
    return { semaine: dejaEnvoye || '', envoye: false };
  }
  const chiffres = await lireSemaine(pool, semaine);
  const { texte, verdict } = texteBilanSecurite(chiffres, { ...semaine, noms });
  const r = await envoyerTelegram(texte, { env, fetcher, sujet: 'bilans' });
  return { semaine: r.ok ? semaine.lundi : (dejaEnvoye || ''), envoye: r.ok, verdict };
}

module.exports = {
  GESTES_ACCES,
  LECTURES_DE_CODE,
  MISE_EN_SERVICE,
  MOTIFS,
  SEUILS,
  bilanSecuriteSiLundi,
  constatsSecurite,
  lireSemaine,
  messageSecurite,
  relireLesRefus,
  semaineEcoulee,
  signalerMailSuspect,
  signalerSessionDeSecours,
  signalerWebhookRefuse,
  texteBilanSecurite,
};
