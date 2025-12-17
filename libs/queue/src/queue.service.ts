import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';

import { QueueName } from './enums';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(QueueName.Tasks) private readonly queueTasks: Queue,
    @InjectQueue(QueueName.Instagram) private readonly queueInstagram: Queue,
    @InjectQueue(QueueName.TikTok) private readonly queueTikTok: Queue,
  ) {}

  public get tasks(): Queue {
    return this.queueTasks;
  }

  public get instagram(): Queue {
    return this.queueInstagram;
  }

  public get tiktok(): Queue {
    return this.queueTikTok;
  }
}
