import { useMemo, useState } from 'react';
import { getApiBaseUrl } from '../api';

function ProfileAvatar({
  proxiedUrl,
  username,
}: {
  proxiedUrl: string | null;
  username: string;
}) {
  const [error, setError] = useState(false);
  if (!proxiedUrl) return null;
  if (error) {
    return (
      <div
        className="tiktokSearchAvatarPlaceholder"
        title={username}
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: '#e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid #e2e8f0',
          color: '#64748b',
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        {(username || '?').charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={proxiedUrl}
      alt={username}
      onError={() => setError(true)}
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        objectFit: 'cover',
        border: '1px solid #e2e8f0',
      }}
    />
  );
}

type TikTokSearchResult = {
  profileUrl: string;
  account?: string;
  followers?: number | null;
  videosCount?: number | null;
  profileImageUrl?: string | null;
  isPrivate?: boolean | null;
  analysis: {
    summary: string;
    score: number;
  };
};

type TikTokSearchData = {
  query?: string;
  context?: {
    category?: string;
    location?: string;
    followers_range?: string;
  };
  analyzedProfiles: TikTokSearchResult[];
};

type Props = {
  data: TikTokSearchData;
};

function extractUsername(url: string): string {
  try {
    // https://www.tiktok.com/@username or /@username?...
    const match = url.match(/tiktok\.com\/@([^/?]+)/);
    return match ? match[1] : url;
  } catch {
    return url;
  }
}

function getScoreColor(score: number): string {
  if (score >= 4) return '#10b981'; // green
  if (score >= 3) return '#3b82f6'; // blue
  if (score >= 2) return '#f59e0b'; // amber
  return '#ef4444'; // red
}

export function TikTokSearchResults({ data }: Props) {
  const { context, analyzedProfiles } = data;

  return (
    <div className="tiktokSearchResults">
      {context && (context.category || context.location) && (
        <div className="tiktokSearchHeader">
          <div className="tiktokSearchContext">
            {context.category && (
              <span className="tiktokSearchTag">
                Category: {context.category}
              </span>
            )}
            {context.location && (
              <span className="tiktokSearchTag">
                Location: {context.location}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="tiktokSearchProfiles">
        {analyzedProfiles.length === 0 ? (
          <div className="tiktokSearchEmpty">No profiles found</div>
        ) : (
          analyzedProfiles.map((profile, index) => {
            const username =
              profile.account || extractUsername(profile.profileUrl);
            const scoreColor = getScoreColor(profile.analysis.score);

            const proxiedImageUrl = useMemo(() => {
              if (!profile.profileImageUrl) return null;
              try {
                const baseUrl = getApiBaseUrl();
                const encodedUrl = encodeURIComponent(profile.profileImageUrl);
                return `${baseUrl}/api/v1/proxy-image?url=${encodedUrl}`;
              } catch {
                return profile.profileImageUrl;
              }
            }, [profile.profileImageUrl]);

            const followers =
              typeof profile.followers === 'number'
                ? profile.followers.toLocaleString()
                : null;
            const videos =
              typeof profile.videosCount === 'number'
                ? profile.videosCount.toLocaleString()
                : null;

            return (
              <div key={index} className="tiktokSearchProfile">
                <div className="tiktokSearchProfileHeader">
                  <div className="tiktokSearchProfileInfo">
                    <ProfileAvatar
                      proxiedUrl={proxiedImageUrl}
                      username={username}
                    />

                    <a
                      href={profile.profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tiktokSearchProfileLink"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        xmlns="http://www.w3.org/2000/svg"
                        role="img"
                        aria-label="TikTok"
                      >
                        <title>TikTok</title>
                        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
                      </svg>
                      @{username}
                    </a>
                  </div>

                  <div className="tiktokSearchProfileScore">
                    <span style={{ color: scoreColor }}>
                      Score: {profile.analysis.score}/5
                    </span>
                    {(followers || videos) && (
                      <span style={{ marginLeft: 8, color: '#64748b' }}>
                        {followers && `${followers} followers`}
                        {followers && videos && ' • '}
                        {videos && `${videos} videos`}
                      </span>
                    )}
                  </div>
                </div>

                <div className="tiktokSearchProfileSummary">
                  {profile.analysis.summary}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
