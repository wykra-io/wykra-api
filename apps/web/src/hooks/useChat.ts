import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

import { apiDelete, apiGet, apiPatch, apiPost } from '../api';
import type {
  ChatMessage,
  ChatPostResponse,
  TaskStatusResponse,
  ChatSession,
} from '../types';
import {
  detectPlatformFromMessage,
  parseInstagramSearchResults,
  parseProfileCardData,
  parseTikTokSearchResults,
} from '../chat/profileCardMessage';

function normalizeChatPostResponse(payload: ChatPostResponse): {
  taskId: string | null;
} {
  const chatData =
    payload && typeof payload === 'object' && 'data' in payload && payload.data
      ? payload.data
      : payload;
  return { taskId: chatData?.taskId ? String(chatData.taskId) : null };
}

export type ChatSuccessRequest = {
  sessionId: number;
  requestMessageId: string;
  title: string;
  kind:
    | 'instagram_profile_analysis'
    | 'tiktok_profile_analysis'
    | 'instagram_search_results'
    | 'tiktok_search_results';
  createdAt?: string;
};

function normalizeHistoryMessages(
  historyData: Array<ChatMessage>,
): ChatMessage[] {
  return historyData.map((msg) => {
    const rawCreatedAt =
      msg && typeof msg === 'object' && 'createdAt' in msg
        ? (msg as { createdAt?: unknown }).createdAt
        : undefined;
    const createdAt =
      typeof rawCreatedAt === 'string'
        ? rawCreatedAt
        : typeof rawCreatedAt === 'number'
          ? new Date(rawCreatedAt).toISOString()
          : undefined;

    return {
      id: String(msg.id),
      role: msg.role,
      content: msg.content,
      detectedEndpoint: msg.detectedEndpoint || undefined,
      createdAt,
    };
  });
}

function normalizeRequestTitle(content: string): string {
  const trimmed = String(content ?? '').trim();
  const oneLine = trimmed.replace(/\s+/g, ' ');
  if (!oneLine) return 'Request';
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
}

function extractSuccessRequests(
  sessionId: number,
  history: ChatMessage[],
): ChatSuccessRequest[] {
  const results: ChatSuccessRequest[] = [];
  const seenRequestIds = new Set<string>();

  for (let i = 0; i < history.length; i++) {
    const message = history[i];
    if (message.role !== 'assistant') continue;

    const instagramSearch = parseInstagramSearchResults(message.content);
    const tiktokSearch = parseTikTokSearchResults(message.content);

    const platform = detectPlatformFromMessage(
      message.content,
      message.detectedEndpoint,
    );
    const profileCard =
      platform && parseProfileCardData(message.content, platform)
        ? platform
        : null;

    const kind: ChatSuccessRequest['kind'] | null = instagramSearch
      ? 'instagram_search_results'
      : tiktokSearch
        ? 'tiktok_search_results'
        : profileCard === 'instagram'
          ? 'instagram_profile_analysis'
          : profileCard === 'tiktok'
            ? 'tiktok_profile_analysis'
            : null;

    if (!kind) continue;

    let requestMessage: ChatMessage | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const candidate = history[j];
      if (candidate.role === 'user') {
        requestMessage = candidate;
        break;
      }
    }
    if (!requestMessage) continue;

    if (seenRequestIds.has(requestMessage.id)) continue;
    seenRequestIds.add(requestMessage.id);

    results.push({
      sessionId,
      requestMessageId: requestMessage.id,
      title: normalizeRequestTitle(requestMessage.content),
      kind,
      createdAt: requestMessage.createdAt,
    });
  }

  return results;
}

