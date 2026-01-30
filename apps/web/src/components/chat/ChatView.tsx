import { useEffect, useRef } from 'react';
import type { ChangeEvent, FormEvent, RefObject } from 'react';

import type { ChatMessage } from '../../types';
import { ChatMessageContent } from './ChatMessageContent';

type Props = {
  messages: ChatMessage[];
  focusMessageId?: string | null;
  onFocusMessageHandled?: () => void;
  chatInput: string;
  chatSending: boolean;
  activeTaskId: string | null;
  canSend: boolean;
  chatEndRef: RefObject<HTMLDivElement>;
  onChatInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
};

export function ChatView({
  messages,
  focusMessageId,
  onFocusMessageHandled,
  chatInput,
  chatSending,
  activeTaskId,
  canSend,
  chatEndRef,
  onChatInputChange,
  onSubmit,
}: Props) {
  const lastHandledFocusIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!focusMessageId) return;
    if (lastHandledFocusIdRef.current === focusMessageId) return;

    let cancelled = false;
    let attempts = 0;
    let timeoutId: number | null = null;

    const attrValue = focusMessageId.replace(/"/g, '\\"');

    const tryScroll = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(
        `[data-chat-message-id="${attrValue}"]`,
      );

      if (el) {
        lastHandledFocusIdRef.current = focusMessageId;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('chatMessageFocused');
        window.setTimeout(
          () => el.classList.remove('chatMessageFocused'),
          1600,
        );
        onFocusMessageHandled?.();
        return;
      }

      attempts += 1;
      if (attempts >= 20) return;
      timeoutId = window.setTimeout(tryScroll, 120);
    };

    tryScroll();

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [focusMessageId, messages.length, onFocusMessageHandled]);

  return (
    <div className="card" style={{ flex: 1, minHeight: 0 }}>
      <div className="chatContainer">
        <div className="chatMessages">
          {messages.length === 0 ? (
            <div className="chatEmpty">
              <p className="muted">
                Start a conversation! Ask me about Instagram or TikTok profiles.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                data-chat-message-id={message.id}
                className={`chatMessage chatMessage${message.role === 'user' ? 'User' : 'Assistant'}`}
              >
                <div className="chatMessageContent">
                  <ChatMessageContent message={message} />
                </div>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>
        <form onSubmit={onSubmit} className="chatInputForm">
          <div className="chatInputWrapper">
            <input
              type="text"
              value={chatInput}
              onChange={onChatInputChange}
              placeholder="Ask about Instagram or TikTok profiles..."
              disabled={!canSend}
              className="chatInput"
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || !canSend}
              className={`chatSendButton ${
                chatSending || !!activeTaskId ? 'chatSendButtonLoading' : ''
              }`}
            >
              {chatSending || !!activeTaskId ? (
                <span className="chatSendButtonDots" aria-hidden="true">
                  ...
                </span>
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
  );
}
