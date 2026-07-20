import { next } from '@vercel/functions';

declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

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
    return next();
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
    '/favicon.ico',
  ]);

  if (
    publicPaths.has(pathname)
    || pathname.startsWith('/assets/')
    || pathname === '/menu'
    || pathname.startsWith('/menu/')
  ) {
    return next();
  }

  const directionOnly = pathname === '/direction.html';
  if (directionOnly) {
    const directorUsername = process.env.DIRECTOR_USERNAME || process.env.SITE_USERNAME;
    const directorPassword = process.env.DIRECTOR_PASSWORD || process.env.SITE_PASSWORD;
    if (!await credentialsMatch(request, directorUsername, directorPassword)) {
      return forbiddenDirection();
    }
    return next();
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

  return next();
}

export const config = {
  matcher: '/:path*',
};
