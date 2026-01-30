const TRAILING_PUNCTUATION_REGEX = /[)\]}>,.!?:;"'`]+$/g;

function stripTrailingPunctuation(value: string): string {
  return value.replace(TRAILING_PUNCTUATION_REGEX, '');
}

/**
 * Normalize an Instagram profile input into a username.
 *
 * Accepts:
 * - full profile URL (with or without scheme)
 * - @username
 * - username
 *
 * Keeps username symbols like '.' and '_' (does not over-restrict),
 * but strips obvious trailing punctuation from copy/paste contexts.
 */
export function normalizeInstagramUsername(profileOrUrl: string): string {
  const raw = String(profileOrUrl ?? '').trim();
  if (!raw) {
    return '';
  }

  const trimmed = stripTrailingPunctuation(raw);

  // If it looks like a URL or contains instagram.com, try to parse it as URL.
  if (/^https?:\/\//i.test(trimmed) || /instagram\.com/i.test(trimmed)) {
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed.replace(/^\/+/, '')}`;

    try {
      const url = new URL(withScheme);
      const host = url.hostname.toLowerCase();

      if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
        const segments = url.pathname
          .split('/')
          .map((s) => s.trim())
          .filter(Boolean);

        // Handle /stories/{username}/{storyId}/
        if (segments[0] === 'stories' && typeof segments[1] === 'string') {
          return normalizeInstagramUsername(segments[1]);
        }

        // Typical profile URL: /{username}/
        if (typeof segments[0] === 'string') {
          return normalizeInstagramUsername(segments[0]);
        }
      }
    } catch {
      // Fall through to handle parsing below.
    }
  }

  // Handle form: instagram.com/username (without scheme) where URL parsing failed.
  const noScheme = trimmed.replace(/^\/+/, '');
  const matchDomain = noScheme.match(/instagram\.com\/([^/?#\s]+)/i);
  if (matchDomain?.[1]) {
    return normalizeInstagramUsername(matchDomain[1]);
  }

  // Otherwise treat as a handle / username token.
  let candidate = trimmed.replace(/^@+/, '');
  candidate = candidate.split(/[/?#\s]/)[0] ?? '';
  candidate = stripTrailingPunctuation(candidate);

  // Keep common allowed characters, but don't over-restrict (allow dots/underscores).
  // If the user pasted extra text, try extracting the first plausible username-like token.
  const tokenMatch = candidate.match(/^[a-z0-9._]+/i);
  const token = tokenMatch?.[0] ?? candidate;

  return token;
}

export function normalizeInstagramProfileUrl(profileOrUrl: string): string {
  const username = normalizeInstagramUsername(profileOrUrl);
  return username ? `https://www.instagram.com/${username}/` : '';
}

