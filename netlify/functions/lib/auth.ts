import { HandlerContext } from '@netlify/functions';

export interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
}

// Funkcja wyciągająca usera z kontekstu Netlify Functions.
// Działa TYLKO jeśli Netlify Identity zweryfikowało token przed wejściem do funkcji.
// Wymaga nagłówka Authorization: Bearer <token>
export function getUserFromContext(context: HandlerContext): AuthUser | null {
  const { clientContext } = context;
  const user = clientContext?.user;

  if (!user) {
    return null;
  }

  return {
    sub: user.sub,
    email: user.email,
    name: user.user_metadata?.full_name || user.email?.split('@')[0]
  };
}
