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


