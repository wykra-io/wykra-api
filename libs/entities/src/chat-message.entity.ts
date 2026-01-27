import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';

import { Model } from './base';
import { User } from './user.entity';
import { ChatSession } from './chat-session.entity';

export enum ChatMessageRole {
  User = 'user',
  Assistant = 'assistant',
}

@Entity('chat_messages')
export class ChatMessage extends Model {
  @Index('chat_messages_session_id_idx')
  @Column({ name: 'session_id', type: 'int', nullable: true })
  sessionId!: number | null;

  @ManyToOne(() => ChatSession, { nullable: true })
  @JoinColumn({ name: 'session_id' })
  session!: ChatSession | null;

  @Index('chat_messages_user_id_idx')
  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'text' })
  role!: ChatMessageRole;

  @Column({ type: 'text' })
  content!: string;

  @Column({ name: 'detected_endpoint', type: 'text', nullable: true })
  detectedEndpoint!: string | null;
}
