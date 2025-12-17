import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TikTokSearchProfile } from '@libs/entities';

// Make MetricsService optional to avoid circular dependency issues
interface IMetricsService {
  recordDbQuery(operation: string, entity: string, duration: number): void;
  recordDbQueryError(
    operation: string,
    entity: string,
    errorType: string,
  ): void;
}

@Injectable()
export class TikTokSearchProfilesRepository {
  constructor(
    @InjectRepository(TikTokSearchProfile)
    private readonly repository: Repository<TikTokSearchProfile>,
    @Optional()
    @Inject('MetricsService')
    private readonly metrics?: IMetricsService,
  ) {}

  public async createMany(
    profiles: Partial<TikTokSearchProfile>[],
  ): Promise<TikTokSearchProfile[]> {
    const startTime = Date.now();
    try {
      const entities = this.repository.create(profiles);
      const result = await this.repository.save(entities);
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery(
        'createMany',
        'TikTokSearchProfile',
        duration,
      );
      return result;
    } catch (error) {
      this.metrics?.recordDbQueryError(
        'createMany',
        'TikTokSearchProfile',
        'save_error',
      );
      throw error;
    }
  }

  public async findByTaskId(taskId: string): Promise<TikTokSearchProfile[]> {
    const startTime = Date.now();
    try {
      const result = await this.repository.find({ where: { taskId } });
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery('find', 'TikTokSearchProfile', duration);
      return result;
    } catch (error) {
      this.metrics?.recordDbQueryError(
        'find',
        'TikTokSearchProfile',
        'query_error',
      );
      throw error;
    }
  }
}
