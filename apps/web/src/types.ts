export type MeResponse = {
  githubLogin: string;
  githubAvatarUrl: string | null;
  isAdmin: boolean;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  detectedEndpoint?: string;
  createdAt?: string;
};

export type ChatSession = {
  id: number;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChatPostResponse = {
  data?: { response: string; detectedEndpoint?: string; taskId?: string };
  response?: string;
  detectedEndpoint?: string;
  taskId?: string;
};

export type TaskStatusResponse = {
  taskId: string;
  status: string;
  result?: string | null;
  error?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};
