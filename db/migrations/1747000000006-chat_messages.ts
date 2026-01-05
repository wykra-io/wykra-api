import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class ChatMessages1747000000006 implements MigrationInterface {
  public get _tableName(): string {
    return 'chat_messages';
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
            name: 'role',
            type: 'text',
          },
          {
            name: 'content',
            type: 'text',
          },
          {
            name: 'detected_endpoint',
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable(this._tableName);
  }
}

