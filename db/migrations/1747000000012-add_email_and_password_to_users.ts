import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

export class AddEmailAndPasswordToUsers1747000000012 implements MigrationInterface {
  public get _tableName(): string {
    return 'users';
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns(this._tableName, [
      new TableColumn({
        name: 'email',
        type: 'text',
        isUnique: true,
        isNullable: true,
      }),
      new TableColumn({
        name: 'password_hash',
        type: 'text',
        isNullable: true,
      }),
    ]);

    await queryRunner.createIndex(
      this._tableName,
      new TableIndex({
        name: 'users_email_idx',
        columnNames: ['email'],
        isUnique: true,
        where: 'email IS NOT NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(this._tableName, 'users_email_idx');
    await queryRunner.dropColumn(this._tableName, 'password_hash');
    await queryRunner.dropColumn(this._tableName, 'email');
  }
}
