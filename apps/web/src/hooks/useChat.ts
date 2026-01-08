import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

import { apiGet, apiPost } from '../api';
import type {
  ChatMessage,
  ChatPostResponse,
  TaskStatusResponse,
} from '../types';

function normalizeChatPostResponse(payload: ChatPostResponse): {
  taskId: string | null;
} {
  const chatData =
    payload && typeof payload === 'object' && 'data' in payload && payload.data
      ? payload.data
      : payload;
  return { taskId: chatData?.taskId ? String(chatData.taskId) : null };
}

export function useChat({ enabled }: { enabled: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const lastAutoScrollKeyRef = useRef<string>('');
  const isInitialLoadRef = useRef(true);

  const activeTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeTaskIdRef.current = activeTaskId;
  }, [activeTaskId]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    window.setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior });
    }, 100);
  }, []);

  const loadChatHistory = useCallback(async () => {
    if (!enabled) return null;
    try {
      const historyResp = await apiGet<
        { data: Array<ChatMessage> } | Array<ChatMessage>
      >(`/api/v1/chat/history`);
      const historyData = Array.isArray(historyResp)
        ? historyResp
        : historyResp.data || [];

      const loadedMessages = historyData.map((msg) => {
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

      setMessages(loadedMessages);

      if (isInitialLoadRef.current && loadedMessages.length > 0) {
        isInitialLoadRef.current = false;
        scrollToBottom('auto');
      }

      return loadedMessages;
    } catch (error) {
      console.warn(
        `Failed to load chat history: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }, [enabled, scrollToBottom]);

  useEffect(() => {
    if (enabled) {
      isInitialLoadRef.current = true;
      void loadChatHistory();
    } else {
      setMessages([]);
      isInitialLoadRef.current = true;
      setActiveTaskId(null);
      setChatInput('');
      setChatSending(false);
    }
  }, [enabled, loadChatHistory]);

  useEffect(() => {
    if (messages.length === 0) {
      lastAutoScrollKeyRef.current = '';
      return;
    }
    const last = messages[messages.length - 1];
    const key = `${last.id}|${last.content}`;
    if (key !== lastAutoScrollKeyRef.current) {
      lastAutoScrollKeyRef.current = key;
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!enabled || !activeTaskId) return;

    let isCancelled = false;
    const processingContent = 'Processing your request...';

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

        if (status === 'completed' || status === 'failed') {
          for (let attempt = 0; attempt < 10; attempt++) {
            const history = await loadChatHistory();
            const stillProcessing =
              history?.some(
                (m) =>
                  m.role === 'assistant' && m.content === processingContent,
              ) ?? false;
            if (!stillProcessing) break;
            await sleep(750);
          }
          setActiveTaskId(null);
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
      5 * 60 * 1000,
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

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const query = chatInput.trim();
      if (!query || !canSend) return;

      const userMessage: ChatMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        content: query,
      };

      setMessages((prev) => [...prev, userMessage]);
      setChatInput('');
      setChatSending(true);
      scrollToBottom();

      try {
        const response = await apiPost<ChatPostResponse>(`/api/v1/chat`, {
          query,
        });

        const { taskId } = normalizeChatPostResponse(response);
        setActiveTaskId(taskId);

        await loadChatHistory();
      } catch (error) {
        const errorMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Error: ${error instanceof Error ? error.message : 'Failed to send message'}`,
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setChatSending(false);
      }
    },
    [canSend, chatInput, loadChatHistory, scrollToBottom],
  );

  return {
    messages,
    chatInput,
    chatSending,
    activeTaskId,
    chatEndRef,
    canSend,
    onChatInputChange,
    onSubmit,
  };
}
