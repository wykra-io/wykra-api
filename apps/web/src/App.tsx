import { useEffect, useRef, useState } from 'react';

import { AuthModal } from './components/AuthModal';
import { SideMenu } from './components/SideMenu';
import { Topbar } from './components/Topbar';
import { ChatView } from './components/chat/ChatView';
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
  const { isAuthed, me, startGithubSignIn, telegramSignIn, logout } = useAuth();
  const chat = useChat({ enabled: isAuthed });

  const attemptedTelegramAutoLoginRef = useRef(false);
  useEffect(() => {
    if (attemptedTelegramAutoLoginRef.current) return;

    const token = getApiToken();
    if (!isTelegramMiniApp() || token) return;

    attemptedTelegramAutoLoginRef.current = true;

    prepareTelegramMiniAppUi();

    const telegramAuthData = getTelegramAuthData();
    if (!telegramAuthData) return;

    void telegramSignIn().catch((error) => {
      console.error('Telegram auth error:', error);
    });
  }, [telegramSignIn]);

  return (
    <div className="page">
      {isTelegramMiniApp() ? null : (
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

      <main className="main">
        {isTelegramMiniApp() ? null : <SideMenu />}
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
          ) : (
            <ChatView
              messages={chat.messages}
              chatInput={chat.chatInput}
              chatSending={chat.chatSending}
              activeTaskId={chat.activeTaskId}
              canSend={chat.canSend}
              chatEndRef={chat.chatEndRef}
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
      />
    </div>
  );
}
