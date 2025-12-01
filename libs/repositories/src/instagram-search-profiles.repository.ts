import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { InstagramSearchProfile } from '@libs/entities';

@Injectable()
export class InstagramSearchProfilesRepository {
  constructor(
    @InjectRepository(InstagramSearchProfile)
    private readonly repository: Repository<InstagramSearchProfile>,
  ) {}

  public async createMany(
    profiles: Partial<InstagramSearchProfile>[],
  ): Promise<InstagramSearchProfile[]> {
    const entities = this.repository.create(profiles);
    return this.repository.save(entities);
  }

  public async findByTaskId(taskId: string): Promise<InstagramSearchProfile[]> {
    return this.repository.find({ where: { taskId } });
  }
}
