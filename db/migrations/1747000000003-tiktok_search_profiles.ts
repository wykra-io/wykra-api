import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class TikTokSearchProfiles1747000000003 implements MigrationInterface {
  public get _tableName(): string {
    return 'tiktok_search_profiles';
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
            name: 'task_id',
            type: 'text',
          },
          {
            name: 'account',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'profile_url',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'followers',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'is_private',
            type: 'boolean',
            isNullable: true,
          },
          {
            name: 'analysis_summary',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'analysis_score',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'raw',
            type: 'text',
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
            name: `${this._tableName}_task_id_idx`,
            columnNames: ['task_id'],
          },
          {
            name: `${this._tableName}_account_idx`,
            columnNames: ['account'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable(this._tableName);
  }
}
