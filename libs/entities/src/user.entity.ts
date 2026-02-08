import { Column, Entity, Index } from 'typeorm';

import { Model } from './base';

@Entity('users')
export class User extends Model {
  @Index('users_github_id_idx')
  @Column({ name: 'github_id', type: 'bigint', unique: true, nullable: true })
  githubId!: string | null;

  @Column({ name: 'github_login', type: 'text', nullable: true })
  githubLogin!: string | null;

  @Column({ name: 'github_avatar_url', type: 'text', nullable: true })
  githubAvatarUrl!: string | null;

  @Column({ name: 'github_scopes', type: 'jsonb', nullable: true })
  githubScopes!: string[] | null;

  @Index('users_telegram_id_idx')
  @Column({ name: 'telegram_id', type: 'bigint', unique: true, nullable: true })
  telegramId!: string | null;

  @Column({ name: 'telegram_username', type: 'text', nullable: true })
  telegramUsername!: string | null;

  @Column({ name: 'telegram_first_name', type: 'text', nullable: true })
  telegramFirstName!: string | null;

  @Column({ name: 'telegram_last_name', type: 'text', nullable: true })
  telegramLastName!: string | null;

  @Column({ name: 'telegram_photo_url', type: 'text', nullable: true })
  telegramPhotoUrl!: string | null;

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

  @Column({ name: 'is_admin', type: 'boolean', default: false })
  isAdmin!: boolean;

  @Index('users_email_idx', { unique: true, where: 'email IS NOT NULL' })
  @Column({ name: 'email', type: 'text', unique: true, nullable: true })
  email!: string | null;

  @Column({
    name: 'password_hash',
    type: 'text',
    nullable: true,
    select: false,
  })
  passwordHash!: string | null;
}
