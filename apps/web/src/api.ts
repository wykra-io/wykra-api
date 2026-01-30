type Json = Record<string, unknown>;

const API_TOKEN_STORAGE_KEY = 'wykraApiToken';

export function getApiBaseUrl(): string {
  const url = String(import.meta.env.VITE_API_URL ?? '').trim();
  return url || 'http://localhost:3011';
}

export function getApiToken(): string | null {
  try {
    return localStorage.getItem(API_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setApiToken(token: string | null): void {
  try {
    if (!token) {
      localStorage.removeItem(API_TOKEN_STORAGE_KEY);
      return;
    }
    localStorage.setItem(API_TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore storage failures (private mode, etc)
  }
}

export function apiUrl(pathname: string): string {
  return new URL(pathname, getApiBaseUrl()).toString();
}

export async function apiGet<T = unknown>(pathname: string): Promise<T> {
  const token = getApiToken();
  const res = await fetch(apiUrl(pathname), {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) {
    throw new Error(`GET ${pathname} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function apiPost<T = unknown>(
  pathname: string,
  body: Json,
): Promise<T> {
  const token = getApiToken();
  const res = await fetch(apiUrl(pathname), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${pathname} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}

export async function apiPatch<T = unknown>(
  pathname: string,
  body: Json,
): Promise<T> {
  const token = getApiToken();
  const res = await fetch(apiUrl(pathname), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PATCH ${pathname} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}

export async function apiDelete<T = unknown>(pathname: string): Promise<T> {
  const token = getApiToken();
  const res = await fetch(apiUrl(pathname), {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DELETE ${pathname} failed (${res.status}): ${text}`);
  }

  // Some DELETE endpoints may return no content
  if (res.status === 204) return undefined as T;
  const text = await res.text().catch(() => '');
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
