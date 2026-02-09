import { useState } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  onGithubSignIn: () => void;
  onGoogleSignIn: () => void;
  onTelegramSignIn?: () => void;
  onEmailSignIn: (email: string, password: string, isRegister: boolean) => Promise<void>;
};

export function AuthModal({
  open,
  onClose,
  onGithubSignIn,
  onGoogleSignIn,
  onTelegramSignIn,
  onEmailSignIn,
}: Props) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isRegister && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    onEmailSignIn(email, password, isRegister)
      .then(() => {
        onClose();
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Authentication failed');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const togglePasswordVisibility = () => setShowPassword(!showPassword);

  const PasswordIcon = () => (
    <button
      type="button"
      onClick={togglePasswordVisibility}
      style={{
        position: 'absolute',
        right: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        color: '#666',
      }}
    >
      {showPassword ? (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      ) : (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  );

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

        <form onSubmit={handleSubmit} style={{ marginTop: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <label
              htmlFor="email"
              style={{ display: 'block', marginBottom: 8, fontSize: 14 }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #ddd',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label
              htmlFor="password"
              style={{ display: 'block', marginBottom: 8, fontSize: 14 }}
            >
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                style={{
                  width: '100%',
                  padding: '8px 40px 8px 12px',
                  borderRadius: 6,
                  border: '1px solid #ddd',
                  boxSizing: 'border-box',
                }}
              />
              <PasswordIcon />
            </div>
          </div>

          {isRegister && (
            <div style={{ marginBottom: 16 }}>
              <label
                htmlFor="confirmPassword"
                style={{ display: 'block', marginBottom: 8, fontSize: 14 }}
              >
                Confirm Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  style={{
                    width: '100%',
                    padding: '8px 40px 8px 12px',
                    borderRadius: 6,
                    border: '1px solid #ddd',
                    boxSizing: 'border-box',
                  }}
                />
                <PasswordIcon />
              </div>
            </div>
          )}

          {error && (
            <div style={{ color: '#ff4d4f', fontSize: 14, marginBottom: 16 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="primaryBtn"
            disabled={loading}
            style={{ width: '100%', marginBottom: 12 }}
          >
            {loading ? 'Processing...' : isRegister ? 'Sign Up' : 'Sign In'}
          </button>

          <div style={{ textAlign: 'center', fontSize: 14 }}>
            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setError(null);
                setConfirmPassword('');
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#1890ff',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {isRegister
                ? 'Already have an account? Sign In'
                : "Don't have an account? Sign Up"}
            </button>
          </div>
        </form>

        <div
          style={{
            margin: '24px 0',
            textAlign: 'center',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: 0,
              right: 0,
              height: 1,
              background: '#eee',
              zIndex: 1,
            }}
          />
          <span
            style={{
              position: 'relative',
              background: '#fff',
              padding: '0 12px',
              fontSize: 14,
              color: '#999',
              zIndex: 2,
            }}
          >
            OR
          </span>
        </div>

        <div>
          <button
            className="googleButton"
            onClick={onGoogleSignIn}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #ddd',
              background: '#fff',
              color: '#333',
              fontSize: 15,
              fontWeight: 500,
              cursor: 'pointer',
              marginBottom: 12,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path
                d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
                fill="#4285F4"
              />
              <path
                d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
                fill="#34A853"
              />
              <path
                d="M3.964 10.711a5.41 5.41 0 0 1 0-3.422V4.957H.957a8.997 8.997 0 0 0 0 8.086l3.007-2.332z"
                fill="#FBBC05"
              />
              <path
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.957l3.007 2.332c.708-2.127 2.692-3.71 5.036-3.71z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </button>
        </div>
        <div>
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
