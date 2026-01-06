type Props = {
  open: boolean;
  onClose: () => void;
  onGithubSignIn: () => void;
  onTelegramSignIn?: () => void;
};

export function AuthModal({
  open,
  onClose,
  onGithubSignIn,
  onTelegramSignIn,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="modalOverlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modalHeader">
          <h2 style={{ margin: 0 }}>Welcome to Wykra</h2>
          <button
            className="iconButton"
            type="button"
            aria-label="Close"
            onClick={onClose}
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
          <button className="githubButton" onClick={onGithubSignIn}>
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
        {onTelegramSignIn ? (
          <div style={{ marginTop: 12 }}>
            <button className="secondary" onClick={onTelegramSignIn}>
              Continue with Telegram
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
