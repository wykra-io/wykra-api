import { useEffect, useRef, useState } from 'react';

import { AuthModal } from './components/AuthModal';
import { SideMenu } from './components/SideMenu';
import { Topbar } from './components/Topbar';
import { ChatView } from './components/chat/ChatView';
import { AdminDashboard } from './components/AdminDashboard';
import { apiGet, getApiToken } from './api';
import { useAuth } from './hooks/useAuth';
import { useChat } from './hooks/useChat';
import {
  getTelegramAuthData,
  isTelegramMiniApp,
  prepareTelegramMiniAppUi,
} from './telegram';

export function App() {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalInfo, setAuthModalInfo] = useState<string | null>(null);
  const [authModalError, setAuthModalError] = useState<string | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const {
    isAuthed,
    me,
    startGithubSignIn,
    telegramSignIn,
    googleSignIn,
    emailSignIn,
    logout,
  } = useAuth();
  const chat = useChat({ enabled: isAuthed });
  const attemptedTelegramAutoLoginRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) return;

    const confirmEmail = async () => {
      try {
        const confirmUrl = `/api/v1/auth/confirm-email?token=${encodeURIComponent(token)}`;
        await apiGet(confirmUrl);
        setAuthModalInfo(
          'Email confirmed. You can sign in with your credentials.',
        );
        setAuthModalError(null);
      } catch (error) {
        setAuthModalError(
          error instanceof Error ? error.message : 'Email confirmation failed',
        );
        setAuthModalInfo(null);
      } finally {
        setAuthModalOpen(true);
        params.delete('token');
        const search = params.toString();
        const newUrl = `${window.location.pathname}${
          search ? `?${search}` : ''
        }${window.location.hash}`;
        window.history.replaceState({}, document.title, newUrl);
      }
    };

    void confirmEmail();
  }, []);

  const handleGoogleSignIn = () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      alert('Google Client ID not configured');
      return;
    }

    const callback = (response: { access_token?: string }) => {
      if (response.access_token) {
        void googleSignIn(response.access_token).then(() => {
          setAuthModalOpen(false);
        });
      }
    };

    const client = (
      window as unknown as {
        google: {
          accounts: {
            oauth2: {
              initTokenClient: (config: {
                client_id: string;
                scope: string;
                callback: (resp: { access_token?: string }) => void;
              }) => { requestAccessToken: () => void };
            };
          };
        };
      }
    ).google?.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'openid email profile',
      callback,
    });

    if (client) {
      client.requestAccessToken();
    } else {
      alert('Google Identity Services not loaded');
    }
  };

  useEffect(() => {
    if (attemptedTelegramAutoLoginRef.current) return;

    const token = getApiToken();
    if (!isTelegramMiniApp() || token) {
      if (isTelegramMiniApp() && token) {
        prepareTelegramMiniAppUi();
      }
      return;
    }

    attemptedTelegramAutoLoginRef.current = true;

    prepareTelegramMiniAppUi();

    const telegramAuthData = getTelegramAuthData();
    if (!telegramAuthData) return;

    void telegramSignIn().catch((error) => {
      console.error('Telegram auth error:', error);
    });
  }, [telegramSignIn]);

  return (
    <div className={`page ${isTelegramMiniApp() ? 'isTelegram' : ''}`}>
      {isTelegramMiniApp() ? (
        <header className="header telegramHeader">
          <div className="headerInner">
            <div className="topbar">
              <button
                type="button"
                className="sideMenuToggle inlineToggle"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSideMenuOpen(!sideMenuOpen);
                }}
                aria-label="Toggle menu"
              >
                {sideMenuOpen ? (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                ) : (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="3" y1="12" x2="21" y2="12"></line>
                    <line x1="3" y1="6" x2="21" y2="6"></line>
                    <line x1="3" y1="18" x2="21" y2="18"></line>
                  </svg>
                )}
              </button>
            </div>
          </div>
        </header>
      ) : (
        <header className="header">
          <div className="headerInner">
            <Topbar
              isAuthed={isAuthed}
              me={me}
              hideSignIn={isTelegramMiniApp()}
              onOpenSignIn={() => setAuthModalOpen(true)}
              onLogout={() => void logout()}
            />
          </div>
        </header>
      )}

      <main className={`main ${sideMenuOpen ? 'sideMenuOpen' : ''}`}>
        {!isAuthed ? null : (
          <>
            <button
              type="button"
              className="sideMenuToggle"
              onClick={() => setSideMenuOpen(!sideMenuOpen)}
              aria-label="Toggle menu"
            >
              {sideMenuOpen ? (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              ) : (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="3" y1="12" x2="21" y2="12"></line>
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <line x1="3" y1="18" x2="21" y2="18"></line>
                </svg>
              )}
            </button>

            {sideMenuOpen && (
              <div
                className="sideMenuOverlay"
                onClick={() => setSideMenuOpen(false)}
              />
            )}

            <SideMenu
              sessions={chat.sessions}
              activeSessionId={chat.activeSessionId}
              onSelectSession={(id) => {
                setShowDashboard(false);
                chat.clearFocusMessageId();
                chat.setActiveSessionId(id);
                setSideMenuOpen(false);
              }}
              onSelectSessionRequest={(
                sessionId: number,
                requestMessageId: string,
              ) => {
                setShowDashboard(false);
                chat.openSessionRequest(sessionId, requestMessageId);
                setSideMenuOpen(false);
              }}
              successRequestsBySessionId={chat.successRequestsBySessionId}
              successRequestsLoadingBySessionId={
                chat.successRequestsLoadingBySessionId
              }
              onRenameSession={(sessionId: number, title: string) =>
                void chat.renameSession(sessionId, title)
              }
              onDeleteSession={(sessionId: number) =>
                void chat.deleteSession(sessionId)
              }
              onNewSession={() => {
                setShowDashboard(false);
                void chat.createNewSession();
                setSideMenuOpen(false);
              }}
              isAdmin={me?.isAdmin ?? false}
              onShowDashboard={() => {
                setShowDashboard(true);
                setSideMenuOpen(false);
              }}
              showDashboard={showDashboard}
            />
          </>
        )}
        <div className="mainInner">
          {!isAuthed ? (
            <div className="authCard">
              <h1 className="title">Welcome to Wykra</h1>
              <p className="subtitle">Sign in to start.</p>
              {isTelegramMiniApp() ? null : (
                <div className="actions">
                  <button
                    type="button"
                    className="primaryBtn"
                    onClick={() => setAuthModalOpen(true)}
                  >
                    Sign in
                  </button>
                </div>
              )}
            </div>
          ) : showDashboard && (me?.isAdmin ?? false) ? (
            <AdminDashboard />
          ) : (
            <ChatView
              messages={chat.messages}
              focusMessageId={chat.focusMessageId}
              onFocusMessageHandled={chat.clearFocusMessageId}
              chatInput={chat.chatInput}
              chatSending={chat.chatSending}
              activeTaskId={chat.activeTaskId}
              taskStopping={chat.taskStopping}
              onStopTask={() => void chat.stopActiveTask()}
              canSend={chat.canSend}
              chatEndRef={chat.chatEndRef}
              chatInputRef={chat.chatInputRef}
              onChatInputChange={chat.onChatInputChange}
              onSubmit={(e) => void chat.onSubmit(e)}
            />
          )}
        </div>
      </main>

      <AuthModal
        open={authModalOpen}
        onClose={() => {
          setAuthModalOpen(false);
          setAuthModalInfo(null);
          setAuthModalError(null);
        }}
        onGithubSignIn={startGithubSignIn}
        onGoogleSignIn={handleGoogleSignIn}
        onTelegramSignIn={
          isTelegramMiniApp() ? () => void telegramSignIn() : undefined
        }
        onEmailSignIn={emailSignIn}
        infoMessage={authModalInfo}
        errorMessage={authModalError}
      />
    </div>
  );
}
