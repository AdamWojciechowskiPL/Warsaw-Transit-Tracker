import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { HandlerContext } from '@netlify/functions';

export interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
}

// Lazy – inicjalizujemy dopiero przy pierwszym wywołaniu,
// żeby błędy brakujących env vars były widoczne w logach funkcji.
let _JWKS: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (_JWKS) return _JWKS;

  const domain = process.env.AUTH0_DOMAIN;
  if (!domain) {
    console.error('[AUTH] FATAL: AUTH0_DOMAIN env var is not set!');
    throw new Error('AUTH0_DOMAIN is not configured');
  }

  const jwksUrl = `https://${domain}/.well-known/jwks.json`;
  console.log('[AUTH] Initializing JWKS from:', jwksUrl);
  _JWKS = createRemoteJWKSet(new URL(jwksUrl));
  return _JWKS;
}

function getIssuer(): string {
  const domain = process.env.AUTH0_DOMAIN!;
  const base = process.env.AUTH0_ISSUER_BASE_URL;
  return base ? base.replace(/\/$/, '') + '/' : `https://${domain}/`;
}

export async function verifyToken(
  authHeader: string | undefined
): Promise<AuthUser | null> {
  if (!authHeader) {
    console.log('[AUTH] No Authorization header present');
    return null;
  }
  if (!authHeader.startsWith('Bearer ')) {
    console.log('[AUTH] Authorization header does not start with Bearer');
    return null;
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    console.log('[AUTH] Empty token after Bearer');
    return null;
  }

  // Szybka walidacja formatu JWT (3 segmenty)
  const parts = token.split('.');
  if (parts.length !== 3) {
    console.error('[AUTH] Token is not a JWT (opaque token?). Parts:', parts.length);
    console.error('[AUTH] Make sure AUTH0_AUDIENCE is set both in Netlify env AND in Auth0Provider (authorizationParams.audience)');
    return null;
  }

  const audience = process.env.AUTH0_AUDIENCE;
  const issuer = getIssuer();

  console.log('[AUTH] Verifying JWT | issuer:', issuer, '| audience:', audience || '(none)');

  try {
    const JWKS = getJWKS();
    const { payload } = await jwtVerify(token, JWKS, {
      issuer,
      ...(audience ? { audience } : {}),
      algorithms: ['RS256'],
    });

    console.log('[AUTH] JWT valid | sub:', payload.sub);
    return {
      sub: payload.sub!,
      email: payload['email'] as string | undefined,
      name: payload['name'] as string | undefined,
    };
  } catch (err: any) {
    console.error('[AUTH] JWT verify failed:', err.message);
    console.error('[AUTH] issuer used:', issuer);
    console.error('[AUTH] audience used:', audience || '(none)');
    // Decode header+payload for debugging (without verification)
    try {
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      console.error('[AUTH] Token header:', JSON.stringify(header));
      console.error('[AUTH] Token claims: iss=' + payload.iss + ' aud=' + JSON.stringify(payload.aud) + ' exp=' + payload.exp);
    } catch (_) {}
    return null;
  }
}

/**
 * @deprecated – używany był z Netlify Identity (clientContext).
 * Zostawiony dla kompatybilności, nie używany w api.ts.
 */
export function getUserFromContext(context: HandlerContext): AuthUser | null {
  try {
    const user = (context as any).clientContext?.user;
    if (user?.sub) {
      return { sub: user.sub, email: user.email, name: user.user_metadata?.full_name ?? user.name };
    }
    return null;
  } catch (err: any) {
    console.error('[AUTH] getUserFromContext error:', err.message);
    return null;
  }
}
