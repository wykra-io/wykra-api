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
    followers?: number | null;
    postsCount?: number | null;
    avgEngagement?: number | null;
    profileImageUrl?: string | null;
    analysis: {
      summary: string;
      score: number;
    };
  }>;
};

export function parseInstagramSearchResults(
  content: string,
): InstagramSearchData | null {
  try {
    // Try to parse as JSON directly
    const parsed = JSON.parse(content.trim()) as {
      query?: string;
      context?: {
        category?: string;
        location?: string;
        followers_range?: string;
      };
      analyzedProfiles?: Array<{
        profileUrl: string;
        analysis: {
          summary: string;
          score: number;
        };
      }>;
    };

    // Check if it has the structure of Instagram search results
    if (
      parsed.analyzedProfiles &&
      Array.isArray(parsed.analyzedProfiles) &&
      parsed.analyzedProfiles.length > 0
    ) {
      return {
        query: parsed.query,
        context: parsed.context,
        analyzedProfiles: parsed.analyzedProfiles,
      };
    }

    return null;
  } catch {
    // If direct parsing fails, try to extract JSON from the content
    try {
      // Look for JSON object in the content
      const jsonMatch = content.match(/\{[\s\S]*"analyzedProfiles"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          query?: string;
          context?: {
            category?: string;
            location?: string;
            followers_range?: string;
          };
          analyzedProfiles?: Array<{
            profileUrl: string;
            analysis: {
              summary: string;
              score: number;
            };
          }>;
        };

        if (
          parsed.analyzedProfiles &&
          Array.isArray(parsed.analyzedProfiles) &&
          parsed.analyzedProfiles.length > 0
        ) {
          return {
            query: parsed.query,
            context: parsed.context,
            analyzedProfiles: parsed.analyzedProfiles,
          };
        }
      }
    } catch {
      // Ignore parsing errors
    }

    return null;
  }
}
