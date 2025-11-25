import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';

import { QueueName } from './enums';

@Injectable()
export class QueueService {
  constructor(@InjectQueue(QueueName.Tasks) private readonly queueTasks: Queue) {}

  public get tasks(): Queue {
    return this.queueTasks;
  }
}

