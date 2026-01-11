import { useState } from 'react';

import type { MeResponse } from '../types';
import { WykraLogo } from './WykraLogo';

type Props = {
  isAuthed: boolean;
  me: MeResponse | null;
  onOpenSignIn: () => void;
  onLogout: () => void;
  hideSignIn?: boolean;
};

export function Topbar({
  isAuthed,
  me,
  onOpenSignIn,
  onLogout,
  hideSignIn,
}: Props) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <div className="topbar">
      <div className="brand">
        <WykraLogo size={56} className="brandLogo" />
        <span className="brandText">Wykra</span>
      </div>
      <div className="topbarRight">
        {!isAuthed ? (
          hideSignIn ? null : (
            <button className="secondary" onClick={onOpenSignIn}>
              Sign in
            </button>
          )
        ) : (
          <div className="userMenuWrap">
            <button
              className="avatarButton"
              type="button"
              aria-label="User menu"
              onClick={() => setUserMenuOpen((v) => !v)}
            >
              {me?.githubAvatarUrl ? (
                <img
                  className="avatar"
                  src={me.githubAvatarUrl}
                  alt={me.githubLogin || 'User'}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="avatarFallback" aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M20 21a8 8 0 0 0-16 0"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <path
                      d="M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                </span>
              )}
            </button>

            {userMenuOpen ? (
              <div className="userMenu" role="menu">
                <div className="userMenuHeader">
                  <div className="userMenuName">
                    {me?.githubLogin && me.githubLogin.trim()
                      ? me.githubLogin
                      : 'User'}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Signed in
                  </div>
                </div>
                <button
                  className="userMenuItem"
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    onLogout();
                  }}
                >
                  Logout
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
