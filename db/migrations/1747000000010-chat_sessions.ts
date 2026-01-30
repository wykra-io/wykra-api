import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class ChatSessions1747000000010 implements MigrationInterface {
  public get _tableName(): string {
    return 'chat_sessions';
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create chat_sessions table
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
            name: 'title',
            type: 'text',
            isNullable: true,
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
            name: `${this._tableName}_created_at_idx`,
            columnNames: ['created_at'],
          },
        ],
        foreignKeys: [
          {
            columnNames: ['user_id'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );

    // Add session_id column to chat_messages
    await queryRunner.addColumn(
      'chat_messages',
      new TableColumn({
        name: 'session_id',
        type: 'int',
        isNullable: true,
      }),
    );

    await queryRunner.createIndex(
      'chat_messages',
      new TableIndex({
        name: 'chat_messages_session_id_idx',
        columnNames: ['session_id'],
      }),
    );

    await queryRunner.createForeignKey(
      'chat_messages',
      new TableForeignKey({
        columnNames: ['session_id'],
        referencedTableName: this._tableName,
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop FK and index from chat_messages
    const table = await queryRunner.getTable('chat_messages');
    if (table) {
      const foreignKey = table.foreignKeys.find(
        (fk) => fk.columnNames.length === 1 && fk.columnNames[0] === 'session_id',
      );
      if (foreignKey) {
        await queryRunner.dropForeignKey('chat_messages', foreignKey);
      }

      const index = table.indices.find(
        (idx) => idx.name === 'chat_messages_session_id_idx',
      );
      if (index) {
        await queryRunner.dropIndex('chat_messages', index);
      }
    }

    await queryRunner.dropColumn('chat_messages', 'session_id');

    // Drop chat_sessions table
    await queryRunner.dropTable(this._tableName);
  }
}

