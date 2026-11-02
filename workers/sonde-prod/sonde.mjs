// LA SONDE DE LA PROD (2026-11-02).
//
// Rien ne prevenait Movsar quand la prod tombait. Le 19/08 tout le compte
// Vercel a ete coupe (402, facture impayee) : c est Movsar qui l a vu, apres 9
// relances par mail non lues (journal 182). Le mail n est donc pas un canal de
// panne, et une sonde hebergee chez Vercel serait tombee avec le reste.
//
// POURQUOI UN WORKER CLOUDFLARE ET PAS UN CRON GITHUB : depuis le 26/08 le
// declencheur schedule de GitHub part avec des heures de retard, ou pas du tout
// (discussions GitHub 206019 et 207346). Mesure sur ce depot : le cron de 01:30
// UTC est parti a 07:16, 07:47 et 07:53. Ce Worker ne partage rien avec la prod :
// ni Vercel, ni Neon, ni Railway, ni la carte bancaire.
//
// CE QU IL TESTE, en lecture seule, jamais un POST (la base de prod ne se teste
// pas). Toutes les 5 minutes la SURFACE, sans la base : la page de reservation et
// ses fichiers, la console, embed.js, les menus QR. Tous les quarts d heure le
// FOND : la base, le catalogue, de vrais creneaux, sur le chemin du tunnel. Le
// fond passe une minute apres le cron secours (*/15, vercel.json), qui reveille
// deja Neon : le faire toutes les 5 minutes empecherait Neon de dormir et le
// worker est ecrit pour l inverse (« Neon dort, 0 $ », workers/ops-worker.js).
// Des qu un passage est suspect, le fond se joue a chaque passage.
//
// CE QU IL NE VOIT PAS : une erreur JavaScript au demarrage du navigateur, une
// base en lecture seule (aucune ecriture n est tentee), le worker Railway.
//
// LA PANNE SE CONFIRME, ELLE NE SE DEVINE PAS. Une etape cassee se rejoue une
// fois apres 5 s. Encore cassee, on verifie que la sonde voit Internet : si les
// controles ne repondent pas non plus, c est son reseau, le passage ne compte
// pas. Il faut 3 passages casses de suite (10 minutes au moins) pour alerter,
// 3 passages verts de suite pour dire le retour. Une alerte part une fois par
// panne, et reste due en base tant que le canal ne l a pas prise.
//
// LE SILENCE NE PROUVE RIEN : chaque lundi matin, un parcours complet et un
// message. Si le message du lundi n arrive pas, c est la sonde qui est morte.
//
// Deployer, depuis ce dossier : npx wrangler deploy
// Les secrets : npx wrangler secret put TELEGRAM_JETON (et TELEGRAM_CHAT)
// Simuler sans toucher la prod : npx wrangler kv key put --binding=ETAT --remote simulation panne
//   (les adresses visent un chemin mort, 3 passages plus tard l alerte part ;
//   `reseau` coupe aussi les controles : aucune alerte ne doit partir).
// Finir la simulation : npx wrangler kv key delete --binding=ETAT --remote simulation
// Gate : npm run test:sonde-prod

const SITE = 'https://www.mngfunglxy.com';
const CONSOLE_STAFF = 'https://app.pinlane.be';
const CENTRE = 'libramont';
const FACTURATION_VERCEL = 'https://vercel.com/teams/ansarbis20-1397s-projects/settings/billing';

// Rien d autre qu une fonction ne s exporte ici : le moteur Cloudflare refuse de
// charger un module dont un export nomme est une constante.
const SEUIL_PANNE = 3;
const SEUIL_RETOUR = 3;
const DELAI_MS = 10_000;
const PAUSE_AVANT_REESSAI_MS = 5_000;
const SAMEDIS = 4;
const CONTROLES = ['https://www.google.com/generate_204', 'https://api.github.com/zen'];
const AGENT = 'pinlane-sonde/1';
const CLE_ETAT = 'etat';
const CLE_SIMULATION = 'simulation';
// Le cron des passages tombe aux minutes 1, 6, 11, 16... (wrangler.toml).
const CRON_BILAN = '0 7 * * 1';
const LIMITE = 'limite de débit';
const VIDE = 'aucun créneau';

const ETAT_INITIAL = {
  statut: 'ok',
  echecs: 0,
  succes: 0,
  depuis: null,
  casses: [],
  simulation: false,
  dernierePanne: null,
  aEnvoyer: [],
};

