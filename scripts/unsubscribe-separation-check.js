// GATE DE SEPARATION MARKETING / TRANSACTIONNEL (M6). Sans reseau, sans DB.
//
// Ce que ce gate prouve, de facon COMPORTEMENTALE (on rend de vrais mails et
// on regarde ce qui s'y trouve, on ne cherche pas une chaine dans le source) :
//
//   1. MARKETING -> lien de retrait PRESENT. On fait tourner les quatre envois
//      marketing (campagne, anniversaire J-30, reactivation, sequence
//      personnalisee) avec des deps mockees et on verifie que chaque mail enfile
//      porte un lien /api/u?k=<token 32 hex>, que le payload stocke le jeton, et
//      que l'alternative texte porte aussi la porte de sortie.
//
//   2. TRANSACTIONNEL -> lien de retrait ABSENT. On rend les mails de service
//      (confirmation, demande recue, rappel, post-visite) par le vrai gabarit et
//      on verifie qu'AUCUN ne porte de lien de retrait, d'en-tete ni de mot de
//      desabonnement. Meme chose pour le chemin d'enfilement reel
//      (enqueueReservationCommunications) : aucun payload.unsubToken.
//
//   3. EN-TETE List-Unsubscribe : pose sur marketing, absent sur transactionnel.
//      Assertion la plus sensible : l'en-tete est construit DANS sendEmail. On
//      mocke fetch et on regarde le corps envoye a Resend dans les deux cas.
//
//   4. PROFIL DE DELIVRABILITE des transactionnels INCHANGE : nombre de liens,
//      d'images, poids. Movsar : « ca doit rester en principal ».
//
//   5. JETON : deterministe et non devinable avec secret ; aleatoire (mais
//      stocke) sans secret ; la route ne lit JAMAIS d'adresse en entree.
//
// Lancement : node scripts/unsubscribe-separation-check.js

// Env AVANT tout require applicatif : les helpers de jeton et d'URL lisent
// l'environnement a l'appel.
process.env.UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || 'gate-secret-0123456789abcdef0123456789abcdef';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://www.mngfunglxy.com';

const {
  runBirthdayJ30Sweep,
  runReactivationSweep,
  runCustomSequencesSweep,
  enqueueReservationCommunications,
  buildAutomationPreview,
  __test,
} = require('../lib/ops-communications');
const {
  buildUnsubscribe,
  unsubscribeToken,
  resolveUnsubscribeToken,
  renderUnsubscribePage,
} = require('../lib/marketing-suppression');

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

const UNSUB_LINK = /\/api\/u\?k=[0-9a-f]{32}/;
const TOKEN_RX = /^[0-9a-f]{32}$/;
// Detection LARGE du desabonnement (memes formes que le gate delivrabilite).
const DESAB = /List-Unsubscribe|d[ée]sabonn|d[ée]sinscri|se retirer de la liste|ne plus recevoir|g[ée]rer mes pr[ée]f[ée]rences|unsubscribe|opt[- ]?out|\/api\/u\?k=/i;
const iso = (offsetDays) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offsetDays); return d.toISOString().slice(0, 10); };

// Mock deps : route par fragment SQL. `state` pilote les fixtures et capte les
// eventuelles adresses supprimees.
function makeDeps(state = {}) {
  const enqueued = [];
  return {
    enqueued,
    enqueue: async (row) => { enqueued.push(row); return { id: enqueued.length }; },
    query: async (text, params = []) => {
      const sql = String(text);
      // Reglages du centre (getAutomationSettings ET listCustomSequences).
      if (sql.includes('center_automation_settings') && sql.startsWith('select')) {
        return { rows: [{ settings: state.settings || {} }] };
      }
      // Liste de suppression : le coeur du filtrage. Par defaut personne.
      if (sql.includes('marketing_suppressions')) {
        const wanted = (params[1] || []);
        const set = new Set((state.suppressed || []).map((e) => e.toLowerCase()));
        return { rows: wanted.filter((e) => set.has(String(e).toLowerCase())).map((email) => ({ email })) };
      }
      if (sql.includes("occasion = 'anniversaire'")) return { rows: state.birthday || [] };
      if (sql.includes("template_id = 'birthday_j30'")) return { rows: [] };
      if (sql.includes("template_id = 'reactivation'")) return { rows: [] };
      if (sql.includes("with clients as")) return { rows: state.clients || [] };
      // Dedupe des sequences custom (template_id = $2, payload dedupeKey).
      if (sql.includes('dedupeKey')) return { rows: [] };
      return { rows: [] };
    },
  };
}

