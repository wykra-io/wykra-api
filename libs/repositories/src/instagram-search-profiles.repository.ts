import { Injectable, Inject, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { InstagramSearchProfile } from '@libs/entities';

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
export class InstagramSearchProfilesRepository {
  constructor(
    @InjectRepository(InstagramSearchProfile)
    private readonly repository: Repository<InstagramSearchProfile>,
    @Optional()
    @Inject('MetricsService')
    private readonly metrics?: IMetricsService,
  ) {}

  public async createMany(
    profiles: Partial<InstagramSearchProfile>[],
  ): Promise<InstagramSearchProfile[]> {
    const startTime = Date.now();
    try {
      const entities = this.repository.create(profiles);
      const result = await this.repository.save(entities);
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery(
        'createMany',
        'InstagramSearchProfile',
        duration,
      );
      return result;
    } catch (error) {
      this.metrics?.recordDbQueryError(
        'createMany',
        'InstagramSearchProfile',
        'save_error',
      );
      throw error;
    }
  }

  public async findByTaskId(taskId: string): Promise<InstagramSearchProfile[]> {
    const startTime = Date.now();
    try {
      const result = await this.repository.find({ where: { taskId } });
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery('find', 'InstagramSearchProfile', duration);
      return result;
    } catch (error) {
      this.metrics?.recordDbQueryError(
        'find',
        'InstagramSearchProfile',
        'query_error',
      );
      throw error;
    }
  }
}
