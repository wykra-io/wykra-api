import { Column, Entity } from 'typeorm';

import { Model } from './base';

export enum TaskStatus {
  Pending = 'pending',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
}

@Entity('tasks')
export class Task extends Model {
  @Column({ name: 'task_id', type: 'text', unique: true })
  taskId!: string;

  @Column({ type: 'text' })
  status!: TaskStatus;

  @Column({ type: 'text', nullable: true })
  result!: string | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ name: 'started_at', type: 'timestamp', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt!: Date | null;
}
