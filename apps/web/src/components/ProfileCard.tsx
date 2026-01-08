import { useState, useEffect, useMemo } from 'react';
import { getApiBaseUrl } from '../api';

export type Platform = 'instagram' | 'tiktok';

export type ProfileData = {
  profile_name?: string;
  full_name?: string;
  profile_image_link?: string; // Instagram
  profile_pic_url?: string; // TikTok
  profile_url?: string;
  url?: string; // TikTok
  followers?: number;
  posts_count?: number;
  videos_count?: number;
  avg_engagement?: number;
  is_verified?: boolean;
  is_private?: boolean;
  // Allow additional platform-specific fields
  [key: string]: unknown;
};

export type ProfileAnalysis = {
  summary?: string;
  qualityScore?: number;
  topic?: string;
  niche?: string;
  engagementStrength?: string;
  contentAuthenticity?: string;
  followerAuthenticity?: string;
  // Allow additional platform-specific analysis fields
  [key: string]: unknown;
};

export type ProfileCardData = {
  platform: Platform;
  profile: string;
  data: ProfileData;
  analysis?: ProfileAnalysis;
};

type ProfileCardProps = {
  data: ProfileCardData;
};

function getPlatformUrl(
  platform: Platform,
  profile: string,
  profileUrl?: string,
): string | null {
  if (profileUrl) {
    return profileUrl;
  }

  const username = profile.replace(/^@/, '');

  switch (platform) {
    case 'instagram':
      return `https://www.instagram.com/${username}/`;
    case 'tiktok':
      return `https://www.tiktok.com/@${username}`;
    default:
      return null;
  }
}

function formatStat(value: number | undefined): string | null {
  return value ? value.toLocaleString() : null;
}

function formatEngagement(value: number | undefined): string | null {
  return value ? `${(value * 100).toFixed(2)}%` : null;
}

export function ProfileCard({ data }: ProfileCardProps) {
  const profileName =
    data.data.full_name || data.data.profile_name || data.profile;
  // TikTok uses profile_pic_url, Instagram uses profile_image_link
  const profileImage =
    data.data.profile_pic_url || data.data.profile_image_link;
  const followers = formatStat(data.data.followers);
  const posts = formatStat(data.data.posts_count || data.data.videos_count);
  const engagement = formatEngagement(data.data.avg_engagement);

  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Reset states when image URL changes
  useEffect(() => {
    setImageError(false);
    setImageLoaded(false);
  }, [profileImage]);

  // Create proxied image URL to bypass CORS
  const proxiedImageUrl = useMemo(() => {
    if (!profileImage) return null;
    try {
      const baseUrl = getApiBaseUrl();
      const encodedUrl = encodeURIComponent(profileImage);
      return `${baseUrl}/api/v1/proxy-image?url=${encodedUrl}`;
    } catch {
      return profileImage; // Fallback to original URL if encoding fails
    }
  }, [profileImage]);

  // Construct profile URL based on platform
  const profileUrl = useMemo(() => {
    // TikTok uses 'url' field, Instagram uses 'profile_url'
    const url = data.data.url || data.data.profile_url;
    return getPlatformUrl(data.platform, data.profile, url);
  }, [data.platform, data.profile, data.data.url, data.data.profile_url]);

  const platformClass = `profileCard-${data.platform}`;

  return (
    <div className={`profileCard ${platformClass}`}>
      <div className="profileCardHeader">
        {profileImage ? (
          <>
            {!imageLoaded && !imageError && (
              <div className="profileCardImagePlaceholder">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M20 21a8 8 0 0 0-16 0"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
              </div>
            )}
            {proxiedImageUrl && (
              <img
                src={proxiedImageUrl}
                alt={profileName}
                className="profileCardImage"
                onLoad={() => {
                  setImageLoaded(true);
                  setImageError(false);
                }}
                onError={() => {
                  // Only set error after onLoad hasn't fired
                  if (!imageLoaded) {
                    setImageError(true);
                  }
                }}
                style={{
                  display: imageLoaded && !imageError ? 'block' : 'none',
                }}
              />
            )}
            {imageError && (
              <div className="profileCardImagePlaceholder">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M20 21a8 8 0 0 0-16 0"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
              </div>
            )}
          </>
        ) : (
          <div className="profileCardImagePlaceholder">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M20 21a8 8 0 0 0-16 0"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d="M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
          </div>
        )}
        <div className="profileCardInfo">
          <div className="profileCardName">
            {profileUrl ? (
              <a
                href={profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="profileCardLink"
              >
                {profileName}
              </a>
            ) : (
              profileName
            )}
            {data.data.is_verified && (
              <span className="profileCardVerified" title="Verified">
                ✓
              </span>
            )}
          </div>
          <div className="profileCardStats">
            {followers && <span>{followers} followers</span>}
            {posts && (
              <span>
                {posts} {data.data.videos_count ? 'videos' : 'posts'}
              </span>
            )}
            {engagement && <span>{engagement} engagement</span>}
          </div>
        </div>
      </div>
      {data.analysis?.summary && (
        <div className="profileCardAnalysis">
          <div className="profileAnalysisSection">
            <h4>Summary</h4>
            <p>{data.analysis.summary}</p>
          </div>
          {data.analysis.topic && (
            <div className="profileAnalysisRow">
              <span className="profileAnalysisLabel">Topic:</span>
              <span>{data.analysis.topic}</span>
            </div>
          )}
          {data.analysis.niche && (
            <div className="profileAnalysisRow">
              <span className="profileAnalysisLabel">Niche:</span>
              <span>{data.analysis.niche}</span>
            </div>
          )}
          {data.analysis.qualityScore !== undefined && (
            <div className="profileAnalysisRow">
              <span className="profileAnalysisLabel">Quality Score:</span>
              <span>{data.analysis.qualityScore}/5</span>
            </div>
          )}
          {data.analysis.engagementStrength && (
            <div className="profileAnalysisRow">
              <span className="profileAnalysisLabel">Engagement:</span>
              <span>{data.analysis.engagementStrength}</span>
            </div>
          )}
          {data.analysis.contentAuthenticity && (
            <div className="profileAnalysisRow">
              <span className="profileAnalysisLabel">Content:</span>
              <span>{data.analysis.contentAuthenticity}</span>
            </div>
          )}
          {data.analysis.followerAuthenticity && (
            <div className="profileAnalysisRow">
              <span className="profileAnalysisLabel">Followers:</span>
              <span>{data.analysis.followerAuthenticity}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
