import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';

import { apiGet, apiPost, getApiBaseUrl } from './api';

type TaskStatusResponse = {
  taskId: string;
  status: string;
  result?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  instagramProfiles?: unknown[];
  tiktokProfiles?: unknown[];
};

export function App() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [taskId, setTaskId] = useState('');
  const [taskStatus, setTaskStatus] = useState<TaskStatusResponse | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);

  const [instagramQuery, setInstagramQuery] = useState(
    'Find up to 10 public Instagram accounts from Portugal who post about cooking and have not more than 50000 followers',
  );
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function fetchTask() {
    setTaskError(null);
    setTaskLoading(true);
    try {
      const data = await apiGet<TaskStatusResponse>(`/api/v1/tasks/${taskId}`);
      setTaskStatus(data);
    } catch (e) {
      setTaskStatus(null);
      setTaskError(e instanceof Error ? e.message : String(e));
    } finally {
      setTaskLoading(false);
    }
  }

  async function createInstagramSearch() {
    setCreateError(null);
    setCreateLoading(true);
    try {
      const resp = await apiPost<{ taskId: string }>(`/api/v1/instagram/search`, {
        query: instagramQuery,
      });
      setTaskId(resp.taskId);
      setTaskStatus(null);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreateLoading(false);
    }
  }

  return (
    <div className="container">
      <h1 style={{ margin: 0 }}>Wykra</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        API base: <code>{apiBaseUrl}</code>
      </p>

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Create Instagram Search Task</h2>
          <label>Query</label>
          <textarea
            value={instagramQuery}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              setInstagramQuery(e.target.value)
            }
          />
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={createInstagramSearch} disabled={createLoading}>
              {createLoading ? 'Creating…' : 'Create task'}
            </button>
            <span className="muted">
              Returns a <code>taskId</code> you can poll.
            </span>
          </div>
          {createError ? (
            <p className="muted" style={{ color: '#b91c1c' }}>
              {createError}
            </p>
          ) : null}
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Check Task Status</h2>
          <label>Task ID</label>
          <input
            value={taskId}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setTaskId(e.target.value)
            }
            placeholder="paste taskId here"
          />
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="secondary"
              onClick={fetchTask}
              disabled={!taskId.trim() || taskLoading}
            >
              {taskLoading ? 'Loading…' : 'Fetch status'}
            </button>
          </div>
          {taskError ? (
            <p className="muted" style={{ color: '#b91c1c' }}>
              {taskError}
            </p>
          ) : null}
          {taskStatus ? (
            <div style={{ marginTop: 12 }}>
              <pre>{JSON.stringify(taskStatus, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}