const heure = (ms) => new Intl.DateTimeFormat('fr-BE', {
  timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit',
}).format(ms);
const jour = (ms) => new Intl.DateTimeFormat('fr-BE', {
  timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit',
}).format(ms);
function duree(ms) {
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

export function prochainSamedi(maintenant) {
  const date = new Date(maintenant);
  date.setUTCDate(date.getUTCDate() + (((6 - date.getUTCDay() + 7) % 7) || 7));
  return date.toISOString().slice(0, 10);
}

// Le corps est lu sous le meme delai que les en-tetes : une reponse qui commence
// puis se fige est une coupure. Sans corps demande, on le ferme.
async function lire(fetcher, url, { corps = true } = {}) {
  try {
    const reponse = await fetcher(url, {
      redirect: 'follow',
      headers: { 'user-agent': AGENT },
      signal: AbortSignal.timeout(DELAI_MS),
    });
    const texte = corps ? await reponse.text() : '';
    if (!corps) await reponse.body?.cancel();
    return {
      statut: reponse.status,
      type: reponse.headers.get('content-type') || '',
      vercel: reponse.headers.get('x-vercel-error') || '',
      texte,
    };
  } catch (erreur) {
    return { coupure: erreur && erreur.name === 'TimeoutError' ? 'délai dépassé' : 'injoignable' };
  }
}

// Un statut ne dit pas qui a repondu (memoire refus-se-lit-au-contrat) : ceci ne
// fait que lever le plus gros, le contrat de chaque etape fait le reste.
function refusHttp(r) {
  if (r.coupure) return r.coupure;
  if (r.statut === 402 || r.vercel === 'DEPLOYMENT_DISABLED') return 'compte Vercel suspendu (402)';
  if (r.statut === 429) return LIMITE;
  if (r.statut !== 200) return `HTTP ${r.statut}${r.vercel ? ` ${r.vercel}` : ''}`;
  return null;
}

async function verifierFichier(fetcher, url) {
  const r = await lire(fetcher, url, { corps: false });
  const refus = refusHttp(r);
  if (refus) return `${refus} sur ${url.split('/').pop().split('?')[0]}`;
  if (!/javascript|css/.test(r.type)) return `fichier au mauvais format ${url.split('/').pop().split('?')[0]}`;
  return null;
}

async function verifierPage(fetcher, { url, marqueur, fichiers }) {
  const r = await lire(fetcher, url);
  const refus = refusHttp(r);
  if (refus) return refus;
  if (!r.type.includes('text/html')) return 'pas une page';
  if (!r.texte.includes(marqueur)) return 'page sans son contenu';
  if (!fichiers) return null;
  const trouves = r.texte.match(fichiers) || [];
  if (!trouves.length) return 'page sans ses fichiers';
  const origine = new URL(url).origin;
  for (const chemin of trouves) {
    const manque = await verifierFichier(fetcher, origine + chemin);
    if (manque) return manque;
  }
  return null;
}

async function verifierJson(fetcher, url, contrat) {
  const r = await lire(fetcher, url);
  const refus = refusHttp(r);
  if (refus) return refus;
  let corps;
  try {
    corps = JSON.parse(r.texte);
  } catch (erreur) {
    return 'réponse illisible';
  }
  return contrat(corps);
}

const contratSante = (c) => (c.ok === true && c.db === true ? null : 'base injoignable');
const contratCatalogue = (c) => {
  if (c.ok !== true) return 'catalogue refusé';
  if (!Array.isArray(c.formules) || !c.formules.length) return 'catalogue vide';
  return c.center && c.center.id === CENTRE ? null : 'mauvais centre';
};
const contratCreneaux = (c) => {
  if (c.ok !== true || !Array.isArray(c.slots)) return 'créneaux refusés';
  return c.slots.length ? null : VIDE;
};

// Un samedi plein ou ferme n est pas une panne : on en regarde quatre. Plus aucun
// creneau sur quatre samedis, c en est une, meme avec que des 200.
async function verifierCreneaux(fetcher, site, maintenant) {
  let date = prochainSamedi(maintenant);
  for (let i = 0; i < SAMEDIS; i += 1) {
    const url = `${site}/api/public-availability?centerId=${CENTRE}&date=${date}&pax=6&type=bowling`;
    const refus = await verifierJson(fetcher, url, contratCreneaux);
    if (refus !== VIDE) return refus;
    date = prochainSamedi(Date.parse(`${date}T12:00:00Z`));
  }
  return `${VIDE} sur ${SAMEDIS} samedis`;
}

export function listerEtapes({ site, consoleStaff, maintenant, profond }) {
  const page = (nom, chemin, marqueur, fichiers, racine = site) => ({
    nom,
    faire: (f) => verifierPage(f, { url: racine + chemin, marqueur, fichiers }),
  });
  const surface = [
    page('page de réservation', '/fungalaxy/libramont', 'Fun Galaxy', /\/assets\/fungalaxy-booking\.(?:js|css)[^"\s]*/g),
    page('console', '/', '<title>Pinlane', /\/assets\/app-main\.js[^"\s]*/g, consoleStaff),
    page('menu de Libramont', '/menu/libramont/', 'Fun Galaxy Libramont'),
    page('menu de Gembloux', '/menu/gembloux/', 'Fun Galaxy Gembloux'),
    { nom: 'embed.js', faire: (f) => verifierFichier(f, `${site}/embed.js`) },
  ];
  if (!profond) return surface;
  return [
    ...surface,
    { nom: 'base', faire: (f) => verifierJson(f, `${site}/api/healthz`, contratSante) },
    { nom: 'catalogue', faire: (f) => verifierJson(f, `${site}/api/public-booking-meta?centerId=${CENTRE}`, contratCatalogue) },
    { nom: 'créneaux', faire: (f) => verifierCreneaux(f, site, maintenant) },
  ];
}

const pause = (ms) => new Promise((fin) => { setTimeout(fin, ms); });

export async function sonder({
  fetcher = fetch,
  maintenant = Date.now(),
  profond = true,
  site = SITE,
  consoleStaff = CONSOLE_STAFF,
  controles = CONTROLES,
  attendre = pause,
} = {}) {
  const etapes = listerEtapes({ site, consoleStaff, maintenant, profond });
  const premier = [];
  for (const etape of etapes) {
    const detail = await etape.faire(fetcher);
    if (detail) premier.push(etape);
  }
  if (!premier.length) return { verdict: 'ok', etapes: etapes.length, casses: [] };

  await attendre(PAUSE_AVANT_REESSAI_MS);
  const casses = [];
  for (const etape of premier) {
    const detail = await etape.faire(fetcher);
    if (detail) casses.push({ nom: etape.nom, detail });
  }
  if (!casses.length) return { verdict: 'ok', etapes: etapes.length, casses: [] };
  // Le limiteur a repondu : la prod est vivante, elle ne dit rien de plus.
  if (casses.every((c) => c.detail === LIMITE)) return { verdict: 'aveugle', etapes: etapes.length, casses };

  for (const url of controles) {
    const r = await lire(fetcher, url, { corps: false });
    if (!r.coupure && r.statut < 500) return { verdict: 'ko', etapes: etapes.length, casses };
  }
  return { verdict: 'aveugle', etapes: etapes.length, casses };
}

function messagePanne(etat, maintenant) {
  const liste = etat.casses.slice(0, 3).map((c) => `${c.nom} (${c.detail})`).join(', ');
  const reste = etat.casses.length > 3 ? ` et ${etat.casses.length - 3} autres` : '';
  const facture = etat.casses.some((c) => c.detail.includes('402')) ? `\nFacture : ${FACTURATION_VERCEL}` : '';
  return `${etat.simulation ? '[simulation] ' : ''}PANNE Pinlane\n`
    + `Depuis ${heure(etat.depuis)}, confirmée à ${heure(maintenant)}.\n`
    + `Cassé : ${liste}${reste}.${facture}`;
}

function messageRetour(etat, maintenant) {
  return `${etat.simulation ? '[simulation] ' : ''}RETOUR Pinlane\n`
    + `Tout répond à nouveau. Panne de ${duree(maintenant - etat.depuis)}.`;
}

// Fonction pure : tout l anti-bruit est ici. Elle ne recoit que ce que le passage
// a vu, et rend l etat suivant, messages dus compris.
export function decider(etat, vu, maintenant) {
  if (vu.verdict === 'aveugle') return etat;
  const suivant = { ...etat, aEnvoyer: [...etat.aEnvoyer] };
  if (etat.statut === 'ok') {
    if (vu.verdict === 'ok') return { ...suivant, echecs: 0, depuis: null };
    suivant.echecs = etat.echecs + 1;
    suivant.depuis = etat.depuis || maintenant;
    if (suivant.echecs < SEUIL_PANNE) return suivant;
    suivant.statut = 'panne';
    suivant.succes = 0;
    suivant.casses = vu.casses;
    suivant.simulation = Boolean(vu.simulation);
    suivant.aEnvoyer.push(messagePanne(suivant, maintenant));
    return suivant;
  }
  if (vu.verdict === 'ko') return { ...suivant, succes: 0 };
  suivant.succes = etat.succes + 1;
  if (suivant.succes < SEUIL_RETOUR) return suivant;
  suivant.aEnvoyer.push(messageRetour(suivant, maintenant));
  return {
    ...ETAT_INITIAL,
    dernierePanne: { debut: etat.depuis, fin: maintenant },
    aEnvoyer: suivant.aEnvoyer,
  };
}

async function lireEtat(kv) {
  const brut = await kv.get(CLE_ETAT);
  return { brut, etat: brut ? { ...ETAT_INITIAL, ...JSON.parse(brut) } : ETAT_INITIAL };
}

function ciblesSimulees(simulation) {
  if (simulation === 'reseau') {
    const mort = 'https://sonde-simulation.invalid';
    return { site: mort, consoleStaff: mort, controles: [`${mort}/controle`] };
  }
  return { site: `${SITE}/sonde-simulation`, consoleStaff: `${CONSOLE_STAFF}/sonde-simulation` };
}

export async function passage({ kv, envoyer, fetcher = fetch, maintenant = Date.now(), attendre = pause }) {
  const { brut, etat } = await lireEtat(kv);
  const simulation = await kv.get(CLE_SIMULATION);
  const suspect = etat.statut === 'panne' || etat.echecs > 0;
  const profond = suspect || new Date(maintenant).getUTCMinutes() % 15 === 1;
  const vu = await sonder({
    fetcher, maintenant, profond, attendre, ...(simulation ? ciblesSimulees(simulation) : {}),
  });
  vu.simulation = Boolean(simulation);
  const suivant = decider(etat, vu, maintenant);

  // L etat s ecrit AVANT l envoi : un passage qui meurt ici laisse l alerte due,
  // le suivant la reprend. Rien ne change, rien ne s ecrit (KV gratuit, 1000/jour).
  const ecrit = JSON.stringify(suivant);
  if (ecrit !== brut) await kv.put(CLE_ETAT, ecrit);
  const restent = [];
  for (const texte of suivant.aEnvoyer) {
    try {
      await envoyer(texte);
    } catch (erreur) {
      console.error('sonde: canal indisponible', erreur && erreur.message);
      restent.push(texte);
    }
  }
  if (restent.length !== suivant.aEnvoyer.length) {
    await kv.put(CLE_ETAT, JSON.stringify({ ...suivant, aEnvoyer: restent }));
  }
  console.log(JSON.stringify({ verdict: vu.verdict, profond, statut: suivant.statut, echecs: suivant.echecs, casses: vu.casses }));
  return { vu, etat: suivant };
}

export async function bilan({ kv, envoyer, fetcher = fetch, maintenant = Date.now(), attendre = pause }) {
  const { etat } = await lireEtat(kv);
  const vu = await sonder({ fetcher, maintenant, profond: true, attendre });
  const parcours = vu.verdict === 'ok'
    ? `Parcours complet vert (${vu.etapes} étapes).`
    : `Parcours non vert ce matin : ${vu.casses.map((c) => `${c.nom} (${c.detail})`).join(', ')}.`;
  const derniere = etat.dernierePanne
    ? `Dernière panne : ${jour(etat.dernierePanne.debut)}, ${duree(etat.dernierePanne.fin - etat.dernierePanne.debut)}.`
    : 'Aucune panne enregistrée.';
  await envoyer(`Sonde Pinlane en vie.\n${parcours}\n${derniere}`);
}

async function envoyerTelegram(env, texte) {
  const api = env.TELEGRAM_API || 'https://api.telegram.org';
  const reponse = await fetch(`${api}/bot${env.TELEGRAM_JETON}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT, text: texte, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(DELAI_MS),
  });
  await reponse.body?.cancel();
  if (!reponse.ok) throw new Error(`Telegram ${reponse.status}`);
}

export default {
  async scheduled(controleur, env) {
    const dependances = {
      kv: env.ETAT,
      envoyer: (texte) => envoyerTelegram(env, texte),
      maintenant: controleur.scheduledTime,
    };
    if (controleur.cron === CRON_BILAN) await bilan(dependances);
    else await passage(dependances);
  },
};
