import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeChatMessageIdNullable1747000000008
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the foreign key constraint first
    await queryRunner.query(
      `ALTER TABLE "chat_tasks" DROP CONSTRAINT IF EXISTS "FK_ec8358a24e90134d4038f6b1d23"`,
    );

    // Make the column nullable
    await queryRunner.query(
      `ALTER TABLE "chat_tasks" ALTER COLUMN "chat_message_id" DROP NOT NULL`,
    );

    // Recreate the foreign key constraint with nullable support
    await queryRunner.query(
      `ALTER TABLE "chat_tasks" ADD CONSTRAINT "FK_ec8358a24e90134d4038f6b1d23" FOREIGN KEY ("chat_message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the foreign key constraint
    await queryRunner.query(
      `ALTER TABLE "chat_tasks" DROP CONSTRAINT IF EXISTS "FK_ec8358a24e90134d4038f6b1d23"`,
    );

    // Make the column NOT NULL again (this will fail if there are NULL values)
    await queryRunner.query(
      `ALTER TABLE "chat_tasks" ALTER COLUMN "chat_message_id" SET NOT NULL`,
    );

    // Recreate the foreign key constraint
    await queryRunner.query(
      `ALTER TABLE "chat_tasks" ADD CONSTRAINT "FK_ec8358a24e90134d4038f6b1d23" FOREIGN KEY ("chat_message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE`,
    );
  }
}

