import { Column, Entity, Index } from 'typeorm';

import { Model } from './base';

@Entity('users')
export class User extends Model {
  @Index('users_github_id_idx')
  @Column({ name: 'github_id', type: 'bigint', unique: true })
  githubId!: string;

  @Column({ name: 'github_login', type: 'text' })
  githubLogin!: string;

  @Column({ name: 'github_scopes', type: 'jsonb', nullable: true })
  githubScopes!: string[] | null;

  @Index('users_api_token_hash_idx')
  @Column({
    name: 'api_token_hash',
    type: 'text',
    nullable: true,
    unique: true,
    select: false,
  })
  apiTokenHash!: string | null;

  @Column({
    name: 'api_token_created_at',
    type: 'timestamp',
    nullable: true,
    select: false,
  })
  apiTokenCreatedAt!: Date | null;
}
