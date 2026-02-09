import { useEffect, useState } from 'react';
import { apiGet, apiPatch } from '../api';

type DashboardStats = {
  users: {
    total: number;
    admins: number;
    withGithub: number;
    withTelegram: number;
  };
  tasks: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
  };
  chats: {
    totalSessions: number;
    totalMessages: number;
  };
};

type User = {
  id: number;
  githubLogin: string | null;
  githubId: string | null;
  telegramUsername: string | null;
  telegramId: string | null;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

type Task = {
  id: number;
  taskId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ChatSession = {
  id: number;
  userId: number;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

type Tab = 'users' | 'tasks' | 'chats' | 'settings';

export function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('users');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Settings state
  const [reasoningEffort, setReasoningEffort] = useState<string>('none');
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    const loadStats = async () => {
      try {
        setLoading(true);
        const response = await apiGet<
          DashboardStats | { data: DashboardStats }
        >('/api/v1/admin/dashboard');
        const data =
          response && typeof response === 'object' && 'data' in response
            ? response.data
            : response;
        setStats(data);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load dashboard stats',
        );
      } finally {
        setLoading(false);
      }
    };

    void loadStats();
  }, []);

  useEffect(() => {
    const loadTabData = async () => {
      try {
        setLoadingData(true);
        if (activeTab === 'users') {
          const response = await apiGet<User[] | { data: User[] }>(
            '/api/v1/admin/users',
          );
          const data =
            response && Array.isArray(response)
              ? response
              : response && typeof response === 'object' && 'data' in response
                ? (response as { data: User[] }).data
                : [];
          setUsers(Array.isArray(data) ? data : []);
        } else if (activeTab === 'tasks') {
          const response = await apiGet<Task[] | { data: Task[] }>(
            '/api/v1/admin/tasks',
          );
          const data =
            response && Array.isArray(response)
              ? response
              : response && typeof response === 'object' && 'data' in response
                ? (response as { data: Task[] }).data
                : [];
          setTasks(Array.isArray(data) ? data : []);
        } else if (activeTab === 'chats') {
          const response = await apiGet<
            ChatSession[] | { data: ChatSession[] }
          >('/api/v1/admin/chats');
          const data =
            response && Array.isArray(response)
              ? response
              : response && typeof response === 'object' && 'data' in response
                ? response.data
                : [];
          setChats(Array.isArray(data) ? data : []);
        } else if (activeTab === 'settings') {
          const response = await apiGet<{ reasoningEffort: string }>(
            '/api/v1/admin/settings',
          );
          setReasoningEffort(response.reasoningEffort || 'none');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoadingData(false);
      }
    };

    void loadTabData();
  }, [activeTab]);

  const handleSaveSettings = async () => {
    try {
      setSavingSettings(true);
      await apiPatch('/api/v1/admin/settings', { reasoningEffort });
      alert('Settings saved successfully');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) {
    return (
      <div className="container">
        <h1 className="title">Admin Dashboard</h1>
        <p className="muted">Loading...</p>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="container">
        <h1 className="title">Admin Dashboard</h1>
        <p style={{ color: '#ef4444' }}>Error: {error}</p>
      </div>
    );
  }

  const formatDate = (dateValue: string | Date | null | undefined): string => {
    if (!dateValue) return '-';
    try {
      // Handle both string and Date object
      const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
      if (isNaN(date.getTime())) return '-';
      return date.toLocaleString();
    } catch {
      return '-';
    }
  };

  return (
    <div className="container">
      <h1 className="title" style={{ fontSize: 28 }}>
        Admin Dashboard
      </h1>

      <div className="adminTabs">
        <button
          type="button"
          className={`adminTab ${activeTab === 'users' ? 'adminTabActive' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          Users {stats && `(${stats.users.total})`}
        </button>
        <button
          type="button"
          className={`adminTab ${activeTab === 'tasks' ? 'adminTabActive' : ''}`}
          onClick={() => setActiveTab('tasks')}
        >
          Tasks {stats && `(${stats.tasks.total})`}
        </button>
        <button
          type="button"
          className={`adminTab ${activeTab === 'chats' ? 'adminTabActive' : ''}`}
          onClick={() => setActiveTab('chats')}
        >
          Chats {stats && `(${stats.chats.totalSessions})`}
        </button>
        <button
          type="button"
          className={`adminTab ${activeTab === 'settings' ? 'adminTabActive' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
      </div>

      <div className="adminTableContainer">
        {loadingData ? (
          <p className="muted">Loading...</p>
        ) : activeTab === 'users' ? (
          <table className="adminTable">
            <thead>
              <tr>
                <th>ID</th>
                <th>GitHub Login</th>
                <th>GitHub ID</th>
                <th>Telegram Username</th>
                <th>Telegram ID</th>
                <th>Admin</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 24 }}>
                    No users found
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.id}</td>
                    <td>{user.githubLogin || '-'}</td>
                    <td>{user.githubId || '-'}</td>
                    <td>{user.telegramUsername || '-'}</td>
                    <td>{user.telegramId || '-'}</td>
                    <td>
                      {user.isAdmin ? (
                        <span style={{ color: '#10b981', fontWeight: 600 }}>
                          Yes
                        </span>
                      ) : (
                        'No'
                      )}
                    </td>
                    <td>{formatDate(user.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : activeTab === 'tasks' ? (
          <table className="adminTable">
            <thead>
              <tr>
                <th>ID</th>
                <th>Task ID</th>
                <th>Status</th>
                <th>Started At</th>
                <th>Completed At</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 24 }}>
                    No tasks found
                  </td>
                </tr>
              ) : (
                tasks.map((task) => (
                  <tr key={task.id}>
                    <td>{task.id}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {task.taskId}
                    </td>
                    <td>
                      <span
                        style={{
                          color:
                            task.status === 'completed'
                              ? '#10b981'
                              : task.status === 'failed'
                                ? '#ef4444'
                                : task.status === 'cancelled'
                                  ? '#f59e0b'
                                : task.status === 'running'
                                  ? '#3b82f6'
                                  : '#64748b',
                          fontWeight: 600,
                        }}
                      >
                        {task.status}
                      </span>
                    </td>
                    <td>{task.startedAt ? formatDate(task.startedAt) : '-'}</td>
                    <td>
                      {task.completedAt ? formatDate(task.completedAt) : '-'}
                    </td>
                    <td>{formatDate(task.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : activeTab === 'settings' ? (
          <div style={{ padding: 24, maxWidth: 600 }}>
            <h2 style={{ fontSize: 20, marginBottom: 24 }}>General Settings</h2>

            <div style={{ marginBottom: 24 }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: 8,
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                Instagram Search Reasoning Effort
              </label>
              <select
                value={reasoningEffort}
                onChange={(e) => setReasoningEffort(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid #e2e8f0',
                  backgroundColor: 'white',
                  fontSize: 14,
                }}
              >
                <option value="">Empty</option>
                <option value="none">None (Fastest)</option>
              </select>
              <p
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: '#64748b',
                  lineHeight: 1.5,
                }}
              >
                Controls the reasoning effort for Instagram web search. For
                non-admin users, this is always set to "none".
              </p>
            </div>

            <button
              type="button"
              onClick={handleSaveSettings}
              disabled={savingSettings}
              style={{
                backgroundColor: '#3b82f6',
                color: 'white',
                padding: '8px 24px',
                borderRadius: 6,
                fontWeight: 600,
                fontSize: 14,
                border: 'none',
                cursor: savingSettings ? 'not-allowed' : 'pointer',
                opacity: savingSettings ? 0.7 : 1,
              }}
            >
              {savingSettings ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        ) : (
          <table className="adminTable">
            <thead>
              <tr>
                <th>ID</th>
                <th>User ID</th>
                <th>Title</th>
                <th>Created At</th>
                <th>Updated At</th>
              </tr>
            </thead>
            <tbody>
              {chats.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 24 }}>
                    No chat sessions found
                  </td>
                </tr>
              ) : (
                chats.map((chat) => (
                  <tr key={chat.id}>
                    <td>{chat.id}</td>
                    <td>{chat.userId}</td>
                    <td>{chat.title || '-'}</td>
                    <td>{formatDate(chat.createdAt)}</td>
                    <td>{formatDate(chat.updatedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
