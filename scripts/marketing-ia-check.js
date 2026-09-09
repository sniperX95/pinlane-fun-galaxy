// Test INTERACTIF du BUREAU Marketing (refonte 2026-08-06, voir
// MARKETING-AGENT-DESIGN.md) : le fil de l'agent (brief + radar integre +
// propositions en tours + reponses assemblees), le composer a DEUX MODES
// (Demander = reponse locale sourcee, Creer = propositionCreate reel), le
// tableau d'actions (A valider / En cours / A surveiller, calme quand vide,
// entree animee d'une action neuve), les deep-links avec intention (veille ->
// Marche avec le concurrent surligne), et LE CENTRE QUI GOUVERNE (bascule de
// centre = remise a zero prouvee). Les profondeurs gardent leurs preuves :
// Plan (poignees planActionDone, honnetete), Creations (badge note+mode,
// fabrication reelle), Marche (veille honnete, ADN retenu), Impact (heros
// euros seul exemplaire, recus, verdicts, memoire par contexte).
// Playwright pilote de VRAIS clics ; chaque section porte sa contre-preuve.
// Cf. lecon ship-interactive-ui-tested + lecon du mock complaisant (entree 93
// du journal) : ce mock REFUSE les actions inconnues au lieu de les tolerer.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_MK_PORT || 4213);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const dstr = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
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
            ? `Tu m'as demandé de remplir le ${b.targetDate} : voilà ce que je posterais.`
            : `Tu m'as demandé : « ${brief} », voilà ce que je posterais.`;
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
                reponse: `${day.explanation} Ton panier moyen mesuré est de ${bundle.pulse.avgBasket} €, donc chaque personne ramenée ce jour-là vaut ce montant.`,
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
              reponse: 'Je ne reponds que sur ton centre et son marketing : frequentation, jours a remplir, concurrents, ce que tes messages rapportent.',
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
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  const go = async (tab) => { await page.evaluate((t) => window.mkwTab(t), tab); await page.waitForTimeout(300); };
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=mkw-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      state.staffMenuPage = 'campaigns'; state.staffTheme = 'dark';
      save(); setView('staff'); renderStaff();
    });
    // LE BUREAU : fil + tableau + composer, radar 14 cellules DANS le fil.
    await page.waitForFunction(() => document.querySelector('#staffCampaignsPage .mkw-desk .mkw-chat') && document.querySelector('#mkwSheet .mkw-panel') && document.querySelector('#staffCampaignsPage .mkw-composer'), null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('#mkwSheet .mkw-mini').length >= 14, null, { timeout: 15000 });
    await page.waitForTimeout(400);

    // Captures optionnelles (PINLANE_MK_SHOTS=<dossier>) : REGARDER le chat
    // au lieu de le deviner, meme harnais que les gates emails et crm.
    if (process.env.PINLANE_MK_SHOTS) {
      const shotDir = process.env.PINLANE_MK_SHOTS;
      fs.mkdirSync(shotDir, { recursive: true });
      for (const theme of ['dark', 'light']) {
        await page.evaluate((t) => { setStaffTheme(t); }, theme);
        await page.waitForTimeout(450);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.waitForTimeout(250);
        await page.screenshot({ path: require('path').join(shotDir, `marketing-${theme}-desktop.png`), fullPage: false });
        await page.setViewportSize({ width: 390, height: 844 });
        // L'etat mobile REEL : charge en 390 px, le panneau demarre ferme
        // (la conversation d'abord) ; on reproduit cet etat avant la capture.
        await page.evaluate(() => { window.mkw.panelOpen = false; window.renderStaffCampaignsPage(); });
        await page.waitForTimeout(300);
        await page.screenshot({ path: require('path').join(shotDir, `marketing-${theme}-mobile.png`), fullPage: false });
        await page.evaluate(() => { window.mkw.panelOpen = true; window.renderStaffCampaignsPage(); });
      }
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.evaluate(() => { setStaffTheme('dark'); });
      await page.waitForTimeout(300);
      console.log(`[SHOTS] captures ecrites dans ${shotDir}`);
    }

    console.log('\n[HYGIENE] le chat : identite en une ligne, zero rail, zero theatre, zero jargon');
    let allText = '';
    for (const tab of ['feed', 'plan', 'studio', 'rivals', 'results']) {
      await go(tab);
      allText += ' ' + await page.evaluate(() => (document.getElementById('staffCampaignsPage').textContent || '').toLowerCase());
    }
    await go('feed');
    const banned = ['attribution', 'last-touch', 'baseline', 'médiane', 'itération', 'insight', 'proposition volatile', 'signature'].filter((word) => allText.includes(word));
    const hygiene = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      return {
        nav: [...root.querySelectorAll('.mkw-head-nav .mkw-head-link')].map((el) => el.textContent.trim()),
        rail: root.querySelectorAll('.mkw-rail, .mkw-rail-link, .mkw-rail-home').length,
        toggle: Boolean(root.querySelector('.mkw-head-nav .mkw-panel-toggle')),
        theatre: root.querySelectorAll('.mkw-turn-avatar, .mkw-bubble, .mkw-thinking, .mkw-fold, .mkw-suggest, .mkw-cmd-bar, .mkw-turn-brief').length,
        desk: Boolean(root.querySelector('.mkw-desk .mkw-chat') && document.querySelector('#mkwSheet .mkw-panel') && root.classList.contains('mkw-has-panel')),
        modes: [...root.querySelectorAll('.mkw-modes .mkw-mode')].map((el) => el.textContent.trim()),
        title: (root.querySelector('.mkw-head-title') || {}).textContent || '',
        desc: (root.querySelector('.mkw-head-desc') || {}).textContent || '',
        refresh: [...root.querySelectorAll('button')].filter((el) => /actualiser|analyser maintenant/i.test(el.textContent)).length,
        kpis: root.querySelectorAll('.mkw-kpi, .mkw-counters, .pv2-stat').length,
        heroInChat: root.querySelectorAll('.mkw-chat .mkw-hero').length,
      };
    });
    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' -> ' + errs.slice(0, 3).join(' | ') : ''}`);
    ok(hygiene.nav.join('|') === 'Plan|Créations|Marché|Impact' && hygiene.toggle, `l'en-tete porte les 4 profondeurs + le bouton panneau (${hygiene.nav.join(', ')})`);
    ok(hygiene.rail === 0, 'le rail « Profondeur » est MORT : plus aucune rangee entre le gerant et le chat');
    ok(hygiene.desk, 'la grille : le chat au centre, le panneau a droite');
    ok(hygiene.modes.join('|') === 'Demander|Créer', `le composer porte ses DEUX modes (${hygiene.modes.join(', ')})`);
    ok(hygiene.theatre === 0, `ZERO theatre : ni avatar, ni bulle decorative, ni carte-dashboard dans le chat (obtenu ${hygiene.theatre})`);
    ok(hygiene.title === 'Marketing' && /rien ne part tout seul/i.test(hygiene.desc) && /Fun Galaxy Libramont/.test(hygiene.desc), 'l\'en-tete dit l\'identite, LE CENTRE et la promesse de validation');
    ok(hygiene.refresh === 0 && banned.length === 0, 'zero bouton de relance, zero jargon interne');
    ok(hygiene.kpis === 0 && hygiene.heroInChat === 0, 'ni compteurs muets ni heros EUR dans le chat (une seule maison : Impact)');

    console.log('\n[ACCUEIL] le chat vide s\'ouvre comme Claude : bonjour + brief reel + composer centre');
    const hero = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      const heroBox = root.querySelector('.mkw-chat.is-hero .mkw-chat-hero');
      return {
        hero: Boolean(heroBox),
        hello: (heroBox && heroBox.querySelector('.mkw-hello') || {}).textContent || '',
        brief: (heroBox && heroBox.querySelector('.mkw-hello-brief') || {}).textContent || '',
        briefNums: heroBox ? heroBox.querySelectorAll('.mkw-hello-brief .br-num').length : 0,
        composerCentered: Boolean(heroBox && heroBox.querySelector('.mkw-composer #brAskInput')),
        chips: heroBox ? heroBox.querySelectorAll('.mkw-chip-suggest').length : 0,
        radarInChat: root.querySelectorAll('.mkw-chat .mkw-mini, .mkw-chat .mkw-cell').length,
      };
    });
    ok(hero.hero && /Bonjour/.test(hero.hello), 'l\'accueil : un grand bonjour, rien d\'autre au centre');
    ok(/préparé/.test(hero.brief) && /Bowling Arlon/.test(hero.brief) && hero.briefNums >= 1, 'le sous-titre est le BRIEF REEL du matin (prose-preuve en mono)');
    ok(hero.composerCentered && hero.chips >= 2, 'le composer vit au centre, suggestions dessous');
    ok(hero.radarInChat === 0, 'CONTRE-PREUVE : aucune grille meteo/radar ne squatte le chat (l\'operationnel vit dans le panneau)');

    console.log('\n[PANNEAU] le travail de l\'agent : 3 groupes honnetes + mini-radar, fermable anime');
    const board = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      const groups = [...document.querySelectorAll('#mkwSheet .mkw-bgroup')];
      const heads = groups.map((g) => (g.querySelector('h3') || {}).textContent || '');
      return {
        heads,
        badge: (groups[0] && groups[0].querySelector('.mkw-bcount') || {}).textContent || '',
        facts: (groups[0] && [...groups[0].querySelectorAll('.mkw-bcard')] || []).every((el) => /Voir les faits/.test(el.textContent)),
        pending: /verdict le 26 juillet/.test(groups[2] ? groups[2].textContent : ''),
        watch: groups[3] ? groups[3].textContent : '',
        // « A trancher » : le texte rendu, et la preuve qu il ne porte AUCUN
        // bouton. C est la moitie qui compte : publier une question n a pas de
        // sens, et « appliquer » en lancerait la mesure a 14 jours pour rien.
        piste: groups[1] ? groups[1].textContent : '',
        pisteRows: document.querySelectorAll('#mkwSheet .mkw-piste').length,
        pisteBoutons: groups[1] ? groups[1].querySelectorAll('button').length : -1,
        minis: document.querySelectorAll('#mkwSheet .mkw-mini').length,
        title: (document.querySelector('#mkwSheet .mkw-panel-title') || {}).textContent || '',
      };
    });
    ok(board.heads.slice(0, 4).join('|') === 'À valider|À trancher|En cours|À surveiller', `les quatre groupes du panneau (${board.heads.join(', ')})`);
    ok(board.pisteRows === 1, `la piste du serveur est DESSINEE (${board.pisteRows} ligne(s))`);
    ok(/minimum des anniversaires/i.test(board.piste)
      && /42 sur 500/.test(board.piste)
      && /coexistent deja au catalogue/.test(board.piste),
      'elle porte son sujet, la population concernee et la comparaison deja possible');
    ok(board.pisteBoutons === 0,
      `AUCUN bouton sur une question a trancher (${board.pisteBoutons}) : ni publier, ni appliquer`);
    ok(Number(board.badge) >= 4 && board.facts, 'chaque carte « À valider » compte et porte « Voir les faits »');
    ok(board.pending, '« En cours » = la mesure J+14 REELLE (verdict date), pas un spinner inventé');
    ok(/calme/.test(board.watch) && /Bowling Arlon a bougé/.test(board.watch) && /Foire de Libramont/.test(board.watch), '« À surveiller » : jour calme + concurrent + evenement, tous reels');
    ok(!/J'apprends encore/.test(board.watch), 'CONTRE-PREUVE : a 210 j de recul, AUCUNE ligne « j\'apprends encore »');
    ok(board.minis === 14, `le mini-radar des 14 jours vit dans le panneau (${board.minis})`);
    const toggled = await page.evaluate(async () => {
      window.mkwPanelToggle();
      await new Promise((r) => setTimeout(r, 120));
      // La SORTIE joue : is-closing pendant que le tiroir RENTRE dans le bord.
      const closing = Boolean(document.querySelector('#mkwSheet.is-closing'));
      await new Promise((r) => setTimeout(r, 420));
      const closed = {
        sheetGone: !document.querySelector('#mkwSheet.is-on'),
        pushGone: !document.getElementById('staffCampaignsPage').classList.contains('mkw-has-panel'),
      };
      window.mkwPanelToggle();
      await new Promise((r) => setTimeout(r, 420));
      const panel = document.querySelector('#mkwSheet.is-on.is-in .mkw-panel');
      const rect = panel ? panel.getBoundingClientRect() : null;
      const style = panel ? getComputedStyle(panel) : null;
      return {
        closing,
        ...closed,
        reopened: Boolean(panel),
        // LA BULLE : pres du bord droit avec sa marge (16px), arrondie,
        // hauteur AU CONTENU (jamais une colonne bord a bord).
        edge: rect ? Math.abs(rect.right - (window.innerWidth - 16)) < 3 && Math.abs(rect.top - 16) < 3 && rect.bottom <= window.innerHeight - 12 : false,
        rounded: style ? parseFloat(style.borderTopLeftRadius) >= 10 : false,
        glass: style ? /blur/.test(style.backdropFilter || style.webkitBackdropFilter || '') : false,
        // VRAIMENT transparent : l'alpha du fond sous 0.7 (un verre opaque
        // n'est pas un verre), et le chevron pointe vers la DROITE (sens de
        // la rentree), sans rotation.
        seeThrough: style ? (() => {
          const bg = style.backgroundColor || '';
          // Deux formats possibles : rgba(r, g, b, a) et color(srgb r g b / a).
          const slash = bg.match(/\/\s*([\d.]+)\s*\)/);
          const comma = bg.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/);
          const alpha = slash ? parseFloat(slash[1]) : (comma ? parseFloat(comma[1]) : 1);
          return alpha < 0.7;
        })() : false,
        chevron: (() => { const c = document.querySelector('#mkwSheet .mkw-panel-close'); return c ? getComputedStyle(c).transform === 'none' : false; })(),
        navOneBlock: (() => { const links = [...document.querySelectorAll('.mkw-head-links .mkw-head-link')]; return links.length === 4 && new Set(links.map((l) => l.offsetTop)).size === 1; })(),
        pushBack: document.getElementById('staffCampaignsPage').classList.contains('mkw-has-panel'),
      };
    });
    ok(toggled.closing && toggled.sheetGone && toggled.pushGone, 'la fermeture ANIME la sortie (is-closing) puis le tiroir rentre dans le bord, le chat reprend la largeur');
    ok(toggled.reopened && toggled.edge, 'rouvert : la BULLE vit pres du bord droit (marge 16), hauteur au contenu');
    ok(toggled.rounded && toggled.glass && toggled.seeThrough, 'et c\'est une bulle VITREE arrondie, VRAIMENT transparente (alpha du fond < 0.7 + blur)');
    ok(toggled.chevron, 'la fleche de fermeture pointe vers la DROITE : le sens ou la bulle rentre');
    ok(toggled.navOneBlock, 'les 4 liens de l\'en-tete restent EN BLOC sur une ligne (jamais recroquevilles)');
    ok(toggled.pushBack, 'et le chat se recentre a cote (le shell reserve la place, anime)');

    console.log('\n[MINI-RADAR] un clic sur un jour POSE LA QUESTION dans le chat');
    const dayAsk = await page.evaluate(async () => {
      const minis = [...document.querySelectorAll('#mkwSheet .mkw-mini')];
      minis[9].click(); // le jour CALME du mock (sans proposition liee)
      await new Promise((r) => setTimeout(r, 1000));
      const answer = document.querySelector('#staffCampaignsPage .mkw-chat .mkw-turn-answer');
      const heroGone = !document.querySelector('#staffCampaignsPage .mkw-chat.is-hero');
      return {
        heroGone,
        answer: answer ? answer.textContent : '',
        userTurn: (document.querySelector('#staffCampaignsPage .mkw-msg-user') || {}).textContent || '',
        briefFirst: /Le brief du/.test((document.querySelector('#staffCampaignsPage .mkw-chat-thread .mkw-msg') || {}).textContent || ''),
      };
    });
    ok(dayAsk.heroGone && /Que dit/.test(dayAsk.userTurn), 'le clic devient une question du gerant (bulle a droite), l\'accueil laisse place au fil');
    ok(dayAsk.briefFirst, 'le brief du matin ouvre le fil (premier message de l\'agent)');
    ok(/calme attendu/.test(dayAsk.answer) && /panier moyen mesuré/.test(dayAsk.answer) && /15/.test(dayAsk.answer), 'la reponse cite l\'explication REELLE du jour + le panier MESURE');
    const fillFromAnswer = await page.evaluate(async () => {
      const btn = [...document.querySelectorAll('#staffCampaignsPage .mkw-turn-answer button')].find((el) => /Prépare-moi un post/.test(el.textContent));
      if (!btn) return { found: false };
      btn.click();
      await new Promise((r) => setTimeout(r, 600));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionCreate');
      return { found: true, posted: posts.length, trigger: posts[0] && posts[0].trigger };
    });
    ok(fillFromAnswer.found && fillFromAnswer.posted === 1 && fillFromAnswer.trigger === 'creux', 'l\'action de la reponse est REELLE : « Prepare-moi un post » -> propositionCreate');
    await page.waitForFunction(() => !window.mkBrief.busy, null, { timeout: 8000 });
    await page.waitForTimeout(300);

    console.log('\n[PANNEAU -> CHAT] « Voir les faits » invite la carte DANS la conversation');
    const shown = await page.evaluate(async () => {
      const card = [...document.querySelectorAll('#mkwSheet .mkw-bcard')].find((el) => /plan au sec/.test(el.textContent));
      card.click();
      await new Promise((r) => setTimeout(r, 400));
      const prop = document.querySelector('#staffCampaignsPage .mkw-chat .mkw-msg-prop .mkw-prop.is-open');
      return {
        inChat: Boolean(prop),
        paper: (prop && prop.querySelector('.mkw-paper') || {}).textContent || '',
        nets: prop ? [...prop.querySelectorAll('.mkw-net')].map((el) => el.textContent) : [],
        noScore: prop ? !/\d+\/100/.test(prop.textContent) : false,
        // LA PREUVE. Elle est stockee depuis longtemps et n arrivait jamais a
        // l ecran : la carte disait « Voir les faits » sans en montrer un seul.
        faits: (prop && prop.querySelector('.mkw-facts') || {}).textContent || '',
        lignesDeFait: prop ? prop.querySelectorAll('.mkw-fact').length : 0,
      };
    });
    ok(shown.inChat && /pistes sont au sec/.test(shown.paper), 'la carte arrive OUVERTE dans le chat : l\'agent montre son travail');
    ok(shown.nets.join(',') === 'Facebook,Instagram,Story' && shown.noScore, 'reseaux du tenant, jamais de score interne');
    ok(shown.lignesDeFait === 1, `la preuve de la proposition est AFFICHEE (${shown.lignesDeFait} fait)`);
    ok(/11 h : 9 reservations/.test(shown.faits) && /9 observations/.test(shown.faits)
      && /groupe par heure de start_time/.test(shown.faits),
      'elle porte la valeur, le volume et la derivation : le calcul se refait a la main');
    const variant = await page.evaluate(async () => {
      const card = document.querySelector('#staffCampaignsPage .mkw-chat .mkw-prop.is-open');
      [...card.querySelectorAll('.mkw-net')].find((el) => el.textContent === 'Facebook').click();
      await new Promise((r) => setTimeout(r, 500));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionAction' && p.propAction === 'variante');
      const paper = (document.querySelector('#staffCampaignsPage .mkw-chat .mkw-prop.is-open .mkw-paper') || {}).textContent || '';
      return { posted: posts.length, network: posts[0] && posts[0].network, paper };
    });
    ok(variant.posted === 1 && variant.network === 'facebook' && /fraichement écrit/.test(variant.paper), 'reseau non genere -> il s\'adapte (POST variante)');
    await page.evaluate(async () => {
      const card = document.querySelector('#staffCampaignsPage .mkw-chat .mkw-prop.is-open');
      [...card.querySelectorAll('button')].find((el) => /Copier le post/.test(el.textContent)).click();
      await new Promise((r) => setTimeout(r, 250));
    });
    ok(await page.evaluate(() => Boolean(document.querySelector('#staffCampaignsPage .mkw-published-ask'))), 'Copier -> bandeau « Publie ? » (jamais publie sur simple copie)');
    const published = await page.evaluate(async () => {
      [...document.querySelectorAll('#staffCampaignsPage .mkw-published-ask button')].find((el) => /^Oui$/.test(el.textContent.trim())).click();
      await new Promise((r) => setTimeout(r, 400));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionAction' && p.propAction === 'publiee');
      return { posted: posts.length, compact: (document.querySelector('#staffCampaignsPage .mkw-prop-published') || {}).textContent || '' };
    });
    ok(published.posted === 1 && /la mesure court 14 jours/.test(published.compact), '« Oui » -> publiee + carte compactee (la mesure demarre)');

    // CONTRE-PREUVE : une proposition SANS tracabilite n affiche aucun bloc de
    // preuve. Sans elle, un bloc rendu en dur passerait l assertion precedente.
    const sansFait = await page.evaluate(async () => {
      const card = [...document.querySelectorAll('#mkwSheet .mkw-bcard')].find((el) => /offre étudiants/.test(el.textContent));
      if (!card) return { trouve: false, blocs: -1 };
      card.click();
      await new Promise((r) => setTimeout(r, 450));
      const props = [...document.querySelectorAll('#staffCampaignsPage .mkw-chat .mkw-prop.is-open')];
      const prop = props[props.length - 1];
      return { trouve: Boolean(prop), blocs: prop ? prop.querySelectorAll('.mkw-facts').length : -1 };
    });
    ok(sansFait.trouve && sansFait.blocs === 0,
      `CONTRE-PREUVE : sans tracabilite, aucun bloc de preuve n est fabrique (${sansFait.blocs})`);

    console.log('\n[COMPOSER] Créer prepare un livrable reel qui ARRIVE dans le chat, la frappe survit');
    const compose = await page.evaluate(async () => {
      window.mkwMode('creer');
      await new Promise((r) => setTimeout(r, 150));
      const input = document.getElementById('brAskInput');
      input.focus();
      input.value = 'un post pour la soirée fluo de samedi';
      input.dispatchEvent(new Event('input'));
      window.renderStaffCampaignsPage();
      await new Promise((r) => setTimeout(r, 250));
      const survived = (document.getElementById('brAskInput') || {}).value || '';
      const focusAlive = document.activeElement && document.activeElement.id === 'brAskInput';
      const boardBefore = document.querySelectorAll('#mkwSheet .mkw-bcard').length;
      [...document.querySelectorAll('#staffCampaignsPage .mkw-composer-send')].find((el) => /Préparer/.test(el.textContent)).click();
      await new Promise((r) => setTimeout(r, 800));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionCreate' && p.brief);
      const cards = [...document.querySelectorAll('#mkwSheet .mkw-bcard')];
      const fresh = cards.filter((el) => el.classList.contains('is-new'));
      const chatProps = [...document.querySelectorAll('#staffCampaignsPage .mkw-chat .mkw-msg-prop')];
      const lastProp = chatProps[chatProps.length - 1];
      return {
        survived, focusAlive,
        posted: posts.length, brief: posts.length ? posts[posts.length - 1].brief : '',
        cleared: (document.getElementById('brAskInput') || {}).value === '',
        boardBefore, boardAfter: cards.length,
        freshCount: fresh.length,
        inChat: lastProp ? /soirée fluo/.test(lastProp.textContent) : false,
        intro: /C'est prêt/.test(document.querySelector('#staffCampaignsPage .mkw-chat-thread').textContent),
      };
    });
    ok(compose.survived === 'un post pour la soirée fluo de samedi' && compose.focusAlive, 'le texte tape ET le focus survivent a un re-rendu complet');
    ok(compose.posted === 1 && /soirée fluo/.test(compose.brief) && compose.cleared, '« Préparer » envoie propositionCreate puis vide la ligne');
    ok(compose.boardAfter === compose.boardBefore + 1 && compose.freshCount === 1, `la tache arrive dans « À valider » avec son entree animee (${compose.boardBefore} -> ${compose.boardAfter})`);
    ok(compose.inChat && compose.intro, 'et l\'agent MONTRE la creation dans le chat (« C\'est prêt »), ouverte');
    const once = await page.evaluate(async () => {
      // La fenetre de l'animation (420 ms) doit etre passee : apres elle, plus
      // aucun repaint ne rejoue l'entree.
      await new Promise((r) => setTimeout(r, 600));
      window.renderStaffCampaignsPage();
      await new Promise((r) => setTimeout(r, 200));
      return document.querySelectorAll('#mkwSheet .mkw-bcard.is-new').length;
    });
    ok(once === 0, 'CONTRE-PREUVE : l\'entree animee ne joue qu\'UNE fois');
    // LA REVELATION : tiroir FERME, une creation IA aboutit -> il s'OUVRE tout
    // seul et montre la tache neuve (demande Movsar 2026-08-06).
    const reveal = await page.evaluate(async () => {
      window.mkwPanelToggle();
      await new Promise((r) => setTimeout(r, 450));
      const closedBefore = !document.querySelector('#mkwSheet.is-on');
      window.mkwMode('creer');
      await new Promise((r) => setTimeout(r, 120));
      const input = document.getElementById('brAskInput');
      input.value = 'une offre anniversaire ados';
      input.dispatchEvent(new Event('input'));
      window.mkwSend();
      await new Promise((r) => setTimeout(r, 900));
      return {
        closedBefore,
        autoOpened: Boolean(document.querySelector('#mkwSheet.is-on.is-in')),
        freshShown: Boolean(document.querySelector('#mkwSheet .mkw-bcard.is-new')),
      };
    });
    ok(reveal.closedBefore && reveal.autoOpened && reveal.freshShown, 'tiroir ferme + creation IA -> il S\'OUVRE tout seul et montre la tache neuve animee');

    // [DEMANDER] CE QUE CE BLOC DEFEND A CHANGE, ET POURQUOI.
    //
    // Avant : « reponse LOCALE, zero appel serveur ». Cette attente protegeait
    // un bridage. Le mode Demander etait une cascade de regex cote navigateur :
    // « prix », « meteo », « concurrent » rendaient un paragraphe pre-ecrit et
    // TOUT le reste tombait sur « je ne sais pas encore analyser ca librement ».
    // Le produit vendait un employe marketing et livrait un routeur de mots-cles.
    //
    // Maintenant : la question part au serveur, le modele repond depuis le
    // dossier de faits reels du centre (lib/marketing-ask.js). Ce que ce bloc
    // doit prouver a donc change de nature :
    //   1. la question ATTEINT le serveur (sans quoi rien n'a bouge) ;
    //   2. la reponse affichee est ANCREE : elle cite une donnee reelle du
    //      centre, et l'ecran dit ce qu'elle a lu ;
    //   3. hors perimetre, l'agent DIT qu'il ne sait pas au lieu d'inventer ;
    //   4. quand le serveur REFUSE la reponse du modele (invention detectee), le
    //      navigateur reprend son chemin deterministe ET l'affiche.
    // Le refus d'inventer, lui, se prouve la ou il vit : scripts/marketing-ask-check.js
    // (controle d'apres coup + contre-preuve par mutation).
    console.log('\n[DEMANDER] la question part au serveur, la reponse est ancree et sourcee');
    const asked = await page.evaluate(async () => {
      window.mkwMode('demander');
      await new Promise((r) => setTimeout(r, 150));
      const chip = [...document.querySelectorAll('#staffCampaignsPage .mkw-chip-suggest')].find((el) => /Que fait Bowling Arlon/.test(el.textContent));
      if (chip) chip.click();
      await new Promise((r) => setTimeout(r, 200));
      const filled = (document.getElementById('brAskInput') || {}).value || '';
      const asksBefore = (window.__QA_ASKS__ || []).length;
      [...document.querySelectorAll('#staffCampaignsPage .mkw-composer-send')].find((el) => /Demander/.test(el.textContent)).click();
      await new Promise((r) => setTimeout(r, 1000));
      const answers = document.querySelectorAll('#staffCampaignsPage .mkw-turn-answer');
      const answer = answers[answers.length - 1];
      const asks = window.__QA_ASKS__ || [];
      return {
        filled,
        asksDelta: asks.length - asksBefore,
        sentQuestion: asks.length ? String(asks[asks.length - 1].question || '') : '',
        sentCenter: asks.length ? String(asks[asks.length - 1].centerId || '') : '',
        answer: answer ? answer.textContent : '',
        source: (answer && answer.querySelector('.mkw-ans-src') || {}).textContent || '',
      };
    });
    ok(/^Que fait Bowling Arlon/.test(asked.filled), 'la suggestion remplit la question ET bascule le mode');
    ok(asked.asksDelta === 1 && /Bowling Arlon/.test(asked.sentQuestion) && asked.sentCenter === 'libramont',
      `la question part au SERVEUR, telle quelle, avec son centre (${asked.asksDelta} appel)`);
    ok(/offre étudiants/.test(asked.answer) && /15\.4 €/.test(asked.answer),
      'la reponse affichee est ANCREE : elle cite la veille reelle ET un chiffre mesure du centre');
    ok(/jours mesurés/.test(asked.source) && /210/.test(asked.source),
      `la SOURCE dit ce que la reponse a eu sous les yeux ("${asked.source.trim().slice(0, 80)}")`);
    const unknown = await page.evaluate(async () => {
      const input = document.getElementById('brAskInput');
      input.value = 'quelle est la capitale du danemark';
      input.dispatchEvent(new Event('input'));
      window.mkwSend();
      await new Promise((r) => setTimeout(r, 1000));
      const answers = document.querySelectorAll('#staffCampaignsPage .mkw-turn-answer');
      const last = answers[answers.length - 1];
      return { text: last ? last.textContent : '' };
    });
    ok(/n'ai aucune donnée|aucune donnée là-dessus|pas mon sujet/i.test(unknown.text) && !/copenhague/i.test(unknown.text),
      'question hors perimetre -> l\'agent DIT qu\'il ne sait pas, et n\'invente pas la reponse');
    // Le FILET : le serveur refuse une reponse qui inventait. Le navigateur ne
    // reste pas muet et ne fait pas semblant : il rend sa reponse deterministe
    // et ecrit a l'ecran POURQUOI elle est en mode simple.
    const degraded = await page.evaluate(async () => {
      const input = document.getElementById('brAskInput');
      input.value = 'que penses-tu de la soiree fluo interdit';
      input.dispatchEvent(new Event('input'));
      window.mkwSend();
      await new Promise((r) => setTimeout(r, 1000));
      const answers = document.querySelectorAll('#staffCampaignsPage .mkw-turn-answer');
      const last = answers[answers.length - 1];
      return { text: last ? last.textContent : '', source: (last && last.querySelector('.mkw-ans-src') || {}).textContent || '' };
    });
    ok(/mode simple/.test(degraded.source) && /jetée/.test(degraded.source),
      `reponse du modele REFUSEE -> le filet deterministe reprend, et l'ecran le dit ("${degraded.source.trim().slice(0, 90)}")`);
    ok(degraded.text.length > 40, 'le gerant recoit quand meme une reponse : jamais un ecran vide');

    console.log('\n[HISTORIQUE PERSONNEL] chaque code d\'acces a SA conversation');
    const personal = await page.evaluate(async () => {
      const keyQa = `pinlane-mkchat:libramont:${state.staffAuthSession.member.id}`;
      const storedQa = JSON.parse(localStorage.getItem(keyQa) || '[]');
      // Un AUTRE compte se connecte sur le meme poste : son chat est VIERGE.
      state.staffAuthSession.member.id = 'directeur-2';
      window.renderStaffCampaignsPage();
      await new Promise((r) => setTimeout(r, 300));
      const otherHero = Boolean(document.querySelector('#staffCampaignsPage .mkw-chat.is-hero'));
      const otherThread = window.mkw.thread.length;
      // Retour au premier compte : SON historique revient.
      state.staffAuthSession.member.id = 'qa';
      window.renderStaffCampaignsPage();
      await new Promise((r) => setTimeout(r, 300));
      const backThread = window.mkw.thread.length;
      const backHasFluo = /soirée fluo/.test((document.querySelector('#staffCampaignsPage .mkw-chat-thread') || {}).textContent || '');
      return { storedCount: storedQa.length, otherHero, otherThread, backThread, backHasFluo };
    });
    ok(personal.storedCount >= 3, `l'historique du compte est PERSISTE (${personal.storedCount} tours stockes sous sa cle)`);
    ok(personal.otherHero && personal.otherThread === 0, 'un AUTRE code d\'acces ouvre un chat VIERGE (jamais le fil d\'un collegue)');
    ok(personal.backThread >= 3 && personal.backHasFluo, 'le retour du premier compte RESTAURE sa conversation');
    const cleared = await page.evaluate(async () => {
      window.mkwChatClear();
      await new Promise((r) => setTimeout(r, 250));
      return {
        hero: Boolean(document.querySelector('#staffCampaignsPage .mkw-chat.is-hero')),
        stored: JSON.parse(localStorage.getItem(`pinlane-mkchat:libramont:qa`) || '[]').length,
      };
    });
    ok(cleared.hero && cleared.stored === 0, '« Nouvelle conversation » vide LE SIEN (accueil restaure, stockage vide)');

    console.log('\n[MOTION] on VOIT l\'agent travailler, et un repaint ne rejoue JAMAIS le fil');
    const motion = await page.evaluate(async () => {
      const input = document.getElementById('brAskInput');
      input.value = 'que fait bowling arlon ce matin';
      input.dispatchEvent(new Event('input'));
      window.mkwSend();
      await new Promise((r) => setTimeout(r, 150));
      // PENDANT : la bulle du gerant est entree, l'etat de travail vit (marque
      // qui pulse + verbe VRAI qui shimmer), la reponse n'existe pas encore.
      const stateBlock = document.querySelector('#staffCampaignsPage .mkw-msg.is-state');
      const during = {
        // L'attente est rendue par les ORBES d'etapes (renderThinkingSteps,
        // app-main.js) : le libelle vit dans .pl-progress-label et la liste
        // complete dans data-orb-steps. Le vieux selecteur .mkw-state-word ne
        // vise que le repli sans orbes : il ne trouvait plus rien, et cette
        // ligne etait rouge sur main avant meme cette session.
        state: (stateBlock && stateBlock.querySelector('.pl-progress-label') || stateBlock && stateBlock.querySelector('.mkw-state-word') || {}).textContent || '',
        steps: (stateBlock && stateBlock.querySelector('[data-orb-steps]') || {}).getAttribute ? stateBlock.querySelector('[data-orb-steps]').getAttribute('data-orb-steps') : '',
        busy: Boolean(document.querySelector('#staffCampaignsPage .mkw-msg.is-state[aria-busy="true"]')),
        userIn: Boolean([...document.querySelectorAll('#staffCampaignsPage .mkw-msg.is-user')].pop()?.classList.contains('is-in')),
        answerYet: /offre étudiants/.test((document.querySelector('#staffCampaignsPage .mkw-chat-thread') || {}).textContent || ''),
      };
      await new Promise((r) => setTimeout(r, 900));
      // APRES : l'etat est MORT, la reponse est entree avec sa propre animation.
      const msgs = [...document.querySelectorAll('#staffCampaignsPage .mkw-chat-thread .mkw-msg')];
      const after = {
        stateGone: !document.querySelector('#staffCampaignsPage .mkw-msg.is-state'),
        answered: /offre étudiants/.test(msgs[msgs.length - 1] ? msgs[msgs.length - 1].textContent : ''),
        oldQuiet: msgs.slice(0, -1).every((el) => !el.classList.contains('is-in')),
      };
      // La fenetre passe : un repaint n'anime plus rien.
      await new Promise((r) => setTimeout(r, 400));
      window.renderStaffCampaignsPage();
      await new Promise((r) => setTimeout(r, 150));
      const replay = document.querySelectorAll('#staffCampaignsPage .mkw-chat-thread .mkw-msg.is-in').length;
      return { during, after, replay };
    });
    ok(motion.during.state.trim().length > 0 && motion.during.busy, `PENDANT : l'etat de travail vit (« ${motion.during.state.trim()} » + aria-busy)`);
    // LA preuve que l'attente n'est pas du decor : les etapes affichees sortent
    // de CE qui a ete demande. Le concurrent nomme dans la question apparait
    // dans la liste des etapes, parce que le brief le connait vraiment.
    ok(/Bowling Arlon/.test(motion.during.steps), 'les etapes SORTENT de la demande (le concurrent nomme y figure), jamais une liste ecrite d\'avance');
    ok(motion.during.userIn && !motion.during.answerYet, 'la bulle du gerant entre TOUT DE SUITE, la reponse pas encore');
    ok(motion.after.stateGone && motion.after.answered, 'APRES : l\'etat MEURT avec le travail, la reponse entre (jamais de spinner orphelin)');
    ok(motion.after.oldQuiet, 'les tours deja vus restent immobiles');
    ok(motion.replay === 0, 'CONTRE-PREUVE : apres la fenetre, un repaint ne rejoue AUCUNE entree');
    const stateIdle = await page.evaluate(() => document.querySelectorAll('#staffCampaignsPage .mkw-msg.is-state').length);
    ok(stateIdle === 0, 'l\'etat de travail n\'existe JAMAIS au repos');
    // LE SCROLL BUTE SUR LA BARRE (retour Movsar) : tout en bas de page, le
    // composer est colle au bas de l'ecran, JAMAIS de vide dessous.
    const hardBottom = await page.evaluate(async () => {
      window.scrollTo(0, 1000000);
      await new Promise((r) => setTimeout(r, 200));
      const box = document.querySelector('#staffCampaignsPage .mkw-composer-box');
      const rect = box ? box.getBoundingClientRect() : null;
      const chips = document.querySelector('#staffCampaignsPage .mkw-composer-chips');
      const lowest = chips ? chips.getBoundingClientRect().bottom : (rect ? rect.bottom : 0);
      return { ok: rect ? lowest <= window.innerHeight + 2 && lowest >= window.innerHeight - 110 : false };
    });
    ok(hardBottom.ok, 'a scroll maximum, la barre bute au bas de l\'ecran : aucun vide ne vit dessous');
    // UN SEUL cadre de focus : la boite s'allume (focus-within), l'input nu
    // n'ajoute JAMAIS son propre anneau (deux cadres bleus = retour Movsar).
    const focusRing = await page.evaluate(() => {
      const input = document.getElementById('brAskInput');
      input.focus();
      const style = getComputedStyle(input);
      return { shadow: style.boxShadow, outline: style.outlineStyle };
    });
    ok(focusRing.shadow === 'none' && focusRing.outline === 'none', `l'input du composer ne porte AUCUN anneau propre (${focusRing.shadow} / ${focusRing.outline})`);

    console.log('\n[FEUILLE MOBILE] le panneau devient une feuille body-montee, entree/sortie animees');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { window.mkw.panelOpen = false; window.renderStaffCampaignsPage(); });
    await page.waitForTimeout(300);
    const sheetClosed = await page.evaluate(() => ({
      inlineGone: document.querySelectorAll('#staffCampaignsPage .mkw-panel').length === 0,
      sheetOff: !document.querySelector('#mkwSheet.is-on'),
    }));
    ok(sheetClosed.inlineGone && sheetClosed.sheetOff, 'sur petit ecran, AUCUN panneau dans la page et la feuille dort');
    const sheetOpen = await page.evaluate(async () => {
      window.mkwPanelToggle();
      await new Promise((r) => setTimeout(r, 450));
      const sheet = document.getElementById('mkwSheet');
      const panel = sheet && sheet.querySelector('.mkw-panel');
      const rect = panel ? panel.getBoundingClientRect() : null;
      return {
        on: Boolean(sheet && sheet.classList.contains('is-on') && sheet.classList.contains('is-in')),
        edge: rect ? Math.abs(rect.right - (window.innerWidth - 16)) < 3 && Math.abs(rect.top - 16) < 3 : false,
        back: Boolean(sheet && sheet.querySelector('.mkw-sheet-back')),
        groups: sheet ? sheet.querySelectorAll('.mkw-bgroup').length : 0,
      };
    });
    ok(sheetOpen.on && sheetOpen.back, 'la feuille ENTRE (voile + glissement), montee dans body');
    ok(sheetOpen.edge, 'et la bulle se cale sur le bord droit avec sa marge (plus jamais flottante au milieu)');
    ok(sheetOpen.groups >= 3, 'elle porte tout le travail (3 groupes + mini-radar)');
    const sheetAction = await page.evaluate(async () => {
      const mini = [...document.querySelectorAll('#mkwSheet .mkw-mini')][2];
      mini.click();
      await new Promise((r) => setTimeout(r, 1100));
      return {
        closed: !document.querySelector('#mkwSheet.is-on'),
        asked: /Que dit/.test((document.querySelector('#staffCampaignsPage .mkw-chat-thread') || {}).textContent || ''),
      };
    });
    ok(sheetAction.closed && sheetAction.asked, 'une action depuis la feuille REND LA MAIN au chat (question posee, feuille retiree)');
    const sheetOut = await page.evaluate(async () => {
      window.mkwPanelToggle();
      await new Promise((r) => setTimeout(r, 420));
      const opened = Boolean(document.querySelector('#mkwSheet.is-on.is-in'));
      window.mkwPanelToggle();
      await new Promise((r) => setTimeout(r, 100));
      const closing = Boolean(document.querySelector('#mkwSheet.is-closing'));
      await new Promise((r) => setTimeout(r, 400));
      const gone = !document.querySelector('#mkwSheet.is-on');
      return { opened, closing, gone };
    });
    ok(sheetOut.opened && sheetOut.closing && sheetOut.gone, 'la SORTIE joue son animation PUIS la feuille meurt (is-closing observe)');
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => { window.mkw.panelOpen = true; window.renderStaffCampaignsPage(); });
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => Boolean(document.querySelector('#mkwSheet.is-on .mkw-panel')) && !document.querySelector('#mkwSheet .mkw-sheet-back') && document.getElementById('staffCampaignsPage').classList.contains('mkw-has-panel')),
      'retour grand ecran : le tiroir reste au bord SANS voile, le chat pousse a cote');

    console.log('\n[PANNEAU calme + CENTRE qui gouverne]');
    const calm = await page.evaluate(async () => {
      const saved = JSON.stringify(window.mkBrief.data);
      const b = window.mkBrief.data;
      b.propositions = [];
      // Une question ouverte est du travail : le panneau calme n en a aucune.
      b.pistes = [];
      b.receipts = [];
      b.veille = { count: 0, changed: [] };
      b.radar = b.radar.map((d) => ({ ...d, level: 'normal', event: '' }));
      window.mkBrief.published = {};
      window.renderStaffCampaignsPage();
      await new Promise((r) => setTimeout(r, 250));
      const empties = document.querySelectorAll('#mkwSheet .mkw-bempty').length;
      const fake = document.querySelectorAll('#mkwSheet .mkw-bcard, #mkwSheet .mkw-brow, #mkwSheet .mkw-piste').length;
      window.mkBrief.data = JSON.parse(saved);
      window.renderStaffCampaignsPage();
      await new Promise((r) => setTimeout(r, 250));
      return { empties, fake };
    });
    ok(calm.empties >= 2 && calm.fake <= 1, `CONTRE-PREUVE : sans rien a faire, le panneau est CALME (${calm.empties} lignes vides honnetes)`);
    const scope = await page.evaluate(async () => {
      state.adminCenterId = 'gembloux';
      window.renderStaffCampaignsPage();
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline && !/Brief de Gembloux/.test((document.querySelector('#staffCampaignsPage .mkw-hello-brief, #staffCampaignsPage .mkw-msg-text') || {}).textContent || '')) {
        await new Promise((r) => setTimeout(r, 80));
      }
      const text = (document.querySelector('#staffCampaignsPage .mkw-hello-brief, #staffCampaignsPage .mkw-msg-text') || {}).textContent || '';
      const centers = [...(window.__QA_BRIEF_CENTERS__ || [])];
      const thread = window.mkw.thread.length;
      const learning = /J'apprends encore/.test((document.querySelector('#mkwSheet .mkw-panel') || {}).textContent || '');
      state.adminCenterId = 'libramont';
      window.renderStaffCampaignsPage();
      const back = Date.now() + 6000;
      while (Date.now() < back && !/Bowling Arlon/.test((document.querySelector('#mkwSheet .mkw-panel') || {}).textContent || '')) {
        await new Promise((r) => setTimeout(r, 80));
      }
      return { text, centers, thread, learning };
    });
    ok(/Brief de Gembloux/.test(scope.text) && scope.centers.includes('gembloux'), 'basculer de centre RECHARGE le brief du bon centre (fetch scope)');
    ok(scope.thread === 0 && scope.learning, 'le chat de l\'autre centre est le SIEN, et a 8 j de donnees le panneau DIT « j\'apprends encore »');


    console.log('\n[PLAN] les semaines, leurs poignees, l\'honnetete');
    await go('plan');
    await page.waitForFunction(() => document.querySelectorAll('#staffCampaignsPage .mkw-plan-week').length > 0, null, { timeout: 8000 }).catch(() => null);
    const plan = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      const weeks = [...root.querySelectorAll('.mkw-plan-week')];
      const txt = root.textContent || '';
      return {
        count: weeks.length,
        confs: weeks.map((w) => (w.querySelector('.mkw-plan-conf') || {}).textContent || ''),
        goals: weeks.map((w) => (w.querySelector('.mkw-plan-goal') || {}).textContent || ''),
        checks: root.querySelectorAll('.mkw-plan-check').length,
        current: root.querySelectorAll('.mkw-plan-week.is-current').length,
        bridges: [...root.querySelectorAll('button')].filter((b) => /Préparer ce post au Studio/.test(b.textContent)).length,
        freshness: /construit le/.test(txt),
        back: [...root.querySelectorAll('.mkw-back')].map((b) => b.textContent.trim()).join(''),
        text: txt,
      };
    });
    ok(plan.count === 3, `les semaines du plan sont rendues (${plan.count})`);
    ok(plan.checks >= 3 && plan.current === 1 && plan.bridges >= 2, 'poignees « C\'est fait », semaine courante marquee, ponts vers Créations');
    ok(plan.freshness && /Foire de Libramont/.test(plan.text), 'fraicheur affichee + le pourquoi cite le fait date reel');
    ok(/Rien de daté/.test(plan.confs.join('|')) && /fond de commerce/i.test(plan.goals.join('|')), 'une semaine sans fait date est dite « Rien de daté », fond de commerce assume');
    ok(/pas encore assez de recul/i.test(plan.text) && /dates certaines/i.test(plan.text), 'le plan avoue qu\'il ne sait pas encore ce qui marche ICI');
    ok(/Retour au bureau/.test(plan.back), 'la profondeur porte son retour explicite vers le bureau');
    for (const mot of ['confiance', 'horizon', 'pattern', 'prior', 'déterministe']) {
      ok(!new RegExp(mot, 'i').test(plan.text), `zero jargon « ${mot} » dans la surface`);
    }
    ok(!new RegExp('[\\u2014\\u2013]').test(plan.text), 'aucun tiret cadratin dans le plan affiche');
    const done = await page.evaluate(async () => {
      const check = document.querySelector('#staffCampaignsPage .mkw-plan-check:not(.is-done)');
      if (!check) return { found: false };
      check.click();
      await new Promise((r) => setTimeout(r, 400));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'planActionDone');
      return { found: true, posted: posts.length, id: posts[0] && posts[0].planAction && posts[0].planAction.id, noted: /noté, je mesure/.test(document.getElementById('staffCampaignsPage').textContent) };
    });
    ok(done.found && done.posted === 1 && /^strategist:/.test(done.id || '') && done.noted, '« C\'est fait » -> planActionDone + « noté, je mesure »');
    const bridge = await page.evaluate(async () => {
      [...document.querySelectorAll('#staffCampaignsPage button')].find((b) => /Préparer ce post au Studio/.test(b.textContent)).click();
      await new Promise((r) => setTimeout(r, 400));
      return { tab: window.mkBrief.tab, brief: (document.getElementById('brStudioBrief') || {}).value || '' };
    });
    ok(bridge.tab === 'studio' && bridge.brief.length > 5, 'le pont Plan -> Créations pre-remplit l\'angle');

    console.log('\n[CRÉATIONS] l\'atelier honnete');
    const studio = await page.evaluate(async () => {
      const root = document.getElementById('staffCampaignsPage');
      const tabs = root.querySelectorAll('.mkw-st-bar .mkw-net').length;
      const igTab = [...root.querySelectorAll('.mkw-st-bar .mkw-net')].find((el) => el.textContent === 'Instagram');
      if (igTab) igTab.click();
      await new Promise((r) => setTimeout(r, 150));
      const brief = document.getElementById('brStudioBrief');
      brief.value = 'anniversaires ados';
      brief.dispatchEvent(new Event('input'));
      [...root.querySelectorAll('.mkw-st-gen button')].find((el) => /Générer|Régénérer/.test(el.textContent)).click();
      await new Promise((r) => setTimeout(r, 400));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'studioGenerate');
      return {
        tabs, posted: posts.length, platform: posts[0] && posts[0].platform, brief: posts[0] && posts[0].brief,
        blocks: [...document.querySelectorAll('.mkw-st-block .mkw-st-label')].length,
        promptEn: /no text, no logos/.test((document.querySelector('.mkw-st-mono') || {}).textContent || ''),
        badge: (document.querySelector('.mkw-st-badge') || {}).textContent || '',
        craft: (document.querySelector('.mkw-craft') || {}).textContent || '',
        briefSurvived: (document.getElementById('brStudioBrief') || {}).value || '',
      };
    });
    ok(studio.tabs === 4, '4 reseaux dans Créations');
    ok(studio.posted === 1 && studio.platform === 'instagram' && /ados/.test(studio.brief || ''), 'Générer -> POST studioGenerate avec reseau + angle');
    ok(studio.blocks >= 5 && studio.promptEn, 'pack complet : longue/courte/story/hashtags/photo/prompt image (anglais)');
    ok(/note 86\/100/.test(studio.badge) && /écrit par l’IA|écrit par l'IA/.test(studio.badge), 'le badge dit la note ET l\'auteur reel');
    ok(/comment il s’est fait|comment il s'est fait/.test(studio.craft) && /84/.test(studio.craft) && /86/.test(studio.craft), 'la fabrication reelle est montree');
    ok(studio.briefSurvived === 'anniversaires ados', 'l\'angle tape survit a la generation');

    console.log('\n[MARCHÉ] la veille honnete + le deep-link avec intention');
    await go('rivals');
    await page.waitForTimeout(400);
    const rivals = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      const adlink = root.querySelector('.mkw-riv-adlink');
      return {
        rows: root.querySelectorAll('.mkw-riv').length,
        name: /Bowling Arlon/.test(root.textContent),
        rating: /4[.,]2/.test(root.textContent) && /avis/.test(root.textContent),
        signals: root.querySelectorAll('.mkw-riv-sig').length,
        adHref: adlink ? adlink.getAttribute('href') : '',
        labels: root.querySelectorAll('.mkw-label').length,
        matin: /chaque matin/.test(root.textContent) && !/chaque nuit/.test(root.textContent),
      };
    });
    ok(rivals.rows >= 1 && rivals.name && rivals.rating, 'les concurrents surveilles, note Google affichee');
    ok(rivals.signals >= 1 && /facebook\.com\/ads\/library/.test(rivals.adHref), 'signaux structures + lien Meta Ad Library');
    ok(rivals.labels >= 2 && rivals.matin, 'labels d\'accessibilite + « chaque matin » (verite du cron)');
    const analyze = await page.evaluate(async () => {
      const box = document.getElementById('brCompPost');
      box.value = 'Mercredi étudiant : -30% sur le bowling pour toute la promo, sur présentation de la carte étudiant.';
      box.dispatchEvent(new Event('input'));
      [...document.querySelectorAll('#staffCampaignsPage button')].find((el) => /^Analyser$/.test(el.textContent.trim())).click();
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !document.querySelector('#staffCampaignsPage .mkw-analy, #staffCampaignsPage .mkw-analy-degraded')) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'competitorAnalyzePost');
      return {
        posted: posts.length,
        panel: (document.querySelector('#staffCampaignsPage .mkw-analy') || {}).textContent || '',
        learned: (document.querySelector('#staffCampaignsPage .mkw-analy-learned') || {}).textContent || '',
        toStudio: [...document.querySelectorAll('#staffCampaignsPage .mkw-analy button')].some((el) => /En faire un post/.test(el.textContent)),
      };
    });
    ok(analyze.posted === 1 && /ambiance/.test(analyze.panel), 'colle-un-post -> analyse + riposte');
    ok(/J’ai retenu 2 techniques|J'ai retenu 2 techniques/.test(analyze.learned) && analyze.toStudio, 'l\'apprentissage est MONTRE + pont vers Créations');
    // Le deep-link avec intention : depuis le bureau, la veille ouvre Marché
    // avec LE concurrent surligne.
    const intent = await page.evaluate(async () => {
      window.mkwTab('feed');
      await new Promise((r) => setTimeout(r, 300));
      window.mkwGoRival('Bowling Arlon');
      await new Promise((r) => setTimeout(r, 500));
      const focus = document.querySelector('#staffCampaignsPage .mkw-riv.is-focus');
      return { tab: window.mkBrief.tab, focused: Boolean(focus), name: focus ? focus.getAttribute('data-riv-name') : '' };
    });
    ok(intent.tab === 'rivals' && intent.focused && intent.name === 'Bowling Arlon', 'veille -> Marché : LE concurrent arrive surligne (intention conservee)');

    console.log('\n[IMPACT] la maison unique de la preuve');
    await go('results');
    const results = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      const rows = [...root.querySelectorAll('.mkw-receipt')];
      return {
        heroNum: (root.querySelector('.mkw-hero-num') || {}).textContent || '',
        eyebrow: /rapporté/i.test((root.querySelector('.mkw-eyebrow') || {}).textContent || ''),
        cap: (root.querySelector('.mkw-hero-cap') || {}).textContent || '',
        segs: [...root.querySelectorAll('.mkw-seg-btn')].map((el) => el.textContent.trim()),
        count: rows.length,
        good: rows.some((el) => el.className.includes('tone-good') && /\+18\s?% de monde/.test(el.textContent)),
        pending: rows.some((el) => /verdict le 26 juillet/.test(el.textContent)),
        redo: rows.some((el) => /On le refait \?/.test(el.textContent)),
        verdicts: root.querySelectorAll('.mkw-verdict').length,
        verdictText: (root.querySelector('.mkw-verdicts') || {}).textContent || '',
        patterns: root.querySelectorAll('.mkw-pat').length,
        basis: root.querySelectorAll('.mkw-pat-basis').length,
      };
    });
    ok(results.eyebrow && /1[\s  ]?240/.test(results.heroNum), 'le heros EUR vit ICI, seul exemplaire');
    ok(/visites honorées liées à tes messages/.test(results.cap), 'libelle exact : des MESSAGES et des VISITES HONOREES');
    ok(results.segs.join(',') === '7 j,30 j,90 j', 'toggles de periode 7/30/90');
    ok(results.count === 3 && results.good && results.pending && results.redo, 'recus : bon en vert, verdict a venir, « On le refait ? »');
    ok(results.verdicts >= 4 && /-6%/.test(results.verdictText) && !/\+-/.test(results.verdictText), 'verdicts causaux, signe honnete (-6%, jamais +-6%)');
    ok(results.patterns === 2 && results.basis === 1, 'memoire par contexte, ligne brute etiquetee « brut »');
    await page.evaluate(() => { const l = [...document.querySelectorAll('#staffCampaignsPage .mkw-link')].find((el) => /vient ce chiffre/.test(el.textContent)); if (l) l.click(); });
    await page.waitForTimeout(200);
    const src = await page.evaluate(() => ({
      rows: document.querySelectorAll('#staffCampaignsPage .mkw-src').length,
      method: (document.querySelector('#staffCampaignsPage .mkw-src-panel .mkw-method') || {}).textContent || '',
    }));
    ok(src.rows >= 2 && /dernier message reçu/.test(src.method) && /annulées/.test(src.method), 'sources detaillees + methode honnete (recu, exclusions dites)');
    await page.evaluate(() => { [...document.querySelectorAll('.mkw-seg-btn')].find((el) => /7 j/.test(el.textContent)).click(); });
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => (window.__QA_ROI_CALLS__ || [])[0]) === '7', 'changer la periode -> refetch de la paie seule');

    console.log('\n[EMAILS] les campagnes ont demenage');
    await page.evaluate(() => { state.staffMenuPage = 'emails'; save(); renderStaff(); });
    await page.waitForTimeout(700);
    ok(await page.evaluate(() => /campagne/i.test((document.getElementById('staffEmailsPage') || {}).textContent || '')), 'la section campagnes vit dans la page Emails');

    console.log(`\n${failures ? failures + ' FAIL' : ''}`);
    if (failures) { console.error('marketing-ia-check: FAIL'); process.exit(1); }
    console.log('marketing-ia-check: ALL OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error('marketing-ia-check CRASH:', error.stack || error.message); process.exit(1); });
