import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';

import { apiGet, apiPost, getApiBaseUrl, setApiToken } from './api';

type TaskStatusResponse = {
  taskId: string;
  status: string;
  result?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  instagramProfiles?: unknown[];
  tiktokProfiles?: unknown[];
};

type MeResponse = {
  githubLogin: string;
  githubAvatarUrl: string | null;
};

export function App() {
  const apiBaseUrl: string = useMemo(() => getApiBaseUrl(), []);

  const [isAuthed, setIsAuthed] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);

  const [taskId, setTaskId] = useState('');
  const [taskStatus, setTaskStatus] = useState<TaskStatusResponse | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);

  const [instagramQuery, setInstagramQuery] = useState(
    'Find up to 10 public Instagram accounts from Portugal who post about cooking and have not more than 50000 followers',
  );
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [igProfile, setIgProfile] = useState('username');
  const [igAnalysisLoading, setIgAnalysisLoading] = useState(false);
  const [igAnalysisError, setIgAnalysisError] = useState<string | null>(null);
  const [igAnalysisTaskId, setIgAnalysisTaskId] = useState('');
  const [igAnalysisTaskStatus, setIgAnalysisTaskStatus] =
    useState<TaskStatusResponse | null>(null);

  useEffect(() => {
    // OAuth callback redirects to `returnTo#token=...`
    const hash = window.location.hash || '';
    const params = new URLSearchParams(
      hash.startsWith('#') ? hash.slice(1) : hash,
    );
    const token = params.get('token');
    if (token) {
      setApiToken(token);
      setIsAuthed(true);
      // Clear token from URL
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname + window.location.search,
      );
    }

    // Initial load: check stored token
    let hasToken = false;
    try {
      hasToken = !!localStorage.getItem('wykraApiToken');
    } catch {
      hasToken = false;
    }

    if (!token) setIsAuthed(hasToken);

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
            } else {
              setMe(null);
            }
          } else {
            setMe(null);
          }
        } catch {
          setApiToken(null);
          setIsAuthed(false);
          setMe(null);
        }
      })();
    }
  }, []);

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

  async function fetchTask() {
    setTaskError(null);
    setTaskLoading(true);
    try {
      const data = await apiGet<TaskStatusResponse>(`/api/v1/tasks/${taskId}`);
      setTaskStatus(data);
    } catch (e) {
      setTaskStatus(null);
      setTaskError(e instanceof Error ? e.message : String(e));
    } finally {
      setTaskLoading(false);
    }
  }

  async function createInstagramSearch() {
    setCreateError(null);
    setCreateLoading(true);
    try {
      const resp = await apiPost<{ taskId: string }>(
        `/api/v1/instagram/search`,
        {
          query: instagramQuery,
        },
      );
      setTaskId(resp.taskId);
      setTaskStatus(null);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreateLoading(false);
    }
  }

  async function runInstagramProfileAnalysis() {
    setIgAnalysisError(null);
    setIgAnalysisTaskStatus(null);
    setIgAnalysisLoading(true);
    try {
      const profile = igProfile.trim();
      if (!profile) throw new Error('Profile is required');
      const resp = await apiPost<{ taskId: string }>(
        `/api/v1/instagram/profile`,
        { profile },
      );
      setIgAnalysisTaskId(resp.taskId);
      setIgAnalysisTaskStatus(null);
    } catch (e) {
      setIgAnalysisError(e instanceof Error ? e.message : String(e));
    } finally {
      setIgAnalysisLoading(false);
    }
  }

  async function fetchIgAnalysisTask() {
    if (!igAnalysisTaskId.trim()) return;
    setIgAnalysisError(null);
    setIgAnalysisLoading(true);
    try {
      const data = await apiGet<TaskStatusResponse>(
        `/api/v1/tasks/${igAnalysisTaskId}`,
      );
      setIgAnalysisTaskStatus(data);
    } catch (e) {
      setIgAnalysisError(e instanceof Error ? e.message : String(e));
    } finally {
      setIgAnalysisLoading(false);
    }
  }

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
      <p className="muted" style={{ marginTop: 8 }}>
        API base: <code>{apiBaseUrl}</code>
      </p>

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Create Instagram Search Task</h2>
          <label>Query</label>
          <textarea
            value={instagramQuery}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
              setInstagramQuery(e.target.value);
            }}
          />
          <div className="row" style={{ marginTop: 12 }}>
            <button
              onClick={() => void createInstagramSearch()}
              disabled={createLoading}
            >
              {createLoading ? 'Creating…' : 'Create task'}
            </button>
            <span className="muted">
              Returns a <code>taskId</code> you can poll.
            </span>
          </div>
          {createError ? (
            <p className="muted" style={{ color: '#b91c1c' }}>
              {createError}
            </p>
          ) : null}
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Check Task Status</h2>
          <label>Task ID</label>
          <input
            value={taskId}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setTaskId(e.target.value);
            }}
            placeholder="paste taskId here"
          />
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="secondary"
              onClick={() => void fetchTask()}
              disabled={!taskId.trim() || taskLoading}
            >
              {taskLoading ? 'Loading…' : 'Fetch status'}
            </button>
          </div>
          {taskError ? (
            <p className="muted" style={{ color: '#b91c1c' }}>
              {taskError}
            </p>
          ) : null}
          {taskStatus ? (
            <div style={{ marginTop: 12 }}>
              <pre>{JSON.stringify(taskStatus, null, 2)}</pre>
            </div>
          ) : null}
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Instagram Profile Analysis</h2>
          <label>Profile username</label>
          <input
            value={igProfile}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setIgProfile(e.target.value);
            }}
            placeholder="e.g. username"
          />
          <div className="row" style={{ marginTop: 12 }}>
            <button
              onClick={() => void runInstagramProfileAnalysis()}
              disabled={igAnalysisLoading || !igProfile.trim()}
            >
              {igAnalysisLoading ? 'Creating task…' : 'Create task'}
            </button>
            <span className="muted">
              Returns a <code>taskId</code> you can poll.
            </span>
          </div>
          {igAnalysisError ? (
            <p className="muted" style={{ color: '#b91c1c' }}>
              {igAnalysisError}
            </p>
          ) : null}
          {igAnalysisTaskId ? (
            <div style={{ marginTop: 12 }}>
              <label>Task ID</label>
              <input
                value={igAnalysisTaskId}
                readOnly
                style={{ background: '#f1f5f9', cursor: 'not-allowed' }}
              />
              <div className="row" style={{ marginTop: 12 }}>
                <button
                  className="secondary"
                  onClick={() => void fetchIgAnalysisTask()}
                  disabled={igAnalysisLoading}
                >
                  {igAnalysisLoading ? 'Loading…' : 'Fetch status'}
                </button>
              </div>
              {igAnalysisTaskStatus ? (
                <div style={{ marginTop: 12 }}>
                  <pre>
                    {JSON.stringify(
                      {
                        ...igAnalysisTaskStatus,
                        result: igAnalysisTaskStatus.result
                          ? JSON.parse(String(igAnalysisTaskStatus.result))
                          : null,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

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
            <p className="muted" style={{ marginTop: 8 }}>
              Sign in to create tasks and view results.
            </p>
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
