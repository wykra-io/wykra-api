import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  apiGet,
  apiPost,
  getApiBaseUrl,
  getApiToken,
  setApiToken,
} from '../api';
import type { MeResponse } from '../types';
import { getTelegramAuthData } from '../telegram';

function normalizeMeResponse(payload: unknown): MeResponse | null {
  if (!payload || typeof payload !== 'object') return null;

  const candidate: unknown =
    'data' in payload && (payload as { data?: unknown }).data
      ? (payload as { data?: unknown }).data
      : payload;

  if (!candidate || typeof candidate !== 'object') return null;

  if (
    !('githubLogin' in candidate) ||
    typeof (candidate as { githubLogin?: unknown }).githubLogin !== 'string'
  ) {
    return null;
  }

  const githubLogin = (candidate as { githubLogin: string }).githubLogin;
  const githubAvatarUrlRaw = (candidate as { githubAvatarUrl?: unknown })
    .githubAvatarUrl;
  const githubAvatarUrl =
    githubAvatarUrlRaw === null || typeof githubAvatarUrlRaw === 'string'
      ? githubAvatarUrlRaw
      : null;

  return { githubLogin, githubAvatarUrl };
}

export function useAuth() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [isAuthed, setIsAuthed] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);

  const refreshMe = useCallback(async () => {
    try {
      const meResp = await apiGet(`/api/v1/auth/me`);
      const normalized = normalizeMeResponse(meResp);
      if (normalized) {
        setMe(normalized);
        setIsAuthed(true);
        return true;
      }
      setApiToken(null);
      setIsAuthed(false);
      setMe(null);
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isAuthError = msg.includes('401') || msg.includes('Unauthorized');
      if (isAuthError) setApiToken(null);
      setIsAuthed(false);
      setMe(null);
      return false;
    }
  }, []);

  useEffect(() => {
    const hash = window.location.hash || '';
    const params = new URLSearchParams(
      hash.startsWith('#') ? hash.slice(1) : hash,
    );
    const token = params.get('token');

    if (token) {
      setApiToken(token);
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname + window.location.search,
      );
    }

    const hasToken = !!(token || getApiToken());
    if (!hasToken) {
      setIsAuthed(false);
      setMe(null);
      return;
    }

    void refreshMe();
  }, [refreshMe]);

  const startGithubSignIn = useCallback(() => {
    const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    const startUrl = new URL('/api/v1/auth/github/app/start', apiBaseUrl);
    startUrl.searchParams.set('returnTo', returnTo);
    window.location.assign(startUrl.toString());
  }, [apiBaseUrl]);

  const logout = useCallback(async () => {
    try {
      await apiPost(`/api/v1/auth/logout`, {});
    } catch {
      // Even if API call fails, clear locally to unblock user
    } finally {
      setApiToken(null);
      setIsAuthed(false);
      setMe(null);
    }
  }, []);

  const telegramSignIn = useCallback(async () => {
    const telegramAuthData = getTelegramAuthData();
    if (!telegramAuthData) throw new Error('Telegram initData not available');

    const resp = await apiPost<{ token: string }>(`/api/v1/auth/social`, {
      provider: telegramAuthData.provider,
      code: telegramAuthData.code,
    });
    setApiToken(resp.token);
    await refreshMe();
  }, [refreshMe]);

  return { isAuthed, me, startGithubSignIn, telegramSignIn, logout };
}
