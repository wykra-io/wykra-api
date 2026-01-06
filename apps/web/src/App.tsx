import { useEffect, useRef, useState } from 'react';

import { AuthModal } from './components/AuthModal';
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
    <div className="container">
      <Topbar
        isAuthed={isAuthed}
        me={me}
        hideSignIn={isTelegramMiniApp()}
        onOpenSignIn={() => setAuthModalOpen(true)}
        onLogout={() => void logout()}
      />

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
