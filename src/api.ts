// API client dla frontend – Auth0 token
const API_BASE = '/.netlify/functions/api/api/v1';

// Token getter jest wstrzykiwany przez App po inicjalizacji Auth0
let _getToken: (() => Promise<string | null>) | null = null;

export function setTokenGetter(fn: () => Promise<string | null>) {
  _getToken = fn;
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const token = _getToken ? await _getToken() : null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json();

  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  getMe: () => apiFetch('/me'),

  // Profiles
  getProfiles: () => apiFetch('/route-profiles'),
  createProfile: (name: string) =>
    apiFetch('/route-profiles', { method: 'POST', body: JSON.stringify({ name }) }),
  updateProfile: (id: string, data: object) =>
    apiFetch(`/route-profiles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProfile: (id: string) =>
    apiFetch(`/route-profiles/${id}`, { method: 'DELETE' }),
  setActiveProfile: (id: string) =>
    apiFetch(`/route-profiles/${id}`, { method: 'PUT', body: JSON.stringify({ is_active: true }) }),

  // Segments
  getSegments: (profileId: string) =>
    apiFetch(`/route-profiles/${profileId}/segments`),
  replaceSegments: (profileId: string, segments: object[]) =>
    apiFetch(`/route-profiles/${profileId}/segments`, {
      method: 'PUT',
      body: JSON.stringify({ segments }),
    }),

  // Transfer Config
  getTransferConfig: (profileId: string) =>
    apiFetch(`/route-profiles/${profileId}/transfer-config`),
  updateTransferConfig: (profileId: string, data: object) =>
    apiFetch(`/route-profiles/${profileId}/transfer-config`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // Recommendation
  getRecommendation: (profileId: string, limit = 5) =>
    apiFetch(`/route/recommendation?profile_id=${profileId}&limit=${limit}`),
};
