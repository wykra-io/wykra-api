import { Column, Entity } from 'typeorm';

import { Model } from './base';

@Entity('instagram_search_profiles')
export class InstagramSearchProfile extends Model {
  @Column({ name: 'task_id', type: 'text' })
  taskId!: string;

  @Column({ name: 'account', type: 'text', nullable: true })
  account!: string | null;

  @Column({ name: 'profile_url', type: 'text', nullable: true })
  profileUrl!: string | null;

  @Column({ name: 'followers', type: 'int', nullable: true })
  followers!: number | null;

  @Column({ name: 'is_private', type: 'boolean', nullable: true })
  isPrivate!: boolean | null;

  @Column({ name: 'is_business_account', type: 'boolean', nullable: true })
  isBusinessAccount!: boolean | null;

  @Column({ name: 'is_professional_account', type: 'boolean', nullable: true })
  isProfessionalAccount!: boolean | null;

  @Column({ name: 'analysis_summary', type: 'text', nullable: true })
  analysisSummary!: string | null;

  @Column({ name: 'analysis_score', type: 'int', nullable: true })
  analysisScore!: number | null;

  @Column({ name: 'raw', type: 'text' })
  raw!: string;
}
