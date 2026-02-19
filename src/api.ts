// API client dla frontend
const API_BASE = '/.netlify/functions/api/api/v1';

function getToken(): string | null {
  // Netlify Identity przechowuje token w window.netlifyIdentity
  const ni = (window as any).netlifyIdentity;
  if (ni && ni.currentUser && ni.currentUser()) {
    return ni.currentUser().token?.access_token ?? null;
  }
  return null;
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {})
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
  createProfile: (name: string) => apiFetch('/route-profiles', { method: 'POST', body: JSON.stringify({ name }) }),
  updateProfile: (id: string, data: object) => apiFetch(`/route-profiles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProfile: (id: string) => apiFetch(`/route-profiles/${id}`, { method: 'DELETE' }),
  setActiveProfile: (id: string) => apiFetch(`/route-profiles/${id}`, { method: 'PUT', body: JSON.stringify({ is_active: true }) }),

  // Segments
  getSegments: (profileId: string) => apiFetch(`/route-profiles/${profileId}/segments`),
  replaceSegments: (profileId: string, segments: object[]) =>
    apiFetch(`/route-profiles/${profileId}/segments`, { method: 'PUT', body: JSON.stringify({ segments }) }),

  // Transfer Config
  getTransferConfig: (profileId: string) => apiFetch(`/route-profiles/${profileId}/transfer-config`),
  updateTransferConfig: (profileId: string, data: object) =>
    apiFetch(`/route-profiles/${profileId}/transfer-config`, { method: 'PUT', body: JSON.stringify(data) }),

  // Recommendation
  getRecommendation: (profileId: string, limit = 5) =>
    apiFetch(`/route/recommendation?profile_id=${profileId}&limit=${limit}`),
};
