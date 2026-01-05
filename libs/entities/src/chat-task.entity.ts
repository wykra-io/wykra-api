import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';

import { Model } from './base';
import { User } from './user.entity';
import { ChatMessage } from './chat-message.entity';

@Entity('chat_tasks')
export class ChatTask extends Model {
  @Index('chat_tasks_user_id_idx')
  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Index('chat_tasks_chat_message_id_idx')
  @Column({ name: 'chat_message_id', type: 'int', nullable: true })
  chatMessageId!: number | null;

  @ManyToOne(() => ChatMessage, { nullable: true })
  @JoinColumn({ name: 'chat_message_id' })
  chatMessage!: ChatMessage | null;

  @Column({ name: 'task_id', type: 'text' })
  taskId!: string;

  @Column({ name: 'endpoint', type: 'text' })
  endpoint!: string;

  @Column({ name: 'status', type: 'text', default: 'pending' })
  status!: string;
}
