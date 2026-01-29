import type { Platform, ProfileCardData } from '../components/ProfileCard';

export function detectPlatformFromMessage(
  content: string,
  detectedEndpoint?: string,
): Platform | null {
  if (content.includes('[INSTAGRAM_PROFILE_ANALYSIS]')) return 'instagram';
  if (content.includes('[TIKTOK_PROFILE_ANALYSIS]')) return 'tiktok';

  if (detectedEndpoint) {
    if (detectedEndpoint.includes('/instagram/')) return 'instagram';
    if (detectedEndpoint.includes('/tiktok/')) return 'tiktok';
  }

  return null;
}

export function parseProfileCardData(
  content: string,
  platform: Platform,
): ProfileCardData | null {
  try {
    const cleanedContent = content
      .replace(/\[INSTAGRAM_PROFILE_ANALYSIS\]\n?/, '')
      .replace(/\[TIKTOK_PROFILE_ANALYSIS\]\n?/, '')
      .trim();

    const parsed = JSON.parse(cleanedContent) as {
      profile: string;
      data: ProfileCardData['data'];
      analysis?: ProfileCardData['analysis'];
    };

    return {
      platform,
      profile: parsed.profile,
      data: parsed.data,
      analysis: parsed.analysis,
    };
  } catch {
    return null;
  }
}

export type InstagramSearchData = {
  query?: string;
  context?: {
    category?: string;
    location?: string;
    followers_range?: string;
  };
  analyzedProfiles: Array<{
    profileUrl: string;
    followers: number | null;
    postsCount: number | null;
    avgEngagement: number | null;
    profileImageUrl: string | null;
    analysis: {
      summary: string;
      score: number;
    };
  }>;
};

export function parseInstagramSearchResults(
  content: string,
): InstagramSearchData | null {
  type ParsedInstagramSearchPayload = {
    query?: string;
    context?: {
      category?: string;
      location?: string;
      followers_range?: string;
    };
    analyzedProfiles?: Array<{
      profileUrl?: string;
      followers?: number | null;
      postsCount?: number | null;
      avgEngagement?: number | null;
      profileImageUrl?: string | null;
      analysis?: {
        summary?: string;
        score?: number;
      };
    }>;
    instagramUrls?: string[];
  };

  const normalizeSearchPayload = (
    parsed: ParsedInstagramSearchPayload,
  ): InstagramSearchData | null => {
    let profiles: InstagramSearchData['analyzedProfiles'] = [];

    if (
      parsed.analyzedProfiles &&
      Array.isArray(parsed.analyzedProfiles) &&
      parsed.analyzedProfiles.length > 0
    ) {
      profiles = parsed.analyzedProfiles
        .filter(
          (profile) =>
            profile &&
            typeof profile.profileUrl === 'string' &&
            profile.profileUrl.includes('instagram.com'),
        )
        .map((profile) => ({
          profileUrl: profile.profileUrl as string,
          followers:
            typeof profile.followers === 'number' ? profile.followers : null,
          postsCount:
            typeof profile.postsCount === 'number' ? profile.postsCount : null,
          avgEngagement:
            typeof profile.avgEngagement === 'number'
              ? profile.avgEngagement
              : null,
          profileImageUrl:
            typeof profile.profileImageUrl === 'string' &&
            profile.profileImageUrl.length > 0
              ? profile.profileImageUrl
              : null,
          analysis: {
            summary:
              profile.analysis && typeof profile.analysis.summary === 'string'
                ? profile.analysis.summary
                : 'No detailed analysis provided for this profile yet.',
            score:
              profile.analysis && typeof profile.analysis.score === 'number'
                ? profile.analysis.score
                : 0,
          },
        }));
    }

    // Fallback: if no analyzedProfiles but we have instagramUrls, build minimal entries
    if (
      profiles.length === 0 &&
      parsed.instagramUrls &&
      Array.isArray(parsed.instagramUrls) &&
      parsed.instagramUrls.length > 0
    ) {
      profiles = parsed.instagramUrls
        .filter(
          (url): url is string =>
            typeof url === 'string' && url.includes('instagram.com'),
        )
        .map((url) => ({
          profileUrl: url,
          followers: null,
          postsCount: null,
          avgEngagement: null,
          profileImageUrl: null,
          analysis: {
            summary: 'Profile discovered in search results (no analysis yet).',
            score: 0,
          },
        }));
    }

    if (profiles.length === 0) {
      return null;
    }

    return {
      query: parsed.query,
      context: parsed.context,
      analyzedProfiles: profiles,
    };
  };

  try {
    // Try to parse as JSON directly
    const parsed = JSON.parse(content.trim()) as ParsedInstagramSearchPayload;
    return normalizeSearchPayload(parsed);
  } catch {
    // If direct parsing fails, try to extract JSON from the content
    try {
      // Look for JSON object in the content
      const jsonMatch = content.match(
        /\{[\s\S]*"(analyzedProfiles|instagramUrls)"[\s\S]*\}/,
      );
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as ParsedInstagramSearchPayload;
        return normalizeSearchPayload(parsed);
      }
    } catch {
      // Ignore parsing errors
    }

    return null;
  }
}
