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
// LES DEUX CENTRES (2026-11-05) : le formulaire, le catalogue et les creneaux de
// Gembloux comme ceux de Libramont. Jusque-la seul son menu QR etait regarde.
//
// LA BASE ECRIT-ELLE ENCORE ? /api/healthz, pour cette sonde seule, ecrit une ligne et
// l annule : une base qui lit sans ecrire est une panne que rien d autre ne montre.
//
// CE QU IL NE VOIT PAS : une erreur JavaScript chez un client (le formulaire la
// remonte, la garde de l application la dit) et le worker Railway.
//
// LA PANNE SE CONFIRME, ELLE NE SE DEVINE PAS. Une etape cassee se rejoue une
// fois apres 5 s. Encore cassee, on verifie que la sonde voit Internet : si les
// controles ne repondent pas non plus, c est son reseau, le passage ne compte
// pas. Il faut 3 passages casses de suite (10 minutes au moins) pour alerter,
// 3 passages verts de suite pour dire le retour. Une alerte part une fois par
// panne, et reste due en base tant que le canal ne l a pas prise.
//
// LA SAUVEGARDE DE LA NUIT A SA PROPRE ALERTE. Elle a echoue 27 nuits sans que
// personne le sache (journal 444). Sur le fond, la sonde lit dans /api/healthz la
// date de la derniere sauvegarde reussie : plus de 26 h, un message, un seul, et
// un autre quand elle repart. Ce n est pas une panne, le site marche : elle ne
// passe ni par le compteur ni par l etat de panne, sinon une sauvegarde en retard
// masquerait une vraie panne et reveillerait Neon toutes les 5 minutes.
//
// LA GARDE DE L APPLICATION A LA MEME ALERTE (2026-11-05). Elle tourne chez Vercel : si
// elle s arrete, elle ne peut pas le dire. Plus de 45 minutes sans passage, un message.
// Et elle regarde cette sonde en retour : chacune voit l autre tomber.
//
// LE SILENCE NE PROUVE RIEN : chaque lundi matin, un parcours complet et un
// message. Si le message du lundi n arrive pas, c est la sonde qui est morte.
//
// LES SUJETS (2026-11-06) : avec TELEGRAM_GROUPE et TELEGRAM_SUJETS (les memes valeurs que
// sur Vercel, « pannes:2,...,bilans:5 »), une panne et son retour partent dans le sujet
// Pannes du groupe Pinlane, le bilan du lundi dans Bilans, sans sonnerie. Sans ces deux
// valeurs, tout part dans la conversation d Ansar, comme avant. Un groupe qui refuse ne perd
// rien : le message repart dans la conversation.
//
// Deployer, depuis ce dossier : npx wrangler deploy
// Les secrets : npx wrangler secret put TELEGRAM_JETON (et TELEGRAM_CHAT)
// Simuler sans toucher la prod : npx wrangler kv key put --binding=ETAT --remote simulation panne
//   (les adresses visent un chemin mort, 3 passages plus tard l alerte part ;
//   `reseau` coupe aussi les controles : aucune alerte ne doit partir ;
//   `sauvegarde` fait comme si la date etait illisible, le site reste sonde pour
//   de vrai, l alerte part au prochain passage du fond).
// Finir la simulation : npx wrangler kv key delete --binding=ETAT --remote simulation
//   puis relire la cle : le 02/11 un delete a rendu 0 sans rien retirer.
// Compte Cloudflare neuf : les crons exigent un sous-domaine workers.dev, meme
//   sans adresse publique (PUT /accounts/<id>/workers/subdomain).
// Gate : npm run test:sonde-prod

const SITE = 'https://www.mngfunglxy.com';
const CONSOLE_STAFF = 'https://app.pinlane.be';
const CENTRES = ['libramont', 'gembloux'];
const FACTURATION_VERCEL = 'https://vercel.com/teams/ansarbis20-1397s-projects/settings/billing';

