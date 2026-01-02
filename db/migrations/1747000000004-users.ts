import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class Users1747000000004 implements MigrationInterface {
  public get _tableName(): string {
    return 'users';
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
            name: 'github_id',
            type: 'bigint',
            isUnique: true,
          },
          {
            name: 'github_login',
            type: 'text',
          },
          {
            name: 'github_scopes',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'api_token_hash',
            type: 'text',
            isNullable: true,
            isUnique: true,
          },
          {
            name: 'api_token_created_at',
            type: 'timestamp',
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
            name: `${this._tableName}_github_id_idx`,
            columnNames: ['github_id'],
          },
          {
            name: `${this._tableName}_api_token_hash_idx`,
            columnNames: ['api_token_hash'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable(this._tableName);
  }
}


