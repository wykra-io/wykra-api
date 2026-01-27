import { useMemo } from 'react';
import { getApiBaseUrl } from '../api';

type InstagramSearchResult = {
  profileUrl: string;
  followers?: number | null;
  postsCount?: number | null;
  avgEngagement?: number | null;
  profileImageUrl?: string | null;
  analysis: {
    summary: string;
    score: number;
  };
};

type InstagramSearchData = {
  query?: string;
  context?: {
    category?: string;
    location?: string;
    followers_range?: string;
  };
  analyzedProfiles: InstagramSearchResult[];
};

type Props = {
  data: InstagramSearchData;
};

function extractUsername(url: string): string {
  try {
    const match = url.match(/instagram\.com\/([^/?]+)/);
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

export function InstagramSearchResults({ data }: Props) {
  const { query, context, analyzedProfiles } = data;

  return (
    <div className="instagramSearchResults">
      {context && (context.category || context.location) && (
        <div className="instagramSearchHeader">
          <div className="instagramSearchContext">
            {context.category && (
              <span className="instagramSearchTag">Category: {context.category}</span>
            )}
            {context.location && (
              <span className="instagramSearchTag">Location: {context.location}</span>
            )}
          </div>
        </div>
      )}
      <div className="instagramSearchProfiles">
        {analyzedProfiles.length === 0 ? (
          <div className="instagramSearchEmpty">No profiles found</div>
        ) : (
          analyzedProfiles.map((profile, index) => {
            const username = extractUsername(profile.profileUrl);
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
            const posts =
              typeof profile.postsCount === 'number'
                ? profile.postsCount.toLocaleString()
                : null;
            const engagement =
              typeof profile.avgEngagement === 'number'
                ? `${(profile.avgEngagement * 100).toFixed(2)}% engagement`
                : null;

            return (
              <div key={index} className="instagramSearchProfile">
                <div className="instagramSearchProfileHeader">
                  <div className="instagramSearchProfileInfo">
                    {proxiedImageUrl && (
                      <img
                        src={proxiedImageUrl}
                        alt={username}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          objectFit: 'cover',
                          border: '1px solid #e2e8f0',
                        }}
                      />
                    )}
                    <a
                      href={profile.profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="instagramSearchProfileLink"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <rect
                          x="2"
                          y="2"
                          width="20"
                          height="20"
                          rx="5"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <path
                          d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <line
                          x1="17.5"
                          y1="6.5"
                          x2="17.51"
                          y2="6.5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                      @{username}
                    </a>
                  </div>
                  <div className="instagramSearchProfileScore">
                    <span style={{ color: scoreColor }}>
                      Score: {profile.analysis.score}/5
                    </span>
                    {(followers || posts || engagement) && (
                      <span style={{ marginLeft: 8, color: '#64748b' }}>
                        {followers && `${followers} followers`}
                        {followers && posts && ' • '}
                        {posts && `${posts} posts`}
                        {(followers || posts) && engagement && ' • '}
                        {engagement}
                      </span>
                    )}
                  </div>
                </div>
                <div className="instagramSearchProfileSummary">
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
