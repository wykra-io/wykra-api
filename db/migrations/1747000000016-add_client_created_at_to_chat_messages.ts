import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddClientCreatedAtToChatMessages1747000000016
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'chat_messages',
      new TableColumn({
        name: 'client_created_at',
        type: 'timestamp',
        isNullable: true,
      }),
    );

    await queryRunner.query(
      'UPDATE "chat_messages" SET "client_created_at" = "created_at" WHERE "client_created_at" IS NULL',
    );
    await queryRunner.query(
      'ALTER TABLE "chat_messages" ALTER COLUMN "client_created_at" SET NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE "chat_messages" ALTER COLUMN "client_created_at" SET DEFAULT now()',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('chat_messages', 'client_created_at');
  }
}
