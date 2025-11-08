import {
  CreateDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export abstract class Model {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', select: false })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', select: false })
  updatedAt!: Date;
}

