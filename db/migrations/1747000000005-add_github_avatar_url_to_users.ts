import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddGithubAvatarUrlToUsers1747000000005
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'github_avatar_url',
        type: 'text',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'github_avatar_url');
  }
}
