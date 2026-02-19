/**
 * Weryfikacja JWT Auth0 przez natywną integrację Netlify+Auth0.
 *
 * Netlify Extension automatycznie wstrzykuje:
 *   AUTH0_DOMAIN          – np. dev-xxx.eu.auth0.com
 *   AUTH0_ISSUER_BASE_URL – np. https://dev-xxx.eu.auth0.com
 *   AUTH0_CLIENT_ID       – client id aplikacji
 *   AUTH0_AUDIENCE        – audience API (jeśli skonfigurowane)
 *
 * Weryfikujemy access token (RS256) przez JWKS z CDN Auth0.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { HandlerContext } from '@netlify/functions';

const domain = process.env.AUTH0_DOMAIN!;
const issuer = process.env.AUTH0_ISSUER_BASE_URL
  ? process.env.AUTH0_ISSUER_BASE_URL.replace(/\/$/, '') + '/'
  : `https://${domain}/`;
const audience = process.env.AUTH0_AUDIENCE;

// JWKS jest cachowany przez jose automatycznie
const JWKS = createRemoteJWKSet(
  new URL(`https://${domain}/.well-known/jwks.json`)
);

export interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
}

export async function verifyToken(
  authHeader: string | undefined
): Promise<AuthUser | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer,
      ...(audience ? { audience } : {}),
      algorithms: ['RS256'],
    });

    return {
      sub: payload.sub!,
      email: payload['email'] as string | undefined,
      name: payload['name'] as string | undefined,
    };
  } catch (err: any) {
    console.error('[AUTH] JWT verify failed:', err.message);
    return null;
  }
}

/**
 * Wyciąga dane użytkownika z clientContext wstrzykiwanego przez
 * Netlify Identity (lub Netlify + Auth0 extension).
 * Zwraca AuthUser lub null jeśli brak/nieprawidłowy token.
 */
export function getUserFromContext(context: HandlerContext): AuthUser | null {
  try {
    const identity = (context as any).clientContext?.identity;
    const user = (context as any).clientContext?.user;

    if (user && user.sub) {
      return {
        sub: user.sub,
        email: user.email,
        name: user.user_metadata?.full_name ?? user.name,
      };
    }

    // Fallback: sprawdź pole identity.token (starszy format)
    if (identity && identity.token) {
      // Zdekoduj payload bez weryfikacji (weryfikacja była już po stronie Netlify)
      const parts = identity.token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        if (payload.sub) {
          return {
            sub: payload.sub,
            email: payload.email,
            name: payload.name,
          };
        }
      }
    }

    return null;
  } catch (err: any) {
    console.error('[AUTH] getUserFromContext error:', err.message);
    return null;
  }
}
