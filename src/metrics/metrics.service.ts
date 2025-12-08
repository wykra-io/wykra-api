import { Injectable } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Gauge,
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
  private readonly taskQueueSize: Gauge<string>;
  private readonly taskQueueWaitTime: Histogram<string>;
  private readonly llmPromptTokens: Counter<string>;
  private readonly llmCompletionTokens: Counter<string>;
  private readonly llmTotalTokens: Counter<string>;
  private readonly llmCallsTotal: Counter<string>;
  private readonly llmCallDuration: Histogram<string>;
  private readonly llmCallErrors: Counter<string>;
  private readonly llmInputTokensPerRequest: Histogram<string>;
  private readonly llmOutputTokensPerRequest: Histogram<string>;
  private readonly brightdataCallsTotal: Counter<string>;
  private readonly brightdataCallDuration: Histogram<string>;
  private readonly brightdataCallErrors: Counter<string>;
  private readonly dbQueryDuration: Histogram<string>;
  private readonly dbQueryTotal: Counter<string>;
  private readonly dbQueryErrors: Counter<string>;
  private readonly redisOperationDuration: Histogram<string>;
  private readonly redisOperationTotal: Counter<string>;
  private readonly redisOperationErrors: Counter<string>;

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

    // Task Queue Size Gauge
    this.taskQueueSize = new Gauge({
      name: 'task_queue_size',
      help: 'Current size of the task queue',
      labelNames: ['queue_name'],
      registers: [register],
    });

    // Task Queue Wait Time Histogram
    this.taskQueueWaitTime = new Histogram({
      name: 'task_queue_wait_time_seconds',
      help: 'Time a task spent waiting in queue before processing',
      labelNames: ['task_type', 'queue_name'],
      buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 300],
      registers: [register],
    });

    // LLM Prompt Tokens Counter
    this.llmPromptTokens = new Counter({
      name: 'llm_prompt_tokens_total',
      help: 'Total number of prompt tokens used in LLM requests',
      labelNames: ['model', 'service'],
      registers: [register],
    });

    // LLM Completion Tokens Counter
    this.llmCompletionTokens = new Counter({
      name: 'llm_completion_tokens_total',
      help: 'Total number of completion tokens used in LLM requests',
      labelNames: ['model', 'service'],
      registers: [register],
    });

    // LLM Total Tokens Counter
    this.llmTotalTokens = new Counter({
      name: 'llm_total_tokens_total',
      help: 'Total number of tokens (prompt + completion) used in LLM requests',
      labelNames: ['model', 'service'],
      registers: [register],
    });

    // LLM Calls Total Counter
    this.llmCallsTotal = new Counter({
      name: 'llm_calls_total',
      help: 'Total number of LLM API calls',
      labelNames: ['model', 'service'],
      registers: [register],
    });

    // LLM Call Duration Histogram
    this.llmCallDuration = new Histogram({
      name: 'llm_call_duration_seconds',
      help: 'Duration of LLM API calls in seconds',
      labelNames: ['model', 'service', 'status'],
      buckets: [0.5, 1, 2, 5, 10, 20, 30, 60],
      registers: [register],
    });

    // LLM Call Errors Counter
    this.llmCallErrors = new Counter({
      name: 'llm_call_errors_total',
      help: 'Total number of LLM API call errors',
      labelNames: ['model', 'service', 'error_type'],
      registers: [register],
    });

    // LLM Input Tokens Per Request Histogram
    this.llmInputTokensPerRequest = new Histogram({
      name: 'llm_input_tokens_per_request',
      help: 'Distribution of input (prompt) tokens per request',
      labelNames: ['request_type'],
      buckets: [100, 500, 1000, 2000, 5000, 10000, 20000, 50000],
      registers: [register],
    });

    // LLM Output Tokens Per Request Histogram
    this.llmOutputTokensPerRequest = new Histogram({
      name: 'llm_output_tokens_per_request',
      help: 'Distribution of output (completion) tokens per request',
      labelNames: ['request_type'],
      buckets: [100, 500, 1000, 2000, 5000, 10000, 20000, 50000],
      registers: [register],
    });

    // BrightData Calls Total Counter
    this.brightdataCallsTotal = new Counter({
      name: 'brightdata_calls_total',
      help: 'Total number of BrightData API calls',
      labelNames: ['dataset', 'operation', 'status'],
      registers: [register],
    });

    // BrightData Call Duration Histogram
    this.brightdataCallDuration = new Histogram({
      name: 'brightdata_call_duration_seconds',
      help: 'Duration of BrightData API calls in seconds',
      labelNames: ['dataset', 'operation', 'status'],
      buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
      registers: [register],
    });

    // BrightData Call Errors Counter
    this.brightdataCallErrors = new Counter({
      name: 'brightdata_call_errors_total',
      help: 'Total number of BrightData API call errors',
      labelNames: ['dataset', 'operation', 'error_type'],
      registers: [register],
    });

    // Database Query Duration Histogram
    this.dbQueryDuration = new Histogram({
      name: 'db_query_duration_seconds',
      help: 'Duration of database queries in seconds',
      labelNames: ['operation', 'entity'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
      registers: [register],
    });

    // Database Query Total Counter
    this.dbQueryTotal = new Counter({
      name: 'db_queries_total',
      help: 'Total number of database queries',
      labelNames: ['operation', 'entity'],
      registers: [register],
    });

    // Database Query Errors Counter
    this.dbQueryErrors = new Counter({
      name: 'db_query_errors_total',
      help: 'Total number of database query errors',
      labelNames: ['operation', 'entity', 'error_type'],
      registers: [register],
    });

    // Redis Operation Duration Histogram
    this.redisOperationDuration = new Histogram({
      name: 'redis_operation_duration_seconds',
      help: 'Duration of Redis operations in seconds',
      labelNames: ['operation'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
      registers: [register],
    });

    // Redis Operation Total Counter
    this.redisOperationTotal = new Counter({
      name: 'redis_operations_total',
      help: 'Total number of Redis operations',
      labelNames: ['operation', 'status'],
      registers: [register],
    });

    // Redis Operation Errors Counter
    this.redisOperationErrors = new Counter({
      name: 'redis_operation_errors_total',
      help: 'Total number of Redis operation errors',
      labelNames: ['operation', 'error_type'],
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
   * Record LLM token usage
   */
  recordLLMTokenUsage(
    model: string,
    service: string,
    promptTokens: number,
    completionTokens: number,
    totalTokens: number,
  ): void {
    const labels = { model, service };
    this.llmPromptTokens.inc(labels, promptTokens);
    this.llmCompletionTokens.inc(labels, completionTokens);
    this.llmTotalTokens.inc(labels, totalTokens);
  }

  /**
   * Record LLM call
   */
  recordLLMCall(model: string, service: string): void {
    this.llmCallsTotal.inc({ model, service });
  }

  /**
   * Record LLM tokens per request (for averaging)
   */
  recordLLMTokensPerRequest(
    requestType: string,
    inputTokens: number,
    outputTokens: number,
  ): void {
    this.llmInputTokensPerRequest.observe(
      { request_type: requestType },
      inputTokens,
    );
    this.llmOutputTokensPerRequest.observe(
      { request_type: requestType },
      outputTokens,
    );
  }

  /**
   * Record BrightData API call
   */
  recordBrightdataCall(
    dataset: string,
    operation: string,
    duration: number,
    status: 'success' | 'error' = 'success',
  ): void {
    const labels = { dataset, operation, status };
    this.brightdataCallsTotal.inc(labels);
    this.brightdataCallDuration.observe(labels, duration);
  }

  /**
   * Record BrightData API call error
   */
  recordBrightdataError(
    dataset: string,
    operation: string,
    errorType: string,
  ): void {
    this.brightdataCallErrors.inc({
      dataset,
      operation,
      error_type: errorType,
    });
  }

  /**
   * Record LLM call duration
   */
  recordLLMCallDuration(
    model: string,
    service: string,
    duration: number,
    status: 'success' | 'error' = 'success',
  ): void {
    this.llmCallDuration.observe({ model, service, status }, duration);
  }

  /**
   * Record LLM call error
   */
  recordLLMError(model: string, service: string, errorType: string): void {
    this.llmCallErrors.inc({ model, service, error_type: errorType });
  }

  /**
   * Record database query metrics
   */
  recordDbQuery(operation: string, entity: string, duration: number): void {
    const labels = { operation, entity };
    this.dbQueryTotal.inc(labels);
    this.dbQueryDuration.observe(labels, duration);
  }

  /**
   * Record database query error
   */
  recordDbQueryError(
    operation: string,
    entity: string,
    errorType: string,
  ): void {
    this.dbQueryErrors.inc({ operation, entity, error_type: errorType });
  }

  /**
   * Record Redis operation metrics
   */
  recordRedisOperation(
    operation: string,
    duration: number,
    status: 'success' | 'error' = 'success',
  ): void {
    this.redisOperationTotal.inc({ operation, status });
    this.redisOperationDuration.observe({ operation }, duration);
  }

  /**
   * Record Redis operation error
   */
  recordRedisError(operation: string, errorType: string): void {
    this.redisOperationErrors.inc({ operation, error_type: errorType });
  }

  /**
   * Set task queue size
   */
  setTaskQueueSize(queueName: string, size: number): void {
    this.taskQueueSize.set({ queue_name: queueName }, size);
  }

  /**
   * Record task queue wait time
   */
  recordTaskQueueWaitTime(
    taskType: string,
    queueName: string,
    waitTime: number,
  ): void {
    this.taskQueueWaitTime.observe(
      { task_type: taskType, queue_name: queueName },
      waitTime,
    );
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return register.metrics();
  }
}
