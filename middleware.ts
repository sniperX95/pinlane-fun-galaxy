import { next } from '@vercel/functions';

declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

/* QUI A LE DROIT D'EMBARQUER LE PARCOURS DE RESERVATION.
   Le tunnel client n'est pas fait pour vivre sur le domaine de Pinlane : il
   s'installe DANS le site de chaque client (iframe). C'est `frame-ancestors`
   qui autorise cet embarquement, et il vivait en dur dans vercel.json - donc
   chaque nouveau client demandait un DEPLOIEMENT pour que son site cesse
   d'afficher un cadre vide. Un SaaS ne peut pas facturer un deploiement par
   installation.
   La liste vient desormais de la variable d'environnement EMBED_ORIGINS
   (origines separees par des virgules) : ajouter un client = ajouter une
   origine dans Vercel, sans toucher au code. En l'absence de variable, on
   retombe EXACTEMENT sur la liste historique : aucune installation existante
   ne casse le jour du deploiement.
   Note : `vercel.json` ne sait pas lire de variable d'environnement, d'ou le
   passage par le middleware. La directive a donc ete RETIREE de vercel.json -
   deux en-tetes CSP se cumulent en intersection, et la garder aux deux endroits
   aurait fige la liste la plus restrictive. */
const DEFAULT_EMBED_ORIGINS = [
  'https://fungalaxy.be',
  'https://www.fungalaxy.be',
  'https://mngfunglxy.com',
  'https://www.mngfunglxy.com',
];

function embedAncestors(): string {
  const raw = (process && process.env && process.env.EMBED_ORIGINS) || '';
  const configured = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    // Une origine, pas une URL : on refuse tout ce qui porte un chemin, et tout
    // ce qui n'est pas en https (une origine http autoriserait un site non
    // chiffre a encadrer le parcours de paiement d'un client).
    .filter((value) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(value));
  const all = Array.from(new Set([...configured, ...DEFAULT_EMBED_ORIGINS]));
  return `frame-ancestors 'self' ${all.join(' ')}`;
}

function passThrough() {
  return next({ headers: { 'Content-Security-Policy': embedAncestors() } });
}

function unauthorized() {
  return new Response('Acces restreint.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Fun Galaxy", charset="UTF-8"',
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

function forbiddenDirection() {
  return new Response('Acces direction requis.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Fun Galaxy Direction", charset="UTF-8"',
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

function decodeBasicAuth(header: string | null) {
  if (!header || !header.startsWith('Basic ')) return null;

  try {
    const decoded = atob(header.slice(6));
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex === -1) return null;

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

const secretEncoder = new TextEncoder();

// Comparaison a temps constant compatible runtime Edge : ce middleware tourne
// sur l'Edge de Vercel, ou node:crypto (et donc crypto.timingSafeEqual) n'est
// pas garanti. On passe par WebCrypto et on compare des empreintes SHA-256 de
// LONGUEUR FIXE (32 octets) : la duree ne depend ni du contenu ni de la
// longueur des secrets, et l'accumulation XOR ne court-circuite jamais, donc
// aucun signal ne fuit le prefixe correct.
async function timingSafeEqualText(left: string, right: string) {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', secretEncoder.encode(left)),
    crypto.subtle.digest('SHA-256', secretEncoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let diff = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index];
  }
  return diff === 0;
}

async function credentialsMatch(request: Request, username?: string, password?: string) {
  if (!username || !password) return false;
  const credentials = decodeBasicAuth(request.headers.get('authorization'));
  if (!credentials) return false;
  // Les deux comparaisons sont evaluees avant d'etre combinees : un identifiant
  // correct ne doit pas se distinguer par la duree de la reponse.
  const usernameOk = await timingSafeEqualText(credentials.username, username);
  const passwordOk = await timingSafeEqualText(credentials.password, password);
  return usernameOk && passwordOk;
}

export default async function middleware(request: Request) {
  const { pathname } = new URL(request.url);
  const cronSecret = process.env.CRON_SECRET;

  if (
    (pathname === '/api/cron' || pathname.startsWith('/api/cron/')) &&
    cronSecret &&
    await timingSafeEqualText(request.headers.get('authorization') || '', `Bearer ${cronSecret}`)
  ) {
    return passThrough();
  }

  const publicPaths = new Set([
    '/',
    '/index.html',
    '/api/public-reservations',
    '/api/public-availability',
    '/api/public-booking-meta',
    '/api/healthz',
    '/api/admin-range',
    '/api/inbound-email',
    '/api/marketing-agents',
    '/api/r',
    '/api/u',
    '/api/ops',
    '/api/pilot-lead',
    // Demande sur mesure du parcours CLIENT (groupe, entreprise, privatisation).
    // Elle manquait ici : le middleware repondait 401 avec un en-tete
    // WWW-Authenticate, et le navigateur ouvrait sa fenetre « Se connecter » a
    // la figure du client au moment d'envoyer sa demande. Aucun client ne peut
    // avoir d'identifiants : l'envoi echouait a tous les coups.
    '/api/custom-request',
    '/api/simulation',
    '/api/staff-auth',
    '/api/staff-lanes',
    '/api/staff-reservations',
    '/api/staff-state',
    '/public-form.html',
    '/pro.html',
    '/reserver',
    '/robots.txt',
    '/sitemap.xml',
    // Le script d'installation est charge par le SITE DU CLIENT : il doit
    // etre lisible sans identifiants, comme le parcours qu'il embarque.
    '/embed.js',
    '/favicon.ico',
  ]);

  if (
    publicPaths.has(pathname)
    || pathname.startsWith('/assets/')
    || pathname === '/menu'
    || pathname.startsWith('/menu/')
  ) {
    return passThrough();
  }

  const directionOnly = pathname === '/direction.html';
  if (directionOnly) {
    const directorUsername = process.env.DIRECTOR_USERNAME || process.env.SITE_USERNAME;
    const directorPassword = process.env.DIRECTOR_PASSWORD || process.env.SITE_PASSWORD;
    if (!await credentialsMatch(request, directorUsername, directorPassword)) {
      return forbiddenDirection();
    }
    return passThrough();
  }

  const expectedUsername = process.env.SITE_USERNAME;
  const expectedPassword = process.env.SITE_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    return new Response('Configuration de securite incomplete.', {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }

  if (!await credentialsMatch(request, expectedUsername, expectedPassword)) {
    return unauthorized();
  }

  return passThrough();
}

export const config = {
  matcher: '/:path*',
};
