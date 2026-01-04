type Json = Record<string, unknown>;

export function getApiBaseUrl(): string {
  const url = String(import.meta.env.VITE_API_URL ?? '').trim();
  return url || 'http://localhost:3011';
}

export function apiUrl(pathname: string): string {
  return new URL(pathname, getApiBaseUrl()).toString();
}

export async function apiGet<T = unknown>(pathname: string): Promise<T> {
  const res = await fetch(apiUrl(pathname), { method: 'GET' });
  if (!res.ok) {
    throw new Error(`GET ${pathname} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function apiPost<T = unknown>(
  pathname: string,
  body: Json,
): Promise<T> {
  const res = await fetch(apiUrl(pathname), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${pathname} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}


