import { Injectable } from '@nestjs/common';

/**
 * In-process task cancellation registry.
 *
 * Processors register a taskId at job start, then pass the AbortSignal to any
 * network calls (BrightData/OpenRouter). The stop endpoint calls `abort(taskId)`
 * to terminate in-flight requests and unblock polling/sleeps.
 *
 * Note: This only affects the current Node process. If workers run in a separate
 * process, they need to share the same cancellation mechanism (e.g. via Redis).
 */
@Injectable()
export class TaskCancellationService {
  private readonly controllers = new Map<string, AbortController>();

  public register(taskId: string): AbortController {
    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    return controller;
  }

  public getSignal(taskId: string): AbortSignal | undefined {
    return this.controllers.get(taskId)?.signal;
  }

  public abort(taskId: string, reason?: unknown): void {
    const controller = this.controllers.get(taskId);
    console.log(`TaskCancellationService.abort called for taskId: ${taskId}`, { hasController: !!controller, reason });
    if (!controller) return;
    try {
      // Node 18+ supports abort(reason)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (controller as any).abort(reason);
    } catch {
      controller.abort();
    }
  }

  public cleanup(taskId: string): void {
    this.controllers.delete(taskId);
  }
}
