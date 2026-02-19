import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN!;
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE!;

// Cache klienta JWKS (reużywany między wywołaniami w tej samej instancji)
let client: ReturnType<typeof jwksClient> | null = null;

function getJwksClient() {
  if (!client) {
    client = jwksClient({
      jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600_000, // 10 minut
    });
  }
  return client;
}

export interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
}

export async function verifyToken(authHeader: string | undefined): Promise<AuthUser | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.split(' ')[1];

  try {
    const decoded = await new Promise<any>((resolve, reject) => {
      jwt.verify(
        token,
        (header, callback) => {
          getJwksClient().getSigningKey(header.kid, (err, key) => {
            if (err) return callback(err);
            callback(null, key!.getPublicKey());
          });
        },
        {
          audience: AUTH0_AUDIENCE,
          issuer: `https://${AUTH0_DOMAIN}/`,
          algorithms: ['RS256'],
        },
        (err, decoded) => {
          if (err) reject(err);
          else resolve(decoded);
        }
      );
    });

    return {
      sub: decoded.sub,
      email: decoded.email,
      name: decoded.name || decoded['https://transit-tracker/name'],
    };
  } catch (err: any) {
    console.error('[AUTH] Token verification failed:', err.message);
    return null;
  }
}
