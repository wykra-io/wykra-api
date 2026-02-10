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
  const isAdminRaw = (candidate as { isAdmin?: unknown }).isAdmin;
  const isAdmin = typeof isAdminRaw === 'boolean' ? isAdminRaw : false;

  const email =
    'email' in candidate &&
    typeof (candidate as { email?: unknown }).email === 'string'
      ? (candidate as { email: string }).email
      : null;

  return { githubLogin, githubAvatarUrl, isAdmin, email };
}

function extractToken(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;

  // Direct shape: { token: string }
  if (
    'token' in payload &&
    typeof (payload as { token?: unknown }).token === 'string'
  ) {
    return (payload as { token: string }).token;
  }

  // Wrapped shape (Nest TransformInterceptor-style): { data: { token: string } }
  if ('data' in payload && (payload as { data?: unknown }).data) {
    const data = (payload as { data: unknown }).data;
    if (
      data &&
      typeof data === 'object' &&
      'token' in data &&
      typeof (data as { token?: unknown }).token === 'string'
    ) {
      return (data as { token: string }).token;
    }
  }

  return null;
}

type EmailRegisterResult = {
  confirmationRequired: true;
  message?: string;
};

function extractEmailRegisterResult(
  payload: unknown,
): EmailRegisterResult | null {
  if (!payload || typeof payload !== 'object') return null;

  const candidate: unknown =
    'data' in payload && (payload as { data?: unknown }).data
      ? (payload as { data?: unknown }).data
      : payload;

  if (!candidate || typeof candidate !== 'object') return null;

  const confirmationRequired =
    'confirmationRequired' in candidate &&
    (candidate as { confirmationRequired?: unknown }).confirmationRequired ===
      true;
  if (!confirmationRequired) return null;

  const message =
    'message' in candidate &&
    typeof (candidate as { message?: unknown }).message === 'string'
      ? (candidate as { message: string }).message
      : undefined;

  return { confirmationRequired: true, message };
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

    const resp = await apiPost<unknown>(`/api/v1/auth/social`, {
      provider: telegramAuthData.provider,
      code: telegramAuthData.code,
    });

    const token = extractToken(resp);
    if (!token) {
      throw new Error('Telegram auth response did not include token');
    }

    setApiToken(token);
    await refreshMe();
  }, [refreshMe]);

  const emailSignIn = useCallback(
    async (
      email: string,
      password: string,
      isRegister: boolean,
    ): Promise<EmailRegisterResult | void> => {
      const endpoint = isRegister
        ? '/api/v1/auth/register'
        : '/api/v1/auth/login';
      const resp = await apiPost<unknown>(endpoint, { email, password });

      const token = extractToken(resp);
      if (token) {
        setApiToken(token);
        await refreshMe();
        return;
      }

      if (isRegister) {
        const registerResult = extractEmailRegisterResult(resp);
        if (registerResult) return registerResult;
        throw new Error('Sign up response did not include confirmation status');
      }

      throw new Error('Email auth response did not include token');
    },
    [refreshMe],
  );

  const googleSignIn = useCallback(
    async (googleAccessToken: string) => {
      const resp = await apiPost<unknown>(`/api/v1/auth/social`, {
        provider: 'google',
        code: googleAccessToken,
      });

      const token = extractToken(resp);
      if (!token) {
        throw new Error('Google auth response did not include token');
      }

      setApiToken(token);
      await refreshMe();
    },
    [refreshMe],
  );

  return {
    isAuthed,
    me,
    startGithubSignIn,
    telegramSignIn,
    googleSignIn,
    emailSignIn,
    logout,
  };
}
