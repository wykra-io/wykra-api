type Json = Record<string, unknown>;

const API_TOKEN_STORAGE_KEY = 'wykraApiToken';

function extractErrorMessage(payload: unknown): string | null {
  if (!payload) return null;
  if (typeof payload === 'string') return payload;
  if (typeof payload !== 'object') return null;

  const message = (payload as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) {
    const parts = message.filter((item) => typeof item === 'string');
    if (parts.length) return parts.join(', ');
  }

  const error = (payload as { error?: unknown }).error;
  if (typeof error === 'string') return error;

  return null;
}

async function readErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return fallback;

  try {
    const json = JSON.parse(text) as unknown;
    const message = extractErrorMessage(json);
    if (message) return message;
  } catch {
    // ignore JSON parse failures
  }

  return text;
}

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
    const fallback = `GET ${pathname} failed (${res.status})`;
    throw new Error(await readErrorMessage(res, fallback));
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
    const fallback = `POST ${pathname} failed (${res.status})`;
    throw new Error(await readErrorMessage(res, fallback));
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
    const fallback = `PATCH ${pathname} failed (${res.status})`;
    throw new Error(await readErrorMessage(res, fallback));
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
    const fallback = `DELETE ${pathname} failed (${res.status})`;
    throw new Error(await readErrorMessage(res, fallback));
  }

  // Some DELETE endpoints may return no content
  if (res.status === 204) return undefined as T;
  const text = await res.text().catch(() => '');
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
