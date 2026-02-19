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
