import { useEffect, useRef, useState } from 'react';

import { AuthModal } from './components/AuthModal';
import { SideMenu } from './components/SideMenu';
import { Topbar } from './components/Topbar';
import { ChatView } from './components/chat/ChatView';
import { AdminDashboard } from './components/AdminDashboard';
import { getApiToken } from './api';
import { useAuth } from './hooks/useAuth';
import { useChat } from './hooks/useChat';
import {
  getTelegramAuthData,
  isTelegramMiniApp,
  prepareTelegramMiniAppUi,
} from './telegram';

export function App() {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const { isAuthed, me, startGithubSignIn, telegramSignIn, emailSignIn, logout } = useAuth();
  const chat = useChat({ enabled: isAuthed });
  const attemptedTelegramAutoLoginRef = useRef(false);

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
        onClose={() => setAuthModalOpen(false)}
        onGithubSignIn={startGithubSignIn}
        onTelegramSignIn={
          isTelegramMiniApp() ? () => void telegramSignIn() : undefined
        }
        onEmailSignIn={emailSignIn}
      />
    </div>
  );
}
