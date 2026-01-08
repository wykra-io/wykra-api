import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddTelegramAuthToUsers1747000000009 implements MigrationInterface {
  public get _tableName(): string {
    return 'users';
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.changeColumn(
      this._tableName,
      'github_id',
      new TableColumn({
        name: 'github_id',
        type: 'bigint',
        isUnique: true,
        isNullable: true,
      }),
    );

    await queryRunner.changeColumn(
      this._tableName,
      'github_login',
      new TableColumn({
        name: 'github_login',
        type: 'text',
        isNullable: true,
      }),
    );

    await queryRunner.addColumns(this._tableName, [
      new TableColumn({
        name: 'telegram_id',
        type: 'bigint',
        isNullable: true,
        isUnique: true,
      }),
      new TableColumn({
        name: 'telegram_username',
        type: 'text',
        isNullable: true,
      }),
      new TableColumn({
        name: 'telegram_first_name',
        type: 'text',
        isNullable: true,
      }),
      new TableColumn({
        name: 'telegram_last_name',
        type: 'text',
        isNullable: true,
      }),
      new TableColumn({
        name: 'telegram_photo_url',
        type: 'text',
        isNullable: true,
      }),
    ]);

    await queryRunner.createIndex(
      this._tableName,
      new TableIndex({
        name: `${this._tableName}_telegram_id_idx`,
        columnNames: ['telegram_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(this._tableName, `${this._tableName}_telegram_id_idx`);
    await queryRunner.dropColumns(this._tableName, [
      'telegram_id',
      'telegram_username',
      'telegram_first_name',
      'telegram_last_name',
      'telegram_photo_url',
    ]);

    await queryRunner.changeColumn(
      this._tableName,
      'github_login',
      new TableColumn({
        name: 'github_login',
        type: 'text',
        isNullable: false,
      }),
    );

    await queryRunner.changeColumn(
      this._tableName,
      'github_id',
      new TableColumn({
        name: 'github_id',
        type: 'bigint',
        isUnique: true,
        isNullable: false,
      }),
    );
  }
}


