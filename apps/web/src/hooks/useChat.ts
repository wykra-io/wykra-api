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
  response: string | null;
  sessionId: number | null;
} {
  const chatData =
    payload && typeof payload === 'object' && 'data' in payload && payload.data
      ? payload.data
      : payload;
  const rawSessionId =
    chatData && typeof chatData === 'object' && 'sessionId' in chatData
      ? (chatData as { sessionId?: unknown }).sessionId
      : null;
  const sessionId =
    typeof rawSessionId === 'number' && Number.isInteger(rawSessionId)
      ? rawSessionId
      : typeof rawSessionId === 'string' && rawSessionId.trim().length > 0
        ? Number(rawSessionId)
        : null;
  const responseValue =
    chatData && typeof chatData === 'object' && 'response' in chatData
      ? (chatData as { response?: unknown }).response
      : null;
  const response = typeof responseValue === 'string' ? responseValue : null;
  return {
    taskId: chatData?.taskId ? String(chatData.taskId) : null,
    response,
    sessionId:
      typeof sessionId === 'number' && Number.isInteger(sessionId)
        ? sessionId
        : null,
  };
}

const PROCESSING_PREFIX = 'Processing your request';
const isProcessingMessage = (content: string | undefined) =>
  typeof content === 'string' &&
  (content.includes(PROCESSING_PREFIX) ||
    content === 'Stopping...' ||
    content === 'Analyze cancelled' ||
    content === 'Search cancelled');

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  const skipNextHistoryLoadRef = useRef(false);

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

    if (skipNextHistoryLoadRef.current) {
      skipNextHistoryLoadRef.current = false;
      justReplacedPlaceholderRef.current = false;
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
    if (enabled && activeSessionId !== null) {
      window.setTimeout(() => chatInputRef.current?.focus(), 0);
    }
  }, [activeSessionId, enabled]);

  useEffect(() => {
    if (!enabled || !activeTaskId) return;

    let isCancelled = false;
    const sessionIdSnapshot = activeSessionIdRef.current;

    const refreshHistoryUntilSettled = async () => {
      if (!sessionIdSnapshot || sessionIdSnapshot < 0) return;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        if (isCancelled) return;
        if (activeSessionIdRef.current !== sessionIdSnapshot) return;
        const loadedMessages = await loadChatHistory(sessionIdSnapshot);
        if (!loadedMessages) return;
        const lastAssistant = [...loadedMessages]
          .reverse()
          .find((message) => message.role === 'assistant');
        if (!lastAssistant || !isProcessingMessage(lastAssistant.content)) {
          return;
        }
        await sleep(1000);
      }
    };

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
          setActiveTaskId((current) => (current === taskId ? null : current));
          setTaskStopping(false);

          // Refresh until the processing placeholder is replaced by the result.
          console.log(`Task ${status}, refreshing history...`);
          void refreshHistoryUntilSettled();
          return;
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
    () => enabled && !chatSending && !activeTaskId && !taskStopping,
    [enabled, chatSending, activeTaskId, taskStopping],
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
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (!activeTaskIdRef.current) break;
      }
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

        let didSwitchSession = false;
        const {
          taskId,
          response: assistantResponse,
          sessionId: serverSessionId,
        } = normalizeChatPostResponse(response);
        console.log('Chat response received', {
          taskId,
          serverSessionId,
          response,
        });
        if (taskId) {
          setActiveTaskId(taskId);
        }

        if (
          serverSessionId &&
          Number.isInteger(serverSessionId) &&
          serverSessionId > 0 &&
          serverSessionId !== activeSessionIdRef.current
        ) {
          if (pendingPlaceholderIdRef.current !== null) {
            const tempId = pendingPlaceholderIdRef.current;
            const now = new Date().toISOString();
            const fallbackTitle = normalizeRequestTitle(query);
            pendingPlaceholderIdRef.current = null;
            justReplacedPlaceholderRef.current = true;
            setSessions((prev) =>
              prev.map((session) =>
                session.id === tempId
                  ? {
                      ...session,
                      id: serverSessionId,
                      title: session.title ?? fallbackTitle,
                      createdAt: session.createdAt || now,
                      updatedAt: now,
                    }
                  : session,
              ),
            );
          }

          setActiveSessionId(serverSessionId);
          didSwitchSession = true;
          void loadSessions({
            skipHistory: true,
            activeSessionIdOverride: serverSessionId,
          });
        }

        if (!taskId && assistantResponse) {
          const assistantMessage: ChatMessage = {
            id: `local-${Date.now() + 1}`,
            role: 'assistant',
            content: assistantResponse,
          };
          setMessages((prev) => [...prev, assistantMessage]);
        }

        if (taskId) {
          if (didSwitchSession) {
            skipNextHistoryLoadRef.current = true;
          }
          const processingMessageContent =
            assistantResponse && assistantResponse.trim().length > 0
              ? assistantResponse
              : `${PROCESSING_PREFIX}...`;
          const processingMessage: ChatMessage = {
            id: `local-processing-${Date.now()}`,
            role: 'assistant',
            content: processingMessageContent,
          };
          setMessages((prev) => [...prev, processingMessage]);
          return;
        }

        if (assistantResponse) {
          if (didSwitchSession) {
            skipNextHistoryLoadRef.current = true;
          }
          return;
        }

        await loadChatHistory(serverSessionId ?? activeSessionId ?? undefined);
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
    [
      canSend,
      chatInput,
      loadChatHistory,
      loadSessions,
      activeSessionId,
      setActiveSessionId,
    ],
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

      if (pendingPlaceholderIdRef.current !== tempId) {
        // Placeholder was already resolved by another request (e.g. chat submit).
        void loadSessions({ skipHistory: true });
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
  }, [loadSessions, setActiveSessionId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (chatEndRef.current) {
      // Use a small timeout to ensure DOM has updated and layout is stable
      const timeoutId = window.setTimeout(() => {
        chatEndRef.current?.scrollIntoView({
          behavior: isInitialLoadRef.current ? 'auto' : 'smooth',
          block: 'end',
        });
      }, 0);
      return () => window.clearTimeout(timeoutId);
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