// Rien d autre qu une fonction ne s exporte ici : le moteur Cloudflare refuse de
// charger un module dont un export nomme est une constante.
const SEUIL_PANNE = 3;
const SEUIL_RETOUR = 3;
// La sauvegarde part a 01:15 UTC : une nuit ratee se voit a 03:15 UTC.
const SEUIL_SAUVEGARDE_MS = 26 * 3_600_000;
const SEUIL_GARDE_MS = 45 * 60_000;
const SIMULATION_SAUVEGARDE = 'sauvegarde';
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
  sauvegardeEnRetard: null,
  gardeEnRetard: false,
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

// AU GABARIT DES ALERTES DE L APPLICATION (2026-11-13, lib/alertes-texte.js, recopie ici : la sonde
// tourne seule chez Cloudflare et n importe rien). Ce qui se passe, ce que ca change, « Ce que tu
// fais » ; et « Réglé : ..., depuis HH:MM. » quand ca revient. Ni nom de fichier, ni code d erreur,
// ni mot technique. Seules une vraie panne et la surveillance du quart d heure arretee font sonner :
// un retour, la sauvegarde et le bilan arrivent sans bruit (`calme`).
const NOMS_LISIBLES = {
  'page de réservation': 'la page de réservation de Libramont',
  'page de réservation de Gembloux': 'la page de réservation de Gembloux',
  console: 'la console',
  'menu de Libramont': 'le menu de Libramont',
  'menu de Gembloux': 'le menu de Gembloux',
  'embed.js': 'le formulaire posé sur les sites des centres',
  base: 'les données de Pinlane',
  catalogue: 'le catalogue de Libramont',
  'catalogue de Gembloux': 'le catalogue de Gembloux',
  'créneaux': 'les heures libres de Libramont',
  'créneaux de Gembloux': 'les heures libres de Gembloux',
};
const nomLisible = (nom) => NOMS_LISIBLES[nom] || 'une page du site';
function detailLisible(detail) {
  const d = String(detail || '');
  if (/402|suspendu/.test(d)) return 'l’hébergeur a suspendu le compte';
  if (d === LIMITE) return 'trop de visites d’un coup';
  if (/^HTTP 4/.test(d)) return 'refuse de s’ouvrir';
  if (/^HTTP 5|coupure|délai|injoignable/i.test(d)) return 'ne répond pas';
  if (/catalogue/.test(d)) return 'catalogue vide';
  if (/créneau|samedis/.test(d)) return 'aucune heure libre';
  if (/page|fichier|illisible|format/.test(d)) return 's’ouvre vide ou abîmée';
  return 'ne marche pas comme prévu';
}
const casseLisible = (c) => `${nomLisible(c.nom)} (${detailLisible(c.detail)})`;
// Quatre etapes ou plus cassees de la meme facon : tout le parcours, en une fois.
function listeDesCasses(casses) {
  const details = [...new Set(casses.map((c) => detailLisible(c.detail)))];
  if (casses.length > 3 && details.length === 1) return `tout le parcours (${details[0]})`;
  return `${casses.slice(0, 2).map(casseLisible).join(', ')}${casses.length > 2 ? ` et ${casses.length - 2} autres` : ''}`;
}
const TOUCHE_LES_CLIENTS = /réservation|catalogue|heures libres|formulaire|données/;
const LIEN_FACTURE = 'Ouvrir la facture de l’hébergeur';
const calme = (texte) => ({ texte, calme: true });

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

const contratSante = (c) => {
  if (c.ok !== true || c.db !== true) return 'base injoignable';
  return c.ecriture === false ? 'la base refuse d’écrire' : null;
};
const contratCatalogue = (centre) => (c) => {
  if (c.ok !== true) return 'catalogue refusé';
  if (!Array.isArray(c.formules) || !c.formules.length) return 'catalogue vide';
  return c.center && c.center.id === centre ? null : 'mauvais centre';
};
const contratCreneaux = (c) => {
  if (c.ok !== true || !Array.isArray(c.slots)) return 'créneaux refusés';
  return c.slots.length ? null : VIDE;
};