(async () => {
  /* ═══ 1. MARKETING : lien de retrait PRESENT sur les quatre envois ═══ */
  console.log('[MARKETING] les quatre envois marketing portent le lien de retrait');

  // 1a. Campagne (enqueueCampaign, appele par le cron et par la console).
  {
    const deps = makeDeps({});
    const { enqueueCampaign } = require('../lib/ops-communications');
    const res = await enqueueCampaign({
      centerId: 'libramont',
      campaignId: 42,
      recipients: [{ email: 'client@test.be', name: 'Client Test', firstName: 'Client' }],
      subject: 'Nos nouveautes',
      body: 'Bonjour, voici nos nouveautes.',
      scheduledAt: iso(1),
      personalize: (t) => t,
      deps,
      enqueue: deps.enqueue,
    });
    const mail = deps.enqueued[0] || {};
    ok(res.queued === 1, `campagne : 1 mail enfile (obtenu ${res.queued})`);
    ok(UNSUB_LINK.test(mail.body || ''), 'campagne : le HTML porte un lien /api/u?k=<32 hex>');
    ok(TOKEN_RX.test(mail.payload?.unsubToken || ''), `campagne : jeton 128 bits stocke (obtenu ${mail.payload?.unsubToken})`);
    ok(UNSUB_LINK.test(mail.payload?.textBody || ''), 'campagne : la version texte porte aussi la porte de sortie');
  }

  // 1b. Anniversaire J-30.
  {
    const deps = makeDeps({ birthday: [{ id: 1, name: 'Famille Kessler', phone: '+32470111007', email: 'kessler@test.be', date: iso(-335) }] });
    const res = await runBirthdayJ30Sweep('libramont', deps, { today: iso(0) });
    const mail = deps.enqueued[0] || {};
    ok(res.enqueued === 1, `anniversaire : 1 mail enfile (obtenu ${res.enqueued})`);
    ok(UNSUB_LINK.test(mail.body || ''), 'anniversaire : le HTML porte le lien de retrait');
    ok(TOKEN_RX.test(mail.payload?.unsubToken || ''), 'anniversaire : jeton stocke');
    ok(UNSUB_LINK.test(mail.payload?.textBody || ''), 'anniversaire : version texte avec porte de sortie');
  }

  // 1c. Reactivation (activee via les settings).
  {
    const deps = makeDeps({
      settings: { reactivation: { enabled: true } },
      clients: [{ client_key: '+32470222008', email: 'dormant@test.be', name: 'Client Dormant', last_visit: iso(-75) }],
    });
    const res = await runReactivationSweep('libramont', deps, { today: iso(0) });
    const mail = deps.enqueued[0] || {};
    ok(res.enqueued === 1, `reactivation : 1 mail enfile (obtenu ${res.enqueued})`);
    ok(UNSUB_LINK.test(mail.body || ''), 'reactivation : le HTML porte le lien de retrait');
    ok(TOKEN_RX.test(mail.payload?.unsubToken || ''), 'reactivation : jeton stocke');
  }

  // 1d. Sequence personnalisee (inactive) creee par le gerant.
  {
    const sequence = {
      id: 'seqx', name: 'Relance dormants', enabled: true,
      trigger: { type: 'inactive', days: 60 }, subject: 'On pense a vous {{prenom}}',
      body: 'Bonjour {{prenom}}, revenez nous voir.', cap: 10, createdAt: iso(-1),
    };
    const deps = makeDeps({
      settings: { custom_sequences: [sequence] },
      clients: [{ client_key: '+32470333009', email: 'custom@test.be', name: 'Client Custom' }],
    });
    const res = await runCustomSequencesSweep('libramont', deps, { today: iso(0) });
    const mail = deps.enqueued[0] || {};
    ok(res.enqueued === 1, `sequence perso : 1 mail enfile (obtenu ${res.enqueued})`);
    ok(UNSUB_LINK.test(mail.body || ''), 'sequence perso : le HTML porte le lien de retrait');
    ok(TOKEN_RX.test(mail.payload?.unsubToken || ''), 'sequence perso : jeton stocke');
  }

  /* ═══ 2. FILTRAGE : une adresse retiree n'est PLUS enfilee (marketing) ═══ */
  console.log('\n[FILTRE] une adresse sur la liste est exclue de chaque envoi marketing');
  {
    const deps = makeDeps({ suppressed: ['kessler@test.be'], birthday: [{ id: 1, name: 'Kessler', phone: '+32470111007', email: 'kessler@test.be', date: iso(-335) }] });
    const res = await runBirthdayJ30Sweep('libramont', deps, { today: iso(0) });
    ok(res.enqueued === 0 && deps.enqueued.length === 0, `anniversaire : l'adresse exclue ne recoit rien (obtenu ${res.enqueued})`);
  }
  {
    const deps = makeDeps({ suppressed: ['client@test.be'] });
    const { enqueueCampaign } = require('../lib/ops-communications');
    const res = await enqueueCampaign({
      centerId: 'libramont', campaignId: 43,
      recipients: [{ email: 'client@test.be', name: 'C' }, { email: 'garde@test.be', name: 'G' }],
      subject: 's', body: 'b', scheduledAt: iso(1), personalize: (t) => t, deps, enqueue: deps.enqueue,
    });
    ok(res.queued === 1 && res.skipped === 1, `campagne : 1 exclu, 1 garde (queued=${res.queued} skipped=${res.skipped})`);
    ok((deps.enqueued[0]?.recipient) === 'garde@test.be', 'campagne : seul le non-exclu est enfile');
  }
  // Ce bloc annonce « CHAQUE envoi marketing » : il n'en exercait que DEUX sur
  // quatre. Un libelle qui promet plus que ce qu'il verifie est un faux vert.
  {
    const deps = makeDeps({
      suppressed: ['dormant@test.be'],
      settings: { reactivation: { enabled: true } },
      clients: [{ client_key: '+32470222008', email: 'dormant@test.be', name: 'Dormant', last_visit: iso(-75) }],
    });
    const res = await runReactivationSweep('libramont', deps, { today: iso(0) });
    ok(res.enqueued === 0 && deps.enqueued.length === 0,
      `reactivation : l'adresse exclue ne recoit rien (obtenu ${res.enqueued})`);
  }
  {
    const sequence = {
      id: 'seqf', name: 'Relance', enabled: true, trigger: { type: 'inactive', days: 60 },
      subject: 'Coucou {{prenom}}', body: 'Bonjour {{prenom}}, revenez.', cap: 10, createdAt: iso(-1),
    };
    const deps = makeDeps({
      suppressed: ['custom@test.be'],
      settings: { custom_sequences: [sequence] },
      clients: [{ client_key: '+32470333009', email: 'custom@test.be', name: 'Custom' }],
    });
    await runCustomSequencesSweep('libramont', deps, { today: iso(0) });
    ok(deps.enqueued.length === 0,
      `sequence personnalisee : l'adresse exclue ne recoit rien (obtenu ${deps.enqueued.length} enfile)`);
  }

  // FAIL-CLOSED : si la liste est ILLISIBLE, aucun envoi marketing ne part.
  // Une premiere version rendait un Set vide sur erreur DB, donc une panne
  // passagere renvoyait a TOUTE l'audience, desinscrits compris. L'asymetrie
  // penche dans l'autre sens : un desinscrit qui recoit clique SPAM, et la
  // reputation du domaine tombe pour TOUS les mails, confirmations comprises.
  console.log('\n[FAIL-CLOSED] liste illisible : rien ne part');
  {
    const enfiles = [];
    const depsKO = {
      query: async (texte) => {
        if (String(texte).includes('marketing_suppressions')) throw new Error('connection terminated unexpectedly');
        return { rows: [] };
      },
      enqueue: async (row) => { enfiles.push(row.recipient); return { id: 1 }; },
    };
    const { enqueueCampaign } = require('../lib/ops-communications');
    let leve = null;
    try {
      await enqueueCampaign({
        centerId: 'libramont', campaignId: 44,
        recipients: [{ email: 'quelqu-un@test.be', name: 'Q' }],
        subject: 's', body: 'b', scheduledAt: iso(1), personalize: (t) => t,
        deps: depsKO, enqueue: depsKO.enqueue,
      });
    } catch (error) { leve = error; }
    ok(leve !== null, 'liste illisible : la campagne LEVE au lieu de partir a l aveugle');
    ok(enfiles.length === 0, `liste illisible : AUCUN destinataire enfile (obtenu ${enfiles.length})`);
    ok(leve && leve.expose === true, 'l erreur est exposable : le gerant comprend pourquoi son envoi ne part pas');
  }

  /* ═══ 3. TRANSACTIONNEL : lien de retrait ABSENT (rendu par le vrai gabarit) ═══ */
  console.log('\n[TRANSACTIONNEL] aucun lien de retrait, aucun en-tete, aucun mot de desabonnement');
  const TRANSACTIONNELS = ['confirmation', 'reminder_48h', 'request_received', 'post_visit'];
  const profil = {};
  let mesures = 0;
  for (const cle of TRANSACTIONNELS) {
    const rendu = await buildAutomationPreview('libramont', cle, {}, makeDeps({}));
    const liens = (rendu.html.match(/<a\s/gi) || []).length;
    const images = (rendu.html.match(/<img\s/gi) || []).length;
    const ko = Buffer.byteLength(rendu.html, 'utf8') / 1024;
    profil[cle] = { liens, images, ko: Number(ko.toFixed(2)) };
    mesures += 1;
    ok(!UNSUB_LINK.test(rendu.html), `${cle} : aucun lien /api/u`);
    ok(!DESAB.test(rendu.html), `${cle} : aucun signal de desabonnement`);
    ok(liens <= 2, `${cle} : au plus 2 liens (obtenu ${liens})`);
    ok(images <= 1, `${cle} : au plus 1 image (obtenu ${images})`);
    ok(ko < 102, `${cle} : ${ko.toFixed(1)} Ko sous le seuil Gmail`);
  }
  ok(mesures === TRANSACTIONNELS.length, `les ${TRANSACTIONNELS.length} transactionnels mesures (obtenu ${mesures})`);
  console.log('  profil transactionnel mesure :', JSON.stringify(profil));

  // Un DESIGN de centre (2026-09-16) avec logo, site et reseaux dans la
  // signature ajoute des liens et une image aux transactionnels. Ce n est pas
  // un signal de desabonnement, et la ligne de retrait reste reservee au
  // marketing : la separation ne depend pas du design choisi par le gerant.
  // Le profil epingle ci-dessus reste celui du design PAR DEFAUT.
  console.log('\n[DESIGN] un design avec logo et reseaux ne cree aucun signal de retrait sur le transactionnel');
  {
    const designComplet = {
      email_design: {
        preset: 'carte',
        accent: { mode: 'centre' },
        signature: {
          enabled: true,
          website: 'https://www.fungalaxy.be',
          logoUrl: '/assets/brand/logo-fun-galaxy-email-clair.png',
          socials: { facebook: 'https://www.facebook.com/fungalaxy', instagram: 'https://www.instagram.com/fungalaxy' },
        },
        signatureScope: { manual: true, sequences: true, campaigns: true },
      },
    };
    for (const cle of TRANSACTIONNELS) {
      const rendu = await buildAutomationPreview('libramont', cle, {}, makeDeps({ settings: designComplet }));
      const liens = (rendu.html.match(/<a\s/gi) || []).length;
      ok(liens >= 4 && /facebook\.com\/fungalaxy/.test(rendu.html) && /<img\s/.test(rendu.html),
        `${cle} avec design complet : la signature porte bien ses liens et son logo (obtenu ${liens} liens), le cas mesure quelque chose`);
      ok(!UNSUB_LINK.test(rendu.html) && !DESAB.test(rendu.html), `${cle} avec design complet : aucun lien /api/u, aucun signal de desabonnement`);
    }
    const deps = makeDeps({ settings: designComplet });
    const { enqueueCampaign } = require('../lib/ops-communications');
    await enqueueCampaign({
      centerId: 'libramont', campaignId: 45,
      recipients: [{ email: 'client@test.be', name: 'Client Test' }],
      subject: 'Nos nouveautes', body: 'Bonjour.', scheduledAt: iso(1), personalize: (t) => t,
      deps, enqueue: deps.enqueue,
    });
    const mail = deps.enqueued[0] || {};
    ok(UNSUB_LINK.test(mail.body || '') && /facebook\.com\/fungalaxy/.test(mail.body || ''), 'campagne avec design complet : la signature ET la ligne de retrait cohabitent');
  }

  // Chemin d'enfilement REEL : confirmation + rappel + demande recue.
  {
    const deps = makeDeps({});
    const captured = [];
    await enqueueReservationCommunications(
      { id: 501, centerId: 'libramont', name: 'Client Resa', email: 'resa@test.be', phone: '+32470999000', date: iso(5), startTime: '14:00', formuleId: 'bowling', pax: 6, validationStatus: 'confirmed' },
      { enqueue: async (row) => { captured.push(row); return { id: captured.length }; }, deps },
    );
    ok(captured.length > 0, `enqueueReservationCommunications : ${captured.length} mail(s) transactionnel(s) enfile(s)`);
    const anyUnsub = captured.some((row) => UNSUB_LINK.test(row.body || '') || row.payload?.unsubToken);
    ok(!anyUnsub, 'aucun mail transactionnel enfile ne porte de lien ni de jeton de retrait');
  }

  /* ═══ 4. EN-TETE List-Unsubscribe : marketing OUI, transactionnel NON ═══ */
  console.log('\n[EN-TETE] List-Unsubscribe pose sur marketing, absent sur transactionnel');
  {
    const savedKey = process.env.RESEND_API_KEY;
    const savedFetch = global.fetch;
    process.env.RESEND_API_KEY = 're_gate_test';
    let captured = null;
    global.fetch = async (url, opts) => {
      captured = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ id: 'gate' }) };
    };
    try {
      // Marketing : payload porte unsubToken.
      await __test.sendEmail({ recipient: 'm@test.be', subject: 's', body: '<html></html>', payload: { textBody: 't', unsubToken: 'a'.repeat(32) } });
      const mkHeaders = captured?.headers || {};
      ok(/^<https?:\/\/[^>]*\/api\/u\?k=a{32}>$/.test(mkHeaders['List-Unsubscribe'] || ''),
        `marketing : en-tete List-Unsubscribe present et bien forme (obtenu ${JSON.stringify(mkHeaders['List-Unsubscribe'])})`);
      ok(mkHeaders['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click',
        'marketing : List-Unsubscribe-Post=One-Click (RFC 8058, bouton natif de la messagerie)');

      // Transactionnel : aucun unsubToken.
      captured = null;
      await __test.sendEmail({ recipient: 't@test.be', subject: 's', body: '<html></html>', payload: { textBody: 't' } });
      const txHeaders = captured?.headers;
      ok(!txHeaders || !txHeaders['List-Unsubscribe'], `transactionnel : AUCUN en-tete List-Unsubscribe (obtenu ${JSON.stringify(txHeaders)})`);
    } finally {
      process.env.RESEND_API_KEY = savedKey;
      global.fetch = savedFetch;
    }
  }

  /* ═══ 5. JETON + ROUTE : deterministe, non devinable, jamais d'email en entree ═══ */
  console.log('\n[JETON] empreinte deterministe, non devinable, sans adresse en clair dans l\'URL');
  {
    const t1 = unsubscribeToken('libramont', 'a@test.be');
    const t2 = unsubscribeToken('libramont', 'a@test.be');
    const t3 = unsubscribeToken('libramont', 'b@test.be');
    const t4 = unsubscribeToken('arlon', 'a@test.be');
    ok(TOKEN_RX.test(t1), `jeton = 32 hex (128 bits) (obtenu ${t1})`);
    ok(t1 === t2, 'meme (centre, adresse) -> meme jeton (stable, rien a stocker a l avance)');
    ok(t1 !== t3, 'adresse differente -> jeton different');
    ok(t1 !== t4, 'centre different -> jeton different (le retrait est scope au centre)');

    const built = buildUnsubscribe('libramont', 'a@test.be');
    ok(built.url.includes(`/api/u?k=${t1}`), 'l URL ne contient que le jeton opaque');
    ok(!built.url.toLowerCase().includes('a%40test.be') && !built.url.includes('a@test.be'),
      'l URL ne contient JAMAIS l adresse (ni en clair ni encodee)');

    // Secret absent -> aleatoire (non devinable), mais l URL reste valide car
    // le jeton est stocke a l envoi.
    const savedSecret = process.env.UNSUBSCRIBE_SECRET;
    delete process.env.UNSUBSCRIBE_SECRET;
    const r1 = unsubscribeToken('libramont', 'a@test.be');
    const r2 = unsubscribeToken('libramont', 'a@test.be');
    ok(TOKEN_RX.test(r1) && r1 !== r2, 'sans secret : jeton aleatoire par envoi (jamais de repli devinable)');
    process.env.UNSUBSCRIBE_SECRET = savedSecret;
  }

  console.log('\n[ROUTE] la resolution lit le stockage, jamais la requete');
  {
    // Jeton mal forme -> null sans aucune requete (pas d oracle).
    let queried = 0;
    const depsBad = { query: async () => { queried += 1; return { rows: [] }; } };
    const bad = await resolveUnsubscribeToken('pas-un-jeton', depsBad);
    ok(bad === null && queried === 0, 'jeton mal forme -> null, aucune requete emise');

    // Jeton valide -> centre+adresse viennent de la LIGNE STOCKEE (recipient),
    // jamais d une entree exterieure.
    const depsGood = { query: async () => ({ rows: [{ center_id: 'libramont', recipient: 'STORED@test.be' }] }) };
    const good = await resolveUnsubscribeToken('a'.repeat(32), depsGood);
    ok(good && good.email === 'stored@test.be' && good.centerId === 'libramont',
      `resolution depuis le stockage (obtenu ${JSON.stringify(good)})`);
  }

  console.log('\n[PAGE] un jeton invalide ne revele aucune adresse');
  {
    const invalid = renderUnsubscribePage({ state: 'invalid', email: 'secret@test.be', token: 'a'.repeat(32) });
    ok(!invalid.includes('secret@test.be'), 'page « lien invalide » : l adresse n est jamais affichee');
    const removed = renderUnsubscribePage({ state: 'removed', email: 'ok@test.be', token: 'a'.repeat(32) });
    ok(removed.includes('ok@test.be'), 'page « c est fait » : l adresse confirmee est affichee');
    ok(/method="post"/i.test(removed) && /resubscribe/.test(removed), 'le retour en arriere est un POST (pas de GET qu un scanner declenche)');
  }

  /* ═══ 6. LA ROUTE PUBLIQUE, pilotee pour de vrai (api/u.js) ═══
     Les fonctions d'acces DB sont remplacees AVANT le require de la route :
     api/u.js les destructure au chargement, donc il recoit les doublures. Le
     rendu de page, lui, reste le vrai. On observe ce que la route DEMANDE
     d'ecrire, pas ce qu'elle a l'air d'ecrire. */
  console.log('\n[ROUTE PUBLIQUE] api/u.js : ce qui est ecrit vient du stockage, jamais de l URL');
  {
    const suppression = require('../lib/marketing-suppression');
    const calls = [];
    const VALID = 'b'.repeat(32);
    suppression.resolveUnsubscribeToken = async (token) => (String(token) === VALID
      ? { centerId: 'libramont', email: 'route@test.be' }
      : null);
    suppression.suppressEmail = async (args) => { calls.push({ op: 'suppress', ...args }); return { ok: true }; };
    suppression.removeSuppression = async (args) => { calls.push({ op: 'remove', ...args }); return { ok: true }; };
    const handler = require('../api/u');

    let ip = 0;
    const fakeReq = (method, url, body = '') => ({
      method,
      url,
      headers: { host: 'gate.test', 'x-forwarded-for': `10.0.0.${(ip += 1)}` },
      socket: {},
      on(event, cb) { if (event === 'data' && body) cb(body); if (event === 'end') cb(); return this; },
      destroy() {},
    });
    const fakeRes = () => {
      const res = { statusCode: 200, headers: {}, body: '' };
      res.setHeader = (k, v) => { res.headers[k] = v; };
      res.end = (b) => { res.body = String(b || ''); };
      return res;
    };

    // 6a. Jeton inconnu : page neutre, AUCUNE ecriture.
    calls.length = 0;
    let res = fakeRes();
    await handler(fakeReq('GET', '/api/u?k=' + 'c'.repeat(32)), res);
    ok(calls.length === 0, `jeton inconnu : aucune ecriture declenchee (obtenu ${calls.length})`);
    ok(/expire ou inconnu/i.test(res.body), 'jeton inconnu : message neutre rendu');
    ok(!res.body.includes('route@test.be'), 'jeton inconnu : aucune adresse affichee');

    // 6b. Jeton valide : ecriture scopee au centre resolu.
    calls.length = 0;
    res = fakeRes();
    await handler(fakeReq('GET', `/api/u?k=${VALID}`), res);
    ok(calls.length === 1 && calls[0].op === 'suppress', 'jeton valide : une inscription en liste');
    ok(calls[0].centerId === 'libramont' && calls[0].email === 'route@test.be',
      `l ecriture porte le centre et l adresse du STOCKAGE (obtenu ${JSON.stringify({ c: calls[0].centerId, e: calls[0].email })})`);
    ok(res.body.includes('route@test.be'), 'la page confirme l adresse retiree');

    // 6c. LA SECURITE QUI COMPTE : une adresse glissee dans l URL est ignoree.
    // Sans cette garantie, la route devient un outil pour desinscrire n importe
    // qui, et un oracle pour tester quelles adresses existent.
    calls.length = 0;
    res = fakeRes();
    await handler(fakeReq('GET', `/api/u?k=${VALID}&email=victime@autre.be&centerId=arlon`), res);
    ok(calls.length === 1 && calls[0].email === 'route@test.be',
      `adresse de l URL IGNOREE : ecrit ${JSON.stringify(calls[0] && calls[0].email)}, attendu "route@test.be" (jamais "victime@autre.be")`);
    ok(calls[0].centerId === 'libramont',
      `centre de l URL IGNORE : ecrit ${JSON.stringify(calls[0] && calls[0].centerId)}, attendu "libramont" (jamais "arlon")`);
    ok(!res.body.includes('victime@autre.be'), 'l adresse de l URL n est jamais renvoyee dans la page');

    // 6d. POST one-click (RFC 8058) : le bouton natif de la messagerie.
    calls.length = 0;
    res = fakeRes();
    await handler(fakeReq('POST', `/api/u?k=${VALID}`, 'List-Unsubscribe=One-Click'), res);
    ok(calls.length === 1 && calls[0].op === 'suppress', 'POST one-click : inscription en liste');
    ok(res.body === 'OK' && res.statusCode === 200, `POST one-click : 200 court (obtenu ${res.statusCode} ${JSON.stringify(res.body)})`);

    // 6e. POST resubscribe : le retour en arriere depuis la page.
    calls.length = 0;
    res = fakeRes();
    await handler(fakeReq('POST', `/api/u?k=${VALID}`, 'a=resubscribe'), res);
    ok(calls.length === 1 && calls[0].op === 'remove', 'POST resubscribe : retrait de la liste');
    ok(calls[0].centerId === 'libramont' && calls[0].email === 'route@test.be', 'le retour en arriere est scope au meme centre');

    // 6f. Methode refusee.
    res = fakeRes();
    await handler(fakeReq('DELETE', `/api/u?k=${VALID}`), res);
    ok(res.statusCode === 405, `methode non prevue -> 405 (obtenu ${res.statusCode})`);
  }

  if (failures) { console.error(`\nunsubscribe-separation-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nunsubscribe-separation-check: ALL OK');
})().catch((e) => { console.error('unsubscribe-separation-check CRASH:', e.stack || e.message); process.exit(1); });
