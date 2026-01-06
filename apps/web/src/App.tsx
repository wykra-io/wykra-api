import { useState } from 'react';

import { AuthModal } from './components/AuthModal';
import { Topbar } from './components/Topbar';
import { ChatView } from './components/chat/ChatView';
import { useAuth } from './hooks/useAuth';
import { useChat } from './hooks/useChat';

export function App() {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const { isAuthed, me, startGithubSignIn, logout } = useAuth();
  const chat = useChat({ enabled: isAuthed });

  return (
    <div className="container">
      <Topbar
        isAuthed={isAuthed}
        me={me}
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
      />
    </div>
  );
}
