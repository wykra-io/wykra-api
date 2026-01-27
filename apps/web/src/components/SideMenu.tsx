import type { ChatSession } from '../types';

type Props = {
  sessions: ChatSession[];
  activeSessionId: number | null;
  onSelectSession: (id: number) => void;
  onNewSession: () => void;
  isAdmin: boolean;
  onShowDashboard: () => void;
  showDashboard: boolean;
};

export function SideMenu({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  isAdmin,
  onShowDashboard,
  showDashboard,
}: Props) {
  return (
    <aside className="sideMenu">
      <nav className="sideMenuNav">
        <div className="sideMenuHeader">
          <button
            type="button"
            className="sideMenuNewChat"
            onClick={onNewSession}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <span>New chat</span>
          </button>
        </div>

        {isAdmin && (
          <div className="sideMenuSection">
            <button
              type="button"
              className={`sideMenuChatItem ${
                showDashboard ? 'sideMenuChatItemActive' : ''
              }`}
              onClick={onShowDashboard}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ flexShrink: 0 }}
              >
                <rect
                  x="3"
                  y="3"
                  width="7"
                  height="7"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <rect
                  x="14"
                  y="3"
                  width="7"
                  height="7"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <rect
                  x="3"
                  y="14"
                  width="7"
                  height="7"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <rect
                  x="14"
                  y="14"
                  width="7"
                  height="7"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
              <span>Admin Dashboard</span>
            </button>
          </div>
        )}

        {sessions.length > 0 && (
          <div className="sideMenuSection">
            <div className="sideMenuTitle">Chats</div>
            <div className="sideMenuChatsList">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`sideMenuChatItem ${
                    activeSessionId === session.id && !showDashboard
                      ? 'sideMenuChatItemActive'
                      : ''
                  }`}
                  onClick={() => onSelectSession(session.id)}
                >
                  <span>
                    {session.title && session.title.trim()
                      ? session.title
                      : `Chat ${session.id}`}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </nav>
    </aside>
  );
}
