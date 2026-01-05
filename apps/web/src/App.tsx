import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

import { apiGet, apiPost, getApiBaseUrl, setApiToken } from './api';

type MeResponse = {
  githubLogin: string;
  githubAvatarUrl: string | null;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  detectedEndpoint?: string;
};

type InstagramProfileAnalysis = {
  profile: string;
  data: {
    profile_name?: string;
    full_name?: string;
    profile_image_link?: string;
    profile_url?: string;
    followers?: number;
    posts_count?: number;
    avg_engagement?: number;
    is_verified?: boolean;
    is_private?: boolean;
  };
  analysis: {
    summary?: string;
    qualityScore?: number;
    topic?: string;
    niche?: string;
    engagementStrength?: string;
    contentAuthenticity?: string;
    followerAuthenticity?: string;
  };
};

function InstagramProfileCard({ data }: { data: InstagramProfileAnalysis }) {
  const profileName =
    data.data.full_name || data.data.profile_name || data.profile;
  const profileImage = data.data.profile_image_link;
  const followers = data.data.followers?.toLocaleString();
  const posts = data.data.posts_count?.toLocaleString();
  const engagement = data.data.avg_engagement
    ? `${(data.data.avg_engagement * 100).toFixed(2)}%`
    : null;

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

  // Construct Instagram profile URL
  const profileUrl = useMemo(() => {
    if (data.data.profile_url) {
      return data.data.profile_url;
    }
    // Fallback: construct URL from profile name
    const username = data.data.profile_name || data.profile;
    if (username) {
      return `https://www.instagram.com/${username.replace('@', '')}/`;
    }
    return null;
  }, [data.data.profile_url, data.data.profile_name, data.profile]);

  return (
    <div className="instagramProfileCard">
      <div className="instagramProfileHeader">
        {profileImage ? (
          <>
            {!imageLoaded && !imageError && (
              <div className="instagramProfileImagePlaceholder">
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
                className="instagramProfileImage"
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
              <div className="instagramProfileImagePlaceholder">
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
          <div className="instagramProfileImagePlaceholder">
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
        <div className="instagramProfileInfo">
          <div className="instagramProfileName">
            {profileUrl ? (
              <a
                href={profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="instagramProfileLink"
              >
                {profileName}
              </a>
            ) : (
              profileName
            )}
            {data.data.is_verified && (
              <span className="instagramVerified" title="Verified">
                ✓
              </span>
            )}
          </div>
          <div className="instagramProfileStats">
            {followers && <span>{followers} followers</span>}
            {posts && <span>{posts} posts</span>}
            {engagement && <span>{engagement} engagement</span>}
          </div>
        </div>
      </div>
      {data.analysis.summary && (
        <div className="instagramProfileAnalysis">
          <div className="instagramAnalysisSection">
            <h4>Summary</h4>
            <p>{data.analysis.summary}</p>
          </div>
          {data.analysis.topic && (
            <div className="instagramAnalysisRow">
              <span className="instagramAnalysisLabel">Topic:</span>
              <span>{data.analysis.topic}</span>
            </div>
          )}
          {data.analysis.niche && (
            <div className="instagramAnalysisRow">
              <span className="instagramAnalysisLabel">Niche:</span>
              <span>{data.analysis.niche}</span>
            </div>
          )}
          {data.analysis.qualityScore !== undefined && (
            <div className="instagramAnalysisRow">
              <span className="instagramAnalysisLabel">Quality Score:</span>
              <span>{data.analysis.qualityScore}/5</span>
            </div>
          )}
          {data.analysis.engagementStrength && (
            <div className="instagramAnalysisRow">
              <span className="instagramAnalysisLabel">Engagement:</span>
              <span>{data.analysis.engagementStrength}</span>
            </div>
          )}
          {data.analysis.contentAuthenticity && (
            <div className="instagramAnalysisRow">
              <span className="instagramAnalysisLabel">Content:</span>
              <span>{data.analysis.contentAuthenticity}</span>
            </div>
          )}
          {data.analysis.followerAuthenticity && (
            <div className="instagramAnalysisRow">
              <span className="instagramAnalysisLabel">Followers:</span>
              <span>{data.analysis.followerAuthenticity}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function App() {
  const apiBaseUrl: string = useMemo(() => getApiBaseUrl(), []);

  const [isAuthed, setIsAuthed] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [pollingTasks, setPollingTasks] = useState<Set<string>>(new Set());
  const chatEndRef = useRef<HTMLDivElement>(null);
  const isInitialLoadRef = useRef(true);

  useEffect(() => {
    // OAuth callback redirects to `returnTo#token=...`
    const hash = window.location.hash || '';
    const params = new URLSearchParams(
      hash.startsWith('#') ? hash.slice(1) : hash,
    );
    const token = params.get('token');

    // If token is in URL, save it to localStorage
    if (token) {
      setApiToken(token);
      // Clear token from URL
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname + window.location.search,
      );
    }

    // Check for stored token
    let hasToken = false;
    try {
      hasToken = !!localStorage.getItem('wykraApiToken');
    } catch {
      hasToken = false;
    }

    // Only verify token if we have one (from URL or storage)
    if (token || hasToken) {
      void (async () => {
        try {
          const meResp = await apiGet<{ data: MeResponse } | MeResponse>(
            `/api/v1/auth/me`,
          );
          if (meResp && typeof meResp === 'object') {
            let userData: unknown;
            if ('data' in meResp && meResp.data) {
              userData = meResp.data;
            } else {
              userData = meResp;
            }
            if (
              userData &&
              typeof userData === 'object' &&
              'githubLogin' in userData &&
              typeof userData.githubLogin === 'string'
            ) {
              const avatarUrl =
                'githubAvatarUrl' in userData &&
                (userData.githubAvatarUrl === null ||
                  typeof userData.githubAvatarUrl === 'string')
                  ? userData.githubAvatarUrl
                  : null;
              setMe({
                githubLogin: userData.githubLogin,
                githubAvatarUrl: avatarUrl,
              });
              // Only set authenticated after successful user data fetch
              setIsAuthed(true);
            } else {
              // Invalid user data - clear auth
              setApiToken(null);
              setIsAuthed(false);
              setMe(null);
            }
          } else {
            // Invalid response format - clear auth
          setApiToken(null);
          setIsAuthed(false);
          setMe(null);
          }
        } catch (error) {
          // Only clear token if it's an authentication error (401)
          // For other errors (network, etc.), keep the token but don't set as authed
          const isAuthError =
            error instanceof Error &&
            (error.message.includes('401') ||
              error.message.includes('Unauthorized'));

          if (isAuthError) {
            // Token is invalid - clear everything
            setApiToken(null);
            setIsAuthed(false);
            setMe(null);
          } else {
            // Network or other error - keep token but don't set as authed
            // User can retry later
            setIsAuthed(false);
            setMe(null);
          }
        }
      })();
    } else {
      // No token at all - ensure we're not authed
      setIsAuthed(false);
      setMe(null);
    }
  }, []);

  // Load chat history when authenticated
  const loadChatHistory = useMemo(
    () => async () => {
      if (!isAuthed || !me) return;
      try {
        const historyResp = await apiGet<
          { data: Array<ChatMessage> } | Array<ChatMessage>
        >(`/api/v1/chat/history`);
        const historyData = Array.isArray(historyResp)
          ? historyResp
          : historyResp.data || [];
        const loadedMessages = historyData.map((msg) => ({
          id: String(msg.id),
          role: msg.role,
          content: msg.content,
          detectedEndpoint: msg.detectedEndpoint || undefined,
        }));
        // Filter out "Processing your request..." messages
        const filteredMessages = loadedMessages.filter(
          (msg) => msg.content !== 'Processing your request...',
        );
        setMessages(filteredMessages);

        // Scroll to bottom on initial load
        if (isInitialLoadRef.current && filteredMessages.length > 0) {
          isInitialLoadRef.current = false;
          // Use setTimeout to ensure DOM is updated
          setTimeout(() => {
            chatEndRef.current?.scrollIntoView({ behavior: 'auto' });
          }, 100);
        }

        // Check if we should keep loading (if there are active tasks being polled)
        const hasResults = filteredMessages.some(
          (msg) =>
            msg.content.startsWith('[INSTAGRAM_PROFILE_ANALYSIS]') ||
            (msg.detectedEndpoint && msg.content.length > 100),
        );

        if (hasResults || pollingTasks.size === 0) {
          setChatLoading(false);
        }

        // Update polling tasks - stop polling if results arrived
        setPollingTasks((prev: Set<string>) => {
          const next = new Set<string>(prev);
          for (const msg of filteredMessages) {
            if (
              msg.content.startsWith('[INSTAGRAM_PROFILE_ANALYSIS]') ||
              (msg.detectedEndpoint && msg.content.length > 100)
            ) {
              // Result arrived, stop polling
              next.delete(msg.id);
            }
          }
          return next;
        });
      } catch (error) {
        // If history fails, just start with empty messages
        console.warn(
          `Failed to load chat history: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [isAuthed, me],
  );

  useEffect(() => {
    if (isAuthed && me) {
      // Reset initial load flag when auth state changes
      isInitialLoadRef.current = true;
      void loadChatHistory();
    } else {
      // Clear messages when not authenticated
      setMessages([]);
      setPollingTasks(new Set());
      isInitialLoadRef.current = true;
    }
  }, [isAuthed, me, loadChatHistory]);

  // Poll for chat updates when there are active tasks
  useEffect(() => {
    if (!isAuthed || !me || pollingTasks.size === 0) return;

    const pollInterval = setInterval(() => {
      void loadChatHistory();
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(pollInterval);
  }, [isAuthed, me, pollingTasks.size, loadChatHistory]);

  function startGithubSignIn() {
    const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    const startUrl = new URL('/api/v1/auth/github/app/start', apiBaseUrl);
    startUrl.searchParams.set('returnTo', returnTo);
    window.location.assign(startUrl.toString());
  }

  async function logout() {
    try {
      await apiPost(`/api/v1/auth/logout`, {});
    } catch {
      // Even if API call fails, clear locally to unblock user
    } finally {
      setApiToken(null);
      setIsAuthed(false);
      setMe(null);
      setUserMenuOpen(false);
    }
  }

  async function sendChatMessage(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const query = chatInput.trim();
    if (!query || chatLoading || !isAuthed) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: query,
    };

    setMessages((prev: ChatMessage[]) => [...prev, userMessage]);
    setChatInput('');
    setChatLoading(true);
    // Scroll to bottom when user sends a message
    scrollToBottom();

    try {
      const response = await apiPost<{
        data?: { response: string; detectedEndpoint?: string };
        response?: string;
        detectedEndpoint?: string;
      }>(`/api/v1/chat`, { query });

      const chatData =
        'data' in response && response.data ? response.data : response;

      // If endpoint detected, keep loading state to show thinking loader
      // Don't add any message - result will come from task completion
      if (chatData.detectedEndpoint) {
        // Keep loading state - will be stopped when result arrives via polling
        // Start polling for results
        const tempId = `temp-${Date.now()}`;
        setPollingTasks((prev: Set<string>) => {
          const next = new Set<string>(prev);
          next.add(tempId);
          return next;
        });

        // Stop polling after 5 minutes
        setTimeout(
          () => {
            setPollingTasks((prev: Set<string>) => {
              const next = new Set<string>(prev);
              next.delete(tempId);
              return next;
            });
            setChatLoading(false);
          },
          5 * 60 * 1000,
        );
      } else {
        // No endpoint detected - show normal response
        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: chatData.response || '',
          detectedEndpoint: chatData.detectedEndpoint,
        };
        setMessages((prev: ChatMessage[]) => [...prev, assistantMessage]);
        setChatLoading(false);
      }

      // Reload history to get any new messages from backend (like task results)
      setTimeout(() => {
        void loadChatHistory();
      }, 2000);
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to send message'}`,
      };
      setMessages((prev: ChatMessage[]) => [...prev, errorMessage]);
    } finally {
      setChatLoading(false);
    }
  }

  // Auto-scroll to bottom when new messages are added
  const scrollToBottom = () => {
    // Use setTimeout to ensure DOM is updated
    setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  // Track last message count to detect new messages
  const lastMessageCountRef = useRef(0);

  // Scroll down when new messages are added
  useEffect(() => {
    if (messages.length > lastMessageCountRef.current) {
      scrollToBottom();
      lastMessageCountRef.current = messages.length;
    }
  }, [messages]);

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <h1 style={{ margin: 0 }}>Wykra</h1>
        </div>
        <div className="topbarRight">
          {!isAuthed ? (
            <button
              className="secondary"
              onClick={() => {
                setAuthModalOpen(true);
              }}
            >
              Sign in
            </button>
          ) : (
            <div className="userMenuWrap">
              <button
                className="avatarButton"
                type="button"
                aria-label="User menu"
                onClick={() => {
                  setUserMenuOpen((v) => !v);
                }}
              >
                {me?.githubAvatarUrl ? (
                  <img
                    className="avatar"
                    src={me.githubAvatarUrl}
                    alt={me.githubLogin || 'User'}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="avatarFallback" aria-hidden="true">
                    <svg
                      width="18"
                      height="18"
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
                  </span>
                )}
              </button>

              {userMenuOpen ? (
                <div className="userMenu" role="menu">
                  <div className="userMenuHeader">
                    <div className="userMenuName">
                      {me?.githubLogin && me.githubLogin.trim()
                        ? me.githubLogin
                        : 'User'}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Signed in
                    </div>
                  </div>
                  <button
                    className="userMenuItem"
                    type="button"
                    onClick={() => void logout()}
                  >
                    Logout
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {!isAuthed ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '48px 16px',
          }}
        >
          <div>
            <h2 style={{ margin: '0 0 16px 0', color: '#0f172a' }}>
              Welcome to Wykra
            </h2>
            <p className="muted" style={{ margin: '0 0 24px 0', fontSize: 16 }}>
              Sign in to start
            </p>
          </div>
        </div>
      ) : (
        <div
          className="card"
          style={{
            marginTop: 24,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <div className="chatContainer">
            <div className="chatMessages">
              {messages.length === 0 ? (
                <div className="chatEmpty">
                  <p className="muted">
                    Start a conversation! Ask me about Instagram or TikTok
                    profiles.
                  </p>
                </div>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`chatMessage chatMessage${message.role === 'user' ? 'User' : 'Assistant'}`}
                  >
                    <div className="chatMessageContent">
                      {message.content.startsWith(
                        '[INSTAGRAM_PROFILE_ANALYSIS]',
                      )
                        ? (() => {
                            try {
                              const jsonStr = String(
                                message.content.replace(
                                  '[INSTAGRAM_PROFILE_ANALYSIS]\n',
                                  '',
                                ),
                              );
                              const data = JSON.parse(
                                jsonStr,
                              ) as InstagramProfileAnalysis;
                              return <InstagramProfileCard data={data} />;
                            } catch {
                              return <>{message.content}</>;
                            }
                          })()
                        : message.content}
                    </div>
          </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>
            <form
              onSubmit={(e) => {
                void sendChatMessage(e);
              }}
              className="chatInputForm"
            >
              <div className="chatInputWrapper">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    setChatInput(e.target.value);
                  }}
                  placeholder="Ask about Instagram or TikTok profiles..."
                  disabled={chatLoading}
                  className="chatInput"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || chatLoading}
                  className={`chatSendButton ${chatLoading ? 'chatSendButtonLoading' : ''}`}
                >
                  {chatLoading ? (
                    <div className="chatSendButtonSpinner" />
                  ) : (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {authModalOpen ? (
        <div
          className="modalOverlay"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAuthModalOpen(false);
          }}
        >
          <div className="modal">
            <div className="modalHeader">
              <h2 style={{ margin: 0 }}>Welcome to Wykra</h2>
              <button
                className="iconButton"
                type="button"
                aria-label="Close"
                onClick={() => {
                  setAuthModalOpen(false);
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M18 6 6 18M6 6l12 12"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <div style={{ marginTop: 16 }}>
              <button
                className="githubButton"
                onClick={() => startGithubSignIn()}
              >
                <span className="githubIcon" aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M12 .5C5.73.5.75 5.7.75 12.1c0 5.12 3.29 9.46 7.86 10.99.58.11.79-.26.79-.57v-2.14c-3.2.72-3.87-1.6-3.87-1.6-.52-1.36-1.26-1.72-1.26-1.72-1.03-.73.08-.72.08-.72 1.14.08 1.74 1.2 1.74 1.2 1.01 1.77 2.66 1.26 3.31.96.1-.75.39-1.26.72-1.55-2.56-.3-5.26-1.32-5.26-5.86 0-1.29.44-2.35 1.17-3.18-.12-.3-.51-1.5.11-3.13 0 0 .96-.31 3.15 1.21.91-.26 1.89-.39 2.86-.39.97 0 1.95.13 2.86.39 2.19-1.52 3.15-1.21 3.15-1.21.62 1.63.23 2.83.11 3.13.73.83 1.17 1.89 1.17 3.18 0 4.55-2.71 5.56-5.29 5.85.4.36.76 1.08.76 2.17v3.2c0 .31.21.68.8.57 4.56-1.53 7.85-5.87 7.85-10.99C23.25 5.7 18.27.5 12 .5Z" />
                  </svg>
                </span>
                Continue with GitHub
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
