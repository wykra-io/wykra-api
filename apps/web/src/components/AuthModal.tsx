import { useEffect, useState } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  onGithubSignIn: () => void;
  onGoogleSignIn: () => void;
  onTelegramSignIn?: () => void;
  onEmailSignIn: (
    email: string,
    password: string,
    isRegister: boolean,
  ) => Promise<{ confirmationRequired?: boolean; message?: string } | void>;
  infoMessage?: string | null;
  errorMessage?: string | null;
};

export function AuthModal({
  open,
  onClose,
  onGithubSignIn,
  onGoogleSignIn,
  onTelegramSignIn,
  onEmailSignIn,
  infoMessage,
  errorMessage,
}: Props) {
  const [isRegister, setIsRegister] = useState(false);
  const [step, setStep] = useState<'email' | 'password'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (infoMessage) {
      setInfo(infoMessage);
      setError(null);
      setIsRegister(false);
      setStep('email');
      setPassword('');
      setConfirmPassword('');
    }
  }, [infoMessage]);

  useEffect(() => {
    if (errorMessage) {
      setError(errorMessage);
      setInfo(null);
    }
  }, [errorMessage]);

  useEffect(() => {
    if (!open) {
      setError(null);
      setInfo(null);
      setLoading(false);
      setStep('email');
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (step === 'email') {
      if (!email) {
        setError('Email is required');
        return;
      }
      setStep('password');
      return;
    }

    if (isRegister && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    onEmailSignIn(email, password, isRegister)
      .then((result) => {
        if (result?.confirmationRequired) {
          setInfo(
            result.message || 'Check your email to confirm your account.',
          );
          setIsRegister(false);
          setStep('email');
          setPassword('');
          setConfirmPassword('');
          return;
        }

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

  const socialBtnStyle: React.CSSProperties = {
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
    transition: 'background 0.2s',
  };

  return (
    <div
      className="modalOverlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <div
          className="modalHeader"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20 }}>
            Log in to your Wykra account
          </h2>
          <button
            className="iconButton"
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{ alignSelf: 'flex-start' }}
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

        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          {step === 'email' ? (
            <div>
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
          ) : (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  border: '1px solid #ddd',
                  borderRadius: 6,
                  backgroundColor: '#f9f9f9',
                }}
              >
                <span style={{ fontSize: 14, color: '#333' }}>{email}</span>
                <button
                  type="button"
                  onClick={() => setStep('email')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#1890ff',
                    cursor: 'pointer',
                    fontSize: 14,
                    padding: 0,
                  }}
                >
                  Edit
                </button>
              </div>

              <div>
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
                <div>
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
            </>
          )}

          {error && (
            <div style={{ color: '#ff4d4f', fontSize: 14 }}>{error}</div>
          )}
          {info && <div style={{ color: '#52c41a', fontSize: 14 }}>{info}</div>}

          <button
            type="submit"
            className="primaryBtn"
            disabled={loading}
            style={{ width: '100%' }}
          >
            {step === 'email'
              ? 'Continue with Email'
              : loading
                ? 'Processing...'
                : isRegister
                  ? 'Sign Up'
                  : 'Sign In'}
          </button>

          <div style={{ textAlign: 'center', fontSize: 14 }}>
            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setError(null);
                setInfo(null);
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

        {step === 'email' && (
          <>
            <div
              style={{
                textAlign: 'center',
                position: 'relative',
                margin: '8px 0',
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                className="googleButton"
                onClick={onGoogleSignIn}
                style={socialBtnStyle}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </button>

              <button
                className="githubButton"
                onClick={onGithubSignIn}
                style={socialBtnStyle}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M12 .5C5.73.5.75 5.7.75 12.1c0 5.12 3.29 9.46 7.86 10.99.58.11.79-.26.79-.57v-2.14c-3.2.72-3.87-1.6-3.87-1.6-.52-1.36-1.26-1.72-1.26-1.72-1.03-.73.08-.72.08-.72 1.14.08 1.74 1.2 1.74 1.2 1.01 1.77 2.66 1.26 3.31.96.1-.75.39-1.26.72-1.55-2.56-.3-5.26-1.32-5.26-5.86 0-1.29.44-2.35 1.17-3.18-.12-.3-.51-1.5.11-3.13 0 0 .96-.31 3.15 1.21.91-.26 1.89-.39 2.86-.39.97 0 1.95.13 2.86.39 2.19-1.52 3.15-1.21 3.15-1.21.62 1.63.23 2.83.11 3.13.73.83 1.17 1.89 1.17 3.18 0 4.55-2.71 5.56-5.29 5.85.4.36.76 1.08.76 2.17v3.2c0 .31.21.68.8.57 4.56-1.53 7.85-5.87 7.85-10.99C23.25 5.7 18.27.5 12 .5Z" />
                </svg>
                Continue with GitHub
              </button>

              {onTelegramSignIn ? (
                <button
                  className="secondary"
                  onClick={onTelegramSignIn}
                  style={socialBtnStyle}
                >
                  Continue with Telegram
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
