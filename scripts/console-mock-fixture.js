// UNE CONSOLE SANS SERVEUR : session staff, etat, API de lecture, tout servi dans la page. Ne gardait
// que le gate de l ancien Bureau Marketing ; il reste pour le gate de la politique de contenu.
'use strict';

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const dstr = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
    // UN SERVEUR NE CHANGE PAS D ETAG QUAND RIEN N A BOUGE. La console lit
    // l ETag avant payload.revision et re-rend des qu il change : un etag
    // horodate faisait re-rendre la console A CHAQUE SONDAGE, et un re-rendu qui
    // tombe pendant un geste detruit la carte tiree ou remet le defilement a
    // zero. Le vrai /api/staff-state pose ETag = snapshot.revision : ici l etag
    // est l empreinte du contenu servi, meme contenu donc meme etag.
    const J = (p) => {
      const corps = JSON.stringify(p);
      let h = 0;
      for (let i = 0; i < corps.length; i += 1) h = (h * 31 + corps.charCodeAt(i)) | 0;
      return new Response(corps, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${(h >>> 0).toString(36)}` } });
    };
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    const nf = window.fetch.bind(window);
    window.__QA_POSTS__ = [];
    window.__QA_ASKS__ = [];
    window.__QA_ROI_CALLS__ = [];
    window.__QA_BRIEF_CENTERS__ = [];
    // Les creations du gerant VIVENT : un propositionCreate reapparait dans le
    // brief suivant, comme en prod (insert en base -> refetch). Sans ca, le
    // test de l'arrivee animee dans « A valider » serait infalsifiable.
    window.__QA_CREATED__ = [];

    const briefBundle = (centerId) => {
      if (centerId === 'gembloux') {
        // Un centre DIFFERENT rend un brief DIFFERENT : c'est la preuve de
        // scope de la section [CENTRE]. Marqueur textuel unique.
        return {
          ok: true, centerId: 'gembloux', today: dstr(0), generatedAt: new Date().toISOString(),
          networks: ['facebook', 'instagram', 'story'],
          paie: { euros: 0, venues: 0, sent: 0, reviewClicks: 0, days: 30, young: true, quietWindow: false, firstVerdictDate: 'mardi 25 août', sources: [] },
          brief: { text: 'Brief de Gembloux : semaine tranquille, rien d\'urgent, je garde un oeil sur tes réservations.', degraded: false },
          pulse: { revenue30: 0, visitors30: 0, avgBasket: 0, upcomingPax: 0, upcomingResa: 0, reservedRevenue: 0, bestDay: null },
          radar: Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return { date: d.toISOString().slice(0, 10), dow: d.getDay(), level: 'normal', tmax: 18, precipMm: 0, event: '', resaCount: 0, explanation: 'Journée normale attendue.', propositionKey: null }; }),
          dataDays: 8, medianVisitors: 0,
          facts: { bestDay: null, worstDay: null, weather: null, holidayEffectPct: null, holidayEffectConfidence: null, trend4w: null, bestMonth: null },
          patterns: [], propositions: [], receipts: [],
          veille: { count: 0, changed: [] },
        };
      }
      const radar = Array.from({ length: 14 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() + i);
        const date = d.toISOString().slice(0, 10);
        const level = i === 4 ? 'creux' : i === 6 ? 'fort' : (i === 9 ? 'calme' : 'normal');
        return { date, dow: d.getDay(), level, tmax: i === 2 ? 27 : 19, precipMm: i === 3 ? 12 : 0,
          event: i === 8 ? 'Foire de Libramont (à 5 min)' : '', resaCount: i === 6 ? 34 : (i === 0 ? 6 : 0),
          explanation: level === 'creux' ? `Jour ${date.slice(8, 10)} : très calme attendu, jour structurellement faible. Rien de posé.` : (level === 'calme' ? `Jour ${date.slice(8, 10)} : calme attendu, rien de posé.` : `Jour ${date.slice(8, 10)} : journée normale attendue.`),
          propositionKey: i === 4 ? 'plan:social-1' : null };
      });
      return {
        ok: true, centerId: 'libramont', today: dstr(0), generatedAt: new Date().toISOString(),
        networks: ['facebook', 'instagram', 'story'],
        paie: { euros: 1240, venues: 5, sent: 17, reviewClicks: 4, days: 30, young: false, quietWindow: false, firstVerdictDate: 'mardi 28 juillet',
          sources: [{ key: 'birthday_j30', label: 'Anniversaires', sent: 12, conversions: 3, revenue: 770 }, { key: 'relance', label: 'Relances', sent: 5, conversions: 2, revenue: 470 }] },
        brief: { text: 'Dimanche s\'annonce très calme, pluie annoncée, hors vacances. Je t\'ai préparé 2 posts et un email, tout est prêt plus bas. Du mouvement chez Bowling Arlon ce matin, détail dans l\'onglet Concurrents.', degraded: false },
        pulse: { revenue30: 8334, visitors30: 540, avgBasket: 15.4, upcomingPax: 102, upcomingResa: 5, reservedRevenue: 2864, bestDay: { date: '2026-07-11', revenue: 4009, visitors: 234 } },
        radar, dataDays: 210, medianVisitors: 40,
        facts: {
          bestDay: { dow: 6, label: 'samedi', avgVisitors: 128, vsMedianPct: 121, confidence: 'solide' },
          worstDay: { dow: 2, label: 'mardi', avgVisitors: 34, vsMedianPct: -41, confidence: 'solide' },
          weather: { rainEffectPct: 12, heatEffectPct: -8, confidence: 'solide', sampleDays: 210 },
          holidayEffectPct: -6, holidayEffectConfidence: 'signal', trend4w: { pct: 9 }, bestMonth: null,
        },
        patterns: [
          { context: 'Post FB · événement local', kind: 'post', channel: 'facebook', netDeltaPct: 22, basis: 'net', n: 3, confidence: 'signal' },
          { context: 'Email · jour calme', kind: 'email', channel: 'email', netDeltaPct: 14, basis: 'brut', n: 4, confidence: 'signal' },
        ],
        propositions: [
          { key: 'daily', id: null, trigger: 'pluie', why: 'Pluie annoncée samedi, les familles vont chercher un plan au sec.', whyShort: 'Pluie annoncée samedi, les familles vont chercher un plan au sec.', dueDate: dstr(0), kind: 'post', pinned: true, network: 'instagram', networks: { instagram: { text: 'Il pleut samedi ? Nos 8 pistes sont au sec, réserve la tienne.\n\n#bowling #libramont' } }, photoIdea: 'arrivée du groupe sous la pluie, strike final', imagePrompt: 'Rainy day bowling, no text, no logos', bestSlot: '17h-19h', status: 'proposed', signature: 'daily:x',
            // La tracabilite figee a la proposition : valeur, volume,
            // derivation. Le gerant doit pouvoir refaire le calcul.
            faits: [{ id: 'creneau_creux', valeur: '11 h : 9 reservations', observations: 9, calcul: 'groupe par heure de start_time, minimum 8 observations', autres: '' }] },
          { key: 'plan:social-1', id: null, trigger: 'creux', why: 'Dimanche s\'annonce très calme : 12 visiteurs attendus. Je posterais mercredi pour le remplir.', whyShort: 'Dimanche s\'annonce très calme, je posterais mercredi pour le remplir.', dueDate: dstr(2), targetDate: dstr(4), kind: 'post', pinned: false, network: 'facebook', networks: {}, photoIdea: '', imagePrompt: '', bestSlot: '', status: 'proposed', signature: 'plan:social-1' },
          { key: 'db:21', id: 21, trigger: 'concurrent', why: 'Bowling Arlon a lancé une offre étudiants, on répond ?', whyShort: 'Bowling Arlon a lancé une offre étudiants, on répond ?', dueDate: dstr(1), kind: 'post', pinned: false, network: 'facebook', networks: { facebook: { text: 'Chez nous, pas besoin de carte étudiant pour passer une bonne soirée. 8 pistes, laser game, arcades.\n\n#bowling' } }, photoIdea: '', imagePrompt: '', bestSlot: '18h', status: 'proposed', signature: 'concurrent:x' },
          { key: 'db:22', id: 22, trigger: 'demande', why: 'Tu m\'as demandé : « soirée fluo », voilà ce que je posterais.', whyShort: 'Tu m\'as demandé : « soirée fluo », voilà ce que je posterais.', dueDate: dstr(3), kind: 'post', pinned: false, network: 'facebook', networks: { facebook: { text: 'Soirée fluo samedi.' } }, photoIdea: '', imagePrompt: '', bestSlot: '', status: 'proposed', signature: 'demande:x' },
          // Hygiène de file (bug prod 17/07) : une consigne PÉRIMÉE et un
          // DOUBLON mot pour mot injectés exprès : ils ne doivent JAMAIS
          // s'afficher (le serveur filtre désormais, le front reste le filet).
          { key: 'db:97', id: 97, trigger: 'evenement', why: 'PERIME ne doit pas apparaitre.', whyShort: 'PERIME ne doit pas apparaitre.', dueDate: dstr(-2), kind: 'post', pinned: false, network: 'facebook', networks: {}, photoIdea: '', imagePrompt: '', bestSlot: '', status: 'proposed', signature: 'perime:x' },
          { key: 'db:96', id: 96, trigger: 'chaleur', why: 'JOURVISEPASSE ne doit pas apparaitre.', whyShort: 'JOURVISEPASSE ne doit pas apparaitre.', dueDate: null, targetDate: dstr(-1), kind: 'post', pinned: false, network: 'facebook', networks: {}, photoIdea: '', imagePrompt: '', bestSlot: '', status: 'proposed', signature: 'vise:x' },
          { key: 'db:98', id: 98, trigger: 'pluie', why: 'Pluie annoncée samedi, les familles vont chercher un plan au sec.', whyShort: 'Pluie annoncée samedi, les familles vont chercher un plan au sec.', dueDate: dstr(1), kind: 'post', pinned: false, network: 'facebook', networks: {}, photoIdea: '', imagePrompt: '', bestSlot: '', status: 'proposed', signature: 'doublon:x' },
          ...window.__QA_CREATED__,
        ],
        // UNE PISTE, telle que lib/marketing-brief.js la rend : un sujet, un
        // pourquoi chiffre, et AUCUN texte a publier. Elle ne doit jamais
        // apparaitre dans la file des posts, et elle doit se voir quand meme.
        pistes: [
          { id: 501, sujet: 'le minimum des anniversaires', pourquoi: 'concerne 42 sur 500 (8.4 %) | en jeu 51304 EUR | oui : 2 et 6 personnes coexistent deja au catalogue', proposeeLe: dstr(-1) },
        ],
        receipts: [
          { id: 31, label: 'Post pluie du 03/07', tone: 'good', result: '+18 % de monde', redoable: true },
          { id: 32, label: 'Email réactivation du 25/06', tone: 'neutral', result: 'pas d\'effet mesurable', redoable: false },
          { id: 33, label: 'Post soirée fluo du 12/07', tone: 'pending', result: 'verdict le 26 juillet', redoable: false },
        ],
        veille: { count: 2, changed: [{ name: 'Bowling Arlon', diff: 'Nouvelle offre étudiants le mercredi.' }] },
      };
    };

    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const m = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: lanes(), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/marketing-agents') return J({ ok: true, centers: [], updatedAt: new Date().toISOString() });
      if (u.pathname === '/api/ops' && m === 'POST') {
        const b = JSON.parse(init.body || '{}');
        window.__QA_POSTS__.push(b);
        if (b.action === 'propositionAction') {
          if (b.propAction === 'variante' || b.propAction === 'autre_angle') {
            return J({ ok: true, result: { ok: true, id: 88, network: b.network || 'facebook', entry: { text: `Texte ${b.network || 'facebook'} fraichement écrit${b.angle ? ' (angle: ' + b.angle + ')' : ''}.`, photoIdea: 'photo test', imagePrompt: 'prompt test, no text, no logos', bestSlot: '18h' } } });
          }
          return J({ ok: true, result: { ok: true, id: b.id || 88, status: b.propAction === 'publiee' ? 'publiee' : 'refusee' } });
        }
        if (b.action === 'propositionCreate') {
          const id = 990 + window.__QA_CREATED__.length;
          const brief = String(b.brief || '').trim();
          const why = b.trigger === 'creux' && b.targetDate
            ? `Vous m'avez demandé de remplir le ${b.targetDate} : voilà ce que je posterais.`
            : `Vous m'avez demandé : « ${brief} », voilà ce que je posterais.`;
          window.__QA_CREATED__.push({ key: `db:${id}`, id, trigger: b.trigger === 'creux' ? 'creux' : 'demande', why, whyShort: why, dueDate: dstr(1), kind: 'post', pinned: false, network: 'facebook', networks: { facebook: { text: `Post prêt : ${brief || b.targetDate}.` } }, photoIdea: '', imagePrompt: '', bestSlot: '', status: 'proposed', signature: `qa:${id}` });
          return J({ ok: true, result: { ok: true, id } });
        }
        // « Demander » : le serveur REPOND (lib/marketing-ask). Ce mock n'est pas
        // un generateur de phrases : il lit le MEME brief que la page et rend une
        // reponse construite depuis ses donnees reelles. Une reponse fabriquee de
        // toutes pieces ici prouverait que le fil s'affiche, pas qu'il est ancre.
        if (b.action === 'marketingAsk') {
          window.__QA_ASKS__.push(b);
          const q = String(b.question || '').toLowerCase();
          const bundle = briefBundle(b.centerId || 'libramont');
          // Un appel modele n'est JAMAIS instantane (Kimi : 2 a 5 s en reel).
          // Un mock qui repond en 0 ms rendrait infalsifiable tout ce que la
          // page montre PENDANT l'attente : les etapes de travail, la bulle du
          // gerant qui entre seule, l'etat qui meurt avec la reponse.
          await new Promise((r) => setTimeout(r, 400));
          // Le cas degrade : le serveur a REFUSE la reponse du modele (elle
          // citait une donnee que le centre n'a pas). Le navigateur doit
          // reprendre son chemin deterministe ET le dire.
          if (/fluo interdit/.test(q)) return J({ ok: true, grounded: false, reason: 'bloque', blockers: ['activite ou promesse absente du centre : karting'] });
          // Une question sur UN jour : la reponse est ancree sur la ligne de
          // radar de ce jour-la (son explication, ce qui est deja pose) et sur
          // le panier moyen mesure. `jourVise` est la date du radar : c'est elle
          // qui fait naitre la carte rattachee au bon jour.
          const asked = q.match(/(\d{1,2})\/(\d{1,2})/);
          const day = asked
            ? (bundle.radar || []).find((d) => d.date.slice(5) === `${asked[2].padStart(2, '0')}-${asked[1].padStart(2, '0')}`)
            : null;
          if (day) {
            return J({ ok: true, grounded: true, provider: 'kimi', model: 'kimi-k2.6',
              answer: {
                titre: `Ce que je vois pour le ${day.date.slice(8, 10)}/${day.date.slice(5, 7)}`,
                reponse: `${day.explanation} Votre panier moyen mesuré est de ${bundle.pulse.avgBasket} €, donc chaque personne ramenée ce jour-là vaut ce montant.`,
                faits: [`${day.resaCount} personnes déjà posées`, `panier moyen mesuré : ${bundle.pulse.avgBasket} €`],
                jeNeSaisPas: [],
                action: 'creer_post',
                jourVise: day.date,
              },
              basis: { joursMesures: bundle.dataDays, joursRadar: bundle.radar.length, formules: 14, activites: 8, concurrents: bundle.veille.count } });
          }
          const rival = (bundle.veille.changed || [])[0];
          if (rival && q.includes(String(rival.name).toLowerCase())) {
            return J({ ok: true, grounded: true, provider: 'kimi', model: 'kimi-k2.6',
              answer: {
                titre: `Ce que fait ${rival.name}`,
                reponse: `${rival.name} : ${rival.diff} Ton panier moyen est de ${bundle.pulse.avgBasket} €, donc reponds sur l'ambiance plutot que sur le prix.`,
                faits: [`${rival.name} : ${rival.diff}`, `panier moyen mesure : ${bundle.pulse.avgBasket} €`],
                jeNeSaisPas: [],
                action: 'ouvrir_marche',
              },
              basis: { joursMesures: bundle.dataDays, joursRadar: bundle.radar.length, formules: 14, activites: 8, concurrents: bundle.veille.count } });
          }
          // Hors perimetre : le modele DIT qu'il ne sait pas au lieu d'inventer.
          return J({ ok: true, grounded: true, provider: 'kimi', model: 'kimi-k2.6',
            answer: {
              titre: 'Ce n\'est pas mon sujet',
              reponse: 'Je ne reponds que sur votre centre et son marketing : frequentation, jours a remplir, concurrents, ce que vos messages rapportent.',
              faits: [],
              jeNeSaisPas: ['Cette question sort de ce que je connais du centre : je n\'ai aucune donnee la-dessus.'],
              action: 'aucune',
            },
            basis: { joursMesures: bundle.dataDays, joursRadar: bundle.radar.length, formules: 14, activites: 8, concurrents: bundle.veille.count } });
        }
        if (b.action === 'insightRedo') return J({ ok: true, insight: { id: 99, status: 'proposed' } });
        if (b.action === 'planActionDone') return J({ ok: true, result: { ok: true, id: 55, status: 'applied' } });
        if (b.action === 'competitorSave') return J({ ok: true, result: { ok: true, id: 2 } });
        if (b.action === 'competitorDelete') return J({ ok: true, result: { ok: true, id: 1 } });
        if (b.action === 'competitorAnalyzePost') return J({ ok: true, degraded: false, resume: 'Ils poussent une offre étudiants le mercredi.', offre: 'Mercredi étudiant -30%', prix: '9 €', ton: 'promo prix', riposte: 'Mets en avant ton ambiance et tes anniversaires plutôt que le prix.', adn: [{ nom: 'creneau precis', regle: 'Annoncer un créneau précis rend l\'offre concrète.' }, { nom: 'urgence datee', regle: 'Une échéance datée déclenche la décision.' }], dnaLearned: 2 });
        if (b.action === 'studioGenerate') return J({ ok: true, pack: { platform: b.platform, theme: 'Foire de Libramont', generationMode: 'ai', long: `Post ${b.platform} complet pour le test.`, short: `Court ${b.platform}.`, story: 'Story test.', photoIdea: 'Filmer un strike.', aiImagePrompt: 'Bowling scene, no text, no logos', hashtags: ['#bowling', '#test'], bestTime: '18h', quality: { score: 86, status: 'ready', iterations: [{ mode: 'rules', score: 84 }, { mode: 'ai_1', score: 86, blocked: false }] } } });
        if (b.action === 'marketingPlanGet' || b.action === 'marketingPlanBuild') {
          const monday = (() => { const d = new Date(); const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); return d; })();
          const w = (offset) => { const from = new Date(monday); from.setDate(from.getDate() + offset * 7); const to = new Date(from); to.setDate(to.getDate() + 6); return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }; };
          return J({ ok: true, planId: 7, status: 'proposed', plan: {
            mode: 'ai', centerId: 'libramont', generatedAt: new Date().toISOString(),
            context: { hasMeasuredEvidence: false, patternsSolides: 0, semainesRejetees: 0, motifsRejet: [] },
            weeks: [
              { index: 1, ...w(0), confiance: 'calendrier', objectif: 'Remplir les journees des vacances', pourquoi: "Vacances d'ete : les enfants sont libres en journee.", actions: ['Un post formules famille'], faits: [{ type: 'conge_scolaire', label: "Vacances d'ete 2026" }] },
              { index: 2, ...w(1), confiance: 'calendrier', objectif: 'Capter le flux de la Foire', pourquoi: 'Foire de Libramont du 24 au 27, a 5 minutes.', actions: ['Un post avant', 'Un rappel le jour fort'], faits: [{ type: 'evenement_local', label: 'Foire de Libramont' }] },
              { index: 3, ...w(2), confiance: 'routine', objectif: 'Le fond de commerce : anniversaires et groupes', pourquoi: "Aucun evenement ni conge date cette semaine.", actions: ['Un post anniversaire enfant'], faits: [] },
            ],
          } });
        }
        // Leçon du mock complaisant (journal 93) : une action que le serveur ne
        // connaît pas reçoit une ERREUR, jamais un ok de complaisance.
        return J({ ok: false, error: `Action Ops inconnue du mock : ${b.action}` });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'marketingBrief') {
        const centerId = u.searchParams.get('centerId') || 'libramont';
        window.__QA_BRIEF_CENTERS__.push(centerId);
        return J(briefBundle(centerId));
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'studioPacks') return J({ ok: true, packs: { facebook: null, instagram: null, tiktok: null, linkedin: null } });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'marketingRoi') {
        window.__QA_ROI_CALLS__.push(u.searchParams.get('days'));
        return J({ ok: true, centerId: 'libramont', days: Number(u.searchParams.get('days')) || 30, sent: 9, conversions: 2, revenue: 380, reviewClicks: 1, bySource: [{ key: 'relance', label: 'Relances', sent: 9, conversions: 2, revenue: 380 }] });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'competitors') {
        return J({ ok: true, competitors: [{ id: 1, name: 'Bowling Arlon', websiteUrl: 'https://bowlingarlon.be', instagramHandle: '', notes: '', enabled: true, lastCheckedAt: '2026-07-17T02:00:00Z', lastDiff: 'Nouvelle offre étudiants le mercredi.', rating: 4.2, reviewsCount: 210, placeId: 'ChIJxyz', placesCheckedAt: '2026-07-17T02:00:00Z', signals: [{ type: 'offre', label: 'Mercredi étudiant', price: '9 €' }, { type: 'anniversaire', label: 'Formule anniversaire', price: '12 €/enfant' }] }] });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'listCampaigns') return J({ ok: true, campaigns: [], segments: [{ id: 'all', label: 'Tous les clients' }], channel: {} });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], insights: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { '0': { open: '10:00', close: '22:00' }, '1': null, '2': { open: '14:00', close: '22:00' }, '3': { open: '12:00', close: '22:00' }, '4': { open: '14:00', close: '22:00' }, '5': { open: '14:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      return nf(input, init);
    };
    // Trace de requete du mock : les en-tetes seuls ne terminent pas la lecture.
    // Le gate attend le corps consomme ET le nouveau tour rendu par l'UI.
    window.__QA_ASK_REQUESTS__ = [];
    const mockFetch = window.fetch;
    window.fetch = async (input, init = {}) => {
      let body;
      try { body = JSON.parse(init.body || '{}'); } catch (error) { body = {}; }
      if (body.action !== 'marketingAsk') return mockFetch(input, init);
      const request = { id: window.__QA_ASK_REQUESTS__.length + 1, question: body.question, centerId: body.centerId, status: 'pending' };
      window.__QA_ASK_REQUESTS__.push(request);
      try {
        const response = await mockFetch(input, init);
        for (const method of ['text', 'json']) {
          const read = response[method].bind(response);
          response[method] = async () => {
            try { const result = await read(); request.status = 'complete'; return result; }
            catch (error) { request.status = 'failed'; throw error; }
          };
        }
        return response;
      } catch (error) { request.status = 'failed'; throw error; }
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });
}

let failures = 0;

module.exports = { installMock };