export function useChat({ enabled }: { enabled: boolean }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionIdState] = useState<number | null>(
    null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskStopping, setTaskStopping] = useState(false);

  const [successRequestsBySessionId, setSuccessRequestsBySessionId] = useState<
    Record<number, ChatSuccessRequest[]>
  >({});
  const [
    successRequestsLoadingBySessionId,
    setSuccessRequestsLoadingBySessionId,
  ] = useState<Record<number, boolean>>({});

  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const isInitialLoadRef = useRef(true);
  const pendingPlaceholderIdRef = useRef<number | null>(null);
  const justReplacedPlaceholderRef = useRef(false);

  const activeTaskIdRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<number | null>(null);
  useEffect(() => {
    activeTaskIdRef.current = activeTaskId;
  }, [activeTaskId]);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const setActiveSessionId = useCallback((nextId: number | null) => {
    // Keep ref in sync immediately to avoid races with in-flight async loads.
    activeSessionIdRef.current = nextId;
    setActiveSessionIdState(nextId);
  }, []);

  const loadSuccessRequestsForSession = useCallback(
    async (sessionId: number, { force }: { force?: boolean } = {}) => {
      if (!enabled || !sessionId) return;
      if (!force && successRequestsBySessionId[sessionId]) return;
      if (successRequestsLoadingBySessionId[sessionId]) return;

      setSuccessRequestsLoadingBySessionId((prev) => ({
        ...prev,
        [sessionId]: true,
      }));

      try {
        const historyResp = await apiGet<
          { data: Array<ChatMessage> } | Array<ChatMessage>
        >(`/api/v1/chat/history?sessionId=${sessionId}`);
        const historyData = Array.isArray(historyResp)
          ? historyResp
          : historyResp.data || [];

        const loadedMessages = normalizeHistoryMessages(historyData);
        const requests = extractSuccessRequests(sessionId, loadedMessages);

        setSuccessRequestsBySessionId((prev) => ({
          ...prev,
          [sessionId]: requests,
        }));
      } catch (error) {
        console.warn(
          `Failed to load successful requests for session ${sessionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        setSuccessRequestsLoadingBySessionId((prev) => ({
          ...prev,
          [sessionId]: false,
        }));
      }
    },
    [enabled, successRequestsBySessionId, successRequestsLoadingBySessionId],
  );

  const loadChatHistory = useCallback(
    async (sessionIdOverride?: number) => {
      const sessionIdToFetch = sessionIdOverride ?? activeSessionId;
      if (!enabled || !sessionIdToFetch) return null;
      if (sessionIdToFetch < 0) return null;
      const sessionIdFetched = sessionIdToFetch;
      try {
        const historyResp = await apiGet<
          { data: Array<ChatMessage> } | Array<ChatMessage>
        >(`/api/v1/chat/history?sessionId=${sessionIdFetched}`);
        const historyData = Array.isArray(historyResp)
          ? historyResp
          : historyResp.data || [];

        const loadedMessages = normalizeHistoryMessages(historyData);

        if (activeSessionIdRef.current !== sessionIdFetched) {
          return loadedMessages;
        }

        setMessages(loadedMessages);
        setSuccessRequestsBySessionId((prev) => ({
          ...prev,
          [sessionIdFetched]: extractSuccessRequests(
            sessionIdFetched,
            loadedMessages,
          ),
        }));

        if (loadedMessages.length > 0) {
          window.setTimeout(() => {
            isInitialLoadRef.current = false;
          }, 100);
        }

        return loadedMessages;
      } catch (error) {
        console.warn(
          `Failed to load chat history: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      }
    },
    [enabled, activeSessionId],
  );

  const loadSessions = useCallback(
    async ({
      skipHistory = false,
      activeSessionIdOverride = null,
      autoCreateIfEmpty = false,
    }: {
      skipHistory?: boolean;
      activeSessionIdOverride?: number | null;
      autoCreateIfEmpty?: boolean;
    } = {}) => {
      if (!enabled) return;
      try {
        const resp = await apiGet<{ data?: ChatSession[] } | ChatSession[]>(
          `/api/v1/chat/sessions`,
        );
        const list = Array.isArray(resp) ? resp : resp.data || [];

        if (pendingPlaceholderIdRef.current !== null) {
          return;
        }

        if (autoCreateIfEmpty && list.length === 0) {
          void createNewSession();
          return;
        }

        setSessions((prev) => {
          const currentActiveId =
            activeSessionIdOverride ?? activeSessionIdRef.current;
          const activeInList = list.some(
            (s: ChatSession) => Number(s.id) === Number(currentActiveId),
          );
          if (
            currentActiveId != null &&
            !activeInList &&
            prev.some((s) => Number(s.id) === Number(currentActiveId))
          ) {
            const activeSession = prev.find(
              (s) => Number(s.id) === Number(currentActiveId),
            );
            if (activeSession) {
              return [
                activeSession,
                ...list.filter((s: ChatSession) => s.id !== activeSession.id),
              ];
            }
          }
          return list;
        });

        const nextActiveId =
          activeSessionIdOverride ?? activeSessionIdRef.current;
        // Avoid stale in-flight loads overwriting a newer selection (e.g. after "New chat").
        if (nextActiveId == null && list.length > 0) {
          setActiveSessionId(list[0].id);
          if (!skipHistory) {
            void loadChatHistory(list[0].id);
          }
        } else if (nextActiveId != null && !skipHistory) {
          void loadChatHistory(nextActiveId);
        }

        // Prefetch success request indexes so the side menu can render submenus.
        // Keep it bounded to avoid flooding the API if the user has many sessions.
        const prefetchTargets = list.slice(0, 25);
        void Promise.allSettled(
          prefetchTargets.map((s) => loadSuccessRequestsForSession(s.id)),
        );
      } catch (error) {
        console.warn(
          `Failed to load chat sessions: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    [
      enabled,
      loadSuccessRequestsForSession,
      loadChatHistory,
      setActiveSessionId,
    ],
  );

  useEffect(() => {
    if (!enabled) {
      setMessages([]);
      isInitialLoadRef.current = true;
      setActiveTaskId(null);
      setTaskStopping(false);
      setChatInput('');
      setChatSending(false);
      setSessions([]);
      return;
    }

    // Initial load of sessions
    // Auto-create a session if none exist.
    void loadSessions({ autoCreateIfEmpty: true });
  }, [enabled]);

  useEffect(() => {
    if (!enabled || activeSessionId === null || activeSessionId < 0) {
      return;
    }

    // After replacing placeholder with real session, only load history so we don't
    // overwrite the list and end up selecting the wrong chat.
    if (justReplacedPlaceholderRef.current) {
      justReplacedPlaceholderRef.current = false;
      void loadChatHistory();
      return;
    }

    // Load history when active session changes
    void loadChatHistory();
  }, [enabled, activeSessionId]);

  // Reset "initial load" when switching session so we scroll once when loading that session's history.
  useEffect(() => {
    isInitialLoadRef.current = true;
  }, [activeSessionId]);

  useEffect(() => {
    if (!enabled || !activeTaskId) return;

    let isCancelled = false;
    const processingPrefix = 'Processing your request';
    const isProcessingMessage = (content: string | undefined) =>
      typeof content === 'string' &&
      (content.includes(processingPrefix) || content === 'Stopping...');

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    const poll = async () => {
      const taskId = activeTaskIdRef.current;
      if (!taskId || isCancelled) return;

      try {
        const taskResp = await apiGet<
          { data?: TaskStatusResponse } | TaskStatusResponse
        >(`/api/v1/tasks/${taskId}`);
        const task: TaskStatusResponse =
          taskResp &&
          typeof taskResp === 'object' &&
          'data' in taskResp &&
          taskResp.data
            ? taskResp.data
            : (taskResp as TaskStatusResponse);

        const status = String(task.status || '')
          .trim()
          .toLowerCase();

        console.log(`Polling task ${taskId}: status=${status}`);

        // Verify that the taskId we are polling for is still the active one
        if (activeTaskIdRef.current !== taskId || isCancelled) return;

        if (
          status === 'completed' ||
          status === 'failed' ||
          status === 'cancelled'
        ) {
          // If the task is already finished, stop polling and update UI.
          setActiveTaskId((current) => (current === taskId ? null : current));
          setTaskStopping(false);

          for (let attempt = 0; attempt < 10; attempt++) {
            const history = await loadChatHistory();
            const stillProcessing =
              history?.some(
                (m) => m.role === 'assistant' && isProcessingMessage(m.content),
              ) ?? false;
            if (!stillProcessing) break;
            await sleep(750);
          }

          // If backend polling didn't update the "Processing..." message (e.g. server restarted),
          // fall back to updating the UI locally from the task status response.
          setMessages((prev) => {
            const idx = [...prev]
              .reverse()
              .findIndex(
                (m) => m.role === 'assistant' && isProcessingMessage(m.content),
              );
            if (idx === -1) return prev;
            const realIdx = prev.length - 1 - idx;

            const next = [...prev];
            if (status === 'completed') {
              next[realIdx] = {
                ...next[realIdx],
                content:
                  typeof task.result === 'string' && task.result.length > 0
                    ? task.result
                    : 'Task completed (no result).',
              };
            } else if (status === 'cancelled') {
              const isSearch =
                next[realIdx].detectedEndpoint?.includes('/search') ?? false;
              next[realIdx] = {
                ...next[realIdx],
                content: isSearch ? 'Search cancelled' : 'Analyze cancelled',
              };
            } else {
              next[realIdx] = {
                ...next[realIdx],
                content: `Task failed: ${task.error || 'Task failed'}`,
              };
            }
            return next;
          });
        }
      } catch (error) {
        console.warn(
          `Failed to poll task ${activeTaskIdRef.current ?? ''}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    };

    void poll();
    const pollInterval = window.setInterval(() => void poll(), 3000);
    const timeout = window.setTimeout(
      () => {
        if (isCancelled) return;
        // TikTok tasks can take 10-20+ minutes; allow more time before giving up.
        setActiveTaskId(null);
      },
      30 * 60 * 1000,
    );

    return () => {
      isCancelled = true;
      window.clearInterval(pollInterval);
      window.clearTimeout(timeout);
    };
  }, [activeTaskId, enabled, loadChatHistory]);

  const canSend = useMemo(
    () => enabled && !chatSending && !activeTaskId,
    [enabled, chatSending, activeTaskId],
  );

  const onChatInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setChatInput(e.target.value),
    [],
  );

  const stopActiveTask = useCallback(async () => {
    const taskId = activeTaskIdRef.current;
    console.log('stopActiveTask called', { taskId, taskStopping });
    if (!enabled || !taskId || taskStopping) return;

    setTaskStopping(true);

    const processingPrefix = 'Processing your request';
    const isProcessingMessage = (content: string | undefined) =>
      typeof content === 'string' &&
      (content.includes(processingPrefix) || content === 'Stopping...');

    // Optimistically reflect stopping in the UI.
    setMessages((prev) => {
      const idx = [...prev]
        .reverse()
        .findIndex(
          (m) => m.role === 'assistant' && isProcessingMessage(m.content),
        );
      if (idx === -1) return prev;
      const realIdx = prev.length - 1 - idx;
      const next = [...prev];
      next[realIdx] = { ...next[realIdx], content: 'Stopping...' };
      return next;
    });

    try {
      await apiPost(`/api/v1/tasks/${taskId}/stop`, {});
      // We don't need to manually update messages here because handleTaskPolling
      // will see the 'cancelled' status and update the message content.
      // However, we MUST reset taskStopping so the UI doesn't stay in "Stopping..." mode.
    } catch (error) {
      console.warn(
        `Failed to stop task ${taskId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      setMessages((prev) => {
        const idx = [...prev]
          .reverse()
          .findIndex(
            (m) => m.role === 'assistant' && isProcessingMessage(m.content),
          );
        if (idx === -1) return prev;
        const realIdx = prev.length - 1 - idx;
        const next = [...prev];
        next[realIdx] = {
          ...next[realIdx],
          content: 'Failed to stop task. Please try again.',
        };
        return next;
      });
    } finally {
      setTaskStopping(false);
    }
  }, [enabled, taskStopping]);

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const query = chatInput.trim();
      if (!query || !canSend || !activeSessionId) return;

      console.log('Chat onSubmit triggered', { query, activeSessionId });

      const userMessage: ChatMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        content: query,
      };

      setMessages((prev) => [...prev, userMessage]);
      setChatInput('');
      setChatSending(true);
      setActiveTaskId(null);

      try {
        const response = await apiPost<ChatPostResponse>(`/api/v1/chat`, {
          query,
          sessionId: activeSessionId,
        });

        const { taskId } = normalizeChatPostResponse(response);
        console.log('Chat response received', { taskId, response });
        if (taskId) {
          setActiveTaskId(taskId);
        }

        await loadChatHistory();
      } catch (error) {
        console.error('Chat onSubmit error', error);
        const errorMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Error: ${error instanceof Error ? error.message : 'Failed to send message'}`,
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setChatSending(false);
        // Keep input focused so user can type the next message
        window.setTimeout(() => chatInputRef.current?.focus(), 0);
      }
    },
    [canSend, chatInput, loadChatHistory, activeSessionId],
  );

  const createNewSession = useCallback(async () => {
    const tempId = -Date.now();
    const now = new Date().toISOString();
    const placeholder: ChatSession = {
      id: tempId,
      title: null,
      createdAt: now,
      updatedAt: now,
    };

    pendingPlaceholderIdRef.current = tempId;
    setSessions((prev) => [placeholder, ...prev]);
    setActiveSessionId(tempId);
    setMessages([]);
    setActiveTaskId(null);
    setChatInput('');
    setFocusMessageId(null);

    try {
      const resp = await apiPost<
        { id: number; title: string | null } | { data?: unknown }
      >(`/api/v1/chat/sessions`, {});
      const payload =
        resp &&
        typeof resp === 'object' &&
        'data' in resp &&
        (resp as { data?: unknown }).data
          ? (resp as { data: unknown }).data
          : resp;
      const raw =
        payload && typeof payload === 'object' && 'id' in payload
          ? (payload as { id: number; title: string | null })
          : null;
      const createdId =
        raw != null &&
        typeof raw.id === 'number' &&
        Number.isInteger(raw.id) &&
        raw.id >= -2147483648 &&
        raw.id <= 2147483647
          ? raw.id
          : null;

      if (createdId == null) {
        pendingPlaceholderIdRef.current = null;
        setSessions((prev) => {
          const next = prev.filter((s) => s.id !== tempId);
          queueMicrotask(() => setActiveSessionId(next[0]?.id ?? null));
          return next;
        });
        return;
      }

      const serverSession: ChatSession = {
        id: createdId,
        title: raw?.title ?? null,
        createdAt: now,
        updatedAt: now,
      };

      pendingPlaceholderIdRef.current = null;
      justReplacedPlaceholderRef.current = true;
      setSessions((prev) =>
        prev.map((s) => (s.id === tempId ? serverSession : s)),
      );
      setActiveSessionId(createdId);
      // Refresh sessions to ensure the new session is correctly in the list from the server
      void loadSessions({
        skipHistory: true,
        activeSessionIdOverride: createdId,
      });
    } catch (error) {
      console.warn(
        `Failed to create chat session: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      pendingPlaceholderIdRef.current = null;
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== tempId);
        if (activeSessionIdRef.current === tempId) {
          queueMicrotask(() => setActiveSessionId(next[0]?.id ?? null));
        }
        return next;
      });
    }
  }, [sessions]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({
        behavior: isInitialLoadRef.current ? 'auto' : 'smooth',
      });
    }
  }, [messages]);

  const clearFocusMessageId = useCallback(() => {
    setFocusMessageId(null);
  }, []);

  const openSessionRequest = useCallback(
    (sessionId: number, requestMessageId: string) => {
      setFocusMessageId(requestMessageId);
      setActiveSessionId(sessionId);
    },
    [],
  );

  const renameSession = useCallback(
    async (sessionId: number, title: string) => {
      const normalized = title.trim().length > 0 ? title.trim() : null;
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: normalized } : s)),
      );
      try {
        await apiPatch<{ id: number; title: string | null }>(
          `/api/v1/chat/sessions/${sessionId}`,
          { title: normalized },
        );
      } catch (error) {
        console.warn(
          `Failed to rename session ${sessionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    [],
  );

  const deleteSession = useCallback(
    async (sessionId: number) => {
      const nextActiveSessionId =
        activeSessionId === sessionId
          ? (sessions.filter((s) => s.id !== sessionId)[0]?.id ?? null)
          : activeSessionId;

      // Optimistic UI update
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setSuccessRequestsBySessionId((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      setSuccessRequestsLoadingBySessionId((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });

      if (activeSessionId === sessionId) {
        setActiveSessionId(nextActiveSessionId);
        setMessages([]);
        setActiveTaskId(null);
        setChatInput('');
        setFocusMessageId(null);
      }

      try {
        await apiDelete(`/api/v1/chat/sessions/${sessionId}`);
        // Refresh sessions to ensure the list is in sync with the server
        void loadSessions({ skipHistory: true });
      } catch (error) {
        console.warn(
          `Failed to delete session ${sessionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    [activeSessionId, sessions],
  );

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    createNewSession,
    messages,
    focusMessageId,
    clearFocusMessageId,
    openSessionRequest,
    renameSession,
    deleteSession,
    successRequestsBySessionId,
    successRequestsLoadingBySessionId,
    chatInput,
    chatSending,
    activeTaskId,
    taskStopping,
    chatEndRef,
    chatInputRef,
    canSend,
    onChatInputChange,
    onSubmit,
    stopActiveTask,
  };
}
