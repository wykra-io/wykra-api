import { Injectable } from '@nestjs/common';
import {
  Counter,
  Histogram,
  collectDefaultMetrics,
  register,
} from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly httpRequestDuration: Histogram<string>;
  private readonly httpRequestTotal: Counter<string>;
  private readonly httpRequestErrors: Counter<string>;
  private readonly taskCreated: Counter<string>;
  private readonly taskCompleted: Counter<string>;
  private readonly taskFailed: Counter<string>;
  private readonly taskProcessingDuration: Histogram<string>;
  private readonly taskStatus: Counter<string>;

  constructor() {
    // Collect default metrics (CPU, memory, etc.)
    collectDefaultMetrics({ register });

    // HTTP Request Duration Histogram
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
      registers: [register],
    });

    // HTTP Request Total Counter
    this.httpRequestTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status'],
      registers: [register],
    });

    // HTTP Request Errors Counter
    this.httpRequestErrors = new Counter({
      name: 'http_request_errors_total',
      help: 'Total number of HTTP request errors',
      labelNames: ['method', 'route', 'status'],
      registers: [register],
    });

    // Task Created Counter
    this.taskCreated = new Counter({
      name: 'tasks_created_total',
      help: 'Total number of tasks created',
      labelNames: ['task_type'],
      registers: [register],
    });

    // Task Completed Counter
    this.taskCompleted = new Counter({
      name: 'tasks_completed_total',
      help: 'Total number of tasks completed successfully',
      labelNames: ['task_type'],
      registers: [register],
    });

    // Task Failed Counter
    this.taskFailed = new Counter({
      name: 'tasks_failed_total',
      help: 'Total number of tasks that failed',
      labelNames: ['task_type'],
      registers: [register],
    });

    // Task Processing Duration Histogram
    this.taskProcessingDuration = new Histogram({
      name: 'task_processing_duration_seconds',
      help: 'Duration of task processing in seconds',
      labelNames: ['status', 'task_type'],
      buckets: [1, 5, 10, 30, 60, 120, 300, 600],
      registers: [register],
    });

    // Task Status Counter (current state)
    this.taskStatus = new Counter({
      name: 'tasks_status_total',
      help: 'Total number of tasks by status',
      labelNames: ['status', 'task_type'],
      registers: [register],
    });
  }

  /**
   * Record HTTP request metrics
   */
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
  ): void {
    const labels = {
      method,
      route,
      status: statusCode.toString(),
    };

    this.httpRequestDuration.observe(labels, duration);
    this.httpRequestTotal.inc(labels);

    if (statusCode >= 400) {
      this.httpRequestErrors.inc(labels);
    }
  }

  /**
   * Record task creation
   */
  recordTaskCreated(taskType: string = 'generic'): void {
    this.taskCreated.inc({ task_type: taskType });
    this.taskStatus.inc({ status: 'pending', task_type: taskType });
  }

  /**
   * Record task completion
   */
  recordTaskCompleted(duration: number, taskType: string = 'generic'): void {
    this.taskCompleted.inc({ task_type: taskType });
    this.taskStatus.inc({ status: 'completed', task_type: taskType });
    this.taskProcessingDuration.observe(
      { status: 'completed', task_type: taskType },
      duration,
    );
  }

  /**
   * Record task failure
   */
  recordTaskFailed(duration: number, taskType: string = 'generic'): void {
    this.taskFailed.inc({ task_type: taskType });
    this.taskStatus.inc({ status: 'failed', task_type: taskType });
    this.taskProcessingDuration.observe(
      { status: 'failed', task_type: taskType },
      duration,
    );
  }

  /**
   * Record task status change
   */
  recordTaskStatusChange(status: string, taskType: string = 'generic'): void {
    this.taskStatus.inc({ status: status.toLowerCase(), task_type: taskType });
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return register.metrics();
  }
}
