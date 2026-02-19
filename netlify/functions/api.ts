import { Handler, HandlerEvent } from '@netlify/functions';
import { verifyToken } from './lib/auth';
import { Database } from './lib/db';
import { RecommendationEngine } from './lib/recommendation';

const json = (statusCode: number, body: object) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const handler: Handler = async (event: HandlerEvent) => {
  const db = new Database();

  try {
    const rawPath = event.path
      .replace('/.netlify/functions/api', '')
      .replace('/api/v1', '');
    const path = rawPath || '/';
    const method = event.httpMethod;

    console.log(`[REQUEST] ${method} ${path}`);

    await db.connect();

    // Health check (publiczny)
    if (path === '/health') {
      return json(200, { status: 'ok', timestamp: new Date().toISOString() });
    }

    // Auth – weryfikacja JWT Auth0
    const identityUser = await verifyToken(event.headers.authorization);
    if (!identityUser) return json(401, { error: 'Unauthorized' });

    // Upsert user
    let user = await db.getUserBySubject(identityUser.sub);
    if (!user) user = await db.createUser(identityUser.sub, identityUser.email, identityUser.name);

    // --- GET /me ---
    if (method === 'GET' && path === '/me') {
      const activeProfile = await db.getActiveProfile(user.id);
      return json(200, {
        user,
        active_profile: activeProfile?.profile ?? null,
      });
    }

    // --- GET /route-profiles ---
    if (method === 'GET' && path === '/route-profiles') {
      const profiles = await db.getProfiles(user.id);
      return json(200, { profiles });
    }

    // --- POST /route-profiles ---
    if (method === 'POST' && path === '/route-profiles') {
      const body = JSON.parse(event.body || '{}');
      if (!body.name) return json(400, { error: 'name is required' });
      const profile = await db.createProfile(user.id, body.name);
      return json(201, { profile });
    }

    // --- PUT/DELETE /route-profiles/:id ---
    const profileMatch = path.match(/^\/route-profiles\/([-\w]+)$/);
    if (profileMatch) {
      const profileId = profileMatch[1];
      const profile = await db.getProfileById(profileId, user.id);
      if (!profile) return json(404, { error: 'Profile not found' });

      if (method === 'PUT') {
        const body = JSON.parse(event.body || '{}');
        const updated = await db.updateProfile(profileId, user.id, body);
        return json(200, { profile: updated });
      }
      if (method === 'DELETE') {
        await db.deleteProfile(profileId, user.id);
        return json(200, { success: true });
      }
    }

    // --- GET/PUT /route-profiles/:id/segments ---
    const segmentsMatch = path.match(/^\/route-profiles\/([-\w]+)\/segments$/);
    if (segmentsMatch) {
      const profileId = segmentsMatch[1];
      const profile = await db.getProfileById(profileId, user.id);
      if (!profile) return json(404, { error: 'Profile not found' });

      if (method === 'GET') {
        const segments = await db.getSegments(profileId);
        return json(200, { segments });
      }
      if (method === 'PUT') {
        const body = JSON.parse(event.body || '{}');
        if (!Array.isArray(body.segments)) return json(400, { error: 'segments array required' });
        const segments = await db.replaceSegments(profileId, body.segments);
        return json(200, { segments });
      }
    }

    // --- GET/PUT /route-profiles/:id/transfer-config ---
    const configMatch = path.match(/^\/route-profiles\/([-\w]+)\/transfer-config$/);
    if (configMatch) {
      const profileId = configMatch[1];
      const profile = await db.getProfileById(profileId, user.id);
      if (!profile) return json(404, { error: 'Profile not found' });

      if (method === 'GET') {
        const config = await db.getTransferConfig(profileId);
        return json(200, { config });
      }
      if (method === 'PUT') {
        const body = JSON.parse(event.body || '{}');
        const config = await db.upsertTransferConfig(profileId, body);
        return json(200, { config });
      }
    }

    // --- GET /route/recommendation ---
    if (method === 'GET' && path === '/route/recommendation') {
      const profileId = event.queryStringParameters?.profile_id;
      const limit = parseInt(event.queryStringParameters?.limit || '5');
      if (!profileId) return json(400, { error: 'profile_id required' });

      const profileData = await db.getActiveProfileById(profileId, user.id);
      if (!profileData) return json(404, { error: 'Profile not found or not accessible' });

      const engine = new RecommendationEngine();
      const result = await engine.getRecommendations(profileData, limit);
      return json(200, result);
    }

    // --- GET /debug/timetable ---
    if (method === 'GET' && path === '/debug/timetable') {
      const stopId = event.queryStringParameters?.stop_id;
      if (!stopId) return json(400, { error: 'Missing stop_id' });
      const { CzynaczasClient } = await import('./lib/czynaczas');
      const client = new CzynaczasClient();
      const departures = await client.getDepartures(stopId, 10);
      return json(200, { stop_id: stopId, count: departures.length, departures });
    }

    return json(404, { error: `Route not found: ${path}` });
  } catch (error: any) {
    console.error('[SERVER ERROR]', error);
    return json(500, { error: error.message || 'Internal Server Error' });
  } finally {
    await db.disconnect();
  }
};
