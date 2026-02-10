import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddSessionIdToChatTasks1747000000015 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'chat_tasks',
      new TableColumn({
        name: 'session_id',
        type: 'int',
        isNullable: true,
      }),
    );

    await queryRunner.query(
      'CREATE INDEX "chat_tasks_session_id_idx" ON "chat_tasks" ("session_id")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('chat_tasks', 'chat_tasks_session_id_idx');
    await queryRunner.dropColumn('chat_tasks', 'session_id');
  }
}
