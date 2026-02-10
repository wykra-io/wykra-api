import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

export class AddEmailVerificationToUsers1747000000017
  implements MigrationInterface
{
  public get _tableName(): string {
    return 'users';
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns(this._tableName, [
      new TableColumn({
        name: 'email_verified_at',
        type: 'timestamp',
        isNullable: true,
      }),
      new TableColumn({
        name: 'email_verification_token_hash',
        type: 'text',
        isNullable: true,
      }),
      new TableColumn({
        name: 'email_verification_sent_at',
        type: 'timestamp',
        isNullable: true,
      }),
      new TableColumn({
        name: 'email_verification_expires_at',
        type: 'timestamp',
        isNullable: true,
      }),
    ]);

    await queryRunner.createIndex(
      this._tableName,
      new TableIndex({
        name: 'users_email_verification_token_hash_idx',
        columnNames: ['email_verification_token_hash'],
        where: 'email_verification_token_hash IS NOT NULL',
      }),
    );

    await queryRunner.query(
      `UPDATE ${this._tableName} SET email_verified_at = NOW() WHERE email IS NOT NULL AND email_verified_at IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      this._tableName,
      'users_email_verification_token_hash_idx',
    );
    await queryRunner.dropColumn(
      this._tableName,
      'email_verification_expires_at',
    );
    await queryRunner.dropColumn(this._tableName, 'email_verification_sent_at');
    await queryRunner.dropColumn(this._tableName, 'email_verification_token_hash');
    await queryRunner.dropColumn(this._tableName, 'email_verified_at');
  }
}