// Un samedi plein ou ferme n est pas une panne : on en regarde quatre. Plus aucun
// creneau sur quatre samedis, c en est une, meme avec que des 200.
async function verifierCreneaux(fetcher, site, maintenant, centre) {
  let date = prochainSamedi(maintenant);
  for (let i = 0; i < SAMEDIS; i += 1) {
    const url = `${site}/api/public-availability?centerId=${centre}&date=${date}&pax=6&type=bowling`;
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
    page('page de réservation de Gembloux', '/fungalaxy/gembloux', 'Fun Galaxy'),
    page('console', '/', '<title>Pinlane', /\/assets\/app-main\.js[^"\s]*/g, consoleStaff),
    page('menu de Libramont', '/menu/libramont/', 'Fun Galaxy Libramont'),
    page('menu de Gembloux', '/menu/gembloux/', 'Fun Galaxy Gembloux'),
    { nom: 'embed.js', faire: (f) => verifierFichier(f, `${site}/embed.js`) },
  ];
  if (!profond) return surface;
  return [
    ...surface,
    { nom: 'base', faire: (f) => verifierJson(f, `${site}/api/healthz`, contratSante) },
    ...CENTRES.flatMap((centre) => {
      const nom = centre === 'libramont' ? '' : ` de ${centre[0].toUpperCase()}${centre.slice(1)}`;
      return [
        { nom: `catalogue${nom}`, faire: (f) => verifierJson(f, `${site}/api/public-booking-meta?centerId=${centre}`, contratCatalogue(centre)) },
        { nom: `créneaux${nom}`, faire: (f) => verifierCreneaux(f, site, maintenant, centre) },
      ];
    }),
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
  const noms = etat.casses.map((c) => nomLisible(c.nom));
  const facture = etat.casses.some((c) => String(c.detail).includes('402'));
  const touches = [noms.some((n) => TOUCHE_LES_CLIENTS.test(n)) ? 'Les clients ne peuvent plus réserver en ligne.' : '', noms.includes('la console') ? 'L’équipe n’a plus la console.' : ''].filter(Boolean).join(' ') || 'Une partie du site ne répond plus.';
  return `${etat.simulation ? '[simulation] ' : ''}Pinlane : le site ne marche plus depuis ${heure(etat.depuis)}, vérifié à ${heure(maintenant)}.\n`
    + `${touches} Ce qui casse : ${listeDesCasses(etat.casses)}.\n`
    + (facture ? `Ce que tu fais : règle la facture de l’hébergeur, le site repart dès qu’elle est payée.\n${LIEN_FACTURE}` : 'Ce que tu fais : ouvre le site toi-même ; si c’est bien en panne, demande une réparation.');
}

function messageRetour(etat, maintenant) {
  return calme(`${etat.simulation ? '[simulation] ' : ''}Réglé : le site ne marchait plus pendant ${duree(maintenant - etat.depuis)}, depuis ${heure(maintenant)}.`);
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
    sauvegardeEnRetard: etat.sauvegardeEnRetard,
    dernierePanne: { debut: etat.depuis, fin: maintenant },
    aEnvoyer: suivant.aEnvoyer,
  };
}

// undefined : on ne sait rien, c est le parcours qui dira la panne. null : le site
// repond mais sans date valable, et ca, il faut l entendre.
async function lireSante(fetcher, site) {
  const r = await lire(fetcher, `${site}/api/healthz`);
  if (refusHttp(r)) return null;
  try {
    return JSON.parse(r.texte);
  } catch (erreur) {
    return null;
  }
}
function dateDe(sante, champ) {
  if (!sante) return undefined;
  const date = Date.parse(sante[champ]);
  return Number.isNaN(date) ? null : date;
}
const lireSauvegarde = async (fetcher, site) => dateDe(await lireSante(fetcher, site), 'derniereSauvegarde');

function momentSauvegarde(date, maintenant) {
  return date === null ? 'aucune date lisible' : `${jour(date)} à ${heure(date)}, il y a ${duree(maintenant - date)}`;
}

// Fonction pure, comme decider, et a cote d elle : une sauvegarde en retard ne
// touche ni au statut ni au compteur de panne. Un message au changement, rien entre.
export function deciderSauvegarde(etat, date, maintenant, simulation = false) {
  if (date === undefined) return etat;
  const enRetard = date === null || maintenant - date > SEUIL_SAUVEGARDE_MS;
  if (enRetard === Boolean(etat.sauvegardeEnRetard)) return etat;
  const marque = simulation || etat.sauvegardeEnRetard === 'simulation' ? '[simulation] ' : '';
  const texte = calme(enRetard
    ? `${marque}Pinlane : la sauvegarde de la nuit n’est pas partie.\nDernière réussie : ${momentSauvegarde(date, maintenant)}. Le site marche ; sans sauvegarde, une panne grave ferait perdre des réservations.\nCe que tu fais : demande une réparation, le détail technique est gardé dans la Tour de contrôle.`
    : `${marque}Réglé : la sauvegarde de la nuit n’était pas partie, depuis ${heure(maintenant)}.`);
  return {
    ...etat,
    sauvegardeEnRetard: enRetard ? (simulation ? 'simulation' : 'reelle') : null,
    aEnvoyer: [...etat.aEnvoyer, texte],
  };
}

// Meme famille que deciderSauvegarde : un message au changement, sans toucher a la panne.
export function deciderGarde(etat, date, maintenant) {
  if (date === undefined) return etat;
  const enRetard = date === null || maintenant - date > SEUIL_GARDE_MS;
  if (enRetard === Boolean(etat.gardeEnRetard)) return etat;
  const moment = date === null ? 'aucune date lisible' : `il y a ${duree(maintenant - date)}`;
  const texte = enRetard
    ? `Pinlane : la surveillance du quart d’heure ne tourne plus.\nDernier passage : ${moment}. Le site répond, mais plus rien ne surveille les mails, le secours ni les réservations ratées.\nCe que tu fais : demande une réparation, le détail technique est gardé dans la Tour de contrôle.`
    : calme(`Réglé : la surveillance du quart d’heure ne tournait plus, depuis ${heure(maintenant)}.`);
  return { ...etat, gardeEnRetard: enRetard, aEnvoyer: [...etat.aEnvoyer, texte] };
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
  const sauvegardeSimulee = simulation === SIMULATION_SAUVEGARDE;
  const surLeSite = Boolean(simulation) && !sauvegardeSimulee;
  const suspect = etat.statut === 'panne' || etat.echecs > 0;
  const profond = suspect || new Date(maintenant).getUTCMinutes() % 15 === 1;
  const vu = await sonder({
    fetcher, maintenant, profond, attendre, ...(surLeSite ? ciblesSimulees(simulation) : {}),
  });
  vu.simulation = surLeSite;
  let suivant = decider(etat, vu, maintenant);
  if (profond && !surLeSite) {
    const sante = sauvegardeSimulee ? null : await lireSante(fetcher, SITE);
    const date = sauvegardeSimulee ? null : dateDe(sante, 'derniereSauvegarde');
    suivant = deciderSauvegarde(suivant, date, maintenant, sauvegardeSimulee);
    // Champ absent : l application d avant cette garde, ou une lecture ratee. On ne sait rien.
    if (sante && sante.derniereGarde !== undefined) suivant = deciderGarde(suivant, dateDe(sante, 'derniereGarde'), maintenant);
  }

  // L etat s ecrit AVANT l envoi : un passage qui meurt ici laisse l alerte due,
  // le suivant la reprend. Rien ne change, rien ne s ecrit (KV gratuit, 1000/jour).
  const ecrit = JSON.stringify(suivant);
  if (ecrit !== brut) await kv.put(CLE_ETAT, ecrit);
  const restent = [];
  for (const du of suivant.aEnvoyer) {
    // Un message retenu avant le 2026-11-13 est une simple chaine : il part comme avant, avec la sonnerie.
    const m = typeof du === 'string' ? { texte: du } : du;
    try {
      await envoyer(m.texte, { calme: Boolean(m.calme) });
    } catch (erreur) {
      console.error('sonde: canal indisponible', erreur && erreur.message);
      restent.push(du);
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
    ? `Ce matin, tout le parcours répond (${vu.etapes} étapes).`
    : `Ce matin, une partie ne répond pas comme prévu : ${listeDesCasses(vu.casses)}.`;
  const derniere = etat.dernierePanne
    ? `Dernière panne : ${jour(etat.dernierePanne.debut)}, ${duree(etat.dernierePanne.fin - etat.dernierePanne.debut)}.`
    : 'Aucune panne enregistrée.';
  const date = await lireSauvegarde(fetcher, SITE);
  const sauvegarde = date === undefined ? 'Sauvegarde : pas de réponse ce matin.' : `Dernière sauvegarde : ${momentSauvegarde(date, maintenant)}.`;
  await envoyer(`Pinlane : la surveillance extérieure du site tourne.\n${parcours}\n${derniere} ${sauvegarde}\nRien à faire : c’est son passage du lundi.`, { calme: true });
}

// Ou part un message : le sujet du groupe si le groupe est branche, sinon la conversation.
export function destinationTelegram(env, sujet) {
  const groupe = String(env.TELEGRAM_GROUPE || '').trim();
  const fils = Object.fromEntries(String(env.TELEGRAM_SUJETS || '').split(',').map((m) => m.trim().match(/^([a-z]+)\s*[:=]\s*(\d{1,12})$/)).filter(Boolean).map((m) => [m[1], Number(m[2])]));
  const base = { text: '', disable_web_page_preview: true };
  if (/^-\d{5,20}$/.test(groupe) && fils[sujet]) return { ...base, chat_id: groupe, message_thread_id: fils[sujet], ...(sujet === 'pannes' ? {} : { disable_notification: true }) };
  return { ...base, chat_id: env.TELEGRAM_CHAT, ...(sujet === 'pannes' ? {} : { disable_notification: true }) };
}

async function posterTelegram(env, corps) {
  const api = env.TELEGRAM_API || 'https://api.telegram.org';
  const reponse = await fetch(`${api}/bot${env.TELEGRAM_JETON}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corps),
    signal: AbortSignal.timeout(DELAI_MS),
  });
  await reponse.body?.cancel();
  return reponse.status;
}

// La ligne « Ouvrir la facture de l’hébergeur » s ouvre d un toucher (un lien, pas une adresse en clair).
export function entitesDeLaSonde(texte) {
  const i = String(texte).indexOf(LIEN_FACTURE);
  return i < 0 ? [] : [{ type: 'text_link', offset: i, length: LIEN_FACTURE.length, url: FACTURATION_VERCEL }];
}

async function envoyerTelegram(env, texte, sujet = 'pannes', { calme: sansBruit = false } = {}) {
  const entites = entitesDeLaSonde(texte);
  const corps = { ...destinationTelegram(env, sujet), text: texte, ...(sansBruit ? { disable_notification: true } : {}), ...(entites.length ? { entities: entites } : {}) };
  const statut = await posterTelegram(env, corps);
  if (statut >= 200 && statut < 300) return;
  // Le groupe refuse (bot retire, sujet supprime) : la conversation, avec une ligne qui le dit.
  if (corps.message_thread_id && (statut === 400 || statut === 403)) {
    const repli = await posterTelegram(env, { chat_id: env.TELEGRAM_CHAT, text: `(Le groupe Pinlane refuse ce message, sujet ${sujet} : il arrive ici.)\n${texte}`, disable_web_page_preview: true });
    if (repli >= 200 && repli < 300) return;
  }
  throw new Error(`Telegram ${statut}`);
}

export default {
  async scheduled(controleur, env) {
    const dependances = {
      kv: env.ETAT,
      envoyer: (texte, options) => envoyerTelegram(env, texte, controleur.cron === CRON_BILAN ? 'bilans' : 'pannes', options),
      maintenant: controleur.scheduledTime,
    };
    if (controleur.cron === CRON_BILAN) await bilan(dependances);
    else await passage(dependances);
  },
};
