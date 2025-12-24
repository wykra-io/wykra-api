export function normalizeTikTokProfileUrl(profileOrUrl: string): string {
  const trimmed = (profileOrUrl || '').trim();
  if (!trimmed) {
    return 'https://www.tiktok.com/@';
  }

  // If it already has a scheme, assume it's a URL
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // If user pasted a URL without scheme
  if (/^www\./i.test(trimmed) || /tiktok\.com/i.test(trimmed)) {
    return `https://${trimmed.replace(/^\/+/, '')}`;
  }

  // Otherwise treat as handle
  let handle = trimmed;
  if (handle.startsWith('@')) {
    handle = handle.slice(1);
  }
  handle = handle.replace(/^tiktok\.com\/@/i, '');
  return `https://www.tiktok.com/@${handle}`;
}

export function extractHashtags(text: string): string[] {
  if (!text) {
    return [];
  }
  const hashtagRegex = /#[\w]+/g;
  const matches = text.match(hashtagRegex);
  return matches ? matches.map((tag) => tag.substring(1)) : [];
}

/**
 * Normalizes a free-form country or location string into an ISO 3166-1 alpha-2 code when possible.
 */
export function normalizeCountryCode(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  // Already looks like a 2-letter country code
  if (/^[a-z]{2}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  const lower = trimmed.toLowerCase();

  const map: Record<string, string> = {
    // Common examples and aliases
    portugal: 'PT',
    'portuguese republic': 'PT',
    'united states': 'US',
    'united states of america': 'US',
    usa: 'US',
    us: 'US',
    america: 'US',
    'united kingdom': 'GB',
    uk: 'GB',
    england: 'GB',
    scotland: 'GB',
    wales: 'GB',
    'northern ireland': 'GB',
    germany: 'DE',
    deutschland: 'DE',
    france: 'FR',
    spain: 'ES',
    espana: 'ES',
    españa: 'ES',
    italy: 'IT',
    italia: 'IT',
    canada: 'CA',
    australia: 'AU',
    brazil: 'BR',
    brasil: 'BR',
    mexico: 'MX',
    japan: 'JP',
    nippon: 'JP',
    china: 'CN',
    india: 'IN',
  };

  return map[lower] ?? null;
}
