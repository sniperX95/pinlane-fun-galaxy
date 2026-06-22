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

function credentialsMatch(request: Request, username?: string, password?: string) {
  if (!username || !password) return false;
  const credentials = decodeBasicAuth(request.headers.get('authorization'));
  return Boolean(credentials && credentials.username === username && credentials.password === password);
}

export default function middleware(request: Request) {
  const { pathname } = new URL(request.url);
  const cronSecret = process.env.CRON_SECRET;

  if (
    (pathname === '/api/cron' || pathname.startsWith('/api/cron/')) &&
    cronSecret &&
    request.headers.get('authorization') === `Bearer ${cronSecret}`
  ) {
    return next();
  }

  const publicPaths = new Set([
    '/',
    '/index.html',
    '/api/public-reservations',
    '/api/public-availability',
    '/api/public-booking-meta',
    '/api/admin-range',
    '/api/marketing-agents',
    '/api/ops',
    '/api/simulation',
    '/api/staff-auth',
    '/api/staff-lanes',
    '/api/staff-reservations',
    '/api/staff-state',
    '/public-form.html',
    '/pro.html',
  ]);

  if (publicPaths.has(pathname) || pathname.startsWith('/assets/')) {
    return next();
  }

  const directionOnly = pathname === '/direction.html';
  if (directionOnly) {
    const directorUsername = process.env.DIRECTOR_USERNAME || process.env.SITE_USERNAME;
    const directorPassword = process.env.DIRECTOR_PASSWORD || process.env.SITE_PASSWORD;
    if (!credentialsMatch(request, directorUsername, directorPassword)) {
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

  if (!credentialsMatch(request, expectedUsername, expectedPassword)) {
    return unauthorized();
  }

  return next();
}

export const config = {
  matcher: '/:path*',
};
