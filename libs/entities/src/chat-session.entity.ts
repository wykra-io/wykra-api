import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';

import { Model } from './base';
import { User } from './user.entity';

@Entity('chat_sessions')
export class ChatSession extends Model {
  @Index('chat_sessions_user_id_idx')
  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'title', type: 'text', nullable: true })
  title!: string | null;
}

