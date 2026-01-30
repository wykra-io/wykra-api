import { useCallback, useMemo, useState } from 'react';

import type { ChatSession } from '../types';
import type { ChatSuccessRequest } from '../hooks/useChat';

type Props = {
  sessions: ChatSession[];
  activeSessionId: number | null;
  onSelectSession: (id: number) => void;
  onSelectSessionRequest: (sessionId: number, requestMessageId: string) => void;
  successRequestsBySessionId: Record<number, ChatSuccessRequest[]>;
  successRequestsLoadingBySessionId: Record<number, boolean>;
  onRenameSession: (sessionId: number, title: string) => void;
  onDeleteSession: (sessionId: number) => void;
  onNewSession: () => void;
  isAdmin: boolean;
  onShowDashboard: () => void;
  showDashboard: boolean;
};

function requestKindPlatform(
  kind: ChatSuccessRequest['kind'],
): 'instagram' | 'tiktok' {
  switch (kind) {
    case 'instagram_profile_analysis':
    case 'instagram_search_results':
      return 'instagram';
    case 'tiktok_profile_analysis':
    case 'tiktok_search_results':
      return 'tiktok';
  }
}

function PlatformIcon({ platform }: { platform: 'instagram' | 'tiktok' }) {
  if (platform === 'instagram') {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
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
    );
  }

  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="TikTok"
    >
      <title>TikTok</title>
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  );
}

export function SideMenu({
  sessions,
  activeSessionId,
  onSelectSession,
  onSelectSessionRequest,
  successRequestsBySessionId,
  successRequestsLoadingBySessionId,
  onRenameSession,
  onDeleteSession,
  onNewSession,
  isAdmin,
  onShowDashboard,
  showDashboard,
}: Props) {
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  const editingSession = useMemo(
    () =>
      editingSessionId != null
        ? (sessions.find((s) => s.id === editingSessionId) ?? null)
        : null,
    [editingSessionId, sessions],
  );

  const startEdit = useCallback((session: ChatSession) => {
    setEditingSessionId(session.id);
    setDraftTitle(session.title ?? '');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingSessionId(null);
    setDraftTitle('');
  }, []);

  const saveEdit = useCallback(() => {
    if (editingSessionId == null) return;
    onRenameSession(editingSessionId, draftTitle);
    setEditingSessionId(null);
    setDraftTitle('');
  }, [draftTitle, editingSessionId, onRenameSession]);

  const sessionLabel = useCallback((session: ChatSession) => {
    const title = session.title?.trim();
    if (title) return title;
    if (typeof session.id === 'number' && session.id < 0) return 'New chat';
    return `Chat ${session.id}`;
  }, []);

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
              {sessions.map((session) => {
                const isActive =
                  activeSessionId === session.id && showDashboard === false;
                const requests = successRequestsBySessionId[session.id] ?? [];
                const isLoading =
                  !!successRequestsLoadingBySessionId[session.id];
                const isEditing = editingSessionId === session.id;
                const label = sessionLabel(session);

                return (
                  <div key={session.id} className="sideMenuChatGroup">
                    <div className="sideMenuChatRow">
                      <button
                        type="button"
                        className={`sideMenuChatItem sideMenuChatMain ${
                          isActive ? 'sideMenuChatItemActive' : ''
                        }`}
                        onClick={() => onSelectSession(session.id)}
                        disabled={isEditing}
                        title={label}
                      >
                        {isEditing ? (
                          <span className="sideMenuChatTitle">Editing…</span>
                        ) : (
                          <span className="sideMenuChatTitle">{label}</span>
                        )}
                      </button>

                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            className="sideMenuIconBtn"
                            onClick={(e) => {
                              e.stopPropagation();
                              saveEdit();
                            }}
                            title="Save"
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            className="sideMenuIconBtn"
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelEdit();
                            }}
                            title="Cancel"
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <div className="sideMenuChatActions">
                          <button
                            type="button"
                            className="sideMenuIconBtn"
                            onClick={(e) => {
                              e.stopPropagation();
                              startEdit(session);
                            }}
                            title="Rename chat"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="sideMenuIconBtn sideMenuIconBtnDanger"
                            onClick={(e) => {
                              e.stopPropagation();
                              const ok = window.confirm(
                                'Delete this chat? This cannot be undone.',
                              );
                              if (!ok) return;
                              onDeleteSession(session.id);
                            }}
                            title="Delete chat"
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden
                            >
                              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="sideMenuChatEditRow">
                        <input
                          className="sideMenuChatEditInput"
                          type="text"
                          value={draftTitle}
                          placeholder={
                            editingSession?.title?.trim()
                              ? editingSession.title
                              : label
                          }
                          onChange={(e) => setDraftTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit();
                            if (e.key === 'Escape') cancelEdit();
                          }}
                          autoFocus
                        />
                      </div>
                    ) : null}

                    {isLoading ? (
                      <div className="sideMenuChatSubList">
                        <div className="sideMenuChatSubLoading">Loading…</div>
                      </div>
                    ) : requests.length > 0 ? (
                      <div className="sideMenuChatSubList">
                        {requests.map((req) => (
                          <button
                            key={`${req.sessionId}-${req.requestMessageId}`}
                            type="button"
                            className="sideMenuChatSubItem"
                            onClick={() =>
                              onSelectSessionRequest(
                                req.sessionId,
                                req.requestMessageId,
                              )
                            }
                            title={req.title}
                          >
                            <span className="sideMenuChatSubBadge">
                              <PlatformIcon
                                platform={requestKindPlatform(req.kind)}
                              />
                            </span>
                            <span className="sideMenuChatSubText">
                              {req.title}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </nav>
    </aside>
  );
}
