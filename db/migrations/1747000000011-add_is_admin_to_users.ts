import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
} from 'typeorm';

export class AddIsAdminToUsers1747000000011 implements MigrationInterface {
  public get _tableName(): string {
    return 'users';
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      this._tableName,
      new TableColumn({
        name: 'is_admin',
        type: 'boolean',
        default: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn(this._tableName, 'is_admin');
  }
}
