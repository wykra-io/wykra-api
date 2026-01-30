import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class ChatTasks1747000000007 implements MigrationInterface {
  public get _tableName(): string {
    return 'chat_tasks';
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: this._tableName,
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
            primaryKeyConstraintName: `${this._tableName}_pk_idx`,
          },
          {
            name: 'user_id',
            type: 'int',
          },
          {
            name: 'chat_message_id',
            type: 'int',
          },
          {
            name: 'task_id',
            type: 'text',
          },
          {
            name: 'endpoint',
            type: 'text',
          },
          {
            name: 'status',
            type: 'text',
            default: "'pending'",
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'current_timestamp',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'current_timestamp',
          },
        ],
        indices: [
          {
            name: `${this._tableName}_user_id_idx`,
            columnNames: ['user_id'],
          },
          {
            name: `${this._tableName}_chat_message_id_idx`,
            columnNames: ['chat_message_id'],
          },
          {
            name: `${this._tableName}_task_id_idx`,
            columnNames: ['task_id'],
          },
        ],
        foreignKeys: [
          {
            columnNames: ['user_id'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['chat_message_id'],
            referencedTableName: 'chat_messages',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable(this._tableName);
  }
}
